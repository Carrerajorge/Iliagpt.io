/** Document Intent Router — rules-based routing with confidence scoring (v1). */
import type { DocumentIntentRoute, DocumentFormat, DocumentOperation, DocumentBackend } from "./types";

// ── Bilingual Keyword Sets (ES + EN) ─────────────────────────────
const CREATE_VERBS = [
  "create","crear","generate","generar","make","hacer","new","nuevo",
  "build","construir","diseñar","design","elaborar","prepare","preparar","redactar","write","draft",
];
const EDIT_VERBS = [
  "edit","editar","modify","modificar","update","actualizar","change","cambiar",
  "adjust","ajustar","fix","corregir","revise","mejorar","improve","rewrite","reescribir",
];
const CONVERT_VERBS = [
  "convert","convertir","transform","transformar","export","exportar",
  "to pdf","a pdf","to docx","a docx","to pptx","a pptx","to xlsx","a xlsx","pasar a","cambiar formato",
];
const ANALYZE_VERBS = [
  "analyze","analizar","analyse","review","summarize","resumir","inspect","inspeccionar","extract","extraer","describe","describir",
];
const REDLINE_VERBS = [
  "redline","track changes","compare","comparar","diff","control de cambios","markup","marcar cambios","revision","revisión",
];
const REVIEW_VERBS = ["revisar","review","check","verificar","evaluar","evaluate"];

// ── Helpers ──────────────────────────────────────────────────────
function score(text: string, kws: string[]): number {
  let s = 0;
  for (const kw of kws) if (text.includes(kw)) s += kw.split(/\s+/).length;
  return s;
}
function hasAny(text: string, kws: string[]): boolean {
  return kws.some((k) => text.includes(k));
}
function confidence(s: number, exact: boolean): number {
  if (exact && s >= 2) return 0.95;
  if (exact) return 0.9;
  if (s >= 2) return 0.8;
  if (s >= 1) return 0.7;
  return 0.3;
}

// ── Intent Detection ─────────────────────────────────────────────
type Input = {
  userMessage: string;
  hasAttachment: boolean;
  attachmentFormat?: string;
  requestedFormat?: DocumentFormat;
  context?: "legal" | "academic" | "business" | "general";
};

function detectOperation(input: Input): { operation: DocumentOperation; confidence: number } {
  const msg = input.userMessage.toLowerCase();
  const sc = {
    analyze: score(msg, ANALYZE_VERBS), redline: score(msg, REDLINE_VERBS),
    convert: score(msg, CONVERT_VERBS), edit: score(msg, EDIT_VERBS), create: score(msg, CREATE_VERBS),
  };
  // PDF attachment: NEVER edit/redline in v1 — respond "recrear o convertir"
  if (input.attachmentFormat === "pdf" && (sc.edit > 0 || sc.redline > 0))
    return { operation: "create", confidence: 0.6 };
  // Explicit analyze takes priority
  if (sc.analyze > 0) return { operation: "analyze", confidence: confidence(sc.analyze, true) };
  // Redline: explicit keywords or legal/academic context + DOCX attachment + review verbs
  if (sc.redline > 0) return { operation: "redline", confidence: confidence(sc.redline, true) };
  if ((input.context === "legal" || input.context === "academic") &&
      input.hasAttachment && input.attachmentFormat === "docx" && hasAny(msg, REVIEW_VERBS))
    return { operation: "redline", confidence: 0.75 };
  // Convert: explicit verbs or attachment + different requested format
  if (sc.convert > 0) return { operation: "convert", confidence: confidence(sc.convert, true) };
  if (input.hasAttachment && input.requestedFormat && input.attachmentFormat &&
      input.requestedFormat !== input.attachmentFormat)
    return { operation: "convert", confidence: 0.85 };
  // Edit: attachment + edit verbs or attachment without create intent
  if (input.hasAttachment && sc.edit > 0) return { operation: "edit", confidence: confidence(sc.edit, true) };
  if (input.hasAttachment && sc.create === 0) return { operation: "edit", confidence: 0.6 };
  // Create: default
  if (sc.create > 0) return { operation: "create", confidence: confidence(sc.create, true) };
  // No match — low confidence fallback (LLM routing in future)
  return { operation: "create", confidence: 0.3 };
}

// ── Backend Selection ────────────────────────────────────────────
function selectBackend(format: DocumentFormat, op: DocumentOperation): DocumentBackend {
  if (op === "redline" && format === "docx") return "native"; // ALWAYS native
  if (op === "create" || op === "edit") return "native";
  return process.env.DOC_SKILLS_CLAUDE_ENABLED === "true" ? "claude-skills" : "native";
}

// ── Public Router ────────────────────────────────────────────────
export function routeDocumentIntent(input: Input): DocumentIntentRoute {
  const { operation, confidence: conf } = detectOperation(input);
  const format: DocumentFormat = input.requestedFormat
    ?? (input.attachmentFormat as DocumentFormat | undefined) ?? "docx";
  return {
    format, operation,
    backend: selectBackend(format, operation),
    requiresQa: operation === "create" || operation === "edit",
    requiresLevel3: operation === "edit" || operation === "redline",
    confidence: conf,
  };
}
