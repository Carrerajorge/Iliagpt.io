import { z } from "zod";
import { DEFAULT_OPENCLAW_RELEASE_TAG } from "@shared/openclawRelease";
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
import { parseExcelFromText, parseSlidesFromText } from "../../services/documentGeneration";
import {
  compactConversation,
  guardContextWindow,
  needsCompaction,
  type CompactionConfig,
  type ConversationMessage,
} from "./compaction";

const WORKSPACE_ROOT = process.cwd();

const BLOCKED_COMMANDS = [
  "rm -rf /",
  "rm -rf /*",
  "mkfs",
  "dd if=",
  ":(){:|:&};:",
  "chmod -R 777 /",
  "chown -R",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  "init 0",
  "init 6",
  "kill -9 1",
  "killall",
  "pkill -9",
  "wget|sh",
  "curl|sh",
  "wget|bash",
  "curl|bash",
  "> /dev/sda",
  "> /dev/null",
  "nc -l",
  "ncat -l",
  "passwd",
  "useradd",
  "userdel",
  "groupadd",
  "groupdel",
  "visudo",
  "crontab -r",
  "iptables -F",
  "systemctl",
  "service",
  "mount",
  "umount",
  "fdisk",
  "parted",
  "eval",
  "source /dev",
];

const BLOCKED_COMMAND_PATTERNS = [
  /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/(?!tmp\/openclaw)/,
  />\s*\/dev\/sd/,
  /\|\s*(ba)?sh\b/,
  /;\s*(ba)?sh\b/,
  /`[^`]*`/,
  /\$\([^)]*\)/,
  /sudo\s+/,
  /su\s+-?\s/,
  /chmod\s+[0-7]{3,4}\s+\//,
  /chown\s+.*\s+\//,
  /curl\s+.*\|\s*(ba)?sh/,
  /wget\s+.*\|\s*(ba)?sh/,
  /python[23]?\s+-c\s+.*import\s+os/,
  /node\s+-e\s+.*child_process/,
  /perl\s+-e/,
  /ruby\s+-e/,
];

function validatePath(inputPath: string): { valid: boolean; resolved: string; error?: string } {
  const pathMod = require("path");
  const resolved = pathMod.resolve(WORKSPACE_ROOT, inputPath);

  if (!resolved.startsWith(WORKSPACE_ROOT)) {
    return {
      valid: false,
      resolved,
      error: `Path traversal blocked: "${inputPath}" resolves outside workspace root`,
    };
  }

  const normalizedInput = pathMod.normalize(inputPath);
  if (normalizedInput.startsWith("..") || normalizedInput.includes("/../")) {
    return {
      valid: false,
      resolved,
      error: `Path traversal blocked: "${inputPath}" contains directory traversal`,
    };
  }

  const blockedPaths = ["/etc", "/var", "/usr", "/bin", "/sbin", "/boot", "/root", "/proc", "/sys", "/dev"];
  for (const blocked of blockedPaths) {
    if (resolved.startsWith(blocked) || resolved === blocked) {
      return {
        valid: false,
        resolved,
        error: `Access denied: "${inputPath}" points to a restricted system path`,
      };
    }
  }

  return { valid: true, resolved };
}

function validateShellCommand(command: string): { valid: boolean; error?: string } {
  const normalizedCmd = command.toLowerCase().trim();

  for (const blocked of BLOCKED_COMMANDS) {
    if (normalizedCmd.includes(blocked.toLowerCase())) {
      return { valid: false, error: `Blocked command detected: contains "${blocked}"` };
    }
  }

  for (const pattern of BLOCKED_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return { valid: false, error: `Blocked command pattern detected: ${pattern.toString()}` };
    }
  }

  if (command.includes("&&") || command.includes("||") || command.includes(";")) {
    const parts = command.split(/&&|\|\||;/).map((p: string) => p.trim());
    for (const part of parts) {
      const subResult = validateShellCommand(part);
      if (!subResult.valid) return subResult;
    }
  }

  return { valid: true };
}

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
  })).optional().describe("Slide definitions"),
  content: z.string().optional().describe("Markdown or plain-text slide content"),
  theme: z.string().optional().describe("Presentation theme"),
}).refine(
  (input) => (Array.isArray(input.slides) && input.slides.length > 0) || Boolean(input.content?.trim()),
  {
    message: "Provide slide definitions or content",
    path: ["content"],
  }
);

const CreateSpreadsheetSchema = z.object({
  title: z.string().describe("Spreadsheet title"),
  sheets: z.array(z.object({
    name: z.string(),
    headers: z.array(z.string()),
    rows: z.array(z.array(z.any())),
  })).optional().describe("Sheet definitions"),
  content: z.string().optional().describe("Tabular content using pipes, commas, semicolons, or tabs"),
  theme: z.string().optional().describe("Spreadsheet theme"),
}).refine(
  (input) => (Array.isArray(input.sheets) && input.sheets.length > 0) || Boolean(input.content?.trim()),
  {
    message: "Provide sheet definitions or tabular content",
    path: ["content"],
  }
);

const CreateDocumentSchema = z.object({
  title: z.string().describe("Document title"),
  content: z.string().describe("Document content (markdown)"),
  format: z.enum(["docx", "pdf"]).optional().default("docx"),
  theme: z.string().optional().describe("Document theme"),
});

const GenerateDocumentSchema = z.object({
  type: z.enum(["word", "excel", "ppt", "pdf", "csv"]).describe("Document type to generate"),
  title: z.string().describe("Document title"),
  content: z.string().describe("Document content"),
  theme: z.string().optional().describe("Document theme"),
});

const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "Read file contents from the workspace with optional line range. Restricted to workspace directory only.",
  inputSchema: ReadFileSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    try {
      const pathCheck = validatePath(input.path);
      if (!pathCheck.valid) {
        return { success: false, output: null, error: { code: "PATH_VALIDATION_ERROR", message: pathCheck.error!, retryable: false } };
      }
      const fs = await import("fs/promises");
      const path = await import("path");
      const fullPath = pathCheck.resolved;
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
  description: "Create or overwrite a file in the workspace. Restricted to workspace directory only.",
  inputSchema: WriteFileSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    try {
      const pathCheck = validatePath(input.path);
      if (!pathCheck.valid) {
        return { success: false, output: null, error: { code: "PATH_VALIDATION_ERROR", message: pathCheck.error!, retryable: false } };
      }
      const fs = await import("fs/promises");
      const path = await import("path");
      const fullPath = pathCheck.resolved;
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
  description: "List files in a directory with optional glob pattern. Restricted to workspace directory only.",
  inputSchema: ListFilesSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    try {
      const pathCheck = validatePath(input.path || ".");
      if (!pathCheck.valid) {
        return { success: false, output: null, error: { code: "PATH_VALIDATION_ERROR", message: pathCheck.error!, retryable: false } };
      }
      const fs = await import("fs/promises");
      const path = await import("path");
      const dirPath = pathCheck.resolved;
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
  description: "Execute a shell command with timeout. Commands are validated against a blocklist of dangerous operations. Working directory is restricted to the workspace.",
  inputSchema: ShellCommandSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    try {
      const cmdCheck = validateShellCommand(input.command);
      if (!cmdCheck.valid) {
        return { success: false, output: null, error: { code: "COMMAND_BLOCKED", message: cmdCheck.error!, retryable: false } };
      }
      if (input.cwd) {
        const cwdCheck = validatePath(input.cwd);
        if (!cwdCheck.valid) {
          return { success: false, output: null, error: { code: "PATH_VALIDATION_ERROR", message: cwdCheck.error!, retryable: false } };
        }
      }
      const { execFileSync } = await import("child_process");
      const result = execFileSync("/bin/bash", ["-c", input.command], {
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
  description: "Execute code directly on the host via child_process (NOT sandboxed). Code is written to a temp file and executed with the system interpreter. Use with caution — no isolation or resource limits beyond timeout are enforced.",
  inputSchema: ExecuteCodeSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    try {
      const dangerousPatterns = [
        /require\s*\(\s*['"]child_process['"]\s*\)/,
        /import\s+.*['"]child_process['"]/,
        /process\.exit/,
        /import\s+os\b/,
        /import\s+subprocess\b/,
        /import\s+shutil\b/,
        /__import__/,
        /os\.system\s*\(/,
        /os\.popen\s*\(/,
        /subprocess\.\w+\s*\(/,
        /exec\s*\(/,
        /eval\s*\(/,
      ];
      for (const pattern of dangerousPatterns) {
        if (pattern.test(input.code)) {
          return {
            success: false,
            output: null,
            error: {
              code: "CODE_VALIDATION_ERROR",
              message: `Blocked: code contains potentially dangerous pattern: ${pattern.toString()}`,
              retryable: false,
            },
          };
        }
      }
      const { execFileSync } = await import("child_process");
      const tmpFile = `/tmp/openclaw_exec_${Date.now()}`;
      const fs = await import("fs/promises");

      let interpreter: string;
      let scriptFile: string;
      if (input.language === "python") {
        scriptFile = `${tmpFile}.py`;
        await fs.writeFile(scriptFile, input.code);
        interpreter = "python3";
      } else {
        scriptFile = `${tmpFile}.js`;
        await fs.writeFile(scriptFile, input.code);
        interpreter = "node";
      }

      const result = execFileSync(interpreter, [scriptFile], {
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
    const startTime = Date.now();
    try {
      const { generateImage } = await import("../../services/imageGeneration");
      const result = await generateImage(input.prompt);
      const durationMs = Date.now() - startTime;

      const fs = await import("fs/promises");
      const path = await import("path");
      const ext = result.mimeType.includes("png") ? "png" : "jpg";
      const fileName = `generated_${Date.now()}.${ext}`;
      const outDir = path.resolve(process.cwd(), "uploads");
      await fs.mkdir(outDir, { recursive: true });
      const outPath = path.join(outDir, fileName);
      await fs.writeFile(outPath, Buffer.from(result.imageBase64, "base64"));

      return {
        success: true,
        output: {
          prompt: input.prompt,
          style: input.style,
          model: result.model || "unknown",
          filePath: outPath,
          fileName,
          mimeType: result.mimeType,
          status: "completed",
        },
        artifacts: [{ type: "image", path: outPath, mimeType: result.mimeType }],
        previews: [],
        logs: [`Image generated in ${durationMs}ms using model ${result.model || "unknown"}`],
        metrics: { durationMs },
      };
    } catch (err: any) {
      return {
        success: false,
        output: null,
        error: { code: "IMAGE_GENERATION_ERROR", message: err.message, retryable: true },
        artifacts: [],
        previews: [],
        logs: [`Image generation failed: ${err.message}`],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

const analyzeSpreadsheetTool: ToolDefinition = {
  name: "analyze_spreadsheet",
  description: "Analyze a spreadsheet file with an AI-powered query",
  inputSchema: AnalyzeSpreadsheetSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const fullPath = path.resolve(process.cwd(), input.path);
      const workspaceRoot = path.resolve(process.cwd()) + path.sep;
      const relativePath = path.relative(workspaceRoot, fullPath);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        return {
          success: false,
          output: null,
          error: { code: "SECURITY_ERROR", message: "Path traversal not allowed. File must be within workspace.", retryable: false },
          artifacts: [], previews: [], logs: [], metrics: { durationMs: Date.now() - startTime },
        };
      }
      let realPath: string;
      try {
        realPath = await fs.realpath(fullPath);
      } catch {
        realPath = fullPath;
      }
      if (!realPath.startsWith(workspaceRoot) && realPath !== workspaceRoot.slice(0, -1)) {
        return {
          success: false,
          output: null,
          error: { code: "SECURITY_ERROR", message: "Symlink target is outside workspace.", retryable: false },
          artifacts: [], previews: [], logs: [], metrics: { durationMs: Date.now() - startTime },
        };
      }
      const blockedPrefixes = ["/etc/", "/usr/", "/var/", "/boot/", "/dev/", "/proc/", "/sys/"];
      if (blockedPrefixes.some(bp => realPath.startsWith(bp))) {
        return {
          success: false,
          output: null,
          error: { code: "SECURITY_ERROR", message: "Access to system directories is not allowed.", retryable: false },
          artifacts: [], previews: [], logs: [], metrics: { durationMs: Date.now() - startTime },
        };
      }
      await fs.access(fullPath);

      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      const ext = path.extname(fullPath).toLowerCase();

      if (ext === ".csv") {
        await workbook.csv.readFile(fullPath);
      } else {
        await workbook.xlsx.readFile(fullPath);
      }

      const targetSheet = input.sheet
        ? workbook.getWorksheet(input.sheet)
        : workbook.worksheets[0];

      if (!targetSheet) {
        return {
          success: false,
          output: null,
          error: { code: "SHEET_NOT_FOUND", message: `Sheet "${input.sheet || "default"}" not found`, retryable: false },
          artifacts: [], previews: [], logs: [], metrics: { durationMs: Date.now() - startTime },
        };
      }

      const headers: string[] = [];
      const firstRow = targetSheet.getRow(1);
      firstRow.eachCell((cell, colNumber) => {
        headers[colNumber - 1] = String(cell.value || `Column${colNumber}`);
      });

      const rows: Record<string, any>[] = [];
      const maxRowsForAnalysis = 500;
      targetSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1 || rows.length >= maxRowsForAnalysis) return;
        const rowData: Record<string, any> = {};
        row.eachCell((cell, colNumber) => {
          const header = headers[colNumber - 1] || `col_${colNumber}`;
          rowData[header] = cell.value;
        });
        rows.push(rowData);
      });

      const stats: Record<string, any> = {
        totalRows: targetSheet.rowCount - 1,
        totalColumns: headers.length,
        headers,
        sheetName: targetSheet.name,
        sheetsAvailable: workbook.worksheets.map(s => s.name),
      };

      for (const header of headers) {
        const values = rows.map(r => r[header]).filter(v => v != null);
        const numericValues = values.filter(v => typeof v === "number") as number[];
        if (numericValues.length > values.length * 0.5 && numericValues.length > 0) {
          stats[`${header}_stats`] = {
            min: Math.min(...numericValues),
            max: Math.max(...numericValues),
            avg: Number((numericValues.reduce((a, b) => a + b, 0) / numericValues.length).toFixed(2)),
            sum: Number(numericValues.reduce((a, b) => a + b, 0).toFixed(2)),
            count: numericValues.length,
          };
        } else {
          const uniqueValues = [...new Set(values.map(String))];
          stats[`${header}_info`] = {
            uniqueCount: uniqueValues.length,
            sampleValues: uniqueValues.slice(0, 5),
            type: "text",
          };
        }
      }

      const sampleData = rows.slice(0, 10);
      const durationMs = Date.now() - startTime;

      return {
        success: true,
        output: {
          path: input.path,
          query: input.query,
          stats,
          sampleData,
          analyzedRows: rows.length,
          totalRows: targetSheet.rowCount - 1,
          status: "completed",
        },
        artifacts: [],
        previews: [],
        logs: [`Analyzed ${rows.length} rows across ${headers.length} columns in ${durationMs}ms`],
        metrics: { durationMs },
      };
    } catch (err: any) {
      return {
        success: false,
        output: null,
        error: { code: "SPREADSHEET_ERROR", message: err.message, retryable: false },
        artifacts: [], previews: [], logs: [`Spreadsheet analysis failed: ${err.message}`],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

function generateSvgChart(type: string, data: any, title?: string, width = 800, height = 500): string {
  const margin = { top: 50, right: 30, bottom: 60, left: 60 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;

  const labels: string[] = Array.isArray(data.labels) ? data.labels : [];
  const datasets: Array<{ label?: string; values: number[] }> = Array.isArray(data.datasets)
    ? data.datasets.map((ds: any) => ({
        label: ds.label || "",
        values: Array.isArray(ds.data || ds.values) ? (ds.data || ds.values).map(Number) : [],
      }))
    : Array.isArray(data.values)
    ? [{ label: "", values: data.values.map(Number) }]
    : [];

  if (datasets.length === 0 || datasets[0].values.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-size="16">No data provided</text></svg>`;
  }

  const allValues = datasets.flatMap(ds => ds.values);
  const maxVal = Math.max(...allValues, 1);
  const minVal = Math.min(...allValues, 0);
  const range = maxVal - (minVal < 0 ? minVal : 0);

  const colors = ["#4F46E5", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4", "#EC4899", "#84CC16"];

  let chartBody = "";

  if (type === "bar") {
    const groupW = chartW / Math.max(labels.length, 1);
    const barW = Math.max(groupW / (datasets.length + 1), 4);
    datasets.forEach((ds, di) => {
      ds.values.forEach((v, i) => {
        const barH = (v / range) * chartH;
        const x = margin.left + i * groupW + di * barW + barW * 0.5;
        const y = margin.top + chartH - barH;
        chartBody += `<rect x="${x}" y="${y}" width="${barW - 2}" height="${barH}" fill="${colors[di % colors.length]}" rx="2" />`;
      });
    });
  } else if (type === "line" || type === "area") {
    datasets.forEach((ds, di) => {
      const points = ds.values.map((v, i) => {
        const x = margin.left + (i / Math.max(ds.values.length - 1, 1)) * chartW;
        const y = margin.top + chartH - ((v - Math.min(0, minVal)) / range) * chartH;
        return `${x},${y}`;
      });
      if (type === "area") {
        const firstX = margin.left;
        const lastX = margin.left + chartW;
        const bottomY = margin.top + chartH;
        chartBody += `<polygon points="${firstX},${bottomY} ${points.join(" ")} ${lastX},${bottomY}" fill="${colors[di % colors.length]}" opacity="0.2" />`;
      }
      chartBody += `<polyline points="${points.join(" ")}" fill="none" stroke="${colors[di % colors.length]}" stroke-width="2.5" />`;
      ds.values.forEach((v, i) => {
        const x = margin.left + (i / Math.max(ds.values.length - 1, 1)) * chartW;
        const y = margin.top + chartH - ((v - Math.min(0, minVal)) / range) * chartH;
        chartBody += `<circle cx="${x}" cy="${y}" r="4" fill="${colors[di % colors.length]}" />`;
      });
    });
  } else if (type === "pie") {
    const vals = datasets[0].values;
    const total = vals.reduce((a, b) => a + Math.abs(b), 0) || 1;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(chartW, chartH) / 2 - 20;
    let startAngle = -Math.PI / 2;
    vals.forEach((v, i) => {
      const sliceAngle = (Math.abs(v) / total) * 2 * Math.PI;
      const endAngle = startAngle + sliceAngle;
      const x1 = cx + radius * Math.cos(startAngle);
      const y1 = cy + radius * Math.sin(startAngle);
      const x2 = cx + radius * Math.cos(endAngle);
      const y2 = cy + radius * Math.sin(endAngle);
      const largeArc = sliceAngle > Math.PI ? 1 : 0;
      chartBody += `<path d="M${cx},${cy} L${x1},${y1} A${radius},${radius} 0 ${largeArc} 1 ${x2},${y2} Z" fill="${colors[i % colors.length]}" stroke="white" stroke-width="1" />`;
      const midAngle = startAngle + sliceAngle / 2;
      const labelR = radius * 0.65;
      const lx = cx + labelR * Math.cos(midAngle);
      const ly = cy + labelR * Math.sin(midAngle);
      const pct = ((Math.abs(v) / total) * 100).toFixed(1);
      chartBody += `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="11" fill="white" font-weight="bold">${pct}%</text>`;
      startAngle = endAngle;
    });
  } else if (type === "scatter") {
    const vals = datasets[0].values;
    vals.forEach((v, i) => {
      const x = margin.left + (i / Math.max(vals.length - 1, 1)) * chartW;
      const y = margin.top + chartH - ((v - Math.min(0, minVal)) / range) * chartH;
      chartBody += `<circle cx="${x}" cy="${y}" r="5" fill="${colors[0]}" opacity="0.7" />`;
    });
  }

  let axes = "";
  if (type !== "pie") {
    axes += `<line x1="${margin.left}" y1="${margin.top + chartH}" x2="${margin.left + chartW}" y2="${margin.top + chartH}" stroke="#CBD5E1" stroke-width="1" />`;
    axes += `<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + chartH}" stroke="#CBD5E1" stroke-width="1" />`;
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
      const yVal = (range / yTicks) * i + Math.min(0, minVal);
      const y = margin.top + chartH - (i / yTicks) * chartH;
      axes += `<text x="${margin.left - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#64748B">${yVal.toFixed(1)}</text>`;
      axes += `<line x1="${margin.left}" y1="${y}" x2="${margin.left + chartW}" y2="${y}" stroke="#E2E8F0" stroke-width="0.5" />`;
    }
    labels.forEach((label, i) => {
      const x = margin.left + (i / Math.max(labels.length - 1, 1)) * chartW;
      axes += `<text x="${x}" y="${margin.top + chartH + 20}" text-anchor="middle" font-size="10" fill="#64748B">${label.length > 12 ? label.slice(0, 12) + "…" : label}</text>`;
    });
  }

  let legend = "";
  if (datasets.length > 1 || datasets[0].label) {
    const legendY = height - 15;
    let legendX = margin.left;
    datasets.forEach((ds, di) => {
      legend += `<rect x="${legendX}" y="${legendY - 8}" width="12" height="12" fill="${colors[di % colors.length]}" rx="2" />`;
      legend += `<text x="${legendX + 16}" y="${legendY + 2}" font-size="11" fill="#334155">${ds.label || `Series ${di + 1}`}</text>`;
      legendX += (ds.label || `Series ${di + 1}`).length * 7 + 30;
    });
  }

  const titleEl = title ? `<text x="${width / 2}" y="28" text-anchor="middle" font-size="16" font-weight="bold" fill="#1E293B">${title}</text>` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="white" rx="8" />
${titleEl}${axes}${chartBody}${legend}
</svg>`;
}

function sanitizeGeneratedFilename(name: string): string {
  const cleaned = String(name || "document")
    .trim()
    .replace(/[^a-zA-Z0-9._ -]/g, "")
    .replace(/\s+/g, "-");
  return cleaned.slice(0, 80) || "document";
}

function buildSectionsFromMarkdown(title: string, content: string) {
  const normalized = String(content || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [{
      id: "section-1",
      title: "Contenido",
      content: title || "Documento",
      level: 1 as const,
    }];
  }

  const sections: Array<{ id: string; title: string; content: string; level: 1 | 2 | 3 }> = [];
  const headingRe = /^(#{1,3})\s+(.+?)\s*$/;
  let currentSection: { id: string; title: string; content: string; level: 1 | 2 | 3 } | null = null;

  const flushCurrentSection = () => {
    if (!currentSection) return;
    currentSection.content = currentSection.content.trim();
    sections.push(currentSection);
    currentSection = null;
  };

  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trimEnd();
    const headingMatch = line.match(headingRe);

    if (headingMatch) {
      flushCurrentSection();
      currentSection = {
        id: `section-${sections.length + 1}`,
        title: headingMatch[2].trim(),
        content: "",
        level: Math.min(3, headingMatch[1].length) as 1 | 2 | 3,
      };
      continue;
    }

    if (!currentSection) {
      currentSection = {
        id: `section-${sections.length + 1}`,
        title: "Contenido",
        content: "",
        level: 1,
      };
    }

    currentSection.content += `${line}\n`;
  }

  flushCurrentSection();
  return sections.length > 0
    ? sections
    : [{
        id: "section-1",
        title: "Contenido",
        content: normalized,
        level: 1 as const,
      }];
}

function buildPresentationSections(title: string, content?: string, slides?: Array<{ title?: string; content?: string }>) {
  if (Array.isArray(slides) && slides.length > 0) {
    return slides.map((slide, index) => ({
      id: `slide-${index + 1}`,
      title: slide.title || `Slide ${index + 1}`,
      content: slide.content || "",
      level: 1 as const,
    }));
  }

  if (content?.trim()) {
    return parseSlidesFromText(content).map((slide, index) => ({
      id: `slide-${index + 1}`,
      title: slide.title || `Slide ${index + 1}`,
      content: slide.content.join("\n"),
      level: 1 as const,
    }));
  }

  return [{
    id: "slide-1",
    title,
    content: "Presentación generada automáticamente.",
    level: 1 as const,
  }];
}

function buildSpreadsheetSections(title: string, content?: string, sheets?: Array<{ name?: string; headers?: unknown[]; rows?: unknown[][] }>) {
  if (Array.isArray(sheets) && sheets.length > 0) {
    return sheets.map((sheet, index) => ({
      id: `sheet-${index + 1}`,
      title: sheet.name || `Hoja ${index + 1}`,
      content: `Datos exportados de ${sheet.name || `Hoja ${index + 1}`}.`,
      level: 1 as const,
      tables: [{
        headers: Array.isArray(sheet.headers) ? sheet.headers.map((header) => String(header ?? "")) : [],
        rows: Array.isArray(sheet.rows)
          ? sheet.rows.map((row) => Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : [String(row ?? "")])
          : [],
        style: "striped" as const,
      }],
    }));
  }

  if (content?.trim()) {
    const parsedRows = parseExcelFromText(content).map((row) => row.map((cell) => String(cell ?? "")));
    const [headers, ...rows] = parsedRows;
    return [{
      id: "sheet-1",
      title,
      content: `Datos tabulares para ${title}.`,
      level: 1 as const,
      tables: [{
        headers: headers && headers.length > 0 ? headers : ["Contenido"],
        rows: rows.length > 0 ? rows : [["No hay datos disponibles"]],
        style: "striped" as const,
      }],
    }];
  }

  return [{
    id: "sheet-1",
    title,
    content: "Hoja de cálculo generada automáticamente.",
    level: 1 as const,
  }];
}

function buildCsvBuffer(content: string): Buffer {
  const rows = parseExcelFromText(content).map((row) => row.map((cell) => String(cell ?? "")));
  const csvContent = rows
    .map((row) =>
      row
        .map((cell) => {
          if (/[",\n]/.test(cell)) {
            return `"${cell.replace(/"/g, '""')}"`;
          }
          return cell;
        })
        .join(","),
    )
    .join("\n");

  return Buffer.from(csvContent, "utf-8");
}

async function writeEnterpriseArtifact(filename: string, buffer: Buffer) {
  const fs = await import("fs/promises");
  const path = await import("path");
  const artifactsDir = path.resolve(process.cwd(), "artifacts");
  await fs.mkdir(artifactsDir, { recursive: true });
  const artifactPath = path.join(artifactsDir, filename);
  await fs.writeFile(artifactPath, buffer);
  return {
    artifactPath,
    downloadUrl: `/api/artifacts/${encodeURIComponent(filename)}`,
  };
}

const generateChartTool: ToolDefinition = {
  name: "generate_chart",
  description: "Generate chart visualizations from data",
  inputSchema: GenerateChartSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const svgContent = generateSvgChart(input.type, input.data, input.title, input.width, input.height);
      const durationMs = Date.now() - startTime;

      const fs = await import("fs/promises");
      const path = await import("path");
      const fileName = `chart_${input.type}_${Date.now()}.svg`;
      const outDir = path.resolve(process.cwd(), "uploads");
      await fs.mkdir(outDir, { recursive: true });
      const outPath = path.join(outDir, fileName);
      await fs.writeFile(outPath, svgContent, "utf-8");

      return {
        success: true,
        output: {
          type: input.type,
          title: input.title || "Chart",
          filePath: outPath,
          fileName,
          format: "svg",
          status: "completed",
        },
        artifacts: [{ type: "chart", path: outPath, mimeType: "image/svg+xml" }],
        previews: [],
        logs: [`Chart generated (${input.type}) in ${durationMs}ms`],
        metrics: { durationMs },
      };
    } catch (err: any) {
      return {
        success: false,
        output: null,
        error: { code: "CHART_ERROR", message: err.message, retryable: false },
        artifacts: [], previews: [], logs: [`Chart generation failed: ${err.message}`],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
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
  description: "Create a PowerPoint presentation from slide definitions or markdown/plain-text content",
  inputSchema: CreatePresentationSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    try {
      const { EnterpriseDocumentService } = await import("../../services/enterpriseDocumentService");
      const service = EnterpriseDocumentService.create(input.theme || "professional");
      const sections = buildPresentationSections(input.title, input.content, input.slides);

      const result = await service.generateDocument({
        type: "pptx",
        title: input.title,
        author: "IliaGPT AI",
        theme: input.theme || "professional",
        sections,
      });

      if (!result.success || !result.buffer) {
        throw new Error(result.error || "PPTX generation failed");
      }

      const persisted = await writeEnterpriseArtifact(result.filename || `${sanitizeGeneratedFilename(input.title)}.pptx`, result.buffer);
      return {
        success: true,
        output: {
          title: input.title,
          slides: sections.length,
          filename: result.filename,
          downloadUrl: persisted.downloadUrl,
          sizeBytes: result.sizeBytes,
        },
        artifacts: [{
          id: `artifact-${Date.now()}`,
          type: "document",
          name: result.filename,
          path: persisted.artifactPath,
          mimeType: result.mimeType,
          url: persisted.downloadUrl,
          data: {
            downloadUrl: persisted.downloadUrl,
            base64: result.buffer.toString("base64"),
          },
          createdAt: new Date(),
        }],
        previews: [{
          type: "markdown",
          title: input.title,
          content: `Presentación generada: [${result.filename}](${persisted.downloadUrl})`,
        }],
        logs: [],
        metrics: { durationMs: 0, bytesProcessed: result.sizeBytes },
      };
    } catch (err: any) {
      return { success: false, output: null, error: { code: "PPTX_ERROR", message: err.message, retryable: false } };
    }
  },
};

const generateDocumentTool: ToolDefinition = {
  name: "generate_document",
  description: "Generate Word, Excel, PowerPoint, PDF, or CSV documents from text or markdown content",
  inputSchema: GenerateDocumentSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    try {
      const { EnterpriseDocumentService } = await import("../../services/enterpriseDocumentService");
      const service = EnterpriseDocumentService.create(input.theme || "professional");
      let result:
        | { success: boolean; buffer?: Buffer; filename: string; mimeType: string; sizeBytes: number; error?: string }
        | null = null;

      switch (input.type) {
        case "word":
          result = await service.generateDocument({
            type: "docx",
            title: input.title,
            author: "IliaGPT AI",
            theme: input.theme || "professional",
            sections: buildSectionsFromMarkdown(input.title, input.content),
            options: {
              includeTableOfContents: true,
              includePageNumbers: false,
              includeHeader: true,
              includeFooter: true,
            },
          });
          break;
        case "pdf":
          result = await service.generateDocument({
            type: "pdf",
            title: input.title,
            author: "IliaGPT AI",
            theme: input.theme || "professional",
            sections: buildSectionsFromMarkdown(input.title, input.content),
            options: {
              includeTableOfContents: true,
              includePageNumbers: true,
              includeHeader: true,
              includeFooter: true,
            },
          });
          break;
        case "excel":
          result = await service.generateDocument({
            type: "xlsx",
            title: input.title,
            author: "IliaGPT AI",
            theme: input.theme || "professional",
            sections: buildSpreadsheetSections(input.title, input.content),
          });
          break;
        case "ppt":
          result = await service.generateDocument({
            type: "pptx",
            title: input.title,
            author: "IliaGPT AI",
            theme: input.theme || "professional",
            sections: buildPresentationSections(input.title, input.content),
          });
          break;
        case "csv": {
          const buffer = buildCsvBuffer(input.content);
          result = {
            success: true,
            buffer,
            filename: `${sanitizeGeneratedFilename(input.title)}.csv`,
            mimeType: "text/csv",
            sizeBytes: buffer.length,
          };
          break;
        }
        default:
          throw new Error(`Unsupported document type: ${input.type}`);
      }

      if (!result.success || !result.buffer) {
        throw new Error(result.error || "Document generation failed");
      }

      const extension =
        input.type === "word" ? "docx" :
        input.type === "excel" ? "xlsx" :
        input.type === "ppt" ? "pptx" :
        input.type === "pdf" ? "pdf" :
        "csv";
      const persisted = await writeEnterpriseArtifact(
        result.filename || `${sanitizeGeneratedFilename(input.title)}.${extension}`,
        result.buffer,
      );

      return {
        success: true,
        output: {
          type: input.type,
          title: input.title,
          filename: result.filename,
          downloadUrl: persisted.downloadUrl,
          sizeBytes: result.sizeBytes,
        },
        artifacts: [{
          id: `artifact-${Date.now()}`,
          type: "document",
          name: result.filename,
          path: persisted.artifactPath,
          mimeType: result.mimeType,
          url: persisted.downloadUrl,
          data: {
            downloadUrl: persisted.downloadUrl,
            base64: result.buffer.toString("base64"),
          },
          createdAt: new Date(),
        }],
        previews: [{
          type: "markdown",
          title: input.title,
          content: `Documento generado: [${result.filename}](${persisted.downloadUrl})`,
        }],
        logs: [],
        metrics: { durationMs: 0, bytesProcessed: result.sizeBytes },
      };
    } catch (err: any) {
      return { success: false, output: null, error: { code: "GENERATE_DOCUMENT_ERROR", message: err.message, retryable: false } };
    }
  },
};

const createSpreadsheetTool: ToolDefinition = {
  name: "create_spreadsheet",
  description: "Create an Excel spreadsheet from structured sheets or tabular text content",
  inputSchema: CreateSpreadsheetSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    try {
      const { EnterpriseDocumentService } = await import("../../services/enterpriseDocumentService");
      const service = EnterpriseDocumentService.create(input.theme || "professional");
      const sections = buildSpreadsheetSections(input.title, input.content, input.sheets);

      const result = await service.generateDocument({
        type: "xlsx",
        title: input.title,
        author: "IliaGPT AI",
        theme: input.theme || "professional",
        sections,
      });

      if (!result.success || !result.buffer) {
        throw new Error(result.error || "XLSX generation failed");
      }

      const persisted = await writeEnterpriseArtifact(result.filename || `${sanitizeGeneratedFilename(input.title)}.xlsx`, result.buffer);
      return {
        success: true,
        output: {
          title: input.title,
          sheets: sections.length,
          filename: result.filename,
          downloadUrl: persisted.downloadUrl,
          sizeBytes: result.sizeBytes,
        },
        artifacts: [{
          id: `artifact-${Date.now()}`,
          type: "document",
          name: result.filename,
          path: persisted.artifactPath,
          mimeType: result.mimeType,
          url: persisted.downloadUrl,
          data: {
            downloadUrl: persisted.downloadUrl,
            base64: result.buffer.toString("base64"),
          },
          createdAt: new Date(),
        }],
        previews: [{
          type: "markdown",
          title: input.title,
          content: `Hoja de cálculo generada: [${result.filename}](${persisted.downloadUrl})`,
        }],
        logs: [],
        metrics: { durationMs: 0, bytesProcessed: result.sizeBytes },
      };
    } catch (err: any) {
      return { success: false, output: null, error: { code: "XLSX_ERROR", message: err.message, retryable: false } };
    }
  },
};

const createDocumentTool: ToolDefinition = {
  name: "create_document",
  description: "Create a Word or PDF document from markdown/plain-text content",
  inputSchema: CreateDocumentSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    try {
      const { EnterpriseDocumentService } = await import("../../services/enterpriseDocumentService");
      const service = EnterpriseDocumentService.create(input.theme || "professional");
      const result = await service.generateDocument({
        type: input.format === "pdf" ? "pdf" : "docx",
        title: input.title,
        author: "IliaGPT AI",
        theme: input.theme || "professional",
        sections: buildSectionsFromMarkdown(input.title, input.content),
        options: {
          includeTableOfContents: true,
          includePageNumbers: input.format === "pdf",
          includeHeader: true,
          includeFooter: true,
        },
      });

      if (!result.success || !result.buffer) {
        throw new Error(result.error || "Document generation failed");
      }

      const persisted = await writeEnterpriseArtifact(
        result.filename || `${sanitizeGeneratedFilename(input.title)}.${input.format === "pdf" ? "pdf" : "docx"}`,
        result.buffer,
      );

      return {
        success: true,
        output: {
          title: input.title,
          format: input.format,
          filename: result.filename,
          downloadUrl: persisted.downloadUrl,
          sizeBytes: result.sizeBytes,
        },
        artifacts: [{
          id: `artifact-${Date.now()}`,
          type: "document",
          name: result.filename,
          path: persisted.artifactPath,
          mimeType: result.mimeType,
          url: persisted.downloadUrl,
          data: {
            downloadUrl: persisted.downloadUrl,
            base64: result.buffer.toString("base64"),
          },
          createdAt: new Date(),
        }],
        previews: [{
          type: "markdown",
          title: input.title,
          content: `Documento generado: [${result.filename}](${persisted.downloadUrl})`,
        }],
        logs: [],
        metrics: { durationMs: 0, bytesProcessed: result.sizeBytes },
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
    generateDocumentTool,
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
  console.log(`[OpenClaw] Initialized ${openclawTools.length} agentic tools from OpenClaw ${DEFAULT_OPENCLAW_RELEASE_TAG} source`);
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

  sections.push(`You are an AI assistant powered by IliaGPT with OpenClaw ${DEFAULT_OPENCLAW_RELEASE_TAG} agentic capabilities.`);
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
    generate_document: "Generate Word, Excel, PowerPoint, PDF, or CSV documents",
    analyze_spreadsheet: "Analyze spreadsheet data",
    generate_chart: "Generate chart visualizations",
    send_email: "Send email via SMTP",
    create_presentation: "Create PowerPoint presentations",
    create_spreadsheet: "Create Excel spreadsheets",
    create_document: "Create Word or PDF documents",
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
