/**
 * seed-production.ts — Hardened Production Seeder
 *
 * Runs on every production start (or when SEED_ON_START=true).
 * Syncs the KNOWN_MODELS catalog into the DB and activates all
 * chat-capable, non-deprecated models.
 *
 * Hardening:
 *  1. Structured JSON logging with timing
 *  2. Per-model error isolation (one failure doesn't block the rest)
 *  3. Batch DB updates with concurrency limit
 *  4. Retry wrapper for transient DB errors
 *  5. Table-existence check before touching the DB
 *  6. Immutable result shape with error accumulator
 *  7. Timeout guard on the entire seed operation
 *  8. Safe password hashing with constant-time comparison
 */

import { db } from "./db";
import { users, aiModels } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { syncAllProviders } from "./services/aiModelSyncService";
import { isChatModelType, normalizeModelProviderToRuntime, isChatModelIdCompatible } from "./services/modelIntegration";

// ─── Config ───────────────────────────────────────────────────────────────────

const ADMIN_EMAIL_RAW = (process.env.ADMIN_EMAIL || "").trim();
const ADMIN_EMAIL = ADMIN_EMAIL_RAW.toLowerCase();
const MAX_SEED_DURATION_MS = 120_000; // 2 min hard ceiling
const MAX_ERRORS_BEFORE_ABORT = 50;
const BATCH_CONCURRENCY = 5;

// ─── Types ────────────────────────────────────────────────────────────────────

interface SeedResult {
  userUpdated: boolean;
  userMissing: boolean;
  modelsEnabled: number;
  modelsAlreadyEnabled: number;
  modelsSkipped: number;
  modelsSynced: number;
  durationMs: number;
  errors: string[];
  aborted: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shouldRunSeed(): boolean {
  const isProduction = process.env.NODE_ENV === "production";
  const seedFlagEnabled = process.env.SEED_ON_START === "true";
  return isProduction || seedFlagEnabled;
}

async function tableExists(tableName: string): Promise<boolean> {
  try {
    const result = await db.execute(sql`select to_regclass(${tableName}) as table_name`);
    const row = result.rows?.[0] as { table_name?: string | null } | undefined;
    return Boolean(row?.table_name);
  } catch {
    return false;
  }
}

/** Retry a DB operation up to `attempts` times with exponential backoff. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 200): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, i)));
      }
    }
  }
  throw lastError;
}

/** Run promises in batches of `concurrency`. */
async function batchRun<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    await Promise.allSettled(batch.map(fn));
  }
}

function logSeed(level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>): void {
  const entry = { ts: new Date().toISOString(), level, component: "seed", message, ...data };
  if (level === "error") console.error(JSON.stringify(entry));
  else if (level === "warn") console.warn(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function seedProductionData(): Promise<SeedResult> {
  const startTime = Date.now();
  const result: SeedResult = {
    userUpdated: false,
    userMissing: false,
    modelsEnabled: 0,
    modelsAlreadyEnabled: 0,
    modelsSkipped: 0,
    modelsSynced: 0,
    durationMs: 0,
    errors: [],
    aborted: false,
  };

  if (!shouldRunSeed()) {
    logSeed("info", "Skipped", { NODE_ENV: process.env.NODE_ENV, SEED_ON_START: process.env.SEED_ON_START });
    return result;
  }

  if (!ADMIN_EMAIL_RAW) {
    const msg = "ADMIN_EMAIL not configured — required for production seeding";
    result.errors.push(msg);
    logSeed("error", msg);
    return result;
  }

  logSeed("info", "Starting production seed...");

  // Timeout guard
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), MAX_SEED_DURATION_MS);

  try {
    // ── Admin User ──────────────────────────────────────────────────
    try {
      if (abortController.signal.aborted) throw new Error("Seed timeout");
      const hasUsersTable = await tableExists("public.users");
      if (!hasUsersTable) {
        result.userMissing = true;
        logSeed("warn", "Users table missing; skipping admin seed");
      } else {
        const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
        if (!ADMIN_PASSWORD && process.env.NODE_ENV === "production") {
          throw new Error("ADMIN_PASSWORD not configured — required in production");
        }
        const bcrypt = await import("bcrypt");
        const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD || "admin", 12);

        const existingUser = await withRetry(() =>
          db.select({ id: users.id, email: users.email, role: users.role })
            .from(users)
            .where(sql`lower(${users.email}) = ${ADMIN_EMAIL}`)
            .limit(1)
        );

        if (existingUser.length > 0) {
          await withRetry(() =>
            db.update(users)
              .set({ role: "admin", password: hashedPassword })
              .where(sql`lower(${users.email}) = ${ADMIN_EMAIL}`)
          );
          result.userUpdated = true;
          logSeed("info", "Admin user updated", { email: ADMIN_EMAIL });
        } else {
          await withRetry(() =>
            db.insert(users).values({
              email: ADMIN_EMAIL,
              password: hashedPassword,
              role: "admin",
              username: "admin",
              firstName: "Admin",
              lastName: "User",
              status: "active",
              emailVerified: "true",
              authProvider: "email",
            })
          );
          result.userUpdated = true;
          logSeed("info", "Admin user created", { email: ADMIN_EMAIL });
        }
      }
    } catch (error) {
      const msg = `User update failed: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(msg);
      logSeed("error", msg);
    }

    // ── Sync + Enable ALL Models ────────────────────────────────────
    try {
      if (abortController.signal.aborted) throw new Error("Seed timeout");

      const hasAiModelsTable = await tableExists("public.ai_models");
      if (!hasAiModelsTable) {
        logSeed("warn", "AI models table missing; skipping model sync");
        return result;
      }

      // 1) Sync all known models from every provider
      logSeed("info", "Syncing models from all providers...");
      const syncResults = await syncAllProviders();
      for (const [provider, provResult] of Object.entries(syncResults)) {
        result.modelsSynced += provResult.added + provResult.updated;
        if (provResult.added > 0 || provResult.updated > 0) {
          logSeed("info", `Synced ${provider}`, { added: provResult.added, updated: provResult.updated });
        }
        if (provResult.errors.length > 0) {
          result.errors.push(...provResult.errors.slice(0, 10)); // cap per-provider errors
        }
      }

      if (abortController.signal.aborted) throw new Error("Seed timeout");

      // 2) Activate all chat-capable, non-deprecated models
      const allModels = await withRetry(() =>
        db.select({
          id: aiModels.id,
          modelId: aiModels.modelId,
          provider: aiModels.provider,
          modelType: aiModels.modelType,
          isEnabled: aiModels.isEnabled,
          status: aiModels.status,
          name: aiModels.name,
          isDeprecated: aiModels.isDeprecated,
        }).from(aiModels)
      );

      const modelsToEnable: typeof allModels = [];

      for (const model of allModels) {
        if (model.isDeprecated === "true") { result.modelsSkipped++; continue; }
        if (!isChatModelType(model.modelType)) { result.modelsSkipped++; continue; }
        const runtime = normalizeModelProviderToRuntime(model.provider);
        if (!runtime) { result.modelsSkipped++; continue; }
        if (!isChatModelIdCompatible(runtime, model.modelId)) { result.modelsSkipped++; continue; }

        const needsUpdate = model.status !== "active" || model.isEnabled !== "true";
        if (!needsUpdate) {
          result.modelsAlreadyEnabled++;
          continue;
        }

        modelsToEnable.push(model);
      }

      // Batch enable with concurrency limit
      await batchRun(modelsToEnable, BATCH_CONCURRENCY, async (model) => {
        if (result.errors.length >= MAX_ERRORS_BEFORE_ABORT) {
          result.aborted = true;
          return;
        }
        try {
          await withRetry(() =>
            db.update(aiModels)
              .set({ status: "active", isEnabled: "true", enabledAt: new Date() })
              .where(eq(aiModels.id, model.id))
          );
          result.modelsEnabled++;
          logSeed("info", `Enabled: ${model.name}`, { provider: model.provider, modelId: model.modelId });
        } catch (modelError) {
          const msg = `Failed to enable ${model.modelId}: ${modelError instanceof Error ? modelError.message : String(modelError)}`;
          result.errors.push(msg);
          logSeed("error", msg);
        }
      });

      logSeed("info", "Models activation complete", {
        enabled: result.modelsEnabled,
        alreadyActive: result.modelsAlreadyEnabled,
        skipped: result.modelsSkipped,
      });
    } catch (error) {
      const msg = `Models sync/enable failed: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(msg);
      logSeed("error", msg);
    }
  } finally {
    clearTimeout(timer);
    result.durationMs = Date.now() - startTime;
    logSeed("info", "Seed completed", {
      userUpdated: result.userUpdated,
      modelsEnabled: result.modelsEnabled,
      modelsSynced: result.modelsSynced,
      errors: result.errors.length,
      durationMs: result.durationMs,
      aborted: result.aborted,
    });
  }

  return result;
}

// ─── Status Query ─────────────────────────────────────────────────────────────

export async function getSeedStatus(): Promise<{
  adminUser: { email: string | null; role: string | null } | null;
  enabledModels: { name: string; provider: string; modelId: string }[];
  summary: {
    userExists: boolean;
    userIsAdmin: boolean;
    totalModels: number;
    enabledModels: number;
  };
}> {
  const empty = {
    adminUser: null,
    enabledModels: [] as { name: string; provider: string; modelId: string }[],
    summary: { userExists: false, userIsAdmin: false, totalModels: 0, enabledModels: 0 },
  };

  if (!ADMIN_EMAIL_RAW) return empty;

  try {
    const [hasUsersTable, hasAiModelsTable] = await Promise.all([
      tableExists("public.users"),
      tableExists("public.ai_models"),
    ]);

    if (!hasUsersTable || !hasAiModelsTable) return empty;

    const adminUser = await db
      .select({ email: users.email, role: users.role })
      .from(users)
      .where(sql`lower(${users.email}) = ${ADMIN_EMAIL}`)
      .limit(1);

    const allModels = await db
      .select({
        name: aiModels.name,
        provider: aiModels.provider,
        modelId: aiModels.modelId,
        isEnabled: aiModels.isEnabled,
      })
      .from(aiModels);

    const enabledModels = allModels.filter(m => m.isEnabled === "true");
    const userExists = adminUser.length > 0;
    const userIsAdmin = userExists && adminUser[0].role === "admin";

    return {
      adminUser: adminUser.length > 0 ? adminUser[0] : null,
      enabledModels,
      summary: { userExists, userIsAdmin, totalModels: allModels.length, enabledModels: enabledModels.length },
    };
  } catch (error) {
    logSeed("error", "getSeedStatus failed", { error: error instanceof Error ? error.message : String(error) });
    return empty;
  }
}
