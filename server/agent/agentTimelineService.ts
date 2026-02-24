import { EventEmitter } from "events";
import { Response } from "express";

export type AgentEventType =
    | "plan_started"
    | "plan_completed"
    | "plan_failed"
    | "step_started"
    | "step_completed"
    | "step_failed"
    | "tool_call"
    | "tool_result"
    | "requires_action"
    | "artifact_generated"
    | "compensating";

export interface AgentEvent {
    id: string;
    type: AgentEventType;
    timestamp: Date;
    runId: string;
    chatId: string;
    message?: string;
    metadata?: Record<string, any>;
}

export class AgentTimelineService extends EventEmitter {
    // Store connected clients per chatId to broadcast SSE
    private clients = new Map<string, Set<Response>>();
    // Keep last N events per runId for historical playback
    private history = new Map<string, AgentEvent[]>();

    public subscribe(chatId: string, res: Response) {
        if (!this.clients.has(chatId)) {
            this.clients.set(chatId, new Set());
        }

        // Headers setup in the route, here we just keep the response object
        this.clients.get(chatId)!.add(res);

        res.on("close", () => {
            this.clients.get(chatId)?.delete(res);
            if (this.clients.get(chatId)?.size === 0) {
                this.clients.delete(chatId);
            }
        });
    }

    public emitEvent(event: Omit<AgentEvent, "id" | "timestamp">) {
        const fullEvent: AgentEvent = {
            ...event,
            id: crypto.randomUUID(),
            timestamp: new Date()
        };

        // Store in history
        if (!this.history.has(event.runId)) {
            this.history.set(event.runId, []);
        }
        this.history.get(event.runId)!.push(fullEvent);

        // Broadcast if clients connected
        const chatClients = this.clients.get(fullEvent.chatId);
        if (chatClients && chatClients.size > 0) {
            const payload = `data: ${JSON.stringify(fullEvent)}\n\n`;
            for (const res of chatClients) {
                res.write(payload);
            }
        }

        // Also emit locally for other backend components if needed
        this.emit("agent_event", fullEvent);
    }

    public getHistory(runId: string): AgentEvent[] {
        return this.history.get(runId) || [];
    }
}

export const agentTimelineService = new AgentTimelineService();
