import { randomUUID } from 'crypto';
import { Logger } from '../../lib/logger';
import type { ChunkStage, ProcessedDocument, Chunk } from '../UnifiedRAGPipeline';

// ─── Configuration ───────────────────────────────────────────────────────────

export interface SemanticChunkerConfig {
  targetTokens: number;
  maxTokens: number;
  minTokens: number;
  overlapTokens: number;
  topicShiftThreshold: number;
  preserveCodeBlocks: boolean;
  preserveTables: boolean;
  language: 'auto' | 'en' | 'es';
}

export const DEFAULT_SEMANTIC_CHUNKER_CONFIG: SemanticChunkerConfig = {
  targetTokens: 800,
  maxTokens: 1200,
  minTokens: 100,
  overlapTokens: 150,
  topicShiftThreshold: 0.3,
  preserveCodeBlocks: true,
  preserveTables: true,
  language: 'auto',
};

// ─── Internal types ──────────────────────────────────────────────────────────

export interface SplitPoint {
  index: number;
  type: 'heading' | 'paragraph' | 'topic_shift' | 'table' | 'code_block';
  confidence: number;
}

interface ProtectedRegion {
  start: number;
  end: number;
  type: 'code_block' | 'table';
  content: string;
}

// ─── SemanticChunker ─────────────────────────────────────────────────────────

export class SemanticChunker implements ChunkStage {
  private readonly _cfg: SemanticChunkerConfig;

  constructor(config?: Partial<SemanticChunkerConfig>) {
    this._cfg = { ...DEFAULT_SEMANTIC_CHUNKER_CONFIG, ...config };
  }

  // ── Public entry point ────────────────────────────────────────────────────

  async chunk(doc: ProcessedDocument): Promise<Chunk[]> {
    const text = doc.cleanedContent;
    if (!text.trim()) return [];

    const lang =
      this._cfg.language === 'auto' ? doc.detectedLanguage : this._cfg.language;

    Logger.debug('SemanticChunker.chunk start', {
      docId: doc.id,
      length: text.length,
      lang,
    });

    // Extract protected regions before splitting
    const codeBlocks = this._cfg.preserveCodeBlocks
      ? this._extractCodeBlocks(text)
      : [];
    const tables = this._cfg.preserveTables ? this._extractTables(text) : [];
    const protectedRegions: ProtectedRegion[] = [
      ...codeBlocks.map((b) => ({
        start: b.start,
        end: b.end,
        type: 'code_block' as const,
        content: b.content,
      })),
      ...tables.map((t) => ({
        start: t.start,
        end: t.end,
        type: 'table' as const,
        content: text.slice(t.start, t.end),
      })),
    ].sort((a, b) => a.start - b.start);

    // Detect structural split points
    const splitPoints = this._detectSplitPoints(text);

    // Detect topic shifts via sentence embeddings
    const sentences = this._splitSentences(text, lang);
    if (sentences.length > 3) {
      const shiftIndices = this._detectTopicShifts(sentences);
      let searchOffset = 0;
      for (let si = 0; si < sentences.length; si++) {
        const sentence = sentences[si];
        const charPos = text.indexOf(sentence, searchOffset);
        if (charPos !== -1 && shiftIndices.includes(si)) {
          const inProtected = protectedRegions.some(
            (r) => charPos >= r.start && charPos < r.end,
          );
          if (!inProtected) {
            splitPoints.push({
              index: charPos,
              type: 'topic_shift',
              confidence: 0.7,
            });
          }
          searchOffset = charPos + sentence.length;
        }
      }
    }

    // Build final chunks
    const chunks = this._buildChunks(text, splitPoints, doc.id, protectedRegions);

    Logger.debug('SemanticChunker.chunk complete', {
      docId: doc.id,
      chunksProduced: chunks.length,
    });

    return chunks;
  }

  // ── Split point detection ─────────────────────────────────────────────────

  private _detectSplitPoints(text: string): SplitPoint[] {
    const points: SplitPoint[] = [];
    const lines = text.split('\n');
    let charPos = 0;

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];

      // Markdown heading: # ... ######
      if (/^#{1,6}\s+\S/.test(line)) {
        points.push({ index: charPos, type: 'heading', confidence: 0.95 });
      } else if (
        // ALL CAPS line with 4+ words
        line.trim().length > 0 &&
        line === line.toUpperCase() &&
        line.trim().split(/\s+/).length >= 4
      ) {
        points.push({ index: charPos, type: 'heading', confidence: 0.75 });
      }

      // Paragraph break: blank line followed by non-blank
      if (
        line.trim() === '' &&
        li + 1 < lines.length &&
        lines[li + 1].trim() !== ''
      ) {
        points.push({ index: charPos, type: 'paragraph', confidence: 0.8 });
      }

      // Code block fence
      if (/^```/.test(line.trim())) {
        points.push({ index: charPos, type: 'code_block', confidence: 1.0 });
      }

      // Table separator row (markdown)
      if (/^\|[-|: ]+\|/.test(line.trim())) {
        const tableStart = charPos - (li > 0 ? lines[li - 1].length + 1 : 0);
        points.push({ index: Math.max(0, tableStart), type: 'table', confidence: 0.9 });
      }

      charPos += line.length + 1; // +1 for '\n'
    }

    // Deduplicate by index and sort
    const seen = new Set<number>();
    return points
      .filter((p) => {
        if (seen.has(p.index)) return false;
        seen.add(p.index);
        return true;
      })
      .sort((a, b) => a.index - b.index);
  }

  // ── Code block extraction ─────────────────────────────────────────────────

  private _extractCodeBlocks(
    text: string,
  ): Array<{ start: number; end: number; content: string }> {
    const blocks: Array<{ start: number; end: number; content: string }> = [];
    const regex = /```[\s\S]*?```/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      blocks.push({
        start: match.index,
        end: match.index + match[0].length,
        content: match[0],
      });
    }

    return blocks;
  }

  // ── Table extraction ──────────────────────────────────────────────────────

  private _extractTables(text: string): Array<{ start: number; end: number }> {
    const tables: Array<{ start: number; end: number }> = [];
    const lines = text.split('\n');
    let i = 0;

    while (i < lines.length) {
      if (/^\|[-|: ]+\|/.test(lines[i].trim())) {
        // Walk back to table header
        let startLine = i - 1;
        while (startLine > 0 && lines[startLine - 1].includes('|')) {
          startLine--;
        }
        // Walk forward to end of table
        let endLine = i + 1;
        while (endLine < lines.length && lines[endLine].includes('|')) {
          endLine++;
        }

        let startOffset = 0;
        for (let k = 0; k < startLine; k++) startOffset += lines[k].length + 1;
        let endOffset = 0;
        for (let k = 0; k < endLine; k++) endOffset += lines[k].length + 1;

        tables.push({ start: startOffset, end: endOffset });
        i = endLine;
        continue;
      }
      i++;
    }

    return tables;
  }

  // ── Sentence splitting ────────────────────────────────────────────────────

  private _splitSentences(text: string, language: string): string[] {
    // Remove code blocks to avoid splitting inside them
    const stripped = text.replace(/```[\s\S]*?```/g, '');
    let parts = stripped.split(/(?<=[.!?])[\s\n]+/);

    if (language === 'es') {
      const expanded: string[] = [];
      for (const part of parts) {
        expanded.push(...part.split(/(?<=¿|¡)/));
      }
      parts = expanded;
    }

    return parts.map((s) => s.trim()).filter(Boolean);
  }

  // ── Token estimation ──────────────────────────────────────────────────────

  private _estimateTokens(text: string): number {
    return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3);
  }

  // ── Chunk assembly ────────────────────────────────────────────────────────

  private _buildChunks(
    text: string,
    splitPoints: SplitPoint[],
    docId: string,
    protectedRegions: ProtectedRegion[],
  ): Chunk[] {
    const boundaries = [
      0,
      ...splitPoints.map((sp) => sp.index),
      text.length,
    ].sort((a, b) => a - b);

    const uniqueBoundaries = [...new Set(boundaries)];

    // Build raw segments between boundaries
    const rawSegments: Array<{ text: string; charStart: number }> = [];
    for (let i = 0; i < uniqueBoundaries.length - 1; i++) {
      const s = text.slice(uniqueBoundaries[i], uniqueBoundaries[i + 1]);
      if (s.trim()) rawSegments.push({ text: s, charStart: uniqueBoundaries[i] });
    }

    if (rawSegments.length === 0) {
      return [this._makeChunk(text, docId, 0)];
    }

    const chunks: Chunk[] = [];
    let buffer = '';
    let bufferTokens = 0;
    let chunkIdx = 0;

    const flushBuffer = () => {
      if (buffer.trim()) {
        const tokens = this._estimateTokens(buffer);
        if (tokens >= this._cfg.minTokens || chunks.length === 0) {
          chunks.push(this._makeChunk(buffer.trim(), docId, chunkIdx++));
          buffer = '';
          bufferTokens = 0;
        }
      }
    };

    for (const seg of rawSegments) {
      const segTokens = this._estimateTokens(seg.text);
      const inProtected = protectedRegions.some(
        (r) => seg.charStart >= r.start && seg.charStart + seg.text.length <= r.end,
      );

      if (inProtected) {
        flushBuffer();
        if (segTokens <= this._cfg.maxTokens) {
          chunks.push(this._makeChunk(seg.text.trim(), docId, chunkIdx++));
        } else {
          // Split oversized protected region by lines
          const lines = seg.text.split('\n');
          let sub = '';
          let subTok = 0;
          for (const line of lines) {
            const lt = this._estimateTokens(line);
            if (subTok + lt > this._cfg.maxTokens && sub.trim()) {
              chunks.push(this._makeChunk(sub.trim(), docId, chunkIdx++));
              sub = line + '\n';
              subTok = lt;
            } else {
              sub += line + '\n';
              subTok += lt;
            }
          }
          if (sub.trim()) chunks.push(this._makeChunk(sub.trim(), docId, chunkIdx++));
        }
        continue;
      }

      if (bufferTokens + segTokens > this._cfg.maxTokens && buffer.trim()) {
        flushBuffer();
      }

      buffer += seg.text;
      bufferTokens += segTokens;

      if (bufferTokens >= this._cfg.targetTokens) {
        flushBuffer();
      }
    }

    flushBuffer();

    // Add overlap: append first overlapTokens worth of next chunk to current
    if (this._cfg.overlapTokens > 0 && chunks.length > 1) {
      return chunks.map((chunk, i) => {
        if (i === chunks.length - 1) return chunk;
        const overlapWordCount = Math.ceil(this._cfg.overlapTokens / 1.3);
        const nextWords = chunks[i + 1].content.split(/\s+/).slice(0, overlapWordCount);
        const overlapSuffix = '\n\n[overlap] ' + nextWords.join(' ');
        const newContent = chunk.content + overlapSuffix;
        return {
          ...chunk,
          content: newContent,
          tokens: this._estimateTokens(newContent),
          metadata: { ...chunk.metadata, hasOverlap: true, overlapTokens: this._cfg.overlapTokens },
        };
      });
    }

    return chunks;
  }

  private _makeChunk(content: string, docId: string, index: number): Chunk {
    return {
      id: randomUUID(),
      documentId: docId,
      content,
      chunkIndex: index,
      metadata: {},
      tokens: this._estimateTokens(content),
    };
  }

  // ── Simple 64-dim hash embedding (no API call) ────────────────────────────

  private _computeSimpleEmbedding(text: string): number[] {
    const dims = 64;
    const vec = new Array<number>(dims).fill(0);
    const words = text.toLowerCase().split(/\W+/).filter(Boolean);

    for (const word of words) {
      let h = 2166136261;
      for (let i = 0; i < word.length; i++) {
        h ^= word.charCodeAt(i);
        h = (h * 16777619) >>> 0;
      }
      vec[h % dims] += 1;
    }

    // Bigram features
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = words[i] + '_' + words[i + 1];
      let h = 2166136261;
      for (let k = 0; k < bigram.length; k++) {
        h ^= bigram.charCodeAt(k);
        h = (h * 16777619) >>> 0;
      }
      vec[h % dims] += 0.5;
    }

    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }

  // ── Cosine similarity ─────────────────────────────────────────────────────

  private _cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  // ── Topic shift detection via sliding window ──────────────────────────────

  private _detectTopicShifts(sentences: string[]): number[] {
    if (sentences.length < 4) return [];

    const shiftIndices: number[] = [];
    const windowSize = 3;

    const windowEmbeddings: number[][] = [];
    for (let i = 0; i <= sentences.length - windowSize; i++) {
      const windowText = sentences.slice(i, i + windowSize).join(' ');
      windowEmbeddings.push(this._computeSimpleEmbedding(windowText));
    }

    for (let i = 1; i < windowEmbeddings.length; i++) {
      const similarity = this._cosineSimilarity(windowEmbeddings[i - 1], windowEmbeddings[i]);
      const cosineDistance = 1 - similarity;

      if (cosineDistance > this._cfg.topicShiftThreshold) {
        const shiftAt = i + Math.floor(windowSize / 2);
        if (shiftAt < sentences.length) {
          shiftIndices.push(shiftAt);
        }
      }
    }

    return [...new Set(shiftIndices)].sort((a, b) => a - b);
  }
}
