import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolStatus = "pending" | "running" | "success" | "error";

export interface ToolExecutionCardProps {
  /** Unique identifier for the tool call */
  id?: string;
  /** Name of the tool being executed */
  toolName: string;
  /** Current execution status */
  status: ToolStatus;
  /** Input passed to the tool (will be JSON-formatted) */
  input?: unknown;
  /** Output returned by the tool (will be JSON-formatted) */
  output?: unknown;
  /** Execution duration in milliseconds */
  duration?: number;
  /** Error message if status === 'error' */
  error?: string;
  /** Whether the card starts expanded */
  defaultExpanded?: boolean;
}

// ---------------------------------------------------------------------------
// Tool icon map
// ---------------------------------------------------------------------------

const TOOL_ICONS: Record<string, string> = {
  // File system
  read_file: "📄",
  write_file: "💾",
  create_file: "📝",
  delete_file: "🗑️",
  list_files: "📁",
  glob: "🔍",
  // Code execution
  bash: "🖥️",
  python: "🐍",
  javascript: "⚡",
  run_command: "⚙️",
  // Search
  grep: "🔎",
  search: "🔍",
  web_search: "🌐",
  // Database
  sql: "🗄️",
  query: "📊",
  // API
  fetch: "🌍",
  http: "📡",
  api_call: "🔌",
  // AI
  llm: "🤖",
  embed: "🧠",
  // Git
  git: "📦",
  git_status: "📋",
  git_commit: "✅",
  // Default
  default: "🔧",
};

function getToolIcon(toolName: string): string {
  const lower = toolName.toLowerCase();
  for (const [key, icon] of Object.entries(TOOL_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return TOOL_ICONS.default;
}

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

interface StatusConfig {
  label: string;
  badgeClass: string;
  dotClass: string;
}

const STATUS_CONFIG: Record<ToolStatus, StatusConfig> = {
  pending: {
    label: "Pending",
    badgeClass: "bg-gray-800 text-gray-400 border-gray-700",
    dotClass: "bg-gray-500",
  },
  running: {
    label: "Running",
    badgeClass: "bg-blue-950/60 text-blue-400 border-blue-800/60",
    dotClass: "bg-blue-400",
  },
  success: {
    label: "Success",
    badgeClass: "bg-green-950/60 text-green-400 border-green-800/60",
    dotClass: "bg-green-400",
  },
  error: {
    label: "Error",
    badgeClass: "bg-red-950/60 text-red-400 border-red-800/60",
    dotClass: "bg-red-400",
  },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SpinnerIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 animate-spin text-blue-400"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function XCircleIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <motion.svg
      animate={{ rotate: expanded ? 180 : 0 }}
      transition={{ duration: 0.2 }}
      className="w-4 h-4 text-gray-500"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </motion.svg>
  );
}

function StatusIndicator({ status }: { status: ToolStatus }) {
  if (status === "running") return <SpinnerIcon />;
  if (status === "success") return <CheckCircleIcon />;
  if (status === "error") return <XCircleIcon />;
  // pending
  return <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-600" />;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function JsonBlock({ data, label }: { data: unknown; label: string }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(data, null, 2);

  const handleCopy = useCallback(async () => {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [json]);

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          {label}
        </span>
        <button
          onClick={handleCopy}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="text-xs font-mono text-gray-300 bg-gray-950/80 border border-gray-800 rounded-md p-3 overflow-x-auto max-h-64 leading-5">
        {json}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ToolExecutionCard({
  toolName,
  status,
  input,
  output,
  duration,
  error,
  defaultExpanded = false,
}: ToolExecutionCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const config = STATUS_CONFIG[status];
  const icon = getToolIcon(toolName);
  const hasDetails = input !== undefined || output !== undefined || error;

  const borderColorMap: Record<ToolStatus, string> = {
    pending: "border-gray-700/50",
    running: "border-blue-800/40",
    success: "border-green-800/30",
    error: "border-red-800/40",
  };

  const headerBgMap: Record<ToolStatus, string> = {
    pending: "bg-gray-900",
    running: "bg-gray-900",
    success: "bg-gray-900",
    error: "bg-gray-900",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`rounded-xl border ${borderColorMap[status]} overflow-hidden text-sm shadow-sm`}
    >
      {/* Card header */}
      <button
        onClick={() => hasDetails && setExpanded((v) => !v)}
        disabled={!hasDetails}
        aria-expanded={expanded}
        className={`
          w-full flex items-center gap-3 px-4 py-3
          ${headerBgMap[status]}
          ${hasDetails ? "cursor-pointer hover:bg-gray-800/80" : "cursor-default"}
          transition-colors duration-150 text-left
        `}
      >
        {/* Tool emoji */}
        <span className="text-base leading-none flex-shrink-0" aria-hidden>
          {icon}
        </span>

        {/* Tool name */}
        <span className="font-medium text-gray-100 flex-1 font-mono text-[0.8125rem]">
          {toolName}
        </span>

        {/* Duration badge */}
        {duration !== undefined && (
          <span className="flex items-center gap-1 text-xs text-gray-500 tabular-nums">
            <ClockIcon />
            {formatDuration(duration)}
          </span>
        )}

        {/* Status badge */}
        <span
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium ${config.badgeClass}`}
        >
          <StatusIndicator status={status} />
          {config.label}
        </span>

        {/* Chevron */}
        {hasDetails && <ChevronIcon expanded={expanded} />}
      </button>

      {/* Running progress bar */}
      {status === "running" && (
        <div className="h-0.5 bg-gray-800 overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-blue-600 to-purple-600"
            animate={{ x: ["-100%", "100%"] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
            style={{ width: "50%" }}
          />
        </div>
      )}

      {/* Expandable details */}
      <AnimatePresence initial={false}>
        {expanded && hasDetails && (
          <motion.div
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 bg-gray-950/60 border-t border-gray-800/60">
              {/* Error message */}
              {error && (
                <div className="mt-3 p-3 rounded-lg bg-red-950/40 border border-red-800/40">
                  <div className="flex items-start gap-2">
                    <XCircleIcon />
                    <div>
                      <p className="text-xs font-medium text-red-400 mb-0.5">Error</p>
                      <p className="text-xs text-red-300 font-mono">{error}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Input */}
              {input !== undefined && (
                <JsonBlock data={input} label="Input" />
              )}

              {/* Output */}
              {output !== undefined && !error && (
                <JsonBlock data={output} label="Output" />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default ToolExecutionCard;
