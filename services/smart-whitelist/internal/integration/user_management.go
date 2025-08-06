package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"smart-whitelist/internal/config"
	"smart-whitelist/internal/models"
)

// UserManagementClient provides integration with the user management service
type UserManagementClient struct {
	baseURL    string
	httpClient *http.Client
	logger     *zap.Logger
	apiKey     string
}

// UserProfile represents extended user profile information
type UserProfile struct {
	ID              uuid.UUID              `json:"id"`
	PhoneNumber     string                 `json:"phone_number"`
	Name            string                 `json:"name"`
	Email           string                 `json:"email,omitempty"`
	Personality     string                 `json:"personality"`
	VoiceProfileID  string                 `json:"voice_profile_id,omitempty"`
	Preferences     map[string]interface{} `json:"preferences"`
	Settings        *UserSettings          `json:"settings,omitempty"`
	Subscription    *SubscriptionInfo      `json:"subscription,omitempty"`
	CreatedAt       time.Time              `json:"created_at"`
	UpdatedAt       time.Time              `json:"updated_at"`
	LastActiveAt    *time.Time             `json:"last_active_at,omitempty"`
	Status          string                 `json:"status"` // "active", "inactive", "suspended"
}

// UserSettings represents user-specific settings
type UserSettings struct {
	AutoWhitelistContacts    bool               `json:"auto_whitelist_contacts"`
	WhitelistConfidenceLevel float64            `json:"whitelist_confidence_level"`
	BlockUnknownNumbers      bool               `json:"block_unknown_numbers"`
	NotificationSettings     *NotificationSettings `json:"notification_settings,omitempty"`
	PrivacySettings          *PrivacySettings   `json:"privacy_settings,omitempty"`
	MLSettings               *MLSettings        `json:"ml_settings,omitempty"`
}

// NotificationSettings represents notification preferences
type NotificationSettings struct {
	EmailNotifications    bool `json:"email_notifications"`
	SMSNotifications     bool `json:"sms_notifications"`
	PushNotifications    bool `json:"push_notifications"`
	WeeklyReport         bool `json:"weekly_report"`
	SecurityAlerts       bool `json:"security_alerts"`
}

// PrivacySettings represents privacy preferences
type PrivacySettings struct {
	DataRetentionDays     int  `json:"data_retention_days"`
	ShareDataForML        bool `json:"share_data_for_ml"`
	AnonymizeExports      bool `json:"anonymize_exports"`
	AllowDataAnalytics    bool `json:"allow_data_analytics"`
}

// MLSettings represents ML-specific settings
type MLSettings struct {
	EnableMLClassification   bool    `json:"enable_ml_classification"`
	ConfidenceThreshold      float64 `json:"confidence_threshold"`
	AutoLearnFromBehavior    bool    `json:"auto_learn_from_behavior"`
	PersonalizedRules        bool    `json:"personalized_rules"`
}

// SubscriptionInfo represents subscription information
type SubscriptionInfo struct {
	PlanID      string    `json:"plan_id"`
	PlanName    string    `json:"plan_name"`
	Status      string    `json:"status"` // "active", "expired", "cancelled"
	ExpiresAt   time.Time `json:"expires_at"`
	Features    []string  `json:"features"`
	Limits      map[string]int `json:"limits"`
}

// UserActivityRequest represents a request to log user activity
type UserActivityRequest struct {
	UserID      uuid.UUID              `json:"user_id"`
	ActivityType string                `json:"activity_type"`
	Description  string                `json:"description"`
	Metadata     map[string]interface{} `json:"metadata,omitempty"`
	Timestamp    time.Time              `json:"timestamp"`
}

// UserStatsResponse represents user statistics from the user management service
type UserStatsResponse struct {
	UserID              uuid.UUID `json:"user_id"`
	TotalLogins         int64     `json:"total_logins"`
	LastLogin           time.Time `json:"last_login"`
	TotalWhitelistUsage int64     `json:"total_whitelist_usage"`
	AccountAge          int64     `json:"account_age_days"`
	SubscriptionDays    int64     `json:"subscription_days_remaining"`
}

// NewUserManagementClient creates a new user management client
func NewUserManagementClient(config *config.Config, logger *zap.Logger) *UserManagementClient {
	return &UserManagementClient{
		baseURL: config.Integration.UserManagementURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		logger: logger,
		apiKey: config.Integration.UserManagementAPIKey,
	}
}

// GetUserProfile retrieves extended user profile information
func (c *UserManagementClient) GetUserProfile(ctx context.Context, userID uuid.UUID) (*UserProfile, error) {
	url := fmt.Sprintf("%s/api/v1/users/%s/profile", c.baseURL, userID.String())
	
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("user not found: %s", userID.String())
	}
	
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}
	
	var profile UserProfile
	if err := json.NewDecoder(resp.Body).Decode(&profile); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}
	
	c.logger.Debug("user profile retrieved",
		zap.String("user_id", userID.String()),
		zap.String("personality", profile.Personality))
	
	return &profile, nil
}

// UpdateUserSettings updates user settings
func (c *UserManagementClient) UpdateUserSettings(ctx context.Context, userID uuid.UUID, settings *UserSettings) error {
	url := fmt.Sprintf("%s/api/v1/users/%s/settings", c.baseURL, userID.String())
	
	payload, err := json.Marshal(settings)
	if err != nil {
		return fmt.Errorf("failed to marshal settings: %w", err)
	}
	
	req, err := http.NewRequestWithContext(ctx, "PUT", url, 
		func() *http.Request {
			r, _ := http.NewRequestWithContext(ctx, "PUT", url, nil)
			return r
		}().Body)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}
	
	c.logger.Info("user settings updated",
		zap.String("user_id", userID.String()))
	
	return nil
}

// LogUserActivity logs user activity to the user management service
func (c *UserManagementClient) LogUserActivity(ctx context.Context, request *UserActivityRequest) error {
	url := fmt.Sprintf("%s/api/v1/users/activity", c.baseURL)
	
	payload, err := json.Marshal(request)
	if err != nil {
		return fmt.Errorf("failed to marshal activity: %w", err)
	}
	
	req, err := http.NewRequestWithContext(ctx, "POST", url, 
		func() *http.Request {
			r, _ := http.NewRequestWithContext(ctx, "POST", url, nil)
			return r
		}().Body)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}
	
	return nil
}

// GetUserStats retrieves user statistics
func (c *UserManagementClient) GetUserStats(ctx context.Context, userID uuid.UUID) (*UserStatsResponse, error) {
	url := fmt.Sprintf("%s/api/v1/users/%s/stats", c.baseURL, userID.String())
	
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}
	
	var stats UserStatsResponse
	if err := json.NewDecoder(resp.Body).Decode(&stats); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}
	
	return &stats, nil
}

// ValidateUserAccess validates if a user has access to specific features
func (c *UserManagementClient) ValidateUserAccess(ctx context.Context, userID uuid.UUID, feature string) (bool, error) {
	url := fmt.Sprintf("%s/api/v1/users/%s/access/%s", c.baseURL, userID.String(), feature)
	
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return false, fmt.Errorf("failed to create request: %w", err)
	}
	
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()
	
	switch resp.StatusCode {
	case http.StatusOK:
		return true, nil
	case http.StatusForbidden:
		return false, nil
	default:
		return false, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}
}

// NotifyUserEvent notifies the user management service about important events
func (c *UserManagementClient) NotifyUserEvent(ctx context.Context, userID uuid.UUID, eventType, message string, metadata map[string]interface{}) error {
	url := fmt.Sprintf("%s/api/v1/users/%s/notifications", c.baseURL, userID.String())
	
	payload := map[string]interface{}{
		"event_type": eventType,
		"message":    message,
		"metadata":   metadata,
		"timestamp":  time.Now(),
		"source":     "smart-whitelist",
	}
	
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal notification: %w", err)
	}
	
	req, err := http.NewRequestWithContext(ctx, "POST", url,
		func() *http.Request {
			r, _ := http.NewRequestWithContext(ctx, "POST", url, nil)
			return r
		}().Body)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	
	resp, err := c.httpClient.Do(req)
	if err != nil {
		// Log error but don't fail the operation
		c.logger.Warn("failed to notify user management service",
			zap.Error(err),
			zap.String("user_id", userID.String()),
			zap.String("event_type", eventType))
		return nil
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
		c.logger.Warn("unexpected response from user management service",
			zap.Int("status_code", resp.StatusCode),
			zap.String("user_id", userID.String()),
			zap.String("event_type", eventType))
	}
	
	return nil
}

// HealthCheck checks the health of the user management service
func (c *UserManagementClient) HealthCheck(ctx context.Context) error {
	url := fmt.Sprintf("%s/health", c.baseURL)
	
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("health check failed: %w", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("user management service unhealthy: status %d", resp.StatusCode)
	}
	
	return nil
}

// Close closes the client
func (c *UserManagementClient) Close() error {
	c.httpClient.CloseIdleConnections()
	return nil
}