/**
 * Capability tests — Research use cases (capability 17-research)
 *
 * Tests cover interview synthesis, multi-channel feedback aggregation,
 * literature review support, and competitive intelligence generation.
 * All data is in-memory; no external API or LLM calls are made.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { assertHasShape } from "../_setup/testHelpers";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

interface InterviewTranscript {
  id: string;
  participant: string;
  role: string;
  duration: number; // minutes
  text: string;
}

interface Theme {
  name: string;
  frequency: number;
  sentiment: "positive" | "neutral" | "negative";
  supportingQuotes: string[];
}

interface SynthesisReport {
  themes: Theme[];
  participantCount: number;
  topQuotes: string[];
  overallSentiment: "positive" | "neutral" | "negative";
}

interface FeedbackSource {
  type: "survey" | "review" | "support_ticket" | "social";
  items: FeedbackItem[];
}

interface FeedbackItem {
  id: string;
  text: string;
  rating?: number; // 1-5
  source: string;
  timestamp: number;
  tags: string[];
}

interface AggregatedFeedback {
  totalItems: number;
  averageRating: number | null;
  bySource: Record<string, { count: number; avgRating: number | null }>;
  topTags: Array<{ tag: string; count: number }>;
  trends: Array<{ period: string; avgRating: number; count: number }>;
}

interface Abstract {
  id: string;
  title: string;
  authors: string[];
  year: number;
  text: string;
  doi?: string;
}

interface LiteratureReview {
  paperCount: number;
  summaries: Array<{ id: string; keyPoints: string[] }>;
  knowledgeGaps: string[];
  citationNetwork: Array<{ source: string; target: string }>;
}

interface CompetitorFeature {
  featureId: string;
  featureName: string;
  competitors: Record<string, "yes" | "no" | "partial" | "unknown">;
}

interface CompetitiveAnalysis {
  comparisonMatrix: CompetitorFeature[];
  swot: {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  };
  positioningStatement: string;
}

// ---------------------------------------------------------------------------
// Research processing utilities
// ---------------------------------------------------------------------------

function extractThemes(transcripts: InterviewTranscript[]): Theme[] {
  const themePatterns: Record<string, { keywords: string[]; sentiment: Theme["sentiment"] }> = {
    "Ease of use": { keywords: ["easy", "simple", "intuitive", "straightforward", "user-friendly"], sentiment: "positive" },
    "Performance concerns": { keywords: ["slow", "lag", "performance", "speed", "timeout"], sentiment: "negative" },
    "Feature requests": { keywords: ["want", "wish", "need", "missing", "add", "feature"], sentiment: "neutral" },
    "Reliability": { keywords: ["reliable", "consistent", "stable", "trust", "dependable"], sentiment: "positive" },
    "Pricing sensitivity": { keywords: ["expensive", "price", "cost", "afford", "budget", "pricing"], sentiment: "negative" },
  };

  const themes: Map<string, Theme> = new Map();

  for (const transcript of transcripts) {
    const sentences = transcript.text.split(/[.!?]+/).filter((s) => s.trim().length > 0);

    for (const [themeName, { keywords, sentiment }] of Object.entries(themePatterns)) {
      for (const sentence of sentences) {
        const lowerSentence = sentence.toLowerCase();
        if (keywords.some((kw) => lowerSentence.includes(kw))) {
          const existing = themes.get(themeName);
          const quote = sentence.trim();

          if (existing) {
            existing.frequency++;
            if (!existing.supportingQuotes.includes(quote)) {
              existing.supportingQuotes.push(quote);
            }
          } else {
            themes.set(themeName, { name: themeName, frequency: 1, sentiment, supportingQuotes: [quote] });
          }
          break; // only match each theme once per sentence
        }
      }
    }
  }

  return [...themes.values()].sort((a, b) => b.frequency - a.frequency);
}

function aggregateFeedback(sources: FeedbackSource[]): AggregatedFeedback {
  const allItems = sources.flatMap((s) => s.items);
  const ratedItems = allItems.filter((i) => i.rating !== undefined);

  const avgRating = ratedItems.length > 0
    ? ratedItems.reduce((sum, i) => sum + (i.rating ?? 0), 0) / ratedItems.length
    : null;

  const bySource: AggregatedFeedback["bySource"] = {};
  for (const source of sources) {
    const sourceRated = source.items.filter((i) => i.rating !== undefined);
    bySource[source.type] = {
      count: source.items.length,
      avgRating: sourceRated.length > 0
        ? parseFloat((sourceRated.reduce((s, i) => s + (i.rating ?? 0), 0) / sourceRated.length).toFixed(2))
        : null,
    };
  }

  const tagCounts: Record<string, number> = {};
  for (const item of allItems) {
    for (const tag of item.tags) {
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    }
  }

  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag, count]) => ({ tag, count }));

  return {
    totalItems: allItems.length,
    averageRating: avgRating !== null ? parseFloat(avgRating.toFixed(2)) : null,
    bySource,
    topTags,
    trends: [], // simplified for unit testing
  };
}

function summariseAbstract(abstract: Abstract): string[] {
  const sentences = abstract.text.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  // Return first 2 sentences as key points (simulating extractive summarisation)
  return sentences.slice(0, 2).map((s) => s.trim());
}

function buildCitationNetwork(abstracts: Abstract[]): Array<{ source: string; target: string }> {
  // Simplified: check if paper title keywords appear in other abstracts
  const edges: Array<{ source: string; target: string }> = [];

  for (const paper of abstracts) {
    const keywords = paper.title.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    for (const other of abstracts) {
      if (other.id === paper.id) continue;
      const referenced = keywords.some((kw) => other.text.toLowerCase().includes(kw));
      if (referenced) {
        edges.push({ source: paper.id, target: other.id });
      }
    }
  }

  return edges;
}

function buildComparisonMatrix(
  features: string[],
  competitors: string[],
  supportMatrix: Record<string, Record<string, "yes" | "no" | "partial">>,
): CompetitorFeature[] {
  return features.map((feature) => ({
    featureId: feature.toLowerCase().replace(/\s+/g, "_"),
    featureName: feature,
    competitors: Object.fromEntries(
      competitors.map((c) => [c, supportMatrix[feature]?.[c] ?? "unknown"]),
    ),
  }));
}

// ---------------------------------------------------------------------------
// Interview synthesis
// ---------------------------------------------------------------------------

describe("Interview synthesis", () => {
  const transcripts: InterviewTranscript[] = [
    {
      id: "t1",
      participant: "P01",
      role: "Product Manager",
      duration: 45,
      text: "The product is very easy to use and intuitive. I love how simple the setup is. I wish they would add more reporting features. The price is a bit expensive for small teams.",
    },
    {
      id: "t2",
      participant: "P02",
      role: "Developer",
      duration: 40,
      text: "Performance is a concern — it gets slow with large datasets. I need better API documentation. The reliability is great though, very dependable. I want more customisation options.",
    },
    {
      id: "t3",
      participant: "P03",
      role: "CTO",
      duration: 50,
      text: "It is intuitive and user-friendly for my team. Pricing is a concern at scale. We trust the system — it is stable and reliable. I need better enterprise features.",
    },
  ];

  it("extracts recurring themes across multiple transcripts", () => {
    const themes = extractThemes(transcripts);

    expect(themes.length).toBeGreaterThan(0);
    themes.forEach((t) =>
      assertHasShape(t, {
        name: "string",
        frequency: "number",
        sentiment: "string",
        supportingQuotes: "array",
      }),
    );
  });

  it("identifies the most frequent theme as the top theme", () => {
    const themes = extractThemes(transcripts);
    const topTheme = themes[0];

    expect(topTheme).toBeDefined();
    expect(topTheme.frequency).toBeGreaterThan(0);
    // Ease of use appears in multiple transcripts
    const easeOfUse = themes.find((t) => t.name === "Ease of use");
    expect(easeOfUse).toBeDefined();
    expect(easeOfUse?.frequency).toBeGreaterThanOrEqual(2);
  });

  it("includes supporting quotes for each extracted theme", () => {
    const themes = extractThemes(transcripts);
    const themeWithQuotes = themes.find((t) => t.supportingQuotes.length > 0);

    expect(themeWithQuotes).toBeDefined();
    themeWithQuotes?.supportingQuotes.forEach((q) => {
      expect(typeof q).toBe("string");
      expect(q.length).toBeGreaterThan(0);
    });
  });

  it("classifies theme sentiment as positive, neutral, or negative", () => {
    const themes = extractThemes(transcripts);
    const validSentiments = new Set(["positive", "neutral", "negative"]);

    themes.forEach((t) => {
      expect(validSentiments.has(t.sentiment)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Multi-channel feedback
// ---------------------------------------------------------------------------

describe("Multi-channel feedback", () => {
  const sources: FeedbackSource[] = [
    {
      type: "survey",
      items: [
        { id: "sv1", text: "Great product!", rating: 5, source: "survey", timestamp: Date.now() - 86400, tags: ["quality", "value"] },
        { id: "sv2", text: "Could be faster.", rating: 3, source: "survey", timestamp: Date.now() - 43200, tags: ["performance"] },
        { id: "sv3", text: "Love the new features.", rating: 4, source: "survey", timestamp: Date.now(), tags: ["features", "quality"] },
      ],
    },
    {
      type: "review",
      items: [
        { id: "rv1", text: "Excellent support team.", rating: 5, source: "review", timestamp: Date.now() - 3600, tags: ["support", "quality"] },
        { id: "rv2", text: "UI needs improvement.", rating: 2, source: "review", timestamp: Date.now(), tags: ["ui"] },
      ],
    },
    {
      type: "support_ticket",
      items: [
        { id: "st1", text: "Bug: export button not working.", source: "support", timestamp: Date.now() - 1800, tags: ["bug", "export"] },
        { id: "st2", text: "Performance degrades with >10k rows.", source: "support", timestamp: Date.now() - 900, tags: ["performance", "bug"] },
      ],
    },
  ];

  it("aggregates feedback items from multiple sources into a single report", () => {
    const report = aggregateFeedback(sources);

    expect(report.totalItems).toBe(7);
    assertHasShape(report, {
      totalItems: "number",
      bySource: "object",
      topTags: "array",
    });
  });

  it("calculates average rating across rated items only", () => {
    const report = aggregateFeedback(sources);

    // support_ticket items have no ratings, so only 5 rated items
    expect(report.averageRating).not.toBeNull();
    expect(report.averageRating as number).toBeGreaterThan(0);
    expect(report.averageRating as number).toBeLessThanOrEqual(5);
  });

  it("identifies the top tags by frequency across all sources", () => {
    const report = aggregateFeedback(sources);

    expect(report.topTags.length).toBeGreaterThan(0);
    expect(report.topTags[0].count).toBeGreaterThanOrEqual(report.topTags[1]?.count ?? 0);

    // "quality" appears 3 times and "performance"/"bug" 2 times each
    const qualityTag = report.topTags.find((t) => t.tag === "quality");
    expect(qualityTag).toBeDefined();
    expect(qualityTag?.count).toBe(3);
  });

  it("breaks down source statistics with per-source counts", () => {
    const report = aggregateFeedback(sources);

    expect(report.bySource.survey.count).toBe(3);
    expect(report.bySource.review.count).toBe(2);
    expect(report.bySource.support_ticket.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Literature review
// ---------------------------------------------------------------------------

describe("Literature review", () => {
  const abstracts: Abstract[] = [
    {
      id: "p1",
      title: "Transformer Models in Natural Language Processing",
      authors: ["Smith, J.", "Doe, A."],
      year: 2023,
      text: "This paper reviews transformer architectures and their applications in natural language processing tasks. The attention mechanism enables models to capture long-range dependencies efficiently.",
      doi: "10.1234/nlp.2023.001",
    },
    {
      id: "p2",
      title: "Scaling Laws for Neural Language Models",
      authors: ["Johnson, R."],
      year: 2024,
      text: "We study scaling laws for transformer language models. Results show that performance improves predictably as model size and training data increase.",
      doi: "10.1234/scaling.2024.002",
    },
    {
      id: "p3",
      title: "Efficient Fine-tuning of Large Language Models",
      authors: ["Lee, K.", "Wang, M."],
      year: 2024,
      text: "This work presents efficient methods for fine-tuning large transformer models with limited compute. The approach achieves strong performance on downstream tasks.",
    },
  ];

  it("summarises abstracts into key points for quick review", () => {
    const summary = summariseAbstract(abstracts[0]);

    expect(summary.length).toBeGreaterThan(0);
    summary.forEach((point) => {
      expect(typeof point).toBe("string");
      expect(point.length).toBeGreaterThan(0);
    });
  });

  it("builds a citation network based on keyword overlap", () => {
    const network = buildCitationNetwork(abstracts);

    expect(Array.isArray(network)).toBe(true);
    network.forEach((edge) =>
      assertHasShape(edge, { source: "string", target: "string" }),
    );
    // transformer keyword appears across multiple papers
    const transformerEdges = network.filter(
      (e) => e.source === "p1" || e.target === "p1",
    );
    expect(transformerEdges.length).toBeGreaterThan(0);
  });

  it("identifies knowledge gaps (topics not covered in the corpus)", () => {
    function identifyKnowledgeGaps(abstracts: Abstract[], domainTopics: string[]): string[] {
      const coveredTopics = new Set<string>();
      const allText = abstracts.map((a) => `${a.title} ${a.text}`).join(" ").toLowerCase();

      for (const topic of domainTopics) {
        if (allText.includes(topic.toLowerCase())) {
          coveredTopics.add(topic);
        }
      }

      return domainTopics.filter((t) => !coveredTopics.has(t));
    }

    const domainTopics = [
      "transformer models",
      "reinforcement learning",
      "multimodal learning",
      "scaling laws",
      "robotics",
    ];

    const gaps = identifyKnowledgeGaps(abstracts, domainTopics);
    expect(gaps).toContain("reinforcement learning");
    expect(gaps).toContain("robotics");
    expect(gaps).not.toContain("scaling laws");
  });
});

// ---------------------------------------------------------------------------
// Competitive intelligence
// ---------------------------------------------------------------------------

describe("Competitive intelligence", () => {
  const features = ["API Access", "SSO Integration", "Custom Workflows", "Mobile App", "Offline Mode"];
  const competitors = ["OurProduct", "CompetitorA", "CompetitorB", "CompetitorC"];

  const supportMatrix: Record<string, Record<string, "yes" | "no" | "partial">> = {
    "API Access": { OurProduct: "yes", CompetitorA: "yes", CompetitorB: "partial", CompetitorC: "no" },
    "SSO Integration": { OurProduct: "yes", CompetitorA: "yes", CompetitorB: "yes", CompetitorC: "no" },
    "Custom Workflows": { OurProduct: "yes", CompetitorA: "partial", CompetitorB: "no", CompetitorC: "yes" },
    "Mobile App": { OurProduct: "no", CompetitorA: "yes", CompetitorB: "yes", CompetitorC: "yes" },
    "Offline Mode": { OurProduct: "no", CompetitorA: "no", CompetitorB: "partial", CompetitorC: "no" },
  };

  it("builds a feature comparison matrix across competitors", () => {
    const matrix = buildComparisonMatrix(features, competitors, supportMatrix);

    expect(matrix).toHaveLength(features.length);
    matrix.forEach((row) =>
      assertHasShape(row, { featureId: "string", featureName: "string", competitors: "object" }),
    );

    const apiRow = matrix.find((r) => r.featureName === "API Access");
    expect(apiRow?.competitors.OurProduct).toBe("yes");
    expect(apiRow?.competitors.CompetitorC).toBe("no");
  });

  it("identifies our product's competitive advantages (yes where competitors have no/partial)", () => {
    const matrix = buildComparisonMatrix(features, competitors, supportMatrix);

    function findAdvantages(matrix: CompetitorFeature[], ourProduct: string): string[] {
      return matrix
        .filter((row) => {
          const ourSupport = row.competitors[ourProduct];
          if (ourSupport !== "yes") return false;
          return Object.entries(row.competitors)
            .filter(([comp]) => comp !== ourProduct)
            .some(([, support]) => support === "no" || support === "partial");
        })
        .map((row) => row.featureName);
    }

    const advantages = findAdvantages(matrix, "OurProduct");
    expect(advantages).toContain("Custom Workflows");
    expect(advantages).not.toContain("Mobile App"); // We don't have mobile app
  });

  it("generates a SWOT analysis from competitive data", () => {
    function generateSWOT(
      matrix: CompetitorFeature[],
      ourProduct: string,
    ): CompetitiveAnalysis["swot"] {
      const strengths: string[] = [];
      const weaknesses: string[] = [];
      const opportunities: string[] = [];
      const threats: string[] = [];

      for (const row of matrix) {
        const ourSupport = row.competitors[ourProduct] ?? "unknown";
        const competitorSupports = Object.entries(row.competitors)
          .filter(([comp]) => comp !== ourProduct)
          .map(([, s]) => s);

        const competitorHasMajority = competitorSupports.filter((s) => s === "yes").length >= 2;

        if (ourSupport === "yes" && !competitorHasMajority) {
          strengths.push(`Differentiated: ${row.featureName}`);
        } else if (ourSupport === "no" && competitorHasMajority) {
          weaknesses.push(`Missing feature: ${row.featureName}`);
          opportunities.push(`Add ${row.featureName} to close competitive gap`);
        }

        if (ourSupport === "yes" && competitorHasMajority) {
          threats.push(`Feature parity risk: ${row.featureName} — competitors are catching up`);
        }
      }

      return { strengths, weaknesses, opportunities, threats };
    }

    const matrix = buildComparisonMatrix(features, competitors, supportMatrix);
    const swot = generateSWOT(matrix, "OurProduct");

    assertHasShape(swot, {
      strengths: "array",
      weaknesses: "array",
      opportunities: "array",
      threats: "array",
    });

    // We have weaknesses because competitors have mobile app
    expect(swot.weaknesses.some((w) => w.includes("Mobile App"))).toBe(true);
    expect(swot.opportunities.some((o) => o.includes("Mobile App"))).toBe(true);
  });
});
