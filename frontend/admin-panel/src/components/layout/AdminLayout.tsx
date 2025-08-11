import React, { useState, useEffect, useMemo } from 'react'
import { 
  Layout, 
  Menu, 
  Avatar, 
  Dropdown, 
  Badge, 
  Button, 
  Drawer, 
  Grid, 
  Tooltip,
  Switch,
  theme,
  ConfigProvider,
  FloatButton
} from 'antd'
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
  SunOutlined,
  MoonOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  WifiOutlined,
  DisconnectOutlined,
  QuestionCircleOutlined,
  CustomerServiceOutlined
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
    toggleSidebar,
    notifications,
    unreadCount,
    darkMode,
    setDarkMode,
    toggleDarkMode,
    primaryColor,
    isFullscreen,
    setFullscreen,
    isOnline,
    isMobile: storeMobile,
    screenSize,
    setDeviceInfo,
    addNotification
  } = useUIStore()
  
  const { connected, socketId } = useWebSocket()
  const [notificationVisible, setNotificationVisible] = useState(false)
  const [mobileMenuVisible, setMobileMenuVisible] = useState(false)
  const [helpVisible, setHelpVisible] = useState(false)

  // 响应式处理
  const isMobile = !screens.md
  const isTablet = screens.md && !screens.lg
  const siderWidth = 240
  const collapsedWidth = 80
  
  // 检测设备和屏幕尺寸
  const currentScreenSize = useMemo(() => {
    if (screens.xs) return 'xs'
    if (screens.sm) return 'sm' 
    if (screens.md) return 'md'
    if (screens.lg) return 'lg'
    return 'xl'
  }, [screens])
  
  // 同步设备信息到store
  useEffect(() => {
    setDeviceInfo(isMobile, currentScreenSize)
  }, [isMobile, currentScreenSize, setDeviceInfo])

  // 移动端和平板自动收起侧边栏
  useEffect(() => {
    if (isMobile && !sidebarCollapsed) {
      setSidebarCollapsed(true)
    }
  }, [isMobile, sidebarCollapsed, setSidebarCollapsed])
  
  // 监听网络状态
  useEffect(() => {
    const handleOnline = () => {
      addNotification({
        type: 'success',
        title: '网络已连接',
        message: '网络连接已恢复',
        duration: 3000
      })
    }
    
    const handleOffline = () => {
      addNotification({
        type: 'error',
        title: '网络连接断开',
        message: '请检查您的网络连接',
        duration: 0
      })
    }
    
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [addNotification])

  // 菜单配置 - 根据权限过滤
  const menuItems = useMemo(() => {
    const allMenus = [
      {
        key: '/dashboard',
        icon: <DashboardOutlined />,
        label: '仪表盘',
        path: '/dashboard',
        permission: 'dashboard:read'
      },
      {
        key: '/users',
        icon: <UserOutlined />,
        label: '用户管理',
        path: '/users',
        permission: 'users:read'
      },
      {
        key: '/calls',
        icon: <PhoneOutlined />,
        label: '通话记录',
        path: '/calls',
        permission: 'calls:read'
      },
      {
        key: '/whitelist',
        icon: <SafetyOutlined />,
        label: '白名单管理',
        path: '/whitelist',
        permission: 'whitelist:read'
      },
      {
        key: '/monitoring',
        icon: <MonitorOutlined />,
        label: '系统监控',
        path: '/monitoring',
        permission: 'monitoring:read'
      },
      {
        key: '/ai-config',
        icon: <RobotOutlined />,
        label: 'AI配置',
        path: '/ai-config',
        permission: 'ai:config'
      },
      {
        key: '/analytics',
        icon: <BarChartOutlined />,
        label: '统计分析',
        path: '/analytics',
        permission: 'analytics:read'
      },
      {
        key: '/settings',
        icon: <SettingOutlined />,
        label: '系统设置',
        path: '/settings',
        permission: 'settings:read'
      },
    ]
    
    // TODO: 根据用户权限过滤菜单
    return allMenus.filter(menu => {
      // 临时返回所有菜单，后续根据实际权限系统调整
      return true
    })
  }, [user])

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
  const userMenuItems = useMemo(() => [
    {
      key: 'profile',
      icon: <ProfileOutlined />,
      label: '个人资料',
      onClick: () => navigate('/profile'),
    },
    {
      key: 'account-settings',
      icon: <SettingOutlined />,
      label: '账户设置',
      onClick: () => navigate('/account/settings'),
    },
    {
      key: 'theme-toggle',
      icon: darkMode ? <SunOutlined /> : <MoonOutlined />,
      label: (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <span>{darkMode ? '切换到浅色' : '切换到深色'}</span>
          <Switch 
            size="small" 
            checked={darkMode} 
            onChange={toggleDarkMode}
            checkedChildren={<MoonOutlined />}
            unCheckedChildren={<SunOutlined />}
          />
        </div>
      ),
      onClick: (e: any) => {
        e.domEvent.stopPropagation()
        toggleDarkMode()
      },
    },
    {
      key: 'fullscreen',
      icon: isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />,
      label: isFullscreen ? '退出全屏' : '进入全屏',
      onClick: () => setFullscreen(!isFullscreen),
    },
    {
      type: 'divider' as const,
    },
    {
      key: 'help',
      icon: <QuestionCircleOutlined />,
      label: '帮助中心',
      onClick: () => setHelpVisible(true),
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
  ], [darkMode, isFullscreen, toggleDarkMode, setFullscreen, navigate, logout])

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
      }}>
        {/* WebSocket连接状态 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
          gap: 8,
          marginBottom: sidebarCollapsed ? 0 : 8
        }}>
          <Tooltip title={connected ? `实时连接正常 (${socketId?.slice(-6)})` : 'WebSocket连接已断开'}>
            {connected ? (
              <WifiOutlined style={{ color: '#52c41a', fontSize: 14 }} />
            ) : (
              <DisconnectOutlined style={{ color: '#f5222d', fontSize: 14 }} />
            )}
          </Tooltip>
          {!sidebarCollapsed && (
            <span style={{ fontSize: 12, color: '#8c8c8c' }}>
              {connected ? 'WebSocket已连接' : 'WebSocket断开'}
            </span>
          )}
        </div>
        
        {/* 网络状态 */}
        {!sidebarCollapsed && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: '#8c8c8c'
          }}>
            <div style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: isOnline ? '#52c41a' : '#f5222d',
            }} />
            <span>{isOnline ? '网络正常' : '网络断开'}</span>
          </div>
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
            <Tooltip title={`${unreadCount}条未读通知`}>
              <Badge count={unreadCount} size="small" overflowCount={99}>
                <Button
                  type="text"
                  icon={<BellOutlined />}
                  onClick={() => setNotificationVisible(true)}
                  style={{ fontSize: 16 }}
                />
              </Badge>
            </Tooltip>
            
            {/* 主题切换 */}
            {!isMobile && (
              <Tooltip title={darkMode ? '切换到浅色模式' : '切换到深色模式'}>
                <Button
                  type="text"
                  icon={darkMode ? <SunOutlined /> : <MoonOutlined />}
                  onClick={toggleDarkMode}
                  style={{ fontSize: 16 }}
                />
              </Tooltip>
            )}
            
            {/* 全屏切换 */}
            {!isMobile && (
              <Tooltip title={isFullscreen ? '退出全屏' : '进入全屏'}>
                <Button
                  type="text"
                  icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                  onClick={() => setFullscreen(!isFullscreen)}
                  style={{ fontSize: 16 }}
                />
              </Tooltip>
            )}

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
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 14, color: '#262626', lineHeight: 1.2 }}>
                      {user?.name || '管理员'}
                    </span>
                    <span style={{ fontSize: 12, color: '#8c8c8c', lineHeight: 1.2 }}>
                      {user?.role === 'admin' ? '系统管理员' : '普通用户'}
                    </span>
                  </div>
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
      
      {/* 悬浮按钮组 */}
      <FloatButton.Group
        trigger="hover"
        type="primary"
        style={{ right: 24, bottom: 24 }}
        icon={<CustomerServiceOutlined />}
      >
        <Tooltip title="帮助中心" placement="left">
          <FloatButton
            icon={<QuestionCircleOutlined />}
            onClick={() => setHelpVisible(true)}
          />
        </Tooltip>
        <Tooltip title="客服支持" placement="left">
          <FloatButton
            icon={<CustomerServiceOutlined />}
            onClick={() => {
              addNotification({
                type: 'info',
                title: '客服支持',
                message: '如需技术支持，请联系客服热线：400-xxx-xxxx',
                duration: 8000
              })
            }}
          />
        </Tooltip>
      </FloatButton.Group>
    </Layout>
  )
}

// 使用主题包装器
const ThemedAdminLayout: React.FC<AdminLayoutProps> = (props) => {
  const { darkMode, primaryColor } = useUIStore()
  const { token } = theme.useToken()
  
  return (
    <ConfigProvider
      theme={{
        algorithm: darkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: primaryColor,
        },
      }}
    >
      <AdminLayout {...props} />
    </ConfigProvider>
  )
}

export default ThemedAdminLayout