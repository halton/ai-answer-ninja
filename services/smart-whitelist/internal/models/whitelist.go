package models

import (
	"time"

	"github.com/google/uuid"
)

// WhitelistType represents the type of whitelist entry
type WhitelistType string

const (
	WhitelistTypeManual    WhitelistType = "manual"
	WhitelistTypeAuto      WhitelistType = "auto"
	WhitelistTypeTemporary WhitelistType = "temporary"
	WhitelistTypeLearned   WhitelistType = "learned"
)

// SmartWhitelist represents a whitelist entry
type SmartWhitelist struct {
	ID             uuid.UUID      `json:"id" db:"id"`
	UserID         uuid.UUID      `json:"user_id" db:"user_id"`
	ContactPhone   string         `json:"contact_phone" db:"contact_phone"`
	ContactName    *string        `json:"contact_name,omitempty" db:"contact_name"`
	WhitelistType  WhitelistType  `json:"whitelist_type" db:"whitelist_type"`
	ConfidenceScore float64       `json:"confidence_score" db:"confidence_score"`
	IsActive       bool           `json:"is_active" db:"is_active"`
	ExpiresAt      *time.Time     `json:"expires_at,omitempty" db:"expires_at"`
	HitCount       int64          `json:"hit_count" db:"hit_count"`
	LastHitAt      *time.Time     `json:"last_hit_at,omitempty" db:"last_hit_at"`
	CreatedAt      time.Time      `json:"created_at" db:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at" db:"updated_at"`
}

// IsExpired checks if the whitelist entry has expired
func (w *SmartWhitelist) IsExpired() bool {
	if w.ExpiresAt == nil {
		return false
	}
	return time.Now().After(*w.ExpiresAt)
}

// IsValid checks if the whitelist entry is valid (active and not expired)
func (w *SmartWhitelist) IsValid() bool {
	return w.IsActive && !w.IsExpired()
}

// WhitelistQuery represents query parameters for whitelist lookup
type WhitelistQuery struct {
	UserID         *uuid.UUID     `json:"user_id,omitempty"`
	ContactPhone   *string        `json:"contact_phone,omitempty"`
	WhitelistType  *WhitelistType `json:"whitelist_type,omitempty"`
	IsActive       *bool          `json:"is_active,omitempty"`
	IncludeExpired bool           `json:"include_expired,omitempty"`
	Limit          int            `json:"limit,omitempty"`
	Offset         int            `json:"offset,omitempty"`
}

// CreateWhitelistRequest represents a request to create a new whitelist entry
type CreateWhitelistRequest struct {
	UserID          uuid.UUID      `json:"user_id" binding:"required"`
	ContactPhone    string         `json:"contact_phone" binding:"required"`
	ContactName     *string        `json:"contact_name,omitempty"`
	WhitelistType   WhitelistType  `json:"whitelist_type" binding:"required"`
	ConfidenceScore *float64       `json:"confidence_score,omitempty"`
	ExpiresAt       *time.Time     `json:"expires_at,omitempty"`
}

// UpdateWhitelistRequest represents a request to update a whitelist entry
type UpdateWhitelistRequest struct {
	ContactName     *string    `json:"contact_name,omitempty"`
	WhitelistType   *WhitelistType `json:"whitelist_type,omitempty"`
	ConfidenceScore *float64   `json:"confidence_score,omitempty"`
	IsActive        *bool      `json:"is_active,omitempty"`
	ExpiresAt       *time.Time `json:"expires_at,omitempty"`
}

// BatchCreateRequest represents a batch create request
type BatchCreateRequest struct {
	UserID   uuid.UUID                `json:"user_id" binding:"required"`
	Entries  []CreateWhitelistRequest `json:"entries" binding:"required,min=1,max=1000"`
}

// BatchUpdateRequest represents a batch update request
type BatchUpdateRequest struct {
	Updates []struct {
		ID      uuid.UUID              `json:"id" binding:"required"`
		Updates UpdateWhitelistRequest `json:"updates"`
	} `json:"updates" binding:"required,min=1,max=1000"`
}

// WhitelistStats represents statistics for whitelist entries
type WhitelistStats struct {
	UserID         uuid.UUID `json:"user_id"`
	TotalEntries   int64     `json:"total_entries"`
	ActiveEntries  int64     `json:"active_entries"`
	ExpiredEntries int64     `json:"expired_entries"`
	ManualEntries  int64     `json:"manual_entries"`
	AutoEntries    int64     `json:"auto_entries"`
	LearnedEntries int64     `json:"learned_entries"`
	TempEntries    int64     `json:"temp_entries"`
	TotalHits      int64     `json:"total_hits"`
	LastUpdated    time.Time `json:"last_updated"`
}

// WhitelistLookupResult represents the result of a whitelist lookup
type WhitelistLookupResult struct {
	Found           bool           `json:"found"`
	Entry           *SmartWhitelist `json:"entry,omitempty"`
	CacheHit        bool           `json:"cache_hit"`
	LookupDuration  time.Duration  `json:"lookup_duration"`
	RecommendAction string         `json:"recommend_action"` // "allow", "block", "analyze"
}

// User represents a user entity (simplified for whitelist operations)
type User struct {
	ID          uuid.UUID  `json:"id" db:"id"`
	PhoneNumber string     `json:"phone_number" db:"phone_number"`
	Name        string     `json:"name" db:"name"`
	Personality string     `json:"personality" db:"personality"`
	CreatedAt   time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at" db:"updated_at"`
}

// SpamProfile represents a spam profile (for ML classification)
type SpamProfile struct {
	ID                uuid.UUID              `json:"id" db:"id"`
	PhoneHash         string                 `json:"phone_hash" db:"phone_hash"`
	SpamCategory      string                 `json:"spam_category" db:"spam_category"`
	RiskScore         float64                `json:"risk_score" db:"risk_score"`
	ConfidenceLevel   float64                `json:"confidence_level" db:"confidence_level"`
	FeatureVector     map[string]interface{} `json:"feature_vector" db:"feature_vector"`
	BehavioralPatterns map[string]interface{} `json:"behavioral_patterns" db:"behavioral_patterns"`
	TotalReports      int64                  `json:"total_reports" db:"total_reports"`
	SuccessfulBlocks  int64                  `json:"successful_blocks" db:"successful_blocks"`
	FalsePositiveCount int64                 `json:"false_positive_count" db:"false_positive_count"`
	FirstReported     time.Time              `json:"first_reported" db:"first_reported"`
	LastActivity      time.Time              `json:"last_activity" db:"last_activity"`
	LastUpdated       time.Time              `json:"last_updated" db:"last_updated"`
	CreatedAt         time.Time              `json:"created_at" db:"created_at"`
}

// SmartAddRequest represents a request to add a phone to whitelist intelligently
type SmartAddRequest struct {
	UserID       uuid.UUID `json:"user_id" binding:"required"`
	ContactPhone string    `json:"contact_phone" binding:"required"`
	ContactName  string    `json:"contact_name"`
	Context      string    `json:"context"` // call context that triggered this
	Confidence   float64   `json:"confidence"`
	Tags         []string  `json:"tags"`
}

// EvaluationRequest represents a phone number evaluation request
type EvaluationRequest struct {
	Phone   string            `json:"phone" binding:"required"`
	UserID  uuid.UUID         `json:"user_id"`
	Context map[string]interface{} `json:"context"`
}

// EvaluationResult represents the result of phone number evaluation
type EvaluationResult struct {
	Phone           string             `json:"phone"`
	IsWhitelisted   bool               `json:"is_whitelisted"`
	ConfidenceScore float64            `json:"confidence_score"`
	Classification  string             `json:"classification"`
	RiskScore       float64            `json:"risk_score"`
	Recommendation  string             `json:"recommendation"`
	Reasons         []string           `json:"reasons"`
	MLFeatures      map[string]float64 `json:"ml_features,omitempty"`
	ProcessingTime  time.Duration      `json:"processing_time_ms"`
}

// LearningEvent represents a learning event for ML training
type LearningEvent struct {
	ID              uuid.UUID         `json:"id"`
	UserID          uuid.UUID         `json:"user_id"`
	Phone           string            `json:"phone"`
	EventType       string            `json:"event_type"` // "accept", "reject", "timeout"
	ActualOutcome   string            `json:"actual_outcome"`
	PredictedOutcome string           `json:"predicted_outcome"`
	Confidence      float64           `json:"confidence"`
	Features        map[string]float64 `json:"features"`
	Feedback        string            `json:"feedback"`
	Timestamp       time.Time         `json:"timestamp"`
}

// UserInteractionStats represents user interaction statistics for ML optimization
type UserInteractionStats struct {
	UserID              uuid.UUID `json:"user_id"`
	TotalCalls          int       `json:"total_calls"`
	WhitelistedCalls    int       `json:"whitelisted_calls"`
	BlockedCalls        int       `json:"blocked_calls"`
	MLAccuracy          float64   `json:"ml_accuracy"`
	FalsePositiveRate   float64   `json:"false_positive_rate"`
	FalseNegativeRate   float64   `json:"false_negative_rate"`
	LastLearningUpdate  *time.Time `json:"last_learning_update"`
}