import { z } from "zod";
import OpenAI from "openai";
import { BaseAgent, BaseAgentConfig, AgentTask, AgentResult, AgentCapability } from "./types";

const xaiClient = new OpenAI({
    baseURL: "https://api.x.ai/v1",
    apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export class CriticAgent extends BaseAgent {
    constructor() {
        const config: BaseAgentConfig = {
            name: "CriticAgent",
            description: "Rigorous evaluator and verifier. Audits the work of other agents against the original prompt and flags errors or hallucinations before they reach the user.",
            model: DEFAULT_MODEL,
            temperature: 0.0,
            maxTokens: 4096,
            systemPrompt: `You are the CriticAgent - an uncompromising, detail-oriented auditor in a multi-agent system.

Your responsibilities:
1. Verify Accuracy: Check the generated output against the original user prompt. Does it actually answer the question?
2. Fact Check: Flag any hallucinations, contradictions, or unsupported claims.
3. Code Execution Validation: If reviewing code, look for edge cases, missing imports, infinite loops, and security vulnerabilities.
4. Formatting: Ensure the output matches the requested format (JSON, Markdown, CSV, etc).
5. Actionable Feedback: If the output fails your audit, you MUST provide precise, actionable feedback on how the previous agent should fix it.

DO NOT REWRITE THE CONTENT YOURSELF. Your job is ONLY to evaluate it and output a strict VERDICT. 

Output format expected:
{
  "verdict": "PASS" | "FAIL",
  "score": 0-10,
  "critique": "Detailed explanation of what is wrong (if anything)",
  "feedback_for_worker": "Exact instructions on how to fix the issues"
}`,
            tools: ["verify_output", "fact_check"],
            timeout: 120000,
            maxIterations: 5,
        };
        super(config);
    }

    async execute(task: AgentTask): Promise<AgentResult> {
        const startTime = Date.now();
        this.updateState({ status: "running", currentTask: task.description, startedAt: new Date().toISOString() });

        try {
            const { originalPrompt, workerOutput, workerType } = task.input;

            const response = await xaiClient.chat.completions.create({
                model: this.config.model,
                messages: [
                    { role: "system", content: this.config.systemPrompt },
                    {
                        role: "user",
                        content: `Original User Request:
${originalPrompt}

Agent (${workerType}) Output:
${typeof workerOutput === 'string' ? workerOutput : JSON.stringify(workerOutput, null, 2)}

Provide your evaluation in strict JSON format.`,
                    },
                ],
                temperature: this.config.temperature,
            });

            const content = response.choices[0].message.content || "{}";
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            const parsedContent = jsonMatch ? JSON.parse(jsonMatch[0]) : {
                verdict: "FAIL",
                score: 0,
                critique: "Failed to parse JSON response from LLM",
                feedback_for_worker: "Critic Error"
            };

            const success = parsedContent.verdict === "PASS";

            this.updateState({ status: "completed", progress: 100, completedAt: new Date().toISOString() });

            return {
                taskId: task.id,
                agentId: this.state.id,
                success,
                output: parsedContent,
                duration: Date.now() - startTime,
            };
        } catch (error: any) {
            this.updateState({ status: "failed", error: error.message });
            return {
                taskId: task.id,
                agentId: this.state.id,
                success: false,
                error: error.message,
                duration: Date.now() - startTime,
            };
        }
    }

    getCapabilities(): AgentCapability[] {
        return [
            {
                name: "verify_output",
                description: "Evaluate the output of another agent against the initial prompt.",
                inputSchema: z.object({
                    originalPrompt: z.string(),
                    workerOutput: z.any(),
                    workerType: z.string(),
                }),
                outputSchema: z.object({
                    verdict: z.string(),
                    score: z.number(),
                    critique: z.string(),
                    feedback_for_worker: z.string(),
                }),
            }
        ];
    }
}

export const criticAgent = new CriticAgent();
