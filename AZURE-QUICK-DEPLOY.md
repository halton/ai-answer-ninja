# Azure AI电话助手 - 快速部署指南

## 🚀 30分钟快速部署

### 前置要求
- Azure账号（有quota）
- 安装 [Azure CLI](https://docs.microsoft.com/cli/azure/install-azure-cli)
- 安装 [Node.js 18+](https://nodejs.org/)
- 安装 [Azure Functions Core Tools](https://docs.microsoft.com/azure/azure-functions/functions-run-local)

### Step 1: 一键创建所有Azure资源 (10分钟)

```bash
# 1. 登录Azure
az login

# 2. 设置订阅（如果有多个订阅）
az account list --output table
az account set --subscription "你的订阅ID"

# 3. 创建部署脚本 deploy.sh
cat > deploy.sh << 'EOF'
#!/bin/bash

# 配置变量
RESOURCE_GROUP="ai-phone-rg"
LOCATION="eastasia"  # 或 "chinaeast2" 如果用世纪互联
UNIQUE_ID=$RANDOM
FUNCTION_APP="ai-phone-func-$UNIQUE_ID"
STORAGE="aiphone$UNIQUE_ID"
COSMOS_DB="ai-phone-cosmos-$UNIQUE_ID"
COMM_SERVICE="ai-phone-comm-$UNIQUE_ID"
SPEECH_SERVICE="ai-phone-speech-$UNIQUE_ID"
OPENAI_SERVICE="ai-phone-openai-$UNIQUE_ID"

echo "🚀 开始创建资源..."

# 创建资源组
echo "1️⃣ 创建资源组..."
az group create --name $RESOURCE_GROUP --location $LOCATION

# 创建存储账户
echo "2️⃣ 创建存储账户..."
az storage account create \
  --name $STORAGE \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --sku Standard_LRS \
  --kind StorageV2

# 创建Cosmos DB (免费层)
echo "3️⃣ 创建Cosmos DB..."
az cosmosdb create \
  --name $COSMOS_DB \
  --resource-group $RESOURCE_GROUP \
  --locations regionName=$LOCATION \
  --enable-free-tier true \
  --default-consistency-level Session

# 创建数据库和容器
az cosmosdb sql database create \
  --account-name $COSMOS_DB \
  --resource-group $RESOURCE_GROUP \
  --name ai-phone-db

az cosmosdb sql container create \
  --account-name $COSMOS_DB \
  --database-name ai-phone-db \
  --resource-group $RESOURCE_GROUP \
  --name calls \
  --partition-key-path /userId

az cosmosdb sql container create \
  --account-name $COSMOS_DB \
  --database-name ai-phone-db \
  --resource-group $RESOURCE_GROUP \
  --name whitelist \
  --partition-key-path /userId

# 创建Function App
echo "4️⃣ 创建Function App..."
az functionapp create \
  --resource-group $RESOURCE_GROUP \
  --consumption-plan-location $LOCATION \
  --runtime node \
  --runtime-version 18 \
  --functions-version 4 \
  --name $FUNCTION_APP \
  --storage-account $STORAGE \
  --os-type Linux

# 创建Communication Services
echo "5️⃣ 创建Communication Services..."
az communication create \
  --name $COMM_SERVICE \
  --location Global \
  --resource-group $RESOURCE_GROUP \
  --data-location UnitedStates

# 创建Speech Services
echo "6️⃣ 创建Speech Services..."
az cognitiveservices account create \
  --name $SPEECH_SERVICE \
  --resource-group $RESOURCE_GROUP \
  --kind SpeechServices \
  --sku F0 \
  --location $LOCATION \
  --yes

# 创建Azure OpenAI (如果有权限)
echo "7️⃣ 创建Azure OpenAI..."
az cognitiveservices account create \
  --name $OPENAI_SERVICE \
  --resource-group $RESOURCE_GROUP \
  --kind OpenAI \
  --sku S0 \
  --location $LOCATION \
  --yes || echo "⚠️ OpenAI创建失败，可能需要申请权限"

echo "✅ 资源创建完成！"
echo ""
echo "📝 保存以下信息："
echo "Resource Group: $RESOURCE_GROUP"
echo "Function App: $FUNCTION_APP"
echo "Cosmos DB: $COSMOS_DB"
echo "Communication Service: $COMM_SERVICE"
echo "Speech Service: $SPEECH_SERVICE"
echo "OpenAI Service: $OPENAI_SERVICE"

# 获取连接字符串
echo ""
echo "🔑 获取连接字符串..."

# Cosmos DB连接字符串
COSMOS_CONNECTION=$(az cosmosdb keys list \
  --name $COSMOS_DB \
  --resource-group $RESOURCE_GROUP \
  --type connection-strings \
  --query connectionStrings[0].connectionString \
  --output tsv)

# Communication Services连接字符串
COMM_CONNECTION=$(az communication list-key \
  --name $COMM_SERVICE \
  --resource-group $RESOURCE_GROUP \
  --query primaryConnectionString \
  --output tsv)

# Speech Services密钥
SPEECH_KEY=$(az cognitiveservices account keys list \
  --name $SPEECH_SERVICE \
  --resource-group $RESOURCE_GROUP \
  --query key1 \
  --output tsv)

# 保存到环境变量文件
cat > .env.azure << EOL
RESOURCE_GROUP=$RESOURCE_GROUP
FUNCTION_APP=$FUNCTION_APP
COSMOS_CONNECTION="$COSMOS_CONNECTION"
COMM_CONNECTION="$COMM_CONNECTION"
SPEECH_KEY=$SPEECH_KEY
SPEECH_REGION=$LOCATION
EOL

echo "✅ 环境变量已保存到 .env.azure"
EOF

# 4. 执行部署脚本
chmod +x deploy.sh
./deploy.sh
```

### Step 2: 快速创建Function项目 (5分钟)

```bash
# 1. 创建项目目录
mkdir ai-phone-assistant && cd ai-phone-assistant

# 2. 初始化Function项目
func init --typescript

# 3. 创建核心Functions
func new --name IncomingCall --template "HTTP trigger"
func new --name ProcessSpeech --template "Event Grid trigger"

# 4. 安装依赖
npm install @azure/communication-call-automation \
            @azure/communication-identity \
            @azure/cosmos \
            microsoft-cognitiveservices-speech-sdk \
            @azure/openai
```

### Step 3: 核心代码快速配置 (10分钟)

创建文件 `IncomingCall/index.ts`:

```typescript
import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { CallAutomationClient } from "@azure/communication-call-automation";

const httpTrigger: AzureFunction = async function (
    context: Context,
    req: HttpRequest
): Promise<void> {
    const client = new CallAutomationClient(process.env.COMM_CONNECTION);
    
    try {
        // 接听电话
        const result = await client.answerCall(req.body.incomingCallContext, {
            callbackUri: `${process.env.FUNCTION_URL}/api/callbacks`
        });
        
        // 播放欢迎语
        await result.callConnection.getCallMedia().playToAll([{
            kind: "text",
            text: "您好，请问有什么事吗？",
            voiceName: "zh-CN-XiaoxiaoNeural"
        }]);
        
        context.res = { status: 200 };
    } catch (error) {
        context.log.error(error);
        context.res = { status: 500 };
    }
};

export default httpTrigger;
```

### Step 4: 配置环境变量 (2分钟)

```bash
# 1. 创建 local.settings.json
cat > local.settings.json << 'EOF'
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "COMM_CONNECTION": "从.env.azure复制",
    "COSMOS_CONNECTION": "从.env.azure复制",
    "SPEECH_KEY": "从.env.azure复制",
    "SPEECH_REGION": "eastasia",
    "FUNCTION_URL": "https://你的函数应用.azurewebsites.net"
  }
}
EOF

# 2. 设置Function App的环境变量
source .env.azure

az functionapp config appsettings set \
  --name $FUNCTION_APP \
  --resource-group $RESOURCE_GROUP \
  --settings \
    "COMM_CONNECTION=$COMM_CONNECTION" \
    "COSMOS_CONNECTION=$COSMOS_CONNECTION" \
    "SPEECH_KEY=$SPEECH_KEY" \
    "SPEECH_REGION=$SPEECH_REGION"
```

### Step 5: 部署到Azure (3分钟)

```bash
# 1. 构建项目
npm run build

# 2. 部署Functions
func azure functionapp publish $FUNCTION_APP --typescript

# 3. 获取Function URL
FUNCTION_URL=$(az functionapp function show \
  --name $FUNCTION_APP \
  --resource-group $RESOURCE_GROUP \
  --function-name IncomingCall \
  --query invokeUrlTemplate \
  --output tsv)

echo "✅ Function已部署: $FUNCTION_URL"
```

### Step 6: 配置电话号码 (5分钟)

```bash
# 1. 获取Communication Services连接信息
source .env.azure

# 2. 购买电话号码（使用Azure Portal更简单）
echo "请访问 Azure Portal 购买电话号码："
echo "https://portal.azure.com/#create/Microsoft.CommunicationServices"
echo ""
echo "或使用CLI（需要选择可用号码）："

# 列出可用号码
az communication phonenumber list-available \
  --connection-string "$COMM_CONNECTION" \
  --country-code US \
  --phone-number-type TollFree \
  --assignment-type Application \
  --capabilities calling

# 3. 配置Webhook（在Azure Portal中设置）
echo "在Azure Portal中配置电话号码的Webhook URL："
echo "$FUNCTION_URL"
```

## 🎯 超简化版本：使用Azure Portal

如果觉得命令行太复杂，可以用Portal界面操作：

### 1. 创建资源组
- 登录 [Azure Portal](https://portal.azure.com)
- 点击 "创建资源" → 搜索 "Resource group"
- 名称：`ai-phone-rg`
- 区域：`East Asia`

### 2. 使用ARM模板一键部署

创建 `azuredeploy.json`:

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "appName": {
      "type": "string",
      "defaultValue": "[concat('ai-phone-', uniqueString(resourceGroup().id))]"
    }
  },
  "variables": {
    "functionAppName": "[parameters('appName')]",
    "storageAccountName": "[concat('storage', uniqueString(resourceGroup().id))]",
    "cosmosDbName": "[concat(parameters('appName'), '-cosmos')]",
    "commServiceName": "[concat(parameters('appName'), '-comm')]"
  },
  "resources": [
    {
      "type": "Microsoft.Storage/storageAccounts",
      "apiVersion": "2021-04-01",
      "name": "[variables('storageAccountName')]",
      "location": "[resourceGroup().location]",
      "sku": {
        "name": "Standard_LRS"
      },
      "kind": "StorageV2"
    },
    {
      "type": "Microsoft.Web/serverfarms",
      "apiVersion": "2021-02-01",
      "name": "[concat(parameters('appName'), '-plan')]",
      "location": "[resourceGroup().location]",
      "sku": {
        "name": "Y1",
        "tier": "Dynamic"
      }
    },
    {
      "type": "Microsoft.Web/sites",
      "apiVersion": "2021-02-01",
      "name": "[variables('functionAppName')]",
      "location": "[resourceGroup().location]",
      "kind": "functionapp",
      "dependsOn": [
        "[resourceId('Microsoft.Web/serverfarms', concat(parameters('appName'), '-plan'))]",
        "[resourceId('Microsoft.Storage/storageAccounts', variables('storageAccountName'))]"
      ],
      "properties": {
        "serverFarmId": "[resourceId('Microsoft.Web/serverfarms', concat(parameters('appName'), '-plan'))]",
        "siteConfig": {
          "appSettings": [
            {
              "name": "FUNCTIONS_WORKER_RUNTIME",
              "value": "node"
            },
            {
              "name": "WEBSITE_NODE_DEFAULT_VERSION",
              "value": "~18"
            },
            {
              "name": "FUNCTIONS_EXTENSION_VERSION",
              "value": "~4"
            },
            {
              "name": "AzureWebJobsStorage",
              "value": "[concat('DefaultEndpointsProtocol=https;AccountName=', variables('storageAccountName'), ';EndpointSuffix=core.windows.net;AccountKey=', listKeys(resourceId('Microsoft.Storage/storageAccounts', variables('storageAccountName')), '2021-04-01').keys[0].value)]"
            }
          ]
        }
      }
    }
  ],
  "outputs": {
    "functionAppName": {
      "type": "string",
      "value": "[variables('functionAppName')]"
    }
  }
}
```

部署命令：
```bash
# 使用ARM模板部署
az deployment group create \
  --resource-group ai-phone-rg \
  --template-file azuredeploy.json
```

## 🛠️ 故障排查

### 常见问题

1. **Function无法启动**
```bash
# 查看日志
func azure functionapp logstream $FUNCTION_APP
```

2. **电话无法接通**
```bash
# 检查Communication Services事件
az communication list-key \
  --name $COMM_SERVICE \
  --resource-group $RESOURCE_GROUP
```

3. **Speech服务报错**
```bash
# 验证Speech服务密钥
az cognitiveservices account keys list \
  --name $SPEECH_SERVICE \
  --resource-group $RESOURCE_GROUP
```

## 📱 测试你的系统

1. **获取测试号码**
```bash
echo "你的测试号码已配置在Communication Services中"
echo "拨打该号码测试AI应答"
```

2. **查看Function日志**
```bash
# 实时查看日志
func azure functionapp logstream $FUNCTION_APP --browser
```

3. **Portal监控**
- 访问 Azure Portal
- 进入 Function App → Functions → Monitor
- 查看实时执行情况

## ✅ 部署完成检查清单

- [ ] 资源组创建成功
- [ ] Function App运行正常
- [ ] Communication Services配置完成
- [ ] 获得电话号码
- [ ] Webhook URL配置正确
- [ ] 测试电话可以接通
- [ ] AI可以正常回复

---

**🎉 恭喜！你的AI电话助手已经部署完成！**

需要帮助？查看 [Azure Functions文档](https://docs.microsoft.com/azure/azure-functions/) 或联系支持。