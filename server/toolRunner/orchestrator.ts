import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import {
  ToolCommandName,
  ToolExecutionTrace,
  ToolRunnerExecutionOutput,
  ToolRunnerIncident,
  ToolRunnerInput,
  ToolRunnerIssue,
  ToolRunnerReport,
  ToolRunnerStructuredLog,
  ToolRunnerValidationResult,
  ToolRunnerDocumentType,
} from "./types";
import {
  TOOL_RUNNER_COMMAND_VERSION,
  TOOL_RUNNER_PROTOCOL_VERSION,
} from "./toolRegistry";
import {
  TOOL_RUNNER_ERROR_CODES,
  buildToolRunnerErrorMessage,
  localizeToolRunnerError,
} from "./errorContract";
import {
  generateExcelDocument,
  generatePptDocument,
  generateWordDocument,
} from "../services/documentGeneration";
import { validateOpenXmlArtifact } from "./openXmlValidator";
import { createLogger } from "../lib/structuredLogger";

const logger = createLogger("document-cli-tool-runner");

const MIME_BY_TYPE: Record<ToolRunnerDocumentType, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

interface RunnerWorkspace {
  baseDir: string;
  inputDir: string;
  outputDir: string;
  reportDir: string;
}

interface CommandAttemptResult {
  trace: ToolExecutionTrace;
  result: {
    success: boolean;
    artifactPath?: string;
    reportPath?: string;
    validation?: ToolRunnerValidationResult;
    issues: ToolRunnerIssue[];
  };
}

interface CliProcessResult {
  exitCode: number | null;
  timedOut: boolean;
  stdoutLogs: ToolRunnerStructuredLog[];
  stderrLogs: ToolRunnerStructuredLog[];
  reportResult?: {
    success: boolean;
    artifactPath?: string;
    reportPath?: string;
    validation?: ToolRunnerValidationResult;
    issues: ToolRunnerIssue[];
  };
}

interface OrchestratorConfig {
  timeoutMs: number;
  maxRetries: number;
  memoryMb: number;
  cpuLimit: number;
  sandbox: "subprocess" | "docker";
  cacheDir: string;
  keepWorkspace: boolean;
}

export interface DocumentToolRunnerRequest {
  documentType: ToolRunnerDocumentType;
  title: string;
  templateId?: string;
  data: Record<string, unknown>;
  options?: Record<string, unknown>;
  locale?: string;
  designTokens?: ToolRunnerInput["designTokens"];
  theme?: ToolRunnerInput["theme"];
  assets?: ToolRunnerInput["assets"];
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  timeoutMs: Number(process.env.TOOL_RUNNER_TIMEOUT_MS || 90_000),
  maxRetries: Number(process.env.TOOL_RUNNER_MAX_RETRIES || 1),
  memoryMb: Number(process.env.TOOL_RUNNER_MEMORY_MB || 768),
  cpuLimit: Number(process.env.TOOL_RUNNER_CPU_LIMIT || 1),
  sandbox: process.env.TOOL_RUNNER_SANDBOX === "docker" ? "docker" : "subprocess",
  cacheDir: process.env.TOOL_RUNNER_CACHE_DIR || path.join(os.tmpdir(), "iliacodex", "tool-runner-cache", TOOL_RUNNER_COMMAND_VERSION),
  keepWorkspace: process.env.TOOL_RUNNER_KEEP_WORKSPACE === "true",
};

function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForHash(item));
  }
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = normalizeForHash((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function stableHash(value: unknown): string {
  const payload = JSON.stringify(normalizeForHash(value));
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export function buildToolRunnerRequestHash(request: DocumentToolRunnerRequest): string {
  return stableHash({
    documentType: request.documentType,
    title: request.title,
    templateId: request.templateId,
    data: request.data,
    options: request.options,
    designTokens: request.designTokens,
    theme: request.theme,
    assets: request.assets,
    version: TOOL_RUNNER_COMMAND_VERSION,
  });
}

function toStructuredLog(
  raw: string,
  tool: ToolCommandName,
  defaultLevel: "info" | "error"
): ToolRunnerStructuredLog {
  try {
    const parsed = JSON.parse(raw) as Partial<ToolRunnerStructuredLog>;
    if (parsed && typeof parsed === "object" && parsed.event && parsed.tool) {
      return {
        kind: parsed.kind || "log",
        level: parsed.level || (defaultLevel === "error" ? "error" : "info"),
        tool: parsed.tool as ToolCommandName,
        event: parsed.event,
        ts: parsed.ts || new Date().toISOString(),
        data: parsed.data,
      };
    }
  } catch {
    // ignore JSON parsing errors and emit raw lines below.
  }

  return {
    kind: defaultLevel === "error" ? "error" : "log",
    level: defaultLevel === "error" ? "error" : "info",
    tool,
    event: defaultLevel === "error" ? "stderr.raw" : "stdout.raw",
    ts: new Date().toISOString(),
    data: { line: raw.slice(0, 1500) },
  };
}

function parseOutput(raw: string, tool: ToolCommandName, defaultLevel: "info" | "error"): ToolRunnerStructuredLog[] {
  if (!raw.trim()) {
    return [];
  }

  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => toStructuredLog(line, tool, defaultLevel));
}

function mapDocTypeToCommand(documentType: ToolRunnerDocumentType): ToolCommandName {
  if (documentType === "docx") return "docgen";
  if (documentType === "xlsx") return "xlsxgen";
  return "pptxgen";
}

function buildFallbackPayload(documentType: ToolRunnerDocumentType, title: string): Record<string, unknown> {
  if (documentType === "docx") {
    return {
      content: `${title}\n\nSe aplicó recuperación automática para garantizar un archivo válido.`,
    };
  }

  if (documentType === "xlsx") {
    return {
      headers: ["Campo", "Valor"],
      rows: [
        ["Estado", "Fallback"],
        ["Documento", title],
      ],
    };
  }

  return {
    slides: [
      {
        title,
        content: [
          "Se aplicó recuperación automática para entregar una presentación válida.",
        ],
      },
    ],
  };
}

async function createWorkspace(): Promise<RunnerWorkspace> {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "iliacodex-tool-runner-"));
  const inputDir = path.join(baseDir, "inputs");
  const outputDir = path.join(baseDir, "outputs");
  const reportDir = path.join(baseDir, "reports");
  await fs.mkdir(inputDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(reportDir, { recursive: true });
  return { baseDir, inputDir, outputDir, reportDir };
}

function buildExecutionReport(params: {
  requestHash: string;
  documentType: ToolRunnerDocumentType;
  locale: ToolRunnerInput["locale"];
  sandbox: OrchestratorConfig["sandbox"];
  usedFallback: boolean;
  cacheHit: boolean;
  artifactPath: string;
  validation: ToolRunnerValidationResult;
  traces: ToolExecutionTrace[];
  incidents: ToolRunnerIncident[];
  startedAt: number;
  toolVersionPin?: string;
}): ToolRunnerReport {
  return {
    protocolVersion: TOOL_RUNNER_PROTOCOL_VERSION,
    locale: params.locale,
    requestHash: params.requestHash,
    documentType: params.documentType,
    toolVersionPin: params.toolVersionPin || TOOL_RUNNER_COMMAND_VERSION,
    sandbox: params.sandbox,
    usedFallback: params.usedFallback,
    cacheHit: params.cacheHit,
    artifactPath: params.artifactPath,
    validation: params.validation,
    traces: params.traces,
    incidents: params.incidents,
    metrics: {
      startedAt: new Date(params.startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - params.startedAt,
      retries: Math.max(params.traces.filter((trace) => trace.attempt > 1).length, 0),
    },
  };
}

function buildBaseInput(request: DocumentToolRunnerRequest, inputHash: string): ToolRunnerInput {
  return {
    protocolVersion: TOOL_RUNNER_PROTOCOL_VERSION,
    commandVersion: TOOL_RUNNER_COMMAND_VERSION,
    locale: request.locale || "es",
    documentType: request.documentType,
    title: request.title,
    templateId: request.templateId,
    data: request.data,
    options: request.options,
    designTokens: request.designTokens,
    theme: request.theme,
    assets: request.assets,
    determinism: {
      inputHash,
      idempotencyKey: inputHash,
    },
  };
}

function preflightRequest(input: ToolRunnerInput): ToolRunnerIssue[] {
  const issues: ToolRunnerIssue[] = [];

  if (!input.title || input.title.trim().length === 0) {
    issues.push({
      code: TOOL_RUNNER_ERROR_CODES.INVALID_INPUT,
      severity: "error",
      message: localizeToolRunnerError(TOOL_RUNNER_ERROR_CODES.INVALID_INPUT, input.locale, "Missing title."),
    });
  }

  if (!["docx", "xlsx", "pptx"].includes(input.documentType)) {
    issues.push({
      code: TOOL_RUNNER_ERROR_CODES.INVALID_INPUT,
      severity: "error",
      message: localizeToolRunnerError(TOOL_RUNNER_ERROR_CODES.INVALID_INPUT, input.locale, "Unsupported document type."),
    });
  }

  if (input.assets !== undefined && !Array.isArray(input.assets)) {
    issues.push({
      code: TOOL_RUNNER_ERROR_CODES.INVALID_INPUT,
      severity: "error",
      message: localizeToolRunnerError(
        TOOL_RUNNER_ERROR_CODES.INVALID_INPUT,
        input.locale,
        "Assets must be an array of {name, path} entries."
      ),
    });
  }

  return issues;
}

function createIncidentFromIssue(
  issue: ToolRunnerIssue,
  tool?: ToolCommandName,
  attempt?: number
): ToolRunnerIncident {
  return {
    code: issue.code,
    message: issue.message,
    severity: issue.severity,
    tool,
    attempt,
    details: issue.details,
  };
}

async function readReportResult(reportPath: string): Promise<CliProcessResult["reportResult"]> {
  try {
    const raw = await fs.readFile(reportPath, "utf8");
    const parsed = JSON.parse(raw) as CliProcessResult["reportResult"];
    return parsed;
  } catch {
    return undefined;
  }
}

function isRetryableIssue(issue: ToolRunnerIssue): boolean {
  return (
    issue.code === TOOL_RUNNER_ERROR_CODES.TOOL_TIMEOUT ||
    issue.code === TOOL_RUNNER_ERROR_CODES.TOOL_EXECUTION_FAILED
  );
}

function shouldRetry(result: CliProcessResult["reportResult"], timedOut: boolean): boolean {
  if (!result) return false;
  if (result.success) return false;
  const issues = result.issues || [];
  if (issues.length === 0 && timedOut) {
    return true;
  }
  return issues.some((issue) => isRetryableIssue(issue));
}

function retryDelayMs(attempt: number): number {
  return Math.min(1200, attempt * 150 + 10);
}

function hostPathToContainer(hostPath: string, hostRoot: string, containerRoot: string): string {
  const relative = path.relative(hostRoot, hostPath).split(path.sep).join(path.posix.sep);
  return path.posix.join(containerRoot, relative);
}

export class DocumentCliToolRunner {
  private readonly config: OrchestratorConfig;

  constructor(config?: Partial<OrchestratorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...(config || {}) };
  }

  private buildCliInvocation(
    workspace: RunnerWorkspace,
    command: ToolCommandName,
    inputPath: string,
    outputDir: string,
    reportPath: string
  ): { executable: string; args: string[]; env: Record<string, string> } {
    const repoRoot = process.cwd();

    if (this.config.sandbox === "docker") {
      const inputInContainer = hostPathToContainer(inputPath, workspace.baseDir, "/runner-work");
      const outputInContainer = hostPathToContainer(outputDir, workspace.baseDir, "/runner-work");
      const reportInContainer = hostPathToContainer(reportPath, workspace.baseDir, "/runner-work");

      return {
        executable: "docker",
        args: [
          "run",
          "--rm",
          "--network",
          "none",
          "--cpus",
          String(this.config.cpuLimit),
          "--memory",
          `${this.config.memoryMb}m`,
          "-v",
          `${repoRoot}:/workspace`,
          "-v",
          `${workspace.baseDir}:/runner-work`,
          "-w",
          "/workspace",
          "node:20-bookworm",
          "node",
          "--import",
          "tsx",
          "/workspace/server/toolRunner/cli.ts",
          command,
          "--input",
          inputInContainer,
          "--output-dir",
          outputInContainer,
          "--report",
          reportInContainer,
          "--tool-version",
          TOOL_RUNNER_COMMAND_VERSION,
        ],
        env: {
          ...process.env,
          NODE_OPTIONS: `--max-old-space-size=${this.config.memoryMb}`,
          TZ: "UTC",
        } as Record<string, string>,
      };
    }

    return {
      executable: process.execPath,
      args: [
        "--import",
        "tsx",
        path.join(repoRoot, "server", "toolRunner", "cli.ts"),
        command,
        "--input",
        inputPath,
        "--output-dir",
        outputDir,
        "--report",
        reportPath,
        "--tool-version",
        TOOL_RUNNER_COMMAND_VERSION,
      ],
      env: {
        ...process.env,
        NODE_OPTIONS: `--max-old-space-size=${this.config.memoryMb}`,
        TZ: "UTC",
      } as Record<string, string>,
    };
  }

  private async executeCli(
    workspace: RunnerWorkspace,
    command: ToolCommandName,
    inputPath: string,
    outputDir: string,
    reportPath: string
  ): Promise<CliProcessResult> {
    const invocation = this.buildCliInvocation(workspace, command, inputPath, outputDir, reportPath);

    return new Promise<CliProcessResult>((resolve) => {
      const child = spawn(invocation.executable, invocation.args, {
        cwd: process.cwd(),
        env: invocation.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      const outputLimit = 2 * 1024 * 1024;
      let stdoutRaw = "";
      let stderrRaw = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, this.config.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        if (stdoutRaw.length < outputLimit) {
          stdoutRaw += chunk.toString("utf8").slice(0, outputLimit - stdoutRaw.length);
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        if (stderrRaw.length < outputLimit) {
          stderrRaw += chunk.toString("utf8").slice(0, outputLimit - stderrRaw.length);
        }
      });

      child.on("close", async (exitCode) => {
        clearTimeout(timer);
        const reportResult = await readReportResult(reportPath);
        resolve({
          exitCode,
          timedOut,
          stdoutLogs: parseOutput(stdoutRaw, command, "info"),
          stderrLogs: parseOutput(stderrRaw, command, "error"),
          reportResult,
        });
      });

      child.on("error", async (error) => {
        clearTimeout(timer);
        const reportResult = await readReportResult(reportPath);
        resolve({
          exitCode: 1,
          timedOut,
          stdoutLogs: parseOutput(stdoutRaw, command, "info"),
          stderrLogs: [
            ...parseOutput(stderrRaw, command, "error"),
            {
              kind: "error",
              level: "error",
              tool: command,
              event: "spawn.error",
              ts: new Date().toISOString(),
              data: { message: error.message },
            },
          ],
          reportResult,
        });
      });
    });
  }

  private async runCommandWithRetry(
    workspace: RunnerWorkspace,
    command: ToolCommandName,
    input: ToolRunnerInput,
    traces: ToolExecutionTrace[],
    incidents: ToolRunnerIncident[]
  ): Promise<CommandAttemptResult> {
    let lastAttempt: CommandAttemptResult | null = null;

    for (let attempt = 1; attempt <= this.config.maxRetries + 1; attempt += 1) {
      const inputPath = path.join(workspace.inputDir, `${command}.${attempt}.json`);
      const reportPath = path.join(workspace.reportDir, `${command}.${attempt}.json`);
      await fs.writeFile(inputPath, JSON.stringify(input, null, 2), "utf8");

      const startedAt = Date.now();
      const execResult = await this.executeCli(workspace, command, inputPath, workspace.outputDir, reportPath);

      const trace: ToolExecutionTrace = {
        tool: command,
        version: TOOL_RUNNER_COMMAND_VERSION,
        attempt,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        exitCode: execResult.exitCode,
        timedOut: execResult.timedOut,
        stdout: execResult.stdoutLogs,
        stderr: execResult.stderrLogs,
      };
      traces.push(trace);

      const result = execResult.reportResult || {
        success: false,
        issues: [
          {
            code: execResult.timedOut ? TOOL_RUNNER_ERROR_CODES.TOOL_TIMEOUT : TOOL_RUNNER_ERROR_CODES.TOOL_EXECUTION_FAILED,
            severity: "error" as const,
            message: execResult.timedOut
              ? buildToolRunnerErrorMessage({ code: TOOL_RUNNER_ERROR_CODES.TOOL_TIMEOUT, locale: input.locale })
              : buildToolRunnerErrorMessage({ code: TOOL_RUNNER_ERROR_CODES.TOOL_EXECUTION_FAILED, locale: input.locale }),
          },
        ],
      };

      if (!result.success) {
        for (const issue of result.issues || []) {
          incidents.push(createIncidentFromIssue(issue, command, attempt));
        }
      }

      const attemptResult: CommandAttemptResult = {
        trace,
        result,
      };

      lastAttempt = attemptResult;
      if (result.success) {
        return attemptResult;
      }

      if (shouldRetry(result, execResult.timedOut) && attempt < this.config.maxRetries + 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
        continue;
      }

      return attemptResult;
    }

    return lastAttempt || {
      trace: {
        tool: command,
        version: TOOL_RUNNER_COMMAND_VERSION,
        attempt: this.config.maxRetries + 1,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: 0,
        exitCode: 1,
        timedOut: false,
        stdout: [],
        stderr: [],
      },
      result: {
        success: false,
        issues: [
          {
            code: TOOL_RUNNER_ERROR_CODES.TOOL_EXECUTION_FAILED,
            severity: "error",
            message: buildToolRunnerErrorMessage({
              code: TOOL_RUNNER_ERROR_CODES.TOOL_EXECUTION_FAILED,
              locale: input.locale,
            }),
          },
        ],
      },
    };
  }

  private async createLastResortArtifact(
    request: DocumentToolRunnerRequest,
    workspace: RunnerWorkspace,
    inputHash: string
  ): Promise<string> {
    const fallbackData = buildFallbackPayload(request.documentType, request.title);
    const artifactPath = path.join(workspace.outputDir, `${inputHash}.last-resort.${request.documentType}`);

    if (request.documentType === "docx") {
      const buffer = await generateWordDocument(request.title, String(fallbackData.content));
      await fs.writeFile(artifactPath, buffer);
      return artifactPath;
    }

    if (request.documentType === "xlsx") {
      const rows = [fallbackData.headers as unknown[], ...(fallbackData.rows as unknown[][])];
      const buffer = await generateExcelDocument(request.title, rows);
      await fs.writeFile(artifactPath, buffer);
      return artifactPath;
    }

    const slides = fallbackData.slides as Array<{ title: string; content: string[] }>;
    const buffer = await generatePptDocument(request.title, slides, {
      trace: {
        source: "tool-runner-last-resort",
      },
    });
    await fs.writeFile(artifactPath, buffer);
    return artifactPath;
  }

  public async generate(request: DocumentToolRunnerRequest): Promise<ToolRunnerExecutionOutput> {
    const startedAt = Date.now();
    const requestHash = buildToolRunnerRequestHash(request);

    await fs.mkdir(this.config.cacheDir, { recursive: true });

    const cachedArtifactPath = path.join(this.config.cacheDir, `${requestHash}.${request.documentType}`);
    const cachedReportPath = path.join(this.config.cacheDir, `${requestHash}.report.json`);

    try {
      await fs.access(cachedArtifactPath);
      await fs.access(cachedReportPath);
      const cachedRaw = await fs.readFile(cachedReportPath, "utf8");
      const cachedReport = JSON.parse(cachedRaw) as ToolRunnerReport;
      cachedReport.cacheHit = true;
      logger.info("Tool runner cache hit", { requestHash, documentType: request.documentType });
      return {
        artifactPath: cachedArtifactPath,
        reportPath: cachedReportPath,
        mimeType: MIME_BY_TYPE[request.documentType],
        report: cachedReport,
      };
    } catch {
      // cache miss - continue.
    }

    const workspace = await createWorkspace();
    const traces: ToolExecutionTrace[] = [];
    const incidents: ToolRunnerIncident[] = [];
    let usedFallback = false;
    let baseInput: ToolRunnerInput;

    try {
      baseInput = buildBaseInput(request, requestHash);
      const preflightIssues = preflightRequest(baseInput);
      incidents.push(...preflightIssues.map((issue) => createIncidentFromIssue(issue)));
      if (preflightIssues.some((issue) => issue.severity === "error")) {
        throw new Error(buildToolRunnerErrorMessage({ code: TOOL_RUNNER_ERROR_CODES.PRECHECK_FAILED, locale: baseInput.locale }));
      }

      const themeAttempt = await this.runCommandWithRetry(workspace, "theme-apply", baseInput, traces, incidents);
      if (!themeAttempt.result.success) {
        usedFallback = true;
        incidents.push({
          code: TOOL_RUNNER_ERROR_CODES.TOOL_EXECUTION_FAILED,
          message: buildToolRunnerErrorMessage({
            code: TOOL_RUNNER_ERROR_CODES.TOOL_EXECUTION_FAILED,
            locale: baseInput.locale,
            details: "Theme normalization did not complete successfully. Continuing with fallback data.",
          }),
          severity: "warning",
          tool: "theme-apply",
        });
      }

      const generationCommand = mapDocTypeToCommand(request.documentType);
      let generationInput: ToolRunnerInput = {
        ...baseInput,
        data: request.data,
      };

      let generationAttempt = await this.runCommandWithRetry(
        workspace,
        generationCommand,
        generationInput,
        traces,
        incidents
      );

      if (!generationAttempt.result.success || !generationAttempt.result.artifactPath) {
        usedFallback = true;
        incidents.push({
          code: TOOL_RUNNER_ERROR_CODES.TOOL_EXECUTION_FAILED,
          message: buildToolRunnerErrorMessage({
            code: TOOL_RUNNER_ERROR_CODES.TOOL_EXECUTION_FAILED,
            locale: baseInput.locale,
            details: "Primary generation failed. Fallback activated.",
          }),
          severity: "warning",
          tool: generationCommand,
        });

        generationInput = {
          ...baseInput,
          data: buildFallbackPayload(request.documentType, request.title),
        };

        generationAttempt = await this.runCommandWithRetry(
          workspace,
          generationCommand,
          generationInput,
          traces,
          incidents
        );
      }

      let artifactPath = generationAttempt.result.artifactPath;

      if (!artifactPath) {
        usedFallback = true;
        incidents.push({
          code: TOOL_RUNNER_ERROR_CODES.FALLBACK_FAILED,
          message: buildToolRunnerErrorMessage({
            code: TOOL_RUNNER_ERROR_CODES.FALLBACK_FAILED,
            locale: baseInput.locale,
            details: "CLI fallback did not return an artifact. Using last resort artifact builder.",
          }),
          severity: "warning",
          tool: generationCommand,
        });
        artifactPath = await this.createLastResortArtifact(request, workspace, requestHash);
      }

      let validationAttempt = await this.runCommandWithRetry(
        workspace,
        "mso-validate",
        {
          ...baseInput,
          data: {
            artifactPath,
          },
        },
        traces,
        incidents
      );

      if (!validationAttempt.result.success || !validationAttempt.result.validation?.valid) {
        usedFallback = true;
        incidents.push({
          code: TOOL_RUNNER_ERROR_CODES.OPENXML_INVALID,
          message: buildToolRunnerErrorMessage({
            code: TOOL_RUNNER_ERROR_CODES.OPENXML_INVALID,
            locale: baseInput.locale,
            details: "Generated artifact failed validation. Regenerating with fallback payload.",
          }),
          severity: "warning",
          tool: "mso-validate",
        });

        const fallbackGeneration = await this.runCommandWithRetry(
          workspace,
          generationCommand,
          {
            ...baseInput,
            data: buildFallbackPayload(request.documentType, request.title),
          },
          traces,
          incidents
        );

        if (fallbackGeneration.result.artifactPath) {
          artifactPath = fallbackGeneration.result.artifactPath;
        } else {
          artifactPath = await this.createLastResortArtifact(request, workspace, requestHash);
        }

        validationAttempt = await this.runCommandWithRetry(
          workspace,
          "mso-validate",
          {
            ...baseInput,
            data: {
              artifactPath,
            },
          },
          traces,
          incidents
        );

        if (!validationAttempt.result.validation?.valid) {
          const lastResortPath = await this.createLastResortArtifact(request, workspace, requestHash);
          artifactPath = lastResortPath;
          const lastResortValidation = await validateOpenXmlArtifact(lastResortPath, request.documentType);
          validationAttempt.result.validation = lastResortValidation;
          validationAttempt.result.success = lastResortValidation.valid;
        }
      }

      if (!validationAttempt.result.validation?.valid) {
        throw new Error(
          buildToolRunnerErrorMessage({
            code: TOOL_RUNNER_ERROR_CODES.FALLBACK_FAILED,
            locale: baseInput.locale,
            details: "Validation could not be recovered.",
          })
        );
      }

      await this.runCommandWithRetry(
        workspace,
        "render-preview",
        {
          ...baseInput,
          data: {
            ...baseInput.data,
            artifactPath,
          },
        },
        traces,
        incidents
      );

      const report = buildExecutionReport({
        requestHash,
        documentType: request.documentType,
        locale: baseInput.locale,
        sandbox: this.config.sandbox,
        usedFallback,
        cacheHit: false,
        artifactPath,
        validation: validationAttempt.result.validation ?? {
          valid: false,
          checks: {
            relationships: false,
            styles: false,
            fonts: false,
            images: false,
            schema: false,
          },
          metadata: {
            artifactPath,
            bytes: 0,
          },
          issues: [],
        },
        traces,
        incidents,
        startedAt,
      });

      await fs.copyFile(artifactPath, cachedArtifactPath);
      await fs.writeFile(cachedReportPath, JSON.stringify(report, null, 2), "utf8");

      logger.info("Tool runner generation completed", {
        requestHash,
        documentType: request.documentType,
        usedFallback,
        durationMs: Date.now() - startedAt,
      });

      return {
        artifactPath: cachedArtifactPath,
        reportPath: cachedReportPath,
        mimeType: MIME_BY_TYPE[request.documentType],
        report,
      };
    } catch (error) {
      const fallbackLocale = request.locale || "es";
      usedFallback = true;
      incidents.push({
        code: TOOL_RUNNER_ERROR_CODES.FALLBACK_FAILED,
        message: buildToolRunnerErrorMessage({
          code: TOOL_RUNNER_ERROR_CODES.FALLBACK_FAILED,
          locale: fallbackLocale,
          details: (error as Error).message,
        }),
        severity: "warning",
        details: { stage: "generate" },
      });
      const artifactPath = await this.createLastResortArtifact(request, workspace, requestHash);
      const validation = await validateOpenXmlArtifact(artifactPath, request.documentType);
      const report = buildExecutionReport({
        requestHash,
        documentType: request.documentType,
        locale: fallbackLocale,
        sandbox: this.config.sandbox,
        usedFallback,
        cacheHit: false,
        artifactPath,
        validation,
        traces,
        incidents,
        startedAt,
      });

      await fs.copyFile(artifactPath, cachedArtifactPath);
      await fs.writeFile(cachedReportPath, JSON.stringify(report, null, 2), "utf8");

      logger.warn("Tool runner generation fallback completed", {
        requestHash,
        documentType: request.documentType,
        error: (error as Error).message,
      });

      return {
        artifactPath: cachedArtifactPath,
        reportPath: cachedReportPath,
        mimeType: MIME_BY_TYPE[request.documentType],
        report,
      };
    } finally {
      if (!this.config.keepWorkspace) {
        await fs.rm(workspace.baseDir, { recursive: true, force: true });
      }
    }
  }
}

export const documentCliToolRunner = new DocumentCliToolRunner();
