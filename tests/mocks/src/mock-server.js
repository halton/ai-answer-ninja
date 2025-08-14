const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.AZURE_MOCK_PORT || 4000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.raw({ type: 'audio/*' }));

console.log('🎭 Starting Azure Mock Services...');

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// Mock Azure Speech Services - STT
app.post('/speech/recognition/conversation/cognitiveservices/v1', (req, res) => {
    console.log('[Azure STT Mock] Processing speech recognition request');
    
    // Simulate processing delay
    setTimeout(() => {
        const mockResponses = [
            "Hello, I am calling about great loan opportunities",
            "We have special rates just for you", 
            "This is a limited time offer",
            "Can I just have a minute of your time?",
            "I understand you're not interested",
            "Thank you for your time"
        ];
        
        const response = mockResponses[Math.floor(Math.random() * mockResponses.length)];
        
        res.json({
            RecognitionStatus: "Success",
            DisplayText: response,
            Offset: 1000000,
            Duration: 5000000,
            NBest: [{
                Confidence: 0.9,
                Lexical: response.toLowerCase(),
                ITN: response,
                MaskedITN: response,
                Display: response
            }]
        });
    }, 200);
});

// Mock Azure Text-to-Speech
app.post('/speech/synthesize', (req, res) => {
    console.log('[Azure TTS Mock] Processing text-to-speech request');
    
    res.setHeader('Content-Type', 'audio/wav');
    
    // Return mock audio data (simple WAV header)
    const mockAudioData = Buffer.alloc(1024);
    mockAudioData.write('RIFF', 0);
    mockAudioData.writeUInt32LE(1016, 4);
    mockAudioData.write('WAVE', 8);
    mockAudioData.write('fmt ', 12);
    mockAudioData.writeUInt32LE(16, 16);
    mockAudioData.writeUInt16LE(1, 20);  // Audio format (PCM)
    mockAudioData.writeUInt16LE(1, 22);  // Number of channels
    mockAudioData.writeUInt32LE(22050, 24); // Sample rate
    
    res.send(mockAudioData);
});

// Mock Azure OpenAI
app.post('/openai/deployments/*/chat/completions', (req, res) => {
    console.log('[Azure OpenAI Mock] Processing chat completion request');
    
    const { messages } = req.body;
    const lastMessage = messages[messages.length - 1]?.content || '';
    
    // Generate contextual responses based on input
    let response = "我现在不方便，谢谢。";
    
    if (lastMessage.includes('loan') || lastMessage.includes('贷款')) {
        response = "我不需要贷款服务，谢谢。";
    } else if (lastMessage.includes('investment') || lastMessage.includes('投资')) {
        response = "我对投资不感兴趣。";
    } else if (lastMessage.includes('insurance') || lastMessage.includes('保险')) {
        response = "我已经有保险了。";
    } else if (lastMessage.includes('time') || lastMessage.includes('minute')) {
        response = "不好意思，我真的没有时间。";
    }
    
    setTimeout(() => {
        res.json({
            id: `chatcmpl-${uuidv4()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: "gpt-4",
            choices: [{
                index: 0,
                message: {
                    role: "assistant",
                    content: response
                },
                finish_reason: "stop"
            }],
            usage: {
                prompt_tokens: 50,
                completion_tokens: 20,
                total_tokens: 70
            }
        });
    }, 300);
});

// Mock Azure Communication Services
app.post('/calling/calls/:callId/answer', (req, res) => {
    console.log(`[Azure Communication Mock] Answering call ${req.params.callId}`);
    
    res.json({
        callConnectionId: `conn-${uuidv4()}`,
        callId: req.params.callId,
        state: "connected"
    });
});

app.post('/calling/calls/:callId/transfer', (req, res) => {
    console.log(`[Azure Communication Mock] Transferring call ${req.params.callId}`);
    
    res.json({
        operationContext: uuidv4(),
        resultInfo: {
            code: 200,
            subCode: 0,
            message: "Call transferred successfully"
        }
    });
});

app.post('/calling/calls/:callId/hangup', (req, res) => {
    console.log(`[Azure Communication Mock] Hanging up call ${req.params.callId}`);
    
    res.json({
        operationContext: uuidv4(),
        resultInfo: {
            code: 200,
            subCode: 0,
            message: "Call ended successfully"
        }
    });
});

// Mock webhook endpoint for phone gateway
app.post('/webhook/incoming-call', (req, res) => {
    console.log('[Azure Communication Mock] Received incoming call webhook');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    const { eventType, data } = req.body;
    
    if (eventType === 'Microsoft.Communication.CallConnected') {
        res.json({
            action: 'route_to_ai',
            callId: data.callLegId,
            message: 'Call routed to AI processing'
        });
    } else {
        res.json({
            action: 'acknowledge',
            message: 'Event received'
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        services: {
            speechToText: 'operational',
            textToSpeech: 'operational',
            openAI: 'operational',
            communication: 'operational'
        },
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Status endpoint for monitoring
app.get('/status', (req, res) => {
    res.json({
        service: 'Azure Services Mock',
        version: '1.0.0',
        environment: 'test',
        endpoints: {
            stt: 'POST /speech/recognition/conversation/cognitiveservices/v1',
            tts: 'POST /speech/synthesize',
            openai: 'POST /openai/deployments/*/chat/completions',
            communication: 'POST /calling/calls/:callId/*',
            webhook: 'POST /webhook/incoming-call'
        }
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({
        error: 'Internal Server Error',
        message: err.message
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Endpoint ${req.method} ${req.path} not found`,
        availableEndpoints: [
            'GET /health',
            'GET /status',
            'POST /speech/recognition/conversation/cognitiveservices/v1',
            'POST /speech/synthesize',
            'POST /openai/deployments/*/chat/completions',
            'POST /calling/calls/:callId/answer',
            'POST /calling/calls/:callId/transfer',
            'POST /calling/calls/:callId/hangup',
            'POST /webhook/incoming-call'
        ]
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🎭 Azure Mock Services running on port ${PORT}`);
    console.log('Available endpoints:');
    console.log('  - GET  /health (Health Check)');
    console.log('  - GET  /status (Service Status)');
    console.log('  - POST /speech/recognition/conversation/cognitiveservices/v1 (STT)');
    console.log('  - POST /speech/synthesize (TTS)');
    console.log('  - POST /openai/deployments/*/chat/completions (OpenAI)');
    console.log('  - POST /calling/calls/:callId/answer (Communication)');
    console.log('  - POST /calling/calls/:callId/transfer (Communication)');
    console.log('  - POST /calling/calls/:callId/hangup (Communication)');
    console.log('  - POST /webhook/incoming-call (Webhook)');
    console.log('');
    console.log('Ready for E2E testing! 🚀');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down gracefully...');
    process.exit(0);
});