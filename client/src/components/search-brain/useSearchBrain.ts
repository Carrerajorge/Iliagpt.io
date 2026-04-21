/**
 * useSearchBrain — React hook that wraps the /api/search-brain/*
 * endpoints with loading/error state and provider catalog fetching.
 *
 * Kept deliberately small: no TanStack Query dep, no suspense, no
 * cache. The server already caches results in pgvector; refetching
 * the same query surfaces the cache hit with `response.cache.hit=true`.
 */

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import type {
  AcademicResponse,
  AcademicSource,
  DeepResponse,
  ProviderCatalog,
  WebSource,
} from "./types";

export type SearchMode = "academic" | "web" | "deep";

export interface AcademicSearchArgs {
  query: string;
  sources?: AcademicSource[];
  maxResults?: number;
  rerank?: boolean;
  enableScrapingProviders?: boolean;
  language?: "es" | "en" | "auto";
}

export interface DeepSearchArgs {
  query: string;
  academicSources?: AcademicSource[];
  webSources?: WebSource[];
  maxAcademic?: number;
  maxWeb?: number;
  enableScrapingProviders?: boolean;
  language?: "es" | "en" | "auto";
}

interface HookState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export interface UseSearchBrainResult {
  catalog: ProviderCatalog | null;
  catalogLoading: boolean;
  catalogError: string | null;
  academic: HookState<AcademicResponse>;
  web: HookState<AcademicResponse>;       // /web uses its own payload but panel treats them uniformly
  deep: HookState<DeepResponse>;
  runAcademic: (args: AcademicSearchArgs) => Promise<AcademicResponse | null>;
  runWeb: (args: { query: string; sources?: WebSource[]; maxResults?: number }) => Promise<AcademicResponse | null>;
  runDeep: (args: DeepSearchArgs) => Promise<DeepResponse | null>;
  reset: () => void;
}

const EMPTY_STATE = <T,>(): HookState<T> => ({ data: null, loading: false, error: null });

export function useSearchBrain(): UseSearchBrainResult {
  const [catalog, setCatalog] = useState<ProviderCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [academic, setAcademic] = useState<HookState<AcademicResponse>>(EMPTY_STATE());
  const [web, setWeb] = useState<HookState<AcademicResponse>>(EMPTY_STATE());
  const [deep, setDeep] = useState<HookState<DeepResponse>>(EMPTY_STATE());

  useEffect(() => {
    let cancelled = false;
    setCatalogLoading(true);
    (async () => {
      try {
        const res = await apiFetch("/api/search-brain/providers");
        if (!res.ok) throw new Error(`providers status ${res.status}`);
        const json = (await res.json()) as ProviderCatalog;
        if (!cancelled) setCatalog(json);
      } catch (err) {
        if (!cancelled) setCatalogError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runAcademic = useCallback(async (args: AcademicSearchArgs): Promise<AcademicResponse | null> => {
    setAcademic({ data: null, loading: true, error: null });
    try {
      const res = await apiFetch("/api/search-brain/academic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!res.ok) {
        const text = await safeText(res);
        throw new Error(`academic ${res.status}: ${text}`);
      }
      const json = (await res.json()) as AcademicResponse;
      setAcademic({ data: json, loading: false, error: null });
      return json;
    } catch (err) {
      setAcademic({ data: null, loading: false, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }, []);

  const runWeb = useCallback(async (args: { query: string; sources?: WebSource[]; maxResults?: number }): Promise<AcademicResponse | null> => {
    setWeb({ data: null, loading: true, error: null });
    try {
      const res = await apiFetch("/api/search-brain/web", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!res.ok) {
        const text = await safeText(res);
        throw new Error(`web ${res.status}: ${text}`);
      }
      const json = (await res.json()) as AcademicResponse;
      setWeb({ data: json, loading: false, error: null });
      return json;
    } catch (err) {
      setWeb({ data: null, loading: false, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }, []);

  const runDeep = useCallback(async (args: DeepSearchArgs): Promise<DeepResponse | null> => {
    setDeep({ data: null, loading: true, error: null });
    try {
      const res = await apiFetch("/api/search-brain/deep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!res.ok) {
        const text = await safeText(res);
        throw new Error(`deep ${res.status}: ${text}`);
      }
      const json = (await res.json()) as DeepResponse;
      setDeep({ data: json, loading: false, error: null });
      return json;
    } catch (err) {
      setDeep({ data: null, loading: false, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setAcademic(EMPTY_STATE());
    setWeb(EMPTY_STATE());
    setDeep(EMPTY_STATE());
  }, []);

  return { catalog, catalogLoading, catalogError, academic, web, deep, runAcademic, runWeb, runDeep, reset };
}

async function safeText(res: Response): Promise<string> {
  try {
    const body = await res.text();
    return body.slice(0, 400);
  } catch {
    return "(no body)";
  }
}
