# Contributing to IliaGPT

Thank you for your interest in contributing to IliaGPT! This guide walks you through everything you need to get started, from setting up your local environment to getting your pull request merged.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Code Style](#code-style)
3. [Project Structure](#project-structure)
4. [Branching Strategy](#branching-strategy)
5. [Conventional Commits](#conventional-commits)
6. [Testing Requirements](#testing-requirements)
7. [Adding New Features](#adding-new-features)
8. [Pull Request Process](#pull-request-process)
9. [Release Process](#release-process)
10. [Development Commands Reference](#development-commands-reference)

---

## Getting Started

### Prerequisites

Before you begin, ensure you have the following installed on your system:

| Tool | Minimum Version | Notes |
|---|---|---|
| Node.js | 22.x | Use `nvm` or `fnm` for version management |
| npm | 10.x | Comes with Node 22 |
| PostgreSQL | 16.x | pgvector extension required |
| Redis | 7.x | Used for caching, rate limiting, pub/sub |
| Python | 3.11.x | Required for the FastAPI SSE microservice |
| Git | 2.40+ | For commit hooks to work correctly |

**Optional but recommended:**
- Docker + Docker Compose — for running PostgreSQL and Redis locally without system installs
- `pgvector` PostgreSQL extension — required for semantic search and embedding storage

### Fork and Clone

1. Fork the repository on GitHub by clicking the **Fork** button on the [IliaGPT repository](https://github.com/iliagpt/iliagpt.io) page.

2. Clone your fork locally:

```bash
git clone https://github.com/<your-username>/iliagpt.io.git
cd iliagpt.io
```

3. Add the upstream remote so you can pull in changes from the main repo:

```bash
git remote add upstream https://github.com/iliagpt/iliagpt.io.git
```

4. Verify your remotes are configured correctly:

```bash
git remote -v
# origin    https://github.com/<your-username>/iliagpt.io.git (fetch)
# origin    https://github.com/<your-username>/iliagpt.io.git (push)
# upstream  https://github.com/iliagpt/iliagpt.io.git (fetch)
# upstream  https://github.com/iliagpt/iliagpt.io.git (push)
```

### Install Dependencies

Install all Node.js dependencies from the project root:

```bash
npm install
```

This installs dependencies for the main app. The FastAPI microservice has its own Python dependencies:

```bash
cd fastapi_sse
pip install -r requirements.txt
cd ..
```

### Database Setup

**Option A — Docker (recommended for new contributors):**

```bash
docker compose up -d postgres redis
```

**Option B — Local PostgreSQL:**

1. Create a PostgreSQL database:

```bash
createdb iliagpt_dev
```

2. Enable the pgvector extension:

```bash
psql -d iliagpt_dev -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

3. Run database migrations:

```bash
npm run db:bootstrap
```

This command ensures the pgvector extension exists and applies all pending Drizzle migrations.

### Environment Configuration

Copy the example environment file and fill in the required values:

```bash
cp .env.example .env
```

At minimum, the following variables are required to run the application locally:

```env
# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/iliagpt_dev

# Session
SESSION_SECRET=<at-least-64-random-chars>

# At least one LLM API key
OPENAI_API_KEY=sk-...
# OR
ANTHROPIC_API_KEY=sk-ant-...

# Redis (if using local Redis)
REDIS_URL=redis://localhost:6379
```

For a full list of supported environment variables and their descriptions, refer to `server/config/env.ts`. The Zod schema there is the authoritative source for all configuration options.

**OAuth (optional for local dev):**

If you need to test authentication flows, configure Google OAuth credentials:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

### Run the Development Server

Start the Express API server and Vite frontend dev server:

```bash
# Terminal 1: API server (port 5000)
npm run dev

# Terminal 2: Frontend dev server (also port 5000 via Vite proxy)
npm run dev:client
```

For the full desktop app (Electron):

```bash
npm run dev:desktop
```

For the FastAPI SSE microservice (tool execution sandbox):

```bash
cd fastapi_sse
uvicorn main:app --reload --port 8001
```

The application should now be running at `http://localhost:5000`.

---

## Code Style

Consistency is important in a large codebase. All contributors are expected to follow these conventions.

### TypeScript

- **Strict mode is enabled.** The `tsconfig.json` has `"strict": true`. Do not disable it or add exceptions.
- **No `any`.** Using `any` defeats the purpose of TypeScript. If you must escape the type system temporarily, use `unknown` and narrow it explicitly. ESLint will warn on `any` usage.
- **No unused variables.** ESLint will warn on unused variables. If a parameter is intentionally unused (e.g., in a callback signature), prefix it with `_`:

```typescript
// Bad
function handler(req, res, next, unusedParam) { ... }

// Good
function handler(req, res, _next) { ... }
```

- **Prefer `interface` over `type` for object shapes** that may be extended. Use `type` for unions, intersections, and mapped types.
- **Avoid non-null assertions (`!`)** unless you have a strong reason and add a comment explaining why the value cannot be null at that point.
- **Return types on public functions** should be explicit, especially for exported functions and class methods.

### ESLint

The project uses ESLint with the configuration in `.eslintrc` (or `eslint.config.js`). Key rules:

- `no-unused-vars: warn` — prefix with `_` to suppress
- `@typescript-eslint/no-explicit-any: warn`
- `import/order` enforced (see Import Order below)
- Conventional commit messages enforced via `commitlint` + Husky pre-commit hook

Run the linter before submitting a PR:

```bash
npm run lint
```

Fix auto-fixable issues:

```bash
npm run lint -- --fix
```

### Prettier

The project uses Prettier for formatting. Configuration:

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "es5",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "bracketSpacing": true,
  "arrowParens": "always"
}
```

Key points:
- **2-space indentation** — no tabs
- **Single quotes** for strings (double quotes in JSX attributes is fine)
- **Trailing commas** in multi-line arrays, objects, and parameter lists (ES5 style)
- **100-character line length** — lines longer than 100 chars will be wrapped

Prettier runs automatically on staged files via a pre-commit hook. You can also run it manually:

```bash
npx prettier --write .
```

### Import Order

Imports must be organized in the following order, with a blank line between each group:

1. **External packages** (node_modules): `react`, `express`, `zod`, etc.
2. **Internal path aliases**: `@/*` (client), `@shared/*` (shared)
3. **Relative imports**: `./foo`, `../bar`

```typescript
// Good
import { useState } from 'react';
import { z } from 'zod';

import { useStore } from '@/stores/chatStore';
import type { Message } from '@shared/schema';

import { formatDate } from './utils';
import type { Props } from './types';
```

ESLint enforces this via the `import/order` rule.

### Naming Conventions

| Entity | Convention | Example |
|---|---|---|
| Variables | camelCase | `userMessage`, `isLoading` |
| Functions | camelCase | `fetchMessages()`, `handleSubmit()` |
| Classes | PascalCase | `SmartRouter`, `LongTermMemory` |
| React components | PascalCase | `ChatWindow`, `MessageBubble` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_TOKENS`, `DEFAULT_TIMEOUT_MS` |
| Files (source) | kebab-case | `smart-router.ts`, `chat-window.tsx` |
| Files (React components) | PascalCase or kebab-case | both are acceptable in `client/` |
| Database tables (Drizzle) | snake_case | `user_long_term_memories` |
| Environment variables | SCREAMING_SNAKE_CASE | `OPENAI_API_KEY` |
| Zod schemas | camelCase with `Schema` suffix | `insertMessageSchema` |

### Comments

- Write comments to explain **why**, not **what**. The code shows what; comments explain the reasoning.
- JSDoc comments on all exported functions and types.
- Use `// TODO(username): description` for known issues. TODOs linked to a GitHub issue are preferred: `// TODO(#1234): fix after schema migration`.
- Avoid commented-out code in PRs. Use git history instead.

---

## Project Structure

A brief walkthrough of the key directories:

```
iliagpt.io/
├── client/                 # React 19 + Vite frontend
│   └── src/
│       ├── components/     # React components (UI primitives + feature components)
│       ├── hooks/          # Custom React hooks
│       ├── stores/         # Zustand state stores (chatStore, agentStore, etc.)
│       ├── pages/          # Route-level page components (Wouter)
│       ├── locales/        # i18n translations (103 locales)
│       └── lib/            # Frontend utilities
│
├── server/                 # Express.js backend
│   ├── index.ts            # Entry point
│   ├── routes.ts           # Route registration
│   ├── db.ts               # Drizzle database client
│   ├── storage.ts          # Data access layer
│   ├── agent/              # Multi-agent orchestration (LangGraph + LangChain)
│   ├── llm/                # LLM gateway + smart router
│   ├── memory/             # Long-term memory extraction + pgvector
│   ├── realtime/           # WebSocket presence
│   ├── search/             # Hybrid search (full-text + semantic)
│   ├── api/v1/             # OpenAI-compatible API endpoints
│   ├── openclaw-src/       # Browser control subsystem
│   └── config/             # Environment validation (Zod)
│
├── shared/                 # Shared types and schemas
│   ├── schema.ts           # Drizzle table definitions + Zod validators (~3300 lines)
│   └── types/              # Shared TypeScript types
│
├── migrations/             # Drizzle-generated SQL migrations
│
├── e2e/                    # Playwright end-to-end tests
│
├── fastapi_sse/            # Python FastAPI microservice (tool sandbox)
│
├── desktop/                # Electron wrapper
│
├── extension/              # Chrome browser extension
│
├── scripts/                # Build and utility scripts
│
└── docs/                   # Documentation (you are here)
```

### Key Files

- `shared/schema.ts` — The single source of truth for all database tables and insert schemas. When adding a new table or column, this is where you start.
- `server/config/env.ts` — All environment variables are declared and validated here with Zod.
- `server/llm/smartRouter.ts` — The multi-provider LLM router with circuit breaker logic.
- `server/agent/pipeline/` — The core LLM + tool execution pipeline.
- `client/src/stores/` — All Zustand stores. Global client-side state lives here.

---

## Branching Strategy

### Branch Types

| Branch | Pattern | Purpose |
|---|---|---|
| `main` | `main` | Production-ready code. Protected. |
| Feature | `feature/description` | New features |
| Bug fix | `fix/description` | Bug fixes |
| Documentation | `docs/description` | Documentation updates |
| Chore | `chore/description` | Maintenance, refactoring, tooling |
| Hotfix | `hotfix/description` | Critical production fixes |
| Release | `release/v1.2.3` | Release preparation |

### Rules

- **Never commit directly to `main`.** All changes go through pull requests.
- **`main` is protected.** Direct pushes are blocked. PRs require:
  - CI passing (all tests green)
  - At least 1 approving review from a CODEOWNER
  - No unresolved conversations
- **Keep branches short-lived.** Feature branches should be merged within a sprint. Long-running branches diverge and cause painful merges.
- **One concern per branch.** Don't combine a feature and a refactor in the same branch unless they're tightly coupled.
- **Branch from `main`**, not from another feature branch, unless your work explicitly depends on unmerged changes.

### Keeping Your Branch Up to Date

```bash
# Fetch latest changes from upstream
git fetch upstream

# Rebase your feature branch onto upstream/main
git checkout feature/my-feature
git rebase upstream/main

# Push the rebased branch (force required after rebase)
git push origin feature/my-feature --force-with-lease
```

Use `--force-with-lease` instead of `--force`. It is safer because it refuses to overwrite if someone else has pushed to the branch since your last fetch.

---

## Conventional Commits

All commits must follow the Conventional Commits specification. This is enforced by `commitlint` and the Husky pre-commit hook.

### Format

```
type(scope): description

[optional body]

[optional footer(s)]
```

### Types

| Type | When to use |
|---|---|
| `feat` | A new feature visible to users |
| `fix` | A bug fix |
| `docs` | Documentation only changes |
| `style` | Formatting, whitespace — no logic change |
| `refactor` | Code restructuring with no behavior change |
| `test` | Adding or modifying tests |
| `chore` | Build process, dependency updates, tooling |
| `perf` | Performance improvements |
| `ci` | CI/CD configuration changes |
| `build` | Changes to the build system |

### Scopes

| Scope | Area |
|---|---|
| `agent` | Agent system, LangGraph, tools |
| `chat` | Chat UI, messaging, SSE streaming |
| `ui` | Generic UI components, design system |
| `api` | REST API endpoints |
| `db` | Database schema, migrations |
| `auth` | Authentication, sessions, OAuth |
| `llm` | LLM providers, smart router |
| `tools` | Tool registry, individual tools |
| `docs` | Documentation |
| `config` | Environment config, build config |
| `deps` | Dependency updates |

### Examples

```bash
# New feature
feat(agent): add browser automation tool for web scraping

# Bug fix with issue reference
fix(chat): handle SSE disconnection when tab goes to background

Closes #1234

# Test addition
test(llm): add provider parity tests for streaming responses

# Documentation
docs(api): document OpenAI-compatible /v1/chat/completions endpoint

# Chore
chore(deps): upgrade drizzle-orm to 0.30.0

# Breaking change (note the ! and BREAKING CHANGE footer)
feat(auth)!: migrate session store from memory to PostgreSQL

BREAKING CHANGE: existing in-memory sessions will be invalidated on deploy.
Users will need to log in again after the upgrade.
```

### Commit Message Rules

- Use **imperative mood** in the description: "add feature" not "added feature" or "adds feature"
- Keep the **first line under 72 characters**
- **Do not end** the description with a period
- Reference issues in the footer: `Closes #123`, `Fixes #456`, `Refs #789`
- Breaking changes must include `BREAKING CHANGE:` in the footer

---

## Testing Requirements

All contributions must include appropriate tests. The test suite must remain green.

### Test Types

#### Unit and Integration Tests (Vitest)

Used for testing individual functions, modules, and API endpoints in isolation.

```bash
# Run all tests
npm run test:run

# Run a specific test file
npx vitest run server/llm/smartRouter.test.ts

# Run tests in watch mode (during development)
npx vitest

# Run with coverage report
npx vitest run --coverage
```

**File naming:** `*.test.ts` for unit/integration tests, co-located with the source file or in a `__tests__/` subdirectory.

#### React Component Tests

```bash
npm run test:client
```

Uses Vitest with jsdom environment and React Testing Library. Test files: `*.test.tsx`.

#### End-to-End Tests (Playwright)

Used for critical user-facing flows such as login, sending a message, and tool execution.

```bash
# Run all E2E tests
npm run test:e2e

# Run smoke tests (subset for CI)
npm run test:smoke

# Run with UI (for debugging)
npx playwright test --ui
```

**File naming:** `*.e2e.ts` under the `e2e/` directory.

#### Agent System Tests

```bash
npm run test:agentic
npm run test:agentic:integration
```

### Coverage Requirements

- **New features:** 80%+ line coverage for the new code you add
- **Bug fixes:** Add a regression test that fails without your fix
- **Refactors:** Coverage must not decrease

Coverage reports are generated in `coverage/` when running with `--coverage`.

### What to Test

When adding a new feature, tests should cover:

1. **Happy path** — the expected successful flow
2. **Error cases** — what happens when inputs are invalid, external services are down, or edge cases occur
3. **Boundary conditions** — empty inputs, maximum values, type boundaries

When fixing a bug:

1. Write a test that **fails** on the current code (reproducing the bug)
2. Make your fix
3. Verify the test now **passes**
4. Ensure no other tests broke

### CI Test Gates

The CI pipeline (`.github/workflows/ci.yml`) runs the following on every PR:

- `npm run test:ci:chat-core` — Core chat functionality tests
- `npm run test:client` — React component tests
- `npm run lint` — ESLint
- `npm run check` — TypeScript type check

All must pass before a PR can be merged.

---

## Adding New Features

### Adding a New LLM Provider

1. Create a new file in `server/llm/providers/` implementing the provider interface.
2. Register the provider in `server/llm/smartRouter.ts` — add it to the provider registry and configure fallback chains.
3. Add the required API key environment variable to `server/config/env.ts` (Zod schema).
4. Update `.env.example` with the new variable and a description.
5. Add the provider to the model list in `GET /v1/models`.
6. Write tests covering:
   - Successful streaming and non-streaming responses
   - Rate limit handling and circuit breaker behavior
   - Fallback to next provider on failure
7. Document the provider in `docs/API_REFERENCE.md`.

### Adding a New Tool

Tools are registered in the agent tool registry and made available to LLM agents.

1. Create a new file in `server/agent/tools/` named `toolName.ts`.
2. Define the input/output Zod schema for the tool.
3. Implement the tool function with proper error handling.
4. Register the tool in the tool registry (`server/agent/tools/index.ts`).
5. If the tool makes external HTTP calls, ensure SSRF protection is applied.
6. If the tool executes code, route it through the FastAPI sandbox.
7. Write tests for:
   - Tool execution with valid inputs
   - Input validation (Zod schema rejection of invalid inputs)
   - Error handling for external service failures
8. Document the tool in `docs/API_REFERENCE.md` under the Tools section.

### Adding a New MCP Connector

Model Context Protocol connectors extend the agent with external service integrations.

1. Create a new connector directory in `server/agent/mcp/connectors/<service-name>/`.
2. Implement the `McpConnector` interface.
3. If the service requires OAuth, implement the OAuth flow in `server/auth/oauth/<service-name>.ts`.
4. Add the connector to the connector registry.
5. Add required environment variables to `server/config/env.ts`.
6. Write integration tests (can use mocked HTTP responses with MSW).
7. Document the connector with required environment variables and OAuth scopes.

### Adding a New API Endpoint

1. Define request/response Zod schemas in `shared/schema.ts` or a local schema file.
2. Create the route handler in the appropriate file under `server/routes/` or add to an existing router.
3. Register the route in `server/routes.ts`.
4. Add authentication middleware as required.
5. Add input validation using the Zod schema.
6. Write tests using supertest.
7. Document the endpoint in `docs/API_REFERENCE.md`.

### Adding a New Database Table or Column

1. Define the new table or column in `shared/schema.ts` using Drizzle's schema builder.
2. Add corresponding Zod insert/select schemas.
3. Generate a new migration:

```bash
npm run db:push    # Development: push directly
# OR
npm run db:migrate # Production: generate and apply migration
```

4. Update the storage layer in `server/storage.ts` if new query methods are needed.
5. Never write raw SQL queries — use Drizzle's query builder for all database access.

---

## Pull Request Process

### Before Opening a PR

- [ ] All tests pass locally: `npm run test:run`
- [ ] No TypeScript errors: `npm run check`
- [ ] No lint errors: `npm run lint`
- [ ] Branch is rebased on latest `main`
- [ ] Commit messages follow Conventional Commits format
- [ ] New code has tests (see Testing Requirements)
- [ ] Documentation updated if behavior changed

### PR Title

The PR title must follow Conventional Commits format, exactly like a commit message:

```
feat(agent): add web search tool with SSRF protection
fix(chat): resolve SSE connection drop on Safari
docs(api): add OpenAI-compatible endpoint documentation
```

### PR Description

Fill out the PR template completely. The template includes:

- **What does this PR do?** — A clear description of the changes
- **Why?** — The motivation or problem being solved
- **How was it tested?** — What tests were added or run
- **Screenshots** — For UI changes, before/after screenshots
- **Checklist** — Standard checklist from the template

### Review Process

1. Open the PR and request review from CODEOWNERS. The `CODEOWNERS` file defines who reviews which parts of the codebase.
2. CI will automatically run on your PR. Do not request reviews until CI is green.
3. Address all reviewer comments. Mark conversations as resolved after addressing them.
4. If you push new commits in response to review, notify reviewers so they know to re-review.
5. Squash merge is preferred to keep the git history clean. The maintainer will squash-merge your PR.

### Merge Requirements

- CI passes (all required checks green)
- At least 1 approving review from a CODEOWNER
- No unresolved conversations
- Branch is up to date with `main`

---

## Release Process

IliaGPT follows [Semantic Versioning](https://semver.org/):

- **MAJOR** (`1.0.0` → `2.0.0`): Breaking changes — API incompatibility, DB schema breaking change
- **MINOR** (`1.0.0` → `1.1.0`): New features that are backward-compatible
- **PATCH** (`1.0.0` → `1.0.1`): Backward-compatible bug fixes

### Steps to Release

1. Create a release branch from `main`:

```bash
git checkout main
git pull upstream main
git checkout -b release/v1.2.3
```

2. Update the version in `package.json`:

```bash
npm version 1.2.3 --no-git-tag-version
```

3. Update `CHANGELOG.md` — add a new section for the release with the date and all changes grouped by type (Features, Bug Fixes, Breaking Changes, etc.).

4. Commit the version bump and changelog:

```bash
git add package.json CHANGELOG.md
git commit -m "chore(release): v1.2.3"
```

5. Open a PR from `release/v1.2.3` → `main`. Get it reviewed and merged.

6. Tag the release on the merged commit:

```bash
git checkout main
git pull upstream main
git tag v1.2.3
git push upstream v1.2.3
```

7. Create a GitHub Release:
   - Go to Releases → New Release
   - Select the tag `v1.2.3`
   - Copy the relevant CHANGELOG section as the release notes
   - Mark pre-releases appropriately with `-alpha`, `-beta`, or `-rc.N` suffixes

---

## Development Commands Reference

### Running the Application

| Command | Description |
|---|---|
| `npm run dev` | Start Express API server (port 5000) with hot reload |
| `npm run dev:client` | Start Vite frontend dev server (port 5000) |
| `npm run dev:desktop` | Full desktop app: server + client + Electron |
| `npm start` | Start in production mode (requires build first) |

### Building

| Command | Description |
|---|---|
| `npm run build` | Compile server (esbuild) + client (Vite) via `scripts/build.ts` |
| `npm run build:client` | Build frontend only |
| `npm run build:server` | Build backend only |

### Database

| Command | Description |
|---|---|
| `npm run db:bootstrap` | Create pgvector extension + run all migrations |
| `npm run db:push` | Push Drizzle schema to DB (development only — skips migration files) |
| `npm run db:migrate` | Generate and apply Drizzle migration files |
| `npm run db:migrate:prod` | Run migrations from compiled `dist/` (production) |
| `npm run db:studio` | Open Drizzle Studio (visual DB browser) |

### Testing

| Command | Description |
|---|---|
| `npm run test:run` | Run all Vitest unit/integration tests once |
| `npm run test:ci:chat-core` | Core chat tests (used in CI) |
| `npm run test:client` | React component tests (vitest.client.config.ts) |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run test:smoke` | Playwright smoke tests (fast subset) |
| `npm run test:agentic` | Agent system tests |
| `npm run test:agentic:integration` | Agentic integration tests |
| `npm run verify` | Full verification script (`scripts/agent-verify.sh`) |
| `npx vitest run path/to/test.ts` | Run a single test file |
| `npx vitest --coverage` | Run tests with coverage report |

### Code Quality

| Command | Description |
|---|---|
| `npm run lint` | Run ESLint on all source files |
| `npm run lint -- --fix` | Auto-fix ESLint issues |
| `npm run check` | Run TypeScript type check |
| `npm run type-check` | Extended type check with 8GB heap (for large type inference) |
| `npm run verify:i18n` | Check i18n coverage + run i18n-related tests |

### Utilities

| Command | Description |
|---|---|
| `npx prettier --write .` | Format all files with Prettier |
| `npx drizzle-kit generate` | Generate new migration from schema changes |
| `npx drizzle-kit studio` | Open Drizzle Studio |

---

## Getting Help

- **Discord:** Join the IliaGPT community Discord for questions and discussion.
- **GitHub Discussions:** For longer-form questions about architecture or design decisions.
- **GitHub Issues:** For bug reports and feature requests. Use the appropriate issue template.
- **Email:** For security issues, use security@iliagpt.io (see [SECURITY.md](SECURITY.md)).

We appreciate every contribution, whether it is a bug report, documentation fix, or new feature. Thank you for helping make IliaGPT better!
