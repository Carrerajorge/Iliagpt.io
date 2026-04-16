import { createHash } from "crypto";

export interface FileAuditData {
  buffer?: Buffer;
  content?: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ParseResultData {
  success: boolean;
  parserUsed: string;
  tokensExtracted: number;
  chunksGenerated: number;
  citationsGenerated?: number;
  parseTimeMs: number;
  error?: string;
}

export interface AuditRecord {
  id: string;
  timestamp: string;
  fileHash: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  parserUsed: string;
  parseResult: "success" | "failure";
  tokensExtracted: number;
  chunksGenerated: number;
  citationsGenerated: number;
  parseTimeMs: number;
  errorMessage?: string;
}

export interface AuditBatchSummary {
  batchId: string;
  timestamp: string;
  requestId: string;
  totalFiles: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  totalChunks: number;
  totalCitations: number;
  totalSizeBytes: number;
  totalParseTimeMs: number;
  records: AuditRecord[];
}

function generateFileHash(data: Buffer | string): string {
  const hash = createHash("sha256");
  if (typeof data === "string") {
    hash.update(data, "utf8");
  } else {
    hash.update(data);
  }
  return hash.digest("hex");
}

function generateAuditId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `aud_${timestamp}_${random}`;
}

function generateBatchId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `batch_${timestamp}_${random}`;
}

export function createAuditRecord(
  file: FileAuditData,
  parseResult: ParseResultData
): AuditRecord {
  const contentForHash = file.buffer || file.content || "";
  const fileHash = generateFileHash(contentForHash);
  
  return {
    id: generateAuditId(),
    timestamp: new Date().toISOString(),
    fileHash,
    fileName: file.filename,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    parserUsed: parseResult.parserUsed,
    parseResult: parseResult.success ? "success" : "failure",
    tokensExtracted: parseResult.tokensExtracted,
    chunksGenerated: parseResult.chunksGenerated,
    citationsGenerated: parseResult.citationsGenerated || 0,
    parseTimeMs: parseResult.parseTimeMs,
    errorMessage: parseResult.error,
  };
}

export function createBatchAuditSummary(
  requestId: string,
  records: AuditRecord[]
): AuditBatchSummary {
  const successCount = records.filter(r => r.parseResult === "success").length;
  const failureCount = records.filter(r => r.parseResult === "failure").length;
  
  const totalTokens = records.reduce((sum, r) => sum + r.tokensExtracted, 0);
  const totalChunks = records.reduce((sum, r) => sum + r.chunksGenerated, 0);
  const totalCitations = records.reduce((sum, r) => sum + r.citationsGenerated, 0);
  const totalSizeBytes = records.reduce((sum, r) => sum + r.sizeBytes, 0);
  const totalParseTimeMs = records.reduce((sum, r) => sum + r.parseTimeMs, 0);

  return {
    batchId: generateBatchId(),
    timestamp: new Date().toISOString(),
    requestId,
    totalFiles: records.length,
    successCount,
    failureCount,
    totalTokens,
    totalChunks,
    totalCitations,
    totalSizeBytes,
    totalParseTimeMs,
    records,
  };
}

export function formatAuditLog(auditRecords: AuditRecord[]): string {
  const lines: string[] = [];
  
  lines.push("=== PARE AUDIT LOG ===");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Total Records: ${auditRecords.length}`);
  lines.push("");
  
  for (const record of auditRecords) {
    lines.push(`--- Record: ${record.id} ---`);
    lines.push(`  Timestamp: ${record.timestamp}`);
    lines.push(`  File: ${record.fileName}`);
    lines.push(`  Hash: ${record.fileHash.substring(0, 16)}...`);
    lines.push(`  MIME: ${record.mimeType}`);
    lines.push(`  Size: ${formatBytes(record.sizeBytes)}`);
    lines.push(`  Parser: ${record.parserUsed}`);
    lines.push(`  Result: ${record.parseResult.toUpperCase()}`);
    lines.push(`  Tokens: ${record.tokensExtracted}`);
    lines.push(`  Chunks: ${record.chunksGenerated}`);
    lines.push(`  Citations: ${record.citationsGenerated}`);
    lines.push(`  Parse Time: ${record.parseTimeMs}ms`);
    if (record.errorMessage) {
      lines.push(`  Error: ${record.errorMessage}`);
    }
    lines.push("");
  }
  
  return lines.join("\n");
}

export function formatAuditLogJson(summary: AuditBatchSummary): string {
  return JSON.stringify({
    type: "PARE_AUDIT_BATCH",
    ...summary,
    records: summary.records.map(r => ({
      ...r,
      fileHash: r.fileHash.substring(0, 16) + "...",
    })),
  }, null, 2);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function computeContentHash(content: Buffer | string): string {
  return generateFileHash(content);
}

export class AuditTrailCollector {
  private records: AuditRecord[] = [];
  private requestId: string;

  constructor(requestId: string) {
    this.requestId = requestId;
  }

  addRecord(file: FileAuditData, parseResult: ParseResultData): AuditRecord {
    const record = createAuditRecord(file, parseResult);
    this.records.push(record);
    return record;
  }

  getRecords(): AuditRecord[] {
    return [...this.records];
  }

  getSummary(): AuditBatchSummary {
    return createBatchAuditSummary(this.requestId, this.records);
  }

  getFormattedLog(): string {
    return formatAuditLog(this.records);
  }

  getFormattedJson(): string {
    return formatAuditLogJson(this.getSummary());
  }

  clear(): void {
    this.records = [];
  }
}
