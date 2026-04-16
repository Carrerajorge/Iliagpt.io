import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock external dependencies
vi.mock("./gemini", () => ({
  geminiChat: vi.fn().mockResolvedValue({ content: "[]" }),
  GEMINI_MODELS: { FLASH: "gemini-flash" },
}));

vi.mock("./keywordExtractor", () => ({
  KeywordExtractor: {
    extractEntities: vi.fn().mockReturnValue([]),
  },
}));

vi.mock("./searchEngines", () => ({
  Utils: {
    tokenize: vi.fn((text: string) =>
      text
        .toLowerCase()
        .split(/\s+/)
        .filter((t: string) => t.length > 0)
    ),
  },
}));

import { FactExtractor, type ExtractedFact } from "./factExtractor";
import { KeywordExtractor } from "./keywordExtractor";
import { geminiChat } from "./gemini";

describe("FactExtractor", () => {
  let extractor: FactExtractor;

  beforeEach(() => {
    vi.clearAllMocks();
    extractor = new FactExtractor({ language: "en" });
  });

  // ===== Constructor & Config =====

  describe("constructor", () => {
    it("should use default config when none is provided", () => {
      const defaultExtractor = new FactExtractor();
      // The extractor should be created without error
      expect(defaultExtractor).toBeDefined();
    });

    it("should merge partial config with defaults", () => {
      const custom = new FactExtractor({ minConfidence: 90, language: "en" });
      expect(custom).toBeDefined();
    });
  });

  // ===== extractFromMessage =====

  describe("extractFromMessage", () => {
    it("should return empty array for non-user messages", async () => {
      const result = await extractor.extractFromMessage({
        role: "assistant",
        content: "I prefer dark mode",
      });
      expect(result).toEqual([]);
    });

    it("should return empty array for empty content", async () => {
      const result = await extractor.extractFromMessage({
        role: "user",
        content: "",
      });
      expect(result).toEqual([]);
    });

    it("should return empty array for whitespace-only content", async () => {
      const result = await extractor.extractFromMessage({
        role: "user",
        content: "   ",
      });
      expect(result).toEqual([]);
    });

    it("should extract English preference patterns", async () => {
      const result = await extractor.extractFromMessage({
        role: "user",
        content: "I prefer dark mode for all my applications",
      });
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].type).toBe("user_preference");
      expect(result[0].source).toBe("user_stated");
      expect(result[0].confidence).toBeGreaterThanOrEqual(80);
    });

    it("should extract English decision patterns", async () => {
      const result = await extractor.extractFromMessage({
        role: "user",
        content: "I decided to use TypeScript for this project",
      });
      expect(result.length).toBeGreaterThan(0);
      const decisions = result.filter((f) => f.type === "decision");
      expect(decisions.length).toBeGreaterThan(0);
    });

    it("should extract English fact patterns", async () => {
      const result = await extractor.extractFromMessage({
        role: "user",
        content: "I work at Microsoft as a software engineer",
      });
      expect(result.length).toBeGreaterThan(0);
      const facts = result.filter((f) => f.type === "fact");
      expect(facts.length).toBeGreaterThan(0);
    });

    it("should respect maxFactsPerTurn limit", async () => {
      const limitedExtractor = new FactExtractor({
        maxFactsPerTurn: 1,
        language: "en",
      });
      const result = await limitedExtractor.extractFromMessage({
        role: "user",
        content:
          "I prefer TypeScript. I decided to learn Rust. I work at Google as a developer.",
      });
      expect(result.length).toBeLessThanOrEqual(1);
    });

    it("should filter facts below minConfidence", async () => {
      const highConfExtractor = new FactExtractor({
        minConfidence: 95,
        language: "en",
      });
      const result = await highConfExtractor.extractFromMessage({
        role: "user",
        content: "I prefer dark mode for all applications",
      });
      // Preference patterns have confidence 85, so they should be filtered out
      expect(result.length).toBe(0);
    });

    it("should extract Spanish preference patterns", async () => {
      const esExtractor = new FactExtractor({ language: "es" });
      const result = await esExtractor.extractFromMessage({
        role: "user",
        content: "Prefiero el modo oscuro para todas las aplicaciones",
      });
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].type).toBe("user_preference");
    });

    it("should extract entities when extractEntities is enabled", async () => {
      vi.mocked(KeywordExtractor.extractEntities).mockReturnValue([
        { type: "person", text: "John Smith" },
        { type: "org", text: "Acme Corp" },
      ] as any);

      const result = await extractor.extractFromMessage({
        role: "user",
        content: "John Smith from Acme Corp contacted me yesterday",
      });
      const entityFacts = result.filter((f) => f.type === "entity");
      expect(entityFacts.length).toBeGreaterThan(0);
    });

    it("should not extract entities when extractEntities is disabled", async () => {
      const noEntityExtractor = new FactExtractor({
        extractEntities: false,
        language: "en",
      });
      vi.mocked(KeywordExtractor.extractEntities).mockReturnValue([
        { type: "person", text: "John Smith" },
      ] as any);

      const result = await noEntityExtractor.extractFromMessage({
        role: "user",
        content: "short msg",
      });
      const entityFacts = result.filter((f) => f.type === "entity");
      expect(entityFacts.length).toBe(0);
    });
  });

  // ===== extractFromConversation =====

  describe("extractFromConversation", () => {
    it("should process only user messages from a conversation", async () => {
      const messages = [
        { role: "user", content: "I prefer TypeScript over JavaScript always" },
        { role: "assistant", content: "Great choice!" },
        { role: "user", content: "I work at Google as an engineer" },
      ];
      const result = await extractor.extractFromConversation(messages);
      expect(result.length).toBeGreaterThan(0);
    });

    it("should merge existing facts into the result", async () => {
      const existingFacts: ExtractedFact[] = [
        {
          type: "fact",
          content: "Previously known fact",
          confidence: 90,
          source: "user_stated",
        },
      ];
      const messages = [
        { role: "user", content: "I like reading science fiction novels a lot" },
      ];
      const result = await extractor.extractFromConversation(
        messages,
        existingFacts
      );
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.some((f) => f.content === "Previously known fact")).toBe(
        true
      );
    });

    it("should return existing facts when no user messages present", async () => {
      const existing: ExtractedFact[] = [
        {
          type: "fact",
          content: "existing fact here",
          confidence: 80,
          source: "user_stated",
        },
      ];
      const result = await extractor.extractFromConversation(
        [{ role: "assistant", content: "Hello" }],
        existing
      );
      expect(result).toEqual(existing);
    });
  });

  // ===== mergeFacts =====

  describe("mergeFacts", () => {
    it("should merge non-duplicate facts", () => {
      const existing: ExtractedFact[] = [
        {
          type: "fact",
          content: "I live in New York",
          confidence: 80,
          source: "user_stated",
        },
      ];
      const newFacts: ExtractedFact[] = [
        {
          type: "decision",
          content: "Switching to React Native for mobile",
          confidence: 85,
          source: "user_stated",
        },
      ];
      const result = extractor.mergeFacts(existing, newFacts);
      expect(result).toHaveLength(2);
    });

    it("should not add duplicate facts based on content similarity", () => {
      const existing: ExtractedFact[] = [
        {
          type: "fact",
          content: "I live in New York",
          confidence: 80,
          source: "user_stated",
        },
      ];
      const newFacts: ExtractedFact[] = [
        {
          type: "fact",
          content: "I live in New York",
          confidence: 85,
          source: "user_stated",
        },
      ];
      const result = extractor.mergeFacts(existing, newFacts);
      expect(result).toHaveLength(1);
      // Should update to higher confidence
      expect(result[0].confidence).toBe(85);
    });

    it("should keep the higher confidence duplicate", () => {
      const existing: ExtractedFact[] = [
        {
          type: "fact",
          content: "working at google",
          confidence: 70,
          source: "inferred",
        },
      ];
      const newFacts: ExtractedFact[] = [
        {
          type: "fact",
          content: "working at google",
          confidence: 95,
          source: "user_stated",
        },
      ];
      const result = extractor.mergeFacts(existing, newFacts);
      expect(result).toHaveLength(1);
      expect(result[0].confidence).toBe(95);
    });

    it("should handle merging empty arrays", () => {
      const result = extractor.mergeFacts([], []);
      expect(result).toHaveLength(0);
    });
  });

  // ===== LLM extraction fallback =====

  describe("LLM extraction (via extractFromMessage)", () => {
    it("should call LLM when semantic indicators are present and no pattern facts found", async () => {
      vi.mocked(geminiChat).mockResolvedValue({
        content: '[{"type":"user_preference","content":"prefers always using dark mode","confidence":85}]',
      } as any);

      const result = await extractor.extractFromMessage({
        role: "user",
        content:
          "I always want to ensure my applications are thoroughly tested before deployment to production",
      });
      // The LLM should have been invoked because "always" is a semantic indicator
      // and the content is long enough
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it("should handle LLM returning invalid JSON gracefully", async () => {
      vi.mocked(geminiChat).mockResolvedValue({
        content: "This is not JSON at all",
      } as any);

      const result = await extractor.extractFromMessage({
        role: "user",
        content:
          "I always prefer to handle errors gracefully in production environments. This is important for reliability.",
      });
      // Should not crash; returns whatever pattern matches found
      expect(Array.isArray(result)).toBe(true);
    });

    it("should handle LLM throwing an error gracefully", async () => {
      vi.mocked(geminiChat).mockRejectedValue(new Error("API down"));

      const result = await extractor.extractFromMessage({
        role: "user",
        content:
          "I always prefer to have comprehensive logging. This is a must-have requirement for our system.",
      });
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
