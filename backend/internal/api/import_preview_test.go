package api

import (
	"context"
	"errors"
	"gentum.finance/backend/internal/account"
	"gentum.finance/backend/internal/finance"
	"testing"
)

type previewRepository struct {
	finance.Repository
	user  string
	input finance.Row
	err   error
}

func (r *previewRepository) PreviewImport(_ context.Context, user string, input finance.Row) (finance.ImportPreview, error) {
	r.user = user
	r.input = input
	return finance.ImportPreview{Count: 1, Transactions: []finance.Row{{"amount": "9007199254740993", "account": "Wallet", "category": "Food / Coffee", "currency": "EUR", "record": "2"}}, Errors: []finance.Row{}}, r.err
}
func TestPreviewImportGraphQLContract(t *testing.T) {
	repo := &previewRepository{}
	h, err := NewHandler(account.Service{Repository: &memoryRepository{}, CurrentUser: identity("owner")}, "http://localhost:5173", finance.Service{Repository: repo, CurrentUser: identity("owner")})
	if err != nil {
		t.Fatal(err)
	}
	query := `query Preview($input:FinanceInput!){previewImport(input:$input)}`
	result := execute(t, h, query, map[string]interface{}{"input": map[string]interface{}{"csv": "fixture", "accountId": "account"}})
	if result["errors"] != nil || repo.user != "owner" || repo.input["csv"] != "fixture" || repo.input["accountId"] != "account" {
		t.Fatal(result, repo)
	}
	data := result["data"].(map[string]interface{})["previewImport"].(map[string]interface{})
	if data["transactions"].([]interface{})[0].(map[string]interface{})["amount"] != "9007199254740993" {
		t.Fatal(result)
	}
	repo.err = finance.ValidationError("CSV record 2: invalid date")
	result = execute(t, h, query, map[string]interface{}{"input": map[string]interface{}{"csv": "bad"}})
	if result["errors"] == nil {
		t.Fatal(result)
	}
	repo.err = errors.New("private database failure")
	result = execute(t, h, query, map[string]interface{}{"input": map[string]interface{}{"csv": "bad"}})
	message := result["errors"].([]interface{})[0].(map[string]interface{})["message"]
	if message != "Unable to preview CSV" {
		t.Fatal(result)
	}
}
