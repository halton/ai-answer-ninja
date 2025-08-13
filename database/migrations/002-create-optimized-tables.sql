-- AI Answer Ninja - Database Migration 002
-- Create Optimized Tables with Partitioning and Advanced Indexing
-- 创建优化的核心业务表，支持分区、缓存和高性能查询

-- ===========================================
-- 智能白名单表 (smart_whitelists)
-- ===========================================

CREATE TABLE smart_whitelists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  contact_phone VARCHAR(20) NOT NULL,
  contact_name VARCHAR(100),
  
  -- 白名单类型和状态
  whitelist_type VARCHAR(20) DEFAULT 'manual' CHECK (whitelist_type IN ('manual', 'auto', 'temporary', 'learned')),
  confidence_score DECIMAL(3,2) DEFAULT 1.0 CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
  is_active BOOLEAN DEFAULT true,
  
  -- 过期机制
  expires_at TIMESTAMP,
  auto_renew BOOLEAN DEFAULT false,
  
  -- 学习和优化
  interaction_count INTEGER DEFAULT 0,
  last_interaction TIMESTAMP,
  user_feedback VARCHAR(20) CHECK (user_feedback IN ('positive', 'negative', 'neutral')),
  effectiveness_score DECIMAL(3,2) DEFAULT 0.5,
  
  -- 来源追踪
  source VARCHAR(50) DEFAULT 'manual', -- 'manual', 'imported', 'ai_learned', 'pattern_detected'
  source_metadata JSONB DEFAULT '{}',
  
  -- 审计信息
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),
  
  UNIQUE(user_id, contact_phone)
);

-- 智能白名单索引优化
CREATE INDEX idx_whitelists_user_active ON smart_whitelists(user_id, is_active, expires_at) 
  WHERE is_active = true;
CREATE INDEX idx_whitelists_phone_lookup ON smart_whitelists(contact_phone, is_active) 
  WHERE is_active = true;
CREATE INDEX idx_whitelists_expiry ON smart_whitelists(expires_at) 
  WHERE expires_at IS NOT NULL AND expires_at > CURRENT_TIMESTAMP;
CREATE INDEX idx_whitelists_confidence ON smart_whitelists(confidence_score, whitelist_type);
CREATE INDEX idx_whitelists_interaction ON smart_whitelists(last_interaction) 
  WHERE last_interaction IS NOT NULL;

-- 自动过期清理触发器
CREATE OR REPLACE FUNCTION cleanup_expired_whitelists()
RETURNS void AS $$
BEGIN
  UPDATE smart_whitelists 
  SET is_active = false
  WHERE is_active = true 
    AND expires_at < CURRENT_TIMESTAMP 
    AND auto_renew = false;
    
  -- 自动续期
  UPDATE smart_whitelists 
  SET expires_at = CURRENT_TIMESTAMP + INTERVAL '30 days'
  WHERE is_active = true 
    AND expires_at < CURRENT_TIMESTAMP 
    AND auto_renew = true;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 通话记录表 (call_records) - 分区表
-- ===========================================

CREATE TABLE call_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  caller_phone VARCHAR(20) NOT NULL,
  
  -- 通话基本信息
  call_type VARCHAR(20) NOT NULL CHECK (call_type IN ('incoming', 'outgoing', 'transferred')),
  call_status VARCHAR(20) NOT NULL CHECK (call_status IN ('answered', 'missed', 'rejected', 'transferred', 'ai_handled')),
  call_direction VARCHAR(10) NOT NULL CHECK (call_direction IN ('inbound', 'outbound')),
  
  -- 时间相关
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP,
  duration_seconds INTEGER GENERATED ALWAYS AS (EXTRACT(EPOCH FROM (end_time - start_time))::INTEGER) STORED,
  
  -- Azure集成
  azure_call_id VARCHAR(100),
  azure_correlation_id VARCHAR(100),
  
  -- 音频和录音
  audio_recording_url TEXT,
  audio_quality_score DECIMAL(3,2),
  audio_duration_seconds INTEGER,
  audio_file_size BIGINT,
  
  -- AI处理结果
  ai_handled BOOLEAN DEFAULT false,
  ai_confidence_score DECIMAL(3,2),
  ai_termination_reason VARCHAR(50),
  ai_processing_latency INTEGER, -- 毫秒
  
  -- 分类和标签
  spam_category VARCHAR(50),
  spam_confidence DECIMAL(3,2),
  caller_sentiment VARCHAR(20) CHECK (caller_sentiment IN ('positive', 'negative', 'neutral', 'aggressive', 'polite')),
  interaction_quality VARCHAR(20) CHECK (interaction_quality IN ('excellent', 'good', 'fair', 'poor')),
  
  -- 处理元数据
  processing_metadata JSONB DEFAULT '{}',
  error_details JSONB,
  
  -- 成本和计费
  processing_cost DECIMAL(10,4),
  azure_usage_minutes DECIMAL(6,2),
  
  -- 分区键
  year_month INTEGER GENERATED ALWAYS AS (EXTRACT(YEAR FROM start_time) * 100 + EXTRACT(MONTH FROM start_time)) STORED,
  
  -- 审计
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) PARTITION BY RANGE (year_month);

-- 创建分区表（2025年各月份）
CREATE TABLE call_records_202501 PARTITION OF call_records FOR VALUES FROM (202501) TO (202502);
CREATE TABLE call_records_202502 PARTITION OF call_records FOR VALUES FROM (202502) TO (202503);
CREATE TABLE call_records_202503 PARTITION OF call_records FOR VALUES FROM (202503) TO (202504);
CREATE TABLE call_records_202504 PARTITION OF call_records FOR VALUES FROM (202504) TO (202505);
CREATE TABLE call_records_202505 PARTITION OF call_records FOR VALUES FROM (202505) TO (202506);
CREATE TABLE call_records_202506 PARTITION OF call_records FOR VALUES FROM (202506) TO (202507);
CREATE TABLE call_records_202507 PARTITION OF call_records FOR VALUES FROM (202507) TO (202508);
CREATE TABLE call_records_202508 PARTITION OF call_records FOR VALUES FROM (202508) TO (202509);
CREATE TABLE call_records_202509 PARTITION OF call_records FOR VALUES FROM (202509) TO (202510);
CREATE TABLE call_records_202510 PARTITION OF call_records FOR VALUES FROM (202510) TO (202511);
CREATE TABLE call_records_202511 PARTITION OF call_records FOR VALUES FROM (202511) TO (202512);
CREATE TABLE call_records_202512 PARTITION OF call_records FOR VALUES FROM (202512) TO (202601);

-- 通话记录索引（应用到所有分区）
CREATE INDEX idx_call_records_user_time ON call_records(user_id, start_time DESC);
CREATE INDEX idx_call_records_caller ON call_records(caller_phone, start_time DESC);
CREATE INDEX idx_call_records_status ON call_records(call_status, ai_handled, start_time DESC);
CREATE INDEX idx_call_records_azure ON call_records(azure_call_id) WHERE azure_call_id IS NOT NULL;
CREATE INDEX idx_call_records_spam ON call_records(spam_category, spam_confidence) WHERE spam_category IS NOT NULL;
CREATE INDEX idx_call_records_duration ON call_records(duration_seconds) WHERE duration_seconds IS NOT NULL;

-- ===========================================
-- 对话记录表 (conversations) - 分区表
-- ===========================================

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_record_id UUID NOT NULL,
  
  -- 对话基本信息
  speaker VARCHAR(10) NOT NULL CHECK (speaker IN ('user', 'caller', 'ai', 'system')),
  message_text TEXT NOT NULL,
  message_order INTEGER NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  
  -- AI分析结果
  confidence_score DECIMAL(3,2),
  intent_category VARCHAR(50),
  intent_confidence DECIMAL(3,2),
  emotion VARCHAR(20) CHECK (emotion IN ('happy', 'sad', 'angry', 'neutral', 'frustrated', 'confused', 'satisfied')),
  emotion_confidence DECIMAL(3,2),
  
  -- 性能指标
  processing_latency INTEGER, -- 毫秒
  stt_latency INTEGER,
  ai_latency INTEGER,
  tts_latency INTEGER,
  
  -- 语言和语音
  language_code VARCHAR(10) DEFAULT 'zh-CN',
  audio_segment_url TEXT,
  audio_duration_ms INTEGER,
  
  -- AI响应质量
  response_appropriateness DECIMAL(3,2),
  response_coherence DECIMAL(3,2),
  user_satisfaction_score DECIMAL(3,2),
  
  -- 元数据
  metadata JSONB DEFAULT '{}',
  error_details JSONB,
  
  -- 分区键
  year_month INTEGER GENERATED ALWAYS AS (EXTRACT(YEAR FROM timestamp) * 100 + EXTRACT(MONTH FROM timestamp)) STORED,
  
  -- 审计
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) PARTITION BY RANGE (year_month);

-- 创建对话分区表
CREATE TABLE conversations_202501 PARTITION OF conversations FOR VALUES FROM (202501) TO (202502);
CREATE TABLE conversations_202502 PARTITION OF conversations FOR VALUES FROM (202502) TO (202503);
CREATE TABLE conversations_202503 PARTITION OF conversations FOR VALUES FROM (202503) TO (202504);
CREATE TABLE conversations_202504 PARTITION OF conversations FOR VALUES FROM (202504) TO (202505);
CREATE TABLE conversations_202505 PARTITION OF conversations FOR VALUES FROM (202505) TO (202506);
CREATE TABLE conversations_202506 PARTITION OF conversations FOR VALUES FROM (202506) TO (202507);
CREATE TABLE conversations_202507 PARTITION OF conversations FOR VALUES FROM (202507) TO (202508);
CREATE TABLE conversations_202508 PARTITION OF conversations FOR VALUES FROM (202508) TO (202509);
CREATE TABLE conversations_202509 PARTITION OF conversations FOR VALUES FROM (202509) TO (202510);
CREATE TABLE conversations_202510 PARTITION OF conversations FOR VALUES FROM (202510) TO (202511);
CREATE TABLE conversations_202511 PARTITION OF conversations FOR VALUES FROM (202511) TO (202512);
CREATE TABLE conversations_202512 PARTITION OF conversations FOR VALUES FROM (202512) TO (202601);

-- 对话记录索引
CREATE INDEX idx_conversations_call_order ON conversations(call_record_id, message_order);
CREATE INDEX idx_conversations_time ON conversations(timestamp DESC);
CREATE INDEX idx_conversations_intent ON conversations(intent_category, intent_confidence) WHERE intent_category IS NOT NULL;
CREATE INDEX idx_conversations_emotion ON conversations(emotion, emotion_confidence) WHERE emotion IS NOT NULL;
CREATE INDEX idx_conversations_performance ON conversations(processing_latency) WHERE processing_latency IS NOT NULL;
CREATE INDEX idx_conversations_speaker ON conversations(speaker, timestamp DESC);

-- ===========================================
-- 骚扰者画像表 (spam_profiles)
-- ===========================================

CREATE TABLE spam_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash VARCHAR(64) UNIQUE NOT NULL, -- SHA-256哈希，保护隐私
  
  -- 分类信息
  spam_category VARCHAR(50) NOT NULL CHECK (spam_category IN ('sales_call', 'loan_offer', 'investment_pitch', 'insurance_sales', 'survey', 'fraud', 'political', 'charity', 'other')),
  sub_category VARCHAR(50),
  
  -- 风险评估
  risk_score DECIMAL(3,2) NOT NULL DEFAULT 0.5 CHECK (risk_score >= 0.0 AND risk_score <= 1.0),
  confidence_level DECIMAL(3,2) NOT NULL DEFAULT 0.5 CHECK (confidence_level >= 0.0 AND confidence_level <= 1.0),
  threat_level VARCHAR(20) DEFAULT 'low' CHECK (threat_level IN ('low', 'medium', 'high', 'critical')),
  
  -- 机器学习特征
  feature_vector JSONB, -- ML特征向量
  behavioral_patterns JSONB DEFAULT '{}', -- 行为模式
  temporal_patterns JSONB DEFAULT '{}', -- 时间模式
  linguistic_patterns JSONB DEFAULT '{}', -- 语言模式
  
  -- 统计信息
  total_reports INTEGER DEFAULT 1,
  total_interactions INTEGER DEFAULT 0,
  successful_blocks INTEGER DEFAULT 0,
  block_success_rate DECIMAL(3,2) GENERATED ALWAYS AS (
    CASE WHEN total_interactions > 0 
    THEN successful_blocks::DECIMAL / total_interactions 
    ELSE 0 END
  ) STORED,
  
  -- 地理和运营商信息
  number_region VARCHAR(10),
  carrier_info JSONB,
  number_type VARCHAR(20) CHECK (number_type IN ('mobile', 'landline', 'voip', 'toll_free', 'unknown')),
  
  -- 时间信息
  first_reported TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_activity TIMESTAMP NOT NULL,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- 数据来源
  data_sources JSONB DEFAULT '[]', -- 数据来源列表
  verified_by_sources INTEGER DEFAULT 1,
  
  -- 状态
  is_active BOOLEAN DEFAULT true,
  is_verified BOOLEAN DEFAULT false,
  verification_source VARCHAR(50)
);

-- 骚扰者画像索引
CREATE INDEX idx_spam_profiles_hash ON spam_profiles(phone_hash);
CREATE INDEX idx_spam_profiles_category_risk ON spam_profiles(spam_category, risk_score DESC);
CREATE INDEX idx_spam_profiles_threat ON spam_profiles(threat_level, confidence_level DESC);
CREATE INDEX idx_spam_profiles_activity ON spam_profiles(last_activity DESC) WHERE is_active = true;
CREATE INDEX idx_spam_profiles_success_rate ON spam_profiles(block_success_rate DESC) WHERE total_interactions > 5;
CREATE INDEX idx_spam_profiles_region ON spam_profiles(number_region) WHERE number_region IS NOT NULL;

-- ===========================================
-- 用户-画像交互表 (user_spam_interactions)
-- ===========================================

CREATE TABLE user_spam_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  spam_profile_id UUID REFERENCES spam_profiles(id) ON DELETE CASCADE,
  
  -- 交互统计
  interaction_count INTEGER DEFAULT 1,
  blocked_count INTEGER DEFAULT 0,
  transferred_count INTEGER DEFAULT 0,
  
  -- 时间信息
  first_interaction TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_interaction TIMESTAMP NOT NULL,
  
  -- 用户反馈
  user_feedback VARCHAR(20) CHECK (user_feedback IN ('spam', 'not_spam', 'unknown', 'false_positive')),
  feedback_timestamp TIMESTAMP,
  feedback_confidence DECIMAL(3,2),
  
  -- AI效果评估
  ai_effectiveness_score DECIMAL(3,2), -- AI处理效果评分
  avg_call_duration DECIMAL(6,2), -- 平均通话时长
  termination_success_rate DECIMAL(3,2), -- 成功终止率
  
  -- 个性化学习
  user_tolerance_level DECIMAL(3,2) DEFAULT 0.5, -- 用户容忍度
  personalized_threshold DECIMAL(3,2), -- 个性化阈值
  
  -- 元数据
  interaction_metadata JSONB DEFAULT '{}',
  
  -- 审计
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(user_id, spam_profile_id)
);

-- 用户交互索引
CREATE INDEX idx_user_interactions_user ON user_spam_interactions(user_id, last_interaction DESC);
CREATE INDEX idx_user_interactions_spam ON user_spam_interactions(spam_profile_id, interaction_count DESC);
CREATE INDEX idx_user_interactions_feedback ON user_spam_interactions(user_feedback, feedback_timestamp) WHERE user_feedback IS NOT NULL;
CREATE INDEX idx_user_interactions_effectiveness ON user_spam_interactions(ai_effectiveness_score DESC) WHERE ai_effectiveness_score IS NOT NULL;

-- ===========================================
-- 全局配置表 (global_configs)
-- ===========================================

CREATE TABLE global_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key VARCHAR(100) UNIQUE NOT NULL,
  config_value JSONB NOT NULL,
  config_type VARCHAR(20) DEFAULT 'system' CHECK (config_type IN ('system', 'feature', 'experiment', 'security', 'ml')),
  
  -- 配置元数据
  description TEXT,
  category VARCHAR(50),
  tags JSONB DEFAULT '[]',
  
  -- 状态和版本
  is_active BOOLEAN DEFAULT true,
  version INTEGER DEFAULT 1,
  environment VARCHAR(20) DEFAULT 'production' CHECK (environment IN ('development', 'staging', 'production')),
  
  -- 验证和约束
  validation_schema JSONB, -- JSON Schema for validation
  constraints JSONB DEFAULT '{}',
  
  -- 审计信息
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- 生效时间
  effective_from TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  effective_until TIMESTAMP
);

-- 全局配置索引
CREATE INDEX idx_global_configs_key ON global_configs(config_key, is_active);
CREATE INDEX idx_global_configs_type ON global_configs(config_type, environment);
CREATE INDEX idx_global_configs_effective ON global_configs(effective_from, effective_until) WHERE is_active = true;
CREATE INDEX idx_global_configs_category ON global_configs(category) WHERE category IS NOT NULL;

-- ===========================================
-- 用户个性化配置表 (user_configs)
-- ===========================================

CREATE TABLE user_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  config_key VARCHAR(100) NOT NULL,
  config_value JSONB NOT NULL,
  
  -- 继承和覆盖
  inherits_global BOOLEAN DEFAULT false,
  override_reason TEXT,
  
  -- 配置元数据
  config_type VARCHAR(20) DEFAULT 'user' CHECK (config_type IN ('user', 'preference', 'override', 'experiment')),
  priority INTEGER DEFAULT 0, -- 优先级，数值越高优先级越高
  
  -- 状态
  is_active BOOLEAN DEFAULT true,
  
  -- 审计
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(user_id, config_key)
);

-- 用户配置索引
CREATE INDEX idx_user_configs_user ON user_configs(user_id, is_active);
CREATE INDEX idx_user_configs_key ON user_configs(config_key, config_type);
CREATE INDEX idx_user_configs_priority ON user_configs(priority DESC) WHERE is_active = true;

-- ===========================================
-- 自动分区管理
-- ===========================================

-- 自动创建未来分区的函数
CREATE OR REPLACE FUNCTION create_monthly_partitions()
RETURNS void AS $$
DECLARE
    start_date date;
    end_date date;
    year_month_val integer;
    partition_name text;
BEGIN
    -- 创建未来6个月的分区
    FOR i IN 0..5 LOOP
        start_date := date_trunc('month', CURRENT_DATE + (i || ' months')::interval);
        end_date := start_date + interval '1 month';
        year_month_val := extract(year from start_date) * 100 + extract(month from start_date);
        
        -- 创建通话记录分区
        partition_name := 'call_records_' || to_char(start_date, 'YYYYMM');
        EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF call_records
                       FOR VALUES FROM (%L) TO (%L)',
                       partition_name, year_month_val, 
                       extract(year from end_date) * 100 + extract(month from end_date));
        
        -- 创建对话记录分区
        partition_name := 'conversations_' || to_char(start_date, 'YYYYMM');
        EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF conversations
                       FOR VALUES FROM (%L) TO (%L)',
                       partition_name, year_month_val,
                       extract(year from end_date) * 100 + extract(month from end_date));
    END LOOP;
    
    RAISE NOTICE 'Monthly partitions created for next 6 months';
END;
$$ LANGUAGE plpgsql;

-- 删除旧分区的函数
CREATE OR REPLACE FUNCTION cleanup_old_partitions(retention_months INTEGER DEFAULT 12)
RETURNS void AS $$
DECLARE
    cutoff_date date;
    cutoff_year_month integer;
    partition_record record;
BEGIN
    cutoff_date := date_trunc('month', CURRENT_DATE - (retention_months || ' months')::interval);
    cutoff_year_month := extract(year from cutoff_date) * 100 + extract(month from cutoff_date);
    
    -- 删除旧的通话记录分区
    FOR partition_record IN
        SELECT schemaname, tablename
        FROM pg_tables
        WHERE tablename ~ '^call_records_[0-9]{6}$'
        AND substring(tablename from 14)::integer < cutoff_year_month
    LOOP
        EXECUTE format('DROP TABLE IF EXISTS %I.%I', partition_record.schemaname, partition_record.tablename);
        RAISE NOTICE 'Dropped old partition: %', partition_record.tablename;
    END LOOP;
    
    -- 删除旧的对话记录分区
    FOR partition_record IN
        SELECT schemaname, tablename
        FROM pg_tables
        WHERE tablename ~ '^conversations_[0-9]{6}$'
        AND substring(tablename from 15)::integer < cutoff_year_month
    LOOP
        EXECUTE format('DROP TABLE IF EXISTS %I.%I', partition_record.schemaname, partition_record.tablename);
        RAISE NOTICE 'Dropped old partition: %', partition_record.tablename;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 高性能查询函数
-- ===========================================

-- 快速白名单检查
CREATE OR REPLACE FUNCTION check_whitelist_fast(
  p_user_id UUID,
  p_phone VARCHAR(20)
)
RETURNS BOOLEAN AS $$
DECLARE
  is_whitelisted BOOLEAN := false;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM smart_whitelists 
    WHERE user_id = p_user_id 
      AND contact_phone = p_phone 
      AND is_active = true
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
  ) INTO is_whitelisted;
  
  RETURN is_whitelisted;
END;
$$ LANGUAGE plpgsql;

-- 获取骚扰者画像
CREATE OR REPLACE FUNCTION get_spam_profile_fast(p_phone_hash VARCHAR(64))
RETURNS JSONB AS $$
DECLARE
  profile_data JSONB;
BEGIN
  SELECT jsonb_build_object(
    'id', id,
    'spam_category', spam_category,
    'risk_score', risk_score,
    'confidence_level', confidence_level,
    'threat_level', threat_level,
    'total_reports', total_reports,
    'block_success_rate', block_success_rate,
    'last_activity', last_activity
  ) INTO profile_data
  FROM spam_profiles
  WHERE phone_hash = p_phone_hash AND is_active = true;
  
  RETURN COALESCE(profile_data, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql;

-- 获取对话上下文
CREATE OR REPLACE FUNCTION get_conversation_context_fast(
  p_call_id UUID,
  p_limit INTEGER DEFAULT 10
)
RETURNS JSONB AS $$
DECLARE
  context_data JSONB;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'speaker', speaker,
      'message_text', message_text,
      'intent_category', intent_category,
      'emotion', emotion,
      'timestamp', timestamp
    ) ORDER BY message_order DESC
  ) INTO context_data
  FROM (
    SELECT speaker, message_text, intent_category, emotion, timestamp, message_order
    FROM conversations
    WHERE call_record_id = p_call_id
    ORDER BY message_order DESC
    LIMIT p_limit
  ) recent_conversations;
  
  RETURN COALESCE(context_data, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 触发器和自动化
-- ===========================================

-- 更新时间戳触发器
CREATE TRIGGER update_whitelists_updated_at 
  BEFORE UPDATE ON smart_whitelists 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_call_records_updated_at 
  BEFORE UPDATE ON call_records 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_spam_profiles_updated_at 
  BEFORE UPDATE ON spam_profiles 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_interactions_updated_at 
  BEFORE UPDATE ON user_spam_interactions 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_global_configs_updated_at 
  BEFORE UPDATE ON global_configs 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_configs_updated_at 
  BEFORE UPDATE ON user_configs 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===========================================
-- 插入默认配置数据
-- ===========================================

-- 插入系统默认配置
INSERT INTO global_configs (config_key, config_value, config_type, description, category) VALUES
('ai.max_conversation_duration', '180', 'system', '最大对话时长（秒）', 'ai_settings'),
('ai.response_timeout', '5000', 'system', 'AI响应超时时间（毫秒）', 'ai_settings'),
('ai.confidence_threshold', '0.7', 'system', 'AI置信度阈值', 'ai_settings'),
('spam.risk_threshold', '0.8', 'system', '垃圾电话风险阈值', 'spam_detection'),
('spam.auto_block_enabled', 'true', 'feature', '自动拦截功能', 'spam_detection'),
('performance.max_latency_ms', '1500', 'system', '最大延迟限制（毫秒）', 'performance'),
('cache.ttl_seconds', '3600', 'system', '缓存过期时间（秒）', 'caching'),
('security.session_timeout', '3600', 'security', '会话超时时间（秒）', 'security'),
('security.max_login_attempts', '5', 'security', '最大登录尝试次数', 'security'),
('analytics.data_retention_days', '365', 'system', '数据保留天数', 'analytics')
ON CONFLICT (config_key) DO NOTHING;

-- ===========================================
-- 权限设置
-- ===========================================

-- 应用用户权限
GRANT SELECT, INSERT, UPDATE, DELETE ON smart_whitelists TO ai_ninja_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON call_records TO ai_ninja_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON conversations TO ai_ninja_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON spam_profiles TO ai_ninja_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_spam_interactions TO ai_ninja_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON global_configs TO ai_ninja_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_configs TO ai_ninja_app;

-- 只读用户权限
GRANT SELECT ON smart_whitelists TO ai_ninja_readonly;
GRANT SELECT ON call_records TO ai_ninja_readonly;
GRANT SELECT ON conversations TO ai_ninja_readonly;
GRANT SELECT ON spam_profiles TO ai_ninja_readonly;
GRANT SELECT ON user_spam_interactions TO ai_ninja_readonly;
GRANT SELECT ON global_configs TO ai_ninja_readonly;
GRANT SELECT ON user_configs TO ai_ninja_readonly;

-- ===========================================
-- 验证和完成
-- ===========================================

DO $$
DECLARE
  table_count INTEGER;
  partition_count INTEGER;
BEGIN
  -- 验证表创建
  SELECT COUNT(*) INTO table_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('smart_whitelists', 'call_records', 'conversations', 'spam_profiles', 'user_spam_interactions', 'global_configs', 'user_configs');
  
  IF table_count != 7 THEN
    RAISE EXCEPTION 'Expected 7 tables, found %', table_count;
  END IF;
  
  -- 验证分区创建
  SELECT COUNT(*) INTO partition_count
  FROM pg_tables
  WHERE schemaname = 'public'
    AND (tablename LIKE 'call_records_2025%' OR tablename LIKE 'conversations_2025%');
  
  IF partition_count != 24 THEN
    RAISE EXCEPTION 'Expected 24 partitions, found %', partition_count;
  END IF;
  
  -- 验证配置数据
  IF (SELECT COUNT(*) FROM global_configs) < 10 THEN
    RAISE EXCEPTION 'Default configurations not inserted properly';
  END IF;
  
  RAISE NOTICE 'Migration 002 completed successfully: % tables, % partitions created', table_count, partition_count;
END
$$;