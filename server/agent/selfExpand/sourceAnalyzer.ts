import { readFile, readdir, stat, access } from "fs/promises";
import { join, relative, extname } from "path";
import type { AnalysisResult, ExportedSymbol } from "./types";
import { SELF_EXPAND_LIMITS } from "./types";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface AnalyzerOptions {
  clonePath: string;
  extractPaths: string[];
  entryPoint?: string;
  maxFiles?: number;
  maxLinesPerFile?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const TS_EXTENSIONS = new Set([".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build"]);

const NATIVE_BINDING_PACKAGES = new Set([
  "node-gyp",
  "prebuild",
  "prebuild-install",
  "nan",
  "node-addon-api",
  "napi-rs",
]);

// ---------------------------------------------------------------------------
// Regex patterns for export extraction
// ---------------------------------------------------------------------------

// ES Module patterns
const ES_EXPORT_FUNCTION =
  /^export\s+(?:async\s+)?function\s+(\w+)\s*\(/;
const ES_EXPORT_CLASS =
  /^export\s+class\s+(\w+)/;
const ES_EXPORT_CONST =
  /^export\s+const\s+(\w+)/;
const ES_EXPORT_DEFAULT_FUNCTION =
  /^export\s+default\s+(?:async\s+)?function\s+(\w+)\s*\(/;
const ES_EXPORT_DEFAULT_CLASS =
  /^export\s+default\s+class\s+(\w+)/;

// CommonJS patterns
const CJS_MODULE_EXPORTS_FUNCTION =
  /^module\.exports\s*=\s*function\s+(\w+)\s*\(/;
const CJS_MODULE_EXPORTS_CLASS =
  /^module\.exports\s*=\s*class\s+(\w+)/;
const CJS_NAMED_EXPORTS_FUNCTION =
  /^module\.exports\.(\w+)\s*=\s*(?:function|async\s+function)/;
const CJS_NAMED_EXPORTS_CLASS =
  /^module\.exports\.(\w+)\s*=\s*class/;
const CJS_EXPORTS_FUNCTION =
  /^exports\.(\w+)\s*=\s*(?:function|async\s+function)/;

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

async function collectFiles(
  basePath: string,
  extractPaths: string[],
  maxFiles: number,
): Promise<string[]> {
  const files: string[] = [];

  for (const ep of extractPaths) {
    if (files.length >= maxFiles) break;

    const fullPath = join(basePath, ep);

    let info;
    try {
      info = await stat(fullPath);
    } catch {
      // Path does not exist — skip silently
      continue;
    }

    if (info.isFile()) {
      files.push(fullPath);
    } else if (info.isDirectory()) {
      await walkDir(fullPath, files, maxFiles);
    }
  }

  return files.slice(0, maxFiles);
}

async function walkDir(
  dir: string,
  out: string[],
  maxFiles: number,
): Promise<void> {
  if (out.length >= maxFiles) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (out.length >= maxFiles) return;

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walkDir(join(dir, entry.name), out, maxFiles);
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (CODE_EXTENSIONS.has(ext)) {
        out.push(join(dir, entry.name));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Export extraction (regex-based)
// ---------------------------------------------------------------------------

interface ExportMatch {
  name: string;
  kind: "function" | "class" | "constant";
  lineIndex: number;
  signature: string;
}

function findExportMatches(lines: string[]): ExportMatch[] {
  const matches: ExportMatch[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    let m: RegExpMatchArray | null;

    // ES Module exports
    m = trimmed.match(ES_EXPORT_FUNCTION);
    if (m) {
      matches.push({ name: m[1], kind: "function", lineIndex: i, signature: lines[i].trimEnd() });
      continue;
    }

    m = trimmed.match(ES_EXPORT_DEFAULT_FUNCTION);
    if (m) {
      matches.push({ name: m[1], kind: "function", lineIndex: i, signature: lines[i].trimEnd() });
      continue;
    }

    m = trimmed.match(ES_EXPORT_CLASS);
    if (m) {
      matches.push({ name: m[1], kind: "class", lineIndex: i, signature: lines[i].trimEnd() });
      continue;
    }

    m = trimmed.match(ES_EXPORT_DEFAULT_CLASS);
    if (m) {
      matches.push({ name: m[1], kind: "class", lineIndex: i, signature: lines[i].trimEnd() });
      continue;
    }

    m = trimmed.match(ES_EXPORT_CONST);
    if (m) {
      matches.push({ name: m[1], kind: "constant", lineIndex: i, signature: lines[i].trimEnd() });
      continue;
    }

    // CommonJS exports
    m = trimmed.match(CJS_MODULE_EXPORTS_FUNCTION);
    if (m) {
      matches.push({ name: m[1], kind: "function", lineIndex: i, signature: lines[i].trimEnd() });
      continue;
    }

    m = trimmed.match(CJS_MODULE_EXPORTS_CLASS);
    if (m) {
      matches.push({ name: m[1], kind: "class", lineIndex: i, signature: lines[i].trimEnd() });
      continue;
    }

    m = trimmed.match(CJS_NAMED_EXPORTS_FUNCTION);
    if (m) {
      matches.push({ name: m[1], kind: "function", lineIndex: i, signature: lines[i].trimEnd() });
      continue;
    }

    m = trimmed.match(CJS_NAMED_EXPORTS_CLASS);
    if (m) {
      matches.push({ name: m[1], kind: "class", lineIndex: i, signature: lines[i].trimEnd() });
      continue;
    }

    m = trimmed.match(CJS_EXPORTS_FUNCTION);
    if (m) {
      matches.push({ name: m[1], kind: "function", lineIndex: i, signature: lines[i].trimEnd() });
      continue;
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Body extraction via brace counting
// ---------------------------------------------------------------------------

function extractBody(lines: string[], startLine: number): { lineEnd: number; body: string } {
  let depth = 0;
  let foundOpen = false;
  let endLine = startLine;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];

    for (const ch of line) {
      if (ch === "{") {
        depth++;
        foundOpen = true;
      } else if (ch === "}") {
        depth--;
      }
    }

    endLine = i;

    // If we opened at least one brace and depth has returned to zero, we're done.
    if (foundOpen && depth <= 0) {
      break;
    }
  }

  // For constants or one-liners that may not have braces, include up to the
  // first semicolon line after startLine.
  if (!foundOpen) {
    for (let i = startLine; i < lines.length; i++) {
      endLine = i;
      if (lines[i].includes(";")) break;
    }
  }

  const bodyLines = lines.slice(startLine, endLine + 1);
  return { lineEnd: endLine, body: bodyLines.join("\n") };
}

// ---------------------------------------------------------------------------
// Native bindings detection
// ---------------------------------------------------------------------------

async function detectNativeBindings(clonePath: string): Promise<boolean> {
  // Check for binding.gyp
  try {
    await access(join(clonePath, "binding.gyp"));
    return true;
  } catch {
    // not found — continue
  }

  // Check package.json
  let pkg: Record<string, unknown>;
  try {
    const raw = await readFile(join(clonePath, "package.json"), "utf-8");
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return false;
  }

  // Check dependencies and devDependencies for native-related packages
  for (const depKey of ["dependencies", "devDependencies"] as const) {
    const deps = pkg[depKey];
    if (deps && typeof deps === "object") {
      for (const name of Object.keys(deps as Record<string, unknown>)) {
        if (NATIVE_BINDING_PACKAGES.has(name)) return true;
      }
    }
  }

  // Check scripts.install for node-gyp / prebuild references
  const scripts = pkg.scripts;
  if (scripts && typeof scripts === "object") {
    const installScript = (scripts as Record<string, unknown>).install;
    if (typeof installScript === "string") {
      if (installScript.includes("node-gyp") || installScript.includes("prebuild")) {
        return true;
      }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Dependency extraction from package.json
// ---------------------------------------------------------------------------

async function extractDependencies(clonePath: string): Promise<string[]> {
  try {
    const raw = await readFile(join(clonePath, "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const deps = pkg.dependencies;
    if (deps && typeof deps === "object") {
      return Object.keys(deps as Record<string, unknown>);
    }
  } catch {
    // no package.json or malformed
  }
  return [];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function analyzeSource(options: AnalyzerOptions): Promise<AnalysisResult> {
  const {
    clonePath,
    extractPaths,
    maxFiles = SELF_EXPAND_LIMITS.MAX_FILES_TO_ANALYZE,
    maxLinesPerFile = SELF_EXPAND_LIMITS.MAX_LINES_PER_FILE,
  } = options;

  // 1. Discover files
  const files = await collectFiles(clonePath, extractPaths, maxFiles);

  // 2. Detect language from file extensions
  let hasTs = false;
  for (const f of files) {
    if (TS_EXTENSIONS.has(extname(f))) {
      hasTs = true;
      break;
    }
  }
  const language: "typescript" | "javascript" | "python" = hasTs ? "typescript" : "javascript";

  // 3. Extract exports from each file
  const allExports: ExportedSymbol[] = [];
  let totalLines = 0;

  for (const filePath of files) {
    const ext = extname(filePath);
    if (!CODE_EXTENSIONS.has(ext)) continue;

    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");

    // Respect maxLinesPerFile limit — skip files that are too long
    if (lines.length > maxLinesPerFile) continue;

    totalLines += lines.length;

    const relPath = relative(clonePath, filePath);
    const exportMatches = findExportMatches(lines);

    for (const match of exportMatches) {
      const { lineEnd, body } = extractBody(lines, match.lineIndex);

      allExports.push({
        name: match.name,
        kind: match.kind,
        signature: match.signature,
        sourceFile: relPath,
        lineStart: match.lineIndex,
        lineEnd,
        body,
      });
    }
  }

  // 4. Detect native bindings
  const hasNativeBindings = await detectNativeBindings(clonePath);

  // 5. Extract dependencies
  const dependencies = await extractDependencies(clonePath);

  // 6. Determine suggested port strategy
  let suggestedPortStrategy: "direct-copy" | "transpile-js" | "port-python" | "native-binding";
  if (hasNativeBindings) {
    suggestedPortStrategy = "native-binding";
  } else if (language === "typescript") {
    suggestedPortStrategy = "direct-copy";
  } else if (language === "python") {
    suggestedPortStrategy = "port-python";
  } else {
    suggestedPortStrategy = "transpile-js";
  }

  return {
    entryExports: allExports,
    dependencies,
    hasNativeBindings,
    totalLines,
    language,
    suggestedPortStrategy,
  };
}
