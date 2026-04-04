/**
 * CrossLingualRetriever — Cross-language search by translating queries and
 * normalizing scores across languages. Compatible with BGE-M3 multilingual
 * embeddings (and the project's Gemini embedding-001 which supports 100+ languages).
 *
 * Strategy:
 * 1. Detect query language
 * 2. Translate query to other language(s) if needed
 * 3. Retrieve with each language variant
 * 4. Normalize scores across language sets
 * 5. Merge, deduplicate, re-sort
 */

import { createLogger } from "../../utils/logger";
import type {
  RetrieveStage,
  RetrievedChunk,
  RetrieveOptions,
} from "../UnifiedRAGPipeline";

const logger = createLogger("CrossLingualRetriever");

// ─── Language detection ───────────────────────────────────────────────────────

export type SupportedLanguage = "es" | "en" | "pt" | "fr" | "de" | "it" | "auto";

interface LangSignature {
  lang: SupportedLanguage;
  tokens: string[];
}

const LANG_SIGNATURES: LangSignature[] = [
  { lang: "es", tokens: ["el","la","los","las","de","que","en","un","una","es","por","con","del","al","se","pero","como","más","todo","también"] },
  { lang: "en", tokens: ["the","is","are","of","and","to","in","for","with","that","this","have","it","at","be","from","but","also","more","all"] },
  { lang: "pt", tokens: ["o","a","os","as","de","que","em","um","uma","é","por","com","do","da","se","mas","como","mais","tudo","também"] },
  { lang: "fr", tokens: ["le","la","les","de","que","en","un","une","est","par","avec","du","au","se","mais","comme","plus","tout","aussi"] },
  { lang: "de", tokens: ["der","die","das","des","dem","den","ein","eine","ist","von","mit","für","auch","aus","noch","nur","über","beim","unter"] },
  { lang: "it", tokens: ["il","la","i","le","di","che","in","un","una","è","per","con","del","al","si","ma","come","più","tutto","anche"] },
];

function detectLanguage(text: string): SupportedLanguage {
  const words = new Set(text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((w) => w.length > 1));
  let best: SupportedLanguage = "en";
  let bestScore = -1;

  for (const sig of LANG_SIGNATURES) {
    const score = sig.tokens.filter((t) => words.has(t)).length;
    if (score > bestScore) {
      bestScore = score;
      best = sig.lang;
    }
  }

  return bestScore >= 2 ? best : "en";
}

// ─── Translation (via LLM) ───────────────────────────────────────────────────

async function translateQuery(
  query: string,
  fromLang: SupportedLanguage,
  toLang: SupportedLanguage
): Promise<string> {
  if (fromLang === toLang) return query;

  const { llmGateway } = await import("../../lib/llmGateway");

  const langNames: Record<SupportedLanguage, string> = {
    es: "Spanish", en: "English", pt: "Portuguese", fr: "French",
    de: "German", it: "Italian", auto: "English",
  };

  try {
    const response = await llmGateway.chat(
      [
        {
          role: "system",
          content: `You are a precise translator. Translate the search query from ${langNames[fromLang]} to ${langNames[toLang]}. Preserve technical terms and proper nouns. Return ONLY the translated query.`,
        },
        { role: "user", content: query },
      ],
      { model: "gpt-4o-mini", maxTokens: 150, temperature: 0 }
    );
    return response.content.trim();
  } catch (err) {
    logger.warn("Translation failed, using original query", { fromLang, toLang, error: String(err) });
    return query;
  }
}

// ─── Score normalization ──────────────────────────────────────────────────────

function normalizeScores(chunks: RetrievedChunk[]): RetrievedChunk[] {
  if (chunks.length === 0) return [];
  const max = Math.max(...chunks.map((c) => c.score));
  const min = Math.min(...chunks.map((c) => c.score));
  const range = max - min;
  if (range === 0) return chunks;
  return chunks.map((c) => ({ ...c, score: (c.score - min) / range }));
}

// ─── Bilingual result merging ─────────────────────────────────────────────────

function mergeAndDeduplicate(
  resultSets: Array<{ chunks: RetrievedChunk[]; weight: number }>
): RetrievedChunk[] {
  const best = new Map<string, RetrievedChunk>();

  for (const { chunks, weight } of resultSets) {
    const normalized = normalizeScores(chunks);
    for (const chunk of normalized) {
      const weightedScore = chunk.score * weight;
      const existing = best.get(chunk.id);
      if (!existing) {
        best.set(chunk.id, { ...chunk, score: weightedScore });
      } else {
        // Take max of weighted scores (same chunk retrieved via multiple language paths)
        best.set(chunk.id, { ...existing, score: Math.max(existing.score, weightedScore) });
      }
    }
  }

  const merged = Array.from(best.values());
  merged.sort((a, b) => b.score - a.score);
  return merged;
}

// ─── CrossLingualRetriever ────────────────────────────────────────────────────

export interface CrossLingualConfig {
  /** Which target languages to search in, in addition to the query language */
  targetLanguages: SupportedLanguage[];
  /** Weight for original-language results (vs translated) */
  originalWeight: number;
  /** Weight for cross-language results */
  crossLingualWeight: number;
  /** Whether to translate results' metadata back to query language */
  translateResults: boolean;
  /** Max characters to send for translation (to control LLM costs) */
  maxQueryLength: number;
}

const DEFAULT_XLING_CONFIG: CrossLingualConfig = {
  targetLanguages: ["es", "en"],
  originalWeight: 1.0,
  crossLingualWeight: 0.85,
  translateResults: false,
  maxQueryLength: 500,
};

export class CrossLingualRetriever implements RetrieveStage {
  private readonly config: CrossLingualConfig;
  private readonly baseRetriever: RetrieveStage;
  private embedQuery: (query: string) => Promise<number[]>;

  constructor(
    baseRetriever: RetrieveStage,
    embedQuery: (query: string) => Promise<number[]>,
    config: Partial<CrossLingualConfig> = {}
  ) {
    this.baseRetriever = baseRetriever;
    this.embedQuery = embedQuery;
    this.config = { ...DEFAULT_XLING_CONFIG, ...config };
  }

  async retrieve(
    query: string,
    queryEmbedding: number[],
    options: RetrieveOptions = {}
  ): Promise<RetrievedChunk[]> {
    const queryLang = detectLanguage(query);
    const truncatedQuery = query.slice(0, this.config.maxQueryLength);

    logger.debug("CrossLingualRetriever starting", {
      queryLang,
      targetLanguages: this.config.targetLanguages,
      query: query.slice(0, 60),
    });

    // Determine which additional languages to search
    const additionalLangs = this.config.targetLanguages.filter((l) => l !== queryLang && l !== "auto");

    const resultSets: Array<{ chunks: RetrievedChunk[]; weight: number }> = [];

    // Retrieve in query language (original)
    try {
      const originalResults = await this.baseRetriever.retrieve(query, queryEmbedding, {
        ...options,
        filterLanguage: queryLang !== "auto" ? queryLang : undefined,
      });
      resultSets.push({ chunks: originalResults, weight: this.config.originalWeight });
    } catch (err) {
      logger.error("Original language retrieval failed", { queryLang, error: String(err) });
    }

    // Retrieve in additional languages (skip filter to allow cross-lingual docs)
    if (additionalLangs.length > 0) {
      const translationPromises = additionalLangs.map(async (targetLang) => {
        try {
          const translatedQuery = await translateQuery(queryLang, queryLang, targetLang);
          const translatedEmbedding = await this.embedQuery(translatedQuery);

          const results = await this.baseRetriever.retrieve(
            translatedQuery,
            translatedEmbedding,
            {
              ...options,
              filterLanguage: targetLang,
              topK: Math.ceil((options.topK ?? 10) * 0.7), // Fetch fewer cross-lingual results
            }
          );

          return { chunks: results, weight: this.config.crossLingualWeight, lang: targetLang };
        } catch (err) {
          logger.warn("Cross-lingual retrieval failed", { targetLang, error: String(err) });
          return null;
        }
      });

      const translationResults = await Promise.all(translationPromises);
      for (const result of translationResults) {
        if (result) {
          resultSets.push({ chunks: result.chunks, weight: result.weight });
        }
      }
    }

    if (resultSets.length === 0) return [];

    // Merge and deduplicate across language result sets
    const merged = mergeAndDeduplicate(resultSets);
    const topK = options.topK ?? 10;
    const final = merged.slice(0, topK);

    logger.info("CrossLingualRetriever complete", {
      queryLang,
      resultSets: resultSets.length,
      totalBeforeMerge: resultSets.reduce((sum, r) => sum + r.chunks.length, 0),
      finalCount: final.length,
    });

    return final;
  }

  /** Expose language detection for external use (e.g., pipeline pre-filtering) */
  static detectLanguage(text: string): SupportedLanguage {
    return detectLanguage(text);
  }
}

// ─── Language stats helper ────────────────────────────────────────────────────

export function analyzeLanguageDistribution(
  chunks: RetrievedChunk[]
): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const chunk of chunks) {
    const lang = chunk.metadata.language ?? "unknown";
    dist[lang] = (dist[lang] ?? 0) + 1;
  }
  return dist;
}
