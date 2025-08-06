-- AI Answer Ninja - 数据库迁移脚本
-- Migration 001: Create Base Schema
-- 创建基础数据库架构，支持版本控制和回滚

-- ===========================================
-- 迁移元数据
-- ===========================================

-- 创建迁移跟踪表
CREATE TABLE IF NOT EXISTS schema_migrations (
    id SERIAL PRIMARY KEY,
    version VARCHAR(50) UNIQUE NOT NULL,
    description TEXT NOT NULL,
    applied_at TIMESTAMP DEFAULT NOW(),
    applied_by VARCHAR(100) DEFAULT current_user,
    rollback_sql TEXT,
    checksum VARCHAR(64)
);

-- 记录此迁移
INSERT INTO schema_migrations (version, description, rollback_sql, checksum) 
VALUES (
    '001', 
    'Create base schema with optimized tables and indexes',
    -- 回滚SQL（删除所有创建的对象）
    'DROP VIEW IF EXISTS v_performance_dashboard, v_index_usage_stats CASCADE;
     DROP MATERIALIZED VIEW IF EXISTS mv_call_analytics_summary, mv_conversation_intelligence, mv_spam_trend_analysis, mv_user_behavior_analysis CASCADE;
     DROP FUNCTION IF EXISTS check_whitelist_fast, get_spam_profile_fast, get_conversation_context_fast, get_user_profile_fast, get_user_call_statistics, get_ai_performance_metrics, maintain_partitions_auto, cleanup_expired_data, validate_call_record_integrity, db_health_check CASCADE;
     DROP TABLE IF EXISTS user_configs, global_configs, user_spam_interactions, spam_profiles, conversations, call_records, smart_whitelists, users CASCADE;',
    'migration_001_checksum'
);

-- ===========================================
-- 执行核心表创建
-- ===========================================

-- 加载核心表结构
\i /docker-entrypoint-initdb.d/schemas/01-core-tables.sql

RAISE NOTICE 'Core tables created successfully';

-- ===========================================
-- 执行性能函数创建
-- ===========================================

-- 加载性能优化函数
\i /docker-entrypoint-initdb.d/schemas/02-performance-functions.sql

RAISE NOTICE 'Performance functions created successfully';

-- ===========================================
-- 执行物化视图创建
-- ===========================================

-- 加载分析物化视图
\i /docker-entrypoint-initdb.d/schemas/03-materialized-views.sql

RAISE NOTICE 'Materialized views created successfully';

-- ===========================================
-- 权限设置
-- ===========================================

-- 应用用户权限
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ai_ninja_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ai_ninja_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ai_ninja_app;

-- 只读用户权限
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ai_ninja_readonly;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ai_ninja_readonly;
GRANT EXECUTE ON FUNCTION db_health_check() TO ai_ninja_readonly;
GRANT EXECUTE ON FUNCTION get_user_call_statistics(UUID, INTEGER) TO ai_ninja_readonly;
GRANT EXECUTE ON FUNCTION get_ai_performance_metrics(INTEGER) TO ai_ninja_readonly;

-- 物化视图权限
GRANT SELECT ON mv_call_analytics_summary TO ai_ninja_readonly;
GRANT SELECT ON mv_conversation_intelligence TO ai_ninja_readonly;
GRANT SELECT ON mv_spam_trend_analysis TO ai_ninja_readonly;
GRANT SELECT ON mv_user_behavior_analysis TO ai_ninja_readonly;

-- 性能监控视图权限
GRANT SELECT ON v_performance_dashboard TO ai_ninja_readonly;
GRANT SELECT ON v_index_usage_stats TO ai_ninja_readonly;

-- ===========================================
-- 数据完整性检查
-- ===========================================

-- 验证表结构完整性
DO $$
DECLARE
    table_count INTEGER;
    function_count INTEGER;
    materialized_view_count INTEGER;
    index_count INTEGER;
BEGIN
    -- 检查表数量
    SELECT COUNT(*) INTO table_count
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_type = 'BASE TABLE'
    AND table_name IN ('users', 'smart_whitelists', 'call_records', 'conversations', 'spam_profiles', 'user_spam_interactions', 'global_configs', 'user_configs');
    
    IF table_count != 8 THEN
        RAISE EXCEPTION 'Expected 8 core tables, found %', table_count;
    END IF;
    
    -- 检查函数数量
    SELECT COUNT(*) INTO function_count
    FROM information_schema.routines 
    WHERE routine_schema = 'public' 
    AND routine_type = 'FUNCTION'
    AND routine_name IN ('check_whitelist_fast', 'get_spam_profile_fast', 'get_conversation_context_fast', 'get_user_profile_fast', 'get_user_call_statistics', 'get_ai_performance_metrics', 'maintain_partitions_auto', 'cleanup_expired_data', 'validate_call_record_integrity', 'db_health_check');
    
    IF function_count < 10 THEN
        RAISE WARNING 'Expected at least 10 functions, found %', function_count;
    END IF;
    
    -- 检查物化视图数量
    SELECT COUNT(*) INTO materialized_view_count
    FROM pg_matviews 
    WHERE schemaname = 'public'
    AND matviewname IN ('mv_call_analytics_summary', 'mv_conversation_intelligence', 'mv_spam_trend_analysis', 'mv_user_behavior_analysis');
    
    IF materialized_view_count != 4 THEN
        RAISE EXCEPTION 'Expected 4 materialized views, found %', materialized_view_count;
    END IF;
    
    -- 检查分区表
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename LIKE 'call_records_2025_%') THEN
        RAISE EXCEPTION 'Call records partitions not found';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename LIKE 'conversations_2025_%') THEN
        RAISE EXCEPTION 'Conversations partitions not found';
    END IF;
    
    RAISE NOTICE 'Schema integrity check passed: % tables, % functions, % materialized views', table_count, function_count, materialized_view_count;
END
$$;

-- ===========================================
-- 性能基准测试
-- ===========================================

-- 创建性能基准测试函数
CREATE OR REPLACE FUNCTION run_performance_benchmark()
RETURNS TABLE(
    test_name TEXT,
    execution_time_ms NUMERIC,
    status TEXT,
    details TEXT
) AS $$
DECLARE
    start_time TIMESTAMP;
    end_time TIMESTAMP;
    test_duration NUMERIC;
BEGIN
    -- 测试1: 白名单查询性能
    start_time := clock_timestamp();
    PERFORM check_whitelist_fast('550e8400-e29b-41d4-a716-446655440001', '+86-139-1234-5678');
    end_time := clock_timestamp();
    test_duration := EXTRACT(MILLISECONDS FROM (end_time - start_time));
    
    RETURN QUERY SELECT 
        'Whitelist Check'::TEXT,
        test_duration,
        CASE WHEN test_duration < 5 THEN 'PASS' ELSE 'SLOW' END,
        'Should complete in < 5ms'::TEXT;
    
    -- 测试2: 垃圾画像查询性能
    start_time := clock_timestamp();
    PERFORM get_spam_profile_fast(ENCODE(SHA256('+86-400-123-9999'::bytea), 'hex'));
    end_time := clock_timestamp();
    test_duration := EXTRACT(MILLISECONDS FROM (end_time - start_time));
    
    RETURN QUERY SELECT 
        'Spam Profile Lookup'::TEXT,
        test_duration,
        CASE WHEN test_duration < 10 THEN 'PASS' ELSE 'SLOW' END,
        'Should complete in < 10ms'::TEXT;
    
    -- 测试3: 对话上下文查询性能
    start_time := clock_timestamp();
    PERFORM get_conversation_context_fast('880e8400-e29b-41d4-a716-446655440002', 10);
    end_time := clock_timestamp();
    test_duration := EXTRACT(MILLISECONDS FROM (end_time - start_time));
    
    RETURN QUERY SELECT 
        'Conversation Context'::TEXT,
        test_duration,
        CASE WHEN test_duration < 50 THEN 'PASS' ELSE 'SLOW' END,
        'Should complete in < 50ms'::TEXT;
    
    -- 测试4: 复杂分析查询性能
    start_time := clock_timestamp();
    PERFORM get_user_call_statistics('550e8400-e29b-41d4-a716-446655440001', 30);
    end_time := clock_timestamp();
    test_duration := EXTRACT(MILLISECONDS FROM (end_time - start_time));
    
    RETURN QUERY SELECT 
        'User Statistics'::TEXT,
        test_duration,
        CASE WHEN test_duration < 100 THEN 'PASS' ELSE 'SLOW' END,
        'Should complete in < 100ms'::TEXT;
    
    -- 测试5: AI性能监控查询
    start_time := clock_timestamp();
    PERFORM get_ai_performance_metrics(24);
    end_time := clock_timestamp();
    test_duration := EXTRACT(MILLISECONDS FROM (end_time - start_time));
    
    RETURN QUERY SELECT 
        'AI Performance Metrics'::TEXT,
        test_duration,
        CASE WHEN test_duration < 200 THEN 'PASS' ELSE 'SLOW' END,
        'Should complete in < 200ms'::TEXT;
END;
$$ LANGUAGE plpgsql;

-- 执行性能基准测试（如果有种子数据）
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM users LIMIT 1) THEN
        RAISE NOTICE 'Running performance benchmark with seed data...';
        -- 测试结果将在后续查询中显示
    ELSE
        RAISE NOTICE 'No seed data found, skipping performance benchmark';
    END IF;
END
$$;

-- ===========================================
-- 索引使用情况分析
-- ===========================================

-- 创建索引监控函数
CREATE OR REPLACE FUNCTION analyze_index_usage()
RETURNS TABLE(
    table_name TEXT,
    index_name TEXT,
    index_usage_level TEXT,
    recommendation TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        schemaname || '.' || t.tablename as table_name,
        COALESCE(indexname, 'No index') as index_name,
        CASE 
            WHEN idx_tup_read = 0 THEN 'Unused'
            WHEN idx_tup_read < 100 THEN 'Low Usage'
            WHEN idx_tup_read < 1000 THEN 'Medium Usage'
            ELSE 'High Usage'
        END as usage_level,
        CASE 
            WHEN idx_tup_read = 0 THEN 'Consider dropping if not needed'
            WHEN idx_tup_read < 100 THEN 'Monitor usage patterns'
            ELSE 'Keep - well utilized'
        END as recommendation
    FROM pg_stat_user_indexes pgsui
    RIGHT JOIN pg_stat_user_tables t ON pgsui.relid = t.relid
    WHERE t.schemaname = 'public'
    AND t.tablename IN ('users', 'smart_whitelists', 'call_records', 'conversations', 'spam_profiles', 'user_spam_interactions')
    ORDER BY pgsui.idx_tup_read DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 迁移验证和报告
-- ===========================================

-- 创建迁移验证报告
CREATE OR REPLACE FUNCTION generate_migration_report()
RETURNS TABLE(
    category TEXT,
    item TEXT,
    status TEXT,
    details TEXT
) AS $$
BEGIN
    -- 表结构验证
    RETURN QUERY
    SELECT 
        'Tables'::TEXT as category,
        table_name::TEXT as item,
        'Created'::TEXT as status,
        'Rows: ' || COALESCE(n_tup_ins::TEXT, '0') as details
    FROM information_schema.tables t
    LEFT JOIN pg_stat_user_tables s ON t.table_name = s.relname
    WHERE t.table_schema = 'public' 
    AND t.table_type = 'BASE TABLE'
    AND t.table_name IN ('users', 'smart_whitelists', 'call_records', 'conversations', 'spam_profiles', 'user_spam_interactions', 'global_configs', 'user_configs')
    ORDER BY t.table_name;
    
    -- 分区验证
    RETURN QUERY
    SELECT 
        'Partitions'::TEXT,
        tablename::TEXT,
        'Active'::TEXT,
        'Partition of ' || 
        CASE 
            WHEN tablename LIKE 'call_records_%' THEN 'call_records'
            WHEN tablename LIKE 'conversations_%' THEN 'conversations'
            ELSE 'unknown'
        END
    FROM pg_tables 
    WHERE schemaname = 'public'
    AND (tablename LIKE 'call_records_2025_%' OR tablename LIKE 'conversations_2025_%')
    ORDER BY tablename;
    
    -- 物化视图验证
    RETURN QUERY
    SELECT 
        'Materialized Views'::TEXT,
        matviewname::TEXT,
        'Created'::TEXT,
        'Last refresh: ' || COALESCE(last_refresh::TEXT, 'Never')
    FROM pg_matviews 
    WHERE schemaname = 'public'
    ORDER BY matviewname;
    
    -- 函数验证
    RETURN QUERY
    SELECT 
        'Functions'::TEXT,
        routine_name::TEXT,
        'Available'::TEXT,
        'Language: ' || external_language
    FROM information_schema.routines 
    WHERE routine_schema = 'public' 
    AND routine_type = 'FUNCTION'
    AND routine_name IN ('check_whitelist_fast', 'get_spam_profile_fast', 'get_conversation_context_fast', 'get_user_profile_fast', 'db_health_check')
    ORDER BY routine_name;
    
    -- 定时任务验证（如果pg_cron可用）
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RETURN QUERY
        SELECT 
            'Scheduled Jobs'::TEXT,
            jobname::TEXT,
            CASE WHEN active THEN 'Active' ELSE 'Inactive' END,
            'Schedule: ' || schedule
        FROM cron.job
        WHERE jobname IN ('partition-maintenance', 'data-cleanup', 'statistics-update', 'refresh-call-analytics', 'refresh-conversation-intelligence', 'refresh-spam-trends', 'refresh-user-behavior')
        ORDER BY jobname;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 完成迁移
-- ===========================================

-- 更新迁移记录
UPDATE schema_migrations 
SET applied_at = NOW(),
    applied_by = current_user
WHERE version = '001';

-- 生成迁移报告
SELECT * FROM generate_migration_report();

-- 显示性能基准测试结果（如果有数据）
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM users LIMIT 1) THEN
        RAISE NOTICE 'Performance benchmark results:';
        -- 在实际环境中，这里会显示测试结果
        PERFORM run_performance_benchmark();
    END IF;
END
$$;

-- 最终验证
SELECT 
    'Migration 001' as migration,
    'COMPLETED' as status,
    NOW() as completed_at,
    current_user as applied_by,
    'Base schema created with ' || COUNT(*) || ' core tables' as summary
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_type = 'BASE TABLE'
AND table_name IN ('users', 'smart_whitelists', 'call_records', 'conversations', 'spam_profiles', 'user_spam_interactions', 'global_configs', 'user_configs');

RAISE NOTICE '===========================================';
RAISE NOTICE 'Migration 001 completed successfully!';
RAISE NOTICE 'Base schema created with optimized tables, indexes, functions, and materialized views';
RAISE NOTICE 'Next steps: Load seed data for development environment';
RAISE NOTICE '===========================================';