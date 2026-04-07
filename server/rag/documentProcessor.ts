/**
 * Document Processor for RAG ingestion.
 *
 * Extracts text from PDF, DOCX, XLSX, PPTX, TXT, Markdown, CSV.
 * Splits into intelligent chunks respecting paragraph/sentence boundaries.
 * Attaches metadata (page number, section heading, source file) to each chunk.
 */

import crypto from "crypto";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DocumentInput {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export interface ExtractedText {
  content: string;
  pages?: Array<{ pageNumber: number; text: string }>;
  metadata: {
    filename: string;
    mimeType: string;
    wordCount: number;
    pageCount?: number;
    title?: string;
    language?: string;
  };
}

export interface DocumentChunk {
  id: string;
  content: string;
  index: number;
  metadata: {
    filename: string;
    mimeType: string;
    pageNumber?: number;
    sectionHeading?: string;
    chunkType: "paragraph" | "table" | "code" | "heading" | "mixed";
    startOffset: number;
    endOffset: number;
    wordCount: number;
    contentHash: string;
  };
}

export interface ChunkOptions {
  maxChunkSize?: number;     // Max characters per chunk (default 1500)
  minChunkSize?: number;     // Min characters per chunk (default 100)
  overlapSize?: number;      // Overlap between chunks (default 200)
  respectSentences?: boolean; // Don't split mid-sentence (default true)
}

// ---------------------------------------------------------------------------
// Text extraction by format
// ---------------------------------------------------------------------------

async function extractPDF(buffer: Buffer): Promise<ExtractedText> {
  const pdf = await import("pdf-parse").then(m => m.default ?? m).catch(() => null);
  if (!pdf) {
    // Fallback: try pdfkit or basic extraction
    return { content: "[PDF extraction requires pdf-parse package]", metadata: { filename: "", mimeType: "application/pdf", wordCount: 0 } };
  }
  const data = await pdf(buffer);
  const pages = data.text ? [{ pageNumber: 1, text: data.text }] : [];

  // Try to split by page markers if available
  if (data.text && data.numpages > 1) {
    // pdf-parse doesn't give per-page text easily, but we can estimate
    const avgPageLen = Math.ceil(data.text.length / data.numpages);
    const pageTexts: Array<{ pageNumber: number; text: string }> = [];
    for (let i = 0; i < data.numpages; i++) {
      const start = i * avgPageLen;
      const end = Math.min((i + 1) * avgPageLen, data.text.length);
      pageTexts.push({ pageNumber: i + 1, text: data.text.slice(start, end) });
    }
    return {
      content: data.text,
      pages: pageTexts,
      metadata: {
        filename: "",
        mimeType: "application/pdf",
        wordCount: data.text.split(/\s+/).length,
        pageCount: data.numpages,
        title: data.info?.Title || undefined,
      },
    };
  }

  return {
    content: data.text || "",
    pages,
    metadata: {
      filename: "",
      mimeType: "application/pdf",
      wordCount: (data.text || "").split(/\s+/).length,
      pageCount: data.numpages,
      title: data.info?.Title || undefined,
    },
  };
}

async function extractDOCX(buffer: Buffer): Promise<ExtractedText> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value || "";
    return {
      content: text,
      metadata: {
        filename: "",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        wordCount: text.split(/\s+/).length,
      },
    };
  } catch {
    // Fallback: try to read as zip and extract document.xml
    return { content: "[DOCX extraction failed]", metadata: { filename: "", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", wordCount: 0 } };
  }
}

async function extractXLSX(buffer: Buffer): Promise<ExtractedText> {
  try {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.default.Workbook();
    await workbook.xlsx.load(buffer);

    const parts: string[] = [];
    workbook.eachSheet((sheet) => {
      parts.push(`## Sheet: ${sheet.name}\n`);
      const rows: string[] = [];
      sheet.eachRow((row, rowNumber) => {
        const cells = (row.values as any[]).slice(1).map(v =>
          v === null || v === undefined ? "" : String(v)
        );
        if (rowNumber === 1) {
          rows.push(`| ${cells.join(" | ")} |`);
          rows.push(`| ${cells.map(() => "---").join(" | ")} |`);
        } else {
          rows.push(`| ${cells.join(" | ")} |`);
        }
      });
      parts.push(rows.join("\n"));
    });

    const text = parts.join("\n\n");
    return {
      content: text,
      metadata: {
        filename: "",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        wordCount: text.split(/\s+/).length,
      },
    };
  } catch {
    return { content: "[XLSX extraction failed]", metadata: { filename: "", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", wordCount: 0 } };
  }
}

async function extractPPTX(buffer: Buffer): Promise<ExtractedText> {
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);

    const slideTexts: string[] = [];
    const slideFiles = Object.keys(zip.files)
      .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => {
        const na = parseInt(a.match(/slide(\d+)/)?.[1] || "0");
        const nb = parseInt(b.match(/slide(\d+)/)?.[1] || "0");
        return na - nb;
      });

    for (const slideFile of slideFiles) {
      const xml = await zip.file(slideFile)!.async("string");
      // Extract text from XML tags
      const texts = xml.match(/<a:t>([^<]*)<\/a:t>/g)?.map(m =>
        m.replace(/<\/?a:t>/g, "")
      ) || [];
      const slideNum = slideFile.match(/slide(\d+)/)?.[1] || "?";
      if (texts.length > 0) {
        slideTexts.push(`## Slide ${slideNum}\n${texts.join("\n")}`);
      }
    }

    const text = slideTexts.join("\n\n");
    return {
      content: text,
      pages: slideTexts.map((t, i) => ({ pageNumber: i + 1, text: t })),
      metadata: {
        filename: "",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        wordCount: text.split(/\s+/).length,
        pageCount: slideTexts.length,
      },
    };
  } catch {
    return { content: "[PPTX extraction failed]", metadata: { filename: "", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", wordCount: 0 } };
  }
}

function extractText(buffer: Buffer): ExtractedText {
  const text = buffer.toString("utf-8");
  return {
    content: text,
    metadata: {
      filename: "",
      mimeType: "text/plain",
      wordCount: text.split(/\s+/).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Main extract function
// ---------------------------------------------------------------------------

export async function extractDocument(input: DocumentInput): Promise<ExtractedText> {
  const ext = path.extname(input.filename).toLowerCase();
  const mime = input.mimeType.toLowerCase();

  let result: ExtractedText;

  if (mime.includes("pdf") || ext === ".pdf") {
    result = await extractPDF(input.buffer);
  } else if (mime.includes("wordprocessing") || mime.includes("msword") || ext === ".docx" || ext === ".doc") {
    result = await extractDOCX(input.buffer);
  } else if (mime.includes("spreadsheet") || mime.includes("excel") || ext === ".xlsx" || ext === ".xls") {
    result = await extractXLSX(input.buffer);
  } else if (mime.includes("presentation") || mime.includes("powerpoint") || ext === ".pptx" || ext === ".ppt") {
    result = await extractPPTX(input.buffer);
  } else {
    // Text, Markdown, CSV, code files
    result = extractText(input.buffer);
  }

  result.metadata.filename = input.filename;
  return result;
}

// ---------------------------------------------------------------------------
// Intelligent chunking
// ---------------------------------------------------------------------------

const SENTENCE_END = /(?<=[.!?。！？])\s+/;
const PARAGRAPH_BREAK = /\n\s*\n/;
const HEADING_PATTERN = /^#{1,6}\s+.+$/m;

/**
 * Split text into intelligent chunks that respect:
 * - Paragraph boundaries
 * - Sentence boundaries (never cuts mid-sentence)
 * - Section headings (starts new chunk on heading)
 * - Tables (keeps tables together when possible)
 */
export function chunkDocument(
  extracted: ExtractedText,
  options: ChunkOptions = {},
): DocumentChunk[] {
  const {
    maxChunkSize = 1500,
    minChunkSize = 100,
    overlapSize = 200,
    respectSentences = true,
  } = options;

  const text = extracted.content;
  if (!text || text.trim().length < minChunkSize) {
    if (text.trim().length === 0) return [];
    return [{
      id: crypto.randomUUID(),
      content: text.trim(),
      index: 0,
      metadata: {
        filename: extracted.metadata.filename,
        mimeType: extracted.metadata.mimeType,
        chunkType: "mixed",
        startOffset: 0,
        endOffset: text.length,
        wordCount: text.trim().split(/\s+/).length,
        contentHash: crypto.createHash("sha256").update(text.trim()).digest("hex"),
      },
    }];
  }

  // Step 1: Split by paragraphs first
  const paragraphs = text.split(PARAGRAPH_BREAK).filter(p => p.trim().length > 0);

  const chunks: DocumentChunk[] = [];
  let currentChunk = "";
  let currentOffset = 0;
  let chunkStartOffset = 0;
  let currentHeading: string | undefined;

  function flushChunk() {
    const trimmed = currentChunk.trim();
    if (trimmed.length < minChunkSize && chunks.length > 0) {
      // Too small — merge with previous chunk
      const prev = chunks[chunks.length - 1];
      prev.content += "\n\n" + trimmed;
      prev.metadata.endOffset = currentOffset;
      prev.metadata.wordCount = prev.content.split(/\s+/).length;
      prev.metadata.contentHash = crypto.createHash("sha256").update(prev.content).digest("hex");
    } else if (trimmed.length > 0) {
      // Detect chunk type
      let chunkType: DocumentChunk["metadata"]["chunkType"] = "paragraph";
      if (trimmed.includes("|") && trimmed.includes("---")) chunkType = "table";
      else if (trimmed.includes("```")) chunkType = "code";
      else if (/^#{1,6}\s/.test(trimmed)) chunkType = "heading";

      // Find page number from extracted pages
      let pageNumber: number | undefined;
      if (extracted.pages) {
        let offset = 0;
        for (const page of extracted.pages) {
          if (chunkStartOffset >= offset && chunkStartOffset < offset + page.text.length) {
            pageNumber = page.pageNumber;
            break;
          }
          offset += page.text.length;
        }
      }

      chunks.push({
        id: crypto.randomUUID(),
        content: trimmed,
        index: chunks.length,
        metadata: {
          filename: extracted.metadata.filename,
          mimeType: extracted.metadata.mimeType,
          pageNumber,
          sectionHeading: currentHeading,
          chunkType,
          startOffset: chunkStartOffset,
          endOffset: currentOffset,
          wordCount: trimmed.split(/\s+/).length,
          contentHash: crypto.createHash("sha256").update(trimmed).digest("hex"),
        },
      });
    }
    currentChunk = "";
    chunkStartOffset = currentOffset;
  }

  for (const para of paragraphs) {
    // Check if this paragraph is a heading
    const headingMatch = para.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      // Flush current chunk before starting new section
      if (currentChunk.trim().length > 0) flushChunk();
      currentHeading = headingMatch[2].trim();
    }

    // Would adding this paragraph exceed max size?
    if (currentChunk.length + para.length > maxChunkSize && currentChunk.length > 0) {
      // If the paragraph itself is too large, split by sentences
      if (para.length > maxChunkSize && respectSentences) {
        flushChunk();
        const sentences = para.split(SENTENCE_END);
        for (const sentence of sentences) {
          if (currentChunk.length + sentence.length > maxChunkSize && currentChunk.length > 0) {
            flushChunk();
          }
          currentChunk += (currentChunk ? " " : "") + sentence;
          currentOffset += sentence.length + 1;
        }
      } else {
        flushChunk();
        currentChunk = para;
        currentOffset += para.length + 2; // +2 for paragraph break
      }
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + para;
      currentOffset += para.length + 2;
    }
  }

  // Flush remaining
  if (currentChunk.trim().length > 0) flushChunk();

  // Add overlap: prepend last N chars of previous chunk to each chunk (except first)
  if (overlapSize > 0 && chunks.length > 1) {
    for (let i = 1; i < chunks.length; i++) {
      const prevContent = chunks[i - 1].content;
      if (prevContent.length > overlapSize) {
        // Find sentence boundary in overlap region
        const overlapText = prevContent.slice(-overlapSize);
        const sentenceStart = overlapText.search(SENTENCE_END);
        const overlap = sentenceStart > 0 ? overlapText.slice(sentenceStart).trim() : overlapText.trim();
        if (overlap.length > 20) {
          chunks[i].content = `...${overlap}\n\n${chunks[i].content}`;
          chunks[i].metadata.wordCount = chunks[i].content.split(/\s+/).length;
          chunks[i].metadata.contentHash = crypto.createHash("sha256").update(chunks[i].content).digest("hex");
        }
      }
    }
  }

  return chunks;
}
