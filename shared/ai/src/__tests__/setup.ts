import { Logger } from '../utils/Logger';

// 设置测试环境的日志级别
Logger.setLogLevel('error');

// 全局测试设置
beforeAll(() => {
  console.log('🚀 AI Performance Optimization Tests Starting...');
});

afterAll(() => {
  console.log('✅ AI Performance Optimization Tests Completed');
});

// 模拟Redis客户端
export const mockRedisClient = {
  get: jest.fn(),
  set: jest.fn(),
  setex: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  keys: jest.fn()
};

// 模拟数据库客户端
export const mockDbClient = {
  query: jest.fn(),
  execute: jest.fn(),
  close: jest.fn()
};

// 重置所有模拟
afterEach(() => {
  jest.clearAllMocks();
});