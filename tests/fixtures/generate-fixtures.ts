import ExcelJS from "exceljs";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";

const FIXTURES_DIR = dirname(new URL(import.meta.url).pathname);

async function generateSalesDataXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PARE Test Suite";
  workbook.created = new Date();
  
  const sheet = workbook.addWorksheet("Sales");
  
  sheet.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Product", key: "product", width: 20 },
    { header: "Amount", key: "amount", width: 12 },
    { header: "Region", key: "region", width: 15 },
  ];

  const salesData = [
    { date: "2024-01-15", product: "Widget Pro", amount: 1250.00, region: "North" },
    { date: "2024-01-16", product: "Gadget X", amount: 890.50, region: "South" },
    { date: "2024-01-17", product: "Widget Pro", amount: 1450.00, region: "East" },
    { date: "2024-01-18", product: "Super Tool", amount: 2100.00, region: "West" },
    { date: "2024-01-19", product: "Gadget X", amount: 750.00, region: "North" },
    { date: "2024-01-20", product: "Widget Pro", amount: 1100.00, region: "South" },
    { date: "2024-01-21", product: "Super Tool", amount: 1800.00, region: "East" },
    { date: "2024-01-22", product: "Gadget X", amount: 920.00, region: "West" },
    { date: "2024-01-23", product: "Widget Pro", amount: 1350.00, region: "North" },
    { date: "2024-01-24", product: "Super Tool", amount: 2400.00, region: "South" },
  ];

  salesData.forEach(row => sheet.addRow(row));

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function generateMultiSheetXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PARE Test Suite";
  workbook.created = new Date();

  const salesSheet = workbook.addWorksheet("Sales");
  salesSheet.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Product", key: "product", width: 20 },
    { header: "Revenue", key: "revenue", width: 12 },
  ];
  [
    { date: "2024-Q1", product: "Widget Pro", revenue: 45000 },
    { date: "2024-Q1", product: "Gadget X", revenue: 32000 },
    { date: "2024-Q2", product: "Widget Pro", revenue: 52000 },
    { date: "2024-Q2", product: "Gadget X", revenue: 38000 },
    { date: "2024-Q3", product: "Widget Pro", revenue: 48000 },
    { date: "2024-Q3", product: "Gadget X", revenue: 35000 },
    { date: "2024-Q4", product: "Widget Pro", revenue: 61000 },
    { date: "2024-Q4", product: "Gadget X", revenue: 42000 },
  ].forEach(row => salesSheet.addRow(row));

  const expensesSheet = workbook.addWorksheet("Expenses");
  expensesSheet.columns = [
    { header: "Category", key: "category", width: 20 },
    { header: "Q1", key: "q1", width: 12 },
    { header: "Q2", key: "q2", width: 12 },
    { header: "Q3", key: "q3", width: 12 },
    { header: "Q4", key: "q4", width: 12 },
  ];
  [
    { category: "Salaries", q1: 120000, q2: 125000, q3: 128000, q4: 135000 },
    { category: "Marketing", q1: 25000, q2: 30000, q3: 28000, q4: 35000 },
    { category: "Operations", q1: 45000, q2: 48000, q3: 50000, q4: 52000 },
    { category: "R&D", q1: 60000, q2: 65000, q3: 70000, q4: 75000 },
  ].forEach(row => expensesSheet.addRow(row));

  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.columns = [
    { header: "Metric", key: "metric", width: 25 },
    { header: "Value", key: "value", width: 20 },
  ];
  [
    { metric: "Total Revenue", value: "$353,000" },
    { metric: "Total Expenses", value: "$1,091,000" },
    { metric: "Net Income", value: "-$738,000" },
    { metric: "Top Product", value: "Widget Pro" },
    { metric: "Best Quarter", value: "Q4" },
  ].forEach(row => summarySheet.addRow(row));

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function generateSimplePdf(): Buffer {
  const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj

2 0 obj
<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>
endobj

3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 7 0 R >> >> >>
endobj

4 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>
endobj

5 0 obj
<< /Length 180 >>
stream
BT
/F1 24 Tf
50 700 Td
(Q4 Revenue Report) Tj
0 -40 Td
/F1 14 Tf
(Quarterly Financial Summary) Tj
0 -30 Td
(Total Revenue: $1.2M) Tj
0 -20 Td
(Growth Rate: 15% YoY) Tj
ET
endstream
endobj

6 0 obj
<< /Length 200 >>
stream
BT
/F1 18 Tf
50 700 Td
(Page 2 - Details) Tj
0 -30 Td
/F1 12 Tf
(Revenue Breakdown:) Tj
0 -20 Td
(- Product A: $500,000) Tj
0 -20 Td
(- Product B: $400,000) Tj
0 -20 Td
(- Product C: $300,000) Tj
0 -20 Td
(Total: $1,200,000) Tj
ET
endstream
endobj

7 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj

xref
0 8
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000242 00000 n 
0000000369 00000 n 
0000000600 00000 n 
0000000851 00000 n 

trailer
<< /Size 8 /Root 1 0 R >>
startxref
928
%%EOF`;
  
  return Buffer.from(pdfContent, "utf-8");
}

function generateCorruptedPdf(): Buffer {
  return Buffer.from("NOT_A_VALID_PDF_JUST_RANDOM_BYTES_12345", "utf-8");
}

async function main() {
  console.log("Generating PARE E2E test fixtures...\n");

  if (!existsSync(FIXTURES_DIR)) {
    mkdirSync(FIXTURES_DIR, { recursive: true });
  }

  console.log("1. Generating sample-report.pdf...");
  const pdfBuffer = generateSimplePdf();
  writeFileSync(join(FIXTURES_DIR, "sample-report.pdf"), pdfBuffer);
  console.log(`   Created: sample-report.pdf (${pdfBuffer.length} bytes)`);

  console.log("2. Generating corrupted.pdf...");
  const corruptedPdf = generateCorruptedPdf();
  writeFileSync(join(FIXTURES_DIR, "corrupted.pdf"), corruptedPdf);
  console.log(`   Created: corrupted.pdf (${corruptedPdf.length} bytes)`);

  console.log("3. Generating sales-data.xlsx...");
  const salesXlsx = await generateSalesDataXlsx();
  writeFileSync(join(FIXTURES_DIR, "sales-data.xlsx"), salesXlsx);
  console.log(`   Created: sales-data.xlsx (${salesXlsx.length} bytes)`);

  console.log("4. Generating multi-sheet.xlsx...");
  const multiSheetXlsx = await generateMultiSheetXlsx();
  writeFileSync(join(FIXTURES_DIR, "multi-sheet.xlsx"), multiSheetXlsx);
  console.log(`   Created: multi-sheet.xlsx (${multiSheetXlsx.length} bytes)`);

  console.log("\nAll fixtures generated successfully!");
}

export { generateSimplePdf, generateCorruptedPdf, generateSalesDataXlsx, generateMultiSheetXlsx };

main().catch(console.error);
