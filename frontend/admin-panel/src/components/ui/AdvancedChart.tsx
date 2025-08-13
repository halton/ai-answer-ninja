import React, { useMemo } from 'react'
import { Card, Spin, Empty, Space, Button, Dropdown } from 'antd'
import {
  DownloadOutlined,
  FullscreenOutlined,
  MoreOutlined
} from '@ant-design/icons'
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts'
import { motion } from 'framer-motion'

export type ChartType = 'line' | 'area' | 'bar' | 'pie' | 'donut'

export interface ChartDataPoint {
  [key: string]: any
  name?: string
  value?: number
  timestamp?: string
}

export interface ChartSeries {
  key: string
  name: string
  color?: string
  type?: ChartType
}

export interface AdvancedChartProps {
  type: ChartType
  title?: string
  subtitle?: string
  data: ChartDataPoint[]
  series?: ChartSeries[]
  xAxisKey?: string
  yAxisKey?: string
  loading?: boolean
  height?: number
  showGrid?: boolean
  showLegend?: boolean
  showTooltip?: boolean
  colors?: string[]
  className?: string
  onExport?: () => void
  onFullscreen?: () => void
  customTooltip?: (active: boolean, payload: any[], label: string) => React.ReactNode
}

const defaultColors = [
  '#1890ff', '#52c41a', '#faad14', '#f5222d', '#722ed1',
  '#13c2c2', '#eb2f96', '#fa541c', '#a0d911', '#2f54eb'
]

const AdvancedChart: React.FC<AdvancedChartProps> = ({
  type,
  title,
  subtitle,
  data,
  series = [],
  xAxisKey = 'name',
  yAxisKey = 'value',
  loading = false,
  height = 400,
  showGrid = true,
  showLegend = true,
  showTooltip = true,
  colors = defaultColors,
  className = '',
  onExport,
  onFullscreen,
  customTooltip
}) => {

  // 处理数据格式
  const processedData = useMemo(() => {
    if (!data || data.length === 0) return []
    
    // 确保数据有正确的结构
    return data.map(item => ({
      ...item,
      [xAxisKey]: item[xAxisKey] || item.name || item.timestamp,
      [yAxisKey]: item[yAxisKey] || item.value || 0
    }))
  }, [data, xAxisKey, yAxisKey])

  // 自定义 Tooltip
  const renderTooltip = (active: boolean, payload: any[], label: string) => {
    if (customTooltip) {
      return customTooltip(active, payload, label)
    }

    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 shadow-lg rounded-lg border">
          <p className="font-medium text-gray-900">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} style={{ color: entry.color }}>
              {`${entry.name}: ${entry.value}`}
            </p>
          ))}
        </div>
      )
    }
    return null
  }

  // 渲染不同类型的图表
  const renderChart = () => {
    if (processedData.length === 0) {
      return <Empty description="暂无数据" />
    }

    const commonProps = {
      data: processedData,
      margin: { top: 5, right: 30, left: 20, bottom: 5 }
    }

    switch (type) {
      case 'line':
        return (
          <LineChart {...commonProps}>
            {showGrid && <CartesianGrid strokeDasharray="3 3" />}
            <XAxis dataKey={xAxisKey} />
            <YAxis />
            {showTooltip && <Tooltip content={renderTooltip as any} />}
            {showLegend && <Legend />}
            {series.length > 0 ? (
              series.map((s, index) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.name}
                  stroke={s.color || colors[index % colors.length]}
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
              ))
            ) : (
              <Line
                type="monotone"
                dataKey={yAxisKey}
                stroke={colors[0]}
                strokeWidth={2}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
            )}
          </LineChart>
        )

      case 'area':
        return (
          <AreaChart {...commonProps}>
            {showGrid && <CartesianGrid strokeDasharray="3 3" />}
            <XAxis dataKey={xAxisKey} />
            <YAxis />
            {showTooltip && <Tooltip content={renderTooltip as any} />}
            {showLegend && <Legend />}
            {series.length > 0 ? (
              series.map((s, index) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.name}
                  stackId="1"
                  stroke={s.color || colors[index % colors.length]}
                  fill={s.color || colors[index % colors.length]}
                  fillOpacity={0.6}
                />
              ))
            ) : (
              <Area
                type="monotone"
                dataKey={yAxisKey}
                stroke={colors[0]}
                fill={colors[0]}
                fillOpacity={0.6}
              />
            )}
          </AreaChart>
        )

      case 'bar':
        return (
          <BarChart {...commonProps}>
            {showGrid && <CartesianGrid strokeDasharray="3 3" />}
            <XAxis dataKey={xAxisKey} />
            <YAxis />
            {showTooltip && <Tooltip content={renderTooltip as any} />}
            {showLegend && <Legend />}
            {series.length > 0 ? (
              series.map((s, index) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.name}
                  fill={s.color || colors[index % colors.length]}
                />
              ))
            ) : (
              <Bar
                dataKey={yAxisKey}
                fill={colors[0]}
              />
            )}
          </BarChart>
        )

      case 'pie':
      case 'donut':
        return (
          <PieChart>
            <Pie
              data={processedData}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              outerRadius={type === 'donut' ? 120 : 140}
              innerRadius={type === 'donut' ? 60 : 0}
              fill="#8884d8"
              dataKey={yAxisKey}
            >
              {processedData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={colors[index % colors.length]}
                />
              ))}
            </Pie>
            {showTooltip && <Tooltip content={renderTooltip as any} />}
            {showLegend && <Legend />}
          </PieChart>
        )

      default:
        return <Empty description="不支持的图表类型" />
    }
  }

  // 操作菜单
  const actionItems = [
    onExport && {
      key: 'export',
      icon: <DownloadOutlined />,
      label: '导出图片',
      onClick: onExport
    },
    onFullscreen && {
      key: 'fullscreen',
      icon: <FullscreenOutlined />,
      label: '全屏查看',
      onClick: onFullscreen
    }
  ].filter(Boolean)

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card
        title={
          <div>
            {title && <div className="text-lg font-semibold">{title}</div>}
            {subtitle && <div className="text-sm text-gray-500">{subtitle}</div>}
          </div>
        }
        extra={
          actionItems.length > 0 && (
            <Space>
              {actionItems.length === 1 ? (
                <Button
                  type="text"
                  icon={actionItems[0]?.icon}
                  onClick={actionItems[0]?.onClick}
                />
              ) : (
                <Dropdown
                  menu={{ items: actionItems }}
                  placement="bottomRight"
                >
                  <Button type="text" icon={<MoreOutlined />} />
                </Dropdown>
              )}
            </Space>
          )
        }
        className={`shadow-sm ${className}`}
        bodyStyle={{ padding: '20px' }}
      >
        <Spin spinning={loading} size="large">
          <div style={{ height, width: '100%' }}>
            <ResponsiveContainer>
              {renderChart()}
            </ResponsiveContainer>
          </div>
        </Spin>
      </Card>
    </motion.div>
  )
}

export default AdvancedChart