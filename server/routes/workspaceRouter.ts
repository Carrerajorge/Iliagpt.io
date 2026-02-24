import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import {
  auditLogs,
  libraryFiles,
  users,
  workspaceGroupMembers,
  workspaceGroups,
  workspaceInvitations,
  workspaceRoles,
  workspaces,
} from "@shared/schema";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { validateBody } from "../middleware/validateRequest";
import { getUserId } from "../types/express";
import { isValidWorkspaceName, normalizeWorkspaceName } from "../services/workspaceValidation";
import { createMagicLink, getMagicLinkUrl } from "../services/magicLink";
import { sendWorkspaceInviteEmail } from "../services/genericEmailService";
import {
  getPermissionCatalog,
  isCustomRoleKey,
  isReservedRoleName,
  isRoleKeyValidForOrg,
  isSystemAdminRole,
  isWorkspaceBuiltinRole,
  isWorkspaceAdminRole,
  listRolesForOrg,
  normalizeRoleKey,
  resolveRolePermissionsForOrg,
  sanitizePermissions,
  toCustomRoleKey,
} from "../services/workspaceRoleService";

const DEFAULT_ORG_ID = "default";
function normalizeEmail(value: unknown): string {
  return String(value || "").toLowerCase().trim();
}

function getAdminEmail(): string {
  return normalizeEmail(process.env.ADMIN_EMAIL || "");
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

async function ensureWorkspace(orgId: string) {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.orgId, orgId)).limit(1);
  if (ws) return ws;

  const [created] = await db
    .insert(workspaces)
    .values({ orgId, name: "Espacio de trabajo" })
    .returning();

  return created;
}

async function getActorContext(req: any) {
  const userId = getUserId(req);
  if (!userId) return null;
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return null;
  const orgId = (u as any)?.orgId || DEFAULT_ORG_ID;
  const roleKey = normalizeRoleKey((u as any)?.role || "guest");
  const email = normalizeEmail((u as any)?.email || "");
  return { userId, orgId, roleKey, email, user: u };
}

function isAdminEmail(email: string): boolean {
  const adminEmail = getAdminEmail();
  return !!adminEmail && !!email && adminEmail === email;
}

async function hasOrgPermission(orgId: string, roleKey: string, permission: string): Promise<boolean> {
  const perms = await resolveRolePermissionsForOrg(orgId, roleKey);
  return perms.includes(permission as any);
}

async function canManageWorkspace(actor: { orgId: string; roleKey: string; email: string }): Promise<boolean> {
  if (isWorkspaceAdminRole(actor.roleKey) || isAdminEmail(actor.email)) return true;
  return hasOrgPermission(actor.orgId, actor.roleKey, "admin:settings");
}

async function canManageMembers(actor: { orgId: string; roleKey: string; email: string }): Promise<boolean> {
  if (isWorkspaceAdminRole(actor.roleKey) || isAdminEmail(actor.email)) return true;
  return hasOrgPermission(actor.orgId, actor.roleKey, "admin:users");
}

async function canManageRoles(actor: { orgId: string; roleKey: string; email: string }): Promise<boolean> {
  if (isWorkspaceAdminRole(actor.roleKey) || isAdminEmail(actor.email)) return true;
  return hasOrgPermission(actor.orgId, actor.roleKey, "admin:users");
}

async function canManageBilling(actor: { orgId: string; roleKey: string; email: string }): Promise<boolean> {
  if (isWorkspaceAdminRole(actor.roleKey) || isAdminEmail(actor.email)) return true;
  return hasOrgPermission(actor.orgId, actor.roleKey, "admin:billing");
}

async function canViewAnalytics(actor: { orgId: string; roleKey: string; email: string }): Promise<boolean> {
  if (isWorkspaceAdminRole(actor.roleKey) || isAdminEmail(actor.email)) return true;
  if (await hasOrgPermission(actor.orgId, actor.roleKey, "admin:analytics")) return true;
  return false;
}

async function validateAssignableRole(actor: { orgId: string; roleKey: string; email: string }, roleKeyRaw: string) {
  const roleKey = normalizeRoleKey(roleKeyRaw);
  if (!roleKey) return { ok: false, roleKey: "", error: "INVALID_ROLE" };
  const valid = await isRoleKeyValidForOrg(actor.orgId, roleKey);
  if (!valid) return { ok: false, roleKey, error: "ROLE_NOT_FOUND" };
  if (!isCustomRoleKey(roleKey) && !isWorkspaceBuiltinRole(roleKey) && !isSystemAdminRole(roleKey)) {
    return { ok: false, roleKey, error: "FORBIDDEN_ROLE" };
  }
  if (isSystemAdminRole(roleKey) && !isSystemAdminRole(actor.roleKey) && !isAdminEmail(actor.email)) {
    return { ok: false, roleKey, error: "FORBIDDEN_ROLE" };
  }
  return { ok: true, roleKey, error: null };
}

export function createWorkspaceRouter() {
  const router = Router();

  router.get("/api/workspace/me", async (req, res) => {
    try {
      const actor = await getActorContext(req);
      if (!actor) return res.status(401).json({ error: "Debes iniciar sesión" });

      const orgId = actor.orgId;

      const ws = await ensureWorkspace(orgId);

      const [{ count: memberCountRaw } = { count: 0 }] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(users)
        .where(and(eq(users.orgId, orgId), isNull(users.deletedAt)));
      const memberCount = typeof memberCountRaw === "number" ? memberCountRaw : Number(memberCountRaw || 0);

      const [canManageWorkspaceFlag, canManageMembersFlag, canManageRolesFlag, canManageBillingFlag] = await Promise.all([
        canManageWorkspace(actor),
        canManageMembers(actor),
        canManageRoles(actor),
        canManageBilling(actor),
      ]);

      res.json({
        orgId,
        workspaceId: ws.id,
        name: ws.name,
        logoFileUuid: ws.logoFileUuid || null,
        memberCount,
        canManageWorkspace: canManageWorkspaceFlag,
        canManageMembers: canManageMembersFlag,
        canManageRoles: canManageRolesFlag,
        canManageBilling: canManageBillingFlag,
      });
    } catch (e: any) {
      console.error("[Workspace] GET /me error:", e);
      res.status(500).json({ error: "Failed to load workspace" });
    }
  });

  router.put(
    "/api/workspace/me",
    validateBody(
      z
        .object({
          name: z.string().optional(),
          logoFileUuid: z.string().nullable().optional(),
        })
        .refine((v) => v.name !== undefined || v.logoFileUuid !== undefined, {
          message: "At least one field must be provided",
        })
    ),
    async (req, res) => {
      try {
        const actor = await getActorContext(req);
        if (!actor) return res.status(401).json({ error: "Debes iniciar sesión" });

        const orgId = actor.orgId;
        const canManage = await canManageWorkspace(actor);
        if (!canManage) {
          return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
        }

        const ws = await ensureWorkspace(orgId);

        const patch: any = { updatedAt: new Date() };

        if (req.body.name !== undefined) {
          const normalized = normalizeWorkspaceName(req.body.name);
          if (!isValidWorkspaceName(normalized)) {
            return res.status(400).json({ error: "Nombre inválido", code: "INVALID_WORKSPACE_NAME" });
          }
          patch.name = normalized;
        }

        if (req.body.logoFileUuid !== undefined) {
          const uuid = req.body.logoFileUuid;
          if (uuid) {
            // ensure the file belongs to the admin user and is not deleted
          const [file] = await db
              .select()
              .from(libraryFiles)
              .where(and(eq(libraryFiles.uuid, uuid), eq(libraryFiles.userId, actor.userId), isNull(libraryFiles.deletedAt)))
              .limit(1);
            if (!file) {
              return res.status(400).json({ error: "Logo file not found", code: "LOGO_FILE_NOT_FOUND" });
            }
            patch.logoFileUuid = uuid;
          } else {
            patch.logoFileUuid = null;
          }
        }

        const [updated] = await db
          .update(workspaces)
          .set(patch)
          .where(eq(workspaces.id, ws.id))
          .returning();

        res.json({
          orgId,
          workspaceId: updated.id,
          name: updated.name,
          logoFileUuid: updated.logoFileUuid || null,
        });
      } catch (e: any) {
        console.error("[Workspace] PUT /me error:", e);
        res.status(500).json({ error: "Failed to update workspace" });
      }
    }
  );

  router.get("/api/workspace/members", async (req, res) => {
    try {
      const actor = await getActorContext(req);
      if (!actor) return res.status(401).json({ error: "Debes iniciar sesión" });

      const members = await db
        .select({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          firstName: users.firstName,
          lastName: users.lastName,
          profileImageUrl: users.profileImageUrl,
          role: users.role,
          plan: users.plan,
          subscriptionStatus: users.subscriptionStatus,
          subscriptionPlan: users.subscriptionPlan,
          status: users.status,
          createdAt: users.createdAt,
          lastLoginAt: users.lastLoginAt,
        })
        .from(users)
        .where(and(eq(users.orgId, actor.orgId), isNull(users.deletedAt)))
        .orderBy(asc(users.createdAt));

      // Prefer the accepted invitation timestamp as "added at" when available.
      const acceptedInvites = await db
        .select({
          email: workspaceInvitations.email,
          acceptedAt: workspaceInvitations.acceptedAt,
        })
        .from(workspaceInvitations)
        .where(and(eq(workspaceInvitations.orgId, actor.orgId), eq(workspaceInvitations.status, "accepted")));

      const acceptedAtByEmail = new Map<string, Date>();
      for (const row of acceptedInvites) {
        const email = String(row.email || "").toLowerCase().trim();
        if (!email) continue;
        if (row.acceptedAt instanceof Date && !Number.isNaN(row.acceptedAt.getTime())) {
          acceptedAtByEmail.set(email, row.acceptedAt);
        }
      }

      res.json({
        members: members.map((m) => {
          const emailNorm = String(m.email || "").toLowerCase().trim();
          const effectivePlan =
            String(m.subscriptionStatus || "").toLowerCase().trim() === "active" && m.subscriptionPlan
              ? String(m.subscriptionPlan)
              : m.plan
                ? String(m.plan)
                : null;

          const acceptedAt = emailNorm ? acceptedAtByEmail.get(emailNorm) : null;
          const createdAt = m.createdAt ? new Date(m.createdAt) : null;
          const addedAt = acceptedAt || createdAt;

          return {
            id: String(m.id),
            email: m.email ? String(m.email) : null,
            fullName: m.fullName ? String(m.fullName) : null,
            firstName: m.firstName ? String(m.firstName) : null,
            lastName: m.lastName ? String(m.lastName) : null,
            profileImageUrl: m.profileImageUrl ? String(m.profileImageUrl) : null,
            role: m.role ? normalizeRoleKey(String(m.role)) : null,
            plan: effectivePlan,
            addedAt: addedAt ? addedAt.toISOString() : null,
            status: m.status ? String(m.status) : null,
            createdAt: createdAt ? createdAt.toISOString() : null,
            lastLoginAt: m.lastLoginAt ? new Date(m.lastLoginAt).toISOString() : null,
          };
        }),
      });
    } catch (e: any) {
      console.error("[Workspace] GET /members error:", e);
      res.status(500).json({ error: "Failed to load members" });
    }
  });

  router.patch(
    "/api/workspace/members/:id",
    validateBody(
      z.object({
        role: z.string().min(1),
      })
    ),
    async (req, res) => {
      try {
        const actor = await getActorContext(req);
        if (!actor) return res.status(401).json({ error: "Debes iniciar sesión" });
        if (!(await canManageMembers(actor))) {
          return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
        }

        const targetUserId = String(req.params.id || "");
        if (targetUserId === actor.userId) {
          return res.status(400).json({ error: "No puedes cambiar tu propio rol", code: "CANNOT_EDIT_SELF" });
        }
        const [target] = await db
          .select()
          .from(users)
          .where(and(eq(users.id, targetUserId), eq(users.orgId, actor.orgId), isNull(users.deletedAt)))
          .limit(1);

        if (!target) {
          return res.status(404).json({ error: "Usuario no encontrado" });
        }

        if (isSystemAdminRole((target as any)?.role) && !isSystemAdminRole(actor.roleKey) && !isAdminEmail(actor.email)) {
          return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
        }

        const validation = await validateAssignableRole(actor, req.body.role);
        if (!validation.ok) {
          return res.status(400).json({ error: "Rol inválido", code: validation.error });
        }

        const [updated] = await db
          .update(users)
          .set({ role: validation.roleKey, updatedAt: new Date() })
          .where(eq(users.id, targetUserId))
          .returning();

        res.json({
          id: String(updated.id),
          email: updated.email,
          role: updated.role,
        });
      } catch (e: any) {
        console.error("[Workspace] PATCH /members/:id error:", e);
        res.status(500).json({ error: "Failed to update member" });
      }
    }
  );

  router.get("/api/workspace/invitations", async (req, res) => {
    try {
      const actor = await getActorContext(req);
      if (!actor) return res.status(401).json({ error: "Debes iniciar sesión" });
      if (!(await canManageMembers(actor))) {
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      const status = typeof req.query.status === "string" ? req.query.status : "pending";

      const invites = await db
        .select({
          id: workspaceInvitations.id,
          email: workspaceInvitations.email,
          role: workspaceInvitations.role,
          status: workspaceInvitations.status,
          createdAt: workspaceInvitations.createdAt,
          lastSentAt: workspaceInvitations.lastSentAt,
          invitedByUserId: workspaceInvitations.invitedByUserId,
          inviterEmail: users.email,
          inviterName: users.fullName,
        })
        .from(workspaceInvitations)
        .leftJoin(users, eq(users.id, workspaceInvitations.invitedByUserId))
        .where(
          and(
            eq(workspaceInvitations.orgId, actor.orgId),
            status ? eq(workspaceInvitations.status, status) : sql`TRUE`
          )
        )
        .orderBy(desc(workspaceInvitations.createdAt));

      res.json({
        invitations: invites.map((inv) => ({
          id: String(inv.id),
          email: String(inv.email),
          role: inv.role ? normalizeRoleKey(String(inv.role)) : null,
          status: inv.status ? String(inv.status) : null,
          createdAt: inv.createdAt ? new Date(inv.createdAt).toISOString() : null,
          lastSentAt: inv.lastSentAt ? new Date(inv.lastSentAt).toISOString() : null,
          invitedByUserId: inv.invitedByUserId ? String(inv.invitedByUserId) : null,
          invitedByEmail: inv.inviterEmail ? String(inv.inviterEmail) : null,
          invitedByName: inv.inviterName ? String(inv.inviterName) : null,
        })),
      });
    } catch (e: any) {
      console.error("[Workspace] GET /invitations error:", e);
      res.status(500).json({ error: "Failed to load invitations" });
    }
  });

  router.post(
    "/api/workspace/invitations",
    validateBody(
      z.object({
        emails: z.array(z.string().email()).min(1),
        role: z.string().optional(),
        message: z.string().optional(),
      })
    ),
    async (req, res) => {
      try {
        const actor = await getActorContext(req);
        if (!actor) return res.status(401).json({ error: "Debes iniciar sesión" });
        if (!(await canManageMembers(actor))) {
          return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
        }

        const ws = await ensureWorkspace(actor.orgId);
        const roleRaw = req.body.role ? String(req.body.role) : "team_member";
        const roleValidation = await validateAssignableRole(actor, roleRaw);
        if (!roleValidation.ok) {
          return res.status(400).json({ error: "Rol inválido", code: roleValidation.error });
        }
        const roleKey = roleValidation.roleKey;

        const roles = await listRolesForOrg(actor.orgId);
        const roleName = roles.find((r) => r.roleKey === roleKey)?.name || roleKey;

        const results: Array<Record<string, any>> = [];
        const now = new Date();
        const normalizedEmails = Array.from(
          new Set((req.body.emails || []).map((emailRaw) => normalizeEmail(emailRaw)).filter(Boolean))
        );

        for (const email of normalizedEmails) {

          const [existingUser] = await db
            .select({ id: users.id, orgId: users.orgId, email: users.email, deletedAt: users.deletedAt })
            .from(users)
            .where(sql`LOWER(${users.email}) = ${email}`)
            .limit(1);

          if (existingUser && !existingUser.deletedAt && String(existingUser.orgId || "") === actor.orgId) {
            results.push({ email, status: "already_member" });
            continue;
          }

          if (existingUser && !existingUser.deletedAt) {
            const existingOrg = String(existingUser.orgId || "");
            if (existingOrg && existingOrg !== DEFAULT_ORG_ID && existingOrg !== actor.orgId) {
              results.push({ email, status: "different_org" });
              continue;
            }
          }

          await db
            .insert(workspaceInvitations)
            .values({
              orgId: actor.orgId,
              email,
              invitedByUserId: actor.userId,
              role: roleKey,
              status: "pending",
              createdAt: now,
              lastSentAt: now,
              acceptedAt: null,
              revokedAt: null,
            })
            .onConflictDoUpdate({
              target: [workspaceInvitations.orgId, workspaceInvitations.email],
              set: {
                role: roleKey,
                status: "pending",
                lastSentAt: now,
                acceptedAt: null,
                revokedAt: null,
                invitedByUserId: actor.userId,
              },
            });

          const magic = await createMagicLink(email);
          if (!magic.success || !magic.token) {
            results.push({ email, status: "error", error: magic.error || "magic_link_failed" });
            continue;
          }

          const magicLinkUrl = getMagicLinkUrl(magic.token);
          const inviterName =
            actor.user?.fullName ||
            actor.user?.firstName ||
            actor.user?.email ||
            "Administrador";

          const emailResult = await sendWorkspaceInviteEmail(email, {
            workspaceName: ws.name,
            inviterName: String(inviterName),
            roleName,
            magicLinkUrl,
            message: req.body.message ? String(req.body.message) : undefined,
          });

          results.push({
            email,
            status: emailResult.success ? "invited" : "email_failed",
            magicLinkUrl: process.env.NODE_ENV === "production" ? undefined : magicLinkUrl,
          });
        }

        res.json({ results });
      } catch (e: any) {
        console.error("[Workspace] POST /invitations error:", e);
        res.status(500).json({ error: "Failed to send invitations" });
      }
    }
  );

  router.post("/api/workspace/invitations/:id/resend", async (req, res) => {
    try {
      const actor = await getActorContext(req);
      if (!actor) return res.status(401).json({ error: "Debes iniciar sesión" });
      if (!(await canManageMembers(actor))) {
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      const inviteId = String(req.params.id || "");
      const [invite] = await db
        .select()
        .from(workspaceInvitations)
        .where(and(eq(workspaceInvitations.id, inviteId), eq(workspaceInvitations.orgId, actor.orgId)))
        .limit(1);

      if (!invite) return res.status(404).json({ error: "Invitación no encontrada" });
      if (String(invite.status) !== "pending") {
        return res.status(400).json({ error: "La invitación no está pendiente" });
      }

      const ws = await ensureWorkspace(actor.orgId);
      const magic = await createMagicLink(invite.email);
      if (!magic.success || !magic.token) {
        return res.status(500).json({ error: magic.error || "magic_link_failed" });
      }

      const roles = await listRolesForOrg(actor.orgId);
      const inviteRoleKey = normalizeRoleKey(String(invite.role || "")) || "team_member";
      const roleName = roles.find((r) => r.roleKey === inviteRoleKey)?.name || inviteRoleKey;

      const magicLinkUrl = getMagicLinkUrl(magic.token);
      const inviterName =
        actor.user?.fullName ||
        actor.user?.firstName ||
        actor.user?.email ||
        "Administrador";

      const emailResult = await sendWorkspaceInviteEmail(invite.email, {
        workspaceName: ws.name,
        inviterName: String(inviterName),
        roleName,
        magicLinkUrl,
      });

      await db
        .update(workspaceInvitations)
        .set({ lastSentAt: new Date() })
        .where(eq(workspaceInvitations.id, inviteId));

      res.json({
        success: emailResult.success,
        magicLinkUrl: process.env.NODE_ENV === "production" ? undefined : magicLinkUrl,
      });
    } catch (e: any) {
      console.error("[Workspace] POST /invitations/:id/resend error:", e);
      res.status(500).json({ error: "Failed to resend invitation" });
    }
  });

  router.post("/api/workspace/invitations/:id/revoke", async (req, res) => {
    try {
      const actor = await getActorContext(req);
      if (!actor) return res.status(401).json({ error: "Debes iniciar sesión" });
      if (!(await canManageMembers(actor))) {
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      const inviteId = String(req.params.id || "");
      const [invite] = await db
        .select()
        .from(workspaceInvitations)
        .where(and(eq(workspaceInvitations.id, inviteId), eq(workspaceInvitations.orgId, actor.orgId)))
        .limit(1);

      if (!invite) return res.status(404).json({ error: "Invitación no encontrada" });

      await db
        .update(workspaceInvitations)
        .set({ status: "revoked", revokedAt: new Date() })
        .where(eq(workspaceInvitations.id, inviteId));

      res.json({ success: true });
    } catch (e: any) {
      console.error("[Workspace] POST /invitations/:id/revoke error:", e);
      res.status(500).json({ error: "Failed to revoke invitation" });
    }
  });

  router.get("/api/workspace/roles", async (req, res) => {
    try {
      const actor = await getActorContext(req);
      if (!actor) return res.status(401).json({ error: "Debes iniciar sesión" });

      const roles = await listRolesForOrg(actor.orgId);
      res.json({
        roles,
        permissions: getPermissionCatalog(),
      });
    } catch (e: any) {
      console.error("[Workspace] GET /roles error:", e);
      res.status(500).json({ error: "Failed to load roles" });
    }
  });

  router.post(
    "/api/workspace/roles",
    validateBody(
      z.object({
        name: z.string().min(2).max(50),
        description: z.string().max(200).optional().nullable(),
        permissions: z.array(z.string()).optional(),
      })
    ),
    async (req, res) => {
      try {
        const actor = await getActorContext(req);
        if (!actor) return res.status(401).json({ error: "Debes iniciar sesión" });
        if (!(await canManageRoles(actor))) {
          return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
        }

        const name = String(req.body.name || "").trim();
        const nameKey = normalizeRoleKey(name);
        if (!name) {
          return res.status(400).json({ error: "Nombre inválido" });
        }
        if (isReservedRoleName(name)) {
          return res.status(400).json({ error: "Nombre de rol reservado" });
        }

        const existing = await db
          .select({ id: workspaceRoles.id })
          .from(workspaceRoles)
          .where(and(eq(workspaceRoles.orgId, actor.orgId), sql`LOWER(${workspaceRoles.name}) = ${nameKey}`))
          .limit(1);
        if (existing.length > 0) {
          return res.status(409).json({ error: "Ya existe un rol con ese nombre" });
        }

        const permissions = sanitizePermissions(req.body.permissions || []);

        const [created] = await db
          .insert(workspaceRoles)
          .values({
            orgId: actor.orgId,
            name,
            description: req.body.description ? String(req.body.description) : null,
            permissions,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        res.json({
          id: created.id,
          roleKey: toCustomRoleKey(created.id),
          name: created.name,
          description: created.description ?? null,
          permissions: sanitizePermissions((created as any).permissions || []),
          isCustom: true,
          isEditable: true,
        });
      } catch (e: any) {
        console.error("[Workspace] POST /roles error:", e);
        res.status(500).json({ error: "Failed to create role" });
      }
    }
  );

  router.put(
    "/api/workspace/roles/:id",
    validateBody(
      z.object({
        name: z.string().min(2).max(50).optional(),
        description: z.string().max(200).optional().nullable(),
        permissions: z.array(z.string()).optional(),
      })
    ),
    async (req, res) => {
      try {
        const actor = await getActorContext(req);
        if (!actor) return res.status(401).json({ error: "Debes iniciar sesión" });
        if (!(await canManageRoles(actor))) {
          return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
        }

        const roleId = String(req.params.id || "");
        const [existingRole] = await db
          .select()
          .from(workspaceRoles)
          .where(and(eq(workspaceRoles.orgId, actor.orgId), eq(workspaceRoles.id, roleId)))
          .limit(1);
        if (!existingRole) {
          return res.status(404).json({ error: "Rol no encontrado" });
        }

        const patch: any = { updatedAt: new Date() };
        if (req.body.name !== undefined) {
          const name = String(req.body.name || "").trim();
          const nameKey = normalizeRoleKey(name);
          if (!name) {
            return res.status(400).json({ error: "Nombre inválido" });
          }
          if (isReservedRoleName(name)) {
            return res.status(400).json({ error: "Nombre de rol reservado" });
          }
          const duplicate = await db
            .select({ id: workspaceRoles.id })
            .from(workspaceRoles)
            .where(
              and(
                eq(workspaceRoles.orgId, actor.orgId),
                sql`LOWER(${workspaceRoles.name}) = ${nameKey}`,
                sql`${workspaceRoles.id} <> ${roleId}`
              )
            )
            .limit(1);
          if (duplicate.length > 0) {
            return res.status(409).json({ error: "Ya existe un rol con ese nombre" });
          }
          patch.name = name;
        }

        if (req.body.description !== undefined) {
          patch.description = req.body.description ? String(req.body.description) : null;
        }

        if (req.body.permissions !== undefined) {
          patch.permissions = sanitizePermissions(req.body.permissions || []);
        }

        const [updated] = await db
          .update(workspaceRoles)
          .set(patch)
          .where(eq(workspaceRoles.id, roleId))
          .returning();

        res.json({
          id: updated.id,
          roleKey: toCustomRoleKey(updated.id),
          name: updated.name,
          description: updated.description ?? null,
          permissions: sanitizePermissions((updated as any).permissions || []),
          isCustom: true,
          isEditable: true,
        });
      } catch (e: any) {
        console.error("[Workspace] PUT /roles/:id error:", e);
        res.status(500).json({ error: "Failed to update role" });
      }
    }
  );

  router.delete("/api/workspace/roles/:id", async (req, res) => {
    try {
      const actor = await getActorContext(req);
      if (!actor) return res.status(401).json({ error: "Debes iniciar sesión" });
      if (!(await canManageRoles(actor))) {
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      const roleId = String(req.params.id || "");
      const [existingRole] = await db
        .select()
        .from(workspaceRoles)
        .where(and(eq(workspaceRoles.orgId, actor.orgId), eq(workspaceRoles.id, roleId)))
        .limit(1);
      if (!existingRole) {
        return res.status(404).json({ error: "Rol no encontrado" });
      }

      const roleKey = toCustomRoleKey(roleId);
      await db.delete(workspaceRoles).where(eq(workspaceRoles.id, roleId));

      // Reassign members and pending invites to default team_member role.
      await db
        .update(users)
        .set({ role: "team_member", updatedAt: new Date() })
        .where(and(eq(users.orgId, actor.orgId), eq(users.role, roleKey)));

      await db
        .update(workspaceInvitations)
        .set({ role: "team_member" })
        .where(and(eq(workspaceInvitations.orgId, actor.orgId), eq(workspaceInvitations.role, roleKey)));

      res.json({ success: true });
    } catch (e: any) {
      console.error("[Workspace] DELETE /roles/:id error:", e);
      res.status(500).json({ error: "Failed to delete role" });
    }
  });

  // ============================================================================
  // WORKSPACE GROUPS
  // ============================================================================

  // Lightweight list of groups for general workspace features (e.g. sharing to groups).
  router.get("/api/workspace/groups/lookup", async (req, res) => {
    try {
      const actor = await getActorContext(req);
      if (!actor) return res.status(401).json({ error: "Debes iniciar sesión" });

      const groups = await db
        .select({
          id: workspaceGroups.id,
          name: workspaceGroups.name,
          description: workspaceGroups.description,
          updatedAt: workspaceGroups.updatedAt,
        })
        .from(workspaceGroups)
        .where(eq(workspaceGroups.orgId, actor.orgId))
        .orderBy(asc(workspaceGroups.name));

      res.json({ orgId: actor.orgId, groups });
    } catch (e: any) {
      console.error("[Workspace] GET /groups/lookup error:", e);
      res.status(500).json({ error: "Failed to load groups" });
    }
  });

  router.get("/api/workspace/groups", async (req, res) => {
    try {
      const actor = await getActorContext(req);
      if (!actor) return res.status(401).json({ error: "Debes iniciar sesión" });

      const allowed = await canManageMembers(actor);
      if (!allowed) {
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      const groups = await db
        .select({
          id: workspaceGroups.id,
          name: workspaceGroups.name,
          description: workspaceGroups.description,
          createdAt: workspaceGroups.createdAt,
          updatedAt: workspaceGroups.updatedAt,
          memberCount: sql<number>`(
            SELECT COUNT(*)::int
            FROM workspace_group_members m
            WHERE m.group_id = ${workspaceGroups.id}
          )`.mapWith(toNumber),
          directSharedChatsCount: sql<number>`(
            SELECT COUNT(DISTINCT s.chat_id)::int
            FROM chat_shares s
            INNER JOIN chats c ON c.id = s.chat_id
            WHERE c.deleted_at IS NULL
              AND EXISTS (
                SELECT 1
                FROM workspace_group_members gm
                INNER JOIN users u ON u.id = gm.user_id
                WHERE gm.group_id = ${workspaceGroups.id}
                  AND u.deleted_at IS NULL
                  AND (
                    (s.recipient_user_id IS NOT NULL AND s.recipient_user_id = u.id)
                    OR LOWER(s.email) = LOWER(u.email)
                  )
              )
          )`.mapWith(toNumber),
          groupSharedChatsCount: sql<number>`(
            SELECT COUNT(DISTINCT gs.chat_id)::int
            FROM chat_group_shares gs
            INNER JOIN chats c ON c.id = gs.chat_id
            WHERE gs.group_id = ${workspaceGroups.id}
              AND c.deleted_at IS NULL
          )`.mapWith(toNumber),
          sharedChatsCount: sql<number>`(
            SELECT COUNT(DISTINCT t.chat_id)::int
            FROM (
              SELECT gs.chat_id
              FROM chat_group_shares gs
              WHERE gs.group_id = ${workspaceGroups.id}
              UNION
              SELECT s.chat_id
              FROM chat_shares s
              INNER JOIN chats c ON c.id = s.chat_id
              WHERE c.deleted_at IS NULL
                AND EXISTS (
                  SELECT 1
                  FROM workspace_group_members gm
                  INNER JOIN users u ON u.id = gm.user_id
                  WHERE gm.group_id = ${workspaceGroups.id}
                    AND u.deleted_at IS NULL
                    AND (
                      (s.recipient_user_id IS NOT NULL AND s.recipient_user_id = u.id)
                      OR LOWER(s.email) = LOWER(u.email)
                    )
                )
            ) t
            INNER JOIN chats c2 ON c2.id = t.chat_id
            WHERE c2.deleted_at IS NULL
          )`.mapWith(toNumber),
        })
        .from(workspaceGroups)
        .where(eq(workspaceGroups.orgId, actor.orgId))
        .orderBy(desc(workspaceGroups.updatedAt));

      res.json({ orgId: actor.orgId, totalGroups: groups.length, groups });
    } catch (e: any) {
      console.error("[Workspace] GET /groups error:", e);
      res.status(500).json({ error: "Failed to load groups" });
    }
  });

  router.post(
    "/api/workspace/groups",
    validateBody(
      z.object({
        name: z.string().min(1).max(80),
        description: z.string().max(280).optional().nullable(),
      })
    ),
    async (req, res) => {
      try {
        const actor = await getActorContext(req);
        if (!actor) return res.status(401).json({ error: "Debes iniciar sesión" });

        const allowed = await canManageMembers(actor);
        if (!allowed) {
          return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
        }

        const name = String((req.body as any).name || "").trim();
        if (!name) return res.status(400).json({ error: "Nombre inválido" });

        const descriptionRaw = (req.body as any).description;
        const description =
          descriptionRaw === null || descriptionRaw === undefined ? null : String(descriptionRaw).trim() || null;

        const now = new Date();
        const [created] = await db
          .insert(workspaceGroups)
          .values({
            orgId: actor.orgId,
            name,
            description,
            createdByUserId: actor.userId,
            createdAt: now,
            updatedAt: now,
          } as any)
          .returning();

        res.json({ success: true, group: created });
      } catch (e: any) {
        if (e?.code === "23505") {
          return res.status(409).json({ error: "Ya existe un grupo con ese nombre" });
        }
        console.error("[Workspace] POST /groups error:", e);
        res.status(500).json({ error: "Failed to create group" });
      }
    }
  );

  router.put(
    "/api/workspace/groups/:groupId",
    validateBody(
      z
        .object({
          name: z.string().min(1).max(80).optional(),
          description: z.string().max(280).optional().nullable(),
        })
        .refine((v) => v.name !== undefined || v.description !== undefined, {
          message: "At least one field must be provided",
        })
    ),
    async (req, res) => {
      try {
        const actor = await getActorContext(req);
        if (!actor) return res.status(401).json({ error: "Debes iniciar sesión" });

        const allowed = await canManageMembers(actor);
        if (!allowed) {
          return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
        }

        const groupId = String((req.params as any).groupId || "").trim();
        if (!groupId) return res.status(400).json({ error: "groupId required" });

        const [existing] = await db
          .select({ id: workspaceGroups.id })
          .from(workspaceGroups)
          .where(and(eq(workspaceGroups.id, groupId), eq(workspaceGroups.orgId, actor.orgId)))
          .limit(1);
        if (!existing) return res.status(404).json({ error: "Group not found" });

        const patch: any = { updatedAt: new Date() };
        if ((req.body as any).name !== undefined) {
          const name = String((req.body as any).name || "").trim();
          if (!name) return res.status(400).json({ error: "Nombre inválido" });
          patch.name = name;
        }
        if ((req.body as any).description !== undefined) {
          const descriptionRaw = (req.body as any).description;
          patch.description =
            descriptionRaw === null || descriptionRaw === undefined ? null : String(descriptionRaw).trim() || null;
        }

        const [updated] = await db
          .update(workspaceGroups)
          .set(patch)
          .where(and(eq(workspaceGroups.id, groupId), eq(workspaceGroups.orgId, actor.orgId)))
          .returning();

        res.json({ success: true, group: updated });
      } catch (e: any) {
        if (e?.code === "23505") {
          return res.status(409).json({ error: "Ya existe un grupo con ese nombre" });
        }
        console.error("[Workspace] PUT /groups/:groupId error:", e);
        res.status(500).json({ error: "Failed to update group" });
      }
    }
  );

  router.delete("/api/workspace/groups/:groupId", async (req, res) => {
    try {
      const actor = await getActorContext(req);
      if (!actor) return res.status(401).json({ error: "Debes iniciar sesión" });

      const allowed = await canManageMembers(actor);
      if (!allowed) {
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      const groupId = String((req.params as any).groupId || "").trim();
      if (!groupId) return res.status(400).json({ error: "groupId required" });

      const [deleted] = await db
        .delete(workspaceGroups)
        .where(and(eq(workspaceGroups.id, groupId), eq(workspaceGroups.orgId, actor.orgId)))
        .returning();

      if (!deleted) return res.status(404).json({ error: "Group not found" });
      res.json({ success: true });
    } catch (e: any) {
      console.error("[Workspace] DELETE /groups/:groupId error:", e);
      res.status(500).json({ error: "Failed to delete group" });
    }
  });

  router.get("/api/workspace/groups/:groupId/members", async (req, res) => {
    try {
      const actor = await getActorContext(req);
      if (!actor) return res.status(401).json({ error: "Debes iniciar sesión" });

      const allowed = await canManageMembers(actor);
      if (!allowed) {
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      const groupId = String((req.params as any).groupId || "").trim();
      if (!groupId) return res.status(400).json({ error: "groupId required" });

      const [group] = await db
        .select({ id: workspaceGroups.id })
        .from(workspaceGroups)
        .where(and(eq(workspaceGroups.id, groupId), eq(workspaceGroups.orgId, actor.orgId)))
        .limit(1);
      if (!group) return res.status(404).json({ error: "Group not found" });

      const members = await db
        .select({
          userId: users.id,
          email: users.email,
          fullName: users.fullName,
          username: users.username,
          role: users.role,
          addedAt: workspaceGroupMembers.createdAt,
        })
        .from(workspaceGroupMembers)
        .innerJoin(users, eq(users.id, workspaceGroupMembers.userId))
        .where(and(eq(workspaceGroupMembers.groupId, groupId), eq(users.orgId, actor.orgId), isNull(users.deletedAt)))
        .orderBy(desc(workspaceGroupMembers.createdAt));

      res.json({ groupId, members });
    } catch (e: any) {
      console.error("[Workspace] GET /groups/:groupId/members error:", e);
      res.status(500).json({ error: "Failed to load group members" });
    }
  });

  router.post(
    "/api/workspace/groups/:groupId/members",
    validateBody(
      z.object({
        emails: z.array(z.string().min(3)).min(1),
      })
    ),
    async (req, res) => {
      try {
        const actor = await getActorContext(req);
        if (!actor) return res.status(401).json({ error: "Debes iniciar sesión" });

        const allowed = await canManageMembers(actor);
        if (!allowed) {
          return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
        }

        const groupId = String((req.params as any).groupId || "").trim();
        if (!groupId) return res.status(400).json({ error: "groupId required" });

        const [group] = await db
          .select({ id: workspaceGroups.id })
          .from(workspaceGroups)
          .where(and(eq(workspaceGroups.id, groupId), eq(workspaceGroups.orgId, actor.orgId)))
          .limit(1);
        if (!group) return res.status(404).json({ error: "Group not found" });

        const dedupedEmails = Array.from(
          new Set(
            ((req.body as any).emails as string[])
              .map((e) => String(e || "").trim().toLowerCase())
              .filter(Boolean)
          )
        );

        const targetUsers = await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(and(eq(users.orgId, actor.orgId), inArray(users.email, dedupedEmails), isNull(users.deletedAt)));
        const userIdByEmail = new Map(
          targetUsers
            .map((u) => ({ email: normalizeEmail(u.email), id: u.id }))
            .filter((u) => u.email && u.id)
            .map((u) => [u.email, u.id])
        );

        const now = new Date();
        const results: Array<{ email: string; status: "added" | "skipped" | "error"; reason?: string }> = [];

        for (const email of dedupedEmails) {
          const targetUserId = userIdByEmail.get(email);
          if (!targetUserId) {
            results.push({ email, status: "skipped", reason: "Usuario no encontrado en este workspace" });
            continue;
          }

          try {
            await db
              .insert(workspaceGroupMembers)
              .values({ groupId, userId: targetUserId, createdAt: now } as any)
              .onConflictDoNothing({
                target: [workspaceGroupMembers.groupId, workspaceGroupMembers.userId],
              });
            results.push({ email, status: "added" });
          } catch (memberErr: any) {
            results.push({ email, status: "error", reason: memberErr?.message || "No se pudo agregar" });
          }
        }

        res.json({ success: true, results });
      } catch (e: any) {
        console.error("[Workspace] POST /groups/:groupId/members error:", e);
        res.status(500).json({ error: "Failed to add group members" });
      }
    }
  );

  router.delete("/api/workspace/groups/:groupId/members/:userId", async (req, res) => {
    try {
      const actor = await getActorContext(req);
      if (!actor) return res.status(401).json({ error: "Debes iniciar sesión" });

      const allowed = await canManageMembers(actor);
      if (!allowed) {
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      const groupId = String((req.params as any).groupId || "").trim();
      const targetUserId = String((req.params as any).userId || "").trim();
      if (!groupId || !targetUserId) return res.status(400).json({ error: "groupId and userId required" });

      const [group] = await db
        .select({ id: workspaceGroups.id })
        .from(workspaceGroups)
        .where(and(eq(workspaceGroups.id, groupId), eq(workspaceGroups.orgId, actor.orgId)))
        .limit(1);
      if (!group) return res.status(404).json({ error: "Group not found" });

      await db
        .delete(workspaceGroupMembers)
        .where(and(eq(workspaceGroupMembers.groupId, groupId), eq(workspaceGroupMembers.userId, targetUserId)));

      res.json({ success: true });
    } catch (e: any) {
      console.error("[Workspace] DELETE /groups/:groupId/members/:userId error:", e);
      res.status(500).json({ error: "Failed to remove group member" });
    }
  });

  router.get("/api/workspace/analytics/overview", async (req, res) => {
    try {
      const actor = await getActorContext(req);
      if (!actor) return res.status(401).json({ error: "Debes iniciar sesión" });

      const daysRaw = typeof req.query.days === "string" ? req.query.days : undefined;
      const daysParsed = daysRaw ? Number.parseInt(daysRaw, 10) : 7;
      const days = Number.isFinite(daysParsed) ? Math.min(Math.max(daysParsed, 1), 365) : 7;

      const { userId, orgId } = actor;
      const canViewAll = await canViewAnalytics(actor);

      const endDate = new Date();
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - (days - 1));
      startDate.setHours(0, 0, 0, 0);

      const whereUsersSql = canViewAll
        ? sql`u.org_id = ${orgId} AND u.deleted_at IS NULL`
        : sql`u.id = ${userId} AND u.deleted_at IS NULL`;

      const membersResult = await db.execute(sql`
        SELECT
          u.id as "userId",
          u.email as "email",
          COALESCE(u.full_name, u.username, '—') as "displayName",
          u.role as "role",
          u.last_login_at as "lastLoginAt",
          COALESCE(chatAgg.chats_created, 0)::int as "chatsCreated",
          COALESCE(chatAgg.tokens_used, 0)::int as "tokensUsed",
          COALESCE(msgAgg.user_messages, 0)::int as "userMessages",
          COALESCE(pvAgg.page_views, 0)::int as "pageViews",
          COALESCE(actAgg.actions, 0)::int as "actions",
          NULLIF(
            GREATEST(
              COALESCE(chatAgg.last_chat_at, TIMESTAMP '1970-01-01'),
              COALESCE(msgAgg.last_message_at, TIMESTAMP '1970-01-01'),
              COALESCE(pvAgg.last_page_view_at, TIMESTAMP '1970-01-01'),
              COALESCE(actAgg.last_action_at, TIMESTAMP '1970-01-01'),
              COALESCE(u.last_login_at, TIMESTAMP '1970-01-01')
            ),
            TIMESTAMP '1970-01-01'
          ) as "lastActiveAt"
        FROM users u
        LEFT JOIN (
          SELECT
            user_id,
            COUNT(*) as chats_created,
            COALESCE(SUM(tokens_used), 0) as tokens_used,
            MAX(COALESCE(last_message_at, created_at)) as last_chat_at
          FROM chats
          WHERE created_at >= ${startDate}
            AND user_id IS NOT NULL
          GROUP BY user_id
        ) chatAgg ON chatAgg.user_id = u.id
        LEFT JOIN (
          SELECT
            c.user_id,
            COUNT(*) as user_messages,
            MAX(m.created_at) as last_message_at
          FROM chat_messages m
          JOIN chats c ON c.id = m.chat_id
          WHERE m.role = 'user'
            AND m.created_at >= ${startDate}
            AND c.user_id IS NOT NULL
          GROUP BY c.user_id
        ) msgAgg ON msgAgg.user_id = u.id
        LEFT JOIN (
          SELECT
            user_id,
            COUNT(*) as page_views,
            MAX(created_at) as last_page_view_at
          FROM audit_logs
          WHERE action = 'page_view'
            AND created_at >= ${startDate}
            AND user_id IS NOT NULL
          GROUP BY user_id
        ) pvAgg ON pvAgg.user_id = u.id
        LEFT JOIN (
          SELECT
            user_id,
            COUNT(*) as actions,
            MAX(created_at) as last_action_at
          FROM audit_logs
          WHERE action = 'user_action'
            AND created_at >= ${startDate}
            AND user_id IS NOT NULL
          GROUP BY user_id
        ) actAgg ON actAgg.user_id = u.id
        WHERE ${whereUsersSql}
        ORDER BY "userMessages" DESC, "pageViews" DESC, "chatsCreated" DESC, "displayName" ASC
      `);

      // Filter down to the org members (required since some subqueries aren't org-scoped).
      const byMemberRaw = (membersResult.rows as any[]).filter((row) => {
        // When canViewAll=true we already scoped by org via whereUsersSql.
        // When canViewAll=false we scoped to userId, so ok.
        return !!row?.userId;
      });

      const byMember = byMemberRaw.map((row) => ({
        userId: String(row.userId),
        email: row.email ? String(row.email) : null,
        displayName: String(row.displayName || "—"),
        role: row.role ? String(row.role) : null,
        lastLoginAt: row.lastLoginAt ? new Date(row.lastLoginAt).toISOString() : null,
        lastActiveAt: row.lastActiveAt ? new Date(row.lastActiveAt).toISOString() : null,
        chatsCreated: toNumber(row.chatsCreated),
        userMessages: toNumber(row.userMessages),
        tokensUsed: toNumber(row.tokensUsed),
        pageViews: toNumber(row.pageViews),
        actions: toNumber(row.actions),
      }));

      const totals = byMember.reduce(
        (acc, m) => {
          acc.members += 1;
          if (m.chatsCreated > 0 || m.userMessages > 0 || m.pageViews > 0 || m.actions > 0) {
            acc.activeMembers += 1;
          }
          acc.chatsCreated += m.chatsCreated;
          acc.userMessages += m.userMessages;
          acc.tokensUsed += m.tokensUsed;
          acc.pageViews += m.pageViews;
          acc.actions += m.actions;
          return acc;
        },
        {
          members: 0,
          activeMembers: 0,
          chatsCreated: 0,
          userMessages: 0,
          tokensUsed: 0,
          pageViews: 0,
          actions: 0,
        }
      );

      const whereOrgUsersSql = canViewAll
        ? sql`u.org_id = ${orgId} AND u.deleted_at IS NULL`
        : sql`u.id = ${userId} AND u.deleted_at IS NULL`;

      const [chatsByDayResult, messagesByDayResult, pageViewsByDayResult, actionsByDayResult, sessionsResult, topPagesResult, topActionsResult] = await Promise.all([
        db.execute(sql`
          SELECT
            DATE(c.created_at) as date,
            COUNT(*)::int as "chatsCreated",
            COALESCE(SUM(c.tokens_used), 0)::int as "tokensUsed"
          FROM chats c
          JOIN users u ON u.id = c.user_id
          WHERE ${whereOrgUsersSql}
            AND c.created_at >= ${startDate}
          GROUP BY 1
          ORDER BY 1 ASC
        `),
        db.execute(sql`
          SELECT
            DATE(m.created_at) as date,
            COUNT(*)::int as "userMessages"
          FROM chat_messages m
          JOIN chats c ON c.id = m.chat_id
          JOIN users u ON u.id = c.user_id
          WHERE ${whereOrgUsersSql}
            AND m.role = 'user'
            AND m.created_at >= ${startDate}
          GROUP BY 1
          ORDER BY 1 ASC
        `),
        db.execute(sql`
          SELECT
            DATE(l.created_at) as date,
            COUNT(*)::int as "pageViews"
          FROM audit_logs l
          JOIN users u ON u.id = l.user_id
          WHERE ${whereOrgUsersSql}
            AND l.action = 'page_view'
            AND l.created_at >= ${startDate}
          GROUP BY 1
          ORDER BY 1 ASC
        `),
        db.execute(sql`
          SELECT
            DATE(l.created_at) as date,
            COUNT(*)::int as "actions"
          FROM audit_logs l
          JOIN users u ON u.id = l.user_id
          WHERE ${whereOrgUsersSql}
            AND l.action = 'user_action'
            AND l.created_at >= ${startDate}
          GROUP BY 1
          ORDER BY 1 ASC
        `),
        db.execute(sql`
          SELECT
            COUNT(DISTINCT NULLIF(l.details->>'sessionId', ''))::int as sessions
          FROM audit_logs l
          JOIN users u ON u.id = l.user_id
          WHERE ${whereOrgUsersSql}
            AND l.created_at >= ${startDate}
            AND l.action IN ('page_view', 'user_action')
        `),
        db.execute(sql`
          SELECT
            l.resource as page,
            COUNT(*)::int as count
          FROM audit_logs l
          JOIN users u ON u.id = l.user_id
          WHERE ${whereOrgUsersSql}
            AND l.action = 'page_view'
            AND l.created_at >= ${startDate}
            AND l.resource IS NOT NULL
          GROUP BY l.resource
          ORDER BY count DESC
          LIMIT 5
        `),
        db.execute(sql`
          SELECT
            l.resource as action,
            COUNT(*)::int as count
          FROM audit_logs l
          JOIN users u ON u.id = l.user_id
          WHERE ${whereOrgUsersSql}
            AND l.action = 'user_action'
            AND l.created_at >= ${startDate}
            AND l.resource IS NOT NULL
          GROUP BY l.resource
          ORDER BY count DESC
          LIMIT 5
        `),
      ]);

      const toIsoDate = (value: unknown): string | null => {
        if (!value) return null;
        const d = value instanceof Date ? value : new Date(value as any);
        if (Number.isNaN(d.getTime())) return null;
        return d.toISOString().slice(0, 10);
      };

      const chatsByDay = new Map<string, { chatsCreated: number; tokensUsed: number }>();
      for (const row of chatsByDayResult.rows as any[]) {
        const date = toIsoDate(row.date);
        if (!date) continue;
        chatsByDay.set(date, {
          chatsCreated: toNumber(row.chatsCreated),
          tokensUsed: toNumber(row.tokensUsed),
        });
      }

      const messagesByDay = new Map<string, number>();
      for (const row of messagesByDayResult.rows as any[]) {
        const date = toIsoDate(row.date);
        if (!date) continue;
        messagesByDay.set(date, toNumber(row.userMessages));
      }

      const pageViewsByDay = new Map<string, number>();
      for (const row of pageViewsByDayResult.rows as any[]) {
        const date = toIsoDate(row.date);
        if (!date) continue;
        pageViewsByDay.set(date, toNumber(row.pageViews));
      }

      const actionsByDay = new Map<string, number>();
      for (const row of actionsByDayResult.rows as any[]) {
        const date = toIsoDate(row.date);
        if (!date) continue;
        actionsByDay.set(date, toNumber(row.actions));
      }

      const sessionsCount = toNumber((sessionsResult.rows as any[])?.[0]?.sessions);

      const topPages = (topPagesResult.rows as any[])
        .map((row) => ({
          page: String(row.page || ""),
          count: toNumber(row.count),
        }))
        .filter((row) => row.page);

      const topActions = (topActionsResult.rows as any[])
        .map((row) => ({
          action: String(row.action || ""),
          count: toNumber(row.count),
        }))
        .filter((row) => row.action);

      const activityByDay: Array<{
        date: string;
        chatsCreated: number;
        userMessages: number;
        tokensUsed: number;
        pageViews: number;
        actions: number;
      }> = [];

      for (let i = 0; i < days; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        const date = d.toISOString().slice(0, 10);
        const chat = chatsByDay.get(date);
        activityByDay.push({
          date,
          chatsCreated: chat?.chatsCreated ?? 0,
          userMessages: messagesByDay.get(date) ?? 0,
          tokensUsed: chat?.tokensUsed ?? 0,
          pageViews: pageViewsByDay.get(date) ?? 0,
          actions: actionsByDay.get(date) ?? 0,
        });
      }

      res.json({
        canViewAll,
        days,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        sessionsCount,
        topPages,
        topActions,
        totals,
        byMember,
        activityByDay,
      });
    } catch (e: any) {
      console.error("[Workspace] GET /analytics/overview error:", e);
      res.status(500).json({ error: "No se pudo cargar el análisis de usuario" });
    }
  });

  router.post(
    "/api/workspace/analytics/track",
    validateBody(
      z
        .object({
          eventType: z.enum(["page_view", "action"]),
          sessionId: z.string().trim().min(1).max(200).optional(),
          page: z.string().trim().min(1).max(1000).optional(),
          action: z.string().trim().min(1).max(200).optional(),
          metadata: z.record(z.any()).optional(),
        })
        .refine((v) => (v.eventType === "page_view" ? !!v.page : !!v.action), {
          message: "Missing required fields for eventType",
        })
    ),
    async (req, res) => {
      try {
        const userId = getUserId(req);
        if (!userId) return res.status(401).json({ error: "Debes iniciar sesión" });

        const ipAddress = req.ip || req.socket.remoteAddress;
        const userAgent = req.get("user-agent");

        const action = req.body.eventType === "page_view" ? "page_view" : "user_action";
        const resource = req.body.eventType === "page_view" ? req.body.page : req.body.action;

        await db.insert(auditLogs).values({
          userId,
          action,
          resource,
          details: {
            eventType: req.body.eventType,
            sessionId: req.body.sessionId,
            page: req.body.page,
            action: req.body.action,
            metadata: req.body.metadata,
          },
          ipAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress,
          userAgent,
          createdAt: new Date(),
        });

        res.json({ ok: true });
      } catch (e: any) {
        console.error("[Workspace] POST /analytics/track error:", e);
        res.status(500).json({ error: "No se pudo registrar el evento" });
      }
    }
  );

  return router;
}
