import * as fs from "fs/promises";
import * as path from "path";
import { extractText, extractTextSafe, isSupportedMimeType } from "../documentParser";

export interface ProcessedFile {
  success: boolean;
  filename: string;
  mimeType: string;
  category: FileCategory;
  content: string;
  metadata: Record<string, any>;
  size: number;
  error?: string;
}

export type FileCategory = 
  | "code"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "text"
  | "data"
  | "image"
  | "archive"
  | "unknown";

const CODE_EXTENSIONS = new Set([
  ".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".cpp", ".c", ".h", ".hpp",
  ".cs", ".go", ".rs", ".rb", ".php", ".swift", ".kt", ".scala", ".r",
  ".pl", ".pm", ".lua", ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd",
  ".sql", ".graphql", ".vue", ".svelte", ".astro"
]);

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".rst", ".log", ".ini", ".cfg", ".conf",
  ".yaml", ".yml", ".toml", ".env", ".gitignore", ".dockerignore",
  ".editorconfig", ".eslintrc", ".prettierrc", ".babelrc"
]);

const DATA_EXTENSIONS = new Set([
  ".json", ".xml", ".csv", ".tsv", ".ndjson", ".jsonl"
]);

const MIME_TO_CATEGORY: Record<string, FileCategory> = {
  "application/pdf": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/msword": "document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "spreadsheet",
  "application/vnd.ms-excel": "spreadsheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "presentation",
  "application/vnd.ms-powerpoint": "presentation",
  "text/plain": "text",
  "text/markdown": "text",
  "text/html": "text",
  "application/json": "data",
  "text/csv": "data",
  "text/xml": "data",
  "application/xml": "data",
  "image/png": "image",
  "image/jpeg": "image",
  "image/gif": "image",
  "image/webp": "image",
  "image/svg+xml": "image",
  "image/bmp": "image",
  "image/tiff": "image",
  "image/x-icon": "image",
  "image/avif": "image",
  "application/zip": "archive",
  "application/x-zip-compressed": "archive",
  "application/x-tar": "archive",
  "application/gzip": "archive",
};

export function detectMimeType(filename: string, content?: Buffer): string {
  const ext = path.extname(filename).toLowerCase();
  
  const extToMime: Record<string, string> = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".json": "application/json",
    ".xml": "text/xml",
    ".csv": "text/csv",
    ".html": "text/html",
    ".htm": "text/html",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".ppt": "application/vnd.ms-powerpoint",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
    ".ico": "image/x-icon",
    ".avif": "image/avif",
    ".zip": "application/zip",
    ".tar": "application/x-tar",
    ".gz": "application/gzip",
    ".py": "text/x-python",
    ".js": "text/javascript",
    ".ts": "text/typescript",
    ".jsx": "text/javascript",
    ".tsx": "text/typescript",
    ".java": "text/x-java",
    ".cpp": "text/x-c++",
    ".c": "text/x-c",
    ".h": "text/x-c",
    ".go": "text/x-go",
    ".rs": "text/x-rust",
    ".rb": "text/x-ruby",
    ".php": "text/x-php",
    ".swift": "text/x-swift",
    ".kt": "text/x-kotlin",
    ".sql": "text/x-sql",
    ".sh": "text/x-shellscript",
    ".bash": "text/x-shellscript",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
    ".toml": "text/toml",
    ".log": "text/plain",
    ".ini": "text/plain",
    ".cfg": "text/plain",
    ".conf": "text/plain",
    ".env": "text/plain",
  };
  
  if (extToMime[ext]) {
    return extToMime[ext];
  }
  
  if (content && content.length >= 4) {
    const header = content.slice(0, 12);
    if (header[0] === 0x50 && header[1] === 0x4B) return "application/zip";
    if (header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46) return "application/pdf";
    if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) return "image/png";
    if (header[0] === 0xFF && header[1] === 0xD8) return "image/jpeg";
    if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46) return "image/gif";
    if (header[0] === 0x42 && header[1] === 0x4D) return "image/bmp";
    if ((header[0] === 0x49 && header[1] === 0x49 && header[2] === 0x2A && header[3] === 0x00) ||
        (header[0] === 0x4D && header[1] === 0x4D && header[2] === 0x00 && header[3] === 0x2A)) return "image/tiff";
    if (header[0] === 0x00 && header[1] === 0x00 && header[2] === 0x01 && header[3] === 0x00) return "image/x-icon";
    if (content.length >= 12 && header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70 &&
        header[8] === 0x61 && header[9] === 0x76 && header[10] === 0x69 && header[11] === 0x66) return "image/avif";
    if (content.length >= 12 && header.slice(0, 4).toString() === "RIFF" && 
        content.slice(8, 12).toString() === "WEBP") return "image/webp";
  }
  
  return "application/octet-stream";
}

export function categorizeFile(filename: string, mimeType: string): FileCategory {
  const ext = path.extname(filename).toLowerCase();
  
  if (CODE_EXTENSIONS.has(ext)) return "code";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (DATA_EXTENSIONS.has(ext)) return "data";
  
  if (MIME_TO_CATEGORY[mimeType]) {
    return MIME_TO_CATEGORY[mimeType];
  }
  
  if (mimeType.startsWith("text/")) return "text";
  if (mimeType.startsWith("image/")) return "image";
  
  return "unknown";
}

export async function processFile(filePath: string): Promise<ProcessedFile> {
  const filename = path.basename(filePath);
  const startTime = Date.now();
  
  try {
    const content = await fs.readFile(filePath);
    const mimeType = detectMimeType(filename, content);
    const category = categorizeFile(filename, mimeType);
    const stats = await fs.stat(filePath);
    
    let textContent = "";
    let metadata: Record<string, any> = {
      extension: path.extname(filename),
      processedAt: new Date().toISOString(),
      processingTimeMs: 0,
    };
    
    if (category === "code" || category === "text" || category === "data") {
      textContent = content.toString("utf-8");
      metadata.lineCount = textContent.split("\n").length;
      metadata.charCount = textContent.length;
      
      if (category === "data" && mimeType === "application/json") {
        try {
          const parsed = JSON.parse(textContent);
          metadata.jsonType = Array.isArray(parsed) ? "array" : typeof parsed;
          if (Array.isArray(parsed)) metadata.arrayLength = parsed.length;
        } catch {}
      }
    } else if (isSupportedMimeType(mimeType)) {
      const result = await extractTextSafe(content, mimeType);
      textContent = result.text;
      metadata.extractionMethod = result.method;
      metadata.extractionSuccess = result.success;
      if (result.confidence) metadata.ocrConfidence = result.confidence;
      if (result.error) metadata.extractionError = result.error;
    } else if (mimeType === "application/zip") {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(content);
      const files = Object.keys(zip.files);
      textContent = `ZIP Archive Contents (${files.length} files):\n${files.map(f => `  - ${f}`).join("\n")}`;
      metadata.archiveFiles = files;
      metadata.archiveFileCount = files.length;
    } else {
      textContent = `[Binary file: ${mimeType}] Size: ${stats.size} bytes`;
      metadata.isBinary = true;
    }
    
    metadata.processingTimeMs = Date.now() - startTime;
    
    return {
      success: true,
      filename,
      mimeType,
      category,
      content: textContent,
      metadata,
      size: stats.size,
    };
  } catch (error) {
    return {
      success: false,
      filename,
      mimeType: "unknown",
      category: "unknown",
      content: "",
      metadata: { processingTimeMs: Date.now() - startTime },
      size: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function processBuffer(content: Buffer, filename: string): Promise<ProcessedFile> {
  const startTime = Date.now();
  const mimeType = detectMimeType(filename, content);
  const category = categorizeFile(filename, mimeType);
  
  try {
    let textContent = "";
    let metadata: Record<string, any> = {
      extension: path.extname(filename),
      processedAt: new Date().toISOString(),
      processingTimeMs: 0,
    };
    
    if (category === "code" || category === "text" || category === "data") {
      textContent = content.toString("utf-8");
      metadata.lineCount = textContent.split("\n").length;
      metadata.charCount = textContent.length;
      
      if (category === "data" && mimeType === "application/json") {
        try {
          const parsed = JSON.parse(textContent);
          metadata.jsonType = Array.isArray(parsed) ? "array" : typeof parsed;
          if (Array.isArray(parsed)) metadata.arrayLength = parsed.length;
        } catch {}
      }
    } else if (isSupportedMimeType(mimeType)) {
      const result = await extractTextSafe(content, mimeType);
      textContent = result.text;
      metadata.extractionMethod = result.method;
      metadata.extractionSuccess = result.success;
      if (result.confidence) metadata.ocrConfidence = result.confidence;
      if (result.error) metadata.extractionError = result.error;
    } else if (mimeType === "application/zip") {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(content);
      const files = Object.keys(zip.files);
      textContent = `ZIP Archive Contents (${files.length} files):\n${files.map(f => `  - ${f}`).join("\n")}`;
      metadata.archiveFiles = files;
      metadata.archiveFileCount = files.length;
    } else {
      textContent = `[Binary file: ${mimeType}] Size: ${content.length} bytes`;
      metadata.isBinary = true;
    }
    
    metadata.processingTimeMs = Date.now() - startTime;
    
    return {
      success: true,
      filename,
      mimeType,
      category,
      content: textContent,
      metadata,
      size: content.length,
    };
  } catch (error) {
    return {
      success: false,
      filename,
      mimeType,
      category,
      content: "",
      metadata: { processingTimeMs: Date.now() - startTime },
      size: content.length,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const fileProcessor = {
  processFile,
  processBuffer,
  detectMimeType,
  categorizeFile,
  isSupportedMimeType,
  getSupportedExtensions: () => [...CODE_EXTENSIONS, ...TEXT_EXTENSIONS, ...DATA_EXTENSIONS],
  getSupportedCategories: () => ["code", "document", "spreadsheet", "presentation", "text", "data", "image", "archive"] as FileCategory[],
};

export default fileProcessor;
