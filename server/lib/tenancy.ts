import { type Request, type Response, type NextFunction } from "express";
import { and, eq, type SQL } from "drizzle-orm";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OrgRole = "owner" | "admin" | "member" | "viewer";

export interface OrgLimits {
  maxUsers: number;
  maxChatsPerDay: number;
  maxTokensPerMonth: number;
  maxStorageMB: number;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: "free" | "pro" | "enterprise";
  limits: OrgLimits;
  createdAt: Date;
}

export interface OrgMember {
  orgId: string;
  userId: string;
  role: OrgRole;
  joinedAt: Date;
}

// ---------------------------------------------------------------------------
// RBAC permissions
// ---------------------------------------------------------------------------

export const ROLE_PERMISSIONS: Record<OrgRole, Set<string>> = {
  owner: new Set(["*"]),
  admin: new Set([
    "manage_members", "manage_settings", "view_analytics",
    "manage_chats", "manage_documents", "use_chat", "view_chats",
  ]),
  member: new Set(["use_chat", "view_chats", "manage_documents"]),
  viewer: new Set(["view_chats"]),
};

export function hasPermission(role: OrgRole, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[role];
  return perms.has("*") || perms.has(permission);
}

// ---------------------------------------------------------------------------
// In-memory stores (swap for DB in production)
// ---------------------------------------------------------------------------

export const orgStore = new Map<string, Organization>();
export const memberStore = new Map<string, OrgMember[]>();

const DEFAULT_LIMITS: Record<Organization["plan"], OrgLimits> = {
  free: { maxUsers: 5, maxChatsPerDay: 50, maxTokensPerMonth: 500_000, maxStorageMB: 100 },
  pro: { maxUsers: 50, maxChatsPerDay: 500, maxTokensPerMonth: 10_000_000, maxStorageMB: 5_000 },
  enterprise: { maxUsers: 500, maxChatsPerDay: 10_000, maxTokensPerMonth: 100_000_000, maxStorageMB: 50_000 },
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function createOrg(
  name: string,
  ownerId: string,
  plan: Organization["plan"] = "free",
): Organization {
  const id = crypto.randomUUID();
  const org: Organization = {
    id,
    name,
    slug: slugify(name),
    plan,
    limits: { ...DEFAULT_LIMITS[plan] },
    createdAt: new Date(),
  };
  orgStore.set(id, org);
  memberStore.set(id, []);
  addMember(id, ownerId, "owner");
  return org;
}

export function getOrg(orgId: string): Organization | null {
  return orgStore.get(orgId) ?? null;
}

export function addMember(orgId: string, userId: string, role: OrgRole): OrgMember {
  const member: OrgMember = { orgId, userId, role, joinedAt: new Date() };
  const members = memberStore.get(orgId) ?? [];
  // Upsert: replace existing entry for this user
  const idx = members.findIndex((m) => m.userId === userId);
  if (idx !== -1) members[idx] = member;
  else members.push(member);
  memberStore.set(orgId, members);
  return member;
}

export function removeMember(orgId: string, userId: string): boolean {
  const members = memberStore.get(orgId);
  if (!members) return false;
  const idx = members.findIndex((m) => m.userId === userId);
  if (idx === -1) return false;
  members.splice(idx, 1);
  return true;
}

export function getMemberRole(orgId: string, userId: string): OrgRole | null {
  const members = memberStore.get(orgId) ?? [];
  return members.find((m) => m.userId === userId)?.role ?? null;
}

export function listMembers(orgId: string): OrgMember[] {
  return memberStore.get(orgId) ?? [];
}

// ---------------------------------------------------------------------------
// Row-level security helper
// ---------------------------------------------------------------------------

export function withOrgFilter<T extends { organizationId?: unknown }>(
  existing: SQL,
  orgId: string,
): SQL {
  // Wraps an existing WHERE clause with an AND organizationId = orgId check.
  // The caller provides the column reference via `existing`; we simply AND it.
  // Usage: .where(withOrgFilter(eq(chats.userId, uid), orgId))
  // In practice the column comes from the table schema; we build a raw eq.
  return and(existing, eq({ name: "organization_id" } as any, orgId))!;
}

// ---------------------------------------------------------------------------
// Express middleware
// ---------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      orgId?: string;
      orgRole?: OrgRole;
    }
  }
}

export function tenancyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const user = req.user as Record<string, any> | undefined;
  const userId = user?.id as string | undefined;

  if (!userId) {
    // Unauthenticated requests pass through; downstream auth middleware will block if needed.
    return next();
  }

  // Resolve org: explicit header > user profile > personal org fallback
  const orgId =
    (req.headers["x-org-id"] as string | undefined) ??
    user?.organizationId ??
    user?.orgId ??
    `personal:${userId}`;

  // Validate membership (personal orgs always pass)
  if (orgId.startsWith("personal:")) {
    req.orgId = orgId;
    req.orgRole = "owner";
    return next();
  }

  const role = getMemberRole(orgId, userId);
  if (!role) {
    res.status(403).json({ error: "Not a member of the specified organization" });
    return;
  }

  req.orgId = orgId;
  req.orgRole = role;
  next();
}
