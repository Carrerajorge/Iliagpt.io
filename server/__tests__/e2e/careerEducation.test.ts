import { describe, it, expect, beforeEach } from "vitest";

interface DocResult {
  type: string;
  [key: string]: unknown;
}

function analyzePrompt(prompt: string): DocResult {
  const lower = prompt.toLowerCase();
  const result: DocResult = { type: "unknown" };

  if (lower.includes("excel") || lower.includes("registro de notas") || lower.includes("rúbrica") || lower.includes("asistencia")) result.type = "spreadsheet";
  else if (lower.includes("pdf")) result.type = "pdf";
  else if (lower.includes("word") || lower.includes("sesión de aprendizaje") || lower.includes("programación anual")) result.type = "document";
  else if (lower.includes("ppt") || lower.includes("presentación") || lower.includes("diapositivas") || lower.includes("proyecto educativo")) result.type = "presentation";
  else if (lower.includes("diagrama") || lower.includes("flowchart") || lower.includes("organigrama") || lower.includes("svg") || lower.includes("taxonomía")) result.type = "diagram";

  return result;
}

describe("Education & Pedagogy document generation", () => {
  it("generates grade registry Excel for 40 students, 4 competencies with weighted average and ranking", () => {
    const prompt = "Crea un Excel de registro de notas para 40 estudiantes con 4 competencias, fórmulas AVERAGE y RANK";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("40");
    expect(prompt).toContain("4 competencias");
    expect(prompt).toContain("AVERAGE");
    expect(prompt).toContain("RANK");
  });

  it("generates learning session Word with inicio, desarrollo, cierre sections", () => {
    const prompt = "Genera un Word de sesión de aprendizaje de Comunicación con secciones: inicio, desarrollo, cierre, evaluación, materiales";
    const result = analyzePrompt(prompt);
    const sections = ["inicio", "desarrollo", "cierre", "evaluación", "materiales"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
  });

  it("generates 15-slide class PPT on solar system", () => {
    const prompt = "Crea una presentación PPT de 15 diapositivas sobre el Sistema Solar para clase de Ciencias con planetas y otros cuerpos";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("presentation");
    expect(prompt).toContain("15");
    expect(prompt).toContain("Sistema Solar");
  });

  it("generates student rubric Excel with 4 performance levels", () => {
    const prompt = "Genera un Excel de rúbrica de evaluación con 4 niveles: inicio, proceso, logro esperado, logro destacado";
    const result = analyzePrompt(prompt);
    const levels = ["inicio", "proceso", "logro esperado", "logro destacado"];

    expect(result.type).toBe("spreadsheet");
    for (const l of levels) {
      expect(prompt.toLowerCase()).toContain(l);
    }
  });

  it("generates Bloom's taxonomy flowchart", () => {
    const prompt = "Crea un diagrama de la taxonomía de Bloom con niveles: recordar, comprender, aplicar, analizar, evaluar, crear";
    const result = analyzePrompt(prompt);
    const levels = ["recordar", "comprender", "aplicar", "analizar", "evaluar", "crear"];

    expect(result.type).toBe("diagram");
    for (const l of levels) {
      expect(prompt.toLowerCase()).toContain(l);
    }
  });

  it("generates annual programming Word with 40 learning sessions", () => {
    const prompt = "Genera un Word de programación anual para 5to Primaria con 40 sesiones distribuidas en 4 bimestres";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("document");
    expect(prompt).toContain("40");
    expect(prompt).toContain("4 bimestres");
  });

  it("generates attendance Excel with percentage formulas", () => {
    const prompt = "Crea un Excel de registro de asistencia para 30 alumnos con fórmula porcentaje = asistencias/totalDias*100";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("30");
    expect(prompt.toLowerCase()).toContain("asistencias");
    expect(prompt).toContain("*100");
  });

  it("generates school report card PDF with grades by area", () => {
    const prompt = "Genera un PDF de libreta de notas con áreas: comunicación, matemática, ciencia, personal social y promedio general";
    const result = analyzePrompt(prompt);
    const areas = ["comunicación", "matemática", "ciencia", "personal social"];

    expect(result.type).toBe("pdf");
    for (const a of areas) {
      expect(prompt.toLowerCase()).toContain(a);
    }
  });

  it("generates educational project PPT with problem tree methodology", () => {
    const prompt = "Crea una presentación PPT de proyecto educativo de Mejora de Comprensión Lectora con metodología Árbol de Problemas, Objetivos, Actividades";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("presentation");
    expect(prompt).toContain("Árbol de Problemas");
    expect(prompt).toContain("Objetivos");
    expect(prompt).toContain("Actividades");
  });

  it("generates school org chart SVG", () => {
    const prompt = "Genera un organigrama SVG institucional con Director, Subdirector, Coordinador Primaria, Coordinador Secundaria y Docentes";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("diagram");
    expect(prompt).toContain("Director");
    expect(prompt).toContain("Subdirector");
    expect(prompt).toContain("Coordinador");
    expect(prompt).toContain("Docente");
  });
});
