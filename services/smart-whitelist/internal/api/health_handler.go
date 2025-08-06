package api

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"smart-whitelist/internal/cache"
	"smart-whitelist/internal/ml"
	"smart-whitelist/internal/repository"
)

// HealthHandler handles health check endpoints
type HealthHandler struct {
	cacheService *cache.CacheService
	classifier   *ml.ContactClassifier
	whitelistRepo *repository.WhitelistRepository
	logger       *zap.Logger
}

// NewHealthHandler creates a new health handler
func NewHealthHandler(
	cacheService *cache.CacheService,
	classifier *ml.ContactClassifier,
	whitelistRepo *repository.WhitelistRepository,
	logger *zap.Logger,
) *HealthHandler {
	return &HealthHandler{
		cacheService:  cacheService,
		classifier:    classifier,
		whitelistRepo: whitelistRepo,
		logger:        logger,
	}
}

// Health returns basic health status
// GET /health
func (h *HealthHandler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"service":   "smart-whitelist",
		"version":   "1.0.0",
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

// Ready checks if the service is ready to handle requests
// GET /health/ready
func (h *HealthHandler) Ready(c *gin.Context) {
	start := time.Now()
	
	checks := make(map[string]interface{})
	allHealthy := true

	// Check cache connectivity
	cacheCtx, cacheCancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cacheCancel()
	
	cacheStart := time.Now()
	if err := h.cacheService.Ping(cacheCtx); err != nil {
		checks["cache"] = map[string]interface{}{
			"status":    "unhealthy",
			"error":     err.Error(),
			"duration":  time.Since(cacheStart).Milliseconds(),
		}
		allHealthy = false
		h.logger.Warn("cache health check failed", zap.Error(err))
	} else {
		checks["cache"] = map[string]interface{}{
			"status":   "healthy",
			"duration": time.Since(cacheStart).Milliseconds(),
		}
	}

	// Check database connectivity (through repository)
	dbStart := time.Now()
	dbCtx, dbCancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer dbCancel()
	
	if err := h.whitelistRepo.HealthCheck(dbCtx); err != nil {
		checks["database"] = map[string]interface{}{
			"status":    "unhealthy",
			"error":     err.Error(),
			"duration":  time.Since(dbStart).Milliseconds(),
		}
		allHealthy = false
		h.logger.Warn("database health check failed", zap.Error(err))
	} else {
		checks["database"] = map[string]interface{}{
			"status":   "healthy",
			"duration": time.Since(dbStart).Milliseconds(),
		}
	}

	// Check ML classifier
	mlStart := time.Now()
	mlStats := h.classifier.GetModelStats()
	checks["ml_classifier"] = map[string]interface{}{
		"status":              "healthy",
		"enabled":             mlStats.IsEnabled,
		"training_samples":    mlStats.TrainingSamples,
		"model_accuracy":      mlStats.ModelAccuracy,
		"last_model_update":   mlStats.LastModelUpdate,
		"duration":           time.Since(mlStart).Milliseconds(),
	}

	// Overall status
	status := http.StatusOK
	overallStatus := "ready"
	if !allHealthy {
		status = http.StatusServiceUnavailable
		overallStatus = "not_ready"
	}

	response := gin.H{
		"status":           overallStatus,
		"service":          "smart-whitelist",
		"checks":           checks,
		"total_duration":   time.Since(start).Milliseconds(),
		"timestamp":        time.Now().Format(time.RFC3339),
	}

	c.JSON(status, response)
}

// Live checks if the service is alive (minimal check)
// GET /health/live
func (h *HealthHandler) Live(c *gin.Context) {
	// Minimal liveness check - just return success if we can handle the request
	c.JSON(http.StatusOK, gin.H{
		"status":    "alive",
		"service":   "smart-whitelist",
		"timestamp": time.Now().Format(time.RFC3339),
	})
}