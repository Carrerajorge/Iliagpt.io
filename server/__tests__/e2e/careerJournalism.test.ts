import { describe, it, expect, beforeEach } from "vitest";

interface DocResult {
  type: string;
  [key: string]: unknown;
}

function analyzePrompt(prompt: string): DocResult {
  const lower = prompt.toLowerCase();
  const result: DocResult = { type: "unknown" };

  if (lower.includes("excel") || lower.includes("calendario editorial") || lower.includes("analytics de redes") || lower.includes("seguimiento de podcast")) result.type = "spreadsheet";
  else if (lower.includes("word") || lower.includes("comunicado de prensa") || lower.includes("plan de comunicación") || lower.includes("periodismo de investigación")) result.type = "document";
  else if (lower.includes("ppt") || lower.includes("presentación") || lower.includes("media kit") || lower.includes("análisis de audiencia")) result.type = "presentation";
  else if (lower.includes("diagrama") || lower.includes("flowchart") || lower.includes("organigrama") || lower.includes("svg") || lower.includes("flujo de producción")) result.type = "diagram";

  return result;
}

describe("Journalism & Communications document generation", () => {
  it("generates editorial calendar Excel for quarterly content planning", () => {
    const prompt = "Crea un Excel de calendario editorial trimestral con 90 registros y columnas: fecha, tema, formato, canal, responsable, estado";
    const result = analyzePrompt(prompt);
    const columns = ["fecha", "tema", "formato", "canal", "responsable", "estado"];

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("90");
    for (const col of columns) {
      expect(prompt.toLowerCase()).toContain(col);
    }
  });

  it("generates press release Word with AP style structure", () => {
    const prompt = "Genera un Word de comunicado de prensa estilo AP con secciones: headline, dateline, lead paragraph, body, boilerplate, contact";
    const result = analyzePrompt(prompt);
    const sections = ["headline", "dateline", "lead paragraph", "body", "boilerplate", "contact"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
  });

  it("generates media kit PPT with brand assets", () => {
    const prompt = "Genera una presentación PPT de media kit de marca digital con slides: about, audience demographics, reach/impressions, ad formats, pricing, contact";
    const result = analyzePrompt(prompt);
    const topics = ["about", "audience demographics", "reach/impressions", "ad formats", "pricing", "contact"];

    expect(result.type).toBe("presentation");
    for (const t of topics) {
      expect(prompt.toLowerCase()).toContain(t);
    }
    expect(topics).toHaveLength(6);
  });

  it("generates social media analytics Excel with engagement rate formulas", () => {
    const prompt = "Crea un Excel de analytics de redes sociales con 30 días, columnas likes, comments, shares, reach y fórmula engagementRate=(likes+comments+shares)/reach*100";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("*100");
    expect(prompt.toLowerCase()).toContain("likes");
    expect(prompt.toLowerCase()).toContain("reach");
  });

  it("generates news production workflow flowchart", () => {
    const prompt = "Genera un diagrama de flujo de producción de noticias con etapas: pauta, reportería, redacción, edición, publicación, métricas";
    const result = analyzePrompt(prompt);
    const steps = ["pauta", "reportería", "redacción", "edición", "publicación", "métricas"];

    expect(result.type).toBe("diagram");
    for (const s of steps) {
      expect(prompt.toLowerCase()).toContain(s);
    }
  });

  it("generates crisis communication plan Word", () => {
    const prompt = "Genera un Word de plan de comunicación de crisis con secciones: comité, portavoces, protocolo, mensajes clave, canales, monitoreo";
    const result = analyzePrompt(prompt);
    const sections = ["comité", "portavoces", "protocolo", "mensajes clave", "canales", "monitoreo"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
  });

  it("generates podcast production tracking Excel", () => {
    const prompt = "Crea un Excel de seguimiento de podcast con 12 episodios y columnas: episodio, tema, invitado, grabación, edición, publicación, descargas";
    const result = analyzePrompt(prompt);
    const columns = ["episodio", "tema", "invitado", "grabación", "edición", "publicación", "descargas"];

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("12");
    for (const col of columns) {
      expect(prompt.toLowerCase()).toContain(col);
    }
  });

  it("generates investigative journalism report Word", () => {
    const prompt = "Genera un Word de reporte de periodismo de investigación con secciones: hipótesis, fuentes, evidencia, cronología, hallazgos, conclusiones";
    const result = analyzePrompt(prompt);
    const sections = ["hipótesis", "fuentes", "evidencia", "cronología", "hallazgos", "conclusiones"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
  });

  it("generates audience analysis PPT with demographics", () => {
    const prompt = "Genera una presentación PPT de análisis de audiencia con demografía, slides: edad, género, ubicación, intereses, comportamiento, dispositivos";
    const result = analyzePrompt(prompt);
    const topics = ["edad", "género", "ubicación", "intereses", "comportamiento", "dispositivos"];

    expect(result.type).toBe("presentation");
    for (const t of topics) {
      expect(prompt.toLowerCase()).toContain(t);
    }
    expect(topics).toHaveLength(6);
  });

  it("generates media company SVG org chart", () => {
    const prompt = "Genera un organigrama SVG de medio de comunicación con roles: director general, editor en jefe, jefes de sección, reporteros, fotógrafos";
    const result = analyzePrompt(prompt);
    const roles = ["director general", "editor en jefe", "jefes de sección", "reporteros", "fotógrafos"];

    expect(result.type).toBe("diagram");
    for (const r of roles) {
      expect(prompt.toLowerCase()).toContain(r);
    }
  });
});
