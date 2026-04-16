# API Reference

## Base URL

```
http://localhost:5000/api
```

---

## Tools API

### List All Tools

Retrieve all registered tools in the system.

**Endpoint:** `GET /admin/agentic/tools`

**Response:**
```json
{
  "tools": [
    {
      "id": "create_user",
      "name": "Create User",
      "description": "Create a new user account",
      "category": "users",
      "capabilities": ["create user", "add user", "new user"],
      "endpoint": "/api/admin/users",
      "method": "POST",
      "isEnabled": true,
      "usageCount": 150,
      "successRate": 98.5,
      "healthStatus": "healthy",
      "failureCount": 2
    }
  ],
  "total": 70,
  "categories": 13
}
```

---

### Get Tool by ID

Retrieve a specific tool by its ID.

**Endpoint:** `GET /admin/agentic/tools/:id`

**Parameters:**
| Name | Type | Location | Description |
|------|------|----------|-------------|
| id | string | path | Tool identifier |

**Response:**
```json
{
  "id": "create_user",
  "name": "Create User",
  "description": "Create a new user account",
  "category": "users",
  "capabilities": ["create user", "add user", "new user", "crear usuario"],
  "endpoint": "/api/admin/users",
  "method": "POST",
  "isEnabled": true,
  "usageCount": 150,
  "successRate": 98.5,
  "healthStatus": "healthy",
  "failureCount": 2,
  "lastFailure": null
}
```

**Error Response (404):**
```json
{
  "error": "Tool not found",
  "code": "TOOL_NOT_FOUND"
}
```

---

### Get Tools by Category

Retrieve all tools in a specific category.

**Endpoint:** `GET /admin/agentic/tools/category/:category`

**Parameters:**
| Name | Type | Location | Description |
|------|------|----------|-------------|
| category | string | path | Category name (users, ai_models, payments, etc.) |

**Response:**
```json
{
  "category": "users",
  "tools": [...],
  "count": 8
}
```

---

### Search Tools

Search tools by name, description, or capabilities.

**Endpoint:** `GET /admin/agentic/tools/search`

**Query Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| q | string | Yes | Search query |

**Example:**
```
GET /admin/agentic/tools/search?q=email
```

**Response:**
```json
{
  "query": "email",
  "results": [
    {
      "id": "email_send",
      "name": "Send Email",
      "description": "Send emails, templates, and bulk email campaigns",
      "category": "integrations",
      "score": 0.95
    }
  ],
  "count": 3
}
```

---

### Execute Tool

Execute a specific tool with parameters.

**Endpoint:** `POST /admin/agentic/tools/:id/execute`

**Parameters:**
| Name | Type | Location | Description |
|------|------|----------|-------------|
| id | string | path | Tool identifier |

**Request Body:**
```json
{
  "params": {
    "key": "value"
  },
  "context": {
    "userId": "user_123",
    "sessionId": "session_456"
  }
}
```

**Response:**
```json
{
  "success": true,
  "result": {...},
  "executionTime": 245,
  "toolId": "create_user"
}
```

**Error Response (500):**
```json
{
  "success": false,
  "error": "Execution failed",
  "code": "EXECUTION_ERROR",
  "details": "User already exists"
}
```

---

### Toggle Tool

Enable or disable a tool.

**Endpoint:** `PATCH /admin/agentic/tools/:id/toggle`

**Request Body:**
```json
{
  "isEnabled": false
}
```

**Response:**
```json
{
  "id": "create_user",
  "isEnabled": false,
  "healthStatus": "disabled",
  "updatedAt": "2024-12-27T12:00:00Z"
}
```

---

## Analysis API

### Analyze Prompt Complexity

Analyze the complexity of a user prompt.

**Endpoint:** `POST /admin/agentic/analyze`

**Request Body:**
```json
{
  "prompt": "Create a user, send welcome email, and schedule onboarding call"
}
```

**Response:**
```json
{
  "score": 7,
  "dimensions": {
    "linguistic": 5,
    "semantic": 6,
    "contextual": 7,
    "technical": 6,
    "temporal": 4
  },
  "suggestedTools": ["create_user", "email_send", "calendar_event"],
  "estimatedSteps": 3,
  "confidence": 0.88,
  "breakdown": {
    "entities": 3,
    "actions": 3,
    "dependencies": 2
  }
}
```

---

### Map Intent to Tools

Map user intent to appropriate tools.

**Endpoint:** `POST /admin/agentic/intent`

**Request Body:**
```json
{
  "prompt": "Quiero ver todos los pagos del mes",
  "language": "es",
  "context": {
    "previousIntent": "list_users"
  }
}
```

**Response:**
```json
{
  "intent": "list_payments",
  "confidence": 0.92,
  "tools": [
    {
      "id": "list_payments",
      "name": "List Payments",
      "matchScore": 0.95
    }
  ],
  "language": "es",
  "entities": {
    "timeframe": "month",
    "resource": "payments"
  },
  "alternatives": [
    {
      "intent": "get_metrics",
      "confidence": 0.45
    }
  ]
}
```

---

### Get Complexity Statistics

Get aggregated complexity analysis statistics.

**Endpoint:** `GET /admin/agentic/complexity/stats`

**Response:**
```json
{
  "totalAnalyzed": 1500,
  "averageScore": 5.2,
  "distribution": {
    "1-3": 250,
    "4-6": 800,
    "7-10": 450
  },
  "topIntents": [
    {"intent": "list_users", "count": 320},
    {"intent": "create_user", "count": 280}
  ],
  "languageBreakdown": {
    "en": 1000,
    "es": 350,
    "fr": 100,
    "de": 30,
    "pt": 20
  }
}
```

---

## Orchestration API

### Execute Orchestration

Start an orchestrated multi-step workflow.

**Endpoint:** `POST /admin/agentic/orchestrate`

**Request Body:**
```json
{
  "prompt": "Generate monthly report, export to PDF, and email to all admins",
  "options": {
    "parallel": true,
    "maxRetries": 3,
    "timeout": 60000,
    "priority": "high"
  }
}
```

**Response:**
```json
{
  "orchestrationId": "orch_abc123",
  "status": "running",
  "createdAt": "2024-12-27T12:00:00Z",
  "steps": [
    {
      "stepId": "step_1",
      "tool": "generate_report",
      "status": "completed",
      "result": {...},
      "duration": 1200
    },
    {
      "stepId": "step_2",
      "tool": "pdf_generate",
      "status": "running",
      "progress": 45
    },
    {
      "stepId": "step_3",
      "tool": "email_send",
      "status": "pending",
      "dependencies": ["step_2"]
    }
  ],
  "overallProgress": 48,
  "estimatedCompletion": "2024-12-27T12:02:00Z"
}
```

---

### Get Orchestration Status

Get the current status of an orchestration.

**Endpoint:** `GET /admin/agentic/orchestration/status/:id`

**Parameters:**
| Name | Type | Location | Description |
|------|------|----------|-------------|
| id | string | path | Orchestration ID |

**Response:**
```json
{
  "orchestrationId": "orch_abc123",
  "status": "completed",
  "steps": [...],
  "overallProgress": 100,
  "completedAt": "2024-12-27T12:02:30Z",
  "totalDuration": 150000,
  "results": {
    "step_1": {...},
    "step_2": {...},
    "step_3": {...}
  }
}
```

---

### Cancel Orchestration

Cancel a running orchestration.

**Endpoint:** `POST /admin/agentic/orchestration/cancel/:id`

**Response:**
```json
{
  "orchestrationId": "orch_abc123",
  "status": "cancelled",
  "cancelledAt": "2024-12-27T12:01:00Z",
  "completedSteps": 1,
  "cancelledSteps": 2
}
```

---

### Get Task Progress

Get progress for a specific task.

**Endpoint:** `GET /admin/agentic/progress/:taskId`

**Response:**
```json
{
  "taskId": "task_xyz789",
  "status": "running",
  "progress": 65,
  "currentStep": "Processing data",
  "steps": [
    {"name": "Initialize", "status": "completed"},
    {"name": "Processing data", "status": "running", "progress": 65},
    {"name": "Finalize", "status": "pending"}
  ],
  "startedAt": "2024-12-27T12:00:00Z",
  "eta": "2024-12-27T12:01:30Z"
}
```

---

## Memory API

### Get Memory State

Retrieve the current compressed memory state.

**Endpoint:** `GET /admin/agentic/memory`

**Response:**
```json
{
  "atoms": [
    {
      "id": "atom_001",
      "key": "user_preference",
      "value": {"theme": "dark"},
      "context": "session_123",
      "weight": 0.85,
      "createdAt": "2024-12-27T11:00:00Z",
      "lastAccessed": "2024-12-27T12:00:00Z",
      "accessCount": 5
    }
  ],
  "totalAtoms": 150,
  "memoryUsage": 0.15,
  "decayFactor": 0.95,
  "lastDecayAt": "2024-12-27T11:55:00Z"
}
```

---

### Store Memory Atom

Store a new memory atom.

**Endpoint:** `POST /admin/agentic/memory/store`

**Request Body:**
```json
{
  "key": "user_preference",
  "value": {
    "theme": "dark",
    "language": "es",
    "notifications": true
  },
  "context": "session_123",
  "ttl": 3600
}
```

**Response:**
```json
{
  "id": "atom_002",
  "key": "user_preference",
  "value": {...},
  "context": "session_123",
  "weight": 1.0,
  "createdAt": "2024-12-27T12:00:00Z",
  "expiresAt": "2024-12-27T13:00:00Z"
}
```

---

## Gaps API

### List Gaps

List all detected capability gaps.

**Endpoint:** `GET /admin/agentic/gaps`

**Query Parameters:**
| Name | Type | Description |
|------|------|-------------|
| status | string | Filter by status (open, resolved, ignored) |
| type | string | Filter by type (missing_tool, unmapped_intent, etc.) |
| page | number | Page number |
| limit | number | Items per page |

**Response:**
```json
{
  "gaps": [
    {
      "id": "gap_001",
      "type": "missing_tool",
      "signature": "export_pptx_hash123",
      "description": "Cannot export to PowerPoint format",
      "context": {
        "prompt": "Export report as PPTX",
        "timestamp": "2024-12-27T11:30:00Z"
      },
      "occurrences": 5,
      "status": "open",
      "createdAt": "2024-12-27T10:00:00Z",
      "lastOccurrence": "2024-12-27T11:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 15,
    "pages": 1
  }
}
```

---

### Report Gap

Report a new capability gap.

**Endpoint:** `POST /admin/agentic/gaps`

**Request Body:**
```json
{
  "type": "missing_tool",
  "description": "Cannot export to PowerPoint format",
  "context": {
    "prompt": "Export report as PPTX",
    "userId": "user_123"
  }
}
```

**Response:**
```json
{
  "id": "gap_002",
  "type": "missing_tool",
  "signature": "export_pptx_hash456",
  "description": "Cannot export to PowerPoint format",
  "status": "open",
  "createdAt": "2024-12-27T12:00:00Z",
  "deduplicated": false
}
```

---

### Resolve Gap

Mark a gap as resolved.

**Endpoint:** `PATCH /admin/agentic/gaps/:id/resolve`

**Request Body:**
```json
{
  "resolution": "Implemented export_pptx tool",
  "resolvedBy": "admin_user"
}
```

**Response:**
```json
{
  "id": "gap_001",
  "status": "resolved",
  "resolution": "Implemented export_pptx tool",
  "resolvedBy": "admin_user",
  "resolvedAt": "2024-12-27T12:00:00Z"
}
```

---

## System API

### Health - Liveness

Simple liveness check.

**Endpoint:** `GET /health/live`

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-12-27T12:00:00Z"
}
```

---

### Health - Readiness

Readiness check with component status.

**Endpoint:** `GET /health/ready`

**Response (200):**
```json
{
  "status": "ready",
  "checks": {
    "database": "healthy",
    "memory": "healthy",
    "uptime": "healthy"
  },
  "uptime": 86400,
  "timestamp": "2024-12-27T12:00:00Z"
}
```

**Response (503 - Degraded):**
```json
{
  "status": "degraded",
  "checks": {
    "database": "unhealthy",
    "memory": "healthy",
    "uptime": "healthy"
  },
  "uptime": 86400,
  "timestamp": "2024-12-27T12:00:00Z"
}
```

---

### Health - Full Status

Comprehensive health status with memory details.

**Endpoint:** `GET /health`

**Response:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "node": "v20.10.0",
  "memory": {
    "heapUsed": "125MB",
    "heapTotal": "256MB",
    "rss": "312MB"
  },
  "uptime": "86400s",
  "timestamp": "2024-12-27T12:00:00Z"
}
```

---

### Get Metrics

Retrieve system metrics.

**Endpoint:** `GET /admin/agentic/metrics`

**Response:**
```json
{
  "tools": {
    "total": 70,
    "enabled": 68,
    "disabled": 2,
    "healthy": 65,
    "degraded": 3
  },
  "requests": {
    "total": 15000,
    "success": 14850,
    "failed": 150,
    "avgLatency": 125
  },
  "orchestrations": {
    "active": 5,
    "completed": 1200,
    "failed": 15,
    "avgDuration": 2500
  },
  "memory": {
    "atoms": 450,
    "maxAtoms": 1000,
    "usage": 0.45
  },
  "circuitBreakers": {
    "closed": 68,
    "open": 1,
    "halfOpen": 1
  },
  "uptime": 86400,
  "timestamp": "2024-12-27T12:00:00Z"
}
```

---

### Get Feature Flags

Get current feature flag states.

**Endpoint:** `GET /admin/agentic/feature-flags`

**Response:**
```json
{
  "AGENTIC_CHAT_ENABLED": true,
  "AGENTIC_AUTONOMOUS_MODE": true,
  "AGENTIC_SUGGESTIONS_ENABLED": true
}
```

---

### Update Feature Flags

Update feature flag states.

**Endpoint:** `PATCH /admin/agentic/feature-flags`

**Request Body:**
```json
{
  "AGENTIC_AUTONOMOUS_MODE": false
}
```

**Response:**
```json
{
  "AGENTIC_CHAT_ENABLED": true,
  "AGENTIC_AUTONOMOUS_MODE": false,
  "AGENTIC_SUGGESTIONS_ENABLED": true,
  "updatedAt": "2024-12-27T12:00:00Z"
}
```

---

### Get Circuit Breaker Status

Get the status of all circuit breakers.

**Endpoint:** `GET /admin/agentic/circuit-breakers`

**Response:**
```json
{
  "breakers": [
    {
      "name": "create_user",
      "state": "closed",
      "failures": 0,
      "successRate": 100,
      "lastFailure": null
    },
    {
      "name": "email_send",
      "state": "open",
      "failures": 5,
      "successRate": 0,
      "lastFailure": "2024-12-27T11:55:00Z",
      "opensAt": "2024-12-27T11:55:00Z",
      "closesAt": "2024-12-27T12:00:30Z"
    }
  ],
  "summary": {
    "closed": 68,
    "open": 1,
    "halfOpen": 1
  }
}
```

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| TOOL_NOT_FOUND | 404 | The specified tool does not exist |
| EXECUTION_ERROR | 500 | Tool execution failed |
| CIRCUIT_OPEN | 503 | Circuit breaker is open |
| RATE_LIMITED | 429 | Rate limit exceeded |
| INTENT_UNMAPPED | 400 | Could not map intent to tools |
| MEMORY_FULL | 507 | Memory limit reached |
| ORCHESTRATION_NOT_FOUND | 404 | Orchestration ID not found |
| INVALID_REQUEST | 400 | Invalid request body |
| UNAUTHORIZED | 401 | Authentication required |
| FORBIDDEN | 403 | Insufficient permissions |

---

## Rate Limits

| Endpoint Category | Requests | Window |
|-------------------|----------|--------|
| Analysis | 60 | 60s |
| Orchestration | 30 | 60s |
| Tool Execution | 100 | 60s |
| Memory Operations | 120 | 60s |
| System/Health | Unlimited | - |

When rate limited, the response includes:
```json
{
  "error": "Too many requests",
  "code": "RATE_LIMITED",
  "retryAfter": 30,
  "limit": 60,
  "remaining": 0,
  "reset": "2024-12-27T12:01:00Z"
}
```
