# IliaGPT Multi-Provider Capability Test Suite

Comprehensive test coverage for all 18 IliaGPT capability categories, validated across 5 LLM providers.

## Structure

```
tests/capabilities/
├── _setup/
│   ├── providerMatrix.ts    # Provider configs + runWithEachProvider helper
│   ├── mockResponses.ts     # Realistic mock LLM responses per format
│   └── testHelpers.ts       # File/temp/HTTP mocking utilities
├── 01-excel-generation.test.ts
├── 02-ppt-generation.test.ts
├── 03-word-generation.test.ts
├── 04-pdf-generation.test.ts
├── 05-file-management.test.ts
├── 06-data-analysis.test.ts
├── 07-research-synthesis.test.ts
├── 08-format-conversion.test.ts
├── 09-browser-automation.test.ts
├── 10-computer-use.test.ts
├── 11-scheduling.test.ts
├── 12-dispatch.test.ts
├── 13-mcp-connectors.test.ts
├── 14-plugins.test.ts
├── 15-code-execution.test.ts
├── 16-sub-agents.test.ts
├── 17-cowork-projects.test.ts
├── 18-security.test.ts
├── 19-enterprise.test.ts
├── 20-vertical-legal.test.ts
├── 21-vertical-finance.test.ts
├── 22-vertical-marketing.test.ts
├── 23-vertical-operations.test.ts
├── 24-vertical-hr.test.ts
├── 25-vertical-research.test.ts
├── 26-availability.test.ts
├── 27-memory-system.test.ts
├── 28-streaming.test.ts
├── 29-model-routing.test.ts
├── 30-tool-orchestration.test.ts
├── runAll.ts                # Master runner + HTML report generator
└── README.md
```

## Providers Tested

| Provider | Model | Vision | Tools | Streaming |
|----------|-------|--------|-------|-----------|
| **Claude** | claude-sonnet-4-6 | ✅ | ✅ | ✅ |
| **OpenAI** | gpt-4o | ✅ | ✅ | ✅ |
| **Gemini** | gemini-1.5-pro | ✅ | ✅ | ✅ |
| **Grok** | grok-2 | ❌ | ✅ | ✅ |
| **Mistral** | mistral-large-latest | ❌ | ✅ | ✅ |

## Capability Categories (18)

| # | Category | Tests |
|---|----------|-------|
| 1 | File Generation (Excel/PPT/Word/PDF) | 4 files × 12 tests each |
| 2 | File Management | upload, download, search, delete |
| 3 | Data Analysis | stats, insights, recommendations |
| 4 | Research Synthesis | sources, synthesis, citations |
| 5 | Format Conversion | PDF→txt, DOCX→HTML, CSV→JSON |
| 6 | Browser Automation | navigate, click, fill, screenshot, extract |
| 7 | Computer Use | mouse, keyboard, screen capture |
| 8 | Scheduling | cron, timezone, pause/resume |
| 9 | Dispatch | task routing, confidence scoring |
| 10 | MCP Connectors | GitHub, Slack, Jira tool execution |
| 11 | Plugins | registry, sandboxed execution |
| 12 | Code Execution | Python, JS, bash with artifact capture |
| 13 | Sub-Agents | orchestration, parallel execution |
| 14 | Cowork Projects | members, tasks, shared context |
| 15 | Security | injection detection, PII, SSRF |
| 16 | Enterprise | SSO, audit log, compliance |
| 17 | Verticals | Legal, Finance, Marketing, Ops, HR, Research |
| 18 | Availability | circuit breakers, fallbacks, latency |

## Running Tests

```bash
# All capability tests
npx vitest run tests/capabilities/

# Single capability
npx vitest run tests/capabilities/01-excel-generation.test.ts

# With HTML report
npx vitest run tests/capabilities/ --reporter=html --outputFile=reports/capability-report.html

# With coverage
npx vitest run tests/capabilities/ --coverage

# Watch mode (development)
npx vitest tests/capabilities/
```

## Test Design

Every test file follows this pattern:

```typescript
import { runWithEachProvider } from './_setup/providerMatrix';

runWithEachProvider('Capability Name', (provider) => {
  // Each test block runs 5× — once per provider
  it('does the thing', async () => {
    const mock = createLLMClientMock({ content: MOCK_RESPONSE, model: provider.model });
    const result = await myFunction(input, provider, mock);
    expect(result).toBeDefined();
  });
});
```

### Key utilities

**`runWithEachProvider(name, factory)`** — wraps your describe block in 5 provider-scoped describes.

**`mockProviderEnv(provider)`** — sets `process.env.*_API_KEY` and `DEFAULT_LLM_PROVIDER` before each test.

**`createLLMClientMock(config)`** — returns a fully typed mock LLM client with `chat.completions.create` and `embeddings.create`.

**`mockFetch(responses)`** — mocks `globalThis.fetch` with a queue of pre-configured HTTP responses.

**`buildToolCallMock(name, args)`** — builds a properly formatted tool_calls array for testing tool-use flows.

## Adding a New Capability Test

1. Create `tests/capabilities/NN-my-capability.test.ts`
2. Import from `_setup/providerMatrix` and `_setup/testHelpers`
3. Use `runWithEachProvider` to ensure all 5 providers are tested
4. Add an entry to `CAPABILITY_TEST_FILES` in `runAll.ts`
5. Run `npx vitest run tests/capabilities/NN-my-capability.test.ts`
