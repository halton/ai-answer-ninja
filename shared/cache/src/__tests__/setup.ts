/**
 * 测试环境设置
 */

// 设置测试环境变量
process.env.NODE_ENV = 'test';
process.env.DEBUG = 'true';

// 全局测试超时
jest.setTimeout(30000);

// Mock Redis for testing
jest.mock('ioredis', () => {
  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    mget: jest.fn(),
    exists: jest.fn(),
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn(),
    flushdb: jest.fn(),
    info: jest.fn().mockResolvedValue('# Server\nredis_version:6.2.0'),
    pipeline: jest.fn().mockReturnValue({
      setex: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([])
    }),
    scan: jest.fn(),
    on: jest.fn(),
    removeListener: jest.fn(),
    disconnect: jest.fn()
  };

  return {
    __esModule: true,
    default: jest.fn(() => mockRedis),
    Cluster: jest.fn(() => mockRedis)
  };
});

// Cleanup after each test
afterEach(() => {
  jest.clearAllMocks();
});