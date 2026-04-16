import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType } from 'docx';
import * as fs from 'fs';
import * as path from 'path';

const FIXTURES_DIR = 'test_fixtures';

const PRODUCTS = [
  'Laptop', 'Monitor', 'Keyboard', 'Mouse', 'Headphones',
  'Webcam', 'USB Hub', 'SSD Drive', 'RAM Module', 'Printer'
];

const DEPARTMENTS = ['Engineering', 'Sales', 'Marketing', 'HR', 'Finance'];

const EMPLOYEES = [
  { name: 'Alice Johnson', department: 'Engineering', salary: 85000 },
  { name: 'Bob Smith', department: 'Sales', salary: 72000 },
  { name: 'Carol Williams', department: 'Marketing', salary: 68000 },
  { name: 'David Brown', department: 'HR', salary: 65000 },
  { name: 'Eva Martinez', department: 'Finance', salary: 78000 }
];

const SALES_DATA = [
  { product: 'Laptop', quantity: 15, price: 999.99 },
  { product: 'Monitor', quantity: 25, price: 349.99 },
  { product: 'Keyboard', quantity: 50, price: 79.99 },
  { product: 'Mouse', quantity: 75, price: 29.99 },
  { product: 'Headphones', quantity: 30, price: 149.99 },
  { product: 'Webcam', quantity: 20, price: 89.99 },
  { product: 'USB Hub', quantity: 40, price: 39.99 },
  { product: 'SSD Drive', quantity: 35, price: 129.99 },
  { product: 'RAM Module', quantity: 45, price: 89.99 },
  { product: 'Printer', quantity: 10, price: 249.99 }
];

const CSV_PRODUCTS = [
  { id: 1, name: 'Laptop Pro 15', category: 'Electronics', price: 1299.99, stock: 45, sku: 'LP15-001' },
  { id: 2, name: 'Wireless Mouse', category: 'Accessories', price: 29.99, stock: 150, sku: 'WM-002' },
  { id: 3, name: 'Mechanical Keyboard', category: 'Accessories', price: 149.99, stock: 75, sku: 'MK-003' },
  { id: 4, name: 'USB-C Hub', category: 'Accessories', price: 49.99, stock: 200, sku: 'UCH-004' },
  { id: 5, name: '4K Monitor', category: 'Electronics', price: 449.99, stock: 30, sku: 'M4K-005' },
  { id: 6, name: 'Noise Canceling Headphones', category: 'Audio', price: 299.99, stock: 60, sku: 'NCH-006' },
  { id: 7, name: 'Webcam HD', category: 'Electronics', price: 79.99, stock: 100, sku: 'WCHD-007' },
  { id: 8, name: 'External SSD 1TB', category: 'Storage', price: 119.99, stock: 80, sku: 'SSD1T-008' },
  { id: 9, name: 'Graphics Tablet', category: 'Electronics', price: 199.99, stock: 25, sku: 'GT-009' },
  { id: 10, name: 'Desk Lamp LED', category: 'Office', price: 39.99, stock: 120, sku: 'DL-010' },
  { id: 11, name: 'Ergonomic Chair', category: 'Furniture', price: 349.99, stock: 15, sku: 'EC-011' },
  { id: 12, name: 'Standing Desk', category: 'Furniture', price: 599.99, stock: 10, sku: 'SD-012' },
  { id: 13, name: 'Monitor Arm', category: 'Accessories', price: 89.99, stock: 50, sku: 'MA-013' },
  { id: 14, name: 'Cable Management Kit', category: 'Accessories', price: 24.99, stock: 200, sku: 'CMK-014' },
  { id: 15, name: 'Wireless Charger', category: 'Accessories', price: 34.99, stock: 175, sku: 'WC-015' }
];

async function ensureDir(dir: string): Promise<void> {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const FIXED_DATE = new Date('2024-01-01T00:00:00.000Z');

async function generateExcel(): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Test Fixtures Generator';
  workbook.lastModifiedBy = 'Test Fixtures Generator';
  workbook.created = FIXED_DATE;
  workbook.modified = FIXED_DATE;
  workbook.lastPrinted = FIXED_DATE;
  workbook.company = 'Test Company';
  workbook.manager = 'Test Manager';

  const salesSheet = workbook.addWorksheet('Sales');
  salesSheet.columns = [
    { header: 'Product', key: 'product', width: 20 },
    { header: 'Quantity', key: 'quantity', width: 12 },
    { header: 'Price', key: 'price', width: 12 },
    { header: 'Total', key: 'total', width: 15 }
  ];

  SALES_DATA.forEach(row => {
    salesSheet.addRow({
      product: row.product,
      quantity: row.quantity,
      price: row.price,
      total: row.quantity * row.price
    });
  });

  salesSheet.getRow(1).font = { bold: true };
  salesSheet.getColumn('price').numFmt = '$#,##0.00';
  salesSheet.getColumn('total').numFmt = '$#,##0.00';

  const employeesSheet = workbook.addWorksheet('Employees');
  employeesSheet.columns = [
    { header: 'Name', key: 'name', width: 25 },
    { header: 'Department', key: 'department', width: 20 },
    { header: 'Salary', key: 'salary', width: 15 }
  ];

  EMPLOYEES.forEach(emp => {
    employeesSheet.addRow(emp);
  });

  employeesSheet.getRow(1).font = { bold: true };
  employeesSheet.getColumn('salary').numFmt = '$#,##0';

  const totalSales = SALES_DATA.reduce((sum, row) => sum + row.quantity * row.price, 0);
  const avgSalary = EMPLOYEES.reduce((sum, emp) => sum + emp.salary, 0) / EMPLOYEES.length;
  const totalQuantity = SALES_DATA.reduce((sum, row) => sum + row.quantity, 0);

  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Value', key: 'value', width: 20 }
  ];

  summarySheet.addRow({ metric: 'Total Sales Revenue', value: totalSales });
  summarySheet.addRow({ metric: 'Average Employee Salary', value: avgSalary });
  summarySheet.addRow({ metric: 'Total Products Sold', value: totalQuantity });
  summarySheet.addRow({ metric: 'Number of Employees', value: EMPLOYEES.length });
  summarySheet.addRow({ metric: 'Number of Products', value: SALES_DATA.length });

  summarySheet.getRow(1).font = { bold: true };

  await workbook.xlsx.writeFile(path.join(FIXTURES_DIR, 'multi-sheet.xlsx'));
  console.log('✓ Generated multi-sheet.xlsx');
}

async function generateCSV(): Promise<void> {
  const headers = ['id', 'name', 'category', 'price', 'stock', 'sku'];
  const rows = CSV_PRODUCTS.map(p => 
    [p.id, `"${p.name}"`, p.category, p.price.toFixed(2), p.stock, p.sku].join(',')
  );
  
  const csvContent = [headers.join(','), ...rows].join('\n');
  fs.writeFileSync(path.join(FIXTURES_DIR, 'data.csv'), csvContent, 'utf-8');
  console.log('✓ Generated data.csv');
}

function generateMinimalPDF(): Buffer {
  const content = `Test Report

1. Executive Summary
This document provides a comprehensive overview of the quarterly performance metrics and key business indicators.

2. Sales Analysis  
The sales department has shown consistent growth with a 15% increase in revenue compared to the previous quarter.

3. Recommendations
Based on the analysis, we recommend focusing on digital marketing initiatives and expanding the product line.

Data Table:
Product         | Units | Revenue
----------------|-------|--------
Laptop          |   15  | $14,999
Monitor         |   25  | $8,749
Keyboard        |   50  | $3,999
Mouse           |   75  | $2,249
Headphones      |   30  | $4,499
`;

  const stream = Buffer.from(content, 'utf-8');
  
  const pdfHeader = '%PDF-1.4\n';
  const objects: string[] = [];
  
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  
  const textContent = content.replace(/\n/g, ') Tj T* (');
  const streamContent = `BT /F1 12 Tf 50 750 Td 14 TL (${textContent}) Tj ET`;
  const streamLength = streamContent.length;
  
  objects.push(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`);
  objects.push(`4 0 obj\n<< /Length ${streamLength} >>\nstream\n${streamContent}\nendstream\nendobj\n`);
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
  
  let xrefOffset = pdfHeader.length;
  const xrefEntries: string[] = ['0000000000 65535 f \n'];
  
  for (let i = 0; i < objects.length; i++) {
    xrefEntries.push(`${String(xrefOffset).padStart(10, '0')} 00000 n \n`);
    xrefOffset += objects[i].length;
  }
  
  const xref = `xref\n0 ${objects.length + 1}\n${xrefEntries.join('')}`;
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  
  const pdf = pdfHeader + objects.join('') + xref + trailer;
  return Buffer.from(pdf, 'utf-8');
}

async function generatePDF(): Promise<void> {
  const pdfBuffer = generateMinimalPDF();
  fs.writeFileSync(path.join(FIXTURES_DIR, 'report.pdf'), pdfBuffer);
  console.log('✓ Generated report.pdf');
}

async function generateDocx(): Promise<void> {
  const doc = new Document({
    creator: 'Test Fixtures Generator',
    lastModifiedBy: 'Test Fixtures Generator',
    title: 'Sample Document',
    description: 'A sample document for testing purposes',
    revision: 1,
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          text: 'Sample Document Report',
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER
        }),
        new Paragraph({
          text: 'This document demonstrates the generation of structured DOCX files with various formatting elements including headings, paragraphs, and bullet points.',
          spacing: { after: 200 }
        }),
        new Paragraph({
          text: 'Section 1: Introduction',
          heading: HeadingLevel.HEADING_2
        }),
        new Paragraph({
          text: 'The purpose of this document is to serve as a test fixture for document processing systems. It contains structured content that can be used to verify parsing and rendering functionality.',
          spacing: { after: 200 }
        }),
        new Paragraph({
          text: 'Key objectives of this document:',
          spacing: { after: 100 }
        }),
        new Paragraph({
          text: 'Demonstrate proper heading hierarchy',
          bullet: { level: 0 }
        }),
        new Paragraph({
          text: 'Include formatted paragraphs with proper spacing',
          bullet: { level: 0 }
        }),
        new Paragraph({
          text: 'Showcase bullet point lists',
          bullet: { level: 0 }
        }),
        new Paragraph({
          text: 'Provide deterministic output for reproducible tests',
          bullet: { level: 0 }
        }),
        new Paragraph({
          text: 'Section 2: Technical Details',
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400 }
        }),
        new Paragraph({
          text: 'This section covers the technical aspects of the document generation process. The fixtures are created using the docx library which provides programmatic access to Word document creation.',
          spacing: { after: 200 }
        }),
        new Paragraph({
          text: 'Implementation features include:',
          spacing: { after: 100 }
        }),
        new Paragraph({
          text: 'UTF-8 encoding for international character support',
          bullet: { level: 0 }
        }),
        new Paragraph({
          text: 'Consistent styling and formatting',
          bullet: { level: 0 }
        }),
        new Paragraph({
          text: 'Reproducible output with fixed metadata',
          bullet: { level: 0 }
        }),
        new Paragraph({
          text: 'Section 3: Conclusion',
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400 }
        }),
        new Paragraph({
          text: 'This test fixture provides a reliable baseline for testing document processing capabilities. The deterministic nature of the generation ensures that tests can consistently verify expected behavior.',
          spacing: { after: 200 }
        })
      ]
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(path.join(FIXTURES_DIR, 'document.docx'), buffer);
  console.log('✓ Generated document.docx');
}

async function main(): Promise<void> {
  console.log('Generating test fixtures...\n');
  
  await ensureDir(FIXTURES_DIR);
  
  await generateExcel();
  await generateCSV();
  await generatePDF();
  await generateDocx();
  
  console.log('\n✓ All test fixtures generated successfully!');
  
  const files = fs.readdirSync(FIXTURES_DIR);
  console.log('\nGenerated files:');
  files.forEach(file => {
    const stats = fs.statSync(path.join(FIXTURES_DIR, file));
    console.log(`  - ${file} (${stats.size} bytes)`);
  });
}

main().catch(console.error);
