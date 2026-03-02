export {
  SecureFileGateway,
  secureFileGateway,
  type WorkspaceConfig,
  type AuditEntry,
  type FileProvenance,
  type FileStat,
  type GatewayStats,
  type SearchResult,
} from "./secureFileGateway";

export {
  parseFile,
  generateChunks,
  detectFormat,
  type ParsedContent,
  type RAGChunk,
} from "./fileParser";
