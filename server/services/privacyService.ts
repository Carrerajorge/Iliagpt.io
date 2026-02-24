import { storage } from "../storage";

export type PrivacySettings = {
  trainingOptIn: boolean;
  remoteBrowserDataAccess: boolean;
};

const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  trainingOptIn: false,
  remoteBrowserDataAccess: false,
};

const PRIVACY_CACHE_TTL_MS = 30_000;

type CacheEntry = {
  value: PrivacySettings;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

export async function getUserPrivacySettings(userId: string): Promise<PrivacySettings> {
  const now = Date.now();
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > now) return cached.value;

  const settings = await storage.getUserSettings(userId);
  const privacy = settings?.privacySettings
    ? { ...DEFAULT_PRIVACY_SETTINGS, ...settings.privacySettings }
    : DEFAULT_PRIVACY_SETTINGS;

  const normalized: PrivacySettings = {
    trainingOptIn: Boolean((privacy as any).trainingOptIn),
    remoteBrowserDataAccess: Boolean((privacy as any).remoteBrowserDataAccess),
  };

  cache.set(userId, { value: normalized, expiresAt: now + PRIVACY_CACHE_TTL_MS });
  return normalized;
}

export function invalidateUserPrivacySettingsCache(userId: string): void {
  cache.delete(userId);
}

