"""Pytest fixtures for python-agent-tools tests."""

import pytest
import asyncio
from typing import Generator, AsyncGenerator
from unittest.mock import MagicMock, AsyncMock

pytest_plugins = ('pytest_asyncio',)

from src.tools.base import BaseTool, ToolInput, ToolOutput, ToolCategory, Priority
from src.core.registry import ToolRegistry


def _register_all_tools():
    """Import and register all tools."""
    from src.tools.shell import ShellTool
    from src.tools.code_execute import CodeExecuteTool
    from src.tools.file_tools import FileReadTool, FileWriteTool
    from src.tools.sanitize_input import SanitizeInputTool
    from src.tools.secrets_manage import SecretsManageTool
    from src.tools.plan import PlanTool
    from src.tools.reason import ReasonTool
    from src.tools.memory_tools import MemoryStoreTool, MemoryRetrieveTool, ContextManageTool
    from src.tools.search_web import SearchWebTool
    from src.tools.api_call import ApiCallTool
    from src.tools.embeddings import EmbeddingsTool


_register_all_tools()


@pytest.fixture(scope="session")
def event_loop() -> Generator[asyncio.AbstractEventLoop, None, None]:
    """Create an event loop for async tests."""
    policy = asyncio.get_event_loop_policy()
    loop = policy.new_event_loop()
    yield loop
    loop.close()


class MockToolInput(ToolInput):
    """Mock tool input for testing."""
    value: str


class MockToolOutput(ToolOutput):
    """Mock tool output for testing."""
    pass


class MockTool(BaseTool[MockToolInput, MockToolOutput]):
    """Mock tool implementation for testing."""
    
    name = "mock_tool"
    description = "A mock tool for testing"
    category = ToolCategory.SYSTEM
    priority = Priority.MEDIUM
    
    async def execute(self, input: MockToolInput) -> MockToolOutput:
        return MockToolOutput(
            success=True,
            data={"processed": input.value},
        )


@pytest.fixture
def mock_tool() -> MockTool:
    """Create a mock tool for testing."""
    return MockTool()


@pytest.fixture
def mock_llm_response() -> str:
    """Create a mock LLM response."""
    return "This is a mock LLM response for testing purposes."


@pytest.fixture
def mock_llm_adapter() -> MagicMock:
    """Create a mock LLM adapter."""
    adapter = MagicMock()
    adapter.complete = AsyncMock(return_value="Mock completion")
    adapter.chat = AsyncMock(return_value="Mock chat response")
    adapter.embed = AsyncMock(return_value=[0.1, 0.2, 0.3])
    return adapter
