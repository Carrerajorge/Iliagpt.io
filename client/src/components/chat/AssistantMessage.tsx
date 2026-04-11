
import React, { memo, useState, useMemo, useCallback } from "react";
import {
    CheckCircle2,
    Loader2,
    FileText,
    FileSpreadsheet,
    FileIcon,
    Maximize2,
    ZoomIn,
    Download,
    Eye
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
    Message,
    WebSource,
    storeGeneratedImage,
    getGeneratedImage,
    storeLastGeneratedImageInfo
} from "@/hooks/use-chats";
import { AgentArtifact } from "@/components/agent-steps-display";
import { useSuperAgentRun } from "@/stores/super-agent-store";
import { MarkdownRenderer, MarkdownErrorBoundary } from "@/components/markdown-renderer";
import { UncertaintyBadge } from "@/components/ui/uncertainty-badge";
import { VerificationBadge } from "@/components/ui/verification-badge";
import { SuperAgentDisplay } from "@/components/super-agent-display";
import { RetrievalVis } from "@/components/retrieval-vis";
import { NewsCards } from "@/components/news-cards";
import { CodeExecutionBlock } from "@/components/code-execution-block";

import { ArtifactViewer } from "@/components/artifact-viewer";
import { FigmaBlock } from "@/components/figma-block";
import { InlineGoogleFormPreview } from "@/components/inline-google-form-preview";
import { InlineGmailPreview } from "@/components/inline-gmail-preview";
import { FilePreviewSurface } from "@/components/FilePreviewSurface";
import { isRenderablePreview } from "@/lib/filePreviewTypes";
import { OfficeStepsPanel } from "@/components/office/OfficeStepsPanel";
import { SourcesPanel } from "@/components/sources-panel";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { useSettingsContext } from "@/contexts/SettingsContext";
import type { ReopenDocumentRequest } from "@/lib/documentPreviewContracts";

import {
    parseDocumentBlocks,
    extractCodeBlocks,
    formatMessageTime,
    CleanDataTableComponents,
    AttachmentList,
    ActionToolbar,
    DocumentBlock
} from "./MessageParts";
import { AgentRunContent } from "./AgentRunContent";
import { AgentRunTimeline } from "./AgentRunTimeline";
import { AgentStateIndicator } from "./AgentStateIndicator";
import { type AIState } from "@/components/chat-interface/types";
import { IliaAdBanner } from "@/components/ilia-ad-banner";
import { downloadArtifact } from "@/lib/localArtifactAccess";

export interface AssistantMessageProps {
    message: Message;
    msgIndex: number;
    totalMessages: number;
    assistantMsgNumber: number;
    variant: "compact" | "default";
    copiedMessageId: string | null;
    messageFeedback: Record<string, "up" | "down" | null>;
    speakingMessageId: string | null;
    aiState: AIState;
    isRegenerating: boolean;
    isGeneratingImage: boolean;
    pendingGeneratedImage: { messageId: string; imageData: string } | null;
    latestGeneratedImageRef: React.RefObject<{ messageId: string; imageData: string } | null>;
    onCopyMessage: (content: string, id: string) => void;
    onFeedback: (id: string, type: "up" | "down") => void;
    onRegenerate: (index: number, instruction?: string) => void;
    onShare: (content: string) => void;
    onReadAloud: (id: string, content: string) => void;
    onOpenDocumentPreview: (doc: DocumentBlock) => void;
    onDownloadImage: (imageData: string) => void;
    onOpenLightbox: (imageData: string | null) => void;
    onReopenDocument?: (doc: ReopenDocumentRequest) => void;
    minimizedDocument?: { type: "word" | "excel" | "ppt"; title: string; content: string; messageId?: string } | null;
    onRestoreDocument?: () => void;
    onAgentCancel?: (messageId: string, runId: string) => void;
    onAgentRetry?: (messageId: string, userMessage: string) => void;
    onAgentArtifactPreview?: (artifact: AgentArtifact) => void;
    onQuestionClick?: (question: string) => void;
    onSuperAgentCancel?: (messageId: string) => void;
    onSuperAgentRetry?: (messageId: string) => void;
    onToolConfirm?: (messageId: string, toolName: string, stepIndex: number) => void;
    onToolDeny?: (messageId: string, toolName: string, stepIndex: number) => void;
}

function artifactRenderSignature(message: Message): string {
    const artifacts = Array.isArray(message.artifacts) && message.artifacts.length > 0
        ? message.artifacts
        : message.artifact
            ? [message.artifact]
            : [];

    return artifacts
        .map((artifact, index) => [
            artifact.artifactId || `artifact-${index}`,
            artifact.type,
            artifact.mimeType,
            artifact.downloadUrl,
            artifact.previewUrl,
            artifact.filename,
            artifact.name,
            artifact.previewHtml ? `html:${artifact.previewHtml.length}` : "",
        ].filter(Boolean).join("|"))
        .join("||");
}

export const AssistantMessage = memo(function AssistantMessage({
    message,
    msgIndex,
    totalMessages,
    assistantMsgNumber,
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
    onSuperAgentRetry,
    onToolConfirm,
    onToolDeny
}: AssistantMessageProps) {
    const handleArtifactDownload = useCallback(async (event: React.MouseEvent, url?: string | null, fallbackName?: string) => {
        if (!url) return;
        event.preventDefault();
        try {
            await downloadArtifact(url, fallbackName);
        } catch (error) {
            console.error("[ArtifactDownload] Failed to download artifact:", error);
            window.open(url, "_blank", "noopener,noreferrer");
        }
    }, []);

    const openArtifactPreview = useCallback(async (artifact: NonNullable<Message["artifact"]>) => {
        if (!onReopenDocument) return;
        const artTypeNorm: Record<string, "word" | "excel" | "ppt" | "pdf"> = {
            document: "word",
            spreadsheet: "excel",
            presentation: "ppt",
            pdf: "pdf",
            docx: "word",
            xlsx: "excel",
            pptx: "ppt",
        };
        const type = artTypeNorm[String(artifact.type).toLowerCase()];
        if (!type) return;

        onReopenDocument({
            type,
            title: String(artifact.filename || artifact.name || "Documento"),
            content: "",
            downloadUrl: artifact.downloadUrl,
            previewUrl: (artifact as any)?.previewUrl || artifact.downloadUrl,
            previewHtml: (artifact as any)?.previewHtml,
            mimeType: artifact.mimeType,
            fileName: String(artifact.filename || artifact.name || "documento"),
            messageId: message.id,
        });
    }, [message.id, onReopenDocument]);

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
    const renderedArtifacts = useMemo(
        () => (Array.isArray(message.artifacts) && message.artifacts.length > 0
            ? message.artifacts
            : message.artifact
                ? [message.artifact]
                : []),
        [message.artifact, message.artifacts],
    );

    const showSkeleton =
        isGeneratingImage &&
        message.role === "assistant" &&
        msgIndex === totalMessages - 1 &&
        !imageData;

    return (
        <div className="flex flex-col gap-0.5 w-full min-w-0">
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
                                className="prose dark:prose-invert max-w-none min-w-0"
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
                        <div className="flex gap-2 flex-wrap mt-3">
                            {documents.map((doc, idx) => (
                                <Button
                                    key={idx}
                                    variant="outline"
                                    className="flex items-center gap-2 px-4 py-2 h-auto"
                                    onClick={() => onOpenDocumentPreview(doc)}
                                >
                                    {doc.type === "word" && (
                                        <FileText className="h-5 w-5 text-blue-600" />
                                    )}
                                    {doc.type === "excel" && (
                                        <FileSpreadsheet className="h-5 w-5 text-green-600" />
                                    )}
                                    {doc.type === "ppt" && (
                                        <FileIcon className="h-5 w-5 text-orange-600" />
                                    )}
                                    <span className="text-sm font-medium">{doc.title}</span>
                                </Button>
                            ))}
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
            {renderedArtifacts.length > 0 && (
                <div className="mt-3 w-full">
                    {renderedArtifacts.length === 1 && renderedArtifacts[0].type === "image" ? (
                        <div className="relative rounded-xl overflow-hidden group">
                            <img
                                src={renderedArtifacts[0].previewUrl || renderedArtifacts[0].downloadUrl}
                                alt="Imagen generada"
                                className="max-w-full max-h-[500px] object-contain rounded-xl cursor-pointer hover:opacity-95 transition-all shadow-sm hover:shadow-md"
                                onClick={() => onOpenLightbox(renderedArtifacts[0]?.previewUrl || renderedArtifacts[0]?.downloadUrl || "")}
                                data-testid={`image-artifact-${message.id}`}
                            />
                            <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={() => onOpenLightbox(renderedArtifacts[0]?.previewUrl || renderedArtifacts[0]?.downloadUrl || "")}
                                    className="p-2 bg-black/50 hover:bg-black/70 text-white rounded-lg transition-colors backdrop-blur-sm"
                                    title="Ampliar"
                                >
                                    <ZoomIn className="h-4 w-4" />
                                </button>
                                <a
                                    href={renderedArtifacts[0].downloadUrl}
                                    download
                                    onClick={(event) => void handleArtifactDownload(event, renderedArtifacts[0]?.downloadUrl, renderedArtifacts[0]?.name)}
                                    className="p-2 bg-black/50 hover:bg-black/70 text-white rounded-lg transition-colors backdrop-blur-sm"
                                    title="Descargar"
                                >
                                    <Download className="h-4 w-4" />
                                </a>
                            </div>
                        </div>
                    ) : (
                        <>
                            {renderedArtifacts.map((artifact, index) => {
                                const officeRunIdFromArtifactUrl = [
                                    artifact?.downloadUrl,
                                    (artifact as any)?.previewUrl,
                                ]
                                    .map((value) => (typeof value === "string" ? value.match(/\/api\/office-engine\/runs\/([0-9a-f-]{36})\//i)?.[1] : null))
                                    .find((value): value is string => typeof value === "string" && value.length > 0);
                                const officeRunId =
                                    typeof (artifact as any)?.metadata?.officeRunId === "string"
                                        ? String((artifact as any).metadata.officeRunId)
                                        : officeRunIdFromArtifactUrl || null;
                                const artifactTypeMap: Record<string, "docx" | "xlsx" | "pptx" | "pdf"> = {
                                    document: "docx",
                                    spreadsheet: "xlsx",
                                    presentation: "pptx",
                                    pdf: "pdf",
                                };
                                const previewHtml = (artifact as any)?.previewHtml;
                                const previewType = artifactTypeMap[(artifact as any)?.type] || "docx";
                                const themeLabel = (artifact as any)?.metadata?.theme || (artifact as any)?.metadata?.brandTheme;

                                return (
                                    <React.Fragment key={`${artifact.artifactId || artifact.downloadUrl || message.id}-${index}`}>
                                        {officeRunId && (
                                            <div
                                                className="mb-3 rounded-xl border border-border bg-background/70"
                                                data-testid={`office-steps-${message.id}-${index}`}
                                            >
                                                <OfficeStepsPanel runId={officeRunId} />
                                            </div>
                                        )}
                                        <div className="mb-3 p-4 rounded-lg border bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border-blue-200 dark:border-blue-800">
                                            {isRenderablePreview(previewHtml ? { type: previewType, html: previewHtml } : null) && (
                                                <div className="mb-4 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                                                    {themeLabel && (
                                                        <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
                                                            <span className="inline-flex rounded-full bg-foreground px-2.5 py-1 text-[11px] uppercase tracking-wide text-background">
                                                                {String(themeLabel)}
                                                            </span>
                                                            {(artifact as any)?.metadata?.brandName && (
                                                                <span className="truncate text-muted-foreground">{String((artifact as any).metadata.brandName)}</span>
                                                            )}
                                                        </div>
                                                    )}
                                                    <div className="h-52 w-full bg-muted">
                                                        <FilePreviewSurface
                                                            preview={{ type: previewType, html: previewHtml }}
                                                            variant="thumbnail"
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                            <div className="flex items-center gap-3">
                                                <div className={cn(
                                                    "w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0",
                                                    artifact.type === "document" && "bg-blue-600",
                                                    artifact.type === "spreadsheet" && "bg-green-600",
                                                    artifact.type === "presentation" && "bg-orange-600",
                                                    artifact.type === "pdf" && "bg-red-600"
                                                )}>
                                                    {artifact.type === "document" && <FileText className="h-6 w-6 text-white" />}
                                                    {artifact.type === "spreadsheet" && <FileSpreadsheet className="h-6 w-6 text-white" />}
                                                    {artifact.type === "presentation" && <FileIcon className="h-6 w-6 text-white" />}
                                                    {artifact.type === "pdf" && <FileText className="h-6 w-6 text-white" />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <p className="text-sm font-medium text-foreground">
                                                            {artifact.type === "document" && "Documento Word"}
                                                            {artifact.type === "spreadsheet" && "Hoja de cálculo Excel"}
                                                            {artifact.type === "presentation" && "Presentación PowerPoint"}
                                                            {artifact.type === "pdf" && "Documento PDF"}
                                                        </p>
                                                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold animate-in fade-in duration-500">
                                                            ✓ Listo
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground">
                                                        {artifact.name || (artifact.sizeBytes ? `${Math.round(artifact.sizeBytes / 1024)}KB` : "Listo para descargar")}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {(artifact.type === "presentation" || artifact.type === "document" || artifact.type === "spreadsheet" || artifact.type === "pdf") && (officeRunId || onReopenDocument) && (
                                                        <button
                                                            onClick={() => void openArtifactPreview(artifact)}
                                                            className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground text-sm font-medium rounded-lg flex items-center gap-2 transition-colors"
                                                            data-testid={`button-view-artifact-${message.id}-${index}`}
                                                            type="button"
                                                        >
                                                            <Eye className="h-4 w-4" />
                                                            Ver
                                                        </button>
                                                    )}
                                                    {(((artifact as any)?.previewUrl) || ((artifact as any)?.previewHtml)) && (
                                                        <button
                                                            type="button"
                                                            onClick={() => void openArtifactPreview(artifact)}
                                                            className="px-4 py-2 bg-card hover:bg-muted text-foreground text-sm font-medium rounded-lg flex items-center gap-2 transition-colors border border-border"
                                                            data-testid={`button-preview-artifact-${message.id}-${index}`}
                                                        >
                                                            <Eye className="h-4 w-4" />
                                                            Preview
                                                        </button>
                                                    )}
                                                    <a
                                                        href={artifact.downloadUrl}
                                                        download
                                                        onClick={(event) => void handleArtifactDownload(event, artifact.downloadUrl, artifact.filename || artifact.name)}
                                                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition-colors"
                                                        data-testid={`button-download-artifact-${message.id}-${index}`}
                                                    >
                                                        <Download className="h-4 w-4" />
                                                        Descargar
                                                    </a>
                                                </div>
                                            </div>
                                        </div>
                                    </React.Fragment>
                                );
                            })}
                        </>
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
                <>
                    {message.webSources && message.webSources.length > 0 && (
                        <button
                            onClick={() => setSourcesPanelOpen(true)}
                            className="inline-flex items-center gap-1 mt-1 mb-0.5 text-sm text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors cursor-pointer group"
                            data-testid={`button-sources-link-${message.id}`}
                        >
                            <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20">
                                📌 {message.webSources.length} fuente{message.webSources.length !== 1 ? "s" : ""}
                            </span>
                        </button>
                    )}
                    <div className="inline-flex items-center gap-0.5 mt-0">
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
                            aiState={aiState as "idle" | "agent_working" | "thinking" | "responding"}
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
                    {assistantMsgNumber > 0 && assistantMsgNumber % 3 === 0 && (
                        <IliaAdBanner
                            query={message.content.slice(0, 300)}
                            messageId={message.id}
                        />
                    )}
                </>
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
        artifactRenderSignature(prevProps.message) === artifactRenderSignature(nextProps.message) &&
        prevProps.msgIndex === nextProps.msgIndex &&
        prevProps.totalMessages === nextProps.totalMessages &&
        prevProps.assistantMsgNumber === nextProps.assistantMsgNumber &&
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
