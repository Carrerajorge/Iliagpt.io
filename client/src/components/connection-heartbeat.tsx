import { memo, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Wifi, WifiOff, Activity } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

interface ConnectionHeartbeatProps {
  isConnected: boolean;
  lastPing?: number;
  className?: string;
  showLabel?: boolean;
  variant?: "dot" | "icon" | "full";
}

export const ConnectionHeartbeat = memo(function ConnectionHeartbeat({
  isConnected,
  lastPing,
  className,
  showLabel = false,
  variant = "dot",
}: ConnectionHeartbeatProps) {
  const [isPulsing, setIsPulsing] = useState(false);

  useEffect(() => {
    if (lastPing) {
      setIsPulsing(true);
      const timeout = setTimeout(() => setIsPulsing(false), 500);
      return () => clearTimeout(timeout);
    }
  }, [lastPing]);

  if (variant === "dot") {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn("relative inline-flex", className)}>
              <span
                className={cn(
                  "w-2 h-2 rounded-full transition-colors",
                  isConnected ? "bg-green-500" : "bg-red-500"
                )}
              />
              {isConnected && isPulsing && (
                <span className="absolute inset-0 w-2 h-2 rounded-full bg-green-500 animate-ping" />
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {isConnected ? "Conexión activa" : "Sin conexión"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (variant === "icon") {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn("relative inline-flex items-center", className)}>
              {isConnected ? (
                <Activity 
                  className={cn(
                    "w-4 h-4 text-green-500 transition-transform",
                    isPulsing && "scale-110"
                  )} 
                />
              ) : (
                <WifiOff className="w-4 h-4 text-red-500" />
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {isConnected ? "Streaming activo" : "Reconectando..."}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative">
        <span
          className={cn(
            "w-2.5 h-2.5 rounded-full block transition-colors",
            isConnected ? "bg-green-500" : "bg-red-500"
          )}
        />
        {isConnected && isPulsing && (
          <span className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-green-500 animate-ping opacity-75" />
        )}
      </div>
      {showLabel && (
        <span className={cn(
          "text-xs font-medium",
          isConnected ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
        )}>
          {isConnected ? "Conectado" : "Desconectado"}
        </span>
      )}
    </div>
  );
});

interface StreamingStatusProps {
  status: "idle" | "connecting" | "streaming" | "error" | "complete";
  className?: string;
}

export const StreamingStatus = memo(function StreamingStatus({
  status,
  className,
}: StreamingStatusProps) {
  const config = {
    idle: { color: "text-muted-foreground", bg: "bg-muted", label: "Listo" },
    connecting: { color: "text-blue-500", bg: "bg-blue-500", label: "Conectando" },
    streaming: { color: "text-green-500", bg: "bg-green-500", label: "Recibiendo" },
    error: { color: "text-red-500", bg: "bg-red-500", label: "Error" },
    complete: { color: "text-emerald-500", bg: "bg-emerald-500", label: "Completo" },
  };

  const { color, bg, label } = config[status];

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <span className={cn(
        "w-1.5 h-1.5 rounded-full",
        bg,
        status === "streaming" && "animate-pulse",
        status === "connecting" && "animate-bounce"
      )} />
      <span className={cn("text-xs", color)}>{label}</span>
    </div>
  );
});

export default ConnectionHeartbeat;
