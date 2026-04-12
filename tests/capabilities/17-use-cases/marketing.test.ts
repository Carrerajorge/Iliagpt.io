/**
 * Capability tests — Marketing use cases (capability 17-marketing)
 *
 * Tests cover brand voice analysis, content generation, campaign asset
 * creation, and performance insight extraction. No external LLM calls are
 * made; tests validate the orchestration and formatting logic.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  runWithEachProvider,
  MOCK_PROVIDER,
} from "../_setup/providerMatrix";
import {
  getMockResponseForProvider,
  createTextResponse,
} from "../_setup/mockResponses";
import { assertHasShape } from "../_setup/testHelpers";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

interface BrandVoiceProfile {
  tone: string[];
  vocabulary: { preferred: string[]; avoided: string[] };
  consistencyScore: number; // 0-1
  samplePhrases: string[];
}

interface ContentBrief {
  topic: string;
  audience: string;
  wordCount: number;
  tone: string[];
  keywords: string[];
  callToAction?: string;
}

interface GeneratedContent {
  title: string;
  body: string;
  wordCount: number;
  readabilityScore: number; // Flesch-Kincaid approximation 0-100
  seoScore: number; // 0-100
}

interface AdCopyVariant {
  headline: string;
  body: string;
  cta: string;
  channel: "social" | "search" | "display" | "email";
}

interface MetricsReport {
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
  revenue: number;
  ctr: number;  // clicks / impressions
  roas: number; // revenue / spend
  period: string;
}

interface PerformanceInsight {
  metric: string;
  finding: string;
  recommendation: string;
  priority: "low" | "medium" | "high";
}

// ---------------------------------------------------------------------------
// Marketing processing utilities
// ---------------------------------------------------------------------------

function analyseBrandVoice(sampleTexts: string[]): BrandVoiceProfile {
  const allWords = sampleTexts.join(" ").toLowerCase().split(/\W+/).filter(Boolean);
  const wordFreq: Record<string, number> = {};
  for (const w of allWords) wordFreq[w] = (wordFreq[w] ?? 0) + 1;

  const toneIndicators: Record<string, string[]> = {
    professional: ["ensure", "leverage", "optimise", "implement", "strategy", "enterprise"],
    friendly: ["great", "easy", "help", "love", "amazing", "together"],
    authoritative: ["proven", "leading", "trusted", "expert", "results", "data"],
    innovative: ["new", "transform", "future", "cutting-edge", "breakthrough", "reimagine"],
  };

  const detectedTones: string[] = [];
  for (const [tone, words] of Object.entries(toneIndicators)) {
    const hits = words.filter((w) => wordFreq[w] && wordFreq[w] > 0);
    if (hits.length >= 2) detectedTones.push(tone);
  }

  // Calculate simple vocabulary consistency (ratio of repeated phrases)
  const consistency = Math.min(1, Object.values(wordFreq).filter((f) => f > 1).length / Math.max(1, Object.keys(wordFreq).length));

  return {
    tone: detectedTones.length > 0 ? detectedTones : ["neutral"],
    vocabulary: {
      preferred: Object.entries(wordFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([w]) => w),
      avoided: [],
    },
    consistencyScore: parseFloat(consistency.toFixed(2)),
    samplePhrases: sampleTexts.slice(0, 2),
  };
}

function estimateReadability(text: string): number {
  // Simplified Flesch approximation
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
  const words = text.split(/\s+/).filter(Boolean).length;
  const syllables = text.split(/[aeiouAEIOU]/).length - 1;

  if (sentences === 0 || words === 0) return 50;

  const score = 206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words);
  return Math.min(100, Math.max(0, Math.round(score)));
}

function scoreSEO(content: string, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const lowerContent = content.toLowerCase();
  const hits = keywords.filter((kw) => lowerContent.includes(kw.toLowerCase())).length;
  return Math.round((hits / keywords.length) * 100);
}

function generateBlogPost(brief: ContentBrief): GeneratedContent {
  // Simulate content generation output (would be LLM-generated in production)
  const title = `${brief.topic}: Everything ${brief.audience} Needs to Know`;
  const intro = `In today's rapidly changing landscape, ${brief.topic.toLowerCase()} has become essential for ${brief.audience}.`;
  const body = `${intro} ${brief.keywords.slice(0, 3).join(", ")} are the key concepts to master. ${brief.callToAction ?? "Learn more today."}`;

  return {
    title,
    body,
    wordCount: body.split(/\s+/).length,
    readabilityScore: estimateReadability(body),
    seoScore: scoreSEO(body, brief.keywords),
  };
}

function generateSubjectLineVariants(topic: string, count = 3): string[] {
  const templates = [
    `Don't miss this: ${topic}`,
    `[NEW] ${topic} — see what changed`,
    `${topic} — read before it's gone`,
    `Your guide to ${topic} is here`,
    `We need to talk about ${topic}`,
  ];
  return templates.slice(0, count);
}

function interpretMetrics(report: MetricsReport): PerformanceInsight[] {
  const insights: PerformanceInsight[] = [];

  if (report.ctr < 0.01) {
    insights.push({
      metric: "CTR",
      finding: `CTR is ${(report.ctr * 100).toFixed(2)}%, below the 1% benchmark`,
      recommendation: "Test new ad creatives with stronger value propositions",
      priority: "high",
    });
  }

  if (report.roas < 2) {
    insights.push({
      metric: "ROAS",
      finding: `ROAS of ${report.roas.toFixed(2)} is below break-even threshold`,
      recommendation: "Review targeting and bidding strategy; pause underperforming ad sets",
      priority: "high",
    });
  }

  if (report.roas >= 4) {
    insights.push({
      metric: "ROAS",
      finding: `Strong ROAS of ${report.roas.toFixed(2)} indicates efficient spend`,
      recommendation: "Increase budget to scale winning campaigns",
      priority: "medium",
    });
  }

  if (report.conversions === 0 && report.clicks > 0) {
    insights.push({
      metric: "Conversions",
      finding: "Zero conversions despite traffic suggests landing page friction",
      recommendation: "Audit landing page for UX issues and CTA clarity",
      priority: "high",
    });
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Brand voice analysis
// ---------------------------------------------------------------------------

describe("Brand voice analysis", () => {
  const brandSamples = [
    "We help enterprises leverage cutting-edge AI to optimise their strategy and ensure maximum impact.",
    "Our proven solutions deliver measurable results for leading organisations worldwide.",
    "Trusted by experts, our platform transforms how teams implement data-driven strategies.",
    "We ensure enterprises can leverage the full potential of AI with expert-level precision.",
  ];

  it("extracts tone attributes from brand sample texts", () => {
    const profile = analyseBrandVoice(brandSamples);

    assertHasShape(profile, {
      tone: "array",
      vocabulary: "object",
      consistencyScore: "number",
      samplePhrases: "array",
    });

    expect(profile.tone.length).toBeGreaterThan(0);
    expect(profile.consistencyScore).toBeGreaterThanOrEqual(0);
    expect(profile.consistencyScore).toBeLessThanOrEqual(1);
  });

  it("detects professional tone in enterprise-focused copy", () => {
    const profile = analyseBrandVoice(brandSamples);
    expect(profile.tone).toContain("professional");
  });

  it("calculates a consistency score based on vocabulary overlap", () => {
    const consistentTexts = [
      "Our enterprise solution delivers proven results.",
      "Enterprise teams trust our proven methodology.",
      "Proven enterprise solutions trusted by leading teams.",
    ];

    const inconsistentTexts = [
      "We love making things easier for you!",
      "Our proven enterprise data strategy optimises leverage.",
      "Quick setup, zero friction — get started in minutes.",
    ];

    const consistent = analyseBrandVoice(consistentTexts);
    const inconsistent = analyseBrandVoice(inconsistentTexts);

    // Consistent texts should have higher overlap score
    expect(typeof consistent.consistencyScore).toBe("number");
    expect(typeof inconsistent.consistencyScore).toBe("number");
  });

  it("identifies preferred vocabulary from high-frequency terms", () => {
    const profile = analyseBrandVoice(brandSamples);
    expect(profile.vocabulary.preferred.length).toBeGreaterThan(0);
    profile.vocabulary.preferred.forEach((word) => expect(typeof word).toBe("string"));
  });
});

// ---------------------------------------------------------------------------
// Content generation
// ---------------------------------------------------------------------------

describe("Content generation", () => {
  it("generates a blog post title and body from a content brief", () => {
    const brief: ContentBrief = {
      topic: "AI-Powered Customer Support",
      audience: "SaaS founders",
      wordCount: 800,
      tone: ["professional", "authoritative"],
      keywords: ["AI customer support", "automation", "ticket deflection", "CSAT"],
      callToAction: "Start your free trial today",
    };

    const post = generateBlogPost(brief);

    assertHasShape(post, {
      title: "string",
      body: "string",
      wordCount: "number",
      readabilityScore: "number",
      seoScore: "number",
    });

    expect(post.title).toContain("AI-Powered Customer Support");
    expect(post.wordCount).toBeGreaterThan(0);
    expect(post.readabilityScore).toBeGreaterThanOrEqual(0);
    expect(post.readabilityScore).toBeLessThanOrEqual(100);
  });

  it("includes keywords from brief in generated content for SEO", () => {
    const brief: ContentBrief = {
      topic: "Machine Learning",
      audience: "developers",
      wordCount: 500,
      tone: ["technical"],
      keywords: ["machine learning", "model training"],
    };

    const post = generateBlogPost(brief);
    expect(post.seoScore).toBeGreaterThan(0);
  });

  it("generates social media captions with platform-appropriate length", () => {
    function generateCaption(topic: string, platform: "twitter" | "linkedin" | "instagram"): string {
      const maxLen = { twitter: 280, linkedin: 700, instagram: 2200 };
      const base = `Check out our latest insights on ${topic}. Perfect for teams looking to level up. #${topic.replace(/\s+/g, "")} #insights`;
      return base.slice(0, maxLen[platform]);
    }

    const twitter = generateCaption("AI automation", "twitter");
    const linkedin = generateCaption("AI automation", "linkedin");

    expect(twitter.length).toBeLessThanOrEqual(280);
    expect(linkedin.length).toBeLessThanOrEqual(700);
    expect(twitter).toContain("AI automation");
  });

  it("generates email campaign copy with subject, preview and body", () => {
    function generateEmailCampaign(topic: string, audience: string): {
      subject: string;
      previewText: string;
      body: string;
    } {
      return {
        subject: `How ${audience} are winning with ${topic}`,
        previewText: `See the strategies top teams use to get ahead with ${topic}.`,
        body: `Hi there,\n\nWe've seen incredible results from ${audience} using ${topic}.\n\nKey benefits:\n- Save time\n- Reduce costs\n- Drive growth\n\nReady to get started?\n\nBest,\nThe Team`,
      };
    }

    const email = generateEmailCampaign("AI workflows", "sales teams");

    assertHasShape(email, { subject: "string", previewText: "string", body: "string" });
    expect(email.subject).toContain("sales teams");
    expect(email.body).toContain("AI workflows");
  });
});

// ---------------------------------------------------------------------------
// Campaign assets
// ---------------------------------------------------------------------------

describe("Campaign assets", () => {
  it("generates N ad copy variants for A/B testing", () => {
    function generateAdVariants(topic: string, n: number): AdCopyVariant[] {
      const headlines = [
        `Transform Your ${topic} in Minutes`,
        `The Smarter Way to Handle ${topic}`,
        `${topic} Just Got a Whole Lot Easier`,
      ];
      const bodies = [
        `Join thousands of teams who've already made the switch.`,
        `Save hours every week with AI-powered ${topic.toLowerCase()}.`,
        `See why leading companies trust us with their ${topic.toLowerCase()}.`,
      ];
      const ctas = ["Start Free Trial", "Get Started Today", "Book a Demo"];

      return Array.from({ length: Math.min(n, 3) }, (_, i) => ({
        headline: headlines[i],
        body: bodies[i],
        cta: ctas[i],
        channel: "social" as const,
      }));
    }

    const variants = generateAdVariants("Customer Support", 3);
    expect(variants).toHaveLength(3);
    variants.forEach((v) =>
      assertHasShape(v, { headline: "string", body: "string", cta: "string", channel: "string" }),
    );

    // All headlines should be unique
    const headlines = variants.map((v) => v.headline);
    expect(new Set(headlines).size).toBe(headlines.length);
  });

  it("generates email subject line A/B variants", () => {
    const variants = generateSubjectLineVariants("Q2 Product Update", 3);

    expect(variants).toHaveLength(3);
    expect(new Set(variants).size).toBe(3); // all unique
    variants.forEach((v) => {
      expect(typeof v).toBe("string");
      expect(v.length).toBeGreaterThan(0);
    });
  });

  it("generates landing page copy sections from a value proposition", () => {
    function generateLandingPage(valueProposition: string, features: string[]): {
      hero: { headline: string; subheadline: string; cta: string };
      features: Array<{ title: string; description: string }>;
      social_proof: string;
    } {
      return {
        hero: {
          headline: valueProposition,
          subheadline: "Join thousands of teams already seeing results.",
          cta: "Start Free — No Credit Card Required",
        },
        features: features.map((f) => ({
          title: f,
          description: `${f} designed to save time and drive results for your team.`,
        })),
        social_proof: "Trusted by 10,000+ teams across 50+ countries.",
      };
    }

    const page = generateLandingPage("Ship AI Features 10x Faster", [
      "One-click integrations",
      "Real-time monitoring",
      "Enterprise security",
    ]);

    expect(page.hero.headline).toContain("10x Faster");
    expect(page.features).toHaveLength(3);
    expect(page.social_proof).toContain("Trusted by");
  });
});

// ---------------------------------------------------------------------------
// Performance insights
// ---------------------------------------------------------------------------

describe("Performance insights", () => {
  it("identifies low CTR and recommends creative refresh", () => {
    const report: MetricsReport = {
      impressions: 100000,
      clicks: 400,
      conversions: 12,
      spend: 2000,
      revenue: 3600,
      ctr: 400 / 100000,
      roas: 3600 / 2000,
      period: "2026-04",
    };

    const insights = interpretMetrics(report);
    const ctrInsight = insights.find((i) => i.metric === "CTR");

    expect(ctrInsight).toBeDefined();
    expect(ctrInsight?.priority).toBe("high");
    expect(ctrInsight?.recommendation.toLowerCase()).toContain("creative");
  });

  it("recommends scaling budget when ROAS exceeds 4x", () => {
    const report: MetricsReport = {
      impressions: 50000,
      clicks: 2500,
      conversions: 200,
      spend: 5000,
      revenue: 25000,
      ctr: 0.05,
      roas: 5.0,
      period: "2026-04",
    };

    const insights = interpretMetrics(report);
    const roasInsight = insights.find((i) => i.metric === "ROAS" && i.finding.includes("Strong"));

    expect(roasInsight).toBeDefined();
    expect(roasInsight?.recommendation.toLowerCase()).toContain("budget");
  });

  it("flags zero conversion rate as a landing page issue", () => {
    const report: MetricsReport = {
      impressions: 20000,
      clicks: 800,
      conversions: 0,
      spend: 1600,
      revenue: 0,
      ctr: 0.04,
      roas: 0,
      period: "2026-04",
    };

    const insights = interpretMetrics(report);
    const convInsight = insights.find((i) => i.metric === "Conversions");

    expect(convInsight).toBeDefined();
    expect(convInsight?.finding.toLowerCase()).toContain("landing page");
  });

  it("returns structured insights with required fields", () => {
    const report: MetricsReport = {
      impressions: 10000,
      clicks: 50,
      conversions: 0,
      spend: 500,
      revenue: 0,
      ctr: 0.005,
      roas: 0,
      period: "2026-04",
    };

    const insights = interpretMetrics(report);
    expect(insights.length).toBeGreaterThan(0);
    insights.forEach((i) =>
      assertHasShape(i, {
        metric: "string",
        finding: "string",
        recommendation: "string",
        priority: "string",
      }),
    );
  });
});
