
import React, { useRef, useMemo, useEffect, useCallback } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { motion, AnimatePresence } from "framer-motion";
import { Message } from "@/hooks/use-chats";
import { MessageItem } from "./MessageItem";
import { type AIState, isAiBusyState } from "@/components/chat-interface/types";
import { SuggestedReplies, generateSuggestions } from "@/components/suggested-replies";
import { PhaseNarrator } from "@/components/thinking-indicator";
import { LiveExecutionConsole } from "@/components/live-execution-console";
import { MarkdownRenderer, MarkdownErrorBoundary } from "@/components/markdown-renderer";
import { CleanDataTableComponents, DocumentBlock, parseDocumentBlocks } from "./MessageParts";
import { detectClientIntent } from "@/lib/clientIntentDetector";
import { messageLogger } from "@/lib/logger";
import { AgentArtifact } from "@/components/agent-steps-display";

// Fallback ID for the synthetic streaming message. When a pre-generated
// messageId is provided via `streamingMsgId` prop, we use that instead
// so the streaming message and the finalized message share the SAME key,
// preventing Virtuoso from unmounting/remounting the DOM node.
const STREAMING_MSG_ID_FALLBACK = "__streaming__";

export interface ChatMessageListProps {
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
    aiState: AIState;
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
    streamingMsgId?: string | null;
    onUserRetrySend?: (message: Message) => void;
    onToolConfirm?: (messageId: string, toolName: string, stepIndex: number) => void;
    onToolDeny?: (messageId: string, toolName: string, stepIndex: number) => void;
}

export function ChatMessageList({
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
    onAgentCancel,
    onAgentRetry,
    onAgentArtifactPreview,
    onSuperAgentCancel,
    onSuperAgentRetry,
    onQuestionClick,
    activeRunId,
    onRunComplete,
    uiPhase = 'idle',
    aiProcessSteps = [],
    streamingMsgId,
    onUserRetrySend,
    onToolConfirm,
    onToolDeny
}: ChatMessageListProps) {
    const virtuosoRef = useRef<VirtuosoHandle>(null);

    // Effective streaming message ID: use pre-generated ID if available (for zero-flicker),
    // otherwise fall back to the fixed "__streaming__" constant.
    const effectiveStreamingId = streamingMsgId || STREAMING_MSG_ID_FALLBACK;

    // Track the previous streaming content length for transition detection.
    // When streaming goes from non-empty to empty, we know a finalize just
    // happened — the optimistic message should already be in `messages`.
    const prevStreamingRef = useRef(streamingContent);
    useEffect(() => {
        prevStreamingRef.current = streamingContent;
    }, [streamingContent]);

    // Debug logging
    useEffect(() => {
        messageLogger.debug('ChatMessageList render', {
            msgCount: messages.length,
            aiState,
            variant,
            streaming: !!streamingContent
        });
    }, [messages.length, aiState, variant, streamingContent]);

    const lastAssistantMessage = useMemo(() => {
        return messages.filter(m => m.role === "assistant").pop();
    }, [messages]);

    const detectedIntent = useMemo(() => {
        const lastUserMsg = messages.filter(m => m.role === "user").pop();
        return lastUserMsg ? detectClientIntent(lastUserMsg.content) : undefined;
    }, [messages]);

    const realTimePhase = useMemo(() => {
        if (!aiProcessSteps.length) return undefined;
        const activeStep = aiProcessSteps.find(s => s.status === 'active') || aiProcessSteps[aiProcessSteps.length - 1];
        if (!activeStep) return undefined;

        const stepText = activeStep.step.toLowerCase();
        if (stepText.includes('connect') || stepText.includes('start')) return 'connecting';
        if (stepText.includes('search') || stepText.includes('query')) return 'searching';
        if (stepText.includes('analyz') || stepText.includes('read') || stepText.includes('review')) return 'analyzing';
        if (stepText.includes('process') || stepText.includes('comput') || stepText.includes('calculat')) return 'processing';
        if (stepText.includes('generat') || stepText.includes('writ') || stepText.includes('creat')) return 'generating';
        if (stepText.includes('respond') || stepText.includes('reply')) return 'responding';
        if (stepText.includes('final') || stepText.includes('don') || stepText.includes('complet')) return 'finalizing';

        return 'processing';
    }, [aiProcessSteps]);

    // ── Merged message list ──
    // Instead of rendering streaming content in a separate footer (which causes
    // a visual "teleport" when the final message replaces it), we inject a
    // synthetic streaming message directly into the list. This means the
    // streaming text occupies the EXACT SAME position as the final message,
    // resulting in zero visual jump on finalize.
    const mergedMessages = useMemo(() => {
        if (streamingContent && variant === "default") {
            const streamingMsg: Message = {
                id: effectiveStreamingId,
                role: "assistant",
                content: streamingContent,
                timestamp: new Date(),
            };
            return [...messages, streamingMsg];
        }
        return messages;
    }, [messages, streamingContent, variant, effectiveStreamingId]);

    const assistantIndexMap = useMemo(() => {
        const map = new Map<number, number>();
        let count = 0;
        mergedMessages.forEach((msg, i) => {
            if (msg.role === "assistant") {
                count++;
                map.set(i, count);
            }
        });
        return map;
    }, [mergedMessages]);

    const isLastMessageAssistant = mergedMessages.length > 0 && mergedMessages[mergedMessages.length - 1].role === "assistant";
    const isIdleLike = aiState === "idle" || aiState === "done";
    const showSuggestedReplies = variant === "default" && isIdleLike && isLastMessageAssistant && lastAssistantMessage && !streamingContent;

    const suggestions = useMemo(() => {
        return showSuggestedReplies && lastAssistantMessage ? generateSuggestions(lastAssistantMessage.content) : [];
    }, [showSuggestedReplies, lastAssistantMessage?.content]);

    // Footer — only for non-streaming overlays (thinking indicator, suggested replies, execution console)
    const ListFooter = useMemo(() => {
        return () => (
            <>
                {showSuggestedReplies && suggestions.length > 0 && onSelectSuggestedReply && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="flex w-full max-w-3xl mx-auto gap-4 justify-start mt-2 pb-4"
                    >
                        <SuggestedReplies
                            suggestions={suggestions}
                            onSelect={onSelectSuggestedReply}
                        />
                    </motion.div>
                )}

                {uiPhase === 'console' && activeRunId && variant === "default" && (
                    <motion.div
                        key={`execution-console-virt-${activeRunId}`}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex w-full max-w-3xl mx-auto gap-4 justify-start pb-4"
                    >
                        <LiveExecutionConsole
                            key={`virt-${activeRunId}`}
                            runId={activeRunId}
                            onComplete={onRunComplete}
                            className="flex-1"
                        />
                    </motion.div>
                )}

                {isAiBusyState(aiState) && !streamingContent && variant === "default" && uiPhase !== 'console' && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        data-testid="thinking-indicator-virt"
                        className="flex w-full max-w-3xl mx-auto gap-4 justify-start px-4 pb-4"
                    >
                        <PhaseNarrator
                            autoProgress={!realTimePhase}
                            phase={realTimePhase}
                            intent={detectedIntent}
                        />
                    </motion.div>
                )}
            </>
        );
    }, [showSuggestedReplies, suggestions, onSelectSuggestedReply, uiPhase, activeRunId, onRunComplete, aiState, streamingContent, variant, realTimePhase, detectedIntent]);

    // Stable key function.
    // For optimistic messages, `id` is replaced after server ACK; use `clientTempId`
    // when available to prevent Virtuoso unmount/remount flicker.
    const computeItemKey = useCallback((index: number, msg: Message) => msg.clientTempId || msg.id, []);

    // Render a single item — streaming messages get a specialized renderer
    const renderItem = useCallback((index: number, msg: Message) => {
        // Synthetic streaming message — render with markdown + cursor.
        // We check BOTH the ID match AND that streaming is active, because after
        // finalize the same ID may be used for the real MessageItem.
        if (msg.id === effectiveStreamingId && !!streamingContent) {
            return (
                <div className="pb-4 px-2">
                    <div className="flex w-full max-w-3xl mx-auto gap-4 justify-start">
                        <div className="flex flex-col gap-2 max-w-[85%] items-start min-w-0">
                            <div className="text-sm prose prose-sm dark:prose-invert max-w-none leading-relaxed min-w-0 animate-in fade-in duration-150">
                                <MarkdownErrorBoundary key={`stream-inline-${msg.content.length}`} fallbackContent={msg.content}>
                                    <MarkdownRenderer
                                        content={msg.content}
                                        customComponents={{ ...CleanDataTableComponents }}
                                    />
                                </MarkdownErrorBoundary>
                                <span className="inline-block w-2 h-4 bg-primary/70 animate-pulse ml-0.5" />
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        // Regular message
        return (
            <div className="pb-4 px-2">
                <MessageItem
                    message={msg}
                    msgIndex={index}
                    totalMessages={mergedMessages.length}
                    assistantMsgNumber={assistantIndexMap.get(index) ?? 0}
                    variant={variant}
                    onUserRetrySend={onUserRetrySend}
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
                    onToolConfirm={onToolConfirm}
                    onToolDeny={onToolDeny}
                />
            </div>
        );
    }, [
        mergedMessages.length, variant, assistantIndexMap, editingMessageId, editContent,
        copiedMessageId, messageFeedback, speakingMessageId, isGeneratingImage,
        pendingGeneratedImage, latestGeneratedImageRef, aiState, regeneratingMsgIndex,
        handleCopyMessage, handleStartEdit, handleCancelEdit, handleSendEdit,
        handleFeedback, handleRegenerate, handleShare, handleReadAloud,
        handleOpenDocumentPreview, handleOpenFileAttachmentPreview,
        handleDownloadImage, setLightboxImage, handleReopenDocument,
        minimizedDocument, onRestoreDocument, setEditContent,
        onAgentCancel, onAgentRetry, onAgentArtifactPreview,
        onSuperAgentCancel, onSuperAgentRetry, onQuestionClick,
        effectiveStreamingId, streamingContent, onUserRetrySend
    ]);

    return (
        <div className="h-full w-full flex flex-col">
            <Virtuoso
                ref={virtuosoRef}
                data={mergedMessages}
                computeItemKey={computeItemKey}
                components={{ Footer: ListFooter }}
                initialTopMostItemIndex={mergedMessages.length - 1}
                followOutput="auto"
                alignToBottom
                className="h-full w-full scrollbar-thin scrollbar-thumb-muted-foreground/20 hover:scrollbar-thumb-muted-foreground/40"
                itemContent={renderItem}
            />
        </div>
    );
}
