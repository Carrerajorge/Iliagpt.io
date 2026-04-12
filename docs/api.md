# IliaGPT API Reference

Complete API reference for IliaGPT — a full-stack AI chat platform with multi-agent orchestration, browser automation, document generation, and multi-channel integrations.

**Base URL:** `https://your-domain.com`

All endpoints return `application/json` unless otherwise noted. All request bodies must use `Content-Type: application/json` unless using multipart file uploads.

---

## Table of Contents

1. [Authentication](#authentication)
2. [OpenAI-Compatible API (/v1/*)](#openai-compatible-api)
3. [Chat API (/api/chats/*)](#chat-api)
4. [Agent API (/api/agents/*)](#agent-api)
5. [Documents API (/api/documents/*)](#documents-api)
6. [Search API](#search-api)
7. [Memory API](#memory-api)
8. [Tools API](#tools-api)
9. [Tasks API](#tasks-api)
10. [Admin API](#admin-api)
11. [Health and Metrics](#health-and-metrics)
12. [SSE Events Reference](#sse-events-reference)
13. [Error Codes](#error-codes)
14. [Rate Limiting](#rate-limiting)
15. [Webhooks](#webhooks)

---

## Authentication

IliaGPT supports three authentication methods depending on the client type and endpoint group.

### Session Authentication (Web App)

The primary authentication method for browser-based clients. After a successful OAuth login via Google or Microsoft, the server sets a secure, HTTP-only session cookie (`connect.sid`). All subsequent requests from the browser automatically include this cookie.

**Login flow:**

```
GET /auth/google
  Redirects to Google OAuth consent screen

GET /auth/google/callback?code=...
  Exchanges code for tokens, creates session, redirects to /

GET /auth/microsoft
  Redirects to Microsoft OAuth consent screen

GET /auth/microsoft/callback?code=...
  Exchanges code for tokens, creates session, redirects to /

POST /auth/logout
  Destroys session, clears cookie
```

Session cookies are `HttpOnly`, `Secure` (in production), and `SameSite=Lax`. Sessions expire after 7 days of inactivity. CSRF tokens are required on all mutating requests from browser clients. Include the `X-CSRF-Token` header with the value obtained from `GET /api/csrf-token`.

```http
GET /api/csrf-token HTTP/1.1
Host: your-domain.com
Cookie: connect.sid=s%3A...

HTTP/1.1 200 OK
Content-Type: application/json

{
  "csrfToken": "abc123xyz..."
}
```

### API Key Authentication (/v1/* Endpoints)

Machine-to-machine clients authenticate with API keys. Keys use the format `ilgpt_` followed by a 48-character alphanumeric string.

**Header format:**

```http
Authorization: Bearer ilgpt_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2
```

API keys are scoped to a user account. Create and manage them from the dashboard under Settings > API Keys. Each key can be given a label and an optional expiry date. Keys can be revoked at any time.

**Example request:**

```http
POST /v1/chat/completions HTTP/1.1
Host: your-domain.com
Authorization: Bearer ilgpt_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2
Content-Type: application/json

{
  "model": "gpt-4o",
  "messages": [
    { "role": "user", "content": "Hello!" }
  ]
}
```

### Anonymous User Fallback

For unauthenticated visitors with limited access, the server accepts anonymous identity headers. These are used by the frontend before a user signs in.

| Header | Description |
|--------|-------------|
| `X-Anonymous-User-Id` | UUID identifying the anonymous session |
| `X-Anonymous-Token` | HMAC-SHA256 signature of the user ID using `SESSION_SECRET` |

```http
GET /api/chats HTTP/1.1
Host: your-domain.com
X-Anonymous-User-Id: 550e8400-e29b-41d4-a716-446655440000
X-Anonymous-Token: 3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d
```

Anonymous users have restricted access: read-only on public resources, no file upload, no agent execution. Rate limits are stricter (10 requests per minute).

---

## OpenAI-Compatible API

The `/v1/*` endpoint group is a drop-in replacement for the OpenAI SDK. Any application using the OpenAI SDK can point `baseURL` to `https://your-domain.com/v1` and use an `ilgpt_` API key.

All `/v1/*` endpoints require `Authorization: Bearer ilgpt_...` authentication.

**SDK configuration example:**

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://your-domain.com/v1',
  apiKey: 'ilgpt_a1b2c3d4e5f6...',
});
```

---

### POST /v1/chat/completions

Create a chat completion. Supports both streaming and non-streaming modes across all configured model providers.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | Yes | Model identifier (see GET /v1/models for available list) |
| `messages` | array | Yes | Array of message objects |
| `messages[].role` | string | Yes | One of: `system`, `user`, `assistant`, `tool` |
| `messages[].content` | string or array | Yes | Message text or array of content parts |
| `stream` | boolean | No | If `true`, stream tokens via SSE. Default: `false` |
| `temperature` | number | No | Sampling temperature 0-2. Default: 1.0 |
| `top_p` | number | No | Nucleus sampling probability 0-1. Default: 1.0 |
| `max_tokens` | integer | No | Maximum tokens to generate |
| `stop` | string or array | No | Stop sequences |
| `presence_penalty` | number | No | -2.0 to 2.0. Default: 0 |
| `frequency_penalty` | number | No | -2.0 to 2.0. Default: 0 |
| `tools` | array | No | List of tool definitions for function calling |
| `tool_choice` | string or object | No | `auto`, `none`, or `{"type":"function","function":{"name":"..."}}` |
| `response_format` | object | No | `{"type": "json_object"}` to force JSON output |
| `seed` | integer | No | For deterministic sampling (best-effort) |
| `user` | string | No | End-user identifier for abuse tracking |
| `metadata` | object | No | IliaGPT extension: key-value pairs stored with the request |

**Non-streaming example:**

```http
POST /v1/chat/completions HTTP/1.1
Host: your-domain.com
Authorization: Bearer ilgpt_...
Content-Type: application/json

{
  "model": "claude-3-5-sonnet-20241022",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": "Explain quantum entanglement in two sentences."
    }
  ],
  "temperature": 0.7,
  "max_tokens": 256
}
```

**Non-streaming response:**

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1744156800,
  "model": "claude-3-5-sonnet-20241022",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Quantum entanglement is a phenomenon where two particles become correlated so that the quantum state of one instantly influences the other, regardless of distance. Einstein famously called this 'spooky action at a distance' because it appears to violate locality, though no information travels faster than light."
      },
      "finish_reason": "stop",
      "logprobs": null
    }
  ],
  "usage": {
    "prompt_tokens": 28,
    "completion_tokens": 57,
    "total_tokens": 85
  },
  "system_fingerprint": "fp_abc123"
}
```

**Streaming example:**

```http
POST /v1/chat/completions HTTP/1.1
Host: your-domain.com
Authorization: Bearer ilgpt_...
Content-Type: application/json

{
  "model": "gpt-4o",
  "messages": [
    { "role": "user", "content": "Count from 1 to 5." }
  ],
  "stream": true
}
```

**Streaming response (SSE):**

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1744156800,"model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1744156800,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"1"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1744156800,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":", 2"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1744156800,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":", 3, 4, 5"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1744156800,"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

**Tool calling example:**

```json
{
  "model": "gpt-4o",
  "messages": [
    { "role": "user", "content": "What is the weather in Tokyo?" }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather for a city",
        "parameters": {
          "type": "object",
          "properties": {
            "city": {
              "type": "string",
              "description": "City name"
            },
            "unit": {
              "type": "string",
              "enum": ["celsius", "fahrenheit"],
              "description": "Temperature unit"
            }
          },
          "required": ["city"]
        }
      }
    }
  ],
  "tool_choice": "auto"
}
```

**Tool calling response:**

```json
{
  "id": "chatcmpl-xyz789",
  "object": "chat.completion",
  "created": 1744156800,
  "model": "gpt-4o",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "call_abc123",
            "type": "function",
            "function": {
              "name": "get_weather",
              "arguments": "{\"city\": \"Tokyo\", \"unit\": \"celsius\"}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ],
  "usage": {
    "prompt_tokens": 72,
    "completion_tokens": 18,
    "total_tokens": 90
  }
}
```

**Vision (image input) example:**

```json
{
  "model": "gpt-4o",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "What is in this image?"
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "https://example.com/image.jpg",
            "detail": "high"
          }
        }
      ]
    }
  ]
}
```

---

### POST /v1/embeddings

Generate vector embeddings for text input. Returns 1536-dimensional vectors compatible with OpenAI's `text-embedding-ada-002` format.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `input` | string or array | Yes | Text or array of texts to embed (max 2048 strings per request) |
| `model` | string | Yes | Embedding model identifier |
| `encoding_format` | string | No | `float` (default) or `base64` |
| `dimensions` | integer | No | Reduce output dimensions (max: 1536) |
| `user` | string | No | End-user identifier |

**Supported embedding models:**

| Model ID | Dimensions | Max Input Tokens |
|----------|------------|-----------------|
| `text-embedding-3-small` | 1536 (reducible) | 8191 |
| `text-embedding-3-large` | 3072 (reducible) | 8191 |
| `text-embedding-ada-002` | 1536 | 8191 |

**Request example:**

```http
POST /v1/embeddings HTTP/1.1
Host: your-domain.com
Authorization: Bearer ilgpt_...
Content-Type: application/json

{
  "input": [
    "The quick brown fox jumps over the lazy dog",
    "Machine learning is a subset of artificial intelligence"
  ],
  "model": "text-embedding-3-small"
}
```

**Response:**

```json
{
  "object": "list",
  "data": [
    {
      "object": "embedding",
      "index": 0,
      "embedding": [0.0023064255, -0.009327292, 0.015797347, -0.007852874]
    },
    {
      "object": "embedding",
      "index": 1,
      "embedding": [-0.0032811, 0.0048221, 0.020318, -0.013458]
    }
  ],
  "model": "text-embedding-3-small",
  "usage": {
    "prompt_tokens": 20,
    "total_tokens": 20
  }
}
```

Note: Each embedding array contains 1536 float values. The response above is abbreviated for readability.

---

### GET /v1/models

List all available models across configured providers.

**Request:**

```http
GET /v1/models HTTP/1.1
Host: your-domain.com
Authorization: Bearer ilgpt_...
```

**Response:**

```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-4o",
      "object": "model",
      "created": 1715367049,
      "owned_by": "openai",
      "permission": [],
      "root": "gpt-4o",
      "parent": null
    },
    {
      "id": "gpt-4o-mini",
      "object": "model",
      "created": 1721172717,
      "owned_by": "openai",
      "permission": [],
      "root": "gpt-4o-mini",
      "parent": null
    },
    {
      "id": "claude-3-5-sonnet-20241022",
      "object": "model",
      "created": 1729555200,
      "owned_by": "anthropic",
      "permission": [],
      "root": "claude-3-5-sonnet-20241022",
      "parent": null
    },
    {
      "id": "claude-3-5-haiku-20241022",
      "object": "model",
      "created": 1729555200,
      "owned_by": "anthropic",
      "permission": [],
      "root": "claude-3-5-haiku-20241022",
      "parent": null
    },
    {
      "id": "gemini-2.0-flash",
      "object": "model",
      "created": 1735689600,
      "owned_by": "google",
      "permission": [],
      "root": "gemini-2.0-flash",
      "parent": null
    },
    {
      "id": "grok-2-1212",
      "object": "model",
      "created": 1733356800,
      "owned_by": "xai",
      "permission": [],
      "root": "grok-2-1212",
      "parent": null
    },
    {
      "id": "deepseek-chat",
      "object": "model",
      "created": 1704067200,
      "owned_by": "deepseek",
      "permission": [],
      "root": "deepseek-chat",
      "parent": null
    },
    {
      "id": "llama-3.3-70b-versatile",
      "object": "model",
      "created": 1704067200,
      "owned_by": "groq",
      "permission": [],
      "root": "llama-3.3-70b-versatile",
      "parent": null
    }
  ]
}
```

---

## Chat API

All chat endpoints require authentication via session cookie. CSRF token is required for all mutating operations (POST, PATCH, DELETE).

### GET /api/chats

List all chats for the authenticated user.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | 20 | Max results to return (1-100) |
| `offset` | integer | 0 | Number of results to skip |
| `search` | string | — | Full-text search query on chat titles |
| `archived` | boolean | false | Include archived chats |
| `pinned` | boolean | — | Filter to pinned chats only |
| `model` | string | — | Filter by model used |

**Request:**

```http
GET /api/chats?limit=10&offset=0&search=quantum HTTP/1.1
Host: your-domain.com
Cookie: connect.sid=s%3A...
```

**Response:**

```json
{
  "chats": [
    {
      "id": "chat_01j9abc123",
      "title": "Quantum computing basics",
      "model": "gpt-4o",
      "systemPrompt": null,
      "pinned": false,
      "archived": false,
      "messageCount": 12,
      "lastMessageAt": "2026-04-11T10:23:45.000Z",
      "createdAt": "2026-04-10T08:15:00.000Z",
      "updatedAt": "2026-04-11T10:23:45.000Z"
    }
  ],
  "total": 1,
  "limit": 10,
  "offset": 0
}
```

---

### POST /api/chats

Create a new chat session.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | No | Chat title. Auto-generated from first message if omitted |
| `model` | string | No | Default model for this chat. Falls back to user preference |
| `systemPrompt` | string | No | Custom system prompt for this chat |
| `agentId` | string | No | Attach an agent to this chat |
| `metadata` | object | No | Arbitrary key-value metadata |

**Request:**

```http
POST /api/chats HTTP/1.1
Host: your-domain.com
Cookie: connect.sid=s%3A...
Content-Type: application/json
X-CSRF-Token: abc123...

{
  "title": "Project planning session",
  "model": "claude-3-5-sonnet-20241022",
  "systemPrompt": "You are an expert project manager. Be concise and actionable."
}
```

**Response:** `201 Created`

```json
{
  "id": "chat_01j9xyz789",
  "title": "Project planning session",
  "model": "claude-3-5-sonnet-20241022",
  "systemPrompt": "You are an expert project manager. Be concise and actionable.",
  "pinned": false,
  "archived": false,
  "messageCount": 0,
  "lastMessageAt": null,
  "createdAt": "2026-04-11T12:00:00.000Z",
  "updatedAt": "2026-04-11T12:00:00.000Z"
}
```

---

### GET /api/chats/:id

Get a specific chat along with its messages.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `messageLimit` | integer | 50 | Max messages to return |
| `messageOffset` | integer | 0 | Message pagination offset |
| `includeDeleted` | boolean | false | Include soft-deleted messages |

**Response:**

```json
{
  "id": "chat_01j9xyz789",
  "title": "Project planning session",
  "model": "claude-3-5-sonnet-20241022",
  "systemPrompt": "You are an expert project manager. Be concise and actionable.",
  "pinned": false,
  "archived": false,
  "messageCount": 4,
  "createdAt": "2026-04-11T12:00:00.000Z",
  "updatedAt": "2026-04-11T12:05:30.000Z",
  "messages": [
    {
      "id": "msg_01abc",
      "chatId": "chat_01j9xyz789",
      "role": "user",
      "content": "Help me plan a 3-month product launch.",
      "model": null,
      "tokens": 12,
      "attachments": [],
      "metadata": {},
      "createdAt": "2026-04-11T12:01:00.000Z"
    },
    {
      "id": "msg_01def",
      "chatId": "chat_01j9xyz789",
      "role": "assistant",
      "content": "Here's a structured 3-month product launch plan...",
      "model": "claude-3-5-sonnet-20241022",
      "tokens": 312,
      "attachments": [],
      "metadata": { "provider": "anthropic", "cost": 0.00094 },
      "createdAt": "2026-04-11T12:01:04.000Z"
    }
  ],
  "messagePagination": {
    "total": 4,
    "limit": 50,
    "offset": 0
  }
}
```

---

### PATCH /api/chats/:id

Update chat properties.

**Request body (all fields optional):**

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | New chat title |
| `pinned` | boolean | Pin or unpin the chat |
| `archived` | boolean | Archive or unarchive the chat |
| `model` | string | Change the default model |
| `systemPrompt` | string | Update the system prompt |
| `metadata` | object | Merge into existing metadata |

**Request:**

```http
PATCH /api/chats/chat_01j9xyz789 HTTP/1.1
Host: your-domain.com
Cookie: connect.sid=s%3A...
Content-Type: application/json
X-CSRF-Token: abc123...

{
  "pinned": true,
  "title": "Q2 Product Launch Planning"
}
```

**Response:**

```json
{
  "id": "chat_01j9xyz789",
  "title": "Q2 Product Launch Planning",
  "pinned": true,
  "archived": false,
  "updatedAt": "2026-04-11T12:10:00.000Z"
}
```

---

### DELETE /api/chats/:id

Delete a chat and all its messages. This is permanent and cannot be undone.

**Response:** `204 No Content`

---

### POST /api/chats/:id/messages

Send a message to a chat and get an AI response. This is the primary endpoint for conversational interaction.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | Yes | User message text |
| `role` | string | No | Always `user` for new messages. Default: `user` |
| `attachments` | array | No | Array of file attachment objects |
| `attachments[].documentId` | string | No | ID of a previously uploaded document |
| `attachments[].url` | string | No | Public URL to reference |
| `model` | string | No | Override the chat's default model for this message only |
| `stream` | boolean | No | Stream the response via SSE. Default: `false` |
| `tools` | array | No | Enable specific tools for this turn (overrides agent defaults) |
| `temperature` | number | No | Override sampling temperature for this turn |
| `maxTokens` | integer | No | Override max tokens for this turn |
| `planMode` | boolean | No | If `true`, generate an execution plan before running |

**Non-streaming request:**

```http
POST /api/chats/chat_01j9xyz789/messages HTTP/1.1
Host: your-domain.com
Cookie: connect.sid=s%3A...
Content-Type: application/json
X-CSRF-Token: abc123...

{
  "content": "What are the biggest risks in a product launch?",
  "model": "gpt-4o",
  "stream": false
}
```

**Non-streaming response:**

```json
{
  "userMessage": {
    "id": "msg_01ghi",
    "chatId": "chat_01j9xyz789",
    "role": "user",
    "content": "What are the biggest risks in a product launch?",
    "createdAt": "2026-04-11T12:15:00.000Z"
  },
  "assistantMessage": {
    "id": "msg_01jkl",
    "chatId": "chat_01j9xyz789",
    "role": "assistant",
    "content": "The biggest risks in a product launch include: 1) Market timing misalignment...",
    "model": "gpt-4o",
    "tokens": 428,
    "metadata": {
      "provider": "openai",
      "cost": 0.00642,
      "latencyMs": 1834
    },
    "createdAt": "2026-04-11T12:15:02.000Z"
  }
}
```

**Streaming request:**

```http
POST /api/chats/chat_01j9xyz789/messages HTTP/1.1
Host: your-domain.com
Cookie: connect.sid=s%3A...
Content-Type: application/json
X-CSRF-Token: abc123...

{
  "content": "Summarize our conversation so far.",
  "stream": true
}
```

For streaming responses, the server returns `Content-Type: text/event-stream`. See the [SSE Events Reference](#sse-events-reference) section for event types and payload schemas.

**Message with document attachment:**

```json
{
  "content": "Summarize the key points from the attached report.",
  "attachments": [
    { "documentId": "doc_01abc" }
  ]
}
```

---

### GET /api/chats/:id/messages/stream

Connect to the SSE stream for a chat. Delivers real-time token updates for any ongoing AI generation in the chat. The server keeps the connection open until the response completes or times out (60-second idle timeout).

```http
GET /api/chats/chat_01j9xyz789/messages/stream HTTP/1.1
Host: your-domain.com
Cookie: connect.sid=s%3A...
Accept: text/event-stream
Last-Event-ID: evt_00123
```

Include `Last-Event-ID` to resume from the last received event after a reconnect.

---

### DELETE /api/chats/:id/messages/:msgId

Delete a specific message. Soft-deletes by default; use `?permanent=true` to hard delete.

**Query parameters:** `permanent=true` for hard delete (irreversible).

**Response:** `204 No Content`

---

### POST /api/chats/:id/branch

Create a branch (fork) of a chat from a specific message. All messages up to and including the specified message are copied to the new chat.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `messageId` | string | Yes | The message ID to branch from |
| `title` | string | No | Title for the new branched chat |

**Response:** `201 Created` — returns the new chat object (same schema as POST /api/chats).

---

## Agent API

Agents are configurable AI workers with defined instructions, tool access, and model preferences. They can run as background tasks or be attached to chat sessions.

### GET /api/agents

List all agents available to the authenticated user.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | 20 | Max results |
| `offset` | integer | 0 | Pagination offset |
| `search` | string | — | Search by name or description |
| `type` | string | — | Filter: `personal`, `shared`, `system` |

**Response:**

```json
{
  "agents": [
    {
      "id": "agent_01abc",
      "name": "Research Assistant",
      "description": "Searches the web and synthesizes findings into structured reports",
      "model": "claude-3-5-sonnet-20241022",
      "instructions": "You are a thorough research assistant...",
      "tools": ["web_search", "read_url", "create_document"],
      "type": "personal",
      "enabled": true,
      "runCount": 47,
      "createdAt": "2026-03-01T09:00:00.000Z",
      "updatedAt": "2026-04-10T14:30:00.000Z"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

---

### POST /api/agents

Create a new agent.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Agent name (max 100 chars) |
| `description` | string | No | Short description of what the agent does |
| `instructions` | string | Yes | System prompt / instructions for the agent |
| `model` | string | No | Preferred model. Falls back to smart router if omitted |
| `tools` | array | No | List of tool names the agent can use |
| `temperature` | number | No | Default temperature (0-2) |
| `maxTokens` | integer | No | Default max tokens per turn |
| `maxIterations` | integer | No | Max tool call iterations per run. Default: 10 |
| `type` | string | No | `personal` (default) or `shared` |
| `metadata` | object | No | Arbitrary metadata |

**Request:**

```http
POST /api/agents HTTP/1.1
Host: your-domain.com
Cookie: connect.sid=s%3A...
Content-Type: application/json
X-CSRF-Token: abc123...

{
  "name": "Code Reviewer",
  "description": "Reviews code for bugs, style issues, and security vulnerabilities",
  "instructions": "You are an expert code reviewer. Analyze code for: correctness, security vulnerabilities (OWASP top 10), performance bottlenecks, and style consistency. Provide specific line-level feedback with suggested fixes.",
  "model": "claude-3-5-sonnet-20241022",
  "tools": ["read_file", "search_code", "create_document"],
  "temperature": 0.2
}
```

**Response:** `201 Created` — returns the created agent object.

---

### GET /api/agents/:id

Get a specific agent by ID. Returns the full agent object including the complete `instructions` field.

---

### PATCH /api/agents/:id

Update an agent. All fields optional. Only the fields provided are updated.

**Response:** Updated agent object.

---

### DELETE /api/agents/:id

Delete an agent. Any future scheduled runs using this agent will fail.

**Response:** `204 No Content`

---

### POST /api/agents/:id/run

Execute an agent task. The agent will reason through the task using its configured tools and model, completing multiple steps autonomously.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `task` | string | Yes | The task or query for the agent to complete |
| `context` | object | No | Additional context |
| `context.documents` | array | No | Document IDs to include in context |
| `context.chatHistory` | array | No | Prior messages to seed the agent |
| `stream` | boolean | No | Stream progress events via SSE. Default: `false` |
| `webhookUrl` | string | No | POST results to this URL when complete |
| `timeoutMs` | integer | No | Max execution time in ms. Default: 120000 |

**Request:**

```http
POST /api/agents/agent_01abc/run HTTP/1.1
Host: your-domain.com
Cookie: connect.sid=s%3A...
Content-Type: application/json
X-CSRF-Token: abc123...

{
  "task": "Research the top 5 AI coding assistants in 2026 and compare their features, pricing, and limitations. Produce a markdown table.",
  "stream": false,
  "timeoutMs": 90000
}
```

**Response (non-streaming):**

```json
{
  "runId": "run_01xyz",
  "agentId": "agent_01abc",
  "status": "completed",
  "task": "Research the top 5 AI coding assistants...",
  "result": "## AI Coding Assistants Comparison 2026\n\n| Tool | Provider | Price/month | Context Window | Notable Features |\n|------|----------|-------------|----------------|------------------|\n...",
  "toolCallCount": 8,
  "tokensUsed": 4821,
  "cost": 0.01447,
  "durationMs": 42300,
  "completedAt": "2026-04-11T12:30:42.000Z",
  "createdAt": "2026-04-11T12:30:00.000Z"
}
```

When `stream: true`, the server returns an immediate acknowledgement with a `runId`, then streams SSE events. Connect to `GET /api/agents/runs/:runId` to retrieve the full result after the stream ends.

---

### GET /api/agents/:id/runs

List all historical runs for an agent.

**Query parameters:** `limit`, `offset`, `status` (one of `pending`, `running`, `completed`, `failed`)

**Response:**

```json
{
  "runs": [
    {
      "runId": "run_01xyz",
      "agentId": "agent_01abc",
      "status": "completed",
      "task": "Research the top 5 AI coding assistants...",
      "tokensUsed": 4821,
      "cost": 0.01447,
      "durationMs": 42300,
      "completedAt": "2026-04-11T12:30:42.000Z",
      "createdAt": "2026-04-11T12:30:00.000Z"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

---

### GET /api/agents/runs/:runId

Get the status, result, and step-by-step trace of a specific agent run.

**Response:**

```json
{
  "runId": "run_01xyz",
  "agentId": "agent_01abc",
  "status": "completed",
  "task": "Research the top 5 AI coding assistants...",
  "result": "## AI Coding Assistants Comparison 2026\n\n...",
  "steps": [
    {
      "stepNumber": 1,
      "type": "tool_call",
      "tool": "web_search",
      "input": { "query": "top AI coding assistants 2026 comparison" },
      "output": { "results": [] },
      "durationMs": 1240
    },
    {
      "stepNumber": 2,
      "type": "tool_call",
      "tool": "read_url",
      "input": { "url": "https://example.com/ai-tools-2026" },
      "output": { "content": "..." },
      "durationMs": 890
    },
    {
      "stepNumber": 3,
      "type": "llm_response",
      "tokensIn": 3240,
      "tokensOut": 1581,
      "durationMs": 3120
    }
  ],
  "tokensUsed": 4821,
  "cost": 0.01447,
  "durationMs": 42300,
  "completedAt": "2026-04-11T12:30:42.000Z",
  "createdAt": "2026-04-11T12:30:00.000Z"
}
```

---

## Documents API

Upload and manage files for use in conversations and agent contexts. Supported file types: PDF, DOCX, XLSX, TXT, MD, CSV, JSON, and most code file extensions. Maximum file size: 50MB per file.

### GET /api/documents

List all documents owned by the authenticated user.

**Query parameters:** `limit`, `offset`, `search`, `type` (MIME type filter), `status` (one of `pending`, `processing`, `ready`, `failed`)

**Response:**

```json
{
  "documents": [
    {
      "id": "doc_01abc",
      "name": "Q1 Financial Report.pdf",
      "originalName": "Q1_Report_2026.pdf",
      "mimeType": "application/pdf",
      "size": 2457600,
      "status": "ready",
      "pageCount": 24,
      "chunkCount": 142,
      "embeddingModel": "text-embedding-3-small",
      "metadata": {},
      "createdAt": "2026-04-01T09:00:00.000Z",
      "processedAt": "2026-04-01T09:00:45.000Z"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

---

### POST /api/documents/upload

Upload a file. Uses `multipart/form-data` encoding.

**Form fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | file | Yes | The file to upload (max 50MB) |
| `name` | string | No | Display name for the document |
| `processImmediately` | boolean | No | Auto-process and embed after upload. Default: `true` |
| `metadata` | string | No | JSON string of arbitrary metadata |

**Request:**

```http
POST /api/documents/upload HTTP/1.1
Host: your-domain.com
Cookie: connect.sid=s%3A...
Content-Type: multipart/form-data; boundary=----FormBoundary7MA4YWxkTrZu0gW
X-CSRF-Token: abc123...

------FormBoundary7MA4YWxkTrZu0gW
Content-Disposition: form-data; name="file"; filename="report.pdf"
Content-Type: application/pdf

[binary PDF data]
------FormBoundary7MA4YWxkTrZu0gW
Content-Disposition: form-data; name="name"

Q1 Financial Report
------FormBoundary7MA4YWxkTrZu0gW--
```

**Response:** `201 Created`

```json
{
  "id": "doc_01abc",
  "name": "Q1 Financial Report",
  "originalName": "report.pdf",
  "mimeType": "application/pdf",
  "size": 2457600,
  "status": "processing",
  "createdAt": "2026-04-11T12:00:00.000Z"
}
```

Processing runs asynchronously. Poll `GET /api/documents/:id` or subscribe to the `document.processed` webhook event to know when the document is ready.

---

### GET /api/documents/:id

Get document metadata and current processing status.

**Response:** Full document object. When `status` is `failed`, the `processingError` field contains the error description.

---

### DELETE /api/documents/:id

Delete a document and all its associated text chunks and embeddings.

**Response:** `204 No Content`

---

### POST /api/documents/:id/process

Re-trigger or start processing and embedding for a document. Use when initial processing failed or when you want to re-embed with different settings.

**Request body (all optional):**

| Field | Type | Description |
|-------|------|-------------|
| `chunkSize` | integer | Token size per chunk. Default: 512 |
| `chunkOverlap` | integer | Token overlap between adjacent chunks. Default: 64 |
| `embeddingModel` | string | Embedding model to use |
| `extractMetadata` | boolean | Extract title, author, date. Default: `true` |

**Response:**

```json
{
  "id": "doc_01abc",
  "status": "processing",
  "jobId": "job_xyz789",
  "estimatedSeconds": 30
}
```

---

### GET /api/documents/:id/chunks

Get the text chunks extracted from a document with optional semantic search within the document.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | integer | Max chunks to return. Default: 20 |
| `offset` | integer | Pagination offset |
| `query` | string | Semantic search query to find the most relevant chunks |
| `threshold` | number | Minimum similarity score for semantic search (0-1). Default: 0.7 |

**Response:**

```json
{
  "chunks": [
    {
      "id": "chunk_01",
      "documentId": "doc_01abc",
      "index": 0,
      "content": "Executive Summary: Q1 2026 revenue increased by 23% year-over-year driven by enterprise subscriptions...",
      "pageNumber": 1,
      "similarity": 0.94,
      "metadata": { "section": "Executive Summary" }
    }
  ],
  "total": 142,
  "limit": 20,
  "offset": 0
}
```

---

## Search API

### GET /api/search

Perform hybrid search across messages, chats, and documents. Combines PostgreSQL full-text search with pgvector semantic search using Reciprocal Rank Fusion (k=60) for ranking.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `q` | string | Required | Search query (min 2 characters) |
| `type` | string | `all` | One of: `all`, `message`, `chat`, `document` |
| `limit` | integer | 20 | Max results per type (1-100) |
| `offset` | integer | 0 | Pagination offset |
| `dateFrom` | string | — | ISO 8601 start date filter (inclusive) |
| `dateTo` | string | — | ISO 8601 end date filter (inclusive) |
| `model` | string | — | Filter messages by model used |

**Request:**

```http
GET /api/search?q=quantum+computing&type=all&limit=5 HTTP/1.1
Host: your-domain.com
Cookie: connect.sid=s%3A...
```

**Response:**

```json
{
  "query": "quantum computing",
  "results": {
    "messages": [
      {
        "id": "msg_01abc",
        "chatId": "chat_01xyz",
        "chatTitle": "Physics discussion",
        "role": "assistant",
        "excerpt": "...quantum <mark>computing</mark> leverages superposition to process multiple states simultaneously...",
        "score": 0.91,
        "createdAt": "2026-04-10T10:00:00.000Z"
      }
    ],
    "chats": [
      {
        "id": "chat_01xyz",
        "title": "Quantum computing basics",
        "excerpt": "Introduction to <mark>quantum computing</mark> concepts and qubits",
        "score": 0.88,
        "createdAt": "2026-04-10T09:00:00.000Z"
      }
    ],
    "documents": [
      {
        "id": "doc_01def",
        "name": "IBM Quantum Roadmap 2026.pdf",
        "excerpt": "...advances in <mark>quantum computing</mark> hardware show 1000-qubit processors...",
        "score": 0.85,
        "pageNumber": 3,
        "createdAt": "2026-03-15T14:00:00.000Z"
      }
    ]
  },
  "total": {
    "messages": 12,
    "chats": 3,
    "documents": 1
  },
  "durationMs": 48
}
```

Excerpts include HTML `<mark>` tags around matched terms. Strip these tags if rendering as plain text.

---

## Memory API

IliaGPT automatically extracts facts from conversations (preferences, personal information, work context) and stores them with vector embeddings. Stored memories are injected into future conversations for personalization.

### GET /api/memories

List all stored memory facts for the authenticated user.

**Query parameters:** `limit`, `offset`, `search`, `category` (e.g., `preference`, `personal`, `work`, `technical`)

**Response:**

```json
{
  "memories": [
    {
      "id": "mem_01abc",
      "fact": "User prefers TypeScript over JavaScript and follows strict ESLint rules.",
      "category": "preference",
      "importanceScore": 0.8,
      "mentionCount": 8,
      "lastMentionedAt": "2026-04-10T15:30:00.000Z",
      "sourceChats": ["chat_01abc", "chat_01def"],
      "createdAt": "2026-03-15T09:00:00.000Z",
      "updatedAt": "2026-04-10T15:30:00.000Z"
    },
    {
      "id": "mem_01def",
      "fact": "User works at a B2B SaaS startup as a senior engineer on a team of 8.",
      "category": "work",
      "importanceScore": 0.7,
      "mentionCount": 5,
      "lastMentionedAt": "2026-04-08T11:00:00.000Z",
      "sourceChats": ["chat_01ghi"],
      "createdAt": "2026-03-20T10:00:00.000Z",
      "updatedAt": "2026-04-08T11:00:00.000Z"
    }
  ],
  "total": 24,
  "limit": 20,
  "offset": 0
}
```

**Importance scoring:** `importanceScore = min(mentionCount / 10, 1.0)`. Memories with higher importance scores are more likely to be included in the system prompt context window.

---

### DELETE /api/memories/:id

Delete a specific memory fact permanently. It will no longer be injected into conversations.

**Response:** `204 No Content`

---

### POST /api/memories/extract

Manually trigger memory extraction from recent conversations. This normally runs automatically after each conversation ends.

**Request body:**

| Field | Type | Description |
|-------|------|-------------|
| `chatId` | string | Extract from a specific chat. Omit to scan recent chats |
| `lookbackDays` | integer | Number of days of history to scan. Default: 7 |
| `maxFacts` | integer | Maximum new facts to extract. Default: 10 |

**Request:**

```http
POST /api/memories/extract HTTP/1.1
Host: your-domain.com
Cookie: connect.sid=s%3A...
Content-Type: application/json
X-CSRF-Token: abc123...

{
  "chatId": "chat_01xyz",
  "maxFacts": 5
}
```

**Response:**

```json
{
  "extracted": 3,
  "skipped": 2,
  "facts": [
    {
      "id": "mem_01newA",
      "fact": "User is migrating their infrastructure from AWS to GCP in Q2 2026.",
      "category": "work",
      "importanceScore": 0.3
    },
    {
      "id": "mem_01newB",
      "fact": "User prefers PostgreSQL over MySQL for relational databases.",
      "category": "preference",
      "importanceScore": 0.2
    },
    {
      "id": "mem_01newC",
      "fact": "User is learning Rust in their spare time.",
      "category": "personal",
      "importanceScore": 0.1
    }
  ],
  "durationMs": 1820
}
```

---

## Tools API

IliaGPT ships with 100+ built-in tools for web access, code execution, document creation, browser automation, and third-party integrations. This API allows discovery and direct execution of tools outside an agent context.

### GET /api/tools

List all available tools.

**Query parameters:** `limit`, `offset`, `category`, `enabled` (boolean filter), `search`

**Response:**

```json
{
  "tools": [
    {
      "name": "web_search",
      "displayName": "Web Search",
      "description": "Search the web using multiple providers and return structured results with snippets",
      "category": "internet",
      "parameters": {
        "query": { "type": "string", "required": true, "description": "Search query" },
        "limit": { "type": "integer", "default": 10, "description": "Number of results" },
        "provider": { "type": "string", "enum": ["google", "bing", "brave"], "default": "google" }
      },
      "enabled": true,
      "requiresAuth": false,
      "rateLimit": "60/min"
    },
    {
      "name": "run_code",
      "displayName": "Execute Code",
      "description": "Execute Python, JavaScript, or Bash code in a sandboxed environment",
      "category": "code",
      "parameters": {
        "code": { "type": "string", "required": true },
        "language": { "type": "string", "enum": ["python", "javascript", "bash"], "required": true },
        "timeoutMs": { "type": "integer", "default": 30000 }
      },
      "enabled": true,
      "requiresAuth": false,
      "rateLimit": "30/min"
    }
  ],
  "total": 112,
  "limit": 20,
  "offset": 0
}
```

---

### POST /api/tools/:name/execute

Execute a tool directly. The tool runs with the authenticated user's permissions and counts against their rate limit.

**Request body:** Tool-specific parameters matching the tool's parameter schema from `GET /api/tools`.

**Request:**

```http
POST /api/tools/web_search/execute HTTP/1.1
Host: your-domain.com
Cookie: connect.sid=s%3A...
Content-Type: application/json
X-CSRF-Token: abc123...

{
  "query": "latest developments in fusion energy 2026",
  "limit": 5,
  "provider": "brave"
}
```

**Response:**

```json
{
  "tool": "web_search",
  "status": "success",
  "result": {
    "results": [
      {
        "title": "Commonwealth Fusion Systems Achieves Net Energy Gain",
        "url": "https://example.com/fusion-2026",
        "excerpt": "CFS announced that its SPARC reactor achieved positive energy balance...",
        "publishedAt": "2026-04-09T08:00:00.000Z"
      }
    ],
    "totalResults": 5
  },
  "durationMs": 780
}
```

---

### GET /api/tools/categories

List all tool categories with counts.

**Response:**

```json
{
  "categories": [
    { "name": "internet", "displayName": "Internet and Web", "toolCount": 8 },
    { "name": "documents", "displayName": "Document Creation", "toolCount": 12 },
    { "name": "code", "displayName": "Code Execution", "toolCount": 6 },
    { "name": "data", "displayName": "Data Analysis", "toolCount": 9 },
    { "name": "communication", "displayName": "Communication", "toolCount": 7 },
    { "name": "files", "displayName": "File Management", "toolCount": 8 },
    { "name": "browser", "displayName": "Browser Automation", "toolCount": 15 },
    { "name": "integrations", "displayName": "Third-Party Integrations", "toolCount": 18 },
    { "name": "memory", "displayName": "Memory and Knowledge", "toolCount": 5 },
    { "name": "system", "displayName": "System and Utilities", "toolCount": 24 }
  ]
}
```

---

## Tasks API

Scheduled tasks run instructions on a cron schedule or can be triggered on demand. Tasks use the agent system internally.

### GET /api/tasks

List all scheduled tasks for the authenticated user.

**Response:**

```json
{
  "tasks": [
    {
      "id": "task_01abc",
      "name": "Daily Briefing",
      "description": "Summarize AI and tech news, send to Slack",
      "schedule": "0 8 * * 1-5",
      "scheduleDescription": "Weekdays at 8:00 AM UTC",
      "instructions": "Search for the latest AI and tech news from the past 24 hours, summarize the top 5 stories with links, and send to the #general Slack channel.",
      "agentId": "agent_01xyz",
      "enabled": true,
      "lastRunAt": "2026-04-11T08:00:02.000Z",
      "lastRunStatus": "completed",
      "nextRunAt": "2026-04-14T08:00:00.000Z",
      "runCount": 34,
      "createdAt": "2026-03-01T09:00:00.000Z"
    }
  ],
  "total": 3,
  "limit": 20,
  "offset": 0
}
```

---

### POST /api/tasks

Create a new scheduled task.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Task name (max 100 chars) |
| `schedule` | string | Yes | Cron expression (5-field, UTC). Example: `"0 9 * * 1-5"` |
| `instructions` | string | Yes | What the agent should do when this task runs |
| `agentId` | string | No | Agent to use. Falls back to system default if omitted |
| `enabled` | boolean | No | Enable immediately. Default: `true` |
| `webhookUrl` | string | No | URL to notify when the run completes |
| `description` | string | No | Human-readable description |
| `timeoutMs` | integer | No | Max execution time in ms. Default: 300000 (5 minutes) |

**Request:**

```http
POST /api/tasks HTTP/1.1
Host: your-domain.com
Cookie: connect.sid=s%3A...
Content-Type: application/json
X-CSRF-Token: abc123...

{
  "name": "Weekly GitHub Summary",
  "schedule": "0 9 * * 1",
  "instructions": "Fetch open issues and pull requests from the repository, summarize progress from the past week, and generate a markdown report. Save it as a document.",
  "agentId": "agent_01abc",
  "enabled": true,
  "description": "Every Monday at 9 AM, summarize GitHub activity"
}
```

**Response:** `201 Created` — returns the task object.

---

### PATCH /api/tasks/:id

Update task properties. All fields are optional.

**Response:** Updated task object.

---

### DELETE /api/tasks/:id

Delete a task. Any queued future runs are cancelled.

**Response:** `204 No Content`

---

### POST /api/tasks/:id/run

Trigger an immediate manual run of a task, regardless of its schedule or enabled status.

**Request body (all optional):**

| Field | Type | Description |
|-------|------|-------------|
| `stream` | boolean | Stream execution events via SSE |
| `context` | object | Additional context key-value pairs to inject |

**Response:**

```json
{
  "runId": "taskrun_01abc",
  "taskId": "task_01abc",
  "status": "running",
  "startedAt": "2026-04-11T12:45:00.000Z"
}
```

---

## Admin API

Admin endpoints require the authenticated user to have the `admin` role. Session authentication only — API keys cannot access admin routes.

### GET /api/admin/users

List all users in the system.

**Query parameters:** `limit`, `offset`, `search` (by name or email), `tier` (one of `free`, `pro`, `enterprise`), `status` (one of `active`, `suspended`)

**Response:**

```json
{
  "users": [
    {
      "id": "user_01abc",
      "email": "jane@example.com",
      "name": "Jane Smith",
      "tier": "pro",
      "status": "active",
      "provider": "google",
      "chatCount": 142,
      "messageCount": 2847,
      "totalCost": 4.23,
      "dailyBudget": 5.00,
      "lastActiveAt": "2026-04-11T11:30:00.000Z",
      "createdAt": "2026-01-15T09:00:00.000Z"
    }
  ],
  "total": 1248,
  "limit": 20,
  "offset": 0
}
```

---

### GET /api/admin/usage

Get aggregated platform usage statistics for a date range.

**Query parameters:** `from` (ISO date, required), `to` (ISO date, required), `granularity` (one of `hour`, `day`, `week`, `month`. Default: `day`)

**Response:**

```json
{
  "period": {
    "from": "2026-04-01T00:00:00.000Z",
    "to": "2026-04-11T23:59:59.000Z"
  },
  "summary": {
    "totalRequests": 94821,
    "totalTokens": 128456789,
    "totalCost": 384.72,
    "activeUsers": 312,
    "newUsers": 48,
    "errorRate": 0.0023,
    "avgLatencyMs": 1240
  },
  "byModel": [
    {
      "model": "gpt-4o",
      "requests": 42312,
      "tokens": 68234512,
      "cost": 204.70
    },
    {
      "model": "claude-3-5-sonnet-20241022",
      "requests": 28491,
      "tokens": 41782340,
      "cost": 125.35
    }
  ],
  "timeSeries": [
    {
      "timestamp": "2026-04-01T00:00:00.000Z",
      "requests": 8240,
      "cost": 32.18,
      "activeUsers": 89
    }
  ]
}
```

---

### GET /api/admin/models

Get model configuration including availability, circuit breaker state, and routing performance data.

**Response:**

```json
{
  "models": [
    {
      "id": "gpt-4o",
      "provider": "openai",
      "status": "available",
      "circuitBreaker": {
        "state": "closed",
        "failures": 0,
        "lastFailureAt": null
      },
      "latency": {
        "p50Ms": 820,
        "p95Ms": 2340,
        "p99Ms": 4120
      },
      "routingWeight": 0.45,
      "enabled": true,
      "costPer1kInputTokens": 0.0025,
      "costPer1kOutputTokens": 0.01
    }
  ]
}
```

---

## Health and Metrics

### GET /api/health

Full health check with dependency status. Safe for public access (no auth required). Returns 200 when healthy, 503 when degraded.

**Response (healthy):** `200 OK`

```json
{
  "status": "healthy",
  "version": "2026.4.5",
  "timestamp": "2026-04-11T12:00:00.000Z",
  "uptime": 86400,
  "dependencies": {
    "database": {
      "status": "healthy",
      "latencyMs": 3,
      "poolSize": 10,
      "poolActive": 2
    },
    "redis": {
      "status": "healthy",
      "latencyMs": 1,
      "connectedClients": 8
    },
    "fastapi": {
      "status": "healthy",
      "latencyMs": 12
    }
  },
  "memory": {
    "heapUsedMb": 312,
    "heapTotalMb": 512,
    "rssMb": 480
  }
}
```

**Response (degraded):** `503 Service Unavailable`

```json
{
  "status": "degraded",
  "version": "2026.4.5",
  "timestamp": "2026-04-11T12:00:00.000Z",
  "dependencies": {
    "database": { "status": "healthy", "latencyMs": 4 },
    "redis": { "status": "unhealthy", "error": "ECONNREFUSED", "latencyMs": null }
  }
}
```

---

### GET /api/health/ready

Kubernetes readiness probe. Returns `200` when the server is ready to accept traffic. Returns `503` during startup, shutdown, or overload.

```json
{ "ready": true }
```

---

### GET /api/health/live

Kubernetes liveness probe. Returns `200` as long as the Node.js event loop is responsive.

```json
{ "alive": true }
```

---

### GET /api/metrics

Prometheus-compatible metrics in the standard text exposition format. Requires `METRICS_ENABLED=true`. Optionally protected by `Authorization: Bearer <METRICS_TOKEN>`.

```
# HELP http_requests_total Total HTTP requests processed
# TYPE http_requests_total counter
http_requests_total{method="POST",route="/v1/chat/completions",status="200"} 42312
http_requests_total{method="GET",route="/api/chats",status="200"} 18400
http_requests_total{method="POST",route="/v1/chat/completions",status="429"} 231

# HELP http_request_duration_seconds HTTP request duration in seconds
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{route="/v1/chat/completions",le="0.5"} 12481
http_request_duration_seconds_bucket{route="/v1/chat/completions",le="1.0"} 28491
http_request_duration_seconds_bucket{route="/v1/chat/completions",le="2.0"} 38120
http_request_duration_seconds_bucket{route="/v1/chat/completions",le="+Inf"} 42312
http_request_duration_seconds_sum{route="/v1/chat/completions"} 52583.4
http_request_duration_seconds_count{route="/v1/chat/completions"} 42312

# HELP llm_tokens_total Total LLM tokens processed
# TYPE llm_tokens_total counter
llm_tokens_total{provider="openai",model="gpt-4o",type="input"} 34117256
llm_tokens_total{provider="openai",model="gpt-4o",type="output"} 8541378
llm_tokens_total{provider="anthropic",model="claude-3-5-sonnet-20241022",type="input"} 20891120
llm_tokens_total{provider="anthropic",model="claude-3-5-sonnet-20241022",type="output"} 6291234

# HELP llm_cost_dollars_total Total LLM spend in USD
# TYPE llm_cost_dollars_total counter
llm_cost_dollars_total{provider="openai",model="gpt-4o"} 204.70
llm_cost_dollars_total{provider="anthropic",model="claude-3-5-sonnet-20241022"} 125.35

# HELP active_sessions Active authenticated user sessions
# TYPE active_sessions gauge
active_sessions 89

# HELP agent_runs_total Total agent task runs
# TYPE agent_runs_total counter
agent_runs_total{status="completed"} 2847
agent_runs_total{status="failed"} 42
agent_runs_total{status="timeout"} 11

# HELP circuit_breaker_state Circuit breaker state per provider (0=closed, 1=half-open, 2=open)
# TYPE circuit_breaker_state gauge
circuit_breaker_state{provider="openai"} 0
circuit_breaker_state{provider="anthropic"} 0
circuit_breaker_state{provider="google"} 0
```

---

## SSE Events Reference

When a request uses `stream: true` or connects to a stream endpoint, the server sends Server-Sent Events. Each event follows the standard SSE format:

```
event: <event_type>
id: <event_id>
data: <JSON payload>

```

Two blank lines terminate each event. The stream closes after `message_stop` or `error`.

---

### message_start

Sent once at the beginning of each assistant message generation.

```
event: message_start
id: evt_00001
data: {"messageId":"msg_01abc","chatId":"chat_01xyz","model":"gpt-4o","role":"assistant","createdAt":"2026-04-11T12:00:00.000Z"}
```

| Field | Type | Description |
|-------|------|-------------|
| `messageId` | string | ID of the message being generated |
| `chatId` | string | Parent chat ID |
| `model` | string | Model generating the response |
| `role` | string | Always `assistant` |
| `createdAt` | string | ISO 8601 timestamp |

---

### content_delta

Sent for each token or token chunk as it streams from the model.

```
event: content_delta
id: evt_00002
data: {"messageId":"msg_01abc","index":0,"delta":{"type":"text","text":"The "}}
```

```
event: content_delta
id: evt_00003
data: {"messageId":"msg_01abc","index":0,"delta":{"type":"text","text":"quick brown fox"}}
```

| Field | Type | Description |
|-------|------|-------------|
| `messageId` | string | Parent message ID |
| `index` | integer | Content block index (0 for main text) |
| `delta.type` | string | `text` or `json` |
| `delta.text` | string | The text chunk (may be 1-50 characters) |

---

### tool_use_start

Sent when the model begins invoking a tool.

```
event: tool_use_start
id: evt_00010
data: {"messageId":"msg_01abc","toolCallId":"call_xyz123","toolName":"web_search","index":1}
```

| Field | Type | Description |
|-------|------|-------------|
| `messageId` | string | Parent message ID |
| `toolCallId` | string | Unique identifier for this tool call |
| `toolName` | string | Name of the tool being called |
| `index` | integer | Content block index for this tool call |

---

### tool_use_delta

Sent as the tool call argument JSON is streamed.

```
event: tool_use_delta
id: evt_00011
data: {"toolCallId":"call_xyz123","delta":{"type":"input_json_delta","partial_json":"{\"query\": \"fusion energy"}}
```

---

### tool_result

Sent when a tool call completes and its output is available.

```
event: tool_result
id: evt_00020
data: {"toolCallId":"call_xyz123","toolName":"web_search","status":"success","result":{"results":[{"title":"...","url":"...","excerpt":"..."}]},"durationMs":842}
```

| Field | Type | Description |
|-------|------|-------------|
| `toolCallId` | string | Matching tool call ID |
| `toolName` | string | Name of the tool that ran |
| `status` | string | `success` or `error` |
| `result` | any | Tool output (when status is success) |
| `error` | string | Error description (when status is error) |
| `durationMs` | integer | Tool wall-clock execution time |

---

### message_stop

Sent once when the complete message has been generated. Contains final accounting data.

```
event: message_stop
id: evt_00050
data: {"messageId":"msg_01abc","finishReason":"stop","usage":{"inputTokens":48,"outputTokens":312,"totalTokens":360},"cost":0.00936,"durationMs":2140}
```

| Field | Type | Description |
|-------|------|-------------|
| `messageId` | string | Completed message ID |
| `finishReason` | string | One of: `stop`, `length`, `tool_calls`, `content_filter` |
| `usage.inputTokens` | integer | Prompt tokens consumed |
| `usage.outputTokens` | integer | Completion tokens generated |
| `usage.totalTokens` | integer | Sum of input and output tokens |
| `cost` | number | Estimated USD cost for this generation |
| `durationMs` | integer | Total time from first token to last token |

---

### error

Sent when an unrecoverable error occurs during streaming. The connection closes after this event.

```
event: error
id: evt_00099
data: {"code":"LLM_ERROR","message":"Provider timeout after 30s","provider":"openai","retryable":true}
```

| Field | Type | Description |
|-------|------|-------------|
| `code` | string | Machine-readable error code |
| `message` | string | Human-readable description |
| `provider` | string | Affected provider if applicable |
| `retryable` | boolean | Whether the request can be retried immediately |

---

### usage

Periodic cost update sent approximately every 30 seconds during long generations.

```
event: usage
id: evt_00030
data: {"inputTokens":48,"outputTokens":124,"estimatedCost":0.00372}
```

---

## Error Codes

All error responses use a consistent JSON envelope:

```json
{
  "error": {
    "code": "INVALID_API_KEY",
    "message": "The provided API key is invalid or has been revoked.",
    "status": 401,
    "requestId": "req_abc123xyz",
    "timestamp": "2026-04-11T12:00:00.000Z",
    "details": {}
  }
}
```

Always log the `requestId` when contacting support.

### 400 Bad Request

| Code | Description | Resolution |
|------|-------------|------------|
| `INVALID_REQUEST` | Request body is malformed or contains an unsupported field | Check JSON syntax and field types against the schema |
| `MISSING_FIELD` | A required field is absent | Check `details.field` for the missing field name |
| `INVALID_MODEL` | The specified model ID does not exist or is unavailable | Call `GET /v1/models` for the current list |
| `INVALID_SCHEDULE` | The cron expression is syntactically invalid | Use a standard 5-field cron expression |
| `FILE_TOO_LARGE` | Uploaded file exceeds the 50MB per-file limit | Compress or split the file before uploading |
| `UNSUPPORTED_FORMAT` | File format is not supported for processing | Use PDF, DOCX, XLSX, TXT, MD, CSV, JSON, or common code extensions |
| `CONTEXT_LENGTH_EXCEEDED` | Conversation history exceeds the model's context window | Summarize earlier messages or start a new chat |
| `INVALID_TOOL_PARAMETERS` | Tool execution parameters fail schema validation | Check the parameter schema via `GET /api/tools` |

### 401 Unauthorized

| Code | Description | Resolution |
|------|-------------|------------|
| `UNAUTHORIZED` | No authentication credentials provided | Include a session cookie or `Authorization: Bearer ilgpt_...` header |
| `INVALID_API_KEY` | API key is invalid or has been revoked | Check the key format; generate a new key from the dashboard |
| `SESSION_EXPIRED` | Session cookie has expired | Re-authenticate via OAuth |
| `CSRF_TOKEN_INVALID` | CSRF token is missing or does not match | Refresh via `GET /api/csrf-token` and retry |
| `ANONYMOUS_TOKEN_INVALID` | Anonymous user token failed HMAC verification | Regenerate the anonymous token client-side |

### 403 Forbidden

| Code | Description | Resolution |
|------|-------------|------------|
| `FORBIDDEN` | Authenticated but not authorized for this resource | This resource belongs to another user |
| `BUDGET_EXCEEDED` | Daily spending limit has been reached | Upgrade plan or wait for daily reset at midnight UTC |
| `RATE_LIMITED` | Too many requests | Respect the `Retry-After` header and apply backoff |
| `FEATURE_NOT_AVAILABLE` | This feature is not available on your current plan | Upgrade subscription tier |
| `ADMIN_REQUIRED` | Endpoint requires the admin role | Contact your administrator |

### 404 Not Found

| Code | Description | Resolution |
|------|-------------|------------|
| `NOT_FOUND` | Requested resource does not exist | Verify the ID and ensure you have access |
| `CHAT_NOT_FOUND` | Chat ID does not exist | Verify the chat ID |
| `AGENT_NOT_FOUND` | Agent ID does not exist | Verify the agent ID |
| `DOCUMENT_NOT_FOUND` | Document was not found or was deleted | Check if the document was deleted |
| `MODEL_NOT_FOUND` | Model ID is not configured in this deployment | Call `GET /v1/models` for available models |
| `TOOL_NOT_FOUND` | Tool name does not exist | Call `GET /api/tools` for the tool list |

### 409 Conflict

| Code | Description | Resolution |
|------|-------------|------------|
| `CONFLICT` | Request conflicts with current resource state | Read the current state and retry |
| `DUPLICATE_API_KEY_NAME` | An API key with this name already exists | Use a different name |
| `TASK_ALREADY_RUNNING` | The scheduled task is currently executing | Wait for the current run to complete |
| `DOCUMENT_PROCESSING` | Document is already being processed | Wait for processing to finish |

### 422 Unprocessable Entity

| Code | Description | Resolution |
|------|-------------|------------|
| `VALIDATION_ERROR` | Request passes syntax checks but fails business logic validation | See `details.errors` array for field-level validation messages |

### 429 Too Many Requests

| Code | Description | Resolution |
|------|-------------|------------|
| `TOO_MANY_REQUESTS` | Rate limit exceeded for this endpoint | Check `X-RateLimit-Reset` and wait before retrying |
| `CONCURRENT_LIMIT_EXCEEDED` | Too many simultaneous streaming connections from this account | Close idle SSE connections before opening new ones |

### 500 Internal Server Error

| Code | Description | Resolution |
|------|-------------|------------|
| `INTERNAL_ERROR` | Unexpected server-side error | Contact support with the `requestId` from the error |
| `LLM_ERROR` | The upstream LLM provider returned an error | Retry with exponential backoff; try a different model |
| `PROVIDER_UNAVAILABLE` | All providers for the requested model tier are circuit-broken | Check provider status pages; use a different model |
| `DATABASE_ERROR` | Database operation failed | Transient; retry with backoff |
| `TOOL_EXECUTION_ERROR` | The tool sandbox failed to execute | Check tool parameters; report with `requestId` if it persists |
| `EMBEDDING_ERROR` | Vector embedding generation failed | Retry; check that input text is valid UTF-8 |

### 503 Service Unavailable

| Code | Description | Resolution |
|------|-------------|------------|
| `SERVICE_UNAVAILABLE` | Server is starting up, overloaded, or shutting down | Check `GET /api/health` and retry after `Retry-After` seconds |
| `MAINTENANCE_MODE` | Platform is undergoing scheduled maintenance | Check the status page at status.your-domain.com |

---

## Rate Limiting

All API requests are subject to rate limiting enforced per user (session or API key) using a sliding window algorithm backed by Redis.

### Response Headers

Every API response includes the following rate limit headers:

| Header | Type | Description |
|--------|------|-------------|
| `X-RateLimit-Limit` | integer | Max requests allowed per minute |
| `X-RateLimit-Remaining` | integer | Requests remaining in the current window |
| `X-RateLimit-Reset` | integer | Unix timestamp when the window resets |
| `Retry-After` | integer | Seconds to wait before retrying (429 responses only) |

**Example:**

```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 300
X-RateLimit-Remaining: 248
X-RateLimit-Reset: 1744157160
Content-Type: application/json
```

### Rate Limit Tiers

| Tier | Requests/Minute | Concurrent Streams | Daily Token Budget | Daily Spend Budget |
|------|----------------|-------------------|-------------------|-------------------|
| Anonymous | 10 | 1 | 10,000 | $0.00 |
| Free | 60 | 2 | 100,000 | $0.50 |
| Pro | 300 | 10 | 1,000,000 | $5.00 |
| Enterprise | 3,000 (soft cap) | 50 | Unlimited | $50.00 |

### Endpoint-Specific Overrides

| Endpoint | Free | Pro | Notes |
|----------|------|-----|-------|
| `POST /v1/chat/completions` | 60/min | 300/min | Streaming connections count against concurrent limit |
| `POST /api/documents/upload` | 20/hour | 100/hour | File processing is async |
| `POST /api/agents/:id/run` | 10/hour | 100/hour | Long-running; timeout after 2 minutes |
| `POST /api/memories/extract` | 5/hour | 30/hour | — |
| `GET /api/admin/*` | N/A | N/A | 120/min for admins only |
| `GET /api/metrics` | N/A | N/A | 60/min; token-protected |

### Exponential Backoff Example

```javascript
async function requestWithRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err.status === 429 && attempt < maxRetries - 1) {
        const retryAfterSeconds = parseInt(err.headers['retry-after'] || '1', 10);
        const jitterMs = Math.random() * 1000;
        await new Promise(r => setTimeout(r, (retryAfterSeconds * 1000) + jitterMs));
      } else {
        throw err;
      }
    }
  }
}

// Usage
const response = await requestWithRetry(() =>
  client.chat.completions.create({ model: 'gpt-4o', messages: [...] })
);
```

---

## Webhooks

IliaGPT delivers event notifications to external HTTPS endpoints via webhooks when key events occur on your account.

### Configuration

Configure webhooks from Settings > Webhooks in the dashboard. Each webhook has a target URL, event subscription list, and a shared secret for signature verification.

```http
POST /api/admin/webhooks HTTP/1.1
Host: your-domain.com
Cookie: connect.sid=s%3A...
Content-Type: application/json
X-CSRF-Token: abc123...

{
  "url": "https://your-server.com/webhook/iliagpt",
  "events": ["message.created", "agent.run.completed", "task.completed", "document.processed"],
  "secret": "your-webhook-secret-minimum-32-characters",
  "enabled": true,
  "description": "Production integration handler"
}
```

### Request Format

Every webhook delivery is an HTTP POST to your configured URL with the following structure:

**Headers:**

| Header | Description |
|--------|-------------|
| `Content-Type` | `application/json` |
| `User-Agent` | `IliaGPT-Webhooks/2026.4` |
| `X-IliaGPT-Signature` | `sha256=<hmac-sha256-hex>` of the raw request body |
| `X-IliaGPT-Event` | Event type string (e.g., `message.created`) |
| `X-IliaGPT-Delivery` | Unique delivery UUID for deduplication |
| `X-IliaGPT-Timestamp` | Unix timestamp of this delivery attempt |

**Body envelope:**

```json
{
  "id": "wh_01abc123",
  "event": "message.created",
  "timestamp": "2026-04-11T12:00:00.000Z",
  "version": "2026-04-01",
  "data": { ... }
}
```

### Signature Verification

Compute HMAC-SHA256 of the raw request body using your webhook secret. Compare with the `sha256=` prefix stripped from `X-IliaGPT-Signature`. Always use a constant-time comparison to prevent timing attacks.

**Node.js:**

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(rawBody, secret, signatureHeader) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');

  const provided = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice(7)
    : signatureHeader;

  if (expected.length !== provided.length) return false;

  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(provided, 'hex')
  );
}

// Express handler
app.post('/webhook/iliagpt', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-iliagpt-signature'];
  if (!verifyWebhookSignature(req.body, process.env.WEBHOOK_SECRET, sig)) {
    return res.status(401).json({ error: 'Signature mismatch' });
  }
  const event = JSON.parse(req.body);
  handleEvent(event);
  res.json({ received: true });
});
```

**Python:**

```python
import hmac
import hashlib

def verify_signature(raw_body: bytes, secret: str, signature_header: str) -> bool:
    expected = hmac.new(
        secret.encode('utf-8'),
        raw_body,
        hashlib.sha256
    ).hexdigest()
    provided = signature_header.removeprefix('sha256=')
    return hmac.compare_digest(expected, provided)
```

### Retry Policy

| Attempt | Delay Before Retry |
|---------|--------------------|
| 1 (initial) | Immediate |
| 2 | 30 seconds |
| 3 | 5 minutes |
| 4 | 30 minutes |
| 5 (final) | 2 hours |

After 5 consecutive failed deliveries, the delivery is marked as permanently failed. If more than 10 consecutive deliveries fail, the webhook endpoint is automatically disabled. You will receive an email notification and can re-enable it from the dashboard.

Your endpoint must respond with a 2xx status code within 10 seconds. We recommend responding with `200 {"received": true}` immediately and processing the payload asynchronously.

### Webhook Events

#### message.created

Fired after an assistant message is fully generated and persisted.

```json
{
  "id": "wh_01abc",
  "event": "message.created",
  "timestamp": "2026-04-11T12:00:00.000Z",
  "version": "2026-04-01",
  "data": {
    "messageId": "msg_01abc",
    "chatId": "chat_01xyz",
    "userId": "user_01abc",
    "role": "assistant",
    "content": "Here is the summary you requested...",
    "model": "gpt-4o",
    "tokens": 312,
    "cost": 0.00936,
    "createdAt": "2026-04-11T12:00:02.000Z"
  }
}
```

#### agent.run.completed

Fired when an agent run finishes, whether successfully or with an error.

```json
{
  "id": "wh_01def",
  "event": "agent.run.completed",
  "timestamp": "2026-04-11T12:30:42.000Z",
  "version": "2026-04-01",
  "data": {
    "runId": "run_01xyz",
    "agentId": "agent_01abc",
    "agentName": "Research Assistant",
    "userId": "user_01abc",
    "status": "completed",
    "task": "Research the top 5 AI coding assistants...",
    "result": "## AI Coding Assistants Comparison 2026\n\n...",
    "tokensUsed": 4821,
    "cost": 0.01447,
    "durationMs": 42300,
    "toolCallCount": 8,
    "completedAt": "2026-04-11T12:30:42.000Z"
  }
}
```

#### task.completed

Fired when a scheduled task run finishes.

```json
{
  "id": "wh_01ghi",
  "event": "task.completed",
  "timestamp": "2026-04-11T08:01:23.000Z",
  "version": "2026-04-01",
  "data": {
    "runId": "taskrun_01abc",
    "taskId": "task_01abc",
    "taskName": "Daily Briefing",
    "userId": "user_01abc",
    "status": "completed",
    "durationMs": 83000,
    "triggeredBy": "schedule"
  }
}
```

#### document.processed

Fired when a document finishes processing and vector embedding.

```json
{
  "id": "wh_01jkl",
  "event": "document.processed",
  "timestamp": "2026-04-11T09:00:45.000Z",
  "version": "2026-04-01",
  "data": {
    "documentId": "doc_01abc",
    "userId": "user_01abc",
    "name": "Q1 Financial Report.pdf",
    "status": "ready",
    "chunkCount": 142,
    "pageCount": 24,
    "processingDurationMs": 44800,
    "processingError": null
  }
}
```

When `status` is `failed`, the `processingError` field contains a description of what went wrong.

---

*API version 2026.4 — Last updated April 2026*
