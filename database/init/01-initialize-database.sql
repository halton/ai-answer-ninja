-- AI Answer Ninja - 数据库初始化脚本
-- 用于Docker容器启动时自动执行

-- ===========================================
-- 数据库和用户创建
-- ===========================================

-- 创建应用数据库（如果不存在）
SELECT 'CREATE DATABASE ai_ninja' 
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ai_ninja');

-- 连接到ai_ninja数据库
\c ai_ninja;

-- 创建应用专用用户
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_user WHERE usename = 'ai_ninja_app') THEN
        CREATE USER ai_ninja_app WITH PASSWORD 'secure_app_password_change_in_production';
    END IF;
END
$$;

-- 创建只读用户（用于分析和报告）
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_user WHERE usename = 'ai_ninja_readonly') THEN
        CREATE USER ai_ninja_readonly WITH PASSWORD 'secure_readonly_password_change_in_production';
    END IF;
END
$$;

-- ===========================================
-- 基础权限设置
-- ===========================================

-- 给应用用户授权
GRANT CONNECT ON DATABASE ai_ninja TO ai_ninja_app;
GRANT CREATE ON DATABASE ai_ninja TO ai_ninja_app;
GRANT USAGE ON SCHEMA public TO ai_ninja_app;
GRANT CREATE ON SCHEMA public TO ai_ninja_app;

-- 给只读用户授权
GRANT CONNECT ON DATABASE ai_ninja TO ai_ninja_readonly;
GRANT USAGE ON SCHEMA public TO ai_ninja_readonly;

-- ===========================================
-- 环境检查和优化设置
-- ===========================================

-- 显示当前数据库信息
SELECT 
    current_database() as database_name,
    current_user as current_user,
    version() as postgresql_version,
    current_setting('shared_buffers') as shared_buffers,
    current_setting('effective_cache_size') as effective_cache_size,
    current_setting('work_mem') as work_mem;

-- 检查必要的扩展
SELECT 
    name,
    installed_version,
    default_version,
    CASE 
        WHEN installed_version IS NOT NULL THEN 'Available'
        ELSE 'Not Installed'
    END as status
FROM pg_available_extensions 
WHERE name IN ('uuid-ossp', 'pg_stat_statements', 'pg_trgm', 'btree_gin', 'pg_cron')
ORDER BY name;

-- ===========================================
-- 开发环境种子数据准备
-- ===========================================

-- 仅在开发环境执行种子数据插入
DO $$
BEGIN
    -- 检查是否为开发环境
    IF current_setting('ai_ninja.environment', true) = 'development' OR 
       current_setting('ai_ninja.environment', true) IS NULL THEN
        
        RAISE NOTICE 'Development environment detected. Seed data will be inserted after schema creation.';
        
        -- 创建临时标记表，表示需要插入种子数据
        CREATE TEMP TABLE seed_data_required (marker boolean DEFAULT true);
        
    ELSE
        RAISE NOTICE 'Production environment detected. Skipping seed data insertion.';
    END IF;
END
$$;

-- ===========================================
-- 性能监控设置
-- ===========================================

-- 启用查询统计收集
SELECT pg_stat_statements_reset();

-- 设置日志记录参数（仅在开发环境）
DO $$
BEGIN
    IF current_setting('ai_ninja.environment', true) = 'development' OR 
       current_setting('ai_ninja.environment', true) IS NULL THEN
        
        -- 开发环境：记录慢查询
        ALTER SYSTEM SET log_min_duration_statement = 1000; -- 记录超过1秒的查询
        ALTER SYSTEM SET log_statement = 'mod'; -- 记录修改语句
        ALTER SYSTEM SET log_line_prefix = '%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h ';
        
    ELSE
        -- 生产环境：更保守的日志设置
        ALTER SYSTEM SET log_min_duration_statement = 5000; -- 记录超过5秒的查询
        ALTER SYSTEM SET log_statement = 'ddl'; -- 仅记录DDL语句
        ALTER SYSTEM SET log_line_prefix = '%t [%p]: [%l-1] ';
    END IF;
END
$$;

-- 重新加载配置
SELECT pg_reload_conf();

-- ===========================================
-- 数据库连接和性能设置
-- ===========================================

-- 为应用连接池优化设置
ALTER DATABASE ai_ninja SET shared_preload_libraries = 'pg_stat_statements';
ALTER DATABASE ai_ninja SET pg_stat_statements.track = 'all';
ALTER DATABASE ai_ninja SET pg_stat_statements.max = 10000;

-- 为当前会话设置优化参数
SET work_mem = '64MB';
SET maintenance_work_mem = '256MB';
SET checkpoint_completion_target = 0.9;
SET wal_buffers = '16MB';
SET default_statistics_target = 500;

-- ===========================================
-- 健康检查函数
-- ===========================================

-- 创建数据库健康检查函数
CREATE OR REPLACE FUNCTION db_health_check()
RETURNS TABLE(
    check_name TEXT,
    status TEXT,
    details TEXT,
    timestamp TIMESTAMP
) AS $$
BEGIN
    -- 检查数据库连接
    RETURN QUERY
    SELECT 
        'Database Connection'::TEXT,
        'OK'::TEXT,
        'Database is accessible'::TEXT,
        NOW();
    
    -- 检查扩展状态
    RETURN QUERY
    SELECT 
        'Required Extensions'::TEXT,
        CASE 
            WHEN COUNT(*) = 5 THEN 'OK'
            ELSE 'WARNING'
        END,
        'Installed: ' || STRING_AGG(name, ', ') || 
        CASE 
            WHEN COUNT(*) < 5 THEN ' (Missing some extensions)'
            ELSE ' (All required extensions installed)'
        END,
        NOW()
    FROM pg_extension 
    WHERE extname IN ('uuid-ossp', 'pg_stat_statements', 'pg_trgm', 'btree_gin', 'pg_cron');
    
    -- 检查内存设置
    RETURN QUERY
    SELECT 
        'Memory Configuration'::TEXT,
        CASE 
            WHEN current_setting('shared_buffers')::TEXT LIKE '%MB' 
            AND current_setting('effective_cache_size')::TEXT LIKE '%GB' THEN 'OK'
            ELSE 'WARNING'
        END,
        'shared_buffers=' || current_setting('shared_buffers') || 
        ', effective_cache_size=' || current_setting('effective_cache_size'),
        NOW();
    
    -- 检查连接数
    RETURN QUERY
    SELECT 
        'Active Connections'::TEXT,
        CASE 
            WHEN active_connections < max_connections * 0.8 THEN 'OK'
            WHEN active_connections < max_connections * 0.9 THEN 'WARNING'
            ELSE 'CRITICAL'
        END,
        active_connections::TEXT || '/' || max_connections::TEXT || ' connections',
        NOW()
    FROM (
        SELECT 
            COUNT(*) as active_connections,
            current_setting('max_connections')::INTEGER as max_connections
        FROM pg_stat_activity 
        WHERE state = 'active'
    ) conn_stats;
    
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 初始化完成标记
-- ===========================================

-- 创建初始化状态表
CREATE TABLE IF NOT EXISTS db_initialization_log (
    id SERIAL PRIMARY KEY,
    script_name VARCHAR(255) NOT NULL,
    executed_at TIMESTAMP DEFAULT NOW(),
    status VARCHAR(50) DEFAULT 'SUCCESS',
    details TEXT,
    environment VARCHAR(50) DEFAULT current_setting('ai_ninja.environment', true)
);

-- 记录初始化完成
INSERT INTO db_initialization_log (script_name, details) 
VALUES ('01-initialize-database.sql', 'Database initialization completed successfully');

-- ===========================================
-- 显示初始化结果
-- ===========================================

-- 显示健康检查结果
SELECT * FROM db_health_check();

-- 显示数据库统计信息
SELECT 
    'Database Size' as metric,
    pg_size_pretty(pg_database_size(current_database())) as value,
    'Initial size after setup' as description
UNION ALL
SELECT 
    'Available Extensions' as metric,
    COUNT(*)::TEXT as value,
    'Extensions ready for use' as description
FROM pg_available_extensions
UNION ALL
SELECT 
    'Configuration Status' as metric,
    'Ready' as value,
    'Database configured for AI Answer Ninja application' as description;

-- 提示后续步骤
SELECT 
    'Next Steps:' as instruction,
    '1. Run schema creation scripts (01-core-tables.sql)' as step_1,
    '2. Run performance functions (02-performance-functions.sql)' as step_2,
    '3. Run materialized views (03-materialized-views.sql)' as step_3,
    '4. Insert seed data if in development environment' as step_4;

RAISE NOTICE 'Database initialization completed successfully!';
RAISE NOTICE 'Environment: %', current_setting('ai_ninja.environment', true);
RAISE NOTICE 'Next: Execute schema creation scripts in order.';

-- ===========================================
-- 清理和权限最终设置
-- ===========================================

-- 为应用用户授予表权限（在表创建后执行）
-- 注意：这些权限会在后续的schema脚本中设置

-- 记录脚本执行完成时间
UPDATE db_initialization_log 
SET details = details || ' | Completed at: ' || NOW()::TEXT
WHERE script_name = '01-initialize-database.sql' 
AND executed_at = (SELECT MAX(executed_at) FROM db_initialization_log WHERE script_name = '01-initialize-database.sql');