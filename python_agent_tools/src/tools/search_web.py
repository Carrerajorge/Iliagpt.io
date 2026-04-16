from typing import Optional, List
from pydantic import BaseModel, Field
from .base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput
from ..core.registry import ToolRegistry
from ..utils.retry import async_retry
import aiohttp

class SearchResult(BaseModel):
    title: str
    url: str
    snippet: str
    relevance_score: float = 0.0

class SearchWebInput(ToolInput):
    query: str = Field(..., min_length=1, max_length=500)
    max_results: int = Field(10, ge=1, le=50)
    
class SearchWebOutput(ToolOutput):
    data: Optional[List[SearchResult]] = None
    total_results: int = 0

@ToolRegistry.register
class SearchWebTool(BaseTool[SearchWebInput, SearchWebOutput]):
    name = "search_web"
    description = "Searches the web for information"
    category = ToolCategory.WEB
    priority = Priority.CRITICAL
    dependencies = []
    
    @async_retry(max_attempts=3)
    async def execute(self, input: SearchWebInput) -> SearchWebOutput:
        self.logger.info("web_search", query=input.query[:50])
        results = [
            SearchResult(
                title=f"Result for: {input.query}",
                url="https://example.com",
                snippet="Sample search result",
                relevance_score=0.95
            )
        ]
        return SearchWebOutput(success=True, data=results, total_results=len(results))
