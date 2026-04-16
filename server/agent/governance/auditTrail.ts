import crypto from "crypto";

export interface AuditEntry {
  id: string;
  timestamp: number;
  action: string;
  actor: string;
  target: string;
  details: Record<string, unknown>;
  riskLevel: string;
  outcome: "success" | "failure" | "blocked" | "pending";
  governanceMode: string;
  previousHash: string;
  hash: string;
  artifactHash: string | null;
  sequenceNumber: number;
}

export interface AuditQueryOptions {
  actor?: string;
  action?: string;
  riskLevel?: string;
  outcome?: string;
  governanceMode?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}

export interface IntegrityReport {
  valid: boolean;
  totalEntries: number;
  checkedEntries: number;
  brokenAt: number | null;
  brokenEntry: string | null;
  computedHashes: number;
}

export class AuditTrail {
  private entries: AuditEntry[] = [];
  private sequenceCounter = 0;
  private genesisHash = "0000000000000000000000000000000000000000000000000000000000000000";

  private computeHash(entry: Omit<AuditEntry, "hash">): string {
    const payload = JSON.stringify({
      id: entry.id,
      timestamp: entry.timestamp,
      action: entry.action,
      actor: entry.actor,
      target: entry.target,
      details: entry.details,
      riskLevel: entry.riskLevel,
      outcome: entry.outcome,
      governanceMode: entry.governanceMode,
      previousHash: entry.previousHash,
      artifactHash: entry.artifactHash,
      sequenceNumber: entry.sequenceNumber,
    });
    return crypto.createHash("sha256").update(payload).digest("hex");
  }

  private computeArtifactHash(data: unknown): string {
    return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
  }

  record(params: {
    action: string;
    actor: string;
    target: string;
    details: Record<string, unknown>;
    riskLevel: string;
    outcome: "success" | "failure" | "blocked" | "pending";
    governanceMode: string;
    artifact?: unknown;
  }): AuditEntry {
    const id = crypto.randomUUID();
    const previousHash = this.entries.length > 0
      ? this.entries[this.entries.length - 1].hash
      : this.genesisHash;

    const artifactHash = params.artifact != null
      ? this.computeArtifactHash(params.artifact)
      : null;

    const sequenceNumber = this.sequenceCounter++;

    const partial: Omit<AuditEntry, "hash"> = {
      id,
      timestamp: Date.now(),
      action: params.action,
      actor: params.actor,
      target: params.target,
      details: params.details,
      riskLevel: params.riskLevel,
      outcome: params.outcome,
      governanceMode: params.governanceMode,
      previousHash,
      hash: "",
      artifactHash,
      sequenceNumber,
    };

    const hash = this.computeHash(partial);

    const entry: AuditEntry = { ...partial, hash };
    this.entries.push(entry);

    return entry;
  }

  query(options: AuditQueryOptions = {}): AuditEntry[] {
    let results = [...this.entries];

    if (options.actor) {
      results = results.filter(e => e.actor === options.actor);
    }
    if (options.action) {
      results = results.filter(e => e.action === options.action);
    }
    if (options.riskLevel) {
      results = results.filter(e => e.riskLevel === options.riskLevel);
    }
    if (options.outcome) {
      results = results.filter(e => e.outcome === options.outcome);
    }
    if (options.governanceMode) {
      results = results.filter(e => e.governanceMode === options.governanceMode);
    }
    if (options.startTime) {
      results = results.filter(e => e.timestamp >= options.startTime!);
    }
    if (options.endTime) {
      results = results.filter(e => e.timestamp <= options.endTime!);
    }

    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;
    return results.slice(offset, offset + limit);
  }

  verifyIntegrity(): IntegrityReport {
    const report: IntegrityReport = {
      valid: true,
      totalEntries: this.entries.length,
      checkedEntries: 0,
      brokenAt: null,
      brokenEntry: null,
      computedHashes: 0,
    };

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      report.checkedEntries++;
      report.computedHashes++;

      const expectedPrevHash = i === 0
        ? this.genesisHash
        : this.entries[i - 1].hash;

      if (entry.previousHash !== expectedPrevHash) {
        report.valid = false;
        report.brokenAt = i;
        report.brokenEntry = entry.id;
        return report;
      }

      const recomputed = this.computeHash({
        ...entry,
        hash: "",
      } as Omit<AuditEntry, "hash">);

      if (recomputed !== entry.hash) {
        report.valid = false;
        report.brokenAt = i;
        report.brokenEntry = entry.id;
        return report;
      }
    }

    return report;
  }

  exportForCompliance(startTime?: number, endTime?: number): {
    entries: AuditEntry[];
    integrity: IntegrityReport;
    exportedAt: number;
    totalEntries: number;
  } {
    const entries = this.query({ startTime, endTime, limit: Number.MAX_SAFE_INTEGER });
    return {
      entries,
      integrity: this.verifyIntegrity(),
      exportedAt: Date.now(),
      totalEntries: entries.length,
    };
  }

  getStats() {
    const last24h = Date.now() - 86400000;
    const recent = this.entries.filter(e => e.timestamp >= last24h);

    const byAction: Record<string, number> = {};
    const byRisk: Record<string, number> = {};
    const byOutcome: Record<string, number> = {};

    for (const e of recent) {
      byAction[e.action] = (byAction[e.action] || 0) + 1;
      byRisk[e.riskLevel] = (byRisk[e.riskLevel] || 0) + 1;
      byOutcome[e.outcome] = (byOutcome[e.outcome] || 0) + 1;
    }

    return {
      totalEntries: this.entries.length,
      last24hEntries: recent.length,
      byAction,
      byRisk,
      byOutcome,
      integrityValid: this.verifyIntegrity().valid,
    };
  }

  getEntryCount(): number {
    return this.entries.length;
  }
}

export const auditTrail = new AuditTrail();
