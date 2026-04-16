import fs from "fs/promises";
import path from "path";
import os from "os";

export type ClawiExtensionCapability = {
  id: string;
  name: string;
  description?: string;
  path: string;
};

export type ClawiSkillCapability = {
  id: string;
  name: string;
  path: string;
};

export type ClawiToolCapability = {
  id: string;
  path: string;
};

export type ClawiCatalog = {
  sourceRoot: string;
  loadedAt: string;
  skills: ClawiSkillCapability[];
  extensions: ClawiExtensionCapability[];
  agentTools: ClawiToolCapability[];
};

const DEFAULT_CLAWI_ROOT = path.join(os.homedir(), "Desktop", "clawi", "openclaw");
const MAX_ENTRIES_PER_SECTION = 80;
const CACHE_TTL_MS = 60_000;

let cachedCatalog: ClawiCatalog | null = null;
let cachedAt = 0;

function normalizeId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function readJson(filePath: string): Promise<any | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function discoverSkills(root: string): Promise<ClawiSkillCapability[]> {
  const skillsRoot = path.join(root, "skills");
  if (!(await dirExists(skillsRoot))) return [];

  const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
  const skills: ClawiSkillCapability[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const skillPath = path.join(skillsRoot, entry.name);
    const skillMdPath = path.join(skillPath, "SKILL.md");
    if (!(await fileExists(skillMdPath))) continue;
    skills.push({
      id: normalizeId(entry.name),
      name: entry.name,
      path: skillPath,
    });
  }

  return skills.slice(0, MAX_ENTRIES_PER_SECTION);
}

async function discoverExtensions(root: string): Promise<ClawiExtensionCapability[]> {
  const extRoot = path.join(root, "extensions");
  if (!(await dirExists(extRoot))) return [];

  const entries = await fs.readdir(extRoot, { withFileTypes: true });
  const extensions: ClawiExtensionCapability[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const extPath = path.join(extRoot, entry.name);
    const pkg = await readJson(path.join(extPath, "package.json"));
    const name = (pkg?.name as string) || entry.name;
    const description = (pkg?.description as string) || undefined;
    extensions.push({
      id: normalizeId(entry.name),
      name,
      description,
      path: extPath,
    });
  }

  return extensions.slice(0, MAX_ENTRIES_PER_SECTION);
}

async function discoverAgentTools(root: string): Promise<ClawiToolCapability[]> {
  const toolsRoot = path.join(root, "src", "agents", "tools");
  if (!(await dirExists(toolsRoot))) return [];

  const files = await fs.readdir(toolsRoot, { withFileTypes: true });
  const tools = files
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((fileName) => {
      const id = normalizeId(fileName.replace(/\.ts$/i, ""));
      return {
        id,
        path: path.join(toolsRoot, fileName),
      };
    });

  return tools.slice(0, MAX_ENTRIES_PER_SECTION);
}

export async function getClawiCatalog(forceRefresh = false): Promise<ClawiCatalog> {
  const now = Date.now();
  if (!forceRefresh && cachedCatalog && now - cachedAt < CACHE_TTL_MS) {
    return cachedCatalog;
  }

  const sourceRoot = process.env.CLAWI_ROOT_DIR
    ? path.resolve(process.env.CLAWI_ROOT_DIR)
    : DEFAULT_CLAWI_ROOT;

  const [skills, extensions, agentTools] = await Promise.all([
    discoverSkills(sourceRoot),
    discoverExtensions(sourceRoot),
    discoverAgentTools(sourceRoot),
  ]);

  cachedCatalog = {
    sourceRoot,
    loadedAt: new Date(now).toISOString(),
    skills,
    extensions,
    agentTools,
  };
  cachedAt = now;
  return cachedCatalog;
}

function topItems(values: string[], limit: number): string {
  if (values.length === 0) return "(none)";
  return values.slice(0, limit).join(", ");
}

export async function buildClawiCapabilitiesSummary(options: { maxItems?: number } = {}): Promise<string> {
  const { maxItems = 12 } = options;
  const catalog = await getClawiCatalog();

  const skills = catalog.skills.map((item) => item.id);
  const extensions = catalog.extensions.map((item) => item.id);
  const tools = catalog.agentTools.map((item) => item.id);

  return [
    "[Clawi Capabilities Catalog]",
    `sourceRoot: ${catalog.sourceRoot}`,
    `skills(${skills.length}): ${topItems(skills, maxItems)}`,
    `extensions(${extensions.length}): ${topItems(extensions, maxItems)}`,
    `agentTools(${tools.length}): ${topItems(tools, maxItems)}`,
  ].join("\n");
}
