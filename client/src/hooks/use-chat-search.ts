import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import Fuse, { type IFuseOptions } from "fuse.js";

export interface ChatItem {
  id: string;
  title: string;
  lastMessage?: string;
  updatedAt?: string;
  createdAt?: string;
}

export interface SearchResult {
  item: ChatItem;
  score: number;
  matches?: {
    key: string;
    value: string;
    indices: [number, number][];
  }[];
}

const FUSE_OPTIONS: IFuseOptions<ChatItem> = {
  keys: [
    { name: "title", weight: 0.6 },
    { name: "lastMessage", weight: 0.3 },
  ],
  threshold: 0.4,
  includeScore: true,
  includeMatches: true,
  ignoreLocation: true,
  minMatchCharLength: 2,
};

export function useChatSearch(chats: ChatItem[]) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const fuseRef = useRef<Fuse<ChatItem> | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    fuseRef.current = new Fuse(chats, FUSE_OPTIONS);
  }, [chats]);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  useEffect(() => {
    if (!debouncedQuery.trim() || !fuseRef.current) {
      setResults([]);
      return;
    }

    const fuseResults = fuseRef.current.search(debouncedQuery);
    
    const sortedResults = fuseResults
      .map(result => ({
        item: result.item,
        score: result.score ?? 1,
        matches: result.matches?.map(m => ({
          key: m.key ?? "",
          value: m.value ?? "",
          indices: m.indices as [number, number][],
        })),
      }))
      .sort((a, b) => {
        const scoreDiff = a.score - b.score;
        if (Math.abs(scoreDiff) > 0.1) return scoreDiff;
        
        const dateA = new Date(a.item.updatedAt || a.item.createdAt || 0).getTime();
        const dateB = new Date(b.item.updatedAt || b.item.createdAt || 0).getTime();
        return dateB - dateA;
      })
      .slice(0, 10);

    setResults(sortedResults);
  }, [debouncedQuery]);

  const resetSearch = useCallback(() => {
    setQuery("");
    setDebouncedQuery("");
    setResults([]);
  }, []);

  return {
    query,
    setQuery,
    results,
    isSearching: query.trim().length > 0 && query !== debouncedQuery,
    hasResults: results.length > 0,
    resetSearch,
  };
}

export function highlightText(text: string, indices: [number, number][]): string {
  if (!indices || indices.length === 0) return text;

  const sortedIndices = [...indices].sort((a, b) => a[0] - b[0]);
  let result = "";
  let lastIndex = 0;

  for (const [start, end] of sortedIndices) {
    result += text.slice(lastIndex, start);
    result += `<mark class="bg-yellow-200 dark:bg-yellow-800 text-foreground rounded-sm px-0.5">${text.slice(start, end + 1)}</mark>`;
    lastIndex = end + 1;
  }

  result += text.slice(lastIndex);
  return result;
}
