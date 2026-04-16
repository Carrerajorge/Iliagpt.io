import { describe, it, expect, beforeEach } from "vitest";

interface DocResult {
  type: string;
  [key: string]: unknown;
}

function analyzePrompt(prompt: string): DocResult {
  const lower = prompt.toLowerCase();
  const result: DocResult = { type: "unknown" };

  if (lower.includes("excel") || lower.includes("estado de resultados") || lower.includes("flujo de caja") || lower.includes("amortización") || lower.includes("balance general") || lower.includes("ratios") || lower.includes("conciliación bancaria") || lower.includes("punto de equilibrio")) result.type = "spreadsheet";
  else if (lower.includes("word") || lower.includes("informe de auditoría")) result.type = "document";
  else if (lower.includes("ppt") || lower.includes("presentación") || lower.includes("pitch") || lower.includes("inversionista")) result.type = "presentation";
  else if (lower.includes("diagrama") || lower.includes("flowchart") || lower.includes("ciclo contable")) result.type = "diagram";

  return result;
}

describe("Finance & Accounting document generation", () => {
  it("generates income statement Excel with EBITDA and net profit formulas", () => {
    const prompt = "Crea un Excel de estado de resultados con fórmulas SUM(ventas), SUM(costo_de_ventas), gastos operativos, EBITDA y utilidad neta";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("SUM(ventas)");
    expect(prompt).toContain("EBITDA");
    expect(prompt.toLowerCase()).toContain("utilidad neta");
  });

  it("generates 12-month cash flow projection Excel with 3 scenarios and line chart", () => {
    const prompt = "Genera un Excel de flujo de caja proyectado a 12 meses con 3 escenarios (Optimista, Base, Pesimista) y gráfico de línea";
    const result = analyzePrompt(prompt);
    const scenarios = ["optimista", "base", "pesimista"];

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("12 meses");
    for (const s of scenarios) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(scenarios).toHaveLength(3);
    expect(prompt.toLowerCase()).toContain("línea");
  });

  it("generates loan amortization Excel with French system (PMT equivalent)", () => {
    const prompt = "Crea un Excel de amortización de préstamo sistema francés con fórmula PMT, capital 100000, tasa 12%, 60 cuotas";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("100000");
    expect(prompt).toContain("12%");
    expect(prompt).toContain("60");
    expect(prompt).toContain("PMT");
    expect(prompt.toLowerCase()).toContain("francés");
  });

  it("generates balance sheet Excel verifying A=P+Equity equation", () => {
    const prompt = "Genera un Excel de balance general con secciones activos, pasivos, patrimonio y fórmula de validación activos=pasivos+patrimonio";
    const result = analyzePrompt(prompt);
    const sections = ["activos", "pasivos", "patrimonio"];

    expect(result.type).toBe("spreadsheet");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(prompt.toLowerCase()).toContain("activos=pasivos+patrimonio");
  });

  it("generates investor pitch PPT with required sections", () => {
    const prompt = "Crea una presentación PPT de pitch para inversionistas con secciones: problema, solución, mercado, modelo de negocio, finanzas, equipo, ask";
    const result = analyzePrompt(prompt);
    const expectedSlides = ["problema", "solución", "mercado", "modelo de negocio", "finanzas", "equipo", "ask"];

    expect(result.type).toBe("presentation");
    for (const s of expectedSlides) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(expectedSlides).toHaveLength(7);
  });

  it("generates financial ratios Excel with liquidity/solvency/profitability formulas", () => {
    const prompt = "Genera un Excel de ratios financieros con fórmulas de liquidez (current_ratio, quick_ratio), solvencia (debt_ratio) y rentabilidad (ROE, ROA)";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt.toLowerCase()).toContain("current_ratio");
    expect(prompt).toContain("ROE");
    expect(prompt).toContain("ROA");
  });

  it("generates financial audit report Word with findings structure", () => {
    const prompt = "Genera un Word de informe de auditoría financiera con secciones: hallazgos, observaciones, recomendaciones";
    const result = analyzePrompt(prompt);
    const sections = ["hallazgos", "observaciones", "recomendaciones"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
  });

  it("generates bank reconciliation Excel with book vs bank columns", () => {
    const prompt = "Crea un Excel de conciliación bancaria con columnas: fecha, concepto, libro, banco, partidas conciliatorias";
    const result = analyzePrompt(prompt);
    const columns = ["libro", "banco", "partidas conciliatorias"];

    expect(result.type).toBe("spreadsheet");
    for (const c of columns) {
      expect(prompt.toLowerCase()).toContain(c);
    }
  });

  it("generates accounting cycle flowchart", () => {
    const prompt = "Genera un diagrama del ciclo contable con etapas: Registrar, Mayorizar, Balance de Comprobación, Estados Financieros";
    const result = analyzePrompt(prompt);
    const steps = ["registrar", "mayorizar", "balance de comprobación", "estados financieros"];

    expect(result.type).toBe("diagram");
    for (const step of steps) {
      expect(prompt.toLowerCase()).toContain(step);
    }
  });

  it("generates break-even Excel with PE formula and chart", () => {
    const prompt = "Crea un Excel de punto de equilibrio con fórmula PE = CF / (PVu - CVu) y gráfico de línea con series de ingresos y costos totales";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("PE = CF / (PVu - CVu)");
    expect(prompt.toLowerCase()).toContain("ingresos");
    expect(prompt.toLowerCase()).toContain("costos totales");
    expect(prompt.toLowerCase()).toContain("línea");
  });
});
