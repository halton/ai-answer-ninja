import React, { useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Spin } from 'antd'
import { useAuthStore } from '@/store'

interface ProtectedRouteProps {
  children: React.ReactNode
  requiredPermissions?: string[]
  requiredRole?: string
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ 
  children, 
  requiredPermissions = [], 
  requiredRole 
}) => {
  const { isAuthenticated, user, token } = useAuthStore()
  const location = useLocation()

  // 检查认证状态
  if (!isAuthenticated || !token) {
    return (
      <Navigate 
        to="/auth/login" 
        state={{ from: location.pathname }}
        replace 
      />
    )
  }

  // 如果没有用户信息，显示加载状态
  if (!user) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
      }}>
        <Spin size="large" tip="正在加载用户信息..." />
      </div>
    )
  }

  // 检查角色权限
  if (requiredRole && user.role !== requiredRole) {
    return (
      <Navigate 
        to="/unauthorized" 
        replace 
      />
    )
  }

  // 检查具体权限
  if (requiredPermissions.length > 0) {
    const hasPermission = requiredPermissions.some(permission =>
      user.permissions?.includes(permission)
    )

    if (!hasPermission) {
      return (
        <Navigate 
          to="/unauthorized" 
          replace 
        />
      )
    }
  }

  return <>{children}</>
}

export default ProtectedRoute