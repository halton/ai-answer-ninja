package repository

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"

	"smart-whitelist/internal/models"
)

// WhitelistRepository handles database operations for whitelist entries
type WhitelistRepository struct {
	db     *pgxpool.Pool
	logger *zap.Logger
}

// NewWhitelistRepository creates a new whitelist repository
func NewWhitelistRepository(db *pgxpool.Pool, logger *zap.Logger) *WhitelistRepository {
	return &WhitelistRepository{
		db:     db,
		logger: logger,
	}
}

// FastLookup performs an ultra-fast whitelist lookup optimized for <5ms response
func (r *WhitelistRepository) FastLookup(ctx context.Context, userID uuid.UUID, contactPhone string) (*models.SmartWhitelist, error) {
	start := time.Now()
	defer func() {
		r.logger.Debug("whitelist fast lookup completed",
			zap.Duration("duration", time.Since(start)),
			zap.String("user_id", userID.String()),
			zap.String("contact_phone", contactPhone))
	}()

	// Use the optimized index for maximum speed
	query := `
		SELECT id, user_id, contact_phone, contact_name, whitelist_type, 
		       confidence_score, is_active, expires_at, hit_count, last_hit_at,
		       created_at, updated_at
		FROM smart_whitelists
		WHERE user_id = $1 AND contact_phone = $2 
		  AND is_active = true 
		  AND (expires_at IS NULL OR expires_at > NOW())
		LIMIT 1`

	var entry models.SmartWhitelist
	err := r.db.QueryRow(ctx, query, userID, contactPhone).Scan(
		&entry.ID, &entry.UserID, &entry.ContactPhone, &entry.ContactName,
		&entry.WhitelistType, &entry.ConfidenceScore, &entry.IsActive,
		&entry.ExpiresAt, &entry.HitCount, &entry.LastHitAt,
		&entry.CreatedAt, &entry.UpdatedAt,
	)

	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil // Not found, but not an error
		}
		r.logger.Error("failed to lookup whitelist entry",
			zap.Error(err),
			zap.String("user_id", userID.String()),
			zap.String("contact_phone", contactPhone))
		return nil, fmt.Errorf("failed to lookup whitelist entry: %w", err)
	}

	return &entry, nil
}

// IncrementHitCount atomically increments the hit count for a whitelist entry
func (r *WhitelistRepository) IncrementHitCount(ctx context.Context, entryID uuid.UUID) error {
	query := `
		UPDATE smart_whitelists 
		SET hit_count = hit_count + 1, 
		    last_hit_at = NOW(),
		    updated_at = NOW()
		WHERE id = $1`

	_, err := r.db.Exec(ctx, query, entryID)
	if err != nil {
		r.logger.Error("failed to increment hit count",
			zap.Error(err),
			zap.String("entry_id", entryID.String()))
		return fmt.Errorf("failed to increment hit count: %w", err)
	}

	return nil
}

// Create creates a new whitelist entry
func (r *WhitelistRepository) Create(ctx context.Context, req *models.CreateWhitelistRequest) (*models.SmartWhitelist, error) {
	start := time.Now()
	defer func() {
		r.logger.Debug("whitelist create completed",
			zap.Duration("duration", time.Since(start)))
	}()

	// Set default confidence score if not provided
	confidenceScore := 1.0
	if req.ConfidenceScore != nil {
		confidenceScore = *req.ConfidenceScore
	}

	entry := &models.SmartWhitelist{
		ID:              uuid.New(),
		UserID:          req.UserID,
		ContactPhone:    req.ContactPhone,
		ContactName:     req.ContactName,
		WhitelistType:   req.WhitelistType,
		ConfidenceScore: confidenceScore,
		IsActive:        true,
		ExpiresAt:       req.ExpiresAt,
		HitCount:        0,
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
	}

	query := `
		INSERT INTO smart_whitelists (
			id, user_id, contact_phone, contact_name, whitelist_type,
			confidence_score, is_active, expires_at, hit_count,
			created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (user_id, contact_phone) 
		DO UPDATE SET
			contact_name = EXCLUDED.contact_name,
			whitelist_type = EXCLUDED.whitelist_type,
			confidence_score = EXCLUDED.confidence_score,
			is_active = EXCLUDED.is_active,
			expires_at = EXCLUDED.expires_at,
			updated_at = EXCLUDED.updated_at
		RETURNING id, created_at, updated_at`

	err := r.db.QueryRow(ctx, query,
		entry.ID, entry.UserID, entry.ContactPhone, entry.ContactName,
		entry.WhitelistType, entry.ConfidenceScore, entry.IsActive,
		entry.ExpiresAt, entry.HitCount, entry.CreatedAt, entry.UpdatedAt,
	).Scan(&entry.ID, &entry.CreatedAt, &entry.UpdatedAt)

	if err != nil {
		r.logger.Error("failed to create whitelist entry",
			zap.Error(err),
			zap.Any("request", req))
		return nil, fmt.Errorf("failed to create whitelist entry: %w", err)
	}

	return entry, nil
}

// BatchCreate creates multiple whitelist entries in a single transaction
func (r *WhitelistRepository) BatchCreate(ctx context.Context, req *models.BatchCreateRequest) ([]*models.SmartWhitelist, error) {
	start := time.Now()
	defer func() {
		r.logger.Debug("whitelist batch create completed",
			zap.Duration("duration", time.Since(start)),
			zap.Int("count", len(req.Entries)))
	}()

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	entries := make([]*models.SmartWhitelist, 0, len(req.Entries))

	// Prepare the batch insert statement
	query := `
		INSERT INTO smart_whitelists (
			id, user_id, contact_phone, contact_name, whitelist_type,
			confidence_score, is_active, expires_at, hit_count,
			created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (user_id, contact_phone) 
		DO UPDATE SET
			contact_name = EXCLUDED.contact_name,
			whitelist_type = EXCLUDED.whitelist_type,
			confidence_score = EXCLUDED.confidence_score,
			is_active = EXCLUDED.is_active,
			expires_at = EXCLUDED.expires_at,
			updated_at = EXCLUDED.updated_at
		RETURNING id, created_at, updated_at`

	for _, entryReq := range req.Entries {
		confidenceScore := 1.0
		if entryReq.ConfidenceScore != nil {
			confidenceScore = *entryReq.ConfidenceScore
		}

		entry := &models.SmartWhitelist{
			ID:              uuid.New(),
			UserID:          req.UserID,
			ContactPhone:    entryReq.ContactPhone,
			ContactName:     entryReq.ContactName,
			WhitelistType:   entryReq.WhitelistType,
			ConfidenceScore: confidenceScore,
			IsActive:        true,
			ExpiresAt:       entryReq.ExpiresAt,
			HitCount:        0,
			CreatedAt:       time.Now(),
			UpdatedAt:       time.Now(),
		}

		err := tx.QueryRow(ctx, query,
			entry.ID, entry.UserID, entry.ContactPhone, entry.ContactName,
			entry.WhitelistType, entry.ConfidenceScore, entry.IsActive,
			entry.ExpiresAt, entry.HitCount, entry.CreatedAt, entry.UpdatedAt,
		).Scan(&entry.ID, &entry.CreatedAt, &entry.UpdatedAt)

		if err != nil {
			r.logger.Error("failed to create whitelist entry in batch",
				zap.Error(err),
				zap.String("contact_phone", entryReq.ContactPhone))
			return nil, fmt.Errorf("failed to create whitelist entry for %s: %w", entryReq.ContactPhone, err)
		}

		entries = append(entries, entry)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("failed to commit batch create transaction: %w", err)
	}

	return entries, nil
}

// Update updates an existing whitelist entry
func (r *WhitelistRepository) Update(ctx context.Context, id uuid.UUID, req *models.UpdateWhitelistRequest) (*models.SmartWhitelist, error) {
	start := time.Now()
	defer func() {
		r.logger.Debug("whitelist update completed",
			zap.Duration("duration", time.Since(start)),
			zap.String("id", id.String()))
	}()

	// Build dynamic update query
	var setParts []string
	var args []interface{}
	argCount := 1

	if req.ContactName != nil {
		setParts = append(setParts, fmt.Sprintf("contact_name = $%d", argCount))
		args = append(args, req.ContactName)
		argCount++
	}

	if req.WhitelistType != nil {
		setParts = append(setParts, fmt.Sprintf("whitelist_type = $%d", argCount))
		args = append(args, *req.WhitelistType)
		argCount++
	}

	if req.ConfidenceScore != nil {
		setParts = append(setParts, fmt.Sprintf("confidence_score = $%d", argCount))
		args = append(args, *req.ConfidenceScore)
		argCount++
	}

	if req.IsActive != nil {
		setParts = append(setParts, fmt.Sprintf("is_active = $%d", argCount))
		args = append(args, *req.IsActive)
		argCount++
	}

	if req.ExpiresAt != nil {
		setParts = append(setParts, fmt.Sprintf("expires_at = $%d", argCount))
		args = append(args, req.ExpiresAt)
		argCount++
	}

	if len(setParts) == 0 {
		return nil, fmt.Errorf("no fields to update")
	}

	setParts = append(setParts, fmt.Sprintf("updated_at = $%d", argCount))
	args = append(args, time.Now())
	argCount++

	args = append(args, id)

	query := fmt.Sprintf(`
		UPDATE smart_whitelists 
		SET %s
		WHERE id = $%d
		RETURNING id, user_id, contact_phone, contact_name, whitelist_type,
		          confidence_score, is_active, expires_at, hit_count, last_hit_at,
		          created_at, updated_at`,
		strings.Join(setParts, ", "), argCount)

	var entry models.SmartWhitelist
	err := r.db.QueryRow(ctx, query, args...).Scan(
		&entry.ID, &entry.UserID, &entry.ContactPhone, &entry.ContactName,
		&entry.WhitelistType, &entry.ConfidenceScore, &entry.IsActive,
		&entry.ExpiresAt, &entry.HitCount, &entry.LastHitAt,
		&entry.CreatedAt, &entry.UpdatedAt,
	)

	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("whitelist entry not found")
		}
		r.logger.Error("failed to update whitelist entry",
			zap.Error(err),
			zap.String("id", id.String()))
		return nil, fmt.Errorf("failed to update whitelist entry: %w", err)
	}

	return &entry, nil
}

// Delete soft deletes a whitelist entry by setting is_active to false
func (r *WhitelistRepository) Delete(ctx context.Context, id uuid.UUID) error {
	query := `
		UPDATE smart_whitelists 
		SET is_active = false, updated_at = NOW()
		WHERE id = $1`

	result, err := r.db.Exec(ctx, query, id)
	if err != nil {
		r.logger.Error("failed to delete whitelist entry",
			zap.Error(err),
			zap.String("id", id.String()))
		return fmt.Errorf("failed to delete whitelist entry: %w", err)
	}

	if result.RowsAffected() == 0 {
		return fmt.Errorf("whitelist entry not found")
	}

	return nil
}

// List retrieves whitelist entries based on query parameters
func (r *WhitelistRepository) List(ctx context.Context, query *models.WhitelistQuery) ([]*models.SmartWhitelist, error) {
	start := time.Now()
	defer func() {
		r.logger.Debug("whitelist list completed",
			zap.Duration("duration", time.Since(start)))
	}()

	// Build dynamic query
	var conditions []string
	var args []interface{}
	argCount := 1

	if query.UserID != nil {
		conditions = append(conditions, fmt.Sprintf("user_id = $%d", argCount))
		args = append(args, *query.UserID)
		argCount++
	}

	if query.ContactPhone != nil {
		conditions = append(conditions, fmt.Sprintf("contact_phone = $%d", argCount))
		args = append(args, *query.ContactPhone)
		argCount++
	}

	if query.WhitelistType != nil {
		conditions = append(conditions, fmt.Sprintf("whitelist_type = $%d", argCount))
		args = append(args, *query.WhitelistType)
		argCount++
	}

	if query.IsActive != nil {
		conditions = append(conditions, fmt.Sprintf("is_active = $%d", argCount))
		args = append(args, *query.IsActive)
		argCount++
	}

	if !query.IncludeExpired {
		conditions = append(conditions, "(expires_at IS NULL OR expires_at > NOW())")
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	limit := 100
	if query.Limit > 0 {
		limit = query.Limit
	}

	offset := 0
	if query.Offset > 0 {
		offset = query.Offset
	}

	sqlQuery := fmt.Sprintf(`
		SELECT id, user_id, contact_phone, contact_name, whitelist_type,
		       confidence_score, is_active, expires_at, hit_count, last_hit_at,
		       created_at, updated_at
		FROM smart_whitelists
		%s
		ORDER BY updated_at DESC
		LIMIT $%d OFFSET $%d`,
		whereClause, argCount, argCount+1)

	args = append(args, limit, offset)

	rows, err := r.db.Query(ctx, sqlQuery, args...)
	if err != nil {
		r.logger.Error("failed to list whitelist entries", zap.Error(err))
		return nil, fmt.Errorf("failed to list whitelist entries: %w", err)
	}
	defer rows.Close()

	var entries []*models.SmartWhitelist
	for rows.Next() {
		var entry models.SmartWhitelist
		err := rows.Scan(
			&entry.ID, &entry.UserID, &entry.ContactPhone, &entry.ContactName,
			&entry.WhitelistType, &entry.ConfidenceScore, &entry.IsActive,
			&entry.ExpiresAt, &entry.HitCount, &entry.LastHitAt,
			&entry.CreatedAt, &entry.UpdatedAt,
		)
		if err != nil {
			r.logger.Error("failed to scan whitelist entry", zap.Error(err))
			return nil, fmt.Errorf("failed to scan whitelist entry: %w", err)
		}
		entries = append(entries, &entry)
	}

	return entries, nil
}

// GetStats retrieves statistics for a user's whitelist entries
func (r *WhitelistRepository) GetStats(ctx context.Context, userID uuid.UUID) (*models.WhitelistStats, error) {
	query := `
		SELECT 
			COUNT(*) as total_entries,
			COUNT(*) FILTER (WHERE is_active = true AND (expires_at IS NULL OR expires_at > NOW())) as active_entries,
			COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at <= NOW()) as expired_entries,
			COUNT(*) FILTER (WHERE whitelist_type = 'manual') as manual_entries,
			COUNT(*) FILTER (WHERE whitelist_type = 'auto') as auto_entries,
			COUNT(*) FILTER (WHERE whitelist_type = 'learned') as learned_entries,
			COUNT(*) FILTER (WHERE whitelist_type = 'temporary') as temp_entries,
			COALESCE(SUM(hit_count), 0) as total_hits
		FROM smart_whitelists
		WHERE user_id = $1`

	var stats models.WhitelistStats
	stats.UserID = userID
	stats.LastUpdated = time.Now()

	err := r.db.QueryRow(ctx, query, userID).Scan(
		&stats.TotalEntries, &stats.ActiveEntries, &stats.ExpiredEntries,
		&stats.ManualEntries, &stats.AutoEntries, &stats.LearnedEntries,
		&stats.TempEntries, &stats.TotalHits,
	)

	if err != nil {
		r.logger.Error("failed to get whitelist stats",
			zap.Error(err),
			zap.String("user_id", userID.String()))
		return nil, fmt.Errorf("failed to get whitelist stats: %w", err)
	}

	return &stats, nil
}

// CleanupExpired removes or deactivates expired whitelist entries
func (r *WhitelistRepository) CleanupExpired(ctx context.Context, batchSize int) (int, error) {
	start := time.Now()
	defer func() {
		r.logger.Debug("whitelist cleanup completed",
			zap.Duration("duration", time.Since(start)))
	}()

	// Update expired entries to inactive instead of deleting
	query := `
		UPDATE smart_whitelists 
		SET is_active = false, updated_at = NOW()
		WHERE expires_at IS NOT NULL 
		  AND expires_at <= NOW() 
		  AND is_active = true
		LIMIT $1`

	result, err := r.db.Exec(ctx, query, batchSize)
	if err != nil {
		r.logger.Error("failed to cleanup expired whitelist entries", zap.Error(err))
		return 0, fmt.Errorf("failed to cleanup expired whitelist entries: %w", err)
	}

	count := int(result.RowsAffected())
	if count > 0 {
		r.logger.Info("cleaned up expired whitelist entries", zap.Int("count", count))
	}

	return count, nil
}

// GetByID retrieves a whitelist entry by ID
func (r *WhitelistRepository) GetByID(ctx context.Context, id uuid.UUID) (*models.SmartWhitelist, error) {
	query := `
		SELECT id, user_id, contact_phone, contact_name, whitelist_type,
		       confidence_score, is_active, expires_at, hit_count, last_hit_at,
		       created_at, updated_at
		FROM smart_whitelists
		WHERE id = $1`

	var entry models.SmartWhitelist
	err := r.db.QueryRow(ctx, query, id).Scan(
		&entry.ID, &entry.UserID, &entry.ContactPhone, &entry.ContactName,
		&entry.WhitelistType, &entry.ConfidenceScore, &entry.IsActive,
		&entry.ExpiresAt, &entry.HitCount, &entry.LastHitAt,
		&entry.CreatedAt, &entry.UpdatedAt,
	)

	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		r.logger.Error("failed to get whitelist entry by ID",
			zap.Error(err),
			zap.String("id", id.String()))
		return nil, fmt.Errorf("failed to get whitelist entry: %w", err)
	}

	return &entry, nil
}

// HealthCheck performs a basic health check on the database connection
func (r *WhitelistRepository) HealthCheck(ctx context.Context) error {
	query := "SELECT 1"
	var result int
	err := r.db.QueryRow(ctx, query).Scan(&result)
	if err != nil {
		r.logger.Error("database health check failed", zap.Error(err))
		return fmt.Errorf("database health check failed: %w", err)
	}
	return nil
}