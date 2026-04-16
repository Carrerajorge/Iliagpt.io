/**
 * Memory Module Index
 * 
 * Exports for enterprise conversation memory management
 */

export {
    ContextOrchestrator,
    contextOrchestrator,
    type ContextConfig,
    type CachedContext,
    type ExtractedEntity,
    type ContextMetrics
} from "./ContextOrchestrator";

export { default as contextRoutes } from "./contextRoutes";

// Tier 2: Semantic Compression
export {
    semanticCompressor,
    compressMessages,
    shouldCompress,
    type CompressionConfig,
    type CompressionResult,
    type ExtractedFact
} from "./SemanticCompressor";

// Tier 2: Cross-Session Memory
export {
    userMemoryStore,
    UserMemoryStore,
    type UserMemory,
    type MemoryQuery,
    type MemoryStats
} from "./UserMemoryStore";

// Tier 3: Semantic Memory (Vector Search)
export {
    semanticMemoryStore,
    SemanticMemoryStore,
    type MemoryChunk,
    type SearchResult,
    type SemanticSearchOptions
} from "./SemanticMemoryStore";

export { default as semanticRoutes } from "./semanticRoutes";
