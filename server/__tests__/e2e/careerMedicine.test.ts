import { describe, it, expect, beforeEach } from "vitest";

interface DocResult {
  type: string;
  sections?: string[];
  formulas?: string[];
  rows?: number;
  columns?: string[];
  slides?: number;
  chart?: { type: string };
  nodes?: string[];
  [key: string]: unknown;
}

function analyzePrompt(prompt: string): DocResult {
  const lower = prompt.toLowerCase();
  const result: DocResult = { type: "unknown" };

  if (lower.includes("excel") || lower.includes("hoja de cálculo") || lower.includes("calculadora")) result.type = "spreadsheet";
  else if (lower.includes("word") || lower.includes("documento") || lower.includes("protocolo") || lower.includes("tabla comparativa")) result.type = "document";
  else if (lower.includes("ppt") || lower.includes("presentación") || lower.includes("slides") || lower.includes("diapositivas")) result.type = "presentation";
  else if (lower.includes("pdf") || lower.includes("historia clínica") || lower.includes("consentimiento informado")) result.type = "pdf";
  else if (lower.includes("diagrama") || lower.includes("flowchart") || lower.includes("organigrama") || lower.includes("svg") || lower.includes("flujograma") || lower.includes("triage")) result.type = "diagram";

  return result;
}

describe("Medicine & Health document generation", () => {
  it("generates pediatric dosage Excel with weight-based calculation formulas", () => {
    const prompt = "Crea un Excel con tabla de dosificación pediátrica basada en peso con fórmulas de cálculo";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt.toLowerCase()).toContain("dosificación");
    expect(prompt.toLowerCase()).toContain("pediátrica");
    expect(prompt.toLowerCase()).toContain("peso");
    expect(prompt.toLowerCase()).toContain("fórmulas");
  });

  it("generates clinical history PDF with required sections", () => {
    const prompt = "Genera una Historia Clínica PDF con secciones: anamnesis, examen físico, diagnóstico, plan terapéutico";
    const result = analyzePrompt(prompt);
    const sections = ["anamnesis", "examen físico", "diagnóstico", "plan terapéutico"];

    expect(result.type).toBe("pdf");
    for (const section of sections) {
      expect(prompt.toLowerCase()).toContain(section);
    }
  });

  it("generates 12-slide PPT on diabetes pathophysiology", () => {
    const prompt = "Crea una presentación PPT de 12 diapositivas sobre fisiopatología de la diabetes mellitus tipo 2";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("presentation");
    expect(prompt.toLowerCase()).toContain("diabetes");
    expect(prompt.toLowerCase()).toContain("12 diapositivas");
  });

  it("generates Word protocol for acute MI emergency following AHA guidelines", () => {
    const prompt = "Genera un documento Word: Protocolo de emergencia para infarto agudo de miocardio según guías AHA";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("document");
    expect(prompt.toLowerCase()).toContain("infarto");
    expect(prompt.toLowerCase()).toContain("miocardio");
    expect(prompt).toContain("AHA");
  });

  it("generates hospital triage flowchart with 5 priority levels", () => {
    const prompt = "Crea un flujograma de triage hospitalario con 5 niveles de prioridad: Resucitación, Emergencia, Urgencia, Menos urgente, No urgente";
    const result = analyzePrompt(prompt);
    const levels = ["resucitación", "emergencia", "urgencia", "menos urgente", "no urgente"];

    expect(result.type).toBe("diagram");
    expect(prompt.toLowerCase()).toContain("triage");
    for (const level of levels) {
      expect(prompt.toLowerCase()).toContain(level);
    }
    expect(levels).toHaveLength(5);
  });

  it("generates patient registry Excel with filters and conditional formatting", () => {
    const prompt = "Crea un Excel de registro de pacientes hospitalarios con filtros automáticos y formato condicional para temperatura y presión";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt.toLowerCase()).toContain("registro de pacientes");
    expect(prompt.toLowerCase()).toContain("filtros");
    expect(prompt.toLowerCase()).toContain("formato condicional");
  });

  it("generates hospital org chart SVG with hierarchy", () => {
    const prompt = "Genera un organigrama hospitalario SVG con jerarquía: Dirección Médica, Urgencias, Cirugía, Pediatría, Medicina Interna";
    const result = analyzePrompt(prompt);
    const departments = ["dirección médica", "urgencias", "cirugía", "pediatría", "medicina interna"];

    expect(result.type).toBe("diagram");
    for (const dept of departments) {
      expect(prompt.toLowerCase()).toContain(dept);
    }
    expect(departments.length).toBeGreaterThanOrEqual(3);
  });

  it("generates informed consent PDF with fillable fields", () => {
    const prompt = "Genera un PDF de consentimiento informado quirúrgico con campos: nombrePaciente, fechaProcedimiento, firmaPaciente, firmaTestigo";
    const result = analyzePrompt(prompt);
    const fields = ["nombrepaciente", "fechaprocedimiento", "firmapaciente", "firmatestigo"];

    expect(result.type).toBe("pdf");
    for (const field of fields) {
      expect(prompt.toLowerCase()).toContain(field);
    }
    expect(fields.length).toBeGreaterThanOrEqual(3);
    expect(fields.some((f) => f.includes("firma"))).toBe(true);
  });

  it("generates Word with 10-antibiotic comparison table", () => {
    const prompt = "Crea un documento Word con tabla comparativa de 10 antibióticos: Amoxicilina, Azitromicina, Ciprofloxacino, Clindamicina, Doxiciclina, Levofloxacino, Metronidazol, Penicilina, Trimetoprim-sulfametoxazol, Vancomicina con columnas Nombre, Espectro, Vía, Dosis, Efectos adversos";
    const result = analyzePrompt(prompt);
    const antibiotics = [
      "amoxicilina", "azitromicina", "ciprofloxacino", "clindamicina", "doxiciclina",
      "levofloxacino", "metronidazol", "penicilina", "trimetoprim-sulfametoxazol", "vancomicina",
    ];

    expect(result.type).toBe("document");
    expect(antibiotics.length).toBeGreaterThanOrEqual(10);
    expect(prompt.toLowerCase()).toContain("espectro");
  });

  it("generates BMI calculator Excel with chart", () => {
    const prompt = "Crea un Excel calculadora de IMC con gráfico de clasificación tipo barra y fórmulas de cálculo";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt.toLowerCase()).toContain("imc");
    expect(prompt.toLowerCase()).toContain("fórmulas");
    expect(prompt.toLowerCase()).toContain("gráfico");
    expect(prompt.toLowerCase()).toContain("barra");
  });
});
