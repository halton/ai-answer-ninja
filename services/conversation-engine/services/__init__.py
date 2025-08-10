"""
Conversation Engine Services
Export all AI dialogue engine services
"""

from .azure_openai import azure_openai_service, AzureOpenAIService
from .intent_classifier import intent_classifier, IntentClassifier, IntentResult
from .conversation_manager import (
    conversation_manager,
    ConversationManager,
    DialogueStateTracker,
    ResponseStrategy
)
from .response_generator import (
    response_generator,
    PersonalizedResponseGenerator,
    ResponseTemplateEngine,
    EmotionController,
    PersonalityAdapter
)
from .termination_manager import (
    termination_manager,
    CallTerminationManager,
    PersistenceDetector,
    FrustrationTracker,
    ResponseEffectivenessAnalyzer,
    TerminationMetrics
)
from .learning_system import (
    conversation_learning_system,
    ConversationLearningSystem,
    PatternRecognizer,
    StrategyOptimizer,
    ResponseEffectivenessTracker,
    ConversationPattern,
    StrategyPerformance,
    LearningInsight
)
from .sentiment_analyzer import sentiment_analyzer, SentimentAnalyzer
from .state_manager import state_manager, StateManager

__all__ = [
    # Service instances
    'azure_openai_service',
    'intent_classifier',
    'conversation_manager',
    'response_generator',
    'termination_manager',
    'conversation_learning_system',
    'sentiment_analyzer',
    'state_manager',
    
    # Service classes
    'AzureOpenAIService',
    'IntentClassifier',
    'ConversationManager',
    'PersonalizedResponseGenerator',
    'CallTerminationManager',
    'ConversationLearningSystem',
    'SentimentAnalyzer',
    'StateManager',
    
    # Supporting classes
    'IntentResult',
    'DialogueStateTracker',
    'ResponseStrategy',
    'ResponseTemplateEngine',
    'EmotionController',
    'PersonalityAdapter',
    'PersistenceDetector',
    'FrustrationTracker',
    'ResponseEffectivenessAnalyzer',
    'TerminationMetrics',
    'PatternRecognizer',
    'StrategyOptimizer',
    'ResponseEffectivenessTracker',
    'ConversationPattern',
    'StrategyPerformance',
    'LearningInsight'
]