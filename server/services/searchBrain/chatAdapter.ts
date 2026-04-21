/**
 * chatAdapter — bridges the SearchBrain pipeline into the main
 * chatService's `webSources` contract.
 *
 * Why a separate file:
 *   chatService.ts is already 2k+ lines and owns the per-message
 *   state machine. Keeping the SearchBrain integration isolated here
 *   means the diff in chatService stays to one import + one call, and
 *   this file can evolve (e.g. add semantic cache fallbacks, Redis
 *   priming, provider-failure telemetry) without bloating chatService
 *   further.
 *
 * Output contract — must match what message-list.tsx / SourcesIndicator
 * / SourcesPanel expect:
 *
 *   WebSource {
 *     url, title, domain, favicon, snippet, date, imageUrl,
 *     canonicalUrl, siteName, source: { name, domain }, metadata
 *   }
 *
 * The adapter also produces the `webSearchInfo` block that's injected
 * into the LLM context. Format mimics the existing convention — one
 * paragraph per paper with Autores / Año / Título / Journal / DOI / URL /
 * Resumen / Cita APA 7 — but the URL is shown as the raw link, never
 * hyperlinked, so the LLM's generated response can quote it exactly
 * and the frontend renders a clickable link (as in screenshot 1).
 *
 * Degradation: on any failure (empty result set, provider timeouts,
 * LLM reranker errors) this function returns null so the caller falls
 * back to the legacy academicResearchEngineV3.
 */

import type { NormalisedResult } from "./types";
import { searchAcademic } from "./index";

/**
 * Shape-compatible with the `WebSource` interface defined inside
 * `server/services/chatService.ts`. We redeclare it locally instead of
 * importing because chatService is a consumer of this adapter and
 * importing in that direction would create a cycle.
 */
export interface WebSource {
  url: string;
  title: string;
  domain: string;
  favicon?: string;
  snippet?: string;
  date?: string;
  imageUrl?: string;
  canonicalUrl?: string;
  siteName?: string;
  source?: {
    name: string;
    domain: string;
  };
  metadata?: Record<string, unknown>;
}

export interface SearchBrainChatResult {
  webSources: WebSource[];
  /** Block to inject into the LLM context, formatted for attribution. */
  webSearchInfo: string;
  /** How many raw hits came back across providers (pre-dedupe). */
  rawCount: number;
  /** Which providers produced at least one result. */
  providersUsed: string[];
  /** Cache-hit metadata, useful for traces. */
  cache?: { hit: boolean; matchedBy?: string; source?: string };
}

export interface SearchBrainChatOptions {
  query: string;
  userId?: string;
  mailto?: string;
  /** Controls whether Scopus/WoS scraping is allowed (flag from user settings). */
  enableScrapingProviders?: boolean;
  /** How many papers to include in the prompt context (default 15). */
  maxContextPapers?: number;
  /** How many WebSource entries to return for the UI (default 20). */
  maxSources?: number;
}

/**
 * Run a SearchBrain academic search and project the output into the
 * shape chatService expects. Returns null when no useful results were
 * produced; caller should fall back to the legacy engine.
 */
export async function runSearchBrainForChat(
  options: SearchBrainChatOptions
): Promise<SearchBrainChatResult | null> {
  const maxContextPapers = options.maxContextPapers ?? 15;
  const maxSources = options.maxSources ?? 20;

  let response: Awaited<ReturnType<typeof searchAcademic>>;
  try {
    response = await searchAcademic({
      query: options.query,
      maxResults: Math.max(maxContextPapers, maxSources),
      userId: options.userId,
      mailto: options.mailto,
      enableScrapingProviders: options.enableScrapingProviders,
      rerank: true,
      language: "auto",
    });
  } catch {
    return null;
  }

  const results = response.results ?? [];
  if (results.length === 0) return null;

  const webSources = results.slice(0, maxSources).map(toWebSource).filter(Boolean) as WebSource[];
  const webSearchInfo = buildPromptInjection(results.slice(0, maxContextPapers), response.providers);
  const providersUsed = response.providers.filter((p) => p.ok && p.count > 0).map((p) => p.source);

  return {
    webSources,
    webSearchInfo,
    rawCount: response.providers.reduce((s, p) => s + p.count, 0),
    providersUsed,
    cache: response.cache
      ? { hit: response.cache.hit, matchedBy: response.cache.matchedBy, source: response.cache.source }
      : undefined,
  };
}

// ─── Normalised → WebSource ───────────────────────────────────────────────

function toWebSource(r: NormalisedResult): WebSource | null {
  if (!r.url && !r.doi) return null;
  const url = r.url || (r.doi ? `https://doi.org/${r.doi}` : "");
  if (!url) return null;
  const domain = safeDomain(url);
  const snippetRaw = r.abstract || r.title || "";
  const snippet = snippetRaw.length > 200 ? snippetRaw.slice(0, 197) + "…" : snippetRaw;

  const metadata: Record<string, unknown> = {
    provider: r.source,
    year: r.year,
    journal: r.journal,
    doi: r.doi,
    citationCount: r.citationCount,
    openAccess: r.openAccess ?? false,
    pdfUrl: r.pdfUrl,
    authors: r.authors,
    rerankScore: r.rerankScore,
  };

  return {
    url,
    title: r.title || url,
    domain,
    favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
    snippet,
    date: r.year ? String(r.year) : undefined,
    imageUrl: undefined,
    siteName: r.journal || domain,
    canonicalUrl: url,
    source: { name: prettyProviderName(r.source), domain },
    metadata,
  };
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.split("/")[2]?.replace(/^www\./, "") || "unknown";
  }
}

const PROVIDER_PRETTY: Record<string, string> = {
  openalex: "OpenAlex",
  semantic: "Semantic Scholar",
  crossref: "CrossRef",
  arxiv: "arXiv",
  pubmed: "PubMed",
  scielo: "SciELO",
  doaj: "DOAJ",
  core: "CORE",
  base: "BASE",
  redalyc: "Redalyc",
  scopus: "Scopus",
  wos: "Web of Science",
};

function prettyProviderName(source: string): string {
  return PROVIDER_PRETTY[source] ?? source;
}

// ─── Prompt injection ─────────────────────────────────────────────────────

/**
 * Build the text block appended to the LLM context. Uses the same
 * per-paper shape as the legacy engine so the LLM's behaviour doesn't
 * regress — but surfaces the URL as a raw line so the downstream
 * markdown renderer makes it clickable exactly like in the reference
 * screenshot (dialnet.unirioja.es/descarga/articulo/10264242.pdf).
 */
export function buildPromptInjection(
  results: NormalisedResult[],
  providers: Array<{ source: string; ok: boolean; count: number }>
): string {
  const sourceList = providers.filter((p) => p.ok && p.count > 0).map((p) => prettyProviderName(p.source));
  const header = sourceList.length > 0
    ? `\n\n**Artículos académicos encontrados (${sourceList.length} fuentes: ${sourceList.join(", ")}):**\n`
    : "\n\n**Artículos académicos encontrados:**\n";

  // Strict anti-hallucination preamble. Academic users need to trust
  // that every citation resolves to a real paper. A plausible-but-
  // fabricated DOI or URL breaks their whole workflow.
  const preamble = [
    "⚠️ REGLAS CRÍTICAS PARA CITAR (no negociables):",
    "- USA SOLAMENTE los artículos listados a continuación. NO inventes títulos, autores, revistas, años, DOIs ni URLs bajo ninguna circunstancia.",
    "- Cuando cites un artículo, copia literalmente la línea URL (o DOI) tal como aparece en la lista. No modifiques subdominios, IDs ni extensiones.",
    "- Si un artículo no tiene URL/DOI disponible en la lista, NO inventes uno — menciona el título y autores pero omite el enlace.",
    "- Referencias numeradas [1], [2]... deben corresponder al índice del artículo en la lista. Nunca crees un [N] para un artículo que no esté listado.",
    "- Si necesitas información que no está en las fuentes, dilo explícitamente (\"no hay evidencia en las fuentes recuperadas\") en lugar de rellenar con suposiciones.",
    "",
  ].join("\n");

  const body = results
    .map((p, i) => {
      const authors = p.authors.length > 0 ? p.authors.join(", ") : "No disponible";
      const year = p.year ? String(p.year) : "No disponible";
      const journal = p.journal ?? "No disponible";
      const doi = p.doi ?? "No disponible";
      const urlLine = p.pdfUrl ?? p.url ?? (p.doi ? `https://doi.org/${p.doi}` : "No disponible");
      const abstract = (p.abstract ?? "No disponible").slice(0, 300);
      const apa = buildApa(p);
      return [
        `[${i + 1}] Autores: ${authors}`,
        `Año: ${year}`,
        `Título: ${p.title}`,
        `Journal: ${journal}`,
        `DOI: ${doi}`,
        `URL: ${urlLine}`,
        `Resumen: ${abstract}${abstract.length >= 300 ? "..." : ""}`,
        `Cita APA 7: ${apa}`,
      ].join("\n");
    })
    .join("\n\n");

  return header + preamble + body;
}

function buildApa(r: NormalisedResult): string {
  const authors = formatApaAuthors(r.authors);
  const year = r.year ? `(${r.year}).` : "(n.d.).";
  const title = r.title ? `${r.title}.` : "";
  const journal = r.journal ? `*${r.journal}*.` : "";
  const link = r.doi ? `https://doi.org/${r.doi}` : r.url ?? "";
  return [authors ? `${authors}.` : "", year, title, journal, link].filter(Boolean).join(" ");
}

function formatApaAuthors(authors: string[] | undefined): string {
  if (!authors || authors.length === 0) return "";
  const clean = (s: string) => s.trim();
  if (authors.length === 1) return clean(authors[0]!);
  if (authors.length === 2) return `${clean(authors[0]!)}, & ${clean(authors[1]!)}`;
  if (authors.length <= 20) {
    const first = authors.slice(0, -1).map(clean).join(", ");
    return `${first}, & ${clean(authors[authors.length - 1]!)}`;
  }
  const first19 = authors.slice(0, 19).map(clean).join(", ");
  return `${first19}, … ${clean(authors[authors.length - 1]!)}`;
}

export const CHAT_ADAPTER_INTERNAL = {
  toWebSource,
  buildPromptInjection,
  buildApa,
  formatApaAuthors,
  safeDomain,
  prettyProviderName,
  PROVIDER_PRETTY,
};
