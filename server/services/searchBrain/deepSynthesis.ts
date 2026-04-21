/**
 * deepSynthesis — fuses academic + web SearchBrain results into an
 * LLM-written answer with numbered APA 7 citations.
 *
 * Pipeline:
 *   1. Run academic + web searches in parallel.
 *   2. Take top-N (default 8 academic + 4 web) as citation pool.
 *   3. Build the prompt: user question, numbered passages, rubric.
 *   4. LLM returns `{ answer, citations[] }` where each in-text marker
 *      is [1], [2], … matching the passage number.
 *   5. Attach APA 7-style references for the numbers the LLM actually
 *      used. Unused citations are dropped.
 *
 * APA 7 formatting is done server-side from structured fields — we
 * don't trust the LLM to compose references because the LLM routinely
 * mangles page ranges, italics, and DOI prefixes. The LLM's job is
 * ONLY to pick which number to cite; the string goes through our
 * deterministic formatter.
 */

import type { NormalisedResult, SearchBrainDeps } from "./types";
import type { WebResult } from "./webProviders";

export interface DeepSynthesisInput {
  query: string;
  academic: NormalisedResult[];
  web: WebResult[];
  /** Cap on total passages fed to the synthesiser (default 12). */
  maxPassages?: number;
  /** Max ratio of academic vs web (default 8:4). */
  academicLimit?: number;
  webLimit?: number;
  userId?: string;
  deps?: SearchBrainDeps;
}

export type CitedPassageType = "academic" | "web";

export interface CitedPassage {
  number: number;
  type: CitedPassageType;
  source: string;
  title: string;
  url: string;
  authors?: string[];
  year?: number;
  journal?: string;
  doi?: string;
}

export interface DeepSynthesisResponse {
  answer: string;
  references: Array<{ number: number; apa: string; type: CitedPassageType; url: string; doi?: string }>;
  passages: CitedPassage[];
  usedCitations: number[];
  /** True when the LLM was available; false = we returned a deterministic fallback answer. */
  synthesised: boolean;
}

const SYNTH_SYSTEM = `You are an academic research assistant. You will answer a user's question using ONLY the provided PASSAGES, cited with numbered markers [1], [2], …

Output format — STRICT JSON:
{
  "answer": "<400-800 word answer with inline numeric citations [1], [2], …>",
  "used": [<1-indexed list of passage numbers your answer actually cites>]
}

Rules:
- Every factual claim must end with a bracketed citation, e.g. "…in 1889 [3]."
- Use ONLY the passage numbers provided. Do NOT invent references.
- Prefer academic passages over web ones when available. Use web passages for context that academic ones don't cover.
- If a passage directly answers the question, cite it. If none do, write "The available sources do not clearly answer this question" and return used=[].
- Keep the answer in the language of the user question.`;

function parseJSON(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function toCitedPassages(
  academic: NormalisedResult[],
  web: WebResult[],
  academicLimit: number,
  webLimit: number,
  maxPassages: number
): CitedPassage[] {
  const passages: CitedPassage[] = [];
  let n = 1;
  for (const r of academic.slice(0, academicLimit)) {
    if (passages.length >= maxPassages) break;
    passages.push({
      number: n++,
      type: "academic",
      source: r.source,
      title: r.title,
      url: r.url,
      authors: r.authors,
      year: r.year,
      journal: r.journal,
      doi: r.doi,
    });
  }
  for (const w of web.slice(0, webLimit)) {
    if (passages.length >= maxPassages) break;
    passages.push({
      number: n++,
      type: "web",
      source: w.source,
      title: w.title,
      url: w.url,
    });
  }
  return passages;
}

function buildPrompt(query: string, passages: CitedPassage[], academicContent: Map<number, string>, webSnippets: Map<number, string>): string {
  const lines: string[] = [];
  lines.push(`USER QUESTION:\n${query.slice(0, 1500)}\n`);
  lines.push("PASSAGES:");
  for (const p of passages) {
    const label = p.type === "academic" ? `ACADEMIC [${p.source}]` : `WEB [${p.source}]`;
    const summary =
      p.type === "academic"
        ? academicContent.get(p.number) ?? ""
        : webSnippets.get(p.number) ?? "";
    const year = p.year ? ` (${p.year})` : "";
    const authors = p.authors && p.authors.length > 0 ? p.authors.slice(0, 4).join(", ") : "";
    const header = [`[${p.number}] ${label} — ${p.title}${year}`, authors].filter(Boolean).join("\n    ");
    lines.push(`${header}\n    ${summary.slice(0, 800).replace(/\s+/g, " ")}`);
  }
  return lines.join("\n\n");
}

// ─── APA 7 formatter (deterministic, LLM-agnostic) ────────────────────────

function formatApaAuthors(authors: string[] | undefined): string {
  if (!authors || authors.length === 0) return "";
  // Very simple last-name extraction — we don't know first-name vs
  // last-name with certainty; using the first token as-is is decent.
  const formatOne = (a: string) => a.trim();
  if (authors.length === 1) return formatOne(authors[0]);
  if (authors.length === 2) return `${formatOne(authors[0])}, & ${formatOne(authors[1])}`;
  const first = authors.slice(0, 20).map(formatOne);
  if (authors.length > 20) {
    return `${first.slice(0, 19).join(", ")}, … ${formatOne(authors[authors.length - 1])}`;
  }
  return `${first.slice(0, -1).join(", ")}, & ${first.at(-1)!}`;
}

export function formatApaReference(p: CitedPassage): string {
  const parts: string[] = [];
  if (p.type === "academic") {
    const authors = formatApaAuthors(p.authors);
    if (authors) parts.push(`${authors}.`);
    parts.push(p.year ? `(${p.year}).` : "(n.d.).");
    parts.push(`${p.title}.`);
    if (p.journal) parts.push(`*${p.journal}*.`);
    if (p.doi) parts.push(`https://doi.org/${p.doi}`);
    else if (p.url) parts.push(p.url);
    return parts.join(" ");
  }
  // Web reference — author is the site host as a stand-in.
  let host = "";
  try {
    host = new URL(p.url).hostname.replace(/^www\./, "");
  } catch {
    host = p.source;
  }
  return `${p.title}. (n.d.). *${host}*. ${p.url}`;
}

function parseUsedCitations(raw: unknown, passageCount: number): number[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<number>();
  for (const v of raw) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n) && n >= 1 && n <= passageCount) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** Extract [1], [2] markers already present in the answer prose so
 *  we can round-trip even when the LLM forgets to list them. */
export function extractInlineCitations(answer: string, max: number): number[] {
  const matches = answer.match(/\[(\d{1,3})\]/g) ?? [];
  const out = new Set<number>();
  for (const m of matches) {
    const n = Number(m.slice(1, -1));
    if (n >= 1 && n <= max) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

function fallbackAnswer(passages: CitedPassage[]): { answer: string; usedCitations: number[] } {
  if (passages.length === 0) {
    return { answer: "The available sources do not clearly answer this question.", usedCitations: [] };
  }
  // Deterministic summary: first line from each passage with its number.
  const lines = passages.slice(0, 6).map((p) => `- ${p.title} [${p.number}]`);
  return {
    answer: `Based on the retrieved sources:\n${lines.join("\n")}`,
    usedCitations: passages.slice(0, 6).map((p) => p.number),
  };
}

// ─── Main entrypoint ──────────────────────────────────────────────────────

export async function synthesiseDeepAnswer(input: DeepSynthesisInput): Promise<DeepSynthesisResponse> {
  const academicLimit = input.academicLimit ?? 8;
  const webLimit = input.webLimit ?? 4;
  const maxPassages = input.maxPassages ?? 12;
  const passages = toCitedPassages(input.academic, input.web, academicLimit, webLimit, maxPassages);

  const academicContent = new Map<number, string>();
  for (const p of passages) {
    if (p.type !== "academic") continue;
    const match = input.academic.find((a) => a.title === p.title && a.url === p.url);
    if (match?.abstract) academicContent.set(p.number, match.abstract);
  }
  const webSnippets = new Map<number, string>();
  for (const p of passages) {
    if (p.type !== "web") continue;
    const match = input.web.find((w) => w.title === p.title && w.url === p.url);
    if (match?.snippet) webSnippets.set(p.number, match.snippet);
  }

  let answer: string;
  let usedCitations: number[];
  let synthesised = false;

  if (input.deps?.callLLM && passages.length > 0) {
    try {
      const { content } = await input.deps.callLLM({
        system: SYNTH_SYSTEM,
        user: buildPrompt(input.query, passages, academicContent, webSnippets),
        userId: input.userId,
        temperature: 0.2,
        maxTokens: 1400,
      });
      const parsed = parseJSON(content ?? "");
      const parsedAnswer = isRecord(parsed) && typeof parsed.answer === "string" ? parsed.answer.trim() : "";
      if (parsedAnswer) {
        answer = parsedAnswer;
        const explicit = isRecord(parsed) ? parseUsedCitations(parsed.used, passages.length) : [];
        const inline = extractInlineCitations(answer, passages.length);
        usedCitations = Array.from(new Set([...explicit, ...inline])).sort((a, b) => a - b);
        synthesised = true;
      } else {
        const fb = fallbackAnswer(passages);
        answer = fb.answer;
        usedCitations = fb.usedCitations;
      }
    } catch {
      const fb = fallbackAnswer(passages);
      answer = fb.answer;
      usedCitations = fb.usedCitations;
    }
  } else {
    const fb = fallbackAnswer(passages);
    answer = fb.answer;
    usedCitations = fb.usedCitations;
  }

  const usedPassages = passages.filter((p) => usedCitations.includes(p.number));
  const references = usedPassages.map((p) => ({
    number: p.number,
    apa: formatApaReference(p),
    type: p.type,
    url: p.url,
    doi: p.doi,
  }));

  return {
    answer,
    references,
    passages,
    usedCitations,
    synthesised,
  };
}

export const DEEP_SYNTHESIS_INTERNAL = {
  toCitedPassages,
  formatApaAuthors,
  formatApaReference,
  parseUsedCitations,
  extractInlineCitations,
  fallbackAnswer,
};
