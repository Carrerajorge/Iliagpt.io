"""Workflow Engine - Multi-agent workflow execution with dependencies."""

from typing import Dict, Any, Optional, List, Callable, Awaitable, Union
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
import asyncio
import uuid
import structlog

from .state_manager import (
    state_manager, 
    StateManager, 
    WorkflowState, 
    WorkflowStatus,
    AgentState,
    AgentStatus
)

logger = structlog.get_logger(__name__)


class ExecutionMode(str, Enum):
    SEQUENTIAL = "sequential"
    PARALLEL = "parallel"
    CONDITIONAL = "conditional"


@dataclass
class WorkflowStep:
    """A step in a workflow."""
    name: str
    agent_name: str
    task: str
    depends_on: List[str] = field(default_factory=list)
    condition: Optional[Callable[[Dict[str, Any]], bool]] = None
    retry_count: int = 0
    max_retries: int = 3
    timeout_seconds: int = 300
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def should_execute(self, context: Dict[str, Any]) -> bool:
        if self.condition is None:
            return True
        try:
            return self.condition(context)
        except Exception:
            return False


@dataclass
class WorkflowDefinition:
    """Definition of a multi-agent workflow."""
    name: str
    steps: List[WorkflowStep]
    description: str = ""
    execution_mode: ExecutionMode = ExecutionMode.PARALLEL
    max_parallel: int = 5
    timeout_seconds: int = 1800
    on_failure: str = "stop"  # stop, continue, retry
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def get_dependencies(self) -> Dict[str, List[str]]:
        return {step.name: step.depends_on for step in self.steps}
    
    def get_agent_names(self) -> List[str]:
        return list(set(step.agent_name for step in self.steps))


class WorkflowEngine:
    """Engine for executing multi-agent workflows."""
    
    def __init__(
        self,
        state_manager: Optional[StateManager] = None,
        agent_registry: Optional[Dict[str, Any]] = None
    ):
        self._state_manager = state_manager or globals()["state_manager"]
        self._agent_registry: Dict[str, Any] = agent_registry or {}
        self._running_workflows: Dict[str, asyncio.Task] = {}
        self._event_handlers: Dict[str, List[Callable]] = {}
        self.logger = structlog.get_logger("workflow_engine")
    
    def register_agent(self, name: str, agent: Any) -> None:
        self._agent_registry[name] = agent
        self.logger.info("agent_registered", agent=name)
    
    def unregister_agent(self, name: str) -> None:
        if name in self._agent_registry:
            del self._agent_registry[name]
            self.logger.info("agent_unregistered", agent=name)
    
    def on(self, event: str, handler: Callable) -> None:
        if event not in self._event_handlers:
            self._event_handlers[event] = []
        self._event_handlers[event].append(handler)
    
    async def _emit(self, event: str, data: Dict[str, Any]) -> None:
        handlers = self._event_handlers.get(event, [])
        for handler in handlers:
            try:
                if asyncio.iscoroutinefunction(handler):
                    await handler(data)
                else:
                    handler(data)
            except Exception as e:
                self.logger.error("event_handler_error", event=event, error=str(e))
    
    async def create_workflow(
        self,
        definition: WorkflowDefinition,
        context: Optional[Dict[str, Any]] = None
    ) -> str:
        workflow_id = str(uuid.uuid4())
        
        agents = [step.name for step in definition.steps]
        dependencies = definition.get_dependencies()
        
        workflow = self._state_manager.start_workflow(
            workflow_id=workflow_id,
            name=definition.name,
            agents=agents,
            dependencies=dependencies,
            metadata={
                "description": definition.description,
                "execution_mode": definition.execution_mode.value,
                "context": context or {},
                **definition.metadata
            }
        )
        
        await self._emit("workflow_created", {"workflow_id": workflow_id, "definition": definition.name})
        self.logger.info("workflow_created", workflow_id=workflow_id, name=definition.name)
        return workflow_id
    
    async def execute_workflow(
        self,
        workflow_id: str,
        definition: WorkflowDefinition,
        context: Optional[Dict[str, Any]] = None
    ) -> WorkflowState:
        workflow = self._state_manager.get_workflow(workflow_id)
        if not workflow:
            raise ValueError(f"Workflow {workflow_id} not found")
        
        self._state_manager.start_workflow_execution(workflow_id)
        execution_context: Dict[str, Any] = context or workflow.metadata.get("context", {}) or {}
        
        await self._emit("workflow_started", {"workflow_id": workflow_id})
        
        try:
            if definition.execution_mode == ExecutionMode.SEQUENTIAL:
                await self._execute_sequential(workflow, definition, execution_context)
            else:
                await self._execute_parallel(workflow, definition, execution_context)
            
            updated_workflow = self._state_manager.get_workflow(workflow_id)
            if updated_workflow:
                await self._emit("workflow_completed", {
                    "workflow_id": workflow_id,
                    "status": updated_workflow.status.value,
                    "results": updated_workflow.results
                })
            
        except asyncio.CancelledError:
            self._state_manager.cancel_workflow(workflow_id)
            await self._emit("workflow_cancelled", {"workflow_id": workflow_id})
            raise
        except Exception as e:
            workflow.status = WorkflowStatus.FAILED
            workflow.errors.append({"error": str(e), "timestamp": datetime.utcnow().isoformat()})
            await self._emit("workflow_failed", {"workflow_id": workflow_id, "error": str(e)})
            self.logger.error("workflow_failed", workflow_id=workflow_id, error=str(e))
        
        final_workflow = self._state_manager.get_workflow(workflow_id)
        if not final_workflow:
            raise ValueError(f"Workflow {workflow_id} was lost during execution")
        return final_workflow
    
    async def _execute_sequential(
        self,
        workflow: WorkflowState,
        definition: WorkflowDefinition,
        context: Dict[str, Any]
    ) -> None:
        for step in definition.steps:
            if workflow.status == WorkflowStatus.CANCELLED:
                break
            
            if not step.should_execute(context):
                self.logger.info("step_skipped", step=step.name, reason="condition_not_met")
                workflow.agent_states[step.name].status = AgentStatus.COMPLETED
                continue
            
            result = await self._execute_step(workflow, step, context)
            if result:
                context[step.name] = result
    
    async def _execute_parallel(
        self,
        workflow: WorkflowState,
        definition: WorkflowDefinition,
        context: Dict[str, Any]
    ) -> None:
        pending_steps = {step.name: step for step in definition.steps}
        completed = set()
        semaphore = asyncio.Semaphore(definition.max_parallel)
        
        while pending_steps and workflow.status == WorkflowStatus.RUNNING:
            ready_steps = []
            for name, step in list(pending_steps.items()):
                deps_met = all(dep in completed for dep in step.depends_on)
                if deps_met and step.should_execute(context):
                    ready_steps.append(step)
                elif deps_met and not step.should_execute(context):
                    workflow.agent_states[name].status = AgentStatus.COMPLETED
                    completed.add(name)
                    del pending_steps[name]
            
            if not ready_steps:
                if pending_steps:
                    await asyncio.sleep(0.1)
                continue
            
            async def run_step(step: WorkflowStep):
                async with semaphore:
                    return await self._execute_step(workflow, step, context)
            
            tasks = [run_step(step) for step in ready_steps]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            for step, result in zip(ready_steps, results):
                if isinstance(result, Exception):
                    self.logger.error("step_error", step=step.name, error=str(result))
                    if definition.on_failure == "stop":
                        workflow.status = WorkflowStatus.FAILED
                        return
                else:
                    context[step.name] = result
                
                completed.add(step.name)
                del pending_steps[step.name]
    
    async def _execute_step(
        self,
        workflow: WorkflowState,
        step: WorkflowStep,
        context: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        agent = self._agent_registry.get(step.agent_name)
        if not agent:
            self.logger.error("agent_not_found", agent=step.agent_name)
            workflow.agent_states[step.name].fail(f"Agent {step.agent_name} not found")
            return None
        
        agent_state = workflow.agent_states[step.name]
        agent_state.start(step.task)
        
        await self._emit("step_started", {
            "workflow_id": workflow.workflow_id,
            "step": step.name,
            "agent": step.agent_name
        })
        
        for attempt in range(step.max_retries + 1):
            try:
                step.retry_count = attempt
                
                try:
                    result = await asyncio.wait_for(
                        agent.execute(step.task, context),
                        timeout=step.timeout_seconds
                    )
                except asyncio.TimeoutError:
                    raise TimeoutError(f"Step {step.name} timed out after {step.timeout_seconds}s")
                
                if hasattr(result, 'success') and result.success:
                    agent_state.complete(result.data if hasattr(result, 'data') else {})
                    self._state_manager.update_workflow(
                        workflow.workflow_id, 
                        step.name, 
                        result.data if hasattr(result, 'data') else result
                    )
                    
                    await self._emit("step_completed", {
                        "workflow_id": workflow.workflow_id,
                        "step": step.name,
                        "result": agent_state.results
                    })
                    
                    return result.data if hasattr(result, 'data') else result
                elif hasattr(result, 'error'):
                    raise Exception(result.error)
                else:
                    agent_state.complete(result if isinstance(result, dict) else {"result": result})
                    return result
                    
            except Exception as e:
                self.logger.warning(
                    "step_retry", 
                    step=step.name, 
                    attempt=attempt + 1, 
                    max_retries=step.max_retries,
                    error=str(e)
                )
                if attempt >= step.max_retries:
                    agent_state.fail(str(e))
                    await self._emit("step_failed", {
                        "workflow_id": workflow.workflow_id,
                        "step": step.name,
                        "error": str(e)
                    })
                    return None
                await asyncio.sleep(2 ** attempt)
        
        return None
    
    async def run_workflow(
        self,
        definition: WorkflowDefinition,
        context: Optional[Dict[str, Any]] = None
    ) -> WorkflowState:
        workflow_id = await self.create_workflow(definition, context)
        return await self.execute_workflow(workflow_id, definition, context)
    
    async def cancel_workflow(self, workflow_id: str) -> bool:
        if workflow_id in self._running_workflows:
            task = self._running_workflows[workflow_id]
            task.cancel()
            del self._running_workflows[workflow_id]
        
        workflow = self._state_manager.cancel_workflow(workflow_id)
        return workflow is not None
    
    def get_workflow_status(self, workflow_id: str) -> Optional[Dict[str, Any]]:
        return self._state_manager.get_workflow_status(workflow_id)
    
    def list_workflows(self) -> List[Dict[str, Any]]:
        return self._state_manager.list_workflows()


workflow_engine = WorkflowEngine()
