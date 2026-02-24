import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  recordQualityMetric,
  getQualityStats,
  getRecentMetrics,
  getMetricsForProvider,
  getLowQualityResponses,
  clearMetrics,
  getRunningAverageScore,
  resetRunningStats,
} from "./qualityMetrics";

function makeMetric(overrides: Partial<{
  responseId: string;
  provider: string;
  score: number;
  tokensUsed: number;
  latencyMs: number;
  timestamp: Date;
  issues: string[];
  isComplete: boolean;
  hasContentIssues: boolean;
}> = {}) {
  return {
    responseId: overrides.responseId ?? "resp-1",
    provider: overrides.provider ?? "openai",
    score: overrides.score ?? 85,
    tokensUsed: overrides.tokensUsed ?? 100,
    latencyMs: overrides.latencyMs ?? 200,
    timestamp: overrides.timestamp ?? new Date(),
    issues: overrides.issues ?? [],
    isComplete: overrides.isComplete,
    hasContentIssues: overrides.hasContentIssues,
  };
}

describe("qualityMetrics", () => {
  beforeEach(() => {
    clearMetrics();
    resetRunningStats();
  });

  it("should record a metric and retrieve it via getRecentMetrics", () => {
    const metric = makeMetric({ responseId: "r1" });
    recordQualityMetric(metric);

    const recent = getRecentMetrics();
    expect(recent).toHaveLength(1);
    expect(recent[0].responseId).toBe("r1");
  });

  it("getQualityStats should return zeroed stats when no metrics recorded", () => {
    const stats = getQualityStats();
    expect(stats.totalResponses).toBe(0);
    expect(stats.averageScore).toBe(0);
    expect(stats.scoreDistribution.excellent).toBe(0);
  });

  it("getQualityStats should compute correct averages", () => {
    recordQualityMetric(makeMetric({ score: 80, tokensUsed: 100, latencyMs: 200 }));
    recordQualityMetric(makeMetric({ score: 60, tokensUsed: 200, latencyMs: 400 }));

    const stats = getQualityStats();
    expect(stats.totalResponses).toBe(2);
    expect(stats.averageScore).toBe(70);
    expect(stats.averageTokens).toBe(150);
    expect(stats.averageLatency).toBe(300);
  });

  it("should categorize score distribution correctly", () => {
    recordQualityMetric(makeMetric({ score: 95 }));  // excellent (>=90)
    recordQualityMetric(makeMetric({ score: 75 }));  // good (>=70)
    recordQualityMetric(makeMetric({ score: 55 }));  // fair (>=50)
    recordQualityMetric(makeMetric({ score: 30 }));  // poor (<50)

    const stats = getQualityStats();
    expect(stats.scoreDistribution.excellent).toBe(1);
    expect(stats.scoreDistribution.good).toBe(1);
    expect(stats.scoreDistribution.fair).toBe(1);
    expect(stats.scoreDistribution.poor).toBe(1);
  });

  it("should compute per-provider stats", () => {
    recordQualityMetric(makeMetric({ provider: "openai", score: 90 }));
    recordQualityMetric(makeMetric({ provider: "openai", score: 80 }));
    recordQualityMetric(makeMetric({ provider: "anthropic", score: 70 }));

    const stats = getQualityStats();
    expect(stats.byProvider["openai"].count).toBe(2);
    expect(stats.byProvider["openai"].averageScore).toBe(85);
    expect(stats.byProvider["anthropic"].count).toBe(1);
    expect(stats.byProvider["anthropic"].averageScore).toBe(70);
  });

  it("getMetricsForProvider should filter by provider", () => {
    recordQualityMetric(makeMetric({ provider: "openai", responseId: "r1" }));
    recordQualityMetric(makeMetric({ provider: "anthropic", responseId: "r2" }));
    recordQualityMetric(makeMetric({ provider: "openai", responseId: "r3" }));

    const openaiMetrics = getMetricsForProvider("openai");
    expect(openaiMetrics).toHaveLength(2);
    expect(openaiMetrics.every((m) => m.provider === "openai")).toBe(true);
  });

  it("getLowQualityResponses should return metrics below threshold", () => {
    recordQualityMetric(makeMetric({ score: 30, responseId: "low1" }));
    recordQualityMetric(makeMetric({ score: 90, responseId: "high1" }));
    recordQualityMetric(makeMetric({ score: 45, responseId: "low2" }));

    const lowQuality = getLowQualityResponses(50);
    expect(lowQuality).toHaveLength(2);
    expect(lowQuality.map((m) => m.responseId).sort()).toEqual(["low1", "low2"]);
  });

  it("clearMetrics should reset everything", () => {
    recordQualityMetric(makeMetric());
    recordQualityMetric(makeMetric());
    clearMetrics();

    expect(getRecentMetrics()).toHaveLength(0);
    expect(getQualityStats().totalResponses).toBe(0);
  });

  it("getRunningAverageScore should reflect recorded metrics", () => {
    expect(getRunningAverageScore()).toBe(0);

    recordQualityMetric(makeMetric({ score: 80 }));
    recordQualityMetric(makeMetric({ score: 60 }));
    expect(getRunningAverageScore()).toBe(70);
  });

  it("resetRunningStats should clear running average but not history", () => {
    recordQualityMetric(makeMetric({ score: 80 }));
    resetRunningStats();

    expect(getRunningAverageScore()).toBe(0);
    // History is still intact
    expect(getRecentMetrics()).toHaveLength(1);
  });

  it("should track issue frequency in stats", () => {
    recordQualityMetric(makeMetric({ issues: ["truncated", "hallucination"] }));
    recordQualityMetric(makeMetric({ issues: ["truncated"] }));

    const stats = getQualityStats();
    expect(stats.issueFrequency["truncated"]).toBe(2);
    expect(stats.issueFrequency["hallucination"]).toBe(1);
  });
});
