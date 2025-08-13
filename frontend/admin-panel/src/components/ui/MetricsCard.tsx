import React from 'react'
import { Card, Statistic, Progress, Tag, Space } from 'antd'
import {
  ArrowUpOutlined,
  ArrowDownOutlined,
  MinusOutlined
} from '@ant-design/icons'
import { motion } from 'framer-motion'

export interface MetricsCardProps {
  title: string
  value: number | string
  suffix?: string
  prefix?: string
  precision?: number
  trend?: {
    value: number
    isPositive?: boolean
    period?: string
  }
  progress?: {
    percent: number
    strokeColor?: string
    showInfo?: boolean
  }
  status?: 'success' | 'warning' | 'error' | 'default'
  icon?: React.ReactNode
  description?: string
  extra?: React.ReactNode
  loading?: boolean
  className?: string
  color?: string
  onClick?: () => void
}

const MetricsCard: React.FC<MetricsCardProps> = ({
  title,
  value,
  suffix,
  prefix,
  precision,
  trend,
  progress,
  status = 'default',
  icon,
  description,
  extra,
  loading = false,
  className = '',
  color,
  onClick
}) => {
  // 状态颜色映射
  const getStatusColor = () => {
    switch (status) {
      case 'success': return '#52c41a'
      case 'warning': return '#faad14'
      case 'error': return '#f5222d'
      default: return '#1890ff'
    }
  }

  // 趋势图标
  const getTrendIcon = () => {
    if (!trend) return null
    
    const { value: trendValue, isPositive } = trend
    
    if (trendValue === 0) {
      return <MinusOutlined style={{ color: '#666' }} />
    }
    
    if (isPositive === undefined) {
      // 自动判断正负趋势
      const isGood = trendValue > 0
      return isGood 
        ? <ArrowUpOutlined style={{ color: '#52c41a' }} />
        : <ArrowDownOutlined style={{ color: '#f5222d' }} />
    }
    
    // 明确指定正负趋势
    return isPositive
      ? <ArrowUpOutlined style={{ color: '#52c41a' }} />
      : <ArrowDownOutlined style={{ color: '#f5222d' }} />
  }

  // 趋势颜色
  const getTrendColor = () => {
    if (!trend) return '#666'
    
    const { value: trendValue, isPositive } = trend
    
    if (trendValue === 0) return '#666'
    
    if (isPositive === undefined) {
      return trendValue > 0 ? '#52c41a' : '#f5222d'
    }
    
    return isPositive ? '#52c41a' : '#f5222d'
  }

  const cardStyle = {
    borderLeft: color || getStatusColor() ? `4px solid ${color || getStatusColor()}` : undefined,
    cursor: onClick ? 'pointer' : 'default'
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      whileHover={onClick ? { scale: 1.02 } : {}}
    >
      <Card
        className={`shadow-sm hover:shadow-md transition-shadow ${className}`}
        style={cardStyle}
        bodyStyle={{ padding: '20px' }}
        loading={loading}
        onClick={onClick}
      >
        <div className="flex items-start justify-between">
          {/* 左侧内容 */}
          <div className="flex-1">
            {/* 标题和图标 */}
            <div className="flex items-center mb-2">
              {icon && (
                <div 
                  className="mr-3 p-2 rounded-lg bg-opacity-10"
                  style={{ backgroundColor: color || getStatusColor() }}
                >
                  <div style={{ color: color || getStatusColor(), fontSize: '20px' }}>
                    {icon}
                  </div>
                </div>
              )}
              <div className="flex-1">
                <div className="text-sm text-gray-600 font-medium">
                  {title}
                </div>
                {description && (
                  <div className="text-xs text-gray-400 mt-1">
                    {description}
                  </div>
                )}
              </div>
            </div>

            {/* 主要数值 */}
            <div className="mb-3">
              <Statistic
                value={value}
                prefix={prefix}
                suffix={suffix}
                precision={precision}
                valueStyle={{ 
                  fontSize: '24px',
                  fontWeight: '600',
                  color: color || getStatusColor()
                }}
              />
            </div>

            {/* 趋势信息 */}
            {trend && (
              <div className="flex items-center space-x-2 mb-2">
                {getTrendIcon()}
                <span 
                  className="text-sm font-medium"
                  style={{ color: getTrendColor() }}
                >
                  {Math.abs(trend.value)}%
                </span>
                {trend.period && (
                  <span className="text-xs text-gray-400">
                    相比{trend.period}
                  </span>
                )}
              </div>
            )}

            {/* 进度条 */}
            {progress && (
              <div className="mb-2">
                <Progress
                  percent={progress.percent}
                  strokeColor={progress.strokeColor || color || getStatusColor()}
                  showInfo={progress.showInfo}
                  size="small"
                />
              </div>
            )}

            {/* 状态标签 */}
            {status !== 'default' && (
              <div className="mt-2">
                <Tag color={getStatusColor()}>
                  {status === 'success' && '正常'}
                  {status === 'warning' && '警告'}
                  {status === 'error' && '异常'}
                </Tag>
              </div>
            )}
          </div>

          {/* 右侧额外内容 */}
          {extra && (
            <div className="ml-4">
              {extra}
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  )
}

export default MetricsCard