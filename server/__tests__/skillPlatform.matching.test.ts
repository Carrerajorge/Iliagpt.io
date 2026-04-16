import { describe, expect, it } from "vitest";
import type { SkillSpec } from "@shared/schema/skillPlatform";
import { SkillPlatformService, type SkillExecutionRequest } from "../services/skillPlatform";

function makeSpec(overrides: Partial<SkillSpec> = {}): SkillSpec {
  return {
    name: "Skill de prueba",
    description: "Descripcion base",
    category: "general",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      additionalProperties: true,
    },
    outputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      additionalProperties: true,
    },
    permissions: ["storage.read"],
    expectedLatencyMs: 500,
    expectedCostCents: 0,
    dependencies: [],
    errorContract: [],
    examples: [],
    tags: [],
    implementationMode: "code",
    code: {
      language: "javascript",
      source: "module.exports = async function run(input) { return { text: String(input?.text || '') }; };",
    },
    executionPolicy: {
      maxRetries: 0,
      timeoutMs: 5000,
      requiresConfirmation: false,
      allowExternalSideEffects: false,
    },
    status: "active",
    ...overrides,
  };
}

function makeRuntimeSkill(slug: string, specOverrides: Partial<SkillSpec> = {}, category?: string) {
  const spec = makeSpec({
    ...specOverrides,
    ...(category ? { category } : {}),
  });

  return {
    catalogId: `catalog-${slug}`,
    versionId: `version-${slug}`,
    slug,
    name: spec.name,
    description: spec.description,
    category: spec.category,
    status: "active",
    spec,
    activeVersion: 1,
    latestVersion: 1,
    isManaged: true,
    createdBy: null,
  };
}

function makeRequest(overrides: Partial<SkillExecutionRequest> = {}): SkillExecutionRequest {
  return {
    requestId: "req-skill-match",
    userMessage: "mensaje de prueba",
    attachments: [],
    allowedScopes: [],
    autoCreate: false,
    ...overrides,
  };
}

describe("SkillPlatformService matching", () => {
  it("prefers an explicit @Skill reference when the exact skill exists", () => {
    const service = new SkillPlatformService();
    const explicitSkill = makeRuntimeSkill("pdf_expert", {
      name: "PDF Expert",
      description: "Analiza PDF y genera reportes.",
      category: "documents",
      tags: ["pdf", "documento", "analisis"],
    });
    const competingSkill = makeRuntimeSkill("slide_master", {
      name: "Slide Master",
      description: "Crea presentaciones profesionales.",
      category: "documents",
      tags: ["pptx", "powerpoint", "slides"],
    });

    (service as any).skillsBySlug.set(explicitSkill.slug, explicitSkill);
    (service as any).skillsBySlug.set(competingSkill.slug, competingSkill);

    const matches = (service as any).matchSkills(
      makeRequest({ userMessage: "@{PDF Expert} revisa este archivo" }),
      "@{PDF Expert} revisa este archivo",
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].skill.slug).toBe("pdf_expert");
    expect(matches[0].score).toBeGreaterThan(0.99);
    expect(matches[0].reason).toContain("explicit_skill_reference");
  });

  it("uses output format and intent hints to favor the right document skill", () => {
    const service = new SkillPlatformService();
    const wordSkill = makeRuntimeSkill("word_reporter", {
      name: "Word Reporter",
      description: "Genera documentos Word y reportes ejecutivos.",
      category: "documents",
      tags: ["word", "docx", "documento", "report"],
      examples: ["Crear reporte ejecutivo en Word"],
    });
    const slideSkill = makeRuntimeSkill("slide_builder", {
      name: "Slide Builder",
      description: "Genera decks PowerPoint para presentaciones.",
      category: "documents",
      tags: ["pptx", "powerpoint", "slides", "presentacion"],
      examples: ["Crear presentación comercial"],
    });

    (service as any).skillsBySlug.set(wordSkill.slug, wordSkill);
    (service as any).skillsBySlug.set(slideSkill.slug, slideSkill);

    const matches = (service as any).matchSkills(
      makeRequest({
        userMessage: "Prepara un entregable ejecutivo para mañana",
        intentHint: {
          intent: "CREATE_DOCUMENT",
          output_format: "docx",
          confidence: 0.94,
        },
      }),
      "Prepara un entregable ejecutivo para mañana",
    );

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].skill.slug).toBe("word_reporter");
    expect(matches[0].score).toBeGreaterThanOrEqual(0.35);
    expect(matches[0].reason).toMatch(/format|intent|category/);
  });

  it("uses attachment type signals to favor spreadsheet skills for xlsx files", () => {
    const service = new SkillPlatformService();
    const spreadsheetSkill = makeRuntimeSkill("spreadsheet_analyst", {
      name: "Spreadsheet Analyst",
      description: "Analiza hojas de cálculo y extrae hallazgos.",
      category: "data",
      tags: ["excel", "xlsx", "spreadsheet", "tabla", "datos"],
      examples: ["Analiza archivo de ventas en Excel"],
      permissions: ["storage.read", "files"],
    });
    const documentSkill = makeRuntimeSkill("document_reviewer", {
      name: "Document Reviewer",
      description: "Analiza documentos PDF y Word.",
      category: "documents",
      tags: ["pdf", "docx", "word", "documento"],
      examples: ["Analiza contrato en PDF"],
      permissions: ["storage.read", "files"],
    });

    (service as any).skillsBySlug.set(spreadsheetSkill.slug, spreadsheetSkill);
    (service as any).skillsBySlug.set(documentSkill.slug, documentSkill);

    const matches = (service as any).matchSkills(
      makeRequest({
        userMessage: "Analiza este archivo y dame hallazgos clave",
        attachments: [
          {
            id: "att-1",
            name: "ventas_q1.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            size: 1200,
          },
        ],
        intentHint: {
          intent: "ANALYZE_DOCUMENT",
          confidence: 0.87,
        },
      }),
      "Analiza este archivo y dame hallazgos clave",
    );

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].skill.slug).toBe("spreadsheet_analyst");
    expect(matches[0].score).toBeGreaterThanOrEqual(0.3);
    expect(matches[0].reason).toMatch(/attachment|format|category/);
  });
});
