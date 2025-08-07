import React from 'react'
import { Modal, Form, Input, Select, Switch, message } from 'antd'
import { useUserStore } from '@/store'
import type { User, CreateUserDto, UpdateUserDto } from '@/types'

const { Option } = Select
const { TextArea } = Input

interface UserModalProps {
  visible: boolean
  mode: 'create' | 'edit'
  user: User | null
  onCancel: () => void
  onSuccess: () => void
}

const UserModal: React.FC<UserModalProps> = ({
  visible,
  mode,
  user,
  onCancel,
  onSuccess,
}) => {
  const { createUser, updateUser, loading } = useUserStore()
  const [form] = Form.useForm()

  // 当模态框打开时，设置表单初始值
  React.useEffect(() => {
    if (visible) {
      if (mode === 'edit' && user) {
        form.setFieldsValue({
          name: user.name,
          phoneNumber: user.phoneNumber,
          email: user.email,
          personality: user.personality,
          role: user.role,
          status: user.status,
          aiSettings: user.preferences?.aiSettings || {},
        })
      } else {
        form.resetFields()
      }
    }
  }, [visible, mode, user, form])

  // 表单提交
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      
      if (mode === 'create') {
        const createData: CreateUserDto = {
          name: values.name,
          phoneNumber: values.phoneNumber,
          email: values.email,
          personality: values.personality,
          preferences: {
            aiSettings: values.aiSettings,
          },
        }
        
        await createUser(createData)
        message.success('用户创建成功')
      } else if (mode === 'edit' && user) {
        const updateData: UpdateUserDto = {
          name: values.name,
          phoneNumber: values.phoneNumber,
          email: values.email,
          personality: values.personality,
          role: values.role,
          status: values.status,
          preferences: {
            ...user.preferences,
            aiSettings: values.aiSettings,
          },
        }
        
        await updateUser(user.id, updateData)
        message.success('用户更新成功')
      }
      
      form.resetFields()
      onSuccess()
    } catch (error) {
      console.error('Form validation failed:', error)
    }
  }

  return (
    <Modal
      title={mode === 'create' ? '新建用户' : '编辑用户'}
      open={visible}
      onCancel={onCancel}
      onOk={handleSubmit}
      confirmLoading={loading}
      width={600}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          status: 'active',
          role: 'user',
          personality: 'polite',
          aiSettings: {
            responseStyle: 'formal',
            maxCallDuration: 300,
            autoTerminate: true,
            whitelistEnabled: true,
          },
        }}
      >
        <Form.Item
          name="name"
          label="用户姓名"
          rules={[
            { required: true, message: '请输入用户姓名' },
            { min: 2, max: 20, message: '姓名长度为2-20个字符' },
          ]}
        >
          <Input placeholder="请输入用户姓名" />
        </Form.Item>

        <Form.Item
          name="phoneNumber"
          label="手机号码"
          rules={[
            { required: true, message: '请输入手机号码' },
            { pattern: /^1[3-9]\d{9}$/, message: '请输入有效的手机号码' },
          ]}
        >
          <Input placeholder="请输入手机号码" />
        </Form.Item>

        <Form.Item
          name="email"
          label="邮箱地址"
          rules={[
            { type: 'email', message: '请输入有效的邮箱地址' },
          ]}
        >
          <Input placeholder="请输入邮箱地址（可选）" />
        </Form.Item>

        <Form.Item
          name="personality"
          label="个性化设置"
          rules={[{ required: true, message: '请选择个性化设置' }]}
        >
          <Select placeholder="选择AI应答个性">
            <Option value="polite">礼貌型</Option>
            <Option value="direct">直接型</Option>
            <Option value="humorous">幽默型</Option>
            <Option value="professional">专业型</Option>
          </Select>
        </Form.Item>

        <Form.Item
          name="role"
          label="用户角色"
          rules={[{ required: true, message: '请选择用户角色' }]}
        >
          <Select placeholder="选择用户角色">
            <Option value="user">普通用户</Option>
            <Option value="admin">管理员</Option>
          </Select>
        </Form.Item>

        <Form.Item
          name="status"
          label="账户状态"
          rules={[{ required: true, message: '请选择账户状态' }]}
        >
          <Select placeholder="选择账户状态">
            <Option value="active">正常</Option>
            <Option value="inactive">未激活</Option>
            <Option value="suspended">已暂停</Option>
          </Select>
        </Form.Item>

        {/* AI设置 */}
        <Form.Item label="AI应答设置">
          <Form.Item
            name={['aiSettings', 'responseStyle']}
            label="应答风格"
            style={{ marginBottom: 16 }}
          >
            <Select placeholder="选择应答风格">
              <Option value="formal">正式</Option>
              <Option value="casual">随意</Option>
              <Option value="custom">自定义</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name={['aiSettings', 'maxCallDuration']}
            label="最大通话时长（秒）"
            style={{ marginBottom: 16 }}
          >
            <Input type="number" min={60} max={600} placeholder="300" />
          </Form.Item>

          <Form.Item
            name={['aiSettings', 'autoTerminate']}
            label="自动终止通话"
            valuePropName="checked"
            style={{ marginBottom: 16 }}
          >
            <Switch />
          </Form.Item>

          <Form.Item
            name={['aiSettings', 'whitelistEnabled']}
            label="启用白名单"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default UserModal