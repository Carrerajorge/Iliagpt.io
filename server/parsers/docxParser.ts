import mammoth from "mammoth";
import JSZip from "jszip";
import type { FileParser, ParsedResult, DetectedFileType } from "./base";
import { sanitizePlainText } from "../lib/textSanitizers";

export class DocxParser implements FileParser {
  name = "docx";
  supportedMimeTypes = [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];

  // Avoid top-level constants: some CI bundling paths can concatenate modules
  // without sufficient name mangling, triggering duplicate symbol errors.
  private static readonly MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500MB
  private static readonly MAX_EXTRACTED_TEXT_BYTES = 100 * 1024 * 1024; // 100MB max extracted text
  private static readonly MAX_METADATA_VALUE_LENGTH = 1000;

  /** Sanitize metadata values to prevent injection in output */
  private sanitizeMetadataValue(value: string): string {
    return String(value)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
      .substring(0, DocxParser.MAX_METADATA_VALUE_LENGTH);
  }

  async parse(content: Buffer, type: DetectedFileType): Promise<ParsedResult> {
    const startTime = Date.now();
    console.log(`[DocxParser] Starting DOCX parse, size: ${content.length} bytes`);

    // Security: enforce file size limit
    if (content.length > DocxParser.MAX_FILE_SIZE_BYTES) {
      throw new Error(`DOCX file exceeds maximum size of ${DocxParser.MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`);
    }

    try {
      const [htmlResult, metadata] = await Promise.all([
        this.extractStructuredContent(content),
        this.extractMetadata(content),
      ]);

      const structuredText = this.htmlToStructuredText(htmlResult.value);
      
      const elapsed = Date.now() - startTime;
      console.log(`[DocxParser] Completed in ${elapsed}ms`);

      const formattedOutput = this.formatOutput(metadata, structuredText);

      return {
        text: formattedOutput,
        metadata,
        warnings: htmlResult.messages
          .filter((m: { type: string; message: string }) => m.type === "warning")
          .map((m: { type: string; message: string }) => m.message),
      };
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.error(`[DocxParser] Failed after ${elapsed}ms:`, error);
      
      if (error instanceof Error) {
        throw new Error(`Failed to parse DOCX: ${error.message}`);
      }
      throw new Error("Failed to parse DOCX: Unknown error");
    }
  }

  private async extractStructuredContent(content: Buffer): Promise<{ value: string; messages: Array<{ type: string; message: string }> }> {
    return mammoth.convertToHtml({ buffer: content }, {
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='Heading 4'] => h4:fresh",
        "p[style-name='Title'] => h1.title:fresh",
        "p[style-name='Subtitle'] => h2.subtitle:fresh",
        "b => strong",
        "i => em",
        "u => u",
      ],
    });
  }

  private async extractMetadata(content: Buffer): Promise<Record<string, any>> {
    try {
      const zip = await JSZip.loadAsync(content);
      const coreXml = await zip.file("docProps/core.xml")?.async("string");
      
      if (!coreXml) {
        return {};
      }

      const metadata: Record<string, any> = {};

      const titleMatch = coreXml.match(/<dc:title>([^<]*)<\/dc:title>/);
      if (titleMatch) metadata.title = this.sanitizeMetadataValue(titleMatch[1]);

      const creatorMatch = coreXml.match(/<dc:creator>([^<]*)<\/dc:creator>/);
      if (creatorMatch) metadata.author = this.sanitizeMetadataValue(creatorMatch[1]);

      const subjectMatch = coreXml.match(/<dc:subject>([^<]*)<\/dc:subject>/);
      if (subjectMatch) metadata.subject = this.sanitizeMetadataValue(subjectMatch[1]);

      const createdMatch = coreXml.match(/<dcterms:created[^>]*>([^<]*)<\/dcterms:created>/);
      if (createdMatch) metadata.creationDate = this.formatDate(createdMatch[1]);

      const modifiedMatch = coreXml.match(/<dcterms:modified[^>]*>([^<]*)<\/dcterms:modified>/);
      if (modifiedMatch) metadata.modificationDate = this.formatDate(modifiedMatch[1]);

      const appXml = await zip.file("docProps/app.xml")?.async("string");
      if (appXml) {
        const pagesMatch = appXml.match(/<Pages>(\d+)<\/Pages>/);
        if (pagesMatch) metadata.pages = parseInt(pagesMatch[1], 10);
        
        const wordsMatch = appXml.match(/<Words>(\d+)<\/Words>/);
        if (wordsMatch) metadata.wordCount = parseInt(wordsMatch[1], 10);
      }

      return metadata;
    } catch (error) {
      console.warn("[DocxParser] Could not extract metadata:", error);
      return {};
    }
  }

  private formatDate(isoDate: string): string {
    try {
      const date = new Date(isoDate);
      return date.toISOString().split('T')[0];
    } catch {
      return isoDate;
    }
  }

  private htmlToStructuredText(html: string): string {
    // Security: limit input HTML size for processing
    const safeHtml =
      html.length > DocxParser.MAX_EXTRACTED_TEXT_BYTES
        ? html.substring(0, DocxParser.MAX_EXTRACTED_TEXT_BYTES)
        : html;

    let processed = safeHtml
      .replace(/<h1[^>]*class="title"[^>]*>(.*?)<\/h1>/gi, (_, content) => `# ${this.stripTags(content)}\n\n`)
      .replace(/<h1[^>]*>(.*?)<\/h1>/gi, (_, content) => `# ${this.stripTags(content)}\n\n`)
      .replace(/<h2[^>]*class="subtitle"[^>]*>(.*?)<\/h2>/gi, (_, content) => `## ${this.stripTags(content)}\n\n`)
      .replace(/<h2[^>]*>(.*?)<\/h2>/gi, (_, content) => `## ${this.stripTags(content)}\n\n`)
      .replace(/<h3[^>]*>(.*?)<\/h3>/gi, (_, content) => `### ${this.stripTags(content)}\n\n`)
      .replace(/<h4[^>]*>(.*?)<\/h4>/gi, (_, content) => `#### ${this.stripTags(content)}\n\n`)
      .replace(/<h5[^>]*>(.*?)<\/h5>/gi, (_, content) => `##### ${this.stripTags(content)}\n\n`)
      .replace(/<h6[^>]*>(.*?)<\/h6>/gi, (_, content) => `###### ${this.stripTags(content)}\n\n`);

    processed = this.convertTables(processed);
    processed = this.convertLists(processed);
    
    processed = processed
      .replace(/<p[^>]*>(.*?)<\/p>/gi, (_, content) => `${this.stripTags(content)}\n\n`)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
      .replace(/<b>(.*?)<\/b>/gi, '**$1**')
      .replace(/<em>(.*?)<\/em>/gi, '*$1*')
      .replace(/<i>(.*?)<\/i>/gi, '*$1*')
      .replace(/<u>(.*?)<\/u>/gi, '_$1_');

    processed = this.stripTags(processed);
    processed = processed
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return processed;
  }

  private convertTables(html: string): string {
    return html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableContent) => {
      const rows: string[][] = [];
      const rowMatches = tableContent.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
      
      for (const rowMatch of rowMatches) {
        const cells: string[] = [];
        const cellMatches = rowMatch[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi);
        
        for (const cellMatch of cellMatches) {
          cells.push(this.stripTags(cellMatch[1]).trim());
        }
        
        if (cells.length > 0) {
          rows.push(cells);
        }
      }

      if (rows.length === 0) return '';

      const maxCols = Math.max(...rows.map(r => r.length));
      const normalizedRows = rows.map(row => {
        while (row.length < maxCols) row.push('');
        return row;
      });

      let markdown = '\n\n';
      markdown += '| ' + normalizedRows[0].join(' | ') + ' |\n';
      markdown += '| ' + normalizedRows[0].map(() => '---').join(' | ') + ' |\n';
      
      for (let i = 1; i < normalizedRows.length; i++) {
        markdown += '| ' + normalizedRows[i].join(' | ') + ' |\n';
      }
      
      return markdown + '\n';
    });
  }

  private convertLists(html: string): string {
    let result = html;
    
    result = result.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, listContent) => {
      let counter = 1;
      const items = listContent.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_: string, itemContent: string) => {
        return `${counter++}. ${this.stripTags(itemContent).trim()}\n`;
      });
      return '\n' + items + '\n';
    });

    result = result.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, listContent) => {
      const items = listContent.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_: string, itemContent: string) => {
        return `- ${this.stripTags(itemContent).trim()}\n`;
      });
      return '\n' + items + '\n';
    });

    return result;
  }

  private stripTags(html: string): string {
    return sanitizePlainText(html, { maxLen: 5_000_000, collapseWs: true });
  }

  private formatOutput(metadata: Record<string, any>, content: string): string {
    const parts: string[] = [];
    
    if (Object.keys(metadata).length > 0) {
      parts.push('=== Document Info ===');
      if (metadata.title) parts.push(`Title: ${metadata.title}`);
      if (metadata.author) parts.push(`Author: ${metadata.author}`);
      if (metadata.creationDate) parts.push(`Created: ${metadata.creationDate}`);
      if (metadata.pages) parts.push(`Pages: ${metadata.pages}`);
      if (metadata.wordCount) parts.push(`Word Count: ${metadata.wordCount}`);
      parts.push('');
      parts.push('=== Content ===');
    }
    
    parts.push(content);

    return parts.join('\n').trim();
  }
}
