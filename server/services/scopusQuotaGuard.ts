type HeaderBag = Headers | Record<string, unknown> | undefined;

export interface ScopusQuotaGuardState {
  limit?: number;
  remaining?: number;
  resetAtMs?: number;
  pausedUntilMs?: number;
  pauseReason?: "soft_limit" | "rate_limited";
  updatedAtMs?: number;
  lastStatus?: number;
}

export interface ScopusQuotaGateResult {
  allowed: boolean;
  reason?: string;
  retryAtMs?: number;
  state: ScopusQuotaGuardState;
}

const SOFT_LIMIT_PERCENT = clampPercent(process.env.SCOPUS_SOFT_LIMIT_PERCENT, 0.9);
const SOFT_LIMIT_MIN_REMAINING = clampInt(process.env.SCOPUS_SOFT_LIMIT_MIN_REMAINING, 100, 0);
const SOFT_LIMIT_COOLDOWN_MS = clampInt(process.env.SCOPUS_SOFT_LIMIT_COOLDOWN_MS, 15 * 60 * 1000, 1000);

const quotaState: ScopusQuotaGuardState = {};

function clampPercent(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0.5, Math.min(0.99, n));
}

function clampInt(raw: string | undefined, fallback: number, min = 0): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.floor(n));
}

function readHeader(headers: HeaderBag, name: string): string | undefined {
  if (!headers) return undefined;

  if (typeof (headers as Headers).get === "function") {
    const val = (headers as Headers).get(name) ?? (headers as Headers).get(name.toLowerCase());
    return val ?? undefined;
  }

  const record = headers as Record<string, unknown>;
  const direct = record[name];
  if (typeof direct === "string") return direct;
  const lower = record[name.toLowerCase()];
  if (typeof lower === "string") return lower;

  // Case-insensitive scan for plain objects
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(record)) {
    if (k.toLowerCase() === target && typeof v === "string") return v;
  }
  return undefined;
}

function toInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  const i = Math.floor(n);
  return i >= 0 ? i : undefined;
}

function toEpochMs(raw: string | undefined): number | undefined {
  const n = toInt(raw);
  if (n === undefined) return undefined;
  // Most APIs return epoch seconds in X-RateLimit-Reset.
  return n < 10_000_000_000 ? n * 1000 : n;
}

function shouldPause(limit?: number, remaining?: number): boolean {
  if (!limit || limit <= 0 || remaining === undefined) return false;
  const usedRatio = (limit - remaining) / limit;
  if (remaining <= SOFT_LIMIT_MIN_REMAINING) return true;
  return usedRatio >= SOFT_LIMIT_PERCENT;
}

function clearPauseIfExpired(now: number): void {
  if (quotaState.pausedUntilMs && now >= quotaState.pausedUntilMs) {
    quotaState.pausedUntilMs = undefined;
    quotaState.pauseReason = undefined;
  }
  if (quotaState.resetAtMs && now >= quotaState.resetAtMs) {
    quotaState.resetAtMs = undefined;
    quotaState.limit = undefined;
    quotaState.remaining = undefined;
  }
}

function resolvePauseUntil(now: number): number {
  if (quotaState.resetAtMs && quotaState.resetAtMs > now) return quotaState.resetAtMs;
  return now + SOFT_LIMIT_COOLDOWN_MS;
}

function pause(reason: "soft_limit" | "rate_limited"): void {
  const now = Date.now();
  quotaState.pausedUntilMs = resolvePauseUntil(now);
  quotaState.pauseReason = reason;
  quotaState.updatedAtMs = now;
}

export function checkScopusQuotaGate(): ScopusQuotaGateResult {
  const now = Date.now();
  clearPauseIfExpired(now);

  if (!quotaState.pausedUntilMs && shouldPause(quotaState.limit, quotaState.remaining)) {
    pause("soft_limit");
  }

  const blocked = !!quotaState.pausedUntilMs && now < quotaState.pausedUntilMs;
  if (blocked) {
    return {
      allowed: false,
      reason: quotaState.pauseReason === "rate_limited"
        ? "Scopus rate-limited (429). Waiting for reset."
        : `Scopus soft-limit reached (${Math.round(SOFT_LIMIT_PERCENT * 100)}%). Paused before hard limit.`,
      retryAtMs: quotaState.pausedUntilMs,
      state: { ...quotaState },
    };
  }

  return { allowed: true, state: { ...quotaState } };
}

export function updateScopusQuotaFromHeaders(headers: HeaderBag, status?: number): void {
  const now = Date.now();
  const limit = toInt(readHeader(headers, "x-ratelimit-limit"));
  const remaining = toInt(readHeader(headers, "x-ratelimit-remaining"));
  const resetAtMs = toEpochMs(readHeader(headers, "x-ratelimit-reset"));

  if (limit !== undefined) quotaState.limit = limit;
  if (remaining !== undefined) quotaState.remaining = remaining;
  if (resetAtMs !== undefined) quotaState.resetAtMs = resetAtMs;
  if (status !== undefined) quotaState.lastStatus = status;
  quotaState.updatedAtMs = now;

  clearPauseIfExpired(now);

  if (status === 429) {
    pause("rate_limited");
    return;
  }

  if (shouldPause(quotaState.limit, quotaState.remaining)) {
    pause("soft_limit");
    return;
  }

  // Auto-reopen when the quota moves away from the threshold.
  if (quotaState.pausedUntilMs && !shouldPause(quotaState.limit, quotaState.remaining)) {
    quotaState.pausedUntilMs = undefined;
    quotaState.pauseReason = undefined;
  }
}

export function getScopusQuotaGuardState(): ScopusQuotaGuardState {
  clearPauseIfExpired(Date.now());
  return { ...quotaState };
}

export function resetScopusQuotaGuardStateForTests(): void {
  quotaState.limit = undefined;
  quotaState.remaining = undefined;
  quotaState.resetAtMs = undefined;
  quotaState.pausedUntilMs = undefined;
  quotaState.pauseReason = undefined;
  quotaState.updatedAtMs = undefined;
  quotaState.lastStatus = undefined;
}
