/**
 * Skill Loader — 3-level progressive loading system
 *
 * Level 1: Metadata only (~100 tokens/skill) — always in memory
 * Level 2: Full SKILL.md instructions — loaded on demand
 * Level 3: Additional reference files — loaded on demand
 *
 * Replicates Claude's pattern: metadata is cheap, instructions are loaded
 * only when a skill matches, references only when explicitly needed.
 */

import * as fs from "fs";
import * as path from "path";

// ============================================================================
// Types
// ============================================================================

export interface SkillMetadata {
  name: string;
  description: string;
  keywords: string[];
  type: "document" | "visual" | "code" | "data";
  format?: string; // "pptx" | "docx" | "xlsx" | "pdf"
}

export interface LoadedSkill {
  metadata: SkillMetadata;
  instructions: string;  // Full SKILL.md content
  references: Map<string, string>; // Additional reference files
}

// ============================================================================
// Pre-registered skill metadata (Level 1 — always loaded)
// ============================================================================

const SKILL_REGISTRY: Map<string, SkillMetadata> = new Map([
  ["pptx", {
    name: "pptx",
    description: "Create professional PowerPoint presentations",
    keywords: ["presentacion", "powerpoint", "ppt", "slides", "diapositivas", "presentation"],
    type: "document" as const,
    format: "pptx",
  }],
  ["docx", {
    name: "docx",
    description: "Create professional Word documents",
    keywords: ["documento", "word", "docx", "informe", "reporte", "document", "report"],
    type: "document" as const,
    format: "docx",
  }],
  ["xlsx", {
    name: "xlsx",
    description: "Create professional Excel spreadsheets",
    keywords: ["excel", "xlsx", "hoja", "spreadsheet", "tabla", "datos", "data"],
    type: "document" as const,
    format: "xlsx",
  }],
  ["pdf", {
    name: "pdf",
    description: "Create professional PDF documents",
    keywords: ["pdf", "reporte pdf", "pdf report"],
    type: "document" as const,
    format: "pdf",
  }],
]);

// ============================================================================
// Cache for loaded skills (Level 2)
// ============================================================================

const skillCache: Map<string, LoadedSkill> = new Map();

const SKILLS_DIR = path.join(process.cwd(), "server", "skills");

// ============================================================================
// YAML Frontmatter Parser (minimal, no external deps)
// ============================================================================

function parseFrontmatter(content: string): { metadata: Partial<SkillMetadata>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { metadata: {}, body: content };

  const raw = match[1];
  const body = match[2];
  const metadata: Record<string, any> = {};

  for (const line of raw.split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (key === "keywords") {
      metadata.keywords = value
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((s: string) => s.trim().replace(/^["']|["']$/g, ""));
    } else {
      metadata[key] = value.replace(/^["']|["']$/g, "");
    }
  }

  return { metadata: metadata as Partial<SkillMetadata>, body };
}

// ============================================================================
// Level 1: Get all skill metadata (cheap — always available)
// ============================================================================

export function getSkillMetadata(): SkillMetadata[] {
  return Array.from(SKILL_REGISTRY.values());
}

// ============================================================================
// Level 2: Load full skill instructions on demand
// ============================================================================

export function loadSkill(skillName: string): LoadedSkill | null {
  // Return from cache if already loaded
  const cached = skillCache.get(skillName);
  if (cached) return cached;

  // Verify skill exists in registry
  const metadata = SKILL_REGISTRY.get(skillName);
  if (!metadata) return null;

  // Try to read SKILL.md from disk
  const skillDir = path.join(SKILLS_DIR, skillName);
  const skillFile = path.join(skillDir, "SKILL.md");

  let instructions = "";
  let finalMetadata = { ...metadata };

  if (fs.existsSync(skillFile)) {
    try {
      const raw = fs.readFileSync(skillFile, "utf-8");
      const { metadata: frontmatter, body } = parseFrontmatter(raw);
      instructions = body.trim();

      // Merge frontmatter into metadata (frontmatter overrides defaults)
      if (frontmatter.description) finalMetadata.description = frontmatter.description;
      if (frontmatter.keywords?.length) finalMetadata.keywords = frontmatter.keywords;
      if (frontmatter.type) finalMetadata.type = frontmatter.type as SkillMetadata["type"];
      if (frontmatter.format) finalMetadata.format = frontmatter.format;
    } catch (err: any) {
      console.warn(`[SkillLoader] Failed to read ${skillFile}: ${err?.message}`);
    }
  }

  const loaded: LoadedSkill = {
    metadata: finalMetadata,
    instructions,
    references: new Map(),
  };

  skillCache.set(skillName, loaded);
  return loaded;
}

// ============================================================================
// Level 3: Load additional reference files on demand
// ============================================================================

export function loadSkillReference(skillName: string, refFile: string): string | null {
  const skill = loadSkill(skillName);
  if (!skill) return null;

  // Return from cache if already loaded
  const cached = skill.references.get(refFile);
  if (cached) return cached;

  // Read reference file from disk
  const safeName = refFile.replace(/\.\./g, "").replace(/[^a-zA-Z0-9._-]/g, "");
  const refPath = path.join(SKILLS_DIR, skillName, safeName);

  if (!fs.existsSync(refPath)) return null;

  try {
    const content = fs.readFileSync(refPath, "utf-8");
    skill.references.set(refFile, content);
    return content;
  } catch (err: any) {
    console.warn(`[SkillLoader] Failed to read reference ${refPath}: ${err?.message}`);
    return null;
  }
}

// ============================================================================
// Match user message to a skill via keyword matching
// ============================================================================

export function matchSkill(message: string): SkillMetadata | null {
  const lower = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  let bestMatch: SkillMetadata | null = null;
  let bestScore = 0;

  for (const metadata of Array.from(SKILL_REGISTRY.values())) {
    let score = 0;
    for (const keyword of metadata.keywords) {
      const normalizedKw = keyword.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (lower.includes(normalizedKw)) {
        // Multi-word keywords score higher (more specific)
        score += normalizedKw.split(/\s+/).length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = metadata;
    }
  }

  return bestScore > 0 ? bestMatch : null;
}

// ============================================================================
// Build system prompt addition for a matched skill
// ============================================================================

export function buildSkillPrompt(skill: LoadedSkill): string {
  const { metadata, instructions } = skill;

  if (!instructions) {
    return `[Skill: ${metadata.name}] ${metadata.description}`;
  }

  return [
    `<skill name="${metadata.name}" type="${metadata.type}"${metadata.format ? ` format="${metadata.format}"` : ""}>`,
    instructions,
    `</skill>`,
  ].join("\n");
}
