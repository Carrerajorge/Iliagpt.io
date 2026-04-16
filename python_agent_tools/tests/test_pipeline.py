"""Tests for the pipeline execution system."""

import pytest
import asyncio
from src.core.pipeline import Pipeline, PipelineStep, PipelineContext, PipelineStatus, ParallelPipeline
from src.tools.base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput


class PipelineTestInput(ToolInput):
    value: str = ""


class PipelineTestOutput(ToolOutput):
    processed_value: str = ""


class SuccessfulTool(BaseTool[PipelineTestInput, PipelineTestOutput]):
    name = "successful_tool"
    description = "Always succeeds"
    category = ToolCategory.SYSTEM
    priority = Priority.MEDIUM
    dependencies = []
    
    async def execute(self, input: PipelineTestInput) -> PipelineTestOutput:
        return PipelineTestOutput(
            success=True,
            data={"processed": input.value},
            processed_value=f"processed_{input.value}"
        )


class FailingTool(BaseTool[PipelineTestInput, PipelineTestOutput]):
    name = "failing_tool"
    description = "Always fails"
    category = ToolCategory.SYSTEM
    priority = Priority.MEDIUM
    dependencies = []
    
    async def execute(self, input: PipelineTestInput) -> PipelineTestOutput:
        return PipelineTestOutput(success=False, error="Intentional failure")


class SlowTool(BaseTool[PipelineTestInput, PipelineTestOutput]):
    name = "slow_tool"
    description = "Takes time to execute"
    category = ToolCategory.SYSTEM
    priority = Priority.LOW
    dependencies = []
    
    async def execute(self, input: PipelineTestInput) -> PipelineTestOutput:
        await asyncio.sleep(0.1)
        return PipelineTestOutput(success=True, data={"slow": True})


class CountingTool(BaseTool[PipelineTestInput, PipelineTestOutput]):
    name = "counting_tool"
    description = "Counts executions"
    category = ToolCategory.SYSTEM
    priority = Priority.MEDIUM
    dependencies = []
    execution_count = 0
    
    async def execute(self, input: PipelineTestInput) -> PipelineTestOutput:
        CountingTool.execution_count += 1
        return PipelineTestOutput(
            success=True,
            data={"count": CountingTool.execution_count}
        )


class TestPipeline:
    @pytest.fixture
    def successful_tool(self):
        return SuccessfulTool()
    
    @pytest.fixture
    def failing_tool(self):
        return FailingTool()
    
    @pytest.fixture
    def slow_tool(self):
        return SlowTool()
    
    def test_create_pipeline(self):
        pipeline = Pipeline("test_pipeline")
        assert pipeline.name == "test_pipeline"
        assert len(pipeline.steps) == 0
    
    def test_add_step(self, successful_tool):
        pipeline = Pipeline("test")
        step = PipelineStep(name="step1", tool=successful_tool)
        
        result = pipeline.add_step(step)
        
        assert result is pipeline
        assert len(pipeline.steps) == 1
    
    def test_add_tool(self, successful_tool):
        pipeline = Pipeline("test")
        
        result = pipeline.add_tool("step1", successful_tool)
        
        assert result is pipeline
        assert len(pipeline.steps) == 1
        assert pipeline.steps[0].name == "step1"
    
    @pytest.mark.asyncio
    async def test_sequential_execution(self, successful_tool):
        pipeline = Pipeline("test")
        pipeline.add_step(PipelineStep(
            name="step1",
            tool=successful_tool,
            input_transformer=lambda data: PipelineTestInput(value=data.get("value", ""))
        ))
        pipeline.add_step(PipelineStep(
            name="step2",
            tool=successful_tool,
            input_transformer=lambda data: PipelineTestInput(value=data.get("value", ""))
        ))
        
        context = await pipeline.execute({"value": "test"})
        
        assert context.status == PipelineStatus.COMPLETED
        assert "step1" in context.results
        assert "step2" in context.results
    
    @pytest.mark.asyncio
    async def test_error_handling(self, successful_tool, failing_tool):
        pipeline = Pipeline("test")
        pipeline.add_step(PipelineStep(
            name="step1",
            tool=successful_tool,
            input_transformer=lambda data: PipelineTestInput(value=data.get("value", ""))
        ))
        pipeline.add_step(PipelineStep(
            name="step2",
            tool=failing_tool,
            input_transformer=lambda data: PipelineTestInput(value=data.get("value", ""))
        ))
        pipeline.add_step(PipelineStep(
            name="step3",
            tool=successful_tool,
            input_transformer=lambda data: PipelineTestInput(value=data.get("value", ""))
        ))
        
        context = await pipeline.execute({"value": "test"})
        
        assert context.status == PipelineStatus.FAILED
        assert len(context.errors) > 0
        assert context.errors[0]["step"] == "step2"
        assert "step3" not in context.results
    
    @pytest.mark.asyncio
    async def test_context_passing(self, successful_tool):
        pipeline = Pipeline("test")
        
        step = PipelineStep(
            name="step1",
            tool=successful_tool,
            input_transformer=lambda data: PipelineTestInput(value=data.get("value", "")),
            output_transformer=lambda output: {"transformed": "value"}
        )
        pipeline.add_step(step)
        pipeline.add_step(PipelineStep(
            name="step2",
            tool=successful_tool,
            input_transformer=lambda data: PipelineTestInput(value=data.get("transformed", ""))
        ))
        
        context = await pipeline.execute({"value": "initial"})
        
        assert context.status == PipelineStatus.COMPLETED
        assert "transformed" in context.data
    
    @pytest.mark.asyncio
    async def test_initial_data_passed(self, successful_tool):
        pipeline = Pipeline("test")
        pipeline.add_step(PipelineStep(
            name="step1",
            tool=successful_tool,
            input_transformer=lambda data: PipelineTestInput(value=data.get("value", ""))
        ))
        
        context = await pipeline.execute({"value": "my_value"})
        
        assert context.status == PipelineStatus.COMPLETED
    
    @pytest.mark.asyncio
    async def test_empty_pipeline(self):
        pipeline = Pipeline("empty")
        
        context = await pipeline.execute({})
        
        assert context.status == PipelineStatus.COMPLETED
        assert len(context.results) == 0
    
    @pytest.mark.asyncio
    async def test_on_error_callback(self, failing_tool):
        errors_caught = []
        
        def error_handler(e):
            errors_caught.append(str(e))
        
        pipeline = Pipeline("test")
        step = PipelineStep(
            name="failing",
            tool=failing_tool,
            input_transformer=lambda data: PipelineTestInput(value=data.get("value", "")),
            on_error=error_handler
        )
        pipeline.add_step(step)
        
        context = await pipeline.execute({"value": "test"})
        
        assert context.status == PipelineStatus.FAILED
        assert len(errors_caught) > 0


class TestPipelineContext:
    def test_initial_state(self):
        context = PipelineContext()
        
        assert context.status == PipelineStatus.PENDING
        assert context.data == {}
        assert context.results == {}
        assert context.errors == []
        assert context.current_step is None
    
    def test_with_initial_data(self):
        context = PipelineContext(data={"key": "value"})
        
        assert context.data == {"key": "value"}


class TestParallelPipeline:
    @pytest.fixture
    def slow_tool(self):
        return SlowTool()
    
    @pytest.fixture
    def successful_tool(self):
        return SuccessfulTool()
    
    def test_create_parallel_pipeline(self):
        parallel = ParallelPipeline("test_parallel")
        assert parallel.name == "test_parallel"
        assert len(parallel.pipelines) == 0
    
    def test_add_pipeline(self, successful_tool):
        parallel = ParallelPipeline("test")
        pipeline1 = Pipeline("p1").add_tool("s1", successful_tool)
        
        result = parallel.add_pipeline(pipeline1)
        
        assert result is parallel
        assert len(parallel.pipelines) == 1
    
    @pytest.mark.asyncio
    async def test_parallel_execution(self, slow_tool):
        import time
        
        parallel = ParallelPipeline("test")
        
        for i in range(3):
            p = Pipeline(f"p{i}")
            p.add_step(PipelineStep(
                name="step",
                tool=slow_tool,
                input_transformer=lambda data: PipelineTestInput(value=data.get("value", ""))
            ))
            parallel.add_pipeline(p)
        
        start = time.time()
        results = await parallel.execute({"value": "test"})
        elapsed = time.time() - start
        
        assert len(results) == 3
        assert elapsed < 0.5
    
    @pytest.mark.asyncio
    async def test_parallel_independent_results(self, successful_tool):
        parallel = ParallelPipeline("test")
        
        p1 = Pipeline("p1")
        p1.add_step(PipelineStep(
            name="step",
            tool=successful_tool,
            input_transformer=lambda data: PipelineTestInput(value=data.get("value", ""))
        ))
        
        p2 = Pipeline("p2")
        p2.add_step(PipelineStep(
            name="step",
            tool=successful_tool,
            input_transformer=lambda data: PipelineTestInput(value=data.get("value", ""))
        ))
        
        parallel.add_pipeline(p1).add_pipeline(p2)
        
        results = await parallel.execute({"value": "shared"})
        
        assert len(results) == 2
        for result in results:
            if isinstance(result, PipelineContext):
                assert result.status == PipelineStatus.COMPLETED


class TestRealToolsPipeline:
    @pytest.mark.asyncio
    async def test_plan_and_reason_pipeline(self):
        from src.tools.plan import PlanTool, PlanInput
        from src.tools.reason import ReasonTool, ReasonInput
        
        pipeline = Pipeline("plan_and_reason")
        
        plan_tool = PlanTool()
        reason_tool = ReasonTool()
        
        pipeline.add_step(PipelineStep(
            name="plan",
            tool=plan_tool,
            input_transformer=lambda data: PlanInput(goal=data.get("goal", "Test")),
            output_transformer=lambda output: {"plan_steps": len(output.data) if output.data else 0}
        ))
        
        pipeline.add_step(PipelineStep(
            name="reason",
            tool=reason_tool,
            input_transformer=lambda data: ReasonInput(
                question=f"Analyze plan with {data.get('plan_steps', 0)} steps"
            )
        ))
        
        context = await pipeline.execute({"goal": "Build an API"})
        
        assert context.status == PipelineStatus.COMPLETED
        assert "plan" in context.results
        assert "reason" in context.results
    
    @pytest.mark.asyncio
    async def test_memory_pipeline(self):
        from src.tools.memory_tools import (
            MemoryStoreTool, MemoryRetrieveTool,
            MemoryStoreInput, MemoryRetrieveInput, MemoryType
        )
        
        pipeline = Pipeline("memory_flow")
        
        store_tool = MemoryStoreTool()
        retrieve_tool = MemoryRetrieveTool()
        
        pipeline.add_step(PipelineStep(
            name="store",
            tool=store_tool,
            input_transformer=lambda data: MemoryStoreInput(
                key="pipeline_test_key",
                content=data.get("content", "test"),
                memory_type=MemoryType.SHORT_TERM
            )
        ))
        
        pipeline.add_step(PipelineStep(
            name="retrieve",
            tool=retrieve_tool,
            input_transformer=lambda data: MemoryRetrieveInput(key="pipeline_test_key")
        ))
        
        context = await pipeline.execute({"content": "pipeline data"})
        
        assert context.status == PipelineStatus.COMPLETED
        assert context.results["store"].success
        assert context.results["retrieve"].success
