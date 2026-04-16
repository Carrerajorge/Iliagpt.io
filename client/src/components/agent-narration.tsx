import { memo, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { formatZonedTime, normalizeTimeZone } from "@/lib/platformDateTime";
import { 
  Bot, 
  Search, 
  FileText, 
  Code, 
  Globe, 
  Database,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  Loader2
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface NarrationMessage {
  id: string;
  text: string;
  type: "action" | "discovery" | "progress" | "complete";
  icon?: "search" | "file" | "code" | "globe" | "database" | "sparkles" | "bot";
  timestamp: number;
}

interface AgentNarrationProps {
  messages: NarrationMessage[];
  className?: string;
  maxVisible?: number;
  showTimestamps?: boolean;
}

const iconMap = {
  search: Search,
  file: FileText,
  code: Code,
  globe: Globe,
  database: Database,
  sparkles: Sparkles,
  bot: Bot,
};

export const AgentNarration = memo(function AgentNarration({
  messages,
  className,
  maxVisible = 5,
  showTimestamps = false,
}: AgentNarrationProps) {
  const visibleMessages = messages.slice(-maxVisible);

  return (
    <div className={cn("space-y-2", className)}>
      <AnimatePresence mode="popLayout">
        {visibleMessages.map((message, index) => (
          <motion.div
            key={message.id}
            initial={{ opacity: 0, y: 10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -10, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <NarrationItem 
              message={message} 
              isLatest={index === visibleMessages.length - 1}
              showTimestamp={showTimestamps}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
});

const NarrationItem = memo(function NarrationItem({
  message,
  isLatest,
  showTimestamp,
}: {
  message: NarrationMessage;
  isLatest: boolean;
  showTimestamp: boolean;
}) {
  const Icon = message.icon ? iconMap[message.icon] : Bot;
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);
  
  const typeStyles = {
    action: "border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20",
    discovery: "border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/20",
    progress: "border-primary/20 bg-primary/5",
    complete: "border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/20",
  };

  const iconStyles = {
    action: "text-blue-500",
    discovery: "text-amber-500",
    progress: "text-primary",
    complete: "text-green-500",
  };

  return (
    <div
      className={cn(
        "flex items-start gap-2 p-2.5 rounded-lg border transition-all",
        typeStyles[message.type],
        isLatest && "ring-1 ring-primary/20"
      )}
    >
      <div className={cn("mt-0.5", iconStyles[message.type])}>
        {message.type === "complete" ? (
          <CheckCircle2 className="w-4 h-4" />
        ) : isLatest ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Icon className="w-4 h-4" />
        )}
      </div>
      
      <div className="flex-1 min-w-0">
        <p className={cn(
          "text-sm leading-relaxed",
          isLatest ? "text-foreground" : "text-muted-foreground"
        )}>
          {message.text}
        </p>
        
        {showTimestamp && (
          <span className="text-[10px] text-muted-foreground/60 mt-1 block">
            {formatZonedTime(message.timestamp, { timeZone: platformTimeZone, includeSeconds: true })}
          </span>
        )}
      </div>
    </div>
  );
});

interface LiveNarrationProps {
  text: string;
  className?: string;
  icon?: keyof typeof iconMap;
}

export const LiveNarration = memo(function LiveNarration({
  text,
  className,
  icon = "bot",
}: LiveNarrationProps) {
  const Icon = iconMap[icon];
  const [dots, setDots] = useState("");

  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? "" : prev + ".");
    }, 400);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex items-center gap-2 py-2 px-3 rounded-full",
        "bg-gradient-to-r from-primary/10 to-primary/5",
        "border border-primary/20",
        "w-fit",
        className
      )}
    >
      <Icon className="w-4 h-4 text-primary animate-pulse" />
      <span className="text-sm text-foreground/80">
        {text}
        <span className="inline-block w-6 text-left">{dots}</span>
      </span>
    </motion.div>
  );
});

interface QuickActionButtonsProps {
  actions: Array<{
    label: string;
    onClick: () => void;
    icon?: keyof typeof iconMap;
  }>;
  className?: string;
}

export const QuickActionButtons = memo(function QuickActionButtons({
  actions,
  className,
}: QuickActionButtonsProps) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {actions.map((action, index) => {
        const Icon = action.icon ? iconMap[action.icon] : ArrowRight;
        return (
          <motion.button
            key={index}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={action.onClick}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full",
              "text-sm font-medium",
              "bg-muted hover:bg-muted/80",
              "border border-border hover:border-primary/30",
              "transition-colors"
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {action.label}
          </motion.button>
        );
      })}
    </div>
  );
});

export default AgentNarration;
