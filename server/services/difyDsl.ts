import fs from "fs/promises";
import path from "path";
import YAML from "yaml";

export type DifyDslParseInput = {
  dsl?: string;
  dslPath?: string;
  includeGraph?: boolean;
};

export type DifyDslGraphSummary = {
  nodeCount: number;
  edgeCount: number;
  nodeTypes: string[];
};

export type DifyDslParseOutput = {
  version: string | null;
  app: Record<string, unknown> | null;
  workflow: {
    graph: DifyDslGraphSummary;
    features?: Record<string, unknown> | null;
    environmentVariables?: unknown[] | null;
    conversationVariables?: unknown[] | null;
    nodes?: unknown[];
    edges?: unknown[];
  } | null;
  rawSize: number;
};

async function loadDslContent(input: DifyDslParseInput): Promise<string> {
  if (input.dsl && input.dsl.trim()) {
    return input.dsl;
  }
  if (!input.dslPath) {
    throw new Error("Provide dsl or dslPath");
  }
  const resolved = path.isAbsolute(input.dslPath)
    ? input.dslPath
    : path.resolve(process.cwd(), input.dslPath);
  return fs.readFile(resolved, "utf8");
}

function parseDsl(raw: string): Record<string, unknown> {
  try {
    const data = YAML.parse(raw);
    if (data && typeof data === "object") {
      return data as Record<string, unknown>;
    }
  } catch {
    // fallthrough to JSON parse
  }

  const json = JSON.parse(raw) as Record<string, unknown>;
  if (!json || typeof json !== "object") {
    throw new Error("DSL content is not an object");
  }
  return json;
}

export async function parseDifyDsl(input: DifyDslParseInput): Promise<DifyDslParseOutput> {
  const raw = await loadDslContent(input);
  const payload = parseDsl(raw);

  const version = typeof payload.version === "string" ? payload.version : null;
  const app = (payload.app && typeof payload.app === "object")
    ? (payload.app as Record<string, unknown>)
    : null;
  const workflow = (payload.workflow && typeof payload.workflow === "object")
    ? (payload.workflow as Record<string, unknown>)
    : null;

  const graph = workflow?.graph && typeof workflow.graph === "object"
    ? (workflow.graph as Record<string, unknown>)
    : null;

  const nodes = Array.isArray(graph?.nodes) ? graph?.nodes ?? [] : [];
  const edges = Array.isArray(graph?.edges) ? graph?.edges ?? [] : [];
  const nodeTypes = nodes
    .map((node: any) => {
      if (!node || typeof node !== "object") return null;
      return (
        (node.data && typeof node.data === "object" && (node.data as any).type) ||
        (node.type as string | undefined) ||
        null
      );
    })
    .filter((value): value is string => Boolean(value));

  const summary: DifyDslGraphSummary = {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodeTypes: Array.from(new Set(nodeTypes)),
  };

  return {
    version,
    app,
    workflow: workflow
      ? {
          graph: summary,
          features: (workflow.features && typeof workflow.features === "object")
            ? (workflow.features as Record<string, unknown>)
            : null,
          environmentVariables: Array.isArray(workflow.environment_variables)
            ? (workflow.environment_variables as unknown[])
            : null,
          conversationVariables: Array.isArray(workflow.conversation_variables)
            ? (workflow.conversation_variables as unknown[])
            : null,
          nodes: input.includeGraph ? nodes : undefined,
          edges: input.includeGraph ? edges : undefined,
        }
      : null,
    rawSize: raw.length,
  };
}
