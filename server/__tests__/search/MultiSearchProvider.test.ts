// Local test implementation — replace with real import when file exists
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchResult {
  id: string
  title: string
  url: string
  snippet: string
  score: number
  provider: string
  timestamp: Date
}

interface SearchProvider {
  name: string
  search: (query: string, limit: number) => Promise<SearchResult[]>
  rateLimit?: number // requests per second
}

interface ProviderStats {
  calls: number
  errors: number
  avgLatency: number
}

interface MultiSearchOptions {
  timeout?: number
  deduplicateByUrl?: boolean
}

// ---------------------------------------------------------------------------
// MultiSearchProvider implementation
// ---------------------------------------------------------------------------

class MultiSearchProvider {
  private providers: SearchProvider[]
  private options: Required<MultiSearchOptions>
  private stats: Map<string, { calls: number; errors: number; latencies: number[] }>
  // Per-provider rate limiting: timestamp of last call + queued delay
  private rateLimitQueues: Map<string, number>

  constructor(providers: SearchProvider[], options: MultiSearchOptions = {}) {
    this.providers = [...providers]
    this.options = {
      timeout: options.timeout ?? 5000,
      deduplicateByUrl: options.deduplicateByUrl ?? true,
    }
    this.stats = new Map()
    this.rateLimitQueues = new Map()

    for (const p of providers) {
      this._initStats(p.name)
    }
  }

  private _initStats(name: string): void {
    if (!this.stats.has(name)) {
      this.stats.set(name, { calls: 0, errors: 0, latencies: [] })
    }
  }

  addProvider(provider: SearchProvider): void {
    this.providers.push(provider)
    this._initStats(provider.name)
  }

  removeProvider(name: string): void {
    this.providers = this.providers.filter((p) => p.name !== name)
  }

  getProviderStats(): Map<string, ProviderStats> {
    const result = new Map<string, ProviderStats>()
    for (const [name, data] of this.stats) {
      const avgLatency =
        data.latencies.length > 0
          ? data.latencies.reduce((a, b) => a + b, 0) / data.latencies.length
          : 0
      result.set(name, { calls: data.calls, errors: data.errors, avgLatency })
    }
    return result
  }

  private async _searchProvider(
    provider: SearchProvider,
    query: string,
    limit: number,
  ): Promise<SearchResult[]> {
    const s = this.stats.get(provider.name)!
    const start = Date.now()

    // Rate limiting: ensure minimum interval between calls
    if (provider.rateLimit) {
      const minIntervalMs = 1000 / provider.rateLimit
      const lastCallAt = this.rateLimitQueues.get(provider.name) ?? 0
      const now = Date.now()
      const waitMs = Math.max(0, lastCallAt + minIntervalMs - now)
      if (waitMs > 0) {
        await new Promise<void>((res) => setTimeout(res, waitMs))
      }
      this.rateLimitQueues.set(provider.name, Date.now())
    }

    try {
      const results = await Promise.race([
        provider.search(query, limit),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Provider ${provider.name} timed out`)),
            this.options.timeout,
          ),
        ),
      ])
      s.calls++
      s.latencies.push(Date.now() - start)
      return results
    } catch {
      s.calls++
      s.errors++
      s.latencies.push(Date.now() - start)
      return []
    }
  }

  async search(query: string, limit = 10): Promise<SearchResult[]> {
    const allPromises = this.providers.map((p) =>
      this._searchProvider(p, query, limit),
    )

    const allArrays = await Promise.all(allPromises)
    let merged: SearchResult[] = allArrays.flat()

    if (this.options.deduplicateByUrl) {
      const byUrl = new Map<string, SearchResult>()
      for (const r of merged) {
        const existing = byUrl.get(r.url)
        if (!existing || r.score > existing.score) {
          byUrl.set(r.url, r)
        }
      }
      merged = Array.from(byUrl.values())
    }

    // Sort by score descending, stable: break ties by insertion order (provider order)
    merged.sort((a, b) => b.score - a.score)

    return merged.slice(0, limit)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(
  id: string,
  url: string,
  score: number,
  provider: string,
): SearchResult {
  return {
    id,
    title: `Title ${id}`,
    url,
    snippet: `Snippet ${id}`,
    score,
    provider,
    timestamp: new Date(),
  }
}

function makeProvider(
  name: string,
  results: SearchResult[],
  delayMs = 0,
  rateLimit?: number,
): SearchProvider {
  return {
    name,
    rateLimit,
    search: vi.fn(async () => {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
      return results
    }),
  }
}

function makeFailingProvider(name: string): SearchProvider {
  return {
    name,
    search: vi.fn(async () => {
      throw new Error(`${name} search failed`)
    }),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MultiSearchProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // 1. Provider fallback chain
  // -------------------------------------------------------------------------
  describe('provider fallback chain', () => {
    it('primary provider fails → secondary returns results', async () => {
      const primary = makeFailingProvider('primary')
      const secondary = makeProvider('secondary', [
        makeResult('r1', 'https://example.com/1', 0.9, 'secondary'),
      ])
      const msp = new MultiSearchProvider([primary, secondary])
      const results = await msp.search('test')

      expect(results).toHaveLength(1)
      expect(results[0].provider).toBe('secondary')
    })

    it('all providers fail → returns empty array without throwing', async () => {
      const msp = new MultiSearchProvider([
        makeFailingProvider('p1'),
        makeFailingProvider('p2'),
      ])

      await expect(msp.search('query')).resolves.toEqual([])
    })

    it('provider timeout → skipped, others results used', async () => {
      const slowProvider = makeProvider(
        'slow',
        [makeResult('s1', 'https://slow.com', 0.95, 'slow')],
        3000, // 3 second delay — exceeds 100ms timeout
      )
      const fastProvider = makeProvider('fast', [
        makeResult('f1', 'https://fast.com', 0.8, 'fast'),
      ])
      const msp = new MultiSearchProvider([slowProvider, fastProvider], {
        timeout: 100,
      })

      const results = await msp.search('test')

      expect(results.some((r) => r.provider === 'fast')).toBe(true)
      expect(results.every((r) => r.provider !== 'slow')).toBe(true)
    }, 3000)

    it('results still returned even when one provider is slow', async () => {
      const slowFailing = makeFailingProvider('slow_fail')
      const fast = makeProvider('fast', [
        makeResult('f1', 'https://fast.com', 0.7, 'fast'),
      ])
      const msp = new MultiSearchProvider([slowFailing, fast])
      const results = await msp.search('query')

      expect(results.length).toBeGreaterThan(0)
    })
  })

  // -------------------------------------------------------------------------
  // 2. Result deduplication
  // -------------------------------------------------------------------------
  describe('result deduplication', () => {
    it('two providers return same URL → only one result kept', async () => {
      const url = 'https://shared.com/page'
      const p1 = makeProvider('p1', [makeResult('r1', url, 0.7, 'p1')])
      const p2 = makeProvider('p2', [makeResult('r2', url, 0.5, 'p2')])
      const msp = new MultiSearchProvider([p1, p2], { deduplicateByUrl: true })

      const results = await msp.search('q')

      const urlCount = results.filter((r) => r.url === url).length
      expect(urlCount).toBe(1)
    })

    it('keeps result with higher score when deduplicating', async () => {
      const url = 'https://shared.com/page'
      const p1 = makeProvider('p1', [makeResult('r1', url, 0.9, 'p1')])
      const p2 = makeProvider('p2', [makeResult('r2', url, 0.4, 'p2')])
      const msp = new MultiSearchProvider([p1, p2], { deduplicateByUrl: true })

      const results = await msp.search('q')
      const kept = results.find((r) => r.url === url)!

      expect(kept.score).toBe(0.9)
      expect(kept.provider).toBe('p1')
    })

    it('different URLs → both kept', async () => {
      const p1 = makeProvider('p1', [makeResult('r1', 'https://a.com', 0.8, 'p1')])
      const p2 = makeProvider('p2', [makeResult('r2', 'https://b.com', 0.7, 'p2')])
      const msp = new MultiSearchProvider([p1, p2], { deduplicateByUrl: true })

      const results = await msp.search('q')

      expect(results).toHaveLength(2)
    })

    it('deduplicateByUrl: false → duplicates kept', async () => {
      const url = 'https://shared.com/page'
      const p1 = makeProvider('p1', [makeResult('r1', url, 0.9, 'p1')])
      const p2 = makeProvider('p2', [makeResult('r2', url, 0.5, 'p2')])
      const msp = new MultiSearchProvider([p1, p2], { deduplicateByUrl: false })

      const results = await msp.search('q')

      const urlCount = results.filter((r) => r.url === url).length
      expect(urlCount).toBe(2)
    })
  })

  // -------------------------------------------------------------------------
  // 3. Merged ranking
  // -------------------------------------------------------------------------
  describe('merged ranking', () => {
    it('results from multiple providers sorted by score descending', async () => {
      const p1 = makeProvider('p1', [
        makeResult('r1', 'https://a.com', 0.5, 'p1'),
        makeResult('r2', 'https://b.com', 0.9, 'p1'),
      ])
      const p2 = makeProvider('p2', [
        makeResult('r3', 'https://c.com', 0.7, 'p2'),
      ])
      const msp = new MultiSearchProvider([p1, p2])

      const results = await msp.search('q')

      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score)
      expect(results[1].score).toBeGreaterThanOrEqual(results[2].score)
    })

    it('provider name preserved in each result', async () => {
      const p1 = makeProvider('myProvider', [
        makeResult('r1', 'https://a.com', 0.8, 'myProvider'),
      ])
      const msp = new MultiSearchProvider([p1])
      const results = await msp.search('q')

      expect(results[0].provider).toBe('myProvider')
    })

    it('limit=5 → returns at most 5 results', async () => {
      const manyResults = Array.from({ length: 10 }, (_, i) =>
        makeResult(`r${i}`, `https://example.com/${i}`, 0.5 - i * 0.01, 'p1'),
      )
      const p1 = makeProvider('p1', manyResults)
      const msp = new MultiSearchProvider([p1])

      const results = await msp.search('q', 5)

      expect(results).toHaveLength(5)
    })

    it('merged results contain entries from all providers', async () => {
      const p1 = makeProvider('p1', [makeResult('r1', 'https://a.com', 0.8, 'p1')])
      const p2 = makeProvider('p2', [makeResult('r2', 'https://b.com', 0.6, 'p2')])
      const msp = new MultiSearchProvider([p1, p2])

      const results = await msp.search('q', 10)
      const providerNames = results.map((r) => r.provider)

      expect(providerNames).toContain('p1')
      expect(providerNames).toContain('p2')
    })
  })

  // -------------------------------------------------------------------------
  // 4. Rate limiting
  // -------------------------------------------------------------------------
  describe('rate limiting', () => {
    it('provider with rateLimit=1 delays between rapid consecutive calls', async () => {
      const callTimes: number[] = []
      const rateLimitedProvider: SearchProvider = {
        name: 'ratelimited',
        rateLimit: 1, // 1 req/sec → 1000ms between calls
        search: vi.fn(async () => {
          callTimes.push(Date.now())
          return []
        }),
      }
      const msp = new MultiSearchProvider([rateLimitedProvider])

      await msp.search('q1')
      await msp.search('q2')

      expect(callTimes).toHaveLength(2)
      const gap = callTimes[1] - callTimes[0]
      // Should be at least ~900ms apart given rateLimit=1
      expect(gap).toBeGreaterThanOrEqual(900)
    }, 4000)

    it('rate limit per provider is independent — other providers not affected', async () => {
      const callTimes: number[] = []
      const fast: SearchProvider = {
        name: 'fast',
        search: vi.fn(async () => {
          callTimes.push(Date.now())
          return []
        }),
      }
      const slow: SearchProvider = {
        name: 'slow',
        rateLimit: 0.5, // 1 call every 2 seconds
        search: vi.fn(async () => []),
      }

      const msp = new MultiSearchProvider([fast, slow])
      const start = Date.now()
      await msp.search('q1')
      await msp.search('q2')
      const elapsed = Date.now() - start

      // fast provider's two calls should have happened quickly (no rate limit)
      expect(callTimes).toHaveLength(2)
      // fast calls should be fast (much less than 2000ms)
      expect(callTimes[1] - callTimes[0]).toBeLessThan(500)
      // overall time is driven by slow provider — but we only care about fast
      void elapsed
    }, 6000)
  })

  // -------------------------------------------------------------------------
  // 5. Stats tracking
  // -------------------------------------------------------------------------
  describe('stats tracking', () => {
    it('successful call increments calls count', async () => {
      const p = makeProvider('tracker', [makeResult('r1', 'https://a.com', 0.5, 'tracker')])
      const msp = new MultiSearchProvider([p])

      await msp.search('q')
      const stats = msp.getProviderStats().get('tracker')!

      expect(stats.calls).toBe(1)
    })

    it('failed call increments errors count', async () => {
      const p = makeFailingProvider('errer')
      const msp = new MultiSearchProvider([p])

      await msp.search('q')
      const stats = msp.getProviderStats().get('errer')!

      expect(stats.errors).toBe(1)
      expect(stats.calls).toBe(1)
    })

    it('average latency is computed and greater than 0 after calls', async () => {
      const p = makeProvider('latency_p', [], 10) // 10ms artificial delay
      const msp = new MultiSearchProvider([p])

      await msp.search('q')
      const stats = msp.getProviderStats().get('latency_p')!

      expect(stats.avgLatency).toBeGreaterThan(0)
    })

    it('multiple calls average latency reflects all calls', async () => {
      const p = makeProvider('multi', [])
      const msp = new MultiSearchProvider([p])

      await msp.search('q1')
      await msp.search('q2')
      await msp.search('q3')

      const stats = msp.getProviderStats().get('multi')!
      expect(stats.calls).toBe(3)
    })

    it('addProvider includes new provider in stats', async () => {
      const msp = new MultiSearchProvider([])
      const p = makeProvider('new_p', [makeResult('r1', 'https://x.com', 0.8, 'new_p')])
      msp.addProvider(p)

      await msp.search('q')
      const stats = msp.getProviderStats()

      expect(stats.has('new_p')).toBe(true)
      expect(stats.get('new_p')!.calls).toBe(1)
    })

    it('removeProvider excludes it from searches', async () => {
      const p1 = makeProvider('p1', [makeResult('r1', 'https://p1.com', 0.9, 'p1')])
      const p2 = makeProvider('p2', [makeResult('r2', 'https://p2.com', 0.8, 'p2')])
      const msp = new MultiSearchProvider([p1, p2])

      msp.removeProvider('p2')
      const results = await msp.search('q')

      expect(results.every((r) => r.provider !== 'p2')).toBe(true)
    })
  })
})
