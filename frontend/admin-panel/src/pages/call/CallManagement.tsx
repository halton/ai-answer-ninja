/**
 * Call Management Component
 * Advanced call history management with real-time monitoring, filtering, and analytics
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Tooltip,
  Modal,
  Form,
  Input,
  Select,
  DatePicker,
  Row,
  Col,
  Statistic,
  Progress,
  Badge,
  Drawer,
  Descriptions,
  Typography,
  Alert,
  Divider,
  Tabs,
  Switch,
  Avatar,
  List,
  Timeline,
  Upload,
  message,
  Popconfirm,
  Spin
} from 'antd';
import {
  PhoneOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  DownloadOutlined,
  FilterOutlined,
  ReloadOutlined,
  EyeOutlined,
  SearchOutlined,
  DeleteOutlined,
  ExportOutlined,
  AudioOutlined,
  ClockCircleOutlined,
  UserOutlined,
  SafetyOutlined,
  RobotOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  SoundOutlined,
  MessageOutlined,
  StarOutlined,
  ShareAltOutlined,
  FileTextOutlined,
  BarChartOutlined,
  SettingOutlined,
  CloudDownloadOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import dayjs from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import type { CallRecord, CallAnalysis, AIResponse } from '@/types';

const { Title, Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;
const { TabPane } = Tabs;
const { Option } = Select;

interface CallManagementProps {
  userId?: string;
  embedded?: boolean;
}

const CallManagement: React.FC<CallManagementProps> = ({ userId, embedded = false }) => {
  const navigate = useNavigate();
  
  // State management
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [filteredCalls, setFilteredCalls] = useState<CallRecord[]>([]);
  const [selectedCall, setSelectedCall] = useState<CallRecord | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [filterForm] = Form.useForm();
  
  // Audio playback state
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const [audioPlayer, setAudioPlayer] = useState<HTMLAudioElement | null>(null);
  
  // Filter state
  const [filters, setFilters] = useState({
    status: 'all',
    type: 'all',
    dateRange: [dayjs().subtract(7, 'days'), dayjs()],
    caller: '',
    duration: 'all',
    aiHandled: 'all'
  });
  
  // Statistics
  const [stats, setStats] = useState({
    totalCalls: 0,
    aiHandledCalls: 0,
    blockedCalls: 0,
    transferredCalls: 0,
    averageDuration: 0,
    averageLatency: 0,
    successRate: 0,
    satisfactionScore: 0
  });

  // Mock data for development
  useEffect(() => {
    const generateMockCalls = (): CallRecord[] => {
      const statuses = ['answered', 'missed', 'blocked', 'transferred'];
      const types = ['spam', 'normal', 'emergency', 'business'];
      const names = ['张三', '李四', '王五', '赵六', '钱七'];
      
      return Array.from({ length: 50 }, (_, i) => ({
        id: `call_${i + 1}`,
        userId: userId || 'user_1',
        callerPhone: `+86-138${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`,
        callerName: Math.random() > 0.3 ? names[Math.floor(Math.random() * names.length)] : undefined,
        callType: types[Math.floor(Math.random() * types.length)] as any,
        callStatus: statuses[Math.floor(Math.random() * statuses.length)] as any,
        startTime: dayjs().subtract(Math.floor(Math.random() * 168), 'hours').toISOString(),
        endTime: dayjs().subtract(Math.floor(Math.random() * 168) - Math.floor(Math.random() * 2), 'hours').toISOString(),
        duration: Math.floor(Math.random() * 300) + 10,
        aiHandled: Math.random() > 0.4,
        aiConfidence: Math.random(),
        spamScore: Math.random(),
        audioUrl: Math.random() > 0.3 ? `https://example.com/audio/call_${i + 1}.mp3` : undefined,
        transcription: Math.random() > 0.5 ? `这是通话 ${i + 1} 的转录内容...` : undefined,
        aiResponse: Math.random() > 0.6 ? `AI自动回复: 您好，我现在不方便接听电话...` : undefined,
        tags: Math.random() > 0.7 ? ['推销', '骚扰'] : [],
        quality: {
          audioQuality: Math.random(),
          responseTime: Math.floor(Math.random() * 2000) + 200,
          userSatisfaction: Math.random()
        },
        createdAt: dayjs().subtract(Math.floor(Math.random() * 168), 'hours').toISOString()
      }));
    };

    const mockCalls = generateMockCalls();
    setCalls(mockCalls);
    setFilteredCalls(mockCalls);
    
    // Calculate statistics
    const totalCalls = mockCalls.length;
    const aiHandledCalls = mockCalls.filter(call => call.aiHandled).length;
    const blockedCalls = mockCalls.filter(call => call.callStatus === 'blocked').length;
    const transferredCalls = mockCalls.filter(call => call.callStatus === 'transferred').length;
    const averageDuration = mockCalls.reduce((sum, call) => sum + call.duration, 0) / totalCalls;
    const averageLatency = mockCalls
      .filter(call => call.quality?.responseTime)
      .reduce((sum, call) => sum + (call.quality?.responseTime || 0), 0) / aiHandledCalls;
    const successRate = ((aiHandledCalls + transferredCalls) / totalCalls) * 100;
    const satisfactionScore = mockCalls
      .filter(call => call.quality?.userSatisfaction)
      .reduce((sum, call) => sum + (call.quality?.userSatisfaction || 0), 0) / totalCalls;
    
    setStats({
      totalCalls,
      aiHandledCalls,
      blockedCalls,
      transferredCalls,
      averageDuration,
      averageLatency,
      successRate,
      satisfactionScore
    });
    
    setLoading(false);
  }, [userId]);

  // Handle filter changes
  const handleFilterChange = useCallback((changedValues: any, allValues: any) => {
    setFilters(allValues);
    
    let filtered = calls;
    
    // Status filter
    if (allValues.status !== 'all') {
      filtered = filtered.filter(call => call.callStatus === allValues.status);
    }
    
    // Type filter
    if (allValues.type !== 'all') {
      filtered = filtered.filter(call => call.callType === allValues.type);
    }
    
    // AI handled filter
    if (allValues.aiHandled !== 'all') {
      filtered = filtered.filter(call => call.aiHandled === (allValues.aiHandled === 'true'));
    }
    
    // Caller filter
    if (allValues.caller) {
      filtered = filtered.filter(call => 
        call.callerPhone.includes(allValues.caller) || 
        (call.callerName && call.callerName.includes(allValues.caller))
      );
    }
    
    // Date range filter
    if (allValues.dateRange && allValues.dateRange.length === 2) {
      const [start, end] = allValues.dateRange;
      filtered = filtered.filter(call => {
        const callDate = dayjs(call.startTime);
        return callDate.isAfter(start) && callDate.isBefore(end.add(1, 'day'));
      });
    }
    
    setFilteredCalls(filtered);
  }, [calls]);

  // Audio playback controls
  const handlePlayAudio = useCallback((audioUrl: string, callId: string) => {
    if (playingAudio === callId) {
      audioPlayer?.pause();
      setPlayingAudio(null);
      return;
    }
    
    if (audioPlayer) {
      audioPlayer.pause();
    }
    
    const audio = new Audio(audioUrl);
    audio.play().then(() => {
      setPlayingAudio(callId);
      setAudioPlayer(audio);
    }).catch(() => {
      message.error('音频播放失败');
    });
    
    audio.onended = () => {
      setPlayingAudio(null);
      setAudioPlayer(null);
    };
  }, [playingAudio, audioPlayer]);

  // Get status color and text
  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'answered':
        return { color: 'success', text: '已接听' };
      case 'missed':
        return { color: 'warning', text: '未接听' };
      case 'blocked':
        return { color: 'error', text: '已拦截' };
      case 'transferred':
        return { color: 'processing', text: '已转接' };
      default:
        return { color: 'default', text: status };
    }
  };

  // Get call type info
  const getTypeInfo = (type: string) => {
    switch (type) {
      case 'spam':
        return { color: 'red', text: '骚扰电话', icon: <WarningOutlined /> };
      case 'normal':
        return { color: 'green', text: '正常通话', icon: <CheckCircleOutlined /> };
      case 'emergency':
        return { color: 'orange', text: '紧急通话', icon: <WarningOutlined /> };
      case 'business':
        return { color: 'blue', text: '商务通话', icon: <UserOutlined /> };
      default:
        return { color: 'default', text: type, icon: <PhoneOutlined /> };
    }
  };

  // Table columns configuration
  const columns: ColumnsType<CallRecord> = [
    {
      title: '来电信息',
      key: 'caller',
      width: 200,
      render: (_, record) => (
        <div>
          <div className="flex items-center mb-1">
            <Avatar size="small" icon={<UserOutlined />} className="mr-2" />
            <Text strong>{record.callerName || '未知联系人'}</Text>
          </div>
          <Text type="secondary" className="text-xs">{record.callerPhone}</Text>
        </div>
      ),
    },
    {
      title: '通话状态',
      dataIndex: 'callStatus',
      key: 'status',
      width: 100,
      render: (status) => {
        const { color, text } = getStatusInfo(status);
        return <Badge status={color as any} text={text} />;
      },
      filters: [
        { text: '已接听', value: 'answered' },
        { text: '未接听', value: 'missed' },
        { text: '已拦截', value: 'blocked' },
        { text: '已转接', value: 'transferred' }
      ],
    },
    {
      title: '通话类型',
      dataIndex: 'callType',
      key: 'type',
      width: 120,
      render: (type) => {
        const { color, text, icon } = getTypeInfo(type);
        return (
          <Tag color={color} icon={icon}>
            {text}
          </Tag>
        );
      },
    },
    {
      title: 'AI处理',
      dataIndex: 'aiHandled',
      key: 'aiHandled',
      width: 100,
      render: (aiHandled, record) => (
        <div>
          {aiHandled ? (
            <Tag color="blue" icon={<RobotOutlined />}>
              已处理
            </Tag>
          ) : (
            <Tag color="default">
              未处理
            </Tag>
          )}
          {record.aiConfidence && (
            <div className="mt-1">
              <Progress 
                percent={record.aiConfidence * 100} 
                size="small" 
                showInfo={false}
                strokeColor="#1890ff"
              />
            </div>
          )}
        </div>
      ),
    },
    {
      title: '通话时长',
      dataIndex: 'duration',
      key: 'duration',
      width: 100,
      render: (duration) => {
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        return (
          <Tooltip title={`${duration}秒`}>
            <Text>{minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`}</Text>
          </Tooltip>
        );
      },
      sorter: (a, b) => a.duration - b.duration,
    },
    {
      title: '开始时间',
      dataIndex: 'startTime',
      key: 'startTime',
      width: 150,
      render: (time) => (
        <div>
          <div>{dayjs(time).format('MM-DD HH:mm')}</div>
          <Text type="secondary" className="text-xs">
            {dayjs(time).fromNow()}
          </Text>
        </div>
      ),
      sorter: (a, b) => dayjs(a.startTime).unix() - dayjs(b.startTime).unix(),
      defaultSortOrder: 'descend',
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_, record) => (
        <Space>
          <Tooltip title="查看详情">
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => {
                setSelectedCall(record);
                setDetailVisible(true);
              }}
            />
          </Tooltip>
          
          {record.audioUrl && (
            <Tooltip title="播放录音">
              <Button
                type="text"
                size="small"
                icon={playingAudio === record.id ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                onClick={() => handlePlayAudio(record.audioUrl!, record.id)}
              />
            </Tooltip>
          )}
          
          <Tooltip title="下载录音">
            <Button
              type="text"
              size="small"
              icon={<DownloadOutlined />}
              disabled={!record.audioUrl}
            />
          </Tooltip>
          
          <Tooltip title="删除记录">
            <Popconfirm
              title="确定要删除这条通话记录吗？"
              onConfirm={() => {
                setCalls(prev => prev.filter(call => call.id !== record.id));
                setFilteredCalls(prev => prev.filter(call => call.id !== record.id));
                message.success('通话记录已删除');
              }}
            >
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
              />
            </Popconfirm>
          </Tooltip>
        </Space>
      ),
    },
  ];

  // Render call detail drawer
  const renderCallDetail = () => {
    if (!selectedCall) return null;

    return (
      <Drawer
        title="通话详情"
        width={720}
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
        extra={
          <Space>
            {selectedCall.audioUrl && (
              <Button 
                type="primary"
                icon={<SoundOutlined />}
                onClick={() => handlePlayAudio(selectedCall.audioUrl!, selectedCall.id)}
              >
                {playingAudio === selectedCall.id ? '暂停' : '播放'}录音
              </Button>
            )}
            <Button icon={<ExportOutlined />}>导出</Button>
          </Space>
        }
      >
        <Tabs defaultActiveKey="basic">
          <TabPane tab="基本信息" key="basic">
            <Descriptions column={2} bordered>
              <Descriptions.Item label="通话ID">{selectedCall.id}</Descriptions.Item>
              <Descriptions.Item label="来电号码">{selectedCall.callerPhone}</Descriptions.Item>
              <Descriptions.Item label="联系人">
                {selectedCall.callerName || '未知联系人'}
              </Descriptions.Item>
              <Descriptions.Item label="通话状态">
                <Badge {...getStatusInfo(selectedCall.callStatus)} />
              </Descriptions.Item>
              <Descriptions.Item label="通话类型">
                <Tag {...getTypeInfo(selectedCall.callType)}>
                  {getTypeInfo(selectedCall.callType).text}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="AI处理">
                {selectedCall.aiHandled ? (
                  <Tag color="blue" icon={<RobotOutlined />}>已处理</Tag>
                ) : (
                  <Tag>未处理</Tag>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="开始时间">
                {dayjs(selectedCall.startTime).format('YYYY-MM-DD HH:mm:ss')}
              </Descriptions.Item>
              <Descriptions.Item label="结束时间">
                {selectedCall.endTime ? dayjs(selectedCall.endTime).format('YYYY-MM-DD HH:mm:ss') : '进行中'}
              </Descriptions.Item>
              <Descriptions.Item label="通话时长" span={2}>
                {Math.floor(selectedCall.duration / 60)}分{selectedCall.duration % 60}秒
              </Descriptions.Item>
            </Descriptions>

            {selectedCall.quality && (
              <Card title="通话质量" className="mt-4">
                <Row gutter={16}>
                  <Col span={6}>
                    <Statistic
                      title="音频质量"
                      value={selectedCall.quality.audioQuality * 100}
                      precision={1}
                      suffix="%"
                      valueStyle={{ color: selectedCall.quality.audioQuality > 0.8 ? '#3f8600' : '#cf1322' }}
                    />
                  </Col>
                  <Col span={6}>
                    <Statistic
                      title="响应时间"
                      value={selectedCall.quality.responseTime}
                      suffix="ms"
                      valueStyle={{ color: (selectedCall.quality.responseTime || 0) < 1000 ? '#3f8600' : '#cf1322' }}
                    />
                  </Col>
                  <Col span={6}>
                    <Statistic
                      title="用户满意度"
                      value={selectedCall.quality.userSatisfaction * 100}
                      precision={1}
                      suffix="%"
                      valueStyle={{ color: selectedCall.quality.userSatisfaction > 0.8 ? '#3f8600' : '#cf1322' }}
                    />
                  </Col>
                  <Col span={6}>
                    <Statistic
                      title="垃圾评分"
                      value={selectedCall.spamScore * 100}
                      precision={1}
                      suffix="%"
                      valueStyle={{ color: selectedCall.spamScore > 0.7 ? '#cf1322' : '#3f8600' }}
                    />
                  </Col>
                </Row>
              </Card>
            )}
          </TabPane>

          <TabPane tab="通话内容" key="content">
            {selectedCall.transcription && (
              <Card title="通话转录" className="mb-4">
                <Paragraph copyable>
                  {selectedCall.transcription}
                </Paragraph>
              </Card>
            )}

            {selectedCall.aiResponse && (
              <Card title="AI回复内容">
                <Alert
                  message="AI自动回复"
                  description={selectedCall.aiResponse}
                  type="info"
                  showIcon
                  icon={<RobotOutlined />}
                />
              </Card>
            )}

            {!selectedCall.transcription && !selectedCall.aiResponse && (
              <div className="text-center py-8">
                <FileTextOutlined className="text-4xl text-gray-400 mb-4" />
                <Text type="secondary">暂无通话内容记录</Text>
              </div>
            )}
          </TabPane>

          <TabPane tab="标签和备注" key="tags">
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <Title level={5}>标签</Title>
                <Space wrap>
                  {selectedCall.tags?.map((tag, index) => (
                    <Tag key={index} color="blue">{tag}</Tag>
                  ))}
                  {!selectedCall.tags?.length && (
                    <Text type="secondary">暂无标签</Text>
                  )}
                </Space>
              </div>

              <Divider />

              <div>
                <Title level={5}>操作历史</Title>
                <Timeline>
                  <Timeline.Item color="green">
                    通话开始 - {dayjs(selectedCall.startTime).format('HH:mm:ss')}
                  </Timeline.Item>
                  {selectedCall.aiHandled && (
                    <Timeline.Item color="blue">
                      AI开始处理 - {dayjs(selectedCall.startTime).add(2, 'second').format('HH:mm:ss')}
                    </Timeline.Item>
                  )}
                  {selectedCall.endTime && (
                    <Timeline.Item color="red">
                      通话结束 - {dayjs(selectedCall.endTime).format('HH:mm:ss')}
                    </Timeline.Item>
                  )}
                </Timeline>
              </div>
            </Space>
          </TabPane>
        </Tabs>
      </Drawer>
    );
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spin size="large" tip="加载通话记录..." />
      </div>
    );
  }

  return (
    <div className={embedded ? '' : 'p-6'}>
      {!embedded && (
        <div className="mb-6">
          <Title level={2}>通话管理</Title>
          <Text type="secondary">管理和分析所有通话记录，监控AI处理效果</Text>
        </div>
      )}

      {/* Statistics Cards */}
      <Row gutter={[16, 16]} className="mb-6">
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="总通话数"
              value={stats.totalCalls}
              prefix={<PhoneOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="AI处理"
              value={stats.aiHandledCalls}
              prefix={<RobotOutlined />}
              suffix={`/ ${stats.totalCalls}`}
            />
            <Progress 
              percent={(stats.aiHandledCalls / stats.totalCalls) * 100} 
              size="small"
              showInfo={false}
              className="mt-2"
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="平均时长"
              value={stats.averageDuration}
              precision={0}
              suffix="秒"
              prefix={<ClockCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="成功率"
              value={stats.successRate}
              precision={1}
              suffix="%"
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: stats.successRate > 80 ? '#3f8600' : '#cf1322' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Filters */}
      <Card className="mb-4">
        <Form
          form={filterForm}
          layout="inline"
          onValuesChange={handleFilterChange}
          initialValues={filters}
        >
          <Form.Item name="status" label="状态">
            <Select style={{ width: 120 }} placeholder="所有状态">
              <Option value="all">所有状态</Option>
              <Option value="answered">已接听</Option>
              <Option value="missed">未接听</Option>
              <Option value="blocked">已拦截</Option>
              <Option value="transferred">已转接</Option>
            </Select>
          </Form.Item>

          <Form.Item name="type" label="类型">
            <Select style={{ width: 120 }} placeholder="所有类型">
              <Option value="all">所有类型</Option>
              <Option value="spam">骚扰电话</Option>
              <Option value="normal">正常通话</Option>
              <Option value="emergency">紧急通话</Option>
              <Option value="business">商务通话</Option>
            </Select>
          </Form.Item>

          <Form.Item name="aiHandled" label="AI处理">
            <Select style={{ width: 120 }} placeholder="全部">
              <Option value="all">全部</Option>
              <Option value="true">已处理</Option>
              <Option value="false">未处理</Option>
            </Select>
          </Form.Item>

          <Form.Item name="dateRange" label="时间范围">
            <RangePicker />
          </Form.Item>

          <Form.Item name="caller" label="来电号码">
            <Input 
              placeholder="搜索号码或联系人" 
              prefix={<SearchOutlined />}
              style={{ width: 200 }}
            />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button 
                onClick={() => {
                  filterForm.resetFields();
                  setFilteredCalls(calls);
                }}
              >
                重置
              </Button>
              <Button 
                type="primary"
                icon={<ReloadOutlined />}
                loading={refreshing}
                onClick={() => {
                  setRefreshing(true);
                  setTimeout(() => setRefreshing(false), 1000);
                }}
              >
                刷新
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      {/* Call Records Table */}
      <Card>
        <Table
          columns={columns}
          dataSource={filteredCalls}
          rowKey="id"
          pagination={{
            total: filteredCalls.length,
            pageSize: 10,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => `${range[0]}-${range[1]} 共 ${total} 条记录`,
          }}
          scroll={{ x: 1200 }}
        />
      </Card>

      {/* Call Detail Drawer */}
      {renderCallDetail()}
    </div>
  );
};

export default CallManagement;