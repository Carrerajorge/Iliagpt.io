/**
 * =============================================================================
 * client/src/integration/index.ts
 * =============================================================================
 *
 * BARREL EXPORT — Agentic Frontend Integration Layer
 * =====================================================
 *
 * This module exposes every piece of the agentic integration system through
 * a single import path: '@/integration'.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ARCHITECTURE OVERVIEW
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The integration layer sits between the existing chat infrastructure
 * (useStreamChat → /api/chat/stream) and the new agentic primitives
 * (useAgenticChat, AgenticStreamParser, ToolCallCard, etc.).
 *
 * It does NOT replace the existing system. Normal messages continue to work
 * unchanged. Agentic messages are routed transparently when intent is detected.
 *
 *
 * 1. AgenticChatProvider  ──────────────────────────────────────────────────
 *    React Context provider. Must wrap the chat page (or the whole app).
 *    Bridges:
 *      - useAgentStore  (tracks run status, steps)
 *      - useStreamingStore  (tracks SSE streaming state, abort)
 *      - useBackgroundTasks  (tasks spawned during a run)
 *      - useAgenticChat  (SSE message sender / tool call watcher)
 *
 *    Key state it surfaces through context:
 *      activeChatId, isAgenticMode, thinkingMode, activeToolCalls,
 *      agentSteps, agentStatus, backgroundTasks, terminalOpen, taskPanelOpen
 *
 *    Auto-enables isAgenticMode when the first tool call arrives so the UI
 *    adapts without any user action.
 *
 *    localStorage persistence:
 *      agentic_mode_{chatId}    → per-chat agentic preference
 *      thinking_mode_{chatId}   → per-chat thinking mode
 *      agentic_global_enabled   → global feature flag
 *
 *
 * 2. AgenticMessageRenderer  ───────────────────────────────────────────────
 *    Drop-in replacement for whatever currently renders assistant messages in
 *    ChatInterface. Accepts a `message` prop with an optional `parsedMessage`
 *    (from AgenticStreamParser) and renders the correct sub-component per node:
 *
 *      text node       → MarkdownContent  (inline renderer, no external lib)
 *      thinking node   → ThinkingBlock    (collapsible, purple border)
 *      tool_call node  → ToolCallCard | CodeExecutionView | bash pre block
 *      error node      → ErrorBlock       (red alert)
 *      task_spawn node → TaskSpawnBadge   (opens TaskPanel on click)
 *
 *    For non-agentic messages (no parsedMessage) it falls back to a plain
 *    MarkdownContent block. User messages are rendered as a right-aligned
 *    bubble. Fully backwards compatible.
 *
 *
 * 3. TaskPanel  ────────────────────────────────────────────────────────────
 *    Fixed bottom-right floating panel. Mount it once in the layout (outside
 *    the router) so it persists across navigation.
 *
 *    Reads backgroundTasks, taskCount, runningTaskCount from context.
 *    Fires Sonner toasts on task completion/failure.
 *    Auto-expands for 3 s when a new task is added, then auto-collapses
 *    if the user hasn't interacted.
 *
 *
 * 4. AgenticToolbar  ───────────────────────────────────────────────────────
 *    Compact toolbar that lives just below the chat textarea.
 *    Left:   quick-action buttons (/code, /search, /analyze, /create)
 *    Middle: thinking-mode dropdown (Fast / Balanced / Deep / Creative)
 *    Right:  Agent mode toggle + running-task indicator badge
 *
 *    On mobile the 4 quick-action buttons collapse into a single "+" dropdown.
 *    Reads/writes thinkingMode, isAgenticMode, runningTaskCount from context.
 *    Calls onQuickAction(prefix) prop to inject the slash command into the
 *    textarea — the parent component controls the input state.
 *
 *
 * 5. ChatEnhancer (class) + chatEnhancer (singleton)  ──────────────────────
 *    Pure TypeScript class — no React dependency.
 *    Responsibilities:
 *      - detectAgenticIntent(text)  classifies message routing
 *      - send(options)              resolves URL, builds headers/body
 *      - streamResponse(result)     opens SSE fetch, yields AgenticStreamEvents
 *      - addMessageInterceptor      transform text before send (e.g. prepend
 *                                   system context, redact PII)
 *      - addResponseInterceptor     observe every SSE event (e.g. analytics)
 *      - buildAgentStepsFromEvents  converts raw events → AgentStep[] for store
 *      - estimateThinkingMode       heuristic: word count, code blocks, depth
 *
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INTEGRATION ORDER (important — do in this sequence)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Step 1: Wrap your app/chat page with AgenticChatProvider
 *  Step 2: Replace message renderer with AgenticMessageRenderer
 *  Step 3: Mount TaskPanel at layout level (outside router)
 *  Step 4: Add AgenticToolbar inside the chat input area
 *  Step 5: Wire chatEnhancer.send() into your existing send handler
 *
 *  See FRONTEND_INTEGRATION_GUIDE.md for full code examples.
 *
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVENT FLOW
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  User types message
 *       │
 *       ▼
 *  AgenticToolbar.onQuickAction  (optional slash prefix injection)
 *       │
 *       ▼
 *  chatEnhancer.send(options)
 *    ├─ runs messageInterceptors[]
 *    ├─ detectAgenticIntent → route to /api/chat/stream (X-Agentic: true) OR normal
 *    └─ returns EnhancedSendResult { requestId, endpoint, body, headers }
 *       │
 *       ▼
 *  chatEnhancer.streamResponse(result)  — AsyncGenerator<AgenticStreamEvent>
 *    ├─ fetch POST → SSE chunks
 *    ├─ parseSSEData → AgenticStreamEvent
 *    ├─ runs responseInterceptors[]
 *    └─ yields events
 *       │
 *       ▼
 *  AgenticStreamParser.parseEvent(event)  (from @/lib/agentic/agenticStreamParser)
 *    └─ builds ParsedAgenticMessage { nodes[] }
 *       │
 *       ├─ text node      → MarkdownContent
 *       ├─ thinking node  → ThinkingBlock
 *       ├─ tool_call node → ToolCallCard | CodeExecutionView | bash output
 *       ├─ error node     → ErrorBlock
 *       └─ task_spawn     → TaskSpawnBadge + background task added to store
 *                                │
 *                                ▼
 *                          TaskPanel (floating, toasts on complete)
 *
 *  Zustand side-effects (run in parallel with rendering):
 *    useAgentStore.updateRun  ← agentStatus, agentSteps
 *    useStreamingStore.appendContent / completeRun / failRun
 *    useBackgroundTasks  ← task list
 *
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BACKWARDS COMPATIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  - Normal (non-agentic) messages are never touched. They go through the
 *    same /api/chat/stream endpoint without the X-Agentic header and render
 *    via the plain MarkdownContent fallback in AgenticMessageRenderer.
 *
 *  - isAgenticMode defaults to false per chat. Users (or tool calls) must
 *    explicitly activate it.
 *
 *  - chatEnhancer.send() with forceNormal: true bypasses all intent detection.
 *
 *  - AgenticChatProvider can be added at any level of the tree without
 *    breaking components above it.
 *
 * =============================================================================
 */

// ─── Provider ─────────────────────────────────────────────────────────────────

export {
  AgenticChatProvider,
  AgenticChatContext,
  useAgenticChatContext,
} from './AgenticChatProvider';

export type {
  AgenticChatContextType,
  ThinkingMode,
  AgentRunStatus,
} from './AgenticChatProvider';

// ─── Message renderer ─────────────────────────────────────────────────────────

export { AgenticMessageRenderer } from './AgenticMessageRenderer';

// ─── Panels & toolbars ────────────────────────────────────────────────────────

export { TaskPanel } from './TaskPanel';
export { AgenticToolbar } from './AgenticToolbar';

export type { AgenticToolbarProps } from './AgenticToolbar';

// ─── Core enhancer ────────────────────────────────────────────────────────────

export { ChatEnhancer, chatEnhancer } from './chatEnhancer';

export type {
  EnhancedSendOptions,
  EnhancedSendResult,
  MessageInterceptor,
  ResponseInterceptor,
} from './chatEnhancer';

// ─── Re-exports from upstream integration hooks/libs (convenience) ────────────

// These are re-exported so consumers only need one import path.
// If you already import from the canonical path you can ignore these.

import { AgenticChatProvider as _AgenticChatProvider } from './AgenticChatProvider';

export type { AgenticMessage, ToolCall } from '@/hooks/useAgenticChat';
export type { ParsedAgenticMessage } from '@/lib/agentic/agenticStreamParser';
export type { BackgroundTask } from '@/hooks/useBackgroundTasks';
export type { AgenticStreamEvent, MessageNode, ToolCallStatus } from '@/lib/agentic/agenticStreamParser';

// ─── Setup helper ─────────────────────────────────────────────────────────────

/**
 * setupAgenticIntegration
 *
 * Returns a descriptive object with the provider component reference and
 * human-readable integration steps. Useful for documentation generation
 * or runtime introspection.
 *
 * @example
 * const guide = setupAgenticIntegration();
 * console.log(guide.step1_wrapApp);
 */
export function setupAgenticIntegration(): {
  providerComponent: typeof _AgenticChatProvider;
  step1_wrapApp: string;
  step2_addRenderer: string;
  step3_addTaskPanel: string;
  step4_addToolbar: string;
  step5_enhanceSend: string;
} {
  return {
    providerComponent: _AgenticChatProvider,

    step1_wrapApp: `
// In App.tsx (or your chat page):
import { AgenticChatProvider } from '@/integration';

<AgenticChatProvider chatId={currentChatId}>
  {/* your existing chat UI */}
</AgenticChatProvider>
    `.trim(),

    step2_addRenderer: `
// In your message list component:
import { AgenticMessageRenderer } from '@/integration';

// Replace your existing message renderer with:
<AgenticMessageRenderer
  message={msg}
  onRetryToolCall={(toolCall) => handleRetry(toolCall)}
/>
    `.trim(),

    step3_addTaskPanel: `
// In your root layout (outside <Router>):
import { TaskPanel } from '@/integration';

// Add once at the bottom of the layout:
<TaskPanel />
    `.trim(),

    step4_addToolbar: `
// Inside your chat input component, below the <textarea>:
import { AgenticToolbar } from '@/integration';

<AgenticToolbar
  chatId={chatId}
  onQuickAction={(prefix) => setInputValue(prefix + inputValue)}
/>
    `.trim(),

    step5_enhanceSend: `
// In your existing sendMessage handler:
import { chatEnhancer } from '@/integration';

async function handleSend(text: string) {
  const result = await chatEnhancer.send({ chatId, text, thinkingMode });
  for await (const event of chatEnhancer.streamResponse(result)) {
    // event: AgenticStreamEvent — pipe into your parser / store
  }
}
    `.trim(),
  };
}
