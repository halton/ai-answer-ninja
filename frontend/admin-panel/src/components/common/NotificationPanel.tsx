import React from 'react'
import { Drawer, List, Badge, Button, Empty, Typography, Tag, Space } from 'antd'
import { 
  InfoCircleOutlined, 
  CheckCircleOutlined, 
  ExclamationCircleOutlined, 
  CloseCircleOutlined,
  DeleteOutlined,
  CheckOutlined
} from '@ant-design/icons'
import { useUIStore } from '@/store'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

const { Text, Paragraph } = Typography

interface NotificationPanelProps {
  visible: boolean
  onClose: () => void
}

const NotificationPanel: React.FC<NotificationPanelProps> = ({ 
  visible, 
  onClose 
}) => {
  const { 
    notifications, 
    unreadCount,
    markNotificationRead, 
    removeNotification,
    clearAllNotifications 
  } = useUIStore()

  // 获取图标
  const getIcon = (type: string) => {
    const iconProps = { style: { fontSize: 16 } }
    
    switch (type) {
      case 'success':
        return <CheckCircleOutlined {...iconProps} style={{ ...iconProps.style, color: '#52c41a' }} />
      case 'warning':
        return <ExclamationCircleOutlined {...iconProps} style={{ ...iconProps.style, color: '#faad14' }} />
      case 'error':
        return <CloseCircleOutlined {...iconProps} style={{ ...iconProps.style, color: '#f5222d' }} />
      default:
        return <InfoCircleOutlined {...iconProps} style={{ ...iconProps.style, color: '#1890ff' }} />
    }
  }

  // 获取类型标签
  const getTypeTag = (type: string) => {
    const tagProps = {
      size: 'small' as const,
      style: { marginLeft: 8 }
    }

    switch (type) {
      case 'success':
        return <Tag color="success" {...tagProps}>成功</Tag>
      case 'warning':
        return <Tag color="warning" {...tagProps}>警告</Tag>
      case 'error':
        return <Tag color="error" {...tagProps}>错误</Tag>
      default:
        return <Tag color="blue" {...tagProps}>信息</Tag>
    }
  }

  // 处理通知操作
  const handleNotificationAction = (item: any) => {
    if (item.action) {
      item.action.handler()
      markNotificationRead(item.id)
    }
  }

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>
            通知消息
            {unreadCount > 0 && (
              <Badge 
                count={unreadCount} 
                style={{ marginLeft: 8 }}
              />
            )}
          </span>
          
          <Space size="small">
            {notifications.length > 0 && (
              <Button
                type="text"
                size="small"
                icon={<DeleteOutlined />}
                onClick={clearAllNotifications}
              >
                清空
              </Button>
            )}
          </Space>
        </div>
      }
      placement="right"
      open={visible}
      onClose={onClose}
      width={400}
      bodyStyle={{ padding: 0 }}
    >
      {notifications.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无通知消息"
          style={{ 
            marginTop: 100,
            color: '#8c8c8c' 
          }}
        />
      ) : (
        <List
          size="small"
          dataSource={notifications}
          renderItem={(item) => (
            <List.Item
              style={{
                padding: '16px',
                borderBottom: '1px solid #f0f0f0',
                background: item.read ? '#fff' : '#f6ffed',
                cursor: 'pointer',
                transition: 'background-color 0.2s',
              }}
              onClick={() => {
                if (!item.read) {
                  markNotificationRead(item.id)
                }
              }}
            >
              <List.Item.Meta
                avatar={getIcon(item.type)}
                title={
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text strong={!item.read} style={{ fontSize: 14 }}>
                      {item.title}
                    </Text>
                    {getTypeTag(item.type)}
                  </div>
                }
                description={
                  <div>
                    {item.message && (
                      <Paragraph 
                        ellipsis={{ rows: 2 }}
                        style={{ 
                          margin: '4px 0 8px 0',
                          fontSize: 13,
                          color: '#666'
                        }}
                      >
                        {item.message}
                      </Paragraph>
                    )}
                    
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {dayjs(item.timestamp).fromNow()}
                      </Text>
                      
                      <Space size="small">
                        {/* 操作按钮 */}
                        {item.action && (
                          <Button
                            type="link"
                            size="small"
                            style={{ fontSize: 12, padding: '0 4px' }}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleNotificationAction(item)
                            }}
                          >
                            {item.action.label}
                          </Button>
                        )}
                        
                        {/* 标记已读 */}
                        {!item.read && (
                          <Button
                            type="link"
                            size="small"
                            icon={<CheckOutlined />}
                            style={{ fontSize: 12, padding: '0 4px' }}
                            onClick={(e) => {
                              e.stopPropagation()
                              markNotificationRead(item.id)
                            }}
                          >
                            标记已读
                          </Button>
                        )}
                        
                        {/* 删除通知 */}
                        <Button
                          type="link"
                          size="small"
                          icon={<DeleteOutlined />}
                          style={{ fontSize: 12, padding: '0 4px', color: '#f5222d' }}
                          onClick={(e) => {
                            e.stopPropagation()
                            removeNotification(item.id)
                          }}
                        />
                      </Space>
                    </div>
                  </div>
                }
              />
            </List.Item>
          )}
        />
      )}
    </Drawer>
  )
}

export default NotificationPanel