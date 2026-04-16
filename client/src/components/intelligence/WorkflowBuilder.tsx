import "reactflow/dist/style.css";
import {
  memo,
  useCallback,
  useRef,
  useState,
  useEffect,
  useMemo,
} from "react";
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  Handle,
  Position,
  NodeProps,
  Connection,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow,
} from "reactflow";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  Play,
  Square,
  Save,
  Trash2,
  LayoutGrid,
  Brain,
  Wrench,
  GitBranch,
  RefreshCw,
  User,
  Clock,
  Code2,
  ChevronRight,
  X,
  Plus,
  Download,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Loader2,
  CheckCircle2,
  XCircle,
  Circle,
  Zap,
  FileCode2,
  Workflow,
  AlertTriangle,
  ChevronDown,
  Sliders,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

type WorkflowNodeType =
  | "ai_task"
  | "tool"
  | "condition"
  | "loop"
  | "human_input"
  | "timer"
  | "start"
  | "end"
  | "transform";

interface WorkflowNodeData {
  label: string;
  type: WorkflowNodeType;
  config: Record<string, any>;
  status?: "idle" | "active" | "complete" | "failed";
  executionLog?: string[];
}

interface WorkflowBuilderProps {
  initialWorkflow?: { nodes: Node[]; edges: Edge[] };
  onSave?: (workflow: { name: string; nodes: Node[]; edges: Edge[]; yaml?: string }) => void;
  onRun?: (workflow: { nodes: Node[]; edges: Edge[] }) => Promise<void>;
  className?: string;
  readOnly?: boolean;
}

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  nodes: Node[];
  edges: Edge[];
}

// ─── Node palette config ──────────────────────────────────────────────────────

interface PaletteItem {
  type: WorkflowNodeType;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  border: string;
  defaultConfig: Record<string, any>;
}

const PALETTE: PaletteItem[] = [
  {
    type: "ai_task",
    label: "AI Task",
    description: "LLM call with configurable prompt",
    icon: Brain,
    color: "text-blue-600",
    bg: "bg-blue-50 dark:bg-blue-900/20",
    border: "border-blue-200 dark:border-blue-700",
    defaultConfig: { model: "gpt-4o", prompt: "", temperature: 0.7 },
  },
  {
    type: "tool",
    label: "Tool",
    description: "Execute web search, code, APIs",
    icon: Wrench,
    color: "text-amber-600",
    bg: "bg-amber-50 dark:bg-amber-900/20",
    border: "border-amber-200 dark:border-amber-700",
    defaultConfig: { tool: "web_search", params: {} },
  },
  {
    type: "condition",
    label: "Condition",
    description: "Branch based on expression",
    icon: GitBranch,
    color: "text-orange-600",
    bg: "bg-orange-50 dark:bg-orange-900/20",
    border: "border-orange-200 dark:border-orange-700",
    defaultConfig: { expression: "", trueBranch: "continue", falseBranch: "stop" },
  },
  {
    type: "loop",
    label: "Loop",
    description: "Iterate over a list of items",
    icon: RefreshCw,
    color: "text-violet-600",
    bg: "bg-violet-50 dark:bg-violet-900/20",
    border: "border-violet-200 dark:border-violet-700",
    defaultConfig: { itemsSource: "", maxIterations: 10 },
  },
  {
    type: "human_input",
    label: "Human Input",
    description: "Pause and wait for user",
    icon: User,
    color: "text-zinc-600",
    bg: "bg-zinc-50 dark:bg-zinc-800/40",
    border: "border-zinc-200 dark:border-zinc-600",
    defaultConfig: { prompt: "Please provide input:", required: true },
  },
  {
    type: "timer",
    label: "Timer",
    description: "Delay or schedule execution",
    icon: Clock,
    color: "text-teal-600",
    bg: "bg-teal-50 dark:bg-teal-900/20",
    border: "border-teal-200 dark:border-teal-700",
    defaultConfig: { delay: 5, unit: "seconds" },
  },
  {
    type: "transform",
    label: "Transform",
    description: "Data transformation / mapping",
    icon: Code2,
    color: "text-rose-600",
    bg: "bg-rose-50 dark:bg-rose-900/20",
    border: "border-rose-200 dark:border-rose-700",
    defaultConfig: { code: "// transform input\nreturn input;" },
  },
];

// ─── Status dot ───────────────────────────────────────────────────────────────

const StatusDot = memo(({ status }: { status?: WorkflowNodeData["status"] }) => {
  if (!status || status === "idle") return null;
  return (
    <span className="absolute -top-1.5 -right-1.5 z-10">
      {status === "active" && (
        <motion.span
          animate={{ scale: [1, 1.35, 1] }}
          transition={{ repeat: Infinity, duration: 0.8 }}
          className="block w-3 h-3 rounded-full bg-blue-400 ring-2 ring-white dark:ring-zinc-900"
        />
      )}
      {status === "complete" && (
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 bg-white dark:bg-zinc-900 rounded-full" />
      )}
      {status === "failed" && (
        <XCircle className="w-3.5 h-3.5 text-rose-500 bg-white dark:bg-zinc-900 rounded-full" />
      )}
    </span>
  );
});
StatusDot.displayName = "StatusDot";

// ─── Custom node components ───────────────────────────────────────────────────

const StartNode = memo(({ data }: NodeProps<WorkflowNodeData>) => (
  <div className="relative flex flex-col items-center gap-1 select-none">
    <StatusDot status={data.status} />
    <Handle type="source" position={Position.Bottom} className="!bg-emerald-500 !w-3 !h-3 !border-2 !border-white" />
    <motion.div
      whileHover={{ scale: 1.08 }}
      className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg flex items-center justify-center ring-4 ring-emerald-200 dark:ring-emerald-900"
    >
      <Play className="w-6 h-6 text-white ml-0.5" />
    </motion.div>
    <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 mt-1">Start</span>
  </div>
));
StartNode.displayName = "StartNode";

const EndNode = memo(({ data }: NodeProps<WorkflowNodeData>) => (
  <div className="relative flex flex-col items-center gap-1 select-none">
    <StatusDot status={data.status} />
    <Handle type="target" position={Position.Top} className="!bg-rose-500 !w-3 !h-3 !border-2 !border-white" />
    <motion.div
      whileHover={{ scale: 1.08 }}
      className="w-16 h-16 rounded-full bg-gradient-to-br from-rose-400 to-rose-600 shadow-lg flex items-center justify-center ring-4 ring-rose-200 dark:ring-rose-900"
    >
      <Square className="w-6 h-6 text-white" />
    </motion.div>
    <span className="text-xs font-bold text-rose-700 dark:text-rose-400 mt-1">End</span>
  </div>
));
EndNode.displayName = "EndNode";

const BaseCard = memo(
  ({
    data,
    item,
    children,
  }: {
    data: WorkflowNodeData;
    item: PaletteItem;
    children?: React.ReactNode;
  }) => {
    const Icon = item.icon;
    return (
      <div
        className={cn(
          "relative min-w-[200px] max-w-[260px] rounded-xl border shadow-sm p-3 select-none transition-shadow hover:shadow-md",
          item.bg,
          item.border,
          data.status === "active" && "ring-2 ring-blue-400",
          data.status === "complete" && "ring-2 ring-emerald-400",
          data.status === "failed" && "ring-2 ring-rose-400"
        )}
      >
        <Handle
          type="target"
          position={Position.Top}
          className="!bg-zinc-400 !w-3 !h-3 !border-2 !border-white"
        />
        <StatusDot status={data.status} />
        <div className="flex items-center gap-2 mb-2">
          <div
            className={cn(
              "w-7 h-7 rounded-lg flex items-center justify-center bg-white dark:bg-zinc-900 shadow-sm flex-shrink-0"
            )}
          >
            <Icon className={cn("w-3.5 h-3.5", item.color)} />
          </div>
          <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-100 truncate flex-1">
            {data.label}
          </span>
        </div>
        {children}
        <Handle
          type="source"
          position={Position.Bottom}
          className="!bg-zinc-400 !w-3 !h-3 !border-2 !border-white"
        />
      </div>
    );
  }
);
BaseCard.displayName = "BaseCard";

const AITaskNode = memo(({ data }: NodeProps<WorkflowNodeData>) => {
  const item = PALETTE.find((p) => p.type === "ai_task")!;
  return (
    <BaseCard data={data} item={item}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 h-auto font-mono bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-0">
          {data.config.model ?? "gpt-4o"}
        </Badge>
        <span className="text-[10px] text-zinc-400">temp: {data.config.temperature ?? 0.7}</span>
      </div>
      {data.config.prompt && (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-2 italic">
          &ldquo;{data.config.prompt}&rdquo;
        </p>
      )}
    </BaseCard>
  );
});
AITaskNode.displayName = "AITaskNode";

const ToolNode = memo(({ data }: NodeProps<WorkflowNodeData>) => {
  const item = PALETTE.find((p) => p.type === "tool")!;
  return (
    <BaseCard data={data} item={item}>
      <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 h-auto bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-0">
        {data.config.tool ?? "web_search"}
      </Badge>
    </BaseCard>
  );
});
ToolNode.displayName = "ToolNode";

const ConditionNode = memo(({ data }: NodeProps<WorkflowNodeData>) => {
  const item = PALETTE.find((p) => p.type === "condition")!;
  return (
    <div
      className={cn(
        "relative select-none",
        data.status === "active" && "drop-shadow-[0_0_6px_rgba(59,130,246,0.6)]"
      )}
      style={{ width: 120, height: 80 }}
    >
      <Handle type="target" position={Position.Top} style={{ top: -6 }} className="!bg-zinc-400 !w-3 !h-3 !border-2 !border-white" />
      <StatusDot status={data.status} />
      {/* Diamond shape via CSS */}
      <div
        className={cn(
          "absolute inset-0 rounded border-2 rotate-45",
          item.bg,
          item.border,
          "shadow-sm"
        )}
        style={{ transformOrigin: "center" }}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <GitBranch className={cn("w-4 h-4", item.color)} />
        <span className="text-[10px] font-bold text-zinc-700 dark:text-zinc-200">
          {data.label}
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        style={{ bottom: -6 }}
        className="!bg-emerald-500 !w-3 !h-3 !border-2 !border-white"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="false"
        style={{ right: -6 }}
        className="!bg-rose-500 !w-3 !h-3 !border-2 !border-white"
      />
      <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] text-emerald-600 font-medium">true</span>
      <span className="absolute top-1/2 -translate-y-1/2 -right-8 text-[9px] text-rose-600 font-medium">false</span>
    </div>
  );
});
ConditionNode.displayName = "ConditionNode";

const LoopNode = memo(({ data }: NodeProps<WorkflowNodeData>) => {
  const item = PALETTE.find((p) => p.type === "loop")!;
  return (
    <BaseCard data={data} item={item}>
      <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
        <RefreshCw className="w-3 h-3" />
        <span>max {data.config.maxIterations ?? 10} iterations</span>
      </div>
      {data.config.itemsSource && (
        <p className="text-[10px] text-zinc-400 mt-1 truncate">
          Items: {data.config.itemsSource}
        </p>
      )}
    </BaseCard>
  );
});
LoopNode.displayName = "LoopNode";

const HumanInputNode = memo(({ data }: NodeProps<WorkflowNodeData>) => {
  const item = PALETTE.find((p) => p.type === "human_input")!;
  return (
    <BaseCard data={data} item={item}>
      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 italic line-clamp-2">
        {data.config.prompt ?? "Awaiting user input…"}
      </p>
    </BaseCard>
  );
});
HumanInputNode.displayName = "HumanInputNode";

const TimerNode = memo(({ data }: NodeProps<WorkflowNodeData>) => {
  const item = PALETTE.find((p) => p.type === "timer")!;
  return (
    <BaseCard data={data} item={item}>
      <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
        <Clock className="w-3 h-3" />
        <span>
          {data.config.delay ?? 5} {data.config.unit ?? "seconds"}
        </span>
      </div>
    </BaseCard>
  );
});
TimerNode.displayName = "TimerNode";

const TransformNode = memo(({ data }: NodeProps<WorkflowNodeData>) => {
  const item = PALETTE.find((p) => p.type === "transform")!;
  return (
    <BaseCard data={data} item={item}>
      <pre className="text-[10px] text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 rounded p-1.5 overflow-hidden line-clamp-3 font-mono">
        {data.config.code ?? "// transform"}
      </pre>
    </BaseCard>
  );
});
TransformNode.displayName = "TransformNode";

// ─── Node type registry ───────────────────────────────────────────────────────

const nodeTypes = {
  start: StartNode,
  end: EndNode,
  ai_task: AITaskNode,
  tool: ToolNode,
  condition: ConditionNode,
  loop: LoopNode,
  human_input: HumanInputNode,
  timer: TimerNode,
  transform: TransformNode,
};

// ─── Templates ────────────────────────────────────────────────────────────────

const TEMPLATES: WorkflowTemplate[] = [
  {
    id: "research_digest",
    name: "Research Digest",
    description: "Search the web, summarize findings, and generate a report",
    icon: Brain,
    nodes: [
      { id: "s", type: "start", position: { x: 250, y: 30 }, data: { label: "Start", type: "start", config: {} } },
      { id: "t1", type: "tool", position: { x: 250, y: 150 }, data: { label: "Web Search", type: "tool", config: { tool: "web_search", params: {} } } },
      { id: "a1", type: "ai_task", position: { x: 250, y: 280 }, data: { label: "Summarize", type: "ai_task", config: { model: "gpt-4o", prompt: "Summarize the search results in bullet points.", temperature: 0.3 } } },
      { id: "a2", type: "ai_task", position: { x: 250, y: 410 }, data: { label: "Write Report", type: "ai_task", config: { model: "gpt-4o", prompt: "Generate a professional report from the summary.", temperature: 0.7 } } },
      { id: "e", type: "end", position: { x: 250, y: 540 }, data: { label: "End", type: "end", config: {} } },
    ],
    edges: [
      { id: "e1", source: "s", target: "t1", markerEnd: { type: MarkerType.ArrowClosed } },
      { id: "e2", source: "t1", target: "a1", markerEnd: { type: MarkerType.ArrowClosed } },
      { id: "e3", source: "a1", target: "a2", markerEnd: { type: MarkerType.ArrowClosed } },
      { id: "e4", source: "a2", target: "e", markerEnd: { type: MarkerType.ArrowClosed } },
    ],
  },
  {
    id: "code_review",
    name: "Code Review",
    description: "Automated code analysis with AI feedback",
    icon: Code2,
    nodes: [
      { id: "s", type: "start", position: { x: 250, y: 30 }, data: { label: "Start", type: "start", config: {} } },
      { id: "h1", type: "human_input", position: { x: 250, y: 150 }, data: { label: "Submit Code", type: "human_input", config: { prompt: "Paste the code to review:" } } },
      { id: "a1", type: "ai_task", position: { x: 250, y: 280 }, data: { label: "Analyze Code", type: "ai_task", config: { model: "gpt-4o", prompt: "Review this code for bugs, style, and performance.", temperature: 0.2 } } },
      { id: "c1", type: "condition", position: { x: 250, y: 400 }, data: { label: "Has Issues?", type: "condition", config: { expression: "issues.length > 0" } } },
      { id: "a2", type: "ai_task", position: { x: 130, y: 520 }, data: { label: "Suggest Fixes", type: "ai_task", config: { model: "gpt-4o", prompt: "Suggest specific fixes for each issue.", temperature: 0.4 } } },
      { id: "e", type: "end", position: { x: 250, y: 640 }, data: { label: "End", type: "end", config: {} } },
    ],
    edges: [
      { id: "e1", source: "s", target: "h1", markerEnd: { type: MarkerType.ArrowClosed } },
      { id: "e2", source: "h1", target: "a1", markerEnd: { type: MarkerType.ArrowClosed } },
      { id: "e3", source: "a1", target: "c1", markerEnd: { type: MarkerType.ArrowClosed } },
      { id: "e4", source: "c1", target: "a2", sourceHandle: "true", markerEnd: { type: MarkerType.ArrowClosed } },
      { id: "e5", source: "a2", target: "e", markerEnd: { type: MarkerType.ArrowClosed } },
      { id: "e6", source: "c1", target: "e", sourceHandle: "false", markerEnd: { type: MarkerType.ArrowClosed } },
    ],
  },
  {
    id: "content_creation",
    name: "Content Creation",
    description: "Research topic, draft content, review and refine",
    icon: FileCode2,
    nodes: [
      { id: "s", type: "start", position: { x: 250, y: 30 }, data: { label: "Start", type: "start", config: {} } },
      { id: "h1", type: "human_input", position: { x: 250, y: 150 }, data: { label: "Topic Input", type: "human_input", config: { prompt: "What topic should I write about?" } } },
      { id: "t1", type: "tool", position: { x: 250, y: 280 }, data: { label: "Research", type: "tool", config: { tool: "web_search" } } },
      { id: "a1", type: "ai_task", position: { x: 250, y: 410 }, data: { label: "Draft Article", type: "ai_task", config: { model: "gpt-4o", prompt: "Write a comprehensive article based on the research.", temperature: 0.8 } } },
      { id: "a2", type: "ai_task", position: { x: 250, y: 540 }, data: { label: "SEO Review", type: "ai_task", config: { model: "gpt-4o", prompt: "Optimize the article for SEO.", temperature: 0.3 } } },
      { id: "e", type: "end", position: { x: 250, y: 670 }, data: { label: "End", type: "end", config: {} } },
    ],
    edges: [
      { id: "e1", source: "s", target: "h1", markerEnd: { type: MarkerType.ArrowClosed } },
      { id: "e2", source: "h1", target: "t1", markerEnd: { type: MarkerType.ArrowClosed } },
      { id: "e3", source: "t1", target: "a1", markerEnd: { type: MarkerType.ArrowClosed } },
      { id: "e4", source: "a1", target: "a2", markerEnd: { type: MarkerType.ArrowClosed } },
      { id: "e5", source: "a2", target: "e", markerEnd: { type: MarkerType.ArrowClosed } },
    ],
  },
  {
    id: "data_pipeline",
    name: "Data Pipeline",
    description: "Fetch, transform, and store data automatically",
    icon: Workflow,
    nodes: [
      { id: "s", type: "start", position: { x: 250, y: 30 }, data: { label: "Start", type: "start", config: {} } },
      { id: "t1", type: "tool", position: { x: 250, y: 150 }, data: { label: "Fetch Data", type: "tool", config: { tool: "api_call" } } },
      { id: "tr1", type: "transform", position: { x: 250, y: 280 }, data: { label: "Clean Data", type: "transform", config: { code: "return input.filter(row => row.value != null);" } } },
      { id: "l1", type: "loop", position: { x: 250, y: 410 }, data: { label: "Process Each", type: "loop", config: { itemsSource: "cleaned_data", maxIterations: 100 } } },
      { id: "a1", type: "ai_task", position: { x: 250, y: 540 }, data: { label: "Enrich Item", type: "ai_task", config: { model: "gpt-4o-mini", prompt: "Enrich this data item with additional context.", temperature: 0.1 } } },
      { id: "e", type: "end", position: { x: 250, y: 670 }, data: { label: "End", type: "end", config: {} } },
    ],
    edges: [
      { id: "e1", source: "s", target: "t1", markerEnd: { type: MarkerType.ArrowClosed } },
      { id: "e2", source: "t1", target: "tr1", markerEnd: { type: MarkerType.ArrowClosed } },
      { id: "e3", source: "tr1", target: "l1", markerEnd: { type: MarkerType.ArrowClosed } },
      { id: "e4", source: "l1", target: "a1", markerEnd: { type: MarkerType.ArrowClosed } },
      { id: "e5", source: "a1", target: "e", markerEnd: { type: MarkerType.ArrowClosed } },
    ],
  },
  {
    id: "meeting_prep",
    name: "Meeting Prep",
    description: "Research participants and generate briefing notes",
    icon: User,
    nodes: [
      { id: "s", type: "start", position: { x: 250, y: 30 }, data: { label: "Start", type: "start", config: {} } },
      { id: "h1", type: "human_input", position: { x: 250, y: 150 }, data: { label: "Meeting Details", type: "human_input", config: { prompt: "Enter meeting details and attendees:" } } },
      { id: "t1", type: "tool", position: { x: 120, y: 280 }, data: { label: "Research People", type: "tool", config: { tool: "web_search" } } },
      { id: "t2", type: "tool", position: { x: 380, y: 280 }, data: { label: "Research Topic", type: "tool", config: { tool: "web_search" } } },
      { id: "a1", type: "ai_task", position: { x: 250, y: 410 }, data: { label: "Create Briefing", type: "ai_task", config: { model: "gpt-4o", prompt: "Generate a concise meeting briefing with key talking points.", temperature: 0.5 } } },
      { id: "e", type: "end", position: { x: 250, y: 540 }, data: { label: "End", type: "end", config: {} } },
    ],
    edges: [
      { id: "e1", source: "s", target: "h1", markerEnd: { type: MarkerType.ArrowClosed } },
      { id: "e2", source: "h1", target: "t1", markerEnd: { type: MarkerType.ArrowClosed } },
      { id: "e3", source: "h1", target: "t2", markerEnd: { type: MarkerType.ArrowClosed } },
      { id: "e4", source: "t1", target: "a1", markerEnd: { type: MarkerType.ArrowClosed } },
      { id: "e5", source: "t2", target: "a1", markerEnd: { type: MarkerType.ArrowClosed } },
      { id: "e6", source: "a1", target: "e", markerEnd: { type: MarkerType.ArrowClosed } },
    ],
  },
];

// ─── YAML export ──────────────────────────────────────────────────────────────

function exportToYaml(name: string, nodes: Node[], edges: Edge[]): string {
  const lines: string[] = [`name: "${name}"`, "nodes:"];
  for (const n of nodes) {
    lines.push(`  - id: "${n.id}"`);
    lines.push(`    type: "${n.type}"`);
    lines.push(`    label: "${(n.data as WorkflowNodeData).label}"`);
    lines.push(`    position:`);
    lines.push(`      x: ${n.position.x}`);
    lines.push(`      y: ${n.position.y}`);
    const cfg = (n.data as WorkflowNodeData).config;
    if (Object.keys(cfg).length > 0) {
      lines.push(`    config:`);
      for (const [k, v] of Object.entries(cfg)) {
        lines.push(`      ${k}: ${JSON.stringify(v)}`);
      }
    }
  }
  lines.push("edges:");
  for (const e of edges) {
    lines.push(`  - id: "${e.id}"`);
    lines.push(`    source: "${e.source}"`);
    lines.push(`    target: "${e.target}"`);
  }
  return lines.join("\n");
}

// ─── Config panel ─────────────────────────────────────────────────────────────

const ConfigPanel = memo(
  ({
    node,
    onUpdate,
    onClose,
    readOnly,
  }: {
    node: Node<WorkflowNodeData>;
    onUpdate: (id: string, config: Record<string, any>, label: string) => void;
    onClose: () => void;
    readOnly?: boolean;
  }) => {
    const [label, setLabel] = useState(node.data.label);
    const [cfg, setCfg] = useState({ ...node.data.config });

    useEffect(() => {
      setLabel(node.data.label);
      setCfg({ ...node.data.config });
    }, [node.id]);

    const save = () => onUpdate(node.id, cfg, label);

    return (
      <motion.div
        initial={{ x: 300, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 300, opacity: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="absolute right-0 top-0 h-full w-72 bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-700 shadow-xl z-10 flex flex-col"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-zinc-500" />
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Node Config</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-1 block">Label</label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                disabled={readOnly}
                className="h-8 text-sm"
              />
            </div>

            <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium pt-1">
              Configuration
            </div>

            {/* AI Task config */}
            {node.data.type === "ai_task" && (
              <>
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1 block">Model</label>
                  <Select
                    value={cfg.model ?? "gpt-4o"}
                    onValueChange={(v) => setCfg((c) => ({ ...c, model: v }))}
                    disabled={readOnly}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["gpt-4o", "gpt-4o-mini", "claude-3-5-sonnet", "claude-3-haiku", "gemini-1.5-pro"].map((m) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1 block">Prompt</label>
                  <textarea
                    value={cfg.prompt ?? ""}
                    onChange={(e) => setCfg((c) => ({ ...c, prompt: e.target.value }))}
                    disabled={readOnly}
                    className="w-full min-h-[100px] text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter your prompt…"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1 block">
                    Temperature: {cfg.temperature ?? 0.7}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={cfg.temperature ?? 0.7}
                    onChange={(e) => setCfg((c) => ({ ...c, temperature: parseFloat(e.target.value) }))}
                    disabled={readOnly}
                    className="w-full accent-blue-500"
                  />
                  <div className="flex justify-between text-[10px] text-zinc-400 mt-0.5">
                    <span>Precise</span>
                    <span>Creative</span>
                  </div>
                </div>
              </>
            )}

            {/* Tool config */}
            {node.data.type === "tool" && (
              <div>
                <label className="text-xs font-medium text-zinc-500 mb-1 block">Tool</label>
                <Select
                  value={cfg.tool ?? "web_search"}
                  onValueChange={(v) => setCfg((c) => ({ ...c, tool: v }))}
                  disabled={readOnly}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["web_search", "code_run", "api_call", "file_read", "email_send", "database_query"].map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Condition config */}
            {node.data.type === "condition" && (
              <>
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1 block">Expression</label>
                  <Input
                    value={cfg.expression ?? ""}
                    onChange={(e) => setCfg((c) => ({ ...c, expression: e.target.value }))}
                    disabled={readOnly}
                    className="h-8 text-sm font-mono"
                    placeholder="e.g. result.score > 0.8"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-emerald-600 mb-1 block">True branch</label>
                    <Input value={cfg.trueBranch ?? "continue"} onChange={(e) => setCfg((c) => ({ ...c, trueBranch: e.target.value }))} disabled={readOnly} className="h-8 text-xs" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-rose-600 mb-1 block">False branch</label>
                    <Input value={cfg.falseBranch ?? "stop"} onChange={(e) => setCfg((c) => ({ ...c, falseBranch: e.target.value }))} disabled={readOnly} className="h-8 text-xs" />
                  </div>
                </div>
              </>
            )}

            {/* Loop config */}
            {node.data.type === "loop" && (
              <>
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1 block">Items source</label>
                  <Input
                    value={cfg.itemsSource ?? ""}
                    onChange={(e) => setCfg((c) => ({ ...c, itemsSource: e.target.value }))}
                    disabled={readOnly}
                    className="h-8 text-sm"
                    placeholder="e.g. results.items"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1 block">Max iterations</label>
                  <Input
                    type="number"
                    value={cfg.maxIterations ?? 10}
                    onChange={(e) => setCfg((c) => ({ ...c, maxIterations: parseInt(e.target.value) }))}
                    disabled={readOnly}
                    className="h-8 text-sm"
                    min={1}
                    max={1000}
                  />
                </div>
              </>
            )}

            {/* Timer config */}
            {node.data.type === "timer" && (
              <>
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1 block">Delay</label>
                  <Input
                    type="number"
                    value={cfg.delay ?? 5}
                    onChange={(e) => setCfg((c) => ({ ...c, delay: parseInt(e.target.value) }))}
                    disabled={readOnly}
                    className="h-8 text-sm"
                    min={1}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1 block">Unit</label>
                  <Select
                    value={cfg.unit ?? "seconds"}
                    onValueChange={(v) => setCfg((c) => ({ ...c, unit: v }))}
                    disabled={readOnly}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["seconds", "minutes", "hours"].map((u) => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {/* Human input config */}
            {node.data.type === "human_input" && (
              <div>
                <label className="text-xs font-medium text-zinc-500 mb-1 block">Prompt message</label>
                <textarea
                  value={cfg.prompt ?? ""}
                  onChange={(e) => setCfg((c) => ({ ...c, prompt: e.target.value }))}
                  disabled={readOnly}
                  className="w-full min-h-[80px] text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            {/* Transform config */}
            {node.data.type === "transform" && (
              <div>
                <label className="text-xs font-medium text-zinc-500 mb-1 block">Code (JavaScript)</label>
                <textarea
                  value={cfg.code ?? ""}
                  onChange={(e) => setCfg((c) => ({ ...c, code: e.target.value }))}
                  disabled={readOnly}
                  className="w-full min-h-[120px] text-xs font-mono border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 bg-zinc-50 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="// return transformed value&#10;return input;"
                  spellCheck={false}
                />
              </div>
            )}
          </div>
        </ScrollArea>

        {!readOnly && (
          <div className="p-3 border-t border-zinc-100 dark:border-zinc-800">
            <Button
              onClick={save}
              className="w-full h-8 text-sm bg-blue-600 hover:bg-blue-700 text-white"
            >
              Apply changes
            </Button>
          </div>
        )}

        {/* Execution log */}
        {node.data.executionLog && node.data.executionLog.length > 0 && (
          <div className="border-t border-zinc-100 dark:border-zinc-800 p-3">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium mb-2">
              Execution Log
            </div>
            <div className="space-y-1 max-h-28 overflow-y-auto">
              {node.data.executionLog.map((line, i) => (
                <p key={i} className="text-[11px] text-zinc-500 font-mono">{line}</p>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    );
  }
);
ConfigPanel.displayName = "ConfigPanel";

// ─── Template Gallery ─────────────────────────────────────────────────────────

const TemplateGallery = memo(
  ({
    open,
    onClose,
    onSelect,
  }: {
    open: boolean;
    onClose: () => void;
    onSelect: (t: WorkflowTemplate) => void;
  }) => (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutGrid className="w-5 h-5 text-violet-500" />
            Template Gallery
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 pt-2">
          {TEMPLATES.map((t) => {
            const Icon = t.icon;
            return (
              <motion.button
                key={t.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => { onSelect(t); onClose(); }}
                className="flex gap-3 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/80 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 hover:border-violet-300 dark:hover:border-violet-700 transition-all text-left"
              >
                <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-0.5">{t.name}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">{t.description}</p>
                </div>
              </motion.button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
);
TemplateGallery.displayName = "TemplateGallery";

// ─── Inner builder (needs ReactFlow context) ──────────────────────────────────

const defaultEdgeOptions = {
  markerEnd: { type: MarkerType.ArrowClosed },
  style: { strokeWidth: 2 },
};

const initialNodes: Node[] = [
  { id: "start", type: "start", position: { x: 250, y: 50 }, data: { label: "Start", type: "start", config: {} } },
  { id: "end", type: "end", position: { x: 250, y: 400 }, data: { label: "End", type: "end", config: {} } },
];
const initialEdges: Edge[] = [];

function WorkflowBuilderInner({
  initialWorkflow,
  onSave,
  onRun,
  readOnly = false,
}: WorkflowBuilderProps) {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState(
    initialWorkflow?.nodes ?? initialNodes
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    initialWorkflow?.edges ?? initialEdges
  );
  const [selectedNode, setSelectedNode] = useState<Node<WorkflowNodeData> | null>(null);
  const [workflowName, setWorkflowName] = useState("My Workflow");
  const [isRunning, setIsRunning] = useState(false);
  const [history, setHistory] = useState<Array<{ nodes: Node[]; edges: Edge[] }>>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [idCounter, setIdCounter] = useState(100);

  // Push to undo stack whenever nodes/edges change
  const pushHistory = useCallback(
    (n: Node[], e: Edge[]) => {
      setHistory((prev) => [...prev.slice(-9), { nodes: n, edges: e }]);
    },
    []
  );

  // Connect edges
  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => {
        const next = addEdge({ ...params, markerEnd: { type: MarkerType.ArrowClosed }, style: { strokeWidth: 2 } }, eds);
        pushHistory(nodes, next);
        return next;
      });
    },
    [nodes, pushHistory, setEdges]
  );

  // Select node
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedNode(node as Node<WorkflowNodeData>);
    },
    []
  );

  // Deselect
  const onPaneClick = useCallback(() => setSelectedNode(null), []);

  // Drop node from palette
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/reactflow-type") as WorkflowNodeType;
      if (!type || !reactFlowWrapper.current) return;

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const paletteItem = PALETTE.find((p) => p.type === type);
      if (!paletteItem) return;

      const position = {
        x: event.clientX - bounds.left - 100,
        y: event.clientY - bounds.top - 40,
      };

      const newId = `${type}_${idCounter}`;
      setIdCounter((c) => c + 1);

      const newNode: Node<WorkflowNodeData> = {
        id: newId,
        type,
        position,
        data: {
          label: paletteItem.label,
          type,
          config: { ...paletteItem.defaultConfig },
          status: "idle",
        },
      };

      setNodes((nds) => {
        const next = [...nds, newNode];
        pushHistory(next, edges);
        return next;
      });
    },
    [idCounter, edges, pushHistory, setNodes]
  );

  // Update node config
  const updateNode = useCallback(
    (id: string, config: Record<string, any>, label: string) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, label, config } }
            : n
        )
      );
      setSelectedNode((prev) =>
        prev?.id === id ? { ...prev, data: { ...prev.data, label, config } } : prev
      );
    },
    [setNodes]
  );

  // Undo
  const undo = useCallback(() => {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setNodes(last.nodes);
      setEdges(last.edges);
      return prev.slice(0, -1);
    });
  }, [setNodes, setEdges]);

  // Save
  const handleSave = useCallback(() => {
    const yaml = exportToYaml(workflowName, nodes, edges);
    onSave?.({ name: workflowName, nodes, edges, yaml });
  }, [workflowName, nodes, edges, onSave]);

  // Run with animated execution
  const handleRun = useCallback(async () => {
    if (isRunning) return;
    setIsRunning(true);
    setSelectedNode(null);

    // Reset all statuses
    setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, status: "idle", executionLog: [] } })));

    // Topological traversal simulation
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const adjacency = new Map<string, string[]>();
    for (const n of nodes) adjacency.set(n.id, []);
    for (const e of edges) adjacency.get(e.source)?.push(e.target);

    const queue: string[] = ["start"];
    const visited = new Set<string>();

    const delay = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      // Mark active
      setNodes((nds) =>
        nds.map((n) =>
          n.id === current ? { ...n, data: { ...n.data, status: "active", executionLog: [`Executing node "${n.data.label}"…`] } } : n
        )
      );

      await delay(800 + Math.random() * 600);

      // Mark complete (or failed 10% chance)
      const failed = Math.random() < 0.08 && current !== "start" && current !== "end";
      setNodes((nds) =>
        nds.map((n) =>
          n.id === current
            ? {
                ...n,
                data: {
                  ...n.data,
                  status: failed ? "failed" : "complete",
                  executionLog: [
                    `Executing node "${n.data.label}"…`,
                    failed ? "Error: unexpected failure" : `Completed in ${(800 + Math.random() * 600).toFixed(0)}ms`,
                  ],
                },
              }
            : n
        )
      );

      if (!failed) {
        const next = adjacency.get(current) ?? [];
        queue.push(...next.filter((id) => !visited.has(id)));
      }
    }

    // Delegate to prop handler if provided
    try {
      await onRun?.({ nodes, edges });
    } catch {
      // ignore
    }

    setIsRunning(false);
  }, [isRunning, nodes, edges, onRun, setNodes]);

  // Clear canvas
  const handleClear = useCallback(() => {
    pushHistory(nodes, edges);
    setNodes(initialNodes);
    setEdges([]);
    setSelectedNode(null);
  }, [nodes, edges, pushHistory, setNodes, setEdges]);

  // Load template
  const loadTemplate = useCallback(
    (template: WorkflowTemplate) => {
      pushHistory(nodes, edges);
      setNodes(template.nodes);
      setEdges(template.edges);
      setWorkflowName(template.name);
      setSelectedNode(null);
      setTimeout(() => fitView({ padding: 0.2 }), 50);
    },
    [nodes, edges, pushHistory, setNodes, setEdges, fitView]
  );

  // Export YAML
  const handleExportYaml = useCallback(() => {
    const yaml = exportToYaml(workflowName, nodes, edges);
    const blob = new Blob([yaml], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${workflowName.replace(/\s+/g, "_").toLowerCase()}.yml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [workflowName, nodes, edges]);

  // Delete selected node/edge
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        if (selectedNode) {
          pushHistory(nodes, edges);
          setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
          setEdges((eds) => eds.filter((ed) => ed.source !== selectedNode.id && ed.target !== selectedNode.id));
          setSelectedNode(null);
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        undo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedNode, nodes, edges, pushHistory, setNodes, setEdges, undo, handleSave]);

  const runningCount = useMemo(
    () => nodes.filter((n) => (n.data as WorkflowNodeData).status === "active").length,
    [nodes]
  );
  const completeCount = useMemo(
    () => nodes.filter((n) => (n.data as WorkflowNodeData).status === "complete").length,
    [nodes]
  );
  const failedCount = useMemo(
    () => nodes.filter((n) => (n.data as WorkflowNodeData).status === "failed").length,
    [nodes]
  );

  return (
    <div className="flex flex-col h-full w-full bg-zinc-50 dark:bg-zinc-950 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <Workflow className="w-5 h-5 text-violet-500 flex-shrink-0" />
          <Input
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            className="h-8 w-44 text-sm font-medium border-zinc-200 dark:border-zinc-700"
            disabled={readOnly}
          />
        </div>

        <div className="flex items-center gap-1.5 ml-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSave}
            disabled={readOnly}
            className="h-8 gap-1.5 text-xs"
          >
            <Save className="w-3.5 h-3.5" />
            Save
          </Button>

          <Button
            size="sm"
            onClick={handleRun}
            disabled={isRunning || readOnly}
            className={cn(
              "h-8 gap-1.5 text-xs",
              isRunning
                ? "bg-amber-500 hover:bg-amber-600"
                : "bg-emerald-600 hover:bg-emerald-700"
            )}
          >
            {isRunning ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Running…
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                Run
              </>
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={readOnly || isRunning}
            className="h-8 gap-1.5 text-xs text-zinc-500 hover:text-rose-600"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowTemplates(true)}
            className="h-8 gap-1.5 text-xs"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            Templates
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleExportYaml}
            className="h-8 gap-1.5 text-xs text-zinc-500"
          >
            <Download className="w-3.5 h-3.5" />
            YAML
          </Button>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => zoomIn()} className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors">
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => zoomOut()} className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors">
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => fitView({ padding: 0.2 })} className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors">
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Execution status */}
        {isRunning && (
          <div className="flex items-center gap-3 text-xs text-zinc-500 ml-2">
            <span className="flex items-center gap-1">
              <motion.span animate={{ scale: [1, 1.3, 1] }} transition={{ repeat: Infinity, duration: 0.8 }} className="block w-2 h-2 rounded-full bg-blue-400" />
              {runningCount} active
            </span>
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              {completeCount} done
            </span>
            {failedCount > 0 && (
              <span className="flex items-center gap-1 text-rose-500">
                <AlertTriangle className="w-3 h-3" />
                {failedCount} failed
              </span>
            )}
          </div>
        )}
      </div>

      {/* Main area */}
      <div className="flex flex-1 min-h-0 relative">
        {/* Left palette */}
        <div className="w-56 flex-shrink-0 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 flex flex-col">
          <div className="px-3 py-2.5 border-b border-zinc-100 dark:border-zinc-800">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-zinc-400">
              Node Palette
            </p>
            <p className="text-[10px] text-zinc-400 mt-0.5">Drag onto canvas</p>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {PALETTE.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.type}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("application/reactflow-type", item.type);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    className={cn(
                      "flex items-center gap-2.5 p-2.5 rounded-lg border cursor-grab active:cursor-grabbing transition-all",
                      item.bg,
                      item.border,
                      "hover:shadow-sm hover:scale-[1.02]"
                    )}
                  >
                    <div className="w-7 h-7 rounded-lg bg-white dark:bg-zinc-900 shadow-sm flex items-center justify-center flex-shrink-0">
                      <Icon className={cn("w-3.5 h-3.5", item.color)} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-100 leading-tight">
                        {item.label}
                      </p>
                      <p className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-tight mt-0.5 truncate">
                        {item.description}
                      </p>
                    </div>
                  </div>
                );
              })}

              {/* Start / End special items */}
              <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 mt-2 space-y-1">
                {(["start", "end"] as const).map((type) => {
                  const isStart = type === "start";
                  return (
                    <div
                      key={type}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("application/reactflow-type", type);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      className={cn(
                        "flex items-center gap-2.5 p-2.5 rounded-lg border cursor-grab active:cursor-grabbing transition-all",
                        isStart
                          ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700"
                          : "bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-700",
                        "hover:shadow-sm hover:scale-[1.02]"
                      )}
                    >
                      <div className={cn(
                        "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0",
                        isStart ? "bg-emerald-500" : "bg-rose-500"
                      )}>
                        {isStart ? <Play className="w-3.5 h-3.5 text-white ml-0.5" /> : <Square className="w-3.5 h-3.5 text-white" />}
                      </div>
                      <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                        {isStart ? "Start" : "End"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </ScrollArea>

          {/* Keyboard hints */}
          <div className="px-3 py-2.5 border-t border-zinc-100 dark:border-zinc-800 space-y-1">
            {[
              ["Del", "Delete node"],
              ["⌘Z", "Undo"],
              ["⌘S", "Save"],
            ].map(([key, label]) => (
              <div key={key} className="flex items-center justify-between text-[10px] text-zinc-400">
                <span>{label}</span>
                <kbd className="px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono text-[10px] border border-zinc-200 dark:border-zinc-700">
                  {key}
                </kbd>
              </div>
            ))}
          </div>
        </div>

        {/* ReactFlow canvas */}
        <div ref={reactFlowWrapper} className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            deleteKeyCode={null} // handle manually
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#d1d5db" />
            <Controls showInteractive={false} className="!shadow-md" />
            <MiniMap
              nodeStrokeWidth={2}
              zoomable
              pannable
              className="!bg-white dark:!bg-zinc-800 !border !border-zinc-200 dark:!border-zinc-700 !rounded-xl !shadow-md"
            />
          </ReactFlow>

          {/* Hint when canvas is empty */}
          {nodes.length <= 2 && edges.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="flex flex-col items-center gap-2 text-center opacity-40">
                <Workflow className="w-10 h-10 text-zinc-400" />
                <p className="text-sm font-medium text-zinc-500">
                  Drag nodes from the palette
                </p>
                <p className="text-xs text-zinc-400">or load a template to get started</p>
              </div>
            </div>
          )}
        </div>

        {/* Right config panel */}
        <AnimatePresence>
          {selectedNode && (
            <ConfigPanel
              key={selectedNode.id}
              node={selectedNode}
              onUpdate={updateNode}
              onClose={() => setSelectedNode(null)}
              readOnly={readOnly}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Template gallery */}
      <TemplateGallery
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
        onSelect={loadTemplate}
      />
    </div>
  );
}

// ─── Exported component (wraps with ReactFlowProvider) ───────────────────────

export const WorkflowBuilder = memo((props: WorkflowBuilderProps) => (
  <ReactFlowProvider>
    <WorkflowBuilderInner {...props} />
  </ReactFlowProvider>
));
WorkflowBuilder.displayName = "WorkflowBuilder";

export default WorkflowBuilder;
