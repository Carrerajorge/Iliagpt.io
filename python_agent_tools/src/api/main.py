from fastapi import FastAPI, HTTPException, Query, Path, Body, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional, get_type_hints, Type
import structlog
import asyncio

from ..utils.logging_config import setup_logging
from ..utils.config import get_settings

setup_logging()
logger = structlog.get_logger(__name__)
settings = get_settings()

from ..tools.base import BaseTool, ToolCategory, Priority

def _register_tools():
    """Import all tools to register them."""
    from ..tools.shell import ShellTool
    from ..tools.code_execute import CodeExecuteTool
    from ..tools.file_tools import FileReadTool, FileWriteTool
    from ..tools.plan import PlanTool
    from ..tools.orchestrate import OrchestrateTool
    from ..tools.memory_tools import MemoryStoreTool, MemoryRetrieveTool, ContextManageTool
    from ..tools.reason import ReasonTool
    from ..tools.message import MessageSendTool, MessageReceiveTool, BroadcastTool
    from ..tools.search_web import SearchWebTool
    from ..tools.api_call import ApiCallTool
    from ..tools.embeddings import EmbeddingsTool
    from ..tools.secrets_manage import SecretsManageTool
    from ..tools.sanitize_input import SanitizeInputTool
    from ..tools.web_scraper import WebScraperTool
    from ..tools.browser_tool import BrowserTool
    from ..tools.document_gen import DocumentGenTool
    from ..tools.data_transform import DataTransformTool, DataValidateTool
    from ..tools.nlp_tools import TextAnalyzeTool, SummarizeTool, TranslateTool
    from ..tools.analytics_tools import DataStatsTool, TrendAnalyzeTool
    from ..tools.monitoring_tools import SystemMonitorTool, ProcessMonitorTool

_register_tools()

from ..core.registry import registry
from ..core.factory import ToolFactory

API_DESCRIPTION = """
## Python Agent Tools API

A FastAPI-based interface for executing agent tools, managing agents, and running workflows.

### Features

* **Tools Management** - List, inspect, and execute individual tools
* **Agents Management** - List and execute AI agents that combine multiple tools
* **Workflows** - Execute complex multi-step workflows
* **Health Monitoring** - Check API status and metrics

### Rate Limiting

The API implements rate limiting to prevent abuse:
- Default limit: 100 requests per minute
- Burst size: 20 requests

### Error Handling

All errors return a consistent JSON format with a `detail` field describing the error.
"""

TAGS_METADATA = [
    {
        "name": "health",
        "description": "Health check and status endpoints",
    },
    {
        "name": "tools",
        "description": "Operations for listing, inspecting, and executing individual tools",
    },
    {
        "name": "agents",
        "description": "Operations for managing and executing AI agents",
    },
    {
        "name": "workflows",
        "description": "Operations for executing multi-step workflows",
    },
    {
        "name": "websocket",
        "description": "WebSocket endpoints for real-time updates",
    },
]

app = FastAPI(
    title="Python Agent Tools API",
    description=API_DESCRIPTION,
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_tags=TAGS_METADATA,
    contact={
        "name": "API Support",
        "email": "support@example.com",
    },
    license_info={
        "name": "MIT",
    },
)

from ..utils.middleware import (
    RequestLoggingMiddleware,
    RateLimitMiddleware,
    ErrorHandlingMiddleware,
    SecurityHeadersMiddleware,
)

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(ErrorHandlingMiddleware)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(
    RateLimitMiddleware,
    requests_per_minute=getattr(settings, 'rate_limit_rpm', 100),
    burst_size=getattr(settings, 'rate_limit_burst', 20),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from .agents import agents_router
from .workflows import workflows_router
from .health import router as health_router

app.include_router(health_router, tags=["health"])
app.include_router(agents_router, prefix="/agents", tags=["agents"])
app.include_router(workflows_router, prefix="/workflows", tags=["workflows"])

factory = ToolFactory()


class ToolExecuteRequest(BaseModel):
    """Request body for executing a tool."""
    tool_name: str = Field(
        ...,
        description="The name of the tool to execute"
    )
    input: Dict[str, Any] = Field(
        ...,
        description="Input parameters for the tool"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "tool_name": "shell",
                "input": {"command": "echo Hello World"}
            }
        }


class ToolExecuteResponse(BaseModel):
    """Response from tool execution."""
    success: bool = Field(
        ...,
        description="Whether the tool execution was successful"
    )
    data: Optional[Any] = Field(
        None,
        description="The output data from the tool execution"
    )
    error: Optional[str] = Field(
        None,
        description="Error message if execution failed"
    )
    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="Additional metadata about the execution"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "data": {"stdout": "Hello World\n", "stderr": "", "exit_code": 0},
                "error": None,
                "metadata": {"execution_time_ms": 45}
            }
        }


class ToolInfo(BaseModel):
    """Information about a registered tool."""
    name: str = Field(
        ...,
        description="Unique identifier for the tool"
    )
    description: str = Field(
        ...,
        description="Human-readable description of what the tool does"
    )
    category: str = Field(
        ...,
        description="Category the tool belongs to"
    )
    priority: str = Field(
        ...,
        description="Priority level of the tool"
    )
    dependencies: List[str] = Field(
        ...,
        description="List of tool dependencies"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "name": "shell",
                "description": "Execute shell commands safely",
                "category": "execution",
                "priority": "high",
                "dependencies": []
            }
        }


@app.get(
    "/tools",
    response_model=List[ToolInfo],
    tags=["tools"],
    summary="List all registered tools",
    description="Returns a list of all tools registered in the system with their metadata.",
    responses={
        200: {
            "description": "List of tools retrieved successfully",
            "content": {
                "application/json": {
                    "example": [
                        {
                            "name": "shell",
                            "description": "Execute shell commands safely",
                            "category": "execution",
                            "priority": "high",
                            "dependencies": []
                        },
                        {
                            "name": "code_execute",
                            "description": "Execute code in a sandboxed environment",
                            "category": "execution",
                            "priority": "high",
                            "dependencies": ["sanitize_input"]
                        }
                    ]
                }
            }
        }
    }
)
async def list_tools():
    """
    List all registered tools.
    
    Returns a complete list of all tools available in the system,
    including their names, descriptions, categories, priorities,
    and dependencies.
    """
    tools = []
    for name in registry.list_all():
        tool_class = registry.get(name)
        if tool_class:
            tools.append(ToolInfo(
                name=tool_class.name,
                description=tool_class.description,
                category=tool_class.category.value,
                priority=tool_class.priority.value,
                dependencies=tool_class.dependencies
            ))
    return tools


@app.get(
    "/tools/{tool_name}",
    response_model=ToolInfo,
    tags=["tools"],
    summary="Get tool details",
    description="Retrieve detailed information about a specific tool by name.",
    responses={
        200: {
            "description": "Tool details retrieved successfully",
            "model": ToolInfo
        },
        404: {
            "description": "Tool not found",
            "content": {
                "application/json": {
                    "example": {"detail": "Tool 'unknown_tool' not found"}
                }
            }
        }
    }
)
async def get_tool(
    tool_name: str = Path(
        ...,
        description="The unique name of the tool to retrieve"
    )
):
    """
    Get details for a specific tool.
    
    Retrieves the full metadata for a tool including its description,
    category, priority level, and any dependencies it requires.
    
    - **tool_name**: The unique identifier of the tool
    """
    tool_class = registry.get(tool_name)
    if not tool_class:
        raise HTTPException(status_code=404, detail=f"Tool '{tool_name}' not found")
    return ToolInfo(
        name=tool_class.name,
        description=tool_class.description,
        category=tool_class.category.value,
        priority=tool_class.priority.value,
        dependencies=tool_class.dependencies
    )


@app.post(
    "/tools/{tool_name}/execute",
    response_model=ToolExecuteResponse,
    tags=["tools"],
    summary="Execute a tool",
    description="Execute a specific tool with the provided input parameters.",
    responses={
        200: {
            "description": "Tool executed successfully",
            "model": ToolExecuteResponse
        },
        404: {
            "description": "Tool not found",
            "content": {
                "application/json": {
                    "example": {"detail": "Tool 'unknown_tool' not found"}
                }
            }
        },
        500: {
            "description": "Tool execution failed",
            "content": {
                "application/json": {
                    "example": {"detail": "Command execution failed: Permission denied"}
                }
            }
        }
    }
)
async def execute_tool(
    tool_name: str = Path(
        ...,
        description="The name of the tool to execute"
    ),
    request: ToolExecuteRequest = Body(...)
):
    """
    Execute a tool with given input.
    
    Runs the specified tool with the provided input parameters and
    returns the execution result including any output data, errors,
    and metadata.
    
    - **tool_name**: The unique identifier of the tool to execute
    - **request**: The execution request containing tool_name and input parameters
    
    ### Example
    
    ```json
    {
        "tool_name": "shell",
        "input": {"command": "echo Hello World"}
    }
    ```
    """
    from ..utils.middleware import TOOL_EXECUTIONS
    import time
    
    logger.info("execute_tool_request", tool=tool_name)
    
    tool = factory.get_or_create(tool_name)
    if not tool:
        raise HTTPException(status_code=404, detail=f"Tool '{tool_name}' not found")
    
    start_time = time.perf_counter()
    success = False
    
    try:
        tool_class = tool.__class__
        input_class: Optional[Type[Any]] = None
        for base in getattr(tool_class, '__orig_bases__', []):
            if hasattr(base, '__args__') and len(base.__args__) > 0:
                input_class = base.__args__[0]
                break
        if input_class is None:
            raise HTTPException(status_code=500, detail="Could not determine input class for tool")
        tool_input = input_class(**request.input)
        result = await tool.execute(tool_input)
        success = result.success
        
        TOOL_EXECUTIONS.labels(tool_name=tool_name, success=str(success)).inc()
        
        return ToolExecuteResponse(
            success=result.success,
            data=result.data,
            error=result.error,
            metadata=result.metadata
        )
    except Exception as e:
        TOOL_EXECUTIONS.labels(tool_name=tool_name, success="false").inc()
        logger.error("tool_execution_failed", tool=tool_name, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


from .websocket import manager, publish_agent_update, publish_workflow_update
from ..core.state_manager import set_websocket_publishers


@app.on_event("startup")
async def configure_websocket_publishers():
    """Configure WebSocket publishers for state manager on startup."""
    set_websocket_publishers(
        agent_publisher=publish_agent_update,
        workflow_publisher=publish_workflow_update
    )
    logger.info("websocket_publishers_configured")


@app.websocket("/ws/agents")
async def websocket_agents(websocket: WebSocket):
    """
    WebSocket endpoint for real-time agent execution updates.
    
    Connect to receive updates when:
    - Agent starts execution
    - Agent progress updates
    - Agent completes or fails
    
    Messages are JSON formatted with structure:
    {
        "type": "agent_update",
        "agent_name": "research_agent",
        "status": "running",
        "data": {...}
    }
    """
    await manager.connect(websocket, channel="agents")
    try:
        await websocket.send_json({
            "type": "connected",
            "channel": "agents",
            "message": "Connected to agents channel"
        })
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                if message.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
                elif message.get("type") == "subscribe":
                    await websocket.send_json({
                        "type": "subscribed",
                        "channel": "agents"
                    })
            except json.JSONDecodeError:
                await websocket.send_json({
                    "type": "error",
                    "message": "Invalid JSON format"
                })
    except WebSocketDisconnect:
        manager.disconnect(websocket, channel="agents")
        logger.info("websocket_agents_disconnected")


@app.websocket("/ws/workflows")
async def websocket_workflows(websocket: WebSocket):
    """
    WebSocket endpoint for real-time workflow progress updates.
    
    Connect to receive updates when:
    - Workflow starts execution
    - Workflow step completes
    - Workflow progress changes
    - Workflow completes or fails
    
    Messages are JSON formatted with structure:
    {
        "type": "workflow_update",
        "workflow_id": "abc123",
        "status": "running",
        "progress": 0.5,
        "data": {...}
    }
    """
    await manager.connect(websocket, channel="workflows")
    try:
        await websocket.send_json({
            "type": "connected",
            "channel": "workflows",
            "message": "Connected to workflows channel"
        })
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                if message.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
                elif message.get("type") == "subscribe":
                    workflow_id = message.get("workflow_id")
                    await websocket.send_json({
                        "type": "subscribed",
                        "channel": "workflows",
                        "workflow_id": workflow_id
                    })
            except json.JSONDecodeError:
                await websocket.send_json({
                    "type": "error",
                    "message": "Invalid JSON format"
                })
    except WebSocketDisconnect:
        manager.disconnect(websocket, channel="workflows")
        logger.info("websocket_workflows_disconnected")


@app.get(
    "/ws/status",
    tags=["websocket"],
    summary="Get WebSocket connection status",
    description="Returns the current WebSocket connection statistics."
)
async def websocket_status():
    """Get current WebSocket connection statistics."""
    return {
        "total_connections": manager.get_connection_count(),
        "channels": {
            channel: manager.get_connection_count(channel)
            for channel in manager.get_channels()
        }
    }


import json
