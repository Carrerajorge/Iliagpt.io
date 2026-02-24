import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { OpenClawConfig } from '../config';
import type { Skill } from '../types';

const DEFAULT_MAX_SKILL_FILE_BYTES = 256_000;

type Frontmatter = Record<string, string>;

export interface FilesystemSkillLoadResult {
  skills: Skill[];
  scannedRoots: string[];
  loadedFiles: string[];
  skippedFiles: Array<{ filePath: string; reason: string }>;
}

function resolveHome(inputPath: string): string {
  if (!inputPath) {
    return inputPath;
  }
  if (inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function toUnique(values: string[]): string[] {
  const normalized = values
    .map(v => v.trim())
    .filter(Boolean)
    .map(v => path.resolve(resolveHome(v)));
  return Array.from(new Set(normalized));
}

function sanitizeSkillId(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'skill';
}

function parseScalarValue(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseListValue(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return [];
  }
  return trimmed
    .slice(1, -1)
    .split(',')
    .map(v => parseScalarValue(v))
    .filter(Boolean);
}

function parseFrontmatter(rawContent: string): { frontmatter: Frontmatter; body: string } {
  if (!rawContent.startsWith('---')) {
    return { frontmatter: {}, body: rawContent };
  }

  const marker = '\n---';
  const closingIdx = rawContent.indexOf(marker, 3);
  if (closingIdx === -1) {
    return { frontmatter: {}, body: rawContent };
  }

  const block = rawContent.slice(3, closingIdx).trim();
  const body = rawContent.slice(closingIdx + marker.length).replace(/^\s*\n/, '');
  const frontmatter: Frontmatter = {};

  for (const line of block.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/);
    if (!match) {
      continue;
    }
    frontmatter[match[1]] = parseScalarValue(match[2]);
  }

  return { frontmatter, body };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function listSkillFilesInRoot(rootPath: string): Promise<string[]> {
  const files: string[] = [];
  const direct = path.join(rootPath, 'SKILL.md');
  if (await fileExists(direct)) {
    files.push(direct);
  }

  let entries: string[] = [];
  try {
    entries = await fs.readdir(rootPath);
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.startsWith('.')) {
      continue;
    }
    const full = path.join(rootPath, entry);
    if (!(await dirExists(full))) {
      continue;
    }
    const candidate = path.join(full, 'SKILL.md');
    if (await fileExists(candidate)) {
      files.push(candidate);
    }
  }

  const nestedSkillsRoot = path.join(rootPath, 'skills');
  if (await dirExists(nestedSkillsRoot)) {
    try {
      const nestedEntries = await fs.readdir(nestedSkillsRoot);
      for (const entry of nestedEntries) {
        if (entry.startsWith('.')) {
          continue;
        }
        const candidate = path.join(nestedSkillsRoot, entry, 'SKILL.md');
        if (await fileExists(candidate)) {
          files.push(candidate);
        }
      }
    } catch {
      // Best-effort discovery only.
    }
  }

  return Array.from(new Set(files.map(f => path.resolve(f))));
}

function resolveSkillRoots(config: OpenClawConfig): string[] {
  const fromConfig = [config.skills.directory, ...config.skills.extraDirectories];
  const fromWorkspace = [
    path.join(config.skills.workspaceDirectory, 'skills'),
    path.join(config.skills.workspaceDirectory, '.agents', 'skills'),
  ];
  const autoClawi = config.skills.autoImportClawi
    ? [path.join(os.homedir(), 'Desktop', 'clawi', 'openclaw', 'skills')]
    : [];
  return toUnique([...fromConfig, ...fromWorkspace, ...autoClawi]);
}

function buildSkillFromFile(params: {
  filePath: string;
  content: string;
  updatedAtMs: number;
}): Skill {
  const { frontmatter, body } = parseFrontmatter(params.content);
  const dirName = path.basename(path.dirname(params.filePath));
  const fallbackName = dirName && dirName !== '.' ? dirName : path.basename(params.filePath, '.md');
  const name = frontmatter.name?.trim() || fallbackName || 'Unnamed Skill';
  const description = frontmatter.description?.trim() || `Skill loaded from ${path.dirname(params.filePath)}`;
  const explicitTools = parseListValue(frontmatter.tools || '');
  const prompt = body.trim() || params.content.trim();

  return {
    id: sanitizeSkillId(name),
    name,
    description,
    prompt,
    tools: explicitTools,
    source: 'filesystem',
    filePath: params.filePath,
    updatedAt: params.updatedAtMs,
    metadata: {
      frontmatter,
    },
  };
}

function mergeByPriority(base: Skill[], incoming: Skill[]): Skill[] {
  const merged = new Map<string, Skill>();
  for (const skill of base) {
    merged.set(skill.id, skill);
  }
  for (const skill of incoming) {
    merged.set(skill.id, skill);
  }
  return Array.from(merged.values());
}

export async function loadSkillsFromFilesystem(
  config: OpenClawConfig,
): Promise<FilesystemSkillLoadResult> {
  const roots = resolveSkillRoots(config);
  const loadedFiles: string[] = [];
  const skippedFiles: Array<{ filePath: string; reason: string }> = [];
  let skills: Skill[] = [];

  for (const root of roots) {
    if (!(await dirExists(root))) {
      continue;
    }

    const skillFiles = await listSkillFilesInRoot(root);
    const discoveredSkills: Skill[] = [];
    for (const filePath of skillFiles) {
      try {
        const stat = await fs.stat(filePath);
        if (stat.size > config.skills.maxSkillFileBytes) {
          skippedFiles.push({
            filePath,
            reason: `File too large (${stat.size} bytes)`,
          });
          continue;
        }
        const content = await fs.readFile(filePath, 'utf-8');
        discoveredSkills.push(
          buildSkillFromFile({
            filePath,
            content,
            updatedAtMs: stat.mtimeMs,
          }),
        );
        loadedFiles.push(filePath);
      } catch (error: any) {
        skippedFiles.push({
          filePath,
          reason: error?.message || 'Failed to read SKILL.md',
        });
      }
    }

    skills = mergeByPriority(skills, discoveredSkills);
  }

  return {
    skills,
    scannedRoots: roots,
    loadedFiles,
    skippedFiles,
  };
}

export const defaultMaxSkillFileBytes = DEFAULT_MAX_SKILL_FILE_BYTES;
