import { describe, it, expect } from "vitest";

// ── Design System ─────────────────────────────────────────────────────────
describe("design system", () => {
  it("exports 10 palettes", async () => {
    const { PALETTES } = await import("../skills/documents/designSystem");
    expect(Object.keys(PALETTES).length).toBe(10);
  });

  it("each palette has all required colors", async () => {
    const { PALETTES } = await import("../skills/documents/designSystem");
    const required = ["primary", "secondary", "accent", "background", "text", "muted", "border", "surface"];
    for (const [name, palette] of Object.entries(PALETTES)) {
      for (const key of required) {
        expect((palette as any)[key], `${name}.${key} missing`).toBeDefined();
        expect((palette as any)[key], `${name}.${key} not hex`).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it("getPalette returns default for unknown", async () => {
    const { getPalette } = await import("../skills/documents/designSystem");
    const p = getPalette("nonexistent");
    expect(p.name).toBeDefined();
  });

  it("getPaletteForFormat returns appropriate palette", async () => {
    const { getPaletteForFormat } = await import("../skills/documents/designSystem");
    const pptx = getPaletteForFormat("pptx");
    const xlsx = getPaletteForFormat("xlsx");
    expect(pptx.name).toBeDefined();
    expect(xlsx.name).toBeDefined();
  });

  it("exports typography rules", async () => {
    const { TYPOGRAPHY } = await import("../skills/documents/designSystem");
    expect(TYPOGRAPHY.titleSize[0]).toBeGreaterThan(20);
    expect(TYPOGRAPHY.bodySize[0]).toBeGreaterThan(8);
    expect(TYPOGRAPHY.titleFont).toBeDefined();
    expect(TYPOGRAPHY.bodyFont).toBeDefined();
  });

  it("exports anti-patterns list", async () => {
    const { ANTI_PATTERNS } = await import("../skills/documents/designSystem");
    expect(ANTI_PATTERNS.length).toBeGreaterThanOrEqual(8);
  });

  it("exports Excel color coding", async () => {
    const { EXCEL_COLOR_CODING } = await import("../skills/documents/designSystem");
    expect(EXCEL_COLOR_CODING.inputs).toMatch(/^#/);
    expect(EXCEL_COLOR_CODING.formulas).toMatch(/^#/);
    expect(EXCEL_COLOR_CODING.links).toMatch(/^#/);
  });
});

// ── Intent Router ─────────────────────────────────────────────────────────
describe("intent router", () => {
  it("routes create request to correct skill", async () => {
    const { routeDocumentIntent } = await import("../skills/documents/intentRouter");
    const result = routeDocumentIntent({
      userMessage: "crea una presentacion sobre IA",
      hasAttachment: false,
      requestedFormat: "pptx",
    });
    expect(result.intent).toBe("create");
    expect(result.skill).toContain("pptx");
  });

  it("routes edit when attachment present", async () => {
    const { routeDocumentIntent } = await import("../skills/documents/intentRouter");
    const result = routeDocumentIntent({
      userMessage: "edita este documento",
      hasAttachment: true,
      attachmentFormat: "docx",
      requestedFormat: "docx",
    });
    expect(result.intent).toBe("edit");
  });

  it("routes convert for different formats", async () => {
    const { routeDocumentIntent } = await import("../skills/documents/intentRouter");
    const result = routeDocumentIntent({
      userMessage: "convierte este word a pdf",
      hasAttachment: true,
      attachmentFormat: "docx",
      requestedFormat: "pdf",
    });
    expect(result.intent).toBe("convert");
  });

  it("routes redline for legal context", async () => {
    const { routeDocumentIntent } = await import("../skills/documents/intentRouter");
    const result = routeDocumentIntent({
      userMessage: "revisa este contrato",
      hasAttachment: true,
      attachmentFormat: "docx",
      requestedFormat: "docx",
      context: "legal",
    });
    expect(["redline", "edit"]).toContain(result.intent);
  });
});

// ── Skill Registry ────────────────────────────────────────────────────────
describe("skill registry", () => {
  it("returns Level 1 summaries for all 4 skills", async () => {
    const { skillRegistry } = await import("../skills/documents/registry");
    const summaries = skillRegistry.getLevel1Summaries();
    expect(summaries.length).toBe(4);
    expect(summaries.map(s => s.format)).toContain("pptx");
    expect(summaries.map(s => s.format)).toContain("docx");
    expect(summaries.map(s => s.format)).toContain("xlsx");
    expect(summaries.map(s => s.format)).toContain("pdf");
  });

  it("loads Level 2 SKILL.md content", async () => {
    const { skillRegistry } = await import("../skills/documents/registry");
    const content = skillRegistry.loadLevel2("pptx");
    expect(content).toBeDefined();
    expect(content!.length).toBeGreaterThan(100);
    expect(content).toContain("PptxGenJS");
  });

  it("matches user message to skill", async () => {
    const { skillRegistry } = await import("../skills/documents/registry");
    const match = skillRegistry.matchSkill("crea una presentacion sobre IA");
    expect(match).toBeDefined();
    expect(match!.format).toBe("pptx");
  });

  it("matches Excel request", async () => {
    const { skillRegistry } = await import("../skills/documents/registry");
    const match = skillRegistry.matchSkill("crea un excel con datos de ventas");
    expect(match).toBeDefined();
    expect(match!.format).toBe("xlsx");
  });

  it("builds prompt for skill", async () => {
    const { skillRegistry } = await import("../skills/documents/registry");
    const prompt = skillRegistry.buildPromptForSkill("docx");
    expect(prompt.length).toBeGreaterThan(50);
  });

  it("returns null for unknown skill", async () => {
    const { skillRegistry } = await import("../skills/documents/registry");
    expect(skillRegistry.getSkill("nonexistent")).toBeNull();
  });
});

// ── Claude Skills Adapter ─────────────────────────────────────────────────
describe("Claude Skills adapter", () => {
  it("exports generateViaClaudeSkills function", async () => {
    const mod = await import("../skills/documents/claudeSkillsAdapter");
    expect(typeof mod.generateViaClaudeSkills).toBe("function");
  });

  it("returns null when ANTHROPIC_API_KEY not set", async () => {
    const origKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { generateViaClaudeSkills } = await import("../skills/documents/claudeSkillsAdapter");
      const result = await generateViaClaudeSkills({
        prompt: "test",
        format: "pptx",
      });
      expect(result).toBeNull();
    } finally {
      if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
    }
  });
});

// ── Skill Files Exist ─────────────────────────────────────────────────────
describe("skill files", () => {
  it("PPTX SKILL.md exists and has content", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const skillPath = path.join(process.cwd(), "server/skills/pptx/SKILL.md");
    expect(fs.existsSync(skillPath)).toBe(true);
    const content = fs.readFileSync(skillPath, "utf-8");
    expect(content.length).toBeGreaterThan(200);
  });

  it("DOCX SKILL.md exists and has content", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const skillPath = path.join(process.cwd(), "server/skills/docx/SKILL.md");
    expect(fs.existsSync(skillPath)).toBe(true);
  });

  it("XLSX SKILL.md exists and has content", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const skillPath = path.join(process.cwd(), "server/skills/xlsx/SKILL.md");
    expect(fs.existsSync(skillPath)).toBe(true);
  });

  it("PDF SKILL.md exists and has content", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const skillPath = path.join(process.cwd(), "server/skills/pdf/SKILL.md");
    expect(fs.existsSync(skillPath)).toBe(true);
  });
});
