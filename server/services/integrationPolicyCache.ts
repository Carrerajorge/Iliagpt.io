import type { IntegrationPolicy } from "@shared/schema";

type CacheEntry = { value: IntegrationPolicy | null; expiresAt: number };

const TTL_MS = 10_000;
const cache = new Map<string, CacheEntry>();

function isCacheFresh(entry: CacheEntry | undefined): entry is CacheEntry {
  return !!entry && entry.expiresAt > Date.now();
}

export function invalidateIntegrationPolicyCache(userId: string): void {
  cache.delete(String(userId));
}

export function clearIntegrationPolicyCache(): void {
  cache.clear();
}

export async function getIntegrationPolicyCached(userId: string): Promise<IntegrationPolicy | null> {
  const key = String(userId || "");
  if (!key) return null;

  const cached = cache.get(key);
  if (isCacheFresh(cached)) return cached.value;

  try {
    // Dynamic import keeps this module safe in contexts where DB/env isn't configured (tests, tooling).
    const { storage } = await import("../storage");
    const policy = await storage.getIntegrationPolicy(key);
    cache.set(key, { value: policy, expiresAt: Date.now() + TTL_MS });
    return policy;
  } catch (err) {
    // Best-effort: if storage can't be loaded (missing env/DB), treat as no policy.
    return null;
  }
}

