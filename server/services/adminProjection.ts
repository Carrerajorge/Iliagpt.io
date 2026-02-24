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
import { sql } from "drizzle-orm";
import { authEventBus } from "./authEventBus";
import { Logger } from "../lib/logger";

let lastRefreshAt: Date | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let isRefreshing = false;

const REFRESH_DEBOUNCE_MS = 2000;

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
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  page?: number;
  limit?: number;
}): Promise<{ users: any[]; pagination: any }> {
  const page = Math.max(1, filters.page || 1);
  const limit = Math.min(100, Math.max(1, filters.limit || 20));
  const offset = (page - 1) * limit;
  const sortOrder = filters.sortOrder === "asc" ? "ASC" : "DESC";

  // Map sortBy to safe column names
  const sortColumns: Record<string, string> = {
    createdAt: "created_at",
    email: "email",
    queryCount: "query_count",
    tokensConsumed: "tokens_consumed",
    lastLoginAt: "last_login_at",
    loginCount: "login_count",
  };
  const sortCol = sortColumns[filters.sortBy || "createdAt"] || "created_at";

  try {
    // Try materialized view first
    const whereClauses: string[] = ["1=1"];
    const params: any[] = [];
    let paramIdx = 1;

    if (filters.search) {
      whereClauses.push(
        `(email ILIKE $${paramIdx} OR full_name ILIKE $${paramIdx} OR first_name ILIKE $${paramIdx} OR last_name ILIKE $${paramIdx})`
      );
      params.push(`%${filters.search}%`);
      paramIdx++;
    }

    if (filters.role) {
      whereClauses.push(`role = $${paramIdx}`);
      params.push(filters.role);
      paramIdx++;
    }

    if (filters.status) {
      whereClauses.push(`status = $${paramIdx}`);
      params.push(filters.status);
      paramIdx++;
    }

    if (filters.plan) {
      whereClauses.push(`plan = $${paramIdx}`);
      params.push(filters.plan);
      paramIdx++;
    }

    const whereClause = whereClauses.join(" AND ");

    // Use raw SQL for the materialized view query
    const countResult = await db.execute(
      sql.raw(`SELECT COUNT(*) as total FROM admin_user_projection WHERE ${whereClause}`)
    );
    const total = Number((countResult as any)?.rows?.[0]?.total || 0);

    const dataResult = await db.execute(
      sql.raw(
        `SELECT * FROM admin_user_projection WHERE ${whereClause} ORDER BY ${sortCol} ${sortOrder} LIMIT ${limit} OFFSET ${offset}`
      )
    );
    const rows = (dataResult as any)?.rows || [];

    return {
      users: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  } catch (error: any) {
    const code = error?.cause?.code || error?.code;
    if (code === "42P01") {
      // Materialized view doesn't exist — fall back to direct query
      Logger.info("[AdminProjection] View not found — falling back to direct users query");
      return fallbackDirectQuery(filters, page, limit, offset, sortCol, sortOrder);
    }
    throw error;
  }
}

/**
 * Fallback: query users table directly (pre-migration compatibility).
 */
async function fallbackDirectQuery(
  filters: any,
  page: number,
  limit: number,
  offset: number,
  sortCol: string,
  sortOrder: string,
): Promise<{ users: any[]; pagination: any }> {
  const whereClauses: string[] = ["deleted_at IS NULL"];

  if (filters.search) {
    whereClauses.push(
      `(email ILIKE '%${filters.search.replace(/'/g, "''")}%' OR full_name ILIKE '%${filters.search.replace(/'/g, "''")}%')`
    );
  }
  if (filters.role) {
    whereClauses.push(`role = '${filters.role.replace(/'/g, "''")}'`);
  }
  if (filters.status) {
    whereClauses.push(`status = '${filters.status.replace(/'/g, "''")}'`);
  }
  if (filters.plan) {
    whereClauses.push(`plan = '${filters.plan.replace(/'/g, "''")}'`);
  }

  const where = whereClauses.join(" AND ");

  const countResult = await db.execute(sql.raw(`SELECT COUNT(*) as total FROM users WHERE ${where}`));
  const total = Number((countResult as any)?.rows?.[0]?.total || 0);

  const dataResult = await db.execute(
    sql.raw(`SELECT * FROM users WHERE ${where} ORDER BY ${sortCol} ${sortOrder} LIMIT ${limit} OFFSET ${offset}`)
  );

  return {
    users: (dataResult as any)?.rows || [],
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
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
