import axios, { type AxiosRequestConfig } from "axios"
import { Logger } from "../lib/logger"
import { redis } from "../lib/redis"

export interface ScrapedPage {
  url: string
  title: string
  content: string
  markdown?: string
  author?: string
  publishedAt?: string
  siteName?: string
  description?: string
  images: string[]
  links: string[]
  jsonLd?: any[]
  microdata?: Record<string, any>
  wordCount: number
  readingTimeMinutes: number
  language?: string
  scrapedAt: Date
}

export interface ScrapeOptions {
  timeout?: number
  followRedirects?: boolean
  useCache?: boolean
  cacheTtl?: number
  extractMarkdown?: boolean
  userAgent?: string
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (compatible; IliaGPT/1.0; +https://iliagpt.com)",
]

const DOMAIN_RATE_MAP = new Map<string, number[]>()
const MIN_CRAWL_INTERVAL_MS = 5000

class WebScraperRobust {
  async scrape(url: string, options: ScrapeOptions = {}): Promise<ScrapedPage> {
    const { timeout = 10000, useCache = true, cacheTtl = 3600, extractMarkdown = true } = options
    Logger.info("[WebScraper] Scraping URL", { url })

    if (useCache) {
      const cacheKey = `scrape:${Buffer.from(url).toString("base64").slice(0, 64)}`
      try {
        const cached = await redis.get(cacheKey)
        if (cached) {
          Logger.debug("[WebScraper] Cache hit", { url })
          return JSON.parse(cached)
        }
      } catch (err) {
        Logger.warn("[WebScraper] Cache read failed", { error: (err as Error).message })
      }
    }

    const domain = this.extractDomain(url)
    const robotsResult = await this.checkRobotsTxt(url)
    if (!robotsResult.allowed) {
      throw new Error(`Robots.txt disallows crawling: ${url}`)
    }

    await this.respectRateLimit(domain)

    const { html, finalUrl } = await this.getWithRetry(url, 3, timeout)

    let extracted = this.extractWithReadability(html, finalUrl)
    if (!extracted) {
      extracted = this.extractFallback(html, finalUrl)
    }

    const jsonLd = this.extractJsonLd(html)
    const microdata = this.extractMicrodata(html)
    const links = this.extractLinks(html, finalUrl)
    const images = this.extractImages(html, finalUrl)
    const description = this.extractMetaTag(html, "description")
    const siteName = this.extractMetaTag(html, "og:site_name") ?? domain
    const publishedAt = this.extractPublishedDate(html, jsonLd)
    const author = extracted.author ?? this.extractAuthor(html, jsonLd)
    const language = this.extractLanguage(html)

    const cleanContent = this.cleanText(extracted.content)
    const wordCount = cleanContent.split(/\s+/).filter(Boolean).length
    const readingTimeMinutes = Math.max(1, Math.round(wordCount / 200))
    const markdown = extractMarkdown ? this.toMarkdown(cleanContent) : undefined

    const page: ScrapedPage = {
      url: finalUrl,
      title: extracted.title,
      content: cleanContent,
      markdown,
      author,
      publishedAt,
      siteName,
      description,
      images,
      links,
      jsonLd,
      microdata,
      wordCount,
      readingTimeMinutes,
      language,
      scrapedAt: new Date(),
    }

    if (useCache) {
      const cacheKey = `scrape:${Buffer.from(url).toString("base64").slice(0, 64)}`
      try {
        await redis.setex(cacheKey, cacheTtl, JSON.stringify(page))
      } catch (err) {
        Logger.warn("[WebScraper] Cache write failed", { error: (err as Error).message })
      }
    }

    Logger.info("[WebScraper] Done", { url: finalUrl, wordCount, title: page.title })
    return page
  }

  async scrapeMultiple(urls: string[], concurrency = 3): Promise<ScrapedPage[]> {
    const results: ScrapedPage[] = []
    for (let i = 0; i < urls.length; i += concurrency) {
      const chunk = urls.slice(i, i + concurrency)
      const settled = await Promise.allSettled(chunk.map((u) => this.scrape(u)))
      for (const r of settled) {
        if (r.status === "fulfilled") {
          results.push(r.value)
        } else {
          Logger.warn("[WebScraper] scrapeMultiple failure", { error: r.reason?.message })
        }
      }
    }
    return results
  }

  async checkRobotsTxt(url: string): Promise<{ allowed: boolean; crawlDelay?: number }> {
    const domain = this.extractDomain(url)
    const cacheKey = `robots:${domain}`
    let robotsTxt: string | null = null

    try {
      const cached = await redis.get(cacheKey)
      if (cached) {
        robotsTxt = cached
      } else {
        const robotsUrl = `https://${domain}/robots.txt`
        const response = await axios.get<string>(robotsUrl, { timeout: 5000, validateStatus: () => true })
        if (response.status === 200) {
          robotsTxt = response.data
          await redis.setex(cacheKey, 86400, robotsTxt)
        }
      }
    } catch {
      return { allowed: true }
    }

    if (!robotsTxt) return { allowed: true }

    let urlPath = "/"
    try { urlPath = new URL(url).pathname } catch { /* use "/" */ }

    return this.parseRobotsTxt(robotsTxt, urlPath)
  }

  private parseRobotsTxt(robotsTxt: string, path: string): { allowed: boolean; crawlDelay?: number } {
    const lines = robotsTxt.split("\n").map((l) => l.trim())
    let currentAgent = false
    const disallowedPaths: string[] = []
    const allowedPaths: string[] = []
    let crawlDelay: number | undefined

    for (const line of lines) {
      if (line.startsWith("#")) continue
      const lower = line.toLowerCase()
      if (lower.startsWith("user-agent:")) {
        const agent = line.split(":")[1]?.trim()
        currentAgent = agent === "*" || (agent?.toLowerCase().includes("iliagpt") ?? false)
        if (currentAgent) { disallowedPaths.length = 0; allowedPaths.length = 0 }
      } else if (currentAgent && lower.startsWith("disallow:")) {
        const p = line.split(":")[1]?.trim()
        if (p) disallowedPaths.push(p)
      } else if (currentAgent && lower.startsWith("allow:")) {
        const p = line.split(":")[1]?.trim()
        if (p) allowedPaths.push(p)
      } else if (currentAgent && lower.startsWith("crawl-delay:")) {
        crawlDelay = parseFloat(line.split(":")[1]?.trim() ?? "0") * 1000
      }
    }

    for (const ap of allowedPaths) {
      if (path.startsWith(ap)) return { allowed: true, crawlDelay }
    }
    for (const dp of disallowedPaths) {
      if (dp && path.startsWith(dp)) return { allowed: false }
    }

    return { allowed: true, crawlDelay }
  }

  private extractWithReadability(html: string, _url: string): { title: string; content: string; author?: string } | null {
    try {
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
      const title = titleMatch ? this.decodeHtmlEntities(titleMatch[1].trim()) : ""

      const articlePatterns = [
        /<article[^>]*>([\s\S]*?)<\/article>/i,
        /<main[^>]*>([\s\S]*?)<\/main>/i,
        /<div[^>]*class="[^"]*(?:article|content|post|entry|story)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      ]

      for (const pattern of articlePatterns) {
        const match = pattern.exec(html)
        if (match) {
          const content = this.stripTagsKeepText(match[1])
          if (content.length > 200) {
            const authorMatch = html.match(/(?:author|byline)[^>]*>([^<]{2,80})</i)
            return { title, content, author: authorMatch ? authorMatch[1].trim() : undefined }
          }
        }
      }

      return null
    } catch (err) {
      Logger.debug("[WebScraper] Readability failed", { error: (err as Error).message })
      return null
    }
  }

  private extractFallback(html: string, _url: string): { title: string; content: string } {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    const title = titleMatch ? this.decodeHtmlEntities(titleMatch[1].trim()) : "Untitled"

    let cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<header[\s\S]*?<\/header>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
      .replace(/<form[\s\S]*?<\/form>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")

    const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
    if (bodyMatch) cleaned = bodyMatch[1]

    return { title, content: this.stripTagsKeepText(cleaned) }
  }

  private stripTagsKeepText(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<\/h[1-6]>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+/g, " ")
      .trim()
  }

  private extractJsonLd(html: string): any[] {
    const results: any[] = []
    const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    let match: RegExpExecArray | null
    while ((match = regex.exec(html)) !== null) {
      try { results.push(JSON.parse(match[1].trim())) } catch { /* skip */ }
    }
    return results
  }

  private extractMicrodata(html: string): Record<string, any> {
    const result: Record<string, any> = {}
    const propRegex = /itemprop=["']([^"']+)["'][^>]*(?:content=["']([^"']*)|>([^<]*))/gi
    let match: RegExpExecArray | null
    while ((match = propRegex.exec(html)) !== null) {
      const name = match[1]
      const value = (match[2] ?? match[3] ?? "").trim()
      if (name && value) result[name] = value
    }
    return result
  }

  cleanText(text: string): string {
    return text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
      .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  }

  private extractLinks(html: string, baseUrl: string): string[] {
    const links: string[] = []
    const regex = /<a[^>]+href=["']([^"'#][^"']*?)["']/gi
    let match: RegExpExecArray | null
    let base: URL | null = null
    try { base = new URL(baseUrl) } catch { /* skip */ }

    while ((match = regex.exec(html)) !== null) {
      try {
        const href = match[1].trim()
        if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) continue
        const resolved = base ? new URL(href, base).toString() : href
        if (resolved.startsWith("http")) links.push(resolved)
      } catch { /* skip */ }
    }
    return [...new Set(links)].slice(0, 100)
  }

  private extractImages(html: string, baseUrl: string): string[] {
    const images: string[] = []
    const regex = /<img[^>]+src=["']([^"']+)["']/gi
    let match: RegExpExecArray | null
    let base: URL | null = null
    try { base = new URL(baseUrl) } catch { /* skip */ }

    while ((match = regex.exec(html)) !== null) {
      try {
        const src = match[1].trim()
        const resolved = base ? new URL(src, base).toString() : src
        if (resolved.startsWith("http")) images.push(resolved)
      } catch { /* skip */ }
    }
    return [...new Set(images)].slice(0, 30)
  }

  private extractMetaTag(html: string, name: string): string | undefined {
    const patterns = [
      new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`, "i"),
    ]
    for (const p of patterns) {
      const m = html.match(p)
      if (m) return this.decodeHtmlEntities(m[1].trim())
    }
    return undefined
  }

  private extractPublishedDate(html: string, jsonLd: any[]): string | undefined {
    for (const ld of jsonLd) {
      if (ld.datePublished) return ld.datePublished
      if (ld.dateModified) return ld.dateModified
    }
    const metaDate = this.extractMetaTag(html, "article:published_time")
      ?? this.extractMetaTag(html, "article:modified_time")
      ?? this.extractMetaTag(html, "og:updated_time")
    if (metaDate) return metaDate
    const timeMatch = html.match(/<time[^>]+datetime=["']([^"']+)["']/i)
    return timeMatch ? timeMatch[1] : undefined
  }

  private extractAuthor(html: string, jsonLd: any[]): string | undefined {
    for (const ld of jsonLd) {
      if (ld.author?.name) return ld.author.name
      if (typeof ld.author === "string") return ld.author
    }
    return this.extractMetaTag(html, "author") ?? this.extractMetaTag(html, "og:article:author")
  }

  private extractLanguage(html: string): string | undefined {
    const m = html.match(/<html[^>]+lang=["']([^"']+)["']/i)
    return m ? m[1] : undefined
  }

  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
  }

  private toMarkdown(text: string): string {
    return text.split("\n\n").map((p) => p.trim()).filter(Boolean).join("\n\n")
  }

  private extractDomain(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, "") } catch {
      return url.split("/")[2]?.replace(/^www\./, "") ?? url
    }
  }

  private async respectRateLimit(domain: string): Promise<void> {
    const now = Date.now()
    const timestamps = DOMAIN_RATE_MAP.get(domain) ?? []
    const recent = timestamps.filter((t) => now - t < MIN_CRAWL_INTERVAL_MS)
    if (recent.length > 0) {
      const waitMs = MIN_CRAWL_INTERVAL_MS - (now - recent[0])
      if (waitMs > 0) {
        Logger.debug(`[WebScraper] Waiting ${waitMs}ms for domain ${domain}`)
        await new Promise<void>((resolve) => setTimeout(resolve, waitMs))
      }
    }
    DOMAIN_RATE_MAP.set(domain, [...recent, Date.now()].slice(-10))
  }

  async getWithRetry(url: string, retries = 3, timeout = 10000): Promise<{ html: string; finalUrl: string }> {
    let lastError: Error | null = null
    for (let attempt = 0; attempt < retries; attempt++) {
      if (attempt > 0) {
        const backoff = Math.pow(2, attempt) * 500
        await new Promise<void>((resolve) => setTimeout(resolve, backoff))
      }
      const userAgent = USER_AGENTS[attempt % USER_AGENTS.length]
      const config: AxiosRequestConfig = {
        timeout,
        maxRedirects: 5,
        headers: {
          "User-Agent": userAgent,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          Connection: "keep-alive",
        },
        validateStatus: (s) => s < 500,
        responseType: "text",
      }
      try {
        const response = await axios.get<string>(url, config)
        if (response.status === 429) { continue }
        if (response.status >= 400) { throw new Error(`HTTP ${response.status} for ${url}`) }
        const finalUrl = (response.request as any)?.res?.responseUrl ?? (response.config as any)?.url ?? url
        return { html: response.data, finalUrl }
      } catch (err: any) {
        lastError = err
        Logger.warn(`[WebScraper] Attempt ${attempt + 1} failed`, { url, error: err?.message })
      }
    }
    throw lastError ?? new Error(`Failed to fetch ${url} after ${retries} retries`)
  }
}

export const webScraper = new WebScraperRobust()
