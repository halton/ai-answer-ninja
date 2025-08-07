import React, { useState } from 'react'
import { Form, Input, Button, Checkbox, Alert, Typography } from 'antd'
import { UserOutlined, LockOutlined, LoadingOutlined } from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store'
import type { LoginCredentials } from '@/types'

const { Title, Text } = Typography

const Login: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  
  const { login, isLoading, error, clearError } = useAuthStore()
  
  const [form] = Form.useForm()

  // 从路由状态获取重定向路径
  const from = (location.state as any)?.from || '/dashboard'

  // 处理登录
  const handleLogin = async (values: LoginCredentials) => {
    try {
      clearError()
      await login(values)
      navigate(from, { replace: true })
    } catch (error) {
      // 错误已经在store中处理了
    }
  }

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <Title level={3} style={{ margin: '0 0 8px 0', color: '#262626' }}>
          登录到管理后台
        </Title>
        <Text type="secondary">
          请输入您的管理员账号信息
        </Text>
      </div>

      {error && (
        <Alert
          message="登录失败"
          description={error}
          type="error"
          showIcon
          closable
          onClose={clearError}
          style={{ marginBottom: 24 }}
        />
      )}

      <Form
        form={form}
        name="login"
        onFinish={handleLogin}
        size="large"
        autoComplete="off"
        initialValues={{ rememberMe: true }}
      >
        <Form.Item
          name="username"
          rules={[
            { required: true, message: '请输入用户名' },
            { min: 3, message: '用户名至少3个字符' }
          ]}
        >
          <Input
            prefix={<UserOutlined style={{ color: '#bfbfbf' }} />}
            placeholder="用户名"
            disabled={isLoading}
          />
        </Form.Item>

        <Form.Item
          name="password"
          rules={[
            { required: true, message: '请输入密码' },
            { min: 6, message: '密码至少6个字符' }
          ]}
        >
          <Input.Password
            prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
            placeholder="密码"
            disabled={isLoading}
          />
        </Form.Item>

        <Form.Item style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Form.Item name="rememberMe" valuePropName="checked" noStyle>
              <Checkbox disabled={isLoading}>
                记住登录状态
              </Checkbox>
            </Form.Item>

            <Button 
              type="link" 
              style={{ padding: 0, fontSize: 14 }}
              disabled={isLoading}
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
            style={{ 
              width: '100%', 
              height: 44,
              fontSize: 16,
              fontWeight: 500,
            }}
          >
            {isLoading ? '登录中...' : '登录'}
          </Button>
        </Form.Item>
      </Form>

      {/* 演示账号信息 */}
      <div style={{
        marginTop: 24,
        padding: 16,
        background: '#f6f8fa',
        borderRadius: 8,
        border: '1px solid #e1e8ed'
      }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          演示账号：
        </Text>
        <div style={{ marginTop: 8, fontSize: 13 }}>
          <div style={{ marginBottom: 4 }}>
            管理员: <Text code>admin</Text> / <Text code>123456</Text>
          </div>
          <div>
            普通用户: <Text code>user</Text> / <Text code>123456</Text>
          </div>
        </div>
      </div>

      {/* 快速登录按钮 */}
      <div style={{ 
        marginTop: 16,
        display: 'flex',
        gap: 8
      }}>
        <Button
          size="small"
          onClick={() => {
            form.setFieldsValue({ username: 'admin', password: '123456' })
          }}
          disabled={isLoading}
          style={{ flex: 1 }}
        >
          管理员登录
        </Button>
        <Button
          size="small"
          onClick={() => {
            form.setFieldsValue({ username: 'user', password: '123456' })
          }}
          disabled={isLoading}
          style={{ flex: 1 }}
        >
          用户登录
        </Button>
      </div>
    </div>
  )
}

export default Login