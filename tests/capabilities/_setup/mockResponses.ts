/**
 * Mock LLM Response Builders
 * Full mock response factories for each provider format used in capability tests.
 * All shapes mirror the real provider SDKs so assertProviderResponse() passes.
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  id?: string;
}

// ---------------------------------------------------------------------------
// Anthropic format types
// ---------------------------------------------------------------------------

export interface AnthropicContentBlockText {
  type: "text";
  text: string;
}

export interface AnthropicContentBlockToolUse {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type AnthropicContentBlock =
  | AnthropicContentBlockText
  | AnthropicContentBlockToolUse;

export interface AnthropicMessage {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ---------------------------------------------------------------------------
// OpenAI / Grok / Mistral format types (all share the same envelope)
// ---------------------------------------------------------------------------

export interface OpenAIFunctionCall {
  name: string;
  arguments: string; // JSON-serialised
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: OpenAIFunctionCall;
}

export interface OpenAIMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
}

export interface OpenAIChoice {
  index: number;
  message: OpenAIMessage;
  logprobs: null;
  finish_reason: "stop" | "tool_calls" | "length" | "content_filter";
}

export interface OpenAIResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  system_fingerprint: string | null;
}

// ---------------------------------------------------------------------------
// Gemini format types
// ---------------------------------------------------------------------------

export interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

export interface GeminiPart {
  text?: string;
  functionCall?: GeminiFunctionCall;
}

export interface GeminiContent {
  parts: GeminiPart[];
  role: "model";
}

export interface GeminiCandidate {
  content: GeminiContent;
  finishReason: "STOP" | "MAX_TOKENS" | "SAFETY" | "RECITATION" | "OTHER";
  index: number;
  safetyRatings: Array<{
    category: string;
    probability: string;
  }>;
}

export interface GeminiResponse {
  candidates: GeminiCandidate[];
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

// ---------------------------------------------------------------------------
// Streaming chunk types
// ---------------------------------------------------------------------------

export interface OpenAIStreamChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: "assistant"; content?: string };
    finish_reason: null | "stop" | "tool_calls";
  }>;
}

export interface AnthropicStreamChunk {
  type:
    | "message_start"
    | "content_block_start"
    | "content_block_delta"
    | "content_block_stop"
    | "message_delta"
    | "message_stop";
  index?: number;
  delta?: { type: "text_delta"; text: string };
}

// ---------------------------------------------------------------------------
// Capability execution result mocks (preserved from original)
// ---------------------------------------------------------------------------

export interface ExcelResultMock {
  event: string;
  bytes: number;
  absolute_path: string;
  sheet_count: number;
  instructions: string;
}

export function createExcelResult(
  filename = "report.xlsx",
  sheetCount = 1,
): ExcelResultMock {
  return {
    event: "Excel File Created Successfully",
    bytes: 4096 + sheetCount * 512,
    absolute_path: `/workspace/${filename}`,
    sheet_count: sheetCount,
    instructions: `File written to /workspace/${filename}`,
  };
}

export interface PptResultMock {
  event: string;
  bytes: number;
  absolute_path: string;
  slide_count: number;
}

export function createPptResult(
  filename = "deck.pptx",
  slideCount = 2,
): PptResultMock {
  return {
    event: "Presentation Created Successfully",
    bytes: 8192 + slideCount * 1024,
    absolute_path: `/workspace/${filename}`,
    slide_count: slideCount,
  };
}

export interface WordResultMock {
  event: string;
  bytes: number;
  absolute_path: string;
}

export function createWordResult(filename = "document.docx"): WordResultMock {
  return {
    event: "Word Document Created Successfully",
    bytes: 3072,
    absolute_path: `/workspace/${filename}`,
  };
}

export interface PdfResultMock {
  event: string;
  bytes: number;
  absolute_path: string;
  page_count: number;
}

export function createPdfResult(
  filename = "document.pdf",
  pageCount = 1,
): PdfResultMock {
  return {
    event: "PDF Created Successfully",
    bytes: 6144 + pageCount * 512,
    absolute_path: `/workspace/${filename}`,
    page_count: pageCount,
  };
}

// ---------------------------------------------------------------------------
// ID generators
// ---------------------------------------------------------------------------

let _idCounter = 0;

function nextId(prefix = "id"): string {
  return `${prefix}_${Date.now()}_${++_idCounter}`;
}

// ---------------------------------------------------------------------------
// Anthropic response builders
// ---------------------------------------------------------------------------

/**
 * Creates an Anthropic message that contains a `tool_use` block.
 * An optional leading text block can be included before the tool call.
 */
export function createAnthropicToolUseResponse(
  tool: ToolCall,
  textContent?: string,
): AnthropicMessage {
  const content: AnthropicContentBlock[] = [];

  if (textContent) {
    content.push({ type: "text", text: textContent });
  }

  content.push({
    type: "tool_use",
    id: tool.id ?? nextId("toolu"),
    name: tool.name,
    input: tool.arguments,
  });

  return {
    id: nextId("msg"),
    type: "message",
    role: "assistant",
    content,
    model: "claude-3-5-sonnet-20241022",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: {
      input_tokens: 150,
      output_tokens: 80,
    },
  };
}

/**
 * Creates an Anthropic text-only message.
 */
export function createAnthropicTextResponse(text: string): AnthropicMessage {
  return {
    id: nextId("msg"),
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    model: "claude-3-5-sonnet-20241022",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: text.split(" ").length,
    },
  };
}

// ---------------------------------------------------------------------------
// OpenAI response builders
// ---------------------------------------------------------------------------

function buildOpenAIBase(modelId: string): Omit<OpenAIResponse, "choices"> {
  return {
    id: nextId("chatcmpl"),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    usage: {
      prompt_tokens: 150,
      completion_tokens: 80,
      total_tokens: 230,
    },
    system_fingerprint: null,
  };
}

/**
 * Creates an OpenAI chat completion that contains a function/tool call.
 */
export function createOpenAIFunctionCallResponse(
  tool: ToolCall,
  textContent?: string,
  modelId = "gpt-4o",
): OpenAIResponse {
  const message: OpenAIMessage = {
    role: "assistant",
    content: textContent ?? null,
    tool_calls: [
      {
        id: tool.id ?? nextId("call"),
        type: "function",
        function: {
          name: tool.name,
          arguments: JSON.stringify(tool.arguments),
        },
      },
    ],
  };

  return {
    ...buildOpenAIBase(modelId),
    choices: [
      {
        index: 0,
        message,
        logprobs: null,
        finish_reason: "tool_calls",
      },
    ],
  };
}

/**
 * Creates an OpenAI text-only response.
 */
export function createOpenAITextResponse(
  text: string,
  modelId = "gpt-4o",
): OpenAIResponse {
  return {
    ...buildOpenAIBase(modelId),
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        logprobs: null,
        finish_reason: "stop",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Grok response builders (same envelope as OpenAI)
// ---------------------------------------------------------------------------

/**
 * Creates a Grok function-call response (identical structure to OpenAI).
 */
export function createGrokFunctionCallResponse(
  tool: ToolCall,
  textContent?: string,
): OpenAIResponse {
  return createOpenAIFunctionCallResponse(tool, textContent, "grok-2");
}

/**
 * Creates a Grok text response.
 */
export function createGrokTextResponse(text: string): OpenAIResponse {
  return createOpenAITextResponse(text, "grok-2");
}

// ---------------------------------------------------------------------------
// Mistral response builders (same envelope as OpenAI)
// ---------------------------------------------------------------------------

/**
 * Creates a Mistral function-call response (identical structure to OpenAI).
 */
export function createMistralFunctionCallResponse(
  tool: ToolCall,
  textContent?: string,
): OpenAIResponse {
  return createOpenAIFunctionCallResponse(
    tool,
    textContent,
    "mistral-large-latest",
  );
}

/**
 * Creates a Mistral text response.
 */
export function createMistralTextResponse(text: string): OpenAIResponse {
  return createOpenAITextResponse(text, "mistral-large-latest");
}

// ---------------------------------------------------------------------------
// Gemini response builders
// ---------------------------------------------------------------------------

/**
 * Creates a Gemini response that contains a `functionCall` part.
 */
export function createGeminiFunctionCallResponse(
  tool: ToolCall,
  textContent?: string,
): GeminiResponse {
  const parts: GeminiPart[] = [];

  if (textContent) {
    parts.push({ text: textContent });
  }

  parts.push({
    functionCall: {
      name: tool.name,
      args: tool.arguments,
    },
  });

  return {
    candidates: [
      {
        content: {
          parts,
          role: "model",
        },
        finishReason: "STOP",
        index: 0,
        safetyRatings: [
          { category: "HARM_CATEGORY_HATE_SPEECH", probability: "NEGLIGIBLE" },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            probability: "NEGLIGIBLE",
          },
        ],
      },
    ],
    usageMetadata: {
      promptTokenCount: 150,
      candidatesTokenCount: 80,
      totalTokenCount: 230,
    },
  };
}

/**
 * Creates a Gemini text-only response.
 */
export function createGeminiTextResponse(text: string): GeminiResponse {
  return {
    candidates: [
      {
        content: {
          parts: [{ text }],
          role: "model",
        },
        finishReason: "STOP",
        index: 0,
        safetyRatings: [],
      },
    ],
    usageMetadata: {
      promptTokenCount: 100,
      candidatesTokenCount: text.split(" ").length,
      totalTokenCount: 100 + text.split(" ").length,
    },
  };
}

// ---------------------------------------------------------------------------
// Unified getMockResponseForProvider
// ---------------------------------------------------------------------------

/**
 * Returns a provider-appropriate mock response that contains a tool call.
 * The `provider` string must match one of: anthropic, openai, gemini, grok, mistral.
 */
export function getMockResponseForProvider(
  provider: string,
  tool: ToolCall,
  textContent?: string,
): unknown {
  switch (provider) {
    case "anthropic":
      return createAnthropicToolUseResponse(tool, textContent);
    case "openai":
      return createOpenAIFunctionCallResponse(tool, textContent);
    case "gemini":
      return createGeminiFunctionCallResponse(tool, textContent);
    case "grok":
      return createGrokFunctionCallResponse(tool, textContent);
    case "mistral":
      return createMistralFunctionCallResponse(tool, textContent);
    case "mock":
      return createAnthropicToolUseResponse(tool, textContent);
    default:
      return createOpenAIFunctionCallResponse(tool, textContent);
  }
}

/**
 * Returns a provider-appropriate text-only mock response.
 */
export function createTextResponse(provider: string, text: string): unknown {
  switch (provider) {
    case "anthropic":
    case "mock":
      return createAnthropicTextResponse(text);
    case "openai":
      return createOpenAITextResponse(text);
    case "gemini":
      return createGeminiTextResponse(text);
    case "grok":
      return createGrokTextResponse(text);
    case "mistral":
      return createMistralTextResponse(text);
    default:
      return createOpenAITextResponse(text);
  }
}

// ---------------------------------------------------------------------------
// Streaming chunk helpers
// ---------------------------------------------------------------------------

/**
 * Creates a streaming delta chunk for the given provider.
 */
export function createStreamChunk(provider: string, delta: string): unknown {
  switch (provider) {
    case "anthropic":
    case "mock": {
      const chunk: AnthropicStreamChunk = {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: delta },
      };
      return chunk;
    }
    case "gemini": {
      return {
        candidates: [
          {
            content: { parts: [{ text: delta }], role: "model" },
            finishReason: "STOP",
            index: 0,
            safetyRatings: [],
          },
        ],
        usageMetadata: {
          promptTokenCount: 0,
          candidatesTokenCount: 0,
          totalTokenCount: 0,
        },
      } as GeminiResponse;
    }
    case "openai":
    case "grok":
    case "mistral":
    default: {
      const chunk: OpenAIStreamChunk = {
        id: nextId("chatcmpl"),
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model:
          provider === "grok"
            ? "grok-2"
            : provider === "mistral"
            ? "mistral-large-latest"
            : "gpt-4o",
        choices: [
          {
            index: 0,
            delta: { content: delta },
            finish_reason: null,
          },
        ],
      };
      return chunk;
    }
  }
}

/**
 * Creates the terminal (final) streaming chunk that signals the end of a stream.
 */
export function createStreamFinalChunk(provider: string): unknown {
  switch (provider) {
    case "anthropic":
    case "mock": {
      const chunk: AnthropicStreamChunk = { type: "message_stop" };
      return chunk;
    }
    case "gemini": {
      return {
        candidates: [
          {
            content: { parts: [{ text: "" }], role: "model" },
            finishReason: "STOP",
            index: 0,
            safetyRatings: [],
          },
        ],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 150,
        },
      } as GeminiResponse;
    }
    case "openai":
    case "grok":
    case "mistral":
    default: {
      const chunk: OpenAIStreamChunk = {
        id: nextId("chatcmpl"),
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model:
          provider === "grok"
            ? "grok-2"
            : provider === "mistral"
            ? "mistral-large-latest"
            : "gpt-4o",
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "stop",
          },
        ],
      };
      return chunk;
    }
  }
}

// ---------------------------------------------------------------------------
// Pre-built mock tool calls
// ---------------------------------------------------------------------------

export const MOCK_EXCEL_TOOL: ToolCall = {
  id: "toolu_excel_001",
  name: "create_spreadsheet",
  arguments: {
    filename: "report.xlsx",
    sheets: [
      {
        name: "Sheet1",
        data: [
          ["Name", "Q1", "Q2", "Q3", "Q4"],
          ["Product A", 1200, 1350, 1100, 1450],
          ["Product B", 900, 875, 1020, 1300],
          ["Product C", 600, 720, 690, 810],
        ],
      },
    ],
    format: "xlsx",
  },
};

export const MOCK_PPT_TOOL: ToolCall = {
  id: "toolu_ppt_001",
  name: "create_presentation",
  arguments: {
    filename: "presentation.pptx",
    title: "Q4 Business Review",
    slides: [
      {
        title: "Executive Summary",
        bullets: [
          "Revenue up 15% YoY",
          "3 new enterprise clients",
          "Launch of v2 product",
        ],
        layout: "title_and_content",
      },
      {
        title: "Financial Highlights",
        bullets: ["ARR: $2.4M", "Gross Margin: 72%", "Burn Rate: $150k/mo"],
        layout: "title_and_content",
      },
    ],
    theme: "corporate",
  },
};

export const MOCK_WORD_TOOL: ToolCall = {
  id: "toolu_word_001",
  name: "create_document",
  arguments: {
    filename: "report.docx",
    title: "Monthly Report",
    sections: [
      {
        heading: "Introduction",
        body: "This report summarises the key activities and outcomes for the month.",
      },
      {
        heading: "Key Achievements",
        body: "The team delivered 12 features, resolved 34 bugs, and onboarded 5 new clients.",
      },
    ],
    format: "docx",
  },
};

export const MOCK_PDF_TOOL: ToolCall = {
  id: "toolu_pdf_001",
  name: "create_pdf",
  arguments: {
    filename: "invoice.pdf",
    content: {
      title: "Invoice #1042",
      sections: [
        {
          type: "table",
          headers: ["Item", "Qty", "Unit Price", "Total"],
          rows: [
            ["Consulting", "10", "$200", "$2,000"],
            ["Software License", "1", "$500", "$500"],
          ],
        },
      ],
      footer: "Payment due within 30 days.",
    },
  },
};

export const MOCK_CODE_TOOL: ToolCall = {
  id: "toolu_code_001",
  name: "execute_code",
  arguments: {
    language: "python",
    code: [
      "import json",
      "",
      'data = {"values": [1, 2, 3, 4, 5]}',
      "result = {",
      '    "sum": sum(data["values"]),',
      '    "mean": sum(data["values"]) / len(data["values"]),',
      '    "count": len(data["values"]),',
      "}",
      "print(json.dumps(result))",
    ].join("\n"),
    timeout: 30,
  },
};

export const MOCK_BROWSER_TOOL: ToolCall = {
  id: "toolu_browser_001",
  name: "navigate_to",
  arguments: {
    url: "https://example.com",
    wait_for: "networkidle",
    screenshot: true,
  },
};

export const MOCK_SEARCH_TOOL: ToolCall = {
  id: "toolu_search_001",
  name: "web_search",
  arguments: {
    query: "latest AI model benchmarks 2025",
    num_results: 5,
    safe_search: true,
  },
};

export const MOCK_FILE_TOOL: ToolCall = {
  id: "toolu_file_001",
  name: "write_file",
  arguments: {
    path: "/tmp/output.txt",
    content: "Hello from the file tool.",
    encoding: "utf-8",
    overwrite: true,
  },
};

export const MOCK_DATA_TOOL: ToolCall = {
  id: "toolu_data_001",
  name: "analyze_data",
  arguments: {
    dataset: [
      { month: "Jan", revenue: 12000, cost: 8000 },
      { month: "Feb", revenue: 13500, cost: 8500 },
      { month: "Mar", revenue: 11000, cost: 7500 },
    ],
    operations: ["describe", "correlation", "trend"],
    output_format: "json",
  },
};

export const MOCK_AGENT_TOOL: ToolCall = {
  id: "toolu_agent_001",
  name: "spawn_agent",
  arguments: {
    task: "Research the top 5 competitors and compile a comparison table.",
    agent_type: "research",
    max_iterations: 10,
    tools: ["web_search", "web_scrape", "create_spreadsheet"],
  },
};

// ---------------------------------------------------------------------------
// All mock tool calls as a keyed map
// ---------------------------------------------------------------------------

export const MOCK_TOOLS: Record<string, ToolCall> = {
  excel: MOCK_EXCEL_TOOL,
  ppt: MOCK_PPT_TOOL,
  word: MOCK_WORD_TOOL,
  pdf: MOCK_PDF_TOOL,
  code: MOCK_CODE_TOOL,
  browser: MOCK_BROWSER_TOOL,
  search: MOCK_SEARCH_TOOL,
  file: MOCK_FILE_TOOL,
  data: MOCK_DATA_TOOL,
  agent: MOCK_AGENT_TOOL,
};

// ---------------------------------------------------------------------------
// Helper: extract tool call from a provider response
// ---------------------------------------------------------------------------

/**
 * Extracts the first tool call from any provider response, or null if none found.
 * Useful in tests to inspect what tool was invoked.
 */
export function extractToolCallFromResponse(
  provider: string,
  response: unknown,
): ToolCall | null {
  if (!response || typeof response !== "object") return null;
  const r = response as Record<string, unknown>;

  switch (provider) {
    case "anthropic":
    case "mock": {
      const content = r["content"] as AnthropicContentBlock[] | undefined;
      if (!Array.isArray(content)) return null;
      const block = content.find((b) => b.type === "tool_use") as
        | AnthropicContentBlockToolUse
        | undefined;
      if (!block) return null;
      return { id: block.id, name: block.name, arguments: block.input };
    }

    case "openai":
    case "grok":
    case "mistral": {
      const choices = r["choices"] as OpenAIChoice[] | undefined;
      if (!Array.isArray(choices) || choices.length === 0) return null;
      const toolCalls = choices[0].message.tool_calls;
      if (!toolCalls || toolCalls.length === 0) return null;
      const tc = toolCalls[0];
      return {
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      };
    }

    case "gemini": {
      const candidates = r["candidates"] as GeminiCandidate[] | undefined;
      if (!Array.isArray(candidates) || candidates.length === 0) return null;
      const parts = candidates[0].content.parts;
      const part = parts.find((p) => p.functionCall);
      if (!part?.functionCall) return null;
      return {
        name: part.functionCall.name,
        arguments: part.functionCall.args,
      };
    }

    default:
      return null;
  }
}

/**
 * Extracts the text content from a provider response, or null if none.
 */
export function extractTextFromResponse(
  provider: string,
  response: unknown,
): string | null {
  if (!response || typeof response !== "object") return null;
  const r = response as Record<string, unknown>;

  switch (provider) {
    case "anthropic":
    case "mock": {
      const content = r["content"] as AnthropicContentBlock[] | undefined;
      if (!Array.isArray(content)) return null;
      const block = content.find((b) => b.type === "text") as
        | AnthropicContentBlockText
        | undefined;
      return block?.text ?? null;
    }

    case "openai":
    case "grok":
    case "mistral": {
      const choices = r["choices"] as OpenAIChoice[] | undefined;
      if (!Array.isArray(choices) || choices.length === 0) return null;
      return choices[0].message.content ?? null;
    }

    case "gemini": {
      const candidates = r["candidates"] as GeminiCandidate[] | undefined;
      if (!Array.isArray(candidates) || candidates.length === 0) return null;
      const textPart = candidates[0].content.parts.find((p) => p.text);
      return textPart?.text ?? null;
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// ToolSpec alias (backwards compat with original file)
// ---------------------------------------------------------------------------

/** @deprecated Use ToolCall instead */
export type ToolSpec = ToolCall;
