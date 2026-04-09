# Deep Functionality Fix Session — 2026-04-09

## Summary of All Fixes Applied

### Phase 1: Chat Pipeline Reliability ✅

**Fix: Eliminate Duplicate Intent Classification**
- **File:** `server/agent/agentRouter.ts`
- **Problem:** Every chat request triggered two separate LLM classification calls — first in `chatAiRouter.ts` via `routeIntent()`, then again inside `routeAgentRequest()` via `analyzeIntent()`. This doubled latency and cost.
- **Fix:** Added a `SHARED_TO_AGENT_INTENT` mapping table (16 intent types) and an `intentHint` bypass parameter. When `routeIntent()` already ran with confidence ≥ 0.75, `analyzeIntent()` (the second LLM call) is skipped entirely.
- **Impact:** ~50% reduction in intent classification latency for high-confidence requests.

**Confirmed Pre-existing Fix in `unifiedChatHandler.ts`**
- The same pattern was already in `createUnifiedRun()` with a 0.7 confidence threshold. Both systems now consistently avoid double classification.

### Phase 2: RAG & Memory System ✅

**Audited (no bugs found):**
- `server/memory/longTermMemory.ts` — LLM-based fact extraction, pgvector dedup at 0.85 cosine threshold, importance scoring capped at 1.0, recency injection into system prompt.
- `server/search/unifiedSearch.ts` — Full-text tsvector + pgvector semantic search, Reciprocal Rank Fusion (k=60).

### Phase 3: Content Rendering & Generation ✅

**Math Visualization Injection**
- **File:** `server/services/chatService.ts`
- **Problem:** LLM was generating Python/matplotlib code for math visualizations, which cannot execute in the browser environment.
- **Fix:** Added `isMathRequest()` detection in the chat pipeline. When a math visualization is requested, a pre-computed HTML artifact using Plotly.js/Three.js from CDN is injected directly into the system prompt context. Supports 2D, 3D, 4D, and N-dimensional (parallel coordinates) visualizations.
- **Impact:** Math visualizations now render immediately in-browser without code execution.

**Audited document generators (no bugs found):**
- wordGenerator, pptxGenerator, excelGenerator, pdfGenerator — all solid.

### Phase 4: Library Integration & Error Handling ✅

**LLM Gateway Rate Limit Increase**
- **File:** `server/lib/llmGateway.ts`
- Increased `tokensPerMinute` 100→200, `maxBurst` 150→300, `refillRateMs` 600→300ms
- Short-message cache bypass threshold lowered 50→10 chars
- Localized all-providers-down fallback to Spanish

**Route Hardening**
- **Files:** `server/routes/errorRouter.ts`, `feedbackRouter.ts`, `filesRouter.ts`, `adminRouter.ts`
- Added proper request validation and structured error responses

**SSE & Streaming Fixes**
- **Files:** `client/src/hooks/use-stream-chat.ts`, `client/src/stores/artifactStore.ts`
- Fixed SSE reconnect logic and artifact streaming state management

**Confirmed pre-existing guards in:**
- `agentRuntimeFacade.ts` — `isWritable()` checks before SSE writes
- `agentExecutor.ts` — `writableEnded/destroyed` guards, keepalive cleared in `finally`
- `circuitBreaker.ts` — CLOSED/OPEN/HALF_OPEN states with auto-recovery

### Phase 5: Comprehensive Testing & Hardening ✅

**Fix: EPERM crash in test cleanup (3 files)**
- **Files:** `server/__tests__/sandboxLimits.test.ts`, `artifactDownload.test.ts`, `realToolHandlers.documents.test.ts`
- **Problem:** `fs.unlinkSync()` and `fs.rmSync()` threw `EPERM: operation not permitted` when trying to delete files from the user's mounted filesystem (the Cowork sandbox restricts mounted-volume deletions).
- **Fix:** Wrapped all cleanup `unlinkSync` / `rmSync` calls in individual `try/catch` blocks. Each file deletion is now best-effort and never crashes the test suite.

**Fix: Terminal timeout test hanging 30 seconds**
- **File:** `server/agent/claw/terminalTool.ts`
- **Problem:** `spawn('sleep 30', [], { shell: true })` with `proc.kill('SIGKILL')` only killed the shell process, leaving `sleep 30` as an orphan. The test waited 30 full seconds for the orphan to exit.
- **Fix:** Rewrote `executeCommand()` to use `detached: true` (creates a new OS process group) and `process.kill(-proc.pid, 'SIGKILL')` (kills the entire group including all children). Added `proc.unref()` to prevent the parent from being held open.

## Test Results

| Before | After |
|--------|-------|
| 1341 tests passed, 4 failed | **1345 tests passed, 0 failed** |
| 93 test files | 93 test files |

## Commits Made

1. `14f46fe2` — fix: eliminate duplicate intent classification & upgrade embedding pipeline
2. `b2409efa` — feat: 3D math visualization with Plotly.js inline rendering
3. `c4022881` — feat: add unified prompt analyzer, document analyzer, and action executor
4. `95d19222` — fix: improve chat reliability, rate limits, math visualization injection, and route hardening
