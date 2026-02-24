import { AIMessage, HumanMessage, SystemMessage, ToolMessage, BaseMessage } from "@langchain/core/messages";
import { ToolCall } from "@langchain/core/messages/tool";
import { DynamicStructuredTool } from "@langchain/core/tools";
import OpenAI from "openai";
import { ALL_TOOLS, getToolByName } from "./tools";
import { memoryStore } from "./memory";
import type { AgentState } from "./index";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

function validateAndFixToolArgs(
  tool: DynamicStructuredTool<any>,
  args: Record<string, any>,
  userMessage: string
): { valid: boolean; fixedArgs: Record<string, any>; error?: string; validationErrors?: string[] } {
  const schema = tool.schema;
  if (!schema) {
    return { valid: true, fixedArgs: args };
  }

  const parseResult = schema.safeParse(args);
  
  if (parseResult.success) {
    return { valid: true, fixedArgs: parseResult.data };
  }

  const errors = parseResult.error.errors;
  const validationErrors = errors.map(e => `${e.path.join('.')}: ${e.message}`);
  const fixedArgs = { ...args };
  let fixApplied = false;

  for (const error of errors) {
    const path = error.path[0] as string;
    
    if (!path) continue;
    
    if (error.code === 'invalid_type' && error.received === 'undefined') {
      if (['task', 'goal', 'query', 'question', 'content', 'text', 'statement', 'topic'].includes(path)) {
        fixedArgs[path] = userMessage;
        fixApplied = true;
      }
    }
  }

  if (fixApplied) {
    const revalidate = schema.safeParse(fixedArgs);
    if (revalidate.success) {
      return { 
        valid: true, 
        fixedArgs: revalidate.data, 
        error: `Auto-fixed: ${validationErrors.join('; ')}`,
        validationErrors 
      };
    }
  }

  return { 
    valid: false, 
    fixedArgs: args, 
    error: `Schema validation failed: ${validationErrors.join('; ')}`,
    validationErrors 
  };
}

interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

function getToolDefinitions(tools = ALL_TOOLS): ToolDef[] {
  return tools.map((tool) => {
    let parameters: Record<string, any> = { type: "object", properties: {} };
    
    if (tool.schema) {
      try {
        const jsonSchema = zodToJsonSchema(tool.schema, { $refStrategy: "none" });
        if (typeof jsonSchema === "object" && jsonSchema !== null) {
          const { $schema, ...rest } = jsonSchema as Record<string, any>;
          parameters = rest;
        }
      } catch (e) {
        console.error(`[getToolDefinitions] Failed to convert schema for ${tool.name}:`, e);
      }
    }
    
    return {
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters,
      },
    };
  });
}

function messagesToOpenAI(messages: BaseMessage[]): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((msg) => {
    if (msg instanceof SystemMessage) {
      return { role: "system" as const, content: msg.content as string };
    }
    if (msg instanceof HumanMessage) {
      return { role: "user" as const, content: msg.content as string };
    }
    if (msg instanceof AIMessage) {
      const aiMsg: OpenAI.ChatCompletionMessageParam = {
        role: "assistant" as const,
        content: msg.content as string || null,
      };
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        aiMsg.tool_calls = msg.tool_calls.map((tc: ToolCall) => ({
          id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: "function" as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        }));
      }
      return aiMsg;
    }
    if (msg instanceof ToolMessage) {
      return {
        role: "tool" as const,
        content: msg.content as string,
        tool_call_id: msg.tool_call_id,
      };
    }
    return { role: "user" as const, content: String(msg.content) };
  });
}

const PLANNER_SYSTEM_PROMPT = `You are an intelligent planner agent. Your role is to:
1. Analyze user requests and break them into actionable steps
2. Decide which tools to use to accomplish the task
3. Create a clear execution plan

Available tools: ${ALL_TOOLS.map((t) => `${t.name}: ${t.description}`).join("\n")}

When planning:
- Be specific about which tools to use and in what order
- Consider dependencies between steps
- If the request is simple, you can proceed directly to tool execution
- If clarification is needed, ask the user

Output your plan as a JSON object with:
{
  "analysis": "Brief analysis of the request",
  "steps": [{"step": 1, "action": "description", "tool": "tool_name"}],
  "ready_to_execute": true/false
}

If ready to execute, call the appropriate tool(s).`;

export async function plannerNode(state: AgentState): Promise<Partial<AgentState>> {
  const { messages, threadId } = state;
  const startTime = Date.now();

  try {
    const systemMsg = new SystemMessage(PLANNER_SYSTEM_PROMPT);
    const allMessages = [systemMsg, ...messages];

    const response = await xaiClient.chat.completions.create({
      model: state.config?.model || DEFAULT_MODEL,
      messages: messagesToOpenAI(allMessages),
      tools: getToolDefinitions(),
      tool_choice: "auto",
      temperature: 0.3,
    });

    const choice = response.choices[0];
    const assistantMessage = choice.message;
    const toolCalls = assistantMessage.tool_calls;

    const aiMessage = new AIMessage({
      content: assistantMessage.content || "",
      tool_calls: toolCalls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        args: JSON.parse(tc.function.arguments || "{}"),
      })),
    });

    let nextNode: string;
    if (toolCalls && toolCalls.length > 0) {
      nextNode = "executor";
    } else {
      nextNode = "responder";
    }

    if (threadId) {
      await memoryStore.addMessage(threadId, "assistant", assistantMessage.content || "");
    }

    return {
      messages: [...messages, aiMessage],
      currentNode: "planner",
      nextNode,
      executionMetrics: {
        ...state.executionMetrics,
        plannerLatencyMs: Date.now() - startTime,
      },
    };
  } catch (error: any) {
    console.error("[PlannerNode] Error:", error.message);
    return {
      messages: [...messages, new AIMessage({ content: `Planning error: ${error.message}` })],
      currentNode: "planner",
      nextNode: "responder",
      error: error.message,
    };
  }
}

export async function executorNode(state: AgentState): Promise<Partial<AgentState>> {
  const { messages, threadId } = state;
  const startTime = Date.now();
  const toolResults: ToolMessage[] = [];
  const executedTools: Array<{ name: string; success: boolean; latencyMs: number }> = [];

  const lastAiMessage = [...messages].reverse().find((m) => m instanceof AIMessage) as AIMessage | undefined;
  const lastUserMessage = [...messages].reverse().find((m) => m instanceof HumanMessage) as HumanMessage | undefined;
  const userMessageContent = (lastUserMessage?.content as string) || "";

  if (!lastAiMessage?.tool_calls || lastAiMessage.tool_calls.length === 0) {
    return {
      currentNode: "executor",
      nextNode: "verifier",
    };
  }

  for (const toolCall of lastAiMessage.tool_calls) {
    const toolStartTime = Date.now();
    const tool = getToolByName(toolCall.name);

    if (!tool) {
      toolResults.push(
        new ToolMessage({
          content: JSON.stringify({ success: false, error: `Tool '${toolCall.name}' not found` }),
          tool_call_id: toolCall.id || `call_${Date.now()}`,
        })
      );
      executedTools.push({ name: toolCall.name, success: false, latencyMs: Date.now() - toolStartTime });
      continue;
    }

    const validation = validateAndFixToolArgs(tool, toolCall.args || {}, userMessageContent);
    
    if (validation.error) {
      console.log(`[ExecutorNode] ${toolCall.name}: ${validation.error}`);
    }

    if (!validation.valid) {
      console.error(`[ExecutorNode] ${toolCall.name}: Validation failed, cannot auto-fix`);
      toolResults.push(
        new ToolMessage({
          content: JSON.stringify({ 
            success: false, 
            error: validation.error,
            hint: "The tool requires specific parameters that could not be inferred. Please provide the required fields explicitly.",
            requiredFields: validation.validationErrors 
          }),
          tool_call_id: toolCall.id || `call_${Date.now()}`,
        })
      );
      executedTools.push({ name: toolCall.name, success: false, latencyMs: Date.now() - toolStartTime });
      continue;
    }

    const argsToUse = validation.fixedArgs;

    try {
      const result = await tool.invoke(argsToUse);

      toolResults.push(
        new ToolMessage({
          content: typeof result === "string" ? result : JSON.stringify(result),
          tool_call_id: toolCall.id || `call_${Date.now()}`,
        })
      );

      executedTools.push({ name: toolCall.name, success: true, latencyMs: Date.now() - toolStartTime });

      if (threadId) {
        await memoryStore.addMessage(threadId, "tool", typeof result === "string" ? result : JSON.stringify(result), [
          { name: toolCall.name, args: argsToUse, result: typeof result === "string" ? result : JSON.stringify(result) },
        ]);
      }
    } catch (error: any) {
      console.error(`[ExecutorNode] Tool ${toolCall.name} error:`, error.message);
      
      toolResults.push(
        new ToolMessage({
          content: JSON.stringify({ 
            success: false, 
            error: error.message,
            toolName: toolCall.name,
            argsProvided: Object.keys(argsToUse)
          }),
          tool_call_id: toolCall.id || `call_${Date.now()}`,
        })
      );
      executedTools.push({ name: toolCall.name, success: false, latencyMs: Date.now() - toolStartTime });
    }
  }

  return {
    messages: [...messages, ...toolResults],
    currentNode: "executor",
    nextNode: "verifier",
    toolsExecuted: [...(state.toolsExecuted || []), ...executedTools],
    executionMetrics: {
      ...state.executionMetrics,
      executorLatencyMs: Date.now() - startTime,
      toolCallCount: (state.executionMetrics?.toolCallCount || 0) + executedTools.length,
    },
  };
}

const VERIFIER_SYSTEM_PROMPT = `You are a verification agent. Your role is to:
1. Review the tool execution results
2. Check if the task was completed successfully
3. Identify any errors or issues
4. Determine if more actions are needed

Based on your analysis, respond with a JSON object:
{
  "status": "success" | "partial" | "failed" | "needs_more_action",
  "summary": "Brief summary of what was accomplished",
  "issues": ["List of any issues found"],
  "recommendation": "What to do next"
}

If status is "needs_more_action", we'll go back to planning.
If status is "success" or "partial", we'll proceed to respond to the user.
If status is "failed", we'll report the failure.`;

export async function verifierNode(state: AgentState): Promise<Partial<AgentState>> {
  const { messages, iterations = 0 } = state;
  const startTime = Date.now();
  const maxIterations = state.config?.maxIterations || 10;

  if (iterations >= maxIterations) {
    return {
      currentNode: "verifier",
      nextNode: "responder",
      verificationStatus: "max_iterations_reached",
    };
  }

  try {
    const recentMessages = messages.slice(-10);
    const systemMsg = new SystemMessage(VERIFIER_SYSTEM_PROMPT);

    const response = await xaiClient.chat.completions.create({
      model: state.config?.model || DEFAULT_MODEL,
      messages: messagesToOpenAI([systemMsg, ...recentMessages]),
      temperature: 0.2,
    });

    const content = response.choices[0].message.content || "";
    let verification: { status: string; summary: string; issues?: string[]; recommendation?: string };

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      verification = jsonMatch ? JSON.parse(jsonMatch[0]) : { status: "success", summary: content };
    } catch {
      verification = { status: "success", summary: content };
    }

    let nextNode: string;
    if (verification.status === "needs_more_action" && iterations < maxIterations - 1) {
      nextNode = "planner";
    } else {
      nextNode = "responder";
    }

    return {
      messages: [...messages, new AIMessage({ content: `[Verification] ${verification.summary}` })],
      currentNode: "verifier",
      nextNode,
      iterations: iterations + 1,
      verificationStatus: verification.status,
      executionMetrics: {
        ...state.executionMetrics,
        verifierLatencyMs: Date.now() - startTime,
      },
    };
  } catch (error: any) {
    console.error("[VerifierNode] Error:", error.message);
    return {
      currentNode: "verifier",
      nextNode: "responder",
      verificationStatus: "error",
      error: error.message,
    };
  }
}

const RESPONDER_SYSTEM_PROMPT = `You are a helpful assistant responding to the user.
Based on the conversation and tool results, provide a clear, helpful response.
- Summarize what was accomplished
- Include relevant details from tool outputs
- If there were errors, explain them clearly
- Be concise but thorough`;

export async function responderNode(state: AgentState): Promise<Partial<AgentState>> {
  const { messages, threadId } = state;
  const startTime = Date.now();

  try {
    const systemMsg = new SystemMessage(RESPONDER_SYSTEM_PROMPT);

    const response = await xaiClient.chat.completions.create({
      model: state.config?.model || DEFAULT_MODEL,
      messages: messagesToOpenAI([systemMsg, ...messages]),
      temperature: 0.7,
    });

    const content = response.choices[0].message.content || "";
    const finalMessage = new AIMessage({ content });

    if (threadId) {
      await memoryStore.addMessage(threadId, "assistant", content);
    }

    return {
      messages: [...messages, finalMessage],
      currentNode: "responder",
      nextNode: "__end__",
      finalResponse: content,
      executionMetrics: {
        ...state.executionMetrics,
        responderLatencyMs: Date.now() - startTime,
        totalLatencyMs: Date.now() - (state.executionMetrics?.startTime || startTime),
      },
    };
  } catch (error: any) {
    console.error("[ResponderNode] Error:", error.message);
    return {
      messages: [...messages, new AIMessage({ content: `Error generating response: ${error.message}` })],
      currentNode: "responder",
      nextNode: "__end__",
      error: error.message,
    };
  }
}

export async function humanApprovalNode(state: AgentState): Promise<Partial<AgentState>> {
  const pendingApprovals = state.pendingApprovals || [];

  if (pendingApprovals.length === 0) {
    return {
      currentNode: "human_approval",
      nextNode: "executor",
      requiresApproval: false,
    };
  }

  return {
    currentNode: "human_approval",
    nextNode: "__interrupt__",
    requiresApproval: true,
    interruptReason: `Approval required for: ${pendingApprovals.map((a) => a.action).join(", ")}`,
  };
}

export function shouldRoute(state: AgentState): string {
  if (state.error && state.iterations && state.iterations >= (state.config?.maxIterations || 10)) {
    return "responder";
  }

  if (state.requiresApproval) {
    return "human_approval";
  }

  return state.nextNode || "responder";
}

export function shouldContinue(state: AgentState): string {
  if (state.nextNode === "__end__") {
    return "__end__";
  }

  if (state.nextNode === "__interrupt__") {
    return "__end__";
  }

  return state.nextNode || "__end__";
}
