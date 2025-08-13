import React from 'react'
import { Result, Button, Card, Typography, Divider, Space } from 'antd'
import { 
  BugOutlined, 
  ReloadOutlined, 
  HomeOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons'
import { ErrorBoundary as ReactErrorBoundary, FallbackProps } from 'react-error-boundary'

const { Text, Paragraph } = Typography

interface ErrorInfo {
  componentStack: string
  errorBoundary?: string
  errorBoundaryStack?: string
}

// 错误日志记录
const logErrorToService = (error: Error, errorInfo: ErrorInfo) => {
  const errorData = {
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
    url: window.location.href,
    userAgent: navigator.userAgent,
    componentStack: errorInfo.componentStack,
    userId: localStorage.getItem('userId'),
    sessionId: localStorage.getItem('sessionId')
  }

  // 发送到错误监控服务
  if (process.env.NODE_ENV === 'production') {
    // 示例：发送到 Sentry 或其他错误监控服务
    console.error('错误报告:', errorData)
    
    // fetch('/api/errors', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(errorData)
    // })
  } else {
    console.group('🐛 应用错误详情')
    console.error('错误信息:', error)
    console.error('错误详情:', errorInfo)
    console.error('完整数据:', errorData)
    console.groupEnd()
  }
}

// 错误分类
const getErrorType = (error: Error) => {
  const message = error.message.toLowerCase()
  
  if (message.includes('network') || message.includes('fetch')) {
    return {
      type: 'network',
      title: '网络连接错误',
      description: '无法连接到服务器，请检查您的网络连接。'
    }
  }
  
  if (message.includes('chunk') || message.includes('loading')) {
    return {
      type: 'chunk',
      title: '资源加载失败',
      description: '应用资源加载失败，可能是网络问题或版本更新。'
    }
  }
  
  if (message.includes('permission') || message.includes('unauthorized')) {
    return {
      type: 'auth',
      title: '权限错误',
      description: '您没有访问此资源的权限，请重新登录。'
    }
  }

  return {
    type: 'general',
    title: '应用运行错误',
    description: '应用遇到了意外错误，我们正在努力修复。'
  }
}

// 错误恢复建议
const getRecoveryActions = (errorType: string) => {
  const actions = {
    network: [
      { label: '重试', action: () => window.location.reload(), icon: <ReloadOutlined /> },
      { label: '返回首页', action: () => window.location.href = '/', icon: <HomeOutlined /> }
    ],
    chunk: [
      { label: '强制刷新', action: () => window.location.reload(), icon: <ReloadOutlined /> },
      { label: '清除缓存', action: () => {
        localStorage.clear()
        sessionStorage.clear()
        window.location.reload()
      }}
    ],
    auth: [
      { label: '重新登录', action: () => {
        localStorage.clear()
        window.location.href = '/auth/login'
      }},
      { label: '返回首页', action: () => window.location.href = '/', icon: <HomeOutlined /> }
    ],
    general: [
      { label: '重新加载', action: () => window.location.reload(), icon: <ReloadOutlined /> },
      { label: '返回首页', action: () => window.location.href = '/', icon: <HomeOutlined /> }
    ]
  }

  return actions[errorType as keyof typeof actions] || actions.general
}

// 主要的错误回退组件
const ErrorFallback: React.FC<FallbackProps> = ({ error, resetErrorBoundary }) => {
  const errorType = getErrorType(error)
  const recoveryActions = getRecoveryActions(errorType.type)

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="max-w-lg w-full">
        <Result
          status="error"
          icon={<ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />}
          title={errorType.title}
          subTitle={errorType.description}
          extra={
            <Space direction="vertical" size="middle" className="w-full">
              <Space wrap>
                {recoveryActions.map((action, index) => (
                  <Button 
                    key={index}
                    type={index === 0 ? 'primary' : 'default'}
                    icon={action.icon}
                    onClick={action.action}
                  >
                    {action.label}
                  </Button>
                ))}
              </Space>
              
              <Button 
                type="dashed" 
                size="small"
                onClick={resetErrorBoundary}
              >
                尝试恢复
              </Button>
            </Space>
          }
        />

        {process.env.NODE_ENV === 'development' && (
          <>
            <Divider />
            <Card size="small" title="开发者信息" type="inner">
              <Paragraph>
                <Text strong>错误信息:</Text>
                <br />
                <Text code copyable style={{ fontSize: '12px' }}>
                  {error.message}
                </Text>
              </Paragraph>

              <Paragraph>
                <Text strong>错误堆栈:</Text>
                <br />
                <pre style={{ 
                  fontSize: '10px', 
                  maxHeight: '150px', 
                  overflow: 'auto',
                  background: '#f5f5f5',
                  padding: '8px',
                  borderRadius: '4px'
                }}>
                  {error.stack}
                </pre>
              </Paragraph>
            </Card>
          </>
        )}
      </Card>
    </div>
  )
}

// 简化版错误组件（用于小组件）
export const MiniErrorFallback: React.FC<FallbackProps> = ({ error, resetErrorBoundary }) => (
  <div className="p-4 text-center">
    <div className="mb-2">
      <BugOutlined style={{ fontSize: '24px', color: '#ff4d4f' }} />
    </div>
    <Text type="secondary" className="text-sm">
      组件加载失败
    </Text>
    <br />
    <Button 
      size="small" 
      type="link" 
      onClick={resetErrorBoundary}
    >
      重试
    </Button>
  </div>
)

// 可配置的错误边界组件
export interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ComponentType<FallbackProps>
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  level?: 'page' | 'section' | 'component'
}

const ErrorBoundary: React.FC<ErrorBoundaryProps> = ({
  children,
  fallback: FallbackComponent = ErrorFallback,
  onError,
  level = 'page'
}) => {
  const handleError = (error: Error, errorInfo: ErrorInfo) => {
    // 记录错误
    logErrorToService(error, errorInfo)
    
    // 自定义错误处理
    if (onError) {
      onError(error, errorInfo)
    }

    // 根据级别进行不同处理
    if (level === 'component') {
      // 组件级错误不影响整个页面
      console.warn('组件错误:', error.message)
    } else if (level === 'section') {
      // 区块级错误
      console.error('区块错误:', error.message)
    } else {
      // 页面级错误
      console.error('页面错误:', error.message)
    }
  }

  // 组件级错误使用简化回退
  const ActualFallback = level === 'component' ? MiniErrorFallback : FallbackComponent

  return (
    <ReactErrorBoundary
      FallbackComponent={ActualFallback}
      onError={handleError}
      onReset={() => {
        // 错误重置时的清理工作
        if (level === 'page') {
          window.location.reload()
        }
      }}
    >
      {children}
    </ReactErrorBoundary>
  )
}

// 异步组件错误处理
export const withAsyncErrorHandling = <P extends object>(
  Component: React.ComponentType<P>,
  fallback?: React.ComponentType<FallbackProps>
) => {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary fallback={fallback} level="component">
      <Component {...props} />
    </ErrorBoundary>
  )

  WrappedComponent.displayName = `withAsyncErrorHandling(${Component.displayName || Component.name})`
  return WrappedComponent
}

// 全局未捕获错误处理
export const setupGlobalErrorHandling = () => {
  // 捕获未处理的 Promise 拒绝
  window.addEventListener('unhandledrejection', (event) => {
    console.error('未处理的 Promise 拒绝:', event.reason)
    
    logErrorToService(
      new Error(`Unhandled Promise Rejection: ${event.reason}`),
      { componentStack: 'Global Handler' }
    )

    // 阻止默认的错误处理
    event.preventDefault()
  })

  // 捕获全局 JavaScript 错误
  window.addEventListener('error', (event) => {
    console.error('全局错误:', event.error)
    
    if (event.error) {
      logErrorToService(event.error, { componentStack: 'Global Handler' })
    }
  })

  console.log('🛡️ 全局错误处理已启用')
}

export default ErrorBoundary