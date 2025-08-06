package repository

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"

	"smart-whitelist/internal/models"
)

// UserRepository handles database operations for users
type UserRepository struct {
	db     *pgxpool.Pool
	logger *zap.Logger
}

// NewUserRepository creates a new user repository
func NewUserRepository(db *pgxpool.Pool, logger *zap.Logger) *UserRepository {
	return &UserRepository{
		db:     db,
		logger: logger,
	}
}

// GetByID retrieves a user by ID
func (r *UserRepository) GetByID(ctx context.Context, id uuid.UUID) (*models.User, error) {
	query := `
		SELECT id, phone_number, name, personality, created_at, updated_at
		FROM users
		WHERE id = $1`

	var user models.User
	err := r.db.QueryRow(ctx, query, id).Scan(
		&user.ID, &user.PhoneNumber, &user.Name, &user.Personality,
		&user.CreatedAt, &user.UpdatedAt,
	)

	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		r.logger.Error("failed to get user by ID",
			zap.Error(err),
			zap.String("id", id.String()))
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	return &user, nil
}

// GetByPhoneNumber retrieves a user by phone number
func (r *UserRepository) GetByPhoneNumber(ctx context.Context, phoneNumber string) (*models.User, error) {
	query := `
		SELECT id, phone_number, name, personality, created_at, updated_at
		FROM users
		WHERE phone_number = $1`

	var user models.User
	err := r.db.QueryRow(ctx, query, phoneNumber).Scan(
		&user.ID, &user.PhoneNumber, &user.Name, &user.Personality,
		&user.CreatedAt, &user.UpdatedAt,
	)

	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		r.logger.Error("failed to get user by phone number",
			zap.Error(err),
			zap.String("phone_number", phoneNumber))
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	return &user, nil
}

// Exists checks if a user exists by ID
func (r *UserRepository) Exists(ctx context.Context, id uuid.UUID) (bool, error) {
	query := `SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)`

	var exists bool
	err := r.db.QueryRow(ctx, query, id).Scan(&exists)
	if err != nil {
		r.logger.Error("failed to check if user exists",
			zap.Error(err),
			zap.String("id", id.String()))
		return false, fmt.Errorf("failed to check if user exists: %w", err)
	}

	return exists, nil
}