import { ObjectStorageService, ObjectNotFoundError } from "../replit_integrations/object_storage/objectStorage";
import { PdfParser } from "../parsers/pdfParser";
import { DocxParser } from "../parsers/docxParser";
import { XlsxParser } from "../parsers/xlsxParser";
import { PptxParser } from "../parsers/pptxParser";
import { TextParser } from "../parsers/textParser";
import type { DetectedFileType } from "../parsers/base";

export interface Attachment {
  type: string;
  name: string;
  mimeType: string;
  storagePath: string;
  fileId?: string;
}

export interface ExtractedContent {
  fileName: string;
  content: string;
  mimeType: string;
  documentType?: string;
  metadata?: Record<string, any>;
}

const objectStorageService = new ObjectStorageService();

const pdfParser = new PdfParser();
const docxParser = new DocxParser();
const xlsxParser = new XlsxParser();
const pptxParser = new PptxParser();
const textParser = new TextParser();

const MIME_TYPE_MAP: Record<string, { parser: any; docType: string; ext: string }> = {
  "application/pdf": { parser: pdfParser, docType: "PDF", ext: "pdf" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { parser: docxParser, docType: "Word", ext: "docx" },
  "application/msword": { parser: docxParser, docType: "Word", ext: "doc" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { parser: xlsxParser, docType: "Excel", ext: "xlsx" },
  "application/vnd.ms-excel": { parser: xlsxParser, docType: "Excel", ext: "xls" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { parser: pptxParser, docType: "PowerPoint", ext: "pptx" },
  "application/vnd.ms-powerpoint": { parser: pptxParser, docType: "PowerPoint", ext: "ppt" },
  "text/plain": { parser: textParser, docType: "Text", ext: "txt" },
  "text/markdown": { parser: textParser, docType: "Markdown", ext: "md" },
  "text/md": { parser: textParser, docType: "Markdown", ext: "md" },
  "text/csv": { parser: textParser, docType: "CSV", ext: "csv" },
  "text/html": { parser: textParser, docType: "HTML", ext: "html" },
  "application/json": { parser: textParser, docType: "JSON", ext: "json" },
};

function getExtensionFromFileName(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

function inferMimeTypeFromExtension(ext: string): string | null {
  const extMap: Record<string, string> = {
    'pdf': 'application/pdf',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'doc': 'application/msword',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'xls': 'application/vnd.ms-excel',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'ppt': 'application/vnd.ms-powerpoint',
    'txt': 'text/plain',
    'md': 'text/markdown',
    'markdown': 'text/markdown',
    'csv': 'text/csv',
    'html': 'text/html',
    'htm': 'text/html',
    'json': 'application/json',
  };
  return extMap[ext] || null;
}

export async function extractAttachmentContent(attachment: Attachment): Promise<ExtractedContent | null> {
  try {
    if (!attachment.storagePath) {
      console.log(`[AttachmentService] No storage path for attachment: ${attachment.name}`);
      return null;
    }

    const buffer = await objectStorageService.getObjectEntityBuffer(attachment.storagePath);
    
    let mimeType = attachment.mimeType;
    const ext = getExtensionFromFileName(attachment.name);
    
    if (!MIME_TYPE_MAP[mimeType] && ext) {
      const inferredMime = inferMimeTypeFromExtension(ext);
      if (inferredMime) {
        console.log(`[AttachmentService] Inferred MIME type from extension: ${ext} -> ${inferredMime}`);
        mimeType = inferredMime;
      }
    }
    
    if (mimeType?.startsWith('text/') && !MIME_TYPE_MAP[mimeType]) {
      mimeType = 'text/plain';
    }

    const parserConfig = MIME_TYPE_MAP[mimeType];
    
    if (parserConfig) {
      console.log(`[AttachmentService] Parsing ${parserConfig.docType}: ${attachment.name}, size: ${buffer.length} bytes`);
      
      const detectedType: DetectedFileType = {
        mimeType: mimeType,
        extension: ext || parserConfig.ext,
        confidence: 1.0
      };
      
      const result = await parserConfig.parser.parse(buffer, detectedType);
      
      return {
        fileName: attachment.name,
        content: result.text,
        mimeType: mimeType,
        documentType: parserConfig.docType,
        metadata: result.metadata
      };
    }
    
    if (mimeType?.startsWith("text/") || mimeType === "application/octet-stream") {
      try {
        const textContent = buffer.toString("utf-8");
        if (textContent && !textContent.includes('\ufffd')) {
          console.log(`[AttachmentService] Fallback text extraction for: ${attachment.name}`);
          return {
            fileName: attachment.name,
            content: textContent,
            mimeType: mimeType,
            documentType: "Text"
          };
        }
      } catch (e) {
        console.log(`[AttachmentService] Could not decode as text: ${attachment.name}`);
      }
    }
    
    console.log(`[AttachmentService] Unsupported MIME type: ${mimeType} for file: ${attachment.name}`);
    return null;
  } catch (error) {
    console.error(`[AttachmentService] Error extracting content from ${attachment.name}:`, error);
    if (error instanceof ObjectNotFoundError) {
      console.log(`[AttachmentService] File not found: ${attachment.storagePath}`);
    }
    return null;
  }
}

export async function extractAllAttachmentsContent(attachments: Attachment[]): Promise<ExtractedContent[]> {
  const results: ExtractedContent[] = [];
  
  for (const attachment of attachments) {
    const content = await extractAttachmentContent(attachment);
    if (content) {
      results.push(content);
    }
  }
  
  return results;
}

export function formatAttachmentsAsContext(extractedContents: ExtractedContent[]): string {
  if (extractedContents.length === 0) return "";
  
  const parts: string[] = [];
  parts.push("\n\n=== DOCUMENTOS ADJUNTOS ===\n");
  
  for (const content of extractedContents) {
    const typeLabel = content.documentType ? ` (${content.documentType})` : '';
    parts.push(`\n--- Archivo: ${content.fileName}${typeLabel} ---\n`);
    parts.push(content.content);
    parts.push("\n--- Fin del archivo ---\n");
  }
  
  return parts.join("");
}

export function getSupportedMimeTypes(): string[] {
  return Object.keys(MIME_TYPE_MAP);
}

export function isSupportedMimeType(mimeType: string): boolean {
  if (MIME_TYPE_MAP[mimeType]) return true;
  if (mimeType?.startsWith('text/')) return true;
  return false;
}
