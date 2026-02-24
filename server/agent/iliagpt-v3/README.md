# ILIAGPT v3 Integration Analysis

## Architecture Mapping: IliaGPT → ILIAGPT v3

### Existing Components to Reuse/Enhance

| IliaGPT Component | Location | ILIAGPT v3 Equivalent | Status |
|-------------------|----------|---------------------|--------|
| PolicyEngine | `server/agent/policyEngine.ts` | PolicyEngine (RBAC) | Enhance |
| AgentEventBus | `server/agent/eventBus.ts` | EventBus | ✓ Reuse |
| Guardrails | `server/agent/guardrails.ts` | Audit + Sanitize | ✓ Reuse |
| ToolRegistry | `server/agent/pipeline/registry.ts` | ToolRegistry | Enhance |
| AgentRunner | `server/services/agentRunner.ts` | AgentRunner | Enhance |

### New Components to Implement

| ILIAGPT v3 Component | Priority | Description |
|--------------------|----------|-------------|
| ServiceRegistry | High | Lightweight DI container |
| IliagptError | High | Structured errors with codes |
| CircuitBreaker | High | Failure isolation pattern |
| Bulkhead | Medium | Concurrency limiting per tool |
| TTLCache | Medium | Cache with TTL for tool results |
| ToolRunner Enterprise | High | Unified tool execution with resilience |
| WorkflowEngine DAG | Medium | Concurrent workflow execution |
| HybridRouter | Low | Rules + LLM routing (intent-engine exists) |
| Tracer | Medium | Distributed tracing spans |
| Metrics | Medium | Performance metrics collection |

## Implementation Strategy

### Phase 1: Core Infrastructure (Tasks 2-3)
- Create base types and structured errors
- Implement ServiceRegistry for DI

### Phase 2: Resilience Patterns (Tasks 4-5)
- Enhance observability (Logger, Metrics, Tracer)
- Implement CircuitBreaker, Bulkhead, RateLimiter, TTLCache

### Phase 3: Tool Execution (Tasks 6-7)
- Create enterprise ToolRunner
- Enhance PolicyEngine with RBAC

### Phase 4: Workflow & Integration (Tasks 8-9)
- Implement WorkflowEngine DAG
- Integrate with chatService

## Key Integration Points

1. **chatService.ts** - Main integration point for ToolRunner
2. **policyEngine.ts** - Extend with RBAC capabilities
3. **eventBus.ts** - Reuse for events, add Metrics
4. **guardrails.ts** - Integrate with sanitization

## Directory Structure

```
server/agent/iliagpt-v3/
├── README.md                 # This file
├── types.ts                  # Base types and interfaces
├── errors.ts                 # IliagptError class
├── config.ts                 # Configuration with Zod
├── registry/
│   ├── serviceRegistry.ts    # DI container
│   └── index.ts
├── observability/
│   ├── logger.ts             # Structured logger
│   ├── metrics.ts            # Metrics collection
│   ├── tracer.ts             # Distributed tracing
│   ├── eventBus.ts           # Simple event bus
│   └── index.ts
├── resilience/
│   ├── circuitBreaker.ts     # Circuit breaker
│   ├── bulkhead.ts           # Concurrency limiter
│   ├── rateLimiter.ts        # Token bucket rate limiter
│   ├── cache.ts              # TTL cache
│   ├── memory.ts             # Memory with TTL and vector support
│   └── index.ts
├── execution/
│   ├── toolRunner.ts         # Enterprise tool runner
│   ├── workflowEngine.ts     # DAG workflow engine
│   └── index.ts
├── policy/
│   ├── enhancedPolicyEngine.ts  # RBAC policy engine
│   └── index.ts
├── integration/
│   ├── adapter.ts            # Bridge to legacy IliaGPT components
│   └── index.ts
└── index.ts                  # Main exports
```

## Usage

### Basic Usage with IliagptSystem

```typescript
import { IliagptSystem } from './server/agent/iliagpt-v3';
import { z } from 'zod';

const system = new IliagptSystem();

// Register a tool
system.tools.register({
  id: 1,
  name: 'greet',
  category: 'General',
  priority: 'Media',
  description: 'Greets a user',
  schema: z.object({ name: z.string() }),
  handler: async (params, ctx) => {
    ctx.metrics.inc('greet.calls');
    return `Hello, ${params.name}!`;
  },
});

// Execute tool
const result = await system.executeTool(
  { tool: 'greet', params: { name: 'World' } },
  { id: 'user1', roles: ['pro'], capabilities: [], plan: 'pro' }
);
```

### Integration with Legacy IliaGPT

```typescript
import { getIliagptBridge } from './server/agent/iliagpt-v3/integration';

const bridge = getIliagptBridge();

// Register legacy tools
bridge.registerLegacyTool({
  id: 'web_search',
  name: 'web_search',
  description: 'Search the web',
  category: 'Research',
  capabilities: ['requires_network'],
  inputSchema: { query: { type: 'string', required: true } },
  execute: async (params) => {
    // Legacy implementation
    return { results: [] };
  },
});

// Execute with legacy policy checks
const result = await bridge.executeTool(
  'web_search',
  { query: 'test' },
  { id: 'user1', plan: 'pro' }
);

// Get circuit breaker state
const circuitState = bridge.getCircuitState('web_search');

// Get metrics
const metrics = bridge.getMetrics();
```

### DAG Workflow Execution

```typescript
const workflowResult = await system.runWorkflow([
  { id: 'step1', tool: 'fetch_data', params: { url: '...' } },
  { id: 'step2', tool: 'process', params: {}, dependsOn: ['step1'] },
  { id: 'step3', tool: 'analyze', params: {}, dependsOn: ['step1'] },
  { id: 'step4', tool: 'report', params: {}, dependsOn: ['step2', 'step3'] },
], user);
```

### Feature Flag Integration

```typescript
import { initializeIliagptBridge, executeToolEnterprise } from './server/agent/iliagpt-v3/integration';

// Set ILIAGPT_V3_ENABLED=true in environment to enable
initializeIliagptBridge();

// Execute tool with enterprise features (timeout, retries, circuit breaker)
const result = await executeToolEnterprise(
  'web_search',
  { query: 'test' },
  { id: 'user1', plan: 'pro' }
);

if (result.success) {
  console.log(result.result);
} else {
  console.error(result.error);
}
```

## Enabling Enterprise Mode

1. Set environment variable: `ILIAGPT_V3_ENABLED=true`
2. Call `initializeIliagptBridge()` at application startup
3. Use `executeToolEnterprise()` for tool execution with all resilience features

The feature flag allows gradual rollout without affecting existing functionality.
