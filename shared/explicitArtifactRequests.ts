const CREATE_OR_WRITE_RE =
  /\b(crea(?:r)?|create|genera(?:r)?|generate|escribe|write|redacta(?:r)?|draft|haz(?:me)?|make|prepara(?:r)?|prepare|elabora(?:r)?|build)\b/i;

const FILE_DELIVERY_RE =
  /\b(adjunta(?:r|do|da|lo|la)?|attach|anexa(?:r|do|da)?|descarga(?:r)?|download|exporta(?:r)?|export|guarda(?:r|do|da|lo|la)?|save|sube(?:lo|la)?|upload)\b/i;

const DOCUMENT_FORMAT_RE = /\b(word|docx|pdf)\b/i;
const DOCUMENT_CONTENT_RE =
  /\b(informe|report|carta|letter|ensayo|essay|cv|curr[ií]culum|curriculum|resumen|summary|memorando|memo|propuesta)\b/i;

const SPREADSHEET_FORMAT_RE =
  /\b(excel|xlsx|spreadsheet|hoja(?:s)? de c[aá]lculo|hoja(?:s)? de calculo|csv)\b/i;
const SPREADSHEET_CONTENT_RE = /\b(tabla|table|dataset|presupuesto|budget|listado|base de datos|database)\b/i;

const PRESENTATION_FORMAT_RE = /\b(powerpoint|pptx|ppt|slides|diapositivas)\b/i;
const PRESENTATION_CONTENT_RE = /\b(presentaci[oó]n|presentation)\b/i;

const DOCUMENT_FORMAT_PHRASE_RE =
  /\b(?:en|como)\s+(?:un\s+)?(?:(?:archivo|documento|document|file)\s+)?(?:formato\s+)?(?:word|docx|pdf)\b/i;
const SPREADSHEET_FORMAT_PHRASE_RE =
  /\b(?:en|como)\s+(?:un\s+)?(?:archivo\s+)?(?:formato\s+)?(?:excel|xlsx|spreadsheet|csv)\b/i;
const PRESENTATION_FORMAT_PHRASE_RE =
  /\b(?:en|como)\s+(?:un\s+)?(?:archivo\s+)?(?:formato\s+)?(?:powerpoint|pptx|ppt|slides|diapositivas)\b/i;

function normalizeMessage(message: string): string {
  return String(message || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasExplicitFileDeliverySignal(message: string): boolean {
  return FILE_DELIVERY_RE.test(normalizeMessage(message));
}

export function hasExplicitDocumentArtifactRequest(message: string): boolean {
  const normalized = normalizeMessage(message);
  const hasCreateOrWrite = CREATE_OR_WRITE_RE.test(normalized);
  const hasDocumentFormat = DOCUMENT_FORMAT_RE.test(normalized);
  const hasDocumentContent = DOCUMENT_CONTENT_RE.test(normalized);
  const hasDelivery = FILE_DELIVERY_RE.test(normalized);

  return (
    (hasCreateOrWrite && hasDocumentFormat) ||
    DOCUMENT_FORMAT_PHRASE_RE.test(normalized) ||
    (hasDocumentContent && hasDelivery) ||
    (hasDocumentFormat && hasDelivery)
  );
}

export function hasExplicitSpreadsheetArtifactRequest(message: string): boolean {
  const normalized = normalizeMessage(message);
  const hasCreateOrWrite = CREATE_OR_WRITE_RE.test(normalized);
  const hasSpreadsheetFormat = SPREADSHEET_FORMAT_RE.test(normalized);
  const hasSpreadsheetContent = SPREADSHEET_CONTENT_RE.test(normalized);
  const hasDelivery = FILE_DELIVERY_RE.test(normalized);

  return (
    (hasCreateOrWrite && hasSpreadsheetFormat) ||
    SPREADSHEET_FORMAT_PHRASE_RE.test(normalized) ||
    (hasSpreadsheetContent && hasDelivery) ||
    (hasSpreadsheetFormat && hasDelivery)
  );
}

export function hasExplicitPresentationArtifactRequest(message: string): boolean {
  const normalized = normalizeMessage(message);
  const hasCreateOrWrite = CREATE_OR_WRITE_RE.test(normalized);
  const hasPresentationFormat = PRESENTATION_FORMAT_RE.test(normalized);
  const hasPresentationContent = PRESENTATION_CONTENT_RE.test(normalized);
  const hasDelivery = FILE_DELIVERY_RE.test(normalized);

  return (
    (hasCreateOrWrite && hasPresentationFormat) ||
    PRESENTATION_FORMAT_PHRASE_RE.test(normalized) ||
    (hasPresentationContent && hasDelivery) ||
    (hasPresentationFormat && hasDelivery)
  );
}

// ─── Universal Output-Format Classifier ──────────────────────────────
//
// Pre-classification gate that determines the DELIVERY FORMAT independent
// of content type.  Only returns a file format when the user explicitly
// mentions file-related keywords (word, docx, excel, pptx, descargar,
// exportar, archivo, etc.).  Content-type words like "carta", "informe",
// "ensayo" alone are NOT enough — the user must also signal they want a
// file.  This prevents the agent from autonomously generating documents
// when the user just wants a text response.

export type OutputFormat = "text" | "word" | "excel" | "pptx";

export interface OutputFormatClassification {
  action: OutputFormat;
  confidence: number;
}

/** Explicit file-format keywords that unambiguously signal a file output.
 *  Generic nouns like "documento" or "archivo" are intentionally excluded:
 *  they appear often in normal chat requests and should not auto-trigger a file. */
const EXPLICIT_FILE_FORMAT_RE =
  /\b(word|docx|\.docx|pdf|\.pdf|excel|xlsx|\.xlsx|powerpoint|pptx|\.pptx|ppt|\.ppt|slides|diapositivas)\b/i;

/** Delivery verbs that, combined with a format/content signal, confirm file intent. */
const DELIVERY_ACTION_RE =
  /\b(descarga(?:r|lo|la)?|download|exporta(?:r)?|export|adjunta(?:r|lo|la)?|attach|guarda(?:r|lo|la)?\s+(?:como|en)\s+(?:archivo|file|word|docx|excel|pdf|pptx))\b/i;

/** Format-as phrases: "en formato word", "como documento word", etc. */
const FORMAT_AS_PHRASE_RE =
  /\b(?:en|como)\s+(?:un\s+)?(?:(?:archivo|documento|document|file)\s+)?(?:formato\s+)?(?:word|docx|pdf|excel|xlsx|powerpoint|pptx|ppt)\b/i;

export function classifyOutputFormat(message: string): OutputFormatClassification {
  const normalized = normalizeMessage(message);

  // 1) Explicit file-format keyword → high confidence
  if (EXPLICIT_FILE_FORMAT_RE.test(normalized) || FORMAT_AS_PHRASE_RE.test(normalized)) {
    if (/\b(excel|xlsx|\.xlsx|csv)\b/i.test(normalized)) {
      return { action: "excel", confidence: 0.95 };
    }
    if (/\b(powerpoint|pptx|\.pptx|ppt|\.ppt|slides|diapositivas)\b/i.test(normalized)) {
      return { action: "pptx", confidence: 0.95 };
    }
    if (/\b(word|docx|\.docx)\b/i.test(normalized)) {
      return { action: "word", confidence: 0.95 };
    }
    // "pdf" → word (closest deliverable)
    if (/\b(pdf|\.pdf)\b/i.test(normalized)) {
      return { action: "word", confidence: 0.90 };
    }
  }

  // 2) Delivery action + document format keyword → file
  if (DELIVERY_ACTION_RE.test(normalized) && DOCUMENT_FORMAT_RE.test(normalized)) {
    return { action: "word", confidence: 0.90 };
  }

  // 3) Delivery action + spreadsheet/presentation format keyword
  if (DELIVERY_ACTION_RE.test(normalized)) {
    if (SPREADSHEET_FORMAT_RE.test(normalized)) return { action: "excel", confidence: 0.90 };
    if (PRESENTATION_FORMAT_RE.test(normalized)) return { action: "pptx", confidence: 0.90 };
  }

  // 4) Default: text response — content words like "carta", "informe"
  //    do NOT trigger file generation on their own.
  return { action: "text", confidence: 0.95 };
}
