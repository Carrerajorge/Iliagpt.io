/**
 * Agentic Tool Registrations — Registers all new orchestrator tools
 * into the existing toolRegistry so the AgentOrchestrator can dispatch them.
 *
 * Tools registered:
 *   - browser_navigate, browser_click, browser_type, browser_extract,
 *     browser_screenshot, browser_assert
 *   - web_research, web_fetch, web_extract
 *   - generate_pptx, generate_docx, generate_xlsx
 *   - terminal_exec
 */

import { z } from "zod";
import { randomUUID } from "crypto";
import { toolRegistry } from "../toolRegistry";
import type { ToolDefinition, ToolContext, ToolResult, ToolArtifact, ArtifactType } from "../toolRegistry";
import { BrowserToolApi, BrowserActionSchema } from "../browser/browserToolApi";
import { WebResearchEngine } from "../tools/webResearchTools";
import {
  DocumentEngine,
  PresentationSpecSchema,
  DocumentSpecSchema,
  WorkbookSpecSchema,
} from "../documents/documentEngine";
import {
  PresentationValidator,
  DocumentValidator,
  WorkbookValidator,
} from "../documents/documentValidators";
import {
  TerminalController,
  evaluateCommand,
} from "../tools/terminalControl";

/* ------------------------------------------------------------------ */
/*  Shared instances (lazily created per execution)                   */
/* ------------------------------------------------------------------ */

const browserApiInstances = new Map<string, BrowserToolApi>();
const researchEngine = new WebResearchEngine();
const documentEngine = new DocumentEngine();
const terminalController = new TerminalController();
const pptxValidator = new PresentationValidator();
const docxValidator = new DocumentValidator();
const xlsxValidator = new WorkbookValidator();

function getBrowserApi(runId: string): BrowserToolApi {
  let api = browserApiInstances.get(runId);
  if (!api) {
    api = new BrowserToolApi();
    browserApiInstances.set(runId, api);
  }
  return api;
}

function createError(code: string, message: string, retryable: boolean) {
  return { code, message, retryable };
}

function createArtifact(
  type: ArtifactType,
  name: string,
  data: any,
  mimeType?: string
): ToolArtifact {
  return {
    id: randomUUID(),
    type,
    name,
    mimeType,
    data,
    size: typeof data === "string" ? data.length : undefined,
    createdAt: new Date(),
  };
}

/* ================================================================== */
/*  BROWSER TOOLS                                                     */
/* ================================================================== */

const browserNavigateSchema = z.object({
  url: z.string().url().describe("URL to navigate to"),
  waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).default("networkidle").optional(),
});

const browserNavigateTool: ToolDefinition = {
  name: "browser_navigate",
  description: "Open a URL in the browser and return page info + screenshot.",
  inputSchema: browserNavigateSchema,
  capabilities: ["requires_network", "accesses_external_api"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const api = getBrowserApi(context.runId);
      const result = await api.execute({
        action: "browser.open",
        url: input.url,
        waitUntil: input.waitUntil || "networkidle",
      });

      return {
        success: result.success,
        output: {
          url: result.data?.url || input.url,
          title: result.data?.title,
          screenshot: result.screenshot ? "[screenshot captured]" : undefined,
        },
        artifacts: result.screenshot
          ? [createArtifact("image", "screenshot.png", result.screenshot, "image/png")]
          : [],
        previews: result.screenshot
          ? [{ type: "image", content: result.screenshot, title: "Browser Screenshot" }]
          : [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
        error: result.error ? createError("BROWSER_NAV_ERROR", result.error, true) : undefined,
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("BROWSER_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

const browserClickSchema = z.object({
  target: z.string().describe("Element to click (CSS selector, text, or aria: prefix)"),
  doubleClick: z.boolean().default(false).optional(),
});

const browserClickTool: ToolDefinition = {
  name: "browser_click",
  description: "Click an element in the browser using smart selector strategy (ARIA > testid > text > CSS).",
  inputSchema: browserClickSchema,
  capabilities: ["requires_network", "accesses_external_api"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const api = getBrowserApi(context.runId);
      const result = await api.execute({
        action: "browser.click",
        target: input.target,
        doubleClick: input.doubleClick || false,
        button: "left",
      });

      return {
        success: result.success,
        output: {
          selector: result.selector,
          url: result.data?.url,
        },
        artifacts: result.screenshot
          ? [createArtifact("image", "click-result.png", result.screenshot, "image/png")]
          : [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
        error: result.error ? createError("BROWSER_CLICK_ERROR", result.error, true) : undefined,
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("BROWSER_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

const browserTypeSchema = z.object({
  target: z.string().describe("Input element to type into"),
  text: z.string().describe("Text to type"),
  clear: z.boolean().default(true).optional(),
  pressEnter: z.boolean().default(false).optional(),
});

const browserTypeTool: ToolDefinition = {
  name: "browser_type",
  description: "Type text into a form input using smart selector strategy.",
  inputSchema: browserTypeSchema,
  capabilities: ["requires_network", "accesses_external_api"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const api = getBrowserApi(context.runId);
      const result = await api.execute({
        action: "browser.type",
        target: input.target,
        text: input.text,
        clear: input.clear !== false,
        pressEnter: input.pressEnter || false,
      });

      return {
        success: result.success,
        output: { selector: result.selector },
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
        error: result.error ? createError("BROWSER_TYPE_ERROR", result.error, true) : undefined,
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("BROWSER_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

const browserExtractSchema = z.object({
  type: z.enum(["text", "html", "table", "links", "value"]).describe("Type of data to extract"),
  target: z.string().optional().describe("CSS selector to extract from"),
  limit: z.number().int().positive().default(50).optional(),
});

const browserExtractTool: ToolDefinition = {
  name: "browser_extract",
  description: "Extract structured data from the current page (text, tables, links, HTML).",
  inputSchema: browserExtractSchema,
  capabilities: ["requires_network", "accesses_external_api"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const api = getBrowserApi(context.runId);
      const result = await api.execute({
        action: "browser.extract",
        type: input.type,
        target: input.target,
        limit: input.limit || 50,
      });

      return {
        success: result.success,
        output: result.data,
        artifacts: [],
        previews: [
          {
            type: "text",
            content: typeof result.data === "string"
              ? result.data.slice(0, 5000)
              : JSON.stringify(result.data, null, 2).slice(0, 5000),
            title: `Extracted ${input.type}`,
          },
        ],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
        error: result.error ? createError("BROWSER_EXTRACT_ERROR", result.error, true) : undefined,
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("BROWSER_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

const browserScreenshotSchema = z.object({
  scope: z.enum(["viewport", "element", "fullpage"]).default("viewport").optional(),
  target: z.string().optional().describe("CSS selector for element screenshot"),
});

const browserScreenshotTool: ToolDefinition = {
  name: "browser_screenshot",
  description: "Take a screenshot of the current page or a specific element.",
  inputSchema: browserScreenshotSchema,
  capabilities: ["requires_network", "accesses_external_api"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const api = getBrowserApi(context.runId);
      const result = await api.execute({
        action: "browser.screenshot",
        scope: input.scope || "viewport",
        target: input.target,
      });

      return {
        success: result.success,
        output: { captured: !!result.screenshot },
        artifacts: result.screenshot
          ? [createArtifact("image", "screenshot.png", result.screenshot, "image/png")]
          : [],
        previews: result.screenshot
          ? [{ type: "image", content: result.screenshot, title: "Screenshot" }]
          : [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
        error: result.error ? createError("BROWSER_SCREENSHOT_ERROR", result.error, false) : undefined,
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("BROWSER_ERROR", error.message, false),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

const browserAssertSchema = z.object({
  assertion: z.enum([
    "visible", "hidden", "text_contains", "text_equals",
    "url_matches", "title_contains", "element_count",
  ]).describe("Type of assertion"),
  target: z.string().optional().describe("CSS selector to check"),
  expected: z.union([z.string(), z.number()]).optional().describe("Expected value"),
});

const browserAssertTool: ToolDefinition = {
  name: "browser_assert",
  description: "Verify a condition in the browser (visible, text, URL, etc.). Returns pass/fail with evidence.",
  inputSchema: browserAssertSchema,
  capabilities: ["requires_network", "accesses_external_api"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const api = getBrowserApi(context.runId);
      const result = await api.execute({
        action: "browser.assert",
        assertion: input.assertion,
        target: input.target,
        expected: input.expected,
      });

      return {
        success: result.success,
        output: {
          assertion: input.assertion,
          passed: result.success,
          details: result.assertion,
        },
        artifacts: result.assertion?.evidence?.screenshot
          ? [createArtifact("image", "assertion-evidence.png", result.assertion.evidence.screenshot, "image/png")]
          : [],
        previews: [
          {
            type: "text",
            content: `${result.success ? "PASS" : "FAIL"}: ${result.assertion?.message || ""}`,
            title: `Assert: ${input.assertion}`,
          },
        ],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
        error: !result.success ? createError("ASSERTION_FAILED", result.assertion?.message || "Assertion failed", false) : undefined,
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("BROWSER_ERROR", error.message, false),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

/* ================================================================== */
/*  WEB RESEARCH TOOLS                                                */
/* ================================================================== */

const webResearchSchema = z.object({
  query: z.string().min(1).describe("Search query"),
  maxResults: z.number().int().min(1).max(20).default(5).optional(),
  academic: z.boolean().default(false).optional(),
  domainsAllowlist: z.array(z.string()).default([]).optional(),
});

const webResearchTool: ToolDefinition = {
  name: "web_research",
  description: "Search the web for information with citation tracking. Returns results + citations for attribution.",
  inputSchema: webResearchSchema,
  capabilities: ["requires_network", "accesses_external_api"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const result = await researchEngine.execute({
        tool: "search.query" as const,
        query: input.query,
        maxResults: input.maxResults || 5,
        academic: input.academic || false,
        locale: "es",
        recency: "any" as const,
        domainsAllowlist: input.domainsAllowlist || [],
        domainsDenylist: [],
      });

      return {
        success: result.success,
        output: {
          results: result.data,
          citations: result.citations,
          citationText: researchEngine.getFormattedCitations("inline"),
        },
        artifacts: [],
        previews: [
          {
            type: "text",
            content: Array.isArray(result.data)
              ? result.data.map((r: any, i: number) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n\n")
              : JSON.stringify(result.data, null, 2).slice(0, 5000),
            title: `Search: "${input.query}"`,
          },
        ],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
        error: result.error ? createError("SEARCH_ERROR", result.error, true) : undefined,
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("SEARCH_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

const webFetchSchema = z.object({
  url: z.string().url().describe("URL to fetch and extract content from"),
  maxLength: z.number().int().positive().default(10000).optional(),
});

const webFetchTool: ToolDefinition = {
  name: "web_fetch",
  description: "Fetch a URL and extract readable content with citations.",
  inputSchema: webFetchSchema,
  capabilities: ["requires_network", "accesses_external_api"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const result = await researchEngine.execute({
        tool: "web.fetch" as const,
        url: input.url,
        extractMode: "readability" as const,
        maxLength: input.maxLength || 10000,
        respectRobots: true,
      });

      return {
        success: result.success,
        output: result.data,
        artifacts: [],
        previews: [
          {
            type: "text",
            content: typeof (result.data as any)?.content === "string"
              ? (result.data as any).content.slice(0, 5000)
              : JSON.stringify(result.data, null, 2).slice(0, 5000),
            title: `Fetched: ${input.url}`,
          },
        ],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
        error: result.error ? createError("FETCH_ERROR", result.error, true) : undefined,
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("FETCH_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

/* ================================================================== */
/*  DOCUMENT GENERATION TOOLS                                         */
/* ================================================================== */

const generatePptxSchema = z.object({
  title: z.string().describe("Presentation title"),
  slides: z.array(z.object({
    type: z.enum(["cover", "content", "section_header", "table", "closing", "blank"]).default("content"),
    components: z.array(z.object({
      type: z.enum(["title", "subtitle", "body", "bullets", "table", "image", "footer"]),
      content: z.any(),
    })),
    notes: z.string().optional(),
  })).describe("Slide specifications"),
  author: z.string().optional(),
});

const generatePptxTool: ToolDefinition = {
  name: "generate_pptx",
  description: "Generate a professional PowerPoint presentation with anti-overflow layout and validation.",
  inputSchema: generatePptxSchema,
  capabilities: ["produces_artifacts", "writes_files"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      // Validate before generating
      const validation = pptxValidator.validateSpec({ slides: input.slides });
      if (!validation.valid) {
        return {
          success: false,
          output: { validation },
          error: createError(
            "PPTX_VALIDATION_ERROR",
            `Validation failed: ${validation.issues.filter(i => i.severity === "error").map(i => i.message).join("; ")}`,
            false
          ),
          artifacts: [],
          previews: [{ type: "text", content: JSON.stringify(validation.issues, null, 2), title: "Validation Issues" }],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      const spec = PresentationSpecSchema.parse({
        format: "pptx",
        title: input.title,
        author: input.author,
        slides: input.slides,
      });

      const buffer = await documentEngine.generatePresentation(spec);
      const base64 = buffer.toString("base64");

      return {
        success: true,
        output: { title: input.title, slideCount: input.slides.length, sizeBytes: buffer.length },
        artifacts: [createArtifact("document", `${input.title}.pptx`, base64, "application/vnd.openxmlformats-officedocument.presentationml.presentation")],
        previews: [{ type: "text", content: `Generated ${input.slides.length}-slide presentation: ${input.title}`, title: "PPTX Generated" }],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("PPTX_ERROR", error.message, false),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

const generateDocxSchema = z.object({
  title: z.string().describe("Document title"),
  sections: z.array(z.object({
    type: z.enum(["heading", "paragraph", "bullets", "numberedList", "table", "pageBreak", "quote", "code"]),
    level: z.number().int().min(1).max(6).optional(),
    content: z.any(),
  })).describe("Document sections"),
  author: z.string().optional(),
});

const generateDocxTool: ToolDefinition = {
  name: "generate_docx",
  description: "Generate a professional Word document with heading validation and table integrity checks.",
  inputSchema: generateDocxSchema,
  capabilities: ["produces_artifacts", "writes_files"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const validation = docxValidator.validateSpec({ sections: input.sections });
      if (!validation.valid) {
        return {
          success: false,
          output: { validation },
          error: createError(
            "DOCX_VALIDATION_ERROR",
            `Validation failed: ${validation.issues.filter(i => i.severity === "error").map(i => i.message).join("; ")}`,
            false
          ),
          artifacts: [],
          previews: [{ type: "text", content: JSON.stringify(validation.issues, null, 2), title: "Validation Issues" }],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      const spec = DocumentSpecSchema.parse({
        format: "docx",
        title: input.title,
        author: input.author,
        sections: input.sections,
      });

      const buffer = await documentEngine.generateDocument(spec);
      const base64 = buffer.toString("base64");

      return {
        success: true,
        output: { title: input.title, sectionCount: input.sections.length, sizeBytes: buffer.length },
        artifacts: [createArtifact("document", `${input.title}.docx`, base64, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")],
        previews: [{ type: "text", content: `Generated ${input.sections.length}-section document: ${input.title}`, title: "DOCX Generated" }],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("DOCX_ERROR", error.message, false),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

const generateXlsxSchema = z.object({
  title: z.string().describe("Workbook title"),
  sheets: z.array(z.object({
    name: z.string(),
    columns: z.array(z.object({
      key: z.string(),
      header: z.string(),
      type: z.enum(["string", "number", "date", "currency", "percentage"]).default("string").optional(),
      width: z.number().positive().optional(),
    })),
    rows: z.array(z.record(z.any())),
    formulas: z.array(z.object({ cell: z.string(), formula: z.string() })).default([]).optional(),
    filters: z.boolean().default(true).optional(),
  })).describe("Sheet specifications"),
  author: z.string().optional(),
});

const generateXlsxTool: ToolDefinition = {
  name: "generate_xlsx",
  description: "Generate a professional Excel workbook with data validation, formulas, and styling.",
  inputSchema: generateXlsxSchema,
  capabilities: ["produces_artifacts", "writes_files"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const validation = xlsxValidator.validateSpec({ sheets: input.sheets });
      if (!validation.valid) {
        return {
          success: false,
          output: { validation },
          error: createError(
            "XLSX_VALIDATION_ERROR",
            `Validation failed: ${validation.issues.filter(i => i.severity === "error").map(i => i.message).join("; ")}`,
            false
          ),
          artifacts: [],
          previews: [{ type: "text", content: JSON.stringify(validation.issues, null, 2), title: "Validation Issues" }],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      const spec = WorkbookSpecSchema.parse({
        format: "xlsx",
        title: input.title,
        author: input.author,
        sheets: input.sheets,
      });

      const buffer = await documentEngine.generateWorkbook(spec);
      const base64 = buffer.toString("base64");

      return {
        success: true,
        output: { title: input.title, sheetCount: input.sheets.length, sizeBytes: buffer.length },
        artifacts: [createArtifact("document", `${input.title}.xlsx`, base64, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")],
        previews: [{ type: "text", content: `Generated ${input.sheets.length}-sheet workbook: ${input.title}`, title: "XLSX Generated" }],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("XLSX_ERROR", error.message, false),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

/* ================================================================== */
/*  TERMINAL TOOL                                                     */
/* ================================================================== */

const terminalExecSchema = z.object({
  command: z.string().min(1).max(2000).describe("Command to execute"),
  cwd: z.string().optional().describe("Working directory"),
  timeout: z.number().int().positive().max(300000).default(60000).optional(),
});

const terminalExecTool: ToolDefinition = {
  name: "terminal_exec",
  description: "Execute a terminal command with RBAC policy enforcement and audit logging.",
  inputSchema: terminalExecSchema,
  capabilities: ["executes_code"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const role = context.userPlan === "admin" ? "admin" : "operator";

      const result = await terminalController.execute({
        tool: "terminal.exec",
        command: input.command,
        cwd: input.cwd,
        timeout: input.timeout || 60000,
        userId: context.userId,
        role,
        taskCorrelationId: context.runId,
        confirmed: context.isConfirmed || false,
      });

      if (result.requiresConfirmation) {
        return {
          success: false,
          output: { command: input.command, requiresConfirmation: true },
          error: createError("CONFIRMATION_REQUIRED", "This command requires human confirmation", false),
          artifacts: [],
          previews: [{ type: "text", content: `Command requires confirmation: ${input.command}`, title: "Confirmation Required" }],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      return {
        success: result.success,
        output: {
          command: result.command,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          truncated: result.truncated,
        },
        artifacts: [],
        previews: [
          {
            type: "text",
            content: (result.stdout || result.stderr || "").slice(0, 10000),
            title: result.success ? "Command Output" : "Error Output",
          },
        ],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
        error: result.error ? createError("TERMINAL_ERROR", result.error, true) : undefined,
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("TERMINAL_ERROR", error.message, false),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

/* ================================================================== */
/*  REGISTRATION                                                      */
/* ================================================================== */

export function registerAgenticTools(): void {
  const tools: ToolDefinition[] = [
    // Browser
    browserNavigateTool,
    browserClickTool,
    browserTypeTool,
    browserExtractTool,
    browserScreenshotTool,
    browserAssertTool,
    // Research
    webResearchTool,
    webFetchTool,
    // Documents
    generatePptxTool,
    generateDocxTool,
    generateXlsxTool,
    // Terminal
    terminalExecTool,
  ];

  for (const tool of tools) {
    try {
      toolRegistry.register(tool);
    } catch (err) {
      console.warn(`[AgenticTools] Failed to register ${tool.name}:`, err);
    }
  }

  console.log(`[AgenticTools] Registered ${tools.length} agentic tools`);
}

/**
 * Cleanup browser sessions for a completed run.
 */
export async function cleanupRunResources(runId: string): Promise<void> {
  const api = browserApiInstances.get(runId);
  if (api) {
    await api.cleanup();
    browserApiInstances.delete(runId);
  }
}
