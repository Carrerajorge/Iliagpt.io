import { db } from "../db";
import { eq, and, desc, asc, sql, avg, count } from "drizzle-orm";
import {
  conversationStates,
  conversationStateVersions,
  conversationMessages,
  conversationArtifacts,
  conversationImages,
  conversationContexts,
  memoryFacts,
  runningSummaries,
  retrievalTelemetry,
  processedRequests,
  InsertConversationState,
  InsertConversationMessage,
  InsertConversationArtifact,
  InsertConversationImage,
  InsertConversationContext,
  InsertConversationStateVersion,
  InsertMemoryFact,
  InsertRunningSummary,
  InsertRetrievalTelemetry,
  ConversationState,
  ConversationMessage,
  ConversationArtifact,
  ConversationImage,
  ConversationContext,
  ConversationStateVersion,
  MemoryFact,
  RunningSummary,
  RetrievalTelemetry,
  HydratedConversationState,
  ProcessedRequest,
  chats,
} from "@shared/schema";

export class ConversationStateRepository {
  async findByChatId(chatId: string): Promise<ConversationState | null> {
    const [state] = await db
      .select()
      .from(conversationStates)
      .where(eq(conversationStates.chatId, chatId))
      .limit(1);
    return state || null;
  }

  async findById(id: string): Promise<ConversationState | null> {
    const [state] = await db
      .select()
      .from(conversationStates)
      .where(eq(conversationStates.id, id))
      .limit(1);
    return state || null;
  }

  async create(data: InsertConversationState): Promise<ConversationState> {
    const [state] = await db
      .insert(conversationStates)
      .values(data)
      .returning();
    return state;
  }

  async update(id: string, data: Partial<InsertConversationState>): Promise<ConversationState> {
    const [state] = await db
      .update(conversationStates)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(conversationStates.id, id))
      .returning();
    return state;
  }

  async incrementVersion(id: string): Promise<ConversationState> {
    const [state] = await db
      .update(conversationStates)
      .set({
        version: sql`${conversationStates.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(conversationStates.id, id))
      .returning();
    return state;
  }

  async getOrCreate(chatId: string, userId?: string): Promise<ConversationState> {
    const existing = await this.findByChatId(chatId);
    if (existing) return existing;

    // conversation_states.chat_id has an FK to chats.id. The frontend can generate a provisional chatId
    // before any "chat creation" endpoint is called, so we must ensure the parent row exists.
    await db
      .insert(chats)
      .values({
        id: chatId,
        userId: userId || null,
      })
      .onConflictDoNothing();

    return this.create({
      chatId,
      userId: userId || null,
      version: 1,
      totalTokens: 0,
      messageCount: 0,
      artifactCount: 0,
      imageCount: 0,
    });
  }

  async addMessage(data: InsertConversationMessage): Promise<ConversationMessage> {
    return db.transaction(async (tx) => {
      const [stateRow] = await tx
        .select({ messageCount: conversationStates.messageCount })
        .from(conversationStates)
        .where(eq(conversationStates.id, data.stateId))
        .for("update");

      const nextSequence = (stateRow?.messageCount ?? 0) + 1;

      const [message] = await tx
        .insert(conversationMessages)
        .values({ ...data, sequence: nextSequence })
        .returning();

      await tx
        .update(conversationStates)
        .set({
          messageCount: nextSequence,
          lastMessageId: message.id,
          totalTokens: sql`${conversationStates.totalTokens} + ${data.tokenCount || 0}`,
          updatedAt: new Date(),
        })
        .where(eq(conversationStates.id, data.stateId));

      return message;
    });
  }

  async getMessages(stateId: string): Promise<ConversationMessage[]> {
    return db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.stateId, stateId))
      .orderBy(asc(conversationMessages.sequence));
  }

  async addArtifact(data: InsertConversationArtifact): Promise<ConversationArtifact> {
    const [artifact] = await db
      .insert(conversationArtifacts)
      .values(data)
      .returning();

    await db
      .update(conversationStates)
      .set({
        artifactCount: sql`${conversationStates.artifactCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(conversationStates.id, data.stateId));

    return artifact;
  }

  async getArtifacts(stateId: string): Promise<ConversationArtifact[]> {
    return db
      .select()
      .from(conversationArtifacts)
      .where(eq(conversationArtifacts.stateId, stateId))
      .orderBy(desc(conversationArtifacts.createdAt));
  }

  async findArtifactByChecksum(stateId: string, checksum: string): Promise<ConversationArtifact | null> {
    const [artifact] = await db
      .select()
      .from(conversationArtifacts)
      .where(
        and(
          eq(conversationArtifacts.stateId, stateId),
          eq(conversationArtifacts.checksum, checksum)
        )
      )
      .limit(1);
    return artifact || null;
  }

  async addImage(data: InsertConversationImage): Promise<ConversationImage> {
    // Mark ALL previous images in this conversation as not latest
    await db
      .update(conversationImages)
      .set({ isLatest: "false" })
      .where(eq(conversationImages.stateId, data.stateId));

    const [image] = await db
      .insert(conversationImages)
      .values({ ...data, isLatest: "true" })
      .returning();

    await db
      .update(conversationStates)
      .set({
        imageCount: sql`${conversationStates.imageCount} + 1`,
        lastImageId: image.id,
        updatedAt: new Date(),
      })
      .where(eq(conversationStates.id, data.stateId));

    return image;
  }

  async getImages(stateId: string): Promise<ConversationImage[]> {
    return db
      .select()
      .from(conversationImages)
      .where(eq(conversationImages.stateId, stateId))
      .orderBy(desc(conversationImages.createdAt));
  }

  async getLatestImage(stateId: string): Promise<ConversationImage | null> {
    const [image] = await db
      .select()
      .from(conversationImages)
      .where(
        and(
          eq(conversationImages.stateId, stateId),
          eq(conversationImages.isLatest, "true")
        )
      )
      .limit(1);
    return image || null;
  }

  async getImageEditChain(imageId: string): Promise<ConversationImage[]> {
    const chain: ConversationImage[] = [];
    let currentId: string | null = imageId;

    while (currentId) {
      const [image] = await db
        .select()
        .from(conversationImages)
        .where(eq(conversationImages.id, currentId))
        .limit(1);

      if (!image) break;
      chain.unshift(image);
      currentId = image.parentImageId;
    }

    return chain;
  }

  async upsertContext(data: InsertConversationContext): Promise<ConversationContext> {
    const existing = await this.getContext(data.stateId);
    
    if (existing) {
      const [context] = await db
        .update(conversationContexts)
        .set({
          ...data,
          lastUpdatedAt: new Date(),
        })
        .where(eq(conversationContexts.stateId, data.stateId))
        .returning();
      return context;
    }

    const [context] = await db
      .insert(conversationContexts)
      .values(data)
      .returning();
    return context;
  }

  async getContext(stateId: string): Promise<ConversationContext | null> {
    const [context] = await db
      .select()
      .from(conversationContexts)
      .where(eq(conversationContexts.stateId, stateId))
      .limit(1);
    return context || null;
  }

  async createSnapshot(
    stateId: string,
    version: number,
    snapshot: object,
    changeDescription?: string,
    authorId?: string
  ): Promise<ConversationStateVersion> {
    const [versionRecord] = await db
      .insert(conversationStateVersions)
      .values({
        stateId,
        version,
        snapshot,
        changeDescription,
        authorId,
      })
      .returning();
    return versionRecord;
  }

  async getVersions(stateId: string): Promise<ConversationStateVersion[]> {
    return db
      .select()
      .from(conversationStateVersions)
      .where(eq(conversationStateVersions.stateId, stateId))
      .orderBy(desc(conversationStateVersions.version));
  }

  async getVersion(stateId: string, version: number): Promise<ConversationStateVersion | null> {
    const [versionRecord] = await db
      .select()
      .from(conversationStateVersions)
      .where(
        and(
          eq(conversationStateVersions.stateId, stateId),
          eq(conversationStateVersions.version, version)
        )
      )
      .limit(1);
    return versionRecord || null;
  }

  async hydrate(chatId: string): Promise<HydratedConversationState | null> {
    const state = await this.findByChatId(chatId);
    if (!state) return null;

    const [messages, artifacts, images, context] = await Promise.all([
      this.getMessages(state.id),
      this.getArtifacts(state.id),
      this.getImages(state.id),
      this.getContext(state.id),
    ]);

    return {
      id: state.id,
      chatId: state.chatId,
      userId: state.userId,
      version: state.version,
      totalTokens: state.totalTokens || 0,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        tokenCount: m.tokenCount || 0,
        sequence: m.sequence,
        attachmentIds: m.attachmentIds || [],
        imageIds: m.imageIds || [],
        createdAt: m.createdAt.toISOString(),
      })),
      artifacts: artifacts.map((a) => ({
        id: a.id,
        artifactType: a.artifactType,
        mimeType: a.mimeType,
        fileName: a.fileName,
        fileSize: a.fileSize,
        checksum: a.checksum,
        storageUrl: a.storageUrl,
        extractedText: a.extractedText,
        metadata: a.metadata,
        processingStatus: a.processingStatus,
        createdAt: a.createdAt.toISOString(),
      })),
      images: images.map((i) => ({
        id: i.id,
        parentImageId: i.parentImageId,
        prompt: i.prompt,
        imageUrl: i.imageUrl,
        thumbnailUrl: i.thumbnailUrl,
        model: i.model,
        mode: i.mode,
        editHistory: i.editHistory || [],
        isLatest: i.isLatest,
        createdAt: i.createdAt.toISOString(),
      })),
      context: context
        ? {
            summary: context.summary,
            entities: (context.entities as any[]) || [],
            userPreferences: (context.userPreferences as Record<string, unknown>) || {},
            topics: context.topics || [],
            sentiment: context.sentiment,
          }
        : null,
      lastMessageId: state.lastMessageId,
      lastImageId: state.lastImageId,
      createdAt: state.createdAt.toISOString(),
      updatedAt: state.updatedAt.toISOString(),
    };
  }

  // Memory Facts methods
  async addMemoryFact(stateId: string, fact: Omit<InsertMemoryFact, 'stateId'>): Promise<MemoryFact> {
    const [memoryFact] = await db
      .insert(memoryFacts)
      .values({ ...fact, stateId })
      .returning();
    return memoryFact;
  }

  async getMemoryFacts(stateId: string): Promise<MemoryFact[]> {
    return db
      .select()
      .from(memoryFacts)
      .where(eq(memoryFacts.stateId, stateId))
      .orderBy(desc(memoryFacts.createdAt));
  }

  async updateMemoryFact(factId: string, updates: Partial<InsertMemoryFact>): Promise<MemoryFact> {
    const [memoryFact] = await db
      .update(memoryFacts)
      .set(updates)
      .where(eq(memoryFacts.id, factId))
      .returning();
    return memoryFact;
  }

  async deleteMemoryFact(factId: string): Promise<void> {
    await db
      .delete(memoryFacts)
      .where(eq(memoryFacts.id, factId));
  }

  // Running Summary methods
  async getRunningSummary(stateId: string): Promise<RunningSummary | null> {
    const [summary] = await db
      .select()
      .from(runningSummaries)
      .where(eq(runningSummaries.stateId, stateId))
      .limit(1);
    return summary || null;
  }

  async upsertRunningSummary(stateId: string, summary: Omit<InsertRunningSummary, 'stateId'>): Promise<RunningSummary> {
    const existing = await this.getRunningSummary(stateId);

    if (existing) {
      const [updated] = await db
        .update(runningSummaries)
        .set({
          ...summary,
          lastUpdatedAt: new Date(),
        })
        .where(eq(runningSummaries.stateId, stateId))
        .returning();
      return updated;
    }

    const [created] = await db
      .insert(runningSummaries)
      .values({ ...summary, stateId })
      .returning();
    return created;
  }

  async delete(chatId: string): Promise<void> {
    await db
      .delete(conversationStates)
      .where(eq(conversationStates.chatId, chatId));
  }

  async checkRequestProcessed(requestId: string): Promise<{ wasProcessed: boolean; messageId?: string }> {
    const [existing] = await db
      .select({ messageId: processedRequests.messageId })
      .from(processedRequests)
      .where(eq(processedRequests.requestId, requestId))
      .limit(1);

    if (existing) {
      return { wasProcessed: true, messageId: existing.messageId || undefined };
    }
    return { wasProcessed: false };
  }

  async recordProcessedRequest(requestId: string, stateId: string, messageId: string): Promise<void> {
    await db
      .insert(processedRequests)
      .values({
        requestId,
        stateId,
        messageId,
      })
      .onConflictDoNothing();
  }

  async saveTelemetry(
    stateId: string,
    data: {
      requestId: string;
      query: string;
      chunksRetrieved: number;
      totalTimeMs: number;
      topScores: any[];
      retrievalType?: string;
    }
  ): Promise<void> {
    await db.insert(retrievalTelemetry).values({
      stateId,
      requestId: data.requestId,
      query: data.query,
      chunksRetrieved: data.chunksRetrieved,
      totalTimeMs: data.totalTimeMs,
      topScores: data.topScores,
      retrievalType: data.retrievalType || null,
    });
  }

  async getTelemetryStats(
    stateId: string
  ): Promise<{ avgTimeMs: number; totalQueries: number; avgChunks: number }> {
    const result = await db
      .select({
        avgTimeMs: avg(retrievalTelemetry.totalTimeMs),
        totalQueries: count(),
        avgChunks: avg(retrievalTelemetry.chunksRetrieved),
      })
      .from(retrievalTelemetry)
      .where(eq(retrievalTelemetry.stateId, stateId));

    const stats = result[0];

    return {
      avgTimeMs: Number(stats?.avgTimeMs) || 0,
      totalQueries: Number(stats?.totalQueries) || 0,
      avgChunks: Number(stats?.avgChunks) || 0,
    };
  }
}

export const conversationStateRepository = new ConversationStateRepository();
