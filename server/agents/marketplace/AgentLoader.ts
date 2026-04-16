import { createRequire } from "module";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { join, resolve } from "path";
import { EventEmitter } from "events";
import vm from "vm";
import pino from "pino";
import type { AgentManifest } from "./AgentManifest.js";
import {
  type MarketplaceAgent,
  type AgentClass,
  type ResourceAPI,
  type CommunicationAPI,
  type AgentContext,
} from "./AgentSDK.js";

const logger = pino({ name: "AgentLoader" });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LoadOptions {
  /** Absolute path to the agent package directory */
  packagePath: string;
  /** Whether to verify the bundle checksum before loading */
  verifyChecksum?: boolean;
  /** Timeout for module initialization in ms */
  initTimeoutMs?: number;
  /** Whether to run in a sandboxed VM context */
  sandbox?: boolean;
}

export interface LoadedAgent {
  agentId: string;
  instance: MarketplaceAgent;
  manifest: AgentManifest;
  loadedAt: number;
  packagePath: string;
  memoryUsageBefore: number;
}

export interface ResourceUsageSnapshot {
  heapUsedMB: number;
  heapTotalMB: number;
  externalMB: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  timestamp: number;
}

// ─── Permission enforcer ──────────────────────────────────────────────────────

class PermissionEnforcer {
  constructor(private readonly permissions: AgentManifest["permissions"]) {}

  enforceFilesystem(path: string, mode: "read" | "write"): void {
    const { filesystem } = this.permissions;
    if (filesystem === "none") {
      throw new Error(`Filesystem access denied for path: ${path}`);
    }
    if (filesystem === "readonly" && mode === "write") {
      throw new Error(`Write access denied; filesystem is readonly. Path: ${path}`);
    }
  }

  enforceNetwork(url: string): void {
    const { networkAllowlist } = this.permissions;
    if (!networkAllowlist.length) {
      throw new Error(`Network access denied (no allowlist configured). URL: ${url}`);
    }
    const allowed = networkAllowlist.some((allowed) =>
      url.startsWith(allowed)
    );
    if (!allowed) {
      throw new Error(
        `Network access to '${url}' denied. Allowed: ${networkAllowlist.join(", ")}`
      );
    }
  }

  enforceShell(): void {
    if (!this.permissions.shellExecution) {
      throw new Error("Shell execution permission denied");
    }
  }

  enforceBrowser(): void {
    if (!this.permissions.browserAccess) {
      throw new Error("Browser access permission denied");
    }
  }
}

// ─── Sandboxed context builder ────────────────────────────────────────────────

function buildSandboxContext(
  manifest: AgentManifest,
  enforcer: PermissionEnforcer,
  packagePath: string
): vm.Context {
  // Controlled require: only allow pure Node.js built-ins that are safe
  const safeBuiltins = new Set([
    "path",
    "url",
    "util",
    "events",
    "stream",
    "buffer",
    "querystring",
    "string_decoder",
    "punycode",
  ]);

  const sandboxRequire = createRequire(join(packagePath, "index.js"));

  const proxiedRequire = (id: string) => {
    if (id.startsWith(".") || id.startsWith("/")) {
      // Local file — resolve relative to package
      return sandboxRequire(join(packagePath, id));
    }
    if (!safeBuiltins.has(id)) {
      logger.warn(
        { agentId: manifest.id, module: id },
        "[AgentLoader] Blocked require of non-allowlisted module"
      );
      throw new Error(`Module '${id}' is not allowed in sandboxed agent context`);
    }
    return sandboxRequire(id);
  };

  return vm.createContext({
    require: proxiedRequire,
    console: {
      log: (...args: unknown[]) =>
        logger.info({ agentId: manifest.id }, `[Agent:${manifest.id}] ${args.join(" ")}`),
      warn: (...args: unknown[]) =>
        logger.warn({ agentId: manifest.id }, `[Agent:${manifest.id}] ${args.join(" ")}`),
      error: (...args: unknown[]) =>
        logger.error({ agentId: manifest.id }, `[Agent:${manifest.id}] ${args.join(" ")}`),
    },
    process: {
      env: {},
      version: process.version,
      platform: process.platform,
      nextTick: process.nextTick.bind(process),
    },
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    Error,
    Map,
    Set,
    Array,
    Object,
    JSON,
    Math,
    Date,
    RegExp,
    Symbol,
    // SDK exports made available inside the sandbox
    __AGENT_SDK_VERSION__: "1.0.0",
    exports: {},
    module: { exports: {} },
  });
}

// ─── Resource usage tracking ──────────────────────────────────────────────────

function snapshotResources(): ResourceUsageSnapshot {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  return {
    heapUsedMB: mem.heapUsed / 1024 / 1024,
    heapTotalMB: mem.heapTotal / 1024 / 1024,
    externalMB: mem.external / 1024 / 1024,
    cpuUserMs: cpu.user / 1000,
    cpuSystemMs: cpu.system / 1000,
    timestamp: Date.now(),
  };
}

// ─── AgentLoader ─────────────────────────────────────────────────────────────

export class AgentLoader extends EventEmitter {
  private readonly loaded = new Map<string, LoadedAgent>();
  private readonly resourceSnapshots = new Map<string, ResourceUsageSnapshot>();

  constructor(
    private readonly platformVersion: string = "1.0.0"
  ) {
    super();
    logger.info({ platformVersion }, "[AgentLoader] Initialized");
  }

  // ── Load ────────────────────────────────────────────────────────────────────

  async load(manifest: AgentManifest, opts: LoadOptions): Promise<LoadedAgent> {
    const { packagePath, verifyChecksum = true, initTimeoutMs = 10_000, sandbox = true } = opts;

    logger.info(
      { agentId: manifest.id, packagePath, sandbox },
      "[AgentLoader] Loading agent"
    );

    if (this.loaded.has(manifest.id)) {
      logger.warn({ agentId: manifest.id }, "[AgentLoader] Agent already loaded");
      return this.loaded.get(manifest.id)!;
    }

    const mainPath = resolve(packagePath, manifest.main ?? "index.js");

    // 1. Read bundle
    let bundle: Buffer;
    try {
      bundle = await readFile(mainPath);
    } catch (err) {
      throw new Error(
        `Failed to read agent bundle at '${mainPath}': ${(err as Error).message}`
      );
    }

    // 2. Verify checksum
    if (verifyChecksum && manifest.checksum) {
      const actual = createHash("sha256").update(bundle).digest("hex");
      if (actual !== manifest.checksum) {
        throw new Error(
          `Checksum mismatch for agent '${manifest.id}'. ` +
            `Expected ${manifest.checksum}, got ${actual}`
        );
      }
      logger.debug({ agentId: manifest.id }, "[AgentLoader] Checksum verified");
    }

    // 3. Load the module
    const memBefore = process.memoryUsage().heapUsed;
    let AgentConstructor: AgentClass;

    if (sandbox) {
      AgentConstructor = await this.loadInSandbox(
        manifest,
        bundle.toString("utf8"),
        packagePath,
        initTimeoutMs
      );
    } else {
      AgentConstructor = await this.loadDirect(mainPath);
    }

    // 4. Instantiate
    const instance = new AgentConstructor(manifest);
    const loadedAt = Date.now();

    const loaded: LoadedAgent = {
      agentId: manifest.id,
      instance,
      manifest,
      loadedAt,
      packagePath,
      memoryUsageBefore: memBefore,
    };

    this.loaded.set(manifest.id, loaded);
    this.resourceSnapshots.set(manifest.id, snapshotResources());

    this.emit("loaded", { agentId: manifest.id, loadedAt });
    logger.info({ agentId: manifest.id }, "[AgentLoader] Agent loaded successfully");

    return loaded;
  }

  // ── Sandboxed loading via vm ────────────────────────────────────────────────

  private async loadInSandbox(
    manifest: AgentManifest,
    code: string,
    packagePath: string,
    timeoutMs: number
  ): Promise<AgentClass> {
    const enforcer = new PermissionEnforcer(manifest.permissions);
    const ctx = buildSandboxContext(manifest, enforcer, packagePath);

    return new Promise<AgentClass>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(`Agent '${manifest.id}' initialization timed out after ${timeoutMs}ms`)
        );
      }, timeoutMs);

      try {
        const script = new vm.Script(code, {
          filename: `agent:${manifest.id}`,
          lineOffset: 0,
        });
        script.runInContext(ctx, { timeout: timeoutMs });

        clearTimeout(timer);

        // The module should export either a default class or a factory function
        const exported =
          (ctx as Record<string, unknown>).exports ||
          (ctx as Record<string, unknown>).module?.exports;

        if (!exported) {
          throw new Error(`Agent '${manifest.id}' did not export anything`);
        }

        const AgentClass = this.extractAgentClass(exported, manifest.id);
        resolve(AgentClass);
      } catch (err) {
        clearTimeout(timer);
        reject(
          new Error(
            `Sandbox execution failed for agent '${manifest.id}': ${(err as Error).message}`
          )
        );
      }
    });
  }

  // ── Direct loading (trusted agents) ────────────────────────────────────────

  private async loadDirect(mainPath: string): Promise<AgentClass> {
    try {
      const mod = await import(mainPath);
      const exported = mod.default ?? mod;
      if (typeof exported === "function") return exported as AgentClass;
      if (exported && typeof exported.default === "function")
        return exported.default as AgentClass;
      throw new Error("Module does not export a class or factory function");
    } catch (err) {
      throw new Error(`Direct load failed: ${(err as Error).message}`);
    }
  }

  // ── Extract agent class from various export patterns ───────────────────────

  private extractAgentClass(exported: unknown, agentId: string): AgentClass {
    if (typeof exported === "function") return exported as AgentClass;

    if (
      exported &&
      typeof exported === "object" &&
      "default" in exported &&
      typeof (exported as Record<string, unknown>).default === "function"
    ) {
      return (exported as { default: AgentClass }).default;
    }

    throw new Error(
      `Agent '${agentId}' must export a class extending MarketplaceAgent (got ${typeof exported})`
    );
  }

  // ── Initialize loaded agent ────────────────────────────────────────────────

  async initialize(
    agentId: string,
    resources: ResourceAPI,
    comms: CommunicationAPI,
    ctx: AgentContext
  ): Promise<void> {
    const loaded = this.loaded.get(agentId);
    if (!loaded) throw new Error(`Agent '${agentId}' is not loaded`);

    await loaded.instance.install(resources, comms, ctx);
    await loaded.instance.activate();

    logger.info({ agentId }, "[AgentLoader] Agent initialized and activated");
    this.emit("initialized", { agentId });
  }

  // ── Unload ──────────────────────────────────────────────────────────────────

  async unload(agentId: string): Promise<void> {
    const loaded = this.loaded.get(agentId);
    if (!loaded) {
      logger.warn({ agentId }, "[AgentLoader] Unload called on non-loaded agent");
      return;
    }

    try {
      await loaded.instance.uninstall();
    } catch (err) {
      logger.error({ err, agentId }, "[AgentLoader] Error during unload");
    }

    this.loaded.delete(agentId);
    this.resourceSnapshots.delete(agentId);

    this.emit("unloaded", { agentId });
    logger.info({ agentId }, "[AgentLoader] Agent unloaded");
  }

  // ── Resource monitoring ────────────────────────────────────────────────────

  getResourceUsage(agentId: string): ResourceUsageSnapshot | null {
    return this.resourceSnapshots.get(agentId) ?? null;
  }

  refreshResourceSnapshot(agentId: string): ResourceUsageSnapshot | null {
    if (!this.loaded.has(agentId)) return null;
    const snap = snapshotResources();
    this.resourceSnapshots.set(agentId, snap);
    return snap;
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  getLoaded(agentId: string): LoadedAgent | undefined {
    return this.loaded.get(agentId);
  }

  listLoaded(): LoadedAgent[] {
    return Array.from(this.loaded.values());
  }

  isLoaded(agentId: string): boolean {
    return this.loaded.has(agentId);
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────
let _loader: AgentLoader | null = null;
export function getAgentLoader(platformVersion?: string): AgentLoader {
  if (!_loader) _loader = new AgentLoader(platformVersion ?? "1.0.0");
  return _loader;
}
