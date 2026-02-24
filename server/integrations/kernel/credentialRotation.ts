/**
 * CredentialRotationScheduler -- Enterprise credential rotation with
 * exponential-backoff refresh, stale-token hygiene, and structured
 * JSON logging (no event-bus import to avoid circular deps).
 *
 * Lifecycle:
 *   1. Register rotation policies per connector
 *   2. `start()` spins a background interval (every 30 s)
 *   3. Each tick scans active credentials, refreshes those within
 *      the buffer window, and tracks failures per credential
 *   4. `stop()` clears the interval for graceful shutdown
 */

import type { ResolvedCredential } from "./types";

// ─── Types ─────────────────────────────────────────────────────────

export interface CredentialRotationPolicy {
  connectorId: string;
  /** How often the token needs rotating (default: 50 min for 1-hour tokens) */
  rotationIntervalMs: number;
  /** Begin refresh this many ms before expiry (default: 10 min) */
  refreshBufferMs: number;
  /** Max consecutive refresh retries before executing onFailure (default: 3) */
  maxRefreshRetries: number;
  /** Base delay for exponential backoff in ms (default: 2000) */
  backoffBaseMs: number;
  /** Action to take after all retries are exhausted */
  onFailure: "warn" | "revoke" | "notify";
}

export interface RotationStatus {
  lastRotated: Date | null;
  nextRotation: Date | null;
  consecutiveFailures: number;
  health: "healthy" | "degraded" | "failed";
}

export interface RotationMetrics {
  totalRotations: number;
  successfulRotations: number;
  failedRotations: number;
  avgRotationTimeMs: number;
}

// ─── Internal bookkeeping per credential ───────────────────────────

interface CredentialState {
  connectorId: string;
  userId: string;
  accountId: string;
  lastRotated: Date | null;
  nextRotation: Date | null;
  consecutiveFailures: number;
  /** Timestamp of last failed attempt -- used for back-off gating */
  lastFailedAt: number | null;
}

const DEFAULT_POLICY: Omit<CredentialRotationPolicy, "connectorId"> = {
  rotationIntervalMs: 50 * 60_000,   // 50 minutes
  refreshBufferMs: 10 * 60_000,      // 10 minutes
  maxRefreshRetries: 3,
  backoffBaseMs: 2_000,
  onFailure: "warn",
};

const TICK_INTERVAL_MS = 30_000; // 30 seconds

// ─── Structured log helper ─────────────────────────────────────────

function structuredLog(
  level: "info" | "warn" | "error",
  event: string,
  data: Record<string, unknown>,
): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component: "CredentialRotation",
    event,
    ...data,
  };
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else if (level === "warn") {
    console.warn(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

// ─── CredentialRotationScheduler ───────────────────────────────────

export class CredentialRotationScheduler {
  private policies = new Map<string, CredentialRotationPolicy>();
  /** Key: `${connectorId}::${userId}` */
  private states = new Map<string, CredentialState>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  // Metrics accumulators
  private _totalRotations = 0;
  private _successfulRotations = 0;
  private _failedRotations = 0;
  private _totalRotationTimeMs = 0;

  // ─── Policy management ───────────────────────────────────────────

  /** Register a rotation policy for a connector. */
  registerPolicy(policy: Partial<CredentialRotationPolicy> & { connectorId: string }): void {
    const merged: CredentialRotationPolicy = {
      ...DEFAULT_POLICY,
      ...policy,
    };
    this.policies.set(merged.connectorId, merged);
    structuredLog("info", "policy_registered", {
      connectorId: merged.connectorId,
      rotationIntervalMs: merged.rotationIntervalMs,
      refreshBufferMs: merged.refreshBufferMs,
      onFailure: merged.onFailure,
    });
  }

  // ─── Lifecycle ───────────────────────────────────────────────────

  /** Start the background rotation loop (every 30 s). */
  start(): void {
    if (this.running) return;
    this.running = true;
    structuredLog("info", "scheduler_started", {});
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        structuredLog("error", "tick_error", { error: String(err) });
      });
    }, TICK_INTERVAL_MS);
    // Unref so the timer does not keep the process alive during shutdown
    if (this.timer && typeof this.timer === "object" && "unref" in this.timer) {
      (this.timer as NodeJS.Timeout).unref();
    }
  }

  /** Graceful shutdown -- clears the interval and marks stopped. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    structuredLog("info", "scheduler_stopped", {});
  }

  // ─── Status queries ──────────────────────────────────────────────

  getRotationStatus(connectorId: string, userId: string): RotationStatus {
    const key = `${connectorId}::${userId}`;
    const state = this.states.get(key);
    if (!state) {
      return {
        lastRotated: null,
        nextRotation: null,
        consecutiveFailures: 0,
        health: "healthy",
      };
    }
    return {
      lastRotated: state.lastRotated,
      nextRotation: state.nextRotation,
      consecutiveFailures: state.consecutiveFailures,
      health: this.deriveHealth(state),
    };
  }

  getAllStatuses(): Map<string, RotationStatus> {
    const result = new Map<string, RotationStatus>();
    for (const [key, state] of this.states.entries()) {
      result.set(key, {
        lastRotated: state.lastRotated,
        nextRotation: state.nextRotation,
        consecutiveFailures: state.consecutiveFailures,
        health: this.deriveHealth(state),
      });
    }
    return result;
  }

  getMetrics(): RotationMetrics {
    return {
      totalRotations: this._totalRotations,
      successfulRotations: this._successfulRotations,
      failedRotations: this._failedRotations,
      avgRotationTimeMs:
        this._successfulRotations > 0
          ? Math.round(this._totalRotationTimeMs / this._successfulRotations)
          : 0,
    };
  }

  // ─── Force rotation ──────────────────────────────────────────────

  /** Immediately attempt rotation for a specific credential. */
  async forceRotation(connectorId: string, userId: string): Promise<boolean> {
    structuredLog("info", "force_rotation_requested", { connectorId, userId });
    return this.rotateCredential(connectorId, userId);
  }

  // ─── Token hygiene ───────────────────────────────────────────────

  /** Returns age of the current token and days since last rotation. */
  auditTokenAge(
    connectorId: string,
    userId: string,
  ): { tokenAgeMs: number; daysSinceRotation: number | null } {
    const key = `${connectorId}::${userId}`;
    const state = this.states.get(key);
    if (!state || !state.lastRotated) {
      return { tokenAgeMs: 0, daysSinceRotation: null };
    }
    const ageMs = Date.now() - state.lastRotated.getTime();
    return {
      tokenAgeMs: ageMs,
      daysSinceRotation: ageMs / (24 * 60 * 60_000),
    };
  }

  /** Return list of credentials not rotated in `maxAgeDays` days. */
  detectStaleTokens(maxAgeDays = 30): Array<{ connectorId: string; userId: string; daysSinceRotation: number }> {
    const stale: Array<{ connectorId: string; userId: string; daysSinceRotation: number }> = [];
    const maxAgeMs = maxAgeDays * 24 * 60 * 60_000;
    const now = Date.now();

    for (const state of this.states.values()) {
      if (!state.lastRotated) {
        // Never rotated -- treat as infinitely stale
        stale.push({
          connectorId: state.connectorId,
          userId: state.userId,
          daysSinceRotation: Infinity,
        });
        continue;
      }
      const age = now - state.lastRotated.getTime();
      if (age > maxAgeMs) {
        stale.push({
          connectorId: state.connectorId,
          userId: state.userId,
          daysSinceRotation: age / (24 * 60 * 60_000),
        });
      }
    }

    return stale;
  }

  /** Auto-revoke extremely old tokens (default: 90 days without rotation). */
  async revokeStaleTokens(maxAgeDays = 90): Promise<number> {
    const stale = this.detectStaleTokens(maxAgeDays);
    let revokedCount = 0;

    for (const entry of stale) {
      try {
        // Lazy import to avoid circular dependency at module load time
        const { credentialVault } = await import("./credentialVault");
        await credentialVault.revoke(entry.userId, entry.connectorId);
        revokedCount++;

        structuredLog("warn", "stale_token_revoked", {
          connectorId: entry.connectorId,
          userId: entry.userId,
          daysSinceRotation: Math.round(entry.daysSinceRotation),
        });

        // Clean up local state
        const key = `${entry.connectorId}::${entry.userId}`;
        this.states.delete(key);
      } catch (err) {
        structuredLog("error", "stale_token_revoke_failed", {
          connectorId: entry.connectorId,
          userId: entry.userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return revokedCount;
  }

  // ─── Core tick logic ─────────────────────────────────────────────

  /** Single tick: scan all active credentials and refresh those near expiry. */
  private async tick(): Promise<void> {
    if (!this.running) return;

    // Load active credentials from DB
    let accounts: ActiveAccount[];
    try {
      accounts = await this.loadActiveAccounts();
    } catch (err) {
      structuredLog("error", "load_accounts_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const now = Date.now();

    for (const acct of accounts) {
      const policy = this.policies.get(acct.connectorId);
      if (!policy) continue; // No rotation policy for this connector

      const key = `${acct.connectorId}::${acct.userId}`;

      // Ensure state entry exists
      if (!this.states.has(key)) {
        this.states.set(key, {
          connectorId: acct.connectorId,
          userId: acct.userId,
          accountId: acct.accountId,
          lastRotated: null,
          nextRotation: null,
          consecutiveFailures: 0,
          lastFailedAt: null,
        });
      }
      const state = this.states.get(key)!;
      state.accountId = acct.accountId;

      // Skip if no refresh token (API-key based connectors)
      if (!acct.hasRefreshToken) continue;

      // Compute whether refresh is needed
      const expiresAt = acct.expiresAtMs;
      if (expiresAt === null) continue; // No expiry info

      const timeUntilExpiry = expiresAt - now;

      if (timeUntilExpiry > policy.refreshBufferMs) {
        // Token still fresh -- update next rotation estimate
        state.nextRotation = new Date(expiresAt - policy.refreshBufferMs);
        continue;
      }

      // Back-off gate: if we failed recently, check whether enough time has passed
      if (state.lastFailedAt !== null && state.consecutiveFailures > 0) {
        const jitter = Math.random() * 0.3 + 0.85; // 0.85 - 1.15
        const backoff =
          policy.backoffBaseMs *
          Math.pow(2, Math.min(state.consecutiveFailures - 1, 6)) *
          jitter;
        if (now - state.lastFailedAt < backoff) {
          continue; // Still in back-off window
        }
      }

      // Check if retries are exhausted
      if (state.consecutiveFailures >= policy.maxRefreshRetries) {
        await this.executeOnFailure(policy, state);
        continue;
      }

      // Attempt refresh
      await this.rotateCredential(acct.connectorId, acct.userId);
    }
  }

  /** Attempt a single credential rotation. Returns true on success. */
  private async rotateCredential(connectorId: string, userId: string): Promise<boolean> {
    const key = `${connectorId}::${userId}`;
    const policy = this.policies.get(connectorId);
    if (!policy) {
      structuredLog("warn", "rotation_skipped_no_policy", { connectorId, userId });
      return false;
    }

    // Ensure state entry exists
    if (!this.states.has(key)) {
      this.states.set(key, {
        connectorId,
        userId,
        accountId: "",
        lastRotated: null,
        nextRotation: null,
        consecutiveFailures: 0,
        lastFailedAt: null,
      });
    }
    const state = this.states.get(key)!;

    const startMs = Date.now();
    this._totalRotations++;

    try {
      // Use credentialVault.resolve() which auto-refreshes near-expiry tokens
      const { credentialVault } = await import("./credentialVault");
      const resolved = await credentialVault.resolve(userId, connectorId);

      if (!resolved) {
        // Credential not found or inactive -- nothing to rotate
        structuredLog("warn", "rotation_no_credential", { connectorId, userId });
        this._failedRotations++;
        return false;
      }

      // Verify the token actually got refreshed by checking its expiry
      // If resolve() refreshed it, expiresAt should be well into the future
      const now = Date.now();
      if (resolved.expiresAt && resolved.expiresAt.getTime() - now < policy.refreshBufferMs / 2) {
        // Token is still near expiry after resolve -- refresh likely failed silently
        throw new Error("Token still near expiry after refresh attempt");
      }

      // Success
      const durationMs = Date.now() - startMs;
      state.lastRotated = new Date();
      state.nextRotation = resolved.expiresAt
        ? new Date(resolved.expiresAt.getTime() - policy.refreshBufferMs)
        : new Date(now + policy.rotationIntervalMs);
      state.consecutiveFailures = 0;
      state.lastFailedAt = null;

      this._successfulRotations++;
      this._totalRotationTimeMs += durationMs;

      structuredLog("info", "rotation_success", {
        connectorId,
        userId,
        durationMs,
        nextRotation: state.nextRotation.toISOString(),
      });

      return true;
    } catch (err) {
      const durationMs = Date.now() - startMs;
      state.consecutiveFailures++;
      state.lastFailedAt = Date.now();
      this._failedRotations++;

      structuredLog("warn", "rotation_failed", {
        connectorId,
        userId,
        durationMs,
        consecutiveFailures: state.consecutiveFailures,
        maxRetries: policy.maxRefreshRetries,
        error: err instanceof Error ? err.message : String(err),
      });

      // If retries exhausted, execute onFailure now
      if (state.consecutiveFailures >= policy.maxRefreshRetries) {
        await this.executeOnFailure(policy, state);
      }

      return false;
    }
  }

  // ─── Failure handling ────────────────────────────────────────────

  private async executeOnFailure(
    policy: CredentialRotationPolicy,
    state: CredentialState,
  ): Promise<void> {
    const { connectorId, userId, consecutiveFailures } = state;

    switch (policy.onFailure) {
      case "revoke": {
        try {
          const { credentialVault } = await import("./credentialVault");
          await credentialVault.revoke(userId, connectorId);
          structuredLog("warn", "credential_revoked_after_failures", {
            connectorId,
            userId,
            consecutiveFailures,
          });
          this.states.delete(`${connectorId}::${userId}`);
        } catch (err) {
          structuredLog("error", "revoke_after_failure_error", {
            connectorId,
            userId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        break;
      }

      case "notify": {
        structuredLog("error", "credential_rotation_exhausted_notify", {
          connectorId,
          userId,
          consecutiveFailures,
          action: "notify",
          message: `Credential rotation for ${connectorId} (user ${userId}) exhausted all ${policy.maxRefreshRetries} retries. Manual intervention required.`,
        });
        break;
      }

      case "warn":
      default: {
        structuredLog("warn", "credential_rotation_exhausted_warn", {
          connectorId,
          userId,
          consecutiveFailures,
          action: "warn",
        });
        break;
      }
    }
  }

  // ─── DB interaction ──────────────────────────────────────────────

  private async loadActiveAccounts(): Promise<ActiveAccount[]> {
    try {
      const { db } = await import("../../db");
      const { integrationAccounts } = await import("../../../shared/schema/integration");
      const { eq } = await import("drizzle-orm");

      const rows = await db
        .select({
          id: integrationAccounts.id,
          userId: integrationAccounts.userId,
          providerId: integrationAccounts.providerId,
          refreshToken: integrationAccounts.refreshToken,
          tokenExpiresAt: integrationAccounts.tokenExpiresAt,
        })
        .from(integrationAccounts)
        .where(eq(integrationAccounts.status, "active"));

      return rows.map((r) => ({
        accountId: r.id,
        userId: r.userId,
        connectorId: r.providerId,
        hasRefreshToken: !!r.refreshToken,
        expiresAtMs: r.tokenExpiresAt ? new Date(r.tokenExpiresAt).getTime() : null,
      }));
    } catch {
      // DB not ready yet (startup race) -- return empty
      return [];
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  private deriveHealth(state: CredentialState): "healthy" | "degraded" | "failed" {
    if (state.consecutiveFailures === 0) return "healthy";
    const policy = this.policies.get(state.connectorId);
    const maxRetries = policy?.maxRefreshRetries ?? DEFAULT_POLICY.maxRefreshRetries;
    if (state.consecutiveFailures >= maxRetries) return "failed";
    return "degraded";
  }
}

// ─── Active account shape (internal) ───────────────────────────────

interface ActiveAccount {
  accountId: string;
  userId: string;
  connectorId: string;
  hasRefreshToken: boolean;
  expiresAtMs: number | null;
}

// ─── Singleton ─────────────────────────────────────────────────────

export const credentialRotation = new CredentialRotationScheduler();
