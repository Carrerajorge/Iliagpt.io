export type FilePreviewType = "docx" | "xlsx" | "csv" | "pptx" | "text" | "unknown";

export interface FilePreviewData {
  type: FilePreviewType;
  html?: string;
  content?: string;
  truncated?: boolean;
  meta?: Record<string, unknown>;
  message?: string;
}
