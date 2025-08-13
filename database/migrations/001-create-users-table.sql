-- AI Answer Ninja - Database Migration 001
-- Create Users Table with Enhanced Security
-- 用户表创建脚本，支持多因素认证和安全审计

-- ===========================================
-- 用户表 (users) - 核心用户管理
-- ===========================================

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255), -- bcrypt哈希
  
  -- 个性化设置
  personality TEXT DEFAULT 'polite', -- 'polite', 'direct', 'humorous', 'professional'
  voice_profile_id VARCHAR(100), -- Azure Custom Neural Voice ID
  speech_style VARCHAR(50) DEFAULT 'natural', -- 说话风格
  occupation VARCHAR(100), -- 职业背景
  
  -- 用户偏好配置
  preferences JSONB DEFAULT '{
    "call_handling": {
      "max_duration": 180,
      "auto_terminate": true,
      "politeness_level": "medium"
    },
    "ai_personality": {
      "humor_level": "low",
      "patience_level": "medium",
      "firmness_level": "medium"
    },
    "privacy": {
      "record_calls": true,
      "share_analytics": false,
      "retention_days": 30
    }
  }',
  
  -- 安全设置
  mfa_enabled BOOLEAN DEFAULT false,
  mfa_secret VARCHAR(32), -- TOTP密钥
  backup_codes TEXT[], -- 备用验证码
  failed_login_count INTEGER DEFAULT 0,
  last_failed_login TIMESTAMP,
  account_locked_until TIMESTAMP,
  
  -- 会话管理
  last_login_at TIMESTAMP,
  last_login_ip INET,
  current_session_id VARCHAR(64),
  device_fingerprints JSONB DEFAULT '[]',
  
  -- 状态和审计
  is_active BOOLEAN DEFAULT true,
  email_verified BOOLEAN DEFAULT false,
  phone_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_profile_update TIMESTAMP,
  
  -- 合规和隐私
  gdpr_consent BOOLEAN DEFAULT false,
  gdpr_consent_date TIMESTAMP,
  data_retention_until TIMESTAMP, -- 数据保留截止日期
  
  -- 服务相关
  subscription_tier VARCHAR(20) DEFAULT 'basic', -- 'basic', 'premium', 'enterprise'
  api_quota_remaining INTEGER DEFAULT 1000,
  api_quota_reset_date DATE DEFAULT CURRENT_DATE + INTERVAL '1 month',
  
  -- 软删除支持
  deleted_at TIMESTAMP,
  deletion_reason TEXT
);

-- ===========================================
-- 索引优化
-- ===========================================

-- 主要查询索引
CREATE INDEX idx_users_phone ON users(phone_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL AND email IS NOT NULL;
CREATE INDEX idx_users_active ON users(is_active, created_at) WHERE deleted_at IS NULL;

-- 安全相关索引
CREATE INDEX idx_users_session ON users(current_session_id) WHERE current_session_id IS NOT NULL;
CREATE INDEX idx_users_locked ON users(account_locked_until) WHERE account_locked_until > CURRENT_TIMESTAMP;

-- 服务查询索引
CREATE INDEX idx_users_subscription ON users(subscription_tier, is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_voice_profile ON users(voice_profile_id) WHERE voice_profile_id IS NOT NULL AND deleted_at IS NULL;

-- 部分索引：仅对活跃用户
CREATE INDEX idx_users_active_phone ON users(phone_number, updated_at) 
  WHERE is_active = true AND deleted_at IS NULL;

-- ===========================================
-- 用户角色和权限表
-- ===========================================

CREATE TABLE user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  permissions JSONB NOT NULL DEFAULT '[]',
  is_system_role BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 插入默认角色
INSERT INTO user_roles (name, description, permissions, is_system_role) VALUES
('user', '普通用户', '["read:own_data", "update:own_profile", "manage:own_whitelist"]', true),
('premium_user', '高级用户', '["read:own_data", "update:own_profile", "manage:own_whitelist", "access:advanced_analytics", "api:extended_quota"]', true),
('admin', '系统管理员', '["read:all_data", "update:system_config", "manage:users", "access:admin_panel", "manage:global_settings"]', true),
('support', '客服人员', '["read:user_data", "assist:users", "view:system_logs"]', true),
('analyst', '数据分析师', '["read:analytics_data", "generate:reports", "view:aggregated_data"]', true);

-- 用户角色关联表
CREATE TABLE user_role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID REFERENCES user_roles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES users(id),
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  UNIQUE(user_id, role_id)
);

CREATE INDEX idx_user_roles_user ON user_role_assignments(user_id, is_active);
CREATE INDEX idx_user_roles_expiry ON user_role_assignments(expires_at) WHERE expires_at IS NOT NULL;

-- ===========================================
-- 用户会话管理表
-- ===========================================

CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  session_token_hash VARCHAR(64) NOT NULL,
  device_fingerprint VARCHAR(64),
  ip_address INET,
  user_agent TEXT,
  location JSONB, -- 地理位置信息
  
  -- 会话状态
  is_active BOOLEAN DEFAULT true,
  last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,
  terminated_at TIMESTAMP,
  termination_reason VARCHAR(50), -- 'logout', 'timeout', 'security', 'admin'
  
  -- 安全标记
  is_suspicious BOOLEAN DEFAULT false,
  risk_score DECIMAL(3,2) DEFAULT 0.0,
  security_events JSONB DEFAULT '[]'
);

-- 会话索引
CREATE INDEX idx_sessions_user_active ON user_sessions(user_id, is_active, last_activity);
CREATE INDEX idx_sessions_token ON user_sessions(session_token_hash);
CREATE INDEX idx_sessions_expiry ON user_sessions(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_sessions_suspicious ON user_sessions(is_suspicious, risk_score) WHERE is_suspicious = true;

-- ===========================================
-- 触发器和自动化
-- ===========================================

-- 更新updated_at时间戳
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at 
  BEFORE UPDATE ON users 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- 自动清理过期会话
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void AS $$
BEGIN
  UPDATE user_sessions 
  SET is_active = false, 
      terminated_at = CURRENT_TIMESTAMP,
      termination_reason = 'timeout'
  WHERE is_active = true 
    AND expires_at < CURRENT_TIMESTAMP;
    
  -- 删除超过30天的非活跃会话
  DELETE FROM user_sessions 
  WHERE is_active = false 
    AND terminated_at < CURRENT_TIMESTAMP - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- 账户锁定管理
CREATE OR REPLACE FUNCTION handle_failed_login()
RETURNS TRIGGER AS $$
BEGIN
  -- 增加失败计数
  NEW.failed_login_count = COALESCE(OLD.failed_login_count, 0) + 1;
  NEW.last_failed_login = CURRENT_TIMESTAMP;
  
  -- 如果失败次数超过5次，锁定账户30分钟
  IF NEW.failed_login_count >= 5 THEN
    NEW.account_locked_until = CURRENT_TIMESTAMP + INTERVAL '30 minutes';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 成功登录重置失败计数
CREATE OR REPLACE FUNCTION reset_failed_login_count()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.last_login_at > OLD.last_login_at THEN
    NEW.failed_login_count = 0;
    NEW.account_locked_until = NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_reset_failed_login 
  BEFORE UPDATE OF last_login_at ON users 
  FOR EACH ROW 
  EXECUTE FUNCTION reset_failed_login_count();

-- ===========================================
-- 安全函数
-- ===========================================

-- 检查账户是否被锁定
CREATE OR REPLACE FUNCTION is_account_locked(user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  locked_until TIMESTAMP;
BEGIN
  SELECT account_locked_until INTO locked_until
  FROM users 
  WHERE id = user_id;
  
  RETURN locked_until IS NOT NULL AND locked_until > CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- 获取用户权限
CREATE OR REPLACE FUNCTION get_user_permissions(user_id UUID)
RETURNS JSONB AS $$
DECLARE
  permissions JSONB := '[]'::jsonb;
  role_perms JSONB;
BEGIN
  -- 合并所有有效角色的权限
  FOR role_perms IN
    SELECT ur.permissions
    FROM user_role_assignments ura
    JOIN user_roles ur ON ura.role_id = ur.id
    WHERE ura.user_id = user_id 
      AND ura.is_active = true
      AND (ura.expires_at IS NULL OR ura.expires_at > CURRENT_TIMESTAMP)
  LOOP
    permissions := permissions || role_perms;
  END LOOP;
  
  -- 去重并返回
  RETURN (
    SELECT jsonb_agg(DISTINCT value)
    FROM jsonb_array_elements_text(permissions) AS value
  );
END;
$$ LANGUAGE plpgsql;

-- 验证用户权限
CREATE OR REPLACE FUNCTION check_user_permission(
  user_id UUID, 
  required_permission TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  user_permissions JSONB;
BEGIN
  user_permissions := get_user_permissions(user_id);
  
  RETURN user_permissions ? required_permission;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 数据完整性约束
-- ===========================================

-- 确保电话号码格式正确
ALTER TABLE users ADD CONSTRAINT users_phone_format 
  CHECK (phone_number ~ '^\+?[1-9]\d{1,14}$');

-- 确保邮箱格式正确
ALTER TABLE users ADD CONSTRAINT users_email_format 
  CHECK (email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

-- 确保订阅层级有效
ALTER TABLE users ADD CONSTRAINT users_subscription_tier_valid 
  CHECK (subscription_tier IN ('basic', 'premium', 'enterprise'));

-- 确保个性类型有效
ALTER TABLE users ADD CONSTRAINT users_personality_valid 
  CHECK (personality IN ('polite', 'direct', 'humorous', 'professional'));

-- ===========================================
-- 视图和快速查询
-- ===========================================

-- 活跃用户视图
CREATE VIEW v_active_users AS
SELECT 
  id,
  phone_number,
  name,
  email,
  personality,
  subscription_tier,
  last_login_at,
  created_at
FROM users 
WHERE is_active = true 
  AND deleted_at IS NULL;

-- 用户权限摘要视图
CREATE VIEW v_user_permissions AS
SELECT 
  u.id,
  u.phone_number,
  u.name,
  array_agg(ur.name) as roles,
  get_user_permissions(u.id) as permissions
FROM users u
JOIN user_role_assignments ura ON u.id = ura.user_id
JOIN user_roles ur ON ura.role_id = ur.id
WHERE u.is_active = true 
  AND u.deleted_at IS NULL
  AND ura.is_active = true
  AND (ura.expires_at IS NULL OR ura.expires_at > CURRENT_TIMESTAMP)
GROUP BY u.id, u.phone_number, u.name;

-- ===========================================
-- 性能优化建议
-- ===========================================

-- 定期维护任务
CREATE OR REPLACE FUNCTION maintain_users_table()
RETURNS void AS $$
BEGIN
  -- 清理过期会话
  PERFORM cleanup_expired_sessions();
  
  -- 解锁过期的账户锁定
  UPDATE users 
  SET account_locked_until = NULL
  WHERE account_locked_until < CURRENT_TIMESTAMP;
  
  -- 重置API配额（月度重置）
  UPDATE users 
  SET api_quota_remaining = 1000,
      api_quota_reset_date = CURRENT_DATE + INTERVAL '1 month'
  WHERE api_quota_reset_date <= CURRENT_DATE;
  
  -- 更新表统计信息
  ANALYZE users;
  ANALYZE user_sessions;
  ANALYZE user_role_assignments;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 初始数据和权限
-- ===========================================

-- 创建系统用户（用于自动化任务）
INSERT INTO users (
  id,
  phone_number, 
  name, 
  email,
  personality,
  subscription_tier,
  is_active,
  phone_verified,
  email_verified
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  '+86-000-0000-0001',
  'System User',
  'system@ai-answer-ninja.com',
  'professional',
  'enterprise',
  true,
  true,
  true
) ON CONFLICT (phone_number) DO NOTHING;

-- 分配系统用户管理员角色
INSERT INTO user_role_assignments (user_id, role_id)
SELECT 
  '00000000-0000-0000-0000-000000000001',
  id
FROM user_roles 
WHERE name = 'admin'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- 设置表权限
GRANT SELECT, INSERT, UPDATE, DELETE ON users TO ai_ninja_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_roles TO ai_ninja_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_role_assignments TO ai_ninja_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_sessions TO ai_ninja_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ai_ninja_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ai_ninja_app;

-- 只读用户权限
GRANT SELECT ON users TO ai_ninja_readonly;
GRANT SELECT ON user_roles TO ai_ninja_readonly;
GRANT SELECT ON user_role_assignments TO ai_ninja_readonly;
GRANT SELECT ON user_sessions TO ai_ninja_readonly;
GRANT SELECT ON v_active_users TO ai_ninja_readonly;
GRANT SELECT ON v_user_permissions TO ai_ninja_readonly;

-- ===========================================
-- 迁移完成验证
-- ===========================================

DO $$
BEGIN
  -- 验证表创建
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
    RAISE EXCEPTION 'Users table creation failed';
  END IF;
  
  -- 验证索引创建
  IF (SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'users') < 5 THEN
    RAISE EXCEPTION 'Users table indexes creation incomplete';
  END IF;
  
  -- 验证角色数据
  IF (SELECT COUNT(*) FROM user_roles) < 5 THEN
    RAISE EXCEPTION 'Default roles creation failed';
  END IF;
  
  RAISE NOTICE 'Migration 001 - Users table created successfully with % indexes', 
    (SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'users');
END
$$;