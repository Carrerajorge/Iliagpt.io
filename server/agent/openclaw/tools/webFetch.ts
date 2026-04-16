import { z } from "zod";
import axios, { type AxiosRequestConfig } from "axios";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const MAX_CONTENT_LENGTH = 512 * 1024;
const MAX_OUTPUT_CHARS = 60_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const BLOCKED_PROTOCOLS = ["file:", "ftp:", "data:", "javascript:", "blob:"];
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^\[::1\]$/,
  /^0\.0\.0\.0$/,
  /^metadata\.google\.internal$/i,
  /^169\.254\.\d+\.\d+$/,
];

export const WebFetchInputSchema = z.object({
  url: z.string().url().describe("URL to fetch"),
  mode: z
    .enum(["markdown", "text"])
    .default("markdown")
    .describe("Content extraction mode"),
  maxLength: z
    .number()
    .int()
    .min(100)
    .max(MAX_OUTPUT_CHARS)
    .default(MAX_OUTPUT_CHARS)
    .describe("Maximum output characters"),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(30000)
    .default(FETCH_TIMEOUT_MS)
    .describe("Request timeout in ms"),
  headers: z
    .record(z.string())
    .optional()
    .describe("Extra request headers"),
});

export type WebFetchInput = z.infer<typeof WebFetchInputSchema>;

export interface WebFetchResult {
  success: boolean;
  url: string;
  finalUrl: string;
  title: string;
  content: string;
  mode: "markdown" | "text";
  contentLength: number;
  truncated: boolean;
  cached: boolean;
  fetchTimeMs: number;
  error?: string;
}

interface CacheEntry {
  result: WebFetchResult;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(url: string, mode: string): string {
  return `${mode}::${url}`;
}

function getCached(url: string, mode: string): WebFetchResult | null {
  const key = cacheKey(url, mode);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return { ...entry.result, cached: true };
}

function setCache(url: string, mode: string, result: WebFetchResult): void {
  const key = cacheKey(url, mode);
  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  if (cache.size > 200) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

function assertSafeUrl(raw: string): URL {
  const parsed = new URL(raw);
  if (BLOCKED_PROTOCOLS.includes(parsed.protocol)) {
    throw new Error(`Blocked protocol: ${parsed.protocol}`);
  }
  const host = parsed.hostname;
  for (const pat of BLOCKED_HOST_PATTERNS) {
    if (pat.test(host)) {
      throw new Error(`Blocked host: ${host} (internal/private network)`);
    }
  }
  return parsed;
}

function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const cutPoint = text.lastIndexOf("\n", max);
  const pos = cutPoint > max * 0.8 ? cutPoint : max;
  return {
    text: text.slice(0, pos) + "\n\n[Content truncated — original length: " + text.length + " chars]",
    truncated: true,
  };
}

function wrapExternalContent(content: string, url: string): string {
  return `<external_content source="${url}">\n${content}\n</external_content>`;
}

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
turndown.remove(["script", "style", "nav", "footer", "header", "aside", "iframe", "noscript"]);

function htmlToMarkdown(html: string): string {
  return turndown.turndown(html);
}

function extractReadableContent(
  html: string,
  url: string,
  mode: "markdown" | "text"
): { title: string; content: string } {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  const reader = new Readability(doc);
  const article = reader.parse();

  if (article) {
    const title = article.title || doc.title || "";
    if (mode === "text") {
      return { title, content: article.textContent?.trim() || "" };
    }
    const md = htmlToMarkdown(article.content || "");
    return { title, content: `# ${title}\n\n${md}` };
  }

  const title = doc.title || "";
  const body = doc.body;
  if (!body) return { title, content: "" };

  if (mode === "text") {
    return { title, content: body.textContent?.trim() || "" };
  }
  const md = htmlToMarkdown(body.innerHTML);
  return { title, content: `# ${title}\n\n${md}` };
}

export async function webFetch(input: WebFetchInput): Promise<WebFetchResult> {
  const start = Date.now();
  const { url, mode, maxLength, timeoutMs, headers: extraHeaders } = input;

  const cached = getCached(url, mode);
  if (cached) {
    return { ...cached, fetchTimeMs: Date.now() - start };
  }

  assertSafeUrl(url);

  const config: AxiosRequestConfig = {
    url,
    method: "GET",
    timeout: timeoutMs,
    maxRedirects: MAX_REDIRECTS,
    maxContentLength: MAX_CONTENT_LENGTH,
    responseType: "text",
    headers: {
      "User-Agent": "IliaGPT-WebFetch/1.0 (compatible; bot)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
      "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
      ...extraHeaders,
    },
    validateStatus: (s: number) => s < 400,
  };

  const resp = await axios(config);
  const finalUrl: string = resp.request?.res?.responseUrl || url;
  const contentType: string = resp.headers["content-type"] || "";
  const rawBody: string = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);

  let title = "";
  let content = "";

  if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
    const extracted = extractReadableContent(rawBody, finalUrl, mode);
    title = extracted.title;
    content = extracted.content;
  } else if (contentType.includes("application/json")) {
    title = "JSON Response";
    content = mode === "markdown"
      ? "```json\n" + rawBody + "\n```"
      : rawBody;
  } else if (contentType.includes("text/")) {
    title = "Plain Text";
    content = rawBody;
  } else {
    title = "Binary Content";
    content = `[Binary content of type ${contentType}, ${rawBody.length} bytes — not displayed]`;
  }

  const { text: finalContent, truncated } = truncate(content, maxLength);
  const wrapped = wrapExternalContent(finalContent, finalUrl);

  const result: WebFetchResult = {
    success: true,
    url,
    finalUrl,
    title,
    content: wrapped,
    mode,
    contentLength: content.length,
    truncated,
    cached: false,
    fetchTimeMs: Date.now() - start,
  };

  setCache(url, mode, result);
  return result;
}

export function clearWebFetchCache(): void {
  cache.clear();
}
