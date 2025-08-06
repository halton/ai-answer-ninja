"""
Spam detection and classification models
"""

import joblib
import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, List, Any, Optional, Tuple, Union
from pathlib import Path

from sklearn.ensemble import (
    RandomForestClassifier, 
    GradientBoostingClassifier, 
    VotingClassifier
)
from sklearn.linear_model import LogisticRegression
from sklearn.svm import SVC
from sklearn.naive_bayes import GaussianNB
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    confusion_matrix, classification_report, roc_auc_score
)
from sklearn.calibration import CalibratedClassifierCV
from xgboost import XGBClassifier
from lightgbm import LGBMClassifier

from app.core.logging import LoggingMixin


class SpamClassifier(LoggingMixin):
    """Multi-model spam classifier with ensemble voting"""
    
    def __init__(self, model_path: str = "./ml/models"):
        super().__init__()
        self.model_path = Path(model_path)
        self.model_path.mkdir(parents=True, exist_ok=True)
        
        # Initialize models
        self.models = {
            'random_forest': RandomForestClassifier(
                n_estimators=100,
                max_depth=10,
                min_samples_split=5,
                min_samples_leaf=2,
                class_weight='balanced',
                random_state=42
            ),
            'xgboost': XGBClassifier(
                n_estimators=100,
                max_depth=6,
                learning_rate=0.1,
                subsample=0.8,
                colsample_bytree=0.8,
                random_state=42,
                eval_metric='logloss'
            ),
            'lightgbm': LGBMClassifier(
                n_estimators=100,
                max_depth=6,
                learning_rate=0.1,
                feature_fraction=0.8,
                bagging_fraction=0.8,
                random_state=42,
                verbose=-1
            ),
            'logistic_regression': LogisticRegression(
                max_iter=1000,
                class_weight='balanced',
                random_state=42
            ),
            'gradient_boosting': GradientBoostingClassifier(
                n_estimators=100,
                max_depth=6,
                learning_rate=0.1,
                random_state=42
            )
        }
        
        # Ensemble model
        self.ensemble_model = None
        self.calibrated_models = {}
        
        # Feature importance tracking
        self.feature_importance = {}
        self.training_history = []
        
        # Performance metrics
        self.model_performance = {}
        
    def train(
        self,
        X_train: pd.DataFrame,
        y_train: pd.Series,
        X_val: pd.DataFrame = None,
        y_val: pd.Series = None,
        use_ensemble: bool = True
    ) -> Dict[str, Any]:
        """Train spam classification models"""
        
        self.logger.info("Starting spam classifier training")
        
        training_results = {
            'model_scores': {},
            'feature_importance': {},
            'training_time': {},
            'validation_scores': {}
        }
        
        # Train individual models
        for model_name, model in self.models.items():
            self.logger.info(f"Training {model_name}")
            
            start_time = datetime.now()
            
            try:
                # Train model
                model.fit(X_train, y_train)
                
                # Training performance
                train_pred = model.predict(X_train)
                train_score = accuracy_score(y_train, train_pred)
                training_results['model_scores'][model_name] = train_score
                
                # Validation performance
                if X_val is not None and y_val is not None:
                    val_pred = model.predict(X_val)
                    val_score = accuracy_score(y_val, val_pred)
                    training_results['validation_scores'][model_name] = val_score
                
                # Feature importance (if available)
                if hasattr(model, 'feature_importances_'):
                    importance = dict(zip(X_train.columns, model.feature_importances_))
                    training_results['feature_importance'][model_name] = importance
                
                # Training time
                training_time = (datetime.now() - start_time).total_seconds()
                training_results['training_time'][model_name] = training_time
                
                # Calibrate model for probability prediction
                self.calibrated_models[model_name] = CalibratedClassifierCV(
                    model, method='isotonic', cv=3
                )
                self.calibrated_models[model_name].fit(X_train, y_train)
                
                self.logger.info(f"{model_name} training completed - Score: {train_score:.3f}")
                
            except Exception as e:
                self.logger.error(f"Error training {model_name}: {e}")
                continue
        
        # Create ensemble model
        if use_ensemble and len(self.models) > 2:
            self.logger.info("Creating ensemble model")
            
            try:
                # Use top performing models for ensemble
                model_items = [(name, model) for name, model in self.models.items()]
                
                self.ensemble_model = VotingClassifier(
                    estimators=model_items,
                    voting='soft'  # Use predicted probabilities
                )
                
                self.ensemble_model.fit(X_train, y_train)
                
                # Evaluate ensemble
                ensemble_train_pred = self.ensemble_model.predict(X_train)
                ensemble_train_score = accuracy_score(y_train, ensemble_train_pred)
                training_results['model_scores']['ensemble'] = ensemble_train_score
                
                if X_val is not None and y_val is not None:
                    ensemble_val_pred = self.ensemble_model.predict(X_val)
                    ensemble_val_score = accuracy_score(y_val, ensemble_val_pred)
                    training_results['validation_scores']['ensemble'] = ensemble_val_score
                
                self.logger.info(f"Ensemble model created - Score: {ensemble_train_score:.3f}")
                
            except Exception as e:
                self.logger.error(f"Error creating ensemble model: {e}")
        
        # Store training history
        self.training_history.append({
            'timestamp': datetime.now(),
            'results': training_results,
            'data_shape': X_train.shape
        })
        
        return training_results
    
    def predict(
        self,
        X: pd.DataFrame,
        model_name: str = 'ensemble',
        return_probabilities: bool = True
    ) -> Union[np.ndarray, Tuple[np.ndarray, np.ndarray]]:
        """Make spam predictions"""
        
        if model_name == 'ensemble' and self.ensemble_model is not None:
            model = self.ensemble_model
        elif model_name in self.calibrated_models:
            model = self.calibrated_models[model_name]
        elif model_name in self.models:
            model = self.models[model_name]
        else:
            raise ValueError(f"Model {model_name} not found or not trained")
        
        # Make predictions
        predictions = model.predict(X)
        
        if return_probabilities:
            if hasattr(model, 'predict_proba'):
                probabilities = model.predict_proba(X)
                return predictions, probabilities
            else:
                # For models without predict_proba, return confidence scores
                if hasattr(model, 'decision_function'):
                    confidence = model.decision_function(X)
                    # Convert to probabilities using sigmoid
                    probabilities = 1 / (1 + np.exp(-confidence))
                    return predictions, probabilities.reshape(-1, 1)
        
        return predictions
    
    def predict_spam_probability(
        self,
        features: Dict[str, float],
        feature_names: List[str]
    ) -> Dict[str, Any]:
        """Predict spam probability for a single sample"""
        
        try:
            # Create DataFrame from features
            feature_vector = []
            for name in feature_names:
                feature_vector.append(features.get(name, 0.0))
            
            X = pd.DataFrame([feature_vector], columns=feature_names)
            
            # Get predictions from ensemble or best model
            if self.ensemble_model is not None:
                model = self.ensemble_model
                model_name = 'ensemble'
            else:
                # Use the best performing model
                if self.model_performance:
                    best_model_name = max(
                        self.model_performance.keys(),
                        key=lambda x: self.model_performance[x].get('f1_score', 0)
                    )
                    model = self.calibrated_models.get(best_model_name) or self.models[best_model_name]
                    model_name = best_model_name
                else:
                    # Default to random forest
                    model = self.calibrated_models.get('random_forest') or self.models['random_forest']
                    model_name = 'random_forest'
            
            prediction = model.predict(X)[0]
            
            if hasattr(model, 'predict_proba'):
                probabilities = model.predict_proba(X)[0]
                spam_probability = probabilities[1] if len(probabilities) > 1 else probabilities[0]
            else:
                spam_probability = 0.5  # Default uncertainty
            
            # Risk level assessment
            if spam_probability < 0.3:
                risk_level = "low"
            elif spam_probability < 0.7:
                risk_level = "medium"
            else:
                risk_level = "high"
            
            return {
                'is_spam': bool(prediction),
                'spam_probability': float(spam_probability),
                'confidence_score': float(max(spam_probability, 1 - spam_probability)),
                'risk_level': risk_level,
                'model_used': model_name,
                'timestamp': datetime.now()
            }
            
        except Exception as e:
            self.logger.error(f"Error predicting spam probability: {e}")
            return {
                'is_spam': False,
                'spam_probability': 0.5,
                'confidence_score': 0.0,
                'risk_level': "unknown",
                'model_used': "error",
                'error': str(e),
                'timestamp': datetime.now()
            }
    
    def evaluate(
        self,
        X_test: pd.DataFrame,
        y_test: pd.Series,
        model_name: str = 'ensemble'
    ) -> Dict[str, Any]:
        """Evaluate model performance"""
        
        predictions, probabilities = self.predict(
            X_test, model_name=model_name, return_probabilities=True
        )
        
        # Calculate metrics
        accuracy = accuracy_score(y_test, predictions)
        precision = precision_score(y_test, predictions, average='weighted', zero_division=0)
        recall = recall_score(y_test, predictions, average='weighted', zero_division=0)
        f1 = f1_score(y_test, predictions, average='weighted', zero_division=0)
        
        # ROC AUC (if binary classification)
        try:
            if len(np.unique(y_test)) == 2 and probabilities.shape[1] == 2:
                auc = roc_auc_score(y_test, probabilities[:, 1])
            else:
                auc = None
        except Exception:
            auc = None
        
        # Confusion matrix
        cm = confusion_matrix(y_test, predictions)
        
        # Classification report
        report = classification_report(y_test, predictions, output_dict=True)
        
        performance = {
            'accuracy': accuracy,
            'precision': precision,
            'recall': recall,
            'f1_score': f1,
            'auc_score': auc,
            'confusion_matrix': cm.tolist(),
            'classification_report': report,
            'test_size': len(y_test),
            'evaluation_date': datetime.now()
        }
        
        # Store performance
        self.model_performance[model_name] = performance
        
        self.logger.info(f"Model {model_name} evaluation - F1: {f1:.3f}, Accuracy: {accuracy:.3f}")
        
        return performance
    
    def get_feature_importance(
        self,
        model_name: str = 'ensemble',
        top_k: int = 20
    ) -> Dict[str, float]:
        """Get feature importance from trained models"""
        
        if model_name == 'ensemble' and self.ensemble_model is not None:
            # Aggregate feature importance from ensemble models
            all_importance = {}
            
            for estimator_name, estimator in self.ensemble_model.named_estimators_.items():
                if hasattr(estimator, 'feature_importances_'):
                    importance = estimator.feature_importances_
                    for i, imp in enumerate(importance):
                        feature_name = f"feature_{i}"  # This should be mapped to actual feature names
                        all_importance[feature_name] = all_importance.get(feature_name, 0) + imp
            
            # Average importance across models
            num_models = len(self.ensemble_model.named_estimators_)
            for feature in all_importance:
                all_importance[feature] /= num_models
            
        elif model_name in self.models:
            model = self.models[model_name]
            if hasattr(model, 'feature_importances_'):
                # Map importance to feature names
                all_importance = dict(enumerate(model.feature_importances_))
            else:
                return {}
        else:
            return {}
        
        # Sort by importance and return top k
        sorted_importance = sorted(
            all_importance.items(),
            key=lambda x: x[1],
            reverse=True
        )
        
        return dict(sorted_importance[:top_k])
    
    def save_models(self, version: str = None) -> str:
        """Save trained models to disk"""
        
        if version is None:
            version = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        save_path = self.model_path / f"spam_classifier_{version}"
        save_path.mkdir(parents=True, exist_ok=True)
        
        try:
            # Save individual models
            for model_name, model in self.models.items():
                model_file = save_path / f"{model_name}.joblib"
                joblib.dump(model, model_file)
            
            # Save calibrated models
            for model_name, model in self.calibrated_models.items():
                model_file = save_path / f"{model_name}_calibrated.joblib"
                joblib.dump(model, model_file)
            
            # Save ensemble model
            if self.ensemble_model is not None:
                ensemble_file = save_path / "ensemble.joblib"
                joblib.dump(self.ensemble_model, ensemble_file)
            
            # Save metadata
            metadata = {
                'version': version,
                'training_history': self.training_history,
                'model_performance': self.model_performance,
                'feature_importance': self.feature_importance,
                'save_date': datetime.now()
            }
            
            metadata_file = save_path / "metadata.joblib"
            joblib.dump(metadata, metadata_file)
            
            self.logger.info(f"Models saved to {save_path}")
            return str(save_path)
            
        except Exception as e:
            self.logger.error(f"Error saving models: {e}")
            raise
    
    def load_models(self, version: str = None) -> bool:
        """Load trained models from disk"""
        
        if version is None:
            # Find the latest version
            pattern = "spam_classifier_*"
            model_dirs = list(self.model_path.glob(pattern))
            if not model_dirs:
                self.logger.warning("No saved models found")
                return False
            
            # Sort by creation time and take the latest
            latest_dir = max(model_dirs, key=lambda p: p.stat().st_ctime)
        else:
            latest_dir = self.model_path / f"spam_classifier_{version}"
            
        if not latest_dir.exists():
            self.logger.warning(f"Model directory {latest_dir} not found")
            return False
        
        try:
            # Load individual models
            for model_name in self.models.keys():
                model_file = latest_dir / f"{model_name}.joblib"
                if model_file.exists():
                    self.models[model_name] = joblib.load(model_file)
                    
                    # Load calibrated version if available
                    calibrated_file = latest_dir / f"{model_name}_calibrated.joblib"
                    if calibrated_file.exists():
                        self.calibrated_models[model_name] = joblib.load(calibrated_file)
            
            # Load ensemble model
            ensemble_file = latest_dir / "ensemble.joblib"
            if ensemble_file.exists():
                self.ensemble_model = joblib.load(ensemble_file)
            
            # Load metadata
            metadata_file = latest_dir / "metadata.joblib"
            if metadata_file.exists():
                metadata = joblib.load(metadata_file)
                self.training_history = metadata.get('training_history', [])
                self.model_performance = metadata.get('model_performance', {})
                self.feature_importance = metadata.get('feature_importance', {})
            
            self.logger.info(f"Models loaded from {latest_dir}")
            return True
            
        except Exception as e:
            self.logger.error(f"Error loading models: {e}")
            return False
    
    def update_model(
        self,
        new_X: pd.DataFrame,
        new_y: pd.Series,
        retrain_threshold: float = 0.1
    ) -> bool:
        """Update model with new data if performance degradation detected"""
        
        if self.ensemble_model is None:
            self.logger.warning("No trained model to update")
            return False
        
        try:
            # Evaluate current model on new data
            current_performance = self.evaluate(new_X, new_y)
            
            # Check if retraining is needed
            if self.model_performance.get('ensemble', {}).get('f1_score', 0) - current_performance['f1_score'] > retrain_threshold:
                self.logger.info("Performance degradation detected, retraining model")
                
                # Combine with historical data (if available)
                # This is simplified - in practice, you'd want to manage training data more carefully
                training_results = self.train(new_X, new_y)
                
                self.logger.info("Model updated successfully")
                return True
            else:
                self.logger.info("Model performance still acceptable, no update needed")
                return False
                
        except Exception as e:
            self.logger.error(f"Error updating model: {e}")
            return False