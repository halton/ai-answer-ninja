import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { SystemHealth, PerformanceMetrics, ServiceHealth, GlobalConfig } from '@/types'
import { request } from '@/services/http'

interface SystemState {
  // 系统健康状态
  systemHealth: SystemHealth | null
  serviceList: ServiceHealth[]
  performanceMetrics: PerformanceMetrics[]
  globalConfigs: GlobalConfig[]
  alerts: SystemAlert[]
  
  // 加载状态
  isLoadingHealth: boolean
  isLoadingMetrics: boolean
  isLoadingConfigs: boolean
  
  // 错误状态
  healthError: string | null
  metricsError: string | null
  configError: string | null
  
  // Actions
  fetchSystemHealth: () => Promise<void>
  fetchPerformanceMetrics: (period?: string) => Promise<void>
  fetchServiceStatus: (serviceName?: string) => Promise<void>
  fetchGlobalConfigs: () => Promise<void>
  updateGlobalConfig: (id: string, data: Partial<GlobalConfig>) => Promise<void>
  acknowledgeAlert: (alertId: string) => Promise<void>
  clearAlert: (alertId: string) => void
  clearErrors: () => void
  
  // Real-time updates
  updateSystemHealth: (health: SystemHealth) => void
  updateServiceHealth: (serviceId: string, health: Partial<ServiceHealth>) => void
  addMetricData: (metric: PerformanceMetrics) => void
  addAlert: (alert: SystemAlert) => void
}

export interface SystemAlert {
  id: string
  type: 'error' | 'warning' | 'info' | 'success'
  title: string
  message: string
  service?: string
  timestamp: string
  acknowledged: boolean
  resolved: boolean
  severity: 'low' | 'medium' | 'high' | 'critical'
  metadata?: Record<string, any>
}

export const useSystemStore = create<SystemState>()(  
  subscribeWithSelector((set, get) => ({
    // 初始状态
    systemHealth: null,
    serviceList: [],
    performanceMetrics: [],
    globalConfigs: [],
    alerts: [],
    
    isLoadingHealth: false,
    isLoadingMetrics: false,
    isLoadingConfigs: false,
    
    healthError: null,
    metricsError: null,
    configError: null,
    
    // 获取系统健康状态
    fetchSystemHealth: async () => {
      set({ isLoadingHealth: true, healthError: null })
      
      try {
        const response = await request.get<SystemHealth>('/monitoring/health')
        const systemHealth = response.data.data
        
        set({
          systemHealth,
          serviceList: systemHealth.services,
          isLoadingHealth: false
        })
      } catch (error) {
        set({
          isLoadingHealth: false,
          healthError: error instanceof Error ? error.message : '获取系统健康状态失败'
        })
      }
    },
    
    // 获取性能指标
    fetchPerformanceMetrics: async (period = '24h') => {
      set({ isLoadingMetrics: true, metricsError: null })
      
      try {
        const response = await request.get<PerformanceMetrics[]>(`/monitoring/metrics?period=${period}`)
        const metrics = response.data.data
        
        set({
          performanceMetrics: metrics,
          isLoadingMetrics: false
        })
      } catch (error) {
        set({
          isLoadingMetrics: false,
          metricsError: error instanceof Error ? error.message : '获取性能指标失败'
        })
      }
    },
    
    // 获取特定服务状态
    fetchServiceStatus: async (serviceName) => {
      try {
        const endpoint = serviceName 
          ? `/monitoring/services/${serviceName}/status`
          : '/monitoring/services/status'
          
        const response = await request.get<ServiceHealth[]>(endpoint)
        const services = Array.isArray(response.data.data) 
          ? response.data.data 
          : [response.data.data]
        
        set((state) => {
          const updatedServices = [...state.serviceList]
          services.forEach(service => {
            const index = updatedServices.findIndex(s => s.name === service.name)
            if (index >= 0) {
              updatedServices[index] = service
            } else {
              updatedServices.push(service)
            }
          })
          
          return { serviceList: updatedServices }
        })
      } catch (error) {
        console.error('获取服务状态失败:', error)
      }
    },
    
    // 获取全局配置
    fetchGlobalConfigs: async () => {
      set({ isLoadingConfigs: true, configError: null })
      
      try {
        const response = await request.get<GlobalConfig[]>('/config/global')
        const configs = response.data.data
        
        set({
          globalConfigs: configs,
          isLoadingConfigs: false
        })
      } catch (error) {
        set({
          isLoadingConfigs: false,
          configError: error instanceof Error ? error.message : '获取系统配置失败'
        })
      }
    },
    
    // 更新全局配置
    updateGlobalConfig: async (id: string, data: Partial<GlobalConfig>) => {
      try {
        const response = await request.put<GlobalConfig>(`/config/global/${id}`, data)
        const updatedConfig = response.data.data
        
        set((state) => ({
          globalConfigs: state.globalConfigs.map(config => 
            config.id === id ? updatedConfig : config
          )
        }))
      } catch (error) {
        set({
          configError: error instanceof Error ? error.message : '更新配置失败'
        })
        throw error
      }
    },
    
    // 确认告警
    acknowledgeAlert: async (alertId: string) => {
      try {
        await request.post(`/monitoring/alerts/${alertId}/acknowledge`)
        
        set((state) => ({
          alerts: state.alerts.map(alert => 
            alert.id === alertId 
              ? { ...alert, acknowledged: true }
              : alert
          )
        }))
      } catch (error) {
        console.error('确认告警失败:', error)
      }
    },
    
    // 清除告警
    clearAlert: (alertId: string) => {
      set((state) => ({
        alerts: state.alerts.filter(alert => alert.id !== alertId)
      }))
    },
    
    // 清除错误
    clearErrors: () => {
      set({ healthError: null, metricsError: null, configError: null })
    },
    
    // 实时更新系统健康状态
    updateSystemHealth: (health: SystemHealth) => {
      set({ systemHealth: health, serviceList: health.services })
    },
    
    // 更新服务健康状态
    updateServiceHealth: (serviceId: string, healthUpdate: Partial<ServiceHealth>) => {
      set((state) => {
        const updatedServices = state.serviceList.map(service => 
          service.name === serviceId 
            ? { ...service, ...healthUpdate }
            : service
        )
        
        return {
          serviceList: updatedServices,
          systemHealth: state.systemHealth ? {
            ...state.systemHealth,
            services: updatedServices
          } : null
        }
      })
    },
    
    // 添加新的性能指标数据
    addMetricData: (metric: PerformanceMetrics) => {
      set((state) => {
        const metrics = [...state.performanceMetrics, metric]
        // 保持最近100条记录
        if (metrics.length > 100) {
          metrics.shift()
        }
        
        return { performanceMetrics: metrics }
      })
    },
    
    // 添加新告警
    addAlert: (alert: SystemAlert) => {
      set((state) => ({
        alerts: [alert, ...state.alerts].slice(0, 50) // 保持最近50条告警
      }))
    }
  }))
)