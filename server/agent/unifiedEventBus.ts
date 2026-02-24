import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { db } from '../db';
import { agentModeEvents } from '@shared/schema';

export class UnifiedEventBus extends EventEmitter {
    // T03-002: Dead Letter Queue Processor
    private dlq: any[] = [];

    constructor() {
        super();
        this.setMaxListeners(100);

        // En el constructor o init()
        setInterval(async () => {
            if (this.dlq.length === 0) return;
            const batch = this.dlq.splice(0, 50);
            console.log(`[EventBus] Processing ${batch.length} messages from DLQ`);
            for (const msg of batch) {
                msg.retryCount = (msg.retryCount || 0) + 1;
                if (msg.retryCount > 3) continue; // Drop permanently
                await this.publish(msg.topic, msg.payload, msg.retryCount);
            }
        }, 5000);
    }

    // T03-001: Telemetry Persistence
    async persistEvent(topic: string, payload: any) {
        if (topic.startsWith('telemetry.')) {
            try {
                // Ensure db is available, fallback or log otherwise
                if ((db as any).insert) {
                    await (db as any).insert(agentModeEvents).values({
                        runId: payload.runId || 'system',
                        correlationId: payload.correlationId || randomUUID(),
                        eventType: topic,
                        payload: payload
                    });
                }
            } catch (e) {
                console.warn('[EventBus] Error persisting telemetry:', e);
            }
        }
    }

    async publish(topic: string, payload: any, retryCount = 0): Promise<void> {
        try {
            this.emit(topic, { topic, payload, timestamp: Date.now() });

            // Persist
            await this.persistEvent(topic, payload);

            // T10-002: Push into robust async Telemetry Pipeline
            const { telemetryEmitter } = await import('../telemetry/emitter');
            telemetryEmitter.emit('event', {
                eventId: randomUUID(),
                topic,
                payload,
                timestamp: Date.now()
            });

        } catch (e) {
            console.error(`Error en pub/sub para ${topic}:`, e);
            this.dlq.push({ topic, payload, retryCount });
        }
    }
}

export const unifiedEventBus = new UnifiedEventBus();
