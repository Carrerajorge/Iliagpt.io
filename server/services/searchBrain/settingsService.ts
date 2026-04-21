/**
 * settingsService — per-user SearchBrain preferences.
 *
 * Stored in-memory in this phase. DB-backed persistence will land
 * alongside the `search_brain_cache` pgvector migration. The in-memory
 * store is a deliberate Phase 1b trade-off: it lets us wire the full
 * UX contract (GET/POST /settings) without coupling this work to a
 * schema change.
 *
 * When the process restarts users lose their settings. That's
 * acceptable — the only three settings are:
 *   - mailto:        polite-pool email for OpenAlex / CrossRef
 *   - coreApiKey:    optional free key for CORE
 *   - enableScraping: opt-in toggle for Scopus / WoS scrapers
 *
 * All three have safe defaults and can be re-entered in a second.
 */

export interface UserSearchBrainSettings {
  mailto?: string;
  coreApiKey?: string;
  enableScrapingProviders: boolean;
  updatedAt: number;
}

const DEFAULTS: UserSearchBrainSettings = {
  enableScrapingProviders: false,
  updatedAt: 0,
};

const store = new Map<string, UserSearchBrainSettings>();

export function getSettings(userId: string | undefined): UserSearchBrainSettings {
  if (!userId) return { ...DEFAULTS };
  return { ...DEFAULTS, ...(store.get(userId) ?? {}) };
}

export interface SettingsPatch {
  mailto?: unknown;
  coreApiKey?: unknown;
  enableScrapingProviders?: unknown;
}

export interface UpdateResult {
  ok: boolean;
  settings: UserSearchBrainSettings;
  errors: string[];
}

export function updateSettings(userId: string | undefined, patch: SettingsPatch): UpdateResult {
  const errors: string[] = [];
  const current = getSettings(userId);
  const next: UserSearchBrainSettings = { ...current, updatedAt: Date.now() };

  if (patch.mailto !== undefined) {
    if (patch.mailto === null || patch.mailto === "") {
      next.mailto = undefined;
    } else if (typeof patch.mailto === "string" && isValidEmail(patch.mailto)) {
      next.mailto = patch.mailto.trim();
    } else {
      errors.push("mailto must be a valid email or null");
    }
  }

  if (patch.coreApiKey !== undefined) {
    if (patch.coreApiKey === null || patch.coreApiKey === "") {
      next.coreApiKey = undefined;
    } else if (typeof patch.coreApiKey === "string" && /^[A-Za-z0-9_-]{10,200}$/.test(patch.coreApiKey.trim())) {
      next.coreApiKey = patch.coreApiKey.trim();
    } else {
      errors.push("coreApiKey must be an alphanumeric token (10-200 chars) or null");
    }
  }

  if (patch.enableScrapingProviders !== undefined) {
    if (typeof patch.enableScrapingProviders === "boolean") {
      next.enableScrapingProviders = patch.enableScrapingProviders;
    } else {
      errors.push("enableScrapingProviders must be a boolean");
    }
  }

  if (errors.length > 0) {
    return { ok: false, settings: current, errors };
  }

  if (userId) {
    store.set(userId, next);
  }
  return { ok: true, settings: next, errors: [] };
}

/** Wipe all settings — test isolation helper. */
export function __resetSettingsStore(): void {
  store.clear();
}

function isValidEmail(raw: string): boolean {
  if (typeof raw !== "string") return false;
  const s = raw.trim();
  if (s.length < 5 || s.length > 120) return false;
  // Permissive email regex — accept most practical formats.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export const SETTINGS_INTERNAL = { isValidEmail, DEFAULTS };
