"""Tests for the tool registry pattern."""

import pytest
from src.core.registry import ToolRegistry
from src.tools.base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput


class DummyInput(ToolInput):
    value: str = "test"


class DummyOutput(ToolOutput):
    pass


class DummyTool(BaseTool[DummyInput, DummyOutput]):
    name = "dummy_tool"
    description = "A dummy tool for testing"
    category = ToolCategory.SYSTEM
    priority = Priority.MEDIUM
    dependencies = []
    
    async def execute(self, input: DummyInput) -> DummyOutput:
        return DummyOutput(success=True, data={"value": input.value})


class DummyHighPriorityTool(BaseTool[DummyInput, DummyOutput]):
    name = "dummy_high_priority"
    description = "A high priority dummy tool"
    category = ToolCategory.ORCHESTRATION
    priority = Priority.CRITICAL
    dependencies = ["dummy_tool"]
    
    async def execute(self, input: DummyInput) -> DummyOutput:
        return DummyOutput(success=True)


class TestToolRegistry:
    def test_register_tool(self):
        registry = ToolRegistry()
        initial_count = len(registry.list_all())
        
        @ToolRegistry.register
        class TestToolReg(BaseTool[DummyInput, DummyOutput]):
            name = "test_tool_reg"
            description = "Test tool"
            category = ToolCategory.SYSTEM
            priority = Priority.LOW
            dependencies = []
            
            async def execute(self, input: DummyInput) -> DummyOutput:
                return DummyOutput(success=True)
        
        assert "test_tool_reg" in registry.list_all()
    
    def test_get_by_name(self):
        ToolRegistry.register(DummyTool)
        registry = ToolRegistry()
        
        tool_class = registry.get("dummy_tool")
        assert tool_class is not None
        assert tool_class.name == "dummy_tool"
    
    def test_get_nonexistent(self):
        registry = ToolRegistry()
        result = registry.get("nonexistent_tool_xyz_123")
        assert result is None
    
    def test_list_all(self):
        ToolRegistry.register(DummyTool)
        ToolRegistry.register(DummyHighPriorityTool)
        registry = ToolRegistry()
        
        all_tools = registry.list_all()
        assert "dummy_tool" in all_tools
        assert "dummy_high_priority" in all_tools
    
    def test_list_by_category(self):
        ToolRegistry.register(DummyTool)
        ToolRegistry.register(DummyHighPriorityTool)
        registry = ToolRegistry()
        
        system_tools = registry.list_by_category(ToolCategory.SYSTEM)
        assert "dummy_tool" in system_tools
        
        orchestration_tools = registry.list_by_category(ToolCategory.ORCHESTRATION)
        assert "dummy_high_priority" in orchestration_tools
    
    def test_list_by_priority(self):
        ToolRegistry.register(DummyTool)
        ToolRegistry.register(DummyHighPriorityTool)
        registry = ToolRegistry()
        
        medium_priority = registry.list_by_priority(Priority.MEDIUM)
        assert "dummy_tool" in medium_priority
        
        critical_priority = registry.list_by_priority(Priority.CRITICAL)
        assert "dummy_high_priority" in critical_priority
    
    def test_get_dependencies(self):
        ToolRegistry.register(DummyTool)
        ToolRegistry.register(DummyHighPriorityTool)
        registry = ToolRegistry()
        
        deps = registry.get_dependencies("dummy_high_priority")
        assert deps == ["dummy_tool"]
        
        no_deps = registry.get_dependencies("dummy_tool")
        assert no_deps == []
    
    def test_get_dependencies_nonexistent(self):
        registry = ToolRegistry()
        deps = registry.get_dependencies("nonexistent")
        assert deps == []


class TestRegistryWithRealTools:
    def test_registered_tools_count(self):
        from src.tools.shell import ShellTool
        from src.tools.code_execute import CodeExecuteTool
        from src.tools.file_tools import FileReadTool, FileWriteTool
        from src.tools.plan import PlanTool
        
        registry = ToolRegistry()
        all_tools = registry.list_all()
        assert len(all_tools) >= 4
    
    def test_shell_tool_registered(self):
        from src.tools.shell import ShellTool
        registry = ToolRegistry()
        
        tool = registry.get("shell")
        assert tool is not None
        assert tool.name == "shell"
        assert tool.category == ToolCategory.SYSTEM
    
    def test_security_tools_category(self):
        from src.tools.sanitize_input import SanitizeInputTool
        from src.tools.secrets_manage import SecretsManageTool
        
        registry = ToolRegistry()
        security_tools = registry.list_by_category(ToolCategory.SECURITY)
        
        assert "sanitize_input" in security_tools
        assert "secrets_manage" in security_tools
