/**
 * thinkingTraceStore — per-conversation live reasoning trace (extended thinking).
 *
 * Fed by use-stream-chat from the typed SSE events:
 *   reasoning_delta  → appends thinking text
 *   tool_call_delta  → assembles tool calls (name + streamed argument deltas)
 *   reasoning_done   → freezes the trace with the total duration
 *
 * Keyed by conversationId AND guarded by requestId so concurrent streams in
 * different chats (or a retry replacing a stale stream) can never interleave:
 * deltas carrying a requestId different from the trace's active requestId are
 * dropped, and starting a new request resets the conversation's trace.
 */
import { create } from "zustand";

export interface ThinkingToolCall {
  index: number;
  id?: string;
  name: string;
  args: string;
}

export interface ThinkingTrace {
  requestId: string;
  reasoning: string;
  toolCalls: ThinkingToolCall[];
  startedAt: number;
  durationMs: number | null;
  status: "streaming" | "done";
}

interface ThinkingTraceState {
  traces: Record<string, ThinkingTrace>;
  startTrace: (conversationId: string, requestId: string) => void;
  appendReasoning: (conversationId: string, requestId: string, delta: string) => void;
  appendToolCall: (
    conversationId: string,
    requestId: string,
    delta: { index: number; id?: string; name?: string; argsDelta?: string },
  ) => void;
  completeReasoning: (conversationId: string, requestId: string, durationMs: number) => void;
  finishTrace: (conversationId: string) => void;
  clearTrace: (conversationId: string) => void;
}

function matchesActiveRequest(
  traces: Record<string, ThinkingTrace>,
  conversationId: string,
  requestId: string,
): ThinkingTrace | null {
  const trace = traces[conversationId];
  if (!trace) return null;
  if (requestId && trace.requestId && trace.requestId !== requestId) return null;
  return trace;
}

export const useThinkingTraceStore = create<ThinkingTraceState>((set, get) => ({
  traces: {},

  startTrace: (conversationId, requestId) => {
    if (!conversationId) return;
    set((state) => ({
      traces: {
        ...state.traces,
        [conversationId]: {
          requestId,
          reasoning: "",
          toolCalls: [],
          startedAt: Date.now(),
          durationMs: null,
          status: "streaming",
        },
      },
    }));
  },

  appendReasoning: (conversationId, requestId, delta) => {
    if (!conversationId || !delta) return;
    set((state) => {
      const trace = matchesActiveRequest(state.traces, conversationId, requestId);
      if (!trace) {
        // First reasoning delta can arrive before startTrace on recovery paths —
        // create the trace lazily so nothing is lost.
        return {
          traces: {
            ...state.traces,
            [conversationId]: {
              requestId,
              reasoning: delta,
              toolCalls: [],
              startedAt: Date.now(),
              durationMs: null,
              status: "streaming",
            },
          },
        };
      }
      return {
        traces: {
          ...state.traces,
          [conversationId]: { ...trace, reasoning: trace.reasoning + delta },
        },
      };
    });
  },

  appendToolCall: (conversationId, requestId, delta) => {
    if (!conversationId) return;
    set((state) => {
      const trace = matchesActiveRequest(state.traces, conversationId, requestId);
      if (!trace) return state;
      const toolCalls = [...trace.toolCalls];
      const existingIdx = toolCalls.findIndex((tc) => tc.index === delta.index);
      if (existingIdx >= 0) {
        const existing = toolCalls[existingIdx];
        toolCalls[existingIdx] = {
          ...existing,
          ...(delta.id ? { id: delta.id } : {}),
          ...(delta.name ? { name: delta.name } : {}),
          args: existing.args + (delta.argsDelta || ""),
        };
      } else {
        toolCalls.push({
          index: delta.index,
          ...(delta.id ? { id: delta.id } : {}),
          name: delta.name || "tool",
          args: delta.argsDelta || "",
        });
        toolCalls.sort((a, b) => a.index - b.index);
      }
      return {
        traces: {
          ...state.traces,
          [conversationId]: { ...trace, toolCalls },
        },
      };
    });
  },

  completeReasoning: (conversationId, requestId, durationMs) => {
    if (!conversationId) return;
    set((state) => {
      const trace = matchesActiveRequest(state.traces, conversationId, requestId);
      if (!trace) return state;
      return {
        traces: {
          ...state.traces,
          [conversationId]: {
            ...trace,
            durationMs,
            status: "done",
          },
        },
      };
    });
  },

  finishTrace: (conversationId) => {
    if (!conversationId) return;
    const trace = get().traces[conversationId];
    if (!trace || trace.status === "done") return;
    set((state) => ({
      traces: {
        ...state.traces,
        [conversationId]: {
          ...trace,
          durationMs: trace.durationMs ?? Date.now() - trace.startedAt,
          status: "done",
        },
      },
    }));
  },

  clearTrace: (conversationId) => {
    if (!conversationId) return;
    set((state) => {
      if (!state.traces[conversationId]) return state;
      const next = { ...state.traces };
      delete next[conversationId];
      return { traces: next };
    });
  },
}));

/** Selector helper: live trace for a conversation (null when none). */
export function selectThinkingTrace(conversationId: string | null | undefined) {
  return (state: ThinkingTraceState): ThinkingTrace | null =>
    conversationId ? state.traces[conversationId] ?? null : null;
}
