export const ALLOWED_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/json",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/bmp",
  "image/webp",
  "image/tiff",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/flac",
  "audio/aac",
] as const;

export const HTTP_HEADERS = {
  USER_AGENT: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  ACCEPT_HTML: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  ACCEPT_LANGUAGE: "es-ES,es;q=0.9,en;q=0.8"
} as const;

export const TIMEOUTS = {
  PAGE_FETCH: 2000,  // 2s max per page fetch
  SCREENSHOT_INTERVAL: 1500,
  MAX_CONTENT_LENGTH: 800,  // Enough content for meaningful context
  SEARCH_LLM_TIMEOUT: 12000  // 12s max for search LLM response
} as const;

export const LIMITS = {
  MAX_SEARCH_RESULTS: 50,  // No fixed limit - user decides how many
  MAX_CONTENT_FETCH: 50,  // Fetch as many pages as user requests
  EMBEDDING_BATCH_SIZE: 20,
  MAX_EMBEDDING_INPUT: 8000,
  RAG_SIMILAR_CHUNKS: 3,
  RAG_SIMILARITY_THRESHOLD: 0.5,
  MAX_FILE_SIZE_MB: 500,
  MAX_FILE_SIZE_BYTES: 500 * 1024 * 1024
} as const;

export const MEMORY_INTENT_KEYWORDS = [
  "mi archivo", "mis archivos", "mi documento", "mis documentos",
  "el archivo que", "el documento que", "lo que subí", "lo que cargué",
  "el pdf", "el excel", "el word", "la presentación",
  "según mi", "de acuerdo a mi", "basándote en mi",
  "usa mi", "revisa mi", "analiza mi", "lee mi",
  "en mi archivo", "en mis documentos", "de mi archivo"
] as const;

export const FILE_UPLOAD_CONFIG = {
  CHUNK_SIZE_MB: 10,
  CHUNK_SIZE_BYTES: 10 * 1024 * 1024,
  MAX_PARALLEL_CHUNKS: 6,
  UPLOAD_TIMEOUT_MS: 300000
} as const;

export const ALLOWED_EXTENSIONS: Record<string, string> = {
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
  "text/html": ".html",
  "application/json": ".json",
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.ms-powerpoint": ".ppt",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/webp": ".webp",
  "image/tiff": ".tiff",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/ogg": ".ogg",
  "audio/webm": ".webm",
  "audio/mp4": ".m4a",
  "audio/m4a": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/flac": ".flac",
  "audio/aac": ".aac"
} as const;
