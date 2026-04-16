import { z } from "zod";
import { extractDomain } from "../canonicalizeUrl";
import type { RetrievalResult, QualityScore } from "../types";
import { RelevanceFilter, type FilteredContent } from "../relevanceFilter";
import * as fs from "fs";
import * as path from "path";

export const SourceQualityInputSchema = z.object({
  url: z.string().url(),
  content: z.string(),
  contentLength: z.number().nonnegative(),
  qualityScore: z.object({
    domain: z.number().min(0).max(100),
    recency: z.number().min(0).max(100),
    https: z.number().min(0).max(100),
    authoritativeness: z.number().min(0).max(100),
    contentLength: z.number().min(0).max(100),
    total: z.number().min(0).max(500),
  }).optional(),
  metadata: z.object({
    author: z.string().optional(),
    hasCitations: z.boolean().optional(),
    hasReferences: z.boolean().optional(),
    publishedDate: z.string().optional(),
  }).optional(),
});
export type SourceQualityInput = z.infer<typeof SourceQualityInputSchema>;

export const DomainReputationEntrySchema = z.object({
  domain: z.string(),
  averageScore: z.number().min(0).max(1),
  sampleCount: z.number().int().nonnegative(),
  lastUpdated: z.number(),
  recentScores: z.array(z.number().min(0).max(1)),
});
export type DomainReputationEntry = z.infer<typeof DomainReputationEntrySchema>;

export const SourceQualityScorerConfigSchema = z.object({
  authorityWeight: z.number().min(0).max(1).default(0.3),
  freshnessWeight: z.number().min(0).max(1).default(0.2),
  contentDepthWeight: z.number().min(0).max(1).default(0.25),
  citationsWeight: z.number().min(0).max(1).default(0.15),
  domainReputationWeight: z.number().min(0).max(1).default(0.1),
  maxRecentScores: z.number().int().positive().default(10),
  reputationDecayFactor: z.number().min(0).max(1).default(0.9),
});
export type SourceQualityScorerConfig = z.infer<typeof SourceQualityScorerConfigSchema>;

const DEFAULT_SCORER_CONFIG: SourceQualityScorerConfig = {
  authorityWeight: 0.3,
  freshnessWeight: 0.2,
  contentDepthWeight: 0.25,
  citationsWeight: 0.15,
  domainReputationWeight: 0.1,
  maxRecentScores: 10,
  reputationDecayFactor: 0.9,
};

export class SourceQualityScorer {
  private domainReputations: Map<string, DomainReputationEntry> = new Map();
  private config: SourceQualityScorerConfig;

  constructor(config: Partial<SourceQualityScorerConfig> = {}) {
    this.config = { ...DEFAULT_SCORER_CONFIG, ...config };
  }

  getQualityScore(source: SourceQualityInput): number {
    const domain = extractDomain(source.url);
    
    const authorityScore = this.calculateAuthorityScore(source);
    const freshnessScore = this.calculateFreshnessScore(source);
    const contentDepthScore = this.calculateContentDepthScore(source);
    const citationsScore = this.calculateCitationsScore(source);
    const reputationScore = this.getDomainReputation(domain);

    const weightedScore =
      authorityScore * this.config.authorityWeight +
      freshnessScore * this.config.freshnessWeight +
      contentDepthScore * this.config.contentDepthWeight +
      citationsScore * this.config.citationsWeight +
      reputationScore * this.config.domainReputationWeight;

    return Math.min(Math.max(weightedScore, 0), 1);
  }

  private calculateAuthorityScore(source: SourceQualityInput): number {
    if (source.qualityScore) {
      return source.qualityScore.authoritativeness / 100;
    }
    return 0.5;
  }

  private calculateFreshnessScore(source: SourceQualityInput): number {
    if (source.qualityScore) {
      return source.qualityScore.recency / 100;
    }
    
    if (source.metadata?.publishedDate) {
      try {
        const published = new Date(source.metadata.publishedDate);
        const now = new Date();
        const daysDiff = Math.floor((now.getTime() - published.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysDiff <= 7) return 1.0;
        if (daysDiff <= 30) return 0.9;
        if (daysDiff <= 90) return 0.8;
        if (daysDiff <= 180) return 0.7;
        if (daysDiff <= 365) return 0.5;
        return 0.3;
      } catch {
        return 0.5;
      }
    }
    
    return 0.5;
  }

  private calculateContentDepthScore(source: SourceQualityInput): number {
    const content = source.content;
    const length = content.length;
    
    let baseScore = 0;
    if (length < 500) baseScore = 0.2;
    else if (length < 1000) baseScore = 0.4;
    else if (length < 2000) baseScore = 0.6;
    else if (length < 5000) baseScore = 0.8;
    else if (length < 10000) baseScore = 0.95;
    else baseScore = 0.9;

    const headingsMatch = content.match(/^#{1,6}\s+.+$/gm) || [];
    const hasStructure = headingsMatch.length >= 3 ? 0.1 : 0;

    const listMatch = content.match(/^[\s]*[-*•]\s+/gm) || [];
    const hasLists = listMatch.length >= 3 ? 0.05 : 0;

    const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 50);
    const hasParagraphs = paragraphs.length >= 3 ? 0.05 : 0;

    return Math.min(baseScore + hasStructure + hasLists + hasParagraphs, 1);
  }

  private calculateCitationsScore(source: SourceQualityInput): number {
    if (source.metadata?.hasCitations) return 0.9;
    if (source.metadata?.hasReferences) return 0.7;

    const content = source.content;
    
    const urlPattern = /https?:\/\/[^\s]+/g;
    const urls = content.match(urlPattern) || [];
    
    const citationPatterns = [
      /\[\d+\]/g,
      /\(\d{4}\)/g,
      /et al\./gi,
      /References?:/gi,
      /Bibliography/gi,
      /Sources?:/gi,
    ];
    
    let citationSignals = 0;
    for (const pattern of citationPatterns) {
      if (pattern.test(content)) {
        citationSignals++;
      }
    }

    if (urls.length >= 5 || citationSignals >= 3) return 0.8;
    if (urls.length >= 3 || citationSignals >= 2) return 0.6;
    if (urls.length >= 1 || citationSignals >= 1) return 0.4;
    
    return 0.2;
  }

  updateDomainReputation(domain: string, score: number): void {
    const normalizedDomain = domain.toLowerCase();
    const clampedScore = Math.min(Math.max(score, 0), 1);
    
    const existing = this.domainReputations.get(normalizedDomain);
    
    if (existing) {
      const recentScores = [...existing.recentScores, clampedScore]
        .slice(-this.config.maxRecentScores);
      
      const weightedSum = recentScores.reduce((sum, s, i) => {
        const weight = Math.pow(this.config.reputationDecayFactor, recentScores.length - 1 - i);
        return sum + s * weight;
      }, 0);
      
      const totalWeight = recentScores.reduce((sum, _, i) => {
        return sum + Math.pow(this.config.reputationDecayFactor, recentScores.length - 1 - i);
      }, 0);
      
      const newAverage = weightedSum / totalWeight;
      
      this.domainReputations.set(normalizedDomain, {
        domain: normalizedDomain,
        averageScore: newAverage,
        sampleCount: existing.sampleCount + 1,
        lastUpdated: Date.now(),
        recentScores,
      });
    } else {
      this.domainReputations.set(normalizedDomain, {
        domain: normalizedDomain,
        averageScore: clampedScore,
        sampleCount: 1,
        lastUpdated: Date.now(),
        recentScores: [clampedScore],
      });
    }
  }

  getDomainReputation(domain: string): number {
    const normalizedDomain = domain.toLowerCase();
    const entry = this.domainReputations.get(normalizedDomain);
    
    if (entry) {
      return entry.averageScore;
    }
    
    return 0.5;
  }

  getDomainReputationEntry(domain: string): DomainReputationEntry | undefined {
    return this.domainReputations.get(domain.toLowerCase());
  }

  getAllReputations(): DomainReputationEntry[] {
    return Array.from(this.domainReputations.values());
  }

  clearReputations(): void {
    this.domainReputations.clear();
  }
}

export const DomainDiversityResultSchema = z.object({
  passed: z.boolean(),
  uniqueDomains: z.array(z.string()),
  score: z.number().min(0).max(1),
  totalSources: z.number().int().nonnegative(),
  diversityRatio: z.number().min(0).max(1),
});
export type DomainDiversityResult = z.infer<typeof DomainDiversityResultSchema>;

export const DomainDiversityConfigSchema = z.object({
  minDomainDiversity: z.number().int().positive().default(3),
  optimalDiversity: z.number().int().positive().default(5),
  preferredDomains: z.array(z.string()).default([]),
  avoidDomains: z.array(z.string()).default([]),
});
export type DomainDiversityConfig = z.infer<typeof DomainDiversityConfigSchema>;

const ALTERNATIVE_DOMAIN_SUGGESTIONS: Record<string, string[]> = {
  "news": ["reuters.com", "apnews.com", "bbc.com", "npr.org", "theguardian.com"],
  "academic": ["scholar.google.com", "arxiv.org", "pubmed.gov", "jstor.org", "semanticscholar.org"],
  "technology": ["techcrunch.com", "arstechnica.com", "wired.com", "theverge.com", "zdnet.com"],
  "science": ["nature.com", "sciencemag.org", "scientificamerican.com", "newscientist.com"],
  "reference": ["wikipedia.org", "britannica.com", "merriam-webster.com"],
  "developer": ["stackoverflow.com", "github.com", "mdn.mozilla.org", "dev.to"],
  "business": ["bloomberg.com", "wsj.com", "forbes.com", "economist.com", "ft.com"],
  "health": ["mayoclinic.org", "webmd.com", "nih.gov", "who.int", "cdc.gov"],
};

export class DomainDiversityChecker {
  private config: DomainDiversityConfig;

  constructor(config: Partial<DomainDiversityConfig> = {}) {
    const parsed = DomainDiversityConfigSchema.safeParse(config);
    this.config = parsed.success ? parsed.data : {
      minDomainDiversity: 3,
      optimalDiversity: 5,
      preferredDomains: [],
      avoidDomains: [],
    };
  }

  checkDiversity(sources: Array<{ url: string }>): DomainDiversityResult {
    const domains = sources.map(s => extractDomain(s.url)).filter(Boolean);
    const uniqueDomains = Array.from(new Set(domains));
    const totalSources = sources.length;
    
    const diversityRatio = totalSources > 0 ? uniqueDomains.length / totalSources : 0;
    
    const passed = uniqueDomains.length >= this.config.minDomainDiversity;
    
    let score: number;
    if (uniqueDomains.length >= this.config.optimalDiversity) {
      score = 1.0;
    } else if (uniqueDomains.length >= this.config.minDomainDiversity) {
      score = 0.7 + 0.3 * ((uniqueDomains.length - this.config.minDomainDiversity) / 
        (this.config.optimalDiversity - this.config.minDomainDiversity));
    } else if (uniqueDomains.length > 0) {
      score = 0.3 * (uniqueDomains.length / this.config.minDomainDiversity);
    } else {
      score = 0;
    }
    
    return {
      passed,
      uniqueDomains,
      score,
      totalSources,
      diversityRatio,
    };
  }

  suggestAdditionalSources(sources: Array<{ url: string }>, category?: string): string[] {
    const existingDomains = new Set(
      sources.map(s => extractDomain(s.url).toLowerCase()).filter(Boolean)
    );
    
    const suggestions: string[] = [];
    
    if (category && ALTERNATIVE_DOMAIN_SUGGESTIONS[category]) {
      for (const domain of ALTERNATIVE_DOMAIN_SUGGESTIONS[category]) {
        if (!existingDomains.has(domain) && !this.config.avoidDomains.includes(domain)) {
          suggestions.push(domain);
        }
      }
    }
    
    for (const domain of this.config.preferredDomains) {
      if (!existingDomains.has(domain) && !suggestions.includes(domain)) {
        suggestions.push(domain);
      }
    }
    
    if (suggestions.length < 3) {
      const allCategories = Object.values(ALTERNATIVE_DOMAIN_SUGGESTIONS).flat();
      for (const domain of allCategories) {
        if (!existingDomains.has(domain) && 
            !suggestions.includes(domain) && 
            !this.config.avoidDomains.includes(domain)) {
          suggestions.push(domain);
          if (suggestions.length >= 5) break;
        }
      }
    }
    
    return suggestions.slice(0, 5);
  }

  get minDomainDiversity(): number {
    return this.config.minDomainDiversity;
  }
}

export const ClaimSchema = z.object({
  text: z.string(),
  type: z.enum(["factual", "statistical", "quote", "opinion", "unknown"]),
  keywords: z.array(z.string()),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const CitationSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  content: z.string(),
  relevanceScore: z.number().min(0).max(1).optional(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const CoverageResultSchema = z.object({
  covered: z.array(z.object({
    claim: ClaimSchema,
    supportingCitations: z.array(z.number().int().nonnegative()),
    confidence: z.number().min(0).max(1),
  })),
  uncovered: z.array(ClaimSchema),
  coverageRatio: z.number().min(0).max(1),
  needsResearch: z.boolean(),
});
export type CoverageResult = z.infer<typeof CoverageResultSchema>;

export const CitationCoverageConfigSchema = z.object({
  coverageThreshold: z.number().min(0).max(1).default(0.7),
  minCitationConfidence: z.number().min(0).max(1).default(0.5),
  claimPatterns: z.array(z.string()).optional(),
});
export type CitationCoverageConfig = z.infer<typeof CitationCoverageConfigSchema>;

const FACTUAL_CLAIM_PATTERNS = [
  /\b(?:is|are|was|were|has|have|had)\b.*\b\d+/i,
  /\b(?:according to|research shows|studies indicate|data shows|evidence suggests)\b/i,
  /\b(?:percent|percentage|million|billion|trillion|thousand)\b/i,
  /\b(?:in \d{4}|since \d{4}|by \d{4}|from \d{4})\b/i,
  /\b(?:first|largest|smallest|most|least|highest|lowest)\b/i,
  /\b(?:caused by|results from|leads to|contributes to)\b/i,
  /\b(?:discovered|invented|founded|established|created)\b.*\b(?:in|by|at)\b/i,
];

const STATISTICAL_PATTERNS = [
  /\d+(?:\.\d+)?%/,
  /\b\d+(?:,\d{3})*(?:\.\d+)?\s*(?:million|billion|trillion|thousand)/i,
  /\$\d+(?:,\d{3})*(?:\.\d+)?/,
  /\b(?:approximately|about|around|roughly|nearly)\s+\d+/i,
];

export class CitationCoverageEnforcer {
  private config: CitationCoverageConfig;

  constructor(config: Partial<CitationCoverageConfig> = {}) {
    const parsed = CitationCoverageConfigSchema.safeParse(config);
    this.config = parsed.success ? parsed.data : {
      coverageThreshold: 0.7,
      minCitationConfidence: 0.5,
    };
  }

  extractClaims(answer: string): Claim[] {
    const sentences = this.splitIntoSentences(answer);
    const claims: Claim[] = [];
    const seenClaims = new Set<string>();

    for (const sentence of sentences) {
      const normalized = sentence.trim();
      if (normalized.length < 20 || seenClaims.has(normalized.toLowerCase())) {
        continue;
      }

      const type = this.classifyClaimType(normalized);
      
      if (type !== "opinion" && type !== "unknown") {
        const keywords = this.extractKeywords(normalized);
        
        if (keywords.length >= 2) {
          claims.push({
            text: normalized,
            type,
            keywords,
          });
          seenClaims.add(normalized.toLowerCase());
        }
      }
    }

    return claims;
  }

  private splitIntoSentences(text: string): string[] {
    const normalized = text.replace(/\s+/g, " ").trim();
    const sentenceEnders = /(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚ])/g;
    return normalized.split(sentenceEnders).filter(s => s.trim().length > 0);
  }

  private classifyClaimType(sentence: string): Claim["type"] {
    for (const pattern of STATISTICAL_PATTERNS) {
      if (pattern.test(sentence)) {
        return "statistical";
      }
    }

    if (/[""][^""]+[""]/.test(sentence) || /said|stated|wrote|claimed/.test(sentence)) {
      return "quote";
    }

    for (const pattern of FACTUAL_CLAIM_PATTERNS) {
      if (pattern.test(sentence)) {
        return "factual";
      }
    }

    const opinionIndicators = [
      /\b(?:I think|I believe|in my opinion|personally|probably|maybe|might|could be)\b/i,
      /\b(?:should|would|could|might)\b.*\b(?:be|have|do)\b/i,
    ];
    
    for (const pattern of opinionIndicators) {
      if (pattern.test(sentence)) {
        return "opinion";
      }
    }

    if (sentence.length > 30 && /\b(?:is|are|was|were|has|have)\b/i.test(sentence)) {
      return "factual";
    }

    return "unknown";
  }

  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
      "have", "has", "had", "do", "does", "did", "will", "would", "could",
      "should", "may", "might", "must", "can", "this", "that", "these",
      "those", "it", "its", "they", "them", "their", "we", "our", "you",
      "your", "he", "she", "him", "her", "his", "and", "or", "but", "if",
      "then", "than", "so", "as", "for", "of", "to", "in", "on", "at",
      "by", "with", "from", "about", "into", "through", "during", "before",
      "after", "above", "below", "between", "under", "again", "further",
      "once", "here", "there", "when", "where", "why", "how", "all", "each",
      "few", "more", "most", "other", "some", "such", "no", "nor", "not",
      "only", "own", "same", "than", "too", "very", "just", "also",
    ]);

    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(word => word.length >= 3 && !stopWords.has(word))
      .slice(0, 10);
  }

  checkCoverage(claims: Claim[], citations: Citation[]): CoverageResult {
    const covered: CoverageResult["covered"] = [];
    const uncovered: Claim[] = [];

    for (const claim of claims) {
      const supportingCitations: number[] = [];
      let maxConfidence = 0;

      for (let i = 0; i < citations.length; i++) {
        const citation = citations[i];
        const confidence = this.calculateCitationConfidence(claim, citation);
        
        if (confidence >= this.config.minCitationConfidence) {
          supportingCitations.push(i);
          maxConfidence = Math.max(maxConfidence, confidence);
        }
      }

      if (supportingCitations.length > 0) {
        covered.push({
          claim,
          supportingCitations,
          confidence: maxConfidence,
        });
      } else {
        uncovered.push(claim);
      }
    }

    const totalClaims = claims.length;
    const coverageRatio = totalClaims > 0 ? covered.length / totalClaims : 1;
    const needsResearch = coverageRatio < this.config.coverageThreshold;

    return {
      covered,
      uncovered,
      coverageRatio,
      needsResearch,
    };
  }

  private calculateCitationConfidence(claim: Claim, citation: Citation): number {
    const citationContent = citation.content.toLowerCase();
    const claimText = claim.text.toLowerCase();
    
    let matchedKeywords = 0;
    for (const keyword of claim.keywords) {
      if (citationContent.includes(keyword)) {
        matchedKeywords++;
      }
    }
    
    const keywordRatio = claim.keywords.length > 0 
      ? matchedKeywords / claim.keywords.length 
      : 0;

    const words = claimText.split(/\s+/);
    let contentOverlap = 0;
    for (const word of words) {
      if (word.length >= 4 && citationContent.includes(word)) {
        contentOverlap++;
      }
    }
    const overlapRatio = words.length > 0 ? contentOverlap / words.length : 0;

    let baseConfidence = citation.relevanceScore ?? 0.5;

    const finalConfidence = 
      keywordRatio * 0.4 + 
      overlapRatio * 0.3 + 
      baseConfidence * 0.3;

    return Math.min(finalConfidence, 1);
  }

  suggestResearchQueries(uncoveredClaims: Claim[]): string[] {
    const queries: string[] = [];
    const seenQueries = new Set<string>();

    for (const claim of uncoveredClaims.slice(0, 5)) {
      const keywords = claim.keywords.slice(0, 4);
      
      if (keywords.length >= 2) {
        const query = keywords.join(" ");
        const normalized = query.toLowerCase();
        
        if (!seenQueries.has(normalized)) {
          queries.push(query);
          seenQueries.add(normalized);
        }
      }

      if (claim.type === "statistical") {
        const statsQuery = `statistics ${keywords.slice(0, 2).join(" ")}`;
        if (!seenQueries.has(statsQuery.toLowerCase())) {
          queries.push(statsQuery);
          seenQueries.add(statsQuery.toLowerCase());
        }
      }
    }

    return queries.slice(0, 5);
  }

  get coverageThreshold(): number {
    return this.config.coverageThreshold;
  }
}

export const GoldenFixtureSchema = z.object({
  query: z.string(),
  content: z.string(),
  expectedScore: z.number().min(0).max(1),
  tolerance: z.number().min(0).max(0.5).default(0.1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type GoldenFixture = z.infer<typeof GoldenFixtureSchema>;

export const GoldenFixturesFileSchema = z.object({
  version: z.string(),
  fixtures: z.array(GoldenFixtureSchema),
  metadata: z.object({
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    description: z.string().optional(),
  }).optional(),
});
export type GoldenFixturesFile = z.infer<typeof GoldenFixturesFileSchema>;

export const ValidationResultSchema = z.object({
  passed: z.boolean(),
  totalFixtures: z.number().int().nonnegative(),
  passedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  failures: z.array(z.object({
    fixture: GoldenFixtureSchema,
    actualScore: z.number().min(0).max(1),
    difference: z.number(),
    withinTolerance: z.boolean(),
  })),
  duration: z.number().nonnegative(),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

const GOLDEN_FIXTURES_PATH = "test_fixtures/web_relevance/golden.json";

export class GoldenFixturesValidator {
  private fixtures: GoldenFixture[] = [];
  private relevanceFilter: RelevanceFilter;
  private loaded: boolean = false;

  constructor(relevanceFilter?: RelevanceFilter) {
    this.relevanceFilter = relevanceFilter ?? new RelevanceFilter();
  }

  loadFixtures(fixturesPath?: string): GoldenFixture[] {
    const filePath = fixturesPath ?? GOLDEN_FIXTURES_PATH;
    
    try {
      const absolutePath = path.isAbsolute(filePath) 
        ? filePath 
        : path.join(process.cwd(), filePath);
      
      const fileContent = fs.readFileSync(absolutePath, "utf-8");
      const parsed = JSON.parse(fileContent);
      const validated = GoldenFixturesFileSchema.safeParse(parsed);
      
      if (!validated.success) {
        throw new Error(`Invalid golden fixtures format: ${validated.error.message}`);
      }
      
      this.fixtures = validated.data.fixtures;
      this.loaded = true;
      return this.fixtures;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.fixtures = [];
        this.loaded = true;
        return [];
      }
      throw error;
    }
  }

  validateAgainstGolden(): ValidationResult {
    const startTime = Date.now();
    
    if (!this.loaded) {
      this.loadFixtures();
    }

    const failures: ValidationResult["failures"] = [];
    let passedCount = 0;

    for (const fixture of this.fixtures) {
      const result = this.relevanceFilter.filter(fixture.content, fixture.query);
      const actualScore = result.overallScore;
      const difference = Math.abs(actualScore - fixture.expectedScore);
      const withinTolerance = difference <= fixture.tolerance;

      if (withinTolerance) {
        passedCount++;
      } else {
        failures.push({
          fixture,
          actualScore,
          difference,
          withinTolerance: false,
        });
      }
    }

    const duration = Date.now() - startTime;

    return {
      passed: failures.length === 0,
      totalFixtures: this.fixtures.length,
      passedCount,
      failedCount: failures.length,
      failures,
      duration,
    };
  }

  addFixture(fixture: GoldenFixture): void {
    const validated = GoldenFixtureSchema.parse(fixture);
    this.fixtures.push(validated);
  }

  getFixtures(): GoldenFixture[] {
    return [...this.fixtures];
  }

  saveFixtures(fixturesPath?: string): void {
    const filePath = fixturesPath ?? GOLDEN_FIXTURES_PATH;
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath);

    const fixturesFile: GoldenFixturesFile = {
      version: "1.0.0",
      fixtures: this.fixtures,
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        description: "Golden fixtures for RelevanceFilter validation",
      },
    };

    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(absolutePath, JSON.stringify(fixturesFile, null, 2));
  }

  clearFixtures(): void {
    this.fixtures = [];
  }
}

export const sourceQualityScorer = new SourceQualityScorer();
export const domainDiversityChecker = new DomainDiversityChecker();
export const citationCoverageEnforcer = new CitationCoverageEnforcer();
export const goldenFixturesValidator = new GoldenFixturesValidator();
