-- AI Answer Ninja - 高性能数据库函数
-- 优化的存储过程和函数，确保<800ms响应时间

-- ===========================================
-- 实时查询函数（<5ms响应要求）
-- ===========================================

-- 快速白名单检查函数（优化版 - 目标<3ms）
CREATE OR REPLACE FUNCTION check_whitelist_fast(p_user_id UUID, p_phone VARCHAR(20))
RETURNS BOOLEAN AS $$
DECLARE
    result BOOLEAN := false;
    cache_key TEXT;
BEGIN
    -- 生成缓存键
    cache_key := 'wl:' || p_user_id::TEXT || ':' || p_phone;
    
    -- 尝试从Redis缓存获取（需要Redis扩展，这里模拟）
    -- SELECT redis_get(cache_key) INTO result;
    -- IF result IS NOT NULL THEN RETURN result; END IF;
    
    -- 使用优化的查询计划
    SELECT EXISTS (
        SELECT 1 FROM smart_whitelists 
        WHERE user_id = p_user_id 
        AND contact_phone = p_phone 
        AND is_active = true 
        AND (expires_at IS NULL OR expires_at > NOW())
    ) INTO result;
    
    -- 缓存结果（5分钟TTL）
    -- PERFORM redis_setex(cache_key, 300, result::TEXT);
    
    -- 异步更新命中统计（使用NOTIFY避免阻塞）
    IF result THEN
        PERFORM pg_notify('whitelist_hit', 
            json_build_object('user_id', p_user_id, 'phone', p_phone)::text);
    END IF;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

-- 异步处理白名单命中统计
CREATE OR REPLACE FUNCTION process_whitelist_hits()
RETURNS TRIGGER AS $$
BEGIN
    -- 批量更新命中统计，减少锁竞争
    WITH hits AS (
        SELECT user_id, contact_phone, COUNT(*) as hit_count
        FROM temp_whitelist_hits
        GROUP BY user_id, contact_phone
    )
    UPDATE smart_whitelists sw
    SET hit_count = sw.hit_count + h.hit_count, 
        last_hit_at = NOW()
    FROM hits h
    WHERE sw.user_id = h.user_id AND sw.contact_phone = h.contact_phone;
    
    -- 清理临时表
    DELETE FROM temp_whitelist_hits WHERE processed_at < NOW() - INTERVAL '1 minute';
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 创建函数索引以优化白名单检查
CREATE INDEX CONCURRENTLY idx_whitelist_function_support 
ON smart_whitelists(user_id, contact_phone, is_active, expires_at)
WHERE is_active = true;

-- ===========================================
-- 快速骚扰者画像查询（<10ms响应要求）
-- ===========================================

CREATE OR REPLACE FUNCTION get_spam_profile_fast(p_phone_hash VARCHAR(64))
RETURNS TABLE(
    spam_category VARCHAR(50),
    risk_score DECIMAL(3,2),
    confidence_level DECIMAL(3,2),
    feature_vector JSONB,
    behavioral_patterns JSONB,
    last_activity TIMESTAMP
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sp.spam_category,
        sp.risk_score,
        sp.confidence_level,
        sp.feature_vector,
        sp.behavioral_patterns,
        sp.last_activity
    FROM spam_profiles sp
    WHERE sp.phone_hash = p_phone_hash
    AND sp.last_activity > CURRENT_DATE - INTERVAL '180 days'
    AND sp.confidence_level > 0.3; -- 过滤低置信度数据
END;
$$ LANGUAGE plpgsql STABLE;

-- ===========================================
-- 对话上下文快速获取（<50ms响应要求）
-- ===========================================

CREATE OR REPLACE FUNCTION get_conversation_context_fast(
    p_call_id UUID, 
    p_limit INTEGER DEFAULT 10
)
RETURNS TABLE(
    sequence_number SMALLINT,
    speaker VARCHAR(10),
    message_text TEXT,
    intent_category VARCHAR(50),
    emotion VARCHAR(20),
    timestamp TIMESTAMP,
    processing_latency INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.sequence_number,
        c.speaker,
        c.message_text,
        c.intent_category,
        c.emotion,
        c.timestamp,
        c.processing_latency
    FROM conversations c
    WHERE c.call_record_id = p_call_id
    ORDER BY c.sequence_number DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- ===========================================
-- 用户画像快速获取
-- ===========================================

CREATE OR REPLACE FUNCTION get_user_profile_fast(p_user_id UUID)
RETURNS TABLE(
    user_id UUID,
    name VARCHAR(100),
    personality VARCHAR(50),
    voice_profile_id VARCHAR(100),
    language_preference VARCHAR(10),
    timezone VARCHAR(50),
    max_call_duration INTEGER,
    recent_call_count BIGINT,
    avg_call_duration DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.id,
        u.name,
        u.personality,
        u.voice_profile_id,
        u.language_preference,
        u.timezone,
        u.max_call_duration,
        -- 子查询获取最近统计信息
        (SELECT COUNT(*) FROM call_records cr 
         WHERE cr.user_id = u.id 
         AND cr.start_time > CURRENT_DATE - INTERVAL '7 days') as recent_calls,
        (SELECT AVG(cr.duration_seconds) FROM call_records cr 
         WHERE cr.user_id = u.id 
         AND cr.start_time > CURRENT_DATE - INTERVAL '30 days'
         AND cr.duration_seconds IS NOT NULL) as avg_duration
    FROM users u
    WHERE u.id = p_user_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- ===========================================
-- 通话分析和统计函数
-- ===========================================

-- 获取用户通话统计
CREATE OR REPLACE FUNCTION get_user_call_statistics(
    p_user_id UUID,
    p_days INTEGER DEFAULT 30
)
RETURNS TABLE(
    total_calls BIGINT,
    spam_calls BIGINT,
    avg_duration DECIMAL,
    total_duration BIGINT,
    ai_response_avg DECIMAL,
    cache_hit_rate DECIMAL,
    top_spam_categories TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    WITH call_stats AS (
        SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN cr.call_type = 'spam_handled' THEN 1 END) as spam,
            AVG(cr.duration_seconds) as avg_dur,
            SUM(cr.duration_seconds) as total_dur,
            AVG(cr.response_time_ms) as avg_response,
            AVG(cr.cache_hit_ratio) as avg_cache_hit
        FROM call_records cr
        WHERE cr.user_id = p_user_id
        AND cr.start_time > CURRENT_DATE - INTERVAL (p_days || ' days')
    ),
    spam_categories AS (
        SELECT ARRAY_AGG(DISTINCT sp.spam_category ORDER BY sp.spam_category) as categories
        FROM call_records cr
        JOIN conversations c ON cr.id = c.call_record_id
        JOIN spam_profiles sp ON sp.phone_hash = ENCODE(SHA256(cr.caller_phone::bytea), 'hex')
        WHERE cr.user_id = p_user_id
        AND cr.start_time > CURRENT_DATE - INTERVAL (p_days || ' days')
        AND c.intent_category IS NOT NULL
    )
    SELECT 
        cs.total,
        cs.spam,
        cs.avg_dur,
        cs.total_dur,
        cs.avg_response,
        cs.avg_cache_hit,
        sc.categories
    FROM call_stats cs
    CROSS JOIN spam_categories sc;
END;
$$ LANGUAGE plpgsql STABLE;

-- ===========================================
-- AI性能监控函数
-- ===========================================

-- 获取AI性能指标
CREATE OR REPLACE FUNCTION get_ai_performance_metrics(
    p_hours INTEGER DEFAULT 24
)
RETURNS TABLE(
    total_conversations BIGINT,
    avg_processing_latency DECIMAL,
    max_processing_latency INTEGER,
    intent_accuracy DECIMAL,
    emotion_detection_rate DECIMAL,
    response_cache_hit_rate DECIMAL,
    model_distribution JSONB
) AS $$
BEGIN
    RETURN QUERY
    WITH perf_metrics AS (
        SELECT 
            COUNT(*) as total_conv,
            AVG(c.processing_latency) as avg_latency,
            MAX(c.processing_latency) as max_latency,
            COUNT(CASE WHEN c.intent_category IS NOT NULL THEN 1 END)::DECIMAL / COUNT(*) as intent_acc,
            COUNT(CASE WHEN c.emotion IS NOT NULL AND c.emotion != 'neutral' THEN 1 END)::DECIMAL / COUNT(*) as emotion_rate
        FROM conversations c
        WHERE c.timestamp > NOW() - INTERVAL (p_hours || ' hours')
    ),
    cache_metrics AS (
        SELECT AVG(cr.cache_hit_ratio) as cache_hit
        FROM call_records cr
        WHERE cr.start_time > NOW() - INTERVAL (p_hours || ' hours')
        AND cr.cache_hit_ratio IS NOT NULL
    ),
    model_stats AS (
        SELECT JSON_OBJECT_AGG(cr.ai_model_version, model_count) as model_dist
        FROM (
            SELECT cr.ai_model_version, COUNT(*) as model_count
            FROM call_records cr
            WHERE cr.start_time > NOW() - INTERVAL (p_hours || ' hours')
            AND cr.ai_model_version IS NOT NULL
            GROUP BY cr.ai_model_version
        ) model_counts
    )
    SELECT 
        pm.total_conv,
        pm.avg_latency,
        pm.max_latency,
        pm.intent_acc,
        pm.emotion_rate,
        cm.cache_hit,
        ms.model_dist
    FROM perf_metrics pm
    CROSS JOIN cache_metrics cm
    CROSS JOIN model_stats ms;
END;
$$ LANGUAGE plpgsql STABLE;

-- ===========================================
-- 自动化维护函数
-- ===========================================

-- 自动分区管理函数
CREATE OR REPLACE FUNCTION maintain_partitions_auto()
RETURNS TEXT AS $$
DECLARE
    partition_date DATE;
    partition_name TEXT;
    old_partition_name TEXT;
    result_msg TEXT := '';
BEGIN
    -- 创建未来3个月的分区
    FOR i IN 0..2 LOOP
        partition_date := DATE_TRUNC('month', CURRENT_DATE + (i || ' months')::INTERVAL);
        
        -- 通话记录分区
        partition_name := 'call_records_' || TO_CHAR(partition_date, 'YYYY_MM');
        BEGIN
            EXECUTE FORMAT('CREATE TABLE IF NOT EXISTS %I PARTITION OF call_records 
                           FOR VALUES FROM (%L) TO (%L)',
                           partition_name, 
                           partition_date,
                           partition_date + INTERVAL '1 month');
            result_msg := result_msg || 'Created partition: ' || partition_name || E'\n';
        EXCEPTION WHEN duplicate_table THEN
            -- 分区已存在，跳过
            NULL;
        END;
        
        -- 对话记录分区
        partition_name := 'conversations_' || TO_CHAR(partition_date, 'YYYY_MM');
        BEGIN
            EXECUTE FORMAT('CREATE TABLE IF NOT EXISTS %I PARTITION OF conversations 
                           FOR VALUES FROM (%L) TO (%L)',
                           partition_name, 
                           partition_date,
                           partition_date + INTERVAL '1 month');
            result_msg := result_msg || 'Created partition: ' || partition_name || E'\n';
        EXCEPTION WHEN duplicate_table THEN
            NULL;
        END;
    END LOOP;
    
    -- 归档超过2年的分区
    FOR old_partition_name IN
        SELECT schemaname||'.'||tablename
        FROM pg_tables
        WHERE tablename ~ '^(call_records|conversations)_\d{4}_\d{2}$'
        AND tablename < 'call_records_' || TO_CHAR(CURRENT_DATE - INTERVAL '2 years', 'YYYY_MM')
    LOOP
        EXECUTE FORMAT('DROP TABLE IF EXISTS %s', old_partition_name);
        result_msg := result_msg || 'Dropped old partition: ' || old_partition_name || E'\n';
    END LOOP;
    
    -- 更新表统计信息
    ANALYZE call_records;
    ANALYZE conversations;
    
    result_msg := result_msg || 'Statistics updated' || E'\n';
    RETURN result_msg;
END;
$$ LANGUAGE plpgsql;

-- 清理过期数据函数
CREATE OR REPLACE FUNCTION cleanup_expired_data()
RETURNS TEXT AS $$
DECLARE
    deleted_count INTEGER := 0;
    result_msg TEXT := '';
BEGIN
    -- 清理过期的临时白名单
    DELETE FROM smart_whitelists 
    WHERE expires_at IS NOT NULL 
    AND expires_at < NOW() 
    AND whitelist_type = 'temporary';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    result_msg := result_msg || 'Cleaned expired whitelists: ' || deleted_count || E'\n';
    
    -- 清理超过6个月的不活跃垃圾画像
    DELETE FROM spam_profiles 
    WHERE last_activity < CURRENT_DATE - INTERVAL '180 days'
    AND total_reports < 5;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    result_msg := result_msg || 'Cleaned inactive spam profiles: ' || deleted_count || E'\n';
    
    -- 清理超过1年的低质量用户交互记录
    DELETE FROM user_spam_interactions 
    WHERE last_interaction < CURRENT_DATE - INTERVAL '1 year'
    AND interaction_count < 3
    AND user_feedback IS NULL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    result_msg := result_msg || 'Cleaned old interactions: ' || deleted_count || E'\n';
    
    -- 更新表统计
    ANALYZE smart_whitelists;
    ANALYZE spam_profiles;
    ANALYZE user_spam_interactions;
    
    RETURN result_msg;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 数据完整性和约束函数
-- ===========================================

-- 验证通话记录完整性
CREATE OR REPLACE FUNCTION validate_call_record_integrity()
RETURNS TABLE(
    issue_type TEXT,
    issue_count BIGINT,
    sample_ids UUID[]
) AS $$
BEGIN
    -- 检查没有结束时间但状态为完成的通话
    RETURN QUERY
    SELECT 
        'Missing end_time for completed calls'::TEXT,
        COUNT(*),
        ARRAY_AGG(id LIMIT 10)
    FROM call_records 
    WHERE call_status = 'completed' 
    AND end_time IS NULL
    HAVING COUNT(*) > 0;
    
    -- 检查持续时间异常的通话
    RETURN QUERY
    SELECT 
        'Duration mismatch'::TEXT,
        COUNT(*),
        ARRAY_AGG(id LIMIT 10)
    FROM call_records 
    WHERE end_time IS NOT NULL 
    AND start_time IS NOT NULL
    AND duration_seconds != EXTRACT(EPOCH FROM (end_time - start_time))
    HAVING COUNT(*) > 0;
    
    -- 检查没有对话记录的长时间通话
    RETURN QUERY
    SELECT 
        'Long calls without conversations'::TEXT,
        COUNT(*),
        ARRAY_AGG(cr.id LIMIT 10)
    FROM call_records cr
    LEFT JOIN conversations c ON cr.id = c.call_record_id
    WHERE cr.duration_seconds > 30 
    AND c.id IS NULL
    HAVING COUNT(*) > 0;
END;
$$ LANGUAGE plpgsql STABLE;

-- ===========================================
-- 定时任务调度
-- ===========================================

-- 设置自动维护任务
SELECT cron.schedule(
    'partition-maintenance',
    '0 2 1 * *', -- 每月1日凌晨2点执行
    'SELECT maintain_partitions_auto();'
);

SELECT cron.schedule(
    'data-cleanup',
    '0 3 * * 0', -- 每周日凌晨3点执行
    'SELECT cleanup_expired_data();'
);

SELECT cron.schedule(
    'statistics-update',
    '0 1 * * *', -- 每天凌晨1点执行
    'ANALYZE;'
);

-- ===========================================
-- 性能监控视图
-- ===========================================

-- 创建实时性能监控视图
CREATE OR REPLACE VIEW v_performance_dashboard AS
SELECT 
    'Database Performance' as metric_category,
    'Active Connections' as metric_name,
    (SELECT count(*) FROM pg_stat_activity WHERE state = 'active')::TEXT as metric_value,
    NOW() as measured_at
UNION ALL
SELECT 
    'Database Performance',
    'Cache Hit Ratio',
    ROUND((sum(blks_hit) / (sum(blks_hit) + sum(blks_read))) * 100, 2)::TEXT || '%',
    NOW()
FROM pg_stat_database
WHERE datname = current_database()
UNION ALL
SELECT 
    'Call Processing',
    'Avg Response Time (24h)',
    COALESCE(ROUND(AVG(response_time_ms), 2)::TEXT || ' ms', 'N/A'),
    NOW()
FROM call_records 
WHERE start_time > NOW() - INTERVAL '24 hours'
AND response_time_ms IS NOT NULL
UNION ALL
SELECT 
    'AI Performance',
    'Avg Processing Latency (24h)',
    COALESCE(ROUND(AVG(processing_latency), 2)::TEXT || ' ms', 'N/A'),
    NOW()
FROM conversations 
WHERE timestamp > NOW() - INTERVAL '24 hours'
AND processing_latency IS NOT NULL;

-- 创建索引使用情况监控视图
CREATE OR REPLACE VIEW v_index_usage_stats AS
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_tup_read,
    idx_tup_fetch,
    CASE 
        WHEN idx_tup_read = 0 THEN 'Unused'
        WHEN idx_tup_read < 1000 THEN 'Low Usage'
        WHEN idx_tup_read < 10000 THEN 'Medium Usage'
        ELSE 'High Usage'
    END as usage_level
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_tup_read DESC;