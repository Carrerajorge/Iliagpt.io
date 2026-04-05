/**
 * CitationGenerator — Generates precise citations for every claim in a response.
 * Supports inline [Source: doc, p.X] format, and APA/MLA/Chicago bibliography formats.
 * Verifies each citation: checks that cited text actually supports the claim.
 */

import { createLogger } from "../../utils/logger";
import type {
  GenerateStage,
  GenerateOptions,
  RetrievedChunk,
  Citation,
  CitationFormat,
} from "../UnifiedRAGPipeline";

const logger = createLogger("CitationGenerator");

// ─── Citation formats ─────────────────────────────────────────────────────────

function formatAPA(citation: CitationBase): string {
  const { author, title, pageNumber, year, sourceFile } = citation;
  const doc = title ?? sourceFile ?? "Unknown Document";
  const page = pageNumber ? `, p. ${pageNumber}` : "";
  const authorPart = author ? `${author}. ` : "";
  const yearPart = year ? `(${year}). ` : "";
  return `${authorPart}${yearPart}${doc}${page}.`;
}

function formatMLA(citation: CitationBase): string {
  const { author, title, pageNumber, year, sourceFile } = citation;
  const doc = title ?? sourceFile ?? "Unknown Document";
  const page = pageNumber ? ` ${pageNumber}` : "";
  const authorPart = author ? `${author}. ` : "";
  return `${authorPart}"${doc}."${page} ${year ?? "n.d."}.`;
}

function formatChicago(citation: CitationBase): string {
  const { author, title, pageNumber, year, sourceFile } = citation;
  const doc = title ?? sourceFile ?? "Unknown Document";
  const page = pageNumber ? `, ${pageNumber}` : "";
  const authorPart = author ? `${author}, ` : "";
  return `${authorPart}*${doc}*${page} (${year ?? "n.d."}).`;
}

function formatInline(citation: CitationBase, index: number): string {
  const parts: string[] = [];
  if (citation.sourceFile) parts.push(citation.sourceFile.split("/").pop() ?? citation.sourceFile);
  if (citation.sectionTitle) parts.push(citation.sectionTitle);
  if (citation.pageNumber) parts.push(`p. ${citation.pageNumber}`);
  return `[${index}: ${parts.join(", ") || "Source"}]`;
}

interface CitationBase {
  sourceFile?: string;
  title?: string;
  author?: string;
  year?: string;
  pageNumber?: number;
  sectionTitle?: string;
}

// ─── Claim extraction ─────────────────────────────────────────────────────────

interface Claim {
  text: string;
  startIndex: number;
  endIndex: number;
  supportingChunkIds: string[];
}

async function extractClaimsWithCitations(
  responseText: string,
  chunks: RetrievedChunk[],
  model: string
): Promise<Claim[]> {
  const { llmGateway } = await import("../../lib/llmGateway");

  const chunkContext = chunks
    .map((c, i) => `[CHUNK ${i + 1} | id=${c.id} | source=${c.metadata.sourceFile ?? "?"} | p=${c.metadata.pageNumber ?? "?"}]\n${c.content.slice(0, 300)}`)
    .join("\n\n---\n\n");

  const prompt = `Given a RESPONSE and the SOURCE CHUNKS it was generated from, identify which chunks support which claims in the response.

RESPONSE:
${responseText}

SOURCE CHUNKS:
${chunkContext}

For each factual claim in the response, return JSON:
{
  "claims": [
    {
      "text": "<exact claim sentence from response>",
      "supporting_chunk_ids": ["<chunk_id1>", ...]
    }
  ]
}

Include only claims that have supporting evidence in the chunks. Return valid JSON only.`;

  try {
    const result = await llmGateway.chat(
      [{ role: "user", content: prompt }],
      { model, maxTokens: 800, temperature: 0 }
    );

    const jsonMatch = result.content.match(/\{[\s\S]*"claims"[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as {
      claims: Array<{ text: string; supporting_chunk_ids: string[] }>;
    };

    return (parsed.claims ?? []).map((claim) => {
      const startIndex = responseText.indexOf(claim.text);
      return {
        text: claim.text,
        startIndex: Math.max(0, startIndex),
        endIndex: startIndex + claim.text.length,
        supportingChunkIds: claim.supporting_chunk_ids ?? [],
      };
    });
  } catch (err) {
    logger.warn("Claim extraction failed", { error: String(err) });
    return [];
  }
}

// ─── Inline citation insertion ────────────────────────────────────────────────

function insertInlineCitations(
  text: string,
  claims: Claim[],
  citationMap: Map<string, string> // chunkId → inline marker
): string {
  // Sort claims by position descending (insert from end to preserve indices)
  const sorted = [...claims].sort((a, b) => b.startIndex - a.startIndex);
  let result = text;

  for (const claim of sorted) {
    const markers = claim.supportingChunkIds
      .map((id) => citationMap.get(id))
      .filter(Boolean)
      .join("");
    if (!markers) continue;

    const insertAt = claim.endIndex < result.length ? claim.endIndex : result.indexOf(claim.text) + claim.text.length;
    if (insertAt <= 0) continue;
    result = result.slice(0, insertAt) + markers + result.slice(insertAt);
  }

  return result;
}

// ─── Citation verification ────────────────────────────────────────────────────

function verifyCitation(claimText: string, chunkContent: string): boolean {
  // Simple: at least 30% of claim tokens appear in the chunk
  const claimTokens = new Set(
    claimText.toLowerCase().split(/\s+/).filter((t) => t.length > 3)
  );
  if (claimTokens.size === 0) return false;

  const chunkLower = chunkContent.toLowerCase();
  let matches = 0;
  for (const token of claimTokens) {
    if (chunkLower.includes(token)) matches++;
  }
  return matches / claimTokens.size >= 0.3;
}

// ─── CitationGenerator ────────────────────────────────────────────────────────

export interface CitationGeneratorConfig {
  model: string;
  format: CitationFormat;
  includeInlineCitations: boolean;
  includeSourceList: boolean;
  verifyAccuracy: boolean;
  maxContextTokens: number;
}

const DEFAULT_CG_CONFIG: CitationGeneratorConfig = {
  model: process.env.RAG_RERANK_MODEL ?? "gpt-4o-mini",
  format: "inline",
  includeInlineCitations: true,
  includeSourceList: true,
  verifyAccuracy: true,
  maxContextTokens: 4000,
};

export class CitationGenerator implements GenerateStage {
  private readonly config: CitationGeneratorConfig;

  constructor(config: Partial<CitationGeneratorConfig> = {}) {
    this.config = { ...DEFAULT_CG_CONFIG, ...config };
  }

  async generate(
    query: string,
    chunks: RetrievedChunk[],
    options: GenerateOptions = {}
  ): Promise<{ prompt: string; answer?: string; citations: Citation[] }> {
    const format = options.citationFormat ?? this.config.format;
    const language = options.language ?? "es";
    const maxTokens = options.maxContextTokens ?? this.config.maxContextTokens;

    // Build prompt
    const { prompt, contextParts } = this.buildPrompt(query, chunks, language, maxTokens, options.includePageNumbers ?? true);

    // Generate answer
    let answer: string | undefined;
    try {
      const { llmGateway } = await import("../../lib/llmGateway");
      const response = await llmGateway.chat(
        [{ role: "user", content: prompt }],
        { model: this.config.model, maxTokens: 1200, temperature: 0.3 }
      );
      answer = response.content;
    } catch (err) {
      logger.warn("Answer generation failed", { error: String(err) });
    }

    // Build citation objects
    const rawCitations: Citation[] = chunks.map((chunk, i) => ({
      chunkId: chunk.id,
      text: chunk.content.slice(0, 250) + (chunk.content.length > 250 ? "…" : ""),
      pageNumber: chunk.metadata.pageNumber,
      sectionTitle: chunk.metadata.sectionTitle,
      sourceFile: chunk.metadata.sourceFile,
      relevanceScore: chunk.score,
    }));

    // If answer available, annotate with claim-level citations
    let annotatedAnswer: string | undefined = answer;
    if (answer && this.config.includeInlineCitations && format === "inline") {
      try {
        const claims = await extractClaimsWithCitations(answer, chunks, this.config.model);

        // Build inline markers
        const citationMap = new Map<string, string>();
        chunks.forEach((c, i) => citationMap.set(c.id, `[${i + 1}]`));

        // Verify citations if enabled
        const verifiedClaims = this.config.verifyAccuracy
          ? claims.map((claim) => ({
              ...claim,
              supportingChunkIds: claim.supportingChunkIds.filter((cid) => {
                const chunk = chunks.find((c) => c.id === cid);
                return chunk ? verifyCitation(claim.text, chunk.content) : false;
              }),
            }))
          : claims;

        // Annotate claims on answer
        annotatedAnswer = insertInlineCitations(answer, verifiedClaims, citationMap);

        // Update citations with claim text
        for (const claim of verifiedClaims) {
          for (const cid of claim.supportingChunkIds) {
            const cit = rawCitations.find((c) => c.chunkId === cid);
            if (cit && !cit.claimText) {
              cit.claimText = claim.text.slice(0, 150);
            }
          }
        }
      } catch (err) {
        logger.warn("Inline citation insertion failed", { error: String(err) });
      }
    }

    // Format citations per requested format
    const formattedCitations = rawCitations.map((cit, i) => {
      const base: CitationBase = {
        sourceFile: cit.sourceFile,
        sectionTitle: cit.sectionTitle,
        pageNumber: cit.pageNumber,
        title: cit.sectionTitle,
      };

      let formatted: string;
      switch (format) {
        case "apa":
          formatted = formatAPA(base);
          break;
        case "mla":
          formatted = formatMLA(base);
          break;
        case "chicago":
          formatted = formatChicago(base);
          break;
        default:
          formatted = formatInline(base, i + 1);
      }

      return { ...cit, format, formatted };
    });

    // Append source list to answer if requested
    if (annotatedAnswer && this.config.includeSourceList && formattedCitations.length > 0) {
      const sourceListLabel = language === "es" ? "\n\n**Fuentes:**\n" : "\n\n**Sources:**\n";
      const sourceList = formattedCitations
        .map((c, i) => `${i + 1}. ${c.formatted}`)
        .join("\n");
      annotatedAnswer = annotatedAnswer + sourceListLabel + sourceList;
    }

    logger.info("CitationGenerator complete", {
      query: query.slice(0, 60),
      chunks: chunks.length,
      citations: formattedCitations.length,
      format,
    });

    return {
      prompt,
      answer: annotatedAnswer,
      citations: formattedCitations,
    };
  }

  private buildPrompt(
    query: string,
    chunks: RetrievedChunk[],
    language: "es" | "en",
    maxTokens: number,
    includePageNumbers: boolean
  ): { prompt: string; contextParts: string[] } {
    const contextParts: string[] = [];
    let estimatedTokens = 0;

    for (const chunk of chunks) {
      const chunkTokens = Math.ceil(chunk.content.length / 4);
      if (estimatedTokens + chunkTokens > maxTokens) break;

      const ref = includePageNumbers && chunk.metadata.pageNumber
        ? `[p. ${chunk.metadata.pageNumber}${chunk.metadata.sectionTitle ? ` — ${chunk.metadata.sectionTitle}` : ""}]`
        : chunk.metadata.sectionTitle ? `[${chunk.metadata.sectionTitle}]` : "";

      contextParts.push(`${ref}\n${chunk.content}`);
      estimatedTokens += chunkTokens;
    }

    const systemLine = language === "es"
      ? "Eres un asistente experto. Responde basándote ÚNICAMENTE en el contexto. Cita las páginas con [p. X] cuando proporciones datos específicos. Si la información no está en el contexto, indícalo."
      : "You are an expert assistant. Answer based ONLY on the provided context. Cite page numbers with [p. X] when providing specific data. If the information is not in the context, clearly state that.";

    const prompt = `${systemLine}

## Context:
${contextParts.join("\n\n---\n\n")}

## Question:
${query}

## Answer:`;

    return { prompt, contextParts };
  }
}

// ─── Standalone helper ────────────────────────────────────────────────────────

export function extractSourceList(
  chunks: RetrievedChunk[],
  format: CitationFormat = "inline"
): Citation[] {
  return chunks.map((chunk, i) => {
    const base: CitationBase = {
      sourceFile: chunk.metadata.sourceFile,
      sectionTitle: chunk.metadata.sectionTitle,
      pageNumber: chunk.metadata.pageNumber,
    };

    let formatted: string;
    switch (format) {
      case "apa": formatted = formatAPA(base); break;
      case "mla": formatted = formatMLA(base); break;
      case "chicago": formatted = formatChicago(base); break;
      default: formatted = formatInline(base, i + 1);
    }

    return {
      chunkId: chunk.id,
      text: chunk.content.slice(0, 200),
      pageNumber: chunk.metadata.pageNumber,
      sectionTitle: chunk.metadata.sectionTitle,
      sourceFile: chunk.metadata.sourceFile,
      relevanceScore: chunk.score,
      format,
      formatted,
    };
  });
}
