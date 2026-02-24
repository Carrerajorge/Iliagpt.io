import { v4 as uuidv4 } from 'uuid';
import type { EvidenceSource } from '../agent/production/types';

// Lightweight academic search fallback used when the LLM-based research agent
// fails to return sources (common when keys/embeddings expire).
//
// We intentionally use no-key public APIs:
// - Semantic Scholar Graph API
// - Crossref Works API

type AcademicSource = {
  title: string;
  url?: string;
  year?: number;
  venue?: string;
  authors?: string[];
  doi?: string;
  abstract?: string;
  source: 'semantic_scholar' | 'crossref';
};

const FETCH_TIMEOUT_MS = 15000;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function sanitizeAcademicQuery(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  let q = raw;
  q = q.replace(/<[^>]*>/g, "");
  q = q.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  q = q.normalize("NFC");
  q = q.replace(/\s+/g, " ").trim();
  if (q.length > 500) q = q.substring(0, 500).trim();
  return q;
}

function pickExcerpt(text: string, maxLen = 360) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen - 1).trimEnd() + '…';
}

function normalizeDoi(raw?: string | null) {
  const s = (raw || '').trim();
  if (!s) return undefined;
  const m = s.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
  return m ? m[0] : undefined;
}

async function fetchJson(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'accept': 'application/json',
        ...(init?.headers || {}),
      },
    });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} from ${url}: ${body.slice(0, 200)}`);
    }
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function semanticScholarSearch(query: string, limit: number): Promise<AcademicSource[]> {
  const sanitized = sanitizeAcademicQuery(query);
  if (!sanitized) return [];
  const q = encodeURIComponent(sanitized);
  const l = clamp(limit, 1, 100);
  const fields = encodeURIComponent('title,url,year,venue,authors,externalIds,abstract');
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${q}&limit=${l}&fields=${fields}`;

  const json: any = await fetchJson(url);
  const data: any[] = Array.isArray(json?.data) ? json.data : [];
  return data.map((p) => {
    const doi = normalizeDoi(p?.externalIds?.DOI || p?.externalIds?.doi);
    const authors = Array.isArray(p?.authors) ? p.authors.map((a: any) => a?.name).filter(Boolean) : undefined;
    return {
      title: (p?.title || '').toString(),
      url: (p?.url || '').toString() || (doi ? `https://doi.org/${doi}` : undefined),
      year: typeof p?.year === 'number' ? p.year : undefined,
      venue: (p?.venue || '').toString() || undefined,
      authors,
      doi,
      abstract: (p?.abstract || '').toString() || undefined,
      source: 'semantic_scholar',
    };
  }).filter(x => x.title);
}

async function crossrefSearch(query: string, limit: number): Promise<AcademicSource[]> {
  const sanitized = sanitizeAcademicQuery(query);
  if (!sanitized) return [];
  const q = encodeURIComponent(sanitized);
  const rows = clamp(limit, 1, 100);
  const url = `https://api.crossref.org/works?query.title=${q}&rows=${rows}&select=DOI,title,URL,author,issued,container-title,abstract`;

  const json: any = await fetchJson(url);
  const items: any[] = Array.isArray(json?.message?.items) ? json.message.items : [];

  return items.map((it) => {
    const doi = normalizeDoi(it?.DOI);
    const title = Array.isArray(it?.title) ? it.title[0] : it?.title;
    const authors = Array.isArray(it?.author)
      ? it.author.map((a: any) => [a?.given, a?.family].filter(Boolean).join(' ')).filter(Boolean)
      : undefined;

    const year = (() => {
      const parts = it?.issued?.['date-parts']?.[0];
      return Array.isArray(parts) && typeof parts[0] === 'number' ? parts[0] : undefined;
    })();

    const venue = Array.isArray(it?.['container-title']) ? it['container-title'][0] : it?.['container-title'];

    return {
      title: (title || '').toString(),
      url: (it?.URL || '').toString() || (doi ? `https://doi.org/${doi}` : undefined),
      year,
      venue: (venue || '').toString() || undefined,
      authors,
      doi,
      abstract: (it?.abstract || '').toString() || undefined,
      source: 'crossref',
    };
  }).filter(x => x.title);
}

function toEvidenceSources(sources: AcademicSource[]): EvidenceSource[] {
  const now = new Date();
  return sources.map((s, idx) => {
    const metaBits: string[] = [];
    if (s.authors?.length) metaBits.push(`Autores: ${s.authors.slice(0, 8).join(', ')}${s.authors.length > 8 ? '…' : ''}`);
    if (s.year) metaBits.push(`Año: ${s.year}`);
    if (s.venue) metaBits.push(`Venue: ${s.venue}`);
    if (s.doi) metaBits.push(`DOI: ${s.doi}`);
    metaBits.push(`Fuente: ${s.source}`);

    const content = [
      `Título: ${s.title}`,
      s.url ? `URL: ${s.url}` : undefined,
      ...metaBits,
      s.abstract ? `\nResumen:\n${s.abstract}` : undefined,
    ].filter(Boolean).join('\n');

    return {
      id: `academic_${idx}_${uuidv4()}`,
      type: 'web',
      title: s.title,
      url: s.url,
      content,
      excerpt: pickExcerpt(s.abstract || content),
      reliability: s.source === 'semantic_scholar' ? 0.85 : 0.8,
      retrievedAt: now,
    } satisfies EvidenceSource;
  });
}

export async function academicSearchFallback(opts: { query: string; maxSources: number }): Promise<EvidenceSource[]> {
  const maxSources = clamp(opts.maxSources, 1, 50);
  const query = opts.query.trim();
  if (!query) return [];

  // Parallelize and then de-dup by DOI/URL/title.
  const [ss, cr] = await Promise.allSettled([
    // Ask each provider for up to maxSources (API caps at 100).
    // We dedupe across providers afterwards.
    semanticScholarSearch(query, Math.min(100, maxSources)),
    crossrefSearch(query, Math.min(100, maxSources)),
  ]);

  const raw: AcademicSource[] = [];
  if (ss.status === 'fulfilled') raw.push(...ss.value);
  if (cr.status === 'fulfilled') raw.push(...cr.value);

  const seen = new Set<string>();
  const deduped: AcademicSource[] = [];
  for (const s of raw) {
    const key = (s.doi || s.url || s.title).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(s);
    if (deduped.length >= maxSources) break;
  }

  return toEvidenceSources(deduped);
}
