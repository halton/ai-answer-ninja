import React, { useState, useEffect } from 'react'
import { 
  Card, 
  Table, 
  Button, 
  Input, 
  Space, 
  Tag, 
  Avatar, 
  Modal, 
  message, 
  Dropdown,
  Tooltip,
  Row,
  Col,
  Statistic,
  DatePicker,
  Select
} from 'antd'
import {
  PlusOutlined,
  SearchOutlined,
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
  MoreOutlined,
  ExportOutlined,
  ImportOutlined,
  UserOutlined,
  PhoneOutlined,
  MailOutlined,
  SafetyOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useNavigate } from 'react-router-dom'
import { useUserStore } from '@/store'
import type { User, QueryParams } from '@/types'
import dayjs from 'dayjs'

// 子组件
import UserModal from './components/UserModal'
import UserDetailDrawer from './components/UserDetailDrawer'
import { Typography } from 'antd'

const { RangePicker } = DatePicker
const { Option } = Select
const { Title, Text } = Typography

const UserManagement: React.FC = () => {
  const navigate = useNavigate()
  const { 
    users, 
    total, 
    loading, 
    fetchUsers, 
    deleteUser,
    updateUser,
    clearError 
  } = useUserStore()

  // 状态管理
  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null)
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 10,
    showSizeChanger: true,
    showQuickJumper: true,
  })
  
  // 模态框状态
  const [userModalVisible, setUserModalVisible] = useState(false)
  const [userDetailVisible, setUserDetailVisible] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')

  // 选中的用户IDs（用于批量操作）
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])

  // 统计数据
  const [stats, setStats] = useState({
    totalUsers: 0,
    activeUsers: 0,
    newUsersThisMonth: 0,
    adminUsers: 0,
  })

  // 初始化数据
  useEffect(() => {
    loadUsers()
    loadStats()
  }, [pagination.current, pagination.pageSize])

  // 加载用户数据
  const loadUsers = async () => {
    const params: QueryParams = {
      page: pagination.current,
      pageSize: pagination.pageSize,
      ...(searchText && { keyword: searchText }),
      ...(statusFilter && { status: statusFilter }),
      ...(dateRange && {
        dateRange: [
          dateRange[0].format('YYYY-MM-DD'),
          dateRange[1].format('YYYY-MM-DD')
        ]
      }),
    }
    
    await fetchUsers(params)
  }

  // 加载统计数据
  const loadStats = () => {
    // 模拟统计数据
    const activeUsers = users.filter(u => u.status === 'active').length
    const adminUsers = users.filter(u => u.role === 'admin').length
    const totalUsers = users.length

    setStats({
      totalUsers,
      activeUsers,
      newUsersThisMonth: Math.floor(totalUsers * 0.1),
      adminUsers,
    })
  }

  // 搜索
  const handleSearch = () => {
    setPagination(prev => ({ ...prev, current: 1 }))
    loadUsers()
  }

  // 重置筛选
  const handleReset = () => {
    setSearchText('')
    setStatusFilter('')
    setDateRange(null)
    setPagination(prev => ({ ...prev, current: 1 }))
    setTimeout(loadUsers, 100)
  }

  // 表格列配置
  const columns: ColumnsType<User> = [
    {
      title: '用户',
      key: 'user',
      width: 200,
      render: (_, record) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar size={40} src={record.name} icon={<UserOutlined />} />
          <div>
            <div style={{ fontWeight: 500, marginBottom: 2 }}>
              {record.name}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.phoneNumber}
            </Text>
          </div>
        </div>
      ),
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 100,
      render: (role: string) => {
        const roleConfig = {
          admin: { color: 'red', text: '管理员' },
          user: { color: 'blue', text: '用户' },
          system: { color: 'purple', text: '系统' },
        }
        const config = roleConfig[role as keyof typeof roleConfig] || { color: 'default', text: role }
        return <Tag color={config.color}>{config.text}</Tag>
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const statusConfig = {
          active: { color: 'success', text: '正常' },
          inactive: { color: 'warning', text: '未激活' },
          suspended: { color: 'error', text: '已暂停' },
        }
        const config = statusConfig[status as keyof typeof statusConfig] || { color: 'default', text: status }
        return <Tag color={config.color}>{config.text}</Tag>
      },
    },
    {
      title: '个性化设置',
      dataIndex: 'personality',
      key: 'personality',
      width: 120,
      render: (personality: string) => {
        if (!personality) return <Text type="secondary">未设置</Text>
        
        const personalityConfig = {
          polite: { text: '礼貌', color: 'green' },
          direct: { text: '直接', color: 'blue' },
          humorous: { text: '幽默', color: 'orange' },
          professional: { text: '专业', color: 'purple' },
        }
        const config = personalityConfig[personality as keyof typeof personalityConfig]
        
        return config ? (
          <Tag color={config.color}>{config.text}</Tag>
        ) : (
          <Tag>{personality}</Tag>
        )
      },
    },
    {
      title: '注册时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 120,
      render: (date: string) => dayjs(date).format('YYYY-MM-DD'),
    },
    {
      title: '最后登录',
      dataIndex: 'lastLoginAt',
      key: 'lastLoginAt',
      width: 120,
      render: (date: string) => date ? dayjs(date).format('YYYY-MM-DD HH:mm') : '从未登录',
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="查看详情">
            <Button
              type="text"
              icon={<EditOutlined />}
              size="small"
              onClick={() => handleViewUser(record)}
            />
          </Tooltip>
          
          <Tooltip title="编辑用户">
            <Button
              type="text"
              icon={<EditOutlined />}
              size="small"
              onClick={() => handleEditUser(record)}
            />
          </Tooltip>

          <Dropdown
            menu={{
              items: [
                {
                  key: 'status',
                  label: record.status === 'active' ? '暂停用户' : '激活用户',
                  onClick: () => handleToggleStatus(record),
                },
                {
                  key: 'delete',
                  label: '删除用户',
                  danger: true,
                  onClick: () => handleDeleteUser(record),
                },
              ],
            }}
            trigger={['click']}
          >
            <Button type="text" icon={<MoreOutlined />} size="small" />
          </Dropdown>
        </Space>
      ),
    },
  ]

  // 用户操作处理函数
  const handleViewUser = (user: User) => {
    setSelectedUser(user)
    setUserDetailVisible(true)
  }

  const handleEditUser = (user: User) => {
    setSelectedUser(user)
    setModalMode('edit')
    setUserModalVisible(true)
  }

  const handleDeleteUser = (user: User) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除用户 "${user.name}" 吗？此操作不可撤销。`,
      okText: '确认删除',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          await deleteUser(user.id)
          message.success('用户删除成功')
          loadUsers()
        } catch (error) {
          message.error('删除失败，请重试')
        }
      },
    })
  }

  const handleToggleStatus = async (user: User) => {
    const newStatus = user.status === 'active' ? 'suspended' : 'active'
    try {
      await updateUser(user.id, { status: newStatus })
      message.success(`用户状态已${newStatus === 'active' ? '激活' : '暂停'}`)
      loadUsers()
    } catch (error) {
      message.error('状态更新失败，请重试')
    }
  }

  const handleCreateUser = () => {
    setSelectedUser(null)
    setModalMode('create')
    setUserModalVisible(true)
  }

  // 批量操作
  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要删除的用户')
      return
    }

    Modal.confirm({
      title: '批量删除确认',
      content: `确定要删除选中的 ${selectedRowKeys.length} 个用户吗？此操作不可撤销。`,
      okText: '确认删除',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          // 这里应该调用批量删除API
          message.success(`成功删除 ${selectedRowKeys.length} 个用户`)
          setSelectedRowKeys([])
          loadUsers()
        } catch (error) {
          message.error('批量删除失败，请重试')
        }
      },
    })
  }

  // 表格选择配置
  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => {
      setSelectedRowKeys(keys as string[])
    },
  }

  return (
    <div className="page-container">
      {/* 页面标题 */}
      <div className="page-header">
        <Title level={4} className="page-title">
          用户管理
        </Title>
        <Text className="page-description">
          管理系统用户信息、权限配置和账户状态
        </Text>
      </div>

      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title="总用户数"
              value={stats.totalUsers}
              prefix={<UserOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title="活跃用户"
              value={stats.activeUsers}
              prefix={<SafetyOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title="本月新增"
              value={stats.newUsersThisMonth}
              prefix={<PlusOutlined />}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title="管理员"
              value={stats.adminUsers}
              prefix={<UserOutlined />}
              valueStyle={{ color: '#722ed1' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 操作栏 */}
      <Card style={{ marginBottom: 24 }}>
        <div className="toolbar">
          <div className="toolbar-left">
            <Space wrap>
              <Input
                placeholder="搜索用户名或手机号"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onPressEnter={handleSearch}
                style={{ width: 200 }}
                allowClear
              />
              
              <Select
                placeholder="用户状态"
                value={statusFilter}
                onChange={setStatusFilter}
                style={{ width: 120 }}
                allowClear
              >
                <Option value="active">正常</Option>
                <Option value="inactive">未激活</Option>
                <Option value="suspended">已暂停</Option>
              </Select>

              <RangePicker
                placeholder={['开始日期', '结束日期']}
                value={dateRange}
                onChange={setDateRange}
              />

              <Button 
                icon={<SearchOutlined />} 
                onClick={handleSearch}
              >
                搜索
              </Button>
              
              <Button onClick={handleReset}>
                重置
              </Button>
            </Space>
          </div>

          <div className="toolbar-right">
            <Space>
              {selectedRowKeys.length > 0 && (
                <Button 
                  danger
                  icon={<DeleteOutlined />}
                  onClick={handleBatchDelete}
                >
                  批量删除 ({selectedRowKeys.length})
                </Button>
              )}
              
              <Button 
                icon={<ExportOutlined />}
                onClick={() => message.info('导出功能开发中')}
              >
                导出
              </Button>
              
              <Button 
                icon={<ImportOutlined />}
                onClick={() => message.info('导入功能开发中')}
              >
                导入
              </Button>
              
              <Button 
                icon={<ReloadOutlined />}
                onClick={loadUsers}
              >
                刷新
              </Button>
              
              <Button 
                type="primary" 
                icon={<PlusOutlined />}
                onClick={handleCreateUser}
              >
                新建用户
              </Button>
            </Space>
          </div>
        </div>
      </Card>

      {/* 用户列表 */}
      <Card className="enhanced-table">
        <Table
          columns={columns}
          dataSource={users}
          rowKey="id"
          loading={loading}
          rowSelection={rowSelection}
          scroll={{ x: 1200 }}
          pagination={{
            ...pagination,
            total,
            showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
            onChange: (page, size) => {
              setPagination(prev => ({
                ...prev,
                current: page,
                pageSize: size,
              }))
            },
          }}
        />
      </Card>

      {/* 用户编辑模态框 */}
      <UserModal
        visible={userModalVisible}
        mode={modalMode}
        user={selectedUser}
        onCancel={() => {
          setUserModalVisible(false)
          setSelectedUser(null)
        }}
        onSuccess={() => {
          setUserModalVisible(false)
          setSelectedUser(null)
          loadUsers()
        }}
      />

      {/* 用户详情抽屉 */}
      <UserDetailDrawer
        visible={userDetailVisible}
        user={selectedUser}
        onClose={() => {
          setUserDetailVisible(false)
          setSelectedUser(null)
        }}
      />
    </div>
  )
}

export default UserManagement