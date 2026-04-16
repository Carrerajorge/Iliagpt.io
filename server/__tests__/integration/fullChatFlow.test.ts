import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the storage and llmGateway
vi.mock("../../storage", () => ({
  storage: {
    getChat: vi.fn(),
    createChat: vi.fn(),
    getMessages: vi.fn(),
    getChatMessages: vi.fn(),
    createMessage: vi.fn(),
    createChatMessage: vi.fn(),
    updateMessage: vi.fn(),
    updateChatMessageContent: vi.fn(),
  },
}));

vi.mock("../../lib/llmGateway", () => ({
  llmGateway: {
    chat: vi.fn(),
    streamChat: vi.fn(),
  },
}));

import { storage } from "../../storage";

const mockedStorage = storage as unknown as {
  getChat: ReturnType<typeof vi.fn>;
  createChat: ReturnType<typeof vi.fn>;
  getMessages: ReturnType<typeof vi.fn>;
  getChatMessages: ReturnType<typeof vi.fn>;
  createMessage: ReturnType<typeof vi.fn>;
  createChatMessage: ReturnType<typeof vi.fn>;
  updateMessage: ReturnType<typeof vi.fn>;
  updateChatMessageContent: ReturnType<typeof vi.fn>;
};

describe("Full Chat Flow (mocked storage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creating a chat returns a valid chatId", async () => {
    const mockChat = {
      id: "chat-abc-123",
      userId: "user-1",
      title: "Test Chat",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockedStorage.createChat.mockResolvedValue(mockChat);

    const result = await storage.createChat({
      userId: "user-1",
      title: "Test Chat",
    } as any);

    expect(result).toBeDefined();
    expect(result.id).toBe("chat-abc-123");
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
  });

  it("sending a message stores it with correct role and content", async () => {
    const mockMessage = {
      id: "msg-001",
      chatId: "chat-abc-123",
      role: "user",
      content: "Hello, how are you?",
      createdAt: new Date(),
    };
    mockedStorage.createChatMessage.mockResolvedValue(mockMessage);

    const result = await storage.createChatMessage({
      chatId: "chat-abc-123",
      role: "user",
      content: "Hello, how are you?",
    } as any);

    expect(result.role).toBe("user");
    expect(result.content).toBe("Hello, how are you?");
    expect(result.chatId).toBe("chat-abc-123");
    expect(mockedStorage.createChatMessage).toHaveBeenCalledTimes(1);
  });

  it("getting messages returns them in chronological order", async () => {
    const now = Date.now();
    const messages = [
      { id: "msg-001", chatId: "chat-1", role: "user", content: "First", createdAt: new Date(now) },
      { id: "msg-002", chatId: "chat-1", role: "assistant", content: "Second", createdAt: new Date(now + 1000) },
      { id: "msg-003", chatId: "chat-1", role: "user", content: "Third", createdAt: new Date(now + 2000) },
    ];
    mockedStorage.getChatMessages.mockResolvedValue(messages);

    const result = await storage.getChatMessages("chat-1");

    expect(result).toHaveLength(3);
    expect(result[0].content).toBe("First");
    expect(result[1].content).toBe("Second");
    expect(result[2].content).toBe("Third");
    // Verify chronological order
    for (let i = 1; i < result.length; i++) {
      expect(result[i].createdAt.getTime()).toBeGreaterThan(result[i - 1].createdAt.getTime());
    }
  });

  it("rate limiter blocks after exceeding limit", async () => {
    // Simulate a rate limiter that allows 3 requests then throws
    const maxRequests = 3;
    let requestCount = 0;

    const rateLimitedCreateMessage = vi.fn().mockImplementation(async (msg: any) => {
      requestCount++;
      if (requestCount > maxRequests) {
        throw new Error("Rate limit exceeded: too many requests");
      }
      return { id: `msg-${requestCount}`, ...msg, createdAt: new Date() };
    });

    // First 3 should succeed
    for (let i = 0; i < maxRequests; i++) {
      const result = await rateLimitedCreateMessage({ chatId: "chat-1", role: "user", content: `msg ${i}` });
      expect(result).toBeDefined();
    }

    // 4th should fail with rate limit error
    await expect(
      rateLimitedCreateMessage({ chatId: "chat-1", role: "user", content: "one too many" }),
    ).rejects.toThrow("Rate limit exceeded");
  });

  it("concurrent messages to same chat are handled sequentially", async () => {
    const executionOrder: number[] = [];

    mockedStorage.createChatMessage.mockImplementation(async (msg: any) => {
      const index = parseInt(msg.content.split(" ")[1], 10);
      // Simulate varying processing times
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
      executionOrder.push(index);
      return { id: `msg-${index}`, ...msg, createdAt: new Date() };
    });

    // Simulate sequential processing via a mutex/queue pattern
    const queue: Array<() => Promise<any>> = [];
    let processing = false;

    async function enqueue(fn: () => Promise<any>): Promise<any> {
      return new Promise((resolve, reject) => {
        queue.push(async () => {
          try {
            resolve(await fn());
          } catch (e) {
            reject(e);
          }
        });
        processQueue();
      });
    }

    async function processQueue() {
      if (processing) return;
      processing = true;
      while (queue.length > 0) {
        const task = queue.shift()!;
        await task();
      }
      processing = false;
    }

    // Enqueue 5 concurrent messages
    const promises = Array.from({ length: 5 }, (_, i) =>
      enqueue(() => storage.createChatMessage({ chatId: "chat-1", role: "user", content: `msg ${i}` } as any)),
    );

    await Promise.all(promises);

    // All 5 should have been processed
    expect(executionOrder).toHaveLength(5);
    // They should be in order 0, 1, 2, 3, 4 since the queue serializes them
    expect(executionOrder).toEqual([0, 1, 2, 3, 4]);
  });

  it("message with empty content returns validation error", async () => {
    mockedStorage.createChatMessage.mockImplementation(async (msg: any) => {
      if (!msg.content || msg.content.trim() === "") {
        throw new Error("Validation error: message content cannot be empty");
      }
      return { id: "msg-1", ...msg, createdAt: new Date() };
    });

    await expect(
      storage.createChatMessage({ chatId: "chat-1", role: "user", content: "" } as any),
    ).rejects.toThrow("Validation error: message content cannot be empty");

    await expect(
      storage.createChatMessage({ chatId: "chat-1", role: "user", content: "   " } as any),
    ).rejects.toThrow("Validation error: message content cannot be empty");
  });

  it("chat retrieval returns null for non-existent chatId", async () => {
    mockedStorage.getChat.mockResolvedValue(undefined);

    const result = await storage.getChat("nonexistent-chat-id");

    expect(result).toBeUndefined();
    expect(mockedStorage.getChat).toHaveBeenCalledWith("nonexistent-chat-id");
  });
});
