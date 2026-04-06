import { describe, expect, it } from "vitest";
import type { IntentResult } from "../services/intentRouter";
import { getDeliverables } from "../services/productionHandler";

function makeIntentResult(overrides: Partial<IntentResult> = {}): IntentResult {
  return {
    intent: "CREATE_DOCUMENT",
    output_format: null,
    slots: {},
    confidence: 0.9,
    normalized_text: "crear documento",
    ...overrides,
  };
}

describe("productionHandler.getDeliverables", () => {
  it("adds pdf when the intent router resolved pdf as output format", () => {
    const result = getDeliverables(
      makeIntentResult({
        intent: "CREATE_PRESENTATION",
        output_format: "pdf",
      }),
      "Crea una presentación ejecutiva y expórtala en PDF",
    );

    expect(result).toEqual(["ppt", "pdf"]);
  });

  it("adds pdf when the user explicitly mentions pdf in the message", () => {
    const result = getDeliverables(
      makeIntentResult({
        intent: "CREATE_SPREADSHEET",
        output_format: "xlsx",
      }),
      "Hazme un excel con ventas y también un pdf",
    );

    expect(result).toEqual(["excel", "pdf"]);
  });

  it("keeps word output for standard document requests", () => {
    const result = getDeliverables(
      makeIntentResult({
        intent: "CREATE_DOCUMENT",
        output_format: "docx",
      }),
      "Redacta un documento word con el resumen del proyecto",
    );

    expect(result).toEqual(["word"]);
  });
});
