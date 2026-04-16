```
██╗██╗     ██╗ █████╗  ██████╗ ██████╗ ████████╗   ██╗ ██████╗
██║██║     ██║██╔══██╗██╔════╝ ██╔══██╗╚══██╔══╝   ██║██╔═══██╗
██║██║     ██║███████║██║  ███╗██████╔╝   ██║      ██║██║   ██║
██║██║     ██║██╔══██║██║   ██║██╔═══╝    ██║      ██║██║   ██║
██║███████╗██║██║  ██║╚██████╔╝██║        ██║      ██║╚██████╔╝
╚═╝╚══════╝╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝        ╚═╝      ╚═╝ ╚═════╝
```

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/Carrerajorge/Iliagpt.io/actions/workflows/ci.yml/badge.svg)](https://github.com/Carrerajorge/Iliagpt.io/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/badge/coverage-85%25-brightgreen)](https://github.com/Carrerajorge/Iliagpt.io)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org/)
[![Contributors](https://img.shields.io/github/contributors/Carrerajorge/Iliagpt.io)](https://github.com/Carrerajorge/Iliagpt.io/graphs/contributors)
[![Stars](https://img.shields.io/github/stars/Carrerajorge/Iliagpt.io?style=social)](https://github.com/Carrerajorge/Iliagpt.io/stargazers)

**The AI-native workspace where every capability — file generation, browser automation, multi-agent orchestration — works with any LLM.**

[Quick Start](#quick-start) • [Features](#features) • [Architecture](#architecture-overview) • [Providers](#supported-llm-providers) • [Docs](docs/) • [Contributing](docs/CONTRIBUTING.md)

</div>

---

## What is IliaGPT?

IliaGPT is a production-grade, full-stack AI platform that turns any LLM into an autonomous workspace. It ships as a web application, Electron desktop app, and Chrome extension — all sharing one backend and one database.

Where most AI tools give you a chatbox, IliaGPT gives you an **AI coworker** that can generate Excel files, browse the web, execute Python code, coordinate sub-agents in parallel, connect to your SaaS tools through MCP connectors, and remember context across sessions — all without leaving the interface.

The platform is built model-agnostic from the ground up. Every capability works equally well whether you wire it to Claude 3.5 Sonnet, GPT-4o, Gemini 2.0, Grok, DeepSeek, or a locally running Llama 3 model via Ollama.

---

## Why IliaGPT?

| Capability | IliaGPT | ChatGPT Plus | GitHub Copilot | Cursor | CrewAI |
|---|---|---|---|---|---|
| Multi-provider (16+ LLMs) | Yes | No (OpenAI only) | No (OpenAI only) | No (limited) | Partial |
| File generation (Excel, PPT, Word, PDF) | Yes | Partial | No | No | No |
| Browser automation (real Playwright) | Yes | Limited | No | No | No |
| Code execution sandbox (Python + Node) | Yes | Yes (OpenAI only) | No | Partial | No |
| Long-term memory across sessions | Yes | Yes (OpenAI only) | No | No | No |
| Multi-agent orchestration (LangGraph) | Yes | No | No | No | Yes |
| Sub-agent parallel task decomposition | Yes | No | No | No | Yes |
| Scheduled / cron tasks | Yes | No | No | No | No |
| MCP connector ecosystem | Yes | No | No | No | No |
| RAG over your own documents | Yes | Limited | No | Partial | No |
| Electron desktop app | Yes | No | No | Yes | No |
| Chrome extension | Yes | Extension | Extension | No | No |
| Self-hosted / on-premise | Yes | No | No | No | Yes |
| OpenAI-compatible API endpoint | Yes | N/A | No | No | No |
| Real-time presence & typing indicators | Yes | No | No | No | No |
| Enterprise RBAC & spending limits | Yes | Team plan | Enterprise | No | No |

---

## Quick Start

### Prerequisites

- **Node.js** 22 or later
- **PostgreSQL** 16 with the `pgvector` extension
- **Redis** 7+
- At least one LLM API key (Anthropic, OpenAI, Google, etc.)

### Installation

```bash
git clone https://github.com/Carrerajorge/Iliagpt.io
cd Iliagpt.io
cp .env.example .env
# Edit .env with your API keys and DATABASE_URL
npm install
npm run db:bootstrap
npm run dev
```

The API server starts on **port 5000** by default. Open `http://localhost:5000` in your browser.

### Docker Quick Start

```bash
# Clone and configure
git clone https://github.com/Carrerajorge/Iliagpt.io
cd Iliagpt.io
cp .env.example .env
# Edit .env

# Build and start all services
docker compose up --build

# Run database migrations
docker compose exec app npm run db:bootstrap
```

The `docker-compose.yml` includes the Node.js app, PostgreSQL 16 with pgvector, and Redis 7.

### Desktop App

```bash
npm run dev:desktop   # Starts server + Vite + Electron together
```

---

## Features

IliaGPT organises its capabilities into 18 categories:

| # | Category | Description |
|---|---|---|
| 1 | **File Generation** | Excel (.xlsx), PowerPoint (.pptx), Word (.docx), PDF, Markdown, HTML, JSX components, LaTeX, CSV, JSON, PNG charts |
| 2 | **File Management** | Read/write files, organise folders, mass rename, deduplication, intelligent classify, delete protection |
| 3 | **Data Analysis** | Descriptive statistics, ML pipeline generation, data cleaning, chart visualisation, time-series forecasting, PDF-to-Excel extraction |
| 4 | **Research & Synthesis** | Multi-document synthesis, live web research, citation management, executive summaries, competitive analysis |
| 5 | **Format Conversion** | PDF to PPT, meeting notes to document, CSV to formatted Excel, Word to PowerPoint, screenshots to spreadsheet |
| 6 | **Browser Automation** | Navigate URLs, click elements, fill forms, capture screenshots, extract content, execute arbitrary JavaScript |
| 7 | **Computer Use** | Open applications, fill spreadsheets, complete multi-step forms, handle permission workflows |
| 8 | **Scheduled Tasks** | Cron-based task scheduling, daily/weekly/monthly cadences, on-demand saved task library |
| 9 | **Dispatch to Mobile** | Send tasks from web/desktop to iOS or Android, persistent execution threads |
| 10 | **MCP Connectors** | Google Drive, Gmail, DocuSign, Zoom, Slack, Jira, Asana, Notion, GitHub, Linear, and extensible connector registry |
| 11 | **Plugins & Skills** | Marketplace, domain-specific plugins, skill creator UI, custom system instruction sets |
| 12 | **Code Execution** | Python and Node.js sandboxes with matplotlib/pandas/numpy support, automation scripts, VM isolation per session |
| 13 | **Sub-Agents** | Automatic task decomposition, parallel multi-agent coordination, long-running background tasks with progress reporting |
| 14 | **Cowork Projects** | Persistent project workspaces, per-project state and memory, recurring work templates |
| 15 | **Security** | Folder-level authorisation, VM isolation, network egress controls, action approval gates, delete protection policies |
| 16 | **Enterprise** | Role-based access control (RBAC), per-user spending limits, analytics API, OpenTelemetry tracing, per-connector access controls |
| 17 | **Vertical Use Cases** | Pre-built templates for Legal, Finance, Marketing, Operations, HR, and Research domains |
| 18 | **Platform Availability** | macOS, Windows, mobile dispatch, configurable file size limits, Chrome extension |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      CLIENT LAYER                               │
│  React 19 SPA (Vite)  │  Electron Desktop  │  Chrome Extension  │
│       Zustand stores + TanStack Query + Wouter routing          │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTP / SSE / WebSocket
┌──────────────────────────────▼──────────────────────────────────┐
│                    API GATEWAY (Express.js)                      │
│  Auth middleware (Passport.js)  │  Rate limiting (Redis)        │
│  CSRF protection  │  Helmet security headers  │  SSRF guard      │
└──────────┬─────────────────────────────────┬────────────────────┘
           │                                 │
┌──────────▼──────────┐         ┌────────────▼───────────────────┐
│   SERVICE LAYER     │         │      REAL-TIME LAYER           │
│  Chat  │  Agent     │         │  SSE streaming  │  WebSocket   │
│  Doc   │  Task      │         │  Redis pub/sub (multi-inst.)   │
│  Search│  Memory    │         └────────────────────────────────┘
└──────────┬──────────┘
           │
┌──────────▼──────────────────────────────────────────────────────┐
│                     LLM GATEWAY                                  │
│  Smart Router (complexity detection + circuit breakers)          │
│  Multi-provider abstraction (16+ providers)                      │
│  Budget enforcement  │  Token tracking  │  Response caching      │
└──────────┬──────────────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────────┐
│                  AGENT ORCHESTRATION (LangGraph)                 │
│  Cognitive kernel  │  Tool registry (100+ tools)                 │
│  Specialized agents: deep-research, coding, browser, file, data  │
│  Plan Mode  │  Sub-agent coordination  │  Memory injection       │
└──────────┬──────────────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────────┐
│                       DATA LAYER                                 │
│  PostgreSQL 16 + pgvector  │  Redis  │  File storage            │
│  Drizzle ORM  │  Migrations  │  Read replica support            │
└─────────────────────────────────────────────────────────────────┘
```

For the full architecture deep-dive, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Supported LLM Providers

| Provider | Example Models | API Key Env Var | Notes |
|---|---|---|---|
| **Anthropic** | claude-opus-4, claude-sonnet-4-5, claude-haiku-3-5 | `ANTHROPIC_API_KEY` | Primary recommended provider |
| **OpenAI** | gpt-4o, gpt-4o-mini, o1, o3-mini | `OPENAI_API_KEY` | Full streaming + function calling |
| **Google Gemini** | gemini-2.0-flash, gemini-1.5-pro, gemini-ultra | `GOOGLE_GENERATIVE_AI_API_KEY` | Native multimodal support |
| **xAI (Grok)** | grok-2, grok-2-vision | `XAI_API_KEY` | Real-time web knowledge |
| **DeepSeek** | deepseek-chat, deepseek-reasoner | `DEEPSEEK_API_KEY` | Cost-effective, strong at code |
| **Cerebras** | llama3.1-70b, llama3.1-8b | `CEREBRAS_API_KEY` | Ultra-low latency inference |
| **Mistral** | mistral-large, mistral-medium, codestral | `MISTRAL_API_KEY` | Strong European provider |
| **Cohere** | command-r-plus, command-r | `COHERE_API_KEY` | RAG-optimised with grounding |
| **Groq** | llama-3.3-70b, mixtral-8x7b | `GROQ_API_KEY` | Hardware-accelerated, very fast |
| **Together AI** | llama-3.1-405b, qwen-72b | `TOGETHER_API_KEY` | Open-weight model hosting |
| **Perplexity** | sonar-pro, sonar-reasoning | `PERPLEXITY_API_KEY` | Built-in web search |
| **Fireworks AI** | firefunction-v2, llama-v3p1-70b | `FIREWORKS_API_KEY` | Fast fine-tuned model serving |
| **OpenRouter** | Any model via unified API | `OPENROUTER_API_KEY` | Access 200+ models through one key |
| **Azure OpenAI** | GPT-4o, GPT-4-turbo (Azure-hosted) | `AZURE_OPENAI_API_KEY` | Enterprise compliance, private VNet |
| **Ollama** | llama3, mistral, codellama, phi3 | None required | Fully local, no data leaves machine |
| **LM Studio** | Any GGUF model | None required | Local OpenAI-compatible server |

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend framework** | React 19 | Component model, concurrent rendering |
| **Frontend build** | Vite 6 | Sub-second HMR, optimised production bundles |
| **Routing** | Wouter | Lightweight client-side routing |
| **State management** | Zustand | Chat, agent, streaming, and artifact stores |
| **Server state** | TanStack Query | Data fetching, caching, and background sync |
| **UI components** | shadcn/ui + Radix Primitives | Accessible, composable component library |
| **Styling** | TailwindCSS 4 | Utility-first CSS with design token system |
| **Backend framework** | Express.js | HTTP server, middleware pipeline, SSE |
| **Database** | PostgreSQL 16 + pgvector | Relational data + 1536-dim vector embeddings |
| **Cache / pub-sub** | Redis 7 | Rate limiting, session cache, multi-instance SSE |
| **ORM** | Drizzle ORM | Type-safe SQL queries, schema migrations |
| **Schema validation** | Zod | Runtime validation at all API boundaries |
| **Agent orchestration** | LangGraph + LangChain | DAG-based agent coordination, tool calling |
| **Browser automation** | Playwright | Real browser automation for web tasks |
| **Code sandbox** | FastAPI + Python 3.11 | Isolated Python/Node execution environment |
| **Authentication** | Passport.js | Google OAuth, Microsoft OAuth, Auth0 |
| **Desktop** | Electron | Cross-platform desktop wrapper |
| **Testing** | Vitest + Playwright | Unit, integration, and end-to-end tests |
| **i18n** | 103 locale files | Internationalisation coverage |
| **Observability** | OpenTelemetry | Distributed tracing and metrics |

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values below. All variables are validated on startup by `server/config/env.ts` — the server will refuse to start if required variables are missing.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (`postgresql://user:pass@host:5432/dbname`) |
| `SESSION_SECRET` | Yes | Random string (32+ chars) for session signing — generate with `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | One LLM key required | Anthropic Claude API key |
| `OPENAI_API_KEY` | One LLM key required | OpenAI API key |
| `GOOGLE_GENERATIVE_AI_API_KEY` | One LLM key required | Google Gemini API key |
| `REDIS_URL` | Recommended | Redis connection string (defaults to `redis://localhost:6379`) |
| `DATABASE_READ_URL` | Optional | Read replica for PostgreSQL (falls back to `DATABASE_URL`) |
| `GOOGLE_CLIENT_ID` | For Google OAuth | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | For Google OAuth | Google OAuth 2.0 client secret |
| `MICROSOFT_CLIENT_ID` | For Microsoft OAuth | Azure AD application client ID |
| `MICROSOFT_CLIENT_SECRET` | For Microsoft OAuth | Azure AD application client secret |
| `AUTH0_DOMAIN` | For Auth0 | Auth0 tenant domain |
| `AUTH0_CLIENT_ID` | For Auth0 | Auth0 application client ID |
| `PORT` | Optional | HTTP server port (default: `5000`) |
| `NODE_ENV` | Optional | `development` or `production` (default: `development`) |
| `LOG_LEVEL` | Optional | `error`, `warn`, `info`, `debug` (default: `info`) |
| `MAX_FILE_SIZE_MB` | Optional | Maximum upload file size in megabytes (default: `50`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Optional | OpenTelemetry collector endpoint for tracing |
| `SMTP_HOST` | Optional | SMTP server for email notifications |
| `SMTP_PORT` | Optional | SMTP port (default: `587`) |

A complete list of all 100+ supported environment variables is in `server/config/env.ts`.

---

## Screenshots

### Main Chat Interface
![Chat Interface](docs/assets/demo.png)

### Agent Plan Mode — Step-by-step execution preview
![Plan Mode](docs/assets/plan-mode.png)

### File Generation — Excel, PPT, Word, PDF
![File Generation](docs/assets/file-generation.png)

### Browser Automation — Live web task execution
![Browser Automation](docs/assets/browser-automation.png)

### MCP Connectors — Google Drive, Slack, GitHub, Jira
![MCP Connectors](docs/assets/mcp-connectors.png)

### Cowork Projects — Persistent AI workspaces
![Cowork Projects](docs/assets/cowork-projects.png)

---

## Detailed Installation

### Step 1 — Clone the Repository

```bash
git clone https://github.com/Carrerajorge/Iliagpt.io
cd Iliagpt.io
```

### Step 2 — Configure Environment

```bash
cp .env.example .env
```

Open `.env` in your editor and set at minimum:

```dotenv
DATABASE_URL=postgresql://postgres:password@localhost:5432/iliagpt
SESSION_SECRET=your-32-char-random-secret-here
ANTHROPIC_API_KEY=sk-ant-...
```

### Step 3 — Install Dependencies

```bash
npm install
```

This installs all Node.js dependencies for the server, client, and desktop app. The FastAPI microservice (`fastapi_sse/`) has its own Python dependencies managed via `uv`:

```bash
cd fastapi_sse
uv sync
cd ..
```

### Step 4 — Initialize the Database

```bash
npm run db:bootstrap
```

This command:
1. Enables the `pgvector` extension on your PostgreSQL database
2. Runs all Drizzle ORM migrations to create tables, indexes, and constraints
3. Seeds any required baseline data

### Step 5 — Start Development Servers

```bash
# Web app (API on port 5000, Vite HMR on port 5173)
npm run dev

# Or: Desktop app (server + client + Electron)
npm run dev:desktop
```

---

## Configuration

### Selecting the Default LLM

The Smart Router (`server/llm/smartRouter.ts`) automatically selects the best available model based on query complexity and provider health. You can override the default model tier via environment variables:

```dotenv
DEFAULT_MODEL_SIMPLE=claude-haiku-3-5
DEFAULT_MODEL_MEDIUM=claude-sonnet-4-5
DEFAULT_MODEL_COMPLEX=claude-opus-4
```

### Configuring Agent Tools

The tool registry lives in `server/agent/tools/`. Each tool is a TypeScript module that implements the `AgentTool` interface. Tools are auto-discovered at startup. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#tool-registry) for the extension protocol.

### Configuring MCP Connectors

MCP (Model Context Protocol) connectors are declared in `mcp_servers.json`. Each entry specifies the connector name, transport type, authentication method, and capability scopes:

```json
{
  "connectors": [
    {
      "name": "google-drive",
      "transport": "oauth2",
      "scopes": ["drive.readonly", "drive.file"],
      "authUrl": "https://accounts.google.com/o/oauth2/v2/auth"
    }
  ]
}
```

### Redis Configuration

By default, Redis is required for:
- Rate limiting (per-user token bucket)
- Session caching
- Multi-instance SSE pub/sub
- Background job queue

If Redis is not available, rate limiting falls back to in-memory (single instance only) and multi-instance streaming is disabled.

---

## Development Commands

| Command | Description |
|---|---|
| `npm run dev` | Start Express API server with hot reload (port 5000) |
| `npm run dev:client` | Start Vite frontend dev server only (port 5173) |
| `npm run dev:desktop` | Full desktop: server + client + Electron together |
| `npm run build` | Compile server (esbuild) + client (Vite) to `dist/` |
| `npm start` | Start production server from compiled `dist/index.cjs` |
| `npm run db:bootstrap` | Enable pgvector + run all Drizzle migrations |
| `npm run db:push` | Push schema changes (dev only, no migration file) |
| `npm run db:migrate` | Run Drizzle migrations |
| `npm run db:migrate:prod` | Run migrations from compiled dist (production) |
| `npm run lint` | Run ESLint across all TypeScript/JavaScript files |
| `npm run check` | TypeScript type-check (standard heap) |
| `npm run type-check` | Extended TypeScript type-check (8 GB heap) |
| `npm run verify:i18n` | Check i18n coverage and run locale tests |

---

## Testing

IliaGPT has a multi-layer test suite:

### Unit and Integration Tests (Vitest)

```bash
npm run test:run                  # All unit + integration tests
npm run test:ci:chat-core         # Core chat tests (used in CI)
npm run test:client               # React component tests (jsdom)
npm run test:agentic              # Agent system tests
npm run test:agentic:integration  # Agentic integration tests
```

Run a single test file:

```bash
npx vitest run server/llm/__tests__/smartRouter.test.ts
```

### End-to-End Tests (Playwright)

```bash
npm run test:e2e     # Full Playwright browser tests
npm run test:smoke   # Smoke test suite (faster subset)
```

### Full Verification

```bash
npm run verify   # Runs scripts/agent-verify.sh — linting + type-check + all tests
```

### CI

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs on Node 22 with a 25-minute timeout, executing `test:ci:chat-core` and `test:client`. The full test suite can be triggered manually.

---

## Docker Quick Start

The repository includes a production-ready `Dockerfile` and a `docker-compose.yml` that orchestrates:

- `app` — the IliaGPT Node.js server
- `postgres` — PostgreSQL 16 with the pgvector extension pre-installed
- `redis` — Redis 7 for caching and pub/sub

```bash
# Build and start
docker compose up --build -d

# Run migrations
docker compose exec app npm run db:bootstrap

# View logs
docker compose logs -f app

# Stop everything
docker compose down
```

For production deployments, set `NODE_ENV=production` and supply all required environment variables through your orchestration platform's secret management (e.g., Kubernetes Secrets, AWS Secrets Manager, Doppler).

---

## Project Structure

```
Iliagpt.io/
├── client/                     # React 19 + Vite frontend
│   └── src/
│       ├── components/         # UI components (shadcn/ui, artifacts, chat)
│       ├── hooks/              # Custom React hooks
│       ├── locales/            # 103 i18n locale files
│       ├── pages/              # Page-level components (Wouter routes)
│       └── stores/             # Zustand state stores
├── server/                     # Express.js backend
│   ├── agent/                  # Agent orchestration (LangGraph)
│   │   ├── browser/            # Playwright browser automation agent
│   │   ├── langgraph/          # DAG agent definitions
│   │   ├── pipeline/           # LLM + tool execution pipeline
│   │   ├── superAgent/         # Self-improving agent behaviour
│   │   └── tools/              # 100+ registered agent tools
│   ├── api/v1/                 # OpenAI-compatible REST API
│   ├── config/                 # Environment config validation (Zod)
│   ├── llm/                    # LLM gateway + smart router
│   ├── memory/                 # Long-term memory (pgvector)
│   ├── realtime/               # Presence + typing indicators
│   ├── search/                 # Hybrid search (full-text + semantic)
│   └── openclaw-src/           # Browser control subsystem
├── shared/                     # Shared types, Drizzle schemas, Zod validators
│   └── schema.ts               # ~3300 lines — all DB tables + insert schemas
├── fastapi_sse/                # Python microservice — code execution sandbox
├── desktop/                    # Electron wrapper
├── extension/                  # Chrome browser extension
├── e2e/                        # Playwright E2E tests
├── migrations/                 # Drizzle-generated SQL migration files
├── docs/                       # Extended documentation
└── scripts/                    # Build, verify, and utility scripts
```

---

## OpenAI-Compatible API

IliaGPT exposes a drop-in OpenAI API replacement at `/v1/`. You can point any OpenAI SDK client at IliaGPT by changing the base URL:

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://your-iliagpt-instance.com/v1',
  apiKey: 'ilgpt_your_api_key_here',
});

const response = await client.chat.completions.create({
  model: 'claude-sonnet-4-5',
  messages: [{ role: 'user', content: 'Summarise this document' }],
  stream: true,
});
```

### Available Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/chat/completions` | Chat completions (streaming and non-streaming) |
| `POST` | `/v1/embeddings` | Generate 1536-dimensional embeddings |
| `GET` | `/v1/models` | List available models |

API keys are created in the IliaGPT dashboard and have the format `ilgpt_...`. Rate limiting and budget enforcement apply per key.

---

## Contributing

We welcome contributions of all kinds — bug reports, feature requests, documentation improvements, and code.

1. Fork the repository and create a feature branch from `main`
2. Install dependencies: `npm install`
3. Make your changes with appropriate tests
4. Run `npm run verify` to confirm everything passes
5. Submit a pull request with a clear description

Please read [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for the full contributing guide, including commit message conventions (Conventional Commits, enforced via commitlint + husky), branch naming, and the PR review process.

---

## Security

If you discover a security vulnerability, please do **not** open a public GitHub issue. Instead, follow the responsible disclosure process described in [docs/SECURITY.md](docs/SECURITY.md).

IliaGPT includes several built-in security layers:
- Helmet for HTTP security headers
- CSRF protection on all state-mutating endpoints
- Redis-backed rate limiting
- SSRF protection on all outbound HTTP requests made by agents
- Prompt injection detection before LLM calls
- DOMPurify output sanitisation on rendered content
- VM isolation for code execution sandboxes
- Folder-level authorisation for file system operations

---

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full roadmap. Highlights planned:

- Voice interface (speech-to-text + text-to-speech)
- Native iOS and Android apps
- Expanded MCP connector registry (Salesforce, HubSpot, Confluence, Figma)
- Multi-tenant workspace isolation
- Fine-tuning pipeline for domain adaptation
- On-device model support (WebGPU + WASM)

---

## License

IliaGPT is released under the [MIT License](LICENSE). You are free to use, modify, and distribute this software for commercial and non-commercial purposes.

---

## Acknowledgments

IliaGPT is built on top of excellent open-source projects:

- **[LangChain](https://github.com/langchain-ai/langchainjs)** — LLM abstraction and tool calling framework
- **[LangGraph](https://github.com/langchain-ai/langgraphjs)** — DAG-based multi-agent orchestration
- **[Drizzle ORM](https://github.com/drizzle-team/drizzle-orm)** — Type-safe PostgreSQL ORM
- **[Playwright](https://github.com/microsoft/playwright)** — Browser automation
- **[shadcn/ui](https://github.com/shadcn-ui/ui)** — Accessible, composable UI components
- **[pgvector](https://github.com/pgvector/pgvector)** — Vector similarity search for PostgreSQL
- **[Radix UI](https://github.com/radix-ui/primitives)** — Unstyled accessible component primitives
- **[Vite](https://github.com/vitejs/vite)** — Next-generation frontend build tooling
- **[Zod](https://github.com/colinhacks/zod)** — TypeScript-first runtime schema validation
- **[Zustand](https://github.com/pmndrs/zustand)** — Lightweight React state management

---

<div align="center">

Made with care by the IliaGPT team.

[Website](https://iliagpt.io) • [Documentation](docs/) • [GitHub Issues](https://github.com/Carrerajorge/Iliagpt.io/issues)

</div>
