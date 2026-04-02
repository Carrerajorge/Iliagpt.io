import { Logger } from '../../../lib/logger';

export interface SearxngConfig {
  host: string;
  timeout: number;
  maxResults: number;
  engines: string[];
  safesearch: 0 | 1 | 2;
  format: 'json' | 'html';
}

export interface SearxngResult {
  url: string;
  title: string;
  content: string;
  engine: string;
  score?: number;
  publishedDate?: string;
  thumbnail?: string;
  category?: string;
}

function getSearxngConfig(): SearxngConfig {
  return {
    host: process.env.SEARXNG_HOST || process.env.SEARXNG_URL || 'http://localhost:8080',
    timeout: Number(process.env.SEARXNG_TIMEOUT) || 10_000,
    maxResults: Number(process.env.SEARXNG_MAX_RESULTS) || 10,
    engines: (process.env.SEARXNG_ENGINES || 'google,bing,duckduckgo,brave').split(',').map(s => s.trim()),
    safesearch: (Number(process.env.SEARXNG_SAFESEARCH) || 0) as 0 | 1 | 2,
    format: 'json',
  };
}

export async function searxngSearch(query: string, options?: Partial<SearxngConfig>): Promise<SearxngResult[]> {
  const config = { ...getSearxngConfig(), ...options };

  const params = new URLSearchParams({
    q: query,
    format: config.format,
    safesearch: String(config.safesearch),
    engines: config.engines.join(','),
  });

  const url = `${config.host}/search?${params.toString()}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`SearXNG returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as { results?: SearxngResult[] };
    const results = (data.results || []).slice(0, config.maxResults);

    return results.map(r => ({
      url: r.url || '',
      title: r.title || '',
      content: r.content || '',
      engine: r.engine || 'unknown',
      score: r.score,
      publishedDate: r.publishedDate,
      thumbnail: r.thumbnail,
      category: r.category,
    }));
  } catch (error: any) {
    if (error.name === 'AbortError') {
      Logger.warn('[SearXNG] Search timed out', { query: query.slice(0, 50), timeout: config.timeout });
      return [];
    }
    Logger.warn('[SearXNG] Search failed, falling back to empty results', {
      error: error.message,
      query: query.slice(0, 50),
    });
    return [];
  }
}

export function isSearxngAvailable(): boolean {
  return !!(process.env.SEARXNG_HOST || process.env.SEARXNG_URL);
}

export function registerSearxngProvider(): void {
  const available = isSearxngAvailable();
  Logger.info(`[OpenClaw:SearXNG] Provider registered (available=${available}, host=${getSearxngConfig().host})`);
}
