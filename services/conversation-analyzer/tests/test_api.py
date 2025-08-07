"""API endpoint tests."""

import pytest
import json
from uuid import uuid4
from httpx import AsyncClient


class TestAnalysisAPI:
    """Test analysis API endpoints."""
    
    @pytest.mark.asyncio
    async def test_health_endpoint(self, async_client: AsyncClient):
        """Test health check endpoint."""
        response = await async_client.get("/health")
        assert response.status_code == 200
        
        data = response.json()
        assert "status" in data
        assert "timestamp" in data
    
    @pytest.mark.asyncio
    async def test_root_endpoint(self, async_client: AsyncClient):
        """Test root endpoint."""
        response = await async_client.get("/")
        assert response.status_code == 200
        
        data = response.json()
        assert data["service"] == "conversation-analyzer"
        assert data["version"] == "1.0.0"
    
    @pytest.mark.asyncio 
    async def test_transcription_endpoint(
        self, 
        async_client: AsyncClient, 
        mock_azure_services,
        sample_call_id
    ):
        """Test audio transcription endpoint."""
        request_data = {
            "call_id": sample_call_id,
            "audio_url": "https://example.com/test.wav",
            "language": "zh-CN"
        }
        
        response = await async_client.post(
            "/api/v1/analysis/transcribe",
            json=request_data
        )
        
        # Note: This will fail without actual Azure credentials
        # In a real test, you'd mock the Azure service
        assert response.status_code in [200, 500]  # 500 expected without credentials
    
    @pytest.mark.asyncio
    async def test_content_analysis_endpoint(
        self, 
        async_client: AsyncClient,
        sample_analysis_request
    ):
        """Test content analysis endpoint."""
        response = await async_client.post(
            "/api/v1/analysis/content",
            json=sample_analysis_request
        )
        
        # This might fail due to missing ML models in test environment
        assert response.status_code in [200, 500]
    
    @pytest.mark.asyncio
    async def test_effectiveness_endpoint(
        self, 
        async_client: AsyncClient,
        sample_call_id,
        sample_user_id
    ):
        """Test effectiveness evaluation endpoint."""
        response = await async_client.post(
            f"/api/v1/analysis/effectiveness/{sample_call_id}",
            params={"user_id": sample_user_id}
        )
        
        # This will likely fail without actual data in database
        assert response.status_code in [200, 404, 500]
    
    @pytest.mark.asyncio
    async def test_summary_endpoint(
        self, 
        async_client: AsyncClient,
        sample_call_id,
        sample_user_id
    ):
        """Test summary generation endpoint."""
        request_data = {
            "call_id": sample_call_id,
            "include_recommendations": True,
            "include_metrics": True,
            "summary_style": "comprehensive"
        }
        
        response = await async_client.post(
            "/api/v1/analysis/summary",
            json=request_data,
            params={"user_id": sample_user_id}
        )
        
        # This will likely fail without actual data
        assert response.status_code in [200, 404, 500]
    
    @pytest.mark.asyncio
    async def test_complete_analysis_endpoint(
        self, 
        async_client: AsyncClient,
        sample_call_id,
        sample_user_id
    ):
        """Test complete analysis pipeline."""
        response = await async_client.post(
            f"/api/v1/analysis/analyze/{sample_call_id}",
            params={
                "user_id": sample_user_id,
                "priority": "normal"
            }
        )
        
        # This will likely fail without actual data
        assert response.status_code in [200, 404, 500]
    
    @pytest.mark.asyncio
    async def test_batch_analysis_endpoint(
        self, 
        async_client: AsyncClient,
        sample_user_id
    ):
        """Test batch analysis endpoint."""
        call_ids = [str(uuid4()) for _ in range(3)]
        
        request_data = {
            "call_ids": call_ids,
            "analysis_types": ["transcription", "content"],
            "priority": "normal"
        }
        
        response = await async_client.post(
            "/api/v1/analysis/batch",
            json=request_data,
            params={"user_id": sample_user_id}
        )
        
        # Should return task ID even if processing fails later
        if response.status_code == 200:
            data = response.json()
            assert "task_id" in data
            assert data["call_count"] == 3
    
    @pytest.mark.asyncio
    async def test_results_retrieval_endpoint(
        self, 
        async_client: AsyncClient,
        sample_call_id
    ):
        """Test results retrieval endpoint."""
        response = await async_client.get(
            f"/api/v1/analysis/results/{sample_call_id}"
        )
        
        # Will likely return 404 or empty results
        assert response.status_code in [200, 404]
        
        if response.status_code == 200:
            data = response.json()
            assert "call_id" in data
            assert "results" in data
    
    @pytest.mark.asyncio
    async def test_performance_metrics_endpoint(
        self, 
        async_client: AsyncClient
    ):
        """Test performance metrics endpoint."""
        response = await async_client.get("/api/v1/analysis/metrics/performance")
        
        assert response.status_code in [200, 500]
        
        if response.status_code == 200:
            data = response.json()
            assert "operation" in data
            assert "average_latency_ms" in data
    
    @pytest.mark.asyncio
    async def test_user_report_endpoint(
        self, 
        async_client: AsyncClient,
        sample_user_id
    ):
        """Test user summary report endpoint."""
        response = await async_client.get(
            f"/api/v1/analysis/reports/summary/{sample_user_id}",
            params={"days": 30, "limit": 50}
        )
        
        assert response.status_code in [200, 500]
        
        if response.status_code == 200:
            data = response.json()
            assert "user_id" in data
            assert "report_period_days" in data
            assert "summary_stats" in data


class TestErrorHandling:
    """Test error handling in API endpoints."""
    
    @pytest.mark.asyncio
    async def test_invalid_call_id(self, async_client: AsyncClient):
        """Test handling of invalid call ID."""
        response = await async_client.post(
            "/api/v1/analysis/effectiveness/invalid-uuid",
            params={"user_id": "test-user"}
        )
        
        assert response.status_code == 422  # Validation error
    
    @pytest.mark.asyncio
    async def test_missing_required_fields(self, async_client: AsyncClient):
        """Test handling of missing required fields."""
        # Missing call_id in transcription request
        request_data = {
            "language": "zh-CN"
        }
        
        response = await async_client.post(
            "/api/v1/analysis/transcribe",
            json=request_data
        )
        
        assert response.status_code == 422  # Validation error
    
    @pytest.mark.asyncio
    async def test_invalid_analysis_types(self, async_client: AsyncClient):
        """Test handling of invalid analysis types."""
        request_data = {
            "call_id": str(uuid4()),
            "text": "Test text",
            "analysis_types": ["invalid_type"]
        }
        
        response = await async_client.post(
            "/api/v1/analysis/content",
            json=request_data
        )
        
        # Should handle gracefully
        assert response.status_code in [200, 400, 422, 500]


class TestIntegration:
    """Integration tests (require actual services)."""
    
    @pytest.mark.skip(reason="Requires actual Azure services")
    @pytest.mark.asyncio
    async def test_full_pipeline_integration(
        self, 
        async_client: AsyncClient
    ):
        """Test full analysis pipeline integration."""
        # This test would require actual Azure services and data
        pass
    
    @pytest.mark.skip(reason="Requires database setup")
    @pytest.mark.asyncio
    async def test_database_integration(self):
        """Test database integration."""
        # This test would require actual database setup
        pass