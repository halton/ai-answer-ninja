package ml

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"
	"gonum.org/v1/gonum/mat"

	"smart-whitelist/internal/config"
)

// ContactClassifier provides machine learning-based contact classification
type ContactClassifier struct {
	config *config.MLConfig
	logger *zap.Logger
	
	// Model state
	mu                sync.RWMutex
	featureWeights    *mat.VecDense
	spamPatterns      map[string]float64
	normalPatterns    map[string]float64
	trainingSamples   int
	lastModelUpdate   time.Time
	
	// Feature extraction
	featureExtractor *FeatureExtractor
}

// NewContactClassifier creates a new ML-based contact classifier
func NewContactClassifier(cfg *config.MLConfig, logger *zap.Logger) *ContactClassifier {
	classifier := &ContactClassifier{
		config:          cfg,
		logger:          logger,
		spamPatterns:    make(map[string]float64),
		normalPatterns:  make(map[string]float64),
		trainingSamples: 0,
		lastModelUpdate: time.Now(),
	}
	
	// Initialize feature extractor
	classifier.featureExtractor = NewFeatureExtractor(logger)
	
	// Initialize with basic patterns
	classifier.initializeBasicPatterns()
	
	// Initialize feature weights (simple linear model)
	classifier.featureWeights = mat.NewVecDense(20, nil) // 20 features
	classifier.initializeWeights()
	
	logger.Info("contact classifier initialized",
		zap.Bool("enabled", cfg.Enabled),
		zap.Float64("confidence_threshold", cfg.ConfidenceThreshold))
	
	return classifier
}

// ClassifyContact classifies a contact as spam or normal with confidence score
func (c *ContactClassifier) ClassifyContact(
	ctx context.Context,
	phoneNumber string,
	additionalInfo map[string]interface{},
) (*ClassificationResult, error) {
	if !c.config.Enabled {
		return &ClassificationResult{
			IsSpam:      false,
			Confidence:  0.5,
			SpamType:    "",
			Features:    make(map[string]float64),
			Reasoning:   "ML classification disabled",
		}, nil
	}
	
	start := time.Now()
	defer func() {
		c.logger.Debug("contact classification completed",
			zap.Duration("duration", time.Since(start)),
			zap.String("phone_number", c.HashPhoneNumber(phoneNumber)))
	}()
	
	// Extract features
	features := c.featureExtractor.ExtractFeatures(phoneNumber, additionalInfo)
	
	// Convert features to vector
	featureVector := c.featuresToVector(features)
	
	// Classify using the model
	result := c.classify(featureVector, features)
	result.PhoneHash = c.HashPhoneNumber(phoneNumber)
	result.ClassificationTime = time.Since(start)
	
	return result, nil
}

// ClassifyBatch classifies multiple contacts in parallel
func (c *ContactClassifier) ClassifyBatch(
	ctx context.Context,
	requests []ClassificationRequest,
) ([]*ClassificationResult, error) {
	if !c.config.Enabled {
		results := make([]*ClassificationResult, len(requests))
		for i := range results {
			results[i] = &ClassificationResult{
				IsSpam:      false,
				Confidence:  0.5,
				SpamType:    "",
				Features:    make(map[string]float64),
				Reasoning:   "ML classification disabled",
			}
		}
		return results, nil
	}
	
	start := time.Now()
	defer func() {
		c.logger.Debug("batch classification completed",
			zap.Duration("duration", time.Since(start)),
			zap.Int("count", len(requests)))
	}()
	
	results := make([]*ClassificationResult, len(requests))
	
	// Use worker pool for parallel processing
	workerCount := c.config.FeatureExtractionWorkers
	if workerCount <= 0 {
		workerCount = 4
	}
	
	jobs := make(chan int, len(requests))
	var wg sync.WaitGroup
	
	// Start workers
	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for idx := range jobs {
				req := requests[idx]
				result, err := c.ClassifyContact(ctx, req.PhoneNumber, req.AdditionalInfo)
				if err != nil {
					c.logger.Error("failed to classify contact in batch",
						zap.Error(err),
						zap.Int("index", idx))
					// Create error result
					result = &ClassificationResult{
						IsSpam:     false,
						Confidence: 0.0,
						Error:      err.Error(),
					}
				}
				results[idx] = result
			}
		}()
	}
	
	// Send jobs
	for i := range requests {
		jobs <- i
	}
	close(jobs)
	
	wg.Wait()
	
	return results, nil
}

// LearnFromFeedback updates the model based on user feedback
func (c *ContactClassifier) LearnFromFeedback(
	phoneNumber string,
	isSpam bool,
	spamType string,
	confidence float64,
	additionalInfo map[string]interface{},
) error {
	if !c.config.Enabled {
		return nil
	}
	
	c.mu.Lock()
	defer c.mu.Unlock()
	
	// Extract features for learning
	features := c.featureExtractor.ExtractFeatures(phoneNumber, additionalInfo)
	
	// Update pattern knowledge
	if isSpam {
		c.updateSpamPatterns(features, confidence)
	} else {
		c.updateNormalPatterns(features, confidence)
	}
	
	c.trainingSamples++
	
	// Trigger model update if we have enough samples
	if c.trainingSamples%c.config.MinTrainingSamples == 0 {
		c.updateModel()
	}
	
	c.logger.Debug("learned from feedback",
		zap.String("phone_hash", c.HashPhoneNumber(phoneNumber)),
		zap.Bool("is_spam", isSpam),
		zap.String("spam_type", spamType),
		zap.Float64("confidence", confidence),
		zap.Int("training_samples", c.trainingSamples))
	
	return nil
}

// GetModelStats returns statistics about the ML model
func (c *ContactClassifier) GetModelStats() ModelStats {
	c.mu.RLock()
	defer c.mu.RUnlock()
	
	return ModelStats{
		TrainingSamples:    c.trainingSamples,
		LastModelUpdate:    c.lastModelUpdate,
		SpamPatternsCount:  len(c.spamPatterns),
		NormalPatternsCount: len(c.normalPatterns),
		ModelAccuracy:      c.estimateAccuracy(),
		IsEnabled:          c.config.Enabled,
	}
}

// classify performs the actual classification using the trained model
func (c *ContactClassifier) classify(featureVector *mat.VecDense, features map[string]float64) *ClassificationResult {
	c.mu.RLock()
	defer c.mu.RUnlock()
	
	// Simple linear classification
	var score float64
	
	if c.featureWeights != nil && featureVector != nil {
		score = mat.Dot(c.featureWeights, featureVector)
	}
	
	// Apply sigmoid function to get probability
	probability := 1.0 / (1.0 + math.Exp(-score))
	
	// Determine spam type based on features
	spamType := c.determineSpamType(features)
	
	// Build reasoning
	reasoning := c.buildReasoning(features, score, probability)
	
	return &ClassificationResult{
		IsSpam:      probability > c.config.ConfidenceThreshold,
		Confidence:  probability,
		SpamType:    spamType,
		Features:    features,
		Reasoning:   reasoning,
		Score:       score,
	}
}

// initializeBasicPatterns sets up initial spam/normal patterns
func (c *ContactClassifier) initializeBasicPatterns() {
	// Common spam indicators
	spamPatterns := map[string]float64{
		"repeated_digits":    0.8,  // 1111, 2222, etc.
		"sequential_digits":  0.7,  // 1234, 5678, etc.
		"short_number":       0.6,  // Very short numbers
		"marketing_prefix":   0.9,  // Common marketing prefixes
		"call_frequency":     0.8,  // High call frequency
		"call_time_pattern":  0.7,  // Calls at odd hours
	}
	
	// Normal contact indicators
	normalPatterns := map[string]float64{
		"contact_book":       0.9,  // In user's contact book
		"long_conversation":  0.8,  // Long call duration
		"regular_caller":     0.7,  // Regular calling pattern
		"business_hours":     0.6,  // Calls during business hours
		"local_number":       0.5,  // Local area code
	}
	
	c.spamPatterns = spamPatterns
	c.normalPatterns = normalPatterns
}

// initializeWeights sets up initial feature weights
func (c *ContactClassifier) initializeWeights() {
	// Initialize with small random weights
	weights := make([]float64, 20)
	for i := range weights {
		weights[i] = (float64(i%3) - 1) * 0.1 // Simple initialization
	}
	c.featureWeights = mat.NewVecDense(20, weights)
}

// featuresToVector converts feature map to vector for ML processing
func (c *ContactClassifier) featuresToVector(features map[string]float64) *mat.VecDense {
	// Predefined feature order for consistent vector representation
	featureOrder := []string{
		"phone_length", "digit_variance", "repeated_digits", "sequential_digits",
		"area_code_score", "prefix_score", "call_frequency", "call_duration_avg",
		"call_time_score", "weekend_calls", "late_night_calls", "early_morning_calls",
		"contact_book", "conversation_length", "response_rate", "callback_rate",
		"geographic_score", "carrier_score", "number_age", "pattern_complexity",
	}
	
	vector := make([]float64, len(featureOrder))
	for i, featureName := range featureOrder {
		if value, exists := features[featureName]; exists {
			vector[i] = value
		}
	}
	
	return mat.NewVecDense(len(vector), vector)
}

// determineSpamType identifies the specific type of spam based on features
func (c *ContactClassifier) determineSpamType(features map[string]float64) string {
	// Simple rule-based spam type detection
	if features["marketing_pattern"] > 0.7 {
		return "sales"
	}
	if features["financial_pattern"] > 0.7 {
		return "loan"
	}
	if features["investment_pattern"] > 0.7 {
		return "investment"
	}
	if features["insurance_pattern"] > 0.7 {
		return "insurance"
	}
	if features["scam_pattern"] > 0.8 {
		return "scam"
	}
	
	return "unknown"
}

// buildReasoning creates human-readable reasoning for the classification
func (c *ContactClassifier) buildReasoning(features map[string]float64, score float64, probability float64) string {
	var reasons []string
	
	// High-confidence spam indicators
	if features["repeated_digits"] > 0.7 {
		reasons = append(reasons, "number contains repeated digit patterns")
	}
	if features["call_frequency"] > 0.8 {
		reasons = append(reasons, "unusually high call frequency")
	}
	if features["late_night_calls"] > 0.6 {
		reasons = append(reasons, "calls at inappropriate hours")
	}
	
	// High-confidence normal indicators
	if features["contact_book"] > 0.8 {
		reasons = append(reasons, "number in user's contact book")
	}
	if features["long_conversation"] > 0.7 {
		reasons = append(reasons, "history of long conversations")
	}
	if features["regular_caller"] > 0.6 {
		reasons = append(reasons, "regular calling pattern")
	}
	
	if len(reasons) == 0 {
		return fmt.Sprintf("classification based on combined feature analysis (score: %.3f)", score)
	}
	
	return strings.Join(reasons, "; ")
}

// updateSpamPatterns updates spam pattern knowledge
func (c *ContactClassifier) updateSpamPatterns(features map[string]float64, confidence float64) {
	for feature, value := range features {
		if value > 0.5 { // Only learn from significant features
			if existing, exists := c.spamPatterns[feature]; exists {
				// Weighted average update
				c.spamPatterns[feature] = (existing + value*confidence) / 2.0
			} else {
				c.spamPatterns[feature] = value * confidence
			}
		}
	}
}

// updateNormalPatterns updates normal pattern knowledge
func (c *ContactClassifier) updateNormalPatterns(features map[string]float64, confidence float64) {
	for feature, value := range features {
		if value > 0.5 { // Only learn from significant features
			if existing, exists := c.normalPatterns[feature]; exists {
				// Weighted average update
				c.normalPatterns[feature] = (existing + value*confidence) / 2.0
			} else {
				c.normalPatterns[feature] = value * confidence
			}
		}
	}
}

// updateModel retains the model based on accumulated patterns
func (c *ContactClassifier) updateModel() {
	// Simple weight update based on pattern differences
	weights := make([]float64, 20)
	
	featureOrder := []string{
		"phone_length", "digit_variance", "repeated_digits", "sequential_digits",
		"area_code_score", "prefix_score", "call_frequency", "call_duration_avg",
		"call_time_score", "weekend_calls", "late_night_calls", "early_morning_calls",
		"contact_book", "conversation_length", "response_rate", "callback_rate",
		"geographic_score", "carrier_score", "number_age", "pattern_complexity",
	}
	
	for i, feature := range featureOrder {
		spamWeight := c.spamPatterns[feature]
		normalWeight := c.normalPatterns[feature]
		
		// Weight = spam_strength - normal_strength
		weights[i] = spamWeight - normalWeight
	}
	
	c.featureWeights = mat.NewVecDense(len(weights), weights)
	c.lastModelUpdate = time.Now()
	
	c.logger.Info("model updated",
		zap.Int("training_samples", c.trainingSamples),
		zap.Time("update_time", c.lastModelUpdate))
}

// estimateAccuracy provides a rough estimate of model accuracy
func (c *ContactClassifier) estimateAccuracy() float64 {
	// Simple heuristic based on training samples and pattern confidence
	if c.trainingSamples < c.config.MinTrainingSamples {
		return 0.5 // No reliable accuracy estimate yet
	}
	
	// Calculate average pattern confidence
	var totalConfidence, patternCount float64
	
	for _, confidence := range c.spamPatterns {
		totalConfidence += confidence
		patternCount++
	}
	
	for _, confidence := range c.normalPatterns {
		totalConfidence += confidence
		patternCount++
	}
	
	if patternCount == 0 {
		return 0.5
	}
	
	avgConfidence := totalConfidence / patternCount
	
	// Rough accuracy estimate: base accuracy + pattern confidence bonus
	baseAccuracy := 0.7
	confidenceBonus := (avgConfidence - 0.5) * 0.3
	
	accuracy := baseAccuracy + confidenceBonus
	if accuracy > 0.95 {
		accuracy = 0.95 // Cap at 95%
	}
	if accuracy < 0.5 {
		accuracy = 0.5 // Floor at 50%
	}
	
	return accuracy
}

// HashPhoneNumber creates a privacy-preserving hash of the phone number
func (c *ContactClassifier) HashPhoneNumber(phoneNumber string) string {
	hash := sha256.Sum256([]byte(phoneNumber))
	return hex.EncodeToString(hash[:])
}

// ClassificationRequest represents a request to classify a contact
type ClassificationRequest struct {
	PhoneNumber    string                 `json:"phone_number"`
	AdditionalInfo map[string]interface{} `json:"additional_info,omitempty"`
}

// ClassificationResult represents the result of contact classification
type ClassificationResult struct {
	PhoneHash          string             `json:"phone_hash"`
	IsSpam             bool               `json:"is_spam"`
	Confidence         float64            `json:"confidence"`
	SpamType           string             `json:"spam_type,omitempty"`
	Features           map[string]float64 `json:"features"`
	Reasoning          string             `json:"reasoning"`
	Score              float64            `json:"score"`
	ClassificationTime time.Duration      `json:"classification_time"`
	Error              string             `json:"error,omitempty"`
}

// ModelStats represents statistics about the ML model
type ModelStats struct {
	TrainingSamples     int       `json:"training_samples"`
	LastModelUpdate     time.Time `json:"last_model_update"`
	SpamPatternsCount   int       `json:"spam_patterns_count"`
	NormalPatternsCount int       `json:"normal_patterns_count"`
	ModelAccuracy       float64   `json:"model_accuracy"`
	IsEnabled           bool      `json:"is_enabled"`
}

// NewClassifier creates a new ML classifier for dependency injection
func NewClassifier(cfg *config.Config, logger *zap.Logger) *ContactClassifier {
	return NewContactClassifier(&cfg.ML, logger)
}