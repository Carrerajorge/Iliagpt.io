import { z } from "zod";
import type { Response } from "express";

// ===== Event Schemas =====

export const ContentDeltaSchema = z.object({
    type: z.literal("content_delta"),
    delta: z.string(),
    snapshot: z.string().optional(), // Accumulated content so far (for recovery)
});

export const ToolCallSchema = z.object({
    type: z.literal("tool_call"),
    toolCallId: z.string(),
    functionName: z.string(),
    args: z.record(z.any()),
});

export const ToolResultSchema = z.object({
    type: z.literal("tool_result"),
    toolCallId: z.string(),
    result: z.any(),
});

export const AgentStatusSchema = z.object({
    type: z.literal("status"),
    status: z.enum(["thinking", "executing_tool", "parsing_document", "ready", "error"]),
    message: z.string().optional(),
});

export const AgentEventSchema = z.discriminatedUnion("type", [
    ContentDeltaSchema,
    ToolCallSchema,
    ToolResultSchema,
    AgentStatusSchema,
]);

export type AgentEvent = z.infer<typeof AgentEventSchema>;

// ===== Stream Responder =====

export class StreamResponder {
    private res: Response;
    private isOpen: boolean = true;

    constructor(res: Response) {
        this.res = res;
        this.setupHeaders();

        this.res.on("close", () => {
            this.isOpen = false;
        });
    }

    private setupHeaders() {
        this.res.setHeader("Content-Type", "text/event-stream");
        this.res.setHeader("Cache-Control", "no-cache");
        this.res.setHeader("Connection", "keep-alive");
    }

    /**
     * Sends a typed event to the client.
     * Validates the event against the schema before sending.
     */
    public send(event: AgentEvent) {
        if (!this.isOpen) return;

        // Runtime validation to ensure strict protocol adherence
        const validation = AgentEventSchema.safeParse(event);
        if (!validation.success) {
            console.error("[StreamResponder] Schema violation:", validation.error);
            // In production, we might want to sanitize this, but for now we log it
            this.sendError("Internal Server Error: Schema violation in stream");
            return;
        }

        const data = JSON.stringify(event);
        this.res.write(`data: ${data}\n\n`);

        // Optional: flush (if compression middleware allows)
        if ((this.res as any).flush) {
            (this.res as any).flush();
        }
    }

    public sendError(message: string) {
        this.send({
            type: "status",
            status: "error",
            message,
        });
    }

    public end() {
        if (!this.isOpen) return;
        this.res.write("event: done\ndata: [DONE]\n\n");
        this.res.end();
        this.isOpen = false;
    }
}
