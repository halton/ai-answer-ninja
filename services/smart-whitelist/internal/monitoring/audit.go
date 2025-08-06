package monitoring

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"
)

// AuditLogger provides comprehensive audit logging for security and compliance
type AuditLogger struct {
	logger         *zap.Logger
	buffer         chan *AuditEvent
	bufferSize     int
	flushInterval  time.Duration
	
	// Storage
	mu           sync.RWMutex
	events       []*AuditEvent
	maxEvents    int
	
	// Event handlers
	handlers map[AuditEventType][]AuditEventHandler
}

// AuditEventType represents the type of audit event
type AuditEventType string

const (
	// Authentication events
	EventUserLogin    AuditEventType = "user_login"
	EventUserLogout   AuditEventType = "user_logout"
	EventAuthFailure  AuditEventType = "auth_failure"
	
	// Data access events
	EventDataAccess   AuditEventType = "data_access"
	EventDataModify   AuditEventType = "data_modify"
	EventDataDelete   AuditEventType = "data_delete"
	EventDataExport   AuditEventType = "data_export"
	EventDataImport   AuditEventType = "data_import"
	
	// Whitelist events
	EventWhitelistAdd    AuditEventType = "whitelist_add"
	EventWhitelistRemove AuditEventType = "whitelist_remove"
	EventWhitelistUpdate AuditEventType = "whitelist_update"
	EventWhitelistQuery  AuditEventType = "whitelist_query"
	
	// ML events
	EventMLClassification AuditEventType = "ml_classification"
	EventMLTraining       AuditEventType = "ml_training"
	EventMLModelUpdate    AuditEventType = "ml_model_update"
	
	// Rule events
	EventRuleExecution AuditEventType = "rule_execution"
	EventRuleCreation  AuditEventType = "rule_creation"
	EventRuleUpdate    AuditEventType = "rule_update"
	EventRuleDelete    AuditEventType = "rule_delete"
	
	// Security events
	EventSecurityAlert     AuditEventType = "security_alert"
	EventPermissionDenied  AuditEventType = "permission_denied"
	EventSuspiciousActivity AuditEventType = "suspicious_activity"
	
	// System events
	EventSystemStart    AuditEventType = "system_start"
	EventSystemStop     AuditEventType = "system_stop"
	EventConfigChange   AuditEventType = "config_change"
	EventHealthCheck    AuditEventType = "health_check"
)

// AuditEvent represents a single audit event
type AuditEvent struct {
	// Basic event info
	ID        string         `json:"id"`
	Type      AuditEventType `json:"type"`
	Timestamp time.Time      `json:"timestamp"`
	Severity  string         `json:"severity"` // "low", "medium", "high", "critical"
	
	// Actor information (who performed the action)
	ActorID    string `json:"actor_id,omitempty"`
	ActorType  string `json:"actor_type,omitempty"` // "user", "system", "service"
	ActorIP    string `json:"actor_ip,omitempty"`
	SessionID  string `json:"session_id,omitempty"`
	UserAgent  string `json:"user_agent,omitempty"`
	
	// Resource information (what was acted upon)
	ResourceID   string `json:"resource_id,omitempty"`
	ResourceType string `json:"resource_type,omitempty"`
	ResourcePath string `json:"resource_path,omitempty"`
	
	// Action details
	Action      string                 `json:"action"`
	Status      string                 `json:"status"` // "success", "failure", "pending"
	Description string                 `json:"description"`
	Details     map[string]interface{} `json:"details,omitempty"`
	
	// Context and metadata
	Context      map[string]interface{} `json:"context,omitempty"`
	Tags         []string               `json:"tags,omitempty"`
	Correlation  string                 `json:"correlation_id,omitempty"`
	
	// Security and compliance
	SensitiveData bool   `json:"sensitive_data,omitempty"`
	DataHash      string `json:"data_hash,omitempty"`
	Checksum      string `json:"checksum"`
}

// AuditEventHandler is a function that handles audit events
type AuditEventHandler func(*AuditEvent)

// AuditQuery represents a query for audit events
type AuditQuery struct {
	StartTime    *time.Time      `json:"start_time,omitempty"`
	EndTime      *time.Time      `json:"end_time,omitempty"`
	EventTypes   []AuditEventType `json:"event_types,omitempty"`
	ActorID      *string         `json:"actor_id,omitempty"`
	ResourceID   *string         `json:"resource_id,omitempty"`
	Severity     []string        `json:"severity,omitempty"`
	Status       []string        `json:"status,omitempty"`
	Tags         []string        `json:"tags,omitempty"`
	Limit        int             `json:"limit,omitempty"`
	Offset       int             `json:"offset,omitempty"`
}

// AuditReport represents an audit report
type AuditReport struct {
	ID          string         `json:"id"`
	GeneratedAt time.Time      `json:"generated_at"`
	Query       *AuditQuery    `json:"query"`
	Events      []*AuditEvent  `json:"events"`
	Summary     *AuditSummary  `json:"summary"`
}

// AuditSummary represents a summary of audit events
type AuditSummary struct {
	TotalEvents       int                        `json:"total_events"`
	EventsByType      map[AuditEventType]int     `json:"events_by_type"`
	EventsBySeverity  map[string]int             `json:"events_by_severity"`
	EventsByStatus    map[string]int             `json:"events_by_status"`
	EventsByActor     map[string]int             `json:"events_by_actor"`
	FailureRate       float64                    `json:"failure_rate"`
	SecurityEvents    int                        `json:"security_events"`
	DataAccessEvents  int                        `json:"data_access_events"`
	TimeRange         string                     `json:"time_range"`
}

// NewAuditLogger creates a new audit logger
func NewAuditLogger(logger *zap.Logger) *AuditLogger {
	al := &AuditLogger{
		logger:        logger,
		bufferSize:    1000,
		flushInterval: 10 * time.Second,
		maxEvents:     100000, // Keep 100k events in memory
		events:        make([]*AuditEvent, 0),
		handlers:      make(map[AuditEventType][]AuditEventHandler),
	}
	
	// Create buffered channel
	al.buffer = make(chan *AuditEvent, al.bufferSize)
	
	// Start background processing
	go al.processEvents()
	go al.flushPeriodically()
	
	logger.Info("audit logger initialized",
		zap.Int("buffer_size", al.bufferSize),
		zap.Duration("flush_interval", al.flushInterval),
		zap.Int("max_events", al.maxEvents))
	
	return al
}

// LogEvent logs an audit event
func (al *AuditLogger) LogEvent(eventType AuditEventType, action, description string) *AuditEventBuilder {
	return al.NewEventBuilder(eventType, action, description)
}

// NewEventBuilder creates a new audit event builder
func (al *AuditLogger) NewEventBuilder(eventType AuditEventType, action, description string) *AuditEventBuilder {
	return &AuditEventBuilder{
		auditLogger: al,
		event: &AuditEvent{
			ID:          al.generateEventID(),
			Type:        eventType,
			Timestamp:   time.Now(),
			Action:      action,
			Description: description,
			Severity:    "medium", // Default severity
			Status:      "success", // Default status
			Details:     make(map[string]interface{}),
			Context:     make(map[string]interface{}),
			Tags:        make([]string, 0),
		},
	}
}

// QueryEvents queries audit events based on criteria
func (al *AuditLogger) QueryEvents(query *AuditQuery) ([]*AuditEvent, error) {
	al.mu.RLock()
	defer al.mu.RUnlock()
	
	filtered := al.filterEvents(query)
	
	// Apply pagination
	if query.Offset > 0 && query.Offset < len(filtered) {
		filtered = filtered[query.Offset:]
	}
	
	if query.Limit > 0 && query.Limit < len(filtered) {
		filtered = filtered[:query.Limit]
	}
	
	return filtered, nil
}

// GenerateReport generates an audit report
func (al *AuditLogger) GenerateReport(query *AuditQuery) (*AuditReport, error) {
	events, err := al.QueryEvents(query)
	if err != nil {
		return nil, err
	}
	
	summary := al.generateSummary(events, query)
	
	return &AuditReport{
		ID:          al.generateReportID(),
		GeneratedAt: time.Now(),
		Query:       query,
		Events:      events,
		Summary:     summary,
	}, nil
}

// RegisterHandler registers an event handler for a specific event type
func (al *AuditLogger) RegisterHandler(eventType AuditEventType, handler AuditEventHandler) {
	al.mu.Lock()
	defer al.mu.Unlock()
	
	if al.handlers[eventType] == nil {
		al.handlers[eventType] = make([]AuditEventHandler, 0)
	}
	
	al.handlers[eventType] = append(al.handlers[eventType], handler)
	
	al.logger.Info("audit event handler registered",
		zap.String("event_type", string(eventType)))
}

// GetSecurityAlerts returns recent security-related audit events
func (al *AuditLogger) GetSecurityAlerts(since time.Time) ([]*AuditEvent, error) {
	securityEventTypes := []AuditEventType{
		EventAuthFailure,
		EventSecurityAlert,
		EventPermissionDenied,
		EventSuspiciousActivity,
	}
	
	query := &AuditQuery{
		StartTime:  &since,
		EventTypes: securityEventTypes,
		Severity:   []string{"high", "critical"},
	}
	
	return al.QueryEvents(query)
}

// GetUserActivity returns audit events for a specific user
func (al *AuditLogger) GetUserActivity(userID string, since time.Time) ([]*AuditEvent, error) {
	query := &AuditQuery{
		StartTime: &since,
		ActorID:   &userID,
	}
	
	return al.QueryEvents(query)
}

// GetDataAccessLog returns data access events
func (al *AuditLogger) GetDataAccessLog(resourceID *string, since time.Time) ([]*AuditEvent, error) {
	dataEventTypes := []AuditEventType{
		EventDataAccess,
		EventDataModify,
		EventDataDelete,
		EventDataExport,
		EventDataImport,
	}
	
	query := &AuditQuery{
		StartTime:  &since,
		EventTypes: dataEventTypes,
		ResourceID: resourceID,
	}
	
	return al.QueryEvents(query)
}

// Close gracefully shuts down the audit logger
func (al *AuditLogger) Close() error {
	close(al.buffer)
	al.logger.Info("audit logger closed")
	return nil
}

// AuditEventBuilder provides a fluent interface for building audit events
type AuditEventBuilder struct {
	auditLogger *AuditLogger
	event       *AuditEvent
}

// Actor sets the actor information
func (b *AuditEventBuilder) Actor(actorID, actorType string) *AuditEventBuilder {
	b.event.ActorID = actorID
	b.event.ActorType = actorType
	return b
}

// IP sets the actor IP address
func (b *AuditEventBuilder) IP(ip string) *AuditEventBuilder {
	b.event.ActorIP = ip
	return b
}

// Session sets the session ID
func (b *AuditEventBuilder) Session(sessionID string) *AuditEventBuilder {
	b.event.SessionID = sessionID
	return b
}

// UserAgent sets the user agent
func (b *AuditEventBuilder) UserAgent(userAgent string) *AuditEventBuilder {
	b.event.UserAgent = userAgent
	return b
}

// Resource sets the resource information
func (b *AuditEventBuilder) Resource(resourceID, resourceType string) *AuditEventBuilder {
	b.event.ResourceID = resourceID
	b.event.ResourceType = resourceType
	return b
}

// ResourcePath sets the resource path
func (b *AuditEventBuilder) ResourcePath(path string) *AuditEventBuilder {
	b.event.ResourcePath = path
	return b
}

// Severity sets the event severity
func (b *AuditEventBuilder) Severity(severity string) *AuditEventBuilder {
	b.event.Severity = severity
	return b
}

// Status sets the event status
func (b *AuditEventBuilder) Status(status string) *AuditEventBuilder {
	b.event.Status = status
	return b
}

// Detail adds a detail field
func (b *AuditEventBuilder) Detail(key string, value interface{}) *AuditEventBuilder {
	b.event.Details[key] = value
	return b
}

// Context adds a context field
func (b *AuditEventBuilder) Context(key string, value interface{}) *AuditEventBuilder {
	b.event.Context[key] = value
	return b
}

// Tag adds a tag
func (b *AuditEventBuilder) Tag(tag string) *AuditEventBuilder {
	b.event.Tags = append(b.event.Tags, tag)
	return b
}

// Correlation sets the correlation ID
func (b *AuditEventBuilder) Correlation(correlationID string) *AuditEventBuilder {
	b.event.Correlation = correlationID
	return b
}

// SensitiveData marks the event as containing sensitive data
func (b *AuditEventBuilder) SensitiveData(dataToHash interface{}) *AuditEventBuilder {
	b.event.SensitiveData = true
	
	// Create hash of sensitive data
	if dataToHash != nil {
		if data, err := json.Marshal(dataToHash); err == nil {
			hash := sha256.Sum256(data)
			b.event.DataHash = hex.EncodeToString(hash[:])
		}
	}
	
	return b
}

// Commit commits the audit event
func (b *AuditEventBuilder) Commit() {
	// Generate checksum for integrity
	b.event.Checksum = b.generateChecksum()
	
	// Send to buffer (non-blocking)
	select {
	case b.auditLogger.buffer <- b.event:
		// Event buffered successfully
	default:
		// Buffer full, log warning and drop event
		b.auditLogger.logger.Warn("audit event buffer full, dropping event",
			zap.String("event_id", b.event.ID),
			zap.String("event_type", string(b.event.Type)))
	}
}

// processEvents processes events from the buffer
func (al *AuditLogger) processEvents() {
	for event := range al.buffer {
		al.storeEvent(event)
		al.callHandlers(event)
	}
}

// flushPeriodically flushes events periodically
func (al *AuditLogger) flushPeriodically() {
	ticker := time.NewTicker(al.flushInterval)
	defer ticker.Stop()
	
	for range ticker.C {
		al.flush()
	}
}

// storeEvent stores an event in memory
func (al *AuditLogger) storeEvent(event *AuditEvent) {
	al.mu.Lock()
	defer al.mu.Unlock()
	
	al.events = append(al.events, event)
	
	// Trim if too many events
	if len(al.events) > al.maxEvents {
		// Keep most recent events
		al.events = al.events[len(al.events)-al.maxEvents/2:]
	}
}

// callHandlers calls registered handlers for an event
func (al *AuditLogger) callHandlers(event *AuditEvent) {
	al.mu.RLock()
	handlers := al.handlers[event.Type]
	al.mu.RUnlock()
	
	for _, handler := range handlers {
		go func(h AuditEventHandler, e *AuditEvent) {
			defer func() {
				if r := recover(); r != nil {
					al.logger.Error("audit event handler panicked",
						zap.Any("panic", r),
						zap.String("event_id", e.ID))
				}
			}()
			h(e)
		}(handler, event)
	}
}

// flush performs any necessary flushing operations
func (al *AuditLogger) flush() {
	// In a production system, this would flush events to persistent storage
	al.logger.Debug("audit events flushed")
}

// filterEvents filters events based on query criteria
func (al *AuditLogger) filterEvents(query *AuditQuery) []*AuditEvent {
	filtered := make([]*AuditEvent, 0)
	
	for _, event := range al.events {
		if al.matchesQuery(event, query) {
			filtered = append(filtered, event)
		}
	}
	
	return filtered
}

// matchesQuery checks if an event matches the query criteria
func (al *AuditLogger) matchesQuery(event *AuditEvent, query *AuditQuery) bool {
	// Time range filter
	if query.StartTime != nil && event.Timestamp.Before(*query.StartTime) {
		return false
	}
	if query.EndTime != nil && event.Timestamp.After(*query.EndTime) {
		return false
	}
	
	// Event type filter
	if len(query.EventTypes) > 0 {
		found := false
		for _, eventType := range query.EventTypes {
			if event.Type == eventType {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	
	// Actor filter
	if query.ActorID != nil && event.ActorID != *query.ActorID {
		return false
	}
	
	// Resource filter
	if query.ResourceID != nil && event.ResourceID != *query.ResourceID {
		return false
	}
	
	// Severity filter
	if len(query.Severity) > 0 {
		found := false
		for _, severity := range query.Severity {
			if event.Severity == severity {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	
	// Status filter
	if len(query.Status) > 0 {
		found := false
		for _, status := range query.Status {
			if event.Status == status {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	
	// Tags filter (event must have at least one of the query tags)
	if len(query.Tags) > 0 {
		found := false
		for _, queryTag := range query.Tags {
			for _, eventTag := range event.Tags {
				if queryTag == eventTag {
					found = true
					break
				}
			}
			if found {
				break
			}
		}
		if !found {
			return false
		}
	}
	
	return true
}

// generateSummary generates a summary of audit events
func (al *AuditLogger) generateSummary(events []*AuditEvent, query *AuditQuery) *AuditSummary {
	summary := &AuditSummary{
		TotalEvents:      len(events),
		EventsByType:     make(map[AuditEventType]int),
		EventsBySeverity: make(map[string]int),
		EventsByStatus:   make(map[string]int),
		EventsByActor:    make(map[string]int),
	}
	
	failures := 0
	securityEvents := 0
	dataAccessEvents := 0
	
	for _, event := range events {
		// Count by type
		summary.EventsByType[event.Type]++
		
		// Count by severity
		summary.EventsBySeverity[event.Severity]++
		
		// Count by status
		summary.EventsByStatus[event.Status]++
		if event.Status == "failure" {
			failures++
		}
		
		// Count by actor
		if event.ActorID != "" {
			summary.EventsByActor[event.ActorID]++
		}
		
		// Count security events
		if al.isSecurityEvent(event.Type) {
			securityEvents++
		}
		
		// Count data access events
		if al.isDataAccessEvent(event.Type) {
			dataAccessEvents++
		}
	}
	
	// Calculate failure rate
	if summary.TotalEvents > 0 {
		summary.FailureRate = float64(failures) / float64(summary.TotalEvents)
	}
	
	summary.SecurityEvents = securityEvents
	summary.DataAccessEvents = dataAccessEvents
	
	// Build time range string
	if query.StartTime != nil && query.EndTime != nil {
		summary.TimeRange = query.StartTime.Format(time.RFC3339) + " to " + query.EndTime.Format(time.RFC3339)
	}
	
	return summary
}

// generateEventID generates a unique event ID
func (al *AuditLogger) generateEventID() string {
	return uuid.New().String()
}

// generateReportID generates a unique report ID
func (al *AuditLogger) generateReportID() string {
	return "report_" + uuid.New().String()
}

// generateChecksum generates a checksum for event integrity
func (b *AuditEventBuilder) generateChecksum() string {
	// Create a hash of key event fields for integrity checking
	data := fmt.Sprintf("%s|%s|%s|%s|%s|%s",
		b.event.ID,
		string(b.event.Type),
		b.event.Timestamp.Format(time.RFC3339Nano),
		b.event.ActorID,
		b.event.Action,
		b.event.Status)
	
	hash := sha256.Sum256([]byte(data))
	return hex.EncodeToString(hash[:])
}

// isSecurityEvent checks if an event type is security-related
func (al *AuditLogger) isSecurityEvent(eventType AuditEventType) bool {
	securityEvents := map[AuditEventType]bool{
		EventAuthFailure:        true,
		EventSecurityAlert:      true,
		EventPermissionDenied:   true,
		EventSuspiciousActivity: true,
	}
	
	return securityEvents[eventType]
}

// isDataAccessEvent checks if an event type is data access-related
func (al *AuditLogger) isDataAccessEvent(eventType AuditEventType) bool {
	dataAccessEvents := map[AuditEventType]bool{
		EventDataAccess: true,
		EventDataModify: true,
		EventDataDelete: true,
		EventDataExport: true,
		EventDataImport: true,
	}
	
	return dataAccessEvents[eventType]
}