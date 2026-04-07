import { searchOpenAlex, type SearchOptions, type AcademicResult } from "./unifiedAcademicSearch";

export type OpenAlexSearchOptions = SearchOptions;
export type OpenAlexResult = AcademicResult;

export async function openAlexSearch(query: string, options: OpenAlexSearchOptions = {}): Promise<OpenAlexResult[]> {
  return searchOpenAlex(query, options);
}

export default openAlexSearch;
