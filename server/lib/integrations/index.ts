export * as qdrant from "./qdrantProvider";
export * as openaiAgents from "./openaiAgents";
export * as llamaIndex from "./llamaIndexRAG";

export interface IntegrationStatus {
  name: string;
  available: boolean;
  version?: string;
  info?: string;
}

export async function checkAllIntegrations(): Promise<IntegrationStatus[]> {
  const { isAvailable: openaiAvailable } = await import("./openaiAgents");
  const { isAvailable: llamaAvailable } = await import("./llamaIndexRAG");
  const { healthCheck: qdrantHealth } = await import("./qdrantProvider");

  const statuses: IntegrationStatus[] = [
    {
      name: "OpenAI Agents SDK",
      available: openaiAvailable(),
      version: "0.8.x",
      info: "Agent orchestration with handoffs and tool calling",
    },
    {
      name: "LlamaIndex",
      available: llamaAvailable(),
      version: "0.12.x",
      info: "RAG framework for document indexing and retrieval",
    },
  ];

  try {
    const qdrantResult = await qdrantHealth();
    statuses.push({
      name: "Qdrant",
      available: qdrantResult.ok,
      version: "1.17.x",
      info: qdrantResult.ok ? "Vector DB connected" : `Not reachable: ${qdrantResult.info}`,
    });
  } catch {
    statuses.push({
      name: "Qdrant",
      available: false,
      version: "1.17.x",
      info: "Client installed, server not configured",
    });
  }

  return statuses;
}
