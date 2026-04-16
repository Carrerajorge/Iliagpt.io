import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock llmGateway before importing the module under test
vi.mock("./llmGateway", () => ({
  llmGateway: {
    chat: vi.fn(),
    complete: vi.fn(),
  },
}));

import {
  classifyPromptFast,
  getFastPathResponse,
  routePrompt,
  getToolsForIntent,
} from "./fastPathRouter";
import type { IntentType } from "./fastPathRouter";

// ---------------------------------------------------------------------------
// classifyPromptFast
// ---------------------------------------------------------------------------
describe("classifyPromptFast", () => {
  it("classifies a simple Spanish greeting as trivial", () => {
    const result = classifyPromptFast("Hola");
    expect(result.intent).toBe("greeting");
    expect(result.complexity).toBe("trivial");
    expect(result.confidence).toBe(0.95);
    expect(result.suggestedModel).toBe("flash");
    expect(result.canUseFastPath).toBe(true);
    expect(result.recommendedLane).toBe("fast");
  });

  it("classifies an English greeting (hello) as trivial", () => {
    const result = classifyPromptFast("Hello!");
    expect(result.intent).toBe("greeting");
    expect(result.complexity).toBe("trivial");
    expect(result.canUseFastPath).toBe(true);
  });

  it("classifies 'gracias' as a greeting", () => {
    const result = classifyPromptFast("Gracias");
    expect(result.intent).toBe("greeting");
    expect(result.complexity).toBe("trivial");
    expect(result.estimatedTokens).toBe(50);
  });

  it("classifies a short simple question in English", () => {
    const result = classifyPromptFast("What is TypeScript?");
    expect(result.intent).toBe("simple_question");
    expect(result.complexity).toBe("simple");
    expect(result.suggestedModel).toBe("flash");
    expect(result.canUseFastPath).toBe(true);
  });

  it("classifies a short simple question in Spanish", () => {
    const result = classifyPromptFast("Qué es React?");
    expect(result.intent).toBe("simple_question");
    expect(result.complexity).toBe("simple");
    expect(result.confidence).toBe(0.85);
  });

  it("classifies image generation prompt in English", () => {
    const result = classifyPromptFast("Generate an image of a sunset");
    expect(result.intent).toBe("image_generation");
    expect(result.complexity).toBe("moderate");
    expect(result.requiresTools).toContain("image_generation");
    expect(result.canUseFastPath).toBe(false);
  });

  it("classifies image generation prompt in Spanish", () => {
    const result = classifyPromptFast("Genera una imagen de un paisaje");
    expect(result.intent).toBe("image_generation");
    expect(result.requiresTools).toEqual(["image_generation"]);
  });

  it("classifies code generation with short prompt as moderate complexity", () => {
    const result = classifyPromptFast("Write a function to sort an array");
    expect(result.intent).toBe("code_generation");
    expect(result.complexity).toBe("moderate");
    expect(result.requiresTools).toContain("code_execution");
    expect(result.canUseFastPath).toBe(false);
  });

  it("classifies code generation with very long prompt as complex", () => {
    const words = Array(60).fill("word").join(" ");
    const result = classifyPromptFast(`Write a function that ${words}`);
    expect(result.intent).toBe("code_generation");
    expect(result.complexity).toBe("complex");
    expect(result.recommendedLane).toBe("deep");
  });

  it("classifies document generation prompts", () => {
    const result = classifyPromptFast("Create a report about sales");
    expect(result.intent).toBe("document_generation");
    expect(result.complexity).toBe("moderate");
    expect(result.suggestedModel).toBe("pro");
    expect(result.requiresTools).toContain("document_generation");
  });

  it("classifies search-related prompts", () => {
    const result = classifyPromptFast("Search for the latest news about AI");
    expect(result.intent).toBe("search_required");
    expect(result.requiresTools).toContain("web_search");
    expect(result.canUseFastPath).toBe(false);
  });

  it("classifies complex research that combines search + analysis as complex_research", () => {
    const result = classifyPromptFast("Research and analyze the latest AI trends");
    expect(result.intent).toBe("complex_research");
    expect(result.complexity).toBe("complex");
    expect(result.suggestedModel).toBe("agent");
    expect(result.recommendedLane).toBe("deep");
  });

  it("classifies agent tasks (pure complex pattern without search)", () => {
    const result = classifyPromptFast("Analyze the architecture of this system");
    expect(result.intent).toBe("agent_task");
    expect(result.complexity).toBe("complex");
    expect(result.suggestedModel).toBe("agent");
    expect(result.recommendedLane).toBe("deep");
  });

  it("falls back to simple_question for very short unknown prompts (<=5 words)", () => {
    const result = classifyPromptFast("Apple pie recipe");
    expect(result.intent).toBe("simple_question");
    expect(result.complexity).toBe("simple");
    expect(result.confidence).toBe(0.7);
    expect(result.canUseFastPath).toBe(true);
  });

  it("falls back to factual for medium-length unknown prompts (6-20 words)", () => {
    const result = classifyPromptFast("Tell me about the history of computers and how they evolved over time");
    expect(result.intent).toBe("factual");
    expect(result.complexity).toBe("simple");
    expect(result.suggestedModel).toBe("flash");
    expect(result.canUseFastPath).toBe(true);
  });

  it("falls back to factual moderate for long unknown prompts (>20 words)", () => {
    const words = Array(25).fill("arbitrary").join(" ");
    const result = classifyPromptFast(words);
    expect(result.intent).toBe("factual");
    expect(result.complexity).toBe("moderate");
    expect(result.suggestedModel).toBe("pro");
    expect(result.canUseFastPath).toBe(false);
    expect(result.estimatedTokens).toBe(25 * 10);
  });

  it("handles whitespace-only prompt gracefully (falls back)", () => {
    const result = classifyPromptFast("   ");
    expect(result).toBeDefined();
    expect(result.intent).toBeDefined();
  });

  it("returns correct estimatedTokens for code generation", () => {
    const prompt = "Create a script to parse CSV files and extract data";
    const result = classifyPromptFast(prompt);
    expect(result.intent).toBe("code_generation");
    const wordCount = prompt.split(/\s+/).length;
    expect(result.estimatedTokens).toBe(Math.max(500, wordCount * 20));
  });
});

// ---------------------------------------------------------------------------
// getFastPathResponse
// ---------------------------------------------------------------------------
describe("getFastPathResponse", () => {
  it("returns a response for 'hola'", () => {
    const response = getFastPathResponse("hola");
    expect(response).not.toBeNull();
    expect(typeof response).toBe("string");
  });

  it("returns a response for 'hi' with trailing punctuation stripped", () => {
    const response = getFastPathResponse("hi!");
    expect(response).not.toBeNull();
  });

  it("returns a response for 'thanks' with mixed case", () => {
    const response = getFastPathResponse("Thanks!");
    expect(response).not.toBeNull();
  });

  it("returns null for non-matching prompts", () => {
    const response = getFastPathResponse("Tell me about quantum physics");
    expect(response).toBeNull();
  });

  it("returns a response when keyword appears at end (e.g. 'say bye')", () => {
    const response = getFastPathResponse("say bye");
    expect(response).not.toBeNull();
  });

  it("returns a response when keyword has leading spaces", () => {
    const response = getFastPathResponse("   hello   ");
    expect(response).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// routePrompt
// ---------------------------------------------------------------------------
describe("routePrompt", () => {
  it("routes a greeting with fastPathResponse and shouldStream=false", async () => {
    const result = await routePrompt("Hola");
    expect(result.classification.intent).toBe("greeting");
    expect(result.fastPathResponse).not.toBeNull();
    expect(result.shouldStream).toBe(false);
    expect(result.modelToUse).toBe("gemini-2.0-flash");
    expect(result.recommendedLane).toBe("fast");
  });

  it("routes a complex prompt with shouldStream=true", async () => {
    const result = await routePrompt("Analyze the roadmap and plan a strategy for next quarter");
    expect(result.classification.intent).toBe("agent_task");
    expect(result.fastPathResponse).toBeNull();
    expect(result.shouldStream).toBe(true);
    expect(result.modelToUse).toBe("gemini-2.5-pro");
  });

  it("maps flash model to gemini-2.0-flash", async () => {
    const result = await routePrompt("Hello");
    expect(result.modelToUse).toBe("gemini-2.0-flash");
  });

  it("maps pro model to gemini-2.5-pro", async () => {
    const result = await routePrompt("Create a document about machine learning");
    expect(result.modelToUse).toBe("gemini-2.5-pro");
  });
});

// ---------------------------------------------------------------------------
// getToolsForIntent
// ---------------------------------------------------------------------------
describe("getToolsForIntent", () => {
  it("returns empty array for greeting intent", () => {
    expect(getToolsForIntent("greeting")).toEqual([]);
  });

  it("returns empty array for simple_question", () => {
    expect(getToolsForIntent("simple_question")).toEqual([]);
  });

  it("returns web_search for search_required", () => {
    expect(getToolsForIntent("search_required")).toEqual(["web_search"]);
  });

  it("returns document tools for document_generation", () => {
    const tools = getToolsForIntent("document_generation");
    expect(tools).toContain("document_generator");
    expect(tools).toContain("excel_generator");
    expect(tools).toContain("word_generator");
  });

  it("returns code tools for code_generation", () => {
    const tools = getToolsForIntent("code_generation");
    expect(tools).toContain("code_executor");
    expect(tools).toContain("file_manager");
  });

  it("returns agent tools for agent_task", () => {
    const tools = getToolsForIntent("agent_task");
    expect(tools).toContain("planner");
    expect(tools).toContain("web_search");
  });

  it("returns image_generator for image_generation", () => {
    expect(getToolsForIntent("image_generation")).toEqual(["image_generator"]);
  });

  it("returns data analysis tools for data_analysis", () => {
    const tools = getToolsForIntent("data_analysis");
    expect(tools).toContain("data_analyzer");
    expect(tools).toContain("chart_generator");
    expect(tools).toContain("excel_generator");
  });

  it("returns empty array for unknown intent", () => {
    expect(getToolsForIntent("nonexistent" as IntentType)).toEqual([]);
  });
});
