import { 
  type Chat, 
  type InsertChat, 
  type ChatMessage, 
  type InsertChatMessage,
  chats, 
  chatMessages 
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, sql, isNull } from "drizzle-orm";
import { knowledgeBaseService } from "../services/knowledgeBase";
import { 
  validateUserId, 
  validateResourceId, 
  validateOwnership,
  logRepositoryAction, 
  NotFoundError,
  OwnershipError,
  ValidationError 
} from "./baseRepository";

export class ChatRepository {
  async createChat(chat: InsertChat): Promise<Chat> {
    if (!chat.userId) {
      throw new ValidationError("userId is required to create chat");
    }
    logRepositoryAction({ action: "createChat", userId: chat.userId });
    
    const [result] = await db.insert(chats).values(chat).returning();
    return result;
  }

  async getChat(id: string): Promise<Chat | undefined> {
    validateResourceId(id, "Chat");
    logRepositoryAction({ action: "getChat", resourceId: id });
    
    const [result] = await db.select().from(chats).where(eq(chats.id, id));
    return result;
  }

  async getChatWithOwnershipCheck(id: string, userId: string): Promise<Chat> {
    validateResourceId(id, "Chat");
    validateUserId(userId);
    
    const chat = await this.getChat(id);
    if (!chat) {
      throw new NotFoundError("Chat", id);
    }
    validateOwnership(userId, chat.userId);
    return chat;
  }

  async getChats(userId?: string): Promise<Chat[]> {
    logRepositoryAction({ action: "getChats", userId });
    
    if (userId) {
      validateUserId(userId);
      return db.select().from(chats)
        .where(and(
          eq(chats.userId, userId),
          eq(chats.archived, 'false'),
          isNull(chats.deletedAt)
        ))
        .orderBy(desc(chats.updatedAt));
    }
    return db.select().from(chats)
      .where(and(
        eq(chats.archived, 'false'),
        isNull(chats.deletedAt)
      ))
      .orderBy(desc(chats.updatedAt));
  }

  async updateChat(id: string, updates: Partial<InsertChat>): Promise<Chat | undefined> {
    validateResourceId(id, "Chat");
    logRepositoryAction({ action: "updateChat", resourceId: id });
    
    const [result] = await db.update(chats)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(chats.id, id))
      .returning();
    return result;
  }

  async updateChatWithOwnershipCheck(
    id: string, 
    userId: string, 
    updates: Partial<InsertChat>
  ): Promise<Chat> {
    const chat = await this.getChatWithOwnershipCheck(id, userId);
    const updated = await this.updateChat(id, updates);
    if (!updated) {
      throw new NotFoundError("Chat", id);
    }
    return updated;
  }

  async deleteChat(id: string): Promise<void> {
    validateResourceId(id, "Chat");
    logRepositoryAction({ action: "deleteChat", resourceId: id });
    
    await db.delete(chats).where(eq(chats.id, id));
  }

  async deleteChatWithOwnershipCheck(id: string, userId: string): Promise<void> {
    await this.getChatWithOwnershipCheck(id, userId);
    await this.deleteChat(id);
  }

  async createChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    if (!message.chatId) {
      throw new ValidationError("chatId is required to create message");
    }
    logRepositoryAction({ action: "createChatMessage", resourceId: message.chatId });

    const [result] = await db.insert(chatMessages).values(message).returning();
    // Non-blocking: update chat timestamp without awaiting
    db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, message.chatId))
      .catch((error) => {
        console.warn("[ChatRepo] Failed to update chat updatedAt:", error?.message || error);
      });
    if (message.role === "user" || message.role === "assistant") {
      queueMicrotask(() => {
        knowledgeBaseService.ingestChatMessage({
          chatId: message.chatId,
          messageId: result.id,
          role: message.role,
          content: message.content,
        }).catch((error) => {
          console.warn("[Knowledge] Failed to ingest chat message:", error?.message || error);
        });
      });
    }
    return result;
  }

  async getChatMessages(chatId: string): Promise<ChatMessage[]> {
    validateResourceId(chatId, "Chat");
    logRepositoryAction({ action: "getChatMessages", resourceId: chatId });
    
    return db.select().from(chatMessages)
      .where(eq(chatMessages.chatId, chatId))
      .orderBy(chatMessages.createdAt);
  }

  async getChatMessagesWithOwnershipCheck(chatId: string, userId: string): Promise<ChatMessage[]> {
    await this.getChatWithOwnershipCheck(chatId, userId);
    return this.getChatMessages(chatId);
  }

  async updateChatMessageContent(
    id: string, 
    content: string, 
    status: string
  ): Promise<ChatMessage | undefined> {
    validateResourceId(id, "ChatMessage");
    logRepositoryAction({ action: "updateChatMessageContent", resourceId: id });
    
    const [result] = await db.update(chatMessages)
      .set({ content, status })
      .where(eq(chatMessages.id, id))
      .returning();
    return result;
  }

  async getArchivedChats(userId: string): Promise<Chat[]> {
    validateUserId(userId);
    logRepositoryAction({ action: "getArchivedChats", userId });
    
    return db.select().from(chats)
      .where(and(eq(chats.userId, userId), eq(chats.archived, 'true')))
      .orderBy(desc(chats.updatedAt));
  }

  async unarchiveChat(chatId: string): Promise<void> {
    validateResourceId(chatId, "Chat");
    logRepositoryAction({ action: "unarchiveChat", resourceId: chatId });
    
    await db.update(chats)
      .set({ archived: 'false', updatedAt: new Date() })
      .where(eq(chats.id, chatId));
  }

  async unarchiveChatWithOwnershipCheck(chatId: string, userId: string): Promise<void> {
    await this.getChatWithOwnershipCheck(chatId, userId);
    await this.unarchiveChat(chatId);
  }

  async archiveChat(chatId: string): Promise<void> {
    validateResourceId(chatId, "Chat");
    logRepositoryAction({ action: "archiveChat", resourceId: chatId });
    
    await db.update(chats)
      .set({ archived: 'true', updatedAt: new Date() })
      .where(eq(chats.id, chatId));
  }

  async archiveChatWithOwnershipCheck(chatId: string, userId: string): Promise<void> {
    await this.getChatWithOwnershipCheck(chatId, userId);
    await this.archiveChat(chatId);
  }

  async archiveAllChats(userId: string): Promise<number> {
    validateUserId(userId);
    logRepositoryAction({ action: "archiveAllChats", userId });
    
    const result = await db.update(chats)
      .set({ archived: 'true', updatedAt: new Date() })
      .where(and(eq(chats.userId, userId), eq(chats.archived, 'false')))
      .returning();
    return result.length;
  }

  async softDeleteChat(chatId: string): Promise<void> {
    validateResourceId(chatId, "Chat");
    logRepositoryAction({ action: "softDeleteChat", resourceId: chatId });
    
    await db.update(chats)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(chats.id, chatId));
  }

  async softDeleteChatWithOwnershipCheck(chatId: string, userId: string): Promise<void> {
    await this.getChatWithOwnershipCheck(chatId, userId);
    await this.softDeleteChat(chatId);
  }

  async softDeleteAllChats(userId: string): Promise<number> {
    validateUserId(userId);
    logRepositoryAction({ action: "softDeleteAllChats", userId });
    
    const result = await db.update(chats)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(chats.userId, userId), isNull(chats.deletedAt)))
      .returning();
    return result.length;
  }

  async getDeletedChats(userId: string): Promise<Chat[]> {
    validateUserId(userId);
    logRepositoryAction({ action: "getDeletedChats", userId });
    
    return db.select().from(chats)
      .where(and(eq(chats.userId, userId), sql`${chats.deletedAt} IS NOT NULL`))
      .orderBy(desc(chats.deletedAt));
  }

  async restoreDeletedChat(chatId: string): Promise<void> {
    validateResourceId(chatId, "Chat");
    logRepositoryAction({ action: "restoreDeletedChat", resourceId: chatId });
    
    await db.update(chats)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(chats.id, chatId));
  }

  async restoreDeletedChatWithOwnershipCheck(chatId: string, userId: string): Promise<void> {
    const chat = await this.getChat(chatId);
    if (!chat) {
      throw new NotFoundError("Chat", chatId);
    }
    validateOwnership(userId, chat.userId);
    await this.restoreDeletedChat(chatId);
  }

  async permanentlyDeleteChat(chatId: string): Promise<void> {
    validateResourceId(chatId, "Chat");
    logRepositoryAction({ action: "permanentlyDeleteChat", resourceId: chatId });
    
    await db.delete(chats).where(eq(chats.id, chatId));
  }

  async updateChatMessageStats(chatId: string): Promise<Chat | undefined> {
    validateResourceId(chatId, "Chat");
    logRepositoryAction({ action: "updateChatMessageStats", resourceId: chatId });
    
    const messages = await db.select().from(chatMessages)
      .where(eq(chatMessages.chatId, chatId))
      .orderBy(desc(chatMessages.createdAt));
    
    const messageCount = messages.length;
    const lastMessageAt = messages.length > 0 ? messages[0].createdAt : null;

    const [result] = await db.update(chats)
      .set({ 
        messageCount, 
        lastMessageAt,
        updatedAt: new Date() 
      })
      .where(eq(chats.id, chatId))
      .returning();
    return result;
  }
}

export const chatRepository = new ChatRepository();
export default chatRepository;
