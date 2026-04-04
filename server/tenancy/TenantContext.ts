/**
 * TenantContext.ts
 * Request-scoped tenant context, Express middleware, and AsyncLocalStorage propagation.
 */

import { AsyncLocalStorage } from 'async_hooks';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { createLogger } from '../lib/productionLogger';
import {
  tenantManager,
  Tenant,
  TenantSettings,
  TenantQuotas,
  MemberRole,
  TenantStatus,
  QuotaResource,
} from './TenantManager';

const logger = createLogger('TenantContext');

// ─── Module augmentation ──────────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      tenantContext?: TenantContext;
    }
  }
}

// ─── TenantContext class ──────────────────────────────────────────────────────

export class TenantContext {
  public readonly tenantId:   string;
  public readonly tenant:     Tenant;
  public readonly userId:     string;
  public readonly memberRole: MemberRole;
  public readonly quotas:     TenantQuotas;
  public readonly settings:   TenantSettings;

  constructor(params: {
    tenant:     Tenant;
    userId:     string;
    memberRole: MemberRole;
    quotas:     TenantQuotas;
  }) {
    this.tenantId   = params.tenant.id;
    this.tenant     = params.tenant;
    this.userId     = params.userId;
    this.memberRole = params.memberRole;
    this.quotas     = params.quotas;
    this.settings   = params.tenant.settings;
  }

  // ── Role helpers ──────────────────────────────────────────────────────────

  public isOwner(): boolean {
    return this.memberRole === MemberRole.Owner;
  }

  public isAdmin(): boolean {
    return this.memberRole === MemberRole.Owner || this.memberRole === MemberRole.Admin;
  }

  public isMember(): boolean {
    return (
      this.memberRole === MemberRole.Owner  ||
      this.memberRole === MemberRole.Admin  ||
      this.memberRole === MemberRole.Member
    );
  }

  /**
   * Coarse-grained resource access check.
   * Extend with a proper ACL matrix as your permission model grows.
   */
  public canAccess(resource: string): boolean {
    const adminOnlyResources = new Set([
      'tenant:settings',
      'tenant:billing',
      'tenant:members:manage',
      'tenant:quotas',
      'tenant:integrations',
      'tenant:audit-log',
    ]);

    const ownerOnlyResources = new Set([
      'tenant:delete',
      'tenant:transfer',
      'tenant:sso',
    ]);

    if (ownerOnlyResources.has(resource)) return this.isOwner();
    if (adminOnlyResources.has(resource)) return this.isAdmin();
    return this.isMember();
  }

  /**
   * Check a boolean feature flag stored in tenant settings.
   */
  public checkFeatureFlag(flag: string): boolean {
    const flags = this.settings.featureFlags ?? {};
    return flags[flag] === true;
  }

  /**
   * Convenience: build a logger child tagged with tenant/user metadata.
   */
  public get logMeta(): Record<string, string> {
    return {
      tenantId:   this.tenantId,
      tenantSlug: this.tenant.slug,
      userId:     this.userId,
      role:       this.memberRole,
    };
  }
}

// ─── AsyncLocalStorage integration ───────────────────────────────────────────

export const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

/**
 * Returns the TenantContext bound to the current async execution chain,
 * or undefined if called outside a tenant-aware request.
 */
export function getCurrentTenant(): TenantContext | undefined {
  return tenantContextStorage.getStore();
}

/**
 * Runs `fn` inside an async context bound to `ctx`.
 * Any code called inside `fn` (including awaited promises) can call
 * `getCurrentTenant()` and will receive `ctx`.
 */
export async function runWithTenant<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run(ctx, fn);
}

// ─── Resolution helpers ───────────────────────────────────────────────────────

/**
 * Parses the subdomain from the Host header.
 * e.g.  "acme.app.example.com"  → "acme"
 *        "app.example.com"       → null  (no subdomain)
 *        "localhost:3000"         → null
 */
function extractSubdomainSlug(req: Request, appDomain: string): string | null {
  const host = (req.headers['host'] ?? '').split(':')[0].toLowerCase();
  const base = appDomain.toLowerCase();

  // Strip port if present in appDomain
  const basePure = base.split(':')[0];

  if (!host.endsWith(`.${basePure}`)) return null;

  const sub = host.slice(0, host.length - basePure.length - 1);
  // Reject double-level subdomains or empty results
  if (!sub || sub.includes('.')) return null;

  // Ignore common non-tenant subdomains
  const RESERVED = new Set(['www', 'api', 'app', 'admin', 'mail', 'static', 'cdn', 'assets']);
  if (RESERVED.has(sub)) return null;

  return sub;
}

/**
 * Extracts the tenantId from a decoded JWT payload if present.
 * Assumes the JWT has already been verified and attached to `req.user` by
 * an upstream auth middleware.
 */
function extractTenantIdFromJwt(req: Request): string | null {
  const user = (req as any).user as Record<string, unknown> | undefined;
  if (!user) return null;
  const id = user['tenantId'] ?? user['tenant_id'];
  return typeof id === 'string' ? id : null;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Resolves the tenant for the current request from (in priority order):
 *  1. X-Tenant-ID header        (UUID)
 *  2. X-Tenant-Slug header      (slug string)
 *  3. Subdomain                 (e.g. acme.app.com → slug = acme)
 *  4. JWT claims                (tenantId field)
 *
 * On success: attaches `req.tenantContext` and calls `next()`.
 * On failure: returns 401 JSON.
 */
export function resolveTenant(
  options: { appDomain?: string } = {},
): RequestHandler {
  const appDomain = options.appDomain ?? (process.env.APP_DOMAIN ?? 'localhost');

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      let tenant: Tenant | null = null;

      // 1. X-Tenant-ID header
      const headerTenantId = req.headers['x-tenant-id'];
      if (typeof headerTenantId === 'string' && headerTenantId.trim()) {
        tenant = await tenantManager.getTenant(headerTenantId.trim());
      }

      // 2. X-Tenant-Slug header
      if (!tenant) {
        const headerSlug = req.headers['x-tenant-slug'];
        if (typeof headerSlug === 'string' && headerSlug.trim()) {
          tenant = await tenantManager.getTenantBySlug(headerSlug.trim());
        }
      }

      // 3. Subdomain
      if (!tenant) {
        const subSlug = extractSubdomainSlug(req, appDomain);
        if (subSlug) {
          tenant = await tenantManager.getTenantBySlug(subSlug);
        }
      }

      // 4. JWT claims
      if (!tenant) {
        const jwtTenantId = extractTenantIdFromJwt(req);
        if (jwtTenantId) {
          tenant = await tenantManager.getTenant(jwtTenantId);
        }
      }

      if (!tenant) {
        res.status(401).json({
          error:   'tenant_not_found',
          message: 'Could not resolve tenant for this request',
        });
        return;
      }

      if (tenant.status === TenantStatus.Suspended) {
        res.status(401).json({
          error:   'tenant_suspended',
          message: 'This tenant account has been suspended',
        });
        return;
      }

      if (tenant.status === TenantStatus.Deleted) {
        res.status(401).json({
          error:   'tenant_not_found',
          message: 'Could not resolve tenant for this request',
        });
        return;
      }

      // Resolve membership for the authenticated user (if any)
      const authUserId = (req as any).user?.id as string | undefined;
      let memberRole: MemberRole = MemberRole.Viewer;

      if (authUserId) {
        const member = await tenantManager.getMember(tenant.id, authUserId);
        if (member) {
          memberRole = member.role;
        }
      }

      // Load quotas
      let quotas: TenantQuotas;
      try {
        quotas = await tenantManager.getQuotas(tenant.id);
      } catch {
        logger.warn('Failed to load quotas, using defaults', { tenantId: tenant.id });
        quotas = {
          messagesPerMonth:   0,
          storageGB:          0,
          apiCallsPerDay:     0,
          concurrentSessions: 0,
        };
      }

      const ctx = new TenantContext({
        tenant,
        userId:     authUserId ?? '',
        memberRole,
        quotas,
      });

      req.tenantContext = ctx;

      // Run the rest of the chain inside the ALS context so background tasks
      // spawned by route handlers can also access the tenant context.
      await runWithTenant(ctx, () =>
        new Promise<void>((resolve, reject) => {
          next();
          // Express calls next() synchronously for the immediate handler chain;
          // wrapping in a promise lets ALS propagate into async route handlers.
          resolve();
        }),
      );
    } catch (err) {
      logger.error('Error resolving tenant', err);
      res.status(500).json({
        error:   'internal_error',
        message: 'An error occurred while resolving the tenant',
      });
    }
  };
}

/**
 * Requires the request to have a resolved TenantContext with a known member.
 * Must be placed after `resolveTenant()`.
 */
export function requireTenantMember(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ctx = req.tenantContext;

    if (!ctx) {
      res.status(401).json({
        error:   'tenant_required',
        message: 'No tenant context found on request',
      });
      return;
    }

    if (!ctx.userId) {
      res.status(401).json({
        error:   'authentication_required',
        message: 'You must be authenticated to access this resource',
      });
      return;
    }

    if (!ctx.isMember()) {
      res.status(403).json({
        error:   'not_a_member',
        message: 'You are not a member of this tenant',
      });
      return;
    }

    next();
  };
}

/**
 * Role-based access guard. Roles are hierarchical:
 *   Owner > Admin > Member > Viewer
 */
export function requireTenantRole(minimumRole: MemberRole): RequestHandler {
  const ROLE_WEIGHT: Record<MemberRole, number> = {
    [MemberRole.Owner]:  4,
    [MemberRole.Admin]:  3,
    [MemberRole.Member]: 2,
    [MemberRole.Viewer]: 1,
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    const ctx = req.tenantContext;

    if (!ctx) {
      res.status(401).json({
        error:   'tenant_required',
        message: 'No tenant context found on request',
      });
      return;
    }

    const actualWeight  = ROLE_WEIGHT[ctx.memberRole]  ?? 0;
    const requiredWeight = ROLE_WEIGHT[minimumRole]    ?? 0;

    if (actualWeight < requiredWeight) {
      res.status(403).json({
        error:        'insufficient_role',
        message:      `This action requires the '${minimumRole}' role or higher`,
        yourRole:     ctx.memberRole,
        requiredRole: minimumRole,
      });
      return;
    }

    next();
  };
}

/**
 * Feature-flag gate. Returns 403 if the tenant does not have the flag enabled.
 */
export function requireTenantFeature(feature: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ctx = req.tenantContext;

    if (!ctx) {
      res.status(401).json({
        error:   'tenant_required',
        message: 'No tenant context found on request',
      });
      return;
    }

    if (!ctx.checkFeatureFlag(feature)) {
      res.status(403).json({
        error:   'feature_not_available',
        message: `The feature '${feature}' is not enabled for your plan`,
        feature,
      });
      return;
    }

    next();
  };
}

/**
 * Quota gate. Checks the given resource quota before allowing the request
 * to proceed. Returns 429 if the limit has been reached.
 */
export function requireQuota(resource: QuotaResource): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ctx = req.tenantContext;

    if (!ctx) {
      res.status(401).json({
        error:   'tenant_required',
        message: 'No tenant context found on request',
      });
      return;
    }

    try {
      const check = await tenantManager.checkQuota(ctx.tenantId, resource);

      if (!check.allowed) {
        const headers: Record<string, string> = {
          'X-RateLimit-Resource': resource,
          'X-RateLimit-Limit':    String(check.limit),
          'X-RateLimit-Current':  String(check.current),
        };
        if (check.resetAt) {
          headers['X-RateLimit-Reset'] = check.resetAt.toISOString();
          headers['Retry-After']       = String(
            Math.ceil((check.resetAt.getTime() - Date.now()) / 1000),
          );
        }

        res.set(headers).status(429).json({
          error:    'quota_exceeded',
          message:  `You have exceeded your ${resource} quota`,
          resource,
          limit:    check.limit,
          current:  check.current,
          resetAt:  check.resetAt?.toISOString(),
        });
        return;
      }

      // Set informational headers for allowed requests
      res.set({
        'X-RateLimit-Resource': resource,
        'X-RateLimit-Limit':    String(check.limit === -1 ? 'unlimited' : check.limit),
        'X-RateLimit-Current':  String(check.current),
        ...(check.resetAt ? { 'X-RateLimit-Reset': check.resetAt.toISOString() } : {}),
      });

      next();
    } catch (err) {
      logger.error('Error checking quota', { tenantId: ctx.tenantId, resource, err });
      // Fail open: allow the request but log the error
      next();
    }
  };
}

// ─── Re-export types that consumers of this module need ───────────────────────

export {
  Tenant,
  TenantSettings,
  TenantQuotas,
  MemberRole,
  TenantStatus,
  QuotaResource,
} from './TenantManager';
