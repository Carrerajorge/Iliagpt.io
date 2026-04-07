import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockOffset = vi.fn();
const mockReturning = vi.fn();
const mockSet = vi.fn();
const mockValues = vi.fn();
const mockOnConflictDoNothing = vi.fn();

vi.mock("../db", () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

vi.mock("../embeddingService", () => ({
  generateEmbeddingsBatch: vi.fn(),
}));

vi.mock("../lib/llmGateway", () => ({
  llmGateway: {
    chat: vi.fn(),
  },
}));

vi.mock("../utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { LongTermMemoryService, type ExtractedFact } from "../memory/longTermMemory";
import { generateEmbeddingsBatch } from "../embeddingService";
import { llmGateway } from "../lib/llmGateway";

const mockedGenerateEmbeddings = vi.mocked(generateEmbeddingsBatch);
const mockedLlmChat = vi.mocked(llmGateway.chat);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createService(): LongTermMemoryService {
  return new LongTermMemoryService();
}

function makeFakeEmbedding(seed: number = 1): number[] {
  return Array.from({ length: 1536 }, (_, i) => (i + seed) * 0.001);
}

/**
 * Sets up the mock chain so Drizzle-style chaining works.
 * Each mock returns an object that exposes the next method in the chain.
 */
function setupChainedDbMocks(finalResult: unknown = []) {
  // Reset all mocks
  [mockSelect, mockInsert, mockUpdate, mockFrom, mockWhere,
   mockOrderBy, mockLimit, mockOffset, mockReturning, mockSet,
   mockValues, mockOnConflictDoNothing].forEach((m) => m.mockReset());

  // Insert chain: insert().values().onConflictDoNothing().returning()
  mockReturning.mockResolvedValue(finalResult);
  mockOnConflictDoNothing.mockReturnValue({ returning: mockReturning });
  mockValues.mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });
  mockInsert.mockReturnValue({ values: mockValues });

  // Select chain: select().from().where().orderBy().limit().offset()
  // Each returns an object with the remaining methods + also resolves as a promise
  const chainEnd = {
    then: (resolve: (v: unknown) => void) => resolve(finalResult),
    [Symbol.toStringTag]: "Promise",
  };

  mockOffset.mockReturnValue(chainEnd);
  mockLimit.mockReturnValue({ offset: mockOffset, ...chainEnd });
  mockOrderBy.mockReturnValue({
    limit: mockLimit,
    offset: mockOffset,
    ...chainEnd,
  });
  mockWhere.mockReturnValue({
    orderBy: mockOrderBy,
    limit: mockLimit,
    offset: mockOffset,
    returning: mockReturning,
    ...chainEnd,
  });
  mockFrom.mockReturnValue({
    where: mockWhere,
    orderBy: mockOrderBy,
    ...chainEnd,
  });
  mockSelect.mockReturnValue({ from: mockFrom });

  // Update chain: update().set().where().returning()
  mockSet.mockReturnValue({ where: mockWhere });
  mockUpdate.mockReturnValue({ set: mockSet });
}

function makeLlmResponse(content: string) {
  return {
    content,
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    requestId: "test-req",
    latencyMs: 200,
    model: "gpt-4o-mini",
    provider: "openai",
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LongTermMemoryService", () => {
  let service: LongTermMemoryService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createService();
    setupChainedDbMocks();
  });

  // 1. Fact extraction from conversation messages
  describe("extractFacts", () => {
    it("should extract facts from conversation messages via LLM", async () => {
      const llmResponse = JSON.stringify([
        {
          fact: "User prefers dark mode",
          category: "preference",
          confidence: 0.9,
        },
      ]);

      mockedLlmChat.mockResolvedValue(makeLlmResponse(llmResponse));

      const facts = await service.extractFacts(
        [
          { role: "user", content: "I always use dark mode in my editors" },
          { role: "assistant", content: "Got it! I'll remember your preference for dark mode." },
        ],
        "user-1",
      );

      expect(mockedLlmChat).toHaveBeenCalledOnce();
      expect(facts).toHaveLength(1);
      expect(facts[0].fact).toBe("User prefers dark mode");
      expect(facts[0].category).toBe("preference");
      expect(facts[0].confidence).toBe(0.9);
    });

    // 2. Empty conversation produces no facts
    it("should return empty array for empty conversation", async () => {
      const facts = await service.extractFacts([], "user-1");
      expect(facts).toHaveLength(0);
      expect(mockedLlmChat).not.toHaveBeenCalled();
    });

    // 3. Low confidence facts are filtered out
    it("should filter out low-confidence facts", async () => {
      const llmResponse = JSON.stringify([
        { fact: "User might like Python", category: "preference", confidence: 0.3 },
        { fact: "User uses VS Code", category: "knowledge", confidence: 0.85 },
      ]);

      mockedLlmChat.mockResolvedValue(makeLlmResponse(llmResponse));

      const facts = await service.extractFacts(
        [{ role: "user", content: "I use VS Code, maybe Python sometimes" }],
        "user-1",
      );

      expect(facts).toHaveLength(1);
      expect(facts[0].fact).toBe("User uses VS Code");
    });
  });

  // 4. Memory storage with embeddings and similarity dedup
  describe("storeFacts", () => {
    it("should store new facts with generated embeddings", async () => {
      const embedding = makeFakeEmbedding();
      mockedGenerateEmbeddings.mockResolvedValue([embedding]);

      // Mock: no similar existing memories
      setupChainedDbMocks([]);

      const facts: ExtractedFact[] = [
        { fact: "User likes TypeScript", category: "preference", confidence: 0.95 },
      ];

      await service.storeFacts("user-1", facts, "conv-123");

      expect(mockedGenerateEmbeddings).toHaveBeenCalledWith(["User likes TypeScript"]);
      expect(mockInsert).toHaveBeenCalled();
    });

    it("should not call embeddings when no facts provided", async () => {
      await service.storeFacts("user-1", []);
      expect(mockedGenerateEmbeddings).not.toHaveBeenCalled();
    });
  });

  // 5. Semantic recall with similarity scoring
  describe("recallMemories", () => {
    it("should recall memories using vector similarity", async () => {
      const queryEmbedding = makeFakeEmbedding(2);
      mockedGenerateEmbeddings.mockResolvedValue([queryEmbedding]);

      const now = new Date();
      const mockResults = [
        {
          id: "mem-1",
          userId: "user-1",
          fact: "User prefers dark mode",
          category: "preference",
          salienceScore: 0.9,
          accessCount: 3,
          createdAt: now,
          updatedAt: now,
          similarity: 0.95,
        },
      ];

      // First select() call returns similarities
      setupChainedDbMocks(mockResults);

      const memories = await service.recallMemories("user-1", "What theme does the user like?", 5);

      expect(mockedGenerateEmbeddings).toHaveBeenCalledWith(["What theme does the user like?"]);
      expect(memories.length).toBeGreaterThan(0);
      expect(memories[0].fact).toBe("User prefers dark mode");
    });
  });

  // 6. System prompt injection formatting
  describe("buildMemoryContext", () => {
    it("should format memories into a context block", async () => {
      const queryEmbedding = makeFakeEmbedding(3);
      mockedGenerateEmbeddings.mockResolvedValue([queryEmbedding]);

      const now = new Date();
      const mockResults = [
        {
          id: "mem-1",
          userId: "user-1",
          fact: "User prefers TypeScript",
          category: "preference",
          salienceScore: 0.9,
          accessCount: 2,
          createdAt: now,
          updatedAt: now,
          similarity: 0.92,
        },
      ];

      setupChainedDbMocks(mockResults);

      const prompt = await service.buildMemoryContext("user-1", "Write some code");

      expect(prompt).toContain("Memory about this user");
      expect(prompt).toContain("User prefers TypeScript");
      expect(prompt).toContain("[preference]");
    });

    it("should return empty string when no relevant memories exist", async () => {
      const queryEmbedding = makeFakeEmbedding(4);
      mockedGenerateEmbeddings.mockResolvedValue([queryEmbedding]);

      setupChainedDbMocks([]);

      const prompt = await service.buildMemoryContext("user-1", "Hello");

      expect(prompt).toBe("");
    });
  });

  // 7. Memory deletion (soft delete)
  describe("deleteMemory", () => {
    it("should soft-delete a memory and return true", async () => {
      setupChainedDbMocks();
      mockReturning.mockResolvedValue([{ id: "mem-1" }]);

      const result = await service.deleteMemory("mem-1", "user-1");

      expect(mockUpdate).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it("should return false when memory not found", async () => {
      setupChainedDbMocks();
      mockReturning.mockResolvedValue([]);

      const result = await service.deleteMemory("nonexistent", "user-1");

      expect(result).toBe(false);
    });
  });

  // 8. User memory listing with pagination
  describe("getUserMemories", () => {
    it("should list active memories with pagination", async () => {
      const now = new Date();
      const mockMemories = [
        {
          id: "mem-1", userId: "user-1", fact: "Fact 1", category: "preference",
          salienceScore: 0.8, accessCount: 2, createdAt: now, updatedAt: now,
        },
        {
          id: "mem-2", userId: "user-1", fact: "Fact 2", category: "knowledge",
          salienceScore: 0.5, accessCount: 1, createdAt: now, updatedAt: now,
        },
      ];

      setupChainedDbMocks(mockMemories);

      const result = await service.getUserMemories("user-1", {
        limit: 10,
        offset: 0,
      });

      expect(result).toHaveLength(2);
      expect(result[0].fact).toBe("Fact 1");
    });
  });

  // 9. Category filtering
  describe("category filtering", () => {
    it("should filter memories by category", async () => {
      const now = new Date();
      const mockMemories = [
        {
          id: "mem-1", userId: "user-1", fact: "Prefers dark mode", category: "preference",
          salienceScore: 0.8, accessCount: 1, createdAt: now, updatedAt: now,
        },
      ];

      setupChainedDbMocks(mockMemories);

      const result = await service.getUserMemories("user-1", {
        category: "preference",
      });

      expect(result).toHaveLength(1);
      expect(result[0].category).toBe("preference");
    });
  });

  // 10. Content hash computation
  describe("computeContentHash", () => {
    it("should produce consistent hashes for normalized text", () => {
      const hash1 = service.computeContentHash("User likes TypeScript");
      const hash2 = service.computeContentHash("  user  likes  typescript  ");
      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different facts", () => {
      const hash1 = service.computeContentHash("User likes TypeScript");
      const hash2 = service.computeContentHash("User likes Python");
      expect(hash1).not.toBe(hash2);
    });
  });

  // 11. Recency decay calculation
  describe("computeRecencyDecay", () => {
    it("should return 1.0 for just-created memories", () => {
      const now = Date.now();
      const decay = service.computeRecencyDecay(now, now);
      expect(decay).toBeCloseTo(1.0);
    });

    it("should return ~0.5 after half-life period (30 days)", () => {
      const now = Date.now();
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
      const decay = service.computeRecencyDecay(thirtyDaysAgo, now);
      expect(decay).toBeCloseTo(0.5, 1);
    });

    it("should decay further for older memories", () => {
      const now = Date.now();
      const sixtyDaysAgo = now - 60 * 24 * 60 * 60 * 1000;
      const decay = service.computeRecencyDecay(sixtyDaysAgo, now);
      expect(decay).toBeCloseTo(0.25, 1);
    });
  });

  // 12. LLM response parsing edge cases
  describe("parseExtractedFacts", () => {
    it("should handle malformed LLM response gracefully", () => {
      const facts = service.parseExtractedFacts("Sorry, I cannot extract any facts.");
      expect(facts).toHaveLength(0);
    });

    it("should clamp confidence values to [0, 1]", () => {
      const facts = service.parseExtractedFacts(
        JSON.stringify([
          { fact: "Test fact", category: "knowledge", confidence: 1.5 },
        ]),
      );

      expect(facts).toHaveLength(1);
      expect(facts[0].confidence).toBeLessThanOrEqual(1);
    });

    it("should default invalid categories to 'knowledge'", () => {
      const facts = service.parseExtractedFacts(
        JSON.stringify([
          { fact: "Some fact", category: "invalid_category", confidence: 0.9 },
        ]),
      );

      expect(facts).toHaveLength(1);
      expect(facts[0].category).toBe("knowledge");
    });

    it("should limit to 10 facts maximum", () => {
      const manyFacts = Array.from({ length: 15 }, (_, i) => ({
        fact: `Fact number ${i}`,
        category: "knowledge",
        confidence: 0.8,
      }));

      const facts = service.parseExtractedFacts(JSON.stringify(manyFacts));
      expect(facts).toHaveLength(10);
    });
  });
});
