import { EventEmitter } from "events";

export type HookPhase = "pre" | "post";
export type HookAction = "allow" | "block" | "modify";

export interface PreHookContext {
  toolName: string;
  args: Record<string, any>;
  userId: string;
  runId: string;
  chatId: string;
  iteration: number;
}

export interface PreHookResult {
  action: HookAction;
  reason?: string;
  modifiedArgs?: Record<string, any>;
}

export interface PostHookContext {
  toolName: string;
  args: Record<string, any>;
  result: any;
  durationMs: number;
  success: boolean;
  userId: string;
  runId: string;
  chatId: string;
  iteration: number;
}

export interface PostHookResult {
  modifiedResult?: any;
  sideEffects?: Array<{ type: string; data: any }>;
}

export type PreHookFn = (ctx: PreHookContext) => Promise<PreHookResult> | PreHookResult;
export type PostHookFn = (ctx: PostHookContext) => Promise<PostHookResult | void> | PostHookResult | void;

export interface HookRegistration {
  id: string;
  name: string;
  phase: HookPhase;
  priority: number;
  toolPattern?: string | RegExp;
  fn: PreHookFn | PostHookFn;
  enabled: boolean;
}

const DANGEROUS_SHELL_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/(?:etc|usr|var|boot|sys|proc|dev)\b/, reason: "Deleting system directories" },
  { pattern: /\bmkfs\b/, reason: "Formatting filesystem" },
  { pattern: /\bdd\s+if=/, reason: "Direct disk write" },
  { pattern: /:\(\)\s*\{.*\}\s*;/, reason: "Fork bomb detected" },
  { pattern: /\bchmod\s+(-R\s+)?777\s+\//, reason: "Recursive permission change on root" },
  { pattern: /\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/, reason: "System shutdown/reboot" },
  { pattern: /\bcurl\b.*\|\s*(ba)?sh\b/, reason: "Piping remote content to shell" },
  { pattern: /\bwget\b.*\|\s*(ba)?sh\b/, reason: "Piping remote content to shell" },
  { pattern: />\s*\/dev\/sd/, reason: "Writing to raw disk device" },
  { pattern: /\bkill\s+-9\s+1\b/, reason: "Killing init process" },
  { pattern: /\bnpm\s+publish\b/, reason: "Publishing to npm registry" },
  { pattern: /\bgit\s+push\s+.*--force\b/, reason: "Force pushing to git" },
  { pattern: /\bpasswd\b|\buseradd\b|\buserdel\b/, reason: "User account modification" },
  { pattern: /\biptables\s+-F\b/, reason: "Flushing firewall rules" },
  { pattern: /\bsudo\s+/, reason: "Privilege escalation via sudo" },
];

const DANGEROUS_PATH_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^\/etc\//, reason: "Writing to /etc system config" },
  { pattern: /^\/usr\//, reason: "Writing to /usr system directory" },
  { pattern: /^\/var\//, reason: "Writing to /var system directory" },
  { pattern: /^\/boot\//, reason: "Writing to /boot directory" },
  { pattern: /^\/dev\//, reason: "Writing to /dev directory" },
  { pattern: /^\/proc\//, reason: "Writing to /proc directory" },
  { pattern: /^\/sys\//, reason: "Writing to /sys directory" },
  { pattern: /\.env$/, reason: "Modifying environment file" },
];

function securityPreHook(ctx: PreHookContext): PreHookResult {
  if (ctx.toolName === "bash" || ctx.toolName === "shell_command") {
    const cmd = String(ctx.args.command || ctx.args.cmd || "");
    for (const { pattern, reason } of DANGEROUS_SHELL_PATTERNS) {
      if (pattern.test(cmd)) {
        return { action: "block", reason: `Security: ${reason}` };
      }
    }
  }

  if (ctx.toolName === "write_file" || ctx.toolName === "edit_file") {
    const filePath = String(ctx.args.file_path || ctx.args.filepath || ctx.args.path || "");
    for (const { pattern, reason } of DANGEROUS_PATH_PATTERNS) {
      if (pattern.test(filePath)) {
        return { action: "block", reason: `Security: ${reason}` };
      }
    }
  }

  if (ctx.toolName === "execute_code" || ctx.toolName === "run_code") {
    const code = String(ctx.args.code || "");
    if (code.length > 100000) {
      return { action: "block", reason: "Code too large (max 100KB)" };
    }
  }

  return { action: "allow" };
}

function loggingPostHook(ctx: PostHookContext): PostHookResult {
  const level = ctx.success ? "info" : "warn";
  const msg = `[HookLog] ${ctx.toolName} ${ctx.success ? "succeeded" : "failed"} in ${ctx.durationMs}ms (run=${ctx.runId}, iter=${ctx.iteration})`;
  if (level === "warn") {
    console.warn(msg);
  }
  return {};
}

function sanitizeOutputPostHook(ctx: PostHookContext): PostHookResult {
  if (!ctx.result || typeof ctx.result !== "object") return {};

  const sensitivePatterns = [
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    /\b(?:sk|pk|api|token|secret)[-_][A-Za-z0-9]{20,}\b/gi,
  ];

  const resultStr = JSON.stringify(ctx.result);
  let modified = resultStr;
  let wasModified = false;

  for (const pattern of sensitivePatterns) {
    const newStr = modified.replace(pattern, "[REDACTED]");
    if (newStr !== modified) {
      wasModified = true;
      modified = newStr;
    }
  }

  if (wasModified) {
    try {
      return { modifiedResult: JSON.parse(modified) };
    } catch {
      return {};
    }
  }

  return {};
}

export class ToolHookPipeline extends EventEmitter {
  private hooks: HookRegistration[] = [];
  private nextId = 1;

  constructor() {
    super();
    this.registerDefaults();
  }

  private registerDefaults(): void {
    this.registerPreHook({
      name: "security_guard",
      priority: 0,
      fn: securityPreHook,
    });

    this.registerPostHook({
      name: "logging",
      priority: 100,
      fn: loggingPostHook,
    });

    this.registerPostHook({
      name: "output_sanitizer",
      priority: 50,
      fn: sanitizeOutputPostHook,
    });
  }

  registerPreHook(opts: {
    name: string;
    priority?: number;
    toolPattern?: string | RegExp;
    fn: PreHookFn;
  }): string {
    const id = `hook_pre_${this.nextId++}`;
    this.hooks.push({
      id,
      name: opts.name,
      phase: "pre",
      priority: opts.priority ?? 50,
      toolPattern: opts.toolPattern,
      fn: opts.fn,
      enabled: true,
    });
    this.hooks.sort((a, b) => a.priority - b.priority);
    return id;
  }

  registerPostHook(opts: {
    name: string;
    priority?: number;
    toolPattern?: string | RegExp;
    fn: PostHookFn;
  }): string {
    const id = `hook_post_${this.nextId++}`;
    this.hooks.push({
      id,
      name: opts.name,
      phase: "post",
      priority: opts.priority ?? 50,
      toolPattern: opts.toolPattern,
      fn: opts.fn,
      enabled: true,
    });
    this.hooks.sort((a, b) => a.priority - b.priority);
    return id;
  }

  unregister(hookId: string): boolean {
    const idx = this.hooks.findIndex(h => h.id === hookId);
    if (idx >= 0) {
      this.hooks.splice(idx, 1);
      return true;
    }
    return false;
  }

  setEnabled(hookId: string, enabled: boolean): boolean {
    const hook = this.hooks.find(h => h.id === hookId);
    if (hook) {
      hook.enabled = enabled;
      return true;
    }
    return false;
  }

  private matchesTool(hook: HookRegistration, toolName: string): boolean {
    if (!hook.toolPattern) return true;
    if (typeof hook.toolPattern === "string") {
      return hook.toolPattern === toolName || hook.toolPattern === "*";
    }
    return hook.toolPattern.test(toolName);
  }

  async runPreHooks(ctx: PreHookContext): Promise<PreHookResult> {
    const applicableHooks = this.hooks.filter(
      h => h.phase === "pre" && h.enabled && this.matchesTool(h, ctx.toolName)
    );

    let currentArgs = { ...ctx.args };

    for (const hook of applicableHooks) {
      try {
        const result = await (hook.fn as PreHookFn)({ ...ctx, args: currentArgs });

        if (result.action === "block") {
          this.emit("hook:blocked", {
            hookName: hook.name,
            toolName: ctx.toolName,
            reason: result.reason,
            runId: ctx.runId,
          });
          return result;
        }

        if (result.action === "modify" && result.modifiedArgs) {
          currentArgs = result.modifiedArgs;
        }
      } catch (err: any) {
        console.error(`[ToolHooks] Pre-hook "${hook.name}" error:`, err.message);
      }
    }

    return { action: "allow", modifiedArgs: currentArgs };
  }

  async runPostHooks(ctx: PostHookContext): Promise<any> {
    const applicableHooks = this.hooks.filter(
      h => h.phase === "post" && h.enabled && this.matchesTool(h, ctx.toolName)
    );

    let currentResult = ctx.result;

    for (const hook of applicableHooks) {
      try {
        const hookResult = await (hook.fn as PostHookFn)({ ...ctx, result: currentResult });
        const hr = hookResult as PostHookResult | undefined;
        if (hr?.modifiedResult !== undefined) {
          currentResult = hr.modifiedResult;
        }
        if (hr?.sideEffects) {
          for (const effect of hr.sideEffects) {
            this.emit("hook:side_effect", {
              hookName: hook.name,
              toolName: ctx.toolName,
              effect,
            });
          }
        }
      } catch (err: any) {
        console.error(`[ToolHooks] Post-hook "${hook.name}" error:`, err.message);
      }
    }

    return currentResult;
  }

  listHooks(): Array<{ id: string; name: string; phase: HookPhase; priority: number; enabled: boolean }> {
    return this.hooks.map(h => ({
      id: h.id,
      name: h.name,
      phase: h.phase,
      priority: h.priority,
      enabled: h.enabled,
    }));
  }

  getStats(): { total: number; pre: number; post: number; enabled: number; disabled: number } {
    return {
      total: this.hooks.length,
      pre: this.hooks.filter(h => h.phase === "pre").length,
      post: this.hooks.filter(h => h.phase === "post").length,
      enabled: this.hooks.filter(h => h.enabled).length,
      disabled: this.hooks.filter(h => !h.enabled).length,
    };
  }
}

export const toolHookPipeline = new ToolHookPipeline();
