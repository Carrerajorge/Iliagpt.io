import React, { memo, useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CheckCircle2,
  Loader2,
  MoreHorizontal,
  X,
  RefreshCw,
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
  Download,
  FileText,
  FileSpreadsheet,
  FileIcon,
  Image as ImageIcon,
  Check,
  Maximize2,
  Minimize2,
  ListPlus,
  Minus,
  ArrowUp,
  Bot,
  Sparkles,
  Clock,
  XCircle,
  AlertCircle,
  ChevronDown,
  Target,
  Eye,
  Brain,
  List,
  Globe,
  Wrench,
  Zap,
  ZoomIn
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { messageLogger } from "@/lib/logger";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { UncertaintyBadge } from "@/components/ui/uncertainty-badge";
import { VerificationBadge } from "@/components/ui/verification-badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import { z } from "zod";

import { Message, storeGeneratedImage, getGeneratedImage, storeLastGeneratedImageInfo, WebSource } from "@/hooks/use-chats";
import { MarkdownRenderer, MarkdownErrorBoundary } from "@/components/markdown-renderer";
import { SourcesIndicator } from "@/components/sources-indicator";
import { SourcesPanel } from "@/components/sources-panel";
import { FigmaBlock } from "@/components/figma-block";
import { CodeExecutionBlock } from "@/components/code-execution-block";
import { InlineGoogleFormPreview } from "@/components/inline-google-form-preview";
import { InlineGmailPreview } from "@/components/inline-gmail-preview";
import { SuggestedReplies, generateSuggestions } from "@/components/suggested-replies";
import { getFileTheme, getFileCategory } from "@/lib/fileTypeTheme";
import { ChatSpreadsheetViewer } from "@/components/chat/ChatSpreadsheetViewer";

import { normalizeAgentEvent, hasPayloadDetails, type MappedAgentEvent } from "@/lib/agent-event-mapper";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AgentStepsDisplay, type AgentArtifact } from "@/components/agent-steps-display";
import { ArtifactViewer, type Artifact } from "@/components/artifact-viewer";
import { NewsCards, SourcesList } from "@/components/news-cards";
import { SuperAgentDisplay } from "@/components/super-agent-display";
import { useSuperAgentRun } from "@/stores/super-agent-store";
import { LiveExecutionConsole } from "@/components/live-execution-console";
import { PhaseNarrator } from "@/components/thinking-indicator";
import { PlanViewer } from "@/components/agent/PlanViewer";
import { detectClientIntent } from "@/lib/clientIntentDetector";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { RetrievalVis } from "@/components/retrieval-vis";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";

import { formatZonedTime, normalizeTimeZone } from "@/lib/platformDateTime";

const formatMessageTime = (timestamp: Date | undefined, timeZone: string): string => {
  if (!timestamp) return "";
  return formatZonedTime(timestamp, { timeZone: normalizeTimeZone(timeZone), includeSeconds: false });
};

interface DocumentBlock {
  type: "word" | "excel" | "ppt";
  title: string;
  content: string;
}

const extractTextFromChildren = (children: React.ReactNode): string => {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (!children) return "";
  if (Array.isArray(children)) {
    return children.map(extractTextFromChildren).join("");
  }
  if (React.isValidElement(children)) {
    return extractTextFromChildren((children.props as any)?.children);
  }
  const childArray = React.Children.toArray(children);
  return childArray.map(extractTextFromChildren).join("");
};

const isNumericValue = (text: string): boolean => {
  if (!text || typeof text !== "string") return false;
  const cleaned = text.trim().replace(/[$€£¥%,\s]/g, "");
  return (
    !isNaN(parseFloat(cleaned)) &&
    isFinite(Number(cleaned)) &&
    cleaned.length > 0
  );
};

const ImageSkeleton = memo(function ImageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn(
      "animate-pulse bg-gradient-to-br from-muted/80 via-muted to-muted/80 rounded-lg flex items-center justify-center",
      className
    )}>
      <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
    </div>
  );
});

const LazyImage = memo(function LazyImage({
  src,
  alt,
  className,
  style,
  onClick,
  "data-testid": testId
}: {
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  "data-testid"?: string;
}) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  return (
    <div className="relative">
      {!isLoaded && !hasError && (
        <ImageSkeleton className={cn(className, "absolute inset-0")} />
      )}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className={cn(className, !isLoaded && "opacity-0")}
        style={style}
        onClick={onClick}
        onLoad={() => setIsLoaded(true)}
        onError={() => setHasError(true)}
        data-testid={testId}
      />
    </div>
  );
});

const CleanDataTableWrapper = ({ children }: { children?: React.ReactNode }) => {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  const handleCopy = useCallback(async () => {
    if (!tableRef.current) return;
    const table = tableRef.current.querySelector('table');
    if (!table) return;

    const rows = table.querySelectorAll('tr');
    const text = Array.from(rows).map(row => {
      const cells = row.querySelectorAll('th, td');
      return Array.from(cells).map(cell => cell.textContent?.trim() || '').join('\t');
    }).join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy table:', err);
    }
  }, []);

  const handleDownload = useCallback(() => {
    if (!tableRef.current) return;
    const table = tableRef.current.querySelector('table');
    if (!table) return;

    const rows = table.querySelectorAll('tr');
    const csv = Array.from(rows).map(row => {
      const cells = row.querySelectorAll('th, td');
      return Array.from(cells).map(cell => {
        const text = cell.textContent?.trim() || '';
        return text.includes(',') ? `"${text}"` : text;
      }).join(',');
    }).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tabla.csv';
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  return (
    <div
      ref={tableRef}
      className={cn(
        "relative group my-4",
        isExpanded && "fixed inset-4 z-50 bg-background rounded-lg border shadow-2xl overflow-auto p-4"
      )}
    >
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button
          onClick={handleCopy}
          className="p-1.5 rounded-md bg-muted/80 hover:bg-muted border border-border/50"
          title={copied ? "Copiado" : "Copiar tabla"}
          data-testid="button-copy-table"
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        <button
          onClick={handleDownload}
          className="p-1.5 rounded-md bg-muted/80 hover:bg-muted border border-border/50"
          title="Descargar CSV"
          data-testid="button-download-table"
        >
          <Download className="h-4 w-4 text-muted-foreground" />
        </button>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1.5 rounded-md bg-muted/80 hover:bg-muted border border-border/50"
          title={isExpanded ? "Minimizar" : "Expandir"}
          data-testid="button-expand-table"
        >
          {isExpanded ? (
            <Minimize2 className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Maximize2 className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse border border-border text-sm">
          {children}
        </table>
      </div>
    </div>
  );
};

const CleanDataTableComponents = {
  table: CleanDataTableWrapper,
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-muted/50">{children}</thead>
  ),
  tbody: ({ children }: { children?: React.ReactNode }) => (
    <tbody>{children}</tbody>
  ),
  tr: ({ children }: { children?: React.ReactNode }) => (
    <tr className="border-b border-border">{children}</tr>
  ),
  th: ({ children }: { children?: React.ReactNode }) => {
    const text = extractTextFromChildren(children);
    const isNumeric = isNumericValue(text);
    return (
      <th
        scope="col"
        className={cn(
          "px-3 py-2 text-left font-semibold",
          isNumeric && "text-right"
        )}
      >
        {children}
      </th>
    );
  },
  td: ({ children }: { children?: React.ReactNode }) => {
    const text = extractTextFromChildren(children);
    const isNumeric = isNumericValue(text);
    const isLong = text.length > 50;
    return (
      <td
        className={cn(
          "px-3 py-2",
          isNumeric && "text-right",
          isLong && "max-w-xs break-words"
        )}
      >
        {children}
      </td>
    );
  }
};

const DocumentBlockSchema = z.object({
  type: z.enum(["word", "excel", "ppt"]),
  title: z.string().min(1),
  content: z.string()
});

const parseDocumentBlocks = (
  content: string
): { text: string; documents: DocumentBlock[] } => {
  if (!content || typeof content !== 'string') {
    console.warn('[parseDocumentBlocks] Invalid content provided:', typeof content);
    return { text: content || '', documents: [] };
  }

  const documents: DocumentBlock[] = [];
  const regex = /```document\s*\n([\s\S]*?)```/g;
  let match;
  let cleanText = content;
  const successfulBlocks: string[] = [];

  while ((match = regex.exec(content)) !== null) {
    try {
      let jsonStr = match[1]?.trim();
      if (!jsonStr) {
        console.warn('[parseDocumentBlocks] Empty document block found');
        continue;
      }

      jsonStr = jsonStr.replace(
        /"content"\s*:\s*"([\s\S]*?)"\s*\}/,
        (m, contentValue) => {
          const fixedContent = contentValue
            .replace(/\n/g, "\\n")
            .replace(/\r/g, "\\r")
            .replace(/\t/g, "\\t");
          return `"content": "${fixedContent}"}`;
        }
      );

      const parsed = JSON.parse(jsonStr);
      const validated = DocumentBlockSchema.safeParse(parsed);

      if (validated.success) {
        const doc = validated.data;
        doc.content = doc.content
          .replace(/\\n/g, "\n")
          .replace(/\\\\n/g, "\n");
        documents.push(doc);
        successfulBlocks.push(match[0]);
      } else {
        console.warn('[parseDocumentBlocks] Schema validation failed:', {
          errors: validated.error.errors,
          rawContent: jsonStr.substring(0, 100) + '...'
        });
      }
    } catch (e) {
      console.warn('[parseDocumentBlocks] JSON parse failed, attempting regex fallback:', {
        error: e instanceof Error ? e.message : 'Unknown error',
        blockPreview: match[1]?.substring(0, 50) + '...'
      });

      try {
        const blockContent = match[1];
        if (!blockContent) continue;

        const typeMatch = blockContent.match(
          /"type"\s*:\s*"(word|excel|ppt)"/
        );
        const titleMatch = blockContent.match(/"title"\s*:\s*"([^"]+)"/);
        const contentMatch = blockContent.match(
          /"content"\s*:\s*"([\s\S]*?)"\s*\}?\s*$/
        );

        if (typeMatch && titleMatch && contentMatch) {
          documents.push({
            type: typeMatch[1] as "word" | "excel" | "ppt",
            title: titleMatch[1],
            content: contentMatch[1]
              .replace(/\\n/g, "\n")
              .replace(/\\\\n/g, "\n")
          });
          successfulBlocks.push(match[0]);
        } else {
          console.warn('[parseDocumentBlocks] Regex fallback could not extract all required fields');
        }
      } catch (fallbackError) {
        console.error('[parseDocumentBlocks] Fallback parsing also failed:', {
          error: fallbackError instanceof Error ? fallbackError.message : 'Unknown error'
        });
      }
    }
  }

  for (const block of successfulBlocks) {
    cleanText = cleanText.replace(block, "").trim();
  }

  return { text: cleanText, documents };
};

const extractCodeBlocks = (
  content: string
): { type: "text" | "python"; content: string }[] => {
  if (!content || typeof content !== 'string') {
    return [{ type: "text" as const, content: content || "" }];
  }

  const pythonBlockRegex = /```(?:python|py)\n([\s\S]*?)```/g;
  const blocks: { type: "text" | "python"; content: string }[] = [];
  let lastIndex = 0;
  let match;

  while ((match = pythonBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textContent = content.slice(lastIndex, match.index);
      if (textContent) {
        blocks.push({
          type: "text",
          content: textContent
        });
      }
    }
    const codeContent = match[1] ?? "";
    blocks.push({ type: "python", content: codeContent });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    const remainingContent = content.slice(lastIndex);
    if (remainingContent) {
      blocks.push({ type: "text", content: remainingContent });
    }
  }

  return blocks.length > 0 ? blocks : [{ type: "text" as const, content: content || "" }];
};

interface AttachmentListProps {
  attachments: Message["attachments"];
  variant: "compact" | "default";
  onOpenPreview?: (attachment: NonNullable<Message["attachments"]>[0]) => void;
  onReopenDocument?: (doc: { type: "word" | "excel" | "ppt"; title: string; content: string }) => void;
}

const AttachmentList = memo(function AttachmentList({
  attachments,
  variant,
  onOpenPreview,
  onReopenDocument
}: AttachmentListProps) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap gap-2",
        variant === "default" && "mb-2 justify-end"
      )}
    >
      {attachments.map((att, i) =>
        att.type === "document" && att.documentType ? (
          <div
            key={i}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-xl text-sm border bg-card border-border cursor-pointer hover:bg-accent transition-colors"
            )}
            onClick={() => onReopenDocument?.({
              type: att.documentType as "word" | "excel" | "ppt",
              title: att.title || att.name,
              content: att.content || ""
            })}
            data-testid={`attachment-document-${i}`}
          >
            <div
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-lg",
                att.documentType === "word" && "bg-blue-600",
                att.documentType === "excel" && "bg-green-600",
                att.documentType === "ppt" && "bg-orange-500"
              )}
            >
              <span className="text-white text-xs font-bold">
                {att.documentType === "word" ? "W" : att.documentType === "excel" ? "E" : "P"}
              </span>
            </div>
            <div className="flex flex-col min-w-0">
              <span className="max-w-[200px] truncate font-medium">
                {att.title || att.name}
              </span>
              <span className="text-xs text-muted-foreground">
                Documento guardado - Clic para abrir
              </span>
            </div>
          </div>
        ) : att.type === "image" && att.imageUrl ? (
          <div
            key={i}
            className={cn(
              "relative rounded-xl overflow-hidden border border-border",
              variant === "default" && "max-w-[280px] cursor-pointer hover:opacity-90 transition-opacity"
            )}
            onClick={() => onOpenPreview?.(att)}
            data-testid={`attachment-image-${i}`}
          >
            <LazyImage
              src={att.imageUrl}
              alt={att.name}
              className="w-full h-auto max-h-[200px] object-cover"
            />
          </div>
        ) : att.spreadsheetData ? (
          <div key={i} className="flex flex-col gap-3">
            <ChatSpreadsheetViewer
              uploadId={att.spreadsheetData.uploadId}
              filename={att.name}
              sheets={att.spreadsheetData.sheets}
              previewData={att.spreadsheetData.previewData}
              onDownload={() => onOpenPreview?.(att)}
              // FRONTEND FIX #39: Add noopener,noreferrer to prevent window.opener attacks
              onExpand={() => window.open(`/spreadsheet-analyzer?uploadId=${att.spreadsheetData!.uploadId}`, '_blank', 'noopener,noreferrer')}
            />
            
          </div>
        ) : (
          (() => {
            const attTheme = getFileTheme(att.name, att.mimeType);
            return (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-xl text-sm border bg-card border-border",
                  variant === "default" && "cursor-pointer hover:bg-accent transition-colors"
                )}
                onClick={() => onOpenPreview?.(att)}
                data-testid={`attachment-file-${i}`}
              >
                <div
                  className={cn(
                    "flex items-center justify-center w-8 h-8 rounded-lg",
                    attTheme.bgColor
                  )}
                >
                  <span className="text-white text-xs font-bold">
                    {attTheme.icon}
                  </span>
                </div>
                <span className="max-w-[200px] truncate font-medium">
                  {att.name}
                </span>
              </div>
            );
          })()
        )
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.variant === nextProps.variant &&
    prevProps.attachments === nextProps.attachments
  );
});

interface ActionToolbarProps {
  messageId: string;
  content: string;
  msgIndex: number;
  copiedMessageId: string | null;
  messageFeedback: Record<string, "up" | "down" | null>;
  speakingMessageId: string | null;
  aiState: "idle" | "thinking" | "responding" | "agent_working";
  isRegenerating: boolean;
  variant: "compact" | "default";
  webSources?: WebSource[];
  onCopy: (content: string, id: string) => void;
  onFeedback: (id: string, type: "up" | "down") => void;
  onRegenerate: (index: number, instruction?: string) => void;
  onShare: (content: string) => void;
  onReadAloud: (id: string, content: string) => void;
  onViewSources?: () => void;
}

const ActionToolbar = memo(function ActionToolbar({
  messageId,
  content,
  msgIndex,
  copiedMessageId,
  messageFeedback,
  speakingMessageId,
  aiState,
  isRegenerating,
  variant,
  webSources,
  onCopy,
  onFeedback,
  onRegenerate,
  onShare,
  onReadAloud,
  onViewSources
}: ActionToolbarProps) {
  const testIdSuffix = variant === "compact" ? messageId : `main-${messageId}`;
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [customInstruction, setCustomInstruction] = useState("");

  const handleRegenerateOption = useCallback((instruction?: string) => {
    setRegenerateOpen(false);
    setCustomInstruction("");
    onRegenerate(msgIndex, instruction);
  }, [msgIndex, onRegenerate]);

  const handleCustomSubmit = useCallback(() => {
    if (customInstruction.trim()) {
      handleRegenerateOption(customInstruction.trim());
    }
  }, [customInstruction, handleRegenerateOption]);

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="flex items-center gap-0.5"
        data-testid={`message-actions-${testIdSuffix}`}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => onCopy(content, messageId)}
              data-testid={`button-copy-${testIdSuffix}`}
            >
              {copiedMessageId === messageId ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Copiar respuesta</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-7 w-7",
                messageFeedback[messageId] === "up"
                  ? "text-green-500"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => onFeedback(messageId, "up")}
              data-testid={`button-like-${testIdSuffix}`}
            >
              <ThumbsUp className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Me gusta</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-7 w-7",
                messageFeedback[messageId] === "down"
                  ? "text-red-500"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => onFeedback(messageId, "down")}
              data-testid={`button-dislike-${testIdSuffix}`}
            >
              <ThumbsDown className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>No me gusta</p>
          </TooltipContent>
        </Tooltip>

        <Popover open={regenerateOpen} onOpenChange={setRegenerateOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  disabled={aiState !== "idle"}
                  data-testid={`button-regenerate-${testIdSuffix}`}
                >
                  <RefreshCw
                    className={cn("h-4 w-4", isRegenerating && "animate-spin")}
                  />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Regenerar</p>
            </TooltipContent>
          </Tooltip>
          <PopoverContent
            className="w-52 p-1.5 bg-background/95 backdrop-blur-xl border-border/50 shadow-lg"
            align="start"
            side="top"
            sideOffset={8}
          >
            <div className="space-y-0.5">
              <div className="flex items-center gap-1 px-1 pb-1 border-b border-border/30 mb-1">
                <input
                  type="text"
                  placeholder="Pedir cambio de respuesta"
                  value={customInstruction}
                  onChange={(e) => setCustomInstruction(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCustomSubmit()}
                  className="flex-1 h-7 px-2 text-[13px] bg-transparent border-none outline-none placeholder:text-muted-foreground/50"
                  data-testid={`input-custom-regenerate-${testIdSuffix}`}
                />
                <button
                  onClick={handleCustomSubmit}
                  disabled={!customInstruction.trim()}
                  className="h-6 w-6 flex items-center justify-center rounded-full bg-foreground/10 hover:bg-foreground/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  data-testid={`button-submit-custom-${testIdSuffix}`}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
              </div>
              <button
                className="w-full flex items-center gap-2.5 px-2 py-1.5 text-[13px] text-left hover:bg-muted/60 rounded transition-colors"
                onClick={() => handleRegenerateOption()}
                data-testid={`option-retry-${testIdSuffix}`}
              >
                <RefreshCw className="h-3.5 w-3.5 text-muted-foreground/70" />
                <span>Inténtalo nuevamente</span>
              </button>
              <button
                className="w-full flex items-center gap-2.5 px-2 py-1.5 text-[13px] text-left hover:bg-muted/60 rounded transition-colors"
                onClick={() => handleRegenerateOption("Agrega más detalles y explicaciones a tu respuesta")}
                data-testid={`option-details-${testIdSuffix}`}
              >
                <ListPlus className="h-3.5 w-3.5 text-muted-foreground/70" />
                <span>Agregar detalles</span>
              </button>
              <button
                className="w-full flex items-center gap-2.5 px-2 py-1.5 text-[13px] text-left hover:bg-muted/60 rounded transition-colors"
                onClick={() => handleRegenerateOption("Hazlo más conciso y breve, elimina redundancias")}
                data-testid={`option-concise-${testIdSuffix}`}
              >
                <Minus className="h-3.5 w-3.5 text-muted-foreground/70" />
                <span>Más concisa</span>
              </button>
            </div>
          </PopoverContent>
        </Popover>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => onShare(content)}
              data-testid={`button-share-${testIdSuffix}`}
            >
              <Share2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Compartir</p>
          </TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  data-testid={`button-more-${testIdSuffix}`}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Más opciones</p>
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" side="bottom">
            <DropdownMenuItem
              onClick={() => onReadAloud(messageId, content)}
              data-testid={`menu-read-aloud-${testIdSuffix}`}
            >
              {speakingMessageId === messageId ? (
                <VolumeX className="h-4 w-4 mr-2" />
              ) : (
                <Volume2 className="h-4 w-4 mr-2" />
              )}
              {speakingMessageId === messageId
                ? "Detener lectura"
                : "Leer en voz alta"}
            </DropdownMenuItem>
            <DropdownMenuItem data-testid={`menu-create-thread-${testIdSuffix}`}>
              <MessageSquare className="h-4 w-4 mr-2" />
              Crear hilo desde aquí
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-red-500"
              data-testid={`menu-report-${testIdSuffix}`}
            >
              <Flag className="h-4 w-4 mr-2" />
              Reportar mensaje
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {webSources && webSources.length > 0 && onViewSources && (
          <SourcesIndicator
            sources={webSources}
            onViewSources={onViewSources}
          />
        )}
      </div>
    </TooltipProvider>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.messageId === nextProps.messageId &&
    prevProps.content === nextProps.content &&
    prevProps.msgIndex === nextProps.msgIndex &&
    prevProps.copiedMessageId === nextProps.copiedMessageId &&
    prevProps.messageFeedback[prevProps.messageId] === nextProps.messageFeedback[nextProps.messageId] &&
    prevProps.speakingMessageId === nextProps.speakingMessageId &&
    prevProps.aiState === nextProps.aiState &&
    prevProps.isRegenerating === nextProps.isRegenerating &&
    prevProps.variant === nextProps.variant &&
    prevProps.webSources === nextProps.webSources
  );
});

interface UserMessageProps {
  message: Message;
  variant: "compact" | "default";
  isEditing: boolean;
  editContent: string;
  copiedMessageId: string | null;
  onEditContentChange: (value: string) => void;
  onCancelEdit: () => void;
  onSendEdit: (id: string) => void;
  onCopyMessage: (content: string, id: string) => void;
  onStartEdit: (msg: Message) => void;
  onOpenPreview?: (attachment: NonNullable<Message["attachments"]>[0]) => void;
  onReopenDocument?: (doc: { type: "word" | "excel" | "ppt"; title: string; content: string }) => void;
}

const UserMessage = memo(function UserMessage({
  message,
  variant,
  isEditing,
  editContent,
  copiedMessageId,
  onEditContentChange,
  onCancelEdit,
  onSendEdit,
  onCopyMessage,
  onStartEdit,
  onOpenPreview,
  onReopenDocument
}: UserMessageProps) {
  const { settings: platformSettings } = usePlatformSettings();

  if (variant === "compact") {
    return (
      <div className="bg-primary/10 text-primary-foreground px-3 py-2 rounded-lg max-w-full text-sm">
        <span className="text-muted-foreground mr-1 font-medium">
          Instrucción:
        </span>
        <span className="text-foreground">{message.content}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {isEditing ? (
        <div className="w-full min-w-[300px] max-w-[500px]">
          <Textarea
            value={editContent}
            onChange={(e) => onEditContentChange(e.target.value)}
            className="w-full px-4 py-3 text-sm min-h-[80px] resize-y rounded-2xl border border-border bg-card focus:border-primary focus:ring-1 focus:ring-primary"
            autoFocus
          />
          <div className="flex items-center justify-end gap-2 mt-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-3 text-sm text-muted-foreground hover:text-foreground"
              onClick={onCancelEdit}
            >
              <X className="h-4 w-4 mr-1" />
              Cancelar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-3 text-sm text-muted-foreground hover:text-foreground"
              onClick={() => onSendEdit(message.id)}
            >
              <Send className="h-4 w-4 mr-1" />
              Enviar
            </Button>
          </div>
        </div>
      ) : (
        <div className="group">
          <AttachmentList
            attachments={message.attachments}
            variant={variant}
            onOpenPreview={onOpenPreview}
            onReopenDocument={onReopenDocument}
          />
          {message.content && (
            <div className="px-5 py-3 text-[15px] break-words leading-relaxed bg-[#A5A0FF]/15 backdrop-blur-xl border border-[#A5A0FF]/30 shadow-lg shadow-[#A5A0FF]/5 rounded-[24px] rounded-tr-[4px] text-foreground transition-all duration-300 hover:bg-[#A5A0FF]/25 hover:shadow-[#A5A0FF]/10 max-w-full">
              {message.content}
            </div>
          )}
          <div className="flex items-center justify-end gap-1.5 mt-2">
            {message.timestamp && (
              <span className="text-[10px] text-muted-foreground/60 mr-1">
                {formatMessageTime(message.timestamp, platformSettings.timezone_default)}
              </span>
            )}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={() => onCopyMessage(message.content, message.id)}
                data-testid={`button-copy-user-${message.id}`}
              >
                {copiedMessageId === message.id ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={() => onStartEdit(message)}
                data-testid={`button-edit-user-${message.id}`}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.variant === nextProps.variant &&
    prevProps.isEditing === nextProps.isEditing &&
    prevProps.editContent === nextProps.editContent &&
    prevProps.copiedMessageId === nextProps.copiedMessageId &&
    prevProps.message.attachments === nextProps.message.attachments
  );
});

interface AgentRunContentProps {
  agentRun: {
    runId: string | null;
    status: "idle" | "starting" | "running" | "completed" | "failed" | "cancelled" | "queued" | "planning" | "verifying" | "paused" | "cancelling" | "replanning";
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
  };
  onCancel?: () => void;
  onRetry?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onArtifactPreview?: (artifact: AgentArtifact) => void;
  onOpenLightbox?: (imageUrl: string) => void;
}

const AgentRunContent = memo(function AgentRunContent({ agentRun, onCancel, onRetry, onPause, onResume, onArtifactPreview, onOpenLightbox }: AgentRunContentProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [isSlowConnection, setIsSlowConnection] = useState(false);
  const [waitingSeconds, setWaitingSeconds] = useState(0);
  const [viewMode, setViewMode] = useState<"steps" | "plan">("steps");
  const eventsEndRef = useRef<HTMLDivElement>(null);

  const isCancellable = ["starting", "running", "queued", "planning", "verifying", "paused", "replanning"].includes(agentRun.status);
  const isActive = ["starting", "running", "queued", "planning", "verifying", "cancelling", "replanning"].includes(agentRun.status);
  const isPaused = agentRun.status === "paused";
  const isCancelling = agentRun.status === "cancelling";
  const isWaitingForResponse = agentRun.status === "starting" || agentRun.status === "queued";
  const showObjective = [
    "starting",
    "queued",
    "planning",
    "running",
    "verifying",
    "replanning",
    "paused",
    "cancelling",
    "completed",
    "failed",
    "cancelled",
  ].includes(agentRun.status);

  useEffect(() => {
    if (isActive && eventsEndRef.current) {
      eventsEndRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [agentRun.eventStream?.length, isActive]);

  useEffect(() => {
    if (!isWaitingForResponse) {
      setIsSlowConnection(false);
      setWaitingSeconds(0);
      return;
    }

    const interval = setInterval(() => {
      setWaitingSeconds(prev => {
        const newVal = prev + 1;
        if (newVal >= 10) {
          setIsSlowConnection(true);
        }
        return newVal;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isWaitingForResponse]);

  const getStatusIcon = () => {
    switch (agentRun.status) {
      case "starting":
      case "queued":
        return <Loader2 className="h-4 w-4 animate-spin text-purple-500" />;
      case "planning":
        return <Sparkles className="h-4 w-4 animate-pulse text-purple-500" />;
      case "running":
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      case "verifying":
        return <Eye className="h-4 w-4 animate-pulse text-purple-500" />;
      case "replanning":
        return <RefreshCw className="h-4 w-4 animate-spin text-orange-500" />;
      case "paused":
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case "cancelling":
        return <Loader2 className="h-4 w-4 animate-spin text-red-500" />;
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "cancelled":
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusText = () => {
    switch (agentRun.status) {
      case "starting": return "Iniciando...";
      case "queued": return "En cola...";
      case "planning": return "Planificando...";
      case "running": return "Ejecutando...";
      case "verifying": return "Verificando...";
      case "replanning": return "Replanificando...";
      case "paused": return "Pausado";
      case "cancelling": return "Cancelando...";
      case "completed": return "Completado";
      case "failed": return "Error";
      case "cancelled": return "Cancelado";
      default: return agentRun.status;
    }
  };

  const getToolDisplayName = (toolName: string) => {
    const toolNames: Record<string, string> = {
      analyze_spreadsheet: "Analizando datos",
      web_search: "Buscando en web",
      web_search_retrieve: "Recuperando información",
      generate_image: "Generando imagen",
      browse_url: "Navegando URL",
      generate_document: "Generando documento",
      read_file: "Leyendo archivo",
      write_file: "Escribiendo archivo",
      shell_command: "Ejecutando comando",
      list_files: "Listando archivos",
      respond: "Respondiendo",
      start_planning: "Analizando solicitud",
      conversational_response: "Respuesta",
    };
    return toolNames[toolName] || toolName;
  };

  const mappedEvents = useMemo(() => {
    return (agentRun.eventStream || []).map(event => normalizeAgentEvent(event));
  }, [agentRun.eventStream]);

  const visibleEvents = showAllEvents
    ? mappedEvents
    : mappedEvents.slice(-5);
  const hiddenEventsCount = mappedEvents.length - visibleEvents.length;

  const getEventIcon = (event: MappedAgentEvent) => {
    const iconClass = cn("h-3 w-3", event.ui.iconColor);
    switch (event.ui.icon) {
      case 'sparkles': return <Sparkles className={iconClass} />;
      case 'check': return <CheckCircle2 className={iconClass} />;
      case 'alert': return <XCircle className={iconClass} />;
      case 'list': return <List className={iconClass} />;
      case 'eye': return <Eye className={iconClass} />;
      case 'brain': return <Brain className={iconClass} />;
      case 'loader': return <Loader2 className={cn(iconClass, "animate-spin")} />;
      default: return <Clock className={iconClass} />;
    }
  };

  // Extract objective from event stream
  const objective = useMemo(() => {
    const planEvent = (agentRun.eventStream || []).find(
      (e: any) => e.content?.plan?.objective || e.content?.objective
    );
    return planEvent?.content?.plan?.objective || planEvent?.content?.objective || agentRun.userMessage || null;
  }, [agentRun.eventStream, agentRun.userMessage]);

  // Count completed vs total steps
  const stepProgress = useMemo(() => {
    const completedEvents = mappedEvents.filter(e => e.status === 'ok' && (e.kind === 'observation' || e.kind === 'result')).length;
    const totalSteps = agentRun.steps?.length || mappedEvents.filter(e => e.kind === 'action').length || 0;
    return { completed: completedEvents, total: Math.max(totalSteps, completedEvents) };
  }, [mappedEvents, agentRun.steps]);

  return (
    <div className="flex flex-col gap-2 w-full animate-in fade-in slide-in-from-bottom-2 duration-300" data-testid="agent-run-content">
      {/* Header with cancel button prominently displayed */}
      <div className="flex items-start gap-2">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex-1 flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-purple-500/10 to-blue-500/10 rounded-lg border border-purple-500/20 hover:border-purple-500/40 transition-all text-left"
        >
          <Bot className="h-5 w-5 text-purple-500" />
          <span className="text-sm font-medium text-purple-700 dark:text-purple-300">Modo Agente</span>
          <div className="flex-1" />
          {agentRun.runId && (
            <div className="flex bg-background/50 rounded-md p-0.5 mr-2" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setViewMode("steps")}
                className={cn(
                  "px-2 py-0.5 text-xs rounded transition-colors",
                  viewMode === "steps" ? "bg-white dark:bg-zinc-700 shadow-sm font-medium" : "text-muted-foreground hover:bg-white/50 dark:hover:bg-zinc-700/50"
                )}
              >
                Pasos
              </button>
              <button
                onClick={() => setViewMode("plan")}
                className={cn(
                  "px-2 py-0.5 text-xs rounded transition-colors",
                  viewMode === "plan" ? "bg-white dark:bg-zinc-700 shadow-sm font-medium" : "text-muted-foreground hover:bg-white/50 dark:hover:bg-zinc-700/50"
                )}
              >
                Plan
              </button>
            </div>
          )}
          {getStatusIcon()}
          <span className="text-xs text-muted-foreground">{getStatusText()}</span>
          <ChevronDown className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            isExpanded && "rotate-180"
          )} />
        </button>

        {/* Prominent Cancel Button - always visible when active */}
        {isCancellable && onCancel && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={isCancelling}
            className={cn(
              "shrink-0 h-10 px-3 border",
              isCancelling
                ? "text-red-400 border-red-300/50 bg-red-50/50 dark:bg-red-900/20 cursor-not-allowed"
                : "text-muted-foreground border-border hover:text-red-500 hover:border-red-300 hover:bg-red-50/50 dark:hover:bg-red-900/20"
            )}
            data-testid="button-cancel-agent-header"
          >
            {isCancelling ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Cancelando
              </>
            ) : (
              <>
                <XCircle className="h-4 w-4 mr-1.5" />
                Cancelar
              </>
            )}
          </Button>
        )}
      </div>

      {/* Objective display - show what the agent is working on */}
      {objective && showObjective && (
        <div className="px-3 py-2 bg-purple-500/5 rounded-lg border border-purple-500/10">
          <div className="flex items-center gap-2 text-xs text-purple-600 dark:text-purple-400 font-medium uppercase tracking-wide mb-1">
            <Target className="h-3 w-3" />
            Objetivo
          </div>
          <p className="text-sm text-foreground line-clamp-2">{objective}</p>
          {stepProgress.total > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-purple-500/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-500"
                  style={{ width: `${Math.min(100, (stepProgress.completed / stepProgress.total) * 100)}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {stepProgress.completed}/{stepProgress.total}
              </span>
            </div>
          )}
        </div>
      )}

      {isExpanded && (
        <div className="space-y-3">
          {/* Action buttons for runs */}
          {(isCancellable || isPaused) && (
            <div className="flex justify-end gap-2">
              {isPaused && onResume && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onResume}
                  className="text-xs text-muted-foreground hover:text-green-500"
                  data-testid="button-resume-agent"
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Reanudar
                </Button>
              )}
              {!isPaused && !isCancelling && isActive && onPause && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onPause}
                  className="text-xs text-muted-foreground hover:text-yellow-500"
                  data-testid="button-pause-agent"
                >
                  <Clock className="h-3 w-3 mr-1" />
                  Pausar
                </Button>
              )}
              {isCancellable && onCancel && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onCancel}
                  disabled={isCancelling}
                  className={cn(
                    "text-xs",
                    isCancelling
                      ? "text-red-400 cursor-not-allowed"
                      : "text-muted-foreground hover:text-red-500"
                  )}
                  data-testid="button-cancel-agent"
                >
                  {isCancelling ? (
                    <>
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      Cancelando...
                    </>
                  ) : (
                    <>
                      <XCircle className="h-3 w-3 mr-1" />
                      Cancelar
                    </>
                  )}
                </Button>
              )}
            </div>
          )}

          {/* Plan Viewer */}
          {viewMode === "plan" && agentRun.runId && (
            <div className="border border-border/50 rounded-lg overflow-hidden">
              <PlanViewer planId={agentRun.runId} />
            </div>
          )}

          {/* Event timeline - Manus style with human-readable cards */}
          {mappedEvents.length > 0 && viewMode === "steps" && (
            <div className="relative" data-testid="agent-event-timeline">
              {hiddenEventsCount > 0 && !showAllEvents && (
                <button
                  onClick={() => setShowAllEvents(true)}
                  className="text-xs text-purple-500 hover:text-purple-600 mb-2 flex items-center gap-1"
                  data-testid="button-show-all-events"
                >
                  <ChevronDown className="h-3 w-3" />
                  Ver {hiddenEventsCount} eventos anteriores
                </button>
              )}
              <div className="space-y-1.5 pl-3 border-l-2 border-purple-500/30">
                {visibleEvents.map((event, idx) => {
                  const isLast = idx === visibleEvents.length - 1;
                  const showDetails = hasPayloadDetails(event);
                  return (
                    <div
                      key={event.id}
                      className={cn(
                        "flex items-start gap-2 text-sm py-1.5 px-2 rounded-md transition-all",
                        isLast && isActive && "bg-purple-500/5 border-l-2 border-purple-500 -ml-[11px] pl-[9px]"
                      )}
                      data-testid={`agent-event-${event.kind}-${event.status}`}
                    >
                      <div className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0",
                        event.ui.bgColor
                      )}>
                        {getEventIcon(event)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn("text-xs font-semibold uppercase tracking-wide", event.ui.labelColor)}>
                            {event.ui.label}
                          </span>
                          {event.status === 'ok' && event.kind !== 'action' && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-600 dark:text-green-400 text-[10px] font-medium">
                              ✓
                            </span>
                          )}
                          {event.status === 'warn' && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 text-[10px] font-medium">
                              ⚠
                            </span>
                          )}
                          {event.confidence !== undefined && (
                            <span className="text-[10px] text-muted-foreground">
                              {Math.round(event.confidence * 100)}%
                            </span>
                          )}
                          {isLast && isActive && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-600 dark:text-purple-400 text-[10px] font-medium">
                              <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
                              En proceso
                            </span>
                          )}
                        </div>
                        <p className="text-foreground text-xs mt-0.5 break-words leading-relaxed font-medium">
                          {event.title}
                        </p>
                        {event.summary && (
                          <p className="text-muted-foreground text-xs mt-0.5 break-words leading-relaxed">
                            {event.summary}
                          </p>
                        )}
                        {showDetails && (
                          <Collapsible className="mt-1">
                            <CollapsibleTrigger className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1">
                              <ChevronDown className="h-2.5 w-2.5" />
                              Ver detalles
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <pre className="mt-1 p-2 bg-muted/50 rounded text-[10px] overflow-x-auto max-h-32 overflow-y-auto">
                                {JSON.stringify(event.payload, null, 2)}
                              </pre>
                            </CollapsibleContent>
                          </Collapsible>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={eventsEndRef} />
              </div>
            </div>
          )}

          {/* Steps progress - fallback if no event stream */}
          {(!agentRun.eventStream || agentRun.eventStream.length === 0) && agentRun.steps && agentRun.steps.length > 0 && (
            <div className="space-y-2 pl-3 border-l-2 border-blue-500/30">
              {agentRun.steps.map((step, idx) => (
                <div key={idx} className="flex items-center gap-2 text-sm py-1">
                  {step.status === "succeeded" ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : step.status === "running" ? (
                    <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                  ) : step.status === "failed" ? (
                    <XCircle className="h-4 w-4 text-red-500" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30" />
                  )}
                  <span className={cn(
                    "transition-colors",
                    step.status === "pending" && "text-muted-foreground",
                    step.status === "running" && "text-foreground font-medium",
                    step.status === "succeeded" && "text-green-600 dark:text-green-400",
                    step.status === "failed" && "text-red-600 dark:text-red-400"
                  )}>
                    {getToolDisplayName(step.toolName)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Loading skeleton for starting state */}
          {isActive && (!agentRun.eventStream || agentRun.eventStream.length === 0) && (!agentRun.steps || agentRun.steps.length === 0) && (
            <div className="space-y-2 animate-pulse">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-purple-500/20" />
                <div className="h-4 w-32 bg-muted rounded" />
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-blue-500/20" />
                <div className="h-4 w-48 bg-muted rounded" />
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>
                  {agentRun.status === "starting" && "Conectando con IA..."}
                  {agentRun.status === "queued" && "En cola de procesamiento..."}
                  {agentRun.status === "planning" && "Planificando pasos..."}
                  {agentRun.status === "running" && "Ejecutando..."}
                  {agentRun.status === "verifying" && "Verificando resultados..."}
                  {agentRun.status === "replanning" && "Ajustando plan..."}
                  {!["starting", "queued", "planning", "running", "verifying", "replanning"].includes(agentRun.status) && "Procesando tu solicitud..."}
                </span>
              </div>
              {isSlowConnection && (
                <div className="flex items-center gap-2 text-sm text-yellow-600 dark:text-yellow-400 mt-2 p-2 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                  <AlertCircle className="h-4 w-4" />
                  <span>La conexión está tardando más de lo esperado ({waitingSeconds}s). Por favor, espera un momento...</span>
                </div>
              )}
            </div>
          )}

          {/* Claude-style steps display for completed runs */}
          {agentRun.status === "completed" && agentRun.steps && agentRun.steps.length > 0 && (
            <div className="mt-3">
              <AgentStepsDisplay
                steps={agentRun.steps.map(step => ({
                  ...step,
                  status: (step.status === 'completed' || step.status === 'succeeded' || step.status === 'success')
                    ? 'succeeded' as const
                    : (step.status === 'failed' || step.status === 'error')
                      ? 'failed' as const
                      : (step.status === 'running' || step.status === 'in_progress')
                        ? 'running' as const
                        : 'pending' as const
                }))}
                summary={agentRun.summary}
                artifacts={(agentRun as any).artifacts}
                isRunning={false}
                onDocumentClick={(artifact) => {
                  if (onArtifactPreview) {
                    onArtifactPreview(artifact);
                  }
                }}
                onImageExpand={(imageUrl) => {
                  onOpenLightbox?.(imageUrl);
                }}
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
            </div>
          )}

          {/* Summary/Response - show when completed but no steps */}
          {agentRun.summary && agentRun.status === "completed" && (!agentRun.steps || agentRun.steps.length === 0) && (
            <div className="mt-2 pt-2 border-t border-border/50">
              <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none">
                <MarkdownErrorBoundary key={`agent-summary-${agentRun.summary.length}`} fallbackContent={agentRun.summary}>
                  <MarkdownRenderer content={agentRun.summary} />
                </MarkdownErrorBoundary>
              </div>
            </div>
          )}

          {/* Error message with retry */}
          {agentRun.error && agentRun.status === "failed" && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                  <XCircle className="h-4 w-4" />
                  <span className="text-sm font-medium">Error</span>
                </div>
                {onRetry && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onRetry}
                    className="text-xs text-red-600 hover:text-red-700 hover:bg-red-500/10"
                    data-testid="button-retry-agent"
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Reintentar
                  </Button>
                )}
              </div>
              <p className="text-sm text-red-600/80 dark:text-red-400/80 mt-1">{agentRun.error}</p>
            </div>
          )}

          {/* Cancelled state */}
          {agentRun.status === "cancelled" && (
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
                  <AlertCircle className="h-4 w-4" />
                  <span className="text-sm font-medium">Cancelado</span>
                </div>
                {onRetry && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onRetry}
                    className="text-xs text-yellow-600 hover:text-yellow-700 hover:bg-yellow-500/10"
                    data-testid="button-retry-cancelled-agent"
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Reintentar
                  </Button>
                )}
              </div>
              <p className="text-sm text-yellow-600/80 dark:text-yellow-400/80 mt-1">
                La ejecución fue cancelada por el usuario.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

interface AssistantMessageProps {
  message: Message;
  msgIndex: number;
  totalMessages: number;
  variant: "compact" | "default";
  copiedMessageId: string | null;
  messageFeedback: Record<string, "up" | "down" | null>;
  speakingMessageId: string | null;
  aiState: "idle" | "thinking" | "responding" | "agent_working";
  isRegenerating: boolean;
  isGeneratingImage: boolean;
  pendingGeneratedImage: { messageId: string; imageData: string } | null;
  latestGeneratedImageRef: React.RefObject<{ messageId: string; imageData: string } | null>;
  onCopyMessage: (content: string, id: string) => void;
  onFeedback: (id: string, type: "up" | "down") => void;
  onRegenerate: (index: number) => void;
  onShare: (content: string) => void;
  onReadAloud: (id: string, content: string) => void;
  onOpenDocumentPreview: (doc: DocumentBlock) => void;
  onDownloadImage: (imageData: string) => void;
  onOpenLightbox: (imageData: string) => void;
  onReopenDocument?: (doc: { type: "word" | "excel" | "ppt"; title: string; content: string }) => void;
  minimizedDocument?: { type: "word" | "excel" | "ppt"; title: string; content: string; messageId?: string } | null;
  onRestoreDocument?: () => void;
  onAgentCancel?: (messageId: string, runId: string) => void;
  onAgentRetry?: (messageId: string, userMessage: string) => void;
  onAgentArtifactPreview?: (artifact: AgentArtifact) => void;
  onQuestionClick?: (question: string) => void;
  onSuperAgentCancel?: (messageId: string) => void;
  onSuperAgentRetry?: (messageId: string) => void;
}

const AssistantMessage = memo(function AssistantMessage({
  message,
  msgIndex,
  totalMessages,
  variant,
  copiedMessageId,
  messageFeedback,
  speakingMessageId,
  aiState,
  isRegenerating,
  isGeneratingImage,
  pendingGeneratedImage,
  latestGeneratedImageRef,
  onCopyMessage,
  onFeedback,
  onRegenerate,
  onShare,
  onReadAloud,
  onOpenDocumentPreview,
  onDownloadImage,
  onOpenLightbox,
  onReopenDocument,
  minimizedDocument,
  onRestoreDocument,
  onAgentCancel,
  onAgentRetry,
  onAgentArtifactPreview,
  onQuestionClick,
  onSuperAgentCancel,
  onSuperAgentRetry
}: AssistantMessageProps) {
  const [sourcesPanelOpen, setSourcesPanelOpen] = useState(false);
  const superAgentState = useSuperAgentRun(message.id);
  const { settings: platformSettings } = usePlatformSettings();
  const { settings } = useSettingsContext();

  const parsedContent = useMemo(() => {
    if (!message.content || message.isThinking) {
      return { text: "", documents: [] };
    }
    return parseDocumentBlocks(message.content);
  }, [message.content, message.isThinking]);

  const contentBlocks = useMemo(() => {
    return extractCodeBlocks(parsedContent.text || "");
  }, [parsedContent.text]);

  const imageData = useMemo(() => {
    const msgImage = message.generatedImage;
    const storeImage = getGeneratedImage(message.id);
    const pendingMatch =
      pendingGeneratedImage?.messageId === message.id
        ? pendingGeneratedImage.imageData
        : null;
    const refMatch =
      latestGeneratedImageRef.current?.messageId === message.id
        ? latestGeneratedImageRef.current.imageData
        : null;

    const result = msgImage || storeImage || pendingMatch || refMatch;

    if (result && !storeImage) {
      storeGeneratedImage(message.id, result);
      storeLastGeneratedImageInfo({
        messageId: message.id,
        base64: result,
        artifactId: null,
      });
    }

    return result;
  }, [message.id, message.generatedImage, pendingGeneratedImage, latestGeneratedImageRef]);

  if (variant === "compact") {
    return (
      <div className="bg-green-500/10 text-green-700 dark:text-green-400 px-3 py-1.5 rounded-lg max-w-[90%] text-xs flex items-center gap-1">
        <CheckCircle2 className="h-3 w-3" />
        <span>{message.content}</span>
      </div>
    );
  }

  const { documents } = parsedContent;

  const showSkeleton =
    isGeneratingImage &&
    message.role === "assistant" &&
    msgIndex === totalMessages - 1 &&
    !imageData;

  return (
    <div className="flex flex-col gap-2 w-full min-w-0 bg-[#A5A0FF]/[0.02] dark:bg-[#A5A0FF]/[0.04] backdrop-blur-sm border border-[#A5A0FF]/10 rounded-[28px] rounded-tl-[6px] p-5 shadow-sm transition-all hover:bg-[#A5A0FF]/[0.04] dark:hover:bg-[#A5A0FF]/[0.06]">
      {/* Uncertainty Badge */}
      {message.confidence && message.confidence !== 'high' && (
        <div className="flex justify-start mb-1">
          <UncertaintyBadge
            confidence={message.confidence}
            reason={message.uncertaintyReason}
          />
        </div>
      )}

      {/* Verification Badge - Visualizes A1 (Agent Verifier) status */}
      <VerificationBadge
        verified={!!message.metadata?.verified}
        attempts={message.metadata?.verificationAttempts}
        className="mb-2"
      />

      {/* Agent run content - show progress and events */}
      {message.agentRun && (
        <AgentRunContent
          agentRun={message.agentRun}
          onCancel={onAgentCancel ? () => onAgentCancel(message.id, message.agentRun!.runId || "") : undefined}
          onRetry={onAgentRetry ? () => onAgentRetry(message.id, message.agentRun?.userMessage || "") : undefined}
          onArtifactPreview={onAgentArtifactPreview}
        />
      )}

      {/* Super Agent display - show research progress with sources */}
      {superAgentState && (
        <SuperAgentDisplay
          state={superAgentState}
          onRetry={onSuperAgentRetry ? () => onSuperAgentRetry(message.id) : undefined}
          onCancel={onSuperAgentCancel ? () => onSuperAgentCancel(message.id) : undefined}
        />
      )}

      {message.isThinking && message.steps && (
        <div className="rounded-lg border bg-card p-4 space-y-3 w-full animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            Processing Goal
          </div>
          {message.steps.map((step, idx) => (
            <div key={idx} className="flex items-center gap-3 text-sm">
              {step.status === "complete" ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : step.status === "loading" ? (
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              ) : (
                <div className="h-4 w-4 rounded-full border border-muted-foreground/30" />
              )}
              <span
                className={cn(
                  step.status === "pending" && "text-muted-foreground",
                  step.status === "loading" && "text-foreground font-medium",
                  step.status === "complete" &&
                  "text-muted-foreground line-through"
                )}
              >
                {step.title}
              </span>
            </div>
          ))}
        </div>
      )}

      {message.retrievalSteps && message.retrievalSteps.length > 0 && (
        <div className="mb-3 w-full max-w-sm">
          <RetrievalVis steps={message.retrievalSteps} />
        </div>
      )}

      {message.webSources && message.webSources.length > 0 && !message.isThinking && (
        <NewsCards sources={message.webSources} maxDisplay={5} searchQueries={message.searchQueries} totalSearches={message.totalSearches} />
      )}

      {message.content && !message.isThinking && !message.agentRun && (
        <>
          {contentBlocks.map((block, blockIdx) =>
            block.type === "python" ? (
              <div key={blockIdx} className="my-2">
                <CodeExecutionBlock
                  code={block.content.trim()}
                  language="python"
                  autoRun={settings.codeInterpreter}
                />
              </div>
            ) : block.content?.trim() ? (
              <div
                key={blockIdx}
                className="text-sm prose prose-sm dark:prose-invert max-w-none leading-relaxed min-w-0"
              >
                <MarkdownErrorBoundary key={`${message.id}-${blockIdx}-${block.content.length}`} fallbackContent={block.content}>
                  <MarkdownRenderer
                    content={block.content}
                    customComponents={{ ...CleanDataTableComponents }}
                    onOpenDocument={onOpenDocumentPreview}
                    webSources={message.webSources}
                  />
                </MarkdownErrorBoundary>
              </div>
            ) : null
          )}
          {documents.length > 0 && (
            <div className="flex gap-3 flex-wrap mt-3">
              {documents.map((doc, idx) => {
                const docTheme = {
                  word: { iconBg: 'bg-blue-600', icon: 'W', label: 'Word', textColor: 'text-blue-600' },
                  excel: { iconBg: 'bg-green-600', icon: 'E', label: 'Excel', textColor: 'text-green-600' },
                  ppt: { iconBg: 'bg-orange-500', icon: 'P', label: 'PowerPoint', textColor: 'text-orange-500' },
                }[doc.type] || { iconBg: 'bg-gray-500', icon: '?', label: 'Documento', textColor: 'text-gray-500' };
                return (
                  <div
                    key={idx}
                    className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-accent/50 hover:shadow-md transition-all cursor-pointer group min-w-[240px] max-w-sm"
                    onClick={() => onOpenDocumentPreview(doc)}
                  >
                    <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-sm", docTheme.iconBg)}>
                      <span className="text-white text-sm font-bold">{docTheme.icon}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate text-foreground">{doc.title}</p>
                      <p className="text-xs text-muted-foreground">{docTheme.label}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn("h-8 w-8 rounded-lg", docTheme.textColor)}
                        onClick={(e) => { e.stopPropagation(); onOpenDocumentPreview(doc); }}
                        title="Vista previa"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-lg"
                        onClick={(e) => { e.stopPropagation(); onOpenDocumentPreview(doc); }}
                        title="Descargar"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      

      {showSkeleton && (
        <div className="mt-3">
          <div className="w-64 h-64 rounded-lg animate-pulse bg-gradient-to-br from-muted/80 via-muted to-muted/80 flex flex-col items-center justify-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-muted-foreground/10 animate-pulse" />
            <div className="space-y-2 text-center">
              <div className="h-3 w-32 bg-muted-foreground/10 rounded animate-pulse mx-auto" />
              <div className="h-2 w-24 bg-muted-foreground/10 rounded animate-pulse mx-auto" />
            </div>
          </div>
        </div>
      )}

      {imageData && (
        <div className="mt-3">
          <ArtifactViewer
            artifact={{
              id: `generated-${message.id}`,
              type: "image",
              name: "Imagen generada",
              url: imageData,
              mimeType: "image/png"
            }}
            onExpand={onOpenLightbox}
            onDownload={() => onDownloadImage(imageData)}
          />
        </div>
      )}

      {minimizedDocument && minimizedDocument.messageId === message.id && onRestoreDocument && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8, y: -20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="mt-3 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors group"
          onClick={onRestoreDocument}
          data-testid={`thumbnail-document-${message.id}`}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
              <FileText className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-blue-900 dark:text-blue-100 truncate">
                {minimizedDocument.title}
              </p>
              <p className="text-xs text-blue-600 dark:text-blue-400">
                Clic para restaurar documento
              </p>
            </div>
            <Maximize2 className="h-4 w-4 text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </motion.div>
      )}

      {message.figmaDiagram && (
        <div className="mt-3 w-full">
          <FigmaBlock diagram={message.figmaDiagram} />
        </div>
      )}

      {message.artifact && (
        <div className="mt-3 w-full">
          {message.artifact.type === "image" ? (
            <div className="relative rounded-xl overflow-hidden group">
              <img
                src={message.artifact.previewUrl || message.artifact.downloadUrl}
                alt="Imagen generada"
                className="max-w-full max-h-[500px] object-contain rounded-xl cursor-pointer hover:opacity-95 transition-all shadow-sm hover:shadow-md"
                onClick={() => onOpenLightbox(message.artifact?.previewUrl || message.artifact?.downloadUrl || "")}
                data-testid={`image-artifact-${message.id}`}
              />
              <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => onOpenLightbox(message.artifact?.previewUrl || message.artifact?.downloadUrl || "")}
                  className="p-2 bg-black/50 hover:bg-black/70 text-white rounded-lg transition-colors backdrop-blur-sm"
                  title="Ampliar"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
                <a
                  href={message.artifact.downloadUrl}
                  download
                  className="p-2 bg-black/50 hover:bg-black/70 text-white rounded-lg transition-colors backdrop-blur-sm"
                  title="Descargar"
                >
                  <Download className="h-4 w-4" />
                </a>
              </div>
            </div>
          ) : (
            (() => {
              // Normalize artifact type for display: accept both word/excel/ppt and document/spreadsheet/presentation
              const artTypeNorm: Record<string, string> = { word: 'document', excel: 'spreadsheet', ppt: 'presentation', docx: 'document', xlsx: 'spreadsheet', pptx: 'presentation' };
              const artType = artTypeNorm[message.artifact.type] || message.artifact.type;
              const artFileName = message.artifact.filename || message.artifact.name;
              return (
                <div className={cn("p-4 rounded-xl border shadow-sm",
                  artType === "document" && "bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border-blue-200 dark:border-blue-800",
                  artType === "spreadsheet" && "bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 border-green-200 dark:border-green-800",
                  artType === "presentation" && "bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30 border-orange-200 dark:border-orange-800",
                  artType === "pdf" && "bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-950/30 border-red-200 dark:border-red-800",
                  !["document", "spreadsheet", "presentation", "pdf"].includes(artType) && "bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border-blue-200 dark:border-blue-800"
                )}>
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm",
                      artType === "document" && "bg-blue-600",
                      artType === "spreadsheet" && "bg-green-600",
                      artType === "presentation" && "bg-orange-500",
                      artType === "pdf" && "bg-red-600",
                      !["document", "spreadsheet", "presentation", "pdf"].includes(artType) && "bg-gray-600"
                    )}>
                      {artType === "document" && <span className="text-white text-lg font-bold">W</span>}
                      {artType === "spreadsheet" && <span className="text-white text-lg font-bold">E</span>}
                      {artType === "presentation" && <span className="text-white text-lg font-bold">P</span>}
                      {artType === "pdf" && <FileText className="h-6 w-6 text-white" />}
                      {!["document", "spreadsheet", "presentation", "pdf"].includes(artType) && <FileIcon className="h-6 w-6 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate" title={artFileName}>
                        {artFileName || (artType === "document" ? "Documento Word" : artType === "spreadsheet" ? "Hoja de cálculo Excel" : artType === "presentation" ? "Presentación PowerPoint" : artType === "pdf" ? "Documento PDF" : "Documento")}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {message.artifact.sizeBytes ? `${Math.round(message.artifact.sizeBytes / 1024)}KB · ` : ""}{artType === "document" ? "Word" : artType === "spreadsheet" ? "Excel" : artType === "presentation" ? "PowerPoint" : artType === "pdf" ? "PDF" : "Documento"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {(artType === "presentation" || artType === "document" || artType === "spreadsheet") && onReopenDocument && (
                        <button
                          onClick={async () => {
                            const docType = artType === "presentation" ? "ppt"
                              : artType === "document" ? "word"
                                : "excel";
                            const docTitle = artType === "presentation" ? "Presentación PowerPoint"
                              : artType === "document" ? "Documento Word"
                                : "Hoja de cálculo Excel";

                            // Try to fetch content from contentUrl if available (for PPT deck JSON)
                            let content = "";
                            const contentUrl = (message.artifact as any)?.contentUrl;
                            if (contentUrl && docType === "ppt") {
                              try {
                                const response = await fetch(contentUrl);
                                if (response.ok) {
                                  // Get raw text - PPTEditorShell will parse it
                                  content = await response.text();
                                  console.log("[View] Fetched PPT deck content, length:", content.length);
                                }
                              } catch (error) {
                                console.error("[View] Failed to fetch content:", error);
                              }
                            }

                            // For Word documents from production pipeline, fetch the docx and convert to HTML
                            if (!content && docType === "word" && message.artifact.downloadUrl) {
                              try {
                                const response = await fetch(message.artifact.downloadUrl);
                                if (response.ok) {
                                  const blob = await response.blob();
                                  const arrayBuffer = await blob.arrayBuffer();
                                  const mammoth = await import('mammoth');
                                  const result = await mammoth.convertToHtml({ arrayBuffer });
                                  content = result.value;
                                  console.log("[View] Converted Word doc to HTML, length:", content.length);
                                }
                              } catch (error) {
                                console.error("[View] Failed to convert Word doc:", error);
                              }
                            }

                            onReopenDocument({
                              type: docType as "word" | "excel" | "ppt",
                              title: docTitle,
                              content
                            });
                          }}
                          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg flex items-center gap-2 transition-colors"
                          data-testid={`button-view-artifact-${message.id}`}
                        >
                          <Eye className="h-4 w-4" />
                          Ver
                        </button>
                      )}
                      <a
                        href={message.artifact.downloadUrl}
                        download={artFileName || true}
                        className={cn("px-4 py-2 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition-colors",
                          artType === "document" && "bg-blue-600 hover:bg-blue-700",
                          artType === "spreadsheet" && "bg-green-600 hover:bg-green-700",
                          artType === "presentation" && "bg-orange-500 hover:bg-orange-600",
                          artType === "pdf" && "bg-red-600 hover:bg-red-700",
                          !["document", "spreadsheet", "presentation", "pdf"].includes(artType) && "bg-blue-600 hover:bg-blue-700"
                        )}
                        data-testid={`button-download-artifact-${message.id}`}
                      >
                        <Download className="h-4 w-4" />
                        Descargar
                      </a>
                    </div>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      )}

      {message.googleFormPreview && (
        <div className="mt-3 w-full">
          <InlineGoogleFormPreview
            prompt={message.googleFormPreview.prompt}
            fileContext={message.googleFormPreview.fileContext}
            autoStart={message.googleFormPreview.autoStart}
          />
        </div>
      )}

      {message.gmailPreview && (
        <div className="mt-3 w-full">
          <InlineGmailPreview
            query={message.gmailPreview.query}
            action={message.gmailPreview.action}
            threadId={message.gmailPreview.threadId}
          />
        </div>
      )}

      {message.attachments && message.attachments.some(a => a.type === "document") && (
        <div className="mt-3">
          <AttachmentList
            attachments={message.attachments}
            variant={variant}
            onReopenDocument={onReopenDocument}
          />
        </div>
      )}

      {message.content && !message.isThinking && (
        <div className="flex items-center gap-3 mt-4">
          {message.timestamp && (
            <span className="text-[10px] text-muted-foreground/60">
              {formatMessageTime(message.timestamp, platformSettings.timezone_default)}
            </span>
          )}
          <ActionToolbar
            messageId={message.id}
            content={message.content}
            msgIndex={msgIndex}
            copiedMessageId={copiedMessageId}
            messageFeedback={messageFeedback}
            speakingMessageId={speakingMessageId}
            aiState={aiState}
            isRegenerating={isRegenerating}
            variant={variant}
            webSources={message.webSources}
            onCopy={onCopyMessage}
            onFeedback={onFeedback}
            onRegenerate={onRegenerate}
            onShare={onShare}
            onReadAloud={onReadAloud}
            onViewSources={() => setSourcesPanelOpen(true)}
          />
        </div>
      )}

      

      {message.webSources && message.webSources.length > 0 && (
        <SourcesPanel
          open={sourcesPanelOpen}
          onOpenChange={setSourcesPanelOpen}
          sources={message.webSources}
          searchQueries={message.searchQueries}
          totalSearches={message.totalSearches}
        />
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.message.isThinking === nextProps.message.isThinking &&
    prevProps.message.webSources === nextProps.message.webSources &&
    prevProps.msgIndex === nextProps.msgIndex &&
    prevProps.totalMessages === nextProps.totalMessages &&
    prevProps.variant === nextProps.variant &&
    prevProps.copiedMessageId === nextProps.copiedMessageId &&
    prevProps.messageFeedback[prevProps.message.id] === nextProps.messageFeedback[nextProps.message.id] &&
    prevProps.speakingMessageId === nextProps.speakingMessageId &&
    prevProps.aiState === nextProps.aiState &&
    prevProps.isRegenerating === nextProps.isRegenerating &&
    prevProps.isGeneratingImage === nextProps.isGeneratingImage &&
    prevProps.pendingGeneratedImage === nextProps.pendingGeneratedImage &&
    prevProps.minimizedDocument === nextProps.minimizedDocument
  );
});

interface MessageItemProps {
  message: Message;
  msgIndex: number;
  totalMessages: number;
  variant: "compact" | "default";
  editingMessageId: string | null;
  editContent: string;
  copiedMessageId: string | null;
  messageFeedback: Record<string, "up" | "down" | null>;
  speakingMessageId: string | null;
  isGeneratingImage: boolean;
  pendingGeneratedImage: { messageId: string; imageData: string } | null;
  latestGeneratedImageRef: React.RefObject<{ messageId: string; imageData: string } | null>;
  aiState: "idle" | "thinking" | "responding" | "agent_working";
  regeneratingMsgIndex: number | null;
  handleCopyMessage: (content: string, id: string) => void;
  handleStartEdit: (msg: Message) => void;
  handleCancelEdit: () => void;
  handleSendEdit: (id: string) => void;
  handleFeedback: (id: string, type: "up" | "down") => void;
  handleRegenerate: (index: number) => void;
  handleShare: (content: string) => void;
  handleReadAloud: (id: string, content: string) => void;
  handleOpenDocumentPreview: (doc: DocumentBlock) => void;
  handleOpenFileAttachmentPreview: (attachment: NonNullable<Message["attachments"]>[0]) => void;
  handleDownloadImage: (imageData: string) => void;
  setLightboxImage: (imageData: string | null) => void;
  handleReopenDocument?: (doc: { type: "word" | "excel" | "ppt"; title: string; content: string }) => void;
  minimizedDocument?: { type: "word" | "excel" | "ppt"; title: string; content: string; messageId?: string } | null;
  onRestoreDocument?: () => void;
  setEditContent: (value: string) => void;
  onAgentCancel?: (messageId: string, runId: string) => void;
  onAgentRetry?: (messageId: string, userMessage: string) => void;
  onAgentArtifactPreview?: (artifact: AgentArtifact) => void;
  onSuperAgentCancel?: (messageId: string) => void;
  onSuperAgentRetry?: (messageId: string) => void;
  onQuestionClick?: (question: string) => void;
}

const MessageItem = memo(function MessageItem({
  message,
  msgIndex,
  totalMessages,
  variant,
  editingMessageId,
  editContent,
  copiedMessageId,
  messageFeedback,
  speakingMessageId,
  isGeneratingImage,
  pendingGeneratedImage,
  latestGeneratedImageRef,
  aiState,
  regeneratingMsgIndex,
  handleCopyMessage,
  handleStartEdit,
  handleCancelEdit,
  handleSendEdit,
  handleFeedback,
  handleRegenerate,
  handleShare,
  handleReadAloud,
  handleOpenDocumentPreview,
  handleOpenFileAttachmentPreview,
  handleDownloadImage,
  setLightboxImage,
  handleReopenDocument,
  minimizedDocument,
  onRestoreDocument,
  setEditContent,
  onAgentCancel,
  onAgentRetry,
  onAgentArtifactPreview,
  onSuperAgentCancel,
  onSuperAgentRetry,
  onQuestionClick
}: MessageItemProps) {
  return (
    <div
      className={cn(
        "flex",
        variant === "compact"
          ? cn(
            "gap-2 text-sm",
            message.role === "user" ? "justify-end" : "justify-start"
          )
          : cn(
            "w-full max-w-3xl mx-auto gap-4",
            message.role === "user" ? "justify-end" : "justify-start"
          )
      )}
    >
      <div
        className={cn(
          "flex flex-col gap-2",
          variant === "default" && "max-w-[85%]",
          message.role === "user" ? "items-end" : "items-start"
        )}
      >
        {message.role === "user" ? (
          <UserMessage
            message={message}
            variant={variant}
            isEditing={editingMessageId === message.id}
            editContent={editContent}
            copiedMessageId={copiedMessageId}
            onEditContentChange={setEditContent}
            onCancelEdit={handleCancelEdit}
            onSendEdit={handleSendEdit}
            onCopyMessage={handleCopyMessage}
            onStartEdit={handleStartEdit}
            onOpenPreview={handleOpenFileAttachmentPreview}
            onReopenDocument={handleReopenDocument}
          />
        ) : message.role === "system" && message.attachments?.some(a => a.type === "document") ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AttachmentList
              attachments={message.attachments}
              variant={variant}
              onReopenDocument={handleReopenDocument}
            />
          </div>
        ) : (
          <AssistantMessage
            message={message}
            msgIndex={msgIndex}
            totalMessages={totalMessages}
            variant={variant}
            copiedMessageId={copiedMessageId}
            messageFeedback={messageFeedback}
            speakingMessageId={speakingMessageId}
            aiState={aiState}
            isRegenerating={regeneratingMsgIndex === msgIndex}
            isGeneratingImage={isGeneratingImage}
            pendingGeneratedImage={pendingGeneratedImage}
            latestGeneratedImageRef={latestGeneratedImageRef}
            onCopyMessage={handleCopyMessage}
            onFeedback={handleFeedback}
            onRegenerate={handleRegenerate}
            onShare={handleShare}
            onReadAloud={handleReadAloud}
            onOpenDocumentPreview={handleOpenDocumentPreview}
            onDownloadImage={handleDownloadImage}
            onOpenLightbox={setLightboxImage}
            onReopenDocument={handleReopenDocument}
            minimizedDocument={minimizedDocument}
            onRestoreDocument={onRestoreDocument}
            onAgentCancel={onAgentCancel}
            onAgentRetry={onAgentRetry}
            onAgentArtifactPreview={onAgentArtifactPreview}
            onQuestionClick={onQuestionClick}
            onSuperAgentCancel={onSuperAgentCancel}
            onSuperAgentRetry={onSuperAgentRetry}
          />
        )}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.message.role === nextProps.message.role &&
    prevProps.message.agentRun?.status === nextProps.message.agentRun?.status &&
    prevProps.message.agentRun?.eventStream?.length === nextProps.message.agentRun?.eventStream?.length &&
    prevProps.msgIndex === nextProps.msgIndex &&
    prevProps.totalMessages === nextProps.totalMessages &&
    prevProps.variant === nextProps.variant &&
    prevProps.editingMessageId === nextProps.editingMessageId &&
    prevProps.editContent === nextProps.editContent &&
    prevProps.copiedMessageId === nextProps.copiedMessageId &&
    prevProps.messageFeedback === nextProps.messageFeedback &&
    prevProps.speakingMessageId === nextProps.speakingMessageId &&
    prevProps.isGeneratingImage === nextProps.isGeneratingImage &&
    prevProps.pendingGeneratedImage === nextProps.pendingGeneratedImage &&
    prevProps.aiState === nextProps.aiState &&
    prevProps.regeneratingMsgIndex === nextProps.regeneratingMsgIndex &&
    prevProps.minimizedDocument === nextProps.minimizedDocument
  );
});

export interface MessageListProps {
  messages: Message[];
  variant: "compact" | "default";
  editingMessageId: string | null;
  editContent: string;
  setEditContent: (value: string) => void;
  copiedMessageId: string | null;
  messageFeedback: Record<string, "up" | "down" | null>;
  speakingMessageId: string | null;
  isGeneratingImage: boolean;
  pendingGeneratedImage: { messageId: string; imageData: string } | null;
  latestGeneratedImageRef: React.RefObject<{ messageId: string; imageData: string } | null>;
  streamingContent: string;
  aiState: "idle" | "thinking" | "responding" | "agent_working";
  regeneratingMsgIndex: number | null;
  handleCopyMessage: (content: string, id: string) => void;
  handleStartEdit: (msg: Message) => void;
  handleCancelEdit: () => void;
  handleSendEdit: (id: string) => void;
  handleFeedback: (id: string, type: "up" | "down") => void;
  handleRegenerate: (index: number) => void;
  handleShare: (content: string) => void;
  handleReadAloud: (id: string, content: string) => void;
  handleOpenDocumentPreview: (doc: DocumentBlock) => void;
  handleOpenFileAttachmentPreview: (attachment: NonNullable<Message["attachments"]>[0]) => void;
  handleDownloadImage: (imageData: string) => void;
  setLightboxImage: (imageData: string | null) => void;
  handleReopenDocument?: (doc: { type: "word" | "excel" | "ppt"; title: string; content: string }) => void;
  minimizedDocument?: { type: "word" | "excel" | "ppt"; title: string; content: string; messageId?: string } | null;
  onRestoreDocument?: () => void;
  onSelectSuggestedReply?: (text: string) => void;
  parentRef?: React.RefObject<HTMLDivElement>;
  enableVirtualization?: boolean;
  onAgentCancel?: (messageId: string, runId: string) => void;
  onAgentRetry?: (messageId: string, userMessage: string) => void;
  onAgentArtifactPreview?: (artifact: AgentArtifact) => void;
  onSuperAgentCancel?: (messageId: string) => void;
  onSuperAgentRetry?: (messageId: string) => void;
  onQuestionClick?: (question: string) => void;
  activeRunId?: string | null;
  onRunComplete?: (artifacts: Array<{ id: string; type: string; name: string; url: string }>) => void;
  uiPhase?: 'idle' | 'thinking' | 'console' | 'done';
  aiProcessSteps?: { step: string; status: "pending" | "active" | "done" }[];
}

const VIRTUALIZATION_THRESHOLD = 50;
const ESTIMATED_MESSAGE_HEIGHT = 120;

export function MessageList({
  messages,
  variant,
  editingMessageId,
  editContent,
  setEditContent,
  copiedMessageId,
  messageFeedback,
  speakingMessageId,
  isGeneratingImage,
  pendingGeneratedImage,
  latestGeneratedImageRef,
  streamingContent,
  aiState,
  regeneratingMsgIndex,
  handleCopyMessage,
  handleStartEdit,
  handleCancelEdit,
  handleSendEdit,
  handleFeedback,
  handleRegenerate,
  handleShare,
  handleReadAloud,
  handleOpenDocumentPreview,
  handleOpenFileAttachmentPreview,
  handleDownloadImage,
  setLightboxImage,
  handleReopenDocument,
  minimizedDocument,
  onRestoreDocument,
  onSelectSuggestedReply,
  parentRef,
  enableVirtualization = true,
  onAgentCancel,
  onAgentRetry,
  onAgentArtifactPreview,
  onSuperAgentCancel,
  onSuperAgentRetry,
  onQuestionClick,
  activeRunId,
  onRunComplete,
  uiPhase = 'idle',
  aiProcessSteps = []
}: MessageListProps) {
  const internalParentRef = useRef<HTMLDivElement>(null);
  const scrollRef = parentRef || internalParentRef;

  // Debug: Log activeRunId and variant for troubleshooting
  messageLogger.debug('Render check:', { activeRunId, variant, aiState, uiPhase, streamingContent: !!streamingContent });

  const shouldVirtualize = enableVirtualization && messages.length > VIRTUALIZATION_THRESHOLD && variant === "default";

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_MESSAGE_HEIGHT,
    overscan: 5,
    enabled: shouldVirtualize
  });

  const lastAssistantMessage = useMemo(() => {
    return messages.filter(m => m.role === "assistant").pop();
  }, [messages]);

  const detectedIntent = useMemo(() => {
    const lastUserMsg = messages.filter(m => m.role === "user").pop();
    return lastUserMsg ? detectClientIntent(lastUserMsg.content) : undefined;
  }, [messages]);

  const getProcessStepText = useCallback((step: {
    step?: string;
    title?: string;
    description?: string;
    message?: string;
  } | undefined): string => {
    if (!step) return '';

    const rawText = [step.step, step.title, step.description, step.message].find(
      (value): value is string => typeof value === 'string' && value.trim().length > 0
    );

    return rawText?.toLowerCase() ?? '';
  }, []);

  // Map backend steps to thinking phases for real-time sync
  const realTimePhase = useMemo(() => {
    if (!aiProcessSteps.length) return undefined;

    // Find the latest active or done step
    const activeStep = aiProcessSteps.find(s => s.status === 'active') || aiProcessSteps[aiProcessSteps.length - 1];
    if (!activeStep) return undefined;

    const stepText = getProcessStepText(activeStep as typeof activeStep & {
      title?: string;
      description?: string;
      message?: string;
    });
    if (!stepText) return 'processing';

    if (stepText.includes('connect') || stepText.includes('start')) return 'connecting';
    if (stepText.includes('search') || stepText.includes('query')) return 'searching';
    if (stepText.includes('analyz') || stepText.includes('read') || stepText.includes('review')) return 'analyzing';
    if (stepText.includes('process') || stepText.includes('comput') || stepText.includes('calculat')) return 'processing';
    if (stepText.includes('generat') || stepText.includes('writ') || stepText.includes('creat')) return 'generating';
    if (stepText.includes('respond') || stepText.includes('reply')) return 'responding';
    if (stepText.includes('final') || stepText.includes('don') || stepText.includes('complet')) return 'finalizing';

    return 'processing'; // Default fallback
  }, [aiProcessSteps, getProcessStepText]);

  const isLastMessageAssistant = messages.length > 0 && messages[messages.length - 1].role === "assistant";
  const showSuggestedReplies = variant === "default" && aiState === "idle" && isLastMessageAssistant && lastAssistantMessage && !streamingContent;

  const suggestions = useMemo(() => {
    return showSuggestedReplies && lastAssistantMessage ? generateSuggestions(lastAssistantMessage.content) : [];
  }, [showSuggestedReplies, lastAssistantMessage?.content]);

  if (shouldVirtualize) {
    return (
      <div
        ref={!parentRef ? internalParentRef : undefined}
        className="flex flex-col gap-4"
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const msg = messages[virtualRow.index];
          return (
            <div
              key={msg.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
            >
              <MessageItem
                message={msg}
                msgIndex={virtualRow.index}
                totalMessages={messages.length}
                variant={variant}
                editingMessageId={editingMessageId}
                editContent={editContent}
                copiedMessageId={copiedMessageId}
                messageFeedback={messageFeedback}
                speakingMessageId={speakingMessageId}
                isGeneratingImage={isGeneratingImage}
                pendingGeneratedImage={pendingGeneratedImage}
                latestGeneratedImageRef={latestGeneratedImageRef}
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
                onRestoreDocument={onRestoreDocument}
                setEditContent={setEditContent}
                onAgentCancel={onAgentCancel}
                onAgentRetry={onAgentRetry}
                onAgentArtifactPreview={onAgentArtifactPreview}
                onSuperAgentCancel={onSuperAgentCancel}
                onSuperAgentRetry={onSuperAgentRetry}
                onQuestionClick={onQuestionClick}
              />
            </div>
          );
        })}

        {streamingContent && variant === "default" && (
          <div
            className="flex w-full max-w-3xl mx-auto gap-4 justify-start"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualizer.getTotalSize()}px)`,
            }}
          >
            <div className="flex flex-col gap-2 max-w-[85%] items-start min-w-0">
              <div className="text-sm prose prose-sm dark:prose-invert max-w-none leading-relaxed min-w-0">
                <MarkdownErrorBoundary key={`stream-virt-${streamingContent.length}`} fallbackContent={streamingContent}>
                  <MarkdownRenderer
                    content={streamingContent}
                    customComponents={{ ...CleanDataTableComponents }}
                  />
                </MarkdownErrorBoundary>
                <span className="inline-block w-2 h-4 bg-primary/70 animate-pulse ml-0.5" />
              </div>
            </div>
          </div>
        )}

        {showSuggestedReplies && suggestions.length > 0 && onSelectSuggestedReply && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="flex w-full max-w-3xl mx-auto gap-4 justify-start mt-2"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualizer.getTotalSize() + 20}px)`,
            }}
          >
            <SuggestedReplies
              suggestions={suggestions}
              onSelect={onSelectSuggestedReply}
            />
          </motion.div>
        )}

        {/* Simple thinking indicator (virtualized) */}
        {aiState !== "idle" && !streamingContent && variant === "default" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            data-testid="thinking-indicator-virtualized"
            className="flex w-full max-w-3xl mx-auto gap-4 justify-start px-4"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualizer.getTotalSize()}px)`,
            }}
          >
            <div className="flex items-center gap-2 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              {aiProcessSteps.length > 0 && (() => {
                const active = aiProcessSteps.find(s => s.status === 'active');
                const activeStepText = getProcessStepText(active as typeof active & {
                  title?: string;
                  description?: string;
                  message?: string;
                });
                if (active) return (
                  <span className="text-xs text-muted-foreground ml-1 animate-in fade-in">
                    {activeStepText || 'Procesando...'}
                  </span>
                );
                return null;
              })()}
            </div>
          </motion.div>
        )}
      </div>
    );
  }

  return (
    <>
      {messages.map((msg, msgIndex) => (
        <MessageItem
          key={msg.id}
          message={msg}
          msgIndex={msgIndex}
          totalMessages={messages.length}
          variant={variant}
          editingMessageId={editingMessageId}
          editContent={editContent}
          copiedMessageId={copiedMessageId}
          messageFeedback={messageFeedback}
          speakingMessageId={speakingMessageId}
          isGeneratingImage={isGeneratingImage}
          pendingGeneratedImage={pendingGeneratedImage}
          latestGeneratedImageRef={latestGeneratedImageRef}
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
          onRestoreDocument={onRestoreDocument}
          setEditContent={setEditContent}
          onAgentCancel={onAgentCancel}
          onAgentRetry={onAgentRetry}
          onAgentArtifactPreview={onAgentArtifactPreview}
          onSuperAgentCancel={onSuperAgentCancel}
          onSuperAgentRetry={onSuperAgentRetry}
          onQuestionClick={onQuestionClick}
        />
      ))}

      {streamingContent && variant === "default" && (
        <div className="flex w-full max-w-3xl mx-auto gap-4 justify-start">
          <div className="flex flex-col gap-2 max-w-[85%] items-start min-w-0">
            <div className="text-sm prose prose-sm dark:prose-invert max-w-none leading-relaxed min-w-0">
              <MarkdownErrorBoundary key={`stream-std-${streamingContent.length}`} fallbackContent={streamingContent}>
                <MarkdownRenderer
                  content={streamingContent}
                  customComponents={{ ...CleanDataTableComponents }}
                />
              </MarkdownErrorBoundary>
              <span className="inline-block w-2 h-4 bg-primary/70 animate-pulse ml-0.5" />
            </div>
          </div>
        </div>
      )}

      {showSuggestedReplies && suggestions.length > 0 && onSelectSuggestedReply && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex w-full max-w-3xl mx-auto gap-4 justify-start mt-2"
        >
          <SuggestedReplies
            suggestions={suggestions}
            onSelect={onSelectSuggestedReply}
          />
        </motion.div>
      )}

      {/* Simple thinking indicator (standard) */}
      {aiState !== "idle" && !streamingContent && variant === "default" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          data-testid="thinking-indicator-standard"
          className="flex w-full max-w-3xl mx-auto gap-4 justify-start px-4"
        >
          <div className="flex items-center gap-2 py-3">
            <div className="flex gap-1">
              <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        </motion.div>
      )}
    </>
  );
}

export { CleanDataTableComponents, parseDocumentBlocks };
export type { DocumentBlock };
