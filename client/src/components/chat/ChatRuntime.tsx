import React from "react";
import type { ActiveGpt, Message } from "@/types/chat";

interface ChatRuntimeProps {
  chatId: string;
  user: { id: string; plan?: string; subscriptionStatus?: string; name?: string } | null;
  initialMessages?: Message[];
  onSendMessage?: (message: string, attachments?: string[]) => Promise<void>;
  onRetryMessage?: (messageId: string) => void;
  aiState?: string;
  streamingContent?: string;
  streamingMessageId?: string | null;
  emptyState?: React.ReactNode;
  placeholder?: string;
  activeGpt?: ActiveGpt | null;
}

/**
 * Lightweight compatibility shim for the deprecated V2 chat shell.
 * The active app uses the main chat runtime elsewhere; this keeps old imports type-safe.
 */
export function ChatRuntime({ initialMessages = [], emptyState, placeholder = "Escribe tu mensaje..." }: ChatRuntimeProps) {
  if (initialMessages.length === 0) {
    return <>{emptyState ?? null}</>;
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
        Runtime de compatibilidad activo.
      </div>
      <div className="flex-1 space-y-2 overflow-auto rounded-lg border p-3">
        {initialMessages.map((message) => (
          <div key={message.id} className="rounded-md bg-muted/30 p-2 text-sm">
            <span className="font-medium">{message.role}: </span>
            <span>{message.content}</span>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        {placeholder}
      </div>
    </div>
  );
}

export default ChatRuntime;
