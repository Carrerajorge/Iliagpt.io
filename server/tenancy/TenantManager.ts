import Redis from "ioredis";
import { LRUCache } from "lru-cache";
import { Logger } from "../lib/logger";
import { env } from "../config/env";
import { pool } from "../db";
import { getDefaultLimits } from "./TenantContext";
import type { TenantLimits } from "./TenantContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TenantConfig {
  allowedDomains?: string[];
  ssoProvider?: string;
  defaultLocale?: string;
  customBranding?: Record<string, string>;
  webhookUrl?: string;
  ipAllowList?: string[];
  [key: string]: unknown;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  plan: "free" | "pro" | "enterprise";
  status: "active" | "suspended" | "deleted";
  features: string[];
  limits: TenantLimits;
  config: TenantConfig;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTenantInput {
  slug: string;
  name: string;
  plan?: "free" | "pro" | "enterprise";
  features?: string[];
  config?: Partial<TenantConfig>;
}

export interface TenantFilter {
  status?: "active" | "suspended" | "deleted";
  plan?: "free" | "pro" | "enterprise";
  search?: string;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// TenantManager
// ---------------------------------------------------------------------------

class TenantManager {
  private cache: LRUCache<string, Tenant>;
  private redis: Redis;
  private readonly REDIS_PREFIX = "tenant:";
  private readonly REDIS_TTL = 300; // 5 minutes

  constructor() {
    this.cache = new LRUCache<string, Tenant>({
      max: 500,
      ttl: 5 * 60 * 1000, // 5 minutes in-process
    });

    this.redis = new Redis(env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 2,
      enableReadyCheck: false,
      lazyConnect: true,
    });

    this.redis.on("error", (err) => {
      Logger.warn("[TenantManager] Redis error (non-fatal)", { error: err.message });
    });

    this.ensureSchema().catch((err) =>
      Logger.error("[TenantManager] Schema init error", err)
    );
  }

  // ---------------------------------------------------------------------------
  // Schema bootstrap (idempotent)
  // ---------------------------------------------------------------------------

  private async ensureSchema(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id          TEXT PRIMARY KEY,
        slug        TEXT UNIQUE NOT NULL,
        name        TEXT NOT NULL,
        plan        TEXT NOT NULL DEFAULT 'free',
        status      TEXT NOT NULL DEFAULT 'active',
        features    TEXT[]  NOT NULL DEFAULT '{}',
        limits      JSONB   NOT NULL DEFAULT '{}',
        config      JSONB   NOT NULL DEFAULT '{}',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async createTenant(input: CreateTenantInput): Promise<Tenant> {
    const plan = input.plan ?? "free";
    const id = crypto.randomUUID();

    const tenant: Tenant = {
      id,
      slug: input.slug,
      name: input.name,
      plan,
      status: "active",
      features: input.features ?? [],
      limits: getDefaultLimits(plan),
      config: input.config ?? {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await pool.query<Tenant>(
      `INSERT INTO tenants (id, slug, name, plan, status, features, limits, config, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
       RETURNING *`,
      [
        tenant.id,
        tenant.slug,
        tenant.name,
        tenant.plan,
        tenant.status,
        tenant.features,
        JSON.stringify(tenant.limits),
        JSON.stringify(tenant.config),
        tenant.createdAt,
        tenant.updatedAt,
      ]
    );

    const created = this.mapRow(result.rows[0]);
    this.setCache(created);
    Logger.info(`[TenantManager] Created tenant: ${created.slug} (${created.id})`);
    return created;
  }

  async getTenant(id: string): Promise<Tenant | null> {
    // L1 — in-process LRU
    const cached = this.cache.get(id);
    if (cached) return cached;

    // L2 — Redis
    const redisKey = `${this.REDIS_PREFIX}${id}`;
    try {
      const raw = await this.redis.get(redisKey);
      if (raw) {
        const tenant = JSON.parse(raw) as Tenant;
        tenant.createdAt = new Date(tenant.createdAt);
        tenant.updatedAt = new Date(tenant.updatedAt);
        this.cache.set(id, tenant);
        return tenant;
      }
    } catch {
      // fall through to DB
    }

    // L3 — Database
    const result = await pool.query<any>(
      `SELECT * FROM tenants WHERE id = $1 AND status != 'deleted'`,
      [id]
    );
    if (result.rows.length === 0) return null;
    const tenant = this.mapRow(result.rows[0]);
    this.setCache(tenant);
    return tenant;
  }

  async getTenantBySlug(slug: string): Promise<Tenant | null> {
    // Check LRU by iterating values (slug isn't a primary key)
    for (const t of this.cache.values()) {
      if (t.slug === slug) return t;
    }

    const result = await pool.query<any>(
      `SELECT * FROM tenants WHERE slug = $1 AND status != 'deleted'`,
      [slug]
    );
    if (result.rows.length === 0) return null;
    const tenant = this.mapRow(result.rows[0]);
    this.setCache(tenant);
    return tenant;
  }

  async updateTenant(id: string, updates: Partial<Tenant>): Promise<Tenant> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    const allowed: (keyof Tenant)[] = ["name", "plan", "features", "limits", "config"];
    for (const key of allowed) {
      if (key in updates) {
        const val = updates[key];
        if (key === "limits" || key === "config") {
          fields.push(`${this.toSnakeCase(key)} = $${paramIdx}::jsonb`);
          values.push(JSON.stringify(val));
        } else if (key === "features") {
          fields.push(`features = $${paramIdx}`);
          values.push(val);
        } else {
          fields.push(`${this.toSnakeCase(key)} = $${paramIdx}`);
          values.push(val);
        }
        paramIdx++;
      }
    }

    if (fields.length === 0) {
      const existing = await this.getTenant(id);
      if (!existing) throw new Error(`Tenant ${id} not found`);
      return existing;
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query<any>(
      `UPDATE tenants SET ${fields.join(", ")} WHERE id = $${paramIdx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) throw new Error(`Tenant ${id} not found`);
    const tenant = this.mapRow(result.rows[0]);

    await this.invalidateCache(id);
    this.setCache(tenant);
    Logger.info(`[TenantManager] Updated tenant ${id}`);
    return tenant;
  }

  async suspendTenant(id: string, reason: string): Promise<void> {
    await pool.query(
      `UPDATE tenants SET status = 'suspended', updated_at = NOW(),
       config = config || $2::jsonb
       WHERE id = $1`,
      [id, JSON.stringify({ suspendedReason: reason, suspendedAt: new Date() })]
    );
    await this.invalidateCache(id);
    Logger.warn(`[TenantManager] Suspended tenant ${id}: ${reason}`);
  }

  async deleteTenant(id: string): Promise<void> {
    // Soft delete
    await pool.query(
      `UPDATE tenants SET status = 'deleted', updated_at = NOW() WHERE id = $1`,
      [id]
    );
    await this.invalidateCache(id);
    Logger.info(`[TenantManager] Soft-deleted tenant ${id}`);

    // Schedule cleanup (fire-and-forget; real cleanup via worker)
    this.scheduleCleanup(id);
  }

  async listTenants(filter: TenantFilter = {}): Promise<Tenant[]> {
    const conditions: string[] = ["status != 'deleted'"];
    const values: any[] = [];
    let idx = 1;

    if (filter.status) {
      conditions.push(`status = $${idx++}`);
      values.push(filter.status);
    }
    if (filter.plan) {
      conditions.push(`plan = $${idx++}`);
      values.push(filter.plan);
    }
    if (filter.search) {
      conditions.push(`(name ILIKE $${idx} OR slug ILIKE $${idx})`);
      values.push(`%${filter.search}%`);
      idx++;
    }

    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;

    const result = await pool.query<any>(
      `SELECT * FROM tenants WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset]
    );

    return result.rows.map((r) => this.mapRow(r));
  }

  async getTenantConfig(id: string): Promise<TenantConfig> {
    const tenant = await this.getTenant(id);
    if (!tenant) throw new Error(`Tenant ${id} not found`);
    return tenant.config;
  }

  async updateFeatureFlags(id: string, features: string[]): Promise<void> {
    await pool.query(
      `UPDATE tenants SET features = $2, updated_at = NOW() WHERE id = $1`,
      [id, features]
    );
    await this.invalidateCache(id);
    Logger.info(`[TenantManager] Updated feature flags for tenant ${id}`, { features });
  }

  async enforceIsolation(tenantId: string, resourceOwnerId: string): Promise<void> {
    if (tenantId !== resourceOwnerId) {
      Logger.security?.(
        `[TenantManager] Isolation violation: tenant ${tenantId} tried to access resource owned by ${resourceOwnerId}`
      );
      throw new Error("Access denied: cross-tenant resource access");
    }
  }

  async invalidateCache(tenantId: string): Promise<void> {
    this.cache.delete(tenantId);
    try {
      await this.redis.del(`${this.REDIS_PREFIX}${tenantId}`);
    } catch {
      // non-fatal
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private setCache(tenant: Tenant): void {
    this.cache.set(tenant.id, tenant);
    this.redis
      .setex(
        `${this.REDIS_PREFIX}${tenant.id}`,
        this.REDIS_TTL,
        JSON.stringify(tenant)
      )
      .catch(() => {});
  }

  private mapRow(row: any): Tenant {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      plan: row.plan as "free" | "pro" | "enterprise",
      status: row.status as "active" | "suspended" | "deleted",
      features: row.features ?? [],
      limits: typeof row.limits === "object" ? row.limits : JSON.parse(row.limits ?? "{}"),
      config: typeof row.config === "object" ? row.config : JSON.parse(row.config ?? "{}"),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private toSnakeCase(key: string): string {
    return key.replace(/([A-Z])/g, "_$1").toLowerCase();
  }

  private scheduleCleanup(tenantId: string): void {
    // Emit a delayed cleanup event — real worker picks this up
    setTimeout(async () => {
      try {
        await this.redis.lpush("tenant:cleanup:queue", tenantId);
        Logger.info(`[TenantManager] Enqueued cleanup for tenant ${tenantId}`);
      } catch {
        Logger.warn(`[TenantManager] Could not enqueue cleanup for tenant ${tenantId}`);
      }
    }, 5_000);
  }
}

export const tenantManager = new TenantManager();
