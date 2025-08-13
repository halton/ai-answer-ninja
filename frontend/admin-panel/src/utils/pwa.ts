import { Workbox } from 'workbox-window'

let wb: Workbox | null = null

export const registerSW = () => {
  if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
    wb = new Workbox('/sw.js')

    const showSkipWaitingPrompt = () => {
      // 显示更新提示
      const updatePrompt = confirm(
        '发现新版本！点击确定立即更新应用，或点击取消稍后手动刷新页面。'
      )

      if (updatePrompt) {
        wb?.addEventListener('controlling', () => {
          window.location.reload()
        })

        wb?.messageSkipWaiting()
      }
    }

    wb.addEventListener('waiting', showSkipWaitingPrompt)
    wb.addEventListener('externalwaiting', showSkipWaitingPrompt)

    wb.register().then(() => {
      console.log('🎉 Service Worker 注册成功')
    }).catch((err) => {
      console.error('❌ Service Worker 注册失败:', err)
    })
  }
}

export const unregisterSW = () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => {
        registration.unregister()
        console.log('🗑️ Service Worker 已注销')
      })
      .catch((error) => {
        console.error('❌ Service Worker 注销失败:', error)
      })
  }
}

// 检查是否为 PWA 模式
export const isPWA = (): boolean => {
  return window.matchMedia('(display-mode: standalone)').matches
}

// 检查设备类型
export const isMobile = (): boolean => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  )
}

// 安装提示
export const installPrompt = () => {
  let deferredPrompt: any = null

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e

    // 显示自定义安装按钮
    const installButton = document.getElementById('install-button')
    if (installButton) {
      installButton.style.display = 'block'
      
      installButton.addEventListener('click', async () => {
        if (deferredPrompt) {
          deferredPrompt.prompt()
          
          const { outcome } = await deferredPrompt.userChoice
          console.log(`用户选择: ${outcome}`)
          
          deferredPrompt = null
          installButton.style.display = 'none'
        }
      })
    }
  })

  // iOS Safari 特殊处理
  if (isMobile() && !isPWA() && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
    const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    const isInStandaloneMode = ('standalone' in window.navigator) && (window.navigator as any).standalone

    if (isiOS && !isInStandaloneMode) {
      // 显示 iOS 安装指引
      console.log('💡 iOS 用户可以通过 Safari 的"添加到主屏幕"功能安装应用')
    }
  }
}

// 离线状态检测
export const handleOfflineStatus = () => {
  const updateOnlineStatus = () => {
    const status = navigator.onLine ? 'online' : 'offline'
    
    // 创建或更新状态指示器
    let statusIndicator = document.getElementById('offline-indicator')
    
    if (status === 'offline') {
      if (!statusIndicator) {
        statusIndicator = document.createElement('div')
        statusIndicator.id = 'offline-indicator'
        statusIndicator.innerHTML = `
          <div style="
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: #ff4d4f;
            color: white;
            padding: 8px 16px;
            text-align: center;
            font-size: 14px;
            z-index: 9999;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          ">
            ⚠️ 网络连接已断开，您正在离线模式下使用应用
          </div>
        `
        document.body.appendChild(statusIndicator)
      }
    } else {
      if (statusIndicator) {
        statusIndicator.remove()
      }
    }
  }

  window.addEventListener('online', updateOnlineStatus)
  window.addEventListener('offline', updateOnlineStatus)

  // 初始状态检查
  updateOnlineStatus()
}

// 应用更新检测
export const checkForUpdates = async () => {
  if (wb) {
    try {
      const registration = await wb.getSW()
      if (registration) {
        registration.update()
        console.log('🔄 检查应用更新中...')
      }
    } catch (error) {
      console.error('❌ 更新检查失败:', error)
    }
  }
}

// 缓存管理
export const clearAppCache = async () => {
  if ('caches' in window) {
    try {
      const cacheNames = await caches.keys()
      await Promise.all(
        cacheNames.map(cacheName => caches.delete(cacheName))
      )
      console.log('🗑️ 应用缓存已清除')
      
      // 重新加载页面
      window.location.reload()
    } catch (error) {
      console.error('❌ 缓存清除失败:', error)
    }
  }
}

// 应用性能监控
export const trackPerformance = () => {
  if ('performance' in window) {
    window.addEventListener('load', () => {
      setTimeout(() => {
        const perfData = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
        
        const metrics = {
          dns: perfData.domainLookupEnd - perfData.domainLookupStart,
          tcp: perfData.connectEnd - perfData.connectStart,
          request: perfData.responseStart - perfData.requestStart,
          response: perfData.responseEnd - perfData.responseStart,
          dom: perfData.domContentLoadedEventEnd - perfData.domContentLoadedEventStart,
          load: perfData.loadEventEnd - perfData.loadEventStart,
          total: perfData.loadEventEnd - perfData.fetchStart
        }

        console.log('📊 应用性能指标:', metrics)
        
        // 可以发送到分析服务
        // sendToAnalytics('performance', metrics)
      }, 0)
    })
  }
}

// 初始化 PWA 功能
export const initPWA = () => {
  registerSW()
  installPrompt()
  handleOfflineStatus()
  trackPerformance()
  
  console.log('🚀 PWA 功能初始化完成')
}