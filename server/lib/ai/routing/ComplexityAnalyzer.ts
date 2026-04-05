/**
 * ComplexityAnalyzer — Determines the required capability tier for a given request
 *
 * Analyzes: token count, code blocks, mathematical content, reasoning depth,
 * multimodal content, conversation depth, and tool requirements.
 */

import type { IChatMessage } from "../providers/core/types.js";
import { ModelCapability } from "../providers/core/types.js";
import type { IComplexityFactors, IComplexityScore } from "./types.js";

// ─────────────────────────────────────────────
// Pattern Detection
// ─────────────────────────────────────────────

const CODE_PATTERNS = [
  /```[\w]*\n[\s\S]+?```/,
  /def\s+\w+\s*\(/,
  /function\s+\w+\s*\(/,
  /class\s+\w+[\s:{]/,
  /import\s+[\w{*]/,
  /const\s+\w+\s*=/,
  /\bSELECT\b.*\bFROM\b/i,
];

const REASONING_PATTERNS = [
  /\bwhy\b|\bexplain\b|\banalyze\b|\bcompare\b|\bevaluate\b/i,
  /step.by.step|step\s+1|first.*then.*finally/i,
  /\bprove\b|\bdemonstrate\b|\bargue\b|\bdebate\b/i,
  /\bimplications?\b|\bconsequences?\b|\btradeoffs?\b/i,
  /\breview\b.*\bcritically\b|\bcritique\b/i,
  /\bdesign\b.*\barchitecture\b|\barchitect\b/i,
];

const MATH_PATTERNS = [
  /\d+\s*[\+\-\*\/\^]\s*\d+/,
  /\bintegral\b|\bderivative\b|\blimit\b/i,
  /\bequation\b|\bformula\b|\btheorem\b/i,
  /∑|∫|√|∂|∇|±|≤|≥|≠/,
  /\bmatrix\b|\beigenvalue\b|\bvector\b/i,
  /\$.*\$|\\frac|\\sum|\\int/,
];

const SEARCH_PATTERNS = [
  /\blatest\b|\bcurrent\b|\brecent\b|\btoday\b|\bnow\b/i,
  /\bsearch\b.*\bfor\b|\blook\s+up\b|\bfind\b.*\binformation\b/i,
  /what.*happening|news\s+about/i,
  /\bprice\b.*\btoday\b|\bstock\b|\bweather\b/i,
];

const LANGUAGE_PATTERNS: Record<string, RegExp> = {
  spanish: /\b(el|la|los|las|es|son|está|tiene|hacer|para)\b/,
  french: /\b(le|la|les|est|sont|avec|pour|dans|qui)\b/,
  german: /\b(der|die|das|ist|sind|mit|für|wenn|aber)\b/,
  portuguese: /\b(o|a|os|as|é|são|com|para|não|seu)\b/,
  chinese: /[\u4e00-\u9fff]/,
  japanese: /[\u3040-\u309f\u30a0-\u30ff]/,
  korean: /[\uac00-\ud7af]/,
  arabic: /[\u0600-\u06ff]/,
};

// ─────────────────────────────────────────────
// ComplexityAnalyzer
// ─────────────────────────────────────────────

export class ComplexityAnalyzer {
  /**
   * Analyze messages and return a complexity score with tier recommendation
   */
  analyze(messages: IChatMessage[], toolCount = 0): IComplexityScore {
    const text = this.extractText(messages);
    const tokenCount = this.estimateTokens(text);
    const factors = this.analyzeFactors(messages, text, tokenCount, toolCount);
    const { score, reasoning } = this.computeScore(factors);
    const tier = this.scoreToTier(score);

    return {
      score,
      confidence: this.computeConfidence(factors),
      tier,
      factors,
      reasoning,
    };
  }

  /**
   * Determine required ModelCapabilities from complexity analysis
   */
  requiredCapabilities(score: IComplexityScore): ModelCapability[] {
    const caps: ModelCapability[] = [ModelCapability.CHAT];
    const { factors } = score;

    if (factors.hasCode) caps.push(ModelCapability.CODE);
    if (factors.requiresReasoning || score.tier === "ultra") caps.push(ModelCapability.REASONING);
    if (factors.hasImages) caps.push(ModelCapability.VISION);
    if (factors.requiresSearch) caps.push(ModelCapability.SEARCH);
    if (factors.toolCount > 0) caps.push(ModelCapability.FUNCTION_CALLING);
    if (factors.contextWindowNeeded > 64_000) caps.push(ModelCapability.LONG_CONTEXT);

    return [...new Set(caps)];
  }

  // ─── Private Analysis ───

  private analyzeFactors(
    messages: IChatMessage[],
    text: string,
    tokenCount: number,
    toolCount: number,
  ): IComplexityFactors {
    const hasCode = CODE_PATTERNS.some((p) => p.test(text));
    const hasMath = MATH_PATTERNS.some((p) => p.test(text));
    const requiresReasoning = REASONING_PATTERNS.some((p) => p.test(text));
    const requiresSearch = SEARCH_PATTERNS.some((p) => p.test(text));

    // Check for multiple languages
    const detectedLanguages = Object.entries(LANGUAGE_PATTERNS)
      .filter(([, pattern]) => pattern.test(text))
      .map(([lang]) => lang);
    const hasMultipleLanguages = detectedLanguages.length > 1;

    // Check for image content
    const hasImages = messages.some((m) => {
      const content = m.content;
      if (Array.isArray(content)) {
        return content.some(
          (part) => typeof part === "object" && "type" in part && part.type === "image",
        );
      }
      return false;
    });

    const conversationDepth = messages.length;
    const contextWindowNeeded = tokenCount + Math.ceil(tokenCount * 0.5); // estimated output
    const hasJsonOutput = /\bjson\b|respond.{0,20}json|json.{0,20}format/i.test(text);

    return {
      tokenCount,
      hasCode,
      hasMultipleLanguages,
      requiresReasoning,
      requiresSearch,
      hasImages,
      conversationDepth,
      toolCount,
      contextWindowNeeded,
      hasJsonOutput,
      hasMath,
    };
  }

  private computeScore(factors: IComplexityFactors): { score: number; reasoning: string[] } {
    const reasons: string[] = [];
    let score = 0;

    // Token count (normalized to 0-0.25)
    const tokenScore = Math.min(factors.tokenCount / 100_000, 1) * 0.25;
    score += tokenScore;
    if (factors.tokenCount > 10_000) reasons.push(`Long context (${factors.tokenCount} tokens)`);

    // Reasoning requirements (0-0.25)
    if (factors.requiresReasoning) {
      score += 0.2;
      reasons.push("Requires multi-step reasoning");
    }
    if (factors.hasMath) {
      score += 0.15;
      reasons.push("Mathematical content detected");
    }

    // Code complexity (0-0.15)
    if (factors.hasCode) {
      score += 0.1;
      reasons.push("Code generation/analysis required");
    }

    // Multi-modal (0-0.1)
    if (factors.hasImages) {
      score += 0.1;
      reasons.push("Vision/image content");
    }

    // Conversation depth (0-0.1)
    const depthScore = Math.min(factors.conversationDepth / 20, 1) * 0.1;
    score += depthScore;
    if (factors.conversationDepth > 10) reasons.push(`Deep conversation (${factors.conversationDepth} turns)`);

    // Tool use (0-0.1)
    if (factors.toolCount > 0) {
      score += Math.min(factors.toolCount / 5, 1) * 0.1;
      reasons.push(`${factors.toolCount} tools available`);
    }

    // Multiple languages (0-0.05)
    if (factors.hasMultipleLanguages) {
      score += 0.05;
      reasons.push("Multi-language content");
    }

    // Search requirements (0-0.05)
    if (factors.requiresSearch) {
      score += 0.05;
      reasons.push("Real-time search likely needed");
    }

    return { score: Math.min(score, 1), reasoning: reasons };
  }

  private computeConfidence(factors: IComplexityFactors): number {
    // More signal = more confidence
    let signals = 0;
    if (factors.hasCode) signals++;
    if (factors.hasMath) signals++;
    if (factors.requiresReasoning) signals++;
    if (factors.hasImages) signals++;
    if (factors.requiresSearch) signals++;
    if (factors.tokenCount > 1_000) signals++;
    if (factors.toolCount > 0) signals++;

    return Math.min(0.5 + signals * 0.07, 1.0);
  }

  private scoreToTier(score: number): "flash" | "pro" | "ultra" {
    if (score >= 0.7) return "ultra";
    if (score >= 0.35) return "pro";
    return "flash";
  }

  private extractText(messages: IChatMessage[]): string {
    return messages
      .map((m) => {
        const content = m.content;
        if (typeof content === "string") return content;
        if (Array.isArray(content)) {
          return content
            .map((part) => (typeof part === "object" && "text" in part ? (part as {text: string}).text : ""))
            .join(" ");
        }
        return "";
      })
      .join(" ");
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
