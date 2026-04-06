import {
  Document,
  VectorStoreIndex,
  serviceContextFromDefaults,
  SimpleDirectoryReader,
  storageContextFromDefaults,
  OpenAI as LlamaOpenAI,
  OpenAIEmbedding,
} from "llamaindex";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";

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

export function createServiceContext(config: Partial<LlamaIndexConfig> = {}) {
  const merged = { ...DEFAULT_CONFIG, ...config };

  const llm = new LlamaOpenAI({
    model: merged.model!,
    temperature: merged.temperature,
    apiKey: OPENAI_API_KEY,
  });

  const embedModel = new OpenAIEmbedding({
    model: merged.embeddingModel!,
    apiKey: OPENAI_API_KEY,
  });

  return serviceContextFromDefaults({
    llm,
    embedModel,
    chunkSize: merged.chunkSize,
    chunkOverlap: merged.chunkOverlap,
  });
}

export async function indexDocuments(
  documents: Array<{ text: string; metadata?: Record<string, unknown> }>,
  config?: Partial<LlamaIndexConfig>,
): Promise<VectorStoreIndex> {
  const serviceContext = createServiceContext(config);

  const docs = documents.map(
    (d) =>
      new Document({
        text: d.text,
        metadata: d.metadata || {},
      }),
  );

  const index = await VectorStoreIndex.fromDocuments(docs, { serviceContext });
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

export async function indexDirectory(
  dirPath: string,
  config?: Partial<LlamaIndexConfig>,
): Promise<VectorStoreIndex> {
  const serviceContext = createServiceContext(config);
  const reader = new SimpleDirectoryReader();
  const docs = await reader.loadData(dirPath);
  const index = await VectorStoreIndex.fromDocuments(docs, { serviceContext });
  return index;
}

export async function ragQuery(
  documents: Array<{ text: string; metadata?: Record<string, unknown> }>,
  query: string,
  config?: Partial<LlamaIndexConfig>,
): Promise<QueryResult> {
  const index = await indexDocuments(documents, config);
  return queryIndex(index, query, config);
}

export function isAvailable(): boolean {
  return !!OPENAI_API_KEY && OPENAI_API_KEY.length > 10;
}
