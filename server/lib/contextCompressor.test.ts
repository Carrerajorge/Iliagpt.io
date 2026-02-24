import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock external dependencies
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      generateContent: vi.fn().mockResolvedValue({
        text: "Summary of conversation segment.",
      }),
    };
  },
}));

vi.mock("./largeDocumentProcessor", () => ({
  LargeDocumentProcessor: class {
    process = vi.fn();
  },
  estimateTokens: vi.fn((text: string) => {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }),
}));

import {
  estimateContextTokens,
  ContextCompressor,
  type Message,
  type ContextCompressorConfig,
} from "./contextCompressor";

describe("contextCompressor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===== estimateContextTokens (exported utility) =====

  describe("estimateContextTokens", () => {
    it("should return 0 for an empty array", () => {
      expect(estimateContextTokens([])).toBe(0);
    });

    it("should return 0 for null/undefined input", () => {
      expect(estimateContextTokens(null as any)).toBe(0);
      expect(estimateContextTokens(undefined as any)).toBe(0);
    });

    it("should estimate tokens based on message content length", () => {
      const messages: Message[] = [
        { role: "user", content: "Hello world" },
        { role: "assistant", content: "Hi there, how can I help?" },
      ];
      const tokens = estimateContextTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it("should return higher token count for longer messages", () => {
      const short: Message[] = [{ role: "user", content: "Hi" }];
      const long: Message[] = [
        { role: "user", content: "This is a much longer message with many more words and content" },
      ];
      expect(estimateContextTokens(long)).toBeGreaterThan(
        estimateContextTokens(short)
      );
    });
  });

  // ===== ContextCompressor constructor =====

  describe("ContextCompressor constructor", () => {
    it("should create with default config", () => {
      const compressor = new ContextCompressor();
      expect(compressor).toBeDefined();
      const config = compressor.getConfig();
      expect(config.maxTokens).toBe(100000);
      expect(config.preserveRecent).toBe(5);
    });

    it("should merge partial config with defaults", () => {
      const compressor = new ContextCompressor({
        maxTokens: 50000,
        preserveRecent: 3,
      });
      const config = compressor.getConfig();
      expect(config.maxTokens).toBe(50000);
      expect(config.preserveRecent).toBe(3);
      expect(config.compressionRatio).toBe(0.3); // default preserved
    });
  });

  // ===== compress =====

  describe("compress", () => {
    it("should return empty context for empty messages", async () => {
      const compressor = new ContextCompressor();
      const result = await compressor.compress([]);
      expect(result.blocks).toHaveLength(0);
      expect(result.preservedMessages).toHaveLength(0);
      expect(result.compressionApplied).toBe(false);
      expect(result.totalOriginalTokens).toBe(0);
      expect(result.totalCompressedTokens).toBe(0);
      expect(result.compressionRatio).toBe(1);
      expect(result.strategies).toHaveLength(0);
    });

    it("should not compress when below threshold and below min messages", async () => {
      const compressor = new ContextCompressor({
        maxTokens: 100000,
        minMessagesForCompression: 10,
      });
      const messages: Message[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ];
      const result = await compressor.compress(messages);
      expect(result.compressionApplied).toBe(false);
      expect(result.preservedMessages).toHaveLength(2);
    });

    it("should separate system prompts from conversation messages", async () => {
      const compressor = new ContextCompressor({
        minMessagesForCompression: 100,
      });
      const messages: Message[] = [
        { role: "system", content: "You are a helpful assistant" },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi!" },
      ];
      const result = await compressor.compress(messages);
      expect(result.systemPrompt).toBeDefined();
      expect(result.systemPrompt?.content).toBe("You are a helpful assistant");
      // conversation messages exclude system
      expect(result.preservedMessages).toHaveLength(2);
    });

    it("should preserve recent messages during compression", async () => {
      const compressor = new ContextCompressor({
        maxTokens: 10, // very low to trigger compression
        compressionThreshold: 0.0001,
        preserveRecent: 2,
        minMessagesForCompression: 3,
        chunkSize: 5,
      });
      const messages: Message[] = [];
      for (let i = 0; i < 10; i++) {
        messages.push({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message number ${i} with some content to pad the token count up.`,
        });
      }
      const result = await compressor.compress(messages);
      expect(result.preservedMessages).toHaveLength(2);
      expect(result.preservedMessages[0].content).toContain("Message number 8");
      expect(result.preservedMessages[1].content).toContain("Message number 9");
    });

    it("should apply deduplication strategy when enabled", async () => {
      const compressor = new ContextCompressor({
        maxTokens: 10,
        compressionThreshold: 0.0001,
        preserveRecent: 1,
        minMessagesForCompression: 3,
        enableDeduplication: true,
        enablePruning: false,
        enableSemanticClustering: false,
        chunkSize: 20,
      });
      const messages: Message[] = [];
      for (let i = 0; i < 6; i++) {
        messages.push({
          role: "user",
          content: "This is the exact same duplicated message repeated over and over",
        });
      }
      const result = await compressor.compress(messages);
      expect(result.compressionApplied).toBe(true);
      expect(result.strategies).toContain("deduplication");
    });
  });

  // ===== estimateTokens instance method =====

  describe("estimateTokens (instance)", () => {
    it("should return same result as the standalone function", () => {
      const compressor = new ContextCompressor();
      const messages: Message[] = [
        { role: "user", content: "Test message content" },
      ];
      expect(compressor.estimateTokens(messages)).toBe(
        estimateContextTokens(messages)
      );
    });
  });

  // ===== getCompressionStats =====

  describe("getCompressionStats", () => {
    it("should return initial stats with zeroes before compression", () => {
      const compressor = new ContextCompressor();
      const stats = compressor.getCompressionStats();
      expect(stats.original).toBe(0);
      expect(stats.compressed).toBe(0);
      expect(stats.ratio).toBe(1);
      expect(stats.tokensReclaimed).toBe(0);
      expect(stats.summaryGenerations).toBe(0);
    });

    it("should return a copy not a reference", () => {
      const compressor = new ContextCompressor();
      const stats1 = compressor.getCompressionStats();
      const stats2 = compressor.getCompressionStats();
      expect(stats1).not.toBe(stats2);
      expect(stats1).toEqual(stats2);
    });
  });

  // ===== getMetrics =====

  describe("getMetrics", () => {
    it("should return initial metrics", () => {
      const compressor = new ContextCompressor();
      const metrics = compressor.getMetrics();
      expect(metrics.totalCompressions).toBe(0);
      expect(metrics.tokensReclaimedCounter).toBe(0);
      expect(metrics.compressionRatioHistogram).toHaveLength(0);
    });
  });

  // ===== cache management =====

  describe("cache management", () => {
    it("should report cache size as 0 initially", () => {
      const compressor = new ContextCompressor();
      expect(compressor.getCacheSize()).toBe(0);
    });

    it("should clear cache without error", () => {
      const compressor = new ContextCompressor();
      compressor.clearCache();
      expect(compressor.getCacheSize()).toBe(0);
    });
  });

  // ===== getConfig / updateConfig =====

  describe("config management", () => {
    it("should return a copy of config via getConfig", () => {
      const compressor = new ContextCompressor();
      const config1 = compressor.getConfig();
      const config2 = compressor.getConfig();
      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });

    it("should update config partially via updateConfig", () => {
      const compressor = new ContextCompressor();
      compressor.updateConfig({ maxTokens: 200000 });
      expect(compressor.getConfig().maxTokens).toBe(200000);
      // Other defaults should remain
      expect(compressor.getConfig().preserveRecent).toBe(5);
    });
  });

  // ===== edge case: messages with no compression needed =====

  describe("edge cases", () => {
    it("should handle single message without crashing", async () => {
      const compressor = new ContextCompressor();
      const result = await compressor.compress([
        { role: "user", content: "Just one message" },
      ]);
      expect(result.compressionApplied).toBe(false);
    });

    it("should handle messages with empty content strings", async () => {
      const compressor = new ContextCompressor();
      const result = await compressor.compress([
        { role: "user", content: "" },
        { role: "assistant", content: "" },
      ]);
      expect(result.compressionApplied).toBe(false);
    });

    it("should combine multiple system messages into one systemPrompt", async () => {
      const compressor = new ContextCompressor({
        minMessagesForCompression: 100,
      });
      const messages: Message[] = [
        { role: "system", content: "Rule 1: Be helpful" },
        { role: "system", content: "Rule 2: Be concise" },
        { role: "user", content: "Hello" },
      ];
      const result = await compressor.compress(messages);
      expect(result.systemPrompt).toBeDefined();
      expect(result.systemPrompt?.content).toContain("Rule 1");
      expect(result.systemPrompt?.content).toContain("Rule 2");
    });
  });
});
