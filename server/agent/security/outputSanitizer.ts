import { EventEmitter } from "events";
import { randomUUID } from "crypto";

export type SanitizationCategory = "system_prompt_leak" | "pii_detected" | "secret_detected" | "unsafe_code" | "internal_marker";

export interface SanitizationEvent {
  id: string;
  category: SanitizationCategory;
  description: string;
  originalFragment: string;
  replacedWith: string;
  confidence: number;
  timestamp: number;
}

export interface OutputSanitizationResult {
  sanitizedOutput: string;
  events: SanitizationEvent[];
  totalRedactions: number;
  confidenceScore: number;
  safe: boolean;
}

interface SanitizationRule {
  name: string;
  category: SanitizationCategory;
  pattern: RegExp;
  replacement: string;
  confidence: number;
  description: string;
}

const SYSTEM_PROMPT_LEAK_RULES: SanitizationRule[] = [
  { name: "system_prompt_header", category: "system_prompt_leak", pattern: /system\s+prompt\s*:/gi, replacement: "[REDACTED]", confidence: 0.9, description: "System prompt header detected" },
  { name: "internal_instructions", category: "system_prompt_leak", pattern: /internal\s+instructions?\s*:/gi, replacement: "[REDACTED]", confidence: 0.9, description: "Internal instructions header detected" },
  { name: "boundary_markers", category: "system_prompt_leak", pattern: /<<<[A-Z_]+>>>/g, replacement: "", confidence: 0.95, description: "Internal boundary markers detected" },
  { name: "internal_marker", category: "internal_marker", pattern: /\[INTERNAL\][^\n]*/gi, replacement: "", confidence: 0.95, description: "Internal marker detected" },
  { name: "system_note", category: "internal_marker", pattern: /\[SYSTEM_NOTE\][^\n]*/gi, replacement: "", confidence: 0.95, description: "System note marker detected" },
  { name: "hidden_prompt_block", category: "system_prompt_leak", pattern: /(?:my|the)\s+(?:system|hidden|original|initial)\s+prompt\s+(?:is|was|says?)\s*:?\s*"[^"]{20,}"/gi, replacement: '[Content redacted: system prompt leak prevented]', confidence: 0.85, description: "Quoted system prompt leak" },
  { name: "im_start_markers", category: "system_prompt_leak", pattern: /<\|im_start\|>[\s\S]*?<\|im_end\|>/g, replacement: "", confidence: 0.95, description: "Chat format markers detected" },
  { name: "inst_markers", category: "system_prompt_leak", pattern: /\[INST\][\s\S]*?\[\/INST\]/g, replacement: "", confidence: 0.95, description: "Instruction format markers detected" },
];

const PII_RULES: SanitizationRule[] = [
  { name: "email_address", category: "pii_detected", pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, replacement: "[EMAIL_REDACTED]", confidence: 0.7, description: "Email address detected" },
  { name: "phone_number", category: "pii_detected", pattern: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: "[PHONE_REDACTED]", confidence: 0.6, description: "Phone number detected" },
  { name: "ssn", category: "pii_detected", pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[SSN_REDACTED]", confidence: 0.85, description: "SSN pattern detected" },
  { name: "credit_card", category: "pii_detected", pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g, replacement: "[CARD_REDACTED]", confidence: 0.9, description: "Credit card number detected" },
  { name: "ip_address", category: "pii_detected", pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g, replacement: "[IP_REDACTED]", confidence: 0.5, description: "IP address detected" },
];

const SECRET_RULES: SanitizationRule[] = [
  { name: "openai_key", category: "secret_detected", pattern: /sk-[a-zA-Z0-9]{20,}/g, replacement: "[SECRET_REDACTED]", confidence: 0.95, description: "OpenAI API key detected" },
  { name: "generic_api_key", category: "secret_detected", pattern: /api[_-]?key\s*[:=]\s*["']?[a-zA-Z0-9_-]{20,}["']?/gi, replacement: "api_key=[SECRET_REDACTED]", confidence: 0.85, description: "API key pattern detected" },
  { name: "bearer_token", category: "secret_detected", pattern: /bearer\s+[a-zA-Z0-9._-]{20,}/gi, replacement: "bearer [SECRET_REDACTED]", confidence: 0.9, description: "Bearer token detected" },
  { name: "aws_key", category: "secret_detected", pattern: /(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}/g, replacement: "[AWS_KEY_REDACTED]", confidence: 0.95, description: "AWS access key detected" },
  { name: "github_token", category: "secret_detected", pattern: /gh[ps]_[a-zA-Z0-9]{36,}/g, replacement: "[GITHUB_TOKEN_REDACTED]", confidence: 0.95, description: "GitHub token detected" },
  { name: "private_key_block", category: "secret_detected", pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g, replacement: "[PRIVATE_KEY_REDACTED]", confidence: 0.99, description: "Private key block detected" },
  { name: "password_pattern", category: "secret_detected", pattern: /password\s*[:=]\s*["']?[^\s"']{8,}["']?/gi, replacement: "password=[SECRET_REDACTED]", confidence: 0.75, description: "Password pattern detected" },
  { name: "connection_string", category: "secret_detected", pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^\s"']+/gi, replacement: "[CONNECTION_STRING_REDACTED]", confidence: 0.9, description: "Database connection string detected" },
];

const UNSAFE_CODE_RULES: SanitizationRule[] = [
  { name: "eval_code", category: "unsafe_code", pattern: /\beval\s*\(\s*["'`][\s\S]{10,}["'`]\s*\)/g, replacement: "[UNSAFE_CODE_REMOVED]", confidence: 0.7, description: "eval() with string argument detected" },
  { name: "script_tag", category: "unsafe_code", pattern: /<script\b[^>]*>[\s\S]*?<\/script>/gi, replacement: "[SCRIPT_REMOVED]", confidence: 0.8, description: "Script tag detected in output" },
  { name: "shell_injection", category: "unsafe_code", pattern: /`[^`]*(?:rm\s+-rf|mkfs|dd\s+if=|>\s*\/dev\/)[^`]*`/g, replacement: "[UNSAFE_COMMAND_REMOVED]", confidence: 0.85, description: "Dangerous shell command in backticks" },
];

const ALL_RULES: SanitizationRule[] = [
  ...SYSTEM_PROMPT_LEAK_RULES,
  ...PII_RULES,
  ...SECRET_RULES,
  ...UNSAFE_CODE_RULES,
];

export class OutputSanitizer extends EventEmitter {
  private sanitizationHistory: SanitizationEvent[] = [];
  private readonly maxHistory = 1000;
  private piiDetectionEnabled = true;
  private secretDetectionEnabled = true;
  private unsafeCodeDetectionEnabled = true;

  setPIIDetection(enabled: boolean): void {
    this.piiDetectionEnabled = enabled;
  }

  setSecretDetection(enabled: boolean): void {
    this.secretDetectionEnabled = enabled;
  }

  setUnsafeCodeDetection(enabled: boolean): void {
    this.unsafeCodeDetectionEnabled = enabled;
  }

  sanitize(output: string): OutputSanitizationResult {
    if (!output || typeof output !== "string") {
      return { sanitizedOutput: output || "", events: [], totalRedactions: 0, confidenceScore: 1, safe: true };
    }

    const events: SanitizationEvent[] = [];
    let sanitizedOutput = output;

    const activeRules = ALL_RULES.filter(rule => {
      if (!this.piiDetectionEnabled && rule.category === "pii_detected") return false;
      if (!this.secretDetectionEnabled && rule.category === "secret_detected") return false;
      if (!this.unsafeCodeDetectionEnabled && rule.category === "unsafe_code") return false;
      return true;
    });

    for (const rule of activeRules) {
      const matches = sanitizedOutput.match(rule.pattern);
      if (matches) {
        for (const match of matches) {
          const event: SanitizationEvent = {
            id: randomUUID(),
            category: rule.category,
            description: rule.description,
            originalFragment: match.substring(0, 100),
            replacedWith: rule.replacement,
            confidence: rule.confidence,
            timestamp: Date.now(),
          };
          events.push(event);
          this.addToHistory(event);
        }
        sanitizedOutput = sanitizedOutput.replace(rule.pattern, rule.replacement);
      }
    }

    const safe = events.length === 0;
    const confidenceScore = safe ? 1 : 1 - Math.min(events.reduce((sum, e) => sum + e.confidence, 0) / events.length, 0.95);

    const result: OutputSanitizationResult = {
      sanitizedOutput,
      events,
      totalRedactions: events.length,
      confidenceScore: Math.round(confidenceScore * 100) / 100,
      safe,
    };

    if (!safe) {
      this.emit("output_sanitized", result);
    }

    return result;
  }

  getHistory(limit = 100): SanitizationEvent[] {
    return this.sanitizationHistory.slice(-limit);
  }

  getStats(): {
    totalSanitizations: number;
    byCategory: Record<SanitizationCategory, number>;
    averageConfidence: number;
  } {
    const byCategory: Record<SanitizationCategory, number> = {
      system_prompt_leak: 0,
      pii_detected: 0,
      secret_detected: 0,
      unsafe_code: 0,
      internal_marker: 0,
    };

    let totalConfidence = 0;
    for (const event of this.sanitizationHistory) {
      byCategory[event.category]++;
      totalConfidence += event.confidence;
    }

    return {
      totalSanitizations: this.sanitizationHistory.length,
      byCategory,
      averageConfidence: this.sanitizationHistory.length > 0 ? Math.round((totalConfidence / this.sanitizationHistory.length) * 100) / 100 : 0,
    };
  }

  clearHistory(): void {
    this.sanitizationHistory = [];
  }

  private addToHistory(event: SanitizationEvent): void {
    this.sanitizationHistory.push(event);
    if (this.sanitizationHistory.length > this.maxHistory) {
      this.sanitizationHistory = this.sanitizationHistory.slice(-this.maxHistory);
    }
  }
}

export const outputSanitizer = new OutputSanitizer();
