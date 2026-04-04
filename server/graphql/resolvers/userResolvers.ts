/**
 * User GraphQL Resolvers
 * Handles: current user, user management (admin), settings, usage stats
 */

import { GraphQLError } from "graphql";
import { eq, desc, and, sql } from "drizzle-orm";
import { db, db as dbRead } from "../../db.js";
import { Logger } from "../../lib/logger.js";
import { users, userSettings, chats, chatMessages } from "../../../shared/schema.js";
import type { GraphQLContext } from "../middleware/auth.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function assertAuth(ctx: GraphQLContext): asserts ctx is GraphQLContext & { user: NonNullable<GraphQLContext["user"]> } {
  if (!ctx.user?.id) {
    throw new GraphQLError("Unauthorized", { extensions: { code: "UNAUTHENTICATED" } });
  }
}

function assertAdmin(ctx: GraphQLContext) {
  assertAuth(ctx);
  if (ctx.user!.role !== "admin") {
    throw new GraphQLError("Forbidden: Admin access required", { extensions: { code: "FORBIDDEN" } });
  }
}

function normalizeUser(u: typeof users.$inferSelect) {
  return {
    ...u,
    role: (u.role ?? "USER").toUpperCase(),
    is2faEnabled: u.is2faEnabled === "true",
    emailVerified: u.emailVerified === "true",
  };
}

function getPeriodDates(period?: string): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date();
  switch (period) {
    case "HOUR": from.setHours(from.getHours() - 1); break;
    case "DAY": from.setDate(from.getDate() - 1); break;
    case "WEEK": from.setDate(from.getDate() - 7); break;
    case "QUARTER": from.setMonth(from.getMonth() - 3); break;
    case "YEAR": from.setFullYear(from.getFullYear() - 1); break;
    default: from.setMonth(from.getMonth() - 1);
  }
  return { from, to };
}

// ─── Resolvers ────────────────────────────────────────────────────────────────
export const userResolvers = {
  Query: {
    async me(_: unknown, __: unknown, ctx: GraphQLContext) {
      assertAuth(ctx);
      try {
        Logger.info("[GraphQL] me query", { userId: ctx.user.id });

        const [user] = await dbRead
          .select()
          .from(users)
          .where(eq(users.id, ctx.user.id))
          .limit(1);

        if (!user) {
          throw new GraphQLError("User not found", { extensions: { code: "NOT_FOUND" } });
        }

        return normalizeUser(user);
      } catch (err) {
        Logger.error("[GraphQL] me query failed", err);
        throw err instanceof GraphQLError ? err : new GraphQLError("Failed to fetch user");
      }
    },

    async users(
      _: unknown,
      args: { limit?: number; offset?: number },
      ctx: GraphQLContext
    ) {
      assertAdmin(ctx);
      const limit = Math.min(args.limit ?? 20, 100);
      const offset = args.offset ?? 0;

      try {
        Logger.info("[GraphQL] users query (admin)", { userId: ctx.user.id, limit, offset });

        const rows = await dbRead
          .select()
          .from(users)
          .orderBy(desc(users.createdAt))
          .limit(limit + 1)
          .offset(offset);

        const hasNextPage = rows.length > limit;
        const items = hasNextPage ? rows.slice(0, limit) : rows;

        return {
          edges: items.map((u) => ({
            node: normalizeUser(u),
            cursor: Buffer.from(u.id).toString("base64"),
          })),
          pageInfo: {
            hasNextPage,
            hasPreviousPage: offset > 0,
            startCursor: items.length > 0 ? Buffer.from(items[0].id).toString("base64") : null,
            endCursor: items.length > 0 ? Buffer.from(items[items.length - 1].id).toString("base64") : null,
            totalCount: items.length,
          },
        };
      } catch (err) {
        Logger.error("[GraphQL] users query failed", err);
        throw new GraphQLError("Failed to fetch users");
      }
    },

    async userSettings(_: unknown, args: { userId: string }, ctx: GraphQLContext) {
      assertAuth(ctx);

      // Users can only view their own settings unless admin
      if (args.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } });
      }

      try {
        Logger.info("[GraphQL] userSettings query", { targetUserId: args.userId, requesterId: ctx.user.id });

        const [settings] = await dbRead
          .select()
          .from(userSettings)
          .where(eq(userSettings.userId, args.userId))
          .limit(1);

        if (!settings) return null;

        // Flatten JSON settings fields
        const prefs = (settings.responsePreferences as any) ?? {};
        const flags = (settings.featureFlags as any) ?? {};

        return {
          id: settings.id,
          userId: settings.userId,
          responseStyle: prefs.responseStyle ?? "default",
          responseTone: prefs.responseTone ?? "",
          customInstructions: prefs.customInstructions ?? "",
          memoryEnabled: flags.memoryEnabled ?? false,
          webSearchAuto: flags.webSearchAuto ?? true,
          codeInterpreterEnabled: flags.codeInterpreterEnabled ?? true,
          canvasEnabled: flags.canvasEnabled ?? true,
          voiceEnabled: flags.voiceEnabled ?? true,
          theme: "system",   // Not in DB yet — would be added to userSettings
          language: "en",    // Not in DB yet — would be added to userSettings
          updatedAt: settings.updatedAt,
        };
      } catch (err) {
        Logger.error("[GraphQL] userSettings query failed", err);
        throw new GraphQLError("Failed to fetch user settings");
      }
    },

    async usage(
      _: unknown,
      args: { userId?: string; period?: string },
      ctx: GraphQLContext
    ) {
      assertAuth(ctx);

      // Non-admins can only view their own usage
      const targetUserId = args.userId ?? ctx.user.id;
      if (targetUserId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } });
      }

      const { from, to } = getPeriodDates(args.period);

      try {
        Logger.info("[GraphQL] usage query", { targetUserId, requesterId: ctx.user.id });

        // Count chats and messages in period
        // In production: use a proper analytics table with pre-aggregated stats
        const chatCount = await dbRead
          .select({ count: sql<number>`COUNT(*)` })
          .from(chats)
          .where(
            and(
              eq(chats.userId, targetUserId),
              sql`${chats.createdAt} >= ${from}`,
              sql`${chats.createdAt} <= ${to}`
            )
          );

        const msgCount = await dbRead
          .select({
            count: sql<number>`COUNT(*)`,
          })
          .from(chatMessages)
          .innerJoin(chats, eq(chatMessages.chatId, chats.id))
          .where(
            and(
              eq(chats.userId, targetUserId),
              sql`${chatMessages.createdAt} >= ${from}`,
              sql`${chatMessages.createdAt} <= ${to}`
            )
          );

        const [userRow] = await dbRead
          .select({ tokensConsumed: users.tokensConsumed })
          .from(users)
          .where(eq(users.id, targetUserId))
          .limit(1);

        const totalChats = Number(chatCount[0]?.count ?? 0);
        const totalMessages = Number(msgCount[0]?.count ?? 0);
        const tokensConsumed = userRow?.tokensConsumed ?? 0;

        return {
          userId: targetUserId,
          period: args.period ?? "MONTH",
          totalChats,
          totalMessages,
          totalTokensConsumed: tokensConsumed,
          totalInputTokens: Math.round(tokensConsumed * 0.7),
          totalOutputTokens: Math.round(tokensConsumed * 0.3),
          estimatedCost: (tokensConsumed / 1000) * 0.002,
          modelsUsed: [],  // Would aggregate from chats.ai_model_used
          averageMessagesPerChat: totalChats > 0 ? totalMessages / totalChats : 0,
          from,
          to,
        };
      } catch (err) {
        Logger.error("[GraphQL] usage query failed", err);
        throw new GraphQLError("Failed to fetch usage stats");
      }
    },
  },

  Mutation: {
    async updateSettings(
      _: unknown,
      args: {
        input: {
          responseStyle?: string;
          responseTone?: string;
          customInstructions?: string;
          memoryEnabled?: boolean;
          webSearchAuto?: boolean;
          codeInterpreterEnabled?: boolean;
          canvasEnabled?: boolean;
          voiceEnabled?: boolean;
          theme?: string;
          language?: string;
        };
      },
      ctx: GraphQLContext
    ) {
      assertAuth(ctx);

      try {
        Logger.info("[GraphQL] updateSettings", { userId: ctx.user.id });

        // Load current settings
        const [existing] = await db
          .select()
          .from(userSettings)
          .where(eq(userSettings.userId, ctx.user.id))
          .limit(1);

        const currentPrefs = (existing?.responsePreferences as any) ?? {};
        const currentFlags = (existing?.featureFlags as any) ?? {};

        const newPrefs = {
          ...currentPrefs,
          ...(args.input.responseStyle !== undefined && { responseStyle: args.input.responseStyle }),
          ...(args.input.responseTone !== undefined && { responseTone: args.input.responseTone }),
          ...(args.input.customInstructions !== undefined && { customInstructions: args.input.customInstructions }),
        };

        const newFlags = {
          ...currentFlags,
          ...(args.input.memoryEnabled !== undefined && { memoryEnabled: args.input.memoryEnabled }),
          ...(args.input.webSearchAuto !== undefined && { webSearchAuto: args.input.webSearchAuto }),
          ...(args.input.codeInterpreterEnabled !== undefined && { codeInterpreterEnabled: args.input.codeInterpreterEnabled }),
          ...(args.input.canvasEnabled !== undefined && { canvasEnabled: args.input.canvasEnabled }),
          ...(args.input.voiceEnabled !== undefined && { voiceEnabled: args.input.voiceEnabled }),
        };

        let updated: typeof userSettings.$inferSelect;

        if (existing) {
          const [result] = await db
            .update(userSettings)
            .set({
              responsePreferences: newPrefs,
              featureFlags: newFlags,
              // theme/language not yet in userSettings schema — extend schema to add them
              updatedAt: new Date(),
            })
            .where(eq(userSettings.userId, ctx.user.id))
            .returning();
          updated = result;
        } else {
          const [result] = await db
            .insert(userSettings)
            .values({
              userId: ctx.user.id,
              responsePreferences: newPrefs,
              featureFlags: newFlags,
            })
            .returning();
          updated = result;
        }

        return {
          id: updated.id,
          userId: updated.userId,
          responseStyle: newPrefs.responseStyle ?? "default",
          responseTone: newPrefs.responseTone ?? "",
          customInstructions: newPrefs.customInstructions ?? "",
          memoryEnabled: newFlags.memoryEnabled ?? false,
          webSearchAuto: newFlags.webSearchAuto ?? true,
          codeInterpreterEnabled: newFlags.codeInterpreterEnabled ?? true,
          canvasEnabled: newFlags.canvasEnabled ?? true,
          voiceEnabled: newFlags.voiceEnabled ?? true,
          theme: "system",
          language: "en",
          updatedAt: updated.updatedAt,
        };
      } catch (err) {
        Logger.error("[GraphQL] updateSettings failed", err);
        throw new GraphQLError("Failed to update settings");
      }
    },

    async updateProfile(
      _: unknown,
      args: {
        input: {
          firstName?: string;
          lastName?: string;
          username?: string;
          profileImageUrl?: string;
          company?: string;
          phone?: string;
        };
      },
      ctx: GraphQLContext
    ) {
      assertAuth(ctx);

      try {
        Logger.info("[GraphQL] updateProfile", { userId: ctx.user.id });

        const updateData: Partial<typeof users.$inferInsert> = {
          updatedAt: new Date(),
        };

        if (args.input.firstName !== undefined) updateData.firstName = args.input.firstName;
        if (args.input.lastName !== undefined) updateData.lastName = args.input.lastName;
        if (args.input.username !== undefined) updateData.username = args.input.username;
        if (args.input.profileImageUrl !== undefined) updateData.profileImageUrl = args.input.profileImageUrl;
        if (args.input.company !== undefined) updateData.company = args.input.company;
        if (args.input.phone !== undefined) updateData.phone = args.input.phone;

        // Update fullName if first/last changed
        if (args.input.firstName !== undefined || args.input.lastName !== undefined) {
          const [current] = await db.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
          const fn = args.input.firstName ?? current?.firstName ?? "";
          const ln = args.input.lastName ?? current?.lastName ?? "";
          updateData.fullName = `${fn} ${ln}`.trim() || null;
        }

        const [updated] = await db
          .update(users)
          .set(updateData)
          .where(eq(users.id, ctx.user.id))
          .returning();

        if (!updated) {
          throw new GraphQLError("User not found", { extensions: { code: "NOT_FOUND" } });
        }

        return normalizeUser(updated);
      } catch (err) {
        Logger.error("[GraphQL] updateProfile failed", err);
        throw err instanceof GraphQLError ? err : new GraphQLError("Failed to update profile");
      }
    },
  },

  // Field resolvers
  User: {
    async settings(parent: { id: string }, _: unknown, ctx: GraphQLContext) {
      try {
        const [settings] = await dbRead
          .select()
          .from(userSettings)
          .where(eq(userSettings.userId, parent.id))
          .limit(1);
        if (!settings) return null;
        const prefs = (settings.responsePreferences as any) ?? {};
        const flags = (settings.featureFlags as any) ?? {};
        return {
          id: settings.id,
          userId: settings.userId,
          responseStyle: prefs.responseStyle ?? "default",
          responseTone: prefs.responseTone ?? "",
          customInstructions: prefs.customInstructions ?? "",
          memoryEnabled: flags.memoryEnabled ?? false,
          webSearchAuto: flags.webSearchAuto ?? true,
          codeInterpreterEnabled: flags.codeInterpreterEnabled ?? true,
          canvasEnabled: flags.canvasEnabled ?? true,
          voiceEnabled: flags.voiceEnabled ?? true,
          theme: "system",   // Not in DB yet — would be added to userSettings
          language: "en",    // Not in DB yet — would be added to userSettings
          updatedAt: settings.updatedAt,
        };
      } catch {
        return null;
      }
    },

    async chats(parent: { id: string }, args: { limit?: number; offset?: number }) {
      const limit = Math.min(args.limit ?? 10, 50);
      const offset = args.offset ?? 0;
      try {
        const rows = await dbRead
          .select()
          .from(chats)
          .where(and(eq(chats.userId, parent.id), sql`${chats.deletedAt} IS NULL`))
          .orderBy(desc(chats.updatedAt))
          .limit(limit)
          .offset(offset);

        return {
          edges: rows.map((c) => ({
            node: { ...c, status: c.archived === "true" ? "ARCHIVED" : "ACTIVE", archived: c.archived === "true", pinned: c.pinned === "true" },
            cursor: Buffer.from(c.id).toString("base64"),
          })),
          pageInfo: { hasNextPage: false, hasPreviousPage: offset > 0, startCursor: null, endCursor: null, totalCount: rows.length },
        };
      } catch {
        return { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null, totalCount: 0 } };
      }
    },

    async usage(parent: { id: string }, args: { period?: string }) {
      const { from, to } = getPeriodDates(args.period);
      return {
        userId: parent.id,
        period: args.period ?? "MONTH",
        totalChats: 0,
        totalMessages: 0,
        totalTokensConsumed: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        estimatedCost: 0,
        modelsUsed: [],
        averageMessagesPerChat: 0,
        from,
        to,
      };
    },
  },
};
