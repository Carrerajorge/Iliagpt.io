import { memo, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { 
  CheckCircle2, 
  Circle, 
  Loader2, 
  ChevronDown, 
  ChevronUp,
  Search,
  FileText,
  Code,
  Globe,
  Database,
  Sparkles,
  Brain,
  AlertCircle,
  Clock
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export type TaskStatus = "pending" | "running" | "completed" | "error";

export interface TaskStep {
  id: string;
  label: string;
  status: TaskStatus;
  detail?: string;
  duration?: number;
  icon?: "search" | "file" | "code" | "globe" | "database" | "sparkles" | "brain";
}

interface TaskProgressPanelProps {
  steps: TaskStep[];
  title?: string;
  className?: string;
  showProgress?: boolean;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  currentNarration?: string;
}

const iconMap = {
  search: Search,
  file: FileText,
  code: Code,
  globe: Globe,
  database: Database,
  sparkles: Sparkles,
  brain: Brain,
};

export const TaskProgressPanel = memo(function TaskProgressPanel({
  steps,
  title = "Progreso de la tarea",
  className,
  showProgress = true,
  collapsible = true,
  defaultExpanded = true,
  currentNarration,
}: TaskProgressPanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  
  const completedSteps = steps.filter(s => s.status === "completed").length;
  const progress = steps.length > 0 ? (completedSteps / steps.length) * 100 : 0;
  const currentStep = steps.find(s => s.status === "running");
  const hasError = steps.some(s => s.status === "error");

  const content = (
    <div className="space-y-3">
      {showProgress && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{completedSteps} de {steps.length} pasos</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <Progress 
            value={progress} 
            className={cn(
              "h-1.5",
              hasError && "bg-red-100 dark:bg-red-900/20"
            )}
          />
        </div>
      )}

      {currentNarration && (
        <div className="flex items-start gap-2 p-2 rounded-lg bg-primary/5 border border-primary/10">
          <Sparkles className="w-4 h-4 text-primary mt-0.5 animate-pulse" />
          <p className="text-sm text-foreground/80 leading-relaxed">
            {currentNarration}
          </p>
        </div>
      )}

      <div className="space-y-1">
        {steps.map((step, index) => (
          <TaskStepItem key={step.id} step={step} index={index} />
        ))}
      </div>
    </div>
  );

  if (!collapsible) {
    return (
      <div className={cn("rounded-xl border bg-card p-4", className)}>
        <h4 className="font-medium text-sm mb-3">{title}</h4>
        {content}
      </div>
    );
  }

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className={cn("rounded-xl border bg-card overflow-hidden", className)}>
        <CollapsibleTrigger className="w-full p-3 flex items-center justify-between hover:bg-muted/50 transition-colors">
          <div className="flex items-center gap-2">
            {currentStep ? (
              <Loader2 className="w-4 h-4 text-primary animate-spin" />
            ) : hasError ? (
              <AlertCircle className="w-4 h-4 text-red-500" />
            ) : progress === 100 ? (
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            ) : (
              <Clock className="w-4 h-4 text-muted-foreground" />
            )}
            <span className="font-medium text-sm">{title}</span>
            <span className="text-xs text-muted-foreground">
              ({completedSteps}/{steps.length})
            </span>
          </div>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 pb-4">
            {content}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
});

const TaskStepItem = memo(function TaskStepItem({
  step,
  index,
}: {
  step: TaskStep;
  index: number;
}) {
  const Icon = step.icon ? iconMap[step.icon] : null;

  return (
    <div
      className={cn(
        "flex items-start gap-2 p-2 rounded-lg transition-colors",
        step.status === "running" && "bg-primary/5",
        step.status === "error" && "bg-red-50 dark:bg-red-900/10"
      )}
    >
      <div className="mt-0.5">
        {step.status === "completed" ? (
          <CheckCircle2 className="w-4 h-4 text-green-500" />
        ) : step.status === "running" ? (
          <Loader2 className="w-4 h-4 text-primary animate-spin" />
        ) : step.status === "error" ? (
          <AlertCircle className="w-4 h-4 text-red-500" />
        ) : (
          <Circle className="w-4 h-4 text-muted-foreground/40" />
        )}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {Icon && (
            <Icon className={cn(
              "w-3.5 h-3.5",
              step.status === "running" ? "text-primary" : "text-muted-foreground"
            )} />
          )}
          <span className={cn(
            "text-sm",
            step.status === "completed" && "text-muted-foreground",
            step.status === "running" && "text-foreground font-medium",
            step.status === "pending" && "text-muted-foreground/60",
            step.status === "error" && "text-red-600 dark:text-red-400"
          )}>
            {step.label}
          </span>
        </div>
        
        {step.detail && step.status === "running" && (
          <p className="text-xs text-muted-foreground mt-0.5 ml-5">
            {step.detail}
          </p>
        )}
        
        {step.duration && step.status === "completed" && (
          <span className="text-xs text-muted-foreground ml-5">
            {step.duration < 1000 
              ? `${step.duration}ms` 
              : `${(step.duration / 1000).toFixed(1)}s`}
          </span>
        )}
      </div>
    </div>
  );
});

export default TaskProgressPanel;
