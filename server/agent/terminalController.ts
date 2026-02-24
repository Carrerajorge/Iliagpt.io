/**
 * Terminal Controller - Full OS Command Execution System
 *
 * Provides complete terminal/shell control:
 * - Command execution (bash, powershell, zsh)
 * - Process management (start, stop, monitor)
 * - File system operations
 * - System information gathering
 * - Package management (npm, pip, apt, brew)
 * - Service management (systemctl, docker)
 * - Port management
 * - Environment variable management
 * - Script execution (Python, Node, Bash, etc.)
 * - Output streaming in real-time
 * - Command history and replay
 * - Safety guards against dangerous operations
 * - Sudo elevation with confirmation
 */

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs/promises";
import os from "os";
let pty: any = null;
try { pty = require("node-pty"); } catch {}
let docker: any = null;
try { const Docker = require("dockerode"); docker = new Docker(); } catch {}

// ============================================
// Types
// ============================================

export interface CommandRequest {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  shell?: "bash" | "sh" | "zsh" | "powershell" | "cmd";
  stream?: boolean;
  sudo?: boolean;
  background?: boolean;
  interactive?: boolean; // Use PTY
  inDocker?: boolean; // Run in Docker container
  dockerImage?: string; // Docker image to use
  confirmDangerous?: boolean; // Bypass safety check with explicit confirmation
  idempotencyKey?: string; // Optional idempotency control for retries
}

export interface CommandResult {
  id: string;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  duration: number;
  killed: boolean;
  signal: string | null;
  success: boolean;
  containerId?: string;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  command: string;
  cpu: number;
  memory: number;
  status: string;
  user: string;
  startTime: string;
}

export interface SystemInfo {
  os: {
    platform: string;
    release: string;
    arch: string;
    hostname: string;
    uptime: number;
  };
  cpu: {
    model: string;
    cores: number;
    speed: number;
    usage: number[];
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  disk: Array<{
    filesystem: string;
    size: string;
    used: string;
    available: string;
    usagePercent: string;
    mount: string;
  }>;
  network: Array<{
    interface: string;
    address: string;
    mac: string;
  }>;
}

export interface FileOperation {
  type: "read" | "write" | "append" | "delete" | "copy" | "move" | "mkdir" | "list" | "stat" | "search" | "chmod";
  path: string;
  destination?: string;
  content?: string;
  pattern?: string;
  recursive?: boolean;
  permissions?: string;
}

export interface TerminalSession {
  id: string;
  cwd: string;
  baseCwd: string;
  env: Record<string, string>;
  history: CommandResult[];
  activeProcesses: Map<string, ChildProcess | pty.IPty>;
  commandWindowStart: number;
  commandsInWindow: number;
  activeCommandCount: number;
  idempotentCommands: Map<string, { result: CommandResult; createdAt: number }>;
  commandFailureCount: number;
  commandFailureWindowStart: number;
  circuitOpenUntil: number;
  createdAt: number;
  lastActivity: number;
}

// ============================================
// Dangerous Command Detection
// ============================================

const DANGEROUS_PATTERNS = [
  { pattern: /rm\s+(-rf?|--recursive)\s+\//i, reason: "Recursive deletion of root filesystem", severity: "critical" },
  { pattern: /mkfs\./i, reason: "Filesystem formatting", severity: "critical" },
  { pattern: /dd\s+if=.*of=\/dev\//i, reason: "Direct disk write", severity: "critical" },
  { pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/i, reason: "Fork bomb", severity: "critical" },
  { pattern: /chmod\s+-R\s+777\s+\//i, reason: "Recursive permission change on root", severity: "high" },
  { pattern: /shutdown|reboot|poweroff|init\s+[06]/i, reason: "System shutdown/reboot", severity: "high" },
  { pattern: /iptables\s+-F/i, reason: "Firewall flush", severity: "high" },
  { pattern: />\s*\/dev\/sd[a-z]/i, reason: "Writing to disk device", severity: "critical" },
  { pattern: /curl.*\|\s*bash/i, reason: "Remote code execution pipe", severity: "high" },
  { pattern: /wget.*\|\s*sh/i, reason: "Remote code execution pipe", severity: "high" },
];

const SAFE_COMMAND_PREFIXES = [
  "ls", "cat", "head", "tail", "grep", "find", "echo", "pwd", "whoami",
  "date", "uname", "hostname", "wc", "sort", "uniq", "diff", "file",
  "which", "where", "type", "env", "printenv", "df", "du", "free",
  "top", "ps", "netstat", "ss", "ip", "ifconfig", "ping",
  "node", "python", "python3", "npm", "npx", "pip", "pip3",
  "git", "docker", "docker-compose", "kubectl",
  "cd", "mkdir", "touch", "cp", "mv",
];

const SAFE_COMMAND_PREFIX_SET = new Set(SAFE_COMMAND_PREFIXES.map((command) => command.toLowerCase()));
const ENFORCE_COMMAND_ALLOWLIST =
  process.env.TERMINAL_ENFORCE_ALLOWLIST === "true" || process.env.NODE_ENV === "production";
const ALLOW_DANGEROUS_CONFIRM_BYPASS = process.env.TERMINAL_ALLOW_DANGEROUS_CONFIRM === "true";

function parsePositiveInt(value: string | undefined, fallback: number, minimum = 1): number {
  const parsed = Number.parseInt(value || "", 10);
  if (Number.isNaN(parsed) || parsed < minimum) {
    return fallback;
  }
  return parsed;
}

const SESSION_TTL_MS = (() => {
  const rawValue = process.env.TERMINAL_SESSION_TTL_MS;
  if (rawValue === undefined) {
    return 15 * 60 * 1000;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsed)) {
    return 15 * 60 * 1000;
  }
  return Math.max(60_000, parsed);
})();
const SESSION_CLEANUP_INTERVAL_MS = Math.max(
  5_000,
  Math.min(60_000, Math.floor(SESSION_TTL_MS / 4))
);
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_ENV_ENTRIES = 256;
const MAX_ENV_KEY_LENGTH = 128;
const MAX_ENV_VALUE_LENGTH = 4096;
const MAX_FILE_OPERATION_BYTES = 5 * 1024 * 1024; // 5MB safety limit for file content/read operations
const MAX_PATH_LENGTH = 2_048;
const MAX_PACKAGES_PER_INSTALL = 64;
const MAX_PACKAGE_NAME_LENGTH = 256;
const MAX_SCRIPT_ARGS = 64;
const MAX_SCRIPT_ARG_LENGTH = 2_048;
const MAX_COMMAND_ARGS = 64;
const MAX_COMMAND_ARG_LENGTH = 2_048;
const MAX_COMMAND_LENGTH = 8_192;
const FORBIDDEN_COMMAND_META_CHARS = /[;&|`$()<>]/;
const FORBIDDEN_SESSION_ENV_KEYS = new Set([
  "NODE_OPTIONS",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "PYTHONSTARTUP",
  "PYTHONPATH",
  "BASH_ENV",
  "PROMPT_COMMAND",
  "LD_AUDIT",
  "RUST_BACKTRACE",
  "TERM",
  "DISPLAY",
  "SSH_AUTH_SOCK",
  "SHELLOPTS",
  "ENV",
  "BASH_FUNC_",
]);

const MAX_ACTIVE_OUTPUT_BYTES = 1024 * 1024; // 1MB per command output cap
const INFO_COMMAND_TIMEOUT_MS = 5_000;
const MAX_COMMANDS_PER_WINDOW = parsePositiveInt(process.env.TERMINAL_MAX_COMMANDS_PER_WINDOW, 120, 1);
const COMMAND_RATE_WINDOW_MS = parsePositiveInt(process.env.TERMINAL_COMMAND_WINDOW_MS, 60_000, 1_000);
const MAX_ACTIVE_COMMANDS_PER_SESSION = parsePositiveInt(process.env.TERMINAL_MAX_ACTIVE_COMMANDS_PER_SESSION, 4, 1);
const MAX_IDEMPOTENCY_TTL_MS = parsePositiveInt(process.env.TERMINAL_IDEMPOTENCY_TTL_MS, 5 * 60_000, 1_000);
const MAX_CONSECUTIVE_COMMAND_FAILURES = parsePositiveInt(process.env.TERMINAL_MAX_CONSECUTIVE_FAILURES, 6, 1);
const COMMAND_FAILURE_WINDOW_MS = parsePositiveInt(process.env.TERMINAL_COMMAND_FAILURE_WINDOW_MS, 60_000, 1_000);
const COMMAND_FAILURE_COOLDOWN_MS = parsePositiveInt(process.env.TERMINAL_COMMAND_FAILURE_COOLDOWN_MS, 30_000, 1_000);
const MAX_SEARCH_PATTERN_LENGTH = 256;
const MAX_LIST_ENTRIES = parsePositiveInt(process.env.TERMINAL_MAX_LIST_ENTRIES, 500, 10);
const MAX_HISTORY_ENTRIES = parsePositiveInt(process.env.TERMINAL_MAX_HISTORY_ENTRIES, 100, 10);
const MAX_SEARCH_RESULTS = parsePositiveInt(process.env.TERMINAL_MAX_SEARCH_RESULTS, 200, 10);
const ALLOWED_KILL_SIGNALS = new Set<NodeJS.Signals>([
  "SIGABRT",
  "SIGALRM",
  "SIGHUP",
  "SIGINT",
  "SIGKILL",
  "SIGQUIT",
  "SIGTERM",
  "SIGUSR1",
  "SIGUSR2",
]);

type RunCommandForInfoResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

type CommandSlotAcquisition =
  | { ok: true; release: () => void }
  | { ok: false; reason: string };

function sanitizeIncomingEnv(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Environment block must be an object");
  }

  const entries = Object.entries(raw);
  if (entries.length > MAX_ENV_ENTRIES) {
    throw new Error(`Too many environment variables (max ${MAX_ENV_ENTRIES})`);
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (typeof key !== "string") {
      continue;
    }

    const trimmedKey = key.trim();
    if (!trimmedKey || trimmedKey.length > MAX_ENV_KEY_LENGTH || !ENV_KEY_PATTERN.test(trimmedKey)) {
      continue;
    }

    const keyUpper = trimmedKey.toUpperCase();
    if (FORBIDDEN_SESSION_ENV_KEYS.has(keyUpper) || keyUpper.startsWith("BASH_FUNC_")) {
      continue;
    }

    if (value === undefined || value === null) {
      continue;
    }

    const valueText = typeof value === "string" ? value : String(value);
    normalized[trimmedKey] = valueText.slice(0, MAX_ENV_VALUE_LENGTH);
  }

  return normalized;
}

function sanitizeProcessEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}

function resolveCommandEnvironment(sessionEnv: Record<string, string>, requestEnv?: Record<string, string>): Record<string, string> {
  const sanitized = requestEnv ? sanitizeIncomingEnv(requestEnv) : {};
  return { ...sessionEnv, ...sanitized };
}

function isPathInsideBase(basePath: string, targetPath: string): boolean {
  const relativePath = path.relative(basePath, targetPath);
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath));
}

function validateStringOrThrow(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required and must be a string`);
  }
  if (value.includes("\u0000")) {
    throw new Error(`${label} contains invalid characters`);
  }
  if (value.length > MAX_PATH_LENGTH) {
    throw new Error(`${label} is too long`);
  }
  return value;
}

function validateTextPayload(value: unknown, maxBytes: number, label: string): string {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : String(value);
  if (Buffer.byteLength(text) > maxBytes) {
    throw new Error(`${label} exceeds maximum size of ${maxBytes} bytes`);
  }
  return text;
}

function validateCommandString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("command is required and must be a string");
  }
  const command = value.trim();
  if (command.length > MAX_COMMAND_LENGTH) {
    throw new Error(`command exceeds maximum length of ${MAX_COMMAND_LENGTH}`);
  }
  if (command.includes("\u0000") || command.includes("\r") || command.includes("\n")) {
    throw new Error("command contains invalid characters");
  }
  if (FORBIDDEN_COMMAND_META_CHARS.test(command)) {
    throw new Error("command contains forbidden shell metacharacters");
  }
  return command;
}

function validateCommandArgs(args?: unknown): string[] {
  if (!args) return [];
  if (!Array.isArray(args)) {
    throw new Error("args must be an array");
  }
  if (args.length > MAX_COMMAND_ARGS) {
    throw new Error(`Too many command arguments (max ${MAX_COMMAND_ARGS})`);
  }

  return args.map((arg) => {
    if (typeof arg !== "string") {
      throw new Error("Each command argument must be a string");
    }
    if (arg.includes("\u0000") || arg.includes("\r") || arg.includes("\n")) {
      throw new Error("Command arguments contain invalid characters");
    }
    if (arg.length > MAX_COMMAND_ARG_LENGTH) {
      throw new Error(`Command argument too long (max ${MAX_COMMAND_ARG_LENGTH} chars)`);
    }
    return arg;
  });
}

function shellEscapeArg(arg: string): string {
  // Single-quote the argument, escaping any embedded single quotes
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function buildCommandLine(command: string, args: string[]): string {
  if (args.length === 0) return command;
  return `${command} ${args.map(shellEscapeArg).join(" ")}`;
}

function validateScriptArgs(args?: unknown): string[] {
  if (!args) return [];
  if (!Array.isArray(args)) {
    throw new Error("args must be an array");
  }
  if (args.length > MAX_SCRIPT_ARGS) {
    throw new Error(`Too many script arguments (max ${MAX_SCRIPT_ARGS})`);
  }

  return args.map((arg) => {
    if (typeof arg !== "string") {
      throw new Error("Each script argument must be a string");
    }
    if (arg.includes("\u0000")) {
      throw new Error("Script arguments cannot contain null bytes");
    }
    if (arg.length > MAX_SCRIPT_ARG_LENGTH) {
      throw new Error(`Script argument too long (max ${MAX_SCRIPT_ARG_LENGTH} chars)`);
    }
    return arg;
  });
}

function validatePackageList(
  manager: "npm" | "pip" | "apt",
  packages: unknown
): string[] {
  if (!Array.isArray(packages)) {
    throw new Error("packages must be an array");
  }
  if (packages.length === 0) {
    throw new Error("packages array cannot be empty");
  }
  if (packages.length > MAX_PACKAGES_PER_INSTALL) {
    throw new Error(`Too many packages (max ${MAX_PACKAGES_PER_INSTALL})`);
  }

  return packages.map((pkg, index) => {
    if (typeof pkg !== "string") {
      throw new Error(`Package at index ${index} must be a string`);
    }
    const normalizedPackage = pkg.trim();
    if (!normalizedPackage) {
      throw new Error(`Package at index ${index} is required`);
    }
    if (normalizedPackage.length > MAX_PACKAGE_NAME_LENGTH) {
      throw new Error(`Package name too long (max ${MAX_PACKAGE_NAME_LENGTH} chars)`);
    }
    if (normalizedPackage.startsWith("-")) {
      throw new Error(`Package at index ${index} cannot be an option`);
    }
    if (/\s/.test(normalizedPackage) || /[`$&|;<>]/.test(normalizedPackage) || normalizedPackage.includes("\u0000")) {
      throw new Error(`Invalid characters in package at index ${index}`);
    }
    if (normalizedPackage.includes("(") || normalizedPackage.includes(")")) {
      throw new Error(`Invalid characters in package at index ${index}`);
    }

    return normalizedPackage;
  });
}

function getBaseCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return "";

  const tokens = trimmed.split(/\s+/);
  for (const token of tokens) {
    if (!token) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token)) continue; // Skip VAR=value prefixes

    const normalized = token.replace(/^['"]|['"]$/g, "");
    const basename = normalized.split("/").pop() || normalized;
    return basename.toLowerCase();
  }

  return "";
}

function resolveExecutionTimeout(rawTimeout: number | undefined, fallbackMs: number): number {
  const requestTimeout = rawTimeout === undefined ? fallbackMs : Number(rawTimeout);
  if (!Number.isFinite(requestTimeout) || requestTimeout <= 0) {
    throw new Error("timeout must be a positive number");
  }
  return Math.min(600_000, Math.max(500, Math.floor(requestTimeout)));
}

function sanitizeIdempotencyKey(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("idempotencyKey must be a non-empty string");
  }

  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 128) {
    throw new Error("idempotencyKey must be between 8 and 128 characters");
  }

  if (!/^[A-Za-z0-9._-]+$/.test(normalized)) {
    throw new Error("idempotencyKey contains invalid characters");
  }

  return normalized;
}

function buildDeterministicIdempotencyKey(prefix: string, seed: string): string {
  const safePrefix = prefix.replace(/[^A-Za-z0-9._-]+/g, "_");
  const digest = Buffer.from(`${seed}`).toString("base64url").slice(0, 80);
  return `${safePrefix}:${digest}`;
}

function sanitizeSearchPattern(rawPattern: string): string {
  const pattern = rawPattern.trim();
  if (!pattern) {
    throw new Error("pattern cannot be empty");
  }
  if (pattern.length > MAX_SEARCH_PATTERN_LENGTH) {
    throw new Error(`pattern exceeds maximum length of ${MAX_SEARCH_PATTERN_LENGTH}`);
  }
  if (/[;\n\r\t\u0000]/.test(pattern) || pattern.includes("|") || pattern.includes("&") || pattern.includes("`")) {
    throw new Error("pattern contains invalid characters");
  }
  return pattern;
}

function resolveSessionCwd(session: TerminalSession, rawCwd?: string): string {
  const target = (rawCwd ?? "").trim();
  const resolved = path.resolve(session.cwd, target || ".");
  if (rawCwd && /[\\\u0000]/.test(rawCwd)) {
    throw new Error("cwd contains invalid characters");
  }
  if (!isPathInsideBase(session.baseCwd, resolved)) {
    throw new Error("cwd transition denied: outside session root");
  }
  return resolved;
}

function appendLimitedOutput(
  current: string,
  currentBytes: number,
  chunk: string | Buffer,
  maxBytes: number,
): { output: string; bytes: number } {
  const chunkText = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  const chunkBuffer = Buffer.from(chunkText);
  if (maxBytes <= 0 || chunkBuffer.length === 0 || currentBytes >= maxBytes) {
    return { output: current, bytes: currentBytes };
  }

  const available = Math.max(0, maxBytes - currentBytes);
  if (available <= 0) {
    return { output: current, bytes: currentBytes };
  }

  if (chunkBuffer.length <= available) {
    return { output: current + chunkText, bytes: currentBytes + chunkBuffer.length };
  }

  return {
    output: current + chunkBuffer.subarray(0, available).toString("utf8"),
    bytes: currentBytes + available,
  };
}

function sanitizeKillSignal(rawSignal?: string): NodeJS.Signals {
  const signal = (rawSignal ?? "SIGTERM").toUpperCase();
  if (!ALLOWED_KILL_SIGNALS.has(signal as NodeJS.Signals)) {
    throw new Error(`Unsupported signal: ${signal}`);
  }
  return signal as NodeJS.Signals;
}

function validatePermissions(rawPermissions: string): string {
  const permissions = rawPermissions.trim();
  if (!/^[0-7]{3,4}$/.test(permissions)) {
    throw new Error("Invalid permissions format. Expected octal permissions, e.g. 0644");
  }
  return permissions;
}

function isPtyProcess(process: ChildProcess | pty.IPty): process is pty.IPty {
  return typeof (process as pty.IPty).onData === "function";
}

function terminateChildProcess(proc: ChildProcess): void {
  if (proc.exitCode !== null || proc.killed) return;
  try {
    proc.kill("SIGTERM");
  } catch {
    return;
  }

  setTimeout(() => {
    if (proc.exitCode === null && !proc.killed) {
      try {
        proc.kill("SIGKILL");
      } catch {}
    }
  }, 250).unref?.();
}

function terminatePtyProcess(proc: pty.IPty): void {
  try {
    proc.kill();
  } catch {
    return;
  }

  setTimeout(() => {
    try {
      proc.kill("SIGKILL" as any);
    } catch {}
  }, 250).unref?.();
}

function closeSessionProcess(proc: ChildProcess | pty.IPty): void {
  if (isPtyProcess(proc)) {
    terminatePtyProcess(proc);
  } else {
    terminateChildProcess(proc);
  }
}

function sanitizeDockerImage(imageRaw: string): string {
  const image = imageRaw.trim();
  if (!image) {
    throw new Error("dockerImage is required");
  }
  if (image.length > 255) {
    throw new Error("dockerImage is too long");
  }
  if (/[ \r\n\t\\`$&|;<>'"]/g.test(image) || image.includes("\u0000") || image.includes("..")) {
    throw new Error("dockerImage contains invalid characters");
  }
  return image;
}

function sanitizeCommandOutput(raw: string): string {
  return raw.replace(/[\u0000-\u0009]/g, "");
}

async function runCommandForInfo(
  command: string,
  args: string[],
  timeoutMs: number = INFO_COMMAND_TIMEOUT_MS,
): Promise<RunCommandForInfoResult> {
  const safeCommand = command.trim();
  if (!safeCommand) {
    throw new Error("system command is required");
  }

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;

    const proc = spawn(safeCommand, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      shell: false,
    });

    proc.stdout?.on("data", (chunk: Buffer) => {
      const appended = appendLimitedOutput(stdout, stdoutBytes, chunk, MAX_ACTIVE_OUTPUT_BYTES);
      stdout = appended.output;
      stdoutBytes = appended.bytes;
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      const appended = appendLimitedOutput(stderr, stderrBytes, chunk, MAX_ACTIVE_OUTPUT_BYTES);
      stderr = appended.output;
      stderrBytes = appended.bytes;
    });

    proc.on("error", (error) => {
      reject(error);
    });

    proc.on("close", (code) => {
      resolve({
        stdout: sanitizeCommandOutput(stdout),
        stderr: sanitizeCommandOutput(stderr),
        exitCode: code,
      });
    });
  });
}

// ============================================
// Terminal Controller
// ============================================

export class TerminalController extends EventEmitter {
  private sessions: Map<string, TerminalSession> = new Map();
  private maxOutputSize = 1024 * 1024; // 1MB max output
  private defaultTimeout = 30000; // 30 seconds
  private cleanupTimer: NodeJS.Timeout;

  constructor() {
    super();
    this.cleanupTimer = setInterval(
      () => this.cleanupExpiredSessions(),
      SESSION_CLEANUP_INTERVAL_MS
    );
    if (typeof this.cleanupTimer.unref === "function") {
      this.cleanupTimer.unref();
    }
  }

  private tryAcquireCommandSlot(session: TerminalSession): CommandSlotAcquisition {
    const now = Date.now();
    if (now - session.commandWindowStart >= COMMAND_RATE_WINDOW_MS) {
      session.commandWindowStart = now;
      session.commandsInWindow = 0;
    }

    if (session.commandsInWindow >= MAX_COMMANDS_PER_WINDOW) {
      return { ok: false, reason: "Too many commands in this interval" };
    }

    if (session.activeCommandCount >= MAX_ACTIVE_COMMANDS_PER_SESSION) {
      return { ok: false, reason: "Too many concurrent commands in session" };
    }

    session.commandsInWindow += 1;
    session.activeCommandCount += 1;

    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        session.activeCommandCount = Math.max(0, session.activeCommandCount - 1);
      },
    };
  }

  private evaluateCircuitBreaker(session: TerminalSession): string | undefined {
    const now = Date.now();
    if (session.circuitOpenUntil && now < session.circuitOpenUntil) {
      const remainingMs = Math.max(0, session.circuitOpenUntil - now);
      const remainingSec = Math.ceil(remainingMs / 1000);
      return `circuit breaker active (${remainingSec}s remaining)`;
    }

    if (session.commandFailureCount > 0 && now - session.commandFailureWindowStart > COMMAND_FAILURE_WINDOW_MS) {
      session.commandFailureCount = 0;
      session.commandFailureWindowStart = now;
    }

    return undefined;
  }

  private recordCommandResult(session: TerminalSession, result: CommandResult): void {
    const now = Date.now();
    if (result.success) {
      session.commandFailureCount = 0;
      session.commandFailureWindowStart = now;
      return;
    }

    if (session.commandFailureCount === 0) {
      session.commandFailureWindowStart = now;
    }
    session.commandFailureCount += 1;

    if (session.commandFailureCount >= MAX_CONSECUTIVE_COMMAND_FAILURES) {
      session.circuitOpenUntil = now + COMMAND_FAILURE_COOLDOWN_MS;
    }
  }

  private getCachedCommandResult(session: TerminalSession, key?: string): CommandResult | undefined {
    if (!key) return undefined;
    const entry = session.idempotentCommands.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.createdAt > MAX_IDEMPOTENCY_TTL_MS) {
      session.idempotentCommands.delete(key);
      return undefined;
    }
    return { ...entry.result };
  }

  private setCachedCommandResult(session: TerminalSession, key: string, result: CommandResult): void {
    session.idempotentCommands.set(key, { result, createdAt: Date.now() });
  }

  private pruneExpiredIdempotentCommands(session: TerminalSession): void {
    const now = Date.now();
    for (const [key, entry] of session.idempotentCommands.entries()) {
      if (now - entry.createdAt > MAX_IDEMPOTENCY_TTL_MS) {
        session.idempotentCommands.delete(key);
      }
    }
  }

  private appendHistory(session: TerminalSession, result: CommandResult): void {
    session.history.push(result);
    if (session.history.length > MAX_HISTORY_ENTRIES) {
      session.history = session.history.slice(-MAX_HISTORY_ENTRIES);
    }
  }

  // ============================================
  // Session Management
  // ============================================

  private getSessionOrFail(sessionId: string): TerminalSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const now = Date.now();
    if (now - session.lastActivity > SESSION_TTL_MS) {
      this.closeSession(sessionId);
      throw new Error(`Session expired: ${sessionId}`);
    }

    session.lastActivity = now;
    this.pruneExpiredIdempotentCommands(session);
    return session;
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of Array.from(this.sessions.entries())) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        this.closeSession(sessionId);
      }
    }
  }

  createSession(cwd?: string, env?: Record<string, string>): string {
    const sessionId = randomUUID();
    const baseEnv = sanitizeProcessEnv(process.env);
    const requestedEnv = env ? sanitizeIncomingEnv(env) : {};
    const baseCwd = path.resolve(cwd || process.cwd());
    const session: TerminalSession = {
      id: sessionId,
      cwd: baseCwd,
      baseCwd,
      env: { ...baseEnv, ...requestedEnv },
      history: [],
      activeProcesses: new Map(),
      commandWindowStart: Date.now(),
      commandsInWindow: 0,
      activeCommandCount: 0,
      idempotentCommands: new Map(),
      commandFailureCount: 0,
      commandFailureWindowStart: Date.now(),
      circuitOpenUntil: 0,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    this.sessions.set(sessionId, session);
    this.emit("session:created", { sessionId });
    return sessionId;
  }

  setSessionEnv(sessionId: string, variables: Record<string, string>): { updated: Record<string, string> } {
    const session = this.getSessionOrFail(sessionId);

    const sanitized = sanitizeIncomingEnv(variables);
    Object.assign(session.env, sanitized);
    return { updated: { ...sanitized } };
  }

  getSessionEnv(sessionId: string): Record<string, string> | undefined {
    const session = this.getSessionOrFail(sessionId);
    return { ...session.env };
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Kill all active processes
    for (const proc of Array.from(session.activeProcesses.values())) {
      closeSessionProcess(proc);
    }
    session.activeProcesses.clear();

    this.sessions.delete(sessionId);
    this.emit("session:closed", { sessionId });
  }

  // ============================================
  // Command Execution
  // ============================================

  async executeCommand(sessionId: string, request: CommandRequest): Promise<CommandResult> {
    const session = this.getSessionOrFail(sessionId);
    const command = validateCommandString(request.command);
    const args = validateCommandArgs(request.args);

    const commandId = randomUUID();
    const startTime = Date.now();

    let idempotencyKey: string | undefined;
    try {
      idempotencyKey = sanitizeIdempotencyKey(request.idempotencyKey);
    } catch (error: any) {
      return {
        id: commandId,
        command,
        exitCode: 1,
        stdout: "",
        stderr: `Invalid idempotencyKey: ${error.message}`,
        duration: 0,
        killed: false,
        signal: null,
        success: false,
      };
    }

    const cached = this.getCachedCommandResult(session, idempotencyKey);
    if (cached) {
      return cached;
    }

    const circuitReason = this.evaluateCircuitBreaker(session);
    if (circuitReason) {
      const blockedResult: CommandResult = {
        id: commandId,
        command,
        exitCode: 1,
        stdout: "",
        stderr: `Command execution blocked: ${circuitReason}`,
        duration: 0,
        killed: false,
        signal: null,
        success: false,
      };
      if (idempotencyKey) {
        this.setCachedCommandResult(session, idempotencyKey, blockedResult);
      }
      return blockedResult;
    }

    // Safety check
    const safetyResult = this.checkCommandSafety(command);
    const bypassSafety =
      Boolean(request.confirmDangerous) && ALLOW_DANGEROUS_CONFIRM_BYPASS;
    if (!safetyResult.safe && !bypassSafety) {
      const blockedResult: CommandResult = {
        id: commandId,
        command,
        exitCode: 1,
        stdout: "",
        stderr: `SAFETY BLOCK: ${safetyResult.reason} (severity: ${safetyResult.severity}). Dangerous bypass is disabled unless TERMINAL_ALLOW_DANGEROUS_CONFIRM=true.`,
        duration: 0,
        killed: false,
        signal: null,
        success: false,
      };
      if (idempotencyKey) {
        this.setCachedCommandResult(session, idempotencyKey, blockedResult);
      }
      this.recordCommandResult(session, blockedResult);
      return blockedResult;
    }

    const normalizedRequest: CommandRequest = {
      ...request,
      command,
      args,
    };

    const fullCommand = buildCommandLine(command, args);
    const executeFlow = async (): Promise<CommandResult> => {
    if (request.inDocker) {
      return this.executeDockerCommand(sessionId, commandId, normalizedRequest, startTime);
    }

    if (request.interactive) {
      return this.executePtyCommand(sessionId, commandId, normalizedRequest, startTime);
    }

    // Standard execution
    // Handle cd command specially
    if (fullCommand.trim().startsWith("cd ")) {
      return (async () => {
        const targetDir = fullCommand.trim().slice(3).trim().replace(/^["']|["']$/g, "");
        let resolvedPath: string;
        try {
          resolvedPath = resolveSessionCwd(session, targetDir);
        } catch (error: any) {
          return {
            id: commandId,
            command: fullCommand,
            exitCode: 1,
            stdout: "",
            stderr: error.message,
            duration: Date.now() - startTime,
            killed: false,
            signal: null,
            success: false,
          };
        }
        if (!isPathInsideBase(session.baseCwd, resolvedPath)) {
          return {
            id: commandId,
            command: fullCommand,
            exitCode: 1,
            stdout: "",
            stderr: "Cwd transition denied: outside session root",
            duration: Date.now() - startTime,
            killed: false,
            signal: null,
            success: false,
          };
        }

        try {
          await fs.access(resolvedPath);
          const stat = await fs.stat(resolvedPath);
          if (!stat.isDirectory()) {
            throw new Error(`Not a directory: ${resolvedPath}`);
          }
          session.cwd = resolvedPath;
          return {
            id: commandId,
            command: fullCommand,
            exitCode: 0,
            stdout: resolvedPath,
            stderr: "",
            duration: Date.now() - startTime,
            killed: false,
            signal: null,
            success: true,
          };
        } catch (error: any) {
          return {
            id: commandId,
            command: fullCommand,
            exitCode: 1,
            stdout: "",
            stderr: error.message,
            duration: Date.now() - startTime,
            killed: false,
            signal: null,
            success: false,
          };
        }
      })();
    }

    return new Promise<CommandResult>((resolve) => {
      const shell = request.shell || "bash";
      const timeout = resolveExecutionTimeout(request.timeout, this.defaultTimeout);

      const env = resolveCommandEnvironment(session.env, request.env);
      const cwd = resolveSessionCwd(session, request.cwd);
      // Always use spawn with explicit args array and shell: false to prevent
      // command injection (CodeQL: uncontrolled-command-line).
      // Only fall back to shell -c when the command itself contains spaces
      // (e.g. a path with spaces), and in that case args are shell-escaped.
      const canDirectSpawn =
        command.length > 0 &&
        !/\s/.test(command);

      const proc = canDirectSpawn
        ? spawn(command, args, {
            cwd,
            env,
            timeout,
            stdio: ["pipe", "pipe", "pipe"],
            shell: false,
          })
        : spawn(shell, ["-c", buildCommandLine(command, args)], {
            cwd,
            env,
            timeout,
            stdio: ["pipe", "pipe", "pipe"],
            shell: false,
          });

      let stdout = "";
      let stderr = "";
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let killed = false;

      session.activeProcesses.set(commandId, proc);

      proc.stdout?.on("data", (data: Buffer) => {
        const appended = appendLimitedOutput(stdout, stdoutBytes, data, MAX_ACTIVE_OUTPUT_BYTES);
        stdout = appended.output;
        stdoutBytes = appended.bytes;
        if (request.stream) {
          this.emit("command:output", { sessionId, commandId, stream: "stdout", chunk: data });
        }
      });

      proc.stderr?.on("data", (data: Buffer) => {
        const appended = appendLimitedOutput(stderr, stderrBytes, data, MAX_ACTIVE_OUTPUT_BYTES);
        stderr = appended.output;
        stderrBytes = appended.bytes;
        if (request.stream) {
          this.emit("command:output", { sessionId, commandId, stream: "stderr", chunk: data });
        }
      });

      const timer = setTimeout(() => {
        killed = true;
        terminateChildProcess(proc);
      }, timeout);

      proc.on("close", (exitCode, signal) => {
        clearTimeout(timer);
        session.activeProcesses.delete(commandId);

        const result: CommandResult = {
          id: commandId,
          command: fullCommand,
          exitCode,
          stdout: stdout.slice(0, this.maxOutputSize),
          stderr: stderr.slice(0, this.maxOutputSize),
          duration: Date.now() - startTime,
          killed,
          signal: signal || null,
          success: exitCode === 0,
        };

        this.appendHistory(session, result);
        session.lastActivity = Date.now();

        this.emit("command:complete", { sessionId, commandId, result });
        resolve(result);
      });

      proc.on("error", (error) => {
        clearTimeout(timer);
        session.activeProcesses.delete(commandId);

        const result: CommandResult = {
          id: commandId,
          command: fullCommand,
          exitCode: 1,
          stdout,
          stderr: error.message,
          duration: Date.now() - startTime,
          killed: false,
          signal: null,
          success: false,
        };

        this.appendHistory(session, result);
        resolve(result);
      });
    });
    };

    const commandSlot = this.tryAcquireCommandSlot(session);
    if (!commandSlot.ok) {
      const reason = "reason" in commandSlot ? commandSlot.reason : "command slot unavailable";
      const errorResult: CommandResult = {
        id: commandId,
        command: fullCommand,
        exitCode: 1,
        stdout: "",
        stderr: `Command execution blocked: ${reason}`,
        duration: 0,
        killed: false,
        signal: null,
        success: false,
      };
      if (idempotencyKey) {
        this.setCachedCommandResult(session, idempotencyKey, errorResult);
      }
      this.recordCommandResult(session, errorResult);
      return errorResult;
    }

    try {
      const result = await executeFlow();
      this.recordCommandResult(session, result);
      if (idempotencyKey) {
        this.setCachedCommandResult(session, idempotencyKey, result);
      }
      return result;
    } catch (error: any) {
      const errorResult: CommandResult = {
        id: commandId,
        command: fullCommand,
        exitCode: 1,
        stdout: "",
        stderr: `Command execution failed: ${error?.message || "unexpected error"}`,
        duration: Date.now() - startTime,
        killed: false,
        signal: null,
        success: false,
      };
      this.recordCommandResult(session, errorResult);
      if (idempotencyKey) {
        this.setCachedCommandResult(session, idempotencyKey, errorResult);
      }
      return errorResult;
    } finally {
      commandSlot.release();
      this.pruneExpiredIdempotentCommands(session);
      session.lastActivity = Date.now();
    }
  }

  // ============================================
  // PTY Execution (Interactive)
  // ============================================

  private async executePtyCommand(sessionId: string, commandId: string, request: CommandRequest, startTime: number): Promise<CommandResult> {
    const command = validateCommandString(request.command);
    const args = validateCommandArgs(request.args);
    const session = this.getSessionOrFail(sessionId);
    const cwd = resolveSessionCwd(session, request.cwd);

    return new Promise((resolve) => {
        const shell = request.shell || "bash";
        const ptyProc = pty.spawn(shell, [], {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
            cwd,
            env: resolveCommandEnvironment(session.env, request.env),
        });

        let output = "";
        let outputBytes = 0;
        let killed = false;

        session.activeProcesses.set(commandId, ptyProc);

        ptyProc.onData((data) => {
            const appended = appendLimitedOutput(output, outputBytes, data, MAX_ACTIVE_OUTPUT_BYTES);
            output = appended.output;
            outputBytes = appended.bytes;
            if (request.stream) {
                this.emit("command:output", { sessionId, commandId, stream: "stdout", chunk: data });
            }
        });

        // Send command — use shell-escaped args to prevent PTY injection
        // (CodeQL: code-injection via PTY write).
        // Strip ANSI escape sequences from the command to prevent terminal escape injection.
        const fullCommand = buildCommandLine(command, args);
        const sanitizedCommand = fullCommand.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
        ptyProc.write(`${sanitizedCommand}\r`);
        
        // If not a long-running interactive session, we might want to exit after command
        // For now, we assume simple execution in PTY
        // ptyProc.write("exit\r"); // Only if we want to close immediately

        const timeout = resolveExecutionTimeout(request.timeout, this.defaultTimeout);
        const timer = setTimeout(() => {
            killed = true;
            terminatePtyProcess(ptyProc);
        }, timeout);

        ptyProc.onExit(({ exitCode, signal }) => {
            clearTimeout(timer);
            session.activeProcesses.delete(commandId);

            const result: CommandResult = {
                id: commandId,
                command: fullCommand,
                exitCode,
                stdout: output,
                stderr: "", // PTY merges stdout/stderr
                duration: Date.now() - startTime,
                killed,
                signal: signal ? String(signal) : null,
                success: exitCode === 0
            };
            
            this.appendHistory(session, result);
            this.emit("command:complete", { sessionId, commandId, result });
            resolve(result);
        });
    });
  }

  // ============================================
  // Docker Execution
  // ============================================

  private async executeDockerCommand(sessionId: string, commandId: string, request: CommandRequest, startTime: number): Promise<CommandResult> {
    const command = validateCommandString(request.command);
    const args = validateCommandArgs(request.args);
    const session = this.getSessionOrFail(sessionId);

    const image = sanitizeDockerImage(request.dockerImage || "node:22-alpine");
    const fullCommand = buildCommandLine(command, args);
    const cmd = args.length ? [command, ...args] : [command]; // CMD format for Docker

    // Prepare Env
    const env = resolveCommandEnvironment(session.env, request.env);
    const envVars = Object.entries(env).map(([k, v]) => `${k}=${v}`);

    let stdout = "";
    let stderr = "";
    let container: Docker.Container | null = null;

    try {
        // 1. Create Container
        container = await docker.createContainer({
            Image: image,
            Cmd: cmd,
            Env: envVars,
            Tty: false,
            WorkingDir: "/app", // Standard working dir
            HostConfig: {
                AutoRemove: false, // We remove manually to get logs/exit code first
                Memory: 512 * 1024 * 1024, // 512MB RAM limit
                CpuShares: 512, // 0.5 CPU shares relative weight
                Privileged: false,
                SecurityOpt: ["no-new-privileges"], // Hardening: Prevent privilege escalation
                CapDrop: ["ALL"], // Drop all capabilities
                NetworkMode: "none", // Default to no network for safety
                ReadonlyRootfs: false, // Allow writing to tmp/app for now
            }
        });

        await container.start();

        // 4. Wait for finish
        const waitPromise = container.wait();
        
        // Timeout handling
        const timeout = resolveExecutionTimeout(request.timeout, this.defaultTimeout);
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Timeout")), timeout)
        );

        const result: any = await Promise.race([waitPromise, timeoutPromise]);
        const exitCode = result.StatusCode;

        // 5. Get Logs (safest way to get stdout/stderr separated correctly)
        // Note: logs() returns Buffer if not encoding specified
        const stdoutBuffer = await container.logs({ stdout: true, stderr: false });
        const stderrBuffer = await container.logs({ stdout: false, stderr: true });

        stdout = sanitizeCommandOutput(stdoutBuffer.toString()); // Basic sanitization of control bytes
        stderr = sanitizeCommandOutput(stderrBuffer.toString());

        if (request.stream) {
             this.emit("command:output", { sessionId, commandId, stream: "stdout", chunk: stdout });
             if (stderr) this.emit("command:output", { sessionId, commandId, stream: "stderr", chunk: stderr });
        }

        // 6. Cleanup
        await container.remove({ force: true });

        const cmdResult: CommandResult = {
            id: commandId,
            command: fullCommand,
            exitCode,
            stdout,
            stderr,
            duration: Date.now() - startTime,
            killed: false,
            signal: null,
            success: exitCode === 0,
            containerId: container.id
        };

        this.appendHistory(session, cmdResult);
        this.emit("command:complete", { sessionId, commandId, result: cmdResult });
        return cmdResult;

    } catch (error: any) {
        if (container) {
            try { await container.remove({ force: true }); } catch {}
        }

        const isTimeout = error.message === "Timeout";
        
        return {
            id: commandId,
            command: fullCommand,
            exitCode: isTimeout ? null : 1,
            stdout,
            stderr: error.message,
            duration: Date.now() - startTime,
            killed: isTimeout,
            signal: isTimeout ? "SIGKILL" : null,
            success: false
        };
    }
  }

  // ============================================
  // File System Operations
  // ============================================

  async fileOperation(sessionId: string, op: FileOperation): Promise<{ success: boolean; data?: any; error?: string }> {
    const session = this.getSessionOrFail(sessionId);
    const relativePath = validateStringOrThrow(op.path, "path");
    const resolvedPath = path.resolve(session.cwd, relativePath);

    if (!isPathInsideBase(session.baseCwd, resolvedPath)) {
      return { success: false, error: "Path is outside session working directory" };
    }

    // Resolve symlinks to prevent TOCTOU bypass (CodeQL: uncontrolled-data-in-path).
    // For operations on existing paths, verify the real (symlink-resolved) path is still inside base.
    if (op.type !== "write" && op.type !== "mkdir") {
      try {
        const realBase = await fs.realpath(session.baseCwd);
        const realTarget = await fs.realpath(resolvedPath);
        if (realTarget !== realBase && !realTarget.startsWith(realBase + path.sep)) {
          return { success: false, error: "Path escapes session directory via symlink" };
        }
      } catch {
        // Path doesn't exist yet — acceptable for write/mkdir but not for read/delete/etc.
        if (op.type === "read" || op.type === "delete" || op.type === "copy" || op.type === "move" || op.type === "stat" || op.type === "chmod") {
          return { success: false, error: "Path does not exist" };
        }
      }
    }

    try {
      switch (op.type) {
        case "read": {
          const stats = await fs.stat(resolvedPath);
          if (stats.size > MAX_FILE_OPERATION_BYTES) {
            throw new Error(`File size exceeds ${MAX_FILE_OPERATION_BYTES} bytes`);
          }
          const content = await fs.readFile(resolvedPath, "utf-8");
          return { success: true, data: content };
        }

        case "write": {
          const content = validateTextPayload(op.content, MAX_FILE_OPERATION_BYTES, "content");
          const parentDir = path.dirname(resolvedPath);
          // Verify parent directory is still inside base before creating (CodeQL: path-traversal)
          if (!isPathInsideBase(session.baseCwd, parentDir)) {
            return { success: false, error: "Parent directory is outside session working directory" };
          }
          await fs.mkdir(parentDir, { recursive: true });
          await fs.writeFile(resolvedPath, content);
          return { success: true };
        }

        case "append": {
          const content = validateTextPayload(op.content, MAX_FILE_OPERATION_BYTES, "content");
          await fs.appendFile(resolvedPath, content);
          return { success: true };
        }

        case "delete": {
          await fs.rm(resolvedPath, { recursive: op.recursive || false });
          return { success: true };
        }

        case "copy": {
          if (!op.destination) return { success: false, error: "Destination required" };
          const destination = validateStringOrThrow(op.destination, "destination");
          const destPath = path.resolve(session.cwd, destination);
          if (!isPathInsideBase(session.baseCwd, destPath)) {
            return { success: false, error: "Destination is outside session working directory" };
          }
          await fs.cp(resolvedPath, destPath, { recursive: op.recursive || false });
          return { success: true };
        }

        case "move": {
          if (!op.destination) return { success: false, error: "Destination required" };
          const destination = validateStringOrThrow(op.destination, "destination");
          const moveDest = path.resolve(session.cwd, destination);
          if (!isPathInsideBase(session.baseCwd, moveDest)) {
            return { success: false, error: "Destination is outside session working directory" };
          }
          await fs.rename(resolvedPath, moveDest);
          return { success: true };
        }

        case "mkdir": {
          await fs.mkdir(resolvedPath, { recursive: true });
          return { success: true };
        }

        case "list": {
          const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
          const limitedEntries = entries.slice(0, MAX_LIST_ENTRIES);
          const items = limitedEntries.map(e => ({
            name: e.name,
            isDirectory: e.isDirectory(),
            isFile: e.isFile(),
            isSymlink: e.isSymbolicLink(),
          }));
          return {
            success: true,
            data: items,
            truncated: entries.length > MAX_LIST_ENTRIES,
            total: entries.length,
          };
        }

        case "stat": {
          const stat = await fs.stat(resolvedPath);
          return {
            success: true,
            data: {
              size: stat.size,
              isDirectory: stat.isDirectory(),
              isFile: stat.isFile(),
              created: stat.birthtime,
              modified: stat.mtime,
              permissions: stat.mode.toString(8),
            },
          };
        }

        case "search": {
          const pattern = sanitizeSearchPattern(op.pattern || "*");
          const sanitizedRecursive =
            op.recursive === false ? ["-maxdepth", "1"] : [];
          const result = await this.executeCommand(sessionId, {
            command: "find",
            args: [resolvedPath, ...sanitizedRecursive, "-type", "f", "-name", pattern],
            timeout: 10_000,
            idempotencyKey: buildDeterministicIdempotencyKey(
              "search",
              `${session.cwd}|${resolvedPath}|${pattern}|${op.recursive ? "1" : "0"}`
            ),
          });
          if (!result.success) {
            return { success: false, error: result.stderr || result.stdout || "Search failed" };
          }
          return {
            success: true,
            data: result.stdout.trim().split("\n").filter(Boolean).slice(0, MAX_SEARCH_RESULTS),
          };
        }

        case "chmod": {
          if (!op.permissions) return { success: false, error: "Permissions required" };
          const safePermissions = validatePermissions(op.permissions);
          await fs.chmod(resolvedPath, parseInt(safePermissions, 8));
          return { success: true };
        }

        default:
          return { success: false, error: `Unknown operation: ${op.type}` };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // System Information
  // ============================================

  async getSystemInfo(): Promise<SystemInfo> {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    // Disk info
    let diskInfo: any[] = [];
    try {
      const { stdout, exitCode } = await runCommandForInfo("df", ["-h"]);
      if (exitCode === 0 && stdout.trim()) {
        const lines = stdout.trim().split("\n").slice(1).filter(Boolean);
        diskInfo = lines
          .map((line) => {
            const parts = line.split(/\s+/);
            if (parts.length < 6) {
              return null;
            }
            return {
              filesystem: parts[0],
              size: parts[1],
              used: parts[2],
              available: parts[3],
              usagePercent: parts[4],
              mount: parts[5],
            };
          })
          .filter(Boolean);
      }
    } catch { /* ignore */ }

    // Network interfaces
    const nets = os.networkInterfaces();
    const networkEntries = Object.entries(nets || {}) as Array<[string, os.NetworkInterfaceInfo[] | undefined]>;
    const networkInfo = networkEntries.flatMap(([name, interfaces]) =>
      (interfaces || []).filter((i): i is os.NetworkInterfaceInfo => !i.internal).map((i) => ({
        interface: name,
        address: i.address,
        mac: i.mac,
      }))
    );

    return {
      os: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptime: os.uptime(),
      },
      cpu: {
        model: cpus[0]?.model || "unknown",
        cores: cpus.length,
        speed: cpus[0]?.speed || 0,
        usage: cpus.map(cpu => {
          const total = (Object.values(cpu.times) as number[]).reduce((acc, value) => acc + value, 0);
          return Math.round(((total - Number(cpu.times.idle)) / total) * 100);
        }),
      },
      memory: {
        total: totalMem,
        used: totalMem - freeMem,
        free: freeMem,
        usagePercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
      },
      disk: diskInfo,
      network: networkInfo,
    };
  }

  // ============================================
  // Process Management
  // ============================================

  async listProcesses(filter?: string): Promise<ProcessInfo[]> {
    try {
      const { stdout } = await runCommandForInfo("ps", ["aux", "--sort=-%mem"]);
      const lines = stdout.trim().split("\n").slice(1, 51);

      let processes = lines.map((line): ProcessInfo | null => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 11) {
          return null;
        }
        return {
          pid: parseInt(parts[1]),
          name: parts[10] || "",
          command: parts.slice(10).join(" "),
          cpu: parseFloat(parts[2]),
          memory: parseFloat(parts[3]),
          status: parts[7],
          user: parts[0],
          startTime: parts[8],
        };
      }).filter((process): process is ProcessInfo => Boolean(process && !Number.isNaN(process.pid)));

      if (filter) {
        const filterLower = filter.toLowerCase();
        processes = processes.filter(p =>
          p.name.toLowerCase().includes(filterLower) ||
          p.command.toLowerCase().includes(filterLower)
        );
      }

      return processes;
    } catch {
      return [];
    }
  }

  async killProcess(pid: number, signal: string = "SIGTERM"): Promise<boolean> {
    try {
      const safeSignal = sanitizeKillSignal(signal);
      if (!Number.isInteger(pid) || pid <= 0) {
        return false;
      }
      process.kill(pid, safeSignal);
      return true;
    } catch {
      return false;
    }
  }

  // ============================================
  // Port Management
  // ============================================

  async listPorts(): Promise<Array<{ port: number; pid: number; process: string; state: string }>> {
    try {
      const commands: Array<[string, string[]]> = [
        ["ss", ["-tlnp"]],
        ["netstat", ["-tlnp"]],
      ];

      let stdout = "";
      for (const [command, args] of commands) {
        try {
          const commandResult = await runCommandForInfo(command, args);
          if (commandResult.exitCode === 0) {
            stdout = commandResult.stdout;
            break;
          }
        } catch {
          continue;
        }
      }

      const ports: Array<{ port: number; pid: number; process: string; state: string }> = [];
      const lines = stdout.trim().split("\n").slice(1);

      for (const line of lines) {
        const portMatch = line.match(/:(\d+)\s/);
        const pidMatch = line.match(/pid=(\d+)/);
        const processMatch = line.match(/users:\(\("([^"]+)"/);

        if (portMatch) {
          ports.push({
            port: parseInt(portMatch[1]),
            pid: pidMatch ? parseInt(pidMatch[1]) : 0,
            process: processMatch ? processMatch[1] : "unknown",
            state: line.includes("LISTEN") ? "LISTENING" : "ESTABLISHED",
          });
        }
      }

      return ports;
    } catch {
      return [];
    }
  }

  // ============================================
  // Package Management
  // ============================================

  async installPackage(sessionId: string, manager: "npm" | "pip" | "apt", packages: string[]): Promise<CommandResult> {
    const safePackages = validatePackageList(manager, packages);
    const commands: Record<string, { command: string; args: string[] }> = {
      npm: { command: "npm", args: ["install"] },
      pip: { command: "pip", args: ["install"] },
      apt: { command: "apt-get", args: ["install", "-y"] },
    };
    const command = commands[manager];

    return this.executeCommand(sessionId, {
      command: command.command,
      args: [...command.args, ...safePackages],
      timeout: 120000,
    });
  }

  // ============================================
  // Script Execution
  // ============================================

  async executeScript(sessionId: string, language: string, code: string, options?: {
    timeout?: number;
    args?: string[];
  }): Promise<CommandResult> {
    this.getSessionOrFail(sessionId);
    const commandId = randomUUID();
    const startTime = Date.now();

    const normalizedLanguage = language.trim().toLowerCase();
    const safeCode = validateTextPayload(code, MAX_FILE_OPERATION_BYTES, "code");
    if (!safeCode.trim()) {
      return {
        id: commandId,
        command: `script:${normalizedLanguage || "unknown"}`,
        exitCode: 1,
        stdout: "",
        stderr: "code is empty",
        duration: Date.now() - startTime,
        killed: false,
        signal: null,
        success: false,
      };
    }
    if (safeCode.includes("\u0000")) {
      return {
        id: commandId,
        command: `script:${normalizedLanguage || "unknown"}`,
        exitCode: 1,
        stdout: "",
        stderr: "code contains invalid characters",
        duration: Date.now() - startTime,
        killed: false,
        signal: null,
        success: false,
      };
    }

    const timeout = options?.timeout ? resolveExecutionTimeout(options.timeout, 60_000) : 60_000;
    const extensions: Record<string, string> = {
      python: "py", javascript: "js", typescript: "ts", bash: "sh",
      ruby: "rb", go: "go", rust: "rs", php: "php",
    };

    const interpreters: Record<string, { command: string; args?: string[] }> = {
      python: { command: "python3" },
      javascript: { command: "node" },
      typescript: { command: "npx", args: ["ts-node"] },
      bash: { command: "bash" },
      ruby: { command: "ruby" },
      go: { command: "go", args: ["run"] },
      rust: { command: "rust" },
      php: { command: "php" },
    };
    const interpreter = interpreters[normalizedLanguage];
    const extension = extensions[normalizedLanguage];

    if (!interpreter || !extension) {
      return {
        id: commandId,
        command: `script:${normalizedLanguage}`,
        exitCode: 1,
        stdout: "",
        stderr: `Unsupported script language: ${normalizedLanguage || "unknown"}`,
        duration: Date.now() - startTime,
        killed: false,
        signal: null,
        success: false,
      };
    }

    const ext = extension;
    const scriptArgs = validateScriptArgs(options?.args);

    let createdTempDir: string | null = null;
    try {
      const secureTempDir = await fs.mkdtemp(path.join(os.tmpdir(), "iliagpt-script-"));
      await fs.chmod(secureTempDir, 0o700);
      const secureScriptFile = path.join(secureTempDir, `script-${randomUUID().slice(0, 8)}.${ext}`);
      await fs.writeFile(secureScriptFile, safeCode, { mode: 0o600 });

      createdTempDir = secureTempDir;
      const args = [secureScriptFile, ...scriptArgs];
      return await this.executeCommand(sessionId, {
        command: interpreter.command,
        args: interpreter.args ? [...interpreter.args, ...args] : args,
        timeout,
        idempotencyKey: buildDeterministicIdempotencyKey(
          `script-${normalizedLanguage}`,
          `${sessionId}|${normalizedLanguage}|${safeCode}|${JSON.stringify(scriptArgs)}|${timeout}`
        ),
      });
    } finally {
      if (createdTempDir) {
        await fs.rm(createdTempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  // ============================================
  // Safety
  // ============================================

  private checkCommandSafety(command: string): { safe: boolean; reason?: string; severity?: string } {
    const trimmed = command.trim();
    if (!trimmed) {
      return { safe: false, reason: "Empty command", severity: "medium" };
    }

    for (const { pattern, reason, severity } of DANGEROUS_PATTERNS) {
      if (pattern.test(trimmed)) {
        return { safe: false, reason, severity };
      }
    }

    if (ENFORCE_COMMAND_ALLOWLIST) {
      const baseCommand = getBaseCommand(trimmed);
      if (!baseCommand || !SAFE_COMMAND_PREFIX_SET.has(baseCommand)) {
        return {
          safe: false,
          reason: `Command "${baseCommand || trimmed}" is not in the allowlist`,
          severity: "high",
        };
      }
    }

    return { safe: true };
  }

  isCommandSafe(command: string): { safe: boolean; reason?: string; severity?: string } {
    return this.checkCommandSafety(command);
  }

  // ============================================
  // History & Replay
  // ============================================

  getHistory(sessionId: string, limit: number = 50): CommandResult[] {
    const session = this.getSessionOrFail(sessionId);
    const safeLimit = Math.max(1, Math.min(limit, MAX_HISTORY_ENTRIES));
    return session.history.slice(-safeLimit);
  }

  async replayCommand(sessionId: string, commandId: string): Promise<CommandResult> {
    const session = this.getSessionOrFail(sessionId);

    const original = session.history.find(h => h.id === commandId);
    if (!original) throw new Error(`Command not found: ${commandId}`);

    return this.executeCommand(sessionId, { command: original.command });
  }

  getCwd(sessionId: string): string {
    const session = this.getSessionOrFail(sessionId);
    return session.cwd;
  }

  cleanup(): void {
    for (const id of Array.from(this.sessions.keys())) {
      this.closeSession(id);
    }
  }
}

// Singleton
export const terminalController = new TerminalController();
