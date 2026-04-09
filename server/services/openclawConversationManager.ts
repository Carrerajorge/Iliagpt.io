/**
 * OpenClaw Conversation Manager
 * Manages per-user OpenClaw conversations with isolation and persistence.
 * In-memory storage (Map) — production would use PostgreSQL via Drizzle.
 */

import { randomUUID } from "crypto";

// --- Types ---

export interface OpenClawMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

export interface OpenClawConversation {
  id: string;
  userId: string;
  title: string;
  messages: OpenClawMessage[];
  model: string;
  tokensUsed: number;
  createdAt: Date;
  updatedAt: Date;
  status: "active" | "archived";
}

// --- Helpers ---

const DEFAULT_MODEL = "openclaw-default";
const MAX_TITLE_LENGTH = 120;

function generateTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim();
  if (!trimmed) return "New conversation";
  if (trimmed.length <= MAX_TITLE_LENGTH) return trimmed;
  return trimmed.slice(0, MAX_TITLE_LENGTH - 3) + "...";
}

// --- Manager ---

export class OpenClawConversationManager {
  private conversations = new Map<string, OpenClawConversation>();

  /** Create a new conversation for a user */
  createConversation(
    userId: string,
    title?: string,
    model?: string,
  ): OpenClawConversation {
    const now = new Date();
    const conversation: OpenClawConversation = {
      id: randomUUID(),
      userId,
      title: title || "New conversation",
      messages: [],
      model: model || DEFAULT_MODEL,
      tokensUsed: 0,
      createdAt: now,
      updatedAt: now,
      status: "active",
    };
    this.conversations.set(conversation.id, conversation);
    return { ...conversation, messages: [...conversation.messages] };
  }

  /** Get conversation by ID (validates user ownership) */
  getConversation(
    conversationId: string,
    userId: string,
  ): OpenClawConversation | null {
    const conv = this.conversations.get(conversationId);
    if (!conv || conv.userId !== userId) return null;
    return { ...conv, messages: [...conv.messages] };
  }

  /** List conversations for a user, most recent first */
  listConversations(userId: string): OpenClawConversation[] {
    const results: OpenClawConversation[] = [];
    for (const conv of this.conversations.values()) {
      if (conv.userId === userId) {
        results.push({ ...conv, messages: [...conv.messages] });
      }
    }
    return results.sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    );
  }

  /** Add a message to a conversation */
  addMessage(
    conversationId: string,
    userId: string,
    role: "user" | "assistant",
    content: string,
  ): boolean {
    const conv = this.conversations.get(conversationId);
    if (!conv || conv.userId !== userId || conv.status !== "active") {
      return false;
    }

    conv.messages.push({
      role,
      content,
      timestamp: new Date(),
    });
    conv.updatedAt = new Date();

    // Auto-generate title from the first user message
    if (
      role === "user" &&
      conv.title === "New conversation" &&
      conv.messages.filter((m) => m.role === "user").length === 1
    ) {
      conv.title = generateTitle(content);
    }

    return true;
  }

  /** Update conversation metadata (title, tokens, status) */
  updateConversation(
    conversationId: string,
    updates: Partial<Pick<OpenClawConversation, "title" | "tokensUsed" | "status">>,
  ): boolean {
    const conv = this.conversations.get(conversationId);
    if (!conv) return false;

    if (updates.title !== undefined) conv.title = updates.title;
    if (updates.tokensUsed !== undefined) conv.tokensUsed = updates.tokensUsed;
    if (updates.status !== undefined) conv.status = updates.status;
    conv.updatedAt = new Date();

    return true;
  }

  /** Archive a conversation */
  archiveConversation(conversationId: string, userId: string): boolean {
    const conv = this.conversations.get(conversationId);
    if (!conv || conv.userId !== userId) return false;

    conv.status = "archived";
    conv.updatedAt = new Date();
    return true;
  }

  /** Delete a conversation */
  deleteConversation(conversationId: string, userId: string): boolean {
    const conv = this.conversations.get(conversationId);
    if (!conv || conv.userId !== userId) return false;

    this.conversations.delete(conversationId);
    return true;
  }

  /**
   * Get message history formatted for LLM API calls.
   * Returns the last N messages (default 50) in { role, content } format.
   */
  getContextMessages(
    conversationId: string,
    userId: string,
    maxMessages = 50,
  ): Array<{ role: string; content: string }> {
    const conv = this.conversations.get(conversationId);
    if (!conv || conv.userId !== userId) return [];
    if (maxMessages <= 0) return [];

    const slice = conv.messages.slice(-maxMessages);
    return slice.map((m) => ({ role: m.role, content: m.content }));
  }
}

export const openclawConversationManager = new OpenClawConversationManager();
