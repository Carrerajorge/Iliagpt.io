/**
 * useRAGSearch — RAG search with debounce, filtering, pagination, and caching.
 */

import { useState, useCallback, useRef, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SourceType = 'conversations' | 'documents' | 'memory' | 'web' | 'code' | 'all'

export interface RAGSearchFilter {
  sourceTypes?: SourceType[]
  dateFrom?: Date
  dateTo?: Date
  minRelevance?: number
  tags?: string[]
  userId?: string
}

export interface RAGSearchResult {
  id: string
  content: string
  title?: string
  sourceType: SourceType
  sourceId: string
  relevanceScore: number
  createdAt: Date
  highlights: string[]
  metadata?: Record<string, any>
}

export interface RAGSearchState {
  results: RAGSearchResult[]
  totalCount: number
  isSearching: boolean
  hasMore: boolean
  currentPage: number
  query: string
  filters: RAGSearchFilter
  searchHistory: string[]
  error: Error | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20
const DEBOUNCE_MS = 300
const MAX_CACHE_ENTRIES = 20
const HISTORY_STORAGE_KEY = 'rag-search-history'
const MAX_HISTORY = 50

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveHistory(history: string[]): void {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)))
  } catch {
    // localStorage may be unavailable
  }
}

function addToHistory(history: string[], query: string): string[] {
  const trimmed = query.trim()
  if (!trimmed) return history
  const deduped = [trimmed, ...history.filter(h => h !== trimmed)]
  return deduped.slice(0, MAX_HISTORY)
}

function highlightTerms(content: string, query: string): string[] {
  const terms = query.trim().split(/\s+/).filter(t => t.length > 2)
  if (!terms.length) return [content.slice(0, 200)]

  const highlights: string[] = []
  for (const term of terms) {
    const idx = content.toLowerCase().indexOf(term.toLowerCase())
    if (idx >= 0) {
      const start = Math.max(0, idx - 60)
      const end = Math.min(content.length, idx + term.length + 60)
      const snippet = content.slice(start, end)
      highlights.push(
        (start > 0 ? '...' : '') + snippet + (end < content.length ? '...' : '')
      )
    }
  }

  return highlights.length ? highlights : [content.slice(0, 200)]
}

function deduplicateResults(existing: RAGSearchResult[], incoming: RAGSearchResult[]): RAGSearchResult[] {
  const seenIds = new Set(existing.map(r => r.sourceId))
  return incoming.filter(r => !seenIds.has(r.sourceId))
}

function parseResult(raw: any, query: string): RAGSearchResult {
  return {
    id: raw.id ?? crypto.randomUUID(),
    content: raw.content ?? '',
    title: raw.title,
    sourceType: raw.sourceType ?? 'all',
    sourceId: raw.sourceId ?? raw.id ?? '',
    relevanceScore: raw.relevanceScore ?? raw.score ?? 0,
    createdAt: raw.createdAt ? new Date(raw.createdAt) : new Date(),
    highlights: raw.highlights ?? highlightTerms(raw.content ?? '', query),
    metadata: raw.metadata,
  }
}

function buildSearchBody(
  query: string,
  filters: RAGSearchFilter,
  page: number
): Record<string, any> {
  return {
    query,
    page,
    limit: PAGE_SIZE,
    filters: {
      sourceTypes: filters.sourceTypes,
      dateFrom: filters.dateFrom?.toISOString(),
      dateTo: filters.dateTo?.toISOString(),
      minRelevance: filters.minRelevance,
      tags: filters.tags,
      userId: filters.userId,
    },
  }
}

// ---------------------------------------------------------------------------
// LRU Cache (Map preserves insertion order)
// ---------------------------------------------------------------------------

class LRUCache<K, V> {
  private map: Map<K, V>
  private maxSize: number

  constructor(maxSize: number) {
    this.map = new Map()
    this.maxSize = maxSize
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined
    const value = this.map.get(key)!
    // Move to end (most recently used)
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.maxSize) {
      // Remove oldest (first entry)
      const firstKey = this.map.keys().next().value
      if (firstKey !== undefined) this.map.delete(firstKey)
    }
  }

  has(key: K): boolean {
    return this.map.has(key)
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRAGSearch(defaultFilters?: RAGSearchFilter) {
  const queryClient = useQueryClient()

  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [filters, setFiltersState] = useState<RAGSearchFilter>(defaultFilters ?? {})
  const [results, setResults] = useState<RAGSearchResult[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [searchHistory, setSearchHistory] = useState<string[]>(loadHistory)

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cacheRef = useRef(new LRUCache<string, { results: RAGSearchResult[]; total: number }>(MAX_CACHE_ENTRIES))

  // -------------------------------------------------------------------------
  // Core search execution
  // -------------------------------------------------------------------------

  const executeSearch = useCallback(
    async (q: string, f: RAGSearchFilter, page: number, append = false) => {
      const trimmedQuery = q.trim()
      if (!trimmedQuery) {
        setResults([])
        setTotalCount(0)
        setIsSearching(false)
        return
      }

      const cacheKey = JSON.stringify({ q: trimmedQuery, f, page })

      // Cache hit
      const cached = cacheRef.current.get(cacheKey)
      if (cached) {
        const newResults = append
          ? [...results, ...deduplicateResults(results, cached.results)]
          : cached.results
        setResults(newResults)
        setTotalCount(cached.total)
        setIsSearching(false)
        return
      }

      setIsSearching(true)
      setError(null)

      try {
        const response = await fetch('/api/search/rag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildSearchBody(trimmedQuery, f, page)),
        })

        if (!response.ok) {
          throw new Error(`Search failed: HTTP ${response.status}`)
        }

        const data = await response.json()
        const rawResults: RAGSearchResult[] = (data.results ?? []).map((r: any) =>
          parseResult(r, trimmedQuery)
        )
        const total: number = data.totalCount ?? data.total ?? rawResults.length

        // Cache result
        cacheRef.current.set(cacheKey, { results: rawResults, total })

        if (append) {
          const unique = deduplicateResults(results, rawResults)
          setResults(prev => [...prev, ...unique])
        } else {
          setResults(rawResults)
        }

        setTotalCount(total)

        // Add to history
        const newHistory = addToHistory(searchHistory, trimmedQuery)
        setSearchHistory(newHistory)
        saveHistory(newHistory)
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err))
        setError(e)
      } finally {
        setIsSearching(false)
      }
    },
    [results, searchHistory]
  )

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  const search = useCallback(
    (q: string) => {
      setQuery(q)

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)

      if (!q.trim()) {
        setResults([])
        setTotalCount(0)
        setActiveQuery('')
        return
      }

      debounceTimerRef.current = setTimeout(() => {
        setActiveQuery(q)
        setCurrentPage(1)
        executeSearch(q, filters, 1, false)
      }, DEBOUNCE_MS)
    },
    [filters, executeSearch]
  )

  const loadMore = useCallback(() => {
    if (!activeQuery.trim()) return
    const hasMore = results.length < totalCount
    if (!hasMore || isSearching) return
    const nextPage = currentPage + 1
    setCurrentPage(nextPage)
    executeSearch(activeQuery, filters, nextPage, true)
  }, [activeQuery, results.length, totalCount, isSearching, currentPage, filters, executeSearch])

  const setFilters = useCallback(
    (newFilters: RAGSearchFilter) => {
      setFiltersState(newFilters)
      setCurrentPage(1)
      if (activeQuery.trim()) {
        executeSearch(activeQuery, newFilters, 1, false)
      }
    },
    [activeQuery, executeSearch]
  )

  const clearSearch = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    setQuery('')
    setActiveQuery('')
    setResults([])
    setTotalCount(0)
    setCurrentPage(1)
    setError(null)
  }, [])

  const rerunSearch = useCallback(
    (q: string) => {
      setQuery(q)
      setActiveQuery(q)
      setCurrentPage(1)
      executeSearch(q, filters, 1, false)
    },
    [filters, executeSearch]
  )

  const removeFromHistory = useCallback((q: string) => {
    setSearchHistory(prev => {
      const updated = prev.filter(h => h !== q)
      saveHistory(updated)
      return updated
    })
  }, [])

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------

  const hasMore = results.length < totalCount

  const state: RAGSearchState = useMemo(
    () => ({
      results,
      totalCount,
      isSearching,
      hasMore,
      currentPage,
      query,
      filters,
      searchHistory,
      error,
    }),
    [results, totalCount, isSearching, hasMore, currentPage, query, filters, searchHistory, error]
  )

  return {
    state,
    search,
    loadMore,
    setFilters,
    clearSearch,
    rerunSearch,
    removeFromHistory,
  }
}
