import React from 'react'
import { Spin } from 'antd'

const GlobalLoading: React.FC = () => {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(255, 255, 255, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        backdropFilter: 'blur(4px)',
      }}
    >
      <Spin 
        size="large" 
        tip="正在加载..." 
        style={{
          color: '#1890ff',
          fontSize: 16,
        }}
      />
    </div>
  )
}

export default GlobalLoading