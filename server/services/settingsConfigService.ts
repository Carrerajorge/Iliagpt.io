import type { Request } from "express";
import { storage } from "../storage";

type SettingsSnapshot = {
  fetchedAt: string;
  updatedAt: string | null;
  map: Record<string, any>;
};

const SNAPSHOT_TTL_MS = 10_000;

// NOTE: Keep this in sync with `storage.seedDefaultSettings()` so the app still
// functions in degraded environments (e.g. DB unavailable).
const DEFAULT_SETTINGS_MAP: Record<string, any> = {
  // General
  app_name: "ILIAGPT",
  app_description: "AI Platform",
  support_email: "",
  timezone_default: "UTC",
  date_format: "YYYY-MM-DD",
  maintenance_mode: false,

  // Branding
  primary_color: "#6366f1",
  secondary_color: "#8b5cf6",
  theme_mode: "auto",

  // Users
  allow_registration: true,
  require_email_verification: false,
  session_timeout_minutes: 1440,

  // AI models
  default_model: "grok-4-1-fast-non-reasoning",
  max_tokens_per_request: 4096,
  enable_streaming: true,

  // Security
  max_login_attempts: 5,
  lockout_duration_minutes: 30,
  require_2fa_admins: false,

  // Notifications
  email_notifications_enabled: true,
  slack_webhook_url: "",
};

const PUBLIC_SETTING_KEYS = [
  // General
  "app_name",
  "app_description",
  "support_email",
  "timezone_default",
  "date_format",
  "maintenance_mode",

  // Branding (Removed to allow user override on client-side)
  // "primary_color",
  // "secondary_color",
  // "theme_mode",

  // Users
  "allow_registration",
  "require_email_verification",

  // AI models (client UX)
  "default_model",
  "max_tokens_per_request",
  "enable_streaming",

  // Notifications (client UX)
  "email_notifications_enabled",
] as const;

export type PublicSettingKey = (typeof PUBLIC_SETTING_KEYS)[number];

export type PublicSettings = Pick<typeof DEFAULT_SETTINGS_MAP, PublicSettingKey>;

let defaultsSeeded = false;
let snapshotCache: { expiresAt: number; snapshot: SettingsSnapshot } | null = null;

async function ensureDefaultsSeeded(): Promise<void> {
  if (defaultsSeeded) return;
  try {
    await storage.seedDefaultSettings();
    defaultsSeeded = true;
  } catch {
    // If DB is unavailable, we'll fall back to DEFAULT_SETTINGS_MAP.
    defaultsSeeded = true;
  }
}

export function invalidateSettingsCache(): void {
  snapshotCache = null;
}

export async function getSettingsSnapshot(): Promise<SettingsSnapshot> {
  await ensureDefaultsSeeded();

  const now = Date.now();
  if (snapshotCache && snapshotCache.expiresAt > now) {
    return snapshotCache.snapshot;
  }

  try {
    const settings = await storage.getSettingsConfig();
    const map: Record<string, any> = { ...DEFAULT_SETTINGS_MAP };

    let maxUpdatedAtMs = 0;
    for (const s of settings) {
      map[s.key] = s.value;

      const updatedAt = (s as any).updatedAt as Date | string | null | undefined;
      const updatedAtMs = updatedAt ? new Date(updatedAt as any).getTime() : 0;
      if (Number.isFinite(updatedAtMs) && updatedAtMs > maxUpdatedAtMs) {
        maxUpdatedAtMs = updatedAtMs;
      }
    }

    const snapshot: SettingsSnapshot = {
      fetchedAt: new Date().toISOString(),
      updatedAt: maxUpdatedAtMs ? new Date(maxUpdatedAtMs).toISOString() : null,
      map,
    };

    snapshotCache = { expiresAt: now + SNAPSHOT_TTL_MS, snapshot };
    return snapshot;
  } catch {
    return {
      fetchedAt: new Date().toISOString(),
      updatedAt: null,
      map: { ...DEFAULT_SETTINGS_MAP },
    };
  }
}

export async function getSettingValue<T = any>(key: string, fallback?: T): Promise<T> {
  const snapshot = await getSettingsSnapshot();
  const value = snapshot.map[key];
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    return (DEFAULT_SETTINGS_MAP[key] as T) ?? (undefined as unknown as T);
  }
  return value as T;
}

export async function getPublicSettings(): Promise<{
  settings: PublicSettings;
  meta: { fetchedAt: string; updatedAt: string | null };
}> {
  const snapshot = await getSettingsSnapshot();

  const settings = Object.fromEntries(
    PUBLIC_SETTING_KEYS.map((key) => [key, snapshot.map[key]])
  ) as PublicSettings;

  return {
    settings,
    meta: { fetchedAt: snapshot.fetchedAt, updatedAt: snapshot.updatedAt },
  };
}

export function getActorIdFromRequest(req: Request): string | null {
  const anyReq = req as any;
  const session = (req as any).session as any;

  return (
    anyReq.user?.claims?.sub ||
    anyReq.user?.id ||
    session?.authUserId ||
    session?.passport?.user?.claims?.sub ||
    session?.passport?.user?.id ||
    null
  );
}

export function getActorEmailFromRequest(req: Request): string | null {
  const anyReq = req as any;
  const session = (req as any).session as any;

  return (
    anyReq.user?.claims?.email ||
    anyReq.user?.email ||
    session?.passport?.user?.claims?.email ||
    session?.passport?.user?.email ||
    null
  );
}
