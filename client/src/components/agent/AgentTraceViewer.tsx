import { useEffect, useMemo, useState } from 'react';
import { useAgentTraceStore, type TraceStep, type TraceRun } from '@/stores/agentTraceStore';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Clock, 
  RefreshCw,
  ChevronDown,
  Terminal,
  FileText,
  ListTodo,
  Activity,
  AlertTriangle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePlatformSettings } from '@/contexts/PlatformSettingsContext';
import { formatZonedTime, normalizeTimeZone } from '@/lib/platformDateTime';

interface AgentTraceViewerProps {
  runId: string;
  onClose?: () => void;
}

const statusConfig: Record<TraceStep['status'], {
  icon: typeof Clock;
  color: string;
  bg: string;
  label: string;
  animate?: boolean;
}> = {
  pending: { icon: Clock, color: 'text-muted-foreground', bg: 'bg-muted', label: 'Pendiente' },
  running: { icon: Loader2, color: 'text-blue-500', bg: 'bg-blue-500/10', label: 'Ejecutando', animate: true },
  completed: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/10', label: 'Completado' },
  failed: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10', label: 'Fallido' },
  retrying: { icon: RefreshCw, color: 'text-yellow-500', bg: 'bg-yellow-500/10', label: 'Reintentando', animate: true },
  cancelled: { icon: XCircle, color: 'text-gray-500', bg: 'bg-gray-500/10', label: 'Cancelado' },
};

const runStatusConfig = {
  pending: { label: 'Iniciando', color: 'bg-muted' },
  planning: { label: 'Planificando', color: 'bg-blue-500' },
  running: { label: 'Ejecutando', color: 'bg-blue-500' },
  verifying: { label: 'Verificando', color: 'bg-purple-500' },
  completed: { label: 'Completado', color: 'bg-green-500' },
  failed: { label: 'Fallido', color: 'bg-red-500' },
  cancelled: { label: 'Cancelado', color: 'bg-gray-500' },
};

function StepStatusBadge({ status }: { status: TraceStep['status'] }) {
  const config = statusConfig[status];
  const Icon = config.icon;
  
  return (
    <Badge 
      variant="outline" 
      className={cn('gap-1 text-xs', config.color, config.bg)}
      data-testid={`badge-step-status-${status}`}
    >
      <Icon className={cn('h-3 w-3', config.animate && 'animate-spin')} />
      {config.label}
    </Badge>
  );
}

function RunHeader({ run }: { run: TraceRun }) {
  const config = runStatusConfig[run.status];
  const progress = run.steps.length > 0 
    ? Math.round((run.steps.filter(s => s.status === 'completed').length / run.steps.length) * 100)
    : 0;

  return (
    <div className="border-b p-4 space-y-3" data-testid="trace-run-header">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn('w-2 h-2 rounded-full animate-pulse', config.color)} />
          <span className="font-medium">{config.label}</span>
        </div>
        <Badge variant="secondary" className="text-xs">
          {run.currentStepIndex + 1} / {run.steps.length || '?'}
        </Badge>
      </div>
      
      {run.plan && (
        <p className="text-sm text-muted-foreground line-clamp-2">
          {run.plan.objective}
        </p>
      )}
      
      <div className="w-full bg-muted rounded-full h-1.5">
        <div 
          className={cn('h-1.5 rounded-full transition-all duration-500', config.color)}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function StepTimeline({ steps, runId }: { steps: TraceStep[]; runId: string }) {
  const { toggleStepExpanded } = useAgentTraceStore();

  if (steps.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground" data-testid="trace-empty-steps">
        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
        <p className="text-sm">Generando plan...</p>
      </div>
    );
  }

  return (
    <Accordion 
      type="multiple" 
      className="w-full"
      defaultValue={steps.filter(s => s.isExpanded).map(s => `step-${s.index}`)}
      data-testid="trace-step-timeline"
    >
      {steps.map((step) => (
        <AccordionItem 
          key={step.index} 
          value={`step-${step.index}`}
          className="border-l-2 ml-3 pl-4 relative"
          style={{ borderColor: statusConfig[step.status].color.replace('text-', '') }}
          data-testid={`trace-step-${step.index}`}
        >
          <div 
            className={cn(
              'absolute left-[-9px] top-4 w-4 h-4 rounded-full border-2 border-background',
              statusConfig[step.status].bg
            )}
          />
          
          <AccordionTrigger 
            className="hover:no-underline py-3"
            onClick={() => toggleStepExpanded(runId, step.index)}
          >
            <div className="flex items-center gap-3 flex-1 text-left">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{step.toolName}</span>
                  <StepStatusBadge status={step.status} />
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                  {step.description}
                </p>
              </div>
            </div>
          </AccordionTrigger>
          
          <AccordionContent>
            <StepDetails step={step} />
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function StepDetails({ step }: { step: TraceStep }) {
  const shellEvents = step.events.filter((e) => {
    const eventType = String(e.event_type);
    return eventType === 'shell_output' || eventType === 'shell_chunk' || eventType === 'shell_exit' || eventType === 'tool_call';
  });
  
  const hasArtifacts = step.artifacts.length > 0;
  const hasLogs = step.events.length > 0;
  const hasShell = shellEvents.length > 0;

  return (
    <Tabs defaultValue="progress" className="w-full" data-testid={`step-details-${step.index}`}>
      <TabsList className="grid w-full grid-cols-4 h-8">
        <TabsTrigger value="progress" className="text-xs gap-1">
          <Activity className="h-3 w-3" />
          Progreso
        </TabsTrigger>
        <TabsTrigger value="artifacts" className="text-xs gap-1" disabled={!hasArtifacts}>
          <FileText className="h-3 w-3" />
          Artefactos
        </TabsTrigger>
        <TabsTrigger value="shell" className="text-xs gap-1" disabled={!hasShell}>
          <Terminal className="h-3 w-3" />
          Terminal
        </TabsTrigger>
        <TabsTrigger value="logs" className="text-xs gap-1" disabled={!hasLogs}>
          <ListTodo className="h-3 w-3" />
          Logs
        </TabsTrigger>
      </TabsList>
      
      <TabsContent value="progress" className="mt-2">
        <ProgressPanel step={step} />
      </TabsContent>
      
      <TabsContent value="artifacts" className="mt-2">
        <ArtifactsPanel step={step} />
      </TabsContent>
      
      <TabsContent value="shell" className="mt-2">
        <ShellPanel step={step} />
      </TabsContent>
      
      <TabsContent value="logs" className="mt-2">
        <LogsPanel step={step} />
      </TabsContent>
    </Tabs>
  );
}

function ProgressPanel({ step }: { step: TraceStep }) {
  return (
    <div className="space-y-2 text-sm" data-testid={`progress-panel-${step.index}`}>
      {step.output && (
        <ScrollArea className="h-[200px] rounded border bg-muted/30 p-3">
          <pre className="text-xs whitespace-pre-wrap font-mono">
            {step.output}
          </pre>
        </ScrollArea>
      )}
      
      {step.error && (
        <div className="flex items-start gap-2 p-3 rounded bg-red-500/10 text-red-500">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="text-xs">{step.error}</span>
        </div>
      )}
      
      {!step.output && !step.error && step.status === 'running' && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs">Procesando...</span>
        </div>
      )}
      
      {!step.output && !step.error && step.status === 'pending' && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Clock className="h-4 w-4" />
          <span className="text-xs">En espera</span>
        </div>
      )}
    </div>
  );
}

function ArtifactsPanel({ step }: { step: TraceStep }) {
  if (step.artifacts.length === 0) {
    return (
      <div className="text-center text-muted-foreground text-xs py-4">
        No hay artefactos generados
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid={`artifacts-panel-${step.index}`}>
      {step.artifacts.map((artifact, i) => (
        <div 
          key={i} 
          className="flex items-center gap-2 p-2 rounded bg-muted/30 text-sm"
        >
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1 truncate">{artifact.name}</span>
          <Badge variant="outline" className="text-xs">{artifact.type}</Badge>
          {artifact.url && (
            <Button size="sm" variant="ghost" className="h-6 text-xs" asChild>
              <a href={artifact.url} target="_blank" rel="noopener noreferrer">
                Ver
              </a>
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

function ShellPanel({ step }: { step: TraceStep }) {
  const shellEvents = step.events.filter((e) => {
    const eventType = String(e.event_type);
    return eventType === 'shell_output' || eventType === 'shell_chunk' || eventType === 'shell_exit' || eventType === 'tool_call' || eventType === 'tool_output';
  });

  if (shellEvents.length === 0) {
    return (
      <div className="text-center text-muted-foreground text-xs py-4">
        No hay salida de terminal
      </div>
    );
  }

  const fullShell = step.shellOutput;

  return (
    <ScrollArea className="h-[200px] rounded border bg-black p-3" data-testid={`shell-panel-${step.index}`}>
      <div className="font-mono text-xs text-green-400 space-y-1">
        {shellEvents.map((event, i) => (
          <div key={i}>
            {event.command && (
              <div className="text-blue-400">$ {event.command}</div>
            )}
          </div>
        ))}

        {fullShell ? (
          <pre className="whitespace-pre-wrap text-gray-300">{fullShell}</pre>
        ) : (
          shellEvents.map((event, i) => (
            <div key={`legacy-${i}`}>
              {event.output_snippet && (
                <pre className="whitespace-pre-wrap text-gray-300">{event.output_snippet}</pre>
              )}
            </div>
          ))
        )}
      </div>
    </ScrollArea>
  );
}

function LogsPanel({ step }: { step: TraceStep }) {
  const [showRaw, setShowRaw] = useState(false);
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);

  return (
    <div className="space-y-2" data-testid={`logs-panel-${step.index}`}>
      <div className="flex justify-end">
        <Button 
          size="sm" 
          variant="ghost" 
          className="h-6 text-xs"
          onClick={() => setShowRaw(!showRaw)}
        >
          {showRaw ? 'Ver resumen' : 'Ver JSON'}
        </Button>
      </div>
      
      <ScrollArea className="h-[200px] rounded border bg-muted/30 p-2">
        {showRaw ? (
          <pre className="text-xs font-mono whitespace-pre-wrap">
            {JSON.stringify(step.events, null, 2)}
          </pre>
        ) : (
          <div className="space-y-1">
            {step.events.map((event, i) => (
              <div 
                key={i} 
                className="flex items-center gap-2 text-xs py-1 border-b border-border/50 last:border-0"
              >
                <span className="text-muted-foreground w-16 shrink-0">
                  {formatZonedTime(event.timestamp, { timeZone: platformTimeZone, includeSeconds: true })}
                </span>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {event.event_type}
                </Badge>
                <span className="truncate text-muted-foreground">
                  {event.summary || event.tool_name || '-'}
                </span>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

export function AgentTraceViewer({ runId, onClose }: AgentTraceViewerProps) {
  const { runs, subscribeToRun, unsubscribeFromRun, isConnected, connectionError } = useAgentTraceStore();
  const run = runs.get(runId);

  useEffect(() => {
    subscribeToRun(runId);
    return () => unsubscribeFromRun(runId);
  }, [runId, subscribeToRun, unsubscribeFromRun]);

  if (!run) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="trace-loading">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" data-testid="agent-trace-viewer">
      {connectionError && (
        <div className="bg-yellow-500/10 text-yellow-500 text-xs p-2 flex items-center gap-2">
          <AlertTriangle className="h-3 w-3" />
          {connectionError}
        </div>
      )}
      
      <RunHeader run={run} />
      
      <ScrollArea className="flex-1">
        <div className="p-4">
          <StepTimeline steps={run.steps} runId={runId} />
        </div>
      </ScrollArea>
      
      {run.summary && run.status === 'completed' && (
        <div className="border-t p-4 bg-green-500/5" data-testid="trace-summary">
          <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            Resumen
          </h4>
          <p className="text-sm text-muted-foreground">{run.summary}</p>
        </div>
      )}
      
      {run.error && run.status === 'failed' && (
        <div className="border-t p-4 bg-red-500/5" data-testid="trace-error">
          <h4 className="text-sm font-medium mb-2 flex items-center gap-2 text-red-500">
            <XCircle className="h-4 w-4" />
            Error
          </h4>
          <p className="text-sm text-red-400">{run.error}</p>
        </div>
      )}
    </div>
  );
}

export default AgentTraceViewer;
