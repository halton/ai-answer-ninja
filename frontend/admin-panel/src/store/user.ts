import { create } from 'zustand'
import type { User, QueryParams } from '@/types'

interface UserState {
  users: User[]
  selectedUser: User | null
  total: number
  loading: boolean
  error: string | null
  
  // Actions
  fetchUsers: (params?: QueryParams) => Promise<void>
  createUser: (userData: Partial<User>) => Promise<void>
  updateUser: (id: string, userData: Partial<User>) => Promise<void>
  deleteUser: (id: string) => Promise<void>
  selectUser: (user: User | null) => void
  clearError: () => void
}

export const useUserStore = create<UserState>()((set, get) => ({
  users: [],
  selectedUser: null,
  total: 0,
  loading: false,
  error: null,

  fetchUsers: async (params?: QueryParams) => {
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

      const response = await fetch(`/api/users${queryString ? `?${queryString}` : ''}`)
      
      if (!response.ok) {
        throw new Error('获取用户列表失败')
      }

      const data = await response.json()
      
      set({
        users: data.data || data.users || [],
        total: data.total || data.pagination?.total || 0,
        loading: false,
      })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '获取用户列表失败',
      })
    }
  },

  createUser: async (userData: Partial<User>) => {
    set({ loading: true, error: null })
    
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(userData),
      })

      if (!response.ok) {
        throw new Error('创建用户失败')
      }

      const newUser = await response.json()
      
      set(state => ({
        users: [...state.users, newUser.data || newUser],
        total: state.total + 1,
        loading: false,
      }))
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '创建用户失败',
      })
      throw error
    }
  },

  updateUser: async (id: string, userData: Partial<User>) => {
    set({ loading: true, error: null })
    
    try {
      const response = await fetch(`/api/users/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(userData),
      })

      if (!response.ok) {
        throw new Error('更新用户失败')
      }

      const updatedUser = await response.json()
      
      set(state => ({
        users: state.users.map(user => 
          user.id === id ? { ...user, ...(updatedUser.data || updatedUser) } : user
        ),
        selectedUser: state.selectedUser?.id === id 
          ? { ...state.selectedUser, ...(updatedUser.data || updatedUser) }
          : state.selectedUser,
        loading: false,
      }))
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '更新用户失败',
      })
      throw error
    }
  },

  deleteUser: async (id: string) => {
    set({ loading: true, error: null })
    
    try {
      const response = await fetch(`/api/users/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('删除用户失败')
      }

      set(state => ({
        users: state.users.filter(user => user.id !== id),
        selectedUser: state.selectedUser?.id === id ? null : state.selectedUser,
        total: Math.max(0, state.total - 1),
        loading: false,
      }))
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '删除用户失败',
      })
      throw error
    }
  },

  selectUser: (user: User | null) => {
    set({ selectedUser: user })
  },

  clearError: () => {
    set({ error: null })
  },
}))