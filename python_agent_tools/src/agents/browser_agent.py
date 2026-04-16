"""Browser Agent - Web navigation, scraping, and automation."""

from typing import Any, Dict, List, Optional
from .base_agent import BaseAgent, AgentConfig, AgentResult, AgentState
import structlog


class BrowserAgentConfig(AgentConfig):
    """Configuration for the Browser Agent."""
    headless: bool = True
    timeout_seconds: int = 30
    enable_javascript: bool = True
    user_agent: str = "AgentBrowser/1.0"
    max_pages: int = 10


class BrowserAgent(BaseAgent):
    """Agent specialized in web navigation, scraping, and automation."""
    
    name = "browser"
    
    def __init__(
        self,
        config: Optional[BrowserAgentConfig] = None,
        tools: Optional[List] = None,
        memory = None,
    ):
        super().__init__(tools=tools, memory=memory)
        self.config = config or BrowserAgentConfig(name="browser")
        self._page_cache: Dict[str, Any] = {}
        self._navigation_history: List[str] = []
    
    @property
    def description(self) -> str:
        return "Navigates websites, scrapes content, and automates browser interactions"
    
    @property
    def category(self) -> str:
        return "web"
    
    @property
    def tools_used(self) -> List[str]:
        return ["api_call", "search_web", "file_write", "reason"]
    
    def get_system_prompt(self) -> str:
        return """You are the Browser Agent, specialized in web navigation and automation.
Your role is to:
1. Navigate to and interact with websites
2. Extract structured data from web pages
3. Automate form filling and submissions
4. Handle authentication and sessions
5. Take screenshots and capture content
6. Execute browser automation scripts

Capabilities:
- Page navigation (goto, back, forward, refresh)
- Element interaction (click, type, select)
- Content extraction (text, HTML, images)
- Form automation
- Cookie and session management
- JavaScript execution

Best practices:
- Respect robots.txt and rate limits
- Handle dynamic content properly
- Wait for elements before interacting
- Handle popups and dialogs
- Clean up resources after use"""
    
    async def navigate(self, url: str) -> Dict[str, Any]:
        """Navigate to a URL."""
        if len(self._navigation_history) >= self.config.max_pages:
            return {"error": "Maximum pages limit reached"}
        
        result = await self.execute_tool("api_call", {
            "url": url,
            "method": "GET",
            "headers": {"User-Agent": self.config.user_agent}
        })
        
        if result.success:
            self._navigation_history.append(url)
            self._page_cache[url] = result.data
        
        if result.success and result.data is not None:
            return result.data if isinstance(result.data, dict) else {"result": result.data}
        return {"error": result.error}
    
    async def extract_content(self, url: str, selector: Optional[str] = None) -> Dict[str, Any]:
        """Extract content from a web page."""
        if url not in self._page_cache:
            await self.navigate(url)
        
        page_content = self._page_cache.get(url, {})
        
        result = await self.execute_tool("reason", {
            "task": f"Extract content from this page{' using selector: ' + selector if selector else ''}",
            "context": {"page_content": str(page_content)[:5000]}
        })
        
        if result.success and result.data is not None:
            return result.data if isinstance(result.data, dict) else {"result": result.data}
        return {"error": result.error}
    
    async def fill_form(self, url: str, form_data: Dict[str, str]) -> Dict[str, Any]:
        """Fill and submit a form on a web page."""
        result = await self.execute_tool("api_call", {
            "url": url,
            "method": "POST",
            "data": form_data,
            "headers": {"User-Agent": self.config.user_agent}
        })
        
        if result.success and result.data is not None:
            return result.data if isinstance(result.data, dict) else {"result": result.data}
        return {"error": result.error}
    
    async def scrape(self, url: str, selectors: Dict[str, str]) -> Dict[str, Any]:
        """Scrape specific elements from a web page."""
        if url not in self._page_cache:
            await self.navigate(url)
        
        page_content = self._page_cache.get(url, {})
        
        result = await self.execute_tool("reason", {
            "task": "Extract the specified elements from the page content",
            "context": {
                "page_content": str(page_content)[:5000],
                "selectors": selectors
            }
        })
        
        if result.success and result.data is not None:
            return result.data if isinstance(result.data, dict) else {"result": result.data}
        return {"error": result.error}
    
    async def search(self, query: str) -> List[Dict[str, Any]]:
        """Perform a web search."""
        result = await self.execute_tool("search_web", {"query": query})
        if result.success and result.data is not None:
            return result.data if isinstance(result.data, list) else [result.data]
        return []
    
    async def screenshot(self, url: str, output_path: str) -> Dict[str, Any]:
        """Take a screenshot of a web page."""
        if url not in self._page_cache:
            await self.navigate(url)
        
        result = await self.execute_tool("file_write", {
            "path": output_path,
            "content": f"Screenshot placeholder for {url}"
        })
        
        return {"path": output_path, "success": result.success}
    
    async def run(self, task: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Execute the browser agent's main loop."""
        self.state = AgentState.EXECUTING
        context = context or {}
        
        url = context.get("url", "")
        
        if "navigate" in task.lower() or "go to" in task.lower():
            result = await self.navigate(url)
            return {"action": "navigate", "result": result}
        elif "extract" in task.lower():
            selector = context.get("selector", "")
            result = await self.extract_content(url, selector if selector else None)
            return {"action": "extract", "result": result}
        elif "form" in task.lower() or "fill" in task.lower():
            form_data = context.get("form_data", {})
            result = await self.fill_form(url, form_data)
            return {"action": "fill_form", "result": result}
        elif "scrape" in task.lower():
            selectors = context.get("selectors", {})
            result = await self.scrape(url, selectors)
            return {"action": "scrape", "result": result}
        elif "search" in task.lower():
            query = context.get("query", task)
            result = await self.search(query)
            return {"action": "search", "results": result}
        elif "screenshot" in task.lower():
            output = context.get("output_path", "/tmp/screenshot.png")
            result = await self.screenshot(url, output)
            return {"action": "screenshot", "result": result}
        else:
            result = await self.navigate(url) if url else await self.search(task)
            return {"action": "navigate" if url else "search", "result": result}
    
    async def plan(self, task: str, context: Dict[str, Any]) -> List[str]:
        """Generate a plan for the browser task."""
        return [f"Execute browser task: {task}"]
    
    async def execute(self, task: str, context: Optional[Dict[str, Any]] = None) -> AgentResult:
        """Execute a browser task."""
        self.logger.info("browser_execute", task=task[:100] if task else "")
        self.state = AgentState.EXECUTING
        
        try:
            result = await self.run(task, context)
            self.state = AgentState.COMPLETED
            return AgentResult(
                success=True,
                data=result,
                metadata={
                    "pages_visited": len(self._navigation_history),
                    "cached_pages": len(self._page_cache)
                }
            )
        except Exception as e:
            self.state = AgentState.ERROR
            self.logger.error("browser_error", error=str(e))
            return AgentResult(success=False, error=str(e))
    
    async def initialize(self) -> None:
        """Initialize the browser agent."""
        await super().initialize()
        self._page_cache = {}
        self._navigation_history = []
        self.logger.info("browser_agent_initialized", headless=self.config.headless)
    
    async def shutdown(self) -> None:
        """Shutdown the browser agent."""
        self._page_cache.clear()
        self._navigation_history.clear()
        await super().shutdown()
        self.logger.info("browser_agent_shutdown")
