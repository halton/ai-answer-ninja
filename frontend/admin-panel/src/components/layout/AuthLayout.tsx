import React from 'react'
import { Layout, Card, Row, Col } from 'antd'
import { RobotOutlined } from '@ant-design/icons'

const { Content } = Layout

interface AuthLayoutProps {
  children: React.ReactNode
}

const AuthLayout: React.FC<AuthLayoutProps> = ({ children }) => {
  return (
    <Layout style={{ 
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    }}>
      <Content style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}>
        <Row justify="center" style={{ width: '100%', maxWidth: 400 }}>
          <Col span={24}>
            {/* Logo和标题 */}
            <div style={{
              textAlign: 'center',
              marginBottom: 32,
              color: 'white',
            }}>
              <div style={{
                fontSize: 48,
                marginBottom: 16,
              }}>
                <RobotOutlined />
              </div>
              <h1 style={{
                fontSize: 28,
                fontWeight: 600,
                margin: 0,
                marginBottom: 8,
                color: 'white',
              }}>
                AI电话应答系统
              </h1>
              <p style={{
                fontSize: 16,
                margin: 0,
                opacity: 0.9,
                color: 'white',
              }}>
                智能管理控制台
              </p>
            </div>

            {/* 登录卡片 */}
            <Card
              style={{
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
                border: 'none',
                borderRadius: 12,
              }}
              bodyStyle={{
                padding: 32,
              }}
            >
              {children}
            </Card>

            {/* 底部信息 */}
            <div style={{
              textAlign: 'center',
              marginTop: 24,
              color: 'white',
              opacity: 0.8,
              fontSize: 14,
            }}>
              <p style={{ margin: 0 }}>
                © 2024 AI Answer Ninja. All rights reserved.
              </p>
            </div>
          </Col>
        </Row>
      </Content>
    </Layout>
  )
}

export default AuthLayout