import vm from "vm";
import lodash from "lodash";
import type { IMessage, IReactFlowNode, IReactFlowObject } from "../../packages/flowise-server/src/Interface";
import { contextManager } from "../agent/context";

export interface EmbeddedFlowInput {
  question: string;
  chatHistory?: IMessage[];
  uploadedFilesContent?: string;
}

export interface EmbeddedFlowExecution {
  runId: string;
  flow: IReactFlowObject | string;
  input: EmbeddedFlowInput;
  metadata?: Record<string, any>;
}

const { cloneDeep } = lodash;
type FlowiseEdge = { source: string; target: string };

const constructGraphs = (nodes: IReactFlowNode[], edges: FlowiseEdge[]) => {
  const nodeDependencies: Record<string, number> = {};
  const graph: Record<string, string[]> = {};
  for (const node of nodes) {
    nodeDependencies[node.id] = 0;
    graph[node.id] = [];
  }
  for (const edge of edges) {
    if (!graph[edge.source]) {
      graph[edge.source] = [];
    }
    graph[edge.source].push(edge.target);
    nodeDependencies[edge.target] = (nodeDependencies[edge.target] ?? 0) + 1;
  }
  return { graph, nodeDependencies };
};

const getEndingNodes = (
  nodeDependencies: Record<string, number>,
  graph: Record<string, string[]>,
  allNodes: IReactFlowNode[],
) => {
  const endingNodeIds: string[] = [];
  for (const nodeId of Object.keys(graph)) {
    if (Object.keys(nodeDependencies).length === 1) {
      endingNodeIds.push(nodeId);
    } else if (!graph[nodeId]?.length && nodeDependencies[nodeId] > 0) {
      endingNodeIds.push(nodeId);
    }
  }
  if (endingNodeIds.length === 0 && allNodes.length === 1) {
    endingNodeIds.push(allNodes[0].id);
  }
  return allNodes.filter((node) => endingNodeIds.includes(node.id));
};

const resolveVariables = async (nodeData: IReactFlowNode["data"]) => nodeData;

interface PreparedFlow {
  nodes: IReactFlowNode[];
  edges: IReactFlowObject["edges"];
}

class FlowiseEmbeddedRuntime {
  async ensureInitialized() {
    return;
  }

  async execute(options: EmbeddedFlowExecution): Promise<any> {
    const definition = this.normalizeFlow(options.flow);
    if (!definition.nodes?.length) {
      throw new Error("Flow definition is empty");
    }
    const { nodes, edges } = definition;
    const { graph, nodeDependencies } = constructGraphs(nodes, edges || []);
    const endingNodes = getEndingNodes(nodeDependencies, graph, nodes);
    if (endingNodes.length === 0) {
      throw new Error("Flow definition does not contain a valid ending node");
    }
    const endingNode = endingNodes[0];
    const resolvedNode = await resolveVariables(
      endingNode.data,
      nodes,
      options.input.question,
      options.input.chatHistory || [],
      {
        sessionId: options.runId,
        chatHistory: options.input.chatHistory || [],
        metadata: options.metadata || {},
      },
      options.input.uploadedFilesContent,
      [],
      [],
    );

    if (!resolvedNode?.name) {
      throw new Error(`Flowise component ${resolvedNode.name} is not available in the embedded runtime`);
    }
    contextManager.getOrCreate({
      runId: options.runId,
      userId: String(options.metadata?.userId || "embedded"),
      chatId: String(options.metadata?.chatId || options.runId),
    });
    const output = await this.executeEmbeddedNode(resolvedNode, options);
    this.persistResult(options.runId, resolvedNode.label || "FlowiseEmbedded", output);
    return output;
  }

  private normalizeFlow(flow: IReactFlowObject | string): PreparedFlow {
    const definition = typeof flow === "string" ? (JSON.parse(flow) as IReactFlowObject) : flow;
    return {
      nodes: cloneDeep(definition.nodes || []),
      edges: cloneDeep(definition.edges || []),
    };
  }

  private persistResult(runId: string, label: string, output: any) {
    const serialized = this.safeStringify({ label, output });
    contextManager.attachMemory(runId, {
      role: "tool",
      content: serialized,
      timestamp: Date.now(),
    });
    contextManager.pushSignal(runId, "flowise_embedded_result", {
      label,
      preview: typeof output === "string" ? output.slice(0, 256) : serialized.slice(0, 256),
    });
  }

  private async executeEmbeddedNode(nodeData: any, options: EmbeddedFlowExecution) {
    const nodeName = String(nodeData?.name || "");
    if (nodeName === "customFunction") {
      return this.runCustomFunction(nodeData, options.input.question, options);
    }
    if (nodeName === "ifElseFunction") {
      return this.runIfElseFunction(nodeData, options.input.question, options);
    }
    throw new Error(`Flowise embedded runtime only supports customFunction/ifElseFunction nodes (got ${nodeName})`);
  }

  private async runCustomFunction(nodeData: any, input: string, options: EmbeddedFlowExecution) {
    const javascriptFunction = String(nodeData?.inputs?.javascriptFunction || "");
    if (!javascriptFunction.trim()) {
      throw new Error("customFunction node is missing javascriptFunction");
    }

    const sandbox = this.createSandbox(input, options);
    return this.executeSandboxed(javascriptFunction, sandbox);
  }

  private async runIfElseFunction(nodeData: any, input: string, options: EmbeddedFlowExecution) {
    const ifFunction = String(nodeData?.inputs?.ifFunction || "");
    const elseFunction = String(nodeData?.inputs?.elseFunction || "");
    if (!ifFunction.trim() || !elseFunction.trim()) {
      throw new Error("ifElseFunction node missing ifFunction/elseFunction");
    }
    const sandbox = this.createSandbox(input, options);
    const responseTrue = await this.executeSandboxed(ifFunction, sandbox);
    if (responseTrue) {
      return { output: responseTrue, type: true };
    }
    const responseFalse = await this.executeSandboxed(elseFunction, sandbox);
    return { output: responseFalse, type: false };
  }

  private createSandbox(input: string, options: EmbeddedFlowExecution) {
    const flow = {
      sessionId: options.runId,
      chatHistory: options.input.chatHistory || [],
      metadata: options.metadata || {},
    };
    const sandbox: Record<string, any> = {
      $input: input,
      $vars: {},
      $flow: flow,
    };
    return sandbox;
  }

  private async executeSandboxed(code: string, sandbox: Record<string, any>) {
    const wrapped = `(async () => { ${code} })()`;
    const script = new vm.Script(wrapped);
    const context = vm.createContext(sandbox);
    return await script.runInContext(context, { timeout: 5000 });
  }

  private safeStringify(value: any): string {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value ?? "");
    }
  }
}

const runtime = new FlowiseEmbeddedRuntime();

export const flowiseEmbeddedRuntime = {
  ensureInitialized: () => runtime.ensureInitialized(),
  execute: (options: EmbeddedFlowExecution) => runtime.execute(options),
};
