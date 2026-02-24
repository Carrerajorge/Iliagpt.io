import { useQuery } from "@tanstack/react-query";
import { X, FileSpreadsheet, Globe, Image, FileText, Loader2, CheckCircle2, XCircle, Clock, RefreshCw, Square, Bot, Sparkles, FileIcon, Terminal, FolderOpen, List, Monitor, Activity, Circle, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { formatZonedTime, normalizeTimeZone } from "@/lib/platformDateTime";
import { apiFetch } from "@/lib/apiClient";
import "@/components/ui/glass-effects.css";

interface AgentStep {
  stepIndex: number;
  toolName: string;
  status: "pending" | "running" | "succeeded" | "failed";
  description?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  output?: any;
}

interface AgentArtifact {
  id: string;
  type: string;
  name: string;
  url?: string;
  data?: any;
}

interface AgentEvent {
  type: 'action' | 'observation' | 'plan' | 'verification' | 'error' | 'replan';
  content: any;
  timestamp: number;
  stepIndex?: number;
  metadata?: any;
}

interface TodoItem {
  id: string;
  task: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  stepIndex?: number;
  lastError?: string;
}

interface WorkspaceFile {
  name: string;
  type: 'file' | 'directory';
  content?: string;
}

interface AgentRunData {
  id: string;
  chatId: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  plan?: AgentStep[];
  steps?: AgentStep[];
  artifacts?: AgentArtifact[];
  startedAt?: string;
  completedAt?: string;
  error?: string;
  summary?: string;
  eventStream?: AgentEvent[];
  todoList?: TodoItem[];
  workspaceFiles?: Record<string, string>;
}

interface AgentPanelProps {
  runId: string | null;
  chatId: string;
  onClose: () => void;
  isOpen: boolean;
}

const TOOL_ICONS: Record<string, React.ElementType> = {
  analyze_spreadsheet: FileSpreadsheet,
  web_search: Globe,
  generate_image: Image,
  browse_url: Globe,
  generate_document: FileText,
  extract_content: FileText,
  transform_data: FileSpreadsheet,
  respond: Bot,
  read_file: FileIcon,
  write_file: FileText,
  shell_command: Terminal,
  list_files: FolderOpen,
};

function getToolIcon(stepType: string): React.ElementType {
  return TOOL_ICONS[stepType] || FileIcon;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function StepStatusIcon({ status }: { status: AgentStep["status"] }) {
  switch (status) {
    case "pending":
      return <Clock className="h-4 w-4 text-muted-foreground" />;
    case "running":
      return <Loader2 className="h-4 w-4 text-purple-500 animate-spin" />;
    case "succeeded":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-500" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function calculateDuration(startedAt?: string, completedAt?: string): number | null {
  if (!startedAt || !completedAt) return null;
  return new Date(completedAt).getTime() - new Date(startedAt).getTime();
}

function StepItem({ step, index }: { step: AgentStep; index: number }) {
  const IconComponent = getToolIcon(step.toolName);
  const isRunning = step.status === "running";
  const duration = calculateDuration(step.startedAt, step.completedAt);
  
  return (
    <div
      className={cn(
        "flex items-start gap-3 p-3 rounded-lg border transition-all duration-200",
        isRunning && "border-purple-500/50 bg-purple-500/5 shadow-sm shadow-purple-500/10",
        step.status === "succeeded" && "border-green-500/30 bg-green-500/5",
        step.status === "failed" && "border-red-500/30 bg-red-500/5",
        step.status === "pending" && "border-border bg-muted/30"
      )}
      data-testid={`step-item-${step.stepIndex}`}
    >
      <div className={cn(
        "flex items-center justify-center w-8 h-8 rounded-full shrink-0",
        isRunning && "bg-purple-500/20",
        step.status === "succeeded" && "bg-green-500/20",
        step.status === "failed" && "bg-red-500/20",
        step.status === "pending" && "bg-muted"
      )}>
        <IconComponent className={cn(
          "h-4 w-4",
          isRunning && "text-purple-500",
          step.status === "succeeded" && "text-green-500",
          step.status === "failed" && "text-red-500",
          step.status === "pending" && "text-muted-foreground"
        )} />
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Paso {index + 1}
          </span>
          <Badge 
            variant={
              step.status === "succeeded" ? "success" :
              step.status === "failed" ? "destructive" :
              step.status === "running" ? "default" : "outline"
            }
            className={cn(
              "text-[10px] px-1.5 py-0",
              isRunning && "bg-purple-600 hover:bg-purple-600"
            )}
          >
            {step.status === "pending" && "Pendiente"}
            {step.status === "running" && "Ejecutando"}
            {step.status === "succeeded" && "Completado"}
            {step.status === "failed" && "Error"}
          </Badge>
        </div>
        
        <p className="text-sm font-medium mt-1 truncate">
          {step.description || step.toolName.replace(/_/g, " ")}
        </p>
        
        {duration && step.status === "succeeded" && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatDuration(duration)}
          </p>
        )}
        
        {step.error && (
          <p className="text-xs text-red-500 mt-1 line-clamp-2">
            {step.error}
          </p>
        )}
      </div>
      
      <StepStatusIcon status={step.status} />
    </div>
  );
}

function ArtifactItem({ artifact }: { artifact: AgentArtifact }) {
  const iconMap: Record<string, React.ElementType> = {
    spreadsheet: FileSpreadsheet,
    document: FileText,
    image: Image,
    file: FileIcon,
  };
  const IconComponent = iconMap[artifact.type] || FileIcon;
  
  return (
    <div
      className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
      data-testid={`artifact-item-${artifact.id}`}
    >
      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-purple-500/10">
        <IconComponent className="h-5 w-5 text-purple-500" />
      </div>
      
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{artifact.name}</p>
        <p className="text-xs text-muted-foreground capitalize">{artifact.type}</p>
      </div>
    </div>
  );
}

function EventStreamItem({ event }: { event: AgentEvent }) {
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);

  const getEventIcon = () => {
    switch (event.type) {
      case 'action': return <Activity className="h-3 w-3 text-blue-500" />;
      case 'observation': return <Monitor className="h-3 w-3 text-green-500" />;
      case 'plan': return <List className="h-3 w-3 text-purple-500" />;
      case 'verification': return <CheckCircle className="h-3 w-3 text-yellow-500" />;
      case 'error': return <AlertCircle className="h-3 w-3 text-red-500" />;
      case 'replan': return <RefreshCw className="h-3 w-3 text-orange-500" />;
      default: return <Circle className="h-3 w-3" />;
    }
  };
  
  const formatTime = (ts: number) => {
    return formatZonedTime(ts, { timeZone: platformTimeZone, includeSeconds: true });
  };
  
  const getEventContent = () => {
    if (typeof event.content === 'string') return event.content;
    if (event.content?.message) return event.content.message;
    if (event.content?.toolName) return `Tool: ${event.content.toolName}`;
    return JSON.stringify(event.content).slice(0, 100);
  };
  
  return (
    <div className={cn(
      "flex items-start gap-2 p-2 rounded text-xs border-l-2",
      event.type === 'action' && "border-l-blue-500 bg-blue-500/5",
      event.type === 'observation' && "border-l-green-500 bg-green-500/5",
      event.type === 'error' && "border-l-red-500 bg-red-500/5",
      event.type === 'plan' && "border-l-purple-500 bg-purple-500/5",
      event.type === 'verification' && "border-l-yellow-500 bg-yellow-500/5",
      event.type === 'replan' && "border-l-orange-500 bg-orange-500/5"
    )}>
      {getEventIcon()}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium capitalize">{event.type}</span>
          <span className="text-muted-foreground">{formatTime(event.timestamp)}</span>
        </div>
        <p className="text-muted-foreground truncate">{getEventContent()}</p>
      </div>
    </div>
  );
}

function TodoListItem({ item }: { item: TodoItem }) {
  const getStatusIcon = () => {
    switch (item.status) {
      case 'completed': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'in_progress': return <Loader2 className="h-4 w-4 text-purple-500 animate-spin" />;
      case 'failed': return <XCircle className="h-4 w-4 text-red-500" />;
      case 'skipped': return <Circle className="h-4 w-4 text-gray-400" />;
      default: return <Circle className="h-4 w-4 text-muted-foreground" />;
    }
  };
  
  return (
    <div className={cn(
      "flex items-start gap-2 p-2 rounded-md border",
      item.status === 'completed' && "border-green-500/30 bg-green-500/5",
      item.status === 'in_progress' && "border-purple-500/30 bg-purple-500/5",
      item.status === 'failed' && "border-red-500/30 bg-red-500/5",
      item.status === 'pending' && "border-border"
    )}>
      {getStatusIcon()}
      <div className="flex-1 min-w-0">
        <p className="text-sm">{item.task}</p>
        {item.lastError && (
          <p className="text-xs text-red-500 mt-1">{item.lastError}</p>
        )}
      </div>
    </div>
  );
}

export function AgentPanel({ runId, chatId, onClose, isOpen }: AgentPanelProps) {
  const { data: runData, isLoading, refetch } = useQuery<AgentRunData>({
    queryKey: ["agent-run", runId],
    queryFn: async () => {
      if (!runId) throw new Error("No run ID");
      const response = await apiFetch(`/api/agent/runs/${runId}`);
      if (!response.ok) throw new Error("Failed to fetch run data");
      return response.json();
    },
    enabled: !!runId && isOpen,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === "running" || data?.status === "pending") {
        return 2000;
      }
      return false;
    },
  });

  const handleCancel = async () => {
    if (!runId) return;
    try {
      await apiFetch(`/api/agent/runs/${runId}/cancel`, { method: "POST" });
      refetch();
    } catch (error) {
      console.error("Error cancelling run:", error);
    }
  };

  const handleRetry = async () => {
    if (!runId) return;
    try {
      await apiFetch(`/api/agent/runs/${runId}/retry`, { method: "POST" });
      refetch();
    } catch (error) {
      console.error("Error retrying run:", error);
    }
  };

  if (!isOpen) return null;

  const steps = runData?.steps || runData?.plan || [];
  const artifacts = runData?.artifacts || [];
  const completedSteps = steps.filter(s => s.status === "succeeded").length;
  const totalSteps = steps.length;
  const progressPercent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  const isRunning = runData?.status === "running" || runData?.status === "pending";
  const isFailed = runData?.status === "failed";
  const isCompleted = runData?.status === "completed";

  return (
    <div 
      className={cn(
        "fixed right-0 top-0 h-full w-[400px] max-w-full z-50",
        "bg-background/95 backdrop-blur-xl border-l border-border",
        "shadow-2xl shadow-purple-500/5",
        "flex flex-col",
        "animate-in slide-in-from-right duration-300"
      )}
      data-testid="agent-panel"
    >
      <div className="flex items-center justify-between p-4 border-b border-border glass-menu-item">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-purple-700 shadow-lg shadow-purple-500/25">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Agente</h2>
            <p className="text-xs text-muted-foreground">
              {isRunning && "Ejecutando..."}
              {isCompleted && "Completado"}
              {isFailed && "Error"}
              {!runData && "Sin ejecución activa"}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8"
          data-testid="button-close-agent-panel"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {runData && (
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Progreso</span>
            <span className="text-sm text-muted-foreground">
              {completedSteps}/{totalSteps} pasos
            </span>
          </div>
          <Progress 
            value={progressPercent} 
            className="h-2 bg-purple-500/20 [&>div]:bg-gradient-to-r [&>div]:from-purple-500 [&>div]:to-purple-600"
            data-testid="agent-progress-bar"
          />
        </div>
      )}

      <Tabs defaultValue="progress" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-3 bg-muted/50">
          <TabsTrigger value="plan" className="flex-1 data-[state=active]:bg-purple-500/10 data-[state=active]:text-purple-600">
            Plan
          </TabsTrigger>
          <TabsTrigger value="progress" className="flex-1 data-[state=active]:bg-purple-500/10 data-[state=active]:text-purple-600">
            Progreso
          </TabsTrigger>
          <TabsTrigger value="artifacts" className="flex-1 data-[state=active]:bg-purple-500/10 data-[state=active]:text-purple-600">
            Artefactos
          </TabsTrigger>
          <TabsTrigger value="computer" className="flex-1 data-[state=active]:bg-purple-500/10 data-[state=active]:text-purple-600">
            <Monitor className="h-3.5 w-3.5 mr-1" />
            Computer
          </TabsTrigger>
        </TabsList>

        <TabsContent value="plan" className="flex-1 overflow-hidden m-0 mt-2">
          <ScrollArea className="h-full px-4 pb-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
              </div>
            ) : steps.length > 0 ? (
              <div className="space-y-2">
                {steps.map((step, index) => (
                  <StepItem key={`plan-${step.stepIndex}`} step={step} index={index} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Bot className="h-12 w-12 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">
                  No hay plan disponible
                </p>
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="progress" className="flex-1 overflow-hidden m-0 mt-2">
          <ScrollArea className="h-full px-4 pb-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
              </div>
            ) : runData?.summary && steps.length === 0 ? (
              <div className="p-4 rounded-lg border border-purple-500/30 bg-purple-500/5">
                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 flex-shrink-0">
                    <Bot className="h-4 w-4 text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground mb-1">Respuesta</p>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{runData.summary}</p>
                  </div>
                </div>
              </div>
            ) : steps.length > 0 ? (
              <div className="space-y-2">
                {steps.map((step, index) => (
                  <StepItem key={`progress-${step.stepIndex}`} step={step} index={index} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Clock className="h-12 w-12 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Esperando ejecución
                </p>
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="artifacts" className="flex-1 overflow-hidden m-0 mt-2">
          <ScrollArea className="h-full px-4 pb-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
              </div>
            ) : artifacts.length > 0 ? (
              <div className="space-y-2">
                {artifacts.map((artifact) => (
                  <ArtifactItem key={artifact.id} artifact={artifact} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <FileIcon className="h-12 w-12 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Sin artefactos generados
                </p>
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="computer" className="flex-1 overflow-hidden m-0 mt-2">
          <div className="flex flex-col h-full">
            <Tabs defaultValue="events" className="flex-1 flex flex-col overflow-hidden">
              <TabsList className="mx-4 h-8 bg-muted/30">
                <TabsTrigger value="events" className="text-xs h-6">
                  <Activity className="h-3 w-3 mr-1" />
                  Events
                </TabsTrigger>
                <TabsTrigger value="todo" className="text-xs h-6">
                  <List className="h-3 w-3 mr-1" />
                  Todo
                </TabsTrigger>
                <TabsTrigger value="files" className="text-xs h-6">
                  <FolderOpen className="h-3 w-3 mr-1" />
                  Files
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="events" className="flex-1 overflow-hidden m-0 mt-2">
                <ScrollArea className="h-full px-4 pb-4">
                  {(runData?.eventStream || []).length > 0 ? (
                    <div className="space-y-1">
                      {(runData?.eventStream || []).map((event, index) => (
                        <EventStreamItem key={`event-${index}`} event={event} />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <Activity className="h-8 w-8 text-muted-foreground/50 mb-2" />
                      <p className="text-sm text-muted-foreground">No events yet</p>
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>
              
              <TabsContent value="todo" className="flex-1 overflow-hidden m-0 mt-2">
                <ScrollArea className="h-full px-4 pb-4">
                  {(runData?.todoList || []).length > 0 ? (
                    <div className="space-y-2">
                      {(runData?.todoList || []).map((item) => (
                        <TodoListItem key={item.id} item={item} />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <List className="h-8 w-8 text-muted-foreground/50 mb-2" />
                      <p className="text-sm text-muted-foreground">No todo items</p>
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>
              
              <TabsContent value="files" className="flex-1 overflow-hidden m-0 mt-2">
                <ScrollArea className="h-full px-4 pb-4">
                  {runData?.workspaceFiles && Object.keys(runData.workspaceFiles).length > 0 ? (
                    <div className="space-y-1">
                      {Object.entries(runData.workspaceFiles || {}).map(([filename, content]) => (
                        <div key={filename} className="flex items-center gap-2 p-2 rounded border border-border hover:bg-accent/50 cursor-pointer">
                          <FileIcon className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm flex-1 truncate">{filename}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {typeof content === 'string' ? `${content.length} chars` : 'file'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <FolderOpen className="h-8 w-8 text-muted-foreground/50 mb-2" />
                      <p className="text-sm text-muted-foreground">No workspace files</p>
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        </TabsContent>
      </Tabs>

      {runData && (
        <div className="p-4 border-t border-border flex gap-2">
          {isRunning && (
            <Button
              variant="destructive"
              className="flex-1"
              onClick={handleCancel}
              data-testid="button-cancel-agent"
            >
              <Square className="h-4 w-4 mr-2 fill-current" />
              Cancelar
            </Button>
          )}
          {isFailed && (
            <Button
              variant="default"
              className="flex-1 bg-purple-600 hover:bg-purple-700"
              onClick={handleRetry}
              data-testid="button-retry-agent"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Reintentar
            </Button>
          )}
          {isCompleted && (
            <Button
              variant="outline"
              className="flex-1"
              onClick={onClose}
              data-testid="button-done-agent"
            >
              <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
              Listo
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
