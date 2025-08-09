# AI Answer Ninja - Database Architecture

## Overview

This database schema implements the optimized architecture described in CLAUDE.md, designed to support high-performance AI phone answering with sub-800ms response times and scalability from 1K to 1M+ calls per month.

## Schema Architecture

### Core Tables

#### 1. Users Table (`users`)
- **Purpose**: User management and personalization
- **Key Features**: 
  - Voice profile integration
  - Personality-based AI responses
  - Extracted performance fields (language, timezone, max_call_duration)
  - JSONB preferences for flexible configuration
- **Performance**: Optimized for fast user lookup and profile loading

#### 2. Smart Whitelists (`smart_whitelists`)
- **Purpose**: Dynamic contact filtering and auto-learning
- **Key Features**:
  - Multiple whitelist types (manual, auto, temporary, learned)
  - Confidence scoring for ML-driven decisions
  - Hit counting and expiration management
- **Performance**: Sub-5ms whitelist checking with specialized indexes

#### 3. Call Records (`call_records`) - **Time Partitioned**
- **Purpose**: High-volume call storage and analytics
- **Key Features**:
  - Monthly partitioning for performance
  - AI performance metrics (response time, cache hit ratio)
  - Azure integration fields
  - Extracted metadata for fast queries
- **Performance**: Partitioned by `start_time` with covering indexes

#### 4. Conversations (`conversations`) - **Time Partitioned**
- **Purpose**: Detailed conversation analysis and AI learning
- **Key Features**:
  - Sequence-based conversation tracking
  - Intent and emotion analysis
  - Processing latency monitoring
  - Full-text search capabilities
- **Performance**: Optimized for context retrieval (<50ms)

#### 5. Spam Profiles (`spam_profiles`)
- **Purpose**: Cross-user spam intelligence sharing
- **Key Features**:
  - Phone hash for privacy protection
  - ML feature vectors and behavioral patterns
  - Risk scoring and confidence levels
  - Success/failure tracking
- **Performance**: Fast profile lookup with comprehensive analytics

#### 6. User Spam Interactions (`user_spam_interactions`)
- **Purpose**: Personalized learning and effectiveness tracking
- **Key Features**:
  - User feedback integration
  - AI accuracy scoring
  - Response effectiveness metrics
- **Performance**: Optimized for learning algorithm queries

#### 7. Configuration Tables (`global_configs`, `user_configs`)
- **Purpose**: Hierarchical configuration management
- **Key Features**:
  - Global defaults with user overrides
  - Version control and audit trails
  - Auto-learned configuration support
- **Performance**: Fast configuration lookup with inheritance

## Performance Optimizations

### Partitioning Strategy
```sql
-- Monthly partitioning for high-volume tables
call_records_YYYY_MM    -- e.g., call_records_2025_01
conversations_YYYY_MM   -- e.g., conversations_2025_01
```

### Critical Performance Functions

#### Fast Whitelist Check (<5ms)
```sql
SELECT check_whitelist_fast('user-uuid', '+86-139-1234-5678');
```

#### Spam Profile Lookup (<10ms)
```sql
SELECT * FROM get_spam_profile_fast(SHA256(phone_number));
```

#### Conversation Context (<50ms)
```sql
SELECT * FROM get_conversation_context_fast('call-uuid', 10);
```

### Index Strategy

#### Covering Indexes (Avoid Table Lookups)
- `idx_call_records_user_summary` - User queries with all needed fields
- `idx_conversations_call_sequence` - Context retrieval optimization

#### Partial Indexes (Reduce Size)
- `idx_whitelists_fast_lookup` - Only active, non-expired entries
- `idx_call_records_active_calls` - Only relevant call statuses

#### Specialized Indexes
- GIN indexes for JSONB fields (preferences, metadata)
- Full-text search for conversation content
- Function-based indexes for computed values

## Analytics & Reporting

### Materialized Views

#### 1. Call Analytics Summary (`mv_call_analytics_summary`)
- **Refresh**: Every 15 minutes
- **Purpose**: Real-time call volume and performance metrics
- **Data Retention**: 7 days rolling window

#### 2. Conversation Intelligence (`mv_conversation_intelligence`)
- **Refresh**: Every 2 hours  
- **Purpose**: AI effectiveness and conversation quality analysis
- **Data Retention**: 30 days rolling window

#### 3. Spam Trend Analysis (`mv_spam_trend_analysis`)
- **Refresh**: Daily at 1 AM
- **Purpose**: Spam pattern detection and threat assessment
- **Data Retention**: 60 days rolling window

#### 4. User Behavior Analysis (`mv_user_behavior_analysis`)
- **Refresh**: Daily at 2 AM
- **Purpose**: User engagement and satisfaction metrics
- **Data Retention**: 1 year rolling window

## Automated Maintenance

### Partition Management
- **Schedule**: Monthly (1st day at 2 AM)
- **Function**: `maintain_partitions_auto()`
- **Actions**: Create future partitions, archive old data

### Data Cleanup  
- **Schedule**: Weekly (Sunday at 3 AM)
- **Function**: `cleanup_expired_data()`
- **Actions**: Remove expired whitelists, inactive spam profiles

### Statistics Update
- **Schedule**: Daily at 1 AM
- **Action**: `ANALYZE` all tables for query optimization

## Scaling Strategy

### Phase 1: MVP (1K-10K calls/month)
- Single database instance
- Basic partitioning
- Core indexes only

### Phase 2: Growth (10K-100K calls/month)
- Read replicas for analytics
- Full materialized view suite
- Advanced caching layer

### Phase 3: Scale (100K-1M+ calls/month)
- Write scaling with connection pooling
- Hot/cold data separation
- Real-time analytics pipeline

## Security Considerations

### Data Protection
- Phone number hashing in spam profiles
- Sensitive data encryption at rest
- Audit logging for all changes

### Access Control
- Role-based permissions (app, readonly, admin)
- Function-level security
- API rate limiting integration

## Monitoring & Health

### Performance Metrics
- Query response times (<800ms total pipeline)
- Index utilization rates
- Partition efficiency
- Cache hit ratios

### Health Checks
```sql
SELECT * FROM db_health_check();
SELECT * FROM run_performance_benchmark();
SELECT * FROM analyze_index_usage();
```

## Migration and Deployment

### Initial Setup
```bash
# Run the main migration
psql -f database/migrations/001-create-base-schema.sql

# Verify installation
SELECT * FROM generate_migration_report();
```

### Ongoing Maintenance
- Monitor materialized view refresh performance
- Review partition pruning effectiveness  
- Track storage growth and optimize accordingly
- Adjust connection pool sizing based on load

## Cost Optimization

### Storage Efficiency
- Automatic partition pruning (2-year retention)
- Compressed older partitions
- Optimized data types (SMALLINT for sequences, etc.)

### Query Optimization
- Covering indexes reduce I/O
- Partial indexes reduce storage
- Materialized views cache expensive queries

This database architecture provides a solid foundation for the AI Answer Ninja system, balancing performance, scalability, and maintainability according to the specifications in CLAUDE.md.