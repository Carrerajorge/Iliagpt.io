import { createQueue, createWorker, QUEUE_NAMES } from "../../lib/queueFactory";
import { agentManager } from "../agentOrchestrator"; // Use direct import to avoid cycles
import { agentModeRuns } from "@shared/schema";
import { db } from "../../db";
import { eq } from "drizzle-orm";

export const AGENT_QUEUE_NAME = "agent-execution-queue";

export interface AgentJob {
    runId: string;
    chatId: string;
    userId: string | null;
    message: string;
    attachments?: any[];
}

// Create Queue
export const agentQueue = createQueue<AgentJob>(AGENT_QUEUE_NAME);

// Create Worker
export const agentWorker = createWorker<AgentJob, void>(AGENT_QUEUE_NAME, async (job) => {
    const { runId, chatId, userId, message, attachments } = job.data;

    console.log(`[AgentWorker] Processing run ${runId} for chat ${chatId}`);

    try {
        // Update status to running
        await db.update(agentModeRuns)
            .set({ status: "running" })
            .where(eq(agentModeRuns.id, runId));

        // Execute the run
        // Note: ensure startRun logic is decoupled so we don't re-queue loops
        // Ideally we call an 'execute' method, but startRun does both creation + execution currently.
        // We will refactor agentManager next. For now, we assume agentManager.executeRun exists or we use startRun
        // If startRun creates the DB entry, we might need a separate 'resume' or 'execute' method.
        // Given the plan to refactor agentRouter, the router will create the DB entry and the queue job.
        // The worker should just trigger the LangGraph execution.

        // We'll access the orchestrator directly if possible or add an execute method to manager.
        await agentManager.executeRun(runId, chatId, userId, message, attachments);

        console.log(`[AgentWorker] Completed run ${runId}`);
    } catch (error: any) {
        console.error(`[AgentWorker] Failed run ${runId}:`, error);

        await db.update(agentModeRuns)
            .set({
                status: "failed",
                error: error.message
            })
            .where(eq(agentModeRuns.id, runId));

        throw error; // Let BullMQ handle retries
    }
});
