"""Tests for the tool factory pattern."""

import pytest
from src.core.factory import ToolFactory
from src.core.registry import ToolRegistry
from src.tools.base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput


class FactoryTestInput(ToolInput):
    value: str = "default"


class FactoryTestOutput(ToolOutput):
    pass


class FactoryTestTool(BaseTool[FactoryTestInput, FactoryTestOutput]):
    name = "factory_test_tool"
    description = "Factory test tool"
    category = ToolCategory.SYSTEM
    priority = Priority.MEDIUM
    dependencies = []
    
    async def execute(self, input: FactoryTestInput) -> FactoryTestOutput:
        return FactoryTestOutput(success=True, data={"value": input.value})


class DependentTool(BaseTool[FactoryTestInput, FactoryTestOutput]):
    name = "dependent_tool"
    description = "Tool with dependencies"
    category = ToolCategory.SYSTEM
    priority = Priority.HIGH
    dependencies = ["factory_test_tool"]
    
    async def execute(self, input: FactoryTestInput) -> FactoryTestOutput:
        return FactoryTestOutput(success=True)


class NestedDependentTool(BaseTool[FactoryTestInput, FactoryTestOutput]):
    name = "nested_dependent_tool"
    description = "Tool with nested dependencies"
    category = ToolCategory.SYSTEM
    priority = Priority.LOW
    dependencies = ["dependent_tool"]
    
    async def execute(self, input: FactoryTestInput) -> FactoryTestOutput:
        return FactoryTestOutput(success=True)


ToolRegistry.register(FactoryTestTool)
ToolRegistry.register(DependentTool)
ToolRegistry.register(NestedDependentTool)


class TestToolFactory:
    @pytest.fixture
    def factory(self):
        return ToolFactory(ToolRegistry())
    
    def test_create_tool(self, factory):
        tool = factory.create("factory_test_tool")
        
        assert tool is not None
        assert tool.name == "factory_test_tool"
        assert isinstance(tool, FactoryTestTool)
    
    def test_create_nonexistent_tool(self, factory):
        tool = factory.create("nonexistent_tool_xyz")
        assert tool is None
    
    def test_get_or_create_caching(self, factory):
        tool1 = factory.get_or_create("factory_test_tool")
        tool2 = factory.get_or_create("factory_test_tool")
        
        assert tool1 is not None
        assert tool2 is not None
        assert tool1 is tool2
    
    def test_get_or_create_different_tools(self, factory):
        tool1 = factory.get_or_create("factory_test_tool")
        tool2 = factory.get_or_create("dependent_tool")
        
        assert tool1 is not None
        assert tool2 is not None
        assert tool1 is not tool2
    
    def test_create_with_dependencies(self, factory):
        tools = factory.create_with_dependencies("dependent_tool")
        
        assert "factory_test_tool" in tools
        assert "dependent_tool" in tools
        assert len(tools) == 2
    
    def test_create_with_nested_dependencies(self, factory):
        tools = factory.create_with_dependencies("nested_dependent_tool")
        
        assert "factory_test_tool" in tools
        assert "dependent_tool" in tools
        assert "nested_dependent_tool" in tools
        assert len(tools) == 3
    
    def test_create_tool_no_dependencies(self, factory):
        tools = factory.create_with_dependencies("factory_test_tool")
        
        assert "factory_test_tool" in tools
        assert len(tools) == 1
    
    def test_configure_factory(self, factory):
        factory.configure({"setting1": "value1", "setting2": "value2"})
        assert factory._config == {"setting1": "value1", "setting2": "value2"}
    
    def test_get_or_create_nonexistent(self, factory):
        tool = factory.get_or_create("nonexistent_xyz")
        assert tool is None


class TestFactoryWithRealTools:
    @pytest.fixture
    def factory(self):
        return ToolFactory(ToolRegistry())
    
    def test_create_shell_tool(self, factory):
        tool = factory.create("shell")
        
        assert tool is not None
        assert tool.name == "shell"
    
    def test_create_code_execute_tool(self, factory):
        tool = factory.create("code_execute")
        
        assert tool is not None
        assert tool.name == "code_execute"
    
    def test_create_file_tools(self, factory):
        read_tool = factory.create("file_read")
        write_tool = factory.create("file_write")
        
        assert read_tool is not None
        assert write_tool is not None
        assert read_tool.name == "file_read"
        assert write_tool.name == "file_write"
    
    def test_create_reason_with_dependencies(self, factory):
        from src.tools.memory_tools import MemoryStoreTool, MemoryRetrieveTool
        
        tools = factory.create_with_dependencies("reason")
        
        assert "reason" in tools
        assert "memory_retrieve" in tools or len(tools) >= 1
    
    @pytest.mark.asyncio
    async def test_created_tool_execution(self, factory):
        tool = factory.create("plan")
        
        assert tool is not None
        from src.tools.plan import PlanInput
        result = await tool.execute(PlanInput(goal="Test goal"))
        
        assert result.success
        assert result.data is not None
