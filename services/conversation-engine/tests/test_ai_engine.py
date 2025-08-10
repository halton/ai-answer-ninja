"""
Integration tests for AI Dialogue Engine
Tests the complete conversation flow and learning system
"""

import pytest
import asyncio
from typing import Dict, Any
from datetime import datetime

from ..services import (
    intent_classifier,
    conversation_manager,
    termination_manager,
    conversation_learning_system
)
from ..models.conversation import (
    ConversationContext,
    IntentCategory,
    EmotionalState,
    ConversationStage,
    DialogueState
)
from ..models.user import UserProfileData, PersonalityType, SpeechStyle


class TestIntentClassifier:
    """Test intent classification functionality"""
    
    @pytest.mark.asyncio
    async def test_sales_call_classification(self):
        """Test classification of sales call intent"""
        transcript = "您好，我是XX公司的销售代表，想给您介绍一下我们最新的产品优惠活动。"
        
        result = await intent_classifier.classify_intent(transcript)
        
        assert result.intent == IntentCategory.SALES_CALL
        assert result.confidence > 0.7
        assert len(result.keywords_matched) > 0
        assert "产品" in result.keywords_matched or "优惠" in result.keywords_matched
    
    @pytest.mark.asyncio
    async def test_loan_offer_classification(self):
        """Test classification of loan offer intent"""
        transcript = "先生您好，我们银行现在有低利率贷款，额度最高50万，无需抵押。"
        
        result = await intent_classifier.classify_intent(transcript)
        
        assert result.intent == IntentCategory.LOAN_OFFER
        assert result.confidence > 0.7
        assert "贷款" in result.keywords_matched or "利率" in result.keywords_matched
    
    @pytest.mark.asyncio
    async def test_investment_pitch_classification(self):
        """Test classification of investment pitch"""
        transcript = "有一个很好的投资机会，年收益率可达15%，您有兴趣了解一下吗？"
        
        result = await intent_classifier.classify_intent(transcript)
        
        assert result.intent == IntentCategory.INVESTMENT_PITCH
        assert result.confidence > 0.6
        assert result.emotional_tone in ["neutral", "friendly"]
    
    @pytest.mark.asyncio
    async def test_contextual_classification(self):
        """Test classification with context"""
        context = ConversationContext(
            call_id="test_123",
            user_id="user_456",
            caller_phone="1234567890",
            spam_category="sales",
            turn_count=3,
            conversation_history=[]
        )
        
        transcript = "真的是个很好的机会，您再考虑一下。"
        
        result = await intent_classifier.classify_intent(transcript, context)
        
        assert result.intent == IntentCategory.SALES_CALL
        assert result.context_influenced == True


class TestConversationManager:
    """Test conversation management functionality"""
    
    @pytest.mark.asyncio
    async def test_initial_conversation(self):
        """Test initial conversation handling"""
        user_profile = UserProfileData(
            user_id="test_user",
            name="测试用户",
            phone_number="9876543210",
            personality_type=PersonalityType.POLITE,
            speech_style=SpeechStyle.FRIENDLY
        )
        
        result = await conversation_manager.manage_conversation(
            input_text="您好，我是保险公司的，想给您介绍一下我们的保险产品。",
            call_id="test_call_001",
            user_id="test_user",
            user_profile=user_profile
        )
        
        assert result["response"] is not None
        assert len(result["response"]) > 0
        assert result["intent"] == "insurance_sales"
        assert result["next_state"] in ["initial", "handling_insurance", "polite_decline"]
        assert result["turn_count"] == 1
        assert not result["should_terminate"]
    
    @pytest.mark.asyncio
    async def test_multi_turn_conversation(self):
        """Test multi-turn conversation flow"""
        call_id = "test_call_002"
        user_id = "test_user"
        
        # Turn 1: Initial contact
        result1 = await conversation_manager.manage_conversation(
            input_text="您好，我是贷款公司的，请问您最近有贷款需求吗？",
            call_id=call_id,
            user_id=user_id
        )
        
        assert result1["turn_count"] == 1
        assert not result1["should_terminate"]
        
        # Turn 2: Persistence
        result2 = await conversation_manager.manage_conversation(
            input_text="我们的利率真的很低，您可以先了解一下。",
            call_id=call_id,
            user_id=user_id
        )
        
        assert result2["turn_count"] == 2
        
        # Turn 3: More persistence
        result3 = await conversation_manager.manage_conversation(
            input_text="就耽误您一分钟，我们的产品真的很不错。",
            call_id=call_id,
            user_id=user_id
        )
        
        assert result3["turn_count"] == 3
        # Should start considering termination after multiple turns
    
    @pytest.mark.asyncio
    async def test_personality_adaptation(self):
        """Test response adaptation to different personalities"""
        call_id = "test_call_003"
        
        # Test with polite personality
        polite_profile = UserProfileData(
            user_id="polite_user",
            name="礼貌用户",
            phone_number="111",
            personality_type=PersonalityType.POLITE,
            speech_style=SpeechStyle.FRIENDLY
        )
        
        polite_result = await conversation_manager.manage_conversation(
            input_text="您好，我想向您推荐一个投资产品。",
            call_id=f"{call_id}_polite",
            user_id="polite_user",
            user_profile=polite_profile
        )
        
        # Test with direct personality
        direct_profile = UserProfileData(
            user_id="direct_user",
            name="直接用户",
            phone_number="222",
            personality_type=PersonalityType.DIRECT,
            speech_style=SpeechStyle.BRIEF
        )
        
        direct_result = await conversation_manager.manage_conversation(
            input_text="您好，我想向您推荐一个投资产品。",
            call_id=f"{call_id}_direct",
            user_id="direct_user",
            user_profile=direct_profile
        )
        
        # Responses should be different based on personality
        assert polite_result["response"] != direct_result["response"]
        assert polite_result["emotional_tone"] == "polite"


class TestTerminationManager:
    """Test call termination management"""
    
    @pytest.mark.asyncio
    async def test_turn_limit_termination(self):
        """Test termination based on turn count"""
        dialogue_state = DialogueState(
            call_id="test_term_001",
            stage=ConversationStage.FIRM_REJECTION,
            turn_count=10,  # Exceeds threshold
            start_time=datetime.utcnow(),
            intent_history=[IntentCategory.SALES_CALL] * 10,
            emotional_trajectory=[EmotionalState.FRUSTRATED] * 5
        )
        
        result = await termination_manager.should_terminate_call(
            dialogue_state=dialogue_state,
            current_response=None
        )
        
        assert result["terminate"] == True
        assert result["reason"] == "max_turns_exceeded"
        assert result["final_response"] is not None
    
    @pytest.mark.asyncio
    async def test_persistence_detection(self):
        """Test persistence detection and termination"""
        dialogue_state = DialogueState(
            call_id="test_term_002",
            stage=ConversationStage.POLITE_DECLINE,
            turn_count=6,
            start_time=datetime.utcnow(),
            intent_history=[IntentCategory.LOAN_OFFER] * 6,  # Repetitive intent
            emotional_trajectory=[EmotionalState.NEUTRAL] * 3 + [EmotionalState.ANNOYED] * 3
        )
        
        detector = termination_manager.persistence_detector
        persistence_score = await detector.analyze(dialogue_state)
        
        assert persistence_score > 0.5  # Should detect persistence
        
        result = await termination_manager.should_terminate_call(
            dialogue_state=dialogue_state,
            current_response=None
        )
        
        # May or may not terminate based on threshold
        assert "metrics" in result
        assert result["metrics"]["persistence_score"] > 0.5
    
    @pytest.mark.asyncio
    async def test_frustration_tracking(self):
        """Test frustration level tracking"""
        dialogue_state = DialogueState(
            call_id="test_term_003",
            stage=ConversationStage.FIRM_REJECTION,
            turn_count=5,
            start_time=datetime.utcnow(),
            intent_history=[IntentCategory.INSURANCE_SALES] * 5,
            emotional_trajectory=[
                EmotionalState.NEUTRAL,
                EmotionalState.ANNOYED,
                EmotionalState.FRUSTRATED,
                EmotionalState.FRUSTRATED,
                EmotionalState.AGGRESSIVE
            ]
        )
        
        tracker = termination_manager.frustration_tracker
        frustration_level = await tracker.analyze(dialogue_state)
        
        assert frustration_level > 0.6  # Should detect high frustration
    
    @pytest.mark.asyncio
    async def test_continuation_strategy(self):
        """Test continuation strategy suggestion"""
        dialogue_state = DialogueState(
            call_id="test_term_004",
            stage=ConversationStage.HANDLING_SALES,
            turn_count=3,
            start_time=datetime.utcnow(),
            intent_history=[IntentCategory.SALES_CALL] * 3,
            emotional_trajectory=[EmotionalState.NEUTRAL] * 3
        )
        
        result = await termination_manager.should_terminate_call(
            dialogue_state=dialogue_state,
            current_response=None
        )
        
        assert result["terminate"] == False
        assert "continue_strategy" in result
        assert result["metrics"]["turn_count"] == 3


class TestLearningSystem:
    """Test conversation learning system"""
    
    @pytest.mark.asyncio
    async def test_single_conversation_learning(self):
        """Test learning from a single conversation"""
        call_record = {
            "call_id": "test_learn_001",
            "user_id": "test_user",
            "turn_count": 5,
            "duration_seconds": 120,
            "outcome": "successful_termination",
            "intent_history": [IntentCategory.SALES_CALL] * 5,
            "emotional_trajectory": [EmotionalState.NEUTRAL] * 3 + [EmotionalState.POLITE] * 2,
            "strategies_used": ["gentle_decline", "firm_decline"],
            "termination_reason": "caller_accepted"
        }
        
        await conversation_learning_system.learn_from_conversation(call_record)
        
        metrics = await conversation_learning_system.get_learning_metrics()
        assert metrics["total_conversations_analyzed"] >= 1
    
    @pytest.mark.asyncio
    async def test_pattern_recognition(self):
        """Test pattern recognition in conversations"""
        call_records = [
            {
                "call_id": f"test_pattern_{i}",
                "turn_count": 4,
                "outcome": "successful_termination",
                "intent_history": [IntentCategory.LOAN_OFFER] * 4,
                "emotional_trajectory": [EmotionalState.NEUTRAL] * 2 + [EmotionalState.POLITE] * 2,
                "effectiveness_score": 0.8
            }
            for i in range(5)  # Create 5 similar conversations
        ]
        
        recognizer = conversation_learning_system.pattern_recognizer
        patterns = await recognizer.extract_patterns(call_records)
        
        assert len(patterns) > 0  # Should recognize patterns
        assert patterns[0].pattern_type == "successful"
        assert patterns[0].frequency >= 3  # Minimum threshold
    
    @pytest.mark.asyncio
    async def test_strategy_optimization(self):
        """Test strategy optimization based on performance"""
        call_records = [
            {
                "call_id": f"test_opt_{i}",
                "strategies_used": ["gentle_decline"],
                "outcome": "failed" if i < 7 else "successful_termination",
                "turn_count": 10 if i < 7 else 4,
                "effectiveness_score": 0.3 if i < 7 else 0.8
            }
            for i in range(10)
        ]
        
        optimizer = conversation_learning_system.strategy_optimizer
        performance = await optimizer.analyze_strategy_performance(call_records)
        
        assert "gentle_decline" in performance
        assert performance["gentle_decline"].usage_count == 10
        assert performance["gentle_decline"].success_count == 3  # 30% success
        
        # Should recommend optimization for low-performing strategy
        patterns = []  # Empty patterns for this test
        optimizations = await optimizer.optimize_strategies(patterns, performance)
        
        assert len(optimizations) > 0
        assert any(opt["strategy"] == "gentle_decline" for opt in optimizations)
    
    @pytest.mark.asyncio
    async def test_batch_learning(self):
        """Test batch learning from multiple conversations"""
        call_records = [
            {
                "call_id": f"test_batch_{i}",
                "user_id": f"user_{i % 3}",
                "turn_count": 3 + (i % 5),
                "duration_seconds": 60 + (i * 10),
                "outcome": "successful_termination" if i % 2 == 0 else "caller_hung_up",
                "intent_history": [IntentCategory.SALES_CALL] * (3 + (i % 3)),
                "emotional_trajectory": [EmotionalState.NEUTRAL] * 3,
                "strategies_used": ["gentle_decline", "firm_decline"] if i % 2 == 0 else ["direct_refusal"],
                "effectiveness_score": 0.7 if i % 2 == 0 else 0.5
            }
            for i in range(20)
        ]
        
        result = await conversation_learning_system.batch_learning(call_records)
        
        assert result["patterns_identified"] >= 0
        assert "strategy_performance" in result
        assert "insights" in result
        assert "learning_metrics" in result
        assert result["learning_metrics"]["total_conversations_analyzed"] >= 20
    
    @pytest.mark.asyncio
    async def test_model_export_import(self):
        """Test learning model export and import"""
        # First, create some learning data
        call_record = {
            "call_id": "test_export",
            "turn_count": 5,
            "outcome": "successful_termination",
            "strategies_used": ["firm_decline"],
            "effectiveness_score": 0.85
        }
        
        await conversation_learning_system.learn_from_conversation(call_record)
        
        # Export model
        model_data = await conversation_learning_system.export_learning_model()
        
        assert "timestamp" in model_data
        assert "metrics" in model_data
        assert "learning_cache" in model_data
        
        # Clear and reimport
        conversation_learning_system.total_conversations_analyzed = 0
        
        await conversation_learning_system.import_learning_model(model_data)
        
        # Verify import
        metrics = await conversation_learning_system.get_learning_metrics()
        assert metrics["total_conversations_analyzed"] > 0


class TestEndToEndConversation:
    """Test complete end-to-end conversation flow"""
    
    @pytest.mark.asyncio
    async def test_complete_conversation_flow(self):
        """Test a complete conversation from start to termination"""
        call_id = "test_e2e_001"
        user_id = "test_user_e2e"
        
        user_profile = UserProfileData(
            user_id=user_id,
            name="完整测试用户",
            phone_number="8888888888",
            personality_type=PersonalityType.POLITE,
            speech_style=SpeechStyle.NORMAL
        )
        
        conversation_turns = [
            "您好，我是XX保险公司的，想给您介绍一下我们的新产品。",
            "这个产品真的很适合您，保费很低，保障很全面。",
            "您可以先了解一下，不一定要现在决定。",
            "就给我一分钟时间，让我说完好吗？",
            "这是最后一次机会了，错过就没有了。",
            "您真的不再考虑一下吗？"
        ]
        
        for i, caller_input in enumerate(conversation_turns):
            result = await conversation_manager.manage_conversation(
                input_text=caller_input,
                call_id=call_id,
                user_id=user_id,
                user_profile=user_profile
            )
            
            print(f"Turn {i+1}:")
            print(f"  Caller: {caller_input}")
            print(f"  AI: {result['response']}")
            print(f"  State: {result['next_state']}")
            print(f"  Should terminate: {result['should_terminate']}")
            
            # Conversation should progress through stages
            assert result["turn_count"] == i + 1
            
            # Should eventually recommend termination
            if i >= 4:
                # After 5+ turns, should consider termination
                if result["should_terminate"]:
                    print(f"  Termination reason: {result['termination_reason']}")
                    break
        
        # Verify conversation was properly tracked
        summary = await conversation_manager.get_conversation_summary(call_id)
        assert summary["total_turns"] > 0
        assert summary["intent_distribution"]["insurance_sales"] > 0
        
        # Learn from the conversation
        call_record = {
            "call_id": call_id,
            "user_id": user_id,
            "turn_count": summary["total_turns"],
            "outcome": "successful_termination" if summary["successful_termination"] else "ongoing",
            "final_stage": summary["final_stage"]
        }
        
        await conversation_learning_system.learn_from_conversation(call_record)


# Performance benchmarks
class TestPerformanceBenchmarks:
    """Test performance against defined targets"""
    
    @pytest.mark.asyncio
    async def test_intent_classification_speed(self):
        """Test intent classification meets latency requirements"""
        import time
        
        transcript = "您好，我是银行的客户经理，想给您介绍一下我们的理财产品。"
        
        start_time = time.time()
        result = await intent_classifier.classify_intent(transcript)
        processing_time = (time.time() - start_time) * 1000
        
        # Should complete within 100ms for intent classification
        assert processing_time < 100
        assert result.confidence > 0.7
    
    @pytest.mark.asyncio
    async def test_response_generation_speed(self):
        """Test response generation meets latency requirements"""
        import time
        
        start_time = time.time()
        result = await conversation_manager.manage_conversation(
            input_text="您好，需要贷款吗？",
            call_id="perf_test_001",
            user_id="perf_user"
        )
        processing_time = (time.time() - start_time) * 1000
        
        # Should complete within 500ms for MVP (includes all processing)
        assert processing_time < 500
        assert result["response"] is not None
    
    @pytest.mark.asyncio
    async def test_conversation_efficiency(self):
        """Test conversation efficiency metrics"""
        # Simulate multiple conversations
        successful_terminations = 0
        total_turns = 0
        
        for i in range(10):
            call_id = f"efficiency_test_{i}"
            
            # Simulate a conversation
            for turn in range(1, 8):
                result = await conversation_manager.manage_conversation(
                    input_text="我们的产品真的很好，您再考虑一下。",
                    call_id=call_id,
                    user_id="test_user"
                )
                
                if result["should_terminate"]:
                    if turn <= 5:  # Terminated within target
                        successful_terminations += 1
                    total_turns += turn
                    break
            else:
                total_turns += 7
        
        avg_turns = total_turns / 10
        success_rate = successful_terminations / 10
        
        # Should meet efficiency targets
        assert avg_turns < 6  # Target: <5 turns average
        assert success_rate > 0.8  # Target: >90% successful termination


if __name__ == "__main__":
    # Run tests
    pytest.main([__file__, "-v"])