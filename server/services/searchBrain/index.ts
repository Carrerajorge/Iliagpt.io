/**
 * SearchBrain public API. Everything downstream (routes, tests,
 * frontend services) imports from this file so internal module
 * restructures stay invisible.
 */

import { llmGateway } from "../../lib/llmGateway";
import { retrieveFromProvider } from "./providerAdapter";
import { runSearchBrain } from "./orchestrator";
import type {
  SearchBrainOptions,
  SearchBrainResponse,
  SearchBrainDeps,
  SearchBrainSource,
  ProviderDescriptor,
  NormalisedResult,
} from "./types";

export type {
  SearchBrainOptions,
  SearchBrainResponse,
  SearchBrainDeps,
  SearchBrainSource,
  ProviderDescriptor,
  NormalisedResult,
};

export { DEFAULT_ACADEMIC_SOURCES, DEFAULT_WEIGHTS } from "./types";

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
