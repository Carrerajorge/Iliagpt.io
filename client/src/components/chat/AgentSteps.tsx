import React, { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, Check, Loader2, X, AlertCircle } from "lucide-react";

export interface AgentStepData {
  id: string;
  type: "thinking" | "reading" | "executing" | "editing" | "searching" | "generating" | "analyzing" | "completed";
  title: string;
  description?: string;
  fileName?: string;
  diff?: { added: number; removed: number };
  script?: string;
  output?: string;
  status: "pending" | "running" | "completed" | "failed";
  timestamp: string;
  duration?: number;
  expandable: boolean;
  artifact?: {
    id: string;
    name: string;
    type: string;
    mimeType: string;
    size?: number;
    downloadUrl: string;
  };
}

const STEP_ICONS: Record<AgentStepData["type"], string> = {
  thinking: "🧠",
  reading: "📄",
  executing: "▶️",
  editing: "📝",
  searching: "🔍",
  generating: "⏳",
  analyzing: "🔬",
  completed: "✅",
};

function StatusIndicator({ status }: { status: AgentStepData["status"] }) {
  if (status === "running") return <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0" />;
  if (status === "completed") return <Check className="h-3 w-3 text-green-500 shrink-0" />;
  if (status === "failed") return <X className="h-3 w-3 text-red-500 shrink-0" />;
  return <div className="h-3 w-3 rounded-full bg-zinc-300 dark:bg-zinc-600 shrink-0" />;
}

function StepItem({ step }: { step: AgentStepData }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = step.expandable && (!!step.script || !!step.output || !!step.description);

  return (
    <div className="flex gap-2 items-start group">
      {/* Timeline connector */}
      <div className="flex flex-col items-center pt-0.5">
        <StatusIndicator status={step.status} />
        <div className="w-px flex-1 bg-zinc-200 dark:bg-zinc-700 min-h-[8px]" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-2">
        <button
          onClick={() => canExpand && setExpanded(!expanded)}
          className={cn(
            "flex items-center gap-1.5 text-left w-full",
            canExpand && "cursor-pointer hover:opacity-80",
          )}
          disabled={!canExpand}
        >
          <span className="text-sm shrink-0">{STEP_ICONS[step.type]}</span>
          <span className="text-[13px] text-zinc-700 dark:text-zinc-300 truncate">
            {step.title}
          </span>

          {/* File badge */}
          {step.fileName && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-mono shrink-0">
              {step.fileName}
            </span>
          )}

          {/* Diff badge */}
          {step.diff && (
            <span className="text-[11px] font-mono shrink-0">
              <span className="text-green-600 dark:text-green-400">+{step.diff.added}</span>
              {" "}
              <span className="text-red-500 dark:text-red-400">-{step.diff.removed}</span>
            </span>
          )}

          {/* Script badge */}
          {step.type === "executing" && step.script && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium shrink-0">
              Script
            </span>
          )}

          {/* Duration */}
          {step.duration != null && step.status === "completed" && (
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 shrink-0 ml-auto">
              {step.duration < 1000 ? `${step.duration}ms` : `${(step.duration / 1000).toFixed(1)}s`}
            </span>
          )}

          {/* Expand chevron */}
          {canExpand && (
            <span className="shrink-0 ml-1">
              {expanded
                ? <ChevronDown className="h-3 w-3 text-zinc-400" />
                : <ChevronRight className="h-3 w-3 text-zinc-400" />}
            </span>
          )}
        </button>

        {/* Expanded content */}
        {expanded && (
          <div className="mt-1.5 ml-5 animate-in fade-in slide-in-from-top-1 duration-150">
            {step.script && (
              <pre className="text-[11px] font-mono bg-zinc-900 text-zinc-100 rounded-lg p-2.5 overflow-x-auto max-h-48 scrollbar-thin">
                {step.script}
              </pre>
            )}
            {step.output && (
              <pre className="text-[11px] font-mono bg-zinc-50 dark:bg-zinc-800/50 text-zinc-600 dark:text-zinc-300 rounded-lg p-2.5 mt-1.5 overflow-x-auto max-h-48 scrollbar-thin whitespace-pre-wrap">
                {step.output}
              </pre>
            )}
            {step.description && !step.script && !step.output && (
              <p className="text-[12px] text-zinc-500 dark:text-zinc-400">{step.description}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface AgentStepsProps {
  steps: AgentStepData[];
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  headerTitle?: string;
}

export function AgentSteps({ steps, collapsed, onToggleCollapse, headerTitle }: AgentStepsProps) {
  const isRunning = steps.some((s) => s.status === "running");
  const completedCount = steps.filter((s) => s.status === "completed").length;

  const defaultTitle = useMemo(() => {
    if (isRunning) {
      const current = steps.find((s) => s.status === "running");
      return current?.title || "Procesando...";
    }
    return headerTitle || `Completó ${completedCount} paso${completedCount !== 1 ? "s" : ""}`;
  }, [steps, isRunning, completedCount, headerTitle]);

  if (steps.length === 0) return null;

  return (
    <div className="rounded-xl border border-zinc-200/60 dark:border-zinc-700/40 bg-zinc-50/50 dark:bg-zinc-900/30 overflow-hidden" data-testid="agent-steps">
      {/* Collapsible header */}
      <button
        onClick={onToggleCollapse}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-zinc-100/50 dark:hover:bg-zinc-800/30 transition-colors"
        data-testid="agent-steps-header"
      >
        {isRunning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500 shrink-0" />
        ) : (
          <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
        )}
        <span className="text-[13px] font-medium text-zinc-600 dark:text-zinc-300 truncate flex-1">
          {defaultTitle}
        </span>
        <span className="text-[11px] text-zinc-400 shrink-0">
          {completedCount}/{steps.length}
        </span>
        {collapsed
          ? <ChevronRight className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
          : <ChevronDown className="h-3.5 w-3.5 text-zinc-400 shrink-0" />}
      </button>

      {/* Steps list */}
      {!collapsed && (
        <div className="px-3 pb-2 pt-0.5 animate-in fade-in slide-in-from-top-1 duration-200">
          {steps.map((step) => (
            <StepItem key={step.id} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}

export default AgentSteps;
