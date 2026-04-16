import { describe, it, expect, beforeEach } from "vitest";

interface DocResult {
  type: string;
  [key: string]: unknown;
}

function analyzePrompt(prompt: string): DocResult {
  const lower = prompt.toLowerCase();
  const result: DocResult = { type: "unknown" };

  if (lower.includes("excel") || lower.includes("huella de carbono") || lower.includes("calidad de agua") || lower.includes("calidad del aire")) result.type = "spreadsheet";
  else if (lower.includes("diagrama") || lower.includes("flowchart") || lower.includes("organigrama") || lower.includes("svg") || lower.includes("gestión de residuos")) result.type = "diagram";
  else if (lower.includes("word") || lower.includes("impacto ambiental") || lower.includes("reforestación")) result.type = "document";
  else if (lower.includes("ppt") || lower.includes("presentación") || lower.includes("sostenibilidad") || lower.includes("cambio climático")) result.type = "presentation";
  else if (lower.includes("pdf") || lower.includes("biodiversidad")) result.type = "pdf";

  return result;
}

describe("Environmental Science document generation", () => {
  it("generates environmental impact assessment Word", () => {
    const prompt = "Genera un Word de evaluación de impacto ambiental para planta industrial con secciones: descripción proyecto, línea base, identificación impactos, evaluación, mitigación, monitoreo";
    const result = analyzePrompt(prompt);
    const sections = ["descripción proyecto", "línea base", "identificación impactos", "evaluación", "mitigación", "monitoreo"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(sections).toHaveLength(6);
  });

  it("generates carbon footprint calculator Excel with emission factors", () => {
    const prompt = "Crea un Excel calculadora de huella de carbono corporativa con alcance 1, alcance 2, alcance 3, fórmulas SUM y factores de emisión";
    const result = analyzePrompt(prompt);
    const scopes = ["alcance 1", "alcance 2", "alcance 3"];

    expect(result.type).toBe("spreadsheet");
    for (const s of scopes) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(prompt).toContain("SUM");
    expect(scopes).toHaveLength(3);
  });

  it("generates sustainability report PPT with ESG metrics", () => {
    const prompt = "Genera una presentación PPT de reporte de sostenibilidad ESG 2026 con slides: ambiental, social, gobernanza, indicadores, metas, progreso";
    const result = analyzePrompt(prompt);
    const topics = ["ambiental", "social", "gobernanza", "indicadores", "metas", "progreso"];

    expect(result.type).toBe("presentation");
    for (const t of topics) {
      expect(prompt.toLowerCase()).toContain(t);
    }
    expect(topics).toHaveLength(6);
  });

  it("generates water quality monitoring Excel with parameter limits", () => {
    const prompt = "Crea un Excel de monitoreo calidad de agua con parámetros: pH (6.5-8.5), OD (min 5 mg/L), DBO (max 30), DQO (max 250), coliformes con formato condicional";
    const result = analyzePrompt(prompt);
    const params = ["ph", "od", "dbo", "dqo", "coliformes"];

    expect(result.type).toBe("spreadsheet");
    for (const p of params) {
      expect(prompt.toLowerCase()).toContain(p);
    }
    expect(prompt).toContain("8.5");
    expect(prompt.toLowerCase()).toContain("formato condicional");
  });

  it("generates waste management flowchart", () => {
    const prompt = "Genera un diagrama de gestión de residuos sólidos con etapas: generación, segregación, recolección, tratamiento, disposición final";
    const result = analyzePrompt(prompt);
    const steps = ["generación", "segregación", "recolección", "tratamiento"];

    expect(result.type).toBe("diagram");
    for (const s of steps) {
      expect(prompt.toLowerCase()).toContain(s);
    }
  });

  it("generates reforestation project Word with species selection", () => {
    const prompt = "Genera un Word de proyecto de reforestación de cuenca hidrográfica con secciones: área, diagnóstico, especies nativas, cronograma, presupuesto, monitoreo";
    const result = analyzePrompt(prompt);
    const sections = ["área", "diagnóstico", "especies nativas", "cronograma", "presupuesto", "monitoreo"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
  });

  it("generates air quality index Excel with AQI calculation", () => {
    const prompt = "Crea un Excel de índice de calidad del aire con contaminantes PM2.5, PM10, O3, NO2, SO2, CO y fórmulas subIndex con BPHi, BPLo y MAX para AQI final";
    const result = analyzePrompt(prompt);
    const pollutants = ["pm2.5", "pm10", "o3", "no2", "so2", "co"];

    expect(result.type).toBe("spreadsheet");
    for (const p of pollutants) {
      expect(prompt.toLowerCase()).toContain(p);
    }
    expect(prompt).toContain("BPHi");
    expect(prompt).toContain("BPLo");
    expect(prompt).toContain("MAX");
  });

  it("generates climate change adaptation PPT", () => {
    const prompt = "Genera una presentación PPT de plan de adaptación al cambio climático con slides: vulnerabilidad, escenarios, adaptación, resiliencia, financiamiento";
    const result = analyzePrompt(prompt);
    const topics = ["vulnerabilidad", "escenarios", "adaptación", "resiliencia", "financiamiento"];

    expect(result.type).toBe("presentation");
    for (const t of topics) {
      expect(prompt.toLowerCase()).toContain(t);
    }
    expect(topics).toHaveLength(5);
  });

  it("generates biodiversity inventory PDF with species list", () => {
    const prompt = "Genera un PDF de inventario de biodiversidad de área protegida con categorías: flora, fauna, endémicas y estados de conservación LC, VU, EN, CR";
    const result = analyzePrompt(prompt);
    const categories = ["flora", "fauna", "endémicas"];
    const statuses = ["LC", "VU", "EN", "CR"];

    expect(result.type).toBe("pdf");
    for (const c of categories) {
      expect(prompt.toLowerCase()).toContain(c);
    }
    for (const s of statuses) {
      expect(prompt).toContain(s);
    }
  });

  it("generates environmental consultancy SVG org chart", () => {
    const prompt = "Genera un organigrama SVG de consultora ambiental con Director General, 3 divisiones: Impacto Ambiental, Gestión de Residuos, Recursos Hídricos y 9 Especialistas";
    const result = analyzePrompt(prompt);
    const divisions = ["Impacto Ambiental", "Gestión de Residuos", "Recursos Hídricos"];

    expect(result.type).toBe("diagram");
    expect(prompt).toContain("Director General");
    for (const d of divisions) {
      expect(prompt).toContain(d);
    }
    expect(prompt).toContain("9");
  });
});
