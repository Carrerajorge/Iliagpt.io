import { createLogger } from '../../../utils/logger';
import { openclawSubagentService } from '../../agents/subagentService';

const log = createLogger('openclaw-bcp');

interface BcpTask {
  id: string;
  label: string;
  fn: () => Promise<void>;
  intervalMs: number;
  lastRunAt?: number;
  nextRunAt: number;
  errorCount: number;
}

const tasks = new Map<string, BcpTask>();
let tickInterval: NodeJS.Timeout | null = null;
let initialized = false;

function scheduleTask(id: string, label: string, fn: () => Promise<void>, intervalMs: number): void {
  tasks.set(id, {
    id, label, fn, intervalMs,
    nextRunAt: Date.now() + intervalMs,
    errorCount: 0,
  });
}

async function tick(): Promise<void> {
  const now = Date.now();
  for (const task of tasks.values()) {
    if (task.nextRunAt > now) continue;
    task.nextRunAt = now + task.intervalMs;
    try {
      await task.fn();
      task.lastRunAt = now;
      task.errorCount = 0;
    } catch (err: any) {
      task.errorCount++;
      log.warn(`BCP task "${task.label}" failed (${task.errorCount})`, { error: err?.message });
    }
  }
}

export function initBackgroundControlPlane(): void {
  if (initialized) return;
  initialized = true;

  scheduleTask('subagent-gc', 'Subagent GC', async () => {
    try {
      const cleaned = await (openclawSubagentService as any).gcStaleRuns?.(5 * 60 * 1000) ?? 0;
      if (cleaned > 0) log.info(`BCP: cleaned ${cleaned} stale subagent runs`);
    } catch { }
  }, 60_000);

  scheduleTask('health-heartbeat', 'Health Heartbeat', async () => {
    log.debug('BCP heartbeat ok');
  }, 30_000);

  tickInterval = setInterval(() => { tick().catch(() => {}); }, 5_000);

  log.info('[OpenClaw:BCP] Background control plane initialized');
}

export function getBcpStatus(): { tasks: number; initialized: boolean } {
  return { tasks: tasks.size, initialized };
}

export function stopBackgroundControlPlane(): void {
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
  tasks.clear();
  initialized = false;
}
