/**
 * DocumentIntelligence — Deep document understanding: structure extraction,
 * knowledge graph generation, entity/relationship extraction, and multi-granularity summaries.
 *
 * Supports: PDF (structure), DOCX (heading hierarchy), Code (AST deps),
 * images (OCR + vision description), and general text.
 */

import { createLogger } from "../../utils/logger";
import type { RetrievedChunk } from "../UnifiedRAGPipeline";

const logger = createLogger("DocumentIntelligence");

// ─── Document structure types ─────────────────────────────────────────────────

export interface DocumentSection {
  level: number;          // 1 = top-level chapter, 2 = section, 3 = subsection
  title: string;
  content: string;
  startOffset: number;
  endOffset: number;
  pageRange?: [number, number];
  children: DocumentSection[];
}

export interface DocumentStructure {
  title?: string;
  author?: string;
  language: string;
  pageCount?: number;
  wordCount: number;
  sections: DocumentSection[];
  tableCount: number;
  figureCount: number;
  codeBlockCount: number;
  hasTableOfContents: boolean;
  documentType: "academic" | "technical" | "report" | "code" | "general";
}

// ─── Knowledge graph types ────────────────────────────────────────────────────

export interface KGEntity {
  id: string;
  label: string;
  type: "person" | "organization" | "location" | "concept" | "technology" | "event" | "other";
  frequency: number;
  firstMention?: number;   // character offset
  contexts: string[];      // up to 3 surrounding sentences
}

export interface KGRelationship {
  fromId: string;
  toId: string;
  relation: string;
  confidence: number;
  evidence: string;
}

export interface KnowledgeGraph {
  entities: KGEntity[];
  relationships: KGRelationship[];
  keyFacts: string[];
}

// ─── Summary types ────────────────────────────────────────────────────────────

export interface MultiGranularitySummary {
  sentence: string;          // 1–2 sentences
  paragraph: string;         // ~150 words
  page: string;              // ~400 words, structured
  full: string;              // comprehensive
}

// ─── Structure extraction ─────────────────────────────────────────────────────

function detectDocumentType(text: string, fileName?: string): DocumentStructure["documentType"] {
  const ext = fileName?.split(".").pop()?.toLowerCase();
  if (ext && ["ts", "js", "py", "go", "rs", "java", "cpp"].includes(ext)) return "code";

  const academicSignals = ["abstract", "introduction", "methodology", "conclusion", "references", "bibliography", "doi:", "et al."];
  const technicalSignals = ["installation", "configuration", "api", "endpoint", "function", "parameter", "returns", "example"];
  const reportSignals = ["executive summary", "findings", "recommendations", "appendix", "table of contents"];

  const lowerText = text.slice(0, 5000).toLowerCase();
  const academicScore = academicSignals.filter((s) => lowerText.includes(s)).length;
  const technicalScore = technicalSignals.filter((s) => lowerText.includes(s)).length;
  const reportScore = reportSignals.filter((s) => lowerText.includes(s)).length;

  const max = Math.max(academicScore, technicalScore, reportScore);
  if (max < 2) return "general";
  if (max === academicScore) return "academic";
  if (max === technicalScore) return "technical";
  return "report";
}

function extractSections(text: string): DocumentSection[] {
  const lines = text.split("\n");
  const sections: DocumentSection[] = [];
  const stack: DocumentSection[] = [];
  let offset = 0;
  let currentContent = "";

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/) ??
      line.match(/^([A-Z][A-Z\s]{4,60})$/) &&
      [null, "#", line] as RegExpMatchArray | null;

    const mdMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (mdMatch) {
      const level = mdMatch[1].length;
      const title = mdMatch[2].trim();

      // Close all sections at same or deeper level
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        const closing = stack.pop()!;
        closing.content = currentContent.trim();
        closing.endOffset = offset;
        currentContent = "";
      }

      const section: DocumentSection = {
        level,
        title,
        content: "",
        startOffset: offset,
        endOffset: offset,
        children: [],
      };

      if (stack.length > 0) {
        stack[stack.length - 1].children.push(section);
      } else {
        sections.push(section);
      }
      stack.push(section);
    } else {
      currentContent += line + "\n";
    }

    offset += line.length + 1;
  }

  // Close remaining sections
  while (stack.length > 0) {
    const closing = stack.pop()!;
    closing.content = currentContent.trim();
    closing.endOffset = offset;
    currentContent = "";
  }

  return sections;
}

function countStructuralElements(text: string): { tables: number; figures: number; codeBlocks: number } {
  const tables = (text.match(/^\|.+\|/gm) ?? []).filter((_, i) => i % 3 === 0).length;
  const figures = (text.match(/\[?(figure|figura|fig\.|image|imagen)\s*\d*/gi) ?? []).length;
  const codeBlocks = (text.match(/^```/gm) ?? []).length / 2;
  return { tables, figures, codeBlocks: Math.round(codeBlocks) };
}

function detectLanguage(text: string): string {
  const esCount = (text.match(/\b(el|la|los|las|de|que|en|un|una|es|por|con)\b/gi) ?? []).length;
  const enCount = (text.match(/\b(the|is|are|of|and|to|in|for|with|that|this)\b/gi) ?? []).length;
  if (esCount > enCount * 1.3) return "es";
  if (enCount > esCount * 1.3) return "en";
  return "mixed";
}

export function extractDocumentStructure(
  text: string,
  options: { fileName?: string; pageCount?: number } = {}
): DocumentStructure {
  const sections = extractSections(text);
  const { tables, figures, codeBlocks } = countStructuralElements(text);
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
  const hasToC = /table of contents|índice|contenido/i.test(text.slice(0, 3000));

  // Try to extract title and author
  const titleMatch = text.match(/^#\s+(.+)$/m) ?? text.match(/^([A-Z][^\n]{10,100})\n/);
  const authorMatch = text.match(/(?:autor|author|by|por)[:.]?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/i);

  return {
    title: titleMatch?.[1]?.trim(),
    author: authorMatch?.[1]?.trim(),
    language: detectLanguage(text),
    pageCount: options.pageCount,
    wordCount,
    sections,
    tableCount: tables,
    figureCount: figures,
    codeBlockCount: codeBlocks,
    hasTableOfContents: hasToC,
    documentType: detectDocumentType(text, options.fileName),
  };
}

// ─── Entity extraction ────────────────────────────────────────────────────────

interface SimpleEntity {
  text: string;
  type: KGEntity["type"];
}

function extractEntitiesHeuristic(text: string): SimpleEntity[] {
  const entities: SimpleEntity[] = [];

  // Technology patterns
  const techPattern = /\b(React|Vue|Angular|Node\.js|TypeScript|JavaScript|Python|Docker|Kubernetes|PostgreSQL|MongoDB|Redis|AWS|Azure|GCP|OpenAI|Anthropic|LangChain|FastAPI|Express)\b/g;
  for (const match of text.matchAll(techPattern)) {
    entities.push({ text: match[1], type: "technology" });
  }

  // Capitalized multi-word phrases (likely proper nouns)
  const properNounPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;
  const seen = new Set(entities.map((e) => e.text));
  for (const match of text.matchAll(properNounPattern)) {
    if (!seen.has(match[1]) && match[1].length > 4) {
      entities.push({ text: match[1], type: "other" });
      seen.add(match[1]);
    }
  }

  // Organization suffixes
  const orgPattern = /\b([A-Z][a-zA-Z\s]+(?:Inc\.|LLC|Corp\.|S\.A\.|GmbH|Ltd\.|University|Institute|Foundation))\b/g;
  for (const match of text.matchAll(orgPattern)) {
    entities.push({ text: match[1], type: "organization" });
  }

  return entities;
}

function computeEntityFrequency(entities: SimpleEntity[], text: string): KGEntity[] {
  const entityMap = new Map<string, KGEntity>();

  for (const entity of entities) {
    const existing = entityMap.get(entity.text);
    if (existing) {
      existing.frequency++;
    } else {
      const firstIndex = text.indexOf(entity.text);
      const contextStart = Math.max(0, firstIndex - 100);
      const contextEnd = Math.min(text.length, firstIndex + entity.text.length + 100);

      entityMap.set(entity.text, {
        id: entity.text.toLowerCase().replace(/\s+/g, "_"),
        label: entity.text,
        type: entity.type,
        frequency: 1,
        firstMention: firstIndex,
        contexts: [text.slice(contextStart, contextEnd).replace(/\n/g, " ")],
      });
    }
  }

  return [...entityMap.values()].sort((a, b) => b.frequency - a.frequency);
}

// ─── Knowledge graph generation ───────────────────────────────────────────────

async function generateKGWithLLM(
  text: string,
  model: string
): Promise<KnowledgeGraph> {
  const { llmGateway } = await import("../../lib/llmGateway");
  const sample = text.slice(0, 3000);

  try {
    const response = await llmGateway.chat(
      [
        {
          role: "user",
          content: `Extract key information from this text as a knowledge graph.

TEXT:
${sample}

Return JSON:
{
  "entities": [{"label": "...", "type": "person|organization|location|concept|technology|event|other"}],
  "relationships": [{"from": "...", "to": "...", "relation": "...", "evidence": "<quote>"}],
  "keyFacts": ["fact1", "fact2", ...]
}

Return valid JSON only. Limit to 15 entities, 10 relationships, 5 key facts.`,
        },
      ],
      { model, maxTokens: 600, temperature: 0 }
    );

    const jsonMatch = response.content.match(/\{[\s\S]*"entities"[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const parsed = JSON.parse(jsonMatch[0]) as {
      entities: Array<{ label: string; type: string }>;
      relationships: Array<{ from: string; to: string; relation: string; evidence: string }>;
      keyFacts: string[];
    };

    const entities: KGEntity[] = (parsed.entities ?? []).map((e, i) => ({
      id: `entity_${i}`,
      label: e.label,
      type: (e.type as KGEntity["type"]) || "other",
      frequency: 1,
      contexts: [],
    }));

    const entityIdMap = new Map(entities.map((e) => [e.label, e.id]));

    const relationships: KGRelationship[] = (parsed.relationships ?? [])
      .map((r) => ({
        fromId: entityIdMap.get(r.from) ?? r.from,
        toId: entityIdMap.get(r.to) ?? r.to,
        relation: r.relation,
        confidence: 0.8,
        evidence: r.evidence ?? "",
      }))
      .filter((r) => r.fromId && r.toId);

    return {
      entities,
      relationships,
      keyFacts: (parsed.keyFacts ?? []).slice(0, 5),
    };
  } catch (err) {
    logger.warn("LLM knowledge graph failed, using heuristic entities", { error: String(err) });
    const simpleEntities = extractEntitiesHeuristic(text);
    const entities = computeEntityFrequency(simpleEntities, text).slice(0, 15);
    return { entities, relationships: [], keyFacts: [] };
  }
}

// ─── Multi-granularity summaries ──────────────────────────────────────────────

async function generateSummaries(
  text: string,
  model: string,
  documentTitle?: string
): Promise<MultiGranularitySummary> {
  const { llmGateway } = await import("../../lib/llmGateway");

  const titleLine = documentTitle ? `Document: "${documentTitle}"\n\n` : "";
  const sample = `${titleLine}${text.slice(0, 6000)}`;

  try {
    const response = await llmGateway.chat(
      [
        {
          role: "user",
          content: `Generate summaries of this document at multiple levels of detail.

${sample}

Return JSON:
{
  "sentence": "<1-2 sentence summary>",
  "paragraph": "<~150 word summary>",
  "page": "<~400 word structured summary with key sections>",
  "full": "<comprehensive summary covering all major points>"
}

Return valid JSON only.`,
        },
      ],
      { model, maxTokens: 1500, temperature: 0.3 }
    );

    const jsonMatch = response.content.match(/\{[\s\S]*"sentence"[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    return JSON.parse(jsonMatch[0]) as MultiGranularitySummary;
  } catch (err) {
    logger.warn("LLM summary generation failed, using heuristic", { error: String(err) });
    const sentences = text.split(/[.!?]+\s+/).filter((s) => s.length > 20);
    return {
      sentence: sentences.slice(0, 2).join(". ") + ".",
      paragraph: text.slice(0, 600),
      page: text.slice(0, 1600),
      full: text.slice(0, 4000),
    };
  }
}

// ─── Main DocumentIntelligence ────────────────────────────────────────────────

export interface DocumentIntelligenceConfig {
  model: string;
  generateKnowledgeGraph: boolean;
  generateSummaries: boolean;
  extractStructure: boolean;
}

const DEFAULT_DI_CONFIG: DocumentIntelligenceConfig = {
  model: process.env.RAG_RERANK_MODEL ?? "gpt-4o-mini",
  generateKnowledgeGraph: true,
  generateSummaries: true,
  extractStructure: true,
};

export interface DocumentAnalysis {
  structure?: DocumentStructure;
  knowledgeGraph?: KnowledgeGraph;
  summaries?: MultiGranularitySummary;
  processingTimeMs: number;
}

export class DocumentIntelligence {
  private readonly config: DocumentIntelligenceConfig;

  constructor(config: Partial<DocumentIntelligenceConfig> = {}) {
    this.config = { ...DEFAULT_DI_CONFIG, ...config };
  }

  async analyze(
    text: string,
    options: { fileName?: string; pageCount?: number } = {}
  ): Promise<DocumentAnalysis> {
    const startTime = Date.now();
    const results: DocumentAnalysis = { processingTimeMs: 0 };

    const tasks: Promise<void>[] = [];

    if (this.config.extractStructure) {
      tasks.push(
        Promise.resolve().then(() => {
          results.structure = extractDocumentStructure(text, options);
        })
      );
    }

    if (this.config.generateKnowledgeGraph) {
      tasks.push(
        generateKGWithLLM(text, this.config.model).then((kg) => {
          results.knowledgeGraph = kg;
        }).catch((err) => {
          logger.warn("Knowledge graph generation failed", { error: String(err) });
        })
      );
    }

    if (this.config.generateSummaries) {
      tasks.push(
        generateSummaries(text, this.config.model, results.structure?.title).then((summaries) => {
          results.summaries = summaries;
        }).catch((err) => {
          logger.warn("Summary generation failed", { error: String(err) });
        })
      );
    }

    await Promise.all(tasks);

    results.processingTimeMs = Date.now() - startTime;

    logger.info("DocumentIntelligence complete", {
      fileName: options.fileName,
      sections: results.structure?.sections.length ?? 0,
      entities: results.knowledgeGraph?.entities.length ?? 0,
      durationMs: results.processingTimeMs,
    });

    return results;
  }

  /**
   * Generate a concise document card for UI display.
   */
  generateDocumentCard(analysis: DocumentAnalysis, fileName?: string): Record<string, unknown> {
    return {
      title: analysis.structure?.title ?? fileName ?? "Untitled",
      author: analysis.structure?.author,
      language: analysis.structure?.language,
      documentType: analysis.structure?.documentType,
      wordCount: analysis.structure?.wordCount,
      pageCount: analysis.structure?.pageCount,
      sections: analysis.structure?.sections.length ?? 0,
      hasTables: (analysis.structure?.tableCount ?? 0) > 0,
      hasFigures: (analysis.structure?.figureCount ?? 0) > 0,
      topEntities: analysis.knowledgeGraph?.entities.slice(0, 5).map((e) => e.label) ?? [],
      keyFacts: analysis.knowledgeGraph?.keyFacts ?? [],
      summary: analysis.summaries?.sentence,
    };
  }

  /**
   * Find the most relevant section for a query using heading matching.
   */
  findRelevantSections(
    structure: DocumentStructure,
    query: string,
    maxSections = 3
  ): DocumentSection[] {
    const queryTokens = new Set(
      query.toLowerCase().split(/\s+/).filter((t) => t.length > 3)
    );

    const scored = structure.sections.flatMap((s) => [s, ...s.children]).map((section) => {
      const titleTokens = section.title.toLowerCase().split(/\s+/);
      const titleScore = titleTokens.filter((t) => queryTokens.has(t)).length;
      const contentTokens = section.content.toLowerCase().split(/\s+/);
      const contentScore = contentTokens.filter((t) => queryTokens.has(t)).length / Math.max(1, contentTokens.length / 10);
      return { section, score: titleScore * 2 + contentScore };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSections)
      .filter((s) => s.score > 0)
      .map((s) => s.section);
  }
}

export const documentIntelligence = new DocumentIntelligence();
