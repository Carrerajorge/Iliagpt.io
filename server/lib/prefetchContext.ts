import { LRUCache } from "lru-cache";
import { db } from "../db";
import { eq, desc } from "drizzle-orm";
import { chats, conversationStates, memoryFacts } from "@shared/schema";

interface PrefetchedContext {
  chatHistory: Array<{ role: string; content: string }>;
  userPreferences: Record<string, string>;
  recentTopics: string[];
  timestamp: number;
}

const contextCache = new LRUCache<string, PrefetchedContext>({
  max: 500,
  ttl: 60000,
});

const pendingPrefetches = new Map<string, Promise<PrefetchedContext | null>>();

export async function prefetchUserContext(
  userId: string,
  chatId?: string
): Promise<PrefetchedContext | null> {
  const cacheKey = `${userId}:${chatId || "default"}`;
  
  const cached = contextCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = pendingPrefetches.get(cacheKey);
  if (pending) {
    return pending;
  }

  const prefetchPromise = (async () => {
    try {
      const [chatHistory, userPrefs, recentTopics] = await Promise.all([
        chatId ? fetchChatHistory(chatId, 10) : Promise.resolve([]),
        fetchUserPreferences(userId),
        fetchRecentTopics(userId),
      ]);

      const context: PrefetchedContext = {
        chatHistory,
        userPreferences: userPrefs,
        recentTopics,
        timestamp: Date.now(),
      };

      contextCache.set(cacheKey, context);
      return context;
    } catch (error) {
      console.error("[PrefetchContext] Error:", error);
      return null;
    } finally {
      pendingPrefetches.delete(cacheKey);
    }
  })();

  pendingPrefetches.set(cacheKey, prefetchPromise);
  return prefetchPromise;
}

async function fetchChatHistory(
  chatId: string,
  limit: number
): Promise<Array<{ role: string; content: string }>> {
  try {
    const [chat] = await db
      .select()
      .from(chats)
      .where(eq(chats.id, chatId))
      .limit(1);

    if (!chat || !chat.messages) {
      return [];
    }

    const messages = chat.messages as Array<{ role: string; content: string }>;
    return messages.slice(-limit);
  } catch (error) {
    console.error("[PrefetchContext] Error fetching chat history:", error);
    return [];
  }
}

async function fetchUserPreferences(
  userId: string
): Promise<Record<string, string>> {
  try {
    const states = await db
      .select()
      .from(conversationStates)
      .where(eq(conversationStates.userId, userId))
      .orderBy(desc(conversationStates.updatedAt))
      .limit(1);

    if (states.length === 0) {
      return {};
    }

    const facts = await db
      .select()
      .from(memoryFacts)
      .where(eq(memoryFacts.stateId, states[0].id))
      .limit(20);

    const preferences: Record<string, string> = {};
    for (const fact of facts) {
      if (fact.factType === "user_preference") {
        const [key, ...valueParts] = fact.content.split(":");
        if (key && valueParts.length > 0) {
          preferences[key.trim()] = valueParts.join(":").trim();
        }
      }
    }

    return preferences;
  } catch (error) {
    console.error("[PrefetchContext] Error fetching preferences:", error);
    return {};
  }
}

async function fetchRecentTopics(userId: string): Promise<string[]> {
  try {
    const recentChats = await db
      .select()
      .from(chats)
      .where(eq(chats.userId, userId))
      .orderBy(desc(chats.updatedAt))
      .limit(5);

    const topics: string[] = [];
    for (const chat of recentChats) {
      if (chat.title && chat.title !== "Nueva conversación") {
        topics.push(chat.title);
      }
    }

    return topics;
  } catch (error) {
    console.error("[PrefetchContext] Error fetching topics:", error);
    return [];
  }
}

export function invalidateUserContext(userId: string, chatId?: string): void {
  if (chatId) {
    contextCache.delete(`${userId}:${chatId}`);
  } else {
    for (const key of contextCache.keys()) {
      if (key.startsWith(`${userId}:`)) {
        contextCache.delete(key);
      }
    }
  }
}

export function getCachedContext(
  userId: string,
  chatId?: string
): PrefetchedContext | null {
  const cacheKey = `${userId}:${chatId || "default"}`;
  return contextCache.get(cacheKey) || null;
}

export function startPrefetchOnTyping(
  userId: string,
  chatId?: string,
  inputLength?: number
): void {
  if (!inputLength || inputLength < 5) {
    return;
  }

  prefetchUserContext(userId, chatId).catch(() => {
  });
}

export default {
  prefetchUserContext,
  invalidateUserContext,
  getCachedContext,
  startPrefetchOnTyping,
};
