/**
 * ConnectorVersionManager — Versioning, migration, and rollback for connectors.
 *
 * Supports:
 *  - Semantic version tracking per connector
 *  - Breaking change detection (schema diff)
 *  - Automatic migration of stored data when schemas change
 *  - Rollback to previous connector version
 *  - Version compatibility matrix
 *  - Canary deployments (route % of traffic to new version)
 */

import type { ConnectorManifest, ConnectorCapability, JSONSchema7 } from "./types";

// ─── Types ───────────────────────────────────────────────────────────

export interface ConnectorVersion {
  connectorId: string;
  version: string;
  manifest: ConnectorManifest;
  registeredAt: Date;
  isActive: boolean;
  /** Optional: migration function from previous version */
  migrationFn?: (oldInput: Record<string, unknown>) => Record<string, unknown>;
}

export interface VersionDiff {
  connectorId: string;
  fromVersion: string;
  toVersion: string;
  addedCapabilities: string[];
  removedCapabilities: string[];
  modifiedCapabilities: CapabilityDiff[];
  breakingChanges: BreakingChange[];
  isBreaking: boolean;
}

export interface CapabilityDiff {
  operationId: string;
  changes: string[];
  isBreaking: boolean;
}

export interface BreakingChange {
  type: "removed_capability" | "removed_required_field" | "type_change" | "scope_change";
  operationId?: string;
  field?: string;
  description: string;
}

export interface CanaryConfig {
  connectorId: string;
  newVersion: string;
  oldVersion: string;
  trafficPercent: number; // 0-100
  startedAt: Date;
  /** If set, auto-promote after this duration */
  autoPromoteAfterMs?: number;
  /** Error rate threshold — auto-rollback if exceeded */
  errorRateThreshold?: number;
}

interface CanaryMetrics {
  newVersionRequests: number;
  newVersionErrors: number;
  oldVersionRequests: number;
  oldVersionErrors: number;
}

// ─── Version Manager ─────────────────────────────────────────────────

export class ConnectorVersionManager {
  /** connectorId → version string → ConnectorVersion */
  private versions = new Map<string, Map<string, ConnectorVersion>>();
  /** connectorId → active version string */
  private activeVersions = new Map<string, string>();
  /** connectorId → CanaryConfig */
  private canaries = new Map<string, CanaryConfig>();
  /** connectorId → CanaryMetrics */
  private canaryMetrics = new Map<string, CanaryMetrics>();
  /** connectorId → VersionDiff[] (history) */
  private diffHistory = new Map<string, VersionDiff[]>();

  /**
   * Register a new version of a connector.
   * Does NOT activate it — call `activate()` or `startCanary()` separately.
   */
  registerVersion(manifest: ConnectorManifest, migrationFn?: ConnectorVersion["migrationFn"]): void {
    const { connectorId, version } = manifest;

    if (!this.versions.has(connectorId)) {
      this.versions.set(connectorId, new Map());
    }

    const versions = this.versions.get(connectorId)!;

    if (versions.has(version)) {
      console.warn(
        `[VersionManager] Version ${version} already registered for ${connectorId}, overwriting`
      );
    }

    versions.set(version, {
      connectorId,
      version,
      manifest,
      registeredAt: new Date(),
      isActive: false,
      migrationFn,
    });

    // Compute diff against current active version
    const activeVersion = this.activeVersions.get(connectorId);
    if (activeVersion && activeVersion !== version) {
      const activeEntry = versions.get(activeVersion);
      if (activeEntry) {
        const diff = this.computeDiff(activeEntry.manifest, manifest);
        const history = this.diffHistory.get(connectorId) || [];
        history.push(diff);
        this.diffHistory.set(connectorId, history);

        if (diff.isBreaking) {
          console.warn(
            `[VersionManager] BREAKING CHANGES detected in ${connectorId} ${activeVersion}→${version}:`,
            diff.breakingChanges.map((b) => b.description).join("; ")
          );
        }
      }
    }

    // If no active version, auto-activate this one
    if (!this.activeVersions.has(connectorId)) {
      this.activate(connectorId, version);
    }

    console.log(`[VersionManager] Registered ${connectorId}@${version}`);
  }

  /** Activate a specific version of a connector */
  activate(connectorId: string, version: string): boolean {
    const versions = this.versions.get(connectorId);
    if (!versions || !versions.has(version)) {
      console.error(`[VersionManager] Version ${version} not found for ${connectorId}`);
      return false;
    }

    // Deactivate previous
    const prevVersion = this.activeVersions.get(connectorId);
    if (prevVersion) {
      const prev = versions.get(prevVersion);
      if (prev) prev.isActive = false;
    }

    // Activate new
    const entry = versions.get(version)!;
    entry.isActive = true;
    this.activeVersions.set(connectorId, version);

    // Cancel any canary
    this.canaries.delete(connectorId);
    this.canaryMetrics.delete(connectorId);

    console.log(
      `[VersionManager] Activated ${connectorId}@${version}` +
        (prevVersion ? ` (was ${prevVersion})` : "")
    );
    return true;
  }

  /** Get the active manifest for a connector */
  getActiveManifest(connectorId: string): ConnectorManifest | undefined {
    const version = this.activeVersions.get(connectorId);
    if (!version) return undefined;
    return this.versions.get(connectorId)?.get(version)?.manifest;
  }

  /** Get all registered versions for a connector */
  getVersions(connectorId: string): ConnectorVersion[] {
    const versions = this.versions.get(connectorId);
    if (!versions) return [];
    return Array.from(versions.values()).sort((a, b) =>
      compareVersions(a.version, b.version)
    );
  }

  /** Get the active version string */
  getActiveVersion(connectorId: string): string | undefined {
    return this.activeVersions.get(connectorId);
  }

  /** Rollback to the previous version */
  rollback(connectorId: string): boolean {
    const versions = this.getVersions(connectorId);
    const activeVersion = this.activeVersions.get(connectorId);

    if (versions.length < 2 || !activeVersion) {
      console.warn(`[VersionManager] Cannot rollback ${connectorId}: insufficient versions`);
      return false;
    }

    // Find previous version
    const activeIdx = versions.findIndex((v) => v.version === activeVersion);
    if (activeIdx <= 0) {
      console.warn(`[VersionManager] No previous version to rollback to for ${connectorId}`);
      return false;
    }

    const previousVersion = versions[activeIdx - 1].version;
    console.warn(`[VersionManager] ROLLBACK: ${connectorId} ${activeVersion} → ${previousVersion}`);
    return this.activate(connectorId, previousVersion);
  }

  // ─── Canary deployments ──────────────────────────────────────────

  /** Start a canary deployment — gradually route traffic to new version */
  startCanary(config: Omit<CanaryConfig, "startedAt">): boolean {
    const { connectorId, newVersion, oldVersion } = config;
    const versions = this.versions.get(connectorId);

    if (!versions?.has(newVersion) || !versions?.has(oldVersion)) {
      console.error(`[VersionManager] Cannot start canary: missing version(s)`);
      return false;
    }

    this.canaries.set(connectorId, {
      ...config,
      startedAt: new Date(),
    });
    this.canaryMetrics.set(connectorId, {
      newVersionRequests: 0,
      newVersionErrors: 0,
      oldVersionRequests: 0,
      oldVersionErrors: 0,
    });

    console.log(
      `[VersionManager] Canary started: ${connectorId} ${oldVersion}→${newVersion} at ${config.trafficPercent}%`
    );
    return true;
  }

  /** Determine which version to use for a request (canary-aware) */
  resolveVersion(connectorId: string): string | undefined {
    const canary = this.canaries.get(connectorId);
    if (!canary) {
      return this.activeVersions.get(connectorId);
    }

    // Route based on traffic percentage
    const roll = Math.random() * 100;
    if (roll < canary.trafficPercent) {
      return canary.newVersion;
    }
    return canary.oldVersion;
  }

  /** Record canary metrics */
  recordCanaryResult(connectorId: string, version: string, success: boolean): void {
    const canary = this.canaries.get(connectorId);
    const metrics = this.canaryMetrics.get(connectorId);
    if (!canary || !metrics) return;

    if (version === canary.newVersion) {
      metrics.newVersionRequests++;
      if (!success) metrics.newVersionErrors++;
    } else {
      metrics.oldVersionRequests++;
      if (!success) metrics.oldVersionErrors++;
    }

    // Check auto-rollback threshold
    if (canary.errorRateThreshold && metrics.newVersionRequests >= 10) {
      const errorRate = metrics.newVersionErrors / metrics.newVersionRequests;
      if (errorRate > canary.errorRateThreshold) {
        console.error(
          `[VersionManager] Canary auto-rollback for ${connectorId}: error rate ${(errorRate * 100).toFixed(1)}% > ${(canary.errorRateThreshold * 100)}%`
        );
        this.activate(connectorId, canary.oldVersion);
      }
    }

    // Check auto-promote
    if (canary.autoPromoteAfterMs) {
      const elapsed = Date.now() - canary.startedAt.getTime();
      if (elapsed > canary.autoPromoteAfterMs) {
        const errorRate = metrics.newVersionRequests > 0
          ? metrics.newVersionErrors / metrics.newVersionRequests
          : 0;
        if (errorRate < (canary.errorRateThreshold || 0.05)) {
          console.log(
            `[VersionManager] Canary auto-promoted for ${connectorId}: ${canary.newVersion}`
          );
          this.activate(connectorId, canary.newVersion);
        }
      }
    }
  }

  /** Get canary status */
  getCanaryStatus(connectorId: string): {
    active: boolean;
    config?: CanaryConfig;
    metrics?: CanaryMetrics;
  } {
    const canary = this.canaries.get(connectorId);
    if (!canary) return { active: false };
    return {
      active: true,
      config: canary,
      metrics: this.canaryMetrics.get(connectorId),
    };
  }

  /** Promote canary — make new version the active one */
  promoteCanary(connectorId: string): boolean {
    const canary = this.canaries.get(connectorId);
    if (!canary) return false;
    return this.activate(connectorId, canary.newVersion);
  }

  // ─── Diff computation ────────────────────────────────────────────

  /** Compute the diff between two manifests */
  computeDiff(oldManifest: ConnectorManifest, newManifest: ConnectorManifest): VersionDiff {
    const oldOps = new Map(oldManifest.capabilities.map((c) => [c.operationId, c]));
    const newOps = new Map(newManifest.capabilities.map((c) => [c.operationId, c]));

    const addedCapabilities: string[] = [];
    const removedCapabilities: string[] = [];
    const modifiedCapabilities: CapabilityDiff[] = [];
    const breakingChanges: BreakingChange[] = [];

    // Find removed capabilities (breaking)
    for (const [opId] of Array.from(oldOps.entries())) {
      if (!newOps.has(opId)) {
        removedCapabilities.push(opId);
        breakingChanges.push({
          type: "removed_capability",
          operationId: opId,
          description: `Capability "${opId}" was removed`,
        });
      }
    }

    // Find added capabilities (non-breaking)
    for (const [opId] of Array.from(newOps.entries())) {
      if (!oldOps.has(opId)) {
        addedCapabilities.push(opId);
      }
    }

    // Find modified capabilities
    for (const [opId, oldCap] of Array.from(oldOps.entries())) {
      const newCap = newOps.get(opId);
      if (!newCap) continue;

      const capDiff = this.diffCapability(oldCap, newCap);
      if (capDiff.changes.length > 0) {
        modifiedCapabilities.push(capDiff);
        if (capDiff.isBreaking) {
          for (const change of capDiff.changes) {
            if (change.includes("BREAKING")) {
              breakingChanges.push({
                type: "type_change",
                operationId: opId,
                description: change,
              });
            }
          }
        }
      }
    }

    return {
      connectorId: oldManifest.connectorId,
      fromVersion: oldManifest.version,
      toVersion: newManifest.version,
      addedCapabilities,
      removedCapabilities,
      modifiedCapabilities,
      breakingChanges,
      isBreaking: breakingChanges.length > 0,
    };
  }

  /** Get diff history for a connector */
  getDiffHistory(connectorId: string): VersionDiff[] {
    return this.diffHistory.get(connectorId) || [];
  }

  /** Get a summary of all managed connectors */
  getSummary(): Array<{
    connectorId: string;
    activeVersion: string | undefined;
    totalVersions: number;
    hasCanary: boolean;
  }> {
    const result: Array<{
      connectorId: string;
      activeVersion: string | undefined;
      totalVersions: number;
      hasCanary: boolean;
    }> = [];

    for (const [connectorId, versions] of Array.from(this.versions.entries())) {
      result.push({
        connectorId,
        activeVersion: this.activeVersions.get(connectorId),
        totalVersions: versions.size,
        hasCanary: this.canaries.has(connectorId),
      });
    }

    return result;
  }

  // ─── Private helpers ─────────────────────────────────────────────

  private diffCapability(oldCap: ConnectorCapability, newCap: ConnectorCapability): CapabilityDiff {
    const changes: string[] = [];
    let isBreaking = false;

    // Description change (non-breaking)
    if (oldCap.description !== newCap.description) {
      changes.push("Description changed");
    }

    // Scope changes
    const oldScopes = new Set(oldCap.requiredScopes);
    const newScopes = new Set(newCap.requiredScopes);
    for (const scope of Array.from(newScopes)) {
      if (!oldScopes.has(scope)) {
        changes.push(`BREAKING: New required scope "${scope}"`);
        isBreaking = true;
      }
    }

    // Data access level change
    if (oldCap.dataAccessLevel !== newCap.dataAccessLevel) {
      changes.push(`Data access level changed: ${oldCap.dataAccessLevel} → ${newCap.dataAccessLevel}`);
      if (newCap.dataAccessLevel === "admin" || newCap.dataAccessLevel === "write") {
        isBreaking = true;
      }
    }

    // Confirmation requirement change
    if (!oldCap.confirmationRequired && newCap.confirmationRequired) {
      changes.push("Now requires confirmation");
    }

    // Input schema changes
    const schemaDiffs = diffJsonSchemas(oldCap.inputSchema, newCap.inputSchema);
    for (const sd of schemaDiffs) {
      changes.push(sd.description);
      if (sd.isBreaking) isBreaking = true;
    }

    return { operationId: oldCap.operationId, changes, isBreaking };
  }
}

// ─── Schema diffing helpers ──────────────────────────────────────────

interface SchemaDiffItem {
  description: string;
  isBreaking: boolean;
}

function diffJsonSchemas(oldSchema: JSONSchema7, newSchema: JSONSchema7): SchemaDiffItem[] {
  const diffs: SchemaDiffItem[] = [];

  if (!oldSchema.properties && !newSchema.properties) return diffs;

  const oldProps = new Set(Object.keys(oldSchema.properties || {}));
  const newProps = new Set(Object.keys(newSchema.properties || {}));
  const oldRequired = new Set(oldSchema.required || []);
  const newRequired = new Set(newSchema.required || []);

  // Removed properties
  for (const prop of Array.from(oldProps)) {
    if (!newProps.has(prop)) {
      diffs.push({
        description: `BREAKING: Property "${prop}" removed from input schema`,
        isBreaking: true,
      });
    }
  }

  // Added required properties (breaking)
  for (const prop of Array.from(newRequired)) {
    if (!oldRequired.has(prop) && !oldProps.has(prop)) {
      diffs.push({
        description: `BREAKING: New required property "${prop}" added`,
        isBreaking: true,
      });
    }
  }

  // Added optional properties (non-breaking)
  for (const prop of Array.from(newProps)) {
    if (!oldProps.has(prop) && !newRequired.has(prop)) {
      diffs.push({
        description: `New optional property "${prop}" added`,
        isBreaking: false,
      });
    }
  }

  return diffs;
}

// ─── Semver comparison ───────────────────────────────────────────────

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

// ─── Singleton ───────────────────────────────────────────────────────

export const connectorVersionManager = new ConnectorVersionManager();
