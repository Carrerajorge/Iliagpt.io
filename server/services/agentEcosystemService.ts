import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export const AGENT_ECOSYSTEM_SERVICE_IDS = [
  "dify",
  "ollama",
  "langchain",
  "n8n",
  "open_webui",
  "metagpt",
  "crewai",
  "autogen",
  "langgraph",
  "browser_use",
  "flowise",
  "qdrant",
  "librechat",
  "searxng",
  "langfuse",
  "openclaw",
  "agent_zero",
] as const;

export type AgentEcosystemServiceId = (typeof AGENT_ECOSYSTEM_SERVICE_IDS)[number];
export type AgentEcosystemHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type AgentEcosystemComposeAction = "up" | "down" | "ps" | "logs" | "restart";

type RepoManifestRepo = {
  name: string;
  exists?: boolean;
  branch?: string | null;
  commit?: string | null;
  sizeKb?: number | null;
  url?: string;
  path?: string;
};

type RepoManifest = {
  generatedAt?: string;
  total?: number;
  cloned?: number;
  missing?: string[];
  repos?: RepoManifestRepo[];
};

type FusionRegistryRepo = {
  name: string;
  role?: string;
  clonePath?: string;
  runtimeIntegrated?: boolean;
  codeIntegrated?: boolean;
  integrationMode?: string;
};

type FusionRegistry = {
  schemaVersion?: number;
  workspace?: string;
  description?: string;
  repos?: FusionRegistryRepo[];
};

const INTEGRATION_DEPTH_WEIGHTS: Record<string, number> = {
  "embedded-runtime-router": 1.0,
  "docker-compose": 0.75,
  "npm-sdk+control-plane-repo-adapter": 0.65,
  "npm-sdk": 0.6,
  "control-plane-repo-adapter": 0.45,
};

type ServiceProbe = {
  ok: boolean;
  status: number | null;
  url: string | null;
  error?: string;
  reachableNon2xx?: boolean;
  durationMs: number;
};

type ConfiguredService = {
  id: AgentEcosystemServiceId;
  baseUrl: string | null;
  enabled: boolean;
  source: "env" | "default" | "none";
};

type ProxyQueryValue = string | number | boolean | null | undefined;
type ProxyQuery = Record<string, ProxyQueryValue>;
type ProxyHeaders = Record<string, string>;

export type AgentEcosystemProxyRequest = {
  service: AgentEcosystemServiceId;
  method?: AgentEcosystemHttpMethod;
  path?: string;
  query?: ProxyQuery;
  headers?: ProxyHeaders;
  body?: unknown;
  timeoutMs?: number;
};

export type AgentEcosystemComposeRequest = {
  action: AgentEcosystemComposeAction;
  profiles?: string[];
  services?: string[];
  follow?: boolean;
  lines?: number;
  timeoutMs?: number;
};

export type AgentEcosystemRepoExecRequest = {
  repo: string;
  command: string;
  args?: string[];
  timeoutMs?: number;
  env?: Record<string, string>;
};

export type AgentEcosystemRepoSearchRequest = {
  repo?: string;
  pattern: string;
  glob?: string;
  maxResults?: number;
  timeoutMs?: number;
};

export type AgentEcosystemRepoReadRequest = {
  repo: string;
  filePath: string;
  maxBytes?: number;
};

export type AgentEcosystemRepoProbeRequest = {
  repo: string;
  timeoutMs?: number;
};

export type AgentEcosystemDeepAuditRequest = {
  timeoutMs?: number;
  maxRepos?: number;
  includeAdapters?: boolean;
  includeRuntime?: boolean;
  includeSmoke?: boolean;
  concurrency?: number;
};

const DEFAULT_SERVICE_URLS: Partial<Record<AgentEcosystemServiceId, string>> = {
  ollama: "http://localhost:11434",
  qdrant: "http://localhost:6333",
  searxng: "http://localhost:8081",
  open_webui: "http://localhost:3003",
  n8n: "http://localhost:5678",
  flowise: "http://localhost:3001",
  langfuse: "http://localhost:3000",
  openclaw: "http://localhost:5000",
};

const SERVICE_ENV_KEYS: Record<AgentEcosystemServiceId, string> = {
  dify: "DIFY_BASE_URL",
  ollama: "OLLAMA_BASE_URL",
  langchain: "LANGCHAIN_BASE_URL",
  n8n: "N8N_BASE_URL",
  open_webui: "OPEN_WEBUI_BASE_URL",
  metagpt: "METAGPT_BASE_URL",
  crewai: "CREWAI_BASE_URL",
  autogen: "AUTOGEN_BASE_URL",
  langgraph: "LANGGRAPH_BASE_URL",
  browser_use: "BROWSER_USE_BASE_URL",
  flowise: "FLOWISE_BASE_URL",
  qdrant: "QDRANT_URL",
  librechat: "LIBRECHAT_BASE_URL",
  searxng: "SEARXNG_BASE_URL",
  langfuse: "LANGFUSE_BASE_URL",
  openclaw: "OPENCLAW_BASE_URL",
  agent_zero: "AGENT_ZERO_BASE_URL",
};

const SERVICE_PROBE_PATHS: Record<AgentEcosystemServiceId, string[]> = {
  dify: ["/health", "/v1"],
  ollama: ["/api/version", "/api/tags", "/"],
  langchain: ["/health", "/"],
  n8n: ["/healthz", "/rest/settings", "/"],
  open_webui: ["/health", "/api/config", "/"],
  metagpt: ["/health", "/"],
  crewai: ["/health", "/"],
  autogen: ["/health", "/"],
  langgraph: ["/health", "/"],
  browser_use: ["/health", "/"],
  flowise: ["/api/v1/ping", "/api/v1/chatflows", "/"],
  qdrant: ["/readyz", "/collections", "/"],
  librechat: ["/health", "/api/health", "/"],
  searxng: ["/healthz", "/"],
  langfuse: ["/api/public/health", "/"],
  openclaw: ["/health", "/api/openclaw/runtime/health", "/"],
  agent_zero: ["/health", "/"],
};

const IDENTITY_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const PROXY_METHODS = new Set<AgentEcosystemHttpMethod>(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const BLOCKED_PROXY_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "proxy-connection",
]);
const REPO_COMMAND_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const REPO_ENV_KEY_RE = /^[A-Z_][A-Z0-9_]{0,63}$/;
const REPO_GLOB_RE = /^[a-zA-Z0-9._*?/{},!+\-[\]\\]{1,256}$/;
const ALLOWED_REPO_COMMANDS = new Set([
  "git",
  "ls",
  "cat",
  "find",
  "rg",
  "npm",
  "pnpm",
  "yarn",
  "node",
  "python",
  "python3",
  "pip",
  "pip3",
  "uv",
  "poetry",
  "make",
  "bash",
  "sh",
  "docker",
  "docker-compose",
  "pwd",
]);

type RepoSmokeRule = {
  allOf?: string[];
  anyOf?: string[];
  note?: string;
};

const REPO_RUNTIME_SERVICE_MAP: Partial<Record<string, AgentEcosystemServiceId>> = {
  ollama: "ollama",
  n8n: "n8n",
  "open-webui": "open_webui",
  flowise: "flowise",
  qdrant: "qdrant",
  searxng: "searxng",
  langfuse: "langfuse",
  "openclaw-upstream": "openclaw",
};

const REPO_SMOKE_RULES: Record<string, RepoSmokeRule> = {
  dify: { allOf: ["api", "web", "docker"], note: "Dify monorepo core folders should exist." },
  ollama: { allOf: ["cmd", "api", "Dockerfile"], note: "Ollama runtime entrypoints should exist." },
  langchain: { allOf: ["libs", "README.md"], note: "LangChain libraries folder should exist." },
  n8n: { allOf: ["packages", "package.json"], note: "n8n monorepo package entry should exist." },
  "open-webui": { allOf: ["backend", "README.md"], note: "Open WebUI backend should exist." },
  metagpt: { allOf: ["metagpt", "setup.py"], note: "MetaGPT package and setup should exist." },
  crewai: { allOf: ["lib/crewai", "pyproject.toml"], note: "CrewAI local package path should exist." },
  autogen: { allOf: ["python", "README.md"], note: "AutoGen python workspace should exist." },
  langgraph: { allOf: ["libs", "README.md"], note: "LangGraph libs workspace should exist." },
  "browser-use": { allOf: ["browser_use", "pyproject.toml"], note: "browser-use python package should exist." },
  flowise: { allOf: ["packages", "package.json"], note: "Flowise packages workspace should exist." },
  qdrant: { allOf: ["src", "Cargo.toml"], note: "Qdrant Rust crate source should exist." },
  librechat: { allOf: ["api", "client", "package.json"], note: "LibreChat API/client workspaces should exist." },
  searxng: { allOf: ["searx", "requirements-server.txt", "README.rst"], note: "SearXNG server modules should exist." },
  langfuse: { allOf: ["packages", "package.json", "docker-compose.yml"], note: "Langfuse monorepo and compose should exist." },
  "openclaw-upstream": { allOf: ["apps", "packages", "openclaw.mjs"], note: "OpenClaw upstream runtime entrypoints should exist." },
  "agent-zero": { allOf: ["agent.py", "python", "README.md"], note: "Agent Zero python entrypoints should exist." },
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const rel = path.relative(rootPath, candidatePath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function isJsonLikeContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  return contentType.toLowerCase().includes("application/json");
}

function normalizeBaseUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function normalizeRepoKey(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

async function runWithConcurrency<T>(
  total: number,
  concurrency: number,
  worker: (index: number) => Promise<T>,
): Promise<T[]> {
  const safeConcurrency = Math.max(1, Math.min(concurrency, total || 1));
  const results: T[] = new Array(total);
  let cursor = 0;

  const runners = Array.from({ length: safeConcurrency }, async () => {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= total) break;
      results[current] = await worker(current);
    }
  });

  await Promise.all(runners);
  return results;
}

function normalizeProxyPath(raw: unknown): string {
  const input = typeof raw === "string" ? raw.trim() : "/";
  if (!input) return "/";
  if (input.includes("://") || input.startsWith("//")) {
    throw new Error("Proxy path must be relative, not absolute URL");
  }
  const candidate = input.startsWith("/") ? input : `/${input}`;
  const pathname = candidate.split("?")[0].split("#")[0];
  const segments = pathname.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new Error("Proxy path must not contain parent traversal");
  }
  return candidate;
}

function sanitizeIdentityList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const value of raw) {
    const normalized = String(value ?? "").trim();
    if (!normalized || !IDENTITY_RE.test(normalized)) continue;
    out.push(normalized);
  }
  return [...new Set(out)];
}

function sanitizeProxyHeaders(raw: unknown): ProxyHeaders {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const headers: ProxyHeaders = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const normalizedKey = String(key).trim().toLowerCase();
    if (!normalizedKey || BLOCKED_PROXY_HEADERS.has(normalizedKey)) continue;
    if (!/^[-a-z0-9_]+$/i.test(normalizedKey)) continue;
    if (typeof value !== "string") continue;
    const normalizedValue = value.trim();
    if (!normalizedValue) continue;
    headers[normalizedKey] = normalizedValue;
  }
  return headers;
}

function sanitizeProxyQuery(raw: unknown): ProxyQuery {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const query: ProxyQuery = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const normalizedKey = String(key ?? "").trim();
    if (!normalizedKey || !IDENTITY_RE.test(normalizedKey)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      query[normalizedKey] = value;
    }
  }
  return query;
}

function sanitizeRepoCommand(raw: unknown): string {
  const command = String(raw ?? "").trim();
  if (!command || !REPO_COMMAND_RE.test(command)) {
    throw new Error("Invalid repo command");
  }
  if (!ALLOWED_REPO_COMMANDS.has(command)) {
    throw new Error(`Unsupported repo command: ${command}`);
  }
  return command;
}

function sanitizeRepoArgs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const args: string[] = [];
  for (const value of raw) {
    const item = String(value ?? "");
    if (!item) continue;
    if (item.length > 4000) {
      args.push(item.slice(0, 4000));
    } else {
      args.push(item);
    }
    if (args.length >= 64) break;
  }
  return args;
}

function sanitizeRepoEnv(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const envKey = String(key ?? "").trim().toUpperCase();
    if (!envKey || !REPO_ENV_KEY_RE.test(envKey)) continue;
    if (typeof value !== "string") continue;
    env[envKey] = value.slice(0, 4000);
  }
  return env;
}

function sanitizeSearchPattern(raw: unknown): string {
  const pattern = String(raw ?? "").trim();
  if (!pattern) {
    throw new Error("Search pattern is required");
  }
  if (pattern.length > 300) {
    return pattern.slice(0, 300);
  }
  return pattern;
}

function sanitizeSearchGlob(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const glob = raw.trim();
  if (!glob) return null;
  if (!REPO_GLOB_RE.test(glob)) {
    throw new Error("Invalid glob pattern");
  }
  return glob;
}

function sanitizeRepoRelativePath(raw: unknown): string {
  const rel = String(raw ?? "").trim();
  if (!rel) {
    throw new Error("filePath is required");
  }
  if (rel.startsWith("/") || rel.includes("\0")) {
    throw new Error("filePath must be a relative path");
  }
  const normalized = rel.replace(/\\/g, "/");
  if (normalized.split("/").some((part) => part === "..")) {
    throw new Error("filePath must not contain parent traversal");
  }
  return normalized;
}

function parseSearchLine(line: string): { file: string; line: number; text: string } | null {
  const match = line.match(/^(.+?):(\d+):(.*)$/);
  if (!match) return null;
  return {
    file: match[1],
    line: Number(match[2]),
    text: match[3],
  };
}

function buildProxyUrl(baseUrl: string, targetPath: string, query: ProxyQuery): string {
  const url = new URL(targetPath, `${baseUrl}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function limitText(raw: string, maxChars = 200_000): string {
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}\n...[truncated]`;
}

function getIntegrationDepthWeight(repo: FusionRegistryRepo): number {
  const modeKey = String(repo.integrationMode || "").trim().toLowerCase();
  const base = INTEGRATION_DEPTH_WEIGHTS[modeKey] ?? 0.2;
  const runtimeFactor = repo.runtimeIntegrated ? 1 : 0.7;
  const codeFactor = repo.codeIntegrated ? 1 : 0.7;
  return Number((base * runtimeFactor * codeFactor).toFixed(4));
}

export class AgentEcosystemService {
  private readonly workspaceRoot: string;
  private readonly ecosystemRoot: string;
  private readonly composeFile: string;
  private readonly manifestPath: string;
  private readonly registryPath: string;
  private readonly fusionStatusPath: string;

  constructor(opts?: { workspaceRoot?: string }) {
    this.workspaceRoot = path.resolve(opts?.workspaceRoot ?? process.cwd());
    this.ecosystemRoot = path.join(this.workspaceRoot, "external", "agent_ecosystem");
    this.composeFile = path.join(this.workspaceRoot, "docker-compose.agent-ecosystem.yml");
    this.manifestPath = path.join(this.ecosystemRoot, "repos.manifest.json");
    this.registryPath = path.join(this.ecosystemRoot, "fusion.registry.json");
    this.fusionStatusPath = path.join(this.workspaceRoot, "artifacts", "agent_ecosystem_fusion_status.json");
  }

  private readBooleanEnv(key: string, fallback: boolean): boolean {
    const raw = process.env[key];
    if (raw === undefined || raw === null || raw === "") return fallback;
    return toBoolean(raw);
  }

  isLocalOnlyMode(): boolean {
    // Local-only by default: fusion through cloned code + local adapters, not remote API-key integrations.
    return this.readBooleanEnv("AGENT_ECOSYSTEM_LOCAL_ONLY", true);
  }

  isProxyEnabled(): boolean {
    if (this.isLocalOnlyMode()) {
      return this.readBooleanEnv("AGENT_ECOSYSTEM_ENABLE_PROXY", false);
    }
    return this.readBooleanEnv("AGENT_ECOSYSTEM_ENABLE_PROXY", true);
  }

  getConfiguredServices(): ConfiguredService[] {
    return AGENT_ECOSYSTEM_SERVICE_IDS.map((id) => {
      const envKey = SERVICE_ENV_KEYS[id];
      const envValue = normalizeBaseUrl(process.env[envKey]);
      if (envValue) {
        return { id, baseUrl: envValue, enabled: true, source: "env" as const };
      }
      const defaultValue = normalizeBaseUrl(DEFAULT_SERVICE_URLS[id]);
      if (defaultValue) {
        return { id, baseUrl: defaultValue, enabled: true, source: "default" as const };
      }
      return { id, baseUrl: null, enabled: false, source: "none" as const };
    });
  }

  private resolveServiceConfig(serviceId: AgentEcosystemServiceId): ConfiguredService {
    const hit = this.getConfiguredServices().find((service) => service.id === serviceId);
    if (!hit) {
      throw new Error(`Unknown service: ${serviceId}`);
    }
    return hit;
  }

  async probeService(serviceId: AgentEcosystemServiceId, timeoutMs = 4000): Promise<ServiceProbe> {
    const service = this.resolveServiceConfig(serviceId);
    if (!service.enabled || !service.baseUrl) {
      return { ok: false, status: null, url: null, error: "service_not_configured", durationMs: 0 };
    }

    const probePaths = SERVICE_PROBE_PATHS[serviceId] ?? ["/"];
    const startedAt = Date.now();
    let lastError = "probe_failed";
    let lastStatus: number | null = null;
    let lastUrl: string | null = null;

    for (const probePath of probePaths) {
      const targetUrl = buildProxyUrl(service.baseUrl, probePath, {});
      lastUrl = targetUrl;
      try {
        const response = await fetch(targetUrl, {
          method: "GET",
          signal: AbortSignal.timeout(timeoutMs),
        });
        lastStatus = response.status;
        if (response.ok) {
          return {
            ok: true,
            status: response.status,
            url: targetUrl,
            durationMs: Date.now() - startedAt,
          };
        }
        if (response.status >= 200 && response.status < 500) {
          return {
            ok: true,
            status: response.status,
            url: targetUrl,
            error: `http_${response.status}`,
            reachableNon2xx: true,
            durationMs: Date.now() - startedAt,
          };
        }
        lastError = `http_${response.status}`;
      } catch (error: any) {
        lastError = String(error?.message || error || "request_failed");
      }
    }

    return {
      ok: false,
      status: lastStatus,
      url: lastUrl,
      error: lastError,
      durationMs: Date.now() - startedAt,
    };
  }

  private async resolveRepoDirectory(repoRaw: unknown): Promise<{
    repo: string;
    repoPath: string;
    manifestRepo: RepoManifestRepo | null;
  }> {
    const repo = String(repoRaw ?? "").trim();
    if (!repo || !IDENTITY_RE.test(repo)) {
      throw new Error("Invalid repo id");
    }

    const manifest = await readJsonFile<RepoManifest>(this.manifestPath);
    const manifestRepo = (manifest?.repos ?? []).find((entry) => entry.name === repo) ?? null;
    const fallbackRelative = path.join("external", "agent_ecosystem", repo);
    const relativePath = manifestRepo?.path || fallbackRelative;
    const repoPath = path.resolve(this.workspaceRoot, relativePath);

    if (!isPathInside(this.ecosystemRoot, repoPath)) {
      throw new Error(`Repo path is outside ecosystem root: ${repo}`);
    }

    const stat = await fs.stat(repoPath).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      throw new Error(`Repo directory not found: ${repo}`);
    }

    return { repo, repoPath, manifestRepo };
  }

  private getRepoRuntimeService(repoName: string): AgentEcosystemServiceId | null {
    const normalized = normalizeRepoKey(repoName);
    return REPO_RUNTIME_SERVICE_MAP[normalized] ?? null;
  }

  private getRepoSmokeRule(repoName: string): RepoSmokeRule {
    const normalized = normalizeRepoKey(repoName);
    const rule = REPO_SMOKE_RULES[normalized];
    if (rule) return rule;
    return {
      anyOf: ["README.md", "README.rst", "README"],
      note: "Default smoke rule checks for a repository readme.",
    };
  }

  private async runRepoSmokeCheck(repoName: string, repoPath: string) {
    const rule = this.getRepoSmokeRule(repoName);
    const allOf = (rule.allOf ?? []).filter(Boolean);
    const anyOf = (rule.anyOf ?? []).filter(Boolean);

    const allOfChecks = await Promise.all(
      allOf.map(async (relativePath) => {
        const absolutePath = path.resolve(repoPath, relativePath);
        if (!isPathInside(repoPath, absolutePath)) {
          return { path: relativePath, ok: false };
        }
        return { path: relativePath, ok: await pathExists(absolutePath) };
      }),
    );

    const anyOfChecks = await Promise.all(
      anyOf.map(async (relativePath) => {
        const absolutePath = path.resolve(repoPath, relativePath);
        if (!isPathInside(repoPath, absolutePath)) {
          return { path: relativePath, ok: false };
        }
        return { path: relativePath, ok: await pathExists(absolutePath) };
      }),
    );

    const missingAllOf = allOfChecks.filter((entry) => !entry.ok).map((entry) => entry.path);
    const matchedAnyOf = anyOfChecks.filter((entry) => entry.ok).map((entry) => entry.path);
    const missingAnyOf = anyOfChecks.filter((entry) => !entry.ok).map((entry) => entry.path);
    const anyOfSatisfied = anyOf.length === 0 || matchedAnyOf.length > 0;
    const ok = missingAllOf.length === 0 && anyOfSatisfied;

    return {
      ok,
      note: rule.note ?? null,
      checkedCount: allOf.length + anyOf.length,
      requiredAllOf: allOf,
      requiredAnyOf: anyOf,
      matchedAnyOf,
      missingAllOf,
      missingAnyOf: anyOfSatisfied ? [] : missingAnyOf,
    };
  }

  async deepAuditFusion(input?: AgentEcosystemDeepAuditRequest) {
    const timeoutMs = clampInt(input?.timeoutMs, 6_000, 1_000, 120_000);
    const includeAdapters = input?.includeAdapters ?? true;
    const includeRuntime = input?.includeRuntime ?? true;
    const includeSmoke = input?.includeSmoke ?? true;
    const concurrency = clampInt(input?.concurrency, 4, 1, 12);
    const maxRepos = clampInt(input?.maxRepos, 200, 1, 5_000);

    const manifest = await readJsonFile<RepoManifest>(this.manifestPath);
    const registry = await readJsonFile<FusionRegistry>(this.registryPath);

    const manifestRepos = (manifest?.repos ?? []).slice(0, maxRepos);
    const registryByName = new Map<string, FusionRegistryRepo>();
    for (const repo of registry?.repos ?? []) {
      registryByName.set(normalizeRepoKey(repo.name), repo);
      if (normalizeRepoKey(repo.name) === "openclaw-upstream") {
        registryByName.set("openclaw", repo);
      }
    }

    const runtimeProbeCache = new Map<AgentEcosystemServiceId, Promise<ServiceProbe>>();
    const getRuntimeProbe = (serviceId: AgentEcosystemServiceId) => {
      if (!runtimeProbeCache.has(serviceId)) {
        runtimeProbeCache.set(serviceId, this.probeService(serviceId, timeoutMs));
      }
      return runtimeProbeCache.get(serviceId)!;
    };

    const repos = await runWithConcurrency(manifestRepos.length, concurrency, async (index) => {
      const manifestRepo = manifestRepos[index];
      const repoName = String(manifestRepo.name);
      const normalizedName = normalizeRepoKey(repoName);
      const clonePath = path.resolve(
        this.workspaceRoot,
        manifestRepo.path || path.join("external", "agent_ecosystem", repoName),
      );
      const cloned = Boolean(manifestRepo.exists);
      const registryRepo = registryByName.get(normalizedName) ?? null;

      const runtimeService = this.getRepoRuntimeService(repoName);
      const runtimeProbe =
        includeRuntime && runtimeService ? await getRuntimeProbe(runtimeService) : null;

      let adapterProbe: Awaited<ReturnType<AgentEcosystemService["probeRepoAdapter"]>> | null = null;
      if (includeAdapters && cloned) {
        try {
          adapterProbe = await this.probeRepoAdapter({
            repo: repoName,
            timeoutMs,
          });
        } catch (error: any) {
          adapterProbe = {
            ok: false,
            repo: repoName,
            adapter: "control-plane-repo-adapter" as const,
            cwd: clonePath,
            durationMs: 0,
            timeoutMs,
            timedOut: false,
            exitCode: 1,
            stderr: String(error?.message || error || "adapter_probe_failed"),
            stdout: "",
          };
        }
      }

      let smoke:
        | {
            ok: boolean;
            note: string | null;
            checkedCount: number;
            requiredAllOf: string[];
            requiredAnyOf: string[];
            matchedAnyOf: string[];
            missingAllOf: string[];
            missingAnyOf: string[];
          }
        | null = null;
      if (includeSmoke && cloned) {
        smoke = await this.runRepoSmokeCheck(repoName, clonePath);
      }

      const hasRuntimeBinding = Boolean(runtimeService);
      const weights = hasRuntimeBinding
        ? { clone: 10, adapter: 35, runtime: 35, smoke: 20 }
        : { clone: 10, adapter: 45, runtime: 0, smoke: 45 };
      const maxScore = weights.clone + weights.adapter + weights.runtime + weights.smoke;

      let score = cloned ? weights.clone : 0;
      if (includeAdapters) {
        score += adapterProbe?.ok ? weights.adapter : 0;
      } else {
        score += weights.adapter;
      }
      if (hasRuntimeBinding) {
        if (includeRuntime) {
          score += runtimeProbe?.ok ? weights.runtime : 0;
        } else {
          score += weights.runtime;
        }
      }
      if (includeSmoke) {
        score += smoke?.ok ? weights.smoke : 0;
      } else {
        score += weights.smoke;
      }

      const scorePct = maxScore > 0 ? Number(((score / maxScore) * 100).toFixed(2)) : 0;

      const gaps: Array<{
        severity: "high" | "medium" | "low";
        category: "clone" | "adapter" | "runtime" | "smoke";
        message: string;
        remediation: string[];
      }> = [];

      if (!cloned) {
        gaps.push({
          severity: "high",
          category: "clone",
          message: "Repository is not present locally in external/agent_ecosystem.",
          remediation: ["pnpm ecosystem:sync", `pnpm ecosystem:status`],
        });
      }
      if (includeAdapters && cloned && adapterProbe && !adapterProbe.ok) {
        gaps.push({
          severity: "high",
          category: "adapter",
          message: `Repo adapter probe failed: ${adapterProbe.stderr || "unknown error"}`,
          remediation: [
            `POST /api/agent-ecosystem/repos/probe {"repo":"${repoName}"}`,
            `POST /api/agent-ecosystem/repos/exec {"repo":"${repoName}","command":"pwd"}`,
          ],
        });
      }
      if (includeRuntime && runtimeService && runtimeProbe && !runtimeProbe.ok) {
        gaps.push({
          severity: "high",
          category: "runtime",
          message: `Runtime service ${runtimeService} is unreachable (${runtimeProbe.error || "probe_failed"}).`,
          remediation: [
            "POST /api/agent-ecosystem/compose {\"action\":\"up\",\"profiles\":[\"core\"]}",
            `GET /api/agent-ecosystem/health/${runtimeService}`,
          ],
        });
      }
      if (includeSmoke && cloned && smoke && !smoke.ok) {
        gaps.push({
          severity: "medium",
          category: "smoke",
          message: `Repository structure smoke-check failed (missing: ${[
            ...smoke.missingAllOf,
            ...smoke.missingAnyOf,
          ].join(", ") || "unknown"}).`,
          remediation: [
            `POST /api/agent-ecosystem/repos/read {"repo":"${repoName}","filePath":"README.md"}`,
            `POST /api/agent-ecosystem/repos/search {"repo":"${repoName}","pattern":"README"}`,
          ],
        });
      }

      return {
        repo: repoName,
        normalizedRepo: normalizedName,
        clonePath,
        cloned,
        role: registryRepo?.role ?? null,
        integrationMode: registryRepo?.integrationMode ?? null,
        runtimeBinding: runtimeService,
        adapter: includeAdapters
          ? {
              ok: Boolean(adapterProbe?.ok),
              durationMs: adapterProbe?.durationMs ?? null,
              exitCode: adapterProbe?.exitCode ?? null,
              timedOut: adapterProbe?.timedOut ?? null,
              error: adapterProbe && !adapterProbe.ok ? adapterProbe.stderr || "adapter_probe_failed" : null,
            }
          : null,
        runtime: includeRuntime
          ? runtimeService
            ? {
                required: true,
                service: runtimeService,
                ok: Boolean(runtimeProbe?.ok),
                status: runtimeProbe?.status ?? null,
                durationMs: runtimeProbe?.durationMs ?? null,
                error: runtimeProbe && !runtimeProbe.ok ? runtimeProbe.error || "runtime_probe_failed" : null,
              }
            : {
                required: false,
                service: null,
                ok: null,
                status: null,
                durationMs: null,
                error: null,
              }
          : null,
        smoke: includeSmoke ? smoke : null,
        scorePct,
        gaps,
      };
    });

    const allGaps = repos.flatMap((repo) =>
      repo.gaps.map((gap) => ({
        repo: repo.repo,
        severity: gap.severity,
        category: gap.category,
        message: gap.message,
        remediation: gap.remediation,
      })),
    );

    const highPriorityGaps = allGaps.filter((gap) => gap.severity === "high").length;
    const mediumPriorityGaps = allGaps.filter((gap) => gap.severity === "medium").length;
    const lowPriorityGaps = allGaps.filter((gap) => gap.severity === "low").length;

    const adapterEnabledRepos = repos.filter((repo) => repo.adapter !== null).length;
    const adapterReadyRepos = repos.filter((repo) => repo.adapter?.ok).length;
    const runtimeRequiredRepos = repos.filter((repo) => repo.runtime?.required).length;
    const runtimeReadyRepos = repos.filter((repo) => repo.runtime?.ok).length;
    const smokeEnabledRepos = repos.filter((repo) => repo.smoke !== null).length;
    const smokeReadyRepos = repos.filter((repo) => repo.smoke?.ok).length;
    const experientialFusionPct = repos.length
      ? Number((repos.reduce((acc, repo) => acc + repo.scorePct, 0) / repos.length).toFixed(2))
      : 0;
    const productionReadyRepos = repos.filter((repo) => repo.scorePct >= 95).length;

    return {
      timestamp: new Date().toISOString(),
      workspaceRoot: this.workspaceRoot,
      ecosystemRoot: this.ecosystemRoot,
      localOnlyMode: this.isLocalOnlyMode(),
      assessedRepos: repos.length,
      totalManifestRepos: manifest?.total ?? repos.length,
      options: {
        timeoutMs,
        maxRepos,
        includeAdapters,
        includeRuntime,
        includeSmoke,
        concurrency,
      },
      summary: {
        experientialFusionPct,
        productionReadyRepos,
        adapterReadyRepos,
        adapterReadyPct: adapterEnabledRepos
          ? Number(((adapterReadyRepos / adapterEnabledRepos) * 100).toFixed(2))
          : 0,
        runtimeReadyRepos,
        runtimeReadyPct: runtimeRequiredRepos
          ? Number(((runtimeReadyRepos / runtimeRequiredRepos) * 100).toFixed(2))
          : 0,
        smokeReadyRepos,
        smokeReadyPct: smokeEnabledRepos
          ? Number(((smokeReadyRepos / smokeEnabledRepos) * 100).toFixed(2))
          : 0,
        highPriorityGaps,
        mediumPriorityGaps,
        lowPriorityGaps,
      },
      gaps: allGaps,
      repos,
    };
  }

  async getFusionStatus(opts?: { live?: boolean; timeoutMs?: number; deep?: boolean; deepMaxRepos?: number }) {
    const live = toBoolean(opts?.live);
    const deep = toBoolean(opts?.deep);
    const timeoutMs = clampInt(opts?.timeoutMs, 4000, 500, 30_000);
    const deepMaxRepos = clampInt(opts?.deepMaxRepos, 200, 1, 5000);
    const manifest = await readJsonFile<RepoManifest>(this.manifestPath);
    const registry = await readJsonFile<FusionRegistry>(this.registryPath);
    const report = await readJsonFile<Record<string, unknown>>(this.fusionStatusPath);
    const configuredServices = this.getConfiguredServices();

    const healthByService: Record<string, ServiceProbe | undefined> = {};
    if (live) {
      await Promise.all(
        configuredServices.map(async (service) => {
          healthByService[service.id] = await this.probeService(service.id, timeoutMs);
        }),
      );
    }

    const registryRepos = registry?.repos ?? [];
    const runtimeIntegratedCount = registryRepos.filter((repo) => Boolean(repo.runtimeIntegrated)).length;
    const codeIntegratedCount = registryRepos.filter((repo) => Boolean(repo.codeIntegrated)).length;
    const softwareIntegratedCount = registryRepos.filter(
      (repo) => Boolean(repo.runtimeIntegrated) || Boolean(repo.codeIntegrated),
    ).length;
    const totalRepos = manifest?.total ?? registryRepos.length ?? 0;
    const depthScoreSum = registryRepos.reduce((acc, repo) => acc + getIntegrationDepthWeight(repo), 0);
    const deepFusionPct = totalRepos ? Number(((depthScoreSum / totalRepos) * 100).toFixed(2)) : 0;
    const deepAudit = deep
      ? await this.deepAuditFusion({
          timeoutMs,
          maxRepos: deepMaxRepos,
          includeAdapters: true,
          includeRuntime: true,
          includeSmoke: true,
        })
      : null;

    return {
      timestamp: new Date().toISOString(),
      workspaceRoot: this.workspaceRoot,
      ecosystemRoot: this.ecosystemRoot,
      integrationPolicy: {
        localOnlyMode: this.isLocalOnlyMode(),
        proxyEnabled: this.isProxyEnabled(),
        apiKeylessFusion: true,
      },
      configuredServices,
      liveHealthEnabled: live,
      healthByService: live ? healthByService : undefined,
      deepAuditEnabled: deep,
      deepAudit: deepAudit ?? undefined,
      manifest: manifest ?? null,
      registry: registry ?? null,
      report: report ?? null,
      summary: {
        totalRepos,
        clonedRepos: manifest?.cloned ?? 0,
        runtimeIntegratedRepos: runtimeIntegratedCount,
        codeIntegratedRepos: codeIntegratedCount,
        softwareIntegratedRepos: softwareIntegratedCount,
        runtimeFusionPct: totalRepos
          ? Number(((runtimeIntegratedCount / totalRepos) * 100).toFixed(2))
          : 0,
        softwareFusionPct: totalRepos
          ? Number(((softwareIntegratedCount / totalRepos) * 100).toFixed(2))
          : 0,
        totalFusionPct: totalRepos
          ? Number(((softwareIntegratedCount / totalRepos) * 100).toFixed(2))
          : 0,
        deepFusionPct,
      },
    };
  }

  async execRepoCommand(input: AgentEcosystemRepoExecRequest) {
    const repoRef = await this.resolveRepoDirectory(input.repo);
    const command = sanitizeRepoCommand(input.command);
    const args = sanitizeRepoArgs(input.args);
    const timeoutMs = clampInt(input.timeoutMs, 120_000, 1_000, 900_000);
    const env = sanitizeRepoEnv(input.env);
    const startedAt = Date.now();
    const maxOutputChars = 600_000;

    return await new Promise<{
      ok: boolean;
      exitCode: number;
      repo: string;
      cwd: string;
      command: string;
      args: string[];
      stdout: string;
      stderr: string;
      timeoutMs: number;
      durationMs: number;
      timedOut: boolean;
    }>((resolve) => {
      const child = spawn(command, args, {
        cwd: repoRef.repoPath,
        env: { ...process.env, ...env },
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const onData = (target: "stdout" | "stderr", chunk: Buffer) => {
        const text = chunk.toString("utf8");
        if (target === "stdout") {
          stdout = (stdout + text).slice(-maxOutputChars);
        } else {
          stderr = (stderr + text).slice(-maxOutputChars);
        }
      };

      child.stdout.on("data", (chunk: Buffer) => onData("stdout", chunk));
      child.stderr.on("data", (chunk: Buffer) => onData("stderr", chunk));

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);

      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          exitCode: 1,
          repo: repoRef.repo,
          cwd: repoRef.repoPath,
          command,
          args,
          stdout: limitText(stdout),
          stderr: limitText(`${stderr}\n${error.message}`),
          timeoutMs,
          durationMs: Date.now() - startedAt,
          timedOut,
        });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const exitCode = typeof code === "number" ? code : 1;
        resolve({
          ok: exitCode === 0 && !timedOut,
          exitCode,
          repo: repoRef.repo,
          cwd: repoRef.repoPath,
          command,
          args,
          stdout: limitText(stdout),
          stderr: limitText(stderr),
          timeoutMs,
          durationMs: Date.now() - startedAt,
          timedOut,
        });
      });
    });
  }

  private runSearchCommand(params: {
    command: string;
    args: string[];
    cwd: string;
    timeoutMs: number;
    maxOutputChars?: number;
  }) {
    const startedAt = Date.now();
    const maxOutputChars = clampInt(params.maxOutputChars, 600_000, 1000, 2_000_000);
    return new Promise<{
      ok: boolean;
      exitCode: number;
      stdout: string;
      stderr: string;
      command: string;
      args: string[];
      timedOut: boolean;
      durationMs: number;
      spawnError?: string;
    }>((resolve) => {
      const child = spawn(params.command, params.args, {
        cwd: params.cwd,
        env: process.env,
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let spawnError: string | undefined;

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = (stdout + chunk.toString("utf8")).slice(-maxOutputChars);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString("utf8")).slice(-maxOutputChars);
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, params.timeoutMs);

      child.on("error", (error) => {
        spawnError = String(error?.message || error || "spawn_failed");
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const exitCode = typeof code === "number" ? code : 1;
        resolve({
          ok: exitCode === 0 && !timedOut && !spawnError,
          exitCode,
          stdout: limitText(stdout),
          stderr: limitText(stderr),
          command: params.command,
          args: params.args,
          timedOut,
          durationMs: Date.now() - startedAt,
          spawnError,
        });
      });
    });
  }

  async searchRepoCode(input: AgentEcosystemRepoSearchRequest) {
    const pattern = sanitizeSearchPattern(input.pattern);
    const glob = sanitizeSearchGlob(input.glob);
    const maxResults = clampInt(input.maxResults, 80, 1, 1000);
    const timeoutMs = clampInt(input.timeoutMs, 60_000, 1000, 600_000);
    const repoName = typeof input.repo === "string" && input.repo.trim() ? input.repo.trim() : null;

    let searchRoot = this.ecosystemRoot;
    let scopeRepo: string | null = null;
    if (repoName) {
      const repoRef = await this.resolveRepoDirectory(repoName);
      searchRoot = repoRef.repoPath;
      scopeRepo = repoRef.repo;
    }

    const rgArgs = ["--line-number", "--no-heading", "--color", "never", pattern, "."];
    if (glob) {
      rgArgs.push("--glob", glob);
    }
    const grepArgs = ["-R", "-n", "-I", pattern, "."];

    let result = await this.runSearchCommand({
      command: "rg",
      args: rgArgs,
      cwd: searchRoot,
      timeoutMs,
    });

    let backend = "rg";
    if (result.spawnError && /ENOENT/i.test(result.spawnError)) {
      result = await this.runSearchCommand({
        command: "grep",
        args: grepArgs,
        cwd: searchRoot,
        timeoutMs,
      });
      backend = "grep";
    }

    const lines = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
    const hits = [];
    for (const raw of lines) {
      const parsed = parseSearchLine(raw);
      if (!parsed) continue;
      const normalizedFile = parsed.file.replace(/\\/g, "/").replace(/^\.\//, "");
      const inferredRepo = scopeRepo || normalizedFile.split("/")[0] || null;
      hits.push({
        repo: inferredRepo,
        file: normalizedFile,
        line: parsed.line,
        text: parsed.text,
      });
      if (hits.length >= maxResults) break;
    }

    return {
      ok: result.ok || hits.length > 0,
      backend,
      repo: scopeRepo,
      pattern,
      glob,
      hits,
      totalHits: hits.length,
      truncated: lines.length > hits.length,
      command: result.command,
      args: result.args,
      exitCode: result.exitCode,
      stdout: hits.length === 0 ? result.stdout : undefined,
      stderr: result.stderr || (result.spawnError ? String(result.spawnError) : ""),
      timeoutMs,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
    };
  }

  async readRepoFile(input: AgentEcosystemRepoReadRequest) {
    const repoRef = await this.resolveRepoDirectory(input.repo);
    const relativePath = sanitizeRepoRelativePath(input.filePath);
    const absolutePath = path.resolve(repoRef.repoPath, relativePath);
    if (!isPathInside(repoRef.repoPath, absolutePath)) {
      throw new Error("Resolved file path is outside repo root");
    }

    const stat = await fs.stat(absolutePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      throw new Error(`File not found: ${relativePath}`);
    }
    const maxBytes = clampInt(input.maxBytes, 200_000, 1_000, 2_000_000);
    const raw = await fs.readFile(absolutePath);
    const truncated = raw.length > maxBytes;
    const content = raw.subarray(0, maxBytes).toString("utf8");

    return {
      ok: true,
      repo: repoRef.repo,
      filePath: relativePath,
      absolutePath,
      sizeBytes: stat.size,
      maxBytes,
      truncated,
      content,
    };
  }

  async probeRepoAdapter(input: AgentEcosystemRepoProbeRequest) {
    const timeoutMs = clampInt(input.timeoutMs, 10_000, 1_000, 120_000);
    const result = await this.execRepoCommand({
      repo: input.repo,
      command: "pwd",
      args: [],
      timeoutMs,
    });

    return {
      ok: result.ok,
      repo: result.repo,
      adapter: "control-plane-repo-adapter" as const,
      cwd: result.cwd,
      durationMs: result.durationMs,
      timeoutMs,
      timedOut: result.timedOut,
      exitCode: result.exitCode,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  }

  async probeAllRepoAdapters(opts?: { timeoutMs?: number; maxRepos?: number }) {
    const timeoutMs = clampInt(opts?.timeoutMs, 10_000, 1_000, 120_000);
    const maxRepos = clampInt(opts?.maxRepos, 200, 1, 5000);
    const manifest = await readJsonFile<RepoManifest>(this.manifestPath);
    const repos = (manifest?.repos ?? [])
      .filter((repo) => Boolean(repo.exists))
      .map((repo) => repo.name)
      .slice(0, maxRepos);

    const probes = [];
    for (const repo of repos) {
      try {
        const probe = await this.probeRepoAdapter({ repo, timeoutMs });
        probes.push(probe);
      } catch (error: any) {
        probes.push({
          ok: false,
          repo,
          adapter: "control-plane-repo-adapter" as const,
          cwd: null,
          durationMs: 0,
          timeoutMs,
          timedOut: false,
          exitCode: 1,
          stderr: String(error?.message || error || "probe_failed"),
          stdout: "",
        });
      }
    }

    const okCount = probes.filter((probe) => probe.ok).length;
    return {
      ok: okCount === probes.length && probes.length > 0,
      total: probes.length,
      okCount,
      failCount: probes.length - okCount,
      okPct: probes.length ? Number(((okCount / probes.length) * 100).toFixed(2)) : 0,
      timeoutMs,
      probes,
      timestamp: new Date().toISOString(),
    };
  }

  async proxyRequest(input: AgentEcosystemProxyRequest) {
    if (!this.isProxyEnabled()) {
      throw new Error(
        "service_proxy_disabled: enable AGENT_ECOSYSTEM_ENABLE_PROXY=true to use /proxy (local-only fusion keeps it off by default)",
      );
    }
    const service = this.resolveServiceConfig(input.service);
    if (!service.enabled || !service.baseUrl) {
      throw new Error(`Service ${input.service} is not configured`);
    }

    const method = (String(input.method || "GET").toUpperCase() as AgentEcosystemHttpMethod);
    if (!PROXY_METHODS.has(method)) {
      throw new Error(`Unsupported method: ${method}`);
    }

    const proxyPath = normalizeProxyPath(input.path ?? "/");
    const query = sanitizeProxyQuery(input.query);
    const headers = sanitizeProxyHeaders(input.headers);
    const timeoutMs = clampInt(input.timeoutMs, 15_000, 500, 120_000);
    const targetUrl = buildProxyUrl(service.baseUrl, proxyPath, query);
    const requestInit: RequestInit = {
      method,
      headers: { ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    };

    if (input.body !== undefined && method !== "GET") {
      if (!requestInit.headers) {
        requestInit.headers = {};
      }
      if (!requestInit.headers["content-type"]) {
        requestInit.headers["content-type"] = "application/json";
      }
      requestInit.body =
        typeof input.body === "string" ? input.body : JSON.stringify(input.body);
    }

    const startedAt = Date.now();
    const response = await fetch(targetUrl, requestInit);
    const rawBody = await response.text();
    const contentType = response.headers.get("content-type");
    const boundedBody = limitText(rawBody);

    let parsedBody: unknown = boundedBody;
    if (isJsonLikeContentType(contentType)) {
      try {
        parsedBody = JSON.parse(boundedBody);
      } catch {
        parsedBody = boundedBody;
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      service: input.service,
      method,
      url: targetUrl,
      contentType,
      headers: Object.fromEntries(response.headers.entries()),
      body: parsedBody,
      durationMs: Date.now() - startedAt,
    };
  }

  private buildComposeArgs(input: AgentEcosystemComposeRequest): string[] {
    const profiles = sanitizeIdentityList(input.profiles);
    const services = sanitizeIdentityList(input.services);
    const args: string[] = ["compose", "-f", this.composeFile];

    for (const profile of profiles) {
      args.push("--profile", profile);
    }

    switch (input.action) {
      case "up":
        args.push("up", "-d", ...services);
        break;
      case "down":
        args.push("down");
        break;
      case "ps":
        args.push("ps", ...services);
        break;
      case "restart":
        args.push("restart", ...services);
        break;
      case "logs": {
        const lines = clampInt(input.lines, 200, 1, 2000);
        args.push("logs", "--no-color", "--tail", String(lines));
        if (toBoolean(input.follow)) {
          args.push("--follow");
        }
        args.push(...services);
        break;
      }
      default:
        throw new Error(`Unsupported compose action: ${input.action}`);
    }

    return args;
  }

  private async ensureComposeFileExists(): Promise<void> {
    try {
      await fs.access(this.composeFile);
    } catch {
      throw new Error(`Compose file not found: ${this.composeFile}`);
    }
  }

  async runCompose(input: AgentEcosystemComposeRequest) {
    await this.ensureComposeFileExists();
    const args = this.buildComposeArgs(input);
    const timeoutMs = clampInt(input.timeoutMs, 120_000, 1000, 900_000);
    const startedAt = Date.now();
    const maxOutputChars = 600_000;

    return await new Promise<{
      ok: boolean;
      exitCode: number;
      stdout: string;
      stderr: string;
      args: string[];
      timeoutMs: number;
      durationMs: number;
      timedOut: boolean;
    }>((resolve) => {
      const child = spawn("docker", args, {
        cwd: this.workspaceRoot,
        env: process.env,
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const onData = (target: "stdout" | "stderr", chunk: Buffer) => {
        const text = chunk.toString("utf8");
        if (target === "stdout") {
          stdout = (stdout + text).slice(-maxOutputChars);
        } else {
          stderr = (stderr + text).slice(-maxOutputChars);
        }
      };

      child.stdout.on("data", (chunk: Buffer) => onData("stdout", chunk));
      child.stderr.on("data", (chunk: Buffer) => onData("stderr", chunk));

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);

      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          exitCode: 1,
          stdout: limitText(stdout),
          stderr: limitText(`${stderr}\n${error.message}`),
          args,
          timeoutMs,
          durationMs: Date.now() - startedAt,
          timedOut,
        });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const exitCode = typeof code === "number" ? code : 1;
        resolve({
          ok: exitCode === 0 && !timedOut,
          exitCode,
          stdout: limitText(stdout),
          stderr: limitText(stderr),
          args,
          timeoutMs,
          durationMs: Date.now() - startedAt,
          timedOut,
        });
      });
    });
  }

  private runLocalScript(scriptRelativePath: string, timeoutMs = 120_000) {
    const scriptPath = path.join(this.workspaceRoot, scriptRelativePath);
    return new Promise<{
      ok: boolean;
      exitCode: number;
      stdout: string;
      stderr: string;
      scriptPath: string;
      durationMs: number;
    }>((resolve) => {
      const startedAt = Date.now();
      const child = spawn("bash", [scriptPath], {
        cwd: this.workspaceRoot,
        env: process.env,
      });

      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = (stdout + chunk.toString("utf8")).slice(-300_000);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString("utf8")).slice(-300_000);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          exitCode: 1,
          stdout: limitText(stdout),
          stderr: limitText(`${stderr}\n${error.message}`),
          scriptPath,
          durationMs: Date.now() - startedAt,
        });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const exitCode = typeof code === "number" ? code : 1;
        resolve({
          ok: exitCode === 0,
          exitCode,
          stdout: limitText(stdout),
          stderr: limitText(stderr),
          scriptPath,
          durationMs: Date.now() - startedAt,
        });
      });
    });
  }

  syncRepos(timeoutMs = 300_000) {
    return this.runLocalScript("scripts/agent-ecosystem-sync.sh", timeoutMs);
  }

  refreshRepoManifest(timeoutMs = 120_000) {
    return this.runLocalScript("scripts/agent-ecosystem-status.sh", timeoutMs);
  }
}

export const agentEcosystemService = new AgentEcosystemService();
