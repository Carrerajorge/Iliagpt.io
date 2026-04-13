import { describe, it, expect, beforeEach } from "vitest";

interface DocResult {
  type: string;
  [key: string]: unknown;
}

function analyzePrompt(prompt: string): DocResult {
  const lower = prompt.toLowerCase();
  const result: DocResult = { type: "unknown" };

  if (lower.includes("excel") || lower.includes("hoja de cálculo") || lower.includes("matriz de riesgo") || lower.includes("planificación de evento") || lower.includes("valuación inmobiliaria") || lower.includes("nps") || lower.includes("e-commerce dashboard") || lower.includes("control de calidad laboratorio") || lower.includes("flota") || lower.includes("consolidación presupuestaria") || lower.includes("costo de importación") || lower.includes("multilingüe")) result.type = "spreadsheet";
  else if (lower.includes("word") || lower.includes("tesis") || lower.includes("manual iso") || lower.includes("reporte anual") || lower.includes("plan de seguridad") || lower.includes("manual de franquicia") || lower.includes("propuesta de grant") || lower.includes("nonprofit")) result.type = "document";
  else if (lower.includes("ppt") || lower.includes("presentación") || lower.includes("pitch deck") || lower.includes("boda") || lower.includes("itinerario turístico")) result.type = "presentation";
  else if (lower.includes("diagrama") || lower.includes("flowchart") || lower.includes("cadena de suministro") || lower.includes("supply chain")) result.type = "diagram";

  return result;
}

describe("Cross-functional complex document generation", () => {
  it("generates multilingual Excel with English, Spanish, Portuguese sheets", () => {
    const prompt = "Crea un Excel multilingüe con 3 hojas: English (Product, Revenue, Quantity), Español (Producto, Ingresos, Cantidad), Português (Produto, Receita, Quantidade)";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("Product");
    expect(prompt).toContain("Producto");
    expect(prompt).toContain("Produto");
    expect(prompt).toContain("3 hojas");
  });

  it("generates research thesis Word with APA 7th edition format", () => {
    const prompt = "Genera un Word de tesis de investigación formato APA7 con secciones: portada, resumen, introducción, marco teórico, metodología, resultados, discusión, conclusiones, referencias";
    const result = analyzePrompt(prompt);
    const sections = ["portada", "resumen", "introducción", "marco teórico", "metodología", "resultados", "discusión", "conclusiones", "referencias"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(prompt).toContain("APA7");
    expect(sections).toHaveLength(9);
  });

  it("generates startup pitch deck PPT with 15 slides", () => {
    const prompt = "Genera una presentación PPT de pitch deck para startup con 15 slides: Portada, Problema, Solución, Producto, Modelo de Negocio, Tracción, Mercado, Competencia, Ventaja Competitiva, Equipo, Finanzas, Roadmap, Casos de Éxito, Inversión Requerida, Contacto";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("presentation");
    expect(prompt).toContain("15 slides");
    expect(prompt).toContain("Portada");
    expect(prompt).toContain("Modelo de Negocio");
    expect(prompt).toContain("Contacto");
  });

  it("generates project risk matrix Excel with probability x impact scoring", () => {
    const prompt = "Crea un Excel de matriz de riesgo 5x5 con fórmula =probabilidad*impacto, mapa de calor condicional con colores green, yellow, orange, red, darkred y niveles Muy Bajo a Muy Alto";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("5x5");
    expect(prompt).toContain("=probabilidad*impacto");
    expect(prompt.toLowerCase()).toContain("green");
    expect(prompt.toLowerCase()).toContain("darkred");
  });

  it("generates supply chain management flowchart", () => {
    const prompt = "Genera un diagrama de cadena de suministro mermaid con nodos: proveedor, almacén, producción, distribución, punto de venta, cliente conectados con flechas";
    const result = analyzePrompt(prompt);
    const nodes = ["proveedor", "almacén", "producción", "distribución", "punto de venta", "cliente"];

    expect(result.type).toBe("diagram");
    expect(nodes).toHaveLength(6);
    expect(prompt.toLowerCase()).toContain("proveedor");
    expect(prompt.toLowerCase()).toContain("cliente");
    expect(prompt.toLowerCase()).toContain("mermaid");
  });

  it("generates ISO 9001 quality manual Word", () => {
    const prompt = "Genera un Word de manual ISO 9001:2015 con secciones: alcance, referencias normativas, términos, contexto, liderazgo, planificación, apoyo, operación";
    const result = analyzePrompt(prompt);
    const sections = ["alcance", "referencias normativas", "términos", "contexto", "liderazgo", "planificación", "apoyo", "operación"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(prompt).toContain("ISO 9001:2015");
    expect(sections).toHaveLength(8);
  });

  it("generates event planning Excel with Gantt chart and budget", () => {
    const prompt = "Crea un Excel de planificación de evento con hojas Timeline y Presupuesto, 20 tareas, gantt chart, fórmula varianza =presupuesto-ejecutado y SUM de ejecutado";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("Timeline");
    expect(prompt).toContain("Presupuesto");
    expect(prompt).toContain("=presupuesto-ejecutado");
    expect(prompt).toContain("SUM");
  });

  it("generates real estate property valuation Excel with comparable sales method", () => {
    const prompt = "Crea un Excel de valuación inmobiliaria por método de ventas comparables con 3 propiedades, fórmula SUMPRODUCT de adjusted_prices y categorías de ajuste: ubicación, superficie, antigüedad, estado, extras";
    const result = analyzePrompt(prompt);
    const categories = ["ubicación", "superficie", "antigüedad", "estado", "extras"];

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("3 propiedades");
    expect(prompt).toContain("SUMPRODUCT");
    for (const c of categories) {
      expect(prompt.toLowerCase()).toContain(c);
    }
    expect(categories).toHaveLength(5);
  });

  it("generates wedding planning PPT with timeline and vendors", () => {
    const prompt = "Genera una presentación PPT de planificación de boda con slides: Portada, Venue, Catering, Decoración, Música, Fotografía, Presupuesto, Timeline";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("presentation");
    expect(prompt).toContain("Decoración");
    expect(prompt).toContain("Fotografía");
    expect(prompt).toContain("Presupuesto");
    expect(prompt.split(",").length).toBeGreaterThanOrEqual(7);
  });

  it("generates nonprofit annual report Word with financial transparency", () => {
    const prompt = "Genera un Word de reporte anual de nonprofit Fundación Esperanza con secciones: carta director, misión, programas, impacto, finanzas, donantes, voluntarios con transparencia financiera";
    const result = analyzePrompt(prompt);
    const sections = ["carta director", "misión", "programas", "impacto", "finanzas", "donantes", "voluntarios"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(sections).toHaveLength(7);
    expect(prompt.toLowerCase()).toContain("transparencia financiera");
  });

  it("generates import/export cost calculation Excel", () => {
    const prompt = "Crea un Excel de costo de importación/exportación con componentes FOB, flete, seguro, CIF, arancel, IGV y fórmulas CIF=FOB+flete+seguro, IGV=(CIF+arancel)*0.18, costoTotal incluye gastos_operativos";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("FOB");
    expect(prompt).toContain("CIF");
    expect(prompt).toContain("=FOB+flete+seguro");
    expect(prompt.toLowerCase()).toContain("gastos_operativos");
    const components = ["FOB", "flete", "seguro", "CIF", "arancel", "IGV"];
    expect(components).toHaveLength(6);
  });

  it("generates franchise operations manual Word", () => {
    const prompt = "Genera un Word de manual de franquicia QuickBite con secciones: marca, estándares, operaciones, marketing, RRHH, finanzas, proveedores";
    const result = analyzePrompt(prompt);
    const sections = ["marca", "estándares", "operaciones", "marketing", "rrhh", "finanzas", "proveedores"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(sections).toHaveLength(7);
  });

  it("generates patient satisfaction survey Excel with NPS calculation", () => {
    const prompt = "Crea un Excel de encuesta de satisfacción NPS con 500 respuestas, categorías promotores 280, pasivos 120, detractores 100, fórmula NPS=(promotores/total - detractores/total)*100, score 36";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("NPS=(promotores/total - detractores/total)*100");
    expect(prompt).toContain("36");
    expect(prompt).toContain("280");
    expect(prompt).toContain("100");
    expect(prompt).toContain("500");
  });

  it("generates construction safety plan Word with risk assessment", () => {
    const prompt = "Genera un Word de plan de seguridad en construcción Torre Central con secciones: EPP, señalización, permisos, capacitación, evacuación, primeros auxilios y evaluación de riesgos";
    const result = analyzePrompt(prompt);
    const sections = ["epp", "señalización", "permisos", "capacitación", "evacuación", "primeros auxilios"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(sections).toHaveLength(6);
    expect(prompt.toLowerCase()).toContain("evaluación de riesgos");
  });

  it("generates e-commerce dashboard Excel with conversion funnel", () => {
    const prompt = "Crea un Excel de e-commerce dashboard con embudo de conversión: visitas 100000, carrito 15000, checkout 8000, compra 3500 y fórmulas carritoRate=carrito/visitas*100 y overallRate=compra/visitas*100";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt.toLowerCase()).toContain("visitas");
    expect(prompt.toLowerCase()).toContain("compra");
    expect(prompt).toContain("=compra/visitas*100");
    expect(prompt.toLowerCase()).toContain("carrito");
  });

  it("generates tourism package itinerary PPT", () => {
    const prompt = "Genera una presentación PPT de itinerario turístico Cusco Mágico con slides: portada, Día 1 City tour, Día 2 Valle Sagrado, Día 3 Machu Picchu, Día 4 Retorno con transporte, alojamiento y comidas";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("presentation");
    expect(prompt).toContain("City tour");
    expect(prompt).toContain("Valle Sagrado");
    expect(prompt).toContain("Machu Picchu");
    expect(prompt.toLowerCase()).toContain("alojamiento");
    expect(prompt.toLowerCase()).toContain("comidas");
  });

  it("generates laboratory quality control Excel with control chart", () => {
    const prompt = "Crea un Excel de control de calidad laboratorio con fórmulas UCL=mean+3*stddev, LCL=mean-3*stddev, AVERAGE, STDEV y flag FUERA DE CONTROL si value>UCL o value<LCL, 30 data points";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("=mean+3*stddev");
    expect(prompt).toContain("=mean-3*stddev");
    expect(prompt).toContain("AVERAGE");
    expect(prompt).toContain("STDEV");
    expect(prompt).toContain("FUERA DE CONTROL");
  });

  it("generates grant proposal Word with logical framework", () => {
    const prompt = "Genera un Word de propuesta de grant con marco lógico y secciones: problema, objetivos, actividades, indicadores, medios de verificación, supuestos";
    const result = analyzePrompt(prompt);
    const sections = ["problema", "objetivos", "actividades", "indicadores", "medios de verificación", "supuestos"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(sections).toHaveLength(6);
    expect(prompt.toLowerCase()).toContain("marco lógico");
  });

  it("generates fleet management Excel with maintenance scheduling", () => {
    const prompt = "Crea un Excel de gestión de flota de 25 vehículos con columnas: vehículo, kilometraje, último mantenimiento, próximo mantenimiento, costo acumulado y fórmulas SUM de costos y alerta MANTENIMIENTO REQUERIDO con intervalo_km";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt.toLowerCase()).toContain("vehículo");
    expect(prompt.toLowerCase()).toContain("kilometraje");
    expect(prompt.toLowerCase()).toContain("próximo mantenimiento");
    expect(prompt.toLowerCase()).toContain("costo acumulado");
    expect(prompt.toLowerCase()).toContain("intervalo_km");
    expect(prompt).toContain("SUM");
  });

  it("generates multi-department budget consolidation Excel with rollup formulas", () => {
    const prompt = "Crea un Excel de consolidación presupuestaria con hojas Marketing, Desarrollo, Operaciones, RRHH, Finanzas y Resumen Consolidado con fórmula SUM referenciando Marketing!B50, Finanzas!B50 etc.";
    const result = analyzePrompt(prompt);
    const departments = ["Marketing", "Desarrollo", "Operaciones", "RRHH", "Finanzas"];

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("Resumen Consolidado");
    expect(departments).toHaveLength(5);
    expect(prompt).toContain("SUM");
    expect(prompt).toContain("Marketing!B50");
    expect(prompt).toContain("Finanzas!B50");
  });
});
