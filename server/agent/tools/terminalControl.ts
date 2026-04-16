/**
 * Terminal & Desktop Control Tools — Secure execution with RBAC and audit.
 *
 * Terminal Control:
 *   - Execute commands via local shell (Bash/Zsh on Linux/Mac, PowerShell on Windows)
 *   - Command allowlist/denylist with pattern matching
 *   - Audit logging for every execution
 *   - Timeout and resource limits
 *
 * Desktop Control:
 *   - Abstracted UI element model (role, name, value, bounds, state)
 *   - Platform detection for correct backend (UIA / AXUIElement / AT-SPI)
 *   - Actions: click, setValue, select, invoke, focus, scroll
 */

import { z } from "zod";
import { randomUUID } from "crypto";

/* ================================================================== */
/*  RBAC                                                              */
/* ================================================================== */

export type RbacRole = "viewer" | "operator" | "admin";

export interface RbacScope {
  "terminal.read_logs": boolean;
  "terminal.exec_safe": boolean;
  "terminal.exec_any": boolean;
  "file.read": boolean;
  "file.write": boolean;
  "file.delete": boolean;
  "desktop.read": boolean;
  "desktop.interact": boolean;
  "desktop.admin": boolean;
}

const ROLE_SCOPES: Record<RbacRole, RbacScope> = {
  viewer: {
    "terminal.read_logs": true,
    "terminal.exec_safe": false,
    "terminal.exec_any": false,
    "file.read": true,
    "file.write": false,
    "file.delete": false,
    "desktop.read": true,
    "desktop.interact": false,
    "desktop.admin": false,
  },
  operator: {
    "terminal.read_logs": true,
    "terminal.exec_safe": true,
    "terminal.exec_any": false,
    "file.read": true,
    "file.write": true,
    "file.delete": false,
    "desktop.read": true,
    "desktop.interact": true,
    "desktop.admin": false,
  },
  admin: {
    "terminal.read_logs": true,
    "terminal.exec_safe": true,
    "terminal.exec_any": true,
    "file.read": true,
    "file.write": true,
    "file.delete": true,
    "desktop.read": true,
    "desktop.interact": true,
    "desktop.admin": true,
  },
};

export function hasPermission(role: RbacRole, scope: keyof RbacScope): boolean {
  return ROLE_SCOPES[role]?.[scope] ?? false;
}

/* ================================================================== */
/*  AUDIT LOG                                                         */
/* ================================================================== */

export interface AuditEntry {
  id: string;
  timestamp: number;
  userId: string;
  role: RbacRole;
  action: string;
  command?: string;
  host: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs: number;
  taskCorrelationId?: string;
  allowed: boolean;
  deniedReason?: string;
}

class AuditLogger {
  private entries: AuditEntry[] = [];
  private maxEntries = 10_000;

  log(entry: AuditEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    const level = entry.allowed ? "info" : "warn";
    console[level](
      `[Audit] ${entry.action} by ${entry.userId}(${entry.role}) on ${entry.host}` +
      `${entry.command ? ` cmd="${entry.command.slice(0, 100)}"` : ""}` +
      `${entry.exitCode !== undefined ? ` exit=${entry.exitCode}` : ""}` +
      ` allowed=${entry.allowed}` +
      `${entry.deniedReason ? ` reason="${entry.deniedReason}"` : ""}` +
      ` ${entry.durationMs}ms`
    );
  }

  getEntries(filter?: { userId?: string; action?: string; limit?: number }): AuditEntry[] {
    let results = [...this.entries];
    if (filter?.userId) results = results.filter((e) => e.userId === filter.userId);
    if (filter?.action) results = results.filter((e) => e.action === filter.action);
    results.reverse(); // newest first
    if (filter?.limit) results = results.slice(0, filter.limit);
    return results;
  }
}

export const auditLogger = new AuditLogger();

/* ================================================================== */
/*  COMMAND POLICY                                                    */
/* ================================================================== */

export interface CommandPolicy {
  /** Patterns that are always allowed (for safe-exec role). */
  allowPatterns: RegExp[];
  /** Patterns that are always denied (takes precedence). */
  denyPatterns: RegExp[];
  /** If true, require human confirmation for unmatched commands. */
  requireConfirmationForUnknown: boolean;
  /** Maximum command execution time (ms). */
  maxTimeoutMs: number;
  /** Maximum output size (bytes). */
  maxOutputBytes: number;
}

const DEFAULT_POLICY: CommandPolicy = {
  allowPatterns: [
    /^(ls|dir|pwd|whoami|hostname|date|uptime|df|free|top|htop|ps|cat|head|tail|less|more|wc|sort|uniq|grep|find|which|echo|env|printenv)(\s|$)/,
    /^git\s+(status|log|diff|branch|show|remote|tag|stash\s+list)/,
    /^docker\s+(ps|images|logs|inspect|stats)/,
    /^npm\s+(list|ls|outdated|audit|version|run\s+test|run\s+lint)/,
    /^node\s+--version/,
    /^python3?\s+(--version|-c\s+")/,
    /^systemctl\s+(status|list-units|is-active)/,
    /^curl\s+(-s\s+)?https?:\/\//,
  ],
  denyPatterns: [
    /\brm\s+(-rf?|--force|--recursive)\s+\//,
    /\bformat\b/i,
    /\bmkfs\b/,
    /\bdd\s+if=/,
    /\b(shutdown|reboot|halt|poweroff)\b/,
    /\b(chmod\s+777|chmod\s+-R\s+777)/,
    /\bsudo\s+(rm|dd|mkfs|format|shutdown|reboot)/,
    />\s*\/dev\/(sda|nvme|disk)/,
    /\biptables\s+-F/,
    /\b(curl|wget).*\|\s*(bash|sh|zsh)/,
  ],
  requireConfirmationForUnknown: true,
  maxTimeoutMs: 60_000,
  maxOutputBytes: 1_048_576, // 1MB
};

export function evaluateCommand(
  command: string,
  role: RbacRole,
  policy: CommandPolicy = DEFAULT_POLICY
): { allowed: boolean; requiresConfirmation: boolean; reason?: string } {
  // Viewer can never execute commands — check first
  if (role === "viewer") {
    return { allowed: false, requiresConfirmation: false, reason: "Viewer role cannot execute commands" };
  }

  // Deny patterns always take precedence
  for (const pattern of policy.denyPatterns) {
    if (pattern.test(command)) {
      return { allowed: false, requiresConfirmation: false, reason: `Command matches deny pattern: ${pattern}` };
    }
  }

  // Admin can execute anything not denied
  if (role === "admin") {
    return { allowed: true, requiresConfirmation: false };
  }

  // Check allow patterns for safe-exec
  for (const pattern of policy.allowPatterns) {
    if (pattern.test(command)) {
      return { allowed: true, requiresConfirmation: false };
    }
  }

  // Operator with unknown command → may require confirmation
  if (policy.requireConfirmationForUnknown) {
    return { allowed: true, requiresConfirmation: true, reason: "Command not in allowlist — requires confirmation" };
  }

  return { allowed: false, requiresConfirmation: false, reason: "Command not in allowlist" };
}

/* ================================================================== */
/*  TERMINAL TOOL                                                     */
/* ================================================================== */

export const TerminalExecSchema = z.object({
  tool: z.literal("terminal.exec"),
  command: z.string().min(1).max(2000),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  timeout: z.number().int().positive().max(300_000).default(60_000),
  userId: z.string(),
  role: z.enum(["viewer", "operator", "admin"]).default("operator"),
  taskCorrelationId: z.string().optional(),
  confirmed: z.boolean().default(false),
});

export const TerminalReadLogsSchema = z.object({
  tool: z.literal("terminal.read_logs"),
  logPath: z.string(),
  lines: z.number().int().positive().max(1000).default(100),
  userId: z.string(),
  role: z.enum(["viewer", "operator", "admin"]).default("viewer"),
});

export interface TerminalResult {
  success: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  truncated: boolean;
  requiresConfirmation?: boolean;
  error?: string;
}

export class TerminalController {
  private policy: CommandPolicy;
  private hostname: string;

  constructor(policy?: Partial<CommandPolicy>) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
    this.hostname = process.env.HOSTNAME || "localhost";
  }

  async execute(input: z.infer<typeof TerminalExecSchema>): Promise<TerminalResult> {
    const parsed = TerminalExecSchema.parse(input);
    const start = Date.now();

    // RBAC check
    const scope = parsed.role === "admin" ? "terminal.exec_any" : "terminal.exec_safe";
    if (!hasPermission(parsed.role as RbacRole, scope as keyof RbacScope)) {
      const entry: AuditEntry = {
        id: randomUUID(),
        timestamp: Date.now(),
        userId: parsed.userId,
        role: parsed.role as RbacRole,
        action: "terminal.exec",
        command: parsed.command,
        host: this.hostname,
        durationMs: 0,
        allowed: false,
        deniedReason: "Insufficient permissions",
        taskCorrelationId: parsed.taskCorrelationId,
      };
      auditLogger.log(entry);

      return {
        success: false,
        command: parsed.command,
        stdout: "",
        stderr: "",
        exitCode: -1,
        durationMs: 0,
        truncated: false,
        error: "Insufficient permissions",
      };
    }

    // Policy check
    const evaluation = evaluateCommand(parsed.command, parsed.role as RbacRole, this.policy);

    if (!evaluation.allowed) {
      auditLogger.log({
        id: randomUUID(),
        timestamp: Date.now(),
        userId: parsed.userId,
        role: parsed.role as RbacRole,
        action: "terminal.exec",
        command: parsed.command,
        host: this.hostname,
        durationMs: 0,
        allowed: false,
        deniedReason: evaluation.reason,
        taskCorrelationId: parsed.taskCorrelationId,
      });

      return {
        success: false,
        command: parsed.command,
        stdout: "",
        stderr: "",
        exitCode: -1,
        durationMs: 0,
        truncated: false,
        error: evaluation.reason || "Command denied by policy",
      };
    }

    if (evaluation.requiresConfirmation && !parsed.confirmed) {
      return {
        success: false,
        command: parsed.command,
        stdout: "",
        stderr: "",
        exitCode: -1,
        durationMs: 0,
        truncated: false,
        requiresConfirmation: true,
        error: "Command requires human confirmation",
      };
    }

    // Execute command
    try {
      const { execFileSync } = require("child_process");
      const result = execFileSync("/bin/bash", ["-c", parsed.command], {
        cwd: parsed.cwd || process.cwd(),
        env: { ...process.env, ...parsed.env },
        timeout: Math.min(parsed.timeout, this.policy.maxTimeoutMs),
        maxBuffer: this.policy.maxOutputBytes,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });

      const stdout = typeof result === "string" ? result : result?.toString() || "";
      const truncated = stdout.length >= this.policy.maxOutputBytes;
      const durationMs = Date.now() - start;

      auditLogger.log({
        id: randomUUID(),
        timestamp: Date.now(),
        userId: parsed.userId,
        role: parsed.role as RbacRole,
        action: "terminal.exec",
        command: parsed.command,
        host: this.hostname,
        exitCode: 0,
        stdout: stdout.slice(0, 500),
        durationMs,
        allowed: true,
        taskCorrelationId: parsed.taskCorrelationId,
      });

      return {
        success: true,
        command: parsed.command,
        stdout: truncated ? stdout.slice(0, this.policy.maxOutputBytes) : stdout,
        stderr: "",
        exitCode: 0,
        durationMs,
        truncated,
      };
    } catch (err: any) {
      const durationMs = Date.now() - start;

      auditLogger.log({
        id: randomUUID(),
        timestamp: Date.now(),
        userId: parsed.userId,
        role: parsed.role as RbacRole,
        action: "terminal.exec",
        command: parsed.command,
        host: this.hostname,
        exitCode: err.status || -1,
        stderr: (err.stderr || err.message || "").slice(0, 500),
        durationMs,
        allowed: true,
        taskCorrelationId: parsed.taskCorrelationId,
      });

      return {
        success: false,
        command: parsed.command,
        stdout: err.stdout?.toString() || "",
        stderr: err.stderr?.toString() || err.message || "",
        exitCode: err.status || -1,
        durationMs,
        truncated: false,
        error: err.message,
      };
    }
  }
}

/* ================================================================== */
/*  DESKTOP CONTROL (Abstracted Model)                                */
/* ================================================================== */

export type DesktopPlatform = "windows" | "macos" | "linux" | "unknown";

export interface UIElement {
  id: string;
  role: string;
  name: string;
  value?: string;
  bounds: { x: number; y: number; width: number; height: number };
  state: {
    enabled: boolean;
    visible: boolean;
    focused: boolean;
    selected?: boolean;
    checked?: boolean;
  };
  children?: UIElement[];
}

export type DesktopAction =
  | { action: "click"; elementId: string; button?: "left" | "right" }
  | { action: "doubleClick"; elementId: string }
  | { action: "setValue"; elementId: string; value: string }
  | { action: "select"; elementId: string; option: string }
  | { action: "invoke"; elementId: string }
  | { action: "focus"; elementId: string }
  | { action: "scroll"; elementId: string; direction: "up" | "down"; amount: number }
  | { action: "keyPress"; keys: string[] }
  | { action: "screenshot" }
  | { action: "findElement"; query: { role?: string; name?: string; value?: string } };

export interface DesktopActionResult {
  success: boolean;
  action: string;
  element?: UIElement;
  elements?: UIElement[];
  screenshot?: string;
  error?: string;
  durationMs: number;
}

export function detectPlatform(): DesktopPlatform {
  const platform = process.platform;
  switch (platform) {
    case "win32": return "windows";
    case "darwin": return "macos";
    case "linux": return "linux";
    default: return "unknown";
  }
}

/**
 * Desktop Controller — Platform-abstracted UI automation.
 *
 * Note: actual platform integrations (UIA, AXUIElement, AT-SPI) require
 * native modules. This provides the unified interface and routing layer.
 * Native implementations would be injected via platform-specific adapters.
 */
export class DesktopController {
  private platform: DesktopPlatform;

  constructor() {
    this.platform = detectPlatform();
  }

  getPlatform(): DesktopPlatform {
    return this.platform;
  }

  /**
   * Execute a desktop UI action.
   *
   * Currently provides the interface contract. Platform-specific backends
   * (UIA for Windows, AXUIElement for macOS, AT-SPI for Linux) would be
   * connected here via native adapters.
   */
  async execute(
    action: DesktopAction,
    userId: string,
    role: RbacRole
  ): Promise<DesktopActionResult> {
    const start = Date.now();

    // RBAC check
    const requiredScope = action.action === "screenshot" || action.action === "findElement"
      ? "desktop.read"
      : "desktop.interact";

    if (!hasPermission(role, requiredScope as keyof RbacScope)) {
      auditLogger.log({
        id: randomUUID(),
        timestamp: Date.now(),
        userId,
        role,
        action: `desktop.${action.action}`,
        host: process.env.HOSTNAME || "localhost",
        durationMs: 0,
        allowed: false,
        deniedReason: "Insufficient desktop permissions",
      });

      return {
        success: false,
        action: action.action,
        error: "Insufficient desktop permissions",
        durationMs: 0,
      };
    }

    auditLogger.log({
      id: randomUUID(),
      timestamp: Date.now(),
      userId,
      role,
      action: `desktop.${action.action}`,
      host: process.env.HOSTNAME || "localhost",
      durationMs: Date.now() - start,
      allowed: true,
    });

    // Route to platform-specific implementation
    switch (this.platform) {
      case "windows":
        return this.executeWindows(action, start);
      case "macos":
        return this.executeMacOS(action, start);
      case "linux":
        return this.executeLinux(action, start);
      default:
        return {
          success: false,
          action: action.action,
          error: `Desktop automation not supported on platform: ${this.platform}`,
          durationMs: Date.now() - start,
        };
    }
  }

  /* Platform stubs — these would be replaced by native adapters */

  private async executeWindows(action: DesktopAction, start: number): Promise<DesktopActionResult> {
    // Windows: would use UI Automation (UIA) via native bindings
    return {
      success: false,
      action: action.action,
      error: "Windows UIA adapter not yet connected. Install platform-specific native module.",
      durationMs: Date.now() - start,
    };
  }

  private async executeMacOS(action: DesktopAction, start: number): Promise<DesktopActionResult> {
    // macOS: would use AXUIElement via native bindings
    return {
      success: false,
      action: action.action,
      error: "macOS Accessibility adapter not yet connected. Install platform-specific native module.",
      durationMs: Date.now() - start,
    };
  }

  private async executeLinux(action: DesktopAction, start: number): Promise<DesktopActionResult> {
    // Linux: would use AT-SPI via native bindings
    // For screenshot on Linux, we can use xdotool/scrot as fallback
    if (action.action === "screenshot") {
      try {
        const { execFileSync } = require("child_process");
        const tmpFile = `/tmp/desktop-screenshot-${randomUUID()}.png`;
        execFileSync("import", ["-window", "root", tmpFile], { timeout: 10_000, stdio: "pipe" });

        const fs = require("fs");
        const buffer = fs.readFileSync(tmpFile);
        const screenshot = `data:image/png;base64,${buffer.toString("base64")}`;
        fs.unlinkSync(tmpFile);

        return {
          success: true,
          action: "screenshot",
          screenshot,
          durationMs: Date.now() - start,
        };
      } catch {
        return {
          success: false,
          action: "screenshot",
          error: "Screenshot capture failed. Ensure ImageMagick is installed (import command).",
          durationMs: Date.now() - start,
        };
      }
    }

    return {
      success: false,
      action: action.action,
      error: "Linux AT-SPI adapter not yet connected. Install platform-specific native module.",
      durationMs: Date.now() - start,
    };
  }
}
