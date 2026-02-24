import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef, useState } from "react";
import { useStreamChat } from "@/hooks/use-stream-chat";

vi.mock("@/lib/apiClient", () => ({
  getAnonUserIdHeader: () => ({}),
}));

function makeSseResponse(events: Array<{ event: string; data: Record<string, unknown> }>, delayMs = 0): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let index = 0;
      const pushNext = () => {
        if (index >= events.length) {
          controller.close();
          return;
        }

        const current = events[index++];
        const chunk = `event: ${current.event}\ndata: ${JSON.stringify(current.data)}\n\n`;
        controller.enqueue(encoder.encode(chunk));

        if (delayMs > 0) {
          setTimeout(pushNext, delayMs);
        } else {
          pushNext();
        }
      };

      pushNext();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
}

describe("useStreamChat conversation isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes chunks only to the matching conversation and ignores events without IDs", async () => {
    const activeConversation = { current: "chat_a" };
    const sentMessages: any[] = [];
    const streamingSnapshots: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body || "{}"));

        if (payload.conversationId === "chat_a") {
          return makeSseResponse([
            {
              event: "chunk",
              data: {
                requestId: payload.requestId,
                content: "IGNORED_NO_CONVERSATION_ID",
              },
            },
            {
              event: "chunk",
              data: {
                conversationId: "chat_a",
                requestId: payload.requestId,
                content: "A_OK",
              },
            },
            {
              event: "done",
              data: {
                conversationId: "chat_a",
                requestId: payload.requestId,
              },
            },
          ]);
        }

        return makeSseResponse([
          {
            event: "chunk",
            data: {
              conversationId: "chat_b",
              requestId: payload.requestId,
              content: "B_HIDDEN_WHEN_INACTIVE",
            },
          },
          {
            event: "done",
            data: {
              conversationId: "chat_b",
              requestId: payload.requestId,
            },
          },
        ]);
      })
    );

    const { result } = renderHook(() => {
      const [optimisticMessages, setOptimisticMessages] = useState<any[]>([]);
      const [streamingContent, setStreamingContentRaw] = useState("");
      const [aiState, setAiState] = useState<any>("idle");
      const [steps, setAiProcessSteps] = useState<any[]>([]);
      const streamingContentRef = useRef("");

      const setStreamingContent = (content: string) => {
        streamingSnapshots.push(content);
        setStreamingContentRaw(content);
      };

      const hook = useStreamChat({
        setOptimisticMessages,
        onSendMessage: async (message) => {
          sentMessages.push(message);
          return undefined;
        },
        setStreamingContent,
        streamingContentRef,
        setAiState,
        setAiProcessSteps,
        getActiveConversationId: () => activeConversation.current,
      });

      return {
        hook,
        optimisticMessages,
        streamingContent,
        aiState,
        steps,
      };
    });

    await act(async () => {
      await Promise.all([
        result.current.hook.stream("/api/chat/stream", {
          conversationId: "chat_a",
          chatId: "chat_a",
          body: {
            messages: [{ role: "user", content: "A" }],
            conversationId: "chat_a",
            requestId: "req_a",
          },
        }),
        result.current.hook.stream("/api/chat/stream", {
          conversationId: "chat_b",
          chatId: "chat_b",
          body: {
            messages: [{ role: "user", content: "B" }],
            conversationId: "chat_b",
            requestId: "req_b",
          },
        }),
      ]);
    });

    expect(streamingSnapshots.some((v) => v.includes("A_OK"))).toBe(true);
    expect(streamingSnapshots.some((v) => v.includes("B_HIDDEN_WHEN_INACTIVE"))).toBe(false);
    expect(streamingSnapshots.some((v) => v.includes("IGNORED_NO_CONVERSATION_ID"))).toBe(false);

    expect(sentMessages.length).toBe(2);
    expect(sentMessages.some((m) => m.content.includes("A_OK"))).toBe(true);
    expect(sentMessages.some((m) => m.content.includes("B_HIDDEN_WHEN_INACTIVE"))).toBe(true);
  });

  it("keeps new chat idle while another conversation is streaming", async () => {
    const activeConversation = { current: "chat_a" };
    const streamingSnapshots: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body || "{}"));

        return makeSseResponse(
          [
            {
              event: "start",
              data: {
                conversationId: payload.conversationId,
                requestId: payload.requestId,
              },
            },
            {
              event: "chunk",
              data: {
                conversationId: payload.conversationId,
                requestId: payload.requestId,
                content: "LONG_RUNNING_TOKEN",
              },
            },
            {
              event: "done",
              data: {
                conversationId: payload.conversationId,
                requestId: payload.requestId,
              },
            },
          ],
          20
        );
      })
    );

    const { result } = renderHook(() => {
      const [optimisticMessages, setOptimisticMessages] = useState<any[]>([]);
      const [streamingContent, setStreamingContentRaw] = useState("");
      const [aiState, setAiState] = useState<any>("idle");
      const [steps, setAiProcessSteps] = useState<any[]>([]);
      const streamingContentRef = useRef("");

      const setStreamingContent = (content: string) => {
        streamingSnapshots.push(content);
        setStreamingContentRaw(content);
      };

      const hook = useStreamChat({
        setOptimisticMessages,
        onSendMessage: async () => undefined,
        setStreamingContent,
        streamingContentRef,
        setAiState,
        setAiProcessSteps,
        getActiveConversationId: () => activeConversation.current,
      });

      return { hook, optimisticMessages, streamingContent, aiState, steps };
    });

    const streamPromise = act(async () => {
      await result.current.hook.stream("/api/chat/stream", {
        conversationId: "chat_a",
        chatId: "chat_a",
        body: {
          messages: [{ role: "user", content: "A" }],
          conversationId: "chat_a",
          requestId: "req_a_long",
        },
      });
    });

    activeConversation.current = "chat_new";
    act(() => {
      result.current.hook.synchronizeConversation("chat_new");
    });

    await streamPromise;

    expect(result.current.streamingContent).toBe("");
    expect(streamingSnapshots.some((v) => v.includes("LONG_RUNNING_TOKEN"))).toBe(false);
  });

  it("recovers to idle if stale busy state is set after stream completion", async () => {
    vi.useFakeTimers();

    const activeConversation = { current: "chat_recovery" };
    let forceBusyState: ((value: any) => void) | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body || "{}"));

        return makeSseResponse([
          {
            event: "chunk",
            data: {
              conversationId: payload.conversationId,
              requestId: payload.requestId,
              content: "respuesta ok",
            },
          },
          {
            event: "done",
            data: {
              conversationId: payload.conversationId,
              requestId: payload.requestId,
            },
          },
        ]);
      })
    );

    const { result } = renderHook(() => {
      const [optimisticMessages, setOptimisticMessages] = useState<any[]>([]);
      const [streamingContent, setStreamingContent] = useState("");
      const [aiState, setAiState] = useState<any>("idle");
      const [steps, setAiProcessSteps] = useState<any[]>([]);
      const streamingContentRef = useRef("");

      forceBusyState = setAiState;

      const hook = useStreamChat({
        setOptimisticMessages,
        onSendMessage: async () => undefined,
        setStreamingContent,
        streamingContentRef,
        setAiState,
        setAiProcessSteps,
        getActiveConversationId: () => activeConversation.current,
      });

      return { hook, optimisticMessages, streamingContent, aiState, steps };
    });

    await act(async () => {
      await result.current.hook.stream("/api/chat/stream", {
        conversationId: "chat_recovery",
        chatId: "chat_recovery",
        body: {
          messages: [{ role: "user", content: "hola" }],
          conversationId: "chat_recovery",
          requestId: "req_recovery",
        },
        onEvent: (eventType) => {
          if (eventType === "done") {
            setTimeout(() => {
              forceBusyState?.("thinking");
            }, 0);
          }
        },
      });
    });

    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current.aiState).toBe("thinking");

    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(result.current.aiState).toBe("idle");

    vi.useRealTimers();
  });
});
