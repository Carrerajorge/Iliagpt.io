from typing import List, Optional
from pydantic import Field
from .base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput
from ..core.registry import ToolRegistry

try:
    from langdetect import detect, detect_langs, LangDetectException
    LANGDETECT_AVAILABLE = True
except ImportError:
    LANGDETECT_AVAILABLE = False
    LangDetectException = Exception  # type: ignore[misc, assignment]

class TextAnalyzeInput(ToolInput):
    text: str = Field(..., min_length=1, max_length=50000)
    analyses: List[str] = Field(default=["language", "sentiment", "keywords"])

class TextAnalyzeOutput(ToolOutput):
    language: Optional[str] = None
    sentiment: Optional[str] = None
    sentiment_score: Optional[float] = None
    keywords: List[str] = []
    word_count: int = 0
    char_count: int = 0

@ToolRegistry.register
class TextAnalyzeTool(BaseTool[TextAnalyzeInput, TextAnalyzeOutput]):
    name = "text_analyze"
    description = "Analyze text for language, sentiment, and keywords"
    category = ToolCategory.NLP
    priority = Priority.MEDIUM
    dependencies = []
    
    async def execute(self, input: TextAnalyzeInput) -> TextAnalyzeOutput:
        self.logger.info("text_analyze_execute", text_length=len(input.text))
        
        try:
            words = input.text.split()
            word_count = len(words)
            char_count = len(input.text)
            
            result = TextAnalyzeOutput(
                success=True,
                word_count=word_count,
                char_count=char_count
            )
            
            if "language" in input.analyses:
                if LANGDETECT_AVAILABLE and len(input.text.strip()) >= 10:
                    try:
                        result.language = detect(input.text)
                    except LangDetectException:
                        result.language = "unknown"
                else:
                    # Fallback: Simple heuristic for short texts
                    common_words = {
                        'en': {'the', 'is', 'are', 'and', 'or', 'but', 'in', 'on', 'at', 'to'},
                        'es': {'el', 'la', 'los', 'las', 'es', 'son', 'y', 'o', 'en', 'de'},
                        'fr': {'le', 'la', 'les', 'est', 'sont', 'et', 'ou', 'en', 'de', 'du'},
                        'de': {'der', 'die', 'das', 'ist', 'sind', 'und', 'oder', 'in', 'zu'},
                    }
                    text_lower = input.text.lower()
                    text_words = set(text_lower.split())
                    scores = {lang: len(text_words & w) for lang, w in common_words.items()}
                    result.language = max(scores.keys(), key=lambda k: scores[k]) if any(scores.values()) else "unknown"
            
            if "sentiment" in input.analyses:
                positive_words = ["good", "great", "excellent", "amazing", "wonderful", "love", "happy", "best"]
                negative_words = ["bad", "terrible", "awful", "hate", "worst", "poor", "sad", "horrible"]
                text_lower = input.text.lower()
                pos_count = sum(1 for w in positive_words if w in text_lower)
                neg_count = sum(1 for w in negative_words if w in text_lower)
                
                if pos_count > neg_count:
                    result.sentiment = "positive"
                    result.sentiment_score = min(1.0, 0.5 + (pos_count - neg_count) * 0.1)
                elif neg_count > pos_count:
                    result.sentiment = "negative"
                    result.sentiment_score = max(0.0, 0.5 - (neg_count - pos_count) * 0.1)
                else:
                    result.sentiment = "neutral"
                    result.sentiment_score = 0.5
            
            if "keywords" in input.analyses:
                stopwords = {"the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
                           "have", "has", "had", "do", "does", "did", "will", "would", "could",
                           "should", "may", "might", "must", "shall", "can", "need", "dare",
                           "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
                           "into", "through", "during", "before", "after", "above", "below",
                           "and", "or", "but", "if", "then", "else", "when", "up", "down",
                           "out", "off", "over", "under", "again", "further", "once", "it",
                           "this", "that", "these", "those", "i", "you", "he", "she", "we", "they"}
                
                word_freq = {}
                for word in words:
                    clean_word = ''.join(c.lower() for c in word if c.isalnum())
                    if clean_word and clean_word not in stopwords and len(clean_word) > 2:
                        word_freq[clean_word] = word_freq.get(clean_word, 0) + 1
                
                sorted_words = sorted(word_freq.items(), key=lambda x: x[1], reverse=True)
                result.keywords = [w[0] for w in sorted_words[:10]]
            
            return result
            
        except Exception as e:
            self.logger.error("text_analyze_error", error=str(e))
            return TextAnalyzeOutput(success=False, error=str(e))


class SummarizeInput(ToolInput):
    text: str = Field(..., min_length=1, max_length=100000)
    max_sentences: int = Field(default=3, ge=1, le=20)
    style: str = Field(default="extractive")

class SummarizeOutput(ToolOutput):
    summary: Optional[str] = None
    original_length: int = 0
    summary_length: int = 0
    compression_ratio: float = 0.0

@ToolRegistry.register
class SummarizeTool(BaseTool[SummarizeInput, SummarizeOutput]):
    name = "summarize"
    description = "Summarize long texts using extractive summarization"
    category = ToolCategory.NLP
    priority = Priority.MEDIUM
    dependencies = []
    
    async def execute(self, input: SummarizeInput) -> SummarizeOutput:
        self.logger.info("summarize_execute", text_length=len(input.text))
        
        try:
            import re
            sentences = re.split(r'(?<=[.!?])\s+', input.text.strip())
            sentences = [s.strip() for s in sentences if s.strip()]
            
            if len(sentences) <= input.max_sentences:
                summary = input.text
            else:
                sentence_scores = {}
                words = input.text.lower().split()
                word_freq = {}
                for word in words:
                    clean = ''.join(c for c in word if c.isalnum())
                    if clean:
                        word_freq[clean] = word_freq.get(clean, 0) + 1
                
                for i, sentence in enumerate(sentences):
                    score = 0
                    sentence_words = sentence.lower().split()
                    for word in sentence_words:
                        clean = ''.join(c for c in word if c.isalnum())
                        if clean in word_freq:
                            score += word_freq[clean]
                    if i == 0:
                        score *= 1.5
                    sentence_scores[i] = score / max(len(sentence_words), 1)
                
                top_indices = sorted(sentence_scores.keys(), key=lambda x: sentence_scores[x], reverse=True)[:input.max_sentences]
                top_indices.sort()
                summary = ' '.join(sentences[i] for i in top_indices)
            
            original_length = len(input.text)
            summary_length = len(summary)
            compression_ratio = summary_length / original_length if original_length > 0 else 0
            
            return SummarizeOutput(
                success=True,
                summary=summary,
                original_length=original_length,
                summary_length=summary_length,
                compression_ratio=compression_ratio
            )
            
        except Exception as e:
            self.logger.error("summarize_error", error=str(e))
            return SummarizeOutput(success=False, error=str(e))


class TranslateInput(ToolInput):
    text: str = Field(..., min_length=1, max_length=10000)
    source_lang: str = Field(default="auto")
    target_lang: str = Field(default="en")

class TranslateOutput(ToolOutput):
    translated_text: Optional[str] = None
    detected_source_lang: Optional[str] = None
    confidence: float = 0.0

@ToolRegistry.register
class TranslateTool(BaseTool[TranslateInput, TranslateOutput]):
    name = "translate"
    description = "Translate text between languages (mock implementation)"
    category = ToolCategory.NLP
    priority = Priority.LOW
    dependencies = []
    
    async def execute(self, input: TranslateInput) -> TranslateOutput:
        self.logger.info("translate_execute", source=input.source_lang, target=input.target_lang)
        
        try:
            mock_translations = {
                "hello": {"es": "hola", "fr": "bonjour", "de": "hallo", "it": "ciao"},
                "goodbye": {"es": "adiós", "fr": "au revoir", "de": "auf wiedersehen", "it": "arrivederci"},
                "thank you": {"es": "gracias", "fr": "merci", "de": "danke", "it": "grazie"},
                "yes": {"es": "sí", "fr": "oui", "de": "ja", "it": "sì"},
                "no": {"es": "no", "fr": "non", "de": "nein", "it": "no"},
            }
            
            text_lower = input.text.lower().strip()
            if text_lower in mock_translations and input.target_lang in mock_translations[text_lower]:
                translated = mock_translations[text_lower][input.target_lang]
            else:
                translated = f"[{input.target_lang}] {input.text}"
            
            return TranslateOutput(
                success=True,
                translated_text=translated,
                detected_source_lang=input.source_lang if input.source_lang != "auto" else "en",
                confidence=0.85
            )
            
        except Exception as e:
            self.logger.error("translate_error", error=str(e))
            return TranslateOutput(success=False, error=str(e))
