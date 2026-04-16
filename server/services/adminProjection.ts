/**
 * Admin User Projection — CQRS-Lite
 *
 * Replaces the in-memory `getAllUsers()` approach with a PostgreSQL
 * materialized view that is refreshed on auth events.
 *
 * The materialized view aggregates:
 *  - Core user fields (email, role, plan, status, etc.)
 *  - Linked identity providers (from user_identities)
 *  - 2FA status (from user_2fa)
 *  - Active session count (from sessions)
 *
 * Refresh is debounced (2s) to handle burst registrations efficiently.
 */

import { db } from "../db";
import { sql, type SQL } from "drizzle-orm";
import { authEventBus } from "./authEventBus";
import { Logger } from "../lib/logger";

let lastRefreshAt: Date | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let isRefreshing = false;

const REFRESH_DEBOUNCE_MS = 2000;

type AdminUserFilters = {
  search?: string;
  role?: string;
  status?: string;
  plan?: string;
  authProvider?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  page?: number;
  limit?: number;
};

type AdminUserPagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

type AdminUserListSummary = {
  totalUsers: number;
  anonymousUsers: number;
  suspendedAnonymousUsers: number;
  usersWithoutEmail: number;
  verifiedUsers: number;
  usersWithDailyLimits: number;
  usersAtDailyLimit: number;
  usersActiveToday: number;
};

type AdminUserListResult = {
  users: any[];
  pagination: AdminUserPagination;
  summary: AdminUserListSummary;
};

type AdminUserAggregateSnapshot = {
  totalUsers: number;
  activeUsers: number;
  freeUsers: number;
  activeFreeUsers: number;
  proUsers: number;
  enterpriseUsers: number;
  totalQueries: number;
};

const EFFECTIVE_DAILY_INPUT_TOKENS = sql`CASE
  WHEN u.daily_token_usage_reset_at IS NULL OR NOW() >= u.daily_token_usage_reset_at
  THEN 0
  ELSE COALESCE(u.daily_input_tokens_used, 0)
END`;

const EFFECTIVE_DAILY_OUTPUT_TOKENS = sql`CASE
  WHEN u.daily_token_usage_reset_at IS NULL OR NOW() >= u.daily_token_usage_reset_at
  THEN 0
  ELSE COALESCE(u.daily_output_tokens_used, 0)
END`;

const EFFECTIVE_DAILY_TOTAL_TOKENS = sql`${EFFECTIVE_DAILY_INPUT_TOKENS} + ${EFFECTIVE_DAILY_OUTPUT_TOKENS}`;

const HAS_DAILY_TOKEN_LIMIT = sql`(
  u.daily_input_tokens_limit IS NOT NULL
  OR u.daily_output_tokens_limit IS NOT NULL
)`;

const IS_AT_DAILY_TOKEN_LIMIT = sql`(
  (u.daily_input_tokens_limit IS NOT NULL AND ${EFFECTIVE_DAILY_INPUT_TOKENS} >= u.daily_input_tokens_limit)
  OR
  (u.daily_output_tokens_limit IS NOT NULL AND ${EFFECTIVE_DAILY_OUTPUT_TOKENS} >= u.daily_output_tokens_limit)
)`;

const PROJECTION_SORT_COLUMNS: Record<string, SQL> = {
  createdAt: sql`p.created_at`,
  email: sql`LOWER(COALESCE(p.email, ''))`,
  queryCount: sql`COALESCE(p.query_count, 0)`,
  tokensConsumed: sql`COALESCE(p.tokens_consumed, 0)`,
  openclawTokensConsumed: sql`COALESCE(u.openclaw_tokens_consumed, 0)`,
  dailyTokensUsed: EFFECTIVE_DAILY_TOTAL_TOKENS,
  lastLoginAt: sql`p.last_login_at`,
  loginCount: sql`COALESCE(p.login_count, 0)`,
};

const DIRECT_SORT_COLUMNS: Record<string, SQL> = {
  createdAt: sql`u.created_at`,
  email: sql`LOWER(COALESCE(u.email, ''))`,
  queryCount: sql`COALESCE(u.query_count, 0)`,
  tokensConsumed: sql`COALESCE(u.tokens_consumed, 0)`,
  openclawTokensConsumed: sql`COALESCE(u.openclaw_tokens_consumed, 0)`,
  dailyTokensUsed: EFFECTIVE_DAILY_TOTAL_TOKENS,
  lastLoginAt: sql`u.last_login_at`,
  loginCount: sql`COALESCE(u.login_count, 0)`,
};

function isMissingProjectionError(error: unknown): boolean {
  const anyError = error as { cause?: { code?: string }; code?: string } | undefined;
  const code = anyError?.cause?.code || anyError?.code;
  return code === "42P01";
}

function isMissingDeletedAtColumnError(error: unknown): boolean {
  const anyError = error as { cause?: { code?: string; message?: string }; code?: string; message?: string } | undefined;
  const code = anyError?.cause?.code || anyError?.code;
  const message = anyError?.cause?.message || anyError?.message || "";
  return code === "42703" && message.includes("deleted_at");
}

function isMissingOpenClawColumnError(error: unknown): boolean {
  const anyError = error as { cause?: { code?: string; message?: string }; code?: string; message?: string } | undefined;
  const code = anyError?.cause?.code || anyError?.code;
  const message = anyError?.cause?.message || anyError?.message || "";
  return code === "42703" && message.includes("openclaw_tokens_consumed");
}

function isMissingRelationNamedError(error: unknown, relationName: string): boolean {
  const anyError = error as { cause?: { code?: string; message?: string }; code?: string; message?: string } | undefined;
  const code = anyError?.cause?.code || anyError?.code;
  const message = anyError?.cause?.message || anyError?.message || "";
  return code === "42P01" && message.includes(`"${relationName}"`);
}

function normalizeLimit(limit?: number, fallback = 20, max = 100): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(limit || fallback)));
}

function buildPagination(page: number, limit: number, total: number): AdminUserPagination {
  const totalPages = total > 0 ? Math.ceil(total / limit) : 0;
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page * limit < total,
    hasPrev: page > 1,
  };
}

function toSafeInt(value: unknown): number {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function buildListSummary(row: Record<string, unknown> | undefined): AdminUserListSummary {
  return {
    totalUsers: toSafeInt(row?.totalUsers),
    anonymousUsers: toSafeInt(row?.anonymousUsers),
    suspendedAnonymousUsers: toSafeInt(row?.suspendedAnonymousUsers),
    usersWithoutEmail: toSafeInt(row?.usersWithoutEmail),
    verifiedUsers: toSafeInt(row?.verifiedUsers),
    usersWithDailyLimits: toSafeInt(row?.usersWithDailyLimits),
    usersAtDailyLimit: toSafeInt(row?.usersAtDailyLimit),
    usersActiveToday: toSafeInt(row?.usersActiveToday),
  };
}

function buildProjectionConditions(filters: AdminUserFilters, includeDeletedAtGuard = true): SQL[] {
  const conditions: SQL[] = [];

  if (includeDeletedAtGuard) {
    conditions.push(sql`u.deleted_at IS NULL`);
  }

  if (filters.search) {
    const search = `%${filters.search}%`;
    conditions.push(sql`(
      COALESCE(p.email, '') ILIKE ${search}
      OR COALESCE(p.full_name, '') ILIKE ${search}
      OR COALESCE(p.first_name, '') ILIKE ${search}
      OR COALESCE(p.last_name, '') ILIKE ${search}
      OR COALESCE(u.username, '') ILIKE ${search}
    )`);
  }

  if (filters.role) {
    conditions.push(sql`LOWER(COALESCE(p.role, '')) = ${filters.role.toLowerCase()}`);
  }

  if (filters.status) {
    conditions.push(sql`LOWER(COALESCE(p.status, '')) = ${filters.status.toLowerCase()}`);
  }

  if (filters.plan) {
    conditions.push(sql`LOWER(COALESCE(p.plan, '')) = ${filters.plan.toLowerCase()}`);
  }

  if (filters.authProvider) {
    conditions.push(sql`LOWER(COALESCE(p.auth_provider, u.auth_provider, '')) = ${filters.authProvider.toLowerCase()}`);
  }

  return conditions;
}

function buildDirectConditions(filters: AdminUserFilters, includeDeletedAtGuard = true): SQL[] {
  const conditions: SQL[] = [];

  if (includeDeletedAtGuard) {
    conditions.push(sql`u.deleted_at IS NULL`);
  }

  if (filters.search) {
    const search = `%${filters.search}%`;
    conditions.push(sql`(
      COALESCE(u.email, '') ILIKE ${search}
      OR COALESCE(u.full_name, '') ILIKE ${search}
      OR COALESCE(u.first_name, '') ILIKE ${search}
      OR COALESCE(u.last_name, '') ILIKE ${search}
      OR COALESCE(u.username, '') ILIKE ${search}
    )`);
  }

  if (filters.role) {
    conditions.push(sql`LOWER(COALESCE(u.role, '')) = ${filters.role.toLowerCase()}`);
  }

  if (filters.status) {
    conditions.push(sql`LOWER(COALESCE(u.status, '')) = ${filters.status.toLowerCase()}`);
  }

  if (filters.plan) {
    conditions.push(sql`LOWER(COALESCE(u.plan, '')) = ${filters.plan.toLowerCase()}`);
  }

  if (filters.authProvider) {
    conditions.push(sql`LOWER(COALESCE(u.auth_provider, '')) = ${filters.authProvider.toLowerCase()}`);
  }

  return conditions;
}

function buildWhereClause(conditions: SQL[]): SQL {
  return conditions.length > 0 ? sql`${sql.join(conditions, sql` AND `)}` : sql`TRUE`;
}

function getSortDirection(order?: "asc" | "desc"): SQL {
  return order === "asc" ? sql.raw("ASC") : sql.raw("DESC");
}

async function runProjectionUserQuery(
  filters: AdminUserFilters,
  page: number,
  limit: number,
  offset: number,
  sortExpression: SQL,
  sortDirection: SQL,
  includeDeletedAtGuard = true,
): Promise<AdminUserListResult> {
  const whereClause = buildWhereClause(buildProjectionConditions(filters, includeDeletedAtGuard));

  const summaryResult = await db.execute(sql`
    SELECT
      COUNT(*)::int AS "totalUsers",
      COUNT(*) FILTER (
        WHERE LOWER(COALESCE(p.auth_provider, u.auth_provider, '')) = 'anonymous'
      )::int AS "anonymousUsers",
      COUNT(*) FILTER (
        WHERE LOWER(COALESCE(p.auth_provider, u.auth_provider, '')) = 'anonymous'
          AND LOWER(COALESCE(p.status, '')) = 'suspended'
      )::int AS "suspendedAnonymousUsers",
      COUNT(*) FILTER (
        WHERE NULLIF(BTRIM(COALESCE(p.email, '')), '') IS NULL
      )::int AS "usersWithoutEmail",
      COUNT(*) FILTER (
        WHERE LOWER(COALESCE(p.email_verified, 'false')) = 'true'
      )::int AS "verifiedUsers",
      COUNT(*) FILTER (
        WHERE ${HAS_DAILY_TOKEN_LIMIT}
      )::int AS "usersWithDailyLimits",
      COUNT(*) FILTER (
        WHERE ${IS_AT_DAILY_TOKEN_LIMIT}
      )::int AS "usersAtDailyLimit",
      COUNT(*) FILTER (
        WHERE ${EFFECTIVE_DAILY_TOTAL_TOKENS} > 0
      )::int AS "usersActiveToday"
    FROM admin_user_projection p
    INNER JOIN users u ON u.id = p.id
    WHERE ${whereClause}
  `);
  const summary = buildListSummary(((summaryResult as any)?.rows?.[0] || {}) as Record<string, unknown>);
  const total = summary.totalUsers;

  const dataResult = await db.execute(sql`
    SELECT
      p.id,
      p.email,
      p.full_name AS "fullName",
      p.first_name AS "firstName",
      p.last_name AS "lastName",
      u.username AS "username",
      p.role,
      p.plan,
      p.status,
      p.auth_provider AS "authProvider",
      COALESCE(p.email_verified, 'false') AS "emailVerified",
      CASE
        WHEN COALESCE(p.has_2fa, false) THEN 'true'
        ELSE COALESCE(u.is_2fa_enabled, 'false')
      END AS "is2faEnabled",
      p.created_at AS "createdAt",
      p.updated_at AS "updatedAt",
      p.last_login_at AS "lastLoginAt",
      COALESCE(p.login_count, 0) AS "loginCount",
      COALESCE(p.query_count, 0) AS "queryCount",
      COALESCE(p.tokens_consumed, 0) AS "tokensConsumed",
      COALESCE(u.openclaw_tokens_consumed, 0) AS "openclawTokensConsumed",
      ${EFFECTIVE_DAILY_INPUT_TOKENS}::int AS "dailyInputTokensUsed",
      ${EFFECTIVE_DAILY_OUTPUT_TOKENS}::int AS "dailyOutputTokensUsed",
      (${EFFECTIVE_DAILY_TOTAL_TOKENS})::int AS "dailyTotalTokensUsed",
      u.daily_input_tokens_limit AS "dailyInputTokensLimit",
      u.daily_output_tokens_limit AS "dailyOutputTokensLimit",
      ${IS_AT_DAILY_TOKEN_LIMIT} AS "dailyLimitReached",
      COALESCE(u.tokens_limit, 0) AS "tokensLimit",
      COALESCE(u.credits_balance, 0) AS "creditsBalance",
      u.last_ip AS "lastIp",
      u.country_code AS "countryCode",
      u.referral_code AS "referralCode",
      u.referred_by AS "referredBy",
      u.internal_notes AS "internalNotes",
      COALESCE(u.tags, ARRAY[]::text[]) AS "tags",
      COALESCE(p.linked_providers, ARRAY[]::text[]) AS "linkedProviders",
      COALESCE(p.active_sessions, 0) AS "activeSessions"
    FROM admin_user_projection p
    INNER JOIN users u ON u.id = p.id
    WHERE ${whereClause}
    ORDER BY ${sortExpression} ${sortDirection} NULLS LAST, p.id ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  return {
    users: (dataResult as any)?.rows || [],
    pagination: buildPagination(page, limit, total),
    summary,
  };
}

async function runDirectUserQuery(
  filters: AdminUserFilters,
  page: number,
  limit: number,
  offset: number,
  sortExpression: SQL,
  sortDirection: SQL,
  includeDeletedAtGuard = true,
  includeOpenClawColumn = true,
  includeRelatedTables = true,
): Promise<AdminUserListResult> {
  const whereClause = buildWhereClause(buildDirectConditions(filters, includeDeletedAtGuard));
  const openClawSelect = includeOpenClawColumn ? sql`COALESCE(u.openclaw_tokens_consumed, 0)` : sql`0`;
  const linkedProvidersSelect = includeRelatedTables
    ? sql`COALESCE((
        SELECT array_agg(DISTINCT ui.provider)
        FROM user_identities ui
        WHERE ui.user_id = u.id
      ), ARRAY[]::text[])`
    : sql`ARRAY[]::text[]`;
  const activeSessionsSelect = includeRelatedTables
    ? sql`COALESCE((
        SELECT COUNT(*)
        FROM sessions s
        WHERE s.user_id = u.id AND s.expire > NOW()
      ), 0)`
    : sql`0`;

  const summaryResult = await db.execute(sql`
    SELECT
      COUNT(*)::int AS "totalUsers",
      COUNT(*) FILTER (
        WHERE LOWER(COALESCE(u.auth_provider, '')) = 'anonymous'
      )::int AS "anonymousUsers",
      COUNT(*) FILTER (
        WHERE LOWER(COALESCE(u.auth_provider, '')) = 'anonymous'
          AND LOWER(COALESCE(u.status, '')) = 'suspended'
      )::int AS "suspendedAnonymousUsers",
      COUNT(*) FILTER (
        WHERE NULLIF(BTRIM(COALESCE(u.email, '')), '') IS NULL
      )::int AS "usersWithoutEmail",
      COUNT(*) FILTER (
        WHERE LOWER(COALESCE(u.email_verified, 'false')) = 'true'
      )::int AS "verifiedUsers",
      COUNT(*) FILTER (
        WHERE ${HAS_DAILY_TOKEN_LIMIT}
      )::int AS "usersWithDailyLimits",
      COUNT(*) FILTER (
        WHERE ${IS_AT_DAILY_TOKEN_LIMIT}
      )::int AS "usersAtDailyLimit",
      COUNT(*) FILTER (
        WHERE ${EFFECTIVE_DAILY_TOTAL_TOKENS} > 0
      )::int AS "usersActiveToday"
    FROM users u
    WHERE ${whereClause}
  `);
  const summary = buildListSummary(((summaryResult as any)?.rows?.[0] || {}) as Record<string, unknown>);
  const total = summary.totalUsers;

  const dataResult = await db.execute(sql`
    SELECT
      u.id,
      u.email,
      u.full_name AS "fullName",
      u.first_name AS "firstName",
      u.last_name AS "lastName",
      u.username AS "username",
      u.role,
      u.plan,
      u.status,
      u.auth_provider AS "authProvider",
      COALESCE(u.email_verified, 'false') AS "emailVerified",
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM user_2fa u2
          WHERE u2.user_id = u.id AND u2.is_enabled = true
        ) THEN 'true'
        ELSE COALESCE(u.is_2fa_enabled, 'false')
      END AS "is2faEnabled",
      u.created_at AS "createdAt",
      u.updated_at AS "updatedAt",
      u.last_login_at AS "lastLoginAt",
      COALESCE(u.login_count, 0) AS "loginCount",
      COALESCE(u.query_count, 0) AS "queryCount",
      COALESCE(u.tokens_consumed, 0) AS "tokensConsumed",
      ${openClawSelect}::int AS "openclawTokensConsumed",
      ${EFFECTIVE_DAILY_INPUT_TOKENS}::int AS "dailyInputTokensUsed",
      ${EFFECTIVE_DAILY_OUTPUT_TOKENS}::int AS "dailyOutputTokensUsed",
      (${EFFECTIVE_DAILY_TOTAL_TOKENS})::int AS "dailyTotalTokensUsed",
      u.daily_input_tokens_limit AS "dailyInputTokensLimit",
      u.daily_output_tokens_limit AS "dailyOutputTokensLimit",
      ${IS_AT_DAILY_TOKEN_LIMIT} AS "dailyLimitReached",
      COALESCE(u.tokens_limit, 0) AS "tokensLimit",
      COALESCE(u.credits_balance, 0) AS "creditsBalance",
      u.last_ip AS "lastIp",
      u.country_code AS "countryCode",
      u.referral_code AS "referralCode",
      u.referred_by AS "referredBy",
      u.internal_notes AS "internalNotes",
      COALESCE(u.tags, ARRAY[]::text[]) AS "tags",
      ${linkedProvidersSelect} AS "linkedProviders",
      ${activeSessionsSelect}::int AS "activeSessions"
    FROM users u
    WHERE ${whereClause}
    ORDER BY ${sortExpression} ${sortDirection} NULLS LAST, u.id ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  return {
    users: (dataResult as any)?.rows || [],
    pagination: buildPagination(page, limit, total),
    summary,
  };
}

/**
 * Refresh the materialized view.
 * Uses CONCURRENTLY so it doesn't block reads.
 */
export async function refreshAdminProjection(): Promise<void> {
  if (isRefreshing) return; // Skip if already refreshing

  isRefreshing = true;
  const start = Date.now();

  try {
    await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY admin_user_projection`);
    lastRefreshAt = new Date();
    Logger.info(`[AdminProjection] Refreshed in ${Date.now() - start}ms`);
  } catch (error: any) {
    const code = error?.cause?.code || error?.code;
    // 42P01 = relation doesn't exist (pre-migration)
    if (code === "42P01") {
      Logger.info("[AdminProjection] Materialized view not yet created — skipping refresh");
    } else {
      Logger.error(`[AdminProjection] Refresh failed: ${error?.message}`);
    }
  } finally {
    isRefreshing = false;
  }
}

/**
 * Schedule a debounced refresh.
 * Multiple rapid events within REFRESH_DEBOUNCE_MS will only trigger one refresh.
 */
function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    refreshTimer = null;
    await refreshAdminProjection();
  }, REFRESH_DEBOUNCE_MS);
}

/**
 * Query the admin user projection with pagination, search, and filters.
 * Falls back to direct users table query if the materialized view doesn't exist.
 */
export async function queryAdminUsers(filters: {
  search?: string;
  role?: string;
  status?: string;
  plan?: string;
  authProvider?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  page?: number;
  limit?: number;
}): Promise<AdminUserListResult> {
  const page = Math.max(1, filters.page || 1);
  const limit = normalizeLimit(filters.limit, 20, 2000);
  const offset = (page - 1) * limit;
  const sortDirection = getSortDirection(filters.sortOrder);
  const projectionSortExpression = PROJECTION_SORT_COLUMNS[filters.sortBy || "createdAt"] || PROJECTION_SORT_COLUMNS.createdAt;
  const directSortExpression = DIRECT_SORT_COLUMNS[filters.sortBy || "createdAt"] || DIRECT_SORT_COLUMNS.createdAt;
  const legacyOpenClawSafeSortExpression =
    filters.sortBy === "openclawTokensConsumed" ? sql`0` : directSortExpression;

  const runDirectWithLegacyFallback = async (): Promise<AdminUserListResult> => {
    try {
      return await runDirectUserQuery(filters, page, limit, offset, directSortExpression, sortDirection);
    } catch (directError: any) {
      if (isMissingDeletedAtColumnError(directError)) {
        Logger.info("[AdminProjection] users.deleted_at missing — using legacy direct users query");
        try {
          return await runDirectUserQuery(filters, page, limit, offset, directSortExpression, sortDirection, false, true);
        } catch (legacyError: any) {
          if (
            isMissingRelationNamedError(legacyError, "user_identities")
            || isMissingRelationNamedError(legacyError, "sessions")
          ) {
            Logger.info("[AdminProjection] Related auth/session tables missing — using minimal legacy direct users query");
            return runDirectUserQuery(filters, page, limit, offset, directSortExpression, sortDirection, false, true, false);
          }
          if (isMissingOpenClawColumnError(legacyError)) {
            Logger.info("[AdminProjection] users.openclaw_tokens_consumed missing — using legacy direct users query");
            try {
              return await runDirectUserQuery(filters, page, limit, offset, legacyOpenClawSafeSortExpression, sortDirection, false, false, true);
            } catch (relationError: any) {
              if (
                isMissingRelationNamedError(relationError, "user_identities")
                || isMissingRelationNamedError(relationError, "sessions")
              ) {
                Logger.info("[AdminProjection] Related auth/session tables missing — using minimal legacy direct users query");
                return runDirectUserQuery(filters, page, limit, offset, legacyOpenClawSafeSortExpression, sortDirection, false, false, false);
              }
              throw relationError;
            }
          }
          throw legacyError;
        }
      }

      if (isMissingOpenClawColumnError(directError)) {
        Logger.info("[AdminProjection] users.openclaw_tokens_consumed missing — using legacy direct users query");
        try {
          return await runDirectUserQuery(filters, page, limit, offset, legacyOpenClawSafeSortExpression, sortDirection, true, false, true);
        } catch (relationError: any) {
          if (
            isMissingRelationNamedError(relationError, "user_identities")
            || isMissingRelationNamedError(relationError, "sessions")
          ) {
            Logger.info("[AdminProjection] Related auth/session tables missing — using minimal legacy direct users query");
            return runDirectUserQuery(filters, page, limit, offset, legacyOpenClawSafeSortExpression, sortDirection, true, false, false);
          }
          throw relationError;
        }
      }

      if (
        isMissingRelationNamedError(directError, "user_identities")
        || isMissingRelationNamedError(directError, "sessions")
      ) {
        Logger.info("[AdminProjection] Related auth/session tables missing — using minimal legacy direct users query");
        return runDirectUserQuery(filters, page, limit, offset, directSortExpression, sortDirection, true, true, false);
      }

      throw directError;
    }
  };

  try {
    return await runProjectionUserQuery(filters, page, limit, offset, projectionSortExpression, sortDirection);
  } catch (error: any) {
    if (isMissingProjectionError(error)) {
      Logger.info("[AdminProjection] View not found — falling back to direct users query");
      return runDirectWithLegacyFallback();
    }
    if (isMissingDeletedAtColumnError(error) || isMissingOpenClawColumnError(error)) {
      Logger.info("[AdminProjection] Legacy users schema detected — bypassing projection");
      return runDirectWithLegacyFallback();
    }
    throw error;
  }
}

export async function getAdminUserAggregateSnapshot(): Promise<AdminUserAggregateSnapshot> {
  try {
    const result = await db.execute(sql`
      SELECT
        COUNT(*)::int AS "totalUsers",
        COUNT(*) FILTER (WHERE LOWER(COALESCE(p.status, '')) = 'active')::int AS "activeUsers",
        COUNT(*) FILTER (WHERE LOWER(COALESCE(p.plan, '')) = 'free')::int AS "freeUsers",
        COUNT(*) FILTER (
          WHERE LOWER(COALESCE(p.plan, '')) = 'free'
            AND LOWER(COALESCE(p.status, '')) = 'active'
        )::int AS "activeFreeUsers",
        COUNT(*) FILTER (WHERE LOWER(COALESCE(p.plan, '')) = 'pro')::int AS "proUsers",
        COUNT(*) FILTER (WHERE LOWER(COALESCE(p.plan, '')) = 'enterprise')::int AS "enterpriseUsers",
        COALESCE(SUM(COALESCE(p.query_count, 0)), 0)::bigint AS "totalQueries"
      FROM admin_user_projection p
    `);
    const row = (result as any)?.rows?.[0] || {};
    return {
      totalUsers: Number(row.totalUsers || 0),
      activeUsers: Number(row.activeUsers || 0),
      freeUsers: Number(row.freeUsers || 0),
      activeFreeUsers: Number(row.activeFreeUsers || 0),
      proUsers: Number(row.proUsers || 0),
      enterpriseUsers: Number(row.enterpriseUsers || 0),
      totalQueries: Number(row.totalQueries || 0),
    };
  } catch (error) {
    if (!isMissingProjectionError(error)) {
      throw error;
    }
    Logger.info("[AdminProjection] Aggregate fallback — materialized view not available");
    // Audit fix 2026-04-10: removed `WHERE u.deleted_at IS NULL` — the users
    // table does not have a deleted_at column, causing this fallback query to
    // fail whenever the admin_user_projection materialized view was missing.
    const result = await db.execute(sql`
      SELECT
        COUNT(*)::int AS "totalUsers",
        COUNT(*) FILTER (WHERE LOWER(COALESCE(u.status, '')) = 'active')::int AS "activeUsers",
        COUNT(*) FILTER (WHERE LOWER(COALESCE(u.plan, '')) = 'free')::int AS "freeUsers",
        COUNT(*) FILTER (
          WHERE LOWER(COALESCE(u.plan, '')) = 'free'
            AND LOWER(COALESCE(u.status, '')) = 'active'
        )::int AS "activeFreeUsers",
        COUNT(*) FILTER (WHERE LOWER(COALESCE(u.plan, '')) = 'pro')::int AS "proUsers",
        COUNT(*) FILTER (WHERE LOWER(COALESCE(u.plan, '')) = 'enterprise')::int AS "enterpriseUsers",
        COALESCE(SUM(COALESCE(u.query_count, 0)), 0)::bigint AS "totalQueries"
      FROM users u
    `);
    const row = (result as any)?.rows?.[0] || {};
    return {
      totalUsers: Number(row.totalUsers || 0),
      activeUsers: Number(row.activeUsers || 0),
      freeUsers: Number(row.freeUsers || 0),
      activeFreeUsers: Number(row.activeFreeUsers || 0),
      proUsers: Number(row.proUsers || 0),
      enterpriseUsers: Number(row.enterpriseUsers || 0),
      totalQueries: Number(row.totalQueries || 0),
    };
  }
}

export async function getRecentAdminUsers(hours: number, limit = 100): Promise<any[]> {
  const safeHours = Math.max(1, Math.min(24 * 365, Math.trunc(hours || 24)));
  const safeLimit = normalizeLimit(limit, 100, 500);
  const since = new Date(Date.now() - safeHours * 60 * 60 * 1000);

  try {
    const result = await db.execute(sql`
      SELECT
        p.id,
        p.email,
        p.full_name AS "fullName",
        p.auth_provider AS "authProvider",
        p.created_at AS "createdAt",
        p.status
      FROM admin_user_projection p
      WHERE p.created_at >= ${since}
      ORDER BY p.created_at DESC NULLS LAST, p.id ASC
      LIMIT ${safeLimit}
    `);
    return (result as any)?.rows || [];
  } catch (error) {
    if (!isMissingProjectionError(error)) {
      throw error;
    }
    Logger.info("[AdminProjection] Recent users fallback — materialized view not available");
    const result = await db.execute(sql`
      SELECT
        u.id,
        u.email,
        u.full_name AS "fullName",
        u.auth_provider AS "authProvider",
        u.created_at AS "createdAt",
        u.status
      FROM users u
      WHERE u.deleted_at IS NULL AND u.created_at >= ${since}
      ORDER BY u.created_at DESC NULLS LAST, u.id ASC
      LIMIT ${safeLimit}
    `);
    return (result as any)?.rows || [];
  }
}

export async function getActiveAdminSessions(limit = 100): Promise<any[]> {
  const safeLimit = normalizeLimit(limit, 100, 500);

  try {
    const result = await db.execute(sql`
      SELECT
        p.id,
        p.email,
        p.full_name AS "fullName",
        p.last_login_at AS "lastLoginAt",
        p.plan,
        COALESCE(p.active_sessions, 0) AS "activeSessions"
      FROM admin_user_projection p
      WHERE COALESCE(p.active_sessions, 0) > 0
      ORDER BY COALESCE(p.active_sessions, 0) DESC, p.last_login_at DESC NULLS LAST, p.id ASC
      LIMIT ${safeLimit}
    `);
    return (result as any)?.rows || [];
  } catch (error) {
    if (!isMissingProjectionError(error)) {
      throw error;
    }
    Logger.info("[AdminProjection] Active sessions fallback — materialized view not available");
    const result = await db.execute(sql`
      SELECT
        u.id,
        u.email,
        u.full_name AS "fullName",
        u.last_login_at AS "lastLoginAt",
        u.plan,
        COALESCE((
          SELECT COUNT(*)
          FROM sessions s
          WHERE s.user_id = u.id AND s.expire > NOW()
        ), 0) AS "activeSessions"
      FROM users u
      WHERE u.deleted_at IS NULL
        AND COALESCE((
          SELECT COUNT(*)
          FROM sessions s
          WHERE s.user_id = u.id AND s.expire > NOW()
        ), 0) > 0
      ORDER BY "activeSessions" DESC, u.last_login_at DESC NULLS LAST, u.id ASC
      LIMIT ${safeLimit}
    `);
    return (result as any)?.rows || [];
  }
}

/**
 * Get projection health status.
 */
export function getProjectionHealth(): {
  lastRefreshAt: string | null;
  isRefreshing: boolean;
} {
  return {
    lastRefreshAt: lastRefreshAt?.toISOString() || null,
    isRefreshing,
  };
}

/**
 * Initialize the projection consumer.
 * Subscribes to auth events and schedules debounced refreshes.
 */
export function initAdminProjection(): void {
  authEventBus.onAuth((_event) => {
    scheduleRefresh();
  });

  // Initial refresh on startup (non-blocking)
  setTimeout(() => refreshAdminProjection(), 5000);

  Logger.info("[AdminProjection] Consumer initialized — listening for auth events");
}
