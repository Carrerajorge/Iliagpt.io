import { AcademicCandidate } from "./openAlexClient";
import { lookupDOI, verifyDOI, VerifyDOIResult } from "./crossrefClient";
import { doiCache } from "./academicPipeline";

const RELEVANCE_THRESHOLD = 0.72;

const LATAM_COUNTRIES = new Set([
  "Mexico", "México", "Brazil", "Brasil", "Argentina", "Colombia", 
  "Peru", "Perú", "Venezuela", "Chile", "Ecuador", "Guatemala", 
  "Cuba", "Bolivia", "Dominican Republic", "Honduras", "Paraguay",
  "El Salvador", "Nicaragua", "Costa Rica", "Panama", "Panamá",
  "Uruguay", "Puerto Rico", "Jamaica", "Trinidad and Tobago",
  "MX", "BR", "AR", "CO", "PE", "VE", "CL", "EC", "GT", "CU", 
  "BO", "DO", "HN", "PY", "SV", "NI", "CR", "PA", "UY", "PR", "JM", "TT"
]);

export function isLatamCountry(country: string): boolean {
  if (!country) return false;
  const normalized = country.trim();
  return LATAM_COUNTRIES.has(normalized);
}

class Semaphore {
  private permits: number;
  private queue: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next();
    } else {
      this.permits++;
    }
  }

  async withPermit<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

const REQUIRED_KEYWORDS = {
  material: ["concrete", "mortar", "cement", "cementitious"],
  steel: ["recycled steel", "scrap steel", "steel fiber", "steel fibre", "recycled reinforcement", "steel slag", "recycled aggregate"],
  property: ["strength", "compressive", "tensile", "flexural", "mechanical", "durability", "resistance"],
};

function normalize(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface RelevanceResult {
  passed: boolean;
  score: number;
  reason: string;
  matchedGroups: string[];
}

export function checkRelevance(candidate: AcademicCandidate): RelevanceResult {
  const text = normalize(`${candidate.title} ${candidate.abstract}`);
  
  const matchedGroups: string[] = [];
  
  const hasMaterial = REQUIRED_KEYWORDS.material.some(kw => text.includes(kw));
  if (hasMaterial) matchedGroups.push("material");
  
  const hasSteel = REQUIRED_KEYWORDS.steel.some(kw => text.includes(kw));
  if (hasSteel) matchedGroups.push("steel");
  
  const hasProperty = REQUIRED_KEYWORDS.property.some(kw => text.includes(kw));
  if (hasProperty) matchedGroups.push("property");

  if (!hasMaterial || !hasSteel || !hasProperty) {
    return {
      passed: false,
      score: 0,
      reason: `Missing required keywords: ${["material", "steel", "property"].filter((g, i) => ![hasMaterial, hasSteel, hasProperty][i]).join(", ")}`,
      matchedGroups,
    };
  }

  let count = 0;
  for (const keywords of Object.values(REQUIRED_KEYWORDS)) {
    for (const kw of keywords) {
      const regex = new RegExp(kw.replace(/\s+/g, "\\s*"), "gi");
      const matches = text.match(regex);
      count += matches ? matches.length : 0;
    }
  }

  const hasAbstract = candidate.abstract && candidate.abstract.length > 100;
  
  const baseScore = 0.6 + 0.08 * Math.min(5, count);
  const abstractPenalty = hasAbstract ? 0 : 0.2;
  const score = Math.min(1.0, baseScore - abstractPenalty);
  
  if (!hasAbstract) {
    return {
      passed: false,
      score,
      reason: "Abstract too short or missing",
      matchedGroups,
    };
  }

  if (score < RELEVANCE_THRESHOLD) {
    return {
      passed: false,
      score,
      reason: `Score too low: ${score.toFixed(2)} < ${RELEVANCE_THRESHOLD}`,
      matchedGroups,
    };
  }

  return {
    passed: true,
    score,
    reason: `Relevant (score: ${score.toFixed(2)})`,
    matchedGroups,
  };
}

export function filterByRelevanceAgent(
  candidates: AcademicCandidate[],
  options?: { latamOnly?: boolean }
): AcademicCandidate[] {
  console.log(`[RelevanceAgent] Filtering ${candidates.length} candidates...`);
  
  const passed: AcademicCandidate[] = [];
  const failed: { title: string; reason: string }[] = [];

  for (const candidate of candidates) {
    const result = checkRelevance(candidate);
    
    if (result.passed) {
      candidate.relevanceScore = result.score;
      passed.push(candidate);
    } else {
      failed.push({ 
        title: candidate.title.substring(0, 60), 
        reason: result.reason 
      });
    }
  }

  console.log(`[RelevanceAgent] Passed: ${passed.length}, Failed: ${failed.length}`);
  
  if (failed.length > 0 && failed.length <= 10) {
    for (const f of failed) {
      console.log(`[RelevanceAgent] Rejected: "${f.title}..." - ${f.reason}`);
    }
  }

  if (options?.latamOnly) {
    const latamFiltered = passed.filter(c => isLatamCountry(c.country));
    console.log(`[RelevanceAgent] LATAM filter: ${passed.length} -> ${latamFiltered.length}`);
    return latamFiltered;
  }

  return passed;
}

export interface VerificationResult {
  verified: boolean;
  doiValid: boolean;
  urlAccessible: boolean;
  titleMatch: number;
  finalUrl: string;
  reason: string;
  crossrefData?: VerifyDOIResult;
}

function titleSimilarity(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, "").trim();
  const na = normalize(a);
  const nb = normalize(b);
  
  if (na === nb) return 1.0;
  if (!na || !nb) return 0;

  const wordsA = new Set(na.split(/\s+/));
  const wordsB = new Set(nb.split(/\s+/));
  
  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }
  
  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}

export async function verifyCandidate(
  candidate: AcademicCandidate,
  yearStart: number = new Date().getFullYear() - 5,
  yearEnd: number = new Date().getFullYear()
): Promise<VerificationResult> {
  if (!candidate.doi) {
    return {
      verified: false,
      doiValid: false,
      urlAccessible: false,
      titleMatch: 0,
      finalUrl: "",
      reason: "No DOI available",
    };
  }

  if (candidate.year && (candidate.year < yearStart || candidate.year > yearEnd)) {
    return {
      verified: false,
      doiValid: false,
      urlAccessible: false,
      titleMatch: 0,
      finalUrl: "",
      reason: `Year ${candidate.year} outside valid range ${yearStart}-${yearEnd}`,
    };
  }

  const doiKey = candidate.doi.toLowerCase().trim();
  
  if (doiCache.has(doiKey)) {
    const cachedValid = doiCache.get(doiKey);
    if (!cachedValid) {
      return {
        verified: false,
        doiValid: false,
        urlAccessible: false,
        titleMatch: 0,
        finalUrl: "",
        reason: "DOI previously failed verification (cached)",
      };
    }
  }

  const doiResult = await verifyDOI(candidate.doi);
  
  doiCache.set(doiKey, doiResult.valid);
  
  if (!doiResult.valid) {
    return {
      verified: false,
      doiValid: false,
      urlAccessible: false,
      titleMatch: 0,
      finalUrl: "",
      reason: "DOI not found in CrossRef",
    };
  }

  const similarity = titleSimilarity(candidate.title, doiResult.title);
  
  if (similarity < 0.4) {
    return {
      verified: false,
      doiValid: true,
      urlAccessible: true,
      titleMatch: similarity,
      finalUrl: doiResult.url,
      reason: `Title mismatch: similarity ${(similarity * 100).toFixed(0)}% < 40%`,
    };
  }

  return {
    verified: true,
    doiValid: true,
    urlAccessible: true,
    titleMatch: similarity,
    finalUrl: doiResult.url,
    reason: "Verified successfully",
    crossrefData: doiResult,
  };
}

export async function verifyBatch(
  candidates: AcademicCandidate[],
  maxConcurrency: number = 5,
  yearStart: number = new Date().getFullYear() - 5,
  yearEnd: number = new Date().getFullYear()
): Promise<AcademicCandidate[]> {
  console.log(`[LinkVerifierAgent] Verifying ${candidates.length} candidates (years ${yearStart}-${yearEnd}, concurrency=${maxConcurrency})...`);
  console.log(`[LinkVerifierAgent] DOI cache size: ${doiCache.size} entries`);
  
  const verified: AcademicCandidate[] = [];
  const failed: { title: string; reason: string }[] = [];
  
  const semaphore = new Semaphore(maxConcurrency);
  
  const verificationPromises = candidates.map(async (candidate) => {
    return semaphore.withPermit(async () => {
      const result = await verifyCandidate(candidate, yearStart, yearEnd);
      return { candidate, result };
    });
  });

  const results = await Promise.all(verificationPromises);

  for (const { candidate, result } of results) {
    if (result.verified) {
      candidate.verified = true;
      candidate.verificationStatus = "verified";
      candidate.landingUrl = result.finalUrl || candidate.landingUrl;
      
      if (result.crossrefData) {
        const cr = result.crossrefData;
        if ((!candidate.city || candidate.city === "Unknown") && cr.city && cr.city !== "Unknown") {
          candidate.city = cr.city;
        }
        if ((!candidate.country || candidate.country === "Unknown") && cr.country && cr.country !== "Unknown") {
          candidate.country = cr.country;
        }
        if ((!candidate.year || candidate.year === 0) && cr.year && cr.year > 0) {
          candidate.year = cr.year;
        }
        if (candidate.authors.length === 0 && cr.authors && cr.authors.length > 0) {
          candidate.authors = cr.authors;
        }
        if ((!candidate.journal || candidate.journal === "Unknown") && cr.journal && cr.journal !== "Unknown") {
          candidate.journal = cr.journal;
        }
        if ((!candidate.abstract || candidate.abstract === "Unknown" || candidate.abstract === "") && cr.abstract) {
          candidate.abstract = cr.abstract;
        }
        if (candidate.keywords.length === 0 && cr.keywords && cr.keywords.length > 0) {
          candidate.keywords = cr.keywords;
        }
      }
      
      verified.push(candidate);
    } else {
      candidate.verificationStatus = "failed";
      failed.push({
        title: candidate.title.substring(0, 50),
        reason: result.reason,
      });
    }
  }

  console.log(`[LinkVerifierAgent] Verified: ${verified.length}, Failed: ${failed.length}`);
  console.log(`[LinkVerifierAgent] DOI cache size after: ${doiCache.size} entries`);

  return verified;
}

export async function enrichMetadata(candidate: AcademicCandidate): Promise<AcademicCandidate> {
  if (!candidate.doi) return candidate;

  const metadata = await lookupDOI(candidate.doi);
  
  if (!metadata) return candidate;

  const bestYear = (metadata.year && metadata.year > 0) ? metadata.year : candidate.year;
  const bestCity = (metadata.city && metadata.city !== "Unknown") ? metadata.city : candidate.city;
  const bestCountry = (metadata.country && metadata.country !== "Unknown") ? metadata.country : candidate.country;
  const bestAuthors = metadata.authors.length > 0 ? metadata.authors : candidate.authors;

  return {
    ...candidate,
    title: metadata.title || candidate.title,
    authors: bestAuthors,
    year: bestYear,
    journal: metadata.journal !== "Unknown" ? metadata.journal : candidate.journal,
    abstract: metadata.abstract || candidate.abstract,
    documentType: metadata.documentType || candidate.documentType,
    language: mapLanguageCode(metadata.language) || candidate.language,
    keywords: metadata.keywords.length > 0 ? metadata.keywords : candidate.keywords,
    citationCount: metadata.citationCount || candidate.citationCount,
    affiliations: metadata.affiliations.length > 0 ? metadata.affiliations : candidate.affiliations,
    city: bestCity,
    country: bestCountry,
  };
}

function mapLanguageCode(code: string): string {
  const map: Record<string, string> = {
    "en": "English",
    "es": "Spanish",
    "pt": "Portuguese",
    "de": "German",
    "fr": "French",
    "it": "Italian",
    "zh": "Chinese",
    "ja": "Japanese",
    "ko": "Korean",
    "ru": "Russian",
  };
  return map[code?.toLowerCase()] || code || "English";
}

export async function enrichBatch(candidates: AcademicCandidate[]): Promise<AcademicCandidate[]> {
  console.log(`[MetadataAgent] Enriching ${candidates.length} candidates...`);
  
  const enriched: AcademicCandidate[] = [];
  
  for (const candidate of candidates) {
    const result = await enrichMetadata(candidate);
    enriched.push(result);
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  return enriched;
}

export interface CriticResult {
  passed: boolean;
  totalVerified: number;
  targetCount: number;
  duplicatesRemoved: number;
  issues: string[];
  blockers: string[];
}

export function runCriticGuard(
  candidates: AcademicCandidate[],
  targetCount: number = 50,
  yearStart: number = new Date().getFullYear() - 5,
  yearEnd: number = new Date().getFullYear()
): CriticResult {
  console.log(`[CriticGuardAgent] Checking ${candidates.length} candidates against criteria...`);
  
  const issues: string[] = [];
  const blockers: string[] = [];

  const verified = candidates.filter(c => c.verificationStatus === "verified");
  if (verified.length < candidates.length) {
    issues.push(`${candidates.length - verified.length} candidates not verified`);
  }

  const seenDois = new Set<string>();
  const seenTitles = new Set<string>();
  const deduplicated: AcademicCandidate[] = [];
  let duplicatesRemoved = 0;

  for (const candidate of verified) {
    const doiKey = candidate.doi?.toLowerCase().trim() || "";
    const normalizedTitle = candidate.title.toLowerCase().replace(/[^\w]/g, "").substring(0, 50);
    const titleKey = normalizedTitle;
    
    if (doiKey && seenDois.has(doiKey)) {
      duplicatesRemoved++;
      continue;
    }
    if (seenTitles.has(titleKey)) {
      duplicatesRemoved++;
      continue;
    }
    
    if (doiKey) seenDois.add(doiKey);
    seenTitles.add(titleKey);
    deduplicated.push(candidate);
  }

  if (duplicatesRemoved > 0) {
    issues.push(`Removed ${duplicatesRemoved} duplicates`);
  }

  const inYearRange = deduplicated.filter(c => c.year >= yearStart && c.year <= yearEnd);
  if (inYearRange.length < deduplicated.length) {
    const outOfRange = deduplicated.length - inYearRange.length;
    issues.push(`${outOfRange} articles outside year range ${yearStart}-${yearEnd}`);
  }

  const withDoi = inYearRange.filter(c => c.doi && c.doi.length > 0);
  if (withDoi.length < inYearRange.length) {
    issues.push(`${inYearRange.length - withDoi.length} articles missing DOI`);
  }

  const withRelevance = withDoi.filter(c => c.relevanceScore >= RELEVANCE_THRESHOLD);
  if (withRelevance.length < withDoi.length) {
    issues.push(`${withDoi.length - withRelevance.length} articles below relevance threshold`);
  }

  const finalCount = withRelevance.length;
  const MIN_VERIFIED_THRESHOLD = 50;
  
  if (finalCount < MIN_VERIFIED_THRESHOLD) {
    blockers.push(`Only ${finalCount} verified articles (minimum required: ${MIN_VERIFIED_THRESHOLD})`);
  }

  const passed = blockers.length === 0;

  console.log(`[CriticGuardAgent] Result: ${passed ? "PASSED" : "BLOCKED"}`);
  console.log(`[CriticGuardAgent] Final count: ${finalCount}/${MIN_VERIFIED_THRESHOLD} (target: ${targetCount})`);
  
  if (issues.length > 0) {
    console.log(`[CriticGuardAgent] Issues: ${issues.join("; ")}`);
  }
  if (blockers.length > 0) {
    console.log(`[CriticGuardAgent] Blockers: ${blockers.join("; ")}`);
  }

  return {
    passed,
    totalVerified: finalCount,
    targetCount: MIN_VERIFIED_THRESHOLD,
    duplicatesRemoved,
    issues,
    blockers,
  };
}

function isValidValue(val: string | undefined | null): boolean {
  if (!val) return false;
  const lower = val.toLowerCase().trim();
  return lower !== "" && lower !== "unknown" && lower !== "n/a" && lower !== "null" && lower !== "undefined";
}

function mergeCandidate(existing: AcademicCandidate, incoming: AcademicCandidate): AcademicCandidate {
  const merged: AcademicCandidate = { ...existing };
  
  if (!isValidValue(existing.city) && isValidValue(incoming.city)) {
    merged.city = incoming.city;
  }
  if (!isValidValue(existing.country) && isValidValue(incoming.country)) {
    merged.country = incoming.country;
  }
  if ((!existing.year || existing.year === 0) && incoming.year && incoming.year > 0) {
    merged.year = incoming.year;
  }
  if (existing.authors.length === 0 && incoming.authors.length > 0) {
    merged.authors = incoming.authors;
  }
  if (!isValidValue(existing.abstract) && isValidValue(incoming.abstract)) {
    merged.abstract = incoming.abstract;
  }
  if (!isValidValue(existing.journal) && isValidValue(incoming.journal)) {
    merged.journal = incoming.journal;
  }
  if (existing.keywords.length === 0 && incoming.keywords.length > 0) {
    merged.keywords = incoming.keywords;
  }
  if (!isValidValue(existing.language) && isValidValue(incoming.language)) {
    merged.language = incoming.language;
  }
  if (!isValidValue(existing.documentType) && isValidValue(incoming.documentType)) {
    merged.documentType = incoming.documentType;
  }
  if (!isValidValue(existing.doi) && isValidValue(incoming.doi)) {
    merged.doi = incoming.doi;
  }
  if (!isValidValue(existing.landingUrl) && isValidValue(incoming.landingUrl)) {
    merged.landingUrl = incoming.landingUrl;
  }
  
  console.log(`[Dedup] Merged duplicate: city=${merged.city}, country=${merged.country}, year=${merged.year}, authors=${merged.authors.length}`);
  
  return merged;
}

export function deduplicateCandidates(candidates: AcademicCandidate[]): AcademicCandidate[] {
  const doiMap = new Map<string, number>();
  const titleMap = new Map<string, number>();
  const result: AcademicCandidate[] = [];

  for (const candidate of candidates) {
    const doiKey = candidate.doi?.toLowerCase() || "";
    const titleKey = candidate.title.toLowerCase().replace(/[^\w]/g, "").substring(0, 50);
    
    let existingIndex = -1;
    if (doiKey && doiMap.has(doiKey)) {
      existingIndex = doiMap.get(doiKey)!;
    } else if (titleMap.has(titleKey)) {
      existingIndex = titleMap.get(titleKey)!;
    }
    
    if (existingIndex >= 0) {
      result[existingIndex] = mergeCandidate(result[existingIndex], candidate);
    } else {
      const newIndex = result.length;
      if (doiKey) doiMap.set(doiKey, newIndex);
      titleMap.set(titleKey, newIndex);
      result.push(candidate);
    }
  }

  console.log(`[Dedup] Deduplicated ${candidates.length} -> ${result.length} candidates`);
  return result;
}
