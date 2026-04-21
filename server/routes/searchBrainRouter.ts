/**
 * SearchBrain router — WebGLM-inspired academic search endpoints.
 *
 * Mounted at /api/search-brain. Phase 1a exposes:
 *   POST /academic   — run the three-phase pipeline
 *   GET  /providers  — list available providers + status
 *
 * Future phases add /web, /deep, /settings.
 *
 * Input validation is intentionally similar to academicSearchRouter so
 * shared Express middleware (sanitisation, rate limits already applied
 * upstream of /api) works without changes.
 */

import { Router, type Request, type Response } from "express";
import { sanitizeSearchQuery } from "../lib/textSanitizers";
import {
  searchAcademic,
  searchDeep,
  runWebSearch,
  PROVIDER_CATALOG,
  DEFAULT_ACADEMIC_SOURCES,
  DEFAULT_WEB_SOURCES,
} from "../services/searchBrain";
import type { SearchBrainSource, SearchBrainOptions, WebSource } from "../services/searchBrain";
import { getSettingsAsync, updateSettingsAsync } from "../services/searchBrain/settingsService";

export const searchBrainRouter = Router();

const MAX_QUERY_LENGTH = 500;
const MAX_RESULTS_CAP = 50;

const VALID_SOURCES = new Set<SearchBrainSource>([
  "scielo",
  "redalyc",
  "openalex",
  "semantic",
  "crossref",
  "core",
  "doaj",
  "pubmed",
  "arxiv",
  "base",
  "scopus",
  "wos",
]);

const VALID_WEB_SOURCES = new Set<WebSource>(["searxng", "duckduckgo", "wikipedia"]);

function validateQuery(raw: unknown): { valid: true; query: string } | { valid: false; error: string } {
  if (typeof raw !== "string") {
    return { valid: false, error: "query is required and must be a string" };
  }
  const q = sanitizeSearchQuery(raw, MAX_QUERY_LENGTH);
  if (!q) return { valid: false, error: "query cannot be empty" };
  if (q.length < 2) return { valid: false, error: "query must be at least 2 characters" };
  return { valid: true, query: q };
}

function validateSources(raw: unknown): SearchBrainSource[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: SearchBrainSource[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const k = item.trim().toLowerCase() as SearchBrainSource;
    if (VALID_SOURCES.has(k)) out.push(k);
  }
  return out.length > 0 ? out : undefined;
}

function validateWebSources(raw: unknown): WebSource[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: WebSource[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const k = item.trim().toLowerCase() as WebSource;
    if (VALID_WEB_SOURCES.has(k)) out.push(k);
  }
  return out.length > 0 ? out : undefined;
}

function validateMaxResults(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return Math.min(Math.max(Math.floor(raw), 1), MAX_RESULTS_CAP);
}

function validateLanguage(raw: unknown): "es" | "en" | "auto" | undefined {
  if (raw === "es" || raw === "en" || raw === "auto") return raw;
  return undefined;
}

function extractUserId(req: Request): string | undefined {
  // The project attaches authenticated user to req via session/JWT
  // middleware earlier in the stack. We treat it as opaque here; it's
  // only used for LLM rate-limit attribution.
  const u = (req as unknown as { user?: { id?: string } }).user;
  return typeof u?.id === "string" ? u.id : undefined;
}

function extractMailto(req: Request): string | undefined {
  const body = (req.body ?? {}) as { mailto?: unknown };
  if (typeof body.mailto === "string" && /@/.test(body.mailto)) {
    return body.mailto.slice(0, 120);
  }
  // Fall back to environment-level config set by the operator.
  const env = process.env.SEARCH_BRAIN_MAILTO;
  return typeof env === "string" && env.length > 0 ? env : undefined;
}

/**
 * GET /api/search-brain/providers
 *
 * Lists every provider SearchBrain knows about plus a rate-limit note
 * pulled from provider docs. The frontend uses this to render the
 * multi-chip source selector.
 */
searchBrainRouter.get("/providers", (_req, res) => {
  res.json({
    defaults: [...DEFAULT_ACADEMIC_SOURCES],
    providers: PROVIDER_CATALOG,
    webDefaults: [...DEFAULT_WEB_SOURCES],
    webProviders: [
      { id: "wikipedia", name: "Wikipedia (REST + OpenSearch)", type: "api", rateLimitNote: "Public API. No key required." },
      { id: "duckduckgo", name: "DuckDuckGo (HTML)", type: "scraping", rateLimitNote: "Single HTML request per call; keep frequency low." },
      { id: "searxng", name: "SearXNG (rotated public instances)", type: "api", rateLimitNote: "Instances rotate until one returns. Self-host recommended for heavy use." },
    ],
  });
});

// ─── POST /api/search-brain/web ───────────────────────────────────────────
searchBrainRouter.post("/web", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const queryResult = validateQuery(body.query);
    if (!queryResult.valid) {
      res.status(400).json({ error: queryResult.error });
      return;
    }
    const out = await runWebSearch({
      query: queryResult.query,
      sources: validateWebSources(body.sources),
      maxResults: validateMaxResults(body.maxResults),
      timeoutMs: typeof body.timeoutMs === "number" ? Math.min(30000, Math.max(1000, body.timeoutMs)) : undefined,
      language: validateLanguage(body.language) === "auto" ? undefined : validateLanguage(body.language),
    });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "internal error" });
  }
});

// ─── POST /api/search-brain/deep ──────────────────────────────────────────
searchBrainRouter.post("/deep", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const queryResult = validateQuery(body.query);
    if (!queryResult.valid) {
      res.status(400).json({ error: queryResult.error });
      return;
    }
    const userId = extractUserId(req);
    const settings = await getSettingsAsync(userId);
    const out = await searchDeep({
      query: queryResult.query,
      academicSources: validateSources(body.academicSources),
      webSources: validateWebSources(body.webSources),
      maxAcademic: typeof body.maxAcademic === "number" ? Math.min(20, Math.max(1, body.maxAcademic)) : undefined,
      maxWeb: typeof body.maxWeb === "number" ? Math.min(20, Math.max(1, body.maxWeb)) : undefined,
      userId,
      mailto: extractMailto(req) ?? settings.mailto,
      enableScrapingProviders: body.enableScrapingProviders === true || settings.enableScrapingProviders,
      rerank: body.rerank === false ? false : true,
      language: validateLanguage(body.language),
    });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "internal error" });
  }
});

// ─── GET + POST /api/search-brain/settings ────────────────────────────────
searchBrainRouter.get("/settings", async (req: Request, res: Response) => {
  try {
    const userId = extractUserId(req);
    const s = await getSettingsAsync(userId);
    // Never echo back the raw key — return presence boolean only.
    res.json({
      mailto: s.mailto ?? null,
      enableScrapingProviders: s.enableScrapingProviders,
      coreApiKeyPresent: Boolean(s.coreApiKey),
      updatedAt: s.updatedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "internal error" });
  }
});

searchBrainRouter.post("/settings", async (req: Request, res: Response) => {
  try {
    const userId = extractUserId(req);
    if (!userId) {
      res.status(401).json({ error: "settings require an authenticated user" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await updateSettingsAsync(userId, {
      mailto: body.mailto,
      coreApiKey: body.coreApiKey,
      enableScrapingProviders: body.enableScrapingProviders,
    });
    if (!result.ok) {
      res.status(400).json({ ok: false, errors: result.errors });
      return;
    }
    res.json({
      ok: true,
      mailto: result.settings.mailto ?? null,
      enableScrapingProviders: result.settings.enableScrapingProviders,
      coreApiKeyPresent: Boolean(result.settings.coreApiKey),
      updatedAt: result.settings.updatedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "internal error" });
  }
});

/**
 * POST /api/search-brain/academic
 *
 * Body: {
 *   query: string,
 *   sources?: SearchBrainSource[],
 *   maxResults?: number,
 *   rerank?: boolean,
 *   language?: "es"|"en"|"auto",
 *   enableScrapingProviders?: boolean,
 *   mailto?: string,
 *   weights?: Partial<SearchBrainWeights>
 * }
 */
searchBrainRouter.post("/academic", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const queryResult = validateQuery(body.query);
    if (!queryResult.valid) {
      res.status(400).json({ error: queryResult.error });
      return;
    }

    const options: SearchBrainOptions = {
      query: queryResult.query,
      sources: validateSources(body.sources),
      maxResults: validateMaxResults(body.maxResults),
      rerank: body.rerank === false ? false : true,
      language: validateLanguage(body.language),
      userId: extractUserId(req),
      mailto: extractMailto(req),
      timeoutMs: typeof body.timeoutMs === "number" ? Math.min(30000, Math.max(1000, body.timeoutMs)) : undefined,
      enableScrapingProviders: body.enableScrapingProviders === true,
      weights:
        body.weights && typeof body.weights === "object"
          ? (body.weights as SearchBrainOptions["weights"])
          : undefined,
    };

    const result = await searchAcademic(options);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    res.status(500).json({ error: message });
  }
});
