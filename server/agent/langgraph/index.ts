import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";
import { plannerNode, executorNode, verifierNode, responderNode, humanApprovalNode, shouldContinue } from "./nodes";
import { checkpointer, memoryStore, type ConversationMemory } from "./memory";
import { ALL_TOOLS, SAFE_TOOLS, SYSTEM_TOOLS, getToolsByCategory } from "./tools";
import crypto from "crypto";

export interface AgentConfig {
  model?: string;
  temperature?: number;
  maxIterations?: number;
  timeout?: number;
  includeSystemTools?: boolean;
  enableHumanInLoop?: boolean;
  verbose?: boolean;
}

export interface ExecutionMetrics {
  startTime?: number;
  plannerLatencyMs?: number;
  executorLatencyMs?: number;
  verifierLatencyMs?: number;
  responderLatencyMs?: number;
  totalLatencyMs?: number;
  toolCallCount?: number;
}

export interface PendingApproval {
  id: string;
  action: string;
  toolName: string;
  args: Record<string, any>;
  timestamp: number;
}

export const AgentStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => {
      // Additive reducer: append new messages to existing ones.
      // Nodes should return only NEW messages, not the full array.
      // If a node returns the full array (contains prev messages), detect and use as-is.
      if (next.length > 0 && prev.length > 0 && next[0] === prev[0]) {
        return next; // Node returned full array including previous messages
      }
      return [...prev, ...next];
    },
    default: () => [],
  }),
  threadId: Annotation<string | undefined>({
    reducer: (prev, next) => next ?? prev,
    default: () => undefined,
  }),
  currentNode: Annotation<string>({
    reducer: (prev, next) => next,
    default: () => "start",
  }),
  nextNode: Annotation<string>({
    reducer: (prev, next) => next,
    default: () => "planner",
  }),
  iterations: Annotation<number>({
    reducer: (prev, next) => next,
    default: () => 0,
  }),
  config: Annotation<AgentConfig>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({}),
  }),
  toolsExecuted: Annotation<Array<{ name: string; success: boolean; latencyMs: number }>>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  executionMetrics: Annotation<ExecutionMetrics>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({}),
  }),
  finalResponse: Annotation<string | undefined>({
    reducer: (prev, next) => next,
    default: () => undefined,
  }),
  error: Annotation<string | undefined>({
    reducer: (prev, next) => next,
    default: () => undefined,
  }),
  verificationStatus: Annotation<string | undefined>({
    reducer: (prev, next) => next,
    default: () => undefined,
  }),
  requiresApproval: Annotation<boolean>({
    reducer: (prev, next) => next,
    default: () => false,
  }),
  pendingApprovals: Annotation<PendingApproval[]>({
    reducer: (prev, next) => next,
    default: () => [],
  }),
  interruptReason: Annotation<string | undefined>({
    reducer: (prev, next) => next,
    default: () => undefined,
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;

function createAgentGraph(config: AgentConfig = {}) {
  const graph = new StateGraph(AgentStateAnnotation);

  graph.addNode("planner", plannerNode);
  graph.addNode("executor", executorNode);
  graph.addNode("verifier", verifierNode);
  graph.addNode("responder", responderNode);

  if (config.enableHumanInLoop) {
    graph.addNode("human_approval", humanApprovalNode);
  }

  graph.addEdge(START, "planner");

  graph.addConditionalEdges("planner", shouldContinue, {
    executor: "executor",
    responder: "responder",
    __end__: END,
  });

  graph.addConditionalEdges("executor", shouldContinue, {
    verifier: "verifier",
    responder: "responder",
    __end__: END,
  });

  graph.addConditionalEdges("verifier", shouldContinue, {
    planner: "planner",
    responder: "responder",
    __end__: END,
  });

  graph.addEdge("responder", END);

  if (config.enableHumanInLoop) {
    graph.addConditionalEdges("human_approval", shouldContinue, {
      executor: "executor",
      __end__: END,
    });
  }

  return graph.compile({ checkpointer });
}

export interface RunInput {
  input: string;
  threadId?: string;
  config?: AgentConfig;
  systemPrompt?: string;
}

export interface RunResult {
  success: boolean;
  response: string;
  threadId: string;
  metrics: ExecutionMetrics;
  toolsExecuted: Array<{ name: string; success: boolean; latencyMs: number }>;
  error?: string;
}

export interface StreamChunk {
  type: "node_start" | "node_end" | "tool_call" | "tool_result" | "response" | "error" | "done";
  node?: string;
  content?: string;
  tool?: { name: string; args?: Record<string, any>; result?: string };
  metrics?: Partial<ExecutionMetrics>;
  timestamp: number;
}

export class LangGraphAgent {
  private config: AgentConfig;
  private graph: ReturnType<typeof createAgentGraph>;

  constructor(config: AgentConfig = {}) {
    this.config = {
      model: "grok-4-1-fast-non-reasoning",
      maxIterations: 10,
      timeout: 120000,
      includeSystemTools: process.env.ILIAGPT_LOCAL_FULL_ACCESS === "true",
      enableHumanInLoop: false,
      verbose: false,
      ...config,
    };
    this.graph = createAgentGraph(this.config);
  }

  private generateThreadId(): string {
    return `thread_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
  }

  async run(input: RunInput): Promise<RunResult> {
    const threadId = input.threadId || this.generateThreadId();
    const startTime = Date.now();

    try {
      const messages: BaseMessage[] = [];

      if (input.systemPrompt) {
        messages.push(new SystemMessage(input.systemPrompt));
      }

      messages.push(new HumanMessage(input.input));

      await memoryStore.addMessage(threadId, "user", input.input);

      const initialState: Partial<AgentState> = {
        messages,
        threadId,
        config: { ...this.config, ...input.config },
        iterations: 0,
        toolsExecuted: [],
        executionMetrics: { startTime },
      };

      const runnableConfig = {
        configurable: { thread_id: threadId },
      };

      let finalState: AgentState | undefined;

      for await (const event of await this.graph.stream(initialState, runnableConfig)) {
        const nodeEntries = Object.entries(event);
        for (const [nodeName, nodeState] of nodeEntries) {
          if (this.config.verbose) {
            console.log(`[LangGraphAgent] Node ${nodeName} completed`);
          }
          finalState = nodeState as AgentState;
        }
      }

      const response = finalState?.finalResponse || "No response generated";
      const metrics = finalState?.executionMetrics || {};
      metrics.totalLatencyMs = Date.now() - startTime;

      return {
        success: !finalState?.error,
        response,
        threadId,
        metrics,
        toolsExecuted: finalState?.toolsExecuted || [],
        error: finalState?.error,
      };
    } catch (error: any) {
      console.error("[LangGraphAgent] Run error:", error);
      return {
        success: false,
        response: `Agent error: ${error.message}`,
        threadId,
        metrics: { totalLatencyMs: Date.now() - startTime },
        toolsExecuted: [],
        error: error.message,
      };
    }
  }

  async *stream(input: RunInput): AsyncGenerator<StreamChunk> {
    const threadId = input.threadId || this.generateThreadId();
    const startTime = Date.now();

    try {
      const messages: BaseMessage[] = [];

      if (input.systemPrompt) {
        messages.push(new SystemMessage(input.systemPrompt));
      }

      messages.push(new HumanMessage(input.input));

      await memoryStore.addMessage(threadId, "user", input.input);

      const initialState: Partial<AgentState> = {
        messages,
        threadId,
        config: { ...this.config, ...input.config },
        iterations: 0,
        toolsExecuted: [],
        executionMetrics: { startTime },
      };

      const runnableConfig = {
        configurable: { thread_id: threadId },
      };

      for await (const event of await this.graph.stream(initialState, runnableConfig)) {
        const nodeEntries = Object.entries(event);
        for (const [nodeName, nodeState] of nodeEntries) {
          const state = nodeState as AgentState;

          yield {
            type: "node_start",
            node: nodeName,
            timestamp: Date.now(),
          };

          if (state.toolsExecuted && state.toolsExecuted.length > 0) {
            const lastTool = state.toolsExecuted[state.toolsExecuted.length - 1];
            yield {
              type: "tool_result",
              tool: { name: lastTool.name, result: lastTool.success ? "success" : "failed" },
              timestamp: Date.now(),
            };
          }

          if (state.finalResponse) {
            yield {
              type: "response",
              content: state.finalResponse,
              metrics: state.executionMetrics,
              timestamp: Date.now(),
            };
          }

          if (state.error) {
            yield {
              type: "error",
              content: state.error,
              timestamp: Date.now(),
            };
          }

          yield {
            type: "node_end",
            node: nodeName,
            timestamp: Date.now(),
          };
        }
      }

      yield {
        type: "done",
        metrics: { totalLatencyMs: Date.now() - startTime },
        timestamp: Date.now(),
      };
    } catch (error: any) {
      yield {
        type: "error",
        content: error.message,
        timestamp: Date.now(),
      };
    }
  }

  async getConversationHistory(threadId: string): Promise<ConversationMemory | null> {
    return memoryStore.get(threadId);
  }

  async clearConversation(threadId: string): Promise<void> {
    await memoryStore.delete(threadId);
    await checkpointer.delete({ configurable: { thread_id: threadId } });
  }

  async resumeWithApproval(
    threadId: string,
    approvalId: string,
    approved: boolean
  ): Promise<RunResult> {
    const startTime = Date.now();

    try {
      const checkpoint = await checkpointer.getTuple({
        configurable: { thread_id: threadId },
      });

      if (!checkpoint) {
        return {
          success: false,
          response: "No pending approval found",
          threadId,
          metrics: { totalLatencyMs: Date.now() - startTime },
          toolsExecuted: [],
          error: "Checkpoint not found",
        };
      }

      const state = checkpoint.checkpoint as unknown as AgentState;
      const pendingApprovals = state.pendingApprovals || [];
      const approvalIndex = pendingApprovals.findIndex((a) => a.id === approvalId);

      if (approvalIndex === -1) {
        return {
          success: false,
          response: "Approval ID not found",
          threadId,
          metrics: { totalLatencyMs: Date.now() - startTime },
          toolsExecuted: [],
          error: "Approval not found",
        };
      }

      if (approved) {
        pendingApprovals.splice(approvalIndex, 1);
        const updatedState: Partial<AgentState> = {
          ...state,
          pendingApprovals,
          requiresApproval: pendingApprovals.length > 0,
          nextNode: pendingApprovals.length > 0 ? "human_approval" : "executor",
        };

        const runnableConfig = {
          configurable: { thread_id: threadId, checkpoint_id: checkpoint.config.configurable?.checkpoint_id },
        };

        let finalState: AgentState | undefined;

        for await (const event of await this.graph.stream(updatedState, runnableConfig)) {
          for (const [, nodeState] of Object.entries(event)) {
            finalState = nodeState as AgentState;
          }
        }

        return {
          success: !finalState?.error,
          response: finalState?.finalResponse || "Execution completed",
          threadId,
          metrics: { totalLatencyMs: Date.now() - startTime },
          toolsExecuted: finalState?.toolsExecuted || [],
          error: finalState?.error,
        };
      } else {
        return {
          success: true,
          response: "Action was rejected by user",
          threadId,
          metrics: { totalLatencyMs: Date.now() - startTime },
          toolsExecuted: [],
        };
      }
    } catch (error: any) {
      return {
        success: false,
        response: `Resume error: ${error.message}`,
        threadId,
        metrics: { totalLatencyMs: Date.now() - startTime },
        toolsExecuted: [],
        error: error.message,
      };
    }
  }

  getAvailableTools(): Array<{ name: string; description: string; category: string }> {
    const tools = this.config.includeSystemTools ? ALL_TOOLS : SAFE_TOOLS;
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      category: "general",
    }));
  }

  updateConfig(config: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...config };
    this.graph = createAgentGraph(this.config);
  }
}

let defaultAgent: LangGraphAgent | null = null;

export function getDefaultAgent(): LangGraphAgent {
  if (!defaultAgent) {
    defaultAgent = new LangGraphAgent();
  }
  return defaultAgent;
}

export function createAgent(config?: AgentConfig): LangGraphAgent {
  return new LangGraphAgent(config);
}

export { ALL_TOOLS, SAFE_TOOLS, SYSTEM_TOOLS, getToolsByCategory } from "./tools";
export { checkpointer, memoryStore, type ConversationMemory } from "./memory";
export { plannerNode, executorNode, verifierNode, responderNode, humanApprovalNode } from "./nodes";
export { 
  initializeAgents, 
  getAllAgents, 
  getAgent, 
  getAgentSummary, 
  SPECIALIZED_AGENTS,
  orchestratorAgent,
  researchAgent,
  codeAgent,
  dataAgent,
  contentAgent,
  communicationAgent,
  browserAgent,
  documentAgent,
  qaAgent,
  securityAgent,
} from "./agents";
