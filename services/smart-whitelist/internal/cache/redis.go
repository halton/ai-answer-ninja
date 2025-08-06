package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/google/uuid"
	"go.uber.org/zap"

	"smart-whitelist/internal/config"
	"smart-whitelist/internal/models"
)

const (
	// Cache key prefixes
	WhitelistPrefix  = "wl:"   // whitelist:user_id:contact_phone
	ProfilePrefix    = "sp:"   // spam_profile:phone_hash
	StatsPrefix      = "st:"   // stats:user_id
	UserPrefix       = "u:"    // user:user_id
	LookupPrefix     = "lk:"   // lookup_result:user_id:contact_phone
)

// RedisCache provides Redis-based caching for ultra-fast lookups
type RedisCache struct {
	client *redis.Client
	config *config.RedisConfig
	logger *zap.Logger
}

// NewRedisCache creates a new Redis cache instance
func NewRedisCache(cfg *config.RedisConfig, logger *zap.Logger) (*RedisCache, error) {
	client := redis.NewClient(&redis.Options{
		Addr:         fmt.Sprintf("%s:%d", cfg.Host, cfg.Port),
		Password:     cfg.Password,
		DB:           cfg.Database,
		PoolSize:     cfg.PoolSize,
		MinIdleConns: cfg.MinIdleConns,
		MaxRetries:   cfg.MaxRetries,
		DialTimeout:  cfg.DialTimeout,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  cfg.IdleTimeout,
	})

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect to Redis: %w", err)
	}

	logger.Info("connected to Redis",
		zap.String("addr", fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)),
		zap.Int("database", cfg.Database))

	return &RedisCache{
		client: client,
		config: cfg,
		logger: logger,
	}, nil
}

// Close closes the Redis connection
func (c *RedisCache) Close() error {
	return c.client.Close()
}

// GetWhitelist retrieves a whitelist entry from cache
func (c *RedisCache) GetWhitelist(ctx context.Context, userID uuid.UUID, contactPhone string) (*models.SmartWhitelist, error) {
	start := time.Now()
	key := fmt.Sprintf("%s%s:%s", WhitelistPrefix, userID.String(), contactPhone)
	
	data, err := c.client.Get(ctx, key).Result()
	if err != nil {
		if err == redis.Nil {
			c.logger.Debug("whitelist cache miss",
				zap.String("key", key),
				zap.Duration("duration", time.Since(start)))
			return nil, nil // Cache miss
		}
		c.logger.Error("failed to get whitelist from cache",
			zap.Error(err),
			zap.String("key", key))
		return nil, fmt.Errorf("failed to get whitelist from cache: %w", err)
	}

	var whitelist models.SmartWhitelist
	if err := json.Unmarshal([]byte(data), &whitelist); err != nil {
		c.logger.Error("failed to unmarshal whitelist from cache",
			zap.Error(err),
			zap.String("key", key))
		return nil, fmt.Errorf("failed to unmarshal whitelist: %w", err)
	}

	c.logger.Debug("whitelist cache hit",
		zap.String("key", key),
		zap.Duration("duration", time.Since(start)))

	return &whitelist, nil
}

// SetWhitelist stores a whitelist entry in cache
func (c *RedisCache) SetWhitelist(ctx context.Context, whitelist *models.SmartWhitelist) error {
	key := fmt.Sprintf("%s%s:%s", WhitelistPrefix, whitelist.UserID.String(), whitelist.ContactPhone)
	
	data, err := json.Marshal(whitelist)
	if err != nil {
		return fmt.Errorf("failed to marshal whitelist: %w", err)
	}

	err = c.client.Set(ctx, key, data, c.config.WhitelistCacheTTL).Err()
	if err != nil {
		c.logger.Error("failed to set whitelist in cache",
			zap.Error(err),
			zap.String("key", key))
		return fmt.Errorf("failed to set whitelist in cache: %w", err)
	}

	c.logger.Debug("whitelist cached",
		zap.String("key", key),
		zap.Duration("ttl", c.config.WhitelistCacheTTL))

	return nil
}

// InvalidateWhitelist removes a whitelist entry from cache
func (c *RedisCache) InvalidateWhitelist(ctx context.Context, userID uuid.UUID, contactPhone string) error {
	key := fmt.Sprintf("%s%s:%s", WhitelistPrefix, userID.String(), contactPhone)
	
	err := c.client.Del(ctx, key).Err()
	if err != nil {
		c.logger.Error("failed to invalidate whitelist cache",
			zap.Error(err),
			zap.String("key", key))
		return fmt.Errorf("failed to invalidate whitelist cache: %w", err)
	}

	c.logger.Debug("whitelist cache invalidated", zap.String("key", key))
	return nil
}

// GetSpamProfile retrieves a spam profile from cache
func (c *RedisCache) GetSpamProfile(ctx context.Context, phoneHash string) (*models.SpamProfile, error) {
	start := time.Now()
	key := fmt.Sprintf("%s%s", ProfilePrefix, phoneHash)
	
	data, err := c.client.Get(ctx, key).Result()
	if err != nil {
		if err == redis.Nil {
			c.logger.Debug("spam profile cache miss",
				zap.String("key", key),
				zap.Duration("duration", time.Since(start)))
			return nil, nil // Cache miss
		}
		c.logger.Error("failed to get spam profile from cache",
			zap.Error(err),
			zap.String("key", key))
		return nil, fmt.Errorf("failed to get spam profile from cache: %w", err)
	}

	var profile models.SpamProfile
	if err := json.Unmarshal([]byte(data), &profile); err != nil {
		c.logger.Error("failed to unmarshal spam profile from cache",
			zap.Error(err),
			zap.String("key", key))
		return nil, fmt.Errorf("failed to unmarshal spam profile: %w", err)
	}

	c.logger.Debug("spam profile cache hit",
		zap.String("key", key),
		zap.Duration("duration", time.Since(start)))

	return &profile, nil
}

// SetSpamProfile stores a spam profile in cache
func (c *RedisCache) SetSpamProfile(ctx context.Context, profile *models.SpamProfile) error {
	key := fmt.Sprintf("%s%s", ProfilePrefix, profile.PhoneHash)
	
	data, err := json.Marshal(profile)
	if err != nil {
		return fmt.Errorf("failed to marshal spam profile: %w", err)
	}

	err = c.client.Set(ctx, key, data, c.config.ProfileCacheTTL).Err()
	if err != nil {
		c.logger.Error("failed to set spam profile in cache",
			zap.Error(err),
			zap.String("key", key))
		return fmt.Errorf("failed to set spam profile in cache: %w", err)
	}

	c.logger.Debug("spam profile cached",
		zap.String("key", key),
		zap.Duration("ttl", c.config.ProfileCacheTTL))

	return nil
}

// InvalidateSpamProfile removes a spam profile from cache
func (c *RedisCache) InvalidateSpamProfile(ctx context.Context, phoneHash string) error {
	key := fmt.Sprintf("%s%s", ProfilePrefix, phoneHash)
	
	err := c.client.Del(ctx, key).Err()
	if err != nil {
		c.logger.Error("failed to invalidate spam profile cache",
			zap.Error(err),
			zap.String("key", key))
		return fmt.Errorf("failed to invalidate spam profile cache: %w", err)
	}

	c.logger.Debug("spam profile cache invalidated", zap.String("key", key))
	return nil
}

// GetUser retrieves a user from cache
func (c *RedisCache) GetUser(ctx context.Context, userID uuid.UUID) (*models.User, error) {
	key := fmt.Sprintf("%s%s", UserPrefix, userID.String())
	
	data, err := c.client.Get(ctx, key).Result()
	if err != nil {
		if err == redis.Nil {
			return nil, nil // Cache miss
		}
		c.logger.Error("failed to get user from cache",
			zap.Error(err),
			zap.String("key", key))
		return nil, fmt.Errorf("failed to get user from cache: %w", err)
	}

	var user models.User
	if err := json.Unmarshal([]byte(data), &user); err != nil {
		c.logger.Error("failed to unmarshal user from cache",
			zap.Error(err),
			zap.String("key", key))
		return nil, fmt.Errorf("failed to unmarshal user: %w", err)
	}

	return &user, nil
}

// SetUser stores a user in cache
func (c *RedisCache) SetUser(ctx context.Context, user *models.User) error {
	key := fmt.Sprintf("%s%s", UserPrefix, user.ID.String())
	
	data, err := json.Marshal(user)
	if err != nil {
		return fmt.Errorf("failed to marshal user: %w", err)
	}

	// User data cached for 1 hour
	err = c.client.Set(ctx, key, data, time.Hour).Err()
	if err != nil {
		c.logger.Error("failed to set user in cache",
			zap.Error(err),
			zap.String("key", key))
		return fmt.Errorf("failed to set user in cache: %w", err)
	}

	return nil
}

// GetStats retrieves statistics from cache
func (c *RedisCache) GetStats(ctx context.Context, userID uuid.UUID) (*models.WhitelistStats, error) {
	key := fmt.Sprintf("%s%s", StatsPrefix, userID.String())
	
	data, err := c.client.Get(ctx, key).Result()
	if err != nil {
		if err == redis.Nil {
			return nil, nil // Cache miss
		}
		c.logger.Error("failed to get stats from cache",
			zap.Error(err),
			zap.String("key", key))
		return nil, fmt.Errorf("failed to get stats from cache: %w", err)
	}

	var stats models.WhitelistStats
	if err := json.Unmarshal([]byte(data), &stats); err != nil {
		c.logger.Error("failed to unmarshal stats from cache",
			zap.Error(err),
			zap.String("key", key))
		return nil, fmt.Errorf("failed to unmarshal stats: %w", err)
	}

	return &stats, nil
}

// SetStats stores statistics in cache
func (c *RedisCache) SetStats(ctx context.Context, stats *models.WhitelistStats) error {
	key := fmt.Sprintf("%s%s", StatsPrefix, stats.UserID.String())
	
	data, err := json.Marshal(stats)
	if err != nil {
		return fmt.Errorf("failed to marshal stats: %w", err)
	}

	err = c.client.Set(ctx, key, data, c.config.StatisticsCacheTTL).Err()
	if err != nil {
		c.logger.Error("failed to set stats in cache",
			zap.Error(err),
			zap.String("key", key))
		return fmt.Errorf("failed to set stats in cache: %w", err)
	}

	return nil
}

// SetLookupResult caches a lookup result for ultra-fast repeated lookups
func (c *RedisCache) SetLookupResult(ctx context.Context, userID uuid.UUID, contactPhone string, result *models.WhitelistLookupResult) error {
	key := fmt.Sprintf("%s%s:%s", LookupPrefix, userID.String(), contactPhone)
	
	data, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("failed to marshal lookup result: %w", err)
	}

	// Short TTL for lookup results to ensure freshness
	ttl := time.Minute * 5
	err = c.client.Set(ctx, key, data, ttl).Err()
	if err != nil {
		c.logger.Error("failed to set lookup result in cache",
			zap.Error(err),
			zap.String("key", key))
		return fmt.Errorf("failed to set lookup result in cache: %w", err)
	}

	return nil
}

// GetLookupResult retrieves a cached lookup result
func (c *RedisCache) GetLookupResult(ctx context.Context, userID uuid.UUID, contactPhone string) (*models.WhitelistLookupResult, error) {
	start := time.Now()
	key := fmt.Sprintf("%s%s:%s", LookupPrefix, userID.String(), contactPhone)
	
	data, err := c.client.Get(ctx, key).Result()
	if err != nil {
		if err == redis.Nil {
			return nil, nil // Cache miss
		}
		c.logger.Error("failed to get lookup result from cache",
			zap.Error(err),
			zap.String("key", key))
		return nil, fmt.Errorf("failed to get lookup result from cache: %w", err)
	}

	var result models.WhitelistLookupResult
	if err := json.Unmarshal([]byte(data), &result); err != nil {
		c.logger.Error("failed to unmarshal lookup result from cache",
			zap.Error(err),
			zap.String("key", key))
		return nil, fmt.Errorf("failed to unmarshal lookup result: %w", err)
	}

	// Update cache hit and duration for this cached result
	result.CacheHit = true
	result.LookupDuration = time.Since(start)

	c.logger.Debug("lookup result cache hit",
		zap.String("key", key),
		zap.Duration("duration", time.Since(start)))

	return &result, nil
}

// InvalidateUserCache removes all cached data for a user
func (c *RedisCache) InvalidateUserCache(ctx context.Context, userID uuid.UUID) error {
	pattern := fmt.Sprintf("*%s*", userID.String())
	
	// Get all keys matching the pattern
	keys, err := c.client.Keys(ctx, pattern).Result()
	if err != nil {
		c.logger.Error("failed to get keys for user cache invalidation",
			zap.Error(err),
			zap.String("user_id", userID.String()))
		return fmt.Errorf("failed to get keys for user cache invalidation: %w", err)
	}

	if len(keys) == 0 {
		return nil // No keys to delete
	}

	// Delete all matching keys
	err = c.client.Del(ctx, keys...).Err()
	if err != nil {
		c.logger.Error("failed to invalidate user cache",
			zap.Error(err),
			zap.String("user_id", userID.String()),
			zap.Int("key_count", len(keys)))
		return fmt.Errorf("failed to invalidate user cache: %w", err)
	}

	c.logger.Info("user cache invalidated",
		zap.String("user_id", userID.String()),
		zap.Int("key_count", len(keys)))

	return nil
}

// BatchInvalidate removes multiple cache entries in a single operation
func (c *RedisCache) BatchInvalidate(ctx context.Context, keys []string) error {
	if len(keys) == 0 {
		return nil
	}

	err := c.client.Del(ctx, keys...).Err()
	if err != nil {
		c.logger.Error("failed to batch invalidate cache",
			zap.Error(err),
			zap.Int("key_count", len(keys)))
		return fmt.Errorf("failed to batch invalidate cache: %w", err)
	}

	c.logger.Debug("batch cache invalidation completed",
		zap.Int("key_count", len(keys)))

	return nil
}

// GetCacheStats returns Redis cache statistics
func (c *RedisCache) GetCacheStats(ctx context.Context) (map[string]interface{}, error) {
	info, err := c.client.Info(ctx, "stats").Result()
	if err != nil {
		return nil, fmt.Errorf("failed to get Redis stats: %w", err)
	}

	// Parse basic stats from Redis INFO command
	stats := map[string]interface{}{
		"connected_clients": c.client.PoolStats().TotalConns,
		"used_memory":      info, // This would need proper parsing in production
		"keyspace_hits":    0,    // Would be parsed from info
		"keyspace_misses":  0,    // Would be parsed from info
	}

	return stats, nil
}

// Ping tests the Redis connection
func (c *RedisCache) Ping(ctx context.Context) error {
	return c.client.Ping(ctx).Err()
}

// FlushAll clears all cache (use with caution, mainly for testing)
func (c *RedisCache) FlushAll(ctx context.Context) error {
	return c.client.FlushDB(ctx).Err()
}