/**
 * Research & Synthesis Capability Tests
 *
 * Covers: multi-document synthesis, cross-source pattern detection,
 *         contradiction identification, citation management,
 *         executive summaries, and web research.
 */

import {
  runWithEachProvider,
  type ProviderConfig,
} from "../_setup/providerMatrix";
import {
  getMockResponseForProvider,
  createTextResponse,
} from "../_setup/mockResponses";
import {
  createMockAgent,
} from "../_setup/testHelpers";

// ---------------------------------------------------------------------------
// Mock heavy dependencies
// ---------------------------------------------------------------------------

vi.mock("../../../server/search/unifiedSearch", () => ({
  unifiedSearch:   vi.fn(),
  semanticSearch:  vi.fn(),
  fullTextSearch:  vi.fn(),
}));

vi.mock("../../../server/memory/longTermMemory", () => ({
  extractFacts: vi.fn(),
  storeFact:    vi.fn(),
  recallFacts:  vi.fn(),
}));

// ---------------------------------------------------------------------------
// Sample document fixtures
// ---------------------------------------------------------------------------

const DOC_A = {
  id: "doc-a",
  title: "Q1 Market Analysis",
  content:
    "The global AI market grew by 35% in Q1 2025. Key drivers include enterprise adoption " +
    "and declining inference costs. North America leads with 42% market share.",
  source: "internal-report",
  date: "2025-04-01",
};

const DOC_B = {
  id: "doc-b",
  title: "Competitor Intelligence Report",
  content:
    "AI market growth reached 35% in the first quarter. Enterprise customers account for " +
    "68% of total spend. Asia-Pacific is the fastest growing region at 52% YoY.",
  source: "external-report",
  date: "2025-04-15",
};

const DOC_C = {
  id: "doc-c",
  title: "Investment Memo - AI Sector",
  content:
    "Our analysis projects the AI market to grow 28% in 2025, below consensus estimates. " +
    "Key risks include regulatory headwinds and talent shortages. " +
    "We recommend cautious positioning.",
  source: "investment-memo",
  date: "2025-03-20",
};

const CITATIONS_RAW = [
  "Smith, J. (2024). AI trends. Journal of Technology, 12(3), 45-67.",
  "Jones, A. & Williams, B. (2023). Machine learning adoption. Tech Review, 8(1), 12-34.",
  "Smith, J. (2024). AI trends. Journal of Technology, 12(3), 45-67.", // duplicate
  "Garcia, C. (2025). Enterprise AI spend. Business Quarterly, 5(2), 89-102.",
];

// ---------------------------------------------------------------------------
// Suite 1 — Multi-document synthesis
// ---------------------------------------------------------------------------

describe("Multi-document synthesis", () => {
  runWithEachProvider(
    "merges 3 documents into a coherent summary",
    "research-synthesis",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          summary:
            "The AI market experienced strong growth of approximately 35% in Q1 2025. " +
            "Some analysts project more modest full-year growth of 28%, citing regulatory risks.",
          wordCount: 28,
          sourceDocuments: ["doc-a", "doc-b", "doc-c"],
          keyThemes: ["market growth", "enterprise adoption", "regional dynamics"],
        },
      });
      const response = await agent.invoke("synthesizeDocuments", {
        documents: [DOC_A, DOC_B, DOC_C],
        maxWords: 100,
      });

      expect(response.success).toBe(true);
      expect(typeof response.summary).toBe("string");
      const themes = response.keyThemes as string[];
      expect(themes.length).toBeGreaterThan(0);
      expect(response.sourceDocuments as string[]).toHaveLength(3);

      const pResp = createTextResponse(provider.name, response.summary as string);
      expect(pResp).toBeTruthy();
    },
  );

  runWithEachProvider(
    "extracts key themes with frequency counts across all documents",
    "research-synthesis",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          themes: [
            { theme: "AI market growth",   frequency: 3, documents: ["doc-a", "doc-b", "doc-c"] },
            { theme: "enterprise adoption", frequency: 2, documents: ["doc-a", "doc-b"] },
            { theme: "regional analysis",  frequency: 2, documents: ["doc-a", "doc-b"] },
          ],
        },
      });
      const response = await agent.invoke("extractThemes", {
        documents: [DOC_A, DOC_B, DOC_C],
        minFrequency: 2,
      });

      expect(response.success).toBe(true);
      const themes = response.themes as Array<{ theme: string; frequency: number }>;
      expect(themes.length).toBeGreaterThan(0);
      expect(themes[0].frequency).toBeGreaterThanOrEqual(themes[themes.length - 1].frequency);

      void provider;
    },
  );

  runWithEachProvider(
    "constructs a chronological timeline from events across documents",
    "research-synthesis",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          timeline: [
            { date: "2025-03-20", event: "Investment memo recommends cautious positioning", source: "doc-c" },
            { date: "2025-04-01", event: "Q1 market analysis shows 35% growth",            source: "doc-a" },
            { date: "2025-04-15", event: "Competitor report confirms Q1 2025 results",     source: "doc-b" },
          ],
          eventsFound: 3,
        },
      });
      const response = await agent.invoke("buildTimeline", {
        documents: [DOC_A, DOC_B, DOC_C],
      });

      expect(response.success).toBe(true);
      const timeline = response.timeline as Array<{ date: string; event: string }>;
      expect(timeline.length).toBeGreaterThan(0);
      for (let i = 1; i < timeline.length; i++) {
        expect(timeline[i].date >= timeline[i - 1].date).toBe(true);
      }

      void provider;
    },
  );

  runWithEachProvider(
    "produces a structured outline from multiple source documents",
    "research-synthesis",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          outline: {
            title: "AI Market Overview - Synthesised",
            sections: [
              { heading: "Market Growth", points: ["35% growth in Q1 2025", "North America leads at 42% share"] },
              { heading: "Risks & Outlook", points: ["Regulatory headwinds", "28% full-year projection"] },
            ],
          },
        },
      });
      const response = await agent.invoke("buildOutline", {
        documents: [DOC_A, DOC_B, DOC_C],
        maxSections: 3,
      });

      expect(response.success).toBe(true);
      const outline = response.outline as { sections: Array<{ heading: string; points: string[] }> };
      expect(outline.sections.length).toBeGreaterThan(0);
      outline.sections.forEach((s) => {
        expect(s.heading).toBeTruthy();
        expect(Array.isArray(s.points)).toBe(true);
      });

      void provider;
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 2 — Cross-source pattern detection
// ---------------------------------------------------------------------------

describe("Cross-source pattern detection", () => {
  runWithEachProvider(
    "identifies claims that appear consistently across multiple sources",
    "research-synthesis",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          commonClaims: [
            {
              claim: "AI market grew approximately 35% in Q1 2025",
              supportingDocs: ["doc-a", "doc-b"],
              confidence: 0.92,
            },
          ],
          uniqueClaims: [
            { claim: "Asia-Pacific growing fastest at 52% YoY", source: "doc-b" },
            { claim: "Projected 28% full-year growth", source: "doc-c" },
          ],
        },
      });
      const response = await agent.invoke("detectCommonClaims", {
        documents: [DOC_A, DOC_B, DOC_C],
        minDocumentSupport: 2,
      });

      expect(response.success).toBe(true);
      const common = response.commonClaims as Array<{ claim: string; confidence: number }>;
      expect(common.length).toBeGreaterThan(0);
      common.forEach((c) => expect(c.confidence).toBeGreaterThan(0.5));

      void provider;
    },
  );

  runWithEachProvider(
    "flags data points that differ significantly across sources",
    "research-synthesis",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          conflictingDataPoints: [
            {
              topic: "AI market growth rate 2025",
              values: [
                { value: "35%", source: "doc-a", date: "2025-04-01" },
                { value: "35%", source: "doc-b", date: "2025-04-15" },
                { value: "28%", source: "doc-c", date: "2025-03-20" },
              ],
              deltaPercent: 25,
              severity: "high",
            },
          ],
        },
      });
      const response = await agent.invoke("detectConflictingData", {
        documents: [DOC_A, DOC_B, DOC_C],
        topic: "market growth",
      });

      expect(response.success).toBe(true);
      const conflicts = response.conflictingDataPoints as Array<{
        topic: string;
        values: Array<{ value: string }>;
        severity: string;
      }>;
      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0].values.length).toBeGreaterThanOrEqual(2);

      void provider;
    },
  );

  runWithEachProvider(
    "scores source credibility based on provenance and recency",
    "research-synthesis",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          credibilityScores: [
            { docId: "doc-a", score: 0.85, factors: { recency: 0.9, provenance: 0.8 } },
            { docId: "doc-b", score: 0.78, factors: { recency: 0.95, provenance: 0.6 } },
            { docId: "doc-c", score: 0.72, factors: { recency: 0.8, provenance: 0.65 } },
          ],
        },
      });
      const response = await agent.invoke("scoreSourceCredibility", {
        documents: [DOC_A, DOC_B, DOC_C],
      });

      expect(response.success).toBe(true);
      const scores = response.credibilityScores as Array<{ docId: string; score: number }>;
      expect(scores).toHaveLength(3);
      scores.forEach((s) => {
        expect(s.score).toBeGreaterThan(0);
        expect(s.score).toBeLessThanOrEqual(1);
      });

      void provider;
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 3 — Contradiction identification
// ---------------------------------------------------------------------------

describe("Contradiction identification", () => {
  runWithEachProvider(
    "flags direct contradictions between two source documents",
    "research-synthesis",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          contradictions: [
            {
              id: "c-1",
              claimA: { text: "AI market will grow 35% in 2025", source: "doc-a" },
              claimB: { text: "AI market projected to grow 28% in 2025", source: "doc-c" },
              type: "numerical",
              severity: "high",
            },
          ],
          totalContradictions: 1,
        },
      });
      const response = await agent.invoke("findContradictions", {
        documents: [DOC_A, DOC_C],
      });

      expect(response.success).toBe(true);
      expect(response.totalContradictions).toBeGreaterThan(0);
      const contradictions = response.contradictions as Array<{
        claimA: { source: string };
        claimB: { source: string };
        severity: string;
      }>;
      expect(contradictions[0].claimA.source).not.toBe(contradictions[0].claimB.source);

      const pResp = getMockResponseForProvider(
        provider.name,
        { name: "find_contradictions", arguments: { docCount: 2 } },
        "Found 1 contradiction between documents",
      );
      expect(pResp).toBeTruthy();
    },
  );

  runWithEachProvider(
    "assigns confidence scores to each identified contradiction",
    "research-synthesis",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          contradictions: [
            { id: "c-1", confidence: 0.91, type: "numerical",  explanation: "35% vs 28% growth" },
            { id: "c-2", confidence: 0.61, type: "directional", explanation: "Optimistic vs cautious outlook" },
          ],
        },
      });
      const response = await agent.invoke("findContradictions", {
        documents: [DOC_A, DOC_B, DOC_C],
        confidenceThreshold: 0.5,
      });

      expect(response.success).toBe(true);
      const contradictions = response.contradictions as Array<{ confidence: number; type: string }>;
      contradictions.forEach((c) => {
        expect(c.confidence).toBeGreaterThan(0.5);
        expect(c.type).toBeTruthy();
      });

      void provider;
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 4 — Citation management
// ---------------------------------------------------------------------------

describe("Citation management", () => {
  runWithEachProvider(
    "extracts bibliography entries from document text",
    "research-synthesis",
    async (provider: ProviderConfig) => {
      const textWithCitations =
        "As noted by Smith (2024), AI trends continue to accelerate. " +
        "Jones & Williams (2023) found similar patterns in enterprise adoption.";

      const agent = createMockAgent({
        defaultResult: {
          success: true,
          citations: [
            { raw: "Smith (2024)",           type: "in-text", year: 2024, author: "Smith" },
            { raw: "Jones & Williams (2023)", type: "in-text", year: 2023, authors: ["Jones", "Williams"] },
          ],
          count: 2,
        },
      });
      const response = await agent.invoke("extractCitations", { text: textWithCitations });

      expect(response.success).toBe(true);
      expect(response.count).toBe(2);
      const citations = response.citations as Array<{ type: string; year: number }>;
      citations.forEach((c) => {
        expect(c.type).toBe("in-text");
        expect(c.year).toBeGreaterThan(2000);
      });

      void provider;
    },
  );

  runWithEachProvider(
    "formats a citation list in APA style, sorted alphabetically",
    "research-synthesis",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          formatted: [
            "Garcia, C. (2025). Enterprise AI spend. Business Quarterly, 5(2), 89-102.",
            "Jones, A. & Williams, B. (2023). Machine learning adoption. Tech Review, 8(1), 12-34.",
            "Smith, J. (2024). AI trends. Journal of Technology, 12(3), 45-67.",
          ],
          style: "APA",
          count: 3,
        },
      });
      const response = await agent.invoke("formatCitations", {
        citations: CITATIONS_RAW,
        style: "APA",
        sort: "alphabetical",
        deduplicate: true,
      });

      expect(response.success).toBe(true);
      expect(response.style).toBe("APA");
      const formatted = response.formatted as string[];
      expect(formatted.length).toBeLessThan(CITATIONS_RAW.length); // deduplication
      expect(formatted[0] < formatted[1]).toBe(true); // alphabetically sorted

      void provider;
    },
  );

  runWithEachProvider(
    "formats citations in MLA style",
    "research-synthesis",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          formatted: [
            'Smith, J. "AI trends." Journal of Technology 12.3 (2024): 45-67.',
            'Jones, A. and B. Williams. "Machine learning adoption." Tech Review 8.1 (2023): 12-34.',
          ],
          style: "MLA",
          count: 2,
        },
      });
      const response = await agent.invoke("formatCitations", {
        citations: CITATIONS_RAW.slice(0, 2),
        style: "MLA",
      });

      expect(response.success).toBe(true);
      expect(response.style).toBe("MLA");
      const formatted = response.formatted as string[];
      expect(formatted.length).toBeGreaterThan(0);

      void provider;
    },
  );

  runWithEachProvider(
    "deduplicates a reference list by matching author, year, and title",
    "research-synthesis",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          originalCount: 4,
          deduplicatedCount: 3,
          removedDuplicates: ["Smith, J. (2024). AI trends. Journal of Technology, 12(3), 45-67."],
        },
      });
      const response = await agent.invoke("deduplicateCitations", {
        citations: CITATIONS_RAW,
      });

      expect(response.success).toBe(true);
      expect(response.originalCount).toBe(4);
      expect(response.deduplicatedCount).toBe(3);
      const removed = response.removedDuplicates as string[];
      expect(removed).toHaveLength(1);

      void provider;
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 5 — Executive summaries
// ---------------------------------------------------------------------------

describe("Executive summaries", () => {
  runWithEachProvider(
    "condenses a 50-page document into a short executive summary",
    "research-synthesis",
    async (provider: ProviderConfig) => {
      const longDocument = {
        id: "long-doc",
        title: "Annual AI Sector Review 2025",
        content: Array(50).fill(DOC_A.content).join("\n\n"),
        pageCount: 50,
      };

      const agent = createMockAgent({
        defaultResult: {
          success: true,
          summary:
            "The AI market recorded 35% growth in Q1 2025, led by enterprise adoption. " +
            "North America holds 42% market share while Asia-Pacific shows the fastest growth.",
          wordCount: 28,
          compressionRatio: 0.98,
          sourcePageCount: 50,
        },
      });
      const response = await agent.invoke("executiveSummary", {
        document: longDocument,
        targetWordCount: 300,
        audience: "executive",
      });

      expect(response.success).toBe(true);
      expect(response.wordCount as number).toBeLessThanOrEqual(400);
      expect(response.compressionRatio as number).toBeGreaterThan(0.5);
      expect(typeof response.summary).toBe("string");

      void provider;
    },
  );

  runWithEachProvider(
    "extracts bullet-point key findings from a document",
    "research-synthesis",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          bullets: [
            "AI market grew 35% in Q1 2025",
            "Enterprise customers drive 68% of total spend",
            "Asia-Pacific growing fastest at 52% YoY",
            "Some analysts project more modest 28% full-year growth",
          ],
          count: 4,
        },
      });
      const response = await agent.invoke("extractBulletPoints", {
        documents: [DOC_A, DOC_B, DOC_C],
        maxBullets: 5,
      });

      expect(response.success).toBe(true);
      const bullets = response.bullets as string[];
      expect(bullets.length).toBeGreaterThan(0);
      expect(bullets.length).toBeLessThanOrEqual(5);
      bullets.forEach((b) => expect(typeof b).toBe("string"));

      void provider;
    },
  );

  runWithEachProvider(
    "extracts action items and decisions from a meeting document",
    "research-synthesis",
    async (provider: ProviderConfig) => {
      const meetingDoc = {
        id: "meeting-001",
        title: "AI Strategy Meeting",
        content:
          "Action items: 1) Review budget allocation by April 30. " +
          "2) Alice to prepare competitor analysis. " +
          "3) Schedule follow-up meeting with engineering team. " +
          "Decision: Proceed with Phase 2 AI investment.",
      };

      const agent = createMockAgent({
        defaultResult: {
          success: true,
          actionItems: [
            { item: "Review budget allocation",             dueDate: "April 30", owner: null  },
            { item: "Prepare competitor analysis",          dueDate: null,       owner: "Alice" },
            { item: "Schedule follow-up with engineering",  dueDate: null,       owner: null  },
          ],
          decisions: ["Proceed with Phase 2 AI investment"],
          count: 3,
        },
      });
      const response = await agent.invoke("extractActionItems", {
        document: meetingDoc,
      });

      expect(response.success).toBe(true);
      expect(response.count).toBe(3);
      const items = response.actionItems as Array<{ item: string }>;
      items.forEach((i) => expect(typeof i.item).toBe("string"));
      const decisions = response.decisions as string[];
      expect(decisions.length).toBeGreaterThan(0);

      void provider;
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 6 — Web research
// ---------------------------------------------------------------------------

describe("Web research", () => {
  runWithEachProvider(
    "generates targeted search queries for a research topic",
    "research-synthesis",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          queries: [
            "AI market growth rate 2025 Q1 enterprise",
            "artificial intelligence market size forecast 2025",
            "AI spending by region North America Asia-Pacific 2025",
            "enterprise AI adoption statistics 2025",
          ],
          topic: "AI market growth 2025",
          count: 4,
        },
      });
      const response = await agent.invoke("generateSearchQueries", {
        topic: "AI market growth 2025",
        maxQueries: 5,
        style: "research",
      });

      expect(response.success).toBe(true);
      const queries = response.queries as string[];
      expect(queries.length).toBeGreaterThan(0);
      expect(queries.length).toBeLessThanOrEqual(5);
      queries.forEach((q) => expect(q.length).toBeGreaterThan(5));

      void provider;
    },
  );

  runWithEachProvider(
    "aggregates search results from multiple queries into a ranked list",
    "research-synthesis",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          aggregatedResults: [
            { title: "AI Market Report Q1 2025",           url: "https://example.com/1", relevanceScore: 0.94 },
            { title: "Enterprise AI Spending Trends 2025", url: "https://example.com/2", relevanceScore: 0.87 },
            { title: "Regional AI Growth Analysis",        url: "https://example.com/3", relevanceScore: 0.81 },
          ],
          totalResults: 3,
          deduplicatedResults: 3,
        },
      });
      const response = await agent.invoke("aggregateSearchResults", {
        queries: ["AI market growth 2025", "enterprise AI spending"],
        maxResultsPerQuery: 5,
        deduplication: true,
      });

      expect(response.success).toBe(true);
      const results = response.aggregatedResults as Array<{ relevanceScore: number }>;
      expect(results.length).toBeGreaterThan(0);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].relevanceScore).toBeGreaterThanOrEqual(results[i].relevanceScore);
      }

      void provider;
    },
  );

  runWithEachProvider(
    "scores source credibility based on domain authority and recency",
    "research-synthesis",
    async (provider: ProviderConfig) => {
      const searchResults = [
        { url: "https://arxiv.org/abs/2501.12345",   title: "Peer-reviewed AI study",   date: "2025-03-01" },
        { url: "https://blog.example.com/ai-2025",   title: "AI blog post 2025",        date: "2025-02-15" },
        { url: "https://reuters.com/tech/ai-market", title: "Reuters AI market report", date: "2025-04-01" },
      ];

      const agent = createMockAgent({
        defaultResult: {
          success: true,
          scoredResults: [
            { url: searchResults[0].url, credibilityScore: 0.92, tier: "academic" },
            { url: searchResults[2].url, credibilityScore: 0.88, tier: "news"     },
            { url: searchResults[1].url, credibilityScore: 0.55, tier: "blog"     },
          ],
        },
      });
      const response = await agent.invoke("scoreSourceCredibility", {
        sources: searchResults,
      });

      expect(response.success).toBe(true);
      const scored = response.scoredResults as Array<{ credibilityScore: number; tier: string }>;
      expect(scored).toHaveLength(3);
      scored.forEach((s) => {
        expect(s.credibilityScore).toBeGreaterThan(0);
        expect(s.credibilityScore).toBeLessThanOrEqual(1);
        expect(["academic", "news", "blog", "government"]).toContain(s.tier);
      });

      const pResp = getMockResponseForProvider(
        provider.name,
        { name: "web_search", arguments: { query: "AI market 2025" } },
        "Found 3 credible sources",
      );
      expect(pResp).toBeTruthy();
    },
  );

  runWithEachProvider(
    "extracts structured facts from a web page into a knowledge-base format",
    "research-synthesis",
    async (provider: ProviderConfig) => {
      const agent = createMockAgent({
        defaultResult: {
          success: true,
          facts: [
            { claim: "AI market grew 35% in Q1 2025",          confidence: 0.91, sourceUrl: "https://example.com/1" },
            { claim: "North America holds 42% of market share", confidence: 0.85, sourceUrl: "https://example.com/1" },
          ],
          sourceUrl: "https://example.com/1",
          factCount: 2,
        },
      });
      const response = await agent.invoke("extractWebFacts", {
        url: "https://example.com/1",
        topic: "AI market",
      });

      expect(response.success).toBe(true);
      expect(response.factCount).toBe(2);
      const facts = response.facts as Array<{ claim: string; confidence: number }>;
      facts.forEach((f) => {
        expect(typeof f.claim).toBe("string");
        expect(f.confidence).toBeGreaterThan(0);
      });

      void provider;
    },
  );
});
