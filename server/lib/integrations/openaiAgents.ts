import { Agent, run } from "@openai/agents";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

export interface AgentConfig {
  name: string;
  instructions: string;
  model?: string;
  tools?: AgentToolDef[];
  handoffs?: Agent<any>[];
}

export interface AgentToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export function createAgent(config: AgentConfig): Agent<any> {
  const tools = (config.tools || []).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    execute: t.execute,
  }));

  return new Agent({
    name: config.name,
    instructions: config.instructions,
    model: config.model || "gpt-4o",
    tools: tools as any,
    handoffs: config.handoffs || [],
  });
}

export interface AgentRunResult {
  output: string;
  toolCalls: Array<{ name: string; args: string; result: string }>;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export async function runAgent(
  agent: Agent<any>,
  input: string,
  context?: Record<string, unknown>,
): Promise<AgentRunResult> {
  try {
    const result = await run(agent, input);
    const finalOutput = typeof result.finalOutput === "string"
      ? result.finalOutput
      : JSON.stringify(result.finalOutput);
    return {
      output: finalOutput,
      toolCalls: [],
      model: (agent as any).model || "gpt-4o",
    };
  } catch (err) {
    console.error("[OpenAI Agents] Run failed:", (err as Error).message);
    throw err;
  }
}

export function createResearchAgent(): Agent<any> {
  return createAgent({
    name: "ResearchAgent",
    instructions: `You are a research assistant. Analyze the user's query and provide 
    a comprehensive, well-structured answer with sources when possible. 
    Focus on accuracy and depth. Respond in the same language as the user.`,
    model: "gpt-4o",
  });
}

export function createCodeAgent(): Agent<any> {
  return createAgent({
    name: "CodeAgent",
    instructions: `You are a code expert. Help with code generation, debugging, 
    and explanation. Provide clean, well-commented code. Follow best practices.
    When asked to fix code, explain what was wrong and why your fix works.`,
    model: "gpt-4o",
  });
}

export function createTriageAgent(handoffs: Agent<any>[]): Agent<any> {
  return createAgent({
    name: "TriageAgent",
    instructions: `You are a triage agent. Analyze the user's request and delegate to 
    the most appropriate specialized agent. For research questions, delegate to ResearchAgent.
    For code-related tasks, delegate to CodeAgent. For general conversation, respond directly.`,
    model: "gpt-4o",
    handoffs,
  });
}

export function isAvailable(): boolean {
  return !!OPENAI_API_KEY && OPENAI_API_KEY.length > 10;
}
