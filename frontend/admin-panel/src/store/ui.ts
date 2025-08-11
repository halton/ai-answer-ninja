import { create } from 'zustand'
import { persist, subscribeWithSelector } from 'zustand/middleware'

export interface Notification {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  title: string
  message?: string
  timestamp: string
  read: boolean
  duration?: number // 自动消失时间(毫秒)，0为不自动消失
  action?: {
    label: string
    handler: () => void
  }
}

export interface Modal {
  id: string
  type: 'info' | 'confirm' | 'warning' | 'custom'
  title: string
  content: string | React.ReactNode
  width?: number
  maskClosable?: boolean
  onOk?: () => void | Promise<void>
  onCancel?: () => void
  okText?: string
  cancelText?: string
  loading?: boolean
}

export interface Drawer {
  id: string
  title: string
  content: React.ReactNode
  width?: number | string
  placement?: 'left' | 'right' | 'top' | 'bottom'
  closable?: boolean
  maskClosable?: boolean
  onClose?: () => void
}

interface UIState {
  // 布局状态
  sidebarCollapsed: boolean
  darkMode: boolean
  primaryColor: string
  fontSize: 'small' | 'medium' | 'large'
  layout: 'side' | 'top' | 'mix'
  
  // 页面状态  
  currentPage: string
  breadcrumbs: Array<{ title: string; path?: string }>
  pageTitle: string
  
  // 消息通知
  notifications: Notification[]
  unreadCount: number
  
  // 模态框和抽屉
  modals: Modal[]
  drawers: Drawer[]
  
  // 全局加载状态
  globalLoading: boolean
  loadingText: string
  
  // 全屏状态
  isFullscreen: boolean
  
  // 网络状态
  isOnline: boolean
  
  // 设备信息
  isMobile: boolean
  screenSize: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  
  // Actions
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
  setDarkMode: (darkMode: boolean) => void
  toggleDarkMode: () => void
  setPrimaryColor: (color: string) => void
  setFontSize: (size: UIState['fontSize']) => void
  setLayout: (layout: UIState['layout']) => void
  
  setCurrentPage: (page: string) => void
  setBreadcrumbs: (breadcrumbs: UIState['breadcrumbs']) => void
  setPageTitle: (title: string) => void
  
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => string
  markNotificationRead: (id: string) => void
  removeNotification: (id: string) => void
  clearAllNotifications: () => void
  
  showModal: (modal: Omit<Modal, 'id'>) => string
  hideModal: (id: string) => void
  updateModal: (id: string, updates: Partial<Modal>) => void
  hideAllModals: () => void
  
  showDrawer: (drawer: Omit<Drawer, 'id'>) => string
  hideDrawer: (id: string) => void
  hideAllDrawers: () => void
  
  setGlobalLoading: (loading: boolean, text?: string) => void
  setFullscreen: (fullscreen: boolean) => void
  setOnlineStatus: (online: boolean) => void
  setDeviceInfo: (mobile: boolean, screenSize: UIState['screenSize']) => void
}

export const useUIStore = create<UIState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        // 初始状态
        sidebarCollapsed: false,
        darkMode: false,
        primaryColor: '#1890ff',
        fontSize: 'medium',
        layout: 'side',
        
        currentPage: '',
        breadcrumbs: [],
        pageTitle: '',
        
        notifications: [],
        unreadCount: 0,
        
        modals: [],
        drawers: [],
        
        globalLoading: false,
        loadingText: '加载中...',
        
        isFullscreen: false,
        isOnline: true,
        
        isMobile: false,
        screenSize: 'lg',

        // 布局相关Actions
        setSidebarCollapsed: (collapsed: boolean) => {
          set({ sidebarCollapsed: collapsed })
        },
        
        toggleSidebar: () => {
          set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }))
        },

        setDarkMode: (darkMode: boolean) => {
          set({ darkMode })
          // 更新HTML的data-theme属性
          if (typeof window !== 'undefined') {
            document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
            // 同步到Ant Design的ConfigProvider
            const event = new CustomEvent('theme-change', { detail: { darkMode } })
            window.dispatchEvent(event)
          }
        },
        
        toggleDarkMode: () => {
          const { darkMode } = get()
          get().setDarkMode(!darkMode)
        },

        setPrimaryColor: (color: string) => {
          set({ primaryColor: color })
          // 更新CSS自定义属性
          if (typeof window !== 'undefined') {
            document.documentElement.style.setProperty('--primary-color', color)
          }
        },
        
        setFontSize: (fontSize: UIState['fontSize']) => {
          set({ fontSize })
          if (typeof window !== 'undefined') {
            const sizeMap = { small: '12px', medium: '14px', large: '16px' }
            document.documentElement.style.setProperty('--base-font-size', sizeMap[fontSize])
          }
        },
        
        setLayout: (layout: UIState['layout']) => {
          set({ layout })
        },

        // 页面相关Actions
        setCurrentPage: (page: string) => {
          set({ currentPage: page })
        },

        setBreadcrumbs: (breadcrumbs: UIState['breadcrumbs']) => {
          set({ breadcrumbs })
        },
        
        setPageTitle: (title: string) => {
          set({ pageTitle: title })
          if (typeof window !== 'undefined') {
            document.title = title ? `${title} - AI电话应答系统` : 'AI电话应答系统'
          }
        },

        // 通知相关Actions
        addNotification: (notification) => {
          const id = `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
          const newNotification: Notification = {
            ...notification,
            id,
            timestamp: new Date().toISOString(),
            read: false,
          }
          
          set(state => {
            const notifications = [newNotification, ...state.notifications].slice(0, 100) // 最多保留100条通知
            const unreadCount = notifications.filter(n => !n.read).length
            return { notifications, unreadCount }
          })
          
          // 自动消失的通知
          if (notification.duration && notification.duration > 0) {
            setTimeout(() => {
              get().removeNotification(id)
            }, notification.duration)
          }
          
          return id
        },

        markNotificationRead: (id: string) => {
          set(state => {
            const notifications = state.notifications.map(notification =>
              notification.id === id ? { ...notification, read: true } : notification
            )
            const unreadCount = notifications.filter(n => !n.read).length
            return { notifications, unreadCount }
          })
        },
        
        removeNotification: (id: string) => {
          set(state => {
            const notifications = state.notifications.filter(n => n.id !== id)
            const unreadCount = notifications.filter(n => !n.read).length
            return { notifications, unreadCount }
          })
        },

        clearAllNotifications: () => {
          set({ notifications: [], unreadCount: 0 })
        },

        // 模态框相关Actions
        showModal: (modal) => {
          const id = `modal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
          const newModal: Modal = { ...modal, id }
          
          set(state => ({
            modals: [...state.modals, newModal]
          }))
          
          return id
        },
        
        hideModal: (id: string) => {
          set(state => ({
            modals: state.modals.filter(modal => modal.id !== id)
          }))
        },
        
        updateModal: (id: string, updates: Partial<Modal>) => {
          set(state => ({
            modals: state.modals.map(modal => 
              modal.id === id ? { ...modal, ...updates } : modal
            )
          }))
        },
        
        hideAllModals: () => {
          set({ modals: [] })
        },

        // 抽屉相关Actions
        showDrawer: (drawer) => {
          const id = `drawer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
          const newDrawer: Drawer = { ...drawer, id }
          
          set(state => ({
            drawers: [...state.drawers, newDrawer]
          }))
          
          return id
        },
        
        hideDrawer: (id: string) => {
          set(state => ({
            drawers: state.drawers.filter(drawer => drawer.id !== id)
          }))
        },
        
        hideAllDrawers: () => {
          set({ drawers: [] })
        },

        // 全局状态Actions
        setGlobalLoading: (loading: boolean, text = '加载中...') => {
          set({ globalLoading: loading, loadingText: text })
        },
        
        setFullscreen: (fullscreen: boolean) => {
          set({ isFullscreen: fullscreen })
          
          if (typeof window !== 'undefined') {
            if (fullscreen) {
              document.documentElement.requestFullscreen?.()
            } else {
              document.exitFullscreen?.()
            }
          }
        },
        
        setOnlineStatus: (online: boolean) => {
          set({ isOnline: online })
          
          // 网络状态变化时显示通知
          if (online) {
            get().addNotification({
              type: 'success',
              title: '网络已连接',
              message: '网络连接已恢复',
              duration: 3000
            })
          } else {
            get().addNotification({
              type: 'error',
              title: '网络连接断开',
              message: '请检查您的网络连接',
              duration: 0 // 不自动消失
            })
          }
        },
        
        setDeviceInfo: (mobile: boolean, screenSize: UIState['screenSize']) => {
          set({ isMobile: mobile, screenSize })
          
          // 移动设备自动收起侧边栏
          if (mobile && !get().sidebarCollapsed) {
            set({ sidebarCollapsed: true })
          }
        }
      }),
      {
        name: 'ai-ninja-ui-store',
        partialize: (state) => ({
          sidebarCollapsed: state.sidebarCollapsed,
          darkMode: state.darkMode,
          primaryColor: state.primaryColor,
          fontSize: state.fontSize,
          layout: state.layout,
        }),
      }
    )
  )
)