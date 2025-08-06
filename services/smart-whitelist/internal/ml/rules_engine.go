package ml

import (
	"context"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"smart-whitelist/internal/config"
	"smart-whitelist/internal/models"
)

// RulesEngine provides intelligent decision making based on configurable rules
type RulesEngine struct {
	logger *zap.Logger
	config *config.MLConfig

	// Rule management
	mu           sync.RWMutex
	globalRules  map[string]*Rule
	userRules    map[uuid.UUID]map[string]*Rule
	ruleExecLog  []RuleExecution
	maxLogSize   int

	// Decision cache
	decisionCache map[string]*DecisionResult
	cacheExpiry   time.Duration
}

// Rule represents a decision rule
type Rule struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Priority    int                    `json:"priority"` // Higher = more important
	Conditions  []Condition            `json:"conditions"`
	Actions     []Action               `json:"actions"`
	UserID      *uuid.UUID             `json:"user_id,omitempty"` // nil for global rules
	IsActive    bool                   `json:"is_active"`
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
}

// Condition represents a rule condition
type Condition struct {
	Field       string      `json:"field"`
	Operator    string      `json:"operator"` // "eq", "gt", "lt", "gte", "lte", "contains", "matches"
	Value       interface{} `json:"value"`
	Weight      float64     `json:"weight"`      // How important this condition is (0.1-1.0)
	Negate      bool        `json:"negate"`      // If true, invert the condition result
	Description string      `json:"description"` // Human readable description
}

// Action represents a rule action
type Action struct {
	Type        string                 `json:"type"`        // "allow", "block", "analyze", "score_boost", "score_penalty"
	Parameters  map[string]interface{} `json:"parameters"`  // Action-specific parameters
	Description string                 `json:"description"` // Human readable description
}

// DecisionRequest represents a request for intelligent decision making
type DecisionRequest struct {
	UserID         uuid.UUID              `json:"user_id"`
	PhoneNumber    string                 `json:"phone_number"`
	Features       map[string]float64     `json:"features"`
	MLResult       *ClassificationResult  `json:"ml_result,omitempty"`
	Context        map[string]interface{} `json:"context"`
	RequestTime    time.Time              `json:"request_time"`
}

// DecisionResult represents the result of intelligent decision making
type DecisionResult struct {
	Decision       string             `json:"decision"`        // "allow", "block", "analyze"
	Confidence     float64            `json:"confidence"`      // 0.0-1.0
	Score          float64            `json:"score"`           // Raw decision score
	AppliedRules   []AppliedRule      `json:"applied_rules"`   // Rules that influenced the decision
	Reasoning      string             `json:"reasoning"`       // Human readable explanation
	RecommendedTTL time.Duration      `json:"recommended_ttl"` // How long this decision should be cached
	Metadata       map[string]interface{} `json:"metadata,omitempty"`
}

// AppliedRule represents a rule that was applied during decision making
type AppliedRule struct {
	RuleID      string    `json:"rule_id"`
	RuleName    string    `json:"rule_name"`
	Impact      float64   `json:"impact"`      // How much this rule affected the score
	Triggered   bool      `json:"triggered"`   // Whether the rule conditions were met
	Description string    `json:"description"` // What this rule did
}

// RuleExecution represents the execution log of a rule
type RuleExecution struct {
	RuleID      string                 `json:"rule_id"`
	UserID      uuid.UUID              `json:"user_id"`
	PhoneHash   string                 `json:"phone_hash"`
	Triggered   bool                   `json:"triggered"`
	Impact      float64                `json:"impact"`
	ExecutedAt  time.Time              `json:"executed_at"`
	Context     map[string]interface{} `json:"context,omitempty"`
}

// NewRulesEngine creates a new rules engine
func NewRulesEngine(config *config.MLConfig, logger *zap.Logger) *RulesEngine {
	re := &RulesEngine{
		logger:        logger,
		config:        config,
		globalRules:   make(map[string]*Rule),
		userRules:     make(map[uuid.UUID]map[string]*Rule),
		decisionCache: make(map[string]*DecisionResult),
		cacheExpiry:   15 * time.Minute,
		maxLogSize:    10000,
	}

	// Initialize with default rules
	re.initializeDefaultRules()

	logger.Info("rules engine initialized",
		zap.Int("global_rules", len(re.globalRules)))

	return re
}

// MakeDecision makes an intelligent decision based on rules and ML results
func (re *RulesEngine) MakeDecision(ctx context.Context, req *DecisionRequest) (*DecisionResult, error) {
	start := time.Now()
	defer func() {
		re.logger.Debug("decision making completed",
			zap.Duration("duration", time.Since(start)),
			zap.String("user_id", req.UserID.String()))
	}()

	// Check cache first
	cacheKey := re.generateCacheKey(req)
	if cached := re.getCachedDecision(cacheKey); cached != nil {
		return cached, nil
	}

	// Initialize decision context
	decisionCtx := &DecisionContext{
		Request:       req,
		BaseScore:     0.0,
		AppliedRules:  make([]AppliedRule, 0),
		Metadata:      make(map[string]interface{}),
	}

	// Apply ML result as baseline
	if req.MLResult != nil {
		decisionCtx.BaseScore = req.MLResult.Score
		decisionCtx.Metadata["ml_confidence"] = req.MLResult.Confidence
		decisionCtx.Metadata["ml_spam_type"] = req.MLResult.SpamType
	}

	// Apply global rules
	if err := re.applyRules(decisionCtx, re.getGlobalRules()); err != nil {
		return nil, fmt.Errorf("failed to apply global rules: %w", err)
	}

	// Apply user-specific rules
	if userRules := re.getUserRules(req.UserID); userRules != nil {
		if err := re.applyRules(decisionCtx, userRules); err != nil {
			return nil, fmt.Errorf("failed to apply user rules: %w", err)
		}
	}

	// Make final decision
	result := re.makeDecision(decisionCtx)

	// Cache the result
	re.cacheDecision(cacheKey, result)

	// Log rule executions
	re.logRuleExecutions(req, decisionCtx.AppliedRules)

	return result, nil
}

// AddGlobalRule adds a global rule
func (re *RulesEngine) AddGlobalRule(rule *Rule) error {
	if rule.ID == "" {
		rule.ID = re.generateRuleID()
	}

	rule.UserID = nil // Ensure it's a global rule
	rule.CreatedAt = time.Now()
	rule.UpdatedAt = time.Now()

	re.mu.Lock()
	defer re.mu.Unlock()

	re.globalRules[rule.ID] = rule

	re.logger.Info("global rule added",
		zap.String("rule_id", rule.ID),
		zap.String("rule_name", rule.Name),
		zap.Int("priority", rule.Priority))

	return nil
}

// AddUserRule adds a user-specific rule
func (re *RulesEngine) AddUserRule(userID uuid.UUID, rule *Rule) error {
	if rule.ID == "" {
		rule.ID = re.generateRuleID()
	}

	rule.UserID = &userID
	rule.CreatedAt = time.Now()
	rule.UpdatedAt = time.Now()

	re.mu.Lock()
	defer re.mu.Unlock()

	if re.userRules[userID] == nil {
		re.userRules[userID] = make(map[string]*Rule)
	}

	re.userRules[userID][rule.ID] = rule

	re.logger.Info("user rule added",
		zap.String("user_id", userID.String()),
		zap.String("rule_id", rule.ID),
		zap.String("rule_name", rule.Name),
		zap.Int("priority", rule.Priority))

	return nil
}

// UpdateRule updates an existing rule
func (re *RulesEngine) UpdateRule(ruleID string, updates map[string]interface{}) error {
	re.mu.Lock()
	defer re.mu.Unlock()

	var rule *Rule
	var found bool

	// Check global rules first
	if rule, found = re.globalRules[ruleID]; found {
		re.updateRuleFields(rule, updates)
		re.logger.Info("global rule updated", zap.String("rule_id", ruleID))
		return nil
	}

	// Check user rules
	for userID, userRules := range re.userRules {
		if rule, found = userRules[ruleID]; found {
			re.updateRuleFields(rule, updates)
			re.logger.Info("user rule updated",
				zap.String("user_id", userID.String()),
				zap.String("rule_id", ruleID))
			return nil
		}
	}

	return fmt.Errorf("rule not found: %s", ruleID)
}

// DeleteRule deletes a rule
func (re *RulesEngine) DeleteRule(ruleID string) error {
	re.mu.Lock()
	defer re.mu.Unlock()

	// Check global rules first
	if _, found := re.globalRules[ruleID]; found {
		delete(re.globalRules, ruleID)
		re.logger.Info("global rule deleted", zap.String("rule_id", ruleID))
		return nil
	}

	// Check user rules
	for userID, userRules := range re.userRules {
		if _, found := userRules[ruleID]; found {
			delete(userRules, ruleID)
			re.logger.Info("user rule deleted",
				zap.String("user_id", userID.String()),
				zap.String("rule_id", ruleID))
			return nil
		}
	}

	return fmt.Errorf("rule not found: %s", ruleID)
}

// GetRuleExecutionStats returns rule execution statistics
func (re *RulesEngine) GetRuleExecutionStats(userID uuid.UUID, since time.Time) map[string]RuleStats {
	re.mu.RLock()
	defer re.mu.RUnlock()

	stats := make(map[string]RuleStats)

	for _, execution := range re.ruleExecLog {
		if execution.UserID != userID || execution.ExecutedAt.Before(since) {
			continue
		}

		if _, exists := stats[execution.RuleID]; !exists {
			stats[execution.RuleID] = RuleStats{
				RuleID:        execution.RuleID,
				TotalExecutions: 0,
				TriggeredCount:  0,
				AverageImpact:   0.0,
				LastExecuted:    time.Time{},
			}
		}

		stat := stats[execution.RuleID]
		stat.TotalExecutions++
		if execution.Triggered {
			stat.TriggeredCount++
			stat.AverageImpact = (stat.AverageImpact + execution.Impact) / 2.0
		}
		if execution.ExecutedAt.After(stat.LastExecuted) {
			stat.LastExecuted = execution.ExecutedAt
		}
		stats[execution.RuleID] = stat
	}

	return stats
}

// DecisionContext holds context during decision making
type DecisionContext struct {
	Request      *DecisionRequest
	BaseScore    float64
	AppliedRules []AppliedRule
	Metadata     map[string]interface{}
}

// RuleStats represents statistics about rule execution
type RuleStats struct {
	RuleID          string    `json:"rule_id"`
	TotalExecutions int       `json:"total_executions"`
	TriggeredCount  int       `json:"triggered_count"`
	AverageImpact   float64   `json:"average_impact"`
	LastExecuted    time.Time `json:"last_executed"`
}

// initializeDefaultRules sets up default global rules
func (re *RulesEngine) initializeDefaultRules() {
	// Rule 1: Whitelist override - if already whitelisted, always allow
	whitelistRule := &Rule{
		ID:          "whitelist_override",
		Name:        "Whitelist Override",
		Description: "Always allow contacts that are already whitelisted",
		Priority:    1000, // Highest priority
		Conditions: []Condition{
			{
				Field:       "is_whitelisted",
				Operator:    "eq",
				Value:       true,
				Weight:      1.0,
				Description: "Contact is in whitelist",
			},
		},
		Actions: []Action{
			{
				Type:        "allow",
				Parameters:  map[string]interface{}{"score_boost": 2.0},
				Description: "Allow whitelisted contact",
			},
		},
		IsActive: true,
	}

	// Rule 2: Contact book priority - boost trusted contacts
	contactBookRule := &Rule{
		ID:          "contact_book_boost",
		Name:        "Contact Book Priority",
		Description: "Boost confidence for contacts in user's contact book",
		Priority:    800,
		Conditions: []Condition{
			{
				Field:       "contact_book",
				Operator:    "gt",
				Value:       0.8,
				Weight:      0.9,
				Description: "Contact is in user's contact book",
			},
		},
		Actions: []Action{
			{
				Type:        "score_boost",
				Parameters:  map[string]interface{}{"boost": 1.5},
				Description: "Boost score for contact book entries",
			},
		},
		IsActive: true,
	}

	// Rule 3: High frequency spam detection
	spamFrequencyRule := &Rule{
		ID:          "spam_frequency_block",
		Name:        "High Frequency Spam Block",
		Description: "Block numbers with very high call frequency and spam patterns",
		Priority:    900,
		Conditions: []Condition{
			{
				Field:       "call_frequency",
				Operator:    "gt",
				Value:       0.8,
				Weight:      0.8,
				Description: "Very high call frequency",
			},
			{
				Field:       "marketing_pattern",
				Operator:    "gt",
				Value:       0.7,
				Weight:      0.7,
				Description: "Strong marketing pattern detected",
			},
		},
		Actions: []Action{
			{
				Type:        "block",
				Parameters:  map[string]interface{}{"score_penalty": -1.5},
				Description: "Block high frequency spam",
			},
		},
		IsActive: true,
	}

	// Rule 4: Business hours legitimate calls
	businessHoursRule := &Rule{
		ID:          "business_hours_boost",
		Name:        "Business Hours Legitimacy",
		Description: "Boost confidence for calls during business hours",
		Priority:    300,
		Conditions: []Condition{
			{
				Field:       "call_time_score",
				Operator:    "lt",
				Value:       0.3,
				Weight:      0.5,
				Description: "Calls during business hours",
			},
		},
		Actions: []Action{
			{
				Type:        "score_boost",
				Parameters:  map[string]interface{}{"boost": 0.3},
				Description: "Small boost for business hour calls",
			},
		},
		IsActive: true,
	}

	// Rule 5: Late night spam penalty
	lateNightRule := &Rule{
		ID:          "late_night_penalty",
		Name:        "Late Night Call Penalty",
		Description: "Penalize calls at inappropriate hours",
		Priority:    400,
		Conditions: []Condition{
			{
				Field:       "late_night_calls",
				Operator:    "gt",
				Value:       0.6,
				Weight:      0.7,
				Description: "High ratio of late night calls",
			},
		},
		Actions: []Action{
			{
				Type:        "score_penalty",
				Parameters:  map[string]interface{}{"penalty": -0.5},
				Description: "Penalize inappropriate timing",
			},
		},
		IsActive: true,
	}

	// Rule 6: Financial pattern detection
	financialRule := &Rule{
		ID:          "financial_spam_detection",
		Name:        "Financial Spam Detection",
		Description: "Detect and handle financial/loan spam",
		Priority:    700,
		Conditions: []Condition{
			{
				Field:       "financial_pattern",
				Operator:    "gt",
				Value:       0.7,
				Weight:      0.8,
				Description: "Strong financial spam pattern",
			},
			{
				Field:       "ml_confidence",
				Operator:    "gt",
				Value:       0.6,
				Weight:      0.6,
				Description: "ML confirms spam likelihood",
			},
		},
		Actions: []Action{
			{
				Type:        "analyze",
				Parameters:  map[string]interface{}{"priority": "high", "category": "financial"},
				Description: "Flag for financial spam analysis",
			},
		},
		IsActive: true,
	}

	// Add all default rules
	defaultRules := []*Rule{
		whitelistRule,
		contactBookRule,
		spamFrequencyRule,
		businessHoursRule,
		lateNightRule,
		financialRule,
	}

	for _, rule := range defaultRules {
		re.globalRules[rule.ID] = rule
	}

	re.logger.Info("default rules initialized", zap.Int("count", len(defaultRules)))
}

// applyRules applies a set of rules to the decision context
func (re *RulesEngine) applyRules(ctx *DecisionContext, rules map[string]*Rule) error {
	// Sort rules by priority (descending)
	sortedRules := re.sortRulesByPriority(rules)

	for _, rule := range sortedRules {
		if !rule.IsActive {
			continue
		}

		// Evaluate rule conditions
		triggered, confidence := re.evaluateConditions(ctx, rule.Conditions)

		appliedRule := AppliedRule{
			RuleID:      rule.ID,
			RuleName:    rule.Name,
			Triggered:   triggered,
			Impact:      0.0,
			Description: rule.Description,
		}

		if triggered {
			// Apply rule actions
			impact := re.applyActions(ctx, rule.Actions, confidence)
			appliedRule.Impact = impact
		}

		ctx.AppliedRules = append(ctx.AppliedRules, appliedRule)
	}

	return nil
}

// evaluateConditions evaluates rule conditions and returns if triggered and confidence
func (re *RulesEngine) evaluateConditions(ctx *DecisionContext, conditions []Condition) (bool, float64) {
	if len(conditions) == 0 {
		return false, 0.0
	}

	totalWeight := 0.0
	weightedScore := 0.0

	for _, condition := range conditions {
		value := re.getFieldValue(ctx, condition.Field)
		result := re.evaluateCondition(value, condition)

		if condition.Negate {
			result = !result
		}

		if result {
			weightedScore += condition.Weight
		}
		totalWeight += condition.Weight
	}

	if totalWeight == 0 {
		return false, 0.0
	}

	confidence := weightedScore / totalWeight

	// Rule triggers if confidence > 0.5 (majority of weighted conditions met)
	triggered := confidence > 0.5

	return triggered, confidence
}

// evaluateCondition evaluates a single condition
func (re *RulesEngine) evaluateCondition(value interface{}, condition Condition) bool {
	switch condition.Operator {
	case "eq":
		return re.isEqual(value, condition.Value)
	case "gt":
		return re.isGreaterThan(value, condition.Value)
	case "lt":
		return re.isLessThan(value, condition.Value)
	case "gte":
		return re.isGreaterThanOrEqual(value, condition.Value)
	case "lte":
		return re.isLessThanOrEqual(value, condition.Value)
	case "contains":
		return re.contains(value, condition.Value)
	case "matches":
		return re.matches(value, condition.Value)
	default:
		re.logger.Warn("unknown condition operator", zap.String("operator", condition.Operator))
		return false
	}
}

// applyActions applies rule actions and returns the total impact
func (re *RulesEngine) applyActions(ctx *DecisionContext, actions []Action, confidence float64) float64 {
	totalImpact := 0.0

	for _, action := range actions {
		impact := re.applyAction(ctx, action, confidence)
		totalImpact += impact
	}

	return totalImpact
}

// applyAction applies a single action
func (re *RulesEngine) applyAction(ctx *DecisionContext, action Action, confidence float64) float64 {
	switch action.Type {
	case "allow":
		if boost, ok := action.Parameters["score_boost"].(float64); ok {
			ctx.BaseScore += boost * confidence
			return boost * confidence
		}
	case "block":
		if penalty, ok := action.Parameters["score_penalty"].(float64); ok {
			ctx.BaseScore += penalty * confidence
			return penalty * confidence
		}
	case "score_boost":
		if boost, ok := action.Parameters["boost"].(float64); ok {
			impact := boost * confidence
			ctx.BaseScore += impact
			return impact
		}
	case "score_penalty":
		if penalty, ok := action.Parameters["penalty"].(float64); ok {
			impact := penalty * confidence
			ctx.BaseScore += impact
			return impact
		}
	case "analyze":
		ctx.Metadata["requires_analysis"] = true
		if priority, ok := action.Parameters["priority"]; ok {
			ctx.Metadata["analysis_priority"] = priority
		}
		if category, ok := action.Parameters["category"]; ok {
			ctx.Metadata["analysis_category"] = category
		}
	}

	return 0.0
}

// makeDecision makes the final decision based on the context
func (re *RulesEngine) makeDecision(ctx *DecisionContext) *DecisionResult {
	// Apply sigmoid function to convert score to probability
	probability := 1.0 / (1.0 + math.Exp(-ctx.BaseScore))

	var decision string
	var confidence float64

	// Decision thresholds
	if ctx.Metadata["requires_analysis"] == true {
		decision = "analyze"
		confidence = 0.8 // High confidence that analysis is needed
	} else if probability > re.config.ConfidenceThreshold {
		decision = "allow"
		confidence = probability
	} else if probability < (1.0 - re.config.ConfidenceThreshold) {
		decision = "block"
		confidence = 1.0 - probability
	} else {
		decision = "analyze"
		confidence = 0.6 // Moderate confidence that analysis is needed
	}

	// Build reasoning
	reasoning := re.buildReasoning(ctx, decision)

	// Determine TTL based on confidence
	ttl := re.determineCacheTTL(confidence, decision)

	return &DecisionResult{
		Decision:       decision,
		Confidence:     confidence,
		Score:          ctx.BaseScore,
		AppliedRules:   ctx.AppliedRules,
		Reasoning:      reasoning,
		RecommendedTTL: ttl,
		Metadata:       ctx.Metadata,
	}
}

// Helper functions...

func (re *RulesEngine) getFieldValue(ctx *DecisionContext, field string) interface{} {
	// First check features
	if ctx.Request.Features != nil {
		if value, exists := ctx.Request.Features[field]; exists {
			return value
		}
	}

	// Check context
	if ctx.Request.Context != nil {
		if value, exists := ctx.Request.Context[field]; exists {
			return value
		}
	}

	// Check ML result
	if ctx.Request.MLResult != nil {
		switch field {
		case "ml_confidence":
			return ctx.Request.MLResult.Confidence
		case "ml_is_spam":
			return ctx.Request.MLResult.IsSpam
		case "ml_spam_type":
			return ctx.Request.MLResult.SpamType
		}
	}

	// Check metadata
	if value, exists := ctx.Metadata[field]; exists {
		return value
	}

	return nil
}

func (re *RulesEngine) isEqual(a, b interface{}) bool {
	return a == b
}

func (re *RulesEngine) isGreaterThan(a, b interface{}) bool {
	af, aok := a.(float64)
	bf, bok := b.(float64)
	if aok && bok {
		return af > bf
	}
	return false
}

func (re *RulesEngine) isLessThan(a, b interface{}) bool {
	af, aok := a.(float64)
	bf, bok := b.(float64)
	if aok && bok {
		return af < bf
	}
	return false
}

func (re *RulesEngine) isGreaterThanOrEqual(a, b interface{}) bool {
	af, aok := a.(float64)
	bf, bok := b.(float64)
	if aok && bok {
		return af >= bf
	}
	return false
}

func (re *RulesEngine) isLessThanOrEqual(a, b interface{}) bool {
	af, aok := a.(float64)
	bf, bok := b.(float64)
	if aok && bok {
		return af <= bf
	}
	return false
}

func (re *RulesEngine) contains(a, b interface{}) bool {
	as, aok := a.(string)
	bs, bok := b.(string)
	if aok && bok {
		return fmt.Sprintf("%v", as) == fmt.Sprintf("%v", bs)
	}
	return false
}

func (re *RulesEngine) matches(a, b interface{}) bool {
	// Simplified pattern matching
	return re.contains(a, b)
}

func (re *RulesEngine) getGlobalRules() map[string]*Rule {
	re.mu.RLock()
	defer re.mu.RUnlock()
	
	result := make(map[string]*Rule)
	for k, v := range re.globalRules {
		result[k] = v
	}
	return result
}

func (re *RulesEngine) getUserRules(userID uuid.UUID) map[string]*Rule {
	re.mu.RLock()
	defer re.mu.RUnlock()
	
	if userRules, exists := re.userRules[userID]; exists {
		result := make(map[string]*Rule)
		for k, v := range userRules {
			result[k] = v
		}
		return result
	}
	return nil
}

func (re *RulesEngine) sortRulesByPriority(rules map[string]*Rule) []*Rule {
	sorted := make([]*Rule, 0, len(rules))
	for _, rule := range rules {
		sorted = append(sorted, rule)
	}

	// Simple bubble sort by priority (descending)
	for i := 0; i < len(sorted)-1; i++ {
		for j := 0; j < len(sorted)-i-1; j++ {
			if sorted[j].Priority < sorted[j+1].Priority {
				sorted[j], sorted[j+1] = sorted[j+1], sorted[j]
			}
		}
	}

	return sorted
}

func (re *RulesEngine) buildReasoning(ctx *DecisionContext, decision string) string {
	reasons := make([]string, 0)

	for _, rule := range ctx.AppliedRules {
		if rule.Triggered && math.Abs(rule.Impact) > 0.1 {
			if rule.Impact > 0 {
				reasons = append(reasons, fmt.Sprintf("Rule '%s' increased trust (impact: +%.2f)", rule.RuleName, rule.Impact))
			} else {
				reasons = append(reasons, fmt.Sprintf("Rule '%s' decreased trust (impact: %.2f)", rule.RuleName, rule.Impact))
			}
		}
	}

	if len(reasons) == 0 {
		return fmt.Sprintf("Decision '%s' based on default thresholds", decision)
	}

	return fmt.Sprintf("Decision '%s': %s", decision, fmt.Sprintf("%v", reasons))
}

func (re *RulesEngine) determineCacheTTL(confidence float64, decision string) time.Duration {
	baseTTL := re.cacheExpiry

	// Higher confidence = longer cache time
	confidenceMultiplier := confidence * 2.0
	if confidenceMultiplier > 2.0 {
		confidenceMultiplier = 2.0
	}

	// Different decisions have different cache behaviors
	switch decision {
	case "allow":
		return time.Duration(float64(baseTTL) * confidenceMultiplier)
	case "block":
		return time.Duration(float64(baseTTL) * confidenceMultiplier)
	case "analyze":
		return baseTTL / 3 // Shorter cache for analysis decisions
	default:
		return baseTTL
	}
}

func (re *RulesEngine) generateCacheKey(req *DecisionRequest) string {
	return fmt.Sprintf("decision:%s:%x", req.UserID.String(), req.PhoneNumber)
}

func (re *RulesEngine) getCachedDecision(key string) *DecisionResult {
	re.mu.RLock()
	defer re.mu.RUnlock()

	if result, exists := re.decisionCache[key]; exists {
		return result
	}
	return nil
}

func (re *RulesEngine) cacheDecision(key string, result *DecisionResult) {
	re.mu.Lock()
	defer re.mu.Unlock()

	re.decisionCache[key] = result

	// Simple cache cleanup (in production, use a proper cache with TTL)
	if len(re.decisionCache) > 10000 {
		// Remove oldest entries (simplified)
		for k := range re.decisionCache {
			delete(re.decisionCache, k)
			if len(re.decisionCache) <= 8000 {
				break
			}
		}
	}
}

func (re *RulesEngine) logRuleExecutions(req *DecisionRequest, appliedRules []AppliedRule) {
	re.mu.Lock()
	defer re.mu.Unlock()

	phoneHash := fmt.Sprintf("%x", req.PhoneNumber) // Simplified hash

	for _, rule := range appliedRules {
		execution := RuleExecution{
			RuleID:     rule.RuleID,
			UserID:     req.UserID,
			PhoneHash:  phoneHash,
			Triggered:  rule.Triggered,
			Impact:     rule.Impact,
			ExecutedAt: time.Now(),
			Context:    req.Context,
		}

		re.ruleExecLog = append(re.ruleExecLog, execution)
	}

	// Cleanup old logs
	if len(re.ruleExecLog) > re.maxLogSize {
		// Keep only recent logs
		cutoff := len(re.ruleExecLog) - re.maxLogSize/2
		re.ruleExecLog = re.ruleExecLog[cutoff:]
	}
}

func (re *RulesEngine) generateRuleID() string {
	return fmt.Sprintf("rule_%d", time.Now().UnixNano())
}

func (re *RulesEngine) updateRuleFields(rule *Rule, updates map[string]interface{}) {
	if name, ok := updates["name"].(string); ok {
		rule.Name = name
	}
	if desc, ok := updates["description"].(string); ok {
		rule.Description = desc
	}
	if priority, ok := updates["priority"].(int); ok {
		rule.Priority = priority
	}
	if active, ok := updates["is_active"].(bool); ok {
		rule.IsActive = active
	}
	// Add more field updates as needed...

	rule.UpdatedAt = time.Now()
}