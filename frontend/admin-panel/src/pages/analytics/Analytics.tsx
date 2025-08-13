import React, { useState, useEffect } from 'react'
import {
  Card,
  Row,
  Col,
  Statistic,
  Select,
  DatePicker,
  Space,
  Typography,
  Table,
  Tag,
  Progress,
  Button,
  Tooltip,
  Badge,
  Divider,
  List,
  Avatar
} from 'antd'
import {
  BarChartOutlined,
  LineChartOutlined,
  PieChartOutlined,
  TrendingUpOutlined,
  TrendingDownOutlined,
  PhoneOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  ExclamationCircleOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  UserOutlined,
  PercentageOutlined,
  DownloadOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import ReactECharts from 'echarts-for-react'
import dayjs from 'dayjs'
import type { ColumnsType } from 'antd/es/table'

const { RangePicker } = DatePicker
const { Option } = Select
const { Text, Title } = Typography

// 分析数据类型
interface AnalyticsData {
  overview: {
    totalCalls: number
    spamCalls: number
    normalCalls: number
    averageHandleTime: number
    successRate: number
    costSavings: number
  }
  trends: {
    daily: Array<{
      date: string
      calls: number
      spamCalls: number
      successRate: number
    }>
    hourly: Array<{
      hour: number
      calls: number
      avgResponseTime: number
    }>
  }
  spamAnalysis: {
    categories: Array<{
      category: string
      count: number
      percentage: number
      trend: 'up' | 'down' | 'stable'
    }>
    sources: Array<{
      source: string
      count: number
      blockRate: number
    }>
  }
  performance: {
    aiMetrics: {
      intentAccuracy: number
      responseQuality: number
      userSatisfaction: number
      learningProgress: number
    }
    systemMetrics: {
      avgResponseTime: number
      uptime: number
      errorRate: number
      throughput: number
    }
  }
  topUsers: Array<{
    userId: string
    userName: string
    totalCalls: number
    spamBlocked: number
    savings: number
    lastActivity: string
  }>
}

interface ComparisonData {
  period: string
  current: number
  previous: number
  change: number
  changePercent: number
}

const Analytics: React.FC = () => {
  const [timeRange, setTimeRange] = useState('7d')
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null)
  const [comparisonPeriod, setComparisonPeriod] = useState('previous_period')

  // 查询分析数据
  const { data: analyticsData, isLoading, refetch } = useQuery({
    queryKey: ['analytics', timeRange, dateRange],
    queryFn: async () => {
      await new Promise(resolve => setTimeout(resolve, 1000))
      return generateMockAnalyticsData()
    }
  })

  // 通话趋势图表配置
  const callTrendOption = {
    title: { text: '通话趋势分析', left: 'center' },
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0 },
    xAxis: {
      type: 'category',
      data: analyticsData?.trends.daily.map(item => dayjs(item.date).format('MM/DD')) || []
    },
    yAxis: [
      { type: 'value', name: '通话数量', position: 'left' },
      { type: 'value', name: '成功率 (%)', position: 'right', max: 100 }
    ],
    series: [
      {
        name: '总通话',
        type: 'line',
        data: analyticsData?.trends.daily.map(item => item.calls) || [],
        lineStyle: { color: '#1890ff' }
      },
      {
        name: '骚扰电话',
        type: 'line',
        data: analyticsData?.trends.daily.map(item => item.spamCalls) || [],
        lineStyle: { color: '#ff4d4f' }
      },
      {
        name: '成功率',
        type: 'line',
        yAxisIndex: 1,
        data: analyticsData?.trends.daily.map(item => item.successRate) || [],
        lineStyle: { color: '#52c41a' }
      }
    ]
  }

  // 骚扰电话分类饼图
  const spamCategoryOption = {
    title: { text: '骚扰电话分类分布', left: 'center' },
    tooltip: { trigger: 'item', formatter: '{a} <br/>{b}: {c} ({d}%)' },
    series: [{
      name: '骚扰分类',
      type: 'pie',
      radius: ['40%', '70%'],
      data: analyticsData?.spamAnalysis.categories.map(item => ({
        value: item.count,
        name: item.category
      })) || [],
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowOffsetX: 0,
          shadowColor: 'rgba(0, 0, 0, 0.5)'
        }
      }
    }]
  }

  // 每小时通话分布
  const hourlyDistributionOption = {
    title: { text: '每小时通话分布', left: 'center' },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: Array.from({ length: 24 }, (_, i) => `${i}:00`)
    },
    yAxis: { type: 'value', name: '通话数量' },
    series: [{
      name: '通话数量',
      type: 'bar',
      data: analyticsData?.trends.hourly.map(item => item.calls) || [],
      itemStyle: { color: '#1890ff' }
    }]
  }

  // AI性能雷达图
  const aiPerformanceOption = {
    title: { text: 'AI性能指标', left: 'center' },
    tooltip: {},
    radar: {
      indicator: [
        { name: '意图识别准确率', max: 100 },
        { name: '回复质量', max: 100 },
        { name: '用户满意度', max: 100 },
        { name: '学习进度', max: 100 }
      ]
    },
    series: [{
      name: 'AI性能',
      type: 'radar',
      data: [{
        value: [
          analyticsData?.performance.aiMetrics.intentAccuracy || 0,
          analyticsData?.performance.aiMetrics.responseQuality || 0,
          analyticsData?.performance.aiMetrics.userSatisfaction || 0,
          analyticsData?.performance.aiMetrics.learningProgress || 0
        ],
        name: '当前性能'
      }]
    }]
  }

  // 顶级用户表格列
  const topUsersColumns: ColumnsType<any> = [
    {
      title: '用户',
      dataIndex: 'userName',
      key: 'userName',
      render: (name: string, record: any) => (
        <Space>
          <Avatar icon={<UserOutlined />} size="small" />
          <div>
            <div>{name}</div>
            <Text type="secondary" style={{ fontSize: '12px' }}>
              ID: {record.userId}
            </Text>
          </div>
        </Space>
      )
    },
    {
      title: '总通话数',
      dataIndex: 'totalCalls',
      key: 'totalCalls',
      sorter: true,
      render: (calls: number) => <Text strong>{calls}</Text>
    },
    {
      title: '拦截骚扰',
      dataIndex: 'spamBlocked',
      key: 'spamBlocked',
      sorter: true,
      render: (blocked: number, record: any) => (
        <Space direction="vertical" size="small">
          <Text strong style={{ color: '#52c41a' }}>{blocked}</Text>
          <Progress
            percent={Math.round((blocked / record.totalCalls) * 100)}
            size="small"
            showInfo={false}
          />
        </Space>
      )
    },
    {
      title: '节省成本',
      dataIndex: 'savings',
      key: 'savings',
      sorter: true,
      render: (savings: number) => (
        <Text strong style={{ color: '#1890ff' }}>¥{savings}</Text>
      )
    },
    {
      title: '最后活动',
      dataIndex: 'lastActivity',
      key: 'lastActivity',
      render: (time: string) => (
        <Text type="secondary">{dayjs(time).fromNow()}</Text>
      )
    }
  ]

  // 计算对比数据
  const calculateComparison = (current: number, previous: number): ComparisonData => {
    const change = current - previous
    const changePercent = previous > 0 ? (change / previous) * 100 : 0
    
    return {
      period: '对比上期',
      current,
      previous,
      change,
      changePercent
    }
  }

  // 导出报告
  const handleExportReport = () => {
    const link = document.createElement('a')
    link.href = '/api/analytics/export'
    link.download = `analytics_report_${dayjs().format('YYYY-MM-DD')}.pdf`
    link.click()
  }

  return (
    <div className="analytics">
      {/* 控制栏 */}
      <Card style={{ marginBottom: 16 }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Space>
              <Text strong>数据分析</Text>
              <Select
                value={timeRange}
                onChange={setTimeRange}
                style={{ width: 120 }}
              >
                <Option value="1d">今天</Option>
                <Option value="7d">最近7天</Option>
                <Option value="30d">最近30天</Option>
                <Option value="90d">最近90天</Option>
                <Option value="custom">自定义</Option>
              </Select>
              {timeRange === 'custom' && (
                <RangePicker
                  value={dateRange}
                  onChange={setDateRange}
                />
              )}
            </Space>
          </Col>
          <Col>
            <Space>
              <Button icon={<DownloadOutlined />} onClick={handleExportReport}>
                导出报告
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
                刷新
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 概览统计 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={4}>
          <Card>
            <Statistic
              title="总通话数"
              value={analyticsData?.overview.totalCalls || 0}
              prefix={<PhoneOutlined />}
              suffix={
                <Tooltip title="较上期增长12%">
                  <TrendingUpOutlined style={{ color: '#52c41a', fontSize: '14px' }} />
                </Tooltip>
              }
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic
              title="骚扰拦截"
              value={analyticsData?.overview.spamCalls || 0}
              prefix={<SafetyCertificateOutlined />}
              valueStyle={{ color: '#cf1322' }}
              suffix={
                <Tooltip title="较上期增长8%">
                  <TrendingUpOutlined style={{ color: '#52c41a', fontSize: '14px' }} />
                </Tooltip>
              }
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic
              title="AI成功率"
              value={analyticsData?.overview.successRate || 0}
              suffix="%"
              prefix={<RobotOutlined />}
              valueStyle={{ color: '#3f8600' }}
              suffix={
                <span>
                  % <TrendingUpOutlined style={{ color: '#52c41a', fontSize: '14px' }} />
                </span>
              }
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic
              title="平均处理时长"
              value={analyticsData?.overview.averageHandleTime || 0}
              suffix="秒"
              prefix={<ClockCircleOutlined />}
              suffix={
                <span>
                  秒 <TrendingDownOutlined style={{ color: '#52c41a', fontSize: '14px' }} />
                </span>
              }
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic
              title="节省成本"
              value={analyticsData?.overview.costSavings || 0}
              prefix="¥"
              valueStyle={{ color: '#1890ff' }}
              suffix={
                <Tooltip title="较上期节省更多">
                  <TrendingUpOutlined style={{ color: '#52c41a', fontSize: '14px' }} />
                </Tooltip>
              }
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic
              title="正常通话"
              value={analyticsData?.overview.normalCalls || 0}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 图表分析 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={16}>
          <Card>
            <ReactECharts option={callTrendOption} style={{ height: '400px' }} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <ReactECharts option={spamCategoryOption} style={{ height: '400px' }} />
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Card>
            <ReactECharts option={hourlyDistributionOption} style={{ height: '350px' }} />
          </Card>
        </Col>
        <Col span={12}>
          <Card>
            <ReactECharts option={aiPerformanceOption} style={{ height: '350px' }} />
          </Card>
        </Col>
      </Row>

      {/* 详细分析 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Card title="骚扰电话分析" extra={<ExclamationCircleOutlined />}>
            <Space direction="vertical" style={{ width: '100%' }}>
              {analyticsData?.spamAnalysis.categories.map((category, index) => (
                <div key={index} style={{ padding: '8px 0' }}>
                  <Row justify="space-between" align="middle">
                    <Col>
                      <Space>
                        <Text strong>{category.category}</Text>
                        <Tag color={
                          category.trend === 'up' ? 'red' :
                          category.trend === 'down' ? 'green' : 'blue'
                        }>
                          {category.trend === 'up' ? '↗ 上升' :
                           category.trend === 'down' ? '↘ 下降' : '→ 稳定'}
                        </Tag>
                      </Space>
                    </Col>
                    <Col>
                      <Text type="secondary">{category.count} 次</Text>
                    </Col>
                  </Row>
                  <Progress
                    percent={category.percentage}
                    showInfo={true}
                    size="small"
                    strokeColor={
                      category.percentage > 50 ? '#ff4d4f' :
                      category.percentage > 30 ? '#faad14' : '#52c41a'
                    }
                  />
                </div>
              ))}
            </Space>
          </Card>
        </Col>

        <Col span={12}>
          <Card title="系统性能指标" extra={<BarChartOutlined />}>
            <Row gutter={16}>
              <Col span={12}>
                <Statistic
                  title="平均响应时间"
                  value={analyticsData?.performance.systemMetrics.avgResponseTime || 0}
                  suffix="ms"
                  valueStyle={{
                    color: (analyticsData?.performance.systemMetrics.avgResponseTime || 0) > 1000 ? '#cf1322' : '#3f8600'
                  }}
                />
                <Progress
                  percent={Math.min((analyticsData?.performance.systemMetrics.avgResponseTime || 0) / 20, 100)}
                  showInfo={false}
                  strokeColor="#1890ff"
                />
              </Col>
              <Col span={12}>
                <Statistic
                  title="系统正常运行时间"
                  value={analyticsData?.performance.systemMetrics.uptime || 0}
                  suffix="%"
                  valueStyle={{ color: '#3f8600' }}
                />
                <Progress
                  percent={analyticsData?.performance.systemMetrics.uptime || 0}
                  showInfo={false}
                  strokeColor="#52c41a"
                />
              </Col>
            </Row>
            
            <Divider />
            
            <Row gutter={16}>
              <Col span={12}>
                <Statistic
                  title="错误率"
                  value={analyticsData?.performance.systemMetrics.errorRate || 0}
                  suffix="%"
                  valueStyle={{
                    color: (analyticsData?.performance.systemMetrics.errorRate || 0) > 5 ? '#cf1322' : '#3f8600'
                  }}
                />
              </Col>
              <Col span={12}>
                <Statistic
                  title="吞吐量"
                  value={analyticsData?.performance.systemMetrics.throughput || 0}
                  suffix="req/s"
                  valueStyle={{ color: '#1890ff' }}
                />
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      {/* 用户排行 */}
      <Row gutter={16}>
        <Col span={24}>
          <Card title="用户使用排行" extra={<UserOutlined />}>
            <Table<any>
              columns={topUsersColumns}
              dataSource={analyticsData?.topUsers || []}
              loading={isLoading}
              rowKey="userId"
              pagination={{ pageSize: 10 }}
              size="small"
            />
          </Card>
        </Col>
      </Row>
    </div>
  )
}

// 生成模拟分析数据
function generateMockAnalyticsData(): AnalyticsData {
  const now = dayjs()
  
  // 生成每日趋势数据
  const dailyTrends = Array.from({ length: 30 }, (_, i) => {
    const date = now.subtract(29 - i, 'day')
    const baseCalls = Math.floor(Math.random() * 50) + 100
    const spamCalls = Math.floor(baseCalls * (Math.random() * 0.4 + 0.3))
    
    return {
      date: date.format('YYYY-MM-DD'),
      calls: baseCalls,
      spamCalls,
      successRate: Math.floor(Math.random() * 20) + 80
    }
  })

  // 生成每小时分布数据
  const hourlyTrends = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    calls: Math.floor(Math.random() * 30) + (hour >= 9 && hour <= 18 ? 50 : 10),
    avgResponseTime: Math.floor(Math.random() * 500) + 300
  }))

  const totalCalls = dailyTrends.reduce((sum, day) => sum + day.calls, 0)
  const totalSpamCalls = dailyTrends.reduce((sum, day) => sum + day.spamCalls, 0)
  const normalCalls = totalCalls - totalSpamCalls

  return {
    overview: {
      totalCalls,
      spamCalls: totalSpamCalls,
      normalCalls,
      averageHandleTime: Math.floor(Math.random() * 60) + 120,
      successRate: Math.floor(Math.random() * 10) + 85,
      costSavings: Math.floor(Math.random() * 5000) + 10000
    },
    trends: {
      daily: dailyTrends,
      hourly: hourlyTrends
    },
    spamAnalysis: {
      categories: [
        { category: '销售推广', count: 156, percentage: 35, trend: 'up' },
        { category: '贷款理财', count: 134, percentage: 30, trend: 'stable' },
        { category: '房产中介', count: 89, percentage: 20, trend: 'down' },
        { category: '保险销售', count: 45, percentage: 10, trend: 'up' },
        { category: '其他骚扰', count: 22, percentage: 5, trend: 'stable' }
      ],
      sources: [
        { source: '400电话', count: 89, blockRate: 92 },
        { source: '固定电话', count: 156, blockRate: 88 },
        { source: '手机号码', count: 201, blockRate: 85 }
      ]
    },
    performance: {
      aiMetrics: {
        intentAccuracy: Math.floor(Math.random() * 10) + 85,
        responseQuality: Math.floor(Math.random() * 15) + 80,
        userSatisfaction: Math.floor(Math.random() * 20) + 75,
        learningProgress: Math.floor(Math.random() * 25) + 70
      },
      systemMetrics: {
        avgResponseTime: Math.floor(Math.random() * 500) + 400,
        uptime: Math.floor(Math.random() * 5) + 95,
        errorRate: Math.random() * 3 + 1,
        throughput: Math.floor(Math.random() * 200) + 500
      }
    },
    topUsers: Array.from({ length: 15 }, (_, i) => ({
      userId: `user_${i + 1}`,
      userName: `用户${i + 1}`,
      totalCalls: Math.floor(Math.random() * 100) + 50,
      spamBlocked: Math.floor(Math.random() * 80) + 20,
      savings: Math.floor(Math.random() * 2000) + 500,
      lastActivity: now.subtract(Math.floor(Math.random() * 7), 'day').toISOString()
    }))
  }
}

export default Analytics