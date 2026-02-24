/**
 * A6. Response Validator
 * Validates AI responses before showing to user
 */

interface ValidationResult {
    isValid: boolean;
    issues: ValidationIssue[];
    confidence: number;
    shouldRetry: boolean;
}

interface ValidationIssue {
    type: "truncated" | "incomplete" | "incoherent" | "hallucination" | "off_topic" | "too_short" | "formatting";
    severity: "low" | "medium" | "high";
    message: string;
    position?: { start: number; end: number };
}

// Minimum content thresholds
const MIN_RESPONSE_LENGTH = 50;
const MIN_SENTENCES = 1;
const MAX_REPETITION_RATIO = 0.4;

// Truncation patterns
const TRUNCATION_PATTERNS = [
    /\.{3,}$/,                              // Ends with ...
    /[^.!?]$/,                              // Doesn't end with punctuation
    /\b(Por lo tanto|En resumen|En conclusión)\s*$/i, // Incomplete conclusions
    /\b(but|pero|however|sin embargo)\s*$/i, // Cut-off transitions
];

// Incomplete structure patterns
const INCOMPLETE_PATTERNS = [
    /^#+\s*$/m,                             // Empty heading
    /^\d+\.\s*$/m,                          // Empty numbered item
    /^-\s*$/m,                              // Empty bullet
    /\[\s*\]\s*$/,                          // Unclosed brackets
    /```[a-z]*\s*$/,                        // Unclosed code block
];

// Off-topic indicators
const OFF_TOPIC_PHRASES = [
    "no tengo acceso",
    "no puedo ayudarte con",
    "como modelo de lenguaje",
    "como IA",
    "i cannot",
    "i don't have access",
    "as an AI",
    "as a language model",
];

export function validateResponse(
    response: string,
    context?: {
        userQuery?: string;
        expectedType?: "summary" | "analysis" | "answer" | "creative";
        maxLength?: number;
    }
): ValidationResult {
    const issues: ValidationIssue[] = [];

    // 1. Check for empty or too short
    if (!response || response.trim().length === 0) {
        return {
            isValid: false,
            issues: [{
                type: "too_short",
                severity: "high",
                message: "Response is empty"
            }],
            confidence: 0,
            shouldRetry: true
        };
    }

    if (response.trim().length < MIN_RESPONSE_LENGTH) {
        issues.push({
            type: "too_short",
            severity: "medium",
            message: `Response is too short (${response.length} chars < ${MIN_RESPONSE_LENGTH})`
        });
    }

    // 2. Check for truncation
    for (const pattern of TRUNCATION_PATTERNS) {
        if (pattern.test(response.trim())) {
            issues.push({
                type: "truncated",
                severity: "high",
                message: "Response appears to be truncated"
            });
            break;
        }
    }

    // 3. Check for incomplete structures
    for (const pattern of INCOMPLETE_PATTERNS) {
        if (pattern.test(response)) {
            issues.push({
                type: "incomplete",
                severity: "medium",
                message: "Response contains incomplete structures"
            });
            break;
        }
    }

    // 4. Check for excessive repetition
    const words = response.toLowerCase().split(/\s+/);
    const wordCounts = new Map<string, number>();
    for (const word of words) {
        if (word.length > 3) {
            wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
        }
    }

    const maxWordCount = Math.max(...wordCounts.values());
    const repetitionRatio = maxWordCount / words.length;

    if (repetitionRatio > MAX_REPETITION_RATIO) {
        issues.push({
            type: "incoherent",
            severity: "high",
            message: `High repetition detected (${(repetitionRatio * 100).toFixed(1)}%)`
        });
    }

    // 5. Check for off-topic phrases
    const lowerResponse = response.toLowerCase();
    for (const phrase of OFF_TOPIC_PHRASES) {
        if (lowerResponse.includes(phrase)) {
            issues.push({
                type: "off_topic",
                severity: "low",
                message: `Contains off-topic phrase: "${phrase}"`
            });
            break;
        }
    }

    // 6. Check formatting issues (for expected structured responses)
    if (context?.expectedType === "analysis" || context?.expectedType === "summary") {
        const hasHeadings = /#+ /.test(response) || /\*\*[^*]+\*\*:/.test(response);
        const hasBullets = /^[-*•]\s/m.test(response);

        if (!hasHeadings && !hasBullets && response.length > 200) {
            issues.push({
                type: "formatting",
                severity: "low",
                message: "Expected structured response lacks headings or bullets"
            });
        }
    }

    // Calculate confidence
    const highIssues = issues.filter(i => i.severity === "high").length;
    const mediumIssues = issues.filter(i => i.severity === "medium").length;
    const lowIssues = issues.filter(i => i.severity === "low").length;

    const confidence = Math.max(0, 1 - (highIssues * 0.3) - (mediumIssues * 0.15) - (lowIssues * 0.05));
    const isValid = highIssues === 0 && mediumIssues <= 1;
    const shouldRetry = highIssues > 0;

    return {
        isValid,
        issues,
        confidence,
        shouldRetry
    };
}

// Quick validation for streaming responses
export function validateStreamingChunk(chunk: string, position: number): boolean {
    // Check for obvious problems in streaming chunks
    if (chunk.length > 1000 && /(.{50,})\1{3,}/.test(chunk)) {
        // Repeating pattern detected
        return false;
    }
    return true;
}

export default validateResponse;
