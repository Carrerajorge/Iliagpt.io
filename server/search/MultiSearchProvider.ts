import axios from "axios"
import { Logger } from "../lib/logger"
import { redis } from "../lib/redis"
import { env } from "../config/env"

export interface SearchResult {
  title: string
  url: string
  snippet: string
  source: ProviderName
  score: number
  publishedAt?: string
  imageUrl?: string
}

export interface SearchOptions {
  query: string
  maxResults?: number
  providers?: ProviderName[]
  freshness?: "day" | "week" | "month" | "any"
  region?: string
  safeSearch?: boolean
}

export type ProviderName = "duckduckgo" | "brave" | "tavily" | "serpapi" | "google"

interface ProviderStatus {
  available: boolean
  rateLimited: boolean
  lastError?: string
}

const PROVIDER_PRIORITY: ProviderName[] = ["brave", "tavily", "google", "serpapi", "duckduckgo"]
const RATE_LIMIT_WINDOW_SEC = 60
const RATE_LIMIT_MAX = 10
const SOURCE_PRIORITY: Record<ProviderName, number> = {
  brave: 0.9,
  tavily: 0.85,
  google: 0.95,
  serpapi: 0.8,
  duckduckgo: 0.7,
}

class MultiSearchProvider {
  private providerStatus: Record<ProviderName, ProviderStatus> = {
    duckduckgo: { available: true, rateLimited: false },
    brave: { available: true, rateLimited: false },
    tavily: { available: true, rateLimited: false },
    serpapi: { available: true, rateLimited: false },
    google: { available: true, rateLimited: false },
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    const { query, maxResults = 10, providers } = options
    const candidateProviders = providers ?? PROVIDER_PRIORITY

    for (const provider of candidateProviders) {
      const allowed = await this.checkRateLimit(provider)
      if (!allowed) {
        this.providerStatus[provider].rateLimited = true
        Logger.warn(`[MultiSearch] Rate limited: ${provider}`)
        continue
      }

      try {
        Logger.info(`[MultiSearch] Trying provider: ${provider}`, { query })
        const results = await this.callProvider(provider, query, options)
        this.providerStatus[provider].rateLimited = false
        this.providerStatus[provider].lastError = undefined
        return results.slice(0, maxResults)
      } catch (err: any) {
        this.providerStatus[provider].lastError = err?.message ?? "unknown"
        Logger.warn(`[MultiSearch] Provider ${provider} failed, falling back`, { error: err?.message })
      }
    }

    Logger.error("[MultiSearch] All providers failed")
    return []
  }

  async searchWithAllProviders(options: SearchOptions): Promise<SearchResult[]> {
    const { query, maxResults = 10, providers } = options
    const candidateProviders = providers ?? PROVIDER_PRIORITY

    const tasks = candidateProviders.map(async (provider) => {
      const allowed = await this.checkRateLimit(provider)
      if (!allowed) {
        this.providerStatus[provider].rateLimited = true
        return []
      }
      try {
        return await this.callProvider(provider, query, options)
      } catch (err: any) {
        this.providerStatus[provider].lastError = err?.message ?? "unknown"
        Logger.warn(`[MultiSearch] Provider ${provider} error`, { error: err?.message })
        return []
      }
    })

    const allResults = await Promise.allSettled(tasks)
    const resultArrays: SearchResult[][] = allResults.map((r) =>
      r.status === "fulfilled" ? r.value : []
    )

    const merged = this.mergeAndDeduplicate(resultArrays)
    Logger.info(`[MultiSearch] Merged results count: ${merged.length}`)
    return merged.slice(0, maxResults)
  }

  private async callProvider(provider: ProviderName, query: string, options: SearchOptions): Promise<SearchResult[]> {
    switch (provider) {
      case "duckduckgo":
        return this.searchDuckDuckGo(query, options.maxResults ?? 10)
      case "brave":
        return this.searchBrave(query, options)
      case "tavily":
        return this.searchTavily(query, options)
      case "serpapi":
        return this.searchSerpApi(query, options)
      case "google":
        return this.searchGoogle(query, options)
    }
  }

  private async searchDuckDuckGo(query: string, limit: number): Promise<SearchResult[]> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; IliaGPT/1.0; +https://iliagpt.com)",
        Accept: "text/html",
      },
      timeout: 10000,
    })
    const html: string = response.data
    const results: SearchResult[] = []

    // Parse result divs: class="result__body" or "result"
    const resultBlocks = html.match(/<div class="result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g) ?? []

    for (const block of resultBlocks) {
      if (results.length >= limit) break

      const titleMatch = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)

      if (!titleMatch) continue

      const rawUrl = titleMatch[1]
      const title = titleMatch[2].replace(/<[^>]+>/g, "").trim()
      const snippet = snippetMatch
        ? snippetMatch[1].replace(/<[^>]+>/g, "").trim()
        : ""

      // DDG returns redirects like //duckduckgo.com/l/?uddg=...
      let resolvedUrl = rawUrl
      if (rawUrl.startsWith("//duckduckgo.com/l/")) {
        const uddg = new URLSearchParams(rawUrl.split("?")[1] ?? "").get("uddg")
        resolvedUrl = uddg ? decodeURIComponent(uddg) : rawUrl
      }

      if (!resolvedUrl.startsWith("http")) continue

      results.push({
        title,
        url: resolvedUrl,
        snippet,
        source: "duckduckgo",
        score: SOURCE_PRIORITY.duckduckgo * (1 - results.length * 0.05),
      })
    }

    Logger.debug(`[MultiSearch] DDG returned ${results.length} results`)
    return results
  }

  private async searchBrave(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const apiKey = (env as any).BRAVE_SEARCH_API_KEY
    if (!apiKey) throw new Error("BRAVE_SEARCH_API_KEY not configured")

    const params: Record<string, string> = {
      q: query,
      count: String(options.maxResults ?? 10),
    }
    if (options.freshness && options.freshness !== "any") params.freshness = options.freshness
    if (options.region) params.country = options.region
    if (options.safeSearch !== undefined) params.safesearch = options.safeSearch ? "strict" : "off"

    const response = await axios.get("https://api.search.brave.com/res/v1/web/search", {
      headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
      params,
      timeout: 10000,
    })

    const webResults = response.data?.web?.results ?? []
    return webResults.map((r: any, i: number) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.description ?? "",
      source: "brave" as ProviderName,
      score: SOURCE_PRIORITY.brave * (1 - i * 0.04),
      publishedAt: r.age ?? undefined,
      imageUrl: r.thumbnail?.src ?? undefined,
    }))
  }

  private async searchTavily(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const apiKey = (env as any).TAVILY_API_KEY
    if (!apiKey) throw new Error("TAVILY_API_KEY not configured")

    const response = await axios.post(
      "https://api.tavily.com/search",
      {
        api_key: apiKey,
        query,
        max_results: options.maxResults ?? 10,
        search_depth: "advanced",
        include_answer: false,
        include_raw_content: false,
      },
      { timeout: 15000 }
    )

    const results: any[] = response.data?.results ?? []
    return results.map((r: any, i: number) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.content ?? "",
      source: "tavily" as ProviderName,
      score: SOURCE_PRIORITY.tavily * (r.score ?? 1 - i * 0.04),
      publishedAt: r.published_date ?? undefined,
    }))
  }

  private async searchSerpApi(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const apiKey = (env as any).SERPAPI_KEY
    if (!apiKey) throw new Error("SERPAPI_KEY not configured")

    const params: Record<string, string> = {
      engine: "google",
      q: query,
      api_key: apiKey,
      num: String(options.maxResults ?? 10),
    }
    if (options.region) params.gl = options.region

    const response = await axios.get("https://serpapi.com/search.json", {
      params,
      timeout: 10000,
    })

    const organicResults: any[] = response.data?.organic_results ?? []
    return organicResults.map((r: any, i: number) => ({
      title: r.title ?? "",
      url: r.link ?? "",
      snippet: r.snippet ?? "",
      source: "serpapi" as ProviderName,
      score: SOURCE_PRIORITY.serpapi * (1 - i * 0.04),
      publishedAt: r.date ?? undefined,
      imageUrl: r.thumbnail ?? undefined,
    }))
  }

  private async searchGoogle(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const apiKey = (env as any).GOOGLE_API_KEY
    const cx = (env as any).GOOGLE_CSE_ID
    if (!apiKey || !cx) throw new Error("GOOGLE_API_KEY or GOOGLE_CSE_ID not configured")

    const params: Record<string, string> = {
      key: apiKey,
      cx,
      q: query,
      num: String(Math.min(options.maxResults ?? 10, 10)),
    }
    if (options.safeSearch !== undefined) params.safe = options.safeSearch ? "active" : "off"

    const response = await axios.get("https://www.googleapis.com/customsearch/v1", {
      params,
      timeout: 10000,
    })

    const items: any[] = response.data?.items ?? []
    return items.map((r: any, i: number) => ({
      title: r.title ?? "",
      url: r.link ?? "",
      snippet: r.snippet ?? "",
      source: "google" as ProviderName,
      score: SOURCE_PRIORITY.google * (1 - i * 0.04),
      imageUrl: r.pagemap?.cse_image?.[0]?.src ?? undefined,
    }))
  }

  async checkRateLimit(provider: ProviderName): Promise<boolean> {
    const key = `search:ratelimit:${provider}`
    try {
      const current = await redis.incr(key)
      if (current === 1) {
        await redis.expire(key, RATE_LIMIT_WINDOW_SEC)
      }
      if (current > RATE_LIMIT_MAX) {
        Logger.warn(`[MultiSearch] Rate limit exceeded for ${provider}`, { current })
        return false
      }
      return true
    } catch (err) {
      Logger.error("[MultiSearch] Redis rate limit check failed", err)
      return true // fail open
    }
  }

  private normalizeUrl(url: string): string {
    try {
      const u = new URL(url)
      // Remove www prefix
      u.hostname = u.hostname.replace(/^www\./, "")
      // Remove trailing slash
      u.pathname = u.pathname.replace(/\/$/, "") || "/"
      // Remove UTM params and common tracking params
      const removeParams = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "fbclid", "gclid"]
      removeParams.forEach((p) => u.searchParams.delete(p))
      // Sort remaining params for consistent comparison
      u.searchParams.sort()
      u.hash = ""
      return u.toString().toLowerCase()
    } catch {
      return url.toLowerCase().replace(/^https?:\/\/www\./, "https://")
    }
  }

  private mergeAndDeduplicate(resultArrays: SearchResult[][]): SearchResult[] {
    const seenUrls = new Map<string, SearchResult>()
    const urlFrequency = new Map<string, number>()

    // First pass: count occurrences per normalized URL
    for (const results of resultArrays) {
      for (const r of results) {
        const norm = this.normalizeUrl(r.url)
        urlFrequency.set(norm, (urlFrequency.get(norm) ?? 0) + 1)
      }
    }

    // Second pass: pick best result per URL, boost score by frequency
    for (const results of resultArrays) {
      for (const r of results) {
        const norm = this.normalizeUrl(r.url)
        const freq = urlFrequency.get(norm) ?? 1
        const boostedScore = r.score * (1 + (freq - 1) * 0.15) // +15% per additional source

        if (!seenUrls.has(norm) || seenUrls.get(norm)!.score < boostedScore) {
          seenUrls.set(norm, { ...r, score: Math.min(boostedScore, 1.0) })
        }
      }
    }

    const merged = Array.from(seenUrls.values())
    merged.sort((a, b) => b.score - a.score)
    Logger.debug(`[MultiSearch] Deduplication: ${merged.length} unique results`)
    return merged
  }

  getProviderStatus(): Record<ProviderName, ProviderStatus> {
    return { ...this.providerStatus }
  }
}

export const multiSearchProvider = new MultiSearchProvider()
