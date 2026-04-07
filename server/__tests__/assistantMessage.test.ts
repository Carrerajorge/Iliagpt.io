import { describe, expect, it } from "vitest";

import {
  buildAssistantMessage,
  buildAssistantMessageMetadata,
} from "@shared/assistantMessage";

describe("assistantMessage", () => {
  it("normalizes assistant payloads into a canonical message shape", () => {
    const timestamp = new Date("2026-04-06T12:00:00.000Z");
    const message = buildAssistantMessage({
      id: " assistant-1 ",
      timestamp,
      requestId: " req_123 ",
      userMessageId: " user_456 ",
      content: "   ",
      fallbackContent: "Respuesta vacia",
      webSources: [{ url: "https://example.com" }],
      searchQueries: [{ query: "assistant helper" }],
      totalSearches: "3",
      followUpSuggestions: [
        "  1. Convierte esto en pasos concretos  ",
        "Convierte esto en pasos concretos",
      ],
      confidence: "MEDIUM",
      uncertaintyReason: "  faltan detalles  ",
      retrievalSteps: [{ id: "r1", label: "Buscar", status: "complete" }],
      steps: [{ title: "Buscar", status: "complete" }],
      ui_components: [" executive_summary ", "executive_summary", ""],
    });

    expect(message).toMatchObject({
      id: "assistant-1",
      role: "assistant",
      content: "Respuesta vacia",
      timestamp,
      requestId: "req_123",
      userMessageId: "user_456",
      totalSearches: 3,
      followUpSuggestions: ["Convierte esto en pasos concretos"],
      confidence: "medium",
      uncertaintyReason: "faltan detalles",
      ui_components: ["executive_summary"],
    });
  });

  it("builds assistant metadata from the same canonical payload", () => {
    const message = buildAssistantMessage({
      content: "Respuesta con fuentes",
      webSources: [{ url: "https://example.com" }],
      searchQueries: [{ query: "langchain" }],
      totalSearches: 2,
      followUpSuggestions: ["Compara las fuentes clave"],
      confidence: "high",
      uncertaintyReason: "Sin riesgo",
      retrievalSteps: [{ id: "step-1", label: "Buscar", status: "complete" }],
      steps: [{ title: "Buscar", status: "complete" }],
      artifact: { artifactId: "artifact-1" },
    });

    expect(buildAssistantMessageMetadata(message)).toEqual({
      artifact: { artifactId: "artifact-1" },
      webSources: [{ url: "https://example.com" }],
      searchQueries: [{ query: "langchain" }],
      totalSearches: 2,
      followUpSuggestions: ["Compara las fuentes clave"],
      confidence: "high",
      uncertaintyReason: "Sin riesgo",
      retrievalSteps: [{ id: "step-1", label: "Buscar", status: "complete" }],
      steps: [{ title: "Buscar", status: "complete" }],
    });
  });
});
