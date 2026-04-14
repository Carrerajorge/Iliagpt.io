import { ObjectStorageService, ObjectNotFoundError } from "../replit_integrations/object_storage/objectStorage";
import { PdfParser } from "../parsers/pdfParser";
import { DocxParser } from "../parsers/docxParser";
import { XlsxParser } from "../parsers/xlsxParser";
import { PptxParser } from "../parsers/pptxParser";
import { TextParser } from "../parsers/textParser";
import { CsvParser } from "../parsers/csvParser";
import type { DetectedFileType, FileParser, ParsedResult } from "../parsers/base";
import { runParserInSandbox, SandboxErrorCode, type SandboxOptions } from "../lib/parserSandbox";
import { detectMime, type MimeDetectionResult } from "../lib/mimeDetector";
import { validateZipDocument } from "../lib/zipBombGuard";
import { ParserRegistry, createParserRegistry } from "../lib/parserRegistry";
import { validateAttachmentSecurity, type SecurityValidationResult, type SecurityViolation, SecurityViolationType } from "../lib/pareSecurityGuard";

export interface SimpleAttachment {
  name: string;
  mimeType: string;
  storagePath: string;
  content?: string;
}

export interface DocumentChunk {
  docId: string;
  filename: string;
  location: { page?: number; sheet?: string; slide?: number; row?: number; cell?: string };
  content: string;
  offsets: { start: number; end: number };
}

export interface DocumentProcessingStats {
  filename: string;
  bytesRead: number;
  pagesProcessed: number;
  tokensExtracted: number;
  parseTimeMs: number;
  chunkCount: number;
  status: 'success' | 'failed' | 'security_violation';
  error?: string;
  securityChecks?: {
    mimeValidation: boolean;
    zipBombCheck: boolean;
    pathTraversalCheck: boolean;
    dangerousFormatCheck: boolean;
    sandboxed: boolean;
  };
  securityViolations?: SecurityViolation[];
}

export interface BatchProcessingResult {
  attachmentsCount: number;
  processedFiles: number;
  failedFiles: { filename: string; error: string }[];
  chunks: DocumentChunk[];
  stats: DocumentProcessingStats[];
  unifiedContext: string;
  totalTokens: number;
}

interface ParserConfig {
  parser: FileParser;
  docType: string;
  ext: string;
}

const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;

const ZIP_BASED_EXTENSIONS = ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'];

const DEFAULT_SANDBOX_OPTIONS: Partial<SandboxOptions> = {
  timeoutMs: 30000,
  softMemoryLimitMB: 256,
  hardMemoryLimitMB: 512,
};

export class DocumentBatchProcessor {
  private objectStorageService: ObjectStorageService;
  private pdfParser: PdfParser;
  private docxParser: DocxParser;
  private xlsxParser: XlsxParser;
  private pptxParser: PptxParser;
  private textParser: TextParser;
  private csvParser: CsvParser;
  private mimeTypeMap: Record<string, ParserConfig>;
  private chunkIndex: Map<string, DocumentChunk>;
  private parserRegistry: ParserRegistry;
  private sandboxOptions: Partial<SandboxOptions>;
  private enableSecurityChecks: boolean;

  constructor(options?: { sandboxOptions?: Partial<SandboxOptions>; enableSecurityChecks?: boolean }) {
    this.objectStorageService = new ObjectStorageService();
    this.pdfParser = new PdfParser();
    this.docxParser = new DocxParser();
    this.xlsxParser = new XlsxParser();
    this.pptxParser = new PptxParser();
    this.textParser = new TextParser();
    this.csvParser = new CsvParser();
    this.chunkIndex = new Map();
    this.sandboxOptions = options?.sandboxOptions || DEFAULT_SANDBOX_OPTIONS;
    this.enableSecurityChecks = options?.enableSecurityChecks ?? true;

    this.mimeTypeMap = {
      "application/pdf": { parser: this.pdfParser, docType: "PDF", ext: "pdf" },
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { parser: this.docxParser, docType: "Word", ext: "docx" },
      "application/msword": { parser: this.docxParser, docType: "Word", ext: "doc" },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { parser: this.xlsxParser, docType: "Excel", ext: "xlsx" },
      "application/vnd.ms-excel": { parser: this.xlsxParser, docType: "Excel", ext: "xls" },
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": { parser: this.pptxParser, docType: "PowerPoint", ext: "pptx" },
      "application/vnd.ms-powerpoint": { parser: this.pptxParser, docType: "PowerPoint", ext: "ppt" },
      "text/plain": { parser: this.textParser, docType: "Text", ext: "txt" },
      "text/markdown": { parser: this.textParser, docType: "Markdown", ext: "md" },
      "text/md": { parser: this.textParser, docType: "Markdown", ext: "md" },
      "text/csv": { parser: this.csvParser, docType: "CSV", ext: "csv" },
      "application/csv": { parser: this.csvParser, docType: "CSV", ext: "csv" },
      "text/html": { parser: this.textParser, docType: "HTML", ext: "html" },
      "application/json": { parser: this.textParser, docType: "JSON", ext: "json" },
    };

    this.parserRegistry = createParserRegistry({
      circuitBreakerThreshold: 5,
      circuitBreakerResetMs: 60000,
      fallbackEnabled: true,
    });

    this.initializeParserRegistry();
  }

  private initializeParserRegistry(): void {
    this.parserRegistry.registerParser(
      ["application/pdf"],
      this.pdfParser,
      10
    );

    this.parserRegistry.registerParser(
      [
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
      ],
      this.docxParser,
      10
    );

    this.parserRegistry.registerParser(
      [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
      ],
      this.xlsxParser,
      10
    );

    this.parserRegistry.registerParser(
      [
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.ms-powerpoint",
      ],
      this.pptxParser,
      10
    );

    this.parserRegistry.registerParser(
      ["text/csv", "application/csv"],
      this.csvParser,
      10
    );

    this.parserRegistry.registerParser(
      ["text/plain", "text/markdown", "text/md", "text/html", "application/json"],
      this.textParser,
      100
    );

    this.parserRegistry.setFallbackParser(this.textParser);
  }

  async processBatch(attachments: SimpleAttachment[]): Promise<BatchProcessingResult> {
    console.log(`[DocumentBatchProcessor] Starting batch processing of ${attachments.length} attachments (security checks: ${this.enableSecurityChecks})`);
    const startTime = Date.now();

    const result: BatchProcessingResult = {
      attachmentsCount: attachments.length,
      processedFiles: 0,
      failedFiles: [],
      chunks: [],
      stats: [],
      unifiedContext: "",
      totalTokens: 0,
    };

    this.chunkIndex.clear();

    for (let i = 0; i < attachments.length; i++) {
      const attachment = attachments[i];
      const docId = this.generateDocId(attachment.name, i);
      const fileStartTime = Date.now();
      const securityChecks = {
        mimeValidation: false,
        zipBombCheck: false,
        pathTraversalCheck: false,
        dangerousFormatCheck: false,
        sandboxed: false,
      };
      let securityViolations: SecurityViolation[] = [];

      try {
        let normalized: string;
        let parsed: ParsedResult;
        let buffer: Buffer;
        let bytesRead = 0;
        
        const audioFormats = ['mp3', 'wav', 'ogg', 'webm', 'm4a', 'flac', 'aac', 'mp4'];
        const binaryFormats = ['pdf', 'xlsx', 'xls', 'docx', 'doc', 'pptx', 'ppt'];
        const ext = this.getExtensionFromFileName(attachment.name);
        const isAudioFormat = audioFormats.includes(ext) || attachment.mimeType.startsWith('audio/');
        const isBinaryFormat = binaryFormats.includes(ext);
        
        if (isAudioFormat) {
          if (!attachment.storagePath) {
            throw new Error(`No storage path provided for audio file: ${attachment.name}`);
          }
          buffer = await this.fetchDocument(attachment.storagePath);
          bytesRead = buffer.length;

          const transcribedText = await this.transcribeAudio(buffer, attachment.name);
          normalized = transcribedText;
          parsed = { text: transcribedText, metadata: { pages: 1, type: 'audio' } };

        } else if (isBinaryFormat || !attachment.content || attachment.content.trim().length === 0) {
          if (!attachment.storagePath) {
            throw new Error(`No storage path provided for binary file: ${attachment.name}`);
          }
          buffer = await this.fetchDocument(attachment.storagePath);
          bytesRead = buffer.length;

          let mimeDetectionResult: MimeDetectionResult | undefined;
          
          if (this.enableSecurityChecks) {
            const securityResult = await validateAttachmentSecurity({
              filename: attachment.name,
              buffer,
              providedMimeType: attachment.mimeType,
            });
            
            securityChecks.mimeValidation = securityResult.checksPerformed.mimeValidation;
            securityChecks.zipBombCheck = securityResult.checksPerformed.zipBombCheck;
            securityChecks.pathTraversalCheck = securityResult.checksPerformed.pathTraversalCheck;
            securityChecks.dangerousFormatCheck = securityResult.checksPerformed.dangerousFormatCheck;
            securityViolations = securityResult.violations;
            mimeDetectionResult = securityResult.mimeDetection;
            
            if (!securityResult.safe) {
              const criticalViolations = securityResult.violations.filter(v => 
                v.severity === 'critical' || v.severity === 'high'
              );
              
              if (criticalViolations.length > 0) {
                const violationMessages = criticalViolations.map(v => v.message).join('; ');
                throw new Error(`Security violation: ${violationMessages}`);
              }
            }
          } else {
            mimeDetectionResult = detectMime(buffer, attachment.name, attachment.mimeType);
            securityChecks.mimeValidation = true;
          }

          const detectedMimeType = mimeDetectionResult?.detectedMime || 
            this.detectMimeFromFilename(attachment.name, attachment.mimeType);
          
          const parserConfig = this.selectParser(detectedMimeType);
          
          if (!parserConfig) {
            throw new Error(`Unsupported MIME type: ${detectedMimeType} for file ${attachment.name}`);
          }

          parsed = await this.extractContentWithSandbox(
            buffer, 
            parserConfig, 
            attachment.name,
            securityChecks
          );
          normalized = this.normalizeContent(parsed.text);
        } else {
          bytesRead = Buffer.byteLength(attachment.content, 'utf8');
          buffer = Buffer.from(attachment.content, 'utf8');
          
          if (this.enableSecurityChecks) {
            const securityResult = await validateAttachmentSecurity({
              filename: attachment.name,
              buffer,
              providedMimeType: attachment.mimeType,
            });
            
            securityChecks.mimeValidation = securityResult.checksPerformed.mimeValidation;
            securityChecks.dangerousFormatCheck = securityResult.checksPerformed.dangerousFormatCheck;
            securityViolations = securityResult.violations;
            
            if (!securityResult.safe) {
              const criticalViolations = securityResult.violations.filter(v => 
                v.severity === 'critical' || v.severity === 'high'
              );
              
              if (criticalViolations.length > 0) {
                const violationMessages = criticalViolations.map(v => v.message).join('; ');
                throw new Error(`Security violation: ${violationMessages}`);
              }
            }
          }
          
          const mimeType = this.detectMimeFromFilename(attachment.name, attachment.mimeType);
          const parserConfig = this.selectParser(mimeType);
          
          if (!parserConfig) {
            throw new Error(`Unsupported MIME type: ${mimeType} for file ${attachment.name}`);
          }
          
          if (ext === 'csv' && this.csvParser) {
            parsed = await this.csvParser.parse(buffer, attachment.name);
            normalized = this.normalizeContent(parsed.text);
          } else {
            normalized = this.normalizeContent(attachment.content);
            parsed = { text: normalized, metadata: { parser_used: parserConfig.parser.name } };
          }
        }
        
        const parserConfig = this.selectParser(this.detectMimeFromFilename(attachment.name, attachment.mimeType));
        const docType = parserConfig?.docType || "Text";
        
        const chunks = this.chunkDocument(normalized, docId, attachment.name, docType, parsed.metadata);
        
        this.indexChunks(chunks);
        result.chunks.push(...chunks);

        const parseTimeMs = Date.now() - fileStartTime;
        const tokensExtracted = this.estimateTokens(normalized);

        result.stats.push({
          filename: attachment.name,
          bytesRead,
          pagesProcessed: parsed.metadata?.pages || parsed.metadata?.slideCount || parsed.metadata?.sheetCount || 1,
          tokensExtracted,
          parseTimeMs,
          chunkCount: chunks.length,
          status: 'success',
          securityChecks,
          securityViolations: securityViolations.length > 0 ? securityViolations : undefined,
        });

        result.processedFiles++;
        result.totalTokens += tokensExtracted;

        console.log(`[DocumentBatchProcessor] Processed ${attachment.name}: ${chunks.length} chunks, ${tokensExtracted} tokens`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        // Avoid externally-controlled format string via console formatting.
        console.error("[DocumentBatchProcessor] Failed to process attachment", {
          filename: attachment.name,
          error: errorMessage,
        });

        result.failedFiles.push({
          filename: attachment.name,
          error: errorMessage,
        });

        const isSecurityViolation = errorMessage.includes('Security violation') || 
          securityViolations.some(v => v.severity === 'critical' || v.severity === 'high');
        
        result.stats.push({
          filename: attachment.name,
          bytesRead: 0,
          pagesProcessed: 0,
          tokensExtracted: 0,
          parseTimeMs: Date.now() - fileStartTime,
          chunkCount: 0,
          status: isSecurityViolation ? 'security_violation' : 'failed',
          error: errorMessage,
          securityChecks,
          securityViolations: securityViolations.length > 0 ? securityViolations : undefined,
        });
      }
    }

    result.unifiedContext = this.buildUnifiedContext(result.chunks);

    const totalTime = Date.now() - startTime;
    console.log(`[DocumentBatchProcessor] Batch complete in ${totalTime}ms: ${result.processedFiles}/${attachments.length} files, ${result.chunks.length} chunks, ${result.totalTokens} tokens`);

    return result;
  }

  private async extractContentWithSandbox(
    buffer: Buffer,
    parserConfig: ParserConfig,
    filename: string,
    securityChecks: { mimeValidation: boolean; zipBombCheck: boolean; pathTraversalCheck: boolean; dangerousFormatCheck: boolean; sandboxed: boolean }
  ): Promise<ParsedResult> {
    const ext = this.getExtensionFromFileName(filename) || parserConfig.ext;

    const detectedType: DetectedFileType = {
      mimeType: Object.keys(this.mimeTypeMap).find(k => this.mimeTypeMap[k] === parserConfig) || "",
      extension: ext,
      confidence: 1.0,
    };

    if (this.enableSecurityChecks) {
      securityChecks.sandboxed = true;
      
      const sandboxResult = await runParserInSandbox(
        parserConfig.parser,
        buffer,
        detectedType,
        this.sandboxOptions
      );

      if (!sandboxResult.success) {
        if (sandboxResult.errorCode === SandboxErrorCode.TIMEOUT) {
          throw new Error(`Parser timeout: ${filename} took too long to process`);
        }
        if (sandboxResult.errorCode === SandboxErrorCode.MEMORY_EXCEEDED) {
          throw new Error(`Memory limit exceeded while parsing: ${filename}`);
        }
        throw new Error(sandboxResult.error || 'Parser failed');
      }

      return {
        ...sandboxResult.result!,
        metadata: {
          ...sandboxResult.result?.metadata,
          sandbox_metrics: sandboxResult.metrics,
        },
      };
    }

    return parserConfig.parser.parse(buffer, detectedType);
  }

  private async fetchDocument(storagePath: string): Promise<Buffer> {
    if (!storagePath) {
      throw new Error("No storage path provided");
    }

    // Try object storage first
    try {
      return await this.objectStorageService.getObjectEntityBuffer(storagePath);
    } catch (error) {
      // Fall through to local fallback
      console.log(`[DocumentBatchProcessor] Object storage failed for ${storagePath}, trying local fallback`);
    }

    // Local file fallback (development / local storage mode)
    try {
      const fs = await import("fs");
      const pathMod = await import("path");
      const uploadsDir = pathMod.default.resolve(process.cwd(), "uploads");

      const localCandidates: string[] = [];
      if (storagePath.startsWith('/objects/uploads/')) {
        localCandidates.push(pathMod.default.join(uploadsDir, storagePath.replace('/objects/uploads/', '')));
      }
      if (storagePath.startsWith('/objects/')) {
        localCandidates.push(pathMod.default.join(uploadsDir, storagePath.replace('/objects/', '')));
      }

      for (const localPath of localCandidates) {
        // Security: ensure resolved path stays within uploads directory
        const safePrefix = uploadsDir + pathMod.default.sep;
        if (!localPath.startsWith(safePrefix) && localPath !== uploadsDir) {
          continue;
        }

        if (fs.default.existsSync(localPath)) {
          const content = await fs.promises.readFile(localPath);
          if (content.length > 0) {
            console.log(`[DocumentBatchProcessor] Read ${content.length} bytes from local: ${localPath}`);
            return content;
          }
        }
      }
    } catch (localError) {
      console.warn(`[DocumentBatchProcessor] Local fallback also failed for ${storagePath}:`, localError);
    }

    throw new Error(`File not found in any storage: ${storagePath}`);
  }

  private detectMimeFromFilename(filename: string, providedMimeType: string): string {
    if (this.mimeTypeMap[providedMimeType]) {
      return providedMimeType;
    }
    
    const ext = this.getExtensionFromFileName(filename);
    const inferredMime = this.inferMimeTypeFromExtension(ext);
    if (inferredMime && this.mimeTypeMap[inferredMime]) {
      return inferredMime;
    }
    
    if (providedMimeType?.startsWith('text/')) {
      return 'text/plain';
    }
    
    return providedMimeType || 'application/octet-stream';
  }

  private async transcribeAudio(buffer: Buffer, filename: string): Promise<string> {
    const MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024;
    if (buffer.length > MAX_AUDIO_SIZE_BYTES) {
      const sizeMB = (buffer.length / (1024 * 1024)).toFixed(1);
      return `[Audio: "${filename}" (${sizeMB}MB) — El archivo excede el límite de ${MAX_AUDIO_SIZE_BYTES / (1024 * 1024)}MB para transcripción. Por favor sube un archivo más corto.]`;
    }

    if (process.env.OPENAI_API_KEY) {
      try {
        const { AudioPipeline } = await import("../multimodal/AudioPipeline");
        const pipeline = new AudioPipeline();
        const result = await pipeline.transcribe(buffer, filename, {
          language: "es",
          generateSummary: false,
          analyzeSentiment: false,
          detectSpeakers: true,
        });

        const header = `[Transcripción de audio: "${filename}" — Duración: ${Math.round(result.duration / 60)} min ${Math.round(result.duration % 60)} seg — Idioma: ${result.language}]`;

        let transcriptionText = `${header}\n\n${result.fullText}`;

        if (result.speakers && result.speakers.length > 1 && result.segments.length > 0) {
          transcriptionText += "\n\n[Segmentos por hablante]:\n";
          for (const seg of result.segments) {
            const speaker = seg.speaker || "Hablante";
            transcriptionText += `${speaker} (${seg.start.toFixed(1)}s - ${seg.end.toFixed(1)}s): ${seg.text}\n`;
          }
        }

        if (result.keywords && result.keywords.length > 0) {
          transcriptionText += `\n[Palabras clave]: ${result.keywords.join(", ")}`;
        }

        return transcriptionText;
      } catch (err: any) {
        console.error(`[DocumentBatchProcessor] Whisper transcription failed for ${filename}:`, err.message);
      }
    }

    try {
      return await this.transcribeWithGemini(buffer, filename);
    } catch (geminiErr: any) {
      console.error(`[DocumentBatchProcessor] Gemini audio transcription failed for ${filename}:`, geminiErr.message);
      return `[Audio: "${filename}" — No se pudo transcribir. Asegúrese de tener configurada una API de transcripción (OpenAI/Whisper o Gemini)]`;
    }
  }

  private async transcribeWithGemini(buffer: Buffer, filename: string): Promise<string> {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      throw new Error("No Gemini API key available for audio transcription");
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const ext = filename.split('.').pop()?.toLowerCase() || 'mp3';
    const mimeMap: Record<string, string> = {
      mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
      webm: "audio/webm", m4a: "audio/mp4", flac: "audio/flac",
      aac: "audio/aac", mp4: "audio/mp4",
    };

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: mimeMap[ext] || "audio/mpeg",
          data: buffer.toString("base64"),
        },
      },
      {
        text: "Transcribe este audio completo en el idioma original. Devuelve SOLO la transcripción textual, sin comentarios adicionales. Si detectas varios hablantes, indícalos con etiquetas como [Hablante 1], [Hablante 2], etc.",
      },
    ]);

    const transcription = result.response.text();

    if (!transcription || transcription.trim().length === 0) {
      throw new Error("Gemini returned empty transcription");
    }

    return `[Transcripción de audio: "${filename}" — Transcrito con Gemini]\n\n${transcription}`;
  }

  private selectParser(mimeType: string): ParserConfig | null {
    return this.mimeTypeMap[mimeType] || null;
  }

  private normalizeContent(text: string): string {
    return text
      .replace(/\u0000/g, '')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u2013/g, '-')
      .replace(/\u2014/g, '--')
      .replace(/\u2026/g, '...')
      .replace(/\u00A0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .normalize('NFKC')
      .trim();
  }

  private chunkDocument(
    content: string,
    docId: string,
    filename: string,
    docType: string,
    metadata?: Record<string, any>
  ): DocumentChunk[] {
    const ext = this.getExtensionFromFileName(filename).toLowerCase();

    if (docType === "Excel" && metadata?.sheets) {
      return this.chunkExcelDocument(content, docId, filename, metadata);
    }

    if (docType === "PowerPoint") {
      return this.chunkPowerPointDocument(content, docId, filename, metadata);
    }

    if (ext === "csv") {
      return this.chunkCSVDocument(content, docId, filename);
    }

    const pages = content.split(/(?:=== Page \d+ ===|--- Page \d+ ---)/i);
    
    if (pages.length > 1) {
      return this.chunkPagedDocument(pages, docId, filename);
    }

    return this.chunkTextDocument(content, docId, filename);
  }

  private chunkExcelDocument(
    content: string,
    docId: string,
    filename: string,
    metadata: Record<string, any>
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const sheetSections = content.split(/(?=### Sheet: )/);

    for (const section of sheetSections) {
      const sheetMatch = section.match(/### Sheet: ([^\n]+)/);
      const sheetName = sheetMatch ? sheetMatch[1].trim() : "Sheet1";

      const lines = section.split('\n');
      let currentOffset = 0;

      for (let i = 0; i < lines.length; i += Math.floor(CHUNK_SIZE / 50)) {
        const chunkLines = lines.slice(i, i + Math.floor(CHUNK_SIZE / 50));
        const chunkContent = chunkLines.join('\n').trim();

        if (chunkContent) {
          const rowMatch = chunkLines[0]?.match(/^\|?\s*(\d+)/);
          const row = rowMatch ? parseInt(rowMatch[1], 10) : i + 1;

          chunks.push({
            docId,
            filename,
            location: { sheet: sheetName, row, cell: `A${row}` },
            content: chunkContent,
            offsets: { start: currentOffset, end: currentOffset + chunkContent.length },
          });

          currentOffset += chunkContent.length;
        }
      }
    }

    return chunks.length > 0 ? chunks : this.chunkTextDocument(content, docId, filename);
  }

  private chunkPowerPointDocument(
    content: string,
    docId: string,
    filename: string,
    metadata?: Record<string, any>
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const slideSections = content.split(/(?=## Slide \d+)/);

    for (const section of slideSections) {
      const slideMatch = section.match(/## Slide (\d+)/);
      if (!slideMatch) continue;

      const slideNumber = parseInt(slideMatch[1], 10);
      const slideContent = section.trim();
      const startOffset = content.indexOf(slideContent);

      chunks.push({
        docId,
        filename,
        location: { slide: slideNumber },
        content: slideContent,
        offsets: { start: startOffset, end: startOffset + slideContent.length },
      });
    }

    return chunks.length > 0 ? chunks : this.chunkTextDocument(content, docId, filename);
  }

  private chunkCSVDocument(content: string, docId: string, filename: string): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const lines = content.split('\n');
    const header = lines[0] || '';
    let currentOffset = 0;

    for (let i = 0; i < lines.length; i += Math.floor(CHUNK_SIZE / 100)) {
      const chunkLines = i === 0 
        ? lines.slice(i, i + Math.floor(CHUNK_SIZE / 100))
        : [header, ...lines.slice(i, i + Math.floor(CHUNK_SIZE / 100))];
      
      const chunkContent = chunkLines.join('\n').trim();

      if (chunkContent) {
        chunks.push({
          docId,
          filename,
          location: { row: i + 1 },
          content: chunkContent,
          offsets: { start: currentOffset, end: currentOffset + chunkContent.length },
        });

        currentOffset += chunkContent.length;
      }
    }

    return chunks;
  }

  private chunkPagedDocument(pages: string[], docId: string, filename: string): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    let offset = 0;

    for (let pageNum = 0; pageNum < pages.length; pageNum++) {
      const pageContent = pages[pageNum].trim();
      if (!pageContent) continue;

      if (pageContent.length <= CHUNK_SIZE) {
        chunks.push({
          docId,
          filename,
          location: { page: pageNum + 1 },
          content: pageContent,
          offsets: { start: offset, end: offset + pageContent.length },
        });
        offset += pageContent.length;
      } else {
        const subChunks = this.splitIntoChunks(pageContent, CHUNK_SIZE, CHUNK_OVERLAP);
        for (const subChunk of subChunks) {
          chunks.push({
            docId,
            filename,
            location: { page: pageNum + 1 },
            content: subChunk.content,
            offsets: { start: offset + subChunk.start, end: offset + subChunk.end },
          });
        }
        offset += pageContent.length;
      }
    }

    return chunks;
  }

  private chunkTextDocument(content: string, docId: string, filename: string): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const subChunks = this.splitIntoChunks(content, CHUNK_SIZE, CHUNK_OVERLAP);

    for (let i = 0; i < subChunks.length; i++) {
      const subChunk = subChunks[i];
      chunks.push({
        docId,
        filename,
        location: { page: i + 1 },
        content: subChunk.content,
        offsets: { start: subChunk.start, end: subChunk.end },
      });
    }

    return chunks;
  }

  private splitIntoChunks(
    text: string,
    chunkSize: number,
    overlap: number
  ): Array<{ content: string; start: number; end: number }> {
    const chunks: Array<{ content: string; start: number; end: number }> = [];
    const paragraphs = text.split(/\n\n+/);
    let currentChunk = '';
    let chunkStart = 0;
    let currentPos = 0;

    for (const para of paragraphs) {
      if (currentChunk.length + para.length + 2 > chunkSize && currentChunk) {
        chunks.push({
          content: currentChunk.trim(),
          start: chunkStart,
          end: currentPos,
        });

        const overlapText = currentChunk.slice(-overlap);
        currentChunk = overlapText + '\n\n' + para;
        chunkStart = currentPos - overlap;
      } else {
        if (currentChunk) {
          currentChunk += '\n\n' + para;
        } else {
          currentChunk = para;
          chunkStart = currentPos;
        }
      }
      currentPos += para.length + 2;
    }

    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        start: chunkStart,
        end: currentPos,
      });
    }

    return chunks;
  }

  private indexChunks(chunks: DocumentChunk[]): void {
    for (const chunk of chunks) {
      const hash = this.hashContent(chunk.content);
      
      if (!this.chunkIndex.has(hash)) {
        this.chunkIndex.set(hash, chunk);
      }
    }
  }

  private hashContent(content: string): string {
    const normalized = content.toLowerCase().replace(/\s+/g, ' ').trim();
    let hash = 0;
    for (let i = 0; i < Math.min(normalized.length, 500); i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  private buildUnifiedContext(chunks: DocumentChunk[]): string {
    const deduplicated = this.deduplicateChunks(chunks);
    const sorted = this.sortByRelevance(deduplicated);
    
    const parts: string[] = [];
    let currentDoc = '';

    for (const chunk of sorted) {
      if (chunk.filename !== currentDoc) {
        currentDoc = chunk.filename;
        parts.push(`\n=== ${this.formatCitation(chunk)} ===`);
      }

      const locationStr = this.formatLocationShort(chunk);
      if (locationStr) {
        parts.push(`\n[${locationStr}]`);
      }
      parts.push(chunk.content);
    }

    return parts.join('\n').trim();
  }

  private deduplicateChunks(chunks: DocumentChunk[]): DocumentChunk[] {
    const seen = new Set<string>();
    const result: DocumentChunk[] = [];

    for (const chunk of chunks) {
      const hash = this.hashContent(chunk.content);
      if (!seen.has(hash)) {
        seen.add(hash);
        result.push(chunk);
      }
    }

    return result;
  }

  private sortByRelevance(chunks: DocumentChunk[]): DocumentChunk[] {
    return [...chunks].sort((a, b) => {
      if (a.filename !== b.filename) {
        return a.filename.localeCompare(b.filename);
      }

      const aOrder = a.location.page || a.location.slide || a.location.row || 0;
      const bOrder = b.location.page || b.location.slide || b.location.row || 0;

      return aOrder - bOrder;
    });
  }

  private formatCitation(chunk: DocumentChunk): string {
    const ext = this.getExtensionFromFileName(chunk.filename).toLowerCase();
    const loc = chunk.location;

    switch (ext) {
      case 'pdf':
        return `doc:${chunk.filename}${loc.page ? ` p${loc.page}` : ''}`;
      case 'xlsx':
      case 'xls':
        if (loc.sheet && loc.cell) {
          return `doc:${chunk.filename} sheet:${loc.sheet} cell:${loc.cell}`;
        }
        return `doc:${chunk.filename}${loc.sheet ? ` sheet:${loc.sheet}` : ''}`;
      case 'docx':
      case 'doc':
        return `doc:${chunk.filename}${loc.page ? ` p${loc.page}` : ''}`;
      case 'pptx':
      case 'ppt':
        return `doc:${chunk.filename}${loc.slide ? ` slide:${loc.slide}` : ''}`;
      case 'csv':
        return `doc:${chunk.filename}${loc.row ? ` row:${loc.row}` : ''}`;
      default:
        return `doc:${chunk.filename}`;
    }
  }

  private formatLocationShort(chunk: DocumentChunk): string {
    const loc = chunk.location;
    
    if (loc.slide) return `slide:${loc.slide}`;
    if (loc.sheet && loc.cell) return `${loc.sheet}:${loc.cell}`;
    if (loc.sheet && loc.row) return `${loc.sheet}:row${loc.row}`;
    if (loc.row) return `row:${loc.row}`;
    if (loc.page) return `p${loc.page}`;
    
    return '';
  }

  private generateDocId(filename: string, index: number): string {
    const sanitized = filename.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    return `${sanitized}_${index}_${Date.now().toString(36)}`;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private getExtensionFromFileName(fileName: string): string {
    const parts = fileName.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
  }

  private inferMimeTypeFromExtension(ext: string): string | null {
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

  getParserRegistry(): ParserRegistry {
    return this.parserRegistry;
  }

  getCircuitBreakerStatus(): Record<string, any> {
    return this.parserRegistry.getCircuitBreakerStatus();
  }

  resetCircuitBreakers(): void {
    this.parserRegistry.resetAllCircuitBreakers();
  }
}

export const documentBatchProcessor = new DocumentBatchProcessor();
