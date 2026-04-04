import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentStatusType =
  | "thinking"
  | "executing"
  | "waiting"
  | "done"
  | "error"
  | "idle";

export interface AgentStatus {
  id: string;
  name: string;
  status: AgentStatusType;
  /** Progress 0–100, undefined = indeterminate */
  progress?: number;
  currentTask?: string;
  tokensUsed?: number;
  /** Maximum tokens budget */
  tokenBudget?: number;
  /** Timestamp agent was started */
  startedAt?: Date;
  /** Any sub-tasks or steps */
  steps?: Array<{ label: string; done: boolean }>;
}

export interface AgentStatusPanelProps {
  agents: AgentStatus[];
  /** Panel title */
  title?: string;
  /** Whether the panel starts collapsed */
  defaultCollapsed?: boolean;
  /** Called when user requests to cancel an agent */
  onCancelAgent?: (agentId: string) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

interface AgentStatusConfig {
  label: string;
  badgeClass: string;
  iconBg: string;
  dotColor: string;
}

const AGENT_STATUS_CONFIG: Record<AgentStatusType, AgentStatusConfig> = {
  thinking: {
    label: "Thinking",
    badgeClass: "bg-purple-950/60 text-purple-300 border-purple-800/50",
    iconBg: "bg-purple-500",
    dotColor: "bg-purple-400",
  },
  executing: {
    label: "Executing",
    badgeClass: "bg-blue-950/60 text-blue-300 border-blue-800/50",
    iconBg: "bg-blue-500",
    dotColor: "bg-blue-400",
  },
  waiting: {
    label: "Waiting",
    badgeClass: "bg-amber-950/60 text-amber-300 border-amber-800/50",
    iconBg: "bg-amber-500",
    dotColor: "bg-amber-400",
  },
  done: {
    label: "Done",
    badgeClass: "bg-green-950/60 text-green-300 border-green-800/50",
    iconBg: "bg-green-500",
    dotColor: "bg-green-400",
  },
  error: {
    label: "Error",
    badgeClass: "bg-red-950/60 text-red-300 border-red-800/50",
    iconBg: "bg-red-500",
    dotColor: "bg-red-400",
  },
  idle: {
    label: "Idle",
    badgeClass: "bg-gray-800 text-gray-400 border-gray-700",
    iconBg: "bg-gray-600",
    dotColor: "bg-gray-500",
  },
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatElapsed(startedAt: Date): string {
  const ms = Date.now() - startedAt.getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

// ---------------------------------------------------------------------------
// Thinking indicator
// ---------------------------------------------------------------------------

function ThinkingDots({ color }: { color: string }) {
  return (
    <span className="flex items-center gap-0.5" aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className={`inline-block w-1 h-1 rounded-full ${color}`}
          animate={{ scale: [1, 1.6, 1], opacity: [0.4, 1, 0.4] }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            delay: i * 0.2,
            ease: "easeInOut",
          }}
        />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

interface ProgressBarProps {
  value?: number; // 0-100; undefined = indeterminate
  colorClass: string;
}

function ProgressBar({ value, colorClass }: ProgressBarProps) {
  if (value === undefined) {
    // Indeterminate — animated sweep
    return (
      <div className="h-1 rounded-full bg-gray-800 overflow-hidden">
        <motion.div
          className={`h-full ${colorClass} rounded-full`}
          animate={{ x: ["-100%", "200%"] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          style={{ width: "40%" }}
        />
      </div>
    );
  }

  return (
    <div className="h-1 rounded-full bg-gray-800 overflow-hidden">
      <motion.div
        className={`h-full ${colorClass} rounded-full`}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single agent row
// ---------------------------------------------------------------------------

interface AgentRowProps {
  agent: AgentStatus;
  onCancel?: (id: string) => void;
}

function AgentRow({ agent, onCancel }: AgentRowProps) {
  const [stepsOpen, setStepsOpen] = useState(false);
  const config = AGENT_STATUS_CONFIG[agent.status];
  const isActive = ["thinking", "executing", "waiting"].includes(agent.status);

  const progressColorMap: Record<AgentStatusType, string> = {
    thinking: "bg-purple-500",
    executing: "bg-blue-500",
    waiting: "bg-amber-500",
    done: "bg-green-500",
    error: "bg-red-500",
    idle: "bg-gray-600",
  };

  const tokenPct =
    agent.tokensUsed !== undefined && agent.tokenBudget
      ? (agent.tokensUsed / agent.tokenBudget) * 100
      : undefined;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="rounded-xl border border-gray-800/60 bg-gray-900/60 overflow-hidden"
    >
      {/* Main row */}
      <div className="flex items-start gap-3 p-4">
        {/* Avatar / indicator */}
        <div className="relative flex-shrink-0 mt-0.5">
          <div
            className={`w-8 h-8 rounded-lg ${config.iconBg} flex items-center justify-center text-white font-bold text-sm`}
          >
            {agent.name.charAt(0).toUpperCase()}
          </div>
          {isActive && (
            <motion.span
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-gray-900 ${config.dotColor}`}
              animate={{ scale: [1, 1.3, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Name + badge row */}
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="font-medium text-gray-100 text-sm truncate max-w-[160px]">
              {agent.name}
            </span>

            <span
              className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border font-medium ${config.badgeClass}`}
            >
              {agent.status === "thinking" && (
                <ThinkingDots color={config.dotColor} />
              )}
              {agent.status === "executing" && (
                <motion.span
                  className={`inline-block w-1.5 h-1.5 rounded-full ${config.dotColor}`}
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                />
              )}
              {config.label}
            </span>

            {agent.startedAt && isActive && (
              <span className="text-xs text-gray-600 tabular-nums">
                {formatElapsed(agent.startedAt)}
              </span>
            )}
          </div>

          {/* Current task */}
          {agent.currentTask && (
            <p className="text-xs text-gray-400 truncate mb-2 leading-relaxed">
              {agent.currentTask}
            </p>
          )}

          {/* Progress bar */}
          <div className="mb-2">
            <ProgressBar
              value={agent.status === "done" ? 100 : agent.progress}
              colorClass={progressColorMap[agent.status]}
            />
          </div>

          {/* Footer stats */}
          <div className="flex items-center gap-3 text-xs text-gray-600">
            {agent.tokensUsed !== undefined && (
              <span className="tabular-nums">
                <span className="text-gray-500">{formatTokens(agent.tokensUsed)}</span>
                {agent.tokenBudget && (
                  <span> / {formatTokens(agent.tokenBudget)} tokens</span>
                )}
              </span>
            )}

            {tokenPct !== undefined && tokenPct > 80 && (
              <span className={`text-xs font-medium ${tokenPct > 95 ? "text-red-400" : "text-amber-400"}`}>
                {tokenPct > 95 ? "⚠ Near limit" : "High usage"}
              </span>
            )}

            {agent.steps && agent.steps.length > 0 && (
              <button
                onClick={() => setStepsOpen((v) => !v)}
                className="text-gray-500 hover:text-gray-300 transition-colors underline underline-offset-2"
              >
                {agent.steps.filter((s) => s.done).length}/{agent.steps.length} steps
              </button>
            )}
          </div>
        </div>

        {/* Cancel button */}
        {isActive && onCancel && (
          <button
            onClick={() => onCancel(agent.id)}
            aria-label={`Cancel agent ${agent.name}`}
            className="flex-shrink-0 w-7 h-7 rounded-lg bg-gray-800 hover:bg-red-900/60 border border-gray-700 hover:border-red-700/60 flex items-center justify-center text-gray-500 hover:text-red-400 transition-all duration-150"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Token usage mini-bar */}
      {tokenPct !== undefined && (
        <div className="h-0.5 bg-gray-800">
          <div
            className={`h-full transition-all duration-500 ${
              tokenPct > 95
                ? "bg-red-500"
                : tokenPct > 80
                ? "bg-amber-500"
                : "bg-purple-600"
            }`}
            style={{ width: `${tokenPct}%` }}
          />
        </div>
      )}

      {/* Steps list */}
      <AnimatePresence>
        {stepsOpen && agent.steps && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-gray-800/60"
          >
            <ul className="px-4 py-3 space-y-1.5">
              {agent.steps.map((step, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <span
                    className={`flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${
                      step.done
                        ? "bg-green-900/60 text-green-400"
                        : "bg-gray-800 text-gray-600"
                    }`}
                  >
                    {step.done ? (
                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <span className="w-1 h-1 rounded-full bg-current" />
                    )}
                  </span>
                  <span className={step.done ? "text-gray-400 line-through" : "text-gray-300"}>
                    {step.label}
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Panel header summary
// ---------------------------------------------------------------------------

function PanelSummary({ agents }: { agents: AgentStatus[] }) {
  const active = agents.filter((a) =>
    ["thinking", "executing", "waiting"].includes(a.status)
  ).length;
  const done = agents.filter((a) => a.status === "done").length;
  const errors = agents.filter((a) => a.status === "error").length;

  return (
    <div className="flex items-center gap-3 text-xs">
      {active > 0 && (
        <span className="flex items-center gap-1 text-purple-400">
          <motion.span
            className="inline-block w-1.5 h-1.5 rounded-full bg-purple-400"
            animate={{ scale: [1, 1.5, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
          {active} active
        </span>
      )}
      {done > 0 && (
        <span className="text-green-400">{done} done</span>
      )}
      {errors > 0 && (
        <span className="text-red-400">{errors} error{errors > 1 ? "s" : ""}</span>
      )}
      {agents.length === 0 && (
        <span className="text-gray-600">No agents</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AgentStatusPanel({
  agents,
  title = "Agent Status",
  defaultCollapsed = false,
  onCancelAgent,
  className = "",
}: AgentStatusPanelProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const activeAgents = agents.filter((a) =>
    ["thinking", "executing", "waiting"].includes(a.status)
  );
  const inactiveAgents = agents.filter((a) =>
    !["thinking", "executing", "waiting"].includes(a.status)
  );
  // Show active first, then inactive
  const ordered = [...activeAgents, ...inactiveAgents];

  return (
    <div
      className={`rounded-2xl border border-gray-800/60 bg-gray-900/40 backdrop-blur-sm overflow-hidden ${className}`}
    >
      {/* Panel header */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-800/40 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-purple-900/60 border border-purple-800/40 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-gray-100">{title}</span>
          <PanelSummary agents={agents} />
        </div>

        <motion.svg
          animate={{ rotate: collapsed ? 0 : 180 }}
          transition={{ duration: 0.2 }}
          className="w-4 h-4 text-gray-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </motion.svg>
      </button>

      {/* Agent list */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="panel-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1">
              {ordered.length === 0 ? (
                <div className="text-center py-8 text-gray-600 text-sm">
                  No agents registered yet.
                </div>
              ) : (
                <motion.div layout className="space-y-2.5">
                  <AnimatePresence>
                    {ordered.map((agent) => (
                      <AgentRow
                        key={agent.id}
                        agent={agent}
                        onCancel={onCancelAgent}
                      />
                    ))}
                  </AnimatePresence>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default AgentStatusPanel;
