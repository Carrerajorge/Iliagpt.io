import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getChatMessagesMock,
  knowledgeGraphIngestMock,
  knowledgeGraphSummaryMock,
} = vi.hoisted(() => ({
  getChatMessagesMock: vi.fn(),
  knowledgeGraphIngestMock: vi.fn().mockResolvedValue(undefined),
  knowledgeGraphSummaryMock: vi.fn().mockReturnValue("Resumen del grafo"),
}));

vi.mock("../storage", () => ({
  storage: {
    getChatMessages: getChatMessagesMock,
  },
}));

vi.mock("../services/knowledgeGraph", () => ({
  knowledgeGraph: {
    ingest: knowledgeGraphIngestMock,
    getSnapshotSummary: knowledgeGraphSummaryMock,
  },
}));

import {
  augmentWithHistoryWithDiagnostics,
  getConversationContextWithDiagnostics,
} from "../services/conversationMemory";

describe("conversationMemory", () => {
  beforeEach(() => {
    getChatMessagesMock.mockReset();
    knowledgeGraphIngestMock.mockClear();
    knowledgeGraphSummaryMock.mockClear();
    knowledgeGraphSummaryMock.mockReturnValue("Resumen del grafo");
  });

  it("returns no compression diagnostics when history fits", async () => {
    const result = await augmentWithHistoryWithDiagnostics(undefined, [
      { role: "user", content: "Hola" },
      { role: "assistant", content: "Hola, ¿en qué te ayudo?" },
    ], 200);

    expect(result.messages).toHaveLength(2);
    expect(result.diagnostics.compressionApplied).toBe(false);
    expect(result.diagnostics.originalTokens).toBe(result.diagnostics.finalTokens);
  });

  it("preserves relevant older turns when compacting history", async () => {
    getChatMessagesMock.mockResolvedValue([
      { id: "6", role: "assistant", content: "Necesito más contexto para ayudarte hoy.", createdAt: new Date("2025-01-06") },
      { id: "5", role: "user", content: "Hoy necesito revisar el presupuesto actual.", createdAt: new Date("2025-01-05") },
      { id: "4", role: "assistant", content: "Hablamos de campañas de marketing y métricas generales en otro momento.", createdAt: new Date("2025-01-04") },
      { id: "3", role: "user", content: "Quiero revisar campañas de marketing y métricas de redes.", createdAt: new Date("2025-01-03") },
      { id: "2", role: "assistant", content: "La facturación de enero quedó pendiente por dos comprobantes.", createdAt: new Date("2025-01-02") },
      { id: "1", role: "user", content: "Necesito ayuda con la facturación de enero y los comprobantes pendientes.", createdAt: new Date("2025-01-01") },
    ]);

    const result = await getConversationContextWithDiagnostics(
      "chat-1",
      [{ role: "user", content: "¿Qué pasó con la facturación de enero?" }],
      {
        maxTokens: 60,
        preserveRecentCount: 2,
        relevantHistoryCount: 2,
        relevantCandidateWindow: 6,
      },
    );

    expect(result.diagnostics.compressionApplied).toBe(true);
    expect(result.diagnostics.relevantMessagesKept).toBeGreaterThan(0);
    expect(result.messages.some((message) => message.content.includes("facturación de enero"))).toBe(true);
    expect(result.diagnostics.finalMessageCount).toBe(result.messages.length);
    expect(result.diagnostics.finalTokens).toBeLessThanOrEqual(60);
    expect(knowledgeGraphIngestMock).toHaveBeenCalled();
  });
});
