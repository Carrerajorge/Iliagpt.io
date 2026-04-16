import { describe, it, expect } from "vitest";
import { reciprocalRankFusion, type SearchResult } from "../search/unifiedSearch";

function makeResult(id: string, type: "message" | "chat" | "document", score: number): SearchResult {
  return {
    id,
    type,
    title: `Result ${id}`,
    content: `Content for ${id}`,
    highlight: `Content for <mark>${id}</mark>`,
    score,
    createdAt: new Date(),
  };
}

describe("unifiedSearch", () => {
  describe("reciprocalRankFusion", () => {
    it("combines two rankings with correct RRF scores", () => {
      const ranking1 = [makeResult("a", "message", 0.9), makeResult("b", "message", 0.7)];
      const ranking2 = [makeResult("b", "message", 0.95), makeResult("c", "chat", 0.5)];

      const fused = reciprocalRankFusion([ranking1, ranking2], 60);

      // "b" appears in both rankings → should have highest fused score
      expect(fused[0].id).toBe("b");
      expect(fused.length).toBe(3);
    });

    it("deduplicates by type:id composite key", () => {
      const ranking1 = [makeResult("x", "message", 1.0)];
      const ranking2 = [makeResult("x", "message", 0.5)];

      const fused = reciprocalRankFusion([ranking1, ranking2]);
      expect(fused.length).toBe(1);
      expect(fused[0].score).toBeGreaterThan(1 / 61);
    });

    it("returns empty array for empty rankings", () => {
      const fused = reciprocalRankFusion([[], []]);
      expect(fused).toEqual([]);
    });

    it("handles single ranking correctly", () => {
      const ranking = [
        makeResult("a", "message", 0.9),
        makeResult("b", "chat", 0.5),
      ];

      const fused = reciprocalRankFusion([ranking]);
      expect(fused.length).toBe(2);
      expect(fused[0].id).toBe("a");
    });

    it("preserves result metadata through fusion", () => {
      const result = makeResult("meta", "document", 0.8);
      result.chatId = "chat-123";
      result.metadata = { source: "test" };

      const fused = reciprocalRankFusion([[result]]);
      expect(fused[0].chatId).toBe("chat-123");
      expect(fused[0].metadata).toEqual({ source: "test" });
    });

    it("k parameter affects score distribution", () => {
      const ranking = [makeResult("a", "message", 1.0), makeResult("b", "message", 0.5)];

      const fusedSmallK = reciprocalRankFusion([ranking], 1);
      const fusedLargeK = reciprocalRankFusion([ranking], 1000);

      const diffSmall = fusedSmallK[0].score - fusedSmallK[1].score;
      const diffLarge = fusedLargeK[0].score - fusedLargeK[1].score;
      expect(diffSmall).toBeGreaterThan(diffLarge);
    });

    it("orders results by descending score", () => {
      const ranking1 = [makeResult("c", "message", 0.5)];
      const ranking2 = [makeResult("a", "chat", 0.9), makeResult("c", "message", 0.3)];
      const ranking3 = [makeResult("b", "document", 0.7), makeResult("a", "chat", 0.6), makeResult("c", "message", 0.1)];

      const fused = reciprocalRankFusion([ranking1, ranking2, ranking3]);

      for (let i = 1; i < fused.length; i++) {
        expect(fused[i - 1].score).toBeGreaterThanOrEqual(fused[i].score);
      }
    });

    it("handles three or more rankings", () => {
      const rankings = [
        [makeResult("a", "message", 0.9)],
        [makeResult("b", "chat", 0.8)],
        [makeResult("c", "document", 0.7)],
        [makeResult("a", "message", 0.6)],
      ];

      const fused = reciprocalRankFusion(rankings);
      expect(fused.length).toBe(3);
      expect(fused[0].id).toBe("a");
    });
  });
});
