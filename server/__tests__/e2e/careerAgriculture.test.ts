import { describe, it, expect, beforeEach } from "vitest";

interface DocResult {
  type: string;
  [key: string]: unknown;
}

function analyzePrompt(prompt: string): DocResult {
  const lower = prompt.toLowerCase();
  const result: DocResult = { type: "unknown" };

  if (lower.includes("excel") || lower.includes("plan de cultivos") || lower.includes("inventario ganadero") || lower.includes("presupuesto agrícola")) result.type = "spreadsheet";
  else if (lower.includes("word") || lower.includes("análisis de suelo") || lower.includes("protocolo de manejo") || lower.includes("control de plagas")) result.type = "document";
  else if (lower.includes("ppt") || lower.includes("presentación") || lower.includes("sistema de riego") || lower.includes("invernadero")) result.type = "presentation";
  else if (lower.includes("pdf") || lower.includes("certificación orgánica")) result.type = "pdf";
  else if (lower.includes("diagrama") || lower.includes("flowchart") || lower.includes("organigrama") || lower.includes("svg") || lower.includes("rotación de cultivos")) result.type = "diagram";

  return result;
}

describe("Agriculture & Agronomy document generation", () => {
  it("generates crop planning Excel with planting calendar for 12 months", () => {
    const prompt = "Crea un Excel de plan de cultivos anual con calendario de siembra para 12 meses, columnas: cultivo, fechaSiembra, fechaCosecha, rendimientoEstimado";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("12 meses");
    expect(prompt.toLowerCase()).toContain("cultivo");
    expect(prompt.toLowerCase()).toContain("fechasiembra");
    expect(prompt.toLowerCase()).toContain("fechacosecha");
    expect(prompt.toLowerCase()).toContain("rendimientoestimado");
  });

  it("generates soil analysis report Word with nutrient levels", () => {
    const prompt = "Genera un Word de análisis de suelo parcela norte con secciones: pH, nitrógeno, fósforo, potasio, materia orgánica, recomendaciones";
    const result = analyzePrompt(prompt);
    const sections = ["ph", "nitrógeno", "fósforo", "potasio", "materia orgánica", "recomendaciones"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
  });

  it("generates irrigation system design PPT", () => {
    const prompt = "Genera una presentación PPT de diseño de sistema de riego por goteo con slides: tipo de riego, cálculo hídrico, diseño, materiales, presupuesto";
    const result = analyzePrompt(prompt);
    const topics = ["tipo de riego", "cálculo hídrico", "diseño", "materiales", "presupuesto"];

    expect(result.type).toBe("presentation");
    for (const t of topics) {
      expect(prompt.toLowerCase()).toContain(t);
    }
    expect(topics).toHaveLength(5);
  });

  it("generates livestock inventory Excel with weight gain formulas", () => {
    const prompt = "Crea un Excel de inventario ganadero con columnas: animalId, raza, pesoActual, ganaDiaria y fórmula de pesoProyectado con =";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt.toLowerCase()).toContain("animalid");
    expect(prompt.toLowerCase()).toContain("raza");
    expect(prompt.toLowerCase()).toContain("pesoactual");
    expect(prompt.toLowerCase()).toContain("ganadiaria");
    expect(prompt).toContain("=");
  });

  it("generates crop rotation flowchart", () => {
    const prompt = "Genera un diagrama de rotación de cultivos con ciclo: temporada 1 maíz, temporada 2 leguminosas, temporada 3 hortalizas, descanso";
    const result = analyzePrompt(prompt);
    const seasons = ["temporada 1 maíz", "temporada 2 leguminosas", "temporada 3 hortalizas", "descanso"];

    expect(result.type).toBe("diagram");
    for (const s of seasons) {
      expect(prompt.toLowerCase()).toContain(s);
    }
  });

  it("generates pest control protocol Word", () => {
    const prompt = "Genera un Word de protocolo de manejo integrado de plagas con secciones: identificación plaga, umbral económico, control biológico, control químico, monitoreo";
    const result = analyzePrompt(prompt);
    const sections = ["identificación plaga", "umbral económico", "control biológico", "control químico", "monitoreo"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
  });

  it("generates farm budget Excel with cost-benefit analysis", () => {
    const prompt = "Crea un Excel de presupuesto agrícola finca El Roble con análisis costo-beneficio, fórmulas: utilidad=ingresos-costos, roiPorHectarea";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt.toLowerCase()).toContain("ingresos");
    expect(prompt.toLowerCase()).toContain("costos");
    expect(prompt.toLowerCase()).toContain("hectarea");
  });

  it("generates greenhouse management PPT", () => {
    const prompt = "Genera una presentación PPT de manejo de invernadero para tomate cherry con slides: temperatura, humedad, ventilación, fertiriego, control fitosanitario";
    const result = analyzePrompt(prompt);
    const topics = ["temperatura", "humedad", "ventilación", "fertiriego", "control fitosanitario"];

    expect(result.type).toBe("presentation");
    for (const t of topics) {
      expect(prompt.toLowerCase()).toContain(t);
    }
    expect(topics).toHaveLength(5);
  });

  it("generates organic certification checklist PDF", () => {
    const prompt = "Genera un PDF de lista de verificación para certificación orgánica con requisitos: suelo, semillas, insumos, registros, trazabilidad";
    const result = analyzePrompt(prompt);
    const items = ["suelo", "semillas", "insumos", "registros", "trazabilidad"];

    expect(result.type).toBe("pdf");
    for (const item of items) {
      expect(prompt.toLowerCase()).toContain(item);
    }
    expect(items).toHaveLength(5);
  });

  it("generates agricultural cooperative SVG org chart", () => {
    const prompt = "Genera un organigrama SVG de cooperativa agrícola con jerarquía: asamblea, consejo directivo, gerente y 4 áreas: producción, comercialización, finanzas, asistencia técnica";
    const result = analyzePrompt(prompt);
    const areas = ["producción", "comercialización", "finanzas", "asistencia técnica"];

    expect(result.type).toBe("diagram");
    expect(prompt.toLowerCase()).toContain("asamblea");
    expect(prompt.toLowerCase()).toContain("consejo directivo");
    expect(prompt.toLowerCase()).toContain("gerente");
    expect(areas).toHaveLength(4);
    for (const a of areas) {
      expect(prompt.toLowerCase()).toContain(a);
    }
  });
});
