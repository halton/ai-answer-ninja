import axios, { 
  AxiosInstance, 
  AxiosRequestConfig, 
  AxiosResponse, 
  InternalAxiosRequestConfig 
} from 'axios'
import type { ApiResponse } from '@/types'

// 创建axios实例
const httpClient: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截器
httpClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // 添加认证token
    const token = localStorage.getItem('auth_token')
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`
    }
    
    // 添加请求ID用于追踪
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    if (config.headers) {
      config.headers['X-Request-ID'] = requestId
    }
    
    // 打印请求日志（仅开发环境）
    if (import.meta.env.DEV) {
      console.log(`🚀 [${config.method?.toUpperCase()}] ${config.url}`, {
        headers: config.headers,
        data: config.data,
        params: config.params,
      })
    }
    
    return config
  },
  (error) => {
    console.error('❌ Request interceptor error:', error)
    return Promise.reject(error)
  }
)

// 响应拦截器
httpClient.interceptors.response.use(
  (response: AxiosResponse<ApiResponse>) => {
    const { data, status } = response
    
    // 打印响应日志（仅开发环境）
    if (import.meta.env.DEV) {
      console.log(`✅ [${status}] ${response.config.url}`, data)
    }
    
    // 统一处理API响应格式
    if (data && typeof data === 'object') {
      // 如果后端返回的是标准格式 { success, data, message }
      if ('success' in data) {
        if (!data.success) {
          throw new Error(data.message || '请求失败')
        }
        return response
      }
      
      // 如果后端直接返回数据，包装成标准格式
      response.data = {
        success: true,
        data: data,
        message: 'success',
        timestamp: new Date().toISOString(),
      }
    }
    
    return response
  },
  async (error) => {
    const { response, config } = error
    
    // 打印错误日志
    console.error(`❌ [${response?.status || 'Network'}] ${config?.url}`, {
      message: error.message,
      response: response?.data,
      config: {
        method: config?.method,
        url: config?.url,
        data: config?.data,
      }
    })
    
    // 根据不同的错误状态码进行处理
    if (response) {
      const { status, data } = response
      
      switch (status) {
        case 401:
          // 未授权，清除token并跳转到登录页
          localStorage.removeItem('auth_token')
          if (window.location.pathname !== '/login') {
            window.location.href = '/login'
          }
          break
          
        case 403:
          // 权限不足
          throw new Error(data?.message || '权限不足')
          
        case 404:
          throw new Error('请求的资源不存在')
          
        case 422:
          // 验证错误
          throw new Error(data?.message || '数据验证失败')
          
        case 429:
          // 请求过于频繁
          throw new Error('请求过于频繁，请稍后再试')
          
        case 500:
          throw new Error('服务器内部错误')
          
        case 502:
        case 503:
        case 504:
          throw new Error('服务暂时不可用，请稍后再试')
          
        default:
          throw new Error(data?.message || `请求失败 (${status})`)
      }
    } else if (error.code === 'ECONNABORTED') {
      // 请求超时
      throw new Error('请求超时，请检查网络连接')
    } else if (error.message === 'Network Error') {
      // 网络错误
      throw new Error('网络连接失败，请检查网络设置')
    } else {
      // 其他错误
      throw new Error(error.message || '请求失败')
    }
  }
)

// 通用请求方法
export const request = {
  get: <T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<ApiResponse<T>>> => {
    return httpClient.get(url, config)
  },
  
  post: <T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<ApiResponse<T>>> => {
    return httpClient.post(url, data, config)
  },
  
  put: <T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<ApiResponse<T>>> => {
    return httpClient.put(url, data, config)
  },
  
  patch: <T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<ApiResponse<T>>> => {
    return httpClient.patch(url, data, config)
  },
  
  delete: <T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<ApiResponse<T>>> => {
    return httpClient.delete(url, config)
  },
  
  upload: <T = any>(url: string, formData: FormData, config?: AxiosRequestConfig): Promise<AxiosResponse<ApiResponse<T>>> => {
    return httpClient.post(url, formData, {
      ...config,
      headers: {
        ...config?.headers,
        'Content-Type': 'multipart/form-data',
      },
    })
  },
  
  download: (url: string, filename?: string, config?: AxiosRequestConfig): Promise<void> => {
    return httpClient.get(url, {
      ...config,
      responseType: 'blob',
    }).then(response => {
      // 创建下载链接
      const blob = new Blob([response.data])
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = filename || `download-${Date.now()}`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(downloadUrl)
    })
  }
}

export default httpClient