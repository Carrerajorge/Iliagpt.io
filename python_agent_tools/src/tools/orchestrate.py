from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from enum import Enum
from .base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput
from ..core.registry import ToolRegistry


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TaskDefinition(BaseModel):
    task_id: str
    tool_name: str
    inputs: Dict[str, Any] = {}
    dependencies: List[str] = []
    priority: int = 0


class TaskResult(BaseModel):
    task_id: str
    status: TaskStatus
    output: Optional[Any] = None
    error: Optional[str] = None
    duration_ms: Optional[float] = None


class OrchestrateInput(ToolInput):
    tasks: List[TaskDefinition] = Field(..., description="List of tasks to orchestrate")
    parallel: bool = Field(True, description="Execute independent tasks in parallel")
    fail_fast: bool = Field(True, description="Stop on first failure")
    timeout_seconds: int = Field(300, ge=1, le=3600)


class OrchestrateOutput(ToolOutput):
    data: Optional[List[TaskResult]] = None
    completed_count: int = 0
    failed_count: int = 0
    total_duration_ms: float = 0


@ToolRegistry.register
class OrchestrateTool(BaseTool[OrchestrateInput, OrchestrateOutput]):
    name = "orchestrate"
    description = "Orchestrates execution of multiple tools with dependency management"
    category = ToolCategory.ORCHESTRATION
    priority = Priority.CRITICAL
    dependencies = ["plan"]

    async def execute(self, input: OrchestrateInput) -> OrchestrateOutput:
        self.logger.info(
            "orchestrating_tasks",
            task_count=len(input.tasks),
            parallel=input.parallel,
        )

        results = []
        for task in input.tasks:
            self.logger.info("executing_task", task_id=task.task_id, tool=task.tool_name)
            result = TaskResult(
                task_id=task.task_id,
                status=TaskStatus.COMPLETED,
                output={"placeholder": f"Executed {task.tool_name}"},
                duration_ms=0.0,
            )
            results.append(result)

        completed = sum(1 for r in results if r.status == TaskStatus.COMPLETED)
        failed = sum(1 for r in results if r.status == TaskStatus.FAILED)

        return OrchestrateOutput(
            success=failed == 0,
            data=results,
            completed_count=completed,
            failed_count=failed,
            total_duration_ms=0.0,
        )
