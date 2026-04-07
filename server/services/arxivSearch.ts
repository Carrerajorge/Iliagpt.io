import { searchArXiv, type SearchOptions, type AcademicResult } from "./unifiedAcademicSearch";

export type ArxivSearchOptions = SearchOptions;
export type ArxivSearchResult = AcademicResult;

export async function arxivSearch(query: string, options: ArxivSearchOptions = {}): Promise<ArxivSearchResult[]> {
  return searchArXiv(query, options);
}

export default arxivSearch;
