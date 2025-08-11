import React, { useState, useEffect } from 'react'
import { 
  Form, 
  Input, 
  Button, 
  Checkbox, 
  Alert, 
  Typography, 
  Switch, 
  Space,
  Divider,
  Card,
  theme
} from 'antd'
import { 
  UserOutlined, 
  LockOutlined, 
  LoadingOutlined,
  EyeInvisibleOutlined,
  EyeTwoTone,
  SafetyCertificateOutlined,
  MoonOutlined,
  SunOutlined,
  RobotOutlined
} from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore, useUIStore } from '@/store'
import type { LoginCredentials } from '@/types'

const { Title, Text } = Typography

const Login: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { token } = theme.useToken()
  
  const { login, isLoading, error, clearError } = useAuthStore()
  const { 
    darkMode, 
    toggleDarkMode, 
    setPageTitle,
    addNotification,
    setGlobalLoading 
  } = useUIStore()
  
  const [form] = Form.useForm()
  const [loginAttempts, setLoginAttempts] = useState(0)
  const [showCaptcha, setShowCaptcha] = useState(false)
  const [rememberDevice, setRememberDevice] = useState(false)

  // 从路由状态获取重定向路径
  const from = (location.state as any)?.from || '/dashboard'

  // 设置页面标题
  useEffect(() => {
    setPageTitle('用户登录')
    return () => {
      setPageTitle('')
    }
  }, [setPageTitle])

  // 处理登录
  const handleLogin = async (values: LoginCredentials) => {
    try {
      clearError()
      setGlobalLoading(true, '正在验证登录信息...')
      
      // 模拟网络延迟
      await new Promise(resolve => setTimeout(resolve, 800))
      
      await login({ 
        ...values, 
        rememberMe: values.rememberMe || rememberDevice 
      })
      
      // 登录成功提示
      addNotification({
        type: 'success',
        title: '登录成功',
        message: `欢迎回来，${values.username}！`,
        duration: 3000
      })
      
      navigate(from, { replace: true })
    } catch (error) {
      setLoginAttempts(prev => prev + 1)
      
      // 登录失败3次后显示验证码
      if (loginAttempts >= 2) {
        setShowCaptcha(true)
      }
      
      // 错误已经在store中处理了
    } finally {
      setGlobalLoading(false)
    }
  }

  // 快速登录功能
  const quickLogin = (userType: 'admin' | 'user') => {
    const credentials = {
      admin: { username: 'admin', password: '123456' },
      user: { username: 'user', password: '123456' }
    }
    
    form.setFieldsValue(credentials[userType])
    
    // 自动登录
    setTimeout(() => {
      handleLogin({ 
        ...credentials[userType], 
        rememberMe: true 
      })
    }, 300)
  }

  return (
    <div style={{ 
      position: 'relative',
      background: darkMode ? '#141414' : '#fff',
      transition: 'background-color 0.3s ease'
    }}>
      {/* 主题切换开关 */}
      <div style={{ 
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 10
      }}>
        <Space align="center">
          <SunOutlined style={{ color: darkMode ? '#666' : token.colorPrimary }} />
          <Switch
            checked={darkMode}
            onChange={toggleDarkMode}
            checkedChildren={<MoonOutlined />}
            unCheckedChildren={<SunOutlined />}
          />
          <MoonOutlined style={{ color: darkMode ? token.colorPrimary : '#666' }} />
        </Space>
      </div>

      {/* 头部 */}
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          marginBottom: 24
        }}>
          <RobotOutlined style={{ 
            fontSize: 48, 
            color: token.colorPrimary,
            marginRight: 12
          }} />
          <div>
            <Title 
              level={2} 
              style={{ 
                margin: 0, 
                color: darkMode ? '#fff' : '#262626',
                fontWeight: 600
              }}
            >
              AI电话应答系统
            </Title>
            <Text type="secondary" style={{ fontSize: 14 }}>
              智能电话管理平台
            </Text>
          </div>
        </div>
        
        <Card 
          bordered={false}
          style={{ 
            background: darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(24,144,255,0.04)',
            border: `1px solid ${darkMode ? 'rgba(255,255,255,0.12)' : 'rgba(24,144,255,0.12)'}`,
          }}
        >
          <SafetyCertificateOutlined style={{ 
            fontSize: 20, 
            color: token.colorPrimary, 
            marginRight: 8 
          }} />
          <Text style={{ color: darkMode ? '#d9d9d9' : '#666' }}>
            安全登录验证 · 数据加密传输
          </Text>
        </Card>
      </div>

      {/* 登录失败提示 */}
      {error && (
        <Alert
          message={`登录失败 ${loginAttempts > 1 ? `(${loginAttempts}/5)` : ''}`}
          description={error}
          type="error"
          showIcon
          closable
          onClose={clearError}
          style={{ marginBottom: 24 }}
          action={
            loginAttempts >= 3 && (
              <Button size="small" type="link">
                需要帮助？
              </Button>
            )
          }
        />
      )}

      {/* 登录表单 */}
      <Form
        form={form}
        name="login"
        onFinish={handleLogin}
        size="large"
        autoComplete="off"
        initialValues={{ rememberMe: true }}
        layout="vertical"
      >
        <Form.Item
          name="username"
          label="用户名"
          rules={[
            { required: true, message: '请输入用户名' },
            { min: 3, message: '用户名至少3个字符' },
            { pattern: /^[a-zA-Z0-9_]+$/, message: '用户名只能包含字母、数字和下划线' }
          ]}
        >
          <Input
            prefix={<UserOutlined style={{ color: token.colorTextPlaceholder }} />}
            placeholder="请输入用户名"
            disabled={isLoading}
            autoComplete="username"
          />
        </Form.Item>

        <Form.Item
          name="password"
          label="密码"
          rules={[
            { required: true, message: '请输入密码' },
            { min: 6, message: '密码至少6个字符' }
          ]}
        >
          <Input.Password
            prefix={<LockOutlined style={{ color: token.colorTextPlaceholder }} />}
            placeholder="请输入密码"
            disabled={isLoading}
            autoComplete="current-password"
            iconRender={visible => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
          />
        </Form.Item>

        {/* 验证码（登录失败3次后显示） */}
        {showCaptcha && (
          <Form.Item
            name="captcha"
            label="安全验证"
            rules={[{ required: true, message: '请输入验证码' }]}
          >
            <Input.Group compact>
              <Input
                placeholder="请输入验证码"
                disabled={isLoading}
                style={{ width: '70%' }}
              />
              <Button 
                style={{ width: '30%' }}
                onClick={() => {
                  addNotification({
                    type: 'info',
                    title: '验证码已发送',
                    message: '演示环境验证码：1234',
                    duration: 5000
                  })
                }}
              >
                获取验证码
              </Button>
            </Input.Group>
          </Form.Item>
        )}

        <Form.Item style={{ marginBottom: 16 }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16
          }}>
            <Space direction="vertical" size={8}>
              <Form.Item name="rememberMe" valuePropName="checked" noStyle>
                <Checkbox disabled={isLoading}>
                  记住登录状态
                </Checkbox>
              </Form.Item>
              
              <Checkbox
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
                disabled={isLoading}
              >
                信任此设备
              </Checkbox>
            </Space>

            <Button 
              type="link" 
              style={{ padding: 0, fontSize: 14 }}
              disabled={isLoading}
              onClick={() => {
                addNotification({
                  type: 'info',
                  title: '密码重置',
                  message: '演示环境请联系管理员重置密码',
                  duration: 5000
                })
              }}
            >
              忘记密码？
            </Button>
          </div>
        </Form.Item>

        <Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={isLoading}
            disabled={isLoading}
            block
            style={{ 
              height: 48,
              fontSize: 16,
              fontWeight: 500,
              borderRadius: 8,
            }}
          >
            {isLoading ? '登录中...' : '立即登录'}
          </Button>
        </Form.Item>
      </Form>

      <Divider plain>
        <Text type="secondary">演示账号快速登录</Text>
      </Divider>

      {/* 演示账号信息卡片 */}
      <Card 
        size="small"
        style={{ 
          marginBottom: 16,
          background: darkMode ? 'rgba(255,255,255,0.02)' : '#fafafa'
        }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            📌 演示账号信息：
          </Text>
          <div style={{ fontSize: 13 }}>
            <div style={{ marginBottom: 8 }}>
              <Text strong>管理员</Text>: <Text code>admin</Text> / <Text code>123456</Text>
              <Text type="secondary" style={{ marginLeft: 8 }}>
                (完整权限)
              </Text>
            </div>
            <div>
              <Text strong>普通用户</Text>: <Text code>user</Text> / <Text code>123456</Text>
              <Text type="secondary" style={{ marginLeft: 8 }}>
                (只读权限)
              </Text>
            </div>
          </div>
        </Space>
      </Card>

      {/* 快速登录按钮 */}
      <Space style={{ width: '100%' }}>
        <Button
          icon={<SafetyCertificateOutlined />}
          onClick={() => quickLogin('admin')}
          disabled={isLoading}
          style={{ flex: 1 }}
          type="dashed"
        >
          管理员登录
        </Button>
        <Button
          icon={<UserOutlined />}
          onClick={() => quickLogin('user')}
          disabled={isLoading}
          style={{ flex: 1 }}
          type="dashed"
        >
          普通用户登录
        </Button>
      </Space>

      {/* 底部信息 */}
      <div style={{ 
        textAlign: 'center', 
        marginTop: 24,
        paddingTop: 16,
        borderTop: `1px solid ${darkMode ? 'rgba(255,255,255,0.06)' : '#f0f0f0'}`
      }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          AI电话应答系统 v1.0.0 | 技术支持：AI团队
        </Text>
      </div>
    </div>
  )
}

export default Login