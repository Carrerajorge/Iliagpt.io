import { toolRegistry, type ToolDefinition, type ToolContext, type ToolResult } from "../../agent/toolRegistry";
import { policyEngine } from "../../agent/policyEngine";
import { loadSkillsFromFilesystem } from "./filesystemSkillLoader";
import { z } from "zod";
import path from "path";
import os from "os";
import { getOpenClawConfig } from "../config";
import { createLogger } from "../../utils/logger";

const log = createLogger("openclaw-clawi-skill-adapter");

// We adapt the Clawi Skill structure to Hola's ToolRegistry ToolDefinition
export async function initializeClawiSkills() {
    const baseConfig = getOpenClawConfig();
    const workspaceDirectory = process.cwd();
    const internalSkillsDir = path.join(workspaceDirectory, "server", "openclaw", "skills");
    const desktopClawiSkillsDir = path.join(os.homedir(), "Desktop", "clawi", "openclaw", "skills");
    const extraDirectories = Array.from(
        new Set([
            ...(baseConfig.skills.extraDirectories || []),
            desktopClawiSkillsDir,
        ]),
    );
    const config = {
        ...baseConfig,
        skills: {
            ...baseConfig.skills,
            directory: internalSkillsDir,
            extraDirectories,
            workspaceDirectory,
            autoImportClawi: true,
        }
    };

    try {
        const result = await loadSkillsFromFilesystem(config as any);
        let loadedCount = 0;

        for (const skill of result.skills) {
            if (toolRegistry.get(skill.id)) {
                continue;
            }

            const clawiTool: ToolDefinition = {
                name: skill.id,
                description: skill.description || `Clawi Skill: ${skill.name}`,
                inputSchema: z.object({
                    // The exact input parameters would depend on LLM knowing the bash command,
                    // so we expect a generic prompt or query input to drive the skill's inner commands.
                    input: z.string().describe("Input parameters or query for the skill"),
                }),
                execute: async (inputParams: Record<string, any>, _context: ToolContext): Promise<ToolResult> => {
                    try {
                        // Because Clawi skills are primarily prompt-based wrappers that use bash tools or browser,
                        // the LLM should use the skill prompt to understand *how* to use the underlying tools.
                        // When executing the skill directly, we inject the prompt instructions into the pipeline.
                        return {
                            success: true,
                            output: `Skill '${skill.name}' instruction prompt:\n\n${skill.prompt}\n\nPlease execute the relevant shell or web actions described above with the input: ${inputParams.input}`,
                        };
                    } catch (e: unknown) {
                        const err = e as Error;
                        return {
                            success: false,
                            output: null,
                            error: {
                                message: err.message || "Skill execution error",
                                code: "SKILL_ERROR",
                                retryable: false,
                            }
                        }
                    }
                }
            };

            toolRegistry.register(clawiTool);
            if (!policyEngine.getPolicy(skill.id)) {
                policyEngine.registerPolicy({
                    toolName: skill.id,
                    capabilities: [],
                    allowedPlans: ["free", "pro", "admin"],
                    requiresConfirmation: false,
                    maxExecutionTimeMs: 60000,
                    maxRetries: 1,
                    deniedByDefault: false,
                });
            }
            loadedCount++;
        }
        log.info(`Successfully registered ${loadedCount} Clawi skills into ToolRegistry`);
    } catch (error) {
        log.error(`Failed to load Clawi skills: ${error instanceof Error ? error.message : String(error)}`);
    }
}
