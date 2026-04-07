import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef, useState } from "react";
import { useStreamChat } from "@/hooks/use-stream-chat";

vi.mock("@/lib/apiClient", () => ({
  getAnonUserIdHeader: () => ({}),
  apiFetch: vi.fn(async (_url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    if (method === "DELETE") {
      return new Response("", { status: 200 });
    }
    return new Response("{}", {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }),
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

function makeDelayedSseResponse(
  events: Array<{ event: string; data: Record<string, unknown> }>,
  initialDelayMs: number,
  delayMs = 0
): Response {
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

      setTimeout(pushNext, initialDelayMs);
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

  it("supports custom chunk handling without duplicating the default streaming buffer", async () => {
    const customChunks: string[] = [];
    const sentMessages: any[] = [];

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
              content: "hola ",
            },
          },
          {
            event: "chunk",
            data: {
              conversationId: payload.conversationId,
              requestId: payload.requestId,
              content: "mundo",
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
        getActiveConversationId: () => "chat_custom_chunk",
      });

      return { hook, optimisticMessages, streamingContent, aiState, steps };
    });

    await act(async () => {
      await result.current.hook.stream("/api/chat/stream", {
        conversationId: "chat_custom_chunk",
        chatId: "chat_custom_chunk",
        body: {
          messages: [{ role: "user", content: "hola" }],
          conversationId: "chat_custom_chunk",
          requestId: "req_custom_chunk",
        },
        onChunk: (chunk, _event, fullContent) => {
          customChunks.push(`${chunk}|${fullContent}`);
          return false;
        },
      });
    });

    expect(customChunks).toEqual(["hola |hola ", "mundo|hola mundo"]);
    expect(result.current.streamingContent).toBe("");
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].content).toBe("hola mundo");
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

  it("waits for terminal done after a server error event and finalizes once", async () => {
    const sentMessages: any[] = [];
    const seenEvents: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body || "{}"));

        return makeSseResponse([
          {
            event: "error",
            data: {
              conversationId: payload.conversationId,
              requestId: payload.requestId,
              error: "provider stream failed",
            },
          },
          {
            event: "done",
            data: {
              conversationId: payload.conversationId,
              requestId: payload.requestId,
              error: true,
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
        getActiveConversationId: () => "chat_err",
      });

      return { hook, optimisticMessages, streamingContent, aiState, steps };
    });

    let streamResult: any;
    await act(async () => {
      streamResult = await result.current.hook.stream("/api/chat/stream", {
        conversationId: "chat_err",
        chatId: "chat_err",
        body: {
          messages: [{ role: "user", content: "hola" }],
          conversationId: "chat_err",
          requestId: "req_err",
        },
        onEvent: (eventType) => {
          seenEvents.push(eventType);
        },
        buildErrorMessage: (error, messageId) => ({
          id: messageId || "assistant_err",
          role: "assistant" as const,
          content: `ERR:${error.message}`,
          timestamp: new Date(),
          requestId: "req_err",
        }),
      });
    });

    expect(streamResult.ok).toBe(false);
    expect(streamResult.error?.message).toBe("provider stream failed");
    expect(seenEvents).toEqual(["error", "done"]);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].content).toBe("ERR:provider stream failed");
    expect(result.current.optimisticMessages).toHaveLength(1);
  });

  it("resets session finalization state between consecutive queries in the same conversation", async () => {
    const sentMessages: any[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body || "{}"));
        const content = payload.requestId === "req_second" ? "segunda respuesta" : "primera respuesta";

        return makeSseResponse([
          {
            event: "chunk",
            data: {
              conversationId: payload.conversationId,
              requestId: payload.requestId,
              content,
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
        getActiveConversationId: () => "chat_repeat",
      });

      return { hook, optimisticMessages, streamingContent, aiState, steps };
    });

    await act(async () => {
      await result.current.hook.stream("/api/chat/stream", {
        conversationId: "chat_repeat",
        chatId: "chat_repeat",
        body: {
          messages: [{ role: "user", content: "uno" }],
          conversationId: "chat_repeat",
          requestId: "req_first",
        },
      });
    });

    await act(async () => {
      await result.current.hook.stream("/api/chat/stream", {
        conversationId: "chat_repeat",
        chatId: "chat_repeat",
        body: {
          messages: [{ role: "user", content: "dos" }],
          conversationId: "chat_repeat",
          requestId: "req_second",
        },
      });
    });

    expect(sentMessages).toHaveLength(2);
    expect(sentMessages.map((message) => message.content)).toEqual([
      "primera respuesta",
      "segunda respuesta",
    ]);
    expect(result.current.optimisticMessages).toHaveLength(2);
  });

  it("keeps the AI state in thinking until the first token arrives", async () => {
    vi.useFakeTimers();

    const sentMessages: any[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body || "{}"));

        return makeDelayedSseResponse(
          [
            {
              event: "chunk",
              data: {
                conversationId: payload.conversationId,
                requestId: payload.requestId,
                content: "token tardio",
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
          25
        );
      })
    );

    const { result } = renderHook(() => {
      const [optimisticMessages, setOptimisticMessages] = useState<any[]>([]);
      const [streamingContent, setStreamingContent] = useState("");
      const [aiState, setAiState] = useState<any>("idle");
      const [steps, setAiProcessSteps] = useState<any[]>([]);
      const streamingContentRef = useRef("");

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
        getActiveConversationId: () => "chat_thinking",
      });

      return { hook, optimisticMessages, streamingContent, aiState, steps };
    });

    let streamPromise!: Promise<any>;
    await act(async () => {
      streamPromise = result.current.hook.stream("/api/chat/stream", {
        conversationId: "chat_thinking",
        chatId: "chat_thinking",
        body: {
          messages: [{ role: "user", content: "hola" }],
          conversationId: "chat_thinking",
          requestId: "req_thinking",
        },
      });
      await Promise.resolve();
    });

    expect(result.current.aiState).toBe("thinking");

    await act(async () => {
      vi.advanceTimersByTime(25);
      await streamPromise;
    });

    expect(sentMessages).toHaveLength(1);

    vi.useRealTimers();
  });

  it("injects the stream requestId into the final message when the done event omits it", async () => {
    const sentMessages: any[] = [];

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
              content: "respuesta estable",
            },
          },
          {
            event: "done",
            data: {
              conversationId: payload.conversationId,
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
        getActiveConversationId: () => "chat_reqid",
      });

      return { hook, optimisticMessages, streamingContent, aiState, steps };
    });

    await act(async () => {
      await result.current.hook.stream("/api/chat/stream", {
        conversationId: "chat_reqid",
        chatId: "chat_reqid",
        body: {
          messages: [{ role: "user", content: "hola" }],
          conversationId: "chat_reqid",
          requestId: "req_missing_done_id",
        },
      });
    });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].requestId).toBe("req_missing_done_id");
  });

  it("reuses the server assistant message id and skips client re-persist when SSE already owns persistence", async () => {
    const sentMessages: any[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body || "{}"));

        return makeSseResponse([
          {
            event: "context",
            data: {
              conversationId: payload.conversationId,
              requestId: payload.requestId,
              assistantMessageId: "srv-assistant-123",
            },
          },
          {
            event: "chunk",
            data: {
              conversationId: payload.conversationId,
              requestId: payload.requestId,
              assistantMessageId: "srv-assistant-123",
              content: "respuesta sin duplicado",
            },
          },
          {
            event: "done",
            data: {
              conversationId: payload.conversationId,
              requestId: payload.requestId,
              assistantMessageId: "srv-assistant-123",
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
        getActiveConversationId: () => "chat_server_owned",
      });

      return { hook, optimisticMessages, streamingContent, aiState, steps };
    });

    await act(async () => {
      await result.current.hook.stream("/api/chat/stream", {
        conversationId: "chat_server_owned",
        chatId: "chat_server_owned",
        body: {
          messages: [{ role: "user", content: "hola" }],
          conversationId: "chat_server_owned",
          requestId: "req_server_owned",
        },
      });
    });

    expect(sentMessages).toHaveLength(0);
    expect(result.current.optimisticMessages).toHaveLength(1);
    expect(result.current.optimisticMessages[0].id).toBe("srv-assistant-123");
    expect(result.current.optimisticMessages[0].clientTempId).toMatch(/^assistant-/);
    expect(result.current.optimisticMessages[0].content).toBe("respuesta sin duplicado");
  });
});
