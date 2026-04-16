# Router System - Chat vs Agent Mode

Sistema de enrutamiento híbrido que decide automáticamente si una solicitud debe manejarse con chat simple o con el modo agente (con herramientas).

## Arquitectura

```
Usuario → Router → ┌─ Chat Simple (respuesta rápida)
                   └─ Agent Mode (herramientas + pasos)
```

## Decisión Híbrida

El router utiliza un enfoque en cascada:

1. **Heurísticas rápidas** - Patrones regex para detectar necesidades obvias
2. **Análisis de complejidad** - Evaluación multidimensional del prompt
3. **LLM Router** - Fallback a modelo de IA para casos ambiguos

## Configuración

### Variables de Entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `ROUTER_CONFIDENCE_THRESHOLD` | `0.65` | Umbral mínimo de confianza para activar agente |
| `MAX_AGENT_STEPS` | `8` | Máximo de pasos que puede ejecutar el agente |
| `ENABLE_DYNAMIC_ESCALATION` | `true` | Permite escalar de chat a agente dinámicamente |

### Ejemplo de Configuración

```bash
export ROUTER_CONFIDENCE_THRESHOLD=0.7
export MAX_AGENT_STEPS=10
export ENABLE_DYNAMIC_ESCALATION=true
```

## API Endpoints

### POST /api/chat/route

Decide la ruta para un mensaje.

**Request Schema:**
```typescript
{
  message: string;          // Required: User message to route
  hasAttachments?: boolean; // Optional: Whether attachments are included (default: false)
}
```

**Request Example:**
```json
{
  "message": "Busca el precio del bitcoin hoy",
  "hasAttachments": false
}
```

**Response Schema:**
```typescript
{
  route: "chat" | "agent";  // Routing decision
  confidence: number;       // 0.0 to 1.0
  reasons: string[];        // Explanation for the decision
  tool_needs: string[];     // Tools that would be needed
  plan_hint: string[];      // Suggested plan steps
}
```

**Response Example:**
```json
{
  "route": "agent",
  "confidence": 0.9,
  "reasons": ["Requiere búsqueda web"],
  "tool_needs": ["web_search"],
  "plan_hint": ["Buscar información en la web", "Generar respuesta final"]
}
```

**Fail-safe Behavior:** If an error occurs, returns fallback to chat mode:
```json
{
  "route": "chat",
  "confidence": 0.5,
  "reasons": ["Router fallback due to error: ..."],
  "tool_needs": [],
  "plan_hint": []
}
```

### POST /api/chat/agent-run

Ejecuta el agente con un objetivo.

**Request Schema:**
```typescript
{
  message: string;          // Required: Objective for the agent
  planHint?: string[];      // Optional: Suggested plan steps
}
```

**Request Example:**
```json
{
  "message": "Investiga el precio actual del bitcoin",
  "planHint": ["Buscar precio", "Extraer datos", "Responder"]
}
```

**Response Schema:**
```typescript
{
  success: boolean;
  run_id: string;           // Unique identifier for the run
  result: string | object;  // Final answer or error object
  state: {
    objective: string;
    plan: string[];
    toolsUsed: string[];
    stepsCompleted: number;
    status: "completed" | "failed" | "cancelled";
  }
}
```

**Response Example:**
```json
{
  "success": true,
  "run_id": "a1b2c3d4e5f6",
  "result": "El precio actual del bitcoin es...",
  "state": {
    "objective": "Investiga el precio actual del bitcoin",
    "plan": ["Buscar información en la web", "Analizar resultados", "Generar respuesta"],
    "toolsUsed": ["web_search", "final_answer"],
    "stepsCompleted": 3,
    "status": "completed"
  }
}
```

**Error Response (500):**
```json
{
  "error": "Tool web_search failed 2 consecutive times. Aborting run.",
  "code": "AGENT_RUN_ERROR",
  "suggestion": "Check server logs for details."
}
```

### POST /api/chat/escalation-check

Verifica si una respuesta de chat necesita escalarse a agente.

**Request Schema:**
```typescript
{
  response: string;  // Required: Draft chat response to evaluate
}
```

**Request Example:**
```json
{
  "response": "Necesito buscar información actualizada para responder."
}
```

**Response Schema:**
```typescript
{
  shouldEscalate: boolean;
  reason?: string;  // Optional: Explanation if escalation is needed
}
```

**Response Example:**
```json
{
  "shouldEscalate": true,
  "reason": "Necesita búsqueda web"
}
```

## Guardrails y Límites

### Max Steps Reached

Si el agente alcanza `MAX_AGENT_STEPS` sin completar:
- Se genera un resumen parcial con la información recopilada
- Se añade un warning técnico al inicio de la respuesta:
  ```
  [WARNING: Max steps (8) reached. Response may be incomplete.]
  ```

### Consecutive Tool Failures

Si una herramienta falla `maxConsecutiveFailures` (default: 2) veces consecutivas:
- El run se aborta con error estructurado
- Se incluyen observaciones parciales para debugging

### Fail-safe Sin API Key

Si `GEMINI_API_KEY` no está configurado:
- Router: Usa heurísticas deterministas
- AgentRunner: Usa `heuristicNextAction()` y `heuristicPlan()`
- Nunca devuelve 500 sin mensaje técnico claro

## Run Persistence (In-Memory)

Los runs se almacenan en memoria con interfaz preparada para DB:

```typescript
interface AgentRunRecord {
  run_id: string;
  objective: string;
  route: "agent";
  confidence: number;
  plan: string[];
  tools_used: string[];
  steps: number;
  duration_ms: number;
  status: "completed" | "failed" | "cancelled";
  result: any;
  error?: string;
  created_at: Date;
  completed_at: Date;
}

interface IRunStore {
  save(record: AgentRunRecord): Promise<void>;
  get(runId: string): Promise<AgentRunRecord | null>;
  list(limit?: number): Promise<AgentRunRecord[]>;
}
```

## Structured Logging

Cada run emite logs estructurados:

```json
{
  "timestamp": "2026-01-04T16:45:00.000Z",
  "level": "info",
  "component": "AgentRunner",
  "event": "run_completed",
  "run_id": "a1b2c3d4e5f6",
  "route": "agent",
  "tools_used": ["web_search", "final_answer"],
  "steps": 3,
  "duration_ms": 4500,
  "status": "completed"
}
```

Niveles de log:
- `debug`: Detalles de tools (solo si `enableLogging: true`)
- `info`: Decisiones de routing, inicio/fin de runs
- `warn`: Max steps reached
- `error`: Abortos, fallos de tools consecutivos

## Herramientas del Agente

| Herramienta | Descripción |
|-------------|-------------|
| `web_search(query)` | Busca información en la web |
| `open_url(url)` | Navega a una URL y extrae contenido |
| `extract_text(content)` | Procesa y limpia texto |
| `final_answer(answer)` | Devuelve la respuesta final |

## Patrones de Detección

### Rutas a Agent (alta confianza)

- `Busca en la web...` → `web_search`
- `Navega a https://...` → `open_url`
- `Genera un documento Excel...` → `generate_file`
- `Ejecuta este código...` → `execute_code`
- `Usa el agente...` → explicit_agent (100%)

### Rutas a Chat (alta confianza)

- `¿Qué es X?` → Definiciones simples
- `Explica...` → Explicaciones conceptuales
- `Resume...` → Resúmenes de texto
- Saludos y despedidas

## Escalamiento Dinámico

Si `ENABLE_DYNAMIC_ESCALATION=true`, el sistema detecta cuando una respuesta de chat indica necesidad de herramientas:

- "Necesito buscar..." → Escalar a agente
- "No tengo acceso a..." → Escalar a agente
- "Información actualizada..." → Escalar a agente

## Ejecutar Tests

```bash
npm test -- server/__tests__/router.test.ts
```

## Logs

El router genera logs estructurados:

```
[Router] Initialized with threshold=0.65, dynamicEscalation=true
[Router] Heuristic match: web_search → agent (confidence=0.9) (15ms)
[AgentRunner] Starting agent run for objective: "..."
[AgentRunner] Step 0: web_search({"query":"..."})
[AgentRunner] Step 0 completed: success=true, duration=1234ms
```

## Flujo de Integración

```typescript
import { decideRoute, checkDynamicEscalation } from "./services/router";
import { runAgent } from "./services/agentRunner";

async function handleMessage(userText: string) {
  const decision = await decideRoute(userText);
  
  if (decision.route === "agent" && decision.confidence >= 0.65) {
    const result = await runAgent(userText, decision.plan_hint);
    return result.result;
  }
  
  const chatResponse = await chatSimple(userText);
  
  const escalation = checkDynamicEscalation(chatResponse);
  if (escalation.shouldEscalate) {
    const result = await runAgent(userText);
    return result.result;
  }
  
  return chatResponse;
}
```
