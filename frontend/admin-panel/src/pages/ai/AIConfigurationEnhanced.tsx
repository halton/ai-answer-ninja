/**
 * Enhanced AI Configuration Component
 * Advanced AI system configuration with real-time testing and optimization
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Form,
  Input,
  InputNumber,
  Switch,
  Select,
  Slider,
  Button,
  Space,
  Tabs,
  Alert,
  Divider,
  Progress,
  Statistic,
  Row,
  Col,
  Typography,
  Tag,
  Modal,
  Tooltip,
  Badge,
  Collapse,
  Table,
  Timeline,
  Radio,
  Upload,
  message,
  Spin,
  Drawer,
  List,
  Avatar,
  Popconfirm,
  Result
} from 'antd';
import {
  RobotOutlined,
  SettingOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  ThunderboltOutlined,
  BulbOutlined,
  SoundOutlined,
  MessageOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  ExperimentOutlined,
  LineChartOutlined,
  AudioOutlined,
  FileTextOutlined,
  CloudUploadOutlined,
  DownloadOutlined,
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  TrophyOutlined,
  FireOutlined,
  StarOutlined
} from '@ant-design/icons';
import { motion } from 'framer-motion';
import ReactECharts from 'echarts-for-react';
import type { UploadProps } from 'antd';
import type { AIConfig, VoiceProfile, ConversationTemplate, PerformanceMetrics } from '@/types';

const { Title, Text, Paragraph } = Typography;
const { TabPane } = Tabs;
const { Panel } = Collapse;
const { Option } = Select;
const { TextArea } = Input;

interface AIConfigurationEnhancedProps {
  userId?: string;
  onConfigChange?: (config: AIConfig) => void;
}

const AIConfigurationEnhanced: React.FC<AIConfigurationEnhancedProps> = ({ 
  userId, 
  onConfigChange 
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testModalVisible, setTestModalVisible] = useState(false);
  const [templateDrawerVisible, setTemplateDrawerVisible] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<ConversationTemplate | null>(null);
  
  // AI Configuration State
  const [aiConfig, setAiConfig] = useState<AIConfig>({
    // Core AI Settings
    model: 'gpt-4-turbo',
    temperature: 0.7,
    maxTokens: 150,
    topP: 0.9,
    frequencyPenalty: 0.1,
    presencePenalty: 0.1,
    
    // Conversation Settings
    maxConversationDuration: 180, // seconds
    responseTimeout: 5000, // milliseconds
    confidenceThreshold: 0.7,
    maxRetryAttempts: 3,
    
    // Personality Settings
    personality: 'polite',
    humorLevel: 'low',
    patienceLevel: 'medium',
    firmnessLevel: 'medium',
    
    // Voice Settings
    voiceProvider: 'azure',
    voiceModel: 'zh-CN-XiaoxiaoNeural',
    speechSpeed: 1.0,
    speechPitch: 1.0,
    
    // Advanced Settings
    enableEmotionDetection: true,
    enableContextMemory: true,
    enableLearning: true,
    autoTermination: true,
    
    // Response Templates
    templates: [],
    
    // Performance Optimization
    enableCaching: true,
    cacheExpiry: 3600,
    enablePreprocessing: true,
    enableStreamingResponse: false
  });

  // Performance Metrics State
  const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetrics>({
    averageLatency: 850,
    successRate: 94.2,
    userSatisfaction: 4.3,
    processingSpeed: 1.2,
    accuracyScore: 0.89,
    resourceUsage: {
      cpu: 45,
      memory: 62,
      network: 23
    },
    dailyStats: Array.from({ length: 7 }, (_, i) => ({
      date: new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      calls: Math.floor(Math.random() * 100) + 50,
      success: Math.floor(Math.random() * 90) + 80,
      latency: Math.floor(Math.random() * 500) + 300
    }))
  });

  // Conversation Templates
  const [templates, setTemplates] = useState<ConversationTemplate[]>([
    {
      id: '1',
      name: '礼貌拒绝模板',
      category: 'rejection',
      scenario: '推销电话',
      template: '您好，我现在不太方便，谢谢您的来电。',
      variables: ['caller_name', 'product_type'],
      effectiveness: 0.85,
      usage: 1234,
      lastUpdated: new Date().toISOString()
    },
    {
      id: '2',
      name: '信息收集模板',
      category: 'information',
      scenario: '询问电话',
      template: '请问您需要了解什么信息？我可以为您简单介绍一下。',
      variables: ['inquiry_type'],
      effectiveness: 0.92,
      usage: 856,
      lastUpdated: new Date().toISOString()
    },
    {
      id: '3',
      name: '终止对话模板',
      category: 'termination',
      scenario: '骚扰电话',
      template: '我不感兴趣，请不要再打扰我了，谢谢。',
      variables: [],
      effectiveness: 0.78,
      usage: 2341,
      lastUpdated: new Date().toISOString()
    }
  ]);

  // Voice profiles for testing
  const [voiceProfiles] = useState([
    { id: '1', name: '晓晓 (女性, 温和)', value: 'zh-CN-XiaoxiaoNeural', gender: 'female', tone: 'gentle' },
    { id: '2', name: '云健 (男性, 专业)', value: 'zh-CN-YunjianNeural', gender: 'male', tone: 'professional' },
    { id: '3', name: '晓伊 (女性, 活泼)', value: 'zh-CN-XiaoyiNeural', gender: 'female', tone: 'cheerful' },
    { id: '4', name: '云泽 (男性, 沉稳)', value: 'zh-CN-YunzeNeural', gender: 'male', tone: 'calm' }
  ]);

  // Test conversation state
  const [testConversation, setTestConversation] = useState<any[]>([]);
  const [testInput, setTestInput] = useState('');
  const [testScenario, setTestScenario] = useState('sales_call');

  // Load initial configuration
  useEffect(() => {
    const loadConfig = async () => {
      setLoading(true);
      try {
        // Simulate API call
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Load saved configuration
        const savedConfig = localStorage.getItem('ai-config');
        if (savedConfig) {
          const parsed = JSON.parse(savedConfig);
          setAiConfig(parsed);
          form.setFieldsValue(parsed);
        }
        
        message.success('AI配置加载成功');
      } catch (error) {
        message.error('配置加载失败');
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, [form]);

  // Save configuration
  const handleSave = useCallback(async (values: any) => {
    setSaving(true);
    try {
      const newConfig = { ...aiConfig, ...values };
      setAiConfig(newConfig);
      
      // Save to localStorage (simulate API call)
      localStorage.setItem('ai-config', JSON.stringify(newConfig));
      await new Promise(resolve => setTimeout(resolve, 800));
      
      onConfigChange?.(newConfig);
      message.success('AI配置保存成功');
    } catch (error) {
      message.error('配置保存失败');
    } finally {
      setSaving(false);
    }
  }, [aiConfig, onConfigChange]);

  // Test AI response
  const handleTestResponse = useCallback(async () => {
    if (!testInput.trim()) return;
    
    setTesting(true);
    try {
      // Simulate AI processing
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const response = `AI回复: 根据当前配置，我的回应是...（这是模拟回复）`;
      const latency = Math.floor(Math.random() * 1000) + 200;
      
      setTestConversation(prev => [
        ...prev,
        { type: 'user', content: testInput, timestamp: new Date() },
        { type: 'ai', content: response, timestamp: new Date(), latency }
      ]);
      
      setTestInput('');
      message.success(`AI回复生成成功 (延迟: ${latency}ms)`);
    } catch (error) {
      message.error('AI测试失败');
    } finally {
      setTesting(false);
    }
  }, [testInput]);

  // Performance chart options
  const performanceChartOption = {
    title: { text: 'AI性能趋势', textStyle: { fontSize: 16 } },
    tooltip: { trigger: 'axis' },
    legend: { data: ['延迟(ms)', '成功率(%)', '通话数'] },
    xAxis: {
      type: 'category',
      data: performanceMetrics.dailyStats.map(stat => stat.date.substring(5))
    },
    yAxis: [
      { type: 'value', name: '延迟/成功率', position: 'left' },
      { type: 'value', name: '通话数', position: 'right' }
    ],
    series: [
      {
        name: '延迟(ms)',
        type: 'line',
        data: performanceMetrics.dailyStats.map(stat => stat.latency),
        smooth: true,
        itemStyle: { color: '#1890ff' }
      },
      {
        name: '成功率(%)',
        type: 'line',
        data: performanceMetrics.dailyStats.map(stat => stat.success),
        smooth: true,
        itemStyle: { color: '#52c41a' }
      },
      {
        name: '通话数',
        type: 'bar',
        yAxisIndex: 1,
        data: performanceMetrics.dailyStats.map(stat => stat.calls),
        itemStyle: { color: '#faad14' }
      }
    ]
  };

  // Template table columns
  const templateColumns = [
    {
      title: '模板名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: ConversationTemplate) => (
        <div>
          <Text strong>{name}</Text>
          <br />
          <Tag color="blue">{record.scenario}</Tag>
        </div>
      )
    },
    {
      title: '效果评分',
      dataIndex: 'effectiveness',
      key: 'effectiveness',
      render: (effectiveness: number) => (
        <div>
          <Progress 
            percent={effectiveness * 100} 
            size="small"
            strokeColor={effectiveness > 0.8 ? '#52c41a' : effectiveness > 0.6 ? '#faad14' : '#f5222d'}
          />
          <Text className="text-xs">{(effectiveness * 100).toFixed(1)}%</Text>
        </div>
      ),
      sorter: (a, b) => a.effectiveness - b.effectiveness
    },
    {
      title: '使用次数',
      dataIndex: 'usage',
      key: 'usage',
      render: (usage: number) => <Text>{usage.toLocaleString()}</Text>,
      sorter: (a, b) => a.usage - b.usage
    },
    {
      title: '操作',
      key: 'actions',
      render: (_, record: ConversationTemplate) => (
        <Space>
          <Button 
            type="text" 
            size="small"
            icon={<EyeOutlined />}
            onClick={() => {
              setSelectedTemplate(record);
              setTemplateDrawerVisible(true);
            }}
          />
          <Button type="text" size="small" icon={<EditOutlined />} />
          <Popconfirm 
            title="确定删除此模板？"
            onConfirm={() => {
              setTemplates(prev => prev.filter(t => t.id !== record.id));
              message.success('模板删除成功');
            }}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ];

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spin size="large" tip="加载AI配置..." />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <Title level={2}>AI系统配置</Title>
        <Text type="secondary">配置AI对话系统的各项参数，优化响应效果和用户体验</Text>
      </div>

      <Row gutter={[24, 24]}>
        {/* Performance Overview */}
        <Col span={24}>
          <Card>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={8} lg={4}>
                <Statistic
                  title="平均延迟"
                  value={performanceMetrics.averageLatency}
                  suffix="ms"
                  prefix={<ClockCircleOutlined />}
                  valueStyle={{ color: performanceMetrics.averageLatency < 1000 ? '#3f8600' : '#cf1322' }}
                />
              </Col>
              <Col xs={24} sm={8} lg={4}>
                <Statistic
                  title="成功率"
                  value={performanceMetrics.successRate}
                  precision={1}
                  suffix="%"
                  prefix={<CheckCircleOutlined />}
                  valueStyle={{ color: '#3f8600' }}
                />
              </Col>
              <Col xs={24} sm={8} lg={4}>
                <Statistic
                  title="用户满意度"
                  value={performanceMetrics.userSatisfaction}
                  precision={1}
                  suffix="/5.0"
                  prefix={<StarOutlined />}
                  valueStyle={{ color: '#fa8c16' }}
                />
              </Col>
              <Col xs={24} sm={8} lg={4}>
                <Statistic
                  title="准确率"
                  value={performanceMetrics.accuracyScore * 100}
                  precision={1}
                  suffix="%"
                  prefix={<TrophyOutlined />}
                  valueStyle={{ color: '#1890ff' }}
                />
              </Col>
              <Col xs={24} sm={8} lg={4}>
                <div>
                  <Text type="secondary">CPU使用率</Text>
                  <Progress 
                    percent={performanceMetrics.resourceUsage.cpu} 
                    size="small"
                    strokeColor="#52c41a"
                  />
                </div>
              </Col>
              <Col xs={24} sm={8} lg={4}>
                <Button 
                  type="primary"
                  icon={<ExperimentOutlined />}
                  onClick={() => setTestModalVisible(true)}
                >
                  测试配置
                </Button>
              </Col>
            </Row>
          </Card>
        </Col>

        {/* Configuration Form */}
        <Col xs={24} lg={16}>
          <Card>
            <Form
              form={form}
              layout="vertical"
              onFinish={handleSave}
              initialValues={aiConfig}
            >
              <Tabs defaultActiveKey="basic">
                {/* Basic Settings */}
                <TabPane tab="基础配置" key="basic">
                  <Row gutter={16}>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="model"
                        label="AI模型"
                        tooltip="选择用于对话生成的AI模型"
                      >
                        <Select>
                          <Option value="gpt-4-turbo">GPT-4 Turbo (推荐)</Option>
                          <Option value="gpt-4">GPT-4</Option>
                          <Option value="gpt-3.5-turbo">GPT-3.5 Turbo</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="personality"
                        label="AI个性"
                        tooltip="设置AI的基本性格特征"
                      >
                        <Select>
                          <Option value="polite">礼貌</Option>
                          <Option value="direct">直接</Option>
                          <Option value="humorous">幽默</Option>
                          <Option value="professional">专业</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                  </Row>

                  <Row gutter={16}>
                    <Col xs={24} sm={8}>
                      <Form.Item
                        name="temperature"
                        label="创造性"
                        tooltip="控制AI回复的随机性和创造性"
                      >
                        <Slider
                          min={0}
                          max={1}
                          step={0.1}
                          marks={{
                            0: '保守',
                            0.5: '平衡',
                            1: '创新'
                          }}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={8}>
                      <Form.Item
                        name="humorLevel"
                        label="幽默程度"
                      >
                        <Radio.Group>
                          <Radio value="none">无</Radio>
                          <Radio value="low">低</Radio>
                          <Radio value="medium">中</Radio>
                          <Radio value="high">高</Radio>
                        </Radio.Group>
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={8}>
                      <Form.Item
                        name="firmnessLevel"
                        label="坚决程度"
                      >
                        <Radio.Group>
                          <Radio value="gentle">温和</Radio>
                          <Radio value="medium">适中</Radio>
                          <Radio value="firm">坚决</Radio>
                        </Radio.Group>
                      </Form.Item>
                    </Col>
                  </Row>

                  <Row gutter={16}>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="maxTokens"
                        label="最大回复长度"
                        tooltip="限制AI单次回复的最大字符数"
                      >
                        <InputNumber
                          min={50}
                          max={500}
                          step={10}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="responseTimeout"
                        label="响应超时 (毫秒)"
                        tooltip="AI回复的最大等待时间"
                      >
                        <InputNumber
                          min={1000}
                          max={10000}
                          step={500}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </TabPane>

                {/* Voice Settings */}
                <TabPane tab="语音配置" key="voice">
                  <Row gutter={16}>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="voiceModel"
                        label="语音模型"
                      >
                        <Select>
                          {voiceProfiles.map(profile => (
                            <Option key={profile.id} value={profile.value}>
                              {profile.name}
                            </Option>
                          ))}
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="voiceProvider"
                        label="语音服务商"
                      >
                        <Select>
                          <Option value="azure">Azure Speech</Option>
                          <Option value="google">Google Cloud TTS</Option>
                          <Option value="aws">Amazon Polly</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                  </Row>

                  <Row gutter={16}>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="speechSpeed"
                        label="语音速度"
                      >
                        <Slider
                          min={0.5}
                          max={2.0}
                          step={0.1}
                          marks={{
                            0.5: '慢',
                            1: '正常',
                            2: '快'
                          }}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="speechPitch"
                        label="音调"
                      >
                        <Slider
                          min={0.5}
                          max={1.5}
                          step={0.1}
                          marks={{
                            0.5: '低',
                            1: '正常',
                            1.5: '高'
                          }}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </TabPane>

                {/* Advanced Settings */}
                <TabPane tab="高级配置" key="advanced">
                  <Space direction="vertical" style={{ width: '100%' }} size="large">
                    <Card size="small" title="智能功能">
                      <Row gutter={[16, 16]}>
                        <Col xs={24} sm={12}>
                          <Form.Item
                            name="enableEmotionDetection"
                            valuePropName="checked"
                          >
                            <div className="flex items-center">
                              <Switch />
                              <Text className="ml-2">启用情感检测</Text>
                            </div>
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12}>
                          <Form.Item
                            name="enableContextMemory"
                            valuePropName="checked"
                          >
                            <div className="flex items-center">
                              <Switch />
                              <Text className="ml-2">启用上下文记忆</Text>
                            </div>
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12}>
                          <Form.Item
                            name="enableLearning"
                            valuePropName="checked"
                          >
                            <div className="flex items-center">
                              <Switch />
                              <Text className="ml-2">启用自主学习</Text>
                            </div>
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12}>
                          <Form.Item
                            name="autoTermination"
                            valuePropName="checked"
                          >
                            <div className="flex items-center">
                              <Switch />
                              <Text className="ml-2">智能终止对话</Text>
                            </div>
                          </Form.Item>
                        </Col>
                      </Row>
                    </Card>

                    <Card size="small" title="性能优化">
                      <Row gutter={[16, 16]}>
                        <Col xs={24} sm={12}>
                          <Form.Item
                            name="enableCaching"
                            valuePropName="checked"
                          >
                            <div className="flex items-center">
                              <Switch />
                              <Text className="ml-2">启用响应缓存</Text>
                            </div>
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12}>
                          <Form.Item
                            name="enablePreprocessing"
                            valuePropName="checked"
                          >
                            <div className="flex items-center">
                              <Switch />
                              <Text className="ml-2">启用预处理</Text>
                            </div>
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12}>
                          <Form.Item
                            name="cacheExpiry"
                            label="缓存过期时间 (秒)"
                          >
                            <InputNumber
                              min={300}
                              max={86400}
                              step={300}
                              style={{ width: '100%' }}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12}>
                          <Form.Item
                            name="maxRetryAttempts"
                            label="最大重试次数"
                          >
                            <InputNumber
                              min={1}
                              max={5}
                              style={{ width: '100%' }}
                            />
                          </Form.Item>
                        </Col>
                      </Row>
                    </Card>
                  </Space>
                </TabPane>
              </Tabs>

              <Divider />

              <div className="flex justify-end">
                <Space>
                  <Button onClick={() => form.resetFields()}>
                    重置
                  </Button>
                  <Button 
                    type="primary"
                    htmlType="submit"
                    loading={saving}
                    icon={<SaveOutlined />}
                  >
                    保存配置
                  </Button>
                </Space>
              </div>
            </Form>
          </Card>
        </Col>

        {/* Performance Chart & Templates */}
        <Col xs={24} lg={8}>
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            {/* Performance Chart */}
            <Card size="small">
              <ReactECharts 
                option={performanceChartOption}
                style={{ height: '300px' }}
              />
            </Card>

            {/* Response Templates */}
            <Card 
              size="small"
              title="响应模板"
              extra={
                <Button 
                  size="small"
                  type="link"
                  icon={<PlusOutlined />}
                  onClick={() => setTemplateDrawerVisible(true)}
                >
                  管理
                </Button>
              }
            >
              <List
                size="small"
                dataSource={templates.slice(0, 3)}
                renderItem={(template) => (
                  <List.Item
                    actions={[
                      <Button 
                        type="text" 
                        size="small"
                        icon={<EyeOutlined />}
                        onClick={() => {
                          setSelectedTemplate(template);
                          setTemplateDrawerVisible(true);
                        }}
                      />
                    ]}
                  >
                    <List.Item.Meta
                      title={<Text strong className="text-sm">{template.name}</Text>}
                      description={
                        <div>
                          <Tag size="small" color="blue">{template.scenario}</Tag>
                          <Progress 
                            percent={template.effectiveness * 100} 
                            size="small"
                            showInfo={false}
                            className="mt-1"
                          />
                        </div>
                      }
                    />
                  </List.Item>
                )}
              />
            </Card>
          </Space>
        </Col>
      </Row>

      {/* Test Modal */}
      <Modal
        title="AI配置测试"
        open={testModalVisible}
        onCancel={() => setTestModalVisible(false)}
        width={800}
        footer={null}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <Row gutter={16}>
            <Col span={12}>
              <Text strong>测试场景：</Text>
              <Select 
                value={testScenario}
                onChange={setTestScenario}
                style={{ width: '100%', marginTop: 8 }}
              >
                <Option value="sales_call">推销电话</Option>
                <Option value="loan_offer">贷款电话</Option>
                <Option value="survey">问卷调查</Option>
                <Option value="insurance">保险推广</Option>
              </Select>
            </Col>
            <Col span={12}>
              <Text strong>当前配置：</Text>
              <div className="mt-2">
                <Tag>模型: {aiConfig.model}</Tag>
                <Tag>个性: {aiConfig.personality}</Tag>
                <Tag>创造性: {aiConfig.temperature}</Tag>
              </div>
            </Col>
          </Row>

          <Card size="small" title="对话测试">
            <div style={{ height: '300px', overflowY: 'auto', marginBottom: 16 }}>
              {testConversation.length === 0 ? (
                <div className="text-center text-gray-400 py-8">
                  <MessageOutlined className="text-2xl mb-2" />
                  <p>输入测试消息开始对话测试</p>
                </div>
              ) : (
                <Timeline>
                  {testConversation.map((msg, index) => (
                    <Timeline.Item
                      key={index}
                      color={msg.type === 'user' ? 'blue' : 'green'}
                      dot={msg.type === 'user' ? <UserOutlined /> : <RobotOutlined />}
                    >
                      <div>
                        <Text strong>{msg.type === 'user' ? '用户' : 'AI'}: </Text>
                        <Text>{msg.content}</Text>
                        {msg.latency && (
                          <Tag size="small" className="ml-2">
                            {msg.latency}ms
                          </Tag>
                        )}
                      </div>
                      <Text type="secondary" className="text-xs">
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </Text>
                    </Timeline.Item>
                  ))}
                </Timeline>
              )}
            </div>

            <Input.Group compact>
              <Input
                style={{ width: 'calc(100% - 80px)' }}
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder="输入测试消息..."
                onPressEnter={handleTestResponse}
              />
              <Button 
                type="primary"
                loading={testing}
                onClick={handleTestResponse}
                disabled={!testInput.trim()}
              >
                发送
              </Button>
            </Input.Group>
          </Card>
        </Space>
      </Modal>

      {/* Template Management Drawer */}
      <Drawer
        title="响应模板管理"
        width={720}
        open={templateDrawerVisible}
        onClose={() => setTemplateDrawerVisible(false)}
        extra={
          <Button 
            type="primary"
            icon={<PlusOutlined />}
          >
            新建模板
          </Button>
        }
      >
        <Table
          columns={templateColumns}
          dataSource={templates}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10 }}
        />

        {selectedTemplate && (
          <Card className="mt-4" size="small" title={`模板详情: ${selectedTemplate.name}`}>
            <Descriptions column={2} size="small">
              <Descriptions.Item label="模板内容" span={2}>
                <Paragraph copyable>
                  {selectedTemplate.template}
                </Paragraph>
              </Descriptions.Item>
              <Descriptions.Item label="使用场景">
                {selectedTemplate.scenario}
              </Descriptions.Item>
              <Descriptions.Item label="效果评分">
                <Progress 
                  percent={selectedTemplate.effectiveness * 100} 
                  size="small"
                  strokeColor={selectedTemplate.effectiveness > 0.8 ? '#52c41a' : '#faad14'}
                />
              </Descriptions.Item>
              <Descriptions.Item label="使用次数">
                {selectedTemplate.usage.toLocaleString()}
              </Descriptions.Item>
              <Descriptions.Item label="最后更新">
                {new Date(selectedTemplate.lastUpdated).toLocaleDateString()}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        )}
      </Drawer>
    </div>
  );
};

export default AIConfigurationEnhanced;