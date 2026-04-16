from typing import List, Any, Dict, Optional, Callable, Awaitable, Union
from dataclasses import dataclass, field
from enum import Enum
import asyncio
import structlog

from ..tools.base import BaseTool, ToolInput, ToolOutput

logger = structlog.get_logger(__name__)

class PipelineStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

@dataclass
class PipelineStep:
    """A step in the pipeline."""
    name: str
    tool: BaseTool
    input_transformer: Optional[Callable[[Any], ToolInput]] = None
    output_transformer: Optional[Callable[[ToolOutput], Any]] = None
    on_error: Optional[Callable[[Exception], Any]] = None
    
@dataclass
class PipelineContext:
    """Context passed through the pipeline."""
    data: Dict[str, Any] = field(default_factory=dict)
    results: Dict[str, ToolOutput] = field(default_factory=dict)
    errors: List[Dict[str, Any]] = field(default_factory=list)
    status: PipelineStatus = PipelineStatus.PENDING
    current_step: Optional[str] = None
    
class Pipeline:
    """Async pipeline for executing tools in sequence."""
    
    def __init__(self, name: str):
        self.name = name
        self.steps: List[PipelineStep] = []
        self.logger = structlog.get_logger(pipeline=name)
        
    def add_step(self, step: PipelineStep) -> "Pipeline":
        """Add a step to the pipeline."""
        self.steps.append(step)
        return self
    
    def add_tool(self, name: str, tool: BaseTool, **kwargs) -> "Pipeline":
        """Convenience method to add a tool as a step."""
        step = PipelineStep(name=name, tool=tool, **kwargs)
        return self.add_step(step)
    
    async def execute(self, initial_data: Optional[Dict[str, Any]] = None) -> PipelineContext:
        """Execute the pipeline."""
        context = PipelineContext(data=initial_data or {})
        context.status = PipelineStatus.RUNNING
        
        self.logger.info("pipeline_started", steps=len(self.steps))
        
        for step in self.steps:
            context.current_step = step.name
            self.logger.info("step_started", step=step.name)
            
            try:
                if step.input_transformer:
                    tool_input = step.input_transformer(context.data)
                else:
                    tool_input = step.tool.__class__.__bases__[0].__args__[0](**context.data)
                
                result = await step.tool.execute(tool_input)
                context.results[step.name] = result
                
                if step.output_transformer:
                    transformed = step.output_transformer(result)
                    if isinstance(transformed, dict):
                        context.data.update(transformed)
                elif result.data:
                    if isinstance(result.data, dict):
                        context.data.update(result.data)
                
                if not result.success:
                    raise Exception(result.error or "Step failed")
                    
                self.logger.info("step_completed", step=step.name, success=True)
                
            except Exception as e:
                self.logger.error("step_failed", step=step.name, error=str(e))
                context.errors.append({"step": step.name, "error": str(e)})
                
                if step.on_error:
                    try:
                        step.on_error(e)
                    except:
                        pass
                
                context.status = PipelineStatus.FAILED
                return context
        
        context.status = PipelineStatus.COMPLETED
        context.current_step = None
        self.logger.info("pipeline_completed", results=len(context.results))
        return context

class ParallelPipeline:
    """Execute multiple pipelines in parallel."""
    
    def __init__(self, name: str):
        self.name = name
        self.pipelines: List[Pipeline] = []
        self.logger = structlog.get_logger(parallel_pipeline=name)
    
    def add_pipeline(self, pipeline: Pipeline) -> "ParallelPipeline":
        """Add a pipeline to execute in parallel."""
        self.pipelines.append(pipeline)
        return self
    
    async def execute(self, initial_data: Optional[Dict[str, Any]] = None) -> List[Union[PipelineContext, BaseException]]:
        """Execute all pipelines in parallel."""
        self.logger.info("parallel_execution_started", count=len(self.pipelines))
        tasks = [p.execute(initial_data.copy() if initial_data else {}) for p in self.pipelines]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        self.logger.info("parallel_execution_completed")
        return results
