import { NormalizedRecord, SourceMetadata, RawDataRecord, DataSourceType } from '../types';

const FRED_API = 'https://api.stlouisfed.org/fred';

const INDICATOR_MAPPING: Record<string, string> = {
  'GDP': 'GDP',
  'GDP_GROWTH': 'A191RL1Q225SBEA',
  'INFLATION': 'CPIAUCSL',
  'UNEMPLOYMENT': 'UNRATE',
  'POPULATION': 'POPTHM',
  'EXPORTS': 'EXPGS',
  'IMPORTS': 'IMPGS',
  'FDI': 'ROWFDIQ027S'
};

const UNIT_MAPPING: Record<string, string> = {
  'GDP': 'billions USD',
  'A191RL1Q225SBEA': 'percent',
  'CPIAUCSL': 'index 1982-84=100',
  'UNRATE': 'percent',
  'POPTHM': 'thousands',
  'EXPGS': 'billions USD',
  'IMPGS': 'billions USD',
  'ROWFDIQ027S': 'millions USD'
};

const FREQUENCY_MAPPING: Record<string, 'M' | 'Q' | 'A'> = {
  'GDP': 'Q',
  'A191RL1Q225SBEA': 'Q',
  'CPIAUCSL': 'M',
  'UNRATE': 'M',
  'POPTHM': 'M',
  'EXPGS': 'Q',
  'IMPGS': 'Q',
  'ROWFDIQ027S': 'Q'
};

export async function fetchFredData(
  indicatorId: string,
  startDate: string,
  endDate: string,
  apiKey?: string
): Promise<{ raw: RawDataRecord; normalized: NormalizedRecord[] } | null> {
  const fredSeriesId = INDICATOR_MAPPING[indicatorId];
  if (!fredSeriesId) {
    console.log(`[FRED] Unknown indicator: ${indicatorId}`);
    return null;
  }

  const key = apiKey || process.env.FRED_API_KEY;
  if (!key) {
    console.log('[FRED] No API key available, skipping FRED data source');
    return null;
  }

  const url = `${FRED_API}/series/observations?series_id=${fredSeriesId}&api_key=${key}&file_type=json&observation_start=${startDate}&observation_end=${endDate}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[FRED] API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const timestamp = new Date().toISOString();
    const sourceId = `FRED_USA_${indicatorId}_${timestamp.split('T')[0]}`;

    const metadata: SourceMetadata = {
      sourceId,
      provider: 'fred' as DataSourceType,
      url: url.replace(key, '[REDACTED]'),
      method: 'API',
      timestamp,
      indicator: indicatorId,
      country: 'USA',
      unit: UNIT_MAPPING[fredSeriesId] || 'unknown',
      frequency: FREQUENCY_MAPPING[fredSeriesId] || 'A',
      notes: `FRED API - Series ${fredSeriesId}`
    };

    const rawRecord: RawDataRecord = {
      sourceId,
      rawData: data,
      metadata
    };

    const normalized: NormalizedRecord[] = [];
    
    if (data.observations && Array.isArray(data.observations)) {
      for (const obs of data.observations) {
        if (obs.value !== '.' && obs.value !== null && obs.value !== undefined) {
          const value = parseFloat(obs.value);
          if (!isNaN(value)) {
            normalized.push({
              date: obs.date,
              country: 'United States',
              countryCode: 'USA',
              indicator: indicatorId,
              indicatorCode: fredSeriesId,
              value,
              unit: UNIT_MAPPING[fredSeriesId] || 'unknown',
              frequency: FREQUENCY_MAPPING[fredSeriesId] || 'A',
              sourceId
            });
          }
        }
      }
    }

    console.log(`[FRED] Fetched ${normalized.length} records for ${indicatorId}`);
    
    return { raw: rawRecord, normalized };
  } catch (error) {
    console.error('[FRED] Fetch error:', error);
    return null;
  }
}

export function getAvailableIndicators(): string[] {
  return Object.keys(INDICATOR_MAPPING);
}
