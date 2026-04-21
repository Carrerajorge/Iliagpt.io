/**
 * SearchBrain public API. Everything downstream (routes, tests,
 * frontend services) imports from this file so internal module
 * restructures stay invisible.
 */

import { llmGateway } from "../../lib/llmGateway";
import { retrieveFromProvider } from "./providerAdapter";
import { runSearchBrain } from "./orchestrator";
import { runWebSearch } from "./webOrchestrator";
import { synthesiseDeepAnswer } from "./deepSynthesis";
import type {
  SearchBrainOptions,
  SearchBrainResponse,
  SearchBrainDeps,
  SearchBrainSource,
  ProviderDescriptor,
  NormalisedResult,
} from "./types";
import type { WebOrchestratorOptions, WebOrchestratorResponse, WebSource } from "./webOrchestrator";
import type { DeepSynthesisInput, DeepSynthesisResponse } from "./deepSynthesis";

export type {
  SearchBrainOptions,
  SearchBrainResponse,
  SearchBrainDeps,
  SearchBrainSource,
  ProviderDescriptor,
  NormalisedResult,
  WebOrchestratorOptions,
  WebOrchestratorResponse,
  WebSource,
  DeepSynthesisInput,
  DeepSynthesisResponse,
};

export { DEFAULT_ACADEMIC_SOURCES, DEFAULT_WEIGHTS } from "./types";
export { DEFAULT_WEB_SOURCES } from "./webOrchestrator";
export { runWebSearch, synthesiseDeepAnswer };

// ─── Default LLM adapter ──────────────────────────────────────────────────

/**
 * Maps SearchBrain's abstract `callLLM` contract onto the project's
 * LLMGateway. Kept thin on purpose: any extra knobs (model pinning,
 * image input) stay on the Gateway so SearchBrain doesn't double up.
 */
async function defaultCallLLM(args: {
  system: string;
  user: string;
  userId?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<{ content: string }> {
  const resp = await llmGateway.chat(
    [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
    {
      userId: args.userId,
      temperature: args.temperature,
      maxTokens: args.maxTokens ?? 800,
      timeout: args.timeoutMs,
      skipCache: true,
    }
  );
  return { content: resp.content };
}

/**
 * Production entrypoint. Wires the default LLM + provider adapter and
 * delegates to the orchestrator. Tests call `runSearchBrain` directly
 * with their own deps.
 */
export async function searchAcademic(
  options: SearchBrainOptions
): Promise<SearchBrainResponse> {
  const deps: SearchBrainDeps = {
    callLLM: options.__deps?.callLLM ?? defaultCallLLM,
    retrieveFrom: options.__deps?.retrieveFrom ?? retrieveFromProvider,
    now: options.__deps?.now,
  };
  return runSearchBrain(
    { ...options, __deps: deps },
    { retrieveFrom: retrieveFromProvider }
  );
}

/** Deep search: fuses academic + web + LLM synthesis with APA 7 refs. */
export async function searchDeep(args: {
  query: string;
  academicSources?: SearchBrainSource[];
  webSources?: WebSource[];
  maxAcademic?: number;
  maxWeb?: number;
  userId?: string;
  mailto?: string;
  enableScrapingProviders?: boolean;
  rerank?: boolean;
  language?: "es" | "en" | "auto";
  __deps?: SearchBrainDeps;
}): Promise<{
  query: string;
  academic: SearchBrainResponse;
  web: WebOrchestratorResponse;
  synthesis: DeepSynthesisResponse;
}> {
  const deps: SearchBrainDeps = {
    callLLM: args.__deps?.callLLM ?? defaultCallLLM,
    retrieveFrom: args.__deps?.retrieveFrom ?? retrieveFromProvider,
    now: args.__deps?.now,
  };
  const [academic, web] = await Promise.all([
    searchAcademic({
      query: args.query,
      sources: args.academicSources,
      maxResults: args.maxAcademic ?? 10,
      userId: args.userId,
      mailto: args.mailto,
      enableScrapingProviders: args.enableScrapingProviders,
      rerank: args.rerank,
      language: args.language,
      __deps: deps,
    }),
    runWebSearch({
      query: args.query,
      sources: args.webSources,
      maxResults: args.maxWeb ?? 10,
      language: args.language === "auto" ? undefined : args.language,
    }),
  ]);
  const synthesis = await synthesiseDeepAnswer({
    query: args.query,
    academic: academic.results,
    web: web.results,
    userId: args.userId,
    deps,
  });
  return { query: args.query, academic, web, synthesis };
}

// ─── Provider catalog (surfaced by GET /providers) ────────────────────────

export const PROVIDER_CATALOG: ProviderDescriptor[] = [
  { id: "openalex", name: "OpenAlex", type: "api", license: "CC0", requiresOptIn: false,
    rateLimitNote: "Polite pool: include mailto=. No API key required." },
  { id: "semantic", name: "Semantic Scholar", type: "api", license: "open", requiresOptIn: false,
    rateLimitNote: "Free tier ~100 req / 5 min per IP. No key required." },
  { id: "crossref", name: "CrossRef", type: "api", license: "open", requiresOptIn: false,
    rateLimitNote: "Polite pool: User-Agent with mailto=. Unlimited reads." },
  { id: "arxiv", name: "arXiv", type: "api", license: "open", requiresOptIn: false,
    rateLimitNote: "3 seconds between requests recommended. Atom XML." },
  { id: "pubmed", name: "PubMed (NCBI E-utilities)", type: "api", license: "open", requiresOptIn: false,
    rateLimitNote: "3 req/sec anonymous, 10 req/sec with api_key (optional)." },
  { id: "scielo", name: "SciELO", type: "api", license: "open", requiresOptIn: false,
    rateLimitNote: "Public search. No key. LatAm open access." },
  { id: "doaj", name: "DOAJ", type: "api", license: "open", requiresOptIn: false,
    rateLimitNote: "Public. No key. 2 req/sec polite." },
  { id: "core", name: "CORE", type: "api", license: "requires-key", requiresOptIn: false,
    rateLimitNote: "Free key generated at core.ac.uk. Without key, disabled." },
  { id: "base", name: "BASE (Bielefeld)", type: "api", license: "open", requiresOptIn: false,
    rateLimitNote: "Public JSON endpoint. Soft rate limit." },
  { id: "redalyc", name: "Redalyc", type: "scraping", license: "scraping-opt-in", requiresOptIn: false,
    rateLimitNote: "HTML scraping of public search page. Single-request per call." },
  { id: "scopus", name: "Scopus (scraping)", type: "scraping", license: "scraping-opt-in", requiresOptIn: true,
    rateLimitNote: "Requires user opt-in from Settings. Uses Puppeteer under user's own IP." },
  { id: "wos", name: "Web of Science (scraping)", type: "scraping", license: "scraping-opt-in", requiresOptIn: true,
    rateLimitNote: "Requires user opt-in from Settings. Uses Puppeteer under user's own IP." },
];

export { retrieveFromProvider, runSearchBrain };
