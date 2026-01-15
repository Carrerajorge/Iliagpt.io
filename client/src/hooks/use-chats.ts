import { useState, useEffect, useCallback, useRef } from "react";
import { format, isToday, isYesterday, isThisWeek, isThisYear } from "date-fns";
import { useConversationStreamRouter } from "@/stores/conversationStreamRouter";
import { migrateStreamContextConversationId } from "@/lib/streamEventAdapter";

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
}

export interface AgentRunData {
  runId: string | null;
  status: "starting" | "running" | "completed" | "failed" | "cancelled";
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
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  requestId?: string; // Unique ID for idempotency - prevents duplicate processing
  clientRequestId?: string; // For run-based idempotency - creates atomic user message + run
  userMessageId?: string; // For assistant messages: links to the user message it responds to
  runId?: string; // ID of the run this message belongs to
  status?: 'pending' | 'processing' | 'done' | 'failed'; // Processing status for idempotency
  isThinking?: boolean;
  steps?: { title: string; status: "pending" | "loading" | "complete" }[];
  attachments?: { type: "word" | "excel" | "ppt" | "image" | "pdf" | "text" | "code" | "archive" | "document" | "unknown"; name: string; mimeType?: string; imageUrl?: string; storagePath?: string; fileId?: string; documentType?: "word" | "excel" | "ppt"; content?: string; title?: string; savedAt?: string; spreadsheetData?: { uploadId: string; sheets: Array<{ name: string; rowCount: number; columnCount: number }>; previewData?: { headers: string[]; data: any[][] }; analysisId?: string; sessionId?: string } }[];
  sources?: { fileName: string; content: string }[];
  figmaDiagram?: FigmaDiagram;
  generatedImage?: string;
  googleFormPreview?: GoogleFormPreview;
  gmailPreview?: GmailPreview;
  agentRun?: AgentRunData;
  artifact?: MessageArtifact; // Generated artifact from ProductionWorkflowRunner
  webSources?: WebSource[]; // Web search sources for citations
  documentAnalysis?: {
    documentModel: any; // DocumentSemanticModel
    insights: any[];
    suggestedQuestions: any[];
  };
  ui_components?: string[]; // Components to render: 'executive_summary', 'suggested_questions', 'insights_panel'
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
const pendingToRealIdMap = new Map<string, string>();
const pendingMessageQueue = new Map<string, Message[]>();
const chatCreationInProgress = new Set<string>();

// Idempotency: Track messages being processed to prevent duplicates
const processingRequestIds = new Set<string>();
const savedRequestIds = new Set<string>();

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
const activeRuns = new Map<string, ChatRun>(); // chatId -> active run

// Generate a unique request ID for idempotency
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
  return `cri_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Retry with exponential backoff for message persistence
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;

async function fetchWithRetry(
  url: string, 
  options: RequestInit, 
  retries: number = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      // Success or client error (don't retry 4xx except 429)
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
        return response;
      }
      
      // Server error or rate limited - retry with backoff
      if (response.status >= 500 || response.status === 429) {
        const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(`[Persistence] Retry ${attempt + 1}/${retries} after ${backoffMs}ms (status: ${response.status})`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }
      
      return response;
    } catch (error) {
      lastError = error as Error;
      const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      console.error(`[Persistence] Network error, retry ${attempt + 1}/${retries} after ${backoffMs}ms:`, error);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }
  
  // All retries exhausted
  throw lastError || new Error(`Failed after ${retries} retries`);
}

// Resolve pending chat ID to real ID if available
export function resolveRealChatId(chatId: string): string {
  return pendingToRealIdMap.get(chatId) || chatId;
}

// Check if a chat ID is pending (not yet created on server)
export function isPendingChat(chatId: string): boolean {
  const resolved = resolveRealChatId(chatId);
  return resolved.startsWith(PENDING_CHAT_PREFIX);
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
  savedRequestIds.add(requestId);
  // No TTL - requestIds stay in savedRequestIds for the session to ensure idempotency
  // Memory is managed by page reload which clears and re-hydrates from server
}

// Mark a request as persisted (hydrated from server/localStorage - no TTL)
export function markRequestPersisted(requestId: string): void {
  savedRequestIds.add(requestId);
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
  
  // Wrapper that tracks user selection intent
  const setActiveChatIdWithTracking = useCallback((id: string | null) => {
    userHasSelectedRef.current = true;
    setActiveChatId(id);
  }, []);

  const loadChatsFromServer = useCallback(async () => {
    try {
      const res = await fetch("/api/chats");
      if (!res.ok) throw new Error("Failed to load chats");
      const serverChats = await res.json();
      
      const formattedChats: Chat[] = await Promise.all(
        serverChats.map(async (chat: any) => {
          const chatRes = await fetch(`/api/chats/${chat.id}`);
          const fullChat = await chatRes.json();
          return {
            id: chat.id,
            stableKey: `stable-${chat.id}`, // Use ID as stable key for server chats
            title: chat.title,
            timestamp: new Date(chat.updatedAt).getTime(),
            archived: chat.archived === "true",
            hidden: chat.hidden === "true",
            pinned: chat.pinned === "true",
            pinnedAt: chat.pinnedAt,
            messages: (fullChat.messages || []).map((msg: any) => {
              // Hydrate savedRequestIds from server data
              if (msg.requestId) {
                markRequestPersisted(msg.requestId);
              }
              return {
                id: msg.id,
                role: msg.role,
                content: msg.content,
                timestamp: new Date(msg.createdAt),
                requestId: msg.requestId,
                userMessageId: msg.userMessageId,
                attachments: msg.attachments,
                sources: msg.sources,
                figmaDiagram: msg.figmaDiagram,
                googleFormPreview: msg.googleFormPreview,
                gmailPreview: msg.gmailPreview,
                generatedImage: msg.generatedImage,
                webSources: msg.webSources,
              };
            }),
          };
        })
      );
      
      return formattedChats.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error("Error loading chats from server:", error);
      return null;
    }
  }, []);

  useEffect(() => {
    const initChats = async () => {
      setIsLoading(true);
      
      const serverChats = await loadChatsFromServer();
      
      if (serverChats && serverChats.length > 0) {
        setChats(serverChats);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(serverChats));
        } catch (e) {
          console.warn("Failed to cache chats to localStorage:", e);
          localStorage.removeItem(STORAGE_KEY);
        }
        // Only auto-select first chat if user hasn't manually selected/deselected
        if (!userHasSelectedRef.current && !activeChatId) {
          setActiveChatId(serverChats[0]?.id || null);
        }
      } else {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            const restored = parsed.map((chat: any) => ({
              ...chat,
              stableKey: chat.stableKey || `stable-${chat.id}`, // Ensure stableKey exists
              messages: chat.messages.map((msg: any) => {
                // Hydrate savedRequestIds from localStorage data
                if (msg.requestId) {
                  markRequestPersisted(msg.requestId);
                }
                return {
                  ...msg,
                  timestamp: new Date(msg.timestamp)
                };
              })
            }));
            
            // CRITICAL FIX: Reconcile pending chats that were never synced to server
            // This happens when user creates a chat, sends a message, but the server sync fails
            const pendingChats = restored.filter((c: Chat) => c.id.startsWith(PENDING_CHAT_PREFIX) && c.messages.length > 0);
            if (pendingChats.length > 0) {
              console.log(`[Reconcile] Found ${pendingChats.length} pending chats to sync`);
              
              // Reconcile each pending chat asynchronously but sequentially to avoid session conflicts
              (async () => {
                for (const pendingChat of pendingChats) {
                  try {
                    // Get first user message for title
                    const firstUserMsg = pendingChat.messages.find((m: Message) => m.role === 'user');
                    const title = firstUserMsg?.content?.slice(0, 30) + (firstUserMsg?.content && firstUserMsg.content.length > 30 ? '...' : '') || 'Nuevo Chat';
                    
                    // Create chat with all messages in a single atomic request
                    const messagesToSync = pendingChat.messages.map(msg => ({
                      role: msg.role,
                      content: msg.content,
                      requestId: msg.requestId,
                      userMessageId: msg.userMessageId,
                      attachments: msg.attachments
                    }));
                    
                    const res = await fetch("/api/chats", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ title, messages: messagesToSync })
                    });
                    
                    if (res.ok) {
                      const serverChat = await res.json();
                      const realChatId = serverChat.id;
                      const wasAlreadyExisting = serverChat.alreadyExists;
                      
                      console.log(`[Reconcile] ${wasAlreadyExisting ? 'Found existing' : 'Created'} server chat ${realChatId} for pending ${pendingChat.id} with ${messagesToSync.length} messages`);
                      
                      // Map pending ID to real ID
                      pendingToRealIdMap.set(pendingChat.id, realChatId);
                      
                      // Migrate streaming runs and badges from pending ID to real ID
                      useConversationStreamRouter.getState().migrateConversationId(pendingChat.id, realChatId);
                      // Also migrate stream context in the event adapter
                      migrateStreamContextConversationId(pendingChat.id, realChatId);
                      
                      // Update chat ID in state
                      setChats(prev => prev.map(c => 
                        c.id === pendingChat.id ? { ...c, id: realChatId } : c
                      ));
                      
                      // Update active chat ID if it was the pending one
                      setActiveChatId(prev => prev === pendingChat.id ? realChatId : prev);
                      
                      // Remove pending chat from localStorage after successful sync
                      const stored = localStorage.getItem(STORAGE_KEY);
                      if (stored) {
                        try {
                          const storedChats = JSON.parse(stored);
                          const updatedStoredChats = storedChats.filter((c: Chat) => c.id !== pendingChat.id);
                          localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedStoredChats));
                        } catch (e) {
                          // Ignore localStorage errors
                        }
                      }
                      
                      console.log(`[Reconcile] Successfully synced pending chat to ${realChatId}`);
                    } else {
                      console.warn(`[Reconcile] Failed to create chat on server:`, await res.text());
                    }
                  } catch (err) {
                    console.error(`[Reconcile] Error reconciling pending chat ${pendingChat.id}:`, err);
                  }
                }
              })();
            }
            
            setChats(restored);
            // Only auto-select first chat if user hasn't manually selected/deselected
            if (!userHasSelectedRef.current && !activeChatId && restored.length > 0) {
              setActiveChatId(restored[0]?.id || null);
            }
          } catch (e) {
            console.error("Failed to parse local chats", e);
          }
        }
      }
      
      setIsLoading(false);
    };
    
    initChats();
  }, []);

  useEffect(() => {
    if (!isLoading && chats.length > 0) {
      // Strip sources from messages to save localStorage space
      const chatsForStorage = chats.map(chat => ({
        ...chat,
        messages: chat.messages.map(msg => ({
          ...msg,
          sources: undefined, // Don't store sources in localStorage - they take too much space
          generatedImage: undefined // Don't store generated images in localStorage - they're too large
        }))
      }));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(chatsForStorage));
      } catch (e) {
        console.warn("Failed to save chats to localStorage:", e);
        // If storage is full, clear old data and try again
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, [chats, isLoading]);

  const createChat = useCallback((): { pendingId: string; stableKey: string } => {
    const pendingId = `${PENDING_CHAT_PREFIX}${Date.now()}`;
    const stableKey = `stable-${Date.now()}`; // Stable key that won't change
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

  const flushPendingMessages = async (pendingId: string, realChatId: string) => {
    while (pendingMessageQueue.has(pendingId) && pendingMessageQueue.get(pendingId)!.length > 0) {
      const queuedMessages = [...(pendingMessageQueue.get(pendingId) || [])];
      pendingMessageQueue.set(pendingId, []);
      
      for (const msg of queuedMessages) {
        try {
          const res = await fetch(`/api/chats/${realChatId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              role: msg.role,
              content: msg.content,
              requestId: msg.requestId,
              userMessageId: msg.userMessageId,
              attachments: msg.attachments,
              sources: msg.sources,
              figmaDiagram: msg.figmaDiagram,
              googleFormPreview: msg.googleFormPreview,
              gmailPreview: msg.gmailPreview,
              generatedImage: msg.generatedImage
            })
          });
          
          // Mark request as complete on successful save or 409 conflict (already exists)
          if (msg.requestId) {
            if (res.ok || res.status === 409) {
              markRequestComplete(msg.requestId);
            } else {
              processingRequestIds.delete(msg.requestId);
            }
          }
        } catch (error) {
          console.error("Error flushing queued message:", error);
          // Remove from processing on error so retry is possible
          if (msg.requestId) {
            processingRequestIds.delete(msg.requestId);
          }
        }
      }
    }
    pendingMessageQueue.delete(pendingId);
  };

  const addMessage = useCallback(async (chatId: string, message: Message): Promise<{ run?: ChatRun; deduplicated?: boolean } | undefined> => {
    const resolvedChatId = pendingToRealIdMap.get(chatId) || chatId;
    const isPending = resolvedChatId.startsWith(PENDING_CHAT_PREFIX);
    const isCreatingChat = chatCreationInProgress.has(chatId) || chatCreationInProgress.has(resolvedChatId);
    
    // Idempotency guard: Use markRequestProcessing to claim the requestId
    // Returns false if already processing or saved - skip duplicate calls
    if (message.requestId && !markRequestProcessing(message.requestId)) {
      console.log(`[Dedup] Skipping already processed/processing requestId: ${message.requestId}`);
      // Check if there's an existing active run for this chat that can be returned
      const existingRun = getActiveRun(resolvedChatId);
      if (existingRun) {
        return { run: existingRun, deduplicated: true };
      }
      return undefined;
    }
    
    const title = message.role === "user" && message.content
      ? message.content.slice(0, 30) + (message.content.length > 30 ? "..." : "")
      : "Nuevo Chat";

    // Track whether message was actually added (for requestId cleanup)
    let messageAdded = false;
    
    // Check if message already exists in chat (by ID) and add if not
    setChats(prev => prev.map(chat => {
      const matchId = chat.id === chatId || chat.id === resolvedChatId;
      if (matchId) {
        // Prevent duplicate message by checking if same ID exists
        const messageExists = chat.messages.some(m => m.id === message.id);
        if (messageExists) {
          console.log(`[Dedup] Message with same ID already exists: ${message.id}`);
          // Mark as complete (not just delete from processing) to prevent future re-claims
          if (message.requestId) {
            markRequestComplete(message.requestId);
          }
          return chat;
        }
        
        messageAdded = true;
        const isFirstMessage = chat.messages.length === 0;
        return {
          ...chat,
          messages: [...chat.messages, message],
          title: isFirstMessage && message.role === "user" ? title : chat.title,
          timestamp: Date.now()
        };
      }
      return chat;
    }));
    
    // If message wasn't added (duplicate), don't proceed with persistence
    if (!messageAdded) {
      // Return existing run if available
      const existingRun = getActiveRun(resolvedChatId);
      if (existingRun) {
        return { run: existingRun, deduplicated: true };
      }
      return undefined;
    }

    if (isPending && message.role === "user" && !isCreatingChat) {
      chatCreationInProgress.add(chatId);
      const queue = pendingMessageQueue.get(chatId) || [];
      queue.push(message);
      pendingMessageQueue.set(chatId, queue);
      
      try {
        const res = await fetch("/api/chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title })
        });
        
        if (res.ok) {
          const newChat = await res.json();
          const realChatId = newChat.id;
          
          pendingToRealIdMap.set(chatId, realChatId);
          
          setChats(prev => prev.map(chat => {
            if (chat.id === chatId) {
              return { ...chat, id: realChatId };
            }
            return chat;
          }));
          setActiveChatId(realChatId);

          await flushPendingMessages(chatId, realChatId);
        } else {
          // Server creation failed - keep messages in local-only mode (visible in UI)
          // Mark requestIds as complete to prevent re-processing but keep messages visible
          const queuedMsgs = pendingMessageQueue.get(chatId) || [];
          queuedMsgs.forEach(msg => {
            if (msg.requestId) markRequestComplete(msg.requestId);
          });
          pendingMessageQueue.delete(chatId);
          console.warn("Chat creation failed, operating in local-only mode");
        }
      } catch (error) {
        console.error("Error creating chat on first message:", error);
        // Keep messages in local-only mode on error
        const queuedMsgs = pendingMessageQueue.get(chatId) || [];
        queuedMsgs.forEach(msg => {
          if (msg.requestId) markRequestComplete(msg.requestId);
        });
        pendingMessageQueue.delete(chatId);
      } finally {
        chatCreationInProgress.delete(chatId);
      }
    } else if (isPending || isCreatingChat) {
      const queueKey = chatCreationInProgress.has(chatId) ? chatId : resolvedChatId;
      const queue = pendingMessageQueue.get(queueKey) || [];
      queue.push(message);
      pendingMessageQueue.set(queueKey, queue);
    } else {
      try {
        // For user messages, use run-based idempotency with clientRequestId
        const clientRequestId = message.role === 'user' ? (message as any).clientRequestId || generateClientRequestId() : undefined;
        
        // Use fetchWithRetry for automatic retry with exponential backoff
        const res = await fetchWithRetry(`/api/chats/${resolvedChatId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role: message.role,
            content: message.content,
            requestId: message.requestId,
            clientRequestId, // For run-based idempotency
            userMessageId: message.userMessageId,
            attachments: message.attachments,
            sources: message.sources,
            figmaDiagram: message.figmaDiagram,
            googleFormPreview: message.googleFormPreview,
            gmailPreview: message.gmailPreview,
            generatedImage: message.generatedImage
          })
        });
        
        // Handle run-based response for user messages
        if (res.ok) {
          const data = await res.json();
          
          // If response includes a run, track it for AI streaming
          if (data.run) {
            const run: ChatRun = {
              id: data.run.id,
              chatId: resolvedChatId,
              clientRequestId: data.run.clientRequestId,
              userMessageId: data.run.userMessageId,
              status: data.run.status,
              assistantMessageId: data.run.assistantMessageId,
              lastSeq: data.run.lastSeq
            };
            setActiveRun(resolvedChatId, run);
            console.log(`[Run] ${data.deduplicated ? 'Resumed' : 'Created'} run ${run.id} for chat ${resolvedChatId}`);
            
            if (message.requestId) {
              markRequestComplete(message.requestId);
            }
            
            return { run, deduplicated: !!data.deduplicated };
          }
          
          if (message.requestId) {
            markRequestComplete(message.requestId);
          }
          return undefined;
        } else if (res.status === 409) {
          // Already exists - mark as complete
          if (message.requestId) {
            markRequestComplete(message.requestId);
          }
          // Check for existing run
          const existingRun = getActiveRun(resolvedChatId);
          if (existingRun) {
            return { run: existingRun, deduplicated: true };
          }
          return undefined;
        } else {
          // Other non-OK responses: Remove from processing so retry is possible
          console.error(`Server returned ${res.status} for message save`);
          if (message.requestId) {
            processingRequestIds.delete(message.requestId);
          }
          return undefined;
        }
      } catch (error) {
        console.error("Error saving message to server:", error);
        // Remove from processing on error so retry is possible
        if (message.requestId) {
          processingRequestIds.delete(message.requestId);
        }
        return undefined;
      }
    }
    return undefined;
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
      await fetch(`/api/chats/${chatId}`, { method: "DELETE" });
    } catch (error) {
      console.error("Error deleting chat from server:", error);
    }
  }, [activeChatId]);

  const editChatTitle = useCallback(async (chatId: string, newTitle: string) => {
    setChats(prev => prev.map(chat => 
      chat.id === chatId ? { ...chat, title: newTitle } : chat
    ));

    try {
      await fetch(`/api/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
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
    
    setChats(prev => prev.map(c => 
      c.id === chatId ? { ...c, archived: newArchived } : c
    ));

    try {
      await fetch(`/api/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: newArchived })
      });
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
      await fetch(`/api/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
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
      await fetch(`/api/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
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

  const activeChat = chats.find(c => c.id === activeChatId) || null;
  const sortedChats = [...chats].sort((a, b) => b.timestamp - a.timestamp);
  const visibleChats = sortedChats.filter(c => !c.hidden);
  const archivedChats = sortedChats.filter(c => c.archived && !c.hidden);
  const hiddenChats = sortedChats.filter(c => c.hidden);
  const pinnedChats = sortedChats.filter(c => c.pinned && !c.hidden).sort((a, b) => {
    // Sort pinned chats by pinnedAt date (newest first)
    const aDate = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
    const bDate = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;
    return bDate - aDate;
  });

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
