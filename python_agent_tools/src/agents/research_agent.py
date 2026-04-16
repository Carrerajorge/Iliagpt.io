"""Research Agent - Web search, information gathering, and data synthesis."""

from typing import Any, Dict, List, Optional
from .base_agent import BaseAgent, AgentConfig, AgentResult, AgentState
import structlog


class ResearchAgentConfig(AgentConfig):
    """Configuration for the Research Agent."""
    max_search_results: int = 10
    search_depth: int = 2
    enable_synthesis: bool = True
    trusted_sources: List[str] = []


class ResearchAgent(BaseAgent):
    """Agent specialized in web search, information gathering, and data synthesis."""
    
    name = "research"
    
    def __init__(
        self,
        config: Optional[ResearchAgentConfig] = None,
        tools: Optional[List] = None,
        memory = None,
    ):
        super().__init__(tools=tools, memory=memory)
        self.config = config or ResearchAgentConfig(name="research")
        self._search_cache: Dict[str, Any] = {}
    
    @property
    def description(self) -> str:
        return "Performs web searches, gathers information from multiple sources, and synthesizes findings"
    
    @property
    def category(self) -> str:
        return "research"
    
    @property
    def tools_used(self) -> List[str]:
        return ["search_web", "api_call", "embeddings", "reason"]
    
    def get_system_prompt(self) -> str:
        return """You are the Research Agent, specialized in information gathering and synthesis.
Your role is to:
1. Perform comprehensive web searches on given topics
2. Gather information from multiple authoritative sources
3. Verify facts by cross-referencing sources
4. Synthesize findings into clear, structured summaries
5. Cite sources and provide confidence levels
6. Identify knowledge gaps and suggest follow-up research

Research methodology:
- Start with broad searches, then narrow down
- Prioritize recent and authoritative sources
- Cross-reference claims across multiple sources
- Extract key facts, statistics, and quotes
- Organize findings by relevance and reliability

Output format:
- Provide executive summary first
- Include detailed findings with citations
- Note any contradictions or uncertainties
- Suggest areas for further investigation"""
    
    async def search(self, query: str, max_results: Optional[int] = None) -> List[Dict[str, Any]]:
        """Perform a web search."""
        max_results = max_results or self.config.max_search_results
        
        if query in self._search_cache:
            return self._search_cache[query]
        
        result = await self.execute_tool("search_web", {
            "query": query,
            "max_results": max_results
        })
        
        if result.success and result.data is not None:
            self._search_cache[query] = result.data
            return result.data
        return []
    
    async def synthesize(self, findings: List[Dict[str, Any]]) -> str:
        """Synthesize findings into a coherent summary."""
        if not self.config.enable_synthesis:
            return str(findings)
        
        result = await self.execute_tool("reason", {
            "task": "Synthesize the following research findings into a coherent summary",
            "context": {"findings": findings}
        })
        
        if result.success and result.data is not None and isinstance(result.data, dict):
            return result.data.get("synthesis", str(findings))
        return str(findings)
    
    async def run(self, task: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Execute the research agent's main loop."""
        self.state = AgentState.EXECUTING
        context = context or {}
        
        queries = await self.plan(task, context)
        all_findings = []
        
        for query in queries:
            results = await self.search(query)
            all_findings.extend(results)
        
        synthesis = await self.synthesize(all_findings)
        
        self.state = AgentState.COMPLETED
        return {
            "queries": queries,
            "findings": all_findings,
            "synthesis": synthesis
        }
    
    async def plan(self, task: str, context: Dict[str, Any]) -> List[str]:
        """Generate search queries for the research task."""
        return [task]
    
    async def execute(self, task: str, context: Optional[Dict[str, Any]] = None) -> AgentResult:
        """Execute a research task."""
        self.logger.info("research_execute", task=task[:100] if task else "")
        self.state = AgentState.EXECUTING
        
        try:
            result = await self.run(task, context)
            self.state = AgentState.COMPLETED
            return AgentResult(
                success=True,
                data=result,
                metadata={"queries_executed": len(result.get("queries", []))}
            )
        except Exception as e:
            self.state = AgentState.ERROR
            self.logger.error("research_error", error=str(e))
            return AgentResult(success=False, error=str(e))
    
    async def initialize(self) -> None:
        """Initialize the research agent."""
        await super().initialize()
        self._search_cache = {}
        self.logger.info("research_agent_initialized")
    
    async def shutdown(self) -> None:
        """Shutdown the research agent."""
        self._search_cache.clear()
        await super().shutdown()
        self.logger.info("research_agent_shutdown")
