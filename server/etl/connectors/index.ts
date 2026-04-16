import { fetchWorldBankData } from './worldBank';
import { fetchFredData } from './fred';
import { fetchIMFData } from './imf';
import { NormalizedRecord, RawDataRecord, DataSourceType, COUNTRY_CODES } from '../types';

export interface FetchResult {
  raw: RawDataRecord[];
  normalized: NormalizedRecord[];
  errors: string[];
}

export async function fetchDataForIndicator(
  countryCode: string,
  indicatorId: string,
  startDate: string,
  endDate: string,
  preferredSources: DataSourceType[]
): Promise<FetchResult> {
  const raw: RawDataRecord[] = [];
  const normalized: NormalizedRecord[] = [];
  const errors: string[] = [];

  for (const source of preferredSources) {
    try {
      let result: { raw: RawDataRecord; normalized: NormalizedRecord[] } | null = null;

      switch (source) {
        case 'world_bank':
          result = await fetchWorldBankData(countryCode, indicatorId, startDate, endDate);
          break;
        case 'fred':
          if (countryCode === 'USA') {
            result = await fetchFredData(indicatorId, startDate, endDate);
          }
          break;
        case 'imf':
          result = await fetchIMFData(countryCode, indicatorId, startDate, endDate);
          break;
        default:
          console.log(`[Connectors] Source ${source} not implemented yet`);
      }

      if (result && result.normalized.length > 0) {
        raw.push(result.raw);
        normalized.push(...result.normalized);
        console.log(`[Connectors] Success: ${source} returned ${result.normalized.length} records`);
        break;
      }
    } catch (error) {
      const errorMsg = `Error fetching from ${source}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(`[Connectors] ${errorMsg}`);
      errors.push(errorMsg);
    }
  }

  if (normalized.length === 0 && errors.length === 0) {
    errors.push(`No data found for ${countryCode}/${indicatorId} from any source`);
  }

  return { raw, normalized, errors };
}

export function getCountryCode(countryName: string): string | null {
  return COUNTRY_CODES[countryName] || null;
}

export function getAllCountryCodes(): Record<string, string> {
  return COUNTRY_CODES;
}
