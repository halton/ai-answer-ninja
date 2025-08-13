/**
 * AI Phone Answering System - Comprehensive Database Library
 * Provides enterprise-grade database management with connection pooling,
 * query building, migrations, transactions, and performance optimization
 */

// Core Database Management
export { DatabaseConnectionManager, createDatabaseManager } from './core/DatabaseConnectionManager';
export { QueryBuilder } from './core/QueryBuilder';
export { TransactionManager } from './core/TransactionManager';
export { DatabaseHealthMonitor } from './core/DatabaseHealthMonitor';

// Migration System
export { MigrationManager } from './migration/MigrationManager';
export { MigrationRunner } from './migration/MigrationRunner';
export { Migration } from './migration/Migration';

// Connection Pooling
export { ConnectionPool } from './pool/ConnectionPool';
export { PoolManager } from './pool/PoolManager';
export { PoolMonitor } from './pool/PoolMonitor';

// Caching Layer
export { MultiLevelCache } from './cache/MultiLevelCache';
export { CacheManager } from './cache/CacheManager';
export { PredictiveCache } from './cache/PredictiveCache';
export { QueryCache } from './cache/QueryCache';
export { CacheInvalidator } from './cache/CacheInvalidator';

// Performance Optimization
export { QueryOptimizer } from './optimization/QueryOptimizer';
export { PerformanceMonitor } from './optimization/PerformanceMonitor';
export { IndexOptimizer } from './optimization/IndexOptimizer';
export { PerformanceAnalyzer } from './optimization/PerformanceAnalyzer';
export { IndexManager } from './optimization/IndexManager';

// Partition Management
export { PartitionManager } from './partitioning/PartitionManager';
export { PartitionHealthChecker } from './partitioning/PartitionHealthChecker';

// Repository Pattern
export { BaseRepository } from './repository/BaseRepository';
export { UserRepository } from './repository/UserRepository';
export { CallRepository } from './repository/CallRepository';
export { ConversationRepository } from './repository/ConversationRepository';

// Analytics and Reporting
export { DatabaseAnalytics } from './analytics/DatabaseAnalytics';
export { PerformanceReporter } from './analytics/PerformanceReporter';

// Utilities
export { DatabaseValidator } from './utils/DatabaseValidator';
export { BackupManager } from './utils/BackupManager';
export { Logger } from './utils/Logger';
export { Validator } from './utils/Validator';
export { DateUtils } from './utils/DateUtils';
export { Helpers } from './utils/Helpers';

// Error Handling
export { DatabaseError } from './errors/DatabaseError';
export { QueryError } from './errors/QueryError';
export { ConnectionError } from './errors/ConnectionError';

// Types and Interfaces
export * from './types';

// Configuration
export { defaultDatabaseConfig, DatabaseConfig } from './config/default';

// Constants
export * from './constants';

// Health Check
export { performHealthCheck, getSystemStatus } from './health/DatabaseHealth';

// Singleton Instances (Pre-configured for immediate use)
export { databaseManager } from './core/DatabaseConnectionManager';
export { migrationManager } from './migration/MigrationManager';
export { queryOptimizer } from './optimization/QueryOptimizer';
export { connectionPool } from './pool/ConnectionPool';
export { queryCache } from './cache/QueryCache';