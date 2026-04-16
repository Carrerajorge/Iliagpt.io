import { describe, expect, it } from "vitest";

import {
  buildFollowUpSuggestions,
  normalizeFollowUpSuggestions,
} from "@shared/followUpSuggestions";

describe("followUpSuggestions", () => {
  it("normalizes, deduplicates, and limits provided suggestions", () => {
    expect(
      normalizeFollowUpSuggestions([
        "  1. Compara las fuentes clave  ",
        "Compara las fuentes clave",
        "",
        "Dame una recomendacion accionable",
        "Resume riesgos y limites",
        "Verifica si hubo cambios recientes",
        "Extra",
      ]),
    ).toEqual([
      "Compara las fuentes clave",
      "Dame una recomendacion accionable",
      "Resume riesgos y limites",
      "Verifica si hubo cambios recientes",
    ]);
  });

  it("returns code-oriented follow ups when the answer contains code", () => {
    const suggestions = buildFollowUpSuggestions({
      assistantContent: "```ts\nconst result = await runTask();\n```",
      userMessage: "Arregla este bug",
    });

    expect(suggestions).toContain("Anade pruebas para este cambio");
    expect(suggestions).toContain("Dime como validarlo paso a paso");
  });

  it("returns research-oriented follow ups when web sources are present", () => {
    const suggestions = buildFollowUpSuggestions({
      assistantContent: "Segun las fuentes revisadas, esta es la mejor opcion.",
      userMessage: "Investiga alternativas",
      hasWebSources: true,
    });

    expect(suggestions).toEqual([
      "Compara las fuentes clave",
      "Resume riesgos y limites de esta informacion",
      "Dame una recomendacion accionable",
      "Verifica si hubo cambios recientes",
    ]);
  });
});
