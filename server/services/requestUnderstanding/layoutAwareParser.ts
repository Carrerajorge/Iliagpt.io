/**
 * Layout-Aware Document Parser (2026-level)
 *
 * Parses documents while preserving hierarchical structure:
 *   - Heading hierarchy (H1 → H2 → H3)
 *   - Table structure (headers, rows, column alignment)
 *   - List nesting
 *   - Section boundaries
 *   - Page breaks
 *   - Figure/image references
 *
 * This is a SIGNIFICANT upgrade over the basic text extraction in documentIngestion.ts.
 * Instead of flat text, we produce a structured LayoutAwareDocument that downstream
 * consumers (chunker, RAG, brief builder) can use to maintain context.
 */

import mammoth from 'mammoth';
import { createRequire } from 'module';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import officeParser from 'officeparser';
import { withSpan } from '../../lib/tracing';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

// ============================================================================
// Types
// ============================================================================

export interface DocumentSection {
  /** Unique ID within document */
  id: string;
  /** Section type */
  type: 'heading' | 'paragraph' | 'table' | 'list' | 'code' | 'figure' | 'quote' | 'page_break' | 'footnote';
  /** Heading level (1-6) for headings, nesting level for lists */
  level: number;
  /** Section title (for headings) or caption (for figures/tables) */
  title: string;
  /** Full text content */
  content: string;
  /** Page number (if detectable) */
  pageNumber?: number;
  /** Parent section ID (for hierarchy) */
  parentId?: string;
  /** Breadcrumb path (e.g., ["Chapter 1", "Section 1.2", "Subsection 1.2.3"]) */
  breadcrumb: string[];
  /** Metadata */
  metadata: {
    wordCount: number;
    hasNumbers: boolean;
    hasDates: boolean;
    hasEntities: boolean;
    language?: string;
  };
}

export interface DocumentTable {
  /** Table ID */
  id: string;
  /** Table caption/title if any */
  caption?: string;
  /** Column headers */
  headers: string[];
  /** Data rows */
  rows: string[][];
  /** Page number */
  pageNumber?: number;
  /** Parent section ID */
  parentSectionId?: string;
  /** Column types (inferred) */
  columnTypes: Array<'text' | 'number' | 'date' | 'currency' | 'percentage' | 'mixed'>;
  /** Summary statistics for numeric columns */
  columnStats?: Array<{
    min?: number;
    max?: number;
    mean?: number;
    nonEmpty: number;
  }>;
}

export interface LayoutAwareDocument {
  /** Document metadata */
  metadata: {
    fileName: string;
    fileType: string;
    fileId?: string;
    fileSize: number;
    totalPages?: number;
    author?: string;
    createdDate?: string;
    modifiedDate?: string;
    title?: string;
    language: string;
  };
  /** Ordered list of sections preserving document structure */
  sections: DocumentSection[];
  /** Extracted tables with full structure */
  tables: DocumentTable[];
  /** Table of contents (auto-generated from headings) */
  tableOfContents: Array<{
    level: number;
    title: string;
    sectionId: string;
    pageNumber?: number;
  }>;
  /** Full plain text (for backward compatibility) */
  fullText: string;
  /** Processing stats */
  processingStats: {
    totalSections: number;
    totalTables: number;
    totalWords: number;
    totalPages: number;
    processingTimeMs: number;
  };
}

// ============================================================================
// Heading Detection
// ============================================================================

const HEADING_PATTERNS = [
  // Numbered: 1. / 1.1 / 1.1.1 / Chapter 1
  /^(\d+(?:\.\d+)*)\s+(.+)/,
  /^(?:capítulo|chapter|sección|section)\s+(\d+)[.:]\s*(.+)/i,
  // Roman numerals: I. / II. / III.
  /^([IVXLCDM]+)[.)]\s+(.+)/,
  // All-caps (likely heading)
  /^([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]{3,})$/,
  // Markdown-style
  /^(#{1,6})\s+(.+)/,
];

function detectHeadingLevel(line: string): { isHeading: boolean; level: number; title: string } {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 200) return { isHeading: false, level: 0, title: '' };

  // Markdown headings
  const mdMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
  if (mdMatch) {
    return { isHeading: true, level: mdMatch[1].length, title: mdMatch[2].trim() };
  }

  // Numbered headings (1. / 1.1 / 1.1.1)
  const numMatch = trimmed.match(/^(\d+(?:\.\d+)*)[.):]?\s+(.+)/);
  if (numMatch) {
    const depth = numMatch[1].split('.').length;
    if (depth <= 4 && numMatch[2].length < 150) {
      return { isHeading: true, level: depth, title: trimmed };
    }
  }

  // Chapter / Sección markers
  const chapterMatch = trimmed.match(/^(?:capítulo|chapter|sección|section|parte|part)\s+(\d+|[IVXLCDM]+)[.:)]\s*(.+)/i);
  if (chapterMatch) {
    return { isHeading: true, level: 1, title: trimmed };
  }

  // All-caps lines (short = heading)
  if (/^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s,.]{3,60}$/.test(trimmed) && !trimmed.includes('.') && trimmed.split(/\s+/).length <= 10) {
    return { isHeading: true, level: 2, title: trimmed };
  }

  return { isHeading: false, level: 0, title: '' };
}

// ============================================================================
// Table Detection in Text
// ============================================================================

function extractTablesFromText(lines: string[]): Array<{ startLine: number; endLine: number; headers: string[]; rows: string[][] }> {
  const tables: Array<{ startLine: number; endLine: number; headers: string[]; rows: string[][] }> = [];

  for (let i = 0; i < lines.length; i++) {
    // Detect markdown-style tables
    if (lines[i].includes('|') && i + 1 < lines.length && lines[i + 1]?.match(/^[\s|:-]+$/)) {
      const startLine = i;
      const headers = lines[i].split('|').map(h => h.trim()).filter(Boolean);
      const rows: string[][] = [];
      let j = i + 2; // Skip separator line
      while (j < lines.length && lines[j].includes('|')) {
        const row = lines[j].split('|').map(c => c.trim()).filter(Boolean);
        if (row.length > 0) rows.push(row);
        j++;
      }
      if (rows.length > 0) {
        tables.push({ startLine, endLine: j - 1, headers, rows });
        i = j - 1; // Skip processed lines
      }
    }

    // Detect tab-separated tables (at least 3 consecutive lines with tabs)
    if (lines[i].includes('\t') && lines[i].split('\t').length >= 2) {
      const startLine = i;
      const potentialRows: string[][] = [];
      let j = i;
      while (j < lines.length && lines[j].includes('\t') && lines[j].split('\t').length >= 2) {
        potentialRows.push(lines[j].split('\t').map(c => c.trim()));
        j++;
      }
      if (potentialRows.length >= 3) {
        tables.push({
          startLine,
          endLine: j - 1,
          headers: potentialRows[0],
          rows: potentialRows.slice(1),
        });
        i = j - 1;
      }
    }
  }

  return tables;
}

// ============================================================================
// Column Type Inference
// ============================================================================

function inferColumnType(values: string[]): 'text' | 'number' | 'date' | 'currency' | 'percentage' | 'mixed' {
  const nonEmpty = values.filter(v => v.trim() !== '');
  if (nonEmpty.length === 0) return 'text';

  let numCount = 0, dateCount = 0, currencyCount = 0, percentCount = 0;

  for (const val of nonEmpty) {
    if (/^\$?\s*[\d,.]+\s*$/.test(val) || /^[\d,.]+\s*(?:USD|EUR|ARS|MXN)$/i.test(val)) currencyCount++;
    else if (/^[\d,.]+\s*%$/.test(val)) percentCount++;
    else if (/^[\d,.]+$/.test(val.replace(/\s/g, ''))) numCount++;
    else if (/^\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}$/.test(val)) dateCount++;
  }

  const total = nonEmpty.length;
  if (currencyCount / total > 0.7) return 'currency';
  if (percentCount / total > 0.7) return 'percentage';
  if (numCount / total > 0.7) return 'number';
  if (dateCount / total > 0.7) return 'date';
  if ((numCount + currencyCount + percentCount + dateCount) / total > 0.5) return 'mixed';
  return 'text';
}

function computeColumnStats(rows: string[][], colIdx: number): { min?: number; max?: number; mean?: number; nonEmpty: number } {
  const values = rows.map(r => r[colIdx]).filter(v => v && v.trim() !== '');
  const numbers = values.map(v => parseFloat(v.replace(/[,$%\s]/g, ''))).filter(n => !isNaN(n));

  return {
    min: numbers.length > 0 ? Math.min(...numbers) : undefined,
    max: numbers.length > 0 ? Math.max(...numbers) : undefined,
    mean: numbers.length > 0 ? numbers.reduce((a, b) => a + b, 0) / numbers.length : undefined,
    nonEmpty: values.length,
  };
}

// ============================================================================
// Language Detection
// ============================================================================

function detectLanguage(text: string): string {
  const sample = text.slice(0, 2000).toLowerCase();
  const esWords = (sample.match(/\b(el|la|los|las|de|en|con|por|para|que|es|son|del|al|un|una|más|pero|como|este|esta|todo|ya|hay)\b/g) || []).length;
  const enWords = (sample.match(/\b(the|is|are|of|in|to|and|for|that|with|this|from|was|were|but|not|have|has|had|will)\b/g) || []).length;
  return esWords > enWords ? 'es' : 'en';
}

// ============================================================================
// PDF Parsing with Layout Awareness
// ============================================================================

async function parsePdfLayoutAware(buffer: Buffer, fileName: string): Promise<LayoutAwareDocument> {
  const pdfData = await pdfParse(buffer);
  const text = pdfData.text || '';
  const numPages = pdfData.numpages || 1;

  const sections: DocumentSection[] = [];
  const tables: DocumentTable[] = [];
  const toc: LayoutAwareDocument['tableOfContents'] = [];
  const breadcrumbStack: Array<{ level: number; title: string; id: string }> = [];
  let sectionCounter = 0;
  let tableCounter = 0;

  // Split by pages (form feeds)
  const pages = text.split(/\f/).filter(p => p.trim());
  const effectivePages = pages.length > 0 ? pages : [text];

  for (let pageIdx = 0; pageIdx < effectivePages.length; pageIdx++) {
    const pageText = effectivePages[pageIdx];
    const lines = pageText.split(/\r?\n/);
    const pageNumber = pageIdx + 1;

    // Extract tables from this page
    const pageTables = extractTablesFromText(lines);
    const tableLineRanges = new Set<number>();
    for (const t of pageTables) {
      for (let l = t.startLine; l <= t.endLine; l++) tableLineRanges.add(l);

      const tableId = `table-${++tableCounter}`;
      const columnTypes = t.headers.map((_, ci) => inferColumnType(t.rows.map(r => r[ci] || '')));

      tables.push({
        id: tableId,
        headers: t.headers,
        rows: t.rows,
        pageNumber,
        columnTypes,
        columnStats: t.headers.map((_, ci) => computeColumnStats(t.rows, ci)),
        parentSectionId: breadcrumbStack.length > 0 ? breadcrumbStack[breadcrumbStack.length - 1].id : undefined,
      });

      // Add table as a section too
      sections.push({
        id: `sec-${++sectionCounter}`,
        type: 'table',
        level: 0,
        title: `Tabla ${tableCounter}`,
        content: `[Tabla: ${t.headers.join(' | ')}]\n${t.rows.map(r => r.join(' | ')).join('\n')}`,
        pageNumber,
        breadcrumb: breadcrumbStack.map(b => b.title),
        metadata: {
          wordCount: t.rows.reduce((s, r) => s + r.join(' ').split(/\s+/).length, 0),
          hasNumbers: true,
          hasDates: false,
          hasEntities: false,
        },
      });
    }

    // Process non-table lines
    let currentParagraph: string[] = [];
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      if (tableLineRanges.has(lineIdx)) continue;

      const line = lines[lineIdx];
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        // Empty line = paragraph break
        if (currentParagraph.length > 0) {
          const paraText = currentParagraph.join('\n').trim();
          if (paraText) {
            sections.push({
              id: `sec-${++sectionCounter}`,
              type: 'paragraph',
              level: 0,
              title: '',
              content: paraText,
              pageNumber,
              parentId: breadcrumbStack.length > 0 ? breadcrumbStack[breadcrumbStack.length - 1].id : undefined,
              breadcrumb: breadcrumbStack.map(b => b.title),
              metadata: {
                wordCount: paraText.split(/\s+/).length,
                hasNumbers: /\d{2,}/.test(paraText),
                hasDates: /\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}/.test(paraText),
                hasEntities: /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/.test(paraText),
              },
            });
          }
          currentParagraph = [];
        }
        continue;
      }

      // Check if it's a heading
      const heading = detectHeadingLevel(trimmedLine);
      if (heading.isHeading) {
        // Flush pending paragraph
        if (currentParagraph.length > 0) {
          const paraText = currentParagraph.join('\n').trim();
          if (paraText) {
            sections.push({
              id: `sec-${++sectionCounter}`,
              type: 'paragraph',
              level: 0,
              title: '',
              content: paraText,
              pageNumber,
              parentId: breadcrumbStack.length > 0 ? breadcrumbStack[breadcrumbStack.length - 1].id : undefined,
              breadcrumb: breadcrumbStack.map(b => b.title),
              metadata: {
                wordCount: paraText.split(/\s+/).length,
                hasNumbers: /\d{2,}/.test(paraText),
                hasDates: /\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}/.test(paraText),
                hasEntities: /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/.test(paraText),
              },
            });
          }
          currentParagraph = [];
        }

        // Update breadcrumb stack
        while (breadcrumbStack.length > 0 && breadcrumbStack[breadcrumbStack.length - 1].level >= heading.level) {
          breadcrumbStack.pop();
        }

        const headingId = `sec-${++sectionCounter}`;
        breadcrumbStack.push({ level: heading.level, title: heading.title, id: headingId });

        sections.push({
          id: headingId,
          type: 'heading',
          level: heading.level,
          title: heading.title,
          content: heading.title,
          pageNumber,
          parentId: breadcrumbStack.length > 1 ? breadcrumbStack[breadcrumbStack.length - 2].id : undefined,
          breadcrumb: breadcrumbStack.map(b => b.title),
          metadata: {
            wordCount: heading.title.split(/\s+/).length,
            hasNumbers: false,
            hasDates: false,
            hasEntities: false,
          },
        });

        toc.push({
          level: heading.level,
          title: heading.title,
          sectionId: headingId,
          pageNumber,
        });
      } else if (/^[\s]*[-*•]\s/.test(line) || /^[\s]*\d+[.)]\s/.test(line)) {
        // List item
        if (currentParagraph.length > 0) {
          const paraText = currentParagraph.join('\n').trim();
          if (paraText) {
            sections.push({
              id: `sec-${++sectionCounter}`,
              type: 'paragraph',
              level: 0,
              title: '',
              content: paraText,
              pageNumber,
              parentId: breadcrumbStack.length > 0 ? breadcrumbStack[breadcrumbStack.length - 1].id : undefined,
              breadcrumb: breadcrumbStack.map(b => b.title),
              metadata: { wordCount: paraText.split(/\s+/).length, hasNumbers: false, hasDates: false, hasEntities: false },
            });
          }
          currentParagraph = [];
        }

        // Collect consecutive list items
        const listItems: string[] = [trimmedLine];
        while (lineIdx + 1 < lines.length && (/^[\s]*[-*•]\s/.test(lines[lineIdx + 1]) || /^[\s]*\d+[.)]\s/.test(lines[lineIdx + 1]))) {
          lineIdx++;
          listItems.push(lines[lineIdx].trim());
        }

        sections.push({
          id: `sec-${++sectionCounter}`,
          type: 'list',
          level: 0,
          title: '',
          content: listItems.join('\n'),
          pageNumber,
          parentId: breadcrumbStack.length > 0 ? breadcrumbStack[breadcrumbStack.length - 1].id : undefined,
          breadcrumb: breadcrumbStack.map(b => b.title),
          metadata: {
            wordCount: listItems.join(' ').split(/\s+/).length,
            hasNumbers: listItems.some(l => /\d{2,}/.test(l)),
            hasDates: false,
            hasEntities: false,
          },
        });
      } else {
        currentParagraph.push(trimmedLine);
      }
    }

    // Flush remaining paragraph
    if (currentParagraph.length > 0) {
      const paraText = currentParagraph.join('\n').trim();
      if (paraText) {
        sections.push({
          id: `sec-${++sectionCounter}`,
          type: 'paragraph',
          level: 0,
          title: '',
          content: paraText,
          pageNumber,
          parentId: breadcrumbStack.length > 0 ? breadcrumbStack[breadcrumbStack.length - 1].id : undefined,
          breadcrumb: breadcrumbStack.map(b => b.title),
          metadata: {
            wordCount: paraText.split(/\s+/).length,
            hasNumbers: /\d{2,}/.test(paraText),
            hasDates: /\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}/.test(paraText),
            hasEntities: /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/.test(paraText),
          },
        });
      }
    }
  }

  const fullText = sections.map(s => s.content).join('\n\n');
  const lang = detectLanguage(fullText);

  return {
    metadata: {
      fileName,
      fileType: 'pdf',
      fileSize: buffer.length,
      totalPages: numPages,
      author: pdfData.info?.Author || undefined,
      title: pdfData.info?.Title || undefined,
      language: lang,
    },
    sections,
    tables,
    tableOfContents: toc,
    fullText,
    processingStats: {
      totalSections: sections.length,
      totalTables: tables.length,
      totalWords: fullText.split(/\s+/).length,
      totalPages: numPages,
      processingTimeMs: 0,
    },
  };
}

// ============================================================================
// DOCX Parsing with Layout Awareness
// ============================================================================

async function parseDocxLayoutAware(buffer: Buffer, fileName: string): Promise<LayoutAwareDocument> {
  // Use mammoth with style mapping for better structure
  const result = await mammoth.convertToHtml({ buffer }, {
    styleMap: [
      "p[style-name='Heading 1'] => h1:fresh",
      "p[style-name='Heading 2'] => h2:fresh",
      "p[style-name='Heading 3'] => h3:fresh",
      "p[style-name='Heading 4'] => h4:fresh",
    ],
  });
  const html = result.value || '';

  // Also get raw text for fallback
  const rawResult = await mammoth.extractRawText({ buffer });
  const rawText = rawResult.value || '';

  const sections: DocumentSection[] = [];
  const tables: DocumentTable[] = [];
  const toc: LayoutAwareDocument['tableOfContents'] = [];
  const breadcrumbStack: Array<{ level: number; title: string; id: string }> = [];
  let sectionCounter = 0;
  let tableCounter = 0;

  // Parse HTML for structure
  const tagPattern = /<(h[1-6]|p|table|ul|ol|li|blockquote|pre|tr|td|th)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  // Simple HTML tag stripping
  const stripTags = (html: string) => html.replace(/<[^>]+>/g, '').trim();

  // Extract tables from HTML
  const tablePattern = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tablePattern.exec(html)) !== null) {
    const tableHtml = tableMatch[1];
    const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const rows: string[][] = [];
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowPattern.exec(tableHtml)) !== null) {
      const cellPattern = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
      const cells: string[] = [];
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellPattern.exec(rowMatch[1])) !== null) {
        cells.push(stripTags(cellMatch[1]));
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length >= 2) {
      const tid = `table-${++tableCounter}`;
      const columnTypes = rows[0].map((_, ci) => inferColumnType(rows.slice(1).map(r => r[ci] || '')));
      tables.push({
        id: tid,
        headers: rows[0],
        rows: rows.slice(1),
        columnTypes,
        columnStats: rows[0].map((_, ci) => computeColumnStats(rows.slice(1), ci)),
      });
    }
  }

  // Parse headings and paragraphs
  const headingPattern = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const elements: Array<{ type: string; level: number; content: string; index: number }> = [];

  while ((match = headingPattern.exec(html)) !== null) {
    elements.push({
      type: 'heading',
      level: parseInt(match[1]),
      content: stripTags(match[2]),
      index: match.index,
    });
  }

  // If no HTML headings found, fall back to raw text parsing
  if (elements.length === 0) {
    const lines = rawText.split(/\n/);
    for (const line of lines) {
      const heading = detectHeadingLevel(line.trim());
      if (heading.isHeading) {
        while (breadcrumbStack.length > 0 && breadcrumbStack[breadcrumbStack.length - 1].level >= heading.level) {
          breadcrumbStack.pop();
        }
        const headingId = `sec-${++sectionCounter}`;
        breadcrumbStack.push({ level: heading.level, title: heading.title, id: headingId });
        sections.push({
          id: headingId,
          type: 'heading',
          level: heading.level,
          title: heading.title,
          content: heading.title,
          breadcrumb: breadcrumbStack.map(b => b.title),
          metadata: { wordCount: heading.title.split(/\s+/).length, hasNumbers: false, hasDates: false, hasEntities: false },
        });
        toc.push({ level: heading.level, title: heading.title, sectionId: headingId });
      } else if (line.trim()) {
        sections.push({
          id: `sec-${++sectionCounter}`,
          type: 'paragraph',
          level: 0,
          title: '',
          content: line.trim(),
          parentId: breadcrumbStack.length > 0 ? breadcrumbStack[breadcrumbStack.length - 1].id : undefined,
          breadcrumb: breadcrumbStack.map(b => b.title),
          metadata: {
            wordCount: line.trim().split(/\s+/).length,
            hasNumbers: /\d{2,}/.test(line),
            hasDates: /\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}/.test(line),
            hasEntities: /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/.test(line),
          },
        });
      }
    }
  } else {
    // Use HTML-extracted headings
    for (const el of elements) {
      while (breadcrumbStack.length > 0 && breadcrumbStack[breadcrumbStack.length - 1].level >= el.level) {
        breadcrumbStack.pop();
      }
      const headingId = `sec-${++sectionCounter}`;
      breadcrumbStack.push({ level: el.level, title: el.content, id: headingId });
      sections.push({
        id: headingId,
        type: 'heading',
        level: el.level,
        title: el.content,
        content: el.content,
        breadcrumb: breadcrumbStack.map(b => b.title),
        metadata: { wordCount: el.content.split(/\s+/).length, hasNumbers: false, hasDates: false, hasEntities: false },
      });
      toc.push({ level: el.level, title: el.content, sectionId: headingId });
    }

    // Add paragraphs between headings from raw text
    const paragraphs = rawText.split(/\n{2,}/).filter(p => p.trim());
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed || sections.some(s => s.type === 'heading' && s.title === trimmed)) continue;
      sections.push({
        id: `sec-${++sectionCounter}`,
        type: 'paragraph',
        level: 0,
        title: '',
        content: trimmed,
        parentId: breadcrumbStack.length > 0 ? breadcrumbStack[breadcrumbStack.length - 1].id : undefined,
        breadcrumb: breadcrumbStack.map(b => b.title),
        metadata: {
          wordCount: trimmed.split(/\s+/).length,
          hasNumbers: /\d{2,}/.test(trimmed),
          hasDates: /\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}/.test(trimmed),
          hasEntities: /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/.test(trimmed),
        },
      });
    }
  }

  const fullText = rawText;
  const lang = detectLanguage(fullText);

  return {
    metadata: {
      fileName,
      fileType: 'docx',
      fileSize: buffer.length,
      language: lang,
    },
    sections,
    tables,
    tableOfContents: toc,
    fullText,
    processingStats: {
      totalSections: sections.length,
      totalTables: tables.length,
      totalWords: fullText.split(/\s+/).length,
      totalPages: 1,
      processingTimeMs: 0,
    },
  };
}

// ============================================================================
// Excel Parsing with Layout Awareness
// ============================================================================

async function parseExcelLayoutAware(buffer: Buffer, fileName: string, format: 'xlsx' | 'xls'): Promise<LayoutAwareDocument> {
  const sections: DocumentSection[] = [];
  const tables: DocumentTable[] = [];
  let sectionCounter = 0;
  let tableCounter = 0;

  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    workbook.eachSheet((worksheet, sheetIndex) => {
      const sheetId = `sec-${++sectionCounter}`;
      sections.push({
        id: sheetId,
        type: 'heading',
        level: 1,
        title: worksheet.name,
        content: `Hoja: ${worksheet.name}`,
        breadcrumb: [worksheet.name],
        metadata: { wordCount: 2, hasNumbers: false, hasDates: false, hasEntities: false },
      });

      const data: string[][] = [];
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        const cells: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          cells.push(cell.value !== null && cell.value !== undefined ? String(cell.value) : '');
        });
        data.push(cells);
      });

      if (data.length >= 2) {
        const tid = `table-${++tableCounter}`;
        const headers = data[0];
        const rows = data.slice(1);
        const columnTypes = headers.map((_, ci) => inferColumnType(rows.map(r => r[ci] || '')));

        tables.push({
          id: tid,
          caption: worksheet.name,
          headers,
          rows,
          columnTypes,
          columnStats: headers.map((_, ci) => computeColumnStats(rows, ci)),
          parentSectionId: sheetId,
        });

        sections.push({
          id: `sec-${++sectionCounter}`,
          type: 'table',
          level: 0,
          title: worksheet.name,
          content: `[Tabla: ${headers.join(' | ')}]\n${rows.slice(0, 5).map(r => r.join(' | ')).join('\n')}${rows.length > 5 ? `\n... (${rows.length - 5} filas más)` : ''}`,
          parentId: sheetId,
          breadcrumb: [worksheet.name],
          metadata: {
            wordCount: rows.reduce((s, r) => s + r.join(' ').split(/\s+/).length, 0),
            hasNumbers: true,
            hasDates: rows.some(r => r.some(c => /\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}/.test(c))),
            hasEntities: false,
          },
        });
      }
    });
  } else {
    // XLS format
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    for (const sheetName of workbook.SheetNames) {
      const sheetId = `sec-${++sectionCounter}`;
      sections.push({
        id: sheetId,
        type: 'heading',
        level: 1,
        title: sheetName,
        content: `Hoja: ${sheetName}`,
        breadcrumb: [sheetName],
        metadata: { wordCount: 2, hasNumbers: false, hasDates: false, hasEntities: false },
      });

      const worksheet = workbook.Sheets[sheetName];
      const data: string[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
      const cleanData = data.filter(row => row.some((cell: any) => String(cell).trim() !== ''));

      if (cleanData.length >= 2) {
        const tid = `table-${++tableCounter}`;
        const headers = cleanData[0].map(String);
        const rows = cleanData.slice(1).map(r => r.map(String));
        const columnTypes = headers.map((_, ci) => inferColumnType(rows.map(r => r[ci] || '')));

        tables.push({
          id: tid,
          caption: sheetName,
          headers,
          rows,
          columnTypes,
          columnStats: headers.map((_, ci) => computeColumnStats(rows, ci)),
          parentSectionId: sheetId,
        });
      }
    }
  }

  const fullText = sections.map(s => s.content).join('\n\n');
  return {
    metadata: {
      fileName,
      fileType: format,
      fileSize: buffer.length,
      language: detectLanguage(fullText),
    },
    sections,
    tables,
    tableOfContents: [],
    fullText,
    processingStats: {
      totalSections: sections.length,
      totalTables: tables.length,
      totalWords: fullText.split(/\s+/).length,
      totalPages: 1,
      processingTimeMs: 0,
    },
  };
}

// ============================================================================
// Generic Text / PPT / RTF Parsing
// ============================================================================

async function parseGenericLayoutAware(buffer: Buffer, fileName: string, fileType: string): Promise<LayoutAwareDocument> {
  let text = '';
  try {
    if (fileType === 'pptx' || fileType === 'ppt' || fileType === 'rtf') {
      text = await officeParser.parseOfficeAsync(buffer);
    } else {
      text = buffer.toString('utf-8');
    }
  } catch {
    text = buffer.toString('utf-8');
  }

  const lines = text.split(/\n/);
  const sections: DocumentSection[] = [];
  const breadcrumbStack: Array<{ level: number; title: string; id: string }> = [];
  let sectionCounter = 0;

  let currentPara: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentPara.length > 0) {
        const paraText = currentPara.join('\n').trim();
        sections.push({
          id: `sec-${++sectionCounter}`,
          type: 'paragraph',
          level: 0,
          title: '',
          content: paraText,
          parentId: breadcrumbStack.length > 0 ? breadcrumbStack[breadcrumbStack.length - 1].id : undefined,
          breadcrumb: breadcrumbStack.map(b => b.title),
          metadata: {
            wordCount: paraText.split(/\s+/).length,
            hasNumbers: /\d{2,}/.test(paraText),
            hasDates: false,
            hasEntities: false,
          },
        });
        currentPara = [];
      }
      continue;
    }

    const heading = detectHeadingLevel(trimmed);
    if (heading.isHeading) {
      if (currentPara.length > 0) {
        const paraText = currentPara.join('\n').trim();
        sections.push({
          id: `sec-${++sectionCounter}`,
          type: 'paragraph',
          level: 0,
          title: '',
          content: paraText,
          breadcrumb: breadcrumbStack.map(b => b.title),
          metadata: { wordCount: paraText.split(/\s+/).length, hasNumbers: false, hasDates: false, hasEntities: false },
        });
        currentPara = [];
      }

      while (breadcrumbStack.length > 0 && breadcrumbStack[breadcrumbStack.length - 1].level >= heading.level) {
        breadcrumbStack.pop();
      }
      const hid = `sec-${++sectionCounter}`;
      breadcrumbStack.push({ level: heading.level, title: heading.title, id: hid });
      sections.push({
        id: hid,
        type: 'heading',
        level: heading.level,
        title: heading.title,
        content: heading.title,
        breadcrumb: breadcrumbStack.map(b => b.title),
        metadata: { wordCount: heading.title.split(/\s+/).length, hasNumbers: false, hasDates: false, hasEntities: false },
      });
    } else {
      currentPara.push(trimmed);
    }
  }

  if (currentPara.length > 0) {
    const paraText = currentPara.join('\n').trim();
    sections.push({
      id: `sec-${++sectionCounter}`,
      type: 'paragraph',
      level: 0,
      title: '',
      content: paraText,
      breadcrumb: breadcrumbStack.map(b => b.title),
      metadata: { wordCount: paraText.split(/\s+/).length, hasNumbers: false, hasDates: false, hasEntities: false },
    });
  }

  const fullText = text;
  return {
    metadata: { fileName, fileType, fileSize: buffer.length, language: detectLanguage(fullText) },
    sections,
    tables: [],
    tableOfContents: sections.filter(s => s.type === 'heading').map(s => ({
      level: s.level,
      title: s.title,
      sectionId: s.id,
    })),
    fullText,
    processingStats: {
      totalSections: sections.length,
      totalTables: 0,
      totalWords: fullText.split(/\s+/).length,
      totalPages: 1,
      processingTimeMs: 0,
    },
  };
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Parse a document with full layout awareness, preserving hierarchy,
 * tables, headings, and structural metadata.
 */
export async function parseDocumentLayoutAware(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  fileId?: string,
): Promise<LayoutAwareDocument> {
  return withSpan('layout_parser.parse', async (span) => {
    span.setAttribute('parser.file_name', fileName);
    span.setAttribute('parser.mime_type', mimeType);
    span.setAttribute('parser.file_size', buffer.length);

    const startTime = Date.now();
    let doc: LayoutAwareDocument;

    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const effectiveType = ext || mimeType;

    if (effectiveType.includes('pdf') || mimeType === 'application/pdf') {
      doc = await parsePdfLayoutAware(buffer, fileName);
    } else if (effectiveType.includes('docx') || mimeType.includes('wordprocessingml')) {
      doc = await parseDocxLayoutAware(buffer, fileName);
    } else if (effectiveType === 'xlsx' || mimeType.includes('spreadsheetml')) {
      doc = await parseExcelLayoutAware(buffer, fileName, 'xlsx');
    } else if (effectiveType === 'xls' || mimeType === 'application/vnd.ms-excel') {
      doc = await parseExcelLayoutAware(buffer, fileName, 'xls');
    } else {
      doc = await parseGenericLayoutAware(buffer, fileName, effectiveType);
    }

    doc.metadata.fileId = fileId;
    doc.processingStats.processingTimeMs = Date.now() - startTime;

    span.setAttribute('parser.sections', doc.sections.length);
    span.setAttribute('parser.tables', doc.tables.length);
    span.setAttribute('parser.words', doc.processingStats.totalWords);
    span.setAttribute('parser.processing_time_ms', doc.processingStats.processingTimeMs);

    return doc;
  });
}

export const layoutAwareParser = {
  parseDocumentLayoutAware,
  detectHeadingLevel,
  extractTablesFromText,
  inferColumnType,
};
