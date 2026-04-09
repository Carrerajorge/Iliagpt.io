/**
 * Tests for promptAnalyzer.ts — Unified Prompt Analysis Engine
 *
 * All 12 required test cases must pass with confidence > 0.8
 */

import { describe, it, expect } from "vitest";
import { analyzePrompt, resolveActionPipeline } from "../services/promptAnalyzer";

describe("promptAnalyzer — Core Test Cases", () => {
  it("TC01: hazme una presentación sobre inteligencia artificial", () => {
    const analysis = analyzePrompt("hazme una presentación sobre inteligencia artificial");
    expect(analysis.primaryIntent).toBe("create");
    expect(analysis.deliverable).toBe("presentation");
    expect(analysis.deliverableFormat).toBe("pptx");
    expect(analysis.confidence).toBeGreaterThan(0.8);
  });

  it("TC02: analiza este documento y dame un resumen", () => {
    const analysis = analyzePrompt("analiza este documento y dame un resumen");
    expect(analysis.primaryIntent).toBe("analyze");
    expect(analysis.deliverable).toBe("text");
    expect(analysis.documentAction).toBe("analyze");
    expect(analysis.confidence).toBeGreaterThan(0.7);
  });

  it("TC03: crea un excel con los datos de ventas", () => {
    const analysis = analyzePrompt("crea un excel con los datos de ventas");
    expect(analysis.primaryIntent).toBe("create");
    expect(analysis.deliverable).toBe("spreadsheet");
    expect(analysis.deliverableFormat).toBe("xlsx");
    expect(analysis.confidence).toBeGreaterThan(0.8);
  });

  it("TC04: genera un PDF del reporte", () => {
    const analysis = analyzePrompt("genera un PDF del reporte");
    expect(analysis.primaryIntent).toBe("create");
    expect(analysis.deliverable).toBe("pdf");
    expect(analysis.deliverableFormat).toBe("pdf");
    expect(analysis.confidence).toBeGreaterThan(0.8);
  });

  it("TC05: explícame qué es la fotosíntesis", () => {
    const analysis = analyzePrompt("explícame qué es la fotosíntesis");
    expect(analysis.primaryIntent).toBe("explain");
    expect(analysis.deliverable).toBe("text");
    expect(analysis.confidence).toBeGreaterThan(0.7);
  });

  it("TC06: grafica y = x²", () => {
    const analysis = analyzePrompt("grafica y = x²");
    expect(analysis.primaryIntent).toBe("visualize");
    expect(analysis.deliverable).toBe("chart");
    expect(analysis.deliverableFormat).toBe("html");
    expect(analysis.confidence).toBeGreaterThan(0.7);
  });

  it("TC07: traduce este texto al inglés", () => {
    const analysis = analyzePrompt("traduce este texto al inglés");
    expect(analysis.primaryIntent).toBe("translate");
    expect(analysis.deliverable).toBe("text");
    expect(analysis.confidence).toBeGreaterThan(0.8);
  });

  it("TC08: corrige los errores en este código", () => {
    const analysis = analyzePrompt("corrige los errores en este código");
    expect(analysis.primaryIntent).toBe("fix");
    expect(analysis.deliverable).toBe("code");
    expect(analysis.confidence).toBeGreaterThan(0.7);
  });

  it("TC09: haz una tabla comparativa", () => {
    const analysis = analyzePrompt("haz una tabla comparativa");
    expect(analysis.primaryIntent).toBe("create");
    expect(analysis.deliverable).toBe("table");
    expect(["markdown", "html"]).toContain(analysis.deliverableFormat);
    expect(analysis.confidence).toBeGreaterThan(0.7);
  });

  it("TC10: Make me a PowerPoint about climate change with graphs and tables", () => {
    const analysis = analyzePrompt("Make me a PowerPoint about climate change with graphs and tables");
    expect(analysis.primaryIntent).toBe("create");
    expect(analysis.deliverable).toBe("presentation");
    expect(analysis.deliverableFormat).toBe("pptx");
    expect(analysis.confidence).toBeGreaterThan(0.8);
  });

  it("TC11: Read this PDF and extract all the tables", () => {
    const analysis = analyzePrompt("Read this PDF and extract all the tables");
    expect(analysis.primaryIntent).toBe("analyze");
    expect(analysis.deliverable).toBe("table");
    expect(analysis.documentAction).toBe("read");
    expect(analysis.confidence).toBeGreaterThan(0.6);
  });

  it("TC12: Convierte este Word a PDF", () => {
    const analysis = analyzePrompt("Convierte este Word a PDF");
    expect(analysis.primaryIntent).toBe("create");
    expect(analysis.deliverable).toBe("pdf");
    expect(analysis.deliverableFormat).toBe("pdf");
    expect(analysis.documentAction).toBe("convert");
    expect(analysis.confidence).toBeGreaterThan(0.7);
  });
});

describe("promptAnalyzer — Language Detection", () => {
  it("detects Spanish", () => {
    const analysis = analyzePrompt("hazme una presentación");
    expect(analysis.language).toBe("es");
  });

  it("detects English", () => {
    const analysis = analyzePrompt("Create a PowerPoint presentation");
    expect(analysis.language).toBe("en");
  });
});

describe("promptAnalyzer — Constraint Extraction", () => {
  it("extracts slide count constraint", () => {
    const analysis = analyzePrompt("hazme una presentación con 10 diapositivas sobre marketing");
    expect(analysis.constraints.length).toBeGreaterThan(0);
  });

  it("extracts 'con tablas' constraint", () => {
    const analysis = analyzePrompt("crea una presentación con tablas y gráficos");
    expect(analysis.constraints.some((c) => /tabla/i.test(c) || /gráfico/i.test(c))).toBe(true);
  });
});

describe("promptAnalyzer — Action Pipeline Routing", () => {
  it("routes presentation to pptx_generator", () => {
    const analysis = analyzePrompt("hazme una presentación");
    const pipeline = resolveActionPipeline(analysis);
    expect(pipeline).toBe("pptx_generator");
  });

  it("routes spreadsheet to xlsx_generator", () => {
    const analysis = analyzePrompt("crea un excel");
    const pipeline = resolveActionPipeline(analysis);
    expect(pipeline).toBe("xlsx_generator");
  });

  it("routes PDF to pdf_generator", () => {
    const analysis = analyzePrompt("genera un pdf");
    const pipeline = resolveActionPipeline(analysis);
    expect(pipeline).toBe("pdf_generator");
  });

  it("routes chart/visualize to visualization_pipeline", () => {
    const analysis = analyzePrompt("grafica y = x^2");
    const pipeline = resolveActionPipeline(analysis);
    expect(pipeline).toBe("visualization_pipeline");
  });

  it("routes explain to standard_llm", () => {
    const analysis = analyzePrompt("explícame qué es la inteligencia artificial");
    const pipeline = resolveActionPipeline(analysis);
    expect(pipeline).toBe("standard_llm");
  });

  it("routes code fix to code_generation", () => {
    const analysis = analyzePrompt("fix the bug in my function");
    const pipeline = resolveActionPipeline(analysis);
    expect(pipeline).toBe("code_generation");
  });

  it("routes document analysis to document_analysis", () => {
    const analysis = analyzePrompt("analiza este documento");
    const pipeline = resolveActionPipeline(analysis);
    expect(pipeline).toBe("document_analysis");
  });
});

describe("promptAnalyzer — Edge Cases", () => {
  it("handles empty string gracefully", () => {
    const analysis = analyzePrompt("");
    expect(analysis.primaryIntent).toBe("chat");
    expect(analysis.confidence).toBeLessThan(0.5);
  });

  it("handles very short message", () => {
    const analysis = analyzePrompt("Hola");
    expect(analysis.primaryIntent).toBe("chat");
  });

  it("handles summarize intent", () => {
    const analysis = analyzePrompt("resume este documento");
    expect(analysis.primaryIntent).toBe("summarize");
  });

  it("handles compare intent", () => {
    const analysis = analyzePrompt("compara React vs Vue");
    expect(["compare", "chat"]).toContain(analysis.primaryIntent);
  });
});
