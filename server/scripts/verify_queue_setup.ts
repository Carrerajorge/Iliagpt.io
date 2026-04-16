import "../config/load-env"; // Load environment variables
import { agentQueue, agentWorker } from "../agent/queue/agentQueue";
import { agentManager } from "../agent/agentOrchestrator";

async function verifyQueue() {
    console.log("Starting Queue Verification...");

    if (!agentQueue) {
        throw new Error("agentQueue is null - Redis not configured?");
    }
    if (!agentWorker) {
        throw new Error("agentWorker is null - Redis not configured?");
    }

    // Mock agentManager.executeRun to avoid full agent complexity for this test
    const originalExecute = agentManager.executeRun;
    agentManager.executeRun = async (runId) => {
        console.log(`[MOCK] Executing run ${runId}`);
        return Promise.resolve();
    };

    const testRunId = `test-run-${Date.now()}`;

    // Add a job
    console.log(`Adding job for run ${testRunId}...`);
    await agentQueue.add("agent-execution", {
        runId: testRunId,
        chatId: "test-chat",
        userId: "test-user",
        message: "Hello world"
    });

    // Wait for worker to process
    return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error("Timeout waiting for job completion"));
        }, 5000);

        agentWorker.on("completed", (job) => {
            if (job.data.runId === testRunId) {
                console.log(`Job ${job.id} completed successfully!`);
                clearTimeout(timeout);
                // Restore original method
                agentManager.executeRun = originalExecute;
                resolve();
            }
        });

        agentWorker.on("failed", (job, err) => {
            if (job && job.data.runId === testRunId) {
                console.error(`Job ${job.id} failed:`, err);
                clearTimeout(timeout);
                reject(err);
            }
        });
    });
}

verifyQueue()
    .then(async () => {
        console.log("Verification Passed!");
        await agentQueue.close();
        await agentWorker.close();
        process.exit(0);
    })
    .catch(async (err) => {
        console.error("Verification Failed:", err);
        await agentQueue.close();
        await agentWorker.close();
        process.exit(1);
    });
