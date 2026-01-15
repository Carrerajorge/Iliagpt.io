import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useDraft } from "@/hooks/use-draft";
import { 
  Mic,
  MicOff,
  ArrowUp, 
  Plus, 
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

import { Message, FigmaDiagram, storeGeneratedImage, getGeneratedImage, getLastGeneratedImage, storeLastGeneratedImageInfo, generateRequestId, generateClientRequestId, getActiveRun, updateActiveRunStatus, clearActiveRun, hasActiveRun, resolveRealChatId, isPendingChat } from "@/hooks/use-chats";
import { MarkdownRenderer, MarkdownErrorBoundary } from "@/components/markdown-renderer";
import { useAgent } from "@/hooks/use-agent";
import { useBrowserSession } from "@/hooks/use-browser-session";
import { AgentObserver } from "@/components/agent-observer";
import { VirtualComputer } from "@/components/virtual-computer";
import { EnhancedDocumentEditor } from "@/components/ribbon";
import { SpreadsheetEditor } from "@/components/spreadsheet-editor";
import { PPTEditorShellLazy } from "@/lib/lazyComponents";
import { usePptStreaming } from "@/hooks/usePptStreaming";
import { PPT_STREAMING_SYSTEM_PROMPT } from "@/lib/pptPrompts";
import { ETLDialog } from "@/components/etl-dialog";
import { FigmaBlock } from "@/components/figma-block";
import { CodeExecutionBlock } from "@/components/code-execution-block";
import { IliaGPTLogo } from "@/components/iliagpt-logo";
import { ShareChatDialog, ShareIcon } from "@/components/share-chat-dialog";
import { UpgradePlanDialog } from "@/components/upgrade-plan-dialog";
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
import { useConversationStreamRouter, useConversationStreamContent } from "@/stores/conversationStreamRouter";
import { startStreamingRun, appendStreamingDelta, completeStreamingRun, failStreamingRunWithContext, generateRequestId as generateStreamRequestId } from "@/lib/streamEventAdapter";
import { DocumentPreviewPanel, type DocumentPreviewArtifact } from "@/components/document-preview-panel";
import { InlineGmailPreview } from "@/components/inline-gmail-preview";
import { VoiceChatMode } from "@/components/voice-chat-mode";
import { RecordingPanel } from "@/components/recording-panel";
import { Composer } from "@/components/composer";
import { MessageList, parseDocumentBlocks, type DocumentBlock } from "@/components/message-list";
import { KeyboardShortcutsDialog } from "@/components/keyboard-shortcuts-dialog";
// AgentPanel removed - progress is shown inline in chat messages
import { useAuth } from "@/hooks/use-auth";
import { useConversationState } from "@/hooks/use-conversation-state";
import { useAgentMode } from "@/hooks/use-agent-mode";
import { Database, Sparkles, AudioLines } from "lucide-react";
import { useModelAvailability, type AvailableModel } from "@/contexts/ModelAvailabilityContext";
import { getFileTheme, getFileCategory, FileCategory } from "@/lib/fileTypeTheme";
import { UniversalExecutionConsole } from "./universal-execution-console";
import { ExecutionStreamClient, FlatRunState } from "@/lib/executionStreamClient";
import { LiveExecutionConsole } from "./live-execution-console";
import { PricingModal } from "./pricing-modal";

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

const extractTextFromChildren = (children: React.ReactNode): string => {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (!children) return '';
  if (Array.isArray(children)) {
    return children.map(extractTextFromChildren).join('');
  }
  if (React.isValidElement(children)) {
    return extractTextFromChildren((children.props as any)?.children);
  }
  const childArray = React.Children.toArray(children);
  return childArray.map(extractTextFromChildren).join('');
};

const isNumericValue = (text: string): boolean => {
  if (!text || typeof text !== 'string') return false;
  const cleaned = text.trim().replace(/[$€£¥%,\s]/g, '');
  return !isNaN(parseFloat(cleaned)) && isFinite(Number(cleaned)) && cleaned.length > 0;
};

const extractTableData = (children: React.ReactNode): string[][] => {
  const data: string[][] = [];
  const childArray = React.Children.toArray(children);
  childArray.forEach((section: any) => {
    if (section?.props?.children) {
      const rows = React.Children.toArray(section.props.children);
      rows.forEach((row: any) => {
        if (row?.props?.children) {
          const cells = React.Children.toArray(row.props.children);
          const rowData = cells.map((cell: any) => extractTextFromChildren(cell?.props?.children || ''));
          data.push(rowData);
        }
      });
    }
  });
  return data;
};

const downloadTableAsExcel = (children: React.ReactNode) => {
  const data = extractTableData(children);
  if (data.length === 0) return;
  
  let csv = data.map(row => 
    row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tabla_${Date.now()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const copyTableToClipboard = (children: React.ReactNode) => {
  const data = extractTableData(children);
  if (data.length === 0) return;
  const text = data.map(row => row.join('\t')).join('\n');
  navigator.clipboard.writeText(text);
};

const DataTableWrapper = ({children}: {children?: React.ReactNode}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const childArray = React.Children.toArray(children);
  let colCount = 0;
  childArray.forEach((child: any) => {
    if (child?.props?.children) {
      const rows = React.Children.toArray(child.props.children);
      rows.forEach((row: any) => {
        if (row?.props?.children) {
          const cells = React.Children.toArray(row.props.children);
          colCount = Math.max(colCount, cells.length);
        }
      });
    }
  });
  const minWidth = Math.min(Math.max(colCount * 150, 400), 1400);
  
  const handleCopy = () => {
    copyTableToClipboard(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  const renderTable = () => (
    <table className="data-table" style={{ minWidth: `${minWidth}px` }}>
      {children}
    </table>
  );

  return (
    <>
      <div className="table-container group relative my-4">
        <div className="table-actions absolute top-2 right-2 flex gap-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => downloadTableAsExcel(children)}
                className="p-1.5 rounded-md bg-background/90 backdrop-blur-sm border border-border hover:bg-accent transition-colors shadow-sm"
                data-testid="button-download-excel"
              >
                <Download className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Descargar</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setIsFullscreen(true)}
                className="p-1.5 rounded-md bg-background/90 backdrop-blur-sm border border-border hover:bg-accent transition-colors shadow-sm"
                data-testid="button-fullscreen-table"
              >
                <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Ampliar</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleCopy}
                className="p-1.5 rounded-md bg-background/90 backdrop-blur-sm border border-border hover:bg-accent transition-colors shadow-sm"
                data-testid="button-copy-table"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
            </TooltipTrigger>
            <TooltipContent>{copied ? "Copiado" : "Copiar"}</TooltipContent>
          </Tooltip>
        </div>
        <div className="table-wrap">
          {renderTable()}
        </div>
      </div>
      
      {isFullscreen && (
        <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col">
          <div className="flex items-center justify-between p-4 border-b">
            <h3 className="font-semibold">Vista ampliada</h3>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => downloadTableAsExcel(children)}
                data-testid="button-download-excel-fullscreen"
              >
                <Download className="h-4 w-4 mr-2" />
                Descargar
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsFullscreen(false)}
                data-testid="button-close-fullscreen"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <div className="table-wrap">
              {renderTable()}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const CleanDataTableComponents = {
  table: DataTableWrapper,
  thead: ({children}: {children?: React.ReactNode}) => <thead>{children}</thead>,
  tbody: ({children}: {children?: React.ReactNode}) => <tbody>{children}</tbody>,
  tr: ({children}: {children?: React.ReactNode}) => <tr>{children}</tr>,
  th: ({children}: {children?: React.ReactNode}) => {
    const text = extractTextFromChildren(children);
    const isNumeric = isNumericValue(text);
    return (
      <th scope="col" className={isNumeric ? "text-right" : ""}>
        {children}
      </th>
    );
  },
  td: ({children}: {children?: React.ReactNode}) => {
    const text = extractTextFromChildren(children);
    const isNumeric = isNumericValue(text);
    const isLong = text.length > 50;
    return (
      <td className={`${isNumeric ? "text-right" : ""} ${isLong ? "wrap-cell" : ""}`}>
        {children}
      </td>
    );
  }
};

interface StreamingIndicatorProps {
  aiState: "idle" | "thinking" | "responding";
  streamingContent: string;
  onCancel: () => void;
  uiPhase?: 'idle' | 'thinking' | 'console' | 'done';
}

function StreamingIndicator({ aiState, streamingContent, onCancel, uiPhase }: StreamingIndicatorProps) {
  const estimatedTokens = useMemo(() => {
    if (!streamingContent) return 0;
    return Math.ceil(streamingContent.length / 4);
  }, [streamingContent]);

  // Hide completely when in console phase (Super Agent is showing LiveExecutionConsole)
  if (uiPhase === 'console') return null;
  
  if (aiState === "idle") return null;

  return (
    <div className="streaming-indicator-container flex items-center gap-3 px-4 py-2 rounded-lg bg-muted/50 border border-border/50" data-testid="streaming-indicator">
      {aiState === "thinking" && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-muted-foreground" data-testid="typing-indicator">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
          <span className="text-sm text-muted-foreground" data-testid="streaming-indicator-pensando">Pensando...</span>
        </div>
      )}
      
      {aiState === "responding" && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-primary" data-testid="typing-indicator">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
          <span className="text-sm text-muted-foreground">Escribiendo...</span>
          {estimatedTokens > 0 && (
            <span className="token-counter-pulse text-xs text-muted-foreground/70 tabular-nums" data-testid="token-counter">
              ~{estimatedTokens} tokens
            </span>
          )}
        </div>
      )}
      
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={onCancel}
        className="cancel-button-pulse ml-auto h-8 px-3 text-sm font-medium"
        data-testid="button-cancel-streaming"
      >
        <Square className="h-3.5 w-3.5 mr-1.5 fill-current" />
        Detener
      </Button>
    </div>
  );
}

interface ContentBlock {
  id: number;
  type: 'heading1' | 'heading2' | 'heading3' | 'paragraph' | 'list' | 'numberedList' | 'blockquote' | 'table' | 'hr';
  content: string;
  raw: string;
}

function parseContentToBlocks(content: string): ContentBlock[] {
  const lines = content.split('\n');
  const blocks: ContentBlock[] = [];
  let currentBlock: string[] = [];
  let blockId = 0;
  
  const flushBlock = (type: ContentBlock['type'], raw: string) => {
    if (raw.trim()) {
      blocks.push({ id: blockId++, type, content: raw.trim(), raw: raw });
    }
  };
  
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    
    if (line.startsWith('### ')) {
      flushBlock('heading3', line);
    } else if (line.startsWith('## ')) {
      flushBlock('heading2', line);
    } else if (line.startsWith('# ')) {
      flushBlock('heading1', line);
    } else if (line.startsWith('> ')) {
      let quoteLines = [line];
      while (i + 1 < lines.length && lines[i + 1].startsWith('> ')) {
        i++;
        quoteLines.push(lines[i]);
      }
      flushBlock('blockquote', quoteLines.join('\n'));
    } else if (line.match(/^[-*] /)) {
      let listLines = [line];
      while (i + 1 < lines.length && lines[i + 1].match(/^[-*] /)) {
        i++;
        listLines.push(lines[i]);
      }
      flushBlock('list', listLines.join('\n'));
    } else if (line.match(/^\d+\. /)) {
      let listLines = [line];
      while (i + 1 < lines.length && lines[i + 1].match(/^\d+\. /)) {
        i++;
        listLines.push(lines[i]);
      }
      flushBlock('numberedList', listLines.join('\n'));
    } else if (line.startsWith('|')) {
      let tableLines = [line];
      while (i + 1 < lines.length && lines[i + 1].startsWith('|')) {
        i++;
        tableLines.push(lines[i]);
      }
      flushBlock('table', tableLines.join('\n'));
    } else if (line.match(/^[-*_]{3,}$/)) {
      flushBlock('hr', line);
    } else if (line.trim()) {
      let paraLines = [line];
      while (i + 1 < lines.length && lines[i + 1].trim() && 
             !lines[i + 1].startsWith('#') && 
             !lines[i + 1].startsWith('>') && 
             !lines[i + 1].match(/^[-*] /) && 
             !lines[i + 1].match(/^\d+\. /) &&
             !lines[i + 1].startsWith('|') &&
             !lines[i + 1].match(/^[-*_]{3,}$/)) {
        i++;
        paraLines.push(lines[i]);
      }
      flushBlock('paragraph', paraLines.join('\n'));
    }
    i++;
  }
  
  return blocks;
}

interface TextSelection {
  text: string;
  startIndex: number;
  endIndex: number;
}

function EditableDocumentPreview({ 
  content, 
  onChange,
  onSelectionChange
}: { 
  content: string; 
  onChange: (newContent: string) => void;
  onSelectionChange?: (selection: TextSelection | null) => void;
}) {
  const [blocks, setBlocks] = useState<ContentBlock[]>(() => parseContentToBlocks(content));
  const [editingBlockId, setEditingBlockId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    setBlocks(parseContentToBlocks(content));
  }, [content]);
  
  useEffect(() => {
    if (editingBlockId !== null && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editingBlockId]);

  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      return;
    }
    
    const selectedText = selection.toString();
    if (!selectedText.trim()) {
      return;
    }
    
    const startIndex = content.indexOf(selectedText);
    if (startIndex === -1) {
      const normalizedContent = content.replace(/\s+/g, ' ');
      const normalizedSelection = selectedText.replace(/\s+/g, ' ');
      const normalizedStart = normalizedContent.indexOf(normalizedSelection);
      
      if (normalizedStart !== -1) {
        let charCount = 0;
        let realStart = 0;
        for (let i = 0; i < content.length && charCount < normalizedStart; i++) {
          if (!/\s/.test(content[i]) || (i > 0 && !/\s/.test(content[i-1]))) {
            charCount++;
          }
          realStart = i + 1;
        }
        
        onSelectionChange?.({
          text: selectedText,
          startIndex: realStart,
          endIndex: realStart + selectedText.length
        });
      }
      return;
    }
    
    onSelectionChange?.({
      text: selectedText,
      startIndex,
      endIndex: startIndex + selectedText.length
    });
  };
  
  const handleBlockClick = (block: ContentBlock) => {
    setEditingBlockId(block.id);
    setEditingText(block.raw);
  };
  
  const handleSaveBlock = () => {
    if (editingBlockId === null) return;
    
    const newBlocks = blocks.map(b => 
      b.id === editingBlockId 
        ? { ...b, raw: editingText, content: editingText.trim() }
        : b
    );
    setBlocks(newBlocks);
    
    const newContent = newBlocks.map(b => b.raw).join('\n\n');
    onChange(newContent);
    setEditingBlockId(null);
    setEditingText("");
  };
  
  const renderInlineFormatting = (text: string) => {
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let key = 0;
    
    while (remaining.length > 0) {
      const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
      const italicMatch = remaining.match(/\*(.+?)\*/);
      
      if (boldMatch && boldMatch.index !== undefined) {
        if (boldMatch.index > 0) {
          parts.push(<span key={key++}>{remaining.slice(0, boldMatch.index)}</span>);
        }
        parts.push(<strong key={key++} className="font-bold">{boldMatch[1]}</strong>);
        remaining = remaining.slice(boldMatch.index + boldMatch[0].length);
      } else if (italicMatch && italicMatch.index !== undefined && !remaining.startsWith('**')) {
        if (italicMatch.index > 0) {
          parts.push(<span key={key++}>{remaining.slice(0, italicMatch.index)}</span>);
        }
        parts.push(<em key={key++} className="italic">{italicMatch[1]}</em>);
        remaining = remaining.slice(italicMatch.index + italicMatch[0].length);
      } else {
        parts.push(<span key={key++}>{remaining}</span>);
        break;
      }
    }
    
    return parts;
  };
  
  const renderBlock = (block: ContentBlock) => {
    const isEditing = editingBlockId === block.id;
    
    if (isEditing) {
      return (
        <div key={block.id} className="relative">
          <textarea
            ref={textareaRef}
            value={editingText}
            onChange={(e) => setEditingText(e.target.value)}
            onBlur={handleSaveBlock}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setEditingBlockId(null);
                setEditingText("");
              }
            }}
            className="w-full p-3 border-2 border-blue-500 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-sm font-mono resize-none focus:outline-none"
            style={{ minHeight: Math.max(60, editingText.split('\n').length * 24) }}
            data-testid={`textarea-block-${block.id}`}
          />
          <div className="absolute -top-6 left-0 text-xs text-blue-600 bg-blue-100 dark:bg-blue-900 px-2 py-0.5 rounded">
            Editando - Click afuera para guardar
          </div>
        </div>
      );
    }
    
    const baseClass = "cursor-pointer transition-all duration-200 hover:bg-teal-50 dark:hover:bg-teal-900/20 rounded px-2 py-1 -mx-2 border border-transparent hover:border-teal-200 dark:hover:border-teal-800";
    
    switch (block.type) {
      case 'heading1':
        return (
          <h1 
            key={block.id}
            onClick={() => handleBlockClick(block)}
            className={cn("text-4xl font-bold mb-6 mt-2 text-teal-700 dark:text-teal-400 italic", baseClass)}
            style={{ fontFamily: 'Georgia, serif' }}
          >
            {block.content.replace(/^# /, '')}
          </h1>
        );
      case 'heading2':
        return (
          <h2 
            key={block.id}
            onClick={() => handleBlockClick(block)}
            className={cn("text-xl font-bold mb-3 mt-6 text-teal-700 dark:text-teal-400", baseClass)}
          >
            {block.content.replace(/^## /, '')}
          </h2>
        );
      case 'heading3':
        return (
          <h3 
            key={block.id}
            onClick={() => handleBlockClick(block)}
            className={cn("text-lg font-bold mb-2 mt-4 text-foreground", baseClass)}
          >
            {block.content.replace(/^### /, '')}
          </h3>
        );
      case 'paragraph':
        return (
          <p 
            key={block.id}
            onClick={() => handleBlockClick(block)}
            className={cn("mb-3 leading-relaxed text-muted-foreground text-sm", baseClass)}
          >
            {renderInlineFormatting(block.content)}
          </p>
        );
      case 'list':
        return (
          <ul 
            key={block.id}
            onClick={() => handleBlockClick(block)}
            className={cn("list-disc list-inside mb-4 space-y-1", baseClass)}
          >
            {block.content.split('\n').map((item, idx) => (
              <li key={idx} className="text-foreground">
                {renderInlineFormatting(item.replace(/^[-*] /, ''))}
              </li>
            ))}
          </ul>
        );
      case 'numberedList':
        return (
          <ol 
            key={block.id}
            onClick={() => handleBlockClick(block)}
            className={cn("list-decimal list-inside mb-4 space-y-1", baseClass)}
          >
            {block.content.split('\n').map((item, idx) => (
              <li key={idx} className="text-foreground">
                {renderInlineFormatting(item.replace(/^\d+\. /, ''))}
              </li>
            ))}
          </ol>
        );
      case 'blockquote':
        return (
          <blockquote 
            key={block.id}
            onClick={() => handleBlockClick(block)}
            className={cn("border-l-4 border-blue-500 pl-4 italic my-4 py-2 bg-muted", baseClass)}
          >
            {block.content.split('\n').map((line, idx) => (
              <p key={idx} className="text-muted-foreground">
                {renderInlineFormatting(line.replace(/^> /, ''))}
              </p>
            ))}
          </blockquote>
        );
      case 'table':
        const rows = block.content.split('\n').filter(r => !r.match(/^\|[-:| ]+\|$/));
        return (
          <div key={block.id} onClick={() => handleBlockClick(block)} className={baseClass}>
            <table className="w-full border-collapse border border-border my-4">
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={idx} className={idx === 0 ? "bg-muted" : ""}>
                    {row.split('|').filter(c => c.trim()).map((cell, cidx) => (
                      idx === 0 ? (
                        <th key={cidx} className="border border-border px-3 py-2 font-semibold text-left">
                          {cell.trim()}
                        </th>
                      ) : (
                        <td key={cidx} className="border border-border px-3 py-2">
                          {cell.trim()}
                        </td>
                      )
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'hr':
        return <hr key={block.id} className="my-6 border-t-2 border-border" />;
      default:
        return (
          <p key={block.id} onClick={() => handleBlockClick(block)} className={cn("mb-4", baseClass)}>
            {block.content}
          </p>
        );
    }
  };
  
  return (
    <div 
      ref={containerRef}
      className="document-preview space-y-1 select-text"
      onMouseUp={handleTextSelection}
      onDoubleClick={handleTextSelection}
    >
      {blocks.length === 0 ? (
        <p className="text-muted-foreground italic">El documento está vacío. Haz clic para agregar contenido.</p>
      ) : (
        blocks.map(renderBlock)
      )}
    </div>
  );
}

interface ActiveGpt {
  id: string;
  name: string;
  description: string | null;
  systemPrompt: string;
  temperature: string | null;
  topP: string | null;
  welcomeMessage: string | null;
  conversationStarters: string[] | null;
  avatar: string | null;
  capabilities?: {
    webBrowsing?: boolean;
    codeInterpreter?: boolean;
    imageGeneration?: boolean;
    wordCreation?: boolean;
    excelCreation?: boolean;
    pptCreation?: boolean;
  };
}

type AiState = "idle" | "thinking" | "responding";
type AiProcessStep = { step: string; status: "pending" | "active" | "done" };

interface ChatInterfaceProps {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  onSendMessage: (message: Message, targetChatId?: string) => Promise<{ run?: { id: string; chatId: string; userMessageId: string; status: string }; deduplicated?: boolean } | undefined>;
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
  return ['xlsx', 'xls', 'csv', 'pdf', 'docx'].includes(ext || '');
}

async function triggerDocumentAnalysis(
  uploadId: string, 
  filename: string,
  onAnalysisStarted: (analysisId: string) => void
): Promise<void> {
  if (!isAnalyzableFile(filename)) return;
  
  try {
    const response = await fetch(`/api/chat/uploads/${uploadId}/analyze`, {
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
  setActiveRunId: setActiveRunIdProp
}: ChatInterfaceProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  
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
    setInputRaw((prev) => {
      const newValue = typeof value === "function" ? value(prev) : value;
      currentTextRef.current = newValue;
      if (chatId) {
        saveDraftDebounced(chatId, newValue);
      }
      return newValue;
    });
  }, [chatId, saveDraftDebounced, currentTextRef]);
  
  const routedStreamingContent = useConversationStreamContent(chatId);
  const setActiveChatId = useConversationStreamRouter(s => s.setActiveChatId);
  
  const [localStreamingContent, setLocalStreamingContent] = useState("");
  const streamingContent = routedStreamingContent || localStreamingContent;
  const setStreamingContent = setLocalStreamingContent;
  
  useEffect(() => {
    if (chatId) {
      setActiveChatId(chatId);
    }
  }, [chatId, setActiveChatId]);
  
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const [browserUrl, setBrowserUrl] = useState("https://www.google.com");
  const [isBrowserMaximized, setIsBrowserMaximized] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
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
  const [selectedDocTool, setSelectedDocTool] = useState<"word" | "excel" | "ppt" | "figma" | null>(null);
  const [selectedTool, setSelectedTool] = useState<"web" | "agent" | "image" | null>(null);
  const [activeDocEditor, setActiveDocEditor] = useState<{ type: "word" | "excel" | "ppt"; title: string; content: string; showInstructions?: boolean } | null>(null);
  const [minimizedDocument, setMinimizedDocument] = useState<{ type: "word" | "excel" | "ppt"; title: string; content: string; messageId?: string } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isETLDialogOpen, setIsETLDialogOpen] = useState(false);
  const [figmaTokenInput, setFigmaTokenInput] = useState("");
  const [isFigmaConnecting, setIsFigmaConnecting] = useState(false);
  const [isFigmaConnected, setIsFigmaConnected] = useState(false);
  const [showFigmaTokenInput, setShowFigmaTokenInput] = useState(false);
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const [isUpgradeDialogOpen, setIsUpgradeDialogOpen] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [quotaInfo, setQuotaInfo] = useState<{ remaining: number; limit: number; resetAt: string | null; plan: string } | null>(null);
  const [userPlanInfo, setUserPlanInfo] = useState<{ plan: string; isAdmin?: boolean; isPaid?: boolean } | null>(null);
  // isAgentPanelOpen removed - agent progress is shown inline in chat
  const modelSelectorRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const fetchUserPlanInfo = async () => {
      try {
        const response = await fetch("/api/user/usage", { credentials: "include" });
        if (response.ok) {
          const data = await response.json();
          setUserPlanInfo({ 
            plan: data.plan, 
            isAdmin: data.isAdmin, 
            isPaid: data.plan !== "free" 
          });
        }
      } catch (error) {
        console.error("Failed to fetch user plan info:", error);
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
  
  const uiPhaseTimerRef = useRef<NodeJS.Timeout | null>(null);
  
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
      setOptimisticMessages(prev => prev.filter(m => !propsMessageIds.has(m.id)));
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
      // This is a real chat switch - clear optimistic messages
      chatLogger.debug("Clearing optimistic messages (real chat switch)");
      setOptimisticMessages([]);
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
  const allAgentRuns = useAgentStore(state => state.runs);
  
  // Get the active run from the store for the current chat (use reactive allAgentRuns)
  const activeAgentRun = useMemo(() => {
    if (currentAgentMessageId) {
      return allAgentRuns[currentAgentMessageId] || null;
    }
    // Also check if there's an active run for this chatId from the store
    const runs = Object.values(allAgentRuns);
    return runs.find(r => r.chatId === chatId && ['starting', 'queued', 'planning', 'running'].includes(r.status)) || null;
  }, [currentAgentMessageId, allAgentRuns, chatId]);
  
  // Combined messages: prop messages + optimistic messages + agent runs from store
  const displayMessages = useMemo(() => {
    // Start with optimistic messages, then merge prop messages (prop messages take priority)
    const msgMap = new Map(optimisticMessages.map(m => [m.id, m]));
    // Override with prop messages (they are the source of truth once available)
    messages.forEach(m => msgMap.set(m.id, m));
    
    // Merge agent runs from the store into messages (use reactive allAgentRuns)
    Object.entries(allAgentRuns).forEach(([messageId, runState]) => {
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
    
    return Array.from(msgMap.values()).sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [messages, optimisticMessages, allAgentRuns, chatId]);
  
  // Reset current agent message ID when chatId changes - polling auto-starts via useAgentPolling
  useEffect(() => {
    // Find if there's an active run for this chat
    const matchingRun = Object.entries(allAgentRuns).find(
      ([_, run]) => run.chatId === chatId && ['starting', 'queued', 'planning', 'running'].includes(run.status)
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
    if (!selectedModelId) return availableModels[0] || null;
    return availableModels.find(m => m.id === selectedModelId || m.modelId === selectedModelId) || availableModels[0] || null;
  }, [selectedModelId, availableModels]);
  
  const selectedProvider = selectedModelData?.provider || "gemini";
  const selectedModel = selectedModelData?.modelId || "gemini-3-flash-preview";
  
  const modelsByProvider = useMemo(() => {
    const grouped: Record<string, AvailableModel[]> = {};
    availableModels.forEach(model => {
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
  const [isGmailActive, setIsGmailActive] = useState(true);
  const [isVoiceChatOpen, setIsVoiceChatOpen] = useState(false);
  const [isKeyboardShortcutsOpen, setIsKeyboardShortcutsOpen] = useState(false);
  const [screenReaderAnnouncement, setScreenReaderAnnouncement] = useState("");
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [pendingGeneratedImage, setPendingGeneratedImage] = useState<{messageId: string; imageData: string} | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [previewUploadedImage, setPreviewUploadedImage] = useState<{ name: string; dataUrl: string } | null>(null);
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
  } | null>(null);
  const [copiedAttachmentContent, setCopiedAttachmentContent] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const latestGeneratedImageRef = useRef<{messageId: string; imageData: string} | null>(null);
  const dragCounterRef = useRef(0);
  const activeDocEditorRef = useRef<{ type: "word" | "excel" | "ppt"; title: string; content: string; showInstructions?: boolean } | null>(null);
  const previewDocumentRef = useRef<DocumentBlock | null>(null);
  const orchestratorRef = useRef<{ runOrchestrator: (prompt: string) => Promise<void> } | null>(null);
  const editedDocumentContentRef = useRef<string>("");
  const chatIdRef = useRef<string | null>(null);
  const streamingChatIdRef = useRef<string | null>(null);
  const prevAiStateRef = useRef<AiState>("idle");
  
  // Access streaming store actions
  const { startRun, updateStatus, completeRun, failRun, abortRun } = useStreamingStore();
  
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
    if (prevState === "idle" && (aiState === "thinking" || aiState === "responding")) {
      streamingChatIdRef.current = currentChatId;
      if (currentChatId) {
        startRun(currentChatId);
      }
    }
    
    // Update to streaming status
    if (prevState === "thinking" && aiState === "responding") {
      if (streamingChatIdRef.current) {
        updateStatus(streamingChatIdRef.current, 'streaming');
      }
    }
    
    // Complete run when streaming ends
    if ((prevState === "thinking" || prevState === "responding") && aiState === "idle") {
      const completedChatId = streamingChatIdRef.current;
      if (completedChatId) {
        // Get the active chat ID from the current prop (may have changed if user switched chats)
        completeRun(completedChatId, currentChatId);
        streamingChatIdRef.current = null;
      }
    }
  }, [aiState, chatId, startRun, updateStatus, completeRun]);
  
  // Reset streaming state when chatId changes (switching chats)
  // This ensures the new chat starts clean without interference from previous chat
  // NOTE: We do NOT reset aiState here - let it complete naturally for background streaming
  // The aiStateChatId check in the indicator condition prevents bleed-through
  const prevChatIdRef = useRef<string | null | undefined>(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      console.debug(`[ChatInterface] Chat switched from ${prevChatIdRef.current} to ${chatId}`);
      
      if (streamIntervalRef.current) {
        clearInterval(streamIntervalRef.current);
        streamIntervalRef.current = null;
        console.debug('[ChatInterface] Cleared stream interval due to chat switch');
      }
      
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
        console.debug('[ChatInterface] Aborted pending request due to chat switch');
      }
      
      if (analysisAbortControllerRef.current) {
        analysisAbortControllerRef.current.abort();
        analysisAbortControllerRef.current = null;
        console.debug('[ChatInterface] Aborted pending analysis due to chat switch');
      }
      
      // Clear streaming content - the content was for the previous chat
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
  const scrollThrottleMs = 300;

  const scrollToBottom = useCallback((force = false) => {
    if (userHasScrolledUp && !force) return;
    
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ 
        behavior: 'smooth',
        block: 'end'
      });
    });
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

  const prevMessageCountRef = useRef(displayMessages.length);
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    const currentCount = displayMessages.length;
    prevMessageCountRef.current = currentCount;
    
    if (currentCount > prevCount) {
      setUserHasScrolledUp(false);
      scrollToBottom(true);
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
        setRecordingTime(prev => prev + 1);
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
    const checkFigmaStatus = async () => {
      try {
        const response = await fetch("/api/figma/status");
        const data = await response.json();
        setIsFigmaConnected(data.connected);
      } catch (error) {
        console.error("Error checking Figma status:", error);
      }
    };
    
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('figma_connected') === 'true') {
      setIsFigmaConnected(true);
      setIsFigmaConnecting(false);
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (urlParams.get('figma_error')) {
      setIsFigmaConnecting(false);
      window.history.replaceState({}, '', window.location.pathname);
    }
    
    checkFigmaStatus();
  }, []);
  
  // Figma connection handler - OAuth flow
  const handleFigmaConnect = () => {
    setIsFigmaConnecting(true);
    window.location.href = "/api/auth/figma";
  };
  
  const handleFigmaDisconnect = async () => {
    try {
      await fetch("/api/figma/disconnect", { method: "POST" });
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
      word: "<p>Comienza a escribir tu documento aquí...</p>",
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
          const response = await fetch(`/api/chats/${realChatId}/documents`, {
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
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const analysisAbortControllerRef = useRef<AbortController | null>(null);
  const streamIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const streamingContentRef = useRef<string>("");
  const aiStateRef = useRef<"idle" | "thinking" | "responding">("idle");
  const composerRef = useRef<HTMLDivElement>(null);
  const handleStopChatRef = useRef<(() => void) | null>(null);
  
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
      const partialMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: currentContent + "\n\n*[Respuesta detenida por el usuario]*",
        timestamp: new Date(),
      };
      onSendMessage(partialMsg);
    } else {
      // If stopped during "thinking" phase (no content yet), show a stopped message
      const stoppedMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "*[Solicitud cancelada por el usuario]*",
        timestamp: new Date(),
      };
      onSendMessage(stoppedMsg);
    }
    
    // Reset states
    streamingContentRef.current = "";
    setAiState("idle");
    setStreamingContent("");
  };

  // Keep handleStopChatRef in sync for keyboard shortcut access
  useEffect(() => {
    handleStopChatRef.current = handleStopChat;
  });

  const handleCopyMessage = (content: string, msgId?: string) => {
    navigator.clipboard.writeText(content);
    if (msgId) {
      setCopiedMessageId(msgId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    }
  };

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

  const handleOpenDocumentPreview = (doc: DocumentBlock) => {
    setPreviewDocument(doc);
    setEditedDocumentContent(doc.content);
  };

  const handleCloseDocumentPreview = () => {
    setPreviewDocument(null);
    setEditedDocumentContent("");
    setTextSelection(null);
    setEditingSelectionText("");
    setOriginalSelectionText("");
  };

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

  const handleDownloadDocument = async (doc: DocumentBlock) => {
    try {
      const documentToDownload = {
        ...doc,
        content: editedDocumentContent || doc.content
      };
      const response = await fetch("/api/documents/generate", {
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
  };

  const handleDownloadImage = (imageData: string) => {
    const link = document.createElement("a");
    link.href = imageData;
    link.download = `imagen-generada-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleOpenFileAttachmentPreview = async (att: {
    type: string;
    name: string;
    mimeType?: string;
    imageUrl?: string;
    storagePath?: string;
    fileId?: string;
  }) => {
    if (att.type === "image" && att.imageUrl) {
      setLightboxImage(att.imageUrl);
      return;
    }
    
    if (att.type === "image" && att.storagePath) {
      setLightboxImage(att.storagePath);
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
        const response = await fetch(`/api/files/${att.fileId}/content`);
        if (response.ok) {
          const data = await response.json();
          if (data.status === "ready" && data.content) {
            setPreviewFileAttachment(prev => prev ? {
              ...prev,
              content: data.content,
              isLoading: false,
              isProcessing: false,
            } : null);
            return;
          } else if (data.status === "processing" || data.status === "queued") {
            setPreviewFileAttachment(prev => prev ? {
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

    setPreviewFileAttachment(prev => prev ? {
      ...prev,
      isLoading: false,
      isProcessing: false,
      content: "No se pudo cargar el contenido del archivo.",
    } : null);
  };

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
      const response = await fetch(previewFileAttachment.storagePath);
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

  const handleFeedback = (msgId: string, value: "up" | "down") => {
    setMessageFeedback(prev => ({
      ...prev,
      [msgId]: prev[msgId] === value ? null : value
    }));
  };

  const handleShare = async (content: string) => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "MICHAT Response",
          text: content
        });
      } catch (e) {
        navigator.clipboard.writeText(content);
      }
    } else {
      navigator.clipboard.writeText(content);
    }
  };

  const handleReadAloud = (msgId: string, content: string) => {
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
  };

  const handleRegenerate = async (msgIndex: number, instruction?: string) => {
    const prevMessages = messages.slice(0, msgIndex);
    const lastUserMsgIndex = [...prevMessages].reverse().findIndex(m => m.role === "user");
    if (lastUserMsgIndex === -1) return;
    
    const contextUpToUser = prevMessages.slice(0, prevMessages.length - lastUserMsgIndex);
    
    if (chatId && onTruncateMessagesAt) {
      onTruncateMessagesAt(chatId, msgIndex);
    }
    
    setRegeneratingMsgIndex(null);
    setAiState("thinking");
    streamingContentRef.current = "";
    setStreamingContent("");
    
    try {
      abortControllerRef.current = new AbortController();
      
      let chatHistory = contextUpToUser.map(m => ({
        role: m.role,
        content: m.content
      }));

      if (instruction) {
        chatHistory = [
          ...chatHistory,
          { role: "user" as const, content: `[Instrucción de regeneración: ${instruction}]` }
        ];
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chatHistory, provider: selectedProvider, model: selectedModel }),
        signal: abortControllerRef.current.signal
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setAiState("responding");
      const fullContent = data.content;
      let currentIndex = 0;
      
      streamIntervalRef.current = setInterval(() => {
        if (currentIndex < fullContent.length) {
          const chunkSize = Math.floor(Math.random() * 3) + 1;
          const newContent = fullContent.slice(0, currentIndex + chunkSize);
          streamingContentRef.current = newContent;
          setStreamingContent(newContent);
          currentIndex += chunkSize;
        } else {
          if (streamIntervalRef.current) {
            clearInterval(streamIntervalRef.current);
            streamIntervalRef.current = null;
          }
          const aiMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: fullContent,
            timestamp: new Date(),
            webSources: data.webSources,
          };
          onSendMessage(aiMsg);
          streamingContentRef.current = "";
          setStreamingContent("");
          setAiState("idle");
          abortControllerRef.current = null;
        }
      }, 15);
    } catch (error: any) {
      if (error.name === "AbortError") return;
      console.error("Regenerate error:", error);
      
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `Lo siento, hubo un error al regenerar la respuesta: ${error.message || 'Error desconocido'}. Por favor intenta de nuevo.`,
        timestamp: new Date(),
        requestId: generateRequestId(),
      };
      onSendMessage(errorMsg);
      
      if (streamIntervalRef.current) {
        clearInterval(streamIntervalRef.current);
        streamIntervalRef.current = null;
      }
      streamingContentRef.current = "";
      setStreamingContent("");
      setAiState("idle");
      abortControllerRef.current = null;
    }
  };

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

    window.addEventListener("retry-agent-run", handleRetryAgentRun as EventListener);
    return () => {
      window.removeEventListener("retry-agent-run", handleRetryAgentRun as EventListener);
    };
  }, [chatId, agentStore, startAgentRun, toast]);

  const handleStartEdit = (msg: Message) => {
    setEditingMessageId(msg.id);
    setEditContent(msg.content);
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditContent("");
  };

  const handleSendEdit = async (msgId: string) => {
    if (!editContent.trim()) return;
    
    const msgIndex = messages.findIndex(m => m.id === msgId);
    if (msgIndex === -1) return;
    
    const editedContent = editContent.trim();
    setEditingMessageId(null);
    setEditContent("");
    
    if (chatId && onEditMessageAndTruncate) {
      onEditMessageAndTruncate(chatId, msgId, editedContent, msgIndex);
    }
    
    setAiState("thinking");
    streamingContentRef.current = "";
    setStreamingContent("");
    
    abortControllerRef.current = new AbortController();
    
    try {
      const historyUpToEdit = messages.slice(0, msgIndex).map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content
      }));
      historyUpToEdit.push({ role: "user", content: editedContent });
      
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      
      setAiState("idle");
      abortControllerRef.current = null;
      
    } catch (error: any) {
      if (error.name === "AbortError") {
        setAiState("idle");
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
      setAiState("idle");
      abortControllerRef.current = null;
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    await processFilesForUpload(Array.from(files));

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const pollFileStatus = async (fileId: string, trackingId: string) => {
    const maxAttempts = 30;
    let attempts = 0;

    const checkStatus = async () => {
      try {
        const contentRes = await fetch(`/api/files/${fileId}/content`);
        
        if (!contentRes.ok && contentRes.status !== 202) {
          setUploadedFiles((prev) =>
            prev.map((f) => (f.id === fileId || f.id === trackingId ? { ...f, id: fileId, status: "error" } : f))
          );
          return;
        }
        
        const contentData = await contentRes.json();

        if (contentData.status === "ready") {
          setUploadedFiles((prev) =>
            prev.map((f) => (f.id === fileId || f.id === trackingId 
              ? { ...f, id: fileId, status: "ready", content: contentData.content } 
              : f))
          );
          return;
        } else if (contentData.status === "error") {
          setUploadedFiles((prev) =>
            prev.map((f) => (f.id === fileId || f.id === trackingId ? { ...f, id: fileId, status: "error" } : f))
          );
          return;
        }

        attempts++;
        if (attempts >= maxAttempts) {
          setUploadedFiles((prev) =>
            prev.map((f) => (f.id === fileId || f.id === trackingId ? { ...f, status: "error" } : f))
          );
          console.warn(`File ${fileId} processing timed out`);
          return;
        }
        setTimeout(checkStatus, 2000);
      } catch (error) {
        console.error("Error polling file status:", error);
        setUploadedFiles((prev) =>
          prev.map((f) => (f.id === fileId || f.id === trackingId ? { ...f, status: "error" } : f))
        );
      }
    };

    setTimeout(checkStatus, 2000);
  };

  const removeFile = (index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const ALLOWED_TYPES = [
    "text/plain",
    "text/markdown", 
    "text/csv",
    "text/html",
    "application/json",
    "application/pdf",
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

  const MAX_FILE_SIZE_MB = 100;
  const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

  const processFilesForUpload = async (files: File[]) => {
    const oversizedFiles = files.filter(file => file.size > MAX_FILE_SIZE_BYTES);
    const invalidTypeFiles = files.filter(file => 
      !ALLOWED_TYPES.includes(file.type) && !file.type.startsWith("image/")
    );
    
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
    
    const validFiles = files.filter(file => 
      (ALLOWED_TYPES.includes(file.type) || file.type.startsWith("image/")) &&
      file.size <= MAX_FILE_SIZE_BYTES
    );
    
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
      if (isImage) {
        dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
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
      setUploadedFiles((prev) => [...prev, tempFile]);

      const doUpload = async (): Promise<void> => {
        try {
          const urlRes = await fetch("/api/objects/upload", { method: "POST" });
          const { uploadURL, storagePath } = await urlRes.json();
          if (!uploadURL || !storagePath) throw new Error("No upload URL received");

          const uploadRes = await fetch(uploadURL, {
            method: "PUT",
            headers: { "Content-Type": file.type },
            body: file,
          });
          if (!uploadRes.ok) throw new Error("Upload failed");

          let spreadsheetData: UploadedFile['spreadsheetData'] | undefined;
          
          if (isExcel) {
            try {
              const formData = new FormData();
              formData.append('file', file);
              
              const spreadsheetRes = await fetch('/api/spreadsheet/upload', {
                method: 'POST',
                body: formData,
              });
              
              if (spreadsheetRes.ok) {
                const spreadsheetResult = await spreadsheetRes.json();
                const uploadId = spreadsheetResult.id;
                const sheetDetails = spreadsheetResult.sheetDetails || [];
                const sheets = sheetDetails.map((s: any) => ({
                  name: s.name,
                  rowCount: s.rowCount,
                  columnCount: s.columnCount,
                }));
                
                spreadsheetData = {
                  uploadId,
                  sheets,
                };
                
                if (spreadsheetResult.firstSheetPreview) {
                  spreadsheetData.previewData = {
                    headers: spreadsheetResult.firstSheetPreview.headers || [],
                    data: spreadsheetResult.firstSheetPreview.data || [],
                  };
                }
                
                triggerDocumentAnalysis(uploadId, file.name, (analysisId) => {
                  setUploadedFiles((prev) =>
                    prev.map((f) => f.id === tempId ? { ...f, analysisId } : f)
                  );
                });
              }
            } catch (spreadsheetError) {
              console.warn("Failed to parse spreadsheet:", spreadsheetError);
            }
          }

          if (isImage) {
            const registerRes = await fetch("/api/files/quick", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: file.name, type: file.type, size: file.size, storagePath }),
            });
            const registeredFile = await registerRes.json();
            if (!registerRes.ok) throw new Error(registeredFile.error);
            
            setUploadedFiles((prev) =>
              prev.map((f) => f.id === tempId ? { ...f, id: registeredFile.id, storagePath, status: "ready" } : f)
            );
          } else {
            setUploadedFiles((prev) =>
              prev.map((f) => f.id === tempId ? { ...f, status: "processing", spreadsheetData } : f)
            );
            
            const registerRes = await fetch("/api/files", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: file.name, type: file.type, size: file.size, storagePath }),
            });
            const registeredFile = await registerRes.json();
            if (!registerRes.ok) throw new Error(registeredFile.error);

            setUploadedFiles((prev) =>
              prev.map((f) => f.id === tempId ? { ...f, id: registeredFile.id, storagePath, spreadsheetData } : f)
            );

            pollFileStatusFast(registeredFile.id, tempId);
            
            if (isAnalyzableFile(file.name) && !isExcel) {
              triggerDocumentAnalysis(registeredFile.id, file.name, (analysisId) => {
                setUploadedFiles((prev) =>
                  prev.map((f) => f.id === registeredFile.id || f.id === tempId ? { ...f, analysisId } : f)
                );
              });
            }
          }
        } catch (error) {
          console.error("File upload error:", error);
          setUploadedFiles((prev) =>
            prev.map((f) => (f.id === tempId ? { ...f, status: "error" } : f))
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
      console.log("[waitForPendingUploads] Waiting for", promises.length, "uploads to complete");
      await Promise.all(promises);
      console.log("[waitForPendingUploads] All uploads complete");
    }
  };
  
  const pollFileStatusFast = async (fileId: string, trackingId: string) => {
    const maxTime = 3000;
    const pollInterval = 200;
    const startTime = Date.now();

    const checkStatus = async (): Promise<void> => {
      if (Date.now() - startTime > maxTime) {
        setUploadedFiles((prev) =>
          prev.map((f) => (f.id === fileId || f.id === trackingId 
            ? { ...f, id: fileId, status: "ready", content: "" } 
            : f))
        );
        return;
      }

      try {
        const contentRes = await fetch(`/api/files/${fileId}/content`);
        
        if (!contentRes.ok && contentRes.status !== 202) {
          setUploadedFiles((prev) =>
            prev.map((f) => (f.id === fileId || f.id === trackingId ? { ...f, id: fileId, status: "error" } : f))
          );
          return;
        }
        
        const contentData = await contentRes.json();

        if (contentData.status === "ready") {
          setUploadedFiles((prev) =>
            prev.map((f) => (f.id === fileId || f.id === trackingId 
              ? { ...f, id: fileId, status: "ready", content: contentData.content } 
              : f))
          );
          return;
        } else if (contentData.status === "error") {
          setUploadedFiles((prev) =>
            prev.map((f) => (f.id === fileId || f.id === trackingId ? { ...f, id: fileId, status: "error" } : f))
          );
          return;
        }

        setTimeout(checkStatus, pollInterval);
      } catch (error) {
        console.error("Polling error:", error);
        setUploadedFiles((prev) =>
          prev.map((f) => (f.id === fileId || f.id === trackingId 
            ? { ...f, id: fileId, status: "ready", content: "" } 
            : f))
        );
      }
    };

    checkStatus();
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const filesToUpload: File[] = [];

    for (const item of Array.from(items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          const mimeType = file.type || item.type || "image/png";
          const ext = mimeType.split("/")[1] || "png";
          const fileName = file.name && file.name !== "image.png" && file.name !== "" 
            ? file.name 
            : `pasted-${Date.now()}.${ext}`;
          const renamedFile = new File([file], fileName, { type: mimeType });
          filesToUpload.push(renamedFile);
        }
      }
    }

    if (filesToUpload.length > 0) {
      e.preventDefault();
      await processFilesForUpload(filesToUpload);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer?.types?.includes("Files")) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDraggingOver(false);

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    await processFilesForUpload(Array.from(files));
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
    console.log("[handleSubmit] called with input:", input, "selectedTool:", selectedTool);
    
    // Wait for any pending uploads to complete before proceeding
    if (pendingUploadsRef.current.size > 0) {
      console.log("[handleSubmit] Waiting for", pendingUploadsRef.current.size, "pending uploads...");
      await waitForPendingUploads();
      console.log("[handleSubmit] All pending uploads completed");
    }
    
    // Don't submit if files are still uploading/processing (double-check state after waiting)
    const filesStillLoading = uploadedFiles.some(f => f.status === "uploading" || f.status === "processing");
    if (filesStillLoading) {
      console.log("[handleSubmit] files still loading after wait, returning");
      return;
    }
    
    // Allow submit if: there's input text, OR there are files, OR there's selected doc text with instruction
    const hasInput = input.trim().length > 0;
    const hasFiles = uploadedFiles.length > 0;
    const hasSelectionWithInstruction = selectedDocText && input.trim();
    
    console.log("[handleSubmit] hasInput:", hasInput, "hasFiles:", hasFiles);
    if (!hasInput && !hasFiles && !hasSelectionWithInstruction) {
      console.log("[handleSubmit] no content to submit, returning");
      return;
    }

    // Handle Agent mode - show in chat, not side panel
    if (selectedTool === "agent") {
      try {
        const userMessageContent = input;
        const attachments = uploadedFiles.map(f => ({
          id: f.id,
          name: f.name,
          type: f.type,
          spreadsheetData: f.spreadsheetData
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
        };
        // Show message immediately (optimistic update)
        setOptimisticMessages(prev => [...prev, userMessage]);
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
          setOptimisticMessages(prev => prev.filter(m => m.id !== userMessage.id));
          toast({ 
            title: "Error", 
            description: "No se pudo iniciar el agente. Por favor, inicia sesión para usar esta función.", 
            variant: "destructive" 
          });
        }
      } catch (error) {
        console.error("Failed to start agent run:", error);
        // Remove the optimistic message since the agent failed to start
        setOptimisticMessages(prev => prev.filter(m => m.id !== userMessage.id));
        toast({ title: "Error", description: "Error al iniciar el agente", variant: "destructive" });
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
      setAiState("thinking");
      
      try {
        abortControllerRef.current = new AbortController();
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
        setAiState("idle");
        abortControllerRef.current = null;
        return;
      } catch (error: any) {
        if (error.name !== "AbortError") {
          console.error("Rewrite error:", error);
        }
        setAiState("idle");
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
    
    if (isGenerationRequest || hasEditPattern) {
      console.log("[handleSubmit] Generation/Edit pattern detected - checking image context...");
      
      // Set thinking state
      setAiState("thinking");
      setAiProcessSteps([
        { step: "Procesando tu solicitud", status: "active" },
        { step: "Generando contenido", status: "pending" }
      ]);
      
      const generationInput = input;
      setInput("");
      if (chatId) {
        clearDraft(chatId);
      }
      
      // Add user message to chat
      const userMsgId = Date.now().toString();
      const userMsg: Message = {
        id: userMsgId,
        role: "user",
        content: generationInput,
        timestamp: new Date(),
        requestId: generateRequestId(),
      };
      // Show message immediately (optimistic update)
      setOptimisticMessages(prev => [...prev, userMsg]);
      onSendMessage(userMsg);
      
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
          setAiProcessSteps([
            { step: "Procesando edición de imagen", status: "active" },
            { step: "Editando imagen", status: "pending" }
          ]);
        }
        
        // Direct call to /api/chat for generation - bypasses SSE/runs system
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [...messages.map(m => ({ role: m.role, content: m.content })), { role: "user", content: generationInput }],
            provider: selectedProvider,
            model: selectedModel,
            lastImageBase64,
            lastImageId,
          })
        });
        
        setAiProcessSteps(prev => prev.map((s, i) => 
          i === 0 ? { ...s, status: "done" as const } : { ...s, status: "active" as const }
        ));
        
        if (response.status === 402) {
          const errorData = await response.json();
          if (errorData.code === "QUOTA_EXCEEDED" && errorData.quota) {
            setQuotaInfo(errorData.quota);
            setShowPricingModal(true);
            setAiState("idle");
            setAiProcessSteps([]);
            return;
          }
        }
        
        const data = await response.json();
        
        if (response.ok && data.content) {
          setAiProcessSteps(prev => prev.map(s => ({ ...s, status: "done" as const })));
          
          const aiMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: data.content,
            timestamp: new Date(),
            requestId: generateRequestId(),
            userMessageId: userMsgId,
            artifact: data.artifact,
            webSources: data.webSources,
          };
          onSendMessage(aiMsg);
        } else {
          const errorMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: data.error || "Error al procesar la solicitud. Por favor, intenta de nuevo.",
            timestamp: new Date(),
            requestId: generateRequestId(),
            userMessageId: userMsgId,
          };
          onSendMessage(errorMsg);
        }
      } catch (error) {
        console.error("[Generation] Error:", error);
        const errorMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "Error de conexión. Por favor, intenta de nuevo.",
          timestamp: new Date(),
          requestId: generateRequestId(),
          userMessageId: userMsgId,
        };
        onSendMessage(errorMsg);
      }
      
      setAiState("idle");
      setAiProcessSteps([]);
      return;
    }
    
    // Check if this is a Super Agent research request with sources
    const superAgentCheck = shouldUseSuperAgent(input);
    if (superAgentCheck.use) {
      console.log("[handleSubmit] Super Agent detected:", superAgentCheck.reason);
      
      const userInput = input;
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
      setOptimisticMessages(prev => [...prev, userMessage]);
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
      setOptimisticMessages(prev => [...prev, assistantMessage]);
      
      // Start Super Agent run in store
      const { startRun, updateState, completeRun } = useSuperAgentStore.getState();
      startRun(superAgentMessageId);
      
      // Generate run ID on frontend to enable immediate LiveExecutionConsole display
      const frontendRunId = `run_${crypto.randomUUID()}`;
      console.log('[uiPhase] runId created, uiPhase=thinking', { runId: frontendRunId });
      
      // Set uiPhase to 'thinking' immediately (shows spinner for max 2s)
      setUiPhase('thinking');
      
      // Start grace window timer - transition to 'console' phase after 2000ms
      if (uiPhaseTimerRef.current) {
        clearTimeout(uiPhaseTimerRef.current);
      }
      uiPhaseTimerRef.current = setTimeout(() => {
        console.log('[uiPhase] Grace window expired, uiPhase=console');
        setUiPhase('console');
      }, 2000);
      
      setActiveRunId(frontendRunId);
      
      // Set up SSE stream by making POST request
      setAiState("thinking");
      
      try {
        const response = await fetch("/api/super/stream", {
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
                    case "progress":
                      updates = {
                        phase: eventData.phase || currentState.phase,
                        progress: eventData,
                      };
                      break;
                    case "source_signal":
                      const existingIdx = currentState.sources.findIndex(s => s.id === eventData.id);
                      if (existingIdx >= 0) {
                        const newSources = [...currentState.sources];
                        newSources[existingIdx] = eventData;
                        updates = { sources: newSources };
                      } else {
                        updates = { sources: [...currentState.sources, eventData] };
                      }
                      break;
                    case "source_deep":
                      const deepIdx = currentState.sources.findIndex(s => s.id === eventData.id);
                      if (deepIdx >= 0) {
                        const newSources = [...currentState.sources];
                        newSources[deepIdx] = { ...newSources[deepIdx], ...eventData, fetched: true };
                        updates = { sources: newSources };
                      }
                      break;
                    case "artifact":
                      updates = { artifacts: [...currentState.artifacts, eventData] };
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
                    case "error":
                      updates = {
                        error: eventData.message || "Error en Super Agent",
                        phase: "error",
                        isRunning: false,
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
          setOptimisticMessages(prev => 
            prev.map(m => m.id === superAgentMessageId ? finalAssistantMessage : m)
          );
          onSendMessage(finalAssistantMessage);
          
          completeRun(superAgentMessageId, finalResult);
          setActiveRunId(null);
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
        
        setOptimisticMessages(prev => 
          prev.map(m => m.id === superAgentMessageId ? errorMessage : m)
        );
        onSendMessage(errorMessage);
        setActiveRunId(null);
      }
      
      setAiState("idle");
      setAiProcessSteps([]);
      return;
    }
    
    // Auto-detect if task requires Agent mode (only for non-generation complex tasks)
    const hasAttachedFiles = uploadedFiles.length > 0;
    const complexityCheck = shouldAutoActivateAgent(input, hasAttachedFiles);
    
    if (!isGenerationRequest && complexityCheck.agent_required && complexityCheck.confidence === 'high') {
      console.log("[handleSubmit] Auto-activating Agent mode:", complexityCheck.agent_reason);
      
      const userMessageContent = input;
      const readyFiles = uploadedFiles.filter(f => f.status === "ready");
      const agentAttachments = readyFiles.map(f => ({
        id: f.id,
        name: f.name,
        type: f.type,
        spreadsheetData: f.spreadsheetData
      }));
      
      setInput("");
      if (chatId) {
        clearDraft(chatId);
      }
      setUploadedFiles([]);
      
      const agentMessageId = `agent-${Date.now()}`;
      setCurrentAgentMessageId(agentMessageId);
      
      try {
        const result = await startAgentRun(
          chatId || "",
          userMessageContent,
          agentMessageId,
          agentAttachments
        );
        
        if (result) {
          toast({
            title: "Modo Agente activado",
            description: complexityCheck.agent_reason || "Tarea compleja detectada",
            duration: 4000,
          });
          
          const userMessage: Message = {
            id: `user-${Date.now()}`,
            role: "user",
            content: userMessageContent,
            timestamp: new Date(),
          };
          // Show message immediately (optimistic update)
          setOptimisticMessages(prev => [...prev, userMessage]);
          onSendMessage(userMessage);
          
          setSelectedTool(null);
          if (result.chatId && (!chatId || chatId.startsWith("pending-") || chatId === "")) {
            window.dispatchEvent(new CustomEvent("select-chat", { detail: { chatId: result.chatId, preserveKey: true } }));
          }
        } else {
          // Agent failed - DON'T return, fall through to normal chat processing
          console.log("[handleSubmit] Agent mode failed, falling back to chat");
          setInput(userMessageContent);
          setUploadedFiles(readyFiles);
          setCurrentAgentMessageId(null);
          // Continue to normal chat processing below instead of returning
        }
      } catch (error) {
        console.error("Failed to auto-start agent run:", error);
        // Agent failed - DON'T return, fall through to normal chat processing
        setInput(userMessageContent);
        setUploadedFiles(readyFiles);
        setCurrentAgentMessageId(null);
        // Continue to normal chat processing below instead of returning
      }
      
      // Only return if agent succeeded (result is truthy)
      if (useAgentStore.getState().runs[agentMessageId]?.runId) {
        return;
      }
    }

    const attachments = uploadedFiles
      .filter(f => f.status === "ready" || f.status === "processing")
      .map(f => ({
        type: f.type.startsWith("image/") ? "image" as const :
              f.type.includes("word") || f.type.includes("document") ? "word" as const :
              f.type.includes("sheet") || f.type.includes("excel") ? "excel" as const :
              f.type.includes("presentation") || f.type.includes("powerpoint") ? "ppt" as const :
              "word" as const,
        name: f.name,
        mimeType: f.type,
        imageUrl: f.dataUrl,
        storagePath: f.storagePath,
        fileId: f.id,
        spreadsheetData: f.spreadsheetData,
      }));
    
    // Set thinking state FIRST to show stop button immediately
    setAiState("thinking");
    streamingContentRef.current = "";
    setStreamingContent("");
    
    const userInput = input;
    const currentFiles = [...uploadedFiles];
    
    // Reset uiPhase to 'idle' for regular (non-Super Agent) messages
    if (uiPhase !== 'idle') {
      console.log('[uiPhase] Reset to idle for regular message');
      setUiPhase('idle');
    }
    // Clear any pending uiPhase timer
    if (uiPhaseTimerRef.current) {
      clearTimeout(uiPhaseTimerRef.current);
      uiPhaseTimerRef.current = null;
    }
    
    // Initialize process steps based on context (reuse hasAttachedFiles from above)
    const initialSteps: {step: string; status: "pending" | "active" | "done"}[] = [];
    if (hasAttachedFiles) {
      initialSteps.push({ step: "Analizando archivos adjuntos", status: "active" });
    }
    initialSteps.push({ step: "Procesando tu mensaje", status: hasAttachedFiles ? "pending" : "active" });
    initialSteps.push({ step: "Buscando información relevante", status: "pending" });
    initialSteps.push({ step: "Generando respuesta", status: "pending" });
    setAiProcessSteps(initialSteps);
    setInput("");
    if (chatId) {
      clearDraft(chatId);
    }
    setUploadedFiles([]);

    // Generate unique IDs for idempotency
    const userMsgId = Date.now().toString();
    const userRequestId = generateRequestId(); // Unique ID for user message
    const clientRequestId = generateClientRequestId(); // For run-based idempotency
    // Note: Each assistant message generates its own unique requestId inline
    // Idempotency is handled in addMessage via markRequestProcessing
    
    const userMsg: Message = {
      id: userMsgId,
      role: "user",
      content: userInput,
      timestamp: new Date(),
      requestId: userRequestId,
      clientRequestId, // For run-based idempotency - creates atomic user message + run
      status: 'pending',
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    console.log("[handleSubmit] sending user message:", userMsg, "chatId:", chatId);
    
    // CRITICAL: Add user message to UI IMMEDIATELY (optimistic update)
    // This ensures the user sees their message with attachments right away,
    // before any async operations like document analysis begin
    console.log("[handleSubmit] Adding optimistic message, current count:", optimisticMessages.length);
    setOptimisticMessages(prev => {
      console.log("[handleSubmit] setOptimisticMessages: prev count:", prev.length, "adding:", userMsg.id);
      return [...prev, userMsg];
    });
    
    // DATA_MODE: Pre-check if we have document attachments that need analysis
    // This must happen BEFORE onSendMessage to avoid race conditions with chat navigation
    const isDocumentFileLegacyPrecheck = (mimeType: string, fileName: string, type?: string): boolean => {
      const lowerMime = (mimeType || "").toLowerCase();
      const lowerName = (fileName || "").toLowerCase();
      const lowerType = (type || "").toLowerCase();
      
      if (lowerType === "image" || lowerMime.startsWith("image/")) return false;
      
      const docMimePatterns = ["pdf", "word", "document", "sheet", "excel", "spreadsheet", "presentation", "powerpoint", "csv", "text/plain", "text/csv", "application/json"];
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
    
    const hasDocumentAttachmentsPrecheck = attachments.some(a => isDocumentFileLegacyPrecheck(a.mimeType || String(a.type), a.name, String(a.type)));
    
    // Store pre-fetched analysis result to use later (prevents race condition)
    let preFetchedAnalysisResult: { 
      answer_text?: string; 
      ui_components?: any[]; 
      documentModel?: any; 
      insights?: string[];
      suggestedQuestions?: string[];
    } | null = null;
    
    // If we have document attachments, execute analysis BEFORE calling onSendMessage
    // This prevents race condition where chat navigation interrupts the fetch
    // The result is stored and used later in the legacy flow
    // Use a DEDICATED controller for pre-fetch to not interfere with main abortControllerRef
    if (hasDocumentAttachmentsPrecheck) {
      console.log("[handleSubmit] DATA_MODE (Pre-send): Executing document analysis BEFORE chat navigation");
      
      // Create a dedicated abort controller for the pre-fetch, stored in shared ref for cancellation
      analysisAbortControllerRef.current = new AbortController();
      
      try {
        // Clean attachments for server
        const cleanedAttachments = attachments.map((att: any) => {
          const { spreadsheetData, previewData, ...rest } = att;
          const normalizedType = ['word', 'excel', 'pdf', 'ppt', 'text', 'csv'].includes(rest.type?.toLowerCase?.()) 
            ? 'document' 
            : (rest.type === 'image' ? 'image' : 'document');
          return { ...rest, type: normalizedType };
        });
        
        const effectiveConversationId = chatId || `temp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        const finalChatHistoryPrecheck = [
          ...messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          { role: "user", content: userInput }
        ];
        
        console.log("[handleSubmit] Pre-send: Fetching /api/analyze with attachments:", cleanedAttachments.map((a: any) => ({ name: a.name, storagePath: a.storagePath })));
        
        const analyzeResponse = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: finalChatHistoryPrecheck,
            attachments: cleanedAttachments,
            conversationId: effectiveConversationId
          }),
          signal: analysisAbortControllerRef.current.signal
        });
        
        console.log("[handleSubmit] Pre-send: Analyze response status:", analyzeResponse.status);
        
        if (analyzeResponse.ok) {
          preFetchedAnalysisResult = await analyzeResponse.json();
          console.log("[handleSubmit] Pre-send: Analysis successful, stored for later use");
        } else {
          const errorData = await analyzeResponse.json().catch(() => ({ error: "Unknown error" }));
          console.error("[handleSubmit] Pre-send: Analyze error:", analyzeResponse.status, errorData);
          // Fall through to normal flow if analysis fails
        }
      } catch (analyzeError: any) {
        if (analyzeError?.name === "AbortError") {
          console.log("[handleSubmit] Pre-send: Analysis was cancelled by user");
          setAiState("idle");
          setAiProcessSteps([]);
          analysisAbortControllerRef.current = null;
          return; // User cancelled, don't continue
        } else {
          console.error("[handleSubmit] Pre-send: Analysis failed:", analyzeError?.message || analyzeError);
        }
        // Fall through to normal flow
      } finally {
        analysisAbortControllerRef.current = null; // Clear the ref after analysis completes
      }
    }
    
    // Send user message and get run info for SSE streaming
    const messageResult = await onSendMessage(userMsg);
    console.log("[handleSubmit] messageResult:", messageResult);
    const runInfo = messageResult?.run;

    // Check for Google Forms intent
    const { hasMention, cleanPrompt } = extractMentionFromPrompt(userInput);
    const formIntent = detectFormIntent(cleanPrompt, isGoogleFormsActive, hasMention);
    
    if (formIntent.hasFormIntent && formIntent.confidence !== 'low') {
      // Create file context from uploaded files
      const fileContext = currentFiles
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
      
      onSendMessage(formPreviewMsg);
      // Note: markRequestComplete is called inside addMessage after persistence
      setAiState("idle");
      setAiProcessSteps([]);
      return;
    }

    // Check for Gmail intent
    const hasGmailMention = userInput.toLowerCase().includes('@gmail');
    const gmailIntent = detectGmailIntent(cleanPrompt, isGmailActive, hasGmailMention);
    
    if (gmailIntent.hasGmailIntent && gmailIntent.confidence !== 'low') {
      setAiState("thinking");
      setAiProcessSteps([
        { step: "Buscando en tu correo electrónico", status: "active" },
        { step: "Analizando correos encontrados", status: "pending" },
        { step: "Generando respuesta inteligente", status: "pending" }
      ]);
      
      try {
        const fullMessages = messages.map(m => ({ role: m.role, content: m.content }));
        fullMessages.push({ role: "user", content: cleanPrompt });
        
        const chatResponse = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            messages: fullMessages,
            conversationId: chatId,
            useRag: true
          })
        });
        
        setAiProcessSteps(prev => prev.map((s, i) => 
          i === 0 ? { ...s, status: "done" as const } : 
          i === 1 ? { ...s, status: "active" as const } : s
        ));
        
        if (chatResponse.ok) {
          const data = await chatResponse.json();
          
          setAiProcessSteps(prev => prev.map(s => ({ ...s, status: "done" as const })));
          
          const gmailResponseMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: data.content || "No se pudo obtener una respuesta.",
            timestamp: new Date(),
            requestId: generateRequestId(),
            userMessageId: userMsgId,
            webSources: data.webSources,
          };
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
        onSendMessage(gmailErrorMsg);
      }
      
      setAiState("idle");
      setAiProcessSteps([]);
      return;
    }

    // Check if Excel is open and prompt is complex - route through orchestrator
    const isExcelEditorOpen = (activeDocEditorRef.current?.type === "excel") || (previewDocumentRef.current?.type === "excel");
    if (isExcelEditorOpen && isComplexExcelPrompt(cleanPrompt) && orchestratorRef.current) {
      setAiState("thinking");
      setAiProcessSteps([
        { step: "Analizando estructura del workbook", status: "active" },
        { step: "Creando hojas y datos", status: "pending" },
        { step: "Aplicando fórmulas y gráficos", status: "pending" }
      ]);
      
      try {
        await orchestratorRef.current.runOrchestrator(cleanPrompt);
        
        setAiProcessSteps(prev => prev.map(s => ({ ...s, status: "done" as const })));
        
        const orchestratorMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "✅ Workbook generado exitosamente con múltiples hojas, datos, fórmulas y gráficos. Revisa el editor de Excel para ver los resultados.",
          timestamp: new Date(),
          requestId: generateRequestId(),
          userMessageId: userMsgId
        };
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
        onSendMessage(errorMsg);
      }
      
      setAiState("idle");
      setAiProcessSteps([]);
      return;
    }

    try {
      abortControllerRef.current = new AbortController();
      
      // Check if this is an image generation request (manual tool selection or auto-detect)
      const isImageTool = selectedTool === "image";
      let shouldGenerateImage = isImageTool;
      
      // CRITICAL FIX: When files are attached, NEVER auto-detect image generation
      // Files indicate document analysis intent, not image generation
      // Auto-detect image requests ONLY if no tool is selected AND no files attached
      if (!isImageTool && !selectedTool && !selectedDocTool && !hasAttachedFiles) {
        try {
          const detectRes = await fetch("/api/image/detect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: userInput })
          });
          const detectData = await detectRes.json();
          shouldGenerateImage = detectData.isImageRequest;
        } catch (e) {
          console.error("Image detection error:", e);
        }
      }
      
      // If files are attached, log that we're skipping image detection
      if (hasAttachedFiles && !isImageTool) {
        console.log(`[ChatInterface] Files attached (${currentFiles.length}), skipping image auto-detection - will process as document analysis`);
      }
      
      // Generate image if needed
      if (shouldGenerateImage) {
        setIsGeneratingImage(true);
        setAiProcessSteps([
          { step: "Analizando tu petición", status: "done" },
          { step: "Generando imagen con IA", status: "active" },
          { step: "Procesando resultado", status: "pending" }
        ]);
        
        try {
          const imageRes = await fetch("/api/image/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: userInput }),
            signal: abortControllerRef.current.signal
          });
          
          const imageData = await imageRes.json();
          
          if (imageRes.ok && imageData.success) {
            setAiProcessSteps(prev => prev.map(s => ({ ...s, status: "done" as const })));
            
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
              fetch("/api/library", {
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
            onSendMessage(aiMsg);
            
            setIsGeneratingImage(false);
            setAiState("idle");
            setAiProcessSteps([]);
            setSelectedTool(null);
            abortControllerRef.current = null;
            return;
          } else {
            throw new Error(imageData.error || "Error al generar imagen");
          }
        } catch (imgError: any) {
          setIsGeneratingImage(false);
          if (imgError.name === "AbortError") {
            setAiState("idle");
            setAiProcessSteps([]);
            abortControllerRef.current = null;
            return;
          }
          // If image generation fails, continue with normal chat to explain
          console.error("Image generation failed:", imgError);
        }
      }
      
      const fileContents = currentFiles
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
      const imageDataUrls = currentFiles
        .filter(f => f.type.startsWith("image/") && f.dataUrl)
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
      let finalChatHistory: Array<{role: string; content: string}> = chatHistory;
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

      // Use SSE streaming if we have run info, otherwise fall back to legacy fetch
      if (runInfo && chatId) {
        // SSE streaming mode - real-time streaming from server
        setAiState("responding");
        
        // Update steps: mark processing done, searching active
        setAiProcessSteps(prev => prev.map((s, i) => {
          if (s.step.includes("Analizando")) return { ...s, status: "done" };
          if (s.step.includes("Procesando")) return { ...s, status: "done" };
          if (s.step.includes("Buscando")) return { ...s, status: "active" };
          return s;
        }));

        let fullContent = "";
        let sseError: Error | null = null;
        
        // Resolve immutable conversation ID for routing (freeze before stream starts)
        // Use real chatId, not "pending-xxx" placeholder to ensure correct routing
        const routingConversationId = chatId.startsWith('pending-') ? chatId : chatId;
        let streamRequestId: string | null = null;

        try {
          // Helper function to robustly detect if a file is a document (not an image)
          // Uses mimeType AND file extension for reliable detection
          const isDocumentFile = (mimeType: string, fileName: string): boolean => {
            const lowerMime = (mimeType || "").toLowerCase();
            const lowerName = (fileName || "").toLowerCase();
            
            // Check for explicit image MIME types first
            if (lowerMime.startsWith("image/")) return false;
            
            // Document MIME types
            const docMimePatterns = [
              "pdf", "word", "document", "sheet", "excel", 
              "spreadsheet", "presentation", "powerpoint", "csv",
              "text/plain", "text/csv", "application/json"
            ];
            if (docMimePatterns.some(p => lowerMime.includes(p))) return true;
            
            // Document file extensions
            const docExtensions = [
              ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
              ".csv", ".txt", ".json", ".rtf", ".odt", ".ods", ".odp"
            ];
            if (docExtensions.some(ext => lowerName.endsWith(ext))) return true;
            
            // If mimeType is empty/unknown and has no extension, treat as document (safer)
            if (!lowerMime || lowerMime === "application/octet-stream") return true;
            
            return false;
          };

          // Build attachments array for streaming endpoint
          const streamAttachments = currentFiles
            .filter(f => f.status === "ready" || f.status === "processing")
            .map(f => ({
              type: f.type.startsWith("image/") ? "image" as const :
                    f.type.includes("pdf") ? "pdf" as const :
                    f.type.includes("word") || f.type.includes("document") ? "word" as const :
                    f.type.includes("sheet") || f.type.includes("excel") ? "excel" as const :
                    f.type.includes("presentation") || f.type.includes("powerpoint") ? "ppt" as const :
                    "document" as const,
              name: f.name,
              mimeType: f.type,
              storagePath: f.storagePath,
              fileId: f.id,
              content: f.content,
            }));
          
          // Robust document detection using both mimeType AND file extension
          const hasDocumentAttachments = currentFiles
            .filter(f => f.status === "ready" || f.status === "processing")
            .some(f => isDocumentFile(f.type, f.name));
          
          // Use /analyze endpoint for document analysis (DATA_MODE) to prevent image generation
          if (hasDocumentAttachments) {
            console.log("[handleSubmit] DATA_MODE: Using /analyze endpoint for document analysis");
            const analyzeResponse = await fetch("/api/analyze", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                messages: finalChatHistory,
                attachments: streamAttachments,
                conversationId: chatId
              }),
              signal: abortControllerRef.current?.signal
            });
            
            if (!analyzeResponse.ok) {
              const errorData = await analyzeResponse.json().catch(() => ({ error: "Unknown error" }));
              throw new Error(errorData.message || errorData.error || `Analysis failed: ${analyzeResponse.status}`);
            }
            
            const analyzeResult = await analyzeResponse.json();
            
            // Create assistant message with analysis results
            const analysisMsg: Message = {
              id: (Date.now() + 1).toString(),
              role: "assistant",
              content: analyzeResult.answer_text || "No se pudo analizar el documento.",
              timestamp: new Date(),
              requestId: generateRequestId(),
              userMessageId: userMsgId,
              ui_components: analyzeResult.ui_components || [],
              documentAnalysis: analyzeResult.documentModel ? {
                documentModel: analyzeResult.documentModel,
                insights: analyzeResult.insights || [],
                suggestedQuestions: analyzeResult.suggestedQuestions || [],
              } : undefined,
            };
            onSendMessage(analysisMsg);
            
            setAiState("idle");
            setAiProcessSteps([]);
            abortControllerRef.current = null;
            return;
          }
          
          const response = await fetch("/api/chat/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: finalChatHistory,
              conversationId: chatId,
              runId: runInfo.id,
              chatId: chatId,
              attachments: streamAttachments.length > 0 ? streamAttachments : undefined
            }),
            signal: abortControllerRef.current?.signal
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
            throw new Error(errorData.error || `SSE streaming failed: ${response.status}`);
          }

          // Check if response indicates already processed (not SSE)
          const contentType = response.headers.get("Content-Type") || "";
          if (contentType.includes("application/json")) {
            const jsonData = await response.json();
            if (jsonData.status === "already_done" || jsonData.status === "already_processing") {
              // Run was already processed, skip streaming
              console.log("[SSE] Run already processed, skipping streaming");
              setAiState("idle");
              setAiProcessSteps([]);
              agent.complete();
              abortControllerRef.current = null;
              return;
            }
          }

          // Update steps: mark searching done, generating active
          setAiProcessSteps(prev => prev.map(s => {
            if (s.step.includes("Buscando")) return { ...s, status: "done" };
            if (s.step.includes("Generando")) return { ...s, status: "active" };
            return { ...s, status: s.status === "pending" ? "pending" : "done" };
          }));

          // Start PPT streaming if in PPT mode
          if (isPptMode && shouldWriteToDoc) {
            pptStreaming.startStreaming();
            streamingContentRef.current = "";
            setStreamingContent("");
          }

          // Process SSE stream
          const reader = response.body?.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let lastSeq = -1; // Track last processed sequence for ordering
          let currentEventType = "chunk"; // Track current event type
          let streamComplete = false;
          
          // Initialize routed streaming with conversation affinity
          streamRequestId = generateStreamRequestId();
          const streamAssistantMsgId = startStreamingRun(routingConversationId, streamRequestId, userMsgId);
          console.log('[SSE] Started routed streaming:', { routingConversationId, streamRequestId, streamAssistantMsgId });

          if (!reader) {
            if (streamRequestId) {
              failStreamingRunWithContext(routingConversationId, streamRequestId, 'NO_READER', 'No response body for SSE streaming');
            }
            throw new Error("No response body for SSE streaming");
          }

          while (!streamComplete) {
            const { done, value } = await reader.read();
            
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            
            // Parse SSE events from buffer
            const lines = buffer.split("\n");
            buffer = lines.pop() || ""; // Keep incomplete line in buffer
            
            for (const line of lines) {
              // Track event type for the next data line
              if (line.startsWith("event: ")) {
                currentEventType = line.slice(7).trim();
                continue;
              }
              
              if (line.startsWith("data: ")) {
                let data: any;
                try {
                  data = JSON.parse(line.slice(6));
                } catch (parseErr) {
                  // Ignore parse errors for heartbeat or malformed data
                  console.debug('[SSE] Parse error, skipping line:', line);
                  continue;
                }
                
                // Skip out-of-order sequences for deduplication
                if (typeof data.sequenceId === 'number') {
                  if (data.sequenceId <= lastSeq) {
                    console.debug(`[SSE] Skipping out-of-order seq ${data.sequenceId} (lastSeq: ${lastSeq})`);
                    continue;
                  }
                  lastSeq = data.sequenceId;
                }
                
                // Handle completion events (done or complete)
                if (currentEventType === 'complete' || currentEventType === 'done' || data.done === true) {
                  console.debug('[SSE] Stream complete event received');
                  streamComplete = true;
                  break;
                }
                
                // Handle error events
                if (currentEventType === 'error') {
                  throw new Error(data.error || 'SSE stream error');
                }
                
                // Handle chunk events with content
                if (currentEventType === 'chunk' && data.content) {
                  fullContent += data.content;
                  
                  // Route delta through conversation affinity system
                  appendStreamingDelta(streamRequestId, data.content);
                  
                  // Update UI based on mode
                  if (isPptMode && shouldWriteToDoc) {
                    pptStreaming.processChunk(data.content);
                  } else if (isExcelMode && shouldWriteToDoc) {
                    // Excel mode: show streaming indicator in chat, data goes to Excel at end
                    streamingContentRef.current = fullContent;
                    setStreamingContent(fullContent);
                  } else if (isWordMode && shouldWriteToDoc && docInsertContentRef.current) {
                    try {
                      // Word mode: Cumulative HTML mode
                      const newContentHTML = markdownToTipTap(fullContent);
                      const cumulativeHTML = existingDocHTML + separatorHTML + newContentHTML;
                      docInsertContentRef.current(cumulativeHTML, 'html');
                      setEditedDocumentContent(cumulativeHTML);
                    } catch (err) {
                      console.error('[ChatInterface] Error streaming to document:', err);
                    }
                  } else {
                    // Normal chat mode - streaming content comes from router now
                    streamingContentRef.current = fullContent;
                  }
                }
                
                // Reset event type after processing data
                currentEventType = "chunk";
              }
            }
          }
        } catch (err: any) {
          if (err.name === "AbortError") {
            // User cancelled - clean up routed stream and return
            if (streamRequestId) {
              useConversationStreamRouter.getState().abortRun(routingConversationId, streamRequestId);
            }
            if (isPptMode && pptStreaming.isStreaming) {
              pptStreaming.stopStreaming();
            }
            streamingContentRef.current = "";
            setStreamingContent("");
            setAiState("idle");
            setAiProcessSteps([]);
            abortControllerRef.current = null;
            return;
          }
          sseError = err;
        }

        // Handle completion
        if (sseError) {
          // Fail the routed stream
          if (streamRequestId) {
            failStreamingRunWithContext(routingConversationId, streamRequestId, 'SSE_ERROR', sseError.message || 'Stream error');
          }
          throw sseError;
        }

        // Finalize based on mode
        console.log('[ChatInterface] Finalize check:', { isPptMode, isExcelMode, isWordMode, shouldWriteToDoc, hasInsertFn: !!docInsertContentRef.current, fullContentLength: fullContent.length });
        if (isPptMode && shouldWriteToDoc) {
          pptStreaming.stopStreaming();
          
          const confirmMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: "✓ Presentación generada correctamente",
            timestamp: new Date(),
            requestId: generateRequestId(),
            userMessageId: userMsgId,
          };
          await onSendMessage(confirmMsg, routingConversationId);
        } else if (isExcelMode && shouldWriteToDoc && docInsertContentRef.current) {
          // Excel mode: send raw CSV data to Excel editor for cell-by-cell streaming
          try {
            console.log('[ChatInterface] Excel streaming: sending', fullContent.length, 'chars to Excel');
            // Clear streaming content first
            streamingContentRef.current = "";
            setStreamingContent("");
            // Send raw CSV data to Excel - insertContentFn will handle the streaming animation
            await docInsertContentRef.current(fullContent);
          } catch (err) {
            console.error('[ChatInterface] Error streaming to Excel:', err);
          }
          
          const confirmMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: "✓ Datos generados en la hoja de cálculo",
            timestamp: new Date(),
            requestId: generateRequestId(),
            userMessageId: userMsgId,
          };
          await onSendMessage(confirmMsg, routingConversationId);
        } else if (isWordMode && shouldWriteToDoc && docInsertContentRef.current) {
          try {
            // Word mode: Cumulative HTML mode
            const newContentHTML = markdownToTipTap(fullContent);
            const cumulativeHTML = existingDocHTML + separatorHTML + newContentHTML;
            docInsertContentRef.current(cumulativeHTML, 'html');
            setEditedDocumentContent(cumulativeHTML);
          } catch (err) {
            console.error('[ChatInterface] Error finalizing document:', err);
          }
          
          const confirmMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: "✓ Documento generado correctamente",
            timestamp: new Date(),
            requestId: generateRequestId(),
            userMessageId: userMsgId,
          };
          await onSendMessage(confirmMsg, routingConversationId);
        } else {
          // Normal chat mode - create final assistant message
          const aiMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: fullContent,
            timestamp: new Date(),
            requestId: generateRequestId(),
            userMessageId: userMsgId,
          };
          await onSendMessage(aiMsg, routingConversationId);
        }

        // Complete the routed stream
        if (streamRequestId) {
          completeStreamingRun(streamRequestId, fullContent);
          console.log('[SSE] Completed routed streaming:', { routingConversationId, streamRequestId });
        }

        streamingContentRef.current = "";
        setStreamingContent("");
        setAiState("idle");
        setAiProcessSteps([]);
        agent.complete();
        abortControllerRef.current = null;
      } else {
        // Legacy mode - fall back to non-streaming /api/chat for Figma diagrams or when no run info
        // DATA_MODE: Robust detection using mimeType and file extension (reuse same logic)
        const isDocumentFileLegacy = (mimeType: string, fileName: string, type?: string): boolean => {
          const lowerMime = (mimeType || "").toLowerCase();
          const lowerName = (fileName || "").toLowerCase();
          const lowerType = (type || "").toLowerCase();
          
          if (lowerType === "image" || lowerMime.startsWith("image/")) return false;
          
          const docMimePatterns = ["pdf", "word", "document", "sheet", "excel", "spreadsheet", "presentation", "powerpoint", "csv", "text/plain", "text/csv", "application/json"];
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
        
        const hasDocumentAttachments = attachments.some(a => isDocumentFileLegacy(a.mimeType || a.type, a.name, a.type));
        
        // Use pre-fetched result if available (prevents race condition)
        // Note: We send the analysis result and then continue with normal flow (no early return)
        if (hasDocumentAttachments && preFetchedAnalysisResult) {
          console.log("[handleSubmit] DATA_MODE (Legacy): Using pre-fetched analysis result");
          
          // Send analysis result as assistant message
          const analysisMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: preFetchedAnalysisResult.answer_text || "Análisis del documento completado.",
            timestamp: new Date(),
            requestId: generateRequestId(),
            userMessageId: userMsgId,
            ui_components: preFetchedAnalysisResult.ui_components || [],
            documentAnalysis: preFetchedAnalysisResult.documentModel ? {
              documentModel: preFetchedAnalysisResult.documentModel,
              insights: preFetchedAnalysisResult.insights || [],
              suggestedQuestions: preFetchedAnalysisResult.suggestedQuestions || [],
            } : undefined,
          };
          onSendMessage(analysisMsg);
          
          // Complete the flow and return - document analysis is a complete response
          setAiState("idle");
          setAiProcessSteps([]);
          abortControllerRef.current = null;
          return;
        } else if (hasDocumentAttachments && !preFetchedAnalysisResult) {
          // Pre-fetch failed, try again (fallback - shouldn't normally happen)
          console.log("[handleSubmit] DATA_MODE (Legacy): Pre-fetch failed, falling back to /api/analyze fetch");
          
          const cleanedAttachments = attachments.map((att: any) => {
            const { spreadsheetData, previewData, ...rest } = att;
            const normalizedType = ['word', 'excel', 'pdf', 'ppt', 'text', 'csv'].includes(rest.type?.toLowerCase?.()) 
              ? 'document' 
              : (rest.type === 'image' ? 'image' : 'document');
            return { ...rest, type: normalizedType };
          });
          
          const effectiveConversationId = chatId || `temp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
          
          // Create a new AbortController for the fallback fetch (stored in shared ref for cancellation)
          analysisAbortControllerRef.current = new AbortController();
          
          try {
            const analyzeResponse = await fetch("/api/analyze", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                messages: finalChatHistory,
                attachments: cleanedAttachments,
                conversationId: effectiveConversationId
              }),
              signal: analysisAbortControllerRef.current.signal
            });
            
            if (analyzeResponse.ok) {
              const analyzeResult = await analyzeResponse.json();
              
              const analysisMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: analyzeResult.answer_text || "Análisis del documento completado.",
                timestamp: new Date(),
                requestId: generateRequestId(),
                userMessageId: userMsgId,
                ui_components: analyzeResult.ui_components || [],
                documentAnalysis: analyzeResult.documentModel ? {
                  documentModel: analyzeResult.documentModel,
                  insights: analyzeResult.insights || [],
                  suggestedQuestions: analyzeResult.suggestedQuestions || [],
                } : undefined,
              };
              onSendMessage(analysisMsg);
              
              setAiState("idle");
              setAiProcessSteps([]);
              analysisAbortControllerRef.current = null;
              return;
            } else {
              const errorData = await analyzeResponse.json().catch(() => ({ error: "Unknown error" }));
              const errorMessage = errorData?.error?.message || errorData?.message || errorData?.error || `Analysis failed: ${analyzeResponse.status}`;
              throw new Error(typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage));
            }
          } catch (fetchError: any) {
            if (fetchError?.name === "AbortError") {
              console.log("[handleSubmit] Fallback fetch was aborted by user");
              setAiState("idle");
              setAiProcessSteps([]);
              analysisAbortControllerRef.current = null;
              return;
            }
            throw fetchError;
          } finally {
            analysisAbortControllerRef.current = null;
          }
        }
        
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
        setAiProcessSteps(prev => prev.map((s, i) => {
          if (s.step.includes("Analizando")) return { ...s, status: "done" };
          if (s.step.includes("Procesando")) return { ...s, status: "done" };
          if (s.step.includes("Buscando")) return { ...s, status: "active" };
          return s;
        }));
        
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
        setAiProcessSteps(prev => prev.map(s => {
          if (s.step.includes("Buscando")) return { ...s, status: "done" };
          if (s.step.includes("Generando")) return { ...s, status: "active" };
          return { ...s, status: s.status === "pending" ? "pending" : "done" };
        }));

        const fullContent = data.content;
        const responseSources = data.sources || [];
        const figmaDiagram = data.figmaDiagram as FigmaDiagram | undefined;
        const responseArtifact = data.artifact;
        const responseWebSources = data.webSources;
        
        // If Figma diagram was generated, add it to chat with simulated streaming
        if (figmaDiagram) {
          setAiState("responding");
          
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
              
              const aiMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: fullContent,
                timestamp: new Date(),
                requestId: generateRequestId(),
                userMessageId: userMsgId,
                figmaDiagram,
                webSources: responseWebSources,
              };
              onSendMessage(aiMsg);
              
              streamingContentRef.current = "";
              setStreamingContent("");
              setAiState("idle");
              setAiProcessSteps([]);
              setSelectedDocTool(null);
              agent.complete();
              abortControllerRef.current = null;
            }
          }, 10);
          return;
        }
        
        // Legacy simulated streaming for other cases
        setAiState("responding");
        
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
            const confirmMsg: Message = {
              id: (Date.now() + 1).toString(),
              role: "assistant",
              content: "✓ Datos generados en la hoja de cálculo",
              timestamp: new Date(),
              requestId: generateRequestId(),
              userMessageId: userMsgId,
            };
            onSendMessage(confirmMsg);
          } catch (err) {
            console.error('[ChatInterface] Error streaming to Excel (legacy):', err);
            const aiMsg: Message = {
              id: (Date.now() + 1).toString(),
              role: "assistant",
              content: fullContent,
              timestamp: new Date(),
              requestId: generateRequestId(),
              userMessageId: userMsgId,
            };
            onSendMessage(aiMsg);
          }
          streamingContentRef.current = "";
          setStreamingContent("");
          setAiState("idle");
          setAiProcessSteps([]);
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
              
              const confirmMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: "✓ Documento generado correctamente",
                timestamp: new Date(),
                requestId: generateRequestId(),
                userMessageId: userMsgId,
              };
              onSendMessage(confirmMsg);
            } else {
              const aiMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: fullContent,
                timestamp: new Date(),
                requestId: generateRequestId(),
                userMessageId: userMsgId,
                sources: responseSources.length > 0 ? responseSources : undefined,
                artifact: responseArtifact,
                webSources: responseWebSources,
              };
              onSendMessage(aiMsg);
            }
            
            streamingContentRef.current = "";
            setStreamingContent("");
            setAiState("idle");
            setAiProcessSteps([]);
            agent.complete();
            abortControllerRef.current = null;
          }
        }, 15);
      }
      
    } catch (error: any) {
      // Clean up PPT streaming on any error
      if (pptStreaming.isStreaming) {
        pptStreaming.stopStreaming();
      }
      
      if (error.name === "AbortError") {
        return;
      }
      
      // Enhanced error logging for debugging
      const errorMessage = error?.message || error?.toString?.() || JSON.stringify(error) || 'Error desconocido';
      console.error("Chat error:", error, "Message:", errorMessage, "Stack:", error?.stack);
      
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `Lo siento, hubo un error al procesar tu mensaje: ${errorMessage}. Por favor intenta de nuevo.`,
        timestamp: new Date(),
        requestId: generateRequestId(),
        userMessageId: userMsgId,
      };
      onSendMessage(errorMsg);
      setAiState("idle");
      setAiProcessSteps([]);
      abortControllerRef.current = null;
    }
  };

  const hasMessages = displayMessages.length > 0;

  return (
    <div className="flex h-full flex-col bg-transparent relative">
      {/* Header */}
      <header className="flex h-14 items-center justify-between px-2 sm:px-4 border-b border-white/20 dark:border-white/10 glass-card-light dark:glass-card rounded-none z-10 sticky top-0 flex-shrink-0 safe-area-top">
        <div ref={modelSelectorRef} className="flex items-center gap-1 sm:gap-2 relative min-w-0 ml-12 sm:ml-0">
          {activeGpt ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <div 
                  className="flex items-center gap-1 sm:gap-2 cursor-pointer hover:bg-muted/50 px-1.5 sm:px-2 py-1 rounded-md transition-colors mt-[-5px] mb-[-5px] pt-[8px] pb-[8px] pl-[7px] pr-[7px]"
                  data-testid="button-gpt-menu"
                >
                  <span className="font-semibold text-xs sm:text-sm truncate max-w-[150px] sm:max-w-[250px]">
                    {activeGpt.name}
                  </span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="flex items-center gap-2">
                    <span className="flex-1">Modelo</span>
                    <span className="text-xs text-muted-foreground">{selectedModelData?.name?.split(" ")[0] || "Auto"}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="w-56">
                      {Object.entries(modelsByProvider).map(([provider, models], providerIndex) => (
                        <React.Fragment key={provider}>
                          {providerIndex > 0 && <DropdownMenuSeparator />}
                          <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
                            {provider === "xai" ? "xAI" : provider === "gemini" ? "Google Gemini" : provider}
                          </div>
                          {models.map((model) => (
                            <DropdownMenuItem
                              key={model.id}
                              className={cn("flex items-center gap-2", selectedModelData?.id === model.id && "bg-muted")}
                              onClick={() => setSelectedModelId(model.id)}
                            >
                              {selectedModelData?.id === model.id && <Check className="h-4 w-4" />}
                              <span className={cn(selectedModelData?.id !== model.id && "pl-6")}>{model.name}</span>
                            </DropdownMenuItem>
                          ))}
                        </React.Fragment>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onNewChat} className="flex items-center gap-2">
                  <Pencil className="h-4 w-4" />
                  <span>Nuevo chat</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onAboutGpt?.(activeGpt)} className="flex items-center gap-2">
                  <Info className="h-4 w-4" />
                  <span>Acerca de</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onEditGpt?.(activeGpt)} className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  <span>Editar GPT</span>
                </DropdownMenuItem>
                {isGptPinned?.(activeGpt.id) ? (
                  <DropdownMenuItem onClick={() => onHideGptFromSidebar?.(activeGpt.id)} className="flex items-center gap-2">
                    <EyeOff className="h-4 w-4" />
                    <span>Ocultar de la barra lateral</span>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => onPinGptToSidebar?.(activeGpt.id)} className="flex items-center gap-2">
                    <Pin className="h-4 w-4" />
                    <span>Fijar en la barra lateral</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/gpts/${activeGpt.id}`);
                    toast({ title: "Enlace copiado", description: "El enlace del GPT se ha copiado al portapapeles" });
                  }} 
                  className="flex items-center gap-2"
                >
                  <Link className="h-4 w-4" />
                  <span>Copiar enlace</span>
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => toast({ title: "Valorar GPT", description: "Esta función estará disponible próximamente" })}
                  className="flex items-center gap-2"
                >
                  <Star className="h-4 w-4" />
                  <span>Valorar GPT</span>
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => toast({ title: "Denunciar GPT", description: "Puedes reportar contenido inapropiado a soporte" })}
                  className="flex items-center gap-2 text-destructive"
                >
                  <Flag className="h-4 w-4" />
                  <span>Denunciar GPT</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : !isAnyModelAvailable ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div 
                  className="flex items-center gap-1 sm:gap-2 bg-gray-200 dark:bg-gray-700 px-1.5 sm:px-2 py-1 rounded-md cursor-not-allowed opacity-60"
                  data-testid="button-model-selector-disabled"
                >
                  <span className="font-semibold text-xs sm:text-sm truncate max-w-[120px] sm:max-w-none text-gray-500 dark:text-gray-400">
                    Sin modelos activos
                  </span>
                  <ChevronDown className="h-3 w-3 text-gray-400 flex-shrink-0" />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>No hay modelos disponibles. Un administrador debe activar al menos un modelo.</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <>
              <div 
                className="flex items-center gap-1 sm:gap-2 cursor-pointer hover:bg-muted/50 px-1.5 sm:px-2 py-1 rounded-md transition-colors mt-[-5px] mb-[-5px] pt-[8px] pb-[8px] pl-[7px] pr-[7px]"
                onClick={() => setIsModelSelectorOpen(!isModelSelectorOpen)}
                data-testid="button-model-selector"
              >
                <span className="font-semibold text-xs sm:text-sm truncate max-w-[120px] sm:max-w-none">
                  {selectedModelData?.name || "Seleccionar modelo"}
                </span>
                <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              </div>
              
              {isModelSelectorOpen && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-popover border border-border rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
                  <div className="p-2">
                    {Object.entries(modelsByProvider).map(([provider, models], providerIndex) => (
                      <div key={provider}>
                        {providerIndex > 0 && <div className="border-t border-border my-2"></div>}
                        <div className="text-xs font-medium text-muted-foreground mb-2 px-2 capitalize">
                          {provider === "xai" ? "xAI" : provider === "gemini" ? "Google Gemini" : provider}
                        </div>
                        {models.map((model) => (
                          <button
                            key={model.id}
                            className={`w-full text-left px-3 py-2 rounded-md hover:bg-muted/50 text-sm ${
                              selectedModelData?.id === model.id ? "bg-muted" : ""
                            }`}
                            onClick={() => { 
                              setSelectedModelId(model.id); 
                              setIsModelSelectorOpen(false); 
                            }}
                            data-testid={`model-option-${model.modelId}`}
                          >
                            <div className="font-medium">{model.name}</div>
                            {model.description && (
                              <div className="text-xs text-muted-foreground">{model.description}</div>
                            )}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-0.5 sm:gap-1">
          {(!userPlanInfo || (userPlanInfo.plan === "free" && !userPlanInfo.isAdmin && !userPlanInfo.isPaid)) && (
            <Button
              variant="outline"
              size="sm"
              className="hidden sm:flex rounded-full text-xs gap-1.5 px-3 border-primary/30 bg-primary/5 hover:bg-primary/10"
              onClick={() => setIsUpgradeDialogOpen(true)}
              data-testid="button-upgrade-header"
            >
              <Sparkles className="h-3 w-3 text-primary" />
              <span className="hidden md:inline">Mejorar el plan a Go</span>
              <span className="md:hidden">Upgrade</span>
            </Button>
          )}
          {chatId && !chatId.startsWith("pending-") ? (
            <ShareChatDialog chatId={chatId} chatTitle={messages[0]?.content?.slice(0, 30) || "Chat"}>
              <Button variant="ghost" size="icon" data-testid="button-share-chat">
                <ShareIcon size={20} />
              </Button>
            </ShareChatDialog>
          ) : (
            <Button 
              variant="ghost" 
              size="icon" 
              data-testid="button-share-chat-disabled"
              disabled
              title="Envía un mensaje para poder compartir este chat"
            >
              <ShareIcon size={20} />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" data-testid="button-chat-options">
                <MoreHorizontal className="h-5 w-5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52" sideOffset={5}>
              <DropdownMenuItem
                onClick={(e) => chatId && onPinChat?.(chatId, e as unknown as React.MouseEvent)}
                disabled={!chatId || chatId.startsWith("pending-")}
                data-testid="menu-pin-chat"
              >
                <Pin className="h-4 w-4 mr-2" />
                {isPinned ? "Desfijar" : "Fijar chat"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  if (chatId && onEditChatTitle) {
                    const newTitle = prompt("Nuevo título del chat:", messages[0]?.content?.slice(0, 50) || "Chat");
                    if (newTitle && newTitle.trim()) {
                      onEditChatTitle(chatId, newTitle.trim());
                    }
                  }
                }}
                disabled={!chatId || chatId.startsWith("pending-")}
                data-testid="menu-edit-chat"
              >
                <Pencil className="h-4 w-4 mr-2" />
                Editar
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger 
                  disabled={!chatId || chatId.startsWith("pending-")}
                  data-testid="menu-move-folder"
                >
                  <Folder className="h-4 w-4 mr-2" />
                  Mover a carpeta
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    {folders.length > 0 ? (
                      <>
                        {folders.map((folder) => (
                          <DropdownMenuItem
                            key={folder.id}
                            onClick={() => chatId && onMoveToFolder?.(chatId, folder.id)}
                            data-testid={`menu-folder-${folder.id}`}
                          >
                            <span 
                              className="h-3 w-3 rounded-full mr-2 flex-shrink-0" 
                              style={{ backgroundColor: folder.color }}
                            />
                            {folder.name}
                          </DropdownMenuItem>
                        ))}
                        {currentFolderId && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => chatId && onMoveToFolder?.(chatId, null)}
                              data-testid="menu-remove-folder"
                            >
                              <X className="h-4 w-4 mr-2" />
                              Quitar de carpeta
                            </DropdownMenuItem>
                          </>
                        )}
                      </>
                    ) : (
                      <DropdownMenuItem
                        onClick={() => {
                          const folderName = prompt("Nombre de la carpeta:");
                          if (folderName && folderName.trim()) {
                            onCreateFolder?.(folderName.trim());
                          }
                        }}
                        data-testid="menu-create-folder"
                      >
                        <FolderPlus className="h-4 w-4 mr-2" />
                        Crear carpeta
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
              <DropdownMenuItem
                onClick={(e) => chatId && onDownloadChat?.(chatId, e as unknown as React.MouseEvent)}
                disabled={!chatId || chatId.startsWith("pending-")}
                data-testid="menu-download-chat"
              >
                <Download className="h-4 w-4 mr-2" />
                Descargar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(e) => chatId && onArchiveChat?.(chatId, e as unknown as React.MouseEvent)}
                disabled={!chatId || chatId.startsWith("pending-")}
                data-testid="menu-archive-chat"
              >
                <Archive className="h-4 w-4 mr-2" />
                {isArchived ? "Desarchivar" : "Archivar"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => chatId && onHideChat?.(chatId, e as unknown as React.MouseEvent)}
                disabled={!chatId || chatId.startsWith("pending-")}
                data-testid="menu-hide-chat"
              >
                <EyeOff className="h-4 w-4 mr-2" />
                Ocultar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(e) => chatId && onDeleteChat?.(chatId, e as unknown as React.MouseEvent)}
                disabled={!chatId || chatId.startsWith("pending-")}
                className="text-red-500 focus:text-red-500"
                data-testid="menu-delete-chat"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Eliminar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      {/* Main Content Area with Side Panel */}
      {(previewDocument || activeDocEditor) ? (
        <PanelGroup direction="horizontal" className="flex-1">
          {/* Left Panel: Minimized Chat for Document Mode */}
          <Panel defaultSize={activeDocEditor ? 25 : 50} minSize={20} maxSize={activeDocEditor ? 35 : 70}>
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
          {hasMessages && (
            <div 
              className={cn(
                "flex-1 overflow-y-auto space-y-3 overscroll-contain",
                activeDocEditor ? "p-3" : "p-4 sm:p-6 md:p-10 space-y-6"
              )}
              style={{ paddingBottom: 'var(--composer-height, 120px)' }}
            >
              <MessageList
                messages={displayMessages}
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
                activeRunId={activeRunId}
                onRunComplete={() => {
                  console.log('[uiPhase] Run completed, uiPhase=done');
                  setUiPhase('done');
                  setActiveRunId(null);
                }}
                uiPhase={uiPhase}
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
            
            {/* Streaming content with fade-in animation */}
            {aiState === "responding" && streamingContent && (
              <div className="animate-content-fade-in px-4 py-3 text-foreground min-w-0" style={{ fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", fontSize: "16px", lineHeight: "1.6", fontWeight: 400 }}>
                <MarkdownErrorBoundary fallbackContent={streamingContent}>
                  <MarkdownRenderer
                    content={streamingContent}
                    customComponents={{...CleanDataTableComponents}}
                  />
                </MarkdownErrorBoundary>
                <span className="typing-cursor">|</span>
              </div>
            )}
          </div>
        )}

        {/* Execution Console - Show UniversalExecutionConsole when state is available, fallback to LiveExecutionConsole */}
        {uiPhase === 'console' && activeRunId && (
          <div className="flex w-full max-w-3xl mx-auto flex-col gap-3 justify-start">
            {executionRunState ? (
              <UniversalExecutionConsole 
                runState={executionRunState as any}
                className="mb-4"
              />
            ) : (
              <LiveExecutionConsole 
                runId={activeRunId}
                forceShow={true}
              />
            )}
          </div>
        )}
        
              <div ref={bottomRef} />
            </div>
          )}

          {/* Centered content when no messages */}
          {!hasMessages && (
            <div className="flex-1 flex flex-col items-center justify-center">
              <div className="flex flex-col items-center justify-center text-center space-y-4 mb-6">
                {activeGpt ? (
                  <>
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
                  </>
                ) : (
                  <p className="text-muted-foreground">¿En qué puedo ayudarte?</p>
                )}
              </div>
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
            onTextareaFocus={handleCloseModelSelector}
            isFilesLoading={uploadedFiles.some(f => f.status === "uploading" || f.status === "processing")}
          />
            </div>
          </Panel>

          {/* Resize Handle */}
          <PanelResizeHandle className="w-2 bg-border/50 hover:bg-primary/30 transition-colors cursor-col-resize flex items-center justify-center group">
            <GripVertical className="h-6 w-6 text-muted-foreground/50 group-hover:text-primary transition-colors" />
          </PanelResizeHandle>

          {/* Right: Document Editor Panel */}
          <Panel defaultSize={activeDocEditor ? 75 : 50} minSize={25}>
            <div className="h-full animate-in slide-in-from-right duration-300">
              {(activeDocEditor?.type === "ppt") ? (
                <PPTEditorShellLazy
                  onClose={closeDocEditor}
                  onInsertContent={(insertFn) => { docInsertContentRef.current = insertFn; }}
                  initialShowInstructions={activeDocEditor?.showInstructions}
                  initialContent={activeDocEditor?.content}
                />
              ) : (activeDocEditor?.type === "excel" || previewDocument?.type === "excel") ? (
                <SpreadsheetEditor
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
                  onInsertContent={(insertFn) => { docInsertContentRef.current = insertFn; }}
                  onOrchestratorReady={(orch) => { orchestratorRef.current = orch; }}
                />
              ) : (
                <EnhancedDocumentEditor
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
                  onTextSelect={handleDocTextSelect}
                  onTextDeselect={handleDocTextDeselect}
                  onInsertContent={(insertFn) => { docInsertContentRef.current = insertFn; }}
                />
              )}
            </div>
          </Panel>
        </PanelGroup>
      ) : (
        <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full overflow-hidden">
          {/* Content Area - conditional based on whether we have messages */}
          {hasMessages ? (
            <>
              {/* Scrollable messages container */}
              <div 
                ref={messagesContainerRef}
                onScroll={handleScroll}
                className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 md:p-10 space-y-6"
              >
                <MessageList
                  messages={displayMessages}
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
                  activeRunId={activeRunId}
                  onRunComplete={() => {
                    console.log('[uiPhase] Run completed, uiPhase=done');
                    setUiPhase('done');
                    setActiveRunId(null);
                  }}
                  uiPhase={uiPhase}
                />
                <div ref={messagesEndRef} />
              </div>

              {/* Scroll to bottom button */}
              {showScrollButton && (
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
            </>
          ) : (
            /* No messages - center content vertically */
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-4">
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
                            customComponents={{...CleanDataTableComponents}}
                          />
                        </MarkdownErrorBoundary>
                        <span className="typing-cursor">|</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* Welcome Screen */
                <>
                  <motion.div 
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className="mb-8"
                  >
                    {activeGpt?.avatar ? (
                      <AvatarWithFallback 
                        src={activeGpt.avatar} 
                        alt={activeGpt.name}
                        fallback={<Bot className="h-10 w-10 text-white" />}
                      />
                    ) : (
                      <IliaGPTLogo size={80} />
                    )}
                  </motion.div>
                  <motion.h1 
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className="text-4xl font-bold text-center mb-3 bg-gradient-to-r from-foreground via-foreground/90 to-foreground/70 bg-clip-text"
                  >
                    {activeGpt ? activeGpt.name : "¿En qué puedo ayudarte?"}
                  </motion.h1>
                  <motion.p 
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.3 }}
                    className="text-muted-foreground text-center max-w-md text-base"
                  >
                    {activeGpt 
                      ? (activeGpt.welcomeMessage || activeGpt.description || "¿En qué puedo ayudarte?")
                      : "Soy MICHAT, tu asistente de IA. Puedo responder preguntas, generar documentos, analizar archivos y mucho más."
                    }
                  </motion.p>
                  {activeGpt?.conversationStarters && activeGpt.conversationStarters.length > 0 && (
                    <motion.div
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ duration: 0.5, delay: 0.4 }}
                      className="flex flex-wrap gap-2 mt-6 justify-center max-w-xl"
                    >
                      {activeGpt.conversationStarters
                        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
                        .map((starter, idx) => (
                          <button
                            key={idx}
                            onClick={() => setInput(starter)}
                            className="px-4 py-2 text-sm border rounded-lg hover:bg-muted/50 transition-colors text-left"
                            data-testid={`button-starter-${idx}`}
                          >
                            {starter}
                          </button>
                        ))}
                    </motion.div>
                  )}
                </>
              )}
            </div>
          )}
          
          {/* Input Bar - flex shrink-0, stays at bottom */}
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
            isFigmaConnected={isFigmaConnected}
            isFigmaConnecting={isFigmaConnecting}
            handleFigmaConnect={handleFigmaConnect}
            handleFigmaDisconnect={handleFigmaDisconnect}
            onOpenGoogleForms={() => setIsGoogleFormsOpen(true)}
            onOpenApps={onOpenApps}
            isGoogleFormsActive={isGoogleFormsActive}
            setIsGoogleFormsActive={setIsGoogleFormsActive}
            onTextareaFocus={handleCloseModelSelector}
            isFilesLoading={uploadedFiles.some(f => f.status === "uploading" || f.status === "processing")}
          />
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
              onClick={(e) => e.stopPropagation()}
            />
            <Button
              variant="secondary"
              size="icon"
              className="absolute top-4 right-4 h-10 w-10 bg-black/60 hover:bg-black/80 text-white"
              onClick={() => setLightboxImage(null)}
              data-testid="button-close-lightbox"
            >
              <X className="h-5 w-5" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="absolute top-4 right-16 h-10 w-10 bg-black/60 hover:bg-black/80 text-white"
              onClick={(e) => { e.stopPropagation(); handleDownloadImage(lightboxImage); }}
              data-testid="button-download-lightbox"
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
            onClick={(e) => e.stopPropagation()}
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
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>
            
            {/* Content */}
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
                        El contenido estará disponible en breve
                      </p>
                    </div>
                  </div>
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
                    La vista previa no está disponible para este tipo de archivo.
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
            onClick={(e) => e.stopPropagation()}
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
        onDownload={(artifact) => {
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

      {/* Agent Panel removed - progress is shown inline in chat messages */}
    </div>
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
