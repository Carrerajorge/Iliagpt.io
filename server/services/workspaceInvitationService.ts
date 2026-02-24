import { db } from "../db";
import { users, workspaceInvitations } from "@shared/schema";
import { and, desc, eq, ne } from "drizzle-orm";
import { isRoleKeyValidForOrg, isWorkspaceAdminRole as isWorkspaceAdminRoleKey, normalizeRoleKey } from "./workspaceRoleService";

function normalizeEmail(value: unknown): string {
  return String(value || "").toLowerCase().trim();
}

function normalizeRoleInput(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return value;
  return String(value);
}

// Back-compat mapping: older invitation roles used legacy labels.
export function normalizeWorkspaceRole(role: unknown): string {
  const r = normalizeRoleKey(normalizeRoleInput(role));
  if (!r) return "team_member";
  if (r === "workspace_member") return "team_member";
  if (r === "workspace_admin") return "team_admin";
  if (r === "workspace_owner" || r === "owner") return "team_admin";
  return r;
}

export function isWorkspaceAdminRole(role: unknown): boolean {
  return isWorkspaceAdminRoleKey(normalizeRoleKey(normalizeRoleInput(role)));
}

export function isBillingManagerRole(role: unknown): boolean {
  const r = normalizeRoleKey(normalizeRoleInput(role));
  return r === "billing_manager" || isWorkspaceAdminRoleKey(r);
}

/**
 * When a user logs in, if there is a pending invitation for their email:
 * - assign them to the invited org (if safe)
 * - assign the invited role (if safe)
 * - mark invitation accepted for that org, revoke others
 */
export async function autoAcceptWorkspaceInvitationForUser(userId: string): Promise<{
  applied: boolean;
  orgId?: string;
  role?: string;
}> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return { applied: false };

  const email = normalizeEmail(user.email);
  if (!email) return { applied: false };

  const invites = await db
    .select()
    .from(workspaceInvitations)
    .where(and(eq(workspaceInvitations.email, email), eq(workspaceInvitations.status, "pending")))
    .orderBy(desc(workspaceInvitations.createdAt));

  if (invites.length === 0) return { applied: false };

  const newest = invites[0] as any;
  const targetOrgId = String(newest.orgId || "").trim();
  if (!targetOrgId) return { applied: false };
  const normalizedRole = normalizeWorkspaceRole(newest.role || "team_member");
  const targetRole = (await isRoleKeyValidForOrg(targetOrgId, normalizedRole)) ? normalizedRole : "team_member";

  const isPendingUser = String((user as any).status || "") === "pending";
  const safeToAssignOrg = isPendingUser || !((user as any).orgId) || (user as any).orgId === "default";
  const safeToAssignRole = isPendingUser || normalizeRoleKey((user as any).role) === "user";
  const joinedTargetOrg = safeToAssignOrg || String((user as any).orgId || "") === targetOrgId;

  const patch: any = { updatedAt: new Date() };
  if (safeToAssignOrg || (user as any).orgId === targetOrgId) {
    if (safeToAssignOrg) patch.orgId = targetOrgId;
  } else {
    // User already belongs to a different org; do not hijack.
    return { applied: false };
  }

  if (safeToAssignRole) patch.role = targetRole;

  if (Object.keys(patch).length > 1) {
    await db.update(users).set(patch).where(eq(users.id, userId));
  }

  // Grant invited accounts the Business ($25) plan unless they already have a higher plan.
  try {
    const currentPlan = String((user as any).plan || "free").toLowerCase().trim();
    if (joinedTargetOrg && ["free", "go", "plus"].includes(currentPlan)) {
      await db.update(users).set({ plan: "business", updatedAt: new Date() }).where(eq(users.id, userId));
    }
  } catch (planErr) {
    console.warn("[WorkspaceInvite] Failed to apply Business plan to invited user:", planErr);
  }

  const now = new Date();
  await db
    .update(workspaceInvitations)
    .set({ status: "accepted", acceptedAt: now })
    .where(
      and(
        eq(workspaceInvitations.email, email),
        eq(workspaceInvitations.status, "pending"),
        eq(workspaceInvitations.orgId, targetOrgId)
      )
    );

  await db
    .update(workspaceInvitations)
    .set({ status: "revoked", revokedAt: now })
    .where(
      and(
        eq(workspaceInvitations.email, email),
        eq(workspaceInvitations.status, "pending"),
        ne(workspaceInvitations.orgId, targetOrgId)
      )
    );

  return { applied: true, orgId: targetOrgId, role: safeToAssignRole ? targetRole : normalizeRoleKey((user as any).role) };
}
