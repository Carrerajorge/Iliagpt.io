export type SessionUser = {
  claims: {
    sub: string;
    email?: string | null;
    first_name?: string;
    last_name?: string;
    role?: string;
  };
  role?: string;
  expires_at: number;
  // Provider-specific fields (refresh_token, access_token, etc.) may be present.
  [key: string]: unknown;
};

export function buildSessionUserFromDbUser(dbUser: any): SessionUser {
  return {
    id: String(dbUser.id),
    claims: {
      sub: String(dbUser.id),
      email: dbUser.email ?? null,
      first_name: dbUser.firstName || "",
      last_name: dbUser.lastName || "",
      role: dbUser.role || "user",
    },
    role: dbUser.role || "user",
    expires_at: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60),
  };
}

