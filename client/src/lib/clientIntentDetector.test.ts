import { describe, it, expect } from "vitest";
import { detectClientIntent } from "./clientIntentDetector";
import type { IntentType } from "./clientIntentDetector";

describe("detectClientIntent", () => {
  describe("research intent", () => {
    it("detects search requests in Spanish", () => {
      expect(detectClientIntent("busca información sobre inteligencia artificial")).toBe("research");
    });

    it("detects search requests in English", () => {
      expect(detectClientIntent("search for information about climate change")).toBe("research");
    });

    it("detects 'what is' questions", () => {
      expect(detectClientIntent("qué es la fotosíntesis")).toBe("research");
      expect(detectClientIntent("what is machine learning")).toBe("research");
    });

    it("detects 'who is' questions", () => {
      expect(detectClientIntent("quién es Elon Musk")).toBe("research");
    });
  });

  describe("document_analysis intent", () => {
    it("detects document analysis requests", () => {
      expect(detectClientIntent("analiza este documento PDF")).toBe("document_analysis");
    });

    it("detects file review requests", () => {
      expect(detectClientIntent("revisa el archivo excel por favor")).toBe("document_analysis");
    });

    it("detects summarize requests", () => {
      expect(detectClientIntent("resume el contenido de este informe")).toBe("document_analysis");
    });
  });

  describe("document_generation intent", () => {
    it("detects document creation in Spanish", () => {
      expect(detectClientIntent("crea un documento con el informe mensual")).toBe("document_generation");
    });

    it("detects report generation", () => {
      expect(detectClientIntent("genera un informe detallado sobre las ventas")).toBe("document_generation");
    });

    it("detects letter drafting", () => {
      expect(detectClientIntent("escribe una carta formal para el cliente")).toBe("document_generation");
    });
  });

  describe("presentation_creation intent", () => {
    it("detects presentation creation", () => {
      expect(detectClientIntent("crea una presentación sobre el proyecto")).toBe("presentation_creation");
    });

    it("detects PPT requests", () => {
      expect(detectClientIntent("genera un powerpoint con diapositivas")).toBe("presentation_creation");
    });
  });

  describe("spreadsheet_creation intent", () => {
    it("detects Excel creation", () => {
      expect(detectClientIntent("crea un excel con las ventas")).toBe("spreadsheet_creation");
    });

    it("detects table generation", () => {
      expect(detectClientIntent("hazme una tabla con los precios")).toBe("spreadsheet_creation");
    });
  });

  describe("data_analysis intent", () => {
    it("detects data analysis requests", () => {
      expect(detectClientIntent("analiza los datos del trimestre")).toBe("data_analysis");
    });

    it("detects chart/graph requests", () => {
      expect(detectClientIntent("crea un gráfico con las estadísticas")).toBe("data_analysis");
    });
  });

  describe("code_generation intent", () => {
    it("detects code requests", () => {
      expect(detectClientIntent("escribe código para una calculadora")).toBe("code_generation");
    });

    it("detects programming requests", () => {
      expect(detectClientIntent("crea un programa que ordene números")).toBe("code_generation");
    });

    it("detects language-specific requests", () => {
      expect(detectClientIntent("implementa una función en python que calcule factoriales")).toBe("code_generation");
    });
  });

  describe("web_automation intent", () => {
    it("detects web navigation requests", () => {
      expect(detectClientIntent("navega a la página web de Google")).toBe("web_automation");
    });

    it("detects browser automation", () => {
      expect(detectClientIntent("automatiza el navegador para extraer datos")).toBe("web_automation");
    });
  });

  describe("chat fallback", () => {
    it("returns chat for general conversation", () => {
      expect(detectClientIntent("buenos días, ¿cómo estás?")).toBe("chat");
    });

    it("returns chat for simple questions", () => {
      expect(detectClientIntent("¿cuántos años tienes?")).toBe("chat");
    });

    it("returns chat for empty-ish messages", () => {
      expect(detectClientIntent("hmmm")).toBe("chat");
    });
  });
});
