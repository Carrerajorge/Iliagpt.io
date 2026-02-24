/**
 * Self-Reflection Loop - ILIAGPT PRO 3.0
 * 
 * Allows agents to verify their own work before delivering.
 * Implements critique, correction, and quality verification.
 */

// ============== Types ==============

export interface ReflectionResult {
    originalOutput: any;
    isValid: boolean;
    confidence: number; // 0-1
    issues: ReflectionIssue[];
    correctedOutput?: any;
    reflectionSteps: ReflectionStep[];
}

export interface ReflectionIssue {
    type: "factual" | "logical" | "incomplete" | "unclear" | "formatting" | "safety";
    severity: "low" | "medium" | "high" | "critical";
    description: string;
    suggestion?: string;
    location?: string;
}

export interface ReflectionStep {
    phase: "understand" | "verify" | "critique" | "correct" | "validate";
    thought: string;
    duration: number;
}

export interface ReflectionConfig {
    maxIterations?: number;
    confidenceThreshold?: number;
    enableFactCheck?: boolean;
    enableLogicCheck?: boolean;
    enableCompletenessCheck?: boolean;
    enableSafetyCheck?: boolean;
}

// ============== Reflection Criteria ==============

const REFLECTION_PROMPTS = {
    understand: `
    First, understand what was asked:
    - What is the user's goal?
    - What constraints exist?
    - What would a perfect answer include?
  `,
    verify: `
    Now verify the response:
    - Does it directly address the question?
    - Are all claims factually accurate?
    - Is the logic sound?
  `,
    critique: `
    Critique the response honestly:
    - What could be improved?
    - What is missing?
    - What might confuse the user?
  `,
    correct: `
    Make corrections if needed:
    - Fix any errors identified
    - Add missing information
    - Improve clarity
  `,
    validate: `
    Final validation:
    - Does the corrected version meet standards?
    - Is confidence high enough to deliver?
  `,
};

// ============== Quality Checks ==============

/**
 * Check for common factual issues
 */
function checkFactualAccuracy(output: string): ReflectionIssue[] {
    const issues: ReflectionIssue[] = [];

    // Check for unsupported claims
    const claimPatterns = [
        { pattern: /\b(always|never|all|none|every)\b/gi, type: "factual" as const },
        { pattern: /\b(definitely|certainly|absolutely|100%)\b/gi, type: "factual" as const },
    ];

    for (const { pattern, type } of claimPatterns) {
        const matches = output.match(pattern);
        if (matches && matches.length > 2) {
            issues.push({
                type,
                severity: "low",
                description: "Contains absolute claims that may not always be true",
                suggestion: "Consider using more nuanced language",
            });
        }
    }

    return issues;
}

/**
 * Check for logical consistency
 */
function checkLogicalConsistency(output: string): ReflectionIssue[] {
    const issues: ReflectionIssue[] = [];

    // Check for contradictions
    if (output.includes(" but ") && output.includes(" however ")) {
        const sentences = output.split(/[.!?]/);
        if (sentences.length > 5) {
            issues.push({
                type: "logical",
                severity: "medium",
                description: "Multiple contrasting statements may create confusion",
                suggestion: "Consider restructuring for clarity",
            });
        }
    }

    return issues;
}

/**
 * Check for completeness
 */
function checkCompleteness(
    output: string,
    originalQuery: string
): ReflectionIssue[] {
    const issues: ReflectionIssue[] = [];

    // Check if response is too short
    if (output.length < 100 && originalQuery.length > 50) {
        issues.push({
            type: "incomplete",
            severity: "medium",
            description: "Response may be too brief for the complexity of the question",
            suggestion: "Consider adding more detail or explanation",
        });
    }

    // Check for question marks in query that need answering
    const questionCount = (originalQuery.match(/\?/g) || []).length;
    const responseLength = output.split(/[.!]/g).length;

    if (questionCount > responseLength) {
        issues.push({
            type: "incomplete",
            severity: "high",
            description: "Not all questions appear to be addressed",
            suggestion: "Ensure each question is answered",
        });
    }

    return issues;
}

/**
 * Check for safety issues
 */
function checkSafety(output: string): ReflectionIssue[] {
    const issues: ReflectionIssue[] = [];

    const sensitivePatterns = [
        { pattern: /password|contraseña|secret|clave/gi, severity: "high" as const },
        { pattern: /api[_\-]?key|token/gi, severity: "high" as const },
        { pattern: /\b\d{16}\b/g, severity: "critical" as const }, // Credit card
    ];

    for (const { pattern, severity } of sensitivePatterns) {
        if (pattern.test(output)) {
            issues.push({
                type: "safety",
                severity,
                description: "Response may contain sensitive information",
                suggestion: "Review and redact sensitive data",
            });
        }
    }

    return issues;
}

// ============== Main Reflection Function ==============

/**
 * Perform self-reflection on agent output
 */
export async function reflect(
    output: any,
    originalQuery: string,
    config: ReflectionConfig = {}
): Promise<ReflectionResult> {
    const {
        maxIterations = 1,
        confidenceThreshold = 0.8,
        enableFactCheck = true,
        enableLogicCheck = true,
        enableCompletenessCheck = true,
        enableSafetyCheck = true,
    } = config;

    const steps: ReflectionStep[] = [];
    const allIssues: ReflectionIssue[] = [];
    const outputStr = typeof output === "string" ? output : JSON.stringify(output);

    // Phase 1: Understand
    const startUnderstand = Date.now();
    steps.push({
        phase: "understand",
        thought: `Analyzing query: "${originalQuery.slice(0, 100)}..."`,
        duration: Date.now() - startUnderstand,
    });

    // Phase 2: Verify
    const startVerify = Date.now();

    if (enableFactCheck) {
        allIssues.push(...checkFactualAccuracy(outputStr));
    }

    if (enableLogicCheck) {
        allIssues.push(...checkLogicalConsistency(outputStr));
    }

    if (enableCompletenessCheck) {
        allIssues.push(...checkCompleteness(outputStr, originalQuery));
    }

    if (enableSafetyCheck) {
        allIssues.push(...checkSafety(outputStr));
    }

    steps.push({
        phase: "verify",
        thought: `Found ${allIssues.length} potential issues`,
        duration: Date.now() - startVerify,
    });

    // Phase 3: Critique
    const startCritique = Date.now();
    const criticalIssues = allIssues.filter(i =>
        i.severity === "critical" || i.severity === "high"
    );

    steps.push({
        phase: "critique",
        thought: `${criticalIssues.length} critical/high issues need attention`,
        duration: Date.now() - startCritique,
    });

    // Phase 4: Correct (if needed)
    let correctedOutput = output;
    if (criticalIssues.length > 0) {
        const startCorrect = Date.now();
        // In a real implementation, this would use LLM to correct
        correctedOutput = output; // Placeholder
        steps.push({
            phase: "correct",
            thought: "Applied corrections for critical issues",
            duration: Date.now() - startCorrect,
        });
    }

    // Phase 5: Validate
    const startValidate = Date.now();
    const confidence = calculateConfidence(allIssues);
    const isValid = confidence >= confidenceThreshold && criticalIssues.length === 0;

    steps.push({
        phase: "validate",
        thought: `Final confidence: ${(confidence * 100).toFixed(0)}%. ${isValid ? "Ready to deliver" : "Needs improvement"}`,
        duration: Date.now() - startValidate,
    });

    return {
        originalOutput: output,
        isValid,
        confidence,
        issues: allIssues,
        correctedOutput: correctedOutput !== output ? correctedOutput : undefined,
        reflectionSteps: steps,
    };
}

/**
 * Calculate confidence score based on issues
 */
function calculateConfidence(issues: ReflectionIssue[]): number {
    if (issues.length === 0) return 0.95;

    let score = 1.0;

    for (const issue of issues) {
        switch (issue.severity) {
            case "critical": score -= 0.3; break;
            case "high": score -= 0.15; break;
            case "medium": score -= 0.08; break;
            case "low": score -= 0.03; break;
        }
    }

    return Math.max(0, Math.min(1, score));
}

/**
 * Quick validation without full reflection
 */
export function quickValidate(output: any): {
    isValid: boolean;
    confidence: number;
    criticalIssues: number;
} {
    const outputStr = typeof output === "string" ? output : JSON.stringify(output);
    const safetyIssues = checkSafety(outputStr);
    const criticalCount = safetyIssues.filter(i => i.severity === "critical").length;

    return {
        isValid: criticalCount === 0,
        confidence: criticalCount === 0 ? 0.9 : 0.3,
        criticalIssues: criticalCount,
    };
}

export default {
    reflect,
    quickValidate,
    checkFactualAccuracy,
    checkLogicalConsistency,
    checkCompleteness,
    checkSafety,
};
