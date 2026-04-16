import ExcelJS from 'exceljs';
import path from 'path';

const OUTPUT_PATH = path.join(process.cwd(), 'test_fixtures', 'large-10k-rows.xlsx');
const ROW_COUNT = 10000;

async function generateLargeFixture() {
  console.log(`Generating Excel fixture with ${ROW_COUNT} rows...`);
  
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date('2024-01-01T00:00:00.000Z');
  workbook.modified = new Date('2024-01-01T00:00:00.000Z');
  
  // Sheet 1: Sales Data (10k rows)
  const salesSheet = workbook.addWorksheet('SalesData');
  salesSheet.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Product', key: 'product', width: 20 },
    { header: 'Category', key: 'category', width: 15 },
    { header: 'Quantity', key: 'quantity', width: 10 },
    { header: 'UnitPrice', key: 'unitPrice', width: 12 },
    { header: 'Total', key: 'total', width: 12 },
    { header: 'Region', key: 'region', width: 15 },
    { header: 'SalesRep', key: 'salesRep', width: 20 },
  ];

  const products = ['Widget A', 'Widget B', 'Gadget X', 'Gadget Y', 'Tool Alpha', 'Tool Beta', 'Device Pro', 'Device Lite'];
  const categories = ['Electronics', 'Hardware', 'Software', 'Services'];
  const regions = ['North', 'South', 'East', 'West', 'Central'];
  const salesReps = ['Alice Johnson', 'Bob Smith', 'Carol Williams', 'David Brown', 'Eva Martinez'];

  const startDate = new Date('2023-01-01');
  
  for (let i = 1; i <= ROW_COUNT; i++) {
    const date = new Date(startDate.getTime() + (i % 365) * 24 * 60 * 60 * 1000);
    const product = products[i % products.length];
    const category = categories[i % categories.length];
    const quantity = Math.floor(Math.random() * 100) + 1;
    const unitPrice = Math.floor(Math.random() * 500) + 10;
    
    salesSheet.addRow({
      id: i,
      date: date.toISOString().split('T')[0],
      product,
      category,
      quantity,
      unitPrice,
      total: quantity * unitPrice,
      region: regions[i % regions.length],
      salesRep: salesReps[i % salesReps.length],
    });
  }

  // Sheet 2: Summary (computed from sales data for validation)
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Value', key: 'value', width: 20 },
  ];

  summarySheet.addRows([
    { metric: 'Total Rows', value: ROW_COUNT.toString() },
    { metric: 'Date Range', value: '2023-01-01 to 2023-12-31' },
    { metric: 'Products Count', value: products.length.toString() },
    { metric: 'Categories Count', value: categories.length.toString() },
    { metric: 'Regions Count', value: regions.length.toString() },
    { metric: 'Generated At', value: new Date().toISOString() },
  ]);

  await workbook.xlsx.writeFile(OUTPUT_PATH);
  
  console.log(`✓ Generated ${OUTPUT_PATH}`);
  console.log(`  - Sheet 1: SalesData (${ROW_COUNT} rows, 9 columns)`);
  console.log(`  - Sheet 2: Summary (6 rows, 2 columns)`);
}

generateLargeFixture().catch(console.error);
