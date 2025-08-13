import React, { useState, useEffect, useRef } from 'react'
import {
  Card,
  Row,
  Col,
  Statistic,
  Progress,
  Table,
  Tag,
  Space,
  Alert,
  Button,
  Select,
  DatePicker,
  Typography,
  Badge,
  Tooltip,
  List,
  Avatar,
  Divider,
  Switch,
  Modal,
  notification
} from 'antd'
import {
  DashboardOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  ApiOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  ClockCircleOutlined,
  LineChartOutlined,
  SettingOutlined,
  ReloadOutlined,
  BellOutlined,
  HeartOutlined
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import ReactECharts from 'echarts-for-react'
import dayjs from 'dayjs'
import type { ColumnsType } from 'antd/es/table'

const { RangePicker } = DatePicker
const { Option } = Select
const { Text, Title } = Typography

// 系统监控数据类型
interface SystemMetrics {
  timestamp: string
  cpu: number
  memory: number
  disk: number
  network: {
    inbound: number
    outbound: number
  }
}

interface ServiceHealth {
  serviceName: string
  status: 'healthy' | 'warning' | 'error' | 'unknown'
  responseTime: number
  uptime: number
  lastCheck: string
  version: string
  endpoints: {
    name: string
    status: 'ok' | 'error'
    responseTime: number
  }[]
}

interface AlertItem {
  id: string
  level: 'critical' | 'warning' | 'info'
  service: string
  message: string
  timestamp: string
  resolved: boolean
  resolvedAt?: string
}

interface PerformanceMetric {
  name: string
  current: number
  target: number
  unit: string
  trend: 'up' | 'down' | 'stable'
  status: 'good' | 'warning' | 'critical'
}

const SystemMonitoring: React.FC = () => {
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [refreshInterval, setRefreshInterval] = useState(30) // 秒
  const [selectedTimeRange, setSelectedTimeRange] = useState('1h')
  const [alertModalVisible, setAlertModalVisible] = useState(false)
  const [selectedAlert, setSelectedAlert] = useState<AlertItem | null>(null)
  const intervalRef = useRef<NodeJS.Timeout>()

  // 查询系统指标
  const { data: systemData, isLoading, refetch } = useQuery({
    queryKey: ['systemMetrics', selectedTimeRange],
    queryFn: async () => {
      await new Promise(resolve => setTimeout(resolve, 1000))
      return {
        current: generateCurrentMetrics(),
        history: generateMetricsHistory(),
        services: generateServiceHealth(),
        alerts: generateAlerts(),
        performance: generatePerformanceMetrics()
      }
    },
    refetchInterval: autoRefresh ? refreshInterval * 1000 : false
  })

  // 自动刷新管理
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        refetch()
      }, refreshInterval * 1000)
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [autoRefresh, refreshInterval, refetch])

  // 服务状态配置
  const serviceStatusConfig = {
    healthy: { color: 'success', text: '正常' },
    warning: { color: 'warning', text: '警告' },
    error: { color: 'error', text: '异常' },
    unknown: { color: 'default', text: '未知' }
  }

  // 告警级别配置
  const alertLevelConfig = {
    critical: { color: 'red', icon: <ExclamationCircleOutlined />, text: '严重' },
    warning: { color: 'orange', icon: <WarningOutlined />, text: '警告' },
    info: { color: 'blue', icon: <CheckCircleOutlined />, text: '信息' }
  }

  // 服务健康表格列
  const serviceColumns: ColumnsType<ServiceHealth> = [
    {
      title: '服务名称',
      dataIndex: 'serviceName',
      key: 'serviceName',
      render: (name: string, record: ServiceHealth) => (
        <Space>
          <Badge 
            status={serviceStatusConfig[record.status].color as any} 
            text={name}
          />
          <Tag size="small">{record.version}</Tag>
        </Space>
      )
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const config = serviceStatusConfig[status as keyof typeof serviceStatusConfig]
        return <Badge status={config.color as any} text={config.text} />
      }
    },
    {
      title: '响应时间',
      dataIndex: 'responseTime',
      key: 'responseTime',
      render: (time: number) => (
        <Text type={time > 1000 ? 'danger' : time > 500 ? 'warning' : 'success'}>
          {time}ms
        </Text>
      )
    },
    {
      title: '运行时间',
      dataIndex: 'uptime',
      key: 'uptime',
      render: (uptime: number) => {
        const days = Math.floor(uptime / (24 * 60 * 60))
        const hours = Math.floor((uptime % (24 * 60 * 60)) / (60 * 60))
        return <Text>{days}天 {hours}小时</Text>
      }
    },
    {
      title: '最后检查',
      dataIndex: 'lastCheck',
      key: 'lastCheck',
      render: (time: string) => (
        <Text type="secondary">{dayjs(time).fromNow()}</Text>
      )
    }
  ]

  // CPU使用率图表配置
  const cpuChartOption = {
    title: { text: 'CPU使用率', left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: systemData?.history.map(item => dayjs(item.timestamp).format('HH:mm')) || []
    },
    yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
    series: [{
      data: systemData?.history.map(item => item.cpu) || [],
      type: 'line',
      smooth: true,
      areaStyle: { opacity: 0.3 },
      lineStyle: { color: '#1890ff' },
      areaStyle: { color: '#1890ff' }
    }]
  }

  // 内存使用率图表配置
  const memoryChartOption = {
    title: { text: '内存使用率', left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: systemData?.history.map(item => dayjs(item.timestamp).format('HH:mm')) || []
    },
    yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
    series: [{
      data: systemData?.history.map(item => item.memory) || [],
      type: 'line',
      smooth: true,
      areaStyle: { opacity: 0.3 },
      lineStyle: { color: '#52c41a' },
      areaStyle: { color: '#52c41a' }
    }]
  }

  // 网络流量图表配置
  const networkChartOption = {
    title: { text: '网络流量', left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0 },
    xAxis: {
      type: 'category',
      data: systemData?.history.map(item => dayjs(item.timestamp).format('HH:mm')) || []
    },
    yAxis: { type: 'value', axisLabel: { formatter: '{value} MB/s' } },
    series: [
      {
        name: '入站',
        data: systemData?.history.map(item => item.network.inbound) || [],
        type: 'line',
        smooth: true,
        lineStyle: { color: '#1890ff' }
      },
      {
        name: '出站',
        data: systemData?.history.map(item => item.network.outbound) || [],
        type: 'line',
        smooth: true,
        lineStyle: { color: '#52c41a' }
      }
    ]
  }

  // 处理告警点击
  const handleAlertClick = (alert: AlertItem) => {
    setSelectedAlert(alert)
    setAlertModalVisible(true)
  }

  // 处理告警解决
  const handleResolveAlert = async (alertId: string) => {
    // 模拟API调用
    await new Promise(resolve => setTimeout(resolve, 500))
    notification.success({
      message: '告警已解决',
      description: '告警状态已更新'
    })
    refetch()
  }

  return (
    <div className="system-monitoring">
      {/* 控制栏 */}
      <Card style={{ marginBottom: 16 }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Space>
              <Text strong>系统监控</Text>
              <Switch
                checked={autoRefresh}
                onChange={setAutoRefresh}
                checkedChildren="自动刷新"
                unCheckedChildren="手动刷新"
              />
              {autoRefresh && (
                <Select
                  value={refreshInterval}
                  onChange={setRefreshInterval}
                  style={{ width: 100 }}
                >
                  <Option value={10}>10秒</Option>
                  <Option value={30}>30秒</Option>
                  <Option value={60}>1分钟</Option>
                  <Option value={300}>5分钟</Option>
                </Select>
              )}
            </Space>
          </Col>
          <Col>
            <Space>
              <Select
                value={selectedTimeRange}
                onChange={setSelectedTimeRange}
                style={{ width: 120 }}
              >
                <Option value="1h">最近1小时</Option>
                <Option value="6h">最近6小时</Option>
                <Option value="24h">最近24小时</Option>
                <Option value="7d">最近7天</Option>
              </Select>
              <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
                刷新
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 系统概览 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="CPU使用率"
              value={systemData?.current.cpu || 0}
              suffix="%"
              prefix={<DashboardOutlined />}
              valueStyle={{ 
                color: (systemData?.current.cpu || 0) > 80 ? '#cf1322' : 
                       (systemData?.current.cpu || 0) > 60 ? '#faad14' : '#3f8600' 
              }}
            />
            <Progress
              percent={systemData?.current.cpu || 0}
              showInfo={false}
              strokeColor={(systemData?.current.cpu || 0) > 80 ? '#cf1322' : 
                         (systemData?.current.cpu || 0) > 60 ? '#faad14' : '#3f8600'}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="内存使用率"
              value={systemData?.current.memory || 0}
              suffix="%"
              prefix={<DatabaseOutlined />}
              valueStyle={{ 
                color: (systemData?.current.memory || 0) > 80 ? '#cf1322' : 
                       (systemData?.current.memory || 0) > 60 ? '#faad14' : '#3f8600' 
              }}
            />
            <Progress
              percent={systemData?.current.memory || 0}
              showInfo={false}
              strokeColor={(systemData?.current.memory || 0) > 80 ? '#cf1322' : 
                         (systemData?.current.memory || 0) > 60 ? '#faad14' : '#3f8600'}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="磁盘使用率"
              value={systemData?.current.disk || 0}
              suffix="%"
              prefix={<CloudServerOutlined />}
              valueStyle={{ 
                color: (systemData?.current.disk || 0) > 80 ? '#cf1322' : 
                       (systemData?.current.disk || 0) > 60 ? '#faad14' : '#3f8600' 
              }}
            />
            <Progress
              percent={systemData?.current.disk || 0}
              showInfo={false}
              strokeColor={(systemData?.current.disk || 0) > 80 ? '#cf1322' : 
                         (systemData?.current.disk || 0) > 60 ? '#faad14' : '#3f8600'}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="活跃连接数"
              value={Math.floor(Math.random() * 1000) + 500}
              prefix={<ApiOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
            <div style={{ marginTop: 8 }}>
              <Text type="secondary">
                入站: {systemData?.current.network.inbound || 0} MB/s
              </Text>
              <br />
              <Text type="secondary">
                出站: {systemData?.current.network.outbound || 0} MB/s
              </Text>
            </div>
          </Card>
        </Col>
      </Row>

      {/* 性能指标 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={24}>
          <Card title="关键性能指标" extra={<LineChartOutlined />}>
            <Row gutter={16}>
              {systemData?.performance.map((metric, index) => (
                <Col span={6} key={index}>
                  <Card size="small">
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text strong>{metric.name}</Text>
                        <Tag color={
                          metric.status === 'good' ? 'green' :
                          metric.status === 'warning' ? 'orange' : 'red'
                        }>
                          {metric.status === 'good' ? '正常' :
                           metric.status === 'warning' ? '警告' : '严重'}
                        </Tag>
                      </div>
                      <div>
                        <Text style={{ fontSize: '18px', fontWeight: 'bold' }}>
                          {metric.current} {metric.unit}
                        </Text>
                        <Text type="secondary" style={{ marginLeft: 8 }}>
                          / {metric.target} {metric.unit}
                        </Text>
                      </div>
                      <Progress
                        percent={Math.round((metric.current / metric.target) * 100)}
                        showInfo={false}
                        strokeColor={
                          metric.status === 'good' ? '#52c41a' :
                          metric.status === 'warning' ? '#faad14' : '#ff4d4f'
                        }
                      />
                    </Space>
                  </Card>
                </Col>
              ))}
            </Row>
          </Card>
        </Col>
      </Row>

      {/* 图表展示 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card>
            <ReactECharts option={cpuChartOption} style={{ height: '300px' }} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <ReactECharts option={memoryChartOption} style={{ height: '300px' }} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <ReactECharts option={networkChartOption} style={{ height: '300px' }} />
          </Card>
        </Col>
      </Row>

      {/* 服务健康状态和告警 */}
      <Row gutter={16}>
        <Col span={14}>
          <Card title="服务健康状态" extra={<HeartOutlined />}>
            <Table<ServiceHealth>
              columns={serviceColumns}
              dataSource={systemData?.services || []}
              loading={isLoading}
              rowKey="serviceName"
              pagination={false}
              size="small"
            />
          </Card>
        </Col>
        <Col span={10}>
          <Card 
            title="系统告警" 
            extra={
              <Space>
                <Badge count={systemData?.alerts.filter(a => !a.resolved).length || 0}>
                  <BellOutlined />
                </Badge>
              </Space>
            }
          >
            <List
              size="small"
              dataSource={systemData?.alerts.slice(0, 6) || []}
              renderItem={(alert: AlertItem) => (
                <List.Item
                  actions={[
                    !alert.resolved && (
                      <Button
                        type="link"
                        size="small"
                        onClick={() => handleResolveAlert(alert.id)}
                      >
                        解决
                      </Button>
                    ),
                    <Button
                      type="link"
                      size="small"
                      onClick={() => handleAlertClick(alert)}
                    >
                      详情
                    </Button>
                  ].filter(Boolean)}
                  style={{
                    opacity: alert.resolved ? 0.6 : 1,
                    textDecoration: alert.resolved ? 'line-through' : 'none'
                  }}
                >
                  <List.Item.Meta
                    avatar={
                      <Avatar
                        size="small"
                        style={{
                          backgroundColor: alertLevelConfig[alert.level].color,
                          fontSize: '12px'
                        }}
                        icon={alertLevelConfig[alert.level].icon}
                      />
                    }
                    title={
                      <Space>
                        <Text strong>{alert.service}</Text>
                        <Tag size="small" color={alertLevelConfig[alert.level].color}>
                          {alertLevelConfig[alert.level].text}
                        </Tag>
                      </Space>
                    }
                    description={
                      <div>
                        <div>{alert.message}</div>
                        <Text type="secondary" style={{ fontSize: '12px' }}>
                          {dayjs(alert.timestamp).fromNow()}
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

      {/* 告警详情模态框 */}
      <Modal
        title="告警详情"
        open={alertModalVisible}
        onCancel={() => setAlertModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setAlertModalVisible(false)}>
            关闭
          </Button>,
          selectedAlert && !selectedAlert.resolved && (
            <Button
              key="resolve"
              type="primary"
              onClick={() => {
                handleResolveAlert(selectedAlert.id)
                setAlertModalVisible(false)
              }}
            >
              标记为已解决
            </Button>
          )
        ].filter(Boolean)}
      >
        {selectedAlert && (
          <div>
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <Text strong>告警级别：</Text>
                <Tag color={alertLevelConfig[selectedAlert.level].color}>
                  {alertLevelConfig[selectedAlert.level].text}
                </Tag>
              </div>
              <div>
                <Text strong>服务名称：</Text>
                <Text>{selectedAlert.service}</Text>
              </div>
              <div>
                <Text strong>告警信息：</Text>
                <Text>{selectedAlert.message}</Text>
              </div>
              <div>
                <Text strong>发生时间：</Text>
                <Text>{dayjs(selectedAlert.timestamp).format('YYYY-MM-DD HH:mm:ss')}</Text>
              </div>
              <div>
                <Text strong>状态：</Text>
                <Badge
                  status={selectedAlert.resolved ? 'success' : 'error'}
                  text={selectedAlert.resolved ? '已解决' : '未解决'}
                />
              </div>
              {selectedAlert.resolved && selectedAlert.resolvedAt && (
                <div>
                  <Text strong>解决时间：</Text>
                  <Text>{dayjs(selectedAlert.resolvedAt).format('YYYY-MM-DD HH:mm:ss')}</Text>
                </div>
              )}
            </Space>
          </div>
        )}
      </Modal>
    </div>
  )
}

// 生成当前指标数据
function generateCurrentMetrics() {
  return {
    cpu: Math.floor(Math.random() * 40) + 20,
    memory: Math.floor(Math.random() * 30) + 40,
    disk: Math.floor(Math.random() * 20) + 50,
    network: {
      inbound: Math.random() * 100 + 50,
      outbound: Math.random() * 80 + 30
    }
  }
}

// 生成历史指标数据
function generateMetricsHistory(): SystemMetrics[] {
  const history: SystemMetrics[] = []
  const now = dayjs()
  
  for (let i = 59; i >= 0; i--) {
    history.push({
      timestamp: now.subtract(i, 'minute').toISOString(),
      cpu: Math.floor(Math.random() * 40) + 20 + Math.sin(i / 10) * 15,
      memory: Math.floor(Math.random() * 30) + 40 + Math.cos(i / 8) * 10,
      disk: Math.floor(Math.random() * 20) + 50,
      network: {
        inbound: Math.random() * 100 + 50 + Math.sin(i / 15) * 30,
        outbound: Math.random() * 80 + 30 + Math.cos(i / 12) * 20
      }
    })
  }
  
  return history
}

// 生成服务健康数据
function generateServiceHealth(): ServiceHealth[] {
  const services = [
    'Phone Gateway Service',
    'Realtime Processor',
    'Conversation Engine',
    'User Management',
    'Smart Whitelist',
    'Profile Analytics',
    'Configuration Service',
    'Storage Service',
    'Monitoring Service'
  ]

  return services.map((service, index) => {
    const status = Math.random() > 0.8 ? 'warning' : Math.random() > 0.95 ? 'error' : 'healthy'
    const responseTime = status === 'error' ? Math.random() * 2000 + 1000 :
                        status === 'warning' ? Math.random() * 800 + 400 :
                        Math.random() * 300 + 50

    return {
      serviceName: service,
      status: status as any,
      responseTime: Math.round(responseTime),
      uptime: Math.floor(Math.random() * 30) * 24 * 60 * 60 + Math.floor(Math.random() * 24) * 60 * 60,
      lastCheck: dayjs().subtract(Math.floor(Math.random() * 5), 'minute').toISOString(),
      version: `v1.${index + 1}.0`,
      endpoints: [
        { name: 'health', status: 'ok', responseTime: Math.round(Math.random() * 100 + 20) },
        { name: 'metrics', status: Math.random() > 0.9 ? 'error' : 'ok', responseTime: Math.round(Math.random() * 150 + 30) }
      ]
    }
  })
}

// 生成告警数据
function generateAlerts(): AlertItem[] {
  const alerts: AlertItem[] = []
  const services = ['Phone Gateway', 'Realtime Processor', 'Database', 'Storage']
  const messages = [
    'CPU使用率超过85%',
    '内存使用率持续高于90%',
    '响应时间异常',
    '数据库连接池耗尽',
    '磁盘空间不足',
    '网络延迟过高'
  ]
  const levels = ['critical', 'warning', 'info']

  for (let i = 0; i < 10; i++) {
    const resolved = Math.random() > 0.6
    const timestamp = dayjs().subtract(Math.floor(Math.random() * 24), 'hour')
    
    alerts.push({
      id: `alert_${i + 1}`,
      level: levels[Math.floor(Math.random() * levels.length)] as any,
      service: services[Math.floor(Math.random() * services.length)],
      message: messages[Math.floor(Math.random() * messages.length)],
      timestamp: timestamp.toISOString(),
      resolved,
      resolvedAt: resolved ? timestamp.add(Math.floor(Math.random() * 2), 'hour').toISOString() : undefined
    })
  }

  return alerts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
}

// 生成性能指标数据
function generatePerformanceMetrics(): PerformanceMetric[] {
  return [
    {
      name: '请求响应时间',
      current: Math.floor(Math.random() * 200) + 150,
      target: 300,
      unit: 'ms',
      trend: 'stable',
      status: 'good'
    },
    {
      name: '并发连接数',
      current: Math.floor(Math.random() * 500) + 800,
      target: 1000,
      unit: '',
      trend: 'up',
      status: 'warning'
    },
    {
      name: '错误率',
      current: Math.random() * 2 + 0.1,
      target: 1,
      unit: '%',
      trend: 'down',
      status: 'good'
    },
    {
      name: '吞吐量',
      current: Math.floor(Math.random() * 200) + 500,
      target: 1000,
      unit: 'req/s',
      trend: 'stable',
      status: 'good'
    }
  ]
}

export default SystemMonitoring