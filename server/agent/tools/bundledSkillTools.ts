import { z } from "zod";
import type { ToolDefinition, ToolContext, ToolResult } from "../toolRegistry";
import { defaultToolRegistry as sandboxToolRegistry } from "../sandbox/tools";
import { BUNDLED_SKILLS } from "../../data/bundledSkills";

export const BUNDLED_SKILL_TOOLS: ToolDefinition[] = BUNDLED_SKILLS.map(skill => {
    // Replace invalid characters in tool name (Zod/Gemini allows a-zA-Z0-9_-)
    const safeName = skill.id.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 60);

    return {
        name: `skill_${safeName}`,
        description: `Execute the '${skill.name}' skill. Category: ${skill.category}. ${skill.description}`,
        inputSchema: z.object({
            instruction: z.string().describe("Specific instructions or goals for this skill. What do you want it to accomplish?"),
            data: z.any().optional().describe("Optional structured data or parameters required for the skill execution.")
        }),
        capabilities: ["executes_code", "requires_network"],
        execute: async (input: { instruction: string; data?: any }, context: ToolContext): Promise<ToolResult> => {
            const startTime = Date.now();
            try {
                // Mock Implementation / Base Handler for the skill
                // We delegate to the sandbox shell to simulate execution

                const shellCommand = `echo "=== SKILL EXECUTION STARTED ===" && echo "Skill: ${skill.name} (${skill.category})" && echo "Instruction: ${input.instruction.replace(/"/g, '\\"')}" && echo "Data provided: ${input.data ? 'Yes' : 'No'}" && echo "=== EXECUTING ===" && sleep 1 && echo "Execution succeeded."`;

                const sandboxResult = await sandboxToolRegistry.execute("shell", {
                    command: shellCommand
                });

                // Simulate a successful structured extraction/result
                return {
                    success: sandboxResult.success,
                    output: {
                        message: `Successfully executed skill: ${skill.name}`,
                        agentic_result: sandboxResult.data || sandboxResult.message,
                        provided_instruction: input.instruction
                    },
                    metrics: { durationMs: Date.now() - startTime }
                };
            } catch (error: any) {
                return {
                    success: false,
                    output: null,
                    error: {
                        code: "SKILL_EXECUTION_ERROR",
                        message: `Failed to execute skill ${skill.name}: ${error.message}`,
                        retryable: true
                    },
                    metrics: { durationMs: Date.now() - startTime }
                };
            }
        }
    };
});
