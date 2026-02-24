import { Response } from "express";

export type SSEEventType =
    | "chunk"
    | "tool_start"
    | "tool_result"
    | "clarification"
    | "artifacts"
    | "done"
    | "error"
    | "message"
    | "browser_step"
    | "browser_report"
    | "heartbeat";

export interface SSEPlyload {
    runId: string;
    [key: string]: any;
}

export class SSEManager {
    private res: Response;
    private isEnded = false;

    constructor(res: Response) {
        this.res = res;

        // Auto-detect when connection closes
        if (this.res.on) {
            this.res.on("close", () => {
                this.isEnded = true;
            });
        }
    }

    public write(event: SSEEventType, data: SSEPlyload | any): void {
        if (this.isEnded || this.res.writableEnded || this.res.destroyed) {
            return;
        }

        const streamMeta = this.res.locals?.streamMeta;
        const assistantMessageId = streamMeta?.assistantMessageId ||
            (typeof streamMeta?.getAssistantMessageId === "function" ? streamMeta.getAssistantMessageId() : undefined);

        if (typeof data === 'object' && data !== null) {
            if (!data.conversationId && streamMeta?.conversationId) data.conversationId = streamMeta.conversationId;
            if (!data.requestId && streamMeta?.requestId) data.requestId = streamMeta.requestId;
            if (!data.assistantMessageId && assistantMessageId) data.assistantMessageId = assistantMessageId;
        }

        try {
            this.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            if (typeof (this.res as any).flush === "function") {
                (this.res as any).flush();
            }
        } catch (err) {
            this.isEnded = true;
            console.warn("[SSEManager] Write failed, ending stream:", err);
        }
    }

    public end() {
        this.isEnded = true;
        if (!this.res.writableEnded && typeof this.res.end === "function") {
            this.res.end();
        }
    }
}
