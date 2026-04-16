from typing import List, Optional, Dict, Any
from pydantic import Field
from datetime import datetime
from enum import Enum
from .base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput
from ..core.registry import ToolRegistry


class MemoryType(str, Enum):
    SHORT_TERM = "short_term"
    LONG_TERM = "long_term"
    EPISODIC = "episodic"
    SEMANTIC = "semantic"


_memory_store: Dict[str, Dict[str, Any]] = {}


class MemoryStoreInput(ToolInput):
    key: str = Field(..., description="Unique key for the memory")
    content: Any = Field(..., description="Content to store")
    memory_type: MemoryType = Field(MemoryType.SHORT_TERM)
    tags: List[str] = Field(default_factory=list)
    ttl_seconds: Optional[int] = Field(None, description="Time to live in seconds")


class MemoryStoreOutput(ToolOutput):
    data: Optional[Dict[str, Any]] = None


@ToolRegistry.register
class MemoryStoreTool(BaseTool[MemoryStoreInput, MemoryStoreOutput]):
    name = "memory_store"
    description = "Stores information in agent memory for later retrieval"
    category = ToolCategory.MEMORY
    priority = Priority.CRITICAL
    dependencies = []

    async def execute(self, input: MemoryStoreInput) -> MemoryStoreOutput:
        self.logger.info(
            "storing_memory",
            key=input.key,
            memory_type=input.memory_type.value,
        )

        _memory_store[input.key] = {
            "content": input.content,
            "memory_type": input.memory_type.value,
            "tags": input.tags,
            "created_at": datetime.utcnow().isoformat(),
            "ttl_seconds": input.ttl_seconds,
        }

        return MemoryStoreOutput(
            success=True,
            data={"key": input.key, "stored": True},
        )


class MemoryRetrieveInput(ToolInput):
    key: Optional[str] = Field(None, description="Specific key to retrieve")
    tags: List[str] = Field(default_factory=list, description="Filter by tags")
    memory_type: Optional[MemoryType] = Field(None)
    limit: int = Field(10, ge=1, le=100)


class MemoryRetrieveOutput(ToolOutput):
    data: Optional[List[Dict[str, Any]]] = None


@ToolRegistry.register
class MemoryRetrieveTool(BaseTool[MemoryRetrieveInput, MemoryRetrieveOutput]):
    name = "memory_retrieve"
    description = "Retrieves stored information from agent memory"
    category = ToolCategory.MEMORY
    priority = Priority.CRITICAL
    dependencies = ["memory_store"]

    async def execute(self, input: MemoryRetrieveInput) -> MemoryRetrieveOutput:
        self.logger.info(
            "retrieving_memory",
            key=input.key,
            tags=input.tags,
        )

        results = []

        if input.key:
            if input.key in _memory_store:
                results.append({"key": input.key, **_memory_store[input.key]})
        else:
            for key, value in _memory_store.items():
                if input.memory_type and value["memory_type"] != input.memory_type.value:
                    continue
                if input.tags and not any(t in value["tags"] for t in input.tags):
                    continue
                results.append({"key": key, **value})
                if len(results) >= input.limit:
                    break

        return MemoryRetrieveOutput(success=True, data=results)


class ContextAction(str, Enum):
    ADD = "add"
    REMOVE = "remove"
    CLEAR = "clear"
    GET = "get"


class ContextManageInput(ToolInput):
    action: ContextAction = Field(..., description="Action to perform on context")
    context_key: Optional[str] = Field(None, description="Context key for add/remove")
    context_value: Optional[Any] = Field(None, description="Value for add action")
    namespace: str = Field("default", description="Context namespace")


class ContextManageOutput(ToolOutput):
    data: Optional[Dict[str, Any]] = None


_context_store: Dict[str, Dict[str, Any]] = {}


@ToolRegistry.register
class ContextManageTool(BaseTool[ContextManageInput, ContextManageOutput]):
    name = "context_manage"
    description = "Manages conversation and task context for the agent"
    category = ToolCategory.MEMORY
    priority = Priority.CRITICAL
    dependencies = []

    async def execute(self, input: ContextManageInput) -> ContextManageOutput:
        self.logger.info(
            "managing_context",
            action=input.action.value,
            namespace=input.namespace,
        )

        if input.namespace not in _context_store:
            _context_store[input.namespace] = {}

        namespace_ctx = _context_store[input.namespace]

        if input.action == ContextAction.ADD:
            if input.context_key:
                namespace_ctx[input.context_key] = input.context_value
            return ContextManageOutput(
                success=True,
                data={"action": "add", "key": input.context_key},
            )

        elif input.action == ContextAction.REMOVE:
            if input.context_key and input.context_key in namespace_ctx:
                del namespace_ctx[input.context_key]
            return ContextManageOutput(
                success=True,
                data={"action": "remove", "key": input.context_key},
            )

        elif input.action == ContextAction.CLEAR:
            _context_store[input.namespace] = {}
            return ContextManageOutput(
                success=True,
                data={"action": "clear", "namespace": input.namespace},
            )

        elif input.action == ContextAction.GET:
            return ContextManageOutput(
                success=True,
                data={"context": namespace_ctx},
            )

        return ContextManageOutput(success=False, error="Unknown action")
