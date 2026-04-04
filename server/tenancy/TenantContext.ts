import { AsyncLocalStorage } from "async_hooks";
import type { Request, Response, NextFunction } from "express";
import { Logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TenantLimits {
  maxUsers: number;
  maxMessages: number;      // per day
  maxTokens: number;        // per day
  maxDocuments: number;     // total stored
  maxStorageBytes: number;
  maxApiCallsPerMin: number;
}

export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  plan: "free" | "pro" | "enterprise";
  features: string[];
  limits: TenantLimits;
  metadata?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Default limits per plan
// ---------------------------------------------------------------------------

const DEFAULT_LIMITS: Record<string, TenantLimits> = {
  free: {
    maxUsers: 5,
    maxMessages: 100,
    maxTokens: 50_000,
    maxDocuments: 10,
    maxStorageBytes: 100 * 1024 * 1024,   // 100 MB
    maxApiCallsPerMin: 10,
  },
  pro: {
    maxUsers: 50,
    maxMessages: 5_000,
    maxTokens: 2_000_000,
    maxDocuments: 500,
    maxStorageBytes: 5 * 1024 * 1024 * 1024,  // 5 GB
    maxApiCallsPerMin: 100,
  },
  enterprise: {
    maxUsers: 10_000,
    maxMessages: 1_000_000,
    maxTokens: 100_000_000,
    maxDocuments: 100_000,
    maxStorageBytes: 1024 * 1024 * 1024 * 1024, // 1 TB
    maxApiCallsPerMin: 5_000,
  },
};

// ---------------------------------------------------------------------------
// AsyncLocalStorage for non-request contexts (workers, queues, etc.)
// ---------------------------------------------------------------------------

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(
  tenant: TenantContext,
  fn: () => Promise<T>
): Promise<T> {
  return tenantStorage.run(tenant, fn);
}

// ---------------------------------------------------------------------------
// Helpers — tenant resolution
// ---------------------------------------------------------------------------

function extractTenantIdFromHeader(req: Request): string | null {
  const header = req.headers["x-tenant-id"];
  if (typeof header === "string" && header.trim()) return header.trim();
  return null;
}

function extractTenantSlugFromSubdomain(req: Request): string | null {
  const host = req.hostname ?? req.headers.host ?? "";
  // Accept pattern: {slug}.example.com or {slug}.localhost
  const parts = host.split(".");
  if (parts.length >= 2) {
    const slug = parts[0];
    if (slug && slug !== "www" && slug !== "api") return slug;
  }
  return null;
}

function extractTenantFromJwt(req: Request): string | null {
  // If auth middleware already decoded the JWT and attached the payload, read from it
  const user = (req as any).user ?? (req as any).jwtPayload;
  if (user?.tenantId && typeof user.tenantId === "string") return user.tenantId;
  if (user?.tenant_id && typeof user.tenant_id === "string") return user.tenant_id;
  return null;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Resolves the current tenant from the request and attaches it as
 * `req.tenantContext`.  Resolution order:
 *   1. x-tenant-id header
 *   2. Subdomain
 *   3. JWT claim
 *
 * If no tenant can be resolved the middleware continues without setting
 * `req.tenantContext`.  Use `requireTenant` to enforce its presence.
 */
export function tenantContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    let tenantId =
      extractTenantIdFromHeader(req) ??
      extractTenantFromJwt(req);

    let tenantSlug = extractTenantSlugFromSubdomain(req);

    if (!tenantId && !tenantSlug) {
      return next();
    }

    // Build a minimal context — full hydration happens in TenantManager
    // when the route needs it.  We set what we know here.
    const ctx: TenantContext = {
      tenantId: tenantId ?? tenantSlug ?? "unknown",
      tenantSlug: tenantSlug ?? tenantId ?? "unknown",
      plan: "free",
      features: [],
      limits: DEFAULT_LIMITS.free,
    };

    (req as any).tenantContext = ctx;

    // Run the rest of the request inside the AsyncLocalStorage context so
    // downstream code (services, workers spawned inline) can call
    // `tenantStorage.getStore()` without threading the request object.
    tenantStorage.run(ctx, () => next());
  } catch (err) {
    Logger.error("[TenantContext] Error in middleware", err);
    next();
  }
}

/**
 * Returns the tenant context attached to the request.
 * Throws if not present — use after `tenantContextMiddleware`.
 */
export function getTenantContext(req: Request): TenantContext {
  const ctx = (req as any).tenantContext as TenantContext | undefined;
  if (!ctx) {
    throw new Error("Tenant context not available on request");
  }
  return ctx;
}

/**
 * Middleware that sends 401 if no tenant context has been resolved.
 */
export function requireTenant(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const ctx = (req as any).tenantContext as TenantContext | undefined;
  if (!ctx) {
    Logger.warn("[TenantContext] requireTenant: no tenant resolved", {
      path: req.path,
      ip: req.ip,
    });
    res.status(401).json({ error: "Tenant identification required" });
    return;
  }
  next();
}

/**
 * Helper to get current tenant from the AsyncLocalStorage store.
 * Returns null when called outside a tenant-scoped context.
 */
export function getCurrentTenant(): TenantContext | null {
  return tenantStorage.getStore() ?? null;
}

/**
 * Build default limits for a given plan (exported for use in TenantManager).
 */
export function getDefaultLimits(
  plan: "free" | "pro" | "enterprise"
): TenantLimits {
  return { ...DEFAULT_LIMITS[plan] };
}
