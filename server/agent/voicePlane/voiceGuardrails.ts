import { EventEmitter } from "events";
import crypto from "crypto";

export interface ContentValidation {
  safe: boolean;
  issues: string[];
  severity: "none" | "warning" | "critical";
}

export interface ConsentVerification {
  verified: boolean;
  method: "explicit" | "implied" | "none";
  timestamp: number | null;
  expiresAt: number | null;
}

export interface GuardrailEvent {
  id: string;
  type: "impersonation_blocked" | "consent_missing" | "content_unsafe" | "pii_detected" | "pii_redacted";
  sessionId: string;
  timestamp: number;
  details: Record<string, unknown>;
}

export interface GuardrailStats {
  totalChecks: number;
  blockedAttempts: number;
  piiDetections: number;
  consentViolations: number;
  impersonationAttempts: number;
  contentViolations: number;
}

const IMPERSONATION_PATTERNS = [
  /i am (?:a |an )?(?:real |actual )?(?:human|person|doctor|lawyer|therapist|counselor|medical professional)/i,
  /i['']m (?:a |an )?(?:real |actual )?(?:human|person|doctor|lawyer|therapist|counselor|medical professional)/i,
  /i am not (?:a |an )?(?:robot|ai|artificial|machine|computer|bot)/i,
  /i['']m not (?:a |an )?(?:robot|ai|artificial|machine|computer|bot)/i,
  /trust me,? i['']?m? (?:a |an )?(?:real|actual) (?:person|human)/i,
];

const UNSAFE_CONTENT_PATTERNS = [
  /(?:kill|harm|hurt|injure|attack|threaten)\s+(?:yourself|himself|herself|themselves|someone|people)/i,
  /(?:how to|instructions for|steps to)\s+(?:make|build|create)\s+(?:a |an )?(?:bomb|weapon|explosive)/i,
  /(?:social security|ssn|credit card)\s*(?:number|#)/i,
  /(?:provide|give|share)\s+(?:your|their)\s+(?:password|credentials|bank|account)/i,
];

const PII_PATTERNS: Array<{ pattern: RegExp; replacement: string; type: string }> = [
  { pattern: /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g, replacement: "[SSN_REDACTED]", type: "ssn" },
  { pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, replacement: "[CARD_REDACTED]", type: "credit_card" },
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: "[EMAIL_REDACTED]", type: "email" },
  { pattern: /\b(?:\+?1[-.]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: "[PHONE_REDACTED]", type: "phone" },
];

export class VoiceGuardrails extends EventEmitter {
  private totalChecks = 0;
  private blockedAttempts = 0;
  private piiDetections = 0;
  private consentViolations = 0;
  private impersonationAttempts = 0;
  private contentViolations = 0;
  private events: GuardrailEvent[] = [];
  private readonly maxEvents = 1000;

  checkAntiImpersonation(text: string, sessionId: string = ""): ContentValidation {
    this.totalChecks++;
    const issues: string[] = [];

    for (const pattern of IMPERSONATION_PATTERNS) {
      if (pattern.test(text)) {
        issues.push(`Impersonation detected: text matches anti-impersonation pattern`);
        this.impersonationAttempts++;
        this.blockedAttempts++;

        this.recordEvent({
          type: "impersonation_blocked",
          sessionId,
          details: { matchedText: text.substring(0, 100) },
        });
      }
    }

    return {
      safe: issues.length === 0,
      issues,
      severity: issues.length > 0 ? "critical" : "none",
    };
  }

  verifyConsent(sessionId: string, consentGiven: boolean, consentTimestamp: number | null): ConsentVerification {
    this.totalChecks++;

    if (!consentGiven || !consentTimestamp) {
      this.consentViolations++;

      this.recordEvent({
        type: "consent_missing",
        sessionId,
        details: { consentGiven, consentTimestamp },
      });

      return {
        verified: false,
        method: "none",
        timestamp: null,
        expiresAt: null,
      };
    }

    const consentTTL = 24 * 60 * 60 * 1000;
    const expiresAt = consentTimestamp + consentTTL;

    if (Date.now() > expiresAt) {
      this.consentViolations++;

      this.recordEvent({
        type: "consent_missing",
        sessionId,
        details: { reason: "consent_expired", consentTimestamp, expiresAt },
      });

      return {
        verified: false,
        method: "explicit",
        timestamp: consentTimestamp,
        expiresAt,
      };
    }

    return {
      verified: true,
      method: "explicit",
      timestamp: consentTimestamp,
      expiresAt,
    };
  }

  validateScriptContent(content: string, sessionId: string = ""): ContentValidation {
    this.totalChecks++;
    const issues: string[] = [];

    const impersonationCheck = this.checkAntiImpersonation(content, sessionId);
    issues.push(...impersonationCheck.issues);

    for (const pattern of UNSAFE_CONTENT_PATTERNS) {
      if (pattern.test(content)) {
        issues.push(`Unsafe content detected in script`);
        this.contentViolations++;
        this.blockedAttempts++;

        this.recordEvent({
          type: "content_unsafe",
          sessionId,
          details: { contentPreview: content.substring(0, 100) },
        });
        break;
      }
    }

    let severity: "none" | "warning" | "critical" = "none";
    if (issues.some(i => i.includes("Impersonation"))) severity = "critical";
    else if (issues.length > 0) severity = "warning";

    return {
      safe: issues.length === 0,
      issues,
      severity,
    };
  }

  detectPII(text: string, sessionId: string = ""): Array<{ type: string; found: boolean }> {
    this.totalChecks++;
    const detections: Array<{ type: string; found: boolean }> = [];

    for (const { pattern, type } of PII_PATTERNS) {
      const found = pattern.test(text);
      pattern.lastIndex = 0;
      detections.push({ type, found });

      if (found) {
        this.piiDetections++;

        this.recordEvent({
          type: "pii_detected",
          sessionId,
          details: { piiType: type },
        });
      }
    }

    return detections;
  }

  redactPII(text: string, sessionId: string = ""): string {
    let redacted = text;
    let hasRedactions = false;

    for (const { pattern, replacement } of PII_PATTERNS) {
      const newText = redacted.replace(pattern, replacement);
      if (newText !== redacted) {
        hasRedactions = true;
      }
      redacted = newText;
    }

    if (hasRedactions) {
      this.recordEvent({
        type: "pii_redacted",
        sessionId,
        details: { originalLength: text.length, redactedLength: redacted.length },
      });
    }

    return redacted;
  }

  fullValidation(text: string, sessionId: string, consentGiven: boolean, consentTimestamp: number | null): {
    impersonation: ContentValidation;
    consent: ConsentVerification;
    content: ContentValidation;
    pii: Array<{ type: string; found: boolean }>;
    overallSafe: boolean;
  } {
    const impersonation = this.checkAntiImpersonation(text, sessionId);
    const consent = this.verifyConsent(sessionId, consentGiven, consentTimestamp);
    const content = this.validateScriptContent(text, sessionId);
    const pii = this.detectPII(text, sessionId);

    const overallSafe = impersonation.safe && consent.verified && content.safe;

    return {
      impersonation,
      consent,
      content,
      pii,
      overallSafe,
    };
  }

  private recordEvent(params: Omit<GuardrailEvent, "id" | "timestamp">): void {
    const event: GuardrailEvent = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      ...params,
    };

    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    this.emit("guardrailEvent", event);
  }

  getEvents(limit: number = 50): GuardrailEvent[] {
    return this.events.slice(-limit);
  }

  getStats(): GuardrailStats {
    return {
      totalChecks: this.totalChecks,
      blockedAttempts: this.blockedAttempts,
      piiDetections: this.piiDetections,
      consentViolations: this.consentViolations,
      impersonationAttempts: this.impersonationAttempts,
      contentViolations: this.contentViolations,
    };
  }
}

export const voiceGuardrails = new VoiceGuardrails();
