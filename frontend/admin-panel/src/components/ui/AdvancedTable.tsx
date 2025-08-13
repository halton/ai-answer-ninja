import React, { useState, useMemo, useCallback } from 'react'
import {
  Table,
  Input,
  Button,
  Space,
  Dropdown,
  Tooltip,
  Tag,
  Modal,
  message,
  Popconfirm
} from 'antd'
import {
  SearchOutlined,
  DownloadOutlined,
  ReloadOutlined,
  SettingOutlined,
  FilterOutlined,
  ClearOutlined,
  EyeOutlined,
  EditOutlined,
  DeleteOutlined
} from '@ant-design/icons'
import type { ColumnsType, TableProps } from 'antd/es/table'
import type { MenuProps } from 'antd'
import { useDebounce } from 'use-debounce'
import dayjs from 'dayjs'

export interface AdvancedTableColumn<T = any> {
  key: string
  title: string
  dataIndex: string | string[]
  width?: number | string
  align?: 'left' | 'center' | 'right'
  sorter?: boolean | ((a: T, b: T) => number)
  filterable?: boolean
  searchable?: boolean
  render?: (value: any, record: T, index: number) => React.ReactNode
  exportable?: boolean
  fixed?: 'left' | 'right'
}

export interface TableAction<T = any> {
  key: string
  label: string
  icon?: React.ReactNode
  type?: 'primary' | 'default' | 'dashed' | 'text' | 'link'
  danger?: boolean
  disabled?: (record: T) => boolean
  visible?: (record: T) => boolean
  confirm?: {
    title: string
    description?: string
  }
  onClick: (record: T, index: number) => void | Promise<void>
}

export interface AdvancedTableProps<T = any> {
  columns: AdvancedTableColumn<T>[]
  dataSource: T[]
  loading?: boolean
  rowKey?: string | ((record: T) => string)
  title?: string
  showSearch?: boolean
  showRefresh?: boolean
  showExport?: boolean
  showColumnSettings?: boolean
  showBatchActions?: boolean
  batchActions?: TableAction<T>[]
  rowActions?: TableAction<T>[]
  pagination?: {
    current: number
    pageSize: number
    total: number
    showSizeChanger?: boolean
    showQuickJumper?: boolean
    pageSizeOptions?: string[]
  }
  onTableChange?: (pagination: any, filters: any, sorter: any) => void
  onRefresh?: () => void
  onExport?: (selectedRows?: T[]) => void
  onSearch?: (keyword: string) => void
  className?: string
  size?: 'small' | 'middle' | 'large'
}

const AdvancedTable = <T extends Record<string, any>>({
  columns,
  dataSource,
  loading = false,
  rowKey = 'id',
  title,
  showSearch = true,
  showRefresh = true,
  showExport = true,
  showColumnSettings = true,
  showBatchActions = false,
  batchActions = [],
  rowActions = [],
  pagination,
  onTableChange,
  onRefresh,
  onExport,
  onSearch,
  className = '',
  size = 'middle'
}: AdvancedTableProps<T>) => {
  const [searchKeyword, setSearchKeyword] = useState('')
  const [debouncedKeyword] = useDebounce(searchKeyword, 300)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    columns.map(col => col.key)
  )
  const [columnSettingsVisible, setColumnSettingsVisible] = useState(false)

  // 处理搜索
  React.useEffect(() => {
    if (onSearch && debouncedKeyword !== searchKeyword) {
      onSearch(debouncedKeyword)
    }
  }, [debouncedKeyword, onSearch])

  // 过滤显示的列
  const visibleColumnsList = useMemo(() => {
    return columns.filter(col => visibleColumns.includes(col.key))
  }, [columns, visibleColumns])

  // 构建 Ant Design 表格列配置
  const antdColumns: ColumnsType<T> = useMemo(() => {
    const cols = visibleColumnsList.map(col => ({
      key: col.key,
      title: col.title,
      dataIndex: col.dataIndex,
      width: col.width,
      align: col.align,
      fixed: col.fixed,
      sorter: col.sorter === true ? true : col.sorter,
      render: col.render || ((value: any) => {
        if (value == null) return '-'
        if (typeof value === 'boolean') {
          return <Tag color={value ? 'success' : 'error'}>{value ? '是' : '否'}</Tag>
        }
        if (col.dataIndex === 'createdAt' || col.dataIndex === 'updatedAt') {
          return dayjs(value).format('YYYY-MM-DD HH:mm:ss')
        }
        return value
      })
    }))

    // 添加操作列
    if (rowActions.length > 0) {
      cols.push({
        key: 'actions',
        title: '操作',
        fixed: 'right',
        width: Math.min(rowActions.length * 80 + 40, 200),
        render: (_, record: T, index: number) => (
          <Space size="small">
            {rowActions
              .filter(action => !action.visible || action.visible(record))
              .slice(0, 3) // 最多显示3个直接操作
              .map(action => {
                const ActionButton = action.confirm ? (
                  <Popconfirm
                    key={action.key}
                    title={action.confirm.title}
                    description={action.confirm.description}
                    onConfirm={() => action.onClick(record, index)}
                    okText="确定"
                    cancelText="取消"
                  >
                    <Button
                      type={action.type}
                      danger={action.danger}
                      disabled={action.disabled?.(record)}
                      size="small"
                      icon={action.icon}
                    >
                      {action.label}
                    </Button>
                  </Popconfirm>
                ) : (
                  <Button
                    key={action.key}
                    type={action.type}
                    danger={action.danger}
                    disabled={action.disabled?.(record)}
                    size="small"
                    icon={action.icon}
                    onClick={() => action.onClick(record, index)}
                  >
                    {action.label}
                  </Button>
                )

                return ActionButton
              })}

            {/* 更多操作下拉菜单 */}
            {rowActions.length > 3 && (
              <Dropdown
                menu={{
                  items: rowActions
                    .slice(3)
                    .filter(action => !action.visible || action.visible(record))
                    .map(action => ({
                      key: action.key,
                      label: action.label,
                      icon: action.icon,
                      danger: action.danger,
                      disabled: action.disabled?.(record),
                      onClick: () => action.onClick(record, index)
                    }))
                }}
                placement="bottomRight"
              >
                <Button size="small" icon={<SettingOutlined />} />
              </Dropdown>
            )}
          </Space>
        )
      })
    }

    return cols
  }, [visibleColumnsList, rowActions])

  // 行选择配置
  const rowSelection = useMemo(() => {
    if (!showBatchActions && batchActions.length === 0) return undefined

    return {
      selectedRowKeys,
      onChange: setSelectedRowKeys,
      getCheckboxProps: (record: T) => ({
        name: record[typeof rowKey === 'string' ? rowKey : 'id']
      })
    }
  }, [selectedRowKeys, showBatchActions, batchActions.length, rowKey])

  // 导出功能
  const handleExport = useCallback(() => {
    const selectedData = dataSource.filter((item, index) =>
      selectedRowKeys.includes(
        typeof rowKey === 'string' ? item[rowKey] : rowKey(item)
      )
    )
    onExport?.(selectedData.length > 0 ? selectedData : dataSource)
    message.success(`导出${selectedData.length > 0 ? selectedData.length : dataSource.length}条数据`)
  }, [dataSource, selectedRowKeys, rowKey, onExport])

  // 批量操作下拉菜单
  const batchActionMenuItems: MenuProps['items'] = batchActions.map(action => ({
    key: action.key,
    label: action.label,
    icon: action.icon,
    danger: action.danger,
    onClick: () => {
      const selectedData = dataSource.filter((item, index) =>
        selectedRowKeys.includes(
          typeof rowKey === 'string' ? item[rowKey] : rowKey(item)
        )
      )
      action.onClick(selectedData as any, -1)
    }
  }))

  // 列设置选项
  const columnSettingsItems: MenuProps['items'] = columns.map(col => ({
    key: col.key,
    label: (
      <div className="flex items-center justify-between">
        <span>{col.title}</span>
        <input
          type="checkbox"
          checked={visibleColumns.includes(col.key)}
          onChange={(e) => {
            if (e.target.checked) {
              setVisibleColumns(prev => [...prev, col.key])
            } else {
              setVisibleColumns(prev => prev.filter(key => key !== col.key))
            }
          }}
        />
      </div>
    )
  }))

  return (
    <div className={`advanced-table ${className}`}>
      {/* 表格头部工具栏 */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          {title && <h3 className="text-lg font-semibold">{title}</h3>}
          {selectedRowKeys.length > 0 && (
            <span className="text-sm text-gray-500">
              已选择 {selectedRowKeys.length} 项
            </span>
          )}
        </div>

        <Space>
          {/* 搜索框 */}
          {showSearch && (
            <Input
              placeholder="搜索..."
              prefix={<SearchOutlined />}
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              style={{ width: 200 }}
              allowClear
            />
          )}

          {/* 批量操作 */}
          {batchActions.length > 0 && selectedRowKeys.length > 0 && (
            <Dropdown menu={{ items: batchActionMenuItems }}>
              <Button icon={<FilterOutlined />}>
                批量操作
              </Button>
            </Dropdown>
          )}

          {/* 刷新 */}
          {showRefresh && (
            <Tooltip title="刷新">
              <Button
                icon={<ReloadOutlined />}
                onClick={onRefresh}
                loading={loading}
              />
            </Tooltip>
          )}

          {/* 导出 */}
          {showExport && (
            <Tooltip title="导出数据">
              <Button
                icon={<DownloadOutlined />}
                onClick={handleExport}
              />
            </Tooltip>
          )}

          {/* 列设置 */}
          {showColumnSettings && (
            <Dropdown
              menu={{ items: columnSettingsItems }}
              trigger={['click']}
            >
              <Button icon={<SettingOutlined />} />
            </Dropdown>
          )}

          {/* 清除选择 */}
          {selectedRowKeys.length > 0 && (
            <Button
              icon={<ClearOutlined />}
              onClick={() => setSelectedRowKeys([])}
            >
              清除选择
            </Button>
          )}
        </Space>
      </div>

      {/* 表格主体 */}
      <Table<T>
        columns={antdColumns}
        dataSource={dataSource}
        loading={loading}
        rowKey={rowKey}
        rowSelection={rowSelection}
        pagination={pagination ? {
          ...pagination,
          showSizeChanger: pagination.showSizeChanger ?? true,
          showQuickJumper: pagination.showQuickJumper ?? true,
          showTotal: (total, range) => 
            `第 ${range[0]}-${range[1]} 条/共 ${total} 条`,
          pageSizeOptions: pagination.pageSizeOptions ?? ['10', '20', '50', '100']
        } : false}
        onChange={onTableChange}
        size={size}
        scroll={{ x: 'max-content' }}
        className="shadow-sm border border-gray-200 rounded-lg"
      />
    </div>
  )
}

export default AdvancedTable