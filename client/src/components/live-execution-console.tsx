import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  CheckCircle2, 
  XCircle, 
  FileSpreadsheet,
  Search,
  Shield,
  FileOutput,
  Loader2,
  ChevronDown,
  ChevronRight,
  Download,
  Zap,
  Settings2,
  FileText,
  X as XIcon,
  MessageSquare
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { 
  RunStreamClient, 
  RunStreamState, 
  TraceEvent
} from "@/lib/runStreamClient";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PhaseNarrator } from "@/lib/phaseNarrator";

interface LiveExecutionConsoleProps {
  runId: string | null;
  forceShow?: boolean;
  onComplete?: (artifacts: RunStreamState["artifacts"]) => void;
  onError?: (error: string) => void;
  className?: string;
}

const phaseIcons: Record<string, React.ReactNode> = {
  planning: <Zap className="w-3.5 h-3.5" />,
  signals: <Search className="w-3.5 h-3.5" />,
  verification: <Shield className="w-3.5 h-3.5" />,
  enrichment: <FileText className="w-3.5 h-3.5" />,
  export: <FileOutput className="w-3.5 h-3.5" />,
  finalization: <CheckCircle2 className="w-3.5 h-3.5" />,
};

const phaseLabels: Record<string, string> = {
  planning: "Planificando búsqueda",
  signals: "Buscando artículos",
  verification: "Verificando DOIs",
  enrichment: "Enriqueciendo metadatos",
  export: "Generando Excel",
  finalization: "Finalizando",
  idle: "Iniciando...",
};

function ProgressChip({ 
  label, 
  value, 
  total, 
  variant = "default" 
}: { 
  label: string; 
  value: number; 
  total?: number; 
  variant?: "default" | "success" | "warning" | "muted";
}) {
  const variantClasses = {
    default: "bg-muted/80 text-foreground/80",
    success: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    muted: "bg-muted/50 text-muted-foreground",
  };

  return (
    <Badge 
      variant="outline" 
      className={cn(
        "text-[10px] font-medium px-1.5 py-0.5 border-0",
        variantClasses[variant]
      )}
    >
      {label} {total !== undefined ? `${value}/${total}` : value}
    </Badge>
  );
}

function MinimalEventFeed({ events }: { events: TraceEvent[] }) {
  const recentEvents = useMemo(() => {
    return events
      .filter(e => e.event_type !== "heartbeat" && e.event_type !== "progress_update")
      .slice(-3);
  }, [events]);

  if (recentEvents.length === 0) return null;

  return (
    <div className="space-y-0.5">
      {recentEvents.map((event, idx) => (
        <div 
          key={`${event.run_id}-${event.seq}`}
          className={cn(
            "text-[11px] text-muted-foreground truncate",
            idx === recentEvents.length - 1 && "text-foreground/70"
          )}
        >
          <span className="font-medium">{event.agent}:</span>{" "}
          <span>{event.message}</span>
        </div>
      ))}
    </div>
  );
}

function InlineArtifact({ artifact }: { artifact: RunStreamState["artifacts"][0] }) {
  if (artifact.generating) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
        <span>Generando {artifact.name}...</span>
      </div>
    );
  }

  return (
    <a
      href={artifact.url}
      download
      className="flex items-center gap-2 text-xs py-1 text-emerald-600 dark:text-emerald-400 hover:underline"
      data-testid="artifact-download-link"
    >
      <FileSpreadsheet className="w-3.5 h-3.5" />
      <span className="font-medium flex-1 truncate">{artifact.name}</span>
      <Download className="w-3.5 h-3.5" />
    </a>
  );
}

export function LiveExecutionConsole({
  runId,
  forceShow = false,
  onComplete,
  onError,
  className
}: LiveExecutionConsoleProps) {
  const [state, setState] = useState<RunStreamState | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [narrationText, setNarrationText] = useState<string>("Iniciando agente de búsqueda…");
  const narratorRef = useRef<PhaseNarrator | null>(null);
  const processedEventsRef = useRef<Set<string>>(new Set());

  // Store callbacks in refs to avoid re-triggering the SSE effect when
  // parent re-renders with new inline functions (prevents mount/unmount loop & React #185)
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  useEffect(() => {
    console.log('[LiveExecutionConsole] Mounted with runId=', runId);
  }, [runId]);

  useEffect(() => {
    if (!runId) return;

    console.log(`[LiveExecutionConsole] Connecting to run: ${runId}`);
    const streamClient = new RunStreamClient(runId);

    narratorRef.current = new PhaseNarrator((newNarration) => {
      setNarrationText(newNarration);
    });
    processedEventsRef.current = new Set();
    setNarrationText("Iniciando agente de búsqueda…");

    const unsubscribe = streamClient.subscribe((newState) => {
      console.log(`[LiveExecutionConsole] State update:`, newState.connectionMode, newState.phase, newState.status,
        `queries=${newState.queries_current}/${newState.queries_total}`, `found=${newState.candidates_found}`);
      setState(newState);

      for (const event of newState.events) {
        const eventKey = `${event.run_id}-${event.seq}`;
        if (processedEventsRef.current.has(eventKey)) continue;
        processedEventsRef.current.add(eventKey);

        const narration = narratorRef.current!.processEvent(event);
        console.log(`[PhaseNarrator] ${event.event_type}: ${narration}`);
      }

      if (newState.status === "completed" && onCompleteRef.current) {
        onCompleteRef.current(newState.artifacts);
      }

      if (newState.status === "failed" && onErrorRef.current && newState.error) {
        onErrorRef.current(newState.error);
      }
    });

    streamClient.connect();

    return () => {
      console.log(`[LiveExecutionConsole] Unmounting for run: ${runId}`);
      unsubscribe();
      streamClient.destroy();
      narratorRef.current?.destroy();
    };
  }, [runId]);

  if (!runId) {
    return null;
  }

  if (!state || state.connectionMode === "connecting") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        data-testid="live-execution-console"
        className={cn(
          "bg-card/80 backdrop-blur-sm rounded-lg border border-border/60 shadow-sm p-3",
          className
        )}
      >
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-primary animate-spin" />
          <span className="text-sm font-medium">Conectando...</span>
        </div>
      </motion.div>
    );
  }

  const isComplete = state.status === "completed" || state.status === "failed";
  const progressDisplay = state.target > 0 
    ? `${state.metrics.articles_accepted}/${state.target}` 
    : `${Math.round(state.progress)}%`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      data-testid="live-execution-console"
      className={cn(
        "bg-card/80 backdrop-blur-sm rounded-lg border border-border/60 shadow-sm overflow-hidden",
        className
      )}
    >
      {narrationText && (
        <div className="px-3 py-2 border-b border-border/20">
          <p 
            className="text-sm font-medium"
            style={state.status === 'running' ? {
              background: 'linear-gradient(90deg, #475569 0%, #475569 40%, #1e293b 50%, #475569 60%, #475569 100%)',
              backgroundSize: '200% 100%',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              animation: 'shimmerTextAnim 1.2s ease-in-out infinite',
            } : undefined}
          >
            {narrationText}
          </p>
        </div>
      )}
      <div className="p-3 space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {state.status === "running" ? (
              <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" />
            ) : state.status === "completed" ? (
              <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
            ) : state.status === "failed" ? (
              <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            ) : (
              <Loader2 className="w-4 h-4 text-muted-foreground animate-spin flex-shrink-0" />
            )}
            <div className="min-w-0">
              <h3 className="font-medium text-sm truncate">
                {isComplete 
                  ? (state.status === "completed" ? "Completado" : "Error")
                  : state.run_title
                }
              </h3>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {phaseIcons[state.phase]}
                <span>{phaseLabels[state.phase] || state.phase}</span>
              </div>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-lg font-semibold text-primary">
              {progressDisplay}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {state.queries_total > 0 && (
            <ProgressChip 
              label="Consultas" 
              value={state.queries_current} 
              total={state.queries_total} 
            />
          )}
          {state.pages_searched > 0 && (
            <ProgressChip label="Páginas" value={state.pages_searched} />
          )}
          {state.candidates_found > 0 && (
            <ProgressChip label="Candidatos" value={state.candidates_found} />
          )}
          {state.metrics.articles_verified > 0 && (
            <ProgressChip 
              label="Verificados" 
              value={state.metrics.articles_verified} 
              variant="default"
            />
          )}
          <ProgressChip 
            label="Aceptados" 
            value={state.metrics.articles_accepted} 
            total={state.target > 0 ? state.target : undefined}
            variant="success"
          />
          {state.reject_count > 0 && (
            <ProgressChip 
              label="Descartes" 
              value={state.reject_count} 
              variant="warning"
            />
          )}
        </div>

        <MinimalEventFeed events={state.events} />

        {state.artifacts.length > 0 && (
          <div className="pt-1 border-t border-border/40">
            {state.artifacts.map((artifact) => (
              <InlineArtifact key={artifact.id} artifact={artifact} />
            ))}
          </div>
        )}

        {state.rules && (state.rules.yearStart || state.rules.yearEnd || state.rules.regions?.length) && (
          <Collapsible open={rulesOpen} onOpenChange={setRulesOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground w-full pt-1 border-t border-border/40">
              <Settings2 className="w-3 h-3" />
              <span>Reglas activas</span>
              {rulesOpen ? <ChevronDown className="w-3 h-3 ml-auto" /> : <ChevronRight className="w-3 h-3 ml-auto" />}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                {(state.rules.yearStart || state.rules.yearEnd) && (
                  <div>
                    <span className="font-medium">Años:</span> {state.rules.yearStart || "?"}-{state.rules.yearEnd || "?"}
                  </div>
                )}
                {state.rules.regions && state.rules.regions.length > 0 && (
                  <div>
                    <span className="font-medium">Regiones:</span> {state.rules.regions.join(", ")}
                  </div>
                )}
                {state.rules.output && (
                  <div>
                    <span className="font-medium">Output:</span> {state.rules.output}
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </motion.div>
  );
}
