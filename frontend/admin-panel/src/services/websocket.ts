import { io, Socket } from 'socket.io-client'
import type { WebSocketMessage, RealTimeUpdate } from '@/types'

class WebSocketService {
  private socket: Socket | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectInterval = 1000
  private listeners: Map<string, Set<Function>> = new Map()

  connect(): void {
    if (this.socket?.connected) return

    const token = localStorage.getItem('auth_token')
    if (!token) {
      console.warn('No auth token found, skipping WebSocket connection')
      return
    }

    try {
      this.socket = io(import.meta.env.VITE_WS_URL || window.location.origin, {
        auth: {
          token
        },
        transports: ['websocket'],
        timeout: 20000,
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: this.reconnectInterval,
      })

      this.setupEventListeners()
    } catch (error) {
      console.error('WebSocket connection failed:', error)
    }
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
    this.listeners.clear()
    this.reconnectAttempts = 0
  }

  private setupEventListeners(): void {
    if (!this.socket) return

    // 连接成功
    this.socket.on('connect', () => {
      console.log('✅ WebSocket connected:', this.socket?.id)
      this.reconnectAttempts = 0
      this.emit('connection', { status: 'connected', socketId: this.socket?.id })
    })

    // 连接断开
    this.socket.on('disconnect', (reason) => {
      console.warn('❌ WebSocket disconnected:', reason)
      this.emit('connection', { status: 'disconnected', reason })
    })

    // 连接错误
    this.socket.on('connect_error', (error) => {
      console.error('❌ WebSocket connection error:', error)
      this.reconnectAttempts++
      
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error('Max reconnection attempts reached')
        this.emit('connection', { status: 'failed', error: error.message })
      }
    })

    // 重连成功
    this.socket.on('reconnect', (attemptNumber) => {
      console.log(`🔄 WebSocket reconnected after ${attemptNumber} attempts`)
      this.emit('connection', { status: 'reconnected', attempts: attemptNumber })
    })

    // 实时数据更新
    this.socket.on('realtime_update', (data: RealTimeUpdate) => {
      console.log('📨 Realtime update received:', data.type, data)
      this.emit('realtime_update', data)
      
      // 根据更新类型分发到具体的事件
      this.emit(data.type, data.payload)
    })

    // 系统通知
    this.socket.on('system_notification', (data: any) => {
      console.log('🔔 System notification:', data)
      this.emit('system_notification', data)
    })

    // 监控数据更新
    this.socket.on('monitoring_data', (data: any) => {
      this.emit('monitoring_data', data)
    })

    // 通话状态更新
    this.socket.on('call_update', (data: any) => {
      this.emit('call_update', data)
    })

    // 用户活动更新
    this.socket.on('user_activity', (data: any) => {
      this.emit('user_activity', data)
    })
  }

  // 订阅事件
  on(event: string, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback)
  }

  // 取消订阅事件
  off(event: string, callback?: Function): void {
    if (!this.listeners.has(event)) return

    if (callback) {
      this.listeners.get(event)!.delete(callback)
    } else {
      this.listeners.get(event)!.clear()
    }
  }

  // 发射事件到监听器
  private emit(event: string, data?: any): void {
    const eventListeners = this.listeners.get(event)
    if (eventListeners) {
      eventListeners.forEach(callback => {
        try {
          callback(data)
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error)
        }
      })
    }
  }

  // 发送消息到服务器
  send(event: string, data?: any): void {
    if (this.socket?.connected) {
      this.socket.emit(event, data)
    } else {
      console.warn('WebSocket not connected, message not sent:', event, data)
    }
  }

  // 加入房间（用于特定用户或管理员的消息）
  joinRoom(room: string): void {
    this.send('join_room', { room })
  }

  // 离开房间
  leaveRoom(room: string): void {
    this.send('leave_room', { room })
  }

  // 获取连接状态
  get connected(): boolean {
    return this.socket?.connected || false
  }

  // 获取Socket ID
  get socketId(): string | undefined {
    return this.socket?.id
  }
}

// 创建单例实例
export const wsService = new WebSocketService()

// React Hook 用于在组件中使用 WebSocket
export const useWebSocket = () => {
  return {
    connect: () => wsService.connect(),
    disconnect: () => wsService.disconnect(),
    on: (event: string, callback: Function) => wsService.on(event, callback),
    off: (event: string, callback?: Function) => wsService.off(event, callback),
    send: (event: string, data?: any) => wsService.send(event, data),
    joinRoom: (room: string) => wsService.joinRoom(room),
    leaveRoom: (room: string) => wsService.leaveRoom(room),
    connected: wsService.connected,
    socketId: wsService.socketId,
  }
}

export default wsService