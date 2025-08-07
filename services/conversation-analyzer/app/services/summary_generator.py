"""Intelligent summary generation for call analysis."""

import asyncio
import json
import time
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime

import openai
from openai import AsyncAzureOpenAI

from app.core.config import settings
from app.core.logging import get_logger, analysis_logger
from app.models.analysis import CallSummary, CallEffectivenessMetrics
from app.services.effectiveness_evaluator import effectiveness_evaluator

logger = get_logger(__name__)


class SummaryGenerator:
    """Generates intelligent summaries of call conversations."""
    
    def __init__(self):
        self.openai_client = AsyncAzureOpenAI(
            api_version=settings.azure_openai_api_version,
            azure_endpoint=settings.azure_openai_endpoint,
            api_key=settings.azure_openai_api_key
        )
        self.deployment_name = settings.azure_openai_deployment_name
        self.summary_templates = self._load_summary_templates()
    
    def _load_summary_templates(self) -> Dict[str, str]:
        """Load summary generation templates."""
        return {
            "comprehensive": """
请基于以下通话记录生成一份详细的分析总结：

**通话信息：**
- 通话时长：{duration}秒
- 来电者：{caller_phone}
- 对话轮次：{turn_count}轮

**对话内容：**
{conversation_text}

**分析数据：**
- 意图识别：{intent_analysis}
- 情感分析：{sentiment_analysis}
- 关键词：{keywords}
- 实体识别：{entities}

请生成包含以下内容的总结：
1. **通话概述**：简洁描述通话的主要内容和目的
2. **关键事件**：列出通话中的重要转折点或关键对话
3. **来电者意图**：明确来电者的主要目的和诉求
4. **AI回应评价**：评估AI的回应质量和效果
5. **通话结果**：描述通话的结束方式和结果
6. **改进建议**：针对AI回应提出具体的优化建议

请用简洁专业的中文回复，确保总结准确且有实用价值。
            """,
            
            "brief": """
基于以下通话记录，请生成简洁总结：

通话时长：{duration}秒，对话{turn_count}轮
来电者：{caller_phone}
主要内容：{conversation_summary}
意图：{main_intent}
结果：{outcome}

请生成包含以下要点的简短总结（不超过200字）：
- 通话目的
- AI处理效果
- 主要结果
- 关键建议
            """,
            
            "detailed": """
请基于通话数据生成详细分析报告：

**基础信息：**
通话ID：{call_id}
通话时长：{duration}秒
对话轮次：{turn_count}轮
来电者：{caller_phone}

**完整对话记录：**
{full_conversation}

**深度分析数据：**
{detailed_analysis}

**效果评估：**
{effectiveness_metrics}

请生成详细的分析报告，包括：
1. **执行摘要**：整体情况概述
2. **对话流程分析**：详细的对话进展分析
3. **意图和情感变化轨迹**：追踪整个对话过程中的变化
4. **AI性能分析**：响应质量、延迟、适当性评估
5. **成功因素**：识别表现良好的方面
6. **改进机会**：具体的优化建议
7. **学习要点**：可用于改进系统的关键洞察

请提供深入、可操作的分析。
            """
        }
    
    async def generate_call_summary(
        self,
        call_id: str,
        user_id: str,
        conversations: List[Dict[str, Any]],
        analysis_results: Dict[str, Any],
        style: str = "comprehensive",
        include_recommendations: bool = True,
        include_metrics: bool = True
    ) -> CallSummary:
        """Generate comprehensive call summary."""
        analysis_logger.log_analysis_start(call_id, "summary_generation")
        start_time = time.time()
        
        try:
            # Gather additional data
            call_context = await self._gather_call_context(call_id, user_id, conversations)
            
            # Generate effectiveness metrics if requested
            effectiveness_metrics = None
            if include_metrics:
                effectiveness_metrics = await effectiveness_evaluator.evaluate_call_effectiveness(
                    call_id, user_id
                )
            
            # Prepare data for summary generation
            summary_data = await self._prepare_summary_data(
                call_context, conversations, analysis_results, effectiveness_metrics
            )
            
            # Generate main summary text
            summary_text = await self._generate_summary_text(summary_data, style)
            
            # Extract key events
            key_events = self._extract_key_events(conversations, analysis_results)
            
            # Generate recommendations
            recommendations = []
            if include_recommendations:
                recommendations = await self._generate_recommendations(
                    summary_data, effectiveness_metrics
                )
            
            # Create sentiment journey
            sentiment_journey = self._create_sentiment_journey(conversations, analysis_results)
            
            # Determine call outcome
            outcome = self._determine_call_outcome(conversations, analysis_results)
            
            # Create duration breakdown
            duration_breakdown = self._create_duration_breakdown(conversations, call_context)
            
            # Determine caller intent
            caller_intent = self._extract_primary_intent(analysis_results)
            
            # Extract AI responses
            ai_responses = [
                conv.get("message_text", "") 
                for conv in conversations 
                if conv.get("speaker") == "ai"
            ]
            
            summary = CallSummary(
                call_id=call_id,
                summary_text=summary_text,
                key_events=key_events,
                caller_intent=caller_intent,
                ai_responses=ai_responses,
                outcome=outcome,
                effectiveness_metrics=effectiveness_metrics or CallEffectivenessMetrics(
                    overall_score=0.0,
                    ai_response_quality=0.0,
                    conversation_flow=0.0,
                    caller_satisfaction=0.0,
                    termination_appropriateness=0.0,
                    response_latency_score=0.0,
                    contextual_awareness=0.0
                ),
                sentiment_journey=sentiment_journey,
                recommendations=recommendations,
                duration_breakdown=duration_breakdown
            )
            
            processing_time = int((time.time() - start_time) * 1000)
            analysis_logger.log_summary_generated(
                call_id, len(summary_text), processing_time
            )
            
            return summary
            
        except Exception as e:
            analysis_logger.log_error("summary_generation", call_id, e)
            raise
    
    async def _gather_call_context(
        self, 
        call_id: str, 
        user_id: str, 
        conversations: List[Dict]
    ) -> Dict[str, Any]:
        """Gather additional context for summary generation."""
        from app.core.database import conversation_queries
        
        # Get call record
        call_query = """
        SELECT 
            caller_phone, call_type, call_status, start_time, end_time,
            duration_seconds, response_time_ms, processing_metadata
        FROM call_records 
        WHERE id = $1
        """
        call_records = await conversation_queries.db.execute_raw_query(call_query, call_id)
        call_record = dict(call_records[0]) if call_records else {}
        
        # Get caller history (recent calls from same number)
        caller_phone = call_record.get("caller_phone", "")
        caller_history = []
        if caller_phone:
            caller_history = await conversation_queries.get_caller_conversation_history(
                caller_phone, limit=5
            )
        
        return {
            "call_id": call_id,
            "user_id": user_id,
            "call_record": call_record,
            "caller_phone": caller_phone,
            "caller_history": caller_history,
            "conversation_count": len(conversations),
            "total_duration": call_record.get("duration_seconds", 0),
            "avg_response_time": call_record.get("response_time_ms", 0)
        }
    
    async def _prepare_summary_data(
        self,
        call_context: Dict[str, Any],
        conversations: List[Dict[str, Any]],
        analysis_results: Dict[str, Any],
        effectiveness_metrics: Optional[CallEffectivenessMetrics]
    ) -> Dict[str, Any]:
        """Prepare data structure for summary generation."""
        
        # Format conversation text
        conversation_text = self._format_conversation_for_summary(conversations)
        
        # Extract analysis summaries
        sentiment_summary = self._summarize_sentiment_analysis(analysis_results)
        intent_summary = self._summarize_intent_analysis(analysis_results)
        keywords_summary = self._summarize_keywords(analysis_results)
        entities_summary = self._summarize_entities(analysis_results)
        
        # Prepare metrics summary
        metrics_summary = {}
        if effectiveness_metrics:
            metrics_summary = {
                "overall_score": effectiveness_metrics.overall_score,
                "response_quality": effectiveness_metrics.ai_response_quality,
                "caller_satisfaction": effectiveness_metrics.caller_satisfaction,
                "conversation_flow": effectiveness_metrics.conversation_flow
            }
        
        return {
            "call_id": call_context["call_id"],
            "duration": call_context["total_duration"],
            "turn_count": call_context["conversation_count"],
            "caller_phone": call_context["caller_phone"],
            "conversation_text": conversation_text,
            "conversation_summary": self._create_brief_conversation_summary(conversations),
            "full_conversation": self._format_full_conversation(conversations),
            "intent_analysis": intent_summary,
            "sentiment_analysis": sentiment_summary,
            "keywords": keywords_summary,
            "entities": entities_summary,
            "main_intent": self._extract_primary_intent(analysis_results),
            "outcome": self._determine_call_outcome(conversations, analysis_results),
            "detailed_analysis": json.dumps(analysis_results, ensure_ascii=False, indent=2),
            "effectiveness_metrics": json.dumps(metrics_summary, ensure_ascii=False, indent=2)
        }
    
    def _format_conversation_for_summary(self, conversations: List[Dict]) -> str:
        """Format conversation for summary generation."""
        formatted = []
        for conv in conversations:
            speaker = conv.get("speaker", "unknown")
            message = conv.get("message_text", "")
            timestamp = conv.get("timestamp", "")
            
            speaker_label = "来电者" if speaker == "caller" else "AI助手"
            formatted.append(f"{speaker_label}: {message}")
        
        return "\n".join(formatted)
    
    def _format_full_conversation(self, conversations: List[Dict]) -> str:
        """Format full conversation with additional details."""
        formatted = []
        for i, conv in enumerate(conversations, 1):
            speaker = conv.get("speaker", "unknown")
            message = conv.get("message_text", "")
            confidence = conv.get("confidence_score", 0.0)
            intent = conv.get("intent_category", "")
            emotion = conv.get("emotion", "")
            
            speaker_label = "来电者" if speaker == "caller" else "AI助手"
            
            details = []
            if confidence > 0:
                details.append(f"置信度: {confidence:.2f}")
            if intent:
                details.append(f"意图: {intent}")
            if emotion and emotion != "neutral":
                details.append(f"情感: {emotion}")
            
            details_str = f" ({', '.join(details)})" if details else ""
            formatted.append(f"[{i:02d}] {speaker_label}: {message}{details_str}")
        
        return "\n".join(formatted)
    
    def _create_brief_conversation_summary(self, conversations: List[Dict]) -> str:
        """Create brief summary of conversation content."""
        if not conversations:
            return "无对话内容"
        
        # Get first and last few messages
        start_messages = conversations[:2]
        end_messages = conversations[-2:] if len(conversations) > 2 else []
        
        summary_parts = []
        
        # Opening
        if start_messages:
            first_caller = next(
                (conv for conv in start_messages if conv.get("speaker") == "caller"), 
                None
            )
            if first_caller:
                summary_parts.append(f"来电者开场：{first_caller.get('message_text', '')[:50]}...")
        
        # Closing
        if end_messages:
            last_ai = next(
                (conv for conv in reversed(end_messages) if conv.get("speaker") == "ai"), 
                None
            )
            if last_ai:
                summary_parts.append(f"AI结尾：{last_ai.get('message_text', '')[:50]}...")
        
        return " | ".join(summary_parts)
    
    def _summarize_sentiment_analysis(self, analysis_results: Dict[str, Any]) -> str:
        """Summarize sentiment analysis results."""
        sentiment = analysis_results.get("sentiment", {})
        if not sentiment:
            return "未进行情感分析"
        
        label = sentiment.get("label", "未知")
        confidence = sentiment.get("confidence", 0.0)
        emotion = sentiment.get("emotion", "")
        
        summary = f"整体情感: {label} (置信度: {confidence:.2f})"
        if emotion and emotion != "neutral":
            summary += f", 检测到情绪: {emotion}"
        
        return summary
    
    def _summarize_intent_analysis(self, analysis_results: Dict[str, Any]) -> str:
        """Summarize intent analysis results."""
        intent = analysis_results.get("intent", {})
        if not intent:
            return "未进行意图分析"
        
        category = intent.get("category", "未知")
        confidence = intent.get("confidence", 0.0)
        subcategory = intent.get("subcategory", "")
        keywords = intent.get("keywords", [])
        
        summary = f"主要意图: {category} (置信度: {confidence:.2f})"
        if subcategory:
            summary += f", 细分类别: {subcategory}"
        if keywords:
            summary += f", 关键词: {', '.join(keywords[:5])}"
        
        return summary
    
    def _summarize_keywords(self, analysis_results: Dict[str, Any]) -> str:
        """Summarize keyword analysis."""
        keywords = analysis_results.get("keywords", {})
        if not keywords:
            return "未提取关键词"
        
        main_keywords = keywords.get("keywords", [])[:8]
        spam_indicators = keywords.get("spam_indicators", [])
        urgency_indicators = keywords.get("urgency_indicators", [])
        
        summary = f"主要关键词: {', '.join(main_keywords)}"
        if spam_indicators:
            summary += f" | 垃圾指标: {', '.join(spam_indicators[:3])}"
        if urgency_indicators:
            summary += f" | 紧急指标: {', '.join(urgency_indicators[:3])}"
        
        return summary
    
    def _summarize_entities(self, analysis_results: Dict[str, Any]) -> str:
        """Summarize entity extraction results."""
        entities = analysis_results.get("entities", {})
        if not entities:
            return "未识别实体"
        
        summary_parts = []
        
        persons = entities.get("person_names", [])
        if persons:
            summary_parts.append(f"人名: {', '.join(persons[:3])}")
        
        orgs = entities.get("organizations", [])
        if orgs:
            summary_parts.append(f"机构: {', '.join(orgs[:3])}")
        
        phones = entities.get("phone_numbers", [])
        if phones:
            summary_parts.append(f"电话: {', '.join(phones[:2])}")
        
        amounts = entities.get("amounts", [])
        if amounts:
            amount_strs = [str(amt.get("value", "")) for amt in amounts[:2]]
            summary_parts.append(f"金额: {', '.join(amount_strs)}")
        
        return " | ".join(summary_parts) if summary_parts else "未识别到重要实体"
    
    def _extract_primary_intent(self, analysis_results: Dict[str, Any]) -> str:
        """Extract primary intent from analysis results."""
        intent = analysis_results.get("intent", {})
        return intent.get("category", "unknown") if intent else "unknown"
    
    def _determine_call_outcome(
        self, 
        conversations: List[Dict], 
        analysis_results: Dict[str, Any]
    ) -> str:
        """Determine the outcome of the call."""
        if not conversations:
            return "通话异常结束"
        
        last_messages = conversations[-2:]
        
        # Check for explicit endings
        ending_patterns = {
            "polite_ending": ["再见", "谢谢", "打扰了", "好的"],
            "frustrated_ending": ["够了", "别打了", "不听", "挂了"],
            "successful_block": ["不需要", "不感兴趣", "没时间"],
            "information_provided": ["了解了", "明白了", "知道了"]
        }
        
        for msg in last_messages:
            message_text = msg.get("message_text", "").lower()
            
            for outcome_type, patterns in ending_patterns.items():
                if any(pattern in message_text for pattern in patterns):
                    outcome_mapping = {
                        "polite_ending": "礼貌结束通话",
                        "frustrated_ending": "来电者不满挂断",
                        "successful_block": "成功拒绝推销",
                        "information_provided": "信息已传达"
                    }
                    return outcome_mapping[outcome_type]
        
        # Check conversation length and pattern
        if len(conversations) < 3:
            return "通话过短"
        elif len(conversations) > 15:
            return "通话过长，可能处理不当"
        else:
            return "正常结束通话"
    
    async def _generate_summary_text(
        self, 
        summary_data: Dict[str, Any], 
        style: str
    ) -> str:
        """Generate main summary text using AI."""
        try:
            template = self.summary_templates.get(style, self.summary_templates["comprehensive"])
            prompt = template.format(**summary_data)
            
            response = await self.openai_client.chat.completions.create(
                model=self.deployment_name,
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个专业的通话分析专家，负责生成准确、有洞察力的通话总结报告。请确保总结客观、具体且有实用价值。"
                    },
                    {
                        "role": "user", 
                        "content": prompt
                    }
                ],
                max_tokens=1000 if style == "detailed" else 500,
                temperature=0.3,  # Lower temperature for more consistent summaries
                top_p=0.9
            )
            
            return response.choices[0].message.content.strip()
            
        except Exception as e:
            logger.error("ai_summary_generation_failed", error=str(e))
            # Fallback to template-based summary
            return self._generate_fallback_summary(summary_data, style)
    
    def _generate_fallback_summary(
        self, 
        summary_data: Dict[str, Any], 
        style: str
    ) -> str:
        """Generate fallback summary without AI."""
        duration = summary_data.get("duration", 0)
        turn_count = summary_data.get("turn_count", 0)
        caller_intent = summary_data.get("main_intent", "未知")
        outcome = summary_data.get("outcome", "未知结果")
        
        if style == "brief":
            return f"""
**通话概述**
时长: {duration}秒，对话{turn_count}轮
来电意图: {caller_intent}
处理结果: {outcome}

**基本评估**
AI系统按照预设流程处理了此次通话，完成了基本的应答任务。
            """.strip()
        
        elif style == "detailed":
            return f"""
**详细通话分析报告**

**基础信息**
- 通话时长: {duration}秒
- 对话轮次: {turn_count}轮
- 识别意图: {caller_intent}
- 处理结果: {outcome}

**处理流程**
系统接收到来电后，启动AI应答流程。通过{turn_count}轮对话交互，识别出来电者意图为{caller_intent}，最终{outcome}。

**系统表现**
在此次通话中，AI系统完成了基本的应答功能，能够与来电者进行基础对话。

**改进建议**
建议继续优化对话策略，提升用户体验。
            """.strip()
        
        else:  # comprehensive
            return f"""
**通话总结报告**

**概述**
本次通话持续{duration}秒，共进行{turn_count}轮对话。系统识别出来电者主要意图为{caller_intent}，通话以{outcome}的方式结束。

**关键要点**
- AI系统正常响应来电
- 完成了基础的对话交互
- 按照预设策略处理通话

**处理效果**
整体而言，系统完成了预期的通话处理任务。

**优化方向**
可考虑进一步优化响应策略和对话质量。
            """.strip()
    
    def _extract_key_events(
        self, 
        conversations: List[Dict], 
        analysis_results: Dict[str, Any]
    ) -> List[str]:
        """Extract key events from the conversation."""
        key_events = []
        
        if not conversations:
            return key_events
        
        # Opening event
        first_caller = next(
            (conv for conv in conversations if conv.get("speaker") == "caller"),
            None
        )
        if first_caller:
            key_events.append(f"来电开始: {first_caller.get('message_text', '')[:100]}")
        
        # Intent recognition event
        intent = analysis_results.get("intent", {})
        if intent and intent.get("category") != "unknown":
            key_events.append(f"意图识别: 检测到{intent.get('category')}类型通话")
        
        # Sentiment changes
        sentiment_changes = self._detect_sentiment_changes(conversations)
        for change in sentiment_changes:
            key_events.append(change)
        
        # Response quality issues
        quality_issues = self._detect_response_issues(conversations)
        for issue in quality_issues:
            key_events.append(issue)
        
        # Termination event
        last_ai = next(
            (conv for conv in reversed(conversations) if conv.get("speaker") == "ai"),
            None
        )
        if last_ai:
            key_events.append(f"通话结束: {last_ai.get('message_text', '')[:100]}")
        
        return key_events[:8]  # Limit to top 8 events
    
    def _detect_sentiment_changes(self, conversations: List[Dict]) -> List[str]:
        """Detect significant sentiment changes during conversation."""
        changes = []
        previous_emotion = None
        
        for i, conv in enumerate(conversations):
            if conv.get("speaker") == "caller":
                current_emotion = conv.get("emotion", "neutral")
                
                if (previous_emotion and 
                    previous_emotion != current_emotion and
                    current_emotion in ["frustrated", "aggressive", "confused"]):
                    
                    changes.append(f"第{i+1}轮: 来电者情绪变为{current_emotion}")
                
                previous_emotion = current_emotion
        
        return changes
    
    def _detect_response_issues(self, conversations: List[Dict]) -> List[str]:
        """Detect potential response quality issues."""
        issues = []
        
        for i, conv in enumerate(conversations):
            if conv.get("speaker") == "ai":
                latency = conv.get("processing_latency", 0)
                confidence = conv.get("confidence_score", 1.0)
                
                # High latency issue
                if latency > 3000:  # > 3 seconds
                    issues.append(f"第{i+1}轮: AI响应延迟过高 ({latency}ms)")
                
                # Low confidence issue
                if confidence < 0.5:
                    issues.append(f"第{i+1}轮: AI响应置信度较低 ({confidence:.2f})")
        
        return issues
    
    async def _generate_recommendations(
        self,
        summary_data: Dict[str, Any],
        effectiveness_metrics: Optional[CallEffectivenessMetrics]
    ) -> List[str]:
        """Generate actionable recommendations for improvement."""
        recommendations = []
        
        # Base recommendations on effectiveness metrics
        if effectiveness_metrics:
            if effectiveness_metrics.ai_response_quality < 0.7:
                recommendations.append("提升AI响应质量：优化回复内容的相关性和自然度")
            
            if effectiveness_metrics.response_latency_score < 0.7:
                recommendations.append("优化响应速度：减少AI处理延迟，目标控制在2秒内")
            
            if effectiveness_metrics.conversation_flow < 0.7:
                recommendations.append("改善对话流程：提高上下文理解和响应连贯性")
            
            if effectiveness_metrics.caller_satisfaction < 0.7:
                recommendations.append("提升用户满意度：优化礼貌用语和情感处理")
            
            if effectiveness_metrics.contextual_awareness < 0.7:
                recommendations.append("加强上下文感知：更好地利用用户画像和历史记录")
        
        # Add general recommendations based on conversation patterns
        turn_count = summary_data.get("turn_count", 0)
        if turn_count > 10:
            recommendations.append("优化终止策略：避免过长对话，适时结束通话")
        elif turn_count < 3:
            recommendations.append("改善初始应答：确保充分理解来电者意图")
        
        # Intent-specific recommendations
        main_intent = summary_data.get("main_intent", "")
        if main_intent == "sales_call":
            recommendations.append("销售电话处理：加强拒绝话术的自然性和礼貌性")
        elif main_intent == "loan_offer":
            recommendations.append("贷款推销处理：明确表达无需求，避免过多解释")
        elif main_intent == "investment_pitch":
            recommendations.append("投资推销处理：强调已有规划，礼貌但坚决拒绝")
        
        return recommendations[:6]  # Limit to 6 recommendations
    
    def _create_sentiment_journey(
        self, 
        conversations: List[Dict], 
        analysis_results: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """Create sentiment journey timeline."""
        journey = []
        
        for i, conv in enumerate(conversations):
            if conv.get("speaker") == "caller":
                emotion = conv.get("emotion", "neutral")
                confidence = conv.get("confidence_score", 0.0)
                timestamp = conv.get("timestamp", "")
                
                journey.append({
                    "turn": i + 1,
                    "timestamp": timestamp,
                    "emotion": emotion,
                    "confidence": confidence,
                    "message_preview": conv.get("message_text", "")[:50]
                })
        
        return journey
    
    def _create_duration_breakdown(
        self, 
        conversations: List[Dict], 
        call_context: Dict[str, Any]
    ) -> Dict[str, float]:
        """Create breakdown of call duration by phases."""
        total_duration = call_context.get("total_duration", 0)
        
        if not conversations or total_duration == 0:
            return {"total": 0.0}
        
        # Simple breakdown based on conversation turns
        turn_count = len(conversations)
        avg_turn_duration = total_duration / turn_count if turn_count > 0 else 0
        
        # Estimate phase durations
        opening_turns = min(3, turn_count)
        closing_turns = min(2, turn_count)
        middle_turns = max(0, turn_count - opening_turns - closing_turns)
        
        return {
            "total": float(total_duration),
            "opening_phase": opening_turns * avg_turn_duration,
            "discussion_phase": middle_turns * avg_turn_duration,
            "closing_phase": closing_turns * avg_turn_duration,
            "avg_turn_duration": avg_turn_duration
        }
    
    async def batch_generate_summaries(
        self,
        call_data_list: List[Tuple[str, str, List[Dict], Dict[str, Any]]],
        style: str = "comprehensive"
    ) -> List[Tuple[str, CallSummary]]:
        """Generate summaries for multiple calls in batch."""
        results = []
        
        # Process in smaller batches to manage resources
        batch_size = 3
        for i in range(0, len(call_data_list), batch_size):
            batch = call_data_list[i:i + batch_size]
            
            batch_tasks = []
            for call_id, user_id, conversations, analysis_results in batch:
                task = self.generate_call_summary(
                    call_id, user_id, conversations, analysis_results, style
                )
                batch_tasks.append(task)
            
            batch_results = await asyncio.gather(*batch_tasks, return_exceptions=True)
            
            for j, (call_id, user_id, _, _) in enumerate(batch):
                result = batch_results[j]
                if isinstance(result, Exception):
                    logger.error("batch_summary_generation_failed", 
                                call_id=call_id, error=str(result))
                    # Create minimal summary for failed generation
                    result = CallSummary(
                        call_id=call_id,
                        summary_text="摘要生成失败",
                        key_events=[],
                        caller_intent="unknown",
                        ai_responses=[],
                        outcome="处理异常",
                        effectiveness_metrics=CallEffectivenessMetrics(
                            overall_score=0.0,
                            ai_response_quality=0.0,
                            conversation_flow=0.0,
                            caller_satisfaction=0.0,
                            termination_appropriateness=0.0,
                            response_latency_score=0.0,
                            contextual_awareness=0.0
                        ),
                        sentiment_journey=[],
                        recommendations=["请检查系统配置"],
                        duration_breakdown={"total": 0.0}
                    )
                
                results.append((call_id, result))
        
        return results


# Singleton instance  
summary_generator = SummaryGenerator()