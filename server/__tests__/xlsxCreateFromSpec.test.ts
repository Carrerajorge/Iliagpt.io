import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildSeedXlsxFromObjective } from "../lib/office/engine/xlsxCreateFromSpec";

describe("xlsxCreateFromSpec", () => {
  it("creates retention cohort workbooks without duplicate worksheet names", async () => {
    const { buffer } = await buildSeedXlsxFromObjective(
      "crea un Excel con análisis de cohortes de retención para una app de suscripción",
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const worksheetNames = workbook.worksheets.map((worksheet) => worksheet.name);

    expect(worksheetNames).toContain("Cohortes");
    expect(new Set(worksheetNames).size).toBe(worksheetNames.length);
    expect(
      worksheetNames.filter((name) => name.toLowerCase().startsWith("resumen")).length,
    ).toBeGreaterThan(0);
  });
});
