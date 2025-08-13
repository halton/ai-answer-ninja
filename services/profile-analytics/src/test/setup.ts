/**
 * Test setup and configuration
 */

// 设置测试环境变量
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'ERROR';
process.env.ENABLE_CACHING = 'false';
process.env.ENABLE_REALTIME = 'false';

// 配置测试超时
jest.setTimeout(30000);

// 全局测试设置
beforeAll(async () => {
  // 初始化测试数据库连接等
});

afterAll(async () => {
  // 清理测试资源
});

beforeEach(() => {
  // 每个测试前的设置
});

afterEach(() => {
  // 每个测试后的清理
});

// 模拟外部服务
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    on: jest.fn(),
  })),
}));

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({
    connect: jest.fn(),
    end: jest.fn(),
    query: jest.fn(),
  })),
}));

export {};