import React from "react";
import { Loader2, Check, AlertCircle, RefreshCw, X, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MessageStatus, ClientMessage } from "@shared/messageLifecycle";

interface MessageStatusIndicatorProps {
  status: MessageStatus;
  errorMessage?: string;
  retryCount?: number;
  onRetry?: () => void;
  onCancel?: () => void;
  compact?: boolean;
}

const statusConfig: Record<MessageStatus, {
  icon: React.ElementType;
  label: string;
  color: string;
  bgColor: string;
  animate?: boolean;
}> = {
  draft: {
    icon: Clock,
    label: "Borrador",
    color: "text-muted-foreground",
    bgColor: "bg-muted",
  },
  sending: {
    icon: Loader2,
    label: "Enviando...",
    color: "text-blue-600",
    bgColor: "bg-blue-50 dark:bg-blue-950",
    animate: true,
  },
  accepted: {
    icon: Check,
    label: "Enviado",
    color: "text-green-600",
    bgColor: "bg-green-50 dark:bg-green-950",
  },
  waiting_first_token: {
    icon: Loader2,
    label: "Esperando respuesta...",
    color: "text-amber-600",
    bgColor: "bg-amber-50 dark:bg-amber-950",
    animate: true,
  },
  streaming: {
    icon: Loader2,
    label: "Recibiendo respuesta...",
    color: "text-blue-600",
    bgColor: "bg-blue-50 dark:bg-blue-950",
    animate: true,
  },
  completed: {
    icon: Check,
    label: "Completado",
    color: "text-green-600",
    bgColor: "bg-green-50 dark:bg-green-950",
  },
  failed_retryable: {
    icon: AlertCircle,
    label: "Error al enviar",
    color: "text-red-600",
    bgColor: "bg-red-50 dark:bg-red-950",
  },
  failed_terminal: {
    icon: AlertCircle,
    label: "Error",
    color: "text-red-600",
    bgColor: "bg-red-50 dark:bg-red-950",
  },
  cancelled: {
    icon: X,
    label: "Cancelado",
    color: "text-gray-500",
    bgColor: "bg-gray-50 dark:bg-gray-900",
  },
};

export function MessageStatusIndicator({
  status,
  errorMessage,
  retryCount = 0,
  onRetry,
  onCancel,
  compact = false,
}: MessageStatusIndicatorProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  if (compact) {
    return (
      <span className={cn("inline-flex items-center gap-1", config.color)}>
        <Icon
          className={cn("h-3 w-3", config.animate && "animate-spin")}
        />
        <span className="text-xs">{config.label}</span>
      </span>
    );
  }

  return (
    <div className={cn("flex items-center gap-2 px-3 py-2 rounded-md", config.bgColor)}>
      <Icon
        className={cn("h-4 w-4", config.color, config.animate && "animate-spin")}
      />
      
      <span className={cn("text-sm font-medium", config.color)}>
        {config.label}
        {retryCount > 0 && status === "failed_retryable" && (
          <span className="ml-1 text-xs opacity-70">
            (intento {retryCount + 1})
          </span>
        )}
      </span>

      {status === "sending" && onCancel && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="h-6 px-2 ml-auto"
        >
          <X className="h-3 w-3" />
        </Button>
      )}

      {status === "failed_retryable" && onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="h-6 px-2 ml-auto"
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Reintentar
        </Button>
      )}

      {errorMessage && (status === "failed_retryable" || status === "failed_terminal") && (
        <span className="text-xs text-red-500 ml-2 truncate max-w-[200px]">
          {errorMessage}
        </span>
      )}
    </div>
  );
}

interface PendingMessageBannerProps {
  message: ClientMessage;
  onRetry?: () => void;
  onCancel?: () => void;
}

export function PendingMessageBanner({ message, onRetry, onCancel }: PendingMessageBannerProps) {
  if (!message) return null;

  const showBanner = message.status !== "completed" && message.status !== "accepted";

  if (!showBanner) return null;

  return (
    <div className="border-b p-3 bg-muted/50">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-muted-foreground truncate">
            {message.text}
          </p>
          <MessageStatusIndicator
            status={message.status}
            errorMessage={message.errorMessage}
            retryCount={message.retryCount}
            onRetry={onRetry}
            onCancel={onCancel}
            compact
          />
        </div>
      </div>
    </div>
  );
}

export function MessageSendingOverlay({ message }: { message: ClientMessage | null }) {
  if (!message || message.status === "completed") return null;

  return (
    <div className="absolute inset-x-0 bottom-full mb-2 px-4">
      <div className="bg-background border rounded-lg shadow-lg p-3 max-w-md mx-auto">
        <MessageStatusIndicator
          status={message.status}
          errorMessage={message.errorMessage}
          retryCount={message.retryCount}
        />
      </div>
    </div>
  );
}
