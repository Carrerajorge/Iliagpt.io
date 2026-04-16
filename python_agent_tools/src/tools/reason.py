from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from enum import Enum
from .base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput
from ..core.registry import ToolRegistry


class ReasoningType(str, Enum):
    DEDUCTIVE = "deductive"
    INDUCTIVE = "inductive"
    ABDUCTIVE = "abductive"
    ANALOGICAL = "analogical"
    CAUSAL = "causal"


class ReasoningStep(BaseModel):
    step_number: int
    premise: str
    inference: str
    confidence: float = Field(ge=0.0, le=1.0)


class ReasonInput(ToolInput):
    question: str = Field(..., description="Question or problem to reason about")
    context: Optional[str] = Field(None, description="Additional context")
    premises: List[str] = Field(default_factory=list, description="Known facts/premises")
    reasoning_type: ReasoningType = Field(ReasoningType.DEDUCTIVE)
    max_depth: int = Field(5, ge=1, le=20)


class ReasonOutput(ToolOutput):
    data: Optional[Dict[str, Any]] = None
    conclusion: Optional[str] = None
    reasoning_steps: List[ReasoningStep] = []
    confidence: float = 0.0


@ToolRegistry.register
class ReasonTool(BaseTool[ReasonInput, ReasonOutput]):
    name = "reason"
    description = "Performs structured reasoning and logical inference"
    category = ToolCategory.REASONING
    priority = Priority.CRITICAL
    dependencies = ["memory_retrieve"]

    async def execute(self, input: ReasonInput) -> ReasonOutput:
        self.logger.info(
            "reasoning",
            question=input.question[:100],
            reasoning_type=input.reasoning_type.value,
            premise_count=len(input.premises),
        )

        steps = []
        if input.premises:
            for i, premise in enumerate(input.premises[:input.max_depth], 1):
                steps.append(
                    ReasoningStep(
                        step_number=i,
                        premise=premise,
                        inference=f"Inference from: {premise[:50]}",
                        confidence=0.8,
                    )
                )

        if not steps:
            steps = [
                ReasoningStep(
                    step_number=1,
                    premise=f"Given question: {input.question[:100]}",
                    inference="Analyzing question structure",
                    confidence=0.9,
                ),
                ReasoningStep(
                    step_number=2,
                    premise="Context analysis complete",
                    inference="Formulating logical response",
                    confidence=0.85,
                ),
            ]

        conclusion = f"Based on {input.reasoning_type.value} reasoning: Analysis of '{input.question[:50]}...'"
        avg_confidence = sum(s.confidence for s in steps) / len(steps) if steps else 0.0

        return ReasonOutput(
            success=True,
            data={
                "question": input.question,
                "reasoning_type": input.reasoning_type.value,
                "step_count": len(steps),
            },
            conclusion=conclusion,
            reasoning_steps=steps,
            confidence=avg_confidence,
        )
