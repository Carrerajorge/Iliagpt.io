import { z } from "zod";
import type { QualityScore, QualityWeights, ContentMetadata } from "./types";
import { QualityWeightsSchema, ContentMetadataSchema } from "./types";
import { extractDomain } from "./canonicalizeUrl";

const DEFAULT_WEIGHTS: QualityWeights = {
  domain: 1,
  recency: 1,
  https: 1,
  authoritativeness: 1,
  contentLength: 1,
};

const AUTHORITATIVE_DOMAINS: Record<string, number> = {
  "wikipedia.org": 85,
  "wikimedia.org": 80,
  "britannica.com": 85,
  "nature.com": 95,
  "science.org": 95,
  "sciencedirect.com": 90,
  "springer.com": 90,
  "wiley.com": 90,
  "ncbi.nlm.nih.gov": 95,
  "pubmed.gov": 95,
  "nih.gov": 95,
  "cdc.gov": 90,
  "who.int": 90,
  "un.org": 85,
  "europa.eu": 85,
  "arxiv.org": 90,
  "ieee.org": 90,
  "acm.org": 90,
  "jstor.org": 85,
  "researchgate.net": 75,
  "scholar.google.com": 85,
  "semanticscholar.org": 85,
  "microsoft.com": 80,
  "google.com": 80,
  "apple.com": 80,
  "amazon.com": 75,
  "github.com": 80,
  "stackoverflow.com": 80,
  "mdn.mozilla.org": 90,
  "developer.mozilla.org": 90,
  "docs.python.org": 85,
  "nodejs.org": 85,
  "reactjs.org": 85,
  "vuejs.org": 85,
  "nytimes.com": 80,
  "bbc.com": 80,
  "bbc.co.uk": 80,
  "reuters.com": 85,
  "apnews.com": 85,
  "washingtonpost.com": 80,
  "theguardian.com": 80,
  "economist.com": 80,
  "forbes.com": 70,
  "bloomberg.com": 80,
  "wsj.com": 80,
};

const TLD_SCORES: Record<string, number> = {
  ".gov": 90,
  ".gov.uk": 90,
  ".gov.au": 90,
  ".edu": 85,
  ".edu.au": 85,
  ".ac.uk": 85,
  ".org": 60,
  ".int": 80,
  ".mil": 85,
};

const HTTPS_BONUS = 10;
const MIN_CONTENT_LENGTH = 500;
const OPTIMAL_CONTENT_LENGTH = 5000;
const MAX_RECENCY_DAYS = 365;

export function calculateQualityScore(
  url: string,
  headers: Headers | Record<string, string>,
  contentLength: number,
  weights?: Partial<QualityWeights>,
  metadata?: Partial<ContentMetadata>
): QualityScore {
  const parsedWeights = QualityWeightsSchema.safeParse(weights || {});
  const mergedWeights: QualityWeights = parsedWeights.success 
    ? { ...DEFAULT_WEIGHTS, ...parsedWeights.data }
    : DEFAULT_WEIGHTS;
  
  const domainScore = calculateDomainScore(url);
  const recencyScore = calculateRecencyScoreWithMetadata(headers, metadata);
  const httpsScore = calculateHttpsScore(url);
  const authoritativenessScore = calculateAuthoritativenessScoreWithMetadata(url, metadata);
  const contentLengthScore = calculateContentLengthScore(contentLength);
  
  const weightedDomain = Math.round(domainScore * mergedWeights.domain);
  const weightedRecency = Math.round(recencyScore * mergedWeights.recency);
  const weightedHttps = Math.round(httpsScore * mergedWeights.https);
  const weightedAuthoritativeness = Math.round(authoritativenessScore * mergedWeights.authoritativeness);
  const weightedContentLength = Math.round(contentLengthScore * mergedWeights.contentLength);
  
  const total = weightedDomain + weightedRecency + weightedHttps + weightedAuthoritativeness + weightedContentLength;
  
  return {
    domain: Math.min(weightedDomain, 100),
    recency: Math.min(weightedRecency, 100),
    https: Math.min(weightedHttps, 100),
    authoritativeness: Math.min(weightedAuthoritativeness, 100),
    contentLength: Math.min(weightedContentLength, 100),
    total: Math.min(total, 500),
  };
}

function calculateDomainScore(url: string): number {
  const domain = extractDomain(url);
  
  if (AUTHORITATIVE_DOMAINS[domain]) {
    return Math.min(AUTHORITATIVE_DOMAINS[domain], 100);
  }
  
  for (const [tld, score] of Object.entries(TLD_SCORES)) {
    if (domain.endsWith(tld)) {
      return score;
    }
  }
  
  if (domain.endsWith(".com")) return 50;
  if (domain.endsWith(".net")) return 45;
  if (domain.endsWith(".io")) return 55;
  if (domain.endsWith(".co")) return 45;
  
  return 40;
}

function calculateRecencyScore(headers: Headers | Record<string, string>): number {
  return calculateRecencyScoreWithMetadata(headers, undefined);
}

function calculateRecencyScoreWithMetadata(
  headers: Headers | Record<string, string>,
  metadata?: Partial<ContentMetadata>
): number {
  let lastModified: string | null = null;
  let date: string | null = null;
  
  if (headers instanceof Headers) {
    lastModified = headers.get("last-modified");
    date = headers.get("date");
  } else {
    lastModified = headers["last-modified"] || headers["Last-Modified"] || null;
    date = headers["date"] || headers["Date"] || null;
  }
  
  let dateStr = lastModified || date;
  
  if (metadata?.publishedDate) {
    dateStr = metadata.publishedDate;
  } else if (metadata?.modifiedDate) {
    dateStr = metadata.modifiedDate;
  } else if (metadata?.dateFromContent) {
    dateStr = metadata.dateFromContent;
  }
  
  if (!dateStr) {
    return 50;
  }
  
  try {
    const contentDate = new Date(dateStr);
    const now = new Date();
    const daysDiff = Math.floor((now.getTime() - contentDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysDiff < 0) return 50;
    if (daysDiff === 0) return 100;
    if (daysDiff <= 7) return 95;
    if (daysDiff <= 30) return 85;
    if (daysDiff <= 90) return 75;
    if (daysDiff <= 180) return 65;
    if (daysDiff <= MAX_RECENCY_DAYS) return 55;
    
    return 40;
  } catch {
    return 50;
  }
}

function calculateHttpsScore(url: string): number {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === "https:" ? HTTPS_BONUS : 0;
  } catch {
    return 0;
  }
}

function calculateAuthoritativenessScore(url: string): number {
  return calculateAuthoritativenessScoreWithMetadata(url, undefined);
}

function calculateAuthoritativenessScoreWithMetadata(
  url: string,
  metadata?: Partial<ContentMetadata>
): number {
  const domain = extractDomain(url);
  let baseScore = 40;
  
  if (AUTHORITATIVE_DOMAINS[domain]) {
    baseScore = Math.min(AUTHORITATIVE_DOMAINS[domain], 100);
  } else {
    for (const [tld, score] of Object.entries(TLD_SCORES)) {
      if (domain.endsWith(tld)) {
        baseScore = Math.min(score + 5, 100);
        break;
      }
    }
    
    if (baseScore === 40) {
      const parts = domain.split(".");
      if (parts.length >= 3) {
        const mainDomain = parts.slice(-2).join(".");
        if (AUTHORITATIVE_DOMAINS[mainDomain]) {
          baseScore = Math.min(AUTHORITATIVE_DOMAINS[mainDomain] - 5, 100);
        }
      }
    }
  }
  
  let bonus = 0;
  if (metadata?.author) {
    bonus += 5;
  }
  if (metadata?.hasCitations) {
    bonus += 10;
  }
  if (metadata?.hasReferences) {
    bonus += 5;
  }
  
  return Math.min(baseScore + bonus, 100);
}

function calculateContentLengthScore(contentLength: number): number {
  if (contentLength <= 0) return 0;
  if (contentLength < MIN_CONTENT_LENGTH) return 20;
  if (contentLength < 1000) return 40;
  if (contentLength < 2000) return 60;
  if (contentLength < OPTIMAL_CONTENT_LENGTH) return 80;
  if (contentLength < 10000) return 90;
  if (contentLength < 50000) return 100;
  
  return 85;
}

export function isHighQuality(score: QualityScore, threshold: number = 200): boolean {
  return score.total >= threshold;
}

export function getQualityLabel(score: QualityScore): "excellent" | "good" | "fair" | "poor" {
  if (score.total >= 350) return "excellent";
  if (score.total >= 250) return "good";
  if (score.total >= 150) return "fair";
  return "poor";
}
