import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.fn();
const searchAllSourcesMock = vi.fn();

vi.mock("../toolRegistry", () => ({
  toolRegistry: {
    execute: executeMock,
  },
}));

vi.mock("../../openclaw/skills/skillRegistry", () => ({
  skillRegistry: {
    get: vi.fn((id: string) => ({
      id,
      status: "ready",
      source: "builtin",
    })),
  },
}));

vi.mock("../../services/unifiedAcademicSearch", () => ({
  searchAllSources: searchAllSourcesMock,
}));

import { BUNDLED_SKILL_TOOLS } from "../tools/bundledSkillTools";

const context = {
  userId: "user_test",
  chatId: "chat_test",
  runId: "run_test",
};

describe("bundledSkillTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({
      success: true,
      output: { ok: true },
      artifacts: [],
      previews: [],
      logs: [],
      metrics: { durationMs: 1 },
    });
    searchAllSourcesMock.mockResolvedValue({
      query: "crispr",
      originalQuery: "crispr",
      expandedQueries: ["crispr"],
      totalResults: 1,
      sources: { openalex: true, pubmed: true },
      results: [
        {
          title: "CRISPR editing advances",
          source: "openalex",
          year: 2025,
          url: "https://example.org/paper",
        },
      ],
      timing: 42,
      metrics: {
        query: "crispr",
        totalTime: 42,
        cacheHit: false,
        sourceTimes: { openalex: 20, pubmed: 22 },
        resultCount: 1,
        deduplicatedCount: 1,
      },
    });
  });

  it("bridges skill_generate_document into the document generator tool", async () => {
    const tool = BUNDLED_SKILL_TOOLS.find((entry) => entry.name === "skill_generate_document");
    expect(tool).toBeTruthy();

    const result = await tool!.execute(
      {
        instruction: "crea un documento word con resumen ejecutivo",
        data: {
          title: "Resumen Ejecutivo",
          content: "# Resumen\n\nContenido principal",
        },
      },
      context,
    );

    expect(executeMock).toHaveBeenCalledWith(
      "generate_document",
      {
        type: "word",
        title: "Resumen Ejecutivo",
        content: "# Resumen\n\nContenido principal",
      },
      context,
    );
    expect(result.success).toBe(true);
  });

  it("uses unified academic search for scientific article requests", async () => {
    const tool = BUNDLED_SKILL_TOOLS.find((entry) => entry.name === "skill_web_search");
    expect(tool).toBeTruthy();

    const result = await tool!.execute(
      {
        instruction: "busca artículos científicos sobre CRISPR y edición genética",
        data: { maxResults: 3 },
      },
      context,
    );

    expect(searchAllSourcesMock).toHaveBeenCalledWith(
      "busca artículos científicos sobre CRISPR y edición genética",
      expect.objectContaining({ maxResults: 3 }),
    );
    expect(executeMock).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.output.type).toBe("academic");
    expect(result.output.totalResults).toBe(1);
  });

  it("renders LaTeX/KaTeX previews for math skill requests", async () => {
    const tool = BUNDLED_SKILL_TOOLS.find((entry) => entry.name === "skill_math_render");
    expect(tool).toBeTruthy();

    const result = await tool!.execute(
      {
        instruction: "renderiza una ecuación matemática",
        data: {
          expression: "x^2 + y^2 = z^2",
          displayMode: true,
        },
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.output.markdown).toBe("$$x^2 + y^2 = z^2$$");
    expect(Array.isArray(result.previews)).toBe(true);
    expect(result.previews?.some((preview) => preview.type === "html")).toBe(true);
    expect(executeMock).not.toHaveBeenCalled();
  });
});
