import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HydratedConversationState } from "@shared/schema";

vi.mock("../../repositories/conversationStateRepository", () => ({
  conversationStateRepository: {
    hydrate: vi.fn(),
    getOrCreate: vi.fn(),
    findByChatId: vi.fn(),
    addMessage: vi.fn(),
    addArtifact: vi.fn(),
    addImage: vi.fn(),
    findArtifactByChecksum: vi.fn(),
    getImageEditChain: vi.fn(),
    createSnapshot: vi.fn(),
    incrementVersion: vi.fn(),
    getVersion: vi.fn(),
    getVersions: vi.fn(),
  },
}));

vi.mock("../../lib/redisConversationCache", () => ({
  redisConversationCache: {
    get: vi.fn(),
    set: vi.fn(),
    invalidateAll: vi.fn(),
  },
}));

import { conversationStateService } from "../conversationStateService";
import { conversationStateRepository } from "../../repositories/conversationStateRepository";
import { redisConversationCache } from "../../lib/redisConversationCache";

const mockRepository = vi.mocked(conversationStateRepository);
const mockCache = vi.mocked(redisConversationCache);

function createMockState(chatId: string, overrides: Partial<HydratedConversationState> = {}): HydratedConversationState {
  return {
    id: "state-123",
    chatId,
    userId: null,
    version: 1,
    totalTokens: 0,
    messages: [],
    artifacts: [],
    images: [],
    context: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("ConversationStateService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("hydrateState", () => {
    it("returns null for non-existent chatId", async () => {
      mockCache.get.mockResolvedValue(null);
      mockRepository.hydrate.mockResolvedValue(null);

      const result = await conversationStateService.hydrateState("non-existent-chat");

      expect(result).toBeNull();
      expect(mockRepository.hydrate).toHaveBeenCalledWith("non-existent-chat");
    });

    it("returns cached state when available", async () => {
      const cachedState = createMockState("chat-123");
      mockCache.get.mockResolvedValue(cachedState);

      const result = await conversationStateService.hydrateState("chat-123");

      expect(result).toEqual(cachedState);
      expect(mockRepository.hydrate).not.toHaveBeenCalled();
    });

    it("fetches from DB and caches when cache miss", async () => {
      const dbState = createMockState("chat-123");
      mockCache.get.mockResolvedValue(null);
      mockRepository.hydrate.mockResolvedValue(dbState);

      const result = await conversationStateService.hydrateState("chat-123");

      expect(result).toEqual(dbState);
      expect(mockCache.set).toHaveBeenCalledWith("chat-123", dbState, undefined);
    });
  });

  describe("appendMessage", () => {
    it("adds messages with correct sequence numbers", async () => {
      const dbState = { id: "state-123", version: 1, messageCount: 2 };
      const hydratedState = createMockState("chat-123", {
        messages: [
          { id: "msg-1", role: "user", content: "Hello", tokenCount: 2, sequence: 1, attachmentIds: [], imageIds: [], createdAt: new Date().toISOString() },
          { id: "msg-2", role: "assistant", content: "Hi", tokenCount: 1, sequence: 2, attachmentIds: [], imageIds: [], createdAt: new Date().toISOString() },
          { id: "msg-3", role: "user", content: "Test", tokenCount: 1, sequence: 3, attachmentIds: [], imageIds: [], createdAt: new Date().toISOString() },
        ],
      });

      mockRepository.getOrCreate.mockResolvedValue(dbState as any);
      mockRepository.addMessage.mockResolvedValue({ id: "msg-3", sequence: 3 } as any);
      mockCache.get.mockResolvedValue(null);
      mockRepository.hydrate.mockResolvedValue(hydratedState);

      const result = await conversationStateService.appendMessage("chat-123", "user", "Test");

      expect(mockRepository.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          stateId: "state-123",
          role: "user",
          content: "Test",
        })
      );
      expect(mockCache.invalidateAll).toHaveBeenCalledWith("chat-123");
      expect(result.messages).toHaveLength(3);
    });
  });

  describe("addArtifact", () => {
    it("deduplicates by checksum", async () => {
      const dbState = { id: "state-123", version: 1 };
      const existingArtifact = { id: "artifact-1", checksum: "abc123" };
      const hydratedState = createMockState("chat-123", {
        artifacts: [{ id: "artifact-1", artifactType: "document", mimeType: "application/pdf", fileName: "test.pdf", fileSize: 1000, checksum: "abc123", storageUrl: "url", extractedText: null, metadata: null, processingStatus: "completed", createdAt: new Date().toISOString() }],
      });

      mockRepository.getOrCreate.mockResolvedValue(dbState as any);
      mockRepository.findArtifactByChecksum.mockResolvedValue(existingArtifact as any);
      mockCache.get.mockResolvedValue(hydratedState);

      const fileContent = Buffer.from("test content");
      const result = await conversationStateService.addArtifact(
        "chat-123",
        "document",
        "application/pdf",
        "storage://test",
        "test.pdf",
        1000,
        fileContent
      );

      expect(mockRepository.addArtifact).not.toHaveBeenCalled();
      expect(result.artifacts).toHaveLength(1);
    });

    it("adds new artifact when no duplicate found", async () => {
      const dbState = { id: "state-123", version: 1 };
      const hydratedState = createMockState("chat-123", {
        artifacts: [{ id: "artifact-1", artifactType: "document", mimeType: "application/pdf", fileName: "new.pdf", fileSize: 2000, checksum: "xyz789", storageUrl: "url", extractedText: null, metadata: null, processingStatus: "completed", createdAt: new Date().toISOString() }],
      });

      mockRepository.getOrCreate.mockResolvedValue(dbState as any);
      mockRepository.findArtifactByChecksum.mockResolvedValue(null);
      mockRepository.addArtifact.mockResolvedValue({ id: "artifact-1" } as any);
      mockCache.get.mockResolvedValue(null);
      mockRepository.hydrate.mockResolvedValue(hydratedState);

      const fileContent = Buffer.from("new content");
      await conversationStateService.addArtifact(
        "chat-123",
        "document",
        "application/pdf",
        "storage://new",
        "new.pdf",
        2000,
        fileContent
      );

      expect(mockRepository.addArtifact).toHaveBeenCalledWith(
        expect.objectContaining({
          stateId: "state-123",
          artifactType: "document",
          mimeType: "application/pdf",
        })
      );
    });
  });

  describe("addImage", () => {
    it("tracks edit chains correctly with parentImageId", async () => {
      const dbState = { id: "state-123", version: 1 };
      const hydratedState = createMockState("chat-123", {
        images: [
          { id: "img-1", parentImageId: null, prompt: "original", imageUrl: "url1", thumbnailUrl: null, model: "dalle", mode: "generate", editHistory: [], isLatest: "false", createdAt: new Date().toISOString() },
          { id: "img-2", parentImageId: "img-1", prompt: "edited", imageUrl: "url2", thumbnailUrl: null, model: "dalle", mode: "edit_last", editHistory: [], isLatest: "true", createdAt: new Date().toISOString() },
        ],
      });

      mockRepository.getOrCreate.mockResolvedValue(dbState as any);
      mockRepository.addImage.mockResolvedValue({ id: "img-2" } as any);
      mockCache.get.mockResolvedValue(null);
      mockRepository.hydrate.mockResolvedValue(hydratedState);

      const result = await conversationStateService.addImage(
        "chat-123",
        "edited",
        "url2",
        "dalle",
        "edit_last",
        { parentImageId: "img-1" }
      );

      expect(mockRepository.addImage).toHaveBeenCalledWith(
        expect.objectContaining({
          stateId: "state-123",
          parentImageId: "img-1",
          mode: "edit_last",
        })
      );
      expect(result.images).toHaveLength(2);
      expect(result.images[1].parentImageId).toBe("img-1");
    });
  });

  describe("createSnapshot / restoreToVersion", () => {
    it("creates snapshot and increments version", async () => {
      const dbState = { id: "state-123", version: 1, chatId: "chat-123" };
      const hydratedState = createMockState("chat-123", { version: 1 });

      mockCache.get.mockResolvedValue(null);
      mockRepository.hydrate.mockResolvedValue(hydratedState);
      mockRepository.findByChatId.mockResolvedValue(dbState as any);
      mockRepository.createSnapshot.mockResolvedValue({ version: 2 } as any);
      mockRepository.incrementVersion.mockResolvedValue({ version: 2 } as any);

      const newVersion = await conversationStateService.createSnapshot("chat-123", "test snapshot");

      expect(newVersion).toBe(2);
      expect(mockRepository.createSnapshot).toHaveBeenCalledWith(
        "state-123",
        2,
        expect.any(Object),
        "test snapshot",
        undefined
      );
      expect(mockRepository.incrementVersion).toHaveBeenCalledWith("state-123");
    });

    it("restores to a specific version", async () => {
      const dbState = { id: "state-123", version: 3 };
      const snapshotState = createMockState("chat-123", { version: 2 });
      const versionRecord = { version: 2, snapshot: snapshotState, createdAt: new Date() };

      mockRepository.findByChatId.mockResolvedValue(dbState as any);
      mockRepository.getVersion.mockResolvedValue(versionRecord as any);

      const result = await conversationStateService.restoreToVersion("chat-123", 2);

      expect(result).toEqual(snapshotState);
      expect(mockCache.invalidateAll).toHaveBeenCalledWith("chat-123");
    });

    it("throws error when version not found", async () => {
      const dbState = { id: "state-123", version: 3 };

      mockRepository.findByChatId.mockResolvedValue(dbState as any);
      mockRepository.getVersion.mockResolvedValue(null);

      await expect(
        conversationStateService.restoreToVersion("chat-123", 99)
      ).rejects.toThrow("Version 99 not found for chat chat-123");
    });
  });
});
