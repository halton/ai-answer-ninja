import React, { useState, useEffect } from 'react'
import {
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Button,
  Space,
  Typography,
  Divider,
  Row,
  Col,
  Alert,
  Modal,
  Table,
  Tag,
  Progress,
  Slider,
  Radio,
  Collapse,
  message,
  Tooltip,
  Badge,
  Upload,
  List
} from 'antd'
import {
  SettingOutlined,
  RobotOutlined,
  SoundOutlined,
  BrainOutlined,
  ExperimentOutlined,
  SaveOutlined,
  ReloadOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  EditOutlined,
  PlusOutlined,
  DeleteOutlined,
  UploadOutlined,
  DownloadOutlined,
  TestTubeOutlined
} from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { ColumnsType } from 'antd/es/table'

const { Text, Title, Paragraph } = Typography
const { Option } = Select
const { TextArea } = Input
const { Panel } = Collapse

// AI配置数据类型
interface AIConfig {
  general: {
    enabled: boolean
    model: string
    temperature: number
    maxTokens: number
    responseTimeout: number
  }
  voice: {
    sttProvider: string
    ttsProvider: string
    voiceId: string
    speechRate: number
    pitch: number
    volume: number
  }
  conversation: {
    maxTurns: number
    terminationStrategy: string
    personalityType: string
    responseStyle: string
    contextWindow: number
  }
  intent: {
    confidenceThreshold: number
    fallbackResponse: string
    enableLearning: boolean
    customIntents: string[]
  }
  safety: {
    contentFilter: boolean
    toxicityThreshold: number
    maxCallDuration: number
    emergencyNumbers: string[]
  }
}

interface VoiceProfile {
  id: string
  name: string
  provider: string
  voiceId: string
  language: string
  gender: string
  isActive: boolean
  sampleUrl?: string
  createdAt: string
}

interface ResponseTemplate {
  id: string
  name: string
  category: string
  template: string
  variables: string[]
  isActive: boolean
  usage: number
}

interface AIModel {
  id: string
  name: string
  provider: string
  version: string
  capabilities: string[]
  cost: number
  latency: number
  isActive: boolean
}

const AIConfiguration: React.FC = () => {
  const [form] = Form.useForm()
  const [activeTab, setActiveTab] = useState('general')
  const [voiceModalVisible, setVoiceModalVisible] = useState(false)
  const [templateModalVisible, setTemplateModalVisible] = useState(false)
  const [testModalVisible, setTestModalVisible] = useState(false)
  const [editingVoice, setEditingVoice] = useState<VoiceProfile | null>(null)
  const [editingTemplate, setEditingTemplate] = useState<ResponseTemplate | null>(null)
  const [testConfig, setTestConfig] = useState<any>({})
  const queryClient = useQueryClient()

  // 查询AI配置
  const { data: configData, isLoading } = useQuery({
    queryKey: ['aiConfig'],
    queryFn: async () => {
      await new Promise(resolve => setTimeout(resolve, 1000))
      return {
        config: generateMockAIConfig(),
        voices: generateMockVoiceProfiles(),
        templates: generateMockResponseTemplates(),
        models: generateMockAIModels()
      }
    }
  })

  // 保存配置
  const saveConfigMutation = useMutation({
    mutationFn: async (config: AIConfig) => {
      await new Promise(resolve => setTimeout(resolve, 1000))
      return config
    },
    onSuccess: () => {
      message.success('配置保存成功')
      queryClient.invalidateQueries({ queryKey: ['aiConfig'] })
    }
  })

  // 测试AI配置
  const testConfigMutation = useMutation({
    mutationFn: async (testData: any) => {
      await new Promise(resolve => setTimeout(resolve, 2000))
      return {
        success: Math.random() > 0.2,
        response: '这是一个测试回复，展示AI配置效果。',
        metrics: {
          responseTime: Math.floor(Math.random() * 1000) + 500,
          confidence: Math.random() * 0.3 + 0.7,
          intent: 'sales_call'
        }
      }
    }
  })

  // 初始化表单
  useEffect(() => {
    if (configData?.config) {
      form.setFieldsValue(configData.config)
    }
  }, [configData, form])

  // 语音配置列
  const voiceColumns: ColumnsType<VoiceProfile> = [
    {
      title: '语音名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: VoiceProfile) => (
        <Space>
          <Text strong>{name}</Text>
          {record.isActive && <Badge status="success" text="默认" />}
        </Space>
      )
    },
    {
      title: '提供商',
      dataIndex: 'provider',
      key: 'provider',
      render: (provider: string) => <Tag color="blue">{provider}</Tag>
    },
    {
      title: '语言',
      dataIndex: 'language',
      key: 'language'
    },
    {
      title: '性别',
      dataIndex: 'gender',
      key: 'gender',
      render: (gender: string) => (
        <Tag color={gender === 'female' ? 'pink' : 'cyan'}>
          {gender === 'female' ? '女性' : '男性'}
        </Tag>
      )
    },
    {
      title: '操作',
      key: 'actions',
      render: (_, record: VoiceProfile) => (
        <Space>
          {record.sampleUrl && (
            <Tooltip title="试听">
              <Button
                type="text"
                icon={<PlayCircleOutlined />}
                onClick={() => playVoiceSample(record.sampleUrl!)}
              />
            </Tooltip>
          )}
          <Tooltip title="编辑">
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => handleEditVoice(record)}
            />
          </Tooltip>
          <Tooltip title="删除">
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDeleteVoice(record.id)}
            />
          </Tooltip>
        </Space>
      )
    }
  ]

  // 回复模板列
  const templateColumns: ColumnsType<ResponseTemplate> = [
    {
      title: '模板名称',
      dataIndex: 'name',
      key: 'name'
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      render: (category: string) => <Tag>{category}</Tag>
    },
    {
      title: '模板内容',
      dataIndex: 'template',
      key: 'template',
      ellipsis: true,
      width: 300
    },
    {
      title: '使用次数',
      dataIndex: 'usage',
      key: 'usage',
      sorter: true
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      key: 'isActive',
      render: (isActive: boolean) => (
        <Badge status={isActive ? 'success' : 'default'} text={isActive ? '启用' : '禁用'} />
      )
    },
    {
      title: '操作',
      key: 'actions',
      render: (_, record: ResponseTemplate) => (
        <Space>
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => handleEditTemplate(record)}
          />
          <Button
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDeleteTemplate(record.id)}
          />
        </Space>
      )
    }
  ]

  // 处理配置保存
  const handleSaveConfig = async () => {
    try {
      const values = await form.validateFields()
      saveConfigMutation.mutate(values)
    } catch (error) {
      console.error('表单验证失败:', error)
    }
  }

  // 处理配置测试
  const handleTestConfig = async () => {
    try {
      const values = await form.validateFields()
      setTestConfig(values)
      setTestModalVisible(true)
    } catch (error) {
      console.error('表单验证失败:', error)
    }
  }

  // 处理语音编辑
  const handleEditVoice = (voice: VoiceProfile) => {
    setEditingVoice(voice)
    setVoiceModalVisible(true)
  }

  // 处理模板编辑
  const handleEditTemplate = (template: ResponseTemplate) => {
    setEditingTemplate(template)
    setTemplateModalVisible(true)
  }

  // 播放语音示例
  const playVoiceSample = (url: string) => {
    const audio = new Audio(url)
    audio.play()
  }

  // 删除语音配置
  const handleDeleteVoice = (id: string) => {
    Modal.confirm({
      title: '确定要删除这个语音配置吗？',
      content: '删除后无法恢复',
      onOk: () => {
        message.success('删除成功')
        queryClient.invalidateQueries({ queryKey: ['aiConfig'] })
      }
    })
  }

  // 删除回复模板
  const handleDeleteTemplate = (id: string) => {
    Modal.confirm({
      title: '确定要删除这个回复模板吗？',
      content: '删除后无法恢复',
      onOk: () => {
        message.success('删除成功')
        queryClient.invalidateQueries({ queryKey: ['aiConfig'] })
      }
    })
  }

  // 运行AI测试
  const runAITest = async () => {
    const testData = {
      config: testConfig,
      testInput: '您好，我想了解一下您的产品'
    }
    testConfigMutation.mutate(testData)
  }

  return (
    <div className="ai-configuration">
      {/* 页面标题和操作 */}
      <Card style={{ marginBottom: 16 }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Space>
              <RobotOutlined style={{ fontSize: '24px', color: '#1890ff' }} />
              <Title level={3} style={{ margin: 0 }}>AI配置管理</Title>
            </Space>
          </Col>
          <Col>
            <Space>
              <Button
                icon={<TestTubeOutlined />}
                onClick={handleTestConfig}
                loading={testConfigMutation.isPending}
              >
                测试配置
              </Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSaveConfig}
                loading={saveConfigMutation.isPending}
              >
                保存配置
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Form form={form} layout="vertical">
        <Collapse defaultActiveKey={['general']} ghost>
          {/* 基础配置 */}
          <Panel header={
            <Space>
              <SettingOutlined />
              <Text strong>基础配置</Text>
            </Space>
          } key="general">
            <Card>
              <Row gutter={24}>
                <Col span={8}>
                  <Form.Item name={['general', 'enabled']} label="启用AI功能" valuePropName="checked">
                    <Switch checkedChildren="启用" unCheckedChildren="禁用" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name={['general', 'model']} label="AI模型">
                    <Select placeholder="选择AI模型">
                      <Option value="gpt-4">GPT-4</Option>
                      <Option value="gpt-3.5-turbo">GPT-3.5 Turbo</Option>
                      <Option value="claude-3">Claude-3</Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name={['general', 'temperature']} label="创造性程度">
                    <Slider
                      min={0}
                      max={1}
                      step={0.1}
                      marks={{
                        0: '保守',
                        0.5: '平衡',
                        1: '创新'
                      }}
                      tooltip={{ formatter: (value) => `${value}` }}
                    />
                  </Form.Item>
                </Col>
              </Row>
              
              <Row gutter={24}>
                <Col span={8}>
                  <Form.Item name={['general', 'maxTokens']} label="最大输出长度">
                    <InputNumber
                      min={50}
                      max={1000}
                      style={{ width: '100%' }}
                      addonAfter="tokens"
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name={['general', 'responseTimeout']} label="响应超时">
                    <InputNumber
                      min={1}
                      max={30}
                      style={{ width: '100%' }}
                      addonAfter="秒"
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Panel>

          {/* 语音配置 */}
          <Panel header={
            <Space>
              <SoundOutlined />
              <Text strong>语音配置</Text>
            </Space>
          } key="voice">
            <Card>
              <Row gutter={24}>
                <Col span={12}>
                  <Form.Item name={['voice', 'sttProvider']} label="语音识别服务">
                    <Select placeholder="选择STT提供商">
                      <Option value="azure">Azure Speech</Option>
                      <Option value="google">Google Cloud Speech</Option>
                      <Option value="aws">AWS Transcribe</Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name={['voice', 'ttsProvider']} label="语音合成服务">
                    <Select placeholder="选择TTS提供商">
                      <Option value="azure">Azure Speech</Option>
                      <Option value="google">Google Cloud TTS</Option>
                      <Option value="aws">AWS Polly</Option>
                    </Select>
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={24}>
                <Col span={8}>
                  <Form.Item name={['voice', 'speechRate']} label="语速">
                    <Slider
                      min={0.5}
                      max={2}
                      step={0.1}
                      marks={{
                        0.5: '慢',
                        1: '正常',
                        2: '快'
                      }}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name={['voice', 'pitch']} label="音调">
                    <Slider
                      min={-20}
                      max={20}
                      step={1}
                      marks={{
                        '-20': '低',
                        0: '正常',
                        20: '高'
                      }}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name={['voice', 'volume']} label="音量">
                    <Slider
                      min={0}
                      max={100}
                      step={1}
                      marks={{
                        0: '静音',
                        50: '正常',
                        100: '最大'
                      }}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Divider />
              
              <div style={{ marginBottom: 16 }}>
                <Space>
                  <Text strong>语音配置文件</Text>
                  <Button
                    type="primary"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setEditingVoice(null)
                      setVoiceModalVisible(true)
                    }}
                  >
                    添加语音
                  </Button>
                </Space>
              </div>
              
              <Table<VoiceProfile>
                columns={voiceColumns}
                dataSource={configData?.voices || []}
                loading={isLoading}
                rowKey="id"
                size="small"
                pagination={false}
              />
            </Card>
          </Panel>

          {/* 对话配置 */}
          <Panel header={
            <Space>
              <BrainOutlined />
              <Text strong>对话配置</Text>
            </Space>
          } key="conversation">
            <Card>
              <Row gutter={24}>
                <Col span={8}>
                  <Form.Item name={['conversation', 'maxTurns']} label="最大对话轮数">
                    <InputNumber
                      min={1}
                      max={20}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name={['conversation', 'terminationStrategy']} label="终止策略">
                    <Select placeholder="选择终止策略">
                      <Option value="polite">礼貌结束</Option>
                      <Option value="firm">坚决拒绝</Option>
                      <Option value="gradual">逐步引导</Option>
                      <Option value="immediate">立即挂断</Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name={['conversation', 'contextWindow']} label="上下文窗口">
                    <InputNumber
                      min={1}
                      max={10}
                      style={{ width: '100%' }}
                      addonAfter="轮"
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={24}>
                <Col span={12}>
                  <Form.Item name={['conversation', 'personalityType']} label="AI人格类型">
                    <Radio.Group>
                      <Radio value="friendly">友好型</Radio>
                      <Radio value="professional">专业型</Radio>
                      <Radio value="humorous">幽默型</Radio>
                      <Radio value="direct">直接型</Radio>
                    </Radio.Group>
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name={['conversation', 'responseStyle']} label="回复风格">
                    <Radio.Group>
                      <Radio value="concise">简洁</Radio>
                      <Radio value="detailed">详细</Radio>
                      <Radio value="conversational">对话式</Radio>
                    </Radio.Group>
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Panel>

          {/* 意图识别配置 */}
          <Panel header={
            <Space>
              <ExperimentOutlined />
              <Text strong>意图识别</Text>
            </Space>
          } key="intent">
            <Card>
              <Row gutter={24}>
                <Col span={12}>
                  <Form.Item name={['intent', 'confidenceThreshold']} label="置信度阈值">
                    <Slider
                      min={0.1}
                      max={1}
                      step={0.05}
                      marks={{
                        0.1: '10%',
                        0.5: '50%',
                        0.8: '80%',
                        1: '100%'
                      }}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name={['intent', 'enableLearning']} label="启用学习优化" valuePropName="checked">
                    <Switch checkedChildren="启用" unCheckedChildren="禁用" />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item name={['intent', 'fallbackResponse']} label="兜底回复">
                <TextArea
                  rows={3}
                  placeholder="当AI无法识别意图时的默认回复..."
                />
              </Form.Item>

              <Form.Item name={['intent', 'customIntents']} label="自定义意图">
                <Select
                  mode="tags"
                  placeholder="输入自定义意图，按回车添加"
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Card>
          </Panel>

          {/* 安全配置 */}
          <Panel header={
            <Space>
              <SettingOutlined />
              <Text strong>安全配置</Text>
            </Space>
          } key="safety">
            <Card>
              <Row gutter={24}>
                <Col span={8}>
                  <Form.Item name={['safety', 'contentFilter']} label="内容过滤" valuePropName="checked">
                    <Switch checkedChildren="启用" unCheckedChildren="禁用" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name={['safety', 'toxicityThreshold']} label="有害内容阈值">
                    <Slider
                      min={0.1}
                      max={1}
                      step={0.1}
                      marks={{
                        0.1: '严格',
                        0.5: '中等',
                        1: '宽松'
                      }}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name={['safety', 'maxCallDuration']} label="最大通话时长">
                    <InputNumber
                      min={30}
                      max={600}
                      style={{ width: '100%' }}
                      addonAfter="秒"
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item name={['safety', 'emergencyNumbers']} label="紧急联系人">
                <Select
                  mode="tags"
                  placeholder="输入紧急联系人号码"
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Card>
          </Panel>

          {/* 回复模板管理 */}
          <Panel header={
            <Space>
              <EditOutlined />
              <Text strong>回复模板</Text>
            </Space>
          } key="templates">
            <Card>
              <div style={{ marginBottom: 16 }}>
                <Space>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setEditingTemplate(null)
                      setTemplateModalVisible(true)
                    }}
                  >
                    添加模板
                  </Button>
                  <Button icon={<UploadOutlined />}>
                    导入模板
                  </Button>
                  <Button icon={<DownloadOutlined />}>
                    导出模板
                  </Button>
                </Space>
              </div>

              <Table<ResponseTemplate>
                columns={templateColumns}
                dataSource={configData?.templates || []}
                loading={isLoading}
                rowKey="id"
                pagination={{ pageSize: 10 }}
              />
            </Card>
          </Panel>
        </Collapse>
      </Form>

      {/* 语音配置模态框 */}
      <Modal
        title={editingVoice ? '编辑语音配置' : '添加语音配置'}
        open={voiceModalVisible}
        onCancel={() => setVoiceModalVisible(false)}
        footer={null}
        width={600}
      >
        {/* 语音配置表单内容 */}
        <div>表单内容待实现</div>
      </Modal>

      {/* 回复模板模态框 */}
      <Modal
        title={editingTemplate ? '编辑回复模板' : '添加回复模板'}
        open={templateModalVisible}
        onCancel={() => setTemplateModalVisible(false)}
        footer={null}
        width={700}
      >
        {/* 模板编辑表单内容 */}
        <div>表单内容待实现</div>
      </Modal>

      {/* AI配置测试模态框 */}
      <Modal
        title="AI配置测试"
        open={testModalVisible}
        onCancel={() => setTestModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setTestModalVisible(false)}>
            关闭
          </Button>,
          <Button
            key="test"
            type="primary"
            onClick={runAITest}
            loading={testConfigMutation.isPending}
          >
            开始测试
          </Button>
        ]}
        width={800}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert
            message="AI配置测试"
            description="使用当前配置运行AI对话测试，验证配置效果"
            type="info"
            showIcon
          />
          
          <Card title="测试输入">
            <TextArea
              rows={3}
              placeholder="输入测试对话内容..."
              defaultValue="您好，我想了解一下您的产品"
            />
          </Card>

          {testConfigMutation.data && (
            <Card title="测试结果">
              <Space direction="vertical" style={{ width: '100%' }}>
                <div>
                  <Text strong>AI回复：</Text>
                  <Paragraph>{testConfigMutation.data.response}</Paragraph>
                </div>
                
                <Row gutter={16}>
                  <Col span={8}>
                    <Statistic
                      title="响应时间"
                      value={testConfigMutation.data.metrics.responseTime}
                      suffix="ms"
                    />
                  </Col>
                  <Col span={8}>
                    <Statistic
                      title="置信度"
                      value={Math.round(testConfigMutation.data.metrics.confidence * 100)}
                      suffix="%"
                    />
                  </Col>
                  <Col span={8}>
                    <div>
                      <Text strong>识别意图：</Text>
                      <Tag color="blue">{testConfigMutation.data.metrics.intent}</Tag>
                    </div>
                  </Col>
                </Row>
              </Space>
            </Card>
          )}
        </Space>
      </Modal>
    </div>
  )
}

// 生成模拟AI配置数据
function generateMockAIConfig(): AIConfig {
  return {
    general: {
      enabled: true,
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 200,
      responseTimeout: 10
    },
    voice: {
      sttProvider: 'azure',
      ttsProvider: 'azure',
      voiceId: 'zh-CN-XiaoxiaoNeural',
      speechRate: 1.0,
      pitch: 0,
      volume: 75
    },
    conversation: {
      maxTurns: 8,
      terminationStrategy: 'polite',
      personalityType: 'friendly',
      responseStyle: 'concise',
      contextWindow: 5
    },
    intent: {
      confidenceThreshold: 0.7,
      fallbackResponse: '很抱歉，我没有听清楚，您能再说一遍吗？',
      enableLearning: true,
      customIntents: ['custom_sales', 'custom_survey']
    },
    safety: {
      contentFilter: true,
      toxicityThreshold: 0.3,
      maxCallDuration: 300,
      emergencyNumbers: ['110', '120', '119']
    }
  }
}

// 生成模拟语音配置数据
function generateMockVoiceProfiles(): VoiceProfile[] {
  return [
    {
      id: 'voice_1',
      name: '小雅（温柔女声）',
      provider: 'Azure',
      voiceId: 'zh-CN-XiaoxiaoNeural',
      language: '中文',
      gender: 'female',
      isActive: true,
      sampleUrl: '/api/voice/sample1.mp3',
      createdAt: '2024-01-15T10:30:00Z'
    },
    {
      id: 'voice_2',
      name: '小明（稳重男声）',
      provider: 'Azure',
      voiceId: 'zh-CN-YunxiNeural',
      language: '中文',
      gender: 'male',
      isActive: false,
      sampleUrl: '/api/voice/sample2.mp3',
      createdAt: '2024-01-16T14:20:00Z'
    }
  ]
}

// 生成模拟回复模板数据
function generateMockResponseTemplates(): ResponseTemplate[] {
  return [
    {
      id: 'template_1',
      name: '礼貌拒绝模板',
      category: '销售拒绝',
      template: '谢谢您的来电，但我现在不需要{product}服务，祝您工作顺利。',
      variables: ['product'],
      isActive: true,
      usage: 156
    },
    {
      id: 'template_2',
      name: '时间不便模板',
      category: '通用',
      template: '不好意思，我现在不方便接听电话，请{action}。',
      variables: ['action'],
      isActive: true,
      usage: 89
    },
    {
      id: 'template_3',
      name: '贷款拒绝模板',
      category: '金融拒绝',
      template: '我不需要贷款服务，请不要再联系我，谢谢。',
      variables: [],
      isActive: true,
      usage: 234
    }
  ]
}

// 生成模拟AI模型数据
function generateMockAIModels(): AIModel[] {
  return [
    {
      id: 'model_1',
      name: 'GPT-4',
      provider: 'OpenAI',
      version: '4.0',
      capabilities: ['对话', '意图识别', '情感分析'],
      cost: 0.03,
      latency: 500,
      isActive: true
    },
    {
      id: 'model_2',
      name: 'Claude-3',
      provider: 'Anthropic',
      version: '3.0',
      capabilities: ['对话', '安全过滤'],
      cost: 0.025,
      latency: 450,
      isActive: false
    }
  ]
}

export default AIConfiguration