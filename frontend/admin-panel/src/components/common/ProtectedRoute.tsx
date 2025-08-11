import React, { useEffect, useMemo } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Result, Button, Spin, Card, Space } from 'antd'
import { 
  LockOutlined, 
  SafetyCertificateOutlined,
  ExclamationCircleOutlined,
  UserOutlined,
  WarningOutlined
} from '@ant-design/icons'
import { useAuthStore, useUIStore } from '@/store'
import type { AuthUser } from '@/types'

interface ProtectedRouteProps {
  children: React.ReactNode
  requireAuth?: boolean
  requiredPermissions?: string[]
  requiredRole?: AuthUser['role']
  fallback?: React.ReactNode
  showPermissionHint?: boolean
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ 
  children, 
  requireAuth = true,
  requiredPermissions = [], 
  requiredRole,
  fallback,
  showPermissionHint = true
}) => {
  const { isAuthenticated, user, token } = useAuthStore()
  const { addNotification, darkMode } = useUIStore()
  const location = useLocation()

  // 权限检查逻辑
  const permissionCheck = useMemo(() => {
    // 如果不需要认证，直接通过
    if (!requireAuth) {
      return { allowed: true, reason: null }
    }

    // 未认证检查
    if (!isAuthenticated || !token) {
      return { allowed: false, reason: 'unauthenticated' }
    }

    // 用户信息加载中
    if (!user) {
      return { allowed: false, reason: 'loading' }
    }

    // 管理员拥有所有权限
    if (user.role === 'admin') {
      return { allowed: true, reason: null }
    }

    // 角色权限检查
    if (requiredRole && user.role !== requiredRole) {
      return { 
        allowed: false, 
        reason: 'insufficient_role',
        required: requiredRole,
        current: user.role
      }
    }

    // 具体权限检查
    if (requiredPermissions.length > 0) {
      const hasAllPermissions = requiredPermissions.every(permission =>
        user.permissions?.includes(permission)
      )

      if (!hasAllPermissions) {
        const missingPermissions = requiredPermissions.filter(permission =>
          !user.permissions?.includes(permission)
        )
        
        return { 
          allowed: false, 
          reason: 'missing_permissions',
          required: requiredPermissions,
          missing: missingPermissions,
          current: user.permissions || []
        }
      }
    }

    return { allowed: true, reason: null }
  }, [requireAuth, isAuthenticated, token, user, requiredRole, requiredPermissions])

  // 记录权限检查失败的日志
  useEffect(() => {
    if (!permissionCheck.allowed && permissionCheck.reason !== 'loading') {
      console.warn('权限检查失败:', {
        path: location.pathname,
        reason: permissionCheck.reason,
        user: user?.username,
        required: permissionCheck.required || requiredPermissions,
        current: user?.role || user?.permissions
      })

      // 添加权限不足的通知
      if (permissionCheck.reason === 'insufficient_role' || permissionCheck.reason === 'missing_permissions') {
        addNotification({
          type: 'warning',
          title: '权限不足',
          message: `访问 ${location.pathname} 需要更高权限`,
          duration: 5000
        })
      }
    }
  }, [permissionCheck, location.pathname, user, addNotification, requiredPermissions])

  // 渲染逻辑
  if (!permissionCheck.allowed) {
    switch (permissionCheck.reason) {
      case 'unauthenticated':
        return (
          <Navigate 
            to="/auth/login" 
            state={{ from: location.pathname }}
            replace 
          />
        )

      case 'loading':
        return (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            background: darkMode ? '#141414' : '#f5f5f5'
          }}>
            <Card style={{ textAlign: 'center', minWidth: 300 }}>
              <Space direction="vertical" size={16}>
                <Spin size="large" />
                <div>
                  <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
                    正在验证权限...
                  </div>
                  <div style={{ fontSize: 14, color: '#8c8c8c' }}>
                    请稍候
                  </div>
                </div>
              </Space>
            </Card>
          </div>
        )

      case 'insufficient_role':
        return fallback || (
          <Result
            status="403"
            title="角色权限不足"
            subTitle={
              <Space direction="vertical">
                <div>抱歉，访问此页面需要 <strong>{permissionCheck.required}</strong> 角色权限。</div>
                <div>您当前的角色是：<strong>{permissionCheck.current}</strong></div>
                {showPermissionHint && (
                  <div style={{ marginTop: 16, fontSize: 13, color: '#8c8c8c' }}>
                    如需获取权限，请联系系统管理员
                  </div>
                )}
              </Space>
            }
            icon={<UserOutlined />}
            extra={[
              <Button key="back" onClick={() => window.history.back()}>
                返回上页
              </Button>,
              <Button key="home" type="primary" onClick={() => window.location.href = '/dashboard'}>
                返回首页
              </Button>
            ]}
          />
        )

      case 'missing_permissions':
        return fallback || (
          <Result
            status="warning"
            title="功能权限不足"
            subTitle={
              <Space direction="vertical" style={{ textAlign: 'left' }}>
                <div>访问此功能需要以下权限：</div>
                <ul style={{ margin: '8px 0', padding: '0 20px' }}>
                  {permissionCheck.required?.map(permission => (
                    <li key={permission} style={{ 
                      color: permissionCheck.missing?.includes(permission) ? '#f5222d' : '#52c41a',
                      marginBottom: 4
                    }}>
                      {permission} 
                      {permissionCheck.missing?.includes(permission) && 
                        <span style={{ marginLeft: 8, fontSize: 12 }}>❌ 缺失</span>
                      }
                      {!permissionCheck.missing?.includes(permission) && 
                        <span style={{ marginLeft: 8, fontSize: 12 }}>✅ 已有</span>
                      }
                    </li>
                  ))}
                </ul>
                {showPermissionHint && (
                  <Card size="small" style={{ marginTop: 16, background: darkMode ? '#1f1f1f' : '#fafafa' }}>
                    <div style={{ fontSize: 13, color: '#8c8c8c' }}>
                      💡 提示：请联系管理员为您分配所需权限，或者切换到有权限的账号
                    </div>
                  </Card>
                )}
              </Space>
            }
            icon={<SafetyCertificateOutlined />}
            extra={[
              <Button key="back" onClick={() => window.history.back()}>
                返回上页
              </Button>,
              <Button key="contact" type="primary">
                联系管理员
              </Button>
            ]}
          />
        )

      default:
        return fallback || (
          <Result
            status="error"
            title="权限验证失败"
            subTitle="系统无法验证您的访问权限，请重新登录或联系管理员。"
            icon={<WarningOutlined />}
            extra={[
              <Button key="login" type="primary" onClick={() => window.location.href = '/auth/login'}>
                重新登录
              </Button>
            ]}
          />
        )
    }
  }

  return <>{children}</>
}

export default ProtectedRoute