import { searchDOAJ, type SearchOptions, type AcademicResult } from "./unifiedAcademicSearch";

export type DoajSearchOptions = SearchOptions;
export type DoajSearchResult = AcademicResult;

export async function doajSearch(query: string, options: DoajSearchOptions = {}): Promise<DoajSearchResult[]> {
  return searchDOAJ(query, options);
}

export default doajSearch;
