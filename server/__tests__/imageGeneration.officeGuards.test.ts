import { describe, expect, it } from "vitest";
import { detectImageRequest } from "../services/imageGeneration";

describe("imageGeneration office guards", () => {
  it("does not classify office document requests as image generation", () => {
    expect(
      detectImageRequest("crea un Word y un Excel profesionales con estudio de mercado para una startup fintech"),
    ).toBe(false);

    expect(
      detectImageRequest("crea un Word ejecutivo con análisis de competencia para una startup de logística last mile"),
    ).toBe(false);

    expect(
      detectImageRequest("crea un ppt profesional para directorio con estudio de mercado de una empresa de seguros digitales"),
    ).toBe(false);

    expect(
      detectImageRequest("crea un pdf ejecutivo con resumen de resultados comerciales"),
    ).toBe(false);
  });

  it("still classifies explicit image prompts correctly", () => {
    expect(detectImageRequest("genera una imagen de una oficina futurista")).toBe(true);
    expect(detectImageRequest("crea un logo minimalista para una fintech")).toBe(true);
    expect(detectImageRequest("create art for a sci-fi poster")).toBe(true);
  });
});
