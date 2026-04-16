export interface ReopenDocumentRequest {
  type: "word" | "excel" | "ppt" | "pdf";
  title: string;
  content?: string;
  downloadUrl?: string;
  previewUrl?: string;
  previewHtml?: string;
  mimeType?: string;
  fileName?: string;
  messageId?: string;
}
