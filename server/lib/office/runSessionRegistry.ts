import type { StepStreamer } from "../../agent/stepStreamer";
import type { OfficeRunResult } from "./types";

export interface OfficeRunSession {
  runId: string;
  userId: string;
  streamer: StepStreamer;
  controller: AbortController;
  result: Promise<OfficeRunResult>;
  finished: boolean;
  finishedAt?: number;
  finalStatus?: OfficeRunResult["status"];
  finalError?: string;
  pendingEvents: Array<{ event: string; data: unknown }>;
}

const sessions = new Map<string, OfficeRunSession>();
const SESSION_RETENTION_MS = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (session.finished && session.finishedAt && now - session.finishedAt > SESSION_RETENTION_MS) {
      sessions.delete(id);
    }
  }
}, 60_000).unref?.();

export function registerOfficeRunSession(runId: string, session: OfficeRunSession): void {
  session.runId = runId;
  sessions.set(runId, session);
}

export function getOfficeRunSession(runId: string): OfficeRunSession | undefined {
  return sessions.get(runId);
}

export function countRunningOfficeRunsForUser(userId: string): number {
  let count = 0;
  for (const session of sessions.values()) {
    if (!session.finished && session.userId === userId) {
      count += 1;
    }
  }
  return count;
}

export function markOfficeRunSessionFinished(
  runId: string,
  status: OfficeRunResult["status"],
  error?: string,
): void {
  const session = sessions.get(runId);
  if (!session) return;
  session.finished = true;
  session.finishedAt = Date.now();
  session.finalStatus = status;
  session.finalError = error;
}

export function getOfficeRunSessionStats(): { total: number; finished: number; running: number } {
  const all = Array.from(sessions.values());
  return {
    total: all.length,
    finished: all.filter((session) => session.finished).length,
    running: all.filter((session) => !session.finished).length,
  };
}
