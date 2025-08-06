-- AI Answer Ninja - 物化视图和分析优化
-- 为高频查询和分析报告创建预计算视图

-- ===========================================
-- 核心分析物化视图
-- ===========================================

-- 通话分析汇总视图（15分钟更新）
CREATE MATERIALIZED VIEW mv_call_analytics_summary AS
SELECT 
    DATE_TRUNC('hour', cr.start_time) as hour_bucket,
    cr.user_id,
    cr.call_type,
    cr.call_status,
    
    -- 通话统计
    COUNT(*) as call_count,
    COUNT(CASE WHEN cr.call_status = 'completed' THEN 1 END) as completed_calls,
    COUNT(CASE WHEN cr.call_status = 'failed' THEN 1 END) as failed_calls,
    COUNT(CASE WHEN cr.call_status = 'terminated' THEN 1 END) as terminated_calls,
    
    -- 时长统计
    AVG(cr.duration_seconds) as avg_duration_seconds,
    MAX(cr.duration_seconds) as max_duration_seconds,
    MIN(cr.duration_seconds) as min_duration_seconds,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cr.duration_seconds) as median_duration,
    
    -- 性能指标
    AVG(cr.response_time_ms) as avg_response_time_ms,
    MAX(cr.response_time_ms) as max_response_time_ms,
    AVG(cr.cache_hit_ratio) as avg_cache_hit_ratio,
    
    -- AI模型统计
    MODE() WITHIN GROUP (ORDER BY cr.ai_model_version) as most_used_ai_model,
    COUNT(DISTINCT cr.ai_model_version) as ai_model_variants,
    
    -- 来电者分析
    COUNT(DISTINCT cr.caller_phone) as unique_callers,
    STRING_AGG(DISTINCT cr.caller_phone, ',' ORDER BY cr.caller_phone) FILTER (WHERE cr.call_status = 'terminated') as terminated_callers,
    
    -- 时间戳
    NOW() as last_updated
FROM call_records cr
WHERE cr.start_time >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY 
    DATE_TRUNC('hour', cr.start_time),
    cr.user_id,
    cr.call_type,
    cr.call_status;

-- 为物化视图创建唯一索引
CREATE UNIQUE INDEX idx_mv_call_analytics_pk 
ON mv_call_analytics_summary(hour_bucket, user_id, call_type, call_status);

-- 查询优化索引
CREATE INDEX idx_mv_call_analytics_user_time 
ON mv_call_analytics_summary(user_id, hour_bucket DESC);

CREATE INDEX idx_mv_call_analytics_performance 
ON mv_call_analytics_summary(avg_response_time_ms, avg_cache_hit_ratio);

-- ===========================================
-- 对话智能分析物化视图
-- ===========================================

-- 对话意图和情感分析汇总
CREATE MATERIALIZED VIEW mv_conversation_intelligence AS
WITH conversation_stats AS (
    SELECT 
        c.call_record_id,
        cr.user_id,
        cr.caller_phone,
        DATE_TRUNC('day', c.timestamp) as conversation_date,
        
        -- 对话轮次统计
        COUNT(*) as total_messages,
        COUNT(CASE WHEN c.speaker = 'caller' THEN 1 END) as caller_messages,
        COUNT(CASE WHEN c.speaker = 'ai' THEN 1 END) as ai_messages,
        
        -- 意图分析
        MODE() WITHIN GROUP (ORDER BY c.intent_category) FILTER (WHERE c.intent_category IS NOT NULL) as primary_intent,
        COUNT(DISTINCT c.intent_category) FILTER (WHERE c.intent_category IS NOT NULL) as intent_diversity,
        STRING_AGG(DISTINCT c.intent_category, ',' ORDER BY c.intent_category) FILTER (WHERE c.intent_category IS NOT NULL) as all_intents,
        
        -- 情感分析
        MODE() WITHIN GROUP (ORDER BY c.emotion) FILTER (WHERE c.emotion IS NOT NULL AND c.emotion != 'neutral') as dominant_emotion,
        COUNT(CASE WHEN c.emotion = 'frustrated' THEN 1 END) as frustrated_messages,
        COUNT(CASE WHEN c.emotion = 'angry' THEN 1 END) as angry_messages,
        COUNT(CASE WHEN c.emotion = 'happy' THEN 1 END) as happy_messages,
        
        -- 性能指标
        AVG(c.processing_latency) as avg_processing_latency,
        MAX(c.processing_latency) as max_processing_latency,
        AVG(c.confidence_score) as avg_confidence_score,
        
        -- 内容分析
        AVG(c.message_length) as avg_message_length,
        SUM(CASE WHEN c.has_keywords THEN 1 ELSE 0 END) as keyword_matches,
        SUM(CASE WHEN c.is_spam_indicator THEN 1 ELSE 0 END) as spam_indicators,
        
        -- 对话质量评估
        CASE 
            WHEN AVG(c.confidence_score) >= 0.8 AND AVG(c.processing_latency) <= 500 THEN 'High'
            WHEN AVG(c.confidence_score) >= 0.6 AND AVG(c.processing_latency) <= 1000 THEN 'Medium'
            ELSE 'Low'
        END as conversation_quality,
        
        -- 时间统计
        MIN(c.timestamp) as conversation_start,
        MAX(c.timestamp) as conversation_end,
        EXTRACT(EPOCH FROM (MAX(c.timestamp) - MIN(c.timestamp))) as total_duration_seconds
        
    FROM conversations c
    JOIN call_records cr ON c.call_record_id = cr.id
    WHERE c.timestamp >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY c.call_record_id, cr.user_id, cr.caller_phone, DATE_TRUNC('day', c.timestamp)
)
SELECT 
    cs.*,
    -- 垃圾电话相关性
    CASE 
        WHEN cs.spam_indicators > 0 OR cs.keyword_matches > cs.total_messages * 0.3 THEN 'High'
        WHEN cs.keyword_matches > 0 THEN 'Medium'
        ELSE 'Low'
    END as spam_likelihood,
    
    -- AI效果评估
    CASE 
        WHEN cs.dominant_emotion IN ('angry', 'frustrated') AND cs.total_duration_seconds > 120 THEN 'Poor'
        WHEN cs.conversation_quality = 'High' AND cs.total_duration_seconds < 60 THEN 'Excellent'
        WHEN cs.conversation_quality = 'Medium' THEN 'Good'
        ELSE 'Average'
    END as ai_effectiveness,
    
    NOW() as last_updated
FROM conversation_stats cs;

-- 对话智能分析索引
CREATE UNIQUE INDEX idx_mv_conversation_intelligence_pk 
ON mv_conversation_intelligence(call_record_id, conversation_date);

CREATE INDEX idx_mv_conversation_intelligence_user 
ON mv_conversation_intelligence(user_id, conversation_date DESC);

CREATE INDEX idx_mv_conversation_intelligence_intent 
ON mv_conversation_intelligence(primary_intent, spam_likelihood, ai_effectiveness);

CREATE INDEX idx_mv_conversation_intelligence_quality 
ON mv_conversation_intelligence(conversation_quality, ai_effectiveness, avg_confidence_score DESC);

-- ===========================================
-- 垃圾电话趋势分析物化视图
-- ===========================================

-- 垃圾电话模式识别和趋势分析
CREATE MATERIALIZED VIEW mv_spam_trend_analysis AS
WITH spam_patterns AS (
    SELECT 
        sp.spam_category,
        sp.phone_hash,
        DATE_TRUNC('day', sp.last_activity) as activity_date,
        sp.risk_score,
        sp.confidence_level,
        sp.total_reports,
        sp.successful_blocks,
        sp.false_positive_count,
        
        -- 成功率计算
        CASE 
            WHEN sp.total_reports > 0 THEN 
                ROUND((sp.successful_blocks::DECIMAL / sp.total_reports) * 100, 2)
            ELSE 0 
        END as success_rate_percent,
        
        -- 误报率计算
        CASE 
            WHEN sp.successful_blocks + sp.false_positive_count > 0 THEN 
                ROUND((sp.false_positive_count::DECIMAL / (sp.successful_blocks + sp.false_positive_count)) * 100, 2)
            ELSE 0 
        END as false_positive_rate_percent
        
    FROM spam_profiles sp
    WHERE sp.last_activity >= CURRENT_DATE - INTERVAL '60 days'
    AND sp.total_reports >= 1
),
daily_aggregations AS (
    SELECT 
        activity_date,
        spam_category,
        COUNT(*) as active_spam_numbers,
        AVG(risk_score) as avg_risk_score,
        AVG(confidence_level) as avg_confidence_level,
        SUM(total_reports) as total_reports_sum,
        SUM(successful_blocks) as total_successful_blocks,
        SUM(false_positive_count) as total_false_positives,
        AVG(success_rate_percent) as avg_success_rate,
        AVG(false_positive_rate_percent) as avg_false_positive_rate,
        
        -- 风险分布
        COUNT(CASE WHEN risk_score >= 0.8 THEN 1 END) as high_risk_count,
        COUNT(CASE WHEN risk_score >= 0.5 AND risk_score < 0.8 THEN 1 END) as medium_risk_count,
        COUNT(CASE WHEN risk_score < 0.5 THEN 1 END) as low_risk_count,
        
        -- 置信度分布
        COUNT(CASE WHEN confidence_level >= 0.8 THEN 1 END) as high_confidence_count,
        COUNT(CASE WHEN confidence_level >= 0.5 AND confidence_level < 0.8 THEN 1 END) as medium_confidence_count,
        COUNT(CASE WHEN confidence_level < 0.5 THEN 1 END) as low_confidence_count
        
    FROM spam_patterns
    GROUP BY activity_date, spam_category
)
SELECT 
    da.*,
    
    -- 趋势计算（与前一天比较）
    LAG(da.active_spam_numbers, 1) OVER (PARTITION BY da.spam_category ORDER BY da.activity_date) as prev_day_count,
    LAG(da.avg_risk_score, 1) OVER (PARTITION BY da.spam_category ORDER BY da.activity_date) as prev_day_risk_score,
    
    -- 趋势方向
    CASE 
        WHEN LAG(da.active_spam_numbers, 1) OVER (PARTITION BY da.spam_category ORDER BY da.activity_date) IS NULL THEN 'New'
        WHEN da.active_spam_numbers > LAG(da.active_spam_numbers, 1) OVER (PARTITION BY da.spam_category ORDER BY da.activity_date) THEN 'Increasing'
        WHEN da.active_spam_numbers < LAG(da.active_spam_numbers, 1) OVER (PARTITION BY da.spam_category ORDER BY da.activity_date) THEN 'Decreasing'
        ELSE 'Stable'
    END as trend_direction,
    
    -- 威胁等级评估
    CASE 
        WHEN da.avg_risk_score >= 0.8 AND da.active_spam_numbers > 10 THEN 'Critical'
        WHEN da.avg_risk_score >= 0.6 AND da.active_spam_numbers > 5 THEN 'High'
        WHEN da.avg_risk_score >= 0.4 THEN 'Medium'
        ELSE 'Low'
    END as threat_level,
    
    NOW() as last_updated
FROM daily_aggregations da;

-- 垃圾电话趋势分析索引
CREATE UNIQUE INDEX idx_mv_spam_trend_pk 
ON mv_spam_trend_analysis(activity_date, spam_category);

CREATE INDEX idx_mv_spam_trend_category_date 
ON mv_spam_trend_analysis(spam_category, activity_date DESC);

CREATE INDEX idx_mv_spam_trend_threat_level 
ON mv_spam_trend_analysis(threat_level, trend_direction, activity_date DESC);

CREATE INDEX idx_mv_spam_trend_performance 
ON mv_spam_trend_analysis(avg_success_rate DESC, avg_false_positive_rate);

-- ===========================================
-- 用户行为分析物化视图
-- ===========================================

-- 用户使用模式和偏好分析
CREATE MATERIALIZED VIEW mv_user_behavior_analysis AS
WITH user_call_patterns AS (
    SELECT 
        cr.user_id,
        COUNT(*) as total_calls,
        COUNT(CASE WHEN cr.call_status = 'completed' THEN 1 END) as completed_calls,
        COUNT(CASE WHEN cr.call_status = 'terminated' THEN 1 END) as terminated_calls,
        
        -- 时长统计
        AVG(cr.duration_seconds) FILTER (WHERE cr.duration_seconds IS NOT NULL) as avg_call_duration,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cr.duration_seconds) FILTER (WHERE cr.duration_seconds IS NOT NULL) as median_call_duration,
        
        -- 时间模式分析
        MODE() WITHIN GROUP (ORDER BY EXTRACT(HOUR FROM cr.start_time)) as most_active_hour,
        MODE() WITHIN GROUP (ORDER BY EXTRACT(DOW FROM cr.start_time)) as most_active_day_of_week,
        
        -- 来电类型分析
        COUNT(DISTINCT cr.caller_phone) as unique_callers,
        COUNT(CASE WHEN cr.call_type = 'spam_handled' THEN 1 END) as spam_calls_handled,
        
        -- AI性能对用户的影响
        AVG(cr.response_time_ms) FILTER (WHERE cr.response_time_ms IS NOT NULL) as avg_ai_response_time,
        AVG(cr.cache_hit_ratio) FILTER (WHERE cr.cache_hit_ratio IS NOT NULL) as avg_cache_hit_ratio,
        
        -- 最近活动
        MAX(cr.start_time) as last_call_time,
        MIN(cr.start_time) as first_call_time,
        EXTRACT(DAYS FROM (MAX(cr.start_time) - MIN(cr.start_time))) as usage_span_days
        
    FROM call_records cr
    WHERE cr.start_time >= CURRENT_DATE - INTERVAL '90 days'
    GROUP BY cr.user_id
),
user_whitelist_behavior AS (
    SELECT 
        sw.user_id,
        COUNT(*) as total_whitelist_entries,
        COUNT(CASE WHEN sw.whitelist_type = 'manual' THEN 1 END) as manual_entries,
        COUNT(CASE WHEN sw.whitelist_type = 'auto' THEN 1 END) as auto_entries,
        COUNT(CASE WHEN sw.whitelist_type = 'learned' THEN 1 END) as learned_entries,
        AVG(sw.hit_count) as avg_whitelist_hit_count,
        MAX(sw.last_hit_at) as last_whitelist_hit
    FROM smart_whitelists sw
    WHERE sw.is_active = true
    GROUP BY sw.user_id
),
user_interaction_patterns AS (
    SELECT 
        usi.user_id,
        COUNT(*) as total_spam_interactions,
        AVG(usi.ai_accuracy_score) FILTER (WHERE usi.ai_accuracy_score IS NOT NULL) as avg_ai_accuracy,
        AVG(usi.response_effectiveness) FILTER (WHERE usi.response_effectiveness IS NOT NULL) as avg_response_effectiveness,
        COUNT(CASE WHEN usi.user_feedback = 'spam' THEN 1 END) as confirmed_spam_feedback,
        COUNT(CASE WHEN usi.user_feedback = 'not_spam' THEN 1 END) as false_positive_feedback,
        MAX(usi.last_feedback_at) as last_feedback_time
    FROM user_spam_interactions usi
    WHERE usi.last_interaction >= CURRENT_DATE - INTERVAL '90 days'
    GROUP BY usi.user_id
)
SELECT 
    u.id as user_id,
    u.name,
    u.personality,
    u.language_preference,
    u.timezone,
    
    -- 通话行为模式
    COALESCE(ucp.total_calls, 0) as total_calls,
    COALESCE(ucp.completed_calls, 0) as completed_calls,
    COALESCE(ucp.terminated_calls, 0) as terminated_calls,
    COALESCE(ucp.avg_call_duration, 0) as avg_call_duration,
    COALESCE(ucp.median_call_duration, 0) as median_call_duration,
    ucp.most_active_hour,
    ucp.most_active_day_of_week,
    COALESCE(ucp.unique_callers, 0) as unique_callers,
    COALESCE(ucp.spam_calls_handled, 0) as spam_calls_handled,
    
    -- AI性能表现
    ucp.avg_ai_response_time,
    ucp.avg_cache_hit_ratio,
    COALESCE(uip.avg_ai_accuracy, 0) as avg_ai_accuracy,
    COALESCE(uip.avg_response_effectiveness, 0) as avg_response_effectiveness,
    
    -- 白名单使用情况
    COALESCE(uwb.total_whitelist_entries, 0) as total_whitelist_entries,
    COALESCE(uwb.manual_entries, 0) as manual_whitelist_entries,
    COALESCE(uwb.auto_entries, 0) as auto_whitelist_entries,
    COALESCE(uwb.learned_entries, 0) as learned_whitelist_entries,
    uwb.avg_whitelist_hit_count,
    
    -- 用户反馈行为
    COALESCE(uip.total_spam_interactions, 0) as total_spam_interactions,
    COALESCE(uip.confirmed_spam_feedback, 0) as confirmed_spam_feedback,
    COALESCE(uip.false_positive_feedback, 0) as false_positive_feedback,
    
    -- 用户活跃度分析
    ucp.last_call_time,
    ucp.first_call_time,
    ucp.usage_span_days,
    CASE 
        WHEN ucp.last_call_time >= CURRENT_DATE - INTERVAL '7 days' THEN 'Very Active'
        WHEN ucp.last_call_time >= CURRENT_DATE - INTERVAL '30 days' THEN 'Active'
        WHEN ucp.last_call_time >= CURRENT_DATE - INTERVAL '90 days' THEN 'Moderate'
        ELSE 'Inactive'
    END as activity_level,
    
    -- 用户类型分析
    CASE 
        WHEN COALESCE(ucp.spam_calls_handled, 0) > 50 THEN 'Heavy Spam Target'
        WHEN COALESCE(ucp.spam_calls_handled, 0) > 10 THEN 'Moderate Spam Target'
        WHEN COALESCE(ucp.spam_calls_handled, 0) > 0 THEN 'Light Spam Target'
        ELSE 'Minimal Spam Exposure'
    END as spam_exposure_level,
    
    -- AI满意度评估
    CASE 
        WHEN COALESCE(uip.avg_ai_accuracy, 0) >= 0.8 AND COALESCE(uip.avg_response_effectiveness, 0) >= 0.8 THEN 'Very Satisfied'
        WHEN COALESCE(uip.avg_ai_accuracy, 0) >= 0.6 AND COALESCE(uip.avg_response_effectiveness, 0) >= 0.6 THEN 'Satisfied'
        WHEN COALESCE(uip.avg_ai_accuracy, 0) >= 0.4 OR COALESCE(uip.avg_response_effectiveness, 0) >= 0.4 THEN 'Neutral'
        ELSE 'Needs Improvement'
    END as ai_satisfaction_level,
    
    NOW() as last_updated
FROM users u
LEFT JOIN user_call_patterns ucp ON u.id = ucp.user_id
LEFT JOIN user_whitelist_behavior uwb ON u.id = uwb.user_id  
LEFT JOIN user_interaction_patterns uip ON u.id = uip.user_id
WHERE u.created_at >= CURRENT_DATE - INTERVAL '1 year'; -- 只分析过去一年的用户

-- 用户行为分析索引
CREATE UNIQUE INDEX idx_mv_user_behavior_pk ON mv_user_behavior_analysis(user_id);

CREATE INDEX idx_mv_user_behavior_activity 
ON mv_user_behavior_analysis(activity_level, spam_exposure_level, ai_satisfaction_level);

CREATE INDEX idx_mv_user_behavior_performance 
ON mv_user_behavior_analysis(avg_ai_accuracy DESC, avg_response_effectiveness DESC);

CREATE INDEX idx_mv_user_behavior_usage 
ON mv_user_behavior_analysis(total_calls DESC, spam_calls_handled DESC);

-- ===========================================
-- 物化视图自动刷新任务
-- ===========================================

-- 设置物化视图自动刷新任务
SELECT cron.schedule(
    'refresh-call-analytics',
    '*/15 * * * *', -- 每15分钟刷新
    'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_call_analytics_summary;'
);

SELECT cron.schedule(
    'refresh-conversation-intelligence',
    '0 */2 * * *', -- 每2小时刷新
    'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_conversation_intelligence;'
);

SELECT cron.schedule(
    'refresh-spam-trends',
    '0 1 * * *', -- 每天凌晨1点刷新
    'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_spam_trend_analysis;'
);

SELECT cron.schedule(
    'refresh-user-behavior',
    '0 2 * * *', -- 每天凌晨2点刷新
    'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_behavior_analysis;'
);

-- ===========================================
-- 物化视图使用示例查询
-- ===========================================

-- 示例：获取用户最近24小时的通话分析
/*
SELECT 
    hour_bucket,
    call_count,
    avg_duration_seconds,
    avg_response_time_ms,
    avg_cache_hit_ratio
FROM mv_call_analytics_summary 
WHERE user_id = 'user-uuid-here'
AND hour_bucket >= NOW() - INTERVAL '24 hours'
ORDER BY hour_bucket DESC;
*/

-- 示例：获取垃圾电话趋势分析
/*
SELECT 
    spam_category,
    activity_date,
    active_spam_numbers,
    trend_direction,
    threat_level,
    avg_success_rate
FROM mv_spam_trend_analysis 
WHERE activity_date >= CURRENT_DATE - INTERVAL '7 days'
AND threat_level IN ('Critical', 'High')
ORDER BY activity_date DESC, threat_level DESC;
*/

-- 示例：获取用户满意度分析
/*
SELECT 
    activity_level,
    spam_exposure_level,
    ai_satisfaction_level,
    COUNT(*) as user_count,
    AVG(avg_ai_accuracy) as overall_ai_accuracy,
    AVG(avg_response_effectiveness) as overall_effectiveness
FROM mv_user_behavior_analysis 
GROUP BY activity_level, spam_exposure_level, ai_satisfaction_level
ORDER BY user_count DESC;
*/