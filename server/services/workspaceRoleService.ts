import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { workspaceRoles } from "@shared/schema";
import {
  BUILTIN_ROLES,
  BUILTIN_ROLE_KEYS,
  BUILTIN_ROLE_SET,
  PERMISSIONS,
  PERMISSION_CATALOG,
  getRolePermissions,
  type Permission,
} from "./rbac";

export const CUSTOM_ROLE_PREFIX = "custom:";

function normalizeRoleName(value: string): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const BUILTIN_ROLE_NAME_SET = new Set(
  [...BUILTIN_ROLE_KEYS, ...Object.values(BUILTIN_ROLES).map((role) => String(role?.name || ""))]
    .map((value) => normalizeRoleName(value))
);

export type WorkspaceRoleSummary = {
  id: string;
  roleKey: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  isCustom: boolean;
  isEditable: boolean;
};

export function normalizeRoleKey(value: string | null | undefined): string {
  const raw = String(value || "").toLowerCase().trim();
  if (!raw) return raw;
  const legacyMap: Record<string, string> = {
    workspace_owner: "team_admin",
    owner: "team_admin",
    workspace_admin: "team_admin",
    workspace_member: "team_member",
    workspace_viewer: "team_member",
  };
  return legacyMap[raw] || raw;
}

export function isCustomRoleKey(roleKey: string): boolean {
  return roleKey.startsWith(CUSTOM_ROLE_PREFIX);
}

export function toCustomRoleKey(id: string): string {
  return `${CUSTOM_ROLE_PREFIX}${id}`;
}

export function parseCustomRoleId(roleKey: string): string | null {
  if (!isCustomRoleKey(roleKey)) return null;
  const id = roleKey.slice(CUSTOM_ROLE_PREFIX.length).trim();
  return id || null;
}

export function isBuiltinRole(roleKey: string): boolean {
  return BUILTIN_ROLE_SET.has(roleKey);
}

export function isReservedRoleName(nameRaw: string): boolean {
  const normalized = normalizeRoleName(nameRaw);
  if (!normalized) return false;
  if (normalized === "user") return true;
  if (BUILTIN_ROLE_NAME_SET.has(normalized)) return true;
  const mappedKey = normalizeRoleKey(normalized);
  if (BUILTIN_ROLE_SET.has(mappedKey)) return true;
  return false;
}

export function getPermissionCatalog() {
  return PERMISSION_CATALOG;
}

export function sanitizePermissions(input: string[]): Permission[] {
  const allowed = new Set(PERMISSIONS);
  const unique = new Set<Permission>();
  for (const raw of input || []) {
    const perm = String(raw || "").trim() as Permission;
    if (allowed.has(perm)) {
      unique.add(perm);
    }
  }
  return Array.from(unique);
}

export const WORKSPACE_BUILTIN_ROLE_KEYS = ["team_member", "billing_manager", "team_admin"] as const;
const WORKSPACE_BUILTIN_ROLE_SET = new Set<string>(WORKSPACE_BUILTIN_ROLE_KEYS);

export function isWorkspaceBuiltinRole(roleKeyRaw: string): boolean {
  const roleKey = normalizeRoleKey(roleKeyRaw);
  return WORKSPACE_BUILTIN_ROLE_SET.has(roleKey);
}

export async function listRolesForOrg(orgId: string): Promise<WorkspaceRoleSummary[]> {
  const builtins: WorkspaceRoleSummary[] = WORKSPACE_BUILTIN_ROLE_KEYS.map((key) => {
    const role = BUILTIN_ROLES[key];
    return {
      id: key,
      roleKey: key,
      name: role?.name || key,
      description: role?.description || null,
      permissions: getRolePermissions(key),
      isCustom: false,
      isEditable: false,
    };
  });

  const customRows = await db
    .select()
    .from(workspaceRoles)
    .where(eq(workspaceRoles.orgId, orgId))
    .orderBy(asc(workspaceRoles.name));

  const customs: WorkspaceRoleSummary[] = customRows.map((row) => ({
    id: row.id,
    roleKey: toCustomRoleKey(row.id),
    name: row.name,
    description: row.description ?? null,
    permissions: sanitizePermissions((row as any).permissions || []),
    isCustom: true,
    isEditable: true,
  }));

  return [...builtins, ...customs];
}

export async function getCustomRoleById(orgId: string, roleId: string) {
  const [row] = await db
    .select()
    .from(workspaceRoles)
    .where(and(eq(workspaceRoles.orgId, orgId), eq(workspaceRoles.id, roleId)))
    .limit(1);
  return row || null;
}

export async function resolveRolePermissionsForOrg(
  orgId: string,
  roleKeyRaw: string
): Promise<Permission[]> {
  const roleKey = normalizeRoleKey(roleKeyRaw);
  if (isBuiltinRole(roleKey)) {
    return getRolePermissions(roleKey);
  }

  const customId = parseCustomRoleId(roleKey);
  if (!customId) return [];
  const customRole = await getCustomRoleById(orgId, customId);
  if (!customRole) return [];
  return sanitizePermissions((customRole as any).permissions || []);
}

export async function isRoleKeyValidForOrg(orgId: string, roleKeyRaw: string): Promise<boolean> {
  const roleKey = normalizeRoleKey(roleKeyRaw);
  if (!roleKey) return false;
  if (isBuiltinRole(roleKey)) return true;
  const customId = parseCustomRoleId(roleKey);
  if (!customId) return false;
  const row = await getCustomRoleById(orgId, customId);
  return !!row;
}

export function isSystemAdminRole(roleKeyRaw: string): boolean {
  const roleKey = normalizeRoleKey(roleKeyRaw);
  return roleKey === "admin" || roleKey === "superadmin";
}

export function isWorkspaceAdminRole(roleKeyRaw: string): boolean {
  const roleKey = normalizeRoleKey(roleKeyRaw);
  return roleKey === "team_admin" || isSystemAdminRole(roleKey);
}
