import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Plus,
  Upload,
  Search,
  Image,
  Video,
  Bot,
  Plug,
  Globe,
  FileText,
  ChevronDown,
  X,
  Loader2,
  CheckCircle2,
  Maximize2,
  Minimize2,
  Users,
  Calendar,
  Contact,
  Settings2,
  Wand2,
  Sparkles,
  Clock,
  Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import { cn } from "@/lib/utils";
import {
  SILVER_BORDER_DIVIDER,
  SILVER_CONTAINER_FOCUS,
  SILVER_CONTAINER_SHADOW,
  SILVER_GLASS_BG,
  SILVER_HAIRLINE,
  SILVER_HAIRLINE_DASHED,
  SILVER_HOVER_BORDER_INNER,
  SILVER_HOVER_BORDER_SOFT,
  SILVER_ICON_BUTTON_BASE,
  SILVER_ICON_BUTTON_TONE,
  SILVER_KBD,
  SILVER_RING_SOFT,
} from "@/lib/silver-ui";
import { SourceListItem } from "@/components/ui/source-list-item";
import { RecordingPanel } from "@/components/recording-panel";
import { FilePreviewSurface } from "@/components/FilePreviewSurface";
import { useConnectedSources } from "@/hooks/use-connected-sources";
import { useCommandHistory } from "@/hooks/use-command-history";
import { VirtualComputer } from "@/components/virtual-computer";
import { getFileTheme } from "@/lib/fileTypeTheme";
import type { FilePreviewData } from "@/lib/filePreviewTypes";
import { useSettingsContext } from "@/contexts/SettingsContext";
import "@/components/ui/glass-effects.css";
import { type AIState, isAiBusyState } from "@/components/chat-interface/types";

interface UploadedFile {
  id?: string;
  localKey?: string;
  name: string;
  type: string;
  mimeType?: string;
  size: number;
  dataUrl?: string;
  storagePath?: string;
  status?: string;
  content?: string;
  previewStatus?: "idle" | "loading" | "ready" | "error";
  previewData?: FilePreviewData;
  spreadsheetData?: {
    uploadId: string;
    sheets: Array<{ name: string; rowCount: number; columnCount: number }>;
    previewData?: { headers: string[]; data: any[][] };
  };
}

import { type BrowserSessionState } from "@/hooks/use-browser-session";

interface BrowserSession {
  state: BrowserSessionState;
  cancel: () => void;
}

export interface ComposerProps {
  input: string;
  setInput: (value: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  composerRef: React.RefObject<HTMLDivElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  uploadedFiles: UploadedFile[];
  dragPreviewFiles?: UploadedFile[];
  removeFile: (index: number) => void;
  handleSubmit: () => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handlePaste: (e: React.ClipboardEvent<HTMLElement>) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragEnter: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  isDraggingOver: boolean;
  selectedTool: "web" | "agent" | "image" | null;
  setSelectedTool: (tool: "web" | "agent" | "image" | null) => void;
  selectedDocTool: "figma" | null;
  setSelectedDocTool: (tool: "figma" | null) => void;
  aiState: AIState;
  isRecording: boolean;
  isPaused: boolean;
  recordingTime: number;
  toggleVoiceRecording: () => void;
  discardVoiceRecording: () => void;
  pauseVoiceRecording: () => void;
  resumeVoiceRecording: () => void;
  sendVoiceRecording: () => void;
  handleStopChat: () => void;
  isAgentRunning?: boolean;
  handleAgentStop?: () => void;
  setIsVoiceChatOpen: (value: boolean) => void;
  browserSession: BrowserSession;
  isBrowserOpen: boolean;
  setIsBrowserOpen: (value: boolean) => void;
  isBrowserMaximized: boolean;
  setIsBrowserMaximized: (value: boolean) => void;
  browserUrl: string;
  variant: "default" | "document";
  placeholder: string;
  selectedDocText?: string;
  handleDocTextDeselect?: () => void;
  onCloseSidebar?: () => void;
  setPreviewUploadedImage?: (value: { name: string; dataUrl: string } | null) => void;
  onPreviewFile?: (file: { name: string; mimeType?: string; fileId?: string; dataUrl?: string; content?: string; previewData?: FilePreviewData }) => void;
  isFigmaConnected?: boolean;
  isFigmaConnecting?: boolean;
  handleFigmaConnect?: () => void;
  handleFigmaDisconnect?: () => void;
  onOpenGoogleForms?: () => void;
  onOpenApps?: () => void;
  isGoogleFormsActive?: boolean;
  setIsGoogleFormsActive?: (value: boolean) => void;
  onTextareaFocus?: () => void;
  isFilesLoading?: boolean;
  latencyMode?: "fast" | "deep" | "auto";
  setLatencyMode?: (mode: "fast" | "deep" | "auto") => void;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function Composer({
  input,
  setInput,
  textareaRef,
  composerRef,
  fileInputRef,
  uploadedFiles,
  dragPreviewFiles = [],
  removeFile,
  handleSubmit,
  handleFileUpload,
  handlePaste,
  handleDragOver,
  handleDragEnter,
  handleDragLeave,
  handleDrop,
  isDraggingOver,
  selectedTool,
  setSelectedTool,
  selectedDocTool,
  setSelectedDocTool,
  aiState,
  isRecording,
  isPaused,
  recordingTime,
  toggleVoiceRecording,
  discardVoiceRecording,
  pauseVoiceRecording,
  resumeVoiceRecording,
  sendVoiceRecording,
  handleStopChat,
  isAgentRunning,
  handleAgentStop,
  setIsVoiceChatOpen,
  browserSession,
  isBrowserOpen,
  setIsBrowserOpen,
  isBrowserMaximized,
  setIsBrowserMaximized,
  browserUrl,
  variant,
  placeholder,
  selectedDocText,
  handleDocTextDeselect,
  onCloseSidebar,
  setPreviewUploadedImage,
  onPreviewFile,
  isFigmaConnected,
  isFigmaConnecting,
  handleFigmaConnect,
  handleFigmaDisconnect,
  onOpenGoogleForms,
  onOpenApps,
  isGoogleFormsActive,
  setIsGoogleFormsActive,
  onTextareaFocus,
  isFilesLoading = false,
  latencyMode = "auto",
  setLatencyMode,
}: ComposerProps) {
  const isDocumentMode = variant === "document";
  const hasAttachableFiles = uploadedFiles.some((file) => file.status !== "error");
  const hasContent = input.trim().length > 0 || hasAttachableFiles;
  const { settings } = useSettingsContext();
  const webSearchEnabled = !!settings.webSearch;
  const canvasEnabled = !!settings.canvas;

  const [showKnowledgeBase, setShowKnowledgeBase] = useState(false);

  const [showMentionPopover, setShowMentionPopover] = useState(false);
  const [mentionSearch, setMentionSearch] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [recentTemplates, setRecentTemplates] = useState<string[]>([]);

  const quickActionTemplates = [
    {
      id: "image",
      label: "Generar imagen",
      icon: Sparkles,
      template: "Genera una imagen de ",
      color: "from-pink-500 to-rose-500",
      bgColor: "bg-pink-50 dark:bg-pink-950/30",
      textColor: "text-pink-600 dark:text-pink-400",
      borderColor: "border-pink-200 dark:border-pink-800",
    },
    {
      id: "web",
      label: "Buscar en web",
      icon: Search,
      template: "Busca en la web información sobre ",
      color: "from-cyan-500 to-teal-500",
      bgColor: "bg-cyan-50 dark:bg-cyan-950/30",
      textColor: "text-cyan-600 dark:text-cyan-400",
      borderColor: "border-cyan-200 dark:border-cyan-800",
    },
  ];

  useEffect(() => {
    const stored = localStorage.getItem("recentQuickTemplates");
    if (stored) {
      try {
        setRecentTemplates(JSON.parse(stored));
      } catch {
        setRecentTemplates([]);
      }
    }
  }, []);

  const handleQuickAction = useCallback((templateId: string, template: string) => {
    setInput(template);
    textareaRef.current?.focus();
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.setSelectionRange(template.length, template.length);
      }
    }, 0);

    const newRecent = [templateId, ...recentTemplates.filter((id: string) => id !== templateId)].slice(0, 4);
    setRecentTemplates(newRecent);
    localStorage.setItem("recentQuickTemplates", JSON.stringify(newRecent));
  }, [setInput, textareaRef, recentTemplates]);

  const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

  const detectedUrls = useMemo(() => {
    if (!input) return [];
    const matches = input.match(URL_REGEX);
    return matches || [];
  }, [input]);

  const highlightedHtml = useMemo(() => {
    if (!input || detectedUrls.length === 0) return null;
    const escaped = input
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const highlighted = escaped.replace(
      /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi,
      (match) => `<span style="color:#3b82f6;text-decoration:underline">${match}</span>`
    );
    return highlighted + "\n";
  }, [input, detectedUrls]);

  const { connectedSources, getSourceActive, setSourceActive } = useConnectedSources();
  const { addToHistory, navigateUp, navigateDown, resetNavigation } = useCommandHistory();

  const mentionSources = connectedSources.map((source: any) => ({
    ...source,
    mention: source.id === 'gmail' ? '@Gmail' : source.id === 'googleForms' ? '@GoogleForms' : `@${source.name}`,
    action: source.id === 'googleForms' ? () => onOpenGoogleForms?.() : () => { }
  }));

  const filteredSources = mentionSources.filter((source: any) =>
    source.name.toLowerCase().includes(mentionSearch.toLowerCase()) ||
    source.mention.toLowerCase().includes(mentionSearch.toLowerCase())
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    resetNavigation();

    // Auto-resize textarea to fit content
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;

    const cursorPos = e.target.selectionStart || 0;
    const textBeforeCursor = value.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\w*)$/);

    if (atMatch) {
      setShowMentionPopover(true);
      setMentionSearch(atMatch[1]);
      setMentionIndex(0);
    } else {
      setShowMentionPopover(false);
      setMentionSearch("");
    }
  };

  const handleSubmitWithHistory = () => {
    if (input.trim()) {
      addToHistory(input.trim());
    }
    handleSubmit();
  };

  const handleContainerPasteCapture = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    if (e.target === textareaRef.current) {
      return;
    }
    handlePaste(e);
  }, [handlePaste, textareaRef]);

  const handleHistoryNavigation = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const cursorPosition = textarea.selectionStart;
    const textLength = textarea.value.length;

    if (e.key === "ArrowUp" && cursorPosition === 0) {
      const historyItem = navigateUp(input);
      if (historyItem !== null) {
        e.preventDefault();
        setInput(historyItem);
        setTimeout(() => {
          textarea.setSelectionRange(historyItem.length, historyItem.length);
        }, 0);
      }
    } else if (e.key === "ArrowDown" && cursorPosition === textLength) {
      const historyItem = navigateDown();
      if (historyItem !== null) {
        e.preventDefault();
        setInput(historyItem);
        setTimeout(() => {
          textarea.setSelectionRange(historyItem.length, historyItem.length);
        }, 0);
      }
    }
  };

  const insertMention = (source: typeof mentionSources[0]) => {
    const cursorPos = textareaRef.current?.selectionStart || 0;
    const textBeforeCursor = input.slice(0, cursorPos);
    const textAfterCursor = input.slice(cursorPos);
    const atMatch = textBeforeCursor.match(/@(\w*)$/);

    if (atMatch) {
      const newText = textBeforeCursor.slice(0, -atMatch[0].length) + source.mention + ' ' + textAfterCursor;
      setInput(newText);
    }

    setShowMentionPopover(false);
    setMentionSearch("");
    textareaRef.current?.focus();

    setSourceActive(source.id, true);
    if (source.id === 'googleForms') {
      setIsGoogleFormsActive?.(true);
    }
  };

  const handleMentionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showMentionPopover || filteredSources.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMentionIndex((prev: number) => (prev + 1) % filteredSources.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMentionIndex((prev: number) => (prev - 1 + filteredSources.length) % filteredSources.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertMention(filteredSources[mentionIndex]);
    } else if (e.key === 'Escape') {
      setShowMentionPopover(false);
    }
  };

  const toggleKnowledgeSource = (sourceId: string) => {
    const currentValue = getSourceActive(sourceId);
    setSourceActive(sourceId, !currentValue);

    if (sourceId === 'googleForms') {
      setIsGoogleFormsActive?.(!currentValue);
    }
  };

  const renderPreviewTile = (file: UploadedFile, size: "compact" | "document" | "drag") => {
    const outerClass = size === "document"
      ? "h-[84px] w-[132px]"
      : size === "drag"
        ? "h-20 w-full"
        : "h-12 w-20";

    if ((file.type?.startsWith("image/") || file.mimeType?.startsWith("image/")) && file.dataUrl) {
      return (
        <div className={cn("overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm", outerClass)}>
          <img
            src={file.dataUrl}
            alt={file.name}
            className="h-full w-full object-cover"
          />
        </div>
      );
    }

    if (file.previewData && (file.previewData.html || file.previewData.content)) {
      return (
        <div className={cn("overflow-hidden rounded-lg border border-slate-200/80 bg-white shadow-sm", outerClass)}>
          <FilePreviewSurface preview={file.previewData} variant="thumbnail" />
        </div>
      );
    }

    const theme = getFileTheme(file.name, file.mimeType || file.type);
    return (
      <div className={cn(
        "flex items-center justify-center rounded-lg text-white shadow-sm",
        outerClass,
        theme.bgColor
      )}>
        {(file.status === "uploading" || file.status === "processing" || file.previewStatus === "loading") ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <span className="text-lg font-bold">{theme.icon}</span>
        )}
      </div>
    );
  };

  const renderAttachmentPreview = () => {
    if (uploadedFiles.length === 0) return null;

    if (isDocumentMode) {
      return (
        <div className="flex flex-wrap gap-2 px-1 max-h-32 overflow-y-auto" data-testid="inline-attachments-container">
          {uploadedFiles.map((file, index) => (
            <div
              key={file.id || index}
              className={cn(
                "relative group rounded-lg overflow-hidden",
                SILVER_HAIRLINE,
                file.status === "error"
                  ? "bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800"
                  : cn("bg-card", "border-[#c7c7c7]/45 dark:border-white/10", SILVER_HOVER_BORDER_SOFT)
              )}
              data-testid={`inline-file-${index}`}
            >
              <button
                className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 rounded-full p-0.5 text-white z-10 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-white/50"
                onClick={() => removeFile(index)}
                aria-label={`Remove file ${file.name}`}
                title={`Remove file ${file.name}`}
                data-testid={`button-remove-file-${index}`}
              >
                <X className="h-3 w-3" />
              </button>
              {file.type.startsWith("image/") && file.dataUrl ? (
                <div className="relative w-16 h-16">
                  <img
                    src={file.dataUrl}
                    alt={file.name}
                    className="w-full h-full object-cover rounded-lg"
                  />
                  {(file.status === "uploading" || file.status === "processing") && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg">
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                    </div>
                  )}
                  {file.status === "ready" && (
                    <div className="absolute bottom-0 right-0 bg-green-500 rounded-tl-md p-0.5">
                      <CheckCircle2 className="h-2.5 w-2.5 text-white" />
                    </div>
                  )}
                </div>
              ) : (
                (() => {
                  const docTheme = getFileTheme(file.name, file.mimeType || file.type);
                  return (
                    <div
                      className="flex items-center gap-2 px-2 py-1.5 pr-6 max-w-[240px] cursor-pointer"
                      onClick={() => file.status === "ready" && onPreviewFile?.({
                        name: file.name,
                        mimeType: file.mimeType || file.type,
                        fileId: file.id,
                        dataUrl: file.dataUrl,
                        content: file.content,
                        previewData: file.previewData,
                      })}
                    >
                      <div className="shrink-0">
                        {renderPreviewTile(file, "document")}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-medium truncate block">{file.name}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {file.status === "uploading" ? "Subiendo..." :
                            file.status === "processing" ? "Procesando..." :
                              file.previewStatus === "loading" ? "Renderizando..." :
                              file.status === "error" ? "Error" :
                                `${docTheme.label} - ${formatFileSize(file.size)}`}
                        </span>
                      </div>
                      {file.status === "ready" && (
                        <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0" />
                      )}
                    </div>
                  );
                })()
              )}
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1.5 pl-1 pb-0.5 max-h-28 overflow-x-auto overflow-y-hidden flex-nowrap">
        {uploadedFiles.map((file, index) => {
          const theme = getFileTheme(file.name, file.mimeType);
          const isImage = file.type?.startsWith("image/") || file.mimeType?.startsWith("image/");

          if (isImage && file.dataUrl) {
            return (
              <div key={file.id} className="relative group">
                <div
                  className={cn(
                    "relative w-12 h-12 rounded-lg overflow-hidden cursor-pointer",
                    SILVER_HAIRLINE,
                    "border-[#c7c7c7]/55 dark:border-white/10",
                    SILVER_HOVER_BORDER_SOFT,
                    "transition-colors duration-150"
                  )}
                  onClick={() => setPreviewUploadedImage?.({ name: file.name, dataUrl: file.dataUrl! })}
                  data-testid={`preview-image-${index}`}
                >
                  <img
                    src={file.dataUrl}
                    alt={file.name}
                    className="w-full h-full object-cover"
                  />
                  {(file.status === "uploading" || file.status === "processing") && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <Loader2 className="h-3.5 w-3.5 text-white animate-spin" />
                    </div>
                  )}
                </div>
                <button
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shadow-md focus:outline-none focus:ring-2 focus:ring-destructive/50"
                  onClick={(e: React.MouseEvent) => { e.stopPropagation(); removeFile(index); }}
                  aria-label={`Remove file ${file.name}`}
                  title={`Remove file ${file.name}`}
                  data-testid={`button-remove-file-${index}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          }


          return (
            <TooltipProvider key={file.id}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      "relative group flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-all duration-200 cursor-pointer",
                      file.status === "uploading" && "bg-blue-50 dark:bg-blue-950/30 border-[0.5px] border-blue-200 dark:border-blue-800",
                      file.status === "processing" && "bg-yellow-50 dark:bg-yellow-950/30 border-[0.5px] border-yellow-200 dark:border-yellow-800",
                      file.status === "ready" && cn(
                        "bg-white/30 dark:bg-white/5 hover:bg-white/40 dark:hover:bg-white/6",
                        SILVER_HAIRLINE,
                        "border-[#c7c7c7]/45 dark:border-white/10",
                        SILVER_HOVER_BORDER_SOFT
                      ),
                      file.status === "error" && "bg-red-50 dark:bg-red-950/30 border-[0.5px] border-red-200 dark:border-red-800"
                    )}
                    onClick={() => file.status === "ready" && onPreviewFile?.({
                      name: file.name,
                      mimeType: file.mimeType || file.type,
                      fileId: file.id,
                      dataUrl: file.dataUrl,
                      content: file.content,
                      previewData: file.previewData,
                    })}
                  >
                    <div className="shrink-0">
                      {renderPreviewTile(file, "compact")}
                    </div>
                    <span className="max-w-[100px] truncate font-medium">{file.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 shrink-0 text-muted-foreground hover:text-red-500 transition-colors"
                      onClick={(e: React.MouseEvent) => { e.stopPropagation(); removeFile(index); }}
                      aria-label={`Remove file ${file.name}`}
                      data-testid={`button-remove-file-${index}`}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="text-xs">{file.name} ({formatFileSize(file.size)})</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </div>
    );
  };

  const [toolsPopoverOpen, setToolsPopoverOpen] = useState(false);

  const renderToolsPopover = () => (
    <Popover open={toolsPopoverOpen} onOpenChange={setToolsPopoverOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open tools menu"
          title="Open tools menu"
          className={cn(
            isDocumentMode ? "h-10 w-10 rounded-full" : "h-9 w-9 sm:h-8 sm:w-8 rounded-full",
            "flex-shrink-0",
            SILVER_ICON_BUTTON_BASE,
            SILVER_ICON_BUTTON_TONE
          )}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn("p-1", isDocumentMode ? "w-48" : "w-56 p-2")} align="start" side="top">
        <div className={cn(isDocumentMode ? "flex flex-col" : "grid gap-1")}>
          {isDocumentMode ? (
            <>
              <Button
                variant="ghost"
                className="justify-start gap-3 text-sm h-10 glass-menu-item"
                onClick={() => { setToolsPopoverOpen(false); fileInputRef.current?.click(); }}
                data-testid="button-upload-files"
              >
                <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-muted">
                  <Upload className="h-4 w-4" />
                </div>
                Upload Files
              </Button>
              <Button
                variant="ghost"
                className="justify-start gap-2 text-sm h-9 glass-menu-item"
                onClick={() => { setToolsPopoverOpen(false); setIsBrowserOpen(!isBrowserOpen); }}
                disabled={!webSearchEnabled}
              >
                <Search className="h-4 w-4" />
                Web Search
              </Button>
              <Button variant="ghost" className="justify-start gap-2 text-sm h-9 glass-menu-item" onClick={() => setToolsPopoverOpen(false)}>
                <Image className="h-4 w-4" />
                Image Generation
              </Button>
              <Button variant="ghost" className="justify-start gap-2 text-sm h-9 glass-menu-item" onClick={() => setToolsPopoverOpen(false)}>
                <Video className="h-4 w-4" />
                Video Generation
              </Button>
              <Button variant="ghost" className="justify-start gap-2 text-sm h-9 glass-menu-item" onClick={() => setToolsPopoverOpen(false)}>
                <Bot className="h-4 w-4" />
                Agente
              </Button>
              <Button variant="ghost" className="justify-start gap-2 text-sm h-9 glass-menu-item" onClick={() => setToolsPopoverOpen(false)}>
                <Plug className="h-4 w-4" />
                Connectors MPC
              </Button>
            </>
          ) : (
            <>
              <label className="cursor-pointer">
                <input
                  type="file"
                  className="hidden"
                  multiple
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.html,.htm,.jpg,.jpeg,.png,.gif,.bmp,.webp,.tif,.tiff"
                  onChange={(e) => { setToolsPopoverOpen(false); handleFileUpload(e); }}
                />
                <Button variant="ghost" className="w-full justify-start gap-2 text-sm h-9 glass-menu-item" asChild>
                  <span>
                    <Upload className="h-4 w-4" />
                    Subir archivo
                  </span>
                </Button>
              </label>
              <Button
                variant="ghost"
                className="justify-start gap-2 text-sm h-9 glass-menu-item"
                onClick={() => { try { setToolsPopoverOpen(false); setShowKnowledgeBase(true); onCloseSidebar?.(); } catch (err) { console.error("[Composer] Error opening knowledge base:", err); } }}
                data-testid="button-knowledge-base"
              >
                <Users className="h-4 w-4" />
                Conocimientos de la empresa
              </Button>
              <Button
                variant="ghost"
                className="justify-start gap-3 text-sm h-10 glass-menu-item"
                disabled={!webSearchEnabled}
                onClick={() => {
                  try {
                    if (!webSearchEnabled) return;
                    setToolsPopoverOpen(false);
                    setSelectedTool("web");
                    onCloseSidebar?.();
                  } catch (err) {
                    console.error("[Composer] Error selecting web tool:", err);
                  }
                }}
              >
                <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-cyan-100 dark:bg-cyan-900/30">
                  <Globe className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                </div>
                Navegar en la web
              </Button>
              <Button
                variant="ghost"
                className="justify-start gap-3 text-sm h-10 glass-menu-item"
                onClick={() => { try { setToolsPopoverOpen(false); setSelectedTool("image"); onCloseSidebar?.(); } catch (err) { console.error("[Composer] Error selecting image tool:", err); } }}
              >
                <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-pink-100 dark:bg-pink-900/30">
                  <Image className="h-4 w-4 text-pink-600 dark:text-pink-400" />
                </div>
                Generar imagen
              </Button>
              <Button
                variant="ghost"
                className="justify-start gap-3 text-sm h-10 glass-menu-item"
                onClick={() => { try { setToolsPopoverOpen(false); setSelectedDocTool("figma"); onCloseSidebar?.(); } catch (err) { console.error("[Composer] Error selecting Figma tool:", err); } }}
              >
                <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                  <svg width="10" height="14" viewBox="0 0 38 57" fill="none">
                    <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE" />
                    <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83" />
                    <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262" />
                    <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E" />
                    <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF" />
                  </svg>
                </div>
                Diagrama Figma
              </Button>

              <Button
                variant="ghost"
                className="justify-start gap-2 text-sm h-9 glass-menu-item"
                onClick={() => { try { setToolsPopoverOpen(false); setSelectedTool("agent"); onCloseSidebar?.(); } catch (err) { console.error("[Composer] Error selecting agent tool:", err); } }}
              >
                <Bot className="h-4 w-4" />
                Agente
              </Button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );

  const renderSelectedToolLogo = () => {
    if (!selectedTool) return null;

    return (
      <div className="relative group shrink-0">
        <div
          className={cn(
            "relative flex items-center justify-center w-10 h-10 rounded-xl cursor-pointer overflow-hidden",
            "transition-all duration-500 ease-out",
            "hover:shadow-lg hover:shadow-current/30",
            "before:absolute before:inset-0 before:rounded-xl before:opacity-0 before:transition-opacity before:duration-300",
            "hover:before:opacity-100 before:bg-gradient-to-br before:from-white/20 before:to-transparent",
            "after:absolute after:inset-0 after:rounded-xl after:opacity-0 after:transition-all after:duration-700",
            "hover:after:opacity-100 after:animate-pulse",
            selectedTool === "web" && "bg-gradient-to-br from-cyan-500 to-cyan-700 after:bg-cyan-400/20",
            selectedTool === "agent" && "bg-gradient-to-br from-purple-500 to-purple-700 after:bg-purple-400/20",
            selectedTool === "image" && "bg-gradient-to-br from-pink-500 to-rose-600 after:bg-pink-400/20",
            "animate-[liquid-float_3s_ease-in-out_infinite]"
          )}
          data-testid="button-selected-tool"
        >
          {selectedTool === "web" ? (
            <Globe className="h-5 w-5 text-white z-10 drop-shadow-md" />
          ) : selectedTool === "image" ? (
            <Image className="h-5 w-5 text-white z-10 drop-shadow-md" />
          ) : (
            <Bot className="h-5 w-5 text-white z-10 drop-shadow-md" />
          )}
        </div>
        <button
          onClick={() => setSelectedTool(null)}
          aria-label="Close tool"
          className={cn(
            "absolute -top-1 -right-1 w-4 h-4 rounded-full",
            "bg-red-500 hover:bg-red-600 text-white",
            "flex items-center justify-center",
            "opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100",
            "transition-all duration-200 ease-out",
            "shadow-md hover:shadow-lg"
          )}
          data-testid="button-close-tool"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </div>
    );
  };

  const renderSelectedDocToolLogo = () => {
    if (!selectedDocTool) return null;

    return (
      <div className="relative group shrink-0">
        <div
          className={cn(
            "relative flex items-center justify-center w-10 h-10 rounded-xl cursor-pointer overflow-hidden",
            "transition-all duration-500 ease-out",
            "hover:shadow-lg hover:shadow-current/30",
            "before:absolute before:inset-0 before:rounded-xl before:opacity-0 before:transition-opacity before:duration-300 hover:before:opacity-100 before:bg-gradient-to-br before:from-white/20 before:to-transparent after:absolute after:inset-0 after:rounded-xl after:opacity-0 after:transition-all after:duration-700 hover:after:opacity-100 after:animate-pulse",
            selectedDocTool === "figma" && "bg-gradient-to-br from-purple-500 to-pink-500",
            selectedDocTool === "figma" && "after:bg-purple-400/20",
            "animate-[liquid-float_3s_ease-in-out_infinite]"
          )}
          data-testid="button-selected-doc-tool"
        >
          <svg width="16" height="24" viewBox="0 0 38 57" fill="none" className="z-10 drop-shadow-md">
            <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE" />
            <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83" />
            <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262" />
            <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E" />
            <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF" />
          </svg>
        </div>
        <button
          onClick={() => setSelectedDocTool(null)}
          aria-label="Close document tool"
          className={cn(
            "absolute -top-1 -right-1 w-4 h-4 rounded-full",
            "bg-red-500 hover:bg-red-600 text-white",
            "flex items-center justify-center",
            "opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100",
            "transition-all duration-200 ease-out",
            "shadow-md hover:shadow-lg"
          )}
          data-testid="button-close-doc-tool"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </div>
    );
  };

  const containerClass = isDocumentMode
    ? cn(
      "p-4 sm:p-6 w-full max-w-3xl mx-auto relative bg-background z-10",
      isDraggingOver && cn("ring-2 rounded-2xl", SILVER_RING_SOFT)
    )
    : "shrink-0 w-full px-4 pb-6 pt-3 bg-background/70 backdrop-blur-xl";

  const inputContainerClass = cn(
    isDocumentMode
      ? cn(
        "relative flex flex-col",
        // Glass Background & Blur
        SILVER_GLASS_BG,
        // Premium Border (silver, ultra-thin)
        SILVER_HAIRLINE,
        "border-[#c7c7c7]/55 dark:border-white/10",
        SILVER_HOVER_BORDER_SOFT,
        // Shape & Spacing
        "rounded-[22px] px-3 py-1.5",
        // Elevated Shadow
        SILVER_CONTAINER_SHADOW,
        // Focus State (minimal silver)
        SILVER_CONTAINER_FOCUS,
        "transition-colors duration-200"
      )
      : cn(
        "max-w-3xl mx-auto relative transition-all duration-300 ease-out overflow-visible",
        "bg-white/40 dark:bg-[#0d0d0d]/40 backdrop-blur-2xl",
        "border border-[#A5A0FF]/30",
        "hover:border-[#A5A0FF]/50",
        "rounded-[28px] p-2",
        "shadow-xl shadow-[#A5A0FF]/10",
        "focus-within:ring-4 focus-within:ring-[#A5A0FF]/20 focus-within:border-[#A5A0FF]/70"
      ),
    // Keep these highlights in document mode too
    selectedDocText && "border-primary/20",
    isDraggingOver && cn("border-[#bdbdbd]/85 bg-white/80 ring-2 dark:bg-white/5", SILVER_RING_SOFT)
  );

  return (
    <div
      ref={composerRef}
      className={containerClass}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPasteCapture={handleContainerPasteCapture}
    >
      {isDraggingOver && (
        <div
          className={cn(
            "absolute inset-0 z-50 bg-white/55 dark:bg-zinc-900/35 backdrop-blur-sm rounded-2xl flex items-center justify-center pointer-events-none",
            SILVER_HAIRLINE_DASHED,
            "border-[#c7c7c7]/70 dark:border-white/20"
          )}
        >
          <div className="flex max-w-[760px] flex-col items-center gap-3 px-4 text-zinc-700 dark:text-zinc-200">
            {dragPreviewFiles.length > 0 ? (
              <div className="flex flex-wrap items-start justify-center gap-3">
                {dragPreviewFiles.map((file, index) => (
                  <div
                    key={file.localKey || file.id || `${file.name}-${index}`}
                    className="w-[152px] rounded-2xl border border-white/70 bg-white/85 p-2 shadow-lg shadow-black/5 dark:border-white/10 dark:bg-zinc-900/75"
                  >
                    <div className="mb-2">
                      {renderPreviewTile(file, "drag")}
                    </div>
                    <div className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                      {file.name}
                    </div>
                    <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                      {file.previewStatus === "loading"
                        ? "Detectando preview..."
                        : formatFileSize(file.size)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Upload className="h-8 w-8" />
            )}
            <span className="text-sm font-medium">
              {dragPreviewFiles.length > 0 ? "Suelta para adjuntar estos archivos" : "Suelta los archivos aquí"}
            </span>
          </div>
        </div>
      )}

      {/* Show VirtualComputer in non-document mode when browser session is active */}
      {/* Uses fixed positioning to escape overflow-hidden parent containers */}
      {!isDocumentMode && browserSession.state.status !== "idle" && (
        <div className="fixed left-4 sm:left-6 bottom-24 z-50">
          <VirtualComputer
            state={browserSession.state}
            onCancel={browserSession.cancel}
            compact={true}
          />
        </div>
      )}

      {isDocumentMode && (
        <>
          <div className="absolute left-4 sm:left-6 bottom-[calc(100%+8px)] z-20">
            <VirtualComputer
              state={browserSession.state}
              onCancel={browserSession.cancel}
              compact={true}
            />
          </div>

          {(isBrowserOpen || input.trim().length > 0) && !isBrowserMaximized && (
            <div className="absolute left-4 sm:left-6 bottom-[calc(100%-16px)] w-[120px] border rounded-lg overflow-hidden shadow-lg bg-card z-20 transition-all duration-200">
              <div className="flex items-center justify-between px-1 py-0.5 bg-muted/50 border-b">
                <span className="text-[8px] font-medium text-muted-foreground">Computadora Virtual</span>
                <div className="flex items-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 text-muted-foreground hover:text-foreground"
                    onClick={() => setIsBrowserMaximized(true)}
                  >
                    <Maximize2 className="h-2 w-2" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 text-muted-foreground hover:text-foreground"
                    onClick={() => setIsBrowserOpen(false)}
                  >
                    <X className="h-2 w-2" />
                  </Button>
                </div>
              </div>
              <div className="bg-card relative h-[100px]">
                <iframe
                  src={browserUrl}
                  className="w-full h-full border-0"
                  sandbox="allow-scripts allow-same-origin allow-forms"
                  title="Virtual Browser"
                />
                {isAiBusyState(aiState) && (
                  <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                  </div>
                )}
              </div>
            </div>
          )}

          {isBrowserMaximized && (
            <div className="fixed inset-4 z-50 border rounded-lg overflow-hidden shadow-lg bg-card">
              <div className="flex items-center justify-between px-2 py-1 bg-muted/50 border-b">
                <span className="text-xs font-medium text-muted-foreground">Computadora Virtual</span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => setIsBrowserMaximized(false)}
                  >
                    <Minimize2 className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => { setIsBrowserOpen(false); setIsBrowserMaximized(false); }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <div className="bg-card relative h-[calc(100%-28px)]">
                <iframe
                  src={browserUrl}
                  className="w-full h-full border-0"
                  sandbox="allow-scripts allow-same-origin allow-forms"
                  title="Virtual Browser"
                />
                {isAiBusyState(aiState) && (
                  <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        className="hidden"
        multiple
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.html,.htm,.jpg,.jpeg,.png,.gif,.bmp,.webp,.tif,.tiff"
        data-testid="input-file-upload"
        aria-label="Subir archivos"
      />

      <div className={inputContainerClass}>
        {/* Active tools badges — only show agent mode indicator */}
        {settings.agentMode && (
          <div className="flex items-center gap-1.5 px-3 pb-1">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 text-[10px] font-medium">
              <Bot className="h-2.5 w-2.5" />Agente
            </span>
          </div>
        )}
        {renderAttachmentPreview()}

        {isDocumentMode && selectedDocText && handleDocTextDeselect && (
          <div className="mb-3 animate-in fade-in duration-150" data-testid="selected-doc-text-banner">
            <div className="bg-zinc-200/60 dark:bg-zinc-700/40 rounded-lg px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-300 flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 flex-shrink-0 opacity-70" />
              <span className="truncate flex-1" data-testid="selected-doc-text-preview">
                {selectedDocText.length > 50 ? selectedDocText.substring(0, 50) + '...' : selectedDocText}
              </span>
              <button
                onClick={handleDocTextDeselect}
                className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 flex-shrink-0 p-0.5 rounded hover:bg-zinc-300/50 dark:hover:bg-zinc-600/50 transition-colors"
                aria-label="Deselect text"
                data-testid="button-deselect-doc-text"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}


        <div className="flex flex-col relative">
          {highlightedHtml && (
            <div
              aria-hidden="true"
              className="absolute inset-0 pointer-events-none min-h-[22px] max-h-[180px] w-full whitespace-pre-wrap break-words text-[15px] leading-[1.4] px-3 py-1 text-transparent overflow-hidden"
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          )}
          <Textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onFocus={onTextareaFocus}
              onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                handleMentionKeyDown(e);
                if (showMentionPopover) return;
                handleHistoryNavigation(e);
                const filesStillLoading = isFilesLoading;
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !filesStillLoading && hasContent) {
                  e.preventDefault();
                  handleSubmitWithHistory();
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey && !filesStillLoading && hasContent) {
                  e.preventDefault();
                  handleSubmitWithHistory();
                }
              }}
              onPaste={handlePaste}
              placeholder={placeholder}
              aria-label="Message input"
              aria-describedby="composer-hint"
              className={cn(
                "min-h-[22px] max-h-[180px] w-full resize-none border-0 bg-transparent p-0 shadow-none outline-none focus-visible:!outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 text-[15px] leading-[1.4] overflow-y-auto scrollbar-none px-3 py-1 relative z-[1]",
                highlightedHtml
                  ? "text-transparent caret-zinc-800 dark:caret-zinc-100"
                  : "text-zinc-800 dark:text-zinc-100",
                "placeholder:text-zinc-400/70 dark:placeholder:text-zinc-500/60"
              )}
              rows={1}
            />
          {detectedUrls.length > 0 && (
            <div className="flex items-center gap-1 px-3 py-0.5" data-testid="link-detected-indicator">
              <Link2 className="w-3 h-3 text-blue-500" />
              <span className="text-[11px] text-blue-500 font-medium">
                {detectedUrls.length === 1 ? "Link detectado" : `${detectedUrls.length} links detectados`}
              </span>
            </div>
          )}

          <div className={cn("flex items-center justify-between mt-0.5 pt-0.5 border-t-[0.5px]", SILVER_BORDER_DIVIDER)}>
            <div className="flex items-center gap-1.5">
              {renderToolsPopover()}
              {!isDocumentMode && renderSelectedToolLogo()}
              {renderSelectedDocToolLogo()}

              {showKnowledgeBase && (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-100/80 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400 text-[13px] font-medium" data-testid="knowledge-base-active">
                    <Users className="h-4 w-4" />
                    <span className="max-w-[140px] truncate" data-testid="knowledge-base-label">Conocimientos de la e...</span>
                    <button
                      onClick={() => setShowKnowledgeBase(false)}
                      className="ml-0.5 hover:bg-sky-200/50 dark:hover:bg-sky-800/50 rounded p-0.5 transition-colors focus:outline-none"
                      aria-label="Close knowledge base"
                      data-testid="button-close-knowledge-base"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>

                  {connectedSources.filter(s => getSourceActive(s.id)).map(source => (
                    <div key={source.id} className="flex items-center justify-center w-7 h-7 rounded-lg bg-sky-100/60 dark:bg-sky-900/20 text-sky-600 dark:text-sky-400">
                      {source.icon}
                    </div>
                  ))}

                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-sky-100/60 dark:hover:bg-sky-900/30 text-sky-600 dark:text-sky-400 transition-colors"
                        aria-label="Select sources"
                        data-testid="button-fuentes-dropdown"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-52 p-1 bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700" data-testid="fuentes-popover">
                      <div className="grid gap-0.5">
                        <div className="px-2 py-1 text-[10px] font-medium text-zinc-400 uppercase tracking-wider">
                          Fuentes conectadas
                        </div>

                        {connectedSources.length === 0 ? (
                          <div className="px-2 py-2 text-xs text-zinc-400 text-center">
                            No hay fuentes
                          </div>
                        ) : (
                          connectedSources.map(source => (
                            <SourceListItem
                              key={source.id}
                              icon={source.icon}
                              label={source.name}
                              variant="toggle"
                              checked={getSourceActive(source.id)}
                              onCheckedChange={() => toggleKnowledgeSource(source.id)}
                              data-testid={`source-${source.id}`}
                            />
                          ))
                        )}

                        <div className="border-t border-zinc-100 dark:border-zinc-700 mt-0.5 pt-0.5">
                          <SourceListItem
                            icon={
                              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                                <circle cx="4" cy="8" r="1.5" />
                                <circle cx="8" cy="8" r="1.5" />
                                <circle cx="12" cy="8" r="1.5" />
                                <circle cx="4" cy="4" r="1.5" />
                                <circle cx="8" cy="4" r="1.5" />
                                <circle cx="12" cy="4" r="1.5" />
                              </svg>
                            }
                            label="Conectar más"
                            variant="connect"
                            onConnect={() => onOpenApps?.()}
                            data-testid="source-connect-more"
                          />
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {/* Latency mode selector */}
              {setLatencyMode && (
                <button
                  onClick={() => {
                    const modes = ["auto", "fast", "deep"] as const;
                    const idx = modes.indexOf(latencyMode as any);
                    setLatencyMode(modes[(idx + 1) % modes.length]);
                  }}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  title={`Modo: ${latencyMode === "fast" ? "Rápido" : latencyMode === "deep" ? "Profundo" : "Auto"}`}
                  data-testid="latency-mode-toggle"
                >
                  {latencyMode === "fast" ? "⚡" : latencyMode === "deep" ? "🧠" : "🎯"}
                  <span className="hidden sm:inline">{latencyMode === "fast" ? "Rápido" : latencyMode === "deep" ? "Profundo" : "Auto"}</span>
                </button>
              )}

              {/* Character counter */}
              {input.length > 0 && (
                <span className="text-[11px] text-muted-foreground tabular-nums" data-testid="char-counter">
                  {input.length.toLocaleString('es-ES')} / 10.000
                </span>
              )}

              {/* Keyboard shortcut hint */}
              <span className="hidden sm:flex items-center text-[10px] text-muted-foreground/70">
                <kbd className={SILVER_KBD}>⌘K</kbd>
                <span className="ml-1">comandos</span>
              </span>

              <RecordingPanel
                isRecording={isRecording}
                isPaused={isPaused}
                recordingTime={recordingTime}
                canSend={hasContent}
                onDiscard={discardVoiceRecording}
                onPause={pauseVoiceRecording}
                onResume={resumeVoiceRecording}
                onSend={sendVoiceRecording}
                onToggleRecording={toggleVoiceRecording}
                onOpenVoiceChat={() => setIsVoiceChatOpen(true)}
                onStopChat={handleStopChat}
                onSubmit={handleSubmit}
                aiState={aiState}
                hasContent={hasContent}
                isAgentRunning={isAgentRunning}
                onAgentStop={handleAgentStop}
                isFilesLoading={isFilesLoading}
              />
            </div>
          </div>
        </div>

        {showMentionPopover && filteredSources.length > 0 && (
          <div
            className="absolute bottom-full left-0 mb-2 w-56 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-lg z-50 overflow-hidden"
            data-testid="mention-popover"
          >
            <div className="px-3 py-1.5 text-[11px] font-medium text-zinc-500 border-b border-zinc-100 dark:border-zinc-700 uppercase tracking-wide">
              Fuentes
            </div>
            <div className="py-0.5">
              {filteredSources.map((source, index) => (
                <button
                  key={source.id}
                  onClick={() => insertMention(source)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors text-left",
                    index === mentionIndex && "bg-zinc-100 dark:bg-zinc-700"
                  )}
                  data-testid={`mention-${source.id}`}
                >
                  <div className="flex items-center justify-center w-6 h-6 rounded bg-zinc-100 dark:bg-zinc-700 text-zinc-500">
                    {source.icon}
                  </div>
                  <div className="flex flex-col">
                    <span className="font-medium text-zinc-800 dark:text-zinc-100 text-sm">{source.name}</span>
                    <span className="text-[11px] text-zinc-400">{source.mention}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

      </div>

      <div id="composer-hint" className="text-center text-[10px] text-zinc-400/50 dark:text-zinc-600/60 mt-2 font-normal tracking-wide select-none">
        <span className="sr-only">Press Enter to send, Shift+Enter for new line, or Cmd+Enter to send quickly. </span>
        iliagpt puede cometer errores. Verifica la información importante.
      </div>

    </div>
  );
}
