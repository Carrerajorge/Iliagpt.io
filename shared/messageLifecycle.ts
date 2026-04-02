/**
 * Message Lifecycle - Modelo de estados para mensajes
 * 
 * Estados: draft -> sending -> accepted -> waiting_first_token -> streaming -> completed
 * Estados de error: failed_retryable | failed_terminal | cancelled
 */

export type MessageStatus =
  | "draft"
  | "sending"
  | "accepted"
  | "waiting_first_token"
  | "streaming"
  | "completed"
  | "failed_retryable"
  | "failed_terminal"
  | "cancelled";

export interface ClientMessage {
  clientMessageId: string;
  conversationId: string | null;
  text: string;
  attachments: MessageAttachment[];
  status: MessageStatus;
  retryCount: number;
  createdAt: number;
  lastEventOffset: number;
  errorCode?: string;
  errorMessage?: string;
  serverMessageId?: string;
  streamId?: string;
}

export interface MessageAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  status: "queued" | "uploading" | "uploaded" | "processing" | "ready" | "failed";
  storagePath?: string;
  error?: string;
}

export interface SendMessageRequest {
  clientMessageId: string;
  conversationId: string | null;
  text: string;
  attachments?: Array<{
    id: string;
    name: string;
    mimeType: string;
    size: number;
    storagePath?: string;
  }>;
  requestId?: string;
}

export interface SendMessageResponse {
  accepted: boolean;
  serverMessageId?: string;
  streamId?: string;
  conversationId: string;
  dedupeHit?: boolean;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export interface StreamChunk {
  streamId: string;
  sequenceNumber: number;
  eventType: "chunk" | "done" | "error" | "thinking";
  content?: string;
  done?: boolean;
  error?: {
    code: string;
    message: string;
  };
}

export const MAX_RETRIES = 3;
export const RETRY_DELAYS = [1000, 2000, 5000];

export function isTerminalStatus(status: MessageStatus): boolean {
  return status === "completed" || status === "failed_terminal" || status === "cancelled";
}

export function canRetry(status: MessageStatus, retryCount: number): boolean {
  return status === "failed_retryable" && retryCount < MAX_RETRIES;
}

export function getNextRetryDelay(retryCount: number): number {
  return RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)];
}

export function generateClientMessageId(): string {
  return `client-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

const DRAFT_STORAGE_KEY = "iliagpt_message_drafts";

export function saveDraft(conversationId: string | null, draft: Partial<ClientMessage>): void {
  try {
    const key = conversationId || "new";
    const drafts = loadAllDrafts();
    drafts[key] = {
      ...drafts[key],
      ...draft,
      updatedAt: Date.now(),
    };
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts));
  } catch (e) {
    console.warn("[Draft] Failed to save draft:", e);
  }
}

export function loadDraft(conversationId: string | null): Partial<ClientMessage> | null {
  try {
    const key = conversationId || "new";
    const drafts = loadAllDrafts();
    const draft = drafts[key];
    if (draft && Date.now() - (draft.updatedAt || 0) < 24 * 60 * 60 * 1000) {
      return draft;
    }
    return null;
  } catch (e) {
    console.warn("[Draft] Failed to load draft:", e);
    return null;
  }
}

export function clearDraft(conversationId: string | null): void {
  try {
    const key = conversationId || "new";
    const drafts = loadAllDrafts();
    delete drafts[key];
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts));
  } catch (e) {
    console.warn("[Draft] Failed to clear draft:", e);
  }
}

function loadAllDrafts(): Record<string, any> {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function createPendingMessage(
  text: string,
  conversationId: string | null,
  attachments: MessageAttachment[] = []
): ClientMessage {
  return {
    clientMessageId: generateClientMessageId(),
    conversationId,
    text,
    attachments,
    status: "draft",
    retryCount: 0,
    createdAt: Date.now(),
    lastEventOffset: 0,
  };
}
