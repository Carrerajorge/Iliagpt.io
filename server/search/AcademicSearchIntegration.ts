import axios from "axios"
import { Logger } from "../lib/logger"
import { redis } from "../lib/redis"

export interface AcademicPaper {
  id: string
  title: string
  authors: string[]
  abstract: string
  year: number
  venue?: string
  doi?: string
  arxivId?: string
  pmid?: string
  citationCount: number
  references?: string[]
  url: string
  openAccess: boolean
}

export interface CitationGraph {
  paper: AcademicPaper
  citations: AcademicPaper[]
  references: AcademicPaper[]
  depth: number
}

export interface TrendAnalysis {
  topic: string
  papersByYear: Record<number, number>
  topVenues: string[]
  topAuthors: string[]
  citationGrowth: number
  emergingSubtopics: string[]
}

interface SearchOptions {
  sources?: ("arxiv" | "pubmed" | "semanticscholar" | "crossref")[]
  limit?: number
  yearFrom?: number
  yearTo?: number
  openAccessOnly?: boolean
}

const CACHE_TTL = 3600  // 1 hour

class AcademicSearchIntegration {
  async search(query: string, options: SearchOptions = {}): Promise<AcademicPaper[]> {
    const { sources = ["arxiv", "pubmed", "semanticscholar", "crossref"], limit = 10 } = options
    Logger.info("[AcademicSearch] Searching", { query, sources })

    const tasks = sources.map(async (source) => {
      try {
        switch (source) {
          case "arxiv": return await this.searchArxiv(query, limit)
          case "pubmed": return await this.searchPubMed(query, limit)
          case "semanticscholar": return await this.searchSemanticScholar(query, limit)
          case "crossref": return await this.searchCrossRef(query, limit)
          default: return []
        }
      } catch (err: any) {
        Logger.warn(`[AcademicSearch] Source ${source} failed`, { error: err?.message })
        return []
      }
    })

    const allResults = await Promise.allSettled(tasks)
    let papers: AcademicPaper[] = []
    for (const r of allResults) {
      if (r.status === "fulfilled") papers.push(...r.value)
    }

    papers = this.deduplicatePapers(papers)

    if (options.yearFrom) papers = papers.filter((p) => p.year >= (options.yearFrom ?? 0))
    if (options.yearTo) papers = papers.filter((p) => p.year <= (options.yearTo ?? 9999))
    if (options.openAccessOnly) papers = papers.filter((p) => p.openAccess)

    papers.sort((a, b) => b.citationCount - a.citationCount)
    Logger.info("[AcademicSearch] Combined results", { count: papers.length })
    return papers.slice(0, limit * 2)
  }

  async searchArxiv(query: string, limit = 10): Promise<AcademicPaper[]> {
    const cacheKey = `academic:arxiv:${Buffer.from(query).toString("base64").slice(0, 40)}:${limit}`
    const cached = await this.getCache<AcademicPaper[]>(cacheKey)
    if (cached) return cached

    const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${limit}&sortBy=relevance`
    Logger.debug("[AcademicSearch] arXiv request", { url })

    const response = await axios.get<string>(url, { timeout: 15000, responseType: "text" })
    const papers = this.parseArxivXml(response.data)

    await this.setCache(cacheKey, papers)
    Logger.debug("[AcademicSearch] arXiv returned", { count: papers.length })
    return papers
  }

  async searchPubMed(query: string, limit = 10): Promise<AcademicPaper[]> {
    const cacheKey = `academic:pubmed:${Buffer.from(query).toString("base64").slice(0, 40)}:${limit}`
    const cached = await this.getCache<AcademicPaper[]>(cacheKey)
    if (cached) return cached

    // Step 1: Search for IDs
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${limit}&retmode=json`
    const searchResp = await axios.get<any>(searchUrl, { timeout: 15000 })
    const ids: string[] = searchResp.data?.esearchresult?.idlist ?? []
    if (ids.length === 0) return []

    // Step 2: Fetch details
    const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids.join(",")}&retmode=xml`
    const fetchResp = await axios.get<string>(fetchUrl, { timeout: 20000, responseType: "text" })
    const papers = this.parsePubMedXml(fetchResp.data)

    await this.setCache(cacheKey, papers)
    Logger.debug("[AcademicSearch] PubMed returned", { count: papers.length })
    return papers
  }

  async searchSemanticScholar(query: string, limit = 10): Promise<AcademicPaper[]> {
    const cacheKey = `academic:ss:${Buffer.from(query).toString("base64").slice(0, 40)}:${limit}`
    const cached = await this.getCache<AcademicPaper[]>(cacheKey)
    if (cached) return cached

    const fields = "title,authors,year,citationCount,abstract,openAccessPdf,venue,externalIds"
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`
    const response = await axios.get<any>(url, {
      timeout: 15000,
      headers: { "User-Agent": "IliaGPT/1.0 (research; mailto:support@iliagpt.com)" },
    })

    const items: any[] = response.data?.data ?? []
    const papers: AcademicPaper[] = items.map((p: any) => ({
      id: p.paperId ?? p.externalIds?.DOI ?? "",
      title: p.title ?? "",
      authors: (p.authors ?? []).map((a: any) => a.name ?? ""),
      abstract: p.abstract ?? "",
      year: p.year ?? 0,
      venue: p.venue ?? undefined,
      doi: p.externalIds?.DOI ?? undefined,
      arxivId: p.externalIds?.ArXiv ?? undefined,
      citationCount: p.citationCount ?? 0,
      url: p.openAccessPdf?.url ?? `https://www.semanticscholar.org/paper/${p.paperId}`,
      openAccess: !!p.openAccessPdf?.url,
    }))

    await this.setCache(cacheKey, papers)
    Logger.debug("[AcademicSearch] Semantic Scholar returned", { count: papers.length })
    return papers
  }

  async searchCrossRef(query: string, limit = 10): Promise<AcademicPaper[]> {
    const cacheKey = `academic:crossref:${Buffer.from(query).toString("base64").slice(0, 40)}:${limit}`
    const cached = await this.getCache<AcademicPaper[]>(cacheKey)
    if (cached) return cached

    const fields = "title,author,published,DOI,abstract,is-referenced-by-count,container-title"
    const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${limit}&select=${fields}`
    const response = await axios.get<any>(url, {
      timeout: 15000,
      headers: { "User-Agent": "IliaGPT/1.0 (mailto:support@iliagpt.com)" },
    })

    const items: any[] = response.data?.message?.items ?? []
    const papers: AcademicPaper[] = items.map((p: any) => {
      const published = p.published?.["date-parts"]?.[0] ?? []
      const year = published[0] ?? 0
      const doi = p.DOI ?? ""
      return {
        id: doi || `crossref:${Math.random()}`,
        title: Array.isArray(p.title) ? (p.title[0] ?? "") : (p.title ?? ""),
        authors: (p.author ?? []).map((a: any) => `${a.given ?? ""} ${a.family ?? ""}`.trim()),
        abstract: p.abstract ? p.abstract.replace(/<[^>]+>/g, "") : "",
        year,
        venue: Array.isArray(p["container-title"]) ? p["container-title"][0] : undefined,
        doi: doi || undefined,
        citationCount: p["is-referenced-by-count"] ?? 0,
        url: doi ? `https://doi.org/${doi}` : "",
        openAccess: false,
      }
    })

    await this.setCache(cacheKey, papers)
    Logger.debug("[AcademicSearch] CrossRef returned", { count: papers.length })
    return papers
  }

  async buildCitationGraph(paperId: string, depth = 1): Promise<CitationGraph> {
    Logger.info("[AcademicSearch] Building citation graph", { paperId, depth })

    const cacheKey = `academic:citgraph:${paperId}:${depth}`
    const cached = await this.getCache<CitationGraph>(cacheKey)
    if (cached) return cached

    const fields = "title,authors,year,citationCount,abstract,openAccessPdf,venue,externalIds"
    const paperUrl = `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(paperId)}?fields=${fields},citations,references`

    const response = await axios.get<any>(paperUrl, {
      timeout: 20000,
      headers: { "User-Agent": "IliaGPT/1.0" },
    })

    const p = response.data
    const paper = this.ssItemToAcademicPaper(p)

    const citations: AcademicPaper[] = (p.citations ?? []).slice(0, 20).map((c: any) =>
      this.ssItemToAcademicPaper(c.citingPaper ?? c)
    )
    const references: AcademicPaper[] = (p.references ?? []).slice(0, 20).map((r: any) =>
      this.ssItemToAcademicPaper(r.citedPaper ?? r)
    )

    const graph: CitationGraph = { paper, citations, references, depth }
    await this.setCache(cacheKey, graph, 3600)
    return graph
  }

  async detectTrends(topic: string): Promise<TrendAnalysis> {
    Logger.info("[AcademicSearch] Detecting trends", { topic })

    const currentYear = new Date().getFullYear()
    const papers = await this.searchSemanticScholar(topic, 100)

    const papersByYear: Record<number, number> = {}
    const venueCount: Record<string, number> = {}
    const authorCount: Record<string, number> = {}

    for (const paper of papers) {
      if (paper.year >= 2015) {
        papersByYear[paper.year] = (papersByYear[paper.year] ?? 0) + 1
      }
      if (paper.venue) {
        venueCount[paper.venue] = (venueCount[paper.venue] ?? 0) + 1
      }
      for (const author of paper.authors) {
        if (author) authorCount[author] = (authorCount[author] ?? 0) + 1
      }
    }

    const topVenues = Object.entries(venueCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([v]) => v)

    const topAuthors = Object.entries(authorCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([a]) => a)

    const lastYearCount = papersByYear[currentYear - 1] ?? 0
    const twoYearsAgoCount = papersByYear[currentYear - 3] ?? 1
    const citationGrowth = twoYearsAgoCount > 0
      ? ((lastYearCount - twoYearsAgoCount) / twoYearsAgoCount) * 100
      : 0

    return {
      topic,
      papersByYear,
      topVenues,
      topAuthors,
      citationGrowth: Math.round(citationGrowth),
      emergingSubtopics: [],
    }
  }

  async getRelatedPapers(paperId: string, limit = 10): Promise<AcademicPaper[]> {
    const cacheKey = `academic:related:${paperId}:${limit}`
    const cached = await this.getCache<AcademicPaper[]>(cacheKey)
    if (cached) return cached

    const url = `https://api.semanticscholar.org/recommendations/v1/papers/forpaper/${encodeURIComponent(paperId)}?limit=${limit}&fields=title,authors,year,citationCount,abstract,openAccessPdf,venue`
    try {
      const response = await axios.get<any>(url, { timeout: 15000, headers: { "User-Agent": "IliaGPT/1.0" } })
      const papers: AcademicPaper[] = (response.data?.recommendedPapers ?? []).map((p: any) =>
        this.ssItemToAcademicPaper(p)
      )
      await this.setCache(cacheKey, papers)
      return papers
    } catch (err: any) {
      Logger.warn("[AcademicSearch] Related papers failed", { paperId, error: err?.message })
      return []
    }
  }

  parseArxivXml(xml: string): AcademicPaper[] {
    const papers: AcademicPaper[] = []
    const entries = xml.split("<entry>").slice(1)

    for (const entry of entries) {
      try {
        const id = (entry.match(/<id>([^<]+)<\/id>/)?.[1] ?? "").trim()
        const title = (entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "").replace(/\s+/g, " ").trim()
        const abstract = (entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? "").replace(/\s+/g, " ").trim()
        const published = entry.match(/<published>([^<]+)<\/published>/)?.[1] ?? ""
        const year = published ? parseInt(published.slice(0, 4), 10) : 0

        const authorMatches = [...entry.matchAll(/<name>([^<]+)<\/name>/g)]
        const authors = authorMatches.map((m) => m[1].trim())

        const arxivId = id.replace("http://arxiv.org/abs/", "").trim()

        papers.push({
          id: arxivId,
          title,
          authors,
          abstract,
          year,
          arxivId,
          citationCount: 0,
          url: id,
          openAccess: true,
        })
      } catch (err) {
        Logger.debug("[AcademicSearch] arXiv XML parse error on entry", { error: (err as Error).message })
      }
    }

    return papers
  }

  parsePubMedXml(xml: string): AcademicPaper[] {
    const papers: AcademicPaper[] = []
    const articles = xml.split("<PubmedArticle>").slice(1)

    for (const article of articles) {
      try {
        const pmid = article.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1] ?? ""
        const title = (article.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/)?.[1] ?? "")
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim()

        const abstractText = (article.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/)?.[1] ?? "")
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim()

        const year = parseInt(
          article.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/)?.[1] ??
          article.match(/<Year>(\d{4})<\/Year>/)?.[1] ?? "0",
          10
        )

        const authorMatches = [...article.matchAll(/<LastName>([^<]+)<\/LastName>[\s\S]*?<ForeName>([^<]*)<\/ForeName>/g)]
        const authors = authorMatches.map((m) => `${m[2]} ${m[1]}`.trim())

        const journalMatch = article.match(/<Title>([\s\S]*?)<\/Title>/)
        const venue = journalMatch ? journalMatch[1].replace(/\s+/g, " ").trim() : undefined

        const doiMatch = article.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/)
        const doi = doiMatch ? doiMatch[1].trim() : undefined

        papers.push({
          id: pmid,
          title,
          authors,
          abstract: abstractText,
          year,
          venue,
          doi,
          pmid,
          citationCount: 0,
          url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
          openAccess: false,
        })
      } catch (err) {
        Logger.debug("[AcademicSearch] PubMed XML parse error", { error: (err as Error).message })
      }
    }

    return papers
  }

  deduplicatePapers(papers: AcademicPaper[]): AcademicPaper[] {
    const seen = new Map<string, AcademicPaper>()

    for (const p of papers) {
      // Deduplicate by DOI first
      if (p.doi) {
        const key = `doi:${p.doi.toLowerCase()}`
        if (!seen.has(key) || seen.get(key)!.citationCount < p.citationCount) {
          seen.set(key, p)
        }
        continue
      }

      // Deduplicate by arXiv ID
      if (p.arxivId) {
        const key = `arxiv:${p.arxivId.toLowerCase()}`
        if (!seen.has(key) || seen.get(key)!.citationCount < p.citationCount) {
          seen.set(key, p)
        }
        continue
      }

      // Deduplicate by normalized title
      const normalTitle = p.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40)
      const key = `title:${normalTitle}`
      if (!seen.has(key) || seen.get(key)!.citationCount < p.citationCount) {
        seen.set(key, p)
      }
    }

    return Array.from(seen.values())
  }

  private ssItemToAcademicPaper(p: any): AcademicPaper {
    return {
      id: p.paperId ?? p.externalIds?.DOI ?? "",
      title: p.title ?? "",
      authors: (p.authors ?? []).map((a: any) => a.name ?? ""),
      abstract: p.abstract ?? "",
      year: p.year ?? 0,
      venue: p.venue ?? undefined,
      doi: p.externalIds?.DOI ?? undefined,
      arxivId: p.externalIds?.ArXiv ?? undefined,
      citationCount: p.citationCount ?? 0,
      url: p.openAccessPdf?.url ?? `https://www.semanticscholar.org/paper/${p.paperId ?? ""}`,
      openAccess: !!p.openAccessPdf?.url,
    }
  }

  private async getCache<T>(key: string): Promise<T | null> {
    try {
      const cached = await redis.get(key)
      if (cached) return JSON.parse(cached) as T
    } catch (err) {
      Logger.debug("[AcademicSearch] Cache read failed", { key, error: (err as Error).message })
    }
    return null
  }

  private async setCache<T>(key: string, value: T, ttl = CACHE_TTL): Promise<void> {
    try {
      await redis.setex(key, ttl, JSON.stringify(value))
    } catch (err) {
      Logger.debug("[AcademicSearch] Cache write failed", { key, error: (err as Error).message })
    }
  }
}

export const academicSearch = new AcademicSearchIntegration()
