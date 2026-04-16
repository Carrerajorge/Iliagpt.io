import { useState, useEffect, useCallback, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { PlanDiffViewer } from './PlanDiffViewer';
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  RotateCcw,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  FileText,
  GitBranch,
  Zap,
  AlertTriangle,
} from 'lucide-react';

interface DomainEvent {
  id: string;
  runId: string;
  eventType: string;
  correlationId: string;
  stepIndex: number | null;
  payload: Record<string, any>;
  metadata: Record<string, any> | null;
  timestamp: string | Date;
  inputHash: string | null;
  outputRef: string | null;
  durationMs: number | null;
  errorCode: string | null;
  retryCount: number;
}

interface AgentStateSnapshot {
  runId: string;
  snapshotId: string;
  eventIndex: number;
  status: string;
  plan: any | null;
  completedSteps: number;
  currentStepIndex: number;
  artifacts: any[];
  error: string | null;
  timestamp: string | Date;
}

interface ReplayData {
  runId: string;
  events: DomainEvent[];
  snapshots: AgentStateSnapshot[];
  finalState: AgentStateSnapshot;
  totalEvents: number;
}

interface RunReplayViewerProps {
  runId: string;
}

const eventTypeConfig: Record<string, { icon: typeof Zap; color: string; label: string }> = {
  CommandReceived: { icon: Zap, color: 'text-blue-400', label: 'Command' },
  PlanCreated: { icon: FileText, color: 'text-purple-400', label: 'Plan' },
  SubtaskStarted: { icon: Activity, color: 'text-cyan-400', label: 'Subtask' },
  ToolCalled: { icon: Zap, color: 'text-orange-400', label: 'Tool Call' },
  ToolCompleted: { icon: CheckCircle2, color: 'text-green-400', label: 'Tool Done' },
  CriticEvaluated: { icon: AlertTriangle, color: 'text-yellow-400', label: 'Critic' },
  JudgeVerdict: { icon: CheckCircle2, color: 'text-emerald-400', label: 'Judge' },
  StateTransition: { icon: GitBranch, color: 'text-indigo-400', label: 'Transition' },
  ReplanTriggered: { icon: RotateCcw, color: 'text-amber-400', label: 'Replan' },
  ErrorOccurred: { icon: XCircle, color: 'text-red-400', label: 'Error' },
  SnapshotTaken: { icon: Clock, color: 'text-gray-400', label: 'Snapshot' },
};

const statusColors: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  running: 'bg-blue-500/10 text-blue-500',
  planning: 'bg-purple-500/10 text-purple-500',
  succeeded: 'bg-green-500/10 text-green-500',
  failed: 'bg-red-500/10 text-red-500',
};

function EventCard({ event, isActive }: { event: DomainEvent; isActive: boolean }) {
  const config = eventTypeConfig[event.eventType] ?? {
    icon: Activity,
    color: 'text-muted-foreground',
    label: event.eventType,
  };
  const Icon = config.icon;
  const ts = event.timestamp instanceof Date ? event.timestamp : new Date(event.timestamp);

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-3 rounded-lg border transition-all',
        isActive ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border/50 hover:border-border'
      )}
      data-testid={`replay-event-${event.id}`}
    >
      <div className={cn('mt-0.5 shrink-0', config.color)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn('text-[10px]', config.color)}>
            {config.label}
          </Badge>
          {event.stepIndex !== null && (
            <Badge variant="secondary" className="text-[10px]">
              Step {event.stepIndex}
            </Badge>
          )}
          {event.durationMs !== null && (
            <span className="text-[10px] text-muted-foreground">{event.durationMs}ms</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {event.payload.description ||
            event.payload.objective ||
            event.payload.toolName ||
            event.payload.verdict ||
            event.payload.message ||
            event.payload.toState ||
            JSON.stringify(event.payload).slice(0, 120)}
        </p>
        <span className="text-[10px] text-muted-foreground/60">
          {ts.toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}

function StatePanel({ state }: { state: AgentStateSnapshot | null }) {
  if (!state) {
    return (
      <div className="text-center text-muted-foreground text-sm py-6" data-testid="replay-state-empty">
        Move the timeline to inspect state
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="replay-state-panel">
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Status</p>
            <Badge className={cn('mt-1', statusColors[state.status] ?? 'bg-muted')}>
              {state.status}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Progress</p>
            <p className="text-lg font-semibold mt-1" data-testid="replay-state-progress">
              {state.completedSteps}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Current Step</p>
            <p className="text-lg font-semibold mt-1">{state.currentStepIndex}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Event Index</p>
            <p className="text-lg font-semibold mt-1">{state.eventIndex}</p>
          </CardContent>
        </Card>
      </div>

      {state.error && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-red-500/10 text-red-400 text-sm">
          <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
          {state.error}
        </div>
      )}

      {state.plan && (
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground mb-1">Plan</p>
            <ScrollArea className="max-h-[200px]">
              <pre className="text-xs font-mono whitespace-pre-wrap">
                {JSON.stringify(state.plan, null, 2)}
              </pre>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {state.artifacts.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground mb-2">Artifacts ({state.artifacts.length})</p>
            <div className="space-y-1">
              {state.artifacts.map((a: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <FileText className="h-3 w-3 text-muted-foreground" />
                  <span>{a.name ?? JSON.stringify(a).slice(0, 80)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function RunReplayViewer({ runId }: RunReplayViewerProps) {
  const [replayData, setReplayData] = useState<ReplayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(1000);
  const [currentState, setCurrentState] = useState<AgentStateSnapshot | null>(null);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventListRef = useRef<HTMLDivElement | null>(null);

  const replanEvents = replayData?.events.filter(e => e.eventType === 'ReplanTriggered') ?? [];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/agent/runs/${runId}/replay`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: any) => {
        const data: ReplayData = json.data ?? json;
        if (!cancelled) {
          setReplayData(data);
          setCurrentIndex(0);
          setCurrentState(data.finalState);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [runId]);

  useEffect(() => {
    if (!replayData || replayData.events.length === 0) return;

    let cancelled = false;
    fetch(`/api/agent/runs/${runId}/replay?upToIndex=${currentIndex}`)
      .then(async (res) => {
        if (!res.ok) return;
        const json = await res.json();
        const data = json.data ?? json;
        if (!cancelled) setCurrentState(data.finalState);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [runId, currentIndex, replayData]);

  const stepForward = useCallback(() => {
    if (!replayData) return;
    setCurrentIndex((i) => Math.min(i + 1, replayData.events.length - 1));
  }, [replayData]);

  const stepBackward = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0));
  }, []);

  const resetReplay = useCallback(() => {
    setIsPlaying(false);
    setCurrentIndex(0);
  }, []);

  const togglePlay = useCallback(() => {
    setIsPlaying((p) => !p);
  }, []);

  useEffect(() => {
    if (isPlaying && replayData) {
      playIntervalRef.current = setInterval(() => {
        setCurrentIndex((i) => {
          const next = i + 1;
          if (next >= replayData.events.length) {
            setIsPlaying(false);
            return i;
          }
          return next;
        });
      }, playSpeed);
    } else if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [isPlaying, playSpeed, replayData]);

  useEffect(() => {
    if (eventListRef.current) {
      const activeEl = eventListRef.current.querySelector('[data-active="true"]');
      activeEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [currentIndex]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3" data-testid="replay-loading">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading replay data…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3" data-testid="replay-error">
        <XCircle className="h-8 w-8 text-red-500" />
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()} data-testid="button-retry">
          Retry
        </Button>
      </div>
    );
  }

  if (!replayData || replayData.events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3" data-testid="replay-empty">
        <Clock className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No events found for this run</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" data-testid="run-replay-viewer">
      <div className="border-b p-4 space-y-3" data-testid="replay-controls">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Run Replay</h2>
            <Badge variant="secondary" className="text-xs">{runId.slice(0, 8)}</Badge>
          </div>
          <div className="flex items-center gap-1">
            <Badge variant="outline" className="text-xs">
              {currentIndex + 1} / {replayData.totalEvents}
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={resetReplay}
            data-testid="button-reset"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={stepBackward}
            disabled={currentIndex <= 0}
            data-testid="button-step-back"
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            variant="default"
            size="icon"
            className="h-8 w-8"
            onClick={togglePlay}
            data-testid="button-play-pause"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={stepForward}
            disabled={currentIndex >= replayData.events.length - 1}
            data-testid="button-step-forward"
          >
            <SkipForward className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-1 ml-2">
            <span className="text-[10px] text-muted-foreground">Speed:</span>
            {[2000, 1000, 500, 200].map((speed) => (
              <Button
                key={speed}
                variant={playSpeed === speed ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => setPlaySpeed(speed)}
                data-testid={`button-speed-${speed}`}
              >
                {speed >= 1000 ? `${speed / 1000}s` : `${speed}ms`}
              </Button>
            ))}
          </div>
        </div>

        <Slider
          value={[currentIndex]}
          min={0}
          max={replayData.events.length - 1}
          step={1}
          onValueChange={([val]) => {
            setIsPlaying(false);
            setCurrentIndex(val);
          }}
          className="w-full"
          data-testid="replay-timeline-scrubber"
        />
      </div>

      <div className="flex-1 flex min-h-0">
        <Tabs defaultValue="events" className="flex-1 flex flex-col">
          <TabsList className="mx-4 mt-2 grid grid-cols-3 h-8">
            <TabsTrigger value="events" className="text-xs gap-1" data-testid="tab-events">
              <Activity className="h-3 w-3" />
              Events
            </TabsTrigger>
            <TabsTrigger value="state" className="text-xs gap-1" data-testid="tab-state">
              <FileText className="h-3 w-3" />
              State
            </TabsTrigger>
            <TabsTrigger
              value="diffs"
              className="text-xs gap-1"
              disabled={replanEvents.length === 0}
              data-testid="tab-diffs"
            >
              <GitBranch className="h-3 w-3" />
              Diffs ({replanEvents.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="events" className="flex-1 min-h-0 px-4 pb-4 mt-2">
            <ScrollArea className="h-full">
              <div className="space-y-2" ref={eventListRef}>
                {replayData.events.map((event, i) => (
                  <div
                    key={event.id}
                    data-active={i === currentIndex}
                    onClick={() => {
                      setIsPlaying(false);
                      setCurrentIndex(i);
                    }}
                    className="cursor-pointer"
                  >
                    <EventCard event={event} isActive={i === currentIndex} />
                  </div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="state" className="flex-1 min-h-0 px-4 pb-4 mt-2">
            <ScrollArea className="h-full">
              <StatePanel state={currentState} />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="diffs" className="flex-1 min-h-0 px-4 pb-4 mt-2">
            <ScrollArea className="h-full">
              <div className="space-y-6">
                {replanEvents.map((event, i) => {
                  const evIndex = replayData.events.indexOf(event);
                  const prevPlanEvent = replayData.events
                    .slice(0, evIndex)
                    .reverse()
                    .find(e => e.eventType === 'PlanCreated' || e.eventType === 'ReplanTriggered');

                  return (
                    <div key={event.id} data-testid={`plan-diff-${i}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="text-amber-400 bg-amber-500/10 text-xs">
                          Replan #{i + 1}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          Event #{evIndex + 1}
                        </span>
                      </div>
                      <PlanDiffViewer
                        oldPlan={prevPlanEvent?.payload?.plan ?? prevPlanEvent?.payload?.newPlan ?? null}
                        newPlan={event.payload.newPlan ?? null}
                      />
                    </div>
                  );
                })}
                {replanEvents.length === 0 && (
                  <div className="text-center text-muted-foreground text-sm py-8">
                    No replans occurred during this run
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default RunReplayViewer;
