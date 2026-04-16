/**
 * PII Detector & Redactor - ILIAGPT PRO 3.0 (10x Enhanced)
 * 
 * Detects and redacts Personally Identifiable Information.
 * Supports multiple detection patterns and custom rules.
 */

// ============== Types ==============

export interface PIIDetection {
    type: PIIType;
    value: string;
    start: number;
    end: number;
    confidence: number;
    context?: string;
}

export type PIIType =
    | "email"
    | "phone"
    | "ssn"
    | "credit_card"
    | "ip_address"
    | "address"
    | "name"
    | "date_of_birth"
    | "passport"
    | "license"
    | "bank_account"
    | "medical_id"
    | "custom";

export interface RedactionConfig {
    types?: PIIType[];
    replacement?: RedactionMethod;
    preserveLength?: boolean;
    customPatterns?: CustomPattern[];
    excludePatterns?: RegExp[];
    contextWindow?: number;
}

export type RedactionMethod =
    | "mask"          // [REDACTED]
    | "hash"          // [#a7b3c...]
    | "type_label"    // [EMAIL]
    | "partial"       // jo***@***.com
    | "remove";       // (nothing)

export interface CustomPattern {
    name: string;
    pattern: RegExp;
    type: PIIType | string;
    confidence?: number;
}

export interface RedactionResult {
    text: string;
    detections: PIIDetection[];
    redactionCount: number;
    byType: Record<string, number>;
}

// ============== PII Patterns ==============

const PII_PATTERNS: Record<PIIType, { patterns: RegExp[]; confidence: number }> = {
    email: {
        patterns: [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi],
        confidence: 0.98,
    },
    phone: {
        patterns: [
            /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
            /\+\d{1,3}\s?\d{2,4}\s?\d{6,8}/g,
        ],
        confidence: 0.9,
    },
    ssn: {
        patterns: [
            /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g,
            /\bSSN[:\s]*\d{3}[-.\s]?\d{2}[-.\s]?\d{4}/gi,
        ],
        confidence: 0.95,
    },
    credit_card: {
        patterns: [
            /\b\d{4}[-.\s]?\d{4}[-.\s]?\d{4}[-.\s]?\d{4}\b/g,
            /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/g,
        ],
        confidence: 0.95,
    },
    ip_address: {
        patterns: [
            /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
        ],
        confidence: 0.9,
    },
    address: {
        patterns: [
            /\b\d{1,5}\s+(?:[A-Za-z]+\s+){1,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl)\b/gi,
            /\b(?:Calle|Avenida|Av|Carrera|Cra)\s+[A-Za-z0-9]+\s*#?\s*\d+[-\d]*\b/gi,
        ],
        confidence: 0.8,
    },
    name: {
        patterns: [
            /\b(?:Mr|Mrs|Ms|Dr|Prof)\.?\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/g,
            /\bNombre[:\s]+[A-Z][a-záéíóú]+\s+[A-Z][a-záéíóú]+/gi,
            /\bName[:\s]+[A-Z][a-z]+\s+[A-Z][a-z]+/gi,
        ],
        confidence: 0.75,
    },
    date_of_birth: {
        patterns: [
            /\b(?:DOB|Date of Birth|Fecha de Nacimiento)[:\s]*\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/gi,
            /\b(?:born|nacido)[:\s]*\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/gi,
        ],
        confidence: 0.9,
    },
    passport: {
        patterns: [
            /\b(?:passport|pasaporte)[:\s#]*[A-Z0-9]{6,9}\b/gi,
        ],
        confidence: 0.85,
    },
    license: {
        patterns: [
            /\b(?:license|licencia|DL)[:\s#]*[A-Z0-9]{5,12}\b/gi,
        ],
        confidence: 0.8,
    },
    bank_account: {
        patterns: [
            /\b(?:account|cuenta)[:\s#]*\d{8,17}\b/gi,
            /\bIBAN[:\s]*[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gi,
        ],
        confidence: 0.85,
    },
    medical_id: {
        patterns: [
            /\b(?:MRN|Medical ID|Patient ID)[:\s#]*[A-Z0-9]{6,12}\b/gi,
        ],
        confidence: 0.8,
    },
    custom: {
        patterns: [],
        confidence: 0.5,
    },
};

// ============== Detection ==============

function detectPII(
    text: string,
    config: RedactionConfig = {}
): PIIDetection[] {
    const {
        types = Object.keys(PII_PATTERNS) as PIIType[],
        customPatterns = [],
        excludePatterns = [],
        contextWindow = 20,
    } = config;

    const detections: PIIDetection[] = [];
    const seenPositions = new Set<string>();

    // Check built-in patterns
    for (const type of types) {
        if (type === "custom") continue;

        const { patterns, confidence } = PII_PATTERNS[type];

        for (const pattern of patterns) {
            const regex = new RegExp(pattern.source, pattern.flags);
            let match;

            while ((match = regex.exec(text)) !== null) {
                const posKey = `${match.index}-${match.index + match[0].length}`;
                if (seenPositions.has(posKey)) continue;

                // Check exclude patterns
                if (excludePatterns.some(ep => ep.test(match![0]))) continue;

                seenPositions.add(posKey);

                const start = match.index;
                const end = start + match[0].length;
                const contextStart = Math.max(0, start - contextWindow);
                const contextEnd = Math.min(text.length, end + contextWindow);

                detections.push({
                    type,
                    value: match[0],
                    start,
                    end,
                    confidence,
                    context: text.slice(contextStart, contextEnd),
                });
            }
        }
    }

    // Check custom patterns
    for (const custom of customPatterns) {
        const regex = new RegExp(custom.pattern.source, custom.pattern.flags);
        let match;

        while ((match = regex.exec(text)) !== null) {
            const posKey = `${match.index}-${match.index + match[0].length}`;
            if (seenPositions.has(posKey)) continue;

            seenPositions.add(posKey);

            detections.push({
                type: custom.type as PIIType,
                value: match[0],
                start: match.index,
                end: match.index + match[0].length,
                confidence: custom.confidence ?? 0.7,
            });
        }
    }

    return detections.sort((a, b) => a.start - b.start);
}

// ============== Redaction ==============

function createReplacement(
    detection: PIIDetection,
    method: RedactionMethod,
    preserveLength: boolean
): string {
    const { type, value } = detection;

    switch (method) {
        case "mask":
            return preserveLength
                ? "X".repeat(value.length)
                : "[REDACTED]";

        case "hash":
            const hash = simpleHash(value);
            return `[#${hash}]`;

        case "type_label":
            return `[${type.toUpperCase()}]`;

        case "partial":
            return partialMask(value, type);

        case "remove":
            return "";

        default:
            return "[REDACTED]";
    }
}

function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(16).slice(0, 8);
}

function partialMask(value: string, type: PIIType): string {
    switch (type) {
        case "email":
            const [user, domain] = value.split("@");
            return `${user[0]}${"*".repeat(Math.max(1, user.length - 2))}${user.slice(-1)}@${"*".repeat(3)}.${domain.split(".").pop()}`;

        case "phone":
            return value.slice(0, 3) + "*".repeat(value.length - 6) + value.slice(-3);

        case "credit_card":
            return "*".repeat(value.length - 4) + value.slice(-4);

        case "ssn":
            return "***-**-" + value.slice(-4);

        default:
            const len = value.length;
            if (len <= 4) return "*".repeat(len);
            return value[0] + "*".repeat(len - 2) + value[len - 1];
    }
}

// ============== Main Functions ==============

export function detectAndRedact(
    text: string,
    config: RedactionConfig = {}
): RedactionResult {
    const {
        replacement = "mask",
        preserveLength = false,
    } = config;

    const detections = detectPII(text, config);

    if (detections.length === 0) {
        return {
            text,
            detections: [],
            redactionCount: 0,
            byType: {},
        };
    }

    // Apply redactions from end to start to preserve positions
    let redactedText = text;
    const sortedDetections = [...detections].sort((a, b) => b.start - a.start);

    for (const detection of sortedDetections) {
        const replacementText = createReplacement(detection, replacement, preserveLength);
        redactedText =
            redactedText.slice(0, detection.start) +
            replacementText +
            redactedText.slice(detection.end);
    }

    // Count by type
    const byType: Record<string, number> = {};
    for (const d of detections) {
        byType[d.type] = (byType[d.type] || 0) + 1;
    }

    return {
        text: redactedText,
        detections,
        redactionCount: detections.length,
        byType,
    };
}

export function detectOnly(
    text: string,
    config: Omit<RedactionConfig, 'replacement' | 'preserveLength'> = {}
): PIIDetection[] {
    return detectPII(text, config);
}

export function redactSpecificTypes(
    text: string,
    types: PIIType[],
    config: Omit<RedactionConfig, 'types'> = {}
): RedactionResult {
    return detectAndRedact(text, { ...config, types });
}

export function containsPII(text: string): boolean {
    const detections = detectPII(text, {});
    return detections.length > 0;
}

export function getPIISummary(text: string): Record<PIIType, number> {
    const detections = detectPII(text, {});
    const summary: Partial<Record<PIIType, number>> = {};

    for (const d of detections) {
        summary[d.type] = (summary[d.type] || 0) + 1;
    }

    return summary as Record<PIIType, number>;
}

export const piiDetector = {
    detectAndRedact,
    detectOnly,
    redactSpecificTypes,
    containsPII,
    getPIISummary,
    PII_PATTERNS,
};

export default piiDetector;
