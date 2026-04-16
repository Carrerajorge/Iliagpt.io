import type { FileParser, ParsedResult, DetectedFileType } from "./base";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");

// Security limits
const PDF_MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const PDF_MAX_EXTRACTED_TEXT = 10 * 1024 * 1024; // 10MB max extracted text
const PDF_MAX_METADATA_VALUE_LENGTH = 1000;

/** Sanitize metadata values */
function sanitizeMetadataValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .substring(0, PDF_MAX_METADATA_VALUE_LENGTH) || undefined;
}

export class PdfParser implements FileParser {
  name = "pdf";
  supportedMimeTypes = ["application/pdf"];
  private readonly TIMEOUT_MS = 60000;

  async parse(content: Buffer, type: DetectedFileType): Promise<ParsedResult> {
    const startTime = Date.now();
    console.log(`[PdfParser] Starting PDF parse, size: ${content.length} bytes`);

    // Security: enforce file size limit
    if (content.length > PDF_MAX_FILE_SIZE) {
      throw new Error(`PDF file exceeds maximum size of ${PDF_MAX_FILE_SIZE / (1024 * 1024)}MB`);
    }

    let timeoutId: NodeJS.Timeout | null = null;
    
    try {
      const parsePromise = this.parsePdf(content);
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`PDF parsing timed out after ${this.TIMEOUT_MS}ms`)), this.TIMEOUT_MS);
      });

      const result = await Promise.race([parsePromise, timeoutPromise]);
      
      if (timeoutId) clearTimeout(timeoutId);
      
      const elapsed = Date.now() - startTime;
      console.log(`[PdfParser] Completed in ${elapsed}ms`);
      
      return result;
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      const elapsed = Date.now() - startTime;
      console.error(`[PdfParser] Failed after ${elapsed}ms:`, error);
      
      if (error instanceof Error) {
        if (error.message.includes('timed out')) {
          throw new Error(`PDF parsing timed out - file may be too large or complex (${Math.round(content.length / 1024)}KB)`);
        }
        throw new Error(`Failed to parse PDF: ${error.message}`);
      }
      throw new Error("Failed to parse PDF: Unknown error");
    }
  }

  private async parsePdf(content: Buffer): Promise<ParsedResult> {
    const parser = new PDFParse({ data: content });
    const data = await parser.getText();
    
    // Security: limit extracted text size
    const rawText = data.text || '';
    const text = this.normalizeText(rawText.length > PDF_MAX_EXTRACTED_TEXT ? rawText.substring(0, PDF_MAX_EXTRACTED_TEXT) : rawText);
    const metadata = this.extractMetadata(data);
    const formattedText = this.formatOutput(metadata, text, data.numpages || 0);

    return {
      text: formattedText,
      metadata: {
        pages: data.numpages || 0,
        title: metadata.title,
        author: metadata.author,
        creationDate: metadata.creationDate,
        producer: metadata.producer,
        info: data.info || {},
      },
    };
  }

  private normalizeText(text: string): string {
    return text
      .replace(/\u0000/g, '')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u2013/g, '-')
      .replace(/\u2014/g, '--')
      .replace(/\u2026/g, '...')
      .replace(/\u00A0/g, ' ')
      .normalize('NFKC');
  }

  private extractMetadata(data: any): Record<string, string | undefined> {
    const info = data.info || {};
    
    // Security: sanitize all metadata values
    return {
      title: sanitizeMetadataValue(info.Title),
      author: sanitizeMetadataValue(info.Author),
      creationDate: this.formatPdfDate(info.CreationDate),
      modificationDate: this.formatPdfDate(info.ModDate),
      producer: sanitizeMetadataValue(info.Producer),
      creator: sanitizeMetadataValue(info.Creator),
      subject: sanitizeMetadataValue(info.Subject),
      keywords: sanitizeMetadataValue(info.Keywords),
    };
  }

  private formatPdfDate(dateStr: string | undefined): string | undefined {
    if (!dateStr) return undefined;
    
    const match = dateStr.match(/D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
    if (match) {
      const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
      return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    }
    return dateStr;
  }

  private formatOutput(metadata: Record<string, string | undefined>, text: string, totalPages: number): string {
    const parts: string[] = [];
    
    parts.push('=== Document Info ===');
    if (metadata.title) parts.push(`Title: ${metadata.title}`);
    if (metadata.author) parts.push(`Author: ${metadata.author}`);
    if (metadata.creationDate) parts.push(`Created: ${metadata.creationDate}`);
    if (metadata.subject) parts.push(`Subject: ${metadata.subject}`);
    parts.push(`Pages: ${totalPages}`);
    parts.push('');
    parts.push('=== Content ===');
    parts.push(text);

    return parts.join('\n').trim();
  }
}
