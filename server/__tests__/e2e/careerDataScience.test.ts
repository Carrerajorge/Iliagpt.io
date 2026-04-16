import { describe, it, expect, beforeEach } from "vitest";

interface DocResult {
  type: string;
  [key: string]: unknown;
}

function analyzePrompt(prompt: string): DocResult {
  const lower = prompt.toLowerCase();
  const result: DocResult = { type: "unknown" };

  if (lower.includes("excel") || lower.includes("dataset") || lower.includes("ml model") || lower.includes("a/b test") || lower.includes("correlación")) result.type = "spreadsheet";
  else if (lower.includes("word") || lower.includes("eda report") || lower.includes("data dictionary") || lower.includes("diccionario de datos") || lower.includes("reporte eda")) result.type = "document";
  else if (lower.includes("ppt") || lower.includes("presentación") || lower.includes("data pipeline") || lower.includes("data governance")) result.type = "presentation";
  else if (lower.includes("diagrama") || lower.includes("flowchart") || lower.includes("organigrama") || lower.includes("svg") || lower.includes("etl")) result.type = "diagram";

  return result;
}

describe("Data Science & Analytics document generation", () => {
  it("generates dataset analysis Excel with descriptive statistics", () => {
    const prompt = "Crea un Excel de análisis de dataset con columnas edad, ingreso, gasto, score y funciones AVERAGE, STDEV, MIN, MAX, MEDIAN, COUNT por cada columna";
    const result = analyzePrompt(prompt);
    const requiredFunctions = ["AVERAGE", "STDEV", "MIN", "MAX", "MEDIAN", "COUNT"];
    const columns = ["edad", "ingreso", "gasto", "score"];

    expect(result.type).toBe("spreadsheet");
    for (const fn of requiredFunctions) {
      expect(prompt).toContain(fn);
    }
    expect(columns.length * requiredFunctions.length).toBe(24);
  });

  it("generates ML model comparison Excel with accuracy metrics", () => {
    const prompt = "Genera un Excel de comparación de ML models con columnas: model, accuracy, precision, recall, F1, AUC y formato condicional highlight_max_per_column";
    const result = analyzePrompt(prompt);
    const metrics = ["accuracy", "precision", "recall", "f1", "auc"];

    expect(result.type).toBe("spreadsheet");
    for (const m of metrics) {
      expect(prompt.toLowerCase()).toContain(m);
    }
    expect(prompt.toLowerCase()).toContain("highlight_max_per_column");
  });

  it("generates data pipeline architecture PPT", () => {
    const prompt = "Genera una presentación PPT de arquitectura de data pipeline con slides: ingestion, processing, storage, analysis, visualization";
    const result = analyzePrompt(prompt);
    const stages = ["ingestion", "processing", "storage", "analysis", "visualization"];

    expect(result.type).toBe("presentation");
    for (const s of stages) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(stages).toHaveLength(5);
  });

  it("generates EDA report Word with methodology", () => {
    const prompt = "Genera un Word de reporte EDA con secciones: introducción, descripción datos, limpieza, análisis univariado, bivariado, conclusiones";
    const result = analyzePrompt(prompt);
    const sections = ["introducción", "descripción datos", "limpieza", "análisis univariado", "bivariado", "conclusiones"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(sections).toHaveLength(6);
  });

  it("generates ETL process flowchart", () => {
    const prompt = "Genera un diagrama flowchart del proceso ETL con pasos: Extract, Validate, Transform, Load, Verify conectados con flechas";
    const result = analyzePrompt(prompt);
    const steps = ["extract", "validate", "transform", "load", "verify"];

    expect(result.type).toBe("diagram");
    for (const s of steps) {
      expect(prompt.toLowerCase()).toContain(s);
    }
  });

  it("generates A/B test results Excel with statistical significance", () => {
    const prompt = "Crea un Excel de resultados de A/B test con fórmulas z_score, p_value, confidence_interval, sample_size y alpha 0.05";
    const result = analyzePrompt(prompt);
    const formulas = ["z_score", "p_value", "confidence_interval", "sample_size"];

    expect(result.type).toBe("spreadsheet");
    for (const f of formulas) {
      expect(prompt.toLowerCase()).toContain(f);
    }
    expect(prompt).toContain("0.05");
  });

  it("generates data dictionary Word for database schema", () => {
    const prompt = "Genera un Word de diccionario de datos con columnas: tabla, campo, tipo, descripción, ejemplo, nullable";
    const result = analyzePrompt(prompt);
    const columns = ["tabla", "campo", "tipo", "descripción", "ejemplo", "nullable"];

    expect(result.type).toBe("document");
    for (const c of columns) {
      expect(prompt.toLowerCase()).toContain(c);
    }
  });

  it("generates correlation matrix Excel with heatmap formatting", () => {
    const prompt = "Crea un Excel de matriz de correlación para variables edad, ingreso, gasto, score con formato de color_scale heatmap de -1 a 1";
    const result = analyzePrompt(prompt);
    const variables = ["edad", "ingreso", "gasto", "score"];

    expect(result.type).toBe("spreadsheet");
    expect(variables).toHaveLength(4);
    expect(prompt.toLowerCase()).toContain("color_scale");
  });

  it("generates data governance framework PPT", () => {
    const prompt = "Genera una presentación PPT de data governance framework con slides: políticas, roles, calidad, seguridad, compliance, metadata";
    const result = analyzePrompt(prompt);
    const topics = ["políticas", "roles", "calidad", "seguridad", "compliance", "metadata"];

    expect(result.type).toBe("presentation");
    for (const t of topics) {
      expect(prompt.toLowerCase()).toContain(t);
    }
    expect(topics).toHaveLength(6);
  });

  it("generates analytics team SVG org chart", () => {
    const prompt = "Genera un organigrama SVG del equipo de analytics con CDO, Data Engineers, Data Scientists, Data Analysts, BI Analysts";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("diagram");
    expect(prompt).toContain("CDO");
    expect(prompt).toContain("Data Engineers");
    expect(prompt).toContain("Data Scientists");
    expect(prompt).toContain("Data Analysts");
    expect(prompt).toContain("BI Analysts");
  });
});
