import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Monitor, 
  X, 
  Minimize2, 
  Maximize2, 
  RefreshCw,
  Globe,
  MousePointer2,
  Keyboard,
  ArrowUp,
  ArrowDown,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BrowserSessionState, BrowserAction } from "@/hooks/use-browser-session";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { formatZonedTime, normalizeTimeZone } from "@/lib/platformDateTime";

interface VirtualComputerProps {
  state: BrowserSessionState;
  onClose?: () => void;
  onCancel?: () => void;
  className?: string;
  compact?: boolean;
}

export function VirtualComputer({ state, onClose, onCancel, className, compact = false }: VirtualComputerProps) {
  const [isMinimized, setIsMinimized] = useState(false);
  const [isTimelineExpanded, setIsTimelineExpanded] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);

  const getStatusColor = () => {
    switch (state.status) {
      case "idle": return "text-gray-400";
      case "connecting": return "text-yellow-500";
      case "active": return "text-green-500";
      case "completed": return "text-blue-500";
      case "error": return "text-red-500";
      case "cancelled": return "text-gray-500";
      default: return "text-gray-400";
    }
  };

  const getStatusIcon = () => {
    switch (state.status) {
      case "idle": return <Monitor className="h-3 w-3" />;
      case "connecting": return <Loader2 className="h-3 w-3 animate-spin" />;
      case "active": return <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />;
      case "completed": return <CheckCircle2 className="h-3 w-3" />;
      case "error": return <XCircle className="h-3 w-3" />;
      default: return null;
    }
  };

  const getStatusText = () => {
    switch (state.status) {
      case "idle": return "En espera";
      case "connecting": return "Conectando";
      case "active": return "Activo";
      case "completed": return "Completado";
      case "error": return "Error";
      case "cancelled": return "Cancelado";
      default: return state.status;
    }
  };

  const getActionIcon = (type: string) => {
    switch (type) {
      case "navigate": return <Globe className="h-3 w-3" />;
      case "click": return <MousePointer2 className="h-3 w-3" />;
      case "type": return <Keyboard className="h-3 w-3" />;
      case "scroll": return <ArrowDown className="h-3 w-3" />;
      default: return <Monitor className="h-3 w-3" />;
    }
  };

  const formatTime = (date: Date) => {
    return formatZonedTime(date, { timeZone: platformTimeZone, includeSeconds: true });
  };

  const getActionDescription = (action: BrowserAction) => {
    switch (action.type) {
      case "navigate":
        return `Navegando a ${action.params.url?.slice(0, 40)}...`;
      case "click":
        return `Clic en ${action.params.selector?.slice(0, 30)}`;
      case "type":
        return `Escribiendo "${action.params.text?.slice(0, 20)}..."`;
      case "scroll":
        return `Scroll ${action.params.direction === "down" ? "abajo" : "arriba"}`;
      default:
        return action.type;
    }
  };

  if (compact && !isExpanded) {
    if (state.status === "idle" && !state.sessionId) {
      return null;
    }
    
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className={cn(
          "w-[2cm] h-[2cm] border border-border/50 rounded-lg overflow-hidden bg-background/95 backdrop-blur-sm shadow-lg cursor-pointer flex flex-col",
          className
        )}
        onClick={() => setIsExpanded(true)}
        data-testid="virtual-computer-compact"
      >
        <div className="flex items-center justify-center gap-1 px-1 py-0.5 bg-muted/50 border-b border-border/50">
          <Monitor className="h-2 w-2 text-primary" />
          <div className={cn("flex items-center", getStatusColor())}>
            {getStatusIcon()}
          </div>
        </div>
        <div className="flex-1 bg-black/90 flex items-center justify-center relative">
          {state.screenshot ? (
            <img
              src={state.screenshot}
              alt="Preview"
              className="w-full h-full object-cover"
            />
          ) : (
            <Monitor className="h-3 w-3 text-muted-foreground" />
          )}
          {state.status === "active" && (
            <div className="absolute bottom-0.5 right-0.5">
              <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  if (compact && isExpanded) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          className="fixed inset-4 z-50 border border-border/50 rounded-xl overflow-hidden bg-background/95 backdrop-blur-sm shadow-2xl flex flex-col"
          data-testid="virtual-computer-expanded"
        >
          <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border/50">
            <div className="flex items-center gap-2">
              <Monitor className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Computadora Virtual</span>
              <div className={cn("flex items-center gap-1", getStatusColor())}>
                {getStatusIcon()}
                <span className="text-xs">{getStatusText()}</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {state.status === "active" && onCancel && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={onCancel}
                  data-testid="button-cancel-session"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setIsExpanded(false)}
                data-testid="button-minimize-expanded"
              >
                <Minimize2 className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {state.currentUrl && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30 border-b border-border/30">
              <Globe className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground truncate flex-1" data-testid="text-current-url">
                {state.currentUrl}
              </span>
            </div>
          )}

          <div className="flex-1 relative bg-black/90 flex items-center justify-center">
            {state.screenshot ? (
              <img
                src={state.screenshot}
                alt="Browser Screenshot"
                className="w-full h-full object-contain"
                data-testid="img-screenshot"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                {state.status === "connecting" || state.status === "active" ? (
                  <>
                    <Loader2 className="h-8 w-8 animate-spin" />
                    <span className="text-sm">Cargando vista previa...</span>
                  </>
                ) : (
                  <>
                    <Monitor className="h-8 w-8" />
                    <span className="text-sm">Sin vista previa disponible</span>
                  </>
                )}
              </div>
            )}
            {state.status === "active" && (
              <div className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1 bg-black/70 rounded-full">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs text-white">En vivo</span>
              </div>
            )}
          </div>

          {state.objective && (
            <div className="px-3 py-2 border-t border-border/30 bg-muted/20">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Objetivo:</span> {state.objective}
              </p>
            </div>
          )}

          {state.error && (
            <div className="px-3 py-2 bg-red-500/10 border-t border-red-500/20">
              <p className="text-xs text-red-500" data-testid="text-error">
                Error: {state.error}
              </p>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className={cn(
          "border border-border/50 rounded-xl overflow-hidden bg-background/95 backdrop-blur-sm shadow-lg",
          className
        )}
        data-testid="virtual-computer"
      >
        <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border/50">
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Computadora Virtual</span>
            <div className={cn("flex items-center gap-1", getStatusColor())}>
              {getStatusIcon()}
              <span className="text-xs">{getStatusText()}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {state.status === "active" && onCancel && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={onCancel}
                data-testid="button-cancel-session"
              >
                <X className="h-3 w-3" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsMinimized(!isMinimized)}
              data-testid="button-toggle-minimize"
            >
              {isMinimized ? <Maximize2 className="h-3 w-3" /> : <Minimize2 className="h-3 w-3" />}
            </Button>
          </div>
        </div>

        {!isMinimized && (
          <>
            {state.currentUrl && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30 border-b border-border/30">
                <Globe className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground truncate flex-1" data-testid="text-current-url">
                  {state.currentUrl}
                </span>
              </div>
            )}

            <div className="relative aspect-video bg-black/90 flex items-center justify-center min-h-[200px] max-h-[400px]">
              {state.screenshot ? (
                <img
                  src={state.screenshot}
                  alt="Browser Screenshot"
                  className="w-full h-full object-contain"
                  data-testid="img-screenshot"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  {state.status === "connecting" || state.status === "active" ? (
                    <>
                      <Loader2 className="h-8 w-8 animate-spin" />
                      <span className="text-sm">Cargando vista previa...</span>
                    </>
                  ) : (
                    <>
                      <Monitor className="h-8 w-8" />
                      <span className="text-sm">Sin vista previa disponible</span>
                    </>
                  )}
                </div>
              )}

              {state.status === "active" && (
                <div className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1 bg-black/70 rounded-full">
                  <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-xs text-white">En vivo</span>
                </div>
              )}
            </div>

            {state.objective && (
              <div className="px-3 py-2 border-t border-border/30 bg-muted/20">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Objetivo:</span> {state.objective}
                </p>
              </div>
            )}

            {state.actions.length > 0 && (
              <div className="border-t border-border/30">
                <button
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/30 transition-colors"
                  onClick={() => setIsTimelineExpanded(!isTimelineExpanded)}
                  data-testid="button-toggle-timeline"
                >
                  <span className="text-xs font-medium">
                    Actividad ({state.actions.length} acciones)
                  </span>
                  {isTimelineExpanded ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                </button>
                
                <AnimatePresence>
                  {isTimelineExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="max-h-[150px] overflow-y-auto px-3 pb-2">
                        {state.actions.slice(-10).reverse().map((action, index) => (
                          <div
                            key={index}
                            className="flex items-start gap-2 py-1.5 border-b border-border/20 last:border-0"
                            data-testid={`action-item-${index}`}
                          >
                            <div className="flex items-center justify-center h-5 w-5 rounded-full bg-primary/10 text-primary flex-shrink-0">
                              {getActionIcon(action.type)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs truncate">{getActionDescription(action)}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {formatTime(action.timestamp)}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {state.error && (
              <div className="px-3 py-2 bg-red-500/10 border-t border-red-500/20">
                <p className="text-xs text-red-500" data-testid="text-error">
                  Error: {state.error}
                </p>
              </div>
            )}
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
