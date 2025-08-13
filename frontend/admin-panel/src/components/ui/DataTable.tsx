import React from 'react'
import { Table, Card, Space, Button, Input, Typography } from 'antd'
import { SearchOutlined, ReloadOutlined, ExportOutlined } from '@ant-design/icons'
import type { TableProps, ColumnsType } from 'antd/es/table'

const { Title } = Typography

export interface DataTableProps<T> extends TableProps<T> {
  title?: string
  searchable?: boolean
  exportable?: boolean
  refreshable?: boolean
  onSearch?: (value: string) => void
  onRefresh?: () => void
  onExport?: () => void
  extra?: React.ReactNode
}

function DataTable<T extends Record<string, any>>({
  title,
  searchable = true,
  exportable = true,
  refreshable = true,
  onSearch,
  onRefresh,
  onExport,
  extra,
  ...tableProps
}: DataTableProps<T>) {
  return (
    <Card
      title={title && <Title level={4} style={{ margin: 0 }}>{title}</Title>}
      extra={
        <Space>
          {searchable && (
            <Input.Search
              placeholder="搜索..."
              style={{ width: 200 }}
              onSearch={onSearch}
              allowClear
            />
          )}
          {refreshable && (
            <Button icon={<ReloadOutlined />} onClick={onRefresh}>
              刷新
            </Button>
          )}
          {exportable && (
            <Button icon={<ExportOutlined />} onClick={onExport}>
              导出
            </Button>
          )}
          {extra}
        </Space>
      }
    >
      <Table<T>
        {...tableProps}
        pagination={{
          showSizeChanger: true,
          showQuickJumper: true,
          showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
          ...tableProps.pagination
        }}
      />
    </Card>
  )
}

export default DataTable