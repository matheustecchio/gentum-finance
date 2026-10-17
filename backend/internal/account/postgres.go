package account

import (
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresRepository struct{ Pool *pgxpool.Pool }

func (r PostgresRepository) Save(ctx context.Context, a Account) (Account, error) {
	_, err := r.Pool.Exec(ctx, `INSERT INTO account
 (id,user_id,name,type,currency,initial_balance,archived,created_at,updated_at)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, a.ID, a.UserID, a.Name, a.Type, a.Currency, a.InitialBalance, a.Archived, a.CreatedAt, a.UpdatedAt)
	return a, err
}
func (r PostgresRepository) List(ctx context.Context, userID string) ([]Account, error) {
	rows, err := r.Pool.Query(ctx, `SELECT id::text,user_id::text,name,type,currency,initial_balance,archived,created_at,updated_at FROM account WHERE user_id=$1 ORDER BY created_at,id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]Account, 0)
	for rows.Next() {
		var a Account
		if err := rows.Scan(&a.ID, &a.UserID, &a.Name, &a.Type, &a.Currency, &a.InitialBalance, &a.Archived, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, a)
	}
	return result, rows.Err()
}
