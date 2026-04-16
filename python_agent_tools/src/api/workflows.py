"""Workflow management API endpoints."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
import structlog

from ..core.state_manager import state_manager
from ..core.workflow_engine import (
    workflow_engine,
    WorkflowDefinition,
    WorkflowStep,
    ExecutionMode,
)

logger = structlog.get_logger(__name__)

workflows_router = APIRouter()


class WorkflowStepRequest(BaseModel):
    name: str
    agent: str
    task: str
    depends_on: List[str] = Field(default_factory=list)
    max_retries: int = 3
    timeout: int = 300


class CreateWorkflowRequest(BaseModel):
    name: str
    description: str = ""
    steps: List[WorkflowStepRequest]
    execution_mode: str = "parallel"
    max_parallel: int = 5
    timeout: int = 1800
    on_failure: str = "stop"
    context: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None


class WorkflowResponse(BaseModel):
    workflow_id: str
    name: str
    status: str
    progress: float = 0.0
    agent_count: int = 0
    created_at: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


class WorkflowStatusResponse(BaseModel):
    workflow_id: str
    name: str
    status: str
    progress: float
    agents: Dict[str, Any]
    results: Dict[str, Any]
    errors: List[Dict[str, Any]]
    created_at: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


class ExecuteWorkflowRequest(BaseModel):
    context: Optional[Dict[str, Any]] = None


@workflows_router.post("", response_model=WorkflowResponse)
async def create_workflow(request: CreateWorkflowRequest):
    """Create a new workflow."""
    logger.info("create_workflow", name=request.name, steps=len(request.steps))
    
    try:
        steps = [
            WorkflowStep(
                name=s.name,
                agent_name=s.agent,
                task=s.task,
                depends_on=s.depends_on,
                max_retries=s.max_retries,
                timeout_seconds=s.timeout,
            )
            for s in request.steps
        ]
        
        definition = WorkflowDefinition(
            name=request.name,
            description=request.description,
            steps=steps,
            execution_mode=ExecutionMode(request.execution_mode),
            max_parallel=request.max_parallel,
            timeout_seconds=request.timeout,
            on_failure=request.on_failure,
            metadata=request.metadata or {},
        )
        
        workflow_id = await workflow_engine.create_workflow(definition, request.context)
        workflow = state_manager.get_workflow(workflow_id)
        
        return WorkflowResponse(
            workflow_id=workflow_id,
            name=request.name,
            status=workflow.status.value if workflow else "pending",
            progress=workflow.progress if workflow else 0.0,
            agent_count=len(request.steps),
            created_at=workflow.created_at.isoformat() if workflow and workflow.created_at else None,
        )
    except Exception as e:
        logger.error("create_workflow_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@workflows_router.get("", response_model=List[WorkflowResponse])
async def list_workflows():
    """List all workflows."""
    workflows = workflow_engine.list_workflows()
    return [
        WorkflowResponse(
            workflow_id=w["workflow_id"],
            name=w["name"],
            status=w["status"],
            progress=w.get("progress", 0.0),
            agent_count=w.get("agent_count", 0),
            created_at=w.get("created_at"),
        )
        for w in workflows
    ]


@workflows_router.get("/{workflow_id}", response_model=WorkflowStatusResponse)
async def get_workflow_status(workflow_id: str):
    """Get workflow status."""
    status = workflow_engine.get_workflow_status(workflow_id)
    if not status:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_id}' not found")
    
    return WorkflowStatusResponse(
        workflow_id=status["workflow_id"],
        name=status["name"],
        status=status["status"],
        progress=status["progress"],
        agents=status["agents"],
        results=status["results"],
        errors=status["errors"],
        created_at=status.get("created_at"),
        started_at=status.get("started_at"),
        completed_at=status.get("completed_at"),
    )


@workflows_router.post("/{workflow_id}/execute", response_model=WorkflowStatusResponse)
async def execute_workflow(workflow_id: str, request: ExecuteWorkflowRequest):
    """Execute a workflow."""
    logger.info("execute_workflow", workflow_id=workflow_id)
    
    workflow = state_manager.get_workflow(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_id}' not found")
    
    try:
        steps = []
        for name in workflow.agents:
            agent_state = workflow.agent_states.get(name)
            if agent_state:
                steps.append(WorkflowStep(
                    name=name,
                    agent_name=name,
                    task=agent_state.current_task or "",
                    depends_on=workflow.dependencies.get(name, []),
                ))
        
        definition = WorkflowDefinition(
            name=workflow.name,
            steps=steps,
            execution_mode=ExecutionMode(workflow.metadata.get("execution_mode", "parallel")),
        )
        
        result = await workflow_engine.execute_workflow(
            workflow_id, 
            definition,
            request.context
        )
        
        status = workflow_engine.get_workflow_status(workflow_id)
        if not status:
            raise HTTPException(status_code=404, detail=f"Workflow '{workflow_id}' status not found")
        return WorkflowStatusResponse(
            workflow_id=status["workflow_id"],
            name=status["name"],
            status=status["status"],
            progress=status["progress"],
            agents=status["agents"],
            results=status["results"],
            errors=status["errors"],
            created_at=status.get("created_at"),
            started_at=status.get("started_at"),
            completed_at=status.get("completed_at"),
        )
    except Exception as e:
        logger.error("execute_workflow_failed", workflow_id=workflow_id, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@workflows_router.post("/{workflow_id}/cancel")
async def cancel_workflow(workflow_id: str):
    """Cancel a workflow."""
    logger.info("cancel_workflow", workflow_id=workflow_id)
    
    success = await workflow_engine.cancel_workflow(workflow_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_id}' not found")
    
    return {"success": True, "workflow_id": workflow_id, "status": "cancelled"}


@workflows_router.get("/{workflow_id}/agents")
async def get_workflow_agents(workflow_id: str):
    """Get agent states for a workflow."""
    workflow = state_manager.get_workflow(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_id}' not found")
    
    return {
        "workflow_id": workflow_id,
        "agents": {
            name: state.to_dict()
            for name, state in workflow.agent_states.items()
        }
    }


@workflows_router.delete("/{workflow_id}")
async def delete_workflow(workflow_id: str):
    """Delete a completed/cancelled/failed workflow."""
    workflow = state_manager.get_workflow(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_id}' not found")
    
    if workflow.status.value == "running":
        raise HTTPException(status_code=400, detail="Cannot delete a running workflow")
    
    state_manager._workflows.pop(workflow_id, None)
    return {"success": True, "workflow_id": workflow_id}
