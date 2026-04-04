/**
 * Tool Calling Integration Tests
 *
 * Tests the complete tool call lifecycle across different LLM provider formats:
 *   - Converting canonical ToolDefinition → Claude / OpenAI / Gemini wire format
 *   - Parsing tool_use blocks from each provider's response format
 *   - Streaming tool call accumulation (chunked arrival)
 *   - Tool result formatting back to each provider's expected format
 *
 * No real LLM calls are made. All provider responses are crafted test fixtures.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Canonical tool definition (provider-agnostic)
// ─────────────────────────────────────────────────────────────────────────────

interface CanonicalTool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResult {
  id: string;
  name: string;
  content: string;
  isError?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Format Converter (the logic under test)
// ─────────────────────────────────────────────────────────────────────────────

/** Convert canonical tool → Anthropic Claude format */
function toClaudeFormat(tool: CanonicalTool) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object" as const,
      properties: tool.parameters.properties,
      required: tool.parameters.required ?? [],
    },
  };
}

/** Convert canonical tool → OpenAI function-calling format */
function toOpenAIFormat(tool: CanonicalTool) {
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object" as const,
        properties: tool.parameters.properties,
        required: tool.parameters.required ?? [],
      },
    },
  };
}

/** Convert canonical tool → Gemini functionDeclarations format */
function toGeminiFormat(tool: CanonicalTool) {
  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: "OBJECT" as const,
      properties: Object.fromEntries(
        Object.entries(tool.parameters.properties).map(([k, v]) => [
          k,
          { type: v.type.toUpperCase(), description: v.description ?? "" },
        ])
      ),
      required: tool.parameters.required ?? [],
    },
  };
}

/** Parse Claude tool_use content block → canonical ToolCall */
function parseClaudeToolCall(block: {
  type: string;
  id: string;
  name: string;
  input: Record<string, unknown>;
}): ToolCall | null {
  if (block.type !== "tool_use") return null;
  return { id: block.id, name: block.name, input: block.input };
}

/** Parse OpenAI tool_calls array → canonical ToolCall[] */
function parseOpenAIToolCalls(
  toolCalls: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>
): ToolCall[] {
  return toolCalls.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    input: JSON.parse(tc.function.arguments),
  }));
}

/** Parse Gemini functionCall parts → canonical ToolCall[] */
function parseGeminiToolCalls(
  parts: Array<{ functionCall?: { name: string; args: Record<string, unknown> } }>
): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const part of parts) {
    if (part.functionCall) {
      calls.push({
        id: `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: part.functionCall.name,
        input: part.functionCall.args,
      });
    }
  }
  return calls;
}

/** Format canonical ToolResult back to Claude's tool_result block */
function toClaudeToolResult(result: ToolResult) {
  return {
    type: "tool_result" as const,
    tool_use_id: result.id,
    content: result.content,
    is_error: result.isError ?? false,
  };
}

/** Format canonical ToolResult back to OpenAI's message format */
function toOpenAIToolResult(result: ToolResult) {
  return {
    role: "tool" as const,
    tool_call_id: result.id,
    name: result.name,
    content: result.content,
  };
}

/** Format canonical ToolResult back to Gemini functionResponse format */
function toGeminiToolResult(result: ToolResult) {
  return {
    functionResponse: {
      name: result.name,
      response: {
        name: result.name,
        content: result.isError
          ? { error: result.content }
          : { output: result.content },
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming tool call accumulator
// ─────────────────────────────────────────────────────────────────────────────

/** Accumulates streaming JSON chunks into a complete tool call */
class StreamingToolCallAccumulator {
  private partialCalls = new Map<
    string,
    { id: string; name: string; accumulatedArgs: string }
  >();
  private completedCalls: ToolCall[] = [];

  /** Process a Claude streaming event */
  processClaudeStreamEvent(event: {
    type: string;
    index?: number;
    id?: string;
    name?: string;
    partial_json?: string;
  }): void {
    if (event.type === "content_block_start" && event.id && event.name) {
      this.partialCalls.set(String(event.index ?? 0), {
        id: event.id,
        name: event.name,
        accumulatedArgs: "",
      });
    } else if (event.type === "content_block_delta" && event.partial_json !== undefined) {
      const partial = this.partialCalls.get(String(event.index ?? 0));
      if (partial) partial.accumulatedArgs += event.partial_json;
    } else if (event.type === "content_block_stop") {
      const partial = this.partialCalls.get(String(event.index ?? 0));
      if (partial) {
        try {
          this.completedCalls.push({
            id: partial.id,
            name: partial.name,
            input: JSON.parse(partial.accumulatedArgs || "{}"),
          });
        } catch {
          // malformed JSON — store with empty input
          this.completedCalls.push({ id: partial.id, name: partial.name, input: {} });
        }
        this.partialCalls.delete(String(event.index ?? 0));
      }
    }
  }

  getCompletedCalls(): ToolCall[] {
    return [...this.completedCalls];
  }

  reset(): void {
    this.partialCalls.clear();
    this.completedCalls = [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_TOOLS: CanonicalTool[] = [
  {
    name: "web_search",
    description: "Search the web for information",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        num_results: { type: "string", description: "Number of results (default: 5)" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_file",
    description: "Read a file from the filesystem",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to read" },
        encoding: {
          type: "string",
          description: "File encoding",
          enum: ["utf8", "base64", "hex"],
        },
      },
      required: ["path"],
    },
  },
  {
    name: "execute_code",
    description: "Execute code in a sandboxed environment",
    parameters: {
      type: "object",
      properties: {
        language: { type: "string", enum: ["python", "javascript", "typescript"] },
        code: { type: "string", description: "Code to execute" },
        timeout_ms: { type: "string", description: "Execution timeout" },
      },
      required: ["language", "code"],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("ToolCalling — Format Conversion", () => {
  describe("toClaudeFormat", () => {
    it("converts canonical tool to Anthropic input_schema format", () => {
      const converted = toClaudeFormat(SAMPLE_TOOLS[0]);

      expect(converted.name).toBe("web_search");
      expect(converted.description).toBe("Search the web for information");
      expect(converted.input_schema.type).toBe("object");
      expect(converted.input_schema.properties).toHaveProperty("query");
      expect(converted.input_schema.required).toContain("query");
      // Should NOT have 'num_results' in required (it's optional)
      expect(converted.input_schema.required).not.toContain("num_results");
    });

    it("preserves enum values in Claude format properties", () => {
      const converted = toClaudeFormat(SAMPLE_TOOLS[2]);
      expect(converted.input_schema.properties.language).toHaveProperty("enum");
      expect(converted.input_schema.properties.language.enum).toContain("python");
    });

    it("handles tool with no required fields", () => {
      const toolNoRequired: CanonicalTool = {
        name: "ping",
        description: "Ping a server",
        parameters: {
          type: "object",
          properties: { host: { type: "string" } },
        },
      };
      const converted = toClaudeFormat(toolNoRequired);
      expect(converted.input_schema.required).toEqual([]);
    });

    it("converts all sample tools without data loss", () => {
      for (const tool of SAMPLE_TOOLS) {
        const converted = toClaudeFormat(tool);
        expect(converted.name).toBe(tool.name);
        expect(converted.description).toBe(tool.description);
        expect(Object.keys(converted.input_schema.properties)).toEqual(
          Object.keys(tool.parameters.properties)
        );
      }
    });
  });

  describe("toOpenAIFormat", () => {
    it("wraps tool in function envelope with correct structure", () => {
      const converted = toOpenAIFormat(SAMPLE_TOOLS[0]);

      expect(converted.type).toBe("function");
      expect(converted.function.name).toBe("web_search");
      expect(converted.function.description).toBe("Search the web for information");
      expect(converted.function.parameters.type).toBe("object");
      expect(converted.function.parameters.properties).toHaveProperty("query");
    });

    it("preserves required array in OpenAI format", () => {
      const converted = toOpenAIFormat(SAMPLE_TOOLS[1]);
      expect(converted.function.parameters.required).toContain("path");
      expect(converted.function.parameters.required).not.toContain("encoding");
    });

    it("produces valid JSON-serializable output for all tools", () => {
      for (const tool of SAMPLE_TOOLS) {
        const converted = toOpenAIFormat(tool);
        expect(() => JSON.stringify(converted)).not.toThrow();
      }
    });
  });

  describe("toGeminiFormat", () => {
    it("converts property types to uppercase for Gemini", () => {
      const converted = toGeminiFormat(SAMPLE_TOOLS[0]);

      expect(converted.name).toBe("web_search");
      expect(converted.parameters.type).toBe("OBJECT");
      expect(converted.parameters.properties.query.type).toBe("STRING");
    });

    it("preserves descriptions in Gemini format", () => {
      const converted = toGeminiFormat(SAMPLE_TOOLS[0]);
      expect(converted.parameters.properties.query.description).toBe("Search query");
    });

    it("handles missing description by defaulting to empty string", () => {
      const toolMinimal: CanonicalTool = {
        name: "noop",
        description: "Does nothing",
        parameters: {
          type: "object",
          properties: { x: { type: "number" } },
        },
      };
      const converted = toGeminiFormat(toolMinimal);
      expect(converted.parameters.properties.x.description).toBe("");
    });
  });
});

describe("ToolCalling — Response Parsing", () => {
  describe("parseClaudeToolCall", () => {
    it("parses a tool_use content block into canonical ToolCall", () => {
      const block = {
        type: "tool_use",
        id: "toolu_01XFDGnHFKBrXcbDTCGTYFxN",
        name: "web_search",
        input: { query: "Claude AI 2025", num_results: "10" },
      };

      const call = parseClaudeToolCall(block);

      expect(call).not.toBeNull();
      expect(call!.id).toBe("toolu_01XFDGnHFKBrXcbDTCGTYFxN");
      expect(call!.name).toBe("web_search");
      expect(call!.input.query).toBe("Claude AI 2025");
    });

    it("returns null for non-tool_use block types", () => {
      const textBlock = { type: "text", id: "x", name: "y", input: {} };
      expect(parseClaudeToolCall(textBlock)).toBeNull();
    });

    it("preserves nested input objects correctly", () => {
      const block = {
        type: "tool_use",
        id: "t1",
        name: "execute_code",
        input: {
          language: "python",
          code: "import json\nprint(json.dumps({'a': 1}))",
          timeout_ms: "5000",
        },
      };
      const call = parseClaudeToolCall(block);
      expect(call!.input.code).toContain("import json");
    });
  });

  describe("parseOpenAIToolCalls", () => {
    it("parses OpenAI tool_calls array with JSON string arguments", () => {
      const openAIResponse = [
        {
          id: "call_abc123",
          type: "function",
          function: {
            name: "web_search",
            arguments: JSON.stringify({ query: "latest news", num_results: "5" }),
          },
        },
      ];

      const calls = parseOpenAIToolCalls(openAIResponse);

      expect(calls).toHaveLength(1);
      expect(calls[0].id).toBe("call_abc123");
      expect(calls[0].name).toBe("web_search");
      expect(calls[0].input.query).toBe("latest news");
      expect(calls[0].input.num_results).toBe("5");
    });

    it("parses multiple concurrent tool calls from OpenAI response", () => {
      const openAIResponse = [
        {
          id: "call_001",
          type: "function",
          function: { name: "web_search", arguments: '{"query": "topic A"}' },
        },
        {
          id: "call_002",
          type: "function",
          function: { name: "read_file", arguments: '{"path": "/etc/config.json"}' },
        },
      ];

      const calls = parseOpenAIToolCalls(openAIResponse);

      expect(calls).toHaveLength(2);
      expect(calls[0].name).toBe("web_search");
      expect(calls[1].name).toBe("read_file");
      expect(calls[1].input.path).toBe("/etc/config.json");
    });

    it("handles complex nested JSON arguments from OpenAI", () => {
      const nestedArgs = {
        config: { timeout: 30, retries: 3, headers: { "X-API-Key": "secret" } },
        filters: ["active", "verified"],
      };
      const calls = parseOpenAIToolCalls([
        {
          id: "call_complex",
          type: "function",
          function: { name: "execute_code", arguments: JSON.stringify(nestedArgs) },
        },
      ]);

      expect((calls[0].input.config as any).headers["X-API-Key"]).toBe("secret");
      expect(calls[0].input.filters).toEqual(["active", "verified"]);
    });
  });

  describe("parseGeminiToolCalls", () => {
    it("parses Gemini functionCall parts into canonical ToolCalls", () => {
      const geminiParts = [
        {
          functionCall: {
            name: "web_search",
            args: { query: "Gemini AI capabilities", num_results: "3" },
          },
        },
      ];

      const calls = parseGeminiToolCalls(geminiParts);

      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe("web_search");
      expect(calls[0].input.query).toBe("Gemini AI capabilities");
      expect(calls[0].id).toMatch(/^gemini_/);
    });

    it("skips non-functionCall parts", () => {
      const geminiParts = [
        { text: "I'll search for that." } as any,
        { functionCall: { name: "web_search", args: { query: "test" } } },
      ];

      const calls = parseGeminiToolCalls(geminiParts);
      expect(calls).toHaveLength(1);
    });

    it("generates unique IDs for each Gemini tool call", () => {
      const geminiParts = [
        { functionCall: { name: "web_search", args: { query: "a" } } },
        { functionCall: { name: "read_file", args: { path: "b" } } },
      ];

      const calls = parseGeminiToolCalls(geminiParts);
      expect(calls[0].id).not.toBe(calls[1].id);
    });
  });
});

describe("ToolCalling — Tool Result Formatting", () => {
  const successResult: ToolResult = {
    id: "toolu_abc",
    name: "web_search",
    content: '[{"title": "Result 1", "url": "https://example.com"}]',
  };

  const errorResult: ToolResult = {
    id: "call_xyz",
    name: "read_file",
    content: "FileNotFoundError: /etc/nonexistent.txt",
    isError: true,
  };

  describe("toClaudeToolResult", () => {
    it("formats successful result as tool_result block", () => {
      const result = toClaudeToolResult(successResult);

      expect(result.type).toBe("tool_result");
      expect(result.tool_use_id).toBe("toolu_abc");
      expect(result.content).toContain("Result 1");
      expect(result.is_error).toBe(false);
    });

    it("sets is_error=true for failed tool results", () => {
      const result = toClaudeToolResult(errorResult);

      expect(result.is_error).toBe(true);
      expect(result.content).toContain("FileNotFoundError");
    });
  });

  describe("toOpenAIToolResult", () => {
    it("formats result as tool role message for OpenAI", () => {
      const result = toOpenAIToolResult(successResult);

      expect(result.role).toBe("tool");
      expect(result.tool_call_id).toBe("toolu_abc");
      expect(result.name).toBe("web_search");
      expect(result.content).toContain("Result 1");
    });
  });

  describe("toGeminiToolResult", () => {
    it("formats successful result as functionResponse with output field", () => {
      const result = toGeminiToolResult(successResult);

      expect(result.functionResponse.name).toBe("web_search");
      expect(result.functionResponse.response.content).toHaveProperty("output");
      expect(result.functionResponse.response.content).not.toHaveProperty("error");
    });

    it("formats error result with error field instead of output", () => {
      const result = toGeminiToolResult(errorResult);

      expect(result.functionResponse.response.content).toHaveProperty("error");
      expect(result.functionResponse.response.content).not.toHaveProperty("output");
    });
  });
});

describe("ToolCalling — Streaming Accumulation", () => {
  let accumulator: StreamingToolCallAccumulator;

  beforeEach(() => {
    accumulator = new StreamingToolCallAccumulator();
  });

  it("accumulates a complete tool call from streaming JSON chunks", () => {
    const events = [
      { type: "content_block_start", index: 0, id: "toolu_stream_001", name: "web_search" },
      { type: "content_block_delta", index: 0, partial_json: '{"que' },
      { type: "content_block_delta", index: 0, partial_json: 'ry": "stre' },
      { type: "content_block_delta", index: 0, partial_json: 'aming test"}' },
      { type: "content_block_stop", index: 0 },
    ];

    for (const event of events) {
      accumulator.processClaudeStreamEvent(event);
    }

    const calls = accumulator.getCompletedCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].id).toBe("toolu_stream_001");
    expect(calls[0].name).toBe("web_search");
    expect(calls[0].input.query).toBe("streaming test");
  });

  it("accumulates multiple concurrent tool calls from interleaved stream events", () => {
    // Two tools being streamed simultaneously
    const events = [
      { type: "content_block_start", index: 0, id: "tool_A", name: "web_search" },
      { type: "content_block_start", index: 1, id: "tool_B", name: "read_file" },
      { type: "content_block_delta", index: 0, partial_json: '{"query": "A"}' },
      { type: "content_block_delta", index: 1, partial_json: '{"path": "/tmp/B"}' },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_stop", index: 1 },
    ];

    for (const event of events) {
      accumulator.processClaudeStreamEvent(event);
    }

    const calls = accumulator.getCompletedCalls();
    expect(calls).toHaveLength(2);

    const searchCall = calls.find((c) => c.name === "web_search");
    const fileCall = calls.find((c) => c.name === "read_file");

    expect(searchCall?.input.query).toBe("A");
    expect(fileCall?.input.path).toBe("/tmp/B");
  });

  it("handles malformed JSON gracefully by producing empty input", () => {
    const events = [
      { type: "content_block_start", index: 0, id: "t_bad", name: "bash" },
      { type: "content_block_delta", index: 0, partial_json: '{"command": broken JSON' },
      { type: "content_block_stop", index: 0 },
    ];

    for (const event of events) {
      accumulator.processClaudeStreamEvent(event);
    }

    const calls = accumulator.getCompletedCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toEqual({});
  });

  it("resets cleanly between uses", () => {
    accumulator.processClaudeStreamEvent({ type: "content_block_start", index: 0, id: "t1", name: "tool1" });
    accumulator.processClaudeStreamEvent({ type: "content_block_delta", index: 0, partial_json: '{}' });
    accumulator.processClaudeStreamEvent({ type: "content_block_stop", index: 0 });
    expect(accumulator.getCompletedCalls()).toHaveLength(1);

    accumulator.reset();
    expect(accumulator.getCompletedCalls()).toHaveLength(0);

    accumulator.processClaudeStreamEvent({ type: "content_block_start", index: 0, id: "t2", name: "tool2" });
    accumulator.processClaudeStreamEvent({ type: "content_block_delta", index: 0, partial_json: '{"x":1}' });
    accumulator.processClaudeStreamEvent({ type: "content_block_stop", index: 0 });
    expect(accumulator.getCompletedCalls()).toHaveLength(1);
    expect(accumulator.getCompletedCalls()[0].id).toBe("t2");
  });

  it("handles empty arguments (tool called with no params)", () => {
    const events = [
      { type: "content_block_start", index: 0, id: "t_empty", name: "get_status" },
      { type: "content_block_delta", index: 0, partial_json: "{}" },
      { type: "content_block_stop", index: 0 },
    ];

    for (const event of events) {
      accumulator.processClaudeStreamEvent(event);
    }

    const calls = accumulator.getCompletedCalls();
    expect(calls[0].input).toEqual({});
  });

  it("ignores delta events with no matching start", () => {
    // Delta arrives for index 99 that was never started
    accumulator.processClaudeStreamEvent({
      type: "content_block_delta",
      index: 99,
      partial_json: '{"orphan": true}',
    });
    accumulator.processClaudeStreamEvent({ type: "content_block_stop", index: 99 });

    expect(accumulator.getCompletedCalls()).toHaveLength(0);
  });
});

describe("ToolCalling — Round-trip Fidelity", () => {
  it("Claude format: canonical → wire → parsed is lossless", () => {
    const original: CanonicalTool = SAMPLE_TOOLS[2]; // execute_code
    const wireFormat = toClaudeFormat(original);

    // Simulate parsing an incoming Claude response that uses this tool schema
    const incomingBlock = {
      type: "tool_use",
      id: "toolu_rt_001",
      name: wireFormat.name,
      input: { language: "python", code: "print('hello')", timeout_ms: "3000" },
    };

    const parsed = parseClaudeToolCall(incomingBlock)!;
    const resultBlock = toClaudeToolResult({
      id: parsed.id,
      name: parsed.name,
      content: '{"output": "hello\\n", "exitCode": 0}',
    });

    expect(parsed.name).toBe(original.name);
    expect(resultBlock.tool_use_id).toBe(incomingBlock.id);
    expect(resultBlock.is_error).toBe(false);
  });

  it("OpenAI format: canonical → wire → parsed is lossless", () => {
    const original = SAMPLE_TOOLS[0]; // web_search
    const wireFormat = toOpenAIFormat(original);

    const incomingCall = {
      id: "call_rt_001",
      type: "function",
      function: {
        name: wireFormat.function.name,
        arguments: JSON.stringify({ query: "test", num_results: "3" }),
      },
    };

    const [parsed] = parseOpenAIToolCalls([incomingCall]);
    const resultMsg = toOpenAIToolResult({
      id: parsed.id,
      name: parsed.name,
      content: '[{"title": "result", "url": "https://example.com"}]',
    });

    expect(parsed.name).toBe(original.name);
    expect(resultMsg.tool_call_id).toBe("call_rt_001");
    expect(resultMsg.role).toBe("tool");
  });
});
