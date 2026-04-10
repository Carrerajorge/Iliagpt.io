import { useEffect } from "react";
import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { useOfficeEngineStore, type OfficeEngineStep } from "@/stores/officeEngineStore";

interface OfficeStepsPanelProps {
  runId: string;
}

/**
 * Live timeline of an Office Engine run.
 *
 * Subscribes (idempotently) to the SSE stream for the given runId and renders
 * each pipeline step with its title, status, duration, and any diff metadata.
 * Click a step to expand its log/output preview.
 */
export function OfficeStepsPanel({ runId }: OfficeStepsPanelProps) {
  const subscribe = useOfficeEngineStore((s) => s.subscribe);
  const run = useOfficeEngineStore((s) => s.runs.get(runId));

  useEffect(() => {
    const unsub = subscribe(runId);
    return () => unsub();
  }, [runId, subscribe]);

  if (!run) {
    return (
      <div className="p-4 text-sm text-muted-foreground">Esperando eventos del run {runId}…</div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4" data-testid={`office-steps-panel-${runId}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium">Office Engine — Run {runId.slice(0, 8)}</h3>
        <RunStatusBadge status={run.status} />
      </div>
      <ol className="space-y-2">
        {run.steps.map((step) => (
          <StepRow key={step.id} step={step} />
        ))}
      </ol>
      {run.error && (
        <div className="mt-2 text-xs text-destructive">Error: {run.error}</div>
      )}
    </div>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  const cls =
    status === "succeeded"
      ? "text-green-600"
      : status === "cancelled"
        ? "text-amber-600"
      : status === "failed"
        ? "text-destructive"
        : "text-amber-600";
  return <span className={`text-xs font-medium ${cls}`}>{status}</span>;
}

function StepRow({ step }: { step: OfficeEngineStep }) {
  return (
    <li className="flex items-start gap-2 text-sm border border-border rounded-md p-2">
      <div className="mt-0.5 shrink-0">
        {step.status === "completed" && <CheckCircle2 className="h-4 w-4 text-green-500" />}
        {step.status === "running" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
        {step.status === "failed" && <XCircle className="h-4 w-4 text-destructive" />}
        {step.status === "pending" && <Circle className="h-4 w-4 text-muted-foreground" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{step.title}</span>
          {step.duration !== undefined && (
            <span className="text-xs text-muted-foreground">{step.duration}ms</span>
          )}
          {step.diff && (
            <span className="text-xs text-muted-foreground">+{step.diff.added}/-{step.diff.removed}</span>
          )}
        </div>
        {step.output && (
          <div className="text-xs text-muted-foreground mt-1 font-mono whitespace-pre-wrap break-all">{step.output}</div>
        )}
      </div>
    </li>
  );
}
