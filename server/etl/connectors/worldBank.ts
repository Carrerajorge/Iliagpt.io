import { NormalizedRecord, SourceMetadata, RawDataRecord, DataSourceType } from '../types';

const WORLD_BANK_API = 'https://api.worldbank.org/v2';

const INDICATOR_MAPPING: Record<string, string> = {
  'GDP': 'NY.GDP.MKTP.CD',
  'GDP_GROWTH': 'NY.GDP.MKTP.KD.ZG',
  'INFLATION': 'FP.CPI.TOTL.ZG',
  'UNEMPLOYMENT': 'SL.UEM.TOTL.ZS',
  'POPULATION': 'SP.POP.TOTL',
  'EXPORTS': 'NE.EXP.GNFS.CD',
  'IMPORTS': 'NE.IMP.GNFS.CD',
  'FDI': 'BX.KLT.DINV.CD.WD'
};

const UNIT_MAPPING: Record<string, string> = {
  'NY.GDP.MKTP.CD': 'current USD',
  'NY.GDP.MKTP.KD.ZG': 'percent',
  'FP.CPI.TOTL.ZG': 'percent',
  'SL.UEM.TOTL.ZS': 'percent',
  'SP.POP.TOTL': 'persons',
  'NE.EXP.GNFS.CD': 'current USD',
  'NE.IMP.GNFS.CD': 'current USD',
  'BX.KLT.DINV.CD.WD': 'current USD'
};

export async function fetchWorldBankData(
  countryCode: string,
  indicatorId: string,
  startYear: string,
  endYear: string
): Promise<{ raw: RawDataRecord; normalized: NormalizedRecord[] }> {
  const wbIndicator = INDICATOR_MAPPING[indicatorId];
  if (!wbIndicator) {
    throw new Error(`Unknown indicator: ${indicatorId}`);
  }

  const startYearNum = parseInt(startYear.split('-')[0]);
  const endYearNum = parseInt(endYear.split('-')[0]);
  
  const url = `${WORLD_BANK_API}/country/${countryCode}/indicator/${wbIndicator}?format=json&date=${startYearNum}:${endYearNum}&per_page=1000`;
  
  console.log(`[WorldBank] Fetching: ${url}`);
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`World Bank API error: ${response.status}`);
  }

  const data = await response.json();
  const timestamp = new Date().toISOString();
  const sourceId = `WB_${countryCode}_${indicatorId}_${timestamp.split('T')[0]}`;

  const metadata: SourceMetadata = {
    sourceId,
    provider: 'world_bank' as DataSourceType,
    url,
    method: 'API',
    timestamp,
    indicator: indicatorId,
    country: countryCode,
    unit: UNIT_MAPPING[wbIndicator] || 'unknown',
    frequency: 'A',
    notes: `World Bank V2 API - Indicator ${wbIndicator}`
  };

  const rawRecord: RawDataRecord = {
    sourceId,
    rawData: data,
    metadata
  };

  const normalized: NormalizedRecord[] = [];
  
  if (Array.isArray(data) && data.length >= 2 && Array.isArray(data[1])) {
    for (const item of data[1]) {
      if (item.value !== null && item.value !== undefined) {
        normalized.push({
          date: `${item.date}-01`,
          country: item.country?.value || countryCode,
          countryCode: item.countryiso3code || countryCode,
          indicator: indicatorId,
          indicatorCode: wbIndicator,
          value: parseFloat(item.value),
          unit: UNIT_MAPPING[wbIndicator] || 'unknown',
          frequency: 'A',
          sourceId
        });
      }
    }
  }

  console.log(`[WorldBank] Fetched ${normalized.length} records for ${countryCode}/${indicatorId}`);
  
  return { raw: rawRecord, normalized };
}

export function getAvailableIndicators(): string[] {
  return Object.keys(INDICATOR_MAPPING);
}

export function mapIndicatorToWorldBank(indicatorId: string): string | null {
  return INDICATOR_MAPPING[indicatorId] || null;
}
