import { create } from 'zustand'
import type { WhitelistEntry, CreateWhitelistDto, SmartWhitelistRecommendation, QueryParams } from '@/types'

interface WhitelistState {
  entries: WhitelistEntry[]
  recommendations: SmartWhitelistRecommendation[]
  selectedEntry: WhitelistEntry | null
  total: number
  loading: boolean
  error: string | null
  
  // Actions
  fetchWhitelist: (userId: string, params?: QueryParams) => Promise<void>
  fetchRecommendations: (userId: string) => Promise<void>
  createEntry: (userId: string, data: CreateWhitelistDto) => Promise<void>
  updateEntry: (id: string, data: Partial<WhitelistEntry>) => Promise<void>
  deleteEntry: (id: string) => Promise<void>
  batchDelete: (ids: string[]) => Promise<void>
  batchAdd: (userId: string, entries: CreateWhitelistDto[]) => Promise<void>
  evaluatePhone: (userId: string, phone: string) => Promise<any>
  selectEntry: (entry: WhitelistEntry | null) => void
  clearError: () => void
}

export const useWhitelistStore = create<WhitelistState>()((set, get) => ({
  entries: [],
  recommendations: [],
  selectedEntry: null,
  total: 0,
  loading: false,
  error: null,

  fetchWhitelist: async (userId: string, params?: QueryParams) => {
    set({ loading: true, error: null })
    
    try {
      const queryString = params ? new URLSearchParams(
        Object.entries(params).reduce((acc, [key, value]) => {
          if (value !== undefined && value !== null) {
            acc[key] = String(value)
          }
          return acc
        }, {} as Record<string, string>)
      ).toString() : ''

      const response = await fetch(`/api/whitelist/${userId}${queryString ? `?${queryString}` : ''}`)
      
      if (!response.ok) {
        throw new Error('获取白名单失败')
      }

      const data = await response.json()
      
      set({
        entries: data.data || data.entries || [],
        total: data.total || data.pagination?.total || 0,
        loading: false,
      })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '获取白名单失败',
      })
    }
  },

  fetchRecommendations: async (userId: string) => {
    set({ loading: true, error: null })
    
    try {
      const response = await fetch(`/api/whitelist/${userId}/recommendations`)
      
      if (!response.ok) {
        throw new Error('获取智能推荐失败')
      }

      const data = await response.json()
      
      set({
        recommendations: data.data || data.recommendations || [],
        loading: false,
      })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '获取智能推荐失败',
      })
    }
  },

  createEntry: async (userId: string, data: CreateWhitelistDto) => {
    set({ loading: true, error: null })
    
    try {
      const response = await fetch(`/api/whitelist/${userId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        throw new Error('添加白名单失败')
      }

      const newEntry = await response.json()
      
      set(state => ({
        entries: [...state.entries, newEntry.data || newEntry],
        total: state.total + 1,
        loading: false,
      }))
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '添加白名单失败',
      })
      throw error
    }
  },

  updateEntry: async (id: string, data: Partial<WhitelistEntry>) => {
    set({ loading: true, error: null })
    
    try {
      const response = await fetch(`/api/whitelist/entry/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        throw new Error('更新白名单失败')
      }

      const updatedEntry = await response.json()
      
      set(state => ({
        entries: state.entries.map(entry => 
          entry.id === id ? { ...entry, ...(updatedEntry.data || updatedEntry) } : entry
        ),
        selectedEntry: state.selectedEntry?.id === id 
          ? { ...state.selectedEntry, ...(updatedEntry.data || updatedEntry) }
          : state.selectedEntry,
        loading: false,
      }))
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '更新白名单失败',
      })
      throw error
    }
  },

  deleteEntry: async (id: string) => {
    set({ loading: true, error: null })
    
    try {
      const response = await fetch(`/api/whitelist/entry/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('删除白名单失败')
      }

      set(state => ({
        entries: state.entries.filter(entry => entry.id !== id),
        selectedEntry: state.selectedEntry?.id === id ? null : state.selectedEntry,
        total: Math.max(0, state.total - 1),
        loading: false,
      }))
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '删除白名单失败',
      })
      throw error
    }
  },

  batchDelete: async (ids: string[]) => {
    set({ loading: true, error: null })
    
    try {
      const response = await fetch('/api/whitelist/batch/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids }),
      })

      if (!response.ok) {
        throw new Error('批量删除失败')
      }

      set(state => ({
        entries: state.entries.filter(entry => !ids.includes(entry.id)),
        selectedEntry: state.selectedEntry && ids.includes(state.selectedEntry.id) 
          ? null : state.selectedEntry,
        total: Math.max(0, state.total - ids.length),
        loading: false,
      }))
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '批量删除失败',
      })
      throw error
    }
  },

  batchAdd: async (userId: string, entries: CreateWhitelistDto[]) => {
    set({ loading: true, error: null })
    
    try {
      const response = await fetch(`/api/whitelist/${userId}/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ entries }),
      })

      if (!response.ok) {
        throw new Error('批量添加失败')
      }

      const newEntries = await response.json()
      
      set(state => ({
        entries: [...state.entries, ...(newEntries.data || newEntries)],
        total: state.total + entries.length,
        loading: false,
      }))
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '批量添加失败',
      })
      throw error
    }
  },

  evaluatePhone: async (userId: string, phone: string) => {
    try {
      const response = await fetch(`/api/whitelist/${userId}/evaluate/${phone}`)
      
      if (!response.ok) {
        throw new Error('评估号码失败')
      }

      return await response.json()
    } catch (error) {
      throw error
    }
  },

  selectEntry: (entry: WhitelistEntry | null) => {
    set({ selectedEntry: entry })
  },

  clearError: () => {
    set({ error: null })
  },
}))