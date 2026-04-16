import { memo } from "react";
import { cn } from "@/lib/utils";
import { 
  Sparkles, 
  Search, 
  FileText, 
  Download,
  Copy,
  RefreshCw,
  ChevronRight,
  Zap,
  BookOpen,
  MessageSquare,
  Code,
  Table,
  Image
} from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";

interface QuickAction {
  id: string;
  label: string;
  icon: typeof Sparkles;
  variant?: "default" | "primary" | "secondary";
  onClick: () => void;
}

interface QuickActionsProps {
  actions: QuickAction[];
  className?: string;
  layout?: "horizontal" | "grid";
  size?: "sm" | "md";
}

export const QuickActions = memo(function QuickActions({
  actions,
  className,
  layout = "horizontal",
  size = "sm",
}: QuickActionsProps) {
  if (actions.length === 0) return null;

  return (
    <div 
      className={cn(
        "flex gap-2",
        layout === "grid" && "flex-wrap",
        layout === "horizontal" && "overflow-x-auto pb-1 scrollbar-hide",
        className
      )}
    >
      {actions.map((action, index) => (
        <motion.div
          key={action.id}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: index * 0.05 }}
        >
          <QuickActionButton action={action} size={size} />
        </motion.div>
      ))}
    </div>
  );
});

const QuickActionButton = memo(function QuickActionButton({
  action,
  size,
}: {
  action: QuickAction;
  size: "sm" | "md";
}) {
  const Icon = action.icon;
  
  const sizeClasses = {
    sm: "px-2.5 py-1.5 text-xs gap-1.5",
    md: "px-3 py-2 text-sm gap-2",
  };

  const iconSizes = {
    sm: "w-3 h-3",
    md: "w-4 h-4",
  };

  const variantClasses = {
    default: "bg-muted hover:bg-muted/80 text-foreground",
    primary: "bg-primary/10 hover:bg-primary/20 text-primary border-primary/20",
    secondary: "bg-secondary hover:bg-secondary/80 text-secondary-foreground",
  };

  return (
    <button
      onClick={action.onClick}
      className={cn(
        "inline-flex items-center rounded-full",
        "border border-border/50 hover:border-border",
        "transition-all duration-150",
        "hover:shadow-sm active:scale-95",
        "whitespace-nowrap",
        sizeClasses[size],
        variantClasses[action.variant || "default"]
      )}
    >
      <Icon className={iconSizes[size]} />
      <span>{action.label}</span>
    </button>
  );
});

interface SuggestedFollowUpsProps {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  className?: string;
}

export const SuggestedFollowUps = memo(function SuggestedFollowUps({
  suggestions,
  onSelect,
  className,
}: SuggestedFollowUpsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <MessageSquare className="w-3 h-3" />
        <span>Preguntas sugeridas</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion, index) => (
          <motion.button
            key={index}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            onClick={() => onSelect(suggestion)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg",
              "text-sm text-left",
              "bg-muted/50 hover:bg-muted",
              "border border-border/50 hover:border-primary/30",
              "transition-colors"
            )}
          >
            <ChevronRight className="w-3 h-3 text-primary flex-shrink-0" />
            <span className="line-clamp-1">{suggestion}</span>
          </motion.button>
        ))}
      </div>
    </div>
  );
});

interface ResponseActionsProps {
  onDeepen?: () => void;
  onSummarize?: () => void;
  onExport?: () => void;
  onCopy?: () => void;
  onRegenerate?: () => void;
  onSearchMore?: () => void;
  className?: string;
  showLabels?: boolean;
}

export const ResponseActions = memo(function ResponseActions({
  onDeepen,
  onSummarize,
  onExport,
  onCopy,
  onRegenerate,
  onSearchMore,
  className,
  showLabels = true,
}: ResponseActionsProps) {
  const actions: QuickAction[] = [];

  if (onDeepen) {
    actions.push({
      id: "deepen",
      label: showLabels ? "Profundizar" : "",
      icon: Zap,
      variant: "primary",
      onClick: onDeepen,
    });
  }

  if (onSummarize) {
    actions.push({
      id: "summarize",
      label: showLabels ? "Resumir" : "",
      icon: Sparkles,
      onClick: onSummarize,
    });
  }

  if (onSearchMore) {
    actions.push({
      id: "search",
      label: showLabels ? "Buscar más" : "",
      icon: Search,
      onClick: onSearchMore,
    });
  }

  if (onExport) {
    actions.push({
      id: "export",
      label: showLabels ? "Exportar" : "",
      icon: Download,
      onClick: onExport,
    });
  }

  if (onCopy) {
    actions.push({
      id: "copy",
      label: showLabels ? "Copiar" : "",
      icon: Copy,
      onClick: onCopy,
    });
  }

  if (onRegenerate) {
    actions.push({
      id: "regenerate",
      label: showLabels ? "Regenerar" : "",
      icon: RefreshCw,
      onClick: onRegenerate,
    });
  }

  return <QuickActions actions={actions} className={className} />;
});

export function generateFollowUpSuggestions(
  response: string,
  context?: string
): string[] {
  const suggestions: string[] = [];

  if (response.includes("artículo") || response.includes("estudio") || response.includes("paper")) {
    suggestions.push("¿Puedes profundizar en la metodología?");
    suggestions.push("¿Hay estudios más recientes sobre esto?");
  }

  if (response.includes("código") || response.includes("function") || response.includes("```")) {
    suggestions.push("¿Puedes explicar cómo funciona?");
    suggestions.push("¿Cómo puedo mejorarlo?");
  }

  if (response.includes("pasos") || response.includes("proceso") || response.includes("steps")) {
    suggestions.push("¿Puedes dar más detalles del paso 1?");
    suggestions.push("¿Hay alternativas a este proceso?");
  }

  if (response.length > 500) {
    suggestions.push("¿Puedes resumir los puntos clave?");
  }

  if (suggestions.length === 0) {
    suggestions.push("Cuéntame más sobre esto");
    suggestions.push("¿Puedes dar un ejemplo?");
  }

  return suggestions.slice(0, 3);
}

export default QuickActions;
