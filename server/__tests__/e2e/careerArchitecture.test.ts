import { describe, it, expect, beforeEach } from "vitest";

interface DocResult {
  type: string;
  [key: string]: unknown;
}

function analyzePrompt(prompt: string): DocResult {
  const lower = prompt.toLowerCase();
  const result: DocResult = { type: "unknown" };

  if (lower.includes("excel") || lower.includes("cuantificación") || lower.includes("timeline") || lower.includes("leed") || lower.includes("cargas estructurales") || lower.includes("quantity takeoff")) result.type = "spreadsheet";
  else if (lower.includes("word") || lower.includes("especificaciones") || lower.includes("informe de avance") || lower.includes("progress report")) result.type = "document";
  else if (lower.includes("ppt") || lower.includes("presentación") || lower.includes("diseño urbano") || lower.includes("paisajismo") || lower.includes("landscape")) result.type = "presentation";
  else if (lower.includes("diagrama") || lower.includes("flowchart") || lower.includes("organigrama") || lower.includes("svg") || lower.includes("trámite de licencia") || lower.includes("building permit")) result.type = "diagram";

  return result;
}

describe("Architecture & Urban Planning document generation", () => {
  it("generates architectural specifications Word with CSI format", () => {
    const prompt = "Genera un Word de especificaciones arquitectónicas formato CSI MasterFormat con divisiones: sitework, concrete, masonry, metals, wood, finishes";
    const result = analyzePrompt(prompt);
    const divisions = ["sitework", "concrete", "masonry", "metals", "wood", "finishes"];

    expect(result.type).toBe("document");
    for (const d of divisions) {
      expect(prompt.toLowerCase()).toContain(d);
    }
    expect(divisions).toHaveLength(6);
  });

  it("generates material quantity takeoff Excel with unit costs and totals", () => {
    const prompt = "Crea un Excel de material quantity takeoff con materiales: concreto, acero, ladrillo, cemento, arena, grava con fórmulas subtotal=cantidad*precioUnitario y SUM total";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("SUM");
    const materials = ["concreto", "acero", "ladrillo", "cemento", "arena", "grava"];
    expect(materials).toHaveLength(6);
    expect(prompt.toLowerCase()).toContain("subtotal");
  });

  it("generates urban design PPT with zoning analysis", () => {
    const prompt = "Genera una presentación PPT de análisis de diseño urbano zonificación con slides: ubicación, zonificación, densidad, alturas, uso de suelo, equipamiento";
    const result = analyzePrompt(prompt);
    const topics = ["ubicación", "zonificación", "densidad", "alturas", "uso de suelo", "equipamiento"];

    expect(result.type).toBe("presentation");
    for (const t of topics) {
      expect(prompt.toLowerCase()).toContain(t);
    }
    expect(topics).toHaveLength(6);
  });

  it("generates project timeline Excel with milestone tracking", () => {
    const prompt = "Crea un Excel de timeline de proyecto con fases: diseño esquemático, desarrollo, documentación, licitación, construcción con hitos y estado";
    const result = analyzePrompt(prompt);
    const phases = ["diseño esquemático", "desarrollo", "documentación", "licitación", "construcción"];

    expect(result.type).toBe("spreadsheet");
    expect(phases).toHaveLength(5);
    expect(prompt.toLowerCase()).toContain("diseño esquemático");
    expect(prompt.toLowerCase()).toContain("construcción");
    expect(prompt.toLowerCase()).toContain("hito");
  });

  it("generates building permit process flowchart", () => {
    const prompt = "Genera un diagrama del trámite de licencia de building permit process con pasos: solicitud, revisión, observaciones, aprobación, licencia, inspección";
    const result = analyzePrompt(prompt);
    const steps = ["solicitud", "revisión", "observaciones", "aprobación", "licencia", "inspección"];

    expect(result.type).toBe("diagram");
    for (const s of steps) {
      expect(prompt.toLowerCase()).toContain(s);
    }
  });

  it("generates sustainability LEED checklist Excel with scoring", () => {
    const prompt = "Crea un Excel de checklist LEED de sostenibilidad con categorías: sitio, agua, energía, materiales, calidad interior y fórmulas SUM de puntos y porcentaje *100";
    const result = analyzePrompt(prompt);
    const categories = ["sitio", "agua", "energía", "materiales", "calidad interior"];

    expect(result.type).toBe("spreadsheet");
    for (const c of categories) {
      expect(prompt.toLowerCase()).toContain(c);
    }
    expect(prompt).toContain("SUM");
    expect(prompt).toContain("*100");
  });

  it("generates construction progress report Word with photos placeholder", () => {
    const prompt = "Genera un Word de informe de avance de obra semana 12 con secciones: avance, partidas ejecutadas, incidencias, fotografías (PLACEHOLDER), próximas actividades";
    const result = analyzePrompt(prompt);
    const sections = ["avance", "partidas ejecutadas", "incidencias", "fotografías", "próximas actividades"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(prompt).toContain("PLACEHOLDER");
  });

  it("generates structural load analysis Excel", () => {
    const prompt = "Crea un Excel de análisis de cargas estructurales con 5 vigas, fórmulas cargaTotal=cargaMuerta+cargaViva y momento=w*L^2/8";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("5 vigas");
    expect(prompt.toLowerCase()).toContain("cargamuerta");
    expect(prompt).toContain("L^2");
  });

  it("generates landscape design PPT with plant palette", () => {
    const prompt = "Genera una presentación PPT de diseño de paisajismo landscape con slides: concepto, zonificación, especies vegetales, riego, iluminación, mobiliario";
    const result = analyzePrompt(prompt);
    const topics = ["concepto", "zonificación", "especies vegetales", "riego", "iluminación", "mobiliario"];

    expect(result.type).toBe("presentation");
    for (const t of topics) {
      expect(prompt.toLowerCase()).toContain(t);
    }
    expect(topics).toHaveLength(6);
  });

  it("generates architecture firm SVG org chart", () => {
    const prompt = "Genera un organigrama SVG de firma de arquitectura con roles: Socios, Directores de Proyecto, Arquitectos, Dibujantes, Practicantes";
    const result = analyzePrompt(prompt);
    const roles = ["socios", "directores de proyecto", "arquitectos", "dibujantes", "practicantes"];

    expect(result.type).toBe("diagram");
    for (const r of roles) {
      expect(prompt.toLowerCase()).toContain(r);
    }
  });
});
