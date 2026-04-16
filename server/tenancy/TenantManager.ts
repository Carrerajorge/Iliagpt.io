/**
 * TenantManager.ts
 * Multi-tenant lifecycle management: creation, suspension, quotas, membership.
 */

import { EventEmitter } from 'events';
import { pool } from '../db';
import { redis } from '../lib/redis';
import { createLogger } from '../lib/productionLogger';

const logger = createLogger('TenantManager');

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum TenantStatus {
  Active    = 'active',
  Suspended = 'suspended',
  Deleted   = 'deleted',
}

export enum TenantPlan {
  Free       = 'free',
  Starter    = 'starter',
  Pro        = 'pro',
  Enterprise = 'enterprise',
}

export enum MemberRole {
  Owner  = 'owner',
  Admin  = 'admin',
  Member = 'member',
  Viewer = 'viewer',
}

export enum QuotaResource {
  Messages           = 'messages',
  Storage            = 'storage',
  ApiCalls           = 'api_calls',
  ConcurrentSessions = 'concurrent_sessions',
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TenantSettings {
  maxUsers:        number;
  maxChats:        number;
  maxAgents:       number;
  allowedModels:   string[];
  customBranding:  boolean;
  ssoConfig:       SsoConfig | null;
  featureFlags:    Record<string, boolean>;
}

export interface SsoConfig {
  provider:   string;
  entryPoint: string;
  cert:       string;
  issuer:     string;
}

export interface TenantQuotas {
  messagesPerMonth:    number;
  storageGB:           number;
  apiCallsPerDay:      number;
  concurrentSessions:  number;
}

export interface Tenant {
  id:           string;
  name:         string;
  slug:         string;
  plan:         TenantPlan;
  status:       TenantStatus;
  ownerId:      string;
  settings:     TenantSettings;
  customDomain: string | null;
  createdAt:    Date;
  updatedAt:    Date;
  deletedAt:    Date | null;
}

export interface TenantMember {
  tenantId:  string;
  userId:    string;
  role:      MemberRole;
  joinedAt:  Date;
  updatedAt: Date;
}

export interface CreateTenantOptions {
  name:          string;
  slug:          string;
  plan:          TenantPlan;
  ownerId:       string;
  settings?:     Partial<TenantSettings>;
  customDomain?: string;
}

export interface TenantFilter {
  status?:  TenantStatus;
  plan?:    TenantPlan;
  ownerId?: string;
  search?:  string;
  limit?:   number;
  offset?:  number;
}

export interface QuotaCheck {
  allowed:  boolean;
  current:  number;
  limit:    number;
  resetAt?: Date;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TENANT_CACHE_TTL_SECONDS = 300; // 5 minutes
const CACHE_PREFIX              = 'tenant:';

const DEFAULT_SETTINGS: TenantSettings = {
  maxUsers:       5,
  maxChats:       100,
  maxAgents:      3,
  allowedModels:  ['gpt-4o-mini', 'claude-haiku'],
  customBranding: false,
  ssoConfig:      null,
  featureFlags:   {},
};

const DEFAULT_QUOTAS: Record<TenantPlan, TenantQuotas> = {
  [TenantPlan.Free]: {
    messagesPerMonth:   500,
    storageGB:          1,
    apiCallsPerDay:     100,
    concurrentSessions: 2,
  },
  [TenantPlan.Starter]: {
    messagesPerMonth:   5_000,
    storageGB:          10,
    apiCallsPerDay:     1_000,
    concurrentSessions: 10,
  },
  [TenantPlan.Pro]: {
    messagesPerMonth:   50_000,
    storageGB:          100,
    apiCallsPerDay:     10_000,
    concurrentSessions: 50,
  },
  [TenantPlan.Enterprise]: {
    messagesPerMonth:   -1,   // unlimited
    storageGB:          -1,
    apiCallsPerDay:     -1,
    concurrentSessions: -1,
  },
};

// ─── Event types ─────────────────────────────────────────────────────────────

export interface TenantEvents {
  TenantCreated:     (tenant: Tenant)                                            => void;
  TenantUpdated:     (tenant: Tenant)                                            => void;
  TenantSuspended:   (tenantId: string, reason: string)                          => void;
  TenantReactivated: (tenantId: string)                                          => void;
  TenantDeleted:     (tenantId: string)                                          => void;
  MemberAdded:       (member: TenantMember)                                      => void;
  MemberRemoved:     (tenantId: string, userId: string)                          => void;
  MemberRoleUpdated: (tenantId: string, userId: string, role: MemberRole)        => void;
  QuotaExceeded:     (tenantId: string, resource: QuotaResource, current: number) => void;
}

// ─── TenantManager ────────────────────────────────────────────────────────────

export class TenantManager extends EventEmitter {

  private static instance: TenantManager | null = null;
  private initialized = false;

  private constructor() {
    super();
    this.setMaxListeners(50);
  }

  public static getInstance(): TenantManager {
    if (!TenantManager.instance) {
      TenantManager.instance = new TenantManager();
    }
    return TenantManager.instance;
  }

  // ── Schema Bootstrap ───────────────────────────────────────────────────────

  public async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.createTablesIfNotExists();
    this.initialized = true;
    logger.info('TenantManager initialized');
  }

  private async createTablesIfNotExists(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(`
        CREATE TABLE IF NOT EXISTS tenants (
          id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
          name          TEXT        NOT NULL,
          slug          TEXT        NOT NULL UNIQUE,
          plan          TEXT        NOT NULL DEFAULT 'free',
          status        TEXT        NOT NULL DEFAULT 'active',
          owner_id      TEXT        NOT NULL,
          settings      JSONB       NOT NULL DEFAULT '{}'::jsonb,
          custom_domain TEXT,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          deleted_at    TIMESTAMPTZ
        )
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS tenants_slug_idx     ON tenants (slug)     WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS tenants_owner_idx    ON tenants (owner_id) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS tenants_status_idx   ON tenants (status)   WHERE deleted_at IS NULL;
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS tenant_members (
          tenant_id  UUID        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
          user_id    TEXT        NOT NULL,
          role       TEXT        NOT NULL DEFAULT 'member',
          joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, user_id)
        )
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS tenant_members_user_idx ON tenant_members (user_id);
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS tenant_quotas (
          tenant_id             UUID        PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
          messages_per_month    INT         NOT NULL DEFAULT 500,
          storage_gb            INT         NOT NULL DEFAULT 1,
          api_calls_per_day     INT         NOT NULL DEFAULT 100,
          concurrent_sessions   INT         NOT NULL DEFAULT 2,
          updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS tenant_usage (
          tenant_id   UUID        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
          resource    TEXT        NOT NULL,
          period      TEXT        NOT NULL,  -- e.g. '2024-01' for monthly, '2024-01-15' for daily
          amount      BIGINT      NOT NULL DEFAULT 0,
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (tenant_id, resource, period)
        )
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS tenant_usage_resource_idx ON tenant_usage (tenant_id, resource, period);
      `);

      await client.query('COMMIT');
      logger.info('Tenant tables verified/created');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Failed to create tenant tables', err);
      throw err;
    } finally {
      client.release();
    }
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  public async createTenant(options: CreateTenantOptions): Promise<Tenant> {
    const { name, slug, plan, ownerId, settings, customDomain } = options;

    const mergedSettings: TenantSettings = {
      ...DEFAULT_SETTINGS,
      ...(plan === TenantPlan.Enterprise ? { maxUsers: -1, maxChats: -1, maxAgents: -1, customBranding: true } : {}),
      ...settings,
    };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query<{
        id: string; name: string; slug: string; plan: string; status: string;
        owner_id: string; settings: TenantSettings; custom_domain: string | null;
        created_at: Date; updated_at: Date; deleted_at: Date | null;
      }>(
        `INSERT INTO tenants (name, slug, plan, status, owner_id, settings, custom_domain)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [name, slug, plan, TenantStatus.Active, ownerId, JSON.stringify(mergedSettings), customDomain ?? null],
      );

      const tenant = this.rowToTenant(rows[0]);

      const defaultQuotas = DEFAULT_QUOTAS[plan];
      await client.query(
        `INSERT INTO tenant_quotas
           (tenant_id, messages_per_month, storage_gb, api_calls_per_day, concurrent_sessions)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenant.id, defaultQuotas.messagesPerMonth, defaultQuotas.storageGB,
          defaultQuotas.apiCallsPerDay, defaultQuotas.concurrentSessions],
      );

      // Owner is automatically a member with Owner role
      await client.query(
        `INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, $3)`,
        [tenant.id, ownerId, MemberRole.Owner],
      );

      await client.query('COMMIT');

      await this.cacheTenant(tenant);
      this.emit('TenantCreated', tenant);
      logger.info('Tenant created', { tenantId: tenant.id, slug: tenant.slug, plan });

      return tenant;
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err.code === '23505') {
        throw new Error(`Tenant slug '${slug}' is already taken`);
      }
      logger.error('Failed to create tenant', err);
      throw err;
    } finally {
      client.release();
    }
  }

  public async getTenant(tenantId: string): Promise<Tenant | null> {
    const cached = await this.getCachedTenant(tenantId);
    if (cached) return cached;

    const { rows } = await pool.query(
      `SELECT * FROM tenants WHERE id = $1 AND deleted_at IS NULL`,
      [tenantId],
    );
    if (!rows.length) return null;

    const tenant = this.rowToTenant(rows[0]);
    await this.cacheTenant(tenant);
    return tenant;
  }

  public async getTenantBySlug(slug: string): Promise<Tenant | null> {
    const { rows } = await pool.query(
      `SELECT * FROM tenants WHERE slug = $1 AND deleted_at IS NULL`,
      [slug],
    );
    if (!rows.length) return null;

    const tenant = this.rowToTenant(rows[0]);
    await this.cacheTenant(tenant);
    return tenant;
  }

  public async getTenantByDomain(domain: string): Promise<Tenant | null> {
    const { rows } = await pool.query(
      `SELECT * FROM tenants WHERE custom_domain = $1 AND deleted_at IS NULL AND status = 'active'`,
      [domain],
    );
    if (!rows.length) return null;

    const tenant = this.rowToTenant(rows[0]);
    await this.cacheTenant(tenant);
    return tenant;
  }

  public async updateTenant(tenantId: string, updates: Partial<TenantSettings>): Promise<Tenant> {
    const existing = await this.getTenant(tenantId);
    if (!existing) throw new Error(`Tenant ${tenantId} not found`);

    const newSettings: TenantSettings = { ...existing.settings, ...updates };

    const { rows } = await pool.query(
      `UPDATE tenants
       SET settings = $1, updated_at = NOW()
       WHERE id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [JSON.stringify(newSettings), tenantId],
    );

    if (!rows.length) throw new Error(`Tenant ${tenantId} not found`);

    const tenant = this.rowToTenant(rows[0]);
    await this.invalidateTenantCache(tenantId);
    await this.cacheTenant(tenant);
    this.emit('TenantUpdated', tenant);
    logger.info('Tenant updated', { tenantId });

    return tenant;
  }

  public async suspendTenant(tenantId: string, reason: string): Promise<void> {
    const { rowCount } = await pool.query(
      `UPDATE tenants
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND deleted_at IS NULL`,
      [TenantStatus.Suspended, tenantId],
    );
    if (!rowCount) throw new Error(`Tenant ${tenantId} not found`);

    await this.invalidateTenantCache(tenantId);
    this.emit('TenantSuspended', tenantId, reason);
    logger.warn('Tenant suspended', { tenantId, reason });
  }

  public async reactivateTenant(tenantId: string): Promise<void> {
    const { rowCount } = await pool.query(
      `UPDATE tenants
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND deleted_at IS NULL AND status = $3`,
      [TenantStatus.Active, tenantId, TenantStatus.Suspended],
    );
    if (!rowCount) throw new Error(`Tenant ${tenantId} not found or not suspended`);

    await this.invalidateTenantCache(tenantId);
    this.emit('TenantReactivated', tenantId);
    logger.info('Tenant reactivated', { tenantId });
  }

  /**
   * Soft-delete: marks tenant deleted, but retains data for retention policy.
   * Hard purge must be done via a scheduled job after the retention window.
   */
  public async deleteTenant(tenantId: string): Promise<void> {
    const { rowCount } = await pool.query(
      `UPDATE tenants
       SET status = $1, deleted_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND deleted_at IS NULL`,
      [TenantStatus.Deleted, tenantId],
    );
    if (!rowCount) throw new Error(`Tenant ${tenantId} not found`);

    await this.invalidateTenantCache(tenantId);
    this.emit('TenantDeleted', tenantId);
    logger.info('Tenant soft-deleted', { tenantId });
  }

  public async listTenants(filter: TenantFilter = {}): Promise<Tenant[]> {
    const conditions: string[] = ['deleted_at IS NULL'];
    const params: unknown[]    = [];
    let   idx                  = 1;

    if (filter.status) { conditions.push(`status = $${idx++}`);   params.push(filter.status); }
    if (filter.plan)   { conditions.push(`plan = $${idx++}`);      params.push(filter.plan); }
    if (filter.ownerId){ conditions.push(`owner_id = $${idx++}`);  params.push(filter.ownerId); }
    if (filter.search) {
      conditions.push(`(name ILIKE $${idx} OR slug ILIKE $${idx})`);
      params.push(`%${filter.search}%`);
      idx++;
    }

    const where  = conditions.join(' AND ');
    const limit  = filter.limit  ?? 50;
    const offset = filter.offset ?? 0;

    const { rows } = await pool.query(
      `SELECT * FROM tenants WHERE ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset],
    );

    return rows.map(r => this.rowToTenant(r));
  }

  // ── Quotas ─────────────────────────────────────────────────────────────────

  public async getQuotas(tenantId: string): Promise<TenantQuotas> {
    const { rows } = await pool.query(
      `SELECT * FROM tenant_quotas WHERE tenant_id = $1`,
      [tenantId],
    );
    if (!rows.length) throw new Error(`Quotas not found for tenant ${tenantId}`);

    return {
      messagesPerMonth:   rows[0].messages_per_month,
      storageGB:          rows[0].storage_gb,
      apiCallsPerDay:     rows[0].api_calls_per_day,
      concurrentSessions: rows[0].concurrent_sessions,
    };
  }

  public async updateQuotas(tenantId: string, quotas: Partial<TenantQuotas>): Promise<void> {
    const sets: string[]  = ['updated_at = NOW()'];
    const params: unknown[] = [];
    let idx = 1;

    if (quotas.messagesPerMonth    !== undefined) { sets.push(`messages_per_month = $${idx++}`);  params.push(quotas.messagesPerMonth); }
    if (quotas.storageGB           !== undefined) { sets.push(`storage_gb = $${idx++}`);          params.push(quotas.storageGB); }
    if (quotas.apiCallsPerDay      !== undefined) { sets.push(`api_calls_per_day = $${idx++}`);   params.push(quotas.apiCallsPerDay); }
    if (quotas.concurrentSessions  !== undefined) { sets.push(`concurrent_sessions = $${idx++}`); params.push(quotas.concurrentSessions); }

    if (sets.length === 1) return; // nothing to update

    params.push(tenantId);
    await pool.query(
      `UPDATE tenant_quotas SET ${sets.join(', ')} WHERE tenant_id = $${idx}`,
      params,
    );
    logger.info('Tenant quotas updated', { tenantId, quotas });
  }

  public async checkQuota(tenantId: string, resource: QuotaResource): Promise<QuotaCheck> {
    const quotas  = await this.getQuotas(tenantId);
    const limit   = this.getLimit(quotas, resource);

    // Unlimited
    if (limit === -1) return { allowed: true, current: 0, limit: -1 };

    const period  = this.getPeriodKey(resource);
    const current = await this.getUsageCount(tenantId, resource, period);
    const allowed = current < limit;

    if (!allowed) {
      this.emit('QuotaExceeded', tenantId, resource, current);
      logger.warn('Quota exceeded', { tenantId, resource, current, limit });
    }

    return { allowed, current, limit, resetAt: this.getResetDate(resource) };
  }

  public async incrementUsage(tenantId: string, resource: QuotaResource, amount = 1): Promise<void> {
    const period = this.getPeriodKey(resource);

    await pool.query(
      `INSERT INTO tenant_usage (tenant_id, resource, period, amount)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, resource, period)
       DO UPDATE SET amount = tenant_usage.amount + EXCLUDED.amount, updated_at = NOW()`,
      [tenantId, resource, period, amount],
    );
  }

  // ── Membership ─────────────────────────────────────────────────────────────

  public async getTenantMembers(tenantId: string): Promise<TenantMember[]> {
    const { rows } = await pool.query(
      `SELECT * FROM tenant_members WHERE tenant_id = $1 ORDER BY joined_at ASC`,
      [tenantId],
    );
    return rows.map(r => this.rowToMember(r));
  }

  public async getMember(tenantId: string, userId: string): Promise<TenantMember | null> {
    const { rows } = await pool.query(
      `SELECT * FROM tenant_members WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, userId],
    );
    return rows.length ? this.rowToMember(rows[0]) : null;
  }

  public async addMember(tenantId: string, userId: string, role: MemberRole): Promise<TenantMember> {
    // Enforce maxUsers quota
    const tenant = await this.getTenant(tenantId);
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);

    if (tenant.settings.maxUsers > 0) {
      const { rows } = await pool.query(
        `SELECT COUNT(*) AS cnt FROM tenant_members WHERE tenant_id = $1`,
        [tenantId],
      );
      const count = parseInt(rows[0].cnt, 10);
      if (count >= tenant.settings.maxUsers) {
        throw new Error(`Tenant has reached the maximum number of users (${tenant.settings.maxUsers})`);
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO tenant_members (tenant_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = $3, updated_at = NOW()
       RETURNING *`,
      [tenantId, userId, role],
    );

    const member = this.rowToMember(rows[0]);
    this.emit('MemberAdded', member);
    logger.info('Tenant member added', { tenantId, userId, role });
    return member;
  }

  public async removeMember(tenantId: string, userId: string): Promise<void> {
    // Prevent removing the owner
    const tenant = await this.getTenant(tenantId);
    if (tenant?.ownerId === userId) {
      throw new Error('Cannot remove the tenant owner');
    }

    const { rowCount } = await pool.query(
      `DELETE FROM tenant_members WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, userId],
    );
    if (!rowCount) throw new Error(`Member not found in tenant ${tenantId}`);

    this.emit('MemberRemoved', tenantId, userId);
    logger.info('Tenant member removed', { tenantId, userId });
  }

  public async updateMemberRole(tenantId: string, userId: string, role: MemberRole): Promise<void> {
    const tenant = await this.getTenant(tenantId);
    if (tenant?.ownerId === userId && role !== MemberRole.Owner) {
      throw new Error('Cannot change the role of the tenant owner');
    }

    const { rowCount } = await pool.query(
      `UPDATE tenant_members SET role = $1, updated_at = NOW()
       WHERE tenant_id = $2 AND user_id = $3`,
      [role, tenantId, userId],
    );
    if (!rowCount) throw new Error(`Member not found in tenant ${tenantId}`);

    this.emit('MemberRoleUpdated', tenantId, userId, role);
    logger.info('Tenant member role updated', { tenantId, userId, role });
  }

  // ── Cache helpers ──────────────────────────────────────────────────────────

  private async cacheTenant(tenant: Tenant): Promise<void> {
    try {
      await redis.setex(
        `${CACHE_PREFIX}${tenant.id}`,
        TENANT_CACHE_TTL_SECONDS,
        JSON.stringify(tenant),
      );
    } catch (err) {
      logger.warn('Failed to cache tenant', { tenantId: tenant.id, err });
    }
  }

  private async getCachedTenant(tenantId: string): Promise<Tenant | null> {
    try {
      const raw = await redis.get(`${CACHE_PREFIX}${tenantId}`);
      if (!raw) return null;
      const data = JSON.parse(raw) as Tenant;
      // Revive Date objects
      data.createdAt = new Date(data.createdAt);
      data.updatedAt = new Date(data.updatedAt);
      if (data.deletedAt) data.deletedAt = new Date(data.deletedAt);
      return data;
    } catch (err) {
      logger.warn('Failed to read tenant cache', { tenantId, err });
      return null;
    }
  }

  private async invalidateTenantCache(tenantId: string): Promise<void> {
    try {
      await redis.del(`${CACHE_PREFIX}${tenantId}`);
    } catch (err) {
      logger.warn('Failed to invalidate tenant cache', { tenantId, err });
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private rowToTenant(row: Record<string, unknown>): Tenant {
    return {
      id:           row.id           as string,
      name:         row.name         as string,
      slug:         row.slug         as string,
      plan:         row.plan         as TenantPlan,
      status:       row.status       as TenantStatus,
      ownerId:      row.owner_id     as string,
      settings:     row.settings     as TenantSettings,
      customDomain: row.custom_domain as string | null,
      createdAt:    row.created_at   as Date,
      updatedAt:    row.updated_at   as Date,
      deletedAt:    row.deleted_at   as Date | null,
    };
  }

  private rowToMember(row: Record<string, unknown>): TenantMember {
    return {
      tenantId:  row.tenant_id  as string,
      userId:    row.user_id    as string,
      role:      row.role       as MemberRole,
      joinedAt:  row.joined_at  as Date,
      updatedAt: row.updated_at as Date,
    };
  }

  private getLimit(quotas: TenantQuotas, resource: QuotaResource): number {
    switch (resource) {
      case QuotaResource.Messages:           return quotas.messagesPerMonth;
      case QuotaResource.Storage:            return quotas.storageGB;
      case QuotaResource.ApiCalls:           return quotas.apiCallsPerDay;
      case QuotaResource.ConcurrentSessions: return quotas.concurrentSessions;
    }
  }

  private getPeriodKey(resource: QuotaResource): string {
    const now = new Date();
    if (resource === QuotaResource.ApiCalls || resource === QuotaResource.ConcurrentSessions) {
      // Daily period
      return now.toISOString().slice(0, 10); // 'YYYY-MM-DD'
    }
    // Monthly period
    return now.toISOString().slice(0, 7); // 'YYYY-MM'
  }

  private getResetDate(resource: QuotaResource): Date {
    const now = new Date();
    if (resource === QuotaResource.ApiCalls || resource === QuotaResource.ConcurrentSessions) {
      // Reset at midnight UTC
      const next = new Date(now);
      next.setUTCDate(next.getUTCDate() + 1);
      next.setUTCHours(0, 0, 0, 0);
      return next;
    }
    // Reset at start of next month
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return next;
  }

  private async getUsageCount(tenantId: string, resource: QuotaResource, period: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM tenant_usage
       WHERE tenant_id = $1 AND resource = $2 AND period = $3`,
      [tenantId, resource, period],
    );
    return parseInt(rows[0].total, 10);
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const tenantManager = TenantManager.getInstance();
export default tenantManager;
