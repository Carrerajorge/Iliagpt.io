import crypto from "crypto";
import axios from "axios";
import Anthropic from "@anthropic-ai/sdk";
import { Logger } from "../lib/logger";
import { env } from "../config/env";
import { llmGateway } from "../lib/llmGateway";

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface DocumentIntelligenceRequest {
  source:
    | { type: "buffer"; buffer: Buffer; filename: string; mimeType: string }
    | { type: "url"; url: string }
    | { type: "text"; content: string };
  tasks?: DocumentTask[];
  extractionDepth?: "basic" | "standard" | "deep";
}

export type DocumentTask =
  | "structure"
  | "tables"
  | "figures"
  | "entities"
  | "relations"
  | "summary"
  | "key_facts"
  | "citations"
  | "action_items"
  | "knowledge_graph";

export interface Section {
  level: number; // 1=H1, 2=H2, etc.
  title: string;
  content: string;
  subsections: Section[];
}

export interface TOCEntry {
  level: number;
  title: string;
  position?: number; // character offset
}

export interface DocumentStructure {
  title?: string;
  sections: Section[];
  tableOfContents: TOCEntry[];
  pageCount?: number;
  language: string;
  docType:
    | "report"
    | "article"
    | "contract"
    | "email"
    | "presentation"
    | "code"
    | "form"
    | "other";
}

export interface ExtractedTable {
  caption?: string;
  pageNumber?: number;
  headers: string[];
  rows: string[][];
  summary: string;
}

export interface FigureDescription {
  figureNumber?: string;
  caption?: string;
  description: string;
  pageNumber?: number;
}

export interface NamedEntity {
  text: string;
  type:
    | "person"
    | "organization"
    | "date"
    | "place"
    | "currency"
    | "percentage"
    | "product"
    | "event"
    | "other";
  context?: string;
  count: number;
}

export interface EntityRelation {
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
}

export interface Citation {
  raw: string;
  style?: "apa" | "mla" | "chicago" | "ieee" | "unknown";
  authors?: string[];
  year?: string;
  title?: string;
  journal?: string;
  doi?: string;
}

export interface DocumentIntelligenceResult {
  documentId: string;
  structure?: DocumentStructure;
  tables?: ExtractedTable[];
  figures?: FigureDescription[];
  entities?: NamedEntity[];
  relations?: EntityRelation[];
  summary?: string;
  keyFacts?: string[];
  citations?: Citation[];
  actionItems?: string[];
  knowledgeGraph?: { entities: any[]; relationships: any[] };
  processingTimeMs: number;
}

// ─── Class ────────────────────────────────────────────────────────────────────

class DocumentIntelligencePipeline {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    Logger.info("[DocumentIntelligencePipeline] Initialized");
  }

  // ── Public: main entry ───────────────────────────────────────────────────

  async process(request: DocumentIntelligenceRequest): Promise<DocumentIntelligenceResult> {
    const startMs = Date.now();
    const tasks: DocumentTask[] = request.tasks ?? ["structure", "summary", "key_facts"];
    const depth = request.extractionDepth ?? "standard";
    Logger.info("[DocumentIntelligencePipeline] process", { tasks, depth });

    const { text, mimeType, filename } = await this.prepareContent(request.source);
    const documentId = crypto.createHash("sha256").update(text.slice(0, 2000)).digest("hex").slice(0, 16);

    Logger.debug("[DocumentIntelligencePipeline] content prepared", {
      documentId,
      textLength: text.length,
      mimeType,
      filename,
    });

    const result: DocumentIntelligenceResult = { documentId, processingTimeMs: 0 };
    const chunks = this.chunkText(text, 12_000);

    const runTask = async <T>(
      taskName: DocumentTask,
      fn: () => Promise<T>,
      key: keyof DocumentIntelligenceResult
    ) => {
      if (tasks.includes(taskName)) {
        try {
          (result as any)[key] = await fn();
        } catch (err) {
          Logger.error(`[DocumentIntelligencePipeline] task '${taskName}' failed`, err);
        }
      }
    };

    await runTask("structure", () => this.extractStructure(text), "structure");
    await runTask("tables", () => this.extractTables(text), "tables");
    await runTask("figures", () => this.describeFigures(text), "figures");
    await runTask("entities", () => this.extractEntities(chunks[0]), "entities");

    if (tasks.includes("relations") && result.entities) {
      await runTask("relations", () => this.extractRelations(text, result.entities!), "relations");
    }

    const summaryDepth = depth === "deep" ? "detailed" : depth === "basic" ? "brief" : "standard";
    await runTask("summary", () => this.generateSummary(text, summaryDepth), "summary");
    await runTask("key_facts", () => this.extractKeyFacts(chunks[0]), "keyFacts");
    await runTask("citations", () => this.extractCitations(text), "citations");
    await runTask("action_items", () => this.extractActionItems(text), "actionItems");

    if (tasks.includes("knowledge_graph") && result.entities) {
      await runTask(
        "knowledge_graph",
        () => this.buildKnowledgeGraph(text, result.entities!),
        "knowledgeGraph"
      );
    }

    result.processingTimeMs = Date.now() - startMs;
    Logger.info("[DocumentIntelligencePipeline] processing complete", {
      documentId,
      processingTimeMs: result.processingTimeMs,
    });

    return result;
  }

  // ── Structure extraction ─────────────────────────────────────────────────

  async extractStructure(text: string): Promise<DocumentStructure> {
    Logger.debug("[DocumentIntelligencePipeline] extractStructure");

    const excerpt = text.slice(0, 6000);
    const prompt = `Analyze the structure of the following document.
Return a JSON object:
{
  "title": string or null,
  "language": "en" (ISO 639-1),
  "docType": "report"|"article"|"contract"|"email"|"presentation"|"code"|"form"|"other",
  "tableOfContents": [{"level": 1, "title": "Section Title"}],
  "sections": [{"level": 1, "title": "...", "content": "first 100 chars...", "subsections": []}]
}
Return ONLY valid JSON.

Document:
${excerpt}`;

    const llmResult = await llmGateway.chat([{ role: "user", content: prompt }]);

    try {
      const cleaned = llmResult.content.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      return parsed as DocumentStructure;
    } catch {
      Logger.warn("[DocumentIntelligencePipeline] failed to parse structure JSON");
      return {
        title: undefined,
        sections: [],
        tableOfContents: [],
        language: "en",
        docType: "other",
      };
    }
  }

  // ── Table extraction ─────────────────────────────────────────────────────

  async extractTables(content: string): Promise<ExtractedTable[]> {
    Logger.debug("[DocumentIntelligencePipeline] extractTables");

    // First try regex-based markdown table parsing
    const markdownTables = this.parseMarkdownTables(content);

    // Then use LLM for complex or non-markdown tables
    const prompt = `Extract ALL tables from the following text.
For each table, return a JSON object:
{
  "caption": "table title or null",
  "headers": ["col1", "col2"],
  "rows": [["val1", "val2"]],
  "summary": "one line description"
}
Return a JSON array of these objects. If no tables exist, return [].
Return ONLY valid JSON.

Text:
${content.slice(0, 8000)}`;

    try {
      const llmResult = await llmGateway.chat([{ role: "user", content: prompt }]);
      const match = llmResult.content.match(/\[[\s\S]*\]/);
      if (match) {
        const llmTables = JSON.parse(match[0]) as ExtractedTable[];
        // Deduplicate: prefer LLM tables over regex if there's overlap
        if (llmTables.length > 0) return llmTables;
      }
    } catch (err) {
      Logger.warn("[DocumentIntelligencePipeline] LLM table extraction failed", err);
    }

    return markdownTables;
  }

  // ── Figure description ───────────────────────────────────────────────────

  async describeFigures(content: string): Promise<FigureDescription[]> {
    Logger.debug("[DocumentIntelligencePipeline] describeFigures");

    // Extract figure references via regex
    const figureRefs = [...content.matchAll(/(?:Figure|Fig\.?|Chart|Diagram|Graph|Image)\s*(\d+\.?\d*)[:\s–-]+([^\n.]{10,120})/gi)];

    if (figureRefs.length === 0) {
      // Ask LLM to find implicit figure references
      const prompt = `List all figures, charts, images, or diagrams referenced in this text.
For each, return: {"figureNumber": "Fig 1" or null, "caption": string or null, "description": "what it likely shows based on context"}
Return a JSON array. If none found, return [].
Return ONLY valid JSON.

Text:
${content.slice(0, 6000)}`;

      try {
        const llmResult = await llmGateway.chat([{ role: "user", content: prompt }]);
        const match = llmResult.content.match(/\[[\s\S]*\]/);
        if (match) return JSON.parse(match[0]) as FigureDescription[];
      } catch (err) {
        Logger.warn("[DocumentIntelligencePipeline] figure description failed", err);
      }
      return [];
    }

    return figureRefs.map((m) => ({
      figureNumber: m[1] ? `Figure ${m[1]}` : undefined,
      caption: m[2]?.trim(),
      description: `Referenced as: ${m[0].trim()}`,
    }));
  }

  // ── Named entity extraction ──────────────────────────────────────────────

  async extractEntities(text: string): Promise<NamedEntity[]> {
    Logger.debug("[DocumentIntelligencePipeline] extractEntities");

    const prompt = `Extract all named entities from the following text.
Types: person, organization, date, place, currency, percentage, product, event, other.
Return a JSON array:
[{"text": "John Smith", "type": "person", "context": "brief surrounding context", "count": 1}]
Merge duplicates and count occurrences.
Return ONLY valid JSON array.

Text:
${text.slice(0, 8000)}`;

    try {
      const llmResult = await llmGateway.chat([{ role: "user", content: prompt }]);
      const match = llmResult.content.match(/\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]) as NamedEntity[];
    } catch (err) {
      Logger.error("[DocumentIntelligencePipeline] entity extraction failed", err);
    }

    return [];
  }

  // ── Relation extraction ──────────────────────────────────────────────────

  async extractRelations(text: string, entities: NamedEntity[]): Promise<EntityRelation[]> {
    Logger.debug("[DocumentIntelligencePipeline] extractRelations");

    const entityNames = entities.slice(0, 30).map((e) => e.text).join(", ");
    const prompt = `Given these entities: ${entityNames}

Find relationships between them in the following text.
Return a JSON array:
[{"subject": "...", "predicate": "works for", "object": "...", "confidence": 0.9}]
Return ONLY valid JSON array.

Text:
${text.slice(0, 6000)}`;

    try {
      const llmResult = await llmGateway.chat([{ role: "user", content: prompt }]);
      const match = llmResult.content.match(/\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]) as EntityRelation[];
    } catch (err) {
      Logger.warn("[DocumentIntelligencePipeline] relation extraction failed", err);
    }

    return [];
  }

  // ── Knowledge graph ──────────────────────────────────────────────────────

  async buildKnowledgeGraph(
    text: string,
    entities: NamedEntity[]
  ): Promise<{ entities: any[]; relationships: any[] }> {
    Logger.debug("[DocumentIntelligencePipeline] buildKnowledgeGraph");

    const entityNames = entities.slice(0, 20).map((e) => e.text).join(", ");
    const prompt = `Build a mini knowledge graph from the following text.
Known entities: ${entityNames}

Return a JSON object:
{
  "entities": [{"id": "e1", "label": "John Smith", "type": "person", "properties": {}}],
  "relationships": [{"source": "e1", "target": "e2", "type": "WORKS_FOR", "properties": {}}]
}
Return ONLY valid JSON.

Text:
${text.slice(0, 6000)}`;

    try {
      const llmResult = await llmGateway.chat([{ role: "user", content: prompt }]);
      const cleaned = llmResult.content.replace(/```json|```/g, "").trim();
      return JSON.parse(cleaned);
    } catch (err) {
      Logger.warn("[DocumentIntelligencePipeline] knowledge graph failed", err);
      return { entities: [], relationships: [] };
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  async generateSummary(text: string, depth: "brief" | "standard" | "detailed"): Promise<string> {
    Logger.debug("[DocumentIntelligencePipeline] generateSummary", { depth });

    const lengthHint =
      depth === "brief"
        ? "2-3 sentences"
        : depth === "standard"
        ? "1 paragraph (4-6 sentences)"
        : "3-5 paragraphs covering all major sections";

    const prompt = `Write a ${lengthHint} summary of the following document.
Focus on the main purpose, key findings, and conclusions.

Document:
${text.slice(0, 10_000)}`;

    const result = await llmGateway.chat([{ role: "user", content: prompt }]);
    return result.content;
  }

  // ── Key facts ────────────────────────────────────────────────────────────

  async extractKeyFacts(text: string): Promise<string[]> {
    Logger.debug("[DocumentIntelligencePipeline] extractKeyFacts");

    const prompt = `Extract the 8-12 most important facts from this document.
Return a JSON array of strings, each being a concise factual statement.
Return ONLY valid JSON array.

Document:
${text.slice(0, 8000)}`;

    try {
      const result = await llmGateway.chat([{ role: "user", content: prompt }]);
      const match = result.content.match(/\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]) as string[];
    } catch (err) {
      Logger.warn("[DocumentIntelligencePipeline] key facts extraction failed", err);
    }

    return [];
  }

  // ── Citations ────────────────────────────────────────────────────────────

  async extractCitations(text: string): Promise<Citation[]> {
    Logger.debug("[DocumentIntelligencePipeline] extractCitations");

    // Regex patterns for common citation formats
    const apaPattern = /[A-Z][a-z]+(?:,?\s+(?:[A-Z]\.)+)+(?:,\s+&\s+[A-Z][a-z]+(?:,?\s+(?:[A-Z]\.)+)+)?\s+\(\d{4}\)/g;
    const doiPattern = /doi:\s*10\.\d{4,}\/\S+/gi;

    const rawCitations: string[] = [];
    for (const match of text.matchAll(apaPattern)) rawCitations.push(match[0]);
    for (const match of text.matchAll(doiPattern)) rawCitations.push(match[0]);

    if (rawCitations.length === 0) {
      // LLM fallback for bibliography sections
      const bibMatch = text.match(/(?:References|Bibliography|Works Cited)\n([\s\S]{100,3000})/i);
      if (bibMatch) {
        const prompt = `Parse these citations into structured JSON:
[{"raw": "...", "style": "apa"|"mla"|"chicago"|"ieee"|"unknown", "authors": [], "year": "...", "title": "...", "journal": "...", "doi": "..."}]
Return ONLY valid JSON array.

Citations:
${bibMatch[1].slice(0, 3000)}`;

        try {
          const result = await llmGateway.chat([{ role: "user", content: prompt }]);
          const match2 = result.content.match(/\[[\s\S]*\]/);
          if (match2) return JSON.parse(match2[0]) as Citation[];
        } catch (err) {
          Logger.warn("[DocumentIntelligencePipeline] citation parsing failed", err);
        }
      }
      return [];
    }

    return rawCitations.map((raw) => ({
      raw,
      style: "unknown" as const,
    }));
  }

  // ── Action items ─────────────────────────────────────────────────────────

  async extractActionItems(text: string): Promise<string[]> {
    Logger.debug("[DocumentIntelligencePipeline] extractActionItems");

    const prompt = `Extract all action items, tasks, TODOs, and next steps from the following document.
Return a JSON array of strings, each being a clear actionable item.
If none found, return [].
Return ONLY valid JSON array.

Document:
${text.slice(0, 8000)}`;

    try {
      const result = await llmGateway.chat([{ role: "user", content: prompt }]);
      const match = result.content.match(/\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]) as string[];
    } catch (err) {
      Logger.warn("[DocumentIntelligencePipeline] action items extraction failed", err);
    }

    return [];
  }

  // ── Private: prepare content ─────────────────────────────────────────────

  private async prepareContent(
    source: DocumentIntelligenceRequest["source"]
  ): Promise<{ text: string; mimeType: string; filename?: string }> {
    if (source.type === "text") {
      return { text: source.content, mimeType: "text/plain" };
    }

    if (source.type === "url") {
      Logger.debug("[DocumentIntelligencePipeline] downloading from URL", { url: source.url });
      const response = await axios.get<string>(source.url, {
        responseType: "text",
        timeout: 30_000,
      });
      const mimeType = (response.headers["content-type"] as string | undefined) ?? "text/plain";
      return { text: response.data, mimeType };
    }

    // Buffer: try to extract text based on MIME type
    const { buffer, filename, mimeType } = source;

    if (mimeType === "text/plain" || mimeType.startsWith("text/")) {
      return { text: buffer.toString("utf8"), mimeType, filename };
    }

    // For PDF, DOCX etc., try to extract plain text via dynamic import or basic parsing
    if (mimeType === "application/pdf") {
      try {
        // Try pdf-parse if available
        const pdfParse = await import("pdf-parse").catch(() => null);
        if (pdfParse) {
          const data = await pdfParse.default(buffer);
          return { text: data.text, mimeType, filename };
        }
      } catch {
        // Fall through
      }
    }

    if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      filename?.endsWith(".docx")
    ) {
      try {
        const officeParser = await import("officeparser").catch(() => null);
        if (officeParser) {
          const text = await officeParser.parseOfficeAsync(buffer);
          return { text: String(text), mimeType, filename };
        }
      } catch {
        // Fall through
      }
    }

    // Last resort: treat as UTF-8 text
    Logger.warn("[DocumentIntelligencePipeline] unrecognized MIME type, treating as text", { mimeType });
    return { text: buffer.toString("utf8"), mimeType, filename };
  }

  // ── Private: markdown table parser ──────────────────────────────────────

  private parseMarkdownTables(text: string): ExtractedTable[] {
    const tables: ExtractedTable[] = [];
    const tableRegex = /(\|[^\n]+\|\n)((?:\|[-: ]+\|[-: |\n]+\n))((?:\|[^\n]+\|\n?)*)/g;

    for (const match of text.matchAll(tableRegex)) {
      const headerLine = match[1];
      const dataLines = match[3];

      const headers = headerLine
        .split("|")
        .map((h) => h.trim())
        .filter(Boolean);

      const rows = dataLines
        .trim()
        .split("\n")
        .filter((l) => l.trim().startsWith("|"))
        .map((line) =>
          line
            .split("|")
            .map((c) => c.trim())
            .filter(Boolean)
        );

      if (headers.length > 0 && rows.length > 0) {
        tables.push({
          headers,
          rows,
          summary: `Table with ${headers.length} columns and ${rows.length} rows`,
        });
      }
    }

    return tables;
  }

  // ── Private: chunk text ──────────────────────────────────────────────────

  private chunkText(text: string, maxChars: number): string[] {
    if (text.length <= maxChars) return [text];

    const chunks: string[] = [];
    let offset = 0;

    while (offset < text.length) {
      let end = offset + maxChars;
      if (end < text.length) {
        // Try to break at paragraph boundary
        const boundary = text.lastIndexOf("\n\n", end);
        if (boundary > offset + maxChars / 2) end = boundary;
      }
      chunks.push(text.slice(offset, end));
      offset = end;
    }

    return chunks;
  }
}

export const documentIntelligencePipeline = new DocumentIntelligencePipeline();
