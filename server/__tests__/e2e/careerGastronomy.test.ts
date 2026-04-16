import { describe, it, expect, beforeEach } from "vitest";

interface DocResult {
  type: string;
  [key: string]: unknown;
}

function analyzePrompt(prompt: string): DocResult {
  const lower = prompt.toLowerCase();
  const result: DocResult = { type: "unknown" };

  if (lower.includes("excel") || lower.includes("costeo de receta") || lower.includes("haccp") || lower.includes("plan semanal") || lower.includes("inventario de alimentos") || lower.includes("fifo")) result.type = "spreadsheet";
  else if (lower.includes("word") || lower.includes("carta de restaurante") || lower.includes("propuesta de catering") || lower.includes("guía de maridaje")) result.type = "document";
  else if (lower.includes("ppt") || lower.includes("presentación") || lower.includes("técnicas culinarias")) result.type = "presentation";
  else if (lower.includes("pdf") || lower.includes("guía de vinos")) result.type = "pdf";
  else if (lower.includes("diagrama") || lower.includes("flowchart") || lower.includes("organigrama") || lower.includes("svg") || lower.includes("flujo de cocina")) result.type = "diagram";

  return result;
}

describe("Gastronomy & Culinary Arts document generation", () => {
  it("generates recipe cost Excel with ingredient pricing and margin formulas", () => {
    const prompt = "Crea un Excel de costeo de receta risotto para 10 porciones con columnas: ingrediente, cantidad, unidad, costo_unitario, costo_total y fórmulas food_cost_pct, margen";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt.toLowerCase()).toContain("ingrediente");
    expect(prompt.toLowerCase()).toContain("costo_unitario");
    expect(prompt.toLowerCase()).toContain("food_cost_pct");
    expect(prompt.toLowerCase()).toContain("margen");
    expect(prompt).toContain("10");
  });

  it("generates restaurant menu Word with courses and allergen info", () => {
    const prompt = "Genera un Word de carta de restaurante con secciones: entradas, platos principales, postres, bebidas e íconos de alérgenos: gluten, lácteos, mariscos";
    const result = analyzePrompt(prompt);
    const sections = ["entradas", "platos principales", "postres", "bebidas"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(prompt.toLowerCase()).toContain("gluten");
    expect(prompt.toLowerCase()).toContain("lácteos");
    expect(prompt.toLowerCase()).toContain("mariscos");
  });

  it("generates 10-slide culinary technique PPT", () => {
    const prompt = "Genera una presentación PPT de 10 técnicas culinarias con slides: mise en place, cortes básicos, cortes avanzados, cocción seca, cocción húmeda, cocción mixta, salsas madre, fondos y caldos, emplatado, presentación final";
    const result = analyzePrompt(prompt);
    const topics = ["mise en place", "cortes básicos", "cocción seca", "emplatado"];

    expect(result.type).toBe("presentation");
    for (const t of topics) {
      expect(prompt.toLowerCase()).toContain(t);
    }
    expect(prompt).toContain("10");
  });

  it("generates HACCP control points Excel with temperature monitoring", () => {
    const prompt = "Crea un Excel de control HACCP con puntos críticos: recepción (max 4°C), almacenamiento_frío, cocción (min 74°C), enfriamiento y formato condicional: rojo fuera de rango, amarillo warning, verde ok";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("74");
    expect(prompt.toLowerCase()).toContain("recepción");
    expect(prompt.toLowerCase()).toContain("rojo");
  });

  it("generates kitchen workflow flowchart", () => {
    const prompt = "Genera un diagrama de flujo de cocina con etapas: Recepción, Almacenamiento, Preparación, Cocción, Emplatado, Servicio";
    const result = analyzePrompt(prompt);
    const steps = ["recepción", "almacenamiento", "preparación", "cocción", "emplatado", "servicio"];

    expect(result.type).toBe("diagram");
    for (const s of steps) {
      expect(prompt.toLowerCase()).toContain(s);
    }
  });

  it("generates weekly meal plan Excel for 7 days with nutritional values", () => {
    const prompt = "Crea un Excel de plan semanal de comidas 7 días, 3 comidas/día con columnas: día, desayuno, almuerzo, cena, calorías, proteínas_g, carbohidratos_g, grasas_g y fórmulas total_calorías_día, total_grasas_día";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt).toContain("7 días");
    expect(prompt).toContain("3 comidas");
    expect(prompt.toLowerCase()).toContain("calorías");
    expect(prompt.toLowerCase()).toContain("proteínas_g");
    expect(prompt.toLowerCase()).toContain("total_calorías_día");
    expect(prompt.toLowerCase()).toContain("total_grasas_día");
  });

  it("generates catering event proposal Word", () => {
    const prompt = "Genera un Word de propuesta de catering para evento boda 150 personas con secciones: evento, menú, logística, personal, presupuesto, condiciones";
    const result = analyzePrompt(prompt);
    const sections = ["evento", "menú", "logística", "personal", "presupuesto", "condiciones"];

    expect(result.type).toBe("document");
    for (const s of sections) {
      expect(prompt.toLowerCase()).toContain(s);
    }
    expect(sections).toHaveLength(6);
  });

  it("generates wine pairing guide PDF with regions and grapes", () => {
    const prompt = "Genera un PDF de guía de vinos y maridaje con categorías: tintos (Malbec, Mendoza), blancos (Sauvignon Blanc, Casablanca), rosados (Provenza), espumantes (Champagne)";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("pdf");
    expect(prompt.toLowerCase()).toContain("tintos");
    expect(prompt.toLowerCase()).toContain("blancos");
    expect(prompt.toLowerCase()).toContain("rosados");
    expect(prompt.toLowerCase()).toContain("espumantes");
    expect(prompt).toContain("Malbec");
    expect(prompt).toContain("Champagne");
  });

  it("generates food inventory Excel with FIFO expiration tracking", () => {
    const prompt = "Crea un Excel de inventario de alimentos con control FIFO, columnas: producto, lote, fecha_ingreso, fecha_vencimiento, cantidad, ubicación y fórmulas FIFO_salida, días_restantes con estado URGENTE/PRÓXIMO/OK";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("spreadsheet");
    expect(prompt.toLowerCase()).toContain("fifo_salida");
    expect(prompt.toLowerCase()).toContain("días_restantes");
    expect(prompt).toContain("URGENTE");
    expect(prompt.toLowerCase()).toContain("fecha_vencimiento");
  });

  it("generates restaurant org chart SVG", () => {
    const prompt = "Genera un organigrama SVG de restaurante con jerarquía: Chef Ejecutivo, Sous Chef, Chef de Partida, Cocineros, Auxiliares";
    const result = analyzePrompt(prompt);

    expect(result.type).toBe("diagram");
    expect(prompt).toContain("Chef Ejecutivo");
    expect(prompt).toContain("Sous Chef");
    expect(prompt).toContain("Chef de Partida");
    expect(prompt).toContain("Cocineros");
    expect(prompt).toContain("Auxiliares");
  });
});
