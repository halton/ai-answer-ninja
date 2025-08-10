-- AI Answer Ninja 生产环境数据库初始化脚本
-- 并行执行任务1: 基础设施部署

\echo 'Starting AI Answer Ninja database initialization...'

-- 创建数据库（如果不存在）
SELECT 'CREATE DATABASE ai_answer_ninja'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ai_answer_ninja')\gexec

\c ai_answer_ninja;

-- 启用必要的PostgreSQL扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

\echo 'Extensions created successfully'

-- 性能优化配置
ALTER SYSTEM SET work_mem = '64MB';
ALTER SYSTEM SET maintenance_work_mem = '256MB'; 
ALTER SYSTEM SET effective_cache_size = '6GB';
ALTER SYSTEM SET shared_buffers = '2GB';
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET effective_io_concurrency = 200;

-- 重载配置
SELECT pg_reload_conf();

\echo 'Database configuration optimized'

-- 执行核心表创建
\i '../database/schemas/01-core-tables.sql'
\i '../database/schemas/02-performance-functions.sql'

-- 创建分区表（2024-2026年）
DO $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    -- 创建未来24个月的分区
    FOR i IN 0..23 LOOP
        start_date := DATE_TRUNC('month', CURRENT_DATE + (i || ' months')::INTERVAL);
        end_date := start_date + INTERVAL '1 month';
        
        -- 通话记录分区
        partition_name := 'call_records_' || TO_CHAR(start_date, 'YYYY_MM');
        EXECUTE FORMAT('CREATE TABLE IF NOT EXISTS %I PARTITION OF call_records 
                       FOR VALUES FROM (%L) TO (%L)',
                       partition_name, start_date, end_date);
        
        -- 对话记录分区
        partition_name := 'conversations_' || TO_CHAR(start_date, 'YYYY_MM');
        EXECUTE FORMAT('CREATE TABLE IF NOT EXISTS %I PARTITION OF conversations 
                       FOR VALUES FROM (%L) TO (%L)',
                       partition_name, start_date, end_date);
    END LOOP;
    
    RAISE NOTICE '创建了24个月的分区表';
END $$;

-- 创建初始用户和测试数据
INSERT INTO users (phone_number, name, personality) VALUES 
('13800138000', '测试管理员', 'professional'),
('13800138001', '演示用户1', 'polite'),
('13800138002', '演示用户2', 'humorous')
ON CONFLICT (phone_number) DO NOTHING;

-- 创建基础配置数据
INSERT INTO global_configs (config_key, config_value, config_type, description) VALUES
('system.version', '"1.0.0"', 'system', '系统版本'),
('ai.model.default', '"azure-openai-gpt4"', 'system', '默认AI模型'),
('performance.target_latency', '600', 'system', '目标响应延迟(ms)'),
('security.encryption_enabled', 'true', 'system', '是否启用加密'),
('monitoring.enabled', 'true', 'system', '是否启用监控')
ON CONFLICT (config_key) DO UPDATE SET 
    config_value = EXCLUDED.config_value,
    updated_at = CURRENT_TIMESTAMP;

-- 更新统计信息
ANALYZE;

\echo 'Database initialization completed successfully!'
\echo 'Created tables, partitions, and initial configuration.'