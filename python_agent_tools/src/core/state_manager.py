"""State Manager - Persistent state for agents and workflows."""

from typing import Dict, Any, Optional, List, Callable, Awaitable
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
import json
import asyncio
import structlog

logger = structlog.get_logger(__name__)

_websocket_publish_agent: Optional[Callable[[str, str, dict], Awaitable[None]]] = None
_websocket_publish_workflow: Optional[Callable[[str, str, float, dict], Awaitable[None]]] = None


def set_websocket_publishers(
    agent_publisher: Optional[Callable[[str, str, dict], Awaitable[None]]] = None,
    workflow_publisher: Optional[Callable[[str, str, float, dict], Awaitable[None]]] = None
):
    """Set the WebSocket publisher functions for real-time updates."""
    global _websocket_publish_agent, _websocket_publish_workflow
    _websocket_publish_agent = agent_publisher
    _websocket_publish_workflow = workflow_publisher
    logger.info("websocket_publishers_configured")


def _schedule_async(coro) -> None:
    """Safely schedule an async coroutine as fire-and-forget.
    
    Handles cases where there's no running event loop gracefully.
    """
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(coro)
    except RuntimeError:
        pass


async def _notify_agent_update(agent_name: str, status: str, data: dict = None):
    """Internal helper to publish agent updates via WebSocket."""
    if _websocket_publish_agent:
        try:
            await _websocket_publish_agent(agent_name, status, data or {})
        except Exception as e:
            logger.warning("websocket_agent_notify_failed", error=str(e))


async def _notify_workflow_update(workflow_id: str, status: str, progress: float, data: dict = None):
    """Internal helper to publish workflow updates via WebSocket."""
    if _websocket_publish_workflow:
        try:
            await _websocket_publish_workflow(workflow_id, status, progress, data or {})
        except Exception as e:
            logger.warning("websocket_workflow_notify_failed", error=str(e))


class AgentStatus(str, Enum):
    IDLE = "idle"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class WorkflowStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    PAUSED = "paused"


@dataclass
class AgentState:
    """State for a single agent."""
    agent_name: str
    status: AgentStatus = AgentStatus.IDLE
    current_task: Optional[str] = None
    progress: float = 0.0
    results: Dict[str, Any] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "agent_name": self.agent_name,
            "status": self.status.value if isinstance(self.status, AgentStatus) else self.status,
            "current_task": self.current_task,
            "progress": self.progress,
            "results": self.results,
            "errors": self.errors,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "metadata": self.metadata,
        }
    
    def start(self, task: str) -> None:
        self.status = AgentStatus.RUNNING
        self.current_task = task
        self.started_at = datetime.utcnow()
        self.progress = 0.0
        self.errors = []
    
    def complete(self, results: Dict[str, Any]) -> None:
        self.status = AgentStatus.COMPLETED
        self.results = results
        self.completed_at = datetime.utcnow()
        self.progress = 1.0
    
    def fail(self, error: str) -> None:
        self.status = AgentStatus.FAILED
        self.errors.append(error)
        self.completed_at = datetime.utcnow()
    
    def update_progress(self, progress: float) -> None:
        self.progress = max(0.0, min(1.0, progress))


@dataclass
class WorkflowState:
    """State for a workflow execution."""
    workflow_id: str
    name: str
    status: WorkflowStatus = WorkflowStatus.PENDING
    agents: List[str] = field(default_factory=list)
    agent_states: Dict[str, AgentState] = field(default_factory=dict)
    dependencies: Dict[str, List[str]] = field(default_factory=dict)
    results: Dict[str, Any] = field(default_factory=dict)
    errors: List[Dict[str, Any]] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "workflow_id": self.workflow_id,
            "name": self.name,
            "status": self.status.value if isinstance(self.status, WorkflowStatus) else self.status,
            "agents": self.agents,
            "agent_states": {k: v.to_dict() for k, v in self.agent_states.items()},
            "dependencies": self.dependencies,
            "results": self.results,
            "errors": self.errors,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "metadata": self.metadata,
        }
    
    @property
    def progress(self) -> float:
        if not self.agent_states:
            return 0.0
        total = sum(s.progress for s in self.agent_states.values())
        return total / len(self.agent_states)
    
    def is_agent_ready(self, agent_name: str) -> bool:
        deps = self.dependencies.get(agent_name, [])
        for dep in deps:
            dep_state = self.agent_states.get(dep)
            if not dep_state or dep_state.status != AgentStatus.COMPLETED:
                return False
        return True
    
    def get_ready_agents(self) -> List[str]:
        ready = []
        for agent in self.agents:
            state = self.agent_states.get(agent)
            if state and state.status == AgentStatus.IDLE and self.is_agent_ready(agent):
                ready.append(agent)
        return ready


class StateManager:
    """Manages persistent state for agents and workflows.
    
    All methods are synchronous for compatibility with both sync and async callers.
    WebSocket notifications are scheduled as fire-and-forget tasks.
    """
    
    _instance: Optional["StateManager"] = None
    
    def __new__(cls) -> "StateManager":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        self._states: Dict[str, AgentState] = {}
        self._workflows: Dict[str, WorkflowState] = {}
        self._listeners: Dict[str, List[asyncio.Queue]] = {}
        self._lock = asyncio.Lock()
        self._initialized = True
        logger.info("state_manager_initialized")
    
    def get_state(self, agent_name: str) -> Optional[AgentState]:
        return self._states.get(agent_name)
    
    def set_state(self, agent_name: str, **kwargs) -> AgentState:
        if agent_name not in self._states:
            self._states[agent_name] = AgentState(agent_name=agent_name)
        state = self._states[agent_name]
        for key, value in kwargs.items():
            if hasattr(state, key):
                if key == "status" and isinstance(value, str):
                    value = AgentStatus(value)
                setattr(state, key, value)
        logger.debug("state_updated", agent=agent_name, **kwargs)
        return state
    
    def start_agent(self, agent_name: str, task: str) -> AgentState:
        """Start an agent with a task. WebSocket notification is fire-and-forget."""
        state = self.set_state(agent_name)
        state.start(task)
        logger.info("agent_started", agent=agent_name, task=task[:100] if task else "")
        _schedule_async(_notify_agent_update(agent_name, AgentStatus.RUNNING.value, {"task": task[:100] if task else ""}))
        return state
    
    def complete_agent(self, agent_name: str, results: Dict[str, Any]) -> Optional[AgentState]:
        """Complete an agent with results. WebSocket notification is fire-and-forget."""
        state = self.get_state(agent_name)
        if state:
            state.complete(results)
            logger.info("agent_completed", agent=agent_name)
            _schedule_async(_notify_agent_update(agent_name, AgentStatus.COMPLETED.value, {"results": results}))
        return state
    
    def fail_agent(self, agent_name: str, error: str) -> Optional[AgentState]:
        """Fail an agent with an error. WebSocket notification is fire-and-forget."""
        state = self.get_state(agent_name)
        if state:
            state.fail(error)
            logger.error("agent_failed", agent=agent_name, error=error)
            _schedule_async(_notify_agent_update(agent_name, AgentStatus.FAILED.value, {"error": error}))
        return state
    
    def update_agent_progress(self, agent_name: str, progress: float) -> Optional[AgentState]:
        """Update agent progress. WebSocket notification is fire-and-forget."""
        state = self.get_state(agent_name)
        if state:
            state.update_progress(progress)
            _schedule_async(_notify_agent_update(agent_name, state.status.value, {"progress": progress}))
        return state
    
    def start_workflow(
        self,
        workflow_id: str,
        name: str,
        agents: List[str],
        dependencies: Optional[Dict[str, List[str]]] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> WorkflowState:
        workflow = WorkflowState(
            workflow_id=workflow_id,
            name=name,
            agents=agents,
            dependencies=dependencies or {},
            metadata=metadata or {},
        )
        for agent in agents:
            workflow.agent_states[agent] = AgentState(agent_name=agent)
        
        self._workflows[workflow_id] = workflow
        logger.info("workflow_created", workflow_id=workflow_id, agents=len(agents))
        return workflow
    
    def get_workflow(self, workflow_id: str) -> Optional[WorkflowState]:
        return self._workflows.get(workflow_id)
    
    def update_workflow(self, workflow_id: str, agent_name: str, result: Any) -> Optional[WorkflowState]:
        workflow = self._workflows.get(workflow_id)
        if not workflow:
            return None
        
        if agent_name in workflow.agent_states:
            workflow.results[agent_name] = result
        
        all_completed = all(
            s.status == AgentStatus.COMPLETED 
            for s in workflow.agent_states.values()
        )
        any_failed = any(
            s.status == AgentStatus.FAILED 
            for s in workflow.agent_states.values()
        )
        
        if any_failed:
            workflow.status = WorkflowStatus.FAILED
            workflow.completed_at = datetime.utcnow()
        elif all_completed:
            workflow.status = WorkflowStatus.COMPLETED
            workflow.completed_at = datetime.utcnow()
        
        logger.debug("workflow_updated", workflow_id=workflow_id, agent=agent_name)
        return workflow
    
    def start_workflow_execution(self, workflow_id: str) -> Optional[WorkflowState]:
        """Start workflow execution. WebSocket notification is fire-and-forget."""
        workflow = self._workflows.get(workflow_id)
        if workflow:
            workflow.status = WorkflowStatus.RUNNING
            workflow.started_at = datetime.utcnow()
            logger.info("workflow_execution_started", workflow_id=workflow_id)
            _schedule_async(_notify_workflow_update(workflow_id, WorkflowStatus.RUNNING.value, workflow.progress, {"name": workflow.name}))
        return workflow
    
    def cancel_workflow(self, workflow_id: str) -> Optional[WorkflowState]:
        """Cancel a workflow. WebSocket notification is fire-and-forget."""
        workflow = self._workflows.get(workflow_id)
        if workflow:
            workflow.status = WorkflowStatus.CANCELLED
            workflow.completed_at = datetime.utcnow()
            for state in workflow.agent_states.values():
                if state.status == AgentStatus.RUNNING:
                    state.status = AgentStatus.CANCELLED
            logger.info("workflow_cancelled", workflow_id=workflow_id)
            _schedule_async(_notify_workflow_update(workflow_id, WorkflowStatus.CANCELLED.value, workflow.progress, {}))
        return workflow
    
    def get_workflow_status(self, workflow_id: str) -> Optional[Dict[str, Any]]:
        workflow = self._workflows.get(workflow_id)
        if not workflow:
            return None
        
        return {
            "workflow_id": workflow.workflow_id,
            "name": workflow.name,
            "status": workflow.status.value,
            "progress": workflow.progress,
            "agents": {
                name: state.to_dict() 
                for name, state in workflow.agent_states.items()
            },
            "results": workflow.results,
            "errors": workflow.errors,
            "created_at": workflow.created_at.isoformat() if workflow.created_at else None,
            "started_at": workflow.started_at.isoformat() if workflow.started_at else None,
            "completed_at": workflow.completed_at.isoformat() if workflow.completed_at else None,
        }
    
    def list_workflows(self) -> List[Dict[str, Any]]:
        return [
            {
                "workflow_id": w.workflow_id,
                "name": w.name,
                "status": w.status.value,
                "progress": w.progress,
                "agent_count": len(w.agents),
                "created_at": w.created_at.isoformat() if w.created_at else None,
            }
            for w in self._workflows.values()
        ]
    
    def list_agents(self) -> List[Dict[str, Any]]:
        return [state.to_dict() for state in self._states.values()]
    
    def clear_completed_workflows(self) -> int:
        to_remove = [
            wid for wid, w in self._workflows.items()
            if w.status in (WorkflowStatus.COMPLETED, WorkflowStatus.CANCELLED, WorkflowStatus.FAILED)
        ]
        for wid in to_remove:
            del self._workflows[wid]
        logger.info("cleared_workflows", count=len(to_remove))
        return len(to_remove)


state_manager = StateManager()
