import React, { useState, useEffect, useMemo } from 'react'
import {
  Card,
  Row,
  Col,
  Tabs,
  Progress,
  Badge,
  Table,
  Tag,
  Alert,
  Space,
  Button,
  Tooltip,
  Timeline,
  List,
  Typography,
  Statistic,
  Divider
} from 'antd'
import {
  ServerOutlined,
  DatabaseOutlined,
  ApiOutlined,
  CloudServerOutlined,
  MonitorOutlined,
  ThunderboltOutlined,
  ExclamationCircleOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ReloadOutlined,
  WarningOutlined,
  BugOutlined,
  SafetyOutlined,
  DashboardOutlined,
  HeartOutlined
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import AdvancedChart from '@/components/ui/AdvancedChart'
import MetricsCard from '@/components/ui/MetricsCard'
import { useWebSocket } from '@/services/websocket'
import { usePerformanceMonitor, useNetworkMonitor } from '@/hooks/usePerformanceMonitor'
import dayjs from 'dayjs'

const { TabPane } = Tabs
const { Title, Text } = Typography

interface ServiceHealth {
  name: string
  status: 'healthy' | 'warning' | 'critical' | 'offline'
  uptime: number
  responseTime: number
  errorRate: number
  version: string
  lastChecked: string
  dependencies: string[]
  metrics: {
    cpu: number
    memory: number
    disk: number
    network: number
  }
  alerts: Array<{
    level: 'info' | 'warning' | 'error'
    message: string
    timestamp: string
  }>
}

interface SystemMetrics {
  timestamp: string
  cpu: number
  memory: number
  disk: number
  network: {
    in: number
    out: number
  }
  requests: number
  errors: number
  activeConnections: number
}

const SystemMonitoringEnhanced: React.FC = () => {
  const [activeTab, setActiveTab] = useState('overview')
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  
  // 性能监控
  const { getMetrics } = usePerformanceMonitor({
    componentName: 'SystemMonitoring',
    enabled: true,
    trackMemory: true,
    trackFPS: true
  })

  const { networkInfo, isSlowConnection } = useNetworkMonitor()
  const { socket } = useWebSocket()

  // 模拟服务健康数据
  const [services, setServices] = useState<ServiceHealth[]>([
    {
      name: 'Phone Gateway',
      status: 'healthy',
      uptime: 99.8,
      responseTime: 45,
      errorRate: 0.1,
      version: '1.2.3',
      lastChecked: dayjs().subtract(30, 'seconds').toISOString(),
      dependencies: ['Redis', 'PostgreSQL', 'Azure Communication Services'],
      metrics: { cpu: 25, memory: 60, disk: 35, network: 15 },
      alerts: []
    },
    {
      name: 'Realtime Processor',
      status: 'warning',
      uptime: 97.5,
      responseTime: 120,
      errorRate: 2.3,
      version: '1.1.8',
      lastChecked: dayjs().subtract(15, 'seconds').toISOString(),
      dependencies: ['WebSocket Server', 'Azure Speech Services'],
      metrics: { cpu: 75, memory: 85, disk: 20, network: 45 },
      alerts: [
        {
          level: 'warning',
          message: 'Memory usage is high (85%)',
          timestamp: dayjs().subtract(5, 'minutes').toISOString()
        }
      ]
    },
    {
      name: 'Conversation Engine',
      status: 'healthy',
      uptime: 99.9,
      responseTime: 85,
      errorRate: 0.05,
      version: '2.0.1',
      lastChecked: dayjs().subtract(10, 'seconds').toISOString(),
      dependencies: ['Azure OpenAI', 'Redis Cache'],
      metrics: { cpu: 40, memory: 55, disk: 15, network: 25 },
      alerts: []
    },
    {
      name: 'User Management',
      status: 'critical',
      uptime: 89.2,
      responseTime: 450,
      errorRate: 8.7,
      version: '1.0.5',
      lastChecked: dayjs().subtract(2, 'minutes').toISOString(),
      dependencies: ['PostgreSQL', 'Redis'],
      metrics: { cpu: 95, memory: 92, disk: 80, network: 60 },
      alerts: [
        {
          level: 'error',
          message: 'Service is experiencing high load',
          timestamp: dayjs().subtract(10, 'minutes').toISOString()
        },
        {
          level: 'error',
          message: 'Database connection timeout',
          timestamp: dayjs().subtract(15, 'minutes').toISOString()
        }
      ]
    },
    {
      name: 'Profile Analytics',
      status: 'healthy',
      uptime: 98.7,
      responseTime: 95,
      errorRate: 0.8,
      version: '1.3.2',
      lastChecked: dayjs().subtract(45, 'seconds').toISOString(),
      dependencies: ['ML Pipeline', 'Data Storage'],
      metrics: { cpu: 50, memory: 70, disk: 40, network: 30 },
      alerts: []
    }
  ])

  // 系统指标历史数据
  const [metricsHistory, setMetricsHistory] = useState<SystemMetrics[]>([])

  // 生成模拟指标数据
  useEffect(() => {
    const generateMetrics = () => {
      const now = dayjs()
      const data: SystemMetrics[] = []
      
      for (let i = 23; i >= 0; i--) {
        data.push({
          timestamp: now.subtract(i, 'hours').toISOString(),
          cpu: Math.floor(Math.random() * 40) + 30,
          memory: Math.floor(Math.random() * 30) + 50,
          disk: Math.floor(Math.random() * 20) + 20,
          network: {
            in: Math.floor(Math.random() * 100) + 50,
            out: Math.floor(Math.random() * 80) + 30
          },
          requests: Math.floor(Math.random() * 1000) + 500,
          errors: Math.floor(Math.random() * 20) + 5,
          activeConnections: Math.floor(Math.random() * 100) + 200
        })
      }
      
      setMetricsHistory(data)
    }

    generateMetrics()
  }, [])

  // 实时更新
  useEffect(() => {
    if (!autoRefresh) return

    const interval = setInterval(() => {
      // 模拟服务状态更新
      setServices(prev => prev.map(service => ({
        ...service,
        responseTime: Math.max(20, service.responseTime + (Math.random() - 0.5) * 20),
        metrics: {
          ...service.metrics,
          cpu: Math.max(0, Math.min(100, service.metrics.cpu + (Math.random() - 0.5) * 10)),
          memory: Math.max(0, Math.min(100, service.metrics.memory + (Math.random() - 0.5) * 5))
        },
        lastChecked: dayjs().toISOString()
      })))

      // 添加新的系统指标
      setMetricsHistory(prev => {
        const newMetric: SystemMetrics = {
          timestamp: dayjs().toISOString(),
          cpu: Math.floor(Math.random() * 40) + 30,
          memory: Math.floor(Math.random() * 30) + 50,
          disk: Math.floor(Math.random() * 20) + 20,
          network: {
            in: Math.floor(Math.random() * 100) + 50,
            out: Math.floor(Math.random() * 80) + 30
          },
          requests: Math.floor(Math.random() * 1000) + 500,
          errors: Math.floor(Math.random() * 20) + 5,
          activeConnections: Math.floor(Math.random() * 100) + 200
        }
        
        return [...prev.slice(-23), newMetric]
      })
    }, 5000) // 5秒更新一次

    return () => clearInterval(interval)
  }, [autoRefresh])

  // 计算整体系统状态
  const systemOverall = useMemo(() => {
    const totalServices = services.length
    const healthyServices = services.filter(s => s.status === 'healthy').length
    const warningServices = services.filter(s => s.status === 'warning').length
    const criticalServices = services.filter(s => s.status === 'critical').length
    
    const avgUptime = services.reduce((sum, s) => sum + s.uptime, 0) / totalServices
    const avgResponseTime = services.reduce((sum, s) => sum + s.responseTime, 0) / totalServices
    const totalAlerts = services.reduce((sum, s) => sum + s.alerts.length, 0)

    let overallStatus: 'healthy' | 'warning' | 'critical' = 'healthy'
    if (criticalServices > 0) {
      overallStatus = 'critical'
    } else if (warningServices > 0) {
      overallStatus = 'warning'
    }

    return {
      status: overallStatus,
      totalServices,
      healthyServices,
      warningServices,
      criticalServices,
      avgUptime,
      avgResponseTime,
      totalAlerts
    }
  }, [services])

  // 服务表格列配置
  const serviceColumns = [
    {
      title: '服务名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: ServiceHealth) => (
        <Space>
          <Badge 
            status={
              record.status === 'healthy' ? 'success' :
              record.status === 'warning' ? 'warning' :
              record.status === 'critical' ? 'error' : 'default'
            } 
          />
          <Text strong>{name}</Text>
          <Tag size="small">{record.version}</Tag>
        </Space>
      )
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const statusConfig = {
          healthy: { color: 'success', text: '正常' },
          warning: { color: 'warning', text: '警告' },
          critical: { color: 'error', text: '严重' },
          offline: { color: 'default', text: '离线' }
        }
        const config = statusConfig[status as keyof typeof statusConfig]
        return <Tag color={config.color}>{config.text}</Tag>
      }
    },
    {
      title: '运行时间',
      dataIndex: 'uptime',
      key: 'uptime',
      render: (uptime: number) => (
        <Progress 
          percent={uptime} 
          size="small" 
          format={() => `${uptime.toFixed(1)}%`}
          strokeColor={uptime > 95 ? '#52c41a' : uptime > 90 ? '#faad14' : '#ff4d4f'}
        />
      )
    },
    {
      title: '响应时间',
      dataIndex: 'responseTime',
      key: 'responseTime',
      render: (time: number) => (
        <Text type={time > 200 ? 'danger' : time > 100 ? 'warning' : 'success'}>
          {time}ms
        </Text>
      )
    },
    {
      title: '错误率',
      dataIndex: 'errorRate',
      key: 'errorRate',
      render: (rate: number) => (
        <Text type={rate > 5 ? 'danger' : rate > 1 ? 'warning' : 'success'}>
          {rate.toFixed(2)}%
        </Text>
      )
    },
    {
      title: '资源使用',
      key: 'resources',
      render: (_: any, record: ServiceHealth) => (
        <Space direction="vertical" size="small">
          <div className="flex items-center space-x-2">
            <Text style={{ fontSize: '12px', width: '30px' }}>CPU</Text>
            <Progress 
              percent={record.metrics.cpu} 
              size="small" 
              showInfo={false}
              strokeColor={record.metrics.cpu > 80 ? '#ff4d4f' : '#52c41a'}
            />
            <Text style={{ fontSize: '12px' }}>{record.metrics.cpu}%</Text>
          </div>
          <div className="flex items-center space-x-2">
            <Text style={{ fontSize: '12px', width: '30px' }}>MEM</Text>
            <Progress 
              percent={record.metrics.memory} 
              size="small" 
              showInfo={false}
              strokeColor={record.metrics.memory > 80 ? '#ff4d4f' : '#52c41a'}
            />
            <Text style={{ fontSize: '12px' }}>{record.metrics.memory}%</Text>
          </div>
        </Space>
      )
    },
    {
      title: '最后检查',
      dataIndex: 'lastChecked',
      key: 'lastChecked',
      render: (time: string) => (
        <Tooltip title={dayjs(time).format('YYYY-MM-DD HH:mm:ss')}>
          <Text type="secondary">{dayjs(time).fromNow()}</Text>
        </Tooltip>
      )
    },
    {
      title: '告警',
      key: 'alerts',
      render: (_: any, record: ServiceHealth) => (
        record.alerts.length > 0 ? (
          <Tooltip
            title={
              <div>
                {record.alerts.map((alert, index) => (
                  <div key={index} className="mb-1">
                    <Badge 
                      status={alert.level === 'error' ? 'error' : 'warning'} 
                      text={alert.message} 
                    />
                  </div>
                ))}
              </div>
            }
          >
            <Tag color="red">{record.alerts.length} 个告警</Tag>
          </Tooltip>
        ) : (
          <Text type="secondary">无告警</Text>
        )
      )
    }
  ]

  const chartData = metricsHistory.map(metric => ({
    time: dayjs(metric.timestamp).format('HH:mm'),
    CPU: metric.cpu,
    内存: metric.memory,
    磁盘: metric.disk,
    网络入: metric.network.in,
    网络出: metric.network.out,
    timestamp: metric.timestamp
  }))

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="p-6"
    >
      <div className="flex items-center justify-between mb-6">
        <div>
          <Title level={2}>系统监控</Title>
          <Text type="secondary">
            实时监控系统健康状态和性能指标
            {isSlowConnection && (
              <Tag color="orange" className="ml-2">网络较慢</Tag>
            )}
          </Text>
        </div>
        
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => setLoading(true)}
            loading={loading}
          >
            刷新数据
          </Button>
          <Button
            type={autoRefresh ? 'primary' : 'default'}
            icon={<MonitorOutlined />}
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh ? '停止自动刷新' : '启用自动刷新'}
          </Button>
        </Space>
      </div>

      <Tabs activeKey={activeTab} onChange={setActiveTab} size="large">
        {/* 系统概览 */}
        <TabPane tab="系统概览" key="overview">
          {/* 整体状态卡片 */}
          <Row gutter={[24, 24]} className="mb-6">
            <Col xs={24} sm={12} lg={6}>
              <MetricsCard
                title="系统状态"
                value={systemOverall.status === 'healthy' ? '正常' : systemOverall.status === 'warning' ? '警告' : '严重'}
                icon={<DashboardOutlined />}
                status={
                  systemOverall.status === 'healthy' ? 'success' :
                  systemOverall.status === 'warning' ? 'warning' : 'error'
                }
                description={`${systemOverall.healthyServices}/${systemOverall.totalServices} 服务正常`}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <MetricsCard
                title="平均响应时间"
                value={systemOverall.avgResponseTime}
                suffix="ms"
                precision={0}
                icon={<ThunderboltOutlined />}
                status={systemOverall.avgResponseTime > 200 ? 'warning' : 'success'}
                trend={{
                  value: 5.2,
                  isPositive: false,
                  period: '上小时'
                }}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <MetricsCard
                title="系统可用性"
                value={systemOverall.avgUptime}
                suffix="%"
                precision={1}
                icon={<HeartOutlined />}
                status={systemOverall.avgUptime > 99 ? 'success' : 'warning'}
                progress={{
                  percent: systemOverall.avgUptime,
                  strokeColor: systemOverall.avgUptime > 99 ? '#52c41a' : '#faad14'
                }}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <MetricsCard
                title="活跃告警"
                value={systemOverall.totalAlerts}
                icon={<ExclamationCircleOutlined />}
                status={systemOverall.totalAlerts > 0 ? 'error' : 'success'}
                color={systemOverall.totalAlerts > 0 ? '#ff4d4f' : '#52c41a'}
              />
            </Col>
          </Row>

          {/* 系统资源趋势图 */}
          <Row gutter={[24, 24]} className="mb-6">
            <Col span={24}>
              <AdvancedChart
                type="line"
                title="系统资源使用趋势"
                subtitle="最近24小时系统资源使用情况"
                data={chartData}
                series={[
                  { key: 'CPU', name: 'CPU使用率', color: '#1890ff' },
                  { key: '内存', name: '内存使用率', color: '#52c41a' },
                  { key: '磁盘', name: '磁盘使用率', color: '#faad14' }
                ]}
                xAxisKey="time"
                height={350}
                showGrid={true}
                showLegend={true}
              />
            </Col>
          </Row>

          {/* 网络流量图 */}
          <Row gutter={[24, 24]}>
            <Col xs={24} lg={12}>
              <AdvancedChart
                type="area"
                title="网络流量"
                subtitle="实时网络入站出站流量"
                data={chartData}
                series={[
                  { key: '网络入', name: '入站流量', color: '#52c41a' },
                  { key: '网络出', name: '出站流量', color: '#fa541c' }
                ]}
                xAxisKey="time"
                height={300}
              />
            </Col>
            <Col xs={24} lg={12}>
              <Card title="网络连接信息" className="h-full">
                <Space direction="vertical" size="middle" className="w-full">
                  <div className="flex justify-between">
                    <Text>连接类型:</Text>
                    <Tag color="blue">{networkInfo.effectiveType.toUpperCase()}</Tag>
                  </div>
                  <div className="flex justify-between">
                    <Text>下行带宽:</Text>
                    <Text>{networkInfo.downlink} Mbps</Text>
                  </div>
                  <div className="flex justify-between">
                    <Text>往返延迟:</Text>
                    <Text>{networkInfo.rtt} ms</Text>
                  </div>
                  <div className="flex justify-between">
                    <Text>节省流量:</Text>
                    <Badge 
                      status={networkInfo.saveData ? 'success' : 'default'} 
                      text={networkInfo.saveData ? '启用' : '未启用'} 
                    />
                  </div>
                  
                  <Divider />
                  
                  <div className="text-center">
                    <Statistic 
                      title="当前连接质量" 
                      value={isSlowConnection ? '较慢' : '良好'}
                      valueStyle={{ 
                        color: isSlowConnection ? '#fa541c' : '#52c41a' 
                      }}
                      prefix={
                        isSlowConnection ? 
                        <WarningOutlined /> : 
                        <CheckCircleOutlined />
                      }
                    />
                  </div>
                </Space>
              </Card>
            </Col>
          </Row>
        </TabPane>

        {/* 服务健康 */}
        <TabPane tab="服务健康" key="services">
          <Card>
            <Table
              dataSource={services}
              columns={serviceColumns}
              rowKey="name"
              loading={loading}
              pagination={false}
              size="middle"
              expandable={{
                expandedRowRender: (record: ServiceHealth) => (
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <Row gutter={[24, 16]}>
                      <Col xs={24} lg={12}>
                        <div className="mb-4">
                          <Title level={5}>依赖服务</Title>
                          <Space wrap>
                            {record.dependencies.map(dep => (
                              <Tag key={dep} color="blue">{dep}</Tag>
                            ))}
                          </Space>
                        </div>
                        
                        <div>
                          <Title level={5}>资源详情</Title>
                          <Row gutter={16}>
                            <Col span={12}>
                              <div className="mb-2">
                                <Text>CPU使用率</Text>
                                <Progress 
                                  percent={record.metrics.cpu} 
                                  strokeColor={record.metrics.cpu > 80 ? '#ff4d4f' : '#52c41a'} 
                                />
                              </div>
                              <div className="mb-2">
                                <Text>内存使用率</Text>
                                <Progress 
                                  percent={record.metrics.memory} 
                                  strokeColor={record.metrics.memory > 80 ? '#ff4d4f' : '#52c41a'} 
                                />
                              </div>
                            </Col>
                            <Col span={12}>
                              <div className="mb-2">
                                <Text>磁盘使用率</Text>
                                <Progress 
                                  percent={record.metrics.disk} 
                                  strokeColor={record.metrics.disk > 80 ? '#ff4d4f' : '#52c41a'} 
                                />
                              </div>
                              <div className="mb-2">
                                <Text>网络使用率</Text>
                                <Progress 
                                  percent={record.metrics.network} 
                                  strokeColor={record.metrics.network > 80 ? '#ff4d4f' : '#52c41a'} 
                                />
                              </div>
                            </Col>
                          </Row>
                        </div>
                      </Col>
                      
                      <Col xs={24} lg={12}>
                        {record.alerts.length > 0 ? (
                          <div>
                            <Title level={5}>告警信息</Title>
                            <Timeline size="small">
                              {record.alerts.map((alert, index) => (
                                <Timeline.Item
                                  key={index}
                                  color={alert.level === 'error' ? 'red' : 'orange'}
                                  dot={
                                    alert.level === 'error' ? 
                                    <BugOutlined /> : 
                                    <WarningOutlined />
                                  }
                                >
                                  <div>
                                    <Text>{alert.message}</Text>
                                    <br />
                                    <Text type="secondary" style={{ fontSize: '12px' }}>
                                      {dayjs(alert.timestamp).format('MM-DD HH:mm:ss')}
                                    </Text>
                                  </div>
                                </Timeline.Item>
                              ))}
                            </Timeline>
                          </div>
                        ) : (
                          <div className="text-center">
                            <CheckCircleOutlined 
                              style={{ fontSize: '48px', color: '#52c41a', marginBottom: '16px' }} 
                            />
                            <div>
                              <Text type="secondary">服务运行正常，无告警信息</Text>
                            </div>
                          </div>
                        )}
                      </Col>
                    </Row>
                  </div>
                ),
                expandIcon: ({ expanded, onExpand, record }) => (
                  <Button
                    type="text"
                    size="small"
                    icon={expanded ? <ClockCircleOutlined /> : <ServerOutlined />}
                    onClick={(e) => onExpand(record, e)}
                  />
                )
              }}
            />
          </Card>
        </TabPane>

        {/* 告警中心 */}
        <TabPane tab="告警中心" key="alerts">
          <Row gutter={[24, 24]}>
            <Col span={24}>
              <Alert
                message="系统告警概览"
                description={`当前共有 ${systemOverall.totalAlerts} 个活跃告警，其中 ${services.filter(s => s.alerts.some(a => a.level === 'error')).length} 个严重告警`}
                type={systemOverall.totalAlerts > 0 ? 'warning' : 'success'}
                showIcon
                className="mb-4"
              />
            </Col>
            
            <Col span={24}>
              <Card title="告警时间线">
                <Timeline>
                  {services.flatMap(service => 
                    service.alerts.map((alert, index) => ({
                      ...alert,
                      serviceName: service.name,
                      key: `${service.name}-${index}`
                    }))
                  ).sort((a, b) => dayjs(b.timestamp).unix() - dayjs(a.timestamp).unix())
                  .map(alert => (
                    <Timeline.Item
                      key={alert.key}
                      color={alert.level === 'error' ? 'red' : 'orange'}
                      dot={
                        alert.level === 'error' ? 
                        <ExclamationCircleOutlined /> : 
                        <WarningOutlined />
                      }
                    >
                      <div>
                        <Text strong>{alert.serviceName}</Text>
                        <br />
                        <Text>{alert.message}</Text>
                        <br />
                        <Text type="secondary">
                          {dayjs(alert.timestamp).format('YYYY-MM-DD HH:mm:ss')}
                        </Text>
                      </div>
                    </Timeline.Item>
                  ))}
                </Timeline>
              </Card>
            </Col>
          </Row>
        </TabPane>

        {/* 性能分析 */}
        <TabPane tab="性能分析" key="performance">
          <Row gutter={[24, 24]}>
            <Col xs={24} lg={12}>
              <Card title="请求处理性能">
                <div className="mb-4">
                  <Statistic
                    title="总请求数"
                    value={metricsHistory[metricsHistory.length - 1]?.requests || 0}
                    suffix="次"
                  />
                </div>
                <div className="mb-4">
                  <Statistic
                    title="错误数"
                    value={metricsHistory[metricsHistory.length - 1]?.errors || 0}
                    suffix="次"
                    valueStyle={{ color: '#cf1322' }}
                  />
                </div>
                <div>
                  <Statistic
                    title="活跃连接"
                    value={metricsHistory[metricsHistory.length - 1]?.activeConnections || 0}
                    suffix="个"
                    valueStyle={{ color: '#1890ff' }}
                  />
                </div>
              </Card>
            </Col>
            
            <Col xs={24} lg={12}>
              <Card title="组件性能指标">
                <Space direction="vertical" size="middle" className="w-full">
                  <div>
                    <Text>组件渲染次数: </Text>
                    <Text strong>{getMetrics().rerenderCount}</Text>
                  </div>
                  <div>
                    <Text>最后渲染时间: </Text>
                    <Text strong>{getMetrics().renderTime.toFixed(2)}ms</Text>
                  </div>
                  <div>
                    <Text>组件挂载时间: </Text>
                    <Text strong>{getMetrics().componentMountTime.toFixed(2)}ms</Text>
                  </div>
                  {getMetrics().memoryUsage && (
                    <div>
                      <Text>内存使用: </Text>
                      <Text strong>{(getMetrics().memoryUsage! / 1024 / 1024).toFixed(2)}MB</Text>
                    </div>
                  )}
                  {getMetrics().fps && (
                    <div>
                      <Text>当前FPS: </Text>
                      <Text strong>{getMetrics().fps}</Text>
                    </div>
                  )}
                </Space>
              </Card>
            </Col>
          </Row>
        </TabPane>
      </Tabs>
    </motion.div>
  )
}

export default SystemMonitoringEnhanced