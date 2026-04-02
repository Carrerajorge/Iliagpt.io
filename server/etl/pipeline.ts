import { 
  ETLSpec, 
  NormalizedRecord, 
  RawDataRecord, 
  SourceMetadata,
  AuditResults,
  AuditTest,
  WorkbookSheets,
  ReadmeSheet,
  ModelMetrics,
  DashboardConfig,
  COUNTRY_CODES
} from './types';
import { fetchDataForIndicator } from './connectors';

export interface ETLPipelineResult {
  success: boolean;
  workbook: WorkbookSheets | null;
  errors: string[];
  summary: {
    totalRecords: number;
    countriesFetched: number;
    indicatorsFetched: number;
    sourcesUsed: number;
  };
}

export async function runETLPipeline(spec: ETLSpec): Promise<ETLPipelineResult> {
  const allRaw: RawDataRecord[] = [];
  const allNormalized: NormalizedRecord[] = [];
  const allSources: SourceMetadata[] = [];
  const errors: string[] = [];

  const countriesProcessed = new Set<string>();
  const indicatorsProcessed = new Set<string>();

  for (const country of spec.countries) {
    const countryCode = COUNTRY_CODES[country];
    if (!countryCode) {
      errors.push(`Unknown country: ${country}`);
      continue;
    }

    for (const indicator of spec.indicators) {
      try {
        const result = await fetchDataForIndicator(
          countryCode,
          indicator.id,
          spec.dateRange.start,
          spec.dateRange.end,
          indicator.preferredSources
        );

        if (result.normalized.length > 0) {
          allRaw.push(...result.raw);
          allNormalized.push(...result.normalized);
          result.raw.forEach(r => allSources.push(r.metadata));
          countriesProcessed.add(country);
          indicatorsProcessed.add(indicator.id);
        }

        if (result.errors.length > 0) {
          errors.push(...result.errors);
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        const errorMsg = `Pipeline error for ${country}/${indicator.id}: ${error instanceof Error ? error.message : 'Unknown'}`;
        console.error(`[ETL] ${errorMsg}`);
        errors.push(errorMsg);
      }
    }
  }

  console.log(`[ETL] Fetched ${allNormalized.length} total records`);

  const cleanData = deduplicateAndClean(allNormalized);

  const modelMetrics = calculateModelMetrics(cleanData, spec);

  const dashboardConfig = createDashboardConfig(cleanData, spec);

  const auditResults = runAuditTests(spec, allRaw, cleanData, allNormalized);
  console.log(`[ETL] Audit complete: ${auditResults.overallResult}`);

  const readme = createReadme(spec, auditResults);

  const workbook: WorkbookSheets = {
    readme,
    sources: allSources,
    raw: allRaw,
    clean: cleanData,
    model: modelMetrics,
    dashboard: dashboardConfig,
    audit: auditResults
  };

  const success = auditResults.overallResult === 'PASS';

  return {
    success,
    workbook,
    errors,
    summary: {
      totalRecords: cleanData.length,
      countriesFetched: countriesProcessed.size,
      indicatorsFetched: indicatorsProcessed.size,
      sourcesUsed: allSources.length
    }
  };
}

function deduplicateAndClean(records: NormalizedRecord[]): NormalizedRecord[] {
  const seen = new Map<string, NormalizedRecord>();
  
  for (const record of records) {
    const key = `${record.date}_${record.countryCode}_${record.indicator}`;
    const existing = seen.get(key);
    
    if (!existing || (record.value !== null && existing.value === null)) {
      seen.set(key, record);
    }
  }
  
  return Array.from(seen.values()).sort((a, b) => {
    if (a.countryCode !== b.countryCode) return a.countryCode.localeCompare(b.countryCode);
    if (a.indicator !== b.indicator) return a.indicator.localeCompare(b.indicator);
    return a.date.localeCompare(b.date);
  });
}

function calculateModelMetrics(data: NormalizedRecord[], spec: ETLSpec): ModelMetrics {
  const metrics: ModelMetrics = {
    metrics: [
      { id: 'YOY_GROWTH', name: 'Year-over-Year Growth', formula: '=(CurrentYear-PreviousYear)/PreviousYear*100', description: 'Percentage change from previous year' },
      { id: 'AVG_5Y', name: '5-Year Rolling Average', formula: '=AVERAGE(OFFSET(cell,-4,0,5,1))', description: 'Rolling average of last 5 years' },
      { id: 'DEVIATION', name: 'Deviation from Mean', formula: '=(Value-AVERAGE(Range))/STDEV(Range)', description: 'Standard deviations from mean' },
      { id: 'RANK', name: 'Country Rank', formula: '=RANK(Value,Range,0)', description: 'Rank among countries for given year' }
    ],
    data: []
  };

  const byCountryIndicator = new Map<string, NormalizedRecord[]>();
  for (const record of data) {
    const key = `${record.countryCode}_${record.indicator}`;
    if (!byCountryIndicator.has(key)) {
      byCountryIndicator.set(key, []);
    }
    byCountryIndicator.get(key)!.push(record);
  }

  for (const entry of Array.from(byCountryIndicator.entries())) {
    const [key, records] = entry;
    records.sort((a: NormalizedRecord, b: NormalizedRecord) => a.date.localeCompare(b.date));
    
    for (let i = 1; i < records.length; i++) {
      const current = records[i];
      const previous = records[i - 1];
      
      if (current.value !== null && previous.value !== null && previous.value !== 0) {
        const yoyGrowth = ((current.value - previous.value) / previous.value) * 100;
        metrics.data.push({
          date: current.date,
          country: current.countryCode,
          metricId: 'YOY_GROWTH',
          value: Math.round(yoyGrowth * 100) / 100,
          formulaRef: `=(${current.value}-${previous.value})/${previous.value}*100`
        });
      }
    }
  }

  return metrics;
}

function createDashboardConfig(data: NormalizedRecord[], spec: ETLSpec): DashboardConfig {
  const countries = Array.from(new Set(data.map(r => r.countryCode)));
  const indicators = Array.from(new Set(data.map(r => r.indicator)));

  return {
    charts: indicators.map((ind, i) => ({
      id: `chart_${i}`,
      type: 'line' as const,
      title: ind,
      dataRange: `CLEAN!A:G`,
      xAxis: 'Date',
      yAxis: 'Value',
      series: countries
    })),
    filters: [
      { id: 'filter_country', field: 'Country', label: 'Filter by Country', type: 'dropdown' },
      { id: 'filter_indicator', field: 'Indicator', label: 'Filter by Indicator', type: 'dropdown' }
    ],
    tables: [
      { id: 'summary_table', title: 'Data Summary', columns: ['Country', 'Indicator', 'Latest Value', 'YoY Change'], dataRange: 'MODEL!A:D' }
    ]
  };
}

function runAuditTests(
  spec: ETLSpec,
  raw: RawDataRecord[],
  clean: NormalizedRecord[],
  normalized: NormalizedRecord[]
): AuditResults {
  const tests: AuditTest[] = [];

  const expectedCountries = spec.countries.length;
  const actualCountries = new Set(clean.map(r => r.countryCode)).size;
  const coverageRatio = actualCountries / expectedCountries;
  tests.push({
    name: 'Country Coverage',
    description: 'Percentage of requested countries with data',
    category: 'coverage',
    result: coverageRatio >= 0.8 ? 'PASS' : coverageRatio >= 0.5 ? 'WARN' : 'FAIL',
    details: `${actualCountries}/${expectedCountries} countries (${Math.round(coverageRatio * 100)}%)`,
    value: coverageRatio * 100,
    threshold: 80
  });

  const expectedIndicators = spec.indicators.length;
  const actualIndicators = new Set(clean.map(r => r.indicator)).size;
  const indicatorCoverage = actualIndicators / expectedIndicators;
  tests.push({
    name: 'Indicator Coverage',
    description: 'Percentage of requested indicators with data',
    category: 'coverage',
    result: indicatorCoverage >= 0.8 ? 'PASS' : indicatorCoverage >= 0.5 ? 'WARN' : 'FAIL',
    details: `${actualIndicators}/${expectedIndicators} indicators (${Math.round(indicatorCoverage * 100)}%)`,
    value: indicatorCoverage * 100,
    threshold: 80
  });

  const duplicateCheck = new Set<string>();
  let duplicates = 0;
  for (const record of clean) {
    const key = `${record.date}_${record.countryCode}_${record.indicator}`;
    if (duplicateCheck.has(key)) {
      duplicates++;
    }
    duplicateCheck.add(key);
  }
  tests.push({
    name: 'No Duplicates',
    description: 'No duplicate records in clean data',
    category: 'duplicates',
    result: duplicates === 0 ? 'PASS' : 'FAIL',
    details: duplicates === 0 ? 'No duplicates found' : `${duplicates} duplicates found`,
    value: duplicates,
    threshold: 0
  });

  const unitCheck = new Map<string, Set<string>>();
  for (const record of clean) {
    if (!unitCheck.has(record.indicator)) {
      unitCheck.set(record.indicator, new Set());
    }
    unitCheck.get(record.indicator)!.add(record.unit);
  }
  const inconsistentUnits = Array.from(unitCheck.entries()).filter(([, units]) => units.size > 1);
  tests.push({
    name: 'Unit Consistency',
    description: 'Each indicator uses consistent units',
    category: 'units',
    result: inconsistentUnits.length === 0 ? 'PASS' : 'WARN',
    details: inconsistentUnits.length === 0 
      ? 'All units consistent' 
      : `Inconsistent units for: ${inconsistentUnits.map(([ind]) => ind).join(', ')}`,
    value: inconsistentUnits.length,
    threshold: 0
  });

  const rawCount = normalized.length;
  const cleanCount = clean.length;
  const reconciled = cleanCount <= rawCount && cleanCount >= rawCount * 0.5;
  tests.push({
    name: 'RAW Reconciliation',
    description: 'Clean data reconciles with raw data',
    category: 'reconciliation',
    result: reconciled ? 'PASS' : 'WARN',
    details: `Raw: ${rawCount}, Clean: ${cleanCount} (${Math.round(cleanCount/rawCount*100)}%)`,
    value: cleanCount,
    threshold: rawCount * 0.5
  });

  const values = clean.filter(r => r.value !== null).map(r => r.value as number);
  if (values.length > 0) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const stdDev = Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length);
    const extremes = values.filter(v => Math.abs(v - mean) > 3 * stdDev).length;
    tests.push({
      name: 'Extreme Values',
      description: 'Check for statistical outliers (>3 std dev)',
      category: 'extremes',
      result: extremes < values.length * 0.05 ? 'PASS' : 'WARN',
      details: `${extremes} extreme values out of ${values.length} (${Math.round(extremes/values.length*100)}%)`,
      value: extremes,
      threshold: values.length * 0.05
    });
  }

  const now = new Date();
  const lastCompleteMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthStr = `${lastCompleteMonth.getFullYear()}-${String(lastCompleteMonth.getMonth() + 1).padStart(2, '0')}`;
  const hasRecentData = clean.some(r => r.date >= lastMonthStr || r.date.startsWith(lastMonthStr.substring(0, 4)));
  tests.push({
    name: 'Data Freshness',
    description: 'Data includes recent observations',
    category: 'completeness',
    result: hasRecentData ? 'PASS' : 'WARN',
    details: hasRecentData ? `Data available up to ${lastMonthStr} or later` : 'No recent data found',
    value: hasRecentData ? 1 : 0,
    threshold: 1
  });

  const passed = tests.filter(t => t.result === 'PASS').length;
  const failed = tests.filter(t => t.result === 'FAIL').length;
  const warnings = tests.filter(t => t.result === 'WARN').length;

  return {
    timestamp: new Date().toISOString(),
    totalTests: tests.length,
    passed,
    failed,
    warnings,
    tests,
    overallResult: failed === 0 ? 'PASS' : 'FAIL'
  };
}

function createReadme(spec: ETLSpec, audit: AuditResults): ReadmeSheet {
  return {
    title: 'ETL Data Workbook',
    description: `Automated data extraction from official multilateral sources for ${spec.countries.length} countries and ${spec.indicators.length} indicators.`,
    generatedAt: new Date().toISOString(),
    spec,
    methodology: `Data extracted via APIs from World Bank, IMF, FRED, and other official sources. 
All data normalized to standard schema (Date, Country, Indicator, Value, Unit, Frequency, Source_ID).
Quality checks performed: ${audit.totalTests} tests with ${audit.passed} passed, ${audit.failed} failed, ${audit.warnings} warnings.`,
    contacts: 'Generated by iliagpt ETL Agent'
  };
}
