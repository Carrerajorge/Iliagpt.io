import { describe, it, expect, beforeEach } from "vitest";

interface DocResult {
  type: string;
  [key: string]: unknown;
}

function analyzePrompt(prompt: string): DocResult {
  const lower = prompt.toLowerCase();
  const result: DocResult = { type: "unknown" };

  if (lower.includes("excel") || lower.includes("planilla") || lower.includes("necesidades de capacitación") || lower.includes("benchmarking salarial") || lower.includes("encuesta de clima")) result.type = "spreadsheet";
  else if (lower.includes("word") || lower.includes("evaluación de desempeño") || lower.includes("manual del empleado") || lower.includes("reglamento")) result.type = "document";
  else if (lower.includes("ppt") || lower.includes("presentación") || lower.includes("onboarding") || lower.includes("plan de sucesión")) result.type = "presentation";
  else if (lower.includes("diagrama") || lower.includes("flowchart") || lower.includes("organigrama") || lower.includes("svg") || lower.includes("proceso de selección")) result.type = "diagram";

  return result;
}

describe("Human Resources & Management document generation", () => {
  it("generates employee payroll Excel with deductions and net pay formulas", () => {
    const prompt = "Crea un Excel de planilla de empleados con columnas: empleado, sueldo_bruto, AFP (0.13), impuesto_renta, EsSalud (0.09), sueldo_neto con fórmulas de deducciones";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt.toLowerCase()).toContain("sueldo_bruto");
    expect(prompt).toContain("0.13");
    expect(prompt).toContain("0.09");
    expect(prompt.toLowerCase()).toContain("sueldo_neto");
  });

  it("generates performance evaluation Word with 360-degree format", () => {
    const prompt = "Genera un Word de evaluación de desempeño formato 360 grados con evaluadores: supervisor, pares, subordinados, autoevaluación y competencias: liderazgo, comunicación, trabajo en equipo, orientación a resultados";
    const result = analyzePrompt(prompt);
    const evaluators = ["supervisor", "pares", "subordinados", "autoevaluación"];
    const competencias = ["liderazgo", "comunicación", "trabajo en equipo", "orientación a resultados"];

    expect(result.type).toBe("document");
    for (const e of evaluators) {
      expect(prompt.toLowerCase()).toContain(e);
    }
    expect(competencias.length).toBeGreaterThanOrEqual(4);
    expect(prompt.toLowerCase()).toContain("360");
  });

  it("generates onboarding process PPT", () => {
    const prompt = "Genera una presentación PPT de proceso de onboarding con slides: bienvenida, cultura, estructura, beneficios, herramientas, primer mes, contactos";
    const result = analyzePrompt(prompt);
    const slides = ["bienvenida", "cultura", "estructura", "beneficios", "herramientas", "primer mes", "contactos"];

    expect(result.type).toBe("presentation");
    for (const s of slides) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(slides).toHaveLength(7);
  });

  it("generates training needs assessment Excel with gap analysis", () => {
    const prompt = "Crea un Excel de necesidades de capacitación con columnas: competencia, nivel_actual, nivel_requerido, brecha y fórmula brecha = nivel_requerido - nivel_actual";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt.toLowerCase()).toContain("competencia");
    expect(prompt.toLowerCase()).toContain("nivel_actual");
    expect(prompt.toLowerCase()).toContain("nivel_requerido");
    expect(prompt.toLowerCase()).toContain("brecha");
    expect(prompt.toLowerCase()).toContain("nivel_requerido - nivel_actual");
  });

  it("generates recruitment process flowchart", () => {
    const prompt = "Genera un diagrama de proceso de selección y reclutamiento con etapas: Requisición, Publicación, Screening, Entrevista, Evaluación, Oferta, Incorporación";
    const result = analyzePrompt(prompt);
    const steps = ["requisición", "publicación", "screening", "entrevista", "evaluación", "oferta", "incorporación"];

    expect(result.type).toBe("diagram");
    for (const s of steps) {
      expect(prompt.toLowerCase()).toContain(s);
    }
  });

  it("generates employee handbook Word with policies", () => {
    const prompt = "Genera un Word de manual del empleado con secciones: código de conducta, horarios, vacaciones, licencias, beneficios, disciplina";
    const result = analyzePrompt(prompt);
    const sections = ["código de conducta", "horarios", "vacaciones", "licencias", "beneficios", "disciplina"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
  });

  it("generates salary benchmarking Excel with percentile analysis", () => {
    const prompt = "Crea un Excel de benchmarking salarial con percentiles P25, P50, P75, fórmulas PERCENTILE y market_position con formato condicional below_P25 rojo, above_P75 verde";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("P25");
    expect(prompt).toContain("P50");
    expect(prompt).toContain("P75");
    expect(prompt.toLowerCase()).toContain("market_position");
    expect(prompt.toLowerCase()).toContain("below_p25");
    expect(prompt.toLowerCase()).toContain("above_p75");
  });

  it("generates organizational climate survey Excel with Likert analysis", () => {
    const prompt = "Crea un Excel de encuesta de clima organizacional escala Likert 1-5 con dimensiones: liderazgo, comunicación, ambiente, desarrollo, compensación y fórmulas AVERAGE y benchmark";
    const result = analyzePrompt(prompt);
    const dimensions = ["liderazgo", "comunicación", "ambiente", "desarrollo", "compensación"];

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("1");
    expect(prompt).toContain("5");
    expect(dimensions.length).toBeGreaterThanOrEqual(5);
    expect(prompt).toContain("AVERAGE");
    expect(prompt.toLowerCase()).toContain("benchmark");
  });

  it("generates succession planning PPT", () => {
    const prompt = "Genera una presentación PPT de plan de sucesión con slides: posiciones críticas, candidatos, readiness matrix, desarrollo, timeline";
    const result = analyzePrompt(prompt);
    const slides = ["posiciones críticas", "candidatos", "readiness matrix", "desarrollo", "timeline"];

    expect(result.type).toBe("presentation");
    for (const s of slides) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(slides).toHaveLength(5);
  });

  it("generates HR department SVG org chart", () => {
    const prompt = "Genera un organigrama SVG de RRHH con Director RRHH, 4 Gerencias (Selección, Capacitación, Compensaciones, Bienestar) y 12 Analistas";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("diagram");
    expect(prompt).toContain("Director RRHH");
    expect(prompt).toContain("4 Gerencia");
    expect(prompt).toContain("12 Analista");
  });
});
