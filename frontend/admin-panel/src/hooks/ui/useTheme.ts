import { useState, useEffect, useCallback } from 'react'
import { ConfigProvider, theme } from 'antd'

export type ThemeMode = 'light' | 'dark' | 'auto'
export type ThemeSize = 'default' | 'compact' | 'comfortable'

interface ThemeConfig {
  mode: ThemeMode
  size: ThemeSize
  primaryColor?: string
  borderRadius?: number
}

interface UseThemeReturn {
  themeConfig: ThemeConfig
  isDark: boolean
  toggleTheme: () => void
  setThemeMode: (mode: ThemeMode) => void
  setThemeSize: (size: ThemeSize) => void
  setPrimaryColor: (color: string) => void
  setBorderRadius: (radius: number) => void
  antdTheme: any
}

const THEME_STORAGE_KEY = 'ai-ninja-theme'

const defaultThemeConfig: ThemeConfig = {
  mode: 'light',
  size: 'default',
  primaryColor: '#1890ff',
  borderRadius: 6
}

export const useTheme = (): UseThemeReturn => {
  const [themeConfig, setThemeConfig] = useState<ThemeConfig>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (saved) {
      try {
        return { ...defaultThemeConfig, ...JSON.parse(saved) }
      } catch {
        return defaultThemeConfig
      }
    }
    return defaultThemeConfig
  })

  const [systemDark, setSystemDark] = useState(false)

  // 监听系统主题变化
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemDark(mediaQuery.matches)

    const handleChange = (e: MediaQueryListEvent) => {
      setSystemDark(e.matches)
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  // 计算实际是否为暗色主题
  const isDark = themeConfig.mode === 'dark' || (themeConfig.mode === 'auto' && systemDark)

  // 应用主题到DOM
  useEffect(() => {
    const root = document.documentElement
    
    // 设置主题模式
    root.setAttribute('data-theme', isDark ? 'dark' : 'light')
    
    // 设置主题尺寸
    root.setAttribute('data-size', themeConfig.size)
    
    // 设置主色调
    if (themeConfig.primaryColor) {
      root.style.setProperty('--primary-color', themeConfig.primaryColor)
    }
    
    // 设置圆角
    if (themeConfig.borderRadius !== undefined) {
      root.style.setProperty('--border-radius-base', `${themeConfig.borderRadius}px`)
    }
  }, [isDark, themeConfig])

  // 保存主题配置
  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(themeConfig))
  }, [themeConfig])

  // 切换主题模式
  const toggleTheme = useCallback(() => {
    setThemeConfig(prev => ({
      ...prev,
      mode: prev.mode === 'light' ? 'dark' : prev.mode === 'dark' ? 'auto' : 'light'
    }))
  }, [])

  // 设置主题模式
  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeConfig(prev => ({ ...prev, mode }))
  }, [])

  // 设置主题尺寸
  const setThemeSize = useCallback((size: ThemeSize) => {
    setThemeConfig(prev => ({ ...prev, size }))
  }, [])

  // 设置主色调
  const setPrimaryColor = useCallback((color: string) => {
    setThemeConfig(prev => ({ ...prev, primaryColor: color }))
  }, [])

  // 设置圆角
  const setBorderRadius = useCallback((radius: number) => {
    setThemeConfig(prev => ({ ...prev, borderRadius: radius }))
  }, [])

  // 生成 Antd 主题配置
  const antdTheme = {
    algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: themeConfig.primaryColor,
      borderRadius: themeConfig.borderRadius,
      // 根据主题尺寸调整字体大小
      fontSize: themeConfig.size === 'compact' ? 12 : themeConfig.size === 'comfortable' ? 16 : 14,
      // 其他主题配置
      colorBgContainer: isDark ? '#1f1f1f' : '#ffffff',
      colorBgElevated: isDark ? '#262626' : '#ffffff',
      colorBgLayout: isDark ? '#000000' : '#f0f2f5',
      colorText: isDark ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.85)',
      colorTextSecondary: isDark ? 'rgba(255, 255, 255, 0.45)' : 'rgba(0, 0, 0, 0.45)',
      colorBorder: isDark ? '#434343' : '#d9d9d9',
      colorSplit: isDark ? '#303030' : '#f0f0f0'
    },
    components: {
      Layout: {
        headerBg: isDark ? '#001529' : '#001529',
        siderBg: isDark ? '#001529' : '#001529',
        triggerBg: isDark ? '#002140' : '#002140'
      },
      Menu: {
        darkItemBg: isDark ? '#001529' : '#001529',
        darkSubMenuItemBg: isDark ? '#000c17' : '#000c17',
        darkItemSelectedBg: isDark ? '#1890ff' : '#1890ff'
      },
      Card: {
        headerBg: isDark ? '#1f1f1f' : '#fafafa'
      },
      Table: {
        headerBg: isDark ? '#262626' : '#fafafa',
        rowHoverBg: isDark ? '#262626' : '#f5f5f5'
      }
    }
  }

  return {
    themeConfig,
    isDark,
    toggleTheme,
    setThemeMode,
    setThemeSize,
    setPrimaryColor,
    setBorderRadius,
    antdTheme
  }
}