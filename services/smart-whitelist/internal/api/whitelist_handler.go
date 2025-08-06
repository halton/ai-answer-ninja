package api

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
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

	// Build query parameters for multiple entries
	query := &models.WhitelistQuery{
		UserID: &userID,
	}

	// Parse pagination
	limit := 50
	if l := c.Query("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 1000 {
			limit = parsed
		}
	}
	query.Limit = limit

	offset := 0
	if o := c.Query("offset"); o != "" {
		if parsed, err := strconv.Atoi(o); err == nil && parsed >= 0 {
			offset = parsed
		}
	}
	query.Offset = offset

	// Parse filters
	if whitelistType := c.Query("type"); whitelistType != "" {
		wlType := models.WhitelistType(whitelistType)
		query.WhitelistType = &wlType
	}

	if isActive := c.Query("active"); isActive != "" {
		if active, err := strconv.ParseBool(isActive); err == nil {
			query.IsActive = &active
		}
	}

	if includeExpired := c.Query("include_expired"); includeExpired != "" {
		if expired, err := strconv.ParseBool(includeExpired); err == nil {
			query.IncludeExpired = expired
		}
	}

	// Get entries from cache service
	entries, err := h.cacheService.GetWhitelistEntries(c.Request.Context(), query)
	if err != nil {
		h.logger.Error("failed to get whitelist entries", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve whitelist entries"})
		return
	}

	// Get total count for pagination
	totalCount, err := h.cacheService.GetWhitelistCount(c.Request.Context(), query)
	if err != nil {
		h.logger.Warn("failed to get total count", zap.Error(err))
		totalCount = int64(len(entries))
	}

	h.logger.Debug("whitelist entries retrieved",
		zap.String("user_id", userID.String()),
		zap.Int("count", len(entries)),
		zap.Duration("duration", time.Since(start)))

	c.JSON(http.StatusOK, gin.H{
		"entries": entries,
		"meta": gin.H{
			"processing_time_ms": time.Since(start).Milliseconds(),
			"limit":             limit,
			"offset":            offset,
			"total":             totalCount,
			"returned":          len(entries),
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

// BatchCreate creates multiple whitelist entries
// POST /api/v1/whitelist/:userId/batch
func (h *WhitelistHandler) BatchCreate(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		h.logger.Warn("invalid user ID", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	var req models.BatchCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.logger.Warn("invalid batch create request", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
		return
	}

	req.UserID = userID

	start := time.Now()
	createdEntries := make([]*models.SmartWhitelist, 0, len(req.Entries))
	failedEntries := make([]gin.H, 0)

	for i, entry := range req.Entries {
		entry.UserID = userID
		created, err := h.cacheService.CreateWhitelist(c.Request.Context(), &entry)
		if err != nil {
			h.logger.Warn("failed to create whitelist entry in batch",
				zap.Error(err),
				zap.Int("index", i),
				zap.String("phone", entry.ContactPhone[:4]+"****"))

			failedEntries = append(failedEntries, gin.H{
				"index":        i,
				"contact_phone": entry.ContactPhone[:4] + "****",
				"error":        err.Error(),
			})
			continue
		}

		createdEntries = append(createdEntries, created)
	}

	h.logger.Info("batch whitelist creation completed",
		zap.String("user_id", userID.String()),
		zap.Int("total_requested", len(req.Entries)),
		zap.Int("created", len(createdEntries)),
		zap.Int("failed", len(failedEntries)),
		zap.Duration("duration", time.Since(start)))

	c.JSON(http.StatusOK, gin.H{
		"created_entries": createdEntries,
		"failed_entries":  failedEntries,
		"summary": gin.H{
			"total_requested": len(req.Entries),
			"created":         len(createdEntries),
			"failed":          len(failedEntries),
		},
		"meta": gin.H{
			"processing_time_ms": time.Since(start).Milliseconds(),
			"operation":         "batch_create",
		},
	})
}

// UpdateEntry updates a whitelist entry
// PUT /api/v1/whitelist/:userId/:entryId
func (h *WhitelistHandler) UpdateEntry(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		h.logger.Warn("invalid user ID", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	entryID, err := uuid.Parse(c.Param("entryId"))
	if err != nil {
		h.logger.Warn("invalid entry ID", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid entry ID"})
		return
	}

	var req models.UpdateWhitelistRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.logger.Warn("invalid update request", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
		return
	}

	start := time.Now()
	updatedEntry, err := h.cacheService.UpdateWhitelist(c.Request.Context(), entryID, &req)
	if err != nil {
		h.logger.Error("failed to update whitelist entry", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update whitelist entry"})
		return
	}

	// Verify ownership
	if updatedEntry.UserID != userID {
		h.logger.Warn("unauthorized update attempt",
			zap.String("user_id", userID.String()),
			zap.String("entry_owner", updatedEntry.UserID.String()))
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	h.logger.Info("whitelist entry updated",
		zap.String("user_id", userID.String()),
		zap.String("entry_id", entryID.String()),
		zap.Duration("duration", time.Since(start)))

	c.JSON(http.StatusOK, gin.H{
		"entry": updatedEntry,
		"meta": gin.H{
			"processing_time_ms": time.Since(start).Milliseconds(),
			"operation":         "update",
		},
	})
}

// CleanupExpired removes expired whitelist entries
// DELETE /api/v1/whitelist/:userId/cleanup
func (h *WhitelistHandler) CleanupExpired(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		h.logger.Warn("invalid user ID", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	start := time.Now()
	count, err := h.cacheService.CleanupExpired(c.Request.Context(), userID)
	if err != nil {
		h.logger.Error("failed to cleanup expired entries", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to cleanup expired entries"})
		return
	}

	h.logger.Info("expired whitelist entries cleaned up",
		zap.String("user_id", userID.String()),
		zap.Int64("cleaned_count", count),
		zap.Duration("duration", time.Since(start)))

	c.JSON(http.StatusOK, gin.H{
		"message":       "Expired entries cleaned up",
		"cleaned_count": count,
		"meta": gin.H{
			"processing_time_ms": time.Since(start).Milliseconds(),
			"operation":         "cleanup_expired",
		},
	})
}

// ExportWhitelist exports user's whitelist in different formats
// GET /api/v1/whitelist/:userId/export?format=json|csv
func (h *WhitelistHandler) ExportWhitelist(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		h.logger.Warn("invalid user ID", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	format := c.Query("format")
	if format == "" {
		format = "json"
	}

	start := time.Now()
	query := &models.WhitelistQuery{
		UserID:         &userID,
		IncludeExpired: true,
		Limit:          0, // No limit for export
	}

	entries, err := h.cacheService.GetWhitelistEntries(c.Request.Context(), query)
	if err != nil {
		h.logger.Error("failed to get whitelist entries for export", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to export whitelist"})
		return
	}

	switch format {
	case "csv":
		h.exportCSV(c, entries, userID, time.Since(start))
	case "json":
		falllthrough
	default:
		h.exportJSON(c, entries, userID, time.Since(start))
	}
}

func (h *WhitelistHandler) exportJSON(c *gin.Context, entries []*models.SmartWhitelist, userID uuid.UUID, duration time.Duration) {
	c.Header("Content-Type", "application/json")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=whitelist_%s.json", userID.String()))

	exportData := gin.H{
		"export_info": gin.H{
			"user_id":      userID.String(),
			"exported_at":  time.Now(),
			"total_entries": len(entries),
			"format":       "json",
		},
		"entries": entries,
	}

	h.logger.Info("whitelist exported as JSON",
		zap.String("user_id", userID.String()),
		zap.Int("entry_count", len(entries)),
		zap.Duration("duration", duration))

	c.JSON(http.StatusOK, exportData)
}

func (h *WhitelistHandler) exportCSV(c *gin.Context, entries []*models.SmartWhitelist, userID uuid.UUID, duration time.Duration) {
	c.Header("Content-Type", "text/csv")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=whitelist_%s.csv", userID.String()))

	// CSV header
	csv := "ID,Contact Phone,Contact Name,Type,Confidence Score,Active,Created At,Expires At\n"

	for _, entry := range entries {
		contactName := ""
		if entry.ContactName != nil {
			contactName = *entry.ContactName
		}

		expiresAt := ""
		if entry.ExpiresAt != nil {
			expiresAt = entry.ExpiresAt.Format(time.RFC3339)
		}

		csv += fmt.Sprintf("%s,%s,\"%s\",%s,%.2f,%t,%s,%s\n",
			entry.ID.String(),
			entry.ContactPhone,
			contactName,
			entry.WhitelistType,
			entry.ConfidenceScore,
			entry.IsActive,
			entry.CreatedAt.Format(time.RFC3339),
			expiresAt,
		)
	}

	h.logger.Info("whitelist exported as CSV",
		zap.String("user_id", userID.String()),
		zap.Int("entry_count", len(entries)),
		zap.Duration("duration", duration))

	c.String(http.StatusOK, csv)
}

// ImportWhitelist imports whitelist from uploaded file
// POST /api/v1/whitelist/:userId/import
func (h *WhitelistHandler) ImportWhitelist(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		h.logger.Warn("invalid user ID", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		h.logger.Warn("no file uploaded", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": "No file uploaded"})
		return
	}
	defer file.Close()

	// File size limit (10MB)
	if header.Size > 10*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "File too large (max 10MB)"})
		return
	}

	start := time.Now()

	// Parse import mode
	mode := c.PostForm("mode")
	if mode == "" {
		mode = "merge" // Default to merge mode
	}

	// Handle different file formats
	var entries []models.CreateWhitelistRequest
	contentType := header.Header.Get("Content-Type")

	switch {
	case strings.Contains(contentType, "json") || strings.HasSuffix(header.Filename, ".json"):
		entries, err = h.parseJSONImport(file)
	case strings.Contains(contentType, "csv") || strings.HasSuffix(header.Filename, ".csv"):
		entries, err = h.parseCSVImport(file)
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported file format (only JSON and CSV supported)"})
		return
	}

	if err != nil {
		h.logger.Error("failed to parse import file", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Failed to parse file: %v", err)})
		return
	}

	if len(entries) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No valid entries found in file"})
		return
	}

	if len(entries) > 10000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Too many entries (max 10000)"})
		return
	}

	// Clear existing entries if replace mode
	if mode == "replace" {
		if err := h.cacheService.ClearUserWhitelist(c.Request.Context(), userID); err != nil {
			h.logger.Error("failed to clear existing whitelist", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to clear existing entries"})
			return
		}
	}

	// Batch create entries
	createdCount := 0
	skippedCount := 0
	failedEntries := make([]gin.H, 0)

	for i, entry := range entries {
		entry.UserID = userID
		_, err := h.cacheService.CreateWhitelist(c.Request.Context(), &entry)
		if err != nil {
			if mode == "merge" && strings.Contains(err.Error(), "already exists") {
				skippedCount++
				continue
			}

			failedEntries = append(failedEntries, gin.H{
				"index": i,
				"phone": entry.ContactPhone[:4] + "****",
				"error": err.Error(),
			})
			continue
		}

		createdCount++
	}

	h.logger.Info("whitelist import completed",
		zap.String("user_id", userID.String()),
		zap.String("filename", header.Filename),
		zap.String("mode", mode),
		zap.Int("total_entries", len(entries)),
		zap.Int("created", createdCount),
		zap.Int("skipped", skippedCount),
		zap.Int("failed", len(failedEntries)),
		zap.Duration("duration", time.Since(start)))

	c.JSON(http.StatusOK, gin.H{
		"message": "Import completed",
		"summary": gin.H{
			"filename":      header.Filename,
			"mode":          mode,
			"total_entries": len(entries),
			"created":       createdCount,
			"skipped":       skippedCount,
			"failed":        len(failedEntries),
		},
		"failed_entries": failedEntries,
		"meta": gin.H{
			"processing_time_ms": time.Since(start).Milliseconds(),
			"operation":         "import",
		},
	})
}

func (h *WhitelistHandler) parseJSONImport(file io.Reader) ([]models.CreateWhitelistRequest, error) {
	var importData struct {
		Entries []models.CreateWhitelistRequest `json:"entries"`
	}

	if err := json.NewDecoder(file).Decode(&importData); err != nil {
		return nil, fmt.Errorf("invalid JSON format: %v", err)
	}

	return importData.Entries, nil
}

func (h *WhitelistHandler) parseCSVImport(file io.Reader) ([]models.CreateWhitelistRequest, error) {
	// This is a simplified CSV parser - in production you'd want a more robust solution
	scanner := bufio.NewScanner(file)
	var entries []models.CreateWhitelistRequest

	// Skip header
	if !scanner.Scan() {
		return nil, fmt.Errorf("empty file")
	}

	lineNum := 1
	for scanner.Scan() {
		lineNum++
		line := scanner.Text()
		fields := strings.Split(line, ",")

		if len(fields) < 2 {
			continue // Skip invalid lines
		}

		entry := models.CreateWhitelistRequest{
			ContactPhone:  strings.TrimSpace(fields[0]),
			WhitelistType: models.WhitelistTypeManual,
		}

		if len(fields) > 1 && strings.TrimSpace(fields[1]) != "" {
			name := strings.Trim(strings.TrimSpace(fields[1]), "\"")
			entry.ContactName = &name
		}

		if len(fields) > 2 {
			if wlType := strings.TrimSpace(fields[2]); wlType != "" {
				entry.WhitelistType = models.WhitelistType(wlType)
			}
		}

		entries = append(entries, entry)
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("error reading file: %v", err)
	}

	return entries, nil
}