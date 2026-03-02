import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  ChevronDown,
  ChevronRight,
  Brain,
  Target,
  Shield,
  Gavel,
  Zap,
  FileText,
  ExternalLink,
  BarChart3,
  Coins,
  Timer,
  Wrench,
  AlertTriangle,
  RotateCcw,
  CircleDot,
  GitBranch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type SubtaskStatus = "pending" | "running" | "done" | "failed" | "retrying";
export type CriticVerdict = "accept" | "retry" | "backtrack";
export type JudgeVerdict = "pass" | "fail" | "partial";

export interface EvidenceCitation {
  id: string;
  source: string;
  chunkIndex?: number;
  relevanceScore: number;
  snippet: string;
  url?: string;
}

export interface SubtaskNode {
  id: string;
  title: string;
  description?: string;
  status: SubtaskStatus;
  priority?: number;
  dependencies?: string[];
  toolCalls?: Array<{
    toolName: string;
    status: "running" | "done" | "failed";
    durationMs?: number;
  }>;
  criticResult?: {
    verdict: CriticVerdict;
    reason: string;
    scores?: { grounding: number; completeness: number; coherence: number };
  };
  startedAt?: number;
  completedAt?: number;
  retryCount?: number;
}

export interface JudgeResult {
  verdict: JudgeVerdict;
  confidence: number;
  reason: string;
  subtaskResults?: Array<{ subtaskId: string; satisfied: boolean }>;
}

export interface BudgetInfo {
  tokensUsed: number;
  tokenLimit: number;
  estimatedCost: number;
  costCeiling?: number;
  budgetRemainingPercent: number;
  duration?: number;
  toolsUsedCount?: number;
}

export interface AgentRunTimelineProps {
  subtasks: SubtaskNode[];
  judgeResult?: JudgeResult | null;
  evidence?: EvidenceCitation[];
  budget?: BudgetInfo | null;
  isActive?: boolean;
  planTitle?: string;
}

function StatusIcon({ status }: { status: SubtaskStatus }) {
  switch (status) {
    case "pending":
      return <CircleDot className="h-3.5 w-3.5 text-zinc-400" />;
    case "running":
      return <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />;
    case "done":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-rose-500" />;
    case "retrying":
      return <RotateCcw className="h-3.5 w-3.5 text-amber-500 animate-spin" />;
  }
}

function statusLabel(status: SubtaskStatus): string {
  const map: Record<SubtaskStatus, string> = {
    pending: "Pending",
    running: "Running",
    done: "Done",
    failed: "Failed",
    retrying: "Retrying",
  };
  return map[status];
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function CriticBadge({ result }: { result: SubtaskNode["criticResult"] }) {
  if (!result) return null;
  const colorMap: Record<CriticVerdict, string> = {
    accept: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20",
    retry: "text-amber-600 bg-amber-500/10 border-amber-500/20",
    backtrack: "text-rose-600 bg-rose-500/10 border-rose-500/20",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border",
        colorMap[result.verdict]
      )}
      title={result.reason}
      data-testid={`badge-critic-${result.verdict}`}
    >
      <Shield className="h-2.5 w-2.5" />
      Critic: {result.verdict}
    </span>
  );
}

function SubtaskRow({ node, isLast }: { node: SubtaskNode; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const duration =
    node.startedAt && node.completedAt
      ? node.completedAt - node.startedAt
      : null;

  return (
    <div className="relative" data-testid={`subtask-row-${node.id}`}>
      <div className="flex items-start gap-2">
        <div className="flex flex-col items-center mt-0.5">
          <StatusIcon status={node.status} />
          {!isLast && (
            <div className="w-px flex-1 min-h-[20px] bg-border/60 mt-1" />
          )}
        </div>

        <div className="flex-1 min-w-0 pb-3">
          <button
            className="flex items-center gap-1.5 w-full text-left group"
            onClick={() => setExpanded(!expanded)}
            data-testid={`button-expand-subtask-${node.id}`}
          >
            <span className="text-xs font-medium text-foreground truncate">
              {node.title}
            </span>
            {node.retryCount != null && node.retryCount > 0 && (
              <span className="text-[10px] text-amber-500 font-medium">
                (retry {node.retryCount})
              </span>
            )}
            {duration != null && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 ml-auto shrink-0">
                <Clock className="h-2.5 w-2.5" />
                {formatDuration(duration)}
              </span>
            )}
            <ChevronRight
              className={cn(
                "h-3 w-3 text-muted-foreground transition-transform shrink-0",
                expanded && "rotate-90"
              )}
            />
          </button>

          <div className="flex flex-wrap gap-1.5 mt-1">
            {node.criticResult && <CriticBadge result={node.criticResult} />}
            <span
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded-full border font-medium",
                node.status === "done" && "text-emerald-600 bg-emerald-500/10 border-emerald-500/20",
                node.status === "running" && "text-blue-600 bg-blue-500/10 border-blue-500/20",
                node.status === "failed" && "text-rose-600 bg-rose-500/10 border-rose-500/20",
                node.status === "pending" && "text-zinc-500 bg-zinc-500/10 border-zinc-500/20",
                node.status === "retrying" && "text-amber-600 bg-amber-500/10 border-amber-500/20"
              )}
            >
              {statusLabel(node.status)}
            </span>
          </div>

          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden"
              >
                <div className="mt-2 space-y-2">
                  {node.description && (
                    <p className="text-[11px] text-muted-foreground">
                      {node.description}
                    </p>
                  )}

                  {node.toolCalls && node.toolCalls.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                        <Wrench className="h-2.5 w-2.5" />
                        Tool Calls
                      </div>
                      {node.toolCalls.map((tc, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 text-[11px] pl-2"
                          data-testid={`tool-call-${node.id}-${i}`}
                        >
                          {tc.status === "running" ? (
                            <Loader2 className="h-2.5 w-2.5 animate-spin text-blue-500" />
                          ) : tc.status === "done" ? (
                            <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />
                          ) : (
                            <XCircle className="h-2.5 w-2.5 text-rose-500" />
                          )}
                          <span className="font-mono text-foreground">
                            {tc.toolName}
                          </span>
                          {tc.durationMs != null && (
                            <span className="text-muted-foreground">
                              {formatDuration(tc.durationMs)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {node.criticResult && (
                    <div className="rounded-md border bg-muted/30 p-2 space-y-1">
                      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                        <Shield className="h-2.5 w-2.5" />
                        Critic Evaluation
                      </div>
                      <p className="text-[11px] text-foreground">
                        {node.criticResult.reason}
                      </p>
                      {node.criticResult.scores && (
                        <div className="flex gap-3 text-[10px] text-muted-foreground">
                          <span>
                            Grounding:{" "}
                            <strong className="text-foreground">
                              {(node.criticResult.scores.grounding * 100).toFixed(0)}%
                            </strong>
                          </span>
                          <span>
                            Completeness:{" "}
                            <strong className="text-foreground">
                              {(node.criticResult.scores.completeness * 100).toFixed(0)}%
                            </strong>
                          </span>
                          <span>
                            Coherence:{" "}
                            <strong className="text-foreground">
                              {(node.criticResult.scores.coherence * 100).toFixed(0)}%
                            </strong>
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function JudgePanel({ result }: { result: JudgeResult }) {
  const verdictConfig: Record<JudgeVerdict, { color: string; icon: React.ReactNode; label: string }> = {
    pass: {
      color: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
      label: "Passed",
    },
    fail: {
      color: "text-rose-600 bg-rose-500/10 border-rose-500/30",
      icon: <XCircle className="h-4 w-4 text-rose-500" />,
      label: "Failed",
    },
    partial: {
      color: "text-amber-600 bg-amber-500/10 border-amber-500/30",
      icon: <AlertTriangle className="h-4 w-4 text-amber-500" />,
      label: "Partial",
    },
  };
  const cfg = verdictConfig[result.verdict];

  return (
    <div
      className={cn("rounded-lg border p-3 space-y-2", cfg.color)}
      data-testid="panel-judge-verdict"
    >
      <div className="flex items-center gap-2">
        <Gavel className="h-3.5 w-3.5" />
        <span className="text-xs font-semibold uppercase tracking-wider">
          Judge Verdict
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {cfg.icon}
          <span className="text-xs font-bold">{cfg.label}</span>
          <span className="text-[10px] opacity-70">
            ({(result.confidence * 100).toFixed(0)}% confidence)
          </span>
        </div>
      </div>
      <p className="text-[11px] leading-relaxed">{result.reason}</p>
    </div>
  );
}

function EvidencePanel({ citations }: { citations: EvidenceCitation[] }) {
  const [isOpen, setIsOpen] = useState(false);

  if (citations.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 overflow-hidden" data-testid="panel-evidence">
      <button
        className="flex items-center gap-2 w-full p-2.5 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
        data-testid="button-toggle-evidence"
      >
        <FileText className="h-3.5 w-3.5 text-blue-500" />
        <span className="text-xs font-semibold text-foreground">
          Evidence & Citations
        </span>
        <span className="text-[10px] text-muted-foreground ml-1">
          ({citations.length} sources)
        </span>
        <ChevronDown
          className={cn(
            "h-3 w-3 text-muted-foreground ml-auto transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/50 p-2.5 space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
              {citations.map((citation) => (
                <div
                  key={citation.id}
                  className="rounded-md border border-border/40 bg-background/60 p-2 space-y-1 hover:border-blue-500/30 transition-colors"
                  data-testid={`citation-${citation.id}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-foreground truncate flex-1">
                      {citation.source}
                    </span>
                    <span
                      className={cn(
                        "text-[10px] font-mono px-1.5 py-0.5 rounded-full",
                        citation.relevanceScore >= 0.8
                          ? "bg-emerald-500/10 text-emerald-600"
                          : citation.relevanceScore >= 0.5
                          ? "bg-amber-500/10 text-amber-600"
                          : "bg-zinc-500/10 text-zinc-500"
                      )}
                      data-testid={`score-citation-${citation.id}`}
                    >
                      {(citation.relevanceScore * 100).toFixed(0)}%
                    </span>
                    {citation.url && (
                      <a
                        href={citation.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:text-blue-600"
                        data-testid={`link-citation-${citation.id}`}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed">
                    {citation.snippet}
                  </p>
                  {citation.chunkIndex != null && (
                    <span className="text-[9px] text-muted-foreground/60">
                      Chunk #{citation.chunkIndex}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BudgetBar({ budget }: { budget: BudgetInfo }) {
  const usagePercent = Math.min(
    100,
    Math.round((budget.tokensUsed / budget.tokenLimit) * 100)
  );
  const isWarning = usagePercent >= 80;
  const isCritical = usagePercent >= 95;

  return (
    <div
      className="rounded-lg border border-border/50 bg-muted/20 p-2.5 space-y-1.5"
      data-testid="bar-budget"
    >
      <div className="flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1" data-testid="stat-tokens">
          <Zap className="h-2.5 w-2.5" />
          <strong className="text-foreground">{formatTokens(budget.tokensUsed)}</strong>
          /{formatTokens(budget.tokenLimit)} tokens
        </span>
        <span className="flex items-center gap-1" data-testid="stat-cost">
          <Coins className="h-2.5 w-2.5" />
          $<strong className="text-foreground">{budget.estimatedCost.toFixed(4)}</strong>
          {budget.costCeiling != null && ` / $${budget.costCeiling.toFixed(2)}`}
        </span>
        {budget.duration != null && (
          <span className="flex items-center gap-1" data-testid="stat-duration">
            <Timer className="h-2.5 w-2.5" />
            <strong className="text-foreground">{formatDuration(budget.duration)}</strong>
          </span>
        )}
        {budget.toolsUsedCount != null && (
          <span className="flex items-center gap-1" data-testid="stat-tools">
            <Wrench className="h-2.5 w-2.5" />
            <strong className="text-foreground">{budget.toolsUsedCount}</strong> tools
          </span>
        )}
      </div>

      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <motion.div
          className={cn(
            "h-full rounded-full transition-colors",
            isCritical
              ? "bg-rose-500"
              : isWarning
              ? "bg-amber-500"
              : "bg-emerald-500"
          )}
          initial={{ width: 0 }}
          animate={{ width: `${usagePercent}%` }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

export function AgentRunTimeline({
  subtasks,
  judgeResult,
  evidence = [],
  budget,
  isActive = false,
  planTitle,
}: AgentRunTimelineProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const stats = useMemo(() => {
    const total = subtasks.length;
    const done = subtasks.filter((s) => s.status === "done").length;
    const failed = subtasks.filter((s) => s.status === "failed").length;
    const running = subtasks.filter(
      (s) => s.status === "running" || s.status === "retrying"
    ).length;
    return { total, done, failed, running };
  }, [subtasks]);

  if (subtasks.length === 0 && !judgeResult && !budget) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm overflow-hidden shadow-sm"
      data-testid="panel-agent-timeline"
    >
      <button
        className="flex items-center gap-2 w-full p-3 text-left hover:bg-muted/20 transition-colors"
        onClick={() => setIsCollapsed(!isCollapsed)}
        data-testid="button-toggle-timeline"
      >
        <GitBranch className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground flex-1">
          {planTitle || "Execution Timeline"}
        </span>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {stats.done > 0 && (
            <span className="flex items-center gap-0.5 text-emerald-600">
              <CheckCircle2 className="h-2.5 w-2.5" />
              {stats.done}
            </span>
          )}
          {stats.running > 0 && (
            <span className="flex items-center gap-0.5 text-blue-500">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              {stats.running}
            </span>
          )}
          {stats.failed > 0 && (
            <span className="flex items-center gap-0.5 text-rose-500">
              <XCircle className="h-2.5 w-2.5" />
              {stats.failed}
            </span>
          )}
          <span>
            {stats.done}/{stats.total}
          </span>
        </div>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform",
            isCollapsed && "-rotate-90"
          )}
        />
      </button>

      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/50 p-3 space-y-3">
              {subtasks.length > 0 && (
                <div className="space-y-0" data-testid="list-subtasks">
                  {subtasks.map((node, idx) => (
                    <SubtaskRow
                      key={node.id}
                      node={node}
                      isLast={idx === subtasks.length - 1}
                    />
                  ))}
                </div>
              )}

              {judgeResult && <JudgePanel result={judgeResult} />}

              <EvidencePanel citations={evidence} />

              {budget && <BudgetBar budget={budget} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function useAgentTimelineSSE() {
  const [subtasks, setSubtasks] = useState<SubtaskNode[]>([]);
  const [judgeResult, setJudgeResult] = useState<JudgeResult | null>(null);
  const [evidence, setEvidence] = useState<EvidenceCitation[]>([]);
  const [budget, setBudget] = useState<BudgetInfo | null>(null);
  const [planTitle, setPlanTitle] = useState<string>("");
  const [isActive, setIsActive] = useState(false);

  const handleSSEEvent = useCallback(
    (eventType: string, payload: any) => {
      switch (eventType) {
        case "plan_update": {
          if (payload.title) setPlanTitle(payload.title);
          if (payload.subtasks) {
            setSubtasks(
              payload.subtasks.map((st: any) => ({
                id: st.id,
                title: st.title,
                description: st.description,
                status: st.status || "pending",
                priority: st.priority,
                dependencies: st.dependencies,
                toolCalls: st.toolCalls || [],
                retryCount: st.retryCount || 0,
              }))
            );
          }
          setIsActive(true);
          break;
        }
        case "subtask_start": {
          setSubtasks((prev) =>
            prev.map((s) =>
              s.id === payload.subtaskId
                ? { ...s, status: "running" as SubtaskStatus, startedAt: Date.now() }
                : s
            )
          );
          break;
        }
        case "subtask_complete": {
          setSubtasks((prev) =>
            prev.map((s) =>
              s.id === payload.subtaskId
                ? {
                    ...s,
                    status: (payload.success ? "done" : "failed") as SubtaskStatus,
                    completedAt: Date.now(),
                    toolCalls: payload.toolCalls || s.toolCalls,
                  }
                : s
            )
          );
          break;
        }
        case "critic_result": {
          setSubtasks((prev) =>
            prev.map((s) =>
              s.id === payload.subtaskId
                ? {
                    ...s,
                    criticResult: {
                      verdict: payload.verdict,
                      reason: payload.reason,
                      scores: payload.scores,
                    },
                    status:
                      payload.verdict === "retry"
                        ? ("retrying" as SubtaskStatus)
                        : payload.verdict === "backtrack"
                        ? ("failed" as SubtaskStatus)
                        : s.status,
                    retryCount:
                      payload.verdict === "retry"
                        ? (s.retryCount || 0) + 1
                        : s.retryCount,
                  }
                : s
            )
          );
          break;
        }
        case "judge_verdict": {
          setJudgeResult({
            verdict: payload.verdict,
            confidence: payload.confidence,
            reason: payload.reason,
            subtaskResults: payload.subtaskResults,
          });
          setIsActive(false);
          break;
        }
        case "budget_update": {
          setBudget({
            tokensUsed: payload.tokensUsed || 0,
            tokenLimit: payload.tokenLimit || 100000,
            estimatedCost: payload.estimatedCost || 0,
            costCeiling: payload.costCeiling,
            budgetRemainingPercent: payload.budgetRemainingPercent ?? 100,
            duration: payload.duration,
            toolsUsedCount: payload.toolsUsedCount,
          });
          break;
        }
        case "evidence_update": {
          if (Array.isArray(payload.citations)) {
            setEvidence(
              payload.citations.map((c: any) => ({
                id: c.id || String(Math.random()),
                source: c.source,
                chunkIndex: c.chunkIndex,
                relevanceScore: c.relevanceScore ?? 0,
                snippet: c.snippet || "",
                url: c.url,
              }))
            );
          }
          break;
        }
      }
    },
    []
  );

  const reset = useCallback(() => {
    setSubtasks([]);
    setJudgeResult(null);
    setEvidence([]);
    setBudget(null);
    setPlanTitle("");
    setIsActive(false);
  }, []);

  return {
    subtasks,
    judgeResult,
    evidence,
    budget,
    planTitle,
    isActive,
    handleSSEEvent,
    reset,
  };
}
