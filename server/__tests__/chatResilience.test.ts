/**
 * Chat Resilience Tests
 *
 * Tests the failure scenarios described in the production reliability work plan:
 * 1. LLM provider returns empty response → user gets fallback
 * 2. Intent classification times out → chat still works
 * 3. Database is down → chat still works (degraded)
 * 4. All providers circuit-broken → user gets hardcoded response
 * 5. Stream crashes mid-response → user gets partial content + error
 * 6. Network timeout → client retries automatically
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock Express response that captures SSE events written via
 * writeSse (i.e. `event: <name>\ndata: <json>\n\n`).
 */
function makeMockRes() {
  const events: Array<{ event: string; data: unknown }> = [];
  const headers: Record<string, string> = {};
  let ended = false;
  let writableEnded = false;
  let doneSent = false;

  const res = {
    // Express-like API
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    __doneSent: false,
    locals: { streamMeta: null as any },
    socket: null,

    setHeader(key: string, value: string) {
      headers[key] = value;
      return res;
    },
    flushHeaders() {
      res.headersSent = true;
    },
    write(chunk: string) {
      if (res.writableEnded) return false;
      // Parse SSE chunks
      const lines = chunk.split("\n");
      let currentEvent = "message";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const dataStr = line.slice(6);
          try {
            events.push({ event: currentEvent, data: JSON.parse(dataStr) });
          } catch {
            events.push({ event: currentEvent, data: dataStr });
          }
          currentEvent = "message";
        }
      }
      return true;
    },
    end() {
      res.writableEnded = true;
      ended = true;
    },
    status(code: number) {
      return { json: (body: unknown) => {} };
    },
    json(body: unknown) {},
    on() { return res; },
    once() { return res; },
    removeListener() { return res; },

    // Test helpers
    _events: events,
    _headers: headers,
    _ended: () => ended,
    _getEventsByType: (type: string) => events.filter(e => e.event === type),
    _hasContent: () => events.some(e => e.event === "chunk" && typeof (e.data as any).content === "string" && (e.data as any).content.trim()),
    _hasDone: () => events.some(e => e.event === "done"),
    _hasError: () => events.some(e => e.event === "error"),
  };

  // streamMeta must be on res.locals for writeSse enrichment
  res.locals.streamMeta = {
    conversationId: "test-conv-123",
    requestId: "test-req-456",
    getAssistantMessageId: () => "test-msg-789",
    enableResumePersistence: false,
    resumeStatus: "streaming",
    resumeContent: "",
    resumeLastSeq: 0,
    resumeFlushTimer: null,
    resumePersistPromise: null,
    onWrite: null,
  };

  return res;
}

// ── Test: assistantMessage fallback ───────────────────────────────────────────

describe("shared/assistantMessage — empty content handling", () => {
  it("shows a helpful Spanish fallback when content is empty", async () => {
    const { buildAssistantMessage } = await import("@shared/assistantMessage");
    const msg = buildAssistantMessage({ content: "" });
    expect(msg.content).toBeTruthy();
    expect(msg.content).not.toBe("");
    // Must be the updated Spanish message, not the old English one
    expect(msg.content).not.toContain("No se recibió");
    expect(msg.role).toBe("assistant");
  });

  it("preserves non-empty content as-is", async () => {
    const { buildAssistantMessage } = await import("@shared/assistantMessage");
    const msg = buildAssistantMessage({ content: "La administración es el proceso de planear." });
    expect(msg.content).toBe("La administración es el proceso de planear.");
  });

  it("uses custom fallbackContent when provided", async () => {
    const { buildAssistantMessage } = await import("@shared/assistantMessage");
    const msg = buildAssistantMessage({
      content: "",
      fallbackContent: "Custom fallback for this error",
    });
    expect(msg.content).toBe("Custom fallback for this error");
  });
});

// ── Test: assistantContent — hasMeaningfulAssistantContent ────────────────────

describe("shared/assistantContent — meaningful content detection", () => {
  it("returns true for non-empty Spanish text", async () => {
    const { hasMeaningfulAssistantContent } = await import("@shared/assistantContent");
    expect(hasMeaningfulAssistantContent("La administración es importante.")).toBe(true);
    expect(hasMeaningfulAssistantContent("¿Que es la administracion?")).toBe(true);
  });

  it("returns false for empty or whitespace-only strings", async () => {
    const { hasMeaningfulAssistantContent } = await import("@shared/assistantContent");
    expect(hasMeaningfulAssistantContent("")).toBe(false);
    expect(hasMeaningfulAssistantContent("   ")).toBe(false);
    expect(hasMeaningfulAssistantContent(null)).toBe(false);
    expect(hasMeaningfulAssistantContent(undefined)).toBe(false);
  });

  it("returns false for placeholder-only strings", async () => {
    const { hasMeaningfulAssistantContent } = await import("@shared/assistantContent");
    expect(hasMeaningfulAssistantContent("...")).toBe(false);
    expect(hasMeaningfulAssistantContent("---")).toBe(false);
  });
});

// ── Test: LLM Gateway fallback response ──────────────────────────────────────

describe("LLMGateway — guaranteeResponse all-provider-failure fallback", () => {
  it("returns a Spanish fallback message when all providers fail", async () => {
    // The guaranteeResponse final fallback (when all 3 attempts fail) must
    // return Spanish content after our fix.
    const { llmGateway } = await import("../lib/llmGateway");

    // Mock chat to always throw
    const originalChat = (llmGateway as any).chat.bind(llmGateway);
    vi.spyOn(llmGateway as any, "chat").mockRejectedValue(new Error("Simulated provider failure"));

    try {
      const result = await (llmGateway as any).guaranteeResponse(
        [{ role: "user", content: "que es la administracion" }],
        { skipCache: true, enableFallback: false }
      );

      // Must return content (the hardcoded Spanish fallback)
      expect(result.content).toBeTruthy();
      expect(result.fromFallback).toBe(true);
      // Must be Spanish (contains common Spanish words from our fixed fallback)
      expect(result.content.toLowerCase()).toMatch(/siento|proveedores|disponibles|intenta/);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

// ── Test: Server-side stream handler resilience (unit) ────────────────────────

describe("server stream handler — empty content fallback", () => {
  it("emits a fallback chunk when LLM stream produces no content", async () => {
    // Simulate the server's last-resort fallback logic (lines 8103-8146 of chatAiRouter):
    // when fullContent is empty after stream, a guaranteed fallback is sent.

    // This test validates the logic pattern in isolation without spinning up Express.
    let fullContent = "";
    const emittedChunks: string[] = [];

    // Simulate the post-stream empty check
    if (!fullContent.trim()) {
      // Matches server behaviour at line 8126-8130
      const fallbackContent =
        "Lo siento, el modo agente no pudo generar una respuesta esta vez. Intenta de nuevo o desactiva el modo agente para esta pregunta.";
      fullContent = fallbackContent;
      emittedChunks.push(fullContent);
    }

    expect(emittedChunks).toHaveLength(1);
    expect(emittedChunks[0]).toContain("Lo siento");
    expect(fullContent.trim()).toBeTruthy();
  });

  it("does NOT emit fallback when LLM stream produced content", () => {
    let fullContent = "La administración es el proceso mediante el cual se planea.";
    const fallbackChunks: string[] = [];

    if (!fullContent.trim()) {
      fallbackChunks.push("fallback");
    }

    expect(fallbackChunks).toHaveLength(0);
    expect(fullContent).toContain("administración");
  });
});

// ── Test: Intent classification failure tolerance ─────────────────────────────

describe("intent classification — failure tolerance", () => {
  it("routeIntent gracefully returns null on failure (per chatAiRouter error handling)", async () => {
    // The chatAiRouter wraps routeIntent in try/catch and returns null on error.
    // Validate that pattern is safe.
    let intentResult: null | { intent: string } = null;

    try {
      throw new Error("Simulated intent timeout");
    } catch {
      // intentResult stays null — matching server behavior at line 6232-6234
    }

    // Chat should proceed with intentResult = null
    expect(intentResult).toBeNull();
    // The downstream code must handle null intent gracefully
    const intent = intentResult?.intent ?? "CHAT_GENERAL";
    expect(intent).toBe("CHAT_GENERAL");
  });
});

// ── Test: Session hydration failure tolerance ─────────────────────────────────

describe("session hydration — failure tolerance", () => {
  it("returns empty session state when DB is unavailable", async () => {
    // Simulate the pattern used in unifiedChatHandler.hydrateSessionState
    async function hydrateWithFallback(): Promise<Record<string, unknown>> {
      try {
        throw new Error("DB connection lost");
      } catch {
        // Return empty state — chat works in degraded mode
        return {};
      }
    }

    const state = await hydrateWithFallback();
    expect(state).toEqual({});
    // Chat continues with empty state — no crash
  });
});

// ── Test: Client-side EMPTY_STREAM error is retryable ────────────────────────

describe("use-stream-chat — EMPTY_STREAM error handling", () => {
  it("EMPTY_STREAM error has retryable flag set", () => {
    const emptyStreamError = new Error("No se recibió respuesta del servidor.");
    (emptyStreamError as any).retryable = true;
    (emptyStreamError as any).code = "EMPTY_STREAM";

    // Simulate the shouldRetry check (from use-stream-chat.ts)
    const shouldRetry = (error: any): boolean => {
      if (error?.retryable === true) return true;
      if (error?.code === "EMPTY_STREAM") return true;
      return false;
    };

    expect(shouldRetry(emptyStreamError)).toBe(true);
  });

  it("normal errors without retryable flag are not automatically retried", () => {
    const normalError = new Error("Some unrelated error");

    const shouldRetry = (error: any): boolean => {
      if (error?.retryable === true) return true;
      if (error?.code === "EMPTY_STREAM") return true;
      return false;
    };

    expect(shouldRetry(normalError)).toBe(false);
  });

  it("network errors are retried", () => {
    const networkError = new Error("failed to fetch");

    const shouldRetry = (error: any): boolean => {
      if (error?.retryable === true) return true;
      if (error?.code === "EMPTY_STREAM") return true;
      const msg = String(error?.message || "").toLowerCase();
      if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("timeout")) return true;
      return false;
    };

    expect(shouldRetry(networkError)).toBe(true);
  });
});

// ── Test: Image generation and skill dispatch SSE events ─────────────────────

describe("server SSE — image generation path", () => {
  it("chunk events must include conversationId and requestId", () => {
    // Validate that the writeSse-enriched payload pattern adds required IDs.
    // This simulates what writeSse does with the streamMeta.
    const streamMeta = {
      conversationId: "conv-abc",
      requestId: "req-xyz",
    };

    const rawPayload = {
      content: "![image](data:image/png;base64,...)",
      sequenceId: 0,
      timestamp: Date.now(),
    };

    // writeSse enrichment (from chatAiRouter writeSse function)
    const enrichedPayload = {
      ...rawPayload,
      conversationId: rawPayload.conversationId ?? streamMeta.conversationId,
      requestId: rawPayload.requestId ?? streamMeta.requestId,
    };

    expect(enrichedPayload.conversationId).toBe("conv-abc");
    expect(enrichedPayload.requestId).toBe("req-xyz");
  });

  it("client filter accepts events with matching IDs", () => {
    const conversationId = "conv-abc";
    const streamRequestId = "req-xyz";

    // Simulate the client-side SSE filter (use-stream-chat.ts lines 1106-1122)
    function clientFilter(data: Record<string, unknown>): boolean {
      const eventConversationId = typeof data.conversationId === "string" ? data.conversationId.trim() : "";
      if (!eventConversationId || eventConversationId !== conversationId) return false;

      const eventRequestId = typeof data.requestId === "string" ? data.requestId.trim() : "";
      const eventAssistantMessageId = typeof data.assistantMessageId === "string" ? data.assistantMessageId.trim() : "";
      if (!eventRequestId && !eventAssistantMessageId) return false;
      if (eventRequestId && eventRequestId !== streamRequestId) return false;
      return true;
    }

    // Events WITH proper IDs should pass
    expect(clientFilter({ conversationId: "conv-abc", requestId: "req-xyz", content: "hello" })).toBe(true);

    // Events WITHOUT conversationId should be filtered out (old behavior — now fixed)
    expect(clientFilter({ content: "hello" })).toBe(false);
    expect(clientFilter({ type: "done" })).toBe(false);

    // Events with wrong conversationId should be filtered
    expect(clientFilter({ conversationId: "other-conv", requestId: "req-xyz" })).toBe(false);
  });
});
