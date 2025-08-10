"""
Personalized Response Generator Service
Generates context-aware, personality-driven responses with emotional control
"""

import asyncio
import hashlib
import json
import random
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime
from enum import Enum
import structlog

from ..core.config import settings
from ..core.cache import conversation_cache
from ..models.conversation import (
    ConversationContext, EmotionalState, IntentCategory,
    ConversationStage, AIResponse
)
from ..models.user import UserProfileData, PersonalityType, SpeechStyle
from .azure_openai import azure_openai_service

logger = structlog.get_logger(__name__)


class ResponseTemplate:
    """Response template structure"""
    def __init__(self, template: str, variables: List[str] = None):
        self.template = template
        self.variables = variables or []
    
    def render(self, **kwargs) -> str:
        """Render template with variables"""
        result = self.template
        for var in self.variables:
            if var in kwargs:
                result = result.replace(f"{{{var}}}", str(kwargs[var]))
        return result


class PersonalizedResponseGenerator:
    """
    Advanced response generation engine with personality adaptation
    and emotional tone control
    """
    
    def __init__(self):
        self.template_engine = ResponseTemplateEngine()
        self.emotion_controller = EmotionController()
        self.personality_adapter = PersonalityAdapter()
        
        # Response cache for common scenarios
        self.response_cache = {}
        
        # Performance tracking
        self.total_generations = 0
        self.cache_hits = 0
        self.avg_generation_time = 0.0
    
    async def generate_personalized_response(
        self,
        strategy: Any,  # ResponseStrategy from conversation_manager
        context: ConversationContext,
        user_profile: Optional[UserProfileData],
        intent_result: Any  # IntentResult from intent_classifier
    ) -> AIResponse:
        """Generate personalized response based on strategy and context"""
        start_time = datetime.utcnow()
        
        try:
            # Check cache first
            cached_response = await self._get_cached_response(
                strategy, context, user_profile, intent_result
            )
            if cached_response:
                self.cache_hits += 1
                return cached_response
            
            # Build personalized prompt
            prompt = await self._build_personalized_prompt(
                strategy, context, user_profile, intent_result
            )
            
            # Generate base response
            base_response = await self._generate_base_response(prompt, context)
            
            # Apply personality filters
            personalized_response = await self.personality_adapter.apply_personality(
                base_response,
                user_profile
            )
            
            # Apply emotional adjustments
            emotionally_adjusted = await self.emotion_controller.adjust_emotional_tone(
                personalized_response,
                context.emotional_state,
                intent_result.emotional_tone if hasattr(intent_result, 'emotional_tone') else None
            )
            
            # Create final response
            ai_response = AIResponse(
                text=emotionally_adjusted,
                intent=intent_result.intent if hasattr(intent_result, 'intent') else IntentCategory.UNKNOWN,
                confidence=self._calculate_response_confidence(strategy, intent_result),
                emotional_tone=self._determine_emotional_tone(emotionally_adjusted),
                response_strategy=strategy.value if hasattr(strategy, 'value') else str(strategy),
                should_terminate=self._should_terminate(strategy, context),
                next_stage=self._determine_next_stage(strategy, context),
                generation_time_ms=(datetime.utcnow() - start_time).total_seconds() * 1000,
                cached=False,
                context_hash=self._generate_context_hash(strategy, context, user_profile),
                model_version="personalized_v1",
                temperature=0.7
            )
            
            # Cache the response
            await self._cache_response(
                strategy, context, user_profile, intent_result, ai_response
            )
            
            # Update metrics
            self._update_metrics(start_time)
            
            logger.info(
                "Generated personalized response",
                strategy=str(strategy),
                personality=user_profile.personality_type.value if user_profile else "default",
                generation_time_ms=ai_response.generation_time_ms
            )
            
            return ai_response
            
        except Exception as e:
            logger.error("Response generation failed", error=str(e))
            return await self._get_fallback_response(strategy, context, user_profile)
    
    async def _build_personalized_prompt(
        self,
        strategy: Any,
        context: ConversationContext,
        user_profile: Optional[UserProfileData],
        intent_result: Any
    ) -> Dict[str, str]:
        """Build personalized prompt for response generation"""
        
        # Default profile if none provided
        if not user_profile:
            user_profile = UserProfileData(
                user_id=context.user_id,
                name="用户",
                phone_number="",
                personality_type=PersonalityType.POLITE,
                speech_style=SpeechStyle.FRIENDLY
            )
        
        # Get strategy description
        strategy_description = self._get_strategy_description(strategy)
        
        # Get response length guideline
        response_length = self._get_response_length(user_profile.speech_style)
        
        system_prompt = f"""
你是{user_profile.name}的AI助手，正在帮助他们应对骚扰电话。

用户个性特征：
- 性格类型：{user_profile.personality_type.value}
- 说话风格：{user_profile.speech_style.value}
- 职业背景：{user_profile.occupation or '普通用户'}

当前情况：
- 来电类型：{intent_result.intent.value if hasattr(intent_result, 'intent') else '未知'}
- 对话阶段：{context.current_stage.value}
- 对话轮次：{context.turn_count}
- 来电者情绪：{intent_result.emotional_tone if hasattr(intent_result, 'emotional_tone') else '中性'}

响应策略：{strategy_description}

要求：
1. 保持{user_profile.personality_type.value}的性格特征
2. 使用{user_profile.speech_style.value}的语言风格
3. 回复长度：{response_length}字以内
4. 执行{strategy_description}策略
5. 保持自然、真实的对话风格
"""
        
        user_prompt = f"""
根据上述要求，生成一个符合策略的回复。

策略细节：
- 目标：{self._get_strategy_goal(strategy)}
- 语气：{self._get_strategy_tone(strategy)}
- 关键点：{self._get_strategy_key_points(strategy)}

请直接返回回复内容，不要包含解释或标记。
"""
        
        return {
            "system_prompt": system_prompt.strip(),
            "user_prompt": user_prompt.strip()
        }
    
    async def _generate_base_response(
        self,
        prompt: Dict[str, str],
        context: ConversationContext
    ) -> str:
        """Generate base response using Azure OpenAI or templates"""
        try:
            # Try Azure OpenAI first
            response = await azure_openai_service._generate_new_response(
                context,
                None  # User profile handled separately
            )
            return response.text
        except Exception as e:
            logger.warning("Azure OpenAI generation failed, using templates", error=str(e))
            # Fallback to templates
            return await self.template_engine.generate_from_template(
                context.current_stage,
                context.spam_category
            )
    
    def _get_strategy_description(self, strategy: Any) -> str:
        """Get human-readable strategy description"""
        strategy_descriptions = {
            "gentle_decline": "礼貌委婉地拒绝",
            "firm_decline": "坚决明确地拒绝",
            "witty_response": "用幽默化解尴尬",
            "explain_not_interested": "解释为什么不感兴趣",
            "clear_refusal": "清晰直接地拒绝",
            "deflect_with_humor": "用幽默转移话题",
            "professional_response": "专业理性地回应",
            "final_warning": "最后警告",
            "immediate_hangup": "立即结束对话"
        }
        
        strategy_name = strategy.value if hasattr(strategy, 'value') else str(strategy)
        return strategy_descriptions.get(strategy_name, "礼貌回应")
    
    def _get_strategy_goal(self, strategy: Any) -> str:
        """Get strategy goal"""
        strategy_goals = {
            "gentle_decline": "让对方理解你的立场，但不伤害感情",
            "firm_decline": "明确表达拒绝，不留余地",
            "witty_response": "缓和气氛，轻松结束对话",
            "explain_not_interested": "理性说明原因，让对方接受",
            "clear_refusal": "直接拒绝，节省双方时间",
            "deflect_with_humor": "转移注意力，避免正面冲突",
            "professional_response": "展现专业素养，理性沟通",
            "final_warning": "严肃警告，准备结束",
            "immediate_hangup": "立即结束对话"
        }
        
        strategy_name = strategy.value if hasattr(strategy, 'value') else str(strategy)
        return strategy_goals.get(strategy_name, "礼貌结束对话")
    
    def _get_strategy_tone(self, strategy: Any) -> str:
        """Get strategy tone"""
        strategy_tones = {
            "gentle_decline": "温和友善",
            "firm_decline": "坚定严肃",
            "witty_response": "轻松幽默",
            "explain_not_interested": "理性平和",
            "clear_refusal": "直接明确",
            "deflect_with_humor": "诙谐有趣",
            "professional_response": "专业冷静",
            "final_warning": "严肃警告",
            "immediate_hangup": "果断终止"
        }
        
        strategy_name = strategy.value if hasattr(strategy, 'value') else str(strategy)
        return strategy_tones.get(strategy_name, "中性礼貌")
    
    def _get_strategy_key_points(self, strategy: Any) -> str:
        """Get strategy key points"""
        strategy_points = {
            "gentle_decline": "表达感谢，说明不便，委婉拒绝",
            "firm_decline": "明确拒绝，要求停止，不留余地",
            "witty_response": "幽默回应，化解尴尬，轻松告别",
            "explain_not_interested": "说明原因，表达立场，理性沟通",
            "clear_refusal": "直接说不，简洁明了，节省时间",
            "deflect_with_humor": "开个玩笑，转移话题，友好结束",
            "professional_response": "专业分析，理性判断，礼貌回绝",
            "final_warning": "严正声明，最后通牒，准备挂断",
            "immediate_hangup": "结束对话，不再纠缠"
        }
        
        strategy_name = strategy.value if hasattr(strategy, 'value') else str(strategy)
        return strategy_points.get(strategy_name, "礼貌拒绝，结束对话")
    
    def _get_response_length(self, speech_style: SpeechStyle) -> int:
        """Get response length based on speech style"""
        length_map = {
            SpeechStyle.BRIEF: 20,
            SpeechStyle.NORMAL: 40,
            SpeechStyle.DETAILED: 80,
            SpeechStyle.ELABORATE: 120,
            SpeechStyle.FRIENDLY: 50,
            SpeechStyle.FORMAL: 60
        }
        return length_map.get(speech_style, 40)
    
    def _calculate_response_confidence(self, strategy: Any, intent_result: Any) -> float:
        """Calculate response confidence"""
        base_confidence = 0.8
        
        # Adjust based on intent confidence
        if hasattr(intent_result, 'confidence'):
            base_confidence = (base_confidence + intent_result.confidence) / 2
        
        # Adjust based on strategy
        strategy_name = strategy.value if hasattr(strategy, 'value') else str(strategy)
        if "final" in strategy_name or "immediate" in strategy_name:
            base_confidence = min(base_confidence + 0.1, 1.0)
        
        return base_confidence
    
    def _determine_emotional_tone(self, response_text: str) -> EmotionalState:
        """Determine emotional tone from response text"""
        text_lower = response_text.lower()
        
        if any(word in text_lower for word in ["抱歉", "不好意思", "谢谢"]):
            return EmotionalState.POLITE
        elif any(word in text_lower for word in ["坚决", "明确", "停止"]):
            return EmotionalState.FIRM
        elif any(word in text_lower for word in ["哈哈", "开玩笑", "有趣"]):
            return EmotionalState.FRIENDLY
        elif any(word in text_lower for word in ["警告", "投诉", "骚扰"]):
            return EmotionalState.AGGRESSIVE
        else:
            return EmotionalState.NEUTRAL
    
    def _should_terminate(self, strategy: Any, context: ConversationContext) -> bool:
        """Determine if conversation should terminate"""
        strategy_name = strategy.value if hasattr(strategy, 'value') else str(strategy)
        
        # Immediate termination strategies
        if strategy_name in ["immediate_hangup", "final_warning"]:
            return True
        
        # Turn count based termination
        if context.turn_count >= 8:
            return True
        
        return False
    
    def _determine_next_stage(
        self,
        strategy: Any,
        context: ConversationContext
    ) -> ConversationStage:
        """Determine next conversation stage"""
        strategy_name = strategy.value if hasattr(strategy, 'value') else str(strategy)
        
        if strategy_name == "immediate_hangup":
            return ConversationStage.CALL_END
        elif strategy_name == "final_warning":
            return ConversationStage.HANG_UP_WARNING
        elif "firm" in strategy_name:
            return ConversationStage.FIRM_REJECTION
        elif "gentle" in strategy_name or "polite" in strategy_name:
            return ConversationStage.POLITE_DECLINE
        
        return context.current_stage
    
    def _generate_context_hash(
        self,
        strategy: Any,
        context: ConversationContext,
        user_profile: Optional[UserProfileData]
    ) -> str:
        """Generate hash for caching"""
        hash_data = {
            "strategy": str(strategy),
            "stage": context.current_stage.value,
            "turn_range": context.turn_count // 3,
            "personality": user_profile.personality_type.value if user_profile else "default",
            "speech_style": user_profile.speech_style.value if user_profile else "normal"
        }
        
        hash_string = json.dumps(hash_data, sort_keys=True)
        return hashlib.md5(hash_string.encode()).hexdigest()
    
    async def _get_cached_response(
        self,
        strategy: Any,
        context: ConversationContext,
        user_profile: Optional[UserProfileData],
        intent_result: Any
    ) -> Optional[AIResponse]:
        """Get cached response if available"""
        try:
            cache_key = f"response:{self._generate_context_hash(strategy, context, user_profile)}"
            cached = await conversation_cache.get(cache_key)
            
            if cached:
                response_dict = json.loads(cached)
                return AIResponse(**response_dict)
        except Exception as e:
            logger.warning("Cache retrieval failed", error=str(e))
        
        return None
    
    async def _cache_response(
        self,
        strategy: Any,
        context: ConversationContext,
        user_profile: Optional[UserProfileData],
        intent_result: Any,
        response: AIResponse
    ) -> None:
        """Cache generated response"""
        try:
            cache_key = f"response:{self._generate_context_hash(strategy, context, user_profile)}"
            await conversation_cache.set(
                cache_key,
                json.dumps(response.dict()),
                ttl=3600  # 1 hour
            )
        except Exception as e:
            logger.warning("Cache storage failed", error=str(e))
    
    async def _get_fallback_response(
        self,
        strategy: Any,
        context: ConversationContext,
        user_profile: Optional[UserProfileData]
    ) -> AIResponse:
        """Get fallback response when generation fails"""
        fallback_text = await self.template_engine.get_fallback_response(
            context.current_stage,
            context.spam_category
        )
        
        return AIResponse(
            text=fallback_text,
            intent=IntentCategory.UNKNOWN,
            confidence=0.5,
            emotional_tone=EmotionalState.POLITE,
            response_strategy=str(strategy),
            should_terminate=context.turn_count >= 6,
            next_stage=context.current_stage,
            generation_time_ms=10.0,
            cached=False,
            context_hash="fallback",
            model_version="fallback",
            temperature=0.0
        )
    
    def _update_metrics(self, start_time: datetime) -> None:
        """Update performance metrics"""
        self.total_generations += 1
        generation_time = (datetime.utcnow() - start_time).total_seconds() * 1000
        
        self.avg_generation_time = (
            (self.avg_generation_time * (self.total_generations - 1) + generation_time) /
            self.total_generations
        )


class ResponseTemplateEngine:
    """Template-based response generation"""
    
    def __init__(self):
        self.templates = self._initialize_templates()
    
    def _initialize_templates(self) -> Dict[str, Dict[str, List[str]]]:
        """Initialize response templates"""
        return {
            ConversationStage.INITIAL: {
                "sales": [
                    "谢谢您的来电，但我现在不太方便。",
                    "不好意思，我正在忙，稍后再说。",
                    "感谢您的介绍，但我暂时不需要。"
                ],
                "loan": [
                    "谢谢，我目前没有贷款需求。",
                    "我的财务状况良好，不需要贷款。",
                    "感谢您的好意，但我不考虑贷款。"
                ],
                "investment": [
                    "我有自己的投资规划，谢谢。",
                    "投资的事情我会自己考虑的。",
                    "谢谢介绍，但我不感兴趣。"
                ]
            },
            ConversationStage.POLITE_DECLINE: {
                "default": [
                    "真的谢谢您，但我确实不需要。",
                    "我理解您的工作，但请理解我的选择。",
                    "很感谢您的耐心，但我真的不考虑。"
                ]
            },
            ConversationStage.FIRM_REJECTION: {
                "default": [
                    "我已经说得很清楚了，请不要再打扰。",
                    "请将我的号码从你们的名单中删除。",
                    "我不需要这些服务，请停止拨打。"
                ]
            }
        }
    
    async def generate_from_template(
        self,
        stage: ConversationStage,
        category: Optional[str]
    ) -> str:
        """Generate response from templates"""
        stage_templates = self.templates.get(stage, {})
        category_templates = stage_templates.get(category or "default", stage_templates.get("default", []))
        
        if category_templates:
            return random.choice(category_templates)
        
        return "不好意思，我现在不方便。"
    
    async def get_fallback_response(
        self,
        stage: ConversationStage,
        category: Optional[str]
    ) -> str:
        """Get fallback response"""
        return await self.generate_from_template(stage, category)


class EmotionController:
    """Control and adjust emotional tone of responses"""
    
    async def adjust_emotional_tone(
        self,
        response_text: str,
        user_emotion: EmotionalState,
        caller_emotion: Optional[str]
    ) -> str:
        """Adjust response emotional tone"""
        
        # If caller is aggressive, stay calm but firm
        if caller_emotion == "aggressive":
            return self._make_firm_but_calm(response_text)
        
        # If caller is persistent, be more direct
        elif caller_emotion == "persistent":
            return self._make_more_direct(response_text)
        
        # If caller is friendly, maintain friendliness
        elif caller_emotion == "friendly":
            return self._make_friendly(response_text)
        
        return response_text
    
    def _make_firm_but_calm(self, text: str) -> str:
        """Make response firm but calm"""
        replacements = {
            "可能": "",
            "也许": "",
            "或许": "",
            "不太": "不",
            "暂时": ""
        }
        
        result = text
        for old, new in replacements.items():
            result = result.replace(old, new)
        
        return result
    
    def _make_more_direct(self, text: str) -> str:
        """Make response more direct"""
        if "谢谢" in text:
            return text.replace("谢谢您的", "").replace("谢谢", "")
        return text
    
    def _make_friendly(self, text: str) -> str:
        """Make response more friendly"""
        if not text.startswith("谢谢"):
            return "谢谢您，" + text
        return text


class PersonalityAdapter:
    """Adapt responses to user personality"""
    
    async def apply_personality(
        self,
        response_text: str,
        user_profile: Optional[UserProfileData]
    ) -> str:
        """Apply personality adaptations to response"""
        if not user_profile:
            return response_text
        
        personality_filters = {
            PersonalityType.POLITE: self._ensure_politeness,
            PersonalityType.DIRECT: self._make_more_direct,
            PersonalityType.HUMOROUS: self._add_humor,
            PersonalityType.PROFESSIONAL: self._add_professional_tone
        }
        
        filter_func = personality_filters.get(
            user_profile.personality_type,
            lambda x: x
        )
        
        return filter_func(response_text)
    
    def _ensure_politeness(self, text: str) -> str:
        """Ensure response is polite"""
        polite_replacements = {
            "不要": "请不要",
            "不想": "暂时不想",
            "没兴趣": "不太感兴趣",
            "不需要": "暂时不需要"
        }
        
        result = text
        for harsh, polite in polite_replacements.items():
            result = result.replace(harsh, polite)
        
        return result
    
    def _make_more_direct(self, text: str) -> str:
        """Make response more direct"""
        direct_replacements = {
            "暂时不需要": "不需要",
            "不太感兴趣": "不感兴趣",
            "可能": "",
            "也许": ""
        }
        
        result = text
        for soft, direct in direct_replacements.items():
            result = result.replace(soft, direct)
        
        return result
    
    def _add_humor(self, text: str) -> str:
        """Add humor to response"""
        humor_additions = [
            "哈哈，",
            "说笑了，",
            "开个玩笑，"
        ]
        
        if not any(h in text for h in humor_additions):
            return random.choice(humor_additions) + text
        
        return text
    
    def _add_professional_tone(self, text: str) -> str:
        """Add professional tone to response"""
        professional_replacements = {
            "我": "本人",
            "不需要": "暂无此需求",
            "不感兴趣": "暂不考虑",
            "没有": "暂无"
        }
        
        result = text
        for casual, professional in professional_replacements.items():
            result = result.replace(casual, professional)
        
        return result


# Global response generator instance
response_generator = PersonalizedResponseGenerator()