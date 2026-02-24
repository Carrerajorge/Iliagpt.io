/**
 * Input Sanitizer — Enterprise input sanitization layer for connector operations.
 *
 * Provides two main functions:
 *  - sanitizeConnectorInput:  Strip unknown keys, enforce length/depth limits,
 *    detect injection patterns, validate formats (email, URI).
 *  - sanitizeConnectorOutput: Redact secrets, PII, and sensitive tokens from
 *    connector responses before they reach the LLM or the user.
 *
 * Zero external dependencies.  All patterns are statically defined.
 */

import type { JSONSchema7 } from "json-schema";

// ─── Configuration ──────────────────────────────────────────────────

export interface SanitizationConfig {
  /** Default max string length in bytes (default 10 240) */
  maxStringLength: number;
  /** Max items in any array (default 100) */
  maxArrayLength: number;
  /** Max nested object depth (default 5) */
  maxDepth: number;
  /** Whether to strip unknown keys not in the schema (default true) */
  stripUnknownKeys: boolean;
  /** Whether to log injection warnings (default true) */
  logInjectionWarnings: boolean;
}

const DEFAULT_CONFIG: SanitizationConfig = {
  maxStringLength: 10_240,
  maxArrayLength: 100,
  maxDepth: 5,
  stripUnknownKeys: true,
  logInjectionWarnings: true,
};

export function createSanitizationConfig(
  overrides?: Partial<SanitizationConfig>
): SanitizationConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

// ─── Report ─────────────────────────────────────────────────────────

export interface SanitizationWarning {
  path: string;
  type:
    | "sql_injection"
    | "script_injection"
    | "path_traversal"
    | "shell_metachar"
    | "null_byte"
    | "truncated"
    | "stripped_key"
    | "invalid_email"
    | "invalid_url"
    | "ssrf_blocked"
    | "array_truncated"
    | "depth_exceeded";
  message: string;
}

export interface SanitizationReport {
  connectorId: string;
  operationId: string;
  timestamp: string;
  warnings: SanitizationWarning[];
  strippedKeys: string[];
  totalFieldsSanitized: number;
}

// ─── Redaction result ───────────────────────────────────────────────

export interface RedactionEntry {
  path: string;
  type: string;
}

export interface SanitizedOutput<T = unknown> {
  sanitized: T;
  redactions: RedactionEntry[];
}

// ─── Injection patterns ─────────────────────────────────────────────

const SQL_INJECTION_PATTERNS = [
  /'\s*;\s*drop\s+table/i,
  /'\s*;\s*delete\s+from/i,
  /'\s*;\s*insert\s+into/i,
  /'\s*;\s*update\s+.*\s+set/i,
  /union\s+(all\s+)?select/i,
  /'\s+or\s+['"]?\d+['"]?\s*=\s*['"]?\d+/i,
  /'\s+or\s+1\s*=\s*1/i,
  /'\s*--/,
  /;\s*exec\s*\(/i,
  /;\s*execute\s*\(/i,
  /xp_cmdshell/i,
  /information_schema/i,
  /sys\.objects/i,
];

const SCRIPT_INJECTION_PATTERNS = [
  /<script[\s>]/i,
  /<\/script>/i,
  /javascript\s*:/i,
  /vbscript\s*:/i,
  /on\w+\s*=\s*["']/i,          // onclick="", onerror="", etc.
  /data\s*:\s*text\/html/i,
  /<iframe[\s>]/i,
  /<object[\s>]/i,
  /<embed[\s>]/i,
  /<svg[\s>].*?on\w+\s*=/i,
  /expression\s*\(/i,            // CSS expression()
  /url\s*\(\s*["']?\s*javascript:/i,
];

const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//,
  /\.\.\\/,
  /%2e%2e/i,
  /%2e%2e%2f/i,
  /%2e%2e%5c/i,
  /\.\.%2f/i,
  /\.\.%5c/i,
];

const SHELL_METACHAR_RE = /[;|&`$(){}[\]!#]/;

// ─── Secret detection patterns for output redaction ─────────────────

const API_KEY_PREFIXES = [
  "sk-",
  "pk_",
  "Bearer ",
  "token_",
  "xoxb-",
  "xoxp-",
  "ghp_",
  "ghu_",
  "glpat-",
  "AKIA",       // AWS
  "sk_live_",   // Stripe
  "sk_test_",   // Stripe
  "rk_live_",   // Stripe restricted
  "whsec_",     // Stripe webhook
];

const SENSITIVE_KEY_NAMES = new Set([
  "password",
  "secret",
  "credentials",
  "api_key",
  "apikey",
  "apiKey",
  "api_secret",
  "apiSecret",
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "private_key",
  "privateKey",
  "client_secret",
  "clientSecret",
  "authorization",
  "auth_token",
  "authToken",
  "session_token",
  "sessionToken",
]);

const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;
const CREDIT_CARD_RE = /\b(\d[ -]?){12,18}\d\b/;

// ─── URL / Email validation helpers ─────────────────────────────────

const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/** Private / reserved IPv4 ranges for SSRF prevention */
function isPrivateIp(hostname: string): boolean {
  // Strip brackets for IPv6
  const h = hostname.replace(/^\[|\]$/g, "");

  // IPv6 loopback / link-local
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc00:") || h.startsWith("fd")) {
    return true;
  }

  // IPv4
  const parts = h.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p))) return false;

  const [a, b] = parts;
  if (a === 10) return true;                           // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true;    // 172.16.0.0/12
  if (a === 192 && b === 168) return true;              // 192.168.0.0/16
  if (a === 127) return true;                           // 127.0.0.0/8
  if (a === 169 && b === 254) return true;              // 169.254.0.0/16 (link-local)
  if (a === 0) return true;                             // 0.0.0.0/8

  return false;
}

const METADATA_HOSTNAMES = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.google.com",
  "instance-data",
]);

function isValidUrl(raw: string): { valid: boolean; reason?: string } {
  try {
    const url = new URL(raw);

    // Protocol check
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { valid: false, reason: `Blocked protocol: ${url.protocol}` };
    }

    // SSRF: private IPs
    if (isPrivateIp(url.hostname)) {
      return { valid: false, reason: `Blocked private IP: ${url.hostname}` };
    }

    // SSRF: metadata endpoints
    if (METADATA_HOSTNAMES.has(url.hostname)) {
      return { valid: false, reason: `Blocked metadata endpoint: ${url.hostname}` };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: "Malformed URL" };
  }
}

// ─── Luhn check for credit card validation ──────────────────────────

function luhnCheck(digits: string): boolean {
  const nums = digits.replace(/\D/g, "");
  if (nums.length < 13 || nums.length > 19) return false;

  let sum = 0;
  let double = false;
  for (let i = nums.length - 1; i >= 0; i--) {
    let digit = parseInt(nums[i], 10);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

// ─── Core sanitization logic ────────────────────────────────────────

function sanitizeString(
  value: string,
  path: string,
  maxLen: number,
  warnings: SanitizationWarning[]
): string {
  let result = value;

  // Remove null bytes
  if (result.includes("\0")) {
    warnings.push({ path, type: "null_byte", message: "Null byte removed" });
    result = result.replace(/\0/g, "");
  }

  // Trim whitespace
  result = result.trim();

  // Enforce max length
  if (result.length > maxLen) {
    warnings.push({
      path,
      type: "truncated",
      message: `String truncated from ${result.length} to ${maxLen} chars`,
    });
    result = result.slice(0, maxLen);
  }

  // Check injection patterns (warn, don't block)
  for (const pattern of SQL_INJECTION_PATTERNS) {
    if (pattern.test(result)) {
      warnings.push({
        path,
        type: "sql_injection",
        message: `Potential SQL injection detected: ${pattern.source}`,
      });
      break; // one warning per category is enough
    }
  }

  for (const pattern of SCRIPT_INJECTION_PATTERNS) {
    if (pattern.test(result)) {
      warnings.push({
        path,
        type: "script_injection",
        message: `Potential script injection detected: ${pattern.source}`,
      });
      break;
    }
  }

  for (const pattern of PATH_TRAVERSAL_PATTERNS) {
    if (pattern.test(result)) {
      warnings.push({
        path,
        type: "path_traversal",
        message: `Potential path traversal detected`,
      });
      break;
    }
  }

  if (SHELL_METACHAR_RE.test(result)) {
    // Only warn for values that look like filenames (no spaces, no long text)
    if (result.length < 256 && !result.includes(" ")) {
      warnings.push({
        path,
        type: "shell_metachar",
        message: `Shell metacharacter detected in value that may be used as filename`,
      });
    }
  }

  return result;
}

function getSchemaMaxLength(schema: JSONSchema7 | boolean | undefined): number | undefined {
  if (!schema || typeof schema === "boolean") return undefined;
  return typeof schema.maxLength === "number" ? schema.maxLength : undefined;
}

function getSchemaFormat(schema: JSONSchema7 | boolean | undefined): string | undefined {
  if (!schema || typeof schema === "boolean") return undefined;
  return schema.format;
}

function getSchemaProperties(
  schema: JSONSchema7 | boolean | undefined
): Record<string, JSONSchema7 | boolean> | undefined {
  if (!schema || typeof schema === "boolean") return undefined;
  return schema.properties as Record<string, JSONSchema7 | boolean> | undefined;
}

function getSchemaItems(schema: JSONSchema7 | boolean | undefined): JSONSchema7 | boolean | undefined {
  if (!schema || typeof schema === "boolean") return undefined;
  if (Array.isArray(schema.items)) return schema.items[0]; // tuple — use first
  return schema.items;
}

function sanitizeValue(
  value: unknown,
  path: string,
  schema: JSONSchema7 | boolean | undefined,
  config: SanitizationConfig,
  warnings: SanitizationWarning[],
  strippedKeys: string[],
  depth: number,
  fieldsSanitized: { count: number }
): unknown {
  if (value === null || value === undefined) return value;

  // Depth guard
  if (depth > config.maxDepth) {
    warnings.push({
      path,
      type: "depth_exceeded",
      message: `Object depth exceeded maximum of ${config.maxDepth}`,
    });
    return undefined;
  }

  // --- String ---
  if (typeof value === "string") {
    const maxLen = getSchemaMaxLength(schema) ?? config.maxStringLength;
    const sanitized = sanitizeString(value, path, maxLen, warnings);
    fieldsSanitized.count++;

    // Format validations
    const format = getSchemaFormat(schema);
    if (format === "email") {
      if (!EMAIL_RE.test(sanitized)) {
        warnings.push({
          path,
          type: "invalid_email",
          message: `Invalid email format: ${sanitized.slice(0, 50)}`,
        });
      }
    } else if (format === "uri" || format === "url") {
      const urlCheck = isValidUrl(sanitized);
      if (!urlCheck.valid) {
        const warningType = urlCheck.reason?.includes("private") || urlCheck.reason?.includes("metadata")
          ? "ssrf_blocked" as const
          : "invalid_url" as const;
        warnings.push({ path, type: warningType, message: urlCheck.reason! });
      }
    }

    return sanitized;
  }

  // --- Number / Boolean ---
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  // --- Array ---
  if (Array.isArray(value)) {
    if (value.length > config.maxArrayLength) {
      warnings.push({
        path,
        type: "array_truncated",
        message: `Array truncated from ${value.length} to ${config.maxArrayLength} items`,
      });
    }
    const itemSchema = getSchemaItems(schema);
    return value.slice(0, config.maxArrayLength).map((item, idx) =>
      sanitizeValue(item, `${path}[${idx}]`, itemSchema, config, warnings, strippedKeys, depth + 1, fieldsSanitized)
    );
  }

  // --- Object ---
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    const schemaProps = getSchemaProperties(schema);

    for (const [key, val] of Object.entries(obj)) {
      // Strip unknown keys if schema is provided and config says so
      if (config.stripUnknownKeys && schemaProps && !(key in schemaProps)) {
        strippedKeys.push(`${path}.${key}`);
        warnings.push({
          path: `${path}.${key}`,
          type: "stripped_key",
          message: `Unknown key "${key}" removed (not in schema)`,
        });
        continue;
      }

      const propSchema = schemaProps ? schemaProps[key] : undefined;
      result[key] = sanitizeValue(
        val,
        `${path}.${key}`,
        propSchema,
        config,
        warnings,
        strippedKeys,
        depth + 1,
        fieldsSanitized
      );
    }

    return result;
  }

  return value;
}

// ─── Output redaction logic ─────────────────────────────────────────

function redactValue(
  value: unknown,
  path: string,
  parentKey: string,
  redactions: RedactionEntry[],
  depth: number
): unknown {
  if (depth > 10) return value; // safety cap

  if (value === null || value === undefined) return value;

  // String value — check for secrets
  if (typeof value === "string") {
    // Check if the parent key is a sensitive field name
    const keyLower = parentKey.toLowerCase();
    for (const sensitive of SENSITIVE_KEY_NAMES) {
      if (keyLower === sensitive.toLowerCase() || keyLower.endsWith(`_${sensitive.toLowerCase()}`)) {
        if (value.length > 0) {
          redactions.push({ path, type: "sensitive_key" });
          return "[REDACTED:credential]";
        }
      }
    }

    // Check for API key prefixes
    for (const prefix of API_KEY_PREFIXES) {
      if (value.startsWith(prefix) && value.length > prefix.length + 4) {
        redactions.push({ path, type: "api_key" });
        return "[REDACTED:api_key]";
      }
    }

    // Check for SSN
    if (SSN_RE.test(value)) {
      redactions.push({ path, type: "ssn" });
      return value.replace(SSN_RE, "[REDACTED:ssn]");
    }

    // Check for credit card numbers
    const ccMatch = value.match(CREDIT_CARD_RE);
    if (ccMatch) {
      const candidate = ccMatch[0];
      const digits = candidate.replace(/\D/g, "");
      if (luhnCheck(digits)) {
        redactions.push({ path, type: "credit_card" });
        return value.replace(CREDIT_CARD_RE, "[REDACTED:credit_card]");
      }
    }

    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, idx) =>
      redactValue(item, `${path}[${idx}]`, parentKey, redactions, depth + 1)
    );
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = redactValue(val, `${path}.${key}`, key, redactions, depth + 1);
    }
    return result;
  }

  return value;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Sanitize input before it reaches a connector handler.
 *
 * @param connectorId   Connector identifier (for logging)
 * @param operationId   Operation identifier (for logging)
 * @param input         Raw input from the LLM / user
 * @param schema        JSON Schema 7 for the operation's input
 * @param configOverrides  Optional config overrides
 * @returns             Sanitized input + structured report
 */
export function sanitizeConnectorInput(
  connectorId: string,
  operationId: string,
  input: Record<string, unknown>,
  schema: JSONSchema7,
  configOverrides?: Partial<SanitizationConfig>
): { sanitized: Record<string, unknown>; report: SanitizationReport } {
  const config = { ...DEFAULT_CONFIG, ...configOverrides };
  const warnings: SanitizationWarning[] = [];
  const strippedKeys: string[] = [];
  const fieldsSanitized = { count: 0 };

  const sanitized = sanitizeValue(
    input,
    "$",
    schema,
    config,
    warnings,
    strippedKeys,
    0,
    fieldsSanitized
  ) as Record<string, unknown>;

  const report: SanitizationReport = {
    connectorId,
    operationId,
    timestamp: new Date().toISOString(),
    warnings,
    strippedKeys,
    totalFieldsSanitized: fieldsSanitized.count,
  };

  // Structured log for observability
  if (config.logInjectionWarnings && warnings.length > 0) {
    const injectionWarnings = warnings.filter(
      (w) =>
        w.type === "sql_injection" ||
        w.type === "script_injection" ||
        w.type === "path_traversal" ||
        w.type === "shell_metachar" ||
        w.type === "ssrf_blocked"
    );
    if (injectionWarnings.length > 0) {
      console.warn(
        JSON.stringify({
          event: "connector_input_injection_warning",
          connectorId,
          operationId,
          warnings: injectionWarnings.map((w) => ({
            path: w.path,
            type: w.type,
          })),
          timestamp: report.timestamp,
        })
      );
    }
  }

  return { sanitized, report };
}

/**
 * Redact sensitive data from connector output before returning to the LLM / user.
 *
 * @param connectorId   Connector identifier (for logging)
 * @param operationId   Operation identifier (for logging)
 * @param output        Raw output from the connector handler
 * @returns             Redacted output + list of what was redacted
 */
export function sanitizeConnectorOutput<T = unknown>(
  connectorId: string,
  operationId: string,
  output: T
): SanitizedOutput<T> {
  const redactions: RedactionEntry[] = [];

  const sanitized = redactValue(output, "$", "", redactions, 0) as T;

  // Log redactions for audit
  if (redactions.length > 0) {
    console.warn(
      JSON.stringify({
        event: "connector_output_redaction",
        connectorId,
        operationId,
        redactionCount: redactions.length,
        types: [...new Set(redactions.map((r) => r.type))],
        timestamp: new Date().toISOString(),
      })
    );
  }

  return { sanitized, redactions };
}
