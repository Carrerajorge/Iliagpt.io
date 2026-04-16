import type { UserSettings } from "@shared/schema";

type CacheEntry = { value: UserSettings | null; expiresAt: number };

// Short TTL to keep behavior responsive after a settings toggle, while avoiding
// a DB fetch on every tool call in agent mode.
const TTL_MS = 10_000;
const cache = new Map<string, CacheEntry>();

function isFresh(entry: CacheEntry | undefined): entry is CacheEntry {
  return !!entry && entry.expiresAt > Date.now();
}

export function invalidateUserSettingsCache(userId: string): void {
  cache.delete(String(userId || ""));
}

export function clearUserSettingsCache(): void {
  cache.clear();
}

export async function getUserSettingsCached(userId: string): Promise<UserSettings | null> {
  const key = String(userId || "").trim();
  if (!key || key === "anonymous") return null;

  const cached = cache.get(key);
  if (isFresh(cached)) return cached.value;

  try {
    // Dynamic import keeps this module safe in contexts where DB/env isn't configured (tests, tooling).
    const { storage } = await import("../storage");
    const value = await storage.getUserSettings(key);
    cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
    return value;
  } catch {
    return null;
  }
}

