/**
 * Advanced Precision Module v4.0
 * Improvements 301-400: Advanced Precision
 * 
 * 301-320: Advanced Deduplication
 * 321-350: Advanced Enrichment
 * 351-380: Advanced Ranking
 * 381-400: Citation Analysis
 */

import crypto from "crypto";

// ============================================
// TYPES
// ============================================

export interface Paper {
  id?: string;
  title: string;
  authors: string[];
  year: number;
  abstract?: string;
  doi?: string;
  citations?: number;
  journal?: string;
  keywords?: string[];
  source?: string;
  url?: string;
  fingerprint?: string;
  // Enrichment fields
  methodology?: string;
  conclusions?: string;
  limitations?: string;
  futureWork?: string;
  dataAvailability?: boolean;
  codeAvailability?: boolean;
  studyType?: string;
  sampleSize?: number;
  // Ranking fields
  relevanceScore?: number;
  citationVelocity?: number;
  authorHIndex?: number;
  journalImpactFactor?: number;
  trendingScore?: number;
  diversityScore?: number;
}

export interface DuplicateCluster {
  primary: Paper;
  duplicates: Paper[];
  similarity: number;
  mergedInfo: Paper;
}

export interface CitationContext {
  citingPaper: string;
  context: string;
  sentiment: "positive" | "negative" | "neutral";
  type: "background" | "method" | "result" | "comparison";
}

// ============================================
// 301-320: ADVANCED DEDUPLICATION
// ============================================

// 301. Fuzzy matching con n-grams
export function ngramSimilarity(a: string, b: string, n = 3): number {
  const getNgrams = (s: string): Set<string> => {
    const ngrams = new Set<string>();
    const normalized = s.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (let i = 0; i <= normalized.length - n; i++) {
      ngrams.add(normalized.substring(i, i + n));
    }
    return ngrams;
  };
  
  const ngramsA = getNgrams(a);
  const ngramsB = getNgrams(b);
  
  if (ngramsA.size === 0 || ngramsB.size === 0) return 0;
  
  let intersection = 0;
  for (const ngram of ngramsA) {
    if (ngramsB.has(ngram)) intersection++;
  }
  
  const union = ngramsA.size + ngramsB.size - intersection;
  return intersection / union; // Jaccard similarity
}

// 302. Phonetic matching (Soundex)
export function soundex(word: string): string {
  const a = word.toLowerCase().split("");
  const first = a.shift()?.toUpperCase() || "";
  
  const codes: Record<string, string> = {
    b: "1", f: "1", p: "1", v: "1",
    c: "2", g: "2", j: "2", k: "2", q: "2", s: "2", x: "2", z: "2",
    d: "3", t: "3",
    l: "4",
    m: "5", n: "5",
    r: "6"
  };
  
  const coded = a
    .map(char => codes[char] || "")
    .filter((code, i, arr) => code && code !== arr[i - 1])
    .join("");
  
  return (first + coded + "000").substring(0, 4);
}

// 303. Edit distance con threshold adaptivo
export function levenshteinDistance(a: string, b: string, maxDistance = 20): number {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  
  const matrix: number[][] = [];
  const aLen = Math.min(a.length, 100);
  const bLen = Math.min(b.length, 100);
  
  for (let i = 0; i <= bLen; i++) matrix[i] = [i];
  for (let j = 0; j <= aLen; j++) matrix[0][j] = j;
  
  for (let i = 1; i <= bLen; i++) {
    let minInRow = Infinity;
    for (let j = 1; j <= aLen; j++) {
      const cost = a[j - 1].toLowerCase() === b[i - 1].toLowerCase() ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
      minInRow = Math.min(minInRow, matrix[i][j]);
    }
    // Early termination if all values in row exceed threshold
    if (minInRow > maxDistance) return maxDistance + 1;
  }
  
  return matrix[bLen][aLen];
}

// 304. Jaccard similarity para titles
export function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  
  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }
  
  const union = wordsA.size + wordsB.size - intersection;
  return intersection / union;
}

// 305. Cosine similarity para abstracts
export function cosineSimilarity(a: string, b: string): number {
  const tokenize = (text: string): Map<string, number> => {
    const tokens = new Map<string, number>();
    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/);
    for (const word of words) {
      if (word.length > 2) {
        tokens.set(word, (tokens.get(word) || 0) + 1);
      }
    }
    return tokens;
  };
  
  const vectorA = tokenize(a);
  const vectorB = tokenize(b);
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (const [word, countA] of vectorA) {
    normA += countA * countA;
    const countB = vectorB.get(word) || 0;
    dotProduct += countA * countB;
  }
  
  for (const [, countB] of vectorB) {
    normB += countB * countB;
  }
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// 306-307. Content fingerprinting
export function generateFingerprint(paper: Paper): string {
  const content = [
    paper.title.toLowerCase(),
    paper.authors.slice(0, 3).join(" ").toLowerCase(),
    paper.year.toString()
  ].join("|");
  
  return crypto.createHash("md5").update(content).digest("hex").substring(0, 16);
}

// 309. Version detection
export function detectVersion(title: string): { base: string; version: number | null } {
  // arXiv versions: v1, v2, etc.
  const arxivMatch = title.match(/\s*v(\d+)\s*$/i);
  if (arxivMatch) {
    return {
      base: title.replace(/\s*v\d+\s*$/i, "").trim(),
      version: parseInt(arxivMatch[1])
    };
  }
  
  // Revision markers
  const revisionMatch = title.match(/\s*\(rev(?:ision|ised)?\s*(\d+)?\)\s*$/i);
  if (revisionMatch) {
    return {
      base: title.replace(/\s*\(rev(?:ision|ised)?\s*\d*\)\s*$/i, "").trim(),
      version: revisionMatch[1] ? parseInt(revisionMatch[1]) : 2
    };
  }
  
  return { base: title, version: null };
}

// 310. Preprint-published matching
export function isPreprintMatch(preprint: Paper, published: Paper): boolean {
  // Title similarity
  const titleSim = jaccardSimilarity(preprint.title, published.title);
  if (titleSim < 0.7) return false;
  
  // Author overlap
  const preprintAuthors = new Set(preprint.authors.map(a => a.toLowerCase().split(/\s+/).pop()));
  const publishedAuthors = new Set(published.authors.map(a => a.toLowerCase().split(/\s+/).pop()));
  
  let authorOverlap = 0;
  for (const author of preprintAuthors) {
    if (author && publishedAuthors.has(author)) authorOverlap++;
  }
  
  const authorSim = authorOverlap / Math.max(preprintAuthors.size, 1);
  
  // Year proximity
  const yearDiff = Math.abs(preprint.year - published.year);
  
  return titleSim >= 0.7 && authorSim >= 0.5 && yearDiff <= 2;
}

// 312. Author name normalization
export function normalizeAuthorName(name: string): string {
  return name
    .replace(/\s+/g, " ")
    .trim()
    .replace(/,\s*/g, ", ")
    .replace(/\s*-\s*/g, "-")
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, "")
    .replace(/\b(dr|prof|phd|md)\b\.?/gi, "")
    .trim();
}

// 313. Institution normalization
const INSTITUTION_ALIASES: Record<string, string> = {
  "mit": "Massachusetts Institute of Technology",
  "caltech": "California Institute of Technology",
  "stanford": "Stanford University",
  "harvard": "Harvard University",
  "oxford": "University of Oxford",
  "cambridge": "University of Cambridge",
  "berkeley": "University of California, Berkeley",
  "ucla": "University of California, Los Angeles",
  "eth": "ETH Zurich",
  "epfl": "École Polytechnique Fédérale de Lausanne"
};

export function normalizeInstitution(name: string): string {
  const lower = name.toLowerCase().trim();
  return INSTITUTION_ALIASES[lower] || name;
}

// 315. URL canonicalization
export function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    
    // Remove tracking parameters
    const trackingParams = ["utm_source", "utm_medium", "utm_campaign", "ref", "source"];
    for (const param of trackingParams) {
      parsed.searchParams.delete(param);
    }
    
    // Normalize host
    parsed.hostname = parsed.hostname.replace(/^www\./, "");
    
    // Remove trailing slash
    parsed.pathname = parsed.pathname.replace(/\/$/, "");
    
    return parsed.toString();
  } catch {
    return url;
  }
}

// Comprehensive deduplication
export function findDuplicates(papers: Paper[]): DuplicateCluster[] {
  const clusters: DuplicateCluster[] = [];
  const processed = new Set<number>();
  
  for (let i = 0; i < papers.length; i++) {
    if (processed.has(i)) continue;
    
    const cluster: Paper[] = [];
    
    for (let j = i + 1; j < papers.length; j++) {
      if (processed.has(j)) continue;
      
      // Quick checks first
      if (papers[i].doi && papers[j].doi && papers[i].doi === papers[j].doi) {
        cluster.push(papers[j]);
        processed.add(j);
        continue;
      }
      
      // Fingerprint match
      const fp1 = generateFingerprint(papers[i]);
      const fp2 = generateFingerprint(papers[j]);
      if (fp1 === fp2) {
        cluster.push(papers[j]);
        processed.add(j);
        continue;
      }
      
      // Title similarity
      const titleSim = jaccardSimilarity(papers[i].title, papers[j].title);
      if (titleSim >= 0.85) {
        cluster.push(papers[j]);
        processed.add(j);
      }
    }
    
    if (cluster.length > 0) {
      const primary = papers[i];
      clusters.push({
        primary,
        duplicates: cluster,
        similarity: jaccardSimilarity(primary.title, cluster[0].title),
        mergedInfo: mergePaperInfo(primary, cluster)
      });
    }
    
    processed.add(i);
  }
  
  return clusters;
}

// 60. Merge strategy for duplicates
function mergePaperInfo(primary: Paper, duplicates: Paper[]): Paper {
  const merged = { ...primary };
  
  for (const dup of duplicates) {
    // Keep longer abstract
    if (dup.abstract && (!merged.abstract || dup.abstract.length > merged.abstract.length)) {
      merged.abstract = dup.abstract;
    }
    
    // Keep higher citation count
    if (dup.citations && (!merged.citations || dup.citations > merged.citations)) {
      merged.citations = dup.citations;
    }
    
    // Keep DOI if missing
    if (dup.doi && !merged.doi) {
      merged.doi = dup.doi;
    }
    
    // Merge keywords
    if (dup.keywords) {
      merged.keywords = [...new Set([...(merged.keywords || []), ...dup.keywords])];
    }
  }
  
  return merged;
}

// ============================================
// 321-350: ADVANCED ENRICHMENT
// ============================================

// 321-325. Extract structured information from abstract
export function extractMethodology(abstract: string): string | null {
  const methodPatterns = [
    /(?:we|this study|paper)\s+(?:propose[ds]?|present[ds]?|develop[ds]?|introduce[ds]?)\s+([^.]+)/i,
    /(?:method(?:ology)?|approach|technique|algorithm)\s+(?:is|was|based on)\s+([^.]+)/i,
    /(?:using|through|via|by means of)\s+([^.]+(?:method|approach|technique|algorithm))/i
  ];
  
  for (const pattern of methodPatterns) {
    const match = abstract.match(pattern);
    if (match) return match[1].trim();
  }
  
  return null;
}

// 339. Results summarization
export function extractResults(abstract: string): string | null {
  const resultPatterns = [
    /(?:results?|findings?)\s+(?:show[eds]?|indicate[ds]?|demonstrate[ds]?|reveal[ds]?)\s+(?:that\s+)?([^.]+)/i,
    /(?:we\s+)?(?:found|observed|discovered)\s+(?:that\s+)?([^.]+)/i,
    /(?:achieved?|obtained?|reached?)\s+(?:an?\s+)?([^.]+(?:accuracy|precision|performance|improvement))/i
  ];
  
  for (const pattern of resultPatterns) {
    const match = abstract.match(pattern);
    if (match) return match[1].trim();
  }
  
  return null;
}

// 340. Conclusion extraction
export function extractConclusion(abstract: string): string | null {
  const conclusionPatterns = [
    /(?:in\s+)?conclusion,?\s+([^.]+)/i,
    /(?:we\s+)?conclude\s+(?:that\s+)?([^.]+)/i,
    /(?:this|our)\s+(?:study|research|work)\s+(?:demonstrates?|shows?|proves?)\s+(?:that\s+)?([^.]+)/i
  ];
  
  for (const pattern of conclusionPatterns) {
    const match = abstract.match(pattern);
    if (match) return match[1].trim();
  }
  
  return null;
}

// 341. Limitation identification
export function extractLimitations(abstract: string): string | null {
  const limitationPatterns = [
    /(?:limitation[s]?|drawback[s]?|constraint[s]?)\s+(?:is|are|include[s]?)\s+([^.]+)/i,
    /(?:however|nevertheless|despite),?\s+([^.]+(?:limit|constrain|restrict))/i
  ];
  
  for (const pattern of limitationPatterns) {
    const match = abstract.match(pattern);
    if (match) return match[1].trim();
  }
  
  return null;
}

// 342. Future work extraction
export function extractFutureWork(abstract: string): string | null {
  const futurePatterns = [
    /(?:future\s+work|future\s+research|further\s+study)\s+(?:will|should|could|may)\s+([^.]+)/i,
    /(?:plan|intend|aim)\s+to\s+([^.]+(?:future|next))/i
  ];
  
  for (const pattern of futurePatterns) {
    const match = abstract.match(pattern);
    if (match) return match[1].trim();
  }
  
  return null;
}

// 327. Classify study type
export function classifyStudyType(abstract: string): string {
  const lower = abstract.toLowerCase();
  
  const types: [RegExp, string][] = [
    [/systematic\s+review|meta-?analysis/i, "systematic-review"],
    [/randomized\s+controlled\s+trial|rct/i, "rct"],
    [/clinical\s+trial/i, "clinical-trial"],
    [/case\s+study|case\s+report/i, "case-study"],
    [/survey|questionnaire/i, "survey"],
    [/experiment(?:al)?(?:\s+study)?/i, "experimental"],
    [/observational\s+study/i, "observational"],
    [/qualitative\s+(?:study|research)/i, "qualitative"],
    [/quantitative\s+(?:study|research)/i, "quantitative"],
    [/literature\s+review/i, "literature-review"],
    [/simulation/i, "simulation"],
    [/theoretical|mathematical\s+model/i, "theoretical"]
  ];
  
  for (const [pattern, type] of types) {
    if (pattern.test(lower)) return type;
  }
  
  return "unknown";
}

// 328. Extract sample size
export function extractSampleSize(abstract: string): number | null {
  const patterns = [
    /n\s*=\s*(\d+[,\d]*)/i,
    /(\d+[,\d]*)\s+(?:participants?|subjects?|patients?|samples?|respondents?)/i,
    /sample\s+(?:size\s+)?(?:of\s+)?(\d+[,\d]*)/i
  ];
  
  for (const pattern of patterns) {
    const match = abstract.match(pattern);
    if (match) {
      return parseInt(match[1].replace(/,/g, ""));
    }
  }
  
  return null;
}

// Enrich paper with extracted information
export function enrichPaper(paper: Paper): Paper {
  const enriched = { ...paper };
  
  if (paper.abstract) {
    enriched.methodology = extractMethodology(paper.abstract) || undefined;
    enriched.conclusions = extractConclusion(paper.abstract) || undefined;
    enriched.limitations = extractLimitations(paper.abstract) || undefined;
    enriched.futureWork = extractFutureWork(paper.abstract) || undefined;
    enriched.studyType = classifyStudyType(paper.abstract);
    enriched.sampleSize = extractSampleSize(paper.abstract) || undefined;
  }
  
  return enriched;
}

// ============================================
// 351-380: ADVANCED RANKING
// ============================================

// 361. Temporal ranking
export function calculateTemporalScore(year: number): number {
  const currentYear = new Date().getFullYear();
  const age = currentYear - year;
  
  if (age <= 0) return 100;
  if (age === 1) return 95;
  if (age === 2) return 90;
  if (age <= 5) return 80 - (age - 2) * 5;
  if (age <= 10) return 60 - (age - 5) * 4;
  return Math.max(20, 40 - (age - 10) * 2);
}

// 363. Domain-specific ranking
const DOMAIN_WEIGHTS: Record<string, Record<string, number>> = {
  medicine: {
    citations: 0.3,
    recency: 0.2,
    journal: 0.25,
    methodology: 0.25
  },
  "computer-science": {
    citations: 0.25,
    recency: 0.3,
    novelty: 0.25,
    reproducibility: 0.2
  },
  general: {
    citations: 0.3,
    recency: 0.25,
    journal: 0.2,
    relevance: 0.25
  }
};

export function getDomainWeights(domain: string): Record<string, number> {
  return DOMAIN_WEIGHTS[domain] || DOMAIN_WEIGHTS.general;
}

// 366. Diversity-aware ranking
export function diversifyResults(papers: Paper[], maxPerSource = 3): Paper[] {
  const sourceGroups = new Map<string, Paper[]>();
  
  // Group by source
  for (const paper of papers) {
    const source = paper.source || "unknown";
    if (!sourceGroups.has(source)) {
      sourceGroups.set(source, []);
    }
    sourceGroups.get(source)!.push(paper);
  }
  
  // Round-robin selection
  const result: Paper[] = [];
  const iterators = Array.from(sourceGroups.values()).map(group => ({
    papers: group,
    index: 0,
    count: 0
  }));
  
  while (result.length < papers.length) {
    let added = false;
    
    for (const iter of iterators) {
      if (iter.index < iter.papers.length && iter.count < maxPerSource) {
        result.push(iter.papers[iter.index]);
        iter.index++;
        iter.count++;
        added = true;
      }
    }
    
    // Reset counts for next round
    if (!added) {
      for (const iter of iterators) {
        iter.count = 0;
      }
    }
    
    // Break if all exhausted
    if (iterators.every(i => i.index >= i.papers.length)) break;
  }
  
  return result;
}

// 368. Novelty-aware ranking
export function calculateNoveltyScore(paper: Paper, existingPapers: Paper[]): number {
  if (existingPapers.length === 0) return 100;
  
  // Calculate similarity to existing papers
  let maxSimilarity = 0;
  
  for (const existing of existingPapers) {
    const sim = jaccardSimilarity(paper.title, existing.title);
    maxSimilarity = Math.max(maxSimilarity, sim);
    
    if (paper.abstract && existing.abstract) {
      const absSim = cosineSimilarity(paper.abstract, existing.abstract);
      maxSimilarity = Math.max(maxSimilarity, absSim);
    }
  }
  
  // Novelty is inverse of similarity
  return Math.round((1 - maxSimilarity) * 100);
}

// 373. Exploration-exploitation balance
export function balanceExplorationExploitation(
  rankedPapers: Paper[],
  explorationRate = 0.2
): Paper[] {
  const exploitCount = Math.floor(rankedPapers.length * (1 - explorationRate));
  const exploreCount = rankedPapers.length - exploitCount;
  
  // Top papers (exploitation)
  const exploit = rankedPapers.slice(0, exploitCount);
  
  // Random selection from rest (exploration)
  const remaining = rankedPapers.slice(exploitCount);
  const explore: Paper[] = [];
  
  for (let i = 0; i < exploreCount && remaining.length > 0; i++) {
    const idx = Math.floor(Math.random() * remaining.length);
    explore.push(remaining.splice(idx, 1)[0]);
  }
  
  return [...exploit, ...explore];
}

// Comprehensive ranking
export interface RankingOptions {
  query?: string;
  domain?: string;
  diversify?: boolean;
  noveltyAware?: boolean;
  explorationRate?: number;
}

export function rankPapers(papers: Paper[], options: RankingOptions = {}): Paper[] {
  const {
    query = "",
    domain = "general",
    diversify = true,
    noveltyAware = false,
    explorationRate = 0.1
  } = options;
  
  const weights = getDomainWeights(domain);
  const queryWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  
  // Calculate scores
  for (const paper of papers) {
    let score = 0;
    
    // Citation score (0-25)
    const citScore = Math.min(25, Math.log10((paper.citations || 0) + 1) * 10);
    score += citScore * (weights.citations || 0.25);
    
    // Recency score (0-25)
    const recencyScore = calculateTemporalScore(paper.year) * 0.25;
    score += recencyScore * (weights.recency || 0.25);
    
    // Relevance score (0-25)
    let relevance = 0;
    for (const word of queryWords) {
      if (paper.title.toLowerCase().includes(word)) relevance += 5;
      if (paper.abstract?.toLowerCase().includes(word)) relevance += 2;
    }
    score += Math.min(25, relevance) * (weights.relevance || 0.25);
    
    // Completeness score (0-25)
    let completeness = 0;
    if (paper.abstract) completeness += 5;
    if (paper.doi) completeness += 5;
    if (paper.keywords?.length) completeness += 5;
    if (paper.journal) completeness += 5;
    if (paper.citations !== undefined) completeness += 5;
    score += completeness * (weights.journal || 0.25);
    
    paper.relevanceScore = Math.round(score);
  }
  
  // Sort by score
  let ranked = papers.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  
  // Apply novelty awareness
  if (noveltyAware) {
    for (let i = 1; i < ranked.length; i++) {
      const novelty = calculateNoveltyScore(ranked[i], ranked.slice(0, i));
      ranked[i].relevanceScore = Math.round((ranked[i].relevanceScore || 0) * 0.7 + novelty * 0.3);
    }
    ranked = ranked.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  }
  
  // Diversify sources
  if (diversify) {
    ranked = diversifyResults(ranked);
  }
  
  // Apply exploration-exploitation
  if (explorationRate > 0) {
    ranked = balanceExplorationExploitation(ranked, explorationRate);
  }
  
  return ranked;
}

// ============================================
// 381-400: CITATION ANALYSIS
// ============================================

// 381. Citation network structure
export interface CitationNetwork {
  nodes: Map<string, Paper>;
  edges: Map<string, Set<string>>; // cited -> citing
  reverseEdges: Map<string, Set<string>>; // citing -> cited
}

export function buildCitationNetwork(papers: Paper[], citations: Array<{from: string, to: string}>): CitationNetwork {
  const nodes = new Map<string, Paper>();
  const edges = new Map<string, Set<string>>();
  const reverseEdges = new Map<string, Set<string>>();
  
  for (const paper of papers) {
    const id = paper.id || paper.doi || generateFingerprint(paper);
    nodes.set(id, paper);
    edges.set(id, new Set());
    reverseEdges.set(id, new Set());
  }
  
  for (const { from, to } of citations) {
    if (edges.has(to)) {
      edges.get(to)!.add(from);
    }
    if (reverseEdges.has(from)) {
      reverseEdges.get(from)!.add(to);
    }
  }
  
  return { nodes, edges, reverseEdges };
}

// 382. Co-citation analysis
export function findCoCitations(network: CitationNetwork, paperId: string): Map<string, number> {
  const coCitations = new Map<string, number>();
  const citingPapers = network.edges.get(paperId) || new Set();
  
  for (const citing of citingPapers) {
    const alsoCited = network.reverseEdges.get(citing) || new Set();
    for (const other of alsoCited) {
      if (other !== paperId) {
        coCitations.set(other, (coCitations.get(other) || 0) + 1);
      }
    }
  }
  
  return coCitations;
}

// 383. Bibliographic coupling
export function calculateBibliographicCoupling(network: CitationNetwork, paper1: string, paper2: string): number {
  const refs1 = network.reverseEdges.get(paper1) || new Set();
  const refs2 = network.reverseEdges.get(paper2) || new Set();
  
  let shared = 0;
  for (const ref of refs1) {
    if (refs2.has(ref)) shared++;
  }
  
  const total = refs1.size + refs2.size - shared;
  return total > 0 ? shared / total : 0;
}

// 384. Citation velocity
export function calculateCitationVelocity(paper: Paper, recentCitations: number, months = 12): number {
  const age = new Date().getFullYear() - paper.year;
  if (age <= 0) return recentCitations * 12 / months;
  
  const totalCitations = paper.citations || 0;
  const avgYearly = totalCitations / age;
  const recentYearly = recentCitations * 12 / months;
  
  // Velocity is ratio of recent to average
  return avgYearly > 0 ? recentYearly / avgYearly : recentYearly;
}

// 386. Self-citation detection
export function detectSelfCitation(citingPaper: Paper, citedPaper: Paper): boolean {
  const citingAuthors = new Set(
    citingPaper.authors.map(a => a.toLowerCase().split(/\s+/).pop())
  );
  
  for (const author of citedPaper.authors) {
    const lastName = author.toLowerCase().split(/\s+/).pop();
    if (lastName && citingAuthors.has(lastName)) {
      return true;
    }
  }
  
  return false;
}

// 387. Citation context sentiment
export function analyzeCitationSentiment(context: string): "positive" | "negative" | "neutral" {
  const lower = context.toLowerCase();
  
  const positivePatterns = [
    /excellent|outstanding|groundbreaking|seminal|influential|important/,
    /successfully|effectively|significantly|notably/,
    /advances?|improves?|extends?|builds? on/
  ];
  
  const negativePatterns = [
    /however|but|although|despite|limitation|problem|issue/,
    /fails?|lacks?|insufficient|inadequate/,
    /contradicts?|refutes?|challenges?|questions?/
  ];
  
  let positiveCount = 0;
  let negativeCount = 0;
  
  for (const pattern of positivePatterns) {
    if (pattern.test(lower)) positiveCount++;
  }
  
  for (const pattern of negativePatterns) {
    if (pattern.test(lower)) negativeCount++;
  }
  
  if (positiveCount > negativeCount + 1) return "positive";
  if (negativeCount > positiveCount + 1) return "negative";
  return "neutral";
}

// 388. Citation function classification
export function classifyCitationFunction(context: string): CitationContext["type"] {
  const lower = context.toLowerCase();
  
  if (/method(?:ology)?|approach|technique|algorithm|procedure|protocol/.test(lower)) {
    return "method";
  }
  
  if (/result|finding|show|demonstrate|observe|report/.test(lower)) {
    return "result";
  }
  
  if (/compare|contrast|differ|similar|unlike|whereas/.test(lower)) {
    return "comparison";
  }
  
  return "background";
}

// 393. Citation recommendation
export function recommendCitations(paper: Paper, candidates: Paper[], maxRecommendations = 5): Paper[] {
  const scored: Array<{ paper: Paper; score: number }> = [];
  
  for (const candidate of candidates) {
    // Skip if same paper
    if (candidate.doi === paper.doi) continue;
    
    let score = 0;
    
    // Title similarity
    score += jaccardSimilarity(paper.title, candidate.title) * 30;
    
    // Abstract similarity
    if (paper.abstract && candidate.abstract) {
      score += cosineSimilarity(paper.abstract, candidate.abstract) * 30;
    }
    
    // Citation count (established work)
    score += Math.min(20, Math.log10((candidate.citations || 0) + 1) * 8);
    
    // Recency
    score += calculateTemporalScore(candidate.year) * 0.2;
    
    scored.push({ paper: candidate, score });
  }
  
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxRecommendations)
    .map(s => s.paper);
}

// ============================================
// EXPORTS
// ============================================
// All functions are exported inline above
// ============================================
