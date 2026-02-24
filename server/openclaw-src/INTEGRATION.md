# OpenClaw v2026.2.23 Source Code Integration

This directory contains the complete source code of OpenClaw v2026.2.23,
an MIT-licensed open-source AI agent framework.

## Source Repository
- GitHub: https://github.com/openclaw/openclaw
- Version: v2026.2.23
- License: MIT

## Integration Architecture

The OpenClaw source code is integrated into IliaGPT through an adapter layer
located at `server/agent/openclaw/`. The adapter bridges OpenClaw's standalone
agent architecture with IliaGPT's web application framework.

### Key Modules

| Module | Path | Description |
|--------|------|-------------|
| Agents | `agents/` | Core agent system, tools, compaction, system prompts |
| Browser | `browser/` | Playwright-based browser automation (CDP) |
| Memory | `memory/` | Semantic memory with embeddings (SQLite-vec, multi-provider) |
| Process | `process/` | Shell execution, process supervision |
| Security | `security/` | Sandbox, permissions, SSRF guards |
| Config | `config/` | Configuration management |
| Gateway | `gateway/` | HTTP gateway, WebSocket, SSE |
| Sessions | `sessions/` | Multi-session management |
| Plugins | `plugins/` | Plugin system |
| Skills | `skills/` | Agent skills |

### Adapter Layer (`server/agent/openclaw/`)

- `index.ts` - Main integration entry point
- `toolCatalog.ts` - Adapted tool catalog with IliaGPT subscription tiers
- `toolPolicy.ts` - Tool policy pipeline with tier gating
- `compaction.ts` - Conversation compaction
- `tools/webSearch.ts` - Multi-provider web search
- `tools/webFetch.ts` - HTML-to-Markdown web fetch
- `tools/memoryTool.ts` - Semantic memory search
- `tools/subagentTool.ts` - Sub-agent spawning

### API Routes (`server/routes/openclawRouter.ts`)

- `GET /api/openclaw/status` - System status
- `GET /api/openclaw/tools` - Available tools
- `GET /api/openclaw/catalog` - Full tool catalog
- `GET /api/openclaw/system-prompt` - Dynamic system prompt
- `POST /api/openclaw/compact` - Conversation compaction
- `POST /api/openclaw/check-tool` - Tool access check

## File Count
- 3,532 TypeScript files
- 3,621 total files
- 28MB total size
