import { Logger } from "../lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PIIType =
  | "email"
  | "phone"
  | "ssn"
  | "credit_card"
  | "name"
  | "address"
  | "ip_address"
  | "passport"
  | "driver_license"
  | "bank_account"
  | "date_of_birth";

export interface PIIMatch {
  type: PIIType;
  value: string;
  start: number;
  end: number;
  confidence: number;
}

export interface DetectionStats {
  totalScanned: number;
  totalMatches: number;
  byType: Record<PIIType, number>;
  sensitivityLevel: "low" | "medium" | "high";
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CONFIDENCE = {
  HIGH: 0.95,
  MEDIUM: 0.75,
  LOW: 0.5,
} as const;

// ─── PIIDetector ─────────────────────────────────────────────────────────────

class PIIDetector {
  private patterns: Map<PIIType, RegExp[]>;
  private sensitivityLevel: "low" | "medium" | "high" = "medium";
  private stats: DetectionStats = {
    totalScanned: 0,
    totalMatches: 0,
    byType: {
      email: 0, phone: 0, ssn: 0, credit_card: 0, name: 0,
      address: 0, ip_address: 0, passport: 0, driver_license: 0,
      bank_account: 0, date_of_birth: 0,
    },
    sensitivityLevel: "medium",
  };

  constructor() {
    this.patterns = this.buildPatterns();
  }

  detect(text: string): PIIMatch[] {
    this.stats.totalScanned++;
    const matches: PIIMatch[] = [];
    const seen = new Set<string>();

    for (const [type, regexList] of this.patterns) {
      if (this.sensitivityLevel === "low" && (type === "name" || type === "address")) continue;

      for (const regex of regexList) {
        const g = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
        let m: RegExpExecArray | null;
        while ((m = g.exec(text)) !== null) {
          const posKey = `${m.index}:${m[0].length}`;
          if (seen.has(posKey)) continue;

          const candidate: PIIMatch = {
            type,
            value: m[0],
            start: m.index,
            end: m.index + m[0].length,
            confidence: this.computeConfidence(type, m[0]),
          };

          if (this.validateMatch(candidate, text)) {
            matches.push(candidate);
            seen.add(posKey);
            this.stats.totalMatches++;
            this.stats.byType[type]++;
          }
        }
      }
    }

    return matches.sort((a, b) => a.start - b.start);
  }

  detectMultiLanguage(text: string, _language?: string): PIIMatch[] {
    return this.detect(text);
  }

  containsPII(text: string): boolean {
    return this.detect(text).length > 0;
  }

  async detectBatch(texts: string[]): Promise<PIIMatch[][]> {
    return texts.map((t) => this.detect(t));
  }

  setSensitivityLevel(level: "low" | "medium" | "high"): void {
    this.sensitivityLevel = level;
    this.stats.sensitivityLevel = level;
  }

  getStats(): DetectionStats {
    return { ...this.stats };
  }

  private buildPatterns(): Map<PIIType, RegExp[]> {
    const p = new Map<PIIType, RegExp[]>();

    p.set("email", [/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/i]);

    p.set("phone", [
      /\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
      /\b\+\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}\b/,
    ]);

    p.set("ssn", [
      /\b\d{3}-\d{2}-\d{4}\b/,
      /\b\d{3}\s\d{2}\s\d{4}\b/,
    ]);

    p.set("credit_card", [
      /\b4\d{3}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/,
      /\b5[1-5]\d{2}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/,
      /\b3[47]\d{2}[-\s]?\d{6}[-\s]?\d{5}\b/,
      /\b6(?:011|5\d{2})[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/,
    ]);

    p.set("ip_address", [
      /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/,
      /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/,
    ]);

    p.set("passport", [
      /\b[A-Z]{1,2}\d{6,9}\b/,
    ]);

    p.set("driver_license", [
      /\b[A-Z]\d{7}\b/,
      /\b[A-Z]{2}\d{6}\b/,
    ]);

    p.set("bank_account", [
      /\bACCOUNT\s*#?\s*\d{8,17}\b/i,
      /\bROUTING\s*#?\s*\d{9}\b/i,
    ]);

    p.set("date_of_birth", [
      /\b(?:DOB|D\.O\.B|Date\s+of\s+Birth|Born)[:\s]+\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b/i,
      /\b(?:0[1-9]|1[0-2])\/(?:0[1-9]|[12]\d|3[01])\/(?:19|20)\d{2}\b/,
    ]);

    p.set("name", [
      /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/,
    ]);

    p.set("address", [
      /\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Place|Pl|Way)\b/i,
      /\b(?:PO Box|P\.O\. Box)\s+\d{1,6}\b/i,
    ]);

    return p;
  }

  private validateMatch(match: PIIMatch, _text: string): boolean {
    const minConf = this.sensitivityLevel === "high" ? 0.4 : this.sensitivityLevel === "medium" ? 0.6 : 0.8;
    if (match.confidence < minConf) return false;

    if (match.type === "credit_card") {
      return this.luhnCheck(match.value.replace(/[-\s]/g, ""));
    }
    if (match.type === "ssn") {
      const digits = match.value.replace(/\D/g, "");
      if (/^(\d)\1{8}$/.test(digits)) return false;
      if (digits === "123456789") return false;
    }
    if (match.type === "ip_address" && this.sensitivityLevel === "low") {
      if (/^(?:127\.|10\.|192\.168\.)/.test(match.value)) return false;
    }
    if (match.type === "name") {
      return match.value.split(/\s+/).length >= 2;
    }
    return true;
  }

  private computeConfidence(type: PIIType, value: string): number {
    switch (type) {
      case "email": return CONFIDENCE.HIGH;
      case "ssn": return /\d{3}-\d{2}-\d{4}/.test(value) ? CONFIDENCE.HIGH : CONFIDENCE.LOW;
      case "credit_card": return this.luhnCheck(value.replace(/[-\s]/g, "")) ? CONFIDENCE.HIGH : CONFIDENCE.LOW;
      case "phone": return CONFIDENCE.MEDIUM;
      case "ip_address": return CONFIDENCE.HIGH;
      case "passport": return CONFIDENCE.MEDIUM;
      case "driver_license": return CONFIDENCE.MEDIUM;
      case "bank_account": return /ACCOUNT|ROUTING/i.test(value) ? CONFIDENCE.HIGH : CONFIDENCE.LOW;
      case "date_of_birth": return /DOB|D\.O\.B|Date\s+of\s+Birth|Born/i.test(value) ? CONFIDENCE.HIGH : CONFIDENCE.MEDIUM;
      case "name": return CONFIDENCE.LOW;
      case "address": return CONFIDENCE.MEDIUM;
      default: return CONFIDENCE.MEDIUM;
    }
  }

  private luhnCheck(number: string): boolean {
    if (!/^\d+$/.test(number)) return false;
    if (number.length < 13 || number.length > 19) return false;

    let sum = 0;
    let alternate = false;

    for (let i = number.length - 1; i >= 0; i--) {
      let n = parseInt(number[i], 10);
      if (alternate) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      alternate = !alternate;
    }

    return sum % 10 === 0;
  }
}

export const piiDetector = new PIIDetector();
