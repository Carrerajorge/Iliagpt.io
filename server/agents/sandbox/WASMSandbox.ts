import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import pino from "pino";

const logger = pino({ name: "WASMSandbox" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type SandboxStatus = "idle" | "running" | "suspended" | "terminated" | "error";

export interface SandboxPermissions {
  filesystem: "none" | "readonly" | "readwrite";
  /** Allowed hostnames for network. Empty = no network. */
  networkAllowlist: string[];
  /** Max heap memory in bytes */
  maxMemoryBytes: number;
  /** Max CPU time per call in ms */
  maxCpuTimeMs: number;
  /** Allow reading environment variables */
  allowEnvAccess: boolean;
  /** Allow spawning child processes */
  allowChildProcesses: boolean;
  /** Allow timer APIs (setTimeout etc.) */
  allowTimers: boolean;
  /** Custom capability flags */
  custom: Record<string, boolean>;
}

export const PERMISSION_PRESETS: Record<string, SandboxPermissions> = {
  minimal: {
    filesystem: "none",
    networkAllowlist: [],
    maxMemoryBytes: 32 * 1024 * 1024, // 32 MB
    maxCpuTimeMs: 5_000,
    allowEnvAccess: false,
    allowChildProcesses: false,
    allowTimers: false,
    custom: {},
  },
  standard: {
    filesystem: "readonly",
    networkAllowlist: [],
    maxMemoryBytes: 128 * 1024 * 1024, // 128 MB
    maxCpuTimeMs: 30_000,
    allowEnvAccess: false,
    allowChildProcesses: false,
    allowTimers: true,
    custom: {},
  },
  trusted: {
    filesystem: "readwrite",
    networkAllowlist: ["https://api.openai.com", "https://api.anthropic.com"],
    maxMemoryBytes: 512 * 1024 * 1024, // 512 MB
    maxCpuTimeMs: 120_000,
    allowEnvAccess: false,
    allowChildProcesses: false,
    allowTimers: true,
    custom: {},
  },
  admin: {
    filesystem: "readwrite",
    networkAllowlist: ["*"],
    maxMemoryBytes: 2 * 1024 * 1024 * 1024, // 2 GB
    maxCpuTimeMs: 600_000,
    allowEnvAccess: true,
    allowChildProcesses: true,
    allowTimers: true,
    custom: {},
  },
};

export interface SandboxCall {
  callId: string;
  functionName: string;
  args: unknown[];
  timeoutMs?: number;
}

export interface SandboxResult {
  callId: string;
  success: boolean;
  returnValue?: unknown;
  error?: string;
  durationMs: number;
  memoryUsedBytes?: number;
  interceptedSyscalls: string[];
}

export interface SandboxStats {
  sandboxId: string;
  status: SandboxStatus;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalCpuTimeMs: number;
  peakMemoryBytes: number;
  interceptedSyscalls: Record<string, number>;
  createdAt: number;
  lastCallAt?: number;
}

export interface HostFunction {
  name: string;
  /** Called when the WASM module invokes this host function */
  handler: (...args: unknown[]) => unknown | Promise<unknown>;
  /** Whether to log each call */
  audit?: boolean;
}

// ─── Syscall interceptor ──────────────────────────────────────────────────────

type SyscallName =
  | "readFile"
  | "writeFile"
  | "fetchUrl"
  | "spawnProcess"
  | "getEnv"
  | "setTimeout"
  | "setInterval"
  | "consoleLog"
  | "consoleError";

class SyscallInterceptor {
  private interceptedCounts = new Map<string, number>();

  constructor(
    private readonly permissions: SandboxPermissions,
    private readonly sandboxId: string
  ) {}

  intercept(syscall: SyscallName, args: unknown[]): unknown {
    this.interceptedCounts.set(
      syscall,
      (this.interceptedCounts.get(syscall) ?? 0) + 1
    );

    switch (syscall) {
      case "readFile":
        return this.interceptReadFile(args[0] as string);
      case "writeFile":
        return this.interceptWriteFile(args[0] as string, args[1] as string);
      case "fetchUrl":
        return this.interceptFetchUrl(args[0] as string);
      case "spawnProcess":
        return this.interceptSpawnProcess();
      case "getEnv":
        return this.interceptGetEnv(args[0] as string);
      case "setTimeout":
        return this.interceptTimer();
      case "setInterval":
        return this.interceptTimer();
      case "consoleLog":
        logger.info({ sandboxId: this.sandboxId }, `[Sandbox] ${args.join(" ")}`);
        return undefined;
      case "consoleError":
        logger.warn({ sandboxId: this.sandboxId }, `[Sandbox:err] ${args.join(" ")}`);
        return undefined;
      default:
        throw new Error(`Unknown syscall: ${syscall}`);
    }
  }

  private interceptReadFile(path: string): never {
    if (this.permissions.filesystem === "none") {
      throw new Error(`SANDBOX_VIOLATION: readFile('${path}') denied — filesystem access is 'none'`);
    }
    // In real implementation, this would call the host's FS with path validation
    throw new Error(`SANDBOX_VIOLATION: readFile not implemented in sandboxed context`);
  }

  private interceptWriteFile(path: string, _content: string): never {
    if (this.permissions.filesystem !== "readwrite") {
      throw new Error(
        `SANDBOX_VIOLATION: writeFile('${path}') denied — filesystem is '${this.permissions.filesystem}'`
      );
    }
    throw new Error(`SANDBOX_VIOLATION: writeFile not implemented in sandboxed context`);
  }

  private interceptFetchUrl(url: string): never {
    if (!this.permissions.networkAllowlist.length) {
      throw new Error(`SANDBOX_VIOLATION: fetch('${url}') denied — no network allowlist`);
    }
    if (
      this.permissions.networkAllowlist[0] !== "*" &&
      !this.permissions.networkAllowlist.some((allowed) => url.startsWith(allowed))
    ) {
      throw new Error(
        `SANDBOX_VIOLATION: fetch('${url}') denied — not in allowlist`
      );
    }
    throw new Error(`SANDBOX_VIOLATION: fetchUrl not implemented in sandboxed context`);
  }

  private interceptSpawnProcess(): never {
    if (!this.permissions.allowChildProcesses) {
      throw new Error(`SANDBOX_VIOLATION: spawnProcess denied`);
    }
    throw new Error(`SANDBOX_VIOLATION: spawnProcess not implemented in sandboxed context`);
  }

  private interceptGetEnv(key: string): string | undefined {
    if (!this.permissions.allowEnvAccess) {
      throw new Error(`SANDBOX_VIOLATION: getEnv('${key}') denied`);
    }
    return undefined; // Don't expose real env vars
  }

  private interceptTimer(): never {
    if (!this.permissions.allowTimers) {
      throw new Error(`SANDBOX_VIOLATION: timer APIs denied`);
    }
    throw new Error(`SANDBOX_VIOLATION: timer not implemented in sandboxed context`);
  }

  getCounts(): Record<string, number> {
    return Object.fromEntries(this.interceptedCounts);
  }

  getTotalIntercepted(): number {
    let total = 0;
    for (const v of this.interceptedCounts.values()) total += v;
    return total;
  }
}

// ─── WASMSandbox ──────────────────────────────────────────────────────────────

export class WASMSandbox extends EventEmitter {
  private readonly sandboxId: string;
  private status: SandboxStatus = "idle";
  private readonly interceptor: SyscallInterceptor;
  private wasmInstance: WebAssembly.Instance | null = null;
  private wasmMemory: WebAssembly.Memory | null = null;

  private stats: SandboxStats;
  private hostFunctions = new Map<string, HostFunction>();

  constructor(
    private readonly agentId: string,
    private readonly permissions: SandboxPermissions
  ) {
    super();
    this.sandboxId = randomUUID();
    this.interceptor = new SyscallInterceptor(permissions, this.sandboxId);

    this.stats = {
      sandboxId: this.sandboxId,
      status: "idle",
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      totalCpuTimeMs: 0,
      peakMemoryBytes: 0,
      interceptedSyscalls: {},
      createdAt: Date.now(),
    };

    logger.info(
      { sandboxId: this.sandboxId, agentId, permissionLevel: this.getPermissionLevel() },
      "[WASMSandbox] Sandbox created"
    );
  }

  // ── WASM loading ──────────────────────────────────────────────────────────────

  async loadWASM(
    wasmBytes: Uint8Array,
    additionalHostFunctions: HostFunction[] = []
  ): Promise<void> {
    if (this.status !== "idle") {
      throw new Error(`Cannot load WASM: sandbox is ${this.status}`);
    }

    // Register host functions
    for (const fn of additionalHostFunctions) {
      this.hostFunctions.set(fn.name, fn);
    }

    const imports = this.buildImports();

    try {
      const module = await WebAssembly.compile(wasmBytes);
      this.wasmMemory = new WebAssembly.Memory({
        initial: Math.ceil(this.permissions.maxMemoryBytes / (64 * 1024)),
        maximum: Math.ceil(this.permissions.maxMemoryBytes / (64 * 1024)),
      });

      this.wasmInstance = await WebAssembly.instantiate(module, {
        ...imports,
        env: { memory: this.wasmMemory, ...imports.env },
      });

      logger.info({ sandboxId: this.sandboxId }, "[WASMSandbox] WASM module loaded");
      this.emit("wasm:loaded", { sandboxId: this.sandboxId });
    } catch (err) {
      this.status = "error";
      throw new Error(
        `Failed to load WASM module: ${(err as Error).message}`
      );
    }
  }

  // ── Execution ─────────────────────────────────────────────────────────────────

  async call(sandboxCall: SandboxCall): Promise<SandboxResult> {
    const { callId, functionName, args, timeoutMs } = sandboxCall;
    const effectiveTimeout = Math.min(
      timeoutMs ?? this.permissions.maxCpuTimeMs,
      this.permissions.maxCpuTimeMs
    );

    if (this.status === "terminated") {
      return {
        callId,
        success: false,
        error: "Sandbox has been terminated",
        durationMs: 0,
        interceptedSyscalls: [],
      };
    }

    const startMs = Date.now();
    this.status = "running";
    this.stats.totalCalls++;
    this.stats.lastCallAt = startMs;

    const interceptedBefore = this.interceptor.getTotalIntercepted();

    return new Promise<SandboxResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.status = "error";
        this.stats.failedCalls++;
        const durationMs = Date.now() - startMs;

        logger.warn(
          { sandboxId: this.sandboxId, functionName, durationMs },
          "[WASMSandbox] Call timed out"
        );

        resolve({
          callId,
          success: false,
          error: `Function '${functionName}' timed out after ${effectiveTimeout}ms`,
          durationMs,
          interceptedSyscalls: Object.keys(this.interceptor.getCounts()),
        });
      }, effectiveTimeout);

      try {
        if (!this.wasmInstance) {
          // Fallback: execute as JavaScript host function
          const hostFn = this.hostFunctions.get(functionName);
          if (!hostFn) {
            throw new Error(
              `Function '${functionName}' not found in WASM instance or host functions`
            );
          }

          const returnValuePromise = hostFn.handler(...args);
          Promise.resolve(returnValuePromise).then((returnValue) => {
            clearTimeout(timeout);
            const durationMs = Date.now() - startMs;
            this.status = "idle";
            this.stats.successfulCalls++;
            this.stats.totalCpuTimeMs += durationMs;
            this.stats.interceptedSyscalls = this.interceptor.getCounts();
            const newInterceptions = this.interceptor.getTotalIntercepted() - interceptedBefore;

            if (hostFn.audit) {
              logger.info(
                { sandboxId: this.sandboxId, functionName, durationMs },
                "[WASMSandbox] Host function executed"
              );
            }

            resolve({
              callId,
              success: true,
              returnValue,
              durationMs,
              memoryUsedBytes: this.getMemoryUsage(),
              interceptedSyscalls: Object.keys(
                Object.fromEntries(
                  Object.entries(this.interceptor.getCounts()).filter(([, v]) => v > 0)
                )
              ),
            });
          }).catch((err) => {
            clearTimeout(timeout);
            const durationMs = Date.now() - startMs;
            this.status = "idle";
            this.stats.failedCalls++;

            const isSandboxViolation = (err as Error).message.startsWith("SANDBOX_VIOLATION:");
            if (isSandboxViolation) {
              logger.warn(
                { sandboxId: this.sandboxId, error: (err as Error).message },
                "[WASMSandbox] Sandbox violation"
              );
              this.emit("sandbox:violation", {
                sandboxId: this.sandboxId,
                functionName,
                error: (err as Error).message,
              });
            }

            resolve({
              callId,
              success: false,
              error: (err as Error).message,
              durationMs,
              interceptedSyscalls: Object.keys(this.interceptor.getCounts()),
            });
          });
        } else {
          // WASM instance call
          const exports = this.wasmInstance.exports as Record<string, Function>;
          const fn = exports[functionName];
          if (typeof fn !== "function") {
            throw new Error(`WASM export '${functionName}' is not a function`);
          }

          const returnValue = fn(...(args as Parameters<typeof fn>));
          clearTimeout(timeout);
          const durationMs = Date.now() - startMs;
          this.status = "idle";
          this.stats.successfulCalls++;
          this.stats.totalCpuTimeMs += durationMs;

          const memUsed = this.getMemoryUsage();
          if (memUsed > this.stats.peakMemoryBytes) {
            this.stats.peakMemoryBytes = memUsed;
          }

          if (memUsed > this.permissions.maxMemoryBytes) {
            logger.error(
              { sandboxId: this.sandboxId, memUsed, limit: this.permissions.maxMemoryBytes },
              "[WASMSandbox] Memory limit exceeded"
            );
            this.terminate("Memory limit exceeded");
          }

          resolve({
            callId,
            success: true,
            returnValue,
            durationMs,
            memoryUsedBytes: memUsed,
            interceptedSyscalls: [],
          });
        }
      } catch (err) {
        clearTimeout(timeout);
        const durationMs = Date.now() - startMs;
        this.status = "idle";
        this.stats.failedCalls++;

        resolve({
          callId,
          success: false,
          error: (err as Error).message,
          durationMs,
          interceptedSyscalls: Object.keys(this.interceptor.getCounts()),
        });
      }
    });
  }

  // ── WASM import builder ───────────────────────────────────────────────────────

  private buildImports(): WebAssembly.Imports {
    const interceptor = this.interceptor;

    const env: Record<string, WebAssembly.ExportValue> = {
      // Standard syscalls
      abort: (_msg: number, _file: number, _line: number, _col: number) => {
        throw new Error("WASM abort called");
      },
      read_file: (ptr: number) => {
        interceptor.intercept("readFile", [this.readString(ptr)]);
        return 0;
      },
      write_file: (pathPtr: number, contentPtr: number) => {
        interceptor.intercept("writeFile", [
          this.readString(pathPtr),
          this.readString(contentPtr),
        ]);
        return 0;
      },
      fetch_url: (urlPtr: number) => {
        interceptor.intercept("fetchUrl", [this.readString(urlPtr)]);
        return 0;
      },
      get_env: (keyPtr: number) => {
        interceptor.intercept("getEnv", [this.readString(keyPtr)]);
        return 0;
      },
      console_log: (msgPtr: number) => {
        interceptor.intercept("consoleLog", [this.readString(msgPtr)]);
      },
      console_error: (msgPtr: number) => {
        interceptor.intercept("consoleError", [this.readString(msgPtr)]);
      },
    };

    // Register custom host functions
    for (const [name, fn] of this.hostFunctions.entries()) {
      env[name] = (...args: unknown[]) => {
        if (fn.audit) {
          logger.info({ sandboxId: this.sandboxId, fn: name, args }, "[WASMSandbox] Host fn called");
        }
        return fn.handler(...args);
      };
    }

    return { env };
  }

  private readString(ptr: number): string {
    if (!this.wasmMemory) return "";
    const mem = new Uint8Array(this.wasmMemory.buffer);
    let str = "";
    let i = ptr;
    while (i < mem.length && mem[i] !== 0) {
      str += String.fromCharCode(mem[i++]);
    }
    return str;
  }

  // ── Control ────────────────────────────────────────────────────────────────────

  suspend(): void {
    if (this.status !== "idle") {
      logger.warn({ sandboxId: this.sandboxId, status: this.status }, "[WASMSandbox] Cannot suspend non-idle sandbox");
      return;
    }
    this.status = "suspended";
    this.emit("sandbox:suspended", { sandboxId: this.sandboxId });
  }

  resume(): void {
    if (this.status !== "suspended") return;
    this.status = "idle";
    this.emit("sandbox:resumed", { sandboxId: this.sandboxId });
  }

  terminate(reason = "Explicit termination"): void {
    this.status = "terminated";
    this.wasmInstance = null;
    this.wasmMemory = null;
    this.stats.interceptedSyscalls = this.interceptor.getCounts();

    logger.info(
      { sandboxId: this.sandboxId, reason },
      "[WASMSandbox] Sandbox terminated"
    );
    this.emit("sandbox:terminated", { sandboxId: this.sandboxId, reason });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────────

  private getMemoryUsage(): number {
    return this.wasmMemory?.buffer.byteLength ?? 0;
  }

  private getPermissionLevel(): string {
    for (const [level, preset] of Object.entries(PERMISSION_PRESETS)) {
      if (
        preset.maxMemoryBytes === this.permissions.maxMemoryBytes &&
        preset.filesystem === this.permissions.filesystem
      ) {
        return level;
      }
    }
    return "custom";
  }

  getStatus(): SandboxStatus {
    return this.status;
  }

  getStats(): SandboxStats {
    return {
      ...this.stats,
      status: this.status,
      interceptedSyscalls: this.interceptor.getCounts(),
    };
  }

  registerHostFunction(fn: HostFunction): void {
    this.hostFunctions.set(fn.name, fn);
  }
}

// ─── Factory ───────────────────────────────────────────────────────────────────

export function createSandbox(
  agentId: string,
  preset: keyof typeof PERMISSION_PRESETS = "standard",
  overrides: Partial<SandboxPermissions> = {}
): WASMSandbox {
  const permissions: SandboxPermissions = {
    ...PERMISSION_PRESETS[preset],
    ...overrides,
  };
  return new WASMSandbox(agentId, permissions);
}
