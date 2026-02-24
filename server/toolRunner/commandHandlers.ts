import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  generateExcelDocument,
  generatePptDocument,
  generateWordDocument,
  normalizePptSlides,
  parseExcelFromText,
  parseSlidesFromText,
} from "../services/documentGeneration";
import { validateOpenXmlArtifact } from "./openXmlValidator";
import {
  ToolCommandName,
  ToolCommandResult,
  ToolRunnerInput,
  ToolRunnerIssue,
  ToolRunnerPreflightResult,
  ToolRunnerStructuredLog,
} from "./types";
import {
  TOOL_RUNNER_COMMAND_VERSION,
  getToolDefinition,
} from "./toolRegistry";

const DEFAULT_THEME_TOKENS = {
  colors: {
    primary: "1F4E79",
    secondary: "2B6CB0",
    accent: "38A3A5",
    text: "1A202C",
    background: "FFFFFF",
  },
  fonts: {
    heading: "Calibri",
    body: "Calibri",
    mono: "Consolas",
  },
  spacing: {
    sm: 4,
    md: 8,
    lg: 16,
  },
};

function makeIssue(
  code: string,
  message: string,
  severity: "error" | "warning",
  details?: Record<string, unknown>
): ToolRunnerIssue {
  return { code, message, severity, details };
}

function logLine(
  tool: ToolCommandName,
  level: "debug" | "info" | "warn" | "error",
  event: string,
  data?: Record<string, unknown>
): ToolRunnerStructuredLog {
  return {
    kind: "log",
    level,
    tool,
    event,
    ts: new Date().toISOString(),
    data,
  };
}

function inferContentFromData(data: Record<string, unknown>): string {
  const content = data.content;
  if (typeof content === "string" && content.trim().length > 0) {
    return content;
  }
  return JSON.stringify(data, null, 2);
}

function preflightForGeneration(input: ToolRunnerInput, tool: ToolCommandName): ToolRunnerPreflightResult {
  const issues: ToolRunnerIssue[] = [];

  if (!input.title || input.title.trim().length === 0) {
    issues.push(makeIssue("PREFLIGHT_TITLE_REQUIRED", "title is required", "error"));
  }

  if (!input.determinism?.inputHash || !input.determinism?.idempotencyKey) {
    issues.push(makeIssue("PREFLIGHT_DETERMINISM_REQUIRED", "determinism.inputHash and determinism.idempotencyKey are required", "error"));
  }

  if (input.assets !== undefined && !Array.isArray(input.assets)) {
    issues.push(makeIssue("PREFLIGHT_ASSETS_NOT_ARRAY", "assets must be an array", "error"));
  } else if (Array.isArray(input.assets)) {
    for (const [idx, asset] of input.assets.entries()) {
      const hasName = typeof asset.name === "string" && asset.name.trim().length > 0;
      const hasPath = typeof asset.path === "string" && asset.path.trim().length > 0;
      if (!hasName || !hasPath) {
        issues.push(
          makeIssue(
            "PREFLIGHT_ASSET_INVALID",
            `Asset at index ${idx} is missing required fields name/path`,
            "warning"
          )
        );
      }
    }
  }

  if (tool === "xlsxgen") {
    const headers = input.data.headers;
    const rows = input.data.rows;
    if (!(Array.isArray(headers) && Array.isArray(rows)) && typeof input.data.content !== "string") {
      issues.push(
        makeIssue(
          "PREFLIGHT_XLSX_PAYLOAD_INVALID",
          "xlsxgen requires headers+rows arrays or textual content.",
          "warning"
        )
      );
    }
  }

  if (tool === "pptxgen") {
    const slides = input.data.slides;
    if (!Array.isArray(slides) && typeof input.data.content !== "string") {
      issues.push(
        makeIssue(
          "PREFLIGHT_PPTX_PAYLOAD_INVALID",
          "pptxgen requires slides[] or textual content.",
          "warning"
        )
      );
    }
  }

  if (tool === "mso-validate") {
    const artifactPath = input.data.artifactPath;
    if (typeof artifactPath !== "string" || artifactPath.trim().length === 0) {
      issues.push(makeIssue("PREFLIGHT_ARTIFACT_REQUIRED", "artifactPath is required for mso-validate", "error"));
    }
  }

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}

function buildArtifactPath(outputDir: string, inputHash: string, ext: "docx" | "xlsx" | "pptx"): string {
  return path.join(outputDir, `${inputHash}.${ext}`);
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function hashBuffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function extractSpreadsheetData(input: ToolRunnerInput): unknown[][] {
  if (Array.isArray(input.data.headers) && Array.isArray(input.data.rows)) {
    return [input.data.headers as unknown[], ...(input.data.rows as unknown[][])];
  }

  return parseExcelFromText(inferContentFromData(input));
}

function extractSlides(input: ToolRunnerInput): { title: string; content: string[] }[] {
  if (Array.isArray(input.data.slides)) {
    return (input.data.slides as Array<{ title?: unknown; content?: unknown }>).map((slide, idx) => ({
      title: typeof slide.title === "string" && slide.title.trim().length > 0 ? slide.title : `Slide ${idx + 1}`,
      content: Array.isArray(slide.content)
        ? slide.content.map((item) => String(item))
        : [String(slide.content ?? "")],
    }));
  }

  const content = inferContentFromData(input);
  return parseSlidesFromText(content);
}

async function runDocgen(input: ToolRunnerInput, outputDir: string): Promise<ToolCommandResult> {
  const issues: ToolRunnerIssue[] = [];
  const preflight = preflightForGeneration(input, "docgen");
  issues.push(...preflight.issues);
  if (!preflight.ok) {
    return {
      success: false,
      tool: "docgen",
      version: TOOL_RUNNER_COMMAND_VERSION,
      issues,
    };
  }

  const content = inferContentFromData(input);
  const buffer = await generateWordDocument(input.title, content);
  const artifactPath = buildArtifactPath(outputDir, input.determinism.inputHash, "docx");
  await fs.writeFile(artifactPath, buffer);

  return {
    success: true,
    tool: "docgen",
    version: TOOL_RUNNER_COMMAND_VERSION,
    artifactPath,
    outputHash: hashBuffer(buffer),
    issues,
  };
}

async function runXlsxgen(input: ToolRunnerInput, outputDir: string): Promise<ToolCommandResult> {
  const issues: ToolRunnerIssue[] = [];
  const preflight = preflightForGeneration(input, "xlsxgen");
  issues.push(...preflight.issues);
  if (!preflight.ok) {
    return {
      success: false,
      tool: "xlsxgen",
      version: TOOL_RUNNER_COMMAND_VERSION,
      issues,
    };
  }

  const spreadsheetData = extractSpreadsheetData(input);
  const buffer = await generateExcelDocument(input.title, spreadsheetData as unknown[][]);
  const artifactPath = buildArtifactPath(outputDir, input.determinism.inputHash, "xlsx");
  await fs.writeFile(artifactPath, buffer);

  return {
    success: true,
    tool: "xlsxgen",
    version: TOOL_RUNNER_COMMAND_VERSION,
    artifactPath,
    outputHash: hashBuffer(buffer),
    issues,
  };
}

async function runPptxgen(input: ToolRunnerInput, outputDir: string): Promise<ToolCommandResult> {
  const issues: ToolRunnerIssue[] = [];
  const preflight = preflightForGeneration(input, "pptxgen");
  issues.push(...preflight.issues);
  if (!preflight.ok) {
    return {
      success: false,
      tool: "pptxgen",
      version: TOOL_RUNNER_COMMAND_VERSION,
      issues,
    };
  }

  const slides = extractSlides(input);
  const normalized = normalizePptSlides(input.title, slides);
  const buffer = await generatePptDocument(normalized.title, normalized.slides, {
    trace: {
      source: "tool-runner-cli",
      requestId: input.determinism.idempotencyKey,
    },
  });
  const artifactPath = buildArtifactPath(outputDir, input.determinism.inputHash, "pptx");
  await fs.writeFile(artifactPath, buffer);

  return {
    success: true,
    tool: "pptxgen",
    version: TOOL_RUNNER_COMMAND_VERSION,
    artifactPath,
    outputHash: hashBuffer(buffer),
    issues,
  };
}

async function runThemeApply(input: ToolRunnerInput, outputDir: string): Promise<ToolCommandResult> {
  const merged = {
    ...DEFAULT_THEME_TOKENS,
    ...(input.designTokens || {}),
    ...(input.theme?.tokens || {}),
    metadata: {
      ...(input.designTokens?.metadata || {}),
      ...(input.theme?.tokens?.metadata || {}),
      themeId: input.theme?.id || "default",
      themeName: input.theme?.name || "Default",
    },
  };

  const themePath = path.join(outputDir, `${input.determinism.inputHash}.theme.json`);
  await writeJson(themePath, merged);

  return {
    success: true,
    tool: "theme-apply",
    version: TOOL_RUNNER_COMMAND_VERSION,
    reportPath: themePath,
    issues: [],
  };
}

async function runRenderPreview(input: ToolRunnerInput, outputDir: string): Promise<ToolCommandResult> {
  const preview = {
    title: input.title,
    documentType: input.documentType,
    templateId: input.templateId || "custom",
    summary: {
      keys: Object.keys(input.data).slice(0, 25),
      contentLength: JSON.stringify(input.data).length,
    },
    determinism: input.determinism,
  };

  const previewPath = path.join(outputDir, `${input.determinism.inputHash}.preview.json`);
  await writeJson(previewPath, preview);

  return {
    success: true,
    tool: "render-preview",
    version: TOOL_RUNNER_COMMAND_VERSION,
    previewPath,
    issues: [],
  };
}

async function runMsoValidate(input: ToolRunnerInput, outputDir: string): Promise<ToolCommandResult> {
  const issues: ToolRunnerIssue[] = [];
  const preflight = preflightForGeneration(input, "mso-validate");
  issues.push(...preflight.issues);
  if (!preflight.ok) {
    return {
      success: false,
      tool: "mso-validate",
      version: TOOL_RUNNER_COMMAND_VERSION,
      issues,
    };
  }

  const artifactPath = String(input.data.artifactPath);
  const validation = await validateOpenXmlArtifact(artifactPath, input.documentType);
  const reportPath = path.join(outputDir, `${input.determinism.inputHash}.mso-validation.json`);

  await writeJson(reportPath, validation);

  return {
    success: validation.valid,
    tool: "mso-validate",
    version: TOOL_RUNNER_COMMAND_VERSION,
    artifactPath,
    reportPath,
    validation,
    issues: [...issues, ...validation.issues],
  };
}

export const COMMAND_HANDLERS: Record<
  ToolCommandName,
  (input: ToolRunnerInput, outputDir: string) => Promise<ToolCommandResult>
> = {
  docgen: runDocgen,
  xlsxgen: runXlsxgen,
  pptxgen: runPptxgen,
  "mso-validate": runMsoValidate,
  "theme-apply": runThemeApply,
  "render-preview": runRenderPreview,
};

export interface ExecuteCommandOptions {
  command: ToolCommandName;
  input: ToolRunnerInput;
  outputDir: string;
  pinnedVersion?: string;
  emit: (line: ToolRunnerStructuredLog) => void;
}

export async function executeCommand(options: ExecuteCommandOptions): Promise<ToolCommandResult> {
  const { command, input, outputDir, pinnedVersion, emit } = options;
  const definition = getToolDefinition(command);

  emit(logLine(command, "info", "start", { inputHash: input.determinism.inputHash }));

  if (!definition) {
    const issue = makeIssue("TOOL_UNKNOWN", `Unknown command: ${command}`, "error");
    emit(logLine(command, "error", "unknown_tool", { command }));
    return {
      success: false,
      tool: command,
      version: TOOL_RUNNER_COMMAND_VERSION,
      issues: [issue],
    };
  }

  if (pinnedVersion && pinnedVersion !== definition.version) {
    const issue = makeIssue(
      "TOOL_VERSION_MISMATCH",
      `Pinned version ${pinnedVersion} does not match ${definition.version}`,
      "error",
      { pinnedVersion, availableVersion: definition.version }
    );
    emit(logLine(command, "error", "version_mismatch", { pinnedVersion, availableVersion: definition.version }));
    return {
      success: false,
      tool: command,
      version: definition.version,
      issues: [issue],
    };
  }

  await fs.mkdir(outputDir, { recursive: true });

  const startedAt = Date.now();
  try {
    const result = await COMMAND_HANDLERS[command](input, outputDir);
    emit(
      logLine(command, result.success ? "info" : "warn", "completed", {
        success: result.success,
        durationMs: Date.now() - startedAt,
        artifactPath: result.artifactPath,
      })
    );
    return result;
  } catch (error) {
    const issue = makeIssue(
      "TOOL_RUNTIME_EXCEPTION",
      `Command ${command} failed: ${(error as Error).message}`,
      "error"
    );
    emit(logLine(command, "error", "exception", { error: (error as Error).message }));
    return {
      success: false,
      tool: command,
      version: definition.version,
      issues: [issue],
    };
  }
}
