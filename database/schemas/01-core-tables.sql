-- AI Answer Ninja - 优化的核心数据库架构
-- 基于database-optimizer建议重新设计
-- 优化目标: <800ms响应时间，支持从1K到1M+通话/月的扩展

-- ===========================================
-- 扩展和配置
-- ===========================================

-- 启用必要的PostgreSQL扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- 性能优化配置
SET work_mem = '64MB';
SET maintenance_work_mem = '256MB';
SET effective_cache_size = '6GB';
SET shared_buffers = '2GB';
SET random_page_cost = 1.1;  -- SSD优化
SET effective_io_concurrency = 200;

-- ===========================================
-- 核心用户表 (优化索引)
-- ===========================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    personality VARCHAR(50) DEFAULT 'polite',
    voice_profile_id VARCHAR(100),
    
    -- 性能优化：提取常用JSONB字段
    language_preference VARCHAR(10) DEFAULT 'zh-CN',
    timezone VARCHAR(50) DEFAULT 'Asia/Shanghai',
    max_call_duration INTEGER DEFAULT 300, -- 秒
    
    -- 完整偏好设置（不常访问的字段）
    preferences JSONB DEFAULT '{}',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 用户表优化索引
CREATE INDEX CONCURRENTLY idx_users_phone_lookup ON users(phone_number);
CREATE INDEX CONCURRENTLY idx_users_voice_profile ON users(voice_profile_id) 
WHERE voice_profile_id IS NOT NULL;

-- 用户偏好设置的GIN索引
CREATE INDEX CONCURRENTLY idx_users_preferences_gin ON users USING gin(preferences);

-- ===========================================
-- 优化的智能白名单表
-- ===========================================

CREATE TABLE smart_whitelists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_phone VARCHAR(20) NOT NULL,
    contact_name VARCHAR(100),
    
    -- 白名单类型和置信度
    whitelist_type VARCHAR(20) DEFAULT 'manual', -- 'manual', 'auto', 'temporary', 'learned'
    confidence_score DECIMAL(3,2) DEFAULT 1.0, -- 0.00-1.00
    
    -- 状态和过期管理
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMP, -- 临时白名单过期时间
    
    -- 学习和统计信息
    hit_count INTEGER DEFAULT 0, -- 命中次数
    last_hit_at TIMESTAMP, -- 最后命中时间
    
    -- 审计字段
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- 确保用户-电话的唯一性
    UNIQUE(user_id, contact_phone)
);

-- 白名单表的高性能索引
-- 最关键：实时查找索引（<5ms要求）
CREATE UNIQUE INDEX CONCURRENTLY idx_whitelists_fast_lookup 
ON smart_whitelists(user_id, contact_phone) 
WHERE is_active = true AND (expires_at IS NULL OR expires_at > NOW());

-- 管理和分析索引
CREATE INDEX CONCURRENTLY idx_whitelists_user_active ON smart_whitelists(user_id, is_active, updated_at DESC);
CREATE INDEX CONCURRENTLY idx_whitelists_phone_patterns ON smart_whitelists(contact_phone, whitelist_type);
CREATE INDEX CONCURRENTLY idx_whitelists_auto_cleanup ON smart_whitelists(expires_at) 
WHERE expires_at IS NOT NULL AND is_active = true;

-- ===========================================
-- 高性能通话记录表（时间分区）
-- ===========================================

CREATE TABLE call_records (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    caller_phone VARCHAR(20) NOT NULL,
    call_type VARCHAR(20) NOT NULL, -- 'incoming', 'outgoing', 'missed'
    call_status VARCHAR(20) NOT NULL, -- 'active', 'completed', 'failed', 'terminated'
    
    -- 时间信息（分区键）
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,
    duration_seconds INTEGER,
    
    -- 集成信息
    azure_call_id VARCHAR(100),
    audio_recording_url TEXT,
    
    -- 性能优化：提取常用的处理元数据
    response_time_ms INTEGER, -- AI响应延迟
    cache_hit_ratio DECIMAL(3,2), -- 缓存命中率
    ai_model_version VARCHAR(20), -- AI模型版本
    
    -- 剩余元数据（非频繁访问）
    processing_metadata JSONB,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- 分区键必须包含在主键中
    PRIMARY KEY (id, start_time)
) PARTITION BY RANGE (start_time);

-- 创建分区表（2025年各月份）
CREATE TABLE call_records_2025_01 PARTITION OF call_records 
FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE call_records_2025_02 PARTITION OF call_records 
FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

CREATE TABLE call_records_2025_03 PARTITION OF call_records 
FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');

CREATE TABLE call_records_2025_04 PARTITION OF call_records 
FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');

CREATE TABLE call_records_2025_05 PARTITION OF call_records 
FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');

CREATE TABLE call_records_2025_06 PARTITION OF call_records 
FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');

-- 通话记录表的高性能索引
-- 用户查询（最频繁）- 覆盖索引避免回表
CREATE INDEX CONCURRENTLY idx_call_records_user_summary 
ON call_records(user_id, start_time DESC) 
INCLUDE (caller_phone, call_type, duration_seconds, call_status, response_time_ms);

-- 来电者分析索引
CREATE INDEX CONCURRENTLY idx_call_records_caller_recent 
ON call_records(caller_phone, start_time DESC) 
WHERE start_time > CURRENT_DATE - INTERVAL '90 days';

-- 状态查询索引（仅活跃状态）
CREATE INDEX CONCURRENTLY idx_call_records_active_calls 
ON call_records(call_status, start_time DESC) 
WHERE call_status IN ('active', 'completed');

-- 性能分析索引
CREATE INDEX CONCURRENTLY idx_call_records_performance 
ON call_records(ai_model_version, response_time_ms) 
WHERE response_time_ms IS NOT NULL;

-- 处理元数据的GIN索引
CREATE INDEX CONCURRENTLY idx_call_records_metadata_features 
ON call_records USING gin((processing_metadata -> 'ai_features'));

-- ===========================================
-- 优化的对话记录表（时间分区）
-- ===========================================

CREATE TABLE conversations (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    call_record_id UUID NOT NULL,
    sequence_number SMALLINT NOT NULL, -- 对话中的顺序（1,2,3...）
    speaker VARCHAR(10) NOT NULL, -- 'caller', 'ai', 'system'
    message_text TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    
    -- AI处理结果
    confidence_score DECIMAL(3,2),
    intent_category VARCHAR(50),
    emotion VARCHAR(20), -- 'neutral', 'frustrated', 'happy', 'angry'
    processing_latency INTEGER, -- 处理延迟(ms)
    
    -- 性能优化字段
    message_length INTEGER GENERATED ALWAYS AS (length(message_text)) STORED,
    has_keywords BOOLEAN DEFAULT FALSE, -- 包含关键词标记
    is_spam_indicator BOOLEAN DEFAULT FALSE, -- 垃圾信息标记
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- 确保同一通话中的序号唯一
    UNIQUE(call_record_id, sequence_number),
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

-- 创建对话分区表
CREATE TABLE conversations_2025_01 PARTITION OF conversations 
FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE conversations_2025_02 PARTITION OF conversations 
FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

CREATE TABLE conversations_2025_03 PARTITION OF conversations 
FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');

CREATE TABLE conversations_2025_04 PARTITION OF conversations 
FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');

CREATE TABLE conversations_2025_05 PARTITION OF conversations 
FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');

CREATE TABLE conversations_2025_06 PARTITION OF conversations 
FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');

-- 对话表的高性能索引
-- 最重要：获取对话上下文（<50ms要求）
CREATE INDEX CONCURRENTLY idx_conversations_call_sequence 
ON conversations(call_record_id, sequence_number DESC)
INCLUDE (speaker, message_text, intent_category, timestamp);

-- 意图分析索引
CREATE INDEX CONCURRENTLY idx_conversations_intent_recent 
ON conversations(intent_category, timestamp DESC) 
WHERE intent_category IS NOT NULL 
AND timestamp > CURRENT_DATE - INTERVAL '30 days';

-- 情感分析索引
CREATE INDEX CONCURRENTLY idx_conversations_emotion_analysis 
ON conversations(emotion, timestamp DESC, call_record_id) 
WHERE emotion IS NOT NULL AND emotion != 'neutral';

-- 性能监控索引
CREATE INDEX CONCURRENTLY idx_conversations_performance_tracking 
ON conversations(processing_latency, timestamp DESC) 
WHERE processing_latency IS NOT NULL;

-- 全文搜索索引
CREATE INDEX CONCURRENTLY idx_conversations_fulltext_search 
ON conversations USING gin(to_tsvector('simple', message_text));

-- 垃圾内容检测索引
CREATE INDEX CONCURRENTLY idx_conversations_spam_detection 
ON conversations(has_keywords, is_spam_indicator, call_record_id) 
WHERE has_keywords = true OR is_spam_indicator = true;

-- ===========================================
-- 优化的骚扰者画像表（共享架构）
-- ===========================================

CREATE TABLE spam_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_hash VARCHAR(64) UNIQUE NOT NULL, -- SHA-256哈希保护隐私
    
    -- 分类和评分
    spam_category VARCHAR(50) NOT NULL, -- 'sales', 'loan', 'investment', 'insurance', 'scam'
    risk_score DECIMAL(3,2) NOT NULL DEFAULT 0.5, -- 0.00-1.00
    confidence_level DECIMAL(3,2) NOT NULL DEFAULT 0.5, -- 置信度
    
    -- 机器学习特征
    feature_vector JSONB, -- ML特征向量
    behavioral_patterns JSONB, -- 行为模式分析
    
    -- 统计信息
    total_reports INTEGER DEFAULT 1, -- 总举报数
    successful_blocks INTEGER DEFAULT 0, -- 成功拦截次数
    false_positive_count INTEGER DEFAULT 0, -- 误报次数
    
    -- 时间信息
    first_reported TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 骚扰者画像的高性能索引
-- 最关键：快速画像查找
CREATE UNIQUE INDEX CONCURRENTLY idx_spam_profiles_hash_lookup 
ON spam_profiles(phone_hash)
INCLUDE (spam_category, risk_score, confidence_level, last_activity);

-- 分类和风险评分索引
CREATE INDEX CONCURRENTLY idx_spam_profiles_category_risk 
ON spam_profiles(spam_category, risk_score DESC, last_activity DESC);

-- 活跃画像索引（过滤过期数据）
CREATE INDEX CONCURRENTLY idx_spam_profiles_active 
ON spam_profiles(last_activity DESC, risk_score DESC) 
WHERE last_activity > CURRENT_DATE - INTERVAL '180 days';

-- ML特征索引
CREATE INDEX CONCURRENTLY idx_spam_profiles_ml_features 
ON spam_profiles USING gin(feature_vector);

-- 统计分析索引
CREATE INDEX CONCURRENTLY idx_spam_profiles_statistics 
ON spam_profiles(total_reports DESC, successful_blocks DESC, false_positive_count);

-- ===========================================
-- 用户-画像交互表（学习系统）
-- ===========================================

CREATE TABLE user_spam_interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    spam_profile_id UUID NOT NULL REFERENCES spam_profiles(id) ON DELETE CASCADE,
    
    -- 交互统计
    interaction_count INTEGER DEFAULT 1,
    block_count INTEGER DEFAULT 0, -- 拦截次数
    allow_count INTEGER DEFAULT 0, -- 放行次数
    
    -- 用户反馈
    user_feedback VARCHAR(20), -- 'spam', 'not_spam', 'unknown', 'partial_spam'
    feedback_confidence DECIMAL(3,2), -- 用户反馈的置信度
    
    -- AI效果评估
    ai_accuracy_score DECIMAL(3,2), -- AI判断准确性
    response_effectiveness DECIMAL(3,2), -- 应答效果评分
    
    -- 时间信息
    first_interaction TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_interaction TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_feedback_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id, spam_profile_id)
);

-- 用户交互表索引
CREATE INDEX CONCURRENTLY idx_user_interactions_user_recent 
ON user_spam_interactions(user_id, last_interaction DESC)
INCLUDE (spam_profile_id, user_feedback, ai_accuracy_score);

CREATE INDEX CONCURRENTLY idx_user_interactions_feedback 
ON user_spam_interactions(user_feedback, feedback_confidence DESC, last_feedback_at DESC)
WHERE user_feedback IS NOT NULL;

CREATE INDEX CONCURRENTLY idx_user_interactions_effectiveness 
ON user_spam_interactions(response_effectiveness DESC, ai_accuracy_score DESC)
WHERE response_effectiveness IS NOT NULL;

-- ===========================================
-- 系统配置表（分层设计）
-- ===========================================

-- 全局配置表
CREATE TABLE global_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_value JSONB NOT NULL,
    config_type VARCHAR(20) DEFAULT 'system', -- 'system', 'feature', 'experiment', 'security'
    description TEXT,
    
    -- 配置元信息
    is_active BOOLEAN DEFAULT true,
    is_sensitive BOOLEAN DEFAULT false, -- 敏感配置标记
    requires_restart BOOLEAN DEFAULT false, -- 是否需要重启服务
    
    -- 版本控制
    version INTEGER DEFAULT 1,
    last_modified_by VARCHAR(100),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 用户个性化配置表
CREATE TABLE user_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    config_key VARCHAR(100) NOT NULL,
    config_value JSONB NOT NULL,
    
    -- 继承和覆盖
    inherits_global BOOLEAN DEFAULT false, -- 是否继承全局配置
    override_reason TEXT, -- 覆盖原因
    
    -- 自动学习配置
    auto_learned BOOLEAN DEFAULT false, -- 是否通过学习获得
    learning_confidence DECIMAL(3,2), -- 学习置信度
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id, config_key)
);

-- 配置表索引
CREATE INDEX CONCURRENTLY idx_global_configs_key_active 
ON global_configs(config_key, is_active, config_type);

CREATE INDEX CONCURRENTLY idx_global_configs_type_active 
ON global_configs(config_type, is_active, updated_at DESC);

CREATE INDEX CONCURRENTLY idx_user_configs_user_key 
ON user_configs(user_id, config_key, inherits_global);

CREATE INDEX CONCURRENTLY idx_user_configs_learned 
ON user_configs(auto_learned, learning_confidence DESC, updated_at DESC)
WHERE auto_learned = true;