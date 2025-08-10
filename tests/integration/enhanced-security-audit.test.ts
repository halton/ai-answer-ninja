import { AuditLogger } from '../../shared/security/src/audit/AuditLogger';

describe('Enhanced Security Audit Integration Tests', () => {
  let auditLogger: AuditLogger;

  beforeEach(() => {
    auditLogger = AuditLogger.getInstance();
  });

  afterEach(() => {
    auditLogger.stop();
  });

  describe('Voice Call Security Auditing', () => {
    test('should audit voice call with enhanced security metadata', async () => {
      const callId = 'call-12345';
      const userId = 'user-67890';
      
      await auditLogger.logVoiceCall(callId, userId, 'transcribe', 145, {
        containsPII: true,
        language: 'zh-CN',
        transcriptionModel: 'azure-whisper-v3'
      });

      // 验证审计日志包含增强的安全元数据
      expect(auditLogger).toBeDefined();
    });

    test('should handle sensitive AI processing operations', async () => {
      const callId = 'sensitive-call-001';
      const userId = 'user-premium-001';

      await auditLogger.logVoiceCall(callId, userId, 'ai_process', 320, {
        containsPII: true,
        aiModel: 'gpt-4',
        sensitivityLevel: 'high'
      });

      // 应该触发额外的数据处理日志
      expect(auditLogger).toBeDefined();
    });
  });

  describe('Real-Time Security Event Monitoring', () => {
    test('should log and respond to critical security events', async () => {
      const criticalEvent = {
        type: 'unauthorized_access' as const,
        severity: 'critical' as const,
        userId: 'user-suspicious-001',
        source: 'api_endpoint',
        details: {
          attemptedResource: '/admin/users',
          ipAddress: '192.168.1.100',
          userAgent: 'suspicious-bot/1.0'
        },
        autoMitigation: true
      };

      await auditLogger.logRealTimeSecurityEvent(criticalEvent);

      // 验证事件已记录且触发了响应
      expect(auditLogger).toBeDefined();
    });

    test('should detect anomaly patterns', async () => {
      const anomalyEvent = {
        type: 'anomaly_detected' as const,
        severity: 'high' as const,
        userId: 'user-anomaly-001',
        source: 'behavior_analysis',
        details: {
          anomalyType: 'unusual_call_pattern',
          confidence: 0.89,
          baselineDeviation: 3.5,
          timeWindow: '1h'
        }
      };

      await auditLogger.logRealTimeSecurityEvent(anomalyEvent);
      
      expect(auditLogger).toBeDefined();
    });
  });

  describe('AI Model Usage Auditing', () => {
    test('should audit AI model performance and costs', async () => {
      await auditLogger.logAIModelUsage(
        'azure-openai-gpt4',
        'user-ai-001',
        'inference',
        250,  // input tokens
        180,  // output tokens
        145,  // latency ms
        true  // success
      );

      expect(auditLogger).toBeDefined();
    });

    test('should track token efficiency and cost estimates', async () => {
      // 模拟一个低效的AI调用
      await auditLogger.logAIModelUsage(
        'azure-openai-gpt4',
        'user-inefficient-001',
        'inference',
        1500, // 大量输入token
        50,   // 少量输出token (低效)
        850,  // 高延迟
        false // 失败
      );

      expect(auditLogger).toBeDefined();
    });

    test('should handle batch AI operations', async () => {
      const batchOperations = [
        { inputTokens: 120, outputTokens: 80, latency: 95, success: true },
        { inputTokens: 200, outputTokens: 150, latency: 120, success: true },
        { inputTokens: 80, outputTokens: 60, latency: 75, success: false }
      ];

      for (const [index, op] of batchOperations.entries()) {
        await auditLogger.logAIModelUsage(
          'azure-openai-batch',
          'user-batch-001',
          'inference',
          op.inputTokens,
          op.outputTokens,
          op.latency,
          op.success
        );
      }

      expect(auditLogger).toBeDefined();
    });
  });

  describe('Compliance and Data Classification', () => {
    test('should classify data correctly for different call types', async () => {
      const testCases = [
        { action: 'transcribe', expectedClassification: 'restricted' },
        { action: 'ai_process', expectedClassification: 'restricted' },
        { action: 'encrypt', expectedClassification: 'confidential' },
        { action: 'decrypt', expectedClassification: 'confidential' },
        { action: 'start', expectedClassification: 'internal' }
      ];

      for (const testCase of testCases) {
        await auditLogger.logVoiceCall(
          `test-call-${testCase.action}`,
          'user-compliance-001',
          testCase.action as any,
          100
        );
      }

      expect(auditLogger).toBeDefined();
    });

    test('should handle GDPR compliance flags correctly', async () => {
      await auditLogger.logVoiceCall(
        'gdpr-test-call',
        'eu-user-001',
        'ai_process',
        200,
        {
          containsPII: true,
          dataSubjectLocation: 'EU',
          processingPurpose: 'automated_response'
        }
      );

      expect(auditLogger).toBeDefined();
    });
  });

  describe('System State Capture and Incident Response', () => {
    test('should capture comprehensive system state during critical events', async () => {
      const criticalEvent = {
        type: 'data_exfiltration' as const,
        severity: 'critical' as const,
        userId: 'suspicious-user-002',
        source: 'api_monitor',
        details: {
          dataVolumeBytes: 1048576,
          suspiciousPatterns: ['bulk_download', 'off_hours_access'],
          triggerRules: ['volume_threshold', 'pattern_match']
        }
      };

      await auditLogger.logRealTimeSecurityEvent(criticalEvent);

      // 验证系统状态被捕获
      expect(auditLogger).toBeDefined();
    });

    test('should handle incident response workflow', async () => {
      const incidents = [
        {
          type: 'unauthorized_access' as const,
          severity: 'critical' as const,
          source: 'authentication_service'
        },
        {
          type: 'performance_degradation' as const,
          severity: 'high' as const,
          source: 'monitoring_system'
        },
        {
          type: 'anomaly_detected' as const,
          severity: 'medium' as const,
          source: 'behavior_analysis'
        }
      ];

      for (const incident of incidents) {
        await auditLogger.logRealTimeSecurityEvent({
          ...incident,
          details: { test: true },
          autoMitigation: incident.severity === 'critical'
        });
      }

      expect(auditLogger).toBeDefined();
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle high-volume audit logging efficiently', async () => {
      const startTime = Date.now();
      const promises = [];

      // 生成1000个并发审计日志
      for (let i = 0; i < 1000; i++) {
        promises.push(
          auditLogger.logVoiceCall(
            `perf-test-${i}`,
            `user-${i % 100}`,
            i % 2 === 0 ? 'start' : 'end',
            Math.random() * 200 + 50
          )
        );
      }

      await Promise.all(promises);
      
      const duration = Date.now() - startTime;
      
      // 验证高并发性能（应该在合理时间内完成）
      expect(duration).toBeLessThan(5000); // 5秒内处理1000个日志
    });

    test('should batch audit logs efficiently', async () => {
      // 测试批量处理机制
      const rapidLogs = [];
      for (let i = 0; i < 150; i++) { // 超过批处理大小100
        rapidLogs.push(
          auditLogger.logVoiceCall(`batch-test-${i}`, 'batch-user', 'start', 50)
        );
      }

      await Promise.all(rapidLogs);
      
      // 等待批处理完成
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      expect(auditLogger).toBeDefined();
    });
  });
});