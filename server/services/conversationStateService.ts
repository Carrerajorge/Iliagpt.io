import { conversationStateRepository } from "../repositories/conversationStateRepository";
import { redisConversationCache } from "../lib/redisConversationCache";
import {
  HydratedConversationState,
  InsertConversationMessage,
  InsertConversationArtifact,
  InsertConversationImage,
  ConversationContextData,
  ImageEditHistory,
  InsertMemoryFact,
  InsertRunningSummary,
  MemoryFact,
  RunningSummary,
} from "@shared/schema";
import { IntentRouter, DetectedIntent, ConversationState as IntentState } from "../lib/intentRouter";
import { RAGRetriever, SearchResult, SearchOptions } from "../lib/ragRetriever";
import { KeywordExtractor } from "../lib/keywordExtractor";
import crypto from "crypto";

export interface AppendMessageOptions {
  chatMessageId?: string;
  tokenCount?: number;
  attachmentIds?: string[];
  imageIds?: string[];
  metadata?: Record<string, unknown>;
  requestId?: string;
}

export interface AddArtifactOptions {
  messageId?: string;
  extractedText?: string;
  metadata?: Record<string, unknown>;
}

export interface AddImageOptions {
  messageId?: string;
  parentImageId?: string;
  thumbnailUrl?: string;
  base64Preview?: string;
  width?: number;
  height?: number;
  editHistory?: ImageEditHistory[];
}

export interface HydrateOptions {
  forceRefresh?: boolean;
  includeVersionHistory?: boolean;
}

class ConversationStateService {
  private ragRetrievers: Map<string, RAGRetriever> = new Map();

  async hydrateState(
    chatId: string,
    userId?: string,
    options: HydrateOptions = {}
  ): Promise<HydratedConversationState | null> {
    if (!options.forceRefresh) {
      const cached = await redisConversationCache.get(chatId, userId);
      if (cached) {
        console.log(`[ConversationStateService] Returning cached state for ${chatId}`);
        return cached;
      }
    }

    console.log(`[ConversationStateService] Hydrating state from DB for ${chatId}`);
    const state = await conversationStateRepository.hydrate(chatId);
    
    if (state) {
      await redisConversationCache.set(chatId, state, userId);
    }

    return state;
  }

  async getOrCreateState(chatId: string, userId?: string): Promise<HydratedConversationState> {
    let state = await this.hydrateState(chatId, userId);
    
    if (!state) {
      console.log(`[ConversationStateService] Creating new state for ${chatId}`);
      const newState = await conversationStateRepository.getOrCreate(chatId, userId);
      state = await conversationStateRepository.hydrate(chatId);
      
      if (state) {
        await redisConversationCache.set(chatId, state, userId);
      }
    }

    return state!;
  }

  async appendMessage(
    chatId: string,
    role: "user" | "assistant" | "system",
    content: string,
    options: AppendMessageOptions = {}
  ): Promise<HydratedConversationState> {
    if (options.requestId) {
      const { wasProcessed, messageId } = await conversationStateRepository.checkRequestProcessed(options.requestId);
      if (wasProcessed) {
        console.log(`[ConversationStateService] Request ${options.requestId} already processed, returning cached state`);
        return this.hydrateState(chatId, undefined, { forceRefresh: false }) as Promise<HydratedConversationState>;
      }
    }

    const dbState = await conversationStateRepository.getOrCreate(chatId);

    const keywords = KeywordExtractor.extract(content, 10);

    const messageData: InsertConversationMessage = {
      stateId: dbState.id,
      chatMessageId: options.chatMessageId || null,
      role,
      content,
      tokenCount: options.tokenCount || this.estimateTokens(content),
      sequence: 0,
      attachmentIds: options.attachmentIds || [],
      imageIds: options.imageIds || [],
      keywords,
      metadata: options.metadata || null,
    };

    const persistedMessage = await conversationStateRepository.addMessage(messageData);

    if (options.requestId) {
      await conversationStateRepository.recordProcessedRequest(options.requestId, dbState.id, persistedMessage.id);
    }

    await redisConversationCache.invalidateAll(chatId);

    const retriever = this.ragRetrievers.get(chatId);
    if (retriever) {
      retriever.indexMessage({ messageId: persistedMessage.id, content, role });
    }

    return this.hydrateState(chatId, undefined, { forceRefresh: true }) as Promise<HydratedConversationState>;
  }

  async addArtifact(
    chatId: string,
    artifactType: string,
    mimeType: string,
    storageUrl: string,
    fileName?: string,
    fileSize?: number,
    fileContent?: Buffer,
    options: AddArtifactOptions = {}
  ): Promise<HydratedConversationState> {
    const dbState = await conversationStateRepository.getOrCreate(chatId);
    
    const checksum = fileContent 
      ? crypto.createHash("sha256").update(fileContent).digest("hex")
      : null;

    if (checksum) {
      const existing = await conversationStateRepository.findArtifactByChecksum(dbState.id, checksum);
      if (existing) {
        console.log(`[ConversationStateService] Artifact with same checksum already exists: ${checksum.slice(0, 8)}`);
        return this.hydrateState(chatId) as Promise<HydratedConversationState>;
      }
    }

    const artifactData: InsertConversationArtifact = {
      stateId: dbState.id,
      messageId: options.messageId || null,
      artifactType,
      mimeType,
      fileName: fileName || null,
      fileSize: fileSize || null,
      checksum,
      storageUrl,
      extractedText: options.extractedText || null,
      metadata: options.metadata || null,
      processingStatus: "completed",
    };

    await conversationStateRepository.addArtifact(artifactData);
    await redisConversationCache.invalidateAll(chatId);

    return this.hydrateState(chatId, undefined, { forceRefresh: true }) as Promise<HydratedConversationState>;
  }

  async addImage(
    chatId: string,
    prompt: string,
    imageUrl: string,
    model: string,
    mode: "generate" | "edit_last" | "edit_specific" = "generate",
    options: AddImageOptions = {}
  ): Promise<HydratedConversationState> {
    const dbState = await conversationStateRepository.getOrCreate(chatId);

    const imageData: InsertConversationImage = {
      stateId: dbState.id,
      messageId: options.messageId || null,
      parentImageId: options.parentImageId || null,
      prompt,
      imageUrl,
      thumbnailUrl: options.thumbnailUrl || null,
      base64Preview: options.base64Preview || null,
      model,
      mode,
      width: options.width || null,
      height: options.height || null,
      editHistory: options.editHistory || [],
    };

    await conversationStateRepository.addImage(imageData);
    await redisConversationCache.invalidateAll(chatId);

    return this.hydrateState(chatId, undefined, { forceRefresh: true }) as Promise<HydratedConversationState>;
  }

  async updateContext(
    chatId: string,
    contextUpdate: Partial<ConversationContextData>
  ): Promise<HydratedConversationState> {
    const dbState = await conversationStateRepository.getOrCreate(chatId);
    const existingContext = await conversationStateRepository.getContext(dbState.id);

    const mergedContext = {
      stateId: dbState.id,
      summary: contextUpdate.summary ?? existingContext?.summary ?? null,
      entities: contextUpdate.entities ?? (existingContext?.entities as any[]) ?? [],
      userPreferences: {
        ...(existingContext?.userPreferences as Record<string, unknown> ?? {}),
        ...(contextUpdate.userPreferences ?? {}),
      },
      topics: contextUpdate.topics ?? existingContext?.topics ?? [],
      sentiment: contextUpdate.sentiment ?? existingContext?.sentiment ?? null,
    };

    await conversationStateRepository.upsertContext(mergedContext);
    await redisConversationCache.invalidateAll(chatId);

    return this.hydrateState(chatId, undefined, { forceRefresh: true }) as Promise<HydratedConversationState>;
  }

  async createSnapshot(
    chatId: string,
    changeDescription?: string,
    authorId?: string
  ): Promise<number> {
    const state = await this.hydrateState(chatId, undefined, { forceRefresh: true });
    if (!state) throw new Error(`No state found for chat ${chatId}`);

    const dbState = await conversationStateRepository.findByChatId(chatId);
    if (!dbState) throw new Error(`No DB state found for chat ${chatId}`);

    const newVersion = dbState.version + 1;
    
    await conversationStateRepository.createSnapshot(
      dbState.id,
      newVersion,
      state as unknown as object,
      changeDescription,
      authorId
    );

    await conversationStateRepository.incrementVersion(dbState.id);
    await redisConversationCache.invalidateAll(chatId);

    console.log(`[ConversationStateService] Created snapshot v${newVersion} for ${chatId}`);
    return newVersion;
  }

  async restoreToVersion(chatId: string, version: number): Promise<HydratedConversationState | null> {
    const dbState = await conversationStateRepository.findByChatId(chatId);
    if (!dbState) return null;

    const versionRecord = await conversationStateRepository.getVersion(dbState.id, version);
    if (!versionRecord) {
      throw new Error(`Version ${version} not found for chat ${chatId}`);
    }

    console.log(`[ConversationStateService] Restoring ${chatId} to version ${version}`);
    await redisConversationCache.invalidateAll(chatId);
    return versionRecord.snapshot as unknown as HydratedConversationState;
  }

  async getVersionHistory(chatId: string): Promise<Array<{ version: number; createdAt: string; description?: string }>> {
    const dbState = await conversationStateRepository.findByChatId(chatId);
    if (!dbState) return [];

    const versions = await conversationStateRepository.getVersions(dbState.id);
    return versions.map((v) => ({
      version: v.version,
      createdAt: v.createdAt.toISOString(),
      description: v.changeDescription || undefined,
    }));
  }

  async getLatestImage(chatId: string): Promise<{
    id: string;
    imageUrl: string;
    base64Preview: string | null;
    prompt: string;
  } | null> {
    const dbState = await conversationStateRepository.findByChatId(chatId);
    if (!dbState) return null;

    const image = await conversationStateRepository.getLatestImage(dbState.id);
    if (!image) return null;

    return {
      id: image.id,
      imageUrl: image.imageUrl,
      base64Preview: image.base64Preview,
      prompt: image.prompt,
    };
  }

  async getImageEditChain(imageId: string): Promise<Array<{
    id: string;
    prompt: string;
    imageUrl: string;
    mode: string;
    createdAt: string;
  }>> {
    const chain = await conversationStateRepository.getImageEditChain(imageId);
    return chain.map((img) => ({
      id: img.id,
      prompt: img.prompt,
      imageUrl: img.imageUrl,
      mode: img.mode || "generate",
      createdAt: img.createdAt.toISOString(),
    }));
  }

  async deleteState(chatId: string): Promise<void> {
    await conversationStateRepository.delete(chatId);
    await redisConversationCache.invalidateAll(chatId);
    console.log(`[ConversationStateService] Deleted state for ${chatId}`);
  }

  async analyzeIntent(chatId: string, message: string): Promise<DetectedIntent> {
    const state = await this.hydrateState(chatId);
    const intentState: IntentState = {
      artifacts: state?.artifacts || [],
      images: state?.images || []
    };
    return IntentRouter.detectIntent(message, intentState);
  }

  async searchContext(
    chatId: string,
    query: string,
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    let retriever = this.ragRetrievers.get(chatId);
    if (!retriever) {
      retriever = new RAGRetriever(chatId);
      const state = await this.hydrateState(chatId);
      if (state) {
        for (const msg of state.messages) {
          retriever.indexMessage({ messageId: msg.id, content: msg.content, role: msg.role });
        }
        for (const art of state.artifacts) {
          retriever.indexArtifact({ artifactId: art.id, extractedText: art.extractedText || undefined });
        }
        for (const img of state.images) {
          retriever.indexImage({ imageId: img.id, prompt: img.prompt });
        }
      }
      this.ragRetrievers.set(chatId, retriever);
    }
    return retriever.search(query, options);
  }

  async addMemoryFact(chatId: string, fact: Omit<InsertMemoryFact, 'stateId'>): Promise<MemoryFact> {
    const dbState = await conversationStateRepository.getOrCreate(chatId);
    return conversationStateRepository.addMemoryFact(dbState.id, fact);
  }

  async getMemoryFacts(chatId: string): Promise<MemoryFact[]> {
    const dbState = await conversationStateRepository.findByChatId(chatId);
    if (!dbState) return [];
    return conversationStateRepository.getMemoryFacts(dbState.id);
  }

  async updateMemoryFact(factId: string, updates: Partial<InsertMemoryFact>): Promise<MemoryFact | null> {
    return conversationStateRepository.updateMemoryFact(factId, updates);
  }

  async deleteMemoryFact(factId: string): Promise<void> {
    await conversationStateRepository.deleteMemoryFact(factId);
  }

  async getSummary(chatId: string): Promise<RunningSummary | null> {
    const dbState = await conversationStateRepository.findByChatId(chatId);
    if (!dbState) return null;
    return conversationStateRepository.getRunningSummary(dbState.id);
  }

  async updateSummary(chatId: string, summary: Omit<InsertRunningSummary, 'stateId'>): Promise<RunningSummary> {
    const dbState = await conversationStateRepository.getOrCreate(chatId);
    return conversationStateRepository.upsertRunningSummary(dbState.id, summary);
  }

  clearRAGCache(chatId: string): void {
    this.ragRetrievers.delete(chatId);
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  getCacheStats() {
    return redisConversationCache.getStats();
  }
}

export const conversationStateService = new ConversationStateService();
