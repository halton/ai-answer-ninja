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
  theme,
  Tabs,
  DatePicker,
  Select
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
  BulbOutlined,
  SoundOutlined,
  SecurityScanOutlined
} from '@ant-design/icons'
import ReactECharts from 'echarts-for-react'
import { useNavigate } from 'react-router-dom'
import { useWebSocket } from '@/services/websocket'
import { useAuthStore, useUIStore, useSystemStore } from '@/store'
import { motion } from 'framer-motion'
import MetricsCard from '@/components/ui/MetricsCard'
import AdvancedChart from '@/components/ui/AdvancedChart'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

const { Title, Text } = Typography
const { TabPane } = Tabs
const { RangePicker } = DatePicker

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

  // 生成图表数据
  const chartData = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = dayjs().subtract(6 - i, 'days')
      return {
        name: date.format('MM-DD'),
        calls: Math.floor(Math.random() * 200) + 50,
        blocked: Math.floor(Math.random() * 80) + 20,
        transferred: Math.floor(Math.random() * 30) + 5,
        timestamp: date.toISOString()
      }
    })
  }, [])

  return (
    <div className="p-6 min-h-screen bg-gray-50">
      {/* 页面标题和控制区 */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <Title level={2} className="text-gray-900 mb-1">实时监控面板</Title>
            <Text className="text-gray-600">
              欢迎回来，{user?.name || '管理员'}！
              <Badge 
                status={connected ? 'success' : 'error'} 
                text={connected ? '实时连接' : '连接断开'}
                className="ml-4"
              />
            </Text>
          </div>
          
          <Space>
            <RangePicker
              defaultValue={[dayjs().subtract(7, 'days'), dayjs()]}
              format="YYYY-MM-DD"
            />
            <Select defaultValue="realtime" style={{ width: 120 }}>
              <Select.Option value="realtime">实时</Select.Option>
              <Select.Option value="hourly">每小时</Select.Option>
              <Select.Option value="daily">每日</Select.Option>
            </Select>
            <Button 
              icon={<ReloadOutlined />}
              onClick={handleRefresh}
              loading={refreshing}
            >
              刷新
            </Button>
          </Space>
        </div>
      </div>

      <Tabs defaultActiveKey="overview" size="large">
        {/* 系统概览 */}
        <TabPane tab="系统概览" key="overview">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            {/* 核心指标卡片 */}
            <Row gutter={[24, 24]} className="mb-6">
              <Col xs={24} sm={12} lg={6}>
                <MetricsCard
                  title="总通话数"
                  value={dashboardStats.activeCalls + dashboardStats.blockedCalls}
                  icon={<PhoneOutlined />}
                  trend={{
                    value: dashboardStats.todayCallsGrowth,
                    period: '昨日'
                  }}
                  color="#1890ff"
                  loading={loading}
                  onClick={() => navigate('/calls')}
                />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricsCard
                  title="AI成功处理"
                  value={dashboardStats.aiResponses}
                  icon={<SoundOutlined />}
                  trend={{
                    value: dashboardStats.aiResponsesGrowth,
                    period: '昨日'
                  }}
                  progress={{
                    percent: (dashboardStats.aiResponses / (dashboardStats.activeCalls + dashboardStats.blockedCalls)) * 100,
                    showInfo: false
                  }}
                  color="#52c41a"
                  loading={loading}
                  onClick={() => navigate('/ai-config')}
                />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricsCard
                  title="拦截骚扰"
                  value={dashboardStats.blockedCalls}
                  icon={<SecurityScanOutlined />}
                  trend={{
                    value: dashboardStats.blockedCallsGrowth,
                    period: '昨日'
                  }}
                  color="#fa541c"
                  loading={loading}
                  onClick={() => navigate('/calls?status=blocked')}
                />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricsCard
                  title="活跃用户"
                  value={dashboardStats.totalUsers}
                  icon={<UserOutlined />}
                  trend={{
                    value: dashboardStats.activeUsersGrowth,
                    period: '昨日'
                  }}
                  color="#722ed1"
                  loading={loading}
                  onClick={() => navigate('/users')}
                />
              </Col>
            </Row>

            {/* 性能指标 */}
            <Row gutter={[24, 24]} className="mb-6">
              <Col xs={24} sm={12} lg={6}>
                <MetricsCard
                  title="平均响应时间"
                  value={liveMetrics.latency.current}
                  suffix="ms"
                  icon={<ClockCircleOutlined />}
                  status={liveMetrics.latency.current < 800 ? 'success' : 'warning'}
                  description={`目标: ${liveMetrics.latency.target}ms`}
                  loading={loading}
                />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricsCard
                  title="系统成功率"
                  value={dashboardStats.uptime}
                  suffix="%"
                  precision={1}
                  icon={<CheckCircleOutlined />}
                  status={dashboardStats.uptime > 99 ? 'success' : 'warning'}
                  progress={{
                    percent: dashboardStats.uptime,
                    strokeColor: dashboardStats.uptime > 99 ? '#52c41a' : '#faad14'
                  }}
                  loading={loading}
                />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricsCard
                  title="AI效能指数"
                  value={liveMetrics.quality.userSatisfaction * 100}
                  suffix="%"
                  precision={1}
                  icon={<DashboardOutlined />}
                  status={liveMetrics.quality.userSatisfaction > 0.85 ? 'success' : 'warning'}
                  description="用户满意度评分"
                  loading={loading}
                />
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <MetricsCard
                  title="系统健康"
                  value={systemHealth?.status === 'healthy' ? '正常' : systemHealth?.status === 'warning' ? '警告' : '异常'}
                  icon={<HeartOutlined />}
                  status={
                    systemHealth?.status === 'healthy' ? 'success' :
                    systemHealth?.status === 'warning' ? 'warning' : 'error'
                  }
                  loading={isLoadingHealth}
                  onClick={() => navigate('/monitoring')}
                />
              </Col>
            </Row>

            {/* 图表区域 */}
            <Row gutter={[24, 24]}>
              <Col xs={24} lg={16}>
                <AdvancedChart
                  type="line"
                  title="通话趋势分析"
                  subtitle="最近7天通话数据变化"
                  data={chartData}
                  series={[
                    { key: 'calls', name: '总通话', color: '#1890ff' },
                    { key: 'blocked', name: '拦截数', color: '#f5222d' },
                    { key: 'transferred', name: '转接数', color: '#52c41a' }
                  ]}
                  xAxisKey="name"
                  height={350}
                  loading={loading}
                  onFullscreen={() => navigate('/analytics')}
                />
              </Col>
              <Col xs={24} lg={8}>
                <AdvancedChart
                  type="donut"
                  title="通话处理分布"
                  subtitle="AI处理效果统计"
                  data={[
                    { name: 'AI处理', value: dashboardStats.aiResponses },
                    { name: '拦截骚扰', value: dashboardStats.blockedCalls },
                    { name: '直接转接', value: dashboardStats.activeCalls }
                  ]}
                  height={350}
                  loading={loading}
                />
              </Col>
            </Row>

            {/* 最近活动 */}
            <Row gutter={[24, 24]} className="mt-6">
              <Col xs={24} lg={12}>
                <Card 
                  title="系统资源" 
                  extra={<Button size="small" onClick={() => navigate('/monitoring')}>详细监控</Button>}
                >
                  <Space direction="vertical" style={{ width: '100%' }} size="large">
                    <div>
                      <div className="flex justify-between mb-2">
                        <Text>CPU使用率</Text>
                        <Text>{liveMetrics.resources.cpuUsage}%</Text>
                      </div>
                      <Progress percent={liveMetrics.resources.cpuUsage} strokeColor="#52c41a" />
                    </div>
                    
                    <div>
                      <div className="flex justify-between mb-2">
                        <Text>内存使用</Text>
                        <Text>{liveMetrics.resources.memoryUsage}%</Text>
                      </div>
                      <Progress percent={liveMetrics.resources.memoryUsage} strokeColor="#1890ff" />
                    </div>
                    
                    <div>
                      <div className="flex justify-between mb-2">
                        <Text>磁盘使用</Text>
                        <Text>{liveMetrics.resources.diskUsage}%</Text>
                      </div>
                      <Progress percent={liveMetrics.resources.diskUsage} strokeColor="#faad14" />
                    </div>
                    
                    <div>
                      <div className="flex justify-between mb-2">
                        <Text>网络延迟</Text>
                        <Text>{liveMetrics.resources.networkLatency}ms</Text>
                      </div>
                      <Progress 
                        percent={(liveMetrics.resources.networkLatency / 100) * 100} 
                        strokeColor="#722ed1"
                        format={() => '良好'}
                      />
                    </div>
                  </Space>
                </Card>
              </Col>

              <Col xs={24} lg={12}>
                <Card 
                  title="最近活动" 
                  extra={<Button size="small" onClick={() => navigate('/calls')}>查看全部</Button>}
                >
                  <List
                    dataSource={recentActivities}
                    renderItem={(item) => (
                      <List.Item className="py-3">
                        <List.Item.Meta
                          avatar={<Badge status={item.status as any} />}
                          title={<Text strong className="text-sm">{item.title}</Text>}
                          description={
                            <div>
                              <Text type="secondary" className="text-xs">
                                {item.description}
                              </Text>
                              <br />
                              <Text type="secondary" className="text-xs">
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
          </motion.div>
        </TabPane>

        {/* 实时监控 */}
        <TabPane tab="实时监控" key="realtime">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <Alert
              message="实时监控功能"
              description="实时通话状态监控、AI处理性能追踪等高级功能正在开发中..."
              type="info"
              showIcon
              className="mb-6"
            />
            
            <Row gutter={[24, 24]}>
              <Col span={24}>
                <Card title="实时通话流">
                  <div className="h-64 flex items-center justify-center">
                    <div className="text-center">
                      <SyncOutlined className="text-4xl text-blue-500 mb-4" spin />
                      <p className="text-gray-500">实时数据流可视化开发中...</p>
                    </div>
                  </div>
                </Card>
              </Col>
            </Row>
          </motion.div>
        </TabPane>

        {/* 系统分析 */}
        <TabPane tab="系统分析" key="analytics">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <Row gutter={[24, 24]}>
              <Col xs={24} lg={12}>
                <AdvancedChart
                  type="pie"
                  title="骚扰电话类型分布"
                  data={[
                    { name: '推销电话', value: 45 },
                    { name: '贷款推广', value: 32 },
                    { name: '投资理财', value: 18 },
                    { name: '保险销售', value: 12 },
                    { name: '其他', value: 8 }
                  ]}
                  height={350}
                />
              </Col>
              <Col xs={24} lg={12}>
                <AdvancedChart
                  type="bar"
                  title="每日拦截效果"
                  data={chartData.map(item => ({
                    name: item.name,
                    value: item.blocked
                  }))}
                  height={350}
                />
              </Col>
            </Row>
          </motion.div>
        </TabPane>
      </Tabs>
    </div>
  )
}

export default Dashboard