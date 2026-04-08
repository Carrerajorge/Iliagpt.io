/** Skill Registry — 3-level progressive loading for document skills */

import type { SkillDefinition, DocumentFormat, DesignPalette } from "./types";
import * as fs from "fs";
import * as path from "path";

const SKILLS_DIR = path.join(__dirname, "..");

const SKILL_DEFINITIONS: SkillDefinition[] = [
  {
    name: "pptx",
    description: "Create professional PowerPoint presentations with PptxGenJS",
    format: "pptx",
    triggers: ["presentacion", "powerpoint", "ppt", "slides", "diapositivas", "presentation"],
    level1Summary: "Creates .pptx files using PptxGenJS with 10 design palettes",
    level2Path: "pptx/SKILL.md",
    level3Refs: ["pptx/templates.md"],
  },
  {
    name: "docx",
    description: "Create professional Word documents with docx library",
    format: "docx",
    triggers: ["documento", "word", "docx", "informe", "reporte", "document", "report"],
    level1Summary: "Creates .docx files using docx npm library with professional formatting",
    level2Path: "docx/SKILL.md",
    level3Refs: [],
  },
  {
    name: "xlsx",
    description: "Create professional Excel spreadsheets with ExcelJS",
    format: "xlsx",
    triggers: ["excel", "xlsx", "hoja", "spreadsheet", "tabla", "datos", "data"],
    level1Summary: "Creates .xlsx files using ExcelJS with formulas and formatting",
    level2Path: "xlsx/SKILL.md",
    level3Refs: [],
  },
  {
    name: "pdf",
    description: "Create professional PDF documents with PDFKit",
    format: "pdf",
    triggers: ["pdf", "reporte pdf"],
    level1Summary: "Creates .pdf files using PDFKit with professional layouts",
    level2Path: "pdf/SKILL.md",
    level3Refs: [],
  },
];

export class SkillRegistry {
  private cache = new Map<string, string>(); // skill name → loaded SKILL.md content

  /** Level 1: Get all skill summaries (~100 tokens each) */
  getLevel1Summaries(): Array<{ name: string; description: string; format: string }> {
    return SKILL_DEFINITIONS.map((s) => ({
      name: s.name,
      description: s.description,
      format: s.format,
    }));
  }

  /** Level 2: Load full SKILL.md for a specific skill */
  loadLevel2(skillName: string): string | null {
    const cached = this.cache.get(skillName);
    if (cached) return cached;

    const def = this.getSkill(skillName);
    if (!def) return null;

    const filePath = path.join(SKILLS_DIR, def.level2Path);
    try {
      if (!fs.existsSync(filePath)) return null;
      const content = fs.readFileSync(filePath, "utf-8");
      this.cache.set(skillName, content);
      return content;
    } catch (err: any) {
      console.warn(`[SkillRegistry] Failed to load Level 2 for "${skillName}": ${err?.message}`);
      return null;
    }
  }

  /** Level 3: Load additional reference files */
  loadLevel3(skillName: string, refIndex: number): string | null {
    const def = this.getSkill(skillName);
    if (!def) return null;
    if (refIndex < 0 || refIndex >= def.level3Refs.length) return null;

    const cacheKey = `${skillName}:L3:${refIndex}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const refRelative = def.level3Refs[refIndex];
    // Sanitize to prevent directory traversal
    const safePath = refRelative.replace(/\.\./g, "");
    const filePath = path.join(SKILLS_DIR, safePath);

    try {
      if (!fs.existsSync(filePath)) return null;
      const content = fs.readFileSync(filePath, "utf-8");
      this.cache.set(cacheKey, content);
      return content;
    } catch (err: any) {
      console.warn(`[SkillRegistry] Failed to load Level 3 ref ${refIndex} for "${skillName}": ${err?.message}`);
      return null;
    }
  }

  /** Match user message to best skill via keyword scoring */
  matchSkill(message: string): SkillDefinition | null {
    const lower = message
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    let bestMatch: SkillDefinition | null = null;
    let bestScore = 0;

    for (const def of SKILL_DEFINITIONS) {
      let score = 0;
      for (const trigger of def.triggers) {
        const normalizedTrigger = trigger
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
        if (lower.includes(normalizedTrigger)) {
          // Multi-word triggers score higher (more specific)
          score += normalizedTrigger.split(/\s+/).length;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = def;
      }
    }

    return bestScore > 0 ? bestMatch : null;
  }

  /** Get skill definition by name */
  getSkill(name: string): SkillDefinition | null {
    return SKILL_DEFINITIONS.find((s) => s.name === name) ?? null;
  }

  /** Build system prompt with matched skill (Level 1 + Level 2 combined) */
  buildPromptForSkill(skillName: string): string {
    const def = this.getSkill(skillName);
    if (!def) return "";

    const level2 = this.loadLevel2(skillName);
    if (!level2) {
      // Fallback to Level 1 summary only
      return [
        `<skill name="${def.name}" format="${def.format}">`,
        def.level1Summary,
        `</skill>`,
      ].join("\n");
    }

    return [
      `<skill name="${def.name}" format="${def.format}">`,
      level2,
      `</skill>`,
    ].join("\n");
  }
}

export const skillRegistry = new SkillRegistry();
