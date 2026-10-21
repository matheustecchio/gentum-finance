package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"gentum.finance/backend/internal/account"
	"gentum.finance/backend/internal/finance"
	"github.com/graphql-go/graphql"
	"github.com/graphql-go/graphql/language/ast"
)

var integerText = regexp.MustCompile(`^(0|-[1-9][0-9]*|[1-9][0-9]*)$`)

// Cents uses a canonical integer string on the wire to preserve the entire int64
// range across JavaScript clients. It never accepts floating-point JSON numbers.
func parseCents(value interface{}) interface{} {
	s, ok := value.(string)
	if !ok || !integerText.MatchString(s) {
		return nil
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return nil
	}
	return n
}

func NewHandler(service account.Service, allowedOrigin string, financeServices ...finance.Service) (http.Handler, error) {
	cents := graphql.NewScalar(graphql.ScalarConfig{
		Name: "Cents", Description: "Signed int64 minor units encoded as an integer string; 100 = EUR 1.00.",
		Serialize: func(v interface{}) interface{} {
			n, ok := v.(int64)
			if !ok {
				return nil
			}
			return strconv.FormatInt(n, 10)
		},
		ParseValue: parseCents,
		ParseLiteral: func(v ast.Value) interface{} {
			s, ok := v.(*ast.StringValue)
			if !ok {
				return nil
			}
			return parseCents(s.Value)
		},
	})
	types := graphql.NewEnum(graphql.EnumConfig{Name: "AccountType", Values: graphql.EnumValueConfigMap{
		"CURRENT": {Value: "CURRENT"}, "SAVINGS": {Value: "SAVINGS"}, "CASH": {Value: "CASH"}, "CREDIT_CARD": {Value: "CREDIT_CARD"},
	}})
	accountType := graphql.NewObject(graphql.ObjectConfig{Name: "Account", Fields: graphql.Fields{
		"id": {Type: graphql.NewNonNull(graphql.ID)}, "name": {Type: graphql.NewNonNull(graphql.String)},
		"type": {Type: graphql.NewNonNull(types)}, "currency": {Type: graphql.NewNonNull(graphql.String)},
		"initialBalance": {Type: graphql.NewNonNull(cents)}, "archived": {Type: graphql.NewNonNull(graphql.Boolean)},
		"createdAt": {Type: graphql.NewNonNull(graphql.String)}, "updatedAt": {Type: graphql.NewNonNull(graphql.String)},
	}})
	inputType := graphql.NewInputObject(graphql.InputObjectConfig{Name: "CreateAccountInput", Fields: graphql.InputObjectConfigFieldMap{
		"name": {Type: graphql.NewNonNull(graphql.String)}, "type": {Type: graphql.NewNonNull(types)},
		"currency": {Type: graphql.NewNonNull(graphql.String)}, "initialBalance": {Type: graphql.NewNonNull(cents)},
	}})
	safeError := func(err error) error {
		var validation account.ValidationError
		if errors.As(err, &validation) {
			return validation
		}
		slog.Error("account operation failed", "error", err)
		return errors.New("Account operation failed")
	}
	financeFields := graphql.Fields{}
	financeMutations := graphql.Fields{}
	if len(financeServices) > 0 {
		fs := financeServices[0]
		data := graphql.NewScalar(graphql.ScalarConfig{Name: "FinanceData", Description: "Finance snapshot: money values are exact integer strings.", Serialize: func(v interface{}) interface{} { return v }})
		fields := graphql.InputObjectConfigFieldMap{}
		for _, key := range []string{"color", "parentId", "name", "kind", "accountId", "categoryId", "amount", "description", "date", "fromId", "toId", "month", "currency", "id", "csv"} {
			fields[key] = &graphql.InputObjectFieldConfig{Type: graphql.String}
		}
		input := graphql.NewInputObject(graphql.InputObjectConfig{Name: "FinanceInput", Fields: fields})
		financeFields["flowHistory"] = &graphql.Field{Type: data, Args: graphql.FieldConfigArgument{"grouping": {Type: graphql.NewNonNull(graphql.String)}, "weekEnd": {Type: graphql.Int, DefaultValue: 0}, "before": {Type: graphql.String}, "start": {Type: graphql.String}, "end": {Type: graphql.String}}, Resolve: func(p graphql.ResolveParams) (interface{}, error) {
			value := func(key string) string { v, _ := p.Args[key].(string); return v }
			weekEnd, _ := p.Args["weekEnd"].(int)
			result, err := fs.FlowHistory(p.Context, finance.FlowFilter{Grouping: value("grouping"), WeekEnd: weekEnd, Before: value("before"), Start: value("start"), End: value("end")})
			if err != nil {
				var validation finance.ValidationError
				if errors.As(err, &validation) {
					return nil, validation
				}
				return nil, errors.New("Unable to load cash flow")
			}
			return result, nil
		}}
		financeFields["categorySpending"] = &graphql.Field{Type: data, Args: graphql.FieldConfigArgument{"start": {Type: graphql.NewNonNull(graphql.String)}, "end": {Type: graphql.NewNonNull(graphql.String)}}, Resolve: func(p graphql.ResolveParams) (interface{}, error) {
			result, err := fs.Spending(p.Context, p.Args["start"].(string), p.Args["end"].(string))
			if err != nil {
				var validation finance.ValidationError
				if errors.As(err, &validation) {
					return nil, validation
				}
				return nil, errors.New("Unable to load category spending")
			}
			return result, nil
		}}

		financeFields["analytics"] = &graphql.Field{Type: data, Args: graphql.FieldConfigArgument{"start": {Type: graphql.NewNonNull(graphql.String)}, "end": {Type: graphql.NewNonNull(graphql.String)}}, Resolve: func(p graphql.ResolveParams) (interface{}, error) {
			result, err := fs.Analytics(p.Context, p.Args["start"].(string), p.Args["end"].(string))
			if err != nil {
				var validation finance.ValidationError
				if errors.As(err, &validation) {
					return nil, validation
				}
				return nil, errors.New("Unable to load analytics")
			}
			return result, nil
		}}

		financeFields["overview"] = &graphql.Field{Type: data, Args: graphql.FieldConfigArgument{"month": {Type: graphql.NewNonNull(graphql.String)}}, Resolve: func(p graphql.ResolveParams) (interface{}, error) {
			result, err := fs.Overview(p.Context, p.Args["month"].(string))
			if err != nil {
				return nil, errors.New("Unable to load Overview")
			}
			return result, nil
		}}
		financeFields["finance"] = &graphql.Field{Type: data, Args: graphql.FieldConfigArgument{"month": {Type: graphql.NewNonNull(graphql.String)}}, Resolve: func(p graphql.ResolveParams) (interface{}, error) {
			result, err := fs.Snapshot(p.Context, p.Args["month"].(string))
			if err != nil {
				return nil, errors.New("Unable to load finance data; check month and supported totals")
			}
			return result, nil
		}}
		financeFields["financeSummary"] = &graphql.Field{Type: data, Args: graphql.FieldConfigArgument{"month": {Type: graphql.NewNonNull(graphql.String)}}, Resolve: func(p graphql.ResolveParams) (interface{}, error) {
			result, err := fs.Summary(p.Context, p.Args["month"].(string))
			if err != nil {
				return nil, errors.New("Unable to load finance summary")
			}
			return result, nil
		}}
		historyArgs := graphql.FieldConfigArgument{}
		for _, key := range []string{"start", "end", "categoryId", "subcategoryId", "after"} {
			historyArgs[key] = &graphql.ArgumentConfig{Type: graphql.String}
		}
		financeFields["entryHistory"] = &graphql.Field{Type: data, Args: historyArgs, Resolve: func(p graphql.ResolveParams) (interface{}, error) {
			value := func(key string) string { v, _ := p.Args[key].(string); return v }
			result, err := fs.History(p.Context, finance.HistoryFilter{Start: value("start"), End: value("end"), CategoryID: value("categoryId"), SubcategoryID: value("subcategoryId"), After: value("after")})
			if err != nil {
				var validation finance.ValidationError
				if errors.As(err, &validation) {
					return nil, validation
				}
				return nil, errors.New("Unable to load transaction history")
			}
			return result, nil
		}}
		financeMutations["executeFinance"] = &graphql.Field{Type: graphql.String, Args: graphql.FieldConfigArgument{"action": {Type: graphql.NewNonNull(graphql.String)}, "input": {Type: graphql.NewNonNull(input)}}, Resolve: func(p graphql.ResolveParams) (interface{}, error) {
			in := finance.Row{}
			for k, v := range p.Args["input"].(map[string]interface{}) {
				if v != nil {
					in[k] = v.(string)
				}
			}
			result, err := fs.Execute(p.Context, p.Args["action"].(string), in)
			if err != nil {
				var validation finance.ValidationError
				if errors.As(err, &validation) {
					return nil, validation
				}
				slog.Warn("finance operation rejected", "error", err)
				return nil, errors.New("Operation rejected: check amounts, dates, ownership and matching categories; no changes saved")
			}
			return result, nil
		}}
	}
	schema, err := graphql.NewSchema(graphql.SchemaConfig{
		Query: graphql.NewObject(graphql.ObjectConfig{Name: "Query", Fields: mergeFields(financeFields, graphql.Fields{
			"accounts": {Type: graphql.NewNonNull(graphql.NewList(graphql.NewNonNull(accountType))), Resolve: func(p graphql.ResolveParams) (interface{}, error) {
				accounts, err := service.List(p.Context)
				if err != nil {
					return nil, safeError(err)
				}
				result := make([]map[string]interface{}, 0, len(accounts))
				for _, a := range accounts {
					result = append(result, accountMap(a))
				}
				return result, nil
			}},
		})}),
		Mutation: graphql.NewObject(graphql.ObjectConfig{Name: "Mutation", Fields: mergeFields(financeMutations, graphql.Fields{
			"createAccount": {Type: graphql.NewNonNull(accountType), Args: graphql.FieldConfigArgument{"input": {Type: graphql.NewNonNull(inputType)}}, Resolve: func(p graphql.ResolveParams) (interface{}, error) {
				input := p.Args["input"].(map[string]interface{})
				a, err := service.Create(p.Context, account.Input{Name: input["name"].(string), Type: input["type"].(string), Currency: input["currency"].(string), InitialBalance: input["initialBalance"].(int64)})
				if err != nil {
					return nil, safeError(err)
				}
				return accountMap(a), nil
			}},
		})}),
	})
	if err != nil {
		return nil, err
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		if r.URL.Path != "/graphql" {
			http.NotFound(w, r)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			w.Header().Set("Vary", "Origin")
			if origin != allowedOrigin {
				http.Error(w, "Origin not allowed", http.StatusForbidden)
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
			w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST, OPTIONS")
			http.Error(w, "Method not allowed", 405)
			return
		}
		if ct := r.Header.Get("Content-Type"); ct != "application/json" && ct != "application/json; charset=utf-8" {
			http.Error(w, "Use application/json", 415)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var request struct {
			Query         string                 `json:"query"`
			Variables     map[string]interface{} `json:"variables"`
			OperationName string                 `json:"operationName"`
		}
		decoder := json.NewDecoder(r.Body)
		if err := decoder.Decode(&request); err != nil {
			http.Error(w, "Invalid request", 400)
			return
		}
		if err := decoder.Decode(new(interface{})); err != io.EOF {
			http.Error(w, "Invalid request", 400)
			return
		}
		if request.Query == "" {
			http.Error(w, "Missing query", 400)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		result := graphql.Do(graphql.Params{Schema: schema, RequestString: request.Query, VariableValues: request.Variables, OperationName: request.OperationName, Context: ctx})
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(result); err != nil {
			slog.Error("encode GraphQL response", "error", fmt.Sprint(err))
		}
	}), nil
}

func accountMap(a account.Account) map[string]interface{} {
	return map[string]interface{}{"id": a.ID, "name": a.Name, "type": a.Type, "currency": a.Currency, "initialBalance": a.InitialBalance, "archived": a.Archived, "createdAt": a.CreatedAt.Format(time.RFC3339Nano), "updatedAt": a.UpdatedAt.Format(time.RFC3339Nano)}
}

func mergeFields(a, b graphql.Fields) graphql.Fields {
	for k, v := range b {
		a[k] = v
	}
	return a
}
