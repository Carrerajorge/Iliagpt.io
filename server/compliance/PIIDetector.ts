/**
 * PIIDetector.ts
 * Production-grade PII detection engine with regex + checksum validation,
 * confidence scoring, risk assessment, and redaction capabilities.
 */

import { Logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Enums & Types
// ---------------------------------------------------------------------------

export enum PIIType {
  EMAIL           = 'EMAIL',
  PHONE           = 'PHONE',
  SSN             = 'SSN',
  CREDIT_CARD     = 'CREDIT_CARD',
  NAME            = 'NAME',
  ADDRESS         = 'ADDRESS',
  DATE_OF_BIRTH   = 'DATE_OF_BIRTH',
  IP_ADDRESS      = 'IP_ADDRESS',
  PASSPORT        = 'PASSPORT',
  DRIVERS_LICENSE = 'DRIVERS_LICENSE',
  BANK_ACCOUNT    = 'BANK_ACCOUNT',
  MEDICAL_ID      = 'MEDICAL_ID',
}

export interface PIIFinding {
  type: PIIType;
  value: string;
  position: [number, number]; // [start, end] char offsets
  confidence: number;         // 0.0 – 1.0
}

export interface PIIDetectionResult {
  hasPII: boolean;
  findings: PIIFinding[];
  redacted: string;
  riskScore: number; // 0 – 100
}

export interface ObjectPIIResult {
  hasPII: boolean;
  fieldResults: Record<string, PIIDetectionResult>;
  totalFindings: number;
  aggregateRiskScore: number;
}

export type RedactMode = 'token' | 'mask' | 'remove';

export interface RedactOptions {
  replacement?: RedactMode;
  preserveLength?: boolean;
  types?: PIIType[];
}

export interface PIIDetectorStats {
  callsProcessed: number;
  callsWithPII: number;
  piiFoundRate: number;
  topTypes: Array<{ type: PIIType; count: number }>;
  totalFindingsAllTime: number;
}

// ---------------------------------------------------------------------------
// Severity weights per PII type (for risk scoring)
// ---------------------------------------------------------------------------

const SEVERITY_WEIGHT: Record<PIIType, number> = {
  [PIIType.SSN]:              10,
  [PIIType.CREDIT_CARD]:      10,
  [PIIType.BANK_ACCOUNT]:     10,
  [PIIType.PASSPORT]:          9,
  [PIIType.DRIVERS_LICENSE]:   8,
  [PIIType.MEDICAL_ID]:        8,
  [PIIType.DATE_OF_BIRTH]:     6,
  [PIIType.EMAIL]:             5,
  [PIIType.PHONE]:             5,
  [PIIType.ADDRESS]:           4,
  [PIIType.NAME]:              3,
  [PIIType.IP_ADDRESS]:        3,
};

// ---------------------------------------------------------------------------
// Redaction token labels
// ---------------------------------------------------------------------------

const TOKEN_LABEL: Record<PIIType, string> = {
  [PIIType.EMAIL]:           '[EMAIL]',
  [PIIType.PHONE]:           '[PHONE]',
  [PIIType.SSN]:             '[SSN]',
  [PIIType.CREDIT_CARD]:     '[CREDIT_CARD]',
  [PIIType.NAME]:            '[NAME]',
  [PIIType.ADDRESS]:         '[ADDRESS]',
  [PIIType.DATE_OF_BIRTH]:   '[DOB]',
  [PIIType.IP_ADDRESS]:      '[IP]',
  [PIIType.PASSPORT]:        '[PASSPORT]',
  [PIIType.DRIVERS_LICENSE]: '[DL]',
  [PIIType.BANK_ACCOUNT]:    '[BANK_ACCOUNT]',
  [PIIType.MEDICAL_ID]:      '[MRN]',
};

// ---------------------------------------------------------------------------
// Luhn algorithm for credit card validation
// ---------------------------------------------------------------------------

function luhnCheck(num: string): boolean {
  const digits = num.replace(/\D/g, '');
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

// SSN structural validation
function validateSSN(value: string): number {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 9) return -0.5;
  const area = parseInt(digits.substring(0, 3), 10);
  if (area === 0 || area === 666 || area >= 900) return -0.3;
  if (digits.substring(3, 5) === '00') return -0.3;
  if (digits.substring(5) === '0000') return -0.3;
  return 0.2;
}

// ---------------------------------------------------------------------------
// Detector definitions
// ---------------------------------------------------------------------------

interface DetectorDefinition {
  type: PIIType;
  pattern: RegExp;
  baseConfidence: number;
  validate?: (match: string) => number;
}

const DETECTORS: DetectorDefinition[] = [
  // EMAIL
  {
    type: PIIType.EMAIL,
    pattern: /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g,
    baseConfidence: 0.95,
  },

  // PHONE – US/international formats
  {
    type: PIIType.PHONE,
    pattern: /(?:\+?1[\s.\-]?)?(?:\(\d{3}\)|\d{3})[\s.\-]?\d{3}[\s.\-]?\d{4}\b|\+?(?:[\d]{1,3}[\s.\-]){2,4}[\d]{4,}\b/g,
    baseConfidence: 0.75,
    validate(match) {
      const digits = match.replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 15) return -0.3;
      if (/^(\d)\1+$/.test(digits)) return -0.4;
      return 0.0;
    },
  },

  // SSN
  {
    type: PIIType.SSN,
    pattern: /\b(?!000|666|9\d{2})\d{3}[- ]?(?!00)\d{2}[- ]?(?!0000)\d{4}\b/g,
    baseConfidence: 0.85,
    validate: validateSSN,
  },

  // CREDIT CARD – Visa, MC, Amex, Discover, Diners, JCB with Luhn
  {
    type: PIIType.CREDIT_CARD,
    pattern: /\b(?:4\d{3}|5[1-5]\d{2}|2[2-7]\d{2}|6011|65\d{2}|3[47]\d{2}|3(?:0[0-5]|[68]\d)\d|35\d{3})[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{2,7}\b/g,
    baseConfidence: 0.80,
    validate(match) {
      const digits = match.replace(/\D/g, '');
      if (digits.length < 13 || digits.length > 19) return -0.5;
      return luhnCheck(digits) ? 0.18 : -0.4;
    },
  },

  // NAME – honorific-prefixed or plain Title Case pairs/triples
  {
    type: PIIType.NAME,
    pattern: /\b(?:Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Prof\.?|Sir|Madam)\s+[A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20}){0,3}\b|\b[A-Z][a-z]{2,15}\s+(?:[A-Z]\.\s+)?[A-Z][a-z]{2,20}\b/g,
    baseConfidence: 0.55,
    validate(match) {
      const calendarWords = new Set([
        'January','February','March','April','May','June',
        'July','August','September','October','November','December',
        'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday',
      ]);
      if (calendarWords.has(match.trim())) return -0.5;
      return 0.0;
    },
  },

  // ADDRESS – street number + street type
  {
    type: PIIType.ADDRESS,
    pattern: /\b\d{1,5}\s+[A-Z][a-zA-Z0-9\s,.#]{5,60}(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Circle|Cir|Way|Place|Pl|Highway|Hwy|Parkway|Pkwy)\.?(?:\s+(?:Apt|Suite|Ste|Unit|#)\s*[\w\d]+)?\b/gi,
    baseConfidence: 0.70,
  },

  // DATE OF BIRTH
  {
    type: PIIType.DATE_OF_BIRTH,
    pattern: /(?:born|dob|date\s+of\s+birth|birth\s*date)[\s:]*\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b|\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4}\b/gi,
    baseConfidence: 0.65,
    validate(match) {
      const yearMatch = match.match(/\d{4}/);
      if (!yearMatch) return -0.2;
      const year = parseInt(yearMatch[0], 10);
      if (year < 1900 || year > new Date().getFullYear()) return -0.3;
      return 0.1;
    },
  },

  // IP ADDRESS – IPv4 and basic IPv6
  {
    type: PIIType.IP_ADDRESS,
    pattern: /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b|(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|:(?::[0-9a-fA-F]{1,4}){1,7}/g,
    baseConfidence: 0.90,
    validate(match) {
      if (/^127\./.test(match) || match === '0.0.0.0') return -0.5;
      return 0.0;
    },
  },

  // PASSPORT
  {
    type: PIIType.PASSPORT,
    pattern: /\b(?:passport\s*(?:no\.?|number|#)?[\s:]*)?[A-Z]{1,2}\d{6,9}\b/gi,
    baseConfidence: 0.65,
    validate(match) {
      if (/passport/i.test(match)) return 0.2;
      return -0.15;
    },
  },

  // DRIVER'S LICENSE
  {
    type: PIIType.DRIVERS_LICENSE,
    pattern: /\b(?:dl|driver'?s?\s*licen[sc]e|license\s*(?:no\.?|number|#)?)[\s:#]*[A-Z0-9]{6,12}\b/gi,
    baseConfidence: 0.70,
  },

  // BANK ACCOUNT
  {
    type: PIIType.BANK_ACCOUNT,
    pattern: /\b(?:routing\s*(?:no\.?|number|#)?[\s:]*\d{9}|account\s*(?:no\.?|number|#)?[\s:]*)[\d\s\-]{8,17}\b/gi,
    baseConfidence: 0.75,
    validate(match) {
      const digits = match.replace(/\D/g, '');
      if (digits.length < 8 || digits.length > 26) return -0.3;
      return 0.1;
    },
  },

  // MEDICAL ID / MRN
  {
    type: PIIType.MEDICAL_ID,
    pattern: /\b(?:mrn|medical\s*record\s*(?:no\.?|number|#)?|patient\s*(?:id|no\.?|number)?)[\s:#]*[A-Z0-9\-]{6,16}\b/gi,
    baseConfidence: 0.72,
  },
];

// ---------------------------------------------------------------------------
// PIIDetector class
// ---------------------------------------------------------------------------

export class PIIDetector {
  private static instance: PIIDetector;

  private callsProcessed = 0;
  private callsWithPII   = 0;
  private typeCounts     = new Map<PIIType, number>();
  private totalFindings  = 0;

  private constructor() {
    Logger.info('PIIDetector initialised', { detectors: DETECTORS.length });
  }

  static getInstance(): PIIDetector {
    if (!PIIDetector.instance) {
      PIIDetector.instance = new PIIDetector();
    }
    return PIIDetector.instance;
  }

  // ---- Public API ----------------------------------------------------------

  /**
   * Scan text for specific PII types, or all types if none specified.
   */
  scan(text: string, types?: PIIType[]): PIIFinding[] {
    if (!text || typeof text !== 'string') return [];

    const activeDetectors = types
      ? DETECTORS.filter(d => types.includes(d.type))
      : DETECTORS;

    const findings: PIIFinding[] = [];

    for (const detector of activeDetectors) {
      detector.pattern.lastIndex = 0;
      let m: RegExpExecArray | null;

      while ((m = detector.pattern.exec(text)) !== null) {
        const value = m[0];
        const start = m.index;
        const end   = start + value.length;

        let confidence = detector.baseConfidence;
        if (detector.validate) {
          const delta = detector.validate(value);
          confidence  = Math.min(1.0, Math.max(0.0, confidence + delta));
        }

        if (confidence >= 0.30) {
          findings.push({ type: detector.type, value, position: [start, end], confidence });
        }
      }
      detector.pattern.lastIndex = 0;
    }

    return this.deduplicateFindings(findings);
  }

  /**
   * Full detection: returns findings, redacted text, and risk score.
   */
  detect(text: string): PIIDetectionResult {
    this.callsProcessed++;

    const findings = this.scan(text);
    const hasPII   = findings.length > 0;

    if (hasPII) {
      this.callsWithPII++;
      for (const f of findings) {
        this.totalFindings++;
        this.typeCounts.set(f.type, (this.typeCounts.get(f.type) ?? 0) + 1);
      }
    }

    const redacted  = this.applyRedaction(text, findings, { replacement: 'token' });
    const riskScore = this.computeRiskScore(findings);

    return { hasPII, findings, redacted, riskScore };
  }

  /**
   * Redact PII in text with configurable replacement strategy.
   */
  redact(text: string, options: RedactOptions = {}): string {
    const mode  = options.replacement ?? 'token';
    const types = options.types;
    const findings = this.scan(text, types);
    return this.applyRedaction(text, findings, {
      replacement:   mode,
      preserveLength: options.preserveLength,
    });
  }

  /**
   * Recursively scan all string fields of a JSON object.
   */
  detectInObject(obj: Record<string, unknown>): ObjectPIIResult {
    const fieldResults: Record<string, PIIDetectionResult> = {};
    let totalFindings    = 0;
    let aggregateRisk    = 0;

    const traverse = (node: unknown, path: string): void => {
      if (typeof node === 'string') {
        const result = this.detect(node);
        if (result.hasPII) {
          fieldResults[path]  = result;
          totalFindings      += result.findings.length;
          aggregateRisk       = Math.max(aggregateRisk, result.riskScore);
        }
      } else if (Array.isArray(node)) {
        node.forEach((item, idx) => traverse(item, `${path}[${idx}]`));
      } else if (node !== null && typeof node === 'object') {
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
          traverse(value, path ? `${path}.${key}` : key);
        }
      }
    };

    traverse(obj, '');

    return {
      hasPII:              totalFindings > 0,
      fieldResults,
      totalFindings,
      aggregateRiskScore:  aggregateRisk,
    };
  }

  /**
   * Process multiple texts in batch (synchronous; wrap in worker_threads for true parallelism).
   */
  detectBatch(texts: string[]): PIIDetectionResult[] {
    return texts.map(t => this.detect(t));
  }

  /**
   * Return accumulated detector statistics.
   */
  getStats(): PIIDetectorStats {
    const topTypes = Array.from(this.typeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => ({ type, count }));

    return {
      callsProcessed:     this.callsProcessed,
      callsWithPII:       this.callsWithPII,
      piiFoundRate:       this.callsProcessed > 0
                            ? this.callsWithPII / this.callsProcessed
                            : 0,
      topTypes,
      totalFindingsAllTime: this.totalFindings,
    };
  }

  // ---- Private helpers -----------------------------------------------------

  private applyRedaction(
    text: string,
    findings: PIIFinding[],
    options: { replacement?: RedactMode; preserveLength?: boolean },
  ): string {
    if (findings.length === 0) return text;

    const mode          = options.replacement  ?? 'token';
    const preserveLen   = options.preserveLength ?? false;

    // Process replacements from right to left to preserve string indices
    const sorted = [...findings].sort((a, b) => b.position[0] - a.position[0]);
    let result   = text;

    for (const finding of sorted) {
      const [start, end] = finding.position;
      const original     = result.slice(start, end);
      let replacement: string;

      switch (mode) {
        case 'token':
          replacement = preserveLen
            ? TOKEN_LABEL[finding.type].padEnd(original.length, '*').slice(
                0,
                Math.max(original.length, TOKEN_LABEL[finding.type].length),
              )
            : TOKEN_LABEL[finding.type];
          break;

        case 'mask':
          replacement = preserveLen
            ? '*'.repeat(original.length)
            : '*'.repeat(Math.min(original.length, 8));
          break;

        case 'remove':
          replacement = '';
          break;

        default:
          replacement = TOKEN_LABEL[finding.type];
      }

      result = result.slice(0, start) + replacement + result.slice(end);
    }

    return result;
  }

  private deduplicateFindings(findings: PIIFinding[]): PIIFinding[] {
    if (findings.length <= 1) return findings;

    const sorted  = [...findings].sort((a, b) => a.position[0] - b.position[0]);
    const deduped: PIIFinding[] = [];

    for (const candidate of sorted) {
      const [cStart, cEnd] = candidate.position;
      const last           = deduped[deduped.length - 1];

      if (last) {
        const [, lEnd] = last.position;
        if (cStart < lEnd) {
          // Overlapping – keep whichever has higher confidence
          if (candidate.confidence > last.confidence) {
            deduped[deduped.length - 1] = candidate;
          }
          continue;
        }
      }
      deduped.push(candidate);
    }

    return deduped;
  }

  private computeRiskScore(findings: PIIFinding[]): number {
    if (findings.length === 0) return 0;

    let raw = 0;
    for (const f of findings) {
      const weight = SEVERITY_WEIGHT[f.type] ?? 5;
      raw += weight * f.confidence;
    }

    const score = Math.min(100, raw * 3);
    return Math.round(score * 10) / 10;
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const piiDetector = PIIDetector.getInstance();
export default piiDetector;
