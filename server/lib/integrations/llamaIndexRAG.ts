import {
  Document,
  VectorStoreIndex,
  Settings,
  storageContextFromDefaults,
} from "llamaindex";
import { Logger } from "../logger";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

export interface LlamaIndexConfig {
  model?: string;
  embeddingModel?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  temperature?: number;
  similarityTopK?: number;
}

const DEFAULT_CONFIG: LlamaIndexConfig = {
  model: "gpt-4o",
  embeddingModel: "text-embedding-3-small",
  chunkSize: 1024,
  chunkOverlap: 200,
  temperature: 0.1,
  similarityTopK: 5,
};

let _settingsConfigured = false;

function ensureSettings(config: Partial<LlamaIndexConfig> = {}) {
  if (_settingsConfigured) return;
  const merged = { ...DEFAULT_CONFIG, ...config };
  try {
    Settings.chunkSize = merged.chunkSize ?? 1024;
    Settings.chunkOverlap = merged.chunkOverlap ?? 200;
    _settingsConfigured = true;
  } catch (err) {
    Logger.warn("[LlamaIndex] Settings configuration warning", {
      error: (err as Error).message,
    });
  }
}

export async function indexDocuments(
  documents: Array<{ text: string; metadata?: Record<string, unknown> }>,
  config?: Partial<LlamaIndexConfig>,
): Promise<VectorStoreIndex> {
  ensureSettings(config);

  const docs = documents.map(
    (d) =>
      new Document({
        text: d.text,
        metadata: d.metadata || {},
      }),
  );

  const index = await VectorStoreIndex.fromDocuments(docs);
  return index;
}

export interface QueryResult {
  response: string;
  sourceNodes: Array<{
    text: string;
    score: number;
    metadata: Record<string, unknown>;
  }>;
}

export async function queryIndex(
  index: VectorStoreIndex,
  query: string,
  config?: Partial<LlamaIndexConfig>,
): Promise<QueryResult> {
  const merged = { ...DEFAULT_CONFIG, ...config };
  const queryEngine = index.asQueryEngine({
    similarityTopK: merged.similarityTopK,
  });

  const response = await queryEngine.query({ query });

  const sourceNodes = (response.sourceNodes || []).map((node: any) => ({
    text: node.node?.text || node.text || "",
    score: node.score || 0,
    metadata: node.node?.metadata || node.metadata || {},
  }));

  return {
    response: response.toString(),
    sourceNodes,
  };
}

export async function ragQuery(
  documents: Array<{ text: string; metadata?: Record<string, unknown> }>,
  query: string,
  config?: Partial<LlamaIndexConfig>,
): Promise<QueryResult> {
  const index = await indexDocuments(documents, config);
  return queryIndex(index, query, config);
}

let _cachedIndex: VectorStoreIndex | null = null;
let _cachedDocCount = 0;

export async function getOrCreateIndex(
  documents: Array<{ text: string; metadata?: Record<string, unknown> }>,
  config?: Partial<LlamaIndexConfig>,
): Promise<VectorStoreIndex> {
  if (_cachedIndex && _cachedDocCount === documents.length) {
    return _cachedIndex;
  }
  _cachedIndex = await indexDocuments(documents, config);
  _cachedDocCount = documents.length;
  return _cachedIndex;
}

export function invalidateCache(): void {
  _cachedIndex = null;
  _cachedDocCount = 0;
}

export function isAvailable(): boolean {
  return !!OPENAI_API_KEY && OPENAI_API_KEY.length > 10;
}
