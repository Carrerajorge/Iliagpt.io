from typing import List, Optional
from pydantic import BaseModel, Field
from .base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput
from ..core.registry import ToolRegistry


class PlanInput(ToolInput):
    goal: str = Field(..., description="The goal to plan for")
    context: Optional[str] = Field(None, description="Additional context")
    max_steps: int = Field(10, ge=1, le=50)


class PlanStep(BaseModel):
    step_number: int
    action: str
    tool: Optional[str] = None
    expected_output: str
    dependencies: List[int] = []


class PlanOutput(ToolOutput):
    data: Optional[List[PlanStep]] = None


@ToolRegistry.register
class PlanTool(BaseTool[PlanInput, PlanOutput]):
    name = "plan"
    description = "Creates a structured plan to achieve a goal"
    category = ToolCategory.ORCHESTRATION
    priority = Priority.CRITICAL
    dependencies = []

    async def execute(self, input: PlanInput) -> PlanOutput:
        self.logger.info("creating_plan", goal=input.goal)
        steps = [
            PlanStep(
                step_number=1,
                action=f"Analyze goal: {input.goal}",
                expected_output="Analysis complete",
            ),
            PlanStep(
                step_number=2,
                action="Identify required resources",
                expected_output="Resources list",
                dependencies=[1],
            ),
            PlanStep(
                step_number=3,
                action="Execute plan",
                expected_output="Goal achieved",
                dependencies=[2],
            ),
        ]
        return PlanOutput(success=True, data=steps)
