import { useState } from "react";
import { Brain, Globe, Sparkles, ChevronRight, ChevronLeft, Clock, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkspace, AiProcessStep } from "@/contexts/workspace-context";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { formatZonedTime, normalizeTimeZone } from "@/lib/platformDateTime";

const categoryConfig = {
  planning: {
    icon: Brain,
    label: "Planificando",
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
  },
  browsing: {
    icon: Globe,
    label: "Navegando",
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
  },
  generation: {
    icon: Sparkles,
    label: "Generando",
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
  },
};

const statusConfig: Record<"pending" | "active" | "done", {
  icon: typeof Clock;
  label: string;
  color: string;
  animate?: boolean;
}> = {
  pending: {
    icon: Clock,
    label: "Pendiente",
    color: "text-muted-foreground",
  },
  active: {
    icon: Loader2,
    label: "En progreso",
    color: "text-primary",
    animate: true,
  },
  done: {
    icon: Check,
    label: "Completado",
    color: "text-green-500",
  },
};

interface AiStepItemProps {
  step: AiProcessStep;
}

function AiStepItem({ step }: AiStepItemProps) {
  const category = categoryConfig[step.category];
  const status = statusConfig[step.status];
  const CategoryIcon = category.icon;
  const StatusIcon = status.icon;
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-3 rounded-lg transition-colors",
        step.status === "active" && "bg-accent/50",
        step.status === "done" && "opacity-70"
      )}
      data-testid={`ai-step-${step.id}`}
    >
      <div className={cn("p-2 rounded-lg", category.bgColor)}>
        <CategoryIcon className={cn("h-4 w-4", category.color)} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{step.step}</span>
          <StatusIcon
            className={cn(
              "h-3.5 w-3.5 flex-shrink-0",
              status.color,
              status.animate && "animate-spin"
            )}
          />
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className={cn("text-xs", category.color)}>{category.label}</span>
          <span className="text-xs text-muted-foreground">
            {formatZonedTime(step.timestamp, { timeZone: platformTimeZone, includeSeconds: true })}
          </span>
        </div>
      </div>
    </div>
  );
}

interface AiStepsRailProps {
  isCollapsed?: boolean;
  onToggle?: () => void;
}

export function AiStepsRail({ isCollapsed = false, onToggle }: AiStepsRailProps) {
  const { aiProcessSteps, clearAiSteps } = useWorkspace();

  const activeSteps = aiProcessSteps.filter((s) => s.status === "active");
  const pendingSteps = aiProcessSteps.filter((s) => s.status === "pending");
  const doneSteps = aiProcessSteps.filter((s) => s.status === "done");

  if (isCollapsed) {
    return (
      <div className="h-full flex flex-col items-center py-4 border-l bg-background/50">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggle}
              className="mb-4"
              data-testid="button-expand-ai-rail"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Expandir panel de IA</TooltipContent>
        </Tooltip>

        {activeSteps.length > 0 && (
          <div className="flex flex-col items-center gap-2">
            <div className="relative">
              <Sparkles className="h-5 w-5 text-primary animate-pulse" />
              <span className="absolute -top-1 -right-1 h-3 w-3 bg-primary rounded-full flex items-center justify-center text-[8px] text-primary-foreground font-bold">
                {activeSteps.length}
              </span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col border-l bg-background/50" data-testid="ai-steps-rail">
      <div className="flex items-center justify-between p-4 border-b">
        <h3 className="font-semibold text-sm">Actividad de IA</h3>
        <div className="flex items-center gap-1">
          {aiProcessSteps.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAiSteps}
              className="h-7 text-xs"
              data-testid="button-clear-ai-steps"
            >
              Limpiar
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className="h-7 w-7"
            data-testid="button-collapse-ai-rail"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {aiProcessSteps.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Brain className="h-8 w-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">
                Sin actividad de IA
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Los pasos aparecerán aquí cuando la IA esté procesando
              </p>
            </div>
          ) : (
            <>
              {activeSteps.length > 0 && (
                <div className="space-y-1">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
                    En progreso ({activeSteps.length})
                  </h4>
                  {activeSteps.map((step) => (
                    <AiStepItem key={step.id} step={step} />
                  ))}
                </div>
              )}

              {pendingSteps.length > 0 && (
                <div className="space-y-1 mt-4">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
                    Pendientes ({pendingSteps.length})
                  </h4>
                  {pendingSteps.map((step) => (
                    <AiStepItem key={step.id} step={step} />
                  ))}
                </div>
              )}

              {doneSteps.length > 0 && (
                <div className="space-y-1 mt-4">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
                    Completados ({doneSteps.length})
                  </h4>
                  {doneSteps.map((step) => (
                    <AiStepItem key={step.id} step={step} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
