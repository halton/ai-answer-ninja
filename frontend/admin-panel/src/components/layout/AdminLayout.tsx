import React, { useState, useEffect } from 'react'
import { Layout, Menu, Avatar, Dropdown, Badge, Button, Drawer, Grid } from 'antd'
import {
  DashboardOutlined,
  UserOutlined,
  PhoneOutlined,
  SafetyOutlined,
  MonitorOutlined,
  RobotOutlined,
  BarChartOutlined,
  SettingOutlined,
  BellOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  LogoutOutlined,
  ProfileOutlined,
} from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore, useUIStore } from '@/store'
import { useWebSocket } from '@/services/websocket'

// 子组件
import Breadcrumbs from '@/components/common/Breadcrumbs'
import NotificationPanel from '@/components/common/NotificationPanel'

const { Header, Sider, Content } = Layout
const { useBreakpoint } = Grid

interface AdminLayoutProps {
  children: React.ReactNode
}

const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const screens = useBreakpoint()
  
  const { user, logout } = useAuthStore()
  const { 
    sidebarCollapsed, 
    setSidebarCollapsed, 
    notifications,
    darkMode,
  } = useUIStore()
  
  const { connected } = useWebSocket()
  const [notificationVisible, setNotificationVisible] = useState(false)
  const [mobileMenuVisible, setMobileMenuVisible] = useState(false)

  // 响应式处理
  const isMobile = !screens.md
  const siderWidth = 240
  const collapsedWidth = 80

  // 移动端自动收起侧边栏
  useEffect(() => {
    if (isMobile) {
      setSidebarCollapsed(true)
    }
  }, [isMobile, setSidebarCollapsed])

  // 菜单配置
  const menuItems = [
    {
      key: '/dashboard',
      icon: <DashboardOutlined />,
      label: '仪表盘',
      path: '/dashboard',
    },
    {
      key: '/users',
      icon: <UserOutlined />,
      label: '用户管理',
      path: '/users',
    },
    {
      key: '/calls',
      icon: <PhoneOutlined />,
      label: '通话记录',
      path: '/calls',
    },
    {
      key: '/whitelist',
      icon: <SafetyOutlined />,
      label: '白名单管理',
      path: '/whitelist',
    },
    {
      key: '/monitoring',
      icon: <MonitorOutlined />,
      label: '系统监控',
      path: '/monitoring',
    },
    {
      key: '/ai-config',
      icon: <RobotOutlined />,
      label: 'AI配置',
      path: '/ai-config',
    },
    {
      key: '/analytics',
      icon: <BarChartOutlined />,
      label: '统计分析',
      path: '/analytics',
    },
    {
      key: '/settings',
      icon: <SettingOutlined />,
      label: '系统设置',
      path: '/settings',
    },
  ]

  // 获取当前选中的菜单
  const selectedKey = menuItems.find(item => 
    location.pathname.startsWith(item.path)
  )?.key || '/dashboard'

  // 菜单点击处理
  const handleMenuClick = ({ key }: { key: string }) => {
    const menuItem = menuItems.find(item => item.key === key)
    if (menuItem) {
      navigate(menuItem.path)
      if (isMobile) {
        setMobileMenuVisible(false)
      }
    }
  }

  // 用户菜单
  const userMenuItems = [
    {
      key: 'profile',
      icon: <ProfileOutlined />,
      label: '个人资料',
      onClick: () => navigate('/profile'),
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '账户设置',
      onClick: () => navigate('/account/settings'),
    },
    {
      type: 'divider' as const,
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: () => {
        logout()
        navigate('/auth/login')
      },
    },
  ]

  // 侧边栏内容
  const siderContent = (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Logo区域 */}
      <div style={{
        height: 64,
        display: 'flex',
        alignItems: 'center',
        justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
        padding: sidebarCollapsed ? 0 : '0 24px',
        borderBottom: '1px solid #f0f0f0',
      }}>
        {sidebarCollapsed ? (
          <RobotOutlined style={{ fontSize: 24, color: '#1890ff' }} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RobotOutlined style={{ fontSize: 24, color: '#1890ff' }} />
            <span style={{ fontSize: 16, fontWeight: 600, color: '#262626' }}>
              AI应答系统
            </span>
          </div>
        )}
      </div>

      {/* 菜单区域 */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={handleMenuClick}
          inlineCollapsed={sidebarCollapsed}
          style={{ border: 'none' }}
        />
      </div>

      {/* 连接状态指示器 */}
      <div style={{
        padding: sidebarCollapsed ? '8px' : '16px 24px',
        borderTop: '1px solid #f0f0f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
        gap: 8,
      }}>
        <div style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: connected ? '#52c41a' : '#f5222d',
        }} />
        {!sidebarCollapsed && (
          <span style={{ fontSize: 12, color: '#8c8c8c' }}>
            {connected ? '实时连接正常' : '连接已断开'}
          </span>
        )}
      </div>
    </div>
  )

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* 桌面端侧边栏 */}
      {!isMobile && (
        <Sider
          trigger={null}
          collapsible
          collapsed={sidebarCollapsed}
          width={siderWidth}
          collapsedWidth={collapsedWidth}
          style={{
            position: 'fixed',
            left: 0,
            top: 0,
            bottom: 0,
            zIndex: 100,
            boxShadow: '2px 0 8px rgba(0,0,0,0.06)',
          }}
          theme="light"
        >
          {siderContent}
        </Sider>
      )}

      {/* 移动端抽屉菜单 */}
      {isMobile && (
        <Drawer
          placement="left"
          open={mobileMenuVisible}
          onClose={() => setMobileMenuVisible(false)}
          closable={false}
          width={siderWidth}
          bodyStyle={{ padding: 0 }}
        >
          {siderContent}
        </Drawer>
      )}

      {/* 主内容区域 */}
      <Layout style={{
        marginLeft: isMobile ? 0 : (sidebarCollapsed ? collapsedWidth : siderWidth),
        transition: 'margin-left 0.2s',
      }}>
        {/* 顶部导航栏 */}
        <Header style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: '#fff',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        }}>
          {/* 左侧 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* 菜单折叠按钮 */}
            <Button
              type="text"
              icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => {
                if (isMobile) {
                  setMobileMenuVisible(true)
                } else {
                  setSidebarCollapsed(!sidebarCollapsed)
                }
              }}
              style={{ fontSize: 16 }}
            />

            {/* 面包屑 */}
            <Breadcrumbs />
          </div>

          {/* 右侧 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* 通知铃铛 */}
            <Badge count={notifications.filter(n => !n.read).length} size="small">
              <Button
                type="text"
                icon={<BellOutlined />}
                onClick={() => setNotificationVisible(true)}
                style={{ fontSize: 16 }}
              />
            </Badge>

            {/* 用户头像和菜单 */}
            <Dropdown 
              menu={{ items: userMenuItems }}
              placement="bottomRight"
              trigger={['click']}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                padding: '8px 12px',
                borderRadius: 6,
                transition: 'background-color 0.2s',
              }}>
                <Avatar 
                  size="small" 
                  src={user?.avatar} 
                  icon={<UserOutlined />}
                />
                {!isMobile && (
                  <span style={{ fontSize: 14, color: '#262626' }}>
                    {user?.name || '管理员'}
                  </span>
                )}
              </div>
            </Dropdown>
          </div>
        </Header>

        {/* 内容区域 */}
        <Content style={{
          margin: 0,
          background: '#f5f5f5',
          minHeight: 'calc(100vh - 64px)',
        }}>
          {children}
        </Content>
      </Layout>

      {/* 通知面板 */}
      <NotificationPanel
        visible={notificationVisible}
        onClose={() => setNotificationVisible(false)}
      />
    </Layout>
  )
}

export default AdminLayout