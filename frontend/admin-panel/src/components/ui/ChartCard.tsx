import React from 'react'
import { Card, Spin, Typography, Space, Button } from 'antd'
import { ReloadOutlined, FullscreenOutlined, DownloadOutlined } from '@ant-design/icons'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'

const { Title } = Typography

export interface ChartCardProps {
  title?: string
  option: EChartsOption
  loading?: boolean
  height?: number | string
  bordered?: boolean
  hoverable?: boolean
  refreshable?: boolean
  downloadable?: boolean
  fullscreenable?: boolean
  onRefresh?: () => void
  onDownload?: () => void
  onFullscreen?: () => void
  extra?: React.ReactNode
}

const ChartCard: React.FC<ChartCardProps> = ({
  title,
  option,
  loading = false,
  height = 400,
  bordered = true,
  hoverable = false,
  refreshable = false,
  downloadable = false,
  fullscreenable = false,
  onRefresh,
  onDownload,
  onFullscreen,
  extra
}) => {
  const actions = []

  if (refreshable && onRefresh) {
    actions.push(
      <Button
        key="refresh"
        type="text"
        icon={<ReloadOutlined />}
        onClick={onRefresh}
        size="small"
      />
    )
  }

  if (downloadable && onDownload) {
    actions.push(
      <Button
        key="download"
        type="text"
        icon={<DownloadOutlined />}
        onClick={onDownload}
        size="small"
      />
    )
  }

  if (fullscreenable && onFullscreen) {
    actions.push(
      <Button
        key="fullscreen"
        type="text"
        icon={<FullscreenOutlined />}
        onClick={onFullscreen}
        size="small"
      />
    )
  }

  return (
    <Card
      title={title && <Title level={5} style={{ margin: 0 }}>{title}</Title>}
      bordered={bordered}
      hoverable={hoverable}
      extra={
        <Space>
          {actions}
          {extra}
        </Space>
      }
    >
      <Spin spinning={loading}>
        <div style={{ height }}>
          <ReactECharts
            option={option}
            style={{ height: '100%', width: '100%' }}
            notMerge={true}
            lazyUpdate={true}
          />
        </div>
      </Spin>
    </Card>
  )
}

export default ChartCard