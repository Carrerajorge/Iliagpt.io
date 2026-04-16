import { memo, useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { 
  Monitor, 
  Globe, 
  FileText, 
  Code, 
  Search,
  Database,
  Terminal,
  Pause,
  Play,
  RotateCcw,
  Maximize2,
  Minimize2,
  X,
  ChevronRight,
  Loader2,
  CheckCircle2,
  Clock,
  Sparkles
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";

export interface AgentAction {
  id: string;
  type: "browse" | "read" | "write" | "search" | "analyze" | "execute" | "think";
  description: string;
  detail?: string;
  status: "pending" | "running" | "completed" | "error";
  startTime?: number;
  endTime?: number;
  result?: string;
}

interface AgentComputerViewProps {
  isActive: boolean;
  actions: AgentAction[];
  currentUrl?: string;
  currentContent?: string;
  progress: number;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onIntervene?: (instruction: string) => void;
  isPaused?: boolean;
  className?: string;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

const actionIcons = {
  browse: Globe,
  read: FileText,
  write: Code,
  search: Search,
  analyze: Database,
  execute: Terminal,
  think: Sparkles,
};

export const AgentComputerView = memo(function AgentComputerView({
  isActive,
  actions,
  currentUrl,
  currentContent,
  progress,
  onPause,
  onResume,
  onCancel,
  onIntervene,
  isPaused = false,
  className,
  expanded = false,
  onToggleExpand,
}: AgentComputerViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [intervention, setIntervention] = useState("");

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [actions]);

  const currentAction = actions.find(a => a.status === "running");
  const completedCount = actions.filter(a => a.status === "completed").length;

  return (
    <div
      className={cn(
        "rounded-xl border bg-card overflow-hidden",
        "transition-all duration-300",
        expanded ? "fixed inset-4 z-50" : "relative",
        className
      )}
    >
      <div className="flex items-center justify-between p-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Computadora del Agente</span>
          {isActive && (
            <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Activo
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {isActive && (
            <>
              {isPaused ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={onResume}
                >
                  <Play className="w-3.5 h-3.5" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={onPause}
                >
                  <Pause className="w-3.5 h-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-red-500 hover:text-red-600"
                onClick={onCancel}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onToggleExpand}
          >
            {expanded ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>
      </div>

      {isActive && (
        <div className="px-3 py-2 border-b">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>{completedCount} de {actions.length} acciones</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-1" />
        </div>
      )}

      <div className="flex flex-col h-[300px]" style={{ height: expanded ? "calc(100vh - 200px)" : "300px" }}>
        <ScrollArea className="flex-1 p-3" ref={scrollRef}>
          <div className="space-y-2">
            <AnimatePresence mode="popLayout">
              {actions.map((action, index) => (
                <motion.div
                  key={action.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <ActionItem action={action} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </ScrollArea>

        {currentUrl && (
          <div className="px-3 py-2 border-t bg-muted/20">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Globe className="w-3 h-3" />
              <span className="truncate">{currentUrl}</span>
            </div>
          </div>
        )}

        {isActive && onIntervene && (
          <div className="p-3 border-t">
            <div className="flex gap-2">
              <input
                type="text"
                value={intervention}
                onChange={(e) => setIntervention(e.target.value)}
                placeholder="Instrucción adicional..."
                className={cn(
                  "flex-1 px-3 py-1.5 text-sm rounded-lg",
                  "bg-muted border border-border",
                  "focus:outline-none focus:ring-1 focus:ring-primary"
                )}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && intervention.trim()) {
                    onIntervene(intervention);
                    setIntervention("");
                  }
                }}
              />
              <Button
                size="sm"
                disabled={!intervention.trim()}
                onClick={() => {
                  if (intervention.trim()) {
                    onIntervene(intervention);
                    setIntervention("");
                  }
                }}
              >
                Enviar
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

const ActionItem = memo(function ActionItem({ action }: { action: AgentAction }) {
  const Icon = actionIcons[action.type] || Sparkles;
  
  const duration = action.startTime && action.endTime
    ? action.endTime - action.startTime
    : null;

  return (
    <div
      className={cn(
        "flex items-start gap-2 p-2 rounded-lg",
        action.status === "running" && "bg-primary/5 border border-primary/20",
        action.status === "completed" && "opacity-70",
        action.status === "error" && "bg-red-50 dark:bg-red-900/10"
      )}
    >
      <div className="mt-0.5">
        {action.status === "running" ? (
          <Loader2 className="w-4 h-4 text-primary animate-spin" />
        ) : action.status === "completed" ? (
          <CheckCircle2 className="w-4 h-4 text-green-500" />
        ) : action.status === "error" ? (
          <X className="w-4 h-4 text-red-500" />
        ) : (
          <Clock className="w-4 h-4 text-muted-foreground/40" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
          <span className={cn(
            "text-sm",
            action.status === "running" && "font-medium"
          )}>
            {action.description}
          </span>
        </div>
        
        {action.detail && action.status === "running" && (
          <p className="text-xs text-muted-foreground mt-1 ml-5 truncate">
            {action.detail}
          </p>
        )}

        {action.result && action.status === "completed" && (
          <p className="text-xs text-muted-foreground mt-1 ml-5 line-clamp-2">
            {action.result}
          </p>
        )}

        {duration && (
          <span className="text-[10px] text-muted-foreground/60 ml-5">
            {duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`}
          </span>
        )}
      </div>
    </div>
  );
});

export default AgentComputerView;
