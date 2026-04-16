/**
 * DocumentIntelligencePipeline — deep understanding of PDF, DOCX, PPTX, HTML, and Markdown.
 * Extracts structure, tables, figures, TOC, bibliography, and generates a knowledge graph.
 */

import { createLogger } from "../utils/logger";
import { AppError } from "../utils/errors";
import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs/promises";
import * as path from "path";

const logger = createLogger("DocumentIntelligencePipeline");

// ─── Types ────────────────────────────────────────────────────────────────────

export type DocumentFormat = "pdf" | "docx" | "pptx" | "html" | "markdown" | "txt";

export interface DocumentSection {
  level: number; // 1 = h1, 2 = h2, etc.
  title: string;
  content: string;
  pageStart?: number;
  wordCount: number;
}

export interface DocumentTable {
  caption?: string;
  headers: string[];
  rows: string[][];
  pageNumber?: number;
  dataTypes: Record<string, "text" | "number" | "date" | "boolean">;
}

export interface DocumentFigure {
  caption?: string;
  pageNumber?: number;
  description?: string;
  type: "chart" | "image" | "diagram" | "photo" | "unknown";
}

export interface BibEntry {
  key?: string;
  authors: string[];
  title: string;
  year?: number;
  venue?: string;
  doi?: string;
  url?: string;
}

export interface DocumentKnowledgeNode {
  entity: string;
  type: "concept" | "person" | "organization" | "place" | "technology" | "term";
  mentions: number;
  relatedEntities: string[];
}

export interface DocumentAnalysis {
  format: DocumentFormat;
  title?: string;
  authors?: string[];
  date?: string;
  language?: string;
  wordCount: number;
  pageCount?: number;
  sections: DocumentSection[];
  tableOfContents: Array<{ level: number; title: string; page?: number }>;
  tables: DocumentTable[];
  figures: DocumentFigure[];
  bibliography: BibEntry[];
  knowledgeGraph: DocumentKnowledgeNode[];
  keyTopics: string[];
  summary: string;
  fullText: string;
}

// ─── Format Detectors ─────────────────────────────────────────────────────────

function detectFormat(filePath: string): DocumentFormat {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  const formats: Record<string, DocumentFormat> = {
    pdf: "pdf", docx: "docx", doc: "docx",
    pptx: "pptx", ppt: "pptx",
    html: "html", htm: "html",
    md: "markdown", markdown: "markdown",
    txt: "txt",
  };
  return formats[ext] ?? "txt";
}

// ─── Text Extractors ──────────────────────────────────────────────────────────

async function extractFromPdf(buffer: Buffer): Promise<string> {
  try {
    const { default: pdfParse } = await import("pdf-parse");
    const data = await pdfParse(buffer);
    return data.text;
  } catch (err) {
    throw new AppError(`PDF extraction failed: ${(err as Error).message}`, 500, "PDF_PARSE_ERROR");
  }
}

async function extractFromDocx(buffer: Buffer): Promise<string> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (err) {
    throw new AppError(`DOCX extraction failed: ${(err as Error).message}`, 500, "DOCX_PARSE_ERROR");
  }
}

async function extractFromPptx(buffer: Buffer): Promise<string> {
  try {
    const officeparser = await import("officeparser");
    const text = await officeparser.parseOfficeAsync(buffer, { type: "Buffer" });
    return String(text);
  } catch (err) {
    throw new AppError(`PPTX extraction failed: ${(err as Error).message}`, 500, "PPTX_PARSE_ERROR");
  }
}

function extractFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ─── Structure Parsers ────────────────────────────────────────────────────────

function parseMarkdownSections(markdown: string): DocumentSection[] {
  const sections: DocumentSection[] = [];
  const lines = markdown.split("\n");
  let currentSection: DocumentSection | null = null;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      if (currentSection) sections.push(currentSection);
      currentSection = {
        level: headingMatch[1].length,
        title: headingMatch[2].trim(),
        content: "",
        wordCount: 0,
      };
    } else if (currentSection) {
      currentSection.content += line + "\n";
    }
  }

  if (currentSection) sections.push(currentSection);

  return sections.map((s) => ({
    ...s,
    wordCount: s.content.split(/\s+/).filter(Boolean).length,
    content: s.content.trim(),
  }));
}

function parseSectionsFromText(text: string): DocumentSection[] {
  // Heuristic: lines that are ALL CAPS or match "Chapter/Section N" patterns
  const sections: DocumentSection[] = [];
  const lines = text.split("\n");
  let current: DocumentSection | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isHeading =
      /^(chapter|section|part|appendix)\s+\d+/i.test(trimmed) ||
      (trimmed.length < 80 && trimmed === trimmed.toUpperCase() && trimmed.length > 5) ||
      /^\d+\.\s+[A-Z]/.test(trimmed);

    if (isHeading) {
      if (current) sections.push(current);
      current = { level: 1, title: trimmed, content: "", wordCount: 0 };
    } else if (current) {
      current.content += trimmed + " ";
    }
  }

  if (current) sections.push(current);

  return sections.map((s) => ({
    ...s,
    wordCount: s.content.split(/\s+/).filter(Boolean).length,
    content: s.content.trim().slice(0, 2_000),
  }));
}

// ─── Table Extraction ─────────────────────────────────────────────────────────

function extractTablesFromMarkdown(markdown: string): DocumentTable[] {
  const tables: DocumentTable[] = [];
  const tablePattern = /(\|.+\|[\s\S]*?)(?=\n\n|\n#|$)/g;

  for (const match of [...markdown.matchAll(tablePattern)]) {
    const block = match[1].trim();
    const lines = block.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("|"));

    if (lines.length < 3) continue;

    const headers = lines[0]!.split("|").map((h) => h.trim()).filter(Boolean);
    const rows = lines.slice(2).map((l) => l.split("|").map((c) => c.trim()).filter(Boolean));

    // Infer data types
    const dataTypes: Record<string, "text" | "number" | "date" | "boolean"> = {};
    for (const header of headers) {
      const sample = rows[0]?.[headers.indexOf(header)] ?? "";
      if (/^\d+\.?\d*$/.test(sample)) dataTypes[header] = "number";
      else if (/^\d{4}-\d{2}-\d{2}/.test(sample)) dataTypes[header] = "date";
      else if (/^(true|false|yes|no)$/i.test(sample)) dataTypes[header] = "boolean";
      else dataTypes[header] = "text";
    }

    tables.push({ headers, rows, dataTypes });
  }

  return tables;
}

// ─── Bibliography Parser ──────────────────────────────────────────────────────

function extractBibliography(text: string): BibEntry[] {
  const entries: BibEntry[] = [];
  const bibSection = text.match(/(?:references?|bibliography|works cited)[:\n]([\s\S]*?)(?:\n\n\n|$)/i)?.[1];
  if (!bibSection) return entries;

  const lines = bibSection.split("\n").filter((l) => l.trim().length > 20);
  for (const line of lines.slice(0, 50)) {
    const authorMatch = line.match(/^([A-Z][a-z]+(?:,\s+[A-Z][a-z.]+)+)/);
    const yearMatch = line.match(/\((\d{4})\)/);
    const doiMatch = line.match(/doi[:\s]+(\S+)/i);

    if (authorMatch) {
      entries.push({
        authors: [authorMatch[1]],
        title: line.slice(authorMatch[0].length).replace(/\(\d{4}\)/, "").trim().slice(0, 100),
        year: yearMatch ? parseInt(yearMatch[1], 10) : undefined,
        doi: doiMatch?.[1],
      });
    }
  }

  return entries;
}

// ─── Knowledge Graph Extraction ───────────────────────────────────────────────

function extractKnowledgeGraph(text: string): DocumentKnowledgeNode[] {
  const entityCounts = new Map<string, number>();
  const entityTypes = new Map<string, DocumentKnowledgeNode["type"]>();

  // Named entities: capitalized multi-word phrases
  const entityMatches = [...text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g)];
  for (const m of entityMatches) {
    const entity = m[1];
    entityCounts.set(entity, (entityCounts.get(entity) ?? 0) + 1);

    // Classify type
    if (/University|Institute|Corp|Inc|Ltd|Organization|Foundation/i.test(entity)) {
      entityTypes.set(entity, "organization");
    } else if (/Algorithm|Framework|Protocol|Model|System|Technology/i.test(entity)) {
      entityTypes.set(entity, "technology");
    } else {
      entityTypes.set(entity, "concept");
    }
  }

  // Keep entities mentioned 2+ times
  return [...entityCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([entity, mentions]) => ({
      entity,
      type: entityTypes.get(entity) ?? "concept",
      mentions,
      relatedEntities: [],
    }));
}

// ─── LLM Summary ─────────────────────────────────────────────────────────────

async function generateDocumentSummary(text: string, title?: string): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 800,
    messages: [
      {
        role: "user",
        content: `Summarize this document${title ? ` titled "${title}"` : ""} in 3-5 sentences:

${text.slice(0, 5_000)}

Focus on: main topic, key findings/arguments, and significance.`,
      },
    ],
  });

  return response.content[0]?.type === "text" ? response.content[0].text : "";
}

// ─── DocumentIntelligencePipeline ─────────────────────────────────────────────

export class DocumentIntelligencePipeline {
  async analyzeFile(filePath: string, options: { generateSummary?: boolean } = {}): Promise<DocumentAnalysis> {
    const buffer = await fs.readFile(filePath);
    const format = detectFormat(filePath);
    return this.analyzeBuffer(buffer, format, options);
  }

  async analyzeBuffer(
    buffer: Buffer,
    format: DocumentFormat,
    options: { generateSummary?: boolean } = {}
  ): Promise<DocumentAnalysis> {
    logger.info(`Analyzing document: format=${format}, size=${buffer.length} bytes`);

    let rawText = "";

    switch (format) {
      case "pdf": rawText = await extractFromPdf(buffer); break;
      case "docx": rawText = await extractFromDocx(buffer); break;
      case "pptx": rawText = await extractFromPptx(buffer); break;
      case "html": rawText = extractFromHtml(buffer.toString("utf-8")); break;
      case "markdown": rawText = buffer.toString("utf-8"); break;
      case "txt": rawText = buffer.toString("utf-8"); break;
    }

    const wordCount = rawText.split(/\s+/).filter(Boolean).length;

    // Structure extraction
    const sections = format === "markdown"
      ? parseMarkdownSections(rawText)
      : parseSectionsFromText(rawText);

    const toc = sections.map((s) => ({ level: s.level, title: s.title, page: s.pageStart }));

    // Table extraction
    const tables = format === "markdown" ? extractTablesFromMarkdown(rawText) : [];

    // Figures (textual references)
    const figureMatches = [...rawText.matchAll(/(?:figure|fig\.?|image|diagram)\s+(\d+)[:\s]+([^\n]{10,80})/gi)];
    const figures: DocumentFigure[] = figureMatches.slice(0, 20).map((m) => ({
      caption: m[2].trim(),
      type: "unknown" as const,
    }));

    // Bibliography
    const bibliography = extractBibliography(rawText);

    // Knowledge graph
    const knowledgeGraph = extractKnowledgeGraph(rawText);

    // Key topics (most mentioned meaningful words)
    const stopwords = new Set(["the", "a", "an", "and", "or", "but", "in", "on", "is", "was", "are"]);
    const wordFreq = new Map<string, number>();
    for (const word of rawText.toLowerCase().split(/\W+/).filter((w) => w.length > 4 && !stopwords.has(w))) {
      wordFreq.set(word, (wordFreq.get(word) ?? 0) + 1);
    }
    const keyTopics = [...wordFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([w]) => w);

    // Title detection
    const firstLines = rawText.slice(0, 500).split("\n").filter((l) => l.trim().length > 5);
    const title = firstLines[0]?.trim().slice(0, 100);

    // Summary
    let summary = "";
    if (options.generateSummary && process.env.ANTHROPIC_API_KEY) {
      try {
        summary = await generateDocumentSummary(rawText, title);
      } catch (err) {
        logger.warn(`Summary generation failed: ${(err as Error).message}`);
        summary = rawText.slice(0, 400) + "...";
      }
    } else {
      summary = rawText.slice(0, 400) + (rawText.length > 400 ? "..." : "");
    }

    logger.info(`Document analysis complete: ${sections.length} sections, ${tables.length} tables, ${wordCount} words`);

    return {
      format,
      title,
      authors: [],
      wordCount,
      sections,
      tableOfContents: toc,
      tables,
      figures,
      bibliography,
      knowledgeGraph,
      keyTopics,
      summary,
      fullText: rawText.slice(0, 50_000),
    };
  }

  extractText(analysis: DocumentAnalysis, maxTokens = 8_000): string {
    const charLimit = maxTokens * 4;
    if (analysis.fullText.length <= charLimit) return analysis.fullText;

    // Prioritize: summary + section titles + first paragraph of each section
    const parts: string[] = [analysis.summary ?? ""];
    for (const section of analysis.sections) {
      parts.push(`\n## ${section.title}\n${section.content.slice(0, 300)}`);
    }

    return parts.join("\n").slice(0, charLimit);
  }
}

export const documentIntelligencePipeline = new DocumentIntelligencePipeline();
