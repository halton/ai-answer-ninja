import React, { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { App as AntApp } from 'antd'
import { useAuthStore, useUIStore } from '@/store'
import { useWebSocket } from '@/services/websocket'

// 布局组件
import AdminLayout from '@/components/layout/AdminLayout'
import AuthLayout from '@/components/layout/AuthLayout'

// 页面组件
import Login from '@/pages/auth/Login'
import Dashboard from '@/pages/Dashboard'
import UserManagement from '@/pages/user/UserManagement'
import CallHistory from '@/pages/call/CallHistory'
import WhitelistManagement from '@/pages/whitelist/WhitelistManagement'
import SystemMonitoring from '@/pages/system/SystemMonitoring'
import AIConfiguration from '@/pages/ai/AIConfiguration'
import Analytics from '@/pages/analytics/Analytics'

// 权限控制组件
import ProtectedRoute from '@/components/common/ProtectedRoute'

// 全局加载组件
import GlobalLoading from '@/components/common/GlobalLoading'

function App() {
  const { isAuthenticated, user } = useAuthStore()
  const { globalLoading, setCurrentPage, setBreadcrumbs } = useUIStore()
  const { connect, disconnect } = useWebSocket()
  const location = useLocation()

  // WebSocket连接管理
  useEffect(() => {
    if (isAuthenticated) {
      connect()
    } else {
      disconnect()
    }

    return () => {
      disconnect()
    }
  }, [isAuthenticated, connect, disconnect])

  // 路由变化时更新当前页面信息
  useEffect(() => {
    const path = location.pathname
    const pathSegments = path.split('/').filter(Boolean)
    
    // 更新当前页面
    setCurrentPage(path)
    
    // 生成面包屑
    const breadcrumbs = generateBreadcrumbs(pathSegments)
    setBreadcrumbs(breadcrumbs)
  }, [location.pathname, setCurrentPage, setBreadcrumbs])

  return (
    <AntApp>
      {globalLoading && <GlobalLoading />}
      
      <Routes>
        {/* 认证相关路由 */}
        <Route path="/auth/*" element={
          <AuthLayout>
            <Routes>
              <Route path="login" element={<Login />} />
              <Route path="*" element={<Navigate to="/auth/login" replace />} />
            </Routes>
          </AuthLayout>
        } />

        {/* 管理后台路由 */}
        <Route path="/*" element={
          <ProtectedRoute>
            <AdminLayout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/dashboard" element={<Dashboard />} />
                
                {/* 用户管理 */}
                <Route path="/users/*" element={<UserManagement />} />
                
                {/* 通话记录 */}
                <Route path="/calls/*" element={<CallHistory />} />
                
                {/* 白名单管理 */}
                <Route path="/whitelist/*" element={<WhitelistManagement />} />
                
                {/* 系统监控 */}
                <Route path="/monitoring/*" element={<SystemMonitoring />} />
                
                {/* AI配置 */}
                <Route path="/ai-config/*" element={<AIConfiguration />} />
                
                {/* 统计分析 */}
                <Route path="/analytics/*" element={<Analytics />} />
                
                {/* 默认重定向 */}
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </AdminLayout>
          </ProtectedRoute>
        } />

        {/* 根路径重定向 */}
        <Route path="/" element={
          isAuthenticated 
            ? <Navigate to="/dashboard" replace />
            : <Navigate to="/auth/login" replace />
        } />
      </Routes>
    </AntApp>
  )
}

// 生成面包屑导航
function generateBreadcrumbs(pathSegments: string[]) {
  const breadcrumbMap: Record<string, string> = {
    'dashboard': '仪表盘',
    'users': '用户管理',
    'calls': '通话记录',
    'whitelist': '白名单管理', 
    'monitoring': '系统监控',
    'ai-config': 'AI配置',
    'analytics': '统计分析',
    'settings': '系统设置',
  }

  const breadcrumbs = [
    { title: '首页', path: '/' }
  ]

  let currentPath = ''
  pathSegments.forEach((segment, index) => {
    currentPath += `/${segment}`
    const title = breadcrumbMap[segment] || segment
    
    breadcrumbs.push({
      title,
      path: index === pathSegments.length - 1 ? undefined : currentPath // 最后一个不设置路径
    })
  })

  return breadcrumbs
}

export default App