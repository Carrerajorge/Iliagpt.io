const SUBMIT_LOCKS_STORAGE_KEY = "__sira_submit_locks";
export const SUBMIT_LOCK_TTL_MS = 10_000;
const DRAFT_SUBMIT_SCOPE = "__draft__";

type SubmitLockState = Record<string, number>;

function normalizeScope(scope?: string | null): string {
  const trimmed = typeof scope === "string" ? scope.trim() : "";
  return trimmed || DRAFT_SUBMIT_SCOPE;
}

function hasSessionStorage(): boolean {
  return typeof sessionStorage !== "undefined";
}

function pruneExpiredLocks(state: SubmitLockState, now: number): SubmitLockState {
  const next: SubmitLockState = {};

  for (const [scope, timestamp] of Object.entries(state)) {
    if (!Number.isFinite(timestamp)) {
      continue;
    }
    if (now - timestamp >= SUBMIT_LOCK_TTL_MS) {
      continue;
    }
    next[scope] = timestamp;
  }

  return next;
}

function writeState(state: SubmitLockState): void {
  if (!hasSessionStorage()) {
    return;
  }

  try {
    const scopes = Object.keys(state);
    if (scopes.length === 0) {
      sessionStorage.removeItem(SUBMIT_LOCKS_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(SUBMIT_LOCKS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures; the lock is best-effort.
  }
}

function readState(now = Date.now()): SubmitLockState {
  if (!hasSessionStorage()) {
    return {};
  }

  try {
    const raw = sessionStorage.getItem(SUBMIT_LOCKS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as SubmitLockState;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      sessionStorage.removeItem(SUBMIT_LOCKS_STORAGE_KEY);
      return {};
    }

    const pruned = pruneExpiredLocks(parsed, now);
    if (Object.keys(pruned).length !== Object.keys(parsed).length) {
      writeState(pruned);
    }
    return pruned;
  } catch {
    try {
      sessionStorage.removeItem(SUBMIT_LOCKS_STORAGE_KEY);
    } catch {
      // ignore
    }
    return {};
  }
}

export function normalizeSubmitLockScope(scope?: string | null): string {
  return normalizeScope(scope);
}

export function resolveScopedSubmitLock(options: {
  preferredScope?: string | null;
  conversationId?: string | null;
  latestConversationId?: string | null;
  normalizeConversationId?: (conversationId: string) => string;
}): string {
  const normalizeConversationId = options.normalizeConversationId ?? ((conversationId: string) => conversationId);
  const preferredScope = typeof options.preferredScope === "string" ? options.preferredScope.trim() : "";
  if (preferredScope) {
    return normalizeScope(preferredScope);
  }

  const conversationId = typeof options.conversationId === "string" ? options.conversationId.trim() : "";
  if (conversationId) {
    return normalizeScope(normalizeConversationId(conversationId));
  }

  const latestConversationId =
    typeof options.latestConversationId === "string" ? options.latestConversationId.trim() : "";
  if (latestConversationId) {
    return normalizeScope(normalizeConversationId(latestConversationId));
  }

  return DRAFT_SUBMIT_SCOPE;
}

export function isSubmitLocked(scope?: string | null, now = Date.now()): boolean {
  const normalizedScope = normalizeScope(scope);
  const state = readState(now);
  return Number.isFinite(state[normalizedScope]);
}

export function setSubmitLock(scope?: string | null, now = Date.now()): string {
  const normalizedScope = normalizeScope(scope);
  const state = readState(now);
  state[normalizedScope] = now;
  writeState(state);
  return normalizedScope;
}

export function clearSubmitLock(scope?: string | null): void {
  const normalizedScope = normalizeScope(scope);
  const state = readState();
  if (!(normalizedScope in state)) {
    return;
  }
  delete state[normalizedScope];
  writeState(state);
}
