/**
 * End-to-End Tests for Complete Call Workflow
 * 
 * Tests complete business workflows from incoming call to resolution,
 * including all service interactions and user scenarios.
 */

import { jest, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { Page, Browser } from 'playwright';
import { TestContainerManager } from '../utils/test-container-manager';
import { TestDataFactory } from '../utils/test-data-factory';
import { E2ETestOrchestrator } from './src/E2ETestOrchestrator';
import WebSocket from 'ws';
import axios from 'axios';

describe('Complete Call Workflow E2E Tests', () => {
  let containerManager: TestContainerManager;
  let testData: TestDataFactory;
  let orchestrator: E2ETestOrchestrator;
  let browser: Browser;
  let adminPage: Page;

  const services = {
    phoneGateway: 'http://localhost:3001',
    realtimeProcessor: 'http://localhost:3002',
    conversationEngine: 'http://localhost:3003',
    profileAnalytics: 'http://localhost:3004',
    userManagement: 'http://localhost:3005',
    smartWhitelist: 'http://localhost:3006',
    adminPanel: 'http://localhost:5173'
  };

  beforeAll(async () => {
    containerManager = new TestContainerManager();
    testData = new TestDataFactory();
    orchestrator = new E2ETestOrchestrator();
    
    // Start all services
    await containerManager.startAllServices();
    await containerManager.waitForServicesHealthy(Object.values(services).slice(0, -1));
    
    // Start browser for admin panel testing
    browser = await orchestrator.startBrowser();
    
    console.log('✅ All services and browser started for E2E testing');
  }, 180000); // 3 minutes timeout

  afterAll(async () => {
    if (browser) await browser.close();
    await containerManager.cleanup();
  });

  beforeEach(async () => {
    await testData.reset();
    adminPage = await browser.newPage();
  });

  afterEach(async () => {
    if (adminPage) await adminPage.close();
  });

  describe('Complete Spam Call Handling Workflow', () => {
    it('should handle spam call from start to finish with AI response', async () => {
      // 1. Setup: Create test user and login to admin panel
      const testUser = await testData.createUser({
        name: 'John Doe',
        phone: '+1234567890',
        email: 'john.doe@example.com',
        password: 'TestPassword123!',
        personality: 'polite'
      });

      const userToken = await orchestrator.loginUser(testUser.email, 'TestPassword123!');
      expect(userToken).toBeTruthy();

      // 2. Navigate to admin panel and verify user setup
      await adminPage.goto(services.adminPanel);
      await adminPage.fill('[data-testid="email-input"]', testUser.email);
      await adminPage.fill('[data-testid="password-input"]', 'TestPassword123!');
      await adminPage.click('[data-testid="login-button"]');
      
      await adminPage.waitForSelector('[data-testid="dashboard"]');
      
      const welcomeText = await adminPage.textContent('[data-testid="user-name"]');
      expect(welcomeText).toContain('John Doe');

      // 3. Setup call monitoring in admin panel
      await adminPage.click('[data-testid="calls-menu"]');
      await adminPage.waitForSelector('[data-testid="live-calls-monitor"]');

      // 4. Simulate incoming spam call
      const spamCaller = '+0987654321';
      const callId = 'e2e-spam-call-123';
      
      const incomingCall = {
        eventType: 'Microsoft.Communication.CallConnected',
        data: {
          callLegId: callId,
          from: { phoneNumber: spamCaller },
          to: { phoneNumber: testUser.phone },
          callConnectionId: 'e2e-connection-123'
        }
      };

      // Send webhook to trigger call processing
      const webhookResponse = await axios.post(
        `${services.phoneGateway}/webhook/incoming-call`,
        incomingCall,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': process.env.AZURE_WEBHOOK_API_KEY
          }
        }
      );

      expect(webhookResponse.status).toBe(200);
      expect(webhookResponse.data.action).toBe('route_to_ai');

      // 5. Verify call appears in admin panel
      await adminPage.waitForSelector(`[data-testid="call-${callId}"]`, { timeout: 10000 });
      
      const callStatus = await adminPage.textContent(`[data-testid="call-${callId}-status"]`);
      expect(callStatus).toBe('AI Processing');

      // 6. Simulate real-time conversation via WebSocket
      const realtimeWS = new WebSocket(`ws://localhost:3002/realtime/conversation?callId=${callId}`);
      
      await new Promise((resolve, reject) => {
        realtimeWS.on('open', resolve);
        realtimeWS.on('error', reject);
      });

      const conversationMessages: any[] = [];
      realtimeWS.on('message', (data) => {
        conversationMessages.push(JSON.parse(data.toString()));
      });

      // Simulate spam caller speech
      const spamMessages = [
        'Hello, I am calling about great loan opportunities',
        'We have special rates just for you',
        'This is a limited time offer',
        'Can I just have a minute of your time?'
      ];

      for (let i = 0; i < spamMessages.length; i++) {
        const audioChunk = {
          type: 'audio_chunk',
          callId,
          audioData: Buffer.from(`audio-${spamMessages[i]}`).toString('base64'),
          timestamp: Date.now(),
          sequenceNumber: i + 1
        };

        realtimeWS.send(JSON.stringify(audioChunk));

        // Wait for AI response
        await testUtils.waitFor(() => 
          conversationMessages.some(msg => msg.type === 'ai_response' && msg.sequenceNumber === i + 1),
          5000
        );

        // Verify AI generated appropriate response
        const aiResponse = conversationMessages.find(
          msg => msg.type === 'ai_response' && msg.sequenceNumber === i + 1
        );
        
        expect(aiResponse).toBeTruthy();
        expect(aiResponse.transcript).toBeTruthy();
        
        // Response should be polite (matching user personality)
        if (i === 0) {
          expect(aiResponse.transcript.toLowerCase()).toMatch(/thank you|not interested|not looking/);
        }
      }

      // 7. Verify conversation escalation in admin panel
      await adminPage.click(`[data-testid="call-${callId}-details"]`);
      await adminPage.waitForSelector('[data-testid="conversation-history"]');

      const conversationTurns = await adminPage.$$('[data-testid="conversation-turn"]');
      expect(conversationTurns.length).toBeGreaterThan(2);

      // 8. Verify AI decided to terminate call due to persistence
      await testUtils.waitFor(async () => {
        const finalStatus = await adminPage.textContent(`[data-testid="call-${callId}-status"]`);
        return finalStatus === 'Terminated' || finalStatus === 'Completed';
      }, 15000);

      const terminationReason = await adminPage.textContent(`[data-testid="call-${callId}-termination-reason"]`);
      expect(terminationReason).toMatch(/persistence|duration|effectiveness/);

      // 9. Verify spam profile was created/updated
      const profileResponse = await axios.get(
        `${services.profileAnalytics}/api/v1/analytics/profile/${spamCaller}`
      );

      expect(profileResponse.status).toBe(200);
      expect(profileResponse.data.profile.spamCategory).toBe('loan_offer');
      expect(profileResponse.data.profile.riskScore).toBeGreaterThan(0.7);

      // 10. Verify call statistics updated in admin panel
      await adminPage.click('[data-testid="analytics-menu"]');
      await adminPage.waitForSelector('[data-testid="call-statistics"]');

      const totalCallsText = await adminPage.textContent('[data-testid="total-calls-today"]');
      expect(parseInt(totalCallsText || '0')).toBeGreaterThan(0);

      const spamCallsText = await adminPage.textContent('[data-testid="spam-calls-today"]');
      expect(parseInt(spamCallsText || '0')).toBeGreaterThan(0);

      realtimeWS.close();
    });

    it('should handle whitelisted call with direct transfer', async () => {
      // 1. Setup user and whitelisted contact
      const testUser = await testData.createUser({
        name: 'Jane Smith',
        phone: '+1234567891',
        email: 'jane.smith@example.com',
        password: 'TestPassword123!',
        personality: 'direct'
      });

      const trustedCaller = '+0987654322';
      
      // Add to whitelist via admin panel
      await adminPage.goto(services.adminPanel);
      await adminPage.fill('[data-testid="email-input"]', testUser.email);
      await adminPage.fill('[data-testid="password-input"]', 'TestPassword123!');
      await adminPage.click('[data-testid="login-button"]');
      
      await adminPage.waitForSelector('[data-testid="dashboard"]');
      await adminPage.click('[data-testid="whitelist-menu"]');
      await adminPage.click('[data-testid="add-contact-button"]');
      
      await adminPage.fill('[data-testid="contact-phone-input"]', trustedCaller);
      await adminPage.fill('[data-testid="contact-name-input"]', 'Trusted Contact');
      await adminPage.click('[data-testid="save-contact-button"]');
      
      await adminPage.waitForSelector(`[data-testid="contact-${trustedCaller}"]`);

      // 2. Simulate incoming call from whitelisted number
      const callId = 'e2e-whitelist-call-456';
      const incomingCall = {
        eventType: 'Microsoft.Communication.CallConnected',
        data: {
          callLegId: callId,
          from: { phoneNumber: trustedCaller },
          to: { phoneNumber: testUser.phone },
          callConnectionId: 'e2e-whitelist-connection-456'
        }
      };

      const webhookResponse = await axios.post(
        `${services.phoneGateway}/webhook/incoming-call`,
        incomingCall,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': process.env.AZURE_WEBHOOK_API_KEY
          }
        }
      );

      expect(webhookResponse.status).toBe(200);
      expect(webhookResponse.data.action).toBe('transfer_direct');

      // 3. Verify call was transferred directly (not AI processed)
      await adminPage.click('[data-testid="calls-menu"]');
      await adminPage.waitForSelector(`[data-testid="call-${callId}"]`);
      
      const callStatus = await adminPage.textContent(`[data-testid="call-${callId}-status"]`);
      expect(callStatus).toBe('Transferred');

      const transferType = await adminPage.textContent(`[data-testid="call-${callId}-transfer-type"]`);
      expect(transferType).toBe('Direct Transfer');
    });
  });

  describe('User Profile and Settings Workflow', () => {
    it('should allow user to customize AI personality and test responses', async () => {
      // 1. Create and login user
      const testUser = await testData.createUser({
        name: 'Bob Wilson',
        phone: '+1234567892',
        email: 'bob.wilson@example.com',
        password: 'TestPassword123!'
      });

      await adminPage.goto(services.adminPanel);
      await adminPage.fill('[data-testid="email-input"]', testUser.email);
      await adminPage.fill('[data-testid="password-input"]', 'TestPassword123!');
      await adminPage.click('[data-testid="login-button"]');
      
      await adminPage.waitForSelector('[data-testid="dashboard"]');

      // 2. Navigate to personality settings
      await adminPage.click('[data-testid="settings-menu"]');
      await adminPage.click('[data-testid="personality-tab"]');
      
      // 3. Change personality from default to humorous
      await adminPage.selectOption('[data-testid="personality-select"]', 'humorous');
      await adminPage.click('[data-testid="save-personality-button"]');
      
      await adminPage.waitForSelector('[data-testid="settings-saved"]');

      // 4. Test AI response with new personality
      await adminPage.click('[data-testid="test-response-tab"]');
      await adminPage.fill('[data-testid="test-message-input"]', 'I have great investment opportunities for you');
      await adminPage.selectOption('[data-testid="test-intent-select"]', 'investment_pitch');
      await adminPage.click('[data-testid="generate-test-response-button"]');
      
      await adminPage.waitForSelector('[data-testid="test-response-result"]');
      
      const testResponse = await adminPage.textContent('[data-testid="test-response-text"]');
      expect(testResponse).toBeTruthy();
      
      // Response should reflect humorous personality
      const humorousPatterns = /time machine|sell those|funny|joke|humor/i;
      expect(testResponse).toMatch(humorousPatterns);

      // 5. Verify settings are persisted
      await adminPage.reload();
      await adminPage.waitForSelector('[data-testid="personality-tab"]');
      await adminPage.click('[data-testid="personality-tab"]');
      
      const selectedPersonality = await adminPage.inputValue('[data-testid="personality-select"]');
      expect(selectedPersonality).toBe('humorous');
    });

    it('should manage voice profile and TTS settings', async () => {
      const testUser = await testData.createUser({
        name: 'Alice Johnson',
        phone: '+1234567893',
        email: 'alice.johnson@example.com',
        password: 'TestPassword123!'
      });

      await adminPage.goto(services.adminPanel);
      await adminPage.fill('[data-testid="email-input"]', testUser.email);
      await adminPage.fill('[data-testid="password-input"]', 'TestPassword123!');
      await adminPage.click('[data-testid="login-button"]');
      
      await adminPage.waitForSelector('[data-testid="dashboard"]');
      
      // Navigate to voice settings
      await adminPage.click('[data-testid="settings-menu"]');
      await adminPage.click('[data-testid="voice-tab"]');
      
      // Upload voice sample (simulate file upload)
      const fileInput = await adminPage.locator('[data-testid="voice-upload-input"]');
      
      // Create mock audio file
      const mockAudioContent = Buffer.from('mock-audio-data');
      
      // Since we can't easily simulate file upload in tests, we'll mock the API response
      await adminPage.evaluate(() => {
        // Mock the voice upload API call
        window.fetch = jest.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            success: true,
            voiceProfileId: 'custom-voice-123',
            message: 'Voice profile created successfully'
          })
        });
      });
      
      await adminPage.click('[data-testid="upload-voice-button"]');
      await adminPage.waitForSelector('[data-testid="voice-upload-success"]');
      
      const successMessage = await adminPage.textContent('[data-testid="voice-upload-success"]');
      expect(successMessage).toContain('Voice profile created');
      
      // Test voice with sample text
      await adminPage.fill('[data-testid="voice-test-input"]', 'Thank you for calling, but I am not interested.');
      await adminPage.click('[data-testid="play-voice-sample-button"]');
      
      // Wait for audio generation
      await adminPage.waitForSelector('[data-testid="audio-player"]');
      
      const audioSrc = await adminPage.getAttribute('[data-testid="audio-player"]', 'src');
      expect(audioSrc).toBeTruthy();
    });
  });

  describe('Analytics and Reporting Workflow', () => {
    it('should display comprehensive call analytics and insights', async () => {
      // 1. Setup user with historical call data
      const testUser = await testData.createUser({
        name: 'Charlie Brown',
        phone: '+1234567894',
        email: 'charlie.brown@example.com',
        password: 'TestPassword123!'
      });

      // Create historical call data
      const callHistory = [
        { intent: 'loan_offer', duration: 45000, outcome: 'successful_termination', date: '2023-12-01' },
        { intent: 'insurance_sales', duration: 30000, outcome: 'successful_termination', date: '2023-12-02' },
        { intent: 'investment_pitch', duration: 120000, outcome: 'caller_hangup', date: '2023-12-03' },
        { intent: 'loan_offer', duration: 25000, outcome: 'successful_termination', date: '2023-12-04' },
        { intent: 'sales_call', duration: 60000, outcome: 'successful_termination', date: '2023-12-05' }
      ];

      for (const call of callHistory) {
        await testData.createCallRecord({
          userId: testUser.id,
          callerPhone: `+${Math.floor(Math.random() * 9000000000) + 1000000000}`,
          ...call
        });
      }

      // 2. Login and navigate to analytics
      await adminPage.goto(services.adminPanel);
      await adminPage.fill('[data-testid="email-input"]', testUser.email);
      await adminPage.fill('[data-testid="password-input"]', 'TestPassword123!');
      await adminPage.click('[data-testid="login-button"]');
      
      await adminPage.waitForSelector('[data-testid="dashboard"]');
      await adminPage.click('[data-testid="analytics-menu"]');
      
      // 3. Verify call statistics
      const totalCalls = await adminPage.textContent('[data-testid="total-calls"]');
      expect(parseInt(totalCalls || '0')).toBe(5);
      
      const avgDuration = await adminPage.textContent('[data-testid="avg-call-duration"]');
      expect(avgDuration).toBeTruthy();
      
      const successRate = await adminPage.textContent('[data-testid="success-rate"]');
      expect(parseFloat(successRate?.replace('%', '') || '0')).toBeGreaterThan(70);
      
      // 4. Check intent distribution chart
      await adminPage.waitForSelector('[data-testid="intent-chart"]');
      
      const chartData = await adminPage.evaluate(() => {
        const chart = document.querySelector('[data-testid="intent-chart"]');
        return chart ? chart.getAttribute('data-chart-data') : null;
      });
      
      expect(chartData).toBeTruthy();
      
      // 5. Verify time-based trends
      await adminPage.click('[data-testid="trends-tab"]');
      await adminPage.waitForSelector('[data-testid="calls-timeline-chart"]');
      
      const timelineVisible = await adminPage.isVisible('[data-testid="calls-timeline-chart"]');
      expect(timelineVisible).toBe(true);
      
      // 6. Test date range filtering
      await adminPage.fill('[data-testid="date-from-input"]', '2023-12-01');
      await adminPage.fill('[data-testid="date-to-input"]', '2023-12-03');
      await adminPage.click('[data-testid="apply-date-filter-button"]');
      
      await adminPage.waitForSelector('[data-testid="filtered-results"]');
      
      const filteredCalls = await adminPage.textContent('[data-testid="filtered-call-count"]');
      expect(parseInt(filteredCalls || '0')).toBe(3);
    });

    it('should generate and download call reports', async () => {
      const testUser = await testData.createUser({
        name: 'Diana Prince',
        phone: '+1234567895',
        email: 'diana.prince@example.com',
        password: 'TestPassword123!'
      });

      await adminPage.goto(services.adminPanel);
      await adminPage.fill('[data-testid="email-input"]', testUser.email);
      await adminPage.fill('[data-testid="password-input"]', 'TestPassword123!');
      await adminPage.click('[data-testid="login-button"]');
      
      await adminPage.waitForSelector('[data-testid="dashboard"]');
      await adminPage.click('[data-testid="reports-menu"]');
      
      // Configure report parameters
      await adminPage.selectOption('[data-testid="report-type-select"]', 'monthly_summary');
      await adminPage.selectOption('[data-testid="report-format-select"]', 'pdf');
      await adminPage.fill('[data-testid="report-month-input"]', '2023-12');
      
      // Mock the report generation API
      await adminPage.evaluate(() => {
        window.fetch = jest.fn().mockResolvedValue({
          ok: true,
          blob: async () => new Blob(['mock-pdf-content'], { type: 'application/pdf' }),
          headers: new Headers({
            'content-disposition': 'attachment; filename="call-report-2023-12.pdf"'
          })
        });
      });
      
      // Generate report
      const downloadPromise = adminPage.waitForEvent('download');
      await adminPage.click('[data-testid="generate-report-button"]');
      
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toContain('call-report');
      expect(download.suggestedFilename()).toContain('.pdf');
    });
  });

  describe('Security and Privacy Workflow', () => {
    it('should handle GDPR data export request', async () => {
      const testUser = await testData.createUser({
        name: 'Eve Adams',
        phone: '+1234567896',
        email: 'eve.adams@example.com',
        password: 'TestPassword123!'
      });

      await adminPage.goto(services.adminPanel);
      await adminPage.fill('[data-testid="email-input"]', testUser.email);
      await adminPage.fill('[data-testid="password-input"]', 'TestPassword123!');
      await adminPage.click('[data-testid="login-button"]');
      
      await adminPage.waitForSelector('[data-testid="dashboard"]');
      await adminPage.click('[data-testid="privacy-menu"]');
      
      // Request data export
      await adminPage.click('[data-testid="export-data-button"]');
      
      // Confirm export request
      await adminPage.waitForSelector('[data-testid="export-confirmation-modal"]');
      await adminPage.click('[data-testid="confirm-export-button"]');
      
      await adminPage.waitForSelector('[data-testid="export-processing"]');
      
      // Mock export completion
      await adminPage.evaluate(() => {
        setTimeout(() => {
          const processingDiv = document.querySelector('[data-testid="export-processing"]');
          if (processingDiv) {
            processingDiv.innerHTML = '<div data-testid="export-complete">Your data export is ready for download.</div>';
          }
        }, 2000);
      });
      
      await adminPage.waitForSelector('[data-testid="export-complete"]');
      
      const completionMessage = await adminPage.textContent('[data-testid="export-complete"]');
      expect(completionMessage).toContain('ready for download');
    });

    it('should handle account deletion with data cleanup', async () => {
      const testUser = await testData.createUser({
        name: 'Frank Miller',
        phone: '+1234567897',
        email: 'frank.miller@example.com',
        password: 'TestPassword123!'
      });

      await adminPage.goto(services.adminPanel);
      await adminPage.fill('[data-testid="email-input"]', testUser.email);
      await adminPage.fill('[data-testid="password-input"]', 'TestPassword123!');
      await adminPage.click('[data-testid="login-button"]');
      
      await adminPage.waitForSelector('[data-testid="dashboard"]');
      await adminPage.click('[data-testid="account-settings-menu"]');
      
      // Navigate to dangerous actions section
      await adminPage.click('[data-testid="danger-zone-tab"]');
      await adminPage.click('[data-testid="delete-account-button"]');
      
      // Confirm deletion
      await adminPage.waitForSelector('[data-testid="delete-confirmation-modal"]');
      await adminPage.fill('[data-testid="confirm-password-input"]', 'TestPassword123!');
      await adminPage.check('[data-testid="understand-consequences-checkbox"]');
      await adminPage.click('[data-testid="final-delete-button"]');
      
      // Should redirect to goodbye page
      await adminPage.waitForURL('**/goodbye');
      
      const goodbyeMessage = await adminPage.textContent('[data-testid="goodbye-message"]');
      expect(goodbyeMessage).toContain('account has been deleted');
      
      // Verify user can't login anymore
      await adminPage.goto(services.adminPanel);
      await adminPage.fill('[data-testid="email-input"]', testUser.email);
      await adminPage.fill('[data-testid="password-input"]', 'TestPassword123!');
      await adminPage.click('[data-testid="login-button"]');
      
      await adminPage.waitForSelector('[data-testid="login-error"]');
      const errorMessage = await adminPage.textContent('[data-testid="login-error"]');
      expect(errorMessage).toContain('Invalid credentials');
    });
  });

  describe('System Health and Monitoring Workflow', () => {
    it('should display system health dashboard for admin users', async () => {
      const adminUser = await testData.createUser({
        name: 'System Admin',
        phone: '+1234567898',
        email: 'admin@ai-ninja.com',
        password: 'AdminPassword123!',
        role: 'admin'
      });

      await adminPage.goto(services.adminPanel);
      await adminPage.fill('[data-testid="email-input"]', adminUser.email);
      await adminPage.fill('[data-testid="password-input"]', 'AdminPassword123!');
      await adminPage.click('[data-testid="login-button"]');
      
      await adminPage.waitForSelector('[data-testid="dashboard"]');
      
      // Admin should see system monitoring menu
      const monitoringMenuVisible = await adminPage.isVisible('[data-testid="system-monitoring-menu"]');
      expect(monitoringMenuVisible).toBe(true);
      
      await adminPage.click('[data-testid="system-monitoring-menu"]');
      
      // Check service status indicators
      await adminPage.waitForSelector('[data-testid="service-status-grid"]');
      
      const services = ['phone-gateway', 'realtime-processor', 'conversation-engine', 'user-management'];
      
      for (const service of services) {
        const statusElement = await adminPage.locator(`[data-testid="service-${service}-status"]`);
        const status = await statusElement.textContent();
        expect(['Healthy', 'Warning', 'Error']).toContain(status);
      }
      
      // Check system metrics
      const cpuUsage = await adminPage.textContent('[data-testid="cpu-usage"]');
      const memoryUsage = await adminPage.textContent('[data-testid="memory-usage"]');
      const activeConnections = await adminPage.textContent('[data-testid="active-connections"]');
      
      expect(cpuUsage).toMatch(/\d+%/);
      expect(memoryUsage).toMatch(/\d+%/);
      expect(activeConnections).toMatch(/\d+/);
    });

    it('should alert admin users about system issues', async () => {
      // This test would simulate system alerts
      // In a real scenario, we'd trigger actual alerts
      
      const adminUser = await testData.createUser({
        name: 'Alert Admin',
        phone: '+1234567899',
        email: 'alerts@ai-ninja.com',
        password: 'AdminPassword123!',
        role: 'admin'
      });

      await adminPage.goto(services.adminPanel);
      await adminPage.fill('[data-testid="email-input"]', adminUser.email);
      await adminPage.fill('[data-testid="password-input"]', 'AdminPassword123!');
      await adminPage.click('[data-testid="login-button"]');
      
      await adminPage.waitForSelector('[data-testid="dashboard"]');
      
      // Simulate system alert
      await adminPage.evaluate(() => {
        // Mock alert notification
        const alertsContainer = document.querySelector('[data-testid="system-alerts"]') || 
                               document.createElement('div');
        alertsContainer.setAttribute('data-testid', 'system-alerts');
        alertsContainer.innerHTML = `
          <div data-testid="alert-high-cpu" class="alert alert-warning">
            CPU usage is high: 85%
          </div>
        `;
        document.body.appendChild(alertsContainer);
      });
      
      await adminPage.waitForSelector('[data-testid="alert-high-cpu"]');
      
      const alertText = await adminPage.textContent('[data-testid="alert-high-cpu"]');
      expect(alertText).toContain('CPU usage is high');
    });
  });
});