package services

import (
	"github.com/google/uuid"
	"go.uber.org/zap"

	"smart-whitelist/internal/cache"
	"smart-whitelist/internal/config"
	"smart-whitelist/internal/ml"
	"smart-whitelist/internal/repository"
)

// NewSmartWhitelistService creates a new smart whitelist service for dependency injection
func NewSmartWhitelistService(
	cfg *config.Config,
	logger *zap.Logger,
	cacheService *cache.CacheService,
	classifier *ml.ContactClassifier,
	whitelistRepo *repository.WhitelistRepository,
	spamProfileRepo *repository.SpamProfileRepository,
	userRepo *repository.UserRepository,
) *SmartWhitelistService {
	service := &SmartWhitelistService{
		config:          cfg,
		logger:          logger,
		cacheService:    cacheService,
		classifier:      classifier,
		whitelistRepo:   whitelistRepo,
		spamProfileRepo: spamProfileRepo,
		userRepo:        userRepo,
		learningQueue:   make(chan *LearningEvent, 1000),
		learningWorkers: cfg.ML.FeatureExtractionWorkers,
		learningStats:   make(map[uuid.UUID]*UserLearningStats),
	}

	// Start learning workers
	service.startLearningWorkers()

	logger.Info("smart whitelist service initialized",
		zap.Int("learning_workers", service.learningWorkers),
		zap.Bool("ml_enabled", cfg.ML.Enabled))

	return service
}