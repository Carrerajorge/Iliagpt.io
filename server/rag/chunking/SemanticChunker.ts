/**
 * SemanticChunker — Embedding-similarity boundary detection with language-aware
 * sentence splitting and special handlers for code, tables, and lists.
 */

import crypto from "crypto";
import { createLogger } from "../../utils/logger";
import type {
  ChunkStage,
  PipelineChunk,
  ChunkMetadata,
  ChunkType,
  SectionType,
} from "../UnifiedRAGPipeline";
import { cosineSimilarity, generateChunkId } from "../UnifiedRAGPipeline";

const logger = createLogger("SemanticChunker");

export interface SemanticChunkerConfig {
  targetSize: number;
  maxSize: number;
  minSize: number;
  similarityThreshold: number;
  overlapSentences: number;
  overlapChars: number;
  useSemanticBoundaries: boolean;
}

const DEFAULT_CONFIG: SemanticChunkerConfig = {
  targetSize: 800,
  maxSize: 1200,
  minSize: 100,
  similarityThreshold: 0.7,
  overlapSentences: 2,
  overlapChars: 150,
  useSemanticBoundaries: true,
};

// ─── Abbreviation sets for sentence splitting ─────────────────────────────────

const ABBREVIATIONS = new Set([
  "dr","dra","sr","sra","srta","ing","lic","prof","dpto","dept","etc","vs",
  "art","fig","cap","num","tel","av","mr","mrs","ms","jr","approx","avg","vol",
]);

function splitSentences(text: string): string[] {
  let protected_ = text;
  for (const abbr of ABBREVIATIONS) {
    const re = new RegExp(`\\b${abbr}\\.`, "gi");
    protected_ = protected_.replace(re, `${abbr}\u00B7`);
  }
  return protected_
    .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÜÑa-záéíóúüñ])/)
    .map((s) => s.replace(/\u00B7/g, ".").trim())
    .filter((s) => s.length > 0);
}

function detectChunkType(text: string): ChunkType {
  if (/^```[\s\S]*?```/m.test(text) || /^( {4}|\t)\S/m.test(text)) return "code";
  if (/\|[^|]+\|[^|]+\|/.test(text)) return "table";
  if (/^[\s]*[-*\u2022]\s|^[\s]*\d+\.\s/m.test(text)) return "list";
  if (/^#{1,6}\s|^[A-Z][A-Z\s]{3,}$/m.test(text)) return "heading";
  return "text";
}

function detectSectionType(text: string): SectionType {
  if (/^#{1,6}\s/.test(text.trim()) || /^[A-Z][A-Z\s]{3,50}$/.test(text.trim())) return "heading";
  if (/^[\s]*[-*\u2022]\s|^[\s]*\d+\.\s/m.test(text)) return "list";
  if (/\|[^|]+\|[^|]+\|/.test(text)) return "table";
  if (/```|^\s{4}\S/m.test(text)) return "code";
  return "paragraph";
}

function extractSectionTitle(text: string): string | undefined {
  return (
    text.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim() ??
    text.match(/^([A-Z\u00C0-\u00DC][A-Za-z\u00C0-\u017E\s]{2,60})$/m)?.[1]?.trim()
  );
}

function detectLanguage(text: string): "es" | "en" | "mixed" {
  const esCount = (text.match(/\b(el|la|los|las|de|que|en|un|una|es|por|con|del|al|se)\b/gi) ?? []).length;
  const enCount = (text.match(/\b(the|is|are|of|and|to|in|for|with|that|this|have)\b/gi) ?? []).length;
  if (esCount > enCount * 1.5) return "es";
  if (enCount > esCount * 1.5) return "en";
  return "mixed";
}

function isList(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim());
  return (
    lines.length >= 2 &&
    lines.filter((l) => /^[\s]*[-*\u2022]\s|^[\s]*\d+\.\s/.test(l)).length >= lines.length * 0.6
  );
}

function isTable(text: string): boolean {
  return /^\|.+\|/m.test(text) && (text.match(/\|/g) ?? []).length >= 4;
}

// ─── Special block extraction ─────────────────────────────────────────────────

interface SpecialBlock {
  type: "code" | "table";
  content: string;
  startIndex: number;
  endIndex: number;
}

function extractSpecialBlocks(text: string): SpecialBlock[] {
  const blocks: SpecialBlock[] = [];

  // Fenced code blocks
  const codeFenced = /```[\s\S]*?```/g;
  let m: RegExpExecArray | null;
  while ((m = codeFenced.exec(text)) !== null) {
    blocks.push({ type: "code", content: m[0], startIndex: m.index, endIndex: m.index + m[0].length });
  }

  // Markdown tables
  const tableRe = /(?:^\|.+\|\s*\n){2,}/gm;
  while ((m = tableRe.exec(text)) !== null) {
    if (!blocks.some((b) => m!.index >= b.startIndex && m!.index < b.endIndex)) {
      blocks.push({ type: "table", content: m[0].trim(), startIndex: m.index, endIndex: m.index + m[0].length });
    }
  }

  return blocks.sort((a, b) => a.startIndex - b.startIndex);
}

// ─── SemanticChunker ──────────────────────────────────────────────────────────

export class SemanticChunker implements ChunkStage {
  private readonly config: SemanticChunkerConfig;

  constructor(config: Partial<SemanticChunkerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async chunk(text: string, options: Record<string, unknown> = {}): Promise<PipelineChunk[]> {
    const sourceFile = String(options.sourceFile ?? "");
    const pageInfo = options.pageInfo as Map<number, { start: number; end: number }> | undefined;
    const specialBlocks = extractSpecialBlocks(text);
    const chunks: PipelineChunk[] = [];
    let chunkIndex = 0;
    let cursor = 0;
    let previousSentences: string[] = [];

    // Build segments: alternating plain text / special blocks
    const segments: Array<{ text: string; startOffset: number; isSpecial: boolean; blockType?: "code" | "table" }> = [];
    for (const block of specialBlocks) {
      if (block.startIndex > cursor) {
        segments.push({ text: text.slice(cursor, block.startIndex), startOffset: cursor, isSpecial: false });
      }
      segments.push({ text: block.content, startOffset: block.startIndex, isSpecial: true, blockType: block.type });
      cursor = block.endIndex;
    }
    if (cursor < text.length) {
      segments.push({ text: text.slice(cursor), startOffset: cursor, isSpecial: false });
    }

    for (const seg of segments) {
      if (seg.isSpecial && seg.blockType) {
        if (seg.text.length >= this.config.minSize) {
          chunks.push({
            id: generateChunkId(seg.text, chunkIndex),
            content: seg.text,
            chunkIndex: chunkIndex++,
            metadata: this.buildMeta(seg.text, seg.startOffset, seg.startOffset + seg.text.length, sourceFile, pageInfo, seg.blockType === "code" ? "code" : "table"),
          });
        }
        previousSentences = [];
        continue;
      }

      const textChunks = this.chunkPlainText(seg.text, seg.startOffset, sourceFile, pageInfo, previousSentences, chunkIndex);
      chunks.push(...textChunks);
      chunkIndex += textChunks.length;
      previousSentences = splitSentences(seg.text).slice(-this.config.overlapSentences);
    }

    const result = this.config.useSemanticBoundaries && chunks.length > 2
      ? await this.refineBySimilarity(chunks)
      : chunks;

    logger.debug("Chunking complete", { sourceFile, chunks: result.length, inputLen: text.length });
    return result;
  }

  private chunkPlainText(
    text: string,
    baseOffset: number,
    sourceFile: string,
    pageInfo: Map<number, { start: number; end: number }> | undefined,
    overlapSentences: string[],
    startIdx: number
  ): PipelineChunk[] {
    const chunks: PipelineChunk[] = [];
    const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
    let currentParts: string[] = [...overlapSentences];
    let currentStart = baseOffset;
    let offset = baseOffset;
    let idx = startIdx;

    const flush = (endOffset: number) => {
      const content = currentParts.join(" ").trim();
      if (content.length < this.config.minSize) return;
      chunks.push({
        id: generateChunkId(content, idx),
        content,
        chunkIndex: idx++,
        metadata: this.buildMeta(content, currentStart, endOffset, sourceFile, pageInfo),
      });
      const sentences = splitSentences(content);
      currentParts = sentences.slice(-this.config.overlapSentences);
      currentStart = endOffset;
    };

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;

      if (isList(trimmed) && trimmed.length <= this.config.maxSize) {
        if (currentParts.join(" ").trim().length > 0) flush(offset);
        chunks.push({
          id: generateChunkId(trimmed, idx),
          content: trimmed,
          chunkIndex: idx++,
          metadata: this.buildMeta(trimmed, offset, offset + trimmed.length, sourceFile, pageInfo, "list"),
        });
        currentParts = [];
        currentStart = offset + trimmed.length + 2;
        offset += trimmed.length + 2;
        continue;
      }

      const projected = [...currentParts, trimmed].join(" ").length;
      if (projected > this.config.maxSize && currentParts.join(" ").length >= this.config.minSize) {
        flush(offset);
      }

      if (trimmed.length > this.config.maxSize) {
        for (const sentence of splitSentences(trimmed)) {
          if ([...currentParts, sentence].join(" ").length > this.config.maxSize && currentParts.length > 0) {
            flush(offset);
          }
          currentParts.push(sentence);
        }
      } else {
        currentParts.push(trimmed);
      }
      offset += trimmed.length + 2;
    }

    if (currentParts.join(" ").trim().length >= this.config.minSize) flush(offset);
    return chunks;
  }

  private async refineBySimilarity(chunks: PipelineChunk[]): Promise<PipelineChunk[]> {
    try {
      const { generateEmbeddingsBatch } = await import("../../services/ragPipeline");
      const embeddings = await generateEmbeddingsBatch(chunks.map((c) => c.content.slice(0, 512)));
      const refined: PipelineChunk[] = [{ ...chunks[0], embedding: embeddings[0] }];

      for (let i = 1; i < chunks.length; i++) {
        const sim = cosineSimilarity(embeddings[i - 1], embeddings[i]);
        const prev = refined[refined.length - 1];

        if (
          sim >= this.config.similarityThreshold &&
          prev.content.length + chunks[i].content.length <= this.config.maxSize
        ) {
          refined[refined.length - 1] = {
            ...prev,
            content: `${prev.content}\n\n${chunks[i].content}`,
            embedding: embeddings[i],
            metadata: { ...prev.metadata, endOffset: chunks[i].metadata.endOffset },
          };
        } else {
          refined.push({ ...chunks[i], embedding: embeddings[i] });
        }
      }
      return refined;
    } catch (err) {
      logger.warn("Semantic refinement skipped", { error: String(err) });
      return chunks;
    }
  }

  private buildMeta(
    content: string,
    startOffset: number,
    endOffset: number,
    sourceFile: string,
    pageInfo: Map<number, { start: number; end: number }> | undefined,
    overrideType?: ChunkType
  ): ChunkMetadata {
    return {
      sourceFile,
      pageNumber: this.resolvePageNumber(startOffset, pageInfo),
      sectionTitle: extractSectionTitle(content),
      sectionType: detectSectionType(content),
      chunkType: overrideType ?? detectChunkType(content),
      startOffset,
      endOffset,
      hasTable: isTable(content),
      hasFigure: /\[?(figure|figura|image|imagen|chart|gr[aá]fico)\s*\d*\]?/i.test(content),
      language: detectLanguage(content),
    };
  }

  private resolvePageNumber(
    offset: number,
    pageInfo: Map<number, { start: number; end: number }> | undefined
  ): number | undefined {
    if (!pageInfo) return undefined;
    for (const [page, range] of pageInfo) {
      if (offset >= range.start && offset < range.end) return page;
    }
    return undefined;
  }
}
