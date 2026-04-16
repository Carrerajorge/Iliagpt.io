/**
 * Confidence Threshold Service
 * 
 * Features:
 * - Detect low-confidence LLM extractions
 * - Emit clarification_needed events
 * - Track confidence history for quality monitoring
 * - Adaptive thresholds based on query complexity
 */

import { EventEmitter } from "events";

export interface ConfidenceResult {
    score: number;                    // 0-1 confidence score
    needsClarification: boolean;      // Whether to ask user
    ambiguousFields: string[];        // Which fields are uncertain
    suggestedQuestions: string[];     // Questions to ask user
    complexity: "low" | "medium" | "high";
}

export interface ConfidenceConfig {
    defaultThreshold: number;         // Default confidence threshold
    lowComplexityThreshold: number;   // Threshold for simple queries
    highComplexityThreshold: number;  // Threshold for complex queries
    enableAutoAsk: boolean;           // Auto-emit clarification events
    maxAmbiguousFields: number;       // Max fields before forcing clarification
}

const DEFAULT_CONFIG: ConfidenceConfig = {
    defaultThreshold: 0.7,
    lowComplexityThreshold: 0.6,
    highComplexityThreshold: 0.8,
    enableAutoAsk: true,
    maxAmbiguousFields: 3,
};

// Complexity indicators in prompts
const COMPLEXITY_INDICATORS = {
    high: [
        /\band\b.*\band\b/i,                    // Multiple "and" conjunctions
        /compare|contrast|analyze|synthesize/i, // Analytical verbs
        /\d+\s*(articles?|papers?|sources?)/i,  // Specific quantities
        /between.*and.*and/i,                   // Multiple ranges
        /excel.*word|word.*excel/i,             // Multi-format
        /apa|mla|chicago|harvard/i,             // Citation formats
    ],
    medium: [
        /search|find|look for/i,
        /create|generate|make/i,
        /\d{4}/,                                // Year references
        /about|regarding|on the topic/i,
    ],
};

// Event emitter for clarification events
const clarificationEmitter = new EventEmitter();

// Confidence history for monitoring
const confidenceHistory: { timestamp: number; score: number; needed: boolean }[] = [];
const MAX_HISTORY = 1000;

// Determine query complexity
export function assessComplexity(prompt: string): "low" | "medium" | "high" {
    for (const pattern of COMPLEXITY_INDICATORS.high) {
        if (pattern.test(prompt)) return "high";
    }

    for (const pattern of COMPLEXITY_INDICATORS.medium) {
        if (pattern.test(prompt)) return "medium";
    }

    return "low";
}

// Get threshold based on complexity
function getThresholdForComplexity(
    complexity: "low" | "medium" | "high",
    config: ConfidenceConfig
): number {
    switch (complexity) {
        case "low": return config.lowComplexityThreshold;
        case "high": return config.highComplexityThreshold;
        default: return config.defaultThreshold;
    }
}

// Generate clarification questions based on ambiguous fields
function generateQuestions(ambiguousFields: string[], originalPrompt: string): string[] {
    const questions: string[] = [];

    for (const field of ambiguousFields) {
        switch (field) {
            case "quantity":
                questions.push("¿Cuántos resultados/artículos necesitas exactamente?");
                break;
            case "dateRange":
                questions.push("¿De qué años deben ser los resultados? (ej: 2020-2024)");
                break;
            case "format":
                questions.push("¿En qué formato deseas el resultado? (Excel, Word, PDF, etc.)");
                break;
            case "topic":
                questions.push("¿Podrías ser más específico sobre el tema de búsqueda?");
                break;
            case "language":
                questions.push("¿En qué idioma deseas los resultados?");
                break;
            case "citationStyle":
                questions.push("¿Qué formato de citación prefieres? (APA, MLA, Chicago, etc.)");
                break;
            case "audience":
                questions.push("¿Para qué audiencia es este contenido? (académico, general, técnico)");
                break;
            default:
                questions.push(`¿Podrías clarificar qué deseas para "${field}"?`);
        }
    }

    return questions;
}

// Detect ambiguous fields in extracted spec
function detectAmbiguousFields(extractedSpec: any, originalPrompt: string): string[] {
    const ambiguous: string[] = [];

    // Check for missing or vague quantities
    if (!extractedSpec.constraints?.some((c: any) => c.type === "QUANTITY")) {
        if (/artículos?|papers?|resultados?|sources?/i.test(originalPrompt)) {
            ambiguous.push("quantity");
        }
    }

    // Check for missing date range when relevant
    if (!extractedSpec.constraints?.some((c: any) => c.type === "TIME_RANGE")) {
        if (/recientes?|últimos?|actuales?|recent|latest/i.test(originalPrompt)) {
            ambiguous.push("dateRange");
        }
    }

    // Check for ambiguous format requests
    const formatConstraints = extractedSpec.constraints?.filter((c: any) => c.type === "FORMAT") || [];
    if (formatConstraints.length === 0) {
        if (/documento|file|archivo|export/i.test(originalPrompt)) {
            ambiguous.push("format");
        }
    }

    // Check for vague topics
    if (extractedSpec.tasks?.some((t: any) =>
        t.object?.length < 5 || t.object === "unknown"
    )) {
        ambiguous.push("topic");
    }

    // Check for citation style mentions without specifics
    if (/cita|reference|bibliografía|citation/i.test(originalPrompt)) {
        if (!extractedSpec.constraints?.some((c: any) =>
            /apa|mla|chicago|harvard|ieee/i.test(c.value || "")
        )) {
            ambiguous.push("citationStyle");
        }
    }

    return ambiguous;
}

// Main confidence evaluation function
export function evaluateConfidence(
    extractedSpec: any,
    originalPrompt: string,
    llmConfidence: number,
    config: Partial<ConfidenceConfig> = {}
): ConfidenceResult {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    const complexity = assessComplexity(originalPrompt);
    const threshold = getThresholdForComplexity(complexity, cfg);
    const ambiguousFields = detectAmbiguousFields(extractedSpec, originalPrompt);

    // Calculate adjusted confidence
    let adjustedScore = llmConfidence;

    // Reduce confidence for each ambiguous field
    adjustedScore -= ambiguousFields.length * 0.1;

    // Reduce confidence for high complexity without detailed extraction
    if (complexity === "high" && (!extractedSpec.tasks || extractedSpec.tasks.length < 2)) {
        adjustedScore -= 0.15;
    }

    // Ensure score stays in bounds
    adjustedScore = Math.max(0, Math.min(1, adjustedScore));

    const needsClarification =
        adjustedScore < threshold ||
        ambiguousFields.length >= cfg.maxAmbiguousFields;

    const suggestedQuestions = needsClarification
        ? generateQuestions(ambiguousFields, originalPrompt)
        : [];

    // Track history
    confidenceHistory.push({
        timestamp: Date.now(),
        score: adjustedScore,
        needed: needsClarification,
    });

    // Trim history
    if (confidenceHistory.length > MAX_HISTORY) {
        confidenceHistory.shift();
    }

    const result: ConfidenceResult = {
        score: adjustedScore,
        needsClarification,
        ambiguousFields,
        suggestedQuestions,
        complexity,
    };

    // Emit clarification event if needed
    if (needsClarification && cfg.enableAutoAsk) {
        clarificationEmitter.emit("clarification_needed", {
            ...result,
            originalPrompt,
            extractedSpec,
        });

        console.log(`[ConfidenceThreshold] Clarification needed - Score: ${adjustedScore.toFixed(2)}, Threshold: ${threshold}`);
    }

    return result;
}

// Get confidence statistics
export function getConfidenceStats(): {
    totalEvaluations: number;
    clarificationsNeeded: number;
    averageScore: number;
    clarificationRate: number;
} {
    const total = confidenceHistory.length;
    const clarifications = confidenceHistory.filter(h => h.needed).length;
    const avgScore = total > 0
        ? confidenceHistory.reduce((sum, h) => sum + h.score, 0) / total
        : 0;

    return {
        totalEvaluations: total,
        clarificationsNeeded: clarifications,
        averageScore: avgScore,
        clarificationRate: total > 0 ? clarifications / total : 0,
    };
}

// Subscribe to clarification events
export function onClarificationNeeded(
    callback: (event: ConfidenceResult & { originalPrompt: string; extractedSpec: any }) => void
): void {
    clarificationEmitter.on("clarification_needed", callback);
}

// Remove clarification listener
export function offClarificationNeeded(
    callback: (event: any) => void
): void {
    clarificationEmitter.off("clarification_needed", callback);
}

// Reset statistics
export function resetConfidenceStats(): void {
    confidenceHistory.length = 0;
}

export default {
    evaluateConfidence,
    assessComplexity,
    getConfidenceStats,
    onClarificationNeeded,
    offClarificationNeeded,
    resetConfidenceStats,
};
