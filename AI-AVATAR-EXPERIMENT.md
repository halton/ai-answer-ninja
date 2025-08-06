# AI语音替身实验平台

## 🎯 项目新定位
不是防骚扰，而是创建一个逼真的AI语音替身，通过与骚扰电话的真实对话来验证技术可行性。

## 核心功能设计

### 1. AI人格构建系统

#### 语音克隆 + 性格模拟
```javascript
class AIAvatar {
  constructor(userId) {
    this.voiceProfile = null;
    this.personalityTraits = {};
    this.speechPatterns = [];
    this.knowledgeBase = {};
  }
  
  // 训练你的AI替身
  async trainFromSamples(audioSamples, textTranscripts) {
    // 1. 语音特征提取
    this.voiceProfile = await this.extractVoiceFeatures(audioSamples);
    
    // 2. 说话风格学习
    this.speechPatterns = await this.analyzeSpeechPatterns(textTranscripts);
    
    // 3. 个性特征建模
    this.personalityTraits = await this.modelPersonality(textTranscripts);
    
    // 4. 知识库构建
    this.knowledgeBase = await this.buildKnowledge(textTranscripts);
  }
  
  // 生成个性化回复
  async generateResponse(input, context) {
    // 不只是回答问题，而是模仿你的思维方式
    const response = await this.gpt4.complete({
      messages: [
        {
          role: "system",
          content: `你正在扮演${this.userName}，请完全模仿他/她的：
          - 说话风格：${this.speechPatterns.style}
          - 常用词汇：${this.speechPatterns.vocabulary}
          - 语气语调：${this.speechPatterns.tone}
          - 思维方式：${this.personalityTraits.thinking}
          - 价值观：${this.personalityTraits.values}
          
          背景信息：
          ${this.knowledgeBase.background}
          
          注意：要表现得像真人，包括适当的犹豫、思考时间、口语化表达。`
        },
        {
          role: "user",
          content: input
        }
      ],
      temperature: 0.8 // 提高随机性，更像真人
    });
    
    // 添加真人特征
    return this.addHumanCharacteristics(response);
  }
  
  addHumanCharacteristics(text) {
    // 随机添加口语化元素
    const fillers = ['呃', '嗯', '这个', '那个', '怎么说呢'];
    const pauses = ['...', '，', '、'];
    
    // 20%概率添加填充词
    if (Math.random() < 0.2) {
      const filler = fillers[Math.floor(Math.random() * fillers.length)];
      text = filler + '，' + text;
    }
    
    // 模拟思考停顿
    if (Math.random() < 0.3) {
      const pausePos = Math.floor(text.length * Math.random());
      text = text.slice(0, pausePos) + '...' + text.slice(pausePos);
    }
    
    return text;
  }
}
```

### 2. 实时对话引擎

#### 自然对话流程管理
```javascript
class ConversationEngine {
  constructor(avatar) {
    this.avatar = avatar;
    this.state = new ConversationState();
    this.emotionTracker = new EmotionTracker();
  }
  
  async handleConversation(audioStream) {
    // 持续对话循环
    while (this.state.isActive) {
      // 1. 监听对方说话
      const { transcript, emotion, silence } = await this.listenAndAnalyze(audioStream);
      
      // 2. 更新对话状态
      this.state.update({
        lastInput: transcript,
        emotionalTone: emotion,
        silenceDuration: silence
      });
      
      // 3. 决策：是否该说话了
      if (this.shouldRespond()) {
        const response = await this.generateContextualResponse();
        await this.speak(response);
      }
      
      // 4. 处理对话节奏
      await this.manageConversationFlow();
    }
  }
  
  shouldRespond() {
    // 模拟真人对话节奏
    if (this.state.silenceDuration > 2000) return true; // 2秒沉默
    if (this.state.lastInput.endsWith('吗？')) return true; // 问题
    if (this.state.turnsWithoutResponse > 1) return true; // 避免太久不说话
    if (this.state.emotionalTone === 'impatient') return true; // 对方不耐烦
    
    return false;
  }
  
  async generateContextualResponse() {
    // 根据对话历史生成连贯回复
    const context = {
      history: this.state.conversationHistory,
      currentTopic: this.state.currentTopic,
      emotionalState: this.emotionTracker.getCurrentState(),
      personality: this.avatar.personalityTraits
    };
    
    return await this.avatar.generateResponse(
      this.state.lastInput,
      context
    );
  }
  
  async manageConversationFlow() {
    // 主动引导对话
    if (this.state.isStuck()) {
      await this.askClarifyingQuestion();
    }
    
    if (this.state.isTooLong()) {
      await this.politelyEndConversation();
    }
    
    if (this.state.detectsScam()) {
      await this.playDumb(); // 装傻，看骚扰者反应
    }
  }
}
```

### 3. 语音合成增强

#### 超逼真语音生成
```javascript
class EnhancedVoiceSynthesis {
  constructor(voiceProfile) {
    this.profile = voiceProfile;
    this.emotionController = new EmotionController();
  }
  
  async synthesize(text, emotion = 'neutral') {
    // 使用Azure Custom Neural Voice
    const ssml = this.buildSSML(text, emotion);
    
    // 添加个性化语音特征
    const personalizedSSML = this.addPersonalTraits(ssml);
    
    // 生成音频
    const audio = await this.azureTTS.synthesize(personalizedSSML);
    
    // 后处理：添加环境音
    return this.postProcess(audio);
  }
  
  buildSSML(text, emotion) {
    // 根据情绪调整语音参数
    const emotionParams = {
      'happy': { pitch: '+5%', rate: '1.1', volume: '+2dB' },
      'confused': { pitch: '-2%', rate: '0.9', volume: 'medium' },
      'thinking': { rate: '0.85', breaks: true },
      'surprised': { pitch: '+10%', rate: '1.2', emphasis: 'strong' }
    };
    
    const params = emotionParams[emotion] || {};
    
    return `
      <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis">
        <voice name="${this.profile.voiceName}">
          <prosody pitch="${params.pitch || '0%'}" 
                   rate="${params.rate || '1.0'}"
                   volume="${params.volume || 'medium'}">
            ${this.addBreaks(text, params.breaks)}
          </prosody>
        </voice>
      </speak>
    `;
  }
  
  addBreaks(text, shouldAddBreaks) {
    if (!shouldAddBreaks) return text;
    
    // 在适当位置添加停顿，模拟思考
    return text
      .replace(/，/g, '，<break time="200ms"/>')
      .replace(/\.\.\./g, '<break time="500ms"/>');
  }
  
  postProcess(audio) {
    // 添加背景噪音，更真实
    const backgroundNoise = this.generateRoomTone();
    
    // 偶尔添加呼吸声
    if (Math.random() < 0.1) {
      audio = this.addBreathingSound(audio);
    }
    
    // 模拟手机音质
    return this.simulatePhoneQuality(audio);
  }
}
```

### 4. 实验数据收集系统

#### 详细记录每次对话
```javascript
class ExperimentRecorder {
  constructor() {
    this.sessions = new Map();
  }
  
  async recordSession(callId, callData) {
    const session = {
      id: callId,
      startTime: new Date(),
      caller: callData.from,
      duration: 0,
      turns: [],
      analysis: {},
      recordings: {
        full: null,
        segments: []
      }
    };
    
    this.sessions.set(callId, session);
    
    // 实时记录对话轮次
    return {
      addTurn: (turn) => this.addTurn(callId, turn),
      addAnalysis: (analysis) => this.addAnalysis(callId, analysis),
      complete: () => this.completeSession(callId)
    };
  }
  
  addTurn(callId, turn) {
    const session = this.sessions.get(callId);
    session.turns.push({
      timestamp: new Date(),
      speaker: turn.speaker, // 'caller' or 'ai'
      text: turn.text,
      audio: turn.audioUrl,
      emotion: turn.emotion,
      confidence: turn.confidence,
      responseTime: turn.responseTime
    });
  }
  
  async completeSession(callId) {
    const session = this.sessions.get(callId);
    
    // 生成分析报告
    session.analysis = {
      // 对话质量指标
      naturalness: await this.analyzeNaturalness(session),
      coherence: await this.analyzeCoherence(session),
      believability: await this.analyzeBelievability(session),
      
      // AI表现指标
      responseAppropriate: this.calculateAppropriateness(session),
      averageResponseTime: this.calculateAvgResponseTime(session),
      emotionalAlignment: this.analyzeEmotionalAlignment(session),
      
      // 对话特征
      topicsCovered: this.extractTopics(session),
      conversationFlow: this.analyzeFlow(session),
      terminationReason: this.analyzeTermination(session)
    };
    
    // 保存到数据库
    await this.saveSession(session);
    
    return session;
  }
}
```

### 5. 实验控制面板

#### 实时监控和回放
```jsx
// 实验控制台界面
function ExperimentDashboard() {
  const [liveSessions, setLiveSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  
  return (
    <div className="experiment-dashboard">
      {/* 实时对话监控 */}
      <LiveConversationMonitor>
        {liveSessions.map(session => (
          <ConversationCard key={session.id}>
            <CallerInfo>{session.caller}</CallerInfo>
            <LiveTranscript>
              {session.currentTranscript}
            </LiveTranscript>
            <AIStatus>
              思考中: {session.aiThinking}
              情绪: {session.currentEmotion}
            </AIStatus>
          </ConversationCard>
        ))}
      </LiveConversationMonitor>
      
      {/* 历史对话回放 */}
      <ConversationPlayer session={selectedSession}>
        <AudioPlayer src={selectedSession?.recording} />
        <TranscriptViewer 
          turns={selectedSession?.turns}
          showAnalysis={true}
        />
        <AnalysisPanel>
          <MetricCard title="自然度" value={selectedSession?.analysis.naturalness} />
          <MetricCard title="可信度" value={selectedSession?.analysis.believability} />
          <MetricCard title="连贯性" value={selectedSession?.analysis.coherence} />
        </AnalysisPanel>
      </ConversationPlayer>
      
      {/* AI训练界面 */}
      <AITrainingPanel>
        <VoiceSampleUploader />
        <PersonalityConfigurator />
        <KnowledgeBaseEditor />
        <TestConversationSimulator />
      </AITrainingPanel>
    </div>
  );
}
```

## 技术架构（专注实验）

```yaml
核心服务:
  通话处理:
    - Azure Communication Services
    - 全程录音
    - 实时转录
    
  AI大脑:
    - GPT-4 (对话生成)
    - Claude (性格模拟)
    - Custom Neural Voice (语音克隆)
    
  实验平台:
    - 实时监控WebSocket
    - 对话回放系统
    - 数据分析引擎
    
特殊功能:
  - A/B测试不同AI性格
  - 情绪识别和响应
  - 主动对话引导
  - 失败恢复机制
```

## 实验指标设计

```javascript
class ExperimentMetrics {
  // 1. 真实性指标
  measureRealism() {
    return {
      // 对方是否识破是AI
      detectionRate: this.calculateDetectionRate(),
      
      // 平均对话时长（越长越真实）
      avgDuration: this.calculateAvgDuration(),
      
      // 对方主动挂断率
      callerHangupRate: this.calculateHangupRate(),
      
      // 自然对话轮次
      avgTurns: this.calculateAvgTurns()
    };
  }
  
  // 2. 对话质量指标
  measureQuality() {
    return {
      // 回复相关性
      relevance: this.scoreRelevance(),
      
      // 情感匹配度
      emotionalAlignment: this.scoreEmotionalAlignment(),
      
      // 话题连贯性
      topicCoherence: this.scoreCoherence(),
      
      // 个性一致性
      personalityConsistency: this.scorePersonality()
    };
  }
  
  // 3. 技术性能指标
  measurePerformance() {
    return {
      // 响应延迟
      responseLatency: this.measureLatency(),
      
      // 语音合成质量
      voiceQuality: this.assessVoiceQuality(),
      
      // 识别准确率
      recognitionAccuracy: this.measureSTTAccuracy()
    };
  }
}
```

## 创新实验场景

### 1. 图灵测试场景
```javascript
// 让骚扰者判断是否在和真人对话
async function turingTest() {
  // 在对话结束前询问
  await ai.say("对了，你觉得我是真人还是AI？");
  const response = await listen();
  
  // 记录结果
  recordTuringTestResult(response);
}
```

### 2. 情绪操控实验
```javascript
// 测试AI能否影响对方情绪
async function emotionManipulation() {
  // 逐步改变语气
  const emotions = ['neutral', 'friendly', 'confused', 'impatient'];
  
  for (const emotion of emotions) {
    await ai.speakWithEmotion(getResponse(), emotion);
    const callerEmotion = await detectCallerEmotion();
    recordEmotionalImpact(emotion, callerEmotion);
  }
}
```

### 3. 长对话持久性测试
```javascript
// 看AI能维持多长的自然对话
async function enduranceTest() {
  let turnCount = 0;
  
  while (callActive && turnCount < 100) {
    const response = await ai.generateContextualResponse();
    await speak(response);
    
    // 每10轮评估一次对话质量
    if (turnCount % 10 === 0) {
      const quality = await assessConversationQuality();
      if (quality < 0.5) break;
    }
    
    turnCount++;
  }
  
  recordEnduranceResult(turnCount);
}
```

## 为什么这个设计更适合你的目标？

1. **专注于AI替身的真实性**，而不是防骚扰
2. **完整的实验数据收集**，每个对话都是宝贵数据
3. **可以不断迭代改进**，让AI越来越像你
4. **有趣的实验场景**，探索AI对话的边界
5. **为未来应用铺路**，不只是处理骚扰电话

这样的设计是否更符合你的实验目标？