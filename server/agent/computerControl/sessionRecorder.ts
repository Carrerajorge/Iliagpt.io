import { EventEmitter } from "events";
import type { RiskClassification } from "./riskClassifier";

export interface SessionEntry {
  id: string;
  runId: string;
  timestamp: number;
  type: "command" | "tool_call" | "file_op" | "network" | "system";
  command: string;
  input: any;
  output: any;
  durationMs: number;
  riskClassification?: RiskClassification;
  userId?: string;
  exitCode?: number;
  error?: string;
}

export interface SessionSummary {
  runId: string;
  totalEntries: number;
  startTime: number;
  endTime: number;
  durationMs: number;
  riskBreakdown: Record<string, number>;
  errorCount: number;
  commandCount: number;
}

export class SessionRecorder extends EventEmitter {
  private sessions: Map<string, SessionEntry[]> = new Map();
  private readonly maxEntriesPerSession = 1000;
  private entryCounter = 0;

  record(entry: Omit<SessionEntry, "id" | "timestamp">): SessionEntry {
    const fullEntry: SessionEntry = {
      ...entry,
      id: `entry_${++this.entryCounter}_${Date.now()}`,
      timestamp: Date.now(),
    };

    if (!this.sessions.has(entry.runId)) {
      this.sessions.set(entry.runId, []);
    }

    const entries = this.sessions.get(entry.runId)!;
    entries.push(fullEntry);

    if (entries.length > this.maxEntriesPerSession) {
      entries.shift();
    }

    this.emit("recorded", fullEntry);
    return fullEntry;
  }

  getSession(runId: string): SessionEntry[] {
    return this.sessions.get(runId) || [];
  }

  getSummary(runId: string): SessionSummary | null {
    const entries = this.sessions.get(runId);
    if (!entries || entries.length === 0) return null;

    const riskBreakdown: Record<string, number> = {
      safe: 0,
      moderate: 0,
      dangerous: 0,
      critical: 0,
    };

    let errorCount = 0;
    let commandCount = 0;

    for (const entry of entries) {
      if (entry.riskClassification) {
        riskBreakdown[entry.riskClassification.riskLevel] =
          (riskBreakdown[entry.riskClassification.riskLevel] || 0) + 1;
      }
      if (entry.error) errorCount++;
      if (entry.type === "command") commandCount++;
    }

    const startTime = entries[0].timestamp;
    const endTime = entries[entries.length - 1].timestamp;

    return {
      runId,
      totalEntries: entries.length,
      startTime,
      endTime,
      durationMs: endTime - startTime,
      riskBreakdown,
      errorCount,
      commandCount,
    };
  }

  getRecentEntries(runId: string, count: number = 50): SessionEntry[] {
    const entries = this.sessions.get(runId) || [];
    return entries.slice(-count);
  }

  clearSession(runId: string): void {
    this.sessions.delete(runId);
  }

  getAllRunIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  exportSession(runId: string): string {
    const entries = this.sessions.get(runId) || [];
    return JSON.stringify(entries, null, 2);
  }
}

export const sessionRecorder = new SessionRecorder();
