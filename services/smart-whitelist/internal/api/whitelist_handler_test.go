package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"go.uber.org/zap"

	"smart-whitelist/internal/models"
)

// MockWhitelistService is a mock implementation of the whitelist service
type MockWhitelistService struct {
	mock.Mock
}

func (m *MockWhitelistService) EvaluatePhone(ctx interface{}, req *models.EvaluationRequest) (*models.EvaluationResult, error) {
	args := m.Called(ctx, req)
	return args.Get(0).(*models.EvaluationResult), args.Error(1)
}

func (m *MockWhitelistService) SmartAdd(ctx interface{}, req *models.SmartAddRequest) (*models.SmartWhitelist, error) {
	args := m.Called(ctx, req)
	return args.Get(0).(*models.SmartWhitelist), args.Error(1)
}

func (m *MockWhitelistService) RecordLearning(ctx interface{}, event *models.LearningEvent) error {
	args := m.Called(ctx, event)
	return args.Error(0)
}

func (m *MockWhitelistService) UpdateUserRules(ctx interface{}, userID uuid.UUID, rules map[string]interface{}) error {
	args := m.Called(ctx, userID, rules)
	return args.Error(0)
}

func (m *MockWhitelistService) GetLearningStats(userID uuid.UUID) interface{} {
	args := m.Called(userID)
	return args.Get(0)
}

// MockCacheService is a mock implementation of the cache service
type MockCacheService struct {
	mock.Mock
}

func (m *MockCacheService) GetWhitelist(ctx interface{}, userID uuid.UUID, phone string) (*models.SmartWhitelist, error) {
	args := m.Called(ctx, userID, phone)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.SmartWhitelist), args.Error(1)
}

func (m *MockCacheService) DeleteWhitelist(ctx interface{}, id uuid.UUID) error {
	args := m.Called(ctx, id)
	return args.Error(0)
}

func (m *MockCacheService) GetStats(ctx interface{}, userID uuid.UUID) (*models.WhitelistStats, error) {
	args := m.Called(ctx, userID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*models.WhitelistStats), args.Error(1)
}

func setupTestHandler() (*WhitelistHandler, *MockWhitelistService, *MockCacheService) {
	mockWhitelistService := &MockWhitelistService{}
	mockCacheService := &MockCacheService{}
	logger := zap.NewNop()

	handler := &WhitelistHandler{
		whitelistService: mockWhitelistService,
		cacheService:     mockCacheService,
		logger:           logger,
	}

	return handler, mockWhitelistService, mockCacheService
}

func TestEvaluatePhone(t *testing.T) {
	handler, mockWhitelistService, _ := setupTestHandler()

	// Set up mock expectations
	expectedResult := &models.EvaluationResult{
		Phone:           "+1234567890",
		IsWhitelisted:   false,
		ConfidenceScore: 0.85,
		Classification:  "legitimate",
		Recommendation:  "allow",
		Reasons:         []string{"Classified as legitimate"},
		ProcessingTime:  time.Millisecond * 50,
	}

	mockWhitelistService.On("EvaluatePhone", mock.Anything, mock.AnythingOfType("*models.EvaluationRequest")).
		Return(expectedResult, nil)

	// Create test request
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/api/v1/whitelist/evaluate/:phone", handler.EvaluatePhone)

	// Perform request
	req, _ := http.NewRequest("GET", "/api/v1/whitelist/evaluate/+1234567890?user_id="+uuid.New().String(), nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Assert response
	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(t, err)

	result := response["result"].(map[string]interface{})
	assert.Equal(t, "+1234567890", result["phone"])
	assert.Equal(t, false, result["is_whitelisted"])
	assert.Equal(t, "legitimate", result["classification"])
	assert.Equal(t, "allow", result["recommendation"])

	mockWhitelistService.AssertExpectations(t)
}

func TestSmartAdd(t *testing.T) {
	handler, mockWhitelistService, _ := setupTestHandler()

	userID := uuid.New()
	expectedEntry := &models.SmartWhitelist{
		ID:              uuid.New(),
		UserID:          userID,
		ContactPhone:    "+1234567890",
		ContactName:     stringPtr("John Doe"),
		WhitelistType:   models.WhitelistTypeManual,
		ConfidenceScore: 0.9,
		IsActive:        true,
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
	}

	mockWhitelistService.On("SmartAdd", mock.Anything, mock.AnythingOfType("*models.SmartAddRequest")).
		Return(expectedEntry, nil)

	// Create test request
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/api/v1/whitelist/:userId/smart-add", handler.SmartAdd)

	requestBody := models.SmartAddRequest{
		ContactPhone: "+1234567890",
		ContactName:  "John Doe",
		Context:      "manual_add",
		Confidence:   0.9,
	}

	jsonBody, _ := json.Marshal(requestBody)
	req, _ := http.NewRequest("POST", "/api/v1/whitelist/"+userID.String()+"/smart-add", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Assert response
	assert.Equal(t, http.StatusCreated, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(t, err)

	entry := response["entry"].(map[string]interface{})
	assert.Equal(t, "+1234567890", entry["contact_phone"])
	assert.Equal(t, "John Doe", entry["contact_name"])
	assert.Equal(t, "manual", entry["whitelist_type"])

	mockWhitelistService.AssertExpectations(t)
}

func TestGetStats(t *testing.T) {
	handler, mockWhitelistService, mockCacheService := setupTestHandler()

	userID := uuid.New()
	expectedWhitelistStats := &models.WhitelistStats{
		UserID:         userID,
		TotalEntries:   10,
		ActiveEntries:  8,
		ExpiredEntries: 2,
		ManualEntries:  5,
		AutoEntries:    3,
		LearnedEntries: 2,
		TotalHits:      25,
		LastUpdated:    time.Now(),
	}

	expectedLearningStats := map[string]interface{}{
		"user_id":         userID.String(),
		"total_events":    50,
		"acceptance_rate": 0.8,
		"ml_accuracy":     0.85,
	}

	mockCacheService.On("GetStats", mock.Anything, userID).Return(expectedWhitelistStats, nil)
	mockWhitelistService.On("GetLearningStats", userID).Return(expectedLearningStats)

	// Create test request
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/api/v1/whitelist/stats/:userId", handler.GetStats)

	req, _ := http.NewRequest("GET", "/api/v1/whitelist/stats/"+userID.String(), nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Assert response
	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(t, err)

	whitelist := response["whitelist"].(map[string]interface{})
	assert.Equal(t, float64(10), whitelist["total_entries"])
	assert.Equal(t, float64(8), whitelist["active_entries"])

	learning := response["learning"].(map[string]interface{})
	assert.Equal(t, float64(50), learning["total_events"])
	assert.Equal(t, 0.8, learning["acceptance_rate"])

	mockCacheService.AssertExpectations(t)
	mockWhitelistService.AssertExpectations(t)
}

func TestRecordLearning(t *testing.T) {
	handler, mockWhitelistService, _ := setupTestHandler()

	mockWhitelistService.On("RecordLearning", mock.Anything, mock.AnythingOfType("*models.LearningEvent")).
		Return(nil)

	// Create test request
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/api/v1/whitelist/learning", handler.RecordLearning)

	requestBody := models.LearningEvent{
		UserID:    uuid.New(),
		Phone:     "+1234567890",
		EventType: "accept",
		Confidence: 0.9,
	}

	jsonBody, _ := json.Marshal(requestBody)
	req, _ := http.NewRequest("POST", "/api/v1/whitelist/learning", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Assert response
	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	assert.NoError(t, err)

	assert.Equal(t, "Learning event recorded successfully", response["message"])

	mockWhitelistService.AssertExpectations(t)
}

// Helper function
func stringPtr(s string) *string {
	return &s
}