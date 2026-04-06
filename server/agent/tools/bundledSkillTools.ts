import { z } from "zod";
import type { ToolDefinition, ToolContext, ToolResult } from "../toolRegistry";
import { BUNDLED_SKILLS } from "../../data/bundledSkills";
import { skillRegistry } from "../../openclaw/skills/skillRegistry";
import { normalizeOpenClawSkillStatus } from "@shared/skillsRuntime";

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
        execute: async (
            input: { instruction: string; data?: unknown },
            _context: ToolContext,
        ): Promise<ToolResult> => {
            const startTime = Date.now();
            try {
                const runtimeSkill = skillRegistry.get(skill.id);
                if (!runtimeSkill) {
                    return {
                        success: false,
                        output: null,
                        error: {
                            code: "SKILL_CATALOG_ONLY",
                            message: `La skill ${skill.name} está listada en el catálogo, pero no tiene un runtime ejecutable activo.`,
                            retryable: false,
                            details: {
                                skillId: skill.id,
                                reason: "runtime_missing",
                            },
                        },
                        metrics: { durationMs: Date.now() - startTime }
                    };
                }

                const runtimeStatus = normalizeOpenClawSkillStatus(runtimeSkill.status);
                if (runtimeStatus !== "ready") {
                    return {
                        success: false,
                        output: null,
                        error: {
                            code: "SKILL_NOT_READY",
                            message: `La skill ${skill.name} existe en runtime, pero su estado actual es ${runtimeStatus}.`,
                            retryable: false,
                            details: {
                                skillId: skill.id,
                                status: runtimeStatus,
                                source: runtimeSkill.source || "builtin",
                            },
                        },
                        metrics: { durationMs: Date.now() - startTime }
                    };
                }

                return {
                    success: false,
                    output: null,
                    error: {
                        code: "SKILL_BRIDGE_NOT_IMPLEMENTED",
                        message: `La skill ${skill.name} está registrada en OpenClaw, pero este bridge aún no tiene una ruta de ejecución nativa segura.`,
                        retryable: false,
                        details: {
                            skillId: skill.id,
                            status: runtimeStatus,
                            source: runtimeSkill.source || "builtin",
                            requestedInstruction: input.instruction,
                            hasStructuredData: input.data !== undefined,
                        },
                    },
                    metrics: { durationMs: Date.now() - startTime }
                };
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    success: false,
                    output: null,
                    error: {
                        code: "SKILL_EXECUTION_ERROR",
                        message: `Failed to execute skill ${skill.name}: ${message}`,
                        retryable: true,
                    },
                    metrics: { durationMs: Date.now() - startTime }
                };
            }
        }
    };
});
