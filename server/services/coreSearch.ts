import { searchCORE, type SearchOptions, type AcademicResult } from "./unifiedAcademicSearch";

export type CoreSearchOptions = SearchOptions;
export type CoreSearchResult = AcademicResult;

export async function coreSearch(query: string, options: CoreSearchOptions = {}): Promise<CoreSearchResult[]> {
  return searchCORE(query, options);
}

export default coreSearch;
