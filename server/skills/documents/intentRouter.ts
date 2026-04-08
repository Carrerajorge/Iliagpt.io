import type { DocumentIntent, IntentRouteResult, DocumentFormat } from "./types";

// Keyword sets for intent detection (supports English + Spanish)

const CREATE_KEYWORDS = ["create", "crear", "generate", "generar", "make", "hacer", "new", "nuevo", "build", "construir"];
const EDIT_KEYWORDS = ["edit", "editar", "modify", "modificar", "update", "actualizar", "change", "cambiar"];
const CONVERT_KEYWORDS = ["convert", "convertir", "transform", "transformar", "export", "exportar", "to pdf", "a pdf", "to docx", "a docx"];
const ANALYZE_KEYWORDS = ["analyze", "analizar", "analyse", "review", "revisar", "inspect", "inspeccionar", "summarize", "resumir"];
const REDLINE_KEYWORDS = ["redline", "track changes", "compare", "comparar", "diff", "revision", "revisión"];

// Workflow mapping per (format, intent)

const WORKFLOW_MAP: Record<string, Record<string, { skill: string; workflow: string }>> = {
  pptx: {
    create: { skill: "pptx-create", workflow: "pptxgenjs" },
    edit: { skill: "pptx-edit", workflow: "ooxml-unpack" },
    convert: { skill: "pptx-convert", workflow: "ooxml-unpack" },
    analyze: { skill: "pptx-analyze", workflow: "ooxml-unpack" },
    redline: { skill: "pptx-edit", workflow: "ooxml-unpack" },
  },
  docx: {
    create: { skill: "docx-create", workflow: "docx-lib" },
    edit: { skill: "docx-edit", workflow: "ooxml-basic" },
    convert: { skill: "docx-convert", workflow: "ooxml-basic" },
    analyze: { skill: "docx-analyze", workflow: "ooxml-basic" },
    redline: { skill: "docx-redline", workflow: "pandoc-redline" },
  },
  xlsx: {
    create: { skill: "xlsx-create", workflow: "exceljs" },
    edit: { skill: "xlsx-edit", workflow: "exceljs-load" },
    convert: { skill: "xlsx-convert", workflow: "exceljs" },
    analyze: { skill: "xlsx-analyze", workflow: "exceljs-load" },
    redline: { skill: "xlsx-edit", workflow: "exceljs-load" },
  },
  pdf: {
    create: { skill: "pdf-create", workflow: "pdfkit" },
    edit: { skill: "pdf-edit", workflow: "pdfkit" },
    convert: { skill: "pdf-convert", workflow: "pdfkit" },
    analyze: { skill: "pdf-analyze", workflow: "pdfplumber" },
    redline: { skill: "pdf-analyze", workflow: "pdfplumber" },
  },
};

// Intent detection

function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

function detectIntent(input: {
  userMessage: string;
  hasAttachment: boolean;
  attachmentFormat?: string;
  requestedFormat?: DocumentFormat;
  context?: "legal" | "academic" | "business" | "general";
}): DocumentIntent {
  const msg = input.userMessage.toLowerCase();

  // Explicit analyze request takes priority
  if (matchesAny(msg, ANALYZE_KEYWORDS)) return "analyze";

  // Redline: legal/academic context + edit keywords, or explicit redline keywords
  if (matchesAny(msg, REDLINE_KEYWORDS)) return "redline";
  if (
    (input.context === "legal" || input.context === "academic") &&
    input.hasAttachment &&
    matchesAny(msg, EDIT_KEYWORDS)
  ) {
    return "redline";
  }

  // Convert: has attachment and requests a different format
  if (matchesAny(msg, CONVERT_KEYWORDS)) return "convert";
  if (
    input.hasAttachment &&
    input.requestedFormat &&
    input.attachmentFormat &&
    input.requestedFormat !== input.attachmentFormat
  ) {
    return "convert";
  }

  // Edit: has attachment + same format (or no explicit different format)
  if (input.hasAttachment && matchesAny(msg, EDIT_KEYWORDS)) return "edit";
  if (input.hasAttachment && !matchesAny(msg, CREATE_KEYWORDS)) return "edit";

  // Default: create
  return "create";
}

// Public router

export function routeDocumentIntent(input: {
  userMessage: string;
  hasAttachment: boolean;
  attachmentFormat?: string;
  requestedFormat?: DocumentFormat;
  context?: "legal" | "academic" | "business" | "general";
}): IntentRouteResult {
  const intent = detectIntent(input);

  const format: DocumentFormat = input.requestedFormat
    ?? (input.attachmentFormat as DocumentFormat | undefined)
    ?? "docx";

  const mapping = WORKFLOW_MAP[format]?.[intent]
    ?? WORKFLOW_MAP.docx[intent]
    ?? { skill: "docx-create", workflow: "docx-lib" };

  return {
    intent,
    skill: mapping.skill,
    workflow: mapping.workflow,
    backend: "local",
  };
}
