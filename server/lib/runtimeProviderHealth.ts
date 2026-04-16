export type RuntimeProvider = "xai" | "gemini" | "openai" | "anthropic" | "deepseek";

export type RuntimeProviderSuppression = {
  kind: "auth_invalid";
  reason: string;
  since: number;
  until: number;
};

export const AUTH_INVALID_PROVIDER_TTL_MS = 15 * 60 * 1000;

const suppressionStore = new Map<RuntimeProvider, RuntimeProviderSuppression>();

function clearExpiredSuppressions(now = Date.now()): void {
  for (const [provider, record] of suppressionStore.entries()) {
    if (record.until <= now) {
      suppressionStore.delete(provider);
    }
  }
}

export function markRuntimeProviderAuthInvalid(
  provider: RuntimeProvider,
  reason: string,
  ttlMs = AUTH_INVALID_PROVIDER_TTL_MS,
): RuntimeProviderSuppression {
  const now = Date.now();
  const record: RuntimeProviderSuppression = {
    kind: "auth_invalid",
    reason: reason.trim().slice(0, 500) || "Provider authentication failed",
    since: now,
    until: now + Math.max(1_000, ttlMs),
  };
  suppressionStore.set(provider, record);
  return record;
}

export function clearRuntimeProviderSuppression(provider: RuntimeProvider): void {
  suppressionStore.delete(provider);
}

export function getRuntimeProviderSuppression(
  provider: RuntimeProvider,
): RuntimeProviderSuppression | null {
  clearExpiredSuppressions();
  return suppressionStore.get(provider) ?? null;
}

export function isRuntimeProviderSuppressed(provider: RuntimeProvider): boolean {
  return getRuntimeProviderSuppression(provider) !== null;
}

export function resetRuntimeProviderSuppressions(): void {
  suppressionStore.clear();
}
