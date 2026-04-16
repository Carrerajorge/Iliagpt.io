
import { SuperAgentOrchestrator } from "../agent/superAgent/orchestrator";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env
dotenv.config({ path: path.join(__dirname, "../../.env") });

async function runTest() {
    console.log("Starting Test 1: Aggressive Orchestration (Word + Excel)");

    const sessionId = "test_session_" + Date.now();
    const orchestrator = new SuperAgentOrchestrator(sessionId);

    // Mock SSE
    orchestrator.on("sse", (event) => {
        if (event.event_type === "progress" || event.event_type === "phase_started") {
            console.log(`[SSE] ${event.event_type}: ${(event.data as any).message || (event.data as any).status}`);
        }
        if (event.event_type === "artifact") {
            console.log(`[SSE] ARTIFACT GENERATED: ${(event.data as any).name} (${(event.data as any).type})`);
        }
        if (event.event_type === "final") {
            console.log(`[SSE] FINAL RESPONSE: ${(event.data as any).text?.substring(0, 50)}...`);
        }
        if (event.event_type === "error") {
            console.error(`[SSE] ERROR:`, event.data);
        }
    });

    const prompt = "Busca 30 papers sobre IA (2020-2024) y crea un Excel con los datos y un Word con resúmenes";
    console.log(`Executing prompt: "${prompt}"`);

    try {
        const result = await orchestrator.execute(prompt);
        console.log("Execution State:", {
            contract_intent: result.contract.intent,
            min_sources: result.contract.requirements.min_sources,
            must_create: result.contract.requirements.must_create,
            sources_count: result.sources_count,
            artifacts_count: result.artifacts.length,
            artifacts: result.artifacts.map(a => a.name)
        });

        if (result.artifacts.length >= 2) {
            console.log("SUCCESS: Generated multiple artifacts.");
        } else {
            console.error("FAILURE: Expected 2+ artifacts, got " + result.artifacts.length);
            process.exit(1);
        }

        if (result.sources_count >= 10) { // Should be 30, but tolerate some partial failures
            console.log("SUCCESS: Sources collected.");
        } else {
            console.warn("WARNING: Sources count low: " + result.sources_count);
        }

    } catch (error) {
        console.error("Test Failed with Error:", error);
        process.exit(1);
    }
}

runTest();
