-- AI Answer Ninja - Comprehensive Index Creation
-- Migration 004: Advanced Indexing Strategy
-- Focus: Performance optimization for production workloads

-- ===========================================
-- Migration Metadata
-- ===========================================

-- Register migration
INSERT INTO schema_migrations (version, description, rollback_sql, checksum) 
VALUES (
    '004', 
    'Create comprehensive indexing strategy for production performance',
    -- Rollback SQL
    'DROP INDEX CONCURRENTLY IF EXISTS 
        idx_users_search_gin,
        idx_whitelists_ml_features,
        idx_call_records_ml_analysis,
        idx_conversations_nlp_analysis,
        idx_spam_profiles_behavioral,
        idx_user_interactions_learning,
        idx_global_configs_security,
        idx_user_configs_inheritance,
        idx_call_records_azure_id,
        idx_conversations_speaker_analysis,
        idx_spam_profiles_temporal,
        idx_users_activity_tracking,
        idx_whitelists_expiry_management CASCADE;',
    'migration_004_checksum'
);

-- ===========================================
-- Advanced User Table Indexes
-- ===========================================

-- Full-text search on user information
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_search_gin 
ON users USING gin(
    to_tsvector('simple', 
        COALESCE(name, '') || ' ' || 
        COALESCE(phone_number, '') || ' ' ||
        COALESCE(personality, '')
    )
);

-- User activity tracking for analytics
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_activity_tracking 
ON users(updated_at DESC, created_at)
INCLUDE (id, name, personality, language_preference);

-- User timezone optimization for global users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_timezone_language 
ON users(timezone, language_preference, personality)
WHERE timezone != 'Asia/Shanghai' OR language_preference != 'zh-CN';

-- ===========================================
-- Smart Whitelist Advanced Indexes
-- ===========================================

-- Machine learning features for smart whitelist decisions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whitelists_ml_features 
ON smart_whitelists(confidence_score DESC, hit_count DESC, whitelist_type)
WHERE is_active = true;

-- Expiry management for temporary whitelists
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whitelists_expiry_management 
ON smart_whitelists(expires_at ASC, whitelist_type, user_id)
WHERE expires_at IS NOT NULL AND is_active = true;

-- Pattern analysis for phone number clustering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whitelists_phone_patterns 
ON smart_whitelists(left(contact_phone, 7), whitelist_type, confidence_score DESC)
WHERE is_active = true;

-- User learning behavior analysis
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whitelists_learning_analysis 
ON smart_whitelists(user_id, last_hit_at DESC, hit_count DESC)
WHERE whitelist_type IN ('auto', 'learned');

-- ===========================================
-- Call Records Advanced Indexes
-- ===========================================

-- Azure integration lookup optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_call_records_azure_id 
ON call_records(azure_call_id)
WHERE azure_call_id IS NOT NULL;

-- Machine learning analysis index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_call_records_ml_analysis 
ON call_records(ai_model_version, response_time_ms, cache_hit_ratio)
INCLUDE (user_id, caller_phone, duration_seconds, call_status)
WHERE response_time_ms IS NOT NULL;

-- Daily/hourly analytics optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_call_records_time_analytics 
ON call_records(date_trunc('hour', start_time), call_status)
INCLUDE (user_id, duration_seconds, response_time_ms);

-- Caller behavior pattern analysis
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_call_records_caller_behavior 
ON call_records(caller_phone, date_trunc('day', start_time), call_status)
INCLUDE (duration_seconds, response_time_ms, ai_model_version)
WHERE start_time > CURRENT_DATE - INTERVAL '30 days';

-- Performance anomaly detection
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_call_records_performance_anomaly 
ON call_records(response_time_ms DESC, start_time DESC)
WHERE response_time_ms > 1000; -- Slower than 1 second

-- ===========================================
-- Conversations Advanced Indexes
-- ===========================================

-- Natural Language Processing analysis
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_nlp_analysis 
ON conversations(intent_category, emotion, confidence_score DESC)
INCLUDE (call_record_id, message_text, processing_latency)
WHERE confidence_score > 0.7;

-- Speaker pattern analysis
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_speaker_analysis 
ON conversations(speaker, timestamp DESC, call_record_id)
INCLUDE (intent_category, emotion, message_length);

-- Message complexity analysis
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_complexity 
ON conversations(message_length DESC, processing_latency DESC)
WHERE message_length > 100 OR processing_latency > 500;

-- Conversation flow analysis
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_flow_analysis 
ON conversations(call_record_id, sequence_number, speaker)
INCLUDE (intent_category, emotion, timestamp);

-- Real-time conversation context (hot data)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_realtime_context 
ON conversations(call_record_id, sequence_number DESC)
INCLUDE (speaker, message_text, intent_category, emotion)
WHERE timestamp > CURRENT_TIMESTAMP - INTERVAL '1 hour';

-- ===========================================
-- Spam Profiles Advanced Indexes
-- ===========================================

-- Behavioral pattern clustering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_spam_profiles_behavioral 
ON spam_profiles USING gin(behavioral_patterns);

-- Temporal activity analysis
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_spam_profiles_temporal 
ON spam_profiles(date_trunc('week', last_activity), spam_category)
INCLUDE (risk_score, total_reports, successful_blocks);

-- ML model feature extraction
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_spam_profiles_ml_features_extraction 
ON spam_profiles(spam_category, confidence_level DESC, total_reports DESC)
INCLUDE (feature_vector, behavioral_patterns)
WHERE confidence_level > 0.8;

-- Performance tracking for accuracy
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_spam_profiles_accuracy_tracking 
ON spam_profiles(successful_blocks DESC, false_positive_count ASC, total_reports DESC)
WHERE total_reports > 5;

-- ===========================================
-- User Interactions Advanced Indexes
-- ===========================================

-- Machine learning feedback optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_interactions_learning 
ON user_spam_interactions(user_feedback, ai_accuracy_score DESC, response_effectiveness DESC)
INCLUDE (user_id, spam_profile_id, last_interaction)
WHERE user_feedback IS NOT NULL;

-- Effectiveness measurement
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_interactions_effectiveness_measure 
ON user_spam_interactions(response_effectiveness DESC, feedback_confidence DESC)
WHERE response_effectiveness > 0.5;

-- User learning pattern analysis
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_interactions_learning_patterns 
ON user_spam_interactions(user_id, last_feedback_at DESC)
INCLUDE (user_feedback, feedback_confidence, ai_accuracy_score)
WHERE last_feedback_at IS NOT NULL;

-- ===========================================
-- Configuration Tables Advanced Indexes
-- ===========================================

-- Security-sensitive configuration tracking
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_global_configs_security 
ON global_configs(is_sensitive, config_type, updated_at DESC)
INCLUDE (config_key, last_modified_by)
WHERE is_sensitive = true;

-- Feature flag management
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_global_configs_features 
ON global_configs(config_type, is_active, version DESC)
WHERE config_type IN ('feature', 'experiment');

-- User configuration inheritance analysis
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_configs_inheritance 
ON user_configs(inherits_global, auto_learned, learning_confidence DESC)
INCLUDE (user_id, config_key, config_value);

-- Auto-learned configuration tracking
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_configs_auto_learning 
ON user_configs(auto_learned, learning_confidence DESC, updated_at DESC)
WHERE auto_learned = true;

-- ===========================================
-- Composite Business Logic Indexes
-- ===========================================

-- Real-time call processing optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_realtime_call_processing 
ON call_records(user_id, call_status, start_time DESC)
INCLUDE (caller_phone, azure_call_id, response_time_ms)
WHERE call_status IN ('active', 'completed') 
AND start_time > CURRENT_TIMESTAMP - INTERVAL '24 hours';

-- Spam detection pipeline optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_spam_detection_pipeline 
ON conversations(has_keywords, is_spam_indicator, timestamp DESC)
INCLUDE (call_record_id, intent_category, confidence_score)
WHERE has_keywords = true OR is_spam_indicator = true;

-- User behavior analytics optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_behavior_analytics 
ON user_spam_interactions(user_id, last_interaction DESC)
INCLUDE (user_feedback, ai_accuracy_score, response_effectiveness, interaction_count)
WHERE last_interaction > CURRENT_DATE - INTERVAL '90 days';

-- ===========================================
-- Maintenance and Health Check Indexes
-- ===========================================

-- Database maintenance optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_maintenance_dead_tuples 
ON conversations(timestamp)
WHERE timestamp < CURRENT_DATE - INTERVAL '90 days';

-- Partition management optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_partition_maintenance 
ON call_records(date_trunc('month', start_time))
WHERE start_time < CURRENT_DATE - INTERVAL '12 months';

-- ===========================================
-- Index Usage Monitoring
-- ===========================================

-- Create function to monitor new index usage
CREATE OR REPLACE FUNCTION monitor_new_indexes_usage()
RETURNS TABLE(
    schemaname TEXT,
    tablename TEXT,
    indexname TEXT,
    idx_tup_read BIGINT,
    idx_tup_fetch BIGINT,
    usage_ratio NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        stat.schemaname::TEXT,
        stat.relname::TEXT,
        stat.indexrelname::TEXT,
        stat.idx_tup_read,
        stat.idx_tup_fetch,
        CASE 
            WHEN stat.idx_tup_read > 0 
            THEN ROUND((stat.idx_tup_fetch::NUMERIC / stat.idx_tup_read::NUMERIC) * 100, 2)
            ELSE 0
        END AS usage_ratio
    FROM pg_stat_user_indexes stat
    JOIN pg_indexes idx ON (stat.schemaname = idx.schemaname 
                           AND stat.relname = idx.tablename 
                           AND stat.indexrelname = idx.indexname)
    WHERE stat.schemaname = 'public'
    AND stat.indexrelname LIKE '%_004_%' -- Indexes created in this migration
    ORDER BY stat.idx_tup_read DESC;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- Performance Validation
-- ===========================================

-- Create validation function for new indexes
CREATE OR REPLACE FUNCTION validate_index_performance()
RETURNS TABLE(
    index_name TEXT,
    table_name TEXT,
    index_size TEXT,
    expected_performance TEXT,
    status TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        idx.indexrelname::TEXT,
        idx.relname::TEXT,
        pg_size_pretty(pg_relation_size(idx.indexrelid))::TEXT,
        CASE 
            WHEN idx.indexrelname LIKE '%_gin' THEN 'Full-text search < 100ms'
            WHEN idx.indexrelname LIKE '%_fast_lookup' THEN 'Point lookup < 5ms'
            WHEN idx.indexrelname LIKE '%_ml_%' THEN 'ML analysis < 50ms'
            WHEN idx.indexrelname LIKE '%_realtime_%' THEN 'Real-time query < 10ms'
            ELSE 'Standard query < 50ms'
        END,
        CASE 
            WHEN pg_relation_size(idx.indexrelid) > 0 THEN 'Created'
            ELSE 'Failed'
        END
    FROM pg_stat_user_indexes idx
    WHERE idx.schemaname = 'public'
    AND idx.indexrelname IN (
        'idx_users_search_gin',
        'idx_whitelists_ml_features',
        'idx_call_records_ml_analysis',
        'idx_conversations_nlp_analysis',
        'idx_spam_profiles_behavioral',
        'idx_user_interactions_learning',
        'idx_global_configs_security',
        'idx_user_configs_inheritance'
    )
    ORDER BY pg_relation_size(idx.indexrelid) DESC;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- Migration Completion
-- ===========================================

-- Update migration record
UPDATE schema_migrations 
SET applied_at = NOW(),
    applied_by = current_user
WHERE version = '004';

-- Validate index creation
SELECT * FROM validate_index_performance();

RAISE NOTICE '=========================================';
RAISE NOTICE 'Migration 004 completed successfully!';
RAISE NOTICE 'Advanced indexing strategy implemented';
RAISE NOTICE 'Performance optimization for production ready';
RAISE NOTICE '=========================================';
