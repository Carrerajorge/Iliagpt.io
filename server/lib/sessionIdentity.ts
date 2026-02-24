export function extractUserIdFromSession(sess: any): string | null {
  if (!sess) return null;

  // Prefer explicit session binding (we set this for authenticated users).
  if (typeof sess.authUserId === "string" && sess.authUserId) return sess.authUserId;

  const passportUser = sess?.passport?.user;
  if (typeof passportUser === "string" && passportUser) return passportUser;

  const passportId =
    passportUser?.claims?.sub ||
    passportUser?.id ||
    passportUser?.sub;

  if (typeof passportId === "string" && passportId) return passportId;

  return null;
}

export function isOwnedByUser(sess: any, userId: string): boolean {
  return extractUserIdFromSession(sess) === userId;
}

