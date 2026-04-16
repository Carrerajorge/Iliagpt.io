import ExcelJS from "exceljs";

export interface ExcelContent {
  sheetName: string;
  title?: string;
  headers: string[];
  rows: (string | number)[][];
  totals?: boolean;
}

const BLUE = "1F4E79";
const ALT_GRAY = "F2F2F2";
const B_SIDE = { style: "thin" as const, color: { argb: "FFCCCCCC" } };
const THIN_BORDER: Partial<ExcelJS.Borders> = { top: B_SIDE, bottom: B_SIDE, left: B_SIDE, right: B_SIDE };

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim().replace(/\s+/g, "_").slice(0, 80);
}

function detectFormat(value: string | number): { numFmt?: string; parsed: string | number } {
  if (typeof value === "number") return { numFmt: "#,##0.##", parsed: value };
  const str = String(value).trim();
  if (/^\$[\d,]+\.?\d*$/.test(str) || /^[\d,]+\.?\d*\$$/.test(str)) {
    const num = parseFloat(str.replace(/[$,]/g, ""));
    if (!isNaN(num)) return { numFmt: "$#,##0.00", parsed: num };
  }
  if (/^-?[\d,]+\.?\d*%$/.test(str)) {
    const num = parseFloat(str.replace(/[%,]/g, ""));
    if (!isNaN(num)) return { numFmt: "0.00%", parsed: num / 100 };
  }
  if (/^-?[\d,]+\.?\d+$/.test(str) && str.includes(",")) {
    const num = parseFloat(str.replace(/,/g, ""));
    if (!isNaN(num)) return { numFmt: "#,##0.##", parsed: num };
  }
  const asNum = Number(str);
  if (str !== "" && !isNaN(asNum) && isFinite(asNum)) return { numFmt: "#,##0.##", parsed: asNum };
  return { parsed: str };
}

function isNumericColumn(rows: (string | number)[][], colIdx: number): boolean {
  let numCount = 0;
  for (const row of rows) {
    if (colIdx >= row.length) continue;
    const { parsed } = detectFormat(row[colIdx]);
    if (typeof parsed === "number") numCount++;
  }
  return numCount > 0 && numCount >= rows.length * 0.5;
}

export async function generateExcel(content: ExcelContent): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
  const { sheetName, title, headers, rows, totals } = content;
  const wb = new ExcelJS.Workbook();
  wb.creator = "IliaGPT";
  wb.created = new Date();

  const ws = wb.addWorksheet(sheetName || "Data");
  let currentRow = 1;

  if (title) {
    ws.mergeCells(currentRow, 1, currentRow, Math.max(headers.length, 1));
    const titleCell = ws.getCell(currentRow, 1);
    titleCell.value = title;
    titleCell.font = { size: 16, bold: true, color: { argb: `FF${BLUE}` } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(currentRow).height = 30;
    currentRow += 2;
  }

  const headerRowNum = currentRow;
  const headerRow = ws.getRow(headerRowNum);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${BLUE}` } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = THIN_BORDER;
  });
  headerRow.height = 22;
  currentRow++;

  const colMaxLengths = headers.map((h) => h.length);

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const dataRow = ws.getRow(currentRow);
    const rowData = rows[rIdx] || [];
    for (let cIdx = 0; cIdx < headers.length; cIdx++) {
      const raw = cIdx < rowData.length ? rowData[cIdx] : "";
      const { numFmt, parsed } = detectFormat(raw);
      const cell = dataRow.getCell(cIdx + 1);
      cell.value = parsed;
      if (numFmt) {
        cell.numFmt = numFmt;
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else {
        cell.alignment = { vertical: "middle" };
      }
      cell.border = THIN_BORDER;
      cell.font = { size: 11 };
      if (rIdx % 2 === 1) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${ALT_GRAY}` } };
      }
      const len = String(raw).length;
      if (len > colMaxLengths[cIdx]) colMaxLengths[cIdx] = len;
    }
    currentRow++;
  }

  if (totals && rows.length > 0) {
    const totalsRow = ws.getRow(currentRow);
    const dataStartRow = headerRowNum + 1;
    const dataEndRow = currentRow - 1;
    for (let cIdx = 0; cIdx < headers.length; cIdx++) {
      const cell = totalsRow.getCell(cIdx + 1);
      if (isNumericColumn(rows, cIdx)) {
        const colLetter = String.fromCharCode(65 + cIdx);
        cell.value = { formula: `SUM(${colLetter}${dataStartRow}:${colLetter}${dataEndRow})` } as ExcelJS.CellFormulaValue;
        cell.numFmt = "#,##0.##";
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else if (cIdx === 0) {
        cell.value = "Total";
      }
      cell.font = { bold: true, size: 11 };
      cell.border = {
        ...THIN_BORDER,
        top: { style: "medium", color: { argb: `FF${BLUE}` } },
      };
    }
    currentRow++;
  }

  headers.forEach((_, i) => {
    ws.getColumn(i + 1).width = Math.min(Math.max(Math.round(colMaxLengths[i] * 1.2), 10), 40);
  });
  ws.views = [{ state: "frozen", ySplit: headerRowNum, xSplit: 0 }];
  if (headers.length > 0) {
    ws.autoFilter = { from: { row: headerRowNum, column: 1 }, to: { row: headerRowNum, column: headers.length } };
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const filename = `${sanitizeFilename(sheetName || title || "spreadsheet") || "spreadsheet"}.xlsx`;
  return { buffer, filename, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
}
