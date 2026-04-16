export interface ETLSpec {
  countries: string[];
  indicators: IndicatorSpec[];
  dateRange: {
    start: string;
    end: string;
  };
}

export interface IndicatorSpec {
  id: string;
  name: string;
  category: string;
  preferredSources: DataSourceType[];
  unit?: string;
  frequency: 'monthly' | 'quarterly' | 'annual';
}

export type DataSourceType = 'world_bank' | 'imf' | 'fred' | 'oecd' | 'un' | 'eurostat' | 'bis' | 'ecb';

export interface NormalizedRecord {
  date: string;
  country: string;
  countryCode: string;
  indicator: string;
  indicatorCode: string;
  value: number | null;
  unit: string;
  frequency: 'M' | 'Q' | 'A';
  sourceId: string;
}

export interface SourceMetadata {
  sourceId: string;
  provider: DataSourceType;
  url: string;
  method: 'API' | 'CSV' | 'XLSX' | 'SCRAPE';
  timestamp: string;
  indicator: string;
  country: string;
  unit: string;
  frequency: string;
  notes: string;
  rawFile?: string;
}

export interface RawDataRecord {
  sourceId: string;
  rawData: any;
  metadata: SourceMetadata;
}

export interface AuditTest {
  name: string;
  description: string;
  category: 'coverage' | 'duplicates' | 'units' | 'reconciliation' | 'extremes' | 'completeness';
  result: 'PASS' | 'FAIL' | 'WARN';
  details: string;
  value?: number;
  threshold?: number;
}

export interface AuditResults {
  timestamp: string;
  totalTests: number;
  passed: number;
  failed: number;
  warnings: number;
  tests: AuditTest[];
  overallResult: 'PASS' | 'FAIL';
}

export interface WorkbookSheets {
  readme: ReadmeSheet;
  sources: SourceMetadata[];
  raw: RawDataRecord[];
  clean: NormalizedRecord[];
  model: ModelMetrics;
  dashboard: DashboardConfig;
  audit: AuditResults;
}

export interface ReadmeSheet {
  title: string;
  description: string;
  generatedAt: string;
  spec: ETLSpec;
  methodology: string;
  contacts: string;
}

export interface ModelMetrics {
  metrics: MetricDefinition[];
  data: MetricValue[];
}

export interface MetricDefinition {
  id: string;
  name: string;
  formula: string;
  description: string;
}

export interface MetricValue {
  date: string;
  country: string;
  metricId: string;
  value: number | null;
  formulaRef?: string;
}

export interface DashboardConfig {
  charts: ChartConfig[];
  filters: FilterConfig[];
  tables: TableConfig[];
}

export interface ChartConfig {
  id: string;
  type: 'bar' | 'line' | 'area' | 'pie';
  title: string;
  dataRange: string;
  xAxis: string;
  yAxis: string;
  series: string[];
}

export interface FilterConfig {
  id: string;
  field: string;
  label: string;
  type: 'dropdown' | 'slicer';
}

export interface TableConfig {
  id: string;
  title: string;
  columns: string[];
  dataRange: string;
}

export const COUNTRY_CODES: Record<string, string> = {
  'Argentina': 'ARG',
  'Bolivia': 'BOL',
  'Brazil': 'BRA',
  'Chile': 'CHL',
  'Colombia': 'COL',
  'Costa Rica': 'CRI',
  'Cuba': 'CUB',
  'Dominican Republic': 'DOM',
  'Ecuador': 'ECU',
  'El Salvador': 'SLV',
  'Guatemala': 'GTM',
  'Haiti': 'HTI',
  'Honduras': 'HND',
  'Mexico': 'MEX',
  'Nicaragua': 'NIC',
  'Panama': 'PAN',
  'Paraguay': 'PRY',
  'Peru': 'PER',
  'Puerto Rico': 'PRI',
  'Uruguay': 'URY',
  'Venezuela': 'VEN',
  'United States': 'USA',
  'Canada': 'CAN',
  'United Kingdom': 'GBR',
  'Germany': 'DEU',
  'France': 'FRA',
  'Italy': 'ITA',
  'Spain': 'ESP',
  'Japan': 'JPN',
  'China': 'CHN',
  'India': 'IND',
  'Australia': 'AUS',
  'South Korea': 'KOR',
  'Russia': 'RUS',
  'South Africa': 'ZAF',
};

export const DEFAULT_INDICATORS: IndicatorSpec[] = [
  {
    id: 'GDP',
    name: 'Gross Domestic Product',
    category: 'Economy',
    preferredSources: ['world_bank', 'imf'],
    unit: 'current USD',
    frequency: 'annual'
  },
  {
    id: 'GDP_GROWTH',
    name: 'GDP Growth Rate',
    category: 'Economy',
    preferredSources: ['world_bank', 'imf'],
    unit: 'percent',
    frequency: 'annual'
  },
  {
    id: 'INFLATION',
    name: 'Inflation Rate (CPI)',
    category: 'Economy',
    preferredSources: ['imf', 'world_bank'],
    unit: 'percent',
    frequency: 'annual'
  },
  {
    id: 'UNEMPLOYMENT',
    name: 'Unemployment Rate',
    category: 'Labor',
    preferredSources: ['world_bank', 'oecd'],
    unit: 'percent',
    frequency: 'annual'
  },
  {
    id: 'POPULATION',
    name: 'Total Population',
    category: 'Demographics',
    preferredSources: ['world_bank', 'un'],
    unit: 'persons',
    frequency: 'annual'
  },
  {
    id: 'EXPORTS',
    name: 'Exports of Goods and Services',
    category: 'Trade',
    preferredSources: ['world_bank', 'imf'],
    unit: 'current USD',
    frequency: 'annual'
  },
  {
    id: 'IMPORTS',
    name: 'Imports of Goods and Services',
    category: 'Trade',
    preferredSources: ['world_bank', 'imf'],
    unit: 'current USD',
    frequency: 'annual'
  },
  {
    id: 'FDI',
    name: 'Foreign Direct Investment',
    category: 'Investment',
    preferredSources: ['world_bank', 'oecd'],
    unit: 'current USD',
    frequency: 'annual'
  }
];

export function getLastCompleteMonth(): string {
  const now = new Date();
  now.setMonth(now.getMonth() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function createDefaultSpec(countries: string[]): ETLSpec {
  return {
    countries,
    indicators: DEFAULT_INDICATORS,
    dateRange: {
      start: '2000-01',
      end: getLastCompleteMonth()
    }
  };
}
