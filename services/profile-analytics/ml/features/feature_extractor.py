"""
Feature extraction for spam detection and user profiling
"""

import re
import hashlib
import statistics
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
from collections import Counter, defaultdict

import pandas as pd
import numpy as np
from textblob import TextBlob
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import StandardScaler, MinMaxScaler

from app.core.logging import LoggingMixin


class TemporalFeatureExtractor(LoggingMixin):
    """Extract temporal features from call data"""
    
    def extract_call_timing_features(self, call_data: Dict[str, Any]) -> Dict[str, float]:
        """Extract timing-based features from call data"""
        features = {}
        
        try:
            start_time = call_data.get('start_time')
            if isinstance(start_time, str):
                start_time = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
            
            if start_time:
                # Time of day features
                hour = start_time.hour
                minute = start_time.minute
                
                features.update({
                    'hour_of_day': hour,
                    'minute_of_hour': minute,
                    'is_morning': 1.0 if 6 <= hour < 12 else 0.0,
                    'is_afternoon': 1.0 if 12 <= hour < 18 else 0.0,
                    'is_evening': 1.0 if 18 <= hour < 22 else 0.0,
                    'is_night': 1.0 if hour >= 22 or hour < 6 else 0.0,
                    'is_business_hours': 1.0 if 9 <= hour < 17 else 0.0,
                    'is_weekend': 1.0 if start_time.weekday() >= 5 else 0.0,
                    'day_of_week': float(start_time.weekday()),
                    'day_of_month': float(start_time.day),
                })
                
                # Cyclical encoding for time features
                features.update({
                    'hour_sin': np.sin(2 * np.pi * hour / 24),
                    'hour_cos': np.cos(2 * np.pi * hour / 24),
                    'day_sin': np.sin(2 * np.pi * start_time.weekday() / 7),
                    'day_cos': np.cos(2 * np.pi * start_time.weekday() / 7),
                })
            
            # Duration features
            duration = call_data.get('duration_seconds', 0)
            features.update({
                'call_duration': float(duration),
                'is_short_call': 1.0 if duration < 30 else 0.0,
                'is_medium_call': 1.0 if 30 <= duration < 180 else 0.0,
                'is_long_call': 1.0 if duration >= 180 else 0.0,
                'duration_log': np.log1p(duration),
            })
            
            # Response time features
            response_time = call_data.get('response_time_ms', 0)
            features.update({
                'response_time': float(response_time),
                'response_time_log': np.log1p(response_time),
                'is_fast_response': 1.0 if response_time < 1000 else 0.0,
                'is_slow_response': 1.0 if response_time > 3000 else 0.0,
            })
            
        except Exception as e:
            self.logger.error(f"Error extracting temporal features: {e}")
            
        return features
    
    def extract_pattern_features(self, call_history: List[Dict[str, Any]]) -> Dict[str, float]:
        """Extract pattern features from call history"""
        features = {}
        
        if not call_history:
            return features
        
        try:
            # Call frequency features
            total_calls = len(call_history)
            features['total_historical_calls'] = float(total_calls)
            
            # Time between calls
            if total_calls > 1:
                timestamps = []
                for call in call_history:
                    start_time = call.get('start_time')
                    if isinstance(start_time, str):
                        start_time = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
                    timestamps.append(start_time)
                
                timestamps.sort()
                intervals = [(timestamps[i] - timestamps[i-1]).total_seconds() 
                            for i in range(1, len(timestamps))]
                
                if intervals:
                    features.update({
                        'avg_time_between_calls': np.mean(intervals),
                        'min_time_between_calls': np.min(intervals),
                        'max_time_between_calls': np.max(intervals),
                        'std_time_between_calls': np.std(intervals) if len(intervals) > 1 else 0,
                        'median_time_between_calls': np.median(intervals),
                    })
            
            # Call duration patterns
            durations = [call.get('duration_seconds', 0) for call in call_history]
            durations = [d for d in durations if d > 0]
            
            if durations:
                features.update({
                    'avg_call_duration': np.mean(durations),
                    'min_call_duration': np.min(durations),
                    'max_call_duration': np.max(durations),
                    'std_call_duration': np.std(durations) if len(durations) > 1 else 0,
                    'median_call_duration': np.median(durations),
                })
            
            # Time of day patterns
            hours = []
            for call in call_history:
                start_time = call.get('start_time')
                if isinstance(start_time, str):
                    start_time = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
                hours.append(start_time.hour)
            
            if hours:
                hour_counts = Counter(hours)
                features.update({
                    'most_common_hour': float(hour_counts.most_common(1)[0][0]),
                    'hour_diversity': len(set(hours)) / 24.0,
                    'calls_in_business_hours': sum(1 for h in hours if 9 <= h < 17) / len(hours),
                })
            
        except Exception as e:
            self.logger.error(f"Error extracting pattern features: {e}")
            
        return features


class TextFeatureExtractor(LoggingMixin):
    """Extract linguistic features from call transcripts"""
    
    def __init__(self):
        super().__init__()
        self.tfidf_vectorizer = TfidfVectorizer(
            max_features=100,
            stop_words='english',
            ngram_range=(1, 2)
        )
        self.spam_keywords = self._load_spam_keywords()
    
    def _load_spam_keywords(self) -> Dict[str, List[str]]:
        """Load spam keywords by category"""
        return {
            'sales': [
                'free', 'offer', 'discount', 'limited time', 'act now',
                'special offer', 'promotion', 'sale', 'deal', 'save money'
            ],
            'loan': [
                'loan', 'borrow', 'credit', 'debt', 'interest rate',
                'mortgage', 'refinance', 'cash advance', 'approval'
            ],
            'investment': [
                'investment', 'stock', 'trading', 'profit', 'returns',
                'portfolio', 'financial advisor', 'wealth', 'money making'
            ],
            'insurance': [
                'insurance', 'policy', 'premium', 'coverage', 'claim',
                'protection', 'health insurance', 'life insurance'
            ],
            'urgency': [
                'urgent', 'immediately', 'expire', 'deadline', 'limited',
                'act fast', 'don\'t miss', 'last chance', 'final notice'
            ]
        }
    
    def extract_text_features(self, transcript: str) -> Dict[str, float]:
        """Extract linguistic features from transcript"""
        features = {}
        
        if not transcript or not transcript.strip():
            return self._get_empty_text_features()
        
        try:
            text = transcript.lower().strip()
            
            # Basic text statistics
            words = text.split()
            sentences = re.split(r'[.!?]+', text)
            sentences = [s.strip() for s in sentences if s.strip()]
            
            features.update({
                'text_length': float(len(text)),
                'word_count': float(len(words)),
                'sentence_count': float(len(sentences)),
                'avg_word_length': np.mean([len(word) for word in words]) if words else 0,
                'avg_sentence_length': np.mean([len(s.split()) for s in sentences]) if sentences else 0,
                'unique_words': len(set(words)) / len(words) if words else 0,
            })
            
            # Keyword matching features
            for category, keywords in self.spam_keywords.items():
                count = sum(1 for keyword in keywords if keyword in text)
                features[f'{category}_keywords'] = float(count)
                features[f'has_{category}_keywords'] = 1.0 if count > 0 else 0.0
            
            # Sentiment analysis
            blob = TextBlob(text)
            features.update({
                'sentiment_polarity': blob.sentiment.polarity,
                'sentiment_subjectivity': blob.sentiment.subjectivity,
                'is_positive_sentiment': 1.0 if blob.sentiment.polarity > 0.1 else 0.0,
                'is_negative_sentiment': 1.0 if blob.sentiment.polarity < -0.1 else 0.0,
            })
            
            # Language patterns
            features.update({
                'question_count': float(text.count('?')),
                'exclamation_count': float(text.count('!')),
                'has_phone_number': 1.0 if re.search(r'\b\d{10,}\b', text) else 0.0,
                'has_email': 1.0 if re.search(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', text) else 0.0,
                'has_url': 1.0 if re.search(r'http[s]?://|www\.', text) else 0.0,
                'uppercase_ratio': sum(1 for c in text if c.isupper()) / len(text) if text else 0,
                'digit_ratio': sum(1 for c in text if c.isdigit()) / len(text) if text else 0,
            })
            
            # Repetition patterns
            word_counts = Counter(words)
            if word_counts:
                max_word_freq = word_counts.most_common(1)[0][1]
                features.update({
                    'max_word_frequency': float(max_word_freq),
                    'repetition_ratio': max_word_freq / len(words) if words else 0,
                })
            
        except Exception as e:
            self.logger.error(f"Error extracting text features: {e}")
            features.update(self._get_empty_text_features())
            
        return features
    
    def _get_empty_text_features(self) -> Dict[str, float]:
        """Return default features when text is empty or invalid"""
        features = {
            'text_length': 0.0,
            'word_count': 0.0,
            'sentence_count': 0.0,
            'avg_word_length': 0.0,
            'avg_sentence_length': 0.0,
            'unique_words': 0.0,
            'sentiment_polarity': 0.0,
            'sentiment_subjectivity': 0.0,
            'is_positive_sentiment': 0.0,
            'is_negative_sentiment': 0.0,
            'question_count': 0.0,
            'exclamation_count': 0.0,
            'has_phone_number': 0.0,
            'has_email': 0.0,
            'has_url': 0.0,
            'uppercase_ratio': 0.0,
            'digit_ratio': 0.0,
            'max_word_frequency': 0.0,
            'repetition_ratio': 0.0,
        }
        
        # Add category keyword features
        for category in self.spam_keywords.keys():
            features[f'{category}_keywords'] = 0.0
            features[f'has_{category}_keywords'] = 0.0
            
        return features
    
    def extract_tfidf_features(self, transcripts: List[str]) -> np.ndarray:
        """Extract TF-IDF features from multiple transcripts"""
        try:
            # Clean and prepare texts
            cleaned_texts = []
            for transcript in transcripts:
                if transcript and transcript.strip():
                    cleaned_texts.append(transcript.lower().strip())
                else:
                    cleaned_texts.append(" ")
            
            # Fit and transform
            tfidf_matrix = self.tfidf_vectorizer.fit_transform(cleaned_texts)
            return tfidf_matrix.toarray()
            
        except Exception as e:
            self.logger.error(f"Error extracting TF-IDF features: {e}")
            return np.zeros((len(transcripts), 100))


class BehavioralFeatureExtractor(LoggingMixin):
    """Extract behavioral features from call interactions"""
    
    def extract_conversation_features(self, conversation_data: Dict[str, Any]) -> Dict[str, float]:
        """Extract features from conversation flow"""
        features = {}
        
        try:
            ai_responses = conversation_data.get('ai_responses', [])
            conversation_flow = conversation_data.get('conversation_flow', {})
            
            # Turn-taking features
            turn_count = conversation_flow.get('turn_count', 0)
            features.update({
                'total_turns': float(turn_count),
                'turns_per_minute': turn_count / (conversation_data.get('duration_seconds', 1) / 60),
                'avg_turn_length': conversation_flow.get('average_turn_length', 0),
            })
            
            # AI response effectiveness
            if ai_responses:
                response_times = [r.get('response_time_ms', 0) for r in ai_responses]
                effectiveness_scores = [r.get('effectiveness_score', 0) for r in ai_responses]
                
                features.update({
                    'avg_ai_response_time': np.mean(response_times) if response_times else 0,
                    'min_ai_response_time': np.min(response_times) if response_times else 0,
                    'max_ai_response_time': np.max(response_times) if response_times else 0,
                    'avg_effectiveness_score': np.mean(effectiveness_scores) if effectiveness_scores else 0,
                    'response_consistency': 1 - np.std(response_times) / np.mean(response_times) if response_times else 0,
                })
            
            # Termination analysis
            termination_reason = conversation_data.get('termination_reason', 'unknown')
            features.update({
                'terminated_by_caller': 1.0 if termination_reason == 'caller_hangup' else 0.0,
                'terminated_by_ai': 1.0 if termination_reason == 'ai_termination' else 0.0,
                'terminated_by_timeout': 1.0 if termination_reason == 'timeout' else 0.0,
                'successful_termination': 1.0 if termination_reason in ['caller_hangup', 'ai_termination'] else 0.0,
            })
            
            # Conversation coherence
            coherence_score = conversation_flow.get('coherence_score', 0)
            features['conversation_coherence'] = float(coherence_score)
            
        except Exception as e:
            self.logger.error(f"Error extracting conversation features: {e}")
            
        return features
    
    def extract_caller_behavior_features(self, caller_data: Dict[str, Any]) -> Dict[str, float]:
        """Extract caller behavioral features"""
        features = {}
        
        try:
            # Persistence patterns
            features.update({
                'persistence_score': caller_data.get('persistence_score', 0),
                'interruption_count': caller_data.get('interruption_count', 0),
                'question_asking_rate': caller_data.get('question_asking_rate', 0),
                'topic_switching_rate': caller_data.get('topic_switching_rate', 0),
            })
            
            # Emotional indicators
            emotional_indicators = caller_data.get('emotional_indicators', {})
            features.update({
                'anger_level': emotional_indicators.get('anger', 0),
                'frustration_level': emotional_indicators.get('frustration', 0),
                'urgency_level': emotional_indicators.get('urgency', 0),
                'politeness_level': emotional_indicators.get('politeness', 0),
            })
            
            # Voice characteristics
            voice_features = caller_data.get('voice_characteristics', {})
            features.update({
                'speech_rate': voice_features.get('speech_rate', 0),
                'pitch_variance': voice_features.get('pitch_variance', 0),
                'volume_level': voice_features.get('volume_level', 0),
                'background_noise': voice_features.get('background_noise_level', 0),
            })
            
        except Exception as e:
            self.logger.error(f"Error extracting caller behavior features: {e}")
            
        return features


class FeatureProcessor(LoggingMixin):
    """Process and normalize extracted features"""
    
    def __init__(self):
        super().__init__()
        self.scalers = {}
        self.feature_importance = {}
    
    def create_feature_vector(
        self, 
        call_data: Dict[str, Any],
        call_history: List[Dict[str, Any]] = None,
        transcript: str = None
    ) -> Dict[str, float]:
        """Create comprehensive feature vector"""
        
        all_features = {}
        
        try:
            # Extract temporal features
            temporal_extractor = TemporalFeatureExtractor()
            temporal_features = temporal_extractor.extract_call_timing_features(call_data)
            all_features.update({f'temporal_{k}': v for k, v in temporal_features.items()})
            
            # Extract pattern features if history available
            if call_history:
                pattern_features = temporal_extractor.extract_pattern_features(call_history)
                all_features.update({f'pattern_{k}': v for k, v in pattern_features.items()})
            
            # Extract text features if transcript available
            if transcript:
                text_extractor = TextFeatureExtractor()
                text_features = text_extractor.extract_text_features(transcript)
                all_features.update({f'text_{k}': v for k, v in text_features.items()})
            
            # Extract behavioral features
            behavioral_extractor = BehavioralFeatureExtractor()
            conv_features = behavioral_extractor.extract_conversation_features(call_data)
            all_features.update({f'conversation_{k}': v for k, v in conv_features.items()})
            
            caller_features = behavioral_extractor.extract_caller_behavior_features(
                call_data.get('caller_characteristics', {})
            )
            all_features.update({f'caller_{k}': v for k, v in caller_features.items()})
            
        except Exception as e:
            self.logger.error(f"Error creating feature vector: {e}")
        
        return all_features
    
    def normalize_features(
        self, 
        features: Dict[str, float],
        scaler_type: str = "standard"
    ) -> Dict[str, float]:
        """Normalize feature values"""
        
        try:
            feature_array = np.array(list(features.values())).reshape(1, -1)
            feature_names = list(features.keys())
            
            if scaler_type not in self.scalers:
                if scaler_type == "standard":
                    self.scalers[scaler_type] = StandardScaler()
                elif scaler_type == "minmax":
                    self.scalers[scaler_type] = MinMaxScaler()
                else:
                    raise ValueError(f"Unknown scaler type: {scaler_type}")
            
            scaler = self.scalers[scaler_type]
            
            # Fit scaler if not already fitted
            if not hasattr(scaler, 'mean_') and not hasattr(scaler, 'scale_'):
                # For single sample, we can't fit properly, so return original
                self.logger.warning("Cannot fit scaler on single sample, returning original features")
                return features
            
            normalized_array = scaler.transform(feature_array)
            
            return dict(zip(feature_names, normalized_array[0]))
            
        except Exception as e:
            self.logger.error(f"Error normalizing features: {e}")
            return features
    
    def select_important_features(
        self,
        features: Dict[str, float],
        top_k: int = 50
    ) -> Dict[str, float]:
        """Select most important features based on stored importance scores"""
        
        if not self.feature_importance:
            # Return all features if no importance scores available
            return features
        
        try:
            # Sort features by importance
            sorted_features = sorted(
                features.items(),
                key=lambda x: self.feature_importance.get(x[0], 0),
                reverse=True
            )
            
            # Return top k features
            return dict(sorted_features[:top_k])
            
        except Exception as e:
            self.logger.error(f"Error selecting important features: {e}")
            return features
    
    def update_feature_importance(self, importance_scores: Dict[str, float]) -> None:
        """Update feature importance scores"""
        self.feature_importance.update(importance_scores)
        self.logger.info(f"Updated importance scores for {len(importance_scores)} features")