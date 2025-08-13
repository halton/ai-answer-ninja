import React from 'react'
import { Form, Row, Col, Button, Space, Card } from 'antd'
import { SearchOutlined, ReloadOutlined } from '@ant-design/icons'
import type { FormProps } from 'antd/es/form'

export interface FilterFormProps extends Omit<FormProps, 'onFinish'> {
  onSearch?: (values: any) => void
  onReset?: () => void
  children: React.ReactNode
  loading?: boolean
  span?: number
  showActions?: boolean
  bordered?: boolean
}

const FilterForm: React.FC<FilterFormProps> = ({
  onSearch,
  onReset,
  children,
  loading = false,
  span = 6,
  showActions = true,
  bordered = true,
  ...formProps
}) => {
  const [form] = Form.useForm()

  const handleSearch = () => {
    form.validateFields().then(values => {
      onSearch?.(values)
    })
  }

  const handleReset = () => {
    form.resetFields()
    onReset?.()
  }

  const formContent = (
    <Form form={form} layout="vertical" {...formProps}>
      <Row gutter={16}>
        {React.Children.map(children, (child, index) => (
          <Col span={span} key={index}>
            {child}
          </Col>
        ))}
        {showActions && (
          <Col span={span}>
            <Form.Item label=" ">
              <Space>
                <Button
                  type="primary"
                  icon={<SearchOutlined />}
                  onClick={handleSearch}
                  loading={loading}
                >
                  搜索
                </Button>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={handleReset}
                >
                  重置
                </Button>
              </Space>
            </Form.Item>
          </Col>
        )}
      </Row>
    </Form>
  )

  if (bordered) {
    return <Card>{formContent}</Card>
  }

  return formContent
}

export default FilterForm