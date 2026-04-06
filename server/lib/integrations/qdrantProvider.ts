import { QdrantClient } from "@qdrant/js-client-rest";

const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || undefined;
const COLLECTION_NAME = process.env.QDRANT_COLLECTION || "iliagpt_documents";

let _client: QdrantClient | null = null;

export function getQdrantClient(): QdrantClient {
  if (!_client) {
    _client = new QdrantClient({
      url: QDRANT_URL,
      apiKey: QDRANT_API_KEY,
    });
  }
  return _client;
}

export async function ensureCollection(
  vectorSize: number = 1536,
  distance: "Cosine" | "Euclid" | "Dot" = "Cosine",
): Promise<boolean> {
  const client = getQdrantClient();
  try {
    const collections = await client.getCollections();
    const exists = collections.collections.some((c) => c.name === COLLECTION_NAME);
    if (!exists) {
      await client.createCollection(COLLECTION_NAME, {
        vectors: { size: vectorSize, distance },
        optimizers_config: { indexing_threshold: 10000 },
        on_disk_payload: true,
      });
      await client.createPayloadIndex(COLLECTION_NAME, {
        field_name: "userId",
        field_schema: "keyword",
      });
      await client.createPayloadIndex(COLLECTION_NAME, {
        field_name: "source",
        field_schema: "keyword",
      });
      console.info(`[Qdrant] Created collection "${COLLECTION_NAME}" (dim=${vectorSize})`);
    }
    return true;
  } catch (err) {
    console.warn("[Qdrant] Collection setup failed:", (err as Error).message);
    return false;
  }
}

export interface QdrantUpsertPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export async function upsertVectors(points: QdrantUpsertPoint[]): Promise<void> {
  const client = getQdrantClient();
  await client.upsert(COLLECTION_NAME, {
    wait: true,
    points: points.map((p) => ({
      id: p.id,
      vector: p.vector,
      payload: p.payload,
    })),
  });
}

export interface QdrantSearchResult {
  id: string | number;
  score: number;
  payload: Record<string, unknown>;
}

export async function searchVectors(
  queryVector: number[],
  limit: number = 10,
  filter?: Record<string, unknown>,
): Promise<QdrantSearchResult[]> {
  const client = getQdrantClient();
  const results = await client.search(COLLECTION_NAME, {
    vector: queryVector,
    limit,
    with_payload: true,
    filter: filter as any,
  });
  return results.map((r) => ({
    id: r.id,
    score: r.score,
    payload: (r.payload || {}) as Record<string, unknown>,
  }));
}

export async function deleteByFilter(filter: Record<string, unknown>): Promise<void> {
  const client = getQdrantClient();
  await client.delete(COLLECTION_NAME, {
    wait: true,
    filter: filter as any,
  });
}

export async function healthCheck(): Promise<{ ok: boolean; info?: string }> {
  try {
    const client = getQdrantClient();
    const info = await client.api("cluster").clusterStatus();
    return { ok: true, info: JSON.stringify(info.data) };
  } catch (err) {
    return { ok: false, info: (err as Error).message };
  }
}
