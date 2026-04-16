/**
 * PARE Security Guard - Unified security validation for attachments
 * PARE Phase 2 Security Hardening
 * 
 * Provides a single entry point for all security validations:
 * - MIME type detection and validation
 * - ZIP bomb protection
 * - Path traversal detection
 * - Dangerous format detection
 */

import { detectMime, validateMimeType, detectDangerousFormat, type MimeDetectionResult, type MimeValidationResult } from './mimeDetector';
import { checkZipBomb, checkPathTraversalInZip, type ZipBombCheckResult, type ZipSecurityViolation, ZipViolationCode } from './zipBombGuard';

export enum SecurityViolationType {
  MIME_DENIED = 'MIME_DENIED',
  MIME_MISMATCH = 'MIME_MISMATCH',
  DANGEROUS_FORMAT = 'DANGEROUS_FORMAT',
  ZIP_BOMB = 'ZIP_BOMB',
  PATH_TRAVERSAL = 'PATH_TRAVERSAL',
  EXCESSIVE_SIZE = 'EXCESSIVE_SIZE',
  EXCESSIVE_FILES = 'EXCESSIVE_FILES',
  EXCESSIVE_NESTING = 'EXCESSIVE_NESTING',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
}

export interface SecurityViolation {
  type: SecurityViolationType;
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface SecurityValidationResult {
  safe: boolean;
  violations: SecurityViolation[];
  mimeDetection?: MimeDetectionResult;
  zipCheck?: ZipBombCheckResult;
  processingTimeMs: number;
  checksPerformed: {
    mimeValidation: boolean;
    dangerousFormatCheck: boolean;
    zipBombCheck: boolean;
    pathTraversalCheck: boolean;
  };
}

export interface AttachmentInput {
  filename: string;
  buffer: Buffer;
  providedMimeType?: string;
}

export interface SecurityGuardOptions {
  strictMode?: boolean;
  allowMimeMismatch?: boolean;
  maxFileSizeMB?: number;
}

const ZIP_BASED_EXTENSIONS = ['zip', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'jar', 'war', 'ear'];
const ZIP_MAGIC_BYTES = [0x50, 0x4B, 0x03, 0x04];

function isZipBasedFile(filename: string, buffer: Buffer): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  
  if (ZIP_BASED_EXTENSIONS.includes(ext)) {
    return true;
  }
  
  if (buffer.length >= 4) {
    return ZIP_MAGIC_BYTES.every((byte, i) => buffer[i] === byte);
  }
  
  return false;
}

function mapZipViolationToSecurity(zipViolation: ZipSecurityViolation): SecurityViolation {
  const typeMap: Record<ZipViolationCode, SecurityViolationType> = {
    [ZipViolationCode.PATH_TRAVERSAL]: SecurityViolationType.PATH_TRAVERSAL,
    [ZipViolationCode.ABSOLUTE_PATH]: SecurityViolationType.PATH_TRAVERSAL,
    [ZipViolationCode.EXCESSIVE_COMPRESSION]: SecurityViolationType.ZIP_BOMB,
    [ZipViolationCode.EXCESSIVE_FILE_COUNT]: SecurityViolationType.EXCESSIVE_FILES,
    [ZipViolationCode.EXCESSIVE_SIZE]: SecurityViolationType.EXCESSIVE_SIZE,
    [ZipViolationCode.EXCESSIVE_NESTING]: SecurityViolationType.EXCESSIVE_NESTING,
    [ZipViolationCode.NESTED_ARCHIVE_VIOLATION]: SecurityViolationType.ZIP_BOMB,
    [ZipViolationCode.PARSE_ERROR]: SecurityViolationType.VALIDATION_ERROR,
  };

  const severityMap: Record<ZipViolationCode, 'critical' | 'high' | 'medium' | 'low'> = {
    [ZipViolationCode.PATH_TRAVERSAL]: 'critical',
    [ZipViolationCode.ABSOLUTE_PATH]: 'critical',
    [ZipViolationCode.EXCESSIVE_COMPRESSION]: 'high',
    [ZipViolationCode.EXCESSIVE_FILE_COUNT]: 'medium',
    [ZipViolationCode.EXCESSIVE_SIZE]: 'medium',
    [ZipViolationCode.EXCESSIVE_NESTING]: 'medium',
    [ZipViolationCode.NESTED_ARCHIVE_VIOLATION]: 'high',
    [ZipViolationCode.PARSE_ERROR]: 'low',
  };

  return {
    type: typeMap[zipViolation.code],
    severity: severityMap[zipViolation.code],
    message: zipViolation.message,
    details: {
      originalCode: zipViolation.code,
      path: zipViolation.path,
      ...zipViolation.details,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Unified security validation for file attachments
 * Performs all security checks in a single call
 */
export async function validateAttachmentSecurity(
  attachment: AttachmentInput,
  options: SecurityGuardOptions = {}
): Promise<SecurityValidationResult> {
  const startTime = Date.now();
  const violations: SecurityViolation[] = [];
  const checksPerformed = {
    mimeValidation: false,
    dangerousFormatCheck: false,
    zipBombCheck: false,
    pathTraversalCheck: false,
  };

  let mimeDetection: MimeDetectionResult | undefined;
  let zipCheck: ZipBombCheckResult | undefined;

  try {
    const maxSizeBytes = (options.maxFileSizeMB || 500) * 1024 * 1024;
    if (attachment.buffer.length > maxSizeBytes) {
      violations.push({
        type: SecurityViolationType.EXCESSIVE_SIZE,
        severity: 'medium',
        message: `File size ${(attachment.buffer.length / (1024 * 1024)).toFixed(1)}MB exceeds limit of ${options.maxFileSizeMB || 100}MB`,
        details: {
          actualSize: attachment.buffer.length,
          limitSize: maxSizeBytes,
        },
        timestamp: new Date().toISOString(),
      });

      logSecurityViolation(attachment.filename, violations[violations.length - 1]);

      return {
        safe: false,
        violations,
        processingTimeMs: Date.now() - startTime,
        checksPerformed,
      };
    }

    mimeDetection = detectMime(
      attachment.buffer,
      attachment.filename,
      attachment.providedMimeType
    );
    checksPerformed.mimeValidation = true;

    const mimeValidation = validateMimeType(mimeDetection.detectedMime, attachment.buffer);
    
    if (!mimeValidation.allowed) {
      violations.push({
        type: SecurityViolationType.MIME_DENIED,
        severity: 'high',
        message: mimeValidation.reason || 'MIME type not allowed',
        details: {
          detectedMime: mimeDetection.detectedMime,
          providedMime: attachment.providedMimeType,
          matchedRule: mimeValidation.matchedRule,
        },
        timestamp: new Date().toISOString(),
      });
    }

    if (mimeDetection.mismatch && options.strictMode && !options.allowMimeMismatch) {
      violations.push({
        type: SecurityViolationType.MIME_MISMATCH,
        severity: 'medium',
        message: mimeDetection.mismatchDetails || 'MIME type mismatch detected',
        details: {
          detectedMime: mimeDetection.detectedMime,
          providedMime: attachment.providedMimeType,
        },
        timestamp: new Date().toISOString(),
      });
    }

    const dangerousCheck = detectDangerousFormat(attachment.buffer);
    checksPerformed.dangerousFormatCheck = true;

    if (dangerousCheck.isDangerous) {
      violations.push({
        type: SecurityViolationType.DANGEROUS_FORMAT,
        severity: 'critical',
        message: dangerousCheck.isShellScript 
          ? 'Shell script detected' 
          : `Dangerous file format: ${dangerousCheck.signature?.description || 'unknown'}`,
        details: {
          isShellScript: dangerousCheck.isShellScript,
          signature: dangerousCheck.signature?.description,
          threat: dangerousCheck.signature?.threat,
        },
        timestamp: new Date().toISOString(),
      });
    }

    if (isZipBasedFile(attachment.filename, attachment.buffer)) {
      checksPerformed.zipBombCheck = true;
      checksPerformed.pathTraversalCheck = true;

      zipCheck = await checkZipBomb(attachment.buffer);

      if (zipCheck.violations.length > 0) {
        for (const zipViolation of zipCheck.violations) {
          violations.push(mapZipViolationToSecurity(zipViolation));
        }
      }

      if (zipCheck.blocked) {
        violations.push({
          type: SecurityViolationType.ZIP_BOMB,
          severity: 'critical',
          message: zipCheck.reason || 'ZIP security check failed',
          details: {
            metrics: zipCheck.metrics,
          },
          timestamp: new Date().toISOString(),
        });
      }
    }

    for (const violation of violations) {
      logSecurityViolation(attachment.filename, violation);
    }

    const hasCriticalViolation = violations.some(v => v.severity === 'critical');
    const hasHighViolation = violations.some(v => v.severity === 'high');
    const safe = !hasCriticalViolation && (!options.strictMode || !hasHighViolation);

    return {
      safe,
      violations,
      mimeDetection,
      zipCheck,
      processingTimeMs: Date.now() - startTime,
      checksPerformed,
    };

  } catch (error) {
    const errorViolation: SecurityViolation = {
      type: SecurityViolationType.VALIDATION_ERROR,
      severity: 'high',
      message: `Security validation error: ${error instanceof Error ? error.message : 'unknown error'}`,
      details: {
        errorType: error instanceof Error ? error.constructor.name : 'Unknown',
      },
      timestamp: new Date().toISOString(),
    };

    violations.push(errorViolation);
    logSecurityViolation(attachment.filename, errorViolation);

    return {
      safe: false,
      violations,
      mimeDetection,
      zipCheck,
      processingTimeMs: Date.now() - startTime,
      checksPerformed,
    };
  }
}

/**
 * Log security violations with structured logging for audit purposes
 */
function logSecurityViolation(filename: string, violation: SecurityViolation): void {
  const logEntry = {
    event: 'SECURITY_VIOLATION',
    filename,
    violationType: violation.type,
    severity: violation.severity,
    message: violation.message,
    details: violation.details,
    timestamp: violation.timestamp,
  };

  if (violation.severity === 'critical') {
    console.error(`[PARESecurityGuard] CRITICAL SECURITY VIOLATION:`, JSON.stringify(logEntry, null, 2));
  } else if (violation.severity === 'high') {
    console.error(`[PARESecurityGuard] HIGH SECURITY VIOLATION:`, JSON.stringify(logEntry, null, 2));
  } else if (violation.severity === 'medium') {
    console.warn(`[PARESecurityGuard] MEDIUM SECURITY VIOLATION:`, JSON.stringify(logEntry, null, 2));
  } else {
    console.info(`[PARESecurityGuard] LOW SECURITY VIOLATION:`, JSON.stringify(logEntry, null, 2));
  }
}

/**
 * Quick security check - returns just safe/unsafe
 */
export async function isAttachmentSafe(
  attachment: AttachmentInput,
  options?: SecurityGuardOptions
): Promise<boolean> {
  const result = await validateAttachmentSecurity(attachment, options);
  return result.safe;
}

/**
 * Batch validation for multiple attachments
 */
export async function validateAttachmentsBatch(
  attachments: AttachmentInput[],
  options?: SecurityGuardOptions
): Promise<Map<string, SecurityValidationResult>> {
  const results = new Map<string, SecurityValidationResult>();

  for (const attachment of attachments) {
    const result = await validateAttachmentSecurity(attachment, options);
    results.set(attachment.filename, result);
  }

  return results;
}

export const pareSecurityGuard = {
  validateAttachmentSecurity,
  isAttachmentSafe,
  validateAttachmentsBatch,
  SecurityViolationType,
};
