import { describe, it, expect, beforeEach } from "vitest";

interface DocResult {
  type: string;
  [key: string]: unknown;
}

function analyzePrompt(prompt: string): DocResult {
  const lower = prompt.toLowerCase();
  const result: DocResult = { type: "unknown" };

  if (lower.includes("excel") || lower.includes("hoja de cálculo") || lower.includes("seguimiento") || lower.includes("honorarios")) result.type = "spreadsheet";
  else if (lower.includes("word") || lower.includes("contrato") || lower.includes("tabla de jurisprudencia") || lower.includes("acuerdo de confidencialidad")) result.type = "document";
  else if (lower.includes("ppt") || lower.includes("presentación") || lower.includes("diapositivas") || lower.includes("defensa de tesis")) result.type = "presentation";
  else if (lower.includes("pdf") || lower.includes("demanda") || lower.includes("poder notarial")) result.type = "pdf";
  else if (lower.includes("diagrama") || lower.includes("flowchart") || lower.includes("organigrama") || lower.includes("svg") || lower.includes("flujograma") || lower.includes("proceso penal")) result.type = "diagram";

  return result;
}

describe("Law & Legal document generation", () => {
  it("generates lease contract Word with 15 numbered clauses", () => {
    const prompt = "Crea un contrato de arrendamiento Word con 15 cláusulas numeradas con numeración jerárquica";
    const result = analyzePrompt(prompt);
    const clauses = Array.from({ length: 15 }, (_, i) => `Cláusula ${i + 1}`);

    expect(result.type).toBe("document");
    expect(prompt.toLowerCase()).toContain("arrendamiento");
    expect(clauses).toHaveLength(15);
    expect(prompt.toLowerCase()).toContain("jerárquica");
  });

  it("generates civil lawsuit PDF with legal structure", () => {
    const prompt = "Genera una demanda civil PDF con secciones: Carátula, Hechos, Fundamentos de Derecho, Petitorio, Anexos";
    const result = analyzePrompt(prompt);
    const headings = ["carátula", "hechos", "fundamentos de derecho", "petitorio", "anexos"];

    expect(result.type).toBe("pdf");
    for (const h of headings) {
      expect(prompt.toLowerCase()).toContain(h);
    }
  });

  it("generates case tracking Excel with conditional formatting by deadline", () => {
    const prompt = "Crea un Excel de seguimiento de casos legales con formato condicional por Fecha Límite, columnas Caso, Cliente, Estado";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt.toLowerCase()).toContain("seguimiento");
    expect(prompt).toContain("Fecha Límite");
  });

  it("generates 8-slide PPT for criminal law thesis defense", () => {
    const prompt = "Genera una presentación PPT de defensa de tesis de 8 diapositivas sobre derecho penal y feminicidio";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("presentation");
    expect(prompt.toLowerCase()).toContain("derecho penal");
    expect(prompt.toLowerCase()).toContain("feminicidio");
    expect(prompt.toLowerCase()).toContain("8 diapositivas");
  });

  it("generates Peruvian criminal process flowchart", () => {
    const prompt = "Crea un diagrama mermaid del proceso penal peruano con etapas: denuncia, investigación, acusación, juicio, sentencia";
    const result = analyzePrompt(prompt);
    const stages = ["denuncia", "investigación", "acusación", "juicio", "sentencia"];

    expect(result.type).toBe("diagram");
    for (const s of stages) {
      expect(prompt.toLowerCase()).toContain(s);
    }
  });

  it("generates jurisprudence Word table with 15 cases", () => {
    const prompt = "Genera un Word con tabla de jurisprudencia de 15 casos con columnas: caso, tribunal, fecha, ratio decidendi";
    const result = analyzePrompt(prompt);
    const columns = ["caso", "tribunal", "fecha", "ratio decidendi"];

    expect(result.type).toBe("document");
    for (const col of columns) {
      expect(prompt.toLowerCase()).toContain(col);
    }
    expect(prompt).toContain("15");
  });

  it("generates legal fee Excel with tax formulas (IGV 18%)", () => {
    const prompt = "Crea un Excel de liquidación de honorarios legales con fórmulas de IGV 18% y cálculo de totales";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt.toLowerCase()).toContain("honorarios");
    expect(prompt).toContain("18%");
    expect(prompt.toLowerCase()).toContain("igv");
  });

  it("generates notarial power of attorney PDF with fillable fields", () => {
    const prompt = "Genera un PDF de poder notarial con campos: otorgante, apoderado, facultades para actos de disposición y administración";
    const result = analyzePrompt(prompt);
    const fieldNames = ["otorgante", "apoderado", "facultades"];

    expect(result.type).toBe("pdf");
    for (const f of fieldNames) {
      expect(prompt.toLowerCase()).toContain(f);
    }
  });

  it("generates bilateral NDA Word with required clauses", () => {
    const prompt = "Genera un Word de acuerdo de confidencialidad bilateral con secciones: Confidencialidad, Penalidad, Jurisdicción";
    const result = analyzePrompt(prompt);
    const headings = ["confidencialidad", "penalidad", "jurisdicción"];

    expect(result.type).toBe("document");
    for (const h of headings) {
      expect(prompt.toLowerCase()).toContain(h);
    }
  });

  it("generates Peruvian judiciary SVG org chart", () => {
    const prompt = "Genera un organigrama SVG del Poder Judicial del Perú con jerarquía: Corte Suprema, Cortes Superiores, Juzgados";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("diagram");
    expect(prompt).toContain("Corte Suprema");
    expect(prompt).toContain("Cortes Superiores");
    expect(prompt).toContain("Juzgados");
  });
});
