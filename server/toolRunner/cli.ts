#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { executeCommand } from "./commandHandlers";
import {
  TOOL_RUNNER_COMMAND_VERSION,
  TOOL_RUNNER_PROTOCOL_VERSION,
  getHealthSnapshot,
  getToolDefinition,
  isKnownTool,
  listToolDefinitions,
} from "./toolRegistry";
import {
  TOOL_RUNNER_ERROR_CODES,
  ToolRunnerErrorCode,
  buildToolRunnerErrorMessage,
  getExitCodeForError,
} from "./errorContract";
import {
  ToolCommandName,
  ToolRunnerInput,
  ToolRunnerStructuredLog,
} from "./types";

function parseFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function writeLine(stream: NodeJS.WriteStream, payload: unknown): void {
  stream.write(`${JSON.stringify(payload)}\n`);
}

function toErrorCodeFromIssues(issues: Array<{ code?: string; severity?: string }>): ToolRunnerErrorCode {
  const codes = new Set(issues.map((issue) => issue.code || ""));

  if (codes.has("TOOL_VERSION_MISMATCH")) {
    return TOOL_RUNNER_ERROR_CODES.VERSION_MISMATCH;
  }

  if (Array.from(codes).some((code) => code.startsWith("PREFLIGHT_"))) {
    return TOOL_RUNNER_ERROR_CODES.PRECHECK_FAILED;
  }

  if (Array.from(codes).some((code) => code.includes("MSO_"))) {
    return TOOL_RUNNER_ERROR_CODES.OPENXML_INVALID;
  }

  if (Array.from(codes).some((code) => code.includes("TOOL_UNKNOWN"))) {
    return TOOL_RUNNER_ERROR_CODES.TOOL_NOT_FOUND;
  }

  if (Array.from(codes).some((code) => code.includes("TOOL_TIMEOUT"))) {
    return TOOL_RUNNER_ERROR_CODES.TOOL_TIMEOUT;
  }

  if (Array.from(codes).some((code) => code.includes("OUTPUT_"))) {
    return TOOL_RUNNER_ERROR_CODES.OUTPUT_MISSING;
  }

  if (Array.from(codes).some((code) => code.includes("SANDBOX"))) {
    return TOOL_RUNNER_ERROR_CODES.SANDBOX_FAILED;
  }

  if (Array.from(codes).some((code) => code.includes("INVALID_"))) {
    return TOOL_RUNNER_ERROR_CODES.INVALID_INPUT;
  }

  if (Array.from(codes).some((code) => code.includes("RUNTIME"))) {
    return TOOL_RUNNER_ERROR_CODES.TOOL_EXECUTION_FAILED;
  }

  return TOOL_RUNNER_ERROR_CODES.TOOL_EXECUTION_FAILED;
}

function emitStructured(
  stream: NodeJS.WriteStream,
  tool: ToolCommandName,
  level: "debug" | "info" | "warn" | "error",
  event: string,
  data?: Record<string, unknown>,
  kind: ToolRunnerStructuredLog["kind"] = "log"
): void {
  writeLine(stream, {
    kind,
    tool,
    level,
    event,
    ts: new Date().toISOString(),
    data,
  } satisfies ToolRunnerStructuredLog);
}

function printUsage(): void {
  const usage = {
    usage: "tool-runner <command> --input <path> --output-dir <path> [--report <path>] [--tool-version <version>]",
    commands: listToolDefinitions().map((tool) => tool.name),
    flags: ["--capabilities", "--healthcheck", "--version", "--input", "--output-dir", "--report", "--tool-version", "--locale"],
  };
  writeLine(process.stdout, usage);
}

async function readInput(inputPath: string): Promise<ToolRunnerInput> {
  const raw = await fs.readFile(inputPath, "utf8");
  const parsed = JSON.parse(raw) as ToolRunnerInput;
  return parsed;
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || hasFlag(args, "--help") || hasFlag(args, "-h")) {
    printUsage();
    return;
  }

  const commandToken = args[0]?.startsWith("--") ? undefined : args[0];
  const command = commandToken && isKnownTool(commandToken) ? (commandToken as ToolCommandName) : undefined;

  const hasUnknownCommand = Boolean(args[0] && !args[0].startsWith("--") && !isKnownTool(args[0]));

  if (hasFlag(args, "--version")) {
    writeLine(process.stdout, {
      protocolVersion: TOOL_RUNNER_PROTOCOL_VERSION,
      commandVersion: TOOL_RUNNER_COMMAND_VERSION,
    });
    return;
  }

  if (hasFlag(args, "--capabilities")) {
    if (hasUnknownCommand) {
      const code = TOOL_RUNNER_ERROR_CODES.TOOL_NOT_FOUND;
      writeLine(process.stderr, {
        kind: "error",
        code,
        message: buildToolRunnerErrorMessage({ code, locale: "en", details: `Unknown command: ${args[0]}` }),
      });
      process.exit(getExitCodeForError(code));
    }

    if (command) {
      writeLine(process.stdout, getToolDefinition(command));
      return;
    }
    writeLine(process.stdout, {
      protocolVersion: TOOL_RUNNER_PROTOCOL_VERSION,
      commandVersion: TOOL_RUNNER_COMMAND_VERSION,
      tools: listToolDefinitions(),
    });
    return;
  }

  if (hasFlag(args, "--healthcheck")) {
    if (hasUnknownCommand) {
      const code = TOOL_RUNNER_ERROR_CODES.TOOL_NOT_FOUND;
      writeLine(process.stderr, {
        kind: "error",
        code,
        message: buildToolRunnerErrorMessage({ code, locale: "en", details: `Unknown command: ${args[0]}` }),
      });
      process.exit(getExitCodeForError(code));
    }

    writeLine(process.stdout, getHealthSnapshot(command));
    return;
  }

  if (!command) {
    const code = TOOL_RUNNER_ERROR_CODES.INVALID_ARGS;
    writeLine(process.stderr, {
      kind: "error",
      code,
      message: buildToolRunnerErrorMessage({ code, locale: "en", details: "Missing or invalid command." }),
    });
    process.exit(getExitCodeForError(code));
  }

  const inputPath = parseFlag(args, "--input");
  const outputDir = parseFlag(args, "--output-dir");
  const reportPathFlag = parseFlag(args, "--report");
  const pinnedVersion = parseFlag(args, "--tool-version");
  const locale = parseFlag(args, "--locale");

  if (!inputPath || !outputDir) {
    const code = TOOL_RUNNER_ERROR_CODES.INVALID_ARGS;
    writeLine(process.stderr, {
      kind: "error",
      code,
      message: buildToolRunnerErrorMessage({
        code,
        locale: "en",
        details: "Both --input and --output-dir are required.",
      }),
    });
    process.exit(getExitCodeForError(code));
  }

  try {
    let input: ToolRunnerInput;
    try {
      input = await readInput(inputPath);
    } catch (error) {
      writeLine(process.stderr, {
        kind: "error",
        code: TOOL_RUNNER_ERROR_CODES.INVALID_INPUT,
        message: buildToolRunnerErrorMessage({
          code: TOOL_RUNNER_ERROR_CODES.INVALID_INPUT,
          locale: locale || "en",
          details: (error as Error).message,
        }),
      });
      process.exit(getExitCodeForError(TOOL_RUNNER_ERROR_CODES.INVALID_INPUT));
      return;
    }

    if (locale) {
      input = { ...input, locale };
    }

    await fs.mkdir(outputDir, { recursive: true });

    const emit = (line: ToolRunnerStructuredLog): void => {
      if (line.level === "error") {
        writeLine(process.stderr, line);
      } else {
        writeLine(process.stdout, line);
      }
    };

    const result = await executeCommand({
      command,
      input,
      outputDir,
      pinnedVersion,
      emit,
    });

    const reportPath = reportPathFlag || path.join(outputDir, `${input.determinism.inputHash}.${command}.report.json`);
    await fs.writeFile(reportPath, JSON.stringify(result, null, 2), "utf8");

    emitStructured(process.stdout, command, result.success ? "info" : "error", "result", {
      success: result.success,
      reportPath,
      artifactPath: result.artifactPath,
      issues: result.issues,
    }, result.success ? "result" : "error");

    if (!result.success) {
      const code = toErrorCodeFromIssues(result.issues);
      const locale = input.locale || "en";
      writeLine(process.stderr, {
        kind: "error",
        code,
        message: buildToolRunnerErrorMessage({ code, locale }),
      });
      process.exit(getExitCodeForError(code));
    }
  } catch (error) {
    const code = TOOL_RUNNER_ERROR_CODES.INTERNAL;
    writeLine(process.stderr, {
      kind: "error",
      code,
      message: buildToolRunnerErrorMessage({
        code,
        locale: "en",
        details: (error as Error).message,
      }),
    });
    process.exit(getExitCodeForError(code));
  }
}

run();
