/**
 * Document Tagging Service
 * AI-powered document classification and auto-tagging using LLM.
 */

import { llmGateway } from "../lib/llmGateway";

export interface TagResult {
  tags: string[];
  category: string;
  confidence: number;
  language: string;
  summary: string;
}

export interface ClassificationResult {
  documentType: string; // article, report, thesis, presentation, spreadsheet, etc.
  academicField?: string;
  theme: string;
  subThemes: string[];
  keywords: string[];
  sentiment?: "positive" | "neutral" | "negative";
}

/**
 * Auto-tag a document based on its content.
 */
export async function autoTagDocument(
  content: string,
  filename?: string
): Promise<TagResult> {
  const res = await llmGateway.chat(
    [
      {
        role: "system",
        content: `You are a document classification expert. Analyze the document content and generate tags.
Return ONLY a JSON object:
{
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "category": "main category",
  "confidence": 0.0-1.0,
  "language": "detected language code (es, en, pt, etc.)",
  "summary": "one-sentence summary"
}
Generate 3-8 relevant tags. No markdown, no commentary.`,
      },
      {
        role: "user",
        content: `Filename: ${filename || "unknown"}\n\nContent:\n${content.substring(0, 4000)}`,
      },
    ],
    {
      requestId: `tag_${Date.now()}`,
      temperature: 0,
      maxTokens: 500,
      enableFallback: true,
    }
  );

  let raw = (res.content || "").trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  return JSON.parse(raw) as TagResult;
}

/**
 * Classify a document into academic/professional categories.
 */
export async function classifyDocument(
  content: string,
  filename?: string
): Promise<ClassificationResult> {
  const res = await llmGateway.chat(
    [
      {
        role: "system",
        content: `You are a document classifier. Classify the document content.
Return ONLY a JSON object:
{
  "documentType": "article|report|thesis|presentation|spreadsheet|manual|contract|letter|other",
  "academicField": "field if academic (e.g., medicina, ingeniería, educación)",
  "theme": "main theme",
  "subThemes": ["sub-theme 1", "sub-theme 2"],
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "sentiment": "positive|neutral|negative"
}
No markdown, no commentary.`,
      },
      {
        role: "user",
        content: `Filename: ${filename || "unknown"}\n\nContent:\n${content.substring(0, 4000)}`,
      },
    ],
    {
      requestId: `classify_${Date.now()}`,
      temperature: 0,
      maxTokens: 500,
      enableFallback: true,
    }
  );

  let raw = (res.content || "").trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  return JSON.parse(raw) as ClassificationResult;
}

/**
 * Suggest related tags based on existing tags.
 */
export function suggestRelatedTags(existingTags: string[]): string[] {
  const TAG_RELATIONSHIPS: Record<string, string[]> = {
    investigación: ["metodología", "resultados", "análisis", "hipótesis"],
    educación: ["pedagogía", "aprendizaje", "enseñanza", "didáctica"],
    medicina: ["salud", "clínica", "tratamiento", "diagnóstico"],
    tecnología: ["innovación", "software", "digital", "automatización"],
    economía: ["finanzas", "mercado", "inversión", "desarrollo"],
    derecho: ["legislación", "normas", "jurisprudencia", "regulación"],
    psicología: ["comportamiento", "cognición", "terapia", "desarrollo"],
    ingeniería: ["diseño", "procesos", "sistemas", "optimización"],
    ciencias: ["experimental", "laboratorio", "teoría", "datos"],
    social: ["comunidad", "política", "cultura", "sociedad"],
  };

  const suggestions = new Set<string>();
  for (const tag of existingTags) {
    const normalized = tag.toLowerCase();
    for (const [key, related] of Object.entries(TAG_RELATIONSHIPS)) {
      if (normalized.includes(key) || key.includes(normalized)) {
        related.forEach((r) => suggestions.add(r));
      }
    }
  }

  // Remove tags that already exist
  const existingNormalized = new Set(existingTags.map((t) => t.toLowerCase()));
  return Array.from(suggestions).filter((s) => !existingNormalized.has(s));
}
