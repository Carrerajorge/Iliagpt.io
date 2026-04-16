import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';

const LARGE_FIXTURE_PATH = path.join(process.cwd(), 'test_fixtures', 'large-10k-rows.xlsx');
const ROW_COUNT = 10000;
const CI_BUDGET_MULTIPLIER = process.env.CI ? 2 : 1;
const PERF_BUDGET_MS = {
  parse: Math.ceil(30_000 * CI_BUDGET_MULTIPLIER),
  preview: Math.ceil(5_000 * CI_BUDGET_MULTIPLIER),
};
const MEM_BUDGET_MB = process.env.CI ? 650 : 500;

describe('Stress Test - Large Excel File Processing', () => {
  const startTime = Date.now();

  beforeAll(async () => {
    if (fs.existsSync(LARGE_FIXTURE_PATH)) return;

    fs.mkdirSync(path.dirname(LARGE_FIXTURE_PATH), { recursive: true });

    const workbook = new ExcelJS.Workbook();

    const salesSheet = workbook.addWorksheet('SalesData');
    const headers = ['ID', 'Date', 'Product', 'Category', 'Quantity', 'UnitPrice', 'Total', 'Region', 'SalesRep'];
    salesSheet.addRow(headers);

    for (let id = 1; id <= ROW_COUNT; id++) {
      const quantity = (id % 10) + 1;
      const unitPrice = 9.99 + (id % 20);
      const total = Math.round(quantity * unitPrice * 100) / 100;
      salesSheet.addRow([
        id,
        new Date(2026, 0, 1 + (id % 28)),
        `Product-${id % 100}`,
        `Category-${id % 10}`,
        quantity,
        unitPrice,
        total,
        `Region-${id % 5}`,
        `Rep-${id % 25}`,
      ]);
    }

    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.addRow(['Metric', 'Value']);
    summarySheet.addRow(['Total Rows', String(ROW_COUNT)]);
    summarySheet.addRow(['Generated At', new Date().toISOString()]);

    await workbook.xlsx.writeFile(LARGE_FIXTURE_PATH);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have the large fixture file available', () => {
    expect(fs.existsSync(LARGE_FIXTURE_PATH)).toBe(true);
    const stats = fs.statSync(LARGE_FIXTURE_PATH);
    expect(stats.size).toBeGreaterThan(100000); // At least 100KB
  });

  it('should parse 10k row Excel file within timeout', async () => {
    const parseStart = Date.now();
    
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(LARGE_FIXTURE_PATH);
    
    const parseTime = Date.now() - parseStart;
    console.log(`Parse time for ${ROW_COUNT} rows: ${parseTime}ms`);
    
    expect(parseTime).toBeLessThan(PERF_BUDGET_MS.parse); // Should parse within CI-safe budget
    expect(workbook.worksheets.length).toBeGreaterThanOrEqual(2);
  });

  it('should correctly count rows in SalesData sheet', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(LARGE_FIXTURE_PATH);
    
    const salesSheet = workbook.getWorksheet('SalesData');
    expect(salesSheet).toBeDefined();
    
    // ExcelJS counts header + data rows
    expect(salesSheet!.rowCount).toBe(ROW_COUNT + 1);
  });

  it('should correctly read column headers', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(LARGE_FIXTURE_PATH);
    
    const salesSheet = workbook.getWorksheet('SalesData');
    const headerRow = salesSheet!.getRow(1);
    
    const expectedHeaders = ['ID', 'Date', 'Product', 'Category', 'Quantity', 'UnitPrice', 'Total', 'Region', 'SalesRep'];
    
    for (let i = 0; i < expectedHeaders.length; i++) {
      expect(headerRow.getCell(i + 1).value).toBe(expectedHeaders[i]);
    }
  });

  it('should support virtualized row access (random access pattern)', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(LARGE_FIXTURE_PATH);
    
    const salesSheet = workbook.getWorksheet('SalesData');
    
    // Simulate virtualization: access random rows
    const randomIndices = [100, 5000, 9999, 1, 7500, 2500];
    
    for (const idx of randomIndices) {
      const row = salesSheet!.getRow(idx + 1); // +1 for header
      expect(row.getCell(1).value).toBe(idx); // ID should match row number
    }
  });

  it('should extract preview data (first N rows) efficiently', async () => {
    const previewStart = Date.now();
    const PREVIEW_SIZE = 100;
    
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(LARGE_FIXTURE_PATH);
    
    const salesSheet = workbook.getWorksheet('SalesData');
    
    const headers: string[] = [];
    const headerRow = salesSheet!.getRow(1);
    headerRow.eachCell((cell, colNum) => {
      headers.push(String(cell.value || ''));
    });
    
    const previewRows: any[][] = [];
    for (let i = 2; i <= Math.min(PREVIEW_SIZE + 1, salesSheet!.rowCount); i++) {
      const row = salesSheet!.getRow(i);
      const rowData: any[] = [];
      row.eachCell((cell, colNum) => {
        rowData[colNum - 1] = cell.value;
      });
      previewRows.push(rowData);
    }
    
    const previewTime = Date.now() - previewStart;
    console.log(`Preview extraction time (${PREVIEW_SIZE} rows): ${previewTime}ms`);
    
    expect(previewTime).toBeLessThan(PERF_BUDGET_MS.preview); // Preview extraction budget
    expect(headers.length).toBe(9);
    expect(previewRows.length).toBe(PREVIEW_SIZE);
  });

  it('should simulate polling progress updates correctly', async () => {
    const TOTAL_SHEETS = 2;
    const progressUpdates: { currentSheet: number; status: string }[] = [];
    
    // Simulate polling during analysis
    for (let sheet = 1; sheet <= TOTAL_SHEETS; sheet++) {
      // Simulate "running" state for each sheet
      progressUpdates.push({ currentSheet: sheet, status: 'running' });
      
      // Simulate processing delay (mocked)
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Simulate "done" state
      progressUpdates.push({ currentSheet: sheet, status: 'done' });
    }
    
    // Verify state transitions
    expect(progressUpdates.length).toBe(TOTAL_SHEETS * 2);
    expect(progressUpdates[progressUpdates.length - 1].status).toBe('done');
  });

  it('should handle memory efficiently for large datasets', async () => {
    const memBefore = process.memoryUsage().heapUsed;
    
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(LARGE_FIXTURE_PATH);
    
    const memAfter = process.memoryUsage().heapUsed;
    const memDelta = (memAfter - memBefore) / 1024 / 1024; // MB
    
    console.log(`Memory usage for ${ROW_COUNT} rows: ${memDelta.toFixed(2)} MB`);
    
    // Should use less than 500MB for 10k rows
    expect(memDelta).toBeLessThan(MEM_BUDGET_MB);
  });

  it('should generate correct summary metrics format', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(LARGE_FIXTURE_PATH);
    
    const summarySheet = workbook.getWorksheet('Summary');
    expect(summarySheet).toBeDefined();
    
    // Verify summary format matches expected output structure
    const metrics: { label: string; value: string }[] = [];
    
    summarySheet!.eachRow((row, rowNum) => {
      if (rowNum > 1) { // Skip header
        metrics.push({
          label: String(row.getCell(1).value || ''),
          value: String(row.getCell(2).value || ''),
        });
      }
    });
    
    expect(metrics.length).toBeGreaterThan(0);
    expect(metrics[0]).toHaveProperty('label');
    expect(metrics[0]).toHaveProperty('value');
    expect(metrics.find(m => m.label === 'Total Rows')?.value).toBe(String(ROW_COUNT));
  });

  afterEach(() => {
    const elapsed = Date.now() - startTime;
    console.log(`Total elapsed time: ${elapsed}ms`);
  });
});
