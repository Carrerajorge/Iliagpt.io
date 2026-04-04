# Frontend Agentic Integration Guide

This guide explains how to layer the agentic system on top of the existing
chat UI. The integration is additive: normal (non-agentic) messages continue
to work without any changes to the existing code paths.

---

## 1. Overview

The agentic system adds tool-use, background task management, code execution,
and streaming reasoning (thinking blocks) to the existing chat interface.

It is composed of five cooperating pieces:

| Piece | Location | Role |
|---|---|---|
| `AgenticChatProvider` | `@/integration` | Context bridge to Zustand stores |
| `AgenticMessageRenderer` | `@/integration` | Smart node-by-node message renderer |
| `TaskPanel` | `@/integration` | Floating background-task panel |
| `AgenticToolbar` | `@/integration` | Slash commands + mode picker |
| `chatEnhancer` | `@/integration` | Routing, SSE streaming, interceptors |

None of these pieces remove or replace what exists today. They wrap around
the existing `useStreamChat`, `useAgentStore`, and `useStreamingStore`.

---

## 2. Quick Start

Minimum viable integration — three lines of change:

```tsx
// App.tsx — wrap the chat page
import { AgenticChatProvider, TaskPanel } from '@/integration';

export default function App() {
  return (
    <AgenticChatProvider>
      <YourChatPage />
      <TaskPanel />          {/* mount once outside the router */}
    </AgenticChatProvider>
  );
}
```

That gives you the task panel and context. Add `AgenticMessageRenderer` and
`AgenticToolbar` when you are ready for the full experience.

---

## 3. Step-by-Step Integration

### Step 1 — Wrap the app with AgenticChatProvider

`AgenticChatProvider` needs to sit above any component that calls
`useAgenticChatContext()`. It reads from `useAgentStore` and
`useStreamingStore` so it must sit **inside** those providers (they are
already set up in `App.tsx`).

**Before:**
```tsx
// client/src/App.tsx
<QueryClientProvider client={queryClient}>
  <SettingsProvider>
    <ModelAvailabilityProvider>
      <PlatformSettingsProvider>
        <AuthProvider>
          <Router />
        </AuthProvider>
      </PlatformSettingsProvider>
    </ModelAvailabilityProvider>
  </SettingsProvider>
</QueryClientProvider>
```

**After:**
```tsx
import { AgenticChatProvider, TaskPanel } from '@/integration';

<QueryClientProvider client={queryClient}>
  <SettingsProvider>
    <ModelAvailabilityProvider>
      <PlatformSettingsProvider>
        <AuthProvider>
          <AgenticChatProvider chatId={activeChatId}>
            <Router />
            <TaskPanel />
          </AgenticChatProvider>
        </AuthProvider>
      </PlatformSettingsProvider>
    </ModelAvailabilityProvider>
  </SettingsProvider>
</QueryClientProvider>
```

`chatId` is optional at the provider level — you can also set it later via
`useAgenticChatContext().setActiveChatId(id)` inside the chat page.

---

### Step 2 — Replace the message renderer in ChatInterface

`client/src/components/chat-interface.tsx` (or wherever messages are rendered)
currently maps over messages and renders them with a component or inline JSX.

**Before (conceptual):**
```tsx
{messages.map((msg) => (
  <div key={msg.id} className={msg.role === 'user' ? 'user-msg' : 'assistant-msg'}>
    {msg.content}
  </div>
))}
```

**After:**
```tsx
import { AgenticMessageRenderer } from '@/integration';

{messages.map((msg) => (
  <AgenticMessageRenderer
    key={msg.id}
    message={{
      id: msg.id,
      role: msg.role,
      content: msg.content,
      parsedMessage: msg.parsedMessage,   // populated by agenticStreamParser
      isStreaming: msg.id === streamingMessageId,
      createdAt: msg.createdAt,
    }}
    onRetryToolCall={(toolCall) => handleRetry(toolCall)}
  />
))}
```

For messages that have no `parsedMessage`, the renderer falls back to a plain
markdown block — identical to what was rendered before.

---

### Step 3 — Mount TaskPanel at layout level

`TaskPanel` is a fixed-position component (`bottom-4 right-4 z-50`). It must
be mounted **outside** the chat route so it persists when the user navigates
between conversations.

```tsx
// client/src/App.tsx (or root layout component)
import { TaskPanel } from '@/integration';

// Inside your root JSX, after the router:
<TaskPanel />
```

The panel reads `backgroundTasks` and `runningTaskCount` from context, so it
must be inside `AgenticChatProvider`.

---

### Step 4 — Add AgenticToolbar to the chat input area

Find the chat input component (usually the one containing the `<textarea>`
for typing messages). Add `AgenticToolbar` just below or above the textarea.

```tsx
import { AgenticToolbar } from '@/integration';

function ChatInputArea({ chatId }: { chatId: string }) {
  const [inputValue, setInputValue] = useState('');

  return (
    <div className="flex flex-col border rounded-xl overflow-hidden">
      <textarea
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder="Message…"
        className="p-3 resize-none"
        rows={3}
      />
      <AgenticToolbar
        chatId={chatId}
        onQuickAction={(prefix) => {
          // Prepend the slash prefix to the current input
          setInputValue((prev) => prefix + prev);
        }}
      />
    </div>
  );
}
```

The toolbar exposes a `data-testid="agentic-toolbar"` attribute for E2E tests.

---

### Step 5 — Wire chatEnhancer to the existing send handler

`useStreamChat` currently calls `fetch('/api/chat/stream', ...)` directly.
Replace that call (or supplement it) with `chatEnhancer.send()` to get
automatic agentic routing and interceptor support.

```tsx
import { chatEnhancer } from '@/integration';
import { useAgenticChatContext } from '@/integration';

function useSendMessage() {
  const { thinkingMode, isAgenticMode } = useAgenticChatContext();

  return async (text: string, chatId: string, files?: File[]) => {
    const result = await chatEnhancer.send({
      chatId,
      text,
      files,
      thinkingMode,
      forceAgentic: isAgenticMode,
    });

    // result.endpoint === 'agentic' | 'normal'
    // result.resolvedUrl, result.body, result.headers are ready to use

    const abortController = new AbortController();

    for await (const event of chatEnhancer.streamResponse(result, abortController.signal)) {
      // Feed each event into your existing parser / state update logic
      // e.g. dispatch to your message store or call agenticStreamParser
    }
  };
}
```

Or, if you want to keep `useStreamChat` for normal messages and only use
`chatEnhancer` for agentic ones, inspect `result.endpoint` first:

```tsx
if (result.endpoint === 'agentic') {
  // handle with agenticStreamParser
} else {
  // delegate to existing useStreamChat logic
}
```

---

## 4. Component Reference

### AgenticChatProvider

| Prop | Type | Default | Description |
|---|---|---|---|
| `children` | `React.ReactNode` | required | Subtree to wrap |
| `chatId` | `string` | `undefined` | Initial active chat ID |

### AgenticMessageRenderer

| Prop | Type | Default | Description |
|---|---|---|---|
| `message.id` | `string` | required | Unique message ID |
| `message.role` | `'user' \| 'assistant'` | required | Determines bubble side |
| `message.content` | `string` | required | Raw text for fallback rendering |
| `message.parsedMessage` | `ParsedAgenticMessage` | optional | Agentic node tree |
| `message.isStreaming` | `boolean` | `false` | Shows blinking cursor on last node |
| `message.createdAt` | `number` | optional | Unix timestamp |
| `onRetryToolCall` | `(tc: ToolCall) => void` | optional | Called when user retries a tool call |
| `className` | `string` | optional | Wrapper className |

### TaskPanel

No props. Reads everything from `AgenticChatContext`.

### AgenticToolbar

| Prop | Type | Default | Description |
|---|---|---|---|
| `chatId` | `string` | required | Passed through for future per-chat toolbar state |
| `onQuickAction` | `(prefix: string) => void` | required | Called with slash prefix |
| `className` | `string` | optional | Extra classes on the toolbar root div |

---

## 5. Hook Reference

### useAgenticChatContext()

Must be called inside `<AgenticChatProvider>`. Returns `AgenticChatContextType`:

```ts
{
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;
  isAgenticMode: boolean;
  toggleAgenticMode: () => void;
  agenticEnabled: boolean;
  activeToolCalls: ToolCall[];
  agentSteps: AgentStep[];
  agentStatus: AgentRunStatus;
  backgroundTasks: BackgroundTask[];
  taskCount: number;
  runningTaskCount: number;
  terminalOpen: boolean;
  setTerminalOpen: (open: boolean) => void;
  activeTerminalSessionId: string | null;
  taskPanelOpen: boolean;
  setTaskPanelOpen: (open: boolean) => void;
  sendAgenticMessage: (text, chatId, files?) => Promise<void>;
  cancelCurrentRun: () => void;
  isStreaming: boolean;
  streamingChatId: string | null;
  thinkingMode: ThinkingMode;
  setThinkingMode: (mode: ThinkingMode) => void;
}
```

### useAgenticChat (upstream hook)

```ts
import { useAgenticChat } from '@/hooks/useAgenticChat';

const { sendMessage, toolCalls, isStreaming, messages } = useAgenticChat({
  chatId: 'abc',
  endpoint: '/api/chat/stream',
});
```

### useBackgroundTasks (upstream hook)

```ts
import { useBackgroundTasks } from '@/hooks/useBackgroundTasks';

const { tasks, taskCount, runningTaskCount } = useBackgroundTasks(chatId);
```

---

## 6. Event Flow Diagram

```
User types message
        │
        ▼
AgenticToolbar.onQuickAction     ← optional slash prefix
        │
        ▼
chatEnhancer.send(options)
  ├─ messageInterceptors[]       ← transform / augment text
  ├─ detectAgenticIntent()       ← classify routing
  └─ returns EnhancedSendResult
        │
        ▼
chatEnhancer.streamResponse(result)
  ├─ fetch POST  →  /api/chat/stream
  │     headers: X-Agentic: true   (if agentic)
  │     headers: X-Request-Id: uuid
  ├─ read SSE chunks line by line
  ├─ parseSSEData()               ← JSON parse each data: line
  ├─ responseInterceptors[]       ← observe events (analytics, logging)
  └─ yields AgenticStreamEvent
        │
        ▼
AgenticStreamParser.parseEvent()
  └─ builds ParsedAgenticMessage { nodes[] }
        │
        ├─ text node      → MarkdownContent (blinking cursor if streaming)
        ├─ thinking node  → ThinkingBlock   (collapsible, purple)
        ├─ tool_call node → ToolCallCard    (or CodeExecutionView / bash)
        ├─ error node     → ErrorBlock      (red)
        └─ task_spawn     → TaskSpawnBadge  + background task
                                │
                                ▼
                          TaskPanel (floating, toasts on done/fail)

Zustand side effects (run in parallel):
  useAgentStore.updateRun / completeRun / failRun
  useStreamingStore.appendContent / completeRun
  useBackgroundTasks  ← receives new tasks
```

---

## 7. Agentic Intent Detection

`chatEnhancer.detectAgenticIntent(text)` returns `true` when any of the
following patterns match:

**Slash commands** (prefix match):
- `/code`, `/search`, `/analyze`, `/browse`, `/run`, `/create`, `/terminal`

**Task keywords** (regex):
- "write a script", "execute", "run this", "create a file"
- "search the web", "browse to", "open terminal"
- "read the file", "write to", "save as", "delete the"
- "generate a", "download", "scrape", "fetch", "automatically"

**Multi-step chaining**:
- "then … then", "after that", "first … then"
- "step by step", "step N", "next, then", "finally … also"

**Code-related**:
- Fenced code blocks (` ``` … ` ``)
- "implement", "refactor", "debug", "fix the bug"
- "write a function / class / module"
- "compile", "build the project"

**File operations**:
- "read/write/create/open … file", "upload", "save as", "export file", "list files"

To force routing regardless of content, use `forceAgentic: true` or
`forceNormal: true` in `chatEnhancer.send()`.

---

## 8. Thinking Modes

| Mode | Icon | When to use | Cost |
|---|---|---|---|
| `fast` | Zap | Simple Q&A, short summaries, quick lookups | Low |
| `balanced` | Scale | Most everyday tasks; default | Moderate |
| `deep` | Brain | Complex analysis, long-form writing, architecture decisions | High |
| `creative` | Sparkles | Brainstorming, novel problem-solving, open-ended creative tasks | High |

`chatEnhancer.estimateThinkingMode(text)` returns a heuristic suggestion
based on word count, code presence, question depth, and creative vocabulary.
You can override it at any time via `setThinkingMode` from context or by
passing `thinkingMode` to `chatEnhancer.send()`.

The selected mode is persisted to `localStorage` per chat ID so it survives
page refreshes.

---

## 9. Customization

### Adding a custom tool renderer

By default, tool calls render through `ToolCallCard`. To render a specific
tool with custom UI, intercept in the `AgenticMessageRenderer` node loop:

```tsx
// In your own wrapper component:
import { AgenticMessageRenderer } from '@/integration';

function MyMessageRenderer({ message, ...props }) {
  // Inject custom parsedMessage nodes before passing down
  const enhanced = message.parsedMessage
    ? {
        ...message,
        parsedMessage: {
          ...message.parsedMessage,
          nodes: message.parsedMessage.nodes.map((node) => {
            if (node.type === 'tool_call' && node.toolCall?.toolName === 'my_tool') {
              return { ...node, _customRenderer: true };
            }
            return node;
          }),
        },
      }
    : message;

  return <AgenticMessageRenderer {...props} message={enhanced} />;
}
```

Or, extend `AgenticMessageRenderer` directly by adding a new case to the
`switch (node.type)` block in `AgenticMessageRenderer.tsx`.

### Adding a message interceptor

```ts
import { chatEnhancer } from '@/integration';

// Add system context before every message
const unsubscribe = chatEnhancer.addMessageInterceptor(async (text) => {
  return `[Context: user is on the dashboard page]\n\n${text}`;
});

// Later, when the component unmounts:
unsubscribe();
```

### Adding a response interceptor (analytics example)

```ts
import { chatEnhancer } from '@/integration';

chatEnhancer.addResponseInterceptor((event) => {
  if (event.type === 'tool_call_start') {
    analytics.track('tool_call', { tool: event.toolName });
  }
});
```

---

## 10. Troubleshooting

### `useAgenticChatContext must be used inside <AgenticChatProvider>`

You called `useAgenticChatContext()` in a component that is rendered outside
the provider tree. Move `<AgenticChatProvider>` higher in the component tree
so it wraps the component throwing the error.

### Tool calls arrive but `isAgenticMode` stays `false`

This should not happen — `AgenticChatProvider` auto-enables `isAgenticMode`
when the first tool call arrives. If it does, check that the `useAgenticChat`
hook is correctly connected and that `toolCalls` is non-empty when tool call
events arrive from the SSE stream.

### TaskPanel does not appear

Verify that `<TaskPanel />` is rendered inside `<AgenticChatProvider>`. It
hides itself when `taskCount === 0` and `taskPanelOpen === false`, so if you
see nothing, there may be no active tasks yet — that is expected.

### Toasts not showing

`TaskPanel` uses `import { toast } from 'sonner'`. Make sure `<Toaster />`
from `sonner` is mounted somewhere in the app (typically in `App.tsx`):

```tsx
import { Toaster } from 'sonner';

<Toaster position="bottom-right" richColors />
```

### `streamResponse` throws `Response body is null`

Your server is not returning a streaming response. Confirm the endpoint sets
`Transfer-Encoding: chunked` or `Content-Type: text/event-stream` and does
not buffer the entire response before sending.

### Agentic intent wrongly detected for simple messages

Use `forceNormal: true` when calling `chatEnhancer.send()` to bypass
detection entirely, or adjust the regex patterns in the `AGENTIC_KEYWORDS`
array at the top of `chatEnhancer.ts`.

### ThinkingMode not persisting after page reload

Check that `localStorage` is accessible (not blocked by browser privacy mode
or a strict Content Security Policy). The keys are `thinking_mode_{chatId}`
and `agentic_mode_{chatId}`.
