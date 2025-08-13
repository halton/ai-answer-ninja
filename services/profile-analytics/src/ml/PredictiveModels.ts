import { EventEmitter } from 'events';
import { Logger } from '../utils/Logger';
import { CacheManager } from '../utils/CacheManager';

export interface MLModelConfig {
  modelType: 'classification' | 'regression' | 'clustering' | 'time_series';
  algorithm: string;
  hyperparameters: Record<string, any>;
  trainingConfig: {
    batchSize: number;
    epochs: number;
    learningRate: number;
    validationSplit: number;
  };
}

export interface TrainingData {
  features: number[][];
  labels?: number[] | string[];
  timestamps?: Date[];
  metadata?: Record<string, any>[];
}

export interface PredictionResult {
  prediction: number | string | number[];
  confidence: number;
  probability?: number[];
  explanation?: string;
  modelUsed: string;
}

export interface ModelPerformanceMetrics {
  accuracy?: number;
  precision?: number;
  recall?: number;
  f1Score?: number;
  rmse?: number;
  mae?: number;
  r2Score?: number;
}

export interface FeatureImportance {
  feature: string;
  importance: number;
  impact: 'positive' | 'negative';
}

export class PredictiveModels extends EventEmitter {
  private logger: Logger;
  private cache: CacheManager;
  private models: Map<string, any>;
  private modelConfigs: Map<string, MLModelConfig>;
  private performanceMetrics: Map<string, ModelPerformanceMetrics>;

  constructor() {
    super();
    this.logger = new Logger('PredictiveModels');
    this.cache = new CacheManager();
    this.models = new Map();
    this.modelConfigs = new Map();
    this.performanceMetrics = new Map();
    
    this.initializeBuiltInModels();
  }

  /**
   * 初始化内置模型
   */
  private initializeBuiltInModels(): void {
    // 垃圾电话分类模型
    this.registerModel('spam_classifier', {
      modelType: 'classification',
      algorithm: 'random_forest',
      hyperparameters: {
        nEstimators: 100,
        maxDepth: 10,
        minSamplesSplit: 2
      },
      trainingConfig: {
        batchSize: 32,
        epochs: 100,
        learningRate: 0.001,
        validationSplit: 0.2
      }
    });

    // 用户行为预测模型
    this.registerModel('behavior_predictor', {
      modelType: 'regression',
      algorithm: 'neural_network',
      hyperparameters: {
        hiddenLayers: [128, 64, 32],
        activation: 'relu',
        dropout: 0.2
      },
      trainingConfig: {
        batchSize: 64,
        epochs: 50,
        learningRate: 0.001,
        validationSplit: 0.15
      }
    });

    // 异常检测模型
    this.registerModel('anomaly_detector', {
      modelType: 'clustering',
      algorithm: 'isolation_forest',
      hyperparameters: {
        nEstimators: 100,
        contamination: 0.1,
        maxSamples: 'auto'
      },
      trainingConfig: {
        batchSize: 128,
        epochs: 1,
        learningRate: 0.001,
        validationSplit: 0.0
      }
    });

    // 时间序列预测模型
    this.registerModel('time_series_forecaster', {
      modelType: 'time_series',
      algorithm: 'lstm',
      hyperparameters: {
        sequenceLength: 24,
        lstmUnits: 50,
        dropout: 0.2,
        recurrentDropout: 0.2
      },
      trainingConfig: {
        batchSize: 32,
        epochs: 100,
        learningRate: 0.001,
        validationSplit: 0.2
      }
    });
  }

  /**
   * 注册新模型
   */
  registerModel(modelName: string, config: MLModelConfig): void {
    this.modelConfigs.set(modelName, config);
    this.logger.info('Registered model', { modelName, config });
  }

  /**
   * 训练模型
   */
  async trainModel(
    modelName: string,
    trainingData: TrainingData,
    validationData?: TrainingData
  ): Promise<ModelPerformanceMetrics> {
    try {
      this.logger.info('Starting model training', { modelName });

      const config = this.modelConfigs.get(modelName);
      if (!config) {
        throw new Error(`Model ${modelName} not found`);
      }

      // 数据预处理
      const processedData = await this.preprocessData(trainingData, config);
      
      // 根据算法类型创建模型
      const model = await this.createModel(config);
      
      // 训练模型
      const trainedModel = await this.performTraining(model, processedData, config);
      
      // 验证模型
      const metrics = validationData 
        ? await this.validateModel(trainedModel, validationData, config)
        : await this.crossValidate(trainedModel, processedData, config);

      // 保存模型
      this.models.set(modelName, trainedModel);
      this.performanceMetrics.set(modelName, metrics);

      // 缓存模型
      await this.cacheModel(modelName, trainedModel);

      this.emit('modelTrained', {
        modelName,
        metrics,
        timestamp: new Date()
      });

      this.logger.info('Model training completed', { modelName, metrics });
      return metrics;

    } catch (error) {
      this.logger.error('Model training failed', { error, modelName });
      throw error;
    }
  }

  /**
   * 数据预处理
   */
  private async preprocessData(data: TrainingData, config: MLModelConfig): Promise<TrainingData> {
    const processedData: TrainingData = {
      features: [...data.features],
      labels: data.labels ? [...data.labels] : undefined,
      timestamps: data.timestamps ? [...data.timestamps] : undefined,
      metadata: data.metadata ? [...data.metadata] : undefined
    };

    // 特征标准化
    if (config.modelType === 'regression' || config.modelType === 'classification') {
      processedData.features = this.standardizeFeatures(processedData.features);
    }

    // 时间序列数据处理
    if (config.modelType === 'time_series') {
      processedData.features = this.createSequences(
        processedData.features,
        config.hyperparameters.sequenceLength || 10
      );
    }

    // 分类数据编码
    if (config.modelType === 'classification' && data.labels) {
      processedData.labels = this.encodeCategoricalLabels(data.labels as string[]);
    }

    return processedData;
  }

  /**
   * 特征标准化
   */
  private standardizeFeatures(features: number[][]): number[][] {
    if (features.length === 0) return features;

    const numFeatures = features[0].length;
    const means = new Array(numFeatures).fill(0);
    const stds = new Array(numFeatures).fill(0);

    // 计算均值
    for (let i = 0; i < features.length; i++) {
      for (let j = 0; j < numFeatures; j++) {
        means[j] += features[i][j];
      }
    }
    for (let j = 0; j < numFeatures; j++) {
      means[j] /= features.length;
    }

    // 计算标准差
    for (let i = 0; i < features.length; i++) {
      for (let j = 0; j < numFeatures; j++) {
        stds[j] += Math.pow(features[i][j] - means[j], 2);
      }
    }
    for (let j = 0; j < numFeatures; j++) {
      stds[j] = Math.sqrt(stds[j] / features.length);
    }

    // 标准化
    return features.map(row => 
      row.map((value, j) => stds[j] > 0 ? (value - means[j]) / stds[j] : 0)
    );
  }

  /**
   * 创建时间序列序列
   */
  private createSequences(data: number[][], sequenceLength: number): number[][] {
    const sequences: number[][] = [];
    
    for (let i = 0; i <= data.length - sequenceLength; i++) {
      const sequence = data.slice(i, i + sequenceLength).flat();
      sequences.push(sequence);
    }

    return sequences;
  }

  /**
   * 分类标签编码
   */
  private encodeCategoricalLabels(labels: string[]): number[] {
    const uniqueLabels = [...new Set(labels)];
    const labelMap = new Map(uniqueLabels.map((label, index) => [label, index]));
    
    return labels.map(label => labelMap.get(label) || 0);
  }

  /**
   * 创建模型
   */
  private async createModel(config: MLModelConfig): Promise<any> {
    switch (config.algorithm) {
      case 'random_forest':
        return this.createRandomForestModel(config);
      case 'neural_network':
        return this.createNeuralNetworkModel(config);
      case 'isolation_forest':
        return this.createIsolationForestModel(config);
      case 'lstm':
        return this.createLSTMModel(config);
      default:
        throw new Error(`Unsupported algorithm: ${config.algorithm}`);
    }
  }

  /**
   * 创建随机森林模型
   */
  private createRandomForestModel(config: MLModelConfig): any {
    return {
      type: 'random_forest',
      config: config.hyperparameters,
      trees: [],
      featureImportances: []
    };
  }

  /**
   * 创建神经网络模型
   */
  private createNeuralNetworkModel(config: MLModelConfig): any {
    const layers = config.hyperparameters.hiddenLayers || [64, 32];
    
    return {
      type: 'neural_network',
      config: config.hyperparameters,
      layers: layers.map(size => ({
        size,
        weights: [],
        biases: new Array(size).fill(0),
        activation: config.hyperparameters.activation || 'relu'
      })),
      optimizer: 'adam',
      compiled: false
    };
  }

  /**
   * 创建孤立森林模型
   */
  private createIsolationForestModel(config: MLModelConfig): any {
    return {
      type: 'isolation_forest',
      config: config.hyperparameters,
      trees: [],
      threshold: 0
    };
  }

  /**
   * 创建LSTM模型
   */
  private createLSTMModel(config: MLModelConfig): any {
    return {
      type: 'lstm',
      config: config.hyperparameters,
      layers: [],
      compiled: false
    };
  }

  /**
   * 执行训练
   */
  private async performTraining(model: any, data: TrainingData, config: MLModelConfig): Promise<any> {
    switch (model.type) {
      case 'random_forest':
        return this.trainRandomForest(model, data, config);
      case 'neural_network':
        return this.trainNeuralNetwork(model, data, config);
      case 'isolation_forest':
        return this.trainIsolationForest(model, data, config);
      case 'lstm':
        return this.trainLSTM(model, data, config);
      default:
        throw new Error(`Unsupported model type: ${model.type}`);
    }
  }

  /**
   * 训练随机森林
   */
  private async trainRandomForest(model: any, data: TrainingData, config: MLModelConfig): Promise<any> {
    const nEstimators = config.hyperparameters.nEstimators || 100;
    
    for (let i = 0; i < nEstimators; i++) {
      // 引导采样
      const bootstrapIndices = this.bootstrapSample(data.features.length);
      const bootstrapFeatures = bootstrapIndices.map(idx => data.features[idx]);
      const bootstrapLabels = data.labels ? bootstrapIndices.map(idx => data.labels![idx]) : undefined;

      // 构建决策树
      const tree = await this.buildDecisionTree(bootstrapFeatures, bootstrapLabels, config);
      model.trees.push(tree);
    }

    return model;
  }

  /**
   * 引导采样
   */
  private bootstrapSample(size: number): number[] {
    const indices: number[] = [];
    for (let i = 0; i < size; i++) {
      indices.push(Math.floor(Math.random() * size));
    }
    return indices;
  }

  /**
   * 构建决策树
   */
  private async buildDecisionTree(features: number[][], labels: any[] | undefined, config: MLModelConfig): Promise<any> {
    // 简化的决策树实现
    return {
      feature: 0,
      threshold: 0.5,
      left: null,
      right: null,
      prediction: labels ? this.getMostFrequentLabel(labels) : 0
    };
  }

  /**
   * 获取最频繁的标签
   */
  private getMostFrequentLabel(labels: any[]): any {
    const counts = new Map();
    for (const label of labels) {
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    
    let maxCount = 0;
    let mostFrequent = labels[0];
    for (const [label, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        mostFrequent = label;
      }
    }
    
    return mostFrequent;
  }

  /**
   * 训练神经网络
   */
  private async trainNeuralNetwork(model: any, data: TrainingData, config: MLModelConfig): Promise<any> {
    const epochs = config.trainingConfig.epochs;
    const learningRate = config.trainingConfig.learningRate;
    
    // 初始化权重
    this.initializeWeights(model, data.features[0].length);
    
    for (let epoch = 0; epoch < epochs; epoch++) {
      let totalLoss = 0;
      
      for (let i = 0; i < data.features.length; i++) {
        const output = this.forwardPass(model, data.features[i]);
        const loss = this.calculateLoss(output, data.labels![i]);
        totalLoss += loss;
        
        this.backwardPass(model, data.features[i], data.labels![i], learningRate);
      }
      
      if (epoch % 10 === 0) {
        this.logger.debug('Training progress', { epoch, loss: totalLoss / data.features.length });
      }
    }
    
    model.compiled = true;
    return model;
  }

  /**
   * 初始化权重
   */
  private initializeWeights(model: any, inputSize: number): void {
    let prevSize = inputSize;
    
    for (const layer of model.layers) {
      layer.weights = Array(layer.size).fill(0).map(() =>
        Array(prevSize).fill(0).map(() => (Math.random() - 0.5) * 2 / Math.sqrt(prevSize))
      );
      prevSize = layer.size;
    }
  }

  /**
   * 前向传播
   */
  private forwardPass(model: any, input: number[]): number[] {
    let currentInput = input;
    
    for (const layer of model.layers) {
      const output = new Array(layer.size);
      
      for (let i = 0; i < layer.size; i++) {
        let sum = layer.biases[i];
        for (let j = 0; j < currentInput.length; j++) {
          sum += currentInput[j] * layer.weights[i][j];
        }
        output[i] = this.activationFunction(sum, layer.activation);
      }
      
      currentInput = output;
    }
    
    return currentInput;
  }

  /**
   * 激活函数
   */
  private activationFunction(x: number, type: string): number {
    switch (type) {
      case 'relu':
        return Math.max(0, x);
      case 'sigmoid':
        return 1 / (1 + Math.exp(-x));
      case 'tanh':
        return Math.tanh(x);
      default:
        return x;
    }
  }

  /**
   * 计算损失
   */
  private calculateLoss(predicted: number[], actual: any): number {
    if (typeof actual === 'number') {
      // 回归损失 (MSE)
      return Math.pow(predicted[0] - actual, 2);
    } else {
      // 分类损失 (交叉熵)
      const target = new Array(predicted.length).fill(0);
      target[actual] = 1;
      
      let loss = 0;
      for (let i = 0; i < predicted.length; i++) {
        loss -= target[i] * Math.log(Math.max(predicted[i], 1e-15));
      }
      return loss;
    }
  }

  /**
   * 反向传播
   */
  private backwardPass(model: any, input: number[], target: any, learningRate: number): void {
    // 简化的反向传播实现
    // 实际应用中需要计算梯度并更新权重
  }

  /**
   * 训练孤立森林
   */
  private async trainIsolationForest(model: any, data: TrainingData, config: MLModelConfig): Promise<any> {
    const nEstimators = config.hyperparameters.nEstimators || 100;
    const maxSamples = Math.min(256, data.features.length);
    
    for (let i = 0; i < nEstimators; i++) {
      const sampleIndices = this.randomSample(data.features.length, maxSamples);
      const sampleFeatures = sampleIndices.map(idx => data.features[idx]);
      
      const tree = this.buildIsolationTree(sampleFeatures, 0, Math.ceil(Math.log2(maxSamples)));
      model.trees.push(tree);
    }
    
    return model;
  }

  /**
   * 随机采样
   */
  private randomSample(total: number, size: number): number[] {
    const indices = Array.from({ length: total }, (_, i) => i);
    const sample: number[] = [];
    
    for (let i = 0; i < Math.min(size, total); i++) {
      const randomIndex = Math.floor(Math.random() * indices.length);
      sample.push(indices.splice(randomIndex, 1)[0]);
    }
    
    return sample;
  }

  /**
   * 构建孤立树
   */
  private buildIsolationTree(data: number[][], depth: number, maxDepth: number): any {
    if (depth >= maxDepth || data.length <= 1) {
      return { size: data.length, depth };
    }
    
    const feature = Math.floor(Math.random() * data[0].length);
    const values = data.map(row => row[feature]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    
    if (min === max) {
      return { size: data.length, depth };
    }
    
    const splitValue = min + Math.random() * (max - min);
    const leftData = data.filter(row => row[feature] < splitValue);
    const rightData = data.filter(row => row[feature] >= splitValue);
    
    return {
      feature,
      splitValue,
      left: this.buildIsolationTree(leftData, depth + 1, maxDepth),
      right: this.buildIsolationTree(rightData, depth + 1, maxDepth)
    };
  }

  /**
   * 训练LSTM
   */
  private async trainLSTM(model: any, data: TrainingData, config: MLModelConfig): Promise<any> {
    // LSTM训练的简化实现
    // 实际应用中需要实现完整的LSTM单元
    model.compiled = true;
    return model;
  }

  /**
   * 模型验证
   */
  private async validateModel(
    model: any,
    validationData: TrainingData,
    config: MLModelConfig
  ): Promise<ModelPerformanceMetrics> {
    const predictions: any[] = [];
    
    for (const features of validationData.features) {
      const prediction = await this.predict(model, features);
      predictions.push(prediction.prediction);
    }
    
    return this.calculateMetrics(predictions, validationData.labels!, config.modelType);
  }

  /**
   * 交叉验证
   */
  private async crossValidate(
    model: any,
    data: TrainingData,
    config: MLModelConfig
  ): Promise<ModelPerformanceMetrics> {
    const folds = 5;
    const foldSize = Math.floor(data.features.length / folds);
    const metrics: ModelPerformanceMetrics[] = [];
    
    for (let i = 0; i < folds; i++) {
      const validationStart = i * foldSize;
      const validationEnd = (i + 1) * foldSize;
      
      const validationFeatures = data.features.slice(validationStart, validationEnd);
      const validationLabels = data.labels!.slice(validationStart, validationEnd);
      
      const trainFeatures = [
        ...data.features.slice(0, validationStart),
        ...data.features.slice(validationEnd)
      ];
      const trainLabels = [
        ...data.labels!.slice(0, validationStart),
        ...data.labels!.slice(validationEnd)
      ];
      
      // 临时训练模型
      const foldModel = await this.createModel(config);
      await this.performTraining(foldModel, { features: trainFeatures, labels: trainLabels }, config);
      
      // 验证
      const foldMetrics = await this.validateModel(
        foldModel,
        { features: validationFeatures, labels: validationLabels },
        config
      );
      
      metrics.push(foldMetrics);
    }
    
    // 平均指标
    return this.averageMetrics(metrics);
  }

  /**
   * 计算性能指标
   */
  private calculateMetrics(
    predictions: any[],
    actual: any[],
    modelType: string
  ): ModelPerformanceMetrics {
    const metrics: ModelPerformanceMetrics = {};
    
    if (modelType === 'classification') {
      // 分类指标
      const confusion = this.calculateConfusionMatrix(predictions, actual);
      metrics.accuracy = this.calculateAccuracy(confusion);
      metrics.precision = this.calculatePrecision(confusion);
      metrics.recall = this.calculateRecall(confusion);
      metrics.f1Score = this.calculateF1Score(metrics.precision!, metrics.recall!);
    } else if (modelType === 'regression') {
      // 回归指标
      metrics.rmse = this.calculateRMSE(predictions as number[], actual as number[]);
      metrics.mae = this.calculateMAE(predictions as number[], actual as number[]);
      metrics.r2Score = this.calculateR2Score(predictions as number[], actual as number[]);
    }
    
    return metrics;
  }

  /**
   * 计算混淆矩阵
   */
  private calculateConfusionMatrix(predictions: any[], actual: any[]): number[][] {
    const uniqueLabels = [...new Set([...predictions, ...actual])];
    const matrix = Array(uniqueLabels.length).fill(0).map(() => Array(uniqueLabels.length).fill(0));
    
    for (let i = 0; i < predictions.length; i++) {
      const predictedIdx = uniqueLabels.indexOf(predictions[i]);
      const actualIdx = uniqueLabels.indexOf(actual[i]);
      matrix[actualIdx][predictedIdx]++;
    }
    
    return matrix;
  }

  /**
   * 计算准确率
   */
  private calculateAccuracy(confusionMatrix: number[][]): number {
    let correct = 0;
    let total = 0;
    
    for (let i = 0; i < confusionMatrix.length; i++) {
      for (let j = 0; j < confusionMatrix[i].length; j++) {
        if (i === j) correct += confusionMatrix[i][j];
        total += confusionMatrix[i][j];
      }
    }
    
    return total > 0 ? correct / total : 0;
  }

  /**
   * 计算精确率
   */
  private calculatePrecision(confusionMatrix: number[][]): number {
    let precision = 0;
    let validClasses = 0;
    
    for (let i = 0; i < confusionMatrix.length; i++) {
      const truePositive = confusionMatrix[i][i];
      const falsePositive = confusionMatrix.reduce((sum, row) => sum + row[i], 0) - truePositive;
      
      if (truePositive + falsePositive > 0) {
        precision += truePositive / (truePositive + falsePositive);
        validClasses++;
      }
    }
    
    return validClasses > 0 ? precision / validClasses : 0;
  }

  /**
   * 计算召回率
   */
  private calculateRecall(confusionMatrix: number[][]): number {
    let recall = 0;
    let validClasses = 0;
    
    for (let i = 0; i < confusionMatrix.length; i++) {
      const truePositive = confusionMatrix[i][i];
      const falseNegative = confusionMatrix[i].reduce((sum, val) => sum + val, 0) - truePositive;
      
      if (truePositive + falseNegative > 0) {
        recall += truePositive / (truePositive + falseNegative);
        validClasses++;
      }
    }
    
    return validClasses > 0 ? recall / validClasses : 0;
  }

  /**
   * 计算F1分数
   */
  private calculateF1Score(precision: number, recall: number): number {
    return precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
  }

  /**
   * 计算RMSE
   */
  private calculateRMSE(predictions: number[], actual: number[]): number {
    const sumSquaredErrors = predictions.reduce((sum, pred, i) => 
      sum + Math.pow(pred - actual[i], 2), 0
    );
    return Math.sqrt(sumSquaredErrors / predictions.length);
  }

  /**
   * 计算MAE
   */
  private calculateMAE(predictions: number[], actual: number[]): number {
    const sumAbsoluteErrors = predictions.reduce((sum, pred, i) => 
      sum + Math.abs(pred - actual[i]), 0
    );
    return sumAbsoluteErrors / predictions.length;
  }

  /**
   * 计算R²分数
   */
  private calculateR2Score(predictions: number[], actual: number[]): number {
    const actualMean = actual.reduce((sum, val) => sum + val, 0) / actual.length;
    const totalSumSquares = actual.reduce((sum, val) => sum + Math.pow(val - actualMean, 2), 0);
    const residualSumSquares = predictions.reduce((sum, pred, i) => 
      sum + Math.pow(actual[i] - pred, 2), 0
    );
    
    return totalSumSquares > 0 ? 1 - (residualSumSquares / totalSumSquares) : 0;
  }

  /**
   * 平均指标
   */
  private averageMetrics(metrics: ModelPerformanceMetrics[]): ModelPerformanceMetrics {
    const averaged: ModelPerformanceMetrics = {};
    const keys = Object.keys(metrics[0]) as (keyof ModelPerformanceMetrics)[];
    
    for (const key of keys) {
      const values = metrics.map(m => m[key]).filter(v => v !== undefined) as number[];
      if (values.length > 0) {
        averaged[key] = values.reduce((sum, val) => sum + val, 0) / values.length;
      }
    }
    
    return averaged;
  }

  /**
   * 预测
   */
  async predict(model: any, features: number[]): Promise<PredictionResult> {
    try {
      let prediction: any;
      let confidence = 0;
      
      switch (model.type) {
        case 'random_forest':
          ({ prediction, confidence } = this.predictRandomForest(model, features));
          break;
        case 'neural_network':
          ({ prediction, confidence } = this.predictNeuralNetwork(model, features));
          break;
        case 'isolation_forest':
          ({ prediction, confidence } = this.predictIsolationForest(model, features));
          break;
        case 'lstm':
          ({ prediction, confidence } = this.predictLSTM(model, features));
          break;
        default:
          throw new Error(`Unsupported model type: ${model.type}`);
      }
      
      return {
        prediction,
        confidence,
        modelUsed: model.type
      };
    } catch (error) {
      this.logger.error('Prediction failed', { error, modelType: model.type });
      throw error;
    }
  }

  /**
   * 随机森林预测
   */
  private predictRandomForest(model: any, features: number[]): { prediction: any; confidence: number } {
    const predictions = model.trees.map((tree: any) => this.predictTree(tree, features));
    const votes = new Map();
    
    for (const pred of predictions) {
      votes.set(pred, (votes.get(pred) || 0) + 1);
    }
    
    let maxVotes = 0;
    let prediction = null;
    for (const [pred, count] of votes) {
      if (count > maxVotes) {
        maxVotes = count;
        prediction = pred;
      }
    }
    
    const confidence = maxVotes / predictions.length;
    return { prediction, confidence };
  }

  /**
   * 决策树预测
   */
  private predictTree(tree: any, features: number[]): any {
    if (tree.prediction !== undefined) {
      return tree.prediction;
    }
    
    if (features[tree.feature] < tree.threshold) {
      return tree.left ? this.predictTree(tree.left, features) : 0;
    } else {
      return tree.right ? this.predictTree(tree.right, features) : 0;
    }
  }

  /**
   * 神经网络预测
   */
  private predictNeuralNetwork(model: any, features: number[]): { prediction: any; confidence: number } {
    const output = this.forwardPass(model, features);
    
    if (output.length === 1) {
      // 回归
      return { prediction: output[0], confidence: 1.0 };
    } else {
      // 分类
      const maxIndex = output.indexOf(Math.max(...output));
      const confidence = output[maxIndex];
      return { prediction: maxIndex, confidence };
    }
  }

  /**
   * 孤立森林预测
   */
  private predictIsolationForest(model: any, features: number[]): { prediction: any; confidence: number } {
    const pathLengths = model.trees.map((tree: any) => this.getPathLength(tree, features, 0));
    const avgPathLength = pathLengths.reduce((sum: number, len: number) => sum + len, 0) / pathLengths.length;
    
    // 异常分数计算
    const c = this.averagePathLength(256); // 假设样本大小为256
    const anomalyScore = Math.pow(2, -avgPathLength / c);
    
    const isAnomaly = anomalyScore > 0.5;
    return { 
      prediction: isAnomaly ? 1 : 0, 
      confidence: Math.abs(anomalyScore - 0.5) * 2 
    };
  }

  /**
   * 获取路径长度
   */
  private getPathLength(tree: any, features: number[], depth: number): number {
    if (tree.size !== undefined) {
      return depth + this.averagePathLength(tree.size);
    }
    
    if (features[tree.feature] < tree.splitValue) {
      return this.getPathLength(tree.left, features, depth + 1);
    } else {
      return this.getPathLength(tree.right, features, depth + 1);
    }
  }

  /**
   * 平均路径长度
   */
  private averagePathLength(n: number): number {
    if (n <= 1) return 0;
    return 2 * (Math.log(n - 1) + 0.5772156649) - (2 * (n - 1) / n);
  }

  /**
   * LSTM预测
   */
  private predictLSTM(model: any, features: number[]): { prediction: any; confidence: number } {
    // LSTM预测的简化实现
    return { prediction: features[features.length - 1], confidence: 0.8 };
  }

  /**
   * 获取特征重要性
   */
  async getFeatureImportance(modelName: string, featureNames: string[]): Promise<FeatureImportance[]> {
    const model = this.models.get(modelName);
    if (!model) {
      throw new Error(`Model ${modelName} not found`);
    }

    const importances: FeatureImportance[] = [];

    if (model.type === 'random_forest') {
      // 计算随机森林的特征重要性
      const featureImportanceMap = new Map<number, number>();
      
      for (const tree of model.trees) {
        this.calculateTreeFeatureImportance(tree, featureImportanceMap);
      }

      for (let i = 0; i < featureNames.length; i++) {
        const importance = featureImportanceMap.get(i) || 0;
        importances.push({
          feature: featureNames[i],
          importance: importance / model.trees.length,
          impact: importance > 0 ? 'positive' : 'negative'
        });
      }
    }

    return importances.sort((a, b) => b.importance - a.importance);
  }

  /**
   * 计算决策树特征重要性
   */
  private calculateTreeFeatureImportance(tree: any, importanceMap: Map<number, number>): void {
    if (tree.feature !== undefined) {
      const current = importanceMap.get(tree.feature) || 0;
      importanceMap.set(tree.feature, current + 1);
      
      if (tree.left) this.calculateTreeFeatureImportance(tree.left, importanceMap);
      if (tree.right) this.calculateTreeFeatureImportance(tree.right, importanceMap);
    }
  }

  /**
   * 缓存模型
   */
  private async cacheModel(modelName: string, model: any): Promise<void> {
    const cacheKey = `model_${modelName}`;
    await this.cache.set(cacheKey, model, 86400); // 缓存24小时
  }

  /**
   * 加载缓存的模型
   */
  async loadModel(modelName: string): Promise<boolean> {
    try {
      const cacheKey = `model_${modelName}`;
      const cachedModel = await this.cache.get(cacheKey);
      
      if (cachedModel) {
        this.models.set(modelName, cachedModel);
        this.logger.info('Model loaded from cache', { modelName });
        return true;
      }
      
      return false;
    } catch (error) {
      this.logger.error('Failed to load model from cache', { error, modelName });
      return false;
    }
  }

  /**
   * 获取模型性能
   */
  getModelPerformance(modelName: string): ModelPerformanceMetrics | undefined {
    return this.performanceMetrics.get(modelName);
  }

  /**
   * 列出所有可用模型
   */
  listAvailableModels(): string[] {
    return Array.from(this.modelConfigs.keys());
  }

  /**
   * 删除模型
   */
  async deleteModel(modelName: string): Promise<void> {
    this.models.delete(modelName);
    this.modelConfigs.delete(modelName);
    this.performanceMetrics.delete(modelName);
    
    const cacheKey = `model_${modelName}`;
    await this.cache.delete(cacheKey);
    
    this.logger.info('Model deleted', { modelName });
  }
}

export default PredictiveModels;