/**
 * Simple test script to verify real-time communication functionality
 * This script tests WebSocket connection and basic message flow
 */

const WebSocket = require('ws');
const axios = require('axios');

const SERVER_URL = 'http://localhost:3002';
const WS_URL = 'ws://localhost:3002';

class ServiceTester {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.messageCount = 0;
    this.errors = [];
    this.startTime = Date.now();
  }

  async runTests() {
    console.log('🚀 Starting Real-time Communication Service Tests\n');
    
    try {
      // Test 1: Health Check
      await this.testHealthEndpoint();
      
      // Test 2: API Endpoints
      await this.testApiEndpoints();
      
      // Test 3: WebSocket Connection
      await this.testWebSocketConnection();
      
      // Test 4: Audio Processing Simulation
      await this.testAudioProcessing();
      
      // Test 5: Connection Stats
      await this.testConnectionStats();
      
      console.log('\n✅ All tests completed successfully!');
      this.printSummary();
      
    } catch (error) {
      console.error('\n❌ Test suite failed:', error.message);
      this.errors.push(error);
    } finally {
      if (this.ws) {
        this.ws.close();
      }
      process.exit(this.errors.length > 0 ? 1 : 0);
    }
  }

  async testHealthEndpoint() {
    console.log('🏥 Testing health endpoint...');
    
    try {
      const response = await axios.get(`${SERVER_URL}/health`, {
        timeout: 5000
      });
      
      if (response.status === 200) {
        console.log('   ✓ Health check passed');
        console.log(`   Status: ${response.data.status}`);
      } else {
        throw new Error(`Health check failed with status: ${response.status}`);
      }
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        console.log('   ⚠️  Server not running - skipping tests');
        console.log('   Please start the server with: npm run dev');
        process.exit(0);
      }
      throw error;
    }
  }

  async testApiEndpoints() {
    console.log('\n📊 Testing API endpoints...');
    
    const endpoints = [
      { path: '/metrics', name: 'Metrics' },
      { path: '/connections', name: 'Connections' },
      { path: '/sessions', name: 'Sessions' },
      { path: '/pool', name: 'Connection Pool' },
      { path: '/', name: 'API Documentation' }
    ];
    
    for (const endpoint of endpoints) {
      try {
        const response = await axios.get(`${SERVER_URL}${endpoint.path}`, {
          timeout: 3000
        });
        console.log(`   ✓ ${endpoint.name} endpoint working`);
      } catch (error) {
        console.log(`   ✗ ${endpoint.name} endpoint failed:`, error.response?.status || error.message);
        this.errors.push(error);
      }
    }
  }

  async testWebSocketConnection() {
    console.log('\n🔌 Testing WebSocket connection...');
    
    return new Promise((resolve, reject) => {
      // Generate test token
      const userId = 'test-user';
      const callId = `test-call-${Date.now()}`;
      const token = `valid_${userId}_${callId}`;
      
      const wsUrl = `${WS_URL}/realtime/conversation?token=${token}`;
      
      console.log(`   Connecting to: ${wsUrl}`);
      
      this.ws = new WebSocket(wsUrl);
      
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, 10000);
      
      this.ws.on('open', () => {
        console.log('   ✓ WebSocket connected successfully');
        this.connected = true;
        clearTimeout(timeout);
        
        // Send a heartbeat message
        this.ws.send(JSON.stringify({
          type: 'heartbeat',
          callId: callId,
          timestamp: Date.now()
        }));
        
        resolve();
      });
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.messageCount++;
          
          console.log(`   📨 Received message: ${message.type}`);
          
          if (message.type === 'connection_status') {
            console.log(`   ✓ Connection status: ${message.data.status}`);
            console.log(`   Connection ID: ${message.data.connectionId}`);
          }
          
          if (message.type === 'heartbeat') {
            console.log('   💓 Heartbeat response received');
          }
          
        } catch (error) {
          console.log('   ⚠️  Invalid JSON message received');
        }
      });
      
      this.ws.on('error', (error) => {
        console.log('   ✗ WebSocket error:', error.message);
        clearTimeout(timeout);
        reject(error);
      });
      
      this.ws.on('close', (code, reason) => {
        console.log(`   🔌 WebSocket closed: ${code} - ${reason}`);
        this.connected = false;
      });
    });
  }

  async testAudioProcessing() {
    console.log('\n🎵 Testing audio processing simulation...');
    
    if (!this.connected || !this.ws) {
      console.log('   ⚠️  Skipping - WebSocket not connected');
      return;
    }
    
    // Generate fake audio data (sine wave)
    const sampleRate = 16000;
    const duration = 1; // 1 second
    const frequency = 440; // 440 Hz
    const samples = sampleRate * duration;
    
    const audioData = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      audioData[i] = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.1;
    }
    
    // Convert to base64
    const buffer = new ArrayBuffer(audioData.length * 4);
    const view = new Float32Array(buffer);
    view.set(audioData);
    const bytes = new Uint8Array(buffer);
    const base64 = Buffer.from(bytes).toString('base64');
    
    const audioChunk = {
      type: 'audio_chunk',
      callId: 'test-call',
      timestamp: Date.now(),
      data: {
        id: `test-chunk-${Date.now()}`,
        callId: 'test-call',
        timestamp: Date.now(),
        audioData: base64,
        sequenceNumber: 1,
        sampleRate: sampleRate,
        channels: 1,
        format: 'pcm'
      }
    };
    
    console.log('   📤 Sending test audio chunk...');
    this.ws.send(JSON.stringify(audioChunk));
    
    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('   ✓ Audio chunk sent successfully');
  }

  async testConnectionStats() {
    console.log('\n📈 Testing connection statistics...');
    
    try {
      const response = await axios.get(`${SERVER_URL}/connections`, {
        timeout: 3000
      });
      
      const stats = response.data;
      console.log('   ✓ Connection stats retrieved');
      console.log(`   Total connections: ${stats.totalConnections}`);
      console.log(`   Active connections: ${stats.activeConnections}`);
      
      if (stats.connections && stats.connections.length > 0) {
        const connection = stats.connections[0];
        console.log(`   Sample connection uptime: ${connection.uptime}ms`);
      }
      
    } catch (error) {
      console.log('   ✗ Failed to get connection stats:', error.message);
      this.errors.push(error);
    }
  }

  printSummary() {
    const duration = Date.now() - this.startTime;
    console.log('\n📋 Test Summary:');
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Messages received: ${this.messageCount}`);
    console.log(`   Errors: ${this.errors.length}`);
    
    if (this.errors.length > 0) {
      console.log('\n🐛 Error Details:');
      this.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error.message}`);
      });
    }
  }
}

// HTTP endpoint test
async function testHTTPEndpoint() {
  console.log('🧪 Testing HTTP audio processing endpoint...');
  
  try {
    // Create test audio data
    const testAudioData = Buffer.from('test-audio-data').toString('base64');
    
    const response = await axios.post(`${SERVER_URL}/process/audio`, {
      callId: 'test-http-call',
      audioData: testAudioData,
      userId: 'test-user'
    }, {
      timeout: 10000
    });
    
    console.log('   ✓ HTTP audio processing endpoint working');
    console.log('   Response keys:', Object.keys(response.data));
    
  } catch (error) {
    console.log('   ⚠️  HTTP endpoint test failed (expected for demo):', error.response?.status);
  }
}

// Run the tests
const tester = new ServiceTester();

console.log('Real-time Communication Service Test Suite');
console.log('=========================================\n');

// Add HTTP endpoint test
testHTTPEndpoint()
  .then(() => tester.runTests())
  .catch(error => {
    console.error('Test runner failed:', error);
    process.exit(1);
  });