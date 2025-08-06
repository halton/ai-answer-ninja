# AI电话应答系统 - Azure极简MVP架构方案

## 充分利用Azure Quota的设计理念
既然有Azure quota，我们可以用Azure的优质服务，但仍保持架构简单。

## MVP核心功能 (保持极简)
1. ✅ 接听来电并判断是否为骚扰电话
2. ✅ 用Azure AI自动回复并礼貌拒绝
3. ✅ 记录通话摘要供用户查看
4. ✅ 简单的白名单管理

## Azure优化的技术架构

### 技术栈选择
```yaml
应用层:
  - Azure Static Web Apps (前端托管)
  - Azure Functions (Serverless后端)
  - Azure Cosmos DB (数据库)

通信层:
  - Azure Communication Services (电话接入)
  - Azure Event Grid (事件驱动)

AI服务层:
  - Azure Speech Services (STT/TTS)
  - Azure OpenAI Service (GPT-4)
  
开发工具:
  - TypeScript (类型安全)
  - React (前端)
  - Azure CLI (部署)

成本优势:
  - 利用已有quota，成本极低
  - 大部分服务都有免费额度
  - 按需付费，无固定成本
```

### 系统架构图
```
┌─────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│   来电话    │────▶│ Azure Communication │────▶│ Azure Functions  │
└─────────────┘     │     Services        │     │  (Serverless)    │
                    └─────────────────────┘     └────────┬─────────┘
                                                         │
                    ┌─────────────────────┐              │ Event
                    │  Azure Speech STT   │◀─────────────┤
                    └─────────────────────┘              │
                                                         │
                    ┌─────────────────────┐              │
                    │  Azure OpenAI       │◀─────────────┤
                    │  (GPT-4)           │               │
                    └─────────────────────┘              │
                                                         │
                    ┌─────────────────────┐              │
                    │  Azure Speech TTS   │◀─────────────┤
                    └─────────────────────┘              │
                                                         ▼
                    ┌─────────────────────┐     ┌──────────────────┐
                    │  Azure Cosmos DB    │◀────│   存储通话记录    │
                    │  (Serverless)       │     └──────────────────┘
                    └─────────────────────┘
```

### 核心代码实现

#### 1. Azure Functions项目结构
```
ai-answer-ninja/
├── functions/
│   ├── IncomingCall/       # 处理来电
│   ├── ProcessAudio/       # 处理音频
│   ├── GenerateResponse/   # 生成AI回复
│   └── GetCallHistory/     # 获取通话历史
├── frontend/               # React前端
├── shared/                 # 共享代码
└── azure-pipelines.yml     # CI/CD
```

#### 2. 数据模型 (Cosmos DB)
```typescript
// shared/models.ts
export interface User {
  id: string;
  phoneNumber: string;
  email: string;
  createdAt: Date;
}

export interface CallRecord {
  id: string;
  userId: string;
  callerPhone: string;
  startTime: Date;
  duration: number;
  transcript: string;
  aiResponse: string;
  summary: string;
  handled: 'ai' | 'forwarded' | 'blocked';
}

export interface WhitelistEntry {
  id: string;
  userId: string;
  phoneNumber: string;
  name: string;
  createdAt: Date;
}
```

#### 3. 来电处理函数
```typescript
// functions/IncomingCall/index.ts
import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { CommunicationIdentityClient } from "@azure/communication-identity";
import { CallAutomationClient } from "@azure/communication-call-automation";
import { CosmosClient } from "@azure/cosmos";

const httpTrigger: AzureFunction = async function (
  context: Context,
  req: HttpRequest
): Promise<void> {
  const { incomingCallContext, from, to } = req.body;
  
  try {
    // 1. 初始化服务
    const callClient = new CallAutomationClient(
      process.env.ACS_CONNECTION_STRING
    );
    const cosmos = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
    const db = cosmos.database("ai-answer-ninja");
    
    // 2. 检查白名单
    const whitelist = await db
      .container("whitelist")
      .items.query({
        query: "SELECT * FROM c WHERE c.phoneNumber = @phone",
        parameters: [{ name: "@phone", value: from }]
      })
      .fetchAll();
    
    if (whitelist.resources.length > 0) {
      // 直接转接
      await callClient.answerCall(incomingCallContext, {
        callbackUri: `${process.env.FUNCTION_APP_URL}/api/CallEvents`
      });
      
      await callClient.transferCall({
        targetParticipant: { phoneNumber: process.env.USER_REAL_PHONE }
      });
      
      context.res = { status: 200, body: "Call forwarded" };
      return;
    }
    
    // 3. AI处理流程
    const answerCallResult = await callClient.answerCall(
      incomingCallContext,
      {
        callbackUri: `${process.env.FUNCTION_APP_URL}/api/CallEvents`,
        cognitiveServicesEndpoint: process.env.COGNITIVE_SERVICES_ENDPOINT
      }
    );
    
    // 4. 开始录音识别
    await callClient.getCallConnection(answerCallResult.callConnectionId)
      .getCallMedia()
      .startRecognizing({
        targetParticipant: { phoneNumber: from },
        recognizeOptions: {
          initialSilenceTimeoutInSeconds: 5,
          targetParticipant: { phoneNumber: from },
          speechLanguage: "zh-CN",
          dtmfOptions: { interToneTimeoutInSeconds: 5 }
        }
      });
    
    // 5. 播放欢迎语
    await playWelcomeMessage(answerCallResult.callConnectionId);
    
    context.res = { status: 200, body: "Call answered by AI" };
    
  } catch (error) {
    context.log.error("Error handling incoming call:", error);
    context.res = { status: 500, body: "Internal server error" };
  }
};

async function playWelcomeMessage(callConnectionId: string) {
  const callClient = new CallAutomationClient(
    process.env.ACS_CONNECTION_STRING
  );
  
  const connection = callClient.getCallConnection(callConnectionId);
  
  // 使用Azure TTS生成欢迎语
  const ttsResponse = await generateTTS("您好，请问有什么事吗？");
  
  await connection.getCallMedia().playToAll({
    audioFileUri: ttsResponse.audioFileUri,
    operationContext: "welcome"
  });
}

export default httpTrigger;
```

#### 4. AI响应生成函数
```typescript
// functions/GenerateResponse/index.ts
import { AzureFunction, Context } from "@azure/functions";
import { OpenAIClient, AzureKeyCredential } from "@azure/openai";
import { SpeechConfig, SpeechSynthesizer } from "microsoft-cognitiveservices-speech-sdk";

const eventGridTrigger: AzureFunction = async function (
  context: Context,
  eventGridEvent: any
): Promise<void> {
  if (eventGridEvent.eventType !== "Microsoft.Communication.RecognizeCompleted") {
    return;
  }
  
  const { callConnectionId, recognitionResult } = eventGridEvent.data;
  
  try {
    // 1. 获取识别结果
    const transcript = recognitionResult.speechResult.speech;
    context.log(`Recognized: ${transcript}`);
    
    // 2. 使用Azure OpenAI生成回复
    const openai = new OpenAIClient(
      process.env.AZURE_OPENAI_ENDPOINT,
      new AzureKeyCredential(process.env.AZURE_OPENAI_KEY)
    );
    
    const response = await openai.getChatCompletions(
      "gpt-4",
      [
        {
          role: "system",
          content: `你是一个智能电话助手，正在帮用户接听可能的骚扰电话。
          请根据来电内容判断是否为骚扰电话，并礼貌地回复。
          如果是推销、贷款、投资等骚扰电话，请委婉拒绝。
          回复要简短，不超过30个字。`
        },
        {
          role: "user",
          content: transcript
        }
      ],
      {
        temperature: 0.7,
        maxTokens: 100
      }
    );
    
    const aiResponse = response.choices[0].message.content;
    
    // 3. 使用Azure TTS转换为语音
    const audioFileUri = await generateTTS(aiResponse);
    
    // 4. 播放AI回复
    const callClient = new CallAutomationClient(
      process.env.ACS_CONNECTION_STRING
    );
    
    await callClient
      .getCallConnection(callConnectionId)
      .getCallMedia()
      .playToAll({
        audioFileUri,
        operationContext: "ai-response"
      });
    
    // 5. 判断是否需要结束通话
    if (shouldEndCall(transcript, aiResponse)) {
      setTimeout(async () => {
        await callClient.getCallConnection(callConnectionId).hangUp(true);
      }, 3000);
    }
    
    // 6. 保存通话记录
    await saveCallRecord({
      callConnectionId,
      transcript,
      aiResponse,
      timestamp: new Date()
    });
    
  } catch (error) {
    context.log.error("Error generating response:", error);
  }
};

async function generateTTS(text: string): Promise<string> {
  const speechConfig = SpeechConfig.fromSubscription(
    process.env.SPEECH_KEY,
    process.env.SPEECH_REGION
  );
  
  // 使用中文神经网络语音
  speechConfig.speechSynthesisVoiceName = "zh-CN-XiaoxiaoNeural";
  
  // 生成音频并上传到Blob Storage
  const synthesizer = new SpeechSynthesizer(speechConfig);
  const result = await synthesizer.speakTextAsync(text);
  
  // 上传到Azure Blob并返回URL
  const blobUrl = await uploadAudioToBlob(result.audioData);
  return blobUrl;
}

function shouldEndCall(transcript: string, response: string): boolean {
  // 简单的结束对话判断逻辑
  const endKeywords = ["再见", "不需要", "不用了", "谢谢"];
  return endKeywords.some(keyword => 
    response.includes(keyword) || transcript.includes(keyword)
  );
}

export default eventGridTrigger;
```

#### 5. 前端界面 (React + Azure Static Web Apps)
```tsx
// frontend/src/pages/Dashboard.tsx
import React, { useEffect, useState } from 'react';
import { DefaultAzureCredential } from '@azure/identity';
import { CosmosClient } from '@azure/cosmos';

interface CallRecord {
  id: string;
  callerPhone: string;
  startTime: Date;
  transcript: string;
  aiResponse: string;
  duration: number;
}

export const Dashboard: React.FC = () => {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    todayBlocked: 0,
    totalBlocked: 0,
    whitelistCount: 0
  });
  
  useEffect(() => {
    loadDashboardData();
  }, []);
  
  const loadDashboardData = async () => {
    try {
      // 调用Azure Function获取数据
      const response = await fetch('/api/GetCallHistory');
      const data = await response.json();
      
      setCalls(data.calls);
      setStats(data.stats);
      setLoading(false);
    } catch (error) {
      console.error('Error loading dashboard:', error);
      setLoading(false);
    }
  };
  
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          AI电话助手控制台
        </h1>
        
        {/* 统计卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <StatCard
            title="今日拦截"
            value={stats.todayBlocked}
            icon="🛡️"
          />
          <StatCard
            title="总计拦截"
            value={stats.totalBlocked}
            icon="📞"
          />
          <StatCard
            title="白名单"
            value={stats.whitelistCount}
            icon="✅"
          />
        </div>
        
        {/* 通话记录列表 */}
        <div className="bg-white shadow rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">
              最近通话记录
            </h2>
          </div>
          
          <div className="divide-y divide-gray-200">
            {calls.map((call) => (
              <CallRecordItem key={call.id} call={call} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const CallRecordItem: React.FC<{ call: CallRecord }> = ({ call }) => {
  return (
    <div className="px-6 py-4 hover:bg-gray-50">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center">
            <span className="text-sm font-medium text-gray-900">
              {call.callerPhone}
            </span>
            <span className="ml-4 text-sm text-gray-500">
              {new Date(call.startTime).toLocaleString('zh-CN')}
            </span>
          </div>
          
          <div className="mt-2 text-sm text-gray-600">
            <p><strong>来电：</strong>{call.transcript}</p>
            <p><strong>AI回复：</strong>{call.aiResponse}</p>
          </div>
        </div>
        
        <div className="ml-4 flex-shrink-0">
          <span className="text-sm text-gray-500">
            {call.duration}秒
          </span>
        </div>
      </div>
    </div>
  );
};
```

### 部署配置

#### 1. Azure资源创建脚本
```bash
#!/bin/bash
# deploy-azure.sh

# 设置变量
RESOURCE_GROUP="ai-answer-ninja-rg"
LOCATION="eastasia"
FUNCTION_APP="ai-answer-ninja-func"
STORAGE_ACCOUNT="aianswerninjastore"
COSMOS_ACCOUNT="ai-answer-ninja-cosmos"
STATIC_WEB_APP="ai-answer-ninja-web"

# 创建资源组
az group create --name $RESOURCE_GROUP --location $LOCATION

# 创建存储账户
az storage account create \
  --name $STORAGE_ACCOUNT \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --sku Standard_LRS

# 创建Function App
az functionapp create \
  --resource-group $RESOURCE_GROUP \
  --consumption-plan-location $LOCATION \
  --runtime node \
  --runtime-version 18 \
  --functions-version 4 \
  --name $FUNCTION_APP \
  --storage-account $STORAGE_ACCOUNT

# 创建Cosmos DB
az cosmosdb create \
  --name $COSMOS_ACCOUNT \
  --resource-group $RESOURCE_GROUP \
  --kind GlobalDocumentDB \
  --locations regionName=$LOCATION \
  --default-consistency-level Session \
  --enable-free-tier true

# 创建数据库和容器
az cosmosdb sql database create \
  --account-name $COSMOS_ACCOUNT \
  --resource-group $RESOURCE_GROUP \
  --name ai-answer-ninja

# 创建容器
az cosmosdb sql container create \
  --account-name $COSMOS_ACCOUNT \
  --database-name ai-answer-ninja \
  --resource-group $RESOURCE_GROUP \
  --name users \
  --partition-key-path /id

# 配置Azure Communication Services
az communication create \
  --name "ai-answer-ninja-acs" \
  --location "global" \
  --resource-group $RESOURCE_GROUP
```

#### 2. 环境变量配置
```env
# .env.local
ACS_CONNECTION_STRING=endpoint=https://xxx.communication.azure.com/;accesskey=xxx
COSMOS_CONNECTION_STRING=AccountEndpoint=https://xxx.documents.azure.com:443/;AccountKey=xxx
AZURE_OPENAI_ENDPOINT=https://xxx.openai.azure.com/
AZURE_OPENAI_KEY=xxx
SPEECH_KEY=xxx
SPEECH_REGION=eastasia
FUNCTION_APP_URL=https://ai-answer-ninja-func.azurewebsites.net
USER_REAL_PHONE=+8613800138000
```

### CI/CD配置
```yaml
# azure-pipelines.yml
trigger:
  - main

pool:
  vmImage: 'ubuntu-latest'

stages:
  - stage: Build
    jobs:
      - job: BuildFunctions
        steps:
          - task: NodeTool@0
            inputs:
              versionSpec: '18.x'
          
          - script: |
              cd functions
              npm install
              npm run build
            displayName: 'Build Functions'
          
          - task: ArchiveFiles@2
            inputs:
              rootFolderOrFile: 'functions'
              archiveType: 'zip'
              archiveFile: '$(Build.ArtifactStagingDirectory)/functions.zip'
          
          - publish: $(Build.ArtifactStagingDirectory)/functions.zip
            artifact: functions
      
      - job: BuildFrontend
        steps:
          - script: |
              cd frontend
              npm install
              npm run build
            displayName: 'Build Frontend'
          
          - publish: frontend/build
            artifact: frontend
  
  - stage: Deploy
    jobs:
      - deployment: DeployToAzure
        environment: 'production'
        strategy:
          runOnce:
            deploy:
              steps:
                - task: AzureFunctionApp@1
                  inputs:
                    azureSubscription: 'Azure Subscription'
                    appType: 'functionApp'
                    appName: 'ai-answer-ninja-func'
                    package: '$(Pipeline.Workspace)/functions/functions.zip'
                
                - task: AzureStaticWebApp@0
                  inputs:
                    app_location: '$(Pipeline.Workspace)/frontend'
                    azure_static_web_apps_api_token: $(AZURE_STATIC_WEB_APPS_API_TOKEN)
```

## 开发计划 (使用Azure - 14天)

### 第一周：Azure基础设施
- Day 1-2: Azure资源创建和配置
- Day 3-4: Azure Functions开发环境搭建
- Day 5-6: Communication Services集成
- Day 7: 基础通话流程测试

### 第二周：功能实现
- Day 8-9: Speech Services集成(STT/TTS)
- Day 10: Azure OpenAI集成
- Day 11-12: 前端开发和部署
- Day 13: 端到端测试
- Day 14: 性能优化和上线

## 成本分析 (利用Azure Quota)

### 开发成本
- Azure资源：$0 (使用quota)
- 开发时间：2周

### 运营成本预估
```yaml
假设月1000分钟通话:
  Azure Communication Services:
    - 电话号码: ~$2/月
    - 通话时长: ~$0.004/分钟 = $4
    
  Azure Speech Services:
    - STT: $0.5/1000次 ≈ $5
    - TTS: $4/百万字符 ≈ $2
    
  Azure OpenAI:
    - GPT-4: ~$10 (简短对话)
    
  其他服务:
    - Functions: 免费额度内
    - Cosmos DB: 免费额度内
    - Static Web Apps: 免费
  
总计: ~$25-30/月 (大部分被quota覆盖)
```

## Azure方案的独特优势

1. **统一生态系统**: 所有服务无缝集成
2. **企业级可靠性**: SLA保证99.9%+
3. **安全合规**: 默认满足各种合规要求
4. **全球部署**: 可选择最近的数据中心
5. **监控完善**: Application Insights自动监控

## 性能优化建议

1. **使用Azure CDN**: 加速静态资源
2. **启用缓存**: Redis Cache缓存常用回复
3. **预热Functions**: 避免冷启动
4. **区域优化**: 选择最近的Azure区域

## 下一步行动

1. 运行部署脚本创建Azure资源
2. 克隆代码模板开始开发
3. 配置Communication Services电话号码
4. 2周内完成MVP上线

---

**使用Azure quota，让成本接近于零，同时获得企业级服务质量！**