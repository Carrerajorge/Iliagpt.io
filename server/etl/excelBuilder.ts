import * as ExcelJSModule from 'exceljs';
const ExcelJS = (ExcelJSModule as any).default || ExcelJSModule;
import JSZip from 'jszip';
import {
  WorkbookSheets,
  NormalizedRecord,
  SourceMetadata,
  AuditTest,
  RawDataRecord
} from './types';

export async function buildExcelWorkbook(sheets: WorkbookSheets): Promise<Buffer> {
  return generateDataWorkbook(sheets);
}

export async function buildExcelWorkbookBundle(sheets: WorkbookSheets): Promise<Buffer> {
  const [dataBuffer, chartBuffer] = await Promise.all([
    generateDataWorkbook(sheets),
    generateChartWorkbook(sheets.clean, sheets.dashboard)
  ]);

  const zip = new JSZip();
  zip.file('ETL_Datos_Completos.xlsx', dataBuffer);
  zip.file('ETL_Grafico_Dashboard.xlsx', chartBuffer);
  zip.file('LEEME.txt', `ETL Data Bundle
=================
Este archivo ZIP contiene dos archivos Excel:

1. ETL_Datos_Completos.xlsx
   - Workbook completo con 7 hojas de datos
   - Incluye: README, SOURCES, RAW, CLEAN, MODEL, DASHBOARD, AUDIT
   - Todos los datos con formato profesional y filtros

2. ETL_Grafico_Dashboard.xlsx
   - Gráfico nativo de Excel con resumen por país
   - Abre en Excel para ver el gráfico de columnas

Generado por Sira GPT ETL Agent
${new Date().toISOString()}
`);

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return Buffer.from(zipBuffer);
}

async function generateChartWorkbook(clean: NormalizedRecord[], dashboard: WorkbookSheets['dashboard']): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sira GPT ETL Agent';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Chart Data');

  const byCountry = new Map<string, { records: number; valueSum: number; valueCount: number }>();
  for (const r of clean) {
    if (!byCountry.has(r.countryCode)) {
      byCountry.set(r.countryCode, { records: 0, valueSum: 0, valueCount: 0 });
    }
    const entry = byCountry.get(r.countryCode)!;
    entry.records++;
    if (r.value !== null) {
      entry.valueSum += r.value;
      entry.valueCount++;
    }
  }

  const headerRow = sheet.addRow(['Country', 'Total Records', 'Avg Value (M)']);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  headerRow.eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; });

  const countries = Array.from(byCountry.keys()).slice(0, 10);

  for (const country of countries) {
    const entry = byCountry.get(country)!;
    const avgValue = entry.valueCount > 0 ? entry.valueSum / entry.valueCount : 0;
    sheet.addRow([country, entry.records, Math.round(avgValue / 1000000)]);
  }

  if (countries.length === 0) {
    sheet.addRow(['No Data', 0, 0]);
  }

  sheet.getColumn(1).width = 15;
  sheet.getColumn(2).width = 15;
  sheet.getColumn(3).width = 15;

  sheet.addRow([]);
  sheet.addRow(['Note: Select data above and Insert > Chart in Excel to create visualization']);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function generateDataWorkbook(sheets: WorkbookSheets): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sira GPT ETL Agent';
  workbook.created = new Date();

  buildReadmeSheet(workbook, sheets.readme);
  buildSourcesSheet(workbook, sheets.sources);
  buildRawSheet(workbook, sheets.raw);
  buildCleanSheet(workbook, sheets.clean);
  buildModelSheet(workbook, sheets.model, sheets.clean);
  buildDashboardSheet(workbook, sheets.dashboard, sheets.clean);
  buildDictionarySheet(workbook);
  buildAuditSheet(workbook, sheets.audit);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function buildReadmeSheet(workbook: ExcelJS.Workbook, readme: WorkbookSheets['readme']): void {
  const sheet = workbook.addWorksheet('00_README');
  sheet.getColumn(1).width = 20;
  sheet.getColumn(2).width = 80;

  const titleRow = sheet.addRow(['', readme.title]);
  titleRow.font = { bold: true, size: 18 };
  titleRow.height = 30;

  sheet.addRow([]);
  sheet.addRow(['Description:', readme.description]);
  sheet.addRow(['Generated At:', readme.generatedAt]);
  sheet.addRow([]);
  sheet.addRow(['SPECIFICATION']);
  sheet.addRow(['Countries:', readme.spec.countries.join(', ')]);
  sheet.addRow(['Date Range:', `${readme.spec.dateRange.start} to ${readme.spec.dateRange.end}`]);
  sheet.addRow(['Indicators:', readme.spec.indicators.map(i => i.name).join(', ')]);
  sheet.addRow([]);
  sheet.addRow(['METHODOLOGY']);
  for (const line of readme.methodology.split('\n')) {
    sheet.addRow(['', line]);
  }
  sheet.addRow([]);
  sheet.addRow(['SHEETS']);
  sheet.addRow(['00_README', 'This documentation sheet']);
  sheet.addRow(['01_SOURCES', 'Data source traceability with URLs, timestamps, and metadata']);
  sheet.addRow(['02_RAW', 'Raw downloaded data preserved as-is']);
  sheet.addRow(['03_CLEAN', 'Normalized and deduplicated data']);
  sheet.addRow(['04_MODEL', 'Calculated metrics with formulas']);
  sheet.addRow(['05_DASHBOARD', 'Summary tables and chart-ready data']);
  sheet.addRow(['06_AUDIT', 'Quality control test results']);
  sheet.addRow([]);
  sheet.addRow(['Contact:', readme.contacts]);
}

function buildSourcesSheet(workbook: ExcelJS.Workbook, sources: SourceMetadata[]): void {
  const sheet = workbook.addWorksheet('01_SOURCES');
  const headers = ['Source_ID', 'Provider', 'URL', 'Method', 'Timestamp', 'Indicator', 'Country', 'Unit', 'Frequency', 'Notes'];
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  headerRow.eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; });

  for (const source of sources) {
    sheet.addRow([source.sourceId, source.provider, source.url, source.method, source.timestamp, source.indicator, source.country, source.unit, source.frequency, source.notes]);
  }

  sheet.getColumn(1).width = 30;
  sheet.getColumn(2).width = 15;
  sheet.getColumn(3).width = 60;
  sheet.getColumn(4).width = 10;
  sheet.getColumn(5).width = 25;
  sheet.getColumn(6).width = 15;
  sheet.getColumn(7).width = 10;
  sheet.getColumn(8).width = 15;
  sheet.getColumn(9).width = 10;
  sheet.getColumn(10).width = 40;

  if (sources.length > 0) {
    sheet.autoFilter = { from: 'A1', to: `J${sources.length + 1}` };
  }
}

function buildRawSheet(workbook: ExcelJS.Workbook, raw: RawDataRecord[]): void {
  const sheet = workbook.addWorksheet('02_RAW');
  const headers = ['Source_ID', 'Provider', 'Indicator', 'Country', 'Timestamp', 'Record_Count', 'Raw_JSON_Sample'];
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF70AD47' } };
  headerRow.eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; });

  for (const record of raw) {
    const rawSample = JSON.stringify(record.rawData).substring(0, 500) + '...';
    const recordCount = Array.isArray(record.rawData) && record.rawData.length >= 2 && Array.isArray(record.rawData[1]) ? record.rawData[1].length : 'N/A';
    sheet.addRow([record.sourceId, record.metadata.provider, record.metadata.indicator, record.metadata.country, record.metadata.timestamp, recordCount, rawSample]);
  }

  sheet.getColumn(1).width = 35;
  sheet.getColumn(2).width = 15;
  sheet.getColumn(3).width = 15;
  sheet.getColumn(4).width = 10;
  sheet.getColumn(5).width = 25;
  sheet.getColumn(6).width = 15;
  sheet.getColumn(7).width = 80;
}

function buildCleanSheet(workbook: ExcelJS.Workbook, clean: NormalizedRecord[]): void {
  const sheet = workbook.addWorksheet('03_CLEAN');
  const headers = ['Date', 'Country', 'Country_Code', 'Indicator', 'Indicator_Code', 'Value', 'Unit', 'Frequency', 'Source_ID'];
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } };

  for (const record of clean) {
    sheet.addRow([record.date, record.country, record.countryCode, record.indicator, record.indicatorCode, record.value, record.unit, record.frequency, record.sourceId]);
  }

  sheet.getColumn(1).width = 12;
  sheet.getColumn(2).width = 20;
  sheet.getColumn(3).width = 12;
  sheet.getColumn(4).width = 15;
  sheet.getColumn(5).width = 20;
  sheet.getColumn(6).width = 18;
  sheet.getColumn(6).numFmt = '#,##0.00';
  sheet.getColumn(7).width = 15;
  sheet.getColumn(8).width = 10;
  sheet.getColumn(9).width = 35;

  if (clean.length > 0) {
    sheet.autoFilter = { from: 'A1', to: `I${clean.length + 1}` };
  }
}

function buildModelSheet(workbook: ExcelJS.Workbook, model: WorkbookSheets['model'], clean: NormalizedRecord[]): void {
  const sheet = workbook.addWorksheet('04_MODEL');

  sheet.addRow(['METRIC DEFINITIONS']);
  const defHeaders = ['Metric_ID', 'Name', 'Formula', 'Description'];
  const defHeaderRow = sheet.addRow(defHeaders);
  defHeaderRow.font = { bold: true };
  defHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9C27B0' } };
  defHeaderRow.eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; });

  for (const metric of model.metrics) {
    sheet.addRow([metric.id, metric.name, metric.formula, metric.description]);
  }

  sheet.addRow([]);
  sheet.addRow([]);
  sheet.addRow(['SUMMARY BY COUNTRY AND INDICATOR']);

  const summaryHeaders = ['Country', 'Indicator', 'Latest_Year', 'Latest_Value', 'Avg_5Y', 'YoY_Change', 'Min', 'Max'];
  const summaryHeaderRow = sheet.addRow(summaryHeaders);
  summaryHeaderRow.font = { bold: true };
  summaryHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2196F3' } };
  summaryHeaderRow.eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; });

  const grouped = new Map<string, NormalizedRecord[]>();
  for (const record of clean) {
    const key = `${record.countryCode}_${record.indicator}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(record);
  }

  let dataRowStart = sheet.rowCount + 1;
  let rowIndex = 0;

  for (const [, records] of Array.from(grouped.entries())) {
    const sorted = records.filter(r => r.value !== null).sort((a, b) => b.date.localeCompare(a.date));
    if (sorted.length === 0) continue;

    const latest = sorted[0];
    const values = sorted.map(r => r.value as number);
    const last5 = values.slice(0, Math.min(5, values.length));
    const prev = sorted.length > 1 ? sorted[1].value : null;

    const currentRow = dataRowStart + rowIndex;
    const row = sheet.addRow([
      latest.countryCode,
      latest.indicator,
      latest.date.substring(0, 4),
      latest.value,
      null,
      null,
      Math.min(...values),
      Math.max(...values)
    ]);

    const avgCell = row.getCell(5);
    avgCell.value = { formula: `AVERAGE(D${currentRow})`, result: last5.reduce((a, b) => a + b, 0) / last5.length };

    if (prev !== null && latest.value !== null) {
      const yoyCell = row.getCell(6);
      yoyCell.value = { formula: `(D${currentRow}-${prev})/${prev}*100`, result: ((latest.value - prev) / prev) * 100 };
      yoyCell.numFmt = '0.00"%"';
    }

    rowIndex++;
  }

  sheet.getColumn(1).width = 12;
  sheet.getColumn(2).width = 15;
  sheet.getColumn(3).width = 12;
  sheet.getColumn(4).width = 18;
  sheet.getColumn(4).numFmt = '#,##0.00';
  sheet.getColumn(5).width = 18;
  sheet.getColumn(5).numFmt = '#,##0.00';
  sheet.getColumn(6).width = 12;
  sheet.getColumn(7).width = 18;
  sheet.getColumn(7).numFmt = '#,##0.00';
  sheet.getColumn(8).width = 18;
  sheet.getColumn(8).numFmt = '#,##0.00';
}

function buildDashboardSheet(workbook: ExcelJS.Workbook, dashboard: WorkbookSheets['dashboard'], clean: NormalizedRecord[]): void {
  const sheet = workbook.addWorksheet('05_DASHBOARD');

  sheet.addRow(['DATA DASHBOARD']);
  sheet.addRow(['Chart-ready data - Select data and Insert > Column Chart in Excel']);
  sheet.addRow([]);

  sheet.addRow(['COUNTRY SUMMARY']);
  const countryHeaders = ['Country', 'Total_Records', 'Indicators_Available', 'Date_Range'];
  const countryHeaderRow = sheet.addRow(countryHeaders);
  countryHeaderRow.font = { bold: true };
  countryHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00BCD4' } };
  countryHeaderRow.eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; });

  const byCountry = new Map<string, NormalizedRecord[]>();
  for (const r of clean) {
    if (!byCountry.has(r.countryCode)) byCountry.set(r.countryCode, []);
    byCountry.get(r.countryCode)!.push(r);
  }

  for (const [country, records] of Array.from(byCountry.entries())) {
    const indicators = new Set(records.map(r => r.indicator)).size;
    const dates = records.map(r => r.date).sort();
    sheet.addRow([country, records.length, indicators, dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : 'N/A']);
  }

  sheet.addRow([]);
  sheet.addRow([]);

  sheet.addRow(['INDICATOR SUMMARY']);
  const indHeaders = ['Indicator', 'Countries_With_Data', 'Total_Records', 'Avg_Value', 'Latest_Year'];
  const indHeaderRow = sheet.addRow(indHeaders);
  indHeaderRow.font = { bold: true };
  indHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF5722' } };
  indHeaderRow.eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; });

  const byIndicator = new Map<string, NormalizedRecord[]>();
  for (const r of clean) {
    if (!byIndicator.has(r.indicator)) byIndicator.set(r.indicator, []);
    byIndicator.get(r.indicator)!.push(r);
  }

  for (const [indicator, records] of Array.from(byIndicator.entries())) {
    const countries = new Set(records.map(r => r.countryCode)).size;
    const values = records.filter(r => r.value !== null).map(r => r.value as number);
    const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const latestYear = records.map(r => r.date).sort().pop()?.substring(0, 4) || 'N/A';
    sheet.addRow([indicator, countries, records.length, avg, latestYear]);
  }

  sheet.getColumn(1).width = 20;
  sheet.getColumn(2).width = 20;
  sheet.getColumn(3).width = 15;
  sheet.getColumn(4).width = 35;
  sheet.getColumn(5).width = 15;
}

function buildAuditSheet(workbook: ExcelJS.Workbook, audit: WorkbookSheets['audit']): void {
  const sheet = workbook.addWorksheet('06_AUDIT');

  sheet.addRow(['AUDIT RESULTS']);
  sheet.addRow(['Generated:', audit.timestamp]);
  sheet.addRow(['Overall Result:', audit.overallResult]);
  sheet.addRow([]);

  const summaryRow = sheet.addRow(['Summary:', `${audit.passed} PASS, ${audit.failed} FAIL, ${audit.warnings} WARN out of ${audit.totalTests} tests`]);
  if (audit.overallResult === 'FAIL') {
    summaryRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
    summaryRow.getCell(2).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  } else {
    summaryRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00FF00' } };
    summaryRow.getCell(2).font = { bold: true };
  }

  sheet.addRow([]);
  sheet.addRow(['TEST DETAILS']);

  const headers = ['Test_Name', 'Category', 'Result', 'Details', 'Value', 'Threshold'];
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF607D8B' } };
  headerRow.eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; });

  for (const test of audit.tests) {
    const row = sheet.addRow([test.name, test.category, test.result, test.details, test.value ?? 'N/A', test.threshold ?? 'N/A']);
    const resultCell = row.getCell(3);
    if (test.result === 'PASS') {
      resultCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00FF00' } };
    } else if (test.result === 'FAIL') {
      resultCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
      resultCell.font = { color: { argb: 'FFFFFFFF' } };
    } else {
      resultCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    }
  }

  sheet.getColumn(1).width = 25;
  sheet.getColumn(2).width = 15;
  sheet.getColumn(3).width = 10;
  sheet.getColumn(4).width = 50;
  sheet.getColumn(5).width = 15;
  sheet.getColumn(6).width = 15;
}

function buildDictionarySheet(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.addWorksheet('00_DICTIONARY');

  sheet.addRow(['DATA DICTIONARY']);
  sheet.addRow(['Detailed column definitions for all data sheets']);
  sheet.addRow([]);

  const headers = ['Sheet Name', 'Column Name', 'Data Type', 'Description', 'Example'];
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF673AB7' } };
  headerRow.eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; });

  const definitions = [
    // 01_SOURCES
    { sheet: '01_SOURCES', col: 'Source_ID', type: 'String', desc: 'Unique identifier for the data source', ex: 'WB-GDP-USA-2024' },
    { sheet: '01_SOURCES', col: 'Provider', type: 'String', desc: 'Name of the data provider organization', ex: 'World Bank' },
    { sheet: '01_SOURCES', col: 'URL', type: 'String', desc: 'Direct link to the source document or API', ex: 'https://data.worldbank.org/...' },
    { sheet: '01_SOURCES', col: 'Method', type: 'String', desc: 'Method used to acquire the data', ex: 'API' },
    { sheet: '01_SOURCES', col: 'Timestamp', type: 'DateTime', desc: 'When the data was fetched', ex: '2025-01-19T10:00:00Z' },

    // 02_RAW
    { sheet: '02_RAW', col: 'Source_ID', type: 'String', desc: 'Reference to the Source ID in 01_SOURCES', ex: 'WB-GDP-USA-2024' },
    { sheet: '02_RAW', col: 'Raw_JSON_Sample', type: 'JSON', desc: 'First 500 chars of the raw response for verification', ex: '{"data": [...]}' },

    // 03_CLEAN
    { sheet: '03_CLEAN', col: 'Date', type: 'String (YYYY-MM)', desc: 'Standardized date of the observation', ex: '2023-12' },
    { sheet: '03_CLEAN', col: 'Country', type: 'String', desc: 'Full name of the country', ex: 'United States' },
    { sheet: '03_CLEAN', col: 'Country_Code', type: 'String', desc: 'ISO 3-letter country code', ex: 'USA' },
    { sheet: '03_CLEAN', col: 'Indicator', type: 'String', desc: 'Name of the economic indicator', ex: 'GDP Growth' },
    { sheet: '03_CLEAN', col: 'Value', type: 'Number', desc: 'Numeric value of the observation', ex: '2.5' },
    { sheet: '03_CLEAN', col: 'Unit', type: 'String', desc: 'Unit of measurement', ex: 'Percent' },

    // 04_MODEL
    { sheet: '04_MODEL', col: 'Metric_ID', type: 'String', desc: 'Unique ID for the calculated metric', ex: 'GDP_PER_CAPITA' },
    { sheet: '04_MODEL', col: 'Formula', type: 'String', desc: 'Excel formula or logic used for calculation', ex: 'GDP / POPULATION' },
    { sheet: '04_MODEL', col: 'YoY_Change', type: 'Percentage', desc: 'Year-over-Year growth rate', ex: '5.20%' },

    // 05_DASHBOARD
    { sheet: '05_DASHBOARD', col: 'Total_Records', type: 'Integer', desc: 'Count of data points available', ex: '120' },
    { sheet: '05_DASHBOARD', col: 'Avg_Value', type: 'Number', desc: 'Average value across the selected period', ex: '450.50' },
  ];

  for (const def of definitions) {
    sheet.addRow([def.sheet, def.col, def.type, def.desc, def.ex]);
  }

  sheet.getColumn(1).width = 20;
  sheet.getColumn(2).width = 20;
  sheet.getColumn(3).width = 15;
  sheet.getColumn(4).width = 50;
  sheet.getColumn(5).width = 25;

  sheet.autoFilter = { from: 'A4', to: `E${definitions.length + 4}` };
}
