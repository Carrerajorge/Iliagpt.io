# Resilience & Scalability Roadmap

**Objetivo**: Evolucionar IliaGPT desde proceso único → arquitectura distributed-first sin downtime, en fases ejecutables con entregables y criterios de done verificables.

---

## Estado actual (baseline)

**Qué ya existe y funciona:**
- Per-conversation lock con queue (100 waiters, 45s timeout) — `chatAiRouter.ts:713-898`
- Heartbeat SSE (line 7047)
- Circuit breakers por proveedor — `circuitBreaker.ts`
- Fallback chains entre modelos — `smartRouter.ts:884-914`
- Concurrency gate por proveedor (semáforo) — `concurrencyGate.ts`
- Idempotency store con persistencia en DB — `idempotencyStore.ts`
- Stream checkpoint cada 10 chunks (memoria)
- `guaranteeResponse` con 3 reintentos + fallback de proveedor
- Structured logger por componente
- Graceful shutdown handler

**Gaps críticos identificados:**
1. Stream LLM no se cancela al desconectar el cliente → orphaned streams consumen cuota
2. Lock liberado en `res.close` antes de completar persistencia → race con siguiente request
3. AbortSignal no propagado al `streamFactory` de los proveedores
4. Dual-write (storage + conversationStateService) sin atomicidad
5. Checkpoint en memoria → se pierde en restart del proceso
6. **Frontend**: `aiState` stranded tras transición pending → real chatId → bloquea 3er mensaje (FIX APLICADO hoy)

---

## Fase 0 — Estabilización inmediata ✅ COMPLETADO

**Objetivo**: Eliminar el bug del 3er mensaje sin regresiones.

### Entregables

| # | Cambio | Archivo | Estado |
|---|--------|---------|--------|
| 0.1 | Force reset `aiState` post-stream en los 3 paths principales | `chat-interface.tsx:4904, 5473, 7244` | ✅ |
| 0.2 | Failsafe en `handleSubmit`: detectar `aiState` stranded sin stream activo y autocurarse | `chat-interface.tsx:4176` | ✅ |
| 0.3 | Commit + push a main | `b8e3a84d` | ✅ |
| 0.4 | Validación E2E con Playwright (5 mensajes + chat nuevo + switch) | 8/8 mensajes recibieron respuesta | ✅ |

### Criterios de done verificables
- [x] Usuario envía 5+ mensajes consecutivos sin que se cuelgue el submit (probado con Playwright)
- [x] Watchdog de 120s no se activa en flujo normal (0 ocurrencias en logs)
- [x] `[handleSubmit] Detected stranded aiState` NO aparece en flujo normal (failsafe nunca activado)
- [x] `[handleSubmit] Blocked` NO aparece (0 ocurrencias en 185 mensajes de consola)
- [x] Switch entre chats + mensaje post-switch funciona

### Veredicto
**PASS estructural**: el fix resolvió el bug a nivel raíz. El failsafe defensivo quedó como red de seguridad pero nunca tuvo que activarse, confirmando que la corrección principal (reset explícito en los 3 paths + doble reset en `latestChatIdRef`) es suficiente.

---

## Fase 1 — Hardening del pipeline actual

**Objetivo**: Cerrar los 5 gaps de resiliencia en el proceso único sin cambiar infraestructura.

**Estado**: 1.1 + 1.2 ✅ COMPLETADO. 1.3, 1.4, 1.5 pendientes.

### 1.1 Cancelación de streams huérfanos via AbortSignal ✅

**Problema**: Cuando `res.on("close")` fira, el `for await (const chunk of streamFactory)` en `llmGateway.streamChat()` sigue corriendo, consumiendo cuota.

**Solución**:
```typescript
// chatAiRouter.ts — crear AbortController al inicio del stream
const streamAbortController = new AbortController();
res.on("close", () => streamAbortController.abort("client_disconnected"));
req.on("aborted", () => streamAbortController.abort("request_aborted"));

// Pasar signal al streamChat
const streamGenerator = llmGateway.streamChat(messages, {
  ...streamLlmOptions,
  abortSignal: streamAbortController.signal,
});
```

```typescript
// llmGateway.ts — propagar a los providers HTTP
async *streamChat(messages, options) {
  const { abortSignal } = options;
  for (const provider of providerChain) {
    try {
      for await (const chunk of provider.stream(messages, { signal: abortSignal })) {
        if (abortSignal?.aborted) return;
        yield chunk;
      }
    } catch (err) {
      if (abortSignal?.aborted) return;
      // ... existing fallback
    }
  }
}
```

**Criterio de done**: En un test, cortar el socket a mitad de stream y verificar que la request HTTP a OpenRouter/xAI se cancela (inspeccionar `fetch` con DevTools Network).

**Entregables**:
- [x] `LLMRequestOptions.abortSignal?: AbortSignal` añadido a `llmGateway.ts:58`
- [x] Check de `options.abortSignal?.aborted` en cada chunk boundary del loop (`llmGateway.ts:2224`)
- [x] Check pre-provider (bail out antes de abrir nuevo proveedor si ya fue abortado)
- [x] `catch` branch detecta abort y retorna sin incrementar circuit breaker failures
- [x] `streamAbortController = new AbortController()` en `chatAiRouter.ts:5410`
- [x] `abortUpstream()` llamado desde `req.on("aborted")` y `res.on("close")`
- [x] `abortSignal: streamAbortController.signal` pasado en los 3 call sites de `resolveModelStream()` y `llmGateway.streamChat()`
- [x] Persiste checkpoint al abortar para permitir resume posterior
- [x] Tests unitarios en `chatStreamConcurrency.test.ts` (3 tests de AbortSignal: terminates on boundary, no over-consumption, pre-aborted bail-out) ✅

**Riesgo**: **Medio**. Cambios en el contrato interno de `streamChat`. Mitigación aplicada: los tests validan que (a) abort termina en <1 chunk boundary, (b) circuit breaker NO registra failure por cancelación, (c) checkpoint se preserva para resume.

---

### 1.2 Lock lifecycle extendido (release tras persistencia) ✅

**Problema**: `releaseConversationLock()` se llama en `res.close`, pero la persistencia del mensaje asistente aún está en vuelo. Un request nuevo puede leer estado inconsistente.

**Solución**:
```typescript
// chatAiRouter.ts
let persistencePromise: Promise<void> | null = null;

const releaseConversationLock = async () => {
  if (conversationLockReleased) return;
  // Esperar a que persistencia termine ANTES de soltar el lock
  if (persistencePromise) {
    try {
      await Promise.race([
        persistencePromise,
        new Promise((_, rej) => setTimeout(() => rej(new Error("persist_timeout")), 5000))
      ]);
    } catch (err) {
      console.warn("[lock] persistence did not complete in time:", err);
    }
  }
  conversationLockReleased = true;
  // ... existing release logic
};
```

**Criterio de done**: Concurrent test que envía 2 mensajes al mismo chat con 100ms de diferencia. Mensaje 2 ve el estado completo de mensaje 1 en su hidratación.

**Entregables**:
- [x] `pendingPersistencePromise: Promise<void> | null` añadido al scope del request handler (`chatAiRouter.ts:5418`)
- [x] `persistAssistant()` wrapper que encapsula `updateChatMessageContent` + `conversationStateService.appendMessage` en una promise tracked
- [x] `pendingPersistencePromise = persistAssistant(); await pendingPersistencePromise` en `chatAiRouter.ts:8363-8364`
- [x] `releaseConversationLock()` es ahora `async` y `await`-ea `pendingPersistencePromise` (con timeout de 5s como safety net) antes de limpiar el lock
- [x] `releaseConversationLockFireAndForget()` para los callbacks de eventos de req/res que no pueden awaitear promises
- [x] 3 tests en `chatStreamConcurrency.test.ts` (drain-before-release, timeout safety, serialized concurrent requests) ✅

**Invariantes verificadas**:
1. La persistencia SIEMPRE completa antes que el lock se libere (excepto en timeout de 5s)
2. El lock SIEMPRE se libera eventualmente (safety net evita deadlock)
3. Dos requests al mismo chat se serializan — el segundo ve el estado completo del primero

---

### 1.3 Dual-write transaccional

**Problema**: `storage.createChatMessage` y `conversationStateService.appendMessage` pueden quedar desincronizados.

**Solución**: Usar outbox pattern — escribir SOLO a `storage` en una transacción, y `conversationStateService` se actualiza desde un trigger/listener o se hidrata perezosamente desde `storage`.

```typescript
// Nuevo patrón: transacción única + projection
await db.transaction(async (tx) => {
  const msg = await tx.insert(chatMessages).values({...});
  await tx.insert(chatMessageOutbox).values({ messageId: msg.id, eventType: "message.created" });
});
// Worker separado consume el outbox y actualiza conversationStateService
```

**Alternativa más simple (Fase 1)**: Hacer `conversationStateService` un read-through cache que siempre hidrata desde `storage` si hay miss, eliminando el dual-write.

**Criterio de done**: Test que inyecta fallo en `conversationStateService.appendMessage` y verifica que el mensaje sigue disponible en el próximo `loadConversation()`.

---

### 1.4 Validación robusta de respuestas vacías/incompletas

**Problema**: Si el proveedor devuelve empty content o 429, el `guaranteeResponse` fallback no siempre se ejecuta correctamente en el streaming path.

**Solución**:
```typescript
// chatAiRouter.ts — después del stream principal
if (!fullContent.trim()) {
  // Ya existe (line 8194). Mejoras:
  // 1. Detectar específicamente 429 del proveedor y backoff exponencial
  // 2. Rotar a un proveedor DIFERENTE al que acaba de fallar
  // 3. Emitir SSE "notice" con tipo "retry_in_progress" para UX
  // 4. Log estructurado con trace_id/request_id/provider/error_code
}
```

**Criterio de done**: Mock del proveedor devolviendo 429 → sistema retrocede, espera, rota a segundo proveedor, entrega respuesta.

---

### 1.5 Checkpoint durable (Redis opcional)

**Problema**: `streamCheckpoints` en memoria se pierde si el proceso cae.

**Solución Fase 1**: Persistir checkpoint en tabla `chat_stream_checkpoints` cada 50 chunks. Al reconectar, el cliente envía `Last-Event-ID` y el servidor reanuda desde el checkpoint.

**Criterio de done**: Matar el proceso a mitad de stream, reiniciar, cliente se reconecta con `Last-Event-ID`, recibe el resto.

---

### Pruebas de concurrencia (Fase 1)

**Suite nueva**: `server/__tests__/chat/concurrency.test.ts`

```typescript
describe("Chat pipeline concurrency", () => {
  it("procesa 10 mensajes concurrentes en 10 conversaciones distintas sin race", async () => {
    const requests = Array.from({ length: 10 }, (_, i) =>
      fetch("/chat/stream", { body: JSON.stringify({ chatId: `chat-${i}`, messages: [...] }) })
    );
    const responses = await Promise.all(requests);
    expect(responses.every(r => r.ok)).toBe(true);
  });

  it("serializa 5 mensajes rápidos en la misma conversación manteniendo orden", async () => {
    const chatId = "same-chat";
    for (let i = 0; i < 5; i++) {
      await fetch("/chat/stream", { body: JSON.stringify({ chatId, messages: [{ role: "user", content: `msg ${i}` }] }) });
    }
    const history = await fetch(`/chats/${chatId}/messages`);
    expect(history.messages).toHaveLength(10); // 5 user + 5 assistant
    expect(history.messages[8].content).toContain("msg 4"); // orden correcto
  });

  it("recupera gracefully si el cliente se desconecta a mitad de stream", async () => {
    const controller = new AbortController();
    const reqPromise = fetch("/chat/stream", { signal: controller.signal, body: ... });
    setTimeout(() => controller.abort(), 200); // cortar a 200ms
    await reqPromise.catch(() => {});
    // Esperar 2s y verificar que el lock se liberó
    await new Promise(r => setTimeout(r, 2000));
    const next = await fetch("/chat/stream", { body: ... });
    expect(next.ok).toBe(true);
  });
});
```

### Observabilidad (Fase 1)

**Structured logs**: Cada request genera un `trace_id` que se propaga por todos los logs. Campos obligatorios:
- `trace_id`, `request_id`, `run_id`, `message_id`
- `user_id`, `conversation_id`
- `stage` (ingress | lock_acquired | llm_start | llm_done | persist_start | persist_done | release)
- `latency_ms`, `provider`, `model`

**Métricas (Prometheus-style endpoint `/metrics`)**:
- `chat_stream_requests_total{status, provider}`
- `chat_stream_latency_seconds{stage}` (histogram)
- `conversation_lock_wait_seconds` (histogram)
- `provider_circuit_breaker_state{provider}` (gauge)
- `llm_provider_failures_total{provider, error_type}`

---

## Fase 2 — Base apta para escala horizontal (2-4 semanas)

**Objetivo**: Migrar de Replit/Railway (proceso único) a VM + Redis + PM2 cluster mode, habilitando escala horizontal real.

### 2.1 Migración de infraestructura

**De**: Replit/Railway (1 proceso Node.js, PostgreSQL managed)
**A**: VM (Hetzner CX31 / DigitalOcean Droplet) con:
- **PM2 cluster mode**: N workers = N vCPUs (compartiendo puerto vía load balancing interno)
- **Redis**: instalado en la misma VM o managed (Upstash/Railway Redis)
- **PostgreSQL**: managed (Neon/Supabase) o self-hosted
- **Nginx**: reverse proxy + TLS

### 2.2 State extraction (single-process → multi-process)

Todas las estructuras en memoria tienen que moverse a Redis:

| Estructura actual (memoria) | Destino |
|---|---|
| `CONVERSATION_STREAM_LOCKS` (Map) | Redis hash con TTL + Lua script atómico para acquire/release |
| `streamCheckpoints` (Map) | Redis hash (TTL 1h) |
| `providerGates` semáforos | Redis `SETNX` con TTL, o mover a rate limiter distribuido (Upstash RateLimit) |
| Circuit breaker state | Redis hash, con TTL del reset timeout |
| `idempotencyStore` (ya persistente en DB) | ✅ Ya listo |

**Entregable**: Nuevo módulo `server/lib/distributedState.ts` con interfaces abstractas y 2 implementaciones: `InMemoryStateStore` (dev) y `RedisStateStore` (prod).

### 2.3 Message broker (para desacoplar ingreso y procesamiento)

**Opción A — Simple**: BullMQ sobre Redis (ya tienes `workerQueue.ts` y `bullBoard.ts`).
- API HTTP solo valida + encola job en `chat-stream` queue
- Workers BullMQ procesan jobs y hacen streaming al cliente via WebSocket o SSE con `Last-Event-ID`

**Opción B — Escala mayor**: NATS JetStream (mejor throughput, ordering por subject).

**Criterio de done**: 
- Request HTTP retorna en <50ms (solo enqueue)
- Cliente abre SSE/WS en endpoint separado `/stream/:job_id` que consume eventos del worker
- Matar un worker NO pierde el job (reclamado por otro worker tras heartbeat timeout)

### 2.4 Ordering por conversación

**Problema**: BullMQ procesa jobs en paralelo. Necesitamos serializar por `conversationId`.

**Solución**: Usar BullMQ `jobId` único por conversación + `concurrency: 1` por `conversationId` via:
```typescript
new Worker('chat-stream', processor, {
  concurrency: 50, // global
  limiter: {
    groupKey: (job) => job.data.conversationId,
    max: 1, // por conversationId
    duration: 60000,
  }
});
```

### 2.5 Health checks y autoscaling

- `/health/ready`: DB ping + Redis ping + al menos 1 proveedor LLM disponible
- `/health/live`: Proceso respondiendo
- PM2 se encarga del restart automático en crash
- En VM con autoscaling (DigitalOcean App Platform o Hetzner Cloud): escalar basado en `p95 latency` o `queue depth`

### Riesgos Fase 2
- **Alto**: Migración de estado de memoria a Redis puede introducir race conditions sutiles si los Lua scripts no son correctos
- **Mitigación**: Feature flag `USE_DISTRIBUTED_STATE=true` para rollout gradual, empezando en dev → staging → 10% prod → 100%

---

## Fase 3 — Arquitectura distribuida (1-3 meses, cuando el tráfico lo justifique)

**Objetivo**: Eliminar todos los SPOF, soportar picos 100x, multi-región.

### 3.1 Separación de concerns en servicios
- **API Gateway**: autenticación, rate limiting, routing (Cloudflare Workers o Kong)
- **Chat Ingress Service**: valida requests, encola en broker
- **LLM Orchestrator Workers**: consume jobs, llama proveedores, streaming
- **State Service**: Redis cluster para locks, Postgres para mensajes, S3 para artifacts
- **Observability Stack**: OpenTelemetry → Grafana Cloud / Honeycomb

### 3.2 Streaming robusto con replay
- Cada chunk emitido se persiste en un log durable (Redis Streams / Kafka)
- Cliente se reconecta con `Last-Event-ID` → replay desde el chunk exacto
- Heartbeat cada 10s + timeout de reconexión de 30s

### 3.3 Multi-región activa-activa
- PostgreSQL con read replicas + write primary
- Redis con replicación
- Request routing por latencia (Cloudflare)
- Conflict resolution vía `request_id` determinístico (idempotency global)

### 3.4 Chaos testing + disaster recovery
- Tests semanales: matar 1 worker aleatorio, cortar Redis, simular latencia de proveedor LLM
- RPO (Recovery Point Objective): <1 minuto
- RTO (Recovery Time Objective): <5 minutos
- Backup automático de DB cada hora, retenido 30 días

---

## Tracking por fases

| Fase | Duración estimada | Dependencias | Impacto usuario |
|---|---|---|---|
| 0 — Estabilización | 1 día (HOY) | Ninguna | Elimina bug 3er mensaje |
| 1 — Hardening proceso único | 1-2 semanas | Fase 0 | Elimina streams huérfanos, locks race |
| 2 — VM + Redis + PM2 cluster | 2-4 semanas | Fase 1 + migración infra | Escala a ~100 usuarios concurrentes |
| 3 — Arquitectura distribuida | 1-3 meses | Fase 2 + tráfico que lo justifique | Escala a 10K+ concurrentes, multi-región |

---

## Notas de ejecución

- **Nunca** hacer un cambio de infraestructura sin feature flag de rollback
- **Siempre** tener tests de concurrencia antes de mergear cambios en el lock manager o el stream pipeline
- **Medir antes de optimizar**: Sin métricas reales de p95 latency y queue depth, cualquier optimización es especulativa
- **El código ya existente de resiliencia (70%)** debe reutilizarse, no reemplazarse — evitar el síndrome de NIH (Not Invented Here)
