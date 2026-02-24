/**
 * Zip Bomb Guard - Protection against decompression attacks
 * PARE Phase 2 Security Hardening
 * 
 * Detects zip bombs by checking compression ratio, nested depth,
 * and maximum extracted size limits.
 * Also detects path traversal attacks in archive entries.
 */

import JSZip from 'jszip';

export enum ZipViolationCode {
  PATH_TRAVERSAL = 'PATH_TRAVERSAL',
  ABSOLUTE_PATH = 'ABSOLUTE_PATH',
  EXCESSIVE_COMPRESSION = 'EXCESSIVE_COMPRESSION',
  EXCESSIVE_FILE_COUNT = 'EXCESSIVE_FILE_COUNT',
  EXCESSIVE_SIZE = 'EXCESSIVE_SIZE',
  EXCESSIVE_NESTING = 'EXCESSIVE_NESTING',
  NESTED_ARCHIVE_VIOLATION = 'NESTED_ARCHIVE_VIOLATION',
  PARSE_ERROR = 'PARSE_ERROR',
}

export interface ZipSecurityViolation {
  code: ZipViolationCode;
  message: string;
  path?: string;
  details?: Record<string, unknown>;
}

export interface ZipBombCheckOptions {
  maxCompressionRatio: number;
  maxNestedDepth: number;
  maxExtractedSizeMB: number;
  maxFileCount: number;
}

export interface ZipBombCheckResult {
  safe: boolean;
  suspicious: boolean;
  blocked: boolean;
  reason?: string;
  metrics: ZipBombMetrics;
  violations: ZipSecurityViolation[];
}

export interface ZipBombMetrics {
  compressedSize: number;
  estimatedUncompressedSize: number;
  compressionRatio: number;
  fileCount: number;
  nestedDepth: number;
  hasNestedArchive: boolean;
  pathTraversalAttempts: number;
  absolutePathAttempts: number;
}

export interface ExtractionProgress {
  bytesExtracted: number;
  filesExtracted: number;
  currentDepth: number;
  aborted: boolean;
  abortReason?: string;
}

/** Security: clamp env var to reasonable bounds */
function clampEnvInt(envVar: string, defaultVal: number, min: number, max: number): number {
  const parsed = parseInt(process.env[envVar] || String(defaultVal), 10);
  if (!Number.isFinite(parsed)) return defaultVal;
  return Math.max(min, Math.min(max, parsed));
}

/** Maximum entry name length (prevents memory abuse from oversized filenames) */
const MAX_ENTRY_NAME_LENGTH = 1024;

const DEFAULT_OPTIONS: ZipBombCheckOptions = {
  maxCompressionRatio: 100,
  maxNestedDepth: clampEnvInt('PARE_MAX_NESTED_DEPTH', 2, 1, 10),
  maxExtractedSizeMB: clampEnvInt('PARE_MAX_UNCOMPRESSED_SIZE_MB', 100, 1, 2000),
  maxFileCount: clampEnvInt('PARE_MAX_ZIP_ENTRIES', 10000, 1, 100000),
};

const ARCHIVE_EXTENSIONS = ['.zip', '.jar', '.war', '.ear', '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp'];
const ARCHIVE_MAGIC_BYTES = [
  [0x50, 0x4B, 0x03, 0x04],
  [0x50, 0x4B, 0x05, 0x06],
  [0x50, 0x4B, 0x07, 0x08],
];

function isArchiveFile(filename: string, buffer?: Buffer): boolean {
  const lowerName = filename.toLowerCase();
  
  if (ARCHIVE_EXTENSIONS.some(ext => lowerName.endsWith(ext))) {
    return true;
  }
  
  if (buffer && buffer.length >= 4) {
    for (const magic of ARCHIVE_MAGIC_BYTES) {
      if (magic.every((byte, i) => buffer[i] === byte)) {
        return true;
      }
    }
  }
  
  return false;
}

function checkPathTraversal(entryPath: string): { hasTraversal: boolean; hasAbsolutePath: boolean; nameTooLong: boolean } {
  // Security: reject entries with oversized names
  if (entryPath.length > MAX_ENTRY_NAME_LENGTH) {
    return { hasTraversal: false, hasAbsolutePath: false, nameTooLong: true };
  }

  const normalizedPath = entryPath.replace(/\\/g, '/');

  const hasTraversal = normalizedPath.includes('../') ||
                       normalizedPath.includes('..\\') ||
                       normalizedPath === '..' ||
                       normalizedPath.startsWith('../') ||
                       // Also detect URL-encoded traversal
                       normalizedPath.includes('%2e%2e') ||
                       normalizedPath.includes('%2E%2E');

  const hasAbsolutePath = normalizedPath.startsWith('/') ||
                          /^[a-zA-Z]:/.test(normalizedPath);

  return { hasTraversal, hasAbsolutePath, nameTooLong: false };
}

function estimateUncompressedSize(zip: JSZip): number {
  let totalSize = 0;
  
  zip.forEach((relativePath, file) => {
    if (!file.dir) {
      const fileData = (file as any)._data;
      if (fileData && typeof fileData.uncompressedSize === 'number') {
        totalSize += fileData.uncompressedSize;
      } else if (fileData && typeof fileData.compressedSize === 'number') {
        totalSize += fileData.compressedSize * 10;
      } else {
        totalSize += 1024 * 1024;
      }
    }
  });
  
  return totalSize;
}

/**
 * Check a buffer for zip bomb characteristics and path traversal attacks
 */
export async function checkZipBomb(
  buffer: Buffer,
  options: Partial<ZipBombCheckOptions> = {}
): Promise<ZipBombCheckResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const violations: ZipSecurityViolation[] = [];
  
  const metrics: ZipBombMetrics = {
    compressedSize: buffer.length,
    estimatedUncompressedSize: 0,
    compressionRatio: 0,
    fileCount: 0,
    nestedDepth: 0,
    hasNestedArchive: false,
    pathTraversalAttempts: 0,
    absolutePathAttempts: 0,
  };

  const progress: ExtractionProgress = {
    bytesExtracted: 0,
    filesExtracted: 0,
    currentDepth: 0,
    aborted: false,
  };

  try {
    const zip = await JSZip.loadAsync(buffer);
    
    let fileCount = 0;
    let hasNestedArchive = false;
    const nestedArchives: string[] = [];
    let pathTraversalAttempts = 0;
    let absolutePathAttempts = 0;
    
    zip.forEach((relativePath, file) => {
      if (progress.aborted) return;

      const pathCheck = checkPathTraversal(relativePath);

      if (pathCheck.nameTooLong) {
        pathTraversalAttempts++;
        violations.push({
          code: ZipViolationCode.PATH_TRAVERSAL,
          message: `Entry name exceeds maximum length (${MAX_ENTRY_NAME_LENGTH})`,
          path: relativePath.substring(0, 100) + '...',
        });
      }

      if (pathCheck.hasTraversal) {
        pathTraversalAttempts++;
        violations.push({
          code: ZipViolationCode.PATH_TRAVERSAL,
          message: `Path traversal detected in archive entry`,
          path: relativePath.substring(0, MAX_ENTRY_NAME_LENGTH),
          details: { pattern: '../' },
        });
      }

      if (pathCheck.hasAbsolutePath) {
        absolutePathAttempts++;
        violations.push({
          code: ZipViolationCode.ABSOLUTE_PATH,
          message: `Absolute path detected in archive entry`,
          path: relativePath.substring(0, MAX_ENTRY_NAME_LENGTH),
          details: { pattern: relativePath.charAt(0) },
        });
      }
      
      if (!file.dir) {
        fileCount++;
        progress.filesExtracted++;
        
        if (fileCount > opts.maxFileCount && !progress.aborted) {
          progress.aborted = true;
          progress.abortReason = `Exceeded max file count: ${opts.maxFileCount}`;
        }
        
        if (isArchiveFile(relativePath)) {
          hasNestedArchive = true;
          nestedArchives.push(relativePath);
        }
      }
    });
    
    metrics.fileCount = fileCount;
    metrics.hasNestedArchive = hasNestedArchive;
    metrics.pathTraversalAttempts = pathTraversalAttempts;
    metrics.absolutePathAttempts = absolutePathAttempts;
    
    if (pathTraversalAttempts > 0 || absolutePathAttempts > 0) {
      console.error(`[ZipBombGuard] SECURITY VIOLATION: Path traversal/absolute path detected`, {
        pathTraversalAttempts,
        absolutePathAttempts,
        violations: violations.slice(0, 5),
      });
      
      return {
        safe: false,
        suspicious: true,
        blocked: true,
        reason: `Security violation: ${pathTraversalAttempts > 0 ? 'path traversal' : 'absolute path'} detected`,
        metrics,
        violations,
      };
    }
    
    if (fileCount > opts.maxFileCount) {
      violations.push({
        code: ZipViolationCode.EXCESSIVE_FILE_COUNT,
        message: `Excessive file count: ${fileCount} (limit: ${opts.maxFileCount})`,
        details: { count: fileCount, limit: opts.maxFileCount },
      });
      
      return {
        safe: false,
        suspicious: true,
        blocked: true,
        reason: `Excessive file count: ${fileCount} (limit: ${opts.maxFileCount})`,
        metrics,
        violations,
      };
    }
    
    metrics.estimatedUncompressedSize = estimateUncompressedSize(zip);
    metrics.compressionRatio = metrics.estimatedUncompressedSize / Math.max(buffer.length, 1);
    progress.bytesExtracted = metrics.estimatedUncompressedSize;
    
    if (metrics.compressionRatio > opts.maxCompressionRatio) {
      violations.push({
        code: ZipViolationCode.EXCESSIVE_COMPRESSION,
        message: `Suspicious compression ratio: ${metrics.compressionRatio.toFixed(1)}:1 (limit: ${opts.maxCompressionRatio}:1)`,
        details: { ratio: metrics.compressionRatio, limit: opts.maxCompressionRatio },
      });
      
      return {
        safe: false,
        suspicious: true,
        blocked: true,
        reason: `Suspicious compression ratio: ${metrics.compressionRatio.toFixed(1)}:1 (limit: ${opts.maxCompressionRatio}:1)`,
        metrics,
        violations,
      };
    }
    
    const maxExtractedBytes = opts.maxExtractedSizeMB * 1024 * 1024;
    if (metrics.estimatedUncompressedSize > maxExtractedBytes) {
      violations.push({
        code: ZipViolationCode.EXCESSIVE_SIZE,
        message: `Extracted size would exceed limit: ${(metrics.estimatedUncompressedSize / (1024 * 1024)).toFixed(1)}MB (limit: ${opts.maxExtractedSizeMB}MB)`,
        details: { sizeMB: metrics.estimatedUncompressedSize / (1024 * 1024), limitMB: opts.maxExtractedSizeMB },
      });
      
      return {
        safe: false,
        suspicious: true,
        blocked: true,
        reason: `Extracted size would exceed limit: ${(metrics.estimatedUncompressedSize / (1024 * 1024)).toFixed(1)}MB (limit: ${opts.maxExtractedSizeMB}MB)`,
        metrics,
        violations,
      };
    }
    
    if (hasNestedArchive) {
      let maxDepth = 1;
      progress.currentDepth = 1;
      
      for (const archivePath of nestedArchives.slice(0, 5)) {
        try {
          const nestedFile = zip.file(archivePath);
          if (nestedFile) {
            const nestedBuffer = await nestedFile.async('nodebuffer');
            const nestedResult = await checkNestedArchive(nestedBuffer, 1, opts, progress);
            maxDepth = Math.max(maxDepth, nestedResult.depth);
            
            if (nestedResult.violations.length > 0) {
              violations.push(...nestedResult.violations);
            }
            
            if (nestedResult.blocked) {
              metrics.nestedDepth = nestedResult.depth;
              return {
                safe: false,
                suspicious: true,
                blocked: true,
                reason: `Nested archive issue at depth ${nestedResult.depth}: ${nestedResult.reason}`,
                metrics,
                violations,
              };
            }
          }
        } catch {
        }
      }
      
      metrics.nestedDepth = maxDepth;
      
      if (maxDepth > opts.maxNestedDepth) {
        violations.push({
          code: ZipViolationCode.EXCESSIVE_NESTING,
          message: `Nested archive depth ${maxDepth} exceeds limit of ${opts.maxNestedDepth}`,
          details: { depth: maxDepth, limit: opts.maxNestedDepth },
        });
        
        return {
          safe: false,
          suspicious: true,
          blocked: true,
          reason: `Nested archive depth ${maxDepth} exceeds limit of ${opts.maxNestedDepth}`,
          metrics,
          violations,
        };
      }
    }
    
    const suspicious = metrics.compressionRatio > 50 || hasNestedArchive;
    
    return {
      safe: !suspicious,
      suspicious,
      blocked: false,
      metrics,
      violations,
    };
    
  } catch (error) {
    violations.push({
      code: ZipViolationCode.PARSE_ERROR,
      message: `Failed to analyze archive: ${error instanceof Error ? error.message : 'unknown error'}`,
    });
    
    return {
      safe: false,
      suspicious: true,
      blocked: false,
      reason: `Failed to analyze archive: ${error instanceof Error ? error.message : 'unknown error'}`,
      metrics,
      violations,
    };
  }
}

async function checkNestedArchive(
  buffer: Buffer,
  currentDepth: number,
  options: ZipBombCheckOptions,
  progress: ExtractionProgress
): Promise<{ depth: number; blocked: boolean; reason?: string; violations: ZipSecurityViolation[] }> {
  const violations: ZipSecurityViolation[] = [];
  
  if (currentDepth >= options.maxNestedDepth) {
    violations.push({
      code: ZipViolationCode.EXCESSIVE_NESTING,
      message: 'Max nesting depth exceeded',
      details: { depth: currentDepth + 1, limit: options.maxNestedDepth },
    });
    return { depth: currentDepth + 1, blocked: true, reason: 'Max nesting depth exceeded', violations };
  }
  
  try {
    const zip = await JSZip.loadAsync(buffer);
    let maxDepth = currentDepth + 1;
    progress.currentDepth = maxDepth;
    
    const promises: Promise<{ depth: number; blocked: boolean; reason?: string; violations: ZipSecurityViolation[] }>[] = [];
    
    zip.forEach((relativePath, file) => {
      const pathCheck = checkPathTraversal(relativePath);
      
      if (pathCheck.hasTraversal) {
        violations.push({
          code: ZipViolationCode.PATH_TRAVERSAL,
          message: `Path traversal in nested archive at depth ${currentDepth + 1}`,
          path: relativePath,
        });
      }
      
      if (pathCheck.hasAbsolutePath) {
        violations.push({
          code: ZipViolationCode.ABSOLUTE_PATH,
          message: `Absolute path in nested archive at depth ${currentDepth + 1}`,
          path: relativePath,
        });
      }
      
      if (!file.dir && isArchiveFile(relativePath)) {
        if (promises.length < 3) {
          promises.push(
            (async () => {
              const nestedBuffer = await file.async('nodebuffer');
              return checkNestedArchive(nestedBuffer, currentDepth + 1, options, progress);
            })()
          );
        }
      }
    });
    
    if (violations.some(v => v.code === ZipViolationCode.PATH_TRAVERSAL || v.code === ZipViolationCode.ABSOLUTE_PATH)) {
      return { depth: maxDepth, blocked: true, reason: 'Path security violation in nested archive', violations };
    }
    
    if (promises.length > 0) {
      const results = await Promise.all(promises);
      for (const result of results) {
        maxDepth = Math.max(maxDepth, result.depth);
        violations.push(...result.violations);
        if (result.blocked) {
          return { ...result, violations };
        }
      }
    }
    
    return { depth: maxDepth, blocked: false, violations };
    
  } catch {
    return { depth: currentDepth + 1, blocked: false, violations };
  }
}

/**
 * Check specifically for path traversal in ZIP entries
 */
export async function checkPathTraversalInZip(buffer: Buffer): Promise<{
  safe: boolean;
  violations: ZipSecurityViolation[];
}> {
  const violations: ZipSecurityViolation[] = [];
  
  try {
    const zip = await JSZip.loadAsync(buffer);
    
    zip.forEach((relativePath) => {
      const pathCheck = checkPathTraversal(relativePath);
      const safePath = relativePath.substring(0, MAX_ENTRY_NAME_LENGTH);

      if (pathCheck.nameTooLong) {
        violations.push({
          code: ZipViolationCode.PATH_TRAVERSAL,
          message: `Entry name exceeds maximum length`,
          path: safePath.substring(0, 100) + '...',
        });
      }

      if (pathCheck.hasTraversal) {
        violations.push({
          code: ZipViolationCode.PATH_TRAVERSAL,
          message: `Path traversal detected: ${safePath}`,
          path: safePath,
        });
      }

      if (pathCheck.hasAbsolutePath) {
        violations.push({
          code: ZipViolationCode.ABSOLUTE_PATH,
          message: `Absolute path detected: ${safePath}`,
          path: safePath,
        });
      }
    });
    
    return {
      safe: violations.length === 0,
      violations,
    };
  } catch (error) {
    violations.push({
      code: ZipViolationCode.PARSE_ERROR,
      message: `Failed to parse archive: ${error instanceof Error ? error.message : 'unknown'}`,
    });
    return { safe: false, violations };
  }
}

/**
 * Quick check if buffer appears to be a zip bomb
 * Returns true if the file should be blocked
 */
export async function isZipBomb(
  buffer: Buffer,
  options?: Partial<ZipBombCheckOptions>
): Promise<boolean> {
  const result = await checkZipBomb(buffer, options);
  return result.blocked;
}

/**
 * Validate a ZIP-based document file (DOCX, XLSX, PPTX, etc.)
 */
export async function validateZipDocument(
  buffer: Buffer,
  filename: string
): Promise<{ valid: boolean; error?: string; violations?: ZipSecurityViolation[] }> {
  const result = await checkZipBomb(buffer);
  
  if (result.blocked) {
    console.error(`[ZipBombGuard] Blocked suspicious file: ${filename}`, {
      reason: result.reason,
      metrics: result.metrics,
      violations: result.violations,
    });
    
    return {
      valid: false,
      error: `Security check failed: ${result.reason}`,
      violations: result.violations,
    };
  }
  
  if (result.suspicious) {
    console.warn(`[ZipBombGuard] Suspicious but allowed: ${filename}`, {
      metrics: result.metrics,
    });
  }
  
  return { valid: true, violations: [] };
}

export const zipBombGuard = {
  checkZipBomb,
  isZipBomb,
  validateZipDocument,
  checkPathTraversalInZip,
  DEFAULT_OPTIONS,
  ZipViolationCode,
};
