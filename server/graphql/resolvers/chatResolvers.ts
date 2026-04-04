import { GraphQLError } from 'graphql';
import { eq, and, desc, asc, ilike, lt, gt, sql } from 'drizzle-orm';
import { PubSub, withFilter } from 'graphql-subscriptions';
import { db } from '../../db';
import { Logger } from '../../lib/logger';
import { chats, messages } from '../../../shared/schema';
import type { GraphQLContext } from '../index';

// ─── PubSub Events ────────────────────────────────────────────────────────────

export const pubsub = new PubSub();

const EVENTS = {
  MESSAGE_STREAM: 'MESSAGE_STREAM',
  CHAT_UPDATED: 'CHAT_UPDATED',
} as const;

// ─── Pagination Helpers ────────────────────────────────────────────────────────

interface PaginationInput {
  first?: number | null;
  after?: string | null;
  last?: number | null;
  before?: string | null;
}

interface Edge<T> {
  node: T;
  cursor: string;
}

interface Connection<T> {
  edges: Edge<T>[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
    totalCount: number;
  };
}

function encodeCursor(id: string, createdAt: Date): string {
  return Buffer.from(JSON.stringify({ id, t: createdAt.getTime() })).toString('base64');
}

function decodeCursor(cursor: string): { id: string; t: number } {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
  } catch {
    throw new GraphQLError('Invalid cursor', { extensions: { code: 'BAD_USER_INPUT' } });
  }
}

function buildConnection<T extends { id: string; createdAt: Date }>(
  items: T[],
  totalCount: number,
  pagination: PaginationInput,
  hasMore: boolean,
): Connection<T> {
  const edges = items.map((node) => ({
    node,
    cursor: encodeCursor(node.id, node.createdAt),
  }));

  return {
    edges,
    pageInfo: {
      hasNextPage: pagination.first != null ? hasMore : false,
      hasPreviousPage: pagination.last != null ? hasMore : false,
      startCursor: edges.length > 0 ? edges[0].cursor : null,
      endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
      totalCount,
    },
  };
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function normalizePageSize(first?: number | null, last?: number | null): number {
  const size = first ?? last ?? DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(1, size), MAX_PAGE_SIZE);
}

// ─── Authorization Helpers ────────────────────────────────────────────────────

function requireAuth(ctx: GraphQLContext): string {
  if (!ctx.userId) {
    throw new GraphQLError('Not authenticated', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }
  return ctx.userId;
}

async function requireChatOwner(
  chatId: string,
  userId: string,
): Promise<typeof chats.$inferSelect> {
  const [chat] = await db
    .select()
    .from(chats)
    .where(eq(chats.id, chatId))
    .limit(1);

  if (!chat) {
    throw new GraphQLError('Chat not found', {
      extensions: { code: 'NOT_FOUND' },
    });
  }

  if (chat.userId !== userId) {
    throw new GraphQLError('Forbidden: you do not own this chat', {
      extensions: { code: 'FORBIDDEN' },
    });
  }

  return chat;
}

// ─── Query Resolvers ──────────────────────────────────────────────────────────

const chatQueryResolvers = {
  async chats(
    _: unknown,
    args: { pagination?: PaginationInput | null; userId?: string | null },
    ctx: GraphQLContext,
  ) {
    const requesterId = requireAuth(ctx);
    // Admins may query any userId; regular users can only query their own
    const targetUserId =
      ctx.role === 'ADMIN' && args.userId ? args.userId : requesterId;

    const pagination = args.pagination ?? {};
    const limit = normalizePageSize(pagination.first, pagination.last);

    try {
      let cursorCondition;
      if (pagination.after) {
        const { t } = decodeCursor(pagination.after);
        cursorCondition = lt(chats.createdAt, new Date(t));
      } else if (pagination.before) {
        const { t } = decodeCursor(pagination.before);
        cursorCondition = gt(chats.createdAt, new Date(t));
      }

      const baseWhere = and(
        eq(chats.userId, targetUserId),
        cursorCondition,
      );

      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(chats)
          .where(baseWhere)
          .orderBy(pagination.last ? asc(chats.createdAt) : desc(chats.createdAt))
          .limit(limit + 1),
        db
          .select({ count: sql<number>`count(*)` })
          .from(chats)
          .where(eq(chats.userId, targetUserId)),
      ]);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const totalCount = Number(countResult[0]?.count ?? 0);

      Logger.info('Fetched chats', { userId: targetUserId, count: items.length });
      return buildConnection(items, totalCount, pagination, hasMore);
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to fetch chats', err);
      throw new GraphQLError('Failed to fetch chats', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },

  async chat(_: unknown, args: { id: string }, ctx: GraphQLContext) {
    const userId = requireAuth(ctx);

    try {
      const [chat] = await db
        .select()
        .from(chats)
        .where(eq(chats.id, args.id))
        .limit(1);

      if (!chat) return null;

      // Allow owners or admins
      if (chat.userId !== userId && ctx.role !== 'ADMIN') {
        // Check if shared
        const meta = chat.metadata as Record<string, unknown> | null;
        if (!meta?.isPublic) {
          throw new GraphQLError('Forbidden', {
            extensions: { code: 'FORBIDDEN' },
          });
        }
      }

      return chat;
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to fetch chat', err);
      throw new GraphQLError('Failed to fetch chat', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },

  async searchChats(
    _: unknown,
    args: { query: string; userId?: string | null; pagination?: PaginationInput | null },
    ctx: GraphQLContext,
  ) {
    const requesterId = requireAuth(ctx);
    const targetUserId =
      ctx.role === 'ADMIN' && args.userId ? args.userId : requesterId;

    if (!args.query || args.query.trim().length < 2) {
      throw new GraphQLError('Search query must be at least 2 characters', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    const pagination = args.pagination ?? {};
    const limit = normalizePageSize(pagination.first, pagination.last);

    try {
      const searchTerm = `%${args.query.trim()}%`;
      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(chats)
          .where(
            and(
              eq(chats.userId, targetUserId),
              ilike(chats.title, searchTerm),
            ),
          )
          .orderBy(desc(chats.updatedAt))
          .limit(limit + 1),
        db
          .select({ count: sql<number>`count(*)` })
          .from(chats)
          .where(
            and(
              eq(chats.userId, targetUserId),
              ilike(chats.title, searchTerm),
            ),
          ),
      ]);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const totalCount = Number(countResult[0]?.count ?? 0);

      return buildConnection(items, totalCount, pagination, hasMore);
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to search chats', err);
      throw new GraphQLError('Failed to search chats', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },
};

// ─── Mutation Resolvers ───────────────────────────────────────────────────────

const chatMutationResolvers = {
  async createChat(
    _: unknown,
    args: { input: { title: string; model: string; systemPrompt?: string; metadata?: unknown } },
    ctx: GraphQLContext,
  ) {
    const userId = requireAuth(ctx);

    if (!args.input.title?.trim()) {
      throw new GraphQLError('Title is required', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }
    if (!args.input.model?.trim()) {
      throw new GraphQLError('Model is required', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    try {
      const [chat] = await db
        .insert(chats)
        .values({
          title: args.input.title.trim(),
          userId,
          model: args.input.model,
          status: 'ACTIVE',
          metadata: (args.input.metadata as Record<string, unknown>) ?? {},
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      Logger.info('Chat created', { chatId: chat.id, userId });

      pubsub.publish(EVENTS.CHAT_UPDATED, {
        onChatUpdated: {
          type: 'CHAT_CREATED',
          chatId: chat.id,
          userId,
          payload: chat,
          timestamp: new Date(),
        },
      });

      return chat;
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to create chat', err);
      throw new GraphQLError('Failed to create chat', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },

  async updateChat(
    _: unknown,
    args: { id: string; input: { title?: string; model?: string; metadata?: unknown } },
    ctx: GraphQLContext,
  ) {
    const userId = requireAuth(ctx);
    await requireChatOwner(args.id, userId);

    try {
      const updateData: Partial<typeof chats.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (args.input.title != null) updateData.title = args.input.title.trim();
      if (args.input.model != null) updateData.model = args.input.model;
      if (args.input.metadata != null)
        updateData.metadata = args.input.metadata as Record<string, unknown>;

      const [updated] = await db
        .update(chats)
        .set(updateData)
        .where(eq(chats.id, args.id))
        .returning();

      pubsub.publish(EVENTS.CHAT_UPDATED, {
        onChatUpdated: {
          type: 'CHAT_UPDATED',
          chatId: updated.id,
          userId,
          payload: updated,
          timestamp: new Date(),
        },
      });

      return updated;
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to update chat', err);
      throw new GraphQLError('Failed to update chat', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },

  async deleteChat(_: unknown, args: { id: string }, ctx: GraphQLContext) {
    const userId = requireAuth(ctx);
    await requireChatOwner(args.id, userId);

    try {
      await db.delete(messages).where(eq(messages.chatId, args.id));
      await db.delete(chats).where(eq(chats.id, args.id));

      Logger.info('Chat deleted', { chatId: args.id, userId });

      pubsub.publish(EVENTS.CHAT_UPDATED, {
        onChatUpdated: {
          type: 'CHAT_DELETED',
          chatId: args.id,
          userId,
          payload: { id: args.id },
          timestamp: new Date(),
        },
      });

      return true;
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to delete chat', err);
      throw new GraphQLError('Failed to delete chat', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },

  async archiveChat(_: unknown, args: { id: string }, ctx: GraphQLContext) {
    const userId = requireAuth(ctx);
    await requireChatOwner(args.id, userId);

    try {
      const [updated] = await db
        .update(chats)
        .set({
          status: 'ARCHIVED',
          updatedAt: new Date(),
          metadata: sql`jsonb_set(COALESCE(metadata, '{}'::jsonb), '{archivedAt}', to_jsonb(now()::text))`,
        })
        .where(eq(chats.id, args.id))
        .returning();

      return updated;
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to archive chat', err);
      throw new GraphQLError('Failed to archive chat', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },

  async shareChat(_: unknown, args: { id: string }, ctx: GraphQLContext) {
    const userId = requireAuth(ctx);
    await requireChatOwner(args.id, userId);

    try {
      const shareToken = Buffer.from(`${args.id}:${Date.now()}`).toString('base64url');

      const [updated] = await db
        .update(chats)
        .set({
          status: 'SHARED',
          updatedAt: new Date(),
          metadata: sql`jsonb_set(
            jsonb_set(COALESCE(metadata, '{}'::jsonb), '{isPublic}', 'true'),
            '{shareToken}', to_jsonb(${shareToken}::text)
          )`,
        })
        .where(eq(chats.id, args.id))
        .returning();

      Logger.info('Chat shared', { chatId: args.id, userId, shareToken });
      return updated;
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to share chat', err);
      throw new GraphQLError('Failed to share chat', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },

  async addMessage(
    _: unknown,
    args: {
      input: {
        chatId: string;
        role: string;
        content: string;
        parentId?: string;
        metadata?: unknown;
      };
    },
    ctx: GraphQLContext,
  ) {
    const userId = requireAuth(ctx);
    await requireChatOwner(args.input.chatId, userId);

    if (!args.input.content?.trim()) {
      throw new GraphQLError('Message content cannot be empty', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    try {
      const [message] = await db
        .insert(messages)
        .values({
          chatId: args.input.chatId,
          role: args.input.role,
          content: args.input.content,
          parentId: args.input.parentId ?? null,
          metadata: (args.input.metadata as Record<string, unknown>) ?? {},
          timestamp: new Date(),
          isStreaming: false,
        })
        .returning();

      // Update chat updatedAt
      await db
        .update(chats)
        .set({ updatedAt: new Date() })
        .where(eq(chats.id, args.input.chatId));

      pubsub.publish(EVENTS.CHAT_UPDATED, {
        onChatUpdated: {
          type: 'MESSAGE_ADDED',
          chatId: args.input.chatId,
          userId,
          payload: message,
          timestamp: new Date(),
        },
      });

      return message;
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to add message', err);
      throw new GraphQLError('Failed to add message', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },

  async deleteMessage(_: unknown, args: { id: string }, ctx: GraphQLContext) {
    const userId = requireAuth(ctx);

    try {
      const [message] = await db
        .select()
        .from(messages)
        .where(eq(messages.id, args.id))
        .limit(1);

      if (!message) {
        throw new GraphQLError('Message not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      await requireChatOwner(message.chatId, userId);

      await db.delete(messages).where(eq(messages.id, args.id));
      Logger.info('Message deleted', { messageId: args.id, userId });
      return true;
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to delete message', err);
      throw new GraphQLError('Failed to delete message', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },

  async editMessage(
    _: unknown,
    args: { input: { messageId: string; content: string } },
    ctx: GraphQLContext,
  ) {
    const userId = requireAuth(ctx);

    if (!args.input.content?.trim()) {
      throw new GraphQLError('Message content cannot be empty', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    try {
      const [message] = await db
        .select()
        .from(messages)
        .where(eq(messages.id, args.input.messageId))
        .limit(1);

      if (!message) {
        throw new GraphQLError('Message not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      await requireChatOwner(message.chatId, userId);

      const [updated] = await db
        .update(messages)
        .set({
          content: args.input.content,
          metadata: sql`jsonb_set(
            jsonb_set(COALESCE(metadata, '{}'::jsonb), '{isEdited}', 'true'),
            '{editedAt}', to_jsonb(now()::text)
          )`,
        })
        .where(eq(messages.id, args.input.messageId))
        .returning();

      return updated;
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to edit message', err);
      throw new GraphQLError('Failed to edit message', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },
};

// ─── Subscription Resolvers ───────────────────────────────────────────────────

const chatSubscriptionResolvers = {
  onMessageStream: {
    subscribe: withFilter(
      () => pubsub.asyncIterableIterator(EVENTS.MESSAGE_STREAM),
      (payload: { onMessageStream: { chatId: string } }, variables: { chatId: string }) => {
        return payload.onMessageStream.chatId === variables.chatId;
      },
    ),
  },

  onChatUpdated: {
    subscribe: withFilter(
      () => pubsub.asyncIterableIterator(EVENTS.CHAT_UPDATED),
      (payload: { onChatUpdated: { userId: string } }, variables: { userId: string }, ctx: GraphQLContext) => {
        // Only deliver events for the authenticated user
        return (
          payload.onChatUpdated.userId === variables.userId &&
          ctx.userId === variables.userId
        );
      },
    ),
  },
};

// ─── Field Resolvers ──────────────────────────────────────────────────────────

const chatFieldResolvers = {
  Chat: {
    async messages(
      parent: { id: string },
      args: { first?: number; after?: string; last?: number; before?: string },
    ) {
      const limit = normalizePageSize(args.first, args.last);

      let cursorCondition;
      if (args.after) {
        const { t } = decodeCursor(args.after);
        cursorCondition = gt(messages.timestamp, new Date(t));
      } else if (args.before) {
        const { t } = decodeCursor(args.before);
        cursorCondition = lt(messages.timestamp, new Date(t));
      }

      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(messages)
          .where(and(eq(messages.chatId, parent.id), cursorCondition))
          .orderBy(asc(messages.timestamp))
          .limit(limit + 1),
        db
          .select({ count: sql<number>`count(*)` })
          .from(messages)
          .where(eq(messages.chatId, parent.id)),
      ]);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const totalCount = Number(countResult[0]?.count ?? 0);

      const pagination: PaginationInput = { first: args.first, after: args.after, last: args.last, before: args.before };
      return buildConnection(
        items.map((m) => ({ ...m, createdAt: m.timestamp })),
        totalCount,
        pagination,
        hasMore,
      );
    },

    async messageCount(parent: { id: string }) {
      const [result] = await db
        .select({ count: sql<number>`count(*)` })
        .from(messages)
        .where(eq(messages.chatId, parent.id));
      return Number(result?.count ?? 0);
    },
  },
};

// ─── Export ───────────────────────────────────────────────────────────────────

export const chatResolvers = {
  Query: chatQueryResolvers,
  Mutation: chatMutationResolvers,
  Subscription: chatSubscriptionResolvers,
  ...chatFieldResolvers,
};

export { EVENTS as CHAT_EVENTS };
