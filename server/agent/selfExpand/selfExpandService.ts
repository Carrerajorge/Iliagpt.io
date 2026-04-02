import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import * as ts from "typescript";
import { contextManager } from "../context";
import { policyEngine } from "../policyEngine";
import {
  SelfExpandRegistryEntry,
  loadSelfExpandRegistrySync,
  resolveSelfExpandRoot,
  createFusedToolDefinition,
  upsertSelfExpandRegistryEntrySync,
} from "./selfExpandRuntime";
import { SELF_EXPAND_CATALOG } from "./selfExpandCatalog";
import type { ToolContext, ToolDefinition } from "../toolRegistry";
import { loadAgentEcosystemWorkspace } from "../../services/agentEcosystemWorkspace";

export type SelfExpandRequest = {
  capability: string;
  description?: string;
  repoHints?: string[];
  allowNetwork?: boolean;
  searchProviders?: Array<"github" | "gitlab" | "npm" | "pypi" | "local">;
  maxCandidates?: number;
  exportName?: string;
  entryFile?: string;
  dryRun?: boolean;
};

export type SelfExpandResult = {
  capability: string;
  toolName: string;
  status:
    | "expanded"
    | "already_available"
    | "no_candidates"
    | "clone_failed"
    | "analysis_failed"
    | "integration_failed"
    | "needs_port"
    | "dry_run";
  selectedCandidate?: Candidate;
  repoPath?: string;
  entryPath?: string;
  warnings?: string[];
  notes?: string[];
};

type Candidate = {
  provider: "github" | "gitlab" | "npm" | "pypi" | "local" | "unknown";
  name: string;
  url?: string;
  path?: string;
  description?: string;
  reason?: string;
  score?: number;
};

type RepoAnalysis = {
  language: "js" | "ts" | "python" | "cpp" | "rust" | "unknown";
  entryFile?: string;
  moduleRoot?: string;
  packageJson?: Record<string, any>;
};

type CommandResult = { code: number | null; stdout: string; stderr: string };

const SAFE_TOOL_NAME = /^[a-zA-Z0-9_-]{2,80}$/;
const DEFAULT_PROVIDERS: SelfExpandRequest["searchProviders"] = ["local", "github", "gitlab", "npm", "pypi"];

function sanitizeToolName(name: string): string {
  const trimmed = name.trim();
  if (SAFE_TOOL_NAME.test(trimmed)) return trimmed;
  const cleaned = trimmed.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length >= 2 ? cleaned.slice(0, 80) : "capability";
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

async function runCommand(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<CommandResult> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : null;

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: null, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function commandExists(cmd: string): Promise<boolean> {
  const res = await runCommand("bash", ["-lc", `command -v ${cmd}`], { timeoutMs: 2000 });
  return res.code === 0 && res.stdout.trim().length > 0;
}

function parseRepoHint(hint: string): Candidate | null {
  const trimmed = hint.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("github:")) {
    const name = trimmed.slice("github:".length).trim();
    return { provider: "github", name, url: `https://github.com/${name}.git` };
  }
  if (lower.startsWith("gitlab:")) {
    const name = trimmed.slice("gitlab:".length).trim();
    return { provider: "gitlab", name, url: `https://gitlab.com/${name}.git` };
  }
  if (lower.startsWith("npm:")) {
    const name = trimmed.slice("npm:".length).trim();
    return { provider: "npm", name };
  }
  if (lower.startsWith("pypi:")) {
    const name = trimmed.slice("pypi:".length).trim();
    return { provider: "pypi", name };
  }
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    if (lower.includes("github.com")) {
      return { provider: "github", name: trimmed, url: trimmed };
    }
    if (lower.includes("gitlab.com")) {
      return { provider: "gitlab", name: trimmed, url: trimmed };
    }
    return { provider: "unknown", name: trimmed, url: trimmed };
  }
  if (trimmed.includes("/")) {
    return { provider: "github", name: trimmed, url: `https://github.com/${trimmed}.git` };
  }
  return { provider: "unknown", name: trimmed };
}

function scoreCandidate(candidate: Candidate, tokens: string[], providerBoost = 0): number {
  const haystack = `${candidate.name} ${candidate.description || ""} ${candidate.reason || ""}`.toLowerCase();
  let score = providerBoost;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 2;
  }
  if (candidate.provider === "local") score += 2;
  return score;
}

async function searchGithub(query: string, limit: number): Promise<Candidate[]> {
  const res = await runCommand("gh", [
    "search",
    "repos",
    query,
    "--limit",
    String(limit),
    "--json",
    "nameWithOwner,description,stargazersCount",
  ], { timeoutMs: 15000 });
  if (res.code !== 0) return [];
  try {
    const parsed = JSON.parse(res.stdout) as Array<any>;
    return parsed.map((repo) => ({
      provider: "github",
      name: repo.nameWithOwner,
      description: repo.description,
      reason: `stars:${repo.stargazersCount ?? 0}`,
      url: `https://github.com/${repo.nameWithOwner}.git`,
    }));
  } catch {
    return [];
  }
}

async function searchGitlab(query: string, limit: number): Promise<Candidate[]> {
  const res = await runCommand("glab", [
    "search",
    "projects",
    query,
    "--per-page",
    String(limit),
    "--format",
    "json",
  ], { timeoutMs: 15000 });
  if (res.code !== 0) return [];
  try {
    const parsed = JSON.parse(res.stdout) as Array<any>;
    return parsed.map((repo) => ({
      provider: "gitlab",
      name: repo.path_with_namespace || repo.path || repo.name,
      description: repo.description,
      url: repo.http_url_to_repo || repo.web_url,
    }));
  } catch {
    return [];
  }
}

async function searchNpm(query: string, limit: number): Promise<Candidate[]> {
  const res = await runCommand("npm", ["search", query, "--json"], { timeoutMs: 15000 });
  if (res.code !== 0) return [];
  try {
    const parsed = JSON.parse(res.stdout) as Array<any>;
    return parsed.slice(0, limit).map((pkg) => ({
      provider: "npm",
      name: pkg.name,
      description: pkg.description,
      reason: pkg.version ? `version:${pkg.version}` : undefined,
    }));
  } catch {
    return [];
  }
}

async function buildCandidates(
  capability: string,
  options: SelfExpandRequest,
  warnings: string[],
): Promise<Candidate[]> {
  const tokens = tokenize(capability);
  const candidates: Candidate[] = [];

  for (const hint of options.repoHints || []) {
    const parsed = parseRepoHint(hint);
    if (parsed) candidates.push(parsed);
  }

  for (const entry of SELF_EXPAND_CATALOG) {
    const entryKey = entry.capability.toLowerCase();
    const normalized = capability.toLowerCase();
    const capabilityMatch =
      normalized === entryKey ||
      normalized.includes(entryKey) ||
      entryKey.includes(normalized);
    if (capabilityMatch || entry.tags?.some((t) => tokens.includes(t))) {
      for (const candidate of entry.candidates) {
        candidates.push({
          provider: candidate.provider,
          name: candidate.name,
          url: candidate.url,
          reason: candidate.reason,
          description: candidate.tags?.join(", "),
        });
      }
    }
  }

  try {
    const ecosystem = await loadAgentEcosystemWorkspace();
    for (const repo of ecosystem) {
      if (tokens.some((t) => repo.name.toLowerCase().includes(t))) {
        candidates.push({
          provider: "local",
          name: repo.name,
          path: repo.path,
          reason: repo.wave ? `wave:${repo.wave}` : undefined,
        });
      }
    }
  } catch (err: any) {
    warnings.push(`Local workspace scan failed: ${err.message}`);
  }

  if (options.allowNetwork) {
    const providers = options.searchProviders || DEFAULT_PROVIDERS;
    if (providers.includes("github")) {
      if (await commandExists("gh")) {
        candidates.push(...await searchGithub(capability, options.maxCandidates || 5));
      } else {
        warnings.push("GitHub CLI (gh) not found; skipping GitHub search.");
      }
    }
    if (providers.includes("gitlab")) {
      if (await commandExists("glab")) {
        candidates.push(...await searchGitlab(capability, options.maxCandidates || 5));
      } else {
        warnings.push("GitLab CLI (glab) not found; skipping GitLab search.");
      }
    }
    if (providers.includes("npm")) {
      if (await commandExists("npm")) {
        candidates.push(...await searchNpm(capability, options.maxCandidates || 5));
      } else {
        warnings.push("npm not found; skipping npm search.");
      }
    }
    if (providers.includes("pypi")) {
      warnings.push("PyPI search requires explicit package name; none provided.");
    }
  }

  const deduped = new Map<string, Candidate>();
  for (const c of candidates) {
    const key = `${c.provider}:${c.name}`;
    if (!deduped.has(key)) deduped.set(key, c);
  }

  const providerBoost = options.allowNetwork ? 1 : 0;
  const scored = Array.from(deduped.values()).map((c) => ({
    ...c,
    score: scoreCandidate(c, tokens, providerBoost),
  }));

  return scored.sort((a, b) => (b.score || 0) - (a.score || 0));
}

async function ensureRepo(candidate: Candidate, root: string, warnings: string[]): Promise<string | null> {
  if (candidate.path) {
    try {
      const stat = await fs.stat(candidate.path);
      if (stat.isDirectory()) return candidate.path;
    } catch {
      warnings.push(`Local repo path not found: ${candidate.path}`);
    }
  }
  if (!candidate.url) {
    if (candidate.provider === "npm" && candidate.name) {
      if (!await commandExists("npm")) {
        warnings.push("npm not found; cannot resolve npm package to repo.");
        return null;
      }
      const res = await runCommand("npm", ["view", candidate.name, "repository.url"], { timeoutMs: 10000 });
      const url = res.stdout.trim();
      if (url) candidate.url = url.replace(/^git\+/, "");
    }
  }
  if (!candidate.url) return null;

  const destName = sanitizeToolName(candidate.name.replace(/[\/:]/g, "_"));
  const destPath = path.join(root, "sources", destName);
  try {
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    try {
      const existing = await fs.stat(destPath);
      if (existing.isDirectory()) {
        return destPath;
      }
    } catch {
      // ignore
    }
    const gitExists = await commandExists("git");
    if (!gitExists) {
      warnings.push("git not found; cannot clone repository.");
      return null;
    }
    const res = await runCommand("git", ["clone", "--depth", "1", candidate.url, destPath], { timeoutMs: 120000 });
    if (res.code !== 0) {
      warnings.push(`git clone failed: ${res.stderr || res.stdout}`.trim());
      return null;
    }
    return destPath;
  } catch (err: any) {
    warnings.push(`Clone error: ${err.message}`);
    return null;
  }
}

async function analyzeRepo(repoPath: string, explicitEntry?: string): Promise<RepoAnalysis> {
  const hasFile = async (relative: string) => {
    try {
      await fs.stat(path.join(repoPath, relative));
      return true;
    } catch {
      return false;
    }
  };

  let entryFile = explicitEntry;
  if (entryFile) {
    const resolved = path.isAbsolute(entryFile) ? entryFile : path.join(repoPath, entryFile);
    entryFile = resolved;
  }

  let packageJson: Record<string, any> | undefined;
  if (!entryFile && await hasFile("package.json")) {
    const raw = await fs.readFile(path.join(repoPath, "package.json"), "utf8");
    packageJson = JSON.parse(raw);
    const main = packageJson.module || packageJson.main;
    let candidate: string | undefined;
    if (typeof main === "string") {
      candidate = main;
    } else if (packageJson.exports) {
      if (typeof packageJson.exports === "string") {
        candidate = packageJson.exports;
      } else if (typeof packageJson.exports === "object") {
        const rootExport = packageJson.exports["."] || packageJson.exports["./"];
        if (typeof rootExport === "string") {
          candidate = rootExport;
        } else if (rootExport && typeof rootExport === "object") {
          const first = Object.values(rootExport).find((v) => typeof v === "string");
          if (typeof first === "string") candidate = first;
        }
      }
    }
    if (candidate) {
      entryFile = path.join(repoPath, candidate);
    }
  }

  if (!entryFile) {
    const fallbackEntries = [
      "dist/index.js",
      "dist/index.mjs",
      "lib/index.js",
      "src/index.ts",
      "src/index.js",
      "index.js",
      "index.ts",
    ];
    for (const rel of fallbackEntries) {
      if (await hasFile(rel)) {
        entryFile = path.join(repoPath, rel);
        break;
      }
    }
  }

  const hasPy = await hasFile("pyproject.toml") || await hasFile("setup.py");
  const hasRust = await hasFile("Cargo.toml");
  const hasCpp = await hasFile("CMakeLists.txt");

  let language: RepoAnalysis["language"] = "unknown";
  if (entryFile) {
    if (entryFile.endsWith(".ts") || entryFile.endsWith(".tsx")) language = "ts";
    else if (entryFile.endsWith(".js") || entryFile.endsWith(".mjs") || entryFile.endsWith(".cjs")) language = "js";
  } else if (hasPy) {
    language = "python";
  } else if (hasRust) {
    language = "rust";
  } else if (hasCpp) {
    language = "cpp";
  }

  const moduleRoot = entryFile ? path.dirname(entryFile) : undefined;
  return { language, entryFile, moduleRoot, packageJson };
}

function rewriteImportSpecifiers(code: string): string {
  const rewrite = (prefix: string, spec: string, suffix: string) => {
    if (!spec.startsWith(".")) return `${prefix}${spec}${suffix}`;
    if (path.extname(spec)) return `${prefix}${spec}${suffix}`;
    return `${prefix}${spec}.js${suffix}`;
  };
  let output = code;
  output = output.replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g, (_m, p1, p2, p3) => rewrite(p1, p2, p3));
  output = output.replace(/(import\(['"])(\.{1,2}\/[^'"]+)(['"]\))/g, (_m, p1, p2, p3) => rewrite(p1, p2, p3));
  output = output.replace(/(require\(['"])(\.{1,2}\/[^'"]+)(['"]\))/g, (_m, p1, p2, p3) => rewrite(p1, p2, p3));
  return output;
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function transpileDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await transpileDir(srcPath, destPath);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".d.ts")) {
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      const source = await fs.readFile(srcPath, "utf8");
      const transpiled = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ES2020,
          target: ts.ScriptTarget.ES2020,
          jsx: ts.JsxEmit.ReactJSX,
        },
      }).outputText;
      const rewritten = rewriteImportSpecifiers(transpiled);
      const outPath = destPath.replace(/\.(ts|tsx)$/, ".js");
      await fs.writeFile(outPath, rewritten, "utf8");
      continue;
    }
    if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs") || entry.name.endsWith(".cjs") || entry.name.endsWith(".json")) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function integrateRepo(
  capability: string,
  analysis: RepoAnalysis,
  root: string,
): Promise<{ entryPath?: string; status: "ready" | "needs_port" | "failed"; notes?: string[] }> {
  if (!analysis.entryFile || !analysis.moduleRoot) {
    return { status: "failed", notes: ["No entry file detected."] };
  }

  if (analysis.language === "python" || analysis.language === "cpp" || analysis.language === "rust") {
    return { status: "needs_port", notes: [`Language ${analysis.language} requires manual port.`] };
  }

  const safeName = sanitizeToolName(capability);
  if (analysis.language === "js") {
    const destRoot = path.join(root, "merged", safeName);
    await copyDir(analysis.moduleRoot, destRoot);
    const entryPath = path.join(destRoot, path.basename(analysis.entryFile));
    return { status: "ready", entryPath };
  }

  if (analysis.language === "ts") {
    const destRoot = path.join(root, "compiled", safeName);
    await transpileDir(analysis.moduleRoot, destRoot);
    const entryPath = path.join(destRoot, path.basename(analysis.entryFile).replace(/\.(ts|tsx)$/, ".js"));
    return { status: "ready", entryPath };
  }

  return { status: "failed", notes: ["Unsupported language for auto-fusion."] };
}

function buildRegistryEntry(params: {
  toolName: string;
  capability: string;
  description?: string;
  entryPath: string;
  exportName?: string;
  source?: Candidate;
  status: SelfExpandRegistryEntry["status"];
  notes?: string[];
}): SelfExpandRegistryEntry {
  const existing = loadSelfExpandRegistrySync().capabilities[params.toolName];
  const now = new Date().toISOString();
  return {
    toolName: params.toolName,
    capability: params.capability,
    description: params.description,
    entryPath: params.entryPath,
    exportName: params.exportName,
    status: params.status,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    source: params.source
      ? {
          provider: params.source.provider,
          name: params.source.name,
          url: params.source.url,
          path: params.source.path,
        }
      : existing?.source,
    notes: params.notes,
  };
}

async function registerFusedTool(entry: SelfExpandRegistryEntry): Promise<ToolDefinition | null> {
  try {
    const { toolRegistry } = await import("../toolRegistry");
    if (toolRegistry.get(entry.toolName)) {
      return toolRegistry.get(entry.toolName) || null;
    }
    const toolDef = createFusedToolDefinition(entry);
    toolRegistry.register(toolDef);
    policyEngine.registerPolicy({
      toolName: entry.toolName,
      capabilities: ["executes_code", "writes_files"],
      allowedPlans: ["free", "pro", "admin"],
      requiresConfirmation: false,
      maxExecutionTimeMs: 120000,
      maxRetries: 1,
      deniedByDefault: false,
    });
    return toolDef;
  } catch {
    return null;
  }
}

export async function selfExpandCapability(
  request: SelfExpandRequest,
  context?: ToolContext,
): Promise<SelfExpandResult> {
  const capability = request.capability.trim();
  const toolName = sanitizeToolName(capability);
  const warnings: string[] = [];
  const notes: string[] = [];

  const existing = loadSelfExpandRegistrySync().capabilities[toolName];
  if (existing && existing.status === "active") {
    await registerFusedTool(existing);
    return {
      capability,
      toolName,
      status: "already_available",
      entryPath: existing.entryPath,
      warnings,
      notes,
    };
  }

  const root = resolveSelfExpandRoot();
  await fs.mkdir(root, { recursive: true });

  const candidates = await buildCandidates(capability, request, warnings);
  if (candidates.length === 0) {
    return { capability, toolName, status: "no_candidates", warnings };
  }

  const selected = candidates[0];
  if (request.dryRun) {
    return {
      capability,
      toolName,
      status: "dry_run",
      selectedCandidate: selected,
      warnings,
      notes,
    };
  }
  const repoPath = await ensureRepo(selected, root, warnings);
  if (!repoPath) {
    return { capability, toolName, status: "clone_failed", selectedCandidate: selected, warnings };
  }

  const analysis = await analyzeRepo(repoPath, request.entryFile);
  if (!analysis.entryFile && analysis.language === "unknown") {
    return { capability, toolName, status: "analysis_failed", selectedCandidate: selected, repoPath, warnings };
  }

  const integration = await integrateRepo(toolName, analysis, root);
  if (integration.status === "needs_port") {
    const entryPath = analysis.entryFile || repoPath;
    const record = buildRegistryEntry({
      toolName,
      capability,
      description: request.description,
      entryPath: path.relative(process.cwd(), entryPath),
      exportName: request.exportName,
      source: selected,
      status: "needs_port",
      notes: integration.notes,
    });
    upsertSelfExpandRegistryEntrySync(record);
    if (context) {
      contextManager.upsertCapabilityState(context.runId, toolName, {
        status: "needs_port",
        source: selected,
        entryPath: record.entryPath,
      });
    }
    return {
      capability,
      toolName,
      status: "needs_port",
      selectedCandidate: selected,
      repoPath,
      warnings,
      notes: integration.notes,
    };
  }

  if (integration.status !== "ready" || !integration.entryPath) {
    return { capability, toolName, status: "integration_failed", selectedCandidate: selected, repoPath, warnings };
  }

  const record = buildRegistryEntry({
    toolName,
    capability,
    description: request.description,
    entryPath: path.relative(process.cwd(), integration.entryPath),
    exportName: request.exportName,
    source: selected,
    status: "active",
    notes: integration.notes,
  });
  upsertSelfExpandRegistryEntrySync(record);
  await registerFusedTool(record);

  if (context) {
    contextManager.upsertCapabilityState(context.runId, toolName, {
      status: "active",
      source: selected,
      entryPath: record.entryPath,
    });
  }

  return {
    capability,
    toolName,
    status: "expanded",
    selectedCandidate: selected,
    repoPath,
    entryPath: record.entryPath,
    warnings,
    notes,
  };
}
