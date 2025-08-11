import React from 'react'
import { Spin } from 'antd'
import { useUIStore } from '@/store'

interface GlobalLoadingProps {
  size?: 'small' | 'default' | 'large'
  tip?: string
  blur?: number
}

const GlobalLoading: React.FC<GlobalLoadingProps> = ({ 
  size = 'large',
  tip,
  blur = 4
}) => {
  const { globalLoading, loadingText, darkMode } = useUIStore()

  if (!globalLoading) {
    return null
  }

  const backgroundColor = darkMode 
    ? 'rgba(0, 0, 0, 0.8)' 
    : 'rgba(255, 255, 255, 0.8)'
    
  const cardBackground = darkMode
    ? '#1f1f1f'
    : '#fff'

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor,
        backdropFilter: `blur(${blur}px)`,
        zIndex: 9999,
        transition: 'all 0.3s ease',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '32px',
          backgroundColor: cardBackground,
          borderRadius: '12px',
          boxShadow: darkMode 
            ? '0 8px 32px rgba(0, 0, 0, 0.4)' 
            : '0 8px 32px rgba(0, 0, 0, 0.1)',
          minWidth: '160px',
          border: darkMode ? '1px solid #303030' : '1px solid #f0f0f0',
        }}
      >
        <Spin size={size} />
        {(tip || loadingText) && (
          <div
            style={{
              marginTop: '16px',
              color: darkMode ? '#d9d9d9' : '#666',
              fontSize: '14px',
              textAlign: 'center',
              lineHeight: 1.5,
            }}
          >
            {tip || loadingText}
          </div>
        )}
      </div>
    </div>
  )
}

export default GlobalLoading