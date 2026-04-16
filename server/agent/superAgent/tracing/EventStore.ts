import { TraceEvent } from "./types";
import { pool } from "../../../db";
import { EventEmitter } from "events";

interface EventStoreOptions {
  tableName?: string;
  batchSize?: number;
  flushIntervalMs?: number;
  maxBufferSize?: number;
  gcIntervalMs?: number;
  maxInactiveMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number[];
}

interface EventStoreMetrics {
  bufferSize: number;
  totalFlushed: number;
  evictedEvents: number;
  lastFlushAt: number;
  instanceCount: number;
  avgBatchSize: number;
  transactionDurationMs: number;
  rollbackCount: number;
  totalBatches: number;
  totalBatchEvents: number;
}

const instanceRegistry = new Map<string, WeakRef<EventStore>>();
const finalizationRegistry = new FinalizationRegistry((runId: string) => {
  instanceRegistry.delete(runId);
  console.log(`[EventStore] Instance finalized for run: ${runId}`);
});

export class EventStore extends EventEmitter {
  private buffer: TraceEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private gcTimer: NodeJS.Timeout | null = null;
  private options: Required<EventStoreOptions>;
  private initialized: boolean = false;
  private destroyed: boolean = false;
  private runId: string | null = null;
  private lastActivityAt: number = Date.now();
  private metrics: EventStoreMetrics = {
    bufferSize: 0,
    totalFlushed: 0,
    evictedEvents: 0,
    lastFlushAt: 0,
    instanceCount: 0,
    avgBatchSize: 0,
    transactionDurationMs: 0,
    rollbackCount: 0,
    totalBatches: 0,
    totalBatchEvents: 0,
  };

  constructor(options: EventStoreOptions = {}, runId?: string) {
    super();
    this.options = {
      tableName: options.tableName ?? "trace_events",
      batchSize: options.batchSize ?? 100,
      flushIntervalMs: options.flushIntervalMs ?? 500,
      maxBufferSize: options.maxBufferSize ?? 10000,
      gcIntervalMs: options.gcIntervalMs ?? 60000,
      maxInactiveMs: options.maxInactiveMs ?? 600000,
      maxRetries: options.maxRetries ?? 3,
      retryBackoffMs: options.retryBackoffMs ?? [100, 200, 400],
    };
    this.runId = runId ?? null;

    if (runId) {
      instanceRegistry.set(runId, new WeakRef(this));
      finalizationRegistry.register(this, runId);
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized || this.destroyed) return;

    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS trace_events (
          id SERIAL PRIMARY KEY,
          run_id VARCHAR(64) NOT NULL,
          seq INTEGER NOT NULL,
          trace_id VARCHAR(64) NOT NULL,
          span_id VARCHAR(64) NOT NULL,
          parent_span_id VARCHAR(64),
          node_id VARCHAR(255) NOT NULL,
          attempt_id INTEGER DEFAULT 1,
          agent VARCHAR(100) NOT NULL,
          event_type VARCHAR(50) NOT NULL,
          phase VARCHAR(50),
          message TEXT,
          status VARCHAR(20),
          progress DECIMAL(5,2),
          metrics JSONB,
          evidence JSONB,
          ts BIGINT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(run_id, seq)
        )
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_trace_events_run_id ON trace_events(run_id)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_trace_events_run_seq ON trace_events(run_id, seq)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_trace_events_span_id ON trace_events(span_id)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_trace_events_event_type ON trace_events(event_type)
      `);
    } finally {
      client.release();
    }

    this.initialized = true;
    this.startFlushTimer();
    this.startGCTimer();
  }

  private startFlushTimer(): void {
    if (this.flushTimer || this.destroyed) return;
    
    this.flushTimer = setInterval(() => {
      if (!this.destroyed) {
        this.flush().catch(console.error);
      }
    }, this.options.flushIntervalMs);

    if (this.flushTimer.unref) {
      this.flushTimer.unref();
    }
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private startGCTimer(): void {
    if (this.gcTimer || this.destroyed) return;

    this.gcTimer = setInterval(() => {
      this.runGarbageCollection();
    }, this.options.gcIntervalMs);

    if (this.gcTimer.unref) {
      this.gcTimer.unref();
    }
  }

  private stopGCTimer(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
  }

  private runGarbageCollection(): void {
    const now = Date.now();
    const inactiveFor = now - this.lastActivityAt;
    
    if (inactiveFor > this.options.maxInactiveMs && this.buffer.length === 0) {
      console.log(`[EventStore] GC: Instance inactive for ${Math.round(inactiveFor / 1000)}s, cleaning up`);
      this.emit("gc_cleanup", {
        runId: this.runId,
        inactiveMs: inactiveFor,
        bufferSize: this.buffer.length,
      });
      this.destroy();
      return;
    }

    for (const [runId, weakRef] of instanceRegistry) {
      const instance = weakRef.deref();
      if (!instance) {
        instanceRegistry.delete(runId);
        console.log(`[EventStore] GC: Removed dead reference for run: ${runId}`);
      }
    }

    this.metrics.instanceCount = instanceRegistry.size;
    this.emit("gc_stats", {
      activeInstances: instanceRegistry.size,
      bufferSize: this.buffer.length,
      memoryUsed: this.estimateMemoryUsage(),
    });
  }

  private estimateMemoryUsage(): number {
    const avgEventSize = 500;
    return this.buffer.length * avgEventSize;
  }

  async append(event: TraceEvent): Promise<void> {
    if (this.destroyed) {
      console.warn("[EventStore] Attempted to append to destroyed store");
      return;
    }

    this.lastActivityAt = Date.now();

    if (this.buffer.length >= this.options.maxBufferSize) {
      const evictCount = Math.floor(this.options.maxBufferSize * 0.1);
      const evicted = this.buffer.splice(0, evictCount);
      this.metrics.evictedEvents += evicted.length;
      console.warn(`[EventStore] Buffer full, evicted ${evicted.length} oldest events`);
      this.emit("buffer_eviction", { evictedCount: evicted.length });
    }

    this.buffer.push(event);
    this.metrics.bufferSize = this.buffer.length;
    
    if (this.buffer.length >= this.options.batchSize) {
      await this.flush();
    }
  }

  async appendBatch(events: TraceEvent[]): Promise<void> {
    if (this.destroyed) {
      console.warn("[EventStore] Attempted to append batch to destroyed store");
      return;
    }

    this.lastActivityAt = Date.now();

    const availableSpace = this.options.maxBufferSize - this.buffer.length;
    if (events.length > availableSpace) {
      const evictCount = events.length - availableSpace + Math.floor(this.options.maxBufferSize * 0.1);
      const evicted = this.buffer.splice(0, Math.min(evictCount, this.buffer.length));
      this.metrics.evictedEvents += evicted.length;
      console.warn(`[EventStore] Buffer full on batch, evicted ${evicted.length} oldest events`);
      this.emit("buffer_eviction", { evictedCount: evicted.length });
    }

    this.buffer.push(...events);
    this.metrics.bufferSize = this.buffer.length;
    
    if (this.buffer.length >= this.options.batchSize) {
      await this.flush();
    }
  }

  async forceFlush(): Promise<void> {
    this.stopFlushTimer();
    await this.flush();
    this.metrics.lastFlushAt = Date.now();
  }

  private groupEventsByRunId(events: TraceEvent[]): Map<string, TraceEvent[]> {
    const groups = new Map<string, TraceEvent[]>();
    for (const event of events) {
      const runId = event.run_id;
      if (!groups.has(runId)) {
        groups.set(runId, []);
      }
      groups.get(runId)!.push(event);
    }
    return groups;
  }

  async flushBatch(): Promise<{ inserted: number; groups: number }> {
    if (this.buffer.length === 0 || this.destroyed) {
      return { inserted: 0, groups: 0 };
    }

    const events = [...this.buffer];
    this.buffer = [];
    this.metrics.bufferSize = 0;

    const groupedEvents = this.groupEventsByRunId(events);
    let totalInserted = 0;

    for (const [runId, groupEvents] of groupedEvents) {
      const inserted = await this.executeBatchInsert(groupEvents);
      totalInserted += inserted;
      console.log(`[EventStore] Batch insert for run_id=${runId}: ${inserted}/${groupEvents.length} events`);
    }

    this.metrics.totalFlushed += totalInserted;
    this.metrics.lastFlushAt = Date.now();

    return { inserted: totalInserted, groups: groupedEvents.size };
  }

  private async executeBatchInsert(events: TraceEvent[]): Promise<number> {
    if (events.length === 0) return 0;

    const startTime = Date.now();
    let lastError: any = null;

    for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');

        const runIds: string[] = [];
        const seqs: number[] = [];
        const traceIds: string[] = [];
        const spanIds: string[] = [];
        const parentSpanIds: (string | null)[] = [];
        const nodeIds: string[] = [];
        const attemptIds: number[] = [];
        const agents: string[] = [];
        const eventTypes: string[] = [];
        const phases: (string | null)[] = [];
        const messages: string[] = [];
        const statuses: (string | null)[] = [];
        const progresses: (number | null)[] = [];
        const metricsArr: string[] = [];
        const evidenceArr: string[] = [];
        const timestamps: string[] = [];

        for (const event of events) {
          runIds.push(event.run_id);
          seqs.push(event.seq);
          traceIds.push(event.trace_id);
          spanIds.push(event.span_id);
          parentSpanIds.push(event.parent_span_id ?? null);
          nodeIds.push(event.node_id);
          attemptIds.push(event.attempt_id ?? 1);
          agents.push(event.agent);
          eventTypes.push(event.event_type);
          phases.push(event.phase ?? null);
          messages.push(event.message);
          statuses.push(event.status ?? null);
          progresses.push(event.progress ?? null);
          metricsArr.push(JSON.stringify(event.metrics ?? {}));
          evidenceArr.push(JSON.stringify(event.evidence ?? {}));
          timestamps.push(event.ts.toString());
        }

        const batchInsertQuery = `
          INSERT INTO trace_events (
            run_id, seq, trace_id, span_id, parent_span_id, node_id,
            attempt_id, agent, event_type, phase, message, status,
            progress, metrics, evidence, ts
          )
          SELECT * FROM UNNEST(
            $1::varchar[], $2::int[], $3::varchar[], $4::varchar[], $5::varchar[],
            $6::varchar[], $7::int[], $8::varchar[], $9::varchar[], $10::varchar[],
            $11::text[], $12::varchar[], $13::decimal[], $14::jsonb[], $15::jsonb[],
            $16::bigint[]
          )
          ON CONFLICT (run_id, seq) DO NOTHING
        `;

        const result = await client.query(batchInsertQuery, [
          runIds, seqs, traceIds, spanIds, parentSpanIds,
          nodeIds, attemptIds, agents, eventTypes, phases,
          messages, statuses, progresses, metricsArr, evidenceArr,
          timestamps,
        ]);

        await client.query('COMMIT');

        const duration = Date.now() - startTime;
        this.updateBatchMetrics(events.length, duration);

        return result.rowCount ?? events.length;

      } catch (error: any) {
        lastError = error;
        
        try {
          await client.query('ROLLBACK');
          this.metrics.rollbackCount++;
          console.warn(`[EventStore] Transaction rolled back (attempt ${attempt + 1}/${this.options.maxRetries}): ${error.message}`);
        } catch (rollbackError) {
          console.error('[EventStore] Rollback failed:', rollbackError);
        }

        const isRetryable = this.isRetryableError(error);
        
        if (isRetryable && attempt < this.options.maxRetries - 1) {
          const delay = this.options.retryBackoffMs[attempt] ?? (100 * Math.pow(2, attempt));
          console.warn(`[EventStore] Retrying in ${delay}ms (attempt ${attempt + 1}/${this.options.maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        break;
      } finally {
        client.release();
      }
    }

    console.error("[EventStore] Batch insert failed after retries:", lastError?.message || lastError);
    
    if (!this.destroyed) {
      this.buffer.unshift(...events);
      this.metrics.bufferSize = this.buffer.length;
      this.emit("batch_failed", { 
        eventCount: events.length, 
        error: lastError?.message,
        requeuedCount: events.length,
      });
    }

    return 0;
  }

  private isRetryableError(error: any): boolean {
    const retryableCodes = ['57P01', '40001', '40P01', '08006', '08003'];
    const retryableMessages = [
      'terminating connection',
      'Connection terminated',
      'connection refused',
      'deadlock detected',
      'could not serialize access',
    ];

    if (retryableCodes.includes(error?.code)) {
      return true;
    }

    const message = error?.message?.toLowerCase() || '';
    return retryableMessages.some(msg => message.includes(msg.toLowerCase()));
  }

  private updateBatchMetrics(batchSize: number, durationMs: number): void {
    this.metrics.totalBatches++;
    this.metrics.totalBatchEvents += batchSize;
    this.metrics.avgBatchSize = this.metrics.totalBatchEvents / this.metrics.totalBatches;
    
    const alpha = 0.2;
    this.metrics.transactionDurationMs = this.metrics.transactionDurationMs === 0
      ? durationMs
      : this.metrics.transactionDurationMs * (1 - alpha) + durationMs * alpha;
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0 || this.destroyed) return;

    const events = [...this.buffer];
    this.buffer = [];
    this.metrics.bufferSize = 0;

    const groupedEvents = this.groupEventsByRunId(events);
    let totalInserted = 0;
    let failedEvents: TraceEvent[] = [];

    for (const [, groupEvents] of groupedEvents) {
      const inserted = await this.executeBatchInsert(groupEvents);
      if (inserted === 0 && groupEvents.length > 0) {
        failedEvents.push(...groupEvents);
      }
      totalInserted += inserted;
    }

    if (failedEvents.length > 0 && !this.destroyed) {
      this.buffer.unshift(...failedEvents);
      this.metrics.bufferSize = this.buffer.length;
    }

    if (totalInserted > 0) {
      this.metrics.totalFlushed += totalInserted;
      this.metrics.lastFlushAt = Date.now();
    }
  }

  async getEvents(runId: string, fromSeq: number = 0, limit: number = 1000): Promise<TraceEvent[]> {
    this.lastActivityAt = Date.now();
    
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          run_id, seq, trace_id, span_id, parent_span_id, node_id,
          attempt_id, agent, event_type, phase, message, status,
          progress, metrics, evidence, ts
        FROM trace_events
        WHERE run_id = $1 AND seq > $2
        ORDER BY seq ASC
        LIMIT $3
      `, [runId, fromSeq, limit]);

      return result.rows.map((row: any) => ({
        schema_version: "v1" as const,
        run_id: row.run_id,
        seq: row.seq,
        trace_id: row.trace_id,
        span_id: row.span_id,
        parent_span_id: row.parent_span_id,
        node_id: row.node_id,
        attempt_id: row.attempt_id ?? 1,
        agent: row.agent,
        event_type: row.event_type,
        phase: row.phase,
        message: row.message,
        status: row.status,
        progress: row.progress ? Number(row.progress) : undefined,
        metrics: typeof row.metrics === "string" ? JSON.parse(row.metrics) : row.metrics,
        evidence: typeof row.evidence === "string" ? JSON.parse(row.evidence) : row.evidence,
        ts: Number(row.ts),
      }));
    } finally {
      client.release();
    }
  }

  async getLastSeq(runId: string): Promise<number> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT MAX(seq) as max_seq FROM trace_events WHERE run_id = $1',
        [runId]
      );
      return result.rows[0]?.max_seq ?? 0;
    } finally {
      client.release();
    }
  }

  async getRunSummary(runId: string): Promise<{
    totalEvents: number;
    phases: string[];
    status: string;
    duration_ms: number;
  } | null> {
    const events = await this.getEvents(runId, 0, 10000);
    if (events.length === 0) return null;

    const phases = [...new Set(events.filter(e => e.phase).map(e => e.phase!))];
    const startEvent = events.find(e => e.event_type === "run_started");
    const endEvent = events.find(e => e.event_type === "run_completed" || e.event_type === "run_failed");
    
    return {
      totalEvents: events.length,
      phases,
      status: endEvent?.event_type === "run_completed" ? "completed" : 
              endEvent?.event_type === "run_failed" ? "failed" : "running",
      duration_ms: endEvent && startEvent ? endEvent.ts - startEvent.ts : Date.now() - (startEvent?.ts ?? Date.now()),
    };
  }

  getMetrics(): EventStoreMetrics {
    return { 
      ...this.metrics, 
      bufferSize: this.buffer.length,
      instanceCount: instanceRegistry.size,
    };
  }

  getBufferSize(): number {
    return this.buffer.length;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    
    this.destroyed = true;
    console.log(`[EventStore] Destroying instance${this.runId ? ` for run: ${this.runId}` : ""}`);

    this.stopFlushTimer();
    this.stopGCTimer();

    try {
      await this.flush();
    } catch (error) {
      console.error("[EventStore] Error during final flush:", error);
    }

    this.buffer = [];
    this.metrics.bufferSize = 0;

    if (this.runId) {
      instanceRegistry.delete(this.runId);
    }

    this.removeAllListeners();

    this.emit("destroyed", { runId: this.runId });
  }
}

let eventStoreInstance: EventStore | null = null;

export function getEventStore(): EventStore {
  if (!eventStoreInstance || eventStoreInstance.isDestroyed()) {
    eventStoreInstance = new EventStore();
  }
  return eventStoreInstance;
}

export function createEventStoreForRun(runId: string, options?: EventStoreOptions): EventStore {
  const existingRef = instanceRegistry.get(runId);
  const existing = existingRef?.deref();
  if (existing && !existing.isDestroyed()) {
    return existing;
  }
  
  return new EventStore(options, runId);
}

export async function initializeEventStore(): Promise<EventStore> {
  const store = getEventStore();
  await store.initialize();
  return store;
}

export function getEventStoreStats(): {
  instanceCount: number;
  instances: Array<{ runId: string; alive: boolean }>;
} {
  const instances: Array<{ runId: string; alive: boolean }> = [];
  
  for (const [runId, weakRef] of instanceRegistry) {
    const instance = weakRef.deref();
    instances.push({ runId, alive: !!instance && !instance.isDestroyed() });
  }
  
  return {
    instanceCount: instances.filter(i => i.alive).length,
    instances,
  };
}

export function cleanupDeadEventStores(): number {
  let cleaned = 0;
  
  for (const [runId, weakRef] of instanceRegistry) {
    const instance = weakRef.deref();
    if (!instance || instance.isDestroyed()) {
      instanceRegistry.delete(runId);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`[EventStore] Cleaned up ${cleaned} dead instances`);
  }
  
  return cleaned;
}
