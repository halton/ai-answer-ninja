# AI电话应答系统 - 管理面板

这是一个现代化的React管理面板应用，用于管理AI电话应答系统的各个方面。

## 📸 界面预览

### 主要功能页面
- **仪表盘** - 系统概览和关键指标
- **用户管理** - 用户信息管理和权限控制
- **通话记录** - 通话历史查看、搜索和分析
- **白名单管理** - 智能白名单管理和推荐
- **系统监控** - 实时系统状态和性能监控
- **AI配置** - AI模型和对话策略配置
- **统计分析** - 详细的数据分析和报表

### 界面特色
- 🎨 现代化的Material Design风格
- 🌓 支持浅色/深色主题切换
- 📱 完全响应式设计，支持移动端
- 🚀 流畅的动画和交互效果
- 📊 丰富的图表可视化
- 🔧 高度可定制的UI组件

## 🛠 技术栈

### 核心技术
- **React 18** - 用户界面库
- **TypeScript** - 类型安全的JavaScript
- **Vite** - 现代化的构建工具
- **Ant Design 5** - 企业级UI组件库

### 状态管理
- **Zustand** - 轻量级状态管理
- **TanStack Query** - 服务器状态管理

### 样式方案
- **SCSS** - CSS预处理器
- **CSS Variables** - 主题变量系统
- **Responsive Design** - 响应式设计

### 图表可视化
- **ECharts** - 强大的图表库
- **echarts-for-react** - React封装

### 开发工具
- **ESLint** - 代码质量检查
- **TypeScript** - 类型检查
- **Sass** - CSS预处理

## 🚀 快速开始

### 环境要求
- Node.js >= 16.0.0
- npm >= 8.0.0 或 yarn >= 1.22.0

### 安装依赖
```bash
npm install
# 或
yarn install
```

### 开发模式
```bash
npm run dev
# 或
yarn dev
```
访问 http://localhost:3100

### 构建生产版本
```bash
npm run build
# 或
yarn build
```

### 代码检查
```bash
npm run lint
# 或
yarn lint
```

## 📁 项目结构

```
src/
├── components/          # 可复用组件
│   ├── common/         # 通用组件
│   ├── layout/         # 布局组件
│   └── ui/            # UI组件库
├── pages/              # 页面组件
│   ├── auth/          # 认证相关页面
│   ├── call/          # 通话记录页面
│   ├── whitelist/     # 白名单管理页面
│   ├── system/        # 系统监控页面
│   ├── ai/            # AI配置页面
│   ├── analytics/     # 统计分析页面
│   └── user/          # 用户管理页面
├── hooks/              # 自定义Hooks
│   ├── common/        # 通用Hooks
│   ├── layout/        # 布局相关Hooks
│   └── ui/            # UI相关Hooks
├── services/           # API服务
│   ├── auth.ts        # 认证服务
│   ├── http.ts        # HTTP客户端
│   ├── user.ts        # 用户服务
│   └── websocket.ts   # WebSocket服务
├── store/              # 状态管理
│   ├── auth.ts        # 认证状态
│   ├── ui.ts          # UI状态
│   ├── user.ts        # 用户状态
│   └── index.ts       # 状态入口
├── styles/             # 样式文件
│   └── themes.scss    # 主题变量
├── types/              # TypeScript类型
│   └── index.ts       # 类型定义
├── utils/              # 工具函数
└── assets/             # 静态资源
```

## 🎨 主题系统

### 主题切换
系统支持三种主题模式：
- **浅色模式** - 默认的浅色主题
- **深色模式** - 适合夜间使用的深色主题
- **自动模式** - 跟随系统主题设置

### 主题定制
可以通过主题设置面板自定义：
- 主色调
- 圆角大小
- 字体大小
- 组件尺寸

### 使用主题Hook
```typescript
import { useTheme } from '@/hooks/ui/useTheme'

function MyComponent() {
  const { isDark, toggleTheme, setThemeMode } = useTheme()
  
  return (
    <button onClick={toggleTheme}>
      切换到{isDark ? '浅色' : '深色'}模式
    </button>
  )
}
```

## 📱 响应式设计

### 断点定义
- **xs**: < 480px (手机竖屏)
- **sm**: 576px - 768px (手机横屏)
- **md**: 768px - 992px (平板)
- **lg**: 992px - 1200px (小屏笔记本)
- **xl**: 1200px - 1600px (桌面)
- **xxl**: > 1600px (大屏)

### 响应式工具类
```scss
// 使用响应式混入
@include respond-to(mobile) {
  .my-component {
    padding: 12px;
  }
}

// 使用工具类
.my-element {
  @extend .mx-4; // margin-left: 16px; margin-right: 16px;
  @extend .p-2;  // padding: 8px;
}
```

## 🧩 UI组件库

### 核心组件
- **ActionButton** - 带提示的操作按钮
- **DataTable** - 增强的数据表格
- **StatCard** - 统计卡片
- **ChartCard** - 图表卡片
- **StatusIndicator** - 状态指示器
- **FilterForm** - 筛选表单

### 使用示例
```typescript
import { DataTable, StatCard, ChartCard } from '@/components/ui'

function MyPage() {
  return (
    <div>
      <StatCard
        title="总用户数"
        value={1234}
        trend="up"
        trendValue={12}
      />
      
      <DataTable
        title="用户列表"
        dataSource={users}
        columns={columns}
        searchable
        exportable
      />
      
      <ChartCard
        title="用户增长趋势"
        option={chartOption}
        refreshable
        onRefresh={handleRefresh}
      />
    </div>
  )
}
```

## 📊 图表集成

### ECharts配置
系统集成了ECharts图表库，支持多种图表类型：
- 折线图
- 柱状图
- 饼图
- 雷达图
- 仪表盘

### 图表示例
```typescript
const chartOption = {
  title: { text: '数据趋势' },
  tooltip: { trigger: 'axis' },
  xAxis: { 
    type: 'category',
    data: ['1月', '2月', '3月', '4月', '5月']
  },
  yAxis: { type: 'value' },
  series: [{
    data: [120, 200, 150, 80, 70],
    type: 'line',
    smooth: true
  }]
}
```

## 🔧 开发指南

### 代码规范
- 使用TypeScript进行类型检查
- 遵循ESLint代码规范
- 组件命名使用PascalCase
- 文件命名使用kebab-case

### 组件开发
```typescript
import React from 'react'
import { Card, Button } from 'antd'

interface MyComponentProps {
  title: string
  onAction?: () => void
}

const MyComponent: React.FC<MyComponentProps> = ({ 
  title, 
  onAction 
}) => {
  return (
    <Card title={title}>
      <Button onClick={onAction}>
        执行操作
      </Button>
    </Card>
  )
}

export default MyComponent
```

### 状态管理
```typescript
import { create } from 'zustand'

interface MyStore {
  count: number
  increment: () => void
  decrement: () => void
}

const useMyStore = create<MyStore>((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
  decrement: () => set((state) => ({ count: state.count - 1 }))
}))
```

## 🔌 API集成

### HTTP客户端
```typescript
import { httpClient } from '@/services/http'

// GET请求
const users = await httpClient.get('/api/users')

// POST请求
const newUser = await httpClient.post('/api/users', userData)

// 带参数的请求
const filteredUsers = await httpClient.get('/api/users', {
  params: { page: 1, pageSize: 10 }
})
```

### WebSocket连接
```typescript
import { useWebSocket } from '@/services/websocket'

function MyComponent() {
  const { connect, disconnect, send, on } = useWebSocket()
  
  useEffect(() => {
    connect()
    
    on('message', (data) => {
      console.log('收到消息:', data)
    })
    
    return () => disconnect()
  }, [])
  
  const sendMessage = () => {
    send('message_type', { data: 'hello' })
  }
  
  return <button onClick={sendMessage}>发送消息</button>
}
```

## 🚀 部署

### 构建配置
项目使用Vite进行构建，支持以下特性：
- 代码分割
- Tree Shaking
- 资源优化
- Source Map

### 环境变量
```env
# API配置
VITE_API_BASE_URL=http://localhost:3000
VITE_WS_URL=ws://localhost:3002

# 功能开关
VITE_ENABLE_MOCK=false
VITE_ENABLE_ANALYTICS=true
```

### 生产部署
```bash
# 构建
npm run build

# 预览构建结果
npm run preview

# 部署到静态服务器
cp -r dist/* /var/www/html/
```

## 📝 更新日志

### v1.0.0 (2024-01-15)
- ✨ 初始版本发布
- 🎨 完整的UI组件库
- 🌓 主题系统
- 📊 图表集成
- 📱 响应式设计

## 🤝 贡献指南

1. Fork项目仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 开启Pull Request

## 📄 许可证

本项目基于MIT许可证开源 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🆘 支持

如果您在使用过程中遇到问题，可以通过以下方式获取帮助：

- 查看 [文档](docs/)
- 提交 [Issue](issues/)
- 发送邮件至 support@ai-ninja.com

---

**AI电话应答系统管理面板** - 让骚扰电话管理变得简单高效 🚀