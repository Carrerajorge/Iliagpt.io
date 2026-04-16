/**
 * Output Sanitization Pipeline
 * Detects and sanitizes PII, secrets, and sensitive data before delivering responses
 */

// ===== Types =====

export type PIIType = 
  | "email"
  | "phone"
  | "ssn"
  | "tax_id"
  | "credit_card"
  | "name"
  | "address"
  | "date_of_birth";

export type SecretType =
  | "api_key"
  | "password"
  | "jwt_token"
  | "private_key"
  | "connection_string"
  | "aws_key"
  | "oauth_token"
  | "bearer_token";

export type SanitizationAction = "REDACT" | "MASK" | "BLOCK" | "LOG";

export type ContextLevel = "admin" | "user" | "api";

export interface PIIMatch {
  type: PIIType;
  value: string;
  startIndex: number;
  endIndex: number;
  confidence: number;
}

export interface SecretMatch {
  type: SecretType;
  value: string;
  startIndex: number;
  endIndex: number;
  pattern: string;
}

export interface ValidationResult {
  isValid: boolean;
  hasPII: boolean;
  hasSecrets: boolean;
  piiMatches: PIIMatch[];
  secretMatches: SecretMatch[];
  riskLevel: "low" | "medium" | "high" | "critical";
  blockReasons: string[];
}

export interface SanitizedOutput {
  content: string;
  wasModified: boolean;
  sanitizationApplied: SanitizationAction[];
  redactedCount: number;
  maskedCount: number;
  blockedReason?: string;
  validation: ValidationResult;
  processingTimeMs: number;
}

export interface SanitizerOptions {
  contextLevel: ContextLevel;
  piiAction?: SanitizationAction;
  secretAction?: SanitizationAction;
  customRules?: CustomRule[];
  enableMetrics?: boolean;
  strictMode?: boolean;
}

export interface CustomRule {
  name: string;
  pattern: RegExp;
  type: "pii" | "secret";
  action: SanitizationAction;
}

interface SanitizerConfig {
  pii: Record<ContextLevel, Record<PIIType, SanitizationAction>>;
  secrets: Record<ContextLevel, Record<SecretType, SanitizationAction>>;
}

// ===== Patterns =====

const PII_PATTERNS: Record<PIIType, RegExp> = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi,
  phone: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g,
  ssn: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
  tax_id: /\b\d{2}[-\s]?\d{7}\b|\b[A-Z]{1,2}\d{6,8}[A-Z]?\b/gi,
  credit_card: /\b(?:\d{4}[-\s]?){3}\d{4}\b|\b\d{15,16}\b/g,
  name: /\b(?:Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g,
  address: /\b\d{1,5}\s+[A-Za-z]+(?:\s+[A-Za-z]+)*\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court)\b/gi,
  date_of_birth: /\b(?:0?[1-9]|1[0-2])[-/](?:0?[1-9]|[12]\d|3[01])[-/](?:19|20)\d{2}\b/g
};

const SECRET_PATTERNS: Record<SecretType, RegExp> = {
  api_key: /\b(?:sk_(?:live|test)_[A-Za-z0-9]{24,}|pk_(?:live|test)_[A-Za-z0-9]{24,}|rk_(?:live|test)_[A-Za-z0-9]{24,})\b/g,
  aws_key: /\b(?:AKIA|ABIA|ACCA|ASIA)[A-Z0-9]{16}\b/g,
  password: /(?:password|passwd|pwd|secret|token)\s*[:=]\s*["']?[^\s"']{6,}["']?/gi,
  jwt_token: /\beyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\b/g,
  private_key: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  connection_string: /(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp|mssql):\/\/[^\s]+/gi,
  oauth_token: /\b(?:ya29\.[A-Za-z0-9_-]+|ghp_[A-Za-z0-9]{36,}|gho_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g,
  bearer_token: /\bBearer\s+[A-Za-z0-9_-]{20,}\b/gi
};

// ===== Default Configuration by Context =====

const DEFAULT_CONFIG: SanitizerConfig = {
  pii: {
    admin: {
      email: "LOG",
      phone: "LOG",
      ssn: "MASK",
      tax_id: "MASK",
      credit_card: "REDACT",
      name: "LOG",
      address: "LOG",
      date_of_birth: "LOG"
    },
    user: {
      email: "MASK",
      phone: "MASK",
      ssn: "REDACT",
      tax_id: "REDACT",
      credit_card: "REDACT",
      name: "LOG",
      address: "MASK",
      date_of_birth: "MASK"
    },
    api: {
      email: "REDACT",
      phone: "REDACT",
      ssn: "REDACT",
      tax_id: "REDACT",
      credit_card: "REDACT",
      name: "REDACT",
      address: "REDACT",
      date_of_birth: "REDACT"
    }
  },
  secrets: {
    admin: {
      api_key: "MASK",
      aws_key: "REDACT",
      password: "REDACT",
      jwt_token: "MASK",
      private_key: "BLOCK",
      connection_string: "REDACT",
      oauth_token: "REDACT",
      bearer_token: "MASK"
    },
    user: {
      api_key: "REDACT",
      aws_key: "REDACT",
      password: "REDACT",
      jwt_token: "REDACT",
      private_key: "BLOCK",
      connection_string: "REDACT",
      oauth_token: "REDACT",
      bearer_token: "REDACT"
    },
    api: {
      api_key: "BLOCK",
      aws_key: "BLOCK",
      password: "BLOCK",
      jwt_token: "BLOCK",
      private_key: "BLOCK",
      connection_string: "BLOCK",
      oauth_token: "BLOCK",
      bearer_token: "BLOCK"
    }
  }
};

// ===== Metrics =====

interface SanitizerMetrics {
  piiDetected: Record<PIIType, number>;
  secretsDetected: Record<SecretType, number>;
  blockedResponses: number;
  totalProcessed: number;
  totalRedacted: number;
  totalMasked: number;
}

const metrics: SanitizerMetrics = {
  piiDetected: {
    email: 0,
    phone: 0,
    ssn: 0,
    tax_id: 0,
    credit_card: 0,
    name: 0,
    address: 0,
    date_of_birth: 0
  },
  secretsDetected: {
    api_key: 0,
    aws_key: 0,
    password: 0,
    jwt_token: 0,
    private_key: 0,
    connection_string: 0,
    oauth_token: 0,
    bearer_token: 0
  },
  blockedResponses: 0,
  totalProcessed: 0,
  totalRedacted: 0,
  totalMasked: 0
};

// ===== Utility Functions =====

function luhnCheck(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let isEven = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits[i], 10);

    if (isEven) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }

    sum += digit;
    isEven = !isEven;
  }

  return sum % 10 === 0;
}

function maskValue(value: string, type: PIIType | SecretType): string {
  switch (type) {
    case "email": {
      const [local, domain] = value.split("@");
      if (!domain) return "***@***.***";
      const maskedLocal = local.length > 2 
        ? local[0] + "***" + local[local.length - 1]
        : "***";
      return `${maskedLocal}@${domain}`;
    }
    case "phone": {
      const digits = value.replace(/\D/g, "");
      if (digits.length < 4) return "***";
      return "***-***-" + digits.slice(-4);
    }
    case "ssn":
    case "tax_id":
      return "***-**-" + value.slice(-4).replace(/\D/g, "");
    case "credit_card": {
      const cardDigits = value.replace(/\D/g, "");
      return "****-****-****-" + cardDigits.slice(-4);
    }
    case "api_key":
    case "aws_key":
    case "oauth_token":
      return value.slice(0, 4) + "..." + value.slice(-4);
    case "jwt_token":
      return "eyJ***...***";
    case "bearer_token":
      return "Bearer ***...***";
    case "connection_string": {
      const match = value.match(/^(\w+:\/\/)[^:]+:[^@]+@(.+)$/);
      if (match) {
        return `${match[1]}***:***@${match[2]}`;
      }
      return "***://***:***@***";
    }
    default:
      if (value.length <= 4) return "***";
      return value.slice(0, 2) + "***" + value.slice(-2);
  }
}

// ===== OutputSanitizer Class =====

export class OutputSanitizer {
  private config: SanitizerConfig;
  private customRules: CustomRule[] = [];

  constructor(config?: Partial<SanitizerConfig>) {
    this.config = {
      pii: { ...DEFAULT_CONFIG.pii, ...config?.pii },
      secrets: { ...DEFAULT_CONFIG.secrets, ...config?.secrets }
    };
  }

  addCustomRule(rule: CustomRule): void {
    this.customRules.push(rule);
  }

  detectPII(content: string): PIIMatch[] {
    const matches: PIIMatch[] = [];

    for (const [type, pattern] of Object.entries(PII_PATTERNS) as [PIIType, RegExp][]) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(content)) !== null) {
        let confidence = 0.8;

        // Special validation for credit cards using Luhn algorithm
        if (type === "credit_card") {
          if (!luhnCheck(match[0])) {
            confidence = 0.3;
          } else {
            confidence = 0.95;
          }
        }

        // Higher confidence for well-formed emails
        if (type === "email" && /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(match[0])) {
          confidence = 0.95;
        }

        matches.push({
          type,
          value: match[0],
          startIndex: match.index,
          endIndex: match.index + match[0].length,
          confidence
        });
      }
    }

    // Update metrics
    for (const match of matches) {
      metrics.piiDetected[match.type]++;
    }

    return matches;
  }

  detectSecrets(content: string): SecretMatch[] {
    const matches: SecretMatch[] = [];

    for (const [type, pattern] of Object.entries(SECRET_PATTERNS) as [SecretType, RegExp][]) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(content)) !== null) {
        matches.push({
          type,
          value: match[0],
          startIndex: match.index,
          endIndex: match.index + match[0].length,
          pattern: pattern.source
        });
      }
    }

    // Update metrics
    for (const match of matches) {
      metrics.secretsDetected[match.type]++;
    }

    return matches;
  }

  validate(content: string): ValidationResult {
    const piiMatches = this.detectPII(content);
    const secretMatches = this.detectSecrets(content);
    const blockReasons: string[] = [];

    // Determine risk level
    let riskLevel: ValidationResult["riskLevel"] = "low";

    if (secretMatches.some(s => s.type === "private_key" || s.type === "connection_string")) {
      riskLevel = "critical";
      blockReasons.push("Critical secrets detected (private keys or connection strings)");
    } else if (secretMatches.length > 0) {
      riskLevel = "high";
      blockReasons.push(`${secretMatches.length} secret(s) detected`);
    } else if (piiMatches.some(p => p.type === "ssn" || p.type === "credit_card")) {
      riskLevel = "high";
      blockReasons.push("Sensitive PII detected (SSN or credit card)");
    } else if (piiMatches.length > 3) {
      riskLevel = "medium";
    } else if (piiMatches.length > 0) {
      riskLevel = "low";
    }

    return {
      isValid: blockReasons.length === 0,
      hasPII: piiMatches.length > 0,
      hasSecrets: secretMatches.length > 0,
      piiMatches,
      secretMatches,
      riskLevel,
      blockReasons
    };
  }

  sanitize(content: string, options: SanitizerOptions): SanitizedOutput {
    const startTime = Date.now();
    metrics.totalProcessed++;

    const validation = this.validate(content);
    const actionsApplied: SanitizationAction[] = [];
    let sanitizedContent = content;
    let redactedCount = 0;
    let maskedCount = 0;
    let blockedReason: string | undefined;

    const contextLevel = options.contextLevel;
    const piiConfig = this.config.pii[contextLevel];
    const secretConfig = this.config.secrets[contextLevel];

    // Check for BLOCK actions first
    for (const secretMatch of validation.secretMatches) {
      const action = options.secretAction || secretConfig[secretMatch.type];
      if (action === "BLOCK") {
        metrics.blockedResponses++;
        return {
          content: "",
          wasModified: true,
          sanitizationApplied: ["BLOCK"],
          redactedCount: 0,
          maskedCount: 0,
          blockedReason: `Response blocked: ${secretMatch.type} detected`,
          validation,
          processingTimeMs: Date.now() - startTime
        };
      }
    }

    // Sort matches by start index in reverse order to process from end to start
    const allMatches: Array<{
      type: PIIType | SecretType;
      value: string;
      startIndex: number;
      endIndex: number;
      isPII: boolean;
    }> = [
      ...validation.piiMatches.map(m => ({ ...m, isPII: true })),
      ...validation.secretMatches.map(m => ({ ...m, isPII: false }))
    ].sort((a, b) => b.startIndex - a.startIndex);

    // Apply sanitization actions
    for (const match of allMatches) {
      let action: SanitizationAction;

      if (match.isPII) {
        action = options.piiAction || piiConfig[match.type as PIIType];
      } else {
        action = options.secretAction || secretConfig[match.type as SecretType];
      }

      if (!actionsApplied.includes(action)) {
        actionsApplied.push(action);
      }

      switch (action) {
        case "REDACT":
          sanitizedContent = 
            sanitizedContent.slice(0, match.startIndex) +
            "[REDACTED]" +
            sanitizedContent.slice(match.endIndex);
          redactedCount++;
          metrics.totalRedacted++;
          break;
        case "MASK":
          const masked = maskValue(match.value, match.type);
          sanitizedContent = 
            sanitizedContent.slice(0, match.startIndex) +
            masked +
            sanitizedContent.slice(match.endIndex);
          maskedCount++;
          metrics.totalMasked++;
          break;
        case "LOG":
          console.log(`[OutputSanitizer] Detected ${match.type}: ${maskValue(match.value, match.type)}`);
          break;
        case "BLOCK":
          // Already handled above
          break;
      }
    }

    // Apply custom rules
    for (const rule of this.customRules) {
      const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(sanitizedContent)) !== null) {
        if (rule.action === "BLOCK") {
          metrics.blockedResponses++;
          return {
            content: "",
            wasModified: true,
            sanitizationApplied: ["BLOCK"],
            redactedCount,
            maskedCount,
            blockedReason: `Response blocked by custom rule: ${rule.name}`,
            validation,
            processingTimeMs: Date.now() - startTime
          };
        }

        if (rule.action === "REDACT") {
          sanitizedContent = sanitizedContent.replace(match[0], "[REDACTED]");
          redactedCount++;
          metrics.totalRedacted++;
        } else if (rule.action === "MASK") {
          sanitizedContent = sanitizedContent.replace(match[0], "***");
          maskedCount++;
          metrics.totalMasked++;
        }

        if (!actionsApplied.includes(rule.action)) {
          actionsApplied.push(rule.action);
        }
      }
    }

    return {
      content: sanitizedContent,
      wasModified: sanitizedContent !== content,
      sanitizationApplied: actionsApplied,
      redactedCount,
      maskedCount,
      blockedReason,
      validation,
      processingTimeMs: Date.now() - startTime
    };
  }

  getMetrics(): SanitizerMetrics {
    return { ...metrics };
  }

  resetMetrics(): void {
    Object.keys(metrics.piiDetected).forEach(key => {
      metrics.piiDetected[key as PIIType] = 0;
    });
    Object.keys(metrics.secretsDetected).forEach(key => {
      metrics.secretsDetected[key as SecretType] = 0;
    });
    metrics.blockedResponses = 0;
    metrics.totalProcessed = 0;
    metrics.totalRedacted = 0;
    metrics.totalMasked = 0;
  }
}

// ===== Singleton Instance =====

const defaultSanitizer = new OutputSanitizer();

// ===== Exported Functions =====

export function sanitizeOutput(
  content: string,
  options: SanitizerOptions = { contextLevel: "user" }
): SanitizedOutput {
  return defaultSanitizer.sanitize(content, options);
}

export function validateOutput(content: string): ValidationResult {
  return defaultSanitizer.validate(content);
}

export function detectPII(content: string): PIIMatch[] {
  return defaultSanitizer.detectPII(content);
}

export function detectSecrets(content: string): SecretMatch[] {
  return defaultSanitizer.detectSecrets(content);
}

export function getSanitizerMetrics(): SanitizerMetrics {
  return defaultSanitizer.getMetrics();
}

export function resetSanitizerMetrics(): void {
  defaultSanitizer.resetMetrics();
}

export { defaultSanitizer };
