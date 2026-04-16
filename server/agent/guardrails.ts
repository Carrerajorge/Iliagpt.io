import crypto from "crypto";
import { storage } from "../storage";
import { checkDomainPolicy, checkRateLimit, sanitizeUrl, isValidObjective, extractDomain } from "./security";
import { classifyActionRisk, RiskLevel, RiskClassification } from "./riskClassifier";

export interface PIIMatch {
  type: "email" | "phone" | "ssn" | "credit_card" | "ip_address" | "date_of_birth";
  value: string;
  redacted: string;
  start: number;
  end: number;
}

export interface AuditLogEntry {
  id: string;
  sessionId: string;
  timestamp: Date;
  action: string;
  target: string;
  status: "allowed" | "blocked" | "flagged";
  reason?: string;
  metadata?: Record<string, any>;
}

export interface DownloadPolicy {
  allowed: boolean;
  maxSizeBytes: number;
  allowedMimeTypes: string[];
  blockExecutables: boolean;
}

export interface GuardrailsConfig {
  enablePIIRedaction: boolean;
  enableAuditLog: boolean;
  enableDownloadControls: boolean;
  maxDownloadSizeMB: number;
  allowedDownloadTypes: string[];
}

const DEFAULT_CONFIG: GuardrailsConfig = {
  enablePIIRedaction: true,
  enableAuditLog: true,
  enableDownloadControls: true,
  maxDownloadSizeMB: 100,
  allowedDownloadTypes: [
    "application/pdf",
    "text/plain",
    "text/csv",
    "text/html",
    "application/json",
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/zip"
  ]
};

const PII_PATTERNS: { type: PIIMatch["type"]; pattern: RegExp; redactFn: (match: string) => string }[] = [
  {
    type: "email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    redactFn: (m) => m.replace(/^(.{2}).*(@.*)$/, "$1***$2")
  },
  {
    type: "phone",
    pattern: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g,
    redactFn: () => "***-***-****"
  },
  {
    type: "ssn",
    pattern: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g,
    redactFn: () => "***-**-****"
  },
  {
    type: "credit_card",
    pattern: /\b(?:\d{4}[-.\s]?){3}\d{4}\b/g,
    redactFn: (m) => "****-****-****-" + m.slice(-4)
  },
  {
    type: "ip_address",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    redactFn: () => "***.***.***.***"
  },
  {
    type: "date_of_birth",
    pattern: /\b(?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01])[-/](?:19|20)\d{2}\b/g,
    redactFn: () => "**/**/**"
  }
];

const BLOCKED_EXECUTABLES = [
  ".exe", ".bat", ".cmd", ".sh", ".ps1", ".vbs",
  ".msi", ".dll", ".jar", ".app", ".dmg", ".pkg",
  ".deb", ".rpm", ".scr", ".com", ".pif"
];

const auditLog: AuditLogEntry[] = [];

class Guardrails {
  private config: GuardrailsConfig;

  constructor(config: Partial<GuardrailsConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  detectPII(text: string): PIIMatch[] {
    const matches: PIIMatch[] = [];

    for (const { type, pattern, redactFn } of PII_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(text)) !== null) {
        matches.push({
          type,
          value: match[0],
          redacted: redactFn(match[0]),
          start: match.index,
          end: match.index + match[0].length
        });
      }
    }

    return matches.sort((a, b) => a.start - b.start);
  }

  redactPII(text: string): { text: string; matches: PIIMatch[] } {
    if (!this.config.enablePIIRedaction) {
      return { text, matches: [] };
    }

    const matches = this.detectPII(text);
    if (matches.length === 0) {
      return { text, matches: [] };
    }

    let result = text;
    let offset = 0;

    for (const match of matches) {
      const start = match.start + offset;
      const end = match.end + offset;
      result = result.slice(0, start) + match.redacted + result.slice(end);
      offset += match.redacted.length - match.value.length;
    }

    return { text: result, matches };
  }

  async checkDownload(
    url: string,
    mimeType?: string,
    size?: number,
    filename?: string
  ): Promise<DownloadPolicy> {
    if (!this.config.enableDownloadControls) {
      return {
        allowed: true,
        maxSizeBytes: this.config.maxDownloadSizeMB * 1024 * 1024,
        allowedMimeTypes: this.config.allowedDownloadTypes,
        blockExecutables: true
      };
    }

    if (filename) {
      const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
      if (BLOCKED_EXECUTABLES.includes(ext)) {
        await this.logAction("", "download", url, "blocked", "Executable files are blocked");
        return {
          allowed: false,
          maxSizeBytes: 0,
          allowedMimeTypes: [],
          blockExecutables: true
        };
      }
    }

    const maxBytes = this.config.maxDownloadSizeMB * 1024 * 1024;
    if (size && size > maxBytes) {
      await this.logAction("", "download", url, "blocked", `File too large: ${size} bytes`);
      return {
        allowed: false,
        maxSizeBytes: maxBytes,
        allowedMimeTypes: this.config.allowedDownloadTypes,
        blockExecutables: true
      };
    }

    if (mimeType && !this.config.allowedDownloadTypes.includes(mimeType)) {
      if (!mimeType.startsWith("text/") && !mimeType.startsWith("image/")) {
        await this.logAction("", "download", url, "flagged", `Uncommon MIME type: ${mimeType}`);
      }
    }

    return {
      allowed: true,
      maxSizeBytes: maxBytes,
      allowedMimeTypes: this.config.allowedDownloadTypes,
      blockExecutables: true
    };
  }

  async logAction(
    sessionId: string,
    action: string,
    target: string,
    status: AuditLogEntry["status"],
    reason?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    if (!this.config.enableAuditLog) return;

    const entry: AuditLogEntry = {
      id: crypto.randomUUID(),
      sessionId,
      timestamp: new Date(),
      action,
      target,
      status,
      reason,
      metadata
    };

    auditLog.push(entry);

    if (auditLog.length > 10000) {
      auditLog.splice(0, 1000);
    }

    if (status === "blocked" || status === "flagged") {
      console.log(`[AUDIT] ${status.toUpperCase()}: ${action} on ${target} - ${reason || "No reason"}`);
    }
  }

  getAuditLog(sessionId: string, limit = 100): AuditLogEntry[] {
    return [...auditLog].filter((entry) => entry.sessionId === sessionId).slice(-limit);
  }

  evaluateRisk(
    sessionId: string,
    actionType: string,
    target: string,
    params?: Record<string, any>,
    userThreshold: RiskLevel = "high"
  ): RiskClassification {
    const risk = classifyActionRisk(actionType, target, params, userThreshold);
    if (risk.requiresConfirmation) {
      void this.logAction(sessionId, "risk_assessment", target, "flagged", risk.reason, { riskLevel: risk.level });
    }
    return risk;
  }

  async validateAction(
    sessionId: string,
    actionType: string,
    target: string,
    params?: Record<string, any>
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (actionType === "navigate") {
      try {
        const sanitized = sanitizeUrl(target);
        const policy = await checkDomainPolicy(sanitized);

        if (!policy.allowed) {
          await this.logAction(sessionId, actionType, target, "blocked", policy.reason);
          return { allowed: false, reason: policy.reason };
        }

        const domain = extractDomain(sanitized);
        if (domain && !checkRateLimit(domain, policy.rateLimit)) {
          await this.logAction(sessionId, actionType, target, "blocked", "Rate limit exceeded");
          return { allowed: false, reason: "Rate limit exceeded for this domain" };
        }
      } catch (error: any) {
        await this.logAction(sessionId, actionType, target, "blocked", error?.message || "Invalid URL");
        return { allowed: false, reason: error?.message || "Invalid URL" };
      }
    }

    if (actionType === "type" && typeof params?.text === "string") {
      const matches = this.detectPII(params.text);
      if (matches.length > 0) {
        await this.logAction(sessionId, actionType, target, "flagged", "Input contains PII", {
          piiTypes: matches.map((m) => m.type),
        });
      }
    }

    if (actionType === "download") {
      const policy = await this.checkDownload(target, params?.mimeType, params?.size, params?.filename);
      if (!policy.allowed) {
        return { allowed: false, reason: "Download blocked by policy" };
      }
    }

    await this.logAction(sessionId, actionType, target, "allowed");
    return { allowed: true };
  }

  async sanitizeOutput(text: string, sessionId?: string): Promise<string> {
    const { text: redacted, matches } = this.redactPII(text);

    if (matches.length > 0 && sessionId) {
      await this.logAction(
        sessionId,
        "output_sanitize",
        "response",
        "flagged",
        `Redacted ${matches.length} PII instances`,
        {
          piiTypes: Array.from(new Set(matches.map((m) => m.type))),
        }
      );
    }

    return redacted;
  }
}

export const guardrails = new Guardrails();
export { checkDomainPolicy, checkRateLimit, sanitizeUrl, isValidObjective, extractDomain };
