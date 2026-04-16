import { memo, useCallback } from "react";
import { Check, Loader2, Circle, X, Clock, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlanStepStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";
export type PlanStatus = "draft" | "approved" | "executing" | "completed" | "failed" | "rejected";

export interface PlanStepData {
  id: string;
  title: string;
  description: string;
  status: PlanStepStatus;
  durationMs?: number;
}

export interface PlanMessageProps {
  plan: {
    id: string;
    title: string;
    status: PlanStatus;
    steps: PlanStepData[];
    estimatedDurationSec?: number;
  };
  onApprove?: (planId: string) => void;
  onReject?: (planId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function StepStatusIcon({ status }: { status: PlanStepStatus }) {
  switch (status) {
    case "pending":
      return <Circle className="h-3.5 w-3.5 text-zinc-400" />;
    case "in_progress":
      return <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />;
    case "completed":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case "failed":
      return <X className="h-3.5 w-3.5 text-rose-500" />;
    case "skipped":
      return <Circle className="h-3.5 w-3.5 text-zinc-300" />;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PlanMessage = memo(function PlanMessage({
  plan,
  onApprove,
  onReject,
}: PlanMessageProps) {
  const handleApprove = useCallback(() => {
    onApprove?.(plan.id);
  }, [onApprove, plan.id]);

  const handleReject = useCallback(() => {
    onReject?.(plan.id);
  }, [onReject, plan.id]);

  const completedCount = plan.steps.filter((s) => s.status === "completed").length;
  const totalSteps = plan.steps.length;

  const totalDurationMs = plan.steps.reduce(
    (sum, s) => sum + (s.durationMs ?? 0),
    0,
  );

  return (
    <div
      className={cn(
        "rounded-lg border bg-card text-card-foreground shadow-sm",
        "w-full max-w-lg",
      )}
      data-testid={`plan-message-${plan.id}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold flex-1 truncate">{plan.title}</h3>
        <PlanStatusBadge status={plan.status} />
      </div>

      {/* Steps */}
      <div className="px-4 py-3 space-y-1">
        {plan.steps.map((step, idx) => (
          <div
            key={step.id}
            className="relative flex items-start gap-2"
            data-testid={`plan-step-${step.id}`}
          >
            {/* Timeline connector */}
            <div className="flex flex-col items-center mt-0.5">
              <StepStatusIcon status={step.status} />
              {idx < totalSteps - 1 && (
                <div className="w-px flex-1 min-h-[16px] bg-border/60 mt-1" />
              )}
            </div>

            <div className="flex-1 min-w-0 pb-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-foreground truncate">
                  {step.title}
                </span>
                {step.durationMs != null && step.status === "completed" && (
                  <span className="text-[10px] text-muted-foreground">
                    {formatDuration(step.durationMs)}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">
                {step.description}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Progress bar (executing) */}
      {plan.status === "executing" && totalSteps > 0 && (
        <div className="px-4 pb-3">
          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${Math.round((completedCount / totalSteps) * 100)}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            {completedCount}/{totalSteps} steps completed
          </p>
        </div>
      )}

      {/* Completed summary */}
      {plan.status === "completed" && totalDurationMs > 0 && (
        <div className="px-4 pb-3 flex items-center gap-1.5">
          <Check className="h-3.5 w-3.5 text-emerald-500" />
          <span className="text-[11px] text-muted-foreground">
            Completed in {formatDuration(totalDurationMs)}
          </span>
        </div>
      )}

      {/* Estimated duration (draft) */}
      {plan.status === "draft" && plan.estimatedDurationSec != null && (
        <div className="px-4 pb-1">
          <p className="text-[10px] text-muted-foreground">
            Estimated time: ~{plan.estimatedDurationSec}s
          </p>
        </div>
      )}

      {/* Action buttons (draft) */}
      {plan.status === "draft" && (
        <div className="flex items-center gap-2 px-4 py-3 border-t">
          <Button
            size="sm"
            variant="default"
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
            onClick={handleApprove}
            data-testid="plan-approve-btn"
          >
            <Check className="h-3.5 w-3.5 mr-1" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-rose-600 hover:text-rose-700 border-rose-200 hover:border-rose-300 text-xs"
            onClick={handleReject}
            data-testid="plan-reject-btn"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Reject
          </Button>
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function PlanStatusBadge({ status }: { status: PlanStatus }) {
  const config: Record<PlanStatus, { label: string; className: string }> = {
    draft: { label: "Draft", className: "text-amber-600 bg-amber-500/10 border-amber-500/20" },
    approved: { label: "Approved", className: "text-blue-600 bg-blue-500/10 border-blue-500/20" },
    executing: { label: "Executing", className: "text-blue-600 bg-blue-500/10 border-blue-500/20" },
    completed: { label: "Completed", className: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20" },
    failed: { label: "Failed", className: "text-rose-600 bg-rose-500/10 border-rose-500/20" },
    rejected: { label: "Rejected", className: "text-zinc-600 bg-zinc-500/10 border-zinc-500/20" },
  };

  const c = config[status];

  return (
    <span
      className={cn(
        "inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full border",
        c.className,
      )}
    >
      {c.label}
    </span>
  );
}
