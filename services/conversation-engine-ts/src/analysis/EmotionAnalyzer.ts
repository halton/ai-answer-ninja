import { 
  EmotionalState,
  ConversationContext,
  SentimentAnalysisResult,
  ConversationEngineError
} from '@/types';
import { Logger, LogPerformance, LogErrors } from '@/utils/logger';
import { OpenAIClient, AzureKeyCredential } from '@azure/openai';
import config from '@/config';
import Sentiment from 'sentiment';

/**
 * 情感分析器 - 分析对话中的情感状态
 */
export class EmotionAnalyzer {
  private logger: Logger;
  private openaiClient: OpenAIClient;
  private sentimentAnalyzer: any;
  private emotionPatterns: Map<string, EmotionPattern>;

  constructor() {
    this.logger = new Logger('EmotionAnalyzer');
    this.openaiClient = new OpenAIClient(
      config.azure.endpoint,
      new AzureKeyCredential(config.azure.apiKey)
    );
    this.sentimentAnalyzer = new Sentiment();
    this.emotionPatterns = this.initializeEmotionPatterns();
  }

  /**
   * 分析文本的情感状态
   */
  @LogPerformance('emotion_analysis')
  @LogErrors()
  async analyzeEmotion(
    text: string,
    context?: ConversationContext
  ): Promise<EmotionalState> {
    try {
      this.logger.debug('Analyzing emotion', { 
        textLength: text.length,
        hasContext: !!context
      });

      // 并行执行多种情感分析方法
      const [sentimentResult, patternResult, contextualResult] = await Promise.all([
        this.analyzeSentiment(text),
        this.analyzeEmotionPatterns(text),
        context ? this.analyzeContextualEmotion(text, context) : null
      ]);

      // 融合分析结果
      const fusedEmotion = this.fuseEmotionResults(
        sentimentResult,
        patternResult,
        contextualResult
      );

      this.logger.business('emotion_analyzed', {
        text: text.substring(0, 100),
        primary: fusedEmotion.primary,
        intensity: fusedEmotion.intensity,
        valence: fusedEmotion.valence,
        confidence: fusedEmotion.confidence
      });

      return fusedEmotion;

    } catch (error) {
      this.logger.error('Emotion analysis failed', error, { 
        text: text.substring(0, 100) 
      });
      
      // 返回默认情感状态
      return {
        primary: 'neutral',
        intensity: 0.5,
        valence: 0.0,
        arousal: 0.5,
        confidence: 0.0
      };
    }
  }

  /**
   * 基础情感分析（使用sentiment库）
   */
  private async analyzeSentiment(text: string): Promise<SentimentAnalysisResult> {
    const result = this.sentimentAnalyzer.analyze(text);
    
    let sentiment: 'positive' | 'negative' | 'neutral';
    if (result.score > 0) {
      sentiment = 'positive';
    } else if (result.score < 0) {
      sentiment = 'negative';
    } else {
      sentiment = 'neutral';
    }

    // 归一化分数到 -1 到 1 范围
    const normalizedScore = Math.max(-1, Math.min(1, result.score / 5));
    
    return {
      sentiment,
      score: normalizedScore,
      magnitude: Math.abs(normalizedScore),
      emotions: {
        positive: sentiment === 'positive' ? Math.abs(normalizedScore) : 0,
        negative: sentiment === 'negative' ? Math.abs(normalizedScore) : 0,
        neutral: sentiment === 'neutral' ? 1 : 0
      },
      confidence: Math.min(Math.abs(normalizedScore) + 0.3, 1.0)
    };
  }

  /**
   * 基于模式的情感分析
   */
  private async analyzeEmotionPatterns(text: string): Promise<EmotionalState> {
    const normalizedText = text.toLowerCase();
    let bestMatch: EmotionalState = {
      primary: 'neutral',
      intensity: 0.5,
      valence: 0.0,
      arousal: 0.5,
      confidence: 0.0
    };

    let maxScore = 0;

    for (const [emotion, pattern] of this.emotionPatterns.entries()) {
      const score = this.calculatePatternScore(normalizedText, pattern);
      
      if (score > maxScore) {
        maxScore = score;
        bestMatch = {
          primary: emotion,
          intensity: Math.min(score * pattern.intensityMultiplier, 1.0),
          valence: pattern.valence,
          arousal: pattern.arousal,
          confidence: score
        };
      }
    }

    return bestMatch;
  }

  /**
   * 上下文情感分析
   */
  private async analyzeContextualEmotion(
    text: string,
    context: ConversationContext
  ): Promise<EmotionalState | null> {
    try {
      // 分析对话历史的情感趋势
      const emotionalHistory = this.getEmotionalHistory(context);
      
      // 检测情感升级
      const escalationDetected = this.detectEmotionalEscalation(emotionalHistory);
      
      if (escalationDetected) {
        return {
          primary: 'frustrated',
          secondary: 'impatient',
          intensity: 0.8,
          valence: -0.6,
          arousal: 0.8,
          confidence: 0.9
        };
      }

      // 检测对话疲劳
      if (context.turnCount > 6) {
        return {
          primary: 'tired',
          secondary: 'bored',
          intensity: 0.7,
          valence: -0.3,
          arousal: 0.3,
          confidence: 0.8
        };
      }

      return null;

    } catch (error) {
      this.logger.warn('Contextual emotion analysis failed', error);
      return null;
    }
  }

  /**
   * 融合多种情感分析结果
   */
  private fuseEmotionResults(
    sentimentResult: SentimentAnalysisResult,
    patternResult: EmotionalState,
    contextualResult: EmotionalState | null
  ): EmotionalState {
    const weights = {
      sentiment: 0.3,
      pattern: 0.5,
      contextual: 0.4
    };

    // 如果有上下文结果且置信度高，优先使用
    if (contextualResult && contextualResult.confidence > 0.8) {
      return {
        ...contextualResult,
        confidence: Math.min(contextualResult.confidence * 1.1, 1.0)
      };
    }

    // 否则融合情感和模式结果
    let primaryEmotion = patternResult.primary;
    let intensity = patternResult.intensity * weights.pattern;
    let valence = (sentimentResult.score * weights.sentiment + 
                   patternResult.valence * weights.pattern);
    let arousal = patternResult.arousal;
    let confidence = (sentimentResult.confidence * weights.sentiment + 
                     patternResult.confidence * weights.pattern);

    // 如果有上下文结果，加入权重
    if (contextualResult) {
      intensity += contextualResult.intensity * weights.contextual;
      valence += contextualResult.valence * weights.contextual;
      arousal = (arousal + contextualResult.arousal) / 2;
      confidence += contextualResult.confidence * weights.contextual;
      
      // 如果上下文情感更强烈，可能需要更新主要情感
      if (contextualResult.intensity > patternResult.intensity) {
        primaryEmotion = contextualResult.primary;
      }
    }

    // 归一化值
    intensity = Math.min(intensity, 1.0);
    valence = Math.max(-1.0, Math.min(1.0, valence));
    arousal = Math.max(0.0, Math.min(1.0, arousal));
    confidence = Math.min(confidence, 1.0);

    return {
      primary: primaryEmotion,
      secondary: this.determineSecondaryEmotion(primaryEmotion, valence, arousal),
      intensity,
      valence,
      arousal,
      confidence
    };
  }

  /**
   * 计算模式匹配分数
   */
  private calculatePatternScore(text: string, pattern: EmotionPattern): number {
    let score = 0;
    let matchCount = 0;

    // 检查关键词匹配
    for (const keyword of pattern.keywords) {
      if (text.includes(keyword.toLowerCase())) {
        score += pattern.keywordWeight;
        matchCount++;
      }
    }

    // 检查短语匹配
    for (const phrase of pattern.phrases) {
      if (text.includes(phrase.toLowerCase())) {
        score += pattern.phraseWeight;
        matchCount++;
      }
    }

    // 检查正则表达式匹配
    for (const regex of pattern.patterns) {
      if (regex.test(text)) {
        score += pattern.patternWeight;
        matchCount++;
      }
    }

    // 考虑匹配密度
    const density = matchCount / text.split(' ').length;
    score *= (1 + density);

    return Math.min(score, 1.0);
  }

  /**
   * 获取情感历史
   */
  private getEmotionalHistory(context: ConversationContext): string[] {
    return context.conversationHistory
      .filter(turn => turn.emotion)
      .map(turn => turn.emotion!)
      .slice(-5); // 最近5轮
  }

  /**
   * 检测情感升级
   */
  private detectEmotionalEscalation(emotionalHistory: string[]): boolean {
    if (emotionalHistory.length < 3) return false;

    const negativeEmotions = ['frustrated', 'angry', 'impatient', 'annoyed'];
    const recentNegativeCount = emotionalHistory
      .slice(-3)
      .filter(emotion => negativeEmotions.includes(emotion))
      .length;

    return recentNegativeCount >= 2;
  }

  /**
   * 确定次要情感
   */
  private determineSecondaryEmotion(
    primary: string, 
    valence: number, 
    arousal: number
  ): string | undefined {
    const secondaryMapping: Record<string, string[]> = {
      'frustrated': ['impatient', 'annoyed'],
      'angry': ['hostile', 'aggressive'],
      'sad': ['disappointed', 'melancholy'],
      'happy': ['excited', 'content'],
      'surprised': ['curious', 'confused'],
      'neutral': ['calm', 'indifferent']
    };

    const candidates = secondaryMapping[primary];
    if (!candidates) return undefined;

    // 基于valence和arousal选择次要情感
    if (arousal > 0.7) {
      return candidates.find(emotion => 
        ['impatient', 'excited', 'aggressive', 'curious'].includes(emotion)
      );
    } else {
      return candidates.find(emotion => 
        ['content', 'melancholy', 'calm', 'disappointed'].includes(emotion)
      );
    }
  }

  /**
   * 初始化情感模式
   */
  private initializeEmotionPatterns(): Map<string, EmotionPattern> {
    const patterns = new Map<string, EmotionPattern>();

    patterns.set('frustrated', {
      keywords: ['烦', '烦躁', '厌烦', '不耐烦', '受够了'],
      phrases: ['不要再说了', '听够了', '没完没了'],
      patterns: [/[!！]{2,}/g, /[?？]{2,}/g],
      keywordWeight: 0.3,
      phraseWeight: 0.5,
      patternWeight: 0.2,
      intensityMultiplier: 1.2,
      valence: -0.6,
      arousal: 0.8
    });

    patterns.set('angry', {
      keywords: ['生气', '愤怒', '气死了', '混蛋', '滚'],
      phrases: ['马上挂电话', '别再打了', '投诉你们'],
      patterns: [/[!！]{3,}/g],
      keywordWeight: 0.4,
      phraseWeight: 0.6,
      patternWeight: 0.3,
      intensityMultiplier: 1.5,
      valence: -0.8,
      arousal: 0.9
    });

    patterns.set('polite', {
      keywords: ['谢谢', '不好意思', '抱歉', '请', '麻烦'],
      phrases: ['谢谢你的来电', '不好意思打扰', '请理解'],
      patterns: [],
      keywordWeight: 0.2,
      phraseWeight: 0.4,
      patternWeight: 0.1,
      intensityMultiplier: 0.8,
      valence: 0.3,
      arousal: 0.3
    });

    patterns.set('confused', {
      keywords: ['什么', '不明白', '不懂', '搞不清楚', '怎么回事'],
      phrases: ['你在说什么', '听不懂', '什么意思'],
      patterns: [/[?？]+/g],
      keywordWeight: 0.3,
      phraseWeight: 0.4,
      patternWeight: 0.2,
      intensityMultiplier: 1.0,
      valence: -0.2,
      arousal: 0.6
    });

    patterns.set('interested', {
      keywords: ['有意思', '了解', '详细', '具体', '告诉我'],
      phrases: ['想了解', '听起来不错', '可以详细说说'],
      patterns: [],
      keywordWeight: 0.3,
      phraseWeight: 0.5,
      patternWeight: 0.1,
      intensityMultiplier: 1.0,
      valence: 0.5,
      arousal: 0.6
    });

    patterns.set('bored', {
      keywords: ['无聊', '没意思', '浪费时间', '不想听'],
      phrases: ['没什么意思', '浪费我时间', '不感兴趣'],
      patterns: [],
      keywordWeight: 0.3,
      phraseWeight: 0.4,
      patternWeight: 0.1,
      intensityMultiplier: 0.9,
      valence: -0.4,
      arousal: 0.2
    });

    return patterns;
  }

  /**
   * 使用 Azure OpenAI 进行深度情感分析（可选）
   */
  @LogPerformance('deep_emotion_analysis')
  private async deepEmotionAnalysis(text: string): Promise<EmotionalState | null> {
    try {
      if (!config.performance || text.length < 50) {
        return null; // 短文本不需要深度分析
      }

      const prompt = `
请分析以下文本的情感状态，返回JSON格式：

文本："${text}"

请识别：
1. 主要情感 (frustrated, angry, polite, confused, interested, bored, neutral)
2. 情感强度 (0.0-1.0)
3. 情感效价 (-1.0到1.0，负值表示消极，正值表示积极)
4. 唤醒度 (0.0-1.0，表示情感激活程度)

返回格式：
{
  "primary": "情感类型",
  "intensity": 0.8,
  "valence": -0.6,
  "arousal": 0.7,
  "confidence": 0.9
}
`;

      const response = await this.openaiClient.getChatCompletions(
        config.azure.deploymentName,
        [
          {
            role: 'system',
            content: '你是一个专业的情感分析专家。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        {
          maxTokens: 150,
          temperature: 0.1
        }
      );

      const result = response.choices[0]?.message?.content;
      if (!result) return null;

      const parsed = JSON.parse(result);
      return {
        primary: parsed.primary,
        intensity: parsed.intensity,
        valence: parsed.valence,
        arousal: parsed.arousal,
        confidence: parsed.confidence
      };

    } catch (error) {
      this.logger.warn('Deep emotion analysis failed', error);
      return null;
    }
  }
}

// 情感模式接口
interface EmotionPattern {
  keywords: string[];
  phrases: string[];
  patterns: RegExp[];
  keywordWeight: number;
  phraseWeight: number;
  patternWeight: number;
  intensityMultiplier: number;
  valence: number;
  arousal: number;
}