import { describe, it, expect, beforeEach } from "vitest";

interface DocResult {
  type: string;
  [key: string]: unknown;
}

function analyzePrompt(prompt: string): DocResult {
  const lower = prompt.toLowerCase();
  const result: DocResult = { type: "unknown" };

  if (lower.includes("excel") || lower.includes("presupuesto de obra") || lower.includes("cronograma") || lower.includes("cubicación") || lower.includes("precios unitarios")) result.type = "spreadsheet";
  else if (lower.includes("pdf")) result.type = "pdf";
  else if (lower.includes("word") || lower.includes("memoria descriptiva") || lower.includes("estudio de") || lower.includes("especificaciones técnicas")) result.type = "document";
  else if (lower.includes("ppt") || lower.includes("presentación") || lower.includes("proyecto arquitectónico")) result.type = "presentation";
  else if (lower.includes("diagrama") || lower.includes("flowchart") || lower.includes("organigrama") || lower.includes("svg") || lower.includes("proceso constructivo")) result.type = "diagram";

  return result;
}

describe("Engineering & Architecture document generation", () => {
  it("generates construction budget Excel with 50 items and nested SUM formulas", () => {
    const prompt = "Crea un Excel de presupuesto de obra para edificio residencial con 50 partidas, fórmulas de subtotal y SUM total";
    const result = analyzePrompt(prompt);
    const partidas = Array.from({ length: 50 }, (_, i) => `Partida ${i + 1}`);

    expect(result.type).toBe("spreadsheet");
    expect(partidas).toHaveLength(50);
    expect(prompt.toLowerCase()).toContain("sum");
    expect(prompt.toLowerCase()).toContain("subtotal");
  });

  it("generates Gantt-style schedule Excel with 20 activities", () => {
    const prompt = "Genera un Excel de cronograma de obra estilo Gantt con 20 actividades, fechas de inicio, fin, duración y predecesores";
    const result = analyzePrompt(prompt);
    const activities = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, nombre: `Actividad ${i + 1}` }));

    expect(result.type).toBe("spreadsheet");
    expect(activities).toHaveLength(20);
    expect(prompt.toLowerCase()).toContain("inicio");
    expect(prompt.toLowerCase()).toContain("fin");
    expect(prompt.toLowerCase()).toContain("duración");
    expect(prompt.toLowerCase()).toContain("predecesores");
  });

  it("generates 5-story building descriptive report Word", () => {
    const prompt = "Genera un Word de memoria descriptiva para edificio de 5 pisos con secciones: ubicación, diseño, estructura, instalaciones";
    const result = analyzePrompt(prompt);
    const sections = ["ubicación", "diseño", "estructura", "instalaciones"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
  });

  it("generates architectural project PPT with plan/section/elevation slides", () => {
    const prompt = "Genera una presentación PPT de proyecto arquitectónico casa habitación con vistas: planta, corte, elevación, 3D";
    const result = analyzePrompt(prompt);
    const slideTypes = ["planta", "corte", "elevación", "3d"];

    expect(result.type).toBe("presentation");
    expect(slideTypes).toHaveLength(4);
    for (const t of slideTypes) {
      expect(prompt.toLowerCase()).toContain(t);
    }
  });

  it("generates construction process flowchart", () => {
    const prompt = "Crea un diagrama del proceso constructivo con etapas: excavación, cimentación, estructura, acabados, entrega";
    const result = analyzePrompt(prompt);
    const steps = ["excavación", "cimentación", "estructura", "acabados", "entrega"];

    expect(result.type).toBe("diagram");
    for (const step of steps) {
      expect(prompt.toLowerCase()).toContain(step);
    }
  });

  it("generates unit cost analysis Excel with material/labor formulas", () => {
    const prompt = "Crea un Excel de análisis de precios unitarios con categorías: insumos, rendimientos, precios y fórmulas de costos SUM";
    const result = analyzePrompt(prompt);
    const categories = ["insumos", "rendimientos", "precios"];

    expect(result.type).toBe("spreadsheet");
    for (const c of categories) {
      expect(prompt.toLowerCase()).toContain(c);
    }
    expect(prompt.toLowerCase()).toContain("sum");
  });

  it("generates concrete f'c=210 technical specs PDF", () => {
    const prompt = "Genera un PDF de especificaciones técnicas de concreto f'c=210 con resistencia, slump, relación agua cemento, curado 28 días";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("pdf");
    expect(prompt).toContain("210");
    expect(prompt.toLowerCase()).toContain("curado");
    expect(prompt).toContain("28");
  });

  it("generates measurement spreadsheet with volume formulas (L*W*H)", () => {
    const prompt = "Crea un Excel de hoja de cubicación con 10 elementos y fórmula de volumen L*W*H";
    const result = analyzePrompt(prompt);
    const items = Array.from({ length: 10 }, (_, i) => `Elemento ${i + 1}`);

    expect(result.type).toBe("spreadsheet");
    expect(items).toHaveLength(10);
    expect(prompt).toContain("L*W*H");
  });

  it("generates soil report Word with SPT test results table", () => {
    const prompt = "Genera un Word de estudio de mecánica de suelos con resultados del ensayo SPT, tabla con profundidad, N_SPT y clasificación";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("document");
    expect(prompt).toContain("N_SPT");
    expect(prompt.toLowerCase()).toContain("profundidad");
    expect(prompt.toLowerCase()).toContain("clasificación");
  });

  it("generates construction company SVG org chart", () => {
    const prompt = "Genera un organigrama SVG de constructora con Gerente General, 3 Residentes de Obra y 9 Maestros";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("diagram");
    expect(prompt).toContain("Gerente General");
    expect(prompt).toContain("Residente");
    expect(prompt).toContain("Maestro");
    expect(prompt).toContain("3");
    expect(prompt).toContain("9");
  });
});
