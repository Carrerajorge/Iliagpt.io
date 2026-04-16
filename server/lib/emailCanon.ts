/**
 * Email Canonicalization & RFC Validation
 *
 * Provides deterministic email normalization for deduplication
 * and basic RFC 5321 validation.
 */

import { URL } from "url";

/**
 * Canonicalize an email address to a deterministic form:
 *  1. Trim whitespace
 *  2. Lowercase the entire address (RFC 5321 says local-part is case-sensitive,
 *     but virtually no provider respects this)
 *  3. Apply punycode to internationalized domains (IDN → ACE form)
 */
export function canonicalizeEmail(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex < 1) return trimmed; // malformed – return best-effort

  const localPart = trimmed.slice(0, atIndex);
  let domain = trimmed.slice(atIndex + 1);

  // Convert internationalized domain to ASCII (punycode)
  try {
    const url = new URL(`http://${domain}`);
    domain = url.hostname; // Node's URL parser applies punycode automatically
  } catch {
    // If parsing fails, keep the lowercased domain as-is
  }

  return `${localPart}@${domain}`;
}

/**
 * Validate an email address against basic RFC 5321 rules.
 * This is NOT a full RFC 5322 parser — it covers the practical subset.
 */
export function validateEmailRFC(email: string): { valid: boolean; reason?: string } {
  if (!email || typeof email !== "string") {
    return { valid: false, reason: "Email is required" };
  }

  const trimmed = email.trim();
  if (trimmed.length > 254) {
    return { valid: false, reason: "Email exceeds 254 characters" };
  }

  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex < 1) {
    return { valid: false, reason: "Missing @ separator" };
  }

  const localPart = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);

  // Local part: max 64 chars, no consecutive dots, no leading/trailing dot
  if (localPart.length > 64) {
    return { valid: false, reason: "Local part exceeds 64 characters" };
  }
  if (localPart.length === 0) {
    return { valid: false, reason: "Local part is empty" };
  }
  if (localPart.startsWith(".") || localPart.endsWith(".")) {
    return { valid: false, reason: "Local part cannot start or end with a dot" };
  }
  if (localPart.includes("..")) {
    return { valid: false, reason: "Local part contains consecutive dots" };
  }

  // Domain: must have at least one dot, no consecutive dots, labels max 63 chars
  if (domain.length === 0) {
    return { valid: false, reason: "Domain is empty" };
  }
  if (domain.length > 255) {
    return { valid: false, reason: "Domain exceeds 255 characters" };
  }
  if (domain.includes("..")) {
    return { valid: false, reason: "Domain contains consecutive dots" };
  }

  const labels = domain.split(".");
  if (labels.length < 2) {
    return { valid: false, reason: "Domain must have at least two labels" };
  }
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) {
      return { valid: false, reason: `Domain label "${label}" has invalid length` };
    }
    if (label.startsWith("-") || label.endsWith("-")) {
      return { valid: false, reason: `Domain label "${label}" cannot start or end with hyphen` };
    }
    // Allow alphanumeric, hyphens, and IDN (non-ASCII) characters
    if (!/^[a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF-]+$/.test(label)) {
      return { valid: false, reason: `Domain label "${label}" contains invalid characters` };
    }
  }

  // Basic local-part character check (allow common printable + quoted fallback)
  // Permissive: alphanumeric, dots, hyphens, underscores, plus, and some special chars
  if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(localPart)) {
    return { valid: false, reason: "Local part contains invalid characters" };
  }

  return { valid: true };
}
