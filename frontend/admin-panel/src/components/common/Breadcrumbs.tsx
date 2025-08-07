import React from 'react'
import { Breadcrumb } from 'antd'
import { Link } from 'react-router-dom'
import { HomeOutlined } from '@ant-design/icons'
import { useUIStore } from '@/store'

const Breadcrumbs: React.FC = () => {
  const { breadcrumbs } = useUIStore()

  if (breadcrumbs.length <= 1) {
    return null
  }

  const items = breadcrumbs.map((crumb, index) => {
    const isLast = index === breadcrumbs.length - 1
    const isFirst = index === 0

    return {
      key: crumb.path || crumb.title,
      title: isFirst ? (
        <Link to={crumb.path || '/'}>
          <HomeOutlined style={{ marginRight: 4 }} />
          {crumb.title}
        </Link>
      ) : isLast ? (
        <span style={{ color: '#262626' }}>
          {crumb.title}
        </span>
      ) : (
        <Link to={crumb.path || '/'}>
          {crumb.title}
        </Link>
      ),
    }
  })

  return (
    <Breadcrumb
      items={items}
      style={{ 
        fontSize: 14,
        color: '#8c8c8c'
      }}
    />
  )
}

export default Breadcrumbs