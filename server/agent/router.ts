import OpenAI from "openai";

const openai = new OpenAI({ 
  baseURL: "https://api.x.ai/v1", 
  apiKey: process.env.XAI_API_KEY || "missing" 
});

export type RouteDecision = "llm" | "agent" | "hybrid";

export interface RouteResult {
  decision: RouteDecision;
  confidence: number;
  urls: string[];
  objective?: string;
  reasoning: string;
}

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
const DOMAIN_REGEX = /(?:^|\s)((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})/gi;

const WEB_ACTION_KEYWORDS = [
  "busca", "buscar", "search", "find", "encuentra",
  "navega", "navigate", "go to", "ir a", "abre", "open",
  "extrae", "extract", "scrape", "obtén", "get",
  "lee", "read", "muéstrame", "show me",
  "descarga", "download", "investiga", "research",
  "compara", "compare", "analiza", "analyze",
  "visita", "visit", "revisa", "check", "consulta",
  "clima", "weather", "noticias", "news", "precio", "price",
  "cotización", "stock", "mercado", "market"
];

const CONTENT_CREATION_KEYWORDS = [
  "escribe", "write", "crea", "create", "genera", "generate",
  "redacta", "compose", "haz", "make", "diseña", "design"
];

// Simple web search queries that should use chat flow (NOT agent mode)
// These are handled by chatService.ts with webSearchAuto
const SIMPLE_SEARCH_PATTERNS = [
  /dame\s+\d*\s*noticias/i,
  /busca(me)?\s+(noticias|información|info|artículos?)/i,
  /noticias\s+(de|sobre|del)/i,
  /últimas\s+noticias/i,
  /qué\s+(está\s+pasando|pasa|hay\s+de\s+nuevo)/i,
  /what('s|\s+is)\s+(happening|new|going\s+on)/i,
  /news\s+(about|from|on)/i,
  /search\s+for\s+news/i,
  /find\s+news/i,
  /precio\s+(de|del|actual)/i,
  /clima\s+(en|de)/i,
  /weather\s+(in|for)/i,
  // More patterns for article/research requests
  /quisiera\s+(que\s+)?(me\s+)?ayud(es|a)\s+a\s+buscar/i,
  /ayúdame\s+a\s+buscar/i,
  /buscar\s+\d*\s*artículos?/i,
  /dame\s+\d*\s*artículos?/i,
  /encuentra(me)?\s+\d*\s*(artículos?|información)/i,
  /investiga\s+(sobre|acerca)/i,
  /información\s+(sobre|de|del|acerca)/i,
];

function isSimpleSearchQuery(text: string): boolean {
  return SIMPLE_SEARCH_PATTERNS.some(pattern => pattern.test(text));
}

export function extractUrls(text: string): string[] {
  // Remove content inside [ARCHIVO ADJUNTO] blocks to avoid extracting URLs from attached files
  let textWithoutAttachments = text;
  // Use [\s\S] instead of . with s flag for multiline matching
  const attachmentPattern = /\[ARCHIVO ADJUNTO:[\s\S]*?\[FIN DEL ARCHIVO\]/g;
  textWithoutAttachments = textWithoutAttachments.replace(attachmentPattern, '');
  
  const urls: string[] = [];
  const urlMatches = textWithoutAttachments.match(URL_REGEX);
  if (urlMatches) {
    urls.push(...urlMatches);
  }
  return Array.from(new Set(urls));
}

// Extract only the user's request from a message that may contain file content
function extractUserRequest(text: string): string {
  // If message has the [SOLICITUD DEL USUARIO] marker, extract only that part
  const userRequestMatch = text.match(/\[SOLICITUD DEL USUARIO\]:\s*([\s\S]+)$/);
  if (userRequestMatch) {
    return userRequestMatch[1].trim();
  }
  // Otherwise return the full text (no attachments)
  return text;
}

export function hasWebActionIntent(text: string): boolean {
  const lowerText = text.toLowerCase();
  return WEB_ACTION_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

export function hasContentCreationIntent(text: string): boolean {
  const lowerText = text.toLowerCase();
  return CONTENT_CREATION_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

export async function routeMessage(message: string): Promise<RouteResult> {
  // Extract only the user's actual request (not file content) for routing decisions
  const userRequest = extractUserRequest(message);
  const urls = extractUrls(message);
  const hasUrls = urls.length > 0;
  // Check intents only on the user's request, not on file content
  const hasWebIntent = hasWebActionIntent(userRequest);
  const hasContentIntent = hasContentCreationIntent(userRequest);
  
  // Check if message has file attachments - if so, likely a file processing request
  const hasAttachments = message.includes("[ARCHIVO ADJUNTO:");
  
  // If there are file attachments and no explicit URLs in user's request, route to LLM
  if (hasAttachments && !hasUrls) {
    return {
      decision: "llm",
      confidence: 0.95,
      urls: [],
      reasoning: "File attachments detected - processing with LLM"
    };
  }

  // AGGRESSIVE FIX: Simple search queries (news, weather, prices) should use 
  // chat flow with webSearchAuto, NOT the complex agent pipeline
  if (isSimpleSearchQuery(userRequest)) {
    return {
      decision: "llm",
      confidence: 0.95,
      urls: [],
      reasoning: "Simple search query - using chat flow with automatic web search"
    };
  }

  if (!hasUrls && !hasWebIntent) {
    return {
      decision: "llm",
      confidence: 0.9,
      urls: [],
      reasoning: "No URLs or web action intent detected"
    };
  }

  if (hasUrls && !hasContentIntent) {
    return {
      decision: "agent",
      confidence: 0.85,
      urls,
      objective: `Navigate and extract information from: ${urls.join(", ")}`,
      reasoning: "URLs detected with extraction intent"
    };
  }

  if (hasWebIntent && !hasUrls) {
    try {
      const response = await openai.chat.completions.create({
        model: "grok-3-fast",
        messages: [
          {
            role: "system",
            content: `You are a routing classifier. Analyze the user's message and determine if it requires web browsing/navigation to complete.
            
Respond with JSON only:
{
  "requires_web": boolean,
  "confidence": number (0-1),
  "search_query": string or null (if web search needed),
  "reasoning": string
}`
          },
          { role: "user", content: message }
        ],
        temperature: 0.1
      });

      const content = response.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, ""));

      if (parsed.requires_web && parsed.confidence > 0.7) {
        return {
          decision: "agent",
          confidence: parsed.confidence,
          urls: [],
          objective: parsed.search_query || message,
          reasoning: parsed.reasoning
        };
      }
    } catch (e) {
      console.error("Router LLM error:", e);
    }
  }

  if (hasUrls && hasContentIntent) {
    return {
      decision: "hybrid",
      confidence: 0.8,
      urls,
      objective: `Extract from ${urls.join(", ")} and create content`,
      reasoning: "URLs detected with content creation intent - needs extraction then generation"
    };
  }

  return {
    decision: "llm",
    confidence: 0.7,
    urls,
    reasoning: "Defaulting to LLM response"
  };
}
