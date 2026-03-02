import https from "https";
import http from "http";
import { URL } from "url";

export const webFetchToolSchema = {
  type: "function" as const,
  function: {
    name: "web_fetch",
    description: "Fetch content from a URL. Returns the page text content (HTML stripped to readable text). Use for reading web pages, APIs, documentation, etc. Automatically detects JSON API responses and returns formatted JSON.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch"
        },
        extract_mode: {
          type: "string",
          enum: ["text", "html", "raw", "json"],
          description: "How to extract content: 'text' strips HTML to readable text (default), 'html' returns raw HTML, 'raw' returns the raw response body, 'json' parses and formats JSON responses"
        }
      },
      required: ["url"]
    }
  }
};

const MAX_BODY_SIZE = 200000;
const FETCH_TIMEOUT = 15000;
const MAX_REDIRECTS = 5;

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, code) => String.fromCharCode(parseInt(code, 16)));
}

function extractStructuredText(html: string): string {
  let text = html;

  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "");
  text = text.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, "");
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");

  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");
  text = text.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n");
  text = text.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n");

  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n• $1");
  text = text.replace(/<ul[^>]*>/gi, "\n");
  text = text.replace(/<\/ul>/gi, "\n");
  text = text.replace(/<ol[^>]*>/gi, "\n");
  text = text.replace(/<\/ol>/gi, "\n");

  text = text.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_m, row: string) => {
    const cells: string[] = [];
    const cellRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let match;
    while ((match = cellRegex.exec(row)) !== null) {
      cells.push(match[1].replace(/<[^>]+>/g, "").trim());
    }
    return cells.length > 0 ? "\n| " + cells.join(" | ") + " |" : "";
  });
  text = text.replace(/<\/?table[^>]*>/gi, "\n");
  text = text.replace(/<\/?thead[^>]*>/gi, "");
  text = text.replace(/<\/?tbody[^>]*>/gi, "");

  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");

  text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, "\n> $1\n");

  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)");

  text = text.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
  text = text.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
  text = text.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
  text = text.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");

  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<hr[^>]*\/?>/gi, "\n---\n");

  text = text.replace(/<[^>]+>/g, " ");

  text = decodeHtmlEntities(text);

  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n[ \t]+/g, "\n");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();

  if (text.length > MAX_BODY_SIZE) {
    text = text.slice(0, MAX_BODY_SIZE) + "\n\n[Content truncated at " + MAX_BODY_SIZE + " characters]";
  }

  return text;
}

function isJsonContentType(contentType: string): boolean {
  return /application\/json|application\/[\w.+-]*\+json|text\/json/i.test(contentType);
}

function formatJsonResponse(body: string): string {
  try {
    const parsed = JSON.parse(body);
    const formatted = JSON.stringify(parsed, null, 2);
    if (formatted.length > MAX_BODY_SIZE) {
      return formatted.slice(0, MAX_BODY_SIZE) + "\n\n[JSON truncated at " + MAX_BODY_SIZE + " characters]";
    }
    return formatted;
  } catch {
    return body.slice(0, MAX_BODY_SIZE);
  }
}

function fetchWithRedirects(
  url: string,
  extract_mode: "text" | "html" | "raw" | "json",
  redirectCount: number
): Promise<{ content: string; status: number; contentType?: string; redirectChain?: string[]; error?: string }> {
  const redirectChain: string[] = [];

  function doFetch(
    currentUrl: string,
    hops: number
  ): Promise<{ content: string; status: number; contentType?: string; redirectChain?: string[]; error?: string }> {
    if (hops > MAX_REDIRECTS) {
      return Promise.resolve({
        content: "",
        status: 0,
        redirectChain,
        error: `Too many redirects (exceeded ${MAX_REDIRECTS} hops). Redirect chain: ${redirectChain.join(" -> ")}`
      });
    }

    return new Promise((resolve) => {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(currentUrl);
      } catch {
        resolve({ content: "", status: 0, error: `Invalid URL during redirect: ${currentUrl}` });
        return;
      }

      if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
        resolve({ content: "", status: 0, error: `Unsupported protocol: ${parsedUrl.protocol}` });
        return;
      }

      const client = parsedUrl.protocol === "https:" ? https : http;

      const req = client.get(currentUrl, {
        timeout: FETCH_TIMEOUT,
        headers: {
          "User-Agent": "IliaGPT-Agent/1.0 (compatible; bot)",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5,es;q=0.3",
        }
      }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          redirectChain.push(currentUrl);
          const redirectUrl = new URL(res.headers.location, currentUrl).toString();
          res.resume();
          doFetch(redirectUrl, hops + 1).then(resolve);
          return;
        }

        let body = "";
        let bodySize = 0;
        const hardLimit = MAX_BODY_SIZE * 3;
        res.setEncoding("utf-8");

        res.on("data", (chunk: string) => {
          bodySize += chunk.length;
          if (bodySize <= hardLimit) {
            body += chunk;
          } else if (body.length < hardLimit) {
            body = body.slice(0, hardLimit);
          }
        });

        res.on("end", () => {
          const contentType = res.headers["content-type"] || "";
          const statusCode = res.statusCode || 200;

          if (statusCode >= 400) {
            const statusMessages: Record<number, string> = {
              400: "Bad Request",
              401: "Unauthorized",
              403: "Forbidden",
              404: "Not Found",
              405: "Method Not Allowed",
              408: "Request Timeout",
              429: "Too Many Requests",
              500: "Internal Server Error",
              502: "Bad Gateway",
              503: "Service Unavailable",
              504: "Gateway Timeout",
            };
            const statusMsg = statusMessages[statusCode] || "Error";
            const errorDetail = body ? extractStructuredText(body).slice(0, 500) : "";
            resolve({
              content: errorDetail || `HTTP ${statusCode}: ${statusMsg}`,
              status: statusCode,
              contentType,
              redirectChain: redirectChain.length > 0 ? redirectChain : undefined,
              error: `HTTP ${statusCode}: ${statusMsg}`
            });
            return;
          }

          const autoJson = isJsonContentType(contentType);
          let content: string;

          if (extract_mode === "json" || (extract_mode === "text" && autoJson)) {
            content = formatJsonResponse(body);
          } else if (extract_mode === "text") {
            content = extractStructuredText(body);
          } else if (extract_mode === "html") {
            content = body.length > MAX_BODY_SIZE
              ? body.slice(0, MAX_BODY_SIZE) + "\n\n<!-- Content truncated -->"
              : body;
          } else {
            content = body.length > MAX_BODY_SIZE
              ? body.slice(0, MAX_BODY_SIZE) + "\n\n[Content truncated]"
              : body;
          }

          resolve({
            content,
            status: statusCode,
            contentType,
            redirectChain: redirectChain.length > 0 ? redirectChain : undefined
          });
        });

        res.on("error", (err) => {
          resolve({ content: "", status: 0, error: `Response error: ${err.message}` });
        });
      });

      req.on("error", (err) => {
        const errorMsg = err.message || String(err);
        let friendlyMsg = errorMsg;

        if (errorMsg.includes("ENOTFOUND")) {
          friendlyMsg = `DNS lookup failed: could not resolve hostname for ${currentUrl}`;
        } else if (errorMsg.includes("ECONNREFUSED")) {
          friendlyMsg = `Connection refused by ${parsedUrl.hostname}`;
        } else if (errorMsg.includes("ECONNRESET")) {
          friendlyMsg = `Connection reset by ${parsedUrl.hostname}`;
        } else if (errorMsg.includes("CERT_")) {
          friendlyMsg = `SSL/TLS certificate error for ${parsedUrl.hostname}: ${errorMsg}`;
        }

        resolve({ content: "", status: 0, error: friendlyMsg });
      });

      req.on("timeout", () => {
        req.destroy();
        resolve({ content: "", status: 0, error: `Request timed out after ${FETCH_TIMEOUT / 1000}s for ${currentUrl}` });
      });
    });
  }

  return doFetch(url, redirectCount);
}

export async function executeWebFetchTool(params: {
  url: string;
  extract_mode?: "text" | "html" | "raw" | "json";
}): Promise<{ content: string; status: number; contentType?: string; redirectChain?: string[]; error?: string }> {
  const { url, extract_mode = "text" } = params;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { content: "", status: 0, error: `Unsupported protocol: ${parsed.protocol}. Only http and https are supported.` };
    }
  } catch {
    return { content: "", status: 0, error: `Invalid URL: ${url}` };
  }

  return fetchWithRedirects(url, extract_mode, 0);
}
