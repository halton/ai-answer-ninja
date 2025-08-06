"""
User profiling and behavioral analysis models
"""

import joblib
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
from collections import defaultdict, Counter
from pathlib import Path

from sklearn.cluster import KMeans, DBSCAN
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import silhouette_score
from sklearn.neighbors import LocalOutlierFactor

from app.core.logging import LoggingMixin


class UserProfiler(LoggingMixin):
    """User profiling and behavioral analysis"""
    
    def __init__(self, model_path: str = "./ml/models"):
        super().__init__()
        self.model_path = Path(model_path)
        self.model_path.mkdir(parents=True, exist_ok=True)
        
        # Clustering models for user segmentation
        self.user_clusterer = KMeans(n_clusters=5, random_state=42)
        self.behavior_clusterer = DBSCAN(eps=0.5, min_samples=5)
        
        # Anomaly detection
        self.anomaly_detector = LocalOutlierFactor(n_neighbors=20, contamination=0.1)
        
        # Dimensionality reduction
        self.pca = PCA(n_components=0.95)  # Keep 95% of variance
        self.scaler = StandardScaler()
        
        # Profile templates
        self.personality_profiles = {
            'polite': {
                'characteristics': ['patient', 'formal_language', 'non_confrontational'],
                'response_preferences': ['gentle_decline', 'explain_reason', 'thank_caller'],
                'effectiveness_factors': ['politeness_level', 'response_time', 'conversation_length']
            },
            'direct': {
                'characteristics': ['concise', 'clear_boundaries', 'time_conscious'],
                'response_preferences': ['firm_decline', 'immediate_termination', 'no_explanation'],
                'effectiveness_factors': ['directness', 'call_duration', 'termination_success']
            },
            'humorous': {
                'characteristics': ['playful', 'creative_responses', 'disarming'],
                'response_preferences': ['witty_comeback', 'deflect_with_humor', 'confusion_tactic'],
                'effectiveness_factors': ['humor_appropriateness', 'caller_confusion', 'entertainment_value']
            },
            'professional': {
                'characteristics': ['business_like', 'structured', 'authority_conscious'],
                'response_preferences': ['professional_decline', 'policy_reference', 'escalation_threat'],
                'effectiveness_factors': ['authority_tone', 'policy_compliance', 'professional_language']
            }
        }
        
        # User segments
        self.user_segments = {}
        self.segment_characteristics = {}
        
    def analyze_user_behavior(
        self,
        user_id: str,
        call_history: List[Dict[str, Any]],
        response_history: List[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Comprehensive user behavior analysis"""
        
        if not call_history:
            return self._create_default_profile(user_id)
        
        analysis = {
            'user_id': user_id,
            'analysis_date': datetime.now(),
            'call_patterns': self._analyze_call_patterns(call_history),
            'response_patterns': self._analyze_response_patterns(response_history or []),
            'temporal_patterns': self._analyze_temporal_patterns(call_history),
            'effectiveness_metrics': self._calculate_effectiveness_metrics(call_history),
            'personality_assessment': self._assess_personality(call_history, response_history or []),
            'preferences': self._infer_preferences(call_history, response_history or []),
            'behavioral_insights': self._generate_behavioral_insights(call_history),
        }
        
        return analysis
    
    def _analyze_call_patterns(self, call_history: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Analyze patterns in call handling"""
        
        if not call_history:
            return {}
        
        patterns = {
            'total_calls': len(call_history),
            'spam_calls': sum(1 for call in call_history if call.get('call_type') == 'spam'),
            'legitimate_calls': sum(1 for call in call_history if call.get('call_type') == 'legitimate'),
            'average_duration': np.mean([call.get('duration_seconds', 0) for call in call_history]),
            'total_talk_time': sum(call.get('duration_seconds', 0) for call in call_history),
        }
        
        # Call outcomes
        outcomes = [call.get('call_outcome') for call in call_history]
        outcome_counts = Counter(outcomes)
        patterns['outcome_distribution'] = dict(outcome_counts)
        
        # Success rates
        successful_outcomes = ['blocked_successfully', 'caller_hung_up']
        success_count = sum(1 for outcome in outcomes if outcome in successful_outcomes)
        patterns['success_rate'] = success_count / len(outcomes) if outcomes else 0
        
        # Duration patterns
        durations = [call.get('duration_seconds', 0) for call in call_history if call.get('duration_seconds', 0) > 0]
        if durations:
            patterns.update({
                'min_duration': min(durations),
                'max_duration': max(durations),
                'median_duration': np.median(durations),
                'duration_std': np.std(durations),
                'short_calls_ratio': sum(1 for d in durations if d < 30) / len(durations),
                'long_calls_ratio': sum(1 for d in durations if d > 180) / len(durations),
            })
        
        # Response time patterns
        response_times = [call.get('response_time_ms', 0) for call in call_history if call.get('response_time_ms')]
        if response_times:
            patterns.update({
                'avg_response_time': np.mean(response_times),
                'fast_response_ratio': sum(1 for rt in response_times if rt < 1000) / len(response_times),
                'slow_response_ratio': sum(1 for rt in response_times if rt > 3000) / len(response_times),
            })
        
        return patterns
    
    def _analyze_response_patterns(self, response_history: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Analyze AI response patterns and effectiveness"""
        
        if not response_history:
            return {}
        
        patterns = {
            'total_responses': len(response_history),
            'avg_effectiveness': np.mean([r.get('effectiveness_score', 0) for r in response_history]),
            'response_strategies': Counter([r.get('strategy') for r in response_history if r.get('strategy')]),
            'tone_distribution': Counter([r.get('tone') for r in response_history if r.get('tone')]),
        }
        
        # Strategy effectiveness
        strategy_effectiveness = defaultdict(list)
        for response in response_history:
            strategy = response.get('strategy')
            effectiveness = response.get('effectiveness_score')
            if strategy and effectiveness is not None:
                strategy_effectiveness[strategy].append(effectiveness)
        
        patterns['strategy_effectiveness'] = {
            strategy: np.mean(scores) 
            for strategy, scores in strategy_effectiveness.items()
        }
        
        # Identify successful patterns
        successful_responses = [r for r in response_history if r.get('effectiveness_score', 0) > 0.7]
        if successful_responses:
            successful_strategies = Counter([r.get('strategy') for r in successful_responses if r.get('strategy')])
            patterns['most_successful_strategies'] = successful_strategies.most_common(3)
        
        return patterns
    
    def _analyze_temporal_patterns(self, call_history: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Analyze temporal patterns in calls"""
        
        if not call_history:
            return {}
        
        # Extract timestamps
        timestamps = []
        for call in call_history:
            start_time = call.get('start_time')
            if isinstance(start_time, str):
                try:
                    start_time = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
                    timestamps.append(start_time)
                except ValueError:
                    continue
            elif isinstance(start_time, datetime):
                timestamps.append(start_time)
        
        if not timestamps:
            return {}
        
        # Hour distribution
        hours = [ts.hour for ts in timestamps]
        hour_distribution = Counter(hours)
        
        # Day of week distribution
        days = [ts.weekday() for ts in timestamps]  # 0=Monday
        day_distribution = Counter(days)
        
        # Peak activity times
        peak_hour = hour_distribution.most_common(1)[0][0] if hour_distribution else 12
        peak_day = day_distribution.most_common(1)[0][0] if day_distribution else 1
        
        patterns = {
            'hour_distribution': dict(hour_distribution),
            'day_distribution': dict(day_distribution),
            'peak_hour': peak_hour,
            'peak_day': peak_day,
            'business_hours_calls': sum(1 for h in hours if 9 <= h < 17) / len(hours),
            'weekend_calls': sum(1 for d in days if d >= 5) / len(days),
            'evening_calls': sum(1 for h in hours if 18 <= h < 22) / len(hours),
        }
        
        # Call frequency patterns
        if len(timestamps) > 1:
            timestamps.sort()
            intervals = [(timestamps[i] - timestamps[i-1]).total_seconds() 
                        for i in range(1, len(timestamps))]
            
            if intervals:
                patterns.update({
                    'avg_interval_hours': np.mean(intervals) / 3600,
                    'min_interval_hours': min(intervals) / 3600,
                    'max_interval_hours': max(intervals) / 3600,
                    'interval_consistency': 1 - (np.std(intervals) / np.mean(intervals)) if np.mean(intervals) > 0 else 0,
                })
        
        return patterns
    
    def _calculate_effectiveness_metrics(self, call_history: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Calculate AI effectiveness metrics for the user"""
        
        metrics = {
            'overall_effectiveness': 0.0,
            'spam_detection_accuracy': 0.0,
            'response_appropriateness': 0.0,
            'termination_effectiveness': 0.0,
            'user_satisfaction': 0.0,
        }
        
        if not call_history:
            return metrics
        
        # Overall effectiveness (based on successful outcomes)
        successful_outcomes = ['blocked_successfully', 'caller_hung_up', 'handled_by_ai']
        success_count = sum(1 for call in call_history 
                          if call.get('call_outcome') in successful_outcomes)
        metrics['overall_effectiveness'] = success_count / len(call_history)
        
        # Spam detection accuracy (if feedback available)
        spam_calls_with_feedback = [
            call for call in call_history 
            if call.get('call_type') == 'spam' and call.get('user_feedback')
        ]
        
        if spam_calls_with_feedback:
            correct_detections = sum(
                1 for call in spam_calls_with_feedback
                if call.get('user_feedback') != 'not_spam'
            )
            metrics['spam_detection_accuracy'] = correct_detections / len(spam_calls_with_feedback)
        
        # Response appropriateness (based on user ratings)
        rated_calls = [call for call in call_history if call.get('user_rating')]
        if rated_calls:
            avg_rating = np.mean([call['user_rating'] for call in rated_calls])
            metrics['response_appropriateness'] = (avg_rating - 1) / 4  # Normalize to 0-1
        
        # Termination effectiveness (calls that ended with caller hanging up)
        caller_hangup_count = sum(
            1 for call in call_history 
            if call.get('call_outcome') == 'caller_hung_up'
        )
        metrics['termination_effectiveness'] = caller_hangup_count / len(call_history)
        
        # User satisfaction (based on explicit feedback)
        positive_feedback_count = sum(
            1 for call in call_history
            if call.get('user_feedback') in ['satisfied', 'very_satisfied']
        )
        feedback_count = sum(1 for call in call_history if call.get('user_feedback'))
        if feedback_count > 0:
            metrics['user_satisfaction'] = positive_feedback_count / feedback_count
        
        return metrics
    
    def _assess_personality(
        self, 
        call_history: List[Dict[str, Any]],
        response_history: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Assess user personality type based on interaction patterns"""
        
        personality_scores = {profile: 0.0 for profile in self.personality_profiles.keys()}
        
        if not call_history:
            return {
                'primary_type': 'polite',
                'confidence': 0.0,
                'scores': personality_scores,
                'traits': []
            }
        
        # Analyze call duration preferences
        avg_duration = np.mean([call.get('duration_seconds', 0) for call in call_history])
        
        if avg_duration < 60:  # Short calls preference
            personality_scores['direct'] += 0.3
        elif avg_duration > 180:  # Longer calls tolerance
            personality_scores['polite'] += 0.2
            personality_scores['professional'] += 0.1
        
        # Analyze response preferences
        if response_history:
            strategy_counts = Counter([r.get('strategy') for r in response_history if r.get('strategy')])
            
            for strategy, count in strategy_counts.items():
                weight = count / len(response_history)
                
                if strategy in ['gentle_decline', 'polite_explanation']:
                    personality_scores['polite'] += weight * 0.4
                elif strategy in ['firm_decline', 'immediate_termination']:
                    personality_scores['direct'] += weight * 0.4
                elif strategy in ['witty_response', 'humor']:
                    personality_scores['humorous'] += weight * 0.4
                elif strategy in ['professional_decline', 'policy_reference']:
                    personality_scores['professional'] += weight * 0.4
        
        # Analyze termination patterns
        termination_reasons = [call.get('termination_reason') for call in call_history]
        termination_counts = Counter(termination_reasons)
        
        if termination_counts.get('caller_hangup', 0) > len(call_history) * 0.6:
            personality_scores['direct'] += 0.2
            personality_scores['humorous'] += 0.1
        
        # Analyze user feedback patterns
        feedback_items = [call.get('user_feedback') for call in call_history if call.get('user_feedback')]
        if 'too_aggressive' in feedback_items:
            personality_scores['polite'] += 0.2
        if 'too_passive' in feedback_items:
            personality_scores['direct'] += 0.2
        
        # Determine primary personality type
        primary_type = max(personality_scores.keys(), key=lambda k: personality_scores[k])
        confidence = personality_scores[primary_type]
        
        # Identify prominent traits
        traits = []
        for profile_type, score in personality_scores.items():
            if score > 0.3:  # Significant score
                traits.extend(self.personality_profiles[profile_type]['characteristics'])
        
        return {
            'primary_type': primary_type,
            'confidence': confidence,
            'scores': personality_scores,
            'traits': list(set(traits))
        }
    
    def _infer_preferences(
        self,
        call_history: List[Dict[str, Any]],
        response_history: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Infer user preferences from interaction patterns"""
        
        preferences = {
            'response_style': 'balanced',
            'call_duration': 'medium',
            'termination_method': 'natural',
            'information_sharing': 'minimal',
            'humor_tolerance': 'medium',
            'directness_level': 'medium'
        }
        
        if not call_history:
            return preferences
        
        # Infer response style preferences
        if response_history:
            effectiveness_by_style = defaultdict(list)
            
            for response in response_history:
                style = response.get('tone')
                effectiveness = response.get('effectiveness_score')
                if style and effectiveness is not None:
                    effectiveness_by_style[style].append(effectiveness)
            
            if effectiveness_by_style:
                best_style = max(
                    effectiveness_by_style.keys(),
                    key=lambda s: np.mean(effectiveness_by_style[s])
                )
                preferences['response_style'] = best_style
        
        # Infer call duration preferences
        durations = [call.get('duration_seconds', 0) for call in call_history if call.get('duration_seconds', 0) > 0]
        if durations:
            avg_duration = np.mean(durations)
            if avg_duration < 60:
                preferences['call_duration'] = 'short'
            elif avg_duration > 180:
                preferences['call_duration'] = 'long'
            else:
                preferences['call_duration'] = 'medium'
        
        # Infer termination preferences
        termination_reasons = [call.get('termination_reason') for call in call_history]
        if termination_reasons:
            most_common_termination = Counter(termination_reasons).most_common(1)[0][0]
            if most_common_termination == 'ai_termination':
                preferences['termination_method'] = 'proactive'
            elif most_common_termination == 'caller_hangup':
                preferences['termination_method'] = 'natural'
            else:
                preferences['termination_method'] = 'timeout'
        
        return preferences
    
    def _generate_behavioral_insights(self, call_history: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Generate behavioral insights and patterns"""
        
        insights = {
            'patterns_detected': [],
            'anomalies': [],
            'trends': {},
            'recommendations': []
        }
        
        if len(call_history) < 5:  # Need minimum data for insights
            return insights
        
        # Detect patterns
        patterns = []
        
        # Time-based patterns
        timestamps = []
        for call in call_history:
            start_time = call.get('start_time')
            if isinstance(start_time, str):
                try:
                    start_time = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
                    timestamps.append(start_time)
                except ValueError:
                    continue
        
        if timestamps:
            hours = [ts.hour for ts in timestamps]
            hour_counts = Counter(hours)
            
            # Peak activity detection
            if len(set(hours)) <= 3:  # Concentrated in few hours
                patterns.append("Concentrated calling hours - consistent spam targeting")
            
            # Business hours pattern
            business_hours = sum(1 for h in hours if 9 <= h < 17)
            if business_hours / len(hours) > 0.8:
                patterns.append("Primarily business hours calls - professional spam operation")
        
        # Duration patterns
        durations = [call.get('duration_seconds', 0) for call in call_history]
        if durations:
            duration_consistency = 1 - (np.std(durations) / np.mean(durations)) if np.mean(durations) > 0 else 0
            
            if duration_consistency > 0.7:
                patterns.append("Consistent call durations - automated or scripted approach")
        
        insights['patterns_detected'] = patterns
        
        # Generate recommendations
        recommendations = []
        
        avg_success_rate = sum(
            1 for call in call_history 
            if call.get('call_outcome') in ['blocked_successfully', 'caller_hung_up']
        ) / len(call_history)
        
        if avg_success_rate < 0.6:
            recommendations.append("Consider adjusting AI response strategy for better effectiveness")
        
        if np.mean(durations) > 120:
            recommendations.append("Calls are relatively long - consider more aggressive termination strategies")
        
        insights['recommendations'] = recommendations
        
        return insights
    
    def _create_default_profile(self, user_id: str) -> Dict[str, Any]:
        """Create default profile for users with no history"""
        
        return {
            'user_id': user_id,
            'analysis_date': datetime.now(),
            'call_patterns': {'total_calls': 0},
            'response_patterns': {},
            'temporal_patterns': {},
            'effectiveness_metrics': {
                'overall_effectiveness': 0.5,
                'spam_detection_accuracy': 0.5,
                'response_appropriateness': 0.5,
                'termination_effectiveness': 0.5,
                'user_satisfaction': 0.5,
            },
            'personality_assessment': {
                'primary_type': 'polite',
                'confidence': 0.0,
                'scores': {profile: 0.0 for profile in self.personality_profiles.keys()},
                'traits': []
            },
            'preferences': {
                'response_style': 'balanced',
                'call_duration': 'medium',
                'termination_method': 'natural',
                'information_sharing': 'minimal',
                'humor_tolerance': 'medium',
                'directness_level': 'medium'
            },
            'behavioral_insights': {
                'patterns_detected': [],
                'anomalies': [],
                'trends': {},
                'recommendations': ['Collect more interaction data for better profiling']
            }
        }
    
    def cluster_users(
        self,
        user_profiles: List[Dict[str, Any]],
        n_clusters: int = 5
    ) -> Dict[str, Any]:
        """Cluster users based on behavioral patterns"""
        
        if len(user_profiles) < n_clusters:
            return {'error': 'Not enough users for clustering'}
        
        try:
            # Extract features for clustering
            features = []
            user_ids = []
            
            for profile in user_profiles:
                user_ids.append(profile['user_id'])
                
                # Create feature vector
                feature_vector = [
                    profile['call_patterns'].get('total_calls', 0),
                    profile['call_patterns'].get('spam_calls', 0),
                    profile['call_patterns'].get('average_duration', 0),
                    profile['call_patterns'].get('success_rate', 0),
                    profile['effectiveness_metrics'].get('overall_effectiveness', 0),
                    profile['effectiveness_metrics'].get('user_satisfaction', 0),
                    profile['temporal_patterns'].get('business_hours_calls', 0),
                    profile['temporal_patterns'].get('weekend_calls', 0),
                ]
                
                # Add personality scores
                personality_scores = profile['personality_assessment'].get('scores', {})
                for personality_type in self.personality_profiles.keys():
                    feature_vector.append(personality_scores.get(personality_type, 0))
                
                features.append(feature_vector)
            
            # Standardize features
            features_array = np.array(features)
            features_scaled = self.scaler.fit_transform(features_array)
            
            # Perform clustering
            self.user_clusterer.n_clusters = min(n_clusters, len(features))
            cluster_labels = self.user_clusterer.fit_predict(features_scaled)
            
            # Calculate silhouette score
            if len(set(cluster_labels)) > 1:
                silhouette = silhouette_score(features_scaled, cluster_labels)
            else:
                silhouette = 0.0
            
            # Analyze clusters
            cluster_analysis = {}
            for cluster_id in set(cluster_labels):
                cluster_indices = [i for i, label in enumerate(cluster_labels) if label == cluster_id]
                cluster_profiles = [user_profiles[i] for i in cluster_indices]
                
                # Calculate cluster characteristics
                cluster_characteristics = self._analyze_cluster_characteristics(cluster_profiles)
                
                cluster_analysis[f'cluster_{cluster_id}'] = {
                    'size': len(cluster_indices),
                    'user_ids': [user_ids[i] for i in cluster_indices],
                    'characteristics': cluster_characteristics
                }
            
            return {
                'n_clusters': len(set(cluster_labels)),
                'silhouette_score': silhouette,
                'cluster_labels': dict(zip(user_ids, cluster_labels.tolist())),
                'cluster_analysis': cluster_analysis,
                'clustering_date': datetime.now()
            }
            
        except Exception as e:
            self.logger.error(f"Error clustering users: {e}")
            return {'error': str(e)}
    
    def _analyze_cluster_characteristics(self, cluster_profiles: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Analyze characteristics of a user cluster"""
        
        characteristics = {
            'avg_total_calls': np.mean([p['call_patterns'].get('total_calls', 0) for p in cluster_profiles]),
            'avg_success_rate': np.mean([p['call_patterns'].get('success_rate', 0) for p in cluster_profiles]),
            'avg_effectiveness': np.mean([p['effectiveness_metrics'].get('overall_effectiveness', 0) for p in cluster_profiles]),
            'dominant_personality': Counter([p['personality_assessment'].get('primary_type') for p in cluster_profiles]).most_common(1)[0][0] if cluster_profiles else 'unknown',
            'common_preferences': {},
            'behavioral_patterns': []
        }
        
        # Analyze common preferences
        all_preferences = [p.get('preferences', {}) for p in cluster_profiles]
        if all_preferences:
            for pref_key in ['response_style', 'call_duration', 'termination_method']:
                pref_values = [prefs.get(pref_key) for prefs in all_preferences if prefs.get(pref_key)]
                if pref_values:
                    characteristics['common_preferences'][pref_key] = Counter(pref_values).most_common(1)[0][0]
        
        return characteristics
    
    def save_profiler(self, version: str = None) -> str:
        """Save user profiler models"""
        
        if version is None:
            version = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        save_path = self.model_path / f"user_profiler_{version}"
        save_path.mkdir(parents=True, exist_ok=True)
        
        try:
            # Save clustering models
            joblib.dump(self.user_clusterer, save_path / "user_clusterer.joblib")
            joblib.dump(self.behavior_clusterer, save_path / "behavior_clusterer.joblib")
            joblib.dump(self.anomaly_detector, save_path / "anomaly_detector.joblib")
            joblib.dump(self.pca, save_path / "pca.joblib")
            joblib.dump(self.scaler, save_path / "scaler.joblib")
            
            # Save metadata
            metadata = {
                'version': version,
                'personality_profiles': self.personality_profiles,
                'user_segments': self.user_segments,
                'segment_characteristics': self.segment_characteristics,
                'save_date': datetime.now()
            }
            
            joblib.dump(metadata, save_path / "metadata.joblib")
            
            self.logger.info(f"User profiler saved to {save_path}")
            return str(save_path)
            
        except Exception as e:
            self.logger.error(f"Error saving user profiler: {e}")
            raise
    
    def load_profiler(self, version: str = None) -> bool:
        """Load user profiler models"""
        
        if version is None:
            # Find the latest version
            pattern = "user_profiler_*"
            model_dirs = list(self.model_path.glob(pattern))
            if not model_dirs:
                self.logger.warning("No saved profiler models found")
                return False
            
            latest_dir = max(model_dirs, key=lambda p: p.stat().st_ctime)
        else:
            latest_dir = self.model_path / f"user_profiler_{version}"
        
        if not latest_dir.exists():
            self.logger.warning(f"Profiler directory {latest_dir} not found")
            return False
        
        try:
            # Load models
            self.user_clusterer = joblib.load(latest_dir / "user_clusterer.joblib")
            self.behavior_clusterer = joblib.load(latest_dir / "behavior_clusterer.joblib")
            self.anomaly_detector = joblib.load(latest_dir / "anomaly_detector.joblib")
            self.pca = joblib.load(latest_dir / "pca.joblib")
            self.scaler = joblib.load(latest_dir / "scaler.joblib")
            
            # Load metadata
            metadata_file = latest_dir / "metadata.joblib"
            if metadata_file.exists():
                metadata = joblib.load(metadata_file)
                self.user_segments = metadata.get('user_segments', {})
                self.segment_characteristics = metadata.get('segment_characteristics', {})
            
            self.logger.info(f"User profiler loaded from {latest_dir}")
            return True
            
        except Exception as e:
            self.logger.error(f"Error loading user profiler: {e}")
            return False