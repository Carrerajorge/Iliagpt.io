import https from "https";
import http from "http";
import { URL } from "url";

export const webFetchToolSchema = {
  type: "function" as const,
  function: {
    name: "web_fetch",
    description: "Fetch content from a URL. Returns the page text content (HTML stripped to readable text). Use for reading web pages, APIs, documentation, etc.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch"
        },
        extract_mode: {
          type: "string",
          enum: ["text", "html", "raw"],
          description: "How to extract content: 'text' strips HTML to readable text (default), 'html' returns raw HTML, 'raw' returns the raw response body"
        }
      },
      required: ["url"]
    }
  }
};

const MAX_BODY_SIZE = 200000;
const FETCH_TIMEOUT = 15000;

function stripHtmlToText(html: string): string {
  let text = html;
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");
  text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/\s+/g, " ");
  text = text.trim();
  return text.slice(0, MAX_BODY_SIZE);
}

export async function executeWebFetchTool(params: {
  url: string;
  extract_mode?: "text" | "html" | "raw";
}): Promise<{ content: string; status: number; contentType?: string; error?: string }> {
  const { url, extract_mode = "text" } = params;

  try {
    new URL(url);
  } catch {
    return { content: "", status: 0, error: `Invalid URL: ${url}` };
  }

  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "https:" ? https : http;

    const req = client.get(url, {
      timeout: FETCH_TIMEOUT,
      headers: {
        "User-Agent": "IliaGPT-Agent/1.0 (compatible; bot)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5,es;q=0.3",
      }
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, url).toString();
        executeWebFetchTool({ url: redirectUrl, extract_mode }).then(resolve);
        return;
      }

      let body = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk: string) => {
        if (body.length < MAX_BODY_SIZE * 2) {
          body += chunk;
        }
      });
      res.on("end", () => {
        const contentType = res.headers["content-type"] || "";
        let content = body;

        if (extract_mode === "text") {
          content = stripHtmlToText(body);
        } else if (extract_mode === "html") {
          content = body.slice(0, MAX_BODY_SIZE);
        } else {
          content = body.slice(0, MAX_BODY_SIZE);
        }

        resolve({
          content,
          status: res.statusCode || 200,
          contentType
        });
      });
    });

    req.on("error", (err) => {
      resolve({ content: "", status: 0, error: err.message });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ content: "", status: 0, error: "Request timed out" });
    });
  });
}
