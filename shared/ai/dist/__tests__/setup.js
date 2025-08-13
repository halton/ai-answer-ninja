"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mockDbClient = exports.mockRedisClient = void 0;
const Logger_1 = require("../utils/Logger");
// 设置测试环境的日志级别
Logger_1.Logger.setLogLevel('error');
// 全局测试设置
beforeAll(() => {
    console.log('🚀 AI Performance Optimization Tests Starting...');
});
afterAll(() => {
    console.log('✅ AI Performance Optimization Tests Completed');
});
// 模拟Redis客户端
exports.mockRedisClient = {
    get: jest.fn(),
    set: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    keys: jest.fn()
};
// 模拟数据库客户端
exports.mockDbClient = {
    query: jest.fn(),
    execute: jest.fn(),
    close: jest.fn()
};
// 重置所有模拟
afterEach(() => {
    jest.clearAllMocks();
});
//# sourceMappingURL=setup.js.map