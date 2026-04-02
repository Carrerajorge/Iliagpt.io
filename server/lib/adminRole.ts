export function normalizeRole(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function isAdminRole(value: unknown): boolean {
  const role = normalizeRole(value);
  return role === "admin" || role === "superadmin";
}
