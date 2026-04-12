import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { format, isToday, isYesterday, isThisWeek, isThisYear } from "date-fns";
import { apiFetch, getAnonUserIdHeader } from "@/lib/apiClient";
import { trackWorkspaceEvent } from "@/lib/analytics";
import { buildAssistantMessage } from "@shared/assistantMessage";
import { normalizeFollowUpSuggestions } from "@shared/followUpSuggestions";
import {
  dedupeMessagesByIdentity,
  messagesShareIdentity,
} from "@/lib/chatMessageIdentity";

import { type AgentRunStatus } from "@/stores/agent-store";

export interface FigmaDiagram {
  diagramType: "flowchart" | "orgchart" | "sequence" | "mindmap" | "network";
  nodes: Array<{
    id: string;
    type: "start" | "end" | "process" | "decision";
    label: string;
    x: number;
    y: number;
  }>;
  connections: Array<{
    from: string;
    to: string;
    label?: string;
  }>;
  title?: string;
}

export interface GoogleFormPreview {
  prompt: string;
  fileContext?: Array<{ name: string; content: string; type: string }>;
  autoStart?: boolean;
}

export interface GmailPreview {
  query?: string;
  action?: "search" | "unread" | "recent" | "thread";
  threadId?: string;
  filters?: string[];
}

export interface WebSource {
  url: string;
  title: string;
  domain: string;
  favicon?: string;
  snippet?: string;
  date?: string;
  imageUrl?: string;
  canonicalUrl?: string;
  siteName?: string;
  source: {
    name: string;
    domain: string;
  };
  metadata?: Record<string, any>;
}

export interface AgentRunData {
  runId: string | null;
  status: AgentRunStatus;
  userMessage?: string;
  steps: Array<{
    stepIndex: number;
    toolName: string;
    status: string;
    output?: any;
    error?: string;
  }>;
  eventStream: Array<{
    type: string;
    content: any;
    timestamp: number;
  }>;
  summary: string | null;
  error: string | null;
}

export interface MessageArtifact {
  artifactId: string;
  type: "image" | "document" | "spreadsheet" | "presentation" | "pdf";
  mimeType: string;
  sizeBytes?: number;
  downloadUrl: string;
  previewUrl?: string;
  previewHtml?: string;
  name?: string;
  filename?: string;
  contentUrl?: string;
  metadata?: Record<string, any>;
}

export interface Message {
  id: string;
  // Optimistic UI reconciliation: client-generated temp ID that can be replaced with the real server ID.
  clientTempId?: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  requestId?: string; // Unique ID for idempotency - prevents duplicate processing
  clientRequestId?: string; // For run-based idempotency - creates atomic user message + run
  skipRun?: boolean; // Persist message without creating a chat run (used by Agent mode)
  userMessageId?: string; // For assistant messages: links to the user message it responds to
  runId?: string; // ID of the run this message belongs to
  status?: 'pending' | 'processing' | 'done' | 'failed'; // Processing status for idempotency
  // Message delivery state for optimistic UI.
  deliveryStatus?: 'sending' | 'sent' | 'delivered' | 'error';
  deliveryError?: string;
  isThinking?: boolean;
  steps?: { title: string; status: "pending" | "loading" | "complete" }[];
  attachments?: { type: "word" | "excel" | "ppt" | "image" | "pdf" | "text" | "code" | "archive" | "document" | "unknown"; name: string; mimeType?: string; imageUrl?: string; storagePath?: string; fileId?: string; documentType?: "word" | "excel" | "ppt" | "pdf"; content?: string; title?: string; savedAt?: string; spreadsheetData?: { uploadId: string; sheets: Array<{ name: string; rowCount: number; columnCount: number }>; previewData?: { headers: string[]; data: any[][] }; analysisId?: string; sessionId?: string } }[];
  sources?: { fileName: string; content: string }[];
  figmaDiagram?: FigmaDiagram;
  generatedImage?: string;
  googleFormPreview?: GoogleFormPreview;
  gmailPreview?: GmailPreview;
  agentRun?: AgentRunData;
  artifact?: MessageArtifact; // Generated artifact from ProductionWorkflowRunner
  artifacts?: MessageArtifact[];
  webSources?: WebSource[]; // Web search sources for citations
  searchQueries?: Array<{ query: string; resultCount: number; status: string }>;
  totalSearches?: number;
  followUpSuggestions?: string[];
  
  ui_components?: string[]; // Components to render: 'executive_summary', 'suggested_questions', 'insights_panel'
  confidence?: 'high' | 'medium' | 'low';
  uncertaintyReason?: string;
  metadata?: Record<string, any>;
  retrievalSteps?: { id: string; label: string; status: "pending" | "active" | "complete" | "error"; detail?: string }[];
  cerebroTimeline?: {
    subtasks: Array<{
      id: string;
      title: string;
      description?: string;
      status: "pending" | "running" | "done" | "failed" | "retrying";
      priority?: number;
      dependencies?: string[];
      toolCalls?: Array<{ toolName: string; status: "running" | "done" | "failed"; durationMs?: number }>;
      criticResult?: { verdict: "accept" | "retry" | "backtrack"; reason: string; scores?: { grounding: number; completeness: number; coherence: number } };
      startedAt?: number;
      completedAt?: number;
      retryCount?: number;
    }>;
    judgeResult?: { verdict: "pass" | "fail" | "partial"; confidence: number; reason: string; subtaskResults?: Array<{ subtaskId: string; satisfied: boolean }> } | null;
    evidence?: Array<{ id: string; source: string; chunkIndex?: number; relevanceScore: number; snippet: string; url?: string }>;
    budget?: { tokensUsed: number; tokenLimit: number; estimatedCost: number; costCeiling?: number; budgetRemainingPercent: number; duration?: number; toolsUsedCount?: number } | null;
    planTitle?: string;
    isActive?: boolean;
  };
}

export interface Chat {
  id: string;
  stableKey: string; // Stable key for React that doesn't change when pending -> real ID
  title: string;
  timestamp: number;
  messages: Message[];
  archived?: boolean;
  hidden?: boolean;
  pinned?: boolean;
  pinnedAt?: string;
}

const STORAGE_KEY = "sira-gpt-chats";
const PENDING_CHAT_PREFIX = "pending-";
const SERVER_CHAT_ID_PREFIX = "chat_";
const FAILED_QUEUE_KEY = "ilia_failed_message_queue";
const MAX_FAILED_QUEUE_ITEMS = 20;
const MAX_FAILED_QUEUE_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_SAFE_CHAT_ID_LENGTH = 128;
const CHAT_ID_SAFE_PATTERN = /^(?:chat_[A-Za-z0-9._-]{6,120}|pending-[A-Za-z0-9._-]{6,120}|[A-Za-z0-9._-]{6,120})$/;
const MAX_MESSAGE_CONTENT_LENGTH = 500_000;
const MAX_REQUEST_ID_LENGTH = 120;
const pendingToRealIdMap = new Map<string, string>();

// Idempotency: Track messages being processed to prevent duplicates
const processingRequestIds = new Set<string>();
const savedRequestIds = new Set<string>();
const savedRequestIdOrder: string[] = [];
const MAX_SAVED_REQUEST_IDS = 5000;

function rememberSavedRequestId(requestId: string): void {
  if (savedRequestIds.has(requestId)) return;
  savedRequestIds.add(requestId);
  savedRequestIdOrder.push(requestId);

  // Prevent unbounded growth in long-lived sessions.
  if (savedRequestIdOrder.length > MAX_SAVED_REQUEST_IDS) {
    const excess = savedRequestIdOrder.length - MAX_SAVED_REQUEST_IDS;
    for (let i = 0; i < excess; i++) {
      const oldest = savedRequestIdOrder.shift();
      if (oldest) savedRequestIds.delete(oldest);
    }
  }
}

function sanitizeChatId(candidateChatId: string): string {
  if (typeof candidateChatId !== "string") {
    throw new Error("Invalid chat ID");
  }

  const chatId = candidateChatId.trim();
  if (!chatId || chatId.length > MAX_SAFE_CHAT_ID_LENGTH) {
    throw new Error("Invalid chat ID");
  }
  if (!CHAT_ID_SAFE_PATTERN.test(chatId)) {
    throw new Error("Invalid chat ID");
  }
  return chatId;
}

function sanitizeRequestId(requestId?: string): string | undefined {
  if (!requestId || typeof requestId !== "string") return undefined;
  const normalized = requestId.trim();
  if (!normalized || normalized.length > MAX_REQUEST_ID_LENGTH) return undefined;
  return normalized;
}

function sanitizeSendMessage(message: Message): Message {
  const role = message.role;
  if (role !== "user" && role !== "assistant" && role !== "system") {
    throw new Error("Invalid message role");
  }

  // Preserve full content — only trimEnd trailing whitespace, never truncate.
  // The server enforces the real size limit (500K chars via Zod, 100MB via body-parser).
  const sanitizedContent = typeof message.content === "string" ? message.content.trimEnd() : "";
  if (role === "user" && sanitizedContent.length > MAX_MESSAGE_CONTENT_LENGTH) {
    throw new Error("Message content too long (max 500K characters)");
  }

  const normalizedAssistantMessage = role === "assistant"
    ? buildAssistantMessage({
        content: sanitizedContent,
        artifact: message.artifact,
        artifacts: message.artifacts,
        figmaDiagram: message.figmaDiagram,
        generatedImage: message.generatedImage,
        googleFormPreview: message.googleFormPreview,
        gmailPreview: message.gmailPreview,
        webSources: message.webSources,
        searchQueries: message.searchQueries,
        totalSearches: message.totalSearches,
        followUpSuggestions: message.followUpSuggestions,
        confidence: message.confidence,
        uncertaintyReason: message.uncertaintyReason,
        retrievalSteps: message.retrievalSteps,
        steps: message.steps,
      })
    : null;

  return {
    ...message,
    content: normalizedAssistantMessage?.content ?? sanitizedContent,
    requestId: sanitizeRequestId(message.requestId),
    artifact: normalizedAssistantMessage?.artifact ?? message.artifact,
    artifacts: normalizedAssistantMessage?.artifacts ?? message.artifacts,
    figmaDiagram: normalizedAssistantMessage?.figmaDiagram ?? message.figmaDiagram,
    generatedImage: normalizedAssistantMessage?.generatedImage ?? message.generatedImage,
    googleFormPreview: normalizedAssistantMessage?.googleFormPreview ?? message.googleFormPreview,
    gmailPreview: normalizedAssistantMessage?.gmailPreview ?? message.gmailPreview,
    webSources: normalizedAssistantMessage?.webSources ?? message.webSources,
    searchQueries: normalizedAssistantMessage?.searchQueries ?? message.searchQueries,
    totalSearches: normalizedAssistantMessage?.totalSearches ?? message.totalSearches,
    followUpSuggestions: normalizedAssistantMessage?.followUpSuggestions ?? normalizeFollowUpSuggestions(message.followUpSuggestions),
    confidence: normalizedAssistantMessage?.confidence ?? message.confidence,
    uncertaintyReason: normalizedAssistantMessage?.uncertaintyReason ?? message.uncertaintyReason,
    retrievalSteps: normalizedAssistantMessage?.retrievalSteps ?? message.retrievalSteps,
    steps: normalizedAssistantMessage?.steps ?? message.steps,
  };
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_MESSAGE_ID_PREFIXES = ["local_", "temp-"];
const CHAT_SYNC_VALIDATION_COOLDOWN_MS = 8_000;
const CHAT_SYNC_VALIDATION_MAX_IDS = 300;

interface ChatSyncValidationResponse {
  valid: boolean;
  serverMessageCount: number;
  clientMessageCount: number;
  difference: number;
  missingOnClient: string[];
  extraOnClient: string[];
  lastServerMessageId: string | null;
  syncRecommendation: "FULL_REFRESH" | "NONE";
}

function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

function isLikelyPersistedMessage(message: Pick<Message, "id" | "deliveryStatus">): boolean {
  const id = typeof message.id === "string" ? message.id : "";
  const deliveryStatus =
    typeof message.deliveryStatus === "string" ? message.deliveryStatus : undefined;

  if (!id || LOCAL_MESSAGE_ID_PREFIXES.some((prefix) => id.startsWith(prefix))) {
    return false;
  }

  return (
    deliveryStatus === "sent" ||
    deliveryStatus === "delivered" ||
    (deliveryStatus !== "error" && deliveryStatus !== "sending" && isUuid(id)) ||
    (!deliveryStatus && isUuid(id))
  );
}

function collectPersistedMessageIds(messages: Message[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const message of messages) {
    if (!isLikelyPersistedMessage(message)) continue;
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    ids.push(message.id);
  }

  return ids;
}

function safeReadLocalChatsFromStorage(storageKey: string): Chat[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const restored: Chat[] = parsed.map((chat: any) => ({
      ...chat,
      stableKey: chat?.stableKey || `stable-${chat?.id}`,
      messages: Array.isArray(chat?.messages)
        ? chat.messages.map((msg: any) => {
          // Hydrate savedRequestIds from localStorage data (best-effort).
          // IMPORTANT: localStorage may include optimistic/failed messages that were never persisted,
          // so only treat requestIds as "persisted" when we have evidence it reached the server.
          if (msg?.requestId) {
            const id = typeof msg.id === "string" ? msg.id : "";
            const deliveryStatus = typeof msg.deliveryStatus === "string" ? msg.deliveryStatus : undefined;
            const isLikelyPersisted = isLikelyPersistedMessage({ id, deliveryStatus });

            if (isLikelyPersisted) {
              markRequestPersisted(msg.requestId);
            }
          }

          const hydrated: Message = {
            ...msg,
            timestamp: new Date(msg.timestamp),
          };

          // A "sending" message can't actually be in-flight across a reload.
          // Treat it as retryable and queue it for recovery so it won't stay stuck forever.
          if (
            hydrated.role === "user" &&
            hydrated.requestId &&
            hydrated.deliveryStatus === "sending" &&
            typeof chat?.id === "string" &&
            !chat.id.startsWith(PENDING_CHAT_PREFIX)
          ) {
            enqueueFailedMessageForRecovery(chat.id, hydrated);
            hydrated.deliveryStatus = "error";
            hydrated.deliveryError = hydrated.deliveryError || "No se pudo confirmar el envío. Reintenta.";
          }

          return hydrated;
        })
        : [],
    }));

    return restored;
  } catch (e) {
    console.warn("[localStorage] Failed to parse chats cache:", e);
    return [];
  }
}

function mergeServerChatsWithLocal(serverChats: Chat[], localChats: Chat[]): Chat[] {
  const localById = new Map<string, Chat>();
  for (const c of localChats) {
    if (c?.id) localById.set(c.id, c);
  }

  const serverIds = new Set(serverChats.map((c) => c.id));

  // Keep pending chats only if their resolved real ID is NOT already on the server.
  // This prevents duplicates when a pending chat was created locally and the server
  // already returned the real chat (e.g. after addMessage created it).
  const pendingChats = localChats.filter((c) => {
    if (typeof c?.id !== "string" || !c.id.startsWith(PENDING_CHAT_PREFIX)) return false;
    const realId = pendingToRealIdMap.get(c.id);
    if (realId && serverIds.has(realId)) return false; // server already has the real version
    return true;
  });

  const mergedServerChats = serverChats.map((serverChat) => {
    const local = localById.get(serverChat.id);
    // Never replace local messages with an empty server array.
    // The server list endpoint returns chats without messages (N+1 avoidance),
    // so serverChat.messages is almost always []. Overwriting local messages
    // with [] causes the "disappearing messages" bug.
    const localHasMessages = Array.isArray(local?.messages) && local.messages.length > 0;
    const serverHasMessages = Array.isArray(serverChat.messages) && serverChat.messages.length > 0;
    let messages: Message[];
    if (localHasMessages) {
      messages = local.messages;
    } else if (serverHasMessages) {
      messages = serverChat.messages;
    } else {
      messages = local?.messages ?? serverChat.messages ?? [];
    }
    return {
      ...serverChat,
      stableKey: local?.stableKey || serverChat.stableKey || `stable-${serverChat.id}`,
      messages,
    };
  });

  const byId = new Map<string, Chat>();
  for (const chat of [...pendingChats, ...mergedServerChats]) {
    if (!chat?.id) continue;
    const existing = byId.get(chat.id);
    byId.set(chat.id, existing ? { ...existing, ...chat } : chat);
  }

  return Array.from(byId.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

// Run-based idempotency: Track active runs to prevent duplicate AI calls
export interface ChatRun {
  id: string;
  chatId: string;
  clientRequestId: string;
  userMessageId: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  assistantMessageId?: string;
  lastSeq?: number;
  error?: string;
}

/**
 * Acknowledgement returned by addMessage / onSendMessage.
 * Contains the resolved chat run and optional resolved chatId.
 */
export interface SendMessageAck {
  run?: ChatRun;
  deduplicated?: boolean;
  /** Resolved real chat ID (may differ from pending ID used locally). */
  chatId?: string;
}

/**
 * Generates a unique run ID for tracking a streaming response.
 */
export function generateRunId(): string {
  try {
    const c: any = (globalThis as any).crypto;
    if (c && typeof c.randomUUID === "function") {
      return `run_${c.randomUUID()}`;
    }
  } catch {
    // ignore
  }
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

const activeRuns = new Map<string, ChatRun>(); // chatId -> active run

// ============================================================================
// RETRY QUEUE: Automatic retry for failed message saves with exponential backoff
// ============================================================================
interface RetryItem {
  chatId: string;
  message: Message;
  retryCount: number;
  nextRetryAt: number;
  error?: string;
}

const retryQueue: RetryItem[] = [];
const MAX_RETRY_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 1000; // 1 second
const MAX_RETRY_DELAY_MS = 16000; // 16 seconds
const MESSAGE_SAVE_TIMEOUT_MS = 20000;

interface FailedMessageQueueItem {
  chatId: string;
  role: "user";
  content: string;
  requestId: string;
  clientRequestId?: string;
  attachments?: Message["attachments"];
  localId?: string;
  timestamp: number;
}

function safeReadFailedQueue(): FailedMessageQueueItem[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(FAILED_QUEUE_KEY) || "[]";
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeWriteFailedQueue(items: FailedMessageQueueItem[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(FAILED_QUEUE_KEY, JSON.stringify(items.slice(-MAX_FAILED_QUEUE_ITEMS)));
  } catch {
    // ignore
  }
}

function enqueueFailedMessageForRecovery(chatId: string, message: Message): void {
  if (!message.requestId) return;
  if (chatId.startsWith(PENDING_CHAT_PREFIX)) return; // Can't recover a message for a chat that doesn't exist on server.
  const existing = safeReadFailedQueue();
  if (existing.some((q) => q?.requestId === message.requestId)) return;

  existing.push({
    chatId,
    role: message.role,
    content: message.content,
    requestId: message.requestId,
    clientRequestId: message.clientRequestId,
    attachments: sanitizeAttachmentsForServer(message.attachments),
    localId: message.clientTempId || message.id,
    timestamp: Date.now(),
  });
  safeWriteFailedQueue(existing);
}

function removeFailedMessageFromRecoveryQueue(requestId?: string): void {
  if (!requestId) return;
  const existing = safeReadFailedQueue();
  if (existing.length === 0) return;
  const filtered = existing.filter((q) => q?.requestId !== requestId);
  if (filtered.length === existing.length) return;
  safeWriteFailedQueue(filtered);
}

// Sync status for UI feedback
export type SyncStatus = 'idle' | 'saving' | 'saved' | 'error' | 'retrying';
let currentSyncStatus: SyncStatus = 'idle';
let syncStatusListeners: ((status: SyncStatus) => void)[] = [];

export function getSyncStatus(): SyncStatus {
  return currentSyncStatus;
}

export function subscribeSyncStatus(listener: (status: SyncStatus) => void): () => void {
  syncStatusListeners.push(listener);
  return () => {
    syncStatusListeners = syncStatusListeners.filter(l => l !== listener);
  };
}

function setSyncStatus(status: SyncStatus) {
  currentSyncStatus = status;
  syncStatusListeners.forEach(l => l(status));
}

// Calculate delay with exponential backoff
function getRetryDelay(retryCount: number): number {
  const delay = BASE_RETRY_DELAY_MS * Math.pow(2, retryCount);
  return Math.min(delay, MAX_RETRY_DELAY_MS);
}

// Add failed message to retry queue
export function addToRetryQueue(chatId: string, message: Message, error?: string): void {
  // Check if already in queue
  const existing = retryQueue.find(item => item.message.id === message.id);
  if (existing) {
    existing.retryCount++;
    existing.nextRetryAt = Date.now() + getRetryDelay(existing.retryCount);
    existing.error = error;
    return;
  }

  retryQueue.push({
    chatId,
    message,
    retryCount: 0,
    nextRetryAt: Date.now() + BASE_RETRY_DELAY_MS,
    error
  });

  setSyncStatus('retrying');
  console.log(`[RetryQueue] Added message ${message.id} to retry queue. Queue size: ${retryQueue.length}`);
}

// Get pending retry count for UI
export function getRetryQueueSize(): number {
  return retryQueue.length;
}

// Get retry queue items for debugging
export function getRetryQueueItems(): RetryItem[] {
  return [...retryQueue];
}

// Clear retry queue (for testing or reset)
export function clearRetryQueue(): void {
  retryQueue.length = 0;
  if (currentSyncStatus === 'retrying') {
    setSyncStatus('idle');
  }
}

// Process retry queue - call this periodically or on network recovery
let retryProcessorRunning = false;
export async function processRetryQueue(saveMessageFn: (chatId: string, message: Message) => Promise<boolean>): Promise<void> {
  if (retryProcessorRunning || retryQueue.length === 0) return;

  retryProcessorRunning = true;
  const now = Date.now();

  // Get items ready to retry
  const readyItems = retryQueue.filter(item => item.nextRetryAt <= now);

  for (const item of readyItems) {
    if (item.retryCount >= MAX_RETRY_ATTEMPTS) {
      // Max retries reached - remove from queue and mark as error
      const index = retryQueue.indexOf(item);
      if (index > -1) retryQueue.splice(index, 1);
      console.error(`[RetryQueue] Max retries (${MAX_RETRY_ATTEMPTS}) reached for message ${item.message.id}`);
      continue;
    }

    try {
      setSyncStatus('saving');
      const success = await saveMessageFn(item.chatId, item.message);

      if (success) {
        // Successfully saved - remove from queue
        const index = retryQueue.indexOf(item);
        if (index > -1) retryQueue.splice(index, 1);
        console.log(`[RetryQueue] Successfully saved message ${item.message.id} on retry ${item.retryCount + 1}`);

        if (retryQueue.length === 0) {
          setSyncStatus('saved');
          // Auto-reset to idle after 3 seconds
          setTimeout(() => setSyncStatus('idle'), 3000);
        }
      } else {
        // Save failed - update retry info
        item.retryCount++;
        item.nextRetryAt = Date.now() + getRetryDelay(item.retryCount);
        console.log(`[RetryQueue] Retry ${item.retryCount} failed for message ${item.message.id}, next retry in ${getRetryDelay(item.retryCount)}ms`);
      }
    } catch (error) {
      item.retryCount++;
      item.nextRetryAt = Date.now() + getRetryDelay(item.retryCount);
      item.error = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[RetryQueue] Error on retry ${item.retryCount}:`, error);
    }
  }

  retryProcessorRunning = false;

  // Update status based on queue state
  if (retryQueue.length > 0) {
    setSyncStatus('retrying');
  }
}

// Start retry processor interval (call once on app init)
let retryIntervalId: NodeJS.Timeout | null = null;
export function startRetryProcessor(saveMessageFn: (chatId: string, message: Message) => Promise<boolean>): void {
  if (retryIntervalId) return; // Already running

  retryIntervalId = setInterval(() => {
    processRetryQueue(saveMessageFn);
  }, 2000); // Check every 2 seconds

  // Also process on network recovery
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      console.log('[RetryQueue] Network recovered - processing queue');
      processRetryQueue(saveMessageFn);
    });
  }
}

export function stopRetryProcessor(): void {
  if (retryIntervalId) {
    clearInterval(retryIntervalId);
    retryIntervalId = null;
  }
}

// Strip all large data fields from attachments before sending to server.
// Only lightweight metadata (name, type, fileId, storagePath, size) is needed server-side.
// The actual file content lives in object storage (storagePath) and conversationDocuments table.
function sanitizeAttachmentsForServer(attachments: Message['attachments']): Message['attachments'] {
  if (!attachments || attachments.length === 0) return attachments;
  return attachments.map(att => {
    // Build a clean attachment with only metadata — strip content, imageUrl, thumbnail, dataUrl
    const a = att as any;
    const clean: Record<string, any> = {
      id: a.id || a.fileId,
      fileId: a.fileId,
      name: att.name,
      type: att.type,
      mimeType: a.mimeType || att.type,
      size: a.size,
      storagePath: a.storagePath,
    };
    // Keep spreadsheetData metadata but strip large previewData
    const spreadsheetData = a.spreadsheetData;
    if (spreadsheetData) {
      clean.spreadsheetData = {
        uploadId: spreadsheetData.uploadId,
        sheets: spreadsheetData.sheets,
        analysisId: spreadsheetData.analysisId,
        sessionId: spreadsheetData.sessionId,
      };
    }
    return clean as any;
  });
}

function parseServerTimingHeader(value: string | null): Record<string, number> {
  if (!value) return {};

  const timings: Record<string, number> = {};
  const entries = value.split(",");

  for (const entry of entries) {
    const parts = entry.split(";");
    const name = parts[0]?.trim();
    if (!name) continue;

    const normalizedName = name.toLowerCase();
    for (const part of parts.slice(1)) {
      const [rawKey, rawValue] = part.split("=");
      if (!rawKey || !rawValue) continue;
      if (rawKey.trim() !== "dur") continue;
      const numericValue = Number.parseFloat(rawValue);
      if (Number.isFinite(numericValue)) {
        timings[normalizedName] = numericValue;
      }
    }
  }

  return timings;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  if (typeof AbortController === "undefined") {
    return apiFetch(url, init);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const externalSignal = init.signal;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  try {
    return await apiFetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

// Retry an async operation with exponential backoff and jitter.
// Used for critical operations like message saves that must not silently fail.
async function withRetry<T>(
  fn: () => Promise<T>,
  { maxRetries = 3, baseDelayMs = 800, maxDelayMs = 10000 }: { maxRetries?: number; baseDelayMs?: number; maxDelayMs?: number } = {}
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt) + Math.random() * 200, maxDelayMs);
        console.warn(`[withRetry] Attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms:`, lastError.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// Generate a unique request ID for idempotency
export function generateRequestId(): string {
  try {
    const c: any = (globalThis as any).crypto;
    if (c && typeof c.randomUUID === "function") {
      return `req_${c.randomUUID()}`;
    }
  } catch {
    // ignore
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// ============================================================================
// AUTO-SAVE DEBOUNCING: Prevents excessive localStorage writes during streaming
// ============================================================================
const DEBOUNCE_DELAY_MS = 500; // Debounce localStorage saves by 500ms
let localStorageDebounceTimer: NodeJS.Timeout | null = null;
let pendingChatsToSave: Chat[] | null = null;

function debouncedLocalStorageSave(chats: Chat[], storageKey: string): void {
  pendingChatsToSave = chats;

  if (localStorageDebounceTimer) {
    clearTimeout(localStorageDebounceTimer);
  }

  localStorageDebounceTimer = setTimeout(() => {
    if (pendingChatsToSave) {
      try {
        // Strip large data from messages to save space (base64 images, sources, etc.)
        const chatsForStorage = pendingChatsToSave.map(chat => ({
          ...chat,
          messages: chat.messages.map(msg => ({
            ...msg,
            sources: undefined,
            generatedImage: undefined,
            // Strip base64 imageUrl from attachments to avoid exceeding localStorage 5MB limit.
            // Images can be reloaded from storagePath on next session.
            attachments: msg.attachments?.map(att => {
              const { imageUrl, ...rest } = att;
              return rest;
            })
          }))
        }));
        localStorage.setItem(storageKey, JSON.stringify(chatsForStorage));
        // FRONTEND FIX #14: Only log in development to reduce noise in production
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[Debounce] Saved ${pendingChatsToSave.length} chats to localStorage`);
        }
      } catch (e) {
        console.warn("[Debounce] Failed to save chats to localStorage:", e);
        localStorage.removeItem(storageKey);
      }
      pendingChatsToSave = null;
    }
    localStorageDebounceTimer = null;
  }, DEBOUNCE_DELAY_MS);
}

// Force flush pending saves (call before page unload)
export function flushPendingLocalStorageSave(storageKey: string): void {
  if (pendingChatsToSave && localStorageDebounceTimer) {
    clearTimeout(localStorageDebounceTimer);
    localStorageDebounceTimer = null;

    try {
      const chatsForStorage = pendingChatsToSave.map(chat => ({
        ...chat,
        messages: chat.messages.map(msg => ({
          ...msg,
          sources: undefined,
          generatedImage: undefined,
          attachments: msg.attachments?.map(att => {
            const { imageUrl, ...rest } = att;
            return rest;
          })
        }))
      }));
      localStorage.setItem(storageKey, JSON.stringify(chatsForStorage));
      console.log(`[Debounce] Flushed ${pendingChatsToSave.length} chats on unload`);
    } catch (e) {
      console.warn("[Debounce] Failed to flush chats:", e);
    }
    pendingChatsToSave = null;
  }
}

// Rate limiting configuration
const RATE_LIMIT_MAX_MESSAGES = 3;
const RATE_LIMIT_WINDOW_MS = 10000; // 10 seconds
const messageTimestamps: number[] = [];

export interface RateLimitResult {
  allowed: boolean;
  remainingMessages: number;
  resetInMs: number;
}

export function checkRateLimit(): RateLimitResult {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  // Remove timestamps outside the window
  while (messageTimestamps.length > 0 && messageTimestamps[0] < windowStart) {
    messageTimestamps.shift();
  }

  const remaining = RATE_LIMIT_MAX_MESSAGES - messageTimestamps.length;
  const resetInMs = messageTimestamps.length > 0
    ? Math.max(0, messageTimestamps[0] + RATE_LIMIT_WINDOW_MS - now)
    : 0;

  return {
    allowed: remaining > 0,
    remainingMessages: Math.max(0, remaining),
    resetInMs
  };
}

export function recordMessageSent(): void {
  messageTimestamps.push(Date.now());
}

export function useRateLimiter() {
  const check = useCallback((): RateLimitResult => {
    return checkRateLimit();
  }, []);

  const record = useCallback((): void => {
    recordMessageSent();
  }, []);

  return { checkRateLimit: check, recordMessageSent: record };
}

// Generate a unique client request ID for run-based idempotency
export function generateClientRequestId(): string {
  try {
    const c: any = (globalThis as any).crypto;
    if (c && typeof c.randomUUID === "function") {
      return `cri_${c.randomUUID()}`;
    }
  } catch {
    // ignore
  }
  return `cri_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// Resolve pending chat ID to real ID if available
export function resolveRealChatId(chatId: string): string {
  return pendingToRealIdMap.get(chatId) || chatId;
}

// Check if a chat ID is pending (not yet created on server)
export function isPendingChat(chatId: string): boolean {
  if (chatId.startsWith(PENDING_CHAT_PREFIX)) return true;
  const resolved = resolveRealChatId(chatId);
  return resolved.startsWith(PENDING_CHAT_PREFIX);
}

export function generateStableChatKey(): string {
  try {
    const c: any = (globalThis as any).crypto;
    if (c && typeof c.randomUUID === "function") {
      return `stable-${c.randomUUID()}`;
    }
  } catch {
    // ignore
  }
  return `stable-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateStableServerChatId(): string {
  try {
    const c: any = (globalThis as any).crypto;
    if (c && typeof c.randomUUID === "function") {
      return `${SERVER_CHAT_ID_PREFIX}${c.randomUUID()}`;
    }
  } catch {
    // ignore
  }
  return `${SERVER_CHAT_ID_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// Check if a chat has an active run (pending or processing)
export function hasActiveRun(chatId: string): boolean {
  const run = activeRuns.get(chatId);
  return run ? (run.status === 'pending' || run.status === 'processing') : false;
}

// Get active run for a chat
export function getActiveRun(chatId: string): ChatRun | undefined {
  return activeRuns.get(chatId);
}

// Set active run for a chat
export function setActiveRun(chatId: string, run: ChatRun): void {
  activeRuns.set(chatId, run);
}

// Clear active run for a chat
export function clearActiveRun(chatId: string): void {
  activeRuns.delete(chatId);
}

// Update active run status
export function updateActiveRunStatus(chatId: string, status: 'pending' | 'processing' | 'done' | 'failed', assistantMessageId?: string): void {
  const run = activeRuns.get(chatId);
  if (run) {
    run.status = status;
    if (assistantMessageId) {
      run.assistantMessageId = assistantMessageId;
    }
    if (status === 'done' || status === 'failed') {
      // Keep in map but marked as complete for reference
    }
  }
}

// Check if a request is already being processed
export function isRequestProcessing(requestId: string): boolean {
  return processingRequestIds.has(requestId);
}

// Mark a request as being processed
export function markRequestProcessing(requestId: string): boolean {
  if (processingRequestIds.has(requestId) || savedRequestIds.has(requestId)) {
    return false; // Already processing or saved
  }
  processingRequestIds.add(requestId);
  return true;
}

// Mark a request as completed (persisted - no TTL for long-lived idempotency)
export function markRequestComplete(requestId: string): void {
  processingRequestIds.delete(requestId);
  rememberSavedRequestId(requestId);
  // No TTL - requestIds stay in savedRequestIds for the session to ensure idempotency
  // Memory is managed by page reload which clears and re-hydrates from server
}

// Mark a request as persisted (hydrated from server/localStorage - no TTL)
export function markRequestPersisted(requestId: string): void {
  rememberSavedRequestId(requestId);
  // No TTL - persisted requestIds stay in memory for the session
}

// Separate in-memory store for generated images (not persisted to localStorage)
const generatedImagesStore = new Map<string, string>();

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB limit for base64 images
const MAX_STORED_IMAGES = 50; // Maximum number of images to keep in memory

export function storeGeneratedImage(messageId: string, imageData: string): boolean {
  if (!imageData || !messageId) {
    console.warn('[storeGeneratedImage] Invalid messageId or imageData provided');
    return false;
  }

  const estimatedSizeBytes = imageData.length * 0.75;

  if (estimatedSizeBytes > MAX_IMAGE_SIZE_BYTES) {
    console.warn(`[storeGeneratedImage] Image too large (${(estimatedSizeBytes / 1024 / 1024).toFixed(2)}MB > ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB limit) for message ${messageId}`);
    return false;
  }

  if (generatedImagesStore.size >= MAX_STORED_IMAGES && !generatedImagesStore.has(messageId)) {
    const oldestKey = generatedImagesStore.keys().next().value;
    if (oldestKey) {
      generatedImagesStore.delete(oldestKey);
      console.debug(`[storeGeneratedImage] Evicted oldest image to make room for new one`);
    }
  }

  generatedImagesStore.set(messageId, imageData);
  return true;
}

export function getGeneratedImage(messageId: string): string | undefined {
  return generatedImagesStore.get(messageId);
}

export interface LastImageInfo {
  messageId: string;
  base64: string;
  artifactId: string | null;
  previewUrl?: string;
}

// Track last generated image metadata
let lastGeneratedImageInfo: LastImageInfo | null = null;

export function storeLastGeneratedImageInfo(info: LastImageInfo): void {
  lastGeneratedImageInfo = info;
  console.log('[storeLastGeneratedImageInfo] Stored last image:', info.messageId);
}

export function getLastGeneratedImage(): LastImageInfo | null {
  return lastGeneratedImageInfo;
}

export function clearLastGeneratedImage(): void {
  lastGeneratedImageInfo = null;
}

export function clearGeneratedImages(): void {
  generatedImagesStore.clear();
  lastGeneratedImageInfo = null;
}

export function useChats() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Track if user has manually set activeChatId to prevent auto-selection
  const userHasSelectedRef = useRef(false);
  const recoveringFailedQueueRef = useRef(false);
  const chatsRef = useRef<Chat[]>([]);
  chatsRef.current = chats;
  const activeChatIdRef = useRef<string | null>(null);
  activeChatIdRef.current = activeChatId;
  const validationInFlightRef = useRef<Set<string>>(new Set());
  const lastValidationAtRef = useRef<Map<string, number>>(new Map());

  // Wrapper that tracks user selection intent
  const setActiveChatIdWithTracking = useCallback((id: string | null) => {
    userHasSelectedRef.current = true;
    setActiveChatId(id);
  }, []);

  const trackChatMessageSent = useCallback((chatId: string, message: any, deduplicated?: boolean) => {
    if (message?.role !== "user") return;
    if (deduplicated) return;
    void trackWorkspaceEvent({
      eventType: "action",
      action: "chat_message_sent",
      metadata: {
        chatId,
        contentLength: typeof message?.content === "string" ? message.content.length : 0,
        attachmentsCount: Array.isArray(message?.attachments) ? message.attachments.length : 0,
        hasAttachments: Array.isArray(message?.attachments) ? message.attachments.length > 0 : false,
      },
    });
  }, []);

  const fetchChatDetails = useCallback(async (chatId: string) => {
    // Skip if it's a pending chat or we're already loading
    if (isPendingChat(chatId)) return;

    // Skip if the chat has an active run (streaming) — replacing messages
    // mid-stream causes the "disappearing messages" bug.
    if (activeRuns.has(chatId)) {
      console.info("[fetchChatDetails] Skipping — active run in progress for", chatId);
      return;
    }

    try {
      const res = await apiFetch(`/api/chats/${chatId}`, {
        headers: { ...getAnonUserIdHeader() },
        credentials: "include"
      });

      if (!res.ok) {
        if (res.status === 404) {
          // Chat not found, maybe deleted. Remove from list.
          setChats(prev => prev.filter(c => c.id !== chatId));
        }
        return;
      }

      const fullChat = await res.json();

      // Hydrate attachments (logic copied from original loadChatsFromServer)
      const convDocs: any[] = fullChat.conversationDocuments || [];
      const docsByMessageId = new Map<string, any[]>();
      for (const doc of convDocs) {
        if (doc.messageId) {
          const existing = docsByMessageId.get(doc.messageId) || [];
          existing.push(doc);
          docsByMessageId.set(doc.messageId, existing);
        }
      }

      const messages: Message[] = (fullChat.messages || []).map((msg: any) => {
        if (msg.requestId) markRequestPersisted(msg.requestId);

        let hydratedAttachments = msg.attachments;
        if ((!hydratedAttachments || hydratedAttachments.length === 0) && docsByMessageId.has(msg.id)) {
          hydratedAttachments = docsByMessageId.get(msg.id)!.map((doc: any) => ({
            id: doc.id,
            fileId: doc.metadata?.fileId || doc.id,
            name: doc.fileName,
            type: doc.mimeType,
            mimeType: doc.mimeType,
            size: doc.fileSize || 0,
            storagePath: doc.storagePath,
          }));
        } else if (hydratedAttachments && hydratedAttachments.length > 0 && docsByMessageId.has(msg.id)) {
          const docs = docsByMessageId.get(msg.id)!;
          hydratedAttachments = hydratedAttachments.map((att: any) => {
            const matchingDoc = docs.find((d: any) =>
              d.fileName === att.name ||
              (d.metadata?.fileId && d.metadata.fileId === att.fileId)
            );
            if (matchingDoc) {
              return {
                ...att,
                storagePath: att.storagePath || matchingDoc.storagePath,
                size: att.size || matchingDoc.fileSize || 0,
                mimeType: att.mimeType || matchingDoc.mimeType,
              };
            }
            return att;
          });
        }

        const assistantMessage = msg.role === "assistant"
          ? buildAssistantMessage({
              content: msg.content,
              artifact: msg.artifact || msg.metadata?.artifact,
              artifacts: msg.artifacts || msg.metadata?.artifacts,
              figmaDiagram: msg.figmaDiagram,
              generatedImage: msg.generatedImage,
              googleFormPreview: msg.googleFormPreview,
              gmailPreview: msg.gmailPreview,
              webSources: msg.webSources || msg.metadata?.webSources,
              searchQueries: msg.searchQueries || msg.metadata?.searchQueries,
              totalSearches: msg.totalSearches || msg.metadata?.totalSearches,
              followUpSuggestions: msg.followUpSuggestions || msg.metadata?.followUpSuggestions,
              confidence: msg.confidence || msg.metadata?.confidence,
              uncertaintyReason: msg.uncertaintyReason || msg.metadata?.uncertaintyReason,
              retrievalSteps: msg.retrievalSteps || msg.metadata?.retrievalSteps,
              steps: msg.steps || msg.metadata?.steps,
            })
          : null;

        return {
          id: msg.id,
          role: msg.role,
          content: assistantMessage?.content ?? msg.content,
          timestamp: new Date(msg.createdAt),
          requestId: msg.requestId,
          userMessageId: msg.userMessageId,
          attachments: hydratedAttachments,
          sources: msg.sources,
          artifact: assistantMessage?.artifact ?? msg.artifact ?? msg.metadata?.artifact,
          artifacts: assistantMessage?.artifacts ?? msg.artifacts ?? msg.metadata?.artifacts,
          figmaDiagram: assistantMessage?.figmaDiagram ?? msg.figmaDiagram,
          googleFormPreview: assistantMessage?.googleFormPreview ?? msg.googleFormPreview,
          gmailPreview: assistantMessage?.gmailPreview ?? msg.gmailPreview,
          generatedImage: assistantMessage?.generatedImage ?? msg.generatedImage,
          webSources: assistantMessage?.webSources,
          searchQueries: assistantMessage?.searchQueries,
          totalSearches: assistantMessage?.totalSearches,
          followUpSuggestions: assistantMessage?.followUpSuggestions,
          confidence: assistantMessage?.confidence,
          uncertaintyReason: assistantMessage?.uncertaintyReason,
          retrievalSteps: assistantMessage?.retrievalSteps,
          steps: assistantMessage?.steps,
        };
      });

      // Merge any locally queued/unsent user messages (persistent outbox) so reloads don't "lose" them
      // even when the server is reachable and localStorage chat cache is replaced.
      const persistedRequestIds = new Set<string>();
      for (const msg of messages) {
        if (msg.requestId) persistedRequestIds.add(msg.requestId);
      }

      const failedQueue = safeReadFailedQueue().filter((q) => q?.chatId === chatId);
      if (failedQueue.length > 0) {
        for (const queued of failedQueue) {
          if (!queued?.requestId) continue;
          if (queued.timestamp && Date.now() - queued.timestamp > MAX_FAILED_QUEUE_AGE_MS) {
            removeFailedMessageFromRecoveryQueue(queued.requestId);
            continue;
          }
          // If it already exists on the server, the queue entry is stale.
          if (persistedRequestIds.has(queued.requestId)) {
            removeFailedMessageFromRecoveryQueue(queued.requestId);
            continue;
          }
          const alreadyInList = messages.some((m) => m.role === "user" && m.requestId === queued.requestId);
          if (alreadyInList) continue;

          const localId = queued.localId || `local_${queued.requestId}`;
          messages.push({
            id: localId,
            clientTempId: localId,
            role: "user",
            content: queued.content,
            timestamp: new Date(queued.timestamp || Date.now()),
            requestId: queued.requestId,
            clientRequestId: queued.clientRequestId,
            attachments: queued.attachments,
            deliveryStatus: isRequestProcessing(queued.requestId) ? "sending" : "error",
            deliveryError: undefined,
          });
        }
        messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      }

      setChats(prev => prev.map(c => {
        if (c.id !== chatId) return c;

        // Merge: keep any local messages not present in the server response
        // (e.g. optimistic messages still being sent) so they don't vanish.
        const serverIds = new Set(messages.map(m => m.id));
        const localExtras = (c.messages ?? []).filter(m => {
          // Keep messages that the server doesn't know about yet
          if (m.id && !serverIds.has(m.id) && (
            m.id.startsWith("local_") ||
            m.id.startsWith("temp_") ||
            m.deliveryStatus === "sending" ||
            m.deliveryStatus === "queued"
          )) {
            return true;
          }
          return false;
        });

        const merged = localExtras.length > 0
          ? [...messages, ...localExtras].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
          : messages;

        return { ...c, messages: merged };
      }));

    } catch (error) {
      console.warn(`Failed to fetch details for chat ${chatId}:`, error);
    }
  }, []);
  const loadChatsFromServer = useCallback(async () => {
    try {
      const res = await apiFetch("/api/chats", {
        headers: { ...getAnonUserIdHeader() },
        credentials: "include"
      });
      if (!res.ok) throw new Error("Failed to load chats");
      const serverChats = await res.json();

      // Only fetch basic metadata for the list. Do not fetch full message history for all chats (N+1 avoidance).
      const formattedChats: Chat[] = serverChats.map((chat: any) => ({
        id: chat.id,
        stableKey: `stable-${chat.id}`,
        title: chat.title,
        timestamp: new Date(chat.updatedAt).getTime(),
        archived: chat.archived === "true",
        hidden: chat.hidden === "true",
        pinned: chat.pinned === "true",
        pinnedAt: chat.pinnedAt,
        messages: [] // Don't load messages until active
      }));

      // Return chats sorted by timestamp (no mock data)
      return formattedChats.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error("Error loading chats from server:", error);
      return null;
    }
  }, []);

  const validateChatSync = useCallback(async (
    chatId: string,
    options: { force?: boolean } = {},
  ): Promise<void> => {
    const resolvedChatId = resolveRealChatId(chatId);
    if (!resolvedChatId || isPendingChat(resolvedChatId)) return;

    // Don't validate while actively streaming — a FULL_REFRESH would
    // replace the message array and cause messages to disappear.
    if (activeRuns.has(resolvedChatId)) return;

    const chat = chatsRef.current.find(
      (candidate) =>
        candidate.id === chatId ||
        candidate.id === resolvedChatId ||
        resolveRealChatId(candidate.id) === resolvedChatId,
    );
    if (!chat || chat.messages.length === 0) return;

    const now = Date.now();
    if (!options.force) {
      const lastValidatedAt = lastValidationAtRef.current.get(resolvedChatId) || 0;
      if (now - lastValidatedAt < CHAT_SYNC_VALIDATION_COOLDOWN_MS) {
        return;
      }
    }

    if (validationInFlightRef.current.has(resolvedChatId)) return;

    const persistedMessageIds = collectPersistedMessageIds(chat.messages);
    const params = new URLSearchParams({
      clientMessageCount: String(persistedMessageIds.length),
    });
    if (
      persistedMessageIds.length > 0 &&
      persistedMessageIds.length <= CHAT_SYNC_VALIDATION_MAX_IDS
    ) {
      params.set("clientMessageIds", JSON.stringify(persistedMessageIds));
    }

    lastValidationAtRef.current.set(resolvedChatId, now);
    validationInFlightRef.current.add(resolvedChatId);

    try {
      const res = await apiFetch(`/api/chats/${resolvedChatId}/validate?${params.toString()}`, {
        headers: { ...getAnonUserIdHeader() },
        credentials: "include",
      });

      if (res.status === 404) {
        window.dispatchEvent(new CustomEvent("refresh-chats"));
        return;
      }
      if (!res.ok) return;

      const validation = (await res.json()) as ChatSyncValidationResponse;
      if (validation.valid || validation.syncRecommendation !== "FULL_REFRESH") {
        return;
      }

      console.info("[ChatSync] Reconciliando chat desincronizado", {
        chatId: resolvedChatId,
        difference: validation.difference,
        missingOnClient: validation.missingOnClient.length,
        extraOnClient: validation.extraOnClient.length,
      });

      await fetchChatDetails(resolvedChatId);
    } catch (error) {
      console.warn(`[ChatSync] Failed to validate chat ${resolvedChatId}:`, error);
    } finally {
      validationInFlightRef.current.delete(resolvedChatId);
    }
  }, [fetchChatDetails]);

  const recoverFailedMessageQueue = useCallback(async () => {
    const maybeValidateActiveChat = () => {
      const currentActiveChatId = activeChatIdRef.current;
      if (currentActiveChatId) {
        void validateChatSync(currentActiveChatId, { force: true });
      }
    };

    if (recoveringFailedQueueRef.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    const failedQueue = safeReadFailedQueue();
    if (failedQueue.length === 0) {
      maybeValidateActiveChat();
      return;
    }

    recoveringFailedQueueRef.current = true;
    try {
      console.log(`[FailedQueue] Recovering ${failedQueue.length} failed message save(s)`);

      const setDeliveryByRequestId = (chatId: string, requestId: string, patch: Partial<Message>) => {
        setChats(prev => prev.map(chat => {
          if (chat.id !== chatId) return chat;
          return {
            ...chat,
            messages: chat.messages.map(m => {
              if (m.role !== "user") return m;
              if (m.requestId !== requestId) return m;
              if (patch.deliveryStatus === "sent" && m.deliveryStatus === "delivered") {
                return { ...m, ...patch, deliveryStatus: "delivered" };
              }
              return { ...m, ...patch };
            })
          };
        }));
      };

      const reconcileMessageIdByRequestId = (chatId: string, requestId: string, serverId: string) => {
        setChats(prev => prev.map(chat => {
          if (chat.id !== chatId) return chat;

          let changed = false;
          let tempId: string | null = null;

          let updated = chat.messages.map(m => {
            if (m.role === "user" && m.requestId === requestId) {
              changed = true;
              tempId = m.clientTempId || m.id;
              return {
                ...m,
                id: serverId,
                clientTempId: tempId || m.clientTempId,
                deliveryStatus: m.deliveryStatus === "delivered" ? "delivered" : "sent",
                deliveryError: undefined,
              };
            }
            return m;
          });

          if (!changed || !tempId) return chat;

          updated = updated.map(m => {
            if (m.userMessageId === tempId) {
              return { ...m, userMessageId: serverId };
            }
            return m;
          });

          const hasAssistantReply = updated.some(
            (m) => m.role === "assistant" && m.userMessageId === serverId
          );
          if (hasAssistantReply) {
            updated = updated.map((m) => {
              if (m.role !== "user") return m;
              if (m.requestId !== requestId) return m;
              if (m.deliveryStatus === "error") return m;
              return { ...m, deliveryStatus: "delivered", deliveryError: undefined };
            });
          }

          return { ...chat, messages: dedupeMessagesByIdentity(updated) };
        }));
      };

      const remaining: FailedMessageQueueItem[] = [];
      for (const queued of failedQueue) {
        if (!queued?.chatId || !queued?.requestId) continue;
        if (queued.chatId.startsWith(PENDING_CHAT_PREFIX)) continue;
        if (queued.timestamp && Date.now() - queued.timestamp > MAX_FAILED_QUEUE_AGE_MS) continue;

        // If present in local UI, reflect that we're retrying.
        setDeliveryByRequestId(queued.chatId, queued.requestId, {
          deliveryStatus: "sending",
          deliveryError: undefined,
        });

        try {
          const res = await fetchWithTimeout(`/api/chats/${queued.chatId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getAnonUserIdHeader() },
            credentials: "include",
            body: JSON.stringify({
              role: queued.role,
              content: queued.content,
              requestId: queued.requestId,
              clientRequestId: queued.clientRequestId,
              attachments: queued.attachments,
            }),
          }, MESSAGE_SAVE_TIMEOUT_MS);

          if (res.ok) {
            const data = await res.json().catch(() => null);
            const serverMessage = (data as any)?.message ?? data;
            if (serverMessage?.id && typeof serverMessage.id === "string") {
              reconcileMessageIdByRequestId(queued.chatId, queued.requestId, serverMessage.id);
            } else {
              setDeliveryByRequestId(queued.chatId, queued.requestId, {
                deliveryStatus: "sent",
                deliveryError: undefined,
              });
            }

            markRequestComplete(queued.requestId);
            removeFailedMessageFromRecoveryQueue(queued.requestId);
            continue;
          }

          const errText = await res.text().catch(() => "");
          setDeliveryByRequestId(queued.chatId, queued.requestId, {
            deliveryStatus: "error",
            deliveryError: errText || `HTTP ${res.status}`,
          });

          const retryable =
            res.status >= 500 ||
            res.status === 408 ||
            res.status === 429 ||
            res.status === 401;

          if (retryable) {
            remaining.push(queued); // Retry next time / when network recovers.
          } else {
            console.warn(`[FailedQueue] Skipping message (${res.status}):`, queued.requestId);
          }
        } catch (err) {
          setDeliveryByRequestId(queued.chatId, queued.requestId, {
            deliveryStatus: "error",
            deliveryError: err instanceof Error ? err.message : String(err),
          });
          remaining.push(queued); // Network error, retry next time.
        }
      }

      safeWriteFailedQueue(remaining);
    } catch (e) {
      console.warn("[FailedQueue] Error processing recovery queue:", e);
    } finally {
      recoveringFailedQueueRef.current = false;
      maybeValidateActiveChat();
    }
  }, [validateChatSync]);

  // Fetch details for active chat when selected
  useEffect(() => {
    if (activeChatId && !isPendingChat(activeChatId)) {
      const chat = chatsRef.current.find(c => c.id === activeChatId);
      if (chat) {
        const hasNoMessages = chat.messages.length === 0;
        const hasOnlyUserMessages = chat.messages.length > 0 && !chat.messages.some(m => m.role === 'assistant');
        if (hasNoMessages || hasOnlyUserMessages) {
          fetchChatDetails(activeChatId);
        }
      }
    }
  }, [activeChatId, fetchChatDetails]);

  const activeChatSyncKey = useMemo(() => {
    if (!activeChatId) return "";

    const resolvedChatId = resolveRealChatId(activeChatId);
    if (!resolvedChatId || isPendingChat(activeChatId) || isPendingChat(resolvedChatId)) {
      return "";
    }

    const activeChatCandidate = chats.find(
      (chat) =>
        chat.id === activeChatId ||
        chat.id === resolvedChatId ||
        resolveRealChatId(chat.id) === resolvedChatId,
    );
    if (!activeChatCandidate || activeChatCandidate.messages.length === 0) {
      return "";
    }

    const persistedMessageIds = collectPersistedMessageIds(activeChatCandidate.messages);
    const lastPersistedMessageId = persistedMessageIds[persistedMessageIds.length - 1] || "none";
    return `${resolvedChatId}:${activeChatCandidate.messages.length}:${persistedMessageIds.length}:${lastPersistedMessageId}`;
  }, [activeChatId, chats]);

  useEffect(() => {
    if (isLoading || !activeChatId || !activeChatSyncKey) return;
    const resolvedChatId = resolveRealChatId(activeChatId);
    if (!resolvedChatId) return;
    void validateChatSync(resolvedChatId);
  }, [activeChatId, activeChatSyncKey, isLoading, validateChatSync]);

  useEffect(() => {
    let cancelled = false;
    const initChats = async () => {
      setIsLoading(true);

      // 1) Hydrate from localStorage immediately for instant UI (no blank/skeleton if we have cache).
      const restored = safeReadLocalChatsFromStorage(STORAGE_KEY);
      if (!cancelled && restored.length > 0) {
        setChats(restored);
        if (!userHasSelectedRef.current) {
          setActiveChatId((prev) => prev || restored[0]?.id || null);
        }
        setIsLoading(false);
      }

      // 2) Fetch authoritative server list in background and merge (preserve pending chats + cached messages).
      const serverChats = await loadChatsFromServer();
      if (cancelled) return;

      if (serverChats) {
        const merged = mergeServerChatsWithLocal(serverChats, restored);
        setChats(merged);
        // Only auto-select if user hasn't manually selected/deselected.
        if (!userHasSelectedRef.current) {
          setActiveChatId((prev) => {
            if (prev && merged.some((c) => c.id === prev)) return prev;
            return merged[0]?.id || null;
          });
        }
      }

      // If we had no cache, finish loading once server attempt completes (success or fail).
      if (restored.length === 0) {
        setIsLoading(false);
      }

      void recoverFailedMessageQueue();
    };

    void initChats();
    return () => {
      cancelled = true;
    };
  }, []);

  // Retry failed (queued) message saves when connectivity is restored or the tab becomes active.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOnline = () => {
      if (!isLoading) {
        void recoverFailedMessageQueue();
      }
    };

    const handleVisibilityChange = () => {
      if (!isLoading && document.visibilityState === "visible") {
        void recoverFailedMessageQueue();
      }
    };

    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isLoading, recoverFailedMessageQueue]);

  // Allows other parts of the app (settings/privacy) to request a full server refresh.
  useEffect(() => {
    const handleRefresh = () => {
      // Don't refresh while any chat has an active run — the merge
      // could wipe out messages being built by streaming.
      if (activeRuns.size > 0) {
        console.info("[refresh-chats] Deferred — active runs in progress");
        return;
      }
      void (async () => {
        setIsLoading(true);
        try {
          const serverChats = await loadChatsFromServer();
          if (!serverChats) return;

          setChats((prev) => mergeServerChatsWithLocal(serverChats, prev));

          // If the active chat disappeared (archived/deleted), pick a sane fallback.
          setActiveChatId((prev) => {
            if (prev?.startsWith(PENDING_CHAT_PREFIX)) return prev;
            if (prev && serverChats.some((c) => c.id === prev)) return prev;
            if (!userHasSelectedRef.current) return serverChats[0]?.id || null;
            return prev || null;
          });
        } finally {
          setIsLoading(false);
        }
      })();
    };

    window.addEventListener("refresh-chats", handleRefresh);
    return () => window.removeEventListener("refresh-chats", handleRefresh);
  }, [activeChatId, loadChatsFromServer]);

  // Listen for "refresh-chat-title" events dispatched after streaming completes.
  // The server generates an AI-powered title asynchronously; this fetches it
  // after a short delay and updates the sidebar without a full chat reload.
  useEffect(() => {
    const handleTitleRefresh = (e: Event) => {
      const { chatId, delay = 2000 } = (e as CustomEvent).detail || {};
      if (!chatId) return;

      setTimeout(async () => {
        try {
          const res = await apiFetch(`/api/chats/${chatId}`, {
            headers: { ...getAnonUserIdHeader() },
            credentials: "include",
          });
          if (!res.ok) return;
          const data = await res.json();
          const serverTitle = data.chat?.title || data.title;
          if (serverTitle) {
            setChats(prev => prev.map(c =>
              c.id === chatId ? { ...c, title: serverTitle } : c
            ));
          }
        } catch (err) {
          console.warn("[TitleRefresh] Failed to fetch updated title:", err);
        }
      }, delay);
    };

    window.addEventListener("refresh-chat-title", handleTitleRefresh);
    return () => window.removeEventListener("refresh-chat-title", handleTitleRefresh);
  }, []);
  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;
  const chatsLengthRef = useRef(chats.length);
  chatsLengthRef.current = chats.length;
  useEffect(() => {
    if (!isLoadingRef.current && chatsLengthRef.current > 0) {
      debouncedLocalStorageSave(chats, STORAGE_KEY);
    }
  }, [chats]);

  // Flush pending saves on page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      flushPendingLocalStorageSave(STORAGE_KEY);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Also flush on unmount
      flushPendingLocalStorageSave(STORAGE_KEY);
    };
  }, []);

  const createChat = useCallback((stableKeyOverride?: string | null): { pendingId: string; stableKey: string } => {
    const pendingId = `${PENDING_CHAT_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const provisionalRealId = generateStableServerChatId();
    // Pre-assign a stable server chatId so first-message stream can start immediately.
    pendingToRealIdMap.set(pendingId, provisionalRealId);
    const stableKey =
      typeof stableKeyOverride === "string" && stableKeyOverride.trim().length > 0
        ? stableKeyOverride.trim()
        : generateStableChatKey();
    const pendingChat: Chat = {
      id: pendingId,
      stableKey,
      title: "Nuevo Chat",
      timestamp: Date.now(),
      messages: []
    };
    setChats(prev => [pendingChat, ...prev]);
    setActiveChatId(pendingId);
    return { pendingId, stableKey };
  }, []);

  const addMessage = useCallback(async (chatId: string, message: Message): Promise<SendMessageAck | undefined> => {
    const safeChatId = sanitizeChatId(chatId);
    let resolvedChatId = pendingToRealIdMap.get(safeChatId) || safeChatId;
    const isPending = safeChatId.startsWith(PENDING_CHAT_PREFIX);
    const sanitizedInput = sanitizeSendMessage(message);
    const safeRequestId = sanitizeRequestId(sanitizedInput.requestId);
    const safeClientRequestId = sanitizedInput.role === "user" && !(sanitizedInput as any).skipRun
      ? (sanitizedInput.clientRequestId || generateClientRequestId())
      : sanitizedInput.clientRequestId;

    const normalizedMessage: Message = {
      ...sanitizedInput,
      requestId: safeRequestId,
      clientTempId: sanitizedInput.clientTempId || sanitizedInput.id,
      // Ensure we keep the same clientRequestId on retry to preserve idempotency.
      clientRequestId: safeClientRequestId,
      // Default optimistic delivery state for user messages.
      deliveryStatus: sanitizedInput.deliveryStatus || (sanitizedInput.role === "user" ? "sending" : sanitizedInput.deliveryStatus),
      deliveryError: sanitizedInput.deliveryStatus === "error" ? sanitizedInput.deliveryError : undefined,
    };

    const tempId = normalizedMessage.clientTempId || normalizedMessage.id;

    const setDeliveryPatch = (patch: Partial<Message>) => {
      setChats(prev => prev.map(chat => {
        if (chat.id !== resolvedChatId && chat.id !== safeChatId) return chat;
        return {
          ...chat,
          messages: chat.messages.map(m => {
            if (!messagesShareIdentity(m, normalizedMessage) && m.id !== tempId && m.clientTempId !== tempId) return m;
            const nextStatus =
              patch.deliveryStatus === "sent" && m.deliveryStatus === "delivered"
                ? "delivered"
                : patch.deliveryStatus;
            const patchWithStatus = nextStatus ? { ...patch, deliveryStatus: nextStatus } : patch;
            return { ...m, ...patchWithStatus };
          }),
        };
      }));
    };

    const reconcileMessageId = (serverId: string) => {
      setChats(prev => prev.map(chat => {
        if (chat.id !== resolvedChatId && chat.id !== safeChatId) return chat;

        let changed = false;
        let updated = chat.messages.map(m => {
          if (m.id === tempId || m.clientTempId === tempId || messagesShareIdentity(m, normalizedMessage)) {
            changed = true;
            return {
              ...m,
              id: serverId,
              clientTempId: tempId,
              deliveryStatus: m.deliveryStatus === "delivered" ? "delivered" : "sent",
              deliveryError: undefined,
            };
          }
          if (m.userMessageId === tempId) {
            changed = true;
            return { ...m, userMessageId: serverId };
          }
          return m;
        });

        if (!changed) return chat;

        // If an assistant reply already exists for this user message, mark it as delivered.
        const hasAssistantReply = updated.some(
          (m) => m.role === "assistant" && m.userMessageId === serverId
        );
        if (hasAssistantReply) {
          updated = updated.map((m) => {
            if (m.role !== "user") return m;
            if (m.id !== serverId && m.clientTempId !== tempId) return m;
            if (m.deliveryStatus === "error") return m;
            return { ...m, deliveryStatus: "delivered", deliveryError: undefined };
          });
        }

        return { ...chat, messages: dedupeMessagesByIdentity(updated) };
      }));
    };

    // Idempotency guard: claim the requestId for this send attempt.
    if (safeRequestId && !markRequestProcessing(safeRequestId)) {
      console.log(`[Dedup] Skipping already processed/processing requestId: ${safeRequestId}`);
      const existingRun = getActiveRun(resolvedChatId);
      if (existingRun) {
        return { run: existingRun, deduplicated: true, chatId: resolvedChatId };
      }
      return { chatId: resolvedChatId };
    }

    const title = normalizedMessage.role === "user" && normalizedMessage.content
      ? normalizedMessage.content.slice(0, 50) + (normalizedMessage.content.length > 50 ? "..." : "")
      : "Nuevo Chat";

    if (isPending && resolvedChatId.startsWith(PENDING_CHAT_PREFIX)) {
      const fallbackChatId = generateStableServerChatId();
      pendingToRealIdMap.set(safeChatId, fallbackChatId);
      setChats(prev => prev.map(chat =>
        chat.id === safeChatId ? { ...chat, id: fallbackChatId } : chat
      ));
      if (activeChatId === safeChatId) {
        setActiveChatId(fallbackChatId);
      }
      resolvedChatId = fallbackChatId;
    } else if (isPending && resolvedChatId !== safeChatId) {
      // The pending chat already has a real resolvedChatId (from createChat's
      // provisionalRealId), but the chat entry in state still has the pending
      // id. Rename it now so that:
      //   1. Server sync (mergeServerChatsWithLocal) won't create a duplicate
      //   2. Title refresh and other lookups by real ID will find the entry
      //   3. setActiveChatId(realId) from handleSendNewChatMessage will match
      setChats(prev => {
        // Only rename if the real ID doesn't already exist (avoid duplication)
        const realAlreadyExists = prev.some(c => c.id === resolvedChatId);
        if (realAlreadyExists) return prev;
        return prev.map(chat =>
          chat.id === safeChatId ? { ...chat, id: resolvedChatId } : chat
        );
      });
      if (activeChatId === safeChatId) {
        setActiveChatId(resolvedChatId);
      }
    }

    // Insert into local state (optimistic) if not present.
      setChats(prev => {
        const chatExists = prev.some(chat => chat.id === safeChatId || chat.id === resolvedChatId);

      if (!chatExists && isPending) {
        return [...prev, {
          id: safeChatId,
          title,
          messages: [normalizedMessage],
          timestamp: Date.now(),
          stableKey: `stable-${safeChatId}`,
        }];
      }

        return prev.map(chat => {
          const matchId = chat.id === safeChatId || chat.id === resolvedChatId;
          if (!matchId) return chat;

        const maybeMarkDelivered = (msgs: Message[]): Message[] => {
          if (normalizedMessage.role !== "assistant" || !normalizedMessage.userMessageId) return msgs;
          const linkId = normalizedMessage.userMessageId;
          let changed = false;
          const patched = msgs.map((m) => {
            if (m.role !== "user") return m;
            if (m.id !== linkId && m.clientTempId !== linkId) return m;
            if (m.deliveryStatus === "error") return m;
            if (m.deliveryStatus === "delivered") return m;
            changed = true;
            return { ...m, deliveryStatus: "delivered", deliveryError: undefined };
          });
          return changed ? patched : msgs;
        };

        const messageExists = chat.messages.some((m) => messagesShareIdentity(m, normalizedMessage));
        if (messageExists) {
          // Retry path: do not mark as complete here. The server ACK is the source of truth.
          const nextMessages = maybeMarkDelivered(dedupeMessagesByIdentity(
            chat.messages.map((m) => messagesShareIdentity(m, normalizedMessage)
              ? {
                ...m,
                ...normalizedMessage,
                deliveryStatus: normalizedMessage.deliveryStatus,
                deliveryError: normalizedMessage.deliveryError,
              }
              : m
            )
          ));
          return {
            ...chat,
            messages: nextMessages,
          };
        }

        const isFirstMessage = chat.messages.length === 0;
        const nextMessages = maybeMarkDelivered(dedupeMessagesByIdentity([...chat.messages, normalizedMessage]));
        return {
          ...chat,
          messages: nextMessages,
          title: isFirstMessage && normalizedMessage.role === "user" ? title : chat.title,
          timestamp: Date.now(),
        };
      });
    });

    try {
      if ((normalizedMessage as any).serverPersisted && normalizedMessage.role === "assistant") {
        console.log(`[Dedup] Skipping POST for server-persisted assistant message ${normalizedMessage.id}`);
        setDeliveryPatch({ deliveryStatus: "delivered", deliveryError: undefined });
        if (safeRequestId) markRequestComplete(safeRequestId);
        return { chatId: resolvedChatId };
      }

      if (normalizedMessage.role === "user") {
        setDeliveryPatch({ deliveryStatus: "sending", deliveryError: undefined });
      }

      const clientRequestId = normalizedMessage.role === "user" && !(normalizedMessage as any).skipRun
        ? normalizedMessage.clientRequestId
        : undefined;

      const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();

      const res = await withRetry(async () => {
        const response = await fetchWithTimeout(`/api/chats/${resolvedChatId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAnonUserIdHeader() },
          credentials: "include",
          body: JSON.stringify({
            role: normalizedMessage.role,
            content: normalizedMessage.content,
            requestId: normalizedMessage.requestId,
            clientRequestId,
            userMessageId: normalizedMessage.userMessageId,
            attachments: sanitizeAttachmentsForServer(normalizedMessage.attachments),
            sources: normalizedMessage.sources,
            artifact: normalizedMessage.artifact,
            artifacts: normalizedMessage.artifacts,
            figmaDiagram: normalizedMessage.figmaDiagram,
            googleFormPreview: normalizedMessage.googleFormPreview,
            gmailPreview: normalizedMessage.gmailPreview,
            generatedImage: normalizedMessage.generatedImage,
            webSources: normalizedMessage.webSources,
            searchQueries: normalizedMessage.searchQueries,
            totalSearches: normalizedMessage.totalSearches,
            followUpSuggestions: normalizedMessage.followUpSuggestions,
            confidence: normalizedMessage.confidence,
            uncertaintyReason: normalizedMessage.uncertaintyReason,
            retrievalSteps: normalizedMessage.retrievalSteps,
            // Prompt integrity metadata
            clientPromptLen: (normalizedMessage as any).clientPromptLen,
            clientPromptHash: (normalizedMessage as any).clientPromptHash,
            promptMessageId: (normalizedMessage as any).promptMessageId,
          }),
        }, MESSAGE_SAVE_TIMEOUT_MS);
        // Retry on network failures and 5xx server errors; don't retry 4xx client errors.
        if (!response.ok && response.status >= 500) {
          throw new Error(`Server error ${response.status}`);
        }
        return response;
      }, { maxRetries: 2 });

      const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
      const totalMs = Math.max(0, t1 - t0);
      if (import.meta.env.DEV) {
        const serverTiming = res.headers.get("server-timing");
        const traceId = res.headers.get("x-trace-id");
        console.debug("[Perf] send_message", {
          chatId: resolvedChatId,
          tempId,
          role: normalizedMessage.role,
          totalMs: Number(totalMs.toFixed(1)),
          serverTiming,
          traceId,
        });
      }

      if (res.ok) {
        const data = await res.json();
        trackChatMessageSent(resolvedChatId, normalizedMessage, data?.deduplicated);

        const serverMessage = data?.message ?? data;
        if (serverMessage?.id && typeof serverMessage.id === "string") {
          reconcileMessageId(serverMessage.id);
        } else if (normalizedMessage.role === "user") {
          setDeliveryPatch({ deliveryStatus: "sent", deliveryError: undefined });
        }

        if (normalizedMessage.requestId) {
          markRequestComplete(normalizedMessage.requestId);
          removeFailedMessageFromRecoveryQueue(normalizedMessage.requestId);
        }

        if (data.run) {
          const run: ChatRun = {
            id: data.run.id,
            chatId: resolvedChatId,
            clientRequestId: data.run.clientRequestId,
            userMessageId: data.run.userMessageId,
            status: data.run.status,
            assistantMessageId: data.run.assistantMessageId,
            lastSeq: data.run.lastSeq,
          };
          setActiveRun(resolvedChatId, run);
          console.log(`[Run] ${data.deduplicated ? "Resumed" : "Created"} run ${run.id} for chat ${resolvedChatId}`);
          return { run, deduplicated: !!data.deduplicated, chatId: resolvedChatId };
        }

        return { chatId: resolvedChatId };
      }

      const errText = await res.text().catch(() => "");
      console.error(`Server returned ${res.status} for message save`, errText);

      if (normalizedMessage.role === "user") {
        setDeliveryPatch({
          deliveryStatus: "error",
          deliveryError: errText || `HTTP ${res.status}`,
        });
      }

      if (normalizedMessage.requestId) {
        processingRequestIds.delete(normalizedMessage.requestId);
      }

      const retryable =
        res.status === 408 ||
        res.status === 429 ||
        res.status === 401;
      if (retryable && normalizedMessage.role === "user") {
        enqueueFailedMessageForRecovery(resolvedChatId, normalizedMessage);
      }
      return { chatId: resolvedChatId };
    } catch (error) {
      console.error("Error saving message to server:", error);

      if (normalizedMessage.role === "user") {
        setDeliveryPatch({
          deliveryStatus: "error",
          deliveryError: error instanceof Error ? error.message : String(error),
        });
      }

      // Remove from processing on error so retry is possible.
      if (normalizedMessage.requestId) {
        processingRequestIds.delete(normalizedMessage.requestId);
      }

      // Queue failed message save for later recovery.
      if (normalizedMessage.role === "user") {
        enqueueFailedMessageForRecovery(resolvedChatId, normalizedMessage);
      }

      return { chatId: resolvedChatId };
    }
  }, []);

  const deleteChat = useCallback(async (chatId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();

    setChats(prev => {
      const newChats = prev.filter(c => c.id !== chatId);
      if (activeChatId === chatId) {
        setActiveChatId(newChats[0]?.id || null);
      }
      return newChats;
    });

    try {
      await apiFetch(`/api/chats/${chatId}`, {
        method: "DELETE",
        headers: { ...getAnonUserIdHeader() },
        credentials: "include"
      });
    } catch (error) {
      console.error("Error deleting chat from server:", error);
    }
  }, [activeChatId]);

  const editChatTitle = useCallback(async (chatId: string, newTitle: string) => {
    setChats(prev => prev.map(chat =>
      chat.id === chatId ? { ...chat, title: newTitle } : chat
    ));

    try {
      await apiFetch(`/api/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAnonUserIdHeader() },
        credentials: "include",
        body: JSON.stringify({ title: newTitle })
      });
    } catch (error) {
      console.error("Error updating chat title:", error);
    }
  }, []);

  const archiveChat = useCallback(async (chatId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();

    const chat = chats.find(c => c.id === chatId);
    const newArchived = !chat?.archived;

    // Archived chats are removed from the main list and managed via Settings > Historial.
    setChats(prev => {
      if (newArchived) {
        return prev.filter(c => c.id !== chatId);
      }
      return prev.map(c => (c.id === chatId ? { ...c, archived: newArchived } : c));
    });

    try {
      await apiFetch(`/api/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAnonUserIdHeader() },
        credentials: "include",
        body: JSON.stringify({ archived: newArchived })
      });
      window.dispatchEvent(new CustomEvent("refresh-chats"));
    } catch (error) {
      console.error("Error archiving chat:", error);
    }
  }, [chats]);

  const hideChat = useCallback(async (chatId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();

    const chat = chats.find(c => c.id === chatId);
    const newHidden = !chat?.hidden;

    setChats(prev => prev.map(c =>
      c.id === chatId ? { ...c, hidden: newHidden } : c
    ));

    try {
      await apiFetch(`/api/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAnonUserIdHeader() },
        credentials: "include",
        body: JSON.stringify({ hidden: newHidden })
      });
    } catch (error) {
      console.error("Error hiding chat:", error);
    }
  }, [chats]);

  const pinChat = useCallback(async (chatId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();

    const chat = chats.find(c => c.id === chatId);
    const newPinned = !chat?.pinned;
    const pinnedAt = newPinned ? new Date().toISOString() : undefined;

    setChats(prev => prev.map(c =>
      c.id === chatId ? { ...c, pinned: newPinned, pinnedAt } : c
    ));

    try {
      await apiFetch(`/api/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAnonUserIdHeader() },
        credentials: "include",
        body: JSON.stringify({ pinned: newPinned, pinnedAt })
      });
    } catch (error) {
      console.error("Error pinning chat:", error);
    }
  }, [chats]);

  const downloadChat = useCallback(async (chatId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();

    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;

    // Export chat with all messages in a readable format
    const exportData = {
      title: chat.title,
      exportedAt: new Date().toISOString(),
      messageCount: chat.messages.length,
      messages: chat.messages.map(msg => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        attachments: msg.attachments?.map(a => ({ name: a.name, type: a.type }))
      }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${chat.title.replace(/[^a-z0-9]/gi, '_')}_chat.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [chats]);

  const updateMessageAttachments = useCallback((chatId: string, messageId: string, attachments: Message['attachments'], newMessage?: Message) => {
    setChats(prev => prev.map(chat => {
      if (chat.id === chatId) {
        const messageExists = chat.messages.some(msg => msg.id === messageId);
        if (messageExists) {
          return {
            ...chat,
            messages: chat.messages.map(msg =>
              msg.id === messageId ? { ...msg, attachments } : msg
            )
          };
        } else if (newMessage) {
          return {
            ...chat,
            messages: [...chat.messages, newMessage]
          };
        }
      }
      return chat;
    }));
  }, []);

  const editMessageAndTruncate = useCallback((chatId: string, messageId: string, newContent: string, messageIndex: number) => {
    setChats(prev => prev.map(chat => {
      if (chat.id === chatId) {
        const truncatedMessages = chat.messages.slice(0, messageIndex);
        const editedMessage = { ...chat.messages[messageIndex], content: newContent, timestamp: new Date() };
        return {
          ...chat,
          messages: [...truncatedMessages, editedMessage],
          timestamp: Date.now()
        };
      }
      return chat;
    }));
  }, []);

  const truncateAndReplaceMessage = useCallback((chatId: string, messageIndex: number, newMessage: Message) => {
    setChats(prev => prev.map(chat => {
      if (chat.id === chatId) {
        const truncatedMessages = chat.messages.slice(0, messageIndex);
        return {
          ...chat,
          messages: [...truncatedMessages, newMessage],
          timestamp: Date.now()
        };
      }
      return chat;
    }));
  }, []);

  const truncateMessagesAt = useCallback((chatId: string, messageIndex: number) => {
    setChats(prev => prev.map(chat => {
      if (chat.id === chatId) {
        return {
          ...chat,
          messages: chat.messages.slice(0, messageIndex),
          timestamp: Date.now()
        };
      }
      return chat;
    }));
  }, []);

  // Look up the active chat by id. If the activeChatId is a resolved real id (e.g. "chat_uuid")
  // but the chat still has a pending id, also check the pendingToRealIdMap reverse mapping.
  const activeChat = useMemo(() => {
    if (!activeChatId) return null;
    const direct = chats.find(c => c.id === activeChatId);
    if (direct) return direct;
    // Reverse lookup: find pending chat whose resolved id matches activeChatId
    for (const [pendingId, realId] of pendingToRealIdMap.entries()) {
      if (realId === activeChatId) {
        const pending = chats.find(c => c.id === pendingId);
        if (pending) return pending;
      }
    }
    return null;
  }, [activeChatId, chats]);
  const sortedChats = useMemo(() => [...chats].sort((a, b) => b.timestamp - a.timestamp), [chats]);
  const visibleChats = useMemo(() => sortedChats.filter(c => !c.hidden), [sortedChats]);
  const archivedChats = useMemo(() => sortedChats.filter(c => c.archived && !c.hidden), [sortedChats]);
  const hiddenChats = useMemo(() => sortedChats.filter(c => c.hidden), [sortedChats]);
  const pinnedChats = useMemo(() => sortedChats.filter(c => c.pinned && !c.hidden).sort((a, b) => {
    const aDate = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
    const bDate = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;
    return bDate - aDate;
  }), [sortedChats]);

  const getChatDateLabel = (timestamp: number) => {
    const date = new Date(timestamp);
    if (isToday(date)) return "Today";
    if (isYesterday(date)) return "Yesterday";
    if (isThisWeek(date)) return "Previous 7 Days";
    if (isThisYear(date)) return format(date, "MMM d");
    return format(date, "yyyy");
  };

  return {
    chats: visibleChats,
    allChats: sortedChats,
    archivedChats,
    hiddenChats,
    pinnedChats,
    activeChatId,
    activeChat,
    isLoading,
    setActiveChatId: setActiveChatIdWithTracking,
    createChat,
    addMessage,
    deleteChat,
    editChatTitle,
    archiveChat,
    hideChat,
    pinChat,
    downloadChat,
    updateMessageAttachments,
    editMessageAndTruncate,
    truncateAndReplaceMessage,
    truncateMessagesAt,
    getChatDateLabel
  };
}
