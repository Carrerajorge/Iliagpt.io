import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { SkeletonChatMessages } from "@/components/skeletons";
import { useDraft } from "@/hooks/use-draft";
import { useStreamingTransition } from "@/hooks/use-streaming-transition";
import { useStreamChat } from "@/hooks/use-stream-chat";
import { apiFetch, getAnonUserIdHeader } from "@/lib/apiClient";
import { getFileUploader } from "@/lib/fileUploader";

import { WelcomeAnimation } from "@/components/welcome-animation-simple";
import { WelcomeExplosion, useFirstVisit } from "@/components/welcome-explosion";
import {
  Plus,
  ArrowUp,
  Mic,
  MicOff,
  ChevronDown,
  ChevronRight,
  Globe,
  FileText,
  FileSpreadsheet,
  FileIcon,
  Check,
  CheckCircle2,
  Loader2,
  MoreHorizontal,
  PanelLeftOpen,
  X,
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  Maximize2,
  Minimize2,
  Copy,
  Pencil,
  Send,
  ThumbsUp,
  ThumbsDown,
  Share2,
  Volume2,
  VolumeX,
  Flag,
  MessageSquare,
  Square,
  Download,
  GripVertical,
  Pause,
  Play,
  Trash2,
  Circle,
  Info,
  EyeOff,
  Eye,
  Pin,
  Link,
  Star,
  Settings,
  Archive,
  Folder,
  FolderPlus
} from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { chatLogger } from "@/lib/logger";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuPortal, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Upload, Search, Image, Video, Bot, Plug } from "lucide-react";
import { motion } from "framer-motion";

import { ActiveGpt } from "@/types/chat";
import {
  Message,
  SendMessageAck,
  FigmaDiagram,
  storeGeneratedImage,
  getGeneratedImage,
  getLastGeneratedImage,
  storeLastGeneratedImageInfo,
  generateRequestId,
  generateClientRequestId,
  generateRunId,
  getActiveRun,
  updateActiveRunStatus,
  clearActiveRun,
  hasActiveRun,
  resolveRealChatId,
  isPendingChat,
} from "@/hooks/use-chats";
import { MarkdownRenderer, MarkdownErrorBoundary } from "@/components/markdown-renderer";
import { useAgent } from "@/hooks/use-agent";
import { useBrowserSession, globalStartSseSession, globalUpdateFromSseStep } from "@/hooks/use-browser-session";
import { AgentObserver } from "@/components/agent-observer";
import { VirtualComputer } from "@/components/virtual-computer";
import { EnhancedDocumentEditorLazy, SpreadsheetEditorLazy, PPTEditorShellLazy } from "@/lib/lazyComponents";
import { usePptStreaming } from "@/hooks/usePptStreaming";
import { PPT_STREAMING_SYSTEM_PROMPT } from "@/lib/pptPrompts";
import { ETLDialog } from "@/components/etl-dialog";
import { FigmaBlock } from "@/components/figma-block";
import { CodeExecutionBlock } from "@/components/code-execution-block";
import { IliaGPTLogo } from "@/components/iliagpt-logo";
import { ShareChatDialog, ShareIcon } from "@/components/share-chat-dialog";
import { UpgradePlanDialog } from "@/components/upgrade-plan-dialog";
import { computePromptIntegrity } from "@/lib/promptIntegrity";
import { DocumentGeneratorDialog } from "@/components/document-generator-dialog";
import { GoogleFormsDialog } from "@/components/google-forms-dialog";
import { InlineGoogleFormPreview } from "@/components/inline-google-form-preview";
import { detectFormIntent, extractMentionFromPrompt } from "@/lib/formIntentDetector";
import { markdownToTipTap } from "@/lib/markdownToHtml";
import { detectGmailIntent } from "@/lib/gmailIntentDetector";
import { shouldAutoActivateAgent } from "@/lib/complexityDetector";
import { shouldUseSuperAgent } from "@/lib/superAgentDetector";
import { useImageState, fetchImageAsBase64 } from "@/hooks/use-image-state";
import { useAgentStore, useAgentRun, type AgentRunState } from "@/stores/agent-store";
import { useSuperAgentStore } from "@/stores/super-agent-store";
import { useSuperAgentStream, type SuperAgentState, type SuperAgentArtifact, type SuperAgentFinal } from "@/hooks/use-super-agent";
import { useStartAgentRun, useCancelAgentRun, useAgentPolling, abortPendingAgentStart } from "@/hooks/use-agent-polling";
import { useStreamingStore } from "@/stores/streamingStore";
import { DocumentPreviewPanel, type DocumentPreviewArtifact } from "@/components/document-preview-panel";
import { InlineGmailPreview } from "@/components/inline-gmail-preview";
import { VoiceChatMode } from "@/components/voice-chat-mode";
import { RecordingPanel } from "@/components/recording-panel";
import { Composer } from "@/components/composer";
import { parseDocumentBlocks, type DocumentBlock } from "@/components/message-list";
import { ChatMessageList, ChatMessageListProps } from "@/components/chat/ChatMessageList";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { useChatStore } from "@/stores/chatStore";
import { KeyboardShortcutsDialog } from "@/components/keyboard-shortcuts-dialog";
import { PromptSuggestions } from "@/components/prompt-suggestions";
import { MessageFeedback } from "@/components/message-feedback";
import { UpgradePromptModal, useUpgradePrompt } from "@/components/upgrade-prompt-modal";
// AgentPanel removed - progress is shown inline in chat messages
import { useAuth } from "@/hooks/use-auth";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { useConversationState } from "@/hooks/use-conversation-state";
import { useAgentMode } from "@/hooks/use-agent-mode";
import { Database, Sparkles, AudioLines } from "lucide-react";
import { useModelAvailability, type AvailableModel } from "@/contexts/ModelAvailabilityContext";
import { getFileTheme, getFileCategory, FileCategory } from "@/lib/fileTypeTheme";
import {
  dataImageUrlToFile,
  extractBareUrlsFromText,
  extractFilesFromDataTransfer,
  extractImageUrlsFromHtml,
  extractLinkUrlsFromHtml,
  extractUrlsFromUriList,
  isDataImageUrl,
  normalizeFileForUpload,
  normalizeHttpUrl,
  uniq,
  compressImageToDataUrl,
} from "@/lib/attachmentIngest";
import { useChats } from "@/hooks/use-chats";
import { useChatFolders, type Folder as FolderType } from "@/hooks/use-chat-folders";
import { useProjects } from "@/hooks/use-projects";
import { usePinnedGpts } from "@/hooks/use-pinned-gpts";
import { UniversalExecutionConsole } from "./universal-execution-console";
import { ExecutionStreamClient, FlatRunState } from "@/lib/executionStreamClient";
import { LiveExecutionConsole } from "./live-execution-console";
import { PricingModal } from "./pricing-modal";

import { SyncStatusIndicator } from "./sync-status-indicator";
import { ProductionProgress } from "@/components/production-progress";
import { AiProcessStep, AIState } from "./chat-interface/types";
import { GranularErrorBoundary } from "@/components/ui/granular-error-boundary";
import { EditorErrorBoundary } from "@/components/error-boundaries";
import { DataTableWrapper, CleanDataTableComponents, downloadTableAsExcel, copyTableToClipboard } from "./chat-interface/DataTableWrapper";
import { StreamingIndicator } from "./chat-interface/StreamingIndicator";
import { EditableDocumentPreview, type TextSelection } from "./chat-interface/EditableDocumentPreview";
import { extractTextFromChildren, isNumericValue } from "./chat-interface/utils";
import { PdfPreview } from "@/components/PdfPreview";
import { FilePreviewModal } from "@/components/FilePreviewModal";

function AvatarWithFallback({
  src,
  alt,
  fallback
}: {
  src: string;
  alt: string;
  fallback: React.ReactNode;
}) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary via-primary/80 to-primary/60 flex items-center justify-center shadow-2xl shadow-primary/30">
        {fallback}
      </div>
    );
  }

  return (
    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary via-primary/80 to-primary/60 flex items-center justify-center shadow-2xl shadow-primary/30">
      <img
        src={src}
        alt={alt}
        className="w-full h-full rounded-2xl object-cover"
        onError={() => setHasError(true)}
      />
    </div>
  );
}

// Heuristic function to detect uncertainty in AI responses
function detectUncertainty(content: string): { confidence: 'high' | 'medium' | 'low'; reason?: string } {
  const lowConfidencePatterns = [
    /no (estoy|está) seguro/i,
    /no (puedo|logro|he podido) confirmar/i,
    /falta información/i,
    /información (insuficiente|limitada)/i,
    /no (se menciona|se especifica|aparece|encontré)/i,
    /podría ser/i,
    /es probable que/i,
    /sin certeza/i,
    /no garantiza/i,
    /difícil determinar/i
  ];

  const mediumConfidencePatterns = [
    /parece indicar/i,
    /sugiere que/i,
    /aparentemente/i,
    /posiblemente/i,
    /en principio/i,
    /según el contexto/i
  ];

  for (const pattern of lowConfidencePatterns) {
    if (pattern.test(content)) {
      return {
        confidence: 'low',
        reason: 'La respuesta contiene expresiones de duda o falta de información.'
      };
    }
  }

  for (const pattern of mediumConfidencePatterns) {
    if (pattern.test(content)) {
      return {
        confidence: 'medium',
        reason: 'La respuesta se basa en inferencias o indicaciones no explícitas.'
      };
    }
  }

  return { confidence: 'high' };
}





type AiState = AIState;


interface ChatInterfaceProps {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  onSendMessage: (message: Message) => Promise<SendMessageAck | undefined>;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onCloseSidebar?: () => void;
  activeGpt?: ActiveGpt | null;
  aiState: AiState;
  setAiState: React.Dispatch<React.SetStateAction<AiState>>;
  aiStateChatId?: string | null;
  aiProcessSteps: AiProcessStep[];
  setAiProcessSteps: React.Dispatch<React.SetStateAction<AiProcessStep[]>>;
  chatId?: string | null;
  chatTitle?: string | null;
  onOpenApps?: () => void;
  onUpdateMessageAttachments?: (chatId: string, messageId: string, attachments: Message['attachments'], newMessage?: Message) => void;
  onEditMessageAndTruncate?: (chatId: string, messageId: string, newContent: string, messageIndex: number) => void;
  onTruncateAndReplaceMessage?: (chatId: string, messageIndex: number, newMessage: Message) => void;
  onTruncateMessagesAt?: (chatId: string, messageIndex: number) => void;
  onNewChat?: () => void;
  onEditGpt?: (gpt: ActiveGpt) => void;
  onHideGptFromSidebar?: (gptId: string) => void;
  onPinGptToSidebar?: (gptId: string) => void;
  isGptPinned?: (gptId: string) => boolean;
  onAboutGpt?: (gpt: ActiveGpt) => void;
  onPinChat?: (id: string, e: React.MouseEvent) => void;
  onArchiveChat?: (id: string, e: React.MouseEvent) => void;
  onHideChat?: (id: string, e: React.MouseEvent) => void;
  onDeleteChat?: (id: string, e: React.MouseEvent) => void;
  onDownloadChat?: (id: string, e: React.MouseEvent) => void;
  onEditChatTitle?: (id: string, newTitle: string) => void;
  isPinned?: boolean;
  isArchived?: boolean;
  folders?: Array<{ id: string; name: string; color: string; chatIds: string[] }>;
  onMoveToFolder?: (chatId: string, folderId: string | null) => void;
  onCreateFolder?: (name: string) => void;
  currentFolderId?: string | null;
  // Super Agent UI state - kept in parent to survive ChatInterface key changes
  uiPhase?: 'idle' | 'thinking' | 'console' | 'done';
  setUiPhase?: React.Dispatch<React.SetStateAction<'idle' | 'thinking' | 'console' | 'done'>>;
  activeRunId?: string | null;
  setActiveRunId?: React.Dispatch<React.SetStateAction<string | null>>;
  selectedProjectId?: string | null;
  // Document generation state - kept in parent to survive ChatInterface key changes during new chat creation
  selectedDocTool?: "word" | "excel" | "ppt" | "figma" | null;
  setSelectedDocTool?: React.Dispatch<React.SetStateAction<"word" | "excel" | "ppt" | "figma" | null>>;
  docGenerationState?: {
    status: 'idle' | 'generating' | 'ready' | 'error';
    progress: number;
    stage: string;
    downloadUrl: string | null;
    fileName: string | null;
    fileSize: number | null;
    error?: string;
  };
  setDocGenerationState?: React.Dispatch<React.SetStateAction<{
    status: 'idle' | 'generating' | 'ready' | 'error';
    progress: number;
    stage: string;
    downloadUrl: string | null;
    fileName: string | null;
    fileSize: number | null;
    error?: string;
  }>>;
}

interface UploadedFile {
  id?: string;
  name: string;
  type: string;
  mimeType?: string;
  size: number;
  dataUrl?: string;
  storagePath?: string;
  status?: string;
  content?: string;
  analysisId?: string;
  spreadsheetData?: {
    uploadId: string;
    sheets: Array<{ name: string; rowCount: number; columnCount: number }>;
    previewData?: { headers: string[]; data: any[][] };
  };
}

function isAnalyzableFile(filename: string): boolean {
  const ext = filename.toLowerCase().split('.').pop();
  return ['xlsx', 'xls', 'csv', 'pdf', 'doc', 'docx'].includes(ext || '');
}

async function triggerDocumentAnalysis(
  uploadId: string,
  filename: string,
  onAnalysisStarted: (analysisId: string) => void
): Promise<void> {
  if (!isAnalyzableFile(filename)) return;

  try {
    const response = await apiFetch(`/api/chat/uploads/${uploadId}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'all' })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.sessionId || data.analysisId) {
        onAnalysisStarted(data.sessionId || data.analysisId);
      }
    }
  } catch (err) {
    console.error('Analysis failed to start:', err);
  }
}

// ── Submit mutex ─────────────────────────────────────────────────────────
// Uses sessionStorage because both `useRef` (reset on remount), module-level
// `let` (duplicated by Vite code-splitting) and `window.__` properties
// (cleared when wouter navigation triggers a full React tree unmount/remount)
// fail to persist across the ChatInterface remount cascade.
// sessionStorage survives within the same browser tab session.
function isSubmitLocked(): boolean {
  try {
    const ts = sessionStorage.getItem("__sira_submit_lock");
    if (!ts) return false;
    return Date.now() - Number(ts) < 10_000;
  } catch { return false; }
}
function setSubmitLock(): void {
  try { sessionStorage.setItem("__sira_submit_lock", String(Date.now())); } catch { }
}
function clearSubmitLock(): void {
  try { sessionStorage.removeItem("__sira_submit_lock"); } catch { }
}

export function ChatInterface({
  messages,
  setMessages,
  onSendMessage,
  isSidebarOpen = true,
  onToggleSidebar,
  onCloseSidebar,
  activeGpt,
  aiState,
  setAiState,
  aiStateChatId,
  aiProcessSteps,
  setAiProcessSteps,
  chatId,
  chatTitle,
  onOpenApps,
  onUpdateMessageAttachments,
  onEditMessageAndTruncate,
  onTruncateAndReplaceMessage,
  onTruncateMessagesAt,
  onNewChat,
  onEditGpt,
  onHideGptFromSidebar,
  onPinGptToSidebar,
  isGptPinned,
  onAboutGpt,
  onPinChat,
  onArchiveChat,
  onHideChat,
  onDeleteChat,
  onDownloadChat,
  onEditChatTitle,
  isPinned = false,
  isArchived = false,
  folders = [],
  onMoveToFolder,
  onCreateFolder,
  currentFolderId,
  // Super Agent UI state from parent to survive key changes
  uiPhase: uiPhaseProp,
  setUiPhase: setUiPhaseProp,
  activeRunId: activeRunIdProp,
  setActiveRunId: setActiveRunIdProp,
  selectedProjectId,
  // Document generation state from parent to survive key changes
  selectedDocTool: selectedDocToolProp,
  setSelectedDocTool: setSelectedDocToolProp,
  docGenerationState: docGenerationStateProp,
  setDocGenerationState: setDocGenerationStateProp,
}: ChatInterfaceProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { settings } = useSettingsContext();
  const {
    projects,
    getProject
  } = useProjects();

  const selectedProject = useMemo(() => {
    if (!selectedProjectId) return null;
    return getProject(selectedProjectId) || projects.find((p: any) => p.id === selectedProjectId);
  }, [selectedProjectId, projects, getProject]);

  const { user } = useAuth();
  const { toast } = useToast();

  // First visit explosion
  const { completeWelcome } = useFirstVisit();
  const showExplosion = false;

  const userPlanInfo = useMemo(() => {
    if (!user) return null;
    const plan = user.plan || 'free';
    const isAdmin = Boolean((user as any)?.isAdmin || (user?.email === 'Carrerajorge874@gmail.com'));
    // isPaid = true only if plan is NOT 'free' AND status is 'active'
    const isPaid = Boolean(plan && plan !== 'free' && (user?.status === 'active'));
    return { plan, isAdmin, isPaid };
  }, [user]);

  // Upgrade prompt for free users after 3rd query
  const {
    showPrompt: showUpgradePrompt,
    queryCount,
    incrementQuery,
    closePrompt: closeUpgradePrompt,
    isFreeUser,
  } = useUpgradePrompt(user?.plan ?? undefined);

  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);

  // Sync with chat store for future full migration
  const { setInput: setStoreInput } = useChatStore();

  const {
    state: conversationState,
    isLoading: isConversationStateLoading,
    error: conversationStateError,
    refreshState: refreshConversationState,
    addImage: addImageToState,
    addArtifact: addArtifactToState,
    getLatestImage: getLatestImageFromServer,
  } = useConversationState(chatId);

  useEffect(() => {
    if (conversationState) {
      console.log(`[ChatInterface] Conversation state loaded for chat ${chatId}:`, {
        messagesCount: conversationState.messages?.length || 0,
        imagesCount: conversationState.images?.length || 0,
        artifactsCount: conversationState.artifacts?.length || 0,
      });
    }
    if (conversationStateError) {
      console.warn(`[ChatInterface] Failed to load conversation state for chat ${chatId}:`, conversationStateError);
    }
  }, [chatId, conversationState, conversationStateError]);

  const { initialDraft, saveDraftDebounced, clearDraft, currentTextRef } = useDraft(chatId);
  const [input, setInputRaw] = useState(initialDraft);

  const setInput = useCallback((value: string | ((prev: string) => string)) => {
    setInputRaw((prev: string) => {
      const newValue = typeof value === "function" ? value(prev) : value;
      currentTextRef.current = newValue;
      if (chatId) {
        saveDraftDebounced(chatId, newValue);
      }
      return newValue;
    });
  }, [chatId, saveDraftDebounced, currentTextRef]);
  const [streamingContent, setStreamingContent] = useState("");
  const [contextNotice, setContextNotice] = useState<{
    type: string;
    originalTokens: number;
    finalTokens: number;
    droppedMessages: number;
  } | null>(null);
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const [browserUrl, setBrowserUrl] = useState("https://www.google.com");
  const [isBrowserMaximized, setIsBrowserMaximized] = useState(false);
  const [uploadedFiles, setUploadedFilesState] = useState<UploadedFile[]>([]);
  // uploadedFiles is mutated by async upload/polling code; keep a ref so helpers can read the latest state.
  const uploadedFilesRef = useRef<UploadedFile[]>([]);
  const setUploadedFiles = useCallback((value: React.SetStateAction<UploadedFile[]>) => {
    setUploadedFilesState((prev: UploadedFile[]) => {
      const next =
        typeof value === "function"
          ? (value as (p: UploadedFile[]) => UploadedFile[])(prev)
          : value;
      uploadedFilesRef.current = next;
      return next;
    });
  }, []);
  const pendingUploadsRef = useRef<Map<string, Promise<void>>>(new Map());
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [regeneratingMsgIndex, setRegeneratingMsgIndex] = useState<number | null>(null);
  const [gptSessionId, setGptSessionId] = useState<string | null>(null);
  const [messageFeedback, setMessageFeedback] = useState<Record<string, "up" | "down" | null>>({});
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [previewDocument, setPreviewDocument] = useState<DocumentBlock | null>(null);
  const [editedDocumentContent, setEditedDocumentContent] = useState<string>("");
  const [documentPreviewArtifact, setDocumentPreviewArtifact] = useState<DocumentPreviewArtifact | null>(null);
  const [textSelection, setTextSelection] = useState<TextSelection | null>(null);
  const [editingSelectionText, setEditingSelectionText] = useState<string>("");
  const [originalSelectionText, setOriginalSelectionText] = useState<string>("");
  const [selectedDocText, setSelectedDocText] = useState<string>("");
  // selectedDocTool: prefer parent prop (survives remount), fallback to local state
  const [selectedDocToolLocal, setSelectedDocToolLocal] = useState<"word" | "excel" | "ppt" | "figma" | null>(null);
  const selectedDocTool = selectedDocToolProp !== undefined ? selectedDocToolProp : selectedDocToolLocal;
  const setSelectedDocTool = setSelectedDocToolProp || setSelectedDocToolLocal;
  const [selectedTool, setSelectedTool] = useState<"web" | "agent" | "image" | null>(null);
  const [latencyMode, setLatencyMode] = useState<"fast" | "deep" | "auto">("auto");
  const [activeDocEditor, setActiveDocEditor] = useState<{ type: "word" | "excel" | "ppt"; title: string; content: string; showInstructions?: boolean } | null>(null);
  const [minimizedDocument, setMinimizedDocument] = useState<{ type: "word" | "excel" | "ppt"; title: string; content: string; messageId?: string } | null>(null);
  // DOCX Generation State - prefer parent prop (survives remount), fallback to local state
  const [docGenerationStateLocal, setDocGenerationStateLocal] = useState<{
    status: 'idle' | 'generating' | 'ready' | 'error';
    progress: number;
    stage: string;
    downloadUrl: string | null;
    fileName: string | null;
    fileSize: number | null;
    error?: string;
  }>({ status: 'idle', progress: 0, stage: '', downloadUrl: null, fileName: null, fileSize: null });
  const docGenerationState = docGenerationStateProp !== undefined ? docGenerationStateProp : docGenerationStateLocal;
  const setDocGenerationState = setDocGenerationStateProp || setDocGenerationStateLocal;

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isETLDialogOpen, setIsETLDialogOpen] = useState(false);
  const [figmaTokenInput, setFigmaTokenInput] = useState("");
  const [isFigmaConnecting, setIsFigmaConnecting] = useState(false);
  const [isFigmaConnected, setIsFigmaConnected] = useState(false);
  const [showFigmaTokenInput, setShowFigmaTokenInput] = useState(false);
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const [isUpgradeDialogOpen, setIsUpgradeDialogOpen] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [quotaInfo, setQuotaInfo] = useState<{ remaining: number; limit: number; resetAt: string | null; plan: string } | null>(null);
  const [userPlanState, setUserPlanState] = useState<{ plan: string; isAdmin?: boolean; isPaid?: boolean } | null>(null);
  // isAgentPanelOpen removed - agent progress is shown inline in chat
  const modelSelectorRef = useRef<HTMLDivElement>(null);

  // Keep UI state consistent with Settings toggles (disable features when turned off).
  useEffect(() => {
    if (!settings.webSearch && selectedTool === "web") {
      setSelectedTool(null);
    }
  }, [settings.webSearch, selectedTool]);

  // Auto-open editor when a document tool is selected (Word/Excel/PPT)
  // This ensures the editor is visible and docInsertContentRef is registered
  // BEFORE the user sends their first message, so streaming works immediately.
  useEffect(() => {
    if (selectedDocTool && ['word', 'excel', 'ppt'].includes(selectedDocTool) && !activeDocEditor) {
      const titleMap: Record<string, string> = {
        word: 'Nuevo Documento',
        excel: 'Nueva Hoja de Cálculo',
        ppt: 'Nueva Presentación',
      };
      setActiveDocEditor({
        type: selectedDocTool as 'word' | 'excel' | 'ppt',
        title: titleMap[selectedDocTool] || 'Nuevo Documento',
        content: '',
      });
    }
  }, [selectedDocTool, activeDocEditor]);

  useEffect(() => {
    if (!settings.voiceMode) {
      if (isVoiceChatOpen) setIsVoiceChatOpen(false);
      if (isRecording || isPaused) stopVoiceRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.voiceMode]);

  useEffect(() => {
    if (!settings.canvas) {
      if (activeDocEditor) {
        void closeDocEditor();
      } else if (selectedDocTool) {
        setSelectedDocTool(null);
      }
      if (minimizedDocument) setMinimizedDocument(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.canvas]);

  useEffect(() => {
    const cacheKey = `_planCache_${user?.id || "anon"}`;
    const cached = (window as any)[cacheKey];
    if (cached && Date.now() - cached.ts < 300_000) {
      setUserPlanState(cached.data);
      return;
    }
    const fetchUserPlanInfo = async () => {
      try {
        const response = await apiFetch("/api/user/usage", { credentials: "include" });
        if (response.ok) {
          const data = await response.json();
          const state = {
            plan: data.plan,
            isAdmin: data.isAdmin,
            isPaid: data.plan !== "free"
          };
          (window as any)[cacheKey] = { data: state, ts: Date.now() };
          setUserPlanState(state);
        }
      } catch (error) {
      }
    };
    fetchUserPlanInfo();
  }, [user?.id]);

  const agentMode = useAgentMode(chatId || "");

  // Agent store for persisting agent runs across remounts
  const agentStore = useAgentStore();
  const { startRun: startAgentRun } = useStartAgentRun();
  const { cancel: cancelAgentRun } = useCancelAgentRun();

  // Track the current agent message ID for this chat session
  const [currentAgentMessageId, setCurrentAgentMessageId] = useState<string | null>(null);

  // Track active run ID for Live Execution Console
  // Use props from parent to survive key changes, with local state as fallback
  const [activeRunIdLocal, setActiveRunIdLocal] = useState<string | null>(null);
  const activeRunId = activeRunIdProp !== undefined ? activeRunIdProp : activeRunIdLocal;
  const setActiveRunId = setActiveRunIdProp || setActiveRunIdLocal;

  // uiPhase: single source of truth for UI state during Super Agent runs
  // 'idle' = normal state, 'thinking' = spinner (max 2s), 'console' = LiveExecutionConsole, 'done' = completed
  const [uiPhaseLocal, setUiPhaseLocal] = useState<'idle' | 'thinking' | 'console' | 'done'>('idle');
  const uiPhase = uiPhaseProp !== undefined ? uiPhaseProp : uiPhaseLocal;
  const setUiPhase = setUiPhaseProp || setUiPhaseLocal;

  const uiPhaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Execution stream client for UniversalExecutionConsole - DISABLED
  // This was causing re-renders that interfered with LiveExecutionConsole in MessageList.
  // LiveExecutionConsole has its own RunStreamClient that handles streaming correctly.
  const [executionClient, setExecutionClient] = useState<ExecutionStreamClient | null>(null);
  const [executionRunState, setExecutionRunState] = useState<FlatRunState | null>(null);

  // DISABLED: ExecutionStreamClient was connecting to /stream endpoint and causing re-renders
  // that unmounted/remounted the LiveExecutionConsole in a loop.
  // The LiveExecutionConsole in MessageList now handles all SSE streaming via RunStreamClient.
  // useEffect(() => {
  //   if (uiPhase === 'console' && activeRunId) {
  //     const client = new ExecutionStreamClient(activeRunId);
  //     const unsubscribe = client.subscribe((state) => {
  //       setExecutionRunState(state);
  //       if (state.status === 'completed') {
  //         setUiPhase('done');
  //       }
  //     });
  //     client.connect();
  //     setExecutionClient(client);
  //     return () => {
  //       unsubscribe();
  //       client.destroy();
  //       setExecutionClient(null);
  //       setExecutionRunState(null);
  //     };
  //   } else {
  //     if (executionClient) {
  //       executionClient.destroy();
  //       setExecutionClient(null);
  //       setExecutionRunState(null);
  //     }
  //   }
  // }, [uiPhase, activeRunId]);

  // Optimistic messages - shown immediately before they appear in props
  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([]);

  // Clean up optimistic messages once they appear in props.messages
  useEffect(() => {
    if (optimisticMessages.length > 0 && messages.length > 0) {
      const propsMessageIds = new Set(messages.map(m => m.id));
      const propsTempIds = new Set(
        messages.map((m: any) => m.clientTempId).filter((id: any): id is string => typeof id === "string" && id.length > 0)
      );
      setOptimisticMessages((prev: Message[]) =>
        prev.filter((m: any) => !propsMessageIds.has(m.id) && !propsTempIds.has(m.id))
      );
    }
  }, [messages, optimisticMessages.length]);

  // Track previous chatId for optimistic message cleanup - separate from the stream reset tracking
  const prevChatIdForOptimisticRef = useRef<string | null | undefined>(undefined);

  // Clear optimistic messages only when switching between existing chats
  // NOT when transitioning from null to a new pending chat (which happens during message send)
  useEffect(() => {
    const prevChatId = prevChatIdForOptimisticRef.current;
    const isInitialRender = prevChatId === undefined;
    const isNewChatCreation = prevChatId === null && chatId?.startsWith('pending-');
    const isSameChatTransition = prevChatId?.startsWith('pending-') && chatId && !chatId.startsWith('pending-');

    chatLogger.debug("optimistic chatId effect:", {
      prevChatId,
      chatId,
      isInitialRender,
      isNewChatCreation,
      isSameChatTransition
    });

    // Only clear optimistic messages when:
    // 1. Not initial render
    // 2. Not transitioning from null to pending (new chat creation)
    // 3. Not transitioning from pending to confirmed chatId (same chat)
    if (!isInitialRender && !isNewChatCreation && !isSameChatTransition) {
      // This is a real chat switch - clear optimistic messages and pending uploads
      chatLogger.debug("Clearing optimistic messages and pending uploads (real chat switch)");
      setOptimisticMessages([]);
      // Clear uploaded files so they don't bleed into the new chat
      setUploadedFiles([]);
      // Discard pending upload tracking (polling will self-terminate via stillTracked check)
      pendingUploadsRef.current.clear();
    } else {
      chatLogger.debug("Keeping optimistic messages");
    }

    prevChatIdForOptimisticRef.current = chatId;
  }, [chatId]); // Only depend on chatId - don't run effect on every optimistic message change

  // Reset GPT session ID when activeGpt or chatId changes (new chat or GPT switch)
  useEffect(() => {
    setGptSessionId(null);
  }, [activeGpt?.id, chatId]);

  // Use the store-based polling hook for the active agent run (only when valid messageId exists)
  useAgentPolling(currentAgentMessageId);

  // Get store runs reactively to trigger re-render when store updates
  const allAgentRuns = useAgentStore((state: any) => state.runs);

  // Get the active run from the store for the current chat (use reactive allAgentRuns)
  const activeAgentRun = useMemo(() => {
    if (currentAgentMessageId) {
      return allAgentRuns[currentAgentMessageId] || null;
    }
    // Also check if there's an active run for this chatId from the store
    const runs = Object.values(allAgentRuns);
    return runs.find((r: any) => r.chatId === chatId && ['starting', 'queued', 'planning', 'running'].includes(r.status)) || null;
  }, [currentAgentMessageId, allAgentRuns, chatId]);

  // Combined messages: prop messages + optimistic messages + agent runs from store
  const displayMessages = useMemo(() => {
    const messageKey = (m: any): string => (m?.clientTempId && typeof m.clientTempId === "string" ? m.clientTempId : m.id);

    // Start with optimistic messages, then merge prop messages (prop messages take priority)
    const msgMap = new Map(optimisticMessages.map((m: any) => [messageKey(m), m]));
    // Override with prop messages (they are the source of truth once available)
    messages.forEach((m: any) => msgMap.set(messageKey(m), m));

    // Merge agent runs from the store into messages (use reactive allAgentRuns)
    Object.entries(allAgentRuns).forEach(([messageId, runState]: [string, any]) => {
      // Only include runs for the current chat
      if (runState.chatId === chatId || (!chatId && runState.chatId)) {
        const existingMsg = msgMap.get(messageId);
        if (existingMsg) {
          // Update existing message with agent run data
          msgMap.set(messageId, {
            ...existingMsg,
            agentRun: {
              runId: runState.runId,
              status: runState.status,
              userMessage: runState.userMessage,
              steps: runState.steps,
              eventStream: runState.eventStream,
              summary: runState.summary,
              error: runState.error,
            }
          });
        } else {
          // Create new message for agent run
          msgMap.set(messageId, {
            id: messageId,
            role: "assistant" as const,
            content: "",
            timestamp: new Date(runState.createdAt),
            agentRun: {
              runId: runState.runId,
              status: runState.status,
              userMessage: runState.userMessage,
              steps: runState.steps,
              eventStream: runState.eventStream,
              summary: runState.summary,
              error: runState.error,
            }
          });
        }
      }
    });

    return Array.from(msgMap.values()).sort((a: any, b: any) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [messages, optimisticMessages, allAgentRuns, chatId]);

  // Reset current agent message ID when chatId changes - polling auto-starts via useAgentPolling
  useEffect(() => {
    // Find if there's an active run for this chat
    const matchingRun = Object.entries(allAgentRuns).find(
      ([_, run]: [string, any]) => run.chatId === chatId && ['starting', 'queued', 'planning', 'running'].includes(run.status)
    );

    if (matchingRun) {
      const [msgId] = matchingRun;
      setCurrentAgentMessageId(msgId);
      // Polling auto-starts in useAgentPolling when runId and active status are present
    } else {
      setCurrentAgentMessageId(null);
    }
  }, [chatId, allAgentRuns]);

  // Toast notifications for agent mode
  const prevAgentStatusRef = useRef<string | null>(null);

  // Watch for agent run status changes and trigger appropriate toasts
  useEffect(() => {
    const currentStatus = activeAgentRun?.status || null;
    const prevStatus = prevAgentStatusRef.current;

    // Only trigger toasts on status changes
    if (currentStatus && currentStatus !== prevStatus) {
      switch (currentStatus) {
        case 'running':
        case 'planning':
          if (prevStatus === 'starting' || prevStatus === 'queued' || prevStatus === null) {
            toast({
              description: "Agente iniciado",
              duration: 3000,
            });
          }
          break;
        case 'completed':
          toast({
            description: "Agente completó la tarea",
            duration: 3000,
          });
          break;
        case 'failed':
          toast({
            variant: "destructive",
            description: `Error: ${activeAgentRun?.error || 'Error desconocido'}`,
            duration: 5000,
          });
          break;
        case 'cancelled':
          toast({
            description: "Ejecución cancelada",
            duration: 3000,
          });
          break;
      }
    }

    prevAgentStatusRef.current = currentStatus;
  }, [activeAgentRun?.status, activeAgentRun?.error, toast]);

  // Compute whether agent is actively running (for stop button)
  const isAgentRunning = useMemo(() => {
    const status = activeAgentRun?.status;
    return status === 'starting' || status === 'queued' || status === 'planning' || status === 'running' || status === 'replanning';
  }, [activeAgentRun?.status]);

  // Handle stopping the agent
  const handleAgentStop = useCallback(async () => {
    if (activeAgentRun && currentAgentMessageId) {
      // If runId is available, cancel via API
      if (activeAgentRun.runId) {
        try {
          await cancelAgentRun(currentAgentMessageId, activeAgentRun.runId);
          toast({ description: "Agente detenido", duration: 3000 });
        } catch (error) {
          console.error("Failed to stop agent:", error);
          toast({ title: "Error", description: "No se pudo detener el agente", variant: "destructive" });
        }
      } else {
        // If still in starting/queued state without runId, abort the pending request and cancel locally
        abortPendingAgentStart(currentAgentMessageId);
        useAgentStore.getState().cancelRun(currentAgentMessageId);
        toast({ description: "Agente cancelado", duration: 3000 });
      }
    }
  }, [activeAgentRun, currentAgentMessageId, cancelAgentRun, toast]);

  const { availableModels, isLoading: isModelsLoading, isAnyModelAvailable, selectedModelId, setSelectedModelId } = useModelAvailability();

  const selectedModelData = useMemo(() => {
    // If user selected a model, use that
    if (selectedModelId) {
      const found = availableModels.find((m: any) => m.id === selectedModelId || m.modelId === selectedModelId);
      if (found) return found;
    }
    // Default: prefer Gemini models over others (Perplexity has no API key)
    const preferredModel = availableModels.find((m: any) =>
      m.provider === 'google' && m.modelId?.includes('gemini')
    );
    return preferredModel || availableModels[0] || null;
  }, [selectedModelId, availableModels]);

  const selectedProvider = selectedModelData?.provider || "gemini";
  const selectedModel = selectedModelData?.modelId || "gemini-3-flash-preview";

  const modelsByProvider = useMemo(() => {
    const grouped: Record<string, AvailableModel[]> = {};
    availableModels.forEach((model: any) => {
      if (!grouped[model.provider]) {
        grouped[model.provider] = [];
      }
      grouped[model.provider].push(model);
    });
    return grouped;
  }, [availableModels]);
  const [isDocGeneratorOpen, setIsDocGeneratorOpen] = useState(false);
  const [docGeneratorType, setDocGeneratorType] = useState<"word" | "excel">("word");
  const [isGoogleFormsOpen, setIsGoogleFormsOpen] = useState(false);
  const [googleFormsPrompt, setGoogleFormsPrompt] = useState("");
  const [isGoogleFormsActive, setIsGoogleFormsActive] = useState(true);
  const isGmailActive = !!settings.connectorSearch;
  const [isVoiceChatOpen, setIsVoiceChatOpen] = useState(false);
  const [isKeyboardShortcutsOpen, setIsKeyboardShortcutsOpen] = useState(false);
  const [screenReaderAnnouncement, setScreenReaderAnnouncement] = useState("");
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [pendingGeneratedImage, setPendingGeneratedImage] = useState<{ messageId: string; imageData: string } | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [previewUploadedImage, setPreviewUploadedImage] = useState<{ name: string; dataUrl: string } | null>(null);
  const [previewUploadedFile, setPreviewUploadedFile] = useState<{
    name: string;
    mimeType?: string;
    fileId?: string;
    dataUrl?: string;
    content?: string;
  } | null>(null);
  const [previewFileAttachment, setPreviewFileAttachment] = useState<{
    name: string;
    type: string;
    mimeType?: string;
    imageUrl?: string;
    storagePath?: string;
    fileId?: string;
    content?: string;
    isLoading?: boolean;
    isProcessing?: boolean;
    previewMode?: "pdf" | "image" | "text";
    blobUrl?: string;
  } | null>(null);
  const [copiedAttachmentContent, setCopiedAttachmentContent] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const latestGeneratedImageRef = useRef<{ messageId: string; imageData: string } | null>(null);
  const dragCounterRef = useRef(0);
  const activeDocEditorRef = useRef<{ type: "word" | "excel" | "ppt"; title: string; content: string; showInstructions?: boolean } | null>(null);
  const previewDocumentRef = useRef<DocumentBlock | null>(null);
  const orchestratorRef = useRef<{ runOrchestrator: (prompt: string) => Promise<void> } | null>(null);
  const editedDocumentContentRef = useRef<string>("");
  const chatIdRef = useRef<string | null>(null);
  const streamingChatIdRef = useRef<string | null>(null);
  const prevAiStateRef = useRef<AiState>("idle");

  // Access streaming store actions
  const { startRun, updateStatus, completeRun, failRun, abortRun, appendContent, clearRun } = useStreamingStore();

  // Keep refs in sync with state for cleanup function access
  useEffect(() => {
    editedDocumentContentRef.current = editedDocumentContent;
  }, [editedDocumentContent]);

  useEffect(() => {
    chatIdRef.current = chatId || null;
  }, [chatId]);

  // Agent progress is now shown inline in chat messages, no panel needed

  // Update streaming store when aiState changes
  // This allows tracking of chats processing in background after component unmounts
  useEffect(() => {
    const prevState = prevAiStateRef.current;
    prevAiStateRef.current = aiState;
    const currentChatId = chatId || null;

    // Start run when streaming begins
    if (
      prevState === "idle" &&
      (aiState === "thinking" || aiState === "responding" || aiState === "sending" || aiState === "streaming")
    ) {
      streamingChatIdRef.current = currentChatId;
      if (currentChatId) {
        startRun(currentChatId, undefined, undefined, chatTitle || undefined);
      }
    }

    // Update to streaming status
    if (
      (prevState === "thinking" || prevState === "sending") &&
      (aiState === "responding" || aiState === "streaming")
    ) {
      if (streamingChatIdRef.current) {
        updateStatus(streamingChatIdRef.current, 'streaming');
      }
    }

    // Complete run when streaming ends
    if (
      (prevState === "thinking" || prevState === "responding" || prevState === "sending" || prevState === "streaming") &&
      (aiState === "idle" || aiState === "done" || aiState === "error")
    ) {
      const completedChatId = streamingChatIdRef.current;
      if (completedChatId) {
        // Get the active chat ID from the current prop (may have changed if user switched chats)
        if (aiState === "error") {
          failRun(completedChatId, "Stream error", currentChatId);
        } else {
          completeRun(completedChatId, currentChatId);
        }
        streamingChatIdRef.current = null;
      }
    }
  }, [aiState, chatId, chatTitle, startRun, updateStatus, completeRun, failRun]);

  // Reset streaming state when chatId changes (switching chats)
  // This ensures the new chat starts clean without interference from previous chat
  // NOTE: We do NOT reset aiState here - let it complete naturally for background streaming
  // The aiStateChatId check in the indicator condition prevents bleed-through
  const prevChatIdRef = useRef<string | null | undefined>(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      console.debug(`[ChatInterface] Chat switched from ${prevChatIdRef.current} to ${chatId}`);

      // NOTE: Do NOT abort streaming when switching chats!
      // Streaming continues in background and completes in the streamingStore.
      // Only clear local UI state for the new active chat.

      // Clear LOCAL streaming content only - actual content is preserved in store per-chat
      setStreamingContent("");
      streamingContentRef.current = "";

      prevChatIdRef.current = chatId;
    }
  }, [chatId]);

  const validateStreamingChatId = useCallback(() => {
    return streamingChatIdRef.current === null || streamingChatIdRef.current === chatId;
  }, [chatId]);

  // Auto-save document when component unmounts (chat switch, new chat, etc.)
  useEffect(() => {
    return () => {
      const currentDoc = activeDocEditorRef.current;
      const currentContent = editedDocumentContentRef.current;
      const currentChatId = chatIdRef.current;

      if (!currentDoc || !currentContent || !currentChatId) return;

      const realChatId = resolveRealChatId(currentChatId);
      if (realChatId.startsWith("pending-")) return;

      const stripHtml = (html: string) => html.replace(/<[^>]*>/g, '').trim();
      const plainText = stripHtml(currentContent);
      const placeholderPhrases = [
        "comienza a escribir tu documento aquí",
        "generación inteligente de documentos",
        "escribe tu solicitud en el chat",
        "título de la presentación",
        "haz clic para agregar"
      ];
      const isPlaceholder = placeholderPhrases.some(p => plainText.toLowerCase().includes(p)) || plainText.length < 20;

      if (!isPlaceholder && plainText.length > 20) {
        // Use sendBeacon for reliable save on unmount
        const data = JSON.stringify({
          type: currentDoc.type,
          title: currentDoc.title,
          content: currentContent
        });
        navigator.sendBeacon(`/api/chats/${realChatId}/documents`, new Blob([data], { type: 'application/json' }));
      }
    };
  }, []);

  // PPT streaming integration
  const pptStreaming = usePptStreaming();
  const applyRewriteRef = useRef<((newText: string) => void) | null>(null);
  const docInsertContentRef = useRef<((content: string, replaceMode?: boolean | 'html') => Promise<void> | void) | null>(null);
  const speechRecognitionRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [userHasScrolledUp, setUserHasScrolledUp] = useState(false);
  const lastScrollTimeRef = useRef<number>(0);
  const scrollThrottleMs = 100; // Reduced from 300ms for snappier scroll-to-bottom during streaming

  const scrollToBottom = useCallback((force = false, instant = false) => {
    if (userHasScrolledUp && !force) return;

    if (instant) {
      // Instant scroll — no animation delay (used when user sends a message)
      messagesEndRef.current?.scrollIntoView({
        behavior: 'auto',
        block: 'end'
      });
    } else {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'end'
        });
      });
    }
  }, [userHasScrolledUp]);

  const isNearBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const threshold = 150;
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }, []);

  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

    const nearBottom = distanceFromBottom < 150;
    setShowScrollButton(!nearBottom);

    if (distanceFromBottom > 200) {
      setUserHasScrolledUp(true);
    } else if (distanceFromBottom < 50) {
      setUserHasScrolledUp(false);
    }
  }, []);

  useEffect(() => {
    if (aiState === "idle" && !streamingContent) return;
    if (userHasScrolledUp) return;

    const now = Date.now();
    if (now - lastScrollTimeRef.current < scrollThrottleMs) return;
    lastScrollTimeRef.current = now;

    scrollToBottom();
  }, [aiState, streamingContent, userHasScrolledUp, scrollToBottom]);

  const prevMessageCountRef = useRef(0);
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    const currentCount = displayMessages.length;
    prevMessageCountRef.current = currentCount;

    // Skip the very first render (mount) to avoid triggering scroll cascades
    if (prevCount === 0) return;

    if (currentCount > prevCount) {
      setUserHasScrolledUp(false);
      scrollToBottom(true, true); // force + instant — no animation lag on new messages
    }
  }, [displayMessages.length, scrollToBottom]);

  useEffect(() => {
    return () => {
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.stop();
        speechRecognitionRef.current = null;
      }
    };
  }, []);

  // Click-outside handler for model selector dropdown
  useEffect(() => {
    if (!isModelSelectorOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (modelSelectorRef.current && !modelSelectorRef.current.contains(e.target as Node)) {
        setIsModelSelectorOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isModelSelectorOpen]);

  // Callback to close model selector when textarea receives focus
  const handleCloseModelSelector = useCallback(() => {
    setIsModelSelectorOpen(false);
  }, []);

  // Recording timer effect
  useEffect(() => {
    if (isRecording && !isPaused) {
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((prev: number) => prev + 1);
      }, 1000);
    } else {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, [isRecording, isPaused]);

  // Close file attachment preview on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && previewFileAttachment) {
        setPreviewFileAttachment(null);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [previewFileAttachment]);

  // Global keyboard shortcuts for accessibility
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      // Ctrl+/ or Cmd+/ to show keyboard shortcuts dialog
      if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault();
        setIsKeyboardShortcutsOpen(true);
      }

      // Escape to cancel streaming (only when actively streaming)
      if (e.key === "Escape" && aiState !== "idle") {
        e.preventDefault();
        handleStopChatRef.current?.();
        setScreenReaderAnnouncement("Generación cancelada");
      }
    };

    document.addEventListener("keydown", handleGlobalShortcuts);
    return () => document.removeEventListener("keydown", handleGlobalShortcuts);
  }, [aiState]);

  // Keep refs in sync with state
  useEffect(() => {
    activeDocEditorRef.current = activeDocEditor;
  }, [activeDocEditor]);

  useEffect(() => {
    previewDocumentRef.current = previewDocument;
  }, [previewDocument]);

  const isComplexExcelPrompt = (prompt: string): boolean => {
    return /completo|análisis|análisis completo|4 hojas|gráficos?|gráfica|grafica|gr[aá]fico de barras|gr[aá]fico de lineas|gr[aá]fico de pastel|charts?|bar chart|line chart|pie chart|dashboard|resumen ejecutivo|fórmulas múltiples|ventas.*gráfico|workbook|crea.*gr[aá]fic|genera.*gr[aá]fic|insert.*chart/i.test(prompt.toLowerCase());
  };

  // Document editor is now only opened manually by the user clicking the buttons
  // Removed auto-open behavior to prevent unwanted document creation

  // Check Figma connection status and handle OAuth callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("figma_connected") === "true") {
      setIsFigmaConnected(true);
      setIsFigmaConnecting(false);
      (window as any)._figmaCache = { connected: true, ts: Date.now() };
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    if (urlParams.get("figma_error")) {
      setIsFigmaConnecting(false);
      window.history.replaceState({}, "", window.location.pathname);
    }

    const cached = (window as any)._figmaCache;
    if (cached && Date.now() - cached.ts < 600_000) {
      setIsFigmaConnected(cached.connected);
      return;
    }

    const checkFigmaStatus = async () => {
      try {
        const response = await apiFetch("/api/figma/status");
        const data = await response.json();
        setIsFigmaConnected(data.connected);
        (window as any)._figmaCache = { connected: data.connected, ts: Date.now() };
      } catch (error) {
      }
    };
    checkFigmaStatus();
  }, []);

  // Figma connection handler - OAuth flow
  const handleFigmaConnect = () => {
    setIsFigmaConnecting(true);
    window.location.href = "/api/auth/figma";
  };

  const handleFigmaDisconnect = async () => {
    try {
      await apiFetch("/api/figma/disconnect", { method: "POST" });
      setIsFigmaConnected(false);
    } catch (error) {
      console.error("Error disconnecting from Figma:", error);
    }
  };

  // Function to open blank document editor - preserves existing messages
  const openBlankDocEditor = (type: "word" | "excel" | "ppt", options?: { showInstructions?: boolean }) => {
    const titles = {
      word: "Nuevo Documento Word",
      excel: "Nueva Hoja de Cálculo",
      ppt: "Nueva Presentación"
    };
    const templates = {
      word: "", // Blank canvas - content will stream in real-time
      excel: "",
      ppt: "<h1>Título de la Presentación</h1><p>Haz clic para agregar subtítulo</p>"
    };

    // Only update document editor state - DO NOT clear messages
    setSelectedDocTool(type);
    setActiveDocEditor({
      type,
      title: titles[type],
      content: templates[type],
      showInstructions: options?.showInstructions
    });
    setEditedDocumentContent(templates[type]);

    // Close sidebar when opening a document tool
    onCloseSidebar?.();
  };

  const closeDocEditor = async () => {
    const currentDoc = activeDocEditor;
    const currentContent = editedDocumentContent;

    console.log("[closeDocEditor] Starting save process", {
      hasChatId: !!chatId,
      chatId,
      hasDoc: !!currentDoc,
      contentLength: currentContent?.length || 0
    });

    const stripHtml = (html: string) => html.replace(/<[^>]*>/g, '').trim();
    const plainText = stripHtml(currentContent);
    const placeholderPhrases = [
      "comienza a escribir tu documento aquí",
      "generación inteligente de documentos",
      "escribe tu solicitud en el chat",
      "título de la presentación",
      "haz clic para agregar"
    ];
    const isPlaceholder = placeholderPhrases.some(p => plainText.toLowerCase().includes(p)) || plainText.length < 20;

    console.log("[closeDocEditor] Validation", {
      plainTextLength: plainText.length,
      isPlaceholder,
      willSave: !!(chatId && currentDoc && currentContent && !isPlaceholder && plainText.length > 20)
    });

    if (chatId && currentDoc && currentContent && !isPlaceholder && plainText.length > 20) {
      let realChatId = resolveRealChatId(chatId);

      if (isPendingChat(chatId)) {
        let attempts = 0;
        const maxAttempts = 10;
        while (isPendingChat(chatId) && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 500));
          realChatId = resolveRealChatId(chatId);
          attempts++;
        }
      }

      if (!isPendingChat(chatId) && !realChatId.startsWith("pending-")) {
        try {
          const response = await apiFetch(`/api/chats/${realChatId}/documents`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: currentDoc.type,
              title: currentDoc.title,
              content: currentContent
            })
          });
          if (response.ok) {
            const updatedMessage = await response.json();
            if (updatedMessage && updatedMessage.id && updatedMessage.attachments && onUpdateMessageAttachments) {
              const newMessage: Message = {
                id: updatedMessage.id,
                role: updatedMessage.role || "system",
                content: updatedMessage.content || "",
                timestamp: new Date(updatedMessage.createdAt || Date.now()),
                attachments: updatedMessage.attachments
              };
              onUpdateMessageAttachments(realChatId, updatedMessage.id, updatedMessage.attachments, newMessage);
            }
          } else {
            console.error("Error saving document: server returned", response.status);
          }
        } catch (err) {
          console.error("Error saving document:", err);
        }
      } else {
        console.log("Chat creation timed out, document not saved");
      }
    }

    setActiveDocEditor(null);
    setSelectedDocTool(null);
    setEditedDocumentContent("");
    docInsertContentRef.current = null;
  };

  const handleReopenDocument = (doc: { type: "word" | "excel" | "ppt"; title: string; content: string }) => {
    setSelectedDocTool(doc.type);
    setActiveDocEditor({
      type: doc.type,
      title: doc.title,
      content: doc.content
    });
    setEditedDocumentContent(doc.content);
    setMinimizedDocument(null);
    onCloseSidebar?.();
  };

  const minimizeDocEditor = () => {
    if (!activeDocEditor) return;

    const lastAssistantMessage = [...messages].reverse().find(m => m.role === "assistant");

    setMinimizedDocument({
      type: activeDocEditor.type,
      title: activeDocEditor.title,
      content: editedDocumentContent || activeDocEditor.content,
      messageId: lastAssistantMessage?.id
    });
    setActiveDocEditor(null);
    setSelectedDocTool(null);
  };

  const restoreDocEditor = () => {
    if (!minimizedDocument) return;

    setActiveDocEditor({
      type: minimizedDocument.type,
      title: minimizedDocument.title,
      content: minimizedDocument.content
    });
    setSelectedDocTool(minimizedDocument.type);
    setEditedDocumentContent(minimizedDocument.content);
    setMinimizedDocument(null);
    onCloseSidebar?.();
  };

  // Handle new chat - reset all document state before calling parent handler
  const handleNewChat = useCallback(() => {
    // Reset document tool selection
    setSelectedDocTool(null);
    setActiveDocEditor(null);
    setMinimizedDocument(null);
    setEditedDocumentContent('');
    // Reset document generation state
    setDocGenerationState({
      status: 'idle',
      progress: 0,
      stage: '',
      downloadUrl: null,
      fileName: null,
      fileSize: null
    });
    // Call original onNewChat
    onNewChat?.();
  }, [onNewChat]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const analysisAbortControllerRef = useRef<AbortController | null>(null);
  // Avoid stale `chatId` captures inside long async flows.
  const latestChatIdRef = useRef<string | null>(chatId || null);
  latestChatIdRef.current = chatId || null;
  const streamIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamingContentRef = useRef<string>("");
  const aiStateRef = useRef<AiState>("idle");
  const composerRef = useRef<HTMLDivElement>(null);
  const handleStopChatRef = useRef<(() => void) | null>(null);
  // Mutex: see isSubmitLocked() above (sessionStorage, survives all remount/reload types).
  const isSubmittingRef = useRef(false);
  isSubmittingRef.current = isSubmitLocked();

  const isScopedConversation = useCallback((conversationId?: string | null) => {
    const activeConversationId = latestChatIdRef.current;
    if (!conversationId || !activeConversationId) return true;
    return resolveRealChatId(activeConversationId) === resolveRealChatId(conversationId);
  }, []);

  const setAiStateForChat = useCallback((
    value: React.SetStateAction<AiState>,
    conversationId?: string | null
  ) => {
    if (!isScopedConversation(conversationId)) return;
    setAiState(value);
  }, [isScopedConversation, setAiState]);

  const setAiProcessStepsForChat = useCallback((
    value: React.SetStateAction<AiProcessStep[]>,
    conversationId?: string | null
  ) => {
    if (!isScopedConversation(conversationId)) return;
    setAiProcessSteps(value);
  }, [isScopedConversation, setAiProcessSteps]);

  // Centralized streaming→message transition manager.
  // Guarantees the message is visible in the DOM before streaming is cleared.
  const streamTransition = useStreamingTransition({
    setOptimisticMessages,
    onSendMessage,
    setStreamingContent,
    streamingContentRef,
    setAiState: setAiStateForChat,
    setAiProcessSteps: setAiProcessStepsForChat,
    conversationId: chatId,
  });

  // All-in-one streaming hook: fetch + SSE parse + RAF throttle + atomic finalize
  const streamChat = useStreamChat({
    setOptimisticMessages,
    onSendMessage,
    setStreamingContent,
    streamingContentRef,
    setAiState: setAiStateForChat,
    setAiProcessSteps: setAiProcessStepsForChat,
    getActiveConversationId: () => latestChatIdRef.current,
  });

  useEffect(() => {
    streamChat.synchronizeConversation(chatId || null);
  }, [chatId, streamChat.synchronizeConversation]);

  // Stuck-state watchdog: if aiState stays non-idle for too long without any
  // streaming content, forcibly reset to idle. This is the ultimate safety net
  // for the race condition where the server never sends a done/finish event and
  // all client-side timeouts fail to trigger (e.g. TCP kept alive by heartbeats).
  useEffect(() => {
    if (aiState === "idle" || aiState === "done" || aiState === "error") return;
    // Don't force-reset if there's active streaming content (response is flowing)
    if (streamingContent) return;

    const MAX_STUCK_MS = 120_000; // 2 minutes absolute maximum for thinking state
    const timer = setTimeout(() => {
      // Double-check: only reset if still stuck (no content arrived meanwhile)
      if (aiStateRef.current !== "idle" && aiStateRef.current !== "done" && !streamingContentRef.current) {
        console.warn("[Watchdog] aiState stuck at", aiStateRef.current, "for", MAX_STUCK_MS, "ms — forcing idle");
        setAiState("idle");
        setAiProcessSteps([]);
      }
    }, MAX_STUCK_MS);

    return () => clearTimeout(timer);
  }, [aiState, streamingContent]);

  // Request a refresh of the AI-generated title after streaming completes.
  // The server generates the title asynchronously, so we delay the fetch.
  const requestTitleRefresh = useCallback((targetChatId: string | null | undefined) => {
    if (!targetChatId || targetChatId.startsWith("pending-")) return;
    window.dispatchEvent(new CustomEvent("refresh-chat-title", {
      detail: { chatId: targetChatId, delay: 2500 }
    }));
  }, []);

  const resolveStreamChatId = useCallback((ack?: SendMessageAck | undefined, fallbackChatId?: string | null): string | null => {
    const fallback = fallbackChatId ? resolveRealChatId(fallbackChatId) : null;
    const ackChatId = ack?.chatId;
    if (ackChatId && !ackChatId.startsWith("pending-")) return ackChatId;
    if (fallback && !fallback.startsWith("pending-")) return fallback;
    return ackChatId || fallback || null;
  }, []);

  const buildStreamRunContext = useCallback((msg: Message, persistedAck?: SendMessageAck | undefined): {
    runId?: string;
    clientRequestId?: string;
    userRequestId?: string;
  } => {
    return {
      runId: persistedAck?.run?.id,
      // Always pass clientRequestId so /api/chat/stream can do idempotent run resolution
      // even on the very first message where no chat ACK is available yet.
      clientRequestId: msg.clientRequestId,
      userRequestId: msg.requestId,
    };
  }, []);

  const isDocumentFile = (mimeType: string, fileName: string, type?: string): boolean => {
    const lowerMime = (mimeType || "").toLowerCase();
    const lowerName = (fileName || "").toLowerCase();
    const lowerType = (type || "").toLowerCase();

    if (lowerType === "image" || lowerMime.startsWith("image/")) return false;

    const docMimePatterns = [
      "pdf",
      "word",
      "document",
      "sheet",
      "excel",
      "spreadsheet",
      "presentation",
      "powerpoint",
      "csv",
      "text/plain",
      "text/csv",
      "application/json",
    ];
    if (docMimePatterns.some(p => lowerMime.includes(p))) return true;

    const docExtensions = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".csv", ".txt", ".json", ".rtf", ".odt", ".ods", ".odp"];
    if (docExtensions.some(ext => lowerName.endsWith(ext))) return true;

    if (["pdf", "word", "excel", "ppt", "document"].includes(lowerType)) return true;

    if (!lowerMime || lowerMime === "application/octet-stream") {
      const hasImageExt = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp"].some(ext => lowerName.endsWith(ext));
      return !hasImageExt;
    }

    return false;
  };

  const toAnalyzePayloadAttachment = (att: any) => {
    const rest = { ...(att || {}) };
    const normalizedType = ["word", "excel", "pdf", "text", "csv", "presentation", "ppt", "image", "document"].includes((rest.type || "").toLowerCase())
      ? rest.type
      : "document";

    return {
      id: rest.id || rest.fileId,
      name: rest.name || "documento",
      type: normalizedType === "image" ? "image" : "document",
      mimeType: rest.mimeType || rest.type || "application/octet-stream",
      storagePath: rest.storagePath,
      fileId: rest.fileId || rest.id,
    };
  };

  const markMessageDeliveryError = useCallback((messageKey: string, errorMessage: string) => {
    setOptimisticMessages((prev) => prev.map((m: Message) =>
      (m.id === messageKey || m.clientTempId === messageKey)
        ? { ...m, deliveryStatus: "error", deliveryError: errorMessage }
        : m
    ));
  }, [setOptimisticMessages]);

  const runDocumentAnalysisAsync = useCallback(async (opts: {
    userMessageId: string;
    conversationId?: string | null;
    history: { role: string; content: string }[];
    attachments: any[];
    sourceLabel?: string;
  }): Promise<void> => {
    const clientSendTs = Date.now();
    const normalizedConversationId = (opts.conversationId && !opts.conversationId.startsWith("pending-"))
      ? opts.conversationId
      : `temp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const analysisConversationId = opts.conversationId || chatId || latestChatIdRef.current;

    const analysisAttachmentPayload = opts.attachments
      .map(toAnalyzePayloadAttachment)
      .filter((att: any) => !!att.name && !!att.mimeType);

    if (analysisAttachmentPayload.length === 0) {
      markMessageDeliveryError(opts.userMessageId, "No se encontraron adjuntos de documento para analizar.");
      return;
    }

    const analysisMessageId = `analysis-${opts.userMessageId}`;
    const userFriendlySource = opts.sourceLabel || "envío";
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();

    const placeholder: Message = {
      id: analysisMessageId,
      clientTempId: analysisMessageId,
      role: "assistant",
      content: "Analizando documentos adjuntos…",
      timestamp: new Date(),
      requestId: generateRequestId(),
      userMessageId: opts.userMessageId,
      deliveryStatus: "sending",
      deliveryError: undefined,
    };

    setOptimisticMessages((prev) => {
      const hasPlaceholder = prev.some((m: Message) => m.id === analysisMessageId || m.clientTempId === analysisMessageId);
      if (hasPlaceholder) {
        return prev.map((m: Message) => {
          if (m.id !== analysisMessageId && m.clientTempId !== analysisMessageId) return m;
          return { ...m, ...placeholder, deliveryError: undefined, deliveryStatus: "sending" };
        });
      }
      return [...prev, placeholder];
    });

    analysisAbortControllerRef.current = new AbortController();
    try {
      const response = await apiFetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-client-send-ts": String(clientSendTs),
        },
        body: JSON.stringify({
          messages: opts.history,
          attachments: analysisAttachmentPayload,
          conversationId: normalizedConversationId,
        }),
        signal: analysisAbortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        const message = errorData?.error?.message || errorData?.message || errorData?.error || `Analyze failed: ${response.status}`;
        throw new Error(message);
      }

      const analyzeResult = await response.json();
      const analysisResultMsg: Message = {
        id: analysisMessageId,
        clientTempId: analysisMessageId,
        role: "assistant",
        content: analyzeResult.answer_text || "No se pudo analizar el documento.",
        timestamp: new Date(),
        requestId: generateRequestId(),
        userMessageId: opts.userMessageId,
        deliveryStatus: "sent",
        ui_components: analyzeResult.ui_components || [],
        
      };

      // Persist final analysis result and replace placeholder.
      onSendMessage(analysisResultMsg).catch((err) => {
        const errorMessage = err instanceof Error ? err.message : "No se pudo guardar el resultado del análisis.";
        markMessageDeliveryError(analysisMessageId, errorMessage);
      });

      if (import.meta.env.DEV) {
        console.debug("[Perf][doc-analyze]", {
          source: userFriendlySource,
          userMessageId: opts.userMessageId,
          conversationId: normalizedConversationId,
          totalMs: typeof performance !== "undefined" ? Math.max(0, performance.now() - startedAt).toFixed(1) : null,
        });
      }

      setOptimisticMessages((prev) => prev.map((m: Message) =>
        (m.id === opts.userMessageId || m.clientTempId === opts.userMessageId)
          ? { ...m, deliveryStatus: "sent", deliveryError: undefined }
          : m
      ));
      setAiStateForChat("idle", analysisConversationId);
      setAiProcessStepsForChat([], analysisConversationId);
    } catch (analysisError: any) {
      if (analysisError?.name === "AbortError") {
        return;
      }
      const errorMessage = analysisError?.message || "No se pudo analizar el documento.";
      markMessageDeliveryError(opts.userMessageId, errorMessage);
      setOptimisticMessages((prev) => prev.map((m: Message) => {
        if (m.id !== analysisMessageId && m.clientTempId !== analysisMessageId) return m;
        return {
          ...m,
          deliveryStatus: "error",
          deliveryError: errorMessage,
          content: `No se pudo analizar el documento. ${errorMessage}`,
        };
      }));
      setAiStateForChat("idle", analysisConversationId);
      setAiProcessStepsForChat([], analysisConversationId);
      console.error(`[Document Analysis] (${userFriendlySource}) failed for userMessage ${opts.userMessageId}:`, analysisError);
      throw analysisError;
    } finally {
      if (analysisAbortControllerRef.current) {
        analysisAbortControllerRef.current = null;
      }
    }
  }, [
    markMessageDeliveryError,
    onSendMessage,
    setAiProcessStepsForChat,
    setAiStateForChat,
    setOptimisticMessages,
    chatId,
  ]);

  // Measure composer height and set CSS variable for proper layout
  useEffect(() => {
    const updateComposerHeight = () => {
      if (composerRef.current) {
        const h = composerRef.current.getBoundingClientRect().height;
        document.documentElement.style.setProperty('--composer-height', `${h}px`);
      }
    };

    updateComposerHeight();
    window.addEventListener('resize', updateComposerHeight);
    window.addEventListener('orientationchange', updateComposerHeight);

    return () => {
      window.removeEventListener('resize', updateComposerHeight);
      window.removeEventListener('orientationchange', updateComposerHeight);
    };
  }, []);

  // Keep aiStateRef in sync with aiState for reliable access
  useEffect(() => {
    aiStateRef.current = aiState;
  }, [aiState]);

  // Announce AI state changes for screen readers
  useEffect(() => {
    if (aiState === "thinking") {
      setScreenReaderAnnouncement("Procesando tu mensaje...");
    } else if (aiState === "responding") {
      setScreenReaderAnnouncement("Generando respuesta...");
    } else if (aiState === "idle" && screenReaderAnnouncement && !screenReaderAnnouncement.includes("cancelada")) {
      setScreenReaderAnnouncement("Respuesta completada");
    }
  }, [aiState]);

  // Note: We intentionally do NOT abort requests on unmount
  // This allows streaming to continue in background when user switches chats
  // The streaming will complete and update the correct chat via onSendMessage

  const agent = useAgent();
  const browserSession = useBrowserSession();

  useEffect(() => {
    if (agent.state.browserSessionId && browserSession.state.sessionId !== agent.state.browserSessionId) {
      browserSession.subscribeToSession(agent.state.browserSessionId, agent.state.objective || "Navegando web");
    }
  }, [agent.state.browserSessionId, agent.state.objective, browserSession.state.sessionId]);

  const handleStopChat = () => {
    // Abort active SSE stream from useStreamChat to avoid stray network work.
    if (typeof streamChat.abort === "function") {
      streamChat.abort();
    }

    // Abort any ongoing fetch request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Abort any ongoing document analysis request
    if (analysisAbortControllerRef.current) {
      analysisAbortControllerRef.current.abort();
      analysisAbortControllerRef.current = null;
    }

    // Clear any streaming interval
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }

    // Clean up PPT streaming if active
    if (pptStreaming.isStreaming) {
      pptStreaming.stopStreaming();
    }

    // Save the partial content as a message if there's any (use ref for latest value)
    const currentContent = streamingContentRef.current;
    if (currentContent && currentContent.trim()) {
      streamTransition.finalize({
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: currentContent + "\n\n*[Respuesta detenida por el usuario]*",
        timestamp: new Date(),
      });
    } else {
      streamTransition.finalize({
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "*[Solicitud cancelada por el usuario]*",
        timestamp: new Date(),
      });
    }

    // Explicitly reset UI Phase and AI state to clear any stuck indicator banners
    setUiPhase('idle');
    setAiStateForChat('idle', chatId || 'default');
    setAiProcessStepsForChat([], chatId || 'default');
  };

  // Keep handleStopChatRef in sync for keyboard shortcut access
  useEffect(() => {
    handleStopChatRef.current = handleStopChat;
  });

  const handleCopyMessage = useCallback((content: string, msgId?: string) => {
    navigator.clipboard.writeText(content);

    // Explicitly wipe the AI busy state. The bug causes `aiState` to remain stuck
    // in `thinking` or `agent_working` after a response finishes. When the user 
    // clicks copy, the component re-renders and mistakenly shows the PhaseNarrator again.
    // By forcing it to idle here, we ensure interacting with the message clears the ghost state.
    setAiStateForChat('idle', chatId || 'default');
    setAiProcessStepsForChat([], chatId || 'default');

    if (msgId) {
      setCopiedMessageId(msgId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    }
  }, [chatId, setAiStateForChat, setAiProcessStepsForChat]);

  const handleUserRetrySend = useCallback(async (msg: Message) => {
    if (!msg || msg.role !== "user") return;

    // Avoid starting a second stream while one is active (it will look broken and can abort in-flight work).
    if (aiStateRef.current !== "idle") {
      toast({
        title: "Espera un momento",
        description: "Hay una respuesta en curso. Cancélala o espera para reintentar.",
        duration: 3000,
      });
      return;
    }

    const msgKey = msg.clientTempId || msg.id;
    // 1) Re-persist the user message (idempotent by requestId/clientRequestId) so delivery state updates.
    const persistPromise = onSendMessage({
      ...msg,
      deliveryStatus: "sending",
      deliveryError: undefined,
    }).catch((err) => {
      console.warn("[retry] Failed to persist user message:", err);
      return undefined;
    });

    const persisted = await persistPromise;
    const streamRunContext = buildStreamRunContext(msg, persisted);

    // 2) Ensure we stream against the REAL chatId (never a synthetic fallback).
    const stableChatId = (persisted?.run?.chatId as string | undefined) || resolveStreamChatId(persisted, chatId);
    if (!stableChatId) {
      toast({
        title: "Error",
        description: "No se pudo crear/confirmar el chat para reintentar. Verifica tu conexión e intenta de nuevo.",
        variant: "destructive",
        duration: 5000,
      });
      onSendMessage({
        ...msg,
        deliveryStatus: "error",
        deliveryError: "No se pudo crear/confirmar el chat para reintentar.",
      });
      return;
    }

    const idx = displayMessages.findIndex((m: any) => (m?.clientTempId || m?.id) === msgKey);
    const historyMsgs = idx >= 0 ? displayMessages.slice(0, idx + 1) : [...displayMessages, msg];
    const history = historyMsgs.map((m: any) => ({ role: m.role, content: m.content }));

    const hasDocumentAttachmentsForRetry = (msg.attachments || []).some((att: any) =>
      isDocumentFile(att?.mimeType || att?.type, att?.name || "", att?.type)
    );

    if (hasDocumentAttachmentsForRetry) {
      void runDocumentAnalysisAsync({
        userMessageId: msgKey,
        conversationId: stableChatId,
        history,
        attachments: msg.attachments || [],
        sourceLabel: "reintento",
      });
      return;
    }

    // Keep attachments lightweight: strip base64/data fields and send only metadata.
    const streamAttachments = (msg.attachments || [])
      .map((att: any) => ({
        type: att?.type === "image" ? "image" : "document",
        name: att?.name,
        mimeType: att?.mimeType || att?.type,
        storagePath: att?.storagePath,
        fileId: att?.fileId || att?.id,
        // Do NOT send imageUrl/content/dataUrl here.
      }))
      .filter((att: any) => !!att?.name);

    const result = await streamChat.stream("/api/chat/stream", {
      chatId: stableChatId,
      body: {
        messages: history,
        conversationId: stableChatId,
        chatId: stableChatId,
        runId: streamRunContext.runId,
        clientRequestId: streamRunContext.clientRequestId,
        userRequestId: streamRunContext.userRequestId,
        attachments: streamAttachments.length > 0 ? streamAttachments : undefined,
        docTool: selectedDocTool || null,
        provider: selectedProvider,
        model: selectedModel,
        latencyMode,
      },
      buildFinalMessage: (fullContent, data, messageId) => ({
        id: messageId || `assistant-${Date.now()}`,
        role: "assistant",
        content: fullContent || "No se recibió respuesta del servidor.",
        timestamp: new Date(),
        requestId: data?.requestId || generateRequestId(),
        userMessageId: msgKey,
        artifact: data?.artifact,
        webSources: data?.webSources,
      }),
      buildErrorMessage: (error, messageId) => ({
        id: messageId || `error-${Date.now()}`,
        role: "assistant",
        content: error.message || "Error de conexión. Por favor, intenta de nuevo.",
        timestamp: new Date(),
        requestId: generateRequestId(),
        userMessageId: msgKey,
      }),
    });

    if (result.ok) {
      requestTitleRefresh(stableChatId);
    }
  }, [
    displayMessages,
    latencyMode,
    onSendMessage,
    requestTitleRefresh,
    runDocumentAnalysisAsync,
    isDocumentFile,
    selectedDocTool,
    selectedModel,
    selectedProvider,
    streamChat,
    toast,
  ]);

  const startVoiceRecording = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Tu navegador no soporta reconocimiento de voz. Por favor usa Chrome, Edge o Safari.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'es-ES';

    let finalTranscript = '';
    let interimTranscript = '';

    recognition.onstart = () => {
      setIsRecording(true);
      setRecordingTime(0);
      setIsPaused(false);
      finalTranscript = input;
    };

    recognition.onresult = (event: any) => {
      interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += (finalTranscript ? ' ' : '') + transcript;
        } else {
          interimTranscript = transcript;
        }
      }
      setInput(finalTranscript + (interimTranscript ? ' ' + interimTranscript : ''));
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsRecording(false);
      setRecordingTime(0);
      setIsPaused(false);
      speechRecognitionRef.current = null;
    };

    recognition.onend = () => {
      // Don't auto-reset if paused - user might resume
      if (!isPaused) {
        setIsRecording(false);
        speechRecognitionRef.current = null;
      }
    };

    speechRecognitionRef.current = recognition;
    recognition.start();
  };

  const toggleVoiceRecording = () => {
    if (isRecording) {
      stopVoiceRecording();
    } else {
      startVoiceRecording();
    }
  };

  const pauseVoiceRecording = () => {
    if (speechRecognitionRef.current && isRecording) {
      speechRecognitionRef.current.stop();
      setIsPaused(true);
    }
  };

  const resumeVoiceRecording = () => {
    if (isPaused) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) return;

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'es-ES';

      let currentInput = input;

      recognition.onstart = () => {
        setIsPaused(false);
      };

      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            currentInput += (currentInput ? ' ' : '') + transcript;
          } else {
            interimTranscript = transcript;
          }
        }
        setInput(currentInput + (interimTranscript ? ' ' + interimTranscript : ''));
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsRecording(false);
        setRecordingTime(0);
        setIsPaused(false);
        speechRecognitionRef.current = null;
      };

      recognition.onend = () => {
        if (!isPaused) {
          setIsRecording(false);
          speechRecognitionRef.current = null;
        }
      };

      speechRecognitionRef.current = recognition;
      recognition.start();
    }
  };

  const stopVoiceRecording = () => {
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
      speechRecognitionRef.current = null;
    }
    setIsRecording(false);
    setRecordingTime(0);
    setIsPaused(false);
  };

  const discardVoiceRecording = () => {
    stopVoiceRecording();
    setInput("");
  };

  const sendVoiceRecording = () => {
    stopVoiceRecording();
    if (input.trim() || uploadedFiles.length > 0) {
      handleSubmit();
    }
  };

  const handleOpenDocumentPreview = useCallback((doc: DocumentBlock) => {
    setPreviewDocument(doc);
    setEditedDocumentContent(doc.content);
  }, []);

  const handleCloseDocumentPreview = useCallback(() => {
    setPreviewDocument(null);
    setEditedDocumentContent("");
    setTextSelection(null);
    setEditingSelectionText("");
    setOriginalSelectionText("");
  }, []);

  const handleSelectionChange = (selection: TextSelection | null) => {
    if (selection && selection.text.trim()) {
      setTextSelection(selection);
      setEditingSelectionText(selection.text);
      setOriginalSelectionText(selection.text);
    }
  };

  const handleApplySelectionEdit = () => {
    if (!textSelection || !editedDocumentContent) return;

    const before = editedDocumentContent.substring(0, textSelection.startIndex);
    const after = editedDocumentContent.substring(textSelection.endIndex);
    const newContent = before + editingSelectionText + after;

    setEditedDocumentContent(newContent);
    setTextSelection(null);
    setEditingSelectionText("");
    setOriginalSelectionText("");

    window.getSelection()?.removeAllRanges();
  };

  const handleCancelSelectionEdit = () => {
    setTextSelection(null);
    setEditingSelectionText("");
    setOriginalSelectionText("");
    window.getSelection()?.removeAllRanges();
  };

  const handleRevertSelectionEdit = () => {
    setEditingSelectionText(originalSelectionText);
  };

  const handleDocTextSelect = (text: string, applyRewrite: (newText: string) => void) => {
    setSelectedDocText(text);
    applyRewriteRef.current = applyRewrite;
  };

  const handleDocTextDeselect = () => {
    setSelectedDocText("");
    applyRewriteRef.current = null;
  };

  const handleDownloadDocument = useCallback(async (doc: DocumentBlock) => {
    try {
      const documentToDownload = {
        ...doc,
        content: editedDocumentContent || doc.content
      };
      const response = await apiFetch("/api/documents/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(documentToDownload),
      });

      if (!response.ok) {
        throw new Error("Failed to generate document");
      }

      const blob = await response.blob();
      const ext = doc.type === "word" ? "docx" : doc.type === "excel" ? "xlsx" : "pptx";
      const filename = `${doc.title.replace(/[^a-zA-Z0-9]/g, "_")}.${ext}`;

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Document download error:", error);
    }
  }, [editedDocumentContent]);

  // Save document to Biblioteca (library) via server endpoint
  const handleSaveToLibrary = useCallback(async (doc?: { type: string; title: string; content: string }) => {
    const docToSave = doc || (activeDocEditor ? {
      type: activeDocEditor.type,
      title: activeDocEditor.title,
      content: editedDocumentContent || activeDocEditor.content,
    } : null);

    if (!docToSave) return;

    try {
      const response = await apiFetch("/api/library/save-from-editor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: docToSave.title,
          content: docToSave.content,
          type: docToSave.type,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save to library");
      }

      const result = await response.json();
      toast({
        title: "Guardado en Biblioteca",
        description: `${result.file?.name || docToSave.title} se ha guardado correctamente.`,
      });
    } catch (error) {
      console.error("Save to library error:", error);
      toast({
        title: "Error",
        description: "No se pudo guardar el documento en la Biblioteca.",
        variant: "destructive",
      });
    }
  }, [activeDocEditor, editedDocumentContent, toast]);

  const handleDownloadImage = useCallback((imageData: string) => {
    const link = document.createElement("a");
    link.href = imageData;
    link.download = `imagen-generada-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const handleOpenFileAttachmentPreview = useCallback(async (att: {
    type: string;
    name: string;
    mimeType?: string;
    imageUrl?: string;
    storagePath?: string;
    fileId?: string;
    documentType?: string;
  }) => {
    if (att.type === "image" && att.imageUrl) {
      setLightboxImage(att.imageUrl);
      return;
    }

    if (att.type === "image" && att.storagePath) {
      setLightboxImage(att.storagePath);
      return;
    }

    const mime = att.mimeType || "";
    const isPdf = mime.includes("pdf") || att.name?.toLowerCase().endsWith(".pdf") || (att as any).documentType === "pdf";
    const isImage = mime.startsWith("image/");

    if (isPdf && att.fileId) {
      setPreviewFileAttachment({
        ...att,
        isLoading: false,
        isProcessing: false,
        content: undefined,
        previewMode: "pdf",
        blobUrl: `/api/files/${att.fileId}/content`,
      });
      return;
    }

    if (isImage && att.fileId) {
      setPreviewFileAttachment({
        ...att,
        isLoading: false,
        isProcessing: false,
        content: undefined,
        previewMode: "image",
        blobUrl: `/api/files/${att.fileId}/content`,
      });
      return;
    }

    setPreviewFileAttachment({
      ...att,
      isLoading: true,
      isProcessing: false,
      content: undefined,
    });

    if (att.fileId) {
      try {
        const response = await apiFetch(`/api/files/${att.fileId}/content`);
        if (response.ok) {
          const data = await response.json();
          if (data.status === "ready" && data.content) {
            setPreviewFileAttachment((prev: any) => prev ? {
              ...prev,
              content: data.content,
              isLoading: false,
              isProcessing: false,
            } : null);
            return;
          } else if (data.status === "processing" || data.status === "queued") {
            setPreviewFileAttachment((prev: any) => prev ? {
              ...prev,
              isLoading: false,
              isProcessing: true,
              content: undefined,
            } : null);
            return;
          }
        }
      } catch (error) {
        console.error("Error fetching file content:", error);
      }
    }

    setPreviewFileAttachment((prev: any) => prev ? {
      ...prev,
      isLoading: false,
      isProcessing: false,
      content: "No se pudo cargar el contenido del archivo.",
    } : null);
  }, []);

  const handleCopyAttachmentContent = async () => {
    if (previewFileAttachment?.content) {
      await navigator.clipboard.writeText(previewFileAttachment.content);
      setCopiedAttachmentContent(true);
      setTimeout(() => setCopiedAttachmentContent(false), 2000);
    }
  };

  const handleDownloadFileAttachment = async () => {
    if (!previewFileAttachment?.storagePath) return;
    try {
      const response = await apiFetch(previewFileAttachment.storagePath);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = previewFileAttachment.name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Download failed:", error);
    }
  };

  const handleFeedback = useCallback((msgId: string, value: "up" | "down") => {
    setMessageFeedback((prev: any) => ({
      ...prev,
      [msgId]: prev[msgId] === value ? null : value
    }));
  }, []);

  const handleShare = useCallback(async (content: string) => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "iliagpt Response",
          text: content
        });
      } catch (e) {
        navigator.clipboard.writeText(content);
      }
    } else {
      navigator.clipboard.writeText(content);
    }
  }, []);

  const handleReadAloud = useCallback((msgId: string, content: string) => {
    if (speakingMessageId === msgId) {
      speechSynthesis.cancel();
      setSpeakingMessageId(null);
    } else {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(content);
      utterance.onend = () => setSpeakingMessageId(null);
      utterance.onerror = () => setSpeakingMessageId(null);
      speechSynthesis.speak(utterance);
      setSpeakingMessageId(msgId);
    }
  }, [speakingMessageId]);

  const handleToolConfirm = useCallback((messageId: string, toolName: string, stepIndex: number) => {
    chatLogger.info("User confirmed tool execution", { messageId, toolName, stepIndex });
    toast({
      title: "Ejecución Aprobada",
      description: `Se ha autorizado la ejecución de ${toolName}.`,
    });
    // In a full implementation, we would call the backend to resume the pending tool call here.
  }, [toast]);

  const handleToolDeny = useCallback((messageId: string, toolName: string, stepIndex: number) => {
    chatLogger.info("User denied tool execution", { messageId, toolName, stepIndex });
    toast({
      title: "Ejecución Cancelada",
      description: `Se ha denegado la ejecución de ${toolName}.`,
      variant: "destructive"
    });
    // In a full implementation, we would call the backend to cancel the run or tool call here.
  }, [toast]);

  const handleRegenerate = useCallback(async (msgIndex: number, instruction?: string) => {
    const prevMessages = messages.slice(0, msgIndex);
    const lastUserMsgIndex = [...prevMessages].reverse().findIndex(m => m.role === "user");
    if (lastUserMsgIndex === -1) return;

    const contextUpToUser = prevMessages.slice(0, prevMessages.length - lastUserMsgIndex);

    if (chatId && onTruncateMessagesAt) {
      onTruncateMessagesAt(chatId, msgIndex);
    }

    setRegeneratingMsgIndex(null);

    let chatHistory = contextUpToUser.map(m => ({ role: m.role, content: m.content }));
    if (instruction) {
      chatHistory = [...chatHistory, { role: "user" as const, content: `[Instrucción de regeneración: ${instruction}]` }];
    }

    const regenerateChatId = chatId;
    const setAiStateForRegenerate = (value: React.SetStateAction<AiState>) =>
      setAiStateForChat(value, regenerateChatId);
    const setAiProcessStepsForRegenerate = (value: React.SetStateAction<AiProcessStep[]>) =>
      setAiProcessStepsForChat(value, regenerateChatId);

    await streamChat.stream("/api/chat/stream", {
      chatId: regenerateChatId,
      body: {
        messages: chatHistory,
        chatId: regenerateChatId,
        conversationId: regenerateChatId,
        provider: selectedProvider,
        model: selectedModel,
        latencyMode,
      },
      onEvent: (eventType, data) => {
        if (eventType === "production_start") {
          setAiStateForRegenerate("agent_working");
          setAiProcessStepsForRegenerate([{
            id: "init", step: "init",
            title: `Iniciando producción: ${data.topic || "Documento"}`,
            status: "pending",
            description: `Generando ${data.deliverables?.join(", ") || "archivos"}`,
          }]);
        } else if (eventType === "production_event") {
          setAiProcessStepsForRegenerate((prev: any[]) => {
            const newSteps = [...prev];
            const lastStep = newSteps[newSteps.length - 1];
            if (lastStep?.status === "pending" && data.message) {
              lastStep.title = data.message;
            } else {
              newSteps.push({ id: `step-${Date.now()}`, title: data.message || "Procesando...", status: "pending", description: data.stage });
            }
            return newSteps;
          });
        } else if (eventType === "production_complete") {
          setAiProcessStepsForRegenerate((prev: any[]) => prev.map((s: any) => ({ ...s, status: "done" })));
        } else if (eventType === "tool_start" && data.toolName === "browse_and_act") {
          // Browser automation starting — open the virtual computer panel
          setAiStateForRegenerate("agent_working");
          globalStartSseSession(data.args?.goal || "Automatización web");
          setIsBrowserOpen(true);
        } else if (eventType === "browser_step") {
          // Real-time browser step with screenshot — update the virtual computer
          globalUpdateFromSseStep(data);
          setAiStateForRegenerate("agent_working");
          if (!isBrowserOpen) setIsBrowserOpen(true);
        } else if (eventType === "tool_result" && data.toolName === "browse_and_act") {
          // Browser automation completed
          if (data.result?.success) {
            globalUpdateFromSseStep({
              stepNumber: data.result.stepsCount || 0,
              totalSteps: data.result.stepsCount || 0,
              action: "done",
              reasoning: "Tarea completada",
              goalProgress: "100%",
              screenshot: "",
              url: "",
              title: "",
            });
          }
        }
      },
      buildFinalMessage: (content, data, messageId) => ({
        id: messageId || (Date.now() + 1).toString(),
        role: "assistant",
        content,
        timestamp: new Date(),
        requestId: data?.requestId || generateRequestId(),
        webSources: data?.webSources,
        artifact: data?.artifact,
      }),
      buildErrorMessage: (error, messageId) => ({
        id: messageId || (Date.now() + 1).toString(),
        role: "assistant",
        content: `Lo siento, hubo un error al regenerar la respuesta: ${error.message || 'Error desconocido'}. Por favor intenta de nuevo.`,
        timestamp: new Date(),
        requestId: generateRequestId(),
      }),
    });
  }, [messages, chatId, onTruncateMessagesAt, selectedProvider, selectedModel]);

  const handleAgentCancel = useCallback(async (messageId: string, runId: string) => {
    try {
      if (runId) {
        // Cancel via API when we have a runId
        await cancelAgentRun(messageId, runId);
      } else {
        // Cancel locally when no runId yet (starting/queued state)
        abortPendingAgentStart(messageId);
        useAgentStore.getState().cancelRun(messageId);
      }
      toast({ title: "Cancelado", description: "La ejecución del agente ha sido cancelada" });
    } catch (error) {
      console.error("Failed to cancel agent run:", error);
      toast({ title: "Error", description: "No se pudo cancelar la ejecución", variant: "destructive" });
    }
  }, [cancelAgentRun, toast]);

  const handleAgentRetry = useCallback((messageId: string, userMessage: string) => {
    window.dispatchEvent(new CustomEvent("retry-agent-run", {
      detail: { messageId, userMessage }
    }));
  }, []);

  const handleRunComplete = useCallback(() => {
    console.log('[uiPhase] Run completed, uiPhase=done');
    setUiPhase('done');
    setActiveRunId(null);
  }, [setUiPhase, setActiveRunId]);

  const handleSuperAgentCancel = useCallback((messageId: string) => {
    const { updateState } = useSuperAgentStore.getState();
    updateState(messageId, {
      error: "Cancelado por el usuario",
      phase: "error",
      isRunning: false,
    });
    toast({ title: "Cancelado", description: "La investigación ha sido cancelada" });
  }, [toast]);

  const handleSuperAgentRetry = useCallback((messageId: string) => {
    const run = useSuperAgentStore.getState().runs[messageId];
    if (run?.contract?.original_prompt) {
      useSuperAgentStore.getState().clearRun(messageId);
      setInput(run.contract.original_prompt);
      toast({ title: "Reintentar", description: "Envía el mensaje de nuevo para reintentar" });
    }
  }, [toast]);

  useEffect(() => {
    const handleRetryAgentRun = async (event: CustomEvent<{ messageId: string; userMessage: string }>) => {
      const { messageId, userMessage } = event.detail;
      if (!userMessage) {
        toast({ title: "Error", description: "No se puede reintentar sin el mensaje original", variant: "destructive" });
        return;
      }

      agentStore.clearRun(messageId);

      const newMessageId = `agent-${Date.now()}`;
      setCurrentAgentMessageId(newMessageId);

      try {
        const result = await startAgentRun(
          chatId || "",
          userMessage,
          newMessageId,
          []
        );

        if (result?.chatId && (!chatId || chatId.startsWith("pending-"))) {
          window.dispatchEvent(new CustomEvent("select-chat", { detail: { chatId: result.chatId, preserveKey: true } }));
        }
      } catch (error) {
        console.error("Failed to retry agent run:", error);
        toast({ title: "Error", description: "No se pudo reiniciar el agente", variant: "destructive" });
      }
    };

    window.addEventListener("retry-agent-run", handleRetryAgentRun as unknown as EventListener);
    return () => {
      window.removeEventListener("retry-agent-run", handleRetryAgentRun as unknown as EventListener);
    };
  }, [chatId, agentStore, startAgentRun, toast]);

  // Handle tool-selected events from the ToolCatalog dialog
  useEffect(() => {
    const handleToolSelected = (e: Event) => {
      try {
        const { tool } = (e as CustomEvent).detail || {};
        if (!tool?.name) return;

        const name = tool.name.toLowerCase();

        // Map catalog tool names to Composer tool types
        if (name.includes("web") || name.includes("browse") || name.includes("search")) {
          setSelectedTool("web");
        } else if (name.includes("image") || name.includes("vision")) {
          setSelectedTool("image");
        } else if (name.includes("agent") || name.includes("orchestrat") || name.includes("workflow")) {
          setSelectedTool("agent");
        } else {
          // For other tools, set input with a hint about the tool
          setInput((prev: string) => prev ? prev : `Usa la herramienta "${tool.name}": `);
        }
      } catch (err) {
        console.error("[tool-selected] Error handling tool selection:", err);
      }
    };

    window.addEventListener("tool-selected", handleToolSelected);
    return () => {
      window.removeEventListener("tool-selected", handleToolSelected);
    };
  }, [setInput]);

  const handleStartEdit = useCallback((msg: Message) => {
    setEditingMessageId(msg.id);
    setEditContent(msg.content);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditContent("");
  }, []);

  const handleSendEdit = useCallback(async (msgId: string) => {
    if (!editContent.trim()) return;

    const msgIndex = messages.findIndex(m => m.id === msgId);
    if (msgIndex === -1) return;
    const editConversationId = chatId || latestChatIdRef.current;

    const editedContent = editContent.trim();
    setEditingMessageId(null);
    setEditContent("");

    if (chatId && onEditMessageAndTruncate) {
      onEditMessageAndTruncate(chatId, msgId, editedContent, msgIndex);
    }

    setAiStateForChat("thinking", editConversationId);
    streamingContentRef.current = "";
    setStreamingContent("");

    abortControllerRef.current = new AbortController();

    try {
      const historyUpToEdit = messages.slice(0, msgIndex).map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content
      }));
      historyUpToEdit.push({ role: "user", content: editedContent });

      const response = await apiFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAnonUserIdHeader() },
        credentials: "include",
        body: JSON.stringify({
          messages: historyUpToEdit,
          provider: selectedProvider,
          model: selectedModel
        }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const data = await response.json();

      if (data.content) {
        const aiMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: data.content,
          timestamp: new Date(),
          requestId: generateRequestId(),
          webSources: data.webSources,
        };
        onSendMessage(aiMsg);
      }

      setAiStateForChat("idle", editConversationId);
      abortControllerRef.current = null;

    } catch (error: any) {
      if (error.name === "AbortError") {
        setAiStateForChat("idle", editConversationId);
        return;
      }
      console.error("Edit regenerate error:", error);

      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Lo siento, hubo un error al procesar tu mensaje editado. Por favor intenta de nuevo.",
        timestamp: new Date(),
      };
      onSendMessage(errorMsg);
      setAiStateForChat("idle", editConversationId);
      abortControllerRef.current = null;
    }
  }, [editContent, messages, chatId, latestChatIdRef, onEditMessageAndTruncate, selectedProvider, selectedModel, onSendMessage, setAiStateForChat]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    await processFilesForUpload(Array.from(files));

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Returns a Promise that resolves when polling completes (ready/error/timeout).
  // This allows callers (and pendingUploadsRef) to properly await the full file lifecycle.
  const pollFileStatus = (fileId: string, trackingId: string): Promise<void> => {
    return new Promise<void>((resolve) => {
      const maxAttempts = 120; // Aumentado a 30 segundos (120 * 250ms)
      let attempts = 0;

      const checkStatus = async () => {
        try {
          const stillTracked = uploadedFilesRef.current.some((f: UploadedFile) => f.id === fileId || f.id === trackingId);
          if (!stillTracked) { resolve(); return; }

          const contentRes = await apiFetch(`/api/files/${fileId}/content`, { timeoutMs: 30000 });

          if (!contentRes.ok && contentRes.status !== 202) {
            setUploadedFiles((prev: any[]) =>
              prev.map((f: any) => (f.id === fileId || f.id === trackingId ? { ...f, id: fileId, status: "error" } : f))
            );
            resolve();
            return;
          }

          const contentData = await contentRes.json();

          if (contentData.status === "ready") {
            setUploadedFiles((prev: any[]) =>
              prev.map((f: any) => (f.id === fileId || f.id === trackingId
                ? { ...f, id: fileId, status: "ready", content: contentData.content }
                : f))
            );
            resolve();
            return;
          } else if (contentData.status === "error") {
            setUploadedFiles((prev: UploadedFile[]) =>
              prev.map((f: UploadedFile) => (f.id === fileId || f.id === trackingId ? { ...f, id: fileId, status: "error" } : f))
            );
            resolve();
            return;
          }

          attempts++;
          if (attempts >= maxAttempts) {
            setUploadedFiles((prev: UploadedFile[]) =>
              prev.map((f: UploadedFile) => (f.id === fileId || f.id === trackingId ? { ...f, status: "error" } : f))
            );
            console.warn(`File ${fileId} processing timed out`);
            resolve();
            return;
          }
          setTimeout(checkStatus, 250);
        } catch (error) {
          console.error("Error polling file status:", error);
          setUploadedFiles((prev: UploadedFile[]) =>
            prev.map((f: UploadedFile) => (f.id === fileId || f.id === trackingId ? { ...f, status: "error" } : f))
          );
          resolve();
        }
      };

      setTimeout(checkStatus, 250);
    });
  };

  const removeFile = (index: number) => {
    setUploadedFiles((prev: any[]) => prev.filter((_: any, i: number) => i !== index));
  };

  const ALLOWED_TYPES = [
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
  ];

  const MAX_FILE_SIZE_MB = 500;
  const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
  const MAX_IMAGE_PREVIEW_BYTES = 15 * 1024 * 1024;

  const processFilesForUpload = async (files: File[]) => {
    const normalizedFiles = files.map(normalizeFileForUpload);

    // De-dupe within the same ingest action to avoid accidental duplicates.
    const seen = new Set<string>();
    const dedupedFiles: File[] = [];
    for (const f of normalizedFiles) {
      const key = `${f.name}::${f.size}::${f.type || ""}::${(f as any).lastModified || 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedupedFiles.push(f);
    }

    const oversizedFiles = dedupedFiles.filter(file => file.size > MAX_FILE_SIZE_BYTES);
    const invalidTypeFiles = dedupedFiles.filter(file => {
      const t = file.type || "";
      if (t.startsWith("image/")) return false;
      return !ALLOWED_TYPES.includes(t);
    });

    if (oversizedFiles.length > 0) {
      const names = oversizedFiles.map(f => f.name).join(", ");
      const sizes = oversizedFiles.map(f => `${(f.size / (1024 * 1024)).toFixed(1)}MB`).join(", ");
      toast({
        title: "Archivo demasiado grande",
        description: `El archivo "${names}" (${sizes}) excede el límite de ${MAX_FILE_SIZE_MB}MB.`,
        variant: "destructive",
      });
    }

    if (invalidTypeFiles.length > 0) {
      const names = invalidTypeFiles.map(f => f.name).join(", ");
      toast({
        title: "Tipo de archivo no soportado",
        description: `El archivo "${names}" no es un tipo de archivo permitido.`,
        variant: "destructive",
      });
    }

    const validFiles = dedupedFiles.filter(file => {
      const t = file.type || "";
      const typeOk = t.startsWith("image/") || ALLOWED_TYPES.includes(t);
      return typeOk && file.size <= MAX_FILE_SIZE_BYTES;
    });

    if (validFiles.length === 0) return;

    for (const file of validFiles) {
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2)}`;
      const isImage = file.type.startsWith("image/");
      const isExcel = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'text/csv'
      ].includes(file.type) || !!file.name.match(/\.(xlsx|xls|csv)$/i);

      let dataUrl: string | undefined;
      const isPdfFile = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      if (isImage && file.size <= MAX_IMAGE_PREVIEW_BYTES) {
        try {
          dataUrl = await compressImageToDataUrl(file);
        } catch (e) {
          console.warn("Failed to compress image, falling back to basic FileReader", e);
          dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });
        }
      } else if (isPdfFile && file.size <= 20 * 1024 * 1024) {
        try {
          dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
        } catch (e) {
          console.warn("Failed to read PDF as dataUrl for preview", e);
        }
      }

      const tempFile: UploadedFile = {
        id: tempId,
        name: file.name,
        type: file.type,
        mimeType: file.type,
        size: file.size,
        status: "uploading",
        dataUrl,
      };
      setUploadedFiles((prev: any) => [...prev, tempFile]);

      const doUpload = async (): Promise<void> => {
        const retryFetch = async (fn: () => Promise<Response>, maxRetries = 3, timeoutMs = 15000): Promise<Response> => {
          let lastError: Error | null = null;
          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
              const res = await Promise.race([
                fn(),
                new Promise<Response>((_, reject) => setTimeout(() => reject(new Error("Request timeout")), timeoutMs))
              ]);
              return res;
            } catch (err: any) {
              lastError = err;
              if (attempt < maxRetries) {
                const jitter = Math.floor(Math.random() * 180);
                await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt) + jitter));
              }
            }
          }
          throw lastError || new Error("Request failed after retries");
        };

        const retryUpload = async (fn: () => Promise<void>, maxRetries = 3): Promise<void> => {
          let lastError: Error | null = null;
          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
              await fn();
              return;
            } catch (err: any) {
              lastError = err instanceof Error ? err : new Error("Upload failed");
              if (attempt < maxRetries) {
                const jitter = Math.floor(Math.random() * 180);
                await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt) + jitter));
              }
            }
          }
          throw lastError || new Error("Upload failed after retries");
        };

        try {
          const stableConversationId = chatId && !chatId.startsWith("pending-") ? chatId : null;

          const formData = new FormData();
          formData.append('file', file);
          if (stableConversationId) formData.append('conversationId', stableConversationId);

          const uploadRes = await apiFetch('/api/files/fast-upload', {
            method: 'POST',
            body: formData,
            timeoutMs: 30000,
          });

          if (!uploadRes.ok) {
            const errData = await uploadRes.json().catch(() => ({ error: 'Upload failed' }));
            throw new Error(errData?.error || `Upload failed (status ${uploadRes.status})`);
          }

          const registeredFile = await uploadRes.json();
          if (!registeredFile?.id) {
            throw new Error("Server returned invalid upload response");
          }

          const storagePath = registeredFile.storagePath || '';
          let spreadsheetData: UploadedFile['spreadsheetData'] | undefined;

          if (isExcel) {
            try {
              const spreadsheetForm = new FormData();
              spreadsheetForm.append('file', file);
              const spreadsheetRes = await apiFetch('/api/spreadsheet/upload', {
                method: 'POST',
                body: spreadsheetForm,
                timeoutMs: 30000,
              });
              if (spreadsheetRes.ok) {
                const spreadsheetResult = await spreadsheetRes.json().catch(() => null);
                if (spreadsheetResult) {
                  const sheetDetails = spreadsheetResult.sheetDetails || [];
                  spreadsheetData = {
                    uploadId: spreadsheetResult.id,
                    sheets: sheetDetails.map((s: any) => ({ name: s.name, rowCount: s.rowCount, columnCount: s.columnCount })),
                  };
                  if (spreadsheetResult.firstSheetPreview) {
                    spreadsheetData.previewData = {
                      headers: spreadsheetResult.firstSheetPreview.headers || [],
                      data: spreadsheetResult.firstSheetPreview.data || [],
                    };
                  }
                  triggerDocumentAnalysis(spreadsheetResult.id, file.name, (analysisId) => {
                    setUploadedFiles((prev: any[]) =>
                      prev.map((f: any) => f.id === tempId ? { ...f, analysisId } : f)
                    );
                  });
                }
              }
            } catch (spreadsheetError) {
              console.warn("Failed to parse spreadsheet:", spreadsheetError);
            }
          }

          setUploadedFiles((prev: any[]) =>
            prev.map((f: any) => f.id === tempId ? { ...f, id: registeredFile.id, storagePath, status: "ready", spreadsheetData } : f)
          );

          if (isAnalyzableFile(file.name) && !isExcel) {
            triggerDocumentAnalysis(registeredFile.id, file.name, (analysisId) => {
              setUploadedFiles((prev: any[]) =>
                prev.map((f: any) => f.id === registeredFile.id || f.id === tempId ? { ...f, analysisId } : f)
              );
            });
          }

        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error("File upload error:", error);
          toast({
            title: "Error al subir archivo",
            description: `${file.name}: ${message}`,
            variant: "destructive",
          });
          setUploadedFiles((prev: any[]) =>
            prev.map((f: any) => (f.id === tempId || (f.id !== tempId && f.name === file.name && f.size === file.size) ? { ...f, status: "error", error: message } : f))
          );
        }
      };

      const uploadPromise = doUpload();
      pendingUploadsRef.current.set(tempId, uploadPromise);
      uploadPromise.finally(() => {
        pendingUploadsRef.current.delete(tempId);
      });
    }
  };

  const waitForPendingUploads = async (): Promise<void> => {
    const promises = Array.from(pendingUploadsRef.current.values());
    if (promises.length > 0) {
      if (import.meta.env.DEV) {
        chatLogger.debug("waitForPendingUploads", { count: promises.length });
      }
      await Promise.allSettled(promises);
    }
  };

  // Returns a Promise that resolves when the file reaches a terminal state (ready/error).
  // Prefer persistent WebSocket status updates; fall back to polling when WS is unavailable.
  const pollFileStatusFastPolling = (fileId: string, trackingId: string): Promise<void> => {
    return new Promise<void>((resolve) => {
      const maxTime = 5000;
      const pollInterval = 250;
      const startTime = Date.now();

      const checkStatus = async (): Promise<void> => {
        const stillTracked = uploadedFilesRef.current.some((f: UploadedFile) => f.id === fileId || f.id === trackingId);
        if (!stillTracked) { resolve(); return; }

        if (Date.now() - startTime > maxTime) {
          // Fall back to slower polling. Chain the promise so caller awaits the full lifecycle.
          pollFileStatus(fileId, trackingId).then(resolve);
          return;
        }

        try {
          const contentRes = await apiFetch(`/api/files/${fileId}/content`, { timeoutMs: 30000 });

          if (!contentRes.ok && contentRes.status !== 202) {
            setUploadedFiles((prev: any[]) =>
              prev.map((f: any) => (f.id === fileId || f.id === trackingId ? { ...f, id: fileId, status: "error" } : f))
            );
            resolve();
            return;
          }

          const contentData = await contentRes.json();

          if (contentData.status === "ready") {
            setUploadedFiles((prev: any[]) =>
              prev.map((f: any) => (f.id === fileId || f.id === trackingId
                ? { ...f, id: fileId, status: "ready", content: contentData.content }
                : f))
            );
            resolve();
            return;
          } else if (contentData.status === "error") {
            setUploadedFiles((prev: any[]) =>
              prev.map((f: any) => (f.id === fileId || f.id === trackingId ? { ...f, id: fileId, status: "error" } : f))
            );
            resolve();
            return;
          }

          setTimeout(checkStatus, pollInterval);
        } catch (error) {
          console.error("Polling error:", error);
          // Network hiccup: fall back to slower polling. Chain promise.
          pollFileStatus(fileId, trackingId).then(resolve);
        }
      };

      checkStatus();
    });
  };

  const pollFileStatusFast = (fileId: string, trackingId: string): Promise<void> => {
    const uploader = getFileUploader();
    const wsTimeoutMs = 500;

    return new Promise<void>((resolve) => {
      let settled = false;
      let sawWsEvent = false;
      let unsubscribe: (() => void) | null = null;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let globalTimeoutId: ReturnType<typeof setTimeout> | null = null;

      const stillTracked = () => uploadedFilesRef.current.some((f: UploadedFile) => f.id === fileId || f.id === trackingId);

      let cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (globalTimeoutId) {
          clearTimeout(globalTimeoutId);
          globalTimeoutId = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      };

      const done = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const fallback = () => {
        if (settled) return;
        settled = true;
        cleanup();
        pollFileStatusFastPolling(fileId, trackingId).then(resolve);
      };

      // AGGRESSIVE SPEED OPTIMIZATION: Check immediately to skip the 2s WS wait if the backend fast-paths the 'ready' state.
      // We parse the JSON body here so we can directly transition the file to 'ready' without an extra round-trip.
      apiFetch(`/api/files/${fileId}/content`, { timeoutMs: 5000 }).then(async contentRes => {
        if (settled) return;
        try {
          if (contentRes.status === 200) {
            const contentData = await contentRes.json().catch(() => null);
            if (contentData?.status === "ready") {
              setUploadedFiles((prev: UploadedFile[]) =>
                prev.map((f: UploadedFile) => (f.id === fileId || f.id === trackingId
                  ? { ...f, id: fileId, status: "ready", content: contentData.content }
                  : f))
              );
              done();
              return;
            }
            // File exists but not flagged 'ready' yet — hand off to polling
            fallback();
          } else if (contentRes.status !== 202) {
            // Non-202 non-200 is an error state
            fallback();
          }
          // 202 = still processing, let WS/polling handle it
        } catch {
          // ignore parse error, let WS/polling handle it
        }
      }).catch(() => { });

      // Periodic safety poll every 2 seconds in case WS event drops
      const safetyPollInterval = setInterval(async () => {
        if (settled) {
          clearInterval(safetyPollInterval);
          return;
        }
        try {
          const contentRes = await apiFetch(`/api/files/${fileId}/content`, { timeoutMs: 5000 });
          if (contentRes.status === 200) {
            clearInterval(safetyPollInterval);
            fallback();
          } else if (contentRes.status !== 202) {
            clearInterval(safetyPollInterval);
            fallback();
          }
        } catch {
          // ignore
        }
      }, 2000);

      const originalCleanup = cleanup;
      cleanup = () => {
        clearInterval(safetyPollInterval);
        originalCleanup();
      };

      if (!stillTracked()) { done(); return; }

      try {
        unsubscribe = uploader.subscribeToProcessingStatus(fileId, async (data: any) => {
          if (!sawWsEvent) {
            sawWsEvent = true;
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
          }

          if (!stillTracked()) { done(); return; }

          if (data?.type === "auth_error") {
            console.warn("[FileStatus] WS auth_error, falling back to polling");
            fallback();
            return;
          }

          if (data?.type !== "file_status" || data.fileId !== fileId) return;

          if (data.status === "failed") {
            setUploadedFiles((prev: UploadedFile[]) =>
              prev.map((f: UploadedFile) => (f.id === fileId || f.id === trackingId
                ? { ...f, id: fileId, status: "error", error: data.error || (f as any).error }
                : f))
            );
            done();
            return;
          }

          if (data.status === "completed") {
            // Fetch content once (with short retry for eventual consistency).
            for (let attempt = 0; attempt < 5; attempt++) {
              try {
                const contentRes = await apiFetch(`/api/files/${fileId}/content`, { timeoutMs: 30000 });
                if (contentRes.ok) {
                  const contentData = await contentRes.json();
                  if (contentData.status === "ready") {
                    setUploadedFiles((prev: UploadedFile[]) =>
                      prev.map((f: UploadedFile) => (f.id === fileId || f.id === trackingId
                        ? { ...f, id: fileId, status: "ready", content: contentData.content }
                        : f))
                    );
                    done();
                    return;
                  }
                } else if (contentRes.status !== 202) {
                  break;
                }
              } catch {
                // ignore and retry
              }
              await new Promise(r => setTimeout(r, 250));
            }

            // If content isn't ready yet, fall back to polling as a safety net.
            fallback();
            return;
          }

          // pending/processing: reflect state (best-effort)
          setUploadedFiles((prev: UploadedFile[]) =>
            prev.map((f: UploadedFile) => (f.id === fileId || f.id === trackingId ? { ...f, id: fileId, status: "processing" } : f))
          );
        });

        timeoutId = setTimeout(() => {
          if (!sawWsEvent) {
            console.warn("[FileStatus] WS initial timeout, falling back to polling");
            fallback();
          }
        }, wsTimeoutMs);

        // AGGRESSIVE FIX: Max limits on WebSocket listening (60 seconds) to avoid infinite loading.
        globalTimeoutId = setTimeout(() => {
          console.warn("[FileStatus] WS global wait timeout exceeded, falling back to polling");
          fallback();
        }, 60000);
      } catch (error) {
        console.warn("[FileStatus] WS subscribe failed, falling back to polling:", error);
        fallback();
      }
    });
  };

  const fetchUrlAsDataUrl = async (url: string, maxBytes: number): Promise<string | null> => {
    try {
      const res = await apiFetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      if (blob.size > maxBytes) return null;
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Failed to read blob"));
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  };

  const importUrlsForUpload = (urls: string[]) => {
    const normalized = uniq(
      urls
        .map((u) => normalizeHttpUrl(u) || null)
        .filter((u): u is string => !!u)
    ).slice(0, 10);
    if (normalized.length === 0) return;

    for (const u of normalized) {
      const trackingId = `temp-url-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      const tempFile: UploadedFile = {
        id: trackingId,
        name: u,
        type: "application/octet-stream",
        mimeType: "application/octet-stream",
        size: 0,
        status: "uploading",
      };

      setUploadedFiles((prev: UploadedFile[]) => [...prev, tempFile]);

      const doImport = async (): Promise<void> => {
        const response = await apiFetch("/api/files/import-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: u }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || `No se pudo importar (${response.status})`);
        }

        const importedType: string = data.type || data.mimeType || "application/octet-stream";
        const importedId: string | undefined = data.id;
        const importedName: string = data.name || u;
        const importedSize: number = typeof data.size === "number" ? data.size : 0;
        const importedStoragePath: string | undefined = data.storagePath;
        const importedStatus: string =
          data.status || (importedType.startsWith("image/") ? "ready" : "processing");

        // For images, generate a data URL from same-origin storage so vision works reliably.
        let dataUrl: string | undefined;
        if (importedType.startsWith("image/")) {
          if (typeof data.dataUrl === "string" && data.dataUrl.startsWith("data:")) {
            dataUrl = data.dataUrl;
          } else if (importedStoragePath) {
            const preview = await fetchUrlAsDataUrl(importedStoragePath, 15 * 1024 * 1024);
            if (preview) dataUrl = preview;
          }
        }

        setUploadedFiles((prev: UploadedFile[]) =>
          prev.map((f: UploadedFile) => {
            if (f.id !== trackingId) return f;
            return {
              ...f,
              id: importedId || f.id,
              name: importedName,
              type: importedType,
              mimeType: importedType,
              size: importedSize || f.size,
              storagePath: importedStoragePath,
              status: importedStatus,
              dataUrl: dataUrl || f.dataUrl,
            };
          })
        );

        if (!importedType.startsWith("image/") && importedId && importedStatus === "processing") {
          pollFileStatusFast(importedId, trackingId);
        }
      };

      const promise = doImport().catch((error: any) => {
        console.error("URL import error:", error);
        setUploadedFiles((prev: UploadedFile[]) =>
          prev.map((f: UploadedFile) => (f.id === trackingId ? { ...f, status: "error" } : f))
        );
        toast({
          title: "No se pudo importar el enlace",
          description: error?.message || "Error desconocido",
          variant: "destructive",
        });
      });

      pendingUploadsRef.current.set(trackingId, promise);
      promise.finally(() => {
        pendingUploadsRef.current.delete(trackingId);
      });
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const clipboard = e.clipboardData;
    const items = clipboard?.items;
    if (!clipboard) return;

    const pastedText = clipboard.getData("text/plain");
    const hasTextContent = !!pastedText.trim();

    const filesToUpload: File[] = [];
    let allFilesAreImages = true;

    const itemsArray = items ? (Array.from(items) as any[]) : [];
    for (const item of itemsArray) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile?.();
      if (!file) continue;

      const declaredType = (file.type || item.type || "").trim();
      if (!declaredType.startsWith("image/")) allFilesAreImages = false;

      const originalName = (file.name || "").trim();
      const isGenericImageName = !originalName || originalName === "image.png" || originalName === "image.jpg";
      const subtype = declaredType.includes("/") ? declaredType.split("/")[1] : "";
      const cleanedSubtype = subtype.split("+")[0].split(".")[0];
      const safeExt = declaredType.startsWith("image/") ? (cleanedSubtype || "png") : "bin";
      const fileName = isGenericImageName ? `pasted-${Date.now()}.${safeExt}` : originalName;

      const normalized = normalizeFileForUpload(new File([file], fileName, { type: declaredType || file.type }));
      filesToUpload.push(normalized);
    }

    if (clipboard.files && clipboard.files.length > 0) {
      for (const f of Array.from(clipboard.files)) {
        const declaredType = (f.type || "").trim();
        if (!declaredType.startsWith("image/")) allFilesAreImages = false;
        filesToUpload.push(normalizeFileForUpload(f));
      }
    }

    if (filesToUpload.length > 0) {
      if (hasTextContent && allFilesAreImages) {
        const LONG_TEXT_THRESHOLD = 500;
        if (pastedText.trim().length > LONG_TEXT_THRESHOLD) {
          e.preventDefault();
          const looksTabular = /\t/.test(pastedText) || pastedText.split("\n").length > 3;
          const ext = looksTabular ? "csv" : "txt";
          const mime = looksTabular ? "text/csv" : "text/plain";
          const content = looksTabular ? pastedText.replace(/\t/g, ",") : pastedText;
          const docFile = new File([content], `pasted-content-${Date.now()}.${ext}`, { type: mime });
          await processFilesForUpload([normalizeFileForUpload(docFile)]);
          return;
        }
        return;
      }
      e.preventDefault();
      await processFilesForUpload(filesToUpload);
      return;
    }

    const LONG_PASTE_THRESHOLD = 500;
    if (pastedText.trim().length > LONG_PASTE_THRESHOLD) {
      e.preventDefault();
      const looksTabular = /\t/.test(pastedText) || (pastedText.split("\n").length > 5 && /[,;|]/.test(pastedText));
      const ext = looksTabular ? "csv" : "txt";
      const mime = looksTabular ? "text/csv" : "text/plain";
      const content = looksTabular && /\t/.test(pastedText) ? pastedText.replace(/\t/g, ",") : pastedText;
      const docFile = new File([content], `pasted-content-${Date.now()}.${ext}`, { type: mime });
      await processFilesForUpload([normalizeFileForUpload(docFile)]);
      return;
    }

    // Smart paste: if the clipboard content is one or more bare URLs, import them as attachments.
    const uriList = clipboard.getData("text/uri-list");
    const html = clipboard.getData("text/html");
    const text = clipboard.getData("text/plain");

    // Support pasting base64-encoded images (data URLs).
    if (isDataImageUrl(text)) {
      const mimeMatch = text.match(/^data:([^;]+);base64,/i);
      const mime = (mimeMatch?.[1] || "image/png").toLowerCase();
      const ext =
        mime === "image/jpeg" || mime === "image/jpg" ? "jpg" :
          mime === "image/webp" ? "webp" :
            mime === "image/gif" ? "gif" :
              mime === "image/bmp" ? "bmp" :
                mime === "image/tiff" ? "tiff" :
                  mime === "image/svg+xml" ? "svg" :
                    "png";
      const f = dataImageUrlToFile(text, `pasted-${Date.now()}.${ext}`);
      if (f) {
        e.preventDefault();
        await processFilesForUpload([normalizeFileForUpload(f)]);
        return;
      }
    }

    // Allow URLs to be pasted as plain text — do NOT intercept or convert to attachments.
    // Only intercept single HTML-embedded images when no text accompanies them.
    const htmlImageUrls = extractImageUrlsFromHtml(html);
    if (htmlImageUrls.length === 1 && !text.trim()) {
      e.preventDefault();
      importUrlsForUpload([htmlImageUrls[0]]);
    }
  };

  const isFileOrUrlDragEvent = (dt: DataTransfer | null | undefined): boolean => {
    if (!dt) return false;
    const types = Array.from(dt.types || []);
    if (types.includes("Files") || types.includes("application/x-moz-file")) return true;
    if (types.includes("text/uri-list") || types.includes("text/html")) return true;
    if (dt.items && Array.from(dt.items).some((it) => (it as any).kind === "file")) return true;
    if (dt.files && dt.files.length > 0) return true;
    return false;
  };

  const handleDragOver = (e: React.DragEvent) => {
    const isFileOrUrlDrag = isFileOrUrlDragEvent(e.dataTransfer);
    if (!isFileOrUrlDrag) return;
    e.preventDefault();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    const isFileOrUrlDrag = isFileOrUrlDragEvent(e.dataTransfer);
    if (!isFileOrUrlDrag) return;
    e.preventDefault();
    dragCounterRef.current++;
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!isDraggingOver) return;
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    dragCounterRef.current = 0;
    setIsDraggingOver(false);

    const dt = e.dataTransfer;
    const isFileOrUrlDrag = isFileOrUrlDragEvent(dt);
    if (!isFileOrUrlDrag) return;

    e.preventDefault();

    const droppedFiles = await extractFilesFromDataTransfer(dt, { maxFiles: 200 });
    if (droppedFiles.length > 0) {
      await processFilesForUpload(droppedFiles);
      return;
    }

    // Drop-to-import for links/images dragged from the browser.
    const uriList = dt?.getData?.("text/uri-list") || "";
    const html = dt?.getData?.("text/html") || "";
    const text = dt?.getData?.("text/plain") || "";

    const candidateTextUrl = normalizeHttpUrl(text);
    const urls = uniq([
      ...(candidateTextUrl ? [candidateTextUrl] : []),
      ...extractUrlsFromUriList(uriList),
      ...extractImageUrlsFromHtml(html),
      ...extractLinkUrlsFromHtml(html),
    ]);

    if (urls.length > 0) {
      importUrlsForUpload(urls);
    }
  };

  const getFileIcon = (type: string, fileName?: string) => {
    const theme = getFileTheme(fileName, type);
    const category = getFileCategory(fileName, type);

    if (category === "excel") {
      return <FileSpreadsheet className={`h-4 w-4 ${theme.textColor}`} />;
    }
    if (category === "image") {
      return <Image className={`h-4 w-4 ${theme.textColor}`} />;
    }
    return <FileText className={`h-4 w-4 ${theme.textColor}`} />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const isFileUploadBlockingSend = (file: UploadedFile): boolean => {
    const status = (file?.status || "").toLowerCase();
    if (status === "error") return false;
    if (status === "uploading") return true;
    if (status !== "processing") return false;
    const hasStableFileId =
      typeof file.id === "string" &&
      file.id.length > 0 &&
      !file.id.startsWith("temp-");
    const hasStoragePath =
      typeof file.storagePath === "string" &&
      file.storagePath.trim().length > 0;
    // "processing" is sendable once the file is persisted.
    return !hasStableFileId && !hasStoragePath;
  };

  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [input]);

  const handleSubmit = async () => {
    // ── Mutex guard: prevent re-entrant calls ──────────────────────────
    // React re-renders (from chatId prop change after new-chat creation)
    // can cause handleSubmit to be called again before the first async
    // invocation completes. This ref-based lock prevents that entirely.
    if (isSubmitLocked()) {
      console.log("[handleSubmit] Blocked: already submitting (sessionStorage lock active)");
      return;
    }
    // Prevent double-submit while THIS chat has a request in flight.
    // If a DIFFERENT chat is busy (aiStateChatId !== chatId), allow submission.
    const thisChatBusy = aiState !== "idle" && (!aiStateChatId || aiStateChatId === chatId);
    if (thisChatBusy) {
      console.log("[handleSubmit] Blocked: aiState is", aiState, "for chatId", aiStateChatId);
      return;
    }
    setSubmitLock();
    isSubmittingRef.current = true;
    try {
      const submitConversationId = chatId || latestChatIdRef.current;
      // When sending the very first message, the parent may create a pending chatId asynchronously.
      // We may need to wait briefly for `chatId` (and `latestChatIdRef`) to update before starting SSE.
      const waitForActiveChatId = async (timeoutMs = 1200): Promise<string | null> => {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
          const id = latestChatIdRef.current;
          if (id) return id;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return latestChatIdRef.current || null;
      };

      // EMERGENCY BYPASS intentionally disabled in this branch to preserve chat run persistence/idempotency.
      // Re-enable only in an explicit temporary local debug profile if required.
      const ENABLE_EMERGENCY_BYPASS = false;

      // If input is present and starts with "!", do direct API call (dev only).
      if (ENABLE_EMERGENCY_BYPASS && input.trim().startsWith("!")) {
        const cleanInput = input.trim().substring(1);
        setInput("");

        const effectiveChatIdForStream = chatId && !chatId.startsWith("pending-") ? chatId : `chat_${Date.now()}`;
        if (chatId?.startsWith("pending-")) {
          window.dispatchEvent(new CustomEvent("select-chat", { detail: { chatId: effectiveChatIdForStream, preserveKey: true } }));
        }

        const emergencyResult = await streamChat.stream("/api/chat/stream", {
          chatId: effectiveChatIdForStream,
          body: {
            messages: [{ role: "user", content: cleanInput }],
            chatId: effectiveChatIdForStream,
            conversationId: effectiveChatIdForStream,
            model: selectedModel || "grok-3",
            latencyMode,
          },
          onEvent: (eventType, data) => {
            if (eventType === "tool_start" && data.toolName === "browse_and_act") {
              setAiStateForChat("agent_working", effectiveChatIdForStream);
              globalStartSseSession(data.args?.goal || "Automatización web");
              setIsBrowserOpen(true);
            } else if (eventType === "browser_step") {
              globalUpdateFromSseStep(data);
              setAiStateForChat("agent_working", effectiveChatIdForStream);
              if (!isBrowserOpen) setIsBrowserOpen(true);
            }
          },
          buildFinalMessage: (content, _lastEvent, messageId) => ({
            id: messageId || `emergency-${Date.now()}`,
            role: "assistant",
            content: content || "No response received",
            timestamp: new Date(),
          }),
        });
        if (emergencyResult.ok) requestTitleRefresh(effectiveChatIdForStream);
        return;
      }

      // MOCK CITATION TRIGGER FOR VERIFICATION
      if (input.trim() === "/test-citation") {
        const mockMsg: Message = {
          id: `mock-${Date.now()}`,
          role: "assistant",
          content: "Aquí hay una respuesta con una cita interna [[FUENTE:Documento de Diseño|http://example.com/doc.pdf]].",
          timestamp: new Date(),
          webSources: [
            {
              source: { name: "Documento de Diseño", domain: "example.com" },
              url: "http://example.com/doc.pdf",
              title: "Especificación Técnica",
              domain: "example.com",
              metadata: {
                pageNumber: 42,
                section: "3.5 Arquitectura",
                totalPages: 100
              } as any
            }
          ]
        };
        onSendMessage(mockMsg);
        setInput("");
        return;
      }

      if (import.meta.env.DEV) {
        chatLogger.debug("handleSubmit called", { inputLength: input.length, selectedTool });
      }

      // Allow submit if: there's input text, OR there are sendable files, OR there's selected doc text with instruction
      const hasInput = input.trim().length > 0;
      const filesAtSubmit = [...uploadedFilesRef.current];
      const failedFilesAtSubmit = filesAtSubmit.filter((f: UploadedFile) => f?.status === "error");
      const attachableFilesAtSubmit = filesAtSubmit.filter((f: UploadedFile) => f?.status !== "error");
      const blockingFilesAtSubmit = attachableFilesAtSubmit.filter(isFileUploadBlockingSend);
      const hasFiles = attachableFilesAtSubmit.length > 0;
      const hasSelectionWithInstruction = selectedDocText && input.trim();

      if (import.meta.env.DEV) {
        chatLogger.debug("handleSubmit content check", {
          hasInput,
          hasFiles,
          totalFiles: filesAtSubmit.length,
          attachableFiles: attachableFilesAtSubmit.length,
          failedFiles: failedFilesAtSubmit.length,
          blockingFiles: blockingFilesAtSubmit.length,
        });
      }
      if (blockingFilesAtSubmit.length > 0) {
        toast({
          title: "Subida en progreso",
          description: "Espera un momento a que termine la carga del archivo para enviarlo.",
          duration: 3000,
        });
        return;
      }
      if (!hasInput && !hasFiles && !hasSelectionWithInstruction) {
        if (failedFilesAtSubmit.length > 0) {
          toast({
            title: "No se pudo adjuntar el archivo",
            description: "La carga falló. Elimina el archivo y vuelve a subirlo para enviarlo.",
            variant: "destructive",
            duration: 4000,
          });
        }
        if (import.meta.env.DEV) {
          chatLogger.debug("handleSubmit no content, returning");
        }
        return;
      }

      // Deterministic local shortcut (no LLM/stream): create Desktop folder immediately.
      // Uses keyword detection + name extraction to handle ANY word order in Spanish/English.
      if (hasInput && !hasFiles) {
        const userText = input.trim();

        // Step 1: Detect intent — does the user want to create a folder on the desktop?
        const hasCreateVerb = /\b(?:crea|crear|creame|creá|crees|haz|hazme|genera|generar|make|create)\b/i.test(userText);
        const hasFolderWord = /\b(?:carpeta|caroeta|carepta|carptea|careta|folder|directorio|directory)\b/i.test(userText);
        const hasDesktopContext = /\b(?:escritorio|excritorio|desktop|mi\s+mac|my\s+mac)\b/i.test(userText);
        const isMkdirCommand = /^(?:\/?mkdir|local:\s*mkdir)\s+/i.test(userText);
        const isLocalFolderIntent = (hasCreateVerb && hasFolderWord) || isMkdirCommand;

        // Step 2: Extract folder name using multiple strategies (order matters — most specific first)
        let folderName: string | null = null;
        if (isLocalFolderIntent) {
          const cleanName = (raw: string): string => {
            return raw.trim()
              .replace(/^[\s("'`\[{]+/, "").replace(/[\s)"'`\]},]+$/, "")
              .replace(/\s+en\s+(?:(?:mi|el|la|tu|su)\s+)?(?:escritorio|excritorio|desktop|mac)\b.*$/i, "")
              .replace(/\s+on\s+(?:(?:my|the)\s+)?(?:desktop|mac)\b.*$/i, "")
              .replace(/\s+(?:por\s+favor|gracias|please|thanks)\b.*$/i, "")
              .replace(/[.,;:!?]+$/, "")
              .trim();
          };

          // Strategy A: Explicit name markers — "llamada X", "con el nombre X", "named X", "que se llame X"
          const nameMarkerMatch = userText.match(
            /(?:llamada|con\s+(?:el\s+)?nombre|named|que\s+se\s+llame)\s+["']?([^"'\n]{1,160})["']?/i
          );
          if (nameMarkerMatch?.[1]) folderName = cleanName(nameMarkerMatch[1]);

          // Strategy B: Rigid patterns — "crea carpeta X en escritorio", "crea una carpeta X"
          if (!folderName) {
            const rigidPatterns = [
              /(?:crea|crear|creame|creá|crees|haz|hazme|genera|generar|make|create)\s+(?:otra\s+|una\s+)?(?:carpeta|caroeta|carepta|carptea|careta|folder|directorio|directory)\s+["']?([^"'\n]{1,160}?)["']?\s+(?:en\s+)?(?:(?:mi|el|la|tu|su)\s+)?(?:escritorio|excritorio|desktop|mac)\b/i,
              /(?:crea|crear|creame|creá|crees|haz|hazme|genera|generar|make|create)\s+(?:otra\s+|una\s+)?(?:carpeta|caroeta|carepta|carptea|careta|folder|directorio|directory)\s+["']?([^"'\n]{1,160})["']?\s*$/i,
            ];
            for (const re of rigidPatterns) {
              const m = userText.match(re);
              if (m?.[1]) { folderName = cleanName(m[1]); break; }
            }
          }

          // Strategy C: /mkdir command
          if (!folderName && isMkdirCommand) {
            const mkdirMatch = userText.match(/^(?:\/?mkdir|local:\s*mkdir)\s+["']?([^"'\n]{1,120})["']?\s*$/i);
            if (mkdirMatch?.[1]) folderName = cleanName(mkdirMatch[1]);
          }

          // Strategy D: Last resort — if intent is clear (create + folder + desktop), extract the most
          // likely proper noun / quoted string as the folder name
          if (!folderName && hasDesktopContext) {
            // Try quoted strings first
            const quotedMatch = userText.match(/["'""]([^"'""\n]{1,120})["'""]/);
            if (quotedMatch?.[1]) {
              folderName = cleanName(quotedMatch[1]);
            } else {
              // Extract the last capitalized word or word sequence that isn't a Spanish/English stop word
              const stopWords = new Set([
                "en", "mi", "una", "un", "la", "el", "de", "del", "con", "que", "se", "por", "los", "las",
                "tu", "su", "al", "es", "lo", "le", "da", "di", "si", "no", "ya", "ha", "he", "fue", "ser",
                "crear", "crea", "creame", "haz", "hazme", "genera", "make", "create",
                "carpeta", "caroeta", "carepta", "folder", "directorio",
                "escritorio", "excritorio", "desktop", "mac", "nombre", "llamada",
                "puedes", "podrias", "porfavor", "favor", "gracias", "please",
                "otra", "nueva", "nuevo", "quiero", "necesito", "me", "my", "the", "on", "a",
              ]);
              // Find words that look like a name (start with uppercase or contain numbers/special chars)
              const words = userText.split(/\s+/);
              const candidates: string[] = [];
              for (const w of words) {
                const plain = w.replace(/^["'`([{]+/, "").replace(/["'`)\]},.:;!?]+$/, "");
                if (!plain) continue;
                if (stopWords.has(plain.toLowerCase())) continue;
                if (/^[A-Z]/.test(plain) || /\d/.test(plain) || /[=_-]/.test(plain)) {
                  candidates.push(plain);
                }
              }
              if (candidates.length > 0) {
                folderName = cleanName(candidates.join(""));
              }
            }
          }
        }

        console.log("[LocalControl] Folder check:", { isLocalFolderIntent, folderName, hasDesktopContext });

        if (folderName) {
          console.log("[LocalControl] ✅ FOLDER INTERCEPTED — calling /api/local/create-folder with name:", folderName);
          const userMsg: Message = {
            id: `user-${Date.now()}`,
            role: "user",
            content: userText,
            timestamp: new Date(),
            requestId: generateRequestId(),
          };
          onSendMessage(userMsg);
          setInput("");

          try {
            const res = await apiFetch("/api/local/create-folder", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...getAnonUserIdHeader() },
              credentials: "include",
              body: JSON.stringify({ name: folderName, prompt: userText }),
            });
            const data = await res.json();
            const assistantMsg: Message = {
              id: `assistant-${Date.now()}`,
              role: "assistant",
              content: data?.message || (data?.path ? `Listo. Carpeta creada: ${data.path}` : "Listo."),
              timestamp: new Date(),
              requestId: generateRequestId(),
            };
            onSendMessage(assistantMsg);
          } catch (error: any) {
            onSendMessage({
              id: `assistant-err-${Date.now()}`,
              role: "assistant",
              content: `No se pudo crear la carpeta: ${error?.message || "error desconocido"}`,
              timestamp: new Date(),
              requestId: generateRequestId(),
            });
          }
          return;
        }
      }

      // ── General local control interception ──
      // Intercepts /local <cmd> prefixed commands AND natural language commands
      // (rm, read, shell, sysinfo, write, ls, cp, etc.) BEFORE the LLM stream.
      if (hasInput && !hasFiles) {
        const userText2 = input.trim();
        let isLocalExecIntent = false;
        console.log("[LocalControl] Checking general interception for:", JSON.stringify(userText2));

        // 1. Prefixed: /local <cmd> (skip mkdir which is handled above via create-folder)
        const isLocalPrefixed = /^(?:\/local|local:)\s+/i.test(userText2);
        const isLocalMkdirPrefixed = /^(?:\/local|local:)\s+(?:mkdir|carpeta|crear-carpeta)\b/i.test(userText2);
        if (isLocalPrefixed && !isLocalMkdirPrefixed) {
          isLocalExecIntent = true;
        }

        // 2. Natural language: "elimina/borra la carpeta X", "elimina el archivo Y"
        if (!isLocalExecIntent && /\b(?:elimina|eliminar|borra|borrar|delete|remove|quita|quitar)\s+(?:la\s+|el\s+)?(?:carpeta|archivo|folder|file|directorio)\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }

        // 3. Natural language: "lee/muéstrame/abre el archivo X" / "qué contiene X"
        if (!isLocalExecIntent && /\b(?:lee|leer|muestra|muéstrame|mostrar|abre|abrir|show|read|open|cat)\s+(?:el\s+)?(?:archivo|file|contenido)\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }
        if (!isLocalExecIntent && /\b(?:qué|que|what)\s+(?:contiene|tiene|hay\s+en|contains)\s+(?:el\s+)?(?:archivo)?\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }

        // 4. Natural language: "ejecuta/corre/run el comando X"
        if (!isLocalExecIntent && /\b(?:ejecuta|ejecutar|corre|correr|run|lanza|lanzar|execute)\s+(?:el\s+)?(?:comando|command)\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }
        if (!isLocalExecIntent && /\b(?:en\s+(?:la\s+)?terminal|in\s+(?:the\s+)?terminal)\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }
        if (!isLocalExecIntent && /\b(?:en\s+)?(?:bash|shell|terminal|consola)\s*[:\-]/i.test(userText2)) {
          isLocalExecIntent = true;
        }

        // 5. Natural language: sysinfo — "info del sistema" / "cuanta memoria" / "espacio en disco"
        if (!isLocalExecIntent && /\b(?:info(?:rmacion)?|información)\s+(?:del?\s+)?(?:sistema|equipo|computadora|mac|pc)\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }
        if (!isLocalExecIntent && /\b(?:cuanta|cuánta|how\s+much)\s+(?:memoria|ram|memory)\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }
        if (!isLocalExecIntent && /\b(?:espacio|space)\s+(?:en\s+)?(?:disco|disk)\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }

        // 6. Natural language: "crea un archivo X con el contenido Y"
        if (!isLocalExecIntent && /\b(?:crea|crear|make|create|genera)\s+(?:un\s+)?(?:archivo|file)\s+.+(?:con\s+(?:el\s+)?(?:contenido|texto|content)|que\s+(?:contenga|diga|tenga))\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }
        if (!isLocalExecIntent && /\b(?:escribe|escribir|guarda|guardar|write|save)\s+(?:en\s+)?(?:el\s+)?(?:archivo)?\b/i.test(userText2) && /[:\-]/i.test(userText2)) {
          isLocalExecIntent = true;
        }

        // 7. Natural language: "muéstrame los archivos de mi escritorio" / "lista las carpetas"
        if (!isLocalExecIntent && /\b(?:muestra|muéstrame|lista|listar|show|list)\s+(?:los\s+|las\s+)?(?:archivos|carpetas|files|folders|contenido)\s+(?:de|del|en|in|from)\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }
        if (!isLocalExecIntent && /\b(?:qué|que|what)\s+(?:hay|archivos|carpetas|files|folders)\s+(?:en|in|tengo\s+en)\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }

        // 8. Processes: "muéstrame los procesos" / "qué procesos están corriendo"
        if (!isLocalExecIntent && /\b(?:muestra|muéstrame|show|list|lista)\s+(?:los\s+)?(?:procesos|processes)\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }
        if (!isLocalExecIntent && /\b(?:procesos|processes)\s+(?:activos|running|corriendo|en\s+ejecución)\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }

        // 9. Kill: "mata el proceso X" / "kill process X"
        if (!isLocalExecIntent && /\b(?:mata|matar|kill|termina|terminar|detén|para|stop)\s+(?:el\s+)?(?:proceso|process)\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }

        // 10. Ports: "qué puertos están abiertos" / "puertos en uso"
        if (!isLocalExecIntent && /\b(?:puertos?|ports?)\s+(?:abiertos?|open|en\s+uso|in\s+use|listening|escuchando|activos)\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }
        if (!isLocalExecIntent && /\b(?:muestra|muéstrame|show|list|lista)\s+(?:los\s+)?(?:puertos|ports)\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }

        // 11. Git: "git status" / "haz un commit" / direct git commands
        if (!isLocalExecIntent && /^git\s+/i.test(userText2)) {
          isLocalExecIntent = true;
        }
        if (!isLocalExecIntent && /\b(?:haz|hacer|make|do)\s+(?:un\s+)?commit\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }
        if (!isLocalExecIntent && /\b(?:estado|status)\s+(?:del?\s+)?(?:repositorio|repo)\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }

        // 12. Docker: "docker ps" / "contenedores activos"
        if (!isLocalExecIntent && /^docker\s+/i.test(userText2)) {
          isLocalExecIntent = true;
        }
        if (!isLocalExecIntent && /\b(?:contenedores|containers)\s+(?:activos|running|corriendo)\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }

        // 13. Install: "instala express con npm" / "npm install X" / "pip install X"
        if (!isLocalExecIntent && /\b(?:instala|instalar|install)\s+.+\b(?:npm|pip|brew)\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }
        if (!isLocalExecIntent && /^(?:npm|pip|pip3|brew)\s+install\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }

        // 14. Script execution: "ejecuta el script test.py" / "corre main.js"
        if (!isLocalExecIntent && /\b(?:ejecuta|ejecutar|corre|correr|run)\s+(?:el\s+)?(?:script|archivo)\s+\S+\.\w{1,5}\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }

        // 15. Find files: "busca archivos .txt en mi escritorio"
        if (!isLocalExecIntent && /\b(?:busca|buscar|find|search)\s+(?:todos?\s+(?:los\s+)?)?(?:archivos|files)\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }

        // 16. Python/Node inline: "python: print(2+2)" / "node: console.log(2)"
        if (!isLocalExecIntent && /^(?:python3?|py|node|js)\s*[:\-]\s*.+/i.test(userText2)) {
          isLocalExecIntent = true;
        }

        // 17. cd: "ve a la carpeta X" / "cd /tmp" / "entra en el directorio X"
        if (!isLocalExecIntent && /^cd\s+\S+/i.test(userText2)) {
          isLocalExecIntent = true;
        }
        if (!isLocalExecIntent && /\b(?:ve|ir|entra|entrar|cambia|cambiar)\s+(?:a\s+(?:la\s+)?|en\s+(?:el\s+)?)(?:carpeta|directorio|folder|directory)\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }

        // 18. Direct tool commands: "npm list" / "pip list" / "brew list" / "git status" / "docker ps"
        if (!isLocalExecIntent && /^(?:npm|pip3?|brew|git|docker|python3?|node|bash|sh)\s+\S+/i.test(userText2)) {
          isLocalExecIntent = true;
        }

        // 19. Direct local utility commands: "pwd" / "history" / "top" / "du /tmp" / "which node" / "open /tmp"
        if (!isLocalExecIntent && /^(?:pwd|history|top|du|which|open|ps|ports|grep|find|tree|chmod|diff|kill)\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }

        // 20. Capability queries: "tienes acceso a mi terminal?" / "puedes ejecutar comandos?"
        if (!isLocalExecIntent && /\b(?:tienes|tiene|tenés)\s+(?:acceso|conexión|conexion)\b/i.test(userText2) && /\b(?:terminal|computadora|pc|mac|sistema|archivos|shell|consola|equipo|ordenador|laptop|máquina|maquina)\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }
        if (!isLocalExecIntent && /\b(?:puedes|puede|podés|podrías|podrias)\s+(?:acceder|ver|controlar|ejecutar|usar|manejar)\b/i.test(userText2) && /\b(?:terminal|computadora|pc|mac|sistema|archivos|shell|consola|equipo)\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }
        if (!isLocalExecIntent && /\b(?:qué|que|cuáles|cuales)\s+(?:capacidades|habilidades|poderes|funciones)\s+(?:tienes|tiene)\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }
        if (!isLocalExecIntent && /\b(?:can\s+you|do\s+you)\s+(?:access|control|use|run|execute)\s+(?:my|the)\s+(?:terminal|computer|system|files|shell)\b/i.test(userText2)) {
          isLocalExecIntent = true;
        }

        console.log("[LocalControl] isLocalExecIntent:", isLocalExecIntent, "| input:", userText2.slice(0, 80));

        if (isLocalExecIntent) {
          console.log("[LocalControl] ✅ INTERCEPTED — calling /api/local/exec");
          const userMsg: Message = {
            id: `user-${Date.now()}`,
            role: "user",
            content: userText2,
            timestamp: new Date(),
            requestId: generateRequestId(),
          };
          onSendMessage(userMsg);
          setInput("");

          try {
            const res = await apiFetch("/api/local/exec", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...getAnonUserIdHeader() },
              credentials: "include",
              body: JSON.stringify({ prompt: userText2, confirm: true }),
            });
            const data = await res.json();
            const assistantMsg: Message = {
              id: `assistant-${Date.now()}`,
              role: "assistant",
              content: data?.message || (data?.success ? "Listo." : `Error: ${data?.error || "error desconocido"}`),
              timestamp: new Date(),
              requestId: generateRequestId(),
            };
            onSendMessage(assistantMsg);
          } catch (error: any) {
            onSendMessage({
              id: `assistant-err-${Date.now()}`,
              role: "assistant",
              content: `Error al ejecutar comando local: ${error?.message || "error desconocido"}`,
              timestamp: new Date(),
              requestId: generateRequestId(),
            });
          }
          return;
        }
      }

      // FIX: Auto-generate a prompt when the user sends ONLY files without text.
      // The backend rejects empty message content even when attachments are present,
      // which causes files to "disappear" from the UI (already cleared) with no response.
      let autoPromptForFiles = "";
      if (!hasInput && hasFiles) {
        const filesRef = uploadedFilesRef.current;
        const hasImage = filesRef.some((f: any) => (f.type || "").startsWith("image/"));
        const hasDoc = filesRef.some((f: any) => !(f.type || "").startsWith("image/"));
        autoPromptForFiles = hasImage && !hasDoc
          ? "Describe la imagen adjunta."
          : hasDoc && !hasImage
            ? "Analiza los documentos adjuntos y resume lo importante."
            : "Analiza los archivos adjuntos y dime lo más importante.";
        console.log("[handleSubmit] No text provided with files, using auto-prompt:", autoPromptForFiles);
      }

      // EMERGENCY BYPASS (DEV-ONLY, DISABLED IN PROD): For simple text messages without files, go directly to streaming API
      // This bypasses normal chat_run creation and WILL break persistence/idempotency if enabled in prod.
      // Keep behind explicit flag for dev troubleshooting only.
      if (ENABLE_EMERGENCY_BYPASS && hasInput && !hasFiles && (!selectedTool || selectedTool === "web") && !selectedDocText) {
        console.error("[EMERGENCY BYPASS] Simple text message - going direct to API", selectedTool === "web" ? "(with web search)" : "");
        const userInput = input.trim();
        setInput("");

        // Track query for free users (upgrade prompt)
        incrementQuery();

        // Clear the web tool after use
        if (selectedTool === "web") {
          setSelectedTool(null);
        }

        // Show user message immediately
        const userMsgId = `user-${Date.now()}`;
        const userMessage: Message = {
          id: userMsgId,
          role: "user",
          content: selectedTool === "web" ? `🌐 ${userInput}` : userInput,
          timestamp: new Date(),
          requestId: `req_${Date.now()}`
        };
        // Show user message immediately (optimistic update) — BEFORE any async work
        setOptimisticMessages((prev: Message[]) => [...prev, userMessage]);
        onSendMessage(userMessage);

        // Stream the response using the all-in-one hook
        // Handles: fetch + SSE parsing + RAF-throttled updates + atomic finalize
        const isWebSearch = selectedTool === "web" || userInput.startsWith("🌐 ");
        const cleanInput = userInput.replace(/^🌐\s*/, "");

        const effectiveChatIdForStream = chatId && !chatId.startsWith("pending-") ? chatId : `chat_${Date.now()}`;
        if (chatId?.startsWith("pending-")) {
          window.dispatchEvent(new CustomEvent("select-chat", { detail: { chatId: effectiveChatIdForStream, preserveKey: true } }));
        }

        const streamResult = await streamChat.stream("/api/chat/stream", {
          chatId: effectiveChatIdForStream,
          body: {
            messages: [{ role: "user", content: cleanInput }],
            chatId: effectiveChatIdForStream,
            conversationId: effectiveChatIdForStream,
            model: selectedModel || "grok-3",
            forceWebSearch: isWebSearch,
            webSearchAuto: isWebSearch,
            latencyMode,
          },
          onEvent: (eventType, data) => {
            // Handle browser automation events from agent loop
            if (eventType === "tool_start" && data.toolName === "browse_and_act") {
              setAiStateForChat("agent_working", effectiveChatIdForStream);
              globalStartSseSession(data.args?.goal || "Automatización web");
              setIsBrowserOpen(true);
            } else if (eventType === "browser_step") {
              globalUpdateFromSseStep(data);
              setAiStateForChat("agent_working", effectiveChatIdForStream);
              if (!isBrowserOpen) setIsBrowserOpen(true);
            } else if (eventType === "tool_result" && data.toolName === "browse_and_act") {
              if (data.result?.success) {
                globalUpdateFromSseStep({
                  stepNumber: data.result.stepsCount || 0,
                  totalSteps: data.result.stepsCount || 0,
                  action: "done",
                  reasoning: "Tarea completada",
                  goalProgress: "100%",
                  screenshot: "",
                  url: "",
                  title: "",
                });
              }
            }
          },
          buildFinalMessage: (fullContent, _lastEvent, messageId) => ({
            id: messageId || `assistant-${Date.now()}`,
            role: "assistant",
            content: fullContent || "No se recibió respuesta del servidor.",
            timestamp: new Date(),
            userMessageId: userMsgId,
          }),
          buildErrorMessage: (_error, messageId) => ({
            id: messageId || `error-${Date.now()}`,
            role: "assistant",
            content: "Error de conexión. Por favor, verifica tu conexión e intenta de nuevo.",
            timestamp: new Date(),
          }),
        });
        if (streamResult.ok) requestTitleRefresh(effectiveChatIdForStream);
        return;
      }

      // Handle Agent mode - show in chat, not side panel
      if (selectedTool === "agent") {
        // Save files before clearing so we can restore on error
        const savedAgentFiles = [...uploadedFilesRef.current];
        try {
          const userMessageContent = input || autoPromptForFiles;
          const readyFiles = uploadedFilesRef.current.filter((f: any) => f.status === "ready");

          // Agent runner expects rich attachment metadata; include storagePath as both `storagePath` and `path`.
          const attachments = readyFiles
            .filter((f: any) => typeof f.id === "string" && f.id.length > 0 && !f.id.startsWith("temp-"))
            .map((f: any) => ({
              id: f.id,
              name: f.name,
              mimeType: f.type,
              type: f.type,
              storagePath: f.storagePath,
              path: f.storagePath,
              size: f.size,
              metadata: {
                spreadsheetData: f.spreadsheetData,
                analysisId: f.analysisId,
              },
            }));

          const messageAttachments = readyFiles
            .filter((f: any) => typeof f.id === "string" && f.id.length > 0 && !f.id.startsWith("temp-"))
            .map((f: any) => ({
              type: (f.type.startsWith("image/") ? "image" : "document") as "image" | "document",
              name: f.name,
              documentType: (() => {
                if (f.type.startsWith("image/")) return undefined;
                if (f.type.includes("pdf") || f.name.toLowerCase().endsWith(".pdf")) return "pdf";
                if (f.type.includes("sheet") || f.type.includes("excel") || f.type.includes("csv") || f.name.match(/\.(xlsx|xls|csv)$/i)) return "excel";
                if (f.type.includes("presentation") || f.type.includes("powerpoint") || f.name.match(/\.(pptx|ppt)$/i)) return "ppt";
                return "word";
              })() as "word" | "excel" | "ppt" | "pdf",
              mimeType: f.type,
              imageUrl: f.type.startsWith("image/") ? f.storagePath : undefined,
              storagePath: f.storagePath,
              fileId: f.id,
              spreadsheetData: f.spreadsheetData,
            }));

          // Generate a unique message ID for tracking in the store
          const agentMessageId = `agent-${Date.now()}`;
          setCurrentAgentMessageId(agentMessageId);

          // Add user message to chat via the callback
          const userMessage: Message = {
            id: `user-${Date.now()}`,
            role: "user",
            content: userMessageContent,
            timestamp: new Date(),
            requestId: generateRequestId(),
            skipRun: true, // Agent mode: persist message but don't create a normal chat run
            attachments: messageAttachments.length > 0 ? messageAttachments : undefined,
          };
          // Show message immediately (optimistic update)
          setOptimisticMessages((prev: Message[]) => [...prev, userMessage]);
          onSendMessage(userMessage);

          // Clear input IMMEDIATELY after capturing the value to prevent duplicates
          setInput("");
          setUploadedFiles([]);

          console.log("[Agent Mode] Starting run with input:", userMessageContent);

          // Use the store-based approach for starting the run
          // This will create the run in the store and start polling automatically
          const result = await startAgentRun(
            chatId || "",
            userMessageContent,
            agentMessageId,
            attachments
          );

          console.log("[Agent Mode] Run result:", result);

          if (result) {
            // Tool already cleared above; now clear selected tool
            setSelectedTool(null);

            // Navigate to new chat if created
            if (result.chatId && (!chatId || chatId.startsWith("pending-") || chatId === "")) {
              console.log("[Agent Mode] Navigating to chat:", result.chatId);
              window.dispatchEvent(new CustomEvent("select-chat", { detail: { chatId: result.chatId, preserveKey: true } }));
            }
            // Polling is handled automatically by useAgentPolling hook
          } else {
            // Show error when agent run fails to start
            console.error("[Agent Mode] Failed to start run, result is null");
            // Remove the optimistic message since the agent failed to start
            setOptimisticMessages((prev: Message[]) => prev.filter((m: Message) => m.id !== userMessage.id));
            toast({
              title: "Error",
              description: "No se pudo iniciar el agente. Por favor, inicia sesión para usar esta función.",
              variant: "destructive"
            });
          }
        } catch (error) {
          console.error("Failed to start agent run:", error);
          // Remove the optimistic message since the agent failed to start
          setOptimisticMessages((prev: Message[]) => prev.filter((m: Message) => !m.id.startsWith('user-')));
          // Restore files so user doesn't lose them
          if (savedAgentFiles.length > 0) {
            setUploadedFiles(savedAgentFiles);
          }
          toast({ title: "Error", description: "Error al iniciar el agente. Tus archivos fueron restaurados.", variant: "destructive" });
        }
        return;
      }

      // If there's selected text from document, rewrite it
      if (selectedDocText && applyRewriteRef.current && input.trim()) {
        const rewritePrompt = input.trim();
        setInput("");
        if (chatId) {
          clearDraft(chatId);
        }
        setAiStateForChat("thinking", submitConversationId);

        try {
          abortControllerRef.current = new AbortController();
          const response = await apiFetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getAnonUserIdHeader() },
            credentials: "include",
            body: JSON.stringify({
              messages: [{
                role: "user",
                content: `Reescribe el siguiente texto según esta instrucción: "${rewritePrompt}"\n\nTexto original:\n${selectedDocText}\n\nDevuelve SOLO el texto reescrito, sin explicaciones ni comentarios adicionales.`
              }],
              provider: selectedProvider,
              model: selectedModel
            }),
            signal: abortControllerRef.current.signal
          });

          const data = await response.json();
          if (response.ok && data.content) {
            applyRewriteRef.current(data.content.trim());
          }

          setSelectedDocText("");
          applyRewriteRef.current = null;
          setAiStateForChat("idle", submitConversationId);
          abortControllerRef.current = null;
          return;
        } catch (error: any) {
          if (error.name !== "AbortError") {
            console.error("Rewrite error:", error);
          }
          setAiStateForChat("idle", submitConversationId);
          abortControllerRef.current = null;
          return;
        }
      }

      // GENERATION INTENT DETECTION: Handle image, document, spreadsheet, presentation requests
      // These are handled directly by /api/chat + ProductionWorkflowRunner - no agent mode or SSE needed
      const generationPatterns = [
        /\b(crea|create|genera|generate|haz|make)\b.*\b(imagen|image|foto|photo|ilustración|illustration)\b/i,
        /\b(crea|create|genera|generate|haz|make)\b.*\b(documento|document|word|docx)\b/i,
        /\b(crea|create|genera|generate|haz|make)\b.*\b(excel|hoja de cálculo|spreadsheet|xlsx)\b/i,
        /\b(crea|create|genera|generate|haz|make)\b.*\b(presentación|presentation|ppt|powerpoint|slides|diapositivas)\b/i,
        /\b(crea|create|genera|generate|haz|make)\b.*\b(pdf)\b/i,
        /\b(cv|curriculum|resume|currículum|carta de presentación|cover letter)\b/i,
      ];

      const imageEditPatterns = [
        // Spanish - explicit image reference
        /\b(edita|modifica|cambia|ajusta|arregla)\s+(la\s+)?(última|anterior|esa|esta)\s*(imagen|foto)?/i,
        /\b(hazle|ponle|agrégale|quítale|añádele)\s+/i,
        /\bpon(le|er)?\s+/i,
        /\bagrega(r|le)?\s+(a\s+)?(la\s+)?imagen/i,
        /\bcambia(r|le)?\s+(a\s+)?(la\s+)?imagen/i,

        // Spanish - IMPLICIT edit commands (when there's a recent image, these imply editing it)
        /\bagrega\s+(a\s+)?[A-Z]/i,                   // "agrega a Cristiano", "agrega un árbol"
        /\bañade\s+(a\s+)?[A-Z]/i,                    // "añade a Messi"
        /\bpon\s+(a\s+)?[A-Z]/i,                      // "pon a Neymar"
        /\bquita(r)?\s+(a\s+)?[A-Z]/i,               // "quita a alguien"
        /\b(al\s+)?(costado|lado|fondo|frente)\b/i,   // "al costado", "al lado", "al fondo"
        /\b(en\s+el\s+)?(costado|lado|fondo|frente)\b/i,
        /\bcámbia(le|r)?\s+(el|la|los|las)\s+\w+/i,   // "cámbiale el color", "cambiar el fondo"
        /\bhaz(le|lo)?\s+más\s+\w+/i,                 // "hazlo más grande", "hazle más brillante"

        // English - explicit
        /\b(edit|modify|change|adjust|fix)\s+(the\s+)?(last|previous|that|this)\s*(image|photo)?/i,

        // English - implicit edit commands
        /\badd\s+[A-Z]/i,                             // "add Ronaldo", "add a tree"
        /\bput\s+[A-Z]/i,                             // "put Messi"
        /\bremove\s+[A-Z]/i,                          // "remove the person"
        /\b(on\s+the\s+)?(side|left|right|background|front)\b/i,
        /\bmake\s+(it|the\s+\w+)\s+more\s+\w+/i,      // "make it more colorful"
      ];

      const isGenerationRequest = generationPatterns.some(p => p.test(input));
      const hasEditPattern = imageEditPatterns.some(p => p.test(input));

      // IMPORTANT: When a doc tool is explicitly selected (Word/Excel/PPT), we bypass the legacy
      // generation pattern detection and use the new /api/chat/stream flow with docTool parameter,
      // which triggers production mode directly on the backend
      const hasDocToolSelected = selectedDocTool && ['word', 'excel', 'ppt'].includes(selectedDocTool);

      // When document files are attached, skip generation pattern detection entirely
      // to let the document analysis path (DATA_MODE / /api/analyze) handle them.
      const hasDocumentFiles = uploadedFilesRef.current.some(
        // Treat uploading/processing docs as present too; otherwise fast-submit can misroute into generation/edit mode.
        (f: any) => f?.status !== "error" && !(f.type || "").startsWith("image/")
      );

      if ((isGenerationRequest || hasEditPattern) && !hasDocToolSelected && !hasDocumentFiles) {
        console.log("[handleSubmit] Generation/Edit pattern detected - checking image context...");

        // Set thinking state
        setAiStateForChat("thinking", submitConversationId);
        setAiProcessStepsForChat([
          { step: "Procesando tu solicitud", status: "active" },
          { step: "Generando contenido", status: "pending" }
        ], submitConversationId);

        const generationInput = input;
        setInput("");
        if (chatId) {
          clearDraft(chatId);
        }

        // Start integrity computation immediately (parallel with render)
        const genIntegrityPromise = computePromptIntegrity(generationInput);
        const userMsgId = `temp-gen-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const genEncoder = new TextEncoder();
        const genPromptBytes = genEncoder.encode(generationInput);
        const genPromptMessageId = crypto.randomUUID?.() ?? `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        const userMsg: Message = {
          id: userMsgId,
          clientTempId: userMsgId,
          role: "user",
          content: generationInput,
          timestamp: new Date(),
          requestId: generateRequestId(),
          clientRequestId: generateClientRequestId(),
          status: "pending",
          deliveryStatus: "sending",
          deliveryError: undefined,
          clientPromptLen: genPromptBytes.byteLength,
          clientPromptHash: "",
          promptMessageId: genPromptMessageId,
        } as any;
        // Show message immediately (optimistic update) — ZERO async delay
        setOptimisticMessages((prev: Message[]) => [...prev, userMsg]);
        // Await hash (was computing in parallel) before server send
        try {
          const genIntegrity = await genIntegrityPromise;
          (userMsg as any).clientPromptHash = genIntegrity.clientPromptHash;
          (userMsg as any).clientPromptLen = genIntegrity.clientPromptLen;
        } catch {}
        const persistGenerationUserMessagePromise = onSendMessage(userMsg).catch((err) => {
          console.warn("[handleSubmit] Failed to persist generation user message:", err);
          return undefined;
        });

        try {
          // Only fetch image context if we have an edit pattern (not for generation-only requests)
          // This prevents misrouting generation requests like "agrega una conclusión" to image edit
          let lastImageBase64: string | null = null;
          let lastImageId: string | null = null;
          let isImageEditRequest = false;

          if (hasEditPattern) {
            console.log("[handleSubmit] Edit pattern detected - checking for image context...");

            // Strategy 1: Check local memory cache first (fastest)
            const lastImage = getLastGeneratedImage();
            if (lastImage?.base64) {
              lastImageBase64 = lastImage.base64;
              lastImageId = lastImage.artifactId || lastImage.messageId;
              console.log("[handleSubmit] Found last image in local memory:", lastImageId);
            } else if (lastImage?.previewUrl) {
              lastImageBase64 = await fetchImageAsBase64(lastImage.previewUrl);
              lastImageId = lastImage.artifactId || lastImage.messageId;
              console.log("[handleSubmit] Fetched last image base64 from local memory:", lastImageId);
            } else {
              // Strategy 2: Search visible messages for image artifacts (works after refresh)
              const messagesWithImages = messages.filter(m => m.artifact?.type === "image" && (m.artifact.previewUrl || m.artifact.downloadUrl));
              if (messagesWithImages.length > 0) {
                const lastImageMsg = messagesWithImages[messagesWithImages.length - 1];
                const imageUrl = lastImageMsg.artifact?.previewUrl || lastImageMsg.artifact?.downloadUrl;
                if (imageUrl) {
                  console.log("[handleSubmit] Found image in chat messages, fetching from URL:", imageUrl);
                  try {
                    lastImageBase64 = await fetchImageAsBase64(imageUrl);
                    lastImageId = lastImageMsg.artifact?.artifactId || lastImageMsg.id;
                    console.log("[handleSubmit] Fetched last image base64 from chat messages:", lastImageId);
                  } catch (fetchError) {
                    console.warn("[handleSubmit] Failed to fetch image from chat messages:", fetchError);
                  }
                }
              }

              // Strategy 3: Try server memory system (last resort)
              if (!lastImageBase64) {
                console.log("[handleSubmit] No local image, checking server memory...");
                try {
                  const serverImage = await getLatestImageFromServer();
                  if (serverImage?.base64Preview) {
                    lastImageBase64 = serverImage.base64Preview;
                    lastImageId = serverImage.id;
                    console.log("[handleSubmit] Found last image from server memory:", lastImageId);
                  } else if (serverImage?.imageUrl) {
                    lastImageBase64 = await fetchImageAsBase64(serverImage.imageUrl);
                    lastImageId = serverImage.id;
                    console.log("[handleSubmit] Fetched last image base64 from server:", lastImageId);
                  } else {
                    console.log("[handleSubmit] No images found in server memory");
                  }
                } catch (serverError) {
                  console.warn("[handleSubmit] Failed to get image from server:", serverError);
                }
              }
            }

            // Determine if this is an edit request based on whether we found an image
            const hasImageContext = !!lastImageBase64;
            isImageEditRequest = hasImageContext;

            // If we retrieved an image from server, persist it to local cache for future use
            if (lastImageBase64 && lastImageId && !getLastGeneratedImage()) {
              console.log("[handleSubmit] Persisting server image to local cache:", lastImageId);
              storeLastGeneratedImageInfo({
                messageId: lastImageId,
                base64: lastImageBase64,
                artifactId: lastImageId,
              });
            }

          }

          if (isImageEditRequest) {
            console.log("[handleSubmit] Image edit request confirmed with image context");
            // Update UI to reflect edit mode
            setAiProcessStepsForChat([
              { step: "Procesando edición de imagen", status: "active" },
              { step: "Editando imagen", status: "pending" }
            ], submitConversationId);
          }

          // Direct call to /api/chat/stream for generation - REAL-TIME SSE
          console.log("[handleSubmit] ⚡ Starting standard chat stream...");
          setAiProcessStepsForChat((prev: any[]) => prev.map((s: any, i: number) =>
            i === 0 ? { ...s, status: "done" as const } : { ...s, status: "active" as const }
          ), submitConversationId);

          // Ensure abort controller is active
          if (!abortControllerRef.current) {
            abortControllerRef.current = new AbortController();
          }

          try {
            const streamRunContext = buildStreamRunContext(userMsg);
            const fallbackChatId: string | null =
              latestChatIdRef.current || chatId || (await waitForActiveChatId());
            const effectiveChatIdForStream = resolveStreamChatId(undefined, fallbackChatId);
            if (!effectiveChatIdForStream) {
              toast({
                title: "Error",
                description: "No se pudo crear/confirmar el chat para generar contenido. Intenta de nuevo.",
                variant: "destructive",
                duration: 5000,
              });
              setAiStateForChat("idle", submitConversationId);
              setAiProcessStepsForChat([], submitConversationId);
              abortControllerRef.current = null;
              return;
            }

            const generationResult = await streamChat.stream("/api/chat/stream", {
              chatId: effectiveChatIdForStream,
              signal: abortControllerRef.current.signal,
              body: {
                messages: [...messages.map(m => ({ role: m.role, content: m.content })), { role: "user", content: generationInput }],
                chatId: effectiveChatIdForStream,
                conversationId: effectiveChatIdForStream,
                runId: streamRunContext.runId,
                clientRequestId: streamRunContext.clientRequestId,
                userRequestId: streamRunContext.userRequestId,
                provider: selectedProvider,
                model: selectedModel,
                lastImageBase64,
                lastImageId,
                latencyMode,
                // Prompt integrity metadata
                clientPromptLen: (userMsg as any).clientPromptLen,
                clientPromptHash: (userMsg as any).clientPromptHash,
                promptMessageId: (userMsg as any).promptMessageId,
              },
              onEvent: (eventType, data) => {
                if (eventType === "tool_start" && data.toolName === "browse_and_act") {
                  setAiStateForChat("agent_working", effectiveChatIdForStream);
                  setAiProcessStepsForChat([{
                    id: "init",
                    step: "init",
                    title: `Iniciando producción: ${data.topic || "Documento"}`,
                    status: "pending",
                    description: `Generando ${data.deliverables?.join(", ") || "archivos"}`,
                  }], effectiveChatIdForStream);
                } else if (eventType === "production_start") {
                  setAiStateForChat("agent_working", effectiveChatIdForStream);
                  setAiProcessStepsForChat([{
                    id: "init",
                    step: "init",
                    title: `Iniciando producción: ${data.topic || "Documento"}`,
                    status: "pending",
                    description: `Generando ${data.deliverables?.join(", ") || "archivos"}`
                  }], effectiveChatIdForStream);
                } else if (eventType === "production_event") {
                  setAiProcessStepsForChat((prev: any[]) => {
                    const newSteps = [...prev];
                    const lastStep = newSteps[newSteps.length - 1];
                    if (lastStep && lastStep.status === "pending" && data.message) {
                      // Update generic pending step
                      lastStep.title = data.message;
                    } else {
                      newSteps.push({
                        id: `step-${Date.now()}`,
                        title: data.message || "Procesando...",
                        status: "pending",
                        description: data.stage,
                      });
                    }
                    return newSteps;
                  }, effectiveChatIdForStream);
                } else if (eventType === "production_complete") {
                  setAiProcessStepsForChat((prev: any[]) => prev.map((s: any) => ({ ...s, status: "done" })), effectiveChatIdForStream);
                } else if (eventType === "tool_start") {
                  if (data.toolName === "browse_and_act") {
                    setAiStateForChat("agent_working", effectiveChatIdForStream);
                  }
                  setAiStateForChat("agent_working", effectiveChatIdForStream);
                  {
                    const toolLabels: Record<string, string> = {
                      bash: "Ejecutando comando...",
                      web_fetch: "Obteniendo página web...",
                      web_search: "Buscando en internet...",
                      read_file: "Leyendo archivo...",
                      write_file: "Escribiendo archivo...",
                      edit_file: "Editando archivo...",
                      list_files: "Listando archivos...",
                      grep_search: "Buscando en archivos...",
                      run_code: "Ejecutando código...",
                      browse_and_act: "Navegando en la web...",
                      process_list: "Listando procesos...",
                      port_check: "Verificando puertos...",
                      rag_index_document: "Indexando documento...",
                      openclaw_rag_search: "Buscando en base de conocimiento...",
                      fetch_url: "Obteniendo URL...",
                      analyze_data: "Analizando datos...",
                      generate_chart: "Generando gráfico...",
                      create_presentation: "Creando presentación...",
                      create_document: "Creando documento...",
                      memory_search: "Buscando en memoria...",
                    };
                    setAiProcessStepsForChat((prev: any[]) => {
                      const stepId = `tool-${data.toolName}-${data.iteration || Date.now()}`;
                      const exists = prev.find((s: any) => s.id === stepId);
                      if (exists) return prev;
                      return [...prev, {
                        id: stepId,
                        message: toolLabels[data.toolName] || `Using ${data.toolName}...`,
                        status: "active"
                      }];
                    }, effectiveChatIdForStream);
                  }
                } else if (eventType === "tool_status") {
                  if (data.toolName && data.status) {
                    setAiProcessStepsForChat((prev: any[]) =>
                      prev.map((s: any) =>
                        s.id?.startsWith(`tool-${data.toolName}`) ? { ...s, message: data.status, statusDetail: data.status } : s
                      ), effectiveChatIdForStream);
                  }
                } else if (eventType === "tool_result") {
                  setAiProcessStepsForChat((prev: any[]) =>
                    prev.map((s: any) =>
                      s.id?.startsWith(`tool-${data.toolName}`) ? { ...s, status: "done" } : s
                    ), effectiveChatIdForStream);
                }
              },
              onAiStateChange: (nextState) => {
                setAiStateForChat(nextState, effectiveChatIdForStream);
              },
              buildFinalMessage: (fullContent, data, messageId) => ({
                id: messageId || `assistant-${Date.now()}`,
                role: "assistant",
                content: fullContent || "No se recibió respuesta del servidor.",
                timestamp: new Date(),
                requestId: data?.requestId || generateRequestId(),
                userMessageId: userMsgId,
                artifact: data?.artifact,
                webSources: data?.webSources,
              }),
              buildErrorMessage: (_error, messageId) => ({
                id: messageId || `error-${Date.now()}`,
                role: "assistant",
                content: "Error de conexión. Por favor, intenta de nuevo.",
                timestamp: new Date(),
                requestId: generateRequestId(),
                userMessageId: userMsgId,
              }),
            });

            if (!generationResult.ok) {
              const quotaCode = (generationResult.error as any)?.payload?.code;
              if (generationResult.response?.status === 402 && quotaCode === "QUOTA_EXCEEDED") {
                const quota = (generationResult.error as any)?.payload?.quota;
                if (quota) {
                  setQuotaInfo(quota);
                  setShowPricingModal(true);
                  setAiStateForChat("idle", effectiveChatIdForStream);
                  setAiProcessStepsForChat([], effectiveChatIdForStream);
                  abortControllerRef.current = null;
                  return;
                }
              }
            } else {
              requestTitleRefresh(effectiveChatIdForStream);
            }
          } catch (error: any) {
            if (error.name === "AbortError") return;
            console.error("[Generation] Stream Error:", error);
            streamTransition.finalize({
              id: (Date.now() + 1).toString(),
              role: "assistant",
              content: error.message || "Error de conexión. Por favor, intenta de nuevo.",
              timestamp: new Date(),
              requestId: generateRequestId(),
              userMessageId: userMsgId,
            });
          } finally {
            abortControllerRef.current = null;
          }
        } catch (error) {
          console.error("[handleSubmit] Top-level error:", error);
          setAiStateForChat("idle", submitConversationId);
        }
        return;
      } // Close if ((isGenerationRequest ...


      // Check if this is a Super Agent research request with sources
      const effectiveInputForChecks = input || autoPromptForFiles;
      const superAgentCheck = shouldUseSuperAgent(effectiveInputForChecks);
      if (superAgentCheck.use) {
        console.log("[handleSubmit] Super Agent detected:", superAgentCheck.reason);

        const userInput = effectiveInputForChecks;
        const superAgentMessageId = `super-agent-${Date.now()}`;

        // Clear input immediately
        setInput("");
        if (chatId) {
          clearDraft(chatId);
        }
        setUploadedFiles([]);

        // Create user message
        const userMsgId = Date.now().toString();
        const userMessage: Message = {
          id: userMsgId,
          role: "user",
          content: userInput,
          timestamp: new Date(),
          requestId: generateRequestId(),
        };

        // Show user message immediately
        setOptimisticMessages((prev: Message[]) => [...prev, userMessage]);
        onSendMessage(userMessage);

        // Create assistant message placeholder for Super Agent display
        const assistantMessage: Message = {
          id: superAgentMessageId,
          role: "assistant",
          content: "",
          timestamp: new Date(),
          requestId: generateRequestId(),
          userMessageId: userMsgId,
          isThinking: true,
        };

        // Add assistant message that will show SuperAgentDisplay
        setOptimisticMessages((prev: Message[]) => [...prev, assistantMessage]);

        // Start Super Agent run in store
        const { startRun, updateState, completeRun } = useSuperAgentStore.getState();
        startRun(superAgentMessageId);

        // Generate run ID on frontend to enable immediate LiveExecutionConsole display
        const frontendRunId = `run_${crypto.randomUUID()}`;
        console.log('[uiPhase] runId created, uiPhase=console (immediate)', { runId: frontendRunId });

        // Set uiPhase to 'console' IMMEDIATELY (no grace window)
        // This ensures LiveExecutionConsole connects to SSE as soon as possible
        // to receive all events from the backend
        setUiPhase('console');

        setActiveRunId(frontendRunId);

        // Set up SSE stream by making POST request
        setAiStateForChat("thinking", submitConversationId);

        try {
          const response = await apiFetch("/api/super/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: userInput,
              session_id: superAgentMessageId,
              run_id: frontendRunId,
              options: {
                enforce_min_sources: true,
              },
            }),
          });

          if (!response.ok) {
            setActiveRunId(null);
            throw new Error(`Super Agent request failed: ${response.status}`);
          }

          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error("No response body reader");
          }

          const decoder = new TextDecoder();
          let buffer = "";
          let finalResult: SuperAgentFinal | null = null;
          let currentEventType = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (line.startsWith("event: ")) {
                currentEventType = line.slice(7).trim();
              } else if (line.startsWith("data: ")) {
                const jsonStr = line.slice(6);
                if (jsonStr === "[DONE]") continue;

                try {
                  const eventData = JSON.parse(jsonStr);
                  const eventType = currentEventType || eventData.type;

                  // Update store based on event type
                  const currentState = useSuperAgentStore.getState().runs[superAgentMessageId];
                  if (currentState) {
                    let updates: Partial<SuperAgentState> = {};

                    switch (eventType) {
                      case "contract":
                        updates = {
                          contract: eventData,
                          sourcesTarget: eventData.requirements?.min_sources || 100,
                          phase: "planning",
                        };
                        break;
                      case "production_start":
                        updates = {
                          phase: "planning",
                          contract: {
                            contract_id: eventData.runId,
                            intent: eventData.intent,
                            requirements: {
                              min_sources: 0,
                              must_create: eventData.deliverables || ["word"],
                              language: "es"
                            },
                            plan: [],
                            original_prompt: eventData.topic || ""
                          }
                        };
                        // Document Generation: Set blank page with generating status for any doc type
                        if (selectedDocTool && ['word', 'excel', 'ppt'].includes(selectedDocTool)) {
                          const deliverables = eventData.deliverables || [];
                          const deliverableMap: Record<string, string> = { word: 'word', excel: 'excel', ppt: 'ppt' };
                          const matchType = deliverableMap[selectedDocTool];
                          if (deliverables.includes(matchType) || deliverables.length === 0) {
                            setDocGenerationState({
                              status: 'generating',
                              progress: 0,
                              stage: 'Iniciando generación...',
                              downloadUrl: null,
                              fileName: null,
                              fileSize: null
                            });
                            // Clear editor content to show blank page
                            setEditedDocumentContent('');
                          }
                        }
                        break;
                      case "progress":
                        updates = {
                          phase: eventData.phase || currentState.phase,
                          progress: eventData,
                        };
                        break;
                      case "production_event":
                        const stageMap: Record<string, any> = {
                          init: "planning",
                          blueprint: "planning",
                          research: "signals",
                          writing: "creating",
                          review: "verifying",
                          render: "creating",
                          final: "finalizing"
                        };
                        const mappedPhase = stageMap[eventData.stage] || currentState.phase;
                        updates = {
                          phase: mappedPhase,
                          progress: {
                            phase: mappedPhase,
                            status: eventData.message,
                            collected: eventData.progress,
                            target: 100
                          }
                        };

                        // Document Generation: Update progress state for all doc types
                        if (selectedDocTool && ['word', 'excel', 'ppt'].includes(selectedDocTool)) {
                          const stageLabels: Record<string, string> = {
                            intake: "Procesando solicitud...",
                            blueprint: "Diseñando estructura...",
                            research: "Investigando contenido...",
                            analysis: "Analizando información...",
                            writing: "Redactando documento...",
                            qa: "Verificando calidad...",
                            consistency: "Validando consistencia...",
                            render: "Generando documento final..."
                          };
                          const progress = eventData.progress || 0;
                          setDocGenerationState((prev: any) => ({
                            ...prev,
                            status: 'generating',
                            progress,
                            stage: stageLabels[eventData.stage] || eventData.message || prev.stage
                          }));
                        }
                        break;
                      case "source_signal":
                        const existingIdx = currentState.sources.findIndex((s: any) => s.id === eventData.id);
                        if (existingIdx >= 0) {
                          const newSources = [...currentState.sources];
                          newSources[existingIdx] = eventData;
                          updates = { sources: newSources };
                        } else {
                          updates = { sources: [...currentState.sources, eventData] };
                        }
                        break;
                      case "source_deep":
                        const deepIdx = currentState.sources.findIndex((s: any) => s.id === eventData.id);
                        if (deepIdx >= 0) {
                          const newSources = [...currentState.sources];
                          newSources[deepIdx] = { ...newSources[deepIdx], ...eventData, fetched: true };
                          updates = { sources: newSources };
                        }
                        break;
                      case "artifact":
                        const artifactObj = {
                          id: eventData.id || `art_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                          type: eventData.type,
                          name: eventData.name || eventData.filename || "Documento",
                          downloadUrl: eventData.downloadUrl,
                          size: eventData.size
                        };
                        updates = {
                          artifacts: [...currentState.artifacts, artifactObj],
                          phase: "creating"
                        };

                        // Document Generation: Set ready status with download info for any doc type
                        const docTypeMap: Record<string, string> = { word: 'word', excel: 'excel', ppt: 'ppt', xlsx: 'excel', docx: 'word', pptx: 'ppt' };
                        const artifactDocType = docTypeMap[eventData.type] || eventData.type;
                        const selectedDocTypeNorm = selectedDocTool ? (docTypeMap[selectedDocTool] || selectedDocTool) : null;
                        if (selectedDocTypeNorm && artifactDocType === selectedDocTypeNorm) {
                          const defaultNames: Record<string, string> = { word: 'Documento.docx', excel: 'Hoja.xlsx', ppt: 'Presentación.pptx' };
                          setDocGenerationState({
                            status: 'ready',
                            progress: 100,
                            stage: '¡Documento listo!',
                            downloadUrl: eventData.downloadUrl || null,
                            fileName: eventData.filename || eventData.name || defaultNames[artifactDocType] || 'Documento',
                            fileSize: eventData.size || null
                          });
                        }
                        break;
                      case "verify":
                        updates = { verify: eventData, phase: "verifying" };
                        break;
                      case "final":
                        finalResult = eventData;
                        updates = {
                          final: eventData,
                          phase: "completed",
                          isRunning: false,
                        };
                        break;
                      case "production_complete":
                        const finalObj = {
                          response: eventData.summary,
                          sources_count: 0,
                          artifacts: currentState.artifacts,
                          duration_ms: 0,
                          iterations: 1
                        };
                        finalResult = finalObj;
                        updates = {
                          final: finalObj,
                          phase: "completed",
                          isRunning: false
                        };
                        break;
                      case "error":
                        updates = {
                          error: eventData.message || "Error en Super Agent",
                          phase: "error",
                          isRunning: false,
                        };
                        break;
                      case "production_error":
                        updates = {
                          error: eventData.error,
                          phase: "error",
                          isRunning: false
                        };
                        break;
                    }

                    if (Object.keys(updates).length > 0) {
                      updateState(superAgentMessageId, updates);
                    }
                  }
                } catch (parseError) {
                  console.warn("[Super Agent] Failed to parse SSE event:", parseError);
                }
              }
            }
          }

          // Stream completed - update assistant message with final content
          if (finalResult) {
            const finalAssistantMessage: Message = {
              id: superAgentMessageId,
              role: "assistant",
              content: finalResult.response,
              timestamp: new Date(),
              requestId: generateRequestId(),
              userMessageId: userMsgId,
            };

            // Update optimistic message
            setOptimisticMessages((prev: Message[]) =>
              prev.map((m: Message) => m.id === superAgentMessageId ? finalAssistantMessage : m)
            );
            onSendMessage(finalAssistantMessage);

            completeRun(superAgentMessageId, finalResult);
            setActiveRunId(null);
            setUiPhase('done');

            // Request AI-generated title refresh after Super Agent completes
            requestTitleRefresh(chatId);
          } else {
            // No final result — still reset UI to avoid stuck console state
            setActiveRunId(null);
            setUiPhase('idle');
          }

        } catch (error) {
          console.error("[Super Agent] Stream error:", error);
          updateState(superAgentMessageId, {
            error: error instanceof Error ? error.message : "Error de conexión",
            phase: "error",
            isRunning: false,
          });

          const errorMessage: Message = {
            id: superAgentMessageId,
            role: "assistant",
            content: "Error al procesar la investigación. Por favor, intenta de nuevo.",
            timestamp: new Date(),
            requestId: generateRequestId(),
            userMessageId: userMsgId,
          };

          setOptimisticMessages((prev: Message[]) =>
            prev.map((m: Message) => m.id === superAgentMessageId ? errorMessage : m)
          );
          onSendMessage(errorMessage);
          setActiveRunId(null);
          setUiPhase('idle');
        }

        setAiStateForChat("idle", submitConversationId);
        setAiProcessStepsForChat([], submitConversationId);
        return;
      }

      // -------------------------------------------------------------------------
      // 1. OPTIMISTIC UI: IMMEDIATE UPDATE (0ms LATENCY)
      // -------------------------------------------------------------------------
      // Capture state immediately — use auto-generated prompt if user sent only files
      const userInput = input || autoPromptForFiles;
      setContextNotice(null); // Clear any previous truncation notice
      let currentUploadedFiles = [...uploadedFilesRef.current];
      const userMsgId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const hasUnsettledUploadsAtSubmit = currentUploadedFiles.some(
        (f: UploadedFile) => isFileUploadBlockingSend(f)
      );
      const hadPendingUploadsAtSubmit =
        pendingUploadsRef.current.size > 0 || hasUnsettledUploadsAtSubmit;
      const failedUploadsAtSubmit = currentUploadedFiles.filter((f: any) => f?.status === "error");

      // Reset UI state immediately — save files for restoration on error
      let savedMainFiles = [...uploadedFilesRef.current];
      setInput("");
      if (chatId) clearDraft(chatId);
      // If uploads are still in flight, don't clear the composer file list yet or we lose upload progress updates.
      // We'll clear once uploads settle (after optimistic message is already on screen).
      if (!hadPendingUploadsAtSubmit) {
        // Clear all files from composer immediately after send to avoid stuck attachments.
        setUploadedFiles([]);
        if (failedUploadsAtSubmit.length > 0) {
          toast({
            title: "Archivo no adjuntado",
            description: `${failedUploadsAtSubmit.length} archivo(s) fallaron al subir y no se incluyeron en el mensaje.`,
            variant: "destructive",
            duration: 4500,
          });
        }
      }

      // Process attachments for message construction
      let attachments = currentUploadedFiles
        // For UI: include anything not in a terminal error state so the message shows files immediately.
        .filter((f: any) => f?.status !== "error")
        .map((f: any) => ({
          type: (f.type.startsWith("image/") ? "image" : "document") as "image" | "document",
          name: f.name,
          documentType: (() => {
            if (f.type.startsWith("image/")) return undefined;
            if (f.type.includes("pdf") || f.name.toLowerCase().endsWith(".pdf")) return "pdf";
            if (f.type.includes("sheet") || f.type.includes("excel") || f.type.includes("csv") || f.name.match(/\.(xlsx|xls|csv)$/i)) return "excel";
            if (f.type.includes("presentation") || f.type.includes("powerpoint") || f.name.match(/\.(pptx|ppt)$/i)) return "ppt";
            return "word"; // default to word for text/docs
          })() as "word" | "excel" | "ppt" | "pdf",
          mimeType: f.type,
          imageUrl: f.dataUrl,
          storagePath: f.storagePath,
          fileId: f.id,
          spreadsheetData: f.spreadsheetData,
        }));

      // Start integrity computation IMMEDIATELY (non-blocking promise)
      // but don't await it yet — render the optimistic message first
      const integrityPromise = computePromptIntegrity(userInput);

      // Construct the User Message object SYNCHRONOUSLY for instant render
      const msgRequestId = generateRequestId();
      const msgClientRequestId = generateClientRequestId();
      const encoder = new TextEncoder();
      const promptBytes = encoder.encode(userInput);
      const promptMessageId = crypto.randomUUID?.() ?? `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const userMsg: Message = {
        id: userMsgId,
        clientTempId: userMsgId,
        role: "user",
        content: userInput,
        timestamp: new Date(),
        requestId: msgRequestId,
        clientRequestId: msgClientRequestId,
        status: 'pending',
        deliveryStatus: "sending",
        deliveryError: undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
        clientPromptLen: promptBytes.byteLength,
        clientPromptHash: "",
        promptMessageId,
      } as any;

      // Apply Optimistic Update IMMEDIATELY — ZERO async delay
      const optimisticStart = import.meta.env.DEV && typeof performance !== "undefined" ? performance.now() : null;
      setOptimisticMessages((prev: Message[]) => [...prev, userMsg]);
      if (optimisticStart !== null) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            console.debug("[Perf] optimistic_render_ms", Math.max(0, performance.now() - optimisticStart).toFixed(1));
          });
        });
      }

      // Set initial AI state
      setAiStateForChat("thinking", submitConversationId);
      streamingContentRef.current = "";
      setStreamingContent("");

      // Now await the integrity hash (was computing in parallel during the render)
      // and patch the message BEFORE it gets sent to the server
      try {
        const integrity = await integrityPromise;
        (userMsg as any).clientPromptHash = integrity.clientPromptHash;
        (userMsg as any).clientPromptLen = integrity.clientPromptLen;
      } catch {}

      // Track document attachments for analysis (declared here to avoid TDZ with later reassignment)
      let hasDocumentAttachments = false;
      let documentAttachmentsForAnalysis: any[] = [];

      // If there are pending uploads, wait for them before kicking off any backend work.
      // The user message is already visible (optimistic), so this doesn't block perceived responsiveness.
      if (hadPendingUploadsAtSubmit) {
        await waitForPendingUploads();

        currentUploadedFiles = [...uploadedFilesRef.current];
        savedMainFiles = [...currentUploadedFiles]; // updated reference for error recovery
        const failedAfterWait = currentUploadedFiles.filter((f: any) => f?.status === "error");
        attachments = currentUploadedFiles
          .filter((f: any) => f.status === "ready" || f.status === "processing")
          .map((f: any) => ({
            type: (f.type.startsWith("image/") ? "image" : "document") as "image" | "document",
            name: f.name,
            documentType: (() => {
              if (f.type.startsWith("image/")) return undefined;
              if (f.type.includes("pdf") || f.name.toLowerCase().endsWith(".pdf")) return "pdf";
              if (f.type.includes("sheet") || f.type.includes("excel") || f.type.includes("csv") || f.name.match(/\.(xlsx|xls|csv)$/i)) return "excel";
              if (f.type.includes("presentation") || f.type.includes("powerpoint") || f.name.match(/\.(pptx|ppt)$/i)) return "ppt";
              return "word";
            })() as "word" | "excel" | "ppt" | "pdf",
            mimeType: f.type,
            imageUrl: f.dataUrl,
            storagePath: f.storagePath,
            fileId: f.id,
            spreadsheetData: f.spreadsheetData,
          }));

        const nextAttachments = attachments.length > 0 ? attachments : undefined;
        userMsg.attachments = nextAttachments;
        setOptimisticMessages((prev: Message[]) =>
          prev.map((m: Message) => (m.id === userMsgId ? { ...m, attachments: nextAttachments } : m))
        );

        // Now it's safe to clear successful uploads from the composer (uploads have reached a stable state).
        // By user requirement, we unconditionally clear ALL files from the composer so they don't get "stuck",
        // even if they failed. The user is notified via toast if anything failed.
        setUploadedFiles([]);
        if (failedAfterWait.length > 0) {
          toast({
            title: "Algunos archivos fallaron",
            description: `${failedAfterWait.length} archivo(s) no se pudieron subir y no se incluyeron en el mensaje.`,
            variant: "destructive",
            duration: 5000,
          });
        }

        hasDocumentAttachments = attachments.some((a: any) => isDocumentFile(a.mimeType || a.type, a.name, a.type));
        documentAttachmentsForAnalysis = attachments.filter((a: any) => isDocumentFile(a.mimeType || a.type, a.name, a.type));
      } else {
        // If there were no pending uploads at submit, files are already cleared from the UI.
        // Update savedMainFiles to empty so if standard chat streaming 
        // fails later, we don't accidentally restore files.
        savedMainFiles = [];
        hasDocumentAttachments = attachments.some((a: any) => isDocumentFile(a.mimeType || a.type, a.name, a.type));
        documentAttachmentsForAnalysis = attachments.filter((a: any) => isDocumentFile(a.mimeType || a.type, a.name, a.type));
      }

      if (hasDocumentAttachments && documentAttachmentsForAnalysis.length > 0) {
        void runDocumentAnalysisAsync({
          userMessageId: userMsgId,
          conversationId: chatId,
          history: [
            ...messages.map(m => ({
              role: m.role,
              content: m.content,
            })),
            { role: "user", content: userInput },
          ],
          attachments: documentAttachmentsForAnalysis,
          sourceLabel: "envío",
        }).catch((error) => {
          console.error("[handleSubmit] DATA_MODE: document analysis bootstrap failed:", error);
        });
      }

      // -------------------------------------------------------------------------
      // 2. ASYNC LOGIC (Agent Mode / Server Request)
      // -------------------------------------------------------------------------

      // Auto-detect if task requires Agent mode (only for non-generation complex tasks)
      // Use captured state (userInput, currentUploadedFiles) not component state
      const hasAttachedFiles = attachments.length > 0;
      const complexityCheck = shouldAutoActivateAgent(userInput, hasAttachedFiles);

      if (!isGenerationRequest && complexityCheck.agent_required && complexityCheck.confidence === 'high') {


        const readyFiles = currentUploadedFiles.filter((f: any) => f.status === "ready");
        const agentAttachments = readyFiles
          .filter((f: any) => typeof f.id === "string" && f.id.length > 0 && !f.id.startsWith("temp-"))
          .map((f: any) => ({
            id: f.id,
            name: f.name,
            mimeType: f.type,
            type: f.type,
            storagePath: f.storagePath,
            path: f.storagePath,
            size: f.size,
            metadata: {
              spreadsheetData: f.spreadsheetData,
              analysisId: f.analysisId,
            },
          }));

        const agentMessageId = `agent-${Date.now()}`;
        setCurrentAgentMessageId(agentMessageId);

        try {
          const result = await startAgentRun(
            chatId || "",
            userInput,
            agentMessageId,
            agentAttachments
          );

          if (result) {
            toast({
              title: "Modo Agente activado",
              description: complexityCheck.agent_reason || "Tarea compleja detectada",
              duration: 4000,
            });

            // Optimistic message already added above! just notify parent/server if needed
            onSendMessage({ ...userMsg, skipRun: true });

            setSelectedTool(null);
            if (result.chatId && (!chatId || chatId.startsWith("pending-") || chatId === "")) {
              window.dispatchEvent(new CustomEvent("select-chat", { detail: { chatId: result.chatId, preserveKey: true } }));
            }
          } else {
            // Agent failed - Fall through to normal chat processing

            // No need to reset input/files, as message is already "sent" optimistically. 
            // Just ensure onSendMessage runs below for the normal path.
            setCurrentAgentMessageId(null);
          }
        } catch (error) {
          console.error("Failed to auto-start agent run:", error);
          setCurrentAgentMessageId(null);
          // Fall through to normal chat
        }

        // Only return if agent succeeded (result is truthy)
        if (useAgentStore.getState().runs[agentMessageId]?.runId) {
          return;
        }
      }


      // Regular Chat Flow (or fallback from failed Agent Mode)
      // Reset uiPhase to 'idle' for regular (non-Super Agent) messages
      if (uiPhase !== 'idle') {

        setUiPhase('idle');
      }
      // Clear any pending uiPhase timer
      if (uiPhaseTimerRef.current) {
        clearTimeout(uiPhaseTimerRef.current);
        uiPhaseTimerRef.current = null;
      }

      // Initialize process steps based on context (reuse hasAttachedFiles from above)
      const initialSteps: { step: string; status: "pending" | "active" | "done" }[] = [];
      if (hasAttachedFiles) {
        initialSteps.push({ step: "Analizando archivos adjuntos", status: "active" });
      }
      initialSteps.push({ step: "Procesando tu mensaje", status: hasAttachedFiles ? "pending" : "active" });
      initialSteps.push({ step: "Buscando información relevante", status: "pending" });
      initialSteps.push({ step: "Generando respuesta", status: "pending" });
      setAiProcessStepsForChat(initialSteps, submitConversationId);

      // NOTE: Input/Files already reset and UserMessage already constructed above.

      console.log("[handleSubmit] sending user message:", userMsg, "chatId:", chatId);
      // Optimistic update ALREAD done. just send to parent/server.
      // onSendMessage calls useChats.addMessage which handles server request


      hasDocumentAttachments = attachments.some((a: any) => isDocumentFile(a.mimeType || a.type, a.name, a.type));
      documentAttachmentsForAnalysis = attachments.filter((a: any) =>
        isDocumentFile(a.mimeType || a.type, a.name, a.type)
      );

      // Send user message — await for NEW chats (need chatId), fire-and-forget for existing ones
      let sendMessageAck: SendMessageAck | undefined;
      try {
        const isNewChat = !chatId || chatId.startsWith("pending-");
        console.log("[handleSubmit] ABOUT TO CALL onSendMessage", isNewChat ? "(await — new chat, need chatId)" : "(fire-and-forget)");

        if (isNewChat) {
          // NEW CHAT: We MUST await to get the real chatId from the server.
          // Without this, the stream has no chatId and silently fails.
          try {
            sendMessageAck = await onSendMessage(userMsg);
            console.log("[handleSubmit] onSendMessage resolved for new chat:", sendMessageAck?.chatId);
          } catch (err) {
            console.warn("[handleSubmit] Failed to persist new chat message:", err);
          }
        } else {
          // EXISTING CHAT: Fire-and-forget for speed (chatId already known).
          onSendMessage(userMsg).catch((err) => {
            console.warn("[handleSubmit] Failed to persist user message (will still attempt streaming):", err);
            return undefined;
          });
        }

        // Start image detection early (runs in parallel with intent checks below).
        // Previously this was sequential AFTER onSendMessage, adding another 200-500ms.
        const isImageTool = selectedTool === "image";
        const shouldAutoDetectImage =
          !isImageTool && !selectedTool && !selectedDocTool && !hasAttachedFiles;
        const imageDetectController =
          shouldAutoDetectImage && typeof AbortController !== "undefined"
            ? new AbortController()
            : null;
        const imageDetectPromise: Promise<boolean> = (
          shouldAutoDetectImage
        )
          ? apiFetch("/api/image/detect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: userInput }),
            signal: imageDetectController?.signal ?? undefined,
          })
            .then(r => r.json())
            .then(d => !!d.isImageRequest)
            .catch(() => false)
          : Promise.resolve(!!isImageTool);

        // Check for Google Forms intent - ONLY trigger on HIGH confidence to prevent false positives
        const { hasMention, cleanPrompt } = extractMentionFromPrompt(userInput);
        const formIntent = detectFormIntent(cleanPrompt, isGoogleFormsActive, hasMention);

        // Only activate Google Forms on HIGH confidence (explicit mention or specific phrase match)
        if (formIntent.hasFormIntent && formIntent.confidence === 'high') {
          // Create file context from uploaded files
          if (currentUploadedFiles.length > 0) {
            // Add file context if files are present
            const fileContext = currentUploadedFiles
              .filter(f => f.content && f.status === "ready")
              .map(f => ({
                name: f.name,
                content: f.content || "",
                type: f.type
              }));

            // Create assistant message with inline form preview
            const formPreviewMsg: Message = {
              id: (Date.now() + 1).toString(),
              role: "assistant",
              content: "Creando formulario en base a tu solicitud...",
              timestamp: new Date(),
              requestId: generateRequestId(),
              userMessageId: userMsgId,
              googleFormPreview: {
                prompt: cleanPrompt,
                fileContext: fileContext.length > 0 ? fileContext : undefined,
                autoStart: true
              }
            };

            setOptimisticMessages((prev: Message[]) => [...prev, formPreviewMsg]);
            onSendMessage(formPreviewMsg);
            // Note: markRequestComplete is called inside addMessage after persistence
            setAiStateForChat("idle", submitConversationId);
            setAiProcessStepsForChat([], submitConversationId);
            return;
          }
        }

        // Check for Gmail intent
        const hasGmailMention = userInput.toLowerCase().includes('@gmail');
        const gmailIntent = detectGmailIntent(cleanPrompt, isGmailActive, hasGmailMention);

        if (gmailIntent.hasGmailIntent && gmailIntent.confidence !== 'low') {
          setAiStateForChat("thinking", submitConversationId);
          setAiProcessStepsForChat([
            { step: "Buscando en tu correo electrónico", status: "active" },
            { step: "Analizando correos encontrados", status: "pending" },
            { step: "Generando respuesta inteligente", status: "pending" }
          ], submitConversationId);

          try {
            const fullMessages = messages.map(m => ({ role: m.role, content: m.content }));
            fullMessages.push({ role: "user", content: cleanPrompt });
            const fallbackChatId: string | null =
              latestChatIdRef.current || chatId || (await waitForActiveChatId());
            const gmailConversationId = resolveStreamChatId(undefined, fallbackChatId);
            if (!gmailConversationId) {
              throw new Error("No se pudo confirmar la sesión del chat.");
            }

            const chatResponse = await apiFetch("/api/chat", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-client-send-ts": String(Date.now()),
                ...getAnonUserIdHeader(),
              },
              credentials: "include",
              body: JSON.stringify({
                messages: fullMessages,
                conversationId: gmailConversationId,
                useRag: true
              })
            });

            setAiProcessStepsForChat((prev: any[]) => prev.map((s: any, i: number) =>
              i === 0 ? { ...s, status: "done" as const } :
                i === 1 ? { ...s, status: "active" as const } : s
            ), gmailConversationId || submitConversationId);

            if (chatResponse.ok) {
              const data = await chatResponse.json();

              setAiProcessStepsForChat((prev: any[]) => prev.map((s: any) => ({ ...s, status: "done" as const })), gmailConversationId || submitConversationId);

              const gmailResponseMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: data.content || "No se pudo obtener una respuesta.",
                timestamp: new Date(),
                requestId: generateRequestId(),
                userMessageId: userMsgId,
                webSources: data.webSources,
              };
              setOptimisticMessages((prev: Message[]) => [...prev, gmailResponseMsg]);
              onSendMessage(gmailResponseMsg);
            } else {
              const gmailErrorMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: "❌ Error al analizar tus correos. Por favor, verifica que Gmail esté conectado e intenta de nuevo.",
                timestamp: new Date(),
                requestId: generateRequestId(),
                userMessageId: userMsgId
              };
              setOptimisticMessages((prev: Message[]) => [...prev, gmailErrorMsg]);
              onSendMessage(gmailErrorMsg);
            }
          } catch (error) {
            console.error("Gmail chat error:", error);
            const gmailErrorMsg: Message = {
              id: (Date.now() + 1).toString(),
              role: "assistant",
              content: "❌ Error al procesar tu solicitud de correos. Por favor, intenta de nuevo.",
              timestamp: new Date(),
              requestId: generateRequestId(),
              userMessageId: userMsgId
            };
            setOptimisticMessages((prev: Message[]) => [...prev, gmailErrorMsg]);
            onSendMessage(gmailErrorMsg);
          }

          setAiStateForChat("idle", submitConversationId);
          setAiProcessStepsForChat([], submitConversationId);
          return;
        }

        // Check if Excel is open and prompt is complex - route through orchestrator
        const isExcelEditorOpen = (activeDocEditorRef.current?.type === "excel") || (previewDocumentRef.current?.type === "excel");
        if (isExcelEditorOpen && isComplexExcelPrompt(cleanPrompt) && orchestratorRef.current) {
          setAiStateForChat("thinking", submitConversationId);
          setAiProcessStepsForChat([
            { step: "Analizando estructura del workbook", status: "active" },
            { step: "Creando hojas y datos", status: "pending" },
            { step: "Aplicando fórmulas y gráficos", status: "pending" }
          ], submitConversationId);

          try {
            await orchestratorRef.current.runOrchestrator(cleanPrompt);

            setAiProcessStepsForChat((prev: any[]) => prev.map((s: any) => ({ ...s, status: "done" as const })), submitConversationId);

            const orchestratorMsg: Message = {
              id: (Date.now() + 1).toString(),
              role: "assistant",
              content: "✅ Workbook generado exitosamente con múltiples hojas, datos, fórmulas y gráficos. Revisa el editor de Excel para ver los resultados.",
              timestamp: new Date(),
              requestId: generateRequestId(),
              userMessageId: userMsgId
            };
            setOptimisticMessages((prev: Message[]) => [...prev, orchestratorMsg]);
            onSendMessage(orchestratorMsg);
          } catch (err) {
            console.error("[Orchestrator] Error:", err);
            const errorMsg: Message = {
              id: (Date.now() + 1).toString(),
              role: "assistant",
              content: "❌ Error al generar el workbook. Por favor, intenta de nuevo.",
              timestamp: new Date(),
              requestId: generateRequestId(),
              userMessageId: userMsgId
            };
            setOptimisticMessages((prev: Message[]) => [...prev, errorMsg]);
            onSendMessage(errorMsg);
          }

          setAiStateForChat("idle", submitConversationId);
          setAiProcessStepsForChat([], submitConversationId);
          return;
        }

        try {
          abortControllerRef.current = new AbortController();

          // Await image detection with a strict timeout so chat streaming is not blocked.
          // If detection is slow, default to chat mode and continue immediately.
          const IMAGE_DETECT_TIMEOUT_MS = 180;
          const detectResult = await Promise.race<boolean | null>([
            imageDetectPromise,
            new Promise<boolean | null>((resolve) => setTimeout(() => resolve(null), IMAGE_DETECT_TIMEOUT_MS)),
          ]);
          const imageDetectTimedOut = detectResult === null;
          let shouldGenerateImage = detectResult ?? false;
          if (imageDetectTimedOut) {
            imageDetectController?.abort();
            console.debug("[Perf] image_detect_timeout_ms", IMAGE_DETECT_TIMEOUT_MS);
          }

          // If files are attached, log that we're skipping image detection
          if (hasAttachedFiles && !isImageTool) {
            console.log(`[ChatInterface] Files attached (${currentUploadedFiles.length}), skipping image auto-detection - will process as document analysis`);
          }

          // Generate image if needed
          if (shouldGenerateImage) {
            setIsGeneratingImage(true);
            setAiProcessStepsForChat([
              { step: "Analizando tu petición", status: "done" },
              { step: "Generando imagen con IA", status: "active" },
              { step: "Procesando resultado", status: "pending" }
            ], submitConversationId);

            try {
              const imageRes = await apiFetch("/api/image/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: userInput }),
                signal: abortControllerRef.current.signal
              });

              const imageData = await imageRes.json();

              if (imageRes.ok && imageData.success) {
                setAiProcessStepsForChat((prev: AiProcessStep[]) => prev.map((s: AiProcessStep) => ({ ...s, status: "done" as const })), submitConversationId);

                const msgId = (Date.now() + 1).toString();

                // Store image in separate memory store to prevent loss during localStorage sync
                storeGeneratedImage(msgId, imageData.imageData);

                // Track last generated image for edit operations
                storeLastGeneratedImageInfo({
                  messageId: msgId,
                  base64: imageData.imageData,
                  artifactId: imageData.artifactId || null,
                  previewUrl: imageData.previewUrl,
                });

                // Save generated image to user's library (fire and forget)
                if (user) {
                  apiFetch("/api/library", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({
                      mediaType: "image",
                      title: `Imagen generada - ${new Date().toLocaleDateString('es-ES')}`,
                      description: userInput.slice(0, 200),
                      storagePath: imageData.imageData,
                      mimeType: "image/png",
                      sourceChatId: chatId || null,
                      metadata: { prompt: userInput }
                    })
                  }).catch(err => console.error("Failed to save image to library:", err));
                }

                // Also store in local component state and ref for persistence across remounts
                const pendingImage = { messageId: msgId, imageData: imageData.imageData };
                setPendingGeneratedImage(pendingImage);
                latestGeneratedImageRef.current = pendingImage;

                const aiMsg: Message = {
                  id: msgId,
                  role: "assistant",
                  content: "Aquí está la imagen que generé basada en tu descripción:",
                  generatedImage: imageData.imageData,
                  timestamp: new Date(),
                  requestId: generateRequestId(),
                  userMessageId: userMsgId,
                };
                setOptimisticMessages((prev: Message[]) => [...prev, aiMsg]);
                onSendMessage(aiMsg);

                setIsGeneratingImage(false);
                setAiStateForChat("idle", submitConversationId);
                setAiProcessStepsForChat([], submitConversationId);
                setSelectedTool(null);
                abortControllerRef.current = null;
                return;
              } else {
                throw new Error(imageData.error || "Error al generar imagen");
              }
            } catch (imgError: any) {
              setIsGeneratingImage(false);
              if (imgError.name === "AbortError") {
                setAiStateForChat("idle", submitConversationId);
                setAiProcessStepsForChat([], submitConversationId);
                abortControllerRef.current = null;
                return;
              }
              // If image generation fails, continue with normal chat to explain
              console.error("Image generation failed:", imgError);
            }
          }

          // ── SSE STREAMING (runs for ALL messages, not just image fallback) ──
          {
            const fileContents = currentUploadedFiles
              .filter(f => f.content && f.status === "ready")
              .map(f => `[ARCHIVO ADJUNTO: "${f.name}"]\n${f.content}\n[FIN DEL ARCHIVO]`)
              .join("\n\n");

            const messageWithFiles = fileContents
              ? `${fileContents}\n\n[SOLICITUD DEL USUARIO]: ${userInput}`
              : userInput;

            const chatHistory = [...messages, { ...userMsg, content: messageWithFiles }].map(m => ({
              role: m.role,
              content: m.content
            }));

            // Extract image data URLs from current files
            // Only include images that successfully uploaded or are processing, so failed
            // local uploads don't secretly succeed in chat (causing severe UI/UX desync)
            const imageDataUrls = currentUploadedFiles
              .filter(f => f.type.startsWith("image/") && f.dataUrl && (f.status === "ready" || f.status === "processing"))
              .map(f => f.dataUrl as string);

            // Determine if we're in document mode for special AI behavior
            // Check both activeDocEditor and previewDocument for Excel mode
            const isDocumentMode = !!activeDocEditorRef.current || !!previewDocumentRef.current;
            const documentType = activeDocEditorRef.current?.type || previewDocumentRef.current?.type || null;
            const isFigmaMode = selectedDocTool === "figma";
            const isPptMode = documentType === "ppt";
            const isWordMode = documentType === "word";
            const isExcelMode = documentType === "excel";

            console.log('[ChatInterface] Document mode detection:', { isDocumentMode, documentType, isExcelMode, hasInsertFn: !!docInsertContentRef.current });

            // Check if document has existing content (not just placeholder)
            const currentDocContent = editedDocumentContent || "";
            const stripHtml = (html: string) => html.replace(/<[^>]*>/g, '').trim();
            const plainTextContent = stripHtml(currentDocContent);
            const placeholderPhrases = [
              "comienza a escribir tu documento aquí",
              "comienza a escribir",
              "escribe aquí"
            ];
            const isPlaceholder = placeholderPhrases.some(p =>
              plainTextContent.toLowerCase().includes(p)
            );
            // Any non-empty, non-placeholder content should be preserved
            const hasExistingContent = isWordMode && !isPlaceholder && plainTextContent.length > 0;

            // Build system prompt for Word document mode (cumulative - each response adds to document)
            let wordSystemPrompt = "";
            if (isWordMode) {
              if (hasExistingContent) {
                wordSystemPrompt = `Eres un asistente de edición de documentos. El usuario tiene un documento con contenido previo y quiere AÑADIR más contenido.

CONTEXTO DEL DOCUMENTO EXISTENTE (para referencia):
${plainTextContent.slice(0, 500)}${plainTextContent.length > 500 ? '...' : ''}

INSTRUCCIONES IMPORTANTES:
1. Genera SOLO el nuevo contenido que el usuario solicita
2. NO repitas ni incluyas el contenido existente del documento
3. Tu respuesta se AÑADIRÁ automáticamente al final del documento existente
4. Responde SOLO con el nuevo contenido en formato Markdown, sin explicaciones adicionales`;
              } else {
                wordSystemPrompt = `Eres un asistente de creación de documentos. Genera el contenido del documento según las instrucciones del usuario.
Responde SOLO con el contenido del documento en formato Markdown, sin explicaciones adicionales.`;
              }
            }

            // Build Excel system prompt for direct streaming to spreadsheet
            const excelSystemPrompt = `Eres un asistente de hojas de cálculo Excel. Genera datos estructurados en formato CSV.

FORMATO DE RESPUESTA:
- Para crear una nueva hoja: [NUEVA_HOJA:Nombre de la hoja]
- Datos en formato CSV con comas como separador
- Primera fila como encabezados
- Sin explicaciones, solo datos

EJEMPLO:
[NUEVA_HOJA:Ventas 2024]
Mes,Ventas,Crecimiento
Enero,15000,5%
Febrero,18000,20%
Marzo,22000,22%

IMPORTANTE:
- Responde SOLO con datos CSV, sin texto explicativo
- Usa comas como separador de columnas
- Cada fila en una línea separada
- Los datos numéricos sin formato de moneda (solo números)`;

            // Build chat history with appropriate system prompt
            let finalChatHistory: Array<{ role: string; content: string }> = chatHistory;
            if (isPptMode) {
              finalChatHistory = [{ role: "system", content: PPT_STREAMING_SYSTEM_PROMPT }, ...chatHistory];
            } else if (isExcelMode) {
              finalChatHistory = [{ role: "system", content: excelSystemPrompt }, ...chatHistory];
            } else if (isWordMode) {
              finalChatHistory = [{ role: "system", content: wordSystemPrompt }, ...chatHistory];
            }

            // Capture document mode state NOW using ref (avoids closure issues)
            // For Excel, also check previewDocument since Excel can be opened via preview
            const shouldWriteToDoc = !!activeDocEditorRef.current || (isExcelMode && !!docInsertContentRef.current);

            // Capture existing document HTML for cumulative mode (shared between SSE and legacy)
            // Note: currentDocContent is HTML from the editor
            const existingDocHTML = isWordMode && hasExistingContent ? currentDocContent : "";
            const separatorHTML = existingDocHTML ? '<hr class="my-4" />' : "";

            // Use latest available chatId for stream routing; fallback to resolved persistent id when available.
            const streamRunContext = buildStreamRunContext(userMsg, sendMessageAck);
            const ackChatId = sendMessageAck?.chatId || sendMessageAck?.run?.chatId;
            const fallbackChatId: string | null =
              ackChatId || latestChatIdRef.current || chatId || (await waitForActiveChatId());
            const effectiveStreamChatId = resolveStreamChatId(sendMessageAck, fallbackChatId);
            if (!effectiveStreamChatId) {
              toast({
                title: "Error",
                description: "No se pudo crear/confirmar el chat para enviar este mensaje. Intenta de nuevo.",
                variant: "destructive",
                duration: 5000,
              });
              setAiStateForChat("idle", submitConversationId);
              setAiProcessStepsForChat([], submitConversationId);
              abortControllerRef.current = null;
              return;
            }
            if (effectiveStreamChatId) {
              // DATA_MODE: Document analysis is already running via runDocumentAnalysisAsync.
              // Do NOT set aiState here — let runDocumentAnalysisAsync own the full lifecycle.
              // Setting "responding" here would overwrite the "idle" set by the analysis if it finishes fast.
              if (hasDocumentAttachments && documentAttachmentsForAnalysis.length > 0) {
                console.log("[handleSubmit] DATA_MODE (SSE): document attachments detected, async analysis owns aiState");
                return;
              }

              // SSE streaming mode - real-time streaming from server
              setAiStateForChat("responding", effectiveStreamChatId);

              // Update steps: mark processing done, searching active
              setAiProcessStepsForChat((prev: any[]) => prev.map((s: any) => {
                // Guard against undefined step or s
                if (!s || !s.step) return s;

                if (s.step.includes("Analizando")) return { ...s, status: "done" };
                if (s.step.includes("Procesando")) return { ...s, status: "done" };
                if (s.step.includes("Buscando")) return { ...s, status: "active" };
                return s;
              }), effectiveStreamChatId);

              let fullContent = "";
              let sseError: Error | null = null;

              // Build attachments array for streaming endpoint
              // FIX: Normalize type to match backend schema: "document" | "image" | "file"
              console.log("[handleSubmit] currentUploadedFiles:", currentUploadedFiles.map(f => ({
                id: f.id, name: f.name, type: f.type, status: f.status,
                storagePath: f.storagePath, hasContent: !!f.content,
              })));
              const streamAttachments = currentUploadedFiles
                .filter(f => f.status === "ready" || f.status === "processing")
                .map(f => ({
                  type: (f.type.startsWith("image/") ? "image" : "document") as "image" | "document",
                  name: f.name,
                  mimeType: f.type,
                  storagePath: f.storagePath,
                  fileId: f.id,
                  content: f.content,
                }));
              console.log("[handleSubmit] streamAttachments:", JSON.stringify(streamAttachments.map(a => ({
                type: a.type, name: a.name, mimeType: a.mimeType, storagePath: a.storagePath,
                fileId: a.fileId, hasContent: !!a.content,
              }))));

              if (import.meta.env.DEV) {
                chatLogger.debug("handleSubmit docTool", { selectedDocTool, isWordMode });
              }

              // NOTE: Previously there was a redundant raw `apiFetch("/api/chat/stream")` here
              // that sent a duplicate request before `streamChat.stream()`. This caused:
              //   1. Two concurrent LLM requests per message (double cost, double rate-limit usage)
              //   2. The first response body was never consumed (SSE stream abandoned)
              // Removed: the single `streamChat.stream()` call below handles everything.

              const firstImageDataUrl = imageDataUrls.length > 0 ? imageDataUrls[0] : undefined;
              const artifactTypeMap: Record<string, string> = { word: 'document', excel: 'spreadsheet', ppt: 'presentation', docx: 'document', xlsx: 'spreadsheet', pptx: 'presentation' };
              const artifactMimeTypeMap: Record<string, string> = {
                word: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                excel: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                ppt: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              };

              if (isPptMode && shouldWriteToDoc) {
                pptStreaming.startStreaming();
                streamingContentRef.current = "";
                setStreamingContent("");
              }

              const productionArtifacts: Array<{
                type: string;
                filename: string;
                downloadUrl: string;
                size?: number;
                library?: string;
              }> = [];
              const streamArtifactMimeTypes = new Map<string, string>();
              let streamWebSources: any[] | undefined;
              let streamSearchQueries: Array<{ query: string; resultCount: number; status: string }> = [];
              let streamTotalSearches = 0;
              let isProductionStream = false;
              let cerebroTimeline: any = { subtasks: [], judgeResult: null, evidence: [], budget: null, planTitle: "", isActive: false };

              const setAiStateForStream = (value: React.SetStateAction<AiState>) =>
                setAiStateForChat(value, effectiveStreamChatId);
              const setAiProcessStepsForStream = (value: React.SetStateAction<AiProcessStep[]>) =>
                setAiProcessStepsForChat(value, effectiveStreamChatId);

              const streamResult = await streamChat.stream("/api/chat/stream", {
                chatId: effectiveStreamChatId,
                signal: abortControllerRef.current?.signal,
                body: {
                  messages: finalChatHistory,
                  conversationId: effectiveStreamChatId,
                  chatId: effectiveStreamChatId,
                  runId: streamRunContext.runId,
                  clientRequestId: streamRunContext.clientRequestId,
                  userRequestId: userMsg.requestId,
                  attachments: streamAttachments.length > 0 ? streamAttachments : undefined,
                  // Send image base64 directly for vision fallback if storagePath resolution fails
                  lastImageBase64: firstImageDataUrl,
                  docTool: selectedDocTool || null,
                  provider: selectedProvider,
                  model: selectedModel,
                  latencyMode,
                  // Prompt integrity metadata for server-side verification
                  clientPromptLen: (userMsg as any).clientPromptLen,
                  clientPromptHash: (userMsg as any).clientPromptHash,
                  promptMessageId: (userMsg as any).promptMessageId,
                },
                onAiStateChange: (nextState) => setAiStateForStream(nextState),
                onEvent: (eventType, data) => {
                  // Handle context truncation/compression notices
                  if (eventType === "notice" && data?.type === "context_truncated") {
                    setContextNotice({
                      type: data.type,
                      originalTokens: data.originalTokens,
                      finalTokens: data.finalTokens,
                      droppedMessages: data.droppedMessages,
                    });
                    return;
                  }

                  // Handle low-confidence prompt notice
                  if (eventType === "notice" && data?.type === "low_confidence_prompt") {
                    setContextNotice({
                      type: data.type,
                      originalTokens: 0,
                      finalTokens: 0,
                      droppedMessages: 0,
                      ...data,
                    });
                    return;
                  }

                  if (eventType === "production_start") {
                    isProductionStream = true;
                    setAiStateForStream("agent_working");
                    if (selectedDocTool && ['word', 'excel', 'ppt'].includes(selectedDocTool)) {
                      setDocGenerationState({
                        status: 'generating',
                        progress: 0,
                        stage: data?.topic || 'Iniciando generación...',
                        downloadUrl: null,
                        fileName: null,
                        fileSize: null,
                      });
                      setEditedDocumentContent('');
                    }
                    return;
                  }

                  if (eventType === "production_event") {
                    if (selectedDocTool && ['word', 'excel', 'ppt'].includes(selectedDocTool)) {
                      const stageLabels: Record<string, string> = {
                        intake: "Procesando solicitud...",
                        blueprint: "Diseñando estructura...",
                        research: "Investigando contenido...",
                        analysis: "Analizando información...",
                        writing: "Redactando documento...",
                        data: "Procesando datos...",
                        slides: "Creando diapositivas...",
                        qa: "Verificando calidad...",
                        consistency: "Validando consistencia...",
                        render: "Generando documento final...",
                      };
                      setDocGenerationState((prev: any) => ({
                        ...prev,
                        status: 'generating',
                        progress: data?.progress || prev.progress,
                        stage: stageLabels[data?.stage] || data?.message || prev.stage,
                      }));
                    }
                    return;
                  }

                  if (eventType === "production_complete") {
                    isProductionStream = true;
                    setDocGenerationState((prev: any) => ({
                      ...prev,
                      status: 'complete',
                      progress: 100,
                      stage: data?.summary || prev.stage || '¡Documento listo!',
                    }));
                    return;
                  }

                  if (eventType === "artifact") {
                    productionArtifacts.push({
                      type: data?.type || "document",
                      filename: data?.filename || "Documento",
                      downloadUrl: data?.downloadUrl || "",
                      size: data?.size,
                      library: data?.library,
                    });
                    if (data?.type) {
                      streamArtifactMimeTypes.set(String(data.type), artifactMimeTypeMap[data.type] || data?.mimeType || "application/octet-stream");
                    }
                    if (selectedDocTool && ['word', 'excel', 'ppt'].includes(selectedDocTool)) {
                      const docTypeMap: Record<string, string> = { word: 'word', excel: 'excel', ppt: 'ppt', xlsx: 'excel', docx: 'word', pptx: 'ppt' };
                      const artifactDocType = docTypeMap[data?.type] || String(data?.type || "");
                      const selectedDocTypeNorm = docTypeMap[selectedDocTool] || selectedDocTool;
                      if (artifactDocType === selectedDocTypeNorm) {
                        setDocGenerationState({
                          status: 'ready',
                          progress: 100,
                          stage: data?.summary || '¡Documento listo!',
                          downloadUrl: data?.downloadUrl || null,
                          fileName: data?.filename || data?.name || 'Documento',
                          fileSize: data?.size || null,
                        });
                      }
                    }
                    return;
                  }

                  if (eventType === "plan") {
                    setAiStateForStream("agent_working");
                    if (Array.isArray(data?.steps)) {
                      setAiProcessStepsForStream(data.steps.map((s: any) => ({
                        id: s.id,
                        message: s.label,
                        status: s.status || "pending",
                      })));
                    }
                    return;
                  }

                  if (eventType === "exec_plan_update") {
                    setAiProcessStepsForStream((prev: any[]) =>
                      prev.map((s: any) => {
                        if (s.id === data?.stepId) return { ...s, status: data.status };
                        if (s.id === data?.previousStepId && data?.previousStatus) return { ...s, status: data.previousStatus };
                        return s;
                      })
                    );
                    return;
                  }

                  if (eventType === "tool_start" && data?.toolName === "browse_and_act") {
                    setAiStateForStream("agent_working");
                    setIsBrowserOpen(true);
                    globalStartSseSession(data?.args?.goal || "Automatización web");
                    return;
                  }

                  if (eventType === "browser_step") {
                    setAiStateForStream("agent_working");
                    if (!isBrowserOpen) setIsBrowserOpen(true);
                    globalUpdateFromSseStep(data);
                    return;
                  }

                  if (eventType === "tool_result" && data?.toolName === "browse_and_act") {
                    if (data?.result?.success) {
                      globalUpdateFromSseStep({
                        stepNumber: data.result.stepsCount || 0,
                        totalSteps: data.result.stepsCount || 0,
                        action: "done",
                        reasoning: "Tarea completada",
                        goalProgress: "100%",
                        screenshot: "",
                        url: "",
                        title: "",
                      });
                    }
                    return;
                  }

                  if (eventType === "tool_start") {
                    setAiStateForStream("agent_working");
                    const toolLabels: Record<string, string> = {
                      bash: "Ejecutando comando...",
                      web_fetch: "Obteniendo página web...",
                      web_search: "Buscando en internet...",
                      read_file: "Leyendo archivo...",
                      write_file: "Escribiendo archivo...",
                      edit_file: "Editando archivo...",
                      list_files: "Listando archivos...",
                      grep_search: "Buscando en archivos...",
                      run_code: "Ejecutando código...",
                      browse_and_act: "Navegando en la web...",
                      process_list: "Listando procesos...",
                      port_check: "Verificando puertos...",
                      rag_index_document: "Indexando documento...",
                      openclaw_rag_search: "Buscando en base de conocimiento...",
                      fetch_url: "Obteniendo URL...",
                      analyze_data: "Analizando datos...",
                      generate_chart: "Generando gráfico...",
                      create_presentation: "Creando presentación...",
                      create_document: "Creando documento...",
                      memory_search: "Buscando en memoria...",
                    };
                    setAiProcessStepsForStream((prev: any[]) => {
                      const stepId = `tool-${data.toolName}-${data.iteration || Date.now()}`;
                      const exists = prev.find((s: any) => s.id === stepId);
                      if (exists) return prev;
                      return [...prev, {
                        id: stepId,
                        message: data?.message || toolLabels[data?.toolName] || `Usando ${data?.toolName}...`,
                        status: "active"
                      }];
                    });
                    return;
                  }

                  if (eventType === "tool_result") {
                    setAiProcessStepsForStream((prev: any[]) =>
                      prev.map((s: any) =>
                        s.id?.startsWith(`tool-${data?.toolName}`) ? { ...s, status: "done" } : s
                      ));
                    return;
                  }

                  if (eventType === "context") {
                    setAiStateForStream("responding");
                    if (data?.isAgenticMode === true) {
                      setAiProcessStepsForStream((prev: any[]) => prev.map((s: any) => ({ ...s, status: "done" })));
                    }
                    if (Array.isArray(data?.webSources)) {
                      streamWebSources = data.webSources;
                    }
                    return;
                  }

                  if (eventType === "search_progress") {
                    const current = data?.current || 0;
                    const total = data?.total || 0;
                    const sourcesFound = data?.sourcesFound || 0;
                    streamTotalSearches = total;
                    if (data?.completed && Array.isArray(data?.queryLog)) {
                      streamSearchQueries = data.queryLog;
                    }
                    setAiProcessStepsForStream((prev: any[]) => {
                      const searchStepId = "deep-search-progress";
                      const existing = prev.find((s: any) => s.id === searchStepId);
                      const label = data?.completed
                        ? `✓ ${sourcesFound} fuentes encontradas en ${total} búsquedas`
                        : `Buscando: ${current} de ${total} consultas (${sourcesFound} fuentes)`;
                      const step = {
                        id: searchStepId,
                        step: label,
                        status: data?.completed ? "done" : "active",
                      };
                      if (existing) {
                        return prev.map((s: any) => s.id === searchStepId ? step : s);
                      }
                      return [...prev, step];
                    });
                    return;
                  }

                  if (eventType === "thinking") {
                    setAiStateForStream("agent_working");
                    if (data?.step && data?.message) {
                      const isInferenceStep = String(data.step).startsWith("inference_");
                      if (isInferenceStep) {
                        setAiProcessStepsForStream((prev: any[]) => {
                          const filtered = prev.filter((s: any) => !s.id?.startsWith("inference_"));
                          return [...filtered, {
                            id: data.step,
                            message: data.message,
                            status: "active",
                          }];
                        });
                      } else {
                        setAiProcessStepsForStream((prev: any[]) => {
                          const exists = prev.find((s: any) => s.id === data.step);
                          if (exists) return prev.map((s: any) => s.id === data.step ? { ...s, message: data.message, status: "active" } : s);
                          return [...prev, {
                            id: data.step,
                            message: data.message,
                            status: "active",
                          }];
                        });
                      }
                    }
                    return;
                  }

                  if (eventType === "intent") {
                    console.log('[SSE] Intent:', data?.intent, data?.confidence);
                  }

                  if (eventType === "plan_update") {
                    cerebroTimeline.isActive = true;
                    if (data?.title) cerebroTimeline.planTitle = data.title;
                    if (data?.subtasks) {
                      cerebroTimeline.subtasks = data.subtasks.map((st: any) => ({
                        id: st.id, title: st.title, description: st.description,
                        status: st.status || "pending", priority: st.priority,
                        dependencies: st.dependencies, toolCalls: st.toolCalls || [],
                        retryCount: st.retryCount || 0,
                      }));
                    }
                    return;
                  }
                  if (eventType === "subtask_start") {
                    cerebroTimeline.subtasks = cerebroTimeline.subtasks.map((s: any) =>
                      s.id === data?.subtaskId ? { ...s, status: "running", startedAt: Date.now() } : s
                    );
                    return;
                  }
                  if (eventType === "subtask_complete") {
                    cerebroTimeline.subtasks = cerebroTimeline.subtasks.map((s: any) =>
                      s.id === data?.subtaskId ? { ...s, status: data?.success ? "done" : "failed", completedAt: Date.now(), toolCalls: data?.toolCalls || s.toolCalls } : s
                    );
                    return;
                  }
                  if (eventType === "critic_result") {
                    cerebroTimeline.subtasks = cerebroTimeline.subtasks.map((s: any) =>
                      s.id === data?.subtaskId ? {
                        ...s,
                        criticResult: { verdict: data.verdict, reason: data.reason, scores: data.scores },
                        status: data.verdict === "retry" ? "retrying" : data.verdict === "backtrack" ? "failed" : s.status,
                        retryCount: data.verdict === "retry" ? (s.retryCount || 0) + 1 : s.retryCount,
                      } : s
                    );
                    return;
                  }
                  if (eventType === "judge_verdict") {
                    cerebroTimeline.judgeResult = { verdict: data.verdict, confidence: data.confidence, reason: data.reason, subtaskResults: data.subtaskResults };
                    cerebroTimeline.isActive = false;
                    return;
                  }
                  if (eventType === "budget_update") {
                    cerebroTimeline.budget = {
                      tokensUsed: data?.tokensUsed || 0, tokenLimit: data?.tokenLimit || 100000,
                      estimatedCost: data?.estimatedCost || 0, costCeiling: data?.costCeiling,
                      budgetRemainingPercent: data?.budgetRemainingPercent ?? 100,
                      duration: data?.duration, toolsUsedCount: data?.toolsUsedCount,
                    };
                    return;
                  }
                  if (eventType === "evidence_update") {
                    if (Array.isArray(data?.citations)) {
                      cerebroTimeline.evidence = data.citations.map((c: any) => ({
                        id: c.id || String(Math.random()), source: c.source,
                        chunkIndex: c.chunkIndex, relevanceScore: c.relevanceScore ?? 0,
                        snippet: c.snippet || "", url: c.url,
                      }));
                    }
                    return;
                  }
                },
                onChunk: (chunk, _chunkEventData, fullContent) => {
                  if (isPptMode && shouldWriteToDoc) {
                    pptStreaming.processChunk(chunk);
                    return false;
                  }

                  if (isExcelMode && shouldWriteToDoc) {
                    streamingContentRef.current = fullContent;
                    setStreamingContent(fullContent);
                    return true;
                  }

                  if (isWordMode && shouldWriteToDoc && docInsertContentRef.current) {
                    try {
                      const newContentHTML = markdownToTipTap(fullContent);
                      const cumulativeHTML = existingDocHTML + separatorHTML + newContentHTML;
                      docInsertContentRef.current(cumulativeHTML, 'html');
                      setEditedDocumentContent(cumulativeHTML);
                    } catch (err) {
                      console.error('[ChatInterface] Error streaming to document:', err);
                    }
                    return false;
                  }

                  streamingContentRef.current = fullContent;
                  setStreamingContent(fullContent);
                  return true;
                },
                buildFinalMessage: (fullContent, data, messageId) => {
                  const uncertainty = (!isProductionStream && !isWordMode && !isExcelMode && !isPptMode)
                    ? detectUncertainty(fullContent)
                    : null;

                  if (isProductionStream && productionArtifacts.length > 0) {
                    const primaryArtifact = productionArtifacts[0];
                    const type = artifactTypeMap[primaryArtifact.type] || primaryArtifact.type || "document";
                    const typeConfirm: Record<string, string> = { word: 'Documento generado correctamente', excel: 'Hoja de cálculo generada correctamente', presentation: 'Presentación generada correctamente', ppt: 'Presentación generada correctamente', doc: 'Documento generado correctamente', spreadsheet: 'Hoja de cálculo generada correctamente' };
                    const friendlyType = selectedDocTool || 'word';
                    const messageContent = `✓ ${typeConfirm[friendlyType] || 'Documento generado correctamente'}`;
                    const artifactMimeType = primaryArtifact.type ? (artifactMimeTypeMap[primaryArtifact.type] || streamArtifactMimeTypes.get(primaryArtifact.type) || "application/octet-stream") : "application/octet-stream";
                    const artifactName = primaryArtifact.filename || `${friendlyType}.${friendlyType === "word" ? "docx" : friendlyType === "excel" ? "xlsx" : friendlyType === "ppt" ? "pptx" : "bin"}`;

                    return {
                      id: messageId || `assistant-${Date.now()}`,
                      role: "assistant",
                      content: messageContent,
                      timestamp: new Date(),
                      requestId: data?.requestId || generateRequestId(),
                      userMessageId: userMsgId,
                      artifact: {
                        artifactId: `${messageId || Date.now()}_${friendlyType}`,
                        type: type,
                        mimeType: artifactMimeType,
                        sizeBytes: primaryArtifact.size,
                        downloadUrl: primaryArtifact.downloadUrl,
                        name: artifactName,
                        filename: artifactName,
                      } as Message["artifact"],
                    };
                  }

                  if (isPptMode && shouldWriteToDoc && !isProductionStream) {
                    pptStreaming.stopStreaming();
                    return {
                      id: messageId || `assistant-${Date.now()}`,
                      role: "assistant",
                      content: "✓ Presentación generada correctamente",
                      timestamp: new Date(),
                      requestId: data?.requestId || generateRequestId(),
                      userMessageId: userMsgId,
                    };
                  }

                  if (isExcelMode && shouldWriteToDoc && docInsertContentRef.current && !isProductionStream) {
                    if (docInsertContentRef.current) {
                      try {
                        streamingContentRef.current = "";
                        setStreamingContent("");
                        docInsertContentRef.current(fullContent);
                      } catch (err) {
                        console.error('[ChatInterface] Error streaming to Excel:', err);
                      }
                    }
                    return {
                      id: messageId || `assistant-${Date.now()}`,
                      role: "assistant",
                      content: "✓ Datos generados en la hoja de cálculo",
                      timestamp: new Date(),
                      requestId: data?.requestId || generateRequestId(),
                      userMessageId: userMsgId,
                    };
                  }

                  if (isWordMode && shouldWriteToDoc && docInsertContentRef.current && !isProductionStream) {
                    if (docInsertContentRef.current) {
                      try {
                        const newContentHTML = markdownToTipTap(fullContent);
                        const cumulativeHTML = existingDocHTML + separatorHTML + newContentHTML;
                        docInsertContentRef.current(cumulativeHTML, 'html');
                        setEditedDocumentContent(cumulativeHTML);
                      } catch (err) {
                        console.error('[ChatInterface] Error finalizing document:', err);
                      }
                    }
                    return {
                      id: messageId || `assistant-${Date.now()}`,
                      role: "assistant",
                      content: "✓ Documento generado correctamente",
                      timestamp: new Date(),
                      requestId: data?.requestId || generateRequestId(),
                      userMessageId: userMsgId,
                    };
                  }

                  const finalMsg: any = {
                    id: messageId || `assistant-${Date.now()}`,
                    role: "assistant",
                    content: fullContent || "No se recibió respuesta del servidor.",
                    timestamp: new Date(),
                    requestId: data?.requestId || generateRequestId(),
                    userMessageId: userMsgId,
                    confidence: uncertainty?.confidence,
                    uncertaintyReason: uncertainty?.reason,
                    webSources: data?.webSources || streamWebSources,
                    searchQueries: streamSearchQueries.length > 0 ? streamSearchQueries : undefined,
                    totalSearches: streamTotalSearches > 0 ? streamTotalSearches : undefined,
                  };
                  if (cerebroTimeline.subtasks.length > 0 || cerebroTimeline.judgeResult || cerebroTimeline.budget) {
                    finalMsg.cerebroTimeline = { ...cerebroTimeline };
                  }
                  return finalMsg;
                },
                buildErrorMessage: (error, messageId) => ({
                  id: messageId || `error-${Date.now()}`,
                  role: "assistant",
                  content: error?.message || "Error de conexión. Por favor, intenta de nuevo.",
                  timestamp: new Date(),
                  requestId: generateRequestId(),
                  userMessageId: userMsgId,
                }),
              });

              if (streamResult.ok) {
                requestTitleRefresh(effectiveStreamChatId);
              } else {
                if (streamResult.response?.status === 402 && (streamResult.error as any)?.payload?.code === "QUOTA_EXCEEDED") {
                  const quota = (streamResult.error as any)?.payload?.quota;
                  if (quota) {
                    setQuotaInfo(quota);
                    setShowPricingModal(true);
                  }
                }
              }
              agent.complete();
              abortControllerRef.current = null;

            } else {
              // Legacy mode - fall back to non-streaming /api/chat for Figma diagrams or when no run info
              if (hasDocumentAttachments && documentAttachmentsForAnalysis.length > 0) {
                console.log("[handleSubmit] DATA_MODE (Legacy): document attachments detected, async analysis owns aiState");
                return;
              }


              const response = await apiFetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...getAnonUserIdHeader() },
                credentials: "include",
                body: JSON.stringify({
                  messages: finalChatHistory,
                  images: imageDataUrls.length > 0 ? imageDataUrls : undefined,
                  documentMode: isDocumentMode && !isPptMode ? { type: documentType } : undefined,
                  figmaMode: isFigmaMode,
                  pptMode: isPptMode,
                  provider: selectedProvider,
                  model: selectedModel,
                  attachments: attachments.length > 0 ? attachments : undefined,
                  gptId: activeGpt?.id,
                  session_id: gptSessionId
                }),
                signal: abortControllerRef.current?.signal
              });

              // Update steps: mark processing done, searching active
              setAiProcessStepsForChat((prev: any[]) => prev.map((s: any) => {
                if (!s || !s.step) return s;
                if (s.step.includes("Analizando")) return { ...s, status: "done" };
                if (s.step.includes("Procesando")) return { ...s, status: "done" };
                if (s.step.includes("Buscando")) return { ...s, status: "active" };
                return s;
              }), effectiveStreamChatId);

              const data = await response.json();

              if (!response.ok) {
                throw new Error(data.error || "Failed to get response");
              }

              // Save and log GPT session metadata from server
              if (data.session_id) {
                setGptSessionId(data.session_id);
                console.log('[Chat] Using GPT session:', {
                  sessionId: data.session_id,
                  gptId: data.gpt_id,
                  configVersion: data.config_version,
                  toolPermissions: data.tool_permissions
                });
              }

              // Update steps: mark searching done, generating active
              setAiProcessStepsForChat((prev: any[]) => prev.map((s: any) => {
                if (!s || !s.step) return s;
                if (s.step.includes("Buscando")) return { ...s, status: "done" };
                if (s.step.includes("Generando")) return { ...s, status: "active" };
                return { ...s, status: s.status === "pending" ? "pending" : "done" };
              }), effectiveStreamChatId);

              const fullContent = data.content;
              const responseSources = data.sources || [];
              const figmaDiagram = data.figmaDiagram as FigmaDiagram | undefined;
              const responseArtifact = data.artifact;
              const responseWebSources = data.webSources;

              // If Figma diagram was generated, add it to chat with simulated streaming
              if (figmaDiagram) {
                setAiStateForChat("responding", effectiveStreamChatId);

                let currentIndex = 0;
                streamIntervalRef.current = setInterval(() => {
                  if (currentIndex < fullContent.length) {
                    const chunkSize = Math.floor(Math.random() * 5) + 3;
                    currentIndex = Math.min(currentIndex + chunkSize, fullContent.length);
                    streamingContentRef.current = fullContent.slice(0, currentIndex);
                    setStreamingContent(fullContent.slice(0, currentIndex));
                  } else {
                    if (streamIntervalRef.current) {
                      clearInterval(streamIntervalRef.current);
                      streamIntervalRef.current = null;
                    }

                    const uncertainty = detectUncertainty(fullContent);
                    streamTransition.finalize({
                      id: (Date.now() + 1).toString(),
                      role: "assistant",
                      content: fullContent,
                      timestamp: new Date(),
                      requestId: generateRequestId(),
                      userMessageId: userMsgId,
                      figmaDiagram,
                      webSources: responseWebSources,
                      confidence: uncertainty.confidence,
                      uncertaintyReason: uncertainty.reason,
                    });
                    // Only reset doc tool if there's no active document editor
                    if (!activeDocEditorRef.current) {
                      setSelectedDocTool(null);
                    }
                    agent.complete();
                    abortControllerRef.current = null;
                  }
                }, 10);
                return;
              }

              // Legacy simulated streaming for other cases
              setAiStateForChat("responding", effectiveStreamChatId);

              // Check document modes
              const isExcelModeLegacy = (activeDocEditorRef.current?.type === "excel") || (previewDocumentRef.current?.type === "excel");
              const isWordModeLegacy = activeDocEditorRef.current?.type === "word";
              const shouldWriteToDocLegacy = !!activeDocEditorRef.current && isWordModeLegacy;

              console.log('[ChatInterface] Legacy mode:', { isExcelModeLegacy, isWordModeLegacy, hasInsertFn: !!docInsertContentRef.current });

              // Excel mode: send data directly to Excel at the end (no progressive streaming in chat)
              if (isExcelModeLegacy && docInsertContentRef.current) {
                console.log('[ChatInterface] Excel mode (legacy): sending', fullContent.length, 'chars to Excel');
                try {
                  await docInsertContentRef.current(fullContent);
                  streamTransition.finalize({
                    id: (Date.now() + 1).toString(),
                    role: "assistant",
                    content: "✓ Datos generados en la hoja de cálculo",
                    timestamp: new Date(),
                    requestId: generateRequestId(),
                    userMessageId: userMsgId,
                  });
                } catch (err) {
                  console.error('[ChatInterface] Error streaming to Excel (legacy):', err);
                  streamTransition.finalize({
                    id: (Date.now() + 1).toString(),
                    role: "assistant",
                    content: fullContent,
                    timestamp: new Date(),
                    requestId: generateRequestId(),
                    userMessageId: userMsgId,
                  });
                }
                agent.complete();
                abortControllerRef.current = null;
                return;
              }

              // Word mode or normal chat: use progressive streaming
              let currentIndex = 0;

              streamIntervalRef.current = setInterval(() => {
                if (currentIndex < fullContent.length) {
                  const chunkSize = Math.floor(Math.random() * 3) + 1;
                  const newContent = fullContent.slice(0, currentIndex + chunkSize);

                  // Write to document if in document mode (cumulative)
                  if (shouldWriteToDocLegacy && docInsertContentRef.current) {
                    try {
                      const newContentHTML = markdownToTipTap(newContent);
                      const cumulativeHTML = existingDocHTML + separatorHTML + newContentHTML;
                      docInsertContentRef.current(cumulativeHTML, 'html');
                      // Update state so subsequent instructions have the current content
                      setEditedDocumentContent(cumulativeHTML);
                    } catch (err) {
                      console.error('[ChatInterface] Error streaming to document (legacy):', err);
                    }
                  } else {
                    // Store content in streaming store for conversation affinity
                    const originalChatId = streamingChatIdRef.current;
                    if (originalChatId) {
                      appendContent(originalChatId, fullContent.slice(currentIndex, currentIndex + chunkSize), currentIndex);
                    }
                    streamingContentRef.current = newContent;
                    setStreamingContent(newContent);
                  }
                  currentIndex += chunkSize;
                } else {
                  if (streamIntervalRef.current) {
                    clearInterval(streamIntervalRef.current);
                    streamIntervalRef.current = null;
                  }

                  // Finalize document or create message (cumulative)
                  if (shouldWriteToDocLegacy && docInsertContentRef.current) {
                    try {
                      const newContentHTML = markdownToTipTap(fullContent);
                      const cumulativeHTML = existingDocHTML + separatorHTML + newContentHTML;
                      docInsertContentRef.current(cumulativeHTML, 'html');
                      // Update state so subsequent instructions have the current content
                      setEditedDocumentContent(cumulativeHTML);
                    } catch (err) {
                      console.error('[ChatInterface] Error finalizing document (legacy):', err);
                    }

                    streamTransition.finalize({
                      id: (Date.now() + 1).toString(),
                      role: "assistant",
                      content: "✓ Documento generado correctamente",
                      timestamp: new Date(),
                      requestId: generateRequestId(),
                      userMessageId: userMsgId,
                    });
                  } else {
                    const uncertainty = detectUncertainty(fullContent);
                    streamTransition.finalize({
                      id: (Date.now() + 1).toString(),
                      role: "assistant",
                      content: fullContent,
                      timestamp: new Date(),
                      requestId: generateRequestId(),
                      userMessageId: userMsgId,
                      sources: responseSources.length > 0 ? responseSources : undefined,
                      artifact: responseArtifact,
                      webSources: responseWebSources,
                      confidence: uncertainty.confidence,
                      uncertaintyReason: uncertainty.reason,
                    });
                  }

                  agent.complete();
                  abortControllerRef.current = null;
                }
              }, 15);

            }
          }

        } catch (error: any) {
          console.error("[handleSubmit] Error:", error);
          // Restore files on error so user doesn't lose them
          if (savedMainFiles.length > 0) {
            setUploadedFiles(savedMainFiles);
          }
          if (error?.name !== "AbortError") {
            toast({
              title: "Error al procesar",
              description: "Hubo un error al enviar tu mensaje. Tus archivos fueron restaurados.",
              variant: "destructive",
              duration: 5000,
            });
          }
          setAiStateForChat("idle", submitConversationId);
          setAiProcessStepsForChat([], submitConversationId);
          abortControllerRef.current = null;
        }
      } catch (outerError: any) {
        console.error("[handleSubmit] Outer error:", outerError);
        if (savedMainFiles.length > 0) {
          setUploadedFiles(savedMainFiles);
        }
        toast({
          title: "Error inesperado",
          description: "Algo salió mal. Tus archivos fueron restaurados.",
          variant: "destructive",
          duration: 5000,
        });
        setAiStateForChat("idle", submitConversationId);
        setAiProcessStepsForChat([], submitConversationId);
        abortControllerRef.current = null;
      }
    } finally {
      // Always release the submit lock so the user can send again.
      clearSubmitLock();
      isSubmittingRef.current = false;
    }
  };

  const hasMessages = displayMessages.length > 0;
  const showConversationSkeleton = isConversationStateLoading && !hasMessages;

  return (
    <>
      {/* Welcome Explosion for first-time visitors */}
      {showExplosion && (
        <WelcomeExplosion onComplete={completeWelcome} />
      )}

      <div className="flex h-full flex-col bg-transparent relative overflow-hidden">
        {/* Header */}
        <ChatHeader
          chatId={chatId || null}
          activeGpt={activeGpt || {
            id: 'default',
            name: 'iliagpt',
            description: 'Asistente IA',
            systemPrompt: '',
            model: 'gpt-4o',
            temperature: 0.7,
            maxTokens: 4096,
            topP: 1,
            frequencyPenalty: 0,
            presencePenalty: 0,
            isPublic: false,
            userId: 'system',
            createdAt: new Date(),
            updatedAt: new Date(),
            welcomeMessage: '',
            conversationStarters: [],
            avatar: ''
          }}
          messages={displayMessages}
          folders={folders}
          currentFolderId={currentFolderId}
          isPinned={isPinned}
          isArchived={isArchived}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={onToggleSidebar || (() => { })}
          onNewChat={onNewChat}
          onEditGpt={onEditGpt}
          onHideGptFromSidebar={onHideGptFromSidebar}
          onPinGptToSidebar={onPinGptToSidebar}
          isGptPinned={isGptPinned}
          onAboutGpt={onAboutGpt}
          onPinChat={onPinChat}
          onArchiveChat={onArchiveChat}
          onHideChat={onHideChat}
          onDeleteChat={onDeleteChat}
          onDownloadChat={onDownloadChat}
          onEditChatTitle={onEditChatTitle}
          onMoveToFolder={onMoveToFolder}
          onCreateFolder={onCreateFolder}
          userPlanInfo={userPlanInfo}
        />
        {/* Main Content Area with Side Panel */}
        {(previewDocument || activeDocEditor || (selectedDocTool && ['word', 'excel', 'ppt'].includes(selectedDocTool))) ? (
          <PanelGroup direction="horizontal" className="flex-1">
            {/* Left Panel: Minimized Chat for Document Mode */}
            <Panel defaultSize={(activeDocEditor || selectedDocTool) ? 25 : 50} minSize={20} maxSize={(activeDocEditor || selectedDocTool) ? 35 : 70}>
              <div className="flex flex-col min-w-0 h-full bg-background/50">
                {/* Compact Header for Document Mode */}
                {activeDocEditor && (
                  <div className="p-3 border-b border-border/50 bg-muted/30">
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center",
                        activeDocEditor.type === "word" && "bg-blue-600",
                        activeDocEditor.type === "excel" && "bg-green-600",
                        activeDocEditor.type === "ppt" && "bg-orange-500"
                      )}>
                        <span className="text-white text-sm font-bold">
                          {activeDocEditor.type === "word" ? "W" : activeDocEditor.type === "excel" ? "E" : "P"}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">Instrucciones</p>
                        <p className="text-xs text-muted-foreground">El AI escribe directo al documento</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Messages Area - Compact for document mode */}
                {showConversationSkeleton ? (
                  <div
                    className={cn(
                      "flex-1 overflow-y-auto space-y-3 overscroll-contain pb-[var(--composer-height,120px)]",
                      activeDocEditor ? "p-3" : "p-4 sm:p-6 md:p-10 space-y-6"
                    )}
                  >
                    <SkeletonChatMessages count={3} />
                  </div>
                ) : hasMessages && (
                  <div
                    className={cn(
                      "flex-1 overflow-y-auto space-y-3 overscroll-contain pb-[var(--composer-height,120px)]",
                      activeDocEditor ? "p-3" : "p-4 sm:p-6 md:p-10 space-y-6"
                    )}
                  >
                    <ChatMessageList
                      messages={displayMessages}
                      onUserRetrySend={handleUserRetrySend}
                      variant={activeDocEditor ? "compact" : "default"}
                      editingMessageId={editingMessageId}
                      editContent={editContent}
                      setEditContent={setEditContent}
                      copiedMessageId={copiedMessageId}
                      messageFeedback={messageFeedback}
                      speakingMessageId={speakingMessageId}
                      isGeneratingImage={isGeneratingImage}
                      pendingGeneratedImage={pendingGeneratedImage}
                      latestGeneratedImageRef={latestGeneratedImageRef}
                      streamingContent={streamingContent}
                      streamingMsgId={streamChat.nextMessageIdRef.current}
                      aiState={aiState}
                      regeneratingMsgIndex={regeneratingMsgIndex}
                      handleCopyMessage={handleCopyMessage}
                      handleStartEdit={handleStartEdit}
                      handleCancelEdit={handleCancelEdit}
                      handleSendEdit={handleSendEdit}
                      handleFeedback={handleFeedback}
                      handleRegenerate={handleRegenerate}
                      handleShare={handleShare}
                      handleReadAloud={handleReadAloud}
                      handleOpenDocumentPreview={handleOpenDocumentPreview}
                      handleOpenFileAttachmentPreview={handleOpenFileAttachmentPreview}
                      handleDownloadImage={handleDownloadImage}
                      setLightboxImage={setLightboxImage}
                      handleReopenDocument={handleReopenDocument}
                      minimizedDocument={minimizedDocument}
                      onRestoreDocument={restoreDocEditor}
                      onSelectSuggestedReply={(text) => setInput(text)}
                      onAgentCancel={handleAgentCancel}
                      onAgentRetry={handleAgentRetry}
                      onAgentArtifactPreview={(artifact) => setDocumentPreviewArtifact(artifact as DocumentPreviewArtifact)}
                      onSuperAgentCancel={handleSuperAgentCancel}
                      onSuperAgentRetry={handleSuperAgentRetry}
                      onQuestionClick={(text) => setInput(text)}
                      onToolConfirm={handleToolConfirm}
                      onToolDeny={handleToolDeny}
                      activeRunId={activeRunId}
                      onRunComplete={handleRunComplete}
                      uiPhase={uiPhase}
                      aiProcessSteps={aiProcessSteps}
                    />

                    {/* Agent Observer - Show when agent is running */}
                    {agent.state.status !== "idle" && (
                      <div className="flex w-full max-w-3xl mx-auto gap-4 justify-start">
                        <AgentObserver
                          steps={agent.state.steps}
                          objective={agent.state.objective}
                          status={agent.state.status}
                          onCancel={agent.cancel}
                        />
                      </div>
                    )}

                    {/* Production Mode Progress */}
                    {aiState === "agent_working" && aiProcessSteps.length > 0 && (
                      <div className="flex w-full max-w-3xl mx-auto gap-4 justify-start mb-4">
                        <ProductionProgress steps={aiProcessSteps} />
                      </div>
                    )}

                    {/* Image Generation Loading Skeleton */}
                    {isGeneratingImage && (
                      <div className="flex w-full max-w-3xl mx-auto gap-4 justify-start">
                        <div className="flex flex-col gap-2 items-start">
                          <div className="liquid-message-ai-light px-4 py-3 text-sm mb-2">
                            <div className="flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span>Generando imagen...</span>
                            </div>
                          </div>
                          <div className="px-4">
                            <div className="w-64 h-64 bg-muted rounded-lg animate-pulse flex items-center justify-center">
                              <Image className="h-8 w-8 text-muted-foreground" />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Thinking/Responding State - only show if aiState belongs to current chat and uiPhase is not 'console' */}
                    {aiState !== "idle" && !isGeneratingImage && (!aiStateChatId || chatId === aiStateChatId) && uiPhase !== 'console' && (
                      <div className="flex w-full max-w-3xl mx-auto flex-col gap-3 justify-start">
                        {/* Streaming Indicator with cancel button */}
                        <StreamingIndicator
                          aiState={aiState}
                          streamingContent={streamingContent}
                          onCancel={handleStopChat}
                          uiPhase={uiPhase}
                        />

                        {/* Context truncation notice */}
                        {contextNotice && (
                          <div className="mx-4 my-2 flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 flex-shrink-0">
                              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                            </svg>
                            <span>
                              {contextNotice.type === "context_truncated" ? (
                                <>Contexto comprimido: {contextNotice.droppedMessages} mensaje{contextNotice.droppedMessages !== 1 ? 's' : ''} anterior{contextNotice.droppedMessages !== 1 ? 'es' : ''} omitido{contextNotice.droppedMessages !== 1 ? 's' : ''} para ajustar al límite del modelo ({contextNotice.originalTokens.toLocaleString()} &rarr; {contextNotice.finalTokens.toLocaleString()} tokens).</>
                              ) : contextNotice.type === "low_confidence_prompt" ? (
                                <>Prompt ambiguo (confianza: {((contextNotice as any).confidence * 100).toFixed(0)}%). {(contextNotice as any).clarificationQuestions?.[0] || "Intenta ser más específico."}</>
                              ) : (
                                <>Aviso del sistema.</>
                              )}
                            </span>
                            <button
                              onClick={() => setContextNotice(null)}
                              className="ml-auto flex-shrink-0 text-amber-500 hover:text-amber-700 dark:hover:text-amber-300"
                              aria-label="Cerrar aviso"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                              </svg>
                            </button>
                          </div>
                        )}

                        {/* Streaming content with fade-in animation */}
                        {aiState === "responding" && streamingContent && (
                          <div className="animate-content-fade-in px-4 py-3 text-foreground min-w-0 font-sans text-base leading-relaxed font-normal">
                            <MarkdownErrorBoundary fallbackContent={streamingContent}>
                              <MarkdownRenderer
                                content={streamingContent}
                                customComponents={{ ...CleanDataTableComponents }}
                              />
                            </MarkdownErrorBoundary>
                            <span className="typing-cursor">|</span>
                          </div>
                        )}
                      </div>
                    )}

                    

                    <div ref={bottomRef} />
                  </div>
                )}

                {/* Centered content when no messages - Futuristic Welcome */}
                {!hasMessages && (
                  <div className="flex-1 flex flex-col items-center justify-center">
                    {activeGpt ? (
                      <div className="flex flex-col items-center justify-center text-center space-y-4 mb-6">
                        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-2">
                          {activeGpt.avatar ? (
                            <img src={activeGpt.avatar} alt={activeGpt.name} className="w-full h-full rounded-2xl object-cover" />
                          ) : (
                            <Bot className="h-8 w-8 text-muted-foreground" />
                          )}
                        </div>
                        <h2 className="text-xl font-semibold">{activeGpt.name}</h2>
                        <p className="text-muted-foreground max-w-md">{activeGpt.welcomeMessage || activeGpt.description || "¿En qué puedo ayudarte?"}</p>
                        {activeGpt.conversationStarters && activeGpt.conversationStarters.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-4 justify-center max-w-xl">
                            {activeGpt.conversationStarters.filter(s => s).map((starter, idx) => (
                              <button
                                key={idx}
                                onClick={() => setInput(starter)}
                                className="px-4 py-2 text-sm border rounded-lg hover:bg-muted/50 transition-colors text-left"
                              >
                                {starter}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <WelcomeAnimation />
                    )}
                  </div>
                )}

                <Composer
                  input={input}
                  setInput={setInput}
                  textareaRef={textareaRef}
                  composerRef={composerRef}
                  fileInputRef={fileInputRef}
                  uploadedFiles={uploadedFiles}
                  removeFile={removeFile}
                  handleSubmit={handleSubmit}
                  handleFileUpload={handleFileUpload}
                  handlePaste={handlePaste}
                  handleDragOver={handleDragOver}
                  handleDragEnter={handleDragEnter}
                  handleDragLeave={handleDragLeave}
                  handleDrop={handleDrop}
                  isDraggingOver={isDraggingOver}
                  selectedTool={selectedTool}
                  setSelectedTool={setSelectedTool}
                  selectedDocTool={selectedDocTool}
                  setSelectedDocTool={setSelectedDocTool}
                  closeDocEditor={closeDocEditor}
                  openBlankDocEditor={openBlankDocEditor}
                  aiState={aiState}
                  isRecording={isRecording}
                  isPaused={isPaused}
                  recordingTime={recordingTime}
                  toggleVoiceRecording={toggleVoiceRecording}
                  discardVoiceRecording={discardVoiceRecording}
                  pauseVoiceRecording={pauseVoiceRecording}
                  resumeVoiceRecording={resumeVoiceRecording}
                  sendVoiceRecording={sendVoiceRecording}
                  handleStopChat={handleStopChat}
                  isAgentRunning={isAgentRunning}
                  handleAgentStop={handleAgentStop}
                  setIsVoiceChatOpen={setIsVoiceChatOpen}
                  browserSession={browserSession}
                  isBrowserOpen={isBrowserOpen}
                  setIsBrowserOpen={setIsBrowserOpen}
                  isBrowserMaximized={isBrowserMaximized}
                  setIsBrowserMaximized={setIsBrowserMaximized}
                  browserUrl={browserUrl}
                  variant="document"
                  placeholder={selectedDocText ? "Escribe cómo mejorar el texto..." : "Type your message here..."}
                  selectedDocText={selectedDocText}
                  handleDocTextDeselect={handleDocTextDeselect}
                  onPreviewFile={(file) => setPreviewUploadedFile(file)}
                  onTextareaFocus={handleCloseModelSelector}
                  isFilesLoading={uploadedFiles.some((f: UploadedFile) => isFileUploadBlockingSend(f))}
                  latencyMode={latencyMode}
                  setLatencyMode={setLatencyMode}
                />
              </div>
            </Panel>

            {/* Resize Handle */}
            <PanelResizeHandle className="w-2 bg-border/50 hover:bg-primary/30 transition-colors cursor-col-resize flex items-center justify-center group">
              <GripVertical className="h-6 w-6 text-muted-foreground/50 group-hover:text-primary transition-colors" />
            </PanelResizeHandle>

            {/* Right: Document Editor Panel */}
            <Panel defaultSize={(activeDocEditor || selectedDocTool) ? 75 : 50} minSize={25}>
              <EditorErrorBoundary>
                <div className="h-full animate-in slide-in-from-right duration-300">
                  {(activeDocEditor?.type === "ppt") ? (
                    <PPTEditorShellLazy
                      onClose={closeDocEditor}
                      onInsertContent={(insertFn) => { docInsertContentRef.current = insertFn; }}
                      initialShowInstructions={activeDocEditor?.showInstructions}
                      initialContent={activeDocEditor?.content}
                    />
                  ) : (activeDocEditor?.type === "excel" || previewDocument?.type === "excel") ? (
                    <SpreadsheetEditorLazy
                      key="excel-editor-stable"
                      title={activeDocEditor ? activeDocEditor.title : (previewDocument?.title || "")}
                      content={editedDocumentContent}
                      onChange={setEditedDocumentContent}
                      onClose={activeDocEditor ? closeDocEditor : handleCloseDocumentPreview}
                      onDownload={() => {
                        if (activeDocEditor) {
                          handleDownloadDocument({
                            type: activeDocEditor.type,
                            title: activeDocEditor.title,
                            content: editedDocumentContent
                          });
                        } else if (previewDocument) {
                          handleDownloadDocument(previewDocument);
                        }
                      }}
                      onInsertContent={(insertFn: (content: string) => void) => { docInsertContentRef.current = insertFn; }}
                      onOrchestratorReady={(orch: { runOrchestrator: (prompt: string) => Promise<void> }) => { orchestratorRef.current = orch; }}
                    />
                  ) : (
                    <div className="relative h-full">
                      {/* Word/generic document editor — always visible when activeDocEditor or previewDocument exists */}
                      <EnhancedDocumentEditorLazy
                        key={activeDocEditor ? `new-${activeDocEditor.type}` : previewDocument?.title}
                        title={activeDocEditor ? activeDocEditor.title : (previewDocument?.title || "")}
                        content={editedDocumentContent}
                        onChange={setEditedDocumentContent}
                        onClose={activeDocEditor ? minimizeDocEditor : handleCloseDocumentPreview}
                        onDownload={() => {
                          if (activeDocEditor) {
                            handleDownloadDocument({
                              type: activeDocEditor.type,
                              title: activeDocEditor.title,
                              content: editedDocumentContent
                            });
                          } else if (previewDocument) {
                            handleDownloadDocument(previewDocument);
                          }
                        }}
                        onSaveToLibrary={() => handleSaveToLibrary()}
                        onTextSelect={handleDocTextSelect}
                        onTextDeselect={handleDocTextDeselect}
                        onInsertContent={(insertFn: (content: string) => void) => { docInsertContentRef.current = insertFn; }}
                      />
                    </div>
                  )}
                </div>
              </EditorErrorBoundary>
            </Panel>
          </PanelGroup>
        ) : (
          <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full overflow-hidden bg-background relative">
            {/* Content Area - conditional based on whether we have messages */}
            {showConversationSkeleton ? (
              <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 md:p-10 space-y-6 bg-background">
                <SkeletonChatMessages count={3} />
              </div>
            ) : (
              <div className="flex-1 min-h-0 relative bg-background">
                {/* Messages container — ALWAYS mounted to avoid unmount/mount flash */}
                <div
                  ref={messagesContainerRef}
                  onScroll={handleScroll}
                  className={cn(
                    "absolute inset-0 overflow-y-auto p-4 sm:p-6 md:p-8 pb-[calc(var(--composer-height,120px)+120px)] space-y-3 bg-background",
                    !hasMessages && "invisible"
                  )}
                >
                  {hasMessages && (
                    <>
                      <ChatMessageList
                        messages={displayMessages}
                        onUserRetrySend={handleUserRetrySend}
                        variant="default"
                        editingMessageId={editingMessageId}
                        editContent={editContent}
                        setEditContent={setEditContent}
                        copiedMessageId={copiedMessageId}
                        messageFeedback={messageFeedback}
                        speakingMessageId={speakingMessageId}
                        isGeneratingImage={isGeneratingImage}
                        pendingGeneratedImage={pendingGeneratedImage}
                        latestGeneratedImageRef={latestGeneratedImageRef}
                        streamingContent={streamingContent}
                        aiState={aiState}
                        regeneratingMsgIndex={regeneratingMsgIndex}
                        handleCopyMessage={handleCopyMessage}
                        handleStartEdit={handleStartEdit}
                        handleCancelEdit={handleCancelEdit}
                        handleSendEdit={handleSendEdit}
                        handleFeedback={handleFeedback}
                        handleRegenerate={handleRegenerate}
                        handleShare={handleShare}
                        handleReadAloud={handleReadAloud}
                        handleOpenDocumentPreview={handleOpenDocumentPreview}
                        handleOpenFileAttachmentPreview={handleOpenFileAttachmentPreview}
                        handleDownloadImage={handleDownloadImage}
                        setLightboxImage={setLightboxImage}
                        handleReopenDocument={handleReopenDocument}
                        minimizedDocument={minimizedDocument}
                        onRestoreDocument={restoreDocEditor}
                        onSelectSuggestedReply={(text) => setInput(text)}
                        onAgentCancel={handleAgentCancel}
                        onAgentRetry={handleAgentRetry}
                        onAgentArtifactPreview={(artifact) => setDocumentPreviewArtifact(artifact as DocumentPreviewArtifact)}
                        onSuperAgentCancel={handleSuperAgentCancel}
                        onSuperAgentRetry={handleSuperAgentRetry}
                        onQuestionClick={(text) => setInput(text)}
                        onToolConfirm={handleToolConfirm}
                        onToolDeny={handleToolDeny}
                        activeRunId={activeRunId}
                        onRunComplete={() => {
                          console.log('[uiPhase] Run completed, uiPhase=done');
                          setUiPhase('done');
                          setActiveRunId(null);
                        }}
                        uiPhase={uiPhase}
                        aiProcessSteps={aiProcessSteps}
                      />
                      <div className="shrink-0" style={{ height: 'calc(var(--composer-height, 120px) + 40px)' }} aria-hidden="true" />
                      <div ref={messagesEndRef} />
                    </>
                  )}
                </div>

                {/* Scroll to bottom button */}
                {hasMessages && showScrollButton && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.8, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.8, y: 10 }}
                    onClick={() => {
                      setUserHasScrolledUp(false);
                      scrollToBottom();
                    }}
                    className="fixed bottom-32 right-8 z-40 flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105"
                    data-testid="button-scroll-to-bottom"
                  >
                    <ChevronDown className="h-4 w-4" />
                    <span className="text-sm font-medium">Ir al final</span>
                  </motion.button>
                )}

                {/* Welcome/Empty state — overlaid on top, hidden when messages exist */}
                {!hasMessages && (
              <div className="absolute inset-0 flex flex-col items-center justify-center px-4 bg-background z-10">
                {aiState !== "idle" && (!aiStateChatId || chatId === aiStateChatId) && uiPhase !== 'console' ? (
                  /* Processing indicators when AI is working */
                  <div className="w-full max-w-3xl mx-auto flex flex-col gap-4">
                    <StreamingIndicator
                      aiState={aiState}
                      streamingContent={streamingContent}
                      onCancel={handleStopChat}
                      uiPhase={uiPhase}
                    />
                    {streamingContent && (
                      <div className="animate-content-fade-in flex flex-col gap-2 max-w-[85%] items-start min-w-0">
                        <div className="text-sm prose prose-sm dark:prose-invert max-w-none leading-relaxed min-w-0">
                          <MarkdownErrorBoundary fallbackContent={streamingContent}>
                            <MarkdownRenderer
                              content={streamingContent}
                              customComponents={{ ...CleanDataTableComponents }}
                            />
                          </MarkdownErrorBoundary>
                          <span className="typing-cursor">|</span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  /* Welcome Screen */
                  <div className="relative w-full max-w-4xl flex flex-col items-center justify-center pt-8 pb-12">
                    {/* Ambient Glow */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-gradient-to-br from-blue-500/10 via-purple-500/10 to-pink-500/10 blur-[100px] rounded-full pointer-events-none" />
                    
                    <motion.div
                      initial={{ scale: 0.9, opacity: 0, y: 10 }}
                      animate={{ scale: 1, opacity: 1, y: 0 }}
                      transition={{ type: "spring", stiffness: 200, damping: 20 }}
                      className="mb-8 relative z-10"
                    >
                      {activeGpt?.avatar ? (
                        <div className="relative group">
                          <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 to-purple-500 rounded-[28px] blur opacity-25 group-hover:opacity-60 transition duration-500"></div>
                          <AvatarWithFallback
                            src={activeGpt.avatar}
                            alt={activeGpt.name}
                            fallback={<Bot className="h-10 w-10 text-white" />}
                          />
                        </div>
                      ) : (
                        <div className="relative group p-1 flex items-center justify-center">
                          <div className="absolute -inset-3 bg-gradient-to-r from-blue-500/30 via-purple-500/30 to-pink-500/30 rounded-full blur-xl opacity-0 group-hover:opacity-100 transition duration-700"></div>
                          <IliaGPTLogo size={88} className="drop-shadow-xl" />
                        </div>
                      )}
                    </motion.div>

                    <motion.h1
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
                      className="text-4xl sm:text-5xl font-extrabold text-center mb-5 tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-foreground via-foreground/90 to-muted-foreground relative z-10"
                    >
                      {activeGpt ? activeGpt.name : "¿En qué puedo ayudarte?"}
                    </motion.h1>

                    <motion.p
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }}
                      className="text-muted-foreground text-center max-w-lg text-base sm:text-lg mb-10 leading-relaxed relative z-10 font-medium"
                    >
                      {activeGpt
                        ? (activeGpt.welcomeMessage || activeGpt.description || "¿En qué puedo ayudarte?")
                        : selectedProject
                          ? (
                            <span>
                              <span className="font-semibold text-foreground">{selectedProject.name}</span> lista para empezar a chartear con esta carpeta. Sirven para organizar proyectos, mantener contexto, usar archivos específicos y trabajar de forma ordenada.
                            </span>
                          )
                          : "Soy iliagpt, tu asistente de IA. Explora capacidades avanzadas como generación de código, diseño, análisis de documentos y control autónomo."
                      }
                    </motion.p>

                    {activeGpt?.conversationStarters && activeGpt.conversationStarters.length > 0 && (
                      <motion.div
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ duration: 0.5, delay: 0.3 }}
                        className="flex flex-wrap gap-3 justify-center max-w-3xl relative z-10"
                      >
                        {activeGpt.conversationStarters
                          .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
                          .map((starter, idx) => (
                            <button
                              key={idx}
                              onClick={() => setInput(starter)}
                              className="px-5 py-3 text-sm border border-border/40 bg-background/60 backdrop-blur-md rounded-2xl hover:bg-muted/80 hover:border-primary/30 hover:shadow-lg transition-all duration-300 text-left font-medium text-foreground/80 hover:text-foreground hover:-translate-y-1 shadow-sm"
                              data-testid={`button-starter-${idx}`}
                            >
                              {starter}
                            </button>
                          ))}
                      </motion.div>
                    )}

                    {/* Show PromptSuggestions when no conversation starters available */}
                    {(!activeGpt?.conversationStarters || activeGpt.conversationStarters.length === 0) && (
                      <motion.div
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ duration: 0.5, delay: 0.3 }}
                        className="w-full relative z-10"
                      >
                        <PromptSuggestions
                          onSelect={(action) => setInput(action)}
                          hasAttachment={uploadedFiles.length > 0}
                          className="justify-center max-w-3xl mx-auto"
                        />
                      </motion.div>
                    )}
                  </div>
                )}
              </div>
            )}
              </div>
            )}

            {/* Input Bar - floating overlay at bottom */}
            <div className="absolute bottom-0 left-0 right-0 z-30 pointer-events-none">
              <div className="pointer-events-auto">
                <div className="flex justify-end px-4 py-1">
                  <SyncStatusIndicator />
                </div>
                <Composer
              input={input}
              setInput={setInput}
              textareaRef={textareaRef}
              composerRef={composerRef}
              fileInputRef={fileInputRef}
              uploadedFiles={uploadedFiles}
              removeFile={removeFile}
              handleSubmit={handleSubmit}
              handleFileUpload={handleFileUpload}
              handlePaste={handlePaste}
              handleDragOver={handleDragOver}
              handleDragEnter={handleDragEnter}
              handleDragLeave={handleDragLeave}
              handleDrop={handleDrop}
              isDraggingOver={isDraggingOver}
              selectedTool={selectedTool}
              setSelectedTool={setSelectedTool}
              selectedDocTool={selectedDocTool}
              setSelectedDocTool={setSelectedDocTool}
              closeDocEditor={closeDocEditor}
              openBlankDocEditor={openBlankDocEditor}
              aiState={aiState}
              isRecording={isRecording}
              isPaused={isPaused}
              recordingTime={recordingTime}
              toggleVoiceRecording={toggleVoiceRecording}
              discardVoiceRecording={discardVoiceRecording}
              pauseVoiceRecording={pauseVoiceRecording}
              resumeVoiceRecording={resumeVoiceRecording}
              sendVoiceRecording={sendVoiceRecording}
              handleStopChat={handleStopChat}
              isAgentRunning={isAgentRunning}
              handleAgentStop={handleAgentStop}
              setIsVoiceChatOpen={setIsVoiceChatOpen}
              browserSession={browserSession}
              isBrowserOpen={isBrowserOpen}
              setIsBrowserOpen={setIsBrowserOpen}
              isBrowserMaximized={isBrowserMaximized}
              setIsBrowserMaximized={setIsBrowserMaximized}
              browserUrl={browserUrl}
              variant="default"
              placeholder="Escribe tu mensaje aquí..."
              onCloseSidebar={onCloseSidebar}
              setPreviewUploadedImage={setPreviewUploadedImage}
              onPreviewFile={(file) => setPreviewUploadedFile(file)}
              isFigmaConnected={isFigmaConnected}
              isFigmaConnecting={isFigmaConnecting}
              handleFigmaConnect={handleFigmaConnect}
              handleFigmaDisconnect={handleFigmaDisconnect}
              onOpenGoogleForms={() => setIsGoogleFormsOpen(true)}
              onOpenApps={onOpenApps}
              isGoogleFormsActive={isGoogleFormsActive}
              setIsGoogleFormsActive={setIsGoogleFormsActive}
              onTextareaFocus={handleCloseModelSelector}
              isFilesLoading={uploadedFiles.some((f: UploadedFile) => isFileUploadBlockingSend(f))}
              latencyMode={latencyMode}
              setLatencyMode={setLatencyMode}
            />
              </div>
            </div>
          </div>
        )}
        <ETLDialog
          open={isETLDialogOpen}
          onClose={() => setIsETLDialogOpen(false)}
          onComplete={(summary) => {
            onSendMessage({
              id: `etl-${Date.now()}`,
              role: "assistant",
              content: `ETL Agent completed. ${summary}`,
              timestamp: new Date()
            });
          }}
        />
        <DocumentGeneratorDialog
          open={isDocGeneratorOpen}
          onClose={() => setIsDocGeneratorOpen(false)}
          documentType={docGeneratorType}
          onComplete={(message) => {
            onSendMessage({
              id: `doc-gen-${Date.now()}`,
              role: "assistant",
              content: message,
              timestamp: new Date()
            });
          }}
        />
        <GoogleFormsDialog
          open={isGoogleFormsOpen}
          onClose={() => {
            setIsGoogleFormsOpen(false);
            setGoogleFormsPrompt("");
          }}
          initialPrompt={googleFormsPrompt}
          onComplete={(message, formUrl) => {
            onSendMessage({
              id: `forms-gen-${Date.now()}`,
              role: "assistant",
              content: message + (formUrl ? `\n\n[Abrir en Google Forms](${formUrl})` : ""),
              timestamp: new Date()
            });
          }}
        />
        {/* Voice Chat Mode - Fullscreen conversation with Grok */}
        <VoiceChatMode
          open={isVoiceChatOpen}
          onClose={() => setIsVoiceChatOpen(false)}
        />
        {/* Image Lightbox Modal */}
        {lightboxImage && (
          <div
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
            onClick={() => setLightboxImage(null)}
          >
            <div className="relative max-w-[90vw] max-h-[90vh]">
              <img
                src={lightboxImage}
                alt="Imagen ampliada"
                className="max-w-full max-h-[90vh] rounded-lg shadow-2xl"
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
              />
              <Button
                variant="secondary"
                size="icon"
                className="absolute top-4 right-4 h-10 w-10 bg-black/60 hover:bg-black/80 text-white"
                onClick={() => setLightboxImage(null)}
                data-testid="button-close-lightbox"
                aria-label="Cerrar imagen"
              >
                <X className="h-5 w-5" />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                className="absolute top-4 right-16 h-10 w-10 bg-black/60 hover:bg-black/80 text-white"
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleDownloadImage(lightboxImage); }}
                data-testid="button-download-lightbox"
                aria-label="Descargar imagen"
              >
                <Download className="h-5 w-5" />
              </Button>
            </div>
          </div>
        )}
        {/* File Attachment Preview Modal */}
        {previewFileAttachment && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
            onClick={() => setPreviewFileAttachment(null)}
            data-testid="file-attachment-preview-overlay"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="relative bg-card rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <div className="flex items-center gap-3">
                  {(() => {
                    const attTheme = getFileTheme(previewFileAttachment.name, previewFileAttachment.mimeType);
                    return (
                      <motion.div
                        initial={{ scale: 0.8 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.1, duration: 0.2 }}
                        className={cn(
                          "flex items-center justify-center w-10 h-10 rounded-lg",
                          attTheme.bgColor
                        )}
                      >
                        <span className="text-white text-sm font-bold">
                          {attTheme.icon}
                        </span>
                      </motion.div>
                    );
                  })()}
                  <div>
                    <h3 className="font-semibold text-lg text-foreground truncate max-w-md" data-testid="preview-file-name">
                      {previewFileAttachment.name}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {previewFileAttachment.mimeType || "Archivo"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {previewFileAttachment.content && !previewFileAttachment.isLoading && !previewFileAttachment.isProcessing && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleCopyAttachmentContent}
                          data-testid="button-copy-attachment-content"
                        >
                          {copiedAttachmentContent ? (
                            <>
                              <Check className="h-4 w-4 mr-2 text-green-500" />
                              Copiado
                            </>
                          ) : (
                            <>
                              <Copy className="h-4 w-4 mr-2" />
                              Copiar
                            </>
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Copiar contenido al portapapeles</TooltipContent>
                    </Tooltip>
                  )}
                  {previewFileAttachment.storagePath && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDownloadFileAttachment}
                      data-testid="button-download-attachment"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Descargar
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setPreviewFileAttachment(null)}
                    data-testid="button-close-attachment-preview"
                    aria-label="Cerrar vista previa"
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-auto p-6">
                {previewFileAttachment.isLoading ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center justify-center h-64"
                  >
                    <div className="flex flex-col items-center gap-3">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      >
                        <Loader2 className="h-8 w-8 text-primary" />
                      </motion.div>
                      <motion.p
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="text-muted-foreground"
                      >
                        Cargando contenido...
                      </motion.p>
                    </div>
                  </motion.div>
                ) : previewFileAttachment.isProcessing ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center justify-center h-64"
                  >
                    <div className="flex flex-col items-center gap-4 p-6 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800">
                      <motion.div
                        animate={{
                          scale: [1, 1.1, 1],
                          rotate: [0, 5, -5, 0]
                        }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                      >
                        <RefreshCw className="h-10 w-10 text-amber-600 dark:text-amber-400" />
                      </motion.div>
                      <div className="text-center">
                        <p className="font-medium text-amber-800 dark:text-amber-200">
                          Procesando archivo...
                        </p>
                        <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                          El contenido estara disponible en breve
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ) : previewFileAttachment.previewMode === "pdf" && previewFileAttachment.blobUrl ? (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <iframe
                      src={previewFileAttachment.blobUrl}
                      className="w-full h-[70vh] rounded-lg border border-border"
                      title={previewFileAttachment.name}
                      data-testid="preview-pdf-iframe"
                    />
                  </motion.div>
                ) : previewFileAttachment.previewMode === "image" && previewFileAttachment.blobUrl ? (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="flex items-center justify-center"
                  >
                    <img
                      src={previewFileAttachment.blobUrl}
                      alt={previewFileAttachment.name}
                      className="max-w-full max-h-[70vh] object-contain rounded-lg"
                      data-testid="preview-image-inline"
                    />
                  </motion.div>
                ) : previewFileAttachment.content ? (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="prose prose-sm dark:prose-invert max-w-none"
                  >
                    <div className="bg-muted/30 p-4 rounded-lg overflow-auto max-h-[60vh]">
                      <MarkdownErrorBoundary fallbackContent={previewFileAttachment.content}>
                        <MarkdownRenderer content={previewFileAttachment.content} />
                      </MarkdownErrorBoundary>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3 }}
                    className="flex flex-col items-center justify-center h-64 text-center"
                  >
                    <FileText className="h-16 w-16 text-muted-foreground/50 mb-4" />
                    <p className="text-muted-foreground">
                      La vista previa no esta disponible para este tipo de archivo.
                    </p>
                    {previewFileAttachment.storagePath && (
                      <Button
                        variant="outline"
                        className="mt-4"
                        onClick={handleDownloadFileAttachment}
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Descargar archivo
                      </Button>
                    )}
                  </motion.div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
        {/* Uploaded Image Preview Modal */}
        {previewUploadedImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
            onClick={() => setPreviewUploadedImage(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative max-w-4xl max-h-[90vh] rounded-lg overflow-hidden"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <img
                src={previewUploadedImage.dataUrl}
                alt={previewUploadedImage.name}
                className="max-w-full max-h-[90vh] object-contain"
              />
              <button
                onClick={() => setPreviewUploadedImage(null)}
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors"
                data-testid="button-close-image-preview"
                aria-label="Cerrar vista previa de imagen"
              >
                <X className="h-5 w-5" />
              </button>
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4">
                <p className="text-white text-sm truncate">{previewUploadedImage.name}</p>
              </div>
            </motion.div>
          </motion.div>
        )}

        {/* Uploaded File Preview Modal (PDFs, docs from composer) */}
        {previewUploadedFile && (() => {
          return (
            <FilePreviewModal
              file={{
                id: previewUploadedFile.fileId,
                fileId: previewUploadedFile.fileId,
                name: previewUploadedFile.name,
                mimeType: previewUploadedFile.mimeType,
                type: previewUploadedFile.mimeType,
                dataUrl: previewUploadedFile.dataUrl,
                content: previewUploadedFile.content,
              }}
              onClose={() => setPreviewUploadedFile(null)}
            />
          );
        })()}

        {/* Screen reader announcements */}
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {screenReaderAnnouncement}
        </div>

        {/* Keyboard shortcuts dialog */}
        <KeyboardShortcutsDialog
          open={isKeyboardShortcutsOpen}
          onOpenChange={setIsKeyboardShortcutsOpen}
        />

        {/* Upgrade Plan Dialog */}
        <UpgradePlanDialog
          open={isUpgradeDialogOpen}
          onOpenChange={setIsUpgradeDialogOpen}
        />

        {/* Document Preview Panel for agent-generated documents */}
        <DocumentPreviewPanel
          isOpen={!!documentPreviewArtifact}
          onClose={() => setDocumentPreviewArtifact(null)}
          artifact={documentPreviewArtifact}
          onDownload={(artifact: any) => {
            if (artifact.data?.base64) {
              const byteCharacters = atob(artifact.data.base64);
              const byteNumbers = new Array(byteCharacters.length);
              for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
              }
              const byteArray = new Uint8Array(byteNumbers);
              const blob = new Blob([byteArray], { type: artifact.mimeType || 'application/octet-stream' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = artifact.name;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }
          }}
        />

        {/* Pricing Modal for quota exceeded */}
        <PricingModal
          open={showPricingModal}
          onClose={() => setShowPricingModal(false)}
          quota={quotaInfo || { remaining: 0, limit: 3, resetAt: null, plan: "free" }}
        />

        {/* Upgrade Prompt Modal for free users after 3rd query */}
        <UpgradePromptModal
          isOpen={showUpgradePrompt}
          onClose={closeUpgradePrompt}
          onUpgrade={() => {
            closeUpgradePrompt();
            setShowUpgradeDialog(true);
          }}
          queryCount={queryCount}
        />

        {/* Upgrade Dialog triggered from prompt */}
        <UpgradePlanDialog
          open={showUpgradeDialog}
          onOpenChange={setShowUpgradeDialog}
        />

        {/* Agent Panel removed - progress is shown inline in chat messages */}
      </div>
    </>
  );
}

function BotIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
    </svg>
  );
}
