import { describe, expect, it } from "vitest";

import { generateSuggestions } from "./suggested-replies";

describe("generateSuggestions", () => {
  it("prioritizes server-provided follow ups when available", () => {
    expect(
      generateSuggestions("respuesta cualquiera", {
        preferred: [
          "Compara las fuentes clave",
          "Dame una recomendacion accionable",
        ],
      }),
    ).toEqual([
      "Compara las fuentes clave",
      "Dame una recomendacion accionable",
    ]);
  });

  it("falls back to contextual heuristics when no server suggestions exist", () => {
    const suggestions = generateSuggestions("```ts\nconst ready = true;\n```");

    expect(suggestions).toContain("Anade pruebas para este cambio");
    expect(suggestions).toContain("Explica la parte mas critica del codigo");
  });
});
