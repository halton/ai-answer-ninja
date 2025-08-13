import React, { useEffect, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { App as AntApp, ConfigProvider, Spin } from 'antd'
import { useAuthStore, useUIStore } from '@/store'
import { useWebSocket } from '@/services/websocket'
import { useTheme } from '@/hooks/ui/useTheme'
import { initPWA } from '@/utils/pwa'
import ErrorBoundary, { setupGlobalErrorHandling } from '@/components/common/ErrorBoundary'
import { usePerformanceMonitor } from '@/hooks/usePerformanceMonitor'
import zhCN from 'antd/locale/zh_CN'
import '@/styles/themes.scss'

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
  const { antdTheme } = useTheme()
  const location = useLocation()

  // 性能监控
  const { getMetrics } = usePerformanceMonitor({
    componentName: 'App',
    enabled: true,
    threshold: 100,
    trackMemory: true,
    trackFPS: true
  })

  // 初始化应用
  useEffect(() => {
    // 设置全局错误处理
    setupGlobalErrorHandling()
    
    // 初始化 PWA 功能
    initPWA()

    console.log('🚀 AI Answer Ninja Admin Panel 已启动')

    // 性能监控报告 (开发环境)
    if (process.env.NODE_ENV === 'development') {
      setTimeout(() => {
        const metrics = getMetrics()
        console.log('📊 应用性能指标:', metrics)
      }, 3000)
    }
  }, [getMetrics])

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
    <ErrorBoundary level="page">
      <ConfigProvider theme={antdTheme} locale={zhCN}>
        <AntApp>
          {globalLoading && <GlobalLoading />}
          
          <Suspense
            fallback={
              <div className="min-h-screen flex items-center justify-center">
                <Spin size="large" tip="正在加载应用..." />
              </div>
            }
          >
            <Routes>
              {/* 认证相关路由 */}
              <Route path="/auth/*" element={
                <ErrorBoundary level="section">
                  <AuthLayout>
                    <Routes>
                      <Route path="login" element={<Login />} />
                      <Route path="*" element={<Navigate to="/auth/login" replace />} />
                    </Routes>
                  </AuthLayout>
                </ErrorBoundary>
              } />

              {/* 管理后台路由 */}
              <Route path="/*" element={
                <ProtectedRoute>
                  <ErrorBoundary level="section">
                    <AdminLayout>
                      <Suspense
                        fallback={
                          <div className="p-6 flex items-center justify-center">
                            <Spin size="large" tip="正在加载页面..." />
                          </div>
                        }
                      >
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
                      </Suspense>
                    </AdminLayout>
                  </ErrorBoundary>
                </ProtectedRoute>
              } />

              {/* 根路径重定向 */}
              <Route path="/" element={
                isAuthenticated 
                  ? <Navigate to="/dashboard" replace />
                  : <Navigate to="/auth/login" replace />
              } />
            </Routes>
          </Suspense>
        </AntApp>
      </ConfigProvider>
    </ErrorBoundary>
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