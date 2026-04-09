/**
 * Tests for actionExecutor.ts — Action Execution Engine
 */

import { describe, it, expect, vi } from "vitest";
import { shouldGenerateFile } from "../services/actionExecutor";
import { analyzePrompt } from "../services/promptAnalyzer";

describe("actionExecutor — shouldGenerateFile", () => {
  it("returns true for presentation requests with high confidence", () => {
    const analysis = analyzePrompt("hazme una presentación sobre inteligencia artificial");
    expect(shouldGenerateFile(analysis)).toBe(true);
  });

  it("returns true for spreadsheet requests with high confidence", () => {
    const analysis = analyzePrompt("crea un excel con datos de ventas");
    expect(shouldGenerateFile(analysis)).toBe(true);
  });

  it("returns true for PDF requests with high confidence", () => {
    const analysis = analyzePrompt("genera un PDF del reporte");
    expect(shouldGenerateFile(analysis)).toBe(true);
  });

  it("returns true for document requests with high confidence", () => {
    const analysis = analyzePrompt("crea un documento word sobre el proyecto");
    expect(shouldGenerateFile(analysis)).toBe(true);
  });

  it("returns false for chat-only requests", () => {
    const analysis = analyzePrompt("explícame qué es la inteligencia artificial");
    expect(shouldGenerateFile(analysis)).toBe(false);
  });

  it("returns false for visualization requests (handled inline)", () => {
    const analysis = analyzePrompt("grafica y = x²");
    expect(shouldGenerateFile(analysis)).toBe(false);
  });

  it("returns false for translation requests", () => {
    const analysis = analyzePrompt("traduce este texto al inglés");
    expect(shouldGenerateFile(analysis)).toBe(false);
  });

  it("returns false for analysis-only requests", () => {
    const analysis = analyzePrompt("analiza este documento y dame un resumen");
    expect(shouldGenerateFile(analysis)).toBe(false);
  });
});

describe("actionExecutor — Pipeline Routing Integration", () => {
  it("PowerPoint intent → shouldGenerateFile true", () => {
    const cases = [
      "hazme una presentación sobre ventas",
      "Make me a PowerPoint about climate change",
      "crea una presentación con 10 slides",
      "genera un pptx sobre marketing digital",
    ];

    for (const msg of cases) {
      const analysis = analyzePrompt(msg);
      const shouldGenerate = shouldGenerateFile(analysis);
      expect(shouldGenerate, `Expected shouldGenerateFile=true for: "${msg}"`).toBe(true);
    }
  });

  it("Spreadsheet intent → shouldGenerateFile true", () => {
    const cases = [
      "crea un excel con los datos",
      "Make me an Excel spreadsheet",
      "genera una hoja de cálculo de presupuesto",
    ];

    for (const msg of cases) {
      const analysis = analyzePrompt(msg);
      const shouldGenerate = shouldGenerateFile(analysis);
      expect(shouldGenerate, `Expected shouldGenerateFile=true for: "${msg}"`).toBe(true);
    }
  });

  it("Conversational intent → shouldGenerateFile false", () => {
    const cases = [
      "Hola, ¿cómo estás?",
      "What is machine learning?",
      "explícame la fotosíntesis",
      "résume ce document",
    ];

    for (const msg of cases) {
      const analysis = analyzePrompt(msg);
      const shouldGenerate = shouldGenerateFile(analysis);
      expect(shouldGenerate, `Expected shouldGenerateFile=false for: "${msg}"`).toBe(false);
    }
  });
});
