import XLSXChart from 'xlsx-chart';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const xlsxChart = new XLSXChart();

const templatePath = path.join(__dirname, 'templates', 'etl_template_chart.xlsx');

// Create a simple template with a bar chart
const opts = {
  file: templatePath,
  chart: 'column',
  titles: ['Country A', 'Country B', 'Country C'],
  fields: ['GDP', 'Population', 'Inflation'],
  data: {
    'Country A': { 'GDP': 1000, 'Population': 50, 'Inflation': 2.5 },
    'Country B': { 'GDP': 2000, 'Population': 100, 'Inflation': 3.0 },
    'Country C': { 'GDP': 1500, 'Population': 75, 'Inflation': 1.8 }
  },
  chartTitle: 'Economic Indicators by Country'
};

xlsxChart.writeFile(opts, (err: Error | null) => {
  if (err) {
    console.error('Error creating template:', err);
    process.exit(1);
  }
  console.log('Template created:', templatePath);
});
