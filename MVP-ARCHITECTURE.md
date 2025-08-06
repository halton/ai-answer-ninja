# AI电话应答系统 - 极简MVP架构方案

## 项目定位重新定义
**一句话描述**: 自动接听骚扰电话的AI助手，让用户不再被打扰。

## MVP核心功能 (仅这些！)
1. ✅ 接听来电并判断是否为骚扰电话
2. ✅ 用AI自动回复并礼貌拒绝
3. ✅ 记录通话摘要供用户查看
4. ❌ ~~语音克隆~~ (不做)
5. ❌ ~~复杂个性化~~ (不做)
6. ❌ ~~用户画像系统~~ (不做)

## 极简技术架构

### 技术栈选择
```yaml
前端:
  - Next.js 14 (App Router)
  - Tailwind CSS
  - 部署: Vercel (免费)

后端:
  - Next.js API Routes
  - 数据库: Supabase (PostgreSQL)
  - 认证: Supabase Auth

核心服务:
  - 电话: Twilio
  - 语音识别: 讯飞开放平台 (中文最准)
  - AI对话: 通义千问 (便宜)
  - 语音合成: 讯飞TTS

成本预估:
  - 开发期: ~$0 (都有免费额度)
  - 运营期: ~$30-50/月 (1000分钟)
```

### 系统架构图
```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   来电话    │────▶│ Twilio       │────▶│  Next.js    │
└─────────────┘     │ Webhook      │     │  API Route  │
                    └──────────────┘     └──────┬──────┘
                                                 │
                    ┌──────────────┐             │
                    │   讯飞STT    │◀────────────┤
                    └──────────────┘             │
                                                 │
                    ┌──────────────┐             │
                    │  通义千问AI  │◀────────────┤
                    └──────────────┘             │
                                                 │
                    ┌──────────────┐             │
                    │   讯飞TTS    │◀────────────┤
                    └──────────────┘             │
                                                 ▼
                    ┌──────────────┐     ┌─────────────┐
                    │  Supabase    │◀────│   记录      │
                    │  Database    │     │   保存      │
                    └──────────────┘     └─────────────┘
```

### 核心代码实现

#### 1. 数据库设计 (极简版)
```sql
-- 用户表
CREATE TABLE users (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  phone VARCHAR(20) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 通话记录表
CREATE TABLE call_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  caller_phone VARCHAR(20) NOT NULL,
  start_time TIMESTAMP NOT NULL,
  duration_seconds INTEGER,
  ai_handled BOOLEAN DEFAULT true,
  summary TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 简单白名单表
CREATE TABLE whitelist (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  phone VARCHAR(20) NOT NULL,
  name VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, phone)
);
```

#### 2. Twilio Webhook处理
```javascript
// app/api/twilio/voice/route.js
import { NextResponse } from 'next/server';
import twilio from 'twilio';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export async function POST(request) {
  const formData = await request.formData();
  const from = formData.get('From');
  const to = formData.get('To');
  const callSid = formData.get('CallSid');
  
  // 1. 检查是否在白名单
  const { data: whitelist } = await supabase
    .from('whitelist')
    .select('*')
    .eq('phone', from)
    .single();
    
  if (whitelist) {
    // 直接转接
    const response = new twilio.twiml.VoiceResponse();
    response.dial(process.env.USER_REAL_PHONE);
    return new Response(response.toString(), {
      headers: { 'Content-Type': 'text/xml' }
    });
  }
  
  // 2. AI处理
  const response = new twilio.twiml.VoiceResponse();
  
  // 先播放等待音
  response.say('您好，请稍等', { language: 'zh-CN' });
  
  // 录音并处理
  response.record({
    maxLength: 10,
    action: '/api/twilio/process',
    method: 'POST',
    speechTimeout: 2
  });
  
  return new Response(response.toString(), {
    headers: { 'Content-Type': 'text/xml' }
  });
}
```

#### 3. AI处理逻辑
```javascript
// app/api/twilio/process/route.js
export async function POST(request) {
  const formData = await request.formData();
  const recordingUrl = formData.get('RecordingUrl');
  const callSid = formData.get('CallSid');
  
  try {
    // 1. 下载录音
    const audioResponse = await fetch(recordingUrl + '.mp3');
    const audioBuffer = await audioResponse.arrayBuffer();
    
    // 2. 语音识别 (讯飞API)
    const transcript = await xunfeiSTT(audioBuffer);
    
    // 3. AI生成回复
    const aiResponse = await generateResponse(transcript);
    
    // 4. 文字转语音
    const audioUrl = await xunfeiTTS(aiResponse);
    
    // 5. 播放回复并挂断
    const response = new twilio.twiml.VoiceResponse();
    response.play(audioUrl);
    response.pause({ length: 1 });
    response.say('再见', { language: 'zh-CN' });
    response.hangup();
    
    // 6. 保存记录
    await saveCallLog(callSid, transcript, aiResponse);
    
    return new Response(response.toString(), {
      headers: { 'Content-Type': 'text/xml' }
    });
    
  } catch (error) {
    // 出错时的默认回复
    const response = new twilio.twiml.VoiceResponse();
    response.say('不好意思，我现在没空，再见', { language: 'zh-CN' });
    response.hangup();
    
    return new Response(response.toString(), {
      headers: { 'Content-Type': 'text/xml' }
    });
  }
}

// AI回复生成 (超简单版)
async function generateResponse(transcript) {
  // 简单关键词匹配
  if (transcript.includes('贷款') || transcript.includes('借钱')) {
    return '谢谢，我不需要贷款服务。';
  }
  
  if (transcript.includes('保险')) {
    return '我已经有保险了，谢谢。';
  }
  
  if (transcript.includes('投资') || transcript.includes('理财')) {
    return '我对投资不感兴趣，谢谢。';
  }
  
  // 默认回复
  return '不好意思，我现在很忙，有事请发短信。';
}
```

#### 4. 用户界面 (极简版)
```jsx
// app/dashboard/page.js
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

export default function Dashboard() {
  const [calls, setCalls] = useState([]);
  const [whitelist, setWhitelist] = useState([]);
  
  useEffect(() => {
    loadData();
  }, []);
  
  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">AI电话助手</h1>
      
      {/* 状态卡片 */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white p-4 rounded shadow">
          <div className="text-gray-500">今日拦截</div>
          <div className="text-2xl font-bold">{calls.filter(c => 
            new Date(c.created_at).toDateString() === new Date().toDateString()
          ).length}</div>
        </div>
        <div className="bg-white p-4 rounded shadow">
          <div className="text-gray-500">总计拦截</div>
          <div className="text-2xl font-bold">{calls.length}</div>
        </div>
        <div className="bg-white p-4 rounded shadow">
          <div className="text-gray-500">白名单</div>
          <div className="text-2xl font-bold">{whitelist.length}</div>
        </div>
      </div>
      
      {/* 通话记录 */}
      <div className="bg-white rounded shadow p-6">
        <h2 className="text-xl font-semibold mb-4">最近通话</h2>
        <div className="space-y-3">
          {calls.map(call => (
            <div key={call.id} className="border-b pb-3">
              <div className="flex justify-between">
                <span className="font-medium">{call.caller_phone}</span>
                <span className="text-gray-500">
                  {new Date(call.start_time).toLocaleString()}
                </span>
              </div>
              <div className="text-sm text-gray-600 mt-1">
                {call.summary || 'AI已自动拒绝'}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

### 部署步骤

#### 1. 环境准备
```bash
# 1. 创建项目
npx create-next-app@latest ai-answer-ninja
cd ai-answer-ninja

# 2. 安装依赖
npm install twilio @supabase/supabase-js

# 3. 配置环境变量
cp .env.example .env.local
```

#### 2. 服务配置
```env
# .env.local
TWILIO_ACCOUNT_SID=xxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_PHONE_NUMBER=+1234567890

SUPABASE_URL=xxx
SUPABASE_ANON_KEY=xxx

XUNFEI_APP_ID=xxx
XUNFEI_API_KEY=xxx

QWEN_API_KEY=xxx

USER_REAL_PHONE=+8613800138000
```

#### 3. 一键部署
```bash
# 部署到Vercel
vercel

# 配置Twilio Webhook
# 将 https://your-app.vercel.app/api/twilio/voice 
# 配置到Twilio号码的Voice Webhook
```

## 开发计划 (14天)

### 第一周：核心功能
- Day 1-2: 项目搭建，Supabase配置
- Day 3-4: Twilio集成，基础通话流程
- Day 5-6: 讯飞语音服务集成
- Day 7: 简单AI回复逻辑

### 第二周：完善和上线
- Day 8-9: 用户界面开发
- Day 10-11: 白名单功能
- Day 12-13: 测试和Bug修复  
- Day 14: 部署上线

## 成本分析

### 开发成本
- 1个全栈开发者 × 2周
- 总计：~$2000-3000 (或自己开发$0)

### 运营成本 (月)
```yaml
固定成本:
  - Vercel: $0 (免费额度)
  - Supabase: $0 (免费额度) 
  - Domain: $1/月

变量成本 (按1000分钟):
  - Twilio: ~$15
  - 讯飞STT: ~$5
  - 讯飞TTS: ~$5
  - 通义千问: ~$5
  
总计: ~$30-40/月
```

## 关键优势

1. **真正可以2周上线**
2. **成本极低**
3. **维护简单**
4. **可快速迭代**

## 下一步行动

1. 立即开始开发MVP
2. 找10个朋友测试
3. 收集反馈快速迭代
4. 验证付费意愿
5. 再决定是否需要复杂架构

---

记住：**Done is better than perfect!**