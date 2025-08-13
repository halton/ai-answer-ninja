import React from 'react'
import { Card, Statistic, Space, Typography, Tooltip } from 'antd'
import { TrendingUpOutlined, TrendingDownOutlined } from '@ant-design/icons'
import type { StatisticProps } from 'antd/es/statistic'

const { Text } = Typography

export interface StatCardProps extends StatisticProps {
  trend?: 'up' | 'down' | 'stable'
  trendValue?: number
  trendText?: string
  loading?: boolean
  bordered?: boolean
  hoverable?: boolean
  bodyStyle?: React.CSSProperties
}

const StatCard: React.FC<StatCardProps> = ({
  trend,
  trendValue,
  trendText,
  loading = false,
  bordered = true,
  hoverable = true,
  bodyStyle,
  ...statisticProps
}) => {
  const renderTrend = () => {
    if (!trend || trend === 'stable') return null

    const trendColor = trend === 'up' ? '#52c41a' : '#ff4d4f'
    const TrendIcon = trend === 'up' ? TrendingUpOutlined : TrendingDownOutlined
    
    return (
      <Space style={{ fontSize: '12px', color: trendColor }}>
        <TrendIcon />
        {trendValue && (
          <Text style={{ color: trendColor }}>
            {trend === 'up' ? '+' : ''}{trendValue}%
          </Text>
        )}
        {trendText && <Text style={{ color: trendColor }}>{trendText}</Text>}
      </Space>
    )
  }

  return (
    <Card
      loading={loading}
      bordered={bordered}
      hoverable={hoverable}
      bodyStyle={bodyStyle}
    >
      <Statistic {...statisticProps} />
      {trend && (
        <div style={{ marginTop: 8 }}>
          {renderTrend()}
        </div>
      )}
    </Card>
  )
}

export default StatCard