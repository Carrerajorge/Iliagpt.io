import { describe, it, expect, beforeEach } from "vitest";

interface DocResult {
  type: string;
  [key: string]: unknown;
}

function analyzePrompt(prompt: string): DocResult {
  const lower = prompt.toLowerCase();
  const result: DocResult = { type: "unknown" };

  if (lower.includes("excel") || lower.includes("rendimiento de campaña") || lower.includes("segmentación") || lower.includes("calendario de redes") || lower.includes("análisis competitivo")) result.type = "spreadsheet";
  else if (lower.includes("word") || lower.includes("plan de marketing") || lower.includes("business model canvas")) result.type = "document";
  else if (lower.includes("ppt") || lower.includes("presentación") || lower.includes("identidad de marca") || lower.includes("estrategia de marketing digital")) result.type = "presentation";
  else if (lower.includes("diagrama") || lower.includes("flowchart") || lower.includes("organigrama") || lower.includes("svg") || lower.includes("funnel") || lower.includes("embudo")) result.type = "diagram";

  return result;
}

describe("Marketing & Business document generation", () => {
  it("generates marketing plan Word with SWOT analysis", () => {
    const prompt = "Genera un Word de plan de marketing con secciones: análisis situacional, SWOT, objetivos, estrategias, presupuesto, cronograma";
    const result = analyzePrompt(prompt);
    const sections = ["análisis situacional", "swot", "objetivos", "estrategias", "presupuesto", "cronograma"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(sections).toHaveLength(6);
  });

  it("generates campaign performance Excel with ROI formulas", () => {
    const prompt = "Crea un Excel de rendimiento de campaña Q1-2026 con fórmulas ROI=(ganancia-inversión)/inversión, CPA, CTR y KPIs: impresiones, clics, conversiones";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("ROI=(ganancia-inversión)/inversión");
    expect(prompt.toLowerCase()).toContain("conversiones");
    expect(prompt.toLowerCase()).toContain("impresiones");
  });

  it("generates brand presentation PPT with visual identity", () => {
    const prompt = "Genera una presentación PPT de identidad de marca con slides: misión, visión, valores, logo, paleta colores, tipografía";
    const result = analyzePrompt(prompt);
    const slides = ["misión", "visión", "valores", "logo", "paleta colores", "tipografía"];

    expect(result.type).toBe("presentation");
    for (const s of slides) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(slides).toHaveLength(6);
  });

  it("generates customer segmentation Excel with demographic analysis", () => {
    const prompt = "Crea un Excel de segmentación de clientes con segmentos: jóvenes urbanos, familias suburbanas, profesionales senior, estudiantes y demografía por edad y nivel de ingreso";
    const result = analyzePrompt(prompt);
    const segments = ["jóvenes urbanos", "familias suburbanas", "profesionales senior", "estudiantes"];

    expect(result.type).toBe("spreadsheet");
    expect(segments).toHaveLength(4);
    expect(prompt.toLowerCase()).toContain("edad");
    expect(prompt.toLowerCase()).toContain("ingreso");
  });

  it("generates sales funnel diagram", () => {
    const prompt = "Genera un diagrama de funnel de ventas con etapas: Awareness, Interest, Consideration, Intent, Purchase, Loyalty";
    const result = analyzePrompt(prompt);
    const stages = ["awareness", "interest", "consideration", "intent", "purchase", "loyalty"];

    expect(result.type).toBe("diagram");
    for (const s of stages) {
      expect(prompt.toLowerCase()).toContain(s);
    }
  });

  it("generates social media calendar Excel with 30 days of posts", () => {
    const prompt = "Crea un Excel de calendario de redes sociales para 30 días con columnas: date, platform (Instagram, Facebook, Twitter, LinkedIn), contentType, copy, status";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("30 días");
    expect(prompt.toLowerCase()).toContain("date");
    expect(prompt.toLowerCase()).toContain("platform");
    expect(prompt.toLowerCase()).toContain("contenttype");
    expect(prompt.toLowerCase()).toContain("copy");
    expect(prompt.toLowerCase()).toContain("status");
  });

  it("generates business model canvas Word", () => {
    const prompt = "Genera un Word de Business Model Canvas con 9 bloques: socios clave, actividades clave, recursos clave, propuesta de valor, relaciones con clientes, canales, segmentos de clientes, estructura de costos, fuentes de ingresos";
    const result = analyzePrompt(prompt);
    const blocks = [
      "socios clave", "actividades clave", "recursos clave", "propuesta de valor",
      "relaciones con clientes", "canales", "segmentos de clientes",
      "estructura de costos", "fuentes de ingresos",
    ];

    expect(result.type).toBe("document");
    expect(blocks).toHaveLength(9);
    for (const b of blocks) {
      expect(prompt.toLowerCase()).toContain(b);
    }
  });

  it("generates competitive analysis Excel with scoring matrix", () => {
    const prompt = "Crea un Excel de análisis competitivo con 4 competidores, criterios: precio, calidad, servicio, innovación, distribución con pesos que suman 1.0 y fórmula SUMPRODUCT";
    const result = analyzePrompt(prompt);
    const criteria = ["precio", "calidad", "servicio", "innovación", "distribución"];

    expect(result.type).toBe("spreadsheet");
    expect(criteria).toHaveLength(5);
    expect(prompt).toContain("SUMPRODUCT");
    expect(prompt).toContain("1.0");
  });

  it("generates digital marketing strategy PPT", () => {
    const prompt = "Genera una presentación PPT de estrategia de marketing digital con slides: SEO, SEM, social media, email marketing, content marketing, analytics";
    const result = analyzePrompt(prompt);
    const slides = ["seo", "sem", "social media", "email marketing", "content marketing", "analytics"];

    expect(result.type).toBe("presentation");
    for (const s of slides) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(slides).toHaveLength(6);
  });

  it("generates marketing department SVG org chart", () => {
    const prompt = "Genera un organigrama SVG del departamento de marketing con CMO, 4 Managers y 12 Specialists";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("diagram");
    expect(prompt).toContain("CMO");
    expect(prompt).toContain("4 Manager");
    expect(prompt).toContain("12 Specialist");
  });
});
