import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { apiFetchJson } from "@/lib/adminApi";
import {
  Activity,
  Server,
  Wifi,
  WifiOff,
  Shield,
  Zap,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
  Loader2,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Database,
  Cpu,
  HardDrive,
  Users,
  Gauge,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  AreaChart,
  Area,
  Cell,
} from "recharts";

interface ProviderMetrics {
  id: string;
  name: string;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  errorRate: number;
  requestsPerMin: number;
  circuitBreakerState: "closed" | "open" | "half-open";
  rateLimitUsedPct: number;
  rateLimitMax: number;
  uptime: number;
}

interface CacheMetrics {
  totalHits: number;
  totalMisses: number;
  hitRatio: number;
  evictions: number;
  sizeBytes: number;
  maxSizeBytes: number;
}

interface AgentMetrics {
  activeAgents: number;
  queuedTasks: number;
  completedToday: number;
  failedToday: number;
  avgTaskDurationMs: number;
}

interface ResourceMetrics {
  memoryUsedMb: number;
  memoryTotalMb: number;
  tokenBudgetUsed: number;
  tokenBudgetTotal: number;
  activeSessions: number;
}

interface LatencyDataPoint {
  time: string;
  openai: number;
  anthropic: number;
  google: number;
  deepseek: number;
}

interface BudgetSSEEvent {
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

interface SREData {
  providers: ProviderMetrics[];
  cache: CacheMetrics;
  agents: AgentMetrics;
  resources: ResourceMetrics;
  latencyHistory: LatencyDataPoint[];
  errorHistory: { time: string; errors: number; total: number }[];
}

function generateMockSREData(): SREData {
  const providers: ProviderMetrics[] = [
    {
      id: "openai",
      name: "OpenAI",
      latencyP50Ms: 450 + Math.random() * 200,
      latencyP95Ms: 1200 + Math.random() * 500,
      latencyP99Ms: 2500 + Math.random() * 800,
      errorRate: Math.random() * 3,
      requestsPerMin: Math.floor(20 + Math.random() * 80),
      circuitBreakerState: Math.random() > 0.9 ? "open" : "closed",
      rateLimitUsedPct: 30 + Math.random() * 50,
      rateLimitMax: 500,
      uptime: 99.5 + Math.random() * 0.5,
    },
    {
      id: "anthropic",
      name: "Anthropic",
      latencyP50Ms: 500 + Math.random() * 250,
      latencyP95Ms: 1500 + Math.random() * 600,
      latencyP99Ms: 3000 + Math.random() * 1000,
      errorRate: Math.random() * 2,
      requestsPerMin: Math.floor(15 + Math.random() * 60),
      circuitBreakerState: "closed",
      rateLimitUsedPct: 20 + Math.random() * 40,
      rateLimitMax: 300,
      uptime: 99.7 + Math.random() * 0.3,
    },
    {
      id: "google",
      name: "Google Gemini",
      latencyP50Ms: 350 + Math.random() * 150,
      latencyP95Ms: 900 + Math.random() * 400,
      latencyP99Ms: 1800 + Math.random() * 700,
      errorRate: Math.random() * 1.5,
      requestsPerMin: Math.floor(25 + Math.random() * 70),
      circuitBreakerState: "closed",
      rateLimitUsedPct: 25 + Math.random() * 45,
      rateLimitMax: 600,
      uptime: 99.8 + Math.random() * 0.2,
    },
    {
      id: "deepseek",
      name: "DeepSeek",
      latencyP50Ms: 300 + Math.random() * 100,
      latencyP95Ms: 800 + Math.random() * 300,
      latencyP99Ms: 1500 + Math.random() * 500,
      errorRate: Math.random() * 4,
      requestsPerMin: Math.floor(10 + Math.random() * 40),
      circuitBreakerState: Math.random() > 0.85 ? "half-open" : "closed",
      rateLimitUsedPct: 15 + Math.random() * 35,
      rateLimitMax: 200,
      uptime: 98.5 + Math.random() * 1.5,
    },
    {
      id: "minimax",
      name: "MiniMax",
      latencyP50Ms: 400 + Math.random() * 180,
      latencyP95Ms: 1100 + Math.random() * 450,
      latencyP99Ms: 2200 + Math.random() * 700,
      errorRate: Math.random() * 2.5,
      requestsPerMin: Math.floor(8 + Math.random() * 30),
      circuitBreakerState: "closed",
      rateLimitUsedPct: 10 + Math.random() * 30,
      rateLimitMax: 150,
      uptime: 99.0 + Math.random() * 1.0,
    },
  ];

  const latencyHistory: LatencyDataPoint[] = [];
  for (let i = 59; i >= 0; i--) {
    const d = new Date();
    d.setMinutes(d.getMinutes() - i);
    latencyHistory.push({
      time: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      openai: Math.floor(400 + Math.random() * 300),
      anthropic: Math.floor(450 + Math.random() * 350),
      google: Math.floor(300 + Math.random() * 250),
      deepseek: Math.floor(280 + Math.random() * 200),
    });
  }

  const errorHistory = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date();
    d.setHours(d.getHours() - i);
    const total = Math.floor(100 + Math.random() * 400);
    errorHistory.push({
      time: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      errors: Math.floor(Math.random() * 15),
      total,
    });
  }

  const totalCacheOps = Math.floor(5000 + Math.random() * 10000);
  const hits = Math.floor(totalCacheOps * (0.6 + Math.random() * 0.3));

  return {
    providers,
    cache: {
      totalHits: hits,
      totalMisses: totalCacheOps - hits,
      hitRatio: hits / totalCacheOps,
      evictions: Math.floor(Math.random() * 200),
      sizeBytes: Math.floor(50 * 1024 * 1024 + Math.random() * 200 * 1024 * 1024),
      maxSizeBytes: 512 * 1024 * 1024,
    },
    agents: {
      activeAgents: Math.floor(1 + Math.random() * 8),
      queuedTasks: Math.floor(Math.random() * 15),
      completedToday: Math.floor(50 + Math.random() * 200),
      failedToday: Math.floor(Math.random() * 10),
      avgTaskDurationMs: Math.floor(5000 + Math.random() * 25000),
    },
    resources: {
      memoryUsedMb: Math.floor(256 + Math.random() * 512),
      memoryTotalMb: 1024,
      tokenBudgetUsed: Math.floor(500000 + Math.random() * 2000000),
      tokenBudgetTotal: 5000000,
      activeSessions: Math.floor(5 + Math.random() * 30),
    },
    latencyHistory,
    errorHistory,
  };
}

const PROVIDER_COLORS: Record<string, string> = {
  openai: "#10b981",
  anthropic: "#8b5cf6",
  google: "#3b82f6",
  deepseek: "#f59e0b",
  minimax: "#ec4899",
};

function CircuitBreakerBadge({ state }: { state: "closed" | "open" | "half-open" }) {
  const config = {
    closed: { label: "Closed", variant: "default" as const, className: "bg-green-600" },
    open: { label: "Open", variant: "destructive" as const, className: "" },
    "half-open": { label: "Half-Open", variant: "outline" as const, className: "border-yellow-500 text-yellow-600" },
  };
  const c = config[state];
  return (
    <Badge variant={c.variant} className={cn("text-[10px]", c.className)} data-testid={`badge-cb-${state}`}>
      {c.label}
    </Badge>
  );
}

function ProviderCard({ provider }: { provider: ProviderMetrics }) {
  const latencyColor =
    provider.latencyP50Ms > 1000 ? "text-red-500" : provider.latencyP50Ms > 600 ? "text-yellow-500" : "text-green-500";
  const errorColor =
    provider.errorRate > 5 ? "text-red-500" : provider.errorRate > 2 ? "text-yellow-500" : "text-green-500";
  const rateLimitColor =
    provider.rateLimitUsedPct > 80 ? "text-red-500" : provider.rateLimitUsedPct > 60 ? "text-yellow-500" : "text-green-500";

  return (
    <Card data-testid={`card-provider-${provider.id}`}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: PROVIDER_COLORS[provider.id] || "#6b7280" }}
            />
            <span className="font-medium text-sm">{provider.name}</span>
          </div>
          <CircuitBreakerBadge state={provider.circuitBreakerState} />
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-muted-foreground">Latency P50</span>
            <p className={cn("font-bold text-sm", latencyColor)} data-testid={`text-latency-${provider.id}`}>
              {provider.latencyP50Ms.toFixed(0)}ms
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">P95 / P99</span>
            <p className="font-medium text-sm">
              {provider.latencyP95Ms.toFixed(0)} / {provider.latencyP99Ms.toFixed(0)}ms
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Error Rate</span>
            <p className={cn("font-bold text-sm", errorColor)} data-testid={`text-error-rate-${provider.id}`}>
              {provider.errorRate.toFixed(2)}%
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Req/min</span>
            <p className="font-bold text-sm" data-testid={`text-rpm-${provider.id}`}>
              {provider.requestsPerMin}
            </p>
          </div>
        </div>

        <div className="mt-3 space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Rate Limit</span>
            <span className={cn("font-medium", rateLimitColor)}>
              {provider.rateLimitUsedPct.toFixed(0)}%
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                provider.rateLimitUsedPct > 80 ? "bg-red-500" : provider.rateLimitUsedPct > 60 ? "bg-yellow-500" : "bg-green-500"
              )}
              style={{ width: `${Math.min(provider.rateLimitUsedPct, 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Uptime: {provider.uptime.toFixed(2)}%</span>
            <span>{provider.rateLimitMax} max</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SREPanel() {
  const [budgetEvents, setBudgetEvents] = useState<BudgetSSEEvent[]>([]);
  const [sseConnected, setSseConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const { data, isLoading, refetch } = useQuery<SREData>({
    queryKey: ["/api/admin/sre"],
    queryFn: () => apiFetchJson("/api/admin/sre"),
    refetchInterval: 10000,
    throwOnError: true,
  });

  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/budget/events");
      eventSourceRef.current = es;

      es.onopen = () => setSseConnected(true);
      es.onerror = () => setSseConnected(false);

      const handleEvent = (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data) as BudgetSSEEvent;
          setBudgetEvents((prev) => [...prev.slice(-99), event]);
        } catch {}
      };

      es.addEventListener("budget.update", handleEvent);
      es.addEventListener("budget.warn80", handleEvent);
      es.addEventListener("budget.throttle", handleEvent);
      es.addEventListener("budget.stop", handleEvent);
      es.addEventListener("cost.breakdown", handleEvent);
      es.addEventListener("provider.spike", handleEvent);
      es.addEventListener("cache.hit", handleEvent);
      es.addEventListener("cache.miss", handleEvent);
    } catch {
      setSseConnected(false);
    }

    return () => {
      if (es) {
        es.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  const sreData = data || generateMockSREData();

  const overallHealth = useMemo(() => {
    const openCBs = sreData.providers.filter((p) => p.circuitBreakerState === "open").length;
    const highErrorProviders = sreData.providers.filter((p) => p.errorRate > 5).length;
    const highLatencyProviders = sreData.providers.filter((p) => p.latencyP50Ms > 1500).length;

    if (openCBs > 0 || highErrorProviders > 1) return "critical";
    if (highErrorProviders > 0 || highLatencyProviders > 1) return "degraded";
    return "healthy";
  }, [sreData.providers]);

  const healthConfig = {
    healthy: { label: "All Systems Operational", icon: CheckCircle, color: "text-green-500", border: "border-green-500/20" },
    degraded: { label: "Degraded Performance", icon: AlertTriangle, color: "text-yellow-500", border: "border-yellow-500/20" },
    critical: { label: "Critical Issues", icon: XCircle, color: "text-red-500", border: "border-red-500/20" },
  };

  const hc = healthConfig[overallHealth];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="sre-loading">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="sre-panel">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium" data-testid="text-sre-title">
            SRE Observability Panel
          </h2>
          <p className="text-sm text-muted-foreground">
            Infrastructure health, provider metrics & budget monitoring
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={sseConnected ? "default" : "outline"}
            className={cn("gap-1 text-xs", sseConnected ? "bg-green-600" : "")}
            data-testid="badge-sse-status"
          >
            {sseConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {sseConnected ? "SSE Live" : "SSE Offline"}
          </Badge>
          <Button variant="ghost" size="sm" onClick={() => refetch()} data-testid="button-refresh-sre">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Card className={cn("border-2", hc.border)} data-testid="card-overall-health">
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-3">
            <hc.icon className={cn("h-5 w-5", hc.color)} />
            <span className={cn("font-medium", hc.color)} data-testid="text-health-status">
              {hc.label}
            </span>
            <span className="text-xs text-muted-foreground ml-auto">
              {sreData.providers.length} providers monitored
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card data-testid="card-active-agents">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-md bg-blue-500/10">
                <Users className="h-4 w-4 text-blue-500" />
              </div>
              <span className="text-sm text-muted-foreground">Active Agents</span>
            </div>
            <p className="text-2xl font-bold" data-testid="text-active-agents">
              {sreData.agents.activeAgents}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {sreData.agents.queuedTasks} queued tasks
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-cache-hit-ratio">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-md bg-purple-500/10">
                <Database className="h-4 w-4 text-purple-500" />
              </div>
              <span className="text-sm text-muted-foreground">Cache Hit Ratio</span>
            </div>
            <p className="text-2xl font-bold" data-testid="text-cache-ratio">
              {(sreData.cache.hitRatio * 100).toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {sreData.cache.totalHits.toLocaleString()} hits / {sreData.cache.totalMisses.toLocaleString()} misses
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-memory-usage">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-md bg-orange-500/10">
                <Cpu className="h-4 w-4 text-orange-500" />
              </div>
              <span className="text-sm text-muted-foreground">Memory Usage</span>
            </div>
            <p className="text-2xl font-bold" data-testid="text-memory-usage">
              {sreData.resources.memoryUsedMb}MB
            </p>
            <div className="mt-2">
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full",
                    sreData.resources.memoryUsedMb / sreData.resources.memoryTotalMb > 0.8 ? "bg-red-500" : "bg-blue-500"
                  )}
                  style={{ width: `${(sreData.resources.memoryUsedMb / sreData.resources.memoryTotalMb) * 100}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 text-right">
                / {sreData.resources.memoryTotalMb}MB
              </p>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-token-budget">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-md bg-green-500/10">
                <Zap className="h-4 w-4 text-green-500" />
              </div>
              <span className="text-sm text-muted-foreground">Token Budget</span>
            </div>
            <p className="text-2xl font-bold" data-testid="text-token-budget">
              {((sreData.resources.tokenBudgetUsed / sreData.resources.tokenBudgetTotal) * 100).toFixed(1)}%
            </p>
            <div className="mt-2">
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full",
                    sreData.resources.tokenBudgetUsed / sreData.resources.tokenBudgetTotal > 0.8 ? "bg-red-500" : "bg-green-500"
                  )}
                  style={{ width: `${(sreData.resources.tokenBudgetUsed / sreData.resources.tokenBudgetTotal) * 100}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {(sreData.resources.tokenBudgetUsed / 1000000).toFixed(2)}M / {(sreData.resources.tokenBudgetTotal / 1000000).toFixed(1)}M
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Provider Status</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {sreData.providers.map((provider) => (
            <ProviderCard key={provider.id} provider={provider} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card data-testid="card-latency-chart">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Provider Latency (P50, last 60 min)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sreData.latencyHistory}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 10 }}
                    interval={9}
                  />
                  <YAxis
                    tickFormatter={(v) => `${v}ms`}
                    tick={{ fontSize: 10 }}
                    width={55}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => [`${value}ms`, name]}
                    contentStyle={{ fontSize: 11 }}
                  />
                  <Line type="monotone" dataKey="openai" stroke="#10b981" strokeWidth={1.5} dot={false} name="OpenAI" />
                  <Line type="monotone" dataKey="anthropic" stroke="#8b5cf6" strokeWidth={1.5} dot={false} name="Anthropic" />
                  <Line type="monotone" dataKey="google" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="Google" />
                  <Line type="monotone" dataKey="deepseek" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="DeepSeek" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-error-chart">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Error Rate (last 24h)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sreData.errorHistory}>
                  <defs>
                    <linearGradient id="errorGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} interval={3} />
                  <YAxis tick={{ fontSize: 10 }} width={40} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="errors" stroke="#ef4444" fill="url(#errorGrad)" strokeWidth={2} name="Errors" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card data-testid="card-cache-details">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Cache Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Hit Ratio</span>
                <span className={cn("font-bold", sreData.cache.hitRatio > 0.7 ? "text-green-500" : "text-yellow-500")}>
                  {(sreData.cache.hitRatio * 100).toFixed(1)}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-green-500"
                  style={{ width: `${sreData.cache.hitRatio * 100}%` }}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 rounded-md bg-muted/50">
                  <span className="text-muted-foreground">Hits</span>
                  <p className="font-bold">{sreData.cache.totalHits.toLocaleString()}</p>
                </div>
                <div className="p-2 rounded-md bg-muted/50">
                  <span className="text-muted-foreground">Misses</span>
                  <p className="font-bold">{sreData.cache.totalMisses.toLocaleString()}</p>
                </div>
                <div className="p-2 rounded-md bg-muted/50">
                  <span className="text-muted-foreground">Evictions</span>
                  <p className="font-bold">{sreData.cache.evictions}</p>
                </div>
                <div className="p-2 rounded-md bg-muted/50">
                  <span className="text-muted-foreground">Size</span>
                  <p className="font-bold">{(sreData.cache.sizeBytes / 1024 / 1024).toFixed(0)}MB</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-agent-metrics">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Agent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Active</span>
                <span className="font-bold text-blue-500">{sreData.agents.activeAgents}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Queued</span>
                <span className="font-bold">{sreData.agents.queuedTasks}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Completed Today</span>
                <span className="font-bold text-green-500">{sreData.agents.completedToday}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Failed Today</span>
                <span className={cn("font-bold", sreData.agents.failedToday > 5 ? "text-red-500" : "text-muted-foreground")}>
                  {sreData.agents.failedToday}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Avg Duration</span>
                <span className="font-bold">{(sreData.agents.avgTaskDurationMs / 1000).toFixed(1)}s</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-budget-events">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Budget SSE Events</CardTitle>
              <Badge variant="outline" className="text-[10px]">
                {budgetEvents.length} events
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5 max-h-52 overflow-y-auto">
              {budgetEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  {sseConnected ? "Waiting for events..." : "SSE not connected"}
                </p>
              ) : (
                budgetEvents
                  .slice()
                  .reverse()
                  .slice(0, 20)
                  .map((evt, i) => (
                    <div
                      key={`${evt.timestamp}-${i}`}
                      className="flex items-center gap-2 py-1 px-2 rounded text-xs bg-muted/30 hover:bg-muted/50"
                      data-testid={`row-budget-event-${i}`}
                    >
                      <Badge
                        variant={
                          evt.type.includes("stop") || evt.type.includes("spike")
                            ? "destructive"
                            : evt.type.includes("warn")
                              ? "outline"
                              : "secondary"
                        }
                        className="text-[9px] shrink-0"
                      >
                        {evt.type}
                      </Badge>
                      <span className="text-muted-foreground truncate">
                        {new Date(evt.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-sessions-resources">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Resource Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <div className="flex items-center gap-3 p-3 rounded-md bg-muted/30">
              <Users className="h-5 w-5 text-blue-500 shrink-0" />
              <div>
                <p className="text-muted-foreground text-xs">Active Sessions</p>
                <p className="font-bold" data-testid="text-active-sessions">{sreData.resources.activeSessions}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-md bg-muted/30">
              <HardDrive className="h-5 w-5 text-purple-500 shrink-0" />
              <div>
                <p className="text-muted-foreground text-xs">Cache Size</p>
                <p className="font-bold">
                  {(sreData.cache.sizeBytes / 1024 / 1024).toFixed(0)}MB / {(sreData.cache.maxSizeBytes / 1024 / 1024).toFixed(0)}MB
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-md bg-muted/30">
              <Activity className="h-5 w-5 text-green-500 shrink-0" />
              <div>
                <p className="text-muted-foreground text-xs">Total Req/min</p>
                <p className="font-bold">
                  {sreData.providers.reduce((s, p) => s + p.requestsPerMin, 0)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-md bg-muted/30">
              <Shield className="h-5 w-5 text-orange-500 shrink-0" />
              <div>
                <p className="text-muted-foreground text-xs">Circuit Breakers Open</p>
                <p className={cn("font-bold", sreData.providers.filter((p) => p.circuitBreakerState === "open").length > 0 ? "text-red-500" : "")}>
                  {sreData.providers.filter((p) => p.circuitBreakerState === "open").length} / {sreData.providers.length}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
