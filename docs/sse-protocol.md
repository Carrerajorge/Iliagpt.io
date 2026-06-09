# Protocolo SSE de chat — versión 2026-06-09

Contrato del stream `POST /api/chat/stream` (y consumidores: web, desktop,
extensión, bridge `/v1`). Tipos canónicos en `shared/sseProtocol.ts`.

## Formato

Eventos SSE con nombre + JSON:

```
event: <nombre>
data: {"...": "..."}
```

Todo payload lleva el sobre de correlación inyectado por el servidor:
`conversationId`, `requestId` y (cuando existe) `assistantMessageId`.
**Los clientes deben filtrar por `conversationId` + `requestId`** — eventos
sin correlación o con otra conversación se descartan.

## Eventos

| Evento | Payload clave | Descripción |
|---|---|---|
| `start` | `latencyMode` | El stream comenzó. Siempre primero. |
| `context` | `intent`, `latencyLane`, `isAgenticMode` | Metadatos de enrutado del turno. |
| `thinking` | `step`, `message` | Estado de progreso legible (pre-modelo). |
| `reasoning_delta` | `type:"reasoning_delta"`, `content` | Delta de *extended thinking* del modelo. Llega ANTES del texto visible. |
| `tool_call_delta` | `type:"tool_call_delta"`, `index`, `id?`, `name?`, `argsDelta?` | Llamada a herramienta en streaming (argumentos parciales en orden). |
| `reasoning_done` | `type:"reasoning_done"`, `durationMs` | Fin de la fase de pensamiento. Llega antes del primer `chunk` posterior (o antes de `done` si no hay texto). |
| `chunk` | `type:"text_delta"`, `content`, `sequence` | Texto visible de la respuesta. `sequence` es monótono creciente. |
| `notice` | `type` (`provider_fallback`, `context_truncated`, …) | Avisos no fatales. |
| `done` | `reasoning?`, `reasoningDurationMs?`, `webSources?`, `completionReason` | Fin del turno. Siempre último (también tras `error`). |
| `error` | `message` \| `{code, retryAfterMs}` | Error terminal del turno; va seguido de `done`. |

## Garantías de orden

1. `start` primero; `done` último.
2. Los `reasoning_delta` preceden al texto que anuncian; `reasoning_done`
   llega antes del primer `chunk` posterior a la fase de pensamiento.
3. Los `tool_call_delta` de una misma llamada llegan en orden de `argsDelta`
   (concatenar para reconstruir los argumentos JSON).
4. `chunk.sequence` es monótono dentro de un request (dedup en reconexión).

## Extended thinking — parámetros de entrada

En el body del stream:

- `reasoningEffort`: `"low" | "medium" | "high" | "none"` — esfuerzo por
  petición (solo aplica a modelos con capacidad de razonamiento).
- `thinking: false` — toggle estilo claude.ai; equivale a `"none"`.

Config de despliegue: `OPENROUTER_REASONING_EFFORT` (default `medium`),
`OPENROUTER_REASONING_MODELS` (substrings extra), `OPENROUTER_REASONING_DISABLED=1`,
`MODEL_CAPABILITIES_OVERRIDES` (JSON por modelo), `ANTHROPIC_PROMPT_CACHE_DISABLED=1`.

## Persistencia

El razonamiento se persiste en `chat_messages.reasoning` (texto) y
`chat_messages.reasoning_details` (jsonb crudo de OpenRouter; se reenvía
intacto en turnos posteriores SOLO a modelos `anthropic/*` para no romper la
cadena de thinking firmado con tool calls). Duración en
`metadata.reasoningDurationMs`.

## Bridge `/v1/chat/completions`

Los clientes OpenAI-SDK reciben el thinking como `delta.reasoning_content`
(convención DeepSeek), independientemente del modelo conectado.

## Versionado

Cambios incompatibles ⇒ bump de `SSE_PROTOCOL_VERSION` en
`shared/sseProtocol.ts` + entrada aquí.
