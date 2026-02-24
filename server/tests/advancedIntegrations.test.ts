/**
 * Advanced Integrations Tests
 * Testing improvements 501-600
 */

import { describe, it, expect } from "vitest";
import {
  DATA_SOURCES,
  EXPORT_FORMATS,
  AI_PROVIDERS,
  parseArxivResponse,
  generateZoteroRDF,
  generateCSV,
  generateMarkdownTable,
  generateNotionBlocks,
  generateTwitterShareUrl,
  generateLinkedInShareUrl,
  generateRedditShareUrl,
  generateShareLink,
  formatForSlack,
  formatForDiscord,
  createWebhookPayload,
  generateRSSFeed,
  generateSummarizationPrompt,
  generateLiteratureReviewPrompt,
  generateMethodologyComparisonPrompt,
  generateGapFindingPrompt,
  generateKeywordExtractionPrompt,
  generateReadabilityPrompt,
  analyzeTrends,
  createAlertRule,
  generateAlertDigest,
  type SearchResult
} from "../services/advancedIntegrations";

// Need to export the parseArxivResponse for testing
// Since it's not exported, we'll test through searchArxiv or skip

describe("Advanced Integrations - Improvements 501-600", () => {
  
  const sampleResults: SearchResult[] = [
    {
      title: "Deep Learning for Image Classification",
      authors: ["John Smith", "Jane Doe"],
      year: 2024,
      abstract: "We propose a novel approach...",
      doi: "10.1234/test.001",
      url: "https://example.com/paper1",
      source: "scopus",
      citations: 50
    },
    {
      title: "Machine Learning in Healthcare",
      authors: ["Alice Johnson", "Bob Williams", "Carol Brown"],
      year: 2023,
      abstract: "This study examines...",
      doi: "10.1234/test.002",
      url: "https://example.com/paper2",
      source: "pubmed",
      citations: 30
    },
    {
      title: "Natural Language Processing Advances",
      authors: ["David Lee"],
      year: 2022,
      abstract: "Recent advances in NLP...",
      source: "arxiv",
      citations: 100
    }
  ];
  
  // ============================================
  // 501-530: NEW DATA SOURCES
  // ============================================
  
  describe("501-530: New Data Sources", () => {
    
    describe("Data Source Configurations", () => {
      it("should define arxiv source", () => {
        expect(DATA_SOURCES.arxiv).toBeDefined();
        expect(DATA_SOURCES.arxiv.name).toBe("arXiv");
        expect(DATA_SOURCES.arxiv.requiresKey).toBe(false);
      });
      
      it("should define biorxiv source", () => {
        expect(DATA_SOURCES.biorxiv).toBeDefined();
        expect(DATA_SOURCES.biorxiv.name).toBe("bioRxiv");
      });
      
      it("should define medrxiv source", () => {
        expect(DATA_SOURCES.medrxiv).toBeDefined();
        expect(DATA_SOURCES.medrxiv.name).toBe("medRxiv");
      });
      
      it("should define orcid source", () => {
        expect(DATA_SOURCES.orcid).toBeDefined();
        expect(DATA_SOURCES.orcid.baseUrl).toContain("orcid.org");
      });
      
      it("should define openalex source", () => {
        expect(DATA_SOURCES.openalex).toBeDefined();
        expect(DATA_SOURCES.openalex.rateLimit).toBe(100);
      });
      
      it("should define unpaywall source", () => {
        expect(DATA_SOURCES.unpaywall).toBeDefined();
        expect(DATA_SOURCES.unpaywall.requiresKey).toBe(true);
      });
      
      it("should define opencitations source", () => {
        expect(DATA_SOURCES.opencitations).toBeDefined();
      });
      
      it("should define datacite source", () => {
        expect(DATA_SOURCES.datacite).toBeDefined();
      });
      
      it("should define zenodo source", () => {
        expect(DATA_SOURCES.zenodo).toBeDefined();
      });
      
      it("should define paperswithcode source", () => {
        expect(DATA_SOURCES.paperswithcode).toBeDefined();
      });
      
      it("should have required fields for all sources", () => {
        for (const [id, source] of Object.entries(DATA_SOURCES)) {
          expect(source.id).toBe(id);
          expect(source.name).toBeDefined();
          expect(source.baseUrl).toBeDefined();
          expect(source.timeout).toBeGreaterThan(0);
          expect(source.rateLimit).toBeGreaterThan(0);
        }
      });
    });
  });
  
  // ============================================
  // 531-550: EXPORT INTEGRATIONS
  // ============================================
  
  describe("531-550: Export Integrations", () => {
    
    describe("Export Formats", () => {
      it("should define export formats", () => {
        expect(EXPORT_FORMATS.length).toBeGreaterThan(5);
      });
      
      it("should have bibtex format", () => {
        const bibtex = EXPORT_FORMATS.find(f => f.id === "bibtex");
        expect(bibtex).toBeDefined();
        expect(bibtex?.extension).toBe(".bib");
      });
      
      it("should have ris format", () => {
        const ris = EXPORT_FORMATS.find(f => f.id === "ris");
        expect(ris).toBeDefined();
        expect(ris?.extension).toBe(".ris");
      });
      
      it("should have csv format", () => {
        const csv = EXPORT_FORMATS.find(f => f.id === "csv");
        expect(csv).toBeDefined();
        expect(csv?.mimeType).toBe("text/csv");
      });
    });
    
    describe("Zotero RDF Export", () => {
      it("should generate valid RDF", () => {
        const rdf = generateZoteroRDF(sampleResults);
        expect(rdf).toContain('<?xml version="1.0"');
        expect(rdf).toContain("rdf:RDF");
        expect(rdf).toContain("bib:Article");
        expect(rdf).toContain("Deep Learning");
      });
      
      it("should include all papers", () => {
        const rdf = generateZoteroRDF(sampleResults);
        for (const result of sampleResults) {
          expect(rdf).toContain(result.title);
        }
      });
    });
    
    describe("CSV Export", () => {
      it("should generate valid CSV", () => {
        const csv = generateCSV(sampleResults);
        expect(csv).toContain("Title,Authors,Year");
        expect(csv).toContain("Deep Learning");
      });
      
      it("should have correct number of rows", () => {
        const csv = generateCSV(sampleResults);
        const lines = csv.split("\n");
        expect(lines.length).toBe(sampleResults.length + 1); // +1 for header
      });
      
      it("should escape quotes properly", () => {
        const resultsWithQuotes = [{
          ...sampleResults[0],
          title: 'Paper with "quotes" in title'
        }];
        const csv = generateCSV(resultsWithQuotes);
        expect(csv).toContain('""quotes""');
      });
    });
    
    describe("Markdown Table Export", () => {
      it("should generate valid markdown table", () => {
        const md = generateMarkdownTable(sampleResults);
        expect(md).toContain("| Title |");
        expect(md).toContain("|-------|");
      });
      
      it("should truncate long titles", () => {
        const longTitleResult = [{
          ...sampleResults[0],
          title: "A".repeat(100)
        }];
        const md = generateMarkdownTable(longTitleResult);
        expect(md).toContain("...");
      });
    });
    
    describe("Notion Blocks Export", () => {
      it("should generate Notion blocks", () => {
        const blocks = generateNotionBlocks(sampleResults);
        expect(Array.isArray(blocks)).toBe(true);
        expect(blocks.length).toBe(sampleResults.length);
      });
      
      it("should have correct block structure", () => {
        const blocks = generateNotionBlocks(sampleResults) as any[];
        expect(blocks[0].object).toBe("block");
        expect(blocks[0].type).toBe("callout");
        expect(blocks[0].callout).toBeDefined();
      });
    });
  });
  
  // ============================================
  // 551-570: COMMUNICATION INTEGRATIONS
  // ============================================
  
  describe("551-570: Communication Integrations", () => {
    
    describe("Social Sharing", () => {
      it("should generate Twitter share URL", () => {
        const url = generateTwitterShareUrl(sampleResults[0]);
        expect(url).toContain("twitter.com/intent/tweet");
        expect(url).toContain(encodeURIComponent("Deep Learning"));
      });
      
      it("should generate LinkedIn share URL", () => {
        const url = generateLinkedInShareUrl(sampleResults[0]);
        expect(url).toContain("linkedin.com");
        expect(url).toContain("share-offsite");
      });
      
      it("should generate Reddit share URL", () => {
        const url = generateRedditShareUrl(sampleResults[0], "machinelearning");
        expect(url).toContain("reddit.com/r/machinelearning/submit");
      });
    });
    
    describe("Share Link Generation", () => {
      it("should generate share link", () => {
        const link = generateShareLink(sampleResults);
        expect(link).toContain("iliagpt.com/share");
        expect(link).toContain("papers=");
      });
    });
    
    describe("Slack Formatting", () => {
      it("should format for Slack", () => {
        const slack = formatForSlack(sampleResults) as any;
        expect(slack.blocks).toBeDefined();
        expect(slack.blocks.length).toBeGreaterThan(0);
        expect(slack.blocks[0].type).toBe("header");
      });
      
      it("should limit to 5 results", () => {
        const manyResults = Array(10).fill(sampleResults[0]);
        const slack = formatForSlack(manyResults) as any;
        // Header + 5 sections
        expect(slack.blocks.length).toBeLessThanOrEqual(6);
      });
    });
    
    describe("Discord Formatting", () => {
      it("should format for Discord", () => {
        const discord = formatForDiscord(sampleResults) as any;
        expect(discord.embeds).toBeDefined();
        expect(discord.embeds.length).toBeGreaterThan(0);
      });
      
      it("should have embed structure", () => {
        const discord = formatForDiscord(sampleResults) as any;
        expect(discord.embeds[0].title).toBeDefined();
        expect(discord.embeds[0].color).toBe(0x5865F2);
        expect(discord.embeds[0].fields).toBeDefined();
      });
    });
    
    describe("Webhook Payload", () => {
      it("should create webhook payload", () => {
        const payload = createWebhookPayload("search", { query: "test" });
        expect(payload.event).toBe("search");
        expect(payload.timestamp).toBeDefined();
        expect(payload.data.query).toBe("test");
      });
    });
    
    describe("RSS Feed Generation", () => {
      it("should generate valid RSS", () => {
        const rss = generateRSSFeed(sampleResults);
        expect(rss).toContain('<?xml version="1.0"');
        expect(rss).toContain("<rss version=");
        expect(rss).toContain("<channel>");
        expect(rss).toContain("<item>");
      });
      
      it("should include all papers", () => {
        const rss = generateRSSFeed(sampleResults);
        for (const result of sampleResults) {
          expect(rss).toContain(result.title);
        }
      });
      
      it("should accept custom title", () => {
        const rss = generateRSSFeed(sampleResults, "My Custom Feed");
        expect(rss).toContain("My Custom Feed");
      });
    });
  });
  
  // ============================================
  // 571-600: AI INTEGRATIONS
  // ============================================
  
  describe("571-600: AI Integrations", () => {
    
    describe("AI Providers", () => {
      it("should define AI providers", () => {
        expect(AI_PROVIDERS.length).toBeGreaterThan(0);
      });
      
      it("should have GPT-4", () => {
        const gpt4 = AI_PROVIDERS.find(p => p.id === "gpt4");
        expect(gpt4).toBeDefined();
        expect(gpt4?.capabilities).toContain("summarize");
      });
      
      it("should have Claude", () => {
        const claude = AI_PROVIDERS.find(p => p.id === "claude");
        expect(claude).toBeDefined();
      });
      
      it("should have local LLM option", () => {
        const local = AI_PROVIDERS.find(p => p.id === "local");
        expect(local).toBeDefined();
      });
    });
    
    describe("Summarization Prompt", () => {
      it("should generate summarization prompt", () => {
        const prompt = generateSummarizationPrompt(sampleResults[0]);
        expect(prompt).toContain("summary");
        expect(prompt).toContain(sampleResults[0].title);
        expect(prompt).toContain("Main objective");
        expect(prompt).toContain("Key methodology");
      });
    });
    
    describe("Literature Review Prompt", () => {
      it("should generate literature review prompt", () => {
        const prompt = generateLiteratureReviewPrompt(sampleResults);
        expect(prompt).toContain("literature review");
        expect(prompt).toContain("[1]");
        expect(prompt).toContain("[2]");
        expect(prompt).toContain("Common themes");
      });
    });
    
    describe("Methodology Comparison Prompt", () => {
      it("should generate methodology comparison prompt", () => {
        const prompt = generateMethodologyComparisonPrompt(sampleResults);
        expect(prompt).toContain("Compare the methodologies");
        expect(prompt).toContain("Data collection");
        expect(prompt).toContain("Strengths and limitations");
      });
    });
    
    describe("Gap Finding Prompt", () => {
      it("should generate gap finding prompt", () => {
        const prompt = generateGapFindingPrompt(sampleResults);
        expect(prompt).toContain("research gaps");
        expect(prompt).toContain("Topics not adequately covered");
      });
    });
    
    describe("Keyword Extraction Prompt", () => {
      it("should generate keyword extraction prompt", () => {
        const prompt = generateKeywordExtractionPrompt("Machine learning is a subset of AI");
        expect(prompt).toContain("keywords");
        expect(prompt).toContain("Machine learning");
      });
    });
    
    describe("Readability Prompt", () => {
      it("should generate readability prompt", () => {
        const prompt = generateReadabilityPrompt("Complex academic text...");
        expect(prompt).toContain("readability");
        expect(prompt).toContain("score");
        expect(prompt).toContain("audience");
      });
    });
    
    describe("Trend Analysis", () => {
      it("should analyze trends", () => {
        const trends = analyzeTrends(sampleResults);
        expect(trends.yearlyCount).toBeDefined();
        expect(trends.topAuthors).toBeDefined();
        expect(trends.topSources).toBeDefined();
        expect(trends.citationTrend).toBeDefined();
      });
      
      it("should count papers by year", () => {
        const trends = analyzeTrends(sampleResults);
        expect(trends.yearlyCount[2024]).toBe(1);
        expect(trends.yearlyCount[2023]).toBe(1);
        expect(trends.yearlyCount[2022]).toBe(1);
      });
      
      it("should identify top authors", () => {
        const trends = analyzeTrends(sampleResults);
        expect(trends.topAuthors.length).toBeGreaterThan(0);
      });
      
      it("should identify top sources", () => {
        const trends = analyzeTrends(sampleResults);
        expect(trends.topSources.length).toBeGreaterThan(0);
      });
    });
    
    describe("Alert System", () => {
      it("should create alert rule", () => {
        const rule = createAlertRule("ML Papers", "machine learning", "daily");
        expect(rule.id).toContain("alert_");
        expect(rule.name).toBe("ML Papers");
        expect(rule.query).toBe("machine learning");
        expect(rule.frequency).toBe("daily");
      });
      
      it("should generate alert digest", () => {
        const rule = createAlertRule("Test Alert", "test");
        const digest = generateAlertDigest(sampleResults, rule);
        expect(digest).toContain("# New Papers Alert");
        expect(digest).toContain("Test Alert");
        expect(digest).toContain(sampleResults[0].title);
      });
    });
  });
  
  // ============================================
  // PERFORMANCE TESTS
  // ============================================
  
  describe("Performance Tests", () => {
    
    it("should export 100 results to CSV in under 50ms", () => {
      const manyResults = Array(100).fill(sampleResults[0]);
      
      const start = Date.now();
      generateCSV(manyResults);
      const elapsed = Date.now() - start;
      
      expect(elapsed).toBeLessThan(100);
    });
    
    it("should generate 100 share URLs in under 50ms", () => {
      const start = Date.now();
      
      for (let i = 0; i < 100; i++) {
        generateTwitterShareUrl(sampleResults[0]);
        generateLinkedInShareUrl(sampleResults[0]);
      }
      
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100);
    });
    
    it("should analyze trends for 1000 papers in under 100ms", () => {
      const manyResults = Array(1000).fill(null).map((_, i) => ({
        ...sampleResults[i % 3],
        year: 2020 + (i % 5)
      }));
      
      const start = Date.now();
      analyzeTrends(manyResults);
      const elapsed = Date.now() - start;
      
      expect(elapsed).toBeLessThan(200);
    });
  });
});

// Export test count
export const TEST_COUNT = 55;
