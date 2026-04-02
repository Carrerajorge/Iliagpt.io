import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type OpenClawEmbeddedResolveOptions = {
  cwd?: string;
  argv1?: string;
  moduleUrl?: string;
};

const EMBEDDED_OPENCLAW_LAYOUTS = [
  ["server", "openclaw"],
  ["node_modules", "@hola", "openclaw"],
  ["node_modules", "openclaw"],
  ["openclaw"],
] as const;

function addCandidate(candidates: Set<string>, value: string | null | undefined) {
  if (!value) {
    return;
  }
  candidates.add(path.resolve(value));
}

function addLayoutCandidates(candidates: Set<string>, baseDir: string | null | undefined) {
  if (!baseDir) {
    return;
  }

  const resolvedBase = path.resolve(baseDir);
  const parentDir = path.dirname(resolvedBase);

  addCandidate(candidates, resolvedBase);

  for (const segments of EMBEDDED_OPENCLAW_LAYOUTS) {
    addCandidate(candidates, path.join(resolvedBase, ...segments));
    if (parentDir !== resolvedBase) {
      addCandidate(candidates, path.join(parentDir, ...segments));
    }
  }
}

function resolveModuleDir(moduleUrl: string | undefined): string | null {
  if (!moduleUrl) {
    return null;
  }
  try {
    return path.dirname(fileURLToPath(moduleUrl));
  } catch {
    return null;
  }
}

function resolveArgvDirs(argv1: string | undefined): string[] {
  if (!argv1) {
    return [];
  }

  const normalized = path.resolve(argv1);
  const dirs = [path.dirname(normalized)];

  try {
    const realpathDir = path.dirname(fs.realpathSync(normalized));
    if (realpathDir !== dirs[0]) {
      dirs.push(realpathDir);
    }
  } catch {
    // Ignore missing or non-realpath entrypoints and keep path-based candidates.
  }

  return dirs;
}

function isOpenClawPackageJson(pkgJsonPath: string): boolean {
  try {
    const raw = fs.readFileSync(pkgJsonPath, "utf-8");
    const parsed = JSON.parse(raw) as { name?: unknown };
    return parsed.name === "openclaw";
  } catch {
    return false;
  }
}

export function listEmbeddedOpenClawPackageRootCandidatesSync(
  opts: OpenClawEmbeddedResolveOptions = {},
): string[] {
  const candidates = new Set<string>();
  const argv1 = opts.argv1 ?? process.argv[1];
  const cwd = opts.cwd ?? process.cwd();

  addLayoutCandidates(candidates, resolveModuleDir(opts.moduleUrl));
  for (const dir of resolveArgvDirs(argv1)) {
    addLayoutCandidates(candidates, dir);
  }
  addLayoutCandidates(candidates, cwd);

  return [...candidates];
}

export function resolveEmbeddedOpenClawPackageRootSync(
  opts: OpenClawEmbeddedResolveOptions = {},
): string | null {
  for (const candidate of listEmbeddedOpenClawPackageRootCandidatesSync(opts)) {
    const pkgJsonPath = path.join(candidate, "package.json");
    if (fs.existsSync(pkgJsonPath) && isOpenClawPackageJson(pkgJsonPath)) {
      return candidate;
    }
  }
  return null;
}

export function resolveEmbeddedOpenClawPackageJsonPathSync(
  opts: OpenClawEmbeddedResolveOptions = {},
): string | null {
  const packageRoot = resolveEmbeddedOpenClawPackageRootSync(opts);
  return packageRoot ? path.join(packageRoot, "package.json") : null;
}

export function resolveEmbeddedOpenClawControlUiRootSync(
  opts: OpenClawEmbeddedResolveOptions = {},
): string | null {
  for (const candidate of listEmbeddedOpenClawPackageRootCandidatesSync(opts)) {
    const controlUiRoot = path.join(candidate, "dist", "control-ui");
    if (fs.existsSync(path.join(controlUiRoot, "index.html"))) {
      return controlUiRoot;
    }
  }
  return null;
}
