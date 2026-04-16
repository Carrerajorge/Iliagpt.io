import { NormalizedRecord, SourceMetadata, RawDataRecord, DataSourceType } from '../types';

const IMF_API = 'https://www.imf.org/external/datamapper/api/v1';

const INDICATOR_MAPPING: Record<string, string> = {
  'GDP': 'NGDPD',
  'GDP_GROWTH': 'NGDP_RPCH',
  'INFLATION': 'PCPIPCH',
  'UNEMPLOYMENT': 'LUR',
  'POPULATION': 'LP',
  'EXPORTS': 'TXG_RPCH',
  'IMPORTS': 'TMG_RPCH'
};

const UNIT_MAPPING: Record<string, string> = {
  'NGDPD': 'billions USD',
  'NGDP_RPCH': 'percent change',
  'PCPIPCH': 'percent change',
  'LUR': 'percent',
  'LP': 'millions',
  'TXG_RPCH': 'percent change',
  'TMG_RPCH': 'percent change'
};

export async function fetchIMFData(
  countryCode: string,
  indicatorId: string,
  startYear: string,
  endYear: string
): Promise<{ raw: RawDataRecord; normalized: NormalizedRecord[] } | null> {
  const imfIndicator = INDICATOR_MAPPING[indicatorId];
  if (!imfIndicator) {
    console.log(`[IMF] Unknown indicator: ${indicatorId}`);
    return null;
  }

  const url = `${IMF_API}/${imfIndicator}/${countryCode}`;
  
  console.log(`[IMF] Fetching: ${url}`);
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.log(`[IMF] API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const timestamp = new Date().toISOString();
    const sourceId = `IMF_${countryCode}_${indicatorId}_${timestamp.split('T')[0]}`;

    const metadata: SourceMetadata = {
      sourceId,
      provider: 'imf' as DataSourceType,
      url,
      method: 'API',
      timestamp,
      indicator: indicatorId,
      country: countryCode,
      unit: UNIT_MAPPING[imfIndicator] || 'unknown',
      frequency: 'A',
      notes: `IMF DataMapper API - Indicator ${imfIndicator}`
    };

    const rawRecord: RawDataRecord = {
      sourceId,
      rawData: data,
      metadata
    };

    const normalized: NormalizedRecord[] = [];
    const startYearNum = parseInt(startYear.split('-')[0]);
    const endYearNum = parseInt(endYear.split('-')[0]);

    if (data.values && data.values[imfIndicator] && data.values[imfIndicator][countryCode]) {
      const countryData = data.values[imfIndicator][countryCode];
      for (const [year, value] of Object.entries(countryData)) {
        const yearNum = parseInt(year);
        if (yearNum >= startYearNum && yearNum <= endYearNum && value !== null) {
          normalized.push({
            date: `${year}-01`,
            country: countryCode,
            countryCode,
            indicator: indicatorId,
            indicatorCode: imfIndicator,
            value: value as number,
            unit: UNIT_MAPPING[imfIndicator] || 'unknown',
            frequency: 'A',
            sourceId
          });
        }
      }
    }

    console.log(`[IMF] Fetched ${normalized.length} records for ${countryCode}/${indicatorId}`);
    
    return { raw: rawRecord, normalized };
  } catch (error) {
    console.error('[IMF] Fetch error:', error);
    return null;
  }
}

export function getAvailableIndicators(): string[] {
  return Object.keys(INDICATOR_MAPPING);
}
