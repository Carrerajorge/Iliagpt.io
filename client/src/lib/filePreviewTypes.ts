export type FilePreviewType = "docx" | "xlsx" | "csv" | "pptx" | "text" | "unknown";

export interface FilePreviewData {
  type: FilePreviewType;
  html?: string;
  content?: string;
  truncated?: boolean;
  meta?: Record<string, unknown>;
  message?: string;
}

export function isRenderablePreview(data: FilePreviewData | null | undefined): boolean {
  if (!data) return false;
  if (data.html && data.html.trim().length > 0) return true;
  if (data.content && data.content.trim().length > 0) return true;
  return false;
}
