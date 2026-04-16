/**
 * Security Utilities - Centralized security functions
 * SECURITY FIX #50: Centralized input validation and sanitization utilities
 */

import net from "node:net";
import path from "node:path";

// Sensitive field names to always redact from logs
export const SENSITIVE_FIELDS = [
  'password', 'token', 'secret', 'apiKey', 'api_key', 'authorization',
  'cookie', 'session', 'credit_card', 'ssn', 'cvv', 'pin', 'private_key',
  'access_token', 'refresh_token', 'bearer'
];

// Dangerous SQL patterns
export const DANGEROUS_SQL_PATTERNS = [
  /;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)/i,
  /INTO\s+OUTFILE/i,
  /LOAD_FILE/i,
  /pg_sleep/i,
  /pg_terminate/i,
  /COPY\s+(TO|FROM)/i,
  /pg_read_file/i,
  /pg_ls_dir/i,
  /lo_import/i,
  /lo_export/i,
  /dblink/i,
  /\/\*[\s\S]*?(DROP|DELETE|UPDATE|INSERT)/i,
];

// Characters that trigger formula execution in spreadsheets
export const CSV_INJECTION_CHARS = ['=', '+', '-', '@', '\t', '\r', '\n'];

/**
 * Sanitize object by removing/redacting sensitive fields
 */
export function sanitizeSensitiveData<T extends Record<string, any>>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;

  const sanitized = { ...obj };

  for (const [key, value] of Object.entries(sanitized)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_FIELDS.some(field => lowerKey.includes(field))) {
      sanitized[key as keyof T] = '[REDACTED]' as any;
    } else if (Array.isArray(value)) {
      sanitized[key as keyof T] = value
        .map((item) => sanitizeSensitiveData(item) as Record<string, unknown>) as any;
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key as keyof T] = sanitizeSensitiveData(value);
    }
  }
  return sanitized;
}

/**
 * Check if a SQL query contains dangerous patterns
 */
export function containsDangerousSql(query: string): boolean {
  if (typeof query !== "string") {
    return false;
  }
  return DANGEROUS_SQL_PATTERNS.some((pattern) => pattern.test(query));
}

/**
 * Sanitize CSV value to prevent formula injection
 */
export function sanitizeCsvValue(value: any): string {
  if (value === null || value === undefined) return "";

  let str: string;
  try {
    str = typeof value === "object" ? JSON.stringify(value) : String(value);
  } catch (_error) {
    str = String(value);
  }

  // Escape double quotes
  str = str.replace(/"/g, '""');

  // Prefix dangerous characters with single quote
  if (CSV_INJECTION_CHARS.some(char => str.startsWith(char))) {
    str = "'" + str;
  }

  // Wrap in quotes if needed
  if (str.includes(',') || str.includes('\n') || str.includes('\r') || str.includes('"')) {
    str = `"${str}"`;
  }

  return str;
}

/**
 * Validate and sanitize a file path to prevent traversal
 */
export function sanitizeFilePath(filePath: string, baseDir?: string): string | null {
  if (typeof filePath !== "string" || filePath.length === 0) {
    return null;
  }
  // Normalize and resolve path
  const normalized = path.normalize(filePath).replace(/\\/g, "/");
  const hasPathTraversal = normalized.includes("..") || normalized.includes("\0");
  if (hasPathTraversal) {
    return null;
  }

  if (baseDir) {
    const resolvedBase = path.resolve(baseDir);
    const resolvedPath = path.resolve(baseDir, normalized);
    if (!resolvedPath.startsWith(`${resolvedBase}${path.sep}`) && resolvedPath !== resolvedBase) {
      return null;
    }
    return resolvedPath;
  }

  if (!path.isAbsolute(normalized) && normalized.includes("/")) {
    const absolute = path.resolve(normalized);
    return absolute;
  }

  return normalized;
}

/**
 * Validate file name for safe storage
 */
export function sanitizeFileName(fileName: string, maxLength: number = 255): string {
  // Remove path separators, null bytes, and other dangerous characters
  if (typeof fileName !== "string") {
    return "";
  }

  let safe = fileName.replace(/[\/\\:\*\?"<>|\x00\r\n\t]/g, "_");
  safe = safe.replace(/[^\x20-\x7E]/g, "_");

  // Limit length while preserving extension
  if (safe.length > maxLength) {
    const ext = path.extname(safe);
    safe = safe.substring(0, maxLength - ext.length) + ext;
  }

  return safe;
}

/**
 * Check if IP address is internal/private
 */
export function isInternalIP(ip: string | undefined): boolean {
  if (!ip) return false;

  const normalized = ip.trim().toLowerCase();
  if (!normalized) return false;

  const candidate = normalized.replace(/^\[(.+)\]$/, "$1");

  if (candidate === "localhost" || candidate === "::1" || candidate === "0:0:0:0:0:0:0:1") {
    return true;
  }

  const version = net.isIP(candidate);
  if (version === 4) {
    const octets = candidate.split(".").map((part) => Number.parseInt(part, 10));
    if (octets.length !== 4 || octets.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
      return false;
    }

    return (
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    );
  }

  if (version === 6) {
    const mapped = (() => {
      const mappedPrefixes = ["::ffff:", "0:0:0:0:0:ffff:"];
      const hasMappedPrefix = mappedPrefixes.find((prefix) => candidate.startsWith(prefix));
      if (!hasMappedPrefix) {
        return null;
      }

      const mappedCandidate = candidate.slice(hasMappedPrefix.length);
      if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(mappedCandidate)) {
        return mappedCandidate;
      }

      const mappedParts = mappedCandidate.split(":");
      if (
        (mappedParts.length === 1 || mappedParts.length === 2)
        && mappedParts.every((part) => /^[0-9a-f]{1,4}$/i.test(part))
      ) {
        const normalizedParts = mappedParts.map((part) => part.padStart(4, "0"));
        const hex = normalizedParts.join("");
        if (hex.length === 8) {
          const first = Number.parseInt(hex.slice(0, 2), 16);
          const second = Number.parseInt(hex.slice(2, 4), 16);
          const third = Number.parseInt(hex.slice(4, 6), 16);
          const fourth = Number.parseInt(hex.slice(6, 8), 16);
          if (
            [first, second, third, fourth].every((part) => Number.isFinite(part))
          ) {
            return `${first}.${second}.${third}.${fourth}`;
          }
        }
      }

      return null;
    })();

    if (mapped) {
      return isInternalIP(mapped);
    }

    if (candidate.startsWith("fc") || candidate.startsWith("fd") || candidate.startsWith("fe8") || candidate.startsWith("fe9") ||
        candidate.startsWith("fea") || candidate.startsWith("feb") || candidate.startsWith("fec") || candidate.startsWith("fed") ||
        candidate.startsWith("fee") || candidate.startsWith("fef")) {
      return true;
    }
    if (candidate.startsWith("fe80")) {
      return true;
    }
  }

  const privateIPPrefixes = [
    '10.', '172.16.', '172.17.', '172.18.', '172.19.', '172.20.',
    '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.',
    '172.27.', '172.28.', '172.29.', '172.30.', '172.31.', '192.168.'
  ];

  // Handle IPv6-mapped IPv4
  const cleanIP = candidate.replace('::ffff:', '');
  return privateIPPrefixes.some(prefix => cleanIP.startsWith(prefix));
}

/**
 * Mask sensitive value for logging (show first/last few chars)
 */
export function maskSensitiveValue(value: string, showChars: number = 3): string {
  if (!value || value.length <= showChars * 2) {
    return '***';
  }
  return value.substring(0, showChars) + '***' + value.substring(value.length - showChars);
}

/**
 * Rate limit key generator that includes user context
 */
export function generateRateLimitKey(prefix: string, userId?: string, ip?: string): string {
  const identifier = userId || ip || 'anonymous';
  return `${prefix}:${identifier}`;
}

/**
 * Validate content length within bounds
 */
export function validateContentLength(
  content: string,
  maxLength: number,
  minLength: number = 0
): { valid: boolean; error?: string } {
  if (typeof content !== 'string') {
    return { valid: false, error: 'Content must be a string' };
  }
  if (content.length < minLength) {
    return { valid: false, error: `Content must be at least ${minLength} characters` };
  }
  if (content.length > maxLength) {
    return { valid: false, error: `Content exceeds maximum length of ${maxLength} characters` };
  }
  return { valid: true };
}
