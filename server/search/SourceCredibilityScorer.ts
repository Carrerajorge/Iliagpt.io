/**
 * SourceCredibilityScorer — evaluates trustworthiness and bias of web sources.
 * Factors: TLD, domain age heuristics, HTTPS, known publisher lists, bias indicators.
 * Outputs a normalized 0–1 score with per-factor explanation.
 */

import { createLogger } from "../utils/logger";

const logger = createLogger("SourceCredibilityScorer");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CredibilityScore {
  url: string;
  domain: string;
  overall: number; // 0–1
  factors: CredibilityFactor[];
  biasLeaning?: "left" | "center-left" | "center" | "center-right" | "right" | "unknown";
  freshnessScore?: number;
  explanation: string;
}

export interface CredibilityFactor {
  name: string;
  score: number; // 0–1
  weight: number;
  detail: string;
}

export interface ScoringOptions {
  publishedAt?: string;
  preferFresh?: boolean;
}

// ─── Domain Knowledge Bases ───────────────────────────────────────────────────

const HIGH_CREDIBILITY_DOMAINS = new Set([
  "nature.com", "science.org", "nejm.org", "thelancet.com", "bmj.com",
  "pubmed.ncbi.nlm.nih.gov", "scholar.google.com", "arxiv.org",
  "who.int", "cdc.gov", "nih.gov", "fda.gov", "nasa.gov",
  "reuters.com", "apnews.com", "bbc.com", "theguardian.com",
  "nytimes.com", "wsj.com", "economist.com", "ft.com",
  "mit.edu", "stanford.edu", "harvard.edu", "ox.ac.uk", "cam.ac.uk",
  "wikipedia.org", "britannica.com",
]);

const LOW_CREDIBILITY_DOMAINS = new Set([
  "naturalnews.com", "infowars.com", "beforeitsnews.com", "worldnewsdailyreport.com",
  "empirenews.net", "theonion.com", "clickhole.com", "babylonbee.com",
  "yournewswire.com", "newspunch.com", "neonnettle.com",
]);

const FACT_CHECK_DOMAINS = new Set([
  "snopes.com", "factcheck.org", "politifact.com", "fullfact.org",
  "reuters.com/fact-check", "apnews.com/APFactCheck", "leadstories.com",
]);

// Political bias data (Center-left, Center-right, etc.) from media bias resources
const DOMAIN_BIAS_MAP: Record<string, CredibilityScore["biasLeaning"]> = {
  "foxnews.com": "right",
  "breitbart.com": "right",
  "nationalreview.com": "center-right",
  "wsj.com": "center-right",
  "economist.com": "center",
  "reuters.com": "center",
  "apnews.com": "center",
  "bbc.com": "center",
  "nytimes.com": "center-left",
  "washingtonpost.com": "center-left",
  "theguardian.com": "center-left",
  "msnbc.com": "left",
  "motherjones.com": "left",
  "jacobinmag.com": "left",
};

// TLD credibility tiers
const TLD_SCORES: Record<string, number> = {
  ".edu": 0.9,
  ".gov": 0.95,
  ".ac.uk": 0.88,
  ".ac.": 0.85,
  ".org": 0.65,
  ".com": 0.55,
  ".net": 0.5,
  ".io": 0.5,
  ".info": 0.4,
  ".biz": 0.3,
  ".xyz": 0.2,
  ".click": 0.15,
  ".buzz": 0.15,
};

// ─── Scoring Functions ────────────────────────────────────────────────────────

function scoreTld(domain: string): CredibilityFactor {
  for (const [tld, score] of Object.entries(TLD_SCORES)) {
    if (domain.endsWith(tld)) {
      return { name: "tld", score, weight: 0.15, detail: `TLD "${tld}" score: ${score}` };
    }
  }
  return { name: "tld", score: 0.4, weight: 0.15, detail: "Unknown TLD" };
}

function scoreKnownDomain(domain: string): CredibilityFactor {
  const normalized = domain.replace(/^www\./, "");

  if (HIGH_CREDIBILITY_DOMAINS.has(normalized)) {
    return { name: "known_domain", score: 0.95, weight: 0.3, detail: "High-credibility publisher" };
  }
  if (LOW_CREDIBILITY_DOMAINS.has(normalized)) {
    return { name: "known_domain", score: 0.05, weight: 0.3, detail: "Low-credibility / satire domain" };
  }
  if (FACT_CHECK_DOMAINS.has(normalized)) {
    return { name: "known_domain", score: 0.9, weight: 0.3, detail: "Fact-checking organization" };
  }

  return { name: "known_domain", score: 0.5, weight: 0.3, detail: "Unknown domain — neutral baseline" };
}

function scoreHttps(url: string): CredibilityFactor {
  const isHttps = url.startsWith("https://");
  return {
    name: "https",
    score: isHttps ? 1.0 : 0.2,
    weight: 0.1,
    detail: isHttps ? "HTTPS encrypted" : "HTTP unencrypted",
  };
}

function scoreDomainStructure(domain: string): CredibilityFactor {
  // Subdomain count heuristic: many subdomains can indicate aggregation/spam sites
  const parts = domain.split(".");
  const subdomainCount = Math.max(0, parts.length - 2);

  // Numeric domains or very long domains are suspicious
  const hasNumbers = /\d/.test(parts[0] ?? "");
  const isLong = (parts[0]?.length ?? 0) > 20;

  let score = 0.7;
  if (subdomainCount > 2) score -= 0.15;
  if (hasNumbers) score -= 0.1;
  if (isLong) score -= 0.1;
  score = Math.max(0.1, score);

  return {
    name: "domain_structure",
    score,
    weight: 0.1,
    detail: `Subdomains: ${subdomainCount}, numeric: ${hasNumbers}, long name: ${isLong}`,
  };
}

function scoreFreshness(publishedAt: string | undefined, preferFresh: boolean): CredibilityFactor {
  if (!publishedAt) {
    return { name: "freshness", score: 0.5, weight: 0.15, detail: "No publication date available" };
  }

  const pub = new Date(publishedAt);
  if (isNaN(pub.getTime())) {
    return { name: "freshness", score: 0.5, weight: 0.15, detail: "Invalid date format" };
  }

  const ageMs = Date.now() - pub.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  let score: number;
  if (ageDays < 1) score = 1.0;
  else if (ageDays < 7) score = 0.95;
  else if (ageDays < 30) score = 0.85;
  else if (ageDays < 90) score = 0.75;
  else if (ageDays < 365) score = 0.65;
  else if (ageDays < 365 * 2) score = 0.5;
  else if (ageDays < 365 * 5) score = 0.35;
  else score = 0.2;

  const weight = preferFresh ? 0.25 : 0.1;

  return {
    name: "freshness",
    score,
    weight,
    detail: `Published ${Math.round(ageDays)} days ago`,
  };
}

function detectBiasLeaning(domain: string): CredibilityScore["biasLeaning"] {
  const normalized = domain.replace(/^www\./, "");
  return DOMAIN_BIAS_MAP[normalized] ?? "unknown";
}

function detectBiasInText(content: string): number {
  // Heuristic: loaded/emotional language reduces credibility
  const biasWords = [
    "radical", "extreme", "corrupt", "evil", "destroy", "hoax", "conspiracy",
    "regime", "puppet", "shill", "traitor", "invader", "invasion",
    "woke", "snowflake", "nazi", "communist", "socialist agenda",
  ];

  const lower = content.toLowerCase();
  const hits = biasWords.filter((w) => lower.includes(w)).length;
  const penalty = Math.min(0.4, hits * 0.04);
  return Math.max(0, 1 - penalty);
}

// ─── Blacklist / Whitelist ────────────────────────────────────────────────────

const customBlacklist = new Set<string>();
const customWhitelist = new Set<string>();

// ─── Main Scorer ──────────────────────────────────────────────────────────────

export class SourceCredibilityScorer {
  addToBlacklist(domain: string): void {
    customBlacklist.add(domain.replace(/^www\./, ""));
  }

  addToWhitelist(domain: string): void {
    customWhitelist.add(domain.replace(/^www\./, ""));
  }

  removeFromBlacklist(domain: string): void {
    customBlacklist.delete(domain.replace(/^www\./, ""));
  }

  score(url: string, options: ScoringOptions = {}): CredibilityScore {
    let domain: string;

    try {
      domain = new URL(url).hostname.toLowerCase();
    } catch {
      return {
        url,
        domain: url,
        overall: 0.1,
        factors: [],
        explanation: "Invalid URL",
      };
    }

    const normalized = domain.replace(/^www\./, "");

    // Custom lists override everything
    if (customBlacklist.has(normalized)) {
      return {
        url,
        domain,
        overall: 0.0,
        factors: [],
        explanation: "Domain is on the custom blacklist",
        biasLeaning: "unknown",
      };
    }

    if (customWhitelist.has(normalized)) {
      return {
        url,
        domain,
        overall: 1.0,
        factors: [],
        explanation: "Domain is on the custom whitelist",
        biasLeaning: detectBiasLeaning(domain),
      };
    }

    const factors: CredibilityFactor[] = [
      scoreTld(domain),
      scoreKnownDomain(domain),
      scoreHttps(url),
      scoreDomainStructure(domain),
      scoreFreshness(options.publishedAt, options.preferFresh ?? false),
    ];

    // Weighted average
    const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
    const weightedSum = factors.reduce((s, f) => s + f.score * f.weight, 0);
    const overall = Math.min(1, Math.max(0, weightedSum / totalWeight));

    const biasLeaning = detectBiasLeaning(domain);

    const explanation = factors
      .map((f) => `${f.name} (${Math.round(f.score * 100)}%): ${f.detail}`)
      .join("; ");

    logger.debug(`Credibility score for ${domain}: ${overall.toFixed(2)}`);

    return {
      url,
      domain,
      overall: Math.round(overall * 100) / 100,
      factors,
      biasLeaning,
      freshnessScore: factors.find((f) => f.name === "freshness")?.score,
      explanation,
    };
  }

  scoreMany(urls: Array<{ url: string; publishedAt?: string }>): CredibilityScore[] {
    return urls
      .map((u) => this.score(u.url, { publishedAt: u.publishedAt }))
      .sort((a, b) => b.overall - a.overall);
  }

  filterByMinScore(urls: Array<{ url: string; publishedAt?: string }>, minScore: number): Array<{ url: string; score: CredibilityScore }> {
    return urls
      .map((u) => ({ url: u.url, score: this.score(u.url, { publishedAt: u.publishedAt }) }))
      .filter((r) => r.score.overall >= minScore);
  }

  isReliable(url: string): boolean {
    return this.score(url).overall >= 0.65;
  }

  isSatireOrFake(url: string): boolean {
    return this.score(url).overall < 0.2;
  }

  scoreWithContent(url: string, content: string, options: ScoringOptions = {}): CredibilityScore {
    const base = this.score(url, options);
    const contentBias = detectBiasInText(content);

    // Blend content bias into overall score with low weight
    const blended = base.overall * 0.85 + contentBias * 0.15;

    return {
      ...base,
      overall: Math.round(blended * 100) / 100,
      factors: [
        ...base.factors,
        {
          name: "content_bias",
          score: contentBias,
          weight: 0.15,
          detail: `Loaded/emotional language score: ${Math.round(contentBias * 100)}%`,
        },
      ],
    };
  }
}

export const sourceCredibilityScorer = new SourceCredibilityScorer();
