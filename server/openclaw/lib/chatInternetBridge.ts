import { webSearch, webFetch } from "./internetAccess";
import type { WebSearchResult, WebFetchResult } from "./internetAccess";

interface InternetContext {
  searchResults?: WebSearchResult;
  fetchResults?: WebFetchResult[];
  error?: string;
}

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

const SEARCH_TRIGGERS_ES = [
  "busca", "buscar", "búsqueda", "investiga", "investigar",
  "qué es", "quién es", "cuándo", "dónde", "cómo",
  "noticias", "últimas noticias", "actualidad",
  "precio", "cotización", "clima", "tiempo",
  "hoy", "ahora", "actual", "reciente", "último",
  "2025", "2026", "2027",
  "internet", "en línea", "en la web", "online",
];

const SEARCH_TRIGGERS_EN = [
  "search", "look up", "find", "google",
  "what is", "who is", "when", "where", "how",
  "news", "latest", "current", "recent",
  "price", "stock", "weather",
  "today", "now", "2025", "2026", "2027",
  "internet", "online", "web", "browse",
];

const NO_SEARCH_PATTERNS = [
  /^(hola|hi|hello|hey|buenos?\s+d[ií]as?|buenas?\s+(tardes?|noches?))/i,
  /^(gracias|thanks|thank you)/i,
  /^(sí|si|no|ok|vale|bien)/i,
  /escribe|redacta|genera|crea|programa|código|code/i,
  /traduce|translate/i,
  /explica|explain/i,
  /resume|summarize/i,
];

function needsInternetAccess(message: string): { needsSearch: boolean; needsFetch: boolean; urls: string[]; searchQuery?: string } {
  const lower = message.toLowerCase().trim();

  if (NO_SEARCH_PATTERNS.some((p) => p.test(lower))) {
    const urls = message.match(URL_REGEX) || [];
    if (urls.length > 0) {
      return { needsSearch: false, needsFetch: true, urls };
    }
    return { needsSearch: false, needsFetch: false, urls: [] };
  }

  const urls = message.match(URL_REGEX) || [];
  const needsFetch = urls.length > 0;

  const allTriggers = [...SEARCH_TRIGGERS_ES, ...SEARCH_TRIGGERS_EN];
  const needsSearch = allTriggers.some((t) => lower.includes(t));

  let searchQuery: string | undefined;
  if (needsSearch) {
    searchQuery = message
      .replace(URL_REGEX, "")
      .replace(/[?¿!¡.,;:]/g, "")
      .trim();
    if (searchQuery.length < 3) searchQuery = message;
  }

  return { needsSearch, needsFetch, urls, searchQuery };
}

export async function gatherInternetContext(userMessage: string): Promise<InternetContext | null> {
  const analysis = needsInternetAccess(userMessage);

  if (!analysis.needsSearch && !analysis.needsFetch) {
    return null;
  }

  const context: InternetContext = {};

  try {
    const tasks: Promise<void>[] = [];

    if (analysis.needsSearch && analysis.searchQuery) {
      tasks.push(
        webSearch(analysis.searchQuery)
          .then((r) => {
            context.searchResults = r;
          })
          .catch((e) => {
            console.warn("[ChatInternetBridge] Search failed:", e?.message);
          })
      );
    }

    if (analysis.needsFetch && analysis.urls.length > 0) {
      const fetchUrls = analysis.urls.slice(0, 3);
      tasks.push(
        Promise.allSettled(fetchUrls.map((url) => webFetch(url)))
          .then((results) => {
            context.fetchResults = results
              .filter((r): r is PromiseFulfilledResult<WebFetchResult> => r.status === "fulfilled")
              .map((r) => r.value);
          })
      );
    }

    await Promise.all(tasks);
  } catch (err: any) {
    context.error = err?.message;
  }

  if (!context.searchResults && !context.fetchResults?.length) {
    return null;
  }

  return context;
}

export function buildInternetSystemPrompt(context: InternetContext | null): string {
  const basePrompt = `You are IliaGPT, a helpful AI assistant running inside the OpenClaw control interface. You have FULL access to the internet in real-time. You can search the web and read web pages.

When users ask about current events, recent information, or anything that requires up-to-date data, you use your internet access to provide accurate, real-time information.

You respond in the same language as the user. You can use markdown formatting.`;

  if (!context) {
    return basePrompt + `\n\nYou have internet access available but no web data was needed for this query. If the user asks you to search or look something up, you will automatically access the internet.`;
  }

  let contextBlock = `\n\n--- REAL-TIME INTERNET DATA (fetched just now) ---\n`;

  if (context.searchResults && context.searchResults.results.length > 0) {
    contextBlock += `\n🔍 Web Search Results for "${context.searchResults.query}" (${context.searchResults.results.length} results, ${context.searchResults.elapsedMs}ms):\n`;
    context.searchResults.results.forEach((r, i) => {
      contextBlock += `\n${i + 1}. **${r.title}**\n   URL: ${r.url}\n   ${r.snippet}\n`;
    });
  }

  if (context.fetchResults && context.fetchResults.length > 0) {
    context.fetchResults.forEach((page) => {
      const textPreview = page.text.slice(0, 8000);
      contextBlock += `\n📄 Page: ${page.title || page.url} (${page.status}, ${page.elapsedMs}ms)\nURL: ${page.url}\nContent:\n${textPreview}\n`;
    });
  }

  contextBlock += `\n--- END INTERNET DATA ---\n`;
  contextBlock += `\nUse the above real-time data to answer the user's question accurately. Cite sources when relevant. If you need more information, tell the user you can search for more.`;

  return basePrompt + contextBlock;
}
