// server/agent/selfExpand/capabilityExpander.ts
// ---------------------------------------------------------------------------
// Capability Expander — orchestrates the full self-expand cycle:
//   gap detection → catalog lookup → git clone → source analysis →
//   code fusion → registry registration → execution
// ---------------------------------------------------------------------------

import { execFile } from "child_process";
import { promisify } from "util";
import { readdir, readFile, writeFile, mkdir, rm, stat, access } from "fs/promises";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { analyzeSource } from "./sourceAnalyzer";
import type {
  MissingCapability,
  CatalogEntry,
  FusedManifest,
  AnalysisResult,
  RepoSource,
  Catalog,
} from "./types";
import { SELF_EXPAND_LIMITS, CatalogSchema } from "./types";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = dirname(__filename_local);

/** Known built-in tools that should never trigger expansion. */
const BUILTIN_TOOLS = new Set([
  "web_search",
  "fetch_url",
  "read_file",
  "write_file",
  "list_files",
  "browse_and_act",
  "create_document",
  "create_presentation",
  "create_spreadsheet",
  "generate_chart",
  "analyze_data",
  "memory_search",
]);

/** Prefixes that indicate an internal tool — never expand. */
const SKIP_PREFIXES = ["openclaw_", "skill_"];

/** Stop-words filtered out of user messages during keyword extraction. */
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "to", "from", "my", "this", "that", "for",
  "and", "or", "in", "on", "of", "with", "it", "me", "can", "do",
  "please", "need", "want", "help", "could", "would", "should", "i", "you",
]);

// ---------------------------------------------------------------------------
// Catalog cache
// ---------------------------------------------------------------------------

let catalogCache: Catalog | null = null;

function loadCatalogSync(): Catalog {
  if (catalogCache) return catalogCache;

  // Read synchronously on first call — the file is tiny (<20 KB).
  // We fall back to an empty catalog if anything goes wrong.
  try {
    const catalogPath = join(__dirname_local, "catalog.json");
    // Use a require-like approach via readFileSync from node:fs
    // We can't use top-level await in a non-async function, so we
    // import node:fs directly.
    const fs = await_import_fs();
    const raw = fs.readFileSync(catalogPath, "utf-8");
    catalogCache = CatalogSchema.parse(JSON.parse(raw));
  } catch {
    catalogCache = { version: "1.0.0", capabilities: [] };
  }
  return catalogCache;
}

// Small helper to get the synchronous fs module (avoids top-level await).
function await_import_fs(): typeof import("fs") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("fs") as typeof import("fs");
}

// Also provide an async loader for contexts that can await.
async function loadCatalog(): Promise<Catalog> {
  if (catalogCache) return catalogCache;
  try {
    const catalogPath = join(__dirname_local, "catalog.json");
    const raw = await readFile(catalogPath, "utf-8");
    catalogCache = CatalogSchema.parse(JSON.parse(raw));
  } catch {
    catalogCache = { version: "1.0.0", capabilities: [] };
  }
  return catalogCache;
}

// ---------------------------------------------------------------------------
// 1. detectGap
// ---------------------------------------------------------------------------

/**
 * Examines a failed tool invocation and extracts a structured capability gap.
 * Returns `null` if the tool is a known built-in or internal prefix.
 */
export function detectGap(toolName: string, userMessage: string): MissingCapability | null {
  // Skip known builtins
  if (BUILTIN_TOOLS.has(toolName)) return null;

  // Skip internal prefixes
  for (const prefix of SKIP_PREFIXES) {
    if (toolName.startsWith(prefix)) return null;
  }

  // Extract keywords from tool name
  const toolKeywords = toolName
    .split("_")
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 2);

  // Extract keywords from user message
  const messageKeywords = userMessage
    .split(/[\s\-_,.!?;:'"()\[\]{}\/\\]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

  // Deduplicate
  const allKeywords = [...new Set([...toolKeywords, ...messageKeywords])];

  if (allKeywords.length === 0) return null;

  // Build ID from tool name keywords
  const id = toolKeywords.length > 0 ? toolKeywords.join("-") : allKeywords.slice(0, 3).join("-");

  return {
    id,
    keywords: allKeywords,
    toolNameAttempted: toolName,
    userMessage,
    confidence: 0.8,
  };
}

// ---------------------------------------------------------------------------
// 2. resolveCap
// ---------------------------------------------------------------------------

/**
 * Looks up the capability catalog for the best match given a set of keywords.
 * Returns the matching `CatalogEntry` if at least 2 keywords overlap with an
 * entry's tags; otherwise returns `null`.
 */
export function resolveCap(missing: MissingCapability): CatalogEntry | null {
  const catalog = loadCatalogSync();
  const { keywords } = missing;

  let bestEntry: CatalogEntry | null = null;
  let bestScore = 0;

  for (const entry of catalog.capabilities) {
    const tagSet = new Set(entry.tags);
    let score = 0;
    for (const kw of keywords) {
      if (tagSet.has(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  return bestScore >= 2 ? bestEntry : null;
}

// ---------------------------------------------------------------------------
// 3. cloneRepo
// ---------------------------------------------------------------------------

/**
 * Shallow-clones a git repository into a temporary directory.
 * Validates the URL, enforces size limits, and returns the clone path + HEAD SHA.
 */
export async function cloneRepo(
  gitUrl: string,
  name: string,
): Promise<{ path: string; commitSha: string }> {
  const targetPath = join(SELF_EXPAND_LIMITS.TEMP_DIR, `${name}-${Date.now()}`);
  await mkdir(targetPath, { recursive: true });

  // Validate URL
  if (!gitUrl.startsWith("https://") || !gitUrl.endsWith(".git")) {
    throw new Error(`Invalid git URL: ${gitUrl}`);
  }

  await execFileAsync("git", ["clone", "--depth", "1", gitUrl, targetPath], {
    timeout: SELF_EXPAND_LIMITS.CLONE_TIMEOUT_MS,
  });

  const { stdout: sha } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: targetPath,
  });

  // Check size
  const { stdout: sizeOutput } = await execFileAsync("du", ["-sm", targetPath]);
  const sizeMb = parseInt(sizeOutput.split("\t")[0], 10);
  if (sizeMb > SELF_EXPAND_LIMITS.MAX_CLONE_SIZE_MB) {
    await rm(targetPath, { recursive: true, force: true });
    throw new Error(
      `Clone too large: ${sizeMb}MB > ${SELF_EXPAND_LIMITS.MAX_CLONE_SIZE_MB}MB`,
    );
  }

  return { path: targetPath, commitSha: sha.trim() };
}

// ---------------------------------------------------------------------------
// 4. fuseModule
// ---------------------------------------------------------------------------

export interface FuseOptions {
  capabilityId: string;
  clonePath: string;
  fusedDir: string;
  analysisResult: AnalysisResult;
  repoSource: RepoSource;
  commitSha: string;
}

/**
 * Writes the fused module source and manifest into the fused directory.
 *
 * Depending on `analysisResult.suggestedPortStrategy`:
 *   - `direct-copy`:   Write each export body directly into `index.ts`
 *   - `transpile-js`:  Wrap CJS exports as ES exports with `any` types
 *   - `native-binding`: Re-export from the npm package name
 */
export async function fuseModule(opts: FuseOptions): Promise<FusedManifest> {
  const {
    capabilityId,
    clonePath,
    fusedDir,
    analysisResult,
    repoSource,
    commitSha,
  } = opts;

  const capDir = join(fusedDir, capabilityId);
  await mkdir(capDir, { recursive: true });

  const strategy = analysisResult.suggestedPortStrategy;
  let indexContent = "";

  const header =
    `// Auto-fused from ${repoSource.name} (${repoSource.git})\n` +
    `// Strategy: ${strategy}\n\n`;

  switch (strategy) {
    case "direct-copy": {
      indexContent = header;
      for (const exp of analysisResult.entryExports) {
        indexContent += exp.body + "\n\n";
      }
      break;
    }

    case "transpile-js": {
      indexContent = header;
      for (const exp of analysisResult.entryExports) {
        // Wrap as ES export with any types
        if (exp.kind === "function") {
          indexContent += `export function ${exp.name}(...args: any[]): any {\n`;
          // Extract the inner body (skip the outer function signature line)
          const bodyLines = exp.body.split("\n");
          if (bodyLines.length > 2) {
            // Multi-line: skip first line (function sig) and last line (closing brace)
            indexContent += bodyLines.slice(1, -1).join("\n") + "\n";
          } else {
            indexContent += `  // Original: ${exp.body.replace(/\n/g, " ")}\n`;
            indexContent += `  return undefined;\n`;
          }
          indexContent += "}\n\n";
        } else if (exp.kind === "class") {
          indexContent += exp.body + "\n\n";
        } else {
          // constant
          indexContent += `export const ${exp.name}: any = undefined; // TODO: port value\n\n`;
        }
      }
      break;
    }

    case "native-binding": {
      // Re-export from the installed npm package
      indexContent =
        header + `export * from "${repoSource.name}";\n`;
      break;
    }

    default: {
      // port-python or unknown — just write the bodies with a comment
      indexContent =
        header +
        `// NOTE: port strategy "${strategy}" requires manual porting\n\n`;
      for (const exp of analysisResult.entryExports) {
        indexContent += `// ${exp.name} (${exp.kind})\n${exp.body}\n\n`;
      }
    }
  }

  // Write index.ts
  await writeFile(join(capDir, "index.ts"), indexContent, "utf-8");

  // Build manifest
  const manifest: FusedManifest = {
    capabilityId,
    sourceName: repoSource.name,
    sourceGit: repoSource.git,
    sourceCommitSha: commitSha,
    extractedFiles: analysisResult.entryExports.map((e) => e.sourceFile),
    portStrategy: strategy,
    fusedAt: new Date().toISOString(),
    registeredTools: [capabilityId.replace(/-/g, "_")],
    totalPortedLines: analysisResult.entryExports.reduce(
      (sum, e) => sum + e.body.split("\n").length,
      0,
    ),
  };

  // Write manifest.json
  await writeFile(
    join(capDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8",
  );

  return manifest;
}

// ---------------------------------------------------------------------------
// 5. registerFusedCapability
// ---------------------------------------------------------------------------

export interface RegisterOptions {
  capabilityId: string;
  toolName: string;
  description: string;
  execute: (args: any) => Promise<any>;
}

/**
 * Registers a fused capability in both the capability registry and tool registry.
 * Uses try/catch so that tests work without the full server context.
 */
export function registerFusedCapability(opts: RegisterOptions): { toolName: string } {
  // Attempt capability registry registration (non-fatal if unavailable)
  import("../capabilities/registry")
    .then(({ capabilityRegistry }) => {
      capabilityRegistry.register({
        name: opts.toolName,
        description: opts.description,
        schema: z.object({ input: z.any() }),
        execute: opts.execute,
      });
    })
    .catch(() => {
      /* registry not available in test env */
    });

  // Attempt tool registry registration (non-fatal if unavailable)
  import("../registry/toolRegistry")
    .then(({ toolRegistry }) => {
      toolRegistry.register({
        metadata: {
          name: opts.toolName,
          description: opts.description,
          category: "Utility" as const,
          version: "0.1.0",
          author: "selfExpand",
          tags: ["auto-fused"],
        },
        config: {
          timeout: 30000,
          maxRetries: 1,
          retryDelay: 1000,
        },
        inputSchema: z.object({ input: z.any() }),
        outputSchema: z.any(),
        execute: async (input: any, _trace: any) => opts.execute(input),
      });
    })
    .catch(() => {
      /* registry not available in test env */
    });

  return { toolName: opts.toolName };
}

// ---------------------------------------------------------------------------
// 6. expandAndExecute  (main entry point)
// ---------------------------------------------------------------------------

/**
 * Full self-expand cycle: detect gap → resolve catalog → clone → analyze →
 * fuse → register → execute.
 *
 * Called from agentExecutor when a tool invocation returns NOT_FOUND.
 * Returns the execution result or `null` if expansion was not possible.
 */
export async function expandAndExecute(
  toolName: string,
  args: Record<string, any>,
  context: any,
  runId: string,
  sseRes?: any,
): Promise<{ result: any; artifact?: any } | null> {
  // 1. Detect gap
  const gap = detectGap(toolName, context?.userMessage || "");
  if (!gap) return null;

  // 2. Resolve from catalog
  const entry = resolveCap(gap);
  if (!entry) {
    emitSSE(sseRes, "capability_failed", {
      id: gap.id,
      reason: "No matching capability in catalog",
      suggestion: "Try a different approach",
    });
    return null;
  }

  const repo = entry.repos[0]; // Use first (preferred) repo

  // 3. Emit expanding event
  emitSSE(sseRes, "capability_expanding", {
    id: gap.id,
    source: repo.name,
    git: repo.git,
  });

  try {
    // 4. Clone
    const { path: clonePath, commitSha } = await cloneRepo(repo.git, repo.name);

    try {
      // 5. Analyze
      const analysis = await analyzeSource({
        clonePath,
        extractPaths: repo.extractPaths,
      });

      // 6. Get fused dir (relative to this file)
      const fusedDir = join(__dirname_local, "fused");

      // 7. Fuse
      const manifest = await fuseModule({
        capabilityId: gap.id,
        clonePath,
        fusedDir,
        analysisResult: analysis,
        repoSource: repo,
        commitSha,
      });

      // 8. Dynamically import the fused module
      const fusedModule = await import(join(fusedDir, gap.id, "index.ts"));
      const executeFn =
        fusedModule.default ||
        fusedModule[Object.keys(fusedModule)[0]] ||
        fusedModule;

      // 9. Register
      registerFusedCapability({
        capabilityId: gap.id,
        toolName: manifest.registeredTools[0],
        description: `Auto-fused capability: ${gap.id} from ${repo.name}`,
        execute: typeof executeFn === "function" ? executeFn : async (a: any) => executeFn,
      });

      // 10. Emit acquired
      emitSSE(sseRes, "capability_acquired", {
        id: gap.id,
        tools: manifest.registeredTools,
        fusedModules: analysis.entryExports.length,
        linesPorted: manifest.totalPortedLines,
      });

      // 11. Execute now
      const result = typeof executeFn === "function" ? await executeFn(args) : executeFn;
      return { result };
    } finally {
      // Always cleanup clone
      await rm(clonePath, { recursive: true, force: true }).catch(() => {});
    }
  } catch (err: any) {
    emitSSE(sseRes, "capability_failed", {
      id: gap.id,
      reason: err.message,
      suggestion: `Try: npm install ${repo.name}`,
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// 7. init  — restore previously fused capabilities from disk
// ---------------------------------------------------------------------------

/**
 * Scans the `fused/` directory for subdirectories containing `manifest.json`,
 * dynamically imports and registers each one. Called at server startup.
 *
 * @returns The number of capabilities successfully restored.
 */
export async function init(): Promise<number> {
  const fusedDir = join(__dirname_local, "fused");
  let count = 0;

  try {
    const entries = await readdir(fusedDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(fusedDir, entry.name, "manifest.json");
      try {
        const raw = await readFile(manifestPath, "utf-8");
        const manifest: FusedManifest = JSON.parse(raw);

        // Try to dynamically import the fused module
        const modulePath = join(fusedDir, entry.name, "index.ts");
        const fusedModule = await import(modulePath);
        const executeFn =
          fusedModule.default ||
          fusedModule[Object.keys(fusedModule)[0]] ||
          fusedModule;

        registerFusedCapability({
          capabilityId: manifest.capabilityId,
          toolName: manifest.registeredTools[0] || entry.name.replace(/-/g, "_"),
          description: `Restored capability: ${manifest.capabilityId} from ${manifest.sourceName}`,
          execute: typeof executeFn === "function" ? executeFn : async () => executeFn,
        });

        count++;
      } catch {
        /* skip invalid entries */
      }
    }
  } catch {
    /* fused dir doesn't exist yet */
  }

  if (count > 0) {
    console.log(`[SelfExpand] Restored ${count} capabilities from disk`);
  }

  return count;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Writes an SSE event to the response stream if available.
 * Non-fatal — swallows write errors silently.
 */
function emitSSE(res: any, event: string, data: any): void {
  if (!res || typeof res.write !== "function") return;
  try {
    const streamMeta = res?.locals?.streamMeta;
    const enriched: Record<string, unknown> =
      typeof data === "object" && data !== null ? { ...data } : { value: data };
    if (streamMeta?.requestId) enriched.requestId = streamMeta.requestId;
    if (!enriched.conversationId && streamMeta?.conversationId) enriched.conversationId = streamMeta.conversationId;
    const amid = streamMeta?.assistantMessageId ||
      (typeof streamMeta?.getAssistantMessageId === "function" ? streamMeta.getAssistantMessageId() : undefined);
    if (!enriched.assistantMessageId && amid) enriched.assistantMessageId = amid;
    res.write(`event: ${event}\ndata: ${JSON.stringify(enriched)}\n\n`);
  } catch {
    /* SSE write failed, non-fatal */
  }
}
