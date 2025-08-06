package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"smart-whitelist/internal/api"
	"smart-whitelist/internal/cache"
	"smart-whitelist/internal/config"
	"smart-whitelist/internal/metrics"
	"smart-whitelist/internal/ml"
	"smart-whitelist/internal/repository"
	"smart-whitelist/internal/services"

	"github.com/gin-gonic/gin"
	"go.uber.org/fx"
	"go.uber.org/zap"
)

func main() {
	app := fx.New(
		// Configuration
		fx.Provide(config.NewConfig),

		// Logging
		fx.Provide(NewLogger),

		// Database
		fx.Provide(repository.NewPostgresDB),
		fx.Provide(repository.NewWhitelistRepository),
		fx.Provide(repository.NewSpamProfileRepository),
		fx.Provide(repository.NewUserRepository),

		// Cache
		fx.Provide(cache.NewRedisClient),
		fx.Provide(cache.NewCacheService),

		// ML Services
		fx.Provide(ml.NewClassifier),

		// Services
		fx.Provide(services.NewSmartWhitelistService),

		// Metrics
		fx.Provide(metrics.NewMetricsCollector),

		// API
		fx.Provide(NewGinEngine),
		fx.Provide(api.NewWhitelistHandler),
		fx.Provide(api.NewHealthHandler),

		// HTTP Server
		fx.Provide(NewHTTPServer),

		// Lifecycle
		fx.Invoke(RegisterRoutes),
		fx.Invoke(StartServer),
	)

	app.Run()
}

func NewLogger(cfg *config.Config) (*zap.Logger, error) {
	if !cfg.Logging.Development {
		return zap.NewProduction()
	}
	return zap.NewDevelopment()
}

func NewGinEngine(cfg *config.Config) *gin.Engine {
	if !cfg.Logging.Development {
		gin.SetMode(gin.ReleaseMode)
	}

	engine := gin.New()
	engine.Use(gin.Recovery())
	engine.Use(gin.Logger())

	// CORS middleware
	engine.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Accept, Authorization, X-Request-ID")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	})

	return engine
}

func NewHTTPServer(cfg *config.Config, engine *gin.Engine) *http.Server {
	return &http.Server{
		Addr:           fmt.Sprintf(":%d", cfg.Server.Port),
		Handler:        engine,
		ReadTimeout:    time.Duration(cfg.Server.ReadTimeout) * time.Second,
		WriteTimeout:   time.Duration(cfg.Server.WriteTimeout) * time.Second,
		IdleTimeout:    time.Duration(cfg.Server.IdleTimeout) * time.Second,
		MaxHeaderBytes: 1 << 20, // 1MB
	}
}

func RegisterRoutes(
	engine *gin.Engine,
	whitelistHandler *api.WhitelistHandler,
	healthHandler *api.HealthHandler,
) {
	// Health endpoints
	engine.GET("/health", healthHandler.Health)
	engine.GET("/health/ready", healthHandler.Ready)
	engine.GET("/health/live", healthHandler.Live)

	// Metrics endpoint
	engine.GET("/metrics", gin.WrapH(metrics.Handler()))

	// API v1 routes
	v1 := engine.Group("/api/v1")
	{
		// Whitelist management
		v1.GET("/whitelist/:userId", whitelistHandler.GetWhitelist)
		v1.POST("/whitelist/:userId/smart-add", whitelistHandler.SmartAdd)
		v1.DELETE("/whitelist/:userId/:phone", whitelistHandler.Remove)
		v1.GET("/whitelist/evaluate/:phone", whitelistHandler.EvaluatePhone)
		v1.POST("/whitelist/learning", whitelistHandler.RecordLearning)
		v1.PUT("/whitelist/rules/:userId", whitelistHandler.UpdateRules)
		v1.GET("/whitelist/stats/:userId", whitelistHandler.GetStats)
	}
}

func StartServer(
	lc fx.Lifecycle,
	server *http.Server,
	logger *zap.Logger,
) {
	lc.Append(fx.Hook{
		OnStart: func(ctx context.Context) error {
			logger.Info("Starting Smart Whitelist Service",
				zap.String("addr", server.Addr))

			go func() {
				if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
					logger.Fatal("Failed to start server", zap.Error(err))
				}
			}()

			return nil
		},
		OnStop: func(ctx context.Context) error {
			logger.Info("Shutting down Smart Whitelist Service")

			shutdownCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			defer cancel()

			return server.Shutdown(shutdownCtx)
		},
	})

	// Handle graceful shutdown
	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
		<-sigChan

		logger.Info("Received shutdown signal")
		if err := server.Shutdown(context.Background()); err != nil {
			logger.Error("Error during shutdown", zap.Error(err))
		}
	}()
}