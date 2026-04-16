/**
 * Agentic Loop Integration Tests
 *
 * Tests the full end-to-end agentic loop using ClaudeAgentBackbone with mocked
 * Anthropic SDK calls. No real API calls are made — the mock controls which
 * tool calls the "LLM" requests and what text it returns, verifying that the
 * loop correctly:
 *   - Routes tool requests to handlers
 *   - Accumulates tool results back into the message thread
 *   - Terminates on end_turn or when no tool calls remain
 *   - Respects maxRounds limits
 *   - Emits lifecycle events
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// ─────────────────────────────────────────────────────────────────────────────
// Mock @anthropic-ai/sdk before any imports that use it
// ─────────────────────────────────────────────────────────────────────────────

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
    },
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Import after mock setup
// ─────────────────────────────────────────────────────────────────────────────

import {
  ClaudeAgentBackbone,
  CLAUDE_MODELS,
  type AgentMessage,
  type ToolDefinition,
} from "../../agentic/ClaudeAgentBackbone.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Build mock Anthropic response shapes
// ─────────────────────────────────────────────────────────────────────────────

function mockTextResponse(text: string) {
  return {
    id: "msg_test_001",
    type: "message",
    model: CLAUDE_MODELS.SONNET,
    role: "assistant",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 50, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

function mockToolUseResponse(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolId = "tool_abc123"
) {
  return {
    id: "msg_test_002",
    type: "message",
    model: CLAUDE_MODELS.SONNET,
    role: "assistant",
    content: [
      { type: "tool_use", id: toolId, name: toolName, input: toolInput },
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 80, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

function mockToolThenTextSequence(
  toolName: string,
  toolInput: Record<string, unknown>,
  finalText: string,
  toolId = "tool_seq001"
) {
  let callCount = 0;
  return vi.fn().mockImplementation(async () => {
    callCount++;
    if (callCount === 1) return mockToolUseResponse(toolName, toolInput, toolId);
    return mockTextResponse(finalText);
  });
}

function mockMultiToolSequence(
  tools: Array<{ name: string; input: Record<string, unknown>; id: string }>,
  finalText: string
) {
  let callCount = 0;
  return vi.fn().mockImplementation(async () => {
    callCount++;
    if (callCount <= tools.length) {
      const t = tools[callCount - 1];
      return mockToolUseResponse(t.name, t.input, t.id);
    }
    return mockTextResponse(finalText);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const TOOL_DEFS: ToolDefinition[] = [
  {
    name: "web_search",
    description: "Search the web for information",
    input_schema: {
      type: "object" as const,
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "code_generation",
    description: "Generate code in a given language",
    input_schema: {
      type: "object" as const,
      properties: {
        language: { type: "string" },
        description: { type: "string" },
      },
      required: ["language", "description"],
    },
  },
  {
    name: "read_file",
    description: "Read the contents of a file",
    input_schema: {
      type: "object" as const,
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "bash",
    description: "Execute a bash command",
    input_schema: {
      type: "object" as const,
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("AgenticLoop Integration", () => {
  let backbone: ClaudeAgentBackbone;

  beforeEach(() => {
    backbone = new ClaudeAgentBackbone("test-api-key");
    mockCreate.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Test 1: Simple message — direct response, no tools needed ───────────────

  it("Test 1: simple message returns direct response without tool calls", async () => {
    const responseText = "Hello! How can I assist you today?";
    mockCreate.mockResolvedValueOnce(mockTextResponse(responseText));

    const messages: AgentMessage[] = [{ role: "user", content: "Hello!" }];
    const loop = await backbone.runAgentLoop(messages, {}, { maxRounds: 5 });

    expect(loop.status).toBe("completed");
    expect(loop.finalResponse).toBe(responseText);
    expect(loop.totalRounds).toBe(1);
    expect(loop.totalTokens).toBeGreaterThan(0);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  // ── Test 2: Trivial math — direct response, no agent reasoning needed ───────

  it("Test 2: direct math question returns immediate answer", async () => {
    mockCreate.mockResolvedValueOnce(mockTextResponse("2 + 2 = 4"));

    const messages: AgentMessage[] = [{ role: "user", content: "What's 2+2?" }];
    const loop = await backbone.runAgentLoop(messages, {}, { maxRounds: 3 });

    expect(loop.status).toBe("completed");
    expect(loop.finalResponse).toBe("2 + 2 = 4");
    expect(loop.totalRounds).toBe(1);
    expect(loop.messages).toHaveLength(2); // user + assistant
  });

  // ── Test 3: Web search tool → returns results ───────────────────────────────

  it("Test 3: web search request triggers web_search tool and returns results", async () => {
    mockCreate.mockImplementation(mockToolThenTextSequence(
      "web_search",
      { query: "latest AI news 2025" },
      "Based on the search results, here are the latest AI developments: [summary]",
      "tool_search_001"
    ));

    const searchResults: string[] = [];
    const handlers = {
      web_search: vi.fn(async (input: Record<string, unknown>) => {
        const results = [
          "OpenAI releases new model",
          "Google DeepMind advances",
          "Anthropic Claude 5 announced",
        ];
        searchResults.push(...results);
        return { results, query: input.query };
      }),
    };

    const messages: AgentMessage[] = [
      { role: "user", content: "Search the web for latest AI news" },
    ];
    const loop = await backbone.runAgentLoop(messages, handlers, {
      tools: TOOL_DEFS,
      maxRounds: 5,
    });

    expect(loop.status).toBe("completed");
    expect(handlers.web_search).toHaveBeenCalledOnce();
    expect(handlers.web_search).toHaveBeenCalledWith({ query: "latest AI news 2025" });
    expect(searchResults).toHaveLength(3);
    expect(loop.totalRounds).toBe(2); // round 1: tool call; round 2: final text
    expect(loop.finalResponse).toContain("search results");
  });

  // ── Test 4: Code generation ──────────────────────────────────────────────────

  it("Test 4: code generation request triggers code_generation tool", async () => {
    const generatedCode = `def fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)`;

    mockCreate.mockImplementation(mockToolThenTextSequence(
      "code_generation",
      { language: "python", description: "fibonacci sequence calculator" },
      `Here's the Python function:\n\`\`\`python\n${generatedCode}\n\`\`\``,
      "tool_code_001"
    ));

    let capturedCode: string | null = null;
    const handlers = {
      code_generation: vi.fn(async (input: Record<string, unknown>) => {
        capturedCode = generatedCode;
        return { code: generatedCode, language: input.language };
      }),
    };

    const messages: AgentMessage[] = [
      { role: "user", content: "Write a Python function to calculate fibonacci" },
    ];
    const loop = await backbone.runAgentLoop(messages, handlers, {
      tools: TOOL_DEFS,
      maxRounds: 5,
    });

    expect(loop.status).toBe("completed");
    expect(handlers.code_generation).toHaveBeenCalledOnce();
    expect(capturedCode).toContain("fibonacci");
    expect(loop.finalResponse).toContain("python");
  });

  // ── Test 5: read_file tool → returns file contents ───────────────────────────

  it("Test 5: read_file tool returns file contents when triggered", async () => {
    const pkgContents = JSON.stringify({ name: "iliagpt", version: "1.0.0" }, null, 2);

    mockCreate.mockImplementation(mockToolThenTextSequence(
      "read_file",
      { path: "package.json" },
      `The package.json contains: name="iliagpt", version="1.0.0"`,
      "tool_read_001"
    ));

    const handlers = {
      read_file: vi.fn(async (input: Record<string, unknown>) => {
        if (input.path === "package.json") return pkgContents;
        throw new Error(`File not found: ${input.path}`);
      }),
    };

    const messages: AgentMessage[] = [
      { role: "user", content: "Read the file package.json" },
    ];
    const loop = await backbone.runAgentLoop(messages, handlers, {
      tools: TOOL_DEFS,
      maxRounds: 5,
    });

    expect(loop.status).toBe("completed");
    expect(handlers.read_file).toHaveBeenCalledWith({ path: "package.json" });
    expect(loop.finalResponse).toContain("iliagpt");
  });

  // ── Test 6: bash tool execution ──────────────────────────────────────────────

  it("Test 6: bash tool executes command and returns output", async () => {
    mockCreate.mockImplementation(mockToolThenTextSequence(
      "bash",
      { command: "echo hello world" },
      "The command output was: hello world",
      "tool_bash_001"
    ));

    const handlers = {
      bash: vi.fn(async (input: Record<string, unknown>) => {
        // Mock safe command execution — no real shell
        if (input.command === "echo hello world") {
          return { stdout: "hello world\n", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "Command not allowed", exitCode: 1 };
      }),
    };

    const messages: AgentMessage[] = [
      { role: "user", content: "Run: echo hello world" },
    ];
    const loop = await backbone.runAgentLoop(messages, handlers, {
      tools: TOOL_DEFS,
      maxRounds: 5,
    });

    expect(loop.status).toBe("completed");
    expect(handlers.bash).toHaveBeenCalledWith({ command: "echo hello world" });
    expect(loop.finalResponse).toContain("hello world");
  });

  // ── Test 7: Multi-tool — search then summarize ───────────────────────────────

  it("Test 7: multi-tool request chains search then produces summary", async () => {
    const searchResult = { results: ["AI is advancing rapidly", "New models released"] };
    let searchCallCount = 0;

    mockCreate.mockImplementation(mockMultiToolSequence(
      [
        { name: "web_search", input: { query: "AI advancements 2025" }, id: "tool_s1" },
      ],
      "Based on the web search, AI is advancing rapidly with new model releases in 2025."
    ));

    const handlers = {
      web_search: vi.fn(async () => {
        searchCallCount++;
        return searchResult;
      }),
    };

    const messages: AgentMessage[] = [
      { role: "user", content: "Search for AI advancements and then summarize it" },
    ];
    const loop = await backbone.runAgentLoop(messages, handlers, {
      tools: TOOL_DEFS,
      maxRounds: 10,
    });

    expect(loop.status).toBe("completed");
    expect(searchCallCount).toBe(1);
    expect(loop.finalResponse).toContain("AI is advancing");
    // Message thread: user → assistant(tool_use) → user(tool_result) → assistant(text)
    expect(loop.messages.length).toBeGreaterThanOrEqual(3);
  });

  // ── Test 8: Error recovery — tool fails, agent reports gracefully ────────────

  it("Test 8: when tool throws, error is passed to LLM and agent continues", async () => {
    const errorMessage = "Network timeout: could not reach search service";
    mockCreate.mockImplementation(mockToolThenTextSequence(
      "web_search",
      { query: "test query" },
      "I was unable to complete the search due to a network error. Please try again later.",
      "tool_err_001"
    ));

    const events: string[] = [];
    backbone.on("tool:error", ({ name, error }) => {
      events.push(`error:${name}:${error}`);
    });

    const handlers = {
      web_search: vi.fn(async () => {
        throw new Error(errorMessage);
      }),
    };

    const messages: AgentMessage[] = [
      { role: "user", content: "Search for test query" },
    ];
    const loop = await backbone.runAgentLoop(messages, handlers, {
      tools: TOOL_DEFS,
      maxRounds: 5,
    });

    // Loop should complete even after tool failure
    expect(loop.status).toBe("completed");
    expect(events).toHaveLength(1);
    expect(events[0]).toContain("web_search");
    expect(events[0]).toContain("Network timeout");

    // The tool_result in messages should contain the error
    const toolResultMessage = loop.messages.find(
      (m) => Array.isArray(m.content) && (m.content as any[]).some(
        (b) => b.type === "tool_result" && b.is_error === true
      )
    );
    expect(toolResultMessage).toBeDefined();
  });

  // ── Test 9: Background-style task — max rounds acts as async timeout guard ──

  it("Test 9: long-running loop terminates at maxRounds with status max_rounds_reached", async () => {
    // Simulate an agent that keeps requesting tools endlessly
    mockCreate.mockImplementation(async () =>
      mockToolUseResponse("web_search", { query: "more info" }, `tool_loop_${Date.now()}`)
    );

    const events: string[] = [];
    backbone.on("loop:end", ({ status }) => events.push(status));

    const handlers = {
      web_search: vi.fn(async () => ({ results: ["result"] })),
    };

    const messages: AgentMessage[] = [{ role: "user", content: "Keep searching forever" }];
    const loop = await backbone.runAgentLoop(messages, handlers, {
      tools: TOOL_DEFS,
      maxRounds: 3,
    });

    expect(loop.status).toBe("max_rounds_reached");
    expect(loop.totalRounds).toBe(3);
    expect(events).toContain("max_rounds_reached");
    expect(handlers.web_search).toHaveBeenCalledTimes(3);
  });

  // ── Test 10: Multiple tool providers — format conversion round-trip ──────────

  it("Test 10: tool call with structured input is correctly parsed and dispatched", async () => {
    const complexInput = {
      url: "https://api.example.com/data",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token123" },
      body: { filter: { status: "active" }, limit: 50, offset: 0 },
    };

    mockCreate.mockImplementation(mockToolThenTextSequence(
      "web_search",
      complexInput,
      "API call completed successfully",
      "tool_complex_001"
    ));

    let receivedInput: Record<string, unknown> | null = null;
    const handlers = {
      web_search: vi.fn(async (input: Record<string, unknown>) => {
        receivedInput = input;
        return { status: "ok", data: [] };
      }),
    };

    const messages: AgentMessage[] = [{ role: "user", content: "Fetch API with complex params" }];
    await backbone.runAgentLoop(messages, handlers, { tools: TOOL_DEFS, maxRounds: 5 });

    expect(receivedInput).toMatchObject(complexInput);
    // Nested object preservation
    expect((receivedInput as any).headers?.Authorization).toBe("Bearer token123");
    expect((receivedInput as any).body?.limit).toBe(50);
  });

  // ── Lifecycle event tests ─────────────────────────────────────────────────────

  it("emits loop:start and loop:end events for every run", async () => {
    mockCreate.mockResolvedValueOnce(mockTextResponse("Done"));

    const events: string[] = [];
    backbone.on("loop:start", ({ loopId }) => events.push(`start:${loopId}`));
    backbone.on("loop:end", ({ status }) => events.push(`end:${status}`));

    const loop = await backbone.runAgentLoop(
      [{ role: "user", content: "test" }],
      {},
      { maxRounds: 5 }
    );

    expect(events.some((e) => e.startsWith("start:"))).toBe(true);
    expect(events.some((e) => e.includes("completed"))).toBe(true);
    expect(events[0]).toContain(loop.loopId);
  });

  it("emits tool:result event for successful tool calls", async () => {
    mockCreate.mockImplementation(mockToolThenTextSequence(
      "bash",
      { command: "echo test" },
      "Command executed: test",
      "tool_ev_001"
    ));

    const toolEvents: Array<{ name: string; success: boolean }> = [];
    backbone.on("tool:result", (e) => toolEvents.push({ name: e.name, success: e.success }));

    const handlers = { bash: vi.fn(async () => ({ stdout: "test", exitCode: 0 })) };
    await backbone.runAgentLoop(
      [{ role: "user", content: "Run echo test" }],
      handlers,
      { tools: TOOL_DEFS, maxRounds: 5 }
    );

    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0].name).toBe("bash");
    expect(toolEvents[0].success).toBe(true);
  });

  // ── Session management ────────────────────────────────────────────────────────

  it("creates a new session per runAgentLoop call and tracks cost", async () => {
    mockCreate.mockResolvedValue(mockTextResponse("Response"));

    const loop1 = await backbone.runAgentLoop([{ role: "user", content: "Q1" }], {});
    const loop2 = await backbone.runAgentLoop([{ role: "user", content: "Q2" }], {});

    expect(loop1.loopId).not.toBe(loop2.loopId);
    expect(loop1.sessionId).not.toBe(loop2.sessionId);
    expect(loop1.totalTokens).toBeGreaterThan(0);
  });

  it("handles unknown tool gracefully by injecting error into tool_result", async () => {
    mockCreate.mockImplementation(mockToolThenTextSequence(
      "nonexistent_tool",
      { param: "value" },
      "The tool is not available, here is what I know...",
      "tool_none_001"
    ));

    // No handler registered for nonexistent_tool
    const handlers = {};
    const loop = await backbone.runAgentLoop(
      [{ role: "user", content: "Use nonexistent_tool" }],
      handlers,
      { tools: TOOL_DEFS, maxRounds: 5 }
    );

    // Loop should still complete
    expect(loop.status).toBe("completed");

    // Tool result in messages should show the error
    const toolResultMsg = loop.messages.find(
      (m) =>
        Array.isArray(m.content) &&
        (m.content as any[]).some(
          (b) => b.type === "tool_result" && b.content?.includes("not found")
        )
    );
    expect(toolResultMsg).toBeDefined();
  });

  it("accumulates totalTokens across multiple rounds", async () => {
    // Round 1 (tool use): 80+40=120 tokens; Round 2 (final): 50+20=70 tokens
    mockCreate
      .mockResolvedValueOnce(mockToolUseResponse("bash", { command: "ls" }, "t1"))
      .mockResolvedValueOnce(mockTextResponse("Files listed"));

    const handlers = { bash: vi.fn(async () => ({ stdout: "file1\nfile2", exitCode: 0 })) };
    const loop = await backbone.runAgentLoop(
      [{ role: "user", content: "List files" }],
      handlers,
      { tools: TOOL_DEFS, maxRounds: 5 }
    );

    expect(loop.totalRounds).toBe(2);
    // 120 (round 1) + 70 (round 2) = 190
    expect(loop.totalTokens).toBe(190);
  });

  it("preserves full message thread for multi-round conversations", async () => {
    mockCreate
      .mockResolvedValueOnce(mockToolUseResponse("read_file", { path: "config.json" }, "t_r1"))
      .mockResolvedValueOnce(mockToolUseResponse("bash", { command: "cat config.json" }, "t_r2"))
      .mockResolvedValueOnce(mockTextResponse("Config loaded and processed."));

    const handlers = {
      read_file: vi.fn(async () => '{"port": 3000}'),
      bash: vi.fn(async () => ({ stdout: '{"port": 3000}', exitCode: 0 })),
    };

    const loop = await backbone.runAgentLoop(
      [{ role: "user", content: "Load and process config" }],
      handlers,
      { tools: TOOL_DEFS, maxRounds: 10 }
    );

    expect(loop.status).toBe("completed");
    expect(loop.totalRounds).toBe(3);
    // user, assistant(tool1), user(result1), assistant(tool2), user(result2), assistant(final)
    expect(loop.messages.length).toBe(6);
    expect(handlers.read_file).toHaveBeenCalledOnce();
    expect(handlers.bash).toHaveBeenCalledOnce();
  });
});
