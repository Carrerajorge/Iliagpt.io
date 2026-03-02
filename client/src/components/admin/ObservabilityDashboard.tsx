import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Activity,
  Cpu,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Server,
  Loader2,
  RefreshCw,
  ArrowLeft,
  Zap,
  BarChart3,
  Users,
  Layers,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface Trace {
  traceId: string;
  service: string;
  duration: number;
  status: string;
  timestamp: string;
}

interface Span {
  spanId: string;
  operationName: string;
  service: string;
  startTime: number;
  duration: number;
  status: string;
  parentSpanId?: string;
  tags?: Record<string, string>;
}

interface TraceDetail {
  traceId: string;
  spans: Span[];
  totalDuration: number;
  service: string;
  status: string;
  timestamp: string;
}

interface SystemMetrics {
  cpu: { percent: number; user: number; system: number };
  memory: { rss: number; heapUsed: number; heapTotal: number; external: number; rssMB: number; heapUsedMB: number };
  uptime: number;
  requestRate: number;
}

interface HealthService {
  name: string;
  status: "healthy" | "degraded" | "unhealthy" | "connected";
  latencyMs?: number;
  message?: string;
}

interface RawHealthData {
  status: "healthy" | "degraded" | "unhealthy";
  services: Record<string, { status: string; latencyMs?: number }>;
  timestamp: string;
}

interface HealthData {
  overall: "healthy" | "degraded" | "unhealthy";
  services: HealthService[];
}

interface RawStatsData {
  totalRequests: number;
  errorCount: number;
  errorRate: number;
  latency: { p50: number; p95: number; p99: number };
  throughput: number;
}

interface StatsData {
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  errorRate: number;
  totalRequests: number;
  totalErrors: number;
}

interface OrchestratorMetrics {
  activeRuns: number;
  activeTasks: number;
  queueDepth: number;
  completedRuns: number;
  failedRuns: number;
  avgRunDurationMs: number;
}

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    ok: "bg-green-600",
    success: "bg-green-600",
    healthy: "bg-green-600",
    error: "bg-red-500",
    unhealthy: "bg-red-500",
    failed: "bg-red-500",
    degraded: "bg-yellow-500",
    warning: "bg-yellow-500",
    running: "bg-blue-500",
    pending: "bg-gray-400",
  };
  return (
    <Badge
      className={`${colorMap[status.toLowerCase()] || "bg-gray-500"} text-white text-xs`}
      data-testid={`badge-status-${status}`}
    >
      {status}
    </Badge>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function TracesTable({
  traces,
  onSelectTrace,
}: {
  traces: Trace[];
  onSelectTrace: (traceId: string) => void;
}) {
  return (
    <Table data-testid="table-traces">
      <TableHeader>
        <TableRow>
          <TableHead>Trace ID</TableHead>
          <TableHead>Service</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Timestamp</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {traces.map((trace) => (
          <TableRow
            key={trace.traceId}
            className="cursor-pointer hover:bg-muted/50"
            onClick={() => onSelectTrace(trace.traceId)}
            data-testid={`row-trace-${trace.traceId}`}
          >
            <TableCell className="font-mono text-xs">{trace.traceId.slice(0, 16)}...</TableCell>
            <TableCell>{trace.service}</TableCell>
            <TableCell>{formatDuration(trace.duration)}</TableCell>
            <TableCell>
              <StatusBadge status={trace.status} />
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {new Date(trace.timestamp).toLocaleString()}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TraceWaterfall({ traceId, onBack }: { traceId: string; onBack: () => void }) {
  const { data, isLoading } = useQuery<TraceDetail>({
    queryKey: ["/api/observability/traces", traceId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/observability/traces/${traceId}`);
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="trace-detail-loading">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-8 text-muted-foreground" data-testid="trace-detail-empty">
        No trace data found
      </div>
    );
  }

  const spans = data.spans || [];
  const totalDuration = data.totalDuration || Math.max(...spans.map((s) => s.startTime + s.duration), 1);

  return (
    <div className="space-y-4" data-testid="trace-waterfall">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back-traces">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div>
          <p className="font-mono text-sm" data-testid="text-trace-id">{data.traceId}</p>
          <p className="text-xs text-muted-foreground">
            {data.service} · {formatDuration(totalDuration)} · <StatusBadge status={data.status} />
          </p>
        </div>
      </div>

      <div className="space-y-1" data-testid="waterfall-spans">
        {spans.map((span) => {
          const left = (span.startTime / totalDuration) * 100;
          const width = Math.max((span.duration / totalDuration) * 100, 1);
          return (
            <div
              key={span.spanId}
              className="flex items-center gap-3 py-1.5 border-b border-border/50"
              data-testid={`span-${span.spanId}`}
            >
              <div className="w-40 shrink-0">
                <p className="text-xs font-medium truncate">{span.operationName}</p>
                <p className="text-[10px] text-muted-foreground">{span.service}</p>
              </div>
              <div className="flex-1 relative h-6 bg-muted/30 rounded">
                <div
                  className={`absolute top-0.5 bottom-0.5 rounded ${
                    span.status === "error" ? "bg-red-500" : "bg-blue-500"
                  }`}
                  style={{ left: `${left}%`, width: `${width}%`, minWidth: "4px" }}
                />
              </div>
              <span className="text-xs text-muted-foreground w-16 text-right shrink-0">
                {formatDuration(span.duration)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricsCards({ metrics }: { metrics: SystemMetrics }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="metrics-cards">
      <Card data-testid="card-metric-cpu">
        <CardContent className="pt-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-md bg-orange-500/10">
              <Cpu className="h-4 w-4 text-orange-500" />
            </div>
            <span className="text-sm text-muted-foreground">CPU</span>
          </div>
          <p className="text-2xl font-bold" data-testid="text-cpu">{metrics.cpu.percent.toFixed(1)}%</p>
          <Progress value={Math.min(metrics.cpu.percent, 100)} className="mt-2 h-1.5" />
        </CardContent>
      </Card>

      <Card data-testid="card-metric-memory">
        <CardContent className="pt-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-md bg-blue-500/10">
              <Server className="h-4 w-4 text-blue-500" />
            </div>
            <span className="text-sm text-muted-foreground">Memory</span>
          </div>
          <p className="text-2xl font-bold" data-testid="text-memory">{metrics.memory.rssMB}MB</p>
          <Progress value={metrics.memory.heapTotal > 0 ? (metrics.memory.heapUsed / metrics.memory.heapTotal * 100) : 0} className="mt-2 h-1.5" />
          <p className="text-[10px] text-muted-foreground mt-1">
            {metrics.memory.heapUsedMB} / {metrics.memory.rssMB} MB
          </p>
        </CardContent>
      </Card>

      <Card data-testid="card-metric-uptime">
        <CardContent className="pt-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-md bg-green-500/10">
              <Clock className="h-4 w-4 text-green-500" />
            </div>
            <span className="text-sm text-muted-foreground">Uptime</span>
          </div>
          <p className="text-2xl font-bold" data-testid="text-uptime">{formatUptime(metrics.uptime)}</p>
        </CardContent>
      </Card>

      <Card data-testid="card-metric-request-rate">
        <CardContent className="pt-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-md bg-purple-500/10">
              <Activity className="h-4 w-4 text-purple-500" />
            </div>
            <span className="text-sm text-muted-foreground">Request Rate</span>
          </div>
          <p className="text-2xl font-bold" data-testid="text-request-rate">{metrics.requestRate}/s</p>
        </CardContent>
      </Card>
    </div>
  );
}

function HealthPanel({ health }: { health: HealthData }) {
  const overallConfig = {
    healthy: { icon: CheckCircle, color: "text-green-500", border: "border-green-500/20", label: "All Systems Healthy" },
    degraded: { icon: AlertTriangle, color: "text-yellow-500", border: "border-yellow-500/20", label: "Degraded Performance" },
    unhealthy: { icon: XCircle, color: "text-red-500", border: "border-red-500/20", label: "System Unhealthy" },
  };

  const cfg = overallConfig[health.overall] || overallConfig.unhealthy;
  const Icon = cfg.icon;

  return (
    <div className="space-y-4" data-testid="health-panel">
      <Card className={`border-2 ${cfg.border}`} data-testid="card-overall-health">
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-3">
            <Icon className={`h-5 w-5 ${cfg.color}`} />
            <span className={`font-medium ${cfg.color}`} data-testid="text-overall-health">
              {cfg.label}
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {health.services.map((svc) => (
          <Card key={svc.name} data-testid={`card-health-${svc.name}`}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">{svc.name}</span>
                <StatusBadge status={svc.status} />
              </div>
              {svc.latencyMs !== undefined && (
                <p className="text-xs text-muted-foreground">Latency: {svc.latencyMs}ms</p>
              )}
              {svc.message && (
                <p className="text-xs text-muted-foreground mt-1">{svc.message}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function LatencyStatsPanel({ stats }: { stats: StatsData }) {
  const errorColor = stats.errorRate > 5 ? "text-red-500" : stats.errorRate > 2 ? "text-yellow-500" : "text-green-500";

  return (
    <div className="space-y-4" data-testid="latency-stats-panel">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card data-testid="card-stat-p50">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">P50 Latency</p>
            <p className="text-2xl font-bold" data-testid="text-p50">{stats.latencyP50}ms</p>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-p95">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">P95 Latency</p>
            <p className="text-2xl font-bold" data-testid="text-p95">{stats.latencyP95}ms</p>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-p99">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">P99 Latency</p>
            <p className="text-2xl font-bold" data-testid="text-p99">{stats.latencyP99}ms</p>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-error-rate">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Error Rate</p>
            <p className={`text-2xl font-bold ${errorColor}`} data-testid="text-error-rate">
              {stats.errorRate.toFixed(2)}%
            </p>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-stat-totals">
        <CardContent className="pt-4 flex items-center gap-6">
          <div>
            <p className="text-xs text-muted-foreground">Total Requests</p>
            <p className="text-lg font-bold" data-testid="text-total-requests">
              {stats.totalRequests.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Errors</p>
            <p className="text-lg font-bold text-red-500" data-testid="text-total-errors">
              {stats.totalErrors.toLocaleString()}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function OrchestratorPanel({ orchestrator }: { orchestrator: OrchestratorMetrics }) {
  return (
    <div className="space-y-4" data-testid="orchestrator-panel">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card data-testid="card-orch-active-runs">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-md bg-green-500/10">
                <Zap className="h-4 w-4 text-green-500" />
              </div>
              <span className="text-sm text-muted-foreground">Active Runs</span>
            </div>
            <p className="text-2xl font-bold" data-testid="text-orch-active-runs">
              {orchestrator.activeRuns}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-orch-active-tasks">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-md bg-blue-500/10">
                <Users className="h-4 w-4 text-blue-500" />
              </div>
              <span className="text-sm text-muted-foreground">Active Tasks</span>
            </div>
            <p className="text-2xl font-bold" data-testid="text-orch-active-tasks">
              {orchestrator.activeTasks}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-orch-queue-depth">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-md bg-yellow-500/10">
                <Layers className="h-4 w-4 text-yellow-500" />
              </div>
              <span className="text-sm text-muted-foreground">Queue Depth</span>
            </div>
            <p className="text-2xl font-bold" data-testid="text-orch-queue-depth">
              {orchestrator.queueDepth}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <BarChart3 className="h-5 w-5 text-green-600" />
            <div>
              <p className="text-lg font-bold" data-testid="text-orch-completed">{orchestrator.completedRuns}</p>
              <p className="text-xs text-muted-foreground">Completed Runs</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <XCircle className="h-5 w-5 text-red-500" />
            <div>
              <p className="text-lg font-bold text-red-500" data-testid="text-orch-failed">{orchestrator.failedRuns}</p>
              <p className="text-xs text-muted-foreground">Failed Runs</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-lg font-bold" data-testid="text-orch-avg-duration">
                {formatDuration(orchestrator.avgRunDurationMs)}
              </p>
              <p className="text-xs text-muted-foreground">Avg Duration</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function ObservabilityDashboard() {
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);

  const { data: traces, isLoading: tracesLoading } = useQuery<Trace[]>({
    queryKey: ["/api/observability/traces"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/observability/traces");
      const data = await res.json();
      return data.traces || [];
    },
    refetchInterval: 10000,
  });

  const { data: metrics, isLoading: metricsLoading } = useQuery<SystemMetrics>({
    queryKey: ["/api/observability/metrics"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/observability/metrics");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: health } = useQuery<HealthData>({
    queryKey: ["/api/observability/health"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/observability/health");
      const raw: RawHealthData = await res.json();
      return {
        overall: raw.status,
        services: Object.entries(raw.services).map(([name, svc]) => ({
          name,
          status: svc.status as any,
          latencyMs: svc.latencyMs,
        })),
      };
    },
    refetchInterval: 15000,
  });

  const { data: stats } = useQuery<StatsData>({
    queryKey: ["/api/observability/stats"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/observability/stats");
      const raw: RawStatsData = await res.json();
      return {
        latencyP50: raw.latency?.p50 || 0,
        latencyP95: raw.latency?.p95 || 0,
        latencyP99: raw.latency?.p99 || 0,
        errorRate: raw.errorRate || 0,
        totalRequests: raw.totalRequests || 0,
        totalErrors: raw.errorCount || 0,
      };
    },
    refetchInterval: 10000,
  });

  const { data: orchestrator } = useQuery<OrchestratorMetrics>({
    queryKey: ["/api/observability/orchestrator"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/observability/orchestrator");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const isLoading = tracesLoading || metricsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="observability-loading">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="observability-dashboard">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold" data-testid="text-observability-title">
            Observability Dashboard
          </h2>
          <p className="text-muted-foreground">System tracing, metrics, and health monitoring</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            window.location.reload();
          }}
          data-testid="button-refresh-observability"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <Tabs defaultValue="overview" data-testid="tabs-observability">
        <TabsList data-testid="tabs-list">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="traces" data-testid="tab-traces">Traces</TabsTrigger>
          <TabsTrigger value="health" data-testid="tab-health">Health</TabsTrigger>
          <TabsTrigger value="orchestrator" data-testid="tab-orchestrator">Orchestrator</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-4">
          {metrics && <MetricsCards metrics={metrics} />}
          {stats && <LatencyStatsPanel stats={stats} />}
        </TabsContent>

        <TabsContent value="traces" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Distributed Traces</CardTitle>
            </CardHeader>
            <CardContent>
              {selectedTraceId ? (
                <TraceWaterfall
                  traceId={selectedTraceId}
                  onBack={() => setSelectedTraceId(null)}
                />
              ) : traces && traces.length > 0 ? (
                <TracesTable
                  traces={traces}
                  onSelectTrace={setSelectedTraceId}
                />
              ) : (
                <p className="text-center py-8 text-muted-foreground" data-testid="text-no-traces">
                  No traces available
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="health" className="mt-4">
          {health ? (
            <HealthPanel health={health} />
          ) : (
            <p className="text-center py-8 text-muted-foreground" data-testid="text-no-health">
              Health data unavailable
            </p>
          )}
        </TabsContent>

        <TabsContent value="orchestrator" className="mt-4">
          {orchestrator ? (
            <OrchestratorPanel orchestrator={orchestrator} />
          ) : (
            <p className="text-center py-8 text-muted-foreground" data-testid="text-no-orchestrator">
              Orchestrator data unavailable
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
