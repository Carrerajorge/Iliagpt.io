/**
 * Chat GraphQL Resolvers
 * Handles: Chats, Messages, search, and real-time subscriptions
 */

import { EventEmitter } from "events";
import { GraphQLError } from "graphql";
import { eq, desc, and, sql, like, gt, lt } from "drizzle-orm";
import { db, db as dbRead } from "../../db.js";
import { Logger } from "../../lib/logger.js";
import { chats, chatMessages } from "../../../shared/schema.js";
import type { GraphQLContext } from "../middleware/auth.js";

// ─── Simple PubSub backed by EventEmitter ────────────────────────────────────

class PubSub {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  publish(topic: string, payload: unknown): void {
    this.emitter.emit(topic, payload);
  }

  asyncIterator<T>(topics: string | string[]): AsyncIterator<T> {
    const topicList = Array.isArray(topics) ? topics : [topics];
    const queue: T[] = [];
    const resolvers: Array<(value: IteratorResult<T>) => void> = [];
    let done = false;

    const listener = (payload: T) => {
      if (resolvers.length > 0) {
        const resolve = resolvers.shift()!;
        resolve({ value: payload, done: false });
      } else {
        queue.push(payload);
      }
    };

    topicList.forEach((t) => this.emitter.on(t, listener));

    return {
      next(): Promise<IteratorResult<T>> {
        if (queue.length > 0) {
          return Promise.resolve({ value: queue.shift()!, done: false });
        }
        if (done) {
          return Promise.resolve({ value: undefined as any, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => resolvers.push(resolve));
      },
      return(): Promise<IteratorResult<T>> {
        done = true;
        topicList.forEach((t) => this.emitter.off(t, listener));
        resolvers.forEach((r) => r({ value: undefined as any, done: true }));
        return Promise.resolve({ value: undefined as any, done: true });
      },
      throw(error?: unknown): Promise<IteratorResult<T>> {
        done = true;
        topicList.forEach((t) => this.emitter.off(t, listener));
        return Promise.reject(error);
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }
}

export const pubsub = new PubSub();

// ─── Topic helpers ────────────────────────────────────────────────────────────
const TOPICS = {
  MESSAGE_ADDED: (chatId: string) => `MESSAGE_ADDED_${chatId}`,
  CHAT_UPDATED: (userId: string) => `CHAT_UPDATED_${userId}`,
  AGENT_STATUS: (agentId: string) => `AGENT_STATUS_${agentId}`,
};

// ─── Cursor helpers ───────────────────────────────────────────────────────────
function encodeCursor(val: string): string {
  return Buffer.from(val).toString("base64");
}
function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, "base64").toString("utf-8");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function assertAuth(ctx: GraphQLContext): asserts ctx is GraphQLContext & { user: NonNullable<GraphQLContext["user"]> } {
  if (!ctx.user?.id) {
    throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHENTICATED" } });
  }
}

function mapChatStatus(c: typeof chats.$inferSelect) {
  if (c.deletedAt) return "DELETED";
  if (c.archived === "true") return "ARCHIVED";
  return "ACTIVE";
}

// ─── Resolvers ────────────────────────────────────────────────────────────────
export const chatResolvers = {
  Query: {
    async chats(
      _: unknown,
      args: { filter?: { status?: string; search?: string; gptId?: string; from?: string; to?: string }; limit?: number; offset?: number },
      ctx: GraphQLContext
    ) {
      assertAuth(ctx);
      const limit = Math.min(args.limit ?? 20, 100);
      const offset = args.offset ?? 0;

      try {
        Logger.info("[GraphQL] chats query", { userId: ctx.user.id, limit, offset });

        const conditions = [eq(chats.userId, ctx.user.id)];

        // Status filter
        if (args.filter?.status === "ARCHIVED") {
          conditions.push(eq(chats.archived, "true"));
        } else if (args.filter?.status === "DELETED") {
          // show deleted only for admins – regular users can't see deleted
          if (ctx.user.role !== "admin") {
            throw new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } });
          }
        } else {
          // Default: exclude deleted
          conditions.push(sql`${chats.deletedAt} IS NULL`);
        }

        if (args.filter?.gptId) {
          conditions.push(eq(chats.gptId, args.filter.gptId));
        }

        const rows = await dbRead
          .select()
          .from(chats)
          .where(and(...conditions))
          .orderBy(desc(chats.updatedAt))
          .limit(limit + 1)
          .offset(offset);

        const hasNextPage = rows.length > limit;
        const items = hasNextPage ? rows.slice(0, limit) : rows;

        return {
          edges: items.map((c) => ({ node: { ...c, status: mapChatStatus(c), archived: c.archived === "true", pinned: c.pinned === "true" }, cursor: encodeCursor(c.id) })),
          pageInfo: {
            hasNextPage,
            hasPreviousPage: offset > 0,
            startCursor: items.length > 0 ? encodeCursor(items[0].id) : null,
            endCursor: items.length > 0 ? encodeCursor(items[items.length - 1].id) : null,
            totalCount: items.length,
          },
        };
      } catch (err) {
        Logger.error("[GraphQL] chats query failed", err);
        throw err instanceof GraphQLError ? err : new GraphQLError("Failed to fetch chats");
      }
    },

    async chat(_: unknown, args: { id: string }, ctx: GraphQLContext) {
      assertAuth(ctx);
      try {
        Logger.info("[GraphQL] chat query", { chatId: args.id, userId: ctx.user.id });

        const [row] = await dbRead
          .select()
          .from(chats)
          .where(and(eq(chats.id, args.id), eq(chats.userId, ctx.user.id)))
          .limit(1);

        if (!row) return null;
        return { ...row, status: mapChatStatus(row), archived: row.archived === "true", pinned: row.pinned === "true" };
      } catch (err) {
        Logger.error("[GraphQL] chat query failed", err);
        throw new GraphQLError("Failed to fetch chat");
      }
    },

    async messages(
      _: unknown,
      args: { chatId: string; limit?: number; cursor?: string },
      ctx: GraphQLContext
    ) {
      assertAuth(ctx);
      const limit = Math.min(args.limit ?? 30, 100);

      try {
        Logger.info("[GraphQL] messages query", { chatId: args.chatId, userId: ctx.user.id });

        // Verify chat ownership
        const [chat] = await dbRead
          .select({ id: chats.id })
          .from(chats)
          .where(and(eq(chats.id, args.chatId), eq(chats.userId, ctx.user.id)))
          .limit(1);

        if (!chat) {
          throw new GraphQLError("Chat not found or access denied", { extensions: { code: "NOT_FOUND" } });
        }

        const conditions = [eq(chatMessages.chatId, args.chatId)];
        if (args.cursor) {
          const decodedCursor = decodeCursor(args.cursor);
          conditions.push(lt(chatMessages.createdAt, new Date(decodedCursor)));
        }

        const rows = await dbRead
          .select()
          .from(chatMessages)
          .where(and(...conditions))
          .orderBy(desc(chatMessages.createdAt))
          .limit(limit + 1);

        const hasNextPage = rows.length > limit;
        const items = hasNextPage ? rows.slice(0, limit) : rows;

        return {
          edges: items.map((m) => ({
            node: {
              ...m,
              role: m.role.toUpperCase() as string,
              status: (m.status ?? "done").toUpperCase(),
            },
            cursor: encodeCursor(m.createdAt.toISOString()),
          })),
          pageInfo: {
            hasNextPage,
            hasPreviousPage: !!args.cursor,
            startCursor: items.length > 0 ? encodeCursor(items[0].createdAt.toISOString()) : null,
            endCursor: items.length > 0 ? encodeCursor(items[items.length - 1].createdAt.toISOString()) : null,
            totalCount: items.length,
          },
        };
      } catch (err) {
        Logger.error("[GraphQL] messages query failed", err);
        throw err instanceof GraphQLError ? err : new GraphQLError("Failed to fetch messages");
      }
    },

    async searchMessages(
      _: unknown,
      args: { query: string; limit?: number },
      ctx: GraphQLContext
    ) {
      assertAuth(ctx);
      const limit = Math.min(args.limit ?? 10, 50);
      const searchTerm = `%${args.query}%`;

      try {
        Logger.info("[GraphQL] searchMessages", { userId: ctx.user.id, query: args.query });

        // Join messages with chats to ensure ownership
        const rows = await dbRead
          .select({
            message: chatMessages,
            chatTitle: chats.title,
          })
          .from(chatMessages)
          .innerJoin(chats, eq(chatMessages.chatId, chats.id))
          .where(
            and(
              eq(chats.userId, ctx.user.id),
              like(chatMessages.content, searchTerm),
              sql`${chats.deletedAt} IS NULL`
            )
          )
          .orderBy(desc(chatMessages.createdAt))
          .limit(limit);

        return rows.map((r) => ({
          message: {
            ...r.message,
            role: r.message.role.toUpperCase(),
            status: (r.message.status ?? "done").toUpperCase(),
          },
          chatTitle: r.chatTitle,
          score: 1.0, // Would be real FTS score in production
          highlight: r.message.content.substring(0, 200),
        }));
      } catch (err) {
        Logger.error("[GraphQL] searchMessages failed", err);
        throw new GraphQLError("Search failed");
      }
    },
  },

  Mutation: {
    async createChat(
      _: unknown,
      args: { input: { title?: string; gptId?: string; initialMessage?: string } },
      ctx: GraphQLContext
    ) {
      assertAuth(ctx);
      try {
        Logger.info("[GraphQL] createChat", { userId: ctx.user.id, gptId: args.input.gptId });

        const [newChat] = await db
          .insert(chats)
          .values({
            userId: ctx.user.id,
            title: args.input.title ?? "New Chat",
            gptId: args.input.gptId ?? null,
          })
          .returning();

        pubsub.publish(TOPICS.CHAT_UPDATED(ctx.user.id), {
          chatUpdated: { ...newChat, status: "ACTIVE", archived: false, pinned: false },
        });

        return { ...newChat, status: "ACTIVE", archived: false, pinned: false };
      } catch (err) {
        Logger.error("[GraphQL] createChat failed", err);
        throw new GraphQLError("Failed to create chat");
      }
    },

    async sendMessage(
      _: unknown,
      args: { input: { chatId: string; content: string; role?: string; attachments?: unknown; modelId?: string } },
      ctx: GraphQLContext
    ) {
      assertAuth(ctx);
      try {
        Logger.info("[GraphQL] sendMessage", { userId: ctx.user.id, chatId: args.input.chatId });

        // Verify chat ownership
        const [chat] = await db
          .select()
          .from(chats)
          .where(and(eq(chats.id, args.input.chatId), eq(chats.userId, ctx.user.id)))
          .limit(1);

        if (!chat) {
          throw new GraphQLError("Chat not found or access denied", { extensions: { code: "NOT_FOUND" } });
        }

        const role = (args.input.role ?? "user").toLowerCase();

        const [message] = await db
          .insert(chatMessages)
          .values({
            chatId: args.input.chatId,
            role,
            content: args.input.content,
            status: "done",
            attachments: args.input.attachments as any ?? null,
          })
          .returning();

        // Update chat lastMessageAt and messageCount
        await db
          .update(chats)
          .set({
            lastMessageAt: new Date(),
            messageCount: sql`${chats.messageCount} + 1`,
            aiModelUsed: args.input.modelId ?? chat.aiModelUsed,
            updatedAt: new Date(),
          })
          .where(eq(chats.id, args.input.chatId));

        const normalized = {
          ...message,
          role: message.role.toUpperCase(),
          status: (message.status ?? "done").toUpperCase(),
        };

        pubsub.publish(TOPICS.MESSAGE_ADDED(args.input.chatId), { messageAdded: normalized });

        return normalized;
      } catch (err) {
        Logger.error("[GraphQL] sendMessage failed", err);
        throw err instanceof GraphQLError ? err : new GraphQLError("Failed to send message");
      }
    },

    async deleteChat(_: unknown, args: { id: string }, ctx: GraphQLContext) {
      assertAuth(ctx);
      try {
        Logger.info("[GraphQL] deleteChat", { userId: ctx.user.id, chatId: args.id });

        const result = await db
          .update(chats)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(chats.id, args.id), eq(chats.userId, ctx.user.id)));

        return true;
      } catch (err) {
        Logger.error("[GraphQL] deleteChat failed", err);
        throw new GraphQLError("Failed to delete chat");
      }
    },

    async archiveChat(_: unknown, args: { id: string }, ctx: GraphQLContext) {
      assertAuth(ctx);
      try {
        Logger.info("[GraphQL] archiveChat", { userId: ctx.user.id, chatId: args.id });

        const [updated] = await db
          .update(chats)
          .set({ archived: "true", updatedAt: new Date() })
          .where(and(eq(chats.id, args.id), eq(chats.userId, ctx.user.id)))
          .returning();

        if (!updated) {
          throw new GraphQLError("Chat not found", { extensions: { code: "NOT_FOUND" } });
        }

        const result = { ...updated, status: "ARCHIVED" as const, archived: true, pinned: updated.pinned === "true" };
        pubsub.publish(TOPICS.CHAT_UPDATED(ctx.user.id), { chatUpdated: result });
        return result;
      } catch (err) {
        Logger.error("[GraphQL] archiveChat failed", err);
        throw err instanceof GraphQLError ? err : new GraphQLError("Failed to archive chat");
      }
    },
  },

  Subscription: {
    messageAdded: {
      subscribe(_: unknown, args: { chatId: string }, ctx: GraphQLContext) {
        assertAuth(ctx);
        Logger.info("[GraphQL] subscription messageAdded", { chatId: args.chatId, userId: ctx.user?.id });
        return pubsub.asyncIterator(TOPICS.MESSAGE_ADDED(args.chatId));
      },
      resolve(payload: { messageAdded: unknown }) {
        return payload.messageAdded;
      },
    },

    chatUpdated: {
      subscribe(_: unknown, args: { userId: string }, ctx: GraphQLContext) {
        assertAuth(ctx);
        // Users can only subscribe to their own updates unless admin
        const targetUserId = ctx.user.role === "admin" ? args.userId : ctx.user.id;
        Logger.info("[GraphQL] subscription chatUpdated", { userId: targetUserId });
        return pubsub.asyncIterator(TOPICS.CHAT_UPDATED(targetUserId));
      },
      resolve(payload: { chatUpdated: unknown }) {
        return payload.chatUpdated;
      },
    },

    agentStatusChanged: {
      subscribe(_: unknown, args: { agentId: string }, ctx: GraphQLContext) {
        assertAuth(ctx);
        Logger.info("[GraphQL] subscription agentStatusChanged", { agentId: args.agentId });
        return pubsub.asyncIterator(TOPICS.AGENT_STATUS(args.agentId));
      },
      resolve(payload: { agentStatusChanged: unknown }) {
        return payload.agentStatusChanged;
      },
    },
  },

  // Field resolvers
  Chat: {
    async messages(parent: { id: string }, args: { limit?: number; cursor?: string }, ctx: GraphQLContext) {
      const limit = Math.min(args.limit ?? 20, 100);
      try {
        const conditions = [eq(chatMessages.chatId, parent.id)];
        if (args.cursor) {
          conditions.push(lt(chatMessages.createdAt, new Date(decodeCursor(args.cursor))));
        }
        const rows = await dbRead
          .select()
          .from(chatMessages)
          .where(and(...conditions))
          .orderBy(desc(chatMessages.createdAt))
          .limit(limit);

        return {
          edges: rows.map((m) => ({
            node: { ...m, role: m.role.toUpperCase(), status: (m.status ?? "done").toUpperCase() },
            cursor: encodeCursor(m.createdAt.toISOString()),
          })),
          pageInfo: { hasNextPage: false, hasPreviousPage: !!args.cursor, startCursor: null, endCursor: null, totalCount: rows.length },
        };
      } catch (err) {
        Logger.error("[GraphQL] Chat.messages resolver failed", err);
        return { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null, totalCount: 0 } };
      }
    },
  },

  Message: {
    async chat(parent: { chatId: string }, _: unknown, ctx: GraphQLContext) {
      if (!ctx.user?.id) return null;
      try {
        const [row] = await dbRead.select().from(chats).where(eq(chats.id, parent.chatId)).limit(1);
        if (!row) return null;
        return { ...row, status: mapChatStatus(row), archived: row.archived === "true", pinned: row.pinned === "true" };
      } catch {
        return null;
      }
    },
  },
};
