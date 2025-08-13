import React from 'react'
import { Badge, Tag, Tooltip, Space } from 'antd'
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  CloseCircleOutlined,
  QuestionCircleOutlined,
  LoadingOutlined
} from '@ant-design/icons'

export type StatusType = 'success' | 'warning' | 'error' | 'info' | 'loading' | 'default'

export interface StatusIndicatorProps {
  status: StatusType
  text?: string
  tooltip?: string
  showIcon?: boolean
  showDot?: boolean
  size?: 'small' | 'default' | 'large'
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  status,
  text,
  tooltip,
  showIcon = false,
  showDot = false,
  size = 'default'
}) => {
  const statusConfig = {
    success: {
      color: 'success',
      badgeStatus: 'success' as const,
      icon: <CheckCircleOutlined />,
      tagColor: 'green'
    },
    warning: {
      color: 'warning',
      badgeStatus: 'warning' as const,
      icon: <ExclamationCircleOutlined />,
      tagColor: 'orange'
    },
    error: {
      color: 'error',
      badgeStatus: 'error' as const,
      icon: <CloseCircleOutlined />,
      tagColor: 'red'
    },
    info: {
      color: 'processing',
      badgeStatus: 'processing' as const,
      icon: <QuestionCircleOutlined />,
      tagColor: 'blue'
    },
    loading: {
      color: 'processing',
      badgeStatus: 'processing' as const,
      icon: <LoadingOutlined />,
      tagColor: 'blue'
    },
    default: {
      color: 'default',
      badgeStatus: 'default' as const,
      icon: <QuestionCircleOutlined />,
      tagColor: 'default'
    }
  }

  const config = statusConfig[status]

  const renderContent = () => {
    if (showDot && text) {
      return (
        <Badge status={config.badgeStatus} text={text} />
      )
    }

    if (showIcon && text) {
      return (
        <Space size="small">
          {config.icon}
          {text}
        </Space>
      )
    }

    if (text) {
      return (
        <Tag color={config.tagColor} style={{ margin: 0 }}>
          {text}
        </Tag>
      )
    }

    if (showDot) {
      return <Badge status={config.badgeStatus} />
    }

    if (showIcon) {
      return config.icon
    }

    return <Badge status={config.badgeStatus} />
  }

  const content = renderContent()

  if (tooltip) {
    return <Tooltip title={tooltip}>{content}</Tooltip>
  }

  return content
}

export default StatusIndicator