"""
Real-time profile updating service
"""

import asyncio
import json
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from collections import deque, defaultdict

import redis.asyncio as redis
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.core.database import get_db_session
from app.core.cache import cache_manager
from app.core.config import get_settings
from app.core.logging import LoggingMixin
from app.models.profile import SpamProfile, UserProfile, UserSpamInteraction
from app.models.call_data import ProcessedCallData
from app.services.ml_service import MLService


class RealTimeProfileService(LoggingMixin):
    """Real-time profile updating and streaming service"""
    
    def __init__(self):
        super().__init__()
        self.settings = get_settings()
        
        # Event stream processing
        self.event_queue = deque(maxlen=10000)  # Keep last 10k events
        self.event_processors = {}
        
        # Real-time counters
        self.profile_updates = defaultdict(int)
        self.spam_detections = defaultdict(int)
        
        # Batch processing
        self.batch_queue = deque(maxlen=1000)
        self.batch_size = self.settings.batch_size
        self.batch_interval = self.settings.batch_processing_interval
        
        # Redis for real-time events
        self.redis_client: Optional[redis.Redis] = None
        
        # Background tasks
        self.background_tasks = set()
        
    async def start(self):
        """Start real-time processing services"""
        
        try:
            # Initialize Redis connection
            await self._init_redis()
            
            # Start background processors
            await self._start_background_processors()
            
            self.logger.info("Real-time profile service started")
            
        except Exception as e:
            self.logger.error(f"Error starting real-time service: {e}")
            raise
    
    async def stop(self):
        """Stop real-time processing services"""
        
        try:
            # Stop background tasks
            for task in self.background_tasks:
                task.cancel()
            
            # Wait for tasks to complete
            await asyncio.gather(*self.background_tasks, return_exceptions=True)
            
            # Close Redis connection
            if self.redis_client:
                await self.redis_client.close()
            
            self.logger.info("Real-time profile service stopped")
            
        except Exception as e:
            self.logger.error(f"Error stopping real-time service: {e}")
    
    async def _init_redis(self):
        """Initialize Redis connection for real-time events"""
        
        try:
            self.redis_client = redis.from_url(self.settings.redis_url)
            await self.redis_client.ping()
            
        except Exception as e:
            self.logger.error(f"Error connecting to Redis: {e}")
            self.redis_client = None
    
    async def _start_background_processors(self):
        """Start background processing tasks"""
        
        # Event stream processor
        event_task = asyncio.create_task(self._process_event_stream())
        self.background_tasks.add(event_task)
        
        # Batch processor
        batch_task = asyncio.create_task(self._process_batch_updates())
        self.background_tasks.add(batch_task)
        
        # Profile refresh processor
        refresh_task = asyncio.create_task(self._process_profile_refreshes())
        self.background_tasks.add(refresh_task)
        
        # Cleanup processor
        cleanup_task = asyncio.create_task(self._process_cleanup())
        self.background_tasks.add(cleanup_task)
    
    async def update_spam_profile_realtime(
        self,
        phone_hash: str,
        call_data: Dict[str, Any],
        detection_result: Dict[str, Any]
    ) -> bool:
        """Update spam profile in real-time based on new call data"""
        
        try:
            # Create update event
            update_event = {
                'type': 'spam_profile_update',
                'phone_hash': phone_hash,
                'call_data': call_data,
                'detection_result': detection_result,
                'timestamp': datetime.now().isoformat(),
                'event_id': f"spam_{phone_hash}_{int(datetime.now().timestamp())}"
            }
            
            # Add to event queue
            self.event_queue.append(update_event)
            
            # Publish to Redis for other services
            if self.redis_client:
                await self.redis_client.publish(
                    'profile_updates',
                    json.dumps(update_event, default=str)
                )
            
            # Immediate cache update
            await self._update_spam_profile_cache(phone_hash, detection_result)
            
            # Increment counter
            self.spam_detections[phone_hash] += 1
            
            return True
            
        except Exception as e:
            self.logger.error(f"Error updating spam profile realtime: {e}")
            return False
    
    async def update_user_profile_realtime(
        self,
        user_id: str,
        interaction_data: Dict[str, Any],
        effectiveness_data: Dict[str, Any]
    ) -> bool:
        """Update user profile in real-time based on interaction"""
        
        try:
            # Create update event
            update_event = {
                'type': 'user_profile_update',
                'user_id': user_id,
                'interaction_data': interaction_data,
                'effectiveness_data': effectiveness_data,
                'timestamp': datetime.now().isoformat(),
                'event_id': f"user_{user_id}_{int(datetime.now().timestamp())}"
            }
            
            # Add to event queue
            self.event_queue.append(update_event)
            
            # Publish to Redis
            if self.redis_client:
                await self.redis_client.publish(
                    'profile_updates',
                    json.dumps(update_event, default=str)
                )
            
            # Immediate cache update
            await self._update_user_profile_cache(user_id, effectiveness_data)
            
            # Increment counter
            self.profile_updates[user_id] += 1
            
            return True
            
        except Exception as e:
            self.logger.error(f"Error updating user profile realtime: {e}")
            return False
    
    async def process_call_completion(
        self,
        call_id: str,
        user_id: str,
        caller_phone_hash: str,
        call_result: Dict[str, Any]
    ) -> bool:
        """Process completed call for profile updates"""
        
        try:
            # Extract key information
            success = call_result.get('success', False)
            duration = call_result.get('duration_seconds', 0)
            outcome = call_result.get('outcome')
            effectiveness_score = call_result.get('effectiveness_score', 0.5)
            
            # Update both profiles
            tasks = []
            
            # User profile update
            user_update_task = self.update_user_profile_realtime(
                user_id,
                {
                    'call_id': call_id,
                    'duration': duration,
                    'outcome': outcome,
                    'caller_phone_hash': caller_phone_hash
                },
                {
                    'effectiveness_score': effectiveness_score,
                    'success': success,
                    'call_type': call_result.get('call_type', 'unknown')
                }
            )
            tasks.append(user_update_task)
            
            # Spam profile update if it was spam
            if call_result.get('was_spam', False):
                spam_update_task = self.update_spam_profile_realtime(
                    caller_phone_hash,
                    {
                        'call_id': call_id,
                        'user_id': user_id,
                        'duration': duration,
                        'outcome': outcome
                    },
                    {
                        'blocked_successfully': success,
                        'effectiveness_score': effectiveness_score,
                        'detection_confidence': call_result.get('spam_confidence', 0.5)
                    }
                )
                tasks.append(spam_update_task)
            
            # Execute updates
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            # Check if all updates succeeded
            success_count = sum(1 for r in results if r is True)
            
            self.logger.info(f"Processed call completion {call_id}: {success_count}/{len(results)} updates successful")
            
            return success_count == len(results)
            
        except Exception as e:
            self.logger.error(f"Error processing call completion: {e}")
            return False
    
    async def _process_event_stream(self):
        """Process real-time event stream"""
        
        while True:
            try:
                if not self.event_queue:
                    await asyncio.sleep(0.1)
                    continue
                
                # Process batch of events
                batch_events = []
                for _ in range(min(10, len(self.event_queue))):
                    if self.event_queue:
                        batch_events.append(self.event_queue.popleft())
                
                if batch_events:
                    await self._process_event_batch(batch_events)
                
                await asyncio.sleep(0.01)  # Small delay to prevent CPU spinning
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error(f"Error processing event stream: {e}")
                await asyncio.sleep(1)
    
    async def _process_event_batch(self, events: List[Dict[str, Any]]):
        """Process a batch of events"""
        
        try:
            # Group events by type
            spam_events = [e for e in events if e['type'] == 'spam_profile_update']
            user_events = [e for e in events if e['type'] == 'user_profile_update']
            
            # Process spam profile events
            if spam_events:
                await self._process_spam_profile_events(spam_events)
            
            # Process user profile events
            if user_events:
                await self._process_user_profile_events(user_events)
            
        except Exception as e:
            self.logger.error(f"Error processing event batch: {e}")
    
    async def _process_spam_profile_events(self, events: List[Dict[str, Any]]):
        """Process spam profile update events"""
        
        try:
            # Group by phone hash for efficient batch updates
            phone_events = defaultdict(list)
            for event in events:
                phone_hash = event['phone_hash']
                phone_events[phone_hash].append(event)
            
            # Update each phone hash
            for phone_hash, phone_events_list in phone_events.items():
                await self._batch_update_spam_profile(phone_hash, phone_events_list)
                
        except Exception as e:
            self.logger.error(f"Error processing spam profile events: {e}")
    
    async def _process_user_profile_events(self, events: List[Dict[str, Any]]):
        """Process user profile update events"""
        
        try:
            # Group by user ID
            user_events = defaultdict(list)
            for event in events:
                user_id = event['user_id']
                user_events[user_id].append(event)
            
            # Update each user
            for user_id, user_events_list in user_events.items():
                await self._batch_update_user_profile(user_id, user_events_list)
                
        except Exception as e:
            self.logger.error(f"Error processing user profile events: {e}")
    
    async def _batch_update_spam_profile(
        self,
        phone_hash: str,
        events: List[Dict[str, Any]]
    ):
        """Batch update spam profile from multiple events"""
        
        try:
            # Aggregate data from events
            total_calls = len(events)
            successful_blocks = sum(1 for e in events 
                                  if e['detection_result'].get('blocked_successfully', False))
            avg_confidence = sum(e['detection_result'].get('detection_confidence', 0.5) 
                               for e in events) / total_calls
            
            # Update database
            async for db in get_db_session():
                try:
                    # Get existing profile
                    query = select(SpamProfile).where(SpamProfile.phone_hash == phone_hash)
                    result = await db.execute(query)
                    profile = result.scalar_one_or_none()
                    
                    if profile:
                        # Update existing profile
                        profile.total_reports += total_calls
                        profile.successful_blocks += successful_blocks
                        profile.confidence_level = (profile.confidence_level + avg_confidence) / 2
                        profile.last_activity = datetime.now()
                        profile.updated_at = datetime.now()
                    else:
                        # Create new profile
                        latest_event = max(events, key=lambda e: e['timestamp'])
                        detection_result = latest_event['detection_result']
                        
                        profile = SpamProfile(
                            phone_hash=phone_hash,
                            spam_category='unknown',  # Would be determined by classification
                            risk_score=avg_confidence,
                            confidence_level=avg_confidence,
                            total_reports=total_calls,
                            successful_blocks=successful_blocks,
                            last_activity=datetime.now()
                        )
                        db.add(profile)
                    
                    await db.commit()
                    
                    # Clear cache
                    cache_key = f"spam_profile:{phone_hash}"
                    await cache_manager.delete(cache_key)
                    
                    break  # Exit the async generator loop
                    
                except Exception as e:
                    await db.rollback()
                    raise e
                
        except Exception as e:
            self.logger.error(f"Error batch updating spam profile {phone_hash}: {e}")
    
    async def _batch_update_user_profile(
        self,
        user_id: str,
        events: List[Dict[str, Any]]
    ):
        """Batch update user profile from multiple events"""
        
        try:
            # Aggregate effectiveness data
            effectiveness_scores = [e['effectiveness_data'].get('effectiveness_score', 0.5) 
                                   for e in events]
            avg_effectiveness = sum(effectiveness_scores) / len(effectiveness_scores)
            
            # Count successful interactions
            successful_interactions = sum(1 for e in events 
                                        if e['effectiveness_data'].get('success', False))
            
            # Update database
            async for db in get_db_session():
                try:
                    # Get existing profile
                    query = select(UserProfile).where(UserProfile.user_id == user_id)
                    result = await db.execute(query)
                    profile = result.scalar_one_or_none()
                    
                    if profile:
                        # Update response effectiveness
                        current_effectiveness = profile.response_effectiveness or {}
                        current_effectiveness['recent_avg_effectiveness'] = avg_effectiveness
                        current_effectiveness['recent_success_rate'] = successful_interactions / len(events)
                        current_effectiveness['last_update'] = datetime.now().isoformat()
                        
                        profile.response_effectiveness = current_effectiveness
                        profile.updated_at = datetime.now()
                        
                        await db.commit()
                        
                        # Clear cache
                        cache_key = f"user_profile:{user_id}"
                        await cache_manager.delete(cache_key)
                    
                    break  # Exit the async generator loop
                    
                except Exception as e:
                    await db.rollback()
                    raise e
                    
        except Exception as e:
            self.logger.error(f"Error batch updating user profile {user_id}: {e}")
    
    async def _update_spam_profile_cache(
        self,
        phone_hash: str,
        detection_result: Dict[str, Any]
    ):
        """Update spam profile cache immediately"""
        
        try:
            cache_key = f"spam_profile:{phone_hash}"
            cached_profile = await cache_manager.get(cache_key)
            
            if cached_profile:
                # Update cached data
                cached_profile['last_activity'] = datetime.now().isoformat()
                if detection_result.get('blocked_successfully'):
                    cached_profile['successful_blocks'] = cached_profile.get('successful_blocks', 0) + 1
                
                # Update cache with shorter TTL for real-time data
                await cache_manager.set(cache_key, cached_profile, ttl=300)  # 5 minutes
                
        except Exception as e:
            self.logger.error(f"Error updating spam profile cache: {e}")
    
    async def _update_user_profile_cache(
        self,
        user_id: str,
        effectiveness_data: Dict[str, Any]
    ):
        """Update user profile cache immediately"""
        
        try:
            cache_key = f"user_profile:{user_id}"
            cached_profile = await cache_manager.get(cache_key)
            
            if cached_profile:
                # Update effectiveness metrics
                response_effectiveness = cached_profile.get('response_effectiveness', {})
                response_effectiveness['last_effectiveness'] = effectiveness_data.get('effectiveness_score', 0.5)
                response_effectiveness['last_update'] = datetime.now().isoformat()
                
                cached_profile['response_effectiveness'] = response_effectiveness
                
                # Update cache
                await cache_manager.set(cache_key, cached_profile, ttl=600)  # 10 minutes
                
        except Exception as e:
            self.logger.error(f"Error updating user profile cache: {e}")
    
    async def _process_batch_updates(self):
        """Process batch updates periodically"""
        
        while True:
            try:
                await asyncio.sleep(self.batch_interval)
                
                if self.batch_queue:
                    # Process queued batch updates
                    batch_items = []
                    for _ in range(min(self.batch_size, len(self.batch_queue))):
                        if self.batch_queue:
                            batch_items.append(self.batch_queue.popleft())
                    
                    if batch_items:
                        await self._execute_batch_updates(batch_items)
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error(f"Error processing batch updates: {e}")
    
    async def _process_profile_refreshes(self):
        """Process profile refreshes periodically"""
        
        while True:
            try:
                await asyncio.sleep(3600)  # Every hour
                
                # Refresh active profiles
                await self._refresh_active_profiles()
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error(f"Error processing profile refreshes: {e}")
    
    async def _process_cleanup(self):
        """Process cleanup tasks periodically"""
        
        while True:
            try:
                await asyncio.sleep(1800)  # Every 30 minutes
                
                # Clean up old events
                current_time = datetime.now()
                cutoff_time = current_time - timedelta(hours=1)
                
                # Clear old counters
                for phone_hash in list(self.spam_detections.keys()):
                    # In a real implementation, you'd check timestamps
                    if self.spam_detections[phone_hash] == 0:
                        del self.spam_detections[phone_hash]
                
                for user_id in list(self.profile_updates.keys()):
                    if self.profile_updates[user_id] == 0:
                        del self.profile_updates[user_id]
                
                self.logger.info("Completed real-time service cleanup")
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error(f"Error processing cleanup: {e}")
    
    async def _execute_batch_updates(self, batch_items: List[Dict[str, Any]]):
        """Execute batch database updates"""
        
        try:
            # This would contain the actual batch update logic
            self.logger.info(f"Executing batch updates for {len(batch_items)} items")
            
        except Exception as e:
            self.logger.error(f"Error executing batch updates: {e}")
    
    async def _refresh_active_profiles(self):
        """Refresh active profiles from database"""
        
        try:
            # This would refresh profiles that have been active recently
            self.logger.info("Refreshing active profiles")
            
        except Exception as e:
            self.logger.error(f"Error refreshing active profiles: {e}")
    
    async def get_realtime_stats(self) -> Dict[str, Any]:
        """Get real-time service statistics"""
        
        return {
            'event_queue_size': len(self.event_queue),
            'batch_queue_size': len(self.batch_queue),
            'spam_detections_count': dict(self.spam_detections),
            'profile_updates_count': dict(self.profile_updates),
            'background_tasks_count': len(self.background_tasks),
            'redis_connected': self.redis_client is not None,
            'timestamp': datetime.now()
        }