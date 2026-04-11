/**
 * Cognitive Middleware — comprehensive test suite.
 *
 * Coverage:
 *
 *   1. Intent router (deterministic heuristic, ~10 cases)
 *   2. Output validator (every issue code at least once)
 *   3. Provider selection (preferred / first capable / no match)
 *   4. Mock provider adapters (echo, scripted, failing, abortable)
 *   5. Full orchestrator pipeline (happy path)
 *   6. Retries on transient failure
 *   7. Cancellation propagation via AbortSignal
 *   8. Concurrency: 50 parallel requests with isolated state
 *   9. Multi-LLM normalization: same request through 3 different
 *      mock adapters produces structurally equivalent responses
 *  10. Failure modes: no adapters, no capable adapter, throwing
 *      adapter, content_filter, length truncation
 */

import { describe, it, expect } from "vitest";
import {
  classifyIntent,
  validateOutput,
  selectProvider,
  buildNormalizedRequest,
  CognitiveMiddleware,
  EchoMockAdapter,
  ScriptedMockAdapter,
  FailingMockAdapter,
  AbortableMockAdapter,
  ToolEmittingMockAdapter,
  type ProviderAdapter,
  type ProviderResponse,
  type CognitiveIntent,
} from "../cognitive";

// ---------------------------------------------------------------------------
// 1. Intent router
// ---------------------------------------------------------------------------

describe("cognitive: intent router (deterministic heuristic)", () => {
  it("1 classifies a clear question as qa", () => {
    const result = classifyIntent("What is the capital of France?");
    expect(result.intent).toBe("qa");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("2 classifies an image-generation request", () => {
    const result = classifyIntent("Generate an image of a sunset over Paris");
    expect(result.intent).toBe("image_generation");
    expect(result.confidence).toBe(1);
  });

  it("3 classifies a translation request", () => {
    const result = classifyIntent('Translate "hello world" to French');
    expect(result.intent).toBe("translation");
    expect(result.confidence).toBe(1);
  });

  it("4 classifies a Spanish translation request", () => {
    const result = classifyIntent("Traduce 'hello' al español");
    expect(result.intent).toBe("translation");
  });

  it("5 classifies a summarization request", () => {
    const result = classifyIntent("Summarize this article in two sentences");
    expect(result.intent).toBe("summarization");
  });

  it("6 classifies a code generation request", () => {
    const result = classifyIntent("Write a Python function to sort a list");
    expect(result.intent).toBe("code_generation");
  });

  it("7 classifies a document generation request", () => {
    const result = classifyIntent("Create a Word document with the meeting minutes");
    expect(result.intent).toBe("doc_generation");
  });

  it("8 classifies a data analysis request", () => {
    const result = classifyIntent("Analyze this CSV and plot the trends");
    expect(result.intent).toBe("data_analysis");
  });

  it("9 falls back to chat for arbitrary statements", () => {
    const result = classifyIntent("Hello there, how is your day going");
    expect(result.intent).toBe("chat");
    expect(result.confidence).toBe(0);
  });

  it("10 returns unknown for empty input", () => {
    const result = classifyIntent("");
    expect(result.intent).toBe("unknown");
    expect(result.confidence).toBe(0);
  });

  it("11 a strong heuristic match overrides a contradictory hint", () => {
    // User explicitly asks to translate; UI hints "image_generation".
    // The classifier must still pick translation (the deterministic
    // signal is unambiguous).
    const result = classifyIntent(
      "Translate 'Hello' to French",
      "image_generation",
    );
    expect(result.intent).toBe("translation");
  });

  it("12 a hint reinforces a weak match", () => {
    // "Hello there" alone defaults to chat. With a `qa` hint AND no
    // strong matches, the hint is ignored — the classifier still
    // returns chat with low confidence. Verify the hint shows up in
    // alternatives at low confidence.
    const result = classifyIntent("Hello there", "qa");
    expect(result.intent).toBe("qa");
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("13 evaluateRules is deterministic", () => {
    const a = classifyIntent("Generate an image of a cat");
    const b = classifyIntent("Generate an image of a cat");
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// 2. Output validator
// ---------------------------------------------------------------------------

describe("cognitive: output validator", () => {
  const goodResponse: ProviderResponse = {
    text: "Paris is the capital of France.",
    finishReason: "stop",
    toolCalls: [],
    usage: { promptTokens: 10, completionTokens: 7 },
  };

  it("14 returns ok=true for a clean response", () => {
    const report = validateOutput(goodResponse);
    expect(report.ok).toBe(true);
    expect(report.issues.length).toBe(0);
  });

  it("15 flags provider error finishReason", () => {
    const report = validateOutput({
      ...goodResponse,
      text: "",
      finishReason: "error",
    });
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.code === "provider_error")).toBe(true);
  });

  it("16 flags content_filter as an error", () => {
    const report = validateOutput({
      ...goodResponse,
      text: "",
      finishReason: "content_filter",
    });
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.code === "content_filter")).toBe(true);
  });

  it("17 flags aborted as an error", () => {
    const report = validateOutput({
      ...goodResponse,
      text: "",
      finishReason: "aborted",
    });
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.code === "aborted")).toBe(true);
  });

  it("18 flags empty response with stop finishReason", () => {
    const report = validateOutput({
      text: "",
      finishReason: "stop",
      toolCalls: [],
    });
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.code === "empty_response")).toBe(true);
  });

  it("19 flags refusal phrases as warnings (not errors)", () => {
    const report = validateOutput({
      ...goodResponse,
      text: "I'm sorry, I can't help with that request.",
    });
    expect(report.refusalDetected).toBe(true);
    expect(report.ok).toBe(true); // refusal is a warning, not an error
    expect(
      report.issues.some(
        (i) => i.code === "refusal_detected" && i.severity === "warning",
      ),
    ).toBe(true);
  });

  it("20 flags Spanish refusal phrases", () => {
    const report = validateOutput({
      ...goodResponse,
      text: "Lo siento, no puedo ayudarte con eso.",
    });
    expect(report.refusalDetected).toBe(true);
  });

  it("21 flags length truncation as a warning", () => {
    const report = validateOutput({
      ...goodResponse,
      finishReason: "length",
    });
    expect(
      report.issues.some(
        (i) => i.code === "length_truncation" && i.severity === "warning",
      ),
    ).toBe(true);
  });

  it("22 validates tool calls against declared schemas", () => {
    const report = validateOutput(
      {
        text: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call_1",
            name: "search",
            args: { query: "hello" },
          },
        ],
      },
      {
        toolDescriptors: [
          {
            name: "search",
            description: "search the web",
            inputSchema: { type: "object", required: ["query"] },
          },
        ],
      },
    );
    expect(report.ok).toBe(true);
    expect(report.toolCallsValid).toBe(true);
  });

  it("23 catches tool calls with missing required args", () => {
    const report = validateOutput(
      {
        text: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call_1",
            name: "search",
            args: {}, // missing "query"
          },
        ],
      },
      {
        toolDescriptors: [
          {
            name: "search",
            description: "search the web",
            inputSchema: { type: "object", required: ["query"] },
          },
        ],
      },
    );
    expect(report.ok).toBe(false);
    expect(report.toolCallsValid).toBe(false);
    expect(
      report.issues.some((i) => i.code === "tool_args_missing_required"),
    ).toBe(true);
  });

  it("24 warns on unknown tool names", () => {
    const report = validateOutput(
      {
        text: "",
        finishReason: "tool_calls",
        toolCalls: [
          { id: "call_1", name: "magic_oracle", args: { query: "?" } },
        ],
      },
      {
        toolDescriptors: [
          {
            name: "search",
            description: "search the web",
            inputSchema: { type: "object", required: ["query"] },
          },
        ],
      },
    );
    expect(
      report.issues.some(
        (i) => i.code === "tool_unknown" && i.severity === "warning",
      ),
    ).toBe(true);
  });

  it("25 flags absurdly long responses as warnings", () => {
    const report = validateOutput({
      ...goodResponse,
      text: "x".repeat(200_000),
    });
    expect(
      report.issues.some(
        (i) => i.code === "length_above_soft_cap" && i.severity === "warning",
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Provider selection
// ---------------------------------------------------------------------------

describe("cognitive: provider selection", () => {
  const echo = new EchoMockAdapter();
  const tooly = new ToolEmittingMockAdapter("noop", {});
  const adapters: ProviderAdapter[] = [echo, tooly];

  it("26 picks first capable when no preference is set", () => {
    const result = selectProvider(adapters, "qa");
    expect(result.adapter?.name).toBe(echo.name);
    expect(result.reason).toContain("first capable");
  });

  it("27 honors preferredProvider when capable", () => {
    const result = selectProvider(adapters, "qa", tooly.name);
    expect(result.adapter?.name).toBe(tooly.name);
    expect(result.reason).toContain("preferred");
  });

  it("28 falls back when preferredProvider name is not registered", () => {
    const result = selectProvider(adapters, "qa", "ghost-provider");
    expect(result.adapter?.name).toBe(echo.name);
    expect(result.reason).toContain("not registered");
  });

  it("29 returns null when there are no adapters at all", () => {
    const result = selectProvider([], "qa");
    expect(result.adapter).toBeNull();
    expect(result.reason).toContain("no adapters");
  });
});

// ---------------------------------------------------------------------------
// 4. Mock provider adapters
// ---------------------------------------------------------------------------

describe("cognitive: mock provider adapters", () => {
  it("30 EchoMockAdapter echoes the last user message", async () => {
    const echo = new EchoMockAdapter();
    const r = await echo.generate({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.text).toBe("Echo: hi");
    expect(r.finishReason).toBe("stop");
    expect(echo.callCount).toBe(1);
    expect(echo.lastRequest?.messages[0].content).toBe("hi");
  });

  it("31 ScriptedMockAdapter returns canned responses in order", async () => {
    const scripted = new ScriptedMockAdapter([
      { text: "first" },
      { text: "second" },
      { text: "third" },
    ]);
    const a = await scripted.generate({ messages: [{ role: "user", content: "" }] });
    const b = await scripted.generate({ messages: [{ role: "user", content: "" }] });
    const c = await scripted.generate({ messages: [{ role: "user", content: "" }] });
    expect(a.text).toBe("first");
    expect(b.text).toBe("second");
    expect(c.text).toBe("third");
  });

  it("32 FailingMockAdapter returns error finishReason and counts calls", async () => {
    const failing = new FailingMockAdapter("boom");
    const r = await failing.generate({ messages: [{ role: "user", content: "" }] });
    expect(r.finishReason).toBe("error");
    expect(failing.callCount).toBe(1);
  });

  it("33 FailingMockAdapter with successAfter eventually succeeds", async () => {
    const failing = new FailingMockAdapter("boom", 2);
    await failing.generate({ messages: [{ role: "user", content: "" }] }); // 1: fail
    await failing.generate({ messages: [{ role: "user", content: "" }] }); // 2: fail
    const third = await failing.generate({
      messages: [{ role: "user", content: "" }],
    }); // 3: ok
    expect(third.finishReason).toBe("stop");
    expect(failing.callCount).toBe(3);
  });

  it("34 AbortableMockAdapter resolves on abort instead of waiting", async () => {
    const abortable = new AbortableMockAdapter(60_000);
    const controller = new AbortController();
    const promise = abortable.generate(
      { messages: [{ role: "user", content: "" }] },
      controller.signal,
    );
    controller.abort();
    const r = await promise;
    expect(r.finishReason).toBe("aborted");
  });
});

// ---------------------------------------------------------------------------
// 5. Full orchestrator pipeline
// ---------------------------------------------------------------------------

describe("cognitive: orchestrator pipeline", () => {
  it("35 happy path: routes intent, calls provider, validates, returns ok", async () => {
    const echo = new EchoMockAdapter();
    const mw = new CognitiveMiddleware({ adapters: [echo] });
    const result = await mw.run({
      userId: "u1",
      message: "What is the capital of France?",
    });
    expect(result.ok).toBe(true);
    expect(result.routing.intent.intent).toBe("qa");
    expect(result.routing.providerName).toBe(echo.name);
    expect(result.text).toBe("Echo: What is the capital of France?");
    expect(result.telemetry.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.telemetry.intentClassificationMs).toBeGreaterThanOrEqual(0);
    expect(result.telemetry.providerCallMs).toBeGreaterThanOrEqual(0);
    expect(result.telemetry.validationMs).toBeGreaterThanOrEqual(0);
    expect(result.errors.length).toBe(0);
  });

  it("36 buildNormalizedRequest produces a clean shape", () => {
    const req = buildNormalizedRequest(
      {
        userId: "u1",
        message: "hi",
        temperature: 0.5,
      },
      { adapters: [] },
    );
    expect(req.messages.length).toBe(1);
    expect(req.messages[0].role).toBe("user");
    expect(req.messages[0].content).toBe("hi");
    expect(req.temperature).toBe(0.5);
  });

  it("37 default temperature is 0.7", () => {
    const req = buildNormalizedRequest(
      { userId: "u", message: "x" },
      { adapters: [] },
    );
    expect(req.temperature).toBe(0.7);
  });

  it("38 returns ok=false with no_capable_provider when zero adapters registered", async () => {
    const mw = new CognitiveMiddleware({ adapters: [] });
    const r = await mw.run({ userId: "u1", message: "anything" });
    expect(r.ok).toBe(false);
    expect(r.routing.providerName).toBe("(none)");
    expect(r.validation.issues.some((i) => i.code === "no_capable_provider")).toBe(
      true,
    );
    expect(r.errors).toContain("no_capable_provider");
  });

  it("39 listAdapters returns names in priority order", () => {
    const a = new EchoMockAdapter();
    const b = new ScriptedMockAdapter([{ text: "x" }]);
    const mw = new CognitiveMiddleware({ adapters: [a, b] });
    expect(mw.listAdapters()).toEqual([a.name, b.name]);
  });
});

// ---------------------------------------------------------------------------
// 6. Retries on transient failure
// ---------------------------------------------------------------------------

describe("cognitive: retries on transient failure", () => {
  it("40 retries up to maxRetries times then succeeds", async () => {
    const failing = new FailingMockAdapter("transient", 2); // succeeds on 3rd
    const mw = new CognitiveMiddleware({
      adapters: [failing],
      maxRetries: 5,
    });
    const r = await mw.run({ userId: "u", message: "ping" });
    expect(r.ok).toBe(true);
    expect(r.text).toBe("ok after retry");
    expect(r.telemetry.retries).toBe(2);
    expect(failing.callCount).toBe(3);
  });

  it("41 stops after maxRetries when failures persist", async () => {
    const failing = new FailingMockAdapter("permanent");
    const mw = new CognitiveMiddleware({
      adapters: [failing],
      maxRetries: 2,
    });
    const r = await mw.run({ userId: "u", message: "ping" });
    expect(r.ok).toBe(false);
    expect(r.telemetry.retries).toBe(2);
    expect(failing.callCount).toBe(3); // initial + 2 retries
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.validation.issues.some((i) => i.code === "provider_error")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Cancellation propagation
// ---------------------------------------------------------------------------

describe("cognitive: cancellation propagation", () => {
  it("42 forwards external AbortSignal to the adapter", async () => {
    const abortable = new AbortableMockAdapter(30_000);
    const mw = new CognitiveMiddleware({
      adapters: [abortable],
      timeoutMs: 60_000,
    });
    const controller = new AbortController();
    const promise = mw.run({
      userId: "u",
      message: "ping",
      signal: controller.signal,
    });
    // Abort after a short delay
    setTimeout(() => controller.abort(), 50);
    const r = await promise;
    expect(r.ok).toBe(false);
    expect(r.validation.issues.some((i) => i.code === "aborted")).toBe(true);
  });

  it("43 respects timeoutMs when adapter hangs", async () => {
    const abortable = new AbortableMockAdapter(30_000);
    const mw = new CognitiveMiddleware({
      adapters: [abortable],
      timeoutMs: 100, // short timeout
      maxRetries: 0,
    });
    const start = Date.now();
    const r = await mw.run({ userId: "u", message: "ping" });
    const elapsed = Date.now() - start;
    expect(r.ok).toBe(false);
    expect(r.validation.issues.some((i) => i.code === "aborted")).toBe(true);
    // Should be near the timeout, definitely not 30s
    expect(elapsed).toBeLessThan(2_000);
  });
});

// ---------------------------------------------------------------------------
// 8. Concurrency
// ---------------------------------------------------------------------------

describe("cognitive: concurrency", () => {
  it("44 50 parallel requests all complete with isolated state", async () => {
    const echo = new EchoMockAdapter();
    const mw = new CognitiveMiddleware({ adapters: [echo] });
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        mw.run({ userId: `u${i}`, message: `hello ${i}` }),
      ),
    );
    expect(results.length).toBe(50);
    for (let i = 0; i < 50; i++) {
      expect(results[i].ok).toBe(true);
      expect(results[i].text).toBe(`Echo: hello ${i}`);
    }
    expect(echo.callCount).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// 9. Multi-LLM normalization
// ---------------------------------------------------------------------------

describe("cognitive: multi-LLM normalization", () => {
  it("45 same request through 3 different adapters yields structurally equivalent responses", async () => {
    // Three "providers" that produce different text but identical
    // shape. The middleware must normalize them transparently.
    const claudeMock = new ScriptedMockAdapter([{ text: "Claude says hi" }], "mock-claude");
    const openaiMock = new ScriptedMockAdapter([{ text: "OpenAI says hi" }], "mock-openai");
    const geminiMock = new ScriptedMockAdapter([{ text: "Gemini says hi" }], "mock-gemini");

    const claudeMw = new CognitiveMiddleware({ adapters: [claudeMock] });
    const openaiMw = new CognitiveMiddleware({ adapters: [openaiMock] });
    const geminiMw = new CognitiveMiddleware({ adapters: [geminiMock] });

    const userReq = {
      userId: "u",
      message: "What's the capital of France?",
    };
    const r1 = await claudeMw.run(userReq);
    const r2 = await openaiMw.run(userReq);
    const r3 = await geminiMw.run(userReq);

    // Same shape, same intent classification, same validation pass
    for (const r of [r1, r2, r3]) {
      expect(r.ok).toBe(true);
      expect(r.routing.intent.intent).toBe("qa");
      expect(r.toolCalls).toEqual([]);
      expect(r.validation.issues.length).toBe(0);
      expect(r.errors.length).toBe(0);
    }

    // Texts differ (the providers each have their own personality)
    expect(r1.text).not.toBe(r2.text);
    expect(r2.text).not.toBe(r3.text);
    expect(r1.routing.providerName).toBe("mock-claude");
    expect(r2.routing.providerName).toBe("mock-openai");
    expect(r3.routing.providerName).toBe("mock-gemini");
  });
});

// ---------------------------------------------------------------------------
// 10. Tool-emitting flow
// ---------------------------------------------------------------------------

describe("cognitive: tool call flow", () => {
  it("46 surfaces tool calls on the response", async () => {
    const tooly = new ToolEmittingMockAdapter("calculator", { expression: "2+2" });
    const mw = new CognitiveMiddleware({ adapters: [tooly] });
    const r = await mw.run({ userId: "u", message: "Use the calculator tool to compute 2+2" });
    expect(r.toolCalls.length).toBe(1);
    expect(r.toolCalls[0].name).toBe("calculator");
    expect(r.toolCalls[0].args).toEqual({ expression: "2+2" });
    expect(r.ok).toBe(true);
  });
});

// Type silencer for unused enum import
const _intentSilencer: CognitiveIntent = "chat";
void _intentSilencer;
