package metrics

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.uber.org/zap"

	"smart-whitelist/internal/config"
)

// MetricsCollector collects and exposes metrics for the smart whitelist service
type MetricsCollector struct {
	config *config.MetricsConfig
	logger *zap.Logger

	// HTTP metrics
	httpRequestsTotal   *prometheus.CounterVec
	httpRequestDuration *prometheus.HistogramVec

	// Whitelist operation metrics
	whitelistLookupsTotal     *prometheus.CounterVec
	whitelistLookupDuration   *prometheus.HistogramVec
	whitelistCacheHitRate     prometheus.Gauge
	whitelistOperationsTotal  *prometheus.CounterVec

	// ML classification metrics
	mlClassificationsTotal   *prometheus.CounterVec
	mlClassificationDuration *prometheus.HistogramVec
	mlModelAccuracy          prometheus.Gauge
	mlTrainingSamples        prometheus.Gauge
	mlLearningEventsTotal    *prometheus.CounterVec

	// Cache metrics
	cacheOperationsTotal  *prometheus.CounterVec
	cacheHitRate         prometheus.Gauge
	cacheMissRate        prometheus.Gauge

	// Database metrics
	dbConnectionsActive prometheus.Gauge
	dbQueriesTotal      *prometheus.CounterVec
	dbQueryDuration     *prometheus.HistogramVec

	// System metrics
	goroutinesActive   prometheus.Gauge
	memoryUsage       prometheus.Gauge
	lastUpdateTime    prometheus.Gauge

	// Internal state
	mu               sync.RWMutex
	cacheHits        int64
	cacheMisses      int64
	totalLookups     int64
	successfulLookups int64
}

// NewMetricsCollector creates a new metrics collector
func NewMetricsCollector(cfg *config.MetricsConfig, logger *zap.Logger) *MetricsCollector {
	if !cfg.Enabled {
		logger.Info("metrics collection disabled")
		return &MetricsCollector{
			config: cfg,
			logger: logger,
		}
	}

	histogramBuckets := cfg.HistogramBuckets
	if len(histogramBuckets) == 0 {
		histogramBuckets = []float64{0.0005, 0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0}
	}

	collector := &MetricsCollector{
		config: cfg,
		logger: logger,

		// HTTP metrics
		httpRequestsTotal: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "smart_whitelist_http_requests_total",
				Help: "Total number of HTTP requests processed",
			},
			[]string{"method", "endpoint", "status_code"},
		),

		httpRequestDuration: prometheus.NewHistogramVec(
			prometheus.HistogramOpts{
				Name:    "smart_whitelist_http_request_duration_seconds",
				Help:    "HTTP request duration in seconds",
				Buckets: histogramBuckets,
			},
			[]string{"method", "endpoint"},
		),

		// Whitelist operation metrics
		whitelistLookupsTotal: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "smart_whitelist_lookups_total",
				Help: "Total number of whitelist lookups performed",
			},
			[]string{"result", "source"}, // result: hit/miss, source: cache/db
		),

		whitelistLookupDuration: prometheus.NewHistogramVec(
			prometheus.HistogramOpts{
				Name:    "smart_whitelist_lookup_duration_seconds",
				Help:    "Whitelist lookup duration in seconds",
				Buckets: []float64{0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5},
			},
			[]string{"source"},
		),

		whitelistCacheHitRate: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "smart_whitelist_cache_hit_rate",
				Help: "Cache hit rate for whitelist lookups",
			},
		),

		whitelistOperationsTotal: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "smart_whitelist_operations_total",
				Help: "Total number of whitelist operations",
			},
			[]string{"operation", "result"}, // operation: add/remove/update, result: success/error
		),

		// ML classification metrics
		mlClassificationsTotal: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "smart_whitelist_ml_classifications_total",
				Help: "Total number of ML classifications performed",
			},
			[]string{"classification", "confidence_level"}, // classification: spam/legitimate, confidence: high/medium/low
		),

		mlClassificationDuration: prometheus.NewHistogramVec(
			prometheus.HistogramOpts{
				Name:    "smart_whitelist_ml_classification_duration_seconds",
				Help:    "ML classification duration in seconds",
				Buckets: []float64{0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5},
			},
			[]string{"classification"},
		),

		mlModelAccuracy: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "smart_whitelist_ml_model_accuracy",
				Help: "Current ML model accuracy",
			},
		),

		mlTrainingSamples: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "smart_whitelist_ml_training_samples",
				Help: "Number of training samples used by ML model",
			},
		),

		mlLearningEventsTotal: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "smart_whitelist_ml_learning_events_total",
				Help: "Total number of ML learning events processed",
			},
			[]string{"event_type"}, // event_type: accept/reject/timeout
		),

		// Cache metrics
		cacheOperationsTotal: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "smart_whitelist_cache_operations_total",
				Help: "Total number of cache operations",
			},
			[]string{"operation", "result"}, // operation: get/set/delete, result: hit/miss/error
		),

		cacheHitRate: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "smart_whitelist_cache_hit_rate_percent",
				Help: "Overall cache hit rate percentage",
			},
		),

		cacheMissRate: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "smart_whitelist_cache_miss_rate_percent",
				Help: "Overall cache miss rate percentage",
			},
		),

		// Database metrics
		dbConnectionsActive: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "smart_whitelist_db_connections_active",
				Help: "Number of active database connections",
			},
		),

		dbQueriesTotal: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "smart_whitelist_db_queries_total",
				Help: "Total number of database queries",
			},
			[]string{"operation", "result"}, // operation: select/insert/update/delete, result: success/error
		),

		dbQueryDuration: prometheus.NewHistogramVec(
			prometheus.HistogramOpts{
				Name:    "smart_whitelist_db_query_duration_seconds",
				Help:    "Database query duration in seconds",
				Buckets: []float64{0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0},
			},
			[]string{"operation"},
		),

		// System metrics
		goroutinesActive: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "smart_whitelist_goroutines_active",
				Help: "Number of active goroutines",
			},
		),

		memoryUsage: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "smart_whitelist_memory_usage_bytes",
				Help: "Memory usage in bytes",
			},
		),

		lastUpdateTime: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "smart_whitelist_last_update_timestamp",
				Help: "Timestamp of last metrics update",
			},
		),
	}

	// Register all metrics
	collector.registerMetrics()

	logger.Info("metrics collector initialized",
		zap.Bool("enabled", cfg.Enabled),
		zap.String("path", cfg.Path))

	return collector
}

// registerMetrics registers all metrics with Prometheus
func (m *MetricsCollector) registerMetrics() {
	if !m.config.Enabled {
		return
	}

	prometheus.MustRegister(
		// HTTP metrics
		m.httpRequestsTotal,
		m.httpRequestDuration,

		// Whitelist metrics
		m.whitelistLookupsTotal,
		m.whitelistLookupDuration,
		m.whitelistCacheHitRate,
		m.whitelistOperationsTotal,

		// ML metrics
		m.mlClassificationsTotal,
		m.mlClassificationDuration,
		m.mlModelAccuracy,
		m.mlTrainingSamples,
		m.mlLearningEventsTotal,

		// Cache metrics
		m.cacheOperationsTotal,
		m.cacheHitRate,
		m.cacheMissRate,

		// Database metrics
		m.dbConnectionsActive,
		m.dbQueriesTotal,
		m.dbQueryDuration,

		// System metrics
		m.goroutinesActive,
		m.memoryUsage,
		m.lastUpdateTime,
	)
}

// RecordHTTPRequest records HTTP request metrics
func (m *MetricsCollector) RecordHTTPRequest(method, endpoint string, statusCode int, duration time.Duration) {
	if !m.config.Enabled {
		return
	}

	m.httpRequestsTotal.WithLabelValues(method, endpoint, strconv.Itoa(statusCode)).Inc()
	m.httpRequestDuration.WithLabelValues(method, endpoint).Observe(duration.Seconds())
}

// RecordWhitelistLookup records whitelist lookup metrics
func (m *MetricsCollector) RecordWhitelistLookup(result, source string, duration time.Duration) {
	if !m.config.Enabled {
		return
	}

	m.whitelistLookupsTotal.WithLabelValues(result, source).Inc()
	m.whitelistLookupDuration.WithLabelValues(source).Observe(duration.Seconds())

	// Update internal counters for hit rate calculation
	m.mu.Lock()
	m.totalLookups++
	if result == "hit" {
		m.successfulLookups++
	}
	if source == "cache" && result == "hit" {
		m.cacheHits++
	} else if source == "cache" && result == "miss" {
		m.cacheMisses++
	}
	m.mu.Unlock()

	// Update hit rate gauge
	m.updateCacheHitRate()
}

// RecordWhitelistOperation records whitelist operation metrics
func (m *MetricsCollector) RecordWhitelistOperation(operation, result string) {
	if !m.config.Enabled {
		return
	}

	m.whitelistOperationsTotal.WithLabelValues(operation, result).Inc()
}

// RecordMLClassification records ML classification metrics
func (m *MetricsCollector) RecordMLClassification(classification string, confidence float64, duration time.Duration) {
	if !m.config.Enabled {
		return
	}

	confidenceLevel := "low"
	if confidence > 0.8 {
		confidenceLevel = "high"
	} else if confidence > 0.6 {
		confidenceLevel = "medium"
	}

	m.mlClassificationsTotal.WithLabelValues(classification, confidenceLevel).Inc()
	m.mlClassificationDuration.WithLabelValues(classification).Observe(duration.Seconds())
}

// UpdateMLModelStats updates ML model statistics
func (m *MetricsCollector) UpdateMLModelStats(accuracy float64, trainingSamples int) {
	if !m.config.Enabled {
		return
	}

	m.mlModelAccuracy.Set(accuracy)
	m.mlTrainingSamples.Set(float64(trainingSamples))
}

// RecordMLLearningEvent records ML learning event metrics
func (m *MetricsCollector) RecordMLLearningEvent(eventType string) {
	if !m.config.Enabled {
		return
	}

	m.mlLearningEventsTotal.WithLabelValues(eventType).Inc()
}

// RecordCacheOperation records cache operation metrics
func (m *MetricsCollector) RecordCacheOperation(operation, result string) {
	if !m.config.Enabled {
		return
	}

	m.cacheOperationsTotal.WithLabelValues(operation, result).Inc()
}

// RecordDBQuery records database query metrics
func (m *MetricsCollector) RecordDBQuery(operation, result string, duration time.Duration) {
	if !m.config.Enabled {
		return
	}

	m.dbQueriesTotal.WithLabelValues(operation, result).Inc()
	m.dbQueryDuration.WithLabelValues(operation).Observe(duration.Seconds())
}

// UpdateSystemMetrics updates system-level metrics
func (m *MetricsCollector) UpdateSystemMetrics(goroutines int, memoryBytes int64) {
	if !m.config.Enabled {
		return
	}

	m.goroutinesActive.Set(float64(goroutines))
	m.memoryUsage.Set(float64(memoryBytes))
	m.lastUpdateTime.Set(float64(time.Now().Unix()))
}

// UpdateDBConnectionsActive updates the active database connections metric
func (m *MetricsCollector) UpdateDBConnectionsActive(count int) {
	if !m.config.Enabled {
		return
	}

	m.dbConnectionsActive.Set(float64(count))
}

// updateCacheHitRate calculates and updates cache hit rate
func (m *MetricsCollector) updateCacheHitRate() {
	m.mu.RLock()
	hits := m.cacheHits
	misses := m.cacheMisses
	m.mu.RUnlock()

	total := hits + misses
	if total > 0 {
		hitRate := float64(hits) / float64(total) * 100
		missRate := float64(misses) / float64(total) * 100
		m.cacheHitRate.Set(hitRate)
		m.cacheMissRate.Set(missRate)
	}
}

// Handler returns the Prometheus metrics handler
func Handler() http.Handler {
	return promhttp.Handler()
}

// GetStats returns current metrics statistics
func (m *MetricsCollector) GetStats() map[string]interface{} {
	if !m.config.Enabled {
		return map[string]interface{}{
			"metrics_enabled": false,
		}
	}

	m.mu.RLock()
	defer m.mu.RUnlock()

	return map[string]interface{}{
		"metrics_enabled":     true,
		"total_lookups":       m.totalLookups,
		"successful_lookups":  m.successfulLookups,
		"cache_hits":         m.cacheHits,
		"cache_misses":       m.cacheMisses,
		"cache_hit_rate":     func() float64 {
			total := m.cacheHits + m.cacheMisses
			if total > 0 {
				return float64(m.cacheHits) / float64(total) * 100
			}
			return 0
		}(),
	}
}