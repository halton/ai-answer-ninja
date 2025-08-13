import { EventEmitter } from 'events';
import { Logger } from '../utils/Logger';
import { CacheManager } from '../utils/CacheManager';

export interface TrendDataPoint {
  timestamp: Date;
  value: number;
  metadata?: Record<string, any>;
}

export interface TrendPattern {
  id: string;
  type: 'seasonal' | 'cyclic' | 'linear' | 'exponential' | 'anomaly';
  confidence: number;
  direction: 'increasing' | 'decreasing' | 'stable' | 'volatile';
  period?: number;
  amplitude?: number;
  forecast?: TrendDataPoint[];
}

export interface TrendAnalysisConfig {
  windowSize: number;
  seasonalityThreshold: number;
  anomalyThreshold: number;
  forecastHorizon: number;
  enableRealTimeAnalysis: boolean;
}

export interface AnalysisContext {
  userId: string;
  metric: string;
  timeRange: {
    start: Date;
    end: Date;
  };
  granularity: 'hour' | 'day' | 'week' | 'month';
}

export class TrendAnalyzer extends EventEmitter {
  private logger: Logger;
  private cache: CacheManager;
  private config: TrendAnalysisConfig;
  private activeAnalyses: Map<string, NodeJS.Timeout>;

  constructor(config: TrendAnalysisConfig) {
    super();
    this.logger = new Logger('TrendAnalyzer');
    this.cache = new CacheManager();
    this.config = config;
    this.activeAnalyses = new Map();
  }

  /**
   * 分析数据趋势并识别模式
   */
  async analyzeTrend(
    data: TrendDataPoint[],
    context: AnalysisContext
  ): Promise<TrendPattern[]> {
    try {
      this.logger.info('Starting trend analysis', { context });

      if (data.length < this.config.windowSize) {
        throw new Error('Insufficient data points for trend analysis');
      }

      const patterns: TrendPattern[] = [];

      // 基础趋势分析
      const linearTrend = await this.analyzeLinearTrend(data);
      if (linearTrend) patterns.push(linearTrend);

      // 季节性分析
      const seasonalPattern = await this.analyzeSeasonality(data);
      if (seasonalPattern) patterns.push(seasonalPattern);

      // 周期性分析
      const cyclicPattern = await this.analyzeCyclicPattern(data);
      if (cyclicPattern) patterns.push(cyclicPattern);

      // 异常检测
      const anomalies = await this.detectAnomalies(data);
      patterns.push(...anomalies);

      // 生成预测
      for (const pattern of patterns) {
        if (pattern.type !== 'anomaly') {
          pattern.forecast = await this.generateForecast(data, pattern);
        }
      }

      // 缓存结果
      await this.cacheAnalysisResult(context, patterns);

      this.emit('analysisCompleted', {
        context,
        patterns,
        timestamp: new Date()
      });

      return patterns;
    } catch (error) {
      this.logger.error('Trend analysis failed', { error, context });
      throw error;
    }
  }

  /**
   * 线性趋势分析
   */
  private async analyzeLinearTrend(data: TrendDataPoint[]): Promise<TrendPattern | null> {
    const n = data.length;
    const xValues = data.map((_, index) => index);
    const yValues = data.map(point => point.value);

    // 计算线性回归
    const sumX = xValues.reduce((sum, x) => sum + x, 0);
    const sumY = yValues.reduce((sum, y) => sum + y, 0);
    const sumXY = xValues.reduce((sum, x, i) => sum + x * yValues[i], 0);
    const sumXX = xValues.reduce((sum, x) => sum + x * x, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // 计算R²相关系数
    const meanY = sumY / n;
    const totalVariation = yValues.reduce((sum, y) => sum + Math.pow(y - meanY, 2), 0);
    const residualVariation = yValues.reduce((sum, y, i) => {
      const predicted = slope * i + intercept;
      return sum + Math.pow(y - predicted, 2);
    }, 0);

    const rSquared = 1 - (residualVariation / totalVariation);

    if (rSquared < 0.7) return null; // 线性相关性不够强

    return {
      id: `linear_${Date.now()}`,
      type: 'linear',
      confidence: rSquared,
      direction: slope > 0.1 ? 'increasing' : slope < -0.1 ? 'decreasing' : 'stable',
      amplitude: Math.abs(slope)
    };
  }

  /**
   * 季节性分析
   */
  private async analyzeSeasonality(data: TrendDataPoint[]): Promise<TrendPattern | null> {
    const periods = [24, 168, 720]; // 小时、周、月周期

    for (const period of periods) {
      if (data.length < period * 2) continue;

      const seasonalStrength = await this.calculateSeasonalStrength(data, period);
      
      if (seasonalStrength > this.config.seasonalityThreshold) {
        return {
          id: `seasonal_${period}_${Date.now()}`,
          type: 'seasonal',
          confidence: seasonalStrength,
          direction: 'cyclic',
          period,
          amplitude: await this.calculateSeasonalAmplitude(data, period)
        };
      }
    }

    return null;
  }

  /**
   * 计算季节性强度
   */
  private async calculateSeasonalStrength(data: TrendDataPoint[], period: number): Promise<number> {
    const seasons = Math.floor(data.length / period);
    if (seasons < 2) return 0;

    const seasonalMeans: number[] = new Array(period).fill(0);
    const seasonalCounts: number[] = new Array(period).fill(0);

    // 计算每个季节位置的平均值
    for (let i = 0; i < data.length; i++) {
      const seasonIndex = i % period;
      seasonalMeans[seasonIndex] += data[i].value;
      seasonalCounts[seasonIndex]++;
    }

    for (let i = 0; i < period; i++) {
      if (seasonalCounts[i] > 0) {
        seasonalMeans[i] /= seasonalCounts[i];
      }
    }

    // 计算季节性方差与总方差的比率
    const overallMean = data.reduce((sum, point) => sum + point.value, 0) / data.length;
    const totalVariance = data.reduce((sum, point) => sum + Math.pow(point.value - overallMean, 2), 0) / data.length;
    
    const seasonalVariance = seasonalMeans.reduce((sum, mean) => sum + Math.pow(mean - overallMean, 2), 0) / period;

    return Math.min(seasonalVariance / totalVariance, 1);
  }

  /**
   * 计算季节性振幅
   */
  private async calculateSeasonalAmplitude(data: TrendDataPoint[], period: number): Promise<number> {
    const seasonalValues: number[] = [];

    for (let i = 0; i < period; i++) {
      const values = data.filter((_, index) => index % period === i).map(point => point.value);
      if (values.length > 0) {
        seasonalValues.push(values.reduce((sum, val) => sum + val, 0) / values.length);
      }
    }

    const max = Math.max(...seasonalValues);
    const min = Math.min(...seasonalValues);

    return max - min;
  }

  /**
   * 周期性模式分析
   */
  private async analyzeCyclicPattern(data: TrendDataPoint[]): Promise<TrendPattern | null> {
    // 使用快速傅里叶变换检测周期性
    const values = data.map(point => point.value);
    const fftResult = await this.computeFFT(values);
    
    const dominantFrequency = this.findDominantFrequency(fftResult);
    
    if (dominantFrequency.strength > 0.6) {
      return {
        id: `cyclic_${dominantFrequency.period}_${Date.now()}`,
        type: 'cyclic',
        confidence: dominantFrequency.strength,
        direction: 'cyclic',
        period: dominantFrequency.period,
        amplitude: dominantFrequency.amplitude
      };
    }

    return null;
  }

  /**
   * 简化的FFT实现
   */
  private async computeFFT(values: number[]): Promise<{ frequency: number; magnitude: number }[]> {
    const n = values.length;
    const result: { frequency: number; magnitude: number }[] = [];

    for (let k = 0; k < n / 2; k++) {
      let realSum = 0;
      let imagSum = 0;

      for (let i = 0; i < n; i++) {
        const angle = -2 * Math.PI * k * i / n;
        realSum += values[i] * Math.cos(angle);
        imagSum += values[i] * Math.sin(angle);
      }

      const magnitude = Math.sqrt(realSum * realSum + imagSum * imagSum);
      result.push({
        frequency: k / n,
        magnitude
      });
    }

    return result;
  }

  /**
   * 查找主导频率
   */
  private findDominantFrequency(fftResult: { frequency: number; magnitude: number }[]): {
    period: number;
    strength: number;
    amplitude: number;
  } {
    let maxMagnitude = 0;
    let dominantFreq = 0;

    for (const { frequency, magnitude } of fftResult) {
      if (frequency > 0 && magnitude > maxMagnitude) {
        maxMagnitude = magnitude;
        dominantFreq = frequency;
      }
    }

    const totalMagnitude = fftResult.reduce((sum, item) => sum + item.magnitude, 0);
    const strength = maxMagnitude / totalMagnitude;
    
    return {
      period: dominantFreq > 0 ? Math.round(1 / dominantFreq) : 0,
      strength,
      amplitude: maxMagnitude
    };
  }

  /**
   * 异常检测
   */
  private async detectAnomalies(data: TrendDataPoint[]): Promise<TrendPattern[]> {
    const anomalies: TrendPattern[] = [];
    
    // 计算移动平均和标准差
    const windowSize = Math.min(24, Math.floor(data.length / 4));
    
    for (let i = windowSize; i < data.length; i++) {
      const window = data.slice(i - windowSize, i);
      const mean = window.reduce((sum, point) => sum + point.value, 0) / window.length;
      const stdDev = Math.sqrt(
        window.reduce((sum, point) => sum + Math.pow(point.value - mean, 2), 0) / window.length
      );

      const zScore = Math.abs((data[i].value - mean) / stdDev);
      
      if (zScore > this.config.anomalyThreshold) {
        anomalies.push({
          id: `anomaly_${i}_${Date.now()}`,
          type: 'anomaly',
          confidence: Math.min(zScore / this.config.anomalyThreshold, 1),
          direction: data[i].value > mean ? 'increasing' : 'decreasing',
          amplitude: Math.abs(data[i].value - mean)
        });
      }
    }

    return anomalies;
  }

  /**
   * 生成预测
   */
  private async generateForecast(
    data: TrendDataPoint[],
    pattern: TrendPattern
  ): Promise<TrendDataPoint[]> {
    const forecast: TrendDataPoint[] = [];
    const lastDataPoint = data[data.length - 1];
    
    for (let i = 1; i <= this.config.forecastHorizon; i++) {
      const timestamp = new Date(lastDataPoint.timestamp.getTime() + i * 3600000); // 1小时间隔
      let value: number;

      switch (pattern.type) {
        case 'linear':
          value = this.predictLinear(data, i);
          break;
        case 'seasonal':
          value = this.predictSeasonal(data, pattern, i);
          break;
        case 'cyclic':
          value = this.predictCyclic(data, pattern, i);
          break;
        default:
          value = lastDataPoint.value;
      }

      forecast.push({
        timestamp,
        value,
        metadata: { predicted: true, pattern: pattern.type }
      });
    }

    return forecast;
  }

  /**
   * 线性预测
   */
  private predictLinear(data: TrendDataPoint[], steps: number): number {
    const recentData = data.slice(-10); // 使用最近10个数据点
    const trend = (recentData[recentData.length - 1].value - recentData[0].value) / recentData.length;
    return data[data.length - 1].value + trend * steps;
  }

  /**
   * 季节性预测
   */
  private predictSeasonal(data: TrendDataPoint[], pattern: TrendPattern, steps: number): number {
    if (!pattern.period) return data[data.length - 1].value;

    const seasonIndex = (data.length + steps - 1) % pattern.period;
    const historicalValues = data
      .filter((_, index) => index % pattern.period === seasonIndex)
      .map(point => point.value);

    return historicalValues.reduce((sum, val) => sum + val, 0) / historicalValues.length;
  }

  /**
   * 周期性预测
   */
  private predictCyclic(data: TrendDataPoint[], pattern: TrendPattern, steps: number): number {
    if (!pattern.period || !pattern.amplitude) return data[data.length - 1].value;

    const phase = (steps * 2 * Math.PI) / pattern.period;
    const baseline = data.reduce((sum, point) => sum + point.value, 0) / data.length;
    
    return baseline + pattern.amplitude * Math.sin(phase);
  }

  /**
   * 实时趋势监控
   */
  async startRealtimeAnalysis(context: AnalysisContext, interval: number = 60000): Promise<void> {
    if (!this.config.enableRealTimeAnalysis) {
      throw new Error('Real-time analysis is disabled');
    }

    const analysisKey = `${context.userId}_${context.metric}`;
    
    if (this.activeAnalyses.has(analysisKey)) {
      this.stopRealtimeAnalysis(analysisKey);
    }

    const intervalId = setInterval(async () => {
      try {
        const data = await this.fetchLatestData(context);
        const patterns = await this.analyzeTrend(data, context);
        
        this.emit('realtimeUpdate', {
          context,
          patterns,
          timestamp: new Date()
        });
      } catch (error) {
        this.logger.error('Real-time analysis error', { error, context });
      }
    }, interval);

    this.activeAnalyses.set(analysisKey, intervalId);
    this.logger.info('Started real-time trend analysis', { context });
  }

  /**
   * 停止实时分析
   */
  stopRealtimeAnalysis(analysisKey: string): void {
    const intervalId = this.activeAnalyses.get(analysisKey);
    if (intervalId) {
      clearInterval(intervalId);
      this.activeAnalyses.delete(analysisKey);
      this.logger.info('Stopped real-time trend analysis', { analysisKey });
    }
  }

  /**
   * 获取最新数据
   */
  private async fetchLatestData(context: AnalysisContext): Promise<TrendDataPoint[]> {
    // 这里应该连接到实际的数据源
    // 暂时返回模拟数据
    const cacheKey = `trend_data_${context.userId}_${context.metric}`;
    return await this.cache.get(cacheKey) || [];
  }

  /**
   * 缓存分析结果
   */
  private async cacheAnalysisResult(context: AnalysisContext, patterns: TrendPattern[]): Promise<void> {
    const cacheKey = `trend_analysis_${context.userId}_${context.metric}`;
    await this.cache.set(cacheKey, patterns, 3600); // 缓存1小时
  }

  /**
   * 获取趋势摘要
   */
  async getTrendSummary(context: AnalysisContext): Promise<{
    overallTrend: string;
    patterns: TrendPattern[];
    insights: string[];
    riskLevel: 'low' | 'medium' | 'high';
  }> {
    const cacheKey = `trend_analysis_${context.userId}_${context.metric}`;
    const patterns: TrendPattern[] = await this.cache.get(cacheKey) || [];

    const insights: string[] = [];
    let riskLevel: 'low' | 'medium' | 'high' = 'low';

    // 分析模式并生成洞察
    const anomalyCount = patterns.filter(p => p.type === 'anomaly').length;
    if (anomalyCount > 3) {
      insights.push('检测到异常活动增加，建议关注');
      riskLevel = 'high';
    }

    const seasonalPattern = patterns.find(p => p.type === 'seasonal');
    if (seasonalPattern) {
      insights.push(`发现${seasonalPattern.period}小时的周期性模式`);
    }

    const linearTrend = patterns.find(p => p.type === 'linear');
    let overallTrend = 'stable';
    if (linearTrend) {
      overallTrend = linearTrend.direction;
      if (linearTrend.direction === 'increasing' && linearTrend.confidence > 0.8) {
        insights.push('数据呈现明显上升趋势');
      }
    }

    return {
      overallTrend,
      patterns,
      insights,
      riskLevel
    };
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    // 停止所有实时分析
    for (const [key] of this.activeAnalyses) {
      this.stopRealtimeAnalysis(key);
    }

    this.logger.info('TrendAnalyzer cleanup completed');
  }
}

export default TrendAnalyzer;