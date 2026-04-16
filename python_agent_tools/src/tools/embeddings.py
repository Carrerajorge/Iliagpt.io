from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from enum import Enum
from .base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput
from ..core.registry import ToolRegistry
from ..utils.retry import async_retry
import hashlib

class EmbeddingModel(str, Enum):
    OPENAI_ADA_002 = "text-embedding-ada-002"
    OPENAI_3_SMALL = "text-embedding-3-small"
    OPENAI_3_LARGE = "text-embedding-3-large"
    LOCAL_MINILM = "all-MiniLM-L6-v2"
    LOCAL_MPNET = "all-mpnet-base-v2"

class EmbeddingResult(BaseModel):
    text: str
    embedding: List[float]
    model: str
    dimensions: int
    token_count: int = 0

class EmbeddingsInput(ToolInput):
    texts: List[str] = Field(..., min_length=1, max_length=100)
    model: EmbeddingModel = Field(EmbeddingModel.OPENAI_3_SMALL)
    dimensions: Optional[int] = None
    normalize: bool = Field(True)
    
class EmbeddingsOutput(ToolOutput):
    data: Optional[List[EmbeddingResult]] = None
    total_tokens: int = 0
    model_used: str = ""

@ToolRegistry.register
class EmbeddingsTool(BaseTool[EmbeddingsInput, EmbeddingsOutput]):
    name = "embeddings"
    description = "Generates vector embeddings from text with batch processing support"
    category = ToolCategory.GENERATION
    priority = Priority.CRITICAL
    dependencies = []
    
    MODEL_DIMENSIONS = {
        EmbeddingModel.OPENAI_ADA_002: 1536,
        EmbeddingModel.OPENAI_3_SMALL: 1536,
        EmbeddingModel.OPENAI_3_LARGE: 3072,
        EmbeddingModel.LOCAL_MINILM: 384,
        EmbeddingModel.LOCAL_MPNET: 768,
    }
    
    def _estimate_tokens(self, text: str) -> int:
        return len(text.split()) + len(text) // 4
    
    def _generate_placeholder_embedding(self, text: str, dimensions: int) -> List[float]:
        hash_bytes = hashlib.sha256(text.encode()).digest()
        embedding = []
        for i in range(dimensions):
            byte_idx = i % len(hash_bytes)
            value = (hash_bytes[byte_idx] / 255.0) * 2 - 1
            embedding.append(round(value, 6))
        return embedding
    
    def _normalize_vector(self, vector: List[float]) -> List[float]:
        magnitude = sum(x ** 2 for x in vector) ** 0.5
        if magnitude == 0:
            return vector
        return [x / magnitude for x in vector]
    
    @async_retry(max_attempts=3)
    async def execute(self, input: EmbeddingsInput) -> EmbeddingsOutput:
        self.logger.info("embeddings", texts_count=len(input.texts), model=input.model.value)
        
        dimensions = input.dimensions or self.MODEL_DIMENSIONS.get(input.model, 1536)
        results: List[EmbeddingResult] = []
        total_tokens = 0
        
        for text in input.texts:
            token_count = self._estimate_tokens(text)
            total_tokens += token_count
            
            embedding = self._generate_placeholder_embedding(text, dimensions)
            if input.normalize:
                embedding = self._normalize_vector(embedding)
            
            results.append(EmbeddingResult(
                text=text[:100] + "..." if len(text) > 100 else text,
                embedding=embedding,
                model=input.model.value,
                dimensions=dimensions,
                token_count=token_count
            ))
        
        return EmbeddingsOutput(
            success=True,
            data=results,
            total_tokens=total_tokens,
            model_used=input.model.value
        )
