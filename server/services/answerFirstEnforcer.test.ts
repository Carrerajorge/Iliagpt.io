import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QuestionClassification } from "./questionClassifier";

// Mock the questionClassifier module before importing the module under test
vi.mock("./questionClassifier", () => ({
  questionClassifier: {
    classifyQuestion: vi.fn(),
  },
}));

import {
  buildAnswerFirstPrompt,
  generateAnswerFirstSystemPrompt,
  validateAnswerFirstResponse,
  getRepairPrompt,
  AnswerFirstContext,
} from "./answerFirstEnforcer";

import { questionClassifier } from "./questionClassifier";

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------
function makeClassification(overrides: Partial<QuestionClassification> = {}): QuestionClassification {
  return {
    type: "factual_simple",
    confidence: 0.9,
    expectedFormat: "single_value",
    maxTokens: 150,
    maxCharacters: 300,
    requiresCitation: true,
    allowsExpansion: false,
    ...overrides,
  } as QuestionClassification;
}

function makeContext(overrides: Partial<AnswerFirstContext> = {}): AnswerFirstContext {
  return {
    userQuestion: "What is the flight date?",
    classification: makeClassification(),
    enforceStrictMode: false,
    ...overrides,
  };
}

// =============================================================================
// buildAnswerFirstPrompt
// =============================================================================
describe("buildAnswerFirstPrompt", () => {
  it("includes the base system prompt in fullPrompt", () => {
    const result = buildAnswerFirstPrompt(makeContext());
    expect(result.fullPrompt).toContain("ILIAGPT");
    expect(result.fullPrompt).toContain("REGLAS OBLIGATORIAS");
  });

  it("adds strict rules for factual_simple questions with documents", () => {
    const ctx = makeContext({
      classification: makeClassification({ type: "factual_simple" }),
      documentContext: "some document text",
    });
    const result = buildAnswerFirstPrompt(ctx);
    expect(result.fullPrompt).toContain("ANSWER-FIRST");
    expect(result.fullPrompt).toContain("RESUMEN EJECUTIVO");
    expect(result.constraints).toContain("NO usar RESUMEN EJECUTIVO");
  });

  it("adds lite strict rules for factual_simple questions without documents", () => {
    const ctx = makeContext({
      classification: makeClassification({ type: "factual_simple" }),
      documentContext: undefined,
    });
    const result = buildAnswerFirstPrompt(ctx);
    expect(result.fullPrompt).toContain("ANSWER-FIRST");
    expect(result.fullPrompt).toContain("No inventes citas");
  });

  it("adds strict rules for yes_no questions", () => {
    const ctx = makeContext({
      classification: makeClassification({ type: "yes_no" }),
    });
    const result = buildAnswerFirstPrompt(ctx);
    expect(result.constraints).toContain("NO usar RESUMEN EJECUTIVO");
  });

  it("adds strict rules for factual_multiple questions", () => {
    const ctx = makeContext({
      classification: makeClassification({ type: "factual_multiple" }),
    });
    const result = buildAnswerFirstPrompt(ctx);
    expect(result.constraints).toContain("Primera frase debe ser la respuesta directa");
  });

  it("does NOT add strict rules for summary questions", () => {
    const ctx = makeContext({
      classification: makeClassification({ type: "summary", requiresCitation: false }),
    });
    const result = buildAnswerFirstPrompt(ctx);
    expect(result.constraints).not.toContain("NO usar RESUMEN EJECUTIVO");
  });

  it("includes document context instructions when documentContext is present", () => {
    const ctx = makeContext({ documentContext: "PDF extracted text..." });
    const result = buildAnswerFirstPrompt(ctx);
    expect(result.fullPrompt).toContain("CONTEXTO DEL DOCUMENTO");
    expect(result.constraints).toContain("Citar fuente del documento");
  });

  it("includes extracted target hint when present in classification", () => {
    const ctx = makeContext({
      classification: makeClassification({
        extractedTarget: { entity: "fecha", context: "vuelo", expectedType: "date" },
      }),
    });
    const result = buildAnswerFirstPrompt(ctx);
    expect(result.fullPrompt).toContain("EL USUARIO BUSCA: fecha");
    expect(result.fullPrompt).toContain("(contexto: vuelo)");
  });

  it("adds strict mode block when enforceStrictMode is true", () => {
    const ctx = makeContext({ enforceStrictMode: true });
    const result = buildAnswerFirstPrompt(ctx);
    expect(result.fullPrompt).toContain("MODO ESTRICTO ACTIVADO");
    expect(result.fullPrompt).toContain("CERO tolerancia");
  });

  it("returns maxTokens from classification", () => {
    const ctx = makeContext({
      classification: makeClassification({ maxTokens: 500 }),
    });
    const result = buildAnswerFirstPrompt(ctx);
    expect(result.maxTokens).toBe(500);
  });

  it("returns formatInstructions string", () => {
    const ctx = makeContext({
      classification: makeClassification({ type: "greeting" }),
    });
    const result = buildAnswerFirstPrompt(ctx);
    expect(result.formatInstructions).toContain("Saludo breve");
  });
});

// =============================================================================
// generateAnswerFirstSystemPrompt
// =============================================================================
describe("generateAnswerFirstSystemPrompt", () => {
  beforeEach(() => {
    vi.mocked(questionClassifier.classifyQuestion).mockReset();
  });

  it("uses questionClassifier to classify the question and returns a prompt", () => {
    vi.mocked(questionClassifier.classifyQuestion).mockReturnValue(
      makeClassification({ type: "factual_simple" })
    );
    const result = generateAnswerFirstSystemPrompt("What is the flight date?", true, "doc text");
    expect(questionClassifier.classifyQuestion).toHaveBeenCalledWith("What is the flight date?");
    expect(result.fullPrompt).toContain("ILIAGPT");
  });

  it("enables strict mode for factual_simple questions", () => {
    vi.mocked(questionClassifier.classifyQuestion).mockReturnValue(
      makeClassification({ type: "factual_simple" })
    );
    const result = generateAnswerFirstSystemPrompt("What is it?");
    expect(result.fullPrompt).toContain("MODO ESTRICTO ACTIVADO");
  });

  it("enables strict mode for yes_no questions", () => {
    vi.mocked(questionClassifier.classifyQuestion).mockReturnValue(
      makeClassification({ type: "yes_no" })
    );
    const result = generateAnswerFirstSystemPrompt("Is it possible?");
    expect(result.fullPrompt).toContain("MODO ESTRICTO ACTIVADO");
  });

  it("does not enable strict mode for analysis questions", () => {
    vi.mocked(questionClassifier.classifyQuestion).mockReturnValue(
      makeClassification({ type: "analysis" })
    );
    const result = generateAnswerFirstSystemPrompt("Analyze the document");
    expect(result.fullPrompt).not.toContain("MODO ESTRICTO ACTIVADO");
  });

  it("ignores documentContext when hasDocuments is false", () => {
    vi.mocked(questionClassifier.classifyQuestion).mockReturnValue(makeClassification());
    const result = generateAnswerFirstSystemPrompt("What?", false, "should be ignored");
    expect(result.fullPrompt).not.toContain("CONTEXTO DEL DOCUMENTO");
  });
});

// =============================================================================
// validateAnswerFirstResponse
// =============================================================================
describe("validateAnswerFirstResponse", () => {
  it("returns valid for a clean factual response", () => {
    const classification = makeClassification({ type: "factual_simple", maxCharacters: 500 });
    const result = validateAnswerFirstResponse(
      "El vuelo es el 19 de enero de 2026 [documento p:1].",
      classification
    );
    expect(result.isValid).toBe(true);
    expect(result.firstSentenceAnswers).toBe(true);
    expect(result.hasRequiredCitation).toBe(true);
    expect(result.isWithinLength).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("flags response starting with RESUMEN EJECUTIVO for factual question", () => {
    const classification = makeClassification({ type: "factual_simple" });
    const result = validateAnswerFirstResponse(
      "RESUMEN EJECUTIVO: el vuelo es el 19 de enero.",
      classification
    );
    expect(result.firstSentenceAnswers).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("flags response starting with 'Basándome en' for factual question", () => {
    const classification = makeClassification({ type: "factual_simple" });
    const result = validateAnswerFirstResponse(
      "Basándome en el documento, el vuelo es...",
      classification
    );
    expect(result.firstSentenceAnswers).toBe(false);
  });

  it("flags yes_no responses that don't start with Si/No", () => {
    const classification = makeClassification({ type: "yes_no", maxCharacters: 500 });
    const result = validateAnswerFirstResponse(
      "Efectivamente, es posible [documento p:2].",
      classification
    );
    expect(result.firstSentenceAnswers).toBe(false);
    expect(result.issues).toContain('Pregunta Sí/No debe empezar con "Sí" o "No"');
  });

  it("accepts yes_no response starting with 'No'", () => {
    const classification = makeClassification({ type: "yes_no", maxCharacters: 500 });
    const result = validateAnswerFirstResponse(
      "No, no es posible hacerlo [documento p:3].",
      classification
    );
    expect(result.firstSentenceAnswers).toBe(true);
  });

  it("accepts yes_no response starting with 'Si' (no accent) followed by a space", () => {
    const classification = makeClassification({ type: "yes_no", maxCharacters: 500 });
    const result = validateAnswerFirstResponse(
      "Si es posible [documento p:3].",
      classification
    );
    expect(result.firstSentenceAnswers).toBe(true);
  });

  it("flags missing citation when requiresCitation is true", () => {
    const classification = makeClassification({ requiresCitation: true, maxCharacters: 500 });
    const result = validateAnswerFirstResponse(
      "El vuelo es el 19 de enero.",
      classification
    );
    expect(result.hasRequiredCitation).toBe(false);
    expect(result.issues).toContain("Falta cita del documento");
  });

  it("skips citation check when requiresCitation is false", () => {
    const classification = makeClassification({ requiresCitation: false, maxCharacters: 500 });
    const result = validateAnswerFirstResponse("Hello there.", classification);
    expect(result.hasRequiredCitation).toBe(true);
  });

  it("flags excessively long responses", () => {
    const classification = makeClassification({
      type: "summary",
      maxCharacters: 50,
      requiresCitation: false,
    });
    const longResponse = "A".repeat(200);
    const result = validateAnswerFirstResponse(longResponse, classification);
    expect(result.isWithinLength).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("allows 20% length tolerance", () => {
    const classification = makeClassification({
      type: "summary",
      maxCharacters: 100,
      requiresCitation: false,
    });
    // 120 characters is exactly 20% over 100 => should still pass
    const response = "A".repeat(120);
    const result = validateAnswerFirstResponse(response, classification);
    expect(result.isWithinLength).toBe(true);
  });

  it("flags first sentence without expected date for date target", () => {
    const classification = makeClassification({
      type: "factual_simple",
      maxCharacters: 500,
      extractedTarget: { entity: "fecha", expectedType: "date" },
    });
    const result = validateAnswerFirstResponse(
      "La información se encuentra en el documento [documento p:1].",
      classification
    );
    expect(result.issues).toContain("Primera frase no contiene la fecha solicitada");
  });

  it("flags first sentence without expected currency for currency target", () => {
    const classification = makeClassification({
      type: "factual_simple",
      maxCharacters: 500,
      extractedTarget: { entity: "precio", expectedType: "currency" },
    });
    const result = validateAnswerFirstResponse(
      "El precio está indicado en el boleto [documento p:1].",
      classification
    );
    expect(result.issues).toContain("Primera frase no contiene el monto solicitado");
  });

  it("does not flag forbidden patterns for summary questions", () => {
    const classification = makeClassification({
      type: "summary",
      maxCharacters: 5000,
      requiresCitation: false,
    });
    const result = validateAnswerFirstResponse(
      "RESUMEN EJECUTIVO: el documento trata sobre vuelos.",
      classification
    );
    expect(result.firstSentenceAnswers).toBe(true);
  });
});

// =============================================================================
// getRepairPrompt
// =============================================================================
describe("getRepairPrompt", () => {
  it("includes all issues in the repair prompt", () => {
    const validation = {
      isValid: false,
      firstSentenceAnswers: false,
      hasRequiredCitation: false,
      isWithinLength: false,
      issues: ["Too long", "Missing citation"],
      suggestions: ["Shorten", "Add citation"],
    };
    const classification = makeClassification({ maxCharacters: 300 });
    const result = getRepairPrompt("Some original long response", validation, classification);
    expect(result).toContain("Too long");
    expect(result).toContain("Missing citation");
    expect(result).toContain("Shorten");
    expect(result).toContain("Add citation");
    expect(result).toContain("300 caracteres");
  });

  it("truncates the original response to 200 characters", () => {
    const longOriginal = "X".repeat(500);
    const validation = {
      isValid: false,
      firstSentenceAnswers: false,
      hasRequiredCitation: true,
      isWithinLength: false,
      issues: ["Too long"],
      suggestions: ["Shorten"],
    };
    const classification = makeClassification();
    const result = getRepairPrompt(longOriginal, validation, classification);
    // Should contain the truncated version, not the full 500 chars
    expect(result).toContain("...");
    // The original in the prompt is substring(0,200) so 200 X's
    const xCount = (result.match(/X/g) || []).length;
    expect(xCount).toBe(200);
  });

  it("ends with GENERA UNA NUEVA RESPUESTA:", () => {
    const validation = {
      isValid: false,
      firstSentenceAnswers: true,
      hasRequiredCitation: true,
      isWithinLength: false,
      issues: ["Too long"],
      suggestions: ["Shorten"],
    };
    const classification = makeClassification();
    const result = getRepairPrompt("response", validation, classification);
    expect(result).toContain("GENERA UNA NUEVA RESPUESTA:");
  });
});
