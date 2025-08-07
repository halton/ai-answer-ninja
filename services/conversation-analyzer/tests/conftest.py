"""Test configuration and fixtures."""

import asyncio
import pytest
import pytest_asyncio
from typing import AsyncGenerator
from uuid import uuid4

from httpx import AsyncClient
from fastapi.testclient import TestClient

from app.main import app
from app.core.database import db_manager
from app.core.cache import cache_manager


@pytest.fixture(scope="session")
def event_loop():
    """Create an event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture
async def async_client() -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client."""
    async with AsyncClient(app=app, base_url="http://test") as client:
        yield client


@pytest.fixture
def test_client() -> TestClient:
    """Create a test client."""
    return TestClient(app)


@pytest_asyncio.fixture
async def test_db():
    """Setup test database."""
    # This would typically set up a test database
    # For now, we'll use a mock or skip database tests
    yield None


@pytest.fixture
def sample_call_id() -> str:
    """Generate sample call ID."""
    return str(uuid4())


@pytest.fixture
def sample_user_id() -> str:
    """Generate sample user ID."""
    return str(uuid4())


@pytest.fixture
def sample_conversation_data():
    """Sample conversation data for testing."""
    return [
        {
            "id": str(uuid4()),
            "call_record_id": str(uuid4()),
            "sequence_number": 1,
            "speaker": "caller",
            "message_text": "你好，我想了解一下你们的理财产品",
            "timestamp": "2024-01-01T10:00:00Z",
            "confidence_score": 0.95,
            "intent_category": "investment_pitch",
            "emotion": "neutral"
        },
        {
            "id": str(uuid4()),
            "call_record_id": str(uuid4()),
            "sequence_number": 2,
            "speaker": "ai",
            "message_text": "谢谢您的来电，我现在不需要理财产品",
            "timestamp": "2024-01-01T10:00:05Z",
            "confidence_score": 0.98,
            "intent_category": None,
            "emotion": "polite"
        },
        {
            "id": str(uuid4()),
            "call_record_id": str(uuid4()),
            "sequence_number": 3,
            "speaker": "caller",
            "message_text": "我们的收益很高，您可以考虑一下",
            "timestamp": "2024-01-01T10:00:10Z",
            "confidence_score": 0.92,
            "intent_category": "investment_pitch",
            "emotion": "persuasive"
        }
    ]


@pytest.fixture
def sample_transcription_data():
    """Sample transcription data."""
    return {
        "call_id": str(uuid4()),
        "full_transcript": "你好，我想了解一下你们的理财产品。谢谢您的来电，我现在不需要理财产品。",
        "segments": [
            {
                "start_time": 0.0,
                "end_time": 3.5,
                "text": "你好，我想了解一下你们的理财产品",
                "confidence": 0.95,
                "speaker": "caller"
            },
            {
                "start_time": 4.0,
                "end_time": 8.0,
                "text": "谢谢您的来电，我现在不需要理财产品",
                "confidence": 0.98,
                "speaker": "ai"
            }
        ],
        "language": "zh-CN",
        "confidence_score": 0.96,
        "processing_time_ms": 1250,
        "audio_duration_seconds": 8.0,
        "word_count": 20
    }


@pytest.fixture
def sample_analysis_request():
    """Sample analysis request."""
    return {
        "call_id": str(uuid4()),
        "text": "你好，我想了解一下你们的理财产品。我们的收益很高，年化收益可以达到15%。",
        "language": "zh-CN",
        "analysis_types": ["sentiment", "intent", "entities", "keywords"]
    }


@pytest.fixture
def mock_azure_services(monkeypatch):
    """Mock Azure services for testing."""
    class MockSpeechService:
        async def transcribe_from_url(self, url, call_id):
            return {
                "call_id": call_id,
                "full_transcript": "Mock transcription",
                "segments": [],
                "language": "zh-CN",
                "confidence_score": 0.95,
                "processing_time_ms": 1000,
                "audio_duration_seconds": 5.0,
                "word_count": 10
            }
        
        async def health_check(self):
            return True
    
    class MockOpenAI:
        async def chat_completions_create(self, **kwargs):
            class MockResponse:
                choices = [
                    type('Choice', (), {
                        'message': type('Message', (), {
                            'content': 'Mock AI response'
                        })()
                    })()
                ]
            return MockResponse()
    
    monkeypatch.setattr("app.services.azure_speech.azure_speech_service", MockSpeechService())
    monkeypatch.setattr("app.services.summary_generator.openai", MockOpenAI())