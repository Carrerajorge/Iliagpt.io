/**
 * Context-Aware Chunker
 *
 * Unlike basic text chunking, this chunker:
 *   1. Propagates heading breadcrumbs into every chunk
 *   2. Carries table headers into table-data chunks
 *   3. Keeps code blocks intact
 *   4. Respects section boundaries (never splits mid-section if possible)
 *   5. Adds overlap with context prefix (parent heading + previous chunk summary)
 *   6. Produces metadata-rich chunks ready for embedding + retrieval
 *
 * Input: LayoutAwareDocument (from layoutAwareParser)
 * Output: ContextualChunk[] (ready for embedding and storage)
 */

import crypto from 'crypto';
import { withSpan } from '../../lib/tracing';
import type { LayoutAwareDocument, DocumentSection, DocumentTable } from './layoutAwareParser';

// ============================================================================
// Types
// ============================================================================

export interface ContextualChunk {
  /** Unique chunk ID (deterministic hash of content + position) */
  id: string;
  /** The actual chunk content for embedding */
  content: string;
  /** Context prefix prepended during retrieval (NOT embedded, but added for LLM context) */
  contextPrefix: string;
  /** Full content including prefix (for display/LLM consumption) */
  fullContent: string;
  /** Source document info */
  source: {
    fileId?: string;
    fileName: string;
    fileType: string;
    pageNumber?: number;
    sectionId?: string;
    sectionTitle?: string;
  };
  /** Hierarchical breadcrumb path */
  breadcrumb: string[];
  /** Chunk position in document */
  position: {
    /** 0-1 normalized position within document */
    documentPosition: number;
    /** Sequential chunk index */
    chunkIndex: number;
    /** Total chunks in document */
    totalChunks: number;
  };
  /** Chunk metadata */
  metadata: {
    chunkType: 'heading' | 'paragraph' | 'table' | 'list' | 'code' | 'mixed';
    wordCount: number;
    tokenEstimate: number;
    hasNumbers: boolean;
    hasDates: boolean;
    hasEntities: boolean;
    /** Table info if this chunk contains table data */
    tableInfo?: {
      tableId: string;
      headers: string[];
      rowRange: [number, number]; // [startRow, endRow]
      columnTypes: string[];
    };
    /** Semantic density (0-1) - higher means more information-dense */
    semanticDensity: number;
    /** Language */
    language: string;
  };
}

export interface ChunkingOptions {
  /** Target chunk size in tokens (default: 512) */
  targetTokens?: number;
  /** Maximum chunk size in tokens (default: 1024) */
  maxTokens?: number;
  /** Minimum chunk size in tokens (default: 50) */
  minTokens?: number;
  /** Number of overlap tokens between chunks (default: 64) */
  overlapTokens?: number;
  /** Whether to include context prefix (default: true) */
  includeContextPrefix?: boolean;
  /** Max rows per table chunk (default: 20) */
  maxTableRowsPerChunk?: number;
}

// ============================================================================
// Token Estimation
// ============================================================================

function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters for English, 3 for Spanish
  return Math.ceil(text.length / 3.5);
}

// ============================================================================
// Context Prefix Builder
// ============================================================================

function buildContextPrefix(breadcrumb: string[], tableHeaders?: string[]): string {
  const parts: string[] = [];

  if (breadcrumb.length > 0) {
    parts.push(`[Sección: ${breadcrumb.join(' > ')}]`);
  }

  if (tableHeaders && tableHeaders.length > 0) {
    parts.push(`[Tabla: ${tableHeaders.join(' | ')}]`);
  }

  return parts.length > 0 ? parts.join(' ') + '\n' : '';
}

// ============================================================================
// Semantic Density Calculator
// ============================================================================

function calculateSemanticDensity(text: string): number {
  const words = text.split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return 0;

  const uniqueWords = new Set(words.map(w => w.toLowerCase()));
  const lexicalDiversity = uniqueWords.size / words.length;

  // Count information-bearing elements
  const numbers = (text.match(/\d+(?:\.\d+)?/g) || []).length;
  const entities = (text.match(/[A-ZÁÉÍÓÚ][a-záéíóú]+(?:\s+[A-ZÁÉÍÓÚ][a-záéíóú]+)*/g) || []).length;
  const technicalTerms = (text.match(/\b[a-z]+(?:tion|ment|ity|ness|ance|ence|ism|ist|ción|miento|dad|ncia)\b/gi) || []).length;

  const infoRate = (numbers + entities + technicalTerms) / words.length;
  return Math.min(1, lexicalDiversity * 0.4 + infoRate * 0.6);
}

// ============================================================================
// Chunk ID Generator
// ============================================================================

function generateChunkId(content: string, position: number, fileId?: string): string {
  const hash = crypto.createHash('sha256')
    .update(`${fileId || ''}:${position}:${content.slice(0, 200)}`)
    .digest('hex')
    .slice(0, 16);
  return `chunk-${hash}`;
}

// ============================================================================
// Section Chunker (respects section boundaries)
// ============================================================================

function chunkSection(
  section: DocumentSection,
  options: Required<ChunkingOptions>,
  documentMeta: { fileId?: string; fileName: string; fileType: string; language: string },
): ContextualChunk[] {
  const chunks: ContextualChunk[] = [];
  const tokens = estimateTokens(section.content);

  if (tokens <= options.maxTokens) {
    // Section fits in one chunk
    const contextPrefix = options.includeContextPrefix
      ? buildContextPrefix(section.breadcrumb)
      : '';

    chunks.push({
      id: '', // Will be set later
      content: section.content,
      contextPrefix,
      fullContent: contextPrefix + section.content,
      source: {
        fileId: documentMeta.fileId,
        fileName: documentMeta.fileName,
        fileType: documentMeta.fileType,
        pageNumber: section.pageNumber,
        sectionId: section.id,
        sectionTitle: section.title || undefined,
      },
      breadcrumb: section.breadcrumb,
      position: { documentPosition: 0, chunkIndex: 0, totalChunks: 0 },
      metadata: {
        chunkType: section.type === 'heading' ? 'heading' : section.type as any || 'paragraph',
        wordCount: section.content.split(/\s+/).length,
        tokenEstimate: tokens,
        hasNumbers: section.metadata.hasNumbers,
        hasDates: section.metadata.hasDates,
        hasEntities: section.metadata.hasEntities,
        semanticDensity: calculateSemanticDensity(section.content),
        language: documentMeta.language,
      },
    });
  } else {
    // Need to split section into multiple chunks
    const sentences = section.content.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [section.content];
    let currentChunkSentences: string[] = [];
    let currentTokens = 0;

    for (const sentence of sentences) {
      const sentTokens = estimateTokens(sentence);

      if (currentTokens + sentTokens > options.targetTokens && currentChunkSentences.length > 0) {
        // Emit current chunk
        const chunkContent = currentChunkSentences.join(' ').trim();
        const contextPrefix = options.includeContextPrefix
          ? buildContextPrefix(section.breadcrumb)
          : '';

        chunks.push({
          id: '',
          content: chunkContent,
          contextPrefix,
          fullContent: contextPrefix + chunkContent,
          source: {
            fileId: documentMeta.fileId,
            fileName: documentMeta.fileName,
            fileType: documentMeta.fileType,
            pageNumber: section.pageNumber,
            sectionId: section.id,
            sectionTitle: section.title || undefined,
          },
          breadcrumb: section.breadcrumb,
          position: { documentPosition: 0, chunkIndex: 0, totalChunks: 0 },
          metadata: {
            chunkType: section.type as any || 'paragraph',
            wordCount: chunkContent.split(/\s+/).length,
            tokenEstimate: estimateTokens(chunkContent),
            hasNumbers: /\d{2,}/.test(chunkContent),
            hasDates: /\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}/.test(chunkContent),
            hasEntities: /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/.test(chunkContent),
            semanticDensity: calculateSemanticDensity(chunkContent),
            language: documentMeta.language,
          },
        });

        // Overlap: keep last few sentences
        const overlapSentences = Math.max(1, Math.floor(options.overlapTokens / 20));
        currentChunkSentences = currentChunkSentences.slice(-overlapSentences);
        currentTokens = currentChunkSentences.reduce((s, sent) => s + estimateTokens(sent), 0);
      }

      currentChunkSentences.push(sentence);
      currentTokens += sentTokens;
    }

    // Flush remaining
    if (currentChunkSentences.length > 0) {
      const chunkContent = currentChunkSentences.join(' ').trim();
      if (estimateTokens(chunkContent) >= options.minTokens || chunks.length === 0) {
        const contextPrefix = options.includeContextPrefix
          ? buildContextPrefix(section.breadcrumb)
          : '';
        chunks.push({
          id: '',
          content: chunkContent,
          contextPrefix,
          fullContent: contextPrefix + chunkContent,
          source: {
            fileId: documentMeta.fileId,
            fileName: documentMeta.fileName,
            fileType: documentMeta.fileType,
            pageNumber: section.pageNumber,
            sectionId: section.id,
            sectionTitle: section.title || undefined,
          },
          breadcrumb: section.breadcrumb,
          position: { documentPosition: 0, chunkIndex: 0, totalChunks: 0 },
          metadata: {
            chunkType: section.type as any || 'paragraph',
            wordCount: chunkContent.split(/\s+/).length,
            tokenEstimate: estimateTokens(chunkContent),
            hasNumbers: /\d{2,}/.test(chunkContent),
            hasDates: /\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}/.test(chunkContent),
            hasEntities: /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/.test(chunkContent),
            semanticDensity: calculateSemanticDensity(chunkContent),
            language: documentMeta.language,
          },
        });
      } else if (chunks.length > 0) {
        // Merge with previous chunk if too small
        const prev = chunks[chunks.length - 1];
        prev.content += ' ' + chunkContent;
        prev.fullContent = prev.contextPrefix + prev.content;
        prev.metadata.wordCount = prev.content.split(/\s+/).length;
        prev.metadata.tokenEstimate = estimateTokens(prev.content);
      }
    }
  }

  return chunks;
}

// ============================================================================
// Table Chunker (propagates headers)
// ============================================================================

function chunkTable(
  table: DocumentTable,
  parentBreadcrumb: string[],
  options: Required<ChunkingOptions>,
  documentMeta: { fileId?: string; fileName: string; fileType: string; language: string },
): ContextualChunk[] {
  const chunks: ContextualChunk[] = [];
  const maxRows = options.maxTableRowsPerChunk;

  for (let startRow = 0; startRow < table.rows.length; startRow += maxRows) {
    const endRow = Math.min(startRow + maxRows, table.rows.length);
    const rowSlice = table.rows.slice(startRow, endRow);

    // Build table chunk with headers always present
    const headerLine = table.headers.join(' | ');
    const separator = table.headers.map(() => '---').join(' | ');
    const dataLines = rowSlice.map(r => r.join(' | '));
    const tableContent = [headerLine, separator, ...dataLines].join('\n');

    const contextPrefix = options.includeContextPrefix
      ? buildContextPrefix(parentBreadcrumb, table.headers)
      : '';

    chunks.push({
      id: '',
      content: tableContent,
      contextPrefix,
      fullContent: contextPrefix + tableContent,
      source: {
        fileId: documentMeta.fileId,
        fileName: documentMeta.fileName,
        fileType: documentMeta.fileType,
        pageNumber: table.pageNumber,
        sectionId: table.parentSectionId,
        sectionTitle: table.caption,
      },
      breadcrumb: [...parentBreadcrumb, table.caption || `Tabla ${table.id}`],
      position: { documentPosition: 0, chunkIndex: 0, totalChunks: 0 },
      metadata: {
        chunkType: 'table',
        wordCount: tableContent.split(/\s+/).length,
        tokenEstimate: estimateTokens(tableContent),
        hasNumbers: true,
        hasDates: rowSlice.some(r => r.some(c => /\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}/.test(c))),
        hasEntities: false,
        tableInfo: {
          tableId: table.id,
          headers: table.headers,
          rowRange: [startRow, endRow],
          columnTypes: table.columnTypes,
        },
        semanticDensity: calculateSemanticDensity(tableContent),
        language: documentMeta.language,
      },
    });
  }

  return chunks;
}

// ============================================================================
// Main Chunking Function
// ============================================================================

/**
 * Chunk a layout-aware document into context-rich chunks ready for embedding.
 */
export async function chunkDocument(
  doc: LayoutAwareDocument,
  options: ChunkingOptions = {},
): Promise<ContextualChunk[]> {
  return withSpan('chunker.chunk_document', async (span) => {
    const opts: Required<ChunkingOptions> = {
      targetTokens: options.targetTokens ?? 512,
      maxTokens: options.maxTokens ?? 1024,
      minTokens: options.minTokens ?? 50,
      overlapTokens: options.overlapTokens ?? 64,
      includeContextPrefix: options.includeContextPrefix ?? true,
      maxTableRowsPerChunk: options.maxTableRowsPerChunk ?? 20,
    };

    span.setAttribute('chunker.file_name', doc.metadata.fileName);
    span.setAttribute('chunker.target_tokens', opts.targetTokens);
    span.setAttribute('chunker.section_count', doc.sections.length);
    span.setAttribute('chunker.table_count', doc.tables.length);

    const documentMeta = {
      fileId: doc.metadata.fileId,
      fileName: doc.metadata.fileName,
      fileType: doc.metadata.fileType,
      language: doc.metadata.language,
    };

    const allChunks: ContextualChunk[] = [];

    // 1. Process sections
    const processedTableSections = new Set<string>();

    for (const section of doc.sections) {
      if (section.type === 'table') {
        processedTableSections.add(section.id);
        continue; // Tables handled separately
      }

      if (section.type === 'heading' && section.content.length < 100) {
        // Include short headings as context prefix for next chunk, not standalone
        continue;
      }

      const sectionChunks = chunkSection(section, opts, documentMeta);
      allChunks.push(...sectionChunks);
    }

    // 2. Process tables with header propagation
    for (const table of doc.tables) {
      // Find parent section breadcrumb
      const parentSection = doc.sections.find(s => s.id === table.parentSectionId);
      const breadcrumb = parentSection?.breadcrumb || [];

      const tableChunks = chunkTable(table, breadcrumb, opts, documentMeta);
      allChunks.push(...tableChunks);
    }

    // 3. Assign IDs and positions
    for (let i = 0; i < allChunks.length; i++) {
      const chunk = allChunks[i];
      chunk.id = generateChunkId(chunk.content, i, documentMeta.fileId);
      chunk.position = {
        documentPosition: allChunks.length > 1 ? i / (allChunks.length - 1) : 0,
        chunkIndex: i,
        totalChunks: allChunks.length,
      };
    }

    span.setAttribute('chunker.total_chunks', allChunks.length);
    span.setAttribute('chunker.avg_tokens', allChunks.length > 0
      ? Math.round(allChunks.reduce((s, c) => s + c.metadata.tokenEstimate, 0) / allChunks.length)
      : 0);

    return allChunks;
  });
}

/**
 * Chunk multiple documents and merge results with cross-document deduplication.
 */
export async function chunkDocuments(
  docs: LayoutAwareDocument[],
  options: ChunkingOptions = {},
): Promise<ContextualChunk[]> {
  const allChunks: ContextualChunk[] = [];
  const seenHashes = new Set<string>();

  for (const doc of docs) {
    const docChunks = await chunkDocument(doc, options);
    for (const chunk of docChunks) {
      const hash = crypto.createHash('md5').update(chunk.content).digest('hex');
      if (!seenHashes.has(hash)) {
        seenHashes.add(hash);
        allChunks.push(chunk);
      }
    }
  }

  return allChunks;
}

export const contextAwareChunker = {
  chunkDocument,
  chunkDocuments,
  estimateTokens,
  calculateSemanticDensity,
};
