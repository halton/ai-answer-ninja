-- AI Answer Ninja - Enhanced Database Optimization Schema
-- Implements intelligent caching, read-write separation, and advanced optimization features
-- Based on CLAUDE.md architecture specifications

BEGIN;

-- ===========================================
-- 1. Enhanced User Table with Optimization
-- ===========================================

-- Add performance-related columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS 
    last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    login_count INTEGER DEFAULT 0,
    preferences JSONB DEFAULT '{}',
    account_status VARCHAR(20) DEFAULT 'active',
    performance_tier VARCHAR(20) DEFAULT 'standard'; -- standard, premium, enterprise

-- Optimized indexes for user table
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_phone_status 
ON users(phone_number, account_status) WHERE account_status = 'active';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_performance_tier 
ON users(performance_tier) WHERE performance_tier != 'standard';

-- ===========================================
-- 2. Smart Whitelist Table (Redesigned)
-- ===========================================

-- Drop and recreate smart_whitelists with enhanced design
DROP TABLE IF EXISTS smart_whitelists CASCADE;

CREATE TABLE smart_whitelists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    contact_phone VARCHAR(20) NOT NULL,
    contact_name VARCHAR(100),
    whitelist_type VARCHAR(20) DEFAULT 'manual', -- 'manual', 'auto', 'temporary', 'learned'
    confidence_score DECIMAL(3,2) DEFAULT 1.0,
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMP,
    learning_source VARCHAR(50), -- 'user_behavior', 'ai_analysis', 'contact_frequency'
    last_verified TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, contact_phone)
);

-- Intelligent indexes for whitelist lookups
CREATE INDEX idx_whitelists_user_active 
ON smart_whitelists(user_id, is_active, expires_at) 
WHERE is_active = true;

CREATE INDEX idx_whitelists_phone_lookup 
ON smart_whitelists(contact_phone, is_active) 
WHERE is_active = true;

CREATE INDEX idx_whitelists_auto_expire 
ON smart_whitelists(expires_at) 
WHERE expires_at IS NOT NULL AND is_active = true;

-- ===========================================
-- 3. Spam Profiles Table (Cross-User Sharing)
-- ===========================================

CREATE TABLE spam_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_hash VARCHAR(64) UNIQUE NOT NULL, -- SHA-256 hash for privacy
    spam_category VARCHAR(50) NOT NULL,
    risk_score DECIMAL(3,2) NOT NULL DEFAULT 0.5,
    confidence_level DECIMAL(3,2) NOT NULL DEFAULT 0.5,
    feature_vector JSONB, -- ML feature vector
    behavioral_patterns JSONB, -- Behavioral analysis data
    total_reports INTEGER DEFAULT 1,
    success_rate DECIMAL(3,2) DEFAULT 0.0, -- AI handling success rate
    last_activity TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User-spam interaction tracking
CREATE TABLE user_spam_interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    spam_profile_id UUID REFERENCES spam_profiles(id) ON DELETE CASCADE,
    interaction_count INTEGER DEFAULT 1,
    last_interaction TIMESTAMP NOT NULL,
    user_feedback VARCHAR(20), -- 'spam', 'not_spam', 'unknown'
    effectiveness_score DECIMAL(3,2), -- AI processing effectiveness
    handling_duration INTEGER, -- Average call duration in seconds
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, spam_profile_id)
);

-- Optimized indexes for spam detection
CREATE INDEX idx_spam_profiles_hash ON spam_profiles(phone_hash);
CREATE INDEX idx_spam_profiles_category_risk 
ON spam_profiles(spam_category, risk_score DESC);
CREATE INDEX idx_spam_profiles_activity 
ON spam_profiles(last_activity DESC) WHERE total_reports > 5;

CREATE INDEX idx_user_interactions_user 
ON user_spam_interactions(user_id, last_interaction DESC);
CREATE INDEX idx_user_interactions_effectiveness 
ON user_spam_interactions(spam_profile_id, effectiveness_score DESC) 
WHERE effectiveness_score IS NOT NULL;

-- ===========================================
-- 4. Configuration Management Tables
-- ===========================================

-- Global system configurations
CREATE TABLE global_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_value JSONB NOT NULL,
    config_type VARCHAR(20) DEFAULT 'system', -- 'system', 'feature', 'experiment', 'performance'
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    validation_schema JSONB, -- JSON schema for value validation
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User-specific configurations
CREATE TABLE user_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    config_key VARCHAR(100) NOT NULL,
    config_value JSONB NOT NULL,
    inherits_global BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, config_key)
);

-- Configuration access optimization
CREATE INDEX idx_global_configs_key_active 
ON global_configs(config_key) WHERE is_active = true;

CREATE INDEX idx_user_configs_user_key 
ON user_configs(user_id, config_key) WHERE is_active = true;

-- ===========================================
-- 5. Performance Monitoring Tables
-- ===========================================

-- Query performance tracking
CREATE TABLE query_performance_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    query_hash VARCHAR(64) NOT NULL,
    query_type VARCHAR(50) NOT NULL,
    execution_time_ms INTEGER NOT NULL,
    rows_processed INTEGER,
    cache_hit BOOLEAN DEFAULT false,
    user_id UUID,
    service_name VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) PARTITION BY RANGE (created_at);

-- Create performance log partitions
DO $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    FOR i IN -1..3 LOOP
        start_date := date_trunc('month', CURRENT_DATE + INTERVAL '1 month' * i);
        end_date := start_date + INTERVAL '1 month';
        partition_name := 'query_performance_log_' || to_char(start_date, 'YYYYMM');
        
        EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF query_performance_log 
                       FOR VALUES FROM (%L) TO (%L)',
                       partition_name, start_date, end_date);
        
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_query_type_time 
                       ON %I(query_type, created_at DESC)',
                       partition_name, partition_name);
    END LOOP;
END $$;

-- Cache performance tracking
CREATE TABLE cache_performance_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cache_key VARCHAR(200) NOT NULL,
    cache_type VARCHAR(50) NOT NULL, -- 'redis', 'memory', 'database'
    hit_miss VARCHAR(10) NOT NULL, -- 'hit', 'miss'
    response_time_ms INTEGER,
    data_size_bytes INTEGER,
    ttl_seconds INTEGER,
    service_name VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) PARTITION BY RANGE (created_at);

-- Create cache performance partitions
DO $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    FOR i IN -1..3 LOOP
        start_date := date_trunc('month', CURRENT_DATE + INTERVAL '1 month' * i);
        end_date := start_date + INTERVAL '1 month';
        partition_name := 'cache_performance_log_' || to_char(start_date, 'YYYYMM');
        
        EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF cache_performance_log 
                       FOR VALUES FROM (%L) TO (%L)',
                       partition_name, start_date, end_date);
    END LOOP;
END $$;

-- ===========================================
-- 6. Intelligent Caching Support Tables
-- ===========================================

-- Cache invalidation tracking
CREATE TABLE cache_invalidation_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cache_pattern VARCHAR(200) NOT NULL,
    invalidation_reason VARCHAR(100) NOT NULL,
    affected_keys INTEGER DEFAULT 0,
    invalidation_time_ms INTEGER,
    triggered_by VARCHAR(50), -- 'data_change', 'ttl_expire', 'manual', 'system'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Predictive cache warming data
CREATE TABLE cache_warming_patterns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pattern_key VARCHAR(200) NOT NULL,
    access_frequency INTEGER DEFAULT 1,
    last_access TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    warm_priority INTEGER DEFAULT 1, -- 1-10 priority scale
    success_rate DECIMAL(3,2) DEFAULT 1.0,
    avg_generation_time_ms INTEGER,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cache_warming_priority 
ON cache_warming_patterns(warm_priority DESC, last_access DESC) 
WHERE is_active = true;

-- ===========================================
-- 7. Advanced Analytics Support
-- ===========================================

-- Pre-computed analytics for dashboard performance
CREATE TABLE analytics_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    snapshot_type VARCHAR(50) NOT NULL, -- 'daily', 'weekly', 'monthly'
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    metric_data JSONB NOT NULL,
    computation_time_ms INTEGER,
    snapshot_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(snapshot_type, user_id, snapshot_date)
);

CREATE INDEX idx_analytics_snapshots_user_type_date 
ON analytics_snapshots(user_id, snapshot_type, snapshot_date DESC);

-- ===========================================
-- 8. Database Health Monitoring
-- ===========================================

-- Connection pool monitoring
CREATE TABLE connection_pool_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pool_name VARCHAR(50) NOT NULL,
    active_connections INTEGER NOT NULL,
    idle_connections INTEGER NOT NULL,
    waiting_connections INTEGER NOT NULL,
    max_connections INTEGER NOT NULL,
    avg_wait_time_ms INTEGER,
    pool_efficiency DECIMAL(3,2), -- active/total ratio
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Partition pruning statistics
CREATE TABLE partition_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_name VARCHAR(100) NOT NULL,
    partition_name VARCHAR(100) NOT NULL,
    row_count BIGINT,
    size_bytes BIGINT,
    last_vacuum TIMESTAMP,
    last_analyze TIMESTAMP,
    scan_efficiency DECIMAL(3,2), -- rows returned / rows scanned
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===========================================
-- 9. Enhanced Functions and Procedures
-- ===========================================

-- Intelligent cache warming function
CREATE OR REPLACE FUNCTION warm_user_cache(p_user_id UUID)
RETURNS TABLE (cache_key TEXT, warming_result TEXT) AS $$
BEGIN
    -- Pre-load user profile data
    PERFORM user_id FROM users WHERE id = p_user_id;
    
    -- Pre-load whitelist data
    PERFORM contact_phone FROM smart_whitelists 
    WHERE user_id = p_user_id AND is_active = true;
    
    -- Pre-load recent call patterns
    PERFORM caller_phone FROM call_records 
    WHERE user_id = p_user_id 
    AND start_time >= CURRENT_DATE - INTERVAL '7 days'
    GROUP BY caller_phone
    ORDER BY COUNT(*) DESC
    LIMIT 20;
    
    RETURN QUERY
    SELECT 
        'user_profile_' || p_user_id::TEXT as cache_key,
        'warmed' as warming_result
    UNION ALL
    SELECT 
        'user_whitelist_' || p_user_id::TEXT as cache_key,
        'warmed' as warming_result
    UNION ALL
    SELECT 
        'user_call_patterns_' || p_user_id::TEXT as cache_key,
        'warmed' as warming_result;
END;
$$ LANGUAGE plpgsql;

-- Performance analysis function
CREATE OR REPLACE FUNCTION analyze_query_performance(
    p_hours INTEGER DEFAULT 24
) RETURNS TABLE (
    query_type TEXT,
    avg_execution_time NUMERIC,
    cache_hit_rate NUMERIC,
    total_executions BIGINT,
    performance_score NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    WITH performance_data AS (
        SELECT 
            qpl.query_type,
            AVG(qpl.execution_time_ms) as avg_time,
            COUNT(*) FILTER (WHERE qpl.cache_hit = true)::NUMERIC / COUNT(*)::NUMERIC as hit_rate,
            COUNT(*) as executions
        FROM query_performance_log qpl
        WHERE qpl.created_at >= CURRENT_TIMESTAMP - INTERVAL '1 hour' * p_hours
        GROUP BY qpl.query_type
        HAVING COUNT(*) > 10 -- Only include queries with sufficient data
    )
    SELECT 
        pd.query_type,
        ROUND(pd.avg_time, 2),
        ROUND(pd.hit_rate * 100, 2),
        pd.executions,
        ROUND(
            (1000 / GREATEST(pd.avg_time, 1)) * -- Speed component (inverse of time)
            (pd.hit_rate + 0.1) * -- Cache efficiency component
            LN(pd.executions + 1) -- Frequency component
        , 2) as performance_score
    FROM performance_data pd
    ORDER BY performance_score DESC;
END;
$$ LANGUAGE plpgsql;

-- Automatic partition maintenance with intelligent scheduling
CREATE OR REPLACE FUNCTION intelligent_partition_maintenance()
RETURNS void AS $$
DECLARE
    table_stats RECORD;
    partition_count INTEGER;
    avg_partition_size BIGINT;
    should_create_partition BOOLEAN;
BEGIN
    -- Analyze each partitioned table
    FOR table_stats IN 
        SELECT 
            schemaname,
            tablename,
            pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
        FROM pg_tables 
        WHERE tablename IN ('call_records', 'conversations', 'query_performance_log', 'cache_performance_log')
    LOOP
        -- Get partition count for this table
        SELECT COUNT(*) INTO partition_count
        FROM pg_tables 
        WHERE tablename LIKE table_stats.tablename || '_%';
        
        -- Calculate average partition size
        avg_partition_size := table_stats.size_bytes / GREATEST(partition_count, 1);
        
        -- Create new partitions if current ones are getting large (>1GB average)
        should_create_partition := avg_partition_size > 1073741824; -- 1GB
        
        IF should_create_partition THEN
            -- Create additional future partitions
            PERFORM create_monthly_partitions();
            
            INSERT INTO system_logs (level, message, metadata, created_at)
            VALUES (
                'INFO',
                'Auto-created partitions due to size threshold',
                jsonb_build_object(
                    'table_name', table_stats.tablename,
                    'avg_partition_size_mb', avg_partition_size / 1048576,
                    'partition_count', partition_count
                ),
                CURRENT_TIMESTAMP
            );
        END IF;
    END LOOP;
    
    -- Update table statistics
    ANALYZE;
    
    -- Log maintenance completion
    INSERT INTO system_logs (level, message, created_at)
    VALUES ('INFO', 'Intelligent partition maintenance completed', CURRENT_TIMESTAMP);
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 10. System Logs Table
-- ===========================================

CREATE TABLE IF NOT EXISTS system_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    level VARCHAR(10) NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) PARTITION BY RANGE (created_at);

-- Create system logs partitions
DO $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    FOR i IN -1..3 LOOP
        start_date := date_trunc('month', CURRENT_DATE + INTERVAL '1 month' * i);
        end_date := start_date + INTERVAL '1 month';
        partition_name := 'system_logs_' || to_char(start_date, 'YYYYMM');
        
        EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF system_logs 
                       FOR VALUES FROM (%L) TO (%L)',
                       partition_name, start_date, end_date);
        
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_level_time 
                       ON %I(level, created_at DESC)',
                       partition_name, partition_name);
    END LOOP;
END $$;

-- ===========================================
-- 11. Performance Monitoring Views
-- ===========================================

-- Real-time database performance view
CREATE VIEW database_performance_summary AS
SELECT 
    'Active Connections' as metric,
    COUNT(*) as value,
    'connections' as unit
FROM pg_stat_activity 
WHERE state = 'active'
UNION ALL
SELECT 
    'Cache Hit Ratio' as metric,
    ROUND(
        100 * sum(blks_hit) / GREATEST(sum(blks_hit) + sum(blks_read), 1), 2
    ) as value,
    'percent' as unit
FROM pg_stat_database
UNION ALL
SELECT 
    'Total Table Size' as metric,
    ROUND(sum(pg_total_relation_size(schemaname||'.'||tablename)) / 1048576) as value,
    'MB' as unit
FROM pg_tables 
WHERE schemaname = 'public';

-- Cache efficiency view
CREATE VIEW cache_efficiency_summary AS
SELECT 
    cache_type,
    COUNT(*) as total_operations,
    COUNT(*) FILTER (WHERE hit_miss = 'hit') as cache_hits,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE hit_miss = 'hit') / COUNT(*), 2
    ) as hit_rate_percent,
    AVG(response_time_ms) as avg_response_time_ms
FROM cache_performance_log
WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
GROUP BY cache_type;

-- Partition health view
CREATE VIEW partition_health_summary AS
SELECT 
    table_name,
    COUNT(*) as partition_count,
    SUM(size_bytes) / 1048576 as total_size_mb,
    AVG(size_bytes) / 1048576 as avg_partition_size_mb,
    MAX(recorded_at) as last_updated
FROM partition_stats
WHERE recorded_at >= CURRENT_DATE - INTERVAL '1 day'
GROUP BY table_name;

COMMIT;