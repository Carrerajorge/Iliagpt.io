/**
 * ThinkingTrace — Claude-style extended-thinking UI.
 *
 * Renders ABOVE the assistant answer:
 *  - While streaming: a shimmering "Pensando…" header (with the dot-matrix
 *    spinner), expanded by default, showing the reasoning as live markdown
 *    with an internal auto-scroll anchored to the bottom, and tool calls
 *    interleaved as timeline rows (gray vertical connector, per-tool icon,
 *    collapsible chip revealing the streamed arguments as highlighted code).
 *  - On reasoning_done: auto-collapses to a single line with the first
 *    sentence of the reasoning plus the duration ("Pensó durante 12 s"),
 *    expandable again with a click.
 *  - For history messages with persisted reasoning it renders collapsed.
 *
 * Light/dark theming comes from the design tokens (muted/border/foreground)
 * and the markdown renderer's own prose-invert handling.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Brain,
  Search,
  Globe,
  FileText,
  Terminal,
  Image as ImageIcon,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { MarkdownRenderer, MarkdownErrorBoundary } from "@/components/markdown-renderer";
import { DotmCircular15 } from "@/components/ui/dotm-circular-15";
import {
  useThinkingTraceStore,
  selectThinkingTrace,
  type ThinkingToolCall,
} from "@/stores/thinkingTraceStore";

const SUMMARY_MAX_CHARS = 140;

function firstSentence(text: string): string {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const match = normalized.match(/^.*?[.!?。](?:\s|$)/);
  const sentence = (match ? match[0] : normalized).trim();
  return sentence.length > SUMMARY_MAX_CHARS
    ? `${sentence.slice(0, SUMMARY_MAX_CHARS - 1).trimEnd()}…`
    : sentence;
}

function formatDurationSeconds(durationMs: number | null | undefined): number | null {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) return null;
  return Math.max(1, Math.round(durationMs / 1000));
}

function toolIconFor(name: string) {
  const n = String(name || "").toLowerCase();
  if (/search|query|buscar/.test(n)) return Search;
  if (/web|browser|url|http|navigate|fetch/.test(n)) return Globe;
  if (/file|doc|read|write|pdf|excel|word/.test(n)) return FileText;
  if (/code|exec|python|bash|shell|terminal|run/.test(n)) return Terminal;
  if (/image|img|photo|vision/.test(n)) return ImageIcon;
  return Wrench;
}

function prettyToolName(name: string): string {
  const cleaned = String(name || "tool").replace(/[_-]+/g, " ").trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function formatToolArgs(args: string): string {
  const raw = String(args || "").trim();
  if (!raw) return "{}";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw; // partial JSON mid-stream — show as-is
  }
}

function ToolCallRow({ toolCall }: { toolCall: ThinkingToolCall }) {
  const [open, setOpen] = useState(false);
  const Icon = toolIconFor(toolCall.name);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" aria-hidden="true" />
        <span className="font-medium text-foreground/80">{prettyToolName(toolCall.name)}</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5",
            "text-[11px] text-muted-foreground hover:text-foreground hover:border-border",
            "transition-colors",
          )}
          aria-expanded={open}
        >
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {t("thinkingToolArgs", { defaultValue: "Ver argumentos" })}
        </button>
      </div>
      {open && (
        <div className="text-xs [&_pre]:my-1 [&_pre]:max-h-48 [&_pre]:overflow-auto">
          <MarkdownErrorBoundary fallbackContent={toolCall.args}>
            <MarkdownRenderer content={`\`\`\`json\n${formatToolArgs(toolCall.args)}\n\`\`\``} />
          </MarkdownErrorBoundary>
        </div>
      )}
    </div>
  );
}

export interface ThinkingTraceProps {
  reasoning: string;
  toolCalls?: ThinkingToolCall[];
  durationMs?: number | null;
  /** Live streaming mode: expanded by default, shimmer header, auto-scroll. */
  streaming?: boolean;
  className?: string;
}

export function ThinkingTrace({
  reasoning,
  toolCalls = [],
  durationMs = null,
  streaming = false,
  className,
}: ThinkingTraceProps) {
  // Expanded by default while streaming; auto-collapses when streaming ends.
  const [expanded, setExpanded] = useState(streaming);
  const wasStreamingRef = useRef(streaming);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (streaming && !wasStreamingRef.current) {
      setExpanded(true);
    }
    if (!streaming && wasStreamingRef.current) {
      // reasoning_done → collapse to the one-line summary.
      setExpanded(false);
    }
    wasStreamingRef.current = streaming;
  }, [streaming]);

  // Internal auto-scroll anchored to the bottom while streaming.
  useEffect(() => {
    if (!streaming || !expanded) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [reasoning, toolCalls.length, streaming, expanded]);

  const summary = useMemo(() => firstSentence(reasoning), [reasoning]);
  const seconds = formatDurationSeconds(durationMs);

  if (!reasoning && toolCalls.length === 0) return null;

  return (
    <div
      className={cn("mb-2 w-full min-w-0 text-sm", className)}
      data-testid="thinking-trace"
      aria-label={t("thinkingTraceLabel", { defaultValue: "Razonamiento del asistente" })}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "group flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left",
          "text-muted-foreground hover:text-foreground transition-colors",
        )}
        aria-expanded={expanded}
      >
        {streaming ? (
          <span className="shrink-0 [&_svg]:h-4 [&_svg]:w-4" aria-hidden="true">
            <DotmCircular15 size={16} />
          </span>
        ) : (
          <Brain className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
        )}
        {streaming ? (
          <span className="thinking-shimmer-text text-sm font-medium">
            {t("thinkingHeader", { defaultValue: "Pensando…" })}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {summary || t("thinkingHeader", { defaultValue: "Pensando…" })}
            {seconds !== null && (
              <span className="text-muted-foreground/70">
                {" · "}
                {t("thinkingDuration", {
                  defaultValue: "Pensó durante {seconds} s",
                  values: { seconds },
                })}
              </span>
            )}
          </span>
        )}
        <span className="ml-auto shrink-0 text-muted-foreground/60 group-hover:text-muted-foreground">
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>

      {expanded && (
        <div
          ref={scrollRef}
          className={cn(
            "ml-[7px] mt-1 max-h-64 overflow-y-auto",
            "border-l-2 border-border/70 dark:border-border/50 pl-4 pr-1",
            "scrollbar-thin scrollbar-thumb-muted-foreground/20",
          )}
        >
          {reasoning && (
            <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed text-muted-foreground [&_p]:my-1.5">
              <MarkdownErrorBoundary fallbackContent={reasoning}>
                <MarkdownRenderer content={reasoning} />
              </MarkdownErrorBoundary>
            </div>
          )}
          {toolCalls.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              {toolCalls.map((toolCall) => (
                <ToolCallRow key={`${toolCall.index}-${toolCall.id || toolCall.name}`} toolCall={toolCall} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Live variant — subscribes to the per-conversation thinking trace store. */
export function LiveThinkingTrace({
  conversationId,
  className,
}: {
  conversationId: string | null | undefined;
  className?: string;
}) {
  const trace = useThinkingTraceStore(selectThinkingTrace(conversationId));
  if (!trace || (!trace.reasoning && trace.toolCalls.length === 0)) return null;
  return (
    <ThinkingTrace
      reasoning={trace.reasoning}
      toolCalls={trace.toolCalls}
      durationMs={trace.durationMs}
      streaming={trace.status === "streaming"}
      className={className}
    />
  );
}

/** Static variant for persisted messages (collapsed by default). */
export function MessageThinkingTrace({
  message,
  className,
}: {
  message: {
    reasoning?: string | null;
    reasoningDurationMs?: number | null;
    reasoningToolCalls?: ThinkingToolCall[];
    metadata?: Record<string, any> | null;
  };
  className?: string;
}) {
  const reasoning = typeof message.reasoning === "string" ? message.reasoning : "";
  if (!reasoning) return null;
  const durationMs =
    typeof message.reasoningDurationMs === "number"
      ? message.reasoningDurationMs
      : typeof message.metadata?.reasoningDurationMs === "number"
        ? message.metadata.reasoningDurationMs
        : null;
  return (
    <ThinkingTrace
      reasoning={reasoning}
      toolCalls={message.reasoningToolCalls || []}
      durationMs={durationMs}
      streaming={false}
      className={className}
    />
  );
}
