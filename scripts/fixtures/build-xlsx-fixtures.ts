/**
 * Deterministic XLSX fixture generator for the Office Engine XLSX test suite.
 *
 * Run with: `npm run build:xlsx-fixtures`
 *
 * Produces every fixture under `test_fixtures/xlsx/`. Most fixtures are
 * built with `exceljs`; the namespace / content-types stress fixture is
 * hand-crafted XML packed with JSZip.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";

const FIXTURES_DIR = path.resolve(process.cwd(), "test_fixtures", "xlsx");

async function ensureDir(): Promise<void> {
  await fs.mkdir(FIXTURES_DIR, { recursive: true });
}

async function writeXlsx(name: string, wb: ExcelJS.Workbook): Promise<void> {
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  const nodeBuf = Buffer.from(buf);
  await fs.writeFile(path.join(FIXTURES_DIR, name), nodeBuf);
  // eslint-disable-next-line no-console
  console.log(`✓ ${name} (${nodeBuf.length} bytes)`);
}

async function writeRawXlsx(
  name: string,
  contentTypes: string,
  workbookXml: string,
  sheets: Record<string, string>,
  rels: { workbookRels: string; packageRels?: string },
  extras: Record<string, string> = {},
): Promise<void> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file(
    "_rels/.rels",
    rels.packageRels ??
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  );
  zip.file("xl/workbook.xml", workbookXml);
  zip.file("xl/_rels/workbook.xml.rels", rels.workbookRels);
  for (const [sheetPath, xml] of Object.entries(sheets)) {
    zip.file(sheetPath, xml);
  }
  for (const [p, content] of Object.entries(extras)) {
    zip.file(p, content);
  }
  const buf = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  await fs.writeFile(path.join(FIXTURES_DIR, name), buf);
  // eslint-disable-next-line no-console
  console.log(`✓ ${name} (${buf.length} bytes, raw)`);
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

async function buildSimple() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Sheet1");
  sheet.getCell("A1").value = "Hola";
  sheet.getCell("B1").value = "Mundo";
  sheet.getCell("A2").value = 1;
  sheet.getCell("B2").value = 2;
  await writeXlsx("simple.xlsx", wb);
}

async function buildMultiSheet() {
  const wb = new ExcelJS.Workbook();
  const s1 = wb.addWorksheet("Data");
  s1.addRow(["name", "score"]);
  s1.addRow(["Alice", 92]);
  s1.addRow(["Bob", 85]);
  const s2 = wb.addWorksheet("Summary");
  s2.getCell("A1").value = "Total";
  s2.getCell("B1").value = { formula: "SUM(Data!B2:B3)", result: 177 };
  const s3 = wb.addWorksheet("Notes");
  s3.getCell("A1").value = "Prepared for the Office Engine slice";
  await writeXlsx("multi-sheet.xlsx", wb);
}

async function buildMergedCells() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Merged");
  sheet.getCell("A1").value = "Header span";
  sheet.mergeCells("A1:C1");
  sheet.getCell("A2").value = "r";
  sheet.getCell("B2").value = "o";
  sheet.getCell("C2").value = "w";
  sheet.mergeCells("A3:A5"); // vertical merge
  sheet.getCell("A3").value = "v-merge";
  await writeXlsx("merged-cells.xlsx", wb);
}

async function buildFormulas() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Calc");
  sheet.getCell("A1").value = 10;
  sheet.getCell("A2").value = 20;
  sheet.getCell("A3").value = 30;
  sheet.getCell("B1").value = { formula: "SUM(A1:A3)", result: 60 };
  sheet.getCell("B2").value = { formula: "AVERAGE(A1:A3)", result: 20 };
  sheet.getCell("B3").value = { formula: "MAX(A1:A3)", result: 30 };
  await writeXlsx("formulas.xlsx", wb);
}

async function buildNumberFormats() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Formats");
  sheet.getCell("A1").value = 1234.567;
  sheet.getCell("A1").numFmt = "#,##0.00";
  sheet.getCell("A2").value = 0.1567;
  sheet.getCell("A2").numFmt = "0.00%";
  sheet.getCell("A3").value = new Date("2026-01-15");
  sheet.getCell("A3").numFmt = "yyyy-mm-dd";
  sheet.getCell("A4").value = 9999.99;
  sheet.getCell("A4").numFmt = "$#,##0.00";
  await writeXlsx("number-formats.xlsx", wb);
}

async function buildNamedRanges() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Data");
  sheet.getCell("A1").value = 100;
  sheet.getCell("A2").value = 200;
  sheet.getCell("A3").value = 300;
  sheet.getCell("B1").value = { formula: "SUM(Totals)", result: 600 };
  wb.definedNames.add("Data!$A$1:$A$3", "Totals");
  await writeXlsx("named-ranges.xlsx", wb);
}

async function buildStructuredTable() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("TableSheet");
  sheet.addTable({
    name: "Products",
    ref: "A1",
    headerRow: true,
    columns: [
      { name: "SKU" },
      { name: "Name" },
      { name: "Price" },
    ],
    rows: [
      ["A001", "Widget", 9.99],
      ["A002", "Gadget", 14.99],
      ["A003", "Gizmo", 4.99],
    ],
  });
  await writeXlsx("structured-table.xlsx", wb);
}

async function buildHyperlinks() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Links");
  sheet.getCell("A1").value = {
    text: "ILIAGPT",
    hyperlink: "https://iliagpt.io",
  };
  sheet.getCell("A2").value = {
    text: "Anchor to B5",
    hyperlink: "#Sheet1!B5",
  };
  await writeXlsx("hyperlinks.xlsx", wb);
}

async function buildUnicode() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Unicode");
  sheet.getCell("A1").value = "áéíóúñü";
  sheet.getCell("A2").value = "漢字テスト";
  sheet.getCell("A3").value = "🚀 rocket";
  sheet.getCell("A4").value = "Ω≈ç√∫˜µ≤≥÷";
  await writeXlsx("unicode.xlsx", wb);
}

async function buildPlaceholderTemplate() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Template");
  sheet.getCell("A1").value = "Report for {{name}}";
  sheet.getCell("A2").value = "Date: {{date}}";
  sheet.getCell("A3").value = "Total: {{total}}";
  await writeXlsx("placeholder-template.xlsx", wb);
}

async function buildStyles() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Styled");
  const header = sheet.getCell("A1");
  header.value = "Header";
  header.font = { name: "Calibri", size: 14, bold: true, color: { argb: "FF0000FF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
  header.alignment = { horizontal: "center", vertical: "middle" };
  header.border = { top: { style: "thin" }, bottom: { style: "thin" } };
  sheet.getCell("A2").value = "Body";
  sheet.getCell("A2").font = { italic: true };
  await writeXlsx("styles.xlsx", wb);
}

async function buildLargeWorkbook() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Large");
  sheet.addRow(["id", "name", "value", "note"]);
  for (let i = 1; i <= 500; i++) {
    sheet.addRow([i, `row-${i}`, i * 3.14, `value-${i}-lorem-ipsum-dolor`]);
  }
  await writeXlsx("large-500-rows.xlsx", wb);
}

async function buildComments() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("WithComments");
  sheet.getCell("A1").value = "Cell with comment";
  sheet.getCell("A1").note = "This is a cell note from the Office Engine test suite.";
  sheet.getCell("B1").value = "Another";
  sheet.getCell("B1").note = "Second note.";
  await writeXlsx("comments.xlsx", wb);
}

async function buildFallbackTrigger() {
  // An XLSX whose workbook contains a malformed {{placeholder that would
  // confuse docxtemplater-like naive edits. The level-2 XLSX editor handles
  // it cleanly because it never tries to interpret mustache syntax.
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Sheet1");
  sheet.getCell("A1").value = "Texto con placeholder roto: {{unclosed name";
  sheet.getCell("A2").value = "Más texto normal";
  await writeXlsx("fallback-trigger.xlsx", wb);
}

async function buildXmlSpacePreserve() {
  // Exceljs doesn't expose xml:space="preserve" control directly; we
  // hand-craft the sheet XML with leading/trailing whitespace in an
  // inline string.
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
  const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t xml:space="preserve">  leading and trailing  </t></is></c>
      <c r="B1" t="inlineStr"><is><t xml:space="preserve">tab\there</t></is></c>
    </row>
  </sheetData>
</worksheet>`;
  await writeRawXlsx(
    "xml-space-preserve.xlsx",
    contentTypes,
    workbookXml,
    { "xl/worksheets/sheet1.xml": sheet1 },
    { workbookRels },
  );
}

async function buildNamespaceStress() {
  // Workbook with multiple extra namespaces declared on the root.
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"
  xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision"
  mc:Ignorable="x15 xr">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
  const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>hello</t></is></c></row>
  </sheetData>
</worksheet>`;
  await writeRawXlsx(
    "namespace-stress.xlsx",
    contentTypes,
    workbookXml,
    { "xl/worksheets/sheet1.xml": sheet1 },
    { workbookRels },
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await ensureDir();
  await Promise.all([
    buildSimple(),
    buildMultiSheet(),
    buildMergedCells(),
    buildFormulas(),
    buildNumberFormats(),
    buildNamedRanges(),
    buildStructuredTable(),
    buildHyperlinks(),
    buildUnicode(),
    buildPlaceholderTemplate(),
    buildStyles(),
    buildLargeWorkbook(),
    buildComments(),
    buildFallbackTrigger(),
    buildXmlSpacePreserve(),
    buildNamespaceStress(),
  ]);
  // eslint-disable-next-line no-console
  console.log(`\nAll XLSX fixtures written to ${FIXTURES_DIR}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fixture build failed:", err);
  process.exit(1);
});
