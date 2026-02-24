export const UPLOAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{5,126}$/;
export const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{3,255}$/;

export type UploadState = "queued" | "processing" | "ready" | "failed" | "error";

export interface BaseUploadHeaders {
  "X-Upload-Id"?: string;
  "X-Conversation-Id"?: string;
  "X-CSRF-Token"?: string;
  "X-CSRFToken"?: string;
}

export interface UploadIntentRequest {
  uploadId?: string;
  conversationId?: string;
}

export interface UploadStatusEvent {
  fileId: string;
  state: UploadState;
  uploadProgress: number;
  processingProgress: number;
  error?: string;
}

export interface UploadResponse {
  uploadURL: string;
  storagePath: string;
  uploadId?: string;
  localFallback?: boolean;
}

export interface MultipartCreateRequest extends UploadIntentRequest {
  fileName: string;
  mimeType: string;
  fileSize: number;
  totalChunks: number;
}

export interface MultipartSignPartRequest extends UploadIntentRequest {
  uploadId: string;
  partNumber: number;
}

export interface MultipartCompleteRequest extends UploadIntentRequest {
  uploadId: string;
  parts: { partNumber: number }[];
}

export interface FileRegisterRequest extends UploadIntentRequest {
  name: string;
  type: string;
  size: number;
  storagePath: string;
}

export interface FileStatusResponse {
  fileId: string;
  name: string;
  status: UploadState | string;
  processingProgress: number;
  processingError: string | null;
  completedAt: string | null;
}

export type UploadAuthMode = "cookie-session" | "bearer-token";

export interface UploadSecurityContract {
  requestId?: string;
  issuedAt?: string;
  authMode: UploadAuthMode;
  csrf: {
    required: boolean;
    tokenEndpoint?: string;
    cookieName?: string;
    headerNames: string[];
    credentials: "include" | "omit";
    rotateOnDemand: boolean;
  };
  cors: {
    requiresCredentials: boolean;
    originValidation: "strict" | "allowlist" | "none";
    refererValidation: "strict" | "allowlist" | "none";
  };
  upload: {
    endpoint: string;
    directUploadContentTypePolicy: string;
    maxFileSizeBytes: number;
    allowedMimeTypes: string[];
  };
  idempotency: {
    uploadIdHeader: string;
    conversationIdHeader: string;
  };
}
