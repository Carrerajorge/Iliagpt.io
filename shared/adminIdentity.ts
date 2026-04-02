const STATIC_ADMIN_EMAILS = ["carrerajorge874@gmail.com"] as const;

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isStaticAdminEmail(value: unknown): boolean {
  const email = normalizeEmail(value);
  return email.length > 0 && STATIC_ADMIN_EMAILS.includes(email as (typeof STATIC_ADMIN_EMAILS)[number]);
}

export function isConfiguredAdminEmail(
  value: unknown,
  allowlist: Iterable<string>,
): boolean {
  const email = normalizeEmail(value);
  if (!email) {
    return false;
  }

  for (const candidate of allowlist) {
    if (normalizeEmail(candidate) === email) {
      return true;
    }
  }

  return false;
}

export function isPrivilegedAdminEmail(
  value: unknown,
  allowlist?: Iterable<string>,
): boolean {
  if (isStaticAdminEmail(value)) {
    return true;
  }

  return allowlist ? isConfiguredAdminEmail(value, allowlist) : false;
}
