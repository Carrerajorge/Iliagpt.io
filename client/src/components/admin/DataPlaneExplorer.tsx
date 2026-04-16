import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetchJson } from "@/lib/adminApi";
import { Loader2, Database, Activity, Clock, Search, RefreshCw, Layers, GitCommit } from "lucide-react";

interface DataPlaneStats {
  eventSourcing: { status: string; cqrsEnabled: boolean };
  outbox: { pending: number; processed: number; failed: number };
}

interface RunEvent {
  id: string;
  runId: string;
  eventType: string;
  timestamp: string;
  stepIndex: number | null;
  payload: Record<string, any>;
  durationMs: number | null;
}

const eventTypeColors: Record<string, string> = {
  run_started: "bg-green-500/20 text-green-400",
  step_started: "bg-blue-500/20 text-blue-400",
  step_completed: "bg-blue-500/20 text-blue-400",
  tool_called: "bg-purple-500/20 text-purple-400",
  tool_result: "bg-purple-500/20 text-purple-400",
  error: "bg-red-500/20 text-red-400",
  run_completed: "bg-green-500/20 text-green-400",
  snapshot_taken: "bg-yellow-500/20 text-yellow-400",
};

export default function DataPlaneExplorer() {
  const [searchRunId, setSearchRunId] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const { data: statsData, isLoading: statsLoading, refetch: refetchStats } = useQuery({
    queryKey: ["/api/data-plane/stats"],
    refetchInterval: 15000,
    throwOnError: true,
  });

  const { data: runsData, isLoading: runsLoading } = useQuery({
    queryKey: ["/api/data-plane/runs"],
    refetchInterval: 15000,
    throwOnError: true,
  });

  const { data: eventsData, isLoading: eventsLoading } = useQuery({
    queryKey: ["/api/data-plane/runs", activeRunId, "events"],
    queryFn: async () => {
      if (!activeRunId) return { events: [] };
      return apiFetchJson(`/api/data-plane/runs/${activeRunId}/events`);
    },
    enabled: !!activeRunId,
    throwOnError: true,
  });

  const stats: DataPlaneStats = (statsData as any) || {
    eventSourcing: { status: "operational", cqrsEnabled: true },
    outbox: { pending: 0, processed: 0, failed: 0 },
  };
  const runs: any[] = (runsData as any)?.runs || [];
  const events: RunEvent[] = (eventsData as any)?.events || [];

  if (statsLoading) {
    return (
      <div className="flex items-center justify-center p-12" data-testid="dataplane-loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="data-plane-explorer">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Database className="h-6 w-6" />
            Data Plane Explorer
          </h2>
          <p className="text-muted-foreground text-sm mt-1">Event sourcing, CQRS, time-travel debugging</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetchStats()} data-testid="btn-refresh-dataplane">
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="h-4 w-4 text-green-400" />
              <span className="text-xs text-muted-foreground">Status</span>
            </div>
            <div className="text-lg font-bold" data-testid="stat-es-status">{stats.eventSourcing.status}</div>
            <div className="text-xs text-muted-foreground">CQRS: {stats.eventSourcing.cqrsEnabled ? "Enabled" : "Disabled"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Layers className="h-4 w-4 text-blue-400" />
              <span className="text-xs text-muted-foreground">Outbox Pending</span>
            </div>
            <div className="text-2xl font-bold" data-testid="stat-outbox-pending">{stats.outbox.pending}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <GitCommit className="h-4 w-4 text-purple-400" />
              <span className="text-xs text-muted-foreground">Outbox Processed</span>
            </div>
            <div className="text-2xl font-bold" data-testid="stat-outbox-processed">{stats.outbox.processed}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-red-400" />
              <span className="text-xs text-muted-foreground">Outbox Failed</span>
            </div>
            <div className="text-2xl font-bold" data-testid="stat-outbox-failed">{stats.outbox.failed}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4" />
            Time-Travel Debugging
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 mb-4">
            <Input
              placeholder="Enter run ID to inspect events..."
              value={searchRunId}
              onChange={(e) => setSearchRunId(e.target.value)}
              data-testid="input-run-id"
            />
            <Button
              onClick={() => setActiveRunId(searchRunId.trim() || null)}
              disabled={!searchRunId.trim()}
              data-testid="btn-inspect-run"
            >
              <Search className="h-4 w-4 mr-1" /> Inspect
            </Button>
          </div>

          {activeRunId && eventsLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}

          {activeRunId && !eventsLoading && events.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No events found for run {activeRunId}</p>
            </div>
          )}

          {events.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground mb-2">{events.length} events for run {activeRunId}</div>
              {events.map((event, idx) => (
                <div key={event.id || idx} className="flex items-start gap-3 p-2 rounded border hover:bg-muted/30 transition-colors" data-testid={`event-${event.id || idx}`}>
                  <div className="flex flex-col items-center">
                    <div className="w-2 h-2 rounded-full bg-primary mt-1.5" />
                    {idx < events.length - 1 && <div className="w-px h-full bg-border mt-1" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge className={eventTypeColors[event.eventType] || "bg-muted text-muted-foreground"}>
                        {event.eventType}
                      </Badge>
                      {event.stepIndex !== null && (
                        <span className="text-[10px] text-muted-foreground">Step #{event.stepIndex}</span>
                      )}
                      {event.durationMs !== null && (
                        <span className="text-[10px] text-muted-foreground">{event.durationMs}ms</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {new Date(event.timestamp).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!activeRunId && (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Enter a run ID above to inspect its event timeline</p>
              <p className="text-xs mt-1">All agent runs emit immutable events for replay and debugging</p>
            </div>
          )}
        </CardContent>
      </Card>

      {runs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Recent Runs ({runs.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {runs.map((run: any) => (
                <div
                  key={run.runId}
                  className="flex items-center justify-between p-2 rounded border hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => { setSearchRunId(run.runId); setActiveRunId(run.runId); }}
                  data-testid={`run-${run.runId}`}
                >
                  <div className="flex items-center gap-2">
                    <GitCommit className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs font-mono">{run.runId.slice(0, 12)}...</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="text-[10px] h-5">{run.eventCount} events</Badge>
                    <span className="text-[10px] text-muted-foreground">{new Date(run.lastEvent).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
