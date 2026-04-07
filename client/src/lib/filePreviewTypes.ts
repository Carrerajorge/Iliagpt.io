export type FilePreviewType = "docx" | "xlsx" | "csv" | "pptx" | "text" | "unknown";

export interface FilePreviewData {
  type: FilePreviewType;
  html?: string;
  content?: string;
  truncated?: boolean;
  meta?: Record<string, unknown>;
  message?: string;
}

export function isRenderablePreview(value: unknown): value is FilePreviewData {
  return Boolean(value && typeof value === "object" && ("html" in (value as Record<string, unknown>) || "content" in (value as Record<string, unknown>)));
}
