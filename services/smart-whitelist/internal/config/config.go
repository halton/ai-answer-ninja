package config

import (
	"fmt"
	"time"

	"github.com/spf13/viper"
)

// Config holds all configuration for the smart-whitelist service
type Config struct {
	Server      ServerConfig      `mapstructure:"server"`
	Database    DatabaseConfig    `mapstructure:"database"`
	Redis       RedisConfig       `mapstructure:"redis"`
	ML          MLConfig          `mapstructure:"ml"`
	Metrics     MetricsConfig     `mapstructure:"metrics"`
	Cleanup     CleanupConfig     `mapstructure:"cleanup"`
	Logging     LoggingConfig     `mapstructure:"logging"`
	Integration IntegrationConfig `mapstructure:"integration"`
}

// ServerConfig contains HTTP server configuration
type ServerConfig struct {
	Port            int           `mapstructure:"port" default:"3006"`
	Host            string        `mapstructure:"host" default:"0.0.0.0"`
	ReadTimeout     time.Duration `mapstructure:"read_timeout" default:"5s"`
	WriteTimeout    time.Duration `mapstructure:"write_timeout" default:"10s"`
	IdleTimeout     time.Duration `mapstructure:"idle_timeout" default:"60s"`
	ShutdownTimeout time.Duration `mapstructure:"shutdown_timeout" default:"10s"`
	MaxRequestSize  int64         `mapstructure:"max_request_size" default:"1048576"` // 1MB
}

// DatabaseConfig contains PostgreSQL configuration
type DatabaseConfig struct {
	Host            string        `mapstructure:"host" default:"localhost"`
	Port            int           `mapstructure:"port" default:"5432"`
	Database        string        `mapstructure:"database" default:"ai_answer_ninja"`
	Username        string        `mapstructure:"username" default:"postgres"`
	Password        string        `mapstructure:"password"`
	SSLMode         string        `mapstructure:"ssl_mode" default:"prefer"`
	MaxConnections  int           `mapstructure:"max_connections" default:"25"`
	MaxIdleConns    int           `mapstructure:"max_idle_conns" default:"5"`
	ConnMaxLifetime time.Duration `mapstructure:"conn_max_lifetime" default:"1h"`
	ConnMaxIdleTime time.Duration `mapstructure:"conn_max_idle_time" default:"10m"`
	QueryTimeout    time.Duration `mapstructure:"query_timeout" default:"30s"`
}

// RedisConfig contains Redis configuration for caching
type RedisConfig struct {
	Host               string        `mapstructure:"host" default:"localhost"`
	Port               int           `mapstructure:"port" default:"6379"`
	Password           string        `mapstructure:"password"`
	Database           int           `mapstructure:"database" default:"1"`
	PoolSize           int           `mapstructure:"pool_size" default:"20"`
	MinIdleConns       int           `mapstructure:"min_idle_conns" default:"5"`
	MaxRetries         int           `mapstructure:"max_retries" default:"3"`
	DialTimeout        time.Duration `mapstructure:"dial_timeout" default:"5s"`
	ReadTimeout        time.Duration `mapstructure:"read_timeout" default:"2s"`
	WriteTimeout       time.Duration `mapstructure:"write_timeout" default:"2s"`
	IdleTimeout        time.Duration `mapstructure:"idle_timeout" default:"5m"`
	WhitelistCacheTTL  time.Duration `mapstructure:"whitelist_cache_ttl" default:"10m"`
	ProfileCacheTTL    time.Duration `mapstructure:"profile_cache_ttl" default:"2h"`
	StatisticsCacheTTL time.Duration `mapstructure:"statistics_cache_ttl" default:"5m"`
}

// MLConfig contains machine learning configuration
type MLConfig struct {
	Enabled                 bool          `mapstructure:"enabled" default:"true"`
	ModelUpdateInterval     time.Duration `mapstructure:"model_update_interval" default:"1h"`
	MinTrainingSamples      int           `mapstructure:"min_training_samples" default:"100"`
	ConfidenceThreshold     float64       `mapstructure:"confidence_threshold" default:"0.7"`
	AutoLearnThreshold      float64       `mapstructure:"auto_learn_threshold" default:"0.85"`
	FeatureExtractionWorkers int          `mapstructure:"feature_extraction_workers" default:"4"`
	ModelPath               string        `mapstructure:"model_path" default:"./models"`
}

// MetricsConfig contains monitoring and metrics configuration
type MetricsConfig struct {
	Enabled         bool   `mapstructure:"enabled" default:"true"`
	Path            string `mapstructure:"path" default:"/metrics"`
	HistogramBuckets []float64 `mapstructure:"histogram_buckets"`
}

// CleanupConfig contains cleanup job configuration
type CleanupConfig struct {
	Enabled                bool          `mapstructure:"enabled" default:"true"`
	Interval               time.Duration `mapstructure:"interval" default:"1h"`
	ExpiredWhitelistTTL    time.Duration `mapstructure:"expired_whitelist_ttl" default:"7d"`
	InactiveProfileCleanup time.Duration `mapstructure:"inactive_profile_cleanup" default:"180d"`
	BatchSize              int           `mapstructure:"batch_size" default:"1000"`
}

// LoggingConfig contains logging configuration
type LoggingConfig struct {
	Level       string `mapstructure:"level" default:"info"`
	Development bool   `mapstructure:"development" default:"false"`
	Encoding    string `mapstructure:"encoding" default:"json"`
}

// IntegrationConfig contains external service integration configuration
type IntegrationConfig struct {
	UserManagementURL    string        `mapstructure:"user_management_url"`
	UserManagementAPIKey string        `mapstructure:"user_management_api_key"`
	RequestTimeout       time.Duration `mapstructure:"request_timeout" default:"30s"`
	RetryAttempts        int           `mapstructure:"retry_attempts" default:"3"`
	RetryDelay           time.Duration `mapstructure:"retry_delay" default:"1s"`
}

// Load loads configuration from environment variables and config files
func Load() (*Config, error) {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath("./config")
	viper.AddConfigPath(".")
	
	// Environment variable binding
	viper.SetEnvPrefix("SMART_WHITELIST")
	viper.AutomaticEnv()
	
	// Set defaults
	setDefaults()
	
	// Try to read config file
	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("failed to read config file: %w", err)
		}
		// Config file not found; continue with environment variables and defaults
	}
	
	var config Config
	if err := viper.Unmarshal(&config); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}
	
	// Validate configuration
	if err := validate(&config); err != nil {
		return nil, fmt.Errorf("invalid configuration: %w", err)
	}
	
	return &config, nil
}

// setDefaults sets default values for configuration
func setDefaults() {
	// Server defaults
	viper.SetDefault("server.port", 3006)
	viper.SetDefault("server.host", "0.0.0.0")
	viper.SetDefault("server.read_timeout", "5s")
	viper.SetDefault("server.write_timeout", "10s")
	viper.SetDefault("server.idle_timeout", "60s")
	viper.SetDefault("server.shutdown_timeout", "10s")
	viper.SetDefault("server.max_request_size", 1048576)
	
	// Database defaults
	viper.SetDefault("database.host", "localhost")
	viper.SetDefault("database.port", 5432)
	viper.SetDefault("database.database", "ai_answer_ninja")
	viper.SetDefault("database.username", "postgres")
	viper.SetDefault("database.ssl_mode", "prefer")
	viper.SetDefault("database.max_connections", 25)
	viper.SetDefault("database.max_idle_conns", 5)
	viper.SetDefault("database.conn_max_lifetime", "1h")
	viper.SetDefault("database.conn_max_idle_time", "10m")
	viper.SetDefault("database.query_timeout", "30s")
	
	// Redis defaults
	viper.SetDefault("redis.host", "localhost")
	viper.SetDefault("redis.port", 6379)
	viper.SetDefault("redis.database", 1)
	viper.SetDefault("redis.pool_size", 20)
	viper.SetDefault("redis.min_idle_conns", 5)
	viper.SetDefault("redis.max_retries", 3)
	viper.SetDefault("redis.dial_timeout", "5s")
	viper.SetDefault("redis.read_timeout", "2s")
	viper.SetDefault("redis.write_timeout", "2s")
	viper.SetDefault("redis.idle_timeout", "5m")
	viper.SetDefault("redis.whitelist_cache_ttl", "10m")
	viper.SetDefault("redis.profile_cache_ttl", "2h")
	viper.SetDefault("redis.statistics_cache_ttl", "5m")
	
	// ML defaults
	viper.SetDefault("ml.enabled", true)
	viper.SetDefault("ml.model_update_interval", "1h")
	viper.SetDefault("ml.min_training_samples", 100)
	viper.SetDefault("ml.confidence_threshold", 0.7)
	viper.SetDefault("ml.auto_learn_threshold", 0.85)
	viper.SetDefault("ml.feature_extraction_workers", 4)
	viper.SetDefault("ml.model_path", "./models")
	
	// Metrics defaults
	viper.SetDefault("metrics.enabled", true)
	viper.SetDefault("metrics.path", "/metrics")
	viper.SetDefault("metrics.histogram_buckets", []float64{
		0.0005, 0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0,
	})
	
	// Cleanup defaults
	viper.SetDefault("cleanup.enabled", true)
	viper.SetDefault("cleanup.interval", "1h")
	viper.SetDefault("cleanup.expired_whitelist_ttl", "168h") // 7 days
	viper.SetDefault("cleanup.inactive_profile_cleanup", "4320h") // 180 days
	viper.SetDefault("cleanup.batch_size", 1000)
	
	// Logging defaults
	viper.SetDefault("logging.level", "info")
	viper.SetDefault("logging.development", false)
	viper.SetDefault("logging.encoding", "json")
	
	// Integration defaults
	viper.SetDefault("integration.request_timeout", "30s")
	viper.SetDefault("integration.retry_attempts", 3)
	viper.SetDefault("integration.retry_delay", "1s")
}

// validate validates the configuration
func validate(config *Config) error {
	if config.Server.Port < 1 || config.Server.Port > 65535 {
		return fmt.Errorf("invalid server port: %d", config.Server.Port)
	}
	
	if config.Database.MaxConnections <= 0 {
		return fmt.Errorf("database max_connections must be positive")
	}
	
	if config.Redis.PoolSize <= 0 {
		return fmt.Errorf("redis pool_size must be positive")
	}
	
	if config.ML.ConfidenceThreshold < 0 || config.ML.ConfidenceThreshold > 1 {
		return fmt.Errorf("ml confidence_threshold must be between 0 and 1")
	}
	
	return nil
}

// NewConfig creates a new configuration instance
func NewConfig() (*Config, error) {
	return Load()
}