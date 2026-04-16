"""Agent endpoints for the Python Agent Tools API."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any, Dict, List, Optional
import structlog

from ..agents import (
    BaseAgent,
    AgentResult,
    OrchestratorAgent,
    ResearchAgent,
    CodeAgent,
    DataAgent,
    ContentAgent,
    CommunicationAgent,
    BrowserAgent,
    DocumentAgent,
    QAAgent,
    SecurityAgent,
)

logger = structlog.get_logger(__name__)

agents_router = APIRouter()

AGENT_REGISTRY: Dict[str, type] = {
    "orchestrator": OrchestratorAgent,
    "research": ResearchAgent,
    "code": CodeAgent,
    "data": DataAgent,
    "content": ContentAgent,
    "communication": CommunicationAgent,
    "browser": BrowserAgent,
    "document": DocumentAgent,
    "qa": QAAgent,
    "security": SecurityAgent,
}

_agent_instances: Dict[str, BaseAgent] = {}


class AgentInfo(BaseModel):
    name: str
    description: str
    category: str
    tools_used: List[str]


class AgentExecuteRequest(BaseModel):
    task: str
    context: Optional[Dict[str, Any]] = None


class AgentExecuteResponse(BaseModel):
    success: bool
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    metadata: Dict[str, Any] = {}
    steps: List[Dict[str, Any]] = []


def get_agent_instance(agent_name: str) -> Optional[BaseAgent]:
    """Get or create an agent instance."""
    if agent_name not in AGENT_REGISTRY:
        return None
    
    if agent_name not in _agent_instances:
        agent_class = AGENT_REGISTRY[agent_name]
        _agent_instances[agent_name] = agent_class()
    
    return _agent_instances[agent_name]


@agents_router.get("", response_model=List[AgentInfo])
async def list_agents():
    """List all available agents."""
    agents = []
    for name, agent_class in AGENT_REGISTRY.items():
        try:
            instance = get_agent_instance(name)
            if instance:
                agents.append(AgentInfo(
                    name=instance.name,
                    description=instance.description,
                    category=instance.category,
                    tools_used=instance.tools_used
                ))
        except Exception as e:
            logger.warning("agent_instantiation_failed", agent=name, error=str(e))
    return agents


@agents_router.get("/{agent_name}", response_model=AgentInfo)
async def get_agent(agent_name: str):
    """Get agent details."""
    agent = get_agent_instance(agent_name)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_name}' not found")
    
    return AgentInfo(
        name=agent.name,
        description=agent.description,
        category=agent.category,
        tools_used=agent.tools_used
    )


@agents_router.post("/{agent_name}/execute", response_model=AgentExecuteResponse)
async def execute_agent(agent_name: str, request: AgentExecuteRequest):
    """Execute an agent task."""
    logger.info("execute_agent_request", agent=agent_name, task=request.task[:100] if request.task else "")
    
    agent = get_agent_instance(agent_name)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_name}' not found")
    
    try:
        await agent.initialize()
        result: AgentResult = await agent.execute(request.task, request.context)
        
        return AgentExecuteResponse(
            success=result.success,
            data=result.data,
            error=result.error,
            metadata=result.metadata,
            steps=result.steps
        )
    except Exception as e:
        logger.error("agent_execution_failed", agent=agent_name, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        await agent.shutdown()
