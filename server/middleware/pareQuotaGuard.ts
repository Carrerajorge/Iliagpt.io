import type { Request, Response, NextFunction } from "express";
import type { PareContext } from "./pareRequestContract";

export interface QuotaConfig {
  maxFileSizeBytes: number;
  maxTotalSizeBytes: number;
  maxFilesPerRequest: number;
  maxPagesEstimate: number;
  bytesPerPageEstimate: number;
}

export interface QuotaViolation {
  type: "FILE_SIZE_EXCEEDED" | "TOTAL_SIZE_EXCEEDED" | "MAX_FILES_EXCEEDED" | "MAX_PAGES_EXCEEDED";
  limit: number;
  actual: number;
  unit: string;
  filename?: string;
}

const MB = 1024 * 1024;

const DEFAULT_QUOTA_CONFIG: QuotaConfig = {
  maxFileSizeBytes: parseInt(process.env.PARE_MAX_FILE_SIZE_MB || "500", 10) * MB,
  maxTotalSizeBytes: parseInt(process.env.PARE_MAX_TOTAL_SIZE_MB || "2000", 10) * MB,
  maxFilesPerRequest: parseInt(process.env.PARE_MAX_FILES || "50", 10),
  maxPagesEstimate: parseInt(process.env.PARE_MAX_PAGES || "5000", 10),
  bytesPerPageEstimate: parseInt(process.env.PARE_BYTES_PER_PAGE || "3000", 10),
};

function estimatePageCount(sizeBytes: number, bytesPerPage: number): number {
  return Math.ceil(sizeBytes / bytesPerPage);
}

function getFileSize(attachment: any): number {
  if (typeof attachment.size === "number") {
    return attachment.size;
  }
  
  if (typeof attachment.content === "string") {
    const base64Match = attachment.content.match(/^data:[^;]+;base64,/);
    if (base64Match) {
      const base64Data = attachment.content.slice(base64Match[0].length);
      return Math.floor(base64Data.length * 0.75);
    }
    return attachment.content.length;
  }
  
  if (attachment.contentLength) {
    return attachment.contentLength;
  }
  
  return 0;
}

export function pareQuotaGuard(config: Partial<QuotaConfig> = {}) {
  const {
    maxFileSizeBytes = DEFAULT_QUOTA_CONFIG.maxFileSizeBytes,
    maxTotalSizeBytes = DEFAULT_QUOTA_CONFIG.maxTotalSizeBytes,
    maxFilesPerRequest = DEFAULT_QUOTA_CONFIG.maxFilesPerRequest,
    maxPagesEstimate = DEFAULT_QUOTA_CONFIG.maxPagesEstimate,
    bytesPerPageEstimate = DEFAULT_QUOTA_CONFIG.bytesPerPageEstimate,
  } = config;

  return function pareQuotaGuardMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const pareContext: PareContext | undefined = req.pareContext;
    
    if (!pareContext) {
      console.error(JSON.stringify({
        level: "error",
        event: "PARE_QUOTA_GUARD_NO_CONTEXT",
        message: "pareRequestContract middleware must be applied before pareQuotaGuard",
        path: req.path,
        timestamp: new Date().toISOString(),
      }));
      return next(new Error("PARE context not initialized"));
    }
    
    const { requestId, attachmentsCount } = pareContext;
    
    const { attachments } = req.body || {};
    
    if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
      return next();
    }
    
    const violations: QuotaViolation[] = [];
    
    if (attachmentsCount > maxFilesPerRequest) {
      violations.push({
        type: "MAX_FILES_EXCEEDED",
        limit: maxFilesPerRequest,
        actual: attachmentsCount,
        unit: "files",
      });
    }
    
    let totalSizeBytes = 0;
    let totalPagesEstimate = 0;
    
    for (const attachment of attachments) {
      const fileSize = getFileSize(attachment);
      const filename = attachment.name || attachment.filename || "unknown";
      
      if (fileSize > maxFileSizeBytes) {
        violations.push({
          type: "FILE_SIZE_EXCEEDED",
          limit: maxFileSizeBytes,
          actual: fileSize,
          unit: "bytes",
          filename,
        });
      }
      
      totalSizeBytes += fileSize;
      totalPagesEstimate += estimatePageCount(fileSize, bytesPerPageEstimate);
    }
    
    if (totalSizeBytes > maxTotalSizeBytes) {
      violations.push({
        type: "TOTAL_SIZE_EXCEEDED",
        limit: maxTotalSizeBytes,
        actual: totalSizeBytes,
        unit: "bytes",
      });
    }
    
    if (totalPagesEstimate > maxPagesEstimate) {
      violations.push({
        type: "MAX_PAGES_EXCEEDED",
        limit: maxPagesEstimate,
        actual: totalPagesEstimate,
        unit: "pages (estimated)",
      });
    }
    
    if (violations.length > 0) {
      console.log(JSON.stringify({
        level: "warn",
        event: "PARE_QUOTA_EXCEEDED",
        requestId,
        violations,
        attachmentsCount,
        totalSizeBytes,
        totalPagesEstimate,
        limits: {
          maxFileSizeBytes,
          maxTotalSizeBytes,
          maxFilesPerRequest,
          maxPagesEstimate,
        },
        timestamp: new Date().toISOString(),
      }));
      
      res.status(422).json({
        error: {
          code: "QUOTA_EXCEEDED",
          message: "Request exceeds quota limits",
          requestId,
          violations: violations.map(v => ({
            type: v.type,
            message: formatViolationMessage(v),
            limit: v.limit,
            actual: v.actual,
            unit: v.unit,
            filename: v.filename,
          })),
          limits: {
            maxFileSizeMB: maxFileSizeBytes / MB,
            maxTotalSizeMB: maxTotalSizeBytes / MB,
            maxFiles: maxFilesPerRequest,
            maxPages: maxPagesEstimate,
          },
        }
      });
      return;
    }
    
    console.log(JSON.stringify({
      level: "debug",
      event: "PARE_QUOTA_CHECK_PASSED",
      requestId,
      attachmentsCount,
      totalSizeBytes,
      totalSizeMB: (totalSizeBytes / MB).toFixed(2),
      totalPagesEstimate,
      timestamp: new Date().toISOString(),
    }));
    
    next();
  };
}

function formatViolationMessage(violation: QuotaViolation): string {
  switch (violation.type) {
    case "FILE_SIZE_EXCEEDED":
      return `File "${violation.filename}" exceeds maximum size of ${(violation.limit / MB).toFixed(0)}MB (actual: ${(violation.actual / MB).toFixed(2)}MB)`;
    case "TOTAL_SIZE_EXCEEDED":
      return `Total upload size exceeds maximum of ${(violation.limit / MB).toFixed(0)}MB (actual: ${(violation.actual / MB).toFixed(2)}MB)`;
    case "MAX_FILES_EXCEEDED":
      return `Number of files (${violation.actual}) exceeds maximum of ${violation.limit}`;
    case "MAX_PAGES_EXCEEDED":
      return `Estimated page count (${violation.actual}) exceeds maximum of ${violation.limit}`;
    default:
      return `Quota exceeded: ${violation.type}`;
  }
}

export function getQuotaConfig(): QuotaConfig {
  return { ...DEFAULT_QUOTA_CONFIG };
}
