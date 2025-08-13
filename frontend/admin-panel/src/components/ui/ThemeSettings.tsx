import React, { useState } from 'react'
import {
  Drawer,
  Space,
  Typography,
  Radio,
  ColorPicker,
  Slider,
  Divider,
  Button,
  Card,
  Row,
  Col,
  Switch,
  Tooltip,
  message
} from 'antd'
import {
  SettingOutlined,
  SunOutlined,
  MoonOutlined,
  DesktopOutlined,
  FontSizeOutlined,
  BgColorsOutlined,
  BorderOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { useTheme } from '@/hooks/ui/useTheme'
import type { ThemeMode, ThemeSize } from '@/hooks/ui/useTheme'

const { Title, Text } = Typography

interface ThemeSettingsProps {
  open: boolean
  onClose: () => void
}

const ThemeSettings: React.FC<ThemeSettingsProps> = ({ open, onClose }) => {
  const {
    themeConfig,
    isDark,
    toggleTheme,
    setThemeMode,
    setThemeSize,
    setPrimaryColor,
    setBorderRadius
  } = useTheme()

  const [previewMode, setPreviewMode] = useState<ThemeMode>(themeConfig.mode)
  const [previewSize, setPreviewSize] = useState<ThemeSize>(themeConfig.size)
  const [previewColor, setPreviewColor] = useState(themeConfig.primaryColor || '#1890ff')
  const [previewRadius, setPreviewRadius] = useState(themeConfig.borderRadius || 6)

  // 预设主题色
  const presetColors = [
    '#1890ff', // 默认蓝
    '#722ed1', // 紫色
    '#13c2c2', // 青色
    '#52c41a', // 绿色
    '#faad14', // 黄色
    '#f5222d', // 红色
    '#fa541c', // 橙色
    '#eb2f96', // 粉色
  ]

  // 主题模式选项
  const themeModeOptions = [
    { value: 'light', icon: <SunOutlined />, label: '浅色' },
    { value: 'dark', icon: <MoonOutlined />, label: '深色' },
    { value: 'auto', icon: <DesktopOutlined />, label: '自动' }
  ]

  // 主题尺寸选项
  const themeSizeOptions = [
    { value: 'compact', label: '紧凑' },
    { value: 'default', label: '默认' },
    { value: 'comfortable', label: '舒适' }
  ]

  // 应用预览设置
  const applyPreview = () => {
    setThemeMode(previewMode)
    setThemeSize(previewSize)
    setPrimaryColor(previewColor)
    setBorderRadius(previewRadius)
    message.success('主题设置已应用')
  }

  // 重置设置
  const resetSettings = () => {
    const defaultSettings = {
      mode: 'light' as ThemeMode,
      size: 'default' as ThemeSize,
      color: '#1890ff',
      radius: 6
    }
    
    setPreviewMode(defaultSettings.mode)
    setPreviewSize(defaultSettings.size)
    setPreviewColor(defaultSettings.color)
    setPreviewRadius(defaultSettings.radius)
    
    setThemeMode(defaultSettings.mode)
    setThemeSize(defaultSettings.size)
    setPrimaryColor(defaultSettings.color)
    setBorderRadius(defaultSettings.radius)
    
    message.success('主题设置已重置')
  }

  // 复制主题配置
  const copyThemeConfig = () => {
    const config = {
      mode: previewMode,
      size: previewSize,
      primaryColor: previewColor,
      borderRadius: previewRadius
    }
    
    navigator.clipboard.writeText(JSON.stringify(config, null, 2))
    message.success('主题配置已复制到剪贴板')
  }

  return (
    <Drawer
      title={
        <Space>
          <SettingOutlined />
          <span>主题设置</span>
        </Space>
      }
      placement="right"
      onClose={onClose}
      open={open}
      width={320}
      footer={
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Button onClick={resetSettings} icon={<ReloadOutlined />}>
            重置
          </Button>
          <Space>
            <Button onClick={copyThemeConfig}>
              复制配置
            </Button>
            <Button type="primary" onClick={applyPreview}>
              应用
            </Button>
          </Space>
        </Space>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        {/* 快速切换 */}
        <Card size="small" title="快速切换">
          <Space direction="vertical" style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text>深色模式</Text>
              <Switch
                checked={isDark}
                onChange={toggleTheme}
                checkedChildren={<MoonOutlined />}
                unCheckedChildren={<SunOutlined />}
              />
            </div>
          </Space>
        </Card>

        {/* 主题模式 */}
        <Card size="small" title={
          <Space>
            <BgColorsOutlined />
            <span>主题模式</span>
          </Space>
        }>
          <Radio.Group
            value={previewMode}
            onChange={(e) => setPreviewMode(e.target.value)}
            style={{ width: '100%' }}
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              {themeModeOptions.map(option => (
                <Radio key={option.value} value={option.value} style={{ width: '100%' }}>
                  <Space>
                    {option.icon}
                    {option.label}
                  </Space>
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        </Card>

        {/* 主题尺寸 */}
        <Card size="small" title={
          <Space>
            <FontSizeOutlined />
            <span>主题尺寸</span>
          </Space>
        }>
          <Radio.Group
            value={previewSize}
            onChange={(e) => setPreviewSize(e.target.value)}
            style={{ width: '100%' }}
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              {themeSizeOptions.map(option => (
                <Radio key={option.value} value={option.value} style={{ width: '100%' }}>
                  {option.label}
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        </Card>

        {/* 主题色 */}
        <Card size="small" title={
          <Space>
            <BgColorsOutlined />
            <span>主题色</span>
          </Space>
        }>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Row gutter={[8, 8]}>
              {presetColors.map(color => (
                <Col span={6} key={color}>
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '6px',
                      backgroundColor: color,
                      cursor: 'pointer',
                      border: previewColor === color ? '2px solid #1890ff' : '1px solid #d9d9d9',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    onClick={() => setPreviewColor(color)}
                  >
                    {previewColor === color && (
                      <div style={{ width: '8px', height: '8px', backgroundColor: '#fff', borderRadius: '50%' }} />
                    )}
                  </div>
                </Col>
              ))}
            </Row>
            
            <Divider style={{ margin: '12px 0' }} />
            
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text>自定义颜色</Text>
              <ColorPicker
                value={previewColor}
                onChange={(color) => setPreviewColor(color.toHexString())}
                showText
              />
            </div>
          </Space>
        </Card>

        {/* 圆角设置 */}
        <Card size="small" title={
          <Space>
            <BorderOutlined />
            <span>圆角大小</span>
          </Space>
        }>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Slider
              value={previewRadius}
              onChange={setPreviewRadius}
              min={0}
              max={20}
              marks={{
                0: '0px',
                6: '6px',
                12: '12px',
                20: '20px'
              }}
              tooltip={{ formatter: (value) => `${value}px` }}
            />
            <div style={{ textAlign: 'center' }}>
              <Text type="secondary">当前: {previewRadius}px</Text>
            </div>
          </Space>
        </Card>

        {/* 预览区域 */}
        <Card size="small" title="预览效果">
          <Space direction="vertical" style={{ width: '100%' }}>
            <div
              style={{
                padding: '16px',
                backgroundColor: 'var(--component-background)',
                border: '1px solid var(--border-color)',
                borderRadius: `${previewRadius}px`,
                transition: 'all 0.3s'
              }}
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                <Button type="primary" style={{ backgroundColor: previewColor, borderColor: previewColor }}>
                  主要按钮
                </Button>
                <Button>默认按钮</Button>
                <div style={{ 
                  padding: '8px 12px', 
                  backgroundColor: previewColor, 
                  color: '#fff', 
                  borderRadius: `${previewRadius}px`,
                  fontSize: previewSize === 'compact' ? '12px' : previewSize === 'comfortable' ? '16px' : '14px'
                }}>
                  {previewSize === 'compact' ? '紧凑模式' : previewSize === 'comfortable' ? '舒适模式' : '默认模式'}
                </div>
              </Space>
            </div>
          </Space>
        </Card>

        {/* 说明信息 */}
        <Card size="small" title="说明">
          <Space direction="vertical" style={{ width: '100%' }}>
            <Text type="secondary" style={{ fontSize: '12px' }}>
              • 浅色/深色: 手动切换主题模式
            </Text>
            <Text type="secondary" style={{ fontSize: '12px' }}>
              • 自动: 跟随系统主题设置
            </Text>
            <Text type="secondary" style={{ fontSize: '12px' }}>
              • 设置会自动保存到本地存储
            </Text>
          </Space>
        </Card>
      </Space>
    </Drawer>
  )
}

export default ThemeSettings