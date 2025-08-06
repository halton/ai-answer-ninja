package services

import (
	"github.com/google/uuid"
	"go.uber.org/zap"

	"smart-whitelist/internal/cache"
	"smart-whitelist/internal/config"
	"smart-whitelist/internal/integration"
	"smart-whitelist/internal/ml"
	"smart-whitelist/internal/monitoring"
	"smart-whitelist/internal/repository"
)

// ServiceContainer holds all service dependencies
type ServiceContainer struct {
	Config                 *config.Config
	Logger                 *zap.Logger
	CacheService          *cache.CacheService
	Classifier            *ml.ContactClassifier
	RulesEngine           *ml.RulesEngine
	WhitelistRepo         *repository.WhitelistRepository
	SpamProfileRepo       *repository.SpamProfileRepository
	UserRepo              *repository.UserRepository
	MetricsCollector      *monitoring.MetricsCollector
	AuditLogger           *monitoring.AuditLogger
	UserManagementClient  *integration.UserManagementClient
}

// NewSmartWhitelistService creates a new smart whitelist service for dependency injection
func NewSmartWhitelistService(container *ServiceContainer) *SmartWhitelistService {
	service := &SmartWhitelistService{
		config:               container.Config,
		logger:               container.Logger,
		cacheService:         container.CacheService,
		classifier:           container.Classifier,
		whitelistRepo:        container.WhitelistRepo,
		spamProfileRepo:      container.SpamProfileRepo,
		userRepo:             container.UserRepo,
		learningQueue:        make(chan *LearningEvent, 1000),
		learningWorkers:      container.Config.ML.FeatureExtractionWorkers,
		learningStats:        make(map[uuid.UUID]*UserLearningStats),
		rulesEngine:          container.RulesEngine,
		metricsCollector:     container.MetricsCollector,
		auditLogger:          container.AuditLogger,
		userManagementClient: container.UserManagementClient,
	}

	// Start learning workers
	service.startLearningWorkers()

	container.Logger.Info("smart whitelist service initialized",
		zap.Int("learning_workers", service.learningWorkers),
		zap.Bool("ml_enabled", container.Config.ML.Enabled),
		zap.Bool("rules_engine_enabled", container.RulesEngine != nil),
		zap.Bool("metrics_enabled", container.MetricsCollector != nil),
		zap.Bool("audit_enabled", container.AuditLogger != nil),
		zap.Bool("user_mgmt_integration", container.UserManagementClient != nil))

	return service
}

// NewServiceContainer creates a fully configured service container
func NewServiceContainer(cfg *config.Config, logger *zap.Logger) (*ServiceContainer, error) {
	container := &ServiceContainer{
		Config: cfg,
		Logger: logger,
	}
	
	// Initialize repositories
	// (In a real implementation, you'd initialize database connections here)
	container.WhitelistRepo = &repository.WhitelistRepository{} // Mock
	container.SpamProfileRepo = &repository.SpamProfileRepository{} // Mock
	container.UserRepo = &repository.UserRepository{} // Mock
	
	// Initialize cache service
	var err error
	container.CacheService, err = cache.NewCacheService(
		&cfg.Redis,
		container.WhitelistRepo,
		container.UserRepo,
		container.SpamProfileRepo,
		logger,
	)
	if err != nil {
		return nil, err
	}
	
	// Initialize ML components
	container.Classifier = ml.NewContactClassifier(&cfg.ML, logger)
	container.RulesEngine = ml.NewRulesEngine(&cfg.ML, logger)
	
	// Initialize monitoring
	container.MetricsCollector = monitoring.NewMetricsCollector(logger)
	container.AuditLogger = monitoring.NewAuditLogger(logger)
	
	// Initialize integrations
	if cfg.Integration.UserManagementURL != "" {
		container.UserManagementClient = integration.NewUserManagementClient(cfg, logger)
	}
	
	logger.Info("service container initialized successfully")
	return container, nil
}

// Close gracefully shuts down all services in the container
func (c *ServiceContainer) Close() error {
	var errors []error
	
	if c.CacheService != nil {
		if err := c.CacheService.Close(); err != nil {
			errors = append(errors, err)
		}
	}
	
	if c.AuditLogger != nil {
		if err := c.AuditLogger.Close(); err != nil {
			errors = append(errors, err)
		}
	}
	
	if c.UserManagementClient != nil {
		if err := c.UserManagementClient.Close(); err != nil {
			errors = append(errors, err)
		}
	}
	
	if len(errors) > 0 {
		return errors[0] // Return first error
	}
	
	c.Logger.Info("service container closed successfully")
	return nil
}