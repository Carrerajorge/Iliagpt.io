export type AdminCheckUser =
  | {
      role?: string | null;
      isAdmin?: boolean | null;
      email?: string | null;
      claims?: { email?: string | null; role?: string | null } | null;
    }
  | null
  | undefined;

export function isAdminUser(user: AdminCheckUser): boolean {
  if (!user) return false;

  // Some endpoints may hydrate an explicit boolean.
  if ((user as any).isAdmin) return true;

  const anyUser = user as any;
  const role = String(anyUser.role ?? anyUser.claims?.role ?? "").toLowerCase().trim();
  return role === "admin" || role === "superadmin";
}

export function isBillingManagerUser(user: AdminCheckUser): boolean {
  if (!user) return false;

  if ((user as any).isAdmin) return true;

  const anyUser = user as any;
  const role = String(anyUser.role ?? anyUser.claims?.role ?? "").toLowerCase().trim();
  return (
    role === "admin" ||
    role === "superadmin" ||
    role === "team_admin" ||
    role === "workspace_owner" ||
    role === "workspace_admin" ||
    role === "billing_manager" ||
    role === "owner"
  );
}

export function isWorkspaceManagerUser(user: AdminCheckUser): boolean {
  if (!user) return false;
  if ((user as any).isAdmin) return true;
  const anyUser = user as any;
  const role = String(anyUser.role ?? anyUser.claims?.role ?? "").toLowerCase().trim();
  return (
    role === "admin" ||
    role === "superadmin" ||
    role === "team_admin" ||
    role === "workspace_owner" ||
    role === "workspace_admin" ||
    role === "owner"
  );
}

export function isWorkspaceOwnerUser(user: AdminCheckUser): boolean {
  if (!user) return false;
  const anyUser = user as any;
  const role = String(anyUser.role ?? anyUser.claims?.role ?? "").toLowerCase().trim();
  return role === "workspace_owner" || role === "owner";
}
