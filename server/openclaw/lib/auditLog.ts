import { randomUUID } from "crypto";

export interface AuditEntry {
  id: string;
  timestamp: number;
  userId: string;
  toolId: string;
  input: Record<string, unknown>;
  output: { success: boolean; error?: string };
  durationMs: number;
  ip?: string;
}

class AuditLog {
  private entries: AuditEntry[] = [];
  private maxEntries = 10_000;

  record(entry: Omit<AuditEntry, "id" | "timestamp">): void {
    this.entries.push({
      ...entry,
      id: randomUUID(),
      timestamp: Date.now(),
    });
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  query(filters?: {
    userId?: string;
    toolId?: string;
    since?: number;
    limit?: number;
  }): AuditEntry[] {
    let result = this.entries;

    if (filters?.userId) {
      result = result.filter((e) => e.userId === filters.userId);
    }
    if (filters?.toolId) {
      result = result.filter((e) => e.toolId === filters.toolId);
    }
    if (filters?.since) {
      const since = filters.since;
      result = result.filter((e) => e.timestamp >= since);
    }

    const limit = filters?.limit ?? 50;
    // Return most recent entries first
    return result.slice(-limit).reverse();
  }

  getStats(): {
    total: number;
    last24h: number;
    byTool: Record<string, number>;
  } {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const byTool: Record<string, number> = {};
    let last24h = 0;

    for (const entry of this.entries) {
      byTool[entry.toolId] = (byTool[entry.toolId] || 0) + 1;
      if (entry.timestamp >= oneDayAgo) {
        last24h++;
      }
    }

    return {
      total: this.entries.length,
      last24h,
      byTool,
    };
  }
}

export const auditLog = new AuditLog();
