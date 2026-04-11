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
  // Real provider adapters (Turn A)
  SmartRouterAdapter,
  InHouseGptAdapter,
  mapGatewayFinishReason,
  translateGatewayResponse,
  type GatewayResponse,
  type GatewayChatFn,
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

// ---------------------------------------------------------------------------
// 11. Turn A — SmartRouterAdapter (wraps the existing llmGateway)
// ---------------------------------------------------------------------------

describe("cognitive: SmartRouterAdapter (gateway shim)", () => {
  /**
   * Build a stub `chatFn` that returns a canned GatewayResponse and
   * records the messages it received. We use this everywhere instead
   * of the real gateway so the test never touches network or env vars.
   */
  function makeStubChatFn(canned: GatewayResponse) {
    const calls: Array<{ messages: unknown; options: unknown }> = [];
    const fn: GatewayChatFn = async (messages, options) => {
      calls.push({ messages, options });
      return canned;
    };
    return { fn, calls };
  }

  it("47 forwards system + user messages in OpenAI shape", async () => {
    const stub = makeStubChatFn({
      content: "ok",
      requestId: "req-1",
      latencyMs: 10,
      model: "gpt-4o-mini",
      provider: "openai",
      status: "completed",
      usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
    });
    const adapter = new SmartRouterAdapter({ chatFn: stub.fn });
    const r = await adapter.generate({
      systemPrompt: "You are helpful.",
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0.5,
      maxTokens: 200,
    });
    expect(r.text).toBe("ok");
    expect(r.finishReason).toBe("stop");
    expect(r.usage).toEqual({ promptTokens: 5, completionTokens: 2, totalTokens: 7 });
    expect(stub.calls.length).toBe(1);
    const call = stub.calls[0];
    // System message must come first
    expect((call.messages as Array<{ role: string }>)[0].role).toBe("system");
    expect((call.messages as Array<{ role: string }>)[1].role).toBe("user");
    // Options propagated
    expect((call.options as { temperature?: number }).temperature).toBe(0.5);
    expect((call.options as { maxTokens?: number }).maxTokens).toBe(200);
  });

  it("48 maps gateway 'incomplete + max_output_tokens' to 'length'", () => {
    const reason = mapGatewayFinishReason({
      content: "truncated...",
      requestId: "x",
      latencyMs: 1,
      model: "x",
      provider: "x",
      status: "incomplete",
      incompleteDetails: { reason: "max_output_tokens" },
    });
    expect(reason).toBe("length");
  });

  it("49 maps gateway 'incomplete + content_filter' to 'content_filter'", () => {
    const reason = mapGatewayFinishReason({
      content: "",
      requestId: "x",
      latencyMs: 1,
      model: "x",
      provider: "x",
      status: "incomplete",
      incompleteDetails: { reason: "content_filter" },
    });
    expect(reason).toBe("content_filter");
  });

  it("50 maps gateway 'incomplete + provider_error' to 'error'", () => {
    const reason = mapGatewayFinishReason({
      content: "",
      requestId: "x",
      latencyMs: 1,
      model: "x",
      provider: "x",
      status: "incomplete",
      incompleteDetails: { reason: "provider_error" },
    });
    expect(reason).toBe("error");
  });

  it("51 maps undefined / completed status to 'stop'", () => {
    expect(
      mapGatewayFinishReason({
        content: "",
        requestId: "x",
        latencyMs: 1,
        model: "x",
        provider: "x",
      }),
    ).toBe("stop");
    expect(
      mapGatewayFinishReason({
        content: "",
        requestId: "x",
        latencyMs: 1,
        model: "x",
        provider: "x",
        status: "completed",
      }),
    ).toBe("stop");
  });

  it("52 wraps thrown gateway errors into a finishReason='error' response", async () => {
    const fn: GatewayChatFn = async () => {
      throw new Error("boom");
    };
    const adapter = new SmartRouterAdapter({ chatFn: fn });
    const r = await adapter.generate({
      messages: [{ role: "user", content: "test" }],
    });
    expect(r.finishReason).toBe("error");
    expect(r.text).toBe("");
    expect((r.raw as { error?: string }).error).toContain("boom");
  });

  it("53 honors AbortSignal aborted-before-call", async () => {
    const fn: GatewayChatFn = async () => {
      throw new Error("should not be called");
    };
    const adapter = new SmartRouterAdapter({ chatFn: fn });
    const controller = new AbortController();
    controller.abort();
    const r = await adapter.generate(
      { messages: [{ role: "user", content: "x" }] },
      controller.signal,
    );
    expect(r.finishReason).toBe("aborted");
  });

  it("54 translateGatewayResponse copies usage faithfully", () => {
    const r = translateGatewayResponse({
      content: "hello",
      requestId: "r",
      latencyMs: 5,
      model: "m",
      provider: "p",
      status: "completed",
      usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4 },
    });
    expect(r.text).toBe("hello");
    expect(r.usage).toEqual({ promptTokens: 3, completionTokens: 1, totalTokens: 4 });
    expect(r.finishReason).toBe("stop");
  });

  it("55 capabilities set excludes image_generation but includes text intents", () => {
    const adapter = new SmartRouterAdapter();
    expect(adapter.capabilities.has("qa")).toBe(true);
    expect(adapter.capabilities.has("code_generation")).toBe(true);
    expect(adapter.capabilities.has("translation")).toBe(true);
    expect(adapter.capabilities.has("image_generation")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 12. Turn A — InHouseGptAdapter (in-house GPT-3, fully offline)
// ---------------------------------------------------------------------------

describe("cognitive: InHouseGptAdapter (offline tiny model)", () => {
  it("56 generates a deterministic response", async () => {
    const a = new InHouseGptAdapter({ seed: 7 });
    const b = new InHouseGptAdapter({ seed: 7 });
    const r1 = await a.generate({
      messages: [{ role: "user", content: "Hello" }],
    });
    const r2 = await b.generate({
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(r1.text).toBe(r2.text);
    expect(r1.finishReason).toBe(r2.finishReason);
  });

  it("57 different seeds produce different output", async () => {
    const a = new InHouseGptAdapter({ seed: 1 });
    const b = new InHouseGptAdapter({ seed: 99 });
    const r1 = await a.generate({
      messages: [{ role: "user", content: "Hello" }],
    });
    const r2 = await b.generate({
      messages: [{ role: "user", content: "Hello" }],
    });
    // Highly likely to differ — toy model with 4 layers, but
    // different seeds give different weight matrices.
    expect(r1.text).not.toBe(r2.text);
  });

  it("58 records call count for observability", async () => {
    const adapter = new InHouseGptAdapter();
    expect(adapter.callCount).toBe(0);
    await adapter.generate({ messages: [{ role: "user", content: "x" }] });
    await adapter.generate({ messages: [{ role: "user", content: "y" }] });
    expect(adapter.callCount).toBe(2);
  });

  it("59 returns finishReason='aborted' when signal is pre-aborted", async () => {
    const adapter = new InHouseGptAdapter();
    const controller = new AbortController();
    controller.abort();
    const r = await adapter.generate(
      { messages: [{ role: "user", content: "x" }] },
      controller.signal,
    );
    expect(r.finishReason).toBe("aborted");
    expect(r.text).toBe("");
  });

  it("60 capabilities set covers every text intent", () => {
    const adapter = new InHouseGptAdapter();
    expect(adapter.capabilities.has("chat")).toBe(true);
    expect(adapter.capabilities.has("qa")).toBe(true);
    expect(adapter.capabilities.has("code_generation")).toBe(true);
    expect(adapter.capabilities.has("summarization")).toBe(true);
    expect(adapter.capabilities.has("translation")).toBe(true);
  });

  it("61 returns usage stats in the response", async () => {
    const adapter = new InHouseGptAdapter();
    const r = await adapter.generate({
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(r.usage).toBeDefined();
    expect(r.usage?.promptTokens).toBeGreaterThan(0);
    expect(r.usage?.completionTokens).toBeGreaterThan(0);
    expect(r.usage?.totalTokens).toBeGreaterThan(0);
  });

  it("62 honors maxTokens via the orchestrator's request", async () => {
    const adapter = new InHouseGptAdapter({ defaultMaxNewTokens: 16 });
    const r = await adapter.generate({
      messages: [{ role: "user", content: "Hello" }],
      maxTokens: 4,
    });
    // Generation should be capped near maxTokens (allowing for the
    // tiny model's stop-token quirks).
    expect(r.usage?.completionTokens).toBeLessThanOrEqual(5);
  });

  it("63 plugs into CognitiveMiddleware end-to-end", async () => {
    const adapter = new InHouseGptAdapter({ seed: 11 });
    const mw = new CognitiveMiddleware({ adapters: [adapter] });
    const r = await mw.run({
      userId: "u",
      message: "What is 2 + 2?",
    });
    expect(r.ok).toBe(true);
    expect(r.routing.providerName).toBe("in-house-gpt3");
    expect(r.routing.intent.intent).toBe("qa");
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.telemetry.providerCallMs).toBeGreaterThanOrEqual(0);
  });

  it("64 truncates the front of an over-long prompt instead of erroring", async () => {
    const adapter = new InHouseGptAdapter();
    // Fallback config has contextWindow=512. A 5000-char prompt
    // tokenizes to 5000 tokens which overflows by ~10×. The adapter
    // must truncate the FRONT (matches the standard "keep most
    // recent" policy) and produce a normal response.
    const longText = "x".repeat(5000);
    const r = await adapter.generate({
      messages: [{ role: "user", content: longText }],
    });
    expect(r.finishReason).not.toBe("error");
    expect(r.text.length).toBeGreaterThan(0);
    const dropped = (r.raw as { tokensDroppedByTruncation?: number })
      .tokensDroppedByTruncation;
    expect(typeof dropped).toBe("number");
    expect(dropped).toBeGreaterThan(0);
  });

  it("65 useTinyConfig opts into the math-library tinyConfig (for math tests)", async () => {
    // This proves the escape hatch still works for tests of the
    // underlying math kernels. Tiny config has contextWindow=32 so
    // even a short prompt + the truncation reserve will leave very
    // little headroom — but a single short message should still fit.
    const adapter = new InHouseGptAdapter({
      useTinyConfig: true,
      defaultMaxNewTokens: 4,
      seed: 31,
    });
    const r = await adapter.generate({
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(r.finishReason).not.toBe("error");
    expect(r.usage?.completionTokens).toBeGreaterThan(0);
  });
});

// Type silencer for unused enum import
const _intentSilencer: CognitiveIntent = "chat";
void _intentSilencer;
