import { afterEach, describe, expect, it, vi } from "vitest";

async function loadGatewayModule() {
  vi.resetModules();

  const executeMock = vi.fn();
  const searchAllSourcesMock = vi.fn();

  vi.doMock("../../lib/llmGateway", () => ({
    llmGateway: {
      streamChat: vi.fn(),
    },
  }));

  vi.doMock("../usageQuotaService", () => ({
    usageQuotaService: {
      recordOpenClawTokenUsage: vi.fn().mockResolvedValue(undefined),
    },
  }));

  vi.doMock("../../openclaw/lib/internetAccess", () => ({
    internetToolDefinitions: [],
    executeInternetTool: vi.fn(),
  }));

  vi.doMock("../../openclaw/lib/chatInternetBridge", () => ({
    gatherInternetContext: vi.fn().mockResolvedValue(null),
    buildInternetSystemPrompt: vi.fn(() => "system"),
  }));

  vi.doMock("../../openclaw/skills/skillRegistry", () => ({
    skillRegistry: {
      list: vi.fn(() => []),
    },
  }));

  vi.doMock("../../agent/toolRegistry", () => ({
    toolRegistry: {
      execute: executeMock,
    },
  }));

  vi.doMock("../unifiedAcademicSearch", () => ({
    searchAllSources: searchAllSourcesMock,
  }));

  const mod = await import("../openclawGateway");
  return { ...mod, executeMock, searchAllSourcesMock };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("resolveOpenClawDirectCapabilityResponse", () => {
  it("creates a real Excel artifact response for explicit spreadsheet requests", async () => {
    const { resolveOpenClawDirectCapabilityResponse, executeMock } = await loadGatewayModule();

    executeMock.mockResolvedValue({
      success: true,
      output: {
        filename: "excel_vacio.xlsx",
        downloadUrl: "/api/artifacts/excel_vacio.xlsx",
      },
    });

    const result = await resolveOpenClawDirectCapabilityResponse({
      message: "puedes crear un excel vacio",
      userId: "user_1",
      chatId: "main",
      runId: "run_1",
    });

    expect(executeMock).toHaveBeenCalledWith(
      "generate_document",
      {
        type: "excel",
        title: "excel_vacio",
        content: "",
      },
      {
        userId: "user_1",
        chatId: "main",
        runId: "run_1",
      },
    );
    expect(result?.kind).toBe("document");
    expect(result?.content).toContain("/api/artifacts/excel_vacio.xlsx");
  });

  it("uses academic search directly for scientific-article requests", async () => {
    const { resolveOpenClawDirectCapabilityResponse, executeMock, searchAllSourcesMock } = await loadGatewayModule();

    searchAllSourcesMock.mockResolvedValue({
      query: "busca artículos científicos sobre CRISPR",
      originalQuery: "busca artículos científicos sobre CRISPR",
      totalResults: 2,
      results: [
        {
          title: "CRISPR Editing Advances",
          authors: "Doe, Roe",
          year: "2025",
          journal: "Genome Research",
          source: "openalex",
          url: "https://example.org/crispr-paper",
        },
      ],
    });

    const result = await resolveOpenClawDirectCapabilityResponse({
      message: "busca artículos científicos sobre CRISPR",
      userId: "user_1",
      chatId: "main",
      runId: "run_2",
    });

    expect(searchAllSourcesMock).toHaveBeenCalledWith(
      "busca artículos científicos sobre CRISPR",
      expect.objectContaining({
        maxResults: 8,
        sources: ["openalex", "semantic", "crossref", "pubmed", "arxiv", "scholar"],
      }),
    );
    expect(executeMock).not.toHaveBeenCalled();
    expect(result?.kind).toBe("academic");
    expect(result?.content).toContain("CRISPR Editing Advances");
  });

  it("renders KaTeX responses for explicit math-render requests", async () => {
    const { resolveOpenClawDirectCapabilityResponse, executeMock, searchAllSourcesMock } = await loadGatewayModule();

    const result = await resolveOpenClawDirectCapabilityResponse({
      message: "renderiza en katex: x^2 + y^2 = z^2",
      userId: "user_1",
      chatId: "main",
      runId: "run_3",
    });

    expect(executeMock).not.toHaveBeenCalled();
    expect(searchAllSourcesMock).not.toHaveBeenCalled();
    expect(result?.kind).toBe("math");
    expect(result?.content).toContain("$$x^2 + y^2 = z^2$$");
  });
});
