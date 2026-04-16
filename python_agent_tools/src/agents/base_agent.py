"""Base agent class for building AI agents."""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
from enum import Enum
from dataclasses import dataclass, field
from pydantic import BaseModel
import structlog

from ..tools.base import BaseTool, ToolOutput
from ..core.memory import BaseMemory


class AgentState(str, Enum):
    """Agent execution states."""
    IDLE = "idle"
    PLANNING = "planning"
    EXECUTING = "executing"
    WAITING = "waiting"
    COMPLETED = "completed"
    ERROR = "error"


class AgentConfig(BaseModel):
    """Configuration for agents."""
    name: str
    tools: List[str] = []
    max_iterations: int = 10
    timeout_seconds: int = 300
    
    class Config:
        extra = "allow"


class AgentResult(BaseModel):
    """Result from agent execution."""
    success: bool
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    metadata: Dict[str, Any] = {}
    steps: List[Dict[str, Any]] = []


class BaseAgent(ABC):
    """Abstract base class for all agents."""
    
    name: str
    
    @property
    @abstractmethod
    def description(self) -> str:
        """Return the description of this agent."""
        pass
    
    def __init__(
        self,
        tools: Optional[List[BaseTool]] = None,
        memory: Optional[BaseMemory] = None,
        max_iterations: int = 10,
    ):
        self.tools = tools or []
        self.memory = memory
        self.max_iterations = max_iterations
        self.state = AgentState.IDLE
        self.logger = structlog.get_logger(agent=self.name)
        self._tool_map: Dict[str, BaseTool] = {tool.name: tool for tool in self.tools}
    
    @abstractmethod
    async def run(self, task: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Execute the agent's main loop for a given task."""
        pass
    
    @abstractmethod
    async def plan(self, task: str, context: Dict[str, Any]) -> List[str]:
        """Generate a plan for the given task."""
        pass
    
    async def execute_tool(self, tool_name: str, input_data: Dict[str, Any]) -> ToolOutput:
        """Execute a tool by name with the given input."""
        if tool_name not in self._tool_map:
            return ToolOutput(
                success=False,
                error=f"Tool '{tool_name}' not found",
            )
        
        tool = self._tool_map[tool_name]
        try:
            result = await tool.execute(input_data)
            return result
        except Exception as e:
            self.logger.error("tool_execution_failed", tool=tool_name, error=str(e))
            return ToolOutput(
                success=False,
                error=str(e),
            )
    
    def get_available_tools(self) -> List[Dict[str, Any]]:
        """Get metadata for all available tools."""
        return [tool.get_metadata() for tool in self.tools]
    
    async def think(self, observation: str) -> str:
        """Process an observation and generate thoughts."""
        raise NotImplementedError("Subclasses must implement think()")
    
    async def act(self, thought: str) -> Dict[str, Any]:
        """Take an action based on the current thought."""
        raise NotImplementedError("Subclasses must implement act()")
    
    def get_system_prompt(self) -> str:
        """Return the system prompt for this agent."""
        return f"You are {self.name}. {self.description}"
    
    async def execute(self, task: str, context: Optional[Dict[str, Any]] = None) -> AgentResult:
        """Execute a task and return a result."""
        raise NotImplementedError("Subclasses must implement execute()")
    
    async def initialize(self) -> None:
        """Initialize the agent (lifecycle method)."""
        self.logger.info("agent_initialized", agent=self.name)
        self.state = AgentState.IDLE
    
    async def shutdown(self) -> None:
        """Shutdown the agent (lifecycle method)."""
        self.logger.info("agent_shutdown", agent=self.name)
        self.state = AgentState.IDLE
    
    @property
    def category(self) -> str:
        """Return the category of this agent."""
        return "general"
    
    @property
    def tools_used(self) -> List[str]:
        """Return list of tool names this agent uses."""
        return [tool.name for tool in self.tools]
