"""
Pytest configuration and fixtures
"""

import asyncio
import pytest
import pytest_asyncio
from typing import Dict, Any, AsyncGenerator
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from main import app
from app.core.database import Base, get_db_session
from app.core.cache import init_cache, close_cache
from app.services.ml_service import MLService


# Test database URL - use in-memory SQLite for tests
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session")
async def test_engine():
    """Create test database engine"""
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
        future=True
    )
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    yield engine
    
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    """Create test database session"""
    async_session_maker = sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )
    
    async with async_session_maker() as session:
        yield session


@pytest.fixture
def override_get_db(db_session):
    """Override database dependency for testing"""
    async def _override_get_db():
        yield db_session
    
    app.dependency_overrides[get_db_session] = _override_get_db
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def client(override_get_db):
    """Create test client"""
    with TestClient(app) as test_client:
        yield test_client


@pytest_asyncio.fixture
async def test_cache():
    """Initialize test cache"""
    await init_cache()
    yield
    await close_cache()


@pytest.fixture
def sample_call_data() -> Dict[str, Any]:
    """Sample call data for testing"""
    return {
        "call_id": "test_call_001",
        "user_id": "test_user_001",
        "caller_phone_hash": "test_hash_001",
        "call_type": "spam",
        "call_outcome": "blocked_successfully",
        "duration_seconds": 45,
        "response_time_ms": 1200,
        "start_time": "2024-01-15T10:30:00",
        "end_time": "2024-01-15T10:30:45",
        "transcript_summary": "This is a test call about a promotional offer",
        "spam_indicators": {
            "keyword_score": 0.8,
            "time_pattern_score": 0.6
        },
        "detection_confidence": 0.85
    }


@pytest.fixture
def sample_user_profile() -> Dict[str, Any]:
    """Sample user profile data for testing"""
    return {
        "user_id": "test_user_001",
        "personality_type": "polite",
        "communication_style": "formal",
        "response_preferences": {
            "preferred_length": "medium",
            "tone": "professional"
        },
        "spam_tolerance": 0.7
    }


@pytest.fixture
def sample_spam_profile() -> Dict[str, Any]:
    """Sample spam profile data for testing"""
    return {
        "phone_hash": "test_hash_001",
        "spam_category": "sales_call",
        "risk_score": 0.75,
        "confidence_level": 0.85,
        "feature_vector": {
            "temporal_score": 0.6,
            "linguistic_score": 0.8,
            "behavioral_score": 0.7
        },
        "behavioral_patterns": {
            "call_frequency": "high",
            "persistence_level": "medium",
            "target_diversity": "low"
        }
    }


@pytest.fixture
def ml_service():
    """Create ML service instance for testing"""
    return MLService()


@pytest.fixture
def mock_ml_predictions():
    """Mock ML prediction responses"""
    return {
        "spam_prediction": {
            "is_spam": True,
            "spam_probability": 0.85,
            "confidence_score": 0.80,
            "risk_level": "high",
            "spam_category": "sales_call"
        },
        "user_analysis": {
            "personality_type": "polite",
            "effectiveness_score": 0.75,
            "preferred_strategies": ["gentle_decline", "polite_explanation"]
        }
    }


class TestDataGenerator:
    """Helper class to generate test data"""
    
    @staticmethod
    def generate_call_history(user_id: str, count: int = 10) -> list:
        """Generate sample call history"""
        from datetime import datetime, timedelta
        import random
        
        calls = []
        base_time = datetime(2024, 1, 1, 10, 0, 0)
        
        for i in range(count):
            call_time = base_time + timedelta(days=i, hours=random.randint(0, 10))
            call = {
                "call_id": f"test_call_{user_id}_{i:03d}",
                "user_id": user_id,
                "caller_phone_hash": f"hash_{i % 5:03d}",  # Simulate repeat callers
                "call_type": random.choice(["spam", "legitimate", "unknown"]),
                "call_outcome": random.choice([
                    "blocked_successfully", "caller_hung_up", 
                    "handled_by_ai", "transferred_to_user"
                ]),
                "duration_seconds": random.randint(10, 300),
                "response_time_ms": random.randint(500, 3000),
                "start_time": call_time.isoformat(),
                "detection_confidence": random.uniform(0.3, 0.95)
            }
            calls.append(call)
        
        return calls
    
    @staticmethod
    def generate_feature_vector(call_data: Dict[str, Any]) -> Dict[str, float]:
        """Generate feature vector from call data"""
        import random
        
        return {
            "temporal_hour_of_day": float(random.randint(8, 18)),
            "temporal_day_of_week": float(random.randint(0, 6)),
            "temporal_is_business_hours": random.choice([0.0, 1.0]),
            "call_duration": float(call_data.get("duration_seconds", 30)),
            "response_time": float(call_data.get("response_time_ms", 1000)),
            "text_keyword_score": random.uniform(0.0, 1.0),
            "text_sentiment_score": random.uniform(-0.5, 0.5),
            "behavioral_persistence": random.uniform(0.0, 1.0),
            "historical_success_rate": random.uniform(0.2, 0.8)
        }


@pytest.fixture
def test_data_generator():
    """Test data generator fixture"""
    return TestDataGenerator


# Async test helpers

async def async_test_helper(coro):
    """Helper to run async tests"""
    return await coro


# Custom test markers
pytest.mark.unit = pytest.mark.unit
pytest.mark.integration = pytest.mark.integration
pytest.mark.slow = pytest.mark.slow
pytest.mark.ml = pytest.mark.ml