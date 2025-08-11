import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { 
  Card, 
  Row, 
  Col, 
  Statistic, 
  Progress, 
  List, 
  Badge, 
  Button, 
  Space, 
  Typography, 
  Spin,
  Alert,
  Tooltip,
  Tag,
  Divider,
  Grid,
  Flex,
  theme
} from 'antd'
import {
  PhoneOutlined,
  UserOutlined,
  SafetyOutlined,
  RobotOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  ReloadOutlined,
  EyeOutlined,
  ThunderboltOutlined,
  CloudServerOutlined,
  HeartOutlined,
  WifiOutlined,
  DisconnectOutlined,
  ClockCircleOutlined,
  TrophyOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  SyncOutlined,
  LineChartOutlined,
  DashboardOutlined,
  FireOutlined,
  BulbOutlined
} from '@ant-design/icons'
import ReactECharts from 'echarts-for-react'
import { useNavigate } from 'react-router-dom'
import { useWebSocket } from '@/services/websocket'
import { useAuthStore, useUIStore, useSystemStore } from '@/store'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

const { Title, Text } = Typography

const Dashboard: React.FC = () => {
  const navigate = useNavigate()
  const { token: antdToken } = theme.useToken()
  const { useBreakpoint } = Grid
  const screens = useBreakpoint()
  
  const { user } = useAuthStore()
  const { 
    darkMode, 
    addNotification, 
    setPageTitle,
    isMobile,
    isOnline 
  } = useUIStore()
  const {
    systemHealth,
    serviceList,
    performanceMetrics,
    fetchSystemHealth,
    fetchPerformanceMetrics,
    isLoadingHealth,
    isLoadingMetrics
  } = useSystemStore()
  const { connected, socketId, on, off } = useWebSocket()
  
  const [loading, setLoading] = useState(true)
  const [realTimeData, setRealTimeData] = useState<any>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  
  // 仪表盘统计数据
  const [dashboardStats, setDashboardStats] = useState({
    totalUsers: 156,
    activeCalls: 12,
    blockedCalls: 89,
    aiResponses: 234,
    todayCallsGrowth: 12.5,
    activeUsersGrowth: -3.2,
    blockedCallsGrowth: 8.7,
    aiResponsesGrowth: 15.3,
    averageResponseTime: 485,
    cacheHitRate: 87.3,
    systemHealth: 'excellent',
    errorRate: 0.12,
    uptime: 99.8,
    satisfaction: 4.6
  })

  // 实时性能指标
  const [liveMetrics, setLiveMetrics] = useState({
    latency: {
      current: 485,
      target: 800,
      trend: 'improving',
      breakdown: {
        preprocessing: 35,
        stt: 145,
        aiGeneration: 220,
        tts: 85
      }
    },
    throughput: {
      callsPerMinute: 2.3,
      messagesPerSecond: 45,
      concurrentUsers: 28,
      peakConcurrent: 156
    },
    resources: {
      cpuUsage: 45,
      memoryUsage: 62,
      diskUsage: 34,
      networkLatency: 12
    },
    quality: {
      audioQuality: 0.95,
      recognitionAccuracy: 0.97,
      responseRelevance: 0.89,
      userSatisfaction: 0.92
    }
  })

  // 设置页面标题
  useEffect(() => {
    setPageTitle('仪表盘')
    return () => setPageTitle('')
  }, [setPageTitle])

  // 初始化数据
  useEffect(() => {
    const initDashboard = async () => {
      try {
        setLoading(true)
        
        // 并行获取系统健康状态和性能指标
        await Promise.all([
          fetchSystemHealth(),
          fetchPerformanceMetrics('1h')
        ])
        
        // 模拟其他数据加载
        await new Promise(resolve => setTimeout(resolve, 800))
        
        addNotification({
          type: 'success',
          title: '仪表盘加载完成',
          message: '系统数据已更新',
          duration: 3000
        })
        
      } catch (error) {
        addNotification({
          type: 'error',
          title: '数据加载失败',
          message: '请检查网络连接并刷新页面',
          duration: 0
        })
      } finally {
        setLoading(false)
      }
    }

    initDashboard()
  }, [fetchSystemHealth, fetchPerformanceMetrics, addNotification])

  // 自动刷新数据
  useEffect(() => {
    if (!autoRefresh) return

    const interval = setInterval(async () => {
      try {
        await Promise.all([
          fetchSystemHealth(),
          fetchPerformanceMetrics('1h')
        ])
        
        // 模拟更新统计数据
        setDashboardStats(prev => ({
          ...prev,
          activeCalls: Math.max(0, prev.activeCalls + Math.floor(Math.random() * 10 - 5)),
          aiResponses: prev.aiResponses + Math.floor(Math.random() * 5),
          averageResponseTime: 400 + Math.floor(Math.random() * 200)
        }))
        
      } catch (error) {
        console.error('Auto refresh failed:', error)
      }
    }, 30000) // 30秒刷新一次

    return () => clearInterval(interval)
  }, [autoRefresh, fetchSystemHealth, fetchPerformanceMetrics])

  // 监听实时数据更新
  useEffect(() => {
    const handleRealtimeUpdate = (data: any) => {
      setRealTimeData(data)
      console.log('📊 Real-time update:', data)
    }

    const handleCallUpdate = (data: any) => {
      console.log('📞 Call update:', data)
      // 更新通话统计
      setDashboardStats(prev => ({
        ...prev,
        activeCalls: data.activeCalls || prev.activeCalls,
        blockedCalls: data.blockedCalls || prev.blockedCalls
      }))
    }

    const handleUserActivity = (data: any) => {
      console.log('👤 User activity:', data)
      // 更新用户活动
    }

    const handleMetricsUpdate = (data: any) => {
      console.log('📈 Metrics update:', data)
      setLiveMetrics(prev => ({
        ...prev,
        ...data
      }))
    }

    // 注册事件监听器
    on('realtime_update', handleRealtimeUpdate)
    on('call_update', handleCallUpdate) 
    on('user_activity', handleUserActivity)
    on('metrics_update', handleMetricsUpdate)

    return () => {
      off('realtime_update', handleRealtimeUpdate)
      off('call_update', handleCallUpdate)
      off('user_activity', handleUserActivity)
      off('metrics_update', handleMetricsUpdate)
    }
  }, [on, off])

  // 手动刷新数据
  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([
        fetchSystemHealth(),
        fetchPerformanceMetrics('1h')
      ])
      
      addNotification({
        type: 'success',
        title: '数据已刷新',
        message: '仪表盘数据已更新到最新状态',
        duration: 2000
      })
    } catch (error) {
      addNotification({
        type: 'error',
        title: '刷新失败',
        message: '无法获取最新数据，请检查网络连接',
        duration: 5000
      })
    } finally {
      setRefreshing(false)
    }
  }, [fetchSystemHealth, fetchPerformanceMetrics, addNotification])

  // 统计卡片数据
  const statsCards = [
    {
      title: '总用户数',
      value: dashboardStats.totalUsers,
      growth: dashboardStats.activeUsersGrowth,
      icon: <UserOutlined />,
      color: '#1890ff',
      path: '/users'
    },
    {
      title: '今日通话',
      value: dashboardStats.activeCalls,
      growth: dashboardStats.todayCallsGrowth,
      icon: <PhoneOutlined />,
      color: '#52c41a',
      path: '/calls'
    },
    {
      title: '拦截骚扰',
      value: dashboardStats.blockedCalls,
      growth: dashboardStats.blockedCallsGrowth,
      icon: <SafetyOutlined />,
      color: '#faad14',
      path: '/calls?status=blocked'
    },
    {
      title: 'AI响应',
      value: dashboardStats.aiResponses,
      growth: dashboardStats.aiResponsesGrowth,
      icon: <RobotOutlined />,
      color: '#722ed1',
      path: '/ai-config'
    },
  ]

  // 通话趋势图表配置
  const callTrendOption = {
    title: {
      text: '通话趋势',
      textStyle: { fontSize: 16, fontWeight: 'normal' }
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' }
    },
    legend: {
      data: ['总通话', '成功拦截', 'AI处理']
    },
    xAxis: {
      type: 'category',
      data: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00']
    },
    yAxis: {
      type: 'value'
    },
    series: [
      {
        name: '总通话',
        type: 'line',
        smooth: true,
        data: [12, 8, 15, 25, 45, 32, 28]
      },
      {
        name: '成功拦截',
        type: 'line',
        smooth: true,
        data: [8, 5, 12, 18, 35, 25, 22]
      },
      {
        name: 'AI处理',
        type: 'line',
        smooth: true,
        data: [6, 4, 10, 15, 28, 20, 18]
      }
    ]
  }

  // 骚扰类型分布饼图配置
  const spamDistributionOption = {
    title: {
      text: '骚扰类型分布',
      textStyle: { fontSize: 16, fontWeight: 'normal' }
    },
    tooltip: {
      trigger: 'item',
      formatter: '{a} <br/>{b}: {c} ({d}%)'
    },
    series: [
      {
        name: '骚扰类型',
        type: 'pie',
        radius: ['40%', '70%'],
        data: [
          { value: 45, name: '推销电话' },
          { value: 32, name: '贷款推广' },
          { value: 18, name: '投资理财' },
          { value: 12, name: '保险销售' },
          { value: 8, name: '其他' }
        ]
      }
    ]
  }

  // 最近活动列表
  const recentActivities = [
    {
      id: '1',
      type: 'call_blocked',
      title: '拦截推销电话',
      description: '来自 138****5678 的推销电话已被成功拦截',
      time: '2分钟前',
      status: 'success'
    },
    {
      id: '2',
      type: 'ai_response',
      title: 'AI自动应答',
      description: 'AI成功处理来自 150****9012 的来电',
      time: '5分钟前',
      status: 'processing'
    },
    {
      id: '3',
      type: 'user_added',
      title: '新用户注册',
      description: '用户 张三 完成了账号注册',
      time: '10分钟前',
      status: 'default'
    },
    {
      id: '4',
      type: 'whitelist_updated',
      title: '白名单更新',
      description: '用户添加了 5 个新的白名单联系人',
      time: '15分钟前',
      status: 'default'
    }
  ]

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh'
      }}>
        <Spin size="large" tip="正在加载仪表盘..." />
      </div>
    )
  }

  return (
    <div className="page-container fade-in">
      {/* 页面标题 */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <Title level={4} className="page-title">
              仪表盘
            </Title>
            <Text className="page-description">
              欢迎回来，{user?.name || '管理员'}！ 系统运行正常
              <Badge 
                status={connected ? 'success' : 'error'} 
                text={connected ? '实时连接' : '连接断开'}
                style={{ marginLeft: 16 }}
              />
            </Text>
          </div>
          
          <Button 
            icon={<ReloadOutlined />}
            onClick={() => window.location.reload()}
          >
            刷新数据
          </Button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="stats-grid">
        {statsCards.map((card, index) => (
          <Card
            key={index}
            className="stats-card"
            hoverable
            onClick={() => navigate(card.path)}
            style={{ cursor: 'pointer' }}
          >
            <div className="stats-content">
              <div className="stats-info">
                <div className="stats-value">
                  {card.value.toLocaleString()}
                </div>
                <div className="stats-label">
                  {card.title}
                </div>
                <div className={`stats-trend ${card.growth >= 0 ? 'positive' : 'negative'}`}>
                  {card.growth >= 0 ? (
                    <ArrowUpOutlined className="trend-icon" />
                  ) : (
                    <ArrowDownOutlined className="trend-icon" />
                  )}
                  {Math.abs(card.growth)}%
                </div>
              </div>
              <div 
                className="stats-icon" 
                style={{ color: card.color }}
              >
                {card.icon}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* 图表和活动 */}
      <Row gutter={24}>
        {/* 通话趋势图 */}
        <Col xs={24} lg={16}>
          <Card 
            title="实时监控" 
            extra={
              <Space>
                <Button size="small" onClick={() => navigate('/monitoring')}>
                  <EyeOutlined /> 详细监控
                </Button>
              </Space>
            }
          >
            <ReactECharts 
              option={callTrendOption} 
              style={{ height: 300 }}
            />
          </Card>
        </Col>

        {/* 系统状态 */}
        <Col xs={24} lg={8}>
          <Card title="系统状态">
            <Space direction="vertical" style={{ width: '100%' }} size="large">
              <div>
                <div style={{ marginBottom: 8 }}>
                  <Text>CPU使用率</Text>
                  <Text style={{ float: 'right' }}>45%</Text>
                </div>
                <Progress percent={45} strokeColor="#52c41a" />
              </div>
              
              <div>
                <div style={{ marginBottom: 8 }}>
                  <Text>内存使用</Text>
                  <Text style={{ float: 'right' }}>62%</Text>
                </div>
                <Progress percent={62} strokeColor="#1890ff" />
              </div>
              
              <div>
                <div style={{ marginBottom: 8 }}>
                  <Text>AI响应速度</Text>
                  <Text style={{ float: 'right' }}>优秀</Text>
                </div>
                <Progress percent={85} strokeColor="#722ed1" />
              </div>
              
              <div>
                <div style={{ marginBottom: 8 }}>
                  <Text>系统稳定性</Text>
                  <Text style={{ float: 'right' }}>99.9%</Text>
                </div>
                <Progress percent={99.9} strokeColor="#52c41a" />
              </div>
            </Space>
          </Card>
        </Col>
      </Row>

      <Row gutter={24} style={{ marginTop: 24 }}>
        {/* 骚扰类型分布 */}
        <Col xs={24} lg={12}>
          <Card title="骚扰类型分布">
            <ReactECharts 
              option={spamDistributionOption} 
              style={{ height: 300 }}
            />
          </Card>
        </Col>

        {/* 最近活动 */}
        <Col xs={24} lg={12}>
          <Card 
            title="最近活动" 
            extra={
              <Button size="small" onClick={() => navigate('/calls')}>
                查看全部
              </Button>
            }
          >
            <List
              dataSource={recentActivities}
              renderItem={(item) => (
                <List.Item style={{ padding: '12px 0' }}>
                  <List.Item.Meta
                    avatar={<Badge status={item.status as any} />}
                    title={
                      <Text strong style={{ fontSize: 14 }}>
                        {item.title}
                      </Text>
                    }
                    description={
                      <div>
                        <Text type="secondary" style={{ fontSize: 13 }}>
                          {item.description}
                        </Text>
                        <br />
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {item.time}
                        </Text>
                      </div>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
    </div>
  )
}

export default Dashboard