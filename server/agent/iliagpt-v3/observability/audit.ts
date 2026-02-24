import type { Audit, AuditEntry } from "../types";
import { nowISO } from "../config";

export class InMemoryAudit implements Audit {
  private entries: AuditEntry[] = [];
  private maxEntries = 10000;

  log(entry: AuditEntry): void {
    this.entries.push({
      ...entry,
      timestamp: entry.timestamp || nowISO(),
    });

    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
  }

  query(filter: Partial<AuditEntry>, limit: number = 100): AuditEntry[] {
    let results = this.entries;

    if (filter.action) {
      results = results.filter((e) => e.action === filter.action);
    }
    if (filter.actor) {
      results = results.filter((e) => e.actor === filter.actor);
    }
    if (filter.resource) {
      results = results.filter((e) => e.resource === filter.resource);
    }
    if (filter.traceId) {
      results = results.filter((e) => e.traceId === filter.traceId);
    }
    if (filter.requestId) {
      results = results.filter((e) => e.requestId === filter.requestId);
    }

    return results.slice(-limit);
  }

  getRecentByActor(actor: string, limit: number = 50): AuditEntry[] {
    return this.query({ actor }, limit);
  }

  getRecentByResource(resource: string, limit: number = 50): AuditEntry[] {
    return this.query({ resource }, limit);
  }

  getByTraceId(traceId: string): AuditEntry[] {
    return this.entries.filter((e) => e.traceId === traceId);
  }

  clear(): void {
    this.entries = [];
  }

  exportAll(): AuditEntry[] {
    return [...this.entries];
  }
}

export class NullAudit implements Audit {
  log(_entry: AuditEntry): void {}
  query(_filter: Partial<AuditEntry>, _limit?: number): AuditEntry[] {
    return [];
  }
}

export const globalAudit = new InMemoryAudit();
