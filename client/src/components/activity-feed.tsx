import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  Globe,
  Sparkles,
  Code,
  FileText,
  Database,
  Shield,
  ShieldCheck,
  ShieldX,
  Mail,
  Search,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Check,
  Loader2,
  XCircle,
  RefreshCw,
  Square,
  Play,
  Eye,
  Download,
  ExternalLink,
  Clock,
  Zap,
  Bot,
  Terminal,
  FileSpreadsheet,
  Image,
  Video,
  Music,
  PanelRightClose,
  PanelRightOpen,
  Link2,
  BookOpen,
  Save,
  HardDrive,
  Users,
  UserCheck,
  Presentation,
  FileType,
  AlertCircle,
  CheckCircle2,
  Timer,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  useAgentTraceStore,
  type TraceStep,
  type TraceRun,
  type TraceArtifact,
  type TraceToolCall,
  type TraceCitation,
  type TraceVerification,
  type TraceAgent,
  type TraceMemoryEvent,
  type TraceProgress,
} from "@/stores/agentTraceStore";
import { useAgentStore } from "@/stores/agent-store";

export function useActivityFeed(messageId?: string | null) {
  const { subscribeToRun, unsubscribeFromRun, runs, activeRunId, isConnected } = useAgentTraceStore();
  const agentStoreRuns = useAgentStore((state) => state.runs);

  const activeRun = useMemo(() => {
    if (messageId) {
      const agentRun = agentStoreRuns[messageId];
      return agentRun?.runId || null;
    }

    const activeRuns = Object.values(agentStoreRuns).filter(
      (run) => run.runId && ['starting', 'queued', 'planning', 'running', 'verifying'].includes(run.status)
    );
    return activeRuns[0]?.runId || null;
  }, [messageId, agentStoreRuns]);

  const hasActiveRun = useMemo(() => {
    return Object.values(agentStoreRuns).some(
      (run) => run.runId && ['starting', 'queued', 'planning', 'running', 'verifying'].includes(run.status)
    );
  }, [agentStoreRuns]);

  useEffect(() => {
    if (!activeRun) return;

    subscribeToRun(activeRun);

    return () => {
      unsubscribeFromRun(activeRun);
    };
  }, [activeRun, subscribeToRun, unsubscribeFromRun]);

  const traceRun = activeRun ? runs.get(activeRun) : null;

  return {
    runId: activeRun,
    run: traceRun,
    hasActiveRun,
    isConnected,
  };
}

const AGENT_CONFIG: Record<string, { icon: typeof Brain; color: string; label: string }> = {
  OrchestratorAgent: { icon: Zap, color: "text-purple-500", label: "Orquestador" },
  ResearchAgent: { icon: Search, color: "text-blue-500", label: "Investigador" },
  CodeAgent: { icon: Code, color: "text-green-500", label: "Código" },
  DataAgent: { icon: BarChart3, color: "text-orange-500", label: "Datos" },
  ContentAgent: { icon: FileText, color: "text-pink-500", label: "Contenido" },
  CommunicationAgent: { icon: Mail, color: "text-cyan-500", label: "Comunicación" },
  BrowserAgent: { icon: Globe, color: "text-indigo-500", label: "Navegador" },
  DocumentAgent: { icon: FileText, color: "text-amber-500", label: "Documentos" },
  QAAgent: { icon: Shield, color: "text-emerald-500", label: "Verificador" },
  SecurityAgent: { icon: Shield, color: "text-red-500", label: "Seguridad" },
  default: { icon: Bot, color: "text-primary", label: "Agente" },
};

const TOOL_ICONS: Record<string, typeof Terminal> = {
  shell: Terminal,
  code_execute: Terminal,
  search_web: Search,
  search: Search,
  fetch_url: Globe,
  fetch: Globe,
  browser_navigate: Globe,
  browser: Globe,
  generate_image: Image,
  generate_video: Video,
  generate_audio: Music,
  doc_create: FileText,
  spreadsheet_create: FileSpreadsheet,
  data_analyze: BarChart3,
  data_visualize: BarChart3,
  db_query: Database,
  code_generate: Code,
  code_review: Code,
};

function normalizeToolName(toolName: string): string {
  const normalizedMappings: Record<string, string> = {
    "fetch-url": "fetch_url",
    "search-web": "search_web",
    "browser-navigate": "browser_navigate",
    "code-execute": "code_execute",
    "generate-image": "generate_image",
    "generate-video": "generate_video",
    "generate-audio": "generate_audio",
    "doc-create": "doc_create",
    "spreadsheet-create": "spreadsheet_create",
    "data-analyze": "data_analyze",
    "data-visualize": "data_visualize",
    "db-query": "db_query",
    "code-generate": "code_generate",
    "code-review": "code_review",
  };

  if (normalizedMappings[toolName]) {
    return normalizedMappings[toolName];
  }

  const underscored = toolName.replace(/-/g, "_");
  if (TOOL_ICONS[underscored]) {
    return underscored;
  }

  return toolName;
}

function getToolIcon(toolName: string): typeof Terminal {
  const normalized = normalizeToolName(toolName);
  return TOOL_ICONS[normalized] || Wrench;
}

const STATUS_CONFIG: Record<string, { icon: typeof Clock; color: string; bg: string; label: string; animate?: boolean }> = {
  pending: { icon: Clock, color: "text-muted-foreground", bg: "bg-muted", label: "Pendiente" },
  running: { icon: Loader2, color: "text-blue-500", bg: "bg-blue-500/10", label: "Ejecutando", animate: true },
  completed: { icon: Check, color: "text-green-500", bg: "bg-green-500/10", label: "Completado" },
  failed: { icon: XCircle, color: "text-red-500", bg: "bg-red-500/10", label: "Fallido" },
  retrying: { icon: RefreshCw, color: "text-amber-500", bg: "bg-amber-500/10", label: "Reintentando", animate: true },
  cancelled: { icon: Square, color: "text-muted-foreground", bg: "bg-muted", label: "Cancelado" },
};

const PHASE_CONFIG = {
  planning: { icon: Brain, color: "text-purple-500", label: "Planificando", progress: 15 },
  executing: { icon: Sparkles, color: "text-blue-500", label: "Ejecutando", progress: 50 },
  verifying: { icon: Shield, color: "text-emerald-500", label: "Verificando", progress: 85 },
  completed: { icon: Check, color: "text-green-500", label: "Completado", progress: 100 },
  failed: { icon: XCircle, color: "text-red-500", label: "Error", progress: 0 },
  cancelled: { icon: Square, color: "text-muted-foreground", label: "Cancelado", progress: 0 },
};

interface StepCardProps {
  step: TraceStep;
  runId: string;
  isActive: boolean;
}

function StepCard({ step, runId, isActive }: StepCardProps) {
  const { toggleStepExpanded } = useAgentTraceStore();
  const statusConfig = STATUS_CONFIG[step.status];
  const StatusIcon = statusConfig.icon;
  const ToolIcon = getToolIcon(step.toolName);

  const duration = useMemo(() => {
    if (!step.startedAt) return null;
    const end = step.completedAt || Date.now();
    return end - step.startedAt;
  }, [step.startedAt, step.completedAt]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <Collapsible open={step.isExpanded}>
        <div
          className={cn(
            "border rounded-lg overflow-hidden transition-all",
            isActive && "border-blue-500/50 shadow-sm shadow-blue-500/20",
            step.status === "failed" && "border-red-500/50",
            step.status === "completed" && "border-green-500/30"
          )}
        >
          <CollapsibleTrigger asChild>
            <button
              onClick={() => toggleStepExpanded(runId, step.index)}
              className={cn(
                "w-full flex items-center gap-3 p-3 hover:bg-accent/50 transition-colors text-left",
                statusConfig.bg
              )}
              data-testid={`step-trigger-${step.index}`}
            >
              <div className={cn("p-1.5 rounded-md", statusConfig.bg)}>
                <ToolIcon className={cn("h-4 w-4", statusConfig.color)} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{step.toolName}</span>
                  <StatusIcon
                    className={cn(
                      "h-3.5 w-3.5 flex-shrink-0",
                      statusConfig.color,
                      statusConfig.animate && "animate-spin"
                    )}
                  />
                </div>
                <p className="text-xs text-muted-foreground truncate">{step.description}</p>
              </div>
              <div className="flex items-center gap-2">
                {duration && (
                  <span className="text-xs text-muted-foreground">
                    {formatDuration(duration)}
                  </span>
                )}
                {step.isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="border-t p-3 space-y-3 bg-background/50">
              {step.output && (
                <div className="text-xs">
                  <div className="font-medium mb-1 text-muted-foreground">Output:</div>
                  <pre className="bg-muted p-2 rounded text-xs overflow-x-auto max-h-40 whitespace-pre-wrap">
                    {typeof step.output === "string" ? step.output : JSON.stringify(step.output, null, 2)}
                  </pre>
                </div>
              )}

              {step.error && (
                <div className="text-xs">
                  <div className="font-medium mb-1 text-red-500">Error:</div>
                  <pre className="bg-red-500/10 text-red-500 p-2 rounded text-xs overflow-x-auto">
                    {step.error}
                  </pre>
                </div>
              )}

              {step.artifacts.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">Artefactos:</div>
                  <div className="flex flex-wrap gap-2">
                    {step.artifacts.map((artifact, i) => (
                      <ArtifactCard key={i} artifact={artifact} compact />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </motion.div>
  );
}

interface ArtifactCardProps {
  artifact: TraceArtifact;
  compact?: boolean;
}

function ArtifactCard({ artifact, compact = false }: ArtifactCardProps) {
  const getArtifactIcon = (type: string) => {
    switch (type) {
      case "file": case "document": return FileText;
      case "image": return Image;
      case "video": return Video;
      case "audio": return Music;
      case "spreadsheet": return FileSpreadsheet;
      case "code": return Code;
      case "chart": return BarChart3;
      default: return FileText;
    }
  };

  const Icon = getArtifactIcon(artifact.type);

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            // FRONTEND FIX #36: Add noopener,noreferrer to prevent window.opener attacks
            onClick={() => artifact.url && window.open(artifact.url, "_blank", "noopener,noreferrer")}
            data-testid={`artifact-${artifact.name}`}
          >
            <Icon className="h-3 w-3" />
            <span className="truncate max-w-[100px]">{artifact.name}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{artifact.name}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Card className="overflow-hidden" data-testid={`artifact-card-${artifact.name}`}>
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{artifact.name}</p>
            <p className="text-xs text-muted-foreground capitalize">{artifact.type}</p>
          </div>
          <div className="flex gap-1">
            {artifact.url && (
              <>
                <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                  <a href={artifact.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${artifact.name}`}>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                  <a href={artifact.url} download aria-label={`Descargar ${artifact.name}`}>
                    <Download className="h-3.5 w-3.5" />
                  </a>
                </Button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface PlanDisplayProps {
  run: TraceRun;
}

function PlanDisplay({ run }: PlanDisplayProps) {
  if (!run.plan) return null;

  const completedSteps = run.steps.filter(s => s.status === "completed").length;
  const totalSteps = run.steps.length;
  const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  return (
    <Card className="border-dashed" data-testid="plan-display">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-purple-500" />
            <span className="font-medium text-sm">Plan de Ejecución</span>
          </div>
          <Badge variant="outline" className="text-xs">
            {completedSteps}/{totalSteps} pasos
          </Badge>
        </div>

        <p className="text-sm text-muted-foreground">{run.plan.objective}</p>

        <Progress value={progress} className="h-1.5" />

        <div className="space-y-1.5">
          {run.plan.steps.map((step, i) => {
            const runStep = run.steps[i];
            const status = runStep?.status || "pending";
            const config = STATUS_CONFIG[status];
            const Icon = config.icon;

            return (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-2 text-sm py-1",
                  status === "completed" && "opacity-60"
                )}
              >
                <Icon
                  className={cn(
                    "h-3.5 w-3.5 flex-shrink-0",
                    config.color,
                    config.animate && "animate-spin"
                  )}
                />
                <span className="flex-1 truncate">{step.description || step.toolName}</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

interface ActiveAgentDisplayProps {
  agentName: string;
  toolName?: string;
}

function ActiveAgentDisplay({ agentName, toolName }: ActiveAgentDisplayProps) {
  const config = AGENT_CONFIG[agentName] || AGENT_CONFIG.default;
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex items-center gap-3 p-3 rounded-lg bg-gradient-to-r from-primary/5 to-primary/10 border"
      data-testid="active-agent"
    >
      <div className={cn("p-2 rounded-full bg-background", config.color)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{config.label}</span>
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
        </div>
        {toolName && (
          <p className="text-xs text-muted-foreground">
            Ejecutando: <span className="font-mono">{toolName}</span>
          </p>
        )}
      </div>
    </motion.div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ToolTimelineCardProps {
  toolCalls: TraceToolCall[];
}

function ToolTimelineCard({ toolCalls }: ToolTimelineCardProps) {
  if (!toolCalls.length) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-1.5"
      data-testid="tool-timeline"
    >
      <div className="flex items-center gap-2 mb-2">
        <Timer className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Tool Calls
        </span>
      </div>
      <div className="relative">
        <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-border" />
        {toolCalls.map((tool, i) => {
          const isSuccess = tool.status === 'succeeded';
          const isFailed = tool.status === 'failed';
          const isRunning = tool.status === 'started' || tool.status === 'running';
          const ToolIcon = getToolIcon(tool.toolName);

          return (
            <motion.div
              key={`${tool.toolName}-${i}`}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-start gap-3 relative pl-5 py-1.5"
            >
              <div className={cn(
                "absolute left-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full flex items-center justify-center z-10",
                isSuccess && "bg-green-500",
                isFailed && "bg-red-500",
                isRunning && "bg-blue-500 animate-pulse",
                !isSuccess && !isFailed && !isRunning && "bg-muted-foreground"
              )}>
                {isSuccess && <Check className="h-2 w-2 text-white" />}
                {isFailed && <XCircle className="h-2 w-2 text-white" />}
                {isRunning && <Loader2 className="h-2 w-2 text-white animate-spin" />}
              </div>

              <div className="flex-1 min-w-0 flex items-center gap-2">
                <ToolIcon className={cn(
                  "h-3.5 w-3.5 flex-shrink-0",
                  isSuccess && "text-green-500",
                  isFailed && "text-red-500",
                  isRunning && "text-blue-500",
                  !isSuccess && !isFailed && !isRunning && "text-muted-foreground"
                )} />
                <span className={cn(
                  "text-xs font-medium truncate",
                  isFailed && "text-red-500"
                )}>
                  {tool.toolName}
                </span>
                {tool.durationMs && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                    {formatDuration(tool.durationMs)}
                  </Badge>
                )}
              </div>

              {tool.error && (
                <Tooltip>
                  <TooltipTrigger>
                    <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs">
                    <p className="text-xs text-red-500">{tool.error}</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

interface CitationsPanelProps {
  citations: TraceCitation[];
}

function CitationsPanel({ citations }: CitationsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!citations.length) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-between p-2 h-auto"
          data-testid="citations-panel-trigger"
        >
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-blue-500" />
            <span className="text-sm font-medium">Sources & Citations</span>
            <Badge variant="secondary" className="text-xs">
              {citations.length}
            </Badge>
          </div>
          {isOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-2 pt-2"
        >
          {citations.map((citation, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-start gap-2 p-2 rounded-md bg-muted/50 hover:bg-muted transition-colors"
              data-testid={`citation-${i}`}
            >
              {citation.favicon ? (
                <img
                  src={citation.favicon}
                  alt=""
                  className="w-4 h-4 rounded-sm flex-shrink-0 mt-0.5"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : (
                <Link2 className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <a
                  href={citation.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-primary hover:underline truncate block"
                >
                  {citation.source}
                </a>
                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                  {citation.text}
                </p>
                {citation.page && (
                  <span className="text-[10px] text-muted-foreground">
                    Page {citation.page}
                  </span>
                )}
              </div>
              {citation.url && (
                <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
                  <a href={citation.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir fuente: ${citation.source}`}>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </Button>
              )}
            </motion.div>
          ))}
        </motion.div>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface VerificationBadgeProps {
  verifications: TraceVerification[];
}

function VerificationBadge({ verifications }: VerificationBadgeProps) {
  if (!verifications.length) return null;

  const lastVerification = verifications[verifications.length - 1];
  const passedCount = verifications.filter(v => v.passed).length;
  const failedCount = verifications.filter(v => !v.passed).length;
  const allPassed = failedCount === 0;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg border",
        allPassed
          ? "bg-green-500/5 border-green-500/30"
          : "bg-red-500/5 border-red-500/30"
      )}
      data-testid="verification-badge"
    >
      <div className={cn(
        "p-2 rounded-full",
        allPassed ? "bg-green-500/10" : "bg-red-500/10"
      )}>
        {allPassed ? (
          <ShieldCheck className="h-5 w-5 text-green-500" />
        ) : (
          <ShieldX className="h-5 w-5 text-red-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn(
            "font-medium text-sm",
            allPassed ? "text-green-600" : "text-red-600"
          )}>
            {allPassed ? "Verification Passed" : "Verification Failed"}
          </span>
          <div className="flex items-center gap-1">
            {passedCount > 0 && (
              <Badge className="bg-green-500/20 text-green-600 text-[10px] px-1">
                {passedCount} passed
              </Badge>
            )}
            {failedCount > 0 && (
              <Badge className="bg-red-500/20 text-red-600 text-[10px] px-1">
                {failedCount} failed
              </Badge>
            )}
          </div>
        </div>
        {lastVerification.message && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {lastVerification.message}
          </p>
        )}
      </div>
    </motion.div>
  );
}

interface AgentDelegationCardProps {
  activeAgent: TraceAgent | null;
  delegatedAgents: TraceAgent[];
}

function AgentDelegationCard({ activeAgent, delegatedAgents }: AgentDelegationCardProps) {
  if (!activeAgent && !delegatedAgents.length) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-2"
      data-testid="agent-delegation"
    >
      {activeAgent && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex items-center gap-3 p-3 rounded-lg bg-gradient-to-r from-primary/5 to-primary/10 border"
        >
          {(() => {
            const config = AGENT_CONFIG[activeAgent.name] || AGENT_CONFIG.default;
            const Icon = config.icon;
            return (
              <>
                <div className={cn("p-2 rounded-full bg-background", config.color)}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{config.label}</span>
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                    </span>
                  </div>
                  {activeAgent.role && (
                    <p className="text-xs text-muted-foreground">{activeAgent.role}</p>
                  )}
                </div>
              </>
            );
          })()}
        </motion.div>
      )}

      {delegatedAgents.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {delegatedAgents.map((agent, i) => {
            const config = AGENT_CONFIG[agent.name] || AGENT_CONFIG.default;
            const isCompleted = agent.status === 'completed';
            const Icon = config.icon;

            return (
              <Tooltip key={i}>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs",
                      isCompleted
                        ? "bg-green-500/10 text-green-600"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    <span>{config.label}</span>
                    {isCompleted && <UserCheck className="h-3 w-3" />}
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {agent.role || config.label} - {agent.status || 'active'}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

interface ProgressDisplayProps {
  progress: TraceProgress | null;
  phase: string;
}

function ProgressDisplay({ progress, phase }: ProgressDisplayProps) {
  const phaseConfig = PHASE_CONFIG[phase as keyof typeof PHASE_CONFIG] || PHASE_CONFIG.executing;
  const PhaseIcon = phaseConfig.icon;

  const percentage = progress?.percentage ??
    (progress?.total ? Math.round((progress.current / progress.total) * 100) : phaseConfig.progress);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-2"
      data-testid="progress-display"
    >
      <div className="flex items-center gap-2">
        <PhaseIcon className={cn("h-4 w-4", phaseConfig.color)} />
        <span className="text-sm font-medium">{phaseConfig.label}</span>
        <span className="text-xs text-muted-foreground ml-auto">
          {percentage}%
        </span>
      </div>

      <div className="relative h-2 bg-muted rounded-full overflow-hidden">
        <motion.div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            phase === 'completed' ? "bg-green-500" : "bg-primary"
          )}
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
        {(phase === 'planning' || phase === 'executing' || phase === 'verifying') && (
          <motion.div
            className="absolute inset-y-0 w-20 bg-gradient-to-r from-transparent via-white/20 to-transparent"
            animate={{ x: ["-80px", "200%"] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
          />
        )}
      </div>

      {progress?.message && (
        <p className="text-xs text-muted-foreground">{progress.message}</p>
      )}

      {progress && progress.total > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Step {progress.current} of {progress.total}</span>
        </div>
      )}
    </motion.div>
  );
}

interface MemoryEventCardProps {
  memoryEvents: TraceMemoryEvent[];
}

function MemoryEventCard({ memoryEvents }: MemoryEventCardProps) {
  if (!memoryEvents.length) return null;

  const recentEvents = memoryEvents.slice(-3);

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-1.5"
      data-testid="memory-events"
    >
      <div className="flex items-center gap-2 mb-2">
        <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Memory Events
        </span>
      </div>

      <div className="space-y-1">
        {recentEvents.map((event, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className={cn(
              "flex items-center gap-2 px-2 py-1.5 rounded-md text-xs",
              event.type === 'loaded' ? "bg-blue-500/5" : "bg-green-500/5"
            )}
          >
            {event.type === 'loaded' ? (
              <Database className="h-3 w-3 text-blue-500" />
            ) : (
              <Save className="h-3 w-3 text-green-500" />
            )}
            <span className={cn(
              "font-medium",
              event.type === 'loaded' ? "text-blue-600" : "text-green-600"
            )}>
              {event.type === 'loaded' ? 'Loaded' : 'Saved'}
            </span>
            {event.keys && event.keys.length > 0 && (
              <span className="text-muted-foreground truncate flex-1">
                {event.keys.slice(0, 2).join(', ')}
                {event.keys.length > 2 && ` +${event.keys.length - 2} more`}
              </span>
            )}
            {event.count !== undefined && (
              <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                {event.count} items
              </Badge>
            )}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

interface EnhancedArtifactCardProps {
  artifact: TraceArtifact;
}

function EnhancedArtifactCard({ artifact }: EnhancedArtifactCardProps) {
  const getArtifactIcon = (type: string) => {
    switch (type) {
      case "presentation": return Presentation;
      case "document": case "file": return FileText;
      case "spreadsheet": return FileSpreadsheet;
      case "image": return Image;
      case "video": return Video;
      case "audio": return Music;
      case "code": return Code;
      case "chart": return BarChart3;
      default: return FileType;
    }
  };

  const Icon = getArtifactIcon(artifact.type);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
      data-testid={`enhanced-artifact-${artifact.name}`}
    >
      <div className="p-2 bg-primary/10 rounded-lg">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{artifact.name}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="capitalize">{artifact.type}</span>
          {artifact.mimeType && (
            <>
              <span>•</span>
              <span>{artifact.mimeType.split('/')[1]?.toUpperCase()}</span>
            </>
          )}
          {artifact.size && (
            <>
              <span>•</span>
              <span>{formatBytes(artifact.size)}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex gap-1">
        {artifact.url && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                  <a href={artifact.url} target="_blank" rel="noopener noreferrer" aria-label={`Ver ${artifact.name}`}>
                    <Eye className="h-4 w-4" />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>View</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                  <a href={artifact.url} download={artifact.name} aria-label={`Descargar ${artifact.name}`}>
                    <Download className="h-4 w-4" />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Download</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </motion.div>
  );
}

interface ActivityFeedProps {
  runId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
}

export function ActivityFeed({ runId, isOpen, onClose, onCancel, onRetry }: ActivityFeedProps) {
  const {
    runs,
    activeRunId,
    isConnected,
    subscribeToRun,
    unsubscribeFromRun,
    getActiveRun,
  } = useAgentTraceStore();

  const run = runId ? runs.get(runId) : getActiveRun();
  const phaseConfig = run ? PHASE_CONFIG[run.phase] : null;
  const PhaseIcon = phaseConfig?.icon || Brain;

  const scrollEndRef = useRef<HTMLDivElement>(null);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

  useEffect(() => {
    if (runId && isOpen) {
      subscribeToRun(runId);
      return () => unsubscribeFromRun(runId);
    }
  }, [runId, isOpen, subscribeToRun, unsubscribeFromRun]);

  useEffect(() => {
    if (autoScrollEnabled && scrollEndRef.current) {
      scrollEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [run?.steps.length, run?.artifacts.length, run?.verifications.length, autoScrollEnabled]);

  const activeStep = useMemo(() => {
    if (!run) return null;
    return run.steps.find(s => s.status === "running");
  }, [run]);

  const activeAgentName = useMemo(() => {
    if (!run || !activeStep) return null;
    const toolEvent = activeStep.events.find(e => e.metadata?.agentName);
    return toolEvent?.metadata?.agentName || "OrchestratorAgent";
  }, [run, activeStep]);

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="h-full flex flex-col border-l bg-background/95 backdrop-blur w-80"
      data-testid="activity-feed"
    >
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm">Actividad del Agente</h3>
          {isConnected && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-7 w-7"
          data-testid="button-close-activity-feed"
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {!run ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Bot className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">
                Sin actividad de agente activa
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Envía un mensaje complejo para activar el modo agente
              </p>
            </div>
          ) : (
            <>
              <ProgressDisplay progress={run.progress} phase={run.phase} />

              <AgentDelegationCard
                activeAgent={run.activeAgent}
                delegatedAgents={run.delegatedAgents}
              />

              {activeAgentName && activeStep && !run.activeAgent && (
                <ActiveAgentDisplay
                  agentName={activeAgentName}
                  toolName={activeStep.toolName}
                />
              )}

              <PlanDisplay run={run} />

              {run.memoryEvents.length > 0 && (
                <MemoryEventCard memoryEvents={run.memoryEvents} />
              )}

              {run.steps.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Pasos de Ejecución
                    </h4>
                  </div>
                  <AnimatePresence mode="popLayout">
                    {run.steps.map((step, i) => (
                      <div key={`${run.runId}-step-${i}`} className="space-y-2">
                        <StepCard
                          step={step}
                          runId={run.runId}
                          isActive={step.status === "running"}
                        />
                        {step.toolCalls.length > 0 && step.isExpanded && (
                          <div className="ml-4 border-l-2 border-muted pl-3">
                            <ToolTimelineCard toolCalls={step.toolCalls} />
                          </div>
                        )}
                      </div>
                    ))}
                  </AnimatePresence>
                </div>
              )}

              {run.citations.length > 0 && (
                <CitationsPanel citations={run.citations} />
              )}

              {run.verifications.length > 0 && (
                <VerificationBadge verifications={run.verifications} />
              )}

              {run.artifacts.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Artefactos Generados
                  </h4>
                  <div className="space-y-2">
                    {run.artifacts.map((artifact, i) => (
                      <EnhancedArtifactCard key={i} artifact={artifact} />
                    ))}
                  </div>
                </div>
              )}

              {run.summary && run.status === "completed" && (
                <Card className="border-green-500/30 bg-green-500/5">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span className="font-medium text-sm">Completado</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{run.summary}</p>
                  </CardContent>
                </Card>
              )}

              {run.error && run.status === "failed" && (
                <Card className="border-red-500/30 bg-red-500/5">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <XCircle className="h-4 w-4 text-red-500" />
                      <span className="font-medium text-sm text-red-500">Error</span>
                    </div>
                    <p className="text-sm text-red-500/80">{run.error}</p>
                  </CardContent>
                </Card>
              )}

              {(run.status === "planning" || run.status === "running") && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center gap-2 p-3 rounded-lg bg-muted/50"
                  data-testid="running-indicator"
                >
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">
                    {run.status === "planning" ? "Creando plan..." : "Ejecutando pasos..."}
                  </span>
                </motion.div>
              )}

              <div ref={scrollEndRef} />
            </>
          )}
        </div>
      </ScrollArea>

      {run && (run.status === "planning" || run.status === "running" || run.status === "verifying") && (
        <div className="p-3 border-t flex gap-2">
          {onCancel && (
            <Button
              variant="destructive"
              size="sm"
              onClick={onCancel}
              className="flex-1"
              data-testid="button-cancel-run"
            >
              <Square className="h-3.5 w-3.5 mr-1.5" />
              Cancelar
            </Button>
          )}
        </div>
      )}

      {run && run.status === "failed" && onRetry && (
        <div className="p-3 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="w-full"
            data-testid="button-retry-run"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Reintentar
          </Button>
        </div>
      )}
    </motion.div>
  );
}

export function ActivityFeedToggle({
  isOpen,
  onToggle,
  hasActivity,
}: {
  isOpen: boolean;
  onToggle: () => void;
  hasActivity: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          className="relative"
          data-testid="button-toggle-activity-feed"
        >
          {isOpen ? (
            <PanelRightClose className="h-4 w-4" />
          ) : (
            <PanelRightOpen className="h-4 w-4" />
          )}
          {hasActivity && !isOpen && (
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 bg-blue-500 rounded-full animate-pulse" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">
        {isOpen ? "Cerrar panel de actividad" : "Ver actividad del agente"}
      </TooltipContent>
    </Tooltip>
  );
}

interface ActivityFeedConnectorProps {
  messageId?: string | null;
  onCancel?: () => void;
  onRetry?: () => void;
  autoOpen?: boolean;
}

export function ActivityFeedConnector({
  messageId,
  onCancel,
  onRetry,
  autoOpen = true,
}: ActivityFeedConnectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { runId, run, hasActiveRun, isConnected } = useActivityFeed(messageId);

  useEffect(() => {
    if (autoOpen && hasActiveRun && !isOpen) {
      setIsOpen(true);
    }
  }, [autoOpen, hasActiveRun, isOpen]);

  useEffect(() => {
    if (run?.status === 'completed' || run?.status === 'failed' || run?.status === 'cancelled') {
      const timer = setTimeout(() => {
        setIsOpen(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [run?.status]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  return (
    <>
      <ActivityFeedToggle
        isOpen={isOpen}
        onToggle={handleToggle}
        hasActivity={hasActiveRun}
      />
      <AnimatePresence>
        {isOpen && (
          <ActivityFeed
            runId={runId}
            isOpen={isOpen}
            onClose={handleClose}
            onCancel={onCancel}
            onRetry={onRetry}
          />
        )}
      </AnimatePresence>
    </>
  );
}
