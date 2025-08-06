package ml

import (
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"go.uber.org/zap"
)

// FeatureExtractor extracts features from phone numbers and additional context
type FeatureExtractor struct {
	logger *zap.Logger
	
	// Compiled regex patterns for performance
	repeatedDigitPattern   *regexp.Regexp
	sequentialPattern      *regexp.Regexp
	marketingPrefixPattern *regexp.Regexp
	internationalPattern   *regexp.Regexp
}

// NewFeatureExtractor creates a new feature extractor
func NewFeatureExtractor(logger *zap.Logger) *FeatureExtractor {
	return &FeatureExtractor{
		logger:                 logger,
		repeatedDigitPattern:   regexp.MustCompile(`(.)\1{2,}`),
		sequentialPattern:      regexp.MustCompile(`(0123|1234|2345|3456|4567|5678|6789|9876|8765|7654|6543|5432|4321|3210)`),
		marketingPrefixPattern: regexp.MustCompile(`^(400|800|950|95[0-9])`),
		internationalPattern:   regexp.MustCompile(`^\+?[1-9]\d{1,14}$`),
	}
}

// ExtractFeatures extracts numerical features from phone number and context
func (fe *FeatureExtractor) ExtractFeatures(phoneNumber string, additionalInfo map[string]interface{}) map[string]float64 {
	features := make(map[string]float64)
	
	// Clean phone number for analysis
	cleanPhone := fe.cleanPhoneNumber(phoneNumber)
	
	// Basic phone number features
	features["phone_length"] = float64(len(cleanPhone)) / 15.0 // Normalized to 0-1
	features["digit_variance"] = fe.calculateDigitVariance(cleanPhone)
	features["repeated_digits"] = fe.detectRepeatedDigits(cleanPhone)
	features["sequential_digits"] = fe.detectSequentialDigits(cleanPhone)
	
	// Geographic and carrier features
	features["area_code_score"] = fe.analyzeAreaCode(cleanPhone)
	features["prefix_score"] = fe.analyzePrefix(cleanPhone)
	features["geographic_score"] = fe.analyzeGeographicPattern(cleanPhone)
	features["carrier_score"] = fe.analyzeCarrierPattern(cleanPhone)
	
	// Pattern complexity features
	features["pattern_complexity"] = fe.calculatePatternComplexity(cleanPhone)
	features["number_age"] = fe.estimateNumberAge(cleanPhone)
	
	// Marketing and spam pattern detection
	features["marketing_pattern"] = fe.detectMarketingPattern(cleanPhone)
	features["financial_pattern"] = fe.detectFinancialPattern(phoneNumber, additionalInfo)
	features["investment_pattern"] = fe.detectInvestmentPattern(phoneNumber, additionalInfo)
	features["insurance_pattern"] = fe.detectInsurancePattern(phoneNumber, additionalInfo)
	features["scam_pattern"] = fe.detectScamPattern(phoneNumber, additionalInfo)
	
	// Behavioral features from additional info
	if additionalInfo != nil {
		features["call_frequency"] = fe.extractCallFrequency(additionalInfo)
		features["call_duration_avg"] = fe.extractCallDuration(additionalInfo)
		features["call_time_score"] = fe.extractCallTimeScore(additionalInfo)
		features["weekend_calls"] = fe.extractWeekendCallRatio(additionalInfo)
		features["late_night_calls"] = fe.extractLateNightCallRatio(additionalInfo)
		features["early_morning_calls"] = fe.extractEarlyMorningCallRatio(additionalInfo)
		features["contact_book"] = fe.extractContactBookStatus(additionalInfo)
		features["conversation_length"] = fe.extractConversationLength(additionalInfo)
		features["response_rate"] = fe.extractResponseRate(additionalInfo)
		features["callback_rate"] = fe.extractCallbackRate(additionalInfo)
	}
	
	return features
}

// cleanPhoneNumber removes non-digit characters
func (fe *FeatureExtractor) cleanPhoneNumber(phoneNumber string) string {
	return regexp.MustCompile(`[^\d]`).ReplaceAllString(phoneNumber, "")
}

// calculateDigitVariance measures the variance in digits (low variance = repeated digits)
func (fe *FeatureExtractor) calculateDigitVariance(phoneNumber string) float64 {
	if len(phoneNumber) < 2 {
		return 0.0
	}
	
	digitCounts := make(map[rune]int)
	for _, digit := range phoneNumber {
		digitCounts[digit]++
	}
	
	// Calculate variance
	mean := float64(len(phoneNumber)) / 10.0 // Assuming 10 possible digits
	var variance float64
	
	for i := '0'; i <= '9'; i++ {
		count := float64(digitCounts[i])
		variance += math.Pow(count-mean, 2)
	}
	
	variance = variance / 10.0
	return math.Min(variance/float64(len(phoneNumber)), 1.0)
}

// detectRepeatedDigits checks for patterns like 1111, 2222, etc.
func (fe *FeatureExtractor) detectRepeatedDigits(phoneNumber string) float64 {
	matches := fe.repeatedDigitPattern.FindAllString(phoneNumber, -1)
	if len(matches) == 0 {
		return 0.0
	}
	
	// Score based on length and frequency of repeated patterns
	totalRepeated := 0
	for _, match := range matches {
		totalRepeated += len(match)
	}
	
	return math.Min(float64(totalRepeated)/float64(len(phoneNumber)), 1.0)
}

// detectSequentialDigits checks for patterns like 1234, 5678, etc.
func (fe *FeatureExtractor) detectSequentialDigits(phoneNumber string) float64 {
	if fe.sequentialPattern.MatchString(phoneNumber) {
		return 1.0
	}
	
	// Check for custom sequential patterns
	sequentialCount := 0
	for i := 0; i < len(phoneNumber)-2; i++ {
		if len(phoneNumber) > i+2 {
			a, _ := strconv.Atoi(string(phoneNumber[i]))
			b, _ := strconv.Atoi(string(phoneNumber[i+1]))
			c, _ := strconv.Atoi(string(phoneNumber[i+2]))
			
			if b == a+1 && c == b+1 {
				sequentialCount++
			} else if b == a-1 && c == b-1 {
				sequentialCount++
			}
		}
	}
	
	return math.Min(float64(sequentialCount)/3.0, 1.0)
}

// analyzeAreaCode analyzes the area code for spam likelihood
func (fe *FeatureExtractor) analyzeAreaCode(phoneNumber string) float64 {
	if len(phoneNumber) < 3 {
		return 0.5
	}
	
	areaCode := phoneNumber[:3]
	
	// Known spam-heavy area codes (this would be based on real data)
	spamAreaCodes := map[string]float64{
		"000": 0.9, // Invalid area code
		"001": 0.9, // Invalid area code
		"555": 0.8, // Often used for fake numbers
		"800": 0.3, // Toll-free, could be legitimate business
		"888": 0.3, // Toll-free
		"877": 0.3, // Toll-free
		"866": 0.3, // Toll-free
	}
	
	if score, exists := spamAreaCodes[areaCode]; exists {
		return score
	}
	
	// Default score for unknown area codes
	return 0.5
}

// analyzePrefix analyzes the prefix for marketing patterns
func (fe *FeatureExtractor) analyzePrefix(phoneNumber string) float64 {
	if fe.marketingPrefixPattern.MatchString(phoneNumber) {
		return 0.9
	}
	return 0.1
}

// analyzeGeographicPattern checks if the number follows normal geographic patterns
func (fe *FeatureExtractor) analyzeGeographicPattern(phoneNumber string) float64 {
	// This is a simplified implementation
	// In practice, you'd have a database of valid geographic number ranges
	if len(phoneNumber) == 11 && phoneNumber[0] == '1' {
		return 0.7 // US/Canada format
	}
	if len(phoneNumber) == 10 {
		return 0.6 // US without country code
	}
	if len(phoneNumber) < 7 || len(phoneNumber) > 15 {
		return 0.9 // Likely spam - too short or too long
	}
	
	return 0.5
}

// analyzeCarrierPattern checks carrier-specific patterns
func (fe *FeatureExtractor) analyzeCarrierPattern(phoneNumber string) float64 {
	// Simplified carrier analysis
	// In practice, you'd query carrier databases
	if len(phoneNumber) >= 6 {
		prefix := phoneNumber[:6]
		// Some prefixes are known to be used by robocallers
		spamPrefixes := []string{"123456", "111111", "000000"}
		for _, spamPrefix := range spamPrefixes {
			if prefix == spamPrefix {
				return 0.9
			}
		}
	}
	
	return 0.5
}

// calculatePatternComplexity measures how complex/random the number pattern is
func (fe *FeatureExtractor) calculatePatternComplexity(phoneNumber string) float64 {
	if len(phoneNumber) < 4 {
		return 0.0
	}
	
	// Count unique digit transitions
	transitions := make(map[string]bool)
	for i := 0; i < len(phoneNumber)-1; i++ {
		transition := phoneNumber[i:i+2]
		transitions[transition] = true
	}
	
	// More unique transitions = higher complexity = less likely spam
	complexity := float64(len(transitions)) / float64(len(phoneNumber)-1)
	return complexity
}

// estimateNumberAge estimates how old/established a number pattern is
func (fe *FeatureExtractor) estimateNumberAge(phoneNumber string) float64 {
	// This is a placeholder implementation
	// In practice, you'd have historical data about when number ranges were allocated
	
	// Simple heuristic: newer area codes might be more likely to be spam
	if len(phoneNumber) >= 3 {
		areaCode := phoneNumber[:3]
		// Newer area codes (this is just an example)
		newAreaCodes := []string{"321", "352", "386", "407", "561", "689", "727", "754", "786", "813", "850", "863", "904", "941", "954"}
		for _, newCode := range newAreaCodes {
			if areaCode == newCode {
				return 0.3 // Newer = potentially more spam
			}
		}
	}
	
	return 0.7 // Assume established by default
}

// detectMarketingPattern checks for marketing/telemarketing patterns
func (fe *FeatureExtractor) detectMarketingPattern(phoneNumber string) float64 {
	score := 0.0
	
	// Marketing numbers often have specific patterns
	if fe.marketingPrefixPattern.MatchString(phoneNumber) {
		score += 0.8
	}
	
	// Sequential or repeated digits are common in marketing numbers
	if fe.detectRepeatedDigits(phoneNumber) > 0.5 {
		score += 0.3
	}
	
	if fe.detectSequentialDigits(phoneNumber) > 0.5 {
		score += 0.3
	}
	
	return math.Min(score, 1.0)
}

// detectFinancialPattern checks for financial/loan spam patterns
func (fe *FeatureExtractor) detectFinancialPattern(phoneNumber string, additionalInfo map[string]interface{}) float64 {
	score := 0.0
	
	// Check for financial keywords in context
	if additionalInfo != nil {
		if context, exists := additionalInfo["context"]; exists {
			contextStr := strings.ToLower(context.(string))
			financialKeywords := []string{"loan", "credit", "debt", "mortgage", "finance", "bank", "money"}
			for _, keyword := range financialKeywords {
				if strings.Contains(contextStr, keyword) {
					score += 0.2
				}
			}
		}
	}
	
	return math.Min(score, 1.0)
}

// detectInvestmentPattern checks for investment spam patterns
func (fe *FeatureExtractor) detectInvestmentPattern(phoneNumber string, additionalInfo map[string]interface{}) float64 {
	score := 0.0
	
	if additionalInfo != nil {
		if context, exists := additionalInfo["context"]; exists {
			contextStr := strings.ToLower(context.(string))
			investmentKeywords := []string{"investment", "stock", "forex", "crypto", "trading", "profit", "returns"}
			for _, keyword := range investmentKeywords {
				if strings.Contains(contextStr, keyword) {
					score += 0.2
				}
			}
		}
	}
	
	return math.Min(score, 1.0)
}

// detectInsurancePattern checks for insurance spam patterns
func (fe *FeatureExtractor) detectInsurancePattern(phoneNumber string, additionalInfo map[string]interface{}) float64 {
	score := 0.0
	
	if additionalInfo != nil {
		if context, exists := additionalInfo["context"]; exists {
			contextStr := strings.ToLower(context.(string))
			insuranceKeywords := []string{"insurance", "policy", "coverage", "premium", "claim", "health", "auto", "life"}
			for _, keyword := range insuranceKeywords {
				if strings.Contains(contextStr, keyword) {
					score += 0.2
				}
			}
		}
	}
	
	return math.Min(score, 1.0)
}

// detectScamPattern checks for scam patterns
func (fe *FeatureExtractor) detectScamPattern(phoneNumber string, additionalInfo map[string]interface{}) float64 {
	score := 0.0
	
	if additionalInfo != nil {
		if context, exists := additionalInfo["context"]; exists {
			contextStr := strings.ToLower(context.(string))
			scamKeywords := []string{"winner", "prize", "urgent", "suspended", "verify", "confirm", "immediate", "act now"}
			for _, keyword := range scamKeywords {
				if strings.Contains(contextStr, keyword) {
					score += 0.3
				}
			}
		}
		
		// Check for urgency indicators
		if callTime, exists := additionalInfo["call_time"]; exists {
			if ct, ok := callTime.(time.Time); ok {
				hour := ct.Hour()
				// Calls very late at night or very early morning
				if hour < 6 || hour > 22 {
					score += 0.4
				}
			}
		}
	}
	
	return math.Min(score, 1.0)
}

// extractCallFrequency extracts call frequency from additional info
func (fe *FeatureExtractor) extractCallFrequency(additionalInfo map[string]interface{}) float64 {
	if freq, exists := additionalInfo["call_frequency"]; exists {
		if f, ok := freq.(float64); ok {
			return math.Min(f/10.0, 1.0) // Normalize to 0-1, assuming 10+ calls/day is max
		}
	}
	return 0.0
}

// extractCallDuration extracts average call duration
func (fe *FeatureExtractor) extractCallDuration(additionalInfo map[string]interface{}) float64 {
	if duration, exists := additionalInfo["avg_call_duration"]; exists {
		if d, ok := duration.(float64); ok {
			return math.Min(d/300.0, 1.0) // Normalize to 0-1, assuming 5 minutes is max normal
		}
	}
	return 0.0
}

// extractCallTimeScore analyzes call timing patterns
func (fe *FeatureExtractor) extractCallTimeScore(additionalInfo map[string]interface{}) float64 {
	if callTimes, exists := additionalInfo["call_times"]; exists {
		if times, ok := callTimes.([]time.Time); ok {
			oddHourCalls := 0
			for _, t := range times {
				hour := t.Hour()
				if hour < 8 || hour > 20 {
					oddHourCalls++
				}
			}
			return float64(oddHourCalls) / float64(len(times))
		}
	}
	return 0.0
}

// extractWeekendCallRatio calculates the ratio of weekend calls
func (fe *FeatureExtractor) extractWeekendCallRatio(additionalInfo map[string]interface{}) float64 {
	if callTimes, exists := additionalInfo["call_times"]; exists {
		if times, ok := callTimes.([]time.Time); ok {
			weekendCalls := 0
			for _, t := range times {
				if t.Weekday() == time.Saturday || t.Weekday() == time.Sunday {
					weekendCalls++
				}
			}
			return float64(weekendCalls) / float64(len(times))
		}
	}
	return 0.0
}

// extractLateNightCallRatio calculates the ratio of late night calls
func (fe *FeatureExtractor) extractLateNightCallRatio(additionalInfo map[string]interface{}) float64 {
	if callTimes, exists := additionalInfo["call_times"]; exists {
		if times, ok := callTimes.([]time.Time); ok {
			lateNightCalls := 0
			for _, t := range times {
				hour := t.Hour()
				if hour >= 22 || hour <= 6 {
					lateNightCalls++
				}
			}
			return float64(lateNightCalls) / float64(len(times))
		}
	}
	return 0.0
}

// extractEarlyMorningCallRatio calculates the ratio of early morning calls
func (fe *FeatureExtractor) extractEarlyMorningCallRatio(additionalInfo map[string]interface{}) float64 {
	if callTimes, exists := additionalInfo["call_times"]; exists {
		if times, ok := callTimes.([]time.Time); ok {
			earlyMorningCalls := 0
			for _, t := range times {
				hour := t.Hour()
				if hour >= 5 && hour <= 8 {
					earlyMorningCalls++
				}
			}
			return float64(earlyMorningCalls) / float64(len(times))
		}
	}
	return 0.0
}

// extractContactBookStatus checks if the number is in contact book
func (fe *FeatureExtractor) extractContactBookStatus(additionalInfo map[string]interface{}) float64 {
	if inContacts, exists := additionalInfo["in_contact_book"]; exists {
		if ic, ok := inContacts.(bool); ok && ic {
			return 1.0
		}
	}
	return 0.0
}

// extractConversationLength extracts average conversation length
func (fe *FeatureExtractor) extractConversationLength(additionalInfo map[string]interface{}) float64 {
	if length, exists := additionalInfo["avg_conversation_length"]; exists {
		if l, ok := length.(float64); ok {
			return math.Min(l/60.0, 1.0) // Normalize to 0-1, assuming 60 seconds is good length
		}
	}
	return 0.0
}

// extractResponseRate calculates how often the user responds to calls
func (fe *FeatureExtractor) extractResponseRate(additionalInfo map[string]interface{}) float64 {
	if rate, exists := additionalInfo["response_rate"]; exists {
		if r, ok := rate.(float64); ok {
			return r // Should already be 0-1
		}
	}
	return 0.0
}

// extractCallbackRate calculates how often the user calls back
func (fe *FeatureExtractor) extractCallbackRate(additionalInfo map[string]interface{}) float64 {
	if rate, exists := additionalInfo["callback_rate"]; exists {
		if r, ok := rate.(float64); ok {
			return r // Should already be 0-1
		}
	}
	return 0.0
}