export function normalizeWorkspaceName(name: string): string {
  return String(name ?? "").trim().replace(/\s+/g, " ");
}

export function isValidWorkspaceName(name: string): boolean {
  const n = normalizeWorkspaceName(name);
  if (n.length < 2) return false;
  if (n.length > 60) return false;
  // allow letters, numbers, spaces and common punctuation
  // disallow control chars
  if (/[^\p{L}\p{N} .,_\-()'&]/u.test(n)) return false;
  return true;
}
