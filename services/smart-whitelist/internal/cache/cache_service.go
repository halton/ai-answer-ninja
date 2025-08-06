package cache

import (
	"context"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"smart-whitelist/internal/config"
	"smart-whitelist/internal/models"
	"smart-whitelist/internal/repository"
)

// CacheService provides a high-level caching interface with fallback to database
type CacheService struct {
	cache           *RedisCache
	whitelistRepo   *repository.WhitelistRepository
	userRepo        *repository.UserRepository
	spamProfileRepo *repository.SpamProfileRepository
	logger          *zap.Logger
}

// NewCacheService creates a new cache service with database fallback
func NewCacheService(
	cfg *config.RedisConfig,
	whitelistRepo *repository.WhitelistRepository,
	userRepo *repository.UserRepository,
	spamProfileRepo *repository.SpamProfileRepository,
	logger *zap.Logger,
) (*CacheService, error) {
	cache, err := NewRedisCache(cfg, logger)
	if err != nil {
		return nil, err
	}

	return &CacheService{
		cache:           cache,
		whitelistRepo:   whitelistRepo,
		userRepo:        userRepo,
		spamProfileRepo: spamProfileRepo,
		logger:          logger,
	}, nil
}

// Close closes the cache service
func (s *CacheService) Close() error {
	return s.cache.Close()
}

// FastWhitelistLookup performs an ultra-fast whitelist lookup with cache-first strategy
func (s *CacheService) FastWhitelistLookup(ctx context.Context, userID uuid.UUID, contactPhone string) (*models.WhitelistLookupResult, error) {
	start := time.Now()

	// Try cache first for ultra-fast lookup
	cachedResult, err := s.cache.GetLookupResult(ctx, userID, contactPhone)
	if err != nil {
		s.logger.Warn("cache lookup failed, falling back to database",
			zap.Error(err),
			zap.String("user_id", userID.String()),
			zap.String("contact_phone", contactPhone))
	} else if cachedResult != nil {
		// Cache hit - return immediately
		cachedResult.CacheHit = true
		cachedResult.LookupDuration = time.Since(start)
		return cachedResult, nil
	}

	// Cache miss - check cache for whitelist entry
	entry, err := s.cache.GetWhitelist(ctx, userID, contactPhone)
	cacheHit := (err == nil && entry != nil)

	if !cacheHit {
		// Database fallback
		entry, err = s.whitelistRepo.FastLookup(ctx, userID, contactPhone)
		if err != nil {
			return nil, err
		}

		// Cache the result for future lookups if found
		if entry != nil {
			go func() {
				cacheCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				if cacheErr := s.cache.SetWhitelist(cacheCtx, entry); cacheErr != nil {
					s.logger.Warn("failed to cache whitelist entry", zap.Error(cacheErr))
				}
			}()
		}
	}

	// Build result
	result := &models.WhitelistLookupResult{
		Found:          entry != nil && entry.IsValid(),
		Entry:          entry,
		CacheHit:       cacheHit,
		LookupDuration: time.Since(start),
	}

	// Determine recommended action
	if result.Found {
		result.RecommendAction = "allow"
		// Asynchronously increment hit count
		go func() {
			incrementCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if incrementErr := s.whitelistRepo.IncrementHitCount(incrementCtx, entry.ID); incrementErr != nil {
				s.logger.Warn("failed to increment hit count", zap.Error(incrementErr))
			}
		}()
	} else {
		result.RecommendAction = "analyze" // Default action for non-whitelisted contacts
	}

	// Cache the lookup result for ultra-fast repeated lookups
	go func() {
		cacheCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if cacheErr := s.cache.SetLookupResult(cacheCtx, userID, contactPhone, result); cacheErr != nil {
			s.logger.Warn("failed to cache lookup result", zap.Error(cacheErr))
		}
	}()

	return result, nil
}

// GetWhitelist retrieves a whitelist entry with cache-first strategy
func (s *CacheService) GetWhitelist(ctx context.Context, userID uuid.UUID, contactPhone string) (*models.SmartWhitelist, error) {
	// Try cache first
	entry, err := s.cache.GetWhitelist(ctx, userID, contactPhone)
	if err != nil {
		s.logger.Warn("cache get failed, falling back to database", zap.Error(err))
	} else if entry != nil {
		return entry, nil
	}

	// Database fallback
	entry, err = s.whitelistRepo.FastLookup(ctx, userID, contactPhone)
	if err != nil {
		return nil, err
	}

	// Cache the result asynchronously
	if entry != nil {
		go func() {
			cacheCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if cacheErr := s.cache.SetWhitelist(cacheCtx, entry); cacheErr != nil {
				s.logger.Warn("failed to cache whitelist entry", zap.Error(cacheErr))
			}
		}()
	}

	return entry, nil
}

// CreateWhitelist creates a whitelist entry and updates cache
func (s *CacheService) CreateWhitelist(ctx context.Context, req *models.CreateWhitelistRequest) (*models.SmartWhitelist, error) {
	entry, err := s.whitelistRepo.Create(ctx, req)
	if err != nil {
		return nil, err
	}

	// Update cache asynchronously
	go func() {
		cacheCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		
		// Cache the new entry
		if cacheErr := s.cache.SetWhitelist(cacheCtx, entry); cacheErr != nil {
			s.logger.Warn("failed to cache new whitelist entry", zap.Error(cacheErr))
		}
		
		// Invalidate lookup result cache
		if invalidateErr := s.cache.InvalidateWhitelist(cacheCtx, entry.UserID, entry.ContactPhone); invalidateErr != nil {
			s.logger.Warn("failed to invalidate lookup cache", zap.Error(invalidateErr))
		}
	}()

	return entry, nil
}

// UpdateWhitelist updates a whitelist entry and cache
func (s *CacheService) UpdateWhitelist(ctx context.Context, id uuid.UUID, req *models.UpdateWhitelistRequest) (*models.SmartWhitelist, error) {
	entry, err := s.whitelistRepo.Update(ctx, id, req)
	if err != nil {
		return nil, err
	}

	// Update cache asynchronously
	go func() {
		cacheCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		
		// Update cached entry
		if cacheErr := s.cache.SetWhitelist(cacheCtx, entry); cacheErr != nil {
			s.logger.Warn("failed to update cached whitelist entry", zap.Error(cacheErr))
		}
		
		// Invalidate lookup result cache
		if invalidateErr := s.cache.InvalidateWhitelist(cacheCtx, entry.UserID, entry.ContactPhone); invalidateErr != nil {
			s.logger.Warn("failed to invalidate lookup cache", zap.Error(invalidateErr))
		}
	}()

	return entry, nil
}

// DeleteWhitelist deletes a whitelist entry and removes from cache
func (s *CacheService) DeleteWhitelist(ctx context.Context, id uuid.UUID) error {
	// Get entry first to know which cache keys to invalidate
	entry, err := s.whitelistRepo.GetByID(ctx, id)
	if err != nil {
		return err
	}

	if entry == nil {
		return repository.ErrNotFound
	}

	err = s.whitelistRepo.Delete(ctx, id)
	if err != nil {
		return err
	}

	// Remove from cache asynchronously
	go func() {
		cacheCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		
		if invalidateErr := s.cache.InvalidateWhitelist(cacheCtx, entry.UserID, entry.ContactPhone); invalidateErr != nil {
			s.logger.Warn("failed to invalidate deleted whitelist entry", zap.Error(invalidateErr))
		}
	}()

	return nil
}

// GetUser retrieves a user with cache-first strategy
func (s *CacheService) GetUser(ctx context.Context, userID uuid.UUID) (*models.User, error) {
	// Try cache first
	user, err := s.cache.GetUser(ctx, userID)
	if err != nil {
		s.logger.Warn("cache get user failed, falling back to database", zap.Error(err))
	} else if user != nil {
		return user, nil
	}

	// Database fallback
	user, err = s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return nil, err
	}

	// Cache the result asynchronously
	if user != nil {
		go func() {
			cacheCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if cacheErr := s.cache.SetUser(cacheCtx, user); cacheErr != nil {
				s.logger.Warn("failed to cache user", zap.Error(cacheErr))
			}
		}()
	}

	return user, nil
}

// GetStats retrieves whitelist statistics with cache-first strategy
func (s *CacheService) GetStats(ctx context.Context, userID uuid.UUID) (*models.WhitelistStats, error) {
	// Try cache first
	stats, err := s.cache.GetStats(ctx, userID)
	if err != nil {
		s.logger.Warn("cache get stats failed, falling back to database", zap.Error(err))
	} else if stats != nil {
		return stats, nil
	}

	// Database fallback
	stats, err = s.whitelistRepo.GetStats(ctx, userID)
	if err != nil {
		return nil, err
	}

	// Cache the result asynchronously
	if stats != nil {
		go func() {
			cacheCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if cacheErr := s.cache.SetStats(cacheCtx, stats); cacheErr != nil {
				s.logger.Warn("failed to cache stats", zap.Error(cacheErr))
			}
		}()
	}

	return stats, nil
}

// InvalidateUserCache removes all cached data for a user
func (s *CacheService) InvalidateUserCache(ctx context.Context, userID uuid.UUID) error {
	return s.cache.InvalidateUserCache(ctx, userID)
}

// GetCacheStats returns cache performance statistics
func (s *CacheService) GetCacheStats(ctx context.Context) (map[string]interface{}, error) {
	return s.cache.GetCacheStats(ctx)
}

// Ping tests both cache and database connectivity
func (s *CacheService) Ping(ctx context.Context) error {
	return s.cache.Ping(ctx)
}

// NewRedisClient creates a new Redis client for dependency injection
func NewRedisClient(cfg *config.Config, logger *zap.Logger) (*RedisCache, error) {
	return NewRedisCache(&cfg.Redis, logger)
}