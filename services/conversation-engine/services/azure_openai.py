import asyncio
import hashlib
import json
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime
import openai
from openai import AsyncAzureOpenAI
import structlog

from ..core.config import settings
from ..core.cache import conversation_cache
from ..models.conversation import (
    ConversationContext, AIResponse, IntentCategory, 
    EmotionalState, ConversationStage
)
from ..models.user import UserProfileData, PersonalityType, SpeechStyle

logger = structlog.get_logger(__name__)


class AzureOpenAIService:
    """Azure OpenAI service for generating personalized conversation responses."""
    
    def __init__(self):
        self.client = AsyncAzureOpenAI(
            api_key=settings.azure_openai_key,
            api_version=settings.azure_openai_api_version,
            azure_endpoint=settings.azure_openai_endpoint
        )
        self.deployment_name = settings.azure_openai_deployment_name
        self.default_temperature = settings.temperature
        self.default_max_tokens = settings.max_tokens
        
        # Response templates for common scenarios
        self.response_templates = self._initialize_templates()
        
        # Performance tracking
        self.total_requests = 0
        self.cache_hits = 0
        self.avg_response_time = 0.0
    
    def _initialize_templates(self) -> Dict[str, Dict[str, List[str]]]:
        """Initialize response templates by intent and personality."""
        return {
            "sales_call": {
                "polite": [
                    "谢谢您的来电，但我现在不太方便了解产品信息。",
                    "很抱歉，我目前对这类产品不感兴趣，谢谢理解。",
                    "感谢您的介绍，但我暂时不需要这项服务。"
                ],
                "direct": [
                    "我不需要这个产品，请不要再打电话了。",
                    "我对您的产品不感兴趣，请将我的号码从名单中删除。",
                    "请停止向我推销产品，谢谢。"
                ],
                "humorous": [
                    "哈哈，我的钱包告诉我现在不是购物的好时机。",
                    "听起来不错，但我的预算已经被我的咖啡开销用完了。",
                    "我现在唯一需要购买的就是更多的时间，你们有卖吗？"
                ]
            },
            "loan_offer": {
                "polite": [
                    "谢谢您的贷款信息，但我目前没有贷款需求。",
                    "我暂时不考虑贷款，如有需要会主动联系银行。",
                    "感谢您的介绍，但我现在经济状况良好，不需要贷款。"
                ],
                "direct": [
                    "我不需要贷款，请不要再联系我。",
                    "我没有贷款需求，请将我从您的客户名单中移除。",
                    "请停止向我推销贷款产品。"
                ],
                "professional": [
                    "根据我目前的财务规划，暂时不考虑贷款产品。",
                    "我有固定的金融合作伙伴，暂不考虑其他贷款服务。",
                    "谢谢您的专业介绍，但这不符合我的当前需求。"
                ]
            },
            "investment_pitch": {
                "polite": [
                    "投资确实重要，但我有自己的投资顾问，谢谢。",
                    "感谢您的投资建议，但我暂时不考虑新的投资机会。",
                    "我对投资比较谨慎，需要更多时间考虑。"
                ],
                "direct": [
                    "我不参与电话推销的投资项目。",
                    "我有固定的投资渠道，不需要其他建议。",
                    "请不要再给我推荐投资产品。"
                ],
                "professional": [
                    "我的投资组合已经经过专业规划，暂不调整。",
                    "根据我的风险承受能力，这类产品不适合我。",
                    "我需要看到详细的产品说明书才能做决定。"
                ]
            }
        }
    
    async def generate_response(
        self,
        context: ConversationContext,
        user_profile: Optional[UserProfileData] = None,
        force_generation: bool = False
    ) -> AIResponse:
        """Generate personalized AI response based on context and user profile."""
        start_time = datetime.utcnow()
        
        try:
            # Check cache first unless forced generation
            if not force_generation:
                cached_response = await self._get_cached_response(context, user_profile)
                if cached_response:
                    self.cache_hits += 1
                    logger.info(
                        "Retrieved cached response",
                        call_id=context.call_id,
                        cached=True
                    )
                    return cached_response
            
            # Generate new response
            response = await self._generate_new_response(context, user_profile)
            
            # Cache the response
            await self._cache_response(context, user_profile, response)
            
            # Update performance metrics
            self.total_requests += 1
            processing_time = (datetime.utcnow() - start_time).total_seconds() * 1000
            self.avg_response_time = (
                (self.avg_response_time * (self.total_requests - 1) + processing_time) / 
                self.total_requests
            )
            
            logger.info(
                "Generated new AI response",
                call_id=context.call_id,
                processing_time_ms=processing_time,
                cached=False
            )
            
            return response
            
        except Exception as e:
            logger.error(
                "Failed to generate AI response",
                call_id=context.call_id,
                error=str(e)
            )
            # Return fallback response
            return await self._get_fallback_response(context, user_profile)
    
    async def _generate_new_response(
        self,
        context: ConversationContext,
        user_profile: Optional[UserProfileData] = None
    ) -> AIResponse:
        """Generate a new AI response using Azure OpenAI."""
        
        # Build personalized prompt
        prompt = await self._build_personalized_prompt(context, user_profile)
        
        # Determine response parameters
        temperature, max_tokens = self._get_response_parameters(context, user_profile)
        
        try:
            # Call Azure OpenAI
            response = await self.client.chat.completions.create(
                model=self.deployment_name,
                messages=[
                    {
                        "role": "system",
                        "content": prompt["system_prompt"]
                    },
                    {
                        "role": "user", 
                        "content": prompt["user_prompt"]
                    }
                ],
                temperature=temperature,
                max_tokens=max_tokens,
                top_p=0.9,
                frequency_penalty=0.1,
                presence_penalty=0.1
            )
            
            # Extract response text
            response_text = response.choices[0].message.content.strip()
            
            # Analyze the response
            analysis = await self._analyze_response(response_text, context)
            
            # Build AIResponse object
            ai_response = AIResponse(
                text=response_text,
                intent=analysis["intent"],
                confidence=analysis["confidence"],
                emotional_tone=analysis["emotional_tone"],
                response_strategy=analysis["strategy"],
                should_terminate=analysis["should_terminate"],
                next_stage=analysis["next_stage"],
                generation_time_ms=analysis["generation_time_ms"],
                cached=False,
                context_hash=self._generate_context_hash(context, user_profile),
                model_version=self.deployment_name,
                temperature=temperature
            )
            
            return ai_response
            
        except Exception as e:
            logger.error(
                "Azure OpenAI API call failed",
                call_id=context.call_id,
                error=str(e)
            )
            raise
    
    async def _build_personalized_prompt(
        self,
        context: ConversationContext,
        user_profile: Optional[UserProfileData] = None
    ) -> Dict[str, str]:
        """Build personalized prompt based on context and user profile."""
        
        # Default profile if none provided
        if not user_profile:
            user_profile = UserProfileData(
                user_id=context.user_id,
                name="用户",
                phone_number=context.caller_phone,
                personality_type=PersonalityType.POLITE,
                speech_style=SpeechStyle.FRIENDLY
            )
        
        # Get conversation history summary
        history_summary = self._summarize_conversation_history(context.conversation_history)
        
        # Determine current intent and emotional state
        current_intent = self._analyze_current_intent(context)
        caller_emotional_state = self._analyze_caller_emotion(context)
        
        # Build system prompt
        system_prompt = f"""
你是{user_profile.name}的AI助手，正在代替他们接听一个{current_intent.value}类型的电话。

个人特征：
- 性格类型：{user_profile.personality_type.value}
- 说话风格：{user_profile.speech_style.value}
- 职业：{user_profile.occupation or '普通用户'}

当前对话状态：
- 对话阶段：{context.current_stage.value}
- 情感状态：{context.emotional_state.value}
- 对话轮次：{context.turn_count}

来电者信息：
- 电话类型：{context.spam_category or '未知类型'}骚扰电话
- 来电者情绪：{caller_emotional_state.value}
- 坚持程度：{'较高' if context.turn_count > 3 else '一般'}

对话历史：
{history_summary}

回复要求：
1. 保持{user_profile.personality_type.value}的性格特征
2. 使用{user_profile.speech_style.value}的说话风格
3. 回复长度控制在{self._get_response_length_guideline(user_profile)}字以内
4. 根据来电者的坚持程度调整回复策略
5. 如果对话已经进行多轮且无效，可以考虑结束对话

请生成一个自然、得体的回复。
"""
        
        # Build user prompt with latest message
        latest_message = context.conversation_history[-1] if context.conversation_history else None
        user_prompt = f"""
来电者刚刚说："{latest_message.text if latest_message else '你好'}"

请根据上述context生成适当的回复。回复应该：
- 体现{user_profile.name}的个性特征
- 适合当前对话阶段
- 考虑来电者的情绪状态
- 如果需要，可以礼貌地结束对话

请只返回回复内容，不要包含其他解释。
"""
        
        return {
            "system_prompt": system_prompt.strip(),
            "user_prompt": user_prompt.strip()
        }
    
    def _summarize_conversation_history(self, history: List[Any]) -> str:
        """Summarize conversation history for prompt context."""
        if not history:
            return "这是对话的开始。"
        
        if len(history) <= 3:
            # Show recent messages for short conversations
            summary = "最近的对话：\n"
            for msg in history[-3:]:
                speaker = "来电者" if msg.speaker == "user" else "我"
                summary += f"{speaker}：{msg.text}\n"
            return summary.strip()
        else:
            # Summarize longer conversations
            user_messages = [msg for msg in history if msg.speaker == "user"]
            ai_messages = [msg for msg in history if msg.speaker == "ai"]
            
            summary = f"""
对话已进行{len(history)}轮。
来电者主要表达：{user_messages[-1].text if user_messages else '未知'}
我的回复策略：{'坚持拒绝' if len(history) > 5 else '礼貌回应'}
对话趋势：{'来电者较为坚持' if len(history) > 6 else '正常交流'}
            """
            return summary.strip()
    
    def _analyze_current_intent(self, context: ConversationContext) -> IntentCategory:
        """Analyze current conversation intent."""
        if context.conversation_history:
            last_message = context.conversation_history[-1]
            if last_message.intent:
                return last_message.intent
        
        # Fallback based on spam category
        if context.spam_category:
            intent_mapping = {
                "sales": IntentCategory.SALES_CALL,
                "loan": IntentCategory.LOAN_OFFER,
                "investment": IntentCategory.INVESTMENT_PITCH,
                "insurance": IntentCategory.INSURANCE_SALES
            }
            return intent_mapping.get(context.spam_category.lower(), IntentCategory.UNKNOWN)
        
        return IntentCategory.UNKNOWN
    
    def _analyze_caller_emotion(self, context: ConversationContext) -> EmotionalState:
        """Analyze caller's emotional state based on conversation."""
        if not context.conversation_history:
            return EmotionalState.NEUTRAL
        
        # Simple heuristic based on conversation length and persistence
        if context.turn_count > 8:
            return EmotionalState.FRUSTRATED
        elif context.turn_count > 5:
            return EmotionalState.ANNOYED
        elif context.turn_count > 2:
            return EmotionalState.PATIENT
        else:
            return EmotionalState.FRIENDLY
    
    def _get_response_length_guideline(self, user_profile: UserProfileData) -> int:
        """Get response length guideline based on user profile."""
        if user_profile.speech_style == SpeechStyle.BRIEF:
            return 20
        elif user_profile.speech_style == SpeechStyle.DETAILED:
            return 80
        else:
            return 40
    
    def _get_response_parameters(
        self,
        context: ConversationContext,
        user_profile: Optional[UserProfileData] = None
    ) -> Tuple[float, int]:
        """Get temperature and max_tokens parameters for response generation."""
        
        # Base parameters
        temperature = self.default_temperature
        max_tokens = self.default_max_tokens
        
        # Adjust based on user profile
        if user_profile:
            if user_profile.personality_type == PersonalityType.HUMOROUS:
                temperature = min(temperature + 0.2, 1.0)  # More creative
            elif user_profile.personality_type == PersonalityType.PROFESSIONAL:
                temperature = max(temperature - 0.2, 0.1)  # More consistent
            
            if user_profile.speech_style == SpeechStyle.BRIEF:
                max_tokens = min(max_tokens, 50)
            elif user_profile.speech_style == SpeechStyle.DETAILED:
                max_tokens = min(max_tokens * 2, 300)
        
        # Adjust based on conversation stage
        if context.current_stage in [ConversationStage.FIRM_REJECTION, ConversationStage.HANG_UP_WARNING]:
            temperature = max(temperature - 0.1, 0.1)  # More consistent for firm responses
        
        return temperature, max_tokens
    
    async def _analyze_response(
        self,
        response_text: str,
        context: ConversationContext
    ) -> Dict[str, Any]:
        """Analyze generated response for metadata."""
        start_time = datetime.utcnow()
        
        # Simple rule-based analysis (could be enhanced with ML)
        analysis = {
            "intent": self._analyze_current_intent(context),
            "confidence": 0.8,  # Default confidence
            "emotional_tone": EmotionalState.POLITE,
            "strategy": "polite_decline",
            "should_terminate": False,
            "next_stage": context.current_stage,
            "generation_time_ms": 0.0
        }
        
        # Analyze emotional tone from response text
        if any(word in response_text for word in ["不需要", "不感兴趣", "不考虑"]):
            analysis["emotional_tone"] = EmotionalState.FIRM
        elif any(word in response_text for word in ["谢谢", "感谢", "抱歉"]):
            analysis["emotional_tone"] = EmotionalState.POLITE
        elif any(word in response_text for word in ["哈哈", "开玩笑"]):
            analysis["emotional_tone"] = EmotionalState.FRIENDLY
        
        # Determine if conversation should terminate
        termination_phrases = ["再见", "挂了", "不要再", "请停止", "结束"]
        if any(phrase in response_text for phrase in termination_phrases):
            analysis["should_terminate"] = True
            analysis["next_stage"] = ConversationStage.CALL_END
        elif context.turn_count >= 8:
            analysis["should_terminate"] = True
            analysis["next_stage"] = ConversationStage.HANG_UP_WARNING
        
        # Set strategy based on response content
        if "专业" in response_text or "规划" in response_text:
            analysis["strategy"] = "professional_response"
        elif "幽默" in response_text or "开玩笑" in response_text:
            analysis["strategy"] = "humor_deflection"
        elif "坚决" in response_text or "明确" in response_text:
            analysis["strategy"] = "firm_rejection"
        
        analysis["generation_time_ms"] = (datetime.utcnow() - start_time).total_seconds() * 1000
        
        return analysis
    
    async def _get_cached_response(
        self,
        context: ConversationContext,
        user_profile: Optional[UserProfileData] = None
    ) -> Optional[AIResponse]:
        """Get cached response if available."""
        try:
            context_hash = self._generate_context_hash(context, user_profile)
            intent = self._analyze_current_intent(context)
            
            cached_response = await conversation_cache.get_cached_response(
                intent.value,
                context_hash
            )
            
            if cached_response:
                # Convert cached dict back to AIResponse
                cached_response["cached"] = True
                cached_response["generation_time_ms"] = 1.0  # Very fast cache retrieval
                return AIResponse(**cached_response)
            
        except Exception as e:
            logger.warning(
                "Failed to retrieve cached response",
                call_id=context.call_id,
                error=str(e)
            )
        
        return None
    
    async def _cache_response(
        self,
        context: ConversationContext,
        user_profile: Optional[UserProfileData],
        response: AIResponse
    ) -> None:
        """Cache the generated response."""
        try:
            context_hash = self._generate_context_hash(context, user_profile)
            intent = self._analyze_current_intent(context)
            
            # Convert response to dict for caching
            response_dict = response.dict()
            response_dict["cached"] = False  # Mark as original
            
            await conversation_cache.set_cached_response(
                intent.value,
                context_hash,
                response_dict,
                ttl=settings.cache_ttl_seconds
            )
            
        except Exception as e:
            logger.warning(
                "Failed to cache response",
                call_id=context.call_id,
                error=str(e)
            )
    
    def _generate_context_hash(
        self,
        context: ConversationContext,
        user_profile: Optional[UserProfileData] = None
    ) -> str:
        """Generate hash for context-based caching."""
        hash_data = {
            "intent": self._analyze_current_intent(context).value,
            "stage": context.current_stage.value,
            "turn_count_range": min(context.turn_count // 3, 5),  # Group by turn ranges
            "personality": user_profile.personality_type.value if user_profile else "polite",
            "speech_style": user_profile.speech_style.value if user_profile else "friendly",
            "spam_category": context.spam_category or "unknown"
        }
        
        hash_string = json.dumps(hash_data, sort_keys=True)
        return hashlib.md5(hash_string.encode()).hexdigest()
    
    async def _get_fallback_response(
        self,
        context: ConversationContext,
        user_profile: Optional[UserProfileData] = None
    ) -> AIResponse:
        """Get fallback response when AI generation fails."""
        
        # Use template-based response as fallback
        intent = self._analyze_current_intent(context)
        personality = user_profile.personality_type.value if user_profile else "polite"
        
        templates = self.response_templates.get(intent.value, {})
        responses = templates.get(personality, templates.get("polite", ["很抱歉，我现在不方便。"]))
        
        # Select response based on conversation history
        response_index = min(len(context.conversation_history) // 2, len(responses) - 1)
        response_text = responses[response_index]
        
        return AIResponse(
            text=response_text,
            intent=intent,
            confidence=0.6,  # Lower confidence for fallback
            emotional_tone=EmotionalState.POLITE,
            response_strategy="template_fallback",
            should_terminate=context.turn_count >= 6,
            next_stage=ConversationStage.CALL_END if context.turn_count >= 6 else context.current_stage,
            generation_time_ms=5.0,  # Fast fallback
            cached=False,
            context_hash=self._generate_context_hash(context, user_profile),
            model_version="fallback",
            temperature=0.0
        )
    
    async def get_performance_metrics(self) -> Dict[str, Any]:
        """Get service performance metrics."""
        cache_hit_rate = self.cache_hits / max(self.total_requests, 1)
        
        return {
            "total_requests": self.total_requests,
            "cache_hits": self.cache_hits,
            "cache_hit_rate": cache_hit_rate,
            "avg_response_time_ms": self.avg_response_time,
            "service_status": "healthy"
        }
    
    async def warmup_cache(self, user_profiles: List[UserProfileData]) -> None:
        """Warm up cache with common responses for user profiles."""
        logger.info("Starting cache warmup", profiles_count=len(user_profiles))
        
        for profile in user_profiles:
            try:
                # Create sample contexts for common scenarios
                common_scenarios = [
                    (IntentCategory.SALES_CALL, ConversationStage.INITIAL),
                    (IntentCategory.LOAN_OFFER, ConversationStage.INITIAL),
                    (IntentCategory.INVESTMENT_PITCH, ConversationStage.INITIAL),
                    (IntentCategory.SALES_CALL, ConversationStage.HANDLING_SALES),
                ]
                
                for intent, stage in common_scenarios:
                    context = ConversationContext(
                        call_id=f"warmup_{profile.user_id}_{intent.value}_{stage.value}",
                        user_id=profile.user_id,
                        caller_phone="1234567890",
                        current_stage=stage,
                        spam_category=intent.value
                    )
                    
                    # Generate and cache response
                    await self.generate_response(context, profile)
                    
                    # Small delay to avoid overwhelming the API
                    await asyncio.sleep(0.1)
                    
            except Exception as e:
                logger.warning(
                    "Cache warmup failed for profile",
                    user_id=str(profile.user_id),
                    error=str(e)
                )
        
        logger.info("Cache warmup completed")


# Global service instance
azure_openai_service = AzureOpenAIService()
