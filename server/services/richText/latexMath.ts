import { Math as DocxMath, MathRun } from "docx";

// ============================================
// SECURITY LIMITS
// ============================================

/** Maximum LaTeX expression length */
const MAX_LATEX_LENGTH = 10_000;

/** Maximum nesting depth for LaTeX commands */
const MAX_NESTING_DEPTH = 50;

/**
 * Sanitize LaTeX input: truncate, strip control chars, validate nesting
 */
function sanitizeLatex(latex: string): string | null {
  if (!latex || typeof latex !== "string") return null;

  // Truncate
  let safe = latex.substring(0, MAX_LATEX_LENGTH);

  // Strip null bytes and control characters (except \n, \r, \t)
  safe = safe.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // Check nesting depth (count unmatched '{')
  let depth = 0;
  for (const char of safe) {
    if (char === "{") depth++;
    else if (char === "}") depth--;
    if (depth > MAX_NESTING_DEPTH) return null;
  }

  return safe;
}

export async function createMathFromLatex(latex: string): Promise<DocxMath | null> {
  try {
    const safe = sanitizeLatex(latex);
    if (!safe) return null;

    return new DocxMath({
      children: [
        new MathRun(safe)
      ]
    });
  } catch (err) {
    console.warn("[latexMath] Failed to create math element:", String(latex).substring(0, 100), err);
    return null;
  }
}

export async function createMathPlaceholder(latex: string): Promise<DocxMath | null> {
  return createMathFromLatex(latex);
}
