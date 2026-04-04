import { Logger } from "../lib/logger"
import { redis } from "../lib/redis"

export interface CredibilityScore {
  url: string
  domain: string
  overall: number
  trustScore: number
  biasScore: number
  freshnessScore: number
  category: "academic" | "news" | "government" | "commercial" | "blog" | "social" | "unknown"
  flags: string[]
  tldBonus: number
}

interface BiasInfo {
  bias: "left" | "right" | "center" | "extreme"
  score: number
}

const CACHE_TTL_SEC = 86400  // 24 hours

class SourceCredibilityScorer {
  private whitelist: Set<string>
  private blacklist: Set<string>
  private biasedDomains: Map<string, BiasInfo>

  constructor() {
    this.whitelist = this.buildWhitelist()
    this.blacklist = this.buildBlacklist()
    this.biasedDomains = this.buildBiasMap()
  }

  async score(url: string, publishedAt?: string): Promise<CredibilityScore> {
    const domain = this.extractDomain(url)
    const cacheKey = `credibility:${domain}:${publishedAt ?? "nodate"}`

    try {
      const cached = await redis.get(cacheKey)
      if (cached) return JSON.parse(cached)
    } catch (err) {
      Logger.debug("[Credibility] Cache read failed", { error: (err as Error).message })
    }

    const result = this.computeScore(url, domain, publishedAt)

    try {
      await redis.setex(cacheKey, CACHE_TTL_SEC, JSON.stringify(result))
    } catch (err) {
      Logger.debug("[Credibility] Cache write failed", { error: (err as Error).message })
    }

    return result
  }

  async scoreBatch(urls: string[]): Promise<CredibilityScore[]> {
    return Promise.all(urls.map((url) => this.score(url)))
  }

  private computeScore(url: string, domain: string, publishedAt?: string): CredibilityScore {
    const flags: string[] = []
    const tld = this.extractTld(domain)

    if (this.blacklist.has(domain)) {
      flags.push("blacklisted", "known_misinformation")
    }

    const tldBonus = this.scoreByTld(domain)
    const domainAuthority = this.scoreDomainAuthority(domain)
    const freshnessScore = this.scoreFreshness(publishedAt)
    const biasInfo = this.detectBias(domain)
    const category = this.categorize(domain, tld)

    if (biasInfo.score > 0.6) flags.push("known_bias")
    if (biasInfo.score > 0.85) flags.push("extreme_bias")
    if (freshnessScore < 0.3) flags.push("outdated")
    if (this.isPotentiallySatire(domain)) flags.push("satire")
    if (this.isPaywalled(domain)) flags.push("paywalled")

    let trustScore = this.blacklist.has(domain) ? 0.05 : domainAuthority + tldBonus
    trustScore = Math.min(trustScore, 1.0)

    const biasScore = biasInfo.score
    const overall = this.blacklist.has(domain)
      ? 0.05
      : trustScore * 0.5 + (1 - biasScore) * 0.3 + freshnessScore * 0.2

    return {
      url,
      domain,
      overall: Math.min(Math.max(overall, 0), 1),
      trustScore: Math.min(trustScore, 1),
      biasScore,
      freshnessScore,
      category,
      flags,
      tldBonus,
    }
  }

  private scoreByTld(domain: string): number {
    if (domain.endsWith(".edu")) return 0.3
    if (domain.endsWith(".gov")) return 0.2
    if (/\.ac\.[a-z]{2}$/.test(domain)) return 0.25
    if (domain.endsWith(".org")) return 0.1
    if (domain.endsWith(".com") || domain.endsWith(".net")) return 0
    if (domain.endsWith(".info") || domain.endsWith(".biz")) return -0.1
    return 0
  }

  private scoreFreshness(publishedAt?: string): number {
    if (!publishedAt) return 0.5  // unknown freshness
    const pubDate = new Date(publishedAt)
    if (isNaN(pubDate.getTime())) return 0.5
    const now = Date.now()
    const ageMs = now - pubDate.getTime()
    const DAY = 86400000
    if (ageMs < DAY) return 1.0
    if (ageMs < 7 * DAY) return 0.9
    if (ageMs < 30 * DAY) return 0.7
    if (ageMs < 365 * DAY) return 0.4
    return 0.1
  }

  private detectBias(domain: string): { score: number; direction?: string } {
    const info = this.biasedDomains.get(domain)
    if (!info) return { score: 0 }
    return { score: info.score, direction: info.bias }
  }

  private scoreDomainAuthority(domain: string): number {
    // Tier 1: 0.95+ — top academic, scientific, and established news
    const tier1 = new Set([
      "nature.com", "sciencedirect.com", "pubmed.ncbi.nlm.nih.gov", "arxiv.org",
      "nytimes.com", "bbc.com", "bbc.co.uk", "reuters.com", "who.int", "cdc.gov",
      "nasa.gov", "nih.gov", "ncbi.nlm.nih.gov", "science.org", "thelancet.com",
      "nejm.org", "cell.com", "pnas.org", "journals.plos.org", "ieee.org",
    ])
    if (tier1.has(domain)) return 0.95

    // Tier 2: 0.80 — high quality reference and journalism
    const tier2 = new Set([
      "wikipedia.org", "britannica.com", "wired.com", "theatlantic.com",
      "scientificamerican.com", "washingtonpost.com", "theguardian.com",
      "economist.com", "ft.com", "wsj.com", "apnews.com", "npr.org",
      "pbs.org", "smithsonianmag.com", "nationalgeographic.com", "newscientist.com",
      "technologyreview.com", "spectrum.ieee.org", "acm.org",
    ])
    if (tier2.has(domain)) return 0.8

    // Tier 3: 0.60 — mixed quality
    const tier3 = new Set([
      "medium.com", "substack.com", "forbes.com", "businessinsider.com",
      "huffpost.com", "vox.com", "theconversation.com", "slate.com",
      "salon.com", "reason.com", "vice.com", "buzzfeednews.com", "fivethirtyeight.com",
    ])
    if (tier3.has(domain)) return 0.6

    // Tier 4: 0.30 — default for unknown
    return 0.3
  }

  private categorize(domain: string, tld: string): CredibilityScore["category"] {
    const academicDomains = ["arxiv.org", "pubmed.ncbi.nlm.nih.gov", "semanticscholar.org", "jstor.org", "acm.org", "ieee.org"]
    if (academicDomains.some((d) => domain.includes(d))) return "academic"
    if (tld === ".edu" || /\.ac\.[a-z]{2}$/.test(domain)) return "academic"

    const govDomains = [".gov", ".mil"]
    if (govDomains.some((d) => domain.endsWith(d))) return "government"

    const newsDomains = ["nytimes.com", "bbc.com", "reuters.com", "apnews.com", "cnn.com", "foxnews.com",
      "washingtonpost.com", "theguardian.com", "wsj.com", "ft.com", "npr.org",
      "huffpost.com", "vox.com", "theatlantic.com", "slate.com"]
    if (newsDomains.some((d) => domain.includes(d))) return "news"

    const socialDomains = ["twitter.com", "x.com", "facebook.com", "instagram.com",
      "reddit.com", "linkedin.com", "tiktok.com", "youtube.com", "quora.com"]
    if (socialDomains.some((d) => domain.includes(d))) return "social"

    const blogIndicators = ["medium.com", "substack.com", "blogspot.com", "wordpress.com", "tumblr.com"]
    if (blogIndicators.some((d) => domain.includes(d))) return "blog"

    if (tld === ".com" || tld === ".net" || tld === ".io") return "commercial"

    return "unknown"
  }

  private isPotentiallySatire(domain: string): boolean {
    const satire = new Set([
      "theonion.com", "clickhole.com", "babylonbee.com", "thebeaverton.com",
      "waterfordwhispersnews.com", "newsthump.com", "palmerreport.com",
      "duffelblog.com", "reductress.com",
    ])
    return satire.has(domain)
  }

  private isPaywalled(domain: string): boolean {
    const paywalled = new Set([
      "wsj.com", "ft.com", "nytimes.com", "washingtonpost.com", "economist.com",
      "thetimes.co.uk", "newyorker.com", "wired.com", "theatlantic.com", "bloomberg.com",
    ])
    return paywalled.has(domain)
  }

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, "")
    } catch {
      return url.split("/")[2]?.replace(/^www\./, "") ?? url
    }
  }

  private extractTld(domain: string): string {
    const parts = domain.split(".")
    return parts.length >= 2 ? `.${parts[parts.length - 1]}` : ""
  }

  private buildWhitelist(): Set<string> {
    return new Set([
      // Academic & Scientific
      "nature.com", "sciencedirect.com", "pubmed.ncbi.nlm.nih.gov", "arxiv.org",
      "science.org", "thelancet.com", "nejm.org", "cell.com", "pnas.org",
      "journals.plos.org", "ieee.org", "acm.org", "springer.com", "wiley.com",
      "jstor.org", "semanticscholar.org", "researchgate.net", "scholar.google.com",
      "ncbi.nlm.nih.gov", "nih.gov",
      // News & Journalism
      "reuters.com", "apnews.com", "bbc.com", "bbc.co.uk", "nytimes.com",
      "theguardian.com", "washingtonpost.com", "wsj.com", "ft.com",
      "economist.com", "npr.org", "pbs.org", "cbsnews.com", "nbcnews.com",
      "abcnews.go.com", "politico.com", "thehill.com",
      // Government & Health
      "who.int", "cdc.gov", "nasa.gov", "nih.gov", "fda.gov", "epa.gov",
      "whitehouse.gov", "congress.gov", "un.org", "europa.eu",
      // Reference
      "wikipedia.org", "britannica.com", "merriam-webster.com",
      // Science communication
      "scientificamerican.com", "newscientist.com", "technologyreview.com",
      "smithsonianmag.com", "nationalgeographic.com", "discovermagazine.com",
      "theconversation.com", "factcheck.org", "snopes.com",
    ])
  }

  private buildBlacklist(): Set<string> {
    return new Set([
      // Known misinformation and conspiracy
      "infowars.com", "naturalnews.com", "breitbart.com", "zerohedge.com",
      "beforeitsnews.com", "worldnewsdailyreport.com", "yournewswire.com",
      "newspunch.com", "activistpost.com", "globalresearch.ca",
      "veteranstoday.com", "stormfront.org", "dailystormer.name",
      "thegatewaypundit.com", "100percentfedup.com", "conservativedailypost.com",
      "mediamass.net", "huzlers.com", "empirenews.net", "nationalreport.net",
      "theuspatriot.com", "usapoliticstoday.com",
    ])
  }

  private buildBiasMap(): Map<string, BiasInfo> {
    return new Map([
      // Left-leaning
      ["salon.com", { bias: "left", score: 0.65 }],
      ["motherjones.com", { bias: "left", score: 0.65 }],
      ["thenation.com", { bias: "left", score: 0.65 }],
      ["huffpost.com", { bias: "left", score: 0.55 }],
      ["vox.com", { bias: "left", score: 0.5 }],
      ["slate.com", { bias: "left", score: 0.5 }],
      ["democracynow.org", { bias: "left", score: 0.6 }],
      ["jacobinmag.com", { bias: "left", score: 0.7 }],
      ["currentaffairs.org", { bias: "left", score: 0.65 }],
      ["truthout.org", { bias: "left", score: 0.65 }],
      // Right-leaning
      ["foxnews.com", { bias: "right", score: 0.65 }],
      ["dailywire.com", { bias: "right", score: 0.75 }],
      ["nationalreview.com", { bias: "right", score: 0.55 }],
      ["weeklystandard.com", { bias: "right", score: 0.55 }],
      ["reason.com", { bias: "right", score: 0.5 }],
      ["theblaze.com", { bias: "right", score: 0.7 }],
      ["townhall.com", { bias: "right", score: 0.7 }],
      ["washingtonexaminer.com", { bias: "right", score: 0.6 }],
      ["nypost.com", { bias: "right", score: 0.6 }],
      ["westernjournal.com", { bias: "right", score: 0.65 }],
      // Center
      ["reuters.com", { bias: "center", score: 0.1 }],
      ["apnews.com", { bias: "center", score: 0.1 }],
      ["bbc.com", { bias: "center", score: 0.15 }],
      ["economist.com", { bias: "center", score: 0.2 }],
      ["thehill.com", { bias: "center", score: 0.25 }],
      ["axios.com", { bias: "center", score: 0.2 }],
      // Extreme
      ["infowars.com", { bias: "extreme", score: 0.95 }],
      ["breitbart.com", { bias: "extreme", score: 0.9 }],
      ["stormfront.org", { bias: "extreme", score: 1.0 }],
    ])
  }

  isBlacklisted(url: string): boolean {
    const domain = this.extractDomain(url)
    return this.blacklist.has(domain)
  }

  getTopTrustedDomains(category?: string): string[] {
    const trusted = Array.from(this.whitelist)
    if (!category) return trusted
    return trusted.filter((d) => {
      const tld = this.extractTld(d)
      return this.categorize(d, tld) === category
    })
  }
}

export const credibilityScorer = new SourceCredibilityScorer()
