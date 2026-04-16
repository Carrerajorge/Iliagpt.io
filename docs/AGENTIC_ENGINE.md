# Agentic Engine Documentation

## Overview

The Agentic Engine is an autonomous, intelligent orchestration system that analyzes user prompts, determines complexity, maps intents to tools, and executes multi-step workflows with resilience and error recovery.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      AGENTIC ENGINE                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ Complexity  │  │   Intent    │  │Orchestration│             │
│  │  Analyzer   │──│   Mapper    │──│   Engine    │             │
│  │  (1-10)     │  │  (5 langs)  │  │ (parallel)  │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│         │                │                │                     │
│         ▼                ▼                ▼                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ Compressed  │  │   Error     │  │    Gap      │             │
│  │   Memory    │  │  Recovery   │  │  Detector   │             │
│  │  (atoms)    │  │ (circuits)  │  │  (dedupe)   │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
├─────────────────────────────────────────────────────────────────┤
│                    TOOL REGISTRY (70 tools)                     │
└─────────────────────────────────────────────────────────────────┘
```

## Tool Categories

| Category | Count | Description |
|----------|-------|-------------|
| users | 8 | User management: create, update, delete, list, roles, plans, suspension |
| ai_models | 5 | AI model management: list, enable, disable, stats, configuration |
| payments | 6 | Payment processing: process, refund, list, invoices |
| analytics | 5 | Platform analytics: metrics, charts, realtime, comparison, tracking |
| database | 4 | Database operations: stats, tables, slow queries, backup |
| security | 6 | Security: audit logs, policies, IP blocking, API keys, scanning |
| reports | 4 | Report generation: generate, schedule, list, export |
| settings | 4 | Platform settings: get, update, reset, export |
| integrations | 7 | Third-party: Slack, Email, Webhooks, Calendar, Drive, SMS, Push |
| ai_advanced | 6 | Advanced AI: image generation, code review, summarization, translation, sentiment, NER |
| automation | 5 | Automation: scheduling, batch processing, workflows, backups, cleanup |
| data | 6 | Data operations: charts, CSV, PDF, Excel export, transform, import |
| communication | 4 | Communication: templates, broadcasts, notifications, announcements |
| **Total** | **70** | |

## Configuration

### Environment Variables

```bash
# Feature Flags
AGENTIC_CHAT_ENABLED=true          # Enable/disable agentic chat processing
AGENTIC_AUTONOMOUS_MODE=true       # Enable autonomous mode
AGENTIC_SUGGESTIONS_ENABLED=true   # Enable agentic suggestions

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000         # Rate limit window in milliseconds
RATE_LIMIT_MAX_REQUESTS=100        # Max requests per window

# Circuit Breaker
CIRCUIT_BREAKER_THRESHOLD=5        # Failures before opening
CIRCUIT_BREAKER_TIMEOUT=30000      # Time before half-open (ms)

# Memory
MEMORY_DECAY_FACTOR=0.95           # Memory decay per tick
MEMORY_MAX_ATOMS=1000              # Maximum memory atoms
```

## API Endpoints

### Tools Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/agentic/tools` | List all tools |
| GET | `/api/admin/agentic/tools/:id` | Get tool by ID |
| GET | `/api/admin/agentic/tools/category/:category` | Get tools by category |
| POST | `/api/admin/agentic/tools/:id/execute` | Execute a tool |
| PATCH | `/api/admin/agentic/tools/:id/toggle` | Enable/disable tool |
| GET | `/api/admin/agentic/tools/search?q=query` | Search tools |

### Analysis Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/admin/agentic/analyze` | Analyze prompt complexity |
| POST | `/api/admin/agentic/intent` | Map intent to tools |
| GET | `/api/admin/agentic/complexity/stats` | Get complexity statistics |

### Orchestration Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/admin/agentic/orchestrate` | Execute orchestrated workflow |
| GET | `/api/admin/agentic/orchestration/status/:id` | Get orchestration status |
| POST | `/api/admin/agentic/orchestration/cancel/:id` | Cancel orchestration |
| GET | `/api/admin/agentic/progress/:taskId` | Get progress for task |

### Memory & Gaps Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/agentic/memory` | Get compressed memory state |
| POST | `/api/admin/agentic/memory/store` | Store memory atom |
| GET | `/api/admin/agentic/gaps` | List detected gaps |
| POST | `/api/admin/agentic/gaps` | Report a gap |
| PATCH | `/api/admin/agentic/gaps/:id/resolve` | Resolve a gap |

### System Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health/live` | Liveness probe |
| GET | `/health/ready` | Readiness probe |
| GET | `/health` | Full health status |
| GET | `/api/admin/agentic/metrics` | System metrics |
| GET | `/api/admin/agentic/feature-flags` | Get feature flags |
| PATCH | `/api/admin/agentic/feature-flags` | Update feature flags |
| GET | `/api/admin/agentic/circuit-breakers` | Circuit breaker status |

## Usage Examples

### Analyze Prompt Complexity

```bash
curl -X POST http://localhost:5000/api/admin/agentic/analyze \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Create a user and send them a welcome email"}'
```

Response:
```json
{
  "score": 6,
  "dimensions": {
    "linguistic": 4,
    "semantic": 5,
    "contextual": 6,
    "technical": 5,
    "temporal": 3
  },
  "suggestedTools": ["create_user", "email_send"],
  "estimatedSteps": 2
}
```

### Map Intent to Tools

```bash
curl -X POST http://localhost:5000/api/admin/agentic/intent \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Listar todos los usuarios activos", "language": "es"}'
```

Response:
```json
{
  "intent": "list_users",
  "confidence": 0.95,
  "tools": ["list_users"],
  "language": "es",
  "entities": {
    "filter": "active"
  }
}
```

### Execute Orchestrated Workflow

```bash
curl -X POST http://localhost:5000/api/admin/agentic/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Generate monthly report and email to all admins",
    "options": {
      "parallel": true,
      "maxRetries": 3
    }
  }'
```

Response:
```json
{
  "orchestrationId": "orch_abc123",
  "status": "running",
  "steps": [
    {"tool": "generate_report", "status": "completed"},
    {"tool": "list_users", "status": "running"},
    {"tool": "email_send", "status": "pending"}
  ],
  "progress": 33
}
```

### Get Tool by ID

```bash
curl http://localhost:5000/api/admin/agentic/tools/create_user
```

Response:
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
  "healthStatus": "healthy"
}
```

### Store Memory Atom

```bash
curl -X POST http://localhost:5000/api/admin/agentic/memory/store \
  -H "Content-Type: application/json" \
  -d '{
    "key": "user_preference",
    "value": {"theme": "dark", "language": "es"},
    "context": "session_123"
  }'
```

### Report a Gap

```bash
curl -X POST http://localhost:5000/api/admin/agentic/gaps \
  -H "Content-Type: application/json" \
  -d '{
    "type": "missing_tool",
    "description": "Cannot export to PowerPoint format",
    "context": {"prompt": "Export report as PPTX"}
  }'
```

## Security

### Rate Limiting

The engine implements per-endpoint rate limiting:

| Endpoint Type | Limit | Window |
|--------------|-------|--------|
| Analysis | 60/min | 60s |
| Orchestration | 30/min | 60s |
| Tool Execution | 100/min | 60s |
| Memory Operations | 120/min | 60s |

### Circuit Breakers

Circuit breakers protect against cascading failures:

```typescript
interface CircuitBreakerConfig {
  threshold: number;      // Failures before open (default: 5)
  timeout: number;        // Time to half-open in ms (default: 30000)
  monitorInterval: number; // Check interval in ms (default: 10000)
}
```

States:
- **CLOSED**: Normal operation, requests pass through
- **OPEN**: Failures exceeded threshold, requests blocked
- **HALF_OPEN**: Testing recovery, limited requests allowed

### Feature Flags

Runtime control over engine functionality:

```typescript
{
  AGENTIC_CHAT_ENABLED: boolean;        // Main engine toggle
  AGENTIC_AUTONOMOUS_MODE: boolean;     // Autonomous execution
  AGENTIC_SUGGESTIONS_ENABLED: boolean; // Tool suggestions
}
```

### Audit Logging

All operations are logged with:
- Timestamp
- User ID
- Action type
- Resource affected
- Request details
- IP address
- Result status

### Input Sanitization

All inputs are sanitized to prevent:
- SQL injection
- XSS attacks
- Command injection
- Path traversal

## Metrics

### Available Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `agentic_tools_total` | Counter | Total tool count |
| `agentic_tools_enabled` | Gauge | Currently enabled tools |
| `agentic_requests_total` | Counter | Total requests processed |
| `agentic_request_duration_ms` | Histogram | Request latency |
| `agentic_errors_total` | Counter | Total errors by type |
| `agentic_circuit_breaker_state` | Gauge | Circuit breaker states |
| `agentic_memory_atoms` | Gauge | Current memory atoms |
| `agentic_orchestrations_active` | Gauge | Active orchestrations |

### Dashboard

Access the visual dashboard at `/admin/agentic` with 7 tabs:
1. **Overview** - System health and key metrics
2. **Tools** - Tool registry and management
3. **Orchestration** - Active workflows
4. **Memory** - Compressed memory state
5. **Gaps** - Detected gaps and resolutions
6. **Metrics** - Detailed performance metrics
7. **Settings** - Configuration management

## Troubleshooting

### Common Issues

#### Tool Not Found

```json
{"error": "Tool not found", "code": "TOOL_NOT_FOUND"}
```
**Solution**: Verify tool ID exists using `GET /api/admin/agentic/tools`

#### Circuit Breaker Open

```json
{"error": "Service temporarily unavailable", "code": "CIRCUIT_OPEN"}
```
**Solution**: Wait for circuit timeout or manually reset via dashboard

#### Rate Limit Exceeded

```json
{"error": "Too many requests", "code": "RATE_LIMITED", "retryAfter": 30}
```
**Solution**: Wait for the specified retry time

#### Intent Mapping Failed

```json
{"error": "Could not map intent", "code": "INTENT_UNMAPPED", "confidence": 0.3}
```
**Solution**: Rephrase the prompt or provide more context

#### Memory Limit Reached

```json
{"error": "Memory limit reached", "code": "MEMORY_FULL"}
```
**Solution**: Old atoms will decay automatically, or clear manually

### Health Check Commands

```bash
# Liveness check
curl http://localhost:5000/health/live

# Readiness check
curl http://localhost:5000/health/ready

# Full health status
curl http://localhost:5000/health
```

### Log Locations

- Application logs: `stdout/stderr`
- Audit logs: Database table `audit_logs`
- Error traces: Structured JSON format

### Debug Mode

Enable detailed logging:
```bash
DEBUG=agentic:* npm run dev
```

## Supported Languages

The IntentMapper supports:
- English (en)
- Spanish (es)
- French (fr)
- German (de)
- Portuguese (pt)
