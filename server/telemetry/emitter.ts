import { EventEmitter } from 'events';

export class TelemetryEmitter extends EventEmitter {
  private batch: any[] = [];
  private flushInterval: NodeJS.Timeout;
  private MAX_BATCH_SIZE = 250;

  constructor() {
    super();
    this.on('event', (evt) => {
      this.batch.push(evt);
      if (this.batch.length >= this.MAX_BATCH_SIZE) {
        this.flush();
      }
    });

    // T10-001: Asynchronous Batch Flushing
    this.flushInterval = setInterval(() => this.flush(), 5000);
  }

  private async flush() {
    if (this.batch.length === 0) return;

    const toSend = [...this.batch];
    this.batch = [];

    try {
      // Placeholder: T10-002 (zstd compression implementation)
      // const compressed = zstd.compress(JSON.stringify(toSend));
      // await fetch('https://telemetry.iliagpt.com/ingest', { body: compressed });
      console.log(`[Telemetry] Flushed batch of ${toSend.length} events asynchronously (zstd compressed mock)`);
    } catch (e) {
      console.error('[Telemetry] Flush failed, dropping batch to prevent memory leak', e);
    }
  }
}

export const telemetryEmitter = new TelemetryEmitter();

export function emitDashboardEvent(event: unknown): boolean {
  telemetryEmitter.emit("event", event);
  return true;
}
