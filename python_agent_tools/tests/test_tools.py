"""Tests for critical agent tools."""

import pytest
import asyncio
import os
import tempfile
from src.tools.base import ToolCategory, Priority
from src.tools.shell import ShellTool, ShellInput
from src.tools.code_execute import CodeExecuteTool, CodeExecuteInput
from src.tools.file_tools import FileReadTool, FileWriteTool, FileReadInput, FileWriteInput
from src.tools.sanitize_input import SanitizeInputTool, SanitizeInput
from src.tools.secrets_manage import SecretsManageTool, SecretsGetInput
from src.tools.plan import PlanTool, PlanInput
from src.tools.reason import ReasonTool, ReasonInput
from src.tools.memory_tools import MemoryStoreTool, MemoryRetrieveTool, MemoryStoreInput, MemoryRetrieveInput, MemoryType
from src.tools.search_web import SearchWebTool, SearchWebInput
from src.tools.api_call import ApiCallTool, ApiCallInput, HttpMethod
from src.tools.embeddings import EmbeddingsTool, EmbeddingsInput, EmbeddingModel


class TestShellTool:
    @pytest.fixture
    def tool(self):
        return ShellTool()
    
    @pytest.mark.asyncio
    async def test_allowed_command(self, tool):
        result = await tool.execute(ShellInput(command="echo hello"))
        assert result.success
        assert "hello" in result.stdout
    
    @pytest.mark.asyncio
    async def test_disallowed_command(self, tool):
        result = await tool.execute(ShellInput(command="rm -rf /"))
        assert not result.success
        assert "not allowed" in result.error.lower()
    
    @pytest.mark.asyncio
    async def test_ls_command(self, tool):
        result = await tool.execute(ShellInput(command="ls"))
        assert result.success
        assert result.return_code == 0
    
    @pytest.mark.asyncio
    async def test_pwd_command(self, tool):
        result = await tool.execute(ShellInput(command="pwd"))
        assert result.success
        assert result.stdout is not None
    
    @pytest.mark.asyncio
    async def test_empty_command(self, tool):
        result = await tool.execute(ShellInput(command=""))
        assert not result.success
        assert "empty" in result.error.lower() or "not allowed" in result.error.lower()
    
    def test_metadata(self, tool):
        meta = tool.get_metadata()
        assert meta["name"] == "shell"
        assert meta["category"] == "Sistema"
        assert meta["priority"] == "Crítica"


class TestCodeExecuteTool:
    @pytest.fixture
    def tool(self):
        return CodeExecuteTool()
    
    @pytest.mark.asyncio
    async def test_simple_code(self, tool):
        result = await tool.execute(CodeExecuteInput(code="print('hello world')"))
        assert result.success
        assert "hello world" in result.stdout
    
    @pytest.mark.asyncio
    async def test_math_operations(self, tool):
        result = await tool.execute(CodeExecuteInput(
            code="import math\nprint(math.sqrt(16))"
        ))
        assert result.success
        assert "4.0" in result.stdout
    
    @pytest.mark.asyncio
    async def test_dangerous_import_blocked(self, tool):
        result = await tool.execute(CodeExecuteInput(code="import os\nos.system('ls')"))
        assert not result.success
        assert "not allowed" in result.error.lower() or "dangerous" in result.error.lower()
    
    @pytest.mark.asyncio
    async def test_subprocess_blocked(self, tool):
        result = await tool.execute(CodeExecuteInput(code="import subprocess"))
        assert not result.success
    
    def test_metadata(self, tool):
        meta = tool.get_metadata()
        assert meta["name"] == "code_execute"
        assert meta["category"] == "Sistema"


class TestFileTools:
    @pytest.fixture
    def read_tool(self):
        return FileReadTool()
    
    @pytest.fixture
    def write_tool(self):
        return FileWriteTool()
    
    @pytest.mark.asyncio
    async def test_read_existing_file(self, read_tool):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
            f.write("test content")
            temp_path = f.name
        
        try:
            result = await read_tool.execute(FileReadInput(path=temp_path))
            assert result.success
            assert result.content == "test content"
            assert result.size is not None
        finally:
            os.unlink(temp_path)
    
    @pytest.mark.asyncio
    async def test_read_nonexistent_file(self, read_tool):
        result = await read_tool.execute(FileReadInput(path="/tmp/nonexistent_file_12345.txt"))
        assert not result.success
        assert "not found" in result.error.lower()
    
    @pytest.mark.asyncio
    async def test_write_file(self, write_tool):
        temp_path = f"/tmp/test_write_{os.getpid()}.txt"
        try:
            result = await write_tool.execute(FileWriteInput(
                path=temp_path,
                content="hello world",
                overwrite=True
            ))
            assert result.success
            assert result.bytes_written > 0
            
            with open(temp_path, 'r') as f:
                assert f.read() == "hello world"
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
    
    @pytest.mark.asyncio
    async def test_write_blocked_extension(self, write_tool):
        result = await write_tool.execute(FileWriteInput(
            path="/tmp/test.sh",
            content="#!/bin/bash\necho hello",
            overwrite=True
        ))
        assert not result.success
        assert "extension" in result.error.lower()
    
    @pytest.mark.asyncio
    async def test_path_traversal_blocked(self, read_tool):
        result = await read_tool.execute(FileReadInput(path="../../../etc/passwd"))
        assert not result.success
        assert "traversal" in result.error.lower()


class TestSanitizeInput:
    @pytest.fixture
    def tool(self):
        return SanitizeInputTool()
    
    @pytest.mark.asyncio
    async def test_sql_injection_detection(self, tool):
        result = await tool.execute(SanitizeInput(text="1' OR '1'='1"))
        assert not result.is_safe
        assert any("SQL" in w for w in result.warnings)
    
    @pytest.mark.asyncio
    async def test_path_traversal_detection(self, tool):
        result = await tool.execute(SanitizeInput(text="../../../etc/passwd"))
        assert not result.is_safe
        assert any("traversal" in w.lower() for w in result.warnings)
    
    @pytest.mark.asyncio
    async def test_command_injection_detection(self, tool):
        result = await tool.execute(SanitizeInput(text="test; rm -rf /"))
        assert not result.is_safe
        assert any("command" in w.lower() or "injection" in w.lower() for w in result.warnings)
    
    @pytest.mark.asyncio
    async def test_safe_input(self, tool):
        result = await tool.execute(SanitizeInput(text="Hello World"))
        assert result.is_safe
        assert len(result.warnings) == 0
    
    @pytest.mark.asyncio
    async def test_html_escape(self, tool):
        result = await tool.execute(SanitizeInput(text="<script>alert('xss')</script>"))
        assert result.success
        assert "&lt;" in result.sanitized_text


class TestSecretsManageTool:
    @pytest.fixture
    def tool(self):
        return SecretsManageTool()
    
    @pytest.mark.asyncio
    async def test_get_nonexistent_secret(self, tool):
        result = await tool.execute(SecretsGetInput(key="NONEXISTENT_KEY_12345"))
        assert result.success
        assert not result.exists
    
    @pytest.mark.asyncio
    async def test_get_existing_env_secret(self, tool):
        os.environ["TEST_SECRET_KEY"] = "test_value"
        try:
            result = await tool.execute(SecretsGetInput(key="TEST_SECRET_KEY"))
            assert result.success
            assert result.exists
        finally:
            del os.environ["TEST_SECRET_KEY"]
    
    def test_metadata(self, tool):
        meta = tool.get_metadata()
        assert meta["name"] == "secrets_manage"
        assert meta["category"] == "Seguridad"


class TestPlanTool:
    @pytest.fixture
    def tool(self):
        return PlanTool()
    
    @pytest.mark.asyncio
    async def test_creates_plan(self, tool):
        result = await tool.execute(PlanInput(goal="Build a website"))
        assert result.success
        assert result.data is not None
        assert len(result.data) > 0
    
    @pytest.mark.asyncio
    async def test_plan_with_context(self, tool):
        result = await tool.execute(PlanInput(
            goal="Create API",
            context="Using FastAPI framework"
        ))
        assert result.success
        assert result.data is not None
    
    @pytest.mark.asyncio
    async def test_plan_steps_have_required_fields(self, tool):
        result = await tool.execute(PlanInput(goal="Test goal"))
        assert result.success
        for step in result.data:
            assert hasattr(step, 'step_number')
            assert hasattr(step, 'action')
            assert hasattr(step, 'expected_output')
    
    def test_metadata(self, tool):
        meta = tool.get_metadata()
        assert meta["name"] == "plan"
        assert meta["category"] == "Orquestación"


class TestReasonTool:
    @pytest.fixture
    def tool(self):
        return ReasonTool()
    
    @pytest.mark.asyncio
    async def test_basic_reasoning(self, tool):
        result = await tool.execute(ReasonInput(question="What is 2 + 2?"))
        assert result.success
        assert result.conclusion is not None
        assert len(result.reasoning_steps) > 0
    
    @pytest.mark.asyncio
    async def test_reasoning_with_premises(self, tool):
        result = await tool.execute(ReasonInput(
            question="Is it raining?",
            premises=["The ground is wet", "People are carrying umbrellas"]
        ))
        assert result.success
        assert len(result.reasoning_steps) >= 2
        assert result.confidence > 0
    
    @pytest.mark.asyncio
    async def test_deductive_reasoning(self, tool):
        from src.tools.reason import ReasoningType
        result = await tool.execute(ReasonInput(
            question="Test",
            reasoning_type=ReasoningType.DEDUCTIVE
        ))
        assert result.success
        assert result.data["reasoning_type"] == "deductive"
    
    def test_metadata(self, tool):
        meta = tool.get_metadata()
        assert meta["name"] == "reason"
        assert meta["category"] == "Razonamiento"


class TestMemoryTools:
    @pytest.mark.asyncio
    async def test_store_and_retrieve(self):
        store_tool = MemoryStoreTool()
        retrieve_tool = MemoryRetrieveTool()
        
        store_result = await store_tool.execute(
            MemoryStoreInput(key="test_key_123", content={"data": "test"}, memory_type=MemoryType.SHORT_TERM)
        )
        assert store_result.success
        
        retrieve_result = await retrieve_tool.execute(
            MemoryRetrieveInput(key="test_key_123")
        )
        assert retrieve_result.success
        assert len(retrieve_result.data) > 0
    
    @pytest.mark.asyncio
    async def test_store_with_tags(self):
        store_tool = MemoryStoreTool()
        
        result = await store_tool.execute(
            MemoryStoreInput(
                key="tagged_memory",
                content="test content",
                memory_type=MemoryType.LONG_TERM,
                tags=["test", "example"]
            )
        )
        assert result.success
    
    @pytest.mark.asyncio
    async def test_retrieve_nonexistent(self):
        retrieve_tool = MemoryRetrieveTool()
        
        result = await retrieve_tool.execute(
            MemoryRetrieveInput(key="nonexistent_key_999")
        )
        assert result.success
        assert len(result.data) == 0
    
    def test_metadata(self):
        store_tool = MemoryStoreTool()
        meta = store_tool.get_metadata()
        assert meta["name"] == "memory_store"
        assert meta["category"] == "Memoria"


class TestSearchWebTool:
    @pytest.fixture
    def tool(self):
        return SearchWebTool()
    
    @pytest.mark.asyncio
    async def test_basic_search(self, tool):
        result = await tool.execute(SearchWebInput(query="python programming"))
        assert result.success
        assert result.data is not None
        assert len(result.data) > 0
    
    @pytest.mark.asyncio
    async def test_search_result_structure(self, tool):
        result = await tool.execute(SearchWebInput(query="test query"))
        assert result.success
        for item in result.data:
            assert hasattr(item, 'title')
            assert hasattr(item, 'url')
            assert hasattr(item, 'snippet')
    
    def test_metadata(self, tool):
        meta = tool.get_metadata()
        assert meta["name"] == "search_web"
        assert meta["category"] == "Web"


class TestApiCallTool:
    @pytest.fixture
    def tool(self):
        return ApiCallTool()
    
    @pytest.mark.asyncio
    async def test_get_request(self, tool):
        result = await tool.execute(ApiCallInput(
            url="https://httpbin.org/get",
            method=HttpMethod.GET,
            timeout=10.0
        ))
        if result.success:
            assert result.status_code == 200
            assert result.elapsed_ms > 0
    
    @pytest.mark.asyncio
    async def test_post_request(self, tool):
        result = await tool.execute(ApiCallInput(
            url="https://httpbin.org/post",
            method=HttpMethod.POST,
            body={"test": "data"},
            timeout=10.0
        ))
        if result.success:
            assert result.status_code == 200
    
    def test_metadata(self, tool):
        meta = tool.get_metadata()
        assert meta["name"] == "api_call"
        assert meta["category"] == "APIs"


class TestEmbeddingsTool:
    @pytest.fixture
    def tool(self):
        return EmbeddingsTool()
    
    @pytest.mark.asyncio
    async def test_generate_embeddings(self, tool):
        result = await tool.execute(EmbeddingsInput(
            texts=["Hello world", "Test text"],
            model=EmbeddingModel.OPENAI_3_SMALL
        ))
        assert result.success
        assert result.data is not None
        assert len(result.data) == 2
    
    @pytest.mark.asyncio
    async def test_embedding_dimensions(self, tool):
        result = await tool.execute(EmbeddingsInput(
            texts=["Test"],
            model=EmbeddingModel.OPENAI_3_SMALL
        ))
        assert result.success
        assert result.data[0].dimensions == 1536
        assert len(result.data[0].embedding) == 1536
    
    @pytest.mark.asyncio
    async def test_embedding_normalization(self, tool):
        result = await tool.execute(EmbeddingsInput(
            texts=["Test normalization"],
            normalize=True
        ))
        assert result.success
        embedding = result.data[0].embedding
        magnitude = sum(x ** 2 for x in embedding) ** 0.5
        assert abs(magnitude - 1.0) < 0.01
    
    def test_metadata(self, tool):
        meta = tool.get_metadata()
        assert meta["name"] == "embeddings"
        assert meta["category"] == "Generación"
