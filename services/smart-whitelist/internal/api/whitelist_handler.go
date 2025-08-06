package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"

	"smart-whitelist/internal/cache"
	"smart-whitelist/internal/models"
	"smart-whitelist/internal/services"
)

// WhitelistHandler handles HTTP requests for whitelist operations
type WhitelistHandler struct {
	whitelistService *services.SmartWhitelistService
	cacheService     *cache.CacheService
	logger           *zap.Logger
}

// NewWhitelistHandler creates a new whitelist handler
func NewWhitelistHandler(
	whitelistService *services.SmartWhitelistService,
	cacheService *cache.CacheService,
	logger *zap.Logger,
) *WhitelistHandler {
	return &WhitelistHandler{
		whitelistService: whitelistService,
		cacheService:     cacheService,
		logger:           logger,
	}
}

// GetWhitelist retrieves whitelist entries for a user
// GET /api/v1/whitelist/:userId
func (h *WhitelistHandler) GetWhitelist(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		h.logger.Warn("invalid user ID", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	// Optional phone filter
	phone := c.Query("phone")

	start := time.Now()
	
	if phone != "" {
		// Single lookup
		entry, err := h.cacheService.GetWhitelist(c.Request.Context(), userID, phone)
		if err != nil {
			h.logger.Error("failed to get whitelist entry", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve whitelist"})
			return
		}

		if entry == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Whitelist entry not found"})
			return
		}

		h.logger.Debug("whitelist entry retrieved",
			zap.String("user_id", userID.String()),
			zap.Duration("duration", time.Since(start)))

		c.JSON(http.StatusOK, gin.H{
			"entry": entry,
			"meta": gin.H{
				"processing_time_ms": time.Since(start).Milliseconds(),
				"source":            "cache",
			},
		})
		return
	}

	// Multiple entries - this would typically involve pagination
	limit := 50
	if l := c.Query("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 1000 {
			limit = parsed
		}
	}

	offset := 0
	if o := c.Query("offset"); o != "" {
		if parsed, err := strconv.Atoi(o); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	// This would typically call a repository method to get multiple entries
	h.logger.Debug("multiple whitelist entries requested",
		zap.String("user_id", userID.String()),
		zap.Int("limit", limit),
		zap.Int("offset", offset))

	// For now, return placeholder response
	c.JSON(http.StatusOK, gin.H{
		"entries": []interface{}{},
		"meta": gin.H{
			"processing_time_ms": time.Since(start).Milliseconds(),
			"limit":             limit,
			"offset":            offset,
			"total":             0,
		},
	})
}

// SmartAdd intelligently adds a phone number to whitelist
// POST /api/v1/whitelist/:userId/smart-add
func (h *WhitelistHandler) SmartAdd(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		h.logger.Warn("invalid user ID", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	var req models.SmartAddRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.logger.Warn("invalid request body", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
		return
	}

	req.UserID = userID

	start := time.Now()
	entry, err := h.whitelistService.SmartAdd(c.Request.Context(), &req)
	if err != nil {
		h.logger.Error("failed to smart add to whitelist", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add to whitelist"})
		return
	}

	h.logger.Info("phone number added to whitelist",
		zap.String("user_id", userID.String()),
		zap.String("contact_phone", req.ContactPhone[:4]+"****"),
		zap.Duration("duration", time.Since(start)))

	c.JSON(http.StatusCreated, gin.H{
		"entry": entry,
		"meta": gin.H{
			"processing_time_ms": time.Since(start).Milliseconds(),
			"operation":         "smart_add",
		},
	})
}

// Remove removes a phone number from whitelist
// DELETE /api/v1/whitelist/:userId/:phone
func (h *WhitelistHandler) Remove(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		h.logger.Warn("invalid user ID", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	phone := c.Param("phone")
	if phone == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Phone number is required"})
		return
	}

	start := time.Now()

	// First get the entry to find its ID
	entry, err := h.cacheService.GetWhitelist(c.Request.Context(), userID, phone)
	if err != nil {
		h.logger.Error("failed to get whitelist entry for deletion", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process request"})
		return
	}

	if entry == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Whitelist entry not found"})
		return
	}

	err = h.cacheService.DeleteWhitelist(c.Request.Context(), entry.ID)
	if err != nil {
		h.logger.Error("failed to remove from whitelist", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove from whitelist"})
		return
	}

	h.logger.Info("phone number removed from whitelist",
		zap.String("user_id", userID.String()),
		zap.String("contact_phone", phone[:4]+"****"),
		zap.Duration("duration", time.Since(start)))

	c.JSON(http.StatusOK, gin.H{
		"message": "Phone number removed from whitelist",
		"meta": gin.H{
			"processing_time_ms": time.Since(start).Milliseconds(),
			"operation":         "remove",
		},
	})
}

// EvaluatePhone evaluates a phone number using ML
// GET /api/v1/whitelist/evaluate/:phone
func (h *WhitelistHandler) EvaluatePhone(c *gin.Context) {
	phone := c.Param("phone")
	if phone == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Phone number is required"})
		return
	}

	var userID uuid.UUID
	if userIDStr := c.Query("user_id"); userIDStr != "" {
		var err error
		userID, err = uuid.Parse(userIDStr)
		if err != nil {
			h.logger.Warn("invalid user ID in query", zap.Error(err))
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
			return
		}
	}

	// Build evaluation request
	req := &models.EvaluationRequest{
		Phone:   phone,
		UserID:  userID,
		Context: make(map[string]interface{}),
	}

	// Add context from query parameters
	if context := c.Query("context"); context != "" {
		req.Context["context"] = context
	}

	start := time.Now()
	result, err := h.whitelistService.EvaluatePhone(c.Request.Context(), req)
	if err != nil {
		h.logger.Error("failed to evaluate phone", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to evaluate phone"})
		return
	}

	h.logger.Debug("phone evaluation completed",
		zap.String("phone", phone[:4]+"****"),
		zap.Duration("duration", time.Since(start)),
		zap.String("classification", result.Classification))

	c.JSON(http.StatusOK, gin.H{
		"result": result,
		"meta": gin.H{
			"processing_time_ms": time.Since(start).Milliseconds(),
			"operation":         "evaluate",
		},
	})
}

// RecordLearning records learning feedback
// POST /api/v1/whitelist/learning
func (h *WhitelistHandler) RecordLearning(c *gin.Context) {
	var req models.LearningEvent
	if err := c.ShouldBindJSON(&req); err != nil {
		h.logger.Warn("invalid learning request", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
		return
	}

	req.Timestamp = time.Now()

	start := time.Now()
	err := h.whitelistService.RecordLearning(c.Request.Context(), &req)
	if err != nil {
		h.logger.Error("failed to record learning", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to record learning"})
		return
	}

	h.logger.Debug("learning event recorded",
		zap.String("user_id", req.UserID.String()),
		zap.String("event_type", req.EventType),
		zap.Duration("duration", time.Since(start)))

	c.JSON(http.StatusOK, gin.H{
		"message": "Learning event recorded successfully",
		"meta": gin.H{
			"processing_time_ms": time.Since(start).Milliseconds(),
			"operation":         "record_learning",
		},
	})
}

// UpdateRules updates user-specific whitelist rules
// PUT /api/v1/whitelist/rules/:userId
func (h *WhitelistHandler) UpdateRules(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		h.logger.Warn("invalid user ID", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	var rules map[string]interface{}
	if err := c.ShouldBindJSON(&rules); err != nil {
		h.logger.Warn("invalid rules request", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
		return
	}

	start := time.Now()
	err = h.whitelistService.UpdateUserRules(c.Request.Context(), userID, rules)
	if err != nil {
		h.logger.Error("failed to update user rules", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update rules"})
		return
	}

	h.logger.Info("user rules updated",
		zap.String("user_id", userID.String()),
		zap.Duration("duration", time.Since(start)))

	c.JSON(http.StatusOK, gin.H{
		"message": "User rules updated successfully",
		"meta": gin.H{
			"processing_time_ms": time.Since(start).Milliseconds(),
			"operation":         "update_rules",
		},
	})
}

// GetStats retrieves whitelist statistics for a user
// GET /api/v1/whitelist/stats/:userId
func (h *WhitelistHandler) GetStats(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		h.logger.Warn("invalid user ID", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	start := time.Now()

	// Get whitelist stats
	whitelistStats, err := h.cacheService.GetStats(c.Request.Context(), userID)
	if err != nil {
		h.logger.Error("failed to get whitelist stats", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve statistics"})
		return
	}

	// Get learning stats
	learningStats := h.whitelistService.GetLearningStats(userID)

	// Combine stats
	combinedStats := gin.H{
		"whitelist": whitelistStats,
		"learning":  learningStats,
		"meta": gin.H{
			"processing_time_ms": time.Since(start).Milliseconds(),
			"operation":         "get_stats",
		},
	}

	h.logger.Debug("stats retrieved",
		zap.String("user_id", userID.String()),
		zap.Duration("duration", time.Since(start)))

	c.JSON(http.StatusOK, combinedStats)
}