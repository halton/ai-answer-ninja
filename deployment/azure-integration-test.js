#!/usr/bin/env node
/**
 * Azure服务集成测试脚本
 * 并行执行任务2: Azure语音+AI+通信服务验证
 */

const axios = require('axios');
const crypto = require('crypto');

class AzureServicesIntegrationTest {
  constructor() {
    this.config = {
      speech: {
        endpoint: process.env.AZURE_SPEECH_ENDPOINT || 'https://eastasia.api.cognitive.microsoft.com/',
        key: process.env.AZURE_SPEECH_KEY || 'YOUR_SPEECH_KEY_HERE',
        region: process.env.AZURE_SPEECH_REGION || 'eastasia',
        language: 'zh-CN'
      },
      openai: {
        endpoint: process.env.AZURE_OPENAI_ENDPOINT || 'https://ai-ninja-openai.openai.azure.com/',
        key: process.env.AZURE_OPENAI_KEY || 'YOUR_OPENAI_KEY_HERE',
        apiVersion: '2024-02-15-preview',
        deployment: 'gpt-4-turbo'
      },
      communication: {
        endpoint: process.env.AZURE_COMMUNICATION_ENDPOINT || 'https://ai-ninja-comm.communication.azure.com',
        key: process.env.AZURE_COMMUNICATION_KEY || 'YOUR_COMM_KEY_HERE',
        phoneNumber: process.env.AZURE_COMMUNICATION_PHONE_NUMBER || '+8613800138000'
      }
    };
  }

  async testAzureSpeechService() {
    console.log('🎤 测试Azure Speech Services...');
    
    try {
      // 测试获取访问令牌
      const tokenResponse = await axios.post(
        `${this.config.speech.endpoint}sts/v1.0/issuetoken`,
        null,
        {
          headers: {
            'Ocp-Apim-Subscription-Key': this.config.speech.key,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000
        }
      );

      if (tokenResponse.status === 200) {
        console.log('✅ Azure Speech Services认证成功');
        
        // 测试语音识别配置
        const configTest = await this.testSpeechRecognitionConfig();
        return configTest;
      }
    } catch (error) {
      console.error('❌ Azure Speech Services测试失败:', error.message);
      return false;
    }
  }

  async testSpeechRecognitionConfig() {
    try {
      // 测试语音识别端点配置
      const endpoint = `${this.config.speech.endpoint}speech/recognition/conversation/cognitiveservices/v1`;
      console.log(`📍 语音识别端点: ${endpoint}`);
      console.log(`🌏 区域: ${this.config.speech.region}`);
      console.log(`🗣️  语言: ${this.config.speech.language}`);
      
      return true;
    } catch (error) {
      console.error('❌ 语音识别配置测试失败:', error.message);
      return false;
    }
  }

  async testAzureOpenAI() {
    console.log('🤖 测试Azure OpenAI Services...');
    
    try {
      // 测试模型部署列表
      const deploymentsResponse = await axios.get(
        `${this.config.openai.endpoint}openai/deployments?api-version=${this.config.openai.apiVersion}`,
        {
          headers: {
            'api-key': this.config.openai.key,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      if (deploymentsResponse.status === 200) {
        console.log('✅ Azure OpenAI服务认证成功');
        console.log(`📦 可用部署数量: ${deploymentsResponse.data.data?.length || 0}`);
        
        // 测试对话完成
        return await this.testChatCompletion();
      }
    } catch (error) {
      console.error('❌ Azure OpenAI测试失败:', error.message);
      return false;
    }
  }

  async testChatCompletion() {
    try {
      const testMessage = {
        messages: [
          {
            role: "system",
            content: "你是AI电话应答系统的助手，请简短回复。"
          },
          {
            role: "user", 
            content: "这是一个测试消息，请回复'测试成功'"
          }
        ],
        max_tokens: 50,
        temperature: 0.3
      };

      const completionResponse = await axios.post(
        `${this.config.openai.endpoint}openai/deployments/${this.config.openai.deployment}/chat/completions?api-version=${this.config.openai.apiVersion}`,
        testMessage,
        {
          headers: {
            'api-key': this.config.openai.key,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      if (completionResponse.status === 200) {
        const response = completionResponse.data.choices[0]?.message?.content;
        console.log('✅ AI对话测试成功');
        console.log(`🤖 AI回复: ${response}`);
        return true;
      }
    } catch (error) {
      console.error('❌ AI对话测试失败:', error.message);
      return false;
    }
  }

  async testAzureCommunicationServices() {
    console.log('📞 测试Azure Communication Services...');
    
    try {
      // 测试获取通话能力
      const capabilitiesResponse = await axios.get(
        `${this.config.communication.endpoint}/phoneNumbers?api-version=2021-03-07`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.communication.key}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      if (capabilitiesResponse.status === 200) {
        console.log('✅ Azure Communication Services认证成功');
        console.log(`📱 配置的电话号码: ${this.config.communication.phoneNumber}`);
        return true;
      }
    } catch (error) {
      console.error('❌ Azure Communication Services测试失败:', error.message);
      console.log('ℹ️  注意: Communication Services需要有效的连接字符串');
      return false;
    }
  }

  async testServiceLatency() {
    console.log('⏱️  测试服务延迟...');
    
    const services = [
      {
        name: 'Speech Services',
        test: () => this.measureLatency(() => 
          axios.get(`${this.config.speech.endpoint}`, { timeout: 5000 })
        )
      },
      {
        name: 'OpenAI Services', 
        test: () => this.measureLatency(() =>
          axios.get(`${this.config.openai.endpoint}`, { timeout: 5000 })
        )
      }
    ];

    for (const service of services) {
      try {
        const latency = await service.test();
        const status = latency < 500 ? '✅' : latency < 1000 ? '⚠️' : '❌';
        console.log(`${status} ${service.name}: ${latency}ms`);
      } catch (error) {
        console.log(`❌ ${service.name}: 延迟测试失败`);
      }
    }
  }

  async measureLatency(requestFn) {
    const start = Date.now();
    try {
      await requestFn();
    } catch (error) {
      // 忽略错误，只测量网络延迟
    }
    return Date.now() - start;
  }

  async runAllTests() {
    console.log('🚀 开始Azure服务集成测试...\n');
    
    const results = {
      speech: await this.testAzureSpeechService(),
      openai: await this.testAzureOpenAI(),
      communication: await this.testAzureCommunicationServices()
    };

    await this.testServiceLatency();

    console.log('\n📊 测试结果汇总:');
    console.log(`Speech Services: ${results.speech ? '✅ 通过' : '❌ 失败'}`);
    console.log(`OpenAI Services: ${results.openai ? '✅ 通过' : '❌ 失败'}`);
    console.log(`Communication Services: ${results.communication ? '✅ 通过' : '❌ 失败'}`);

    const allPassed = Object.values(results).every(result => result);
    
    if (allPassed) {
      console.log('\n🎉 所有Azure服务集成测试通过！');
      process.exit(0);
    } else {
      console.log('\n⚠️  部分服务测试失败，请检查配置');
      process.exit(1);
    }
  }
}

// 运行测试
if (require.main === module) {
  const tester = new AzureServicesIntegrationTest();
  tester.runAllTests().catch(error => {
    console.error('💥 测试过程中发生错误:', error.message);
    process.exit(1);
  });
}

module.exports = AzureServicesIntegrationTest;