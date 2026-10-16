package account

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

type Account struct {
	ID             string
	UserID         string
	Name           string
	Type           string
	Currency       string
	InitialBalance int64
	Archived       bool
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type Input struct {
	Name           string
	Type           string
	Currency       string
	InitialBalance int64
}

type Repository interface {
	Save(context.Context, Account) (Account, error)
	List(context.Context, string) ([]Account, error)
}

type CurrentUserProvider interface {
	UserID(context.Context) (string, error)
}

type ValidationError struct{ Message string }

func (e ValidationError) Error() string { return e.Message }

type Service struct {
	Repository  Repository
	CurrentUser CurrentUserProvider
}

func (s Service) Create(ctx context.Context, input Input) (Account, error) {
	input.Name = strings.TrimSpace(input.Name)
	if n := utf8.RuneCountInString(input.Name); n == 0 || n > 100 {
		return Account{}, ValidationError{"name must contain between 1 and 100 characters"}
	}
	switch input.Type {
	case "CURRENT", "SAVINGS", "CASH", "CREDIT_CARD":
	default:
		return Account{}, ValidationError{"invalid account type"}
	}
	switch input.Currency {
	case "EUR", "GBP", "USD", "BRL":
	default:
		return Account{}, ValidationError{"unsupported currency"}
	}
	userID, err := s.CurrentUser.UserID(ctx)
	if err != nil {
		return Account{}, err
	}
	if userID == "" {
		return Account{}, errors.New("missing current user")
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return Account{}, err
	}
	id[6] = (id[6] & 0x0f) | 0x40
	id[8] = (id[8] & 0x3f) | 0x80
	now := time.Now().UTC()
	a := Account{ID: fmt.Sprintf("%x-%x-%x-%x-%x", id[0:4], id[4:6], id[6:8], id[8:10], id[10:16]), UserID: userID, Name: input.Name, Type: input.Type, Currency: input.Currency, InitialBalance: input.InitialBalance, CreatedAt: now, UpdatedAt: now}
	return s.Repository.Save(ctx, a)
}

func (s Service) List(ctx context.Context) ([]Account, error) {
	userID, err := s.CurrentUser.UserID(ctx)
	if err != nil {
		return nil, err
	}
	if userID == "" {
		return nil, errors.New("missing current user")
	}
	return s.Repository.List(ctx, userID)
}
