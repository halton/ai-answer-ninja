import React, { useState, useEffect, useMemo } from 'react'
import {
  Card,
  Table,
  Button,
  Input,
  Select,
  DatePicker,
  Space,
  Tag,
  Typography,
  Modal,
  Descriptions,
  Divider,
  Avatar,
  Badge,
  Tooltip,
  Progress,
  Row,
  Col,
  Statistic
} from 'antd'
import {
  SearchOutlined,
  FilterOutlined,
  PlayCircleOutlined,
  DownloadOutlined,
  EyeOutlined,
  SoundOutlined,
  PhoneOutlined,
  ClockCircleOutlined,
  UserOutlined,
  BarChartOutlined
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table'
import type { FilterValue, SorterResult } from 'antd/es/table/interface'

const { RangePicker } = DatePicker
const { Option } = Select
const { Text, Title } = Typography

// 通话记录数据类型
interface CallRecord {
  id: string
  userId: string
  userName: string
  callerPhone: string
  callerName?: string
  callType: 'spam' | 'normal' | 'whitelist'
  callStatus: 'completed' | 'missed' | 'declined' | 'failed'
  startTime: string
  endTime?: string
  duration: number // 秒
  audioUrl?: string
  summary?: string
  spamCategory?: string
  aiResponseCount: number
  effectiveness?: number // 0-1
  emotions?: string[]
  userFeedback?: 'helpful' | 'not_helpful'
}

// 查询参数
interface CallHistoryParams {
  page: number
  pageSize: number
  keyword?: string
  callType?: string
  callStatus?: string
  dateRange?: [string, string]
  userId?: string
}

const CallHistory: React.FC = () => {
  const [selectedRecord, setSelectedRecord] = useState<CallRecord | null>(null)
  const [detailModalVisible, setDetailModalVisible] = useState(false)
  const [audioModalVisible, setAudioModalVisible] = useState(false)
  const [filters, setFilters] = useState<CallHistoryParams>({
    page: 1,
    pageSize: 20
  })

  // 查询通话记录
  const { data: callData, isLoading, refetch } = useQuery({
    queryKey: ['callHistory', filters],
    queryFn: async () => {
      // 模拟API调用
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      return {
        records: generateMockCallRecords(),
        total: 156,
        stats: {
          totalCalls: 156,
          spamCalls: 89,
          averageDuration: 45,
          successRate: 0.92
        }
      }
    }
  })

  // 通话类型配置
  const callTypeConfig = {
    spam: { label: '骚扰电话', color: 'red' },
    normal: { label: '正常通话', color: 'blue' },
    whitelist: { label: '白名单', color: 'green' }
  }

  // 通话状态配置
  const callStatusConfig = {
    completed: { label: '已完成', color: 'success' },
    missed: { label: '未接听', color: 'warning' },
    declined: { label: '已拒绝', color: 'error' },
    failed: { label: '失败', color: 'default' }
  }

  // 表格列定义
  const columns: ColumnsType<CallRecord> = [
    {
      title: '通话信息',
      dataIndex: 'callerPhone',
      key: 'callerInfo',
      width: 200,
      render: (phone: string, record: CallRecord) => (
        <Space direction="vertical" size="small">
          <Space>
            <Avatar icon={<UserOutlined />} size="small" />
            <div>
              <div style={{ fontWeight: 500 }}>{record.callerName || '未知用户'}</div>
              <Text type="secondary" style={{ fontSize: '12px' }}>{phone}</Text>
            </div>
          </Space>
        </Space>
      )
    },
    {
      title: '通话类型',
      dataIndex: 'callType',
      key: 'callType',
      width: 100,
      filters: Object.entries(callTypeConfig).map(([key, config]) => ({
        text: config.label,
        value: key
      })),
      render: (type: string) => {
        const config = callTypeConfig[type as keyof typeof callTypeConfig]
        return <Tag color={config.color}>{config.label}</Tag>
      }
    },
    {
      title: '状态',
      dataIndex: 'callStatus',
      key: 'callStatus',
      width: 100,
      filters: Object.entries(callStatusConfig).map(([key, config]) => ({
        text: config.label,
        value: key
      })),
      render: (status: string) => {
        const config = callStatusConfig[status as keyof typeof callStatusConfig]
        return <Badge status={config.color as any} text={config.label} />
      }
    },
    {
      title: '时长',
      dataIndex: 'duration',
      key: 'duration',
      width: 80,
      sorter: true,
      render: (duration: number) => (
        <Text>{formatDuration(duration)}</Text>
      )
    },
    {
      title: '开始时间',
      dataIndex: 'startTime',
      key: 'startTime',
      width: 150,
      sorter: true,
      render: (time: string) => (
        <Space direction="vertical" size="small">
          <Text>{dayjs(time).format('MM-DD HH:mm')}</Text>
          <Text type="secondary" style={{ fontSize: '12px' }}>
            {dayjs(time).fromNow()}
          </Text>
        </Space>
      )
    },
    {
      title: 'AI响应',
      dataIndex: 'aiResponseCount',
      key: 'aiResponseCount',
      width: 80,
      render: (count: number, record: CallRecord) => (
        <Space direction="vertical" size="small" align="center">
          <Text strong>{count}</Text>
          {record.effectiveness !== undefined && (
            <Progress
              percent={Math.round(record.effectiveness * 100)}
              size="small"
              showInfo={false}
              strokeColor={record.effectiveness > 0.8 ? '#52c41a' : record.effectiveness > 0.6 ? '#faad14' : '#ff4d4f'}
            />
          )}
        </Space>
      )
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_, record: CallRecord) => (
        <Space wrap>
          <Tooltip title="查看详情">
            <Button
              type="text"
              icon={<EyeOutlined />}
              onClick={() => handleViewDetail(record)}
            />
          </Tooltip>
          {record.audioUrl && (
            <Tooltip title="播放录音">
              <Button
                type="text"
                icon={<SoundOutlined />}
                onClick={() => handlePlayAudio(record)}
              />
            </Tooltip>
          )}
          <Tooltip title="下载录音">
            <Button
              type="text"
              icon={<DownloadOutlined />}
              onClick={() => handleDownload(record)}
            />
          </Tooltip>
        </Space>
      )
    }
  ]

  // 处理查看详情
  const handleViewDetail = (record: CallRecord) => {
    setSelectedRecord(record)
    setDetailModalVisible(true)
  }

  // 处理播放音频
  const handlePlayAudio = (record: CallRecord) => {
    setSelectedRecord(record)
    setAudioModalVisible(true)
  }

  // 处理下载
  const handleDownload = (record: CallRecord) => {
    if (record.audioUrl) {
      window.open(record.audioUrl, '_blank')
    }
  }

  // 处理表格变化
  const handleTableChange = (
    pagination: TablePaginationConfig,
    tableFilters: Record<string, FilterValue | null>,
    sorter: SorterResult<CallRecord> | SorterResult<CallRecord>[]
  ) => {
    const newFilters = {
      ...filters,
      page: pagination.current || 1,
      pageSize: pagination.pageSize || 20
    }

    // 处理筛选
    if (tableFilters.callType) {
      newFilters.callType = tableFilters.callType[0] as string
    }
    if (tableFilters.callStatus) {
      newFilters.callStatus = tableFilters.callStatus[0] as string
    }

    setFilters(newFilters)
  }

  // 处理搜索
  const handleSearch = (value: string) => {
    setFilters({
      ...filters,
      keyword: value,
      page: 1
    })
  }

  // 处理日期范围筛选
  const handleDateRangeChange = (dates: any) => {
    if (dates && dates.length === 2) {
      setFilters({
        ...filters,
        dateRange: [
          dates[0].format('YYYY-MM-DD'),
          dates[1].format('YYYY-MM-DD')
        ],
        page: 1
      })
    } else {
      const { dateRange, ...rest } = filters
      setFilters({ ...rest, page: 1 })
    }
  }

  // 重置筛选
  const handleReset = () => {
    setFilters({
      page: 1,
      pageSize: 20
    })
  }

  return (
    <div className="call-history">
      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="总通话数"
              value={callData?.stats.totalCalls || 0}
              prefix={<PhoneOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="骚扰电话"
              value={callData?.stats.spamCalls || 0}
              prefix={<FilterOutlined />}
              valueStyle={{ color: '#cf1322' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="平均时长"
              value={callData?.stats.averageDuration || 0}
              suffix="秒"
              prefix={<ClockCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="成功率"
              value={Math.round((callData?.stats.successRate || 0) * 100)}
              suffix="%"
              prefix={<BarChartOutlined />}
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 查询筛选 */}
      <Card style={{ marginBottom: 16 }}>
        <Space wrap style={{ marginBottom: 16 }}>
          <Input.Search
            placeholder="搜索电话号码或用户名"
            style={{ width: 200 }}
            onSearch={handleSearch}
            allowClear
          />
          <Select
            placeholder="通话类型"
            style={{ width: 120 }}
            allowClear
            onChange={(value) => setFilters({ ...filters, callType: value, page: 1 })}
            value={filters.callType}
          >
            {Object.entries(callTypeConfig).map(([key, config]) => (
              <Option key={key} value={key}>{config.label}</Option>
            ))}
          </Select>
          <Select
            placeholder="通话状态"
            style={{ width: 120 }}
            allowClear
            onChange={(value) => setFilters({ ...filters, callStatus: value, page: 1 })}
            value={filters.callStatus}
          >
            {Object.entries(callStatusConfig).map(([key, config]) => (
              <Option key={key} value={key}>{config.label}</Option>
            ))}
          </Select>
          <RangePicker
            placeholder={['开始日期', '结束日期']}
            onChange={handleDateRangeChange}
            style={{ width: 200 }}
          />
          <Button onClick={handleReset}>重置</Button>
        </Space>
      </Card>

      {/* 通话记录表格 */}
      <Card>
        <Table<CallRecord>
          columns={columns}
          dataSource={callData?.records || []}
          loading={isLoading}
          rowKey="id"
          onChange={handleTableChange}
          pagination={{
            current: filters.page,
            pageSize: filters.pageSize,
            total: callData?.total || 0,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`
          }}
          scroll={{ x: 1000 }}
        />
      </Card>

      {/* 详情模态框 */}
      <Modal
        title="通话详情"
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={null}
        width={800}
      >
        {selectedRecord && (
          <div>
            <Descriptions title="基本信息" bordered column={2}>
              <Descriptions.Item label="来电号码">
                {selectedRecord.callerPhone}
              </Descriptions.Item>
              <Descriptions.Item label="来电用户">
                {selectedRecord.callerName || '未知用户'}
              </Descriptions.Item>
              <Descriptions.Item label="通话类型">
                <Tag color={callTypeConfig[selectedRecord.callType as keyof typeof callTypeConfig].color}>
                  {callTypeConfig[selectedRecord.callType as keyof typeof callTypeConfig].label}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="通话状态">
                <Badge 
                  status={callStatusConfig[selectedRecord.callStatus as keyof typeof callStatusConfig].color as any} 
                  text={callStatusConfig[selectedRecord.callStatus as keyof typeof callStatusConfig].label} 
                />
              </Descriptions.Item>
              <Descriptions.Item label="开始时间">
                {dayjs(selectedRecord.startTime).format('YYYY-MM-DD HH:mm:ss')}
              </Descriptions.Item>
              <Descriptions.Item label="结束时间">
                {selectedRecord.endTime ? dayjs(selectedRecord.endTime).format('YYYY-MM-DD HH:mm:ss') : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="通话时长">
                {formatDuration(selectedRecord.duration)}
              </Descriptions.Item>
              <Descriptions.Item label="AI响应次数">
                {selectedRecord.aiResponseCount}
              </Descriptions.Item>
            </Descriptions>

            {selectedRecord.spamCategory && (
              <>
                <Divider />
                <Descriptions title="骚扰分析" bordered column={1}>
                  <Descriptions.Item label="骚扰类型">
                    <Tag color="red">{selectedRecord.spamCategory}</Tag>
                  </Descriptions.Item>
                  {selectedRecord.effectiveness !== undefined && (
                    <Descriptions.Item label="AI处理效果">
                      <Progress
                        percent={Math.round(selectedRecord.effectiveness * 100)}
                        status={selectedRecord.effectiveness > 0.8 ? 'success' : 'normal'}
                      />
                    </Descriptions.Item>
                  )}
                </Descriptions>
              </>
            )}

            {selectedRecord.summary && (
              <>
                <Divider />
                <div>
                  <Title level={5}>通话摘要</Title>
                  <Text>{selectedRecord.summary}</Text>
                </div>
              </>
            )}

            {selectedRecord.emotions && selectedRecord.emotions.length > 0 && (
              <>
                <Divider />
                <div>
                  <Title level={5}>情感分析</Title>
                  <Space wrap>
                    {selectedRecord.emotions.map((emotion, index) => (
                      <Tag key={index} color="blue">{emotion}</Tag>
                    ))}
                  </Space>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* 音频播放模态框 */}
      <Modal
        title="通话录音"
        open={audioModalVisible}
        onCancel={() => setAudioModalVisible(false)}
        footer={null}
        width={500}
      >
        {selectedRecord && selectedRecord.audioUrl && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <audio controls style={{ width: '100%' }}>
              <source src={selectedRecord.audioUrl} type="audio/mpeg" />
              您的浏览器不支持音频播放。
            </audio>
          </div>
        )}
      </Modal>
    </div>
  )
}

// 格式化时长
function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

// 生成模拟数据
function generateMockCallRecords(): CallRecord[] {
  const mockData: CallRecord[] = []
  const callTypes = ['spam', 'normal', 'whitelist']
  const callStatuses = ['completed', 'missed', 'declined', 'failed']
  const spamCategories = ['销售推广', '贷款理财', '房产中介', '保险销售', '诈骗电话']
  const emotions = ['愤怒', '厌烦', '冷静', '礼貌', '急躁']

  for (let i = 0; i < 20; i++) {
    const callType = callTypes[Math.floor(Math.random() * callTypes.length)]
    const callStatus = callStatuses[Math.floor(Math.random() * callStatuses.length)]
    const duration = Math.floor(Math.random() * 300) + 10
    const startTime = dayjs().subtract(Math.floor(Math.random() * 30), 'day').subtract(Math.floor(Math.random() * 24), 'hour')

    mockData.push({
      id: `call_${i + 1}`,
      userId: `user_${Math.floor(Math.random() * 50) + 1}`,
      userName: `用户${Math.floor(Math.random() * 50) + 1}`,
      callerPhone: `138${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`,
      callerName: Math.random() > 0.5 ? `来电者${i + 1}` : undefined,
      callType: callType as any,
      callStatus: callStatus as any,
      startTime: startTime.toISOString(),
      endTime: callStatus === 'completed' ? startTime.add(duration, 'second').toISOString() : undefined,
      duration,
      audioUrl: callStatus === 'completed' ? `/api/audio/call_${i + 1}.mp3` : undefined,
      summary: callType === 'spam' ? `这是一通${spamCategories[Math.floor(Math.random() * spamCategories.length)]}，AI成功进行了应答处理。` : undefined,
      spamCategory: callType === 'spam' ? spamCategories[Math.floor(Math.random() * spamCategories.length)] : undefined,
      aiResponseCount: Math.floor(Math.random() * 10) + 1,
      effectiveness: callType === 'spam' ? Math.random() : undefined,
      emotions: callType === 'spam' ? [emotions[Math.floor(Math.random() * emotions.length)]] : undefined,
      userFeedback: Math.random() > 0.7 ? (Math.random() > 0.5 ? 'helpful' : 'not_helpful') : undefined
    })
  }

  return mockData.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
}

export default CallHistory