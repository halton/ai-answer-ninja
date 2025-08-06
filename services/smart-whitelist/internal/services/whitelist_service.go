package services

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"smart-whitelist/internal/cache"
	"smart-whitelist/internal/config"
	"smart-whitelist/internal/ml"
	"smart-whitelist/internal/models"
	"smart-whitelist/internal/repository"
)

// SmartWhitelistService provides intelligent whitelist management with ML capabilities
type SmartWhitelistService struct {
	config          *config.Config
	logger          *zap.Logger
	cacheService    *cache.CacheService
	classifier      *ml.ContactClassifier
	whitelistRepo   *repository.WhitelistRepository
	spamProfileRepo *repository.SpamProfileRepository
	userRepo        *repository.UserRepository

	// Learning components
	learningQueue   chan *LearningEvent
	learningWorkers int
	mu              sync.RWMutex
	learningStats   map[uuid.UUID]*UserLearningStats
}

// LearningEvent represents a learning event for the ML system
type LearningEvent struct {
	UserID          uuid.UUID
	Phone           string
	EventType       string // "accept", "reject", "timeout", "manual_add"
	Context         map[string]interface{}
	Confidence      float64
	Timestamp       time.Time
	ProcessedResult *models.EvaluationResult
}

// UserLearningStats tracks learning statistics for each user
type UserLearningStats struct {
	UserID           uuid.UUID
	TotalEvents      int
	AcceptanceRate   float64
	RejectionRate    float64
	TimeoutRate      float64
	MLAccuracy       float64
	LastLearningTime time.Time
}


// EvaluatePhone performs intelligent phone number evaluation
func (s *SmartWhitelistService) EvaluatePhone(ctx context.Context, req *models.EvaluationRequest) (*models.EvaluationResult, error) {
	start := time.Now()
	defer func() {
		s.logger.Debug("phone evaluation completed",
			zap.Duration("duration", time.Since(start)),
			zap.String("phone", req.Phone[:4]+"****")) // Log partial number for privacy
	}()

	result := &models.EvaluationResult{
		Phone:          req.Phone,
		ProcessingTime: 0,
	}

	// First, check if it's already whitelisted (ultra-fast cache lookup)
	if req.UserID != uuid.Nil {
		lookupResult, err := s.cacheService.FastWhitelistLookup(ctx, req.UserID, req.Phone)
		if err != nil {
			s.logger.Warn("whitelist lookup failed", zap.Error(err))
		} else if lookupResult != nil && lookupResult.Found {
			result.IsWhitelisted = true
			result.ConfidenceScore = 1.0
			result.Classification = "whitelisted"
			result.Recommendation = "allow"
			result.Reasons = []string{"Phone number is in user's whitelist"}
			result.ProcessingTime = time.Since(start)
			return result, nil
		}
	}

	// ML-based classification
	classificationResult, err := s.classifier.ClassifyContact(ctx, req.Phone, req.Context)
	if err != nil {
		s.logger.Error("ML classification failed", zap.Error(err))
		// Fallback to conservative approach
		result.IsWhitelisted = false
		result.ConfidenceScore = 0.5
		result.Classification = "unknown"
		result.Recommendation = "analyze"
		result.Reasons = []string{"Classification failed, manual review recommended"}
		result.ProcessingTime = time.Since(start)
		return result, nil
	}

	// Build evaluation result
	result.IsWhitelisted = false
	result.ConfidenceScore = classificationResult.Confidence
	result.RiskScore = 1.0 - classificationResult.Confidence
	result.MLFeatures = classificationResult.Features

	if classificationResult.IsSpam {
		result.Classification = "spam_" + classificationResult.SpamType
		result.Recommendation = "block"
		result.Reasons = []string{"Classified as spam: " + classificationResult.Reasoning}
	} else {
		result.Classification = "legitimate"
		result.Recommendation = s.determineRecommendation(classificationResult)
		result.Reasons = []string{"Classified as legitimate: " + classificationResult.Reasoning}
	}

	result.ProcessingTime = time.Since(start)

	// Asynchronously record this evaluation for learning
	go s.recordEvaluation(req, result)

	return result, nil
}

// SmartAdd intelligently adds a phone number to whitelist with ML assistance
func (s *SmartWhitelistService) SmartAdd(ctx context.Context, req *models.SmartAddRequest) (*models.SmartWhitelist, error) {
	// First evaluate the phone number to get ML insights
	evalReq := &models.EvaluationRequest{
		Phone:   req.ContactPhone,
		UserID:  req.UserID,
		Context: map[string]interface{}{"context": req.Context},
	}

	evaluation, err := s.EvaluatePhone(ctx, evalReq)
	if err != nil {
		s.logger.Warn("evaluation failed during smart add", zap.Error(err))
	}

	// Determine whitelist type and confidence based on ML evaluation
	whitelistType := models.WhitelistTypeManual
	confidence := req.Confidence

	if evaluation != nil {
		if evaluation.Classification == "legitimate" && evaluation.ConfidenceScore > s.config.ML.AutoLearnThreshold {
			whitelistType = models.WhitelistTypeAuto
			confidence = evaluation.ConfidenceScore
		} else if req.Context == "user_interaction" {
			whitelistType = models.WhitelistTypeLearned
		}
	}

	// Create whitelist entry
	createReq := &models.CreateWhitelistRequest{
		UserID:          req.UserID,
		ContactPhone:    req.ContactPhone,
		ContactName:     &req.ContactName,
		WhitelistType:   whitelistType,
		ConfidenceScore: &confidence,
	}

	entry, err := s.cacheService.CreateWhitelist(ctx, createReq)
	if err != nil {
		return nil, err
	}

	// Record learning event
	learningEvent := &LearningEvent{
		UserID:          req.UserID,
		Phone:           req.ContactPhone,
		EventType:       "manual_add",
		Context:         map[string]interface{}{"tags": req.Tags, "context": req.Context},
		Confidence:      confidence,
		Timestamp:       time.Now(),
		ProcessedResult: evaluation,
	}

	select {
	case s.learningQueue <- learningEvent:
	default:
		s.logger.Warn("learning queue full, dropping event")
	}

	s.logger.Info("phone number added to whitelist intelligently",
		zap.String("user_id", req.UserID.String()),
		zap.String("whitelist_type", string(whitelistType)),
		zap.Float64("confidence", confidence))

	return entry, nil
}

// RecordLearning records learning feedback from user interactions
func (s *SmartWhitelistService) RecordLearning(ctx context.Context, event *models.LearningEvent) error {
	learningEvent := &LearningEvent{
		UserID:    event.UserID,
		Phone:     event.Phone,
		EventType: event.EventType,
		Context:   map[string]interface{}{"features": event.Features, "feedback": event.Feedback},
		Confidence: event.Confidence,
		Timestamp: event.Timestamp,
	}

	select {
	case s.learningQueue <- learningEvent:
		s.logger.Debug("learning event queued",
			zap.String("user_id", event.UserID.String()),
			zap.String("event_type", event.EventType))
		return nil
	default:
		s.logger.Warn("learning queue full")
		return fmt.Errorf("learning queue is full")
	}
}

// GetLearningStats returns learning statistics for a user
func (s *SmartWhitelistService) GetLearningStats(userID uuid.UUID) *UserLearningStats {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if stats, exists := s.learningStats[userID]; exists {
		return stats
	}

	return &UserLearningStats{
		UserID:           userID,
		TotalEvents:      0,
		AcceptanceRate:   0.0,
		RejectionRate:    0.0,
		TimeoutRate:      0.0,
		MLAccuracy:       0.5,
		LastLearningTime: time.Time{},
	}
}

// UpdateUserRules updates user-specific whitelist rules
func (s *SmartWhitelistService) UpdateUserRules(ctx context.Context, userID uuid.UUID, rules map[string]interface{}) error {
	// Store user-specific rules (this would be persisted to database)
	s.logger.Info("user rules updated",
		zap.String("user_id", userID.String()),
		zap.Any("rules", rules))

	// Invalidate user cache to pick up new rules
	return s.cacheService.InvalidateUserCache(ctx, userID)
}

// startLearningWorkers starts background workers to process learning events
func (s *SmartWhitelistService) startLearningWorkers() {
	for i := 0; i < s.learningWorkers; i++ {
		go s.learningWorker(i)
	}
}

// learningWorker processes learning events in the background
func (s *SmartWhitelistService) learningWorker(workerID int) {
	s.logger.Info("learning worker started", zap.Int("worker_id", workerID))

	for event := range s.learningQueue {
		if err := s.processLearningEvent(event); err != nil {
			s.logger.Error("failed to process learning event",
				zap.Error(err),
				zap.Int("worker_id", workerID),
				zap.String("event_type", event.EventType))
		}
	}
}

// processLearningEvent processes a single learning event
func (s *SmartWhitelistService) processLearningEvent(event *LearningEvent) error {
	ctx := context.Background()

	// Update ML classifier
	isSpam := event.EventType == "reject"
	spamType := ""
	if isSpam && event.ProcessedResult != nil {
		spamType = event.ProcessedResult.Classification
	}

	err := s.classifier.LearnFromFeedback(
		event.Phone,
		isSpam,
		spamType,
		event.Confidence,
		event.Context,
	)
	if err != nil {
		s.logger.Error("ML learning failed", zap.Error(err))
	}

	// Update user learning statistics
	s.updateUserLearningStats(event)

	// Update spam profile if needed
	if isSpam {
		if err := s.updateSpamProfile(ctx, event); err != nil {
			s.logger.Error("failed to update spam profile", zap.Error(err))
		}
	}

	return nil
}

// updateUserLearningStats updates learning statistics for a user
func (s *SmartWhitelistService) updateUserLearningStats(event *LearningEvent) {
	s.mu.Lock()
	defer s.mu.Unlock()

	stats, exists := s.learningStats[event.UserID]
	if !exists {
		stats = &UserLearningStats{
			UserID: event.UserID,
		}
		s.learningStats[event.UserID] = stats
	}

	stats.TotalEvents++
	stats.LastLearningTime = event.Timestamp

	// Update rates (simple moving average)
	alpha := 0.1 // Learning rate
	switch event.EventType {
	case "accept":
		stats.AcceptanceRate = (1-alpha)*stats.AcceptanceRate + alpha*1.0
	case "reject":
		stats.RejectionRate = (1-alpha)*stats.RejectionRate + alpha*1.0
	case "timeout":
		stats.TimeoutRate = (1-alpha)*stats.TimeoutRate + alpha*1.0
	}

	// Update ML accuracy estimate
	if event.ProcessedResult != nil {
		predicted := event.ProcessedResult.IsWhitelisted
		actual := event.EventType == "accept"
		if predicted == actual {
			stats.MLAccuracy = (1-alpha)*stats.MLAccuracy + alpha*1.0
		} else {
			stats.MLAccuracy = (1-alpha)*stats.MLAccuracy + alpha*0.0
		}
	}
}

// updateSpamProfile updates or creates a spam profile
func (s *SmartWhitelistService) updateSpamProfile(ctx context.Context, event *LearningEvent) error {
	// Create or update spam profile
	phoneHash := s.hashPhone(event.Phone)
	
	profile, err := s.spamProfileRepo.GetByPhoneHash(ctx, phoneHash)
	if err != nil && err != repository.ErrNotFound {
		return err
	}

	if profile == nil {
		// Create new spam profile
		profile = &models.SpamProfile{
			PhoneHash:         phoneHash,
			SpamCategory:      "unknown",
			RiskScore:         event.Confidence,
			ConfidenceLevel:   event.Confidence,
			FeatureVector:     make(map[string]interface{}),
			BehavioralPatterns: make(map[string]interface{}),
			TotalReports:      1,
			FirstReported:     event.Timestamp,
			LastActivity:      event.Timestamp,
		}

		if event.ProcessedResult != nil {
			profile.SpamCategory = event.ProcessedResult.Classification
			for k, v := range event.ProcessedResult.MLFeatures {
				profile.FeatureVector[k] = v
			}
		}

		_, err = s.spamProfileRepo.Create(ctx, profile)
		return err
	}

	// Update existing profile
	profile.TotalReports++
	profile.LastActivity = event.Timestamp
	profile.RiskScore = (profile.RiskScore + event.Confidence) / 2.0

	return s.spamProfileRepo.Update(ctx, profile.ID, profile)
}

// determineRecommendation determines the recommendation based on classification
func (s *SmartWhitelistService) determineRecommendation(result *ml.ClassificationResult) string {
	if result.Confidence > s.config.ML.AutoLearnThreshold {
		return "auto_allow"
	}
	if result.Confidence > s.config.ML.ConfidenceThreshold {
		return "allow"
	}
	return "analyze"
}

// recordEvaluation records an evaluation for future analysis
func (s *SmartWhitelistService) recordEvaluation(req *models.EvaluationRequest, result *models.EvaluationResult) {
	// This would typically be stored in a separate evaluation log table
	s.logger.Debug("evaluation recorded",
		zap.String("phone_hash", s.hashPhone(req.Phone)),
		zap.String("classification", result.Classification),
		zap.Float64("confidence", result.ConfidenceScore))
}

// hashPhone creates a privacy-preserving hash of a phone number
func (s *SmartWhitelistService) hashPhone(phone string) string {
	// Use the same hashing as the ML classifier
	return s.classifier.hashPhoneNumber(phone)
}

// Close gracefully shuts down the service
func (s *SmartWhitelistService) Close() error {
	close(s.learningQueue)
	s.logger.Info("smart whitelist service closed")
	return nil
}