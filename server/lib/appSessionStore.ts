import session from "express-session";
import connectPgSimple from "connect-pg-simple";

import { pool } from "../db";

export const APP_SESSION_COOKIE_NAME = "siragpt.sid";
export const APP_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export type AppSessionStoreMode = "memory" | "postgres";

type AppSessionStore = session.Store & {
  close?: () => void;
  pruneSessions?: (callback?: (err: Error) => void) => void;
};

const PG_STORE_TTL_SECONDS = Math.floor(APP_SESSION_TTL_MS / 1000);
const PgStore = connectPgSimple(session);

let cachedStore: AppSessionStore | null = null;
let cachedMode: AppSessionStoreMode | null = null;

function getStoreErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "";
  }

  const directCode = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const cause =
    "cause" in error && typeof (error as { cause?: unknown }).cause === "object"
      ? ((error as { cause?: { code?: unknown } }).cause?.code ?? "")
      : "";

  return String(directCode || cause || "").trim().toLowerCase();
}

function normalizeStoreMode(value?: string | null): AppSessionStoreMode | null {
  const mode = String(value || "").trim().toLowerCase();
  if (!mode) return null;
  if (["memory", "mem", "inmemory", "in-memory"].includes(mode)) {
    return "memory";
  }
  if (["postgres", "pg", "database", "db"].includes(mode)) {
    return "postgres";
  }
  return null;
}

function resolveDefaultStoreMode(): AppSessionStoreMode {
  const explicitMode = normalizeStoreMode(process.env.SESSION_STORE_MODE);
  if (explicitMode) {
    return explicitMode;
  }

  const isProduction =
    process.env.NODE_ENV === "production" ||
    String(process.env.REPLIT_DEPLOYMENT || "").toLowerCase() === "true" ||
    Boolean(process.env.REPL_SLUG);

  return isProduction ? "postgres" : "memory";
}

export function shouldTreatStoreErrorAsMiss(error: unknown): boolean {
  const code = getStoreErrorCode(error);
  if (
    [
      "28p01",
      "57p01",
      "57p02",
      "57p03",
      "08001",
      "08006",
      "53300",
      "53400",
    ].includes(code)
  ) {
    return true;
  }

  const message = String(
    error instanceof Error ? error.message : error || "",
  ).toLowerCase();

  return [
    "password authentication failed",
    "connection terminated unexpectedly",
    "the database system is starting up",
    "remaining connection slots are reserved",
    "terminating connection due to administrator command",
    "timeout",
    "connect econnrefused",
    "connect etimedout",
    "socket hang up",
    "server closed the connection unexpectedly",
    "unexpected token",
    "invalid input syntax",
    "json",
    "not found in row",
    "corrupt",
  ].some((pattern) => message.includes(pattern));
}

function createMemoryStore(): AppSessionStore {
  return new session.MemoryStore() as AppSessionStore;
}

function createPostgresStore(): AppSessionStore {
  const store = new PgStore({
    pool,
    tableName: "sessions",
    createTableIfMissing: true,
    ttl: PG_STORE_TTL_SECONDS,
    pruneSessionInterval: 60 * 15,
    errorLog: (...args: unknown[]) => {
      console.warn("[appSessionStore] postgres store warning:", ...args);
    },
  }) as AppSessionStore;

  const originalGet = store.get.bind(store);
  store.get = (sid, callback) => {
    originalGet(sid, (error, sessionData) => {
      if (error && shouldTreatStoreErrorAsMiss(error)) {
        console.warn(
          "[appSessionStore] Session store read degraded; treating it as a cache miss.",
        );
        callback?.(null, null);
        return;
      }

      callback?.(error, sessionData);
    });
  };

  const originalTouch = typeof store.touch === "function" ? store.touch.bind(store) : null;
  if (originalTouch) {
    store.touch = (sid, sessionData, callback) => {
      originalTouch(sid, sessionData, (error) => {
        if (error && shouldTreatStoreErrorAsMiss(error)) {
          console.warn(
            "[appSessionStore] Session store touch degraded; skipping rolling update.",
          );
          callback?.(null);
          return;
        }

        callback?.(error as Error | null | undefined);
      });
    };
  }

  return store;
}

export function getAppSessionStoreMode(): AppSessionStoreMode {
  if (cachedMode) {
    return cachedMode;
  }

  cachedMode = resolveDefaultStoreMode();
  return cachedMode;
}

export function getAppSessionStore(): AppSessionStore {
  if (cachedStore) {
    return cachedStore;
  }

  const mode = getAppSessionStoreMode();

  if (mode === "postgres") {
    try {
      cachedStore = createPostgresStore();
      return cachedStore;
    } catch (error) {
      const isProduction =
        process.env.NODE_ENV === "production" || Boolean(process.env.REPL_SLUG);
      if (isProduction) {
        throw error;
      }

      console.warn(
        "[appSessionStore] Falling back to memory store because postgres session store could not be initialized:",
        error,
      );
      cachedMode = "memory";
    }
  }

  cachedStore = createMemoryStore();
  return cachedStore;
}
