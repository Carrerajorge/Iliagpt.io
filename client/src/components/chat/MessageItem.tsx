
import React, { memo } from "react";
import { cn } from "@/lib/utils";
import { Message } from "@/hooks/use-chats";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import { AttachmentList, DocumentBlock } from "./MessageParts";
import { AgentArtifact } from "@/components/agent-steps-display";
import { type AIState } from "@/components/chat-interface/types";

export interface MessageItemProps {
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
    setEditContent: (value: string) => void;
    onAgentCancel?: (messageId: string, runId: string) => void;
    onAgentRetry?: (messageId: string, userMessage: string) => void;
    onAgentArtifactPreview?: (artifact: AgentArtifact) => void;
    onSuperAgentCancel?: (messageId: string) => void;
    onSuperAgentRetry?: (messageId: string) => void;
    onQuestionClick?: (question: string) => void;
    onUserRetrySend?: (message: Message) => void;
    onToolConfirm?: (messageId: string, toolName: string, stepIndex: number) => void;
    onToolDeny?: (messageId: string, toolName: string, stepIndex: number) => void;
}

export const MessageItem = memo(function MessageItem({
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
    onQuestionClick,
    onUserRetrySend,
    onToolConfirm,
    onToolDeny
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
                        onRetrySend={onUserRetrySend}
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
                        onToolConfirm={onToolConfirm}
                        onToolDeny={onToolDeny}
                    />
                )}
            </div>
        </div>
    );
}, (prevProps, nextProps) => {
    return (
        prevProps.message.id === nextProps.message.id &&
        prevProps.message.clientTempId === nextProps.message.clientTempId &&
        prevProps.message.content === nextProps.message.content &&
        prevProps.message.role === nextProps.message.role &&
        prevProps.message.deliveryStatus === nextProps.message.deliveryStatus &&
        prevProps.message.deliveryError === nextProps.message.deliveryError &&
        prevProps.message.agentRun?.status === nextProps.message.agentRun?.status &&
        prevProps.message.agentRun?.eventStream?.length === nextProps.message.agentRun?.eventStream?.length &&
        prevProps.message.documentAnalysis === nextProps.message.documentAnalysis &&
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
