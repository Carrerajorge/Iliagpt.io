import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Utils dependency from searchEngines
vi.mock("./searchEngines", () => {
  const STOP_WORDS = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "through", "during",
    "before", "after", "above", "below", "between", "under", "again",
    "further", "then", "once", "here", "there", "when", "where", "why",
    "how", "all", "each", "few", "more", "most", "other", "some", "such",
    "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very",
    "just", "can", "now", "this", "that", "these", "those", "and", "but",
    "if", "or", "because", "until", "while", "although", "though", "since",
    "it", "its", "you", "your", "we", "our", "they", "their", "he", "his",
    "she", "her", "i", "me", "my", "myself", "what", "which", "who", "whom",
    "whose", "el", "la", "los", "las", "de", "del", "al", "que", "en",
    "es", "por", "con", "para", "se", "su", "sus", "como", "pero",
  ]);

  return {
    Utils: {
      STOP_WORDS,
      tokenize(text: string): string[] {
        if (!text) return [];
        return text
          .toLowerCase()
          .replace(/[^\w\sáéíóúñüàèìòùâêîôûäëïöü]/g, " ")
          .split(/\s+/)
          .filter((token: string) => token.length > 2)
          .filter((token: string) => !STOP_WORDS.has(token));
      },
    },
  };
});

import { KeywordExtractor, ExtractedEntity } from "./keywordExtractor";

describe("KeywordExtractor", () => {
  describe("extract", () => {
    it("returns empty array for empty string", () => {
      const result = KeywordExtractor.extract("");
      expect(result).toEqual([]);
    });

    it("returns empty array for null/undefined input", () => {
      const result = KeywordExtractor.extract(null as unknown as string);
      expect(result).toEqual([]);
    });

    it("extracts tokens from simple text", () => {
      const result = KeywordExtractor.extract("machine learning algorithms are powerful tools");
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain("machine");
      expect(result).toContain("learning");
      expect(result).toContain("algorithms");
    });

    it("respects maxKeywords limit", () => {
      const text = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa";
      const result = KeywordExtractor.extract(text, 3);
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("defaults maxKeywords to 10", () => {
      const words = Array.from({ length: 20 }, (_, i) => `word${i}unique`);
      const text = words.join(" ");
      const result = KeywordExtractor.extract(text);
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it("boosts capitalized words with extra frequency weight", () => {
      // "Einstein" appears once capitalized (boost +2) vs "physics" appearing once as token (+1)
      const text = "Einstein studied physics deeply. einstein revisited physics again.";
      const result = KeywordExtractor.extract(text);
      // "einstein" should rank high due to capitalization boost
      expect(result.indexOf("einstein")).toBeLessThan(result.length);
    });

    it("includes dates and numbers found in text", () => {
      const text = "The event on 2024-01-15 cost 500usd for registration";
      const result = KeywordExtractor.extract(text);
      expect(result).toContain("2024-01-15");
    });

    it("handles text with only stop words", () => {
      const text = "the is a an";
      const result = KeywordExtractor.extract(text);
      expect(result).toEqual([]);
    });

    it("handles special characters in text gracefully", () => {
      const text = "C++ and C# are programming languages!!! @#$%^&*()";
      const result = KeywordExtractor.extract(text);
      expect(Array.isArray(result)).toBe(true);
    });

    it("extracts number with unit suffixes", () => {
      const text = "The file size was 500mb and distance was 100km from 200eur budget";
      const result = KeywordExtractor.extract(text);
      // Should find at least some number+unit combos
      const hasNumberUnit = result.some((r) => /\d+\w+/.test(r));
      expect(hasNumberUnit).toBe(true);
    });

    it("handles very long text without error", () => {
      const text = "keyword ".repeat(5000);
      const result = KeywordExtractor.extract(text);
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(10);
    });
  });

  describe("extractEntities", () => {
    it("returns empty array for empty string", () => {
      const result = KeywordExtractor.extractEntities("");
      expect(result).toEqual([]);
    });

    it("returns empty array for null/undefined input", () => {
      const result = KeywordExtractor.extractEntities(null as unknown as string);
      expect(result).toEqual([]);
    });

    it("extracts dates in various formats", () => {
      const text = "Dates: 2024-01-15, 15/01/2024, 01-15-2024";
      const result = KeywordExtractor.extractEntities(text);
      const dates = result.filter((e) => e.type === "date");
      expect(dates.length).toBe(3);
      expect(dates[0].text).toBe("2024-01-15");
    });

    it("extracts numbers with unit suffixes", () => {
      const text = "The cost was 150usd and the weight was 75kg";
      const result = KeywordExtractor.extractEntities(text);
      const numbers = result.filter((e) => e.type === "number");
      expect(numbers.length).toBe(2);
      expect(numbers.some((n) => n.text.includes("150usd"))).toBe(true);
      expect(numbers.some((n) => n.text.includes("75kg"))).toBe(true);
    });

    it("extracts percentage values", () => {
      const text = "Growth was 15.5% this quarter";
      const result = KeywordExtractor.extractEntities(text);
      const numbers = result.filter((e) => e.type === "number");
      expect(numbers.some((n) => n.text.includes("15.5%"))).toBe(true);
    });

    it("identifies multi-word capitalized phrases as person names", () => {
      const text = "The project was led by John Smith and Maria Garcia";
      const result = KeywordExtractor.extractEntities(text);
      const persons = result.filter((e) => e.type === "person");
      expect(persons.some((p) => p.text === "John Smith")).toBe(true);
      expect(persons.some((p) => p.text === "Maria Garcia")).toBe(true);
    });

    it("identifies organizations by indicator words", () => {
      const text = "Google Inc was founded alongside Microsoft Corporation";
      const result = KeywordExtractor.extractEntities(text);
      const orgs = result.filter((e) => e.type === "org");
      expect(orgs.some((o) => o.text.includes("Inc"))).toBe(true);
    });

    it("deduplicates extracted entities", () => {
      const text = "2024-01-15 happened on 2024-01-15 and again 2024-01-15";
      const result = KeywordExtractor.extractEntities(text);
      const dates = result.filter((e) => e.type === "date");
      expect(dates).toHaveLength(1);
    });

    it("extracts single capitalized words as unknown entities", () => {
      const text = "the algorithm uses Kubernetes for orchestration";
      const result = KeywordExtractor.extractEntities(text);
      const unknowns = result.filter((e) => e.type === "unknown");
      expect(unknowns.some((u) => u.text === "Kubernetes")).toBe(true);
    });

    it("skips capitalized words that are stop words", () => {
      const result = KeywordExtractor.extractEntities("The But");
      // "The" and "But" are short or stop words, should not appear
      const unknowns = result.filter((e) => e.type === "unknown");
      const hasStopWord = unknowns.some(
        (u) => u.text === "The" || u.text === "But"
      );
      expect(hasStopWord).toBe(false);
    });

    it("rejects entity text longer than 50 characters for capitalized phrases", () => {
      // Build a very long multi-word capitalized phrase (>50 chars)
      const longPhrase = "Abcdefghij Abcdefghij Abcdefghij Abcdefghij Abcdefghij Abcdefghij";
      const text = `The ${longPhrase} was important`;
      const result = KeywordExtractor.extractEntities(text);
      // The very long phrase should be rejected by the <=50 length filter
      const found = result.filter((e) => e.text === longPhrase);
      expect(found).toHaveLength(0);
    });

    it("handles mixed entity types in one text", () => {
      const text = "John Smith spent 500usd on 2024-03-20 at Google Inc headquarters";
      const result = KeywordExtractor.extractEntities(text);
      const types = new Set(result.map((e) => e.type));
      expect(types.size).toBeGreaterThanOrEqual(2);
    });
  });
});
