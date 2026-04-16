export * from './types';
export * from './pipeline';
export * from './excelBuilder';

import { ETLSpec, createDefaultSpec, DEFAULT_INDICATORS, COUNTRY_CODES } from './types';
import { runETLPipeline, ETLPipelineResult } from './pipeline';
import { buildExcelWorkbookBundle } from './excelBuilder';

export interface ETLAgentRequest {
  countries: string[];
  indicators?: string[];
  startDate?: string;
  endDate?: string;
}

export interface ETLAgentResponse {
  success: boolean;
  message: string;
  workbookBuffer?: Buffer;
  filename?: string;
  summary?: {
    totalRecords: number;
    countriesFetched: number;
    indicatorsFetched: number;
    sourcesUsed: number;
    auditResult: 'PASS' | 'FAIL';
  };
  errors?: string[];
}

export async function runETLAgent(request: ETLAgentRequest): Promise<ETLAgentResponse> {
  console.log('[ETL Agent] Starting with request:', JSON.stringify(request, null, 2));

  if (!request.countries || request.countries.length === 0) {
    return {
      success: false,
      message: 'No countries specified',
      errors: ['At least one country is required']
    };
  }

  const validCountries = request.countries.filter(c => COUNTRY_CODES[c]);
  if (validCountries.length === 0) {
    return {
      success: false,
      message: 'No valid countries found',
      errors: [`Invalid countries: ${request.countries.join(', ')}. Valid countries: ${Object.keys(COUNTRY_CODES).join(', ')}`]
    };
  }

  let spec: ETLSpec;
  
  if (request.indicators && request.indicators.length > 0) {
    const validIndicators = DEFAULT_INDICATORS.filter(ind => 
      request.indicators!.includes(ind.id) || request.indicators!.includes(ind.name)
    );
    
    spec = {
      countries: validCountries,
      indicators: validIndicators.length > 0 ? validIndicators : DEFAULT_INDICATORS,
      dateRange: {
        start: request.startDate || '2000-01',
        end: request.endDate || getLastCompleteMonth()
      }
    };
  } else {
    spec = createDefaultSpec(validCountries);
    if (request.startDate) spec.dateRange.start = request.startDate;
    if (request.endDate) spec.dateRange.end = request.endDate;
  }

  console.log('[ETL Agent] Running pipeline with spec:', JSON.stringify(spec, null, 2));

  try {
    const result: ETLPipelineResult = await runETLPipeline(spec);

    if (!result.workbook) {
      return {
        success: false,
        message: 'ETL pipeline failed to generate workbook',
        errors: result.errors
      };
    }

    const workbookBuffer = await buildExcelWorkbookBundle(result.workbook);
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `ETL_Data_${validCountries.join('_')}_${timestamp}.zip`;

    console.log('[ETL Agent] Workbook generated:', filename, 'Size:', workbookBuffer.length, 'bytes');

    return {
      success: result.success,
      message: result.success 
        ? `ETL completed successfully. Generated workbook with ${result.summary.totalRecords} records from ${result.summary.sourcesUsed} sources.`
        : `ETL completed with audit failures. ${result.errors.length} errors encountered.`,
      workbookBuffer,
      filename,
      summary: {
        totalRecords: result.summary.totalRecords,
        countriesFetched: result.summary.countriesFetched,
        indicatorsFetched: result.summary.indicatorsFetched,
        sourcesUsed: result.summary.sourcesUsed,
        auditResult: result.workbook.audit.overallResult
      },
      errors: result.errors.length > 0 ? result.errors : undefined
    };
  } catch (error) {
    console.error('[ETL Agent] Pipeline error:', error);
    return {
      success: false,
      message: 'ETL pipeline encountered an error',
      errors: [error instanceof Error ? error.message : 'Unknown error']
    };
  }
}

function getLastCompleteMonth(): string {
  const now = new Date();
  now.setMonth(now.getMonth() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function getAvailableCountries(): string[] {
  return Object.keys(COUNTRY_CODES);
}

export function getAvailableIndicators(): Array<{ id: string; name: string; category: string }> {
  return DEFAULT_INDICATORS.map(ind => ({
    id: ind.id,
    name: ind.name,
    category: ind.category
  }));
}
