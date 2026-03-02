import https from "https";

export const webSearchToolSchema = {
  type: "function" as const,
  function: {
    name: "web_search",
    description: "Search the web for information. Returns a list of search results with titles, URLs, and snippets. Use when you need current information, facts, documentation, or to research a topic.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query"
        },
        num_results: {
          type: "number",
          description: "Number of results to return (default 5, max 10)"
        }
      },
      required: ["query"]
    }
  }
};

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function executeWebSearchTool(params: {
  query: string;
  num_results?: number;
}): Promise<{ results: SearchResult[]; error?: string }> {
  const { query, num_results = 5 } = params;
  const maxResults = Math.min(Math.max(num_results, 1), 10);

  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

    const html = await new Promise<string>((resolve, reject) => {
      const req = https.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; IliaGPT/1.0)",
          "Accept": "text/html",
        },
        timeout: 10000,
      }, (res) => {
        let body = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk: string) => { body += chunk; });
        res.on("end", () => resolve(body));
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("Search timed out")); });
    });

    const results: SearchResult[] = [];
    const resultRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match;

    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
      const rawUrl = match[1];
      const title = match[2].replace(/<[^>]+>/g, "").trim();
      const snippet = match[3].replace(/<[^>]+>/g, "").trim();

      let finalUrl = rawUrl;
      try {
        const decoded = decodeURIComponent(rawUrl);
        const uddgMatch = decoded.match(/uddg=([^&]+)/);
        if (uddgMatch) {
          finalUrl = decodeURIComponent(uddgMatch[1]);
        }
      } catch {}

      if (title && finalUrl) {
        results.push({ title, url: finalUrl, snippet });
      }
    }

    if (results.length === 0) {
      const simpleRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
      while ((match = simpleRegex.exec(html)) !== null && results.length < maxResults) {
        const rawUrl = match[1];
        const title = match[2].replace(/<[^>]+>/g, "").trim();
        let finalUrl = rawUrl;
        try {
          const decoded = decodeURIComponent(rawUrl);
          const uddgMatch = decoded.match(/uddg=([^&]+)/);
          if (uddgMatch) finalUrl = decodeURIComponent(uddgMatch[1]);
        } catch {}
        if (title && finalUrl) {
          results.push({ title, url: finalUrl, snippet: "" });
        }
      }
    }

    return { results };
  } catch (err: any) {
    return { results: [], error: err.message || "Search failed" };
  }
}
