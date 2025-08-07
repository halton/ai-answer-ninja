"""Client for integrating with other services."""

import asyncio
from typing import Any, Dict, List, Optional
import httpx
from datetime import datetime, timedelta

from app.core.config import settings
from app.core.logging import get_logger
from app.core.cache import analysis_cache

logger = get_logger(__name__)


class ServiceClient:
    """HTTP client for service integration."""
    
    def __init__(self):
        self.timeout = httpx.Timeout(10.0)
        self.retries = 3
        self.service_urls = {
            "profile_analytics": settings.profile_analytics_url,
            "realtime_processor": settings.realtime_processor_url,
            "conversation_engine": settings.conversation_engine_url,
            "user_management": settings.user_management_url
        }
    
    async def _make_request(
        self, 
        method: str, 
        service: str, 
        endpoint: str, 
        **kwargs
    ) -> Optional[Dict[str, Any]]:
        """Make HTTP request with retries and error handling."""
        if service not in self.service_urls:
            logger.error("unknown_service", service=service)
            return None
        
        url = f"{self.service_urls[service]}{endpoint}"
        
        for attempt in range(self.retries):
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    response = await client.request(method, url, **kwargs)
                    response.raise_for_status()
                    return response.json()
                    
            except httpx.HTTPStatusError as e:
                logger.error(
                    "service_http_error",
                    service=service,
                    endpoint=endpoint,
                    status_code=e.response.status_code,
                    attempt=attempt + 1
                )
                if attempt == self.retries - 1:
                    return None
                await asyncio.sleep(2 ** attempt)  # Exponential backoff
                
            except httpx.RequestError as e:
                logger.error(
                    "service_request_error",
                    service=service,
                    endpoint=endpoint,
                    error=str(e),
                    attempt=attempt + 1
                )
                if attempt == self.retries - 1:
                    return None
                await asyncio.sleep(2 ** attempt)
                
            except Exception as e:
                logger.error(
                    "service_unexpected_error",
                    service=service,
                    endpoint=endpoint,
                    error=str(e),
                    attempt=attempt + 1
                )
                if attempt == self.retries - 1:
                    return None
                await asyncio.sleep(2 ** attempt)
        
        return None
    
    # User Management Service Integration
    async def get_user_profile(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Get user profile from user management service."""
        # Check cache first
        cached_profile = await analysis_cache.get_user_profile(user_id)
        if cached_profile:
            return cached_profile
        
        # Fetch from service
        profile = await self._make_request(
            "GET",
            "user_management",
            f"/api/v1/users/{user_id}"
        )
        
        if profile:
            # Cache the result
            await analysis_cache.cache_user_profile(user_id, profile)
        
        return profile
    
    async def get_user_preferences(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Get user preferences."""
        return await self._make_request(
            "GET",
            "user_management", 
            f"/api/v1/users/{user_id}/preferences"
        )
    
    # Profile Analytics Service Integration
    async def get_caller_profile(self, caller_phone: str) -> Optional[Dict[str, Any]]:
        """Get caller profile from profile analytics service."""
        return await self._make_request(
            "GET",
            "profile_analytics",
            f"/api/v1/profile/{caller_phone}"
        )
    
    async def update_caller_interaction(
        self, 
        caller_phone: str, 
        interaction_data: Dict[str, Any]
    ) -> bool:
        """Update caller interaction data."""
        response = await self._make_request(
            "POST",
            "profile_analytics",
            f"/api/v1/profile/{caller_phone}/interaction",
            json=interaction_data
        )
        return response is not None
    
    async def get_spam_classification(self, caller_phone: str) -> Optional[Dict[str, Any]]:
        """Get spam classification for caller."""
        return await self._make_request(
            "GET",
            "profile_analytics",
            f"/api/v1/analytics/spam-classification/{caller_phone}"
        )
    
    async def get_user_analytics(self, user_id: str, days: int = 30) -> Optional[Dict[str, Any]]:
        """Get user analytics data."""
        return await self._make_request(
            "GET",
            "profile_analytics",
            f"/api/v1/analytics/user/{user_id}",
            params={"days": days}
        )
    
    # Realtime Processor Service Integration
    async def get_call_context(self, call_id: str) -> Optional[Dict[str, Any]]:
        """Get call context from realtime processor."""
        # Check cache first
        cached_context = await analysis_cache.get_call_context(call_id)
        if cached_context:
            return cached_context
        
        # Fetch from service
        context = await self._make_request(
            "GET",
            "realtime_processor",
            f"/api/v1/calls/{call_id}/context"
        )
        
        if context:
            # Cache the result
            await analysis_cache.cache_call_context(call_id, context)
        
        return context
    
    async def get_call_metrics(self, call_id: str) -> Optional[Dict[str, Any]]:
        """Get call processing metrics."""
        return await self._make_request(
            "GET",
            "realtime_processor",
            f"/api/v1/calls/{call_id}/metrics"
        )
    
    async def notify_analysis_complete(
        self, 
        call_id: str, 
        analysis_results: Dict[str, Any]
    ) -> bool:
        """Notify realtime processor that analysis is complete."""
        response = await self._make_request(
            "POST",
            "realtime_processor",
            f"/api/v1/calls/{call_id}/analysis-complete",
            json=analysis_results
        )
        return response is not None
    
    # Conversation Engine Service Integration
    async def get_conversation_state(self, call_id: str) -> Optional[Dict[str, Any]]:
        """Get conversation state from conversation engine."""
        return await self._make_request(
            "GET",
            "conversation_engine",
            f"/api/v1/conversation/{call_id}/state"
        )
    
    async def update_conversation_analysis(
        self, 
        call_id: str, 
        analysis_data: Dict[str, Any]
    ) -> bool:
        """Update conversation analysis data."""
        response = await self._make_request(
            "POST",
            "conversation_engine",
            f"/api/v1/conversation/{call_id}/analysis",
            json=analysis_data
        )
        return response is not None
    
    async def get_ai_response_history(self, call_id: str) -> Optional[List[Dict[str, Any]]]:
        """Get AI response history."""
        return await self._make_request(
            "GET",
            "conversation_engine",
            f"/api/v1/conversation/{call_id}/responses"
        )
    
    # Cross-service Data Collection
    async def collect_call_analysis_data(
        self, 
        call_id: str, 
        user_id: str
    ) -> Dict[str, Any]:
        """Collect comprehensive call analysis data from all services."""
        
        # Gather data from all services in parallel
        tasks = {
            "user_profile": self.get_user_profile(user_id),
            "user_preferences": self.get_user_preferences(user_id),
            "call_context": self.get_call_context(call_id),
            "call_metrics": self.get_call_metrics(call_id),
            "conversation_state": self.get_conversation_state(call_id),
            "ai_responses": self.get_ai_response_history(call_id)
        }
        
        # Execute all requests concurrently
        results = await asyncio.gather(
            *tasks.values(),
            return_exceptions=True
        )
        
        # Process results
        collected_data = {}
        for key, result in zip(tasks.keys(), results):
            if isinstance(result, Exception):
                logger.warning("data_collection_partial_failure", 
                              service_data=key, error=str(result))
                collected_data[key] = None
            else:
                collected_data[key] = result
        
        # Add caller profile if we have phone number
        call_context = collected_data.get("call_context", {})
        if call_context and "caller_phone" in call_context:
            caller_phone = call_context["caller_phone"]
            
            caller_tasks = {
                "caller_profile": self.get_caller_profile(caller_phone),
                "spam_classification": self.get_spam_classification(caller_phone)
            }
            
            caller_results = await asyncio.gather(
                *caller_tasks.values(),
                return_exceptions=True
            )
            
            for key, result in zip(caller_tasks.keys(), caller_results):
                if not isinstance(result, Exception):
                    collected_data[key] = result
        
        return collected_data
    
    # Batch Operations
    async def batch_update_analysis_results(
        self,
        analysis_results: List[Dict[str, Any]]
    ) -> Dict[str, int]:
        """Batch update analysis results across services."""
        
        success_counts = {
            "profile_analytics": 0,
            "conversation_engine": 0,
            "realtime_processor": 0
        }
        
        # Group updates by service
        profile_updates = []
        conversation_updates = []
        realtime_updates = []
        
        for result in analysis_results:
            call_id = result.get("call_id")
            if not call_id:
                continue
            
            # Prepare updates for each service
            if "caller_interaction" in result:
                profile_updates.append({
                    "call_id": call_id,
                    "data": result["caller_interaction"]
                })
            
            if "conversation_analysis" in result:
                conversation_updates.append({
                    "call_id": call_id,
                    "data": result["conversation_analysis"]
                })
            
            if "processing_complete" in result:
                realtime_updates.append({
                    "call_id": call_id,
                    "data": result["processing_complete"]
                })
        
        # Execute batch updates
        batch_tasks = []
        
        if profile_updates:
            batch_tasks.append(self._batch_profile_updates(profile_updates))
        
        if conversation_updates:
            batch_tasks.append(self._batch_conversation_updates(conversation_updates))
        
        if realtime_updates:
            batch_tasks.append(self._batch_realtime_updates(realtime_updates))
        
        if batch_tasks:
            batch_results = await asyncio.gather(*batch_tasks, return_exceptions=True)
            
            # Process batch results
            for i, result in enumerate(batch_results):
                if not isinstance(result, Exception):
                    if i == 0 and profile_updates:  # Profile analytics
                        success_counts["profile_analytics"] = result
                    elif i == 1 and conversation_updates:  # Conversation engine
                        success_counts["conversation_engine"] = result
                    elif i == 2 and realtime_updates:  # Realtime processor
                        success_counts["realtime_processor"] = result
        
        return success_counts
    
    async def _batch_profile_updates(self, updates: List[Dict[str, Any]]) -> int:
        """Batch update profile analytics."""
        success_count = 0
        for update in updates:
            caller_phone = update["data"].get("caller_phone")
            if caller_phone:
                success = await self.update_caller_interaction(
                    caller_phone, update["data"]
                )
                if success:
                    success_count += 1
        return success_count
    
    async def _batch_conversation_updates(self, updates: List[Dict[str, Any]]) -> int:
        """Batch update conversation engine."""
        success_count = 0
        for update in updates:
            success = await self.update_conversation_analysis(
                update["call_id"], update["data"]
            )
            if success:
                success_count += 1
        return success_count
    
    async def _batch_realtime_updates(self, updates: List[Dict[str, Any]]) -> int:
        """Batch update realtime processor."""
        success_count = 0
        for update in updates:
            success = await self.notify_analysis_complete(
                update["call_id"], update["data"]
            )
            if success:
                success_count += 1
        return success_count
    
    # Health Checks
    async def check_service_health(self, service: str) -> bool:
        """Check health of a specific service."""
        response = await self._make_request(
            "GET",
            service,
            "/health"
        )
        return response is not None and response.get("status") == "healthy"
    
    async def check_all_services_health(self) -> Dict[str, bool]:
        """Check health of all integrated services."""
        health_checks = {}
        
        tasks = {
            service: self.check_service_health(service)
            for service in self.service_urls.keys()
        }
        
        results = await asyncio.gather(*tasks.values(), return_exceptions=True)
        
        for service, result in zip(tasks.keys(), results):
            if isinstance(result, Exception):
                health_checks[service] = False
            else:
                health_checks[service] = result
        
        return health_checks
    
    # Webhook Support
    async def register_webhook(
        self, 
        service: str, 
        event_type: str, 
        webhook_url: str
    ) -> bool:
        """Register webhook with another service."""
        response = await self._make_request(
            "POST",
            service,
            "/api/v1/webhooks",
            json={
                "event_type": event_type,
                "url": webhook_url,
                "service": "conversation-analyzer"
            }
        )
        return response is not None


# Singleton instance
service_client = ServiceClient()