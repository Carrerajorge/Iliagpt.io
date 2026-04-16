import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createCatalogOnlyRuntimeSkill,
  type BundledSkill,
  type RuntimeSkillDescriptor,
} from "@shared/skillsRuntime";

export const ANTHROPIC_SKILLS_REPO_URL = "https://github.com/anthropics/skills";
export const ANTHROPIC_SKILLS_REPO_DIRS_ENV = "ANTHROPIC_SKILLS_REPO_DIRS";

type AnthropicCatalogSkill = BundledSkill & {
  filePath: string;
  repoDir: string;
};

const DEFAULT_WORKSPACE_CANDIDATES = [
  ["vendor", "anthropics-skills"],
  ["vendor", "anthropic-skills"],
  ["vendor", "anthropics", "skills"],
  ["vendor", "anthropic", "skills"],
  ["vendors", "anthropics-skills"],
  ["external", "anthropics-skills"],
  ["external", "anthropic-skills"],
  ["external", "anthropics", "skills"],
  ["external", "anthropic", "skills"],
  ["third_party", "anthropics-skills"],
  ["third-party", "anthropics-skills"],
  [".vendors", "anthropics-skills"],
  [".external", "anthropics-skills"],
  ["deps", "anthropics-skills"],
] as const;

const DEFAULT_HOME_CANDIDATES = [
  [".iliagpt", "anthropics-skills"],
  [".iliagpt", "vendors", "anthropics-skills"],
  [".openclaw", "anthropics-skills"],
  ["anthropics-skills"],
] as const;

function resolveHome(inputPath: string): string {
  if (!inputPath) {
    return inputPath;
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function toUniquePaths(values: string[]): string[] {
  const resolved = values
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => path.resolve(resolveHome(value)));
  return Array.from(new Set(resolved));
}

function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function listChildDirectories(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function hasImmediateSkills(dir: string): boolean {
  if (!isDirectory(dir)) {
    return false;
  }
  return listChildDirectories(dir).some((name) => isFile(path.join(dir, name, "SKILL.md")));
}

function resolveAnthropicSkillsBaseDir(repoDir: string): string | null {
  const resolved = path.resolve(repoDir);
  if (isFile(path.join(resolved, "SKILL.md"))) {
    return resolved;
  }
  const nested = path.join(resolved, "skills");
  if (hasImmediateSkills(nested)) {
    return nested;
  }
  if (hasImmediateSkills(resolved)) {
    return resolved;
  }
  return null;
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith("---")) {
    return {};
  }
  const closingIndex = content.indexOf("\n---", 3);
  if (closingIndex < 0) {
    return {};
  }

  const block = content.slice(3, closingIndex).trim();
  const frontmatter: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    const value = rawValue.trim().replace(/^['"]|['"]$/g, "").trim();
    if (value) {
      frontmatter[key] = value;
    }
  }
  return frontmatter;
}

function sanitizeSkillId(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "skill";
}

function humanizeSkillName(raw: string): string {
  return raw
    .split(/[-_]+/)
    .map((segment) => (segment ? segment[0].toUpperCase() + segment.slice(1) : ""))
    .join(" ")
    .trim();
}

function readCatalogSkill(skillDir: string, repoDir: string): AnthropicCatalogSkill | null {
  const filePath = path.join(skillDir, "SKILL.md");
  if (!isFile(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, "utf8");
    const frontmatter = parseFrontmatter(content);
    const fallbackName = path.basename(skillDir);
    const name = frontmatter.name?.trim() || humanizeSkillName(fallbackName);
    const description =
      frontmatter.description?.trim() ||
      `Skill importada desde anthropics/skills (${name}).`;

    return {
      id: sanitizeSkillId(name),
      name,
      description,
      category: "custom",
      features: [],
      vendor: "anthropic",
      homepage: ANTHROPIC_SKILLS_REPO_URL,
      filePath,
      repoDir,
    };
  } catch {
    return null;
  }
}

export function resolveAnthropicSkillsRepoDirs(workspaceDir?: string): string[] {
  const workspaceRoot = workspaceDir ? path.resolve(workspaceDir) : "";
  const envCandidates = (process.env[ANTHROPIC_SKILLS_REPO_DIRS_ENV] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const workspaceCandidates = workspaceRoot
    ? DEFAULT_WORKSPACE_CANDIDATES.map((parts) => path.join(workspaceRoot, ...parts))
    : [];
  const homeCandidates = DEFAULT_HOME_CANDIDATES.map((parts) => path.join(os.homedir(), ...parts));

  return toUniquePaths([...envCandidates, ...workspaceCandidates, ...homeCandidates]).filter(
    (candidate) => resolveAnthropicSkillsBaseDir(candidate) !== null,
  );
}

export function isAnthropicSkillFilePath(filePath: string, workspaceDir?: string): boolean {
  if (!filePath) {
    return false;
  }
  const resolvedFilePath = path.resolve(resolveHome(filePath));
  return resolveAnthropicSkillsRepoDirs(workspaceDir).some((repoDir) => {
    const resolvedRepoDir = path.resolve(repoDir);
    return (
      resolvedFilePath === resolvedRepoDir ||
      resolvedFilePath.startsWith(`${resolvedRepoDir}${path.sep}`)
    );
  });
}

export function listAnthropicSkillCatalog(workspaceDir?: string): AnthropicCatalogSkill[] {
  const repoDirs = resolveAnthropicSkillsRepoDirs(workspaceDir);
  const seen = new Set<string>();
  const skills: AnthropicCatalogSkill[] = [];

  for (const repoDir of repoDirs) {
    const baseDir = resolveAnthropicSkillsBaseDir(repoDir);
    if (!baseDir) {
      continue;
    }

    const directSkill = readCatalogSkill(baseDir, repoDir);
    if (directSkill && !seen.has(directSkill.id)) {
      seen.add(directSkill.id);
      skills.push(directSkill);
    }

    for (const name of listChildDirectories(baseDir)) {
      const candidate = readCatalogSkill(path.join(baseDir, name), repoDir);
      if (!candidate || seen.has(candidate.id)) {
        continue;
      }
      seen.add(candidate.id);
      skills.push(candidate);
    }
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function listAnthropicCatalogRuntimeSkills(workspaceDir?: string): RuntimeSkillDescriptor[] {
  return listAnthropicSkillCatalog(workspaceDir).map((skill) => createCatalogOnlyRuntimeSkill(skill));
}
