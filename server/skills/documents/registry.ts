/** Document Skill Registry — 3-level progressive loading with real execution. */
import * as fs from "fs";
import * as path from "path";
import type { DocumentSkillDefinition, DocumentExecutionContext, DocumentResult, DocumentQaReport } from "./types";

const SKILLS_BASE = path.join(process.cwd(), "server", "skills");
const ARTIFACTS_DIR = path.join(process.cwd(), "artifacts");

function readSkillFile(rel: string): Promise<string> {
  const p = path.join(SKILLS_BASE, rel.replace(/\.\./g, ""));
  return new Promise((r) => {
    try { r(fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : `[not found: ${rel}]`); }
    catch { r(`[error: ${rel}]`); }
  });
}
function readSkillFileSync(rel: string): string | null {
  const p = path.join(SKILLS_BASE, rel.replace(/\.\./g, ""));
  try { return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : null; }
  catch { return null; }
}
function ensureArtifactsDir() {
  if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}
function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9\u00C0-\u024F _-]/g, "").replace(/\s+/g, "_").slice(0, 60);
}
function emptyQa(): DocumentQaReport {
  return { status: "skipped", severity: "none", findings: [], metrics: { validationMs: 0, repairLoops: 0 } };
}

// ── Dynamic generator execution ──────────────────────────────────
type GenType = "pptx" | "docx" | "xlsx" | "pdf";
const GEN_MAP: Record<GenType, "pptx" | "word" | "excel" | "pdf"> = { pptx: "pptx", docx: "word", xlsx: "excel", pdf: "pdf" };

async function executeWithExistingGenerator(ctx: DocumentExecutionContext, gen: GenType): Promise<DocumentResult> {
  const t0 = Date.now();
  const { generateDocument } = await import("../../services/documentGeneration");
  const title = ctx.userMessage.slice(0, 80).replace(/\n/g, " ") || "Document";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contentMap: Record<GenType, any> = {
    pptx: { title, slides: [{ type: "title", title, bullets: [ctx.userMessage] }] },
    docx: { title, sections: [{ heading: title, paragraphs: [ctx.userMessage] }] },
    xlsx: { sheetName: "Sheet1", title, headers: ["Content"], rows: [[ctx.userMessage]] },
    pdf: { title, sections: [{ heading: title, paragraphs: [ctx.userMessage] }] },
  };
  const doc = await generateDocument(GEN_MAP[gen], contentMap[gen]);
  ensureArtifactsDir();
  const stored = `${Date.now()}_${sanitize(doc.filename)}`;
  fs.writeFileSync(path.join(ARTIFACTS_DIR, stored), doc.buffer);
  return {
    buffer: doc.buffer, filename: doc.filename, mimeType: doc.mimeType, downloadUrl: doc.downloadUrl,
    metadata: { skillId: gen, operation: ctx.operation, backendUsed: ctx.backend, paletteId: ctx.palette, durationMs: Date.now() - t0, qa: emptyQa() },
  };
}

// ── Skill Definitions ────────────────────────────────────────────
const L2: Record<string, string> = { pptx: "pptx/SKILL.md", docx: "docx/SKILL.md", xlsx: "xlsx/SKILL.md", pdf: "pdf/SKILL.md" };

function builtinSkills(): DocumentSkillDefinition[] {
  return [
    { id: "pptx", format: "pptx", operations: ["create", "edit"],
      triggers: ["presentacion","presentación","powerpoint","ppt","slides","diapositivas","presentation","slide deck"],
      level1Summary: "Creates professional .pptx with PptxGenJS. 10 design palettes, 36-44pt titles, 14-16pt body.",
      loadLevel2: () => readSkillFile("pptx/SKILL.md"), loadLevel3: (_r: string) => readSkillFile("pptx/templates.md"),
      execute: (ctx) => executeWithExistingGenerator(ctx, "pptx"), qaPolicy: "advisor", backendSupport: ["native","claude-skills"] },
    { id: "docx", format: "docx", operations: ["create", "edit", "redline"],
      triggers: ["documento","document","word","docx","informe","reporte","report","carta","letter","ensayo","essay"],
      level1Summary: "Creates professional .docx with docx npm library. Calibri typography, cover pages, headers/footers.",
      loadLevel2: () => readSkillFile("docx/SKILL.md"), loadLevel3: async () => null,
      execute: (ctx) => executeWithExistingGenerator(ctx, "docx"), qaPolicy: "advisor", backendSupport: ["native","claude-skills"] },
    { id: "xlsx", format: "xlsx", operations: ["create", "edit"],
      triggers: ["excel","xlsx","hoja","spreadsheet","tabla","datos","data","hoja de calculo","hoja de cálculo","workbook"],
      level1Summary: "Creates professional .xlsx with ExcelJS. Auto-formatted numbers, alternating rows, frozen headers.",
      loadLevel2: () => readSkillFile("xlsx/SKILL.md"), loadLevel3: async () => null,
      execute: (ctx) => executeWithExistingGenerator(ctx, "xlsx"), qaPolicy: "advisor", backendSupport: ["native","claude-skills"] },
    { id: "pdf", format: "pdf", operations: ["create"],
      triggers: ["pdf","reporte pdf","pdf report"],
      level1Summary: "Creates professional .pdf with PDFKit. A4 layout, page numbers, section headings.",
      loadLevel2: () => readSkillFile("pdf/SKILL.md"), loadLevel3: async () => null,
      execute: (ctx) => executeWithExistingGenerator(ctx, "pdf"), qaPolicy: "advisor", backendSupport: ["native"] },
  ];
}

// ── Registry Class ───────────────────────────────────────────────
export class DocumentSkillRegistry {
  private skills = new Map<string, DocumentSkillDefinition>();
  private level2Cache = new Map<string, string>();
  private level3Cache = new Map<string, string>();

  constructor() { for (const s of builtinSkills()) this.skills.set(s.id, s); }

  /** Level 1: Get summaries for all skills (~100 tokens each, for planner) */
  getLevel1Summaries(): Array<{ id: string; format: string; operations: string[]; summary: string }> {
    return Array.from(this.skills.values()).map((s) => ({
      id: s.id, format: s.format, operations: [...s.operations], summary: s.level1Summary,
    }));
  }

  /** Level 2: Load full SKILL.md for a specific format (sync, cached) */
  loadLevel2(skillId: string): string | null {
    const cached = this.level2Cache.get(skillId);
    if (cached) return cached;
    if (!this.skills.has(skillId) || !L2[skillId]) return null;
    const content = readSkillFileSync(L2[skillId]);
    if (content) this.level2Cache.set(skillId, content);
    return content;
  }

  /** Level 2 async variant — resolves via skill's own loader */
  async loadLevel2Async(skillId: string): Promise<string | null> {
    const cached = this.level2Cache.get(skillId);
    if (cached) return cached;
    const skill = this.skills.get(skillId);
    if (!skill) return null;
    const content = await skill.loadLevel2();
    if (content) this.level2Cache.set(skillId, content);
    return content;
  }

  /** Level 3: Load reference docs (only when repair, edit, or QA fail) */
  async loadLevel3(skillId: string, reason: string): Promise<string | null> {
    const key = `${skillId}:${reason}`;
    const cached = this.level3Cache.get(key);
    if (cached) return cached;
    const skill = this.skills.get(skillId);
    if (!skill) return null;
    const content = await skill.loadLevel3(reason);
    if (content) this.level3Cache.set(key, content);
    return content;
  }

  /** Get a skill definition */
  getSkill(id: string): DocumentSkillDefinition | null {
    return this.skills.get(id) ?? null;
  }

  /** Match user message to skill via keyword scoring */
  matchSkill(message: string): DocumentSkillDefinition | null {
    const lower = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    let best: DocumentSkillDefinition | null = null;
    let bestScore = 0;
    for (const skill of this.skills.values()) {
      let score = 0;
      for (const t of skill.triggers) {
        const n = t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (lower.includes(n)) score += n.split(/\s+/).length;
      }
      if (score > bestScore) { bestScore = score; best = skill; }
    }
    return bestScore > 0 ? best : null;
  }

  /** Execute a document generation via the matched skill */
  async execute(ctx: DocumentExecutionContext): Promise<DocumentResult> {
    const skill = this.skills.get(ctx.format);
    if (!skill) throw new Error(`[DocumentSkillRegistry] No skill for format: ${ctx.format}`);
    return skill.execute(ctx);
  }

  /** Build system prompt with matched skill (Level 1 + Level 2 combined) */
  buildPromptForSkill(skillId: string): string {
    const s = this.skills.get(skillId);
    if (!s) return "";
    const l2 = this.loadLevel2(skillId);
    const body = l2 || s.level1Summary;
    return `<skill name="${s.id}" format="${s.format}">\n${body}\n</skill>`;
  }
}

export const documentSkillRegistry = new DocumentSkillRegistry();
/** @deprecated Use documentSkillRegistry instead */
export const skillRegistry = documentSkillRegistry;
/** @deprecated Use DocumentSkillRegistry instead */
export { DocumentSkillRegistry as SkillRegistry };
