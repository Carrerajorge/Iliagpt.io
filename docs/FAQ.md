# IliaGPT — Frequently Asked Questions

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Usage](#usage)
3. [Development](#development)
4. [Deployment](#deployment)
5. [Enterprise](#enterprise)
6. [Troubleshooting](#troubleshooting)

---

## Getting Started

### What is IliaGPT?

IliaGPT is a full-stack AI chat platform with multi-agent orchestration, document generation, browser automation, and deep integrations with 16+ LLM providers. It goes far beyond a simple chat interface: agents can browse the web, execute code, generate Excel and Word files, query databases, and coordinate with external services like Slack, GitHub, and Notion — all from a single conversational interface.

IliaGPT ships as a web application, an Electron desktop app, and a Chrome browser extension. It is self-hostable on bare metal, Docker, or Kubernetes, and an optionally hosted cloud version is available.

### Is IliaGPT free or open source?

IliaGPT's core platform is open source under the MIT license. You can run it yourself at no cost beyond your infrastructure and LLM API key expenses. A hosted cloud version (IliaGPT Cloud) offers free and paid subscription tiers with managed infrastructure, automatic updates, and enterprise features.

### What LLM providers are supported?

IliaGPT supports 16+ providers out of the box:

| Provider | Notable Models |
|---|---|
| OpenAI | GPT-4o, o3, o4-mini |
| Anthropic | Claude 3.5 Sonnet/Haiku, Claude 3.7, Claude 4 |
| Google Gemini | Gemini 2.0 Flash, Gemini 1.5 Pro |
| xAI | Grok-2, Grok-3 |
| DeepSeek | DeepSeek-V3, DeepSeek-R1 |
| Cerebras | Llama 3.3 70B (ultra-low latency) |
| Mistral | Mistral Large, Mixtral 8x22B |
| Cohere | Command R+ |
| Groq | Llama 3 (fastest inference) |
| Together AI | Open-weight models |
| OpenRouter | Any model via unified endpoint |
| Fireworks AI | Fine-tuned and open-weight models |
| Perplexity | Online models with real-time web access |
| Azure OpenAI | Enterprise OpenAI with data residency |
| Ollama | Local open-weight models (zero cloud) |
| LM Studio | Local models via OpenAI-compatible API |

You only need at least one provider's API key to get started. The smart router handles the rest.

### What are the system requirements?

**Minimum (development):**
- Node.js 22+
- PostgreSQL 15+ with pgvector extension
- Redis 7+ (optional in development, required for production multi-instance)
- 2 GB RAM, 10 GB disk

**Recommended (production single-instance):**
- Node.js 22 LTS
- PostgreSQL 16 with pgvector
- Redis 7.2+
- 4 GB RAM, 50 GB SSD

**Python microservice (optional, for spreadsheet analysis):**
- Python 3.11+
- pip / uv

### How do I get LLM API keys?

Each provider has its own key:
- **OpenAI**: [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- **Anthropic**: [console.anthropic.com](https://console.anthropic.com)
- **Google Gemini**: [aistudio.google.com](https://aistudio.google.com) → Get API key
- **xAI**: [console.x.ai](https://console.x.ai)
- **DeepSeek**: [platform.deepseek.com](https://platform.deepseek.com)
- **Groq**: [console.groq.com](https://console.groq.com)
- **OpenRouter**: [openrouter.ai/keys](https://openrouter.ai/keys)

Set each key in your `.env` file using the variable names in `.env.example`. At minimum, set one key. The smart router will use whichever providers are configured.

### How does IliaGPT differ from ChatGPT or Claude.ai?

Several key differences:

1. **Self-hostable** — You run it on your own infrastructure. Your data never leaves your environment unless you choose a cloud provider.
2. **Multi-provider** — You are not locked into one AI company. The smart router selects the best model per request across 16+ providers.
3. **Agentic** — Agents can use 100+ tools: browse the web, write and execute code, generate Office documents, query APIs, and coordinate sub-agents in parallel.
4. **Integrable** — First-class MCP connectors for Slack, Notion, GitHub, Jira, Linear, and more — plus a webhook/cron task engine.
5. **Developer-friendly** — OpenAI-compatible REST API, TypeScript monorepo, extensible tool and connector registry.

### Can I run IliaGPT locally without any cloud LLM providers?

Yes. Set `OLLAMA_BASE_URL=http://localhost:11434` or `LMSTUDIO_BASE_URL=http://localhost:1234` in your `.env` and start Ollama or LM Studio with a local model. IliaGPT will route all requests to the local provider. Long-term memory and semantic search still require PostgreSQL + pgvector but do not send data to any cloud service.

### Is there a hosted version I can use without self-hosting?

IliaGPT Cloud is available at [iliagpt.io](https://iliagpt.io). It offers a free tier (limited daily budget) and paid Pro/Enterprise tiers with managed infrastructure, automatic updates, SSO, and priority support. Self-hosting is always an alternative for organizations with data residency or compliance requirements.

---

## Usage

### How do I use the agent to generate Excel files?

In any chat, describe what you want in plain language. For example:

> "Create an Excel spreadsheet with monthly sales data for Q1 2026 — columns for Month, Revenue, Expenses, and Net Profit. Include a totals row and format currency columns in USD."

The agent will invoke the spreadsheet generation tool, create an `.xlsx` file, and attach it to the response as a downloadable artifact. For complex analysis (pivot tables, charts, formulas), the agent delegates to the Python microservice (`fastapi_sse/`). Make sure `FASTAPI_SSE_URL` is set and the Python service is running.

### Can the agent browse the internet?

Yes, when `ENABLE_BROWSER_AUTOMATION=true` and the OpenClaw subsystem is running. The agent can:
- Navigate to URLs and extract content
- Fill in forms
- Screenshot pages
- Run multi-step web research tasks

For simple web searches without full browser automation, the web search tool uses search engine APIs directly. Set `ENABLE_BROWSER_AUTOMATION=true` in your `.env` and ensure the OpenClaw WebSocket gateway is accessible.

### How do I connect Google Drive, Slack, or other services?

IliaGPT uses the Model Context Protocol (MCP) for integrations. To connect a service:

1. Go to **Settings → Integrations** in the UI.
2. Select the connector (e.g., Slack, Notion, GitHub).
3. Complete the OAuth flow or paste your API token.
4. The connector appears as a tool available to the agent.

For self-hosted deployments, set the relevant environment variables (e.g., `SLACK_BOT_TOKEN`, `NOTION_API_KEY`) and the connectors activate automatically at startup.

### How does long-term memory work?

After each conversation ends, an async background job runs an LLM over the chat history to extract notable facts: user preferences, personal context, work details, frequently mentioned names, and similar persistent information. These facts are stored in the `user_long_term_memories` table with pgvector embeddings.

On subsequent conversations, semantically relevant memories are retrieved and injected into the system prompt before the first LLM call, so the model has context from past sessions without you needing to repeat yourself.

You can view, edit, and delete your memories at **Settings → Memory**, or via the API: `GET /api/memories` and `DELETE /api/memories/:id`.

### How do I create scheduled tasks?

Scheduled tasks combine a natural-language prompt with a cron expression or webhook trigger:

1. Go to **Agent → Scheduled Tasks → New Task**.
2. Describe what the agent should do (e.g., "Every Monday at 9am, summarize new GitHub issues from this week and post the summary to the #engineering Slack channel").
3. Set the cron expression (e.g., `0 9 * * 1`) or choose a webhook trigger.
4. Save and enable.

The task engine runs the prompt on the configured schedule using the same agent stack as manual chat. Results are logged and optionally delivered to a configured notification channel.

### What file types can be processed?

The document processing pipeline handles:

| Format | Capability |
|---|---|
| PDF | Text extraction, OCR (via vision model for scanned pages) |
| DOCX | Full text and table extraction |
| XLSX / CSV | Tabular data analysis via Python microservice |
| PPTX | Slide text extraction |
| Images (PNG, JPG, WEBP, GIF) | Vision analysis via GPT-4o / Claude Vision |
| Plain text, Markdown | Direct processing |
| Code files (.py, .ts, .js, etc.) | Syntax-aware analysis |

Maximum upload size defaults to 100 MB (configurable via `MAX_FILE_SIZE_MB`). For very large datasets, direct database or S3 ingestion is recommended over file upload.

### How do I use the code execution sandbox?

The code execution sandbox is powered by a FastAPI Python microservice. When enabled (`ENABLE_CODE_EXECUTION=true`), the agent can write and run Python code in a restricted environment with:
- 30s wall-clock timeout (`SANDBOX_TIMEOUT_MS`)
- 512 MB memory cap (`SANDBOX_MEMORY_MB`)
- No network access from within the sandbox
- Access to standard scientific libraries: pandas, numpy, matplotlib, openpyxl, etc.

To use it in chat, just ask the agent to compute something or analyze data. It will automatically write and run code when that is the most appropriate approach.

### What is Plan Mode?

Plan Mode is an agent execution pattern where the agent generates a step-by-step plan for a complex task and waits for your approval before executing. This is useful for tasks with significant side effects (sending emails, modifying files, posting to Slack).

To use Plan Mode:
1. Enable it in chat via the **Plan Mode** toggle in the chat toolbar, or prefix your message with `/plan`.
2. The agent outputs a numbered plan.
3. Review each step and approve, edit individual steps, or reject the entire plan.
4. On approval, the agent executes the approved plan with live progress indicators.

---

## Development

### How do I add a new LLM provider?

1. Create a provider adapter in `server/llm/providers/` following the interface in `server/llm/types.ts`.
2. Implement the `complete()` and `stream()` methods, mapping the provider's API response to the internal `LLMResponse` type.
3. Register the provider in `server/llm/gateway.ts` — add it to the provider registry object and the fallback chain configuration.
4. Add the provider's API key variable to `.env.example` and to the Zod schema in `server/config/env.ts`.
5. Add the provider to the `SUPPORTED_PROVIDERS` list in `shared/schema.ts`.
6. Write tests in `server/llm/providers/__tests__/` following the existing pattern.

### How do I create a custom tool?

Tools are defined in `server/agent/tools/`. Each tool exports a `ToolDefinition` object with:
- `name`: unique string identifier
- `description`: natural-language description the LLM sees
- `schema`: Zod schema defining input parameters
- `execute(input, context)`: async handler returning structured output

After defining the tool, register it in `server/agent/toolRegistry.ts`. The tool will then be available to all agents. Set `requiresApproval: true` in the definition if the tool should prompt the user before execution in Plan Mode.

### How do I add an MCP connector?

MCP connectors live in `server/mcp/connectors/`. Each connector is a directory with:
- `manifest.json` — connector metadata, required environment variables, OAuth scopes
- `index.ts` — exports an array of tool definitions (same interface as custom tools)
- `auth.ts` — OAuth handler or API key validation logic

Add your connector directory and register it in `server/mcp/registry.ts`. The connector's tools become available when the user authenticates the connector in Settings.

### How do I write tests for agents?

Agent tests live under `server/agent/__tests__/`. Use the test harness in `server/agent/testUtils.ts` which provides:
- `createTestAgent(config)` — instantiates an agent with a mock LLM provider
- `MockLLMProvider` — responds with scripted tool calls and messages
- `assertToolCalled(agentRun, toolName, inputMatcher)` — assertion helper

For integration tests that run against real providers, use the `test:agentic:integration` script (requires real API keys). For unit tests that run in CI without API keys, mock all provider calls.

### How do I run only specific tests?

```bash
# Run a single test file
npx vitest run server/agent/__tests__/planMode.test.ts

# Run all tests matching a pattern
npx vitest run --reporter=verbose server/llm

# Run client component tests only
npm run test:client

# Run E2E tests matching a pattern
npx playwright test --grep "browser automation"
```

### How does streaming work?

Chat responses stream via Server-Sent Events (SSE). The flow is:

1. Client opens `GET /api/chats/:id/messages/stream` — an SSE connection with a 60s idle timeout.
2. Server publishes chunks to a Redis pub/sub channel keyed by chat ID.
3. The SSE handler subscribes to Redis and forwards chunks to the client as SSE events.
4. On multi-instance deployments, any server instance can receive chunks from any other instance via Redis.
5. WebSocket is available as a fallback for environments that do not support SSE (some proxies, older Safari versions).

The `streamingStore` Zustand store on the client accumulates incoming tokens and triggers React re-renders at 60fps using `requestAnimationFrame` batching.

---

## Deployment

### What database is required?

PostgreSQL 15 or higher with the `pgvector` extension is required. The pgvector extension enables the 1536-dimensional vector similarity search used by long-term memory and hybrid search. Standard PostgreSQL (without pgvector) will start but long-term memory and semantic search will be disabled.

Run `npm run db:bootstrap` before starting the server — this ensures the pgvector extension is created and all Drizzle migrations are applied.

### How do I deploy with Docker?

A `docker-compose.yml` is provided in the repository root for local development. For production:

```bash
# Build the image
docker build -t iliagpt:latest .

# Run with environment variables
docker run -d \
  --env-file .env \
  -p 5000:5000 \
  iliagpt:latest
```

The production image runs `npm start` (compiled `dist/index.cjs`). Run migrations before starting: `docker run --env-file .env iliagpt:latest npm run db:migrate:prod`.

A Helm chart for Kubernetes is on the roadmap for v1.3.0.

### Can I use managed PostgreSQL (RDS, Supabase, Neon)?

Yes. Set `DATABASE_URL` to your managed database connection string. For read replicas (RDS read endpoints, Supabase read replicas), also set `DATABASE_READ_URL`. IliaGPT routes SELECT queries to the read replica automatically.

You must enable the pgvector extension before running migrations. On RDS: `CREATE EXTENSION IF NOT EXISTS vector;` (requires RDS PostgreSQL 15+ with pgvector support). On Supabase: pgvector is pre-installed. On Neon: pgvector is available as a first-party extension.

### How do I set up pgvector?

On a self-managed PostgreSQL instance:

```sql
-- Connect as superuser
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify
SELECT * FROM pg_extension WHERE extname = 'vector';
```

Then run `npm run db:bootstrap` which will run migrations including the vector column definitions. If pgvector is not available on your database host, set `ENABLE_LONG_TERM_MEMORY=false` to disable features that depend on it.

### How do I configure Redis?

Set `REDIS_URL=redis://localhost:6379` (or `rediss://` for TLS). Redis is used for:
- SSE streaming coordination across instances (pub/sub)
- Rate limiting counters
- LLM response caching (deduplication)
- Session storage (optional, `connect-redis`)

In development, Redis is optional — the server will log a warning and fall back to in-process state for single-instance use. In production, Redis is strongly recommended for reliability and horizontal scaling.

For Redis with authentication: `redis://:password@host:6379`. For Redis Cluster or Sentinel, set `REDIS_URL` to the primary endpoint; cluster-mode configuration is in `server/redis.ts`.

### How do I handle SSL / TLS?

IliaGPT does not terminate TLS natively. Place a reverse proxy in front of the server:
- **nginx**: Use `proxy_pass http://localhost:5000;` with Let's Encrypt via certbot.
- **Caddy**: `reverse_proxy localhost:5000` — Caddy handles HTTPS automatically.
- **Traefik**: Standard Docker label configuration; see the `docker-compose.prod.yml` example.

Set `APP_URL=https://your-domain.com` and `TRUST_PROXY=true` in `.env` so that Express correctly reads `X-Forwarded-Proto` headers for redirect URI generation in OAuth flows.

### How do I scale horizontally?

IliaGPT is stateless across instances when Redis is configured. To scale:

1. Run multiple instances of the Node.js server (Docker replicas, Kubernetes Deployment).
2. Ensure all instances share the same `DATABASE_URL`, `REDIS_URL`, and `SESSION_SECRET`.
3. Put a load balancer in front with sticky sessions disabled (session state is in PostgreSQL via `connect-pg-simple`).
4. The SSE/WebSocket streaming layer uses Redis pub/sub to fan out messages — any instance can serve any client.

For database scaling, configure `DATABASE_READ_URL` to point to a read replica. Write queries (`INSERT`, `UPDATE`, `DELETE`) always go to the primary.

---

## Enterprise

### What enterprise features are available?

IliaGPT Enterprise includes:
- **RBAC** — role-based access control with workspace admin, member, and viewer roles
- **SSO** — Google Workspace, Microsoft Azure AD via OAuth; SAML 2.0 planned for v1.3.0
- **Budget enforcement** — configurable daily USD spending caps per user tier
- **Audit logging** — structured logs for all agent actions, tool calls, and admin operations
- **API key management** — create, rotate, and revoke API keys with per-key rate limits and scopes
- **Read replica routing** — automatic query routing for high-read workloads
- **Priority support** — SLA tiers with named CSM (via IliaGPT Cloud Enterprise plan)

### How does RBAC work?

IliaGPT has three workspace roles:

| Role | Capabilities |
|---|---|
| **Admin** | Manage users, configure integrations, view usage analytics, manage API keys, set budgets |
| **Member** | Create and manage their own chats, use all enabled capabilities, create scheduled tasks |
| **Viewer** | Read-only access to shared chats; cannot initiate agent actions or create tasks |

Roles are assigned in **Settings → Team → Members**. The API enforces roles via middleware in `server/middleware/rbac.ts`. Custom role definitions are on the enterprise roadmap.

### How do I enforce spending limits?

Set the following environment variables to configure daily USD budget caps per user tier:

```env
FREE_DAILY_BUDGET_USD=0.50
PRO_DAILY_BUDGET_USD=5.00
ENTERPRISE_DAILY_BUDGET_USD=50.00
```

When a user's cumulative spend for the calendar day reaches their tier's limit, subsequent LLM requests return a `429 Budget Exceeded` error with a retry time. Spend is tracked per user in the database and reset at midnight UTC. Admins can view spend in **Settings → Usage**.

### Is there SSO / SAML support?

OAuth SSO via Google Workspace and Microsoft Azure AD is available today — configure `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` or `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`. Auth0 is also supported as a universal SSO broker.

SAML 2.0 and SCIM 2.0 for automated provisioning/deprovisioning are planned for v1.3.0 (Q3 2026). If your organization requires SAML urgently, contact the team via the enterprise inquiry form on the website.

### How do I get a SLA?

SLA commitments (99.9% or 99.95% uptime, incident response time targets) are available on IliaGPT Cloud Enterprise plans. For self-hosted deployments, SLA guarantees are not applicable since we do not control your infrastructure, but we provide deployment reference architectures, health check endpoints (`GET /health`), and runbooks for common failure scenarios.

Contact sales via the website or by opening an enterprise inquiry issue in the repository to discuss SLA options.

---

## Troubleshooting

### The server fails to start — what do I check?

Work through this checklist in order:

1. **Node version**: Run `node --version`. Requires Node 22+.
2. **Environment variables**: Run `npm run check` — if the Zod env validator fails, it will print which variables are missing or invalid.
3. **Database connection**: Verify `DATABASE_URL` is correct and PostgreSQL is running: `psql $DATABASE_URL -c "SELECT 1;"`.
4. **Migrations**: Run `npm run db:bootstrap`. If migrations fail, check the error output for schema conflicts.
5. **pgvector**: If you see `extension "vector" does not exist`, run `CREATE EXTENSION IF NOT EXISTS vector;` as a superuser.
6. **Port conflict**: If port 5000 is in use, change `PORT` in `.env` and restart.
7. **Log level**: Set `LOG_LEVEL=debug` and restart to get verbose startup logs.

### LLM calls are failing — how do I debug?

1. **Verify API keys**: Check that the relevant `*_API_KEY` variables are set and not expired.
2. **Check the circuit breaker**: If a provider had 3+ consecutive failures, it enters a 5-minute cooldown. Check server logs for `[SmartRouter] Circuit open for provider:` messages.
3. **Enable debug logging**: Set `LOG_LEVEL=debug` — the gateway logs the full request/response for each LLM call.
4. **Test a provider directly**: Use `curl` or the provider's playground to confirm the key is working outside IliaGPT.
5. **Check your budget**: If the user's daily budget is exhausted, all LLM calls return 429. Check `GET /api/usage` in the API.
6. **Inspect network requests**: In the browser dev tools, look at the Network tab for failed SSE or API calls and read the response body for error messages.

### Database connection errors

Common causes and fixes:

- **`ECONNREFUSED`**: PostgreSQL is not running. Start it with `pg_ctl start` or `brew services start postgresql`.
- **`password authentication failed`**: The user/password in `DATABASE_URL` is wrong. Verify with `psql $DATABASE_URL`.
- **`database "iliagpt" does not exist`**: Create it: `createdb iliagpt`.
- **SSL required**: Add `?sslmode=require` to `DATABASE_URL` for managed databases that require SSL.
- **Too many connections**: Increase `max_connections` in `postgresql.conf` or reduce the connection pool size in `server/db.ts`.

### "Budget exceeded" errors

If you see `429 Budget Exceeded` responses:

- The user's daily spending limit has been reached. The limit resets at midnight UTC.
- Increase the limit by raising `FREE_DAILY_BUDGET_USD`, `PRO_DAILY_BUDGET_USD`, or `ENTERPRISE_DAILY_BUDGET_USD` in `.env` and restarting.
- Check the user's actual spend for the day: `GET /api/usage` (admin endpoints show all users).
- If you want to disable budget enforcement entirely, set all three budget variables to a very large number (e.g., `9999`). There is no `DISABLE_BUDGET_ENFORCEMENT` flag — budget enforcement is always active.

### Tests are failing — common fixes

1. **Database**: Integration and E2E tests require a running PostgreSQL instance. Set `DATABASE_URL` in your shell or `.env.test`.
2. **Missing API keys**: Tests that call real providers require the relevant API key. CI tests use mocks — check the test file to see if it is marked `skipIf(!process.env.OPENAI_API_KEY)`.
3. **Port conflicts**: E2E tests start a server on a test port. Ensure nothing else is using that port.
4. **Stale build**: Run `npm run build` before running tests if you see import errors on compiled files.
5. **Vitest cache**: Clear the Vitest cache with `npx vitest --clearCache` and retry.
6. **Individual test**: Narrow down with `npx vitest run path/to/failing.test.ts --reporter=verbose` to get full output.

### Memory usage is high — how to diagnose

1. **Heap profiling**: Set `NODE_OPTIONS=--max-old-space-size=4096` to increase the V8 heap limit temporarily and capture a heap snapshot via `node --inspect`.
2. **SSE connections**: Each open SSE connection holds a response stream in memory. Check for unclosed connections — clients that navigate away without closing the connection. The 60s idle timeout should clean these up, but verify with `GET /api/admin/connections` (admin only).
3. **Agent context**: Very long conversations accumulate large `messages` arrays in the agent state. The automatic summarization threshold is configurable via `AGENT_CONTEXT_SUMMARY_THRESHOLD` (default 50 messages).
4. **Redis memory**: If Redis is running out of memory, check for unbounded list growth. The LLM response cache uses a TTL — verify that cache TTL (`CACHE_TTL_SECONDS`, default 300) is not set excessively high.
5. **Embeddings**: The pgvector embedding pipeline runs async and should not block the main thread, but if it is backed up, check the async queue depth in the logs.
