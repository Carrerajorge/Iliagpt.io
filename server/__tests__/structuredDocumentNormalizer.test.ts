import { describe, expect, it } from "vitest";
import { normalizeDocument } from "../services/structuredDocumentNormalizer";

describe("structuredDocumentNormalizer", () => {
  it("treats plain text documents as text instead of CSV", async () => {
    const model = await normalizeDocument(
      Buffer.from("Resumen ejecutivo\n\nLos ingresos crecieron 18% en el trimestre."),
      "resumen.txt",
    );

    expect(model.documentMeta.documentType).toBe("text");
    expect(model.documentMeta.mimeType).toBe("text/plain");
    expect(model.extractionDiagnostics.parserUsed).toBe("textExtractor");
    expect(model.tables).toHaveLength(0);
    expect(model.sections.some((section) => section.content?.includes("ingresos crecieron 18%"))).toBe(true);
  });

  it("preserves JSON attachments as text content instead of coercing them into tabular data", async () => {
    const model = await normalizeDocument(
      Buffer.from('{"summary":"ok","items":[1,2,3]}'),
      "payload.json",
    );

    expect(model.documentMeta.documentType).toBe("text");
    expect(model.extractionDiagnostics.parserUsed).toBe("textExtractor");
    expect(model.tables).toHaveLength(0);
    expect(model.sections[0]?.content).toContain('"summary": "ok"');
    expect(model.sections[0]?.content).toContain('"items": [');
  });
});
