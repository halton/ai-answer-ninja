package monitoring

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"
)

// MetricsCollector collects and manages performance and business metrics
type MetricsCollector struct {
	logger    *zap.Logger
	startTime time.Time

	// Metrics storage
	mu             sync.RWMutex
	counters       map[string]int64
	gauges         map[string]float64
	histograms     map[string]*Histogram
	timeSeries     map[string][]TimeSeriesPoint
	businessMetrics map[string]interface{}

	// Configuration
	maxTimeSeriesPoints int
	metricsRetention    time.Duration
}

// TimeSeriesPoint represents a point in time series data
type TimeSeriesPoint struct {
	Timestamp time.Time   `json:"timestamp"`
	Value     float64     `json:"value"`
	Labels    map[string]string `json:"labels,omitempty"`
}

// Histogram represents a histogram of values
type Histogram struct {
	Buckets  map[float64]int64 `json:"buckets"`
	Count    int64             `json:"count"`
	Sum      float64           `json:"sum"`
	Min      float64           `json:"min"`
	Max      float64           `json:"max"`
	Created  time.Time         `json:"created"`
}

// MetricsSummary represents a summary of all metrics
type MetricsSummary struct {
	Timestamp       time.Time                `json:"timestamp"`
	UptimeSeconds   float64                  `json:"uptime_seconds"`
	Counters        map[string]int64         `json:"counters"`
	Gauges          map[string]float64       `json:"gauges"`
	Histograms      map[string]*Histogram    `json:"histograms"`
	BusinessMetrics map[string]interface{}   `json:"business_metrics"`
	HealthStatus    string                   `json:"health_status"`
}

// NewMetricsCollector creates a new metrics collector
func NewMetricsCollector(logger *zap.Logger) *MetricsCollector {
	mc := &MetricsCollector{
		logger:              logger,
		startTime:           time.Now(),
		counters:            make(map[string]int64),
		gauges:              make(map[string]float64),
		histograms:          make(map[string]*Histogram),
		timeSeries:          make(map[string][]TimeSeriesPoint),
		businessMetrics:     make(map[string]interface{}),
		maxTimeSeriesPoints: 1000,
		metricsRetention:    24 * time.Hour,
	}

	// Initialize basic counters
	mc.initializeBaseMetrics()

	// Start background cleanup routine
	go mc.cleanupRoutine()

	logger.Info("metrics collector initialized")
	return mc
}

// IncrementCounter increments a counter metric
func (mc *MetricsCollector) IncrementCounter(name string, value int64, labels ...string) {
	mc.mu.Lock()
	defer mc.mu.Unlock()

	key := mc.buildKey(name, labels...)
	mc.counters[key] += value

	// Also add to time series
	mc.addToTimeSeries(key, float64(value))
}

// SetGauge sets a gauge metric value
func (mc *MetricsCollector) SetGauge(name string, value float64, labels ...string) {
	mc.mu.Lock()
	defer mc.mu.Unlock()

	key := mc.buildKey(name, labels...)
	mc.gauges[key] = value

	// Also add to time series
	mc.addToTimeSeries(key, value)
}

// RecordHistogram records a value in a histogram
func (mc *MetricsCollector) RecordHistogram(name string, value float64, labels ...string) {
	mc.mu.Lock()
	defer mc.mu.Unlock()

	key := mc.buildKey(name, labels...)
	
	if mc.histograms[key] == nil {
		mc.histograms[key] = &Histogram{
			Buckets: make(map[float64]int64),
			Min:     value,
			Max:     value,
			Created: time.Now(),
		}
	}

	hist := mc.histograms[key]
	hist.Count++
	hist.Sum += value

	if value < hist.Min {
		hist.Min = value
	}
	if value > hist.Max {
		hist.Max = value
	}

	// Add to appropriate bucket
	bucket := mc.findHistogramBucket(value)
	hist.Buckets[bucket]++

	// Also add to time series
	mc.addToTimeSeries(key, value)
}

// SetBusinessMetric sets a business-specific metric
func (mc *MetricsCollector) SetBusinessMetric(name string, value interface{}) {
	mc.mu.Lock()
	defer mc.mu.Unlock()

	mc.businessMetrics[name] = value
}

// GetMetricsSummary returns a summary of all metrics
func (mc *MetricsCollector) GetMetricsSummary() *MetricsSummary {
	mc.mu.RLock()
	defer mc.mu.RUnlock()

	// Deep copy maps to avoid concurrent access issues
	counters := make(map[string]int64)
	for k, v := range mc.counters {
		counters[k] = v
	}

	gauges := make(map[string]float64)
	for k, v := range mc.gauges {
		gauges[k] = v
	}

	histograms := make(map[string]*Histogram)
	for k, v := range mc.histograms {
		histograms[k] = mc.copyHistogram(v)
	}

	businessMetrics := make(map[string]interface{})
	for k, v := range mc.businessMetrics {
		businessMetrics[k] = v
	}

	return &MetricsSummary{
		Timestamp:       time.Now(),
		UptimeSeconds:   time.Since(mc.startTime).Seconds(),
		Counters:        counters,
		Gauges:          gauges,
		Histograms:      histograms,
		BusinessMetrics: businessMetrics,
		HealthStatus:    mc.calculateHealthStatus(),
	}
}

// GetTimeSeriesData returns time series data for a metric
func (mc *MetricsCollector) GetTimeSeriesData(name string, since time.Time) []TimeSeriesPoint {
	mc.mu.RLock()
	defer mc.mu.RUnlock()

	if points, exists := mc.timeSeries[name]; exists {
		filtered := make([]TimeSeriesPoint, 0)
		for _, point := range points {
			if point.Timestamp.After(since) {
				filtered = append(filtered, point)
			}
		}
		return filtered
	}

	return []TimeSeriesPoint{}
}

// RecordAPICall records metrics for an API call
func (mc *MetricsCollector) RecordAPICall(endpoint string, method string, statusCode int, duration time.Duration) {
	mc.IncrementCounter("api_requests_total", 1, "endpoint", endpoint, "method", method, "status", string(rune(statusCode)))
	mc.RecordHistogram("api_request_duration_ms", float64(duration.Milliseconds()), "endpoint", endpoint, "method", method)

	if statusCode >= 400 {
		mc.IncrementCounter("api_errors_total", 1, "endpoint", endpoint, "method", method, "status", string(rune(statusCode)))
	}
}

// RecordCacheOperation records cache operation metrics
func (mc *MetricsCollector) RecordCacheOperation(operation string, hit bool, duration time.Duration) {
	hitStatus := "miss"
	if hit {
		hitStatus = "hit"
	}

	mc.IncrementCounter("cache_operations_total", 1, "operation", operation, "result", hitStatus)
	mc.RecordHistogram("cache_operation_duration_ms", float64(duration.Milliseconds()), "operation", operation)

	// Calculate and update cache hit rate
	mc.updateCacheHitRate(operation, hit)
}

// RecordMLOperation records machine learning operation metrics
func (mc *MetricsCollector) RecordMLOperation(operation string, confidence float64, duration time.Duration, success bool) {
	status := "success"
	if !success {
		status = "failure"
	}

	mc.IncrementCounter("ml_operations_total", 1, "operation", operation, "status", status)
	mc.RecordHistogram("ml_operation_duration_ms", float64(duration.Milliseconds()), "operation", operation)
	mc.RecordHistogram("ml_confidence_score", confidence, "operation", operation)
}

// RecordWhitelistOperation records whitelist operation metrics
func (mc *MetricsCollector) RecordWhitelistOperation(operation string, userID uuid.UUID, success bool, duration time.Duration) {
	status := "success"
	if !success {
		status = "failure"
	}

	mc.IncrementCounter("whitelist_operations_total", 1, "operation", operation, "status", status)
	mc.RecordHistogram("whitelist_operation_duration_ms", float64(duration.Milliseconds()), "operation", operation)

	// Update user-specific metrics
	mc.SetBusinessMetric("last_whitelist_operation_"+userID.String(), time.Now())
}

// RecordRuleExecution records rule engine execution metrics
func (mc *MetricsCollector) RecordRuleExecution(ruleID string, triggered bool, impact float64, duration time.Duration) {
	triggerStatus := "not_triggered"
	if triggered {
		triggerStatus = "triggered"
	}

	mc.IncrementCounter("rules_executed_total", 1, "rule", ruleID, "triggered", triggerStatus)
	mc.RecordHistogram("rule_execution_duration_ms", float64(duration.Milliseconds()), "rule", ruleID)
	
	if triggered {
		mc.RecordHistogram("rule_impact_score", impact, "rule", ruleID)
	}
}

// UpdateBusinessKPIs updates key business metrics
func (mc *MetricsCollector) UpdateBusinessKPIs(userID uuid.UUID, kpis map[string]float64) {
	for name, value := range kpis {
		mc.SetBusinessMetric("kpi_"+name+"_"+userID.String(), value)
		mc.SetGauge("business_kpi_"+name, value, "user", userID.String())
	}
}

// initializeBaseMetrics initializes basic system metrics
func (mc *MetricsCollector) initializeBaseMetrics() {
	// Initialize common counters
	mc.counters["api_requests_total"] = 0
	mc.counters["api_errors_total"] = 0
	mc.counters["cache_operations_total"] = 0
	mc.counters["ml_operations_total"] = 0
	mc.counters["whitelist_operations_total"] = 0
	mc.counters["rules_executed_total"] = 0

	// Initialize gauges
	mc.gauges["service_uptime_seconds"] = 0
	mc.gauges["cache_hit_rate"] = 0
	mc.gauges["ml_average_confidence"] = 0
}

// buildKey builds a metric key with labels
func (mc *MetricsCollector) buildKey(name string, labels ...string) string {
	key := name
	for i := 0; i < len(labels); i += 2 {
		if i+1 < len(labels) {
			key += "__" + labels[i] + "_" + labels[i+1]
		}
	}
	return key
}

// addToTimeSeries adds a point to time series data
func (mc *MetricsCollector) addToTimeSeries(key string, value float64) {
	if mc.timeSeries[key] == nil {
		mc.timeSeries[key] = make([]TimeSeriesPoint, 0, mc.maxTimeSeriesPoints)
	}

	point := TimeSeriesPoint{
		Timestamp: time.Now(),
		Value:     value,
	}

	mc.timeSeries[key] = append(mc.timeSeries[key], point)

	// Trim if too many points
	if len(mc.timeSeries[key]) > mc.maxTimeSeriesPoints {
		mc.timeSeries[key] = mc.timeSeries[key][len(mc.timeSeries[key])-mc.maxTimeSeriesPoints:]
	}
}

// findHistogramBucket finds the appropriate bucket for a histogram value
func (mc *MetricsCollector) findHistogramBucket(value float64) float64 {
	// Predefined buckets: 0.1, 0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, +Inf
	buckets := []float64{0.1, 0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000}
	
	for _, bucket := range buckets {
		if value <= bucket {
			return bucket
		}
	}
	
	return 999999 // +Inf bucket
}

// copyHistogram creates a deep copy of a histogram
func (mc *MetricsCollector) copyHistogram(original *Histogram) *Histogram {
	buckets := make(map[float64]int64)
	for k, v := range original.Buckets {
		buckets[k] = v
	}

	return &Histogram{
		Buckets: buckets,
		Count:   original.Count,
		Sum:     original.Sum,
		Min:     original.Min,
		Max:     original.Max,
		Created: original.Created,
	}
}

// calculateHealthStatus determines overall health status based on metrics
func (mc *MetricsCollector) calculateHealthStatus() string {
	// Simple health calculation based on error rates
	totalRequests := mc.counters["api_requests_total"]
	totalErrors := mc.counters["api_errors_total"]

	if totalRequests == 0 {
		return "unknown"
	}

	errorRate := float64(totalErrors) / float64(totalRequests)

	if errorRate < 0.01 { // Less than 1% error rate
		return "healthy"
	} else if errorRate < 0.05 { // Less than 5% error rate
		return "degraded"
	} else {
		return "unhealthy"
	}
}

// updateCacheHitRate calculates and updates cache hit rate
func (mc *MetricsCollector) updateCacheHitRate(operation string, hit bool) {
	// This is a simplified calculation - in production you'd want a more sophisticated approach
	hitKey := "cache_hits_" + operation
	totalKey := "cache_total_" + operation

	if hit {
		mc.counters[hitKey]++
	}
	mc.counters[totalKey]++

	if mc.counters[totalKey] > 0 {
		hitRate := float64(mc.counters[hitKey]) / float64(mc.counters[totalKey])
		mc.gauges["cache_hit_rate_"+operation] = hitRate
	}
}

// cleanupRoutine performs periodic cleanup of old metrics data
func (mc *MetricsCollector) cleanupRoutine() {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for range ticker.C {
		mc.cleanupOldData()
	}
}

// cleanupOldData removes old time series data
func (mc *MetricsCollector) cleanupOldData() {
	mc.mu.Lock()
	defer mc.mu.Unlock()

	cutoff := time.Now().Add(-mc.metricsRetention)

	for key, points := range mc.timeSeries {
		filtered := make([]TimeSeriesPoint, 0)
		for _, point := range points {
			if point.Timestamp.After(cutoff) {
				filtered = append(filtered, point)
			}
		}
		mc.timeSeries[key] = filtered
	}

	mc.logger.Debug("cleaned up old metrics data")
}

// Export metrics in Prometheus format (simplified)
func (mc *MetricsCollector) ExportPrometheus() string {
	mc.mu.RLock()
	defer mc.mu.RUnlock()

	result := "# Prometheus metrics export\n"
	
	// Export counters
	for name, value := range mc.counters {
		result += "# TYPE " + name + " counter\n"
		result += name + " " + string(rune(value)) + "\n"
	}

	// Export gauges
	for name, value := range mc.gauges {
		result += "# TYPE " + name + " gauge\n"
		result += name + " " + string(rune(int64(value))) + "\n"
	}

	// Export histograms (simplified)
	for name, hist := range mc.histograms {
		result += "# TYPE " + name + " histogram\n"
		result += name + "_count " + string(rune(hist.Count)) + "\n"
		result += name + "_sum " + string(rune(int64(hist.Sum))) + "\n"
		
		for bucket, count := range hist.Buckets {
			result += name + "_bucket{le=\"" + string(rune(int64(bucket))) + "\"} " + string(rune(count)) + "\n"
		}
	}

	return result
}