import { create } from 'zustand'
import type { CallRecord, Conversation, QueryParams, AnalyticsData } from '@/types'

interface CallState {
  calls: CallRecord[]
  selectedCall: CallRecord | null
  conversations: Conversation[]
  analytics: AnalyticsData | null
  total: number
  loading: boolean
  error: string | null
  
  // Actions
  fetchCalls: (params?: QueryParams) => Promise<void>
  fetchCallDetail: (callId: string) => Promise<void>
  fetchConversations: (callId: string) => Promise<void>
  fetchAnalytics: (period: string, startDate?: string, endDate?: string) => Promise<void>
  selectCall: (call: CallRecord | null) => void
  deleteCall: (id: string) => Promise<void>
  clearError: () => void
}

export const useCallStore = create<CallState>()((set, get) => ({
  calls: [],
  selectedCall: null,
  conversations: [],
  analytics: null,
  total: 0,
  loading: false,
  error: null,

  fetchCalls: async (params?: QueryParams) => {
    set({ loading: true, error: null })
    
    try {
      const queryString = params ? new URLSearchParams(
        Object.entries(params).reduce((acc, [key, value]) => {
          if (value !== undefined && value !== null) {
            if (Array.isArray(value)) {
              acc[key] = value.join(',')
            } else {
              acc[key] = String(value)
            }
          }
          return acc
        }, {} as Record<string, string>)
      ).toString() : ''

      const response = await fetch(`/api/calls${queryString ? `?${queryString}` : ''}`)
      
      if (!response.ok) {
        throw new Error('获取通话记录失败')
      }

      const data = await response.json()
      
      set({
        calls: data.data || data.calls || [],
        total: data.total || data.pagination?.total || 0,
        loading: false,
      })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '获取通话记录失败',
      })
    }
  },

  fetchCallDetail: async (callId: string) => {
    set({ loading: true, error: null })
    
    try {
      const response = await fetch(`/api/calls/${callId}`)
      
      if (!response.ok) {
        throw new Error('获取通话详情失败')
      }

      const data = await response.json()
      
      set({
        selectedCall: data.data || data,
        loading: false,
      })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '获取通话详情失败',
      })
    }
  },

  fetchConversations: async (callId: string) => {
    set({ loading: true, error: null })
    
    try {
      const response = await fetch(`/api/calls/${callId}/conversations`)
      
      if (!response.ok) {
        throw new Error('获取对话记录失败')
      }

      const data = await response.json()
      
      set({
        conversations: data.data || data.conversations || [],
        loading: false,
      })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '获取对话记录失败',
      })
    }
  },

  fetchAnalytics: async (period: string, startDate?: string, endDate?: string) => {
    set({ loading: true, error: null })
    
    try {
      const params = new URLSearchParams({
        period,
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
      })

      const response = await fetch(`/api/analytics/calls?${params}`)
      
      if (!response.ok) {
        throw new Error('获取分析数据失败')
      }

      const data = await response.json()
      
      set({
        analytics: data.data || data,
        loading: false,
      })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '获取分析数据失败',
      })
    }
  },

  selectCall: (call: CallRecord | null) => {
    set({ selectedCall: call })
  },

  deleteCall: async (id: string) => {
    set({ loading: true, error: null })
    
    try {
      const response = await fetch(`/api/calls/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('删除通话记录失败')
      }

      set(state => ({
        calls: state.calls.filter(call => call.id !== id),
        selectedCall: state.selectedCall?.id === id ? null : state.selectedCall,
        total: Math.max(0, state.total - 1),
        loading: false,
      }))
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '删除通话记录失败',
      })
      throw error
    }
  },

  clearError: () => {
    set({ error: null })
  },
}))