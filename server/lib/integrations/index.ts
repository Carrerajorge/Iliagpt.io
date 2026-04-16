export * as qdrant from "./qdrantProvider";
export * as openaiAgents from "./openaiAgents";
export * as llamaIndex from "./llamaIndexRAG";

export interface IntegrationStatus {
  name: string;
  available: boolean;
  version?: string;
  info?: string;
  latencyMs?: number;
}

export async function checkAllIntegrations(): Promise<IntegrationStatus[]> {
  const statuses: IntegrationStatus[] = [];

  const openaiStart = Date.now();
  try {
    const { isAvailable: openaiAvailable } = await import("./openaiAgents");
    statuses.push({
      name: "OpenAI Agents SDK",
      available: openaiAvailable(),
      version: "0.8.x",
      info: openaiAvailable()
        ? "Agent orchestration with handoffs and tool calling"
        : "OPENAI_API_KEY not configured",
      latencyMs: Date.now() - openaiStart,
    });
  } catch (err) {
    statuses.push({
      name: "OpenAI Agents SDK",
      available: false,
      version: "0.8.x",
      info: `Import error: ${(err as Error).message}`,
      latencyMs: Date.now() - openaiStart,
    });
  }

  const llamaStart = Date.now();
  try {
    const { isAvailable: llamaAvailable } = await import("./llamaIndexRAG");
    statuses.push({
      name: "LlamaIndex",
      available: llamaAvailable(),
      version: "0.12.x",
      info: llamaAvailable()
        ? "RAG framework for document indexing and retrieval"
        : "OPENAI_API_KEY not configured",
      latencyMs: Date.now() - llamaStart,
    });
  } catch (err) {
    statuses.push({
      name: "LlamaIndex",
      available: false,
      version: "0.12.x",
      info: `Import error: ${(err as Error).message}`,
      latencyMs: Date.now() - llamaStart,
    });
  }

  const qdrantStart = Date.now();
  try {
    const { healthCheck: qdrantHealth } = await import("./qdrantProvider");
    const qdrantResult = await Promise.race([
      qdrantHealth(),
      new Promise<{ ok: false; info: string }>((resolve) =>
        setTimeout(() => resolve({ ok: false, info: "Health check timeout (5s)" }), 5000),
      ),
    ]);
    statuses.push({
      name: "Qdrant",
      available: qdrantResult.ok,
      version: "1.17.x",
      info: qdrantResult.ok
        ? "Vector DB connected"
        : `Not reachable: ${qdrantResult.info}`,
      latencyMs: Date.now() - qdrantStart,
    });
  } catch {
    statuses.push({
      name: "Qdrant",
      available: false,
      version: "1.17.x",
      info: "Client installed, server not configured",
      latencyMs: Date.now() - qdrantStart,
    });
  }

  return statuses;
}
