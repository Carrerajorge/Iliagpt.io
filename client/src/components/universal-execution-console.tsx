import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  FileJson,
  FileCode,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  Presentation,
  File,
  Wrench,
  Search,
  Zap,
  GitBranch,
  Cog,
  Package,
  Sparkles,
  LayoutList,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type {
  RunState,
  Plan,
  Step,
  StepStatus,
  StepKind,
  ToolCall,
  ToolCallStatus,
  Artifact,
  ArtifactKind,
  ArtifactStatus,
} from "@shared/executionProtocol";

interface UniversalExecutionConsoleProps {
  runState: RunState;
  onArtifactDownload?: (artifact: Artifact) => void;
  className?: string;
}

const stepKindIcons: Record<StepKind, React.ReactNode> = {
  plan: <LayoutList className="w-3.5 h-3.5" />,
  research: <Search className="w-3.5 h-3.5" />,
  execute: <Zap className="w-3.5 h-3.5" />,
  validate: <CheckCircle2 className="w-3.5 h-3.5" />,
  generate: <Sparkles className="w-3.5 h-3.5" />,
  transform: <GitBranch className="w-3.5 h-3.5" />,
  aggregate: <Package className="w-3.5 h-3.5" />,
  deliver: <Download className="w-3.5 h-3.5" />,
  custom: <Cog className="w-3.5 h-3.5" />,
};

const stepKindLabels: Record<StepKind, string> = {
  plan: "Plan",
  research: "Research",
  execute: "Execute",
  validate: "Validate",
  generate: "Generate",
  transform: "Transform",
  aggregate: "Aggregate",
  deliver: "Deliver",
  custom: "Custom",
};

const artifactKindIcons: Record<ArtifactKind, React.ReactNode> = {
  excel: <FileSpreadsheet className="w-4 h-4" />,
  word: <FileText className="w-4 h-4" />,
  pdf: <FileText className="w-4 h-4" />,
  csv: <FileSpreadsheet className="w-4 h-4" />,
  json: <FileJson className="w-4 h-4" />,
  image: <FileImage className="w-4 h-4" />,
  video: <FileVideo className="w-4 h-4" />,
  audio: <FileAudio className="w-4 h-4" />,
  archive: <FileArchive className="w-4 h-4" />,
  code: <FileCode className="w-4 h-4" />,
  text: <FileText className="w-4 h-4" />,
  markdown: <FileText className="w-4 h-4" />,
  html: <FileCode className="w-4 h-4" />,
  presentation: <Presentation className="w-4 h-4" />,
  custom: <File className="w-4 h-4" />,
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StepStatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "running":
      return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
    case "completed":
      return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    case "failed":
      return <XCircle className="w-4 h-4 text-red-500" />;
    case "skipped":
      return <Clock className="w-4 h-4 text-muted-foreground opacity-50" />;
    case "cancelled":
      return <XCircle className="w-4 h-4 text-muted-foreground" />;
    default:
      return <Clock className="w-4 h-4 text-muted-foreground" />;
  }
}

function ToolCallStatusIcon({ status }: { status: ToolCallStatus }) {
  switch (status) {
    case "running":
    case "streaming":
      return <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />;
    case "completed":
      return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
    case "failed":
      return <XCircle className="w-3.5 h-3.5 text-red-500" />;
    case "retrying":
      return <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" />;
    case "cancelled":
      return <XCircle className="w-3.5 h-3.5 text-muted-foreground" />;
    default:
      return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
  }
}

function ArtifactStatusBadge({ status }: { status: ArtifactStatus }) {
  const variants: Record<ArtifactStatus, "default" | "secondary" | "success" | "destructive"> = {
    declared: "secondary",
    generating: "default",
    ready: "success",
    failed: "destructive",
  };
  
  const labels: Record<ArtifactStatus, string> = {
    declared: "Declared",
    generating: "Generating",
    ready: "Ready",
    failed: "Failed",
  };
  
  return (
    <Badge variant={variants[status]} className="text-xs">
      {status === "generating" && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
      {labels[status]}
    </Badge>
  );
}

function PlanPanel({ plan, steps, currentStepId }: { 
  plan: Plan | null; 
  steps: Map<string, Step>;
  currentStepId: string | null;
}) {
  if (!plan) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <LayoutList className="w-4 h-4" />
            Execution Plan
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Waiting for plan...
          </div>
        </CardContent>
      </Card>
    );
  }

  const completedSteps = Array.from(steps.values()).filter(
    (s) => s.status === "completed"
  ).length;

  return (
    <Card className="h-full" data-testid="plan-panel">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <LayoutList className="w-4 h-4" />
            {plan.title}
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {completedSteps}/{plan.total_steps} steps
          </Badge>
        </div>
        {plan.description && (
          <p className="text-xs text-muted-foreground mt-1">{plan.description}</p>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        <ScrollArea className="h-[200px] pr-3">
          <div className="space-y-2">
            {plan.steps.map((planStep, index) => {
              const currentStep = steps.get(planStep.id) || planStep;
              const isActive = currentStep.id === currentStepId;
              
              return (
                <motion.div
                  key={currentStep.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={cn(
                    "flex items-start gap-3 p-2 rounded-lg transition-colors",
                    isActive && "bg-primary/5 border border-primary/20",
                    currentStep.status === "completed" && "opacity-70"
                  )}
                  data-testid={`step-item-${currentStep.id}`}
                >
                  <div className="flex-shrink-0 mt-0.5">
                    <StepStatusIcon status={currentStep.status} />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {currentStep.title}
                      </span>
                      <Badge variant="outline" className="text-xs flex items-center gap-1 flex-shrink-0">
                        {stepKindIcons[currentStep.kind]}
                        {stepKindLabels[currentStep.kind]}
                      </Badge>
                    </div>
                    
                    {currentStep.summary && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {currentStep.summary}
                      </p>
                    )}
                    
                    {isActive && currentStep.status === "running" && currentStep.progress !== undefined && (
                      <div className="mt-2">
                        <Progress value={currentStep.progress} className="h-1" />
                        <span className="text-xs text-muted-foreground mt-1">
                          {currentStep.progress}%
                        </span>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

interface ToolCallDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string;
  callId: string;
  toolCall: ToolCall | null;
}

function ToolCallDetailsDialog({ 
  open, 
  onOpenChange, 
  runId, 
  callId, 
  toolCall 
}: ToolCallDetailsDialogProps) {
  const [details, setDetails] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && runId && callId) {
      setLoading(true);
      setError(null);
      
      fetch(`/api/runs/${runId}/calls/${callId}`)
        .then((res) => {
          if (!res.ok) throw new Error("Failed to fetch call details");
          return res.json();
        })
        .then((data) => {
          setDetails(data);
          setLoading(false);
        })
        .catch((err) => {
          setError(err.message);
          setLoading(false);
        });
    }
  }, [open, runId, callId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="w-5 h-5" />
            Tool Call: {toolCall?.tool}
          </DialogTitle>
          <DialogDescription>
            {toolCall?.summary}
          </DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="flex-1 mt-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-8 text-red-500 text-sm">{error}</div>
          ) : (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium mb-2">Status</h4>
                <div className="flex items-center gap-2">
                  {toolCall && <ToolCallStatusIcon status={toolCall.status} />}
                  <span className="text-sm capitalize">{toolCall?.status}</span>
                  {toolCall?.latency_ms && (
                    <Badge variant="outline" className="ml-2">
                      {formatLatency(toolCall.latency_ms)}
                    </Badge>
                  )}
                </div>
              </div>
              
              {(details?.inputs || toolCall?.inputs) && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Inputs</h4>
                  <pre className="text-xs bg-muted p-3 rounded-lg overflow-x-auto">
                    {JSON.stringify(details?.inputs || toolCall?.inputs, null, 2)}
                  </pre>
                </div>
              )}
              
              {(details?.outputs || toolCall?.outputs) && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Outputs</h4>
                  <pre className="text-xs bg-muted p-3 rounded-lg overflow-x-auto">
                    {JSON.stringify(details?.outputs || toolCall?.outputs, null, 2)}
                  </pre>
                </div>
              )}
              
              {toolCall?.error && (
                <div>
                  <h4 className="text-sm font-medium mb-2 text-red-500">Error</h4>
                  <pre className="text-xs bg-red-500/10 text-red-500 p-3 rounded-lg overflow-x-auto">
                    {toolCall.error}
                  </pre>
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function ActivityFeed({ 
  runId, 
  toolCalls 
}: { 
  runId: string; 
  toolCalls: Map<string, ToolCall>; 
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedCall, setSelectedCall] = useState<{
    runId: string;
    callId: string;
    toolCall: ToolCall;
  } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const callsArray = Array.from(toolCalls.values()).sort((a, b) => {
    const aTime = a.started_at || 0;
    const bTime = b.started_at || 0;
    return aTime - bTime;
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [callsArray.length]);

  const handleViewDetails = useCallback((call: ToolCall) => {
    setSelectedCall({ runId, callId: call.call_id, toolCall: call });
    setDialogOpen(true);
  }, [runId]);

  return (
    <>
      <Card className="h-full" data-testid="activity-feed">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Wrench className="w-4 h-4" />
            Activity Feed
            {callsArray.length > 0 && (
              <Badge variant="outline" className="ml-auto text-xs">
                {callsArray.filter(c => c.status === "completed").length}/{callsArray.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <ScrollArea className="h-[200px]" ref={scrollRef}>
            {callsArray.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                No tool calls yet...
              </div>
            ) : (
              <div className="space-y-1 pr-3">
                <AnimatePresence mode="popLayout">
                  {callsArray.map((call) => (
                    <motion.div
                      key={call.call_id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 group text-sm"
                      data-testid={`tool-call-${call.call_id}`}
                    >
                      <ToolCallStatusIcon status={call.status} />
                      
                      <span className="text-muted-foreground">Using</span>
                      
                      <Wrench className="w-3.5 h-3.5 text-muted-foreground" />
                      
                      <span className="font-medium truncate flex-1">
                        {call.tool}
                        {call.summary && (
                          <span className="font-normal text-muted-foreground ml-1">
                            {call.summary}
                          </span>
                        )}
                      </span>
                      
                      {call.status === "completed" && call.latency_ms && (
                        <Badge variant="outline" className="text-xs flex-shrink-0">
                          {formatLatency(call.latency_ms)}
                        </Badge>
                      )}
                      
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                        onClick={() => handleViewDetails(call)}
                        data-testid={`view-call-${call.call_id}`}
                      >
                        <Eye className="w-3.5 h-3.5 mr-1" />
                        View
                      </Button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
      
      <ToolCallDetailsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        runId={selectedCall?.runId || ""}
        callId={selectedCall?.callId || ""}
        toolCall={selectedCall?.toolCall || null}
      />
    </>
  );
}

function ArtifactsPanel({ 
  artifacts, 
  onDownload 
}: { 
  artifacts: Map<string, Artifact>;
  onDownload?: (artifact: Artifact) => void;
}) {
  const artifactsArray = Array.from(artifacts.values());

  const handleDownload = useCallback((artifact: Artifact) => {
    if (artifact.download_url) {
      if (onDownload) {
        onDownload(artifact);
      } else {
        // FRONTEND FIX #38: Add noopener,noreferrer to prevent window.opener attacks
        window.open(artifact.download_url, "_blank", "noopener,noreferrer");
      }
    }
  }, [onDownload]);

  return (
    <Card className="h-full" data-testid="artifacts-panel">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <File className="w-4 h-4" />
          Generated Files
          {artifactsArray.length > 0 && (
            <Badge variant="outline" className="ml-auto text-xs">
              {artifactsArray.filter(a => a.status === "ready").length}/{artifactsArray.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ScrollArea className="h-[200px]">
          {artifactsArray.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              No artifacts generated yet...
            </div>
          ) : (
            <div className="space-y-2 pr-3">
              <AnimatePresence mode="popLayout">
                {artifactsArray.map((artifact) => (
                  <motion.div
                    key={artifact.artifact_id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="p-3 rounded-lg border bg-card"
                    data-testid={`artifact-${artifact.artifact_id}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-md bg-muted flex-shrink-0">
                        {artifactKindIcons[artifact.kind]}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">
                            {artifact.filename}
                          </span>
                          <ArtifactStatusBadge status={artifact.status} />
                        </div>
                        
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          {artifact.size_bytes && (
                            <span>{formatBytes(artifact.size_bytes)}</span>
                          )}
                          {artifact.rows_count && (
                            <span>• {artifact.rows_count} rows</span>
                          )}
                        </div>
                        
                        {artifact.status === "generating" && artifact.progress !== undefined && (
                          <div className="mt-2">
                            <Progress value={artifact.progress} className="h-1" />
                            <div className="flex justify-between items-center mt-1 text-xs text-muted-foreground">
                              <span>{artifact.progress}%</span>
                              {artifact.rows_count && (
                                <span>{artifact.rows_count} rows written</span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      
                      {artifact.status === "ready" && artifact.download_url && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-shrink-0"
                          onClick={() => handleDownload(artifact)}
                          data-testid={`download-${artifact.artifact_id}`}
                        >
                          <Download className="w-4 h-4 mr-1" />
                          Download
                        </Button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export function UniversalExecutionConsole({
  runState,
  onArtifactDownload,
  className,
}: UniversalExecutionConsoleProps) {
  const isIdle = runState.status === "idle" || runState.status === "connecting";
  const isComplete = runState.status === "completed" || runState.status === "failed" || runState.status === "cancelled";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      data-testid="universal-execution-console"
      className={cn("space-y-4", className)}
    >
      <div className="flex items-center justify-between p-4 rounded-lg bg-gradient-to-r from-muted/50 to-muted/30 border">
        <div className="flex items-center gap-3">
          {runState.status === "running" ? (
            <div className="relative">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
              <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping" />
            </div>
          ) : runState.status === "completed" ? (
            <CheckCircle2 className="w-6 h-6 text-green-500" />
          ) : runState.status === "failed" ? (
            <XCircle className="w-6 h-6 text-red-500" />
          ) : (
            <Clock className="w-6 h-6 text-muted-foreground" />
          )}
          
          <div>
            <h3 className="font-semibold">
              {isIdle
                ? "Initializing..."
                : isComplete
                ? runState.status === "completed"
                  ? "Execution Complete"
                  : runState.status === "failed"
                  ? "Execution Failed"
                  : "Execution Cancelled"
                : "Executing..."}
            </h3>
            <p className="text-sm text-muted-foreground">
              Run ID: {runState.run_id}
              {runState.error && (
                <span className="text-red-500 ml-2">• {runState.error}</span>
              )}
            </p>
          </div>
        </div>
        
        <div className="text-right">
          <div className="text-3xl font-bold text-primary">
            {runState.progress}%
          </div>
          <div className="text-xs text-muted-foreground">
            {runState.metrics.completed_tool_calls}/{runState.metrics.total_tool_calls} calls
          </div>
        </div>
      </div>
      
      <Progress value={runState.progress} className="h-2" />
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <PlanPanel
          plan={runState.plan}
          steps={runState.steps}
          currentStepId={runState.current_step_id}
        />
        
        <ActivityFeed
          runId={runState.run_id}
          toolCalls={runState.tool_calls}
        />
        
        <ArtifactsPanel
          artifacts={runState.artifacts}
          onDownload={onArtifactDownload}
        />
      </div>
    </motion.div>
  );
}
