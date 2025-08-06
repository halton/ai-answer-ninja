package repository

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"

	"smart-whitelist/internal/models"
)

// SpamProfileRepository handles database operations for spam profiles
type SpamProfileRepository struct {
	db     *pgxpool.Pool
	logger *zap.Logger
}

// NewSpamProfileRepository creates a new spam profile repository
func NewSpamProfileRepository(db *pgxpool.Pool, logger *zap.Logger) *SpamProfileRepository {
	return &SpamProfileRepository{
		db:     db,
		logger: logger,
	}
}

// hashPhoneNumber creates a SHA-256 hash of the phone number for privacy
func (r *SpamProfileRepository) hashPhoneNumber(phoneNumber string) string {
	hash := sha256.Sum256([]byte(phoneNumber))
	return hex.EncodeToString(hash[:])
}

// GetByPhoneNumber retrieves a spam profile by phone number
func (r *SpamProfileRepository) GetByPhoneNumber(ctx context.Context, phoneNumber string) (*models.SpamProfile, error) {
	phoneHash := r.hashPhoneNumber(phoneNumber)
	
	query := `
		SELECT id, phone_hash, spam_category, risk_score, confidence_level,
		       feature_vector, behavioral_patterns, total_reports, successful_blocks,
		       false_positive_count, first_reported, last_activity, last_updated, created_at
		FROM spam_profiles
		WHERE phone_hash = $1`

	var profile models.SpamProfile
	err := r.db.QueryRow(ctx, query, phoneHash).Scan(
		&profile.ID, &profile.PhoneHash, &profile.SpamCategory, &profile.RiskScore,
		&profile.ConfidenceLevel, &profile.FeatureVector, &profile.BehavioralPatterns,
		&profile.TotalReports, &profile.SuccessfulBlocks, &profile.FalsePositiveCount,
		&profile.FirstReported, &profile.LastActivity, &profile.LastUpdated, &profile.CreatedAt,
	)

	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		r.logger.Error("failed to get spam profile by phone number",
			zap.Error(err),
			zap.String("phone_hash", phoneHash))
		return nil, fmt.Errorf("failed to get spam profile: %w", err)
	}

	return &profile, nil
}

// CreateOrUpdate creates a new spam profile or updates an existing one
func (r *SpamProfileRepository) CreateOrUpdate(ctx context.Context, phoneNumber string, profile *models.SpamProfile) (*models.SpamProfile, error) {
	phoneHash := r.hashPhoneNumber(phoneNumber)
	
	now := time.Now()
	if profile.ID == uuid.Nil {
		profile.ID = uuid.New()
	}
	profile.PhoneHash = phoneHash
	profile.LastActivity = now
	profile.LastUpdated = now

	query := `
		INSERT INTO spam_profiles (
			id, phone_hash, spam_category, risk_score, confidence_level,
			feature_vector, behavioral_patterns, total_reports, successful_blocks,
			false_positive_count, first_reported, last_activity, last_updated, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		ON CONFLICT (phone_hash)
		DO UPDATE SET
			spam_category = EXCLUDED.spam_category,
			risk_score = EXCLUDED.risk_score,
			confidence_level = EXCLUDED.confidence_level,
			feature_vector = EXCLUDED.feature_vector,
			behavioral_patterns = EXCLUDED.behavioral_patterns,
			total_reports = spam_profiles.total_reports + EXCLUDED.total_reports,
			successful_blocks = spam_profiles.successful_blocks + EXCLUDED.successful_blocks,
			false_positive_count = spam_profiles.false_positive_count + EXCLUDED.false_positive_count,
			last_activity = EXCLUDED.last_activity,
			last_updated = EXCLUDED.last_updated
		RETURNING id, first_reported, created_at`

	if profile.FirstReported.IsZero() {
		profile.FirstReported = now
	}
	if profile.CreatedAt.IsZero() {
		profile.CreatedAt = now
	}

	err := r.db.QueryRow(ctx, query,
		profile.ID, profile.PhoneHash, profile.SpamCategory, profile.RiskScore,
		profile.ConfidenceLevel, profile.FeatureVector, profile.BehavioralPatterns,
		profile.TotalReports, profile.SuccessfulBlocks, profile.FalsePositiveCount,
		profile.FirstReported, profile.LastActivity, profile.LastUpdated, profile.CreatedAt,
	).Scan(&profile.ID, &profile.FirstReported, &profile.CreatedAt)

	if err != nil {
		r.logger.Error("failed to create or update spam profile",
			zap.Error(err),
			zap.String("phone_hash", phoneHash))
		return nil, fmt.Errorf("failed to create or update spam profile: %w", err)
	}

	return profile, nil
}

// UpdateRiskScore updates the risk score and confidence level of a spam profile
func (r *SpamProfileRepository) UpdateRiskScore(ctx context.Context, phoneNumber string, riskScore, confidenceLevel float64) error {
	phoneHash := r.hashPhoneNumber(phoneNumber)
	
	query := `
		UPDATE spam_profiles
		SET risk_score = $2,
		    confidence_level = $3,
		    last_updated = NOW()
		WHERE phone_hash = $1`

	result, err := r.db.Exec(ctx, query, phoneHash, riskScore, confidenceLevel)
	if err != nil {
		r.logger.Error("failed to update spam profile risk score",
			zap.Error(err),
			zap.String("phone_hash", phoneHash))
		return fmt.Errorf("failed to update spam profile risk score: %w", err)
	}

	if result.RowsAffected() == 0 {
		return fmt.Errorf("spam profile not found for phone hash: %s", phoneHash)
	}

	return nil
}

// IncrementSuccessfulBlocks increments the successful blocks counter
func (r *SpamProfileRepository) IncrementSuccessfulBlocks(ctx context.Context, phoneNumber string) error {
	phoneHash := r.hashPhoneNumber(phoneNumber)
	
	query := `
		UPDATE spam_profiles
		SET successful_blocks = successful_blocks + 1,
		    last_activity = NOW(),
		    last_updated = NOW()
		WHERE phone_hash = $1`

	_, err := r.db.Exec(ctx, query, phoneHash)
	if err != nil {
		r.logger.Error("failed to increment successful blocks",
			zap.Error(err),
			zap.String("phone_hash", phoneHash))
		return fmt.Errorf("failed to increment successful blocks: %w", err)
	}

	return nil
}

// IncrementFalsePositives increments the false positive counter
func (r *SpamProfileRepository) IncrementFalsePositives(ctx context.Context, phoneNumber string) error {
	phoneHash := r.hashPhoneNumber(phoneNumber)
	
	query := `
		UPDATE spam_profiles
		SET false_positive_count = false_positive_count + 1,
		    last_activity = NOW(),
		    last_updated = NOW()
		WHERE phone_hash = $1`

	_, err := r.db.Exec(ctx, query, phoneHash)
	if err != nil {
		r.logger.Error("failed to increment false positives",
			zap.Error(err),
			zap.String("phone_hash", phoneHash))
		return fmt.Errorf("failed to increment false positives: %w", err)
	}

	return nil
}

// GetTopSpamCategories retrieves the top spam categories by frequency
func (r *SpamProfileRepository) GetTopSpamCategories(ctx context.Context, limit int) ([]struct {
	Category string  `json:"category"`
	Count    int64   `json:"count"`
	AvgRisk  float64 `json:"avg_risk"`
}, error) {
	query := `
		SELECT spam_category, COUNT(*) as count, AVG(risk_score) as avg_risk
		FROM spam_profiles
		WHERE last_activity > NOW() - INTERVAL '30 days'
		GROUP BY spam_category
		ORDER BY count DESC
		LIMIT $1`

	rows, err := r.db.Query(ctx, query, limit)
	if err != nil {
		r.logger.Error("failed to get top spam categories", zap.Error(err))
		return nil, fmt.Errorf("failed to get top spam categories: %w", err)
	}
	defer rows.Close()

	var categories []struct {
		Category string  `json:"category"`
		Count    int64   `json:"count"`
		AvgRisk  float64 `json:"avg_risk"`
	}

	for rows.Next() {
		var cat struct {
			Category string  `json:"category"`
			Count    int64   `json:"count"`
			AvgRisk  float64 `json:"avg_risk"`
		}
		err := rows.Scan(&cat.Category, &cat.Count, &cat.AvgRisk)
		if err != nil {
			r.logger.Error("failed to scan spam category", zap.Error(err))
			return nil, fmt.Errorf("failed to scan spam category: %w", err)
		}
		categories = append(categories, cat)
	}

	return categories, nil
}

// CleanupInactive removes inactive spam profiles older than the specified duration
func (r *SpamProfileRepository) CleanupInactive(ctx context.Context, inactiveDuration time.Duration, batchSize int) (int, error) {
	query := `
		DELETE FROM spam_profiles
		WHERE last_activity < $1
		  AND total_reports <= 3  -- Only cleanup profiles with few reports
		LIMIT $2`

	cutoffTime := time.Now().Add(-inactiveDuration)
	result, err := r.db.Exec(ctx, query, cutoffTime, batchSize)
	if err != nil {
		r.logger.Error("failed to cleanup inactive spam profiles", zap.Error(err))
		return 0, fmt.Errorf("failed to cleanup inactive spam profiles: %w", err)
	}

	count := int(result.RowsAffected())
	if count > 0 {
		r.logger.Info("cleaned up inactive spam profiles", 
			zap.Int("count", count),
			zap.Duration("inactive_duration", inactiveDuration))
	}

	return count, nil
}