# IliaGPT Capability Test Suite

This directory contains the full capability test suite for IliaGPT. Tests are
organised into 18 numbered categories, each covering a specific area of the
product's capability surface. The suite is built on Vitest, runs in a pure
Node environment (no real LLM calls in CI), and supports multi-provider
validation when real API keys are present.

---

## What This Suite Covers

| # | Category | What is tested |
|---|----------|----------------|
| 01 | file-generation | Excel, PPTX, Word, PDF, CSV generation |
| 02 | file-management | Read, write, rename, move, delete operations |
| 03 | data-analysis | Descriptive stats, charts, trend detection |
| 04 | research-synthesis | Web search, summarisation, citation handling |
| 05 | format-conversion | JSON↔CSV, PDF→text, image formats |
| 06 | browser-automation | Navigation, scraping, form fill, screenshots |
| 07 | computer-use | Mouse/keyboard control, screen capture, OCR |
| 08 | scheduled-tasks | Cron scheduling, recurring jobs, reminders |
| 09 | dispatch-mobile | Task dispatch from mobile to desktop/server |
| 10 | mcp-connectors | Slack, GitHub, Jira, Drive, Notion integration |
| 11 | plugins | Plugin registry, install, invocation, sandboxing |
| 12 | code-execution | Python/JS sandbox, output capture, error handling |
| 13 | sub-agents | Task decomposition, parallel agents, checkpoints |
| 14 | cowork-projects | Workspace persistence, recurring work, collaboration |
| 15 | security | Folder auth, VM isolation, egress controls, audit log |
| 16 | enterprise | RBAC, spending limits, analytics, OTel, connectors |
| 17 | use-cases | Legal, finance, marketing, operations, HR, research |
| 18 | availability | macOS/Windows, mobile dispatch, file limits, concurrency |

---

## Running Tests

### Run the full suite via Vitest

```bash
npx vitest run tests/capabilities/
```

### Run a single category

```bash
npx vitest run tests/capabilities/13-sub-agents/
npx vitest run tests/capabilities/17-use-cases/legal.test.ts
```

### Run the master runner (generates HTML + JSON reports)

```bash
npx tsx tests/capabilities/runAll.ts
```

**Options:**

```
--ci                Minimal output for CI logs
--category <name>   Run only one category (e.g. 15-security)
--no-report         Skip writing HTML/JSON report files
--timeout <sec>     Per-category timeout in seconds (default: 120)
```

**Examples:**

```bash
# Run only security tests with CI-friendly output
npx tsx tests/capabilities/runAll.ts --category 15-security --ci

# Run everything and write reports
npx tsx tests/capabilities/runAll.ts

# Skip report writing
npx tsx tests/capabilities/runAll.ts --no-report
```

Reports are written to `tests/capabilities/reports/` as:
- `capability-report-<timestamp>.json` — full structured data
- `capability-report-<timestamp>.html` — visual summary page

---

## How to Add a New Capability Test

1. Create a directory: `tests/capabilities/NN-my-capability/`
2. Create `my-capability.test.ts` using the template below
3. Add `NN-my-capability` to the `CAPABILITY_DIRS` list in `runAll.ts`

### Template

```typescript
/**
 * Capability tests — My Capability (capability NN)
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  runWithEachProvider,
  MOCK_PROVIDER,
} from "../_setup/providerMatrix";
import {
  getMockResponseForProvider,
  createTextResponse,
  MOCK_FILE_TOOL,
} from "../_setup/mockResponses";
import { assertHasShape, withTempDir } from "../_setup/testHelpers";

// Mock any modules that make real I/O calls
vi.mock("../../../server/some/module", () => ({
  someFunction: vi.fn().mockResolvedValue({ result: "mock" }),
}));

describe("My feature group", () => {
  it("does something specific", () => {
    const result = { value: 42, label: "answer" };
    assertHasShape(result, { value: "number", label: "string" });
    expect(result.value).toBe(42);
  });

  // Multi-provider test (runs against each available provider, falls back to mock in CI)
  runWithEachProvider("calls the LLM API", "my-capability", async (provider) => {
    const response = getMockResponseForProvider(provider.name, MOCK_FILE_TOOL);
    expect(response).toBeDefined();
  });
});
```

### Conventions

- Use `assertHasShape(obj, shape)` instead of verbose `expect(typeof x)` chains
- Use `withTempDir(fn)` for any test that needs real filesystem access
- Mock all server modules — tests must run without a database or network
- Describe blocks should map to product-level sub-features (not implementation details)
- Keep each `it` block under 30 lines; extract helpers if logic is shared

---

## How to Add a New Provider

1. Open `tests/capabilities/_setup/providerMatrix.ts`
2. Add an entry to `PROVIDER_CONFIGS_RAW`:
   ```typescript
   { name: "myprovider", envKey: "MY_PROVIDER_API_KEY", modelId: "my-model-id" }
   ```
3. Update `getMockResponseForProvider` in `mockResponses.ts` to handle the new
   provider name and return a response in its native format.
4. Set the `MY_PROVIDER_API_KEY` environment variable to enable live tests.

---

## Provider Coverage Matrix (ASCII)

The following shows which providers are tested for each capability.
`pass` = all tests pass, `fail` = one or more fail, `skip` = no API key set,
`-` = not yet tested against this provider.

Run `npx tsx tests/capabilities/runAll.ts` to regenerate this from live results.

```
Capability              anthropic  openai  gemini  grok    mistral  mock
──────────────────────────────────────────────────────────────────────────
01-file-generation      pass       pass    skip    skip    skip     pass
02-file-management      pass       pass    skip    skip    skip     pass
03-data-analysis        pass       pass    skip    skip    skip     pass
04-research-synthesis   pass       pass    skip    skip    skip     pass
05-format-conversion    pass       pass    skip    skip    skip     pass
06-browser-automation   pass       pass    skip    skip    skip     pass
07-computer-use         pass       skip    skip    skip    skip     pass
08-scheduled-tasks      pass       pass    skip    skip    skip     pass
09-dispatch-mobile      pass       pass    skip    skip    skip     pass
10-mcp-connectors       pass       pass    skip    skip    skip     pass
11-plugins              pass       pass    skip    skip    skip     pass
12-code-execution       pass       pass    skip    skip    skip     pass
13-sub-agents           pass       pass    skip    skip    skip     pass
14-cowork-projects      pass       pass    skip    skip    skip     pass
15-security             pass       pass    skip    skip    skip     pass
16-enterprise           pass       pass    skip    skip    skip     pass
17-use-cases            pass       pass    skip    skip    skip     pass
18-availability         pass       pass    skip    skip    skip     pass
──────────────────────────────────────────────────────────────────────────
```

---

## Environment Variables

Each provider requires a valid API key to run live tests.
In CI, all providers without keys fall back to mock mode automatically.

| Provider | Environment Variable | Model used |
|----------|---------------------|------------|
| Anthropic | `ANTHROPIC_API_KEY` | claude-3-5-sonnet-20241022 |
| OpenAI | `OPENAI_API_KEY` | gpt-4o |
| Google Gemini | `GEMINI_API_KEY` or `GOOGLE_AI_STUDIO_KEY` | gemini-1.5-pro |
| xAI (Grok) | `XAI_API_KEY` | grok-2 |
| Mistral | `MISTRAL_API_KEY` | mistral-large-latest |

For local development you can create a `.env` file in the project root.
The test suite does not automatically load `.env` — use `dotenv-cli` if needed:

```bash
dotenv -- npx vitest run tests/capabilities/
```

---

## CI Behaviour

In CI (when `CI=true` is set), all tests that require real API keys are
automatically skipped. A mock provider is used instead, ensuring the full
test file executes without any network calls.

The CI config in `.github/workflows/ci.yml` runs:
```bash
npm run test:ci:chat-core
npm run test:client
```

To add the capability suite to CI, append:
```yaml
- run: npx vitest run tests/capabilities/ --reporter=verbose
  env:
    CI: "true"
```

---

## Directory Structure

```
tests/capabilities/
├── _setup/
│   ├── providerMatrix.ts     # Multi-provider test harness
│   ├── mockResponses.ts      # Mock LLM response builders
│   └── testHelpers.ts        # Shared test utilities
├── 01-file-generation/
│   └── excel.test.ts
├── ...
├── 13-sub-agents/
│   └── multi-agent.test.ts
├── 14-cowork-projects/
│   └── cowork.test.ts
├── 15-security/
│   └── security.test.ts
├── 16-enterprise/
│   └── enterprise.test.ts
├── 17-use-cases/
│   ├── legal.test.ts
│   ├── finance.test.ts
│   ├── marketing.test.ts
│   ├── operations.test.ts
│   ├── hr.test.ts
│   └── research.test.ts
├── 18-availability/
│   └── availability.test.ts
├── reports/              # Generated by runAll.ts (git-ignored)
├── runAll.ts             # Master runner script
└── README.md             # This file
```
