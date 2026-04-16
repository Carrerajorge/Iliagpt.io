# Python Agent Tools API Documentation

## Overview

The Python Agent Tools API provides a FastAPI-based interface for executing agent tools, managing agents, and running workflows. This API serves as the bridge between TypeScript applications and Python-based tool execution.

**Base URL:** `http://localhost:8001`

**API Documentation:**
- Swagger UI: `/docs`
- ReDoc: `/redoc`

## Authentication

Currently, the API does not require authentication for local development. For production deployments, implement appropriate authentication mechanisms (API keys, JWT tokens, etc.).

## Endpoints

### Health Check

#### GET /health

Check the API health status.

**Response:**
```json
{
  "status": "healthy",
  "tools_count": 18,
  "agents_count": 5,
  "version": "1.0.0",
  "uptime_seconds": 3600.5
}
```

**Example:**
```bash
curl http://localhost:8001/health
```

---

### Tools

#### GET /tools

List all registered tools.

**Response:**
```json
[
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
```

**Example:**
```bash
curl http://localhost:8001/tools
```

---

#### GET /tools/{tool_name}

Get details for a specific tool.

**Parameters:**
| Name | Type | Location | Description |
|------|------|----------|-------------|
| tool_name | string | path | Name of the tool |

**Response:**
```json
{
  "name": "shell",
  "description": "Execute shell commands safely",
  "category": "execution",
  "priority": "high",
  "dependencies": []
}
```

**Error Response (404):**
```json
{
  "detail": "Tool 'unknown_tool' not found"
}
```

**Example:**
```bash
curl http://localhost:8001/tools/shell
```

---

#### POST /tools/{tool_name}/execute

Execute a tool with the provided input.

**Parameters:**
| Name | Type | Location | Description |
|------|------|----------|-------------|
| tool_name | string | path | Name of the tool to execute |

**Request Body:**
```json
{
  "tool_name": "shell",
  "input": {
    "command": "echo Hello World"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "stdout": "Hello World\n",
    "stderr": "",
    "exit_code": 0
  },
  "error": null,
  "metadata": {
    "execution_time_ms": 45,
    "tool_version": "1.0.0"
  }
}
```

**Error Response (500):**
```json
{
  "success": false,
  "data": null,
  "error": "Command execution failed: Permission denied",
  "metadata": {}
}
```

**Example:**
```bash
curl -X POST http://localhost:8001/tools/shell/execute \
  -H "Content-Type: application/json" \
  -d '{"tool_name": "shell", "input": {"command": "echo test"}}'
```

---

### Agents

#### GET /agents

List all registered agents.

**Response:**
```json
[
  {
    "name": "research_agent",
    "description": "Agent for conducting web research",
    "category": "research",
    "tools_used": ["search_web", "web_scraper", "browser"]
  }
]
```

**Example:**
```bash
curl http://localhost:8001/agents
```

---

#### GET /agents/{agent_name}

Get details for a specific agent.

**Parameters:**
| Name | Type | Location | Description |
|------|------|----------|-------------|
| agent_name | string | path | Name of the agent |

**Response:**
```json
{
  "name": "research_agent",
  "description": "Agent for conducting web research",
  "category": "research",
  "tools_used": ["search_web", "web_scraper", "browser"]
}
```

**Example:**
```bash
curl http://localhost:8001/agents/research_agent
```

---

#### POST /agents/{agent_name}/execute

Execute an agent with a task.

**Parameters:**
| Name | Type | Location | Description |
|------|------|----------|-------------|
| agent_name | string | path | Name of the agent to execute |

**Request Body:**
```json
{
  "task": "Research the latest developments in AI",
  "context": {
    "max_results": 10,
    "date_range": "last_week"
  }
}
```

**Response:**
```json
{
  "success": true,
  "result": {
    "findings": [...],
    "sources": [...]
  },
  "execution_time_ms": 5000
}
```

**Example:**
```bash
curl -X POST http://localhost:8001/agents/research_agent/execute \
  -H "Content-Type: application/json" \
  -d '{"task": "Find recent AI news", "context": {}}'
```

---

### Workflows

#### GET /workflows

List all registered workflows.

**Response:**
```json
[
  {
    "name": "document_analysis",
    "description": "Analyze documents and extract insights",
    "steps": ["parse", "analyze", "summarize"]
  }
]
```

**Example:**
```bash
curl http://localhost:8001/workflows
```

---

#### POST /workflows/{workflow_name}/execute

Execute a workflow.

**Parameters:**
| Name | Type | Location | Description |
|------|------|----------|-------------|
| workflow_name | string | path | Name of the workflow |

**Request Body:**
```json
{
  "input": {
    "document_url": "https://example.com/doc.pdf"
  },
  "options": {
    "detailed": true
  }
}
```

**Example:**
```bash
curl -X POST http://localhost:8001/workflows/document_analysis/execute \
  -H "Content-Type: application/json" \
  -d '{"input": {"document_url": "https://example.com/doc.pdf"}}'
```

---

## Error Codes

| HTTP Code | Description |
|-----------|-------------|
| 200 | Success |
| 400 | Bad Request - Invalid input parameters |
| 404 | Not Found - Tool/Agent/Workflow not found |
| 422 | Validation Error - Request body validation failed |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error - Execution failed |

## Error Response Format

All error responses follow this format:

```json
{
  "detail": "Error message describing what went wrong"
}
```

For validation errors (422):
```json
{
  "detail": [
    {
      "loc": ["body", "input", "command"],
      "msg": "field required",
      "type": "value_error.missing"
    }
  ]
}
```

## Rate Limiting

The API implements rate limiting to prevent abuse:
- **Default limit:** 100 requests per minute
- **Burst size:** 20 requests

When rate limited, you'll receive a 429 response:
```json
{
  "detail": "Rate limit exceeded. Please try again later."
}
```

## Available Tools

| Tool Name | Category | Description |
|-----------|----------|-------------|
| shell | execution | Execute shell commands safely |
| code_execute | execution | Execute code in sandboxed environment |
| file_read | file | Read file contents |
| file_write | file | Write content to files |
| plan | planning | Create execution plans |
| orchestrate | orchestration | Coordinate multi-tool workflows |
| memory_store | memory | Store data in memory |
| memory_retrieve | memory | Retrieve data from memory |
| context_manage | memory | Manage conversation context |
| reason | reasoning | Perform logical reasoning |
| message_send | communication | Send messages |
| message_receive | communication | Receive messages |
| broadcast | communication | Broadcast to multiple recipients |
| search_web | web | Search the web |
| api_call | web | Make API calls |
| embeddings | ai | Generate embeddings |
| secrets_manage | security | Manage secrets securely |
| sanitize_input | security | Sanitize user input |
| web_scraper | web | Scrape web content |
| browser | web | Browser automation |
| document_gen | document | Generate documents |
| data_transform | data | Transform data formats |
| data_validate | data | Validate data |

## TypeScript Client Usage

Use the `PythonToolsClient` class for TypeScript integration:

```typescript
import { PythonToolsClient } from './lib/pythonToolsClient';

const client = new PythonToolsClient('http://localhost:8001');

// Check health
const isAvailable = await client.isAvailable();

// List tools
const tools = await client.listTools();

// Execute a tool
const result = await client.executeTool('shell', {
  command: 'echo Hello'
});

// List agents
const agents = await client.listAgents();

// Execute an agent
const agentResult = await client.executeAgent('research_agent', 'Find AI news');
```

## WebSocket Endpoints

The API provides WebSocket endpoints for real-time updates on agent executions and workflow progress.

### WebSocket /ws/agents

Connect to receive real-time agent execution updates.

**Connection URL:** `ws://localhost:8001/ws/agents`

**Message Types Received:**

```json
{
  "type": "connected",
  "channel": "agents",
  "message": "Connected to agents channel"
}
```

```json
{
  "type": "agent_update",
  "agent_name": "research_agent",
  "status": "running",
  "data": {
    "task": "Find recent AI news",
    "progress": 0.5
  }
}
```

**Message Types to Send:**

```json
{"type": "ping"}
```
Response: `{"type": "pong"}`

```json
{"type": "subscribe"}
```
Response: `{"type": "subscribed", "channel": "agents"}`

---

### WebSocket /ws/workflows

Connect to receive real-time workflow progress updates.

**Connection URL:** `ws://localhost:8001/ws/workflows`

**Message Types Received:**

```json
{
  "type": "connected",
  "channel": "workflows",
  "message": "Connected to workflows channel"
}
```

```json
{
  "type": "workflow_update",
  "workflow_id": "abc123",
  "status": "running",
  "progress": 0.5,
  "data": {
    "name": "document_analysis",
    "current_step": "parse"
  }
}
```

**Message Types to Send:**

```json
{"type": "ping"}
```
Response: `{"type": "pong"}`

```json
{"type": "subscribe", "workflow_id": "abc123"}
```
Response: `{"type": "subscribed", "channel": "workflows", "workflow_id": "abc123"}`

---

### GET /ws/status

Get current WebSocket connection statistics.

**Response:**
```json
{
  "total_connections": 5,
  "channels": {
    "agents": 3,
    "workflows": 2
  }
}
```

**Example:**
```bash
curl http://localhost:8001/ws/status
```

---

## WebSocket Client Examples

### JavaScript/TypeScript Client

```typescript
// Connect to agents channel
const agentsSocket = new WebSocket('ws://localhost:8001/ws/agents');

agentsSocket.onopen = () => {
  console.log('Connected to agents channel');
  // Send ping to keep connection alive
  setInterval(() => {
    agentsSocket.send(JSON.stringify({ type: 'ping' }));
  }, 30000);
};

agentsSocket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  switch (message.type) {
    case 'agent_update':
      console.log(`Agent ${message.agent_name} status: ${message.status}`);
      if (message.data.progress) {
        console.log(`Progress: ${message.data.progress * 100}%`);
      }
      break;
    case 'pong':
      console.log('Received pong');
      break;
  }
};

agentsSocket.onerror = (error) => {
  console.error('WebSocket error:', error);
};

agentsSocket.onclose = () => {
  console.log('Disconnected from agents channel');
};
```

### Python Client

```python
import asyncio
import websockets
import json

async def listen_to_agents():
    uri = "ws://localhost:8001/ws/agents"
    async with websockets.connect(uri) as websocket:
        print("Connected to agents channel")
        
        # Handle incoming messages
        async for message in websocket:
            data = json.loads(message)
            
            if data["type"] == "agent_update":
                print(f"Agent {data['agent_name']} status: {data['status']}")
                if "progress" in data.get("data", {}):
                    print(f"Progress: {data['data']['progress'] * 100}%")
            elif data["type"] == "connected":
                print(data["message"])

asyncio.run(listen_to_agents())
```

### React Hook Example

```typescript
import { useEffect, useState, useCallback, useRef } from 'react';

interface AgentUpdate {
  type: string;
  agent_name: string;
  status: string;
  data: Record<string, any>;
}

export function useAgentUpdates() {
  const [updates, setUpdates] = useState<AgentUpdate[]>([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const socket = new WebSocket('ws://localhost:8001/ws/agents');
    socketRef.current = socket;

    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'agent_update') {
        setUpdates(prev => [...prev, message]);
      }
    };

    return () => socket.close();
  }, []);

  const clearUpdates = useCallback(() => setUpdates([]), []);

  return { updates, connected, clearUpdates };
}
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PYTHON_TOOLS_API_URL | http://localhost:8001 | Base URL for the API |
| RATE_LIMIT_RPM | 100 | Requests per minute limit |
| RATE_LIMIT_BURST | 20 | Burst size for rate limiting |
| LOG_LEVEL | INFO | Logging level |
