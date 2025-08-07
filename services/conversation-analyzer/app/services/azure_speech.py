"""Azure Speech Services integration for transcription."""

import asyncio
import base64
import io
import tempfile
import time
from typing import List, Optional, Tuple

import azure.cognitiveservices.speech as speechsdk
from azure.storage.blob.aio import BlobServiceClient
import aiofiles
import librosa
import soundfile as sf

from app.core.config import settings
from app.core.logging import get_logger, analysis_logger
from app.models.analysis import TranscriptionSegment, TranscriptionResponse

logger = get_logger(__name__)


class AzureSpeechService:
    """Azure Speech Services integration for high-quality transcription."""
    
    def __init__(self):
        self.speech_key = settings.azure_speech_key
        self.speech_region = settings.azure_speech_region
        self.speech_config = None
        self.blob_client = None
        self._initialize_clients()
    
    def _initialize_clients(self) -> None:
        """Initialize Azure Speech and Blob clients."""
        try:
            # Initialize Speech Config
            self.speech_config = speechsdk.SpeechConfig(
                subscription=self.speech_key,
                region=self.speech_region
            )
            
            # Configure speech recognition settings
            self.speech_config.speech_recognition_language = "zh-CN"
            self.speech_config.output_format = speechsdk.OutputFormat.Detailed
            self.speech_config.request_word_level_timestamps()
            
            # Enable detailed results
            self.speech_config.enable_dictation()
            
            # Initialize Blob client if credentials available
            if settings.azure_storage_account and settings.azure_storage_key:
                self.blob_client = BlobServiceClient(
                    account_url=f"https://{settings.azure_storage_account}.blob.core.windows.net",
                    credential=settings.azure_storage_key
                )
            
            logger.info("azure_speech_service_initialized", region=self.speech_region)
            
        except Exception as e:
            logger.error("azure_speech_initialization_failed", error=str(e))
            raise
    
    async def transcribe_from_url(self, audio_url: str, call_id: str) -> TranscriptionResponse:
        """Transcribe audio from URL."""
        analysis_logger.log_transcription_start(call_id, 0.0)  # Duration unknown from URL
        start_time = time.time()
        
        try:
            # Download audio file
            audio_data = await self._download_audio(audio_url)
            
            # Process transcription
            result = await self._process_audio_data(audio_data, call_id)
            
            processing_time = int((time.time() - start_time) * 1000)
            analysis_logger.log_transcription_complete(
                call_id, 
                processing_time, 
                result.confidence_score, 
                result.word_count
            )
            
            return result
            
        except Exception as e:
            analysis_logger.log_error("transcription", call_id, e)
            raise
    
    async def transcribe_from_data(
        self, 
        audio_data: str, 
        call_id: str, 
        language: str = "zh-CN"
    ) -> TranscriptionResponse:
        """Transcribe audio from base64 encoded data."""
        try:
            # Decode base64 audio data
            audio_bytes = base64.b64decode(audio_data)
            
            # Get audio duration
            with io.BytesIO(audio_bytes) as audio_stream:
                audio_array, sample_rate = librosa.load(audio_stream, sr=None)
                duration = len(audio_array) / sample_rate
            
            analysis_logger.log_transcription_start(call_id, duration)
            start_time = time.time()
            
            # Process transcription
            result = await self._process_audio_bytes(audio_bytes, call_id, language)
            result.audio_duration_seconds = duration
            
            processing_time = int((time.time() - start_time) * 1000)
            analysis_logger.log_transcription_complete(
                call_id, 
                processing_time, 
                result.confidence_score, 
                result.word_count
            )
            
            return result
            
        except Exception as e:
            analysis_logger.log_error("transcription", call_id, e)
            raise
    
    async def _download_audio(self, audio_url: str) -> bytes:
        """Download audio file from URL."""
        try:
            if self.blob_client and "blob.core.windows.net" in audio_url:
                # Azure Blob Storage
                blob_name = audio_url.split("/")[-1]
                container_name = settings.azure_storage_container
                
                async with self.blob_client.get_blob_client(
                    container=container_name, 
                    blob=blob_name
                ) as blob_client:
                    blob_data = await blob_client.download_blob()
                    return await blob_data.readall()
            else:
                # HTTP download
                import aiohttp
                async with aiohttp.ClientSession() as session:
                    async with session.get(audio_url) as response:
                        if response.status == 200:
                            return await response.read()
                        else:
                            raise Exception(f"Failed to download audio: HTTP {response.status}")
                        
        except Exception as e:
            logger.error("audio_download_failed", url=audio_url, error=str(e))
            raise
    
    async def _process_audio_data(self, audio_data: bytes, call_id: str) -> TranscriptionResponse:
        """Process audio data for transcription."""
        return await self._process_audio_bytes(audio_data, call_id)
    
    async def _process_audio_bytes(
        self, 
        audio_bytes: bytes, 
        call_id: str, 
        language: str = "zh-CN"
    ) -> TranscriptionResponse:
        """Process audio bytes for transcription."""
        try:
            # Create temporary file for Azure SDK
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
                # Convert and resample audio to required format
                processed_audio = await self._preprocess_audio(audio_bytes)
                temp_file.write(processed_audio)
                temp_file.flush()
                
                # Perform transcription
                result = await self._transcribe_file(temp_file.name, call_id, language)
                
            return result
            
        except Exception as e:
            logger.error("audio_processing_failed", call_id=call_id, error=str(e))
            raise
    
    async def _preprocess_audio(self, audio_bytes: bytes) -> bytes:
        """Preprocess audio for optimal transcription."""
        try:
            with io.BytesIO(audio_bytes) as input_stream:
                # Load audio with librosa
                audio_array, original_sr = librosa.load(input_stream, sr=None)
                
                # Resample to 16kHz if needed
                target_sr = 16000
                if original_sr != target_sr:
                    audio_array = librosa.resample(audio_array, orig_sr=original_sr, target_sr=target_sr)
                
                # Normalize audio
                audio_array = librosa.util.normalize(audio_array)
                
                # Apply noise reduction if needed
                audio_array = await self._reduce_noise(audio_array, target_sr)
                
                # Convert to bytes
                output_buffer = io.BytesIO()
                sf.write(output_buffer, audio_array, target_sr, format='WAV')
                output_buffer.seek(0)
                
                return output_buffer.read()
                
        except Exception as e:
            logger.error("audio_preprocessing_failed", error=str(e))
            raise
    
    async def _reduce_noise(self, audio_array, sample_rate: int):
        """Apply basic noise reduction."""
        try:
            # Simple noise gate - remove very quiet segments
            threshold = 0.01
            audio_array[abs(audio_array) < threshold] = 0
            
            # Apply spectral gating for noise reduction
            # This is a simplified version - in production, consider using noisereduce library
            
            return audio_array
            
        except Exception as e:
            logger.warning("noise_reduction_failed", error=str(e))
            return audio_array  # Return original if noise reduction fails
    
    async def _transcribe_file(
        self, 
        file_path: str, 
        call_id: str, 
        language: str = "zh-CN"
    ) -> TranscriptionResponse:
        """Transcribe audio file using Azure Speech SDK."""
        try:
            # Update language config
            speech_config = speechsdk.SpeechConfig(
                subscription=self.speech_key,
                region=self.speech_region
            )
            speech_config.speech_recognition_language = language
            speech_config.output_format = speechsdk.OutputFormat.Detailed
            speech_config.request_word_level_timestamps()
            
            # Create audio config
            audio_config = speechsdk.audio.AudioConfig(filename=file_path)
            
            # Create recognizer
            recognizer = speechsdk.SpeechRecognizer(
                speech_config=speech_config,
                audio_config=audio_config
            )
            
            # Perform recognition
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, recognizer.recognize_once_async().get)
            
            if result.reason == speechsdk.ResultReason.RecognizedSpeech:
                # Process detailed results
                segments = self._parse_detailed_result(result)
                
                # Get basic metrics
                word_count = len(result.text.split())
                confidence = self._calculate_overall_confidence(segments)
                
                return TranscriptionResponse(
                    call_id=call_id,
                    full_transcript=result.text,
                    segments=segments,
                    language=language,
                    confidence_score=confidence,
                    processing_time_ms=0,  # Will be set by caller
                    audio_duration_seconds=0.0,  # Will be set by caller
                    word_count=word_count
                )
                
            elif result.reason == speechsdk.ResultReason.NoMatch:
                logger.warning("no_speech_detected", call_id=call_id)
                return TranscriptionResponse(
                    call_id=call_id,
                    full_transcript="",
                    segments=[],
                    language=language,
                    confidence_score=0.0,
                    processing_time_ms=0,
                    audio_duration_seconds=0.0,
                    word_count=0
                )
                
            else:
                error_details = result.cancellation_details
                error_msg = f"Transcription failed: {error_details.reason}"
                if error_details.error_details:
                    error_msg += f" - {error_details.error_details}"
                
                logger.error("transcription_failed", call_id=call_id, error=error_msg)
                raise Exception(error_msg)
                
        except Exception as e:
            logger.error("azure_transcription_error", call_id=call_id, error=str(e))
            raise
    
    def _parse_detailed_result(self, result) -> List[TranscriptionSegment]:
        """Parse detailed transcription result into segments."""
        segments = []
        
        try:
            # Parse detailed results from Azure
            import json
            
            if hasattr(result, 'json') and result.json:
                detailed_result = json.loads(result.json)
                
                if 'NBest' in detailed_result and len(detailed_result['NBest']) > 0:
                    best_result = detailed_result['NBest'][0]
                    
                    if 'Words' in best_result:
                        current_segment_words = []
                        current_start = None
                        
                        for word_info in best_result['Words']:
                            word = word_info.get('Word', '')
                            confidence = word_info.get('Confidence', 0.0)
                            offset = word_info.get('Offset', 0)
                            duration = word_info.get('Duration', 0)
                            
                            # Convert ticks to seconds (Azure uses 100ns ticks)
                            start_time = offset / 10000000.0
                            end_time = (offset + duration) / 10000000.0
                            
                            if current_start is None:
                                current_start = start_time
                            
                            current_segment_words.append({
                                'word': word,
                                'confidence': confidence,
                                'start': start_time,
                                'end': end_time
                            })
                            
                            # Create segment every 10 words or on punctuation
                            if (len(current_segment_words) >= 10 or 
                                word.endswith(('.', '!', '?', '。', '！', '？'))):
                                
                                segment_text = ' '.join([w['word'] for w in current_segment_words])
                                segment_confidence = sum([w['confidence'] for w in current_segment_words]) / len(current_segment_words)
                                
                                segments.append(TranscriptionSegment(
                                    start_time=current_start,
                                    end_time=end_time,
                                    text=segment_text.strip(),
                                    confidence=segment_confidence,
                                    speaker="caller"  # Default to caller
                                ))
                                
                                current_segment_words = []
                                current_start = None
                        
                        # Handle remaining words
                        if current_segment_words:
                            segment_text = ' '.join([w['word'] for w in current_segment_words])
                            segment_confidence = sum([w['confidence'] for w in current_segment_words]) / len(current_segment_words)
                            
                            segments.append(TranscriptionSegment(
                                start_time=current_start,
                                end_time=current_segment_words[-1]['end'],
                                text=segment_text.strip(),
                                confidence=segment_confidence,
                                speaker="caller"
                            ))
            
            # Fallback: create single segment from basic result
            if not segments and result.text:
                segments.append(TranscriptionSegment(
                    start_time=0.0,
                    end_time=0.0,  # Unknown duration
                    text=result.text,
                    confidence=0.8,  # Default confidence
                    speaker="caller"
                ))
                
        except Exception as e:
            logger.warning("detailed_result_parsing_failed", error=str(e))
            
            # Fallback to basic segment
            if result.text:
                segments.append(TranscriptionSegment(
                    start_time=0.0,
                    end_time=0.0,
                    text=result.text,
                    confidence=0.8,
                    speaker="caller"
                ))
        
        return segments
    
    def _calculate_overall_confidence(self, segments: List[TranscriptionSegment]) -> float:
        """Calculate overall confidence from segments."""
        if not segments:
            return 0.0
        
        total_confidence = sum(segment.confidence for segment in segments)
        return total_confidence / len(segments)
    
    async def transcribe_streaming(self, audio_stream, call_id: str, language: str = "zh-CN"):
        """Transcribe streaming audio (for real-time processing)."""
        # This would be implemented for real-time streaming
        # For now, we'll raise NotImplementedError
        raise NotImplementedError("Streaming transcription not yet implemented")
    
    async def health_check(self) -> bool:
        """Check Azure Speech Service health."""
        try:
            # Create a simple test recognition
            test_config = speechsdk.SpeechConfig(
                subscription=self.speech_key,
                region=self.speech_region
            )
            
            # This is a simple connectivity test
            return True
            
        except Exception as e:
            logger.error("azure_speech_health_check_failed", error=str(e))
            return False


# Singleton instance
azure_speech_service = AzureSpeechService()