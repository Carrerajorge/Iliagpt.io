export type AttachmentType = "pdf" | "xlsx" | "xls" | "docx" | "doc" | "pptx" | "ppt" | "csv" | "image" | "text" | "json" | "unknown";
export type Language = "es" | "en" | "mixed";

export interface ContextSignals {
  hasAttachments: boolean;
  attachmentCount: number;
  attachmentTypes: AttachmentType[];
  hasUrls: boolean;
  urlCount: number;
  urlDomains: string[];
  hasTable: boolean;
  language: Language;
  hasUrgency: boolean;
  urgencyLevel: "low" | "medium" | "high";
  hasConstraints: boolean;
  constraints: string[];
  wordCount: number;
  hasQuestionMark: boolean;
}

const SPANISH_KEYWORDS = [
  "el", "la", "de", "que", "y", "en", "un", "es", "por", "con", "para",
  "del", "los", "las", "una", "este", "esta", "como", "pero", "más",
  "hola", "gracias", "dame", "quiero", "necesito", "ayuda", "busca",
  "analiza", "resume", "genera", "crea", "hazme"
];

const ENGLISH_KEYWORDS = [
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "hello", "thanks", "give", "want", "need", "help", "search", "find",
  "analyze", "summarize", "generate", "create", "make"
];

const URGENCY_KEYWORDS = [
  "urgente", "urgent", "asap", "rápido", "rapido", "inmediatamente",
  "immediately", "ya", "ahora", "now", "pronto", "soon", "quickly",
  "cuanto antes", "lo antes posible", "right away", "priority",
  "prioritario", "crítico", "critico", "critical"
];

const HIGH_URGENCY_KEYWORDS = [
  "urgente", "urgent", "asap", "inmediatamente", "immediately",
  "crítico", "critico", "critical", "emergency", "emergencia"
];

const CONSTRAINT_PATTERNS = [
  /máximo?\s+\d+/gi,
  /maximo?\s+\d+/gi,
  /límite\s+de?\s+\d+/gi,
  /limite\s+de?\s+\d+/gi,
  /solo\s+\d+/gi,
  /no\s+más\s+de\s+\d+/gi,
  /no\s+mas\s+de\s+\d+/gi,
  /at\s+most\s+\d+/gi,
  /maximum\s+\d+/gi,
  /max\s+\d+/gi,
  /limit\s+\d+/gi,
  /only\s+\d+/gi,
  /up\s+to\s+\d+/gi,
  /menos\s+de\s+\d+/gi,
  /less\s+than\s+\d+/gi
];

const URL_PATTERN = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
const TABLE_PATTERN = /\|[\s\S]*?\|[\s\S]*?\|/;
const MARKDOWN_TABLE_HEADER = /\|[-:\s]+\|/;

const FILE_EXTENSION_MAP: Record<string, AttachmentType> = {
  ".pdf": "pdf",
  ".xlsx": "xlsx",
  ".xls": "xls",
  ".docx": "docx",
  ".doc": "doc",
  ".pptx": "pptx",
  ".ppt": "ppt",
  ".csv": "csv",
  ".txt": "text",
  ".md": "text",
  ".json": "json",
  ".jpg": "image",
  ".jpeg": "image",
  ".png": "image",
  ".gif": "image",
  ".webp": "image",
  ".svg": "image",
  ".bmp": "image"
};

export function detectContext(
  text: string,
  attachments: Array<{ name?: string; type?: string; path?: string }> = []
): ContextSignals {
  const lowerText = text.toLowerCase();
  const normalizedText = lowerText.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const attachmentTypes = detectAttachmentTypes(attachments);
  const urls = text.match(URL_PATTERN) || [];
  const urlDomains = extractDomains(urls);
  const language = detectLanguage(lowerText);
  const urgencyResult = detectUrgency(normalizedText);
  const constraints = detectConstraints(text);
  const hasTable = TABLE_PATTERN.test(text) || MARKDOWN_TABLE_HEADER.test(text);
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

  return {
    hasAttachments: attachments.length > 0,
    attachmentCount: attachments.length,
    attachmentTypes,
    hasUrls: urls.length > 0,
    urlCount: urls.length,
    urlDomains,
    hasTable,
    language,
    hasUrgency: urgencyResult.hasUrgency,
    urgencyLevel: urgencyResult.level,
    hasConstraints: constraints.length > 0,
    constraints,
    wordCount,
    hasQuestionMark: text.includes("?")
  };
}

function detectAttachmentTypes(
  attachments: Array<{ name?: string; type?: string; path?: string }>
): AttachmentType[] {
  const types: Set<AttachmentType> = new Set();

  for (const attachment of attachments) {
    const filename = attachment.name || attachment.path || "";
    const mimeType = attachment.type || "";

    if (mimeType.includes("pdf") || filename.endsWith(".pdf")) {
      types.add("pdf");
    } else if (mimeType.includes("spreadsheet") || /\.xlsx?$/i.test(filename)) {
      types.add(filename.endsWith(".xls") ? "xls" : "xlsx");
    } else if (mimeType.includes("word") || /\.docx?$/i.test(filename)) {
      types.add(filename.endsWith(".doc") ? "doc" : "docx");
    } else if (mimeType.includes("presentation") || /\.pptx?$/i.test(filename)) {
      types.add(filename.endsWith(".ppt") ? "ppt" : "pptx");
    } else if (mimeType.includes("csv") || filename.endsWith(".csv")) {
      types.add("csv");
    } else if (mimeType.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(filename)) {
      types.add("image");
    } else if (mimeType.includes("json") || filename.endsWith(".json")) {
      types.add("json");
    } else if (mimeType.includes("text") || /\.(txt|md)$/i.test(filename)) {
      types.add("text");
    } else {
      const ext = filename.substring(filename.lastIndexOf(".")).toLowerCase();
      const mappedType = FILE_EXTENSION_MAP[ext];
      types.add(mappedType || "unknown");
    }
  }

  return Array.from(types);
}

function extractDomains(urls: string[]): string[] {
  const domains: Set<string> = new Set();
  
  for (const url of urls) {
    try {
      const urlObj = new URL(url);
      domains.add(urlObj.hostname);
    } catch {
      const match = url.match(/https?:\/\/([^/]+)/);
      if (match) {
        domains.add(match[1]);
      }
    }
  }

  return Array.from(domains);
}

function detectLanguage(text: string): Language {
  const words = text.split(/\s+/).filter(w => w.length > 1);
  
  let spanishCount = 0;
  let englishCount = 0;

  for (const word of words) {
    if (SPANISH_KEYWORDS.includes(word)) spanishCount++;
    if (ENGLISH_KEYWORDS.includes(word)) englishCount++;
  }

  if (spanishCount === 0 && englishCount === 0) {
    return text.match(/[áéíóúñ¿¡]/i) ? "es" : "en";
  }

  if (spanishCount > englishCount * 1.5) return "es";
  if (englishCount > spanishCount * 1.5) return "en";
  return "mixed";
}

function detectUrgency(text: string): { hasUrgency: boolean; level: "low" | "medium" | "high" } {
  const hasHighUrgency = HIGH_URGENCY_KEYWORDS.some(k => text.includes(k));
  if (hasHighUrgency) {
    return { hasUrgency: true, level: "high" };
  }

  const hasUrgency = URGENCY_KEYWORDS.some(k => text.includes(k));
  if (hasUrgency) {
    return { hasUrgency: true, level: "medium" };
  }

  return { hasUrgency: false, level: "low" };
}

function detectConstraints(text: string): string[] {
  const constraints: string[] = [];

  for (const pattern of CONSTRAINT_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      constraints.push(...matches);
    }
  }

  return [...new Set(constraints)];
}

export class ContextDetector {
  detect(
    text: string,
    attachments: Array<{ name?: string; type?: string; path?: string }> = []
  ): ContextSignals {
    const startTime = Date.now();
    const result = detectContext(text, attachments);
    const duration = Date.now() - startTime;

    console.log(
      `[ContextDetector] Detected in ${duration}ms: ` +
      `attachments=${result.attachmentCount}, ` +
      `urls=${result.urlCount}, ` +
      `language=${result.language}, ` +
      `urgency=${result.hasUrgency ? result.urgencyLevel : "none"}`
    );

    return result;
  }
}
