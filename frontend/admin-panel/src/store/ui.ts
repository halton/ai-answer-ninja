import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UIState {
  // 布局状态
  sidebarCollapsed: boolean
  darkMode: boolean
  primaryColor: string
  
  // 页面状态
  currentPage: string
  breadcrumbs: Array<{ title: string; path?: string }>
  
  // 消息通知
  notifications: Array<{
    id: string
    type: 'info' | 'success' | 'warning' | 'error'
    title: string
    message?: string
    timestamp: string
    read: boolean
  }>
  
  // 全局加载状态
  globalLoading: boolean
  
  // Actions
  setSidebarCollapsed: (collapsed: boolean) => void
  setDarkMode: (darkMode: boolean) => void
  setPrimaryColor: (color: string) => void
  setCurrentPage: (page: string) => void
  setBreadcrumbs: (breadcrumbs: UIState['breadcrumbs']) => void
  addNotification: (notification: Omit<UIState['notifications'][0], 'id' | 'timestamp' | 'read'>) => void
  markNotificationRead: (id: string) => void
  clearAllNotifications: () => void
  setGlobalLoading: (loading: boolean) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      // 初始状态
      sidebarCollapsed: false,
      darkMode: false,
      primaryColor: '#1890ff',
      currentPage: '',
      breadcrumbs: [],
      notifications: [],
      globalLoading: false,

      // Actions
      setSidebarCollapsed: (collapsed: boolean) => {
        set({ sidebarCollapsed: collapsed })
      },

      setDarkMode: (darkMode: boolean) => {
        set({ darkMode })
        // 更新HTML的data-theme属性
        if (typeof window !== 'undefined') {
          document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
        }
      },

      setPrimaryColor: (color: string) => {
        set({ primaryColor: color })
        // 更新CSS自定义属性
        if (typeof window !== 'undefined') {
          document.documentElement.style.setProperty('--primary-color', color)
        }
      },

      setCurrentPage: (page: string) => {
        set({ currentPage: page })
      },

      setBreadcrumbs: (breadcrumbs: UIState['breadcrumbs']) => {
        set({ breadcrumbs })
      },

      addNotification: (notification) => {
        const newNotification = {
          ...notification,
          id: `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date().toISOString(),
          read: false,
        }
        
        set(state => ({
          notifications: [newNotification, ...state.notifications].slice(0, 50) // 最多保留50条通知
        }))
      },

      markNotificationRead: (id: string) => {
        set(state => ({
          notifications: state.notifications.map(notification =>
            notification.id === id ? { ...notification, read: true } : notification
          )
        }))
      },

      clearAllNotifications: () => {
        set({ notifications: [] })
      },

      setGlobalLoading: (loading: boolean) => {
        set({ globalLoading: loading })
      },
    }),
    {
      name: 'ui-store',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        darkMode: state.darkMode,
        primaryColor: state.primaryColor,
      }),
    }
  )
)