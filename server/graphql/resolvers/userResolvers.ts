import { GraphQLError } from 'graphql';
import { eq, and, desc, ilike, sql, or } from 'drizzle-orm';
import { db } from '../../db';
import { Logger } from '../../lib/logger';
import { users, chats, agents, userSettings } from '../../../shared/schema';
import type { GraphQLContext } from '../index';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PaginationInput {
  first?: number | null;
  after?: string | null;
  last?: number | null;
  before?: string | null;
}

interface UserFilterInput {
  role?: string | null;
  isActive?: boolean | null;
  search?: string | null;
  tenantId?: string | null;
}

interface UpdateProfileInput {
  displayName?: string | null;
  avatarUrl?: string | null;
  email?: string | null;
}

interface UpdatePreferencesInput {
  theme?: string | null;
  language?: string | null;
  timezone?: string | null;
  notifications?: boolean | null;
  defaultModel?: string | null;
  autoSave?: boolean | null;
  streamingEnabled?: boolean | null;
  codeHighlighting?: boolean | null;
  markdownRendering?: boolean | null;
  customInstructions?: string | null;
}

interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireAuth(ctx: GraphQLContext): string {
  if (!ctx.userId) {
    throw new GraphQLError('Not authenticated', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }
  return ctx.userId;
}

function requireAdmin(ctx: GraphQLContext): void {
  requireAuth(ctx);
  if (ctx.role !== 'ADMIN') {
    throw new GraphQLError('Admin access required', {
      extensions: { code: 'FORBIDDEN' },
    });
  }
}

function normalizePageSize(first?: number | null, last?: number | null): number {
  return Math.min(Math.max(1, first ?? last ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
}

function encodeCursor(id: string, createdAt: Date): string {
  return Buffer.from(JSON.stringify({ id, t: createdAt.getTime() })).toString('base64');
}

function decodeCursor(cursor: string): { id: string; t: number } {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
  } catch {
    throw new GraphQLError('Invalid pagination cursor', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }
}

function buildConnection<T extends { id: string; createdAt: Date }>(
  items: T[],
  totalCount: number,
  pagination: PaginationInput,
  hasMore: boolean,
) {
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

function mapUserToGql(user: typeof users.$inferSelect) {
  return {
    ...user,
    role: (user.role?.toUpperCase() ?? 'USER') as string,
    isEmailVerified: user.emailVerified === 'true',
    isActive: user.status === 'active',
    displayName: user.fullName ?? user.username ?? null,
    avatarUrl: user.profileImageUrl ?? null,
    tenantId: user.orgId ?? null,
    // Preferences stored in separate userSettings table — resolved via field resolver
    preferences: null,
  };
}

// ─── Query Resolvers ──────────────────────────────────────────────────────────

const userQueryResolvers = {
  async me(_: unknown, _args: unknown, ctx: GraphQLContext) {
    const userId = requireAuth(ctx);

    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        throw new GraphQLError('User not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      return mapUserToGql(user);
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to fetch current user', err);
      throw new GraphQLError('Failed to fetch user', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },

  async user(_: unknown, args: { id: string }, ctx: GraphQLContext) {
    requireAdmin(ctx);

    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, args.id))
        .limit(1);

      if (!user) return null;
      return mapUserToGql(user);
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to fetch user by id', err);
      throw new GraphQLError('Failed to fetch user', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },

  async users(
    _: unknown,
    args: { pagination?: PaginationInput | null; filter?: UserFilterInput | null },
    ctx: GraphQLContext,
  ) {
    requireAdmin(ctx);

    const pagination = args.pagination ?? {};
    const limit = normalizePageSize(pagination.first, pagination.last);

    try {
      let cursorCondition;
      if (pagination.after) {
        const { t } = decodeCursor(pagination.after);
        cursorCondition = sql`${users.createdAt} < ${new Date(t)}`;
      }

      const filterConditions = [];
      if (args.filter?.role) {
        filterConditions.push(eq(users.role, args.filter.role.toLowerCase()));
      }
      if (args.filter?.isActive != null) {
        filterConditions.push(
          eq(users.status, args.filter.isActive ? 'active' : 'inactive'),
        );
      }
      if (args.filter?.search) {
        const term = `%${args.filter.search.trim()}%`;
        filterConditions.push(
          or(
            ilike(users.email, term),
            ilike(users.fullName, term),
            ilike(users.username, term),
          ),
        );
      }
      if (args.filter?.tenantId) {
        filterConditions.push(eq(users.orgId, args.filter.tenantId));
      }

      const whereClause =
        filterConditions.length > 0 || cursorCondition
          ? and(...filterConditions, cursorCondition)
          : undefined;

      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(users)
          .where(whereClause)
          .orderBy(desc(users.createdAt))
          .limit(limit + 1),
        db
          .select({ count: sql<number>`count(*)` })
          .from(users)
          .where(and(...filterConditions)),
      ]);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const totalCount = Number(countResult[0]?.count ?? 0);

      return buildConnection(
        items.map(mapUserToGql),
        totalCount,
        pagination,
        hasMore,
      );
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to fetch users', err);
      throw new GraphQLError('Failed to fetch users', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },
};

// ─── Mutation Resolvers ───────────────────────────────────────────────────────

const userMutationResolvers = {
  async updateProfile(
    _: unknown,
    args: { input: UpdateProfileInput },
    ctx: GraphQLContext,
  ) {
    const userId = requireAuth(ctx);
    const input = args.input;

    if (input.email != null) {
      if (!EMAIL_REGEX.test(input.email)) {
        throw new GraphQLError('Invalid email address', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
      // Check email uniqueness
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, input.email), sql`id != ${userId}`))
        .limit(1);

      if (existing) {
        throw new GraphQLError('Email address is already in use', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
    }

    try {
      const updateData: Partial<typeof users.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.displayName != null) {
        updateData.fullName = input.displayName.trim() || null;
      }
      if (input.avatarUrl != null) {
        updateData.profileImageUrl = input.avatarUrl || null;
      }
      if (input.email != null) {
        updateData.email = input.email.toLowerCase().trim();
        updateData.emailVerified = 'false'; // require re-verification
      }

      const [updated] = await db
        .update(users)
        .set(updateData)
        .where(eq(users.id, userId))
        .returning();

      Logger.info('User profile updated', { userId });
      return mapUserToGql(updated);
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to update profile', err);
      throw new GraphQLError('Failed to update profile', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },

  async updatePreferences(
    _: unknown,
    args: { input: UpdatePreferencesInput },
    ctx: GraphQLContext,
  ) {
    const userId = requireAuth(ctx);
    const input = args.input;

    // Build preferences JSON patch from non-null inputs
    const prefPatch: Record<string, unknown> = {};
    const keys: Array<keyof UpdatePreferencesInput> = [
      'theme', 'language', 'timezone', 'notifications', 'defaultModel',
      'autoSave', 'streamingEnabled', 'codeHighlighting', 'markdownRendering',
      'customInstructions',
    ];
    for (const key of keys) {
      if (input[key] != null) prefPatch[key] = input[key];
    }

    if (Object.keys(prefPatch).length === 0) {
      throw new GraphQLError('No preferences provided to update', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    try {
      // Upsert into userSettings table
      await db
        .insert(userSettings)
        .values({
          userId,
          preferences: prefPatch,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: userSettings.userId,
          set: {
            preferences: sql`userSettings.preferences || ${JSON.stringify(prefPatch)}::jsonb`,
            updatedAt: new Date(),
          },
        });

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      Logger.info('User preferences updated', { userId });
      return mapUserToGql(user);
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to update preferences', err);
      throw new GraphQLError('Failed to update preferences', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },

  async deleteAccount(
    _: unknown,
    args: { confirm: boolean },
    ctx: GraphQLContext,
  ) {
    const userId = requireAuth(ctx);

    if (!args.confirm) {
      throw new GraphQLError(
        'You must confirm account deletion by passing confirm: true',
        { extensions: { code: 'BAD_USER_INPUT' } },
      );
    }

    try {
      // Soft-delete: mark as inactive and anonymize PII
      await db
        .update(users)
        .set({
          status: 'inactive',
          email: sql`'deleted_' || id || '@deleted.invalid'`,
          fullName: null,
          username: null,
          profileImageUrl: null,
          phone: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      Logger.info('Account deleted (soft)', { userId });
      return true;
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to delete account', err);
      throw new GraphQLError('Failed to delete account', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },

  async changePassword(
    _: unknown,
    args: { input: ChangePasswordInput },
    ctx: GraphQLContext,
  ) {
    const userId = requireAuth(ctx);
    const { currentPassword, newPassword } = args.input;

    if (!currentPassword || !newPassword) {
      throw new GraphQLError('Both current and new passwords are required', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new GraphQLError(
        `New password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        { extensions: { code: 'BAD_USER_INPUT' } },
      );
    }

    if (currentPassword === newPassword) {
      throw new GraphQLError('New password must be different from current password', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    try {
      const [user] = await db
        .select({ id: users.id, password: users.password })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        throw new GraphQLError('User not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      // In production: verify currentPassword against bcrypt hash
      // const valid = await bcrypt.compare(currentPassword, user.password ?? '');
      // if (!valid) throw new GraphQLError('Current password is incorrect', ...);

      // Hash new password
      // const hashed = await bcrypt.hash(newPassword, 12);
      const hashed = `hashed:${newPassword}`; // placeholder — swap with bcrypt in prod

      await db
        .update(users)
        .set({ password: hashed, updatedAt: new Date() })
        .where(eq(users.id, userId));

      Logger.info('Password changed', { userId });
      return true;
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to change password', err);
      throw new GraphQLError('Failed to change password', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },

  async requestEmailVerification(_: unknown, _args: unknown, ctx: GraphQLContext) {
    const userId = requireAuth(ctx);

    try {
      const [user] = await db
        .select({ id: users.id, email: users.email, emailVerified: users.emailVerified })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        throw new GraphQLError('User not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      if (user.emailVerified === 'true') {
        throw new GraphQLError('Email is already verified', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      // In production: send verification email via email service
      // await emailService.sendVerification(user.email, userId);
      Logger.info('Email verification requested', { userId, email: user.email });
      return true;
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      Logger.error('Failed to request email verification', err);
      throw new GraphQLError('Failed to request email verification', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }
  },
};

// ─── Field Resolvers ──────────────────────────────────────────────────────────

const userFieldResolvers = {
  User: {
    async preferences(parent: { id: string }) {
      try {
        const [settings] = await db
          .select()
          .from(userSettings)
          .where(eq(userSettings.userId, parent.id))
          .limit(1);

        if (!settings) return null;
        return settings.preferences ?? null;
      } catch {
        return null;
      }
    },

    async chats(parent: { id: string }, args: { first?: number; after?: string }) {
      const limit = Math.min(args.first ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
      const rows = await db
        .select()
        .from(chats)
        .where(eq(chats.userId, parent.id))
        .orderBy(desc(chats.updatedAt))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;

      return buildConnection(items, items.length, { first: args.first }, hasMore);
    },

    async agents(parent: { id: string }, args: { first?: number; after?: string }) {
      const limit = Math.min(args.first ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
      const rows = await db
        .select()
        .from(agents)
        .where(eq(agents.userId, parent.id))
        .orderBy(desc(agents.createdAt))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;

      return buildConnection(items, items.length, { first: args.first }, hasMore);
    },

    async documents(_parent: { id: string }, _args: unknown) {
      // Placeholder — wire up once a `documents` table exists in schema
      return { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null, totalCount: 0 } };
    },

    async usage(parent: { id: string }) {
      try {
        const [user] = await db
          .select({
            tokensConsumed: users.tokensConsumed,
            queryCount: users.queryCount,
            lastLoginAt: users.lastLoginAt,
          })
          .from(users)
          .where(eq(users.id, parent.id))
          .limit(1);

        const [chatCount] = await db
          .select({ count: sql<number>`count(*)` })
          .from(chats)
          .where(eq(chats.userId, parent.id));

        return {
          totalTokens: user?.tokensConsumed ?? 0,
          totalChats: Number(chatCount?.count ?? 0),
          totalMessages: user?.queryCount ?? 0,
          totalDocuments: 0,
          lastActiveAt: user?.lastLoginAt ?? null,
          monthlyTokens: 0, // Would require a monthly rollup query
        };
      } catch {
        return {
          totalTokens: 0,
          totalChats: 0,
          totalMessages: 0,
          totalDocuments: 0,
          lastActiveAt: null,
          monthlyTokens: 0,
        };
      }
    },
  },
};

// ─── Export ───────────────────────────────────────────────────────────────────

export const userResolvers = {
  Query: userQueryResolvers,
  Mutation: userMutationResolvers,
  ...userFieldResolvers,
};
