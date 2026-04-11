import JSZip from "jszip";
import type {
  DocumentSemanticModel,
  Table,
  TableCell,
  Section,
} from "../../../shared/schemas/documentSemanticModel";

const PPTX_MAX_FILE_SIZE = 200 * 1024 * 1024;
const PPTX_MAX_SLIDES = 500;
const PPTX_MAX_TEXT_PER_SLIDE = 500_000;
const PPTX_MAX_ZIP_ENTRIES = 2000;
const PPTX_MAX_DECOMPRESSED_SIZE = 500 * 1024 * 1024;

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function cleanText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, "--")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

interface SlideData {
  slideNumber: number;
  title: string;
  paragraphs: string[];
  notes: string;
  tables: { headers: string[]; rows: string[][] }[];
  hasImages: boolean;
  hasCharts: boolean;
}

function extractTextParagraphs(xml: string): string[] {
  const paragraphs: string[] = [];
  const processedTexts = new Set<string>();
  let totalTextLength = 0;

  const paragraphMatches = Array.from(xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g));

  for (const match of paragraphMatches) {
    const paraXml = match[1];
    const pPrMatch = paraXml.match(/<a:pPr[^>]*>/);
    let bulletPrefix = "";
    let indent = 0;

    if (pPrMatch) {
      const lvlMatch = pPrMatch[0].match(/lvl="(\d+)"/);
      if (lvlMatch) indent = parseInt(lvlMatch[1], 10);
      if (
        paraXml.includes("<a:buChar") ||
        paraXml.includes("<a:buAutoNum")
      ) {
        bulletPrefix = "  ".repeat(indent) + "- ";
      } else if (indent > 0) {
        bulletPrefix = "  ".repeat(indent) + "- ";
      }
    }

    const textParts: string[] = [];
    const textMatches = Array.from(paraXml.matchAll(/<a:t>([^<]*)<\/a:t>/g));
    for (const textMatch of textMatches) {
      textParts.push(textMatch[1]);
    }

    const fullText = textParts.join("").trim();
    if (fullText && !processedTexts.has(fullText)) {
      totalTextLength += fullText.length;
      if (totalTextLength > PPTX_MAX_TEXT_PER_SLIDE) break;
      processedTexts.add(fullText);
      paragraphs.push(bulletPrefix + cleanText(fullText));
    }
  }

  return paragraphs.filter((p) => p.trim().length > 0);
}

function extractTablesFromXml(xml: string): { headers: string[]; rows: string[][] }[] {
  const tables: { headers: string[]; rows: string[][] }[] = [];
  const tableMatches = Array.from(xml.matchAll(/<a:tbl>([\s\S]*?)<\/a:tbl>/g));

  for (const tableMatch of tableMatches) {
    const tableXml = tableMatch[1];
    const rows: string[][] = [];
    const rowMatches = Array.from(tableXml.matchAll(/<a:tr[^>]*>([\s\S]*?)<\/a:tr>/g));

    for (const rowMatch of rowMatches) {
      const rowXml = rowMatch[1];
      const cells: string[] = [];
      const cellMatches = Array.from(rowXml.matchAll(/<a:tc[^>]*>([\s\S]*?)<\/a:tc>/g));

      for (const cellMatch of cellMatches) {
        const cellTexts: string[] = [];
        const textMatches = Array.from(cellMatch[1].matchAll(/<a:t>([^<]*)<\/a:t>/g));
        for (const textMatch of textMatches) {
          cellTexts.push(textMatch[1]);
        }
        cells.push(cleanText(cellTexts.join(" ")));
      }

      if (cells.length > 0) rows.push(cells);
    }

    if (rows.length > 0) {
      const headers = rows[0];
      const dataRows = rows.slice(1);
      tables.push({ headers, rows: dataRows });
    }
  }

  return tables;
}

function extractNotesText(xml: string): string {
  const texts: string[] = [];
  const matches = Array.from(xml.matchAll(/<a:t>([^<]*)<\/a:t>/g));
  for (const match of matches) {
    const text = cleanText(match[1]);
    if (text && !text.match(/^\d+$/) && text.length > 2) {
      texts.push(text);
    }
  }
  return Array.from(new Set(texts)).join(" ").trim();
}

async function parseSlides(zip: JSZip): Promise<SlideData[]> {
  const slides: SlideData[] = [];
  const slideFiles: { name: string; num: number }[] = [];

  zip.forEach((path) => {
    const match = path.match(/ppt\/slides\/slide(\d+)\.xml$/);
    if (match) slideFiles.push({ name: path, num: parseInt(match[1], 10) });
  });

  slideFiles.sort((a, b) => a.num - b.num);
  if (slideFiles.length > PPTX_MAX_SLIDES) slideFiles.length = PPTX_MAX_SLIDES;

  for (const slideFile of slideFiles) {
    try {
      const slideXml = await zip.file(slideFile.name)?.async("string");
      if (!slideXml) continue;

      const paragraphs = extractTextParagraphs(slideXml);

      let title = "";
      const titleMatch =
        slideXml.match(/<p:ph[^>]*type="title"[^>]*>[\s\S]*?<a:t>([^<]+)<\/a:t>/i) ||
        slideXml.match(/<p:ph[^>]*type="ctrTitle"[^>]*>[\s\S]*?<a:t>([^<]+)<\/a:t>/i);
      if (titleMatch) {
        title = cleanText(titleMatch[1]);
      } else if (paragraphs.length > 0 && paragraphs[0].length < 100) {
        title = paragraphs[0];
      }

      const tables = extractTablesFromXml(slideXml);
      const hasImages = /<p:pic/.test(slideXml) || /<a:blip/.test(slideXml);
      const hasCharts = /<c:chart/.test(slideXml) || /<p:oleObj/.test(slideXml);

      let notes = "";
      const notesPath = `ppt/notesSlides/notesSlide${slideFile.num}.xml`;
      const notesXml = await zip.file(notesPath)?.async("string");
      if (notesXml) notes = extractNotesText(notesXml);

      slides.push({
        slideNumber: slideFile.num,
        title,
        paragraphs,
        notes,
        tables,
        hasImages,
        hasCharts,
      });
    } catch {
      continue;
    }
  }

  return slides;
}

async function extractMetadata(zip: JSZip): Promise<{
  title?: string;
  author?: string;
  createdAt?: string;
  modifiedAt?: string;
  company?: string;
  totalSlides?: number;
}> {
  const meta: any = {};

  try {
    const coreXml = await zip.file("docProps/core.xml")?.async("string");
    if (coreXml) {
      const titleMatch = coreXml.match(/<dc:title>([^<]+)<\/dc:title>/);
      if (titleMatch) meta.title = cleanText(titleMatch[1]);
      const authorMatch = coreXml.match(/<dc:creator>([^<]+)<\/dc:creator>/);
      if (authorMatch) meta.author = cleanText(authorMatch[1]);
      const createdMatch = coreXml.match(/<dcterms:created[^>]*>([^<]*)<\/dcterms:created>/);
      if (createdMatch) meta.createdAt = createdMatch[1];
      const modifiedMatch = coreXml.match(/<dcterms:modified[^>]*>([^<]*)<\/dcterms:modified>/);
      if (modifiedMatch) meta.modifiedAt = modifiedMatch[1];
    }

    const appXml = await zip.file("docProps/app.xml")?.async("string");
    if (appXml) {
      const slidesMatch = appXml.match(/<Slides>(\d+)<\/Slides>/);
      if (slidesMatch) meta.totalSlides = parseInt(slidesMatch[1], 10);
      const companyMatch = appXml.match(/<Company>([^<]*)<\/Company>/);
      if (companyMatch) meta.company = cleanText(companyMatch[1]);
    }
  } catch {}

  return meta;
}

export async function extractPptx(
  buffer: Buffer,
  fileName: string
): Promise<Partial<DocumentSemanticModel>> {
  if (buffer.length > PPTX_MAX_FILE_SIZE) {
    throw new Error(`PowerPoint file exceeds maximum size of ${PPTX_MAX_FILE_SIZE / (1024 * 1024)}MB`);
  }

  const startTime = Date.now();
  const zip = await JSZip.loadAsync(buffer);

  let entryCount = 0;
  zip.forEach(() => { entryCount++; });
  if (entryCount > PPTX_MAX_ZIP_ENTRIES) {
    throw new Error(`PowerPoint file contains too many entries (${entryCount}, max ${PPTX_MAX_ZIP_ENTRIES})`);
  }

  const [slides, metadata] = await Promise.all([
    parseSlides(zip),
    extractMetadata(zip),
  ]);

  const sections: Section[] = [];
  const tables: Table[] = [];
  let totalWords = 0;

  for (const slide of slides) {
    const slideRef = `slide:${slide.slideNumber}`;
    const contentText = slide.paragraphs.join("\n");
    totalWords += countWords(contentText);

    sections.push({
      id: generateId(),
      type: "heading",
      level: 1,
      title: slide.title || `Diapositiva ${slide.slideNumber}`,
      content: contentText,
      sourceRef: slideRef,
    });

    if (slide.notes) {
      sections.push({
        id: generateId(),
        type: "metadata",
        title: `Notas - Diapositiva ${slide.slideNumber}`,
        content: slide.notes,
        sourceRef: slideRef,
      });
    }

    for (const tbl of slide.tables) {
      const maxCols = Math.max(tbl.headers.length, ...tbl.rows.map((r) => r.length));
      const normalizeRow = (row: string[]): TableCell[] => {
        const cells: TableCell[] = [];
        for (let i = 0; i < maxCols; i++) {
          cells.push({ value: row[i] || "", type: "text" });
        }
        return cells;
      };

      tables.push({
        id: generateId(),
        sourceRef: slideRef,
        headers: tbl.headers,
        columnTypes: tbl.headers.map(() => "text" as const),
        rows: tbl.rows.map(normalizeRow),
        rowCount: tbl.rows.length,
        columnCount: maxCols,
        previewRows: tbl.rows.slice(0, 3).map(normalizeRow),
      });
    }
  }

  const durationMs = Date.now() - startTime;

  return {
    documentMeta: {
      id: generateId(),
      fileName,
      fileSize: buffer.length,
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      documentType: "presentation",
      createdAt: metadata.createdAt || new Date().toISOString(),
      modifiedAt: metadata.modifiedAt,
      author: metadata.author,
      title: metadata.title || fileName,
      pageCount: slides.length,
      wordCount: totalWords,
    },
    sections,
    tables,
    metrics: [],
    anomalies: [],
    insights: [],
    sources: slides.map((s) => ({
      id: generateId(),
      type: "page" as const,
      location: `Slide ${s.slideNumber}`,
      pageNumber: s.slideNumber,
      previewText: s.title || undefined,
    })),
    suggestedQuestions: [],
    extractionDiagnostics: {
      extractedAt: new Date().toISOString(),
      durationMs,
      parserUsed: "pptxExtractor",
      mimeTypeDetected: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      warnings: [],
      errors: [],
      bytesProcessed: buffer.length,
    },
  };
}
