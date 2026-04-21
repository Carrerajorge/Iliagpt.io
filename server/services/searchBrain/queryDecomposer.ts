/**
 * queryDecomposer — Phase 1 of the WebGLM pipeline.
 *
 * Takes the user's free-form query and produces 3-5 retrieval-ready
 * sub-queries in Spanish + English. Why both languages: our corpus
 * mix leans Latin American (SciELO, Redalyc are Spanish-first) but
 * the bigger indexes (OpenAlex, Semantic Scholar, CrossRef) are
 * English-dominant. Mixing widens recall without duplicating the
 * fan-out cost.
 *
 * Degrades gracefully: if the LLM is unavailable, malformed, or
 * returns nothing, the decomposer falls back to `[{text: originalQuery}]`
 * so retrieval still runs.
 */

import type { DecomposedQuery, SearchBrainDeps } from "./types";

const DECOMPOSER_SYSTEM = `You rewrite a user's academic search query into 3-5 retrieval-friendly sub-queries.

Output format — STRICT JSON:
{
  "subqueries": [
    { "text": "<sub-query in Spanish>", "language": "es", "rationale": "<one short phrase>" },
    { "text": "<sub-query in English>", "language": "en", "rationale": "<one short phrase>" }
  ]
}

Rules:
- Cover the original intent across DIFFERENT angles: terminology, broader concept, narrower specialisation, methodology, entities involved.
- Mix "es" and "en" so retrieval hits both Latin American and English-dominant databases. At least one of each.
- Each sub-query is 4-12 words — a query a search engine can actually match on, not a full sentence.
- Keep named entities (people, institutions, drug names, numbers) intact; don't translate them.
- 3 to 5 sub-queries. If the original query is already atomic and mono-lingual, still produce ≥ 1 bilingual counterpart.`;

type LLMResult = Array<{ text: string; language: "es" | "en"; rationale?: string }>;

function parseJSON(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function validateSubqueries(raw: unknown): LLMResult {
  if (!isRecord(raw) || !Array.isArray(raw.subqueries)) return [];
  const out: LLMResult = [];
  for (const item of raw.subqueries) {
    if (!isRecord(item)) continue;
    const text = typeof item.text === "string" ? item.text.trim() : "";
    const language = item.language === "en" || item.language === "es" ? item.language : null;
    if (!text || !language) continue;
    out.push({
      text,
      language,
      rationale: typeof item.rationale === "string" ? item.rationale.slice(0, 200) : undefined,
    });
    if (out.length >= 6) break;
  }
  return out;
}

export async function decomposeQuery(args: {
  query: string;
  language?: "es" | "en" | "auto";
  userId?: string;
  deps?: SearchBrainDeps;
  maxSubQueries?: number;
}): Promise<DecomposedQuery[]> {
  const { query } = args;
  const maxSubQueries = args.maxSubQueries ?? 5;
  if (!query || typeof query !== "string" || query.trim().length === 0) return [];

  const fallback: DecomposedQuery[] = [
    { text: query.trim(), language: detectLanguage(query, args.language) },
  ];

  if (!args.deps?.callLLM) return fallback;

  try {
    const { content } = await args.deps.callLLM({
      system: DECOMPOSER_SYSTEM,
      user: `ORIGINAL QUERY:\n${query.slice(0, 1500)}\n\nProduce ${maxSubQueries} sub-queries.`,
      userId: args.userId,
      temperature: 0.2,
      maxTokens: 400,
    });
    const parsed = parseJSON(content ?? "");
    const sub = validateSubqueries(parsed);
    if (sub.length === 0) return fallback;
    return sub.slice(0, maxSubQueries);
  } catch {
    return fallback;
  }
}

function detectLanguage(q: string, hint?: "es" | "en" | "auto"): "es" | "en" {
  if (hint === "es" || hint === "en") return hint;
  // Dead simple heuristic: if the string contains the common Spanish
  // accented letters or the ¿¡ punctuation pair, call it "es".
  if (/[áéíóúñ¿¡]/i.test(q)) return "es";
  // Otherwise default to English — the bigger retrieval corpus.
  return "en";
}

export const DECOMPOSER_INTERNAL = { validateSubqueries, parseJSON, detectLanguage };
export { DECOMPOSER_SYSTEM };
