import { create } from 'zustand'
import type { SystemHealth, PerformanceMetrics, GlobalConfig } from '@/types'

interface SystemState {
  health: SystemHealth | null
  metrics: PerformanceMetrics[]
  configs: GlobalConfig[]
  realtimeData: any
  loading: boolean
  error: string | null
  
  // Actions
  fetchSystemHealth: () => Promise<void>
  fetchMetrics: (timeRange?: string) => Promise<void>
  fetchConfigs: () => Promise<void>
  updateConfig: (id: string, data: Partial<GlobalConfig>) => Promise<void>
  setRealtimeData: (data: any) => void
  clearError: () => void
}

export const useSystemStore = create<SystemState>()((set, get) => ({
  health: null,
  metrics: [],
  configs: [],
  realtimeData: null,
  loading: false,
  error: null,

  fetchSystemHealth: async () => {
    set({ loading: true, error: null })
    
    try {
      const response = await fetch('/api/monitoring/health')
      
      if (!response.ok) {
        throw new Error('获取系统健康状态失败')
      }

      const data = await response.json()
      
      set({
        health: data.data || data,
        loading: false,
      })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '获取系统健康状态失败',
      })
    }
  },

  fetchMetrics: async (timeRange = '24h') => {
    set({ loading: true, error: null })
    
    try {
      const response = await fetch(`/api/monitoring/metrics?timeRange=${timeRange}`)
      
      if (!response.ok) {
        throw new Error('获取性能指标失败')
      }

      const data = await response.json()
      
      set({
        metrics: data.data || data.metrics || [],
        loading: false,
      })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '获取性能指标失败',
      })
    }
  },

  fetchConfigs: async () => {
    set({ loading: true, error: null })
    
    try {
      const response = await fetch('/api/config/global')
      
      if (!response.ok) {
        throw new Error('获取系统配置失败')
      }

      const data = await response.json()
      
      set({
        configs: data.data || data.configs || [],
        loading: false,
      })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '获取系统配置失败',
      })
    }
  },

  updateConfig: async (id: string, data: Partial<GlobalConfig>) => {
    set({ loading: true, error: null })
    
    try {
      const response = await fetch(`/api/config/global/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        throw new Error('更新配置失败')
      }

      const updatedConfig = await response.json()
      
      set(state => ({
        configs: state.configs.map(config => 
          config.id === id ? { ...config, ...(updatedConfig.data || updatedConfig) } : config
        ),
        loading: false,
      }))
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '更新配置失败',
      })
      throw error
    }
  },

  setRealtimeData: (data: any) => {
    set({ realtimeData: data })
  },

  clearError: () => {
    set({ error: null })
  },
}))