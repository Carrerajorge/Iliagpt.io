
import React, { memo } from "react";
import {
    X,
    Send,
    Pencil,
    Copy,
    CheckCircle2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { Message } from "@/hooks/use-chats";
import { AttachmentList, formatMessageTime, DocumentBlock } from "./MessageParts";
import type { ReopenDocumentRequest } from "@/lib/documentPreviewContracts";

export interface UserMessageProps {
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
    onOpenPreview: (attachment: NonNullable<Message["attachments"]>[0]) => void;
    onReopenDocument?: (doc: ReopenDocumentRequest) => void;
    onRetrySend?: (msg: Message) => void;
}

export const UserMessage = memo(function UserMessage({
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
    onReopenDocument,
    onRetrySend
}: UserMessageProps) {
    const { settings: platformSettings } = usePlatformSettings();

    if (variant === "compact") {
        return (
            <div className="flex flex-col items-end gap-1 max-w-full">
                {message.attachments && message.attachments.length > 0 && (
                    <AttachmentList
                        attachments={message.attachments}
                        variant={variant}
                        onOpenPreview={onOpenPreview}
                        onReopenDocument={onReopenDocument}
                    />
                )}
                {message.content && (
                    <div className="bg-primary/10 text-primary-foreground px-3 py-2 rounded-lg max-w-full text-sm">
                        <span className="text-muted-foreground mr-1 font-medium">
                            Instrucción:
                        </span>
                        <span className="text-foreground">{message.content}</span>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="flex flex-col items-end gap-1">
            {isEditing ? (
                <div className="w-full min-w-0 sm:min-w-[450px] max-w-[650px]">
                    <Textarea
                        value={editContent}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onEditContentChange(e.target.value)}
                        className="w-full px-4 py-3 text-sm min-h-[150px] resize-y rounded-2xl border border-border/20 bg-background/50 focus:border-border/30 focus:ring-0 outline-none transition-colors"
                        autoFocus
                    />
                    <div className="flex items-center justify-end gap-2 mt-2">
                        <button
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-lg"
                            onClick={onCancelEdit}
                        >
                            <X className="h-3.5 w-3.5" />
                            Cancelar
                        </button>
                        <button
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-lg"
                            onClick={() => onSendEdit(message.id)}
                        >
                            <Send className="h-3.5 w-3.5" />
                            Enviar
                        </button>
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
                        <div className="liquid-message-user px-4 py-2.5 text-sm break-words leading-relaxed text-white dark:text-gray-950">
                            {message.content}
                        </div>
                    )}
                    <div className="flex items-center justify-end gap-1.5 mt-1">
                        {message.timestamp && (
                            <span className="text-[10px] text-muted-foreground/60 mr-1">
                                {formatMessageTime(message.timestamp, platformSettings.timezone_default)}
                            </span>
                        )}
                        {message.deliveryStatus === "sending" && (
                            <span className="text-[10px] text-muted-foreground/70 flex items-center gap-0.5">
                                <svg className="h-3 w-3 animate-spin" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="20 10" /></svg>
                            </span>
                        )}
                        {message.deliveryStatus === "sent" && (
                            <span className="text-[10px] text-muted-foreground/60 flex items-center">
                                <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            </span>
                        )}
                        {message.deliveryStatus === "delivered" && (
                            <span className="text-[10px] text-blue-500 flex items-center -space-x-1">
                                <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            </span>
                        )}
                        {message.deliveryStatus === "error" && (
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-destructive flex items-center gap-1" title={message.deliveryError || undefined}>
                                    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 10.5a.75.75 0 110-1.5.75.75 0 010 1.5zM8.75 4.5v4a.75.75 0 01-1.5 0v-4a.75.75 0 011.5 0z"/></svg>
                                    Error
                                </span>
                                {onRetrySend && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-[10px] text-destructive hover:text-destructive"
                                        onClick={() => onRetrySend(message)}
                                    >
                                        Reintentar
                                    </Button>
                                )}
                            </div>
                        )}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                onClick={() => onCopyMessage(message.content, message.id)}
                                data-testid={`button-copy-user-${message.id}`}
                                title="Copiar mensaje"
                                aria-label="Copiar mensaje"
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
                                title="Editar"
                                aria-label="Editar"
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
        prevProps.message.clientTempId === nextProps.message.clientTempId &&
        prevProps.message.content === nextProps.message.content &&
        prevProps.message.deliveryStatus === nextProps.message.deliveryStatus &&
        prevProps.message.deliveryError === nextProps.message.deliveryError &&
        prevProps.variant === nextProps.variant &&
        prevProps.isEditing === nextProps.isEditing &&
        prevProps.editContent === nextProps.editContent &&
        prevProps.copiedMessageId === nextProps.copiedMessageId &&
        prevProps.message.attachments === nextProps.message.attachments
    );
});
