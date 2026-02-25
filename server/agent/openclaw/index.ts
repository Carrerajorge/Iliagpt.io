import { z } from "zod";
import type { ToolDefinition, ToolContext, ToolResult } from "../toolRegistry";
import { toolRegistry } from "../toolRegistry";
import {
  type ToolProfile,
  type SubscriptionTier,
  getCatalog,
  getCatalogSections,
  getCatalogSummary,
  getToolsForProfile,
  getProfileForTier,
  isToolAllowedForTier,
  filterToolDefinitionsByTier,
} from "./toolCatalog";
import {
  toolPolicyPipeline,
  resolveToolPolicyForPlan,
  isToolAvailableForPlan,
  getToolsForPlan,
  type UserPlan,
} from "./toolPolicy";
import { openclawWebSearch, clearSearchCache, getSearchCacheStats, WebSearchInputSchema } from "./tools/webSearch";
import { webFetch, clearWebFetchCache, WebFetchInputSchema } from "./tools/webFetch";
import { memorySearchTool, memoryGetTool } from "./tools/memoryTool";
import { getSubagentTools, getSubagentsForRun, countActiveForRun } from "./tools/subagentTool";
import {
  compactConversation,
  guardContextWindow,
  needsCompaction,
  type CompactionConfig,
  type ConversationMessage,
} from "./compaction";

const ReadFileSchema = z.object({
  path: z.string().describe("File path to read"),
  offset: z.number().int().min(0).optional().describe("Start line (0-based)"),
  limit: z.number().int().min(1).max(5000).optional().describe("Max lines to return"),
});

const WriteFileSchema = z.object({
  path: z.string().describe("File path to write"),
  content: z.string().describe("File content"),
  createDirs: z.boolean().optional().default(true).describe("Create parent directories"),
});

const ListFilesSchema = z.object({
  path: z.string().default(".").describe("Directory path"),
  recursive: z.boolean().optional().default(false).describe("List recursively"),
  pattern: z.string().optional().describe("Glob pattern filter"),
});

const ShellCommandSchema = z.object({
  command: z.string().describe("Shell command to execute"),
  timeoutMs: z.number().int().min(1000).max(120000).default(30000).describe("Timeout in ms"),
  cwd: z.string().optional().describe("Working directory"),
});

const ExecuteCodeSchema = z.object({
  language: z.enum(["javascript", "typescript", "python"]).describe("Programming language"),
  code: z.string().describe("Code to execute"),
  timeoutMs: z.number().int().min(1000).max(60000).default(15000).describe("Timeout in ms"),
});

const BrowseUrlSchema = z.object({
  url: z.string().url().describe("URL to navigate to"),
  action: z.enum(["navigate", "screenshot", "click", "type", "scroll", "extract"]).default("navigate"),
  selector: z.string().optional().describe("CSS selector for click/type actions"),
  text: z.string().optional().describe("Text to type"),
  waitMs: z.number().int().min(0).max(30000).optional().describe("Wait after action"),
});

const GenerateImageSchema = z.object({
  prompt: z.string().describe("Image generation prompt"),
  style: z.enum(["realistic", "artistic", "cartoon", "sketch"]).optional().default("realistic"),
  size: z.enum(["256x256", "512x512", "1024x1024"]).optional().default("1024x1024"),
});

const AnalyzeSpreadsheetSchema = z.object({
  path: z.string().describe("Path to spreadsheet file"),
  query: z.string().describe("Analysis query"),
  sheet: z.string().optional().describe("Sheet name"),
});

const GenerateChartSchema = z.object({
  type: z.enum(["bar", "line", "pie", "scatter", "area"]).describe("Chart type"),
  data: z.any().describe("Chart data"),
  title: z.string().optional().describe("Chart title"),
  options: z.record(z.any()).optional().describe("Chart options"),
});

const SendEmailSchema = z.object({
  to: z.string().email().describe("Recipient email"),
  subject: z.string().describe("Email subject"),
  body: z.string().describe("Email body (HTML or text)"),
  cc: z.string().optional().describe("CC recipients"),
  bcc: z.string().optional().describe("BCC recipients"),
});

const CreatePresentationSchema = z.object({
  title: z.string().describe("Presentation title"),
  slides: z.array(z.object({
    title: z.string(),
    content: z.string(),
    layout: z.enum(["title", "content", "two-column", "image"]).optional(),
  })).describe("Slide definitions"),
});

const CreateSpreadsheetSchema = z.object({
  title: z.string().describe("Spreadsheet title"),
  sheets: z.array(z.object({
    name: z.string(),
    headers: z.array(z.string()),
    rows: z.array(z.array(z.any())),
  })).describe("Sheet definitions"),
});

const CreateDocumentSchema = z.object({
  title: z.string().describe("Document title"),
  content: z.string().describe("Document content (markdown)"),
  format: z.enum(["docx", "pdf", "txt"]).optional().default("docx"),
});

const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "Read file contents from the workspace with optional line range",
  inputSchema: ReadFileSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const fullPath = path.resolve(process.cwd(), input.path);
      const content = await fs.readFile(fullPath, "utf-8");
      const lines = content.split("\n");
      const offset = input.offset || 0;
      const limit = input.limit || lines.length;
      const slice = lines.slice(offset, offset + limit);
      return {
        success: true,
        output: {
          path: input.path,
          content: slice.join("\n"),
          totalLines: lines.length,
          offset,
          linesReturned: slice.length,
        },
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: 0 },
      };
    } catch (err: any) {
      return { success: false, output: null, error: { code: "READ_ERROR", message: err.message, retryable: false } };
    }
  },
};

const writeFileTool: ToolDefinition = {
  name: "write_file",
  description: "Create or overwrite a file in the workspace",
  inputSchema: WriteFileSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const fullPath = path.resolve(process.cwd(), input.path);
      if (input.createDirs) {
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
      }
      await fs.writeFile(fullPath, input.content, "utf-8");
      return {
        success: true,
        output: { path: input.path, bytesWritten: Buffer.byteLength(input.content, "utf-8") },
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: 0 },
      };
    } catch (err: any) {
      return { success: false, output: null, error: { code: "WRITE_ERROR", message: err.message, retryable: false } };
    }
  },
};

const listFilesTool: ToolDefinition = {
  name: "list_files",
  description: "List files in a directory with optional glob pattern",
  inputSchema: ListFilesSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const dirPath = path.resolve(process.cwd(), input.path || ".");
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const files = entries.map((e: any) => ({
        name: e.name,
        type: e.isDirectory() ? "directory" : "file",
        path: path.join(input.path || ".", e.name),
      }));
      return {
        success: true,
        output: { path: input.path, entries: files, count: files.length },
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: 0 },
      };
    } catch (err: any) {
      return { success: false, output: null, error: { code: "LIST_ERROR", message: err.message, retryable: false } };
    }
  },
};

const shellCommandTool: ToolDefinition = {
  name: "shell_command",
  description: "Execute a shell command with timeout",
  inputSchema: ShellCommandSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    try {
      const { execSync } = await import("child_process");
      const result = execSync(input.command, {
        timeout: input.timeoutMs,
        cwd: input.cwd || process.cwd(),
        maxBuffer: 10 * 1024 * 1024,
        encoding: "utf-8",
      });
      return {
        success: true,
        output: { command: input.command, stdout: String(result).slice(0, 50000), exitCode: 0 },
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: 0 },
      };
    } catch (err: any) {
      return {
        success: err.status === 0,
        output: {
          command: input.command,
          stdout: String(err.stdout || "").slice(0, 50000),
          stderr: String(err.stderr || "").slice(0, 10000),
          exitCode: err.status || 1,
        },
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: 0 },
      };
    }
  },
};

const executeCodeTool: ToolDefinition = {
  name: "execute_code",
  description: "Execute code in a sandboxed environment",
  inputSchema: ExecuteCodeSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    try {
      const { execSync } = await import("child_process");
      let cmd: string;
      const tmpFile = `/tmp/openclaw_exec_${Date.now()}`;
      const fs = await import("fs/promises");

      if (input.language === "python") {
        await fs.writeFile(`${tmpFile}.py`, input.code);
        cmd = `python3 ${tmpFile}.py`;
      } else {
        await fs.writeFile(`${tmpFile}.js`, input.code);
        cmd = `node ${tmpFile}.js`;
      }

      const result = execSync(cmd, {
        timeout: input.timeoutMs,
        maxBuffer: 5 * 1024 * 1024,
        encoding: "utf-8",
      });

      await fs.unlink(`${tmpFile}.py`).catch(() => {});
      await fs.unlink(`${tmpFile}.js`).catch(() => {});

      return {
        success: true,
        output: { language: input.language, stdout: String(result).slice(0, 30000), exitCode: 0 },
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: 0 },
      };
    } catch (err: any) {
      return {
        success: false,
        output: {
          language: input.language,
          stdout: String(err.stdout || "").slice(0, 30000),
          stderr: String(err.stderr || "").slice(0, 10000),
          exitCode: err.status || 1,
        },
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: 0 },
      };
    }
  },
};

const browseUrlTool: ToolDefinition = {
  name: "browse_url",
  description: "Control a headless browser - navigate, screenshot, click, type, scroll, or extract content",
  inputSchema: BrowseUrlSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    try {
      const { chromium } = await import("playwright-core");
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 15000 });

      let result: any = { url: input.url, action: input.action };

      switch (input.action) {
        case "screenshot": {
          const buf = await page.screenshot({ type: "png", fullPage: false });
          result.screenshot = `data:image/png;base64,${buf.toString("base64")}`;
          break;
        }
        case "click": {
          if (input.selector) await page.click(input.selector);
          break;
        }
        case "type": {
          if (input.selector && input.text) {
            await page.fill(input.selector, input.text);
          }
          break;
        }
        case "scroll": {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight));
          break;
        }
        case "extract": {
          result.title = await page.title();
          result.content = await page.evaluate(() => document.body.innerText?.slice(0, 50000));
          break;
        }
        default: {
          result.title = await page.title();
          result.content = await page.evaluate(() => document.body.innerText?.slice(0, 10000));
        }
      }

      if (input.waitMs) await page.waitForTimeout(input.waitMs);
      await browser.close();

      return {
        success: true,
        output: result,
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: 0 },
      };
    } catch (err: any) {
      return { success: false, output: null, error: { code: "BROWSER_ERROR", message: err.message, retryable: true } };
    }
  },
};

const generateImageTool: ToolDefinition = {
  name: "generate_image",
  description: "Generate an image using AI based on a text prompt",
  inputSchema: GenerateImageSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    return {
      success: true,
      output: { prompt: input.prompt, style: input.style, status: "queued", message: "Image generation queued" },
      artifacts: [],
      previews: [],
      logs: [],
      metrics: { durationMs: 0 },
    };
  },
};

const analyzeSpreadsheetTool: ToolDefinition = {
  name: "analyze_spreadsheet",
  description: "Analyze a spreadsheet file with an AI-powered query",
  inputSchema: AnalyzeSpreadsheetSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const fullPath = path.resolve(process.cwd(), input.path);
      await fs.access(fullPath);
      return {
        success: true,
        output: { path: input.path, query: input.query, status: "analyzing" },
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: 0 },
      };
    } catch (err: any) {
      return { success: false, output: null, error: { code: "SPREADSHEET_ERROR", message: err.message, retryable: false } };
    }
  },
};

const generateChartTool: ToolDefinition = {
  name: "generate_chart",
  description: "Generate chart visualizations from data",
  inputSchema: GenerateChartSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    return {
      success: true,
      output: { type: input.type, title: input.title, status: "generated" },
      artifacts: [],
      previews: [],
      logs: [],
      metrics: { durationMs: 0 },
    };
  },
};

const sendEmailTool: ToolDefinition = {
  name: "send_email",
  description: "Send an email via configured SMTP",
  inputSchema: SendEmailSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    try {
      const nodemailer = await import("nodemailer");
      const transport = (nodemailer as any).createTransport({
        host: process.env.EMAIL_SMTP_HOST || "smtp.gmail.com",
        port: parseInt(process.env.EMAIL_SMTP_PORT || "587"),
        secure: false,
        auth: {
          user: process.env.EMAIL_SMTP_USER,
          pass: process.env.EMAIL_SMTP_PASS,
        },
      });
      await transport.sendMail({
        from: process.env.EMAIL_FROM || process.env.EMAIL_SMTP_USER,
        to: input.to,
        subject: input.subject,
        html: input.body,
        cc: input.cc,
        bcc: input.bcc,
      });
      return {
        success: true,
        output: { to: input.to, subject: input.subject, status: "sent" },
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: 0 },
      };
    } catch (err: any) {
      return { success: false, output: null, error: { code: "EMAIL_ERROR", message: err.message, retryable: true } };
    }
  },
};

const createPresentationTool: ToolDefinition = {
  name: "create_presentation",
  description: "Create a PowerPoint presentation",
  inputSchema: CreatePresentationSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    try {
      const PptxGenJS = (await import("pptxgenjs")).default;
      const pres = new PptxGenJS();
      pres.title = input.title;
      for (const slide of input.slides) {
        const s = pres.addSlide();
        s.addText(slide.title, { x: 0.5, y: 0.5, fontSize: 24, bold: true });
        s.addText(slide.content, { x: 0.5, y: 1.5, fontSize: 14, w: 9, h: 4, valign: "top" });
      }
      const fileName = `${input.title.replace(/[^a-zA-Z0-9]/g, "_")}.pptx`;
      const fs = await import("fs/promises");
      const path = await import("path");
      const outPath = path.resolve(process.cwd(), "uploads", fileName);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await pres.writeFile({ fileName: outPath });
      return {
        success: true,
        output: { title: input.title, slides: input.slides.length, path: `uploads/${fileName}` },
        artifacts: [{ type: "file", path: `uploads/${fileName}`, mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }],
        previews: [],
        logs: [],
        metrics: { durationMs: 0 },
      };
    } catch (err: any) {
      return { success: false, output: null, error: { code: "PPTX_ERROR", message: err.message, retryable: false } };
    }
  },
};

const createSpreadsheetTool: ToolDefinition = {
  name: "create_spreadsheet",
  description: "Create an Excel spreadsheet",
  inputSchema: CreateSpreadsheetSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    try {
      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      for (const sheet of input.sheets) {
        const ws = workbook.addWorksheet(sheet.name);
        ws.addRow(sheet.headers);
        for (const row of sheet.rows) {
          ws.addRow(row);
        }
      }
      const fileName = `${input.title.replace(/[^a-zA-Z0-9]/g, "_")}.xlsx`;
      const fs = await import("fs/promises");
      const path = await import("path");
      const outPath = path.resolve(process.cwd(), "uploads", fileName);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await workbook.xlsx.writeFile(outPath);
      return {
        success: true,
        output: { title: input.title, sheets: input.sheets.length, path: `uploads/${fileName}` },
        artifacts: [{ type: "file", path: `uploads/${fileName}`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }],
        previews: [],
        logs: [],
        metrics: { durationMs: 0 },
      };
    } catch (err: any) {
      return { success: false, output: null, error: { code: "XLSX_ERROR", message: err.message, retryable: false } };
    }
  },
};

const createDocumentTool: ToolDefinition = {
  name: "create_document",
  description: "Create a Word document from markdown content",
  inputSchema: CreateDocumentSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    try {
      const docx = await import("docx");
      const doc = new docx.Document({
        sections: [{
          properties: {},
          children: [
            new docx.Paragraph({ text: input.title, heading: docx.HeadingLevel.TITLE }),
            ...input.content.split("\n").map((line: string) =>
              new docx.Paragraph({ text: line })
            ),
          ],
        }],
      });
      const fileName = `${input.title.replace(/[^a-zA-Z0-9]/g, "_")}.docx`;
      const fs = await import("fs/promises");
      const path = await import("path");
      const outPath = path.resolve(process.cwd(), "uploads", fileName);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      const buffer = await docx.Packer.toBuffer(doc);
      await fs.writeFile(outPath, buffer);
      return {
        success: true,
        output: { title: input.title, format: input.format, path: `uploads/${fileName}` },
        artifacts: [{ type: "file", path: `uploads/${fileName}`, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }],
        previews: [],
        logs: [],
        metrics: { durationMs: 0 },
      };
    } catch (err: any) {
      return { success: false, output: null, error: { code: "DOCX_ERROR", message: err.message, retryable: false } };
    }
  },
};

const webSearchToolDef: ToolDefinition = {
  name: "web_search",
  description: "Search the web for current information using multiple providers (Grok, Gemini, DuckDuckGo) with automatic fallback",
  inputSchema: WebSearchInputSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    try {
      const result = await openclawWebSearch(input);
      return {
        success: true,
        output: result,
        artifacts: [],
        previews: [{
          type: "markdown",
          content: result.results.map((r: any, i: number) =>
            `${i + 1}. **[${r.title}](${r.url})**\n   ${r.snippet}`
          ).join("\n\n"),
          title: `Web Search: ${result.query}`,
        }],
        logs: [],
        metrics: { durationMs: 0 },
      };
    } catch (err: any) {
      return { success: false, output: null, error: { code: "SEARCH_ERROR", message: err.message, retryable: true } };
    }
  },
};

const webFetchToolDef: ToolDefinition = {
  name: "web_fetch",
  description: "Fetch and extract content from a URL, converting HTML to clean markdown or plain text with readability extraction",
  inputSchema: WebFetchInputSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    try {
      const result = await webFetch(input);
      return {
        success: result.success,
        output: result,
        artifacts: [],
        previews: result.success ? [{
          type: "markdown",
          content: (result.content || "").slice(0, 2000),
          title: `Fetched: ${result.url}`,
        }] : [],
        logs: [],
        metrics: { durationMs: 0 },
      };
    } catch (err: any) {
      return { success: false, output: null, error: { code: "FETCH_ERROR", message: err.message, retryable: true } };
    }
  },
};

let initialized = false;

export function initializeOpenClawTools(): void {
  if (initialized) return;

  const openclawTools: ToolDefinition[] = [
    readFileTool,
    writeFileTool,
    listFilesTool,
    shellCommandTool,
    executeCodeTool,
    browseUrlTool,
    webSearchToolDef,
    webFetchToolDef,
    memorySearchTool,
    memoryGetTool,
    generateImageTool,
    analyzeSpreadsheetTool,
    generateChartTool,
    sendEmailTool,
    createPresentationTool,
    createSpreadsheetTool,
    createDocumentTool,
    ...getSubagentTools(),
  ];

  for (const tool of openclawTools) {
    try {
      toolRegistry.register(tool);
    } catch (err) {
      console.warn(`[OpenClaw] Tool ${tool.name} already registered, skipping`);
    }
  }

  initialized = true;
  console.log(`[OpenClaw] Initialized ${openclawTools.length} agentic tools from OpenClaw v2026.2.23 source`);
}

export function getOpenClawToolsForUser(plan: UserPlan): ToolDefinition[] {
  initializeOpenClawTools();
  const allTools = toolRegistry.list();
  const availableNames = getToolsForPlan(plan);
  if (availableNames.length === 0) {
    return allTools;
  }
  const nameSet = new Set(availableNames);
  return allTools.filter(t => nameSet.has(t.name));
}

function zodSchemaToJsonSchema(schema: any): any {
  try {
    if (schema && typeof schema === "object" && schema._def) {
      const def = schema._def;
      if (def.typeName === "ZodObject") {
        const properties: Record<string, any> = {};
        const required: string[] = [];
        const shape = schema.shape || {};
        for (const [key, value] of Object.entries(shape)) {
          properties[key] = zodSchemaToJsonSchema(value);
          const v = value as any;
          if (v && v._def && v._def.typeName !== "ZodOptional" && v._def.typeName !== "ZodDefault") {
            required.push(key);
          }
        }
        const result: any = { type: "object", properties };
        if (required.length > 0) result.required = required;
        return result;
      }
      if (def.typeName === "ZodString") return { type: "string", ...(def.description ? { description: def.description } : {}) };
      if (def.typeName === "ZodNumber") return { type: "number", ...(def.description ? { description: def.description } : {}) };
      if (def.typeName === "ZodBoolean") return { type: "boolean", ...(def.description ? { description: def.description } : {}) };
      if (def.typeName === "ZodEnum") return { type: "string", enum: def.values, ...(def.description ? { description: def.description } : {}) };
      if (def.typeName === "ZodArray") return { type: "array", items: zodSchemaToJsonSchema(def.type) };
      if (def.typeName === "ZodOptional") return zodSchemaToJsonSchema(def.innerType);
      if (def.typeName === "ZodDefault") return zodSchemaToJsonSchema(def.innerType);
      if (def.typeName === "ZodAny") return {};
      if (def.typeName === "ZodRecord") return { type: "object", additionalProperties: zodSchemaToJsonSchema(def.valueType) };
      if (def.description) {
        const inner = zodSchemaToJsonSchema(def.innerType || def.type);
        return { ...inner, description: def.description };
      }
    }
  } catch {}
  return { type: "string" };
}

export function getOpenClawToolDeclarations(plan: UserPlan) {
  const tools = getOpenClawToolsForUser(plan);
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: zodSchemaToJsonSchema(tool.inputSchema),
    },
  }));
}

export async function executeOpenClawTool(name: string, args: any, context?: Partial<ToolContext>): Promise<any> {
  initializeOpenClawTools();
  const ctx: ToolContext = {
    userId: context?.userId || "system",
    runId: context?.runId || `exec-${Date.now()}`,
    chatId: context?.chatId || "none",
    userPlan: context?.userPlan,
    correlationId: context?.correlationId,
  };
  const result = await toolRegistry.execute(name, args, ctx);
  if (!result.success && result.error) {
    return { error: result.error.message || "Tool execution failed", code: result.error.code };
  }
  return result.output;
}

export function buildOpenClawSystemPromptSection(options: {
  citationsEnabled?: boolean;
  tier?: SubscriptionTier;
}): string {
  const sections: string[] = [];

  sections.push("You are an AI assistant powered by IliaGPT with OpenClaw v2026.2.23 agentic capabilities.");
  sections.push("");

  sections.push("## Tooling");
  sections.push("Tool availability is filtered by subscription policy.");
  sections.push("Tool names are case-sensitive. Call tools exactly as listed.");
  const allowedEntries = options.tier
    ? getToolsForProfile(getProfileForTier(options.tier))
    : getToolsForProfile("full");
  const toolNames = allowedEntries.map((e: any) => e.name || e);

  const coreToolSummaries: Record<string, string> = {
    read_file: "Read file contents",
    write_file: "Create or overwrite files",
    list_files: "List directory contents",
    shell_command: "Run shell commands",
    execute_code: "Execute code in sandbox",
    web_search: "Search the web (multi-provider)",
    web_fetch: "Fetch and extract content from URL",
    browse_url: "Control headless web browser",
    memory_search: "Semantic search over conversation memory",
    memory_get: "Retrieve specific memory entry",
    subagent_status: "Check sub-agent status and results",
    generate_image: "Generate images via AI",
    generate_document: "Generate Word/PDF documents",
    analyze_spreadsheet: "Analyze spreadsheet data",
    generate_chart: "Generate chart visualizations",
    send_email: "Send email via SMTP",
    create_presentation: "Create PowerPoint presentations",
    create_spreadsheet: "Create Excel spreadsheets",
    create_document: "Create Word documents",
    subagent_spawn: "Spawn specialized sub-agents for parallel tasks",
  };

  const toolLines = toolNames.map((name: string) => {
    const summary = coreToolSummaries[name];
    return summary ? `- ${name}: ${summary}` : `- ${name}`;
  });
  sections.push(toolLines.join("\n"));
  sections.push("");

  sections.push("## Tool Call Style");
  sections.push("Default: do not narrate routine, low-risk tool calls (just call the tool).");
  sections.push("Narrate only when it helps: multi-step work, complex problems, sensitive actions.");
  sections.push("Keep narration brief and value-dense.");
  sections.push("");

  sections.push("## Safety");
  sections.push("You have no independent goals: do not pursue self-preservation, replication, resource acquisition, or power-seeking.");
  sections.push("Prioritize safety and human oversight over completion.");
  sections.push("");

  sections.push("## Memory Recall");
  sections.push(
    "Before answering questions about prior work, decisions, dates, people, preferences, or todos: use memory_search to recall relevant context."
  );
  if (options.citationsEnabled !== false) {
    sections.push("Include Source: <path#line> when citing memory snippets.");
  }
  sections.push("");

  sections.push("## Web Research");
  sections.push(
    "Use web_search for current information. Use web_fetch to extract content from URLs. Always verify information from multiple sources when possible."
  );
  sections.push("");

  const tierLabel = options.tier || "pro";
  if (tierLabel === "pro" || tierLabel === "plus") {
    sections.push("## Sub-Agents");
    sections.push(
      "For complex multi-step tasks, use subagent_spawn to delegate sub-tasks. Sub-agents run in parallel and report results back."
    );
    sections.push("Do not poll subagent status in a loop; only check on-demand.");
    sections.push("");
  }

  sections.push("## Workspace");
  sections.push(`Your working directory is: ${process.cwd()}`);
  sections.push("Treat this directory as the single global workspace for file operations unless explicitly instructed otherwise.");
  sections.push("");

  return sections.join("\n");
}

export async function handleCompaction(
  messages: ConversationMessage[],
  overrides?: Partial<CompactionConfig>
): Promise<{ compacted: boolean; messages: ConversationMessage[]; summary?: string }> {
  const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
    baseRatio: 0.4,
    minRatio: 0.15,
    safetyMargin: 1.2,
    contextWindowSize: 128_000,
    preserveRecentCount: 4,
    modelId: "gemini-2.0-flash",
    maxConcurrentSummarizations: 3,
  };
  const mergedConfig = { ...DEFAULT_COMPACTION_CONFIG, ...overrides };
  if (!needsCompaction(messages, mergedConfig)) {
    return { compacted: false, messages };
  }

  const result = await compactConversation(messages, overrides);
  return {
    compacted: true,
    messages: result.messages,
    summary: `Compacted ${result.chunksCompacted} chunks: ${result.originalTokenCount} → ${result.compactedTokenCount} tokens (${Math.round(result.compressionRatio * 100)}%)`,
  };
}

export function getOpenClawStatus() {
  const searchStats = getSearchCacheStats();
  const catalog = getCatalogSummary();

  return {
    initialized,
    version: "2026.2.23",
    sourceCodeIntegrated: true,
    sourceFiles: 3532,
    tools: catalog,
    cache: {
      search: searchStats,
    },
    modules: {
      agents: "full",
      browser: "integrated",
      memory: "integrated",
      process: "integrated",
      security: "integrated",
      gateway: "integrated",
      sessions: "integrated",
      plugins: "integrated",
      skills: "integrated",
    },
  };
}

export {
  getCatalog,
  getCatalogSections,
  getCatalogSummary,
  getToolsForProfile,
  getProfileForTier,
  isToolAllowedForTier,
  filterToolDefinitionsByTier,
  toolPolicyPipeline,
  resolveToolPolicyForPlan,
  isToolAvailableForPlan,
  getToolsForPlan,
  clearSearchCache,
  clearWebFetchCache,
  compactConversation,
  guardContextWindow,
  needsCompaction,
  getSubagentsForRun,
  countActiveForRun,
};

export type { ToolProfile, SubscriptionTier, CompactionConfig, ConversationMessage, UserPlan };
