/**
 * settingsService — per-user SearchBrain preferences.
 *
 * Two tiers:
 *   - Sync in-memory store (getSettings / updateSettings) — the Phase
 *     1b contract. Kept intact for backward compat and for unit tests
 *     that don't want to touch Postgres.
 *   - Async DB-backed store (getSettingsAsync / updateSettingsAsync)
 *     introduced in Phase 1c-3a. Persists to `user_search_brain_settings`.
 *     Falls back to the in-memory store when DATABASE_URL is unset
 *     (dev, tests) or when the Drizzle query errors out.
 *
 * Router uses the async path so settings survive process restarts.
 *
 * Settings:
 *   - mailto:                 polite-pool email (OpenAlex / CrossRef)
 *   - coreApiKey:             optional CORE key (free tier)
 *   - enableScrapingProviders opt-in for Scopus / WoS scrapers
 *
 * coreApiKey is stored verbatim; the router masks it on read.
 */

import { sql } from "drizzle-orm";
import { db as defaultDb } from "../../db";

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

// ─── Sync in-memory tier (backward-compat) ───────────────────────────────

const inMemoryStore = new Map<string, UserSearchBrainSettings>();

export function getSettings(userId: string | undefined): UserSearchBrainSettings {
  if (!userId) return { ...DEFAULTS };
  return { ...DEFAULTS, ...(inMemoryStore.get(userId) ?? {}) };
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
  const current = getSettings(userId);
  const { next, errors } = applyPatch(current, patch);
  if (errors.length > 0) return { ok: false, settings: current, errors };
  if (userId) inMemoryStore.set(userId, next);
  return { ok: true, settings: next, errors: [] };
}

export function __resetSettingsStore(): void {
  inMemoryStore.clear();
}

// ─── Async DB-backed tier ────────────────────────────────────────────────

export interface SettingsStore {
  get(userId: string): Promise<UserSearchBrainSettings | null>;
  upsert(userId: string, next: UserSearchBrainSettings): Promise<void>;
}

type DbLike = Pick<typeof defaultDb, "execute">;

interface RawSettingsRow {
  user_id: string;
  mailto: string | null;
  core_api_key: string | null;
  enable_scraping_providers: boolean;
  updated_at: string | Date;
}

export function makeDrizzleSettingsStore(dbInstance: DbLike): SettingsStore {
  return {
    async get(userId) {
      const rows = (await dbInstance.execute(sql/*sql*/`
        SELECT user_id, mailto, core_api_key, enable_scraping_providers, updated_at
        FROM user_search_brain_settings
        WHERE user_id = ${userId}
        LIMIT 1
      `)) as { rows?: RawSettingsRow[] } | RawSettingsRow[] | undefined;
      const raw = toRows(rows)[0];
      if (!raw) return null;
      const updatedAt = raw.updated_at instanceof Date ? raw.updated_at.getTime() : new Date(raw.updated_at).getTime();
      return {
        mailto: raw.mailto ?? undefined,
        coreApiKey: raw.core_api_key ?? undefined,
        enableScrapingProviders: Boolean(raw.enable_scraping_providers),
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
      };
    },
    async upsert(userId, next) {
      await dbInstance.execute(sql/*sql*/`
        INSERT INTO user_search_brain_settings
          (user_id, mailto, core_api_key, enable_scraping_providers, updated_at)
        VALUES
          (${userId}, ${next.mailto ?? null}, ${next.coreApiKey ?? null},
           ${next.enableScrapingProviders}, ${new Date(next.updatedAt).toISOString()})
        ON CONFLICT (user_id) DO UPDATE SET
          mailto = EXCLUDED.mailto,
          core_api_key = EXCLUDED.core_api_key,
          enable_scraping_providers = EXCLUDED.enable_scraping_providers,
          updated_at = EXCLUDED.updated_at
      `);
    },
  };
}

function toRows(x: { rows?: RawSettingsRow[] } | RawSettingsRow[] | undefined): RawSettingsRow[] {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  return x.rows ?? [];
}

let cachedDbStore: SettingsStore | null = null;
function defaultStore(): SettingsStore | null {
  if (!process.env.DATABASE_URL) return null;
  if (!cachedDbStore) cachedDbStore = makeDrizzleSettingsStore(defaultDb as unknown as DbLike);
  return cachedDbStore;
}

/** Test hook: clear the default-store memo so env changes take effect. */
export function __resetDbSettingsStore(): void {
  cachedDbStore = null;
}

export interface AsyncSettingsOptions {
  store?: SettingsStore;
}

/**
 * Async settings read. Tries the DB-backed store first; falls back to
 * in-memory when the store is absent or errors.
 */
export async function getSettingsAsync(
  userId: string | undefined,
  opts: AsyncSettingsOptions = {},
): Promise<UserSearchBrainSettings> {
  if (!userId) return { ...DEFAULTS };
  const store = opts.store ?? defaultStore();
  if (store) {
    try {
      const row = await store.get(userId);
      if (row) return row;
    } catch {
      // Degrade silently to in-memory so the request path never breaks.
    }
  }
  return { ...DEFAULTS, ...(inMemoryStore.get(userId) ?? {}) };
}

/**
 * Async settings write. Validates, then persists to the DB-backed
 * store if present; always mirrors into the in-memory store so
 * subsequent sync reads in the same process see the update even when
 * the DB later becomes unavailable.
 */
export async function updateSettingsAsync(
  userId: string | undefined,
  patch: SettingsPatch,
  opts: AsyncSettingsOptions = {},
): Promise<UpdateResult> {
  const current = await getSettingsAsync(userId, opts);
  const { next, errors } = applyPatch(current, patch);
  if (errors.length > 0) return { ok: false, settings: current, errors };
  if (!userId) return { ok: true, settings: next, errors: [] };
  inMemoryStore.set(userId, next);
  const store = opts.store ?? defaultStore();
  if (store) {
    try {
      await store.upsert(userId, next);
    } catch {
      // Persisted write failed. In-memory copy still reflects the
      // change; a future boot will read DEFAULTS but the router is
      // idempotent. Don't surface this as a validation error.
    }
  }
  return { ok: true, settings: next, errors: [] };
}

// ─── Shared patch application ────────────────────────────────────────────

function applyPatch(
  current: UserSearchBrainSettings,
  patch: SettingsPatch,
): { next: UserSearchBrainSettings; errors: string[] } {
  const errors: string[] = [];
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

  return { next, errors };
}

function isValidEmail(raw: string): boolean {
  if (typeof raw !== "string") return false;
  const s = raw.trim();
  if (s.length < 5 || s.length > 120) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export const SETTINGS_INTERNAL = { isValidEmail, DEFAULTS, applyPatch };
