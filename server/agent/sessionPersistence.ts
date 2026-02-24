import { randomUUID } from 'crypto';
import { promisify } from 'util';
import * as zlib from 'zlib';

const brotliCompress = promisify(zlib.brotliCompress);
const brotliDecompress = promisify(zlib.brotliDecompress);

// Wire actual DB and Schema
import { db } from '../db';
import { agentCheckpoints } from '../../shared/schema/agent';
import { eq } from 'drizzle-orm';

export interface AgentState {
    id: string; // The primary Agent ID UUID
    beliefs: any;
    memory: { serialize: () => string };
    planTree: { serialize: () => string };
    actionHistory: any[];
    visionState: any;
}

export class SessionPersistence {
    private checkpointInterval = 2 * 60 * 1000; // 2 min Auto-Save
    private compressionEnabled = true; // Use Brotli 

    // In-memory track of active agents for the timer loop
    private activeAgents: Map<string, AgentState> = new Map();
    private loopTimer: NodeJS.Timeout | null = null;

    constructor() {
        this.startAutoSaveLoop();
    }

    public registerAgentForAutoSave(state: AgentState) {
        this.activeAgents.set(state.id, state);
    }

    public unregisterAgent(agentId: string) {
        this.activeAgents.delete(agentId);
    }

    private startAutoSaveLoop() {
        if (this.loopTimer) clearInterval(this.loopTimer);
        this.loopTimer = setInterval(async () => {
            for (const [agentId, state] of this.activeAgents.entries()) {
                try {
                    await this.saveCheckpoint(state);
                } catch (e) {
                    console.error(`[SessionPersistence] AutoSave failed for agent ${agentId}:`, e);
                }
            }
        }, this.checkpointInterval);
    }

    /**
     * Captures the full state of the autonomous brain for pause/resume capabilities
     * across long-running tasks.
     */
    async saveCheckpoint(state: AgentState): Promise<string> {
        const checkpoint = {
            id: randomUUID(),
            timestamp: Date.now(),
            beliefState: state.beliefs,
            memory: state.memory ? state.memory.serialize() : null,
            planTree: state.planTree ? state.planTree.serialize() : null,
            actionHistory: state.actionHistory ? state.actionHistory.slice(-1000) : [], // Keep last 1000
            visionState: state.visionState,
        };

        let payload: string;
        try {
            if (this.compressionEnabled) {
                const compressed = await brotliCompress(Buffer.from(rawData, 'utf-8'));
                payload = compressed.toString('base64');
                console.log(`[SessionPersistence] Saved Checkpoint ${checkpoint.id} (compressed: ${(payload.length / 1024).toFixed(2)} KB)`);
            } else {
                payload = rawData;
                console.log(`[SessionPersistence] Saved Checkpoint ${checkpoint.id} (raw: ${(payload.length / 1024).toFixed(2)} KB)`);
            }
        } catch (compressErr) {
            console.error("[SessionPersistence] Compression failed, saving raw:", compressErr);
            payload = rawData;
        }

        try {
            await db.insert(agentCheckpoints).values({
                id: checkpoint.id,
                timestamp: new Date(checkpoint.timestamp),
                data: payload,
            });
        } catch (dbErr) {
            console.error("[SessionPersistence] Checkpoint Failed to save in DB:", dbErr);
        }

        return checkpoint.id;
    }

    /**
     * Resurrects an agent into its exact contextual working state.
     */
    async resume(checkpointId: string): Promise<AgentState | null> {
        console.log(`[SessionPersistence] Resuming from Checkpoint ${checkpointId}`);

        try {
            const checkpointRow = await db.query.agentCheckpoints.findFirst({
                where: eq(agentCheckpoints.id, checkpointId),
            });
            if (!checkpointRow) return null;

            let decompressedData: string = checkpointRow.data;

            if (this.compressionEnabled && !checkpointRow.data.startsWith('{')) {
                try {
                    // Try to decompress base64 brotli payload
                    const buffer = Buffer.from(checkpointRow.data, 'base64');
                    const unzipped = await brotliDecompress(buffer);
                    decompressedData = unzipped.toString('utf-8');
                } catch (e) {
                    // Fallback to raw if decompression fails and isn't a strict JSON signature
                    console.warn("[SessionPersistence] Decompression failed, attempting raw parse");
                }
            }

            return this.deserialize(checkpointRow.id, decompressedData);
        } catch (dbErr) {
            console.error("[SessionPersistence] Error fetching checkpoint:", dbErr);
            return null;
        }
    }

    private deserialize(agentId: string, data: string): AgentState {
        const parsed = JSON.parse(data);
        return {
            id: agentId,
            beliefs: parsed.beliefState,
            memory: { serialize: () => parsed.memory },
            planTree: { serialize: () => parsed.planTree },
            actionHistory: parsed.actionHistory,
            visionState: parsed.visionState
        };
    }
}

export const globalSessionPersistence = new SessionPersistence();
