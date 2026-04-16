import "../config/load-env";
import { initTracing, getTracer } from "../lib/tracing";
import { Logger } from "../lib/logger";

async function runTest() {
    Logger.info("Testing Tracing Initialization...");

    try {
        // 1. Initialize Tracing
        initTracing({
            serviceName: "test-worker-tracing",
            enableConsoleExporter: false
        });

        // 2. Get Tracer
        const tracer = getTracer();
        if (!tracer) {
            throw new Error("Failed to get tracer instance");
        }
        Logger.info("✅ Tracer acquired successfully");

        // 3. Start a Span
        await tracer.startActiveSpan("test-span", async (span) => {
            span.setAttribute("test.attribute", "value");
            Logger.info("✅ Active span created");

            // Simulate work
            await new Promise(r => setTimeout(r, 100));

            span.end();
        });
        Logger.info("✅ Span ended successfully");

        Logger.info("Tracing verification passed.");
        process.exit(0);
    } catch (error: any) {
        Logger.error("Tracing verification failed:", error.message);
        process.exit(1);
    }
}

runTest();
