import { request } from './http'
import type { AuthUser, LoginCredentials, ApiResponse } from '@/types'

export const authService = {
  // 用户登录
  login: async (credentials: LoginCredentials): Promise<{ user: AuthUser; token: string }> => {
    const response = await request.post<{ user: AuthUser; token: string }>('/auth/login', credentials)
    return response.data.data
  },

  // 用户登出
  logout: async (): Promise<void> => {
    await request.post('/auth/logout')
  },

  // 刷新Token
  refreshToken: async (): Promise<{ token: string; user: AuthUser }> => {
    const response = await request.post<{ token: string; user: AuthUser }>('/auth/refresh')
    return response.data.data
  },

  // 获取当前用户信息
  getCurrentUser: async (): Promise<AuthUser> => {
    const response = await request.get<AuthUser>('/auth/me')
    return response.data.data
  },

  // 修改密码
  changePassword: async (data: {
    currentPassword: string
    newPassword: string
    confirmPassword: string
  }): Promise<void> => {
    await request.post('/auth/change-password', data)
  },

  // 忘记密码
  forgotPassword: async (email: string): Promise<void> => {
    await request.post('/auth/forgot-password', { email })
  },

  // 重置密码
  resetPassword: async (data: {
    token: string
    password: string
    confirmPassword: string
  }): Promise<void> => {
    await request.post('/auth/reset-password', data)
  },

  // 验证Token
  verifyToken: async (token: string): Promise<boolean> => {
    try {
      await request.post('/auth/verify-token', { token })
      return true
    } catch {
      return false
    }
  },

  // 启用/禁用多因素认证
  toggleMFA: async (enabled: boolean): Promise<{ qrCode?: string; backupCodes?: string[] }> => {
    const response = await request.post<{ qrCode?: string; backupCodes?: string[] }>('/auth/mfa/toggle', { enabled })
    return response.data.data
  },

  // 验证MFA代码
  verifyMFA: async (code: string): Promise<{ token: string }> => {
    const response = await request.post<{ token: string }>('/auth/mfa/verify', { code })
    return response.data.data
  },
}