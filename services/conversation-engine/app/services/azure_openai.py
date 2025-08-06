"""
Azure OpenAI service client for conversation generation.
"""

import asyncio
import logging
from typing import Dict, Any, List, Optional, AsyncGenerator
from dataclasses import dataclass
from enum import Enum

import aiohttp
from openai import AsyncAzureOpenAI
from azure.core.exceptions import HttpResponseError

from app.core.config import get_settings
from app.core.cache import get_cache

logger = logging.getLogger(__name__)


class ResponseStrategy(str, Enum):
    """Response generation strategies."""
    TEMPLATE_BASED = "template_based"
    AI_GENERATED = "ai_generated"
    HYBRID = "hybrid"
    CACHED = "cached"


@dataclass
class ConversationContext:
    """Context for conversation response generation."""
    user_id: str
    conversation_id: str
    caller_phone: str
    spam_category: Optional[str] = None
    personality_type: str = "polite"
    turn_count: int = 0
    conversation_history: List[Dict[str, Any]] = None
    current_stage: str = "initial"
    sentiment: Optional[str] = None
    emotion: Optional[str] = None
    caller_persistence_score: float = 0.0
    effectiveness_score: Optional[float] = None
    
    def __post_init__(self):
        if self.conversation_history is None:
            self.conversation_history = []


@dataclass
class ResponseResult:
    """Result of response generation."""
    text: str
    strategy: ResponseStrategy
    confidence: float
    processing_time_ms: float
    tokens_used: Optional[int] = None
    template_used: Optional[str] = None
    should_terminate: bool = False
    termination_reason: Optional[str] = None
    metadata: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}


class AzureOpenAIService:
    """Azure OpenAI service for conversation response generation."""
    
    def __init__(self):
        self.settings = get_settings()
        self.cache = None
        self._client: Optional[AsyncAzureOpenAI] = None
        self._session: Optional[aiohttp.ClientSession] = None
        
        # Response caching settings
        self.cache_ttl = self.settings.response_cache_ttl
        self.enable_caching = True
        
        # Rate limiting and retry settings
        self.max_retries = 3
        self.base_delay = 1.0
        self.max_delay = 10.0
        
        # Performance thresholds
        self.max_response_time_ms = 5000
        self.min_confidence_threshold = 0.6
    
    async def initialize(self) -> None:
        """Initialize the Azure OpenAI client."""
        try:
            self.cache = await get_cache()
            
            self._client = AsyncAzureOpenAI(
                api_key=self.settings.azure_openai_api_key,
                api_version=self.settings.azure_openai_api_version,
                azure_endpoint=self.settings.azure_openai_endpoint,
                timeout=self.settings.response_timeout,
                max_retries=self.max_retries
            )
            
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=self.settings.response_timeout)
            )
            
            logger.info("Azure OpenAI service initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize Azure OpenAI service: {e}")
            raise
    
    async def close(self) -> None:
        """Close the service and cleanup resources."""
        if self._client:
            await self._client.close()
        
        if self._session:
            await self._session.close()
        
        logger.info("Azure OpenAI service closed")
    
    async def generate_response(
        self,
        user_message: str,
        context: ConversationContext,
        strategy: ResponseStrategy = ResponseStrategy.HYBRID
    ) -> ResponseResult:
        """
        Generate a personalized response based on context and strategy.
        
        Args:
            user_message: The user's input message
            context: Conversation context and user information
            strategy: Response generation strategy
            
        Returns:
            ResponseResult with generated response and metadata
        """
        start_time = asyncio.get_event_loop().time()
        
        try:
            # Check cache first
            if self.enable_caching and strategy != ResponseStrategy.AI_GENERATED:
                cached_response = await self._get_cached_response(user_message, context)
                if cached_response:
                    processing_time = (asyncio.get_event_loop().time() - start_time) * 1000
                    return ResponseResult(
                        text=cached_response["text"],
                        strategy=ResponseStrategy.CACHED,
                        confidence=cached_response.get("confidence", 0.9),
                        processing_time_ms=processing_time,
                        template_used=cached_response.get("template_used"),
                        metadata=cached_response.get("metadata", {})
                    )
            
            # Generate response based on strategy
            if strategy == ResponseStrategy.TEMPLATE_BASED:
                result = await self._generate_template_response(user_message, context)
            elif strategy == ResponseStrategy.AI_GENERATED:
                result = await self._generate_ai_response(user_message, context)
            else:  # HYBRID
                result = await self._generate_hybrid_response(user_message, context)
            
            processing_time = (asyncio.get_event_loop().time() - start_time) * 1000
            result.processing_time_ms = processing_time
            
            # Cache successful responses
            if result.confidence >= self.min_confidence_threshold:
                await self._cache_response(user_message, context, result)
            
            # Check termination conditions
            termination_check = await self._should_terminate_conversation(context, result)
            result.should_terminate = termination_check["should_terminate"]
            result.termination_reason = termination_check.get("reason")
            
            return result
            
        except Exception as e:
            processing_time = (asyncio.get_event_loop().time() - start_time) * 1000
            logger.error(f"Error generating response: {e}")
            
            # Return fallback response
            return await self._generate_fallback_response(context, processing_time)
    
    async def _generate_ai_response(
        self,
        user_message: str,
        context: ConversationContext
    ) -> ResponseResult:
        """Generate AI-powered response using Azure OpenAI."""
        
        try:
            # Build conversation prompt
            prompt = await self._build_conversation_prompt(user_message, context)
            
            # Call Azure OpenAI
            response = await self._client.chat.completions.create(
                model=self.settings.azure_openai_deployment_id,
                messages=prompt,
                max_tokens=self.settings.azure_openai_max_tokens,
                temperature=self.settings.azure_openai_temperature,
                presence_penalty=0.1,
                frequency_penalty=0.1,
                stop=["\n\n", "USER:", "AI:"]
            )
            
            response_text = response.choices[0].message.content.strip()
            tokens_used = response.usage.total_tokens
            
            # Calculate confidence based on response characteristics
            confidence = await self._calculate_response_confidence(
                response_text, context, tokens_used
            )
            
            return ResponseResult(
                text=response_text,
                strategy=ResponseStrategy.AI_GENERATED,
                confidence=confidence,
                processing_time_ms=0,  # Will be set by caller
                tokens_used=tokens_used,
                metadata={
                    "model": self.settings.azure_openai_deployment_id,
                    "temperature": self.settings.azure_openai_temperature,
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens
                }
            )
            
        except HttpResponseError as e:
            logger.error(f"Azure OpenAI API error: {e}")
            raise
        except Exception as e:
            logger.error(f"Error in AI response generation: {e}")
            raise
    
    async def _build_conversation_prompt(
        self,
        user_message: str,
        context: ConversationContext
    ) -> List[Dict[str, str]]:
        """Build conversation prompt for Azure OpenAI."""
        
        # System message for personality and context
        system_message = await self._build_system_message(context)
        
        # Conversation history
        messages = [{"role": "system", "content": system_message}]
        
        # Add recent conversation history (last 6 messages)
        recent_history = context.conversation_history[-6:] if context.conversation_history else []
        for msg in recent_history:
            role = "user" if msg["speaker"] == "user" else "assistant"
            messages.append({
                "role": role,
                "content": msg["message_text"]
            })
        
        # Current user message
        messages.append({
            "role": "user",
            "content": user_message
        })
        
        return messages
    
    async def _build_system_message(self, context: ConversationContext) -> str:
        """Build system message for personality and context."""
        
        personality_descriptions = {
            "polite": "You are polite, respectful, and courteous. You decline offers gently but firmly.",
            "direct": "You are direct and straightforward. You clearly state your position without unnecessary politeness.",
            "humorous": "You use light humor to deflect spam calls while remaining friendly.",
            "professional": "You maintain a professional, business-like tone in all interactions."
        }
        
        spam_context = ""
        if context.spam_category:
            spam_context = f"This appears to be a {context.spam_category} spam call. "
        
        termination_guidance = ""
        if context.turn_count >= 3:
            termination_guidance = "Consider ending the conversation politely if the caller persists. "
        
        system_message = f"""You are an AI assistant helping to handle a phone call. {spam_context}

Personality: {personality_descriptions.get(context.personality_type, personality_descriptions['polite'])}

Current situation:
- This is turn {context.turn_count + 1} of the conversation
- Conversation stage: {context.stage}
- Caller persistence: {context.caller_persistence_score:.1f}/1.0

Guidelines:
1. Keep responses short (1-2 sentences, max 25 words)
2. Stay in character with the specified personality
3. Politely but firmly decline unwanted offers
4. {termination_guidance}
5. Be natural and conversational

Respond appropriately to the caller's message."""

        return system_message
    
    async def _generate_template_response(
        self,
        user_message: str,
        context: ConversationContext
    ) -> ResponseResult:
        """Generate response using templates."""
        
        # This would integrate with template matching logic
        # For now, return a simple template-based response
        
        templates = await self._get_response_templates(context)
        
        if templates:
            # Select best template based on context
            selected_template = await self._select_best_template(
                user_message, context, templates
            )
            
            response_text = await self._fill_template(selected_template, context)
            
            return ResponseResult(
                text=response_text,
                strategy=ResponseStrategy.TEMPLATE_BASED,
                confidence=0.8,
                processing_time_ms=0,
                template_used=selected_template.get("name"),
                metadata={"template_id": selected_template.get("id")}
            )
        
        # Fallback to AI generation if no templates found
        return await self._generate_ai_response(user_message, context)
    
    async def _generate_hybrid_response(
        self,
        user_message: str,
        context: ConversationContext
    ) -> ResponseResult:
        """Generate response using hybrid approach (templates + AI)."""
        
        # Try template first for common scenarios
        if context.turn_count <= 2 and context.spam_category:
            template_result = await self._generate_template_response(user_message, context)
            if template_result.confidence >= 0.7:
                template_result.strategy = ResponseStrategy.HYBRID
                return template_result
        
        # Use AI for complex or unique situations
        ai_result = await self._generate_ai_response(user_message, context)
        ai_result.strategy = ResponseStrategy.HYBRID
        return ai_result
    
    async def _calculate_response_confidence(
        self,
        response_text: str,
        context: ConversationContext,
        tokens_used: int
    ) -> float:
        """Calculate confidence score for generated response."""
        
        confidence = 0.5  # Base confidence
        
        # Length appropriateness (prefer shorter responses)
        word_count = len(response_text.split())
        if 5 <= word_count <= 25:
            confidence += 0.2
        elif word_count > 40:
            confidence -= 0.2
        
        # Personality consistency check
        personality_keywords = {
            "polite": ["please", "thank you", "sorry", "appreciate"],
            "direct": ["no", "not interested", "don't want"],
            "humorous": ["haha", "funny", "joke"],
            "professional": ["sir", "madam", "business", "company"]
        }
        
        keywords = personality_keywords.get(context.personality_type, [])
        if any(keyword in response_text.lower() for keyword in keywords):
            confidence += 0.1
        
        # Context appropriateness
        if context.spam_category and any(
            word in response_text.lower() 
            for word in ["not interested", "don't need", "no thank you"]
        ):
            confidence += 0.1
        
        # Token efficiency
        if tokens_used <= self.settings.azure_openai_max_tokens * 0.5:
            confidence += 0.1
        
        return min(max(confidence, 0.0), 1.0)
    
    async def _should_terminate_conversation(
        self,
        context: ConversationContext,
        result: ResponseResult
    ) -> Dict[str, Any]:
        """Determine if conversation should be terminated."""
        
        # Turn count threshold
        if context.turn_count >= self.settings.max_conversation_turns:
            return {
                "should_terminate": True,
                "reason": "max_turns_reached"
            }
        
        # High persistence caller
        if context.caller_persistence_score >= 0.8:
            return {
                "should_terminate": True,
                "reason": "excessive_persistence"
            }
        
        # Low effectiveness
        if (context.effectiveness_score is not None and 
            context.effectiveness_score < 0.3 and context.turn_count >= 3):
            return {
                "should_terminate": True,
                "reason": "low_effectiveness"
            }
        
        # Natural conversation end indicators
        termination_indicators = [
            "goodbye", "hang up", "don't call", "remove from list"
        ]
        
        if any(indicator in result.text.lower() for indicator in termination_indicators):
            return {
                "should_terminate": True,
                "reason": "natural_ending"
            }
        
        return {"should_terminate": False}
    
    async def _get_cached_response(
        self,
        user_message: str,
        context: ConversationContext
    ) -> Optional[Dict[str, Any]]:
        """Get cached response if available."""
        
        if not self.cache:
            return None
        
        # Create cache key based on message intent and context
        cache_key = f"response:{context.spam_category}:{context.personality_type}:{hash(user_message.lower()) % 10000}"
        
        try:
            cached_data = await self.cache.get(cache_key)
            if cached_data:
                logger.debug(f"Cache hit for key: {cache_key}")
                return cached_data
        except Exception as e:
            logger.warning(f"Cache get error: {e}")
        
        return None
    
    async def _cache_response(
        self,
        user_message: str,
        context: ConversationContext,
        result: ResponseResult
    ) -> None:
        """Cache successful response."""
        
        if not self.cache or result.confidence < self.min_confidence_threshold:
            return
        
        cache_key = f"response:{context.spam_category}:{context.personality_type}:{hash(user_message.lower()) % 10000}"
        
        cache_data = {
            "text": result.text,
            "confidence": result.confidence,
            "template_used": result.template_used,
            "metadata": result.metadata
        }
        
        try:
            await self.cache.setex(cache_key, self.cache_ttl, cache_data)
            logger.debug(f"Cached response for key: {cache_key}")
        except Exception as e:
            logger.warning(f"Cache set error: {e}")
    
    async def _generate_fallback_response(
        self,
        context: ConversationContext,
        processing_time: float
    ) -> ResponseResult:
        """Generate fallback response when AI fails."""
        
        fallback_responses = {
            "polite": "I'm sorry, I'm not interested at this time. Thank you for calling.",
            "direct": "I'm not interested. Please remove me from your list.",
            "humorous": "Thanks, but I'm all set! Have a great day!",
            "professional": "Thank you for your call, but I must decline your offer."
        }
        
        response_text = fallback_responses.get(
            context.personality_type,
            fallback_responses["polite"]
        )
        
        return ResponseResult(
            text=response_text,
            strategy=ResponseStrategy.TEMPLATE_BASED,
            confidence=0.6,
            processing_time_ms=processing_time,
            template_used="fallback",
            metadata={"fallback": True}
        )
    
    # Placeholder methods for template system integration
    async def _get_response_templates(self, context: ConversationContext) -> List[Dict[str, Any]]:
        """Get available response templates for context."""
        # This would query the database for templates
        return []
    
    async def _select_best_template(
        self,
        user_message: str,
        context: ConversationContext,
        templates: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Select best template for the current context."""
        # Template selection logic would go here
        return templates[0] if templates else {}
    
    async def _fill_template(
        self,
        template: Dict[str, Any],
        context: ConversationContext
    ) -> str:
        """Fill template with context variables."""
        # Template filling logic would go here
        return template.get("text", "")


# Global service instance
_openai_service: Optional[AzureOpenAIService] = None


async def get_openai_service() -> AzureOpenAIService:
    """Get or create Azure OpenAI service instance."""
    global _openai_service
    
    if _openai_service is None:
        _openai_service = AzureOpenAIService()
        await _openai_service.initialize()
    
    return _openai_service


async def close_openai_service() -> None:
    """Close Azure OpenAI service instance."""
    global _openai_service
    
    if _openai_service:
        await _openai_service.close()
        _openai_service = None