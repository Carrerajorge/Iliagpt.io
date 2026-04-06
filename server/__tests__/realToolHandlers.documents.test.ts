import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import { realDocumentCreate, realPdfGenerate } from "../agent/registry/realToolHandlers";

const createdFiles: string[] = [];

afterEach(() => {
  for (const file of createdFiles.splice(0)) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
});

describe("realToolHandlers document generation", () => {
  it("creates a native docx file instead of plain text", async () => {
    const result = await realDocumentCreate({
      title: "Reporte Comercial",
      content: "# Resumen\n\nVentas y margen mejoraron durante el trimestre.",
      type: "docx",
    });

    expect(result.success).toBe(true);
    expect(String(result.data.filePath)).toMatch(/\.docx$/);
    const filePath = String(result.data.filePath);
    createdFiles.push(filePath);

    const buffer = fs.readFileSync(filePath);
    expect(buffer.subarray(0, 2).toString("utf8")).toBe("PK");
  });

  it("creates a valid pdf file header through the legacy pdf handler", async () => {
    const result = await realPdfGenerate({
      title: "Reporte PDF",
      content: "# Resumen\n\nContenido del PDF de prueba.",
    });

    expect(result.success).toBe(true);
    expect(String(result.data.filePath)).toMatch(/\.pdf$/);
    const filePath = String(result.data.filePath);
    createdFiles.push(filePath);

    const buffer = fs.readFileSync(filePath);
    expect(buffer.subarray(0, 4).toString("utf8")).toBe("%PDF");
  });
});
