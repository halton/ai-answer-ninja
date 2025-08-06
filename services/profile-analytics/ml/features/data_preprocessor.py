"""
Data preprocessing for machine learning models
"""

import hashlib
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple, Union
from collections import defaultdict

from sklearn.preprocessing import LabelEncoder, StandardScaler, RobustScaler
from sklearn.impute import SimpleImputer, KNNImputer
from sklearn.model_selection import train_test_split
from sklearn.utils import resample

from app.core.logging import LoggingMixin


class DataCleaner(LoggingMixin):
    """Clean and validate data before processing"""
    
    def __init__(self):
        super().__init__()
        self.phone_hasher = hashlib.sha256
        
    def hash_phone_number(self, phone_number: str) -> str:
        """Hash phone number for privacy"""
        if not phone_number:
            return ""
        
        # Normalize phone number (remove non-digits)
        normalized = ''.join(filter(str.isdigit, phone_number))
        
        # Hash with salt for additional security
        salt = "ai_answer_ninja_phone_salt"
        to_hash = f"{normalized}_{salt}".encode('utf-8')
        
        return self.phone_hasher(to_hash).hexdigest()
    
    def clean_call_data(self, call_data: Dict[str, Any]) -> Dict[str, Any]:
        """Clean and validate call data"""
        cleaned_data = call_data.copy()
        
        try:
            # Hash phone number
            if 'caller_phone' in cleaned_data:
                cleaned_data['caller_phone_hash'] = self.hash_phone_number(
                    cleaned_data['caller_phone']
                )
                # Remove original phone number for privacy
                del cleaned_data['caller_phone']
            
            # Validate and clean timestamps
            timestamp_fields = ['start_time', 'end_time', 'created_at', 'updated_at']
            for field in timestamp_fields:
                if field in cleaned_data and cleaned_data[field]:
                    cleaned_data[field] = self._normalize_timestamp(cleaned_data[field])
            
            # Validate numeric fields
            numeric_fields = ['duration_seconds', 'response_time_ms']
            for field in numeric_fields:
                if field in cleaned_data:
                    cleaned_data[field] = self._clean_numeric(cleaned_data[field])
            
            # Clean text fields
            text_fields = ['transcript_summary', 'user_feedback']
            for field in text_fields:
                if field in cleaned_data and cleaned_data[field]:
                    cleaned_data[field] = self._clean_text(cleaned_data[field])
            
            # Validate JSON fields
            json_fields = ['audio_features', 'intent_classification', 'sentiment_analysis']
            for field in json_fields:
                if field in cleaned_data and cleaned_data[field]:
                    if not isinstance(cleaned_data[field], (dict, list)):
                        self.logger.warning(f"Invalid JSON field {field}, setting to empty dict")
                        cleaned_data[field] = {}
            
        except Exception as e:
            self.logger.error(f"Error cleaning call data: {e}")
        
        return cleaned_data
    
    def _normalize_timestamp(self, timestamp: Union[str, datetime]) -> datetime:
        """Normalize timestamp to datetime object"""
        if isinstance(timestamp, str):
            try:
                # Handle various timestamp formats
                if 'T' in timestamp:
                    timestamp = timestamp.replace('Z', '+00:00')
                    return datetime.fromisoformat(timestamp)
                else:
                    return datetime.strptime(timestamp, '%Y-%m-%d %H:%M:%S')
            except ValueError as e:
                self.logger.warning(f"Invalid timestamp format: {timestamp}, using current time")
                return datetime.utcnow()
        elif isinstance(timestamp, datetime):
            return timestamp
        else:
            return datetime.utcnow()
    
    def _clean_numeric(self, value: Any) -> float:
        """Clean and validate numeric values"""
        if value is None:
            return 0.0
        
        try:
            cleaned_value = float(value)
            # Check for reasonable bounds
            if cleaned_value < 0:
                return 0.0
            # Cap extremely large values
            if cleaned_value > 1e10:
                return 1e10
            return cleaned_value
        except (ValueError, TypeError):
            return 0.0
    
    def _clean_text(self, text: str) -> str:
        """Clean text data"""
        if not text:
            return ""
        
        # Basic text cleaning
        cleaned = text.strip()
        # Remove excessive whitespace
        cleaned = ' '.join(cleaned.split())
        # Limit text length for memory efficiency
        if len(cleaned) > 10000:
            cleaned = cleaned[:10000]
        
        return cleaned
    
    def detect_outliers(
        self, 
        data: pd.DataFrame, 
        columns: List[str],
        method: str = "iqr"
    ) -> pd.Series:
        """Detect outliers in numeric data"""
        
        outlier_mask = pd.Series([False] * len(data), index=data.index)
        
        for column in columns:
            if column not in data.columns:
                continue
                
            if method == "iqr":
                Q1 = data[column].quantile(0.25)
                Q3 = data[column].quantile(0.75)
                IQR = Q3 - Q1
                lower_bound = Q1 - 1.5 * IQR
                upper_bound = Q3 + 1.5 * IQR
                column_outliers = (data[column] < lower_bound) | (data[column] > upper_bound)
                
            elif method == "zscore":
                z_scores = np.abs((data[column] - data[column].mean()) / data[column].std())
                column_outliers = z_scores > 3
                
            else:
                raise ValueError(f"Unknown outlier detection method: {method}")
            
            outlier_mask = outlier_mask | column_outliers
        
        return outlier_mask


class DataTransformer(LoggingMixin):
    """Transform data for machine learning"""
    
    def __init__(self):
        super().__init__()
        self.label_encoders = {}
        self.scalers = {}
        self.imputers = {}
        
    def encode_categorical_features(
        self, 
        data: pd.DataFrame, 
        categorical_columns: List[str]
    ) -> pd.DataFrame:
        """Encode categorical features"""
        
        transformed_data = data.copy()
        
        for column in categorical_columns:
            if column not in data.columns:
                continue
            
            # Handle missing values
            transformed_data[column] = transformed_data[column].fillna('unknown')
            
            # Create or use existing label encoder
            if column not in self.label_encoders:
                self.label_encoders[column] = LabelEncoder()
                # Fit on current data
                unique_values = transformed_data[column].unique()
                self.label_encoders[column].fit(unique_values)
            
            encoder = self.label_encoders[column]
            
            # Handle unseen categories
            known_categories = set(encoder.classes_)
            unknown_mask = ~transformed_data[column].isin(known_categories)
            
            if unknown_mask.any():
                # Add 'unknown' category if not present
                if 'unknown' not in known_categories:
                    encoder.classes_ = np.append(encoder.classes_, 'unknown')
                
                transformed_data.loc[unknown_mask, column] = 'unknown'
            
            # Transform
            transformed_data[column] = encoder.transform(transformed_data[column])
        
        return transformed_data
    
    def create_interaction_features(
        self, 
        data: pd.DataFrame,
        feature_pairs: List[Tuple[str, str]]
    ) -> pd.DataFrame:
        """Create interaction features between specified pairs"""
        
        transformed_data = data.copy()
        
        for feature1, feature2 in feature_pairs:
            if feature1 in data.columns and feature2 in data.columns:
                interaction_name = f"{feature1}_x_{feature2}"
                transformed_data[interaction_name] = (
                    transformed_data[feature1] * transformed_data[feature2]
                )
        
        return transformed_data
    
    def create_temporal_aggregations(
        self,
        data: pd.DataFrame,
        timestamp_column: str,
        value_columns: List[str],
        window_sizes: List[str] = ['1D', '7D', '30D']
    ) -> pd.DataFrame:
        """Create temporal aggregations"""
        
        if timestamp_column not in data.columns:
            return data
        
        # Ensure timestamp is datetime
        data[timestamp_column] = pd.to_datetime(data[timestamp_column])
        data = data.sort_values(timestamp_column)
        
        aggregated_data = data.copy()
        
        for window_size in window_sizes:
            for value_column in value_columns:
                if value_column not in data.columns:
                    continue
                
                # Rolling aggregations
                window_data = data.set_index(timestamp_column)[value_column].rolling(window_size)
                
                aggregated_data[f"{value_column}_{window_size}_mean"] = window_data.mean().values
                aggregated_data[f"{value_column}_{window_size}_std"] = window_data.std().values
                aggregated_data[f"{value_column}_{window_size}_max"] = window_data.max().values
                aggregated_data[f"{value_column}_{window_size}_min"] = window_data.min().values
        
        return aggregated_data
    
    def handle_missing_values(
        self,
        data: pd.DataFrame,
        strategy: str = "mean",
        columns: Optional[List[str]] = None
    ) -> pd.DataFrame:
        """Handle missing values in data"""
        
        if columns is None:
            columns = data.select_dtypes(include=[np.number]).columns.tolist()
        
        transformed_data = data.copy()
        
        if strategy not in self.imputers:
            if strategy in ["mean", "median", "most_frequent", "constant"]:
                self.imputers[strategy] = SimpleImputer(strategy=strategy)
            elif strategy == "knn":
                self.imputers[strategy] = KNNImputer(n_neighbors=5)
            else:
                raise ValueError(f"Unknown imputation strategy: {strategy}")
        
        imputer = self.imputers[strategy]
        
        # Fit and transform numeric columns
        numeric_columns = [col for col in columns if col in transformed_data.columns]
        if numeric_columns:
            transformed_data[numeric_columns] = imputer.fit_transform(
                transformed_data[numeric_columns]
            )
        
        return transformed_data
    
    def scale_features(
        self,
        data: pd.DataFrame,
        method: str = "standard",
        columns: Optional[List[str]] = None
    ) -> pd.DataFrame:
        """Scale numeric features"""
        
        if columns is None:
            columns = data.select_dtypes(include=[np.number]).columns.tolist()
        
        transformed_data = data.copy()
        
        if method not in self.scalers:
            if method == "standard":
                self.scalers[method] = StandardScaler()
            elif method == "robust":
                self.scalers[method] = RobustScaler()
            else:
                raise ValueError(f"Unknown scaling method: {method}")
        
        scaler = self.scalers[method]
        
        # Scale specified columns
        columns_to_scale = [col for col in columns if col in transformed_data.columns]
        if columns_to_scale:
            transformed_data[columns_to_scale] = scaler.fit_transform(
                transformed_data[columns_to_scale]
            )
        
        return transformed_data


class DataSplitter(LoggingMixin):
    """Split data for training and evaluation"""
    
    def temporal_split(
        self,
        data: pd.DataFrame,
        timestamp_column: str,
        train_ratio: float = 0.7,
        val_ratio: float = 0.15,
        test_ratio: float = 0.15
    ) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        """Split data temporally to avoid data leakage"""
        
        if abs(train_ratio + val_ratio + test_ratio - 1.0) > 1e-6:
            raise ValueError("Ratios must sum to 1.0")
        
        # Sort by timestamp
        sorted_data = data.sort_values(timestamp_column)
        
        n = len(sorted_data)
        train_end = int(n * train_ratio)
        val_end = int(n * (train_ratio + val_ratio))
        
        train_data = sorted_data.iloc[:train_end]
        val_data = sorted_data.iloc[train_end:val_end]
        test_data = sorted_data.iloc[val_end:]
        
        self.logger.info(f"Temporal split: Train={len(train_data)}, Val={len(val_data)}, Test={len(test_data)}")
        
        return train_data, val_data, test_data
    
    def stratified_split(
        self,
        X: pd.DataFrame,
        y: pd.Series,
        test_size: float = 0.2,
        val_size: float = 0.2,
        random_state: int = 42
    ) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.Series, pd.Series, pd.Series]:
        """Stratified split maintaining class balance"""
        
        # First split: train+val vs test
        X_temp, X_test, y_temp, y_test = train_test_split(
            X, y, 
            test_size=test_size, 
            stratify=y, 
            random_state=random_state
        )
        
        # Second split: train vs val
        val_size_adjusted = val_size / (1 - test_size)
        X_train, X_val, y_train, y_val = train_test_split(
            X_temp, y_temp,
            test_size=val_size_adjusted,
            stratify=y_temp,
            random_state=random_state
        )
        
        self.logger.info(f"Stratified split: Train={len(X_train)}, Val={len(X_val)}, Test={len(X_test)}")
        
        return X_train, X_val, X_test, y_train, y_val, y_test
    
    def balance_dataset(
        self,
        X: pd.DataFrame,
        y: pd.Series,
        strategy: str = "undersample",
        random_state: int = 42
    ) -> Tuple[pd.DataFrame, pd.Series]:
        """Balance dataset classes"""
        
        # Combine X and y for resampling
        combined = X.copy()
        combined['target'] = y
        
        # Get class counts
        class_counts = y.value_counts()
        self.logger.info(f"Original class distribution: {class_counts.to_dict()}")
        
        if strategy == "undersample":
            # Undersample to minority class size
            min_count = class_counts.min()
            balanced_data = []
            
            for class_label in class_counts.index:
                class_data = combined[combined['target'] == class_label]
                if len(class_data) > min_count:
                    class_data = resample(
                        class_data,
                        n_samples=min_count,
                        random_state=random_state
                    )
                balanced_data.append(class_data)
            
            balanced_combined = pd.concat(balanced_data, ignore_index=True)
            
        elif strategy == "oversample":
            # Oversample to majority class size
            max_count = class_counts.max()
            balanced_data = []
            
            for class_label in class_counts.index:
                class_data = combined[combined['target'] == class_label]
                if len(class_data) < max_count:
                    class_data = resample(
                        class_data,
                        n_samples=max_count,
                        random_state=random_state,
                        replace=True
                    )
                balanced_data.append(class_data)
            
            balanced_combined = pd.concat(balanced_data, ignore_index=True)
            
        else:
            raise ValueError(f"Unknown balancing strategy: {strategy}")
        
        # Shuffle the balanced data
        balanced_combined = balanced_combined.sample(frac=1, random_state=random_state)
        
        # Separate features and target
        balanced_X = balanced_combined.drop('target', axis=1)
        balanced_y = balanced_combined['target']
        
        balanced_class_counts = balanced_y.value_counts()
        self.logger.info(f"Balanced class distribution: {balanced_class_counts.to_dict()}")
        
        return balanced_X, balanced_y


class DataPipeline(LoggingMixin):
    """Complete data preprocessing pipeline"""
    
    def __init__(self):
        super().__init__()
        self.cleaner = DataCleaner()
        self.transformer = DataTransformer()
        self.splitter = DataSplitter()
        self.preprocessing_steps = []
    
    def preprocess_for_training(
        self,
        raw_data: List[Dict[str, Any]],
        target_column: str,
        categorical_columns: List[str] = None,
        numeric_columns: List[str] = None,
        timestamp_column: str = None,
        test_size: float = 0.2,
        balance_classes: bool = True
    ) -> Dict[str, Any]:
        """Complete preprocessing pipeline for training data"""
        
        self.logger.info("Starting data preprocessing pipeline")
        
        # Step 1: Clean data
        cleaned_data = []
        for item in raw_data:
            cleaned_item = self.cleaner.clean_call_data(item)
            cleaned_data.append(cleaned_item)
        
        # Convert to DataFrame
        df = pd.DataFrame(cleaned_data)
        self.logger.info(f"Loaded {len(df)} samples with {len(df.columns)} features")
        
        # Step 2: Handle missing values
        if numeric_columns:
            df = self.transformer.handle_missing_values(df, columns=numeric_columns)
        
        # Step 3: Encode categorical features
        if categorical_columns:
            df = self.transformer.encode_categorical_features(df, categorical_columns)
        
        # Step 4: Create interaction features (optional)
        if len(df.columns) > 5:  # Only if we have enough features
            feature_pairs = [
                ('duration_seconds', 'response_time_ms'),
                ('spam_confidence', 'risk_score')
            ]
            # Only use pairs where both features exist
            valid_pairs = [
                (f1, f2) for f1, f2 in feature_pairs 
                if f1 in df.columns and f2 in df.columns
            ]
            if valid_pairs:
                df = self.transformer.create_interaction_features(df, valid_pairs)
        
        # Step 5: Scale features
        if numeric_columns:
            available_numeric = [col for col in numeric_columns if col in df.columns]
            if available_numeric:
                df = self.transformer.scale_features(df, columns=available_numeric)
        
        # Step 6: Split features and target
        if target_column not in df.columns:
            raise ValueError(f"Target column '{target_column}' not found in data")
        
        X = df.drop(target_column, axis=1)
        y = df[target_column]
        
        # Step 7: Balance classes if requested
        if balance_classes and len(y.unique()) > 1:
            X, y = self.splitter.balance_dataset(X, y)
        
        # Step 8: Split data
        if timestamp_column and timestamp_column in df.columns:
            # Temporal split
            combined_df = X.copy()
            combined_df[target_column] = y
            train_df, val_df, test_df = self.splitter.temporal_split(
                combined_df, timestamp_column
            )
            
            X_train = train_df.drop(target_column, axis=1)
            y_train = train_df[target_column]
            X_val = val_df.drop(target_column, axis=1)
            y_val = val_df[target_column]
            X_test = test_df.drop(target_column, axis=1)
            y_test = test_df[target_column]
        else:
            # Stratified split
            X_train, X_val, X_test, y_train, y_val, y_test = self.splitter.stratified_split(
                X, y, test_size=test_size
            )
        
        # Store preprocessing info
        preprocessing_info = {
            'categorical_columns': categorical_columns or [],
            'numeric_columns': numeric_columns or [],
            'feature_names': list(X.columns),
            'target_column': target_column,
            'class_distribution': y.value_counts().to_dict(),
            'preprocessing_steps': self.preprocessing_steps
        }
        
        result = {
            'X_train': X_train,
            'X_val': X_val,
            'X_test': X_test,
            'y_train': y_train,
            'y_val': y_val,
            'y_test': y_test,
            'preprocessing_info': preprocessing_info,
            'transformers': {
                'label_encoders': self.transformer.label_encoders,
                'scalers': self.transformer.scalers,
                'imputers': self.transformer.imputers
            }
        }
        
        self.logger.info("Data preprocessing pipeline completed successfully")
        
        return result
    
    def preprocess_for_prediction(
        self,
        raw_data: Dict[str, Any],
        transformers: Dict[str, Any],
        feature_names: List[str]
    ) -> pd.DataFrame:
        """Preprocess single sample for prediction"""
        
        # Clean data
        cleaned_data = self.cleaner.clean_call_data(raw_data)
        
        # Convert to DataFrame
        df = pd.DataFrame([cleaned_data])
        
        # Apply transformations using stored transformers
        label_encoders = transformers.get('label_encoders', {})
        scalers = transformers.get('scalers', {})
        imputers = transformers.get('imputers', {})
        
        # Handle categorical columns
        for column, encoder in label_encoders.items():
            if column in df.columns:
                # Handle unseen categories
                known_categories = set(encoder.classes_)
                value = df[column].iloc[0]
                
                if value not in known_categories:
                    if 'unknown' in known_categories:
                        df[column] = 'unknown'
                    else:
                        # Use most frequent class
                        df[column] = encoder.classes_[0]
                
                df[column] = encoder.transform(df[column])
        
        # Handle missing values
        numeric_columns = df.select_dtypes(include=[np.number]).columns.tolist()
        if numeric_columns and 'mean' in imputers:
            df[numeric_columns] = imputers['mean'].transform(df[numeric_columns])
        
        # Scale features
        if numeric_columns and 'standard' in scalers:
            df[numeric_columns] = scalers['standard'].transform(df[numeric_columns])
        
        # Ensure all required features are present
        for feature in feature_names:
            if feature not in df.columns:
                df[feature] = 0.0  # Default value for missing features
        
        # Select only the required features in the correct order
        df = df[feature_names]
        
        return df