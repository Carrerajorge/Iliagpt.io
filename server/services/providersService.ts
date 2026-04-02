/**
 * ProvidersService — Unified multi-provider gateway.
 *
 * Resolves OAuth tokens (user > global priority), fetches available models,
 * and dispatches chat requests to the correct provider adapter.
 */

import { eq, and, lt, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  oauthTokensGlobal,
  oauthTokensUser,
} from "../../shared/schema/oauthProviderTokens";
import { encrypt, decrypt } from "./encryption";
import {
  type OAuthProvider,
  type ProviderModel,
  type ChatMessage,
  type ChatResponse,
  type StreamChunk,
  getProviderAdapter,
  detectProviderFromModelId,
} from "./providerAdapters";
import crypto from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProviderModelWithSource extends ProviderModel {
  source: "global" | "user";
}

interface ResolvedToken {
  token: string;
  source: "global" | "user";
  refreshToken: string | null;
  expiresAt: number | null;
  rowId: string;
  isGlobal: boolean;
}

// ─── Model Cache ─────────────────────────────────────────────────────────────

const MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const modelCache = new Map<
  string,
  { models: ProviderModelWithSource[]; fetchedAt: number }
>();

function cacheKey(provider: string, tokenHash: string): string {
  return `${provider}:${tokenHash}`;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}

const missingOauthTablesWarned = new Set<string>();

function getSqlCode(error: unknown): string | undefined {
  const anyError = error as {
    code?: string;
    cause?: { code?: string };
  } | null;
  return anyError?.cause?.code || anyError?.code;
}

function getSqlMessage(error: unknown): string {
  const anyError = error as {
    message?: string;
    detail?: string;
    cause?: { message?: string; detail?: string };
  } | null;

  return [
    anyError?.cause?.message,
    anyError?.cause?.detail,
    anyError?.message,
    anyError?.detail,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n");
}

function isMissingOauthTokenTableError(error: unknown): boolean {
  if (getSqlCode(error) === "42P01") {
    return true;
  }

  const message = getSqlMessage(error).toLowerCase();
  return (
    message.includes('relation "oauth_tokens_global" does not exist') ||
    message.includes('relation "oauth_tokens_user" does not exist') ||
    message.includes("oauth_tokens_global") ||
    message.includes("oauth_tokens_user")
  );
}

function warnMissingOauthTableOnce(error: unknown): void {
  const message = getSqlMessage(error).toLowerCase();
  const tables = [
    message.includes("oauth_tokens_global") ? "oauth_tokens_global" : null,
    message.includes("oauth_tokens_user") ? "oauth_tokens_user" : null,
  ].filter((value): value is string => !!value);

  if (tables.length === 0) {
    tables.push("oauth_tokens_global", "oauth_tokens_user");
  }

  for (const table of tables) {
    if (missingOauthTablesWarned.has(table)) continue;
    missingOauthTablesWarned.add(table);
    console.warn(
      `[ProvidersService] ${table} is missing; OAuth provider status will be treated as disconnected until migrations run.`,
    );
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

class ProvidersService {
  private readonly providers: OAuthProvider[] = ["openai", "gemini", "anthropic"];

  /**
   * Resolve the best available token for a provider.
   * User tokens take priority over global tokens.
   */
  async resolveToken(
    userId: string | null | undefined,
    provider: OAuthProvider,
  ): Promise<ResolvedToken | null> {
    // 1. Try user-scoped token
    if (userId) {
      try {
        const [userRow] = await db
          .select()
          .from(oauthTokensUser)
          .where(
            and(
              eq(oauthTokensUser.userId, userId),
              eq(oauthTokensUser.provider, provider),
            ),
          )
          .limit(1);

        if (userRow) {
          try {
            return {
              token: decrypt(userRow.accessToken),
              source: "user",
              refreshToken: userRow.refreshToken
                ? decrypt(userRow.refreshToken)
                : null,
              expiresAt: userRow.expiresAt,
              rowId: userRow.id,
              isGlobal: false,
            };
          } catch (err) {
            console.error(
              `[ProvidersService] Failed to decrypt user token for ${provider}:`,
              (err as Error).message,
            );
          }
        }
      } catch (error) {
        if (isMissingOauthTokenTableError(error)) {
          warnMissingOauthTableOnce(error);
        } else {
          throw error;
        }
      }
    }

    // 2. Fallback to global token
    try {
      const [globalRow] = await db
        .select()
        .from(oauthTokensGlobal)
        .where(eq(oauthTokensGlobal.provider, provider))
        .limit(1);

      if (globalRow) {
        try {
          return {
            token: decrypt(globalRow.accessToken),
            source: "global",
            refreshToken: globalRow.refreshToken
              ? decrypt(globalRow.refreshToken)
              : null,
            expiresAt: globalRow.expiresAt,
            rowId: globalRow.id,
            isGlobal: true,
          };
        } catch (err) {
          console.error(
            `[ProvidersService] Failed to decrypt global token for ${provider}:`,
            (err as Error).message,
          );
        }
      }
    } catch (error) {
      if (isMissingOauthTokenTableError(error)) {
        warnMissingOauthTableOnce(error);
      } else {
        throw error;
      }
    }

    return null;
  }

  /**
   * Get all available models across all connected providers for a user.
   */
  async getAvailableModels(
    userId: string | null | undefined,
  ): Promise<ProviderModelWithSource[]> {
    const allModels: ProviderModelWithSource[] = [];

    for (const provider of this.providers) {
      const resolved = await this.resolveToken(userId, provider);
      if (!resolved) continue;

      const tokenH = hashToken(resolved.token);
      const key = cacheKey(provider, tokenH);
      const cached = modelCache.get(key);

      if (cached && Date.now() - cached.fetchedAt < MODEL_CACHE_TTL_MS) {
        allModels.push(...cached.models);
        continue;
      }

      try {
        const adapter = getProviderAdapter(provider);
        const models = await adapter.fetchModels(resolved.token);
        const annotated: ProviderModelWithSource[] = models.map((m) => ({
          ...m,
          source: resolved.source,
        }));

        modelCache.set(key, { models: annotated, fetchedAt: Date.now() });
        allModels.push(...annotated);
      } catch (err) {
        console.error(
          `[ProvidersService] fetchModels failed for ${provider}:`,
          (err as Error).message,
        );
        // Use cached if available, even if stale
        if (cached) {
          allModels.push(...cached.models);
        }
      }
    }

    return allModels;
  }

  /**
   * Send a chat message using an OAuth-resolved provider token.
   */
  async chatWithToken(
    userId: string,
    modelId: string,
    messages: ChatMessage[],
  ): Promise<ChatResponse | null> {
    const provider = detectProviderFromModelId(modelId);
    if (!provider) return null;

    const resolved = await this.resolveToken(userId, provider);
    if (!resolved) return null;

    const adapter = getProviderAdapter(provider);
    return adapter.chat(resolved.token, modelId, messages);
  }

  /**
   * Stream a chat response using an OAuth-resolved provider token.
   */
  async *streamChatWithToken(
    userId: string,
    modelId: string,
    messages: ChatMessage[],
  ): AsyncGenerator<StreamChunk> {
    const provider = detectProviderFromModelId(modelId);
    if (!provider) return;

    const resolved = await this.resolveToken(userId, provider);
    if (!resolved) return;

    const adapter = getProviderAdapter(provider);
    yield* adapter.streamChat(resolved.token, modelId, messages);
  }

  // ─── Token CRUD ──────────────────────────────────────────────────────────

  async saveGlobalToken(
    provider: OAuthProvider,
    accessToken: string,
    refreshToken: string | null,
    expiresAt: number | null,
    scope: string | null,
    label: string | null,
    addedByUserId: string,
  ): Promise<void> {
    const encAccess = encrypt(accessToken);
    const encRefresh = refreshToken ? encrypt(refreshToken) : null;

    await db
      .insert(oauthTokensGlobal)
      .values({
        provider,
        accessToken: encAccess,
        refreshToken: encRefresh,
        expiresAt,
        scope,
        label,
        addedByUserId,
      })
      .onConflictDoUpdate({
        target: [oauthTokensGlobal.provider],
        set: {
          accessToken: encAccess,
          refreshToken: encRefresh,
          expiresAt,
          scope,
          label,
          addedByUserId,
          updatedAt: new Date(),
        },
      });

    this.invalidateModelCache(provider);
  }

  async saveUserToken(
    userId: string,
    provider: OAuthProvider,
    accessToken: string,
    refreshToken: string | null,
    expiresAt: number | null,
    scope: string | null,
  ): Promise<void> {
    const encAccess = encrypt(accessToken);
    const encRefresh = refreshToken ? encrypt(refreshToken) : null;

    await db
      .insert(oauthTokensUser)
      .values({
        userId,
        provider,
        accessToken: encAccess,
        refreshToken: encRefresh,
        expiresAt,
        scope,
      })
      .onConflictDoUpdate({
        target: [oauthTokensUser.userId, oauthTokensUser.provider],
        set: {
          accessToken: encAccess,
          refreshToken: encRefresh,
          expiresAt,
          scope,
          updatedAt: new Date(),
        },
      });

    this.invalidateModelCache(provider);
  }

  async deleteGlobalToken(provider: OAuthProvider): Promise<void> {
    await db
      .delete(oauthTokensGlobal)
      .where(eq(oauthTokensGlobal.provider, provider));
    this.invalidateModelCache(provider);
  }

  async deleteUserToken(
    userId: string,
    provider: OAuthProvider,
  ): Promise<void> {
    await db
      .delete(oauthTokensUser)
      .where(
        and(
          eq(oauthTokensUser.userId, userId),
          eq(oauthTokensUser.provider, provider),
        ),
      );
    this.invalidateModelCache(provider);
  }

  async getGlobalTokenStatus(
    provider: OAuthProvider,
  ): Promise<{ connected: boolean; label: string | null }> {
    try {
      const [row] = await db
        .select({ id: oauthTokensGlobal.id, label: oauthTokensGlobal.label })
        .from(oauthTokensGlobal)
        .where(eq(oauthTokensGlobal.provider, provider))
        .limit(1);

      return { connected: !!row, label: row?.label ?? null };
    } catch (error) {
      if (isMissingOauthTokenTableError(error)) {
        warnMissingOauthTableOnce(error);
        return { connected: false, label: null };
      }
      throw error;
    }
  }

  async getUserTokenStatus(
    userId: string,
    provider: OAuthProvider,
  ): Promise<{ connected: boolean }> {
    try {
      const [row] = await db
        .select({ id: oauthTokensUser.id })
        .from(oauthTokensUser)
        .where(
          and(
            eq(oauthTokensUser.userId, userId),
            eq(oauthTokensUser.provider, provider),
          ),
        )
        .limit(1);

      return { connected: !!row };
    } catch (error) {
      if (isMissingOauthTokenTableError(error)) {
        warnMissingOauthTableOnce(error);
        return { connected: false };
      }
      throw error;
    }
  }

  // ─── Token Refresh ───────────────────────────────────────────────────────

  /**
   * Get all tokens expiring within the next `withinMs` milliseconds.
   */
  async getExpiringTokens(withinMs: number = 10 * 60 * 1000) {
    const threshold = Date.now() + withinMs;

    let globalTokens: typeof oauthTokensGlobal.$inferSelect[] = [];
    let userTokens: typeof oauthTokensUser.$inferSelect[] = [];

    try {
      globalTokens = await db
        .select()
        .from(oauthTokensGlobal)
        .where(
          and(
            isNotNull(oauthTokensGlobal.expiresAt),
            lt(oauthTokensGlobal.expiresAt, threshold),
            isNotNull(oauthTokensGlobal.refreshToken),
          ),
        );
    } catch (error) {
      if (isMissingOauthTokenTableError(error)) {
        warnMissingOauthTableOnce(error);
      } else {
        throw error;
      }
    }

    try {
      userTokens = await db
        .select()
        .from(oauthTokensUser)
        .where(
          and(
            isNotNull(oauthTokensUser.expiresAt),
            lt(oauthTokensUser.expiresAt, threshold),
            isNotNull(oauthTokensUser.refreshToken),
          ),
        );
    } catch (error) {
      if (isMissingOauthTokenTableError(error)) {
        warnMissingOauthTableOnce(error);
      } else {
        throw error;
      }
    }

    return { globalTokens, userTokens };
  }

  async updateGlobalTokenAfterRefresh(
    id: string,
    accessToken: string,
    refreshToken: string | null,
    expiresAt: number | null,
  ): Promise<void> {
    await db
      .update(oauthTokensGlobal)
      .set({
        accessToken: encrypt(accessToken),
        refreshToken: refreshToken ? encrypt(refreshToken) : undefined,
        expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(oauthTokensGlobal.id, id));
  }

  async updateUserTokenAfterRefresh(
    id: string,
    accessToken: string,
    refreshToken: string | null,
    expiresAt: number | null,
  ): Promise<void> {
    await db
      .update(oauthTokensUser)
      .set({
        accessToken: encrypt(accessToken),
        refreshToken: refreshToken ? encrypt(refreshToken) : undefined,
        expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(oauthTokensUser.id, id));
  }

  // ─── Cache Management ────────────────────────────────────────────────────

  private invalidateModelCache(provider: OAuthProvider): void {
    for (const [key] of modelCache) {
      if (key.startsWith(`${provider}:`)) {
        modelCache.delete(key);
      }
    }
  }
}

export const providersService = new ProvidersService();
