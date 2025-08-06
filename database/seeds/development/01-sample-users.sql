-- AI Answer Ninja - 开发环境种子数据
-- 用于开发和测试的示例用户数据

-- 仅在开发环境执行
DO $$
BEGIN
    IF current_setting('ai_ninja.environment', true) = 'development' OR 
       current_setting('ai_ninja.environment', true) IS NULL THEN
        RAISE NOTICE 'Inserting development seed data...';
    ELSE
        RAISE EXCEPTION 'This script should only run in development environment';
    END IF;
END
$$;

-- ===========================================
-- 示例用户数据
-- ===========================================

-- 清除现有测试数据（开发环境安全操作）
TRUNCATE TABLE user_spam_interactions, smart_whitelists, conversations, call_records, spam_profiles, user_configs, users RESTART IDENTITY CASCADE;

-- 插入测试用户
INSERT INTO users (id, phone_number, name, personality, voice_profile_id, language_preference, timezone, max_call_duration, preferences) VALUES
-- 用户1：礼貌型用户
(
    '550e8400-e29b-41d4-a716-446655440001',
    '+86-138-0013-8001', 
    '张明', 
    'polite', 
    'voice_profile_zhangming_001',
    'zh-CN',
    'Asia/Shanghai',
    300,
    '{"response_style": "gentle", "termination_patience": "high", "allow_callbacks": true, "notification_preferences": {"email": true, "sms": false}}'
),
-- 用户2：直接型用户
(
    '550e8400-e29b-41d4-a716-446655440002',
    '+86-138-0013-8002',
    '李华',
    'direct',
    'voice_profile_lihua_002',
    'zh-CN',
    'Asia/Shanghai',
    180,
    '{"response_style": "firm", "termination_patience": "low", "allow_callbacks": false, "auto_block_repeated": true}'
),
-- 用户3：幽默型用户
(
    '550e8400-e29b-41d4-a716-446655440003',
    '+86-138-0013-8003',
    '王小明',
    'humorous',
    'voice_profile_wangxiaoming_003',
    'zh-CN',
    'Asia/Shanghai',
    240,
    '{"response_style": "witty", "termination_patience": "medium", "use_humor": true, "conversation_length": "extended"}'
),
-- 用户4：专业型用户
(
    '550e8400-e29b-41d4-a716-446655440004',
    '+86-138-0013-8004',
    '陈总',
    'professional',
    'voice_profile_chenzong_004',
    'zh-CN',
    'Asia/Shanghai',
    120,
    '{"response_style": "business", "termination_patience": "very_low", "priority_mode": true, "work_hours_only": true}'
),
-- 用户5：学习型用户（AI优化）
(
    '550e8400-e29b-41d4-a716-446655440005',
    '+86-138-0013-8005',
    '刘敏',
    'adaptive',
    'voice_profile_liumin_005',
    'zh-CN',
    'Asia/Shanghai',
    360,
    '{"response_style": "learning", "auto_optimize": true, "feedback_learning": true, "pattern_recognition": true}'
);

-- ===========================================
-- 示例白名单数据
-- ===========================================

INSERT INTO smart_whitelists (id, user_id, contact_phone, contact_name, whitelist_type, confidence_score, hit_count, last_hit_at) VALUES
-- 张明的白名单
('660e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440001', '+86-139-1234-5678', '家人-妈妈', 'manual', 1.0, 15, NOW() - INTERVAL '2 hours'),
('660e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440001', '+86-139-8765-4321', '同事-小张', 'manual', 1.0, 8, NOW() - INTERVAL '1 day'),
('660e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440001', '+86-400-123-4567', '银行客服', 'auto', 0.85, 3, NOW() - INTERVAL '3 days'),

-- 李华的白名单
('660e8400-e29b-41d4-a716-446655440004', '550e8400-e29b-41d4-a716-446655440002', '+86-138-9999-8888', '老板', 'manual', 1.0, 25, NOW() - INTERVAL '30 minutes'),
('660e8400-e29b-41d4-a716-446655440005', '550e8400-e29b-41d4-a716-446655440002', '+86-137-7777-6666', '快递员', 'learned', 0.92, 12, NOW() - INTERVAL '5 hours'),

-- 王小明的白名单
('660e8400-e29b-41d4-a716-446655440006', '550e8400-e29b-41d4-a716-446655440003', '+86-136-5555-4444', '女朋友', 'manual', 1.0, 48, NOW() - INTERVAL '1 hour'),
('660e8400-e29b-41d4-a716-446655440007', '550e8400-e29b-41d4-a716-446655440003', '+86-135-3333-2222', '外卖小哥', 'temporary', 0.75, 5, NOW() - INTERVAL '2 days'),

-- 陈总的白名单
('660e8400-e29b-41d4-a716-446655440008', '550e8400-e29b-41d4-a716-446655440004', '+86-134-1111-0000', '秘书', 'manual', 1.0, 67, NOW() - INTERVAL '15 minutes'),
('660e8400-e29b-41d4-a716-446655440009', '550e8400-e29b-41d4-a716-446655440004', '+86-400-888-9999', '重要客户', 'manual', 1.0, 23, NOW() - INTERVAL '6 hours'),

-- 刘敏的白名单（AI学习生成的较多）
('660e8400-e29b-41d4-a716-446655440010', '550e8400-e29b-41d4-a716-446655440005', '+86-133-2222-1111', '医生', 'auto', 0.95, 6, NOW() - INTERVAL '1 week'),
('660e8400-e29b-41d4-a716-446655440011', '550e8400-e29b-41d4-a716-446655440005', '+86-132-4444-3333', '学校老师', 'learned', 0.88, 4, NOW() - INTERVAL '4 days');

-- 设置一些临时白名单（用于测试过期清理）
INSERT INTO smart_whitelists (user_id, contact_phone, contact_name, whitelist_type, confidence_score, expires_at) VALUES
('550e8400-e29b-41d4-a716-446655440003', '+86-131-9999-8888', '临时联系人', 'temporary', 0.70, NOW() + INTERVAL '2 days'),
('550e8400-e29b-41d4-a716-446655440005', '+86-130-7777-6666', '快递临时', 'temporary', 0.65, NOW() - INTERVAL '1 day'); -- 已过期，用于测试清理

-- ===========================================
-- 示例垃圾电话画像数据
-- ===========================================

INSERT INTO spam_profiles (id, phone_hash, spam_category, risk_score, confidence_level, feature_vector, behavioral_patterns, total_reports, successful_blocks, false_positive_count, last_activity) VALUES
-- 高风险销售电话
(
    '770e8400-e29b-41d4-a716-446655440001',
    ENCODE(SHA256('+86-400-123-9999'::bytea), 'hex'),
    'sales_call',
    0.95,
    0.92,
    '{"call_frequency": 8.5, "call_duration_avg": 45, "keywords_density": 0.78, "persistence_score": 0.89, "voice_pattern": "aggressive_sales"}',
    '{"common_opening": ["你好，我是", "了解一下"], "frequent_times": ["09:00-11:00", "14:00-17:00"], "response_to_rejection": "persistent", "hangup_pattern": "immediate_on_firm_no"}',
    156,
    142,
    8,
    NOW() - INTERVAL '2 hours'
),
-- 贷款诈骗电话
(
    '770e8400-e29b-41d4-a716-446655440002',
    ENCODE(SHA256('+86-177-8888-9999'::bytea), 'hex'),
    'loan_offer',
    0.98,
    0.96,
    '{"call_frequency": 12.3, "call_duration_avg": 67, "keywords_density": 0.85, "persistence_score": 0.95, "voice_pattern": "urgent_financial"}',
    '{"common_opening": ["急用钱吗", "贷款需要吗"], "frequent_times": ["19:00-21:00"], "response_to_rejection": "very_persistent", "pressure_tactics": true}',
    98,
    94,
    2,
    NOW() - INTERVAL '5 hours'
),
-- 投资理财电话
(
    '770e8400-e29b-41d4-a716-446655440003',
    ENCODE(SHA256('+86-188-7777-8888'::bytea), 'hex'),
    'investment_pitch',
    0.87,
    0.83,
    '{"call_frequency": 6.2, "call_duration_avg": 89, "keywords_density": 0.72, "persistence_score": 0.76, "voice_pattern": "professional_investment"}',
    '{"common_opening": ["投资机会", "理财产品"], "frequent_times": ["10:00-12:00", "15:00-17:00"], "response_to_rejection": "moderate", "follow_up_pattern": "callback_next_day"}',
    67,
    58,
    5,
    NOW() - INTERVAL '1 day'
),
-- 保险销售电话
(
    '770e8400-e29b-41d4-a716-446655440004',
    ENCODE(SHA256('+86-199-6666-7777'::bytea), 'hex'),
    'insurance_sales',
    0.78,
    0.75,
    '{"call_frequency": 4.8, "call_duration_avg": 78, "keywords_density": 0.68, "persistence_score": 0.67, "voice_pattern": "caring_insurance"}',
    '{"common_opening": ["保险了解", "保障需要"], "frequent_times": ["09:00-11:00"], "response_to_rejection": "gentle_persistent", "emotional_appeal": true}',
    43,
    36,
    4,
    NOW() - INTERVAL '3 days'
),
-- 低风险误报案例
(
    '770e8400-e29b-41d4-a716-446655440005',
    ENCODE(SHA256('+86-166-5555-6666'::bytea), 'hex'),
    'unknown',
    0.45,
    0.32,
    '{"call_frequency": 2.1, "call_duration_avg": 25, "keywords_density": 0.23, "persistence_score": 0.15, "voice_pattern": "uncertain"}',
    '{"common_opening": ["你好", "请问"], "frequent_times": ["random"], "response_to_rejection": "immediate_hangup", "polite_tone": true}',
    12,
    3,
    7,
    NOW() - INTERVAL '1 week'
);

-- ===========================================
-- 示例通话记录数据
-- ===========================================

-- 插入最近7天的示例通话记录
INSERT INTO call_records (id, user_id, caller_phone, call_type, call_status, start_time, end_time, duration_seconds, azure_call_id, response_time_ms, cache_hit_ratio, ai_model_version, processing_metadata) VALUES
-- 张明的通话记录
(
    '880e8400-e29b-41d4-a716-446655440001',
    '550e8400-e29b-41d4-a716-446655440001',
    '+86-139-1234-5678',
    'incoming',
    'completed',
    NOW() - INTERVAL '2 hours',
    NOW() - INTERVAL '2 hours' + INTERVAL '45 seconds',
    45,
    'azure_call_001',
    NULL, -- 白名单直接转接，无AI处理
    NULL,
    NULL,
    '{"call_type": "whitelist_transfer", "transfer_successful": true}'
),
(
    '880e8400-e29b-41d4-a716-446655440002',
    '550e8400-e29b-41d4-a716-446655440001',
    '+86-400-123-9999',
    'incoming',
    'terminated',
    NOW() - INTERVAL '5 hours',
    NOW() - INTERVAL '5 hours' + INTERVAL '67 seconds',
    67,
    'azure_call_002',
    450,
    0.85,
    'gpt-4-turbo-1106',
    '{"ai_confidence": 0.92, "spam_detected": true, "termination_reason": "user_request", "keywords_matched": ["产品推荐", "优惠活动"]}'
),

-- 李华的通话记录（直接型，处理速度快）
(
    '880e8400-e29b-41d4-a716-446655440003',
    '550e8400-e29b-41d4-a716-446655440002',
    '+86-177-8888-9999',
    'incoming',
    'terminated',
    NOW() - INTERVAL '8 hours',
    NOW() - INTERVAL '8 hours' + INTERVAL '23 seconds',
    23,
    'azure_call_003',
    320,
    0.95,
    'gpt-4-turbo-1106',
    '{"ai_confidence": 0.98, "spam_detected": true, "termination_reason": "ai_automatic", "keywords_matched": ["贷款", "急用钱"], "user_satisfaction": "high"}'
),

-- 王小明的通话记录（幽默型，时间较长）
(
    '880e8400-e29b-41d4-a716-446655440004',
    '550e8400-e29b-41d4-a716-446655440003',
    '+86-188-7777-8888',
    'incoming',
    'terminated',
    NOW() - INTERVAL '1 day',
    NOW() - INTERVAL '1 day' + INTERVAL '134 seconds',
    134,
    'azure_call_004',
    680,
    0.72,
    'gpt-4-turbo-1106',
    '{"ai_confidence": 0.87, "spam_detected": true, "termination_reason": "caller_hangup", "humor_used": true, "caller_reaction": "confused", "effectiveness": "high"}'
),

-- 陈总的通话记录（专业型，快速处理）
(
    '880e8400-e29b-41d4-a716-446655440005',
    '550e8400-e29b-41d4-a716-446655440004',
    '+86-199-6666-7777',
    'incoming',
    'terminated',
    NOW() - INTERVAL '3 days',
    NOW() - INTERVAL '3 days' + INTERVAL '15 seconds',
    15,
    'azure_call_005',
    290,
    0.98,
    'gpt-4-turbo-1106',
    '{"ai_confidence": 0.78, "spam_detected": true, "termination_reason": "ai_automatic", "business_mode": true, "efficiency_score": 0.95}'
),

-- 刘敏的通话记录（自适应学习）
(
    '880e8400-e29b-41d4-a716-446655440006',
    '550e8400-e29b-41d4-a716-446655440005',
    '+86-166-5555-6666',
    'incoming',
    'completed',
    NOW() - INTERVAL '1 week',
    NOW() - INTERVAL '1 week' + INTERVAL '89 seconds',
    89,
    'azure_call_006',
    520,
    0.67,
    'gpt-4-turbo-1106',
    '{"ai_confidence": 0.45, "spam_detected": false, "learning_feedback": "potential_false_positive", "user_feedback_required": true, "conversation_quality": "uncertain"}'
);

-- ===========================================
-- 示例对话记录数据
-- ===========================================

-- 张明 vs 销售电话的对话
INSERT INTO conversations (call_record_id, sequence_number, speaker, message_text, timestamp, confidence_score, intent_category, emotion, processing_latency, message_length, has_keywords, is_spam_indicator) VALUES
('880e8400-e29b-41d4-a716-446655440002', 1, 'caller', '你好，我是某某公司的，向您推荐一个优惠产品', NOW() - INTERVAL '5 hours', 0.95, 'sales_opening', 'neutral', 380, 24, true, true),
('880e8400-e29b-41d4-a716-446655440002', 2, 'ai', '您好，感谢您的来电，不过我现在不太方便了解产品信息', NOW() - INTERVAL '5 hours' + INTERVAL '5 seconds', 0.88, 'polite_decline', 'polite', 420, 28, false, false),
('880e8400-e29b-41d4-a716-446655440002', 3, 'caller', '这个产品真的很优惠，只需要几分钟时间', NOW() - INTERVAL '5 hours' + INTERVAL '12 seconds', 0.92, 'sales_persistence', 'insistent', 350, 19, true, true),
('880e8400-e29b-41d4-a716-446655440002', 4, 'ai', '我已经说得很清楚了，谢谢您的好意，再见', NOW() - INTERVAL '5 hours' + INTERVAL '18 seconds', 0.90, 'firm_decline', 'slightly_firm', 450, 21, false, false);

-- 李华 vs 贷款电话的对话（快速终止）
INSERT INTO conversations (call_record_id, sequence_number, speaker, message_text, timestamp, confidence_score, intent_category, emotion, processing_latency, message_length, has_keywords, is_spam_indicator) VALUES
('880e8400-e29b-41d4-a716-446655440003', 1, 'caller', '急用钱吗？我们这里有低息贷款', NOW() - INTERVAL '8 hours', 0.98, 'loan_offer', 'urgent', 280, 15, true, true),
('880e8400-e29b-41d4-a716-446655440003', 2, 'ai', '不需要，请不要再打了', NOW() - INTERVAL '8 hours' + INTERVAL '3 seconds', 0.95, 'direct_decline', 'firm', 290, 10, false, false);

-- 王小明 vs 投资电话的对话（幽默应对）
INSERT INTO conversations (call_record_id, sequence_number, speaker, message_text, timestamp, confidence_score, intent_category, emotion, processing_latency, message_length, has_keywords, is_spam_indicator) VALUES
('880e8400-e29b-41d4-a716-446655440004', 1, 'caller', '先生您好，有一个很好的投资机会', NOW() - INTERVAL '1 day', 0.87, 'investment_opening', 'professional', 560, 16, true, true),
('880e8400-e29b-41d4-a716-446655440004', 2, 'ai', '哦，投资啊，我现在只投资睡眠和美食，其他都不感兴趣', NOW() - INTERVAL '1 day' + INTERVAL '4 seconds', 0.83, 'humorous_decline', 'humorous', 650, 26, false, false),
('880e8400-e29b-41d4-a716-446655440004', 3, 'caller', '先生，这个真的是很好的机会，收益很高', NOW() - INTERVAL '1 day' + INTERVAL '15 seconds', 0.85, 'investment_persistence', 'confused', 580, 19, true, true),
('880e8400-e29b-41d4-a716-446655440004', 4, 'ai', '收益高？那太好了，我投资一块钱，明天能收回两块吗？', NOW() - INTERVAL '1 day' + INTERVAL '22 seconds', 0.79, 'sarcastic_response', 'sarcastic', 720, 24, false, false),
('880e8400-e29b-41d4-a716-446655440004', 5, 'caller', '不是这样的...', NOW() - INTERVAL '1 day' + INTERVAL '35 seconds', 0.65, 'confused_response', 'frustrated', 490, 6, false, false);

-- 陈总 vs 保险电话的对话（快速专业处理）
INSERT INTO conversations (call_record_id, sequence_number, speaker, message_text, timestamp, confidence_score, intent_category, emotion, processing_latency, message_length, has_keywords, is_spam_indicator) VALUES
('880e8400-e29b-41d4-a716-446655440005', 1, 'caller', '您好，了解一下保险产品吗', NOW() - INTERVAL '3 days', 0.78, 'insurance_inquiry', 'polite', 250, 12, true, true),
('880e8400-e29b-41d4-a716-446655440005', 2, 'ai', '不需要，谢谢', NOW() - INTERVAL '3 days' + INTERVAL '2 seconds', 0.92, 'business_decline', 'professional', 280, 6, false, false);

-- 刘敏 vs 不确定电话的对话（学习模式）
INSERT INTO conversations (call_record_id, sequence_number, speaker, message_text, timestamp, confidence_score, intent_category, emotion, processing_latency, message_length, has_keywords, is_spam_indicator) VALUES
('880e8400-e29b-41d4-a716-446655440006', 1, 'caller', '你好，请问是刘敏吗', NOW() - INTERVAL '1 week', 0.45, 'identity_verification', 'uncertain', 480, 9, false, false),
('880e8400-e29b-41d4-a716-446655440006', 2, 'ai', '您好，我是刘敏的AI助手，请问有什么事情吗', NOW() - INTERVAL '1 week' + INTERVAL '3 seconds', 0.67, 'assistant_response', 'cautious', 520, 20, false, false),
('880e8400-e29b-41d4-a716-446655440006', 3, 'caller', '我想找她确认一下地址信息', NOW() - INTERVAL '1 week' + INTERVAL '10 seconds', 0.32, 'information_request', 'neutral', 510, 12, false, false),
('880e8400-e29b-41d4-a716-446655440006', 4, 'ai', '抱歉，我无法提供个人信息，建议您通过其他方式联系', NOW() - INTERVAL '1 week' + INTERVAL '15 seconds', 0.78, 'privacy_protection', 'protective', 540, 24, false, false);

-- ===========================================
-- 示例用户交互数据
-- ===========================================

INSERT INTO user_spam_interactions (user_id, spam_profile_id, interaction_count, block_count, user_feedback, feedback_confidence, ai_accuracy_score, response_effectiveness, last_interaction, last_feedback_at) VALUES
-- 张明对销售电话的反馈
('550e8400-e29b-41d4-a716-446655440001', '770e8400-e29b-41d4-a716-446655440001', 3, 3, 'spam', 0.95, 0.92, 0.88, NOW() - INTERVAL '5 hours', NOW() - INTERVAL '4 hours'),

-- 李华对贷款电话的反馈
('550e8400-e29b-41d4-a716-446655440002', '770e8400-e29b-41d4-a716-446655440002', 1, 1, 'spam', 1.0, 0.98, 0.95, NOW() - INTERVAL '8 hours', NOW() - INTERVAL '7 hours'),

-- 王小明对投资电话的反馈
('550e8400-e29b-41d4-a716-446655440003', '770e8400-e29b-41d4-a716-446655440003', 2, 2, 'spam', 0.87, 0.87, 0.92, NOW() - INTERVAL '1 day', NOW() - INTERVAL '23 hours'),

-- 陈总对保险电话的反馈
('550e8400-e29b-41d4-a716-446655440004', '770e8400-e29b-41d4-a716-446655440004', 1, 1, 'spam', 0.78, 0.78, 0.85, NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days'),

-- 刘敏对不确定电话的反馈（误报案例）
('550e8400-e29b-41d4-a716-446655440005', '770e8400-e29b-41d4-a716-446655440005', 1, 0, 'not_spam', 0.80, 0.45, 0.60, NOW() - INTERVAL '1 week', NOW() - INTERVAL '6 days');

-- ===========================================
-- 示例配置数据
-- ===========================================

-- 全局配置
INSERT INTO global_configs (config_key, config_value, config_type, description, is_active) VALUES
('ai_model_default', '"gpt-4-turbo-1106"', 'system', 'Default AI model for conversation processing', true),
('response_timeout_ms', '2000', 'performance', 'Maximum response time in milliseconds', true),
('max_conversation_turns', '10', 'system', 'Maximum number of conversation turns before auto-termination', true),
('cache_ttl_seconds', '3600', 'performance', 'Default cache TTL in seconds', true),
('spam_confidence_threshold', '0.7', 'security', 'Minimum confidence score to classify as spam', true),
('enable_humor_responses', 'true', 'feature', 'Enable humorous response generation', true),
('daily_call_limit_default', '100', 'system', 'Default daily call limit per user', true);

-- 用户个性化配置
INSERT INTO user_configs (user_id, config_key, config_value, inherits_global, auto_learned, learning_confidence) VALUES
-- 张明的个性化配置
('550e8400-e29b-41d4-a716-446655440001', 'response_style_preference', '"gentle_persistent"', false, false, NULL),
('550e8400-e29b-41d4-a716-446655440001', 'max_conversation_turns', '8', false, true, 0.85),

-- 李华的个性化配置
('550e8400-e29b-41d4-a716-446655440002', 'response_style_preference', '"direct_firm"', false, false, NULL),
('550e8400-e29b-41d4-a716-446655440002', 'max_conversation_turns', '3', false, false, NULL),
('550e8400-e29b-41d4-a716-446655440002', 'auto_block_threshold', '0.6', false, true, 0.92),

-- 王小明的个性化配置
('550e8400-e29b-41d4-a716-446655440003', 'enable_humor_responses', 'true', false, false, NULL),
('550e8400-e29b-41d4-a716-446655440003', 'humor_intensity', '0.8', false, true, 0.78),

-- 陈总的个性化配置
('550e8400-e29b-41d4-a716-446655440004', 'business_mode', 'true', false, false, NULL),
('550e8400-e29b-41d4-a716-446655440004', 'max_conversation_turns', '2', false, false, NULL),
('550e8400-e29b-41d4-a716-446655440004', 'priority_contacts_only', 'true', false, false, NULL),

-- 刘敏的个性化配置（自适应学习）
('550e8400-e29b-41d4-a716-446655440005', 'auto_learning_enabled', 'true', false, false, NULL),
('550e8400-e29b-41d4-a716-446655440005', 'learning_sensitivity', '0.75', false, true, 0.88),
('550e8400-e29b-41d4-a716-446655440005', 'feedback_weight', '0.9', false, true, 0.82);

-- ===========================================
-- 完成种子数据插入
-- ===========================================

-- 更新表统计信息
ANALYZE users;
ANALYZE smart_whitelists;
ANALYZE spam_profiles;
ANALYZE call_records;
ANALYZE conversations;
ANALYZE user_spam_interactions;
ANALYZE global_configs;
ANALYZE user_configs;

-- 显示插入的数据统计
SELECT 
    'users' as table_name,
    COUNT(*) as record_count,
    'Sample users for testing different personalities' as description
FROM users
UNION ALL
SELECT 
    'smart_whitelists',
    COUNT(*),
    'Whitelist entries including manual, auto, learned, and temporary types'
FROM smart_whitelists
UNION ALL
SELECT 
    'spam_profiles',
    COUNT(*),
    'Spam phone profiles with different risk levels and categories'
FROM spam_profiles
UNION ALL
SELECT 
    'call_records',
    COUNT(*),
    'Sample call records from the past week'
FROM call_records
UNION ALL
SELECT 
    'conversations',
    COUNT(*),
    'Conversation messages showing different AI response styles'
FROM conversations
UNION ALL
SELECT 
    'user_spam_interactions',
    COUNT(*),
    'User feedback on spam detection accuracy'
FROM user_spam_interactions
UNION ALL
SELECT 
    'global_configs',
    COUNT(*),
    'System-wide configuration parameters'
FROM global_configs
UNION ALL
SELECT 
    'user_configs',
    COUNT(*),
    'User-specific personalized configurations'
FROM user_configs;

-- 记录种子数据插入完成
INSERT INTO db_initialization_log (script_name, details) 
VALUES ('01-sample-users.sql', 'Development seed data inserted successfully');

RAISE NOTICE 'Development seed data inserted successfully!';
RAISE NOTICE 'Users: 5, Whitelists: 11, Spam Profiles: 5, Call Records: 6, Conversations: 14';
RAISE NOTICE 'You can now test the system with realistic sample data.';

-- ===========================================
-- 验证数据完整性
-- ===========================================

-- 检查外键关系
DO $$
DECLARE
    fk_errors TEXT := '';
BEGIN
    -- 检查白名单用户引用
    IF EXISTS (SELECT 1 FROM smart_whitelists sw LEFT JOIN users u ON sw.user_id = u.id WHERE u.id IS NULL) THEN
        fk_errors := fk_errors || 'Invalid user_id in smart_whitelists; ';
    END IF;
    
    -- 检查通话记录用户引用
    IF EXISTS (SELECT 1 FROM call_records cr LEFT JOIN users u ON cr.user_id = u.id WHERE u.id IS NULL) THEN
        fk_errors := fk_errors || 'Invalid user_id in call_records; ';
    END IF;
    
    -- 检查对话记录通话引用
    IF EXISTS (SELECT 1 FROM conversations c LEFT JOIN call_records cr ON c.call_record_id = cr.id WHERE cr.id IS NULL) THEN
        fk_errors := fk_errors || 'Invalid call_record_id in conversations; ';
    END IF;
    
    IF fk_errors != '' THEN
        RAISE EXCEPTION 'Foreign key integrity errors: %', fk_errors;
    ELSE
        RAISE NOTICE 'All foreign key relationships are valid.';
    END IF;
END
$$;