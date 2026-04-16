import { db } from "../db";
import { agentModeRuns, agentModeSteps } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

export interface OptimisticLockResult {
  success: boolean;
  error?: string;
  currentVersion?: number;
}

export async function updateRunWithLock(
  runId: string,
  expectedStatus: string,
  updates: Partial<typeof agentModeRuns.$inferInsert>
): Promise<OptimisticLockResult> {
  try {
    const result = await db.update(agentModeRuns)
      .set(updates)
      .where(and(
        eq(agentModeRuns.id, runId),
        eq(agentModeRuns.status, expectedStatus)
      ))
      .returning();
    
    if (result.length === 0) {
      const [current] = await db.select({ status: agentModeRuns.status })
        .from(agentModeRuns)
        .where(eq(agentModeRuns.id, runId));
      
      return {
        success: false,
        error: `Optimistic lock failed: expected status '${expectedStatus}', current is '${current?.status || "not found"}'`,
      };
    }
    
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function executeInTransaction<T>(
  operation: () => Promise<T>
): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const result = await db.transaction(async (tx) => {
      return await operation();
    });
    return { success: true, data: result };
  } catch (error: any) {
    console.error("[DBTransaction] Transaction failed:", error.message);
    return { success: false, error: error.message };
  }
}

export async function acquireRunLock(runId: string, _lockDurationMs: number = 30000): Promise<boolean> {
  const lockId = runIdToLockId(runId);
  return tryAcquireAdvisoryLock(lockId);
}

export async function releaseRunLock(runId: string): Promise<void> {
  const lockId = runIdToLockId(runId);
  await releaseAdvisoryLock(lockId);
}

export async function withRunLock<T>(
  runId: string,
  operation: () => Promise<T>,
  timeoutMs: number = 5000
): Promise<{ success: boolean; data?: T; error?: string }> {
  const lockId = runIdToLockId(runId);
  const acquired = await tryAcquireAdvisoryLock(lockId);
  
  if (!acquired) {
    return { success: false, error: `Could not acquire lock for run ${runId}` };
  }
  
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("Lock operation timeout")), timeoutMs);
    });
    
    const data = await Promise.race([operation(), timeoutPromise]);
    return { success: true, data };
  } catch (error: any) {
    return { success: false, error: error.message };
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    await releaseAdvisoryLock(lockId);
  }
}

export async function tryAcquireAdvisoryLock(lockId: number): Promise<boolean> {
  try {
    const result = await db.execute(sql`SELECT pg_try_advisory_lock(${lockId}) as acquired`);
    const acquired = (result as any)?.[0]?.acquired;
    return acquired === true;
  } catch (error) {
    console.error(`[DBTransaction] Advisory lock error:`, error);
    return false;
  }
}

export async function releaseAdvisoryLock(lockId: number): Promise<void> {
  try {
    await db.execute(sql`SELECT pg_advisory_unlock(${lockId})`);
  } catch (error) {
    console.error(`[DBTransaction] Advisory unlock error:`, error);
  }
}

export function runIdToLockId(runId: string): number {
  let hash = 0;
  for (let i = 0; i < runId.length; i++) {
    const char = runId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}
