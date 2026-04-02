/**
 * ChatInterfaceV2
 * 
 * Nueva versión refactorizada del chat-interface que usa los módulos separados.
 * Este componente es compatible con la interfaz del ChatInterface original
 * pero usa la arquitectura modular nueva.
 * 
 * Uso:
 * - Reemplazar gradualmente importaciones de './chat-interface' por './chat-interface-v2'
 * - Una vez validado, renombrar este archivo y eliminar el legacy
 */

import React, { memo, useCallback, useEffect, useState } from "react";
import { ChatRuntime } from "./chat/ChatRuntime";
import { ChatErrorBoundary } from "./error-boundaries";
import { ScreenReaderAnnouncement, SkipLink } from "./accessibility";
import { useErrorDisplay } from "@/stores/errorStore";
import { validateMessage, checkRateLimit } from "@/lib/validation";
import type { Message, ActiveGpt } from "@/hooks/use-chats";

// Props compatibles con el ChatInterface original
interface ChatInterfaceV2Props {
  chatId: string;
  user: { 
    id: string; 
    plan?: string; 
    subscriptionStatus?: string;
    name?: string;
  } | null;
  initialMessages?: Message[];
  activeGpt?: ActiveGpt | null;
  onSendMessage?: (message: string, attachments?: string[]) => Promise<void>;
  onRetryMessage?: (messageId: string) => void;
  onNewChat?: () => void;
  className?: string;
  showSidebar?: boolean;
  
  // Streaming props (opcionales, pueden venir de stores)
  aiState?: "idle" | "sending" | "streaming" | "done" | "error" | "agent_working";
  streamingContent?: string;
  streamingMessageId?: string | null;
}

export const ChatInterfaceV2 = memo(function ChatInterfaceV2({
  chatId,
  user,
  initialMessages = [],
  activeGpt,
  onSendMessage,
  onRetryMessage,
  onNewChat,
  className,
  showSidebar = true,
  aiState: externalAiState,
  streamingContent: externalStreamingContent,
  streamingMessageId,
}: ChatInterfaceV2Props) {
  const { addError } = useErrorDisplay();
  const [announcement, setAnnouncement] = useState("");

  // Wrapper para onSendMessage con validación y rate limiting
  const handleSendMessage = useCallback(async (content: string, attachments?: string[]) => {
    // Validación
    const validation = validateMessage(content);
    if (!validation.valid) {
      addError(new Error(validation.error), {
        component: "ChatInterfaceV2",
        action: "sendMessage",
      });
      return;
    }

    // Rate limiting
    const rateLimitKey = `send-${user?.id || "anon"}-${chatId}`;
    const rateLimit = checkRateLimit(rateLimitKey, 20, 60000); // 20 mensajes por minuto
    
    if (!rateLimit.allowed) {
      addError(
        new Error(`Rate limit exceeded. Try again in ${Math.ceil((rateLimit.resetTime - Date.now()) / 1000)}s`),
        { component: "ChatInterfaceV2", action: "rateLimit" }
      );
      return;
    }

    // Anuncio para screen readers
    setAnnouncement("Enviando mensaje...");

    try {
      await onSendMessage?.(content, attachments);
      setAnnouncement("Mensaje enviado. Esperando respuesta...");
    } catch (error) {
      setAnnouncement("Error al enviar mensaje");
      throw error;
    }
  }, [chatId, user?.id, onSendMessage, addError]);

  // Wrapper para retry
  const handleRetryMessage = useCallback((messageId: string) => {
    setAnnouncement("Reintentando mensaje...");
    onRetryMessage?.(messageId);
  }, [onRetryMessage]);

  // Empty state personalizado
  const emptyState = (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="w-20 h-20 mb-6 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-600/20 flex items-center justify-center">
        <svg
          className="w-10 h-10 text-blue-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
      </div>
      <h2 className="text-2xl font-semibold mb-2">
        {activeGpt?.name || "¿En qué puedo ayudarte?"}
      </h2>
      <p className="text-muted-foreground max-w-md">
        {activeGpt?.description || 
          "Envía un mensaje para comenzar la conversación. Puedes adjuntar archivos o usar comandos especiales."}
      </p>
      {activeGpt?.conversationStarters && (
        <div className="mt-6 flex flex-wrap gap-2 justify-center">
          {activeGpt.conversationStarters.slice(0, 3).map((starter, i) => (
            <button
              key={i}
              onClick={() => handleSendMessage(starter)}
              className="px-4 py-2 text-sm bg-muted hover:bg-muted/80 rounded-full transition-colors"
            >
              {starter}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <ChatErrorBoundary>
      <div className={className}>
        {/* Skip link para accesibilidad */}
        <SkipLink targetId="chat-main-content" />
        
        {/* Anuncios para screen readers */}
        {announcement && (
          <ScreenReaderAnnouncement
            message={announcement}
            priority="polite"
            trigger={announcement}
          />
        )}
        
        {/* Contenido principal del chat */}
        <div id="chat-main-content" className="h-full flex flex-col">
          <ChatRuntime
            chatId={chatId}
            user={user}
            initialMessages={initialMessages}
            onSendMessage={handleSendMessage}
            onRetryMessage={handleRetryMessage}
            aiState={externalAiState}
            streamingContent={externalStreamingContent}
            streamingMessageId={streamingMessageId}
            emptyState={emptyState}
            placeholder={activeGpt?.placeholder || "Escribe tu mensaje..."}
          />
        </div>
      </div>
    </ChatErrorBoundary>
  );
});

export default ChatInterfaceV2;
