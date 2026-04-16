import { describe, it, expect, vi, beforeEach } from "vitest";

// Create a mock store for memoryCache
const mockStore = new Map<string, any>();

vi.mock("./memoryCache", () => ({
  memoryCache: {
    get: vi.fn(async (key: string) => {
      const val = mockStore.get(key);
      return val ? val.v : null;
    }),
    set: vi.fn(async (key: string, value: any, _opts?: any) => {
      mockStore.set(key, { v: value });
    }),
    delete: vi.fn(async (key: string) => {
      const existed = mockStore.has(key);
      mockStore.delete(key);
      return existed;
    }),
  },
}));

import {
  getLastSeq,
  saveStreamingProgress,
  getStreamingProgress,
  clearStreamingProgress,
  getActiveStreamingSessions,
} from "./streamingSeq";
import { memoryCache } from "./memoryCache";

describe("streamingSeq", () => {
  beforeEach(() => {
    mockStore.clear();
    vi.clearAllMocks();
  });

  describe("getLastSeq", () => {
    it("returns 0 when no progress exists for the chatId", async () => {
      const result = await getLastSeq("nonexistent-chat");
      expect(result).toBe(0);
    });

    it("returns the stored lastSeq value", async () => {
      await saveStreamingProgress("chat-123", 42, "partial content", "streaming");
      const result = await getLastSeq("chat-123");
      expect(result).toBe(42);
    });

    it("returns 0 when memoryCache.get throws an error", async () => {
      vi.mocked(memoryCache.get).mockRejectedValueOnce(new Error("cache failure"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await getLastSeq("chat-error");
      expect(result).toBe(0);

      errorSpy.mockRestore();
    });

    it("uses the correct cache key prefix", async () => {
      await getLastSeq("my-chat-id");
      expect(memoryCache.get).toHaveBeenCalledWith("stream:seq:my-chat-id");
    });
  });

  describe("saveStreamingProgress", () => {
    it("saves progress with streaming status", async () => {
      await saveStreamingProgress("chat-1", 10, "hello world", "streaming");

      expect(memoryCache.set).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(memoryCache.set).mock.calls[0];
      expect(callArgs[0]).toBe("stream:seq:chat-1");
      const saved = callArgs[1] as any;
      expect(saved.chatId).toBe("chat-1");
      expect(saved.lastSeq).toBe(10);
      expect(saved.content).toBe("hello world");
      expect(saved.status).toBe("streaming");
      expect(typeof saved.updatedAt).toBe("number");
    });

    it("saves progress with completed status", async () => {
      await saveStreamingProgress("chat-2", 100, "full response", "completed");

      const callArgs = vi.mocked(memoryCache.set).mock.calls[0];
      const saved = callArgs[1] as any;
      expect(saved.status).toBe("completed");
      expect(saved.lastSeq).toBe(100);
    });

    it("saves progress with failed status", async () => {
      await saveStreamingProgress("chat-3", 5, "partial", "failed");

      const callArgs = vi.mocked(memoryCache.set).mock.calls[0];
      const saved = callArgs[1] as any;
      expect(saved.status).toBe("failed");
    });

    it("sets TTL to 24 hours in milliseconds", async () => {
      await saveStreamingProgress("chat-ttl", 1, "test", "streaming");

      const callArgs = vi.mocked(memoryCache.set).mock.calls[0];
      const options = callArgs[2] as any;
      // SEQ_TTL = 3600 * 24 = 86400 seconds, times 1000 = 86400000 ms
      expect(options.ttl).toBe(86400000);
    });

    it("does not throw when memoryCache.set fails", async () => {
      vi.mocked(memoryCache.set).mockRejectedValueOnce(new Error("set failure"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Should not throw
      await expect(
        saveStreamingProgress("chat-fail", 1, "data", "streaming")
      ).resolves.toBeUndefined();

      errorSpy.mockRestore();
    });

    it("includes updatedAt timestamp close to current time", async () => {
      const before = Date.now();
      await saveStreamingProgress("chat-time", 1, "test", "streaming");
      const after = Date.now();

      const callArgs = vi.mocked(memoryCache.set).mock.calls[0];
      const saved = callArgs[1] as any;
      expect(saved.updatedAt).toBeGreaterThanOrEqual(before);
      expect(saved.updatedAt).toBeLessThanOrEqual(after);
    });

    it("persists assistant message metadata for resume hydration", async () => {
      await saveStreamingProgress("chat-meta", 7, "partial", "streaming", {
        assistantMessageId: "assistant-123",
        requestId: "req-123",
      });

      const callArgs = vi.mocked(memoryCache.set).mock.calls[0];
      const saved = callArgs[1] as any;
      expect(saved.assistantMessageId).toBe("assistant-123");
      expect(saved.requestId).toBe("req-123");
    });
  });

  describe("getStreamingProgress", () => {
    it("returns null when no progress exists", async () => {
      const result = await getStreamingProgress("nonexistent");
      expect(result).toBeNull();
    });

    it("returns the full progress object when it exists", async () => {
      await saveStreamingProgress("chat-full", 50, "halfway content", "streaming");
      const result = await getStreamingProgress("chat-full");

      expect(result).toBeDefined();
      expect(result!.chatId).toBe("chat-full");
      expect(result!.lastSeq).toBe(50);
      expect(result!.content).toBe("halfway content");
      expect(result!.status).toBe("streaming");
    });

    it("returns null when memoryCache.get throws", async () => {
      vi.mocked(memoryCache.get).mockRejectedValueOnce(new Error("get failure"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await getStreamingProgress("chat-err");
      expect(result).toBeNull();

      errorSpy.mockRestore();
    });

    it("uses the correct cache key for the chatId", async () => {
      await getStreamingProgress("specific-chat-id");
      expect(memoryCache.get).toHaveBeenCalledWith("stream:seq:specific-chat-id");
    });
  });

  describe("clearStreamingProgress", () => {
    it("deletes progress from cache", async () => {
      await saveStreamingProgress("chat-clear", 10, "data", "completed");
      await clearStreamingProgress("chat-clear");

      expect(memoryCache.delete).toHaveBeenCalledWith("stream:seq:chat-clear");
    });

    it("does not throw when clearing nonexistent chatId", async () => {
      await expect(clearStreamingProgress("no-such-chat")).resolves.toBeUndefined();
    });

    it("does not throw when memoryCache.delete fails", async () => {
      vi.mocked(memoryCache.delete).mockRejectedValueOnce(new Error("del failure"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(clearStreamingProgress("chat-del-err")).resolves.toBeUndefined();

      errorSpy.mockRestore();
    });

    it("after clearing, getLastSeq returns 0", async () => {
      await saveStreamingProgress("chat-reset", 99, "content", "streaming");
      await clearStreamingProgress("chat-reset");

      const seq = await getLastSeq("chat-reset");
      expect(seq).toBe(0);
    });
  });

  describe("getActiveStreamingSessions", () => {
    it("returns an empty array", async () => {
      const result = await getActiveStreamingSessions();
      expect(result).toEqual([]);
    });

    it("returns an array type", async () => {
      const result = await getActiveStreamingSessions();
      expect(Array.isArray(result)).toBe(true);
    });

    it("always returns empty regardless of saved sessions", async () => {
      await saveStreamingProgress("active-1", 1, "a", "streaming");
      await saveStreamingProgress("active-2", 2, "b", "streaming");

      const result = await getActiveStreamingSessions();
      expect(result).toHaveLength(0);
    });
  });
});
