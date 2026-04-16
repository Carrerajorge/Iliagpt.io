import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import JSON5 from "json5";
import { parse as parseYaml } from "yaml";

export type OpenClawSkillOptimizationMode = "ready-only" | "all-installable";

export type OpenClawSkillSummary = {
  total: number;
  ready: number;
  disabled: number;
  installable: number;
  authRequired: number;
  configRequired: number;
  unsupportedPlatform: number;
  blocked: number;
  manual: number;
};

export type OpenClawSkillInstallRecord = {
  skillKey: string;
  name: string;
  installId: string;
  message: string;
  warnings: string[];
};

export type OpenClawSkillSkipRecord = {
  skillKey: string;
  name: string;
  reason: string;
};

export type OpenClawSkillOptimizationResult = {
  mode: OpenClawSkillOptimizationMode;
  changed: boolean;
  configUpdated: boolean;
  configChanges: string[];
  summaryBefore: OpenClawSkillSummary;
  summaryAfter: OpenClawSkillSummary;
  attempted: OpenClawSkillSkipRecord[];
  installed: OpenClawSkillInstallRecord[];
  failed: OpenClawSkillSkipRecord[];
  skipped: OpenClawSkillSkipRecord[];
};

type OptimizeParams = {
  mode?: OpenClawSkillOptimizationMode;
  timeoutMs?: number;
};

type OpenClawSkillMissing = {
  bins: string[];
  anyBins: string[];
  env: string[];
  config: string[];
  os: string[];
};

type OpenClawSkillInstallOption = {
  id: string;
  kind: string;
  label: string;
  bins: string[];
};

type OpenClawSkillCheckMissing = {
  name: string;
  missing: OpenClawSkillMissing;
  install: OpenClawSkillInstallOption[];
};

type OpenClawSkillsCheckPayload = {
  summary: {
    total: number;
    eligible: number;
    disabled: number;
    blocked: number;
    missingRequirements: number;
  };
  eligible: string[];
  disabled: string[];
  blocked: string[];
  missingRequirements: OpenClawSkillCheckMissing[];
};

type OpenClawSkillInfoPayload = {
  name: string;
  filePath: string;
  skillKey: string;
  eligible: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  missing: OpenClawSkillMissing;
  install: OpenClawSkillInstallOption[];
};

type InstallSpec = {
  id?: string;
  kind?: string;
  label?: string;
  bins?: string[];
  os?: string[];
  formula?: string;
  tap?: string;
  package?: string;
  module?: string;
  url?: string;
  archive?: string;
  extract?: boolean;
  stripComponents?: number;
  targetDir?: string;
};

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

const DEFAULT_TIMEOUT_MS = 180_000;
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || "openclaw";
const OPENCLAW_STATE_DIR =
  process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
const OPENCLAW_CONFIG_PATH =
  process.env.OPENCLAW_CONFIG_PATH || path.join(OPENCLAW_STATE_DIR, "openclaw.json");

let optimizationLock: Promise<OpenClawSkillOptimizationResult> | null = null;

function cloneJson<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value ?? {})) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function ensureRecord(target: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = target[key];
  if (isRecord(current)) {
    return current;
  }
  const next: Record<string, unknown> = {};
  target[key] = next;
  return next;
}

async function runCommand(
  argv: string[],
  options: { timeoutMs?: number; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<CommandResult> {
  const timeoutMs =
    typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
      ? Math.max(1_000, Math.floor(options.timeoutMs))
      : DEFAULT_TIMEOUT_MS;

  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: CommandResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
      fail(new Error(`Command timed out after ${timeoutMs}ms: ${argv.join(" ")}`));
    }, timeoutMs);
    timer.unref();

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      fail(error);
    });
    child.on("close", (code) => {
      finish({ code, stdout, stderr });
    });
  });
}

function extractJsonPayload<T>(text: string): T {
  const candidates = [text.indexOf("{"), text.indexOf("[")].filter((index) => index >= 0);
  const start = candidates.length > 0 ? Math.min(...candidates) : -1;
  if (start < 0) {
    throw new Error("OpenClaw CLI did not return JSON output.");
  }
  return JSON.parse(text.slice(start)) as T;
}

async function runOpenClawJson<T>(args: string[], timeoutMs = 30_000): Promise<T> {
  const result = await runCommand([OPENCLAW_BIN, ...args], {
    timeoutMs,
    env: buildOpenClawCliEnv(),
  });
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `openclaw ${args.join(" ")} failed`);
  }
  return extractJsonPayload<T>(result.stdout);
}

function buildOpenClawCliEnv(): NodeJS.ProcessEnv {
  if (path.isAbsolute(OPENCLAW_BIN)) {
    return process.env;
  }

  const env: NodeJS.ProcessEnv = { ...process.env };
  const rawPath = env.PATH || env.Path || "";
  const sanitizedPath = rawPath
    .split(path.delimiter)
    .filter((segment) => {
      if (!segment) {
        return false;
      }
      const normalized = segment.replace(/\\/g, "/");
      return !normalized.endsWith("/node_modules/.bin");
    })
    .join(path.delimiter);

  if (sanitizedPath) {
    env.PATH = sanitizedPath;
    if ("Path" in env) {
      env.Path = sanitizedPath;
    }
  }

  return env;
}

async function readOpenClawConfig(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(OPENCLAW_CONFIG_PATH, "utf8");
    const parsed = JSON5.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeOpenClawConfig(config: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(OPENCLAW_CONFIG_PATH), { recursive: true });
  await fs.writeFile(OPENCLAW_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function applyConfigOptimizations(rawConfig: Record<string, unknown>): {
  nextConfig: Record<string, unknown>;
  changes: string[];
} {
  const nextConfig = cloneJson(rawConfig ?? {});
  const changes: string[] = [];

  const env = ensureRecord(nextConfig, "env");
  const shellEnv = ensureRecord(env, "shellEnv");
  if (shellEnv.enabled !== true) {
    shellEnv.enabled = true;
    changes.push("Enabled login-shell environment import for skill secrets.");
  }

  const tools = ensureRecord(nextConfig, "tools");
  if (tools.enabled === false) {
    tools.enabled = true;
    changes.push("Enabled OpenClaw tools runtime.");
  }

  const browser = ensureRecord(nextConfig, "browser");
  if (browser.enabled !== true) {
    browser.enabled = true;
    changes.push("Enabled browser control by default.");
  }
  if (browser.evaluateEnabled !== true) {
    browser.evaluateEnabled = true;
    changes.push("Enabled browser evaluate actions.");
  }

  const toolsWeb = ensureRecord(tools, "web");
  const toolsWebSearch = ensureRecord(toolsWeb, "search");
  if (toolsWebSearch.enabled !== true) {
    toolsWebSearch.enabled = true;
    changes.push("Enabled web search tool.");
  }
  const toolsWebFetch = ensureRecord(toolsWeb, "fetch");
  if (toolsWebFetch.enabled !== true) {
    toolsWebFetch.enabled = true;
    changes.push("Enabled web fetch tool.");
  }

  const agents = ensureRecord(nextConfig, "agents");
  const agentDefaults = ensureRecord(agents, "defaults");
  const sandbox = ensureRecord(agentDefaults, "sandbox");
  const sandboxBrowser = ensureRecord(sandbox, "browser");
  if (sandboxBrowser.enabled !== true) {
    sandboxBrowser.enabled = true;
    changes.push("Enabled sandbox browser for default agents.");
  }

  const gateway = ensureRecord(nextConfig, "gateway");
  if (gateway.controlUi === false) {
    gateway.controlUi = {};
  }
  const gatewayNodes = ensureRecord(gateway, "nodes");
  const gatewayBrowser = ensureRecord(gatewayNodes, "browser");
  if (gatewayBrowser.mode !== "auto" && gatewayBrowser.mode !== "manual") {
    gatewayBrowser.mode = "auto";
    changes.push("Enabled automatic remote browser node routing.");
  } else if (gatewayBrowser.mode === "off") {
    gatewayBrowser.mode = "auto";
    changes.push("Re-enabled remote browser node routing.");
  }

  const skills = ensureRecord(nextConfig, "skills");
  const skillsInstall = ensureRecord(skills, "install");
  if (typeof skillsInstall.nodeManager !== "string") {
    skillsInstall.nodeManager = "npm";
    changes.push("Set default skill installer node manager to npm.");
  }
  if (typeof skillsInstall.preferBrew !== "boolean") {
    skillsInstall.preferBrew = process.platform === "darwin";
    changes.push(
      `Set default skill installer brew preference to ${process.platform === "darwin"}.`,
    );
  }
  if (Array.isArray(skills.allowBundled) && skills.allowBundled.length > 0) {
    delete skills.allowBundled;
    changes.push("Removed bundled skill allowlist restrictions.");
  }

  const plugins = ensureRecord(nextConfig, "plugins");
  if (plugins.enabled === false) {
    plugins.enabled = true;
    changes.push("Enabled OpenClaw plugins runtime.");
  }
  const pluginEntries = ensureRecord(plugins, "entries");
  const memoryCore = ensureRecord(pluginEntries, "memory-core");
  const memoryCoreConfig = isRecord(memoryCore.config) ? memoryCore.config : null;
  if (memoryCoreConfig && "dreaming" in memoryCoreConfig) {
    delete memoryCoreConfig.dreaming;
    if (Object.keys(memoryCoreConfig).length === 0) {
      delete memoryCore.config;
    }
    changes.push("Removed legacy memory-core dreaming config that breaks validation.");
  }

  const voiceCall = ensureRecord(pluginEntries, "voice-call");
  if (voiceCall.enabled !== true) {
    voiceCall.enabled = true;
    changes.push("Enabled bundled voice-call plugin.");
  }

  return { nextConfig, changes };
}

function canAutoInstall(item: OpenClawSkillCheckMissing): boolean {
  const missingBins = item.missing.bins.length > 0 || item.missing.anyBins.length > 0;
  const hasDownloadInstall = item.install.some((install) => install.kind === "download");
  return item.install.length > 0 && (missingBins || hasDownloadInstall);
}

function buildSkillSummary(payload: OpenClawSkillsCheckPayload): OpenClawSkillSummary {
  const summary: OpenClawSkillSummary = {
    total: payload.summary.total,
    ready: payload.summary.eligible,
    disabled: payload.summary.disabled,
    installable: 0,
    authRequired: 0,
    configRequired: 0,
    unsupportedPlatform: 0,
    blocked: payload.summary.blocked,
    manual: 0,
  };

  for (const item of payload.missingRequirements) {
    if (item.missing.os.length > 0) {
      summary.unsupportedPlatform += 1;
      continue;
    }
    if (canAutoInstall(item)) {
      summary.installable += 1;
      continue;
    }
    if (item.missing.env.length > 0) {
      summary.authRequired += 1;
      continue;
    }
    if (item.missing.config.length > 0) {
      summary.configRequired += 1;
      continue;
    }
    summary.manual += 1;
  }

  return summary;
}

function resolveOptimizationReason(item: OpenClawSkillCheckMissing): string {
  if (item.missing.os.length > 0) {
    return `unsupported_platform:${item.missing.os.join(",")}`;
  }
  if (item.missing.config.length > 0) {
    return `needs_config:${item.missing.config.join(",")}`;
  }
  if (item.missing.env.length > 0 && !canAutoInstall(item)) {
    return `needs_env:${item.missing.env.join(",")}`;
  }
  if (item.install.length === 0) {
    return "no_installer";
  }
  if (!canAutoInstall(item)) {
    return "no_auto_install_path";
  }
  return "eligible_for_install";
}

async function getSkillsCheck(timeoutMs = 30_000): Promise<OpenClawSkillsCheckPayload> {
  return await runOpenClawJson<OpenClawSkillsCheckPayload>(["skills", "check", "--json"], timeoutMs);
}

async function getSkillInfo(name: string, timeoutMs = 30_000): Promise<OpenClawSkillInfoPayload> {
  return await runOpenClawJson<OpenClawSkillInfoPayload>(
    ["skills", "info", name, "--json"],
    timeoutMs,
  );
}

async function readSkillInstallSpecs(filePath: string): Promise<InstallSpec[]> {
  const raw = await fs.readFile(filePath, "utf8");
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return [];
  }
  const frontmatter = parseYaml(match[1]) as {
    metadata?: { openclaw?: { install?: InstallSpec[] } };
  };
  return Array.isArray(frontmatter?.metadata?.openclaw?.install)
    ? frontmatter.metadata.openclaw.install
    : [];
}

function selectInstallSpecs(
  info: OpenClawSkillInfoPayload,
  allSpecs: InstallSpec[],
): InstallSpec[] {
  const selected: InstallSpec[] = [];

  for (const install of info.install) {
    const match = allSpecs.find((spec) => {
      const id = typeof spec.id === "string" ? spec.id : "";
      const os = asStringArray(spec.os);
      const supported = os.length === 0 || os.includes(process.platform);
      if (!supported || id !== install.id) {
        return false;
      }

      const specBins = asStringArray(spec.bins);
      const binsMatch =
        install.bins.length > 0 &&
        specBins.length > 0 &&
        install.bins.length === specBins.length &&
        install.bins.every((bin, index) => specBins[index] === bin);
      if (binsMatch) {
        return true;
      }

      return typeof spec.label === "string" && spec.label === install.label;
    });

    if (match) {
      selected.push(match);
    }
  }

  return selected;
}

async function installDownloadSpec(
  skillKey: string,
  spec: InstallSpec,
  timeoutMs: number,
): Promise<string> {
  if (!spec.url) {
    throw new Error(`Install spec ${spec.id ?? "<unknown>"} is missing a download URL.`);
  }

  const toolsRoot = path.join(OPENCLAW_STATE_DIR, "tools", skillKey);
  const targetDir = spec.targetDir ? path.join(toolsRoot, spec.targetDir) : toolsRoot;
  await fs.mkdir(targetDir, { recursive: true });

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `${skillKey}-`));
  const fileName = path.basename(new URL(spec.url).pathname) || "download";
  const archivePath = path.join(tempDir, fileName);

  const response = await fetch(spec.url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`Failed to download ${spec.url}: ${response.status} ${response.statusText}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(archivePath, bytes);

  if (spec.extract) {
    const archiveKind = spec.archive || fileName;
    if (archiveKind.includes("tar.bz2")) {
      await runCommand(
        [
          "tar",
          "-xjf",
          archivePath,
          "-C",
          targetDir,
          "--strip-components",
          String(spec.stripComponents ?? 0),
        ],
        { timeoutMs, cwd: tempDir },
      );
    } else if (archiveKind.includes("tar.gz") || archiveKind.includes(".tgz")) {
      await runCommand(
        [
          "tar",
          "-xzf",
          archivePath,
          "-C",
          targetDir,
          "--strip-components",
          String(spec.stripComponents ?? 0),
        ],
        { timeoutMs, cwd: tempDir },
      );
    } else if (archiveKind.includes(".zip")) {
      await runCommand(["unzip", "-oq", archivePath, "-d", targetDir], {
        timeoutMs,
        cwd: tempDir,
      });
    } else {
      throw new Error(`Unsupported archive type for ${archiveKind}`);
    }
  } else {
    const destination = path.join(targetDir, fileName);
    await fs.copyFile(archivePath, destination);
  }

  return `Downloaded ${spec.label || spec.id || spec.url}`;
}

async function installSpec(
  skillKey: string,
  spec: InstallSpec,
  timeoutMs: number,
  nodeManager: string,
): Promise<string> {
  switch (spec.kind) {
    case "brew": {
      if (!spec.formula) {
        throw new Error(`Install spec ${spec.id ?? "<unknown>"} is missing a brew formula.`);
      }
      const formula = spec.tap ? `${spec.tap}/${spec.formula}` : spec.formula;
      const result = await runCommand(["brew", "install", formula], { timeoutMs });
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || result.stdout.trim() || `brew install ${formula} failed`);
      }
      return result.stdout.trim() || `Installed ${formula}`;
    }
    case "node": {
      if (!spec.package) {
        throw new Error(`Install spec ${spec.id ?? "<unknown>"} is missing a node package.`);
      }
      const argv =
        nodeManager === "pnpm"
          ? ["pnpm", "add", "-g", "--ignore-scripts", spec.package]
          : nodeManager === "yarn"
            ? ["yarn", "global", "add", "--ignore-scripts", spec.package]
            : nodeManager === "bun"
              ? ["bun", "add", "-g", "--ignore-scripts", spec.package]
              : ["npm", "install", "-g", "--ignore-scripts", spec.package];
      const result = await runCommand(argv, { timeoutMs });
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || result.stdout.trim() || `${argv.join(" ")} failed`);
      }
      return result.stdout.trim() || `Installed ${spec.package}`;
    }
    case "go": {
      if (!spec.module) {
        throw new Error(`Install spec ${spec.id ?? "<unknown>"} is missing a Go module.`);
      }
      const result = await runCommand(["go", "install", spec.module], { timeoutMs });
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || result.stdout.trim() || `go install ${spec.module} failed`);
      }
      return result.stdout.trim() || `Installed ${spec.module}`;
    }
    case "uv": {
      if (!spec.package) {
        throw new Error(`Install spec ${spec.id ?? "<unknown>"} is missing a uv package.`);
      }
      const result = await runCommand(["uv", "tool", "install", spec.package], { timeoutMs });
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || result.stdout.trim() || `uv tool install ${spec.package} failed`);
      }
      return result.stdout.trim() || `Installed ${spec.package}`;
    }
    case "download":
      return await installDownloadSpec(skillKey, spec, timeoutMs);
    default:
      throw new Error(`Unsupported install kind: ${spec.kind ?? "<unknown>"}`);
  }
}

async function applySherpaModelConfig(config: Record<string, unknown>): Promise<boolean> {
  const runtimeDir = path.join(OPENCLAW_STATE_DIR, "tools", "sherpa-onnx-tts", "runtime");
  const modelRoot = path.join(OPENCLAW_STATE_DIR, "tools", "sherpa-onnx-tts", "models");

  try {
    await fs.access(runtimeDir);
    await fs.access(modelRoot);
  } catch {
    return false;
  }

  let modelDir = modelRoot;
  const entries = await fs.readdir(modelRoot, { withFileTypes: true });
  const childDirectories = entries.filter((entry) => entry.isDirectory());
  if (childDirectories.length === 1) {
    modelDir = path.join(modelRoot, childDirectories[0].name);
  }

  const skills = ensureRecord(config, "skills");
  const skillEntries = ensureRecord(skills, "entries");
  const sherpa = ensureRecord(skillEntries, "sherpa-onnx-tts");
  const env = ensureRecord(sherpa, "env");

  let changed = false;
  if (env.SHERPA_ONNX_RUNTIME_DIR !== runtimeDir) {
    env.SHERPA_ONNX_RUNTIME_DIR = runtimeDir;
    changed = true;
  }
  if (env.SHERPA_ONNX_MODEL_DIR !== modelDir) {
    env.SHERPA_ONNX_MODEL_DIR = modelDir;
    changed = true;
  }
  return changed;
}

async function runOptimization(params: OptimizeParams): Promise<OpenClawSkillOptimizationResult> {
  const mode = params.mode ?? "ready-only";
  const timeoutMs =
    typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
      ? Math.max(5_000, Math.floor(params.timeoutMs))
      : DEFAULT_TIMEOUT_MS;

  const rawConfig = await readOpenClawConfig();
  const optimizedConfig = applyConfigOptimizations(rawConfig);
  let configUpdated = optimizedConfig.changes.length > 0;
  let currentConfig = optimizedConfig.nextConfig;

  if (configUpdated) {
    await writeOpenClawConfig(currentConfig);
  }

  const validateResult = await runOpenClawJson<{ valid: boolean; issues?: Array<{ path: string; message: string }> }>(
    ["config", "validate", "--json"],
    30_000,
  );
  if (!validateResult.valid) {
    const issueText = (validateResult.issues || [])
      .map((issue) => `${issue.path || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`OpenClaw config is invalid and could not be auto-repaired: ${issueText}`);
  }

  const initialCheck = await getSkillsCheck(30_000);
  const summaryBefore = buildSkillSummary(initialCheck);

  const attempted: OpenClawSkillSkipRecord[] = [];
  const installed: OpenClawSkillInstallRecord[] = [];
  const failed: OpenClawSkillSkipRecord[] = [];
  const skipped: OpenClawSkillSkipRecord[] = [];

  const skillsConfig = isRecord(currentConfig.skills) ? currentConfig.skills : null;
  const skillsInstallConfig =
    skillsConfig && isRecord(skillsConfig.install) ? skillsConfig.install : null;
  const nodeManager =
    skillsInstallConfig && typeof skillsInstallConfig.nodeManager === "string"
      ? skillsInstallConfig.nodeManager
      : "npm";

  for (const item of initialCheck.missingRequirements) {
    const reason = resolveOptimizationReason(item);
    const missingBins = item.missing.bins.length > 0 || item.missing.anyBins.length > 0;
    const hasDownloadInstall = item.install.some((install) => install.kind === "download");

    if (!canAutoInstall(item)) {
      skipped.push({ skillKey: item.name, name: item.name, reason });
      continue;
    }
    if (mode === "ready-only" && !missingBins && !hasDownloadInstall) {
      skipped.push({ skillKey: item.name, name: item.name, reason });
      continue;
    }

    const info = await getSkillInfo(item.name, 30_000);
    const allSpecs = await readSkillInstallSpecs(info.filePath);
    const selectedSpecs = selectInstallSpecs(info, allSpecs);

    if (selectedSpecs.length === 0) {
      skipped.push({ skillKey: info.skillKey, name: info.name, reason: "no_matching_install_spec" });
      continue;
    }

    let skillInstalled = false;
    for (const spec of selectedSpecs) {
      const installId = spec.id || "unknown";
      attempted.push({ skillKey: info.skillKey, name: info.name, reason: installId });
      try {
        const message = await installSpec(info.skillKey, spec, timeoutMs, nodeManager);
        installed.push({
          skillKey: info.skillKey,
          name: info.name,
          installId,
          message,
          warnings: [],
        });
        skillInstalled = true;
      } catch (error) {
        failed.push({
          skillKey: info.skillKey,
          name: info.name,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (skillInstalled && info.skillKey === "sherpa-onnx-tts") {
      currentConfig = await readOpenClawConfig();
      const sherpaUpdated = await applySherpaModelConfig(currentConfig);
      if (sherpaUpdated) {
        await writeOpenClawConfig(currentConfig);
        configUpdated = true;
        optimizedConfig.changes.push("Configured sherpa-onnx-tts runtime and model paths.");
      }
    }
  }

  const afterCheck = await getSkillsCheck(30_000);
  const summaryAfter = buildSkillSummary(afterCheck);

  return {
    mode,
    changed:
      configUpdated ||
      installed.length > 0 ||
      summaryAfter.ready !== summaryBefore.ready ||
      summaryAfter.installable !== summaryBefore.installable,
    configUpdated,
    configChanges: optimizedConfig.changes,
    summaryBefore,
    summaryAfter,
    attempted,
    installed,
    failed,
    skipped,
  };
}

export async function optimizeOpenClawSkills(
  params: OptimizeParams = {},
): Promise<OpenClawSkillOptimizationResult> {
  if (optimizationLock) {
    return await optimizationLock;
  }

  optimizationLock = runOptimization(params).finally(() => {
    optimizationLock = null;
  });
  return await optimizationLock;
}
