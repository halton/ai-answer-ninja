import { request } from './http'
import type { User, CreateUserDto, UpdateUserDto, QueryParams, ApiResponse } from '@/types'

export const userService = {
  // 获取用户列表
  getUsers: async (params?: QueryParams): Promise<{
    users: User[]
    total: number
    pagination: any
  }> => {
    const response = await request.get<{
      users: User[]
      total: number
      pagination: any
    }>('/users', { params })
    return response.data.data
  },

  // 获取用户详情
  getUserById: async (id: string): Promise<User> => {
    const response = await request.get<User>(`/users/${id}`)
    return response.data.data
  },

  // 创建用户
  createUser: async (userData: CreateUserDto): Promise<User> => {
    const response = await request.post<User>('/users', userData)
    return response.data.data
  },

  // 更新用户
  updateUser: async (id: string, userData: UpdateUserDto): Promise<User> => {
    const response = await request.put<User>(`/users/${id}`, userData)
    return response.data.data
  },

  // 删除用户
  deleteUser: async (id: string): Promise<void> => {
    await request.delete(`/users/${id}`)
  },

  // 批量删除用户
  batchDeleteUsers: async (ids: string[]): Promise<void> => {
    await request.post('/users/batch/delete', { ids })
  },

  // 激活/停用用户
  toggleUserStatus: async (id: string, status: 'active' | 'inactive' | 'suspended'): Promise<User> => {
    const response = await request.patch<User>(`/users/${id}/status`, { status })
    return response.data.data
  },

  // 重置用户密码
  resetUserPassword: async (id: string): Promise<{ temporaryPassword: string }> => {
    const response = await request.post<{ temporaryPassword: string }>(`/users/${id}/reset-password`)
    return response.data.data
  },

  // 获取用户统计信息
  getUserStats: async (id?: string): Promise<{
    totalUsers: number
    activeUsers: number
    newUsersThisMonth: number
    usersByStatus: Record<string, number>
    usersByRole: Record<string, number>
  }> => {
    const url = id ? `/users/${id}/stats` : '/users/stats'
    const response = await request.get(url)
    return response.data.data
  },

  // 获取用户活动日志
  getUserActivityLogs: async (id: string, params?: QueryParams): Promise<{
    logs: Array<{
      id: string
      action: string
      description: string
      ipAddress: string
      userAgent: string
      timestamp: string
    }>
    total: number
  }> => {
    const response = await request.get(`/users/${id}/activity-logs`, { params })
    return response.data.data
  },

  // 更新用户偏好设置
  updateUserPreferences: async (id: string, preferences: any): Promise<User> => {
    const response = await request.patch<User>(`/users/${id}/preferences`, { preferences })
    return response.data.data
  },

  // 获取用户权限
  getUserPermissions: async (id: string): Promise<string[]> => {
    const response = await request.get<string[]>(`/users/${id}/permissions`)
    return response.data.data
  },

  // 更新用户权限
  updateUserPermissions: async (id: string, permissions: string[]): Promise<void> => {
    await request.put(`/users/${id}/permissions`, { permissions })
  },

  // 导出用户数据
  exportUsers: async (params?: QueryParams): Promise<void> => {
    const queryParams = params ? new URLSearchParams(
      Object.entries(params).reduce((acc, [key, value]) => {
        if (value !== undefined && value !== null) {
          acc[key] = String(value)
        }
        return acc
      }, {} as Record<string, string>)
    ).toString() : ''
    
    await request.download(`/users/export${queryParams ? `?${queryParams}` : ''}`, 'users.xlsx')
  },

  // 导入用户数据
  importUsers: async (file: File): Promise<{
    success: number
    failed: number
    errors: Array<{ row: number; error: string }>
  }> => {
    const formData = new FormData()
    formData.append('file', file)
    
    const response = await request.upload<{
      success: number
      failed: number
      errors: Array<{ row: number; error: string }>
    }>('/users/import', formData)
    
    return response.data.data
  },

  // 检查用户名/手机号是否可用
  checkAvailability: async (field: 'username' | 'phoneNumber' | 'email', value: string): Promise<boolean> => {
    const response = await request.post<{ available: boolean }>('/users/check-availability', {
      field,
      value
    })
    return response.data.data.available
  },
}