import { sanitizeHttpUrl, sanitizePlainText } from "../lib/textSanitizers";

export interface UnpaywallLookupResult {
  isOA: boolean;
  pdfUrl?: string;
  landingUrl?: string;
  license?: string;
  hostType?: string;
  version?: string;
  oaStatus?: string;
}

export interface UnpaywallEnrichableResult {
  doi?: string;
  url: string;
  pdfUrl?: string;
  openAccess?: boolean;
}

export interface UnpaywallEnrichmentOptions {
  email?: string;
  maxLookups?: number;
  timeoutMs?: number;
  concurrency?: number;
}

const DEFAULT_EMAIL = process.env.UNPAYWALL_EMAIL || "contact@iliagpt.com";

function sanitizeDoi(raw: string | undefined): string {
  return String(raw || "")
    .trim()
    .replace(/^https?:\/\/doi\.org\//i, "")
    .replace(/^doi:/i, "")
    .trim();
}

export async function lookupUnpaywallByDoi(
  doi: string,
  options: Pick<UnpaywallEnrichmentOptions, "email" | "timeoutMs"> = {},
): Promise<UnpaywallLookupResult | null> {
  const normalizedDoi = sanitizeDoi(doi);
  if (!normalizedDoi) return null;

  const email = sanitizePlainText(options.email || DEFAULT_EMAIL, { maxLen: 200 }).trim() || DEFAULT_EMAIL;
  const timeoutMs = Math.max(1000, Math.min(15000, options.timeoutMs || 6000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `https://api.unpaywall.org/v2/${encodeURIComponent(normalizedDoi)}?email=${encodeURIComponent(email)}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "IliaGPT Academic Search/1.0",
        },
        signal: controller.signal,
      },
    );

    if (!response.ok) return null;

    const data = await response.json();
    const best = data?.best_oa_location || data?.first_oa_location || null;
    const pdfUrl = sanitizeHttpUrl(best?.url_for_pdf || best?.url || "");
    const landingUrl = sanitizeHttpUrl(best?.url_for_landing_page || best?.url || data?.doi_url || "");

    return {
      isOA: Boolean(data?.is_oa || pdfUrl || landingUrl),
      pdfUrl: pdfUrl || undefined,
      landingUrl: landingUrl || undefined,
      license: sanitizePlainText(String(best?.license || ""), { maxLen: 80 }).trim() || undefined,
      hostType: sanitizePlainText(String(best?.host_type || ""), { maxLen: 40 }).trim() || undefined,
      version: sanitizePlainText(String(best?.version || ""), { maxLen: 40 }).trim() || undefined,
      oaStatus: sanitizePlainText(String(data?.oa_status || ""), { maxLen: 40 }).trim() || undefined,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function enrichResultsWithUnpaywall<T extends UnpaywallEnrichableResult>(
  results: T[],
  options: UnpaywallEnrichmentOptions = {},
): Promise<T[]> {
  if (!Array.isArray(results) || results.length === 0) return results;

  const maxLookups = Math.max(0, Math.min(results.length, options.maxLookups || 12));
  const concurrency = Math.max(1, Math.min(6, options.concurrency || 4));
  const output = [...results];

  const pendingIndexes = output
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => result.doi && (!result.openAccess || !result.pdfUrl))
    .slice(0, maxLookups);

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < pendingIndexes.length) {
      const current = pendingIndexes[cursor++];
      const lookup = await lookupUnpaywallByDoi(current.result.doi, options);
      if (!lookup) continue;

      output[current.index] = {
        ...output[current.index],
        openAccess: output[current.index].openAccess || lookup.isOA,
        pdfUrl: output[current.index].pdfUrl || lookup.pdfUrl,
        url: output[current.index].url || lookup.landingUrl || lookup.pdfUrl || output[current.index].url,
      };
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, pendingIndexes.length || 1) }, () => worker()));
  return output;
}
