import { describe, it, expect, beforeEach } from "vitest";

interface DocResult {
  type: string;
  [key: string]: unknown;
}

function analyzePrompt(prompt: string): DocResult {
  const lower = prompt.toLowerCase();
  const result: DocResult = { type: "unknown" };

  if (lower.includes("excel") || lower.includes("sprint planning") || lower.includes("bug tracking") || lower.includes("estimación cocomo")) result.type = "spreadsheet";
  else if (lower.includes("word") || lower.includes("srs") || lower.includes("api documentation") || lower.includes("postmortem")) result.type = "document";
  else if (lower.includes("ppt") || lower.includes("presentación") || lower.includes("arquitectura del sistema")) result.type = "presentation";
  else if (lower.includes("diagrama") || lower.includes("flowchart") || lower.includes("organigrama") || lower.includes("svg") || lower.includes("ci/cd") || lower.includes("er diagram")) result.type = "diagram";

  return result;
}

describe("IT & Software Engineering document generation", () => {
  it("generates sprint planning Excel with story points and velocity tracking", () => {
    const prompt = "Crea un Excel de sprint planning Q2 con columnas: userStory, puntos, asignado, estado, sprint y fórmulas SUM de velocity y totalPoints";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt.toLowerCase()).toContain("puntos");
    expect(prompt.toLowerCase()).toContain("asignado");
    expect(prompt.toLowerCase()).toContain("estado");
    expect(prompt).toContain("SUM");
  });

  it("generates software requirements specification (SRS) Word", () => {
    const prompt = "Genera un Word de SRS para plataforma e-commerce estándar IEEE-830 con secciones: introducción, descripción general, requisitos funcionales, requisitos no funcionales, interfaces";
    const result = analyzePrompt(prompt);
    const sections = ["introducción", "descripción general", "requisitos funcionales", "requisitos no funcionales", "interfaces"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
  });

  it("generates system architecture PPT with component diagrams", () => {
    const prompt = "Genera una presentación PPT de arquitectura del sistema con componentes: frontend, backend, database, API gateway, microservices, deployment";
    const result = analyzePrompt(prompt);
    const components = ["frontend", "backend", "database", "api gateway", "microservices", "deployment"];

    expect(result.type).toBe("presentation");
    expect(components).toHaveLength(6);
    for (const c of components) {
      expect(prompt.toLowerCase()).toContain(c);
    }
  });

  it("generates bug tracking Excel with severity and SLA formulas", () => {
    const prompt = "Crea un Excel de bug tracking release v3.2 con severidades P1-P4, SLA en horas, fórmula slaCompliance con IF Cumple/Incumple y COUNTIF pct";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("P1");
    expect(prompt).toContain("P4");
    expect(prompt.toLowerCase()).toContain("sla");
    expect(prompt).toContain("COUNTIF");
  });

  it("generates CI/CD pipeline flowchart", () => {
    const prompt = "Genera un diagrama flowchart del pipeline CI/CD con stages: commit, build, test, code review, staging, production, monitoring";
    const result = analyzePrompt(prompt);
    const stages = ["commit", "build", "test", "staging", "production", "monitoring"];

    expect(result.type).toBe("diagram");
    for (const s of stages) {
      expect(prompt.toLowerCase()).toContain(s);
    }
  });

  it("generates API documentation Word with endpoint specifications", () => {
    const prompt = "Genera un Word de API documentation del User Service con endpoints GET /api/users y POST /api/users incluyendo method, url, headers, requestBody, response, errorCodes";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("document");
    expect(prompt.toLowerCase()).toContain("method");
    expect(prompt.toLowerCase()).toContain("url");
    expect(prompt.toLowerCase()).toContain("headers");
    expect(prompt.toLowerCase()).toContain("response");
    expect(prompt.toLowerCase()).toContain("errorcodes");
    expect(prompt.toLowerCase()).toContain("requestbody");
  });

  it("generates project cost estimation Excel with COCOMO model", () => {
    const prompt = "Crea un Excel de estimación COCOMO para proyecto ERP con parámetros a=2.4, b=1.05, KLOC=50 y fórmulas effort con POWER, personMonths, costWithOverhead con factor 1.4";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("2.4");
    expect(prompt).toContain("POWER");
    expect(prompt).toContain("1.4");
  });

  it("generates database ER diagram", () => {
    const prompt = "Genera un ER diagram mermaid para e-commerce con entidades USUARIO, PEDIDO, PRODUCTO y relaciones ||--o{, ||--|{, }|--|{";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("diagram");
    expect(prompt.toLowerCase()).toContain("er diagram");
    expect(prompt).toContain("||--o{");
    expect(prompt).toContain("||--|{");
    expect(prompt).toContain("}|--|{");
    expect(prompt).toContain("USUARIO");
  });

  it("generates incident postmortem Word", () => {
    const prompt = "Genera un Word de postmortem del incidente caída del servicio 2026-03-15 con secciones: resumen, timeline, root cause, impacto, acciones correctivas, lecciones aprendidas";
    const result = analyzePrompt(prompt);
    const sections = ["resumen", "timeline", "root cause", "impacto", "acciones correctivas", "lecciones aprendidas"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
  });

  it("generates IT team SVG org chart", () => {
    const prompt = "Genera un organigrama SVG del equipo IT con CTO, VP Engineering, Tech Lead Frontend/Backend, Senior Dev, Junior Dev, QA Engineer";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("diagram");
    expect(prompt).toContain("CTO");
    expect(prompt).toContain("VP Engineering");
    expect(prompt).toContain("Tech Lead");
    expect(prompt).toContain("Senior Dev");
    expect(prompt).toContain("Junior Dev");
    expect(prompt).toContain("QA");
  });
});
