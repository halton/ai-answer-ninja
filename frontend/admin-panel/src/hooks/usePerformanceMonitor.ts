import { useEffect, useRef, useCallback } from 'react'
import { useUIStore } from '@/store'

export interface PerformanceMetrics {
  renderTime: number
  componentMountTime: number
  rerenderCount: number
  memoryUsage?: number
  fps?: number
}

export interface UsePerformanceMonitorOptions {
  enabled?: boolean
  threshold?: number
  componentName?: string
  trackMemory?: boolean
  trackFPS?: boolean
  onThresholdExceeded?: (metrics: PerformanceMetrics) => void
}

export const usePerformanceMonitor = (options: UsePerformanceMonitorOptions = {}) => {
  const {
    enabled = true,
    threshold = 100, // 100ms threshold
    componentName = 'UnknownComponent',
    trackMemory = false,
    trackFPS = false,
    onThresholdExceeded
  } = options

  const mountTimeRef = useRef<number>()
  const renderCountRef = useRef(0)
  const lastRenderTimeRef = useRef<number>()
  const metricsRef = useRef<PerformanceMetrics>({
    renderTime: 0,
    componentMountTime: 0,
    rerenderCount: 0
  })

  const { addNotification } = useUIStore()

  // FPS 监控
  const fpsRef = useRef<number[]>([])
  const rafIdRef = useRef<number>()

  const measureFPS = useCallback(() => {
    if (!trackFPS) return

    const now = performance.now()
    fpsRef.current.push(now)

    // 保留最近1秒的帧时间
    const oneSecondAgo = now - 1000
    fpsRef.current = fpsRef.current.filter(time => time > oneSecondAgo)

    rafIdRef.current = requestAnimationFrame(measureFPS)
  }, [trackFPS])

  // 获取内存使用情况
  const getMemoryUsage = useCallback(() => {
    if (!trackMemory || !('memory' in performance)) return undefined

    const memory = (performance as any).memory
    return {
      used: memory.usedJSHeapSize,
      total: memory.totalJSHeapSize,
      limit: memory.jsHeapSizeLimit
    }
  }, [trackMemory])

  // 组件挂载时间测量
  useEffect(() => {
    if (!enabled) return

    mountTimeRef.current = performance.now()

    return () => {
      if (mountTimeRef.current) {
        const mountTime = performance.now() - mountTimeRef.current
        metricsRef.current.componentMountTime = mountTime

        // 如果挂载时间超过阈值，发出警告
        if (mountTime > threshold) {
          console.warn(
            `⚠️ 组件 ${componentName} 挂载时间过长: ${mountTime.toFixed(2)}ms`
          )

          if (process.env.NODE_ENV === 'development') {
            addNotification({
              type: 'warning',
              title: '性能警告',
              message: `组件 ${componentName} 挂载时间: ${mountTime.toFixed(2)}ms`,
              duration: 3000
            })
          }

          onThresholdExceeded?.(metricsRef.current)
        }
      }
    }
  }, [enabled, threshold, componentName, addNotification, onThresholdExceeded])

  // 渲染时间测量
  useEffect(() => {
    if (!enabled) return

    const renderStart = performance.now()
    renderCountRef.current += 1

    // 使用 setTimeout 确保在渲染完成后执行
    const timeoutId = setTimeout(() => {
      const renderTime = performance.now() - renderStart
      lastRenderTimeRef.current = renderTime
      metricsRef.current.renderTime = renderTime
      metricsRef.current.rerenderCount = renderCountRef.current

      // 更新内存和FPS信息
      if (trackMemory) {
        metricsRef.current.memoryUsage = getMemoryUsage()?.used
      }

      if (trackFPS) {
        metricsRef.current.fps = fpsRef.current.length
      }

      // 性能阈值检查
      if (renderTime > threshold) {
        console.warn(
          `⚠️ 组件 ${componentName} 渲染时间过长: ${renderTime.toFixed(2)}ms (第${renderCountRef.current}次渲染)`
        )

        if (process.env.NODE_ENV === 'development' && renderCountRef.current > 1) {
          addNotification({
            type: 'warning',
            title: '渲染性能警告',
            message: `${componentName} 渲染: ${renderTime.toFixed(2)}ms`,
            duration: 2000
          })
        }

        onThresholdExceeded?.(metricsRef.current)
      }
    }, 0)

    return () => clearTimeout(timeoutId)
  })

  // FPS 监控启动/停止
  useEffect(() => {
    if (enabled && trackFPS) {
      measureFPS()
    }

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
      }
    }
  }, [enabled, measureFPS, trackFPS])

  // 性能分析工具
  const startProfiling = useCallback(() => {
    if ('profiler' in console) {
      (console as any).profiler.start(componentName)
    }
  }, [componentName])

  const endProfiling = useCallback(() => {
    if ('profiler' in console) {
      (console as any).profiler.end(componentName)
    }
  }, [componentName])

  // 获取当前性能指标
  const getMetrics = useCallback((): PerformanceMetrics => {
    return {
      ...metricsRef.current,
      ...(trackMemory && { memoryUsage: getMemoryUsage()?.used }),
      ...(trackFPS && { fps: fpsRef.current.length })
    }
  }, [trackMemory, trackFPS, getMemoryUsage])

  // 性能报告
  const generateReport = useCallback(() => {
    const metrics = getMetrics()
    const report = {
      component: componentName,
      timestamp: new Date().toISOString(),
      metrics,
      browser: navigator.userAgent,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      memory: trackMemory ? getMemoryUsage() : undefined,
      recommendations: []
    }

    // 性能建议
    if (metrics.renderTime > 50) {
      report.recommendations.push('考虑使用 React.memo 或 useMemo 优化渲染')
    }

    if (metrics.rerenderCount > 10) {
      report.recommendations.push('检查是否有不必要的重新渲染')
    }

    if (metrics.componentMountTime > 200) {
      report.recommendations.push('考虑代码分割或懒加载')
    }

    return report
  }, [componentName, getMetrics, trackMemory, getMemoryUsage])

  // 重置计数器
  const reset = useCallback(() => {
    renderCountRef.current = 0
    metricsRef.current = {
      renderTime: 0,
      componentMountTime: 0,
      rerenderCount: 0
    }
    fpsRef.current = []
  }, [])

  return {
    metrics: metricsRef.current,
    renderCount: renderCountRef.current,
    lastRenderTime: lastRenderTimeRef.current,
    getMetrics,
    generateReport,
    startProfiling,
    endProfiling,
    reset
  }
}

// 页面级性能监控 Hook
export const usePagePerformance = (pageName: string) => {
  const performanceRef = useRef({
    navigationStart: 0,
    loadComplete: 0,
    firstPaint: 0,
    firstContentfulPaint: 0,
    largestContentfulPaint: 0
  })

  useEffect(() => {
    // 获取导航时间
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
    if (navigation) {
      performanceRef.current.navigationStart = navigation.fetchStart
      performanceRef.current.loadComplete = navigation.loadEventEnd
    }

    // Performance Observer 用于监控关键渲染指标
    if ('PerformanceObserver' in window) {
      // First Paint / First Contentful Paint
      const paintObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries()
        entries.forEach((entry) => {
          if (entry.name === 'first-paint') {
            performanceRef.current.firstPaint = entry.startTime
          } else if (entry.name === 'first-contentful-paint') {
            performanceRef.current.firstContentfulPaint = entry.startTime
          }
        })
      })

      paintObserver.observe({ entryTypes: ['paint'] })

      // Largest Contentful Paint
      const lcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries()
        const lastEntry = entries[entries.length - 1]
        performanceRef.current.largestContentfulPaint = lastEntry.startTime
      })

      lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] })

      return () => {
        paintObserver.disconnect()
        lcpObserver.disconnect()
      }
    }
  }, [])

  const getPageMetrics = useCallback(() => ({
    page: pageName,
    ...performanceRef.current,
    timeToInteractive: performanceRef.current.loadComplete - performanceRef.current.navigationStart,
    timestamp: Date.now()
  }), [pageName])

  return {
    pageMetrics: performanceRef.current,
    getPageMetrics
  }
}

// 网络性能监控 Hook
export const useNetworkMonitor = () => {
  const networkInfoRef = useRef({
    effectiveType: '4g',
    downlink: 10,
    rtt: 50,
    saveData: false
  })

  useEffect(() => {
    // Network Information API
    const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection

    if (connection) {
      const updateNetworkInfo = () => {
        networkInfoRef.current = {
          effectiveType: connection.effectiveType || '4g',
          downlink: connection.downlink || 10,
          rtt: connection.rtt || 50,
          saveData: connection.saveData || false
        }
      }

      updateNetworkInfo()
      connection.addEventListener('change', updateNetworkInfo)

      return () => {
        connection.removeEventListener('change', updateNetworkInfo)
      }
    }
  }, [])

  return {
    networkInfo: networkInfoRef.current,
    isSlowConnection: networkInfoRef.current.effectiveType === '2g' || networkInfoRef.current.effectiveType === 'slow-2g',
    isSaveDataEnabled: networkInfoRef.current.saveData
  }
}