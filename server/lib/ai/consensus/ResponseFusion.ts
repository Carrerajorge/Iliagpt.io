/**
 * ResponseFusion — Intelligently merges the best sections from multiple responses
 *
 * Strategy: Split responses into logical sections, score each section,
 * select best sections, then compose a coherent fused output.
 */

import type { IComparisonResult } from "./ResponseComparator.js";

// ─────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────

export interface IScoredResponse {
  content: string;
  score: IComparisonResult;
  model: string;
  provider: string;
}

export interface IFusionResult {
  content: string;
  strategy: "best_single" | "section_merge" | "synthesis";
  sourcesUsed: number;
  confidence: number;
  metadata: {
    totalResponses: number;
    bestResponseScore: number;
    fusionQualityEstimate: number;
  };
}

interface ISection {
  content: string;
  type: "header" | "paragraph" | "code" | "list" | "table";
  score: number;
  sourceIndex: number;
}

// ─────────────────────────────────────────────
// ResponseFusion
// ─────────────────────────────────────────────

export class ResponseFusion {

  /**
   * Fuse multiple scored responses into the best possible single response
   */
  fuse(responses: IScoredResponse[], minConfidenceForFusion = 0.5): IFusionResult {
    if (responses.length === 0) {
      return {
        content: "",
        strategy: "best_single",
        sourcesUsed: 0,
        confidence: 0,
        metadata: { totalResponses: 0, bestResponseScore: 0, fusionQualityEstimate: 0 },
      };
    }

    if (responses.length === 1) {
      return {
        content: responses[0].content,
        strategy: "best_single",
        sourcesUsed: 1,
        confidence: responses[0].score.overallScore,
        metadata: {
          totalResponses: 1,
          bestResponseScore: responses[0].score.overallScore,
          fusionQualityEstimate: responses[0].score.overallScore,
        },
      };
    }

    // Sort by overall score
    const sorted = [...responses].sort((a, b) => b.score.overallScore - a.score.overallScore);
    const best = sorted[0];

    // If best is highly confident and similar to others, just use it
    if (best.score.similarity > 0.75 && best.score.overallScore > 0.8) {
      return {
        content: best.content,
        strategy: "best_single",
        sourcesUsed: 1,
        confidence: best.score.overallScore,
        metadata: {
          totalResponses: responses.length,
          bestResponseScore: best.score.overallScore,
          fusionQualityEstimate: best.score.overallScore,
        },
      };
    }

    // Try section-level merge if responses are sufficiently different
    const avgSimilarity = responses.reduce((sum, r) => sum + r.score.similarity, 0) / responses.length;

    if (avgSimilarity < 0.5 && sorted[0].score.confidence > minConfidenceForFusion) {
      const fused = this.mergeSections(sorted);
      if (fused) {
        return {
          content: fused,
          strategy: "section_merge",
          sourcesUsed: Math.min(responses.length, 3),
          confidence: 0.7,
          metadata: {
            totalResponses: responses.length,
            bestResponseScore: best.score.overallScore,
            fusionQualityEstimate: 0.75,
          },
        };
      }
    }

    // Default: best single response
    return {
      content: best.content,
      strategy: "best_single",
      sourcesUsed: 1,
      confidence: best.score.overallScore,
      metadata: {
        totalResponses: responses.length,
        bestResponseScore: best.score.overallScore,
        fusionQualityEstimate: best.score.overallScore,
      },
    };
  }

  /**
   * Merge sections from top responses, preferring the highest-quality section
   * for each logical part of the answer.
   */
  private mergeSections(responses: IScoredResponse[]): string | null {
    const allSections: ISection[] = [];

    // Only use top 3 to avoid noise
    const topResponses = responses.slice(0, 3);

    for (let i = 0; i < topResponses.length; i++) {
      const sections = this.splitIntoSections(topResponses[i].content);
      const responseScore = topResponses[i].score.overallScore;

      for (const section of sections) {
        allSections.push({
          ...section,
          // Boost section score by response quality
          score: section.score * (0.7 + responseScore * 0.3),
          sourceIndex: i,
        });
      }
    }

    if (allSections.length === 0) return null;

    // Group sections by type and pick best of each type
    const byType = new Map<string, ISection[]>();
    for (const section of allSections) {
      const key = section.type;
      if (!byType.has(key)) byType.set(key, []);
      byType.get(key)!.push(section);
    }

    // Build output: use best response as skeleton, patch in better sections
    const bestResponse = topResponses[0].content;
    const bestSections = this.splitIntoSections(bestResponse);

    const output: string[] = [];

    for (const section of bestSections) {
      const sameType = byType.get(section.type) ?? [];
      const betterSection = sameType
        .filter((s) => s.sourceIndex !== 0) // from other responses
        .find((s) => s.score > section.score + 0.15); // meaningfully better

      output.push(betterSection?.content ?? section.content);
    }

    // Check for unique valuable sections in other responses not covered by best
    for (const [type, sections] of byType) {
      if (type === "header") continue; // Don't add extra headers

      const bestHasSameType = bestSections.some((s) => s.type === type);
      if (!bestHasSameType) {
        // Only add if highly scored
        const top = sections[0];
        if (top && top.score > 0.7 && top.sourceIndex !== 0) {
          output.push(top.content);
        }
      }
    }

    return this.ensureCoherence(output.join("\n\n"));
  }

  private splitIntoSections(text: string): Omit<ISection, "sourceIndex">[] {
    const sections: Omit<ISection, "sourceIndex">[] = [];

    // Split by code blocks first
    const parts = text.split(/(```[\s\S]*?```)/);

    for (const part of parts) {
      if (part.startsWith("```")) {
        sections.push({
          content: part.trim(),
          type: "code",
          score: this.scoreSection(part, "code"),
        });
        continue;
      }

      // Split non-code by headers
      const headerParts = part.split(/(?=^#{1,4} )/m);
      for (const hp of headerParts) {
        if (!hp.trim()) continue;

        if (/^#{1,4} /.test(hp)) {
          sections.push({
            content: hp.trim(),
            type: "header",
            score: this.scoreSection(hp, "header"),
          });
        } else if (/^[-*•]\s|^\d+\.\s/m.test(hp)) {
          sections.push({
            content: hp.trim(),
            type: "list",
            score: this.scoreSection(hp, "list"),
          });
        } else if (/^\|.+\|/m.test(hp)) {
          sections.push({
            content: hp.trim(),
            type: "table",
            score: this.scoreSection(hp, "table"),
          });
        } else if (hp.trim()) {
          sections.push({
            content: hp.trim(),
            type: "paragraph",
            score: this.scoreSection(hp, "paragraph"),
          });
        }
      }
    }

    return sections.filter((s) => s.content.length > 10);
  }

  private scoreSection(content: string, type: string): number {
    let score = 0.5;

    // Length heuristic (more complete = better, up to a point)
    const words = content.split(/\s+/).length;
    score += Math.min(words / 100, 0.2);

    if (type === "code") {
      // Code quality signals
      if (/\b(def|function|class|const|let|var)\b/.test(content)) score += 0.1;
      if (!(/\.\.\./.test(content))) score += 0.1; // No ellipsis placeholders
    }

    if (type === "list") {
      // List quality: multiple items
      const items = content.split(/^[-*•\d]/m).filter((i) => i.trim()).length;
      score += Math.min(items / 5, 0.15);
    }

    return Math.min(score, 1.0);
  }

  private ensureCoherence(text: string): string {
    // Remove duplicate blank lines
    const cleaned = text.replace(/\n{3,}/g, "\n\n").trim();

    // Remove orphaned headers at end (no content after)
    return cleaned.replace(/\n#{1,4} [^\n]+\s*$/, "").trim();
  }
}
