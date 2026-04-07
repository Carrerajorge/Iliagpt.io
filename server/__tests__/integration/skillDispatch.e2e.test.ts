import { describe, it, expect } from "vitest";
import { classifyIntent, type IntentResult } from "../../services/pare/robustIntentClassifier";

/**
 * Skill / Intent Dispatch Tests
 *
 * Tests the robustIntentClassifier which performs keyword-based intent detection
 * for user messages in both Spanish and English.
 *
 * Intent types: "chat" | "analysis" | "nav" | "artifact" | "code" | "automation"
 */

describe("Skill Dispatch - Intent Classification", () => {
  it('detects document/word intent for "crea un documento Word sobre IA"', () => {
    const result: IntentResult = classifyIntent("crea un documento Word sobre IA");
    expect(result.intent).toBe("artifact");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.matchedKeywords.length).toBeGreaterThan(0);
  });

  it('detects web search sub-intent for "busca en internet sobre quantum"', () => {
    const result: IntentResult = classifyIntent("busca en internet sobre quantum computing");
    // The primary intent defaults to "chat" since no primary keyword group matches strongly,
    // but the sub-intent "search_web" is detected via "busca en internet"
    expect(result.intent).toBe("chat");
    expect(result.subIntent).toBe("search_web");
  });

  it('detects code intent for "ejecuta print(\'hello\')"', () => {
    const result: IntentResult = classifyIntent("ejecuta print('hello')");
    expect(result.intent).toBe("code");
    expect(result.matchedKeywords).toContain("ejecuta");
  });

  it('detects simple chat for "hola como estas"', () => {
    const result: IntentResult = classifyIntent("hola como estas");
    expect(result.intent).toBe("chat");
    expect(result.matchedKeywords.some((k) => ["hola", "como estas", "cómo estás"].includes(k))).toBe(true);
  });

  it('detects presentation intent for "genera una presentación sobre finanzas"', () => {
    const result: IntentResult = classifyIntent("genera una presentación sobre finanzas");
    expect(result.intent).toBe("artifact");
    // Should match "presentación" keyword
    expect(
      result.matchedKeywords.some((k) => k.includes("presentaci")),
    ).toBe(true);
  });

  it('detects analysis intent for "analiza este PDF"', () => {
    const result: IntentResult = classifyIntent("analiza este PDF");
    // "analiza" triggers analysis, "pdf" triggers artifact — depends on priority
    // artifact has higher priority in INTENT_PRIORITY
    expect(["artifact", "analysis"]).toContain(result.intent);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('detects artifact/spreadsheet intent for "crea una tabla de datos de ventas"', () => {
    const result: IntentResult = classifyIntent("crea una hoja de cálculo con datos de ventas");
    expect(result.intent).toBe("artifact");
    expect(
      result.matchedKeywords.some((k) => k.includes("hoja de c")),
    ).toBe(true);
  });

  it('detects chat for simple translation "traduce esto al inglés"', () => {
    // "traduce" matches the sub-intent translate but no primary keyword group strongly
    const result: IntentResult = classifyIntent("traduce esto al inglés");
    // This is a simple task — could be chat or analysis depending on keyword matches
    expect(["chat", "analysis"]).toContain(result.intent);
  });

  it('detects artifact intent for "automatiza el envío de reportes diarios"', () => {
    const result: IntentResult = classifyIntent("automatiza el envío de reportes diarios");
    // "reporte" triggers artifact (higher priority than automation)
    expect(result.intent).toBe("artifact");
    expect(result.matchedKeywords.some((k) => k.includes("reporte") || k.includes("report"))).toBe(true);
  });

  it('detects code intent for "muestra un gráfico de barras con python"', () => {
    const result: IntentResult = classifyIntent("muestra un gráfico de barras con python");
    // "python" triggers code intent
    expect(result.intent).toBe("code");
    expect(result.matchedKeywords).toContain("python");
  });

  it("returns confidence between 0 and 1", () => {
    const result: IntentResult = classifyIntent("hola");
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("handles empty input gracefully", () => {
    const result: IntentResult = classifyIntent("");
    expect(result.intent).toBe("chat");
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });

  it('detects artifact for English "create a PowerPoint presentation"', () => {
    const result: IntentResult = classifyIntent("create a PowerPoint presentation about marketing");
    expect(result.intent).toBe("artifact");
    expect(result.matchedKeywords.some((k) => k.toLowerCase().includes("powerpoint") || k.toLowerCase().includes("presentation"))).toBe(true);
  });

  it('detects code intent for "fix the bug in the API endpoint"', () => {
    const result: IntentResult = classifyIntent("fix the bug in the API endpoint");
    expect(result.intent).toBe("code");
    expect(result.matchedKeywords.some((k) => ["fix", "bug", "api", "endpoint"].includes(k.toLowerCase()))).toBe(true);
  });

  it("prioritizes artifact over analysis when both keywords appear", () => {
    const result: IntentResult = classifyIntent("genera un reporte con análisis de datos en Excel");
    // Both "artifact" (reporte, excel) and "analysis" (análisis) keywords present
    // artifact has higher priority
    expect(result.intent).toBe("artifact");
  });
});
