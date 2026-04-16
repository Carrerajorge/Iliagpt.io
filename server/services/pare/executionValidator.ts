import type { RobustRouteDecision } from "./deterministicRouter";
import type { ContextSignals } from "./contextDetector";

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  suggestions: string[];
  score: number;
}

export interface ValidationError {
  code: string;
  message: string;
  severity: "critical" | "error";
  field?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  field?: string;
}

export interface ToolExecutionResult {
  toolName: string;
  success: boolean;
  output: unknown;
  error?: string;
  durationMs: number;
}

export interface ExecutionContext {
  routeDecision: RobustRouteDecision;
  contextSignals: ContextSignals;
  toolResults: ToolExecutionResult[];
  originalPrompt: string;
  responseText?: string;
}

const CITATION_PATTERNS = [
  /\[(\d+)\]/g,
  /\(source:\s*[^)]+\)/gi,
  /según\s+[^.,]+/gi,
  /according\s+to\s+[^.,]+/gi,
  /\[\[cita\]\]/gi,
];

const FORMAT_CHECKS = {
  hasMarkdown: /[#*_`\[\]]/,
  hasCodeBlock: /```[\s\S]*?```/,
  hasTable: /\|[^|]+\|/,
  hasList: /^[\s]*[-*]\s/m,
  hasNumberedList: /^[\s]*\d+\.\s/m,
};

export class ExecutionValidator {
  validatePreExecution(
    routeDecision: RobustRouteDecision,
    contextSignals: ContextSignals
  ): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const suggestions: string[] = [];

    if (routeDecision.route === "agent" && routeDecision.tools.length === 0) {
      warnings.push({
        code: "NO_TOOLS_FOR_AGENT",
        message: "Agent route selected but no tools identified",
      });
      suggestions.push("Consider adding default tools based on intent");
    }

    if (contextSignals.hasAttachments && !routeDecision.tools.includes("file_read")) {
      warnings.push({
        code: "MISSING_FILE_READ",
        message: "Attachments present but file_read tool not selected",
        field: "tools",
      });
      suggestions.push("Add file_read tool for attachment processing");
    }

    if (contextSignals.attachmentTypes.includes("pdf") && 
        !routeDecision.tools.includes("pdf_extract") &&
        !routeDecision.tools.includes("file_read")) {
      warnings.push({
        code: "MISSING_PDF_TOOL",
        message: "PDF attachment detected but no PDF processing tool selected",
        field: "tools",
      });
    }

    if (contextSignals.hasUrls && 
        !routeDecision.tools.includes("browse_url") &&
        !routeDecision.tools.includes("web_search")) {
      warnings.push({
        code: "MISSING_URL_TOOL",
        message: "URLs detected but no web tool selected",
        field: "tools",
      });
    }

    if (routeDecision.confidence < 0.5) {
      warnings.push({
        code: "LOW_CONFIDENCE",
        message: `Low routing confidence: ${routeDecision.confidence}`,
        field: "confidence",
      });
      suggestions.push("Consider requesting clarification from user");
    }

    const score = this.calculatePreExecutionScore(errors, warnings);

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      suggestions,
      score,
    };
  }

  validatePostExecution(context: ExecutionContext): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const suggestions: string[] = [];

    const failedTools = context.toolResults.filter((t) => !t.success);
    for (const failed of failedTools) {
      errors.push({
        code: "TOOL_EXECUTION_FAILED",
        message: `Tool ${failed.toolName} failed: ${failed.error || "Unknown error"}`,
        severity: "error",
        field: failed.toolName,
      });
    }

    const slowTools = context.toolResults.filter((t) => t.durationMs > 30000);
    for (const slow of slowTools) {
      warnings.push({
        code: "SLOW_TOOL_EXECUTION",
        message: `Tool ${slow.toolName} took ${slow.durationMs}ms`,
        field: slow.toolName,
      });
    }

    if (context.responseText) {
      const formatValidation = this.validateResponseFormat(
        context.responseText,
        context.routeDecision.intent
      );
      errors.push(...formatValidation.errors);
      warnings.push(...formatValidation.warnings);
      suggestions.push(...formatValidation.suggestions);
    }

    if (context.contextSignals.hasUrls || context.routeDecision.intent === "nav") {
      const citationValidation = this.validateCitations(context.responseText || "");
      warnings.push(...citationValidation.warnings);
      suggestions.push(...citationValidation.suggestions);
    }

    const consistencyValidation = this.validateConsistency(context);
    warnings.push(...consistencyValidation.warnings);
    suggestions.push(...consistencyValidation.suggestions);

    const score = this.calculatePostExecutionScore(context, errors, warnings);

    return {
      isValid: errors.filter((e) => e.severity === "critical").length === 0,
      errors,
      warnings,
      suggestions,
      score,
    };
  }

  private validateResponseFormat(
    responseText: string,
    intent: string
  ): { errors: ValidationError[]; warnings: ValidationWarning[]; suggestions: string[] } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const suggestions: string[] = [];

    if (responseText.length < 10) {
      warnings.push({
        code: "RESPONSE_TOO_SHORT",
        message: "Response is very short",
      });
    }

    if (responseText.length > 50000) {
      warnings.push({
        code: "RESPONSE_TOO_LONG",
        message: "Response exceeds recommended length",
      });
      suggestions.push("Consider summarizing the response");
    }

    if (intent === "analysis" && !FORMAT_CHECKS.hasList.test(responseText) && 
        !FORMAT_CHECKS.hasNumberedList.test(responseText)) {
      suggestions.push("Analysis responses often benefit from bullet points or numbered lists");
    }

    const codeBlockCount = (responseText.match(/```/g) || []).length;
    if (codeBlockCount % 2 !== 0) {
      warnings.push({
        code: "UNCLOSED_CODE_BLOCK",
        message: "Unclosed code block detected",
      });
    }

    return { errors, warnings, suggestions };
  }

  private validateCitations(responseText: string): { warnings: ValidationWarning[]; suggestions: string[] } {
    const warnings: ValidationWarning[] = [];
    const suggestions: string[] = [];

    let hasCitations = false;
    for (const pattern of CITATION_PATTERNS) {
      if (pattern.test(responseText)) {
        hasCitations = true;
        break;
      }
    }

    if (!hasCitations && responseText.length > 500) {
      suggestions.push("Consider adding source citations for factual claims");
    }

    return { warnings, suggestions };
  }

  private validateConsistency(context: ExecutionContext): { warnings: ValidationWarning[]; suggestions: string[] } {
    const warnings: ValidationWarning[] = [];
    const suggestions: string[] = [];

    const expectedTools = new Set(context.routeDecision.tools);
    const executedTools = new Set(context.toolResults.map((t) => t.toolName));

    for (const expected of expectedTools) {
      if (!executedTools.has(expected)) {
        warnings.push({
          code: "TOOL_NOT_EXECUTED",
          message: `Expected tool ${expected} was not executed`,
          field: expected,
        });
      }
    }

    if (context.routeDecision.intent === "analysis" && 
        context.responseText && 
        !context.responseText.toLowerCase().includes("conclu") &&
        !context.responseText.toLowerCase().includes("resumen") &&
        !context.responseText.toLowerCase().includes("hallazgo")) {
      suggestions.push("Analysis responses typically include conclusions or key findings");
    }

    return { warnings, suggestions };
  }

  private calculatePreExecutionScore(errors: ValidationError[], warnings: ValidationWarning[]): number {
    let score = 100;
    score -= errors.filter((e) => e.severity === "critical").length * 30;
    score -= errors.filter((e) => e.severity === "error").length * 15;
    score -= warnings.length * 5;
    return Math.max(0, Math.min(100, score));
  }

  private calculatePostExecutionScore(
    context: ExecutionContext,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): number {
    let score = 100;

    const totalTools = context.toolResults.length;
    const successfulTools = context.toolResults.filter((t) => t.success).length;
    if (totalTools > 0) {
      const successRate = successfulTools / totalTools;
      score = score * successRate;
    }

    score -= errors.filter((e) => e.severity === "critical").length * 25;
    score -= errors.filter((e) => e.severity === "error").length * 10;
    score -= warnings.length * 3;

    return Math.max(0, Math.min(100, Math.round(score)));
  }
}

export const executionValidator = new ExecutionValidator();

export function validatePreExecution(
  routeDecision: RobustRouteDecision,
  contextSignals: ContextSignals
): ValidationResult {
  return executionValidator.validatePreExecution(routeDecision, contextSignals);
}

export function validatePostExecution(context: ExecutionContext): ValidationResult {
  return executionValidator.validatePostExecution(context);
}
