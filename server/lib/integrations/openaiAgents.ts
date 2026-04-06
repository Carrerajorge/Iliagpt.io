import { Logger } from "../logger";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

export interface AgentConfig {
  name: string;
  instructions: string;
  model?: string;
  tools?: any[];
  handoffs?: any[];
}

export interface AgentRunResult {
  output: string;
  toolCalls: Array<{ name: string; args: string; result: string }>;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
}

let _agentsModule: any = null;

async function getAgentsModule(): Promise<any> {
  if (_agentsModule) return _agentsModule;
  try {
    _agentsModule = await import("@openai/agents");
    return _agentsModule;
  } catch (err) {
    Logger.warn("[OpenAI Agents] Failed to load module", {
      error: (err as Error).message,
    });
    return null;
  }
}

export async function createAgent(config: AgentConfig): Promise<any> {
  const mod = await getAgentsModule();
  if (!mod) throw new Error("OpenAI Agents SDK not available");

  return new mod.Agent({
    name: config.name,
    instructions: config.instructions,
    model: config.model || "gpt-4o",
    tools: config.tools || [],
    handoffs: config.handoffs || [],
  });
}

export async function runAgent(
  agent: any,
  input: string,
): Promise<AgentRunResult> {
  const mod = await getAgentsModule();
  if (!mod) throw new Error("OpenAI Agents SDK not available");

  try {
    const result = await mod.run(agent, input);
    const finalOutput =
      typeof result.finalOutput === "string"
        ? result.finalOutput
        : JSON.stringify(result.finalOutput);
    return {
      output: finalOutput,
      toolCalls: [],
      model: agent.model || "gpt-4o",
    };
  } catch (err) {
    Logger.error("[OpenAI Agents] Run failed", {
      error: (err as Error).message,
    });
    throw err;
  }
}

export async function createFunctionTool(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  execute: (args: Record<string, unknown>) => Promise<string>,
): Promise<any> {
  const mod = await getAgentsModule();
  if (!mod?.tool) {
    return {
      type: "function",
      name,
      description,
      parameters,
      execute,
    };
  }

  try {
    const z = (await import("zod")).z;
    const paramSchema = z.object(
      Object.fromEntries(
        Object.entries(parameters).map(([key, val]) => {
          const type = (val as any)?.type;
          if (type === "number") return [key, z.number().optional()];
          if (type === "boolean") return [key, z.boolean().optional()];
          if (type === "array") return [key, z.array(z.any()).optional()];
          return [key, z.string().optional()];
        }),
      ),
    );

    return mod.tool({
      name,
      description,
      parameters: paramSchema,
      execute: async (args: any) => {
        const result = await execute(args);
        return result;
      },
    });
  } catch (err) {
    Logger.warn("[OpenAI Agents] tool() creation failed, using plain def", {
      name,
      error: (err as Error).message,
    });
    return { type: "function", name, description, parameters, execute };
  }
}

export async function convertToolRegistryToAgentTools(
  registry: {
    list: () => Array<{
      name: string;
      description: string;
      parameters?: Record<string, unknown>;
    }>;
    execute: (
      name: string,
      args: Record<string, unknown>,
      ctx: any,
    ) => Promise<unknown>;
  },
  executionContext: any,
): Promise<any[]> {
  const tools: any[] = [];
  for (const def of registry.list()) {
    try {
      const t = await createFunctionTool(
        def.name,
        def.description,
        def.parameters || {},
        async (args) => {
          const result = await registry.execute(
            def.name,
            args,
            executionContext,
          );
          return typeof result === "string" ? result : JSON.stringify(result);
        },
      );
      tools.push(t);
    } catch (err) {
      Logger.warn("[OpenAI Agents] Failed to convert tool", {
        tool: def.name,
        error: (err as Error).message,
      });
    }
  }
  return tools;
}

export async function createResearchAgent(): Promise<any> {
  return createAgent({
    name: "ResearchAgent",
    instructions: `You are a research assistant. Analyze the user's query and provide
    a comprehensive, well-structured answer with sources when possible.
    Focus on accuracy and depth. Respond in the same language as the user.`,
    model: "gpt-4o",
  });
}

export async function createCodeAgent(): Promise<any> {
  return createAgent({
    name: "CodeAgent",
    instructions: `You are a code expert. Help with code generation, debugging,
    and explanation. Provide clean, well-commented code. Follow best practices.
    When asked to fix code, explain what was wrong and why your fix works.`,
    model: "gpt-4o",
  });
}

export async function createTriageAgent(handoffs: any[]): Promise<any> {
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
