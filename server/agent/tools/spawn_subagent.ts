import { z } from "zod";
import { type ToolDefinition, type ToolContext, type ToolResult, toolRegistry } from "../toolRegistry";
import { AgentOrchestrator } from "../agentOrchestrator";
import { randomUUID } from "crypto";

export const spawnSubagentTool: ToolDefinition = {
    name: "spawn_subagent",
    description: "Spawns a new autonomous subagent to complete a complex task that requires multiple steps, research, or tools. Returns the final result of the subagent's execution.",
    inputSchema: z.object({
        objective: z.string().describe("The specific goal or task the subagent needs to accomplish."),
        context_hints: z.string().optional().describe("Any existing context, files, or information the subagent should know about."),
    }),
    timeoutMs: 300000, // 5 minutes for subagents
    execute: async (input: any, context: ToolContext): Promise<ToolResult> => {
        try {
            const subRunId = `sub_${randomUUID()}`;

            // Instantiate a new AgentOrchestrator for the subagent
            const subOrchestrator = new AgentOrchestrator(
                subRunId,
                context.chatId,
                context.userId,
                context.userPlan
            );

            // Start the subagent
            const initialPrompt = `[SUBAGENT GOAL]
Objective: ${input.objective}
${input.context_hints ? `Context: ${input.context_hints}` : ""}

Please achieve this objective and provide the final summary.`;

            // Trigger the main execution loop
            await subOrchestrator.generatePlan(initialPrompt, []);
            await subOrchestrator.run();

            // Wait until completed
            const pollDelay = 2000;
            let iterations = 0;
            while (subOrchestrator.status !== "completed" && subOrchestrator.status !== "failed" && subOrchestrator.status !== "cancelled") {
                if (iterations > 150) { // 5-minute timeout fallback
                    throw new Error("Subagent execution timed out.");
                }
                await new Promise(r => setTimeout(r, pollDelay));
                iterations++;
            }

            if (subOrchestrator.status === "failed") {
                return {
                    success: false,
                    output: `Subagent failed to complete task. Last status: ${subOrchestrator.status}. Processed ${subOrchestrator.stepResults.length} steps.`,
                    error: {
                        code: "SUBAGENT_FAILED",
                        message: "The spawned subagent encountered a fatal error.",
                        retryable: true
                    }
                }
            }

            const finalSummary = subOrchestrator.summary || subOrchestrator.stepResults.map(r => r.output).join("\\n");

            return {
                success: true,
                output: `Subagent completed successfully.\\n\\nOutput Summary:\\n${finalSummary}`,
                artifacts: subOrchestrator.artifacts,
            };

        } catch (e: any) {
            return {
                success: false,
                output: null,
                error: {
                    code: "SUBAGENT_ERROR",
                    message: e.message || "Failed to execute subagent",
                    retryable: false
                }
            }
        }
    }
};
