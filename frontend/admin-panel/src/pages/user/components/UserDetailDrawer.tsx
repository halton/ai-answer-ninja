import React from 'react'
import { 
  Drawer, 
  Descriptions, 
  Avatar, 
  Tag, 
  Space, 
  Button, 
  Card, 
  Tabs, 
  List, 
  Progress,
  Typography,
  Statistic,
  Row,
  Col
} from 'antd'
import {
  UserOutlined,
  PhoneOutlined,
  MailOutlined,
  CalendarOutlined,
  EditOutlined,
  SafetyOutlined,
  RobotOutlined,
} from '@ant-design/icons'
import type { User } from '@/types'
import dayjs from 'dayjs'

const { Title, Text } = Typography
const { TabPane } = Tabs

interface UserDetailDrawerProps {
  visible: boolean
  user: User | null
  onClose: () => void
}

const UserDetailDrawer: React.FC<UserDetailDrawerProps> = ({
  visible,
  user,
  onClose,
}) => {
  if (!user) return null

  // 模拟用户统计数据
  const userStats = {
    totalCalls: 128,
    blockedCalls: 89,
    whitelistContacts: 25,
    aiResponseRate: 85,
  }

  // 模拟通话记录
  const recentCalls = [
    {
      id: '1',
      callerPhone: '138****5678',
      type: 'blocked',
      duration: 0,
      time: '2024-01-10 14:30',
      result: '已拦截',
    },
    {
      id: '2', 
      callerPhone: '150****9012',
      type: 'ai_handled',
      duration: 45,
      time: '2024-01-10 10:15',
      result: 'AI处理',
    },
    {
      id: '3',
      callerPhone: '186****3456',
      type: 'transferred',
      duration: 120,
      time: '2024-01-09 16:45',
      result: '已转接',
    },
  ]

  // 个性化设置显示
  const getPersonalityDisplay = (personality: string) => {
    const configs = {
      polite: { text: '礼貌型', color: 'green', desc: '温和有礼，委婉拒绝' },
      direct: { text: '直接型', color: 'blue', desc: '直截了当，快速结束' },
      humorous: { text: '幽默型', color: 'orange', desc: '轻松幽默，缓解气氛' },
      professional: { text: '专业型', color: 'purple', desc: '专业严谨，正式回应' },
    }
    return configs[personality as keyof typeof configs] || { text: personality, color: 'default', desc: '' }
  }

  const personalityConfig = getPersonalityDisplay(user.personality || '')

  return (
    <Drawer
      title={
        <Space>
          <Avatar size={32} src={user.name} icon={<UserOutlined />} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 500 }}>
              {user.name}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              用户详情
            </Text>
          </div>
        </Space>
      }
      placement="right"
      open={visible}
      onClose={onClose}
      width={600}
      extra={
        <Button icon={<EditOutlined />} type="primary">
          编辑用户
        </Button>
      }
    >
      <Tabs defaultActiveKey="basic">
        {/* 基本信息 */}
        <TabPane tab="基本信息" key="basic">
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            {/* 用户基本信息 */}
            <Card title="基本信息" size="small">
              <Descriptions column={1} size="small">
                <Descriptions.Item 
                  label={<Space><UserOutlined />姓名</Space>}
                >
                  {user.name}
                </Descriptions.Item>
                
                <Descriptions.Item 
                  label={<Space><PhoneOutlined />手机号</Space>}
                >
                  {user.phoneNumber}
                </Descriptions.Item>
                
                <Descriptions.Item 
                  label={<Space><MailOutlined />邮箱</Space>}
                >
                  {user.email || '未设置'}
                </Descriptions.Item>
                
                <Descriptions.Item label="角色">
                  <Tag color={user.role === 'admin' ? 'red' : 'blue'}>
                    {user.role === 'admin' ? '管理员' : '用户'}
                  </Tag>
                </Descriptions.Item>
                
                <Descriptions.Item label="状态">
                  <Tag color={
                    user.status === 'active' ? 'success' :
                    user.status === 'inactive' ? 'warning' : 'error'
                  }>
                    {user.status === 'active' ? '正常' :
                     user.status === 'inactive' ? '未激活' : '已暂停'}
                  </Tag>
                </Descriptions.Item>
                
                <Descriptions.Item 
                  label={<Space><CalendarOutlined />注册时间</Space>}
                >
                  {dayjs(user.createdAt).format('YYYY-MM-DD HH:mm')}
                </Descriptions.Item>
                
                <Descriptions.Item label="最后登录">
                  {user.lastLoginAt ? 
                    dayjs(user.lastLoginAt).format('YYYY-MM-DD HH:mm') : 
                    '从未登录'
                  }
                </Descriptions.Item>
              </Descriptions>
            </Card>

            {/* AI个性化设置 */}
            <Card title={<Space><RobotOutlined />AI个性化设置</Space>} size="small">
              <Space direction="vertical" style={{ width: '100%' }}>
                <div>
                  <Text strong>应答个性: </Text>
                  <Tag color={personalityConfig.color}>
                    {personalityConfig.text}
                  </Tag>
                  <div style={{ marginTop: 4 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {personalityConfig.desc}
                    </Text>
                  </div>
                </div>

                {user.preferences?.aiSettings && (
                  <Descriptions column={1} size="small" style={{ marginTop: 12 }}>
                    <Descriptions.Item label="应答风格">
                      {user.preferences.aiSettings.responseStyle === 'formal' ? '正式' :
                       user.preferences.aiSettings.responseStyle === 'casual' ? '随意' : '自定义'}
                    </Descriptions.Item>
                    
                    <Descriptions.Item label="最大通话时长">
                      {user.preferences.aiSettings.maxCallDuration || 300} 秒
                    </Descriptions.Item>
                    
                    <Descriptions.Item label="自动终止">
                      <Tag color={user.preferences.aiSettings.autoTerminate ? 'success' : 'default'}>
                        {user.preferences.aiSettings.autoTerminate ? '已启用' : '已禁用'}
                      </Tag>
                    </Descriptions.Item>
                    
                    <Descriptions.Item label="白名单">
                      <Tag color={user.preferences.aiSettings.whitelistEnabled ? 'success' : 'default'}>
                        {user.preferences.aiSettings.whitelistEnabled ? '已启用' : '已禁用'}
                      </Tag>
                    </Descriptions.Item>
                  </Descriptions>
                )}
              </Space>
            </Card>
          </Space>
        </TabPane>

        {/* 使用统计 */}
        <TabPane tab="使用统计" key="stats">
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            {/* 统计数据 */}
            <Row gutter={16}>
              <Col span={12}>
                <Card>
                  <Statistic
                    title="总通话次数"
                    value={userStats.totalCalls}
                    prefix={<PhoneOutlined />}
                    valueStyle={{ color: '#1890ff' }}
                  />
                </Card>
              </Col>
              <Col span={12}>
                <Card>
                  <Statistic
                    title="拦截次数"
                    value={userStats.blockedCalls}
                    prefix={<SafetyOutlined />}
                    valueStyle={{ color: '#52c41a' }}
                  />
                </Card>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={12}>
                <Card>
                  <Statistic
                    title="白名单联系人"
                    value={userStats.whitelistContacts}
                    prefix={<UserOutlined />}
                    valueStyle={{ color: '#faad14' }}
                  />
                </Card>
              </Col>
              <Col span={12}>
                <Card>
                  <Statistic
                    title="AI响应成功率"
                    value={userStats.aiResponseRate}
                    suffix="%"
                    prefix={<RobotOutlined />}
                    valueStyle={{ color: '#722ed1' }}
                  />
                </Card>
              </Col>
            </Row>

            {/* AI效果分析 */}
            <Card title="AI应答效果" size="small">
              <Space direction="vertical" style={{ width: '100%' }}>
                <div>
                  <div style={{ marginBottom: 8 }}>
                    <Text>拦截成功率</Text>
                    <Text style={{ float: 'right' }}>85%</Text>
                  </div>
                  <Progress percent={85} strokeColor="#52c41a" />
                </div>
                
                <div>
                  <div style={{ marginBottom: 8 }}>
                    <Text>响应速度</Text>
                    <Text style={{ float: 'right' }}>92%</Text>
                  </div>
                  <Progress percent={92} strokeColor="#1890ff" />
                </div>
                
                <div>
                  <div style={{ marginBottom: 8 }}>
                    <Text>用户满意度</Text>
                    <Text style={{ float: 'right' }}>78%</Text>
                  </div>
                  <Progress percent={78} strokeColor="#722ed1" />
                </div>
              </Space>
            </Card>
          </Space>
        </TabPane>

        {/* 最近通话 */}
        <TabPane tab="通话记录" key="calls">
          <Card title="最近通话记录" size="small">
            <List
              dataSource={recentCalls}
              renderItem={(item) => (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <Space>
                        <Text>{item.callerPhone}</Text>
                        <Tag color={
                          item.type === 'blocked' ? 'red' :
                          item.type === 'ai_handled' ? 'blue' : 'green'
                        }>
                          {item.result}
                        </Tag>
                      </Space>
                    }
                    description={
                      <Space>
                        <Text type="secondary">{item.time}</Text>
                        {item.duration > 0 && (
                          <Text type="secondary">
                            通话时长: {Math.floor(item.duration / 60)}分{item.duration % 60}秒
                          </Text>
                        )}
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        </TabPane>
      </Tabs>
    </Drawer>
  )
}

export default UserDetailDrawer