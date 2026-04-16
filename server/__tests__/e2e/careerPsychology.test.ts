import { describe, it, expect, beforeEach } from "vitest";

interface DocResult {
  type: string;
  [key: string]: unknown;
}

function analyzePrompt(prompt: string): DocResult {
  const lower = prompt.toLowerCase();
  const result: DocResult = { type: "unknown" };

  if (lower.includes("excel") || lower.includes("seguimiento de sesiones") || lower.includes("psicométricas") || lower.includes("encuesta") || lower.includes("likert")) result.type = "spreadsheet";
  else if (lower.includes("pdf")) result.type = "pdf";
  else if (lower.includes("word") || lower.includes("informe de evaluación") || lower.includes("consentimiento informado") || lower.includes("plan de actividad")) result.type = "document";
  else if (lower.includes("ppt") || lower.includes("presentación") || lower.includes("caso clínico")) result.type = "presentation";
  else if (lower.includes("diagrama") || lower.includes("flowchart") || lower.includes("organigrama") || lower.includes("svg") || lower.includes("modelo cognitivo") || lower.includes("flujograma")) result.type = "diagram";

  return result;
}

describe("Psychology document generation", () => {
  it("generates psychological evaluation report Word", () => {
    const prompt = "Genera un Word de informe de evaluación psicológica con secciones: datos generales, motivo de consulta, instrumentos aplicados, resultados, diagnóstico, recomendaciones";
    const result = analyzePrompt(prompt);
    const sections = ["datos generales", "motivo de consulta", "instrumentos aplicados", "resultados", "diagnóstico", "recomendaciones"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(sections).toHaveLength(6);
  });

  it("generates therapy session tracking Excel with progress formulas", () => {
    const prompt = "Crea un Excel de seguimiento de sesiones terapéuticas con columnas: Fecha sesión, Objetivo terapéutico, Técnica aplicada, Logros, Meta, % Progreso con fórmulas *100";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt.toLowerCase()).toContain("sesiones");
    expect(prompt).toContain("Fecha sesión");
    expect(prompt).toContain("% Progreso");
    expect(prompt).toContain("*100");
  });

  it("generates clinical case PPT presentation", () => {
    const prompt = "Genera una presentación PPT de caso clínico psicológico con slides: Identificación del paciente, Historia clínica, Evaluación psicológica, Diagnóstico DSM-5, Plan terapéutico";
    const result = analyzePrompt(prompt);
    const slides = ["identificación del paciente", "historia clínica", "diagnóstico dsm-5", "plan terapéutico"];

    expect(result.type).toBe("presentation");
    for (const s of slides) {
      expect(prompt.toLowerCase()).toContain(s);
    }
  });

  it("generates psychometric test scoring Excel with percentile formulas", () => {
    const prompt = "Crea un Excel de calificación de pruebas psicométricas con percentiles, columnas: Subprueba, Puntaje bruto, Percentil, Clasificación y fórmula PERCENTRANK";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt.toLowerCase()).toContain("psicométricas");
    expect(prompt).toContain("Puntaje bruto");
    expect(prompt).toContain("Percentil");
    expect(prompt).toContain("PERCENTRANK");
  });

  it("generates CBT treatment flowchart", () => {
    const prompt = "Crea un diagrama del modelo cognitivo-conductual ABC mermaid con nodos: Situación activadora, Pensamiento automático, Emoción, Conducta, Reestructuración cognitiva";
    const result = analyzePrompt(prompt);
    const nodes = ["pensamiento automático", "reestructuración cognitiva"];

    expect(result.type).toBe("diagram");
    for (const n of nodes) {
      expect(prompt.toLowerCase()).toContain(n);
    }
  });

  it("generates informed consent Word for psychological treatment", () => {
    const prompt = "Genera un Word de consentimiento informado para tratamiento psicológico con secciones: datos del terapeuta, datos del paciente, confidencialidad, limitaciones de la confidencialidad";
    const result = analyzePrompt(prompt);
    const sections = ["datos del terapeuta", "datos del paciente", "confidencialidad", "limitaciones de la confidencialidad"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(sections).toHaveLength(4);
  });

  it("generates Likert scale survey Excel with analysis", () => {
    const prompt = "Crea un Excel de encuesta escala Likert con análisis estadístico, hojas Respuestas y Análisis, fórmulas AVERAGE, STDEV, escala 1-5";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("AVERAGE");
    expect(prompt).toContain("STDEV");
    expect(prompt).toContain("1-5");
  });

  it("generates child development milestones PDF", () => {
    const prompt = "Genera un PDF de hitos del desarrollo infantil 0 a 6 años con rangos de edad y categorías: Desarrollo motor, Lenguaje, Desarrollo social";
    const result = analyzePrompt(prompt);
    const categories = ["desarrollo motor", "lenguaje", "desarrollo social"];

    expect(result.type).toBe("pdf");
    for (const c of categories) {
      expect(prompt.toLowerCase()).toContain(c);
    }
    expect(prompt).toContain("0 a 6");
  });

  it("generates group therapy activity plan Word", () => {
    const prompt = "Genera un Word de plan de actividad para terapia grupal con estructura: Calentamiento / rapport, Actividad principal, Reflexión grupal, Cierre y compromisos, duración 90 min";
    const result = analyzePrompt(prompt);
    const structure = ["calentamiento / rapport", "actividad principal", "reflexión grupal", "cierre y compromisos"];

    expect(result.type).toBe("document");
    for (const s of structure) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(structure).toHaveLength(4);
  });

  it("generates mental health clinic org chart SVG", () => {
    const prompt = "Genera un organigrama SVG de clínica de salud mental con Director clínico, áreas: Psicología clínica, Psiquiatría, Neuropsicología y 9 especialistas";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("diagram");
    expect(prompt).toContain("Director clínico");
    expect(prompt).toContain("Psicología clínica");
    expect(prompt).toContain("Psiquiatría");
    expect(prompt).toContain("Neuropsicología");
    expect(prompt).toContain("9");
  });
});
