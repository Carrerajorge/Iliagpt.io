import { webSearch, webFetch, webSearchAndFetch } from "./internetAccess";
import type { WebSearchResult, WebFetchResult } from "./internetAccess";
import { skillRegistry } from "../skills/skillRegistry";
import { createLogger } from "../../utils/logger";

const log = createLogger("openclaw-chat-internet-bridge");

export interface InternetContext {
  searchResults?: WebSearchResult;
  fetchResults?: WebFetchResult[];
  error?: string;
  triggeredBy: string;
}

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

const ALWAYS_SEARCH_PATTERNS = [
  /\b(busca|buscar|búsqueda|investiga|investigar|averigua|averiguar)\b/i,
  /\b(search|look\s*up|find\s+me|google|browse|lookup)\b/i,
  /\b(link|enlace|url|página|pagina|sitio\s*web|website|dirección|direccion)\b/i,
  /\b(noticias|news|últimas|últimos|actualidad|breaking)\b/i,
  /\b(precio|price|cotización|cotizacion|costo|cost|vale|cuánto\s+cuesta|cuanto\s+cuesta)\b/i,
  /\b(clima|weather|temperatura|pronóstico|pronostico)\b/i,
  /\b(reciente|recent|último|ultima|latest|nuevo|nueva|new)\b/i,
  /\b(hoy|today|ahora|now|este\s+año|this\s+year|esta\s+semana|this\s+week)\b/i,
  /\b(2024|2025|2026|2027)\b/,
  /\b(acceso\s+a\s+internet|internet\s+access|tienes\s+internet|tienes\s+acceso)\b/i,
  /\b(dónde|donde|dónde\s+puedo|where|where\s+can)\b/i,
  /\b(quién|quien|who\s+is|who\s+are)\b/i,
  /\b(cuándo|cuando|when\s+is|when\s+did|when\s+will)\b/i,
  /\b(qué\s+es|que\s+es|what\s+is|what\s+are|what's)\b/i,
  /\b(cómo|como\s+se|how\s+to|how\s+do|how\s+does)\b/i,
  /\b(resultado|score|marcador|partido|match|game)\b/i,
  /\b(presidente|president|gobierno|government|elección|election)\b/i,
  /\b(empresa|company|compañía|stock|acción|acciones)\b/i,
  /\b(descargar|download|app|aplicación|aplicacion|software)\b/i,
  /\b(tutorial|guía|guia|guide|manual|documentación|documentation|docs)\b/i,
  /\b(receta|recipe|ingredientes|ingredients)\b/i,
  /\b(película|pelicula|movie|serie|series|show|tv|estreno)\b/i,
  /\b(canción|cancion|song|álbum|album|artista|artist|música|musica|music)\b/i,
  /\b(evento|event|festival|concierto|concert|conferencia|conference)\b/i,
  /\b(vuelo|flight|hotel|viaje|travel|reserva|booking|aerolínea|airline)\b/i,
  /\b(restaurante|restaurant|tienda|store|shop|negocio|business)\b/i,
  /\b(horario|schedule|hora|hours|abierto|open|cerrado|closed)\b/i,
  /\b(mapa|map|ubicación|ubicacion|location|dirección|address)\b/i,
  /\b(review|reseña|opinión|opinion|rating|calificación|calificacion)\b/i,
  /\b(comparar|compare|versus|vs|mejor|best|top|ranking)\b/i,
  /\b(wikipedia|wiki)\b/i,
  /\b(twitter|x\.com|instagram|facebook|tiktok|youtube|reddit|linkedin)\b/i,
  /\b(amazon|netflix|spotify|uber|airbnb|google|apple|microsoft|meta)\b/i,
  /\bdame\b.*\b(link|enlace|url|info|información|datos)\b/i,
  /\bpasa\s*me\b/i,
  /\bmuéstrame|muestrame|show\s+me\b/i,
  /\benséñame|ensename|teach\s+me\b/i,
  /\b(cuál|cual|which)\b.*\b(mejor|best|página|pagina|sitio|site)\b/i,
];

const SKIP_SEARCH_PATTERNS = [
  /^(hola|hi|hello|hey|saludos)[\s!.?]*$/i,
  /^(gracias|thanks|thank\s+you|thx)[\s!.?]*$/i,
  /^(sí|si|no|ok|vale|bien|claro|por\s+supuesto|of\s+course)[\s!.?]*$/i,
  /^(adiós|adios|bye|chao|nos\s+vemos)[\s!.?]*$/i,
];

function shouldSearch(message: string): { shouldSearch: boolean; shouldFetch: boolean; urls: string[]; searchQuery: string; reason: string } {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  if (SKIP_SEARCH_PATTERNS.some((p) => p.test(trimmed))) {
    const urls = trimmed.match(URL_REGEX) || [];
    return { shouldSearch: false, shouldFetch: urls.length > 0, urls, searchQuery: "", reason: "greeting/ack" };
  }

  const urls = trimmed.match(URL_REGEX) || [];
  const hasUrls = urls.length > 0;

  for (const pattern of ALWAYS_SEARCH_PATTERNS) {
    if (pattern.test(lower)) {
      const searchQuery = trimmed
        .replace(URL_REGEX, "")
        .replace(/[?¿!¡]/g, "")
        .trim() || trimmed;
      return {
        shouldSearch: true,
        shouldFetch: hasUrls,
        urls,
        searchQuery,
        reason: `matched: ${pattern.source.slice(0, 40)}`,
      };
    }
  }

  if (lower.includes("?") || lower.includes("¿")) {
    const questionWords = /\b(qué|que|quién|quien|cómo|como|cuál|cual|cuándo|cuando|dónde|donde|por\s*qué|porqué|what|who|how|which|when|where|why)\b/i;
    if (questionWords.test(lower)) {
      return {
        shouldSearch: true,
        shouldFetch: hasUrls,
        urls,
        searchQuery: trimmed.replace(/[?¿!¡]/g, "").trim(),
        reason: "question detected",
      };
    }
  }

  if (hasUrls) {
    return { shouldSearch: false, shouldFetch: true, urls, searchQuery: "", reason: "url-only" };
  }

  return { shouldSearch: false, shouldFetch: false, urls: [], searchQuery: "", reason: "no-trigger" };
}

export async function gatherInternetContext(userMessage: string): Promise<InternetContext | null> {
  const analysis = shouldSearch(userMessage);

  if (!analysis.shouldSearch && !analysis.shouldFetch) {
    return null;
  }

  log.info(`Analysis: search=${analysis.shouldSearch}, fetch=${analysis.shouldFetch}, reason=${analysis.reason}, query="${analysis.searchQuery}"`);

  const context: InternetContext = { triggeredBy: analysis.reason };

  try {
    const tasks: Promise<void>[] = [];

    if (analysis.shouldSearch && analysis.searchQuery) {
      tasks.push(
        (async () => {
          try {
            const { search, pages } = await webSearchAndFetch(analysis.searchQuery, 2);
            context.searchResults = search;
            if (pages.length > 0) {
              context.fetchResults = (context.fetchResults || []).concat(pages);
            }
          } catch (e: any) {
            log.warn(`Search+fetch failed: ${e?.message}`);
            try {
              context.searchResults = await webSearch(analysis.searchQuery);
            } catch (e2: any) {
              log.warn(`Fallback search also failed: ${e2?.message}`);
            }
          }
        })()
      );
    }

    if (analysis.shouldFetch && analysis.urls.length > 0) {
      const fetchUrls = analysis.urls.slice(0, 3);
      tasks.push(
        Promise.allSettled(fetchUrls.map((url) => webFetch(url)))
          .then((results) => {
            const pages = results
              .filter((r): r is PromiseFulfilledResult<WebFetchResult> => r.status === "fulfilled")
              .map((r) => r.value);
            context.fetchResults = (context.fetchResults || []).concat(pages);
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
  let skillsBlock = "";
  try {
    const allSkills = skillRegistry.list();
    if (allSkills.length > 0) {
      const readySkills = allSkills.filter(s => s.status === 'ready' || !s.status);
      const setupSkills = allSkills.filter(s => s.status === 'needs_setup');
      const sanitize = (s: string) => s.replace(/[\n\r]/g, ' ').slice(0, 120);
      const readyLines = readySkills.slice(0, 30).map(s => `- ${sanitize(s.name)}: ${sanitize(s.description || '')}`);
      const maxChars = 3000;
      let joined = readyLines.join('\n');
      if (joined.length > maxChars) joined = joined.slice(0, maxChars) + '...';
      skillsBlock = `\n\nACTIVE SKILLS (${readySkills.length} ready):
${joined}
You CAN use any of these ready skills. For needs-setup skills (${setupSkills.length} total), tell the user which API key or configuration is required before you can use them.`;
    }
  } catch (e: any) {
    log.warn(`Skills injection skipped: ${e?.message}`);
  }

  const basePrompt = `You are IliaGPT, a powerful AI assistant with FULL real-time internet access. You are running inside the OpenClaw control interface.

CRITICAL INTERNET CAPABILITIES:
- You CAN search the web in real-time
- You CAN read and fetch any web page
- You CAN provide current, up-to-date information
- You CAN find real links, URLs, and websites
- You ALWAYS have access to the latest information from the internet

IMPORTANT RULES ABOUT LINKS AND URLS:
- ONLY share URLs that appear in your internet data below
- NEVER invent, guess, or hallucinate URLs — if you don't have a verified URL, say "I found information about X but let me search for the exact link" instead of making one up
- When sharing links, copy them EXACTLY as they appear in your search results
- If a user asks for a link and you don't have it in your data, tell them you'll search for it
${skillsBlock}
You respond in the same language as the user. Use markdown formatting when helpful.`;

  if (!context) {
    return basePrompt + `\n\nNo web search was performed for this query. You still have internet access — it activates automatically when the user asks about current events, links, prices, news, or any real-time information. If the user asks you something that needs internet data, tell them to ask and you'll search for it.`;
  }

  let contextBlock = `\n\n══════════════════════════════════════════\n📡 LIVE INTERNET DATA (fetched right now, ${new Date().toISOString()})\n══════════════════════════════════════════\n`;

  if (context.searchResults && context.searchResults.results.length > 0) {
    contextBlock += `\n🔍 SEARCH: "${context.searchResults.query}" via ${context.searchResults.engine} (${context.searchResults.results.length} results, ${context.searchResults.elapsedMs}ms)\n`;
    context.searchResults.results.forEach((r, i) => {
      const verifiedTag = r.verified ? " ✅" : "";
      contextBlock += `\n  ${i + 1}. ${r.title}${verifiedTag}\n     🔗 ${r.url}\n     ${r.snippet || "(no snippet)"}\n`;
    });
  }

  if (context.fetchResults && context.fetchResults.length > 0) {
    context.fetchResults.forEach((page) => {
      const textPreview = page.text.slice(0, 6000);
      contextBlock += `\n📄 PAGE CONTENT: ${page.title || "Untitled"}\n   🔗 ${page.url} (HTTP ${page.status}, ${page.elapsedMs}ms)\n   Content:\n${textPreview}\n`;
    });
  }

  contextBlock += `\n══════════════════════════════════════════\n`;
  contextBlock += `\nINSTRUCTIONS: Use ONLY the URLs and data above. Do NOT invent any URL. If the data doesn't contain what the user needs, say you can search for more specific terms. Always cite the source URL when providing information from the internet.`;

  return basePrompt + contextBlock;
}
