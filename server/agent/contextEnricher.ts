/**
 * Context Enricher -- enriches conversation context before sending to the LLM,
 * adding time awareness, summaries, user profiling, topic extraction, and capabilities.
 */
export interface EnrichedContext {
  timeContext: string;
  conversationSummary: string;
  userProfile: string;
  recentTopics: string[];
  suggestedCapabilities: string;
  attachmentContext: string;
}

interface Message { role: string; content: string }
interface Attachment { name: string; type: string; size?: number }

// -- Time context -----------------------------------------------------------
export function formatTimeContext(locale: string, timezone?: string): string {
  const now = new Date();
  try {
    const formatted = new Intl.DateTimeFormat(locale, {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      hour: "numeric", minute: "2-digit", hour12: locale.startsWith("en"),
      timeZone: timezone || "America/New_York",
    }).format(now);
    return locale.startsWith("es") ? `Son las ${formatted}` : `It's ${formatted}`;
  } catch {
    return locale.startsWith("es") ? `Fecha actual: ${now.toISOString()}` : `Current date: ${now.toISOString()}`;
  }
}

// -- Topic extraction -------------------------------------------------------
const TOPIC_PATS = [
  /\bsobre\s+(.+?)(?:[.,?!]|$)/gi, /\bacerca\s+de\s+(.+?)(?:[.,?!]|$)/gi,
  /\babout\s+(.+?)(?:[.,?!]|$)/gi, /\bregarding\s+(.+?)(?:[.,?!]|$)/gi,
];
const TECH_RE = /\b(API|REST|GraphQL|SQL|NoSQL|React|Vue|Angular|Python|JavaScript|TypeScript|Node\.?js|Docker|Kubernetes|AWS|Azure|GCP|PostgreSQL|MongoDB|Redis|Machine\s?Learning|AI|NLP|LLM|GPT|deep\s?learning|blockchain|CI\/CD|DevOps|microservices?|serverless)\b/gi;
const STOP = new Set([
  "el","la","los","las","un","una","de","del","en","con","por","para","que","es",
  "the","a","an","is","are","was","in","on","for","to","of","and","or","it",
  "this","that","can","you","i","me","my","we","do","how","what","be","have","has",
]);

export function extractTopics(messages: Message[]): string[] {
  const userMsgs = messages.slice(-5).filter((m) => m.role === "user");
  const topics = new Set<string>();
  for (const { content } of userMsgs) {
    for (const pat of TOPIC_PATS) {
      pat.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pat.exec(content))) {
        const t = m[1].trim().slice(0, 80);
        if (t.length > 2) topics.add(t.toLowerCase());
      }
    }
    TECH_RE.lastIndex = 0;
    let tm: RegExpExecArray | null;
    while ((tm = TECH_RE.exec(content))) topics.add(tm[1]);
    for (const w of content.split(/\s+/)) {
      const c = w.replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑ]/g, "");
      if (c.length > 5 && !STOP.has(c.toLowerCase()) && c[0] === c[0].toUpperCase() && c[0] !== c[0].toLowerCase())
        topics.add(c);
    }
  }
  return [...topics].slice(0, 10);
}

// -- Conversation summary ---------------------------------------------------
export function summarizeConversation(messages: Message[], locale: string): string {
  const es = locale.startsWith("es");
  if (!messages.length) return es ? "Conversacion nueva." : "New conversation.";
  const recent = messages.slice(-10);
  const uCount = recent.filter((m) => m.role === "user").length;
  const aCount = recent.filter((m) => m.role === "assistant").length;
  const topicStr = extractTopics(recent).slice(0, 3).join(", ");
  const usedTools = recent.some(
    (m) => m.role === "assistant" && /tool_use|function_call|<tool>|ejecut|generat|creat|execut/.test(m.content),
  );
  if (es) {
    let s = `Conversacion de ${recent.length} mensajes`;
    if (topicStr) s += ` sobre ${topicStr}`;
    s += `.`;
    if (uCount) s += ` El usuario envio ${uCount} mensaje${uCount > 1 ? "s" : ""} y recibio ${aCount} respuesta${aCount > 1 ? "s" : ""}.`;
    if (usedTools) s += " Se utilizaron herramientas.";
    return s;
  }
  let s = `Conversation of ${recent.length} messages`;
  if (topicStr) s += ` about ${topicStr}`;
  s += `.`;
  if (uCount) s += ` The user sent ${uCount} message${uCount > 1 ? "s" : ""} and received ${aCount} response${aCount > 1 ? "s" : ""}.`;
  if (usedTools) s += " Tools were used.";
  return s;
}

// -- Capability suggestions -------------------------------------------------
const CAPS: Record<string, { es: string; en: string }> = {
  data:     { es: "Puedo crear graficos, exportar a Excel, o analizar tendencias", en: "I can create charts, export to Excel, or analyze trends" },
  document: { es: "Puedo agregar secciones, traducir, o convertir a otro formato", en: "I can add sections, translate, or convert to another format" },
  code:     { es: "Puedo ejecutar codigo, depurar errores, o refactorizar", en: "I can run code, debug errors, or refactor" },
  research: { es: "Puedo buscar mas informacion, comparar fuentes, o resumir hallazgos", en: "I can search for more info, compare sources, or summarize findings" },
  image:    { es: "Puedo generar imagenes, editar, o crear variaciones", en: "I can generate images, edit them, or create variations" },
};
const GENERIC_CAPS = {
  es: "Puedo crear documentos, hojas de calculo, presentaciones, buscar en internet, ejecutar codigo, y mas",
  en: "I can create documents, spreadsheets, presentations, search the web, run code, and more",
};

function detectDomain(messages: Message[]): string | null {
  const t = messages.slice(-5).map((m) => m.content).join(" ").toLowerCase();
  if (/datos|excel|csv|tabla|chart|graph|analiz|statistic|data|spreadsheet/.test(t)) return "data";
  if (/documento|word|informe|report|redact|escrib|write|draft|document/.test(t)) return "document";
  if (/codigo|code|programar|function|script|debug|refactor|python|javascript/.test(t)) return "code";
  if (/buscar|search|investigar|research|find|explor/.test(t)) return "research";
  if (/imagen|image|dibujar|draw|ilustracion|illustration|foto|photo/.test(t)) return "image";
  return null;
}

// -- Attachment context -----------------------------------------------------
function fmtSize(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)}KB`;
  return `${(b / (1024 * 1024)).toFixed(1)}MB`;
}

function buildAttachmentCtx(attachments: Attachment[] | undefined, locale: string): string {
  if (!attachments?.length) return locale.startsWith("es") ? "Sin archivos adjuntos." : "No attachments.";
  const items = attachments.map((a) => `${a.name}${a.size ? ` (${fmtSize(a.size)})` : ""}`);
  return `${locale.startsWith("es") ? "El usuario adjunto" : "The user attached"}: ${items.join(", ")}`;
}

// -- Main enrichment --------------------------------------------------------
export function enrichContext(opts: {
  messages: Array<{ role: string; content: string }>;
  userFacts?: string[];
  attachments?: Array<{ name: string; type: string; size?: number }>;
  locale?: string;
  timezone?: string;
}): EnrichedContext {
  const locale = opts.locale || "es";
  const lang: "es" | "en" = locale.startsWith("es") ? "es" : "en";
  const messages = opts.messages || [];

  let userProfile: string;
  if (opts.userFacts?.length) {
    userProfile = `${lang === "es" ? "Usuario" : "User"}: ${opts.userFacts.join(", ")}`;
  } else {
    userProfile = lang === "es" ? "Sin informacion del usuario." : "No user info available.";
  }

  const domain = detectDomain(messages);
  return {
    timeContext: formatTimeContext(locale, opts.timezone),
    conversationSummary: summarizeConversation(messages, locale),
    userProfile,
    recentTopics: extractTopics(messages),
    suggestedCapabilities: domain ? CAPS[domain][lang] : GENERIC_CAPS[lang],
    attachmentContext: buildAttachmentCtx(opts.attachments, locale),
  };
}
