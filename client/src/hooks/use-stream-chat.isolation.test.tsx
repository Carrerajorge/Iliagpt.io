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
          // Close asynchronously so reader.read() can pick up enqueued chunks
          // before the stream signals done. Without this, some Node.js versions
          // (e.g. Node 22) may return { done: true } immediately on read().
          Promise.resolve().then(() => controller.close());
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
          Promise.resolve().then(() => controller.close());
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

  it("queues same-conversation streams locally by default and forwards queueMode=queue", async () => {
    const activeConversation = { current: "chat_queue" };
    const sentMessages: any[] = [];
    const requestPayloads: any[] = [];

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body || "{}"));
      requestPayloads.push(payload);

      return makeSseResponse(
        [
          {
            event: "chunk",
            data: {
              conversationId: "chat_queue",
              requestId: payload.requestId,
              content: requestPayloads.length === 1 ? "FIRST" : "SECOND",
            },
          },
          {
            event: "done",
            data: {
              conversationId: "chat_queue",
              requestId: payload.requestId,
            },
          },
        ],
        requestPayloads.length === 1 ? 25 : 0,
      );
    });

    vi.stubGlobal("fetch", fetchMock);

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

    let firstPromise!: Promise<any>;
    let secondPromise!: Promise<any>;

    await act(async () => {
      firstPromise = result.current.hook.stream("/api/chat/stream", {
        conversationId: "chat_queue",
        chatId: "chat_queue",
        body: {
          messages: [{ role: "user", content: "first" }],
          conversationId: "chat_queue",
        },
      });

      secondPromise = result.current.hook.stream("/api/chat/stream", {
        conversationId: "chat_queue",
        chatId: "chat_queue",
        body: {
          messages: [{ role: "user", content: "second" }],
          conversationId: "chat_queue",
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.aiState).toBe("queued");
    expect(result.current.steps.some((step: any) => step?.id === "conversation-queue")).toBe(true);

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestPayloads.map((payload) => payload.queueMode)).toEqual(["queue", "queue"]);
    expect(sentMessages.map((message) => message.content)).toEqual(["FIRST", "SECOND"]);
  });

  it("surfaces Retry-After nicely when the chat is temporarily busy", async () => {
    const activeConversation = { current: "chat_retry" };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "busy" }), {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "7",
          },
        })
      )
    );

    const { result } = renderHook(() => {
      const [optimisticMessages, setOptimisticMessages] = useState<any[]>([]);
      const [streamingContent, setStreamingContent] = useState("");
      const [aiState, setAiState] = useState<any>("idle");
      const [steps, setAiProcessSteps] = useState<any[]>([]);
      const streamingContentRef = useRef("");

      const hook = useStreamChat({
        setOptimisticMessages,
        onSendMessage: async () => undefined,
        setStreamingContent,
        streamingContentRef,
        setAiState,
        setAiProcessSteps,
        getActiveConversationId: () => activeConversation.current,
      });

      return { hook, aiState, steps, optimisticMessages, streamingContent };
    });

    let streamResult: any;
    await act(async () => {
      streamResult = await result.current.hook.stream("/api/chat/stream", {
        conversationId: "chat_retry",
        chatId: "chat_retry",
        body: {
          messages: [{ role: "user", content: "retry" }],
          conversationId: "chat_retry",
        },
      });
    });

    expect(streamResult.ok).toBe(false);
    expect(streamResult.error?.message).toContain("Reintenta en 7s");
  });

  it("shows reconnecting state while retrying a broken stream", async () => {
    const activeConversation = { current: "chat_reconnect" };
    let callCount = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        callCount += 1;
        const payload = JSON.parse(String(init?.body || "{}"));

        if (callCount === 1) {
          throw new Error("network error");
        }

        return makeSseResponse([
          {
            event: "chunk",
            data: {
              conversationId: payload.conversationId,
              requestId: payload.requestId,
              content: "RECOVERED",
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
        onSendMessage: async () => undefined,
        setStreamingContent,
        streamingContentRef,
        setAiState,
        setAiProcessSteps,
        getActiveConversationId: () => activeConversation.current,
      });

      return { hook, aiState, steps, optimisticMessages, streamingContent };
    });

    let promise!: Promise<any>;
    await act(async () => {
      promise = result.current.hook.stream("/api/chat/stream", {
        conversationId: "chat_reconnect",
        chatId: "chat_reconnect",
        body: {
          messages: [{ role: "user", content: "retry me" }],
          conversationId: "chat_reconnect",
        },
        retryBackoffMs: 20,
        retryJitterMs: 0,
      });

      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    expect(result.current.aiState).toBe("reconnecting");
    expect(result.current.steps.some((step: any) => step?.id === "stream-reconnect")).toBe(true);

    const finalResult = await promise;
    expect(finalResult.ok).toBe(true);
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
    // The error message is sent via onSendMessage (which inserts into chat state),
    // not into optimisticMessages — this prevents duplicate rendering.
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
    // Without a server assistantMessageId, messages go through onSendMessage
    // (verified above) and NOT through optimisticMessages — this prevents
    // the duplicate that arises when both sources contain the same message.
    expect(result.current.optimisticMessages).toHaveLength(0);
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

  it("accepts done.answer_text when the server finishes without chunk events", async () => {
    const sentMessages: any[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body || "{}"));

        return makeSseResponse([
          {
            event: "thinking",
            data: {
              conversationId: payload.conversationId,
              requestId: payload.requestId,
              step: "llm",
            },
          },
          {
            event: "done",
            data: {
              conversationId: payload.conversationId,
              requestId: payload.requestId,
              answer_text: "Resumen ejecutivo listo.",
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
        getActiveConversationId: () => "chat_done_only",
      });

      return { hook, optimisticMessages, streamingContent, aiState, steps };
    });

    let streamResult: any;
    await act(async () => {
      streamResult = await result.current.hook.stream("/api/analyze", {
        conversationId: "chat_done_only",
        chatId: "chat_done_only",
        body: {
          messages: [{ role: "user", content: "analiza el documento" }],
          conversationId: "chat_done_only",
          requestId: "req_done_only",
        },
      });
    });

    expect(streamResult.ok).toBe(true);
    expect(streamResult.content).toBe("Resumen ejecutivo listo.");
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].content).toBe("Resumen ejecutivo listo.");
    expect(streamResult.message?.content).toBe("Resumen ejecutivo listo.");
  });
});
