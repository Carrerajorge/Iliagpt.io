import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { apiFetchJson } from "@/lib/adminApi";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Activity,
  AlertTriangle,
  RefreshCw,
  Download,
  Loader2,
  Zap,
  BarChart3,
  Clock,
  Bell,
  BellOff,
  Settings,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
  AreaChart,
  Area,
} from "recharts";

interface ModelCostEntry {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  runCount: number;
}

interface DailyTrend {
  date: string;
  costUsd: number;
  tokens: number;
  runs: number;
}

interface TopRun {
  runId: string;
  model: string;
  costUsd: number;
  tokens: number;
  timestamp: string;
  duration: number;
}

interface BudgetAlert {
  id: string;
  type: "warning" | "critical";
  threshold: number;
  enabled: boolean;
  notifyEmail: boolean;
}

interface BudgetData {
  totalCostUsd: number;
  totalTokens: number;
  totalRuns: number;
  budgetLimitUsd: number;
  budgetUsedPct: number;
  costToday: number;
  costThisWeek: number;
  costThisMonth: number;
  avgCostPerRun: number;
  modelBreakdown: ModelCostEntry[];
  dailyTrends: DailyTrend[];
  topCostRuns: TopRun[];
  alerts: BudgetAlert[];
}

const CHART_COLORS = [
  "#6366f1",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ef4444",
  "#14b8a6",
  "#f97316",
  "#06b6d4",
];

function generateMockData(): BudgetData {
  const models = [
    "openai/gpt-4o",
    "openai/gpt-4o-mini",
    "anthropic/claude-3.5-sonnet",
    "google/gemini-pro-1.5",
    "google/gemini-flash-1.5",
    "deepseek/deepseek-chat",
    "meta-llama/llama-3.1-70b-instruct",
    "minimax/minimax-m2.5",
  ];

  const modelBreakdown: ModelCostEntry[] = models.map((model) => {
    const runCount = Math.floor(Math.random() * 200) + 10;
    const promptTokens = Math.floor(Math.random() * 500000) + 10000;
    const completionTokens = Math.floor(Math.random() * 200000) + 5000;
    const costUsd = parseFloat((Math.random() * 15 + 0.5).toFixed(4));
    return {
      model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      costUsd,
      runCount,
    };
  });

  const totalCostUsd = modelBreakdown.reduce((s, m) => s + m.costUsd, 0);
  const totalTokens = modelBreakdown.reduce((s, m) => s + m.totalTokens, 0);
  const totalRuns = modelBreakdown.reduce((s, m) => s + m.runCount, 0);

  const dailyTrends: DailyTrend[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dailyTrends.push({
      date: d.toISOString().slice(0, 10),
      costUsd: parseFloat((Math.random() * 5 + 0.5).toFixed(4)),
      tokens: Math.floor(Math.random() * 100000) + 5000,
      runs: Math.floor(Math.random() * 50) + 5,
    });
  }

  const topCostRuns: TopRun[] = Array.from({ length: 10 }, (_, i) => ({
    runId: `run-${Date.now()}-${i}`,
    model: models[Math.floor(Math.random() * models.length)],
    costUsd: parseFloat((Math.random() * 2 + 0.1).toFixed(4)),
    tokens: Math.floor(Math.random() * 50000) + 1000,
    timestamp: new Date(Date.now() - Math.random() * 86400000 * 7).toISOString(),
    duration: Math.floor(Math.random() * 120) + 5,
  })).sort((a, b) => b.costUsd - a.costUsd);

  return {
    totalCostUsd: parseFloat(totalCostUsd.toFixed(4)),
    totalTokens,
    totalRuns,
    budgetLimitUsd: 100,
    budgetUsedPct: parseFloat(((totalCostUsd / 100) * 100).toFixed(1)),
    costToday: parseFloat(dailyTrends[dailyTrends.length - 1].costUsd.toFixed(4)),
    costThisWeek: parseFloat(
      dailyTrends
        .slice(-7)
        .reduce((s, d) => s + d.costUsd, 0)
        .toFixed(4)
    ),
    costThisMonth: parseFloat(totalCostUsd.toFixed(4)),
    avgCostPerRun: parseFloat((totalCostUsd / totalRuns).toFixed(6)),
    modelBreakdown,
    dailyTrends,
    topCostRuns,
    alerts: [
      { id: "1", type: "warning", threshold: 80, enabled: true, notifyEmail: true },
      { id: "2", type: "critical", threshold: 95, enabled: true, notifyEmail: true },
    ],
  };
}

export default function BudgetDashboard() {
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("daily");
  const [alertsExpanded, setAlertsExpanded] = useState(false);
  const [budgetAlerts, setBudgetAlerts] = useState<BudgetAlert[]>([
    { id: "1", type: "warning", threshold: 80, enabled: true, notifyEmail: true },
    { id: "2", type: "critical", threshold: 95, enabled: true, notifyEmail: true },
  ]);

  const { data, isLoading, refetch } = useQuery<BudgetData>({
    queryKey: ["/api/admin/budget"],
    queryFn: () => apiFetchJson("/api/admin/budget"),
    refetchInterval: 15000,
    throwOnError: true,
  });

  const budgetData = data || generateMockData();

  const trendData = useMemo(() => {
    if (!budgetData.dailyTrends) return [];
    if (period === "daily") return budgetData.dailyTrends;
    if (period === "weekly") {
      const weeks: DailyTrend[] = [];
      for (let i = 0; i < budgetData.dailyTrends.length; i += 7) {
        const chunk = budgetData.dailyTrends.slice(i, i + 7);
        weeks.push({
          date: chunk[0].date,
          costUsd: parseFloat(chunk.reduce((s, d) => s + d.costUsd, 0).toFixed(4)),
          tokens: chunk.reduce((s, d) => s + d.tokens, 0),
          runs: chunk.reduce((s, d) => s + d.runs, 0),
        });
      }
      return weeks;
    }
    return budgetData.dailyTrends;
  }, [budgetData.dailyTrends, period]);

  const pieData = useMemo(() => {
    return (budgetData.modelBreakdown || [])
      .sort((a, b) => b.costUsd - a.costUsd)
      .slice(0, 8)
      .map((m) => ({
        name: m.model.split("/").pop() || m.model,
        value: parseFloat(m.costUsd.toFixed(4)),
        fullName: m.model,
      }));
  }, [budgetData.modelBreakdown]);

  const exportCsv = () => {
    const headers = ["Date,Cost (USD),Tokens,Runs"];
    const rows = (budgetData.dailyTrends || []).map(
      (d) => `${d.date},${d.costUsd},${d.tokens},${d.runs}`
    );
    const csv = [...headers, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `budget-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleAlert = (id: string) => {
    setBudgetAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a))
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="budget-loading">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const budgetPct = budgetData.budgetUsedPct;
  const budgetColor =
    budgetPct >= 95 ? "text-red-500" : budgetPct >= 80 ? "text-yellow-500" : "text-green-500";
  const progressColor =
    budgetPct >= 95 ? "bg-red-500" : budgetPct >= 80 ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className="space-y-6" data-testid="budget-dashboard">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium" data-testid="text-budget-title">
            Budget & Cost Dashboard
          </h2>
          <p className="text-sm text-muted-foreground">
            Real-time token usage and cost tracking
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            data-testid="button-export-csv"
          >
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            data-testid="button-refresh-budget"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card data-testid="card-total-cost">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-md bg-green-500/10">
                <DollarSign className="h-4 w-4 text-green-500" />
              </div>
              <span className="text-sm text-muted-foreground">Total Cost</span>
            </div>
            <p className="text-2xl font-bold" data-testid="text-total-cost">
              ${budgetData.totalCostUsd.toFixed(2)}
            </p>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              <span>${budgetData.costToday.toFixed(4)} today</span>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-total-tokens">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-md bg-blue-500/10">
                <Zap className="h-4 w-4 text-blue-500" />
              </div>
              <span className="text-sm text-muted-foreground">Total Tokens</span>
            </div>
            <p className="text-2xl font-bold" data-testid="text-total-tokens">
              {budgetData.totalTokens.toLocaleString()}
            </p>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              <span>{budgetData.totalRuns} runs</span>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-avg-cost">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-md bg-purple-500/10">
                <Activity className="h-4 w-4 text-purple-500" />
              </div>
              <span className="text-sm text-muted-foreground">Avg Cost/Run</span>
            </div>
            <p className="text-2xl font-bold" data-testid="text-avg-cost">
              ${budgetData.avgCostPerRun.toFixed(4)}
            </p>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              <span>{(budgetData.totalTokens / budgetData.totalRuns).toFixed(0)} tokens/run</span>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-budget-gauge">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3 mb-2">
              <div className={cn("p-2 rounded-md", budgetPct >= 95 ? "bg-red-500/10" : budgetPct >= 80 ? "bg-yellow-500/10" : "bg-green-500/10")}>
                <BarChart3 className={cn("h-4 w-4", budgetColor)} />
              </div>
              <span className="text-sm text-muted-foreground">Budget Used</span>
            </div>
            <p className={cn("text-2xl font-bold", budgetColor)} data-testid="text-budget-pct">
              {budgetPct.toFixed(1)}%
            </p>
            <div className="mt-2">
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", progressColor)}
                  style={{ width: `${Math.min(budgetPct, 100)}%` }}
                />
              </div>
              <div className="flex justify-between mt-1 text-xs text-muted-foreground">
                <span>${budgetData.totalCostUsd.toFixed(2)}</span>
                <span>${budgetData.budgetLimitUsd.toFixed(2)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2" data-testid="card-cost-trend">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Cost Trend</CardTitle>
              <div className="flex items-center gap-1">
                {(["daily", "weekly", "monthly"] as const).map((p) => (
                  <Button
                    key={p}
                    variant={period === p ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 text-xs px-2"
                    onClick={() => setPeriod(p)}
                    data-testid={`button-period-${p}`}
                  >
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v) => v.slice(5)}
                    className="text-xs"
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    tickFormatter={(v) => `$${v}`}
                    className="text-xs"
                    tick={{ fontSize: 11 }}
                    width={50}
                  />
                  <Tooltip
                    formatter={(value: number) => [`$${value.toFixed(4)}`, "Cost"]}
                    labelFormatter={(label) => `Date: ${label}`}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="costUsd"
                    stroke="#6366f1"
                    fill="url(#costGrad)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-model-breakdown-pie">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Cost by Model</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    dataKey="value"
                    nameKey="name"
                    paddingAngle={2}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => `$${value.toFixed(4)}`} />
                  <Legend
                    verticalAlign="bottom"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 10 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-model-breakdown-table">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Per-Model Cost Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Model</th>
                  <th className="py-2 pr-4 font-medium text-right">Runs</th>
                  <th className="py-2 pr-4 font-medium text-right">Prompt Tokens</th>
                  <th className="py-2 pr-4 font-medium text-right">Completion Tokens</th>
                  <th className="py-2 pr-4 font-medium text-right">Total Tokens</th>
                  <th className="py-2 font-medium text-right">Cost (USD)</th>
                </tr>
              </thead>
              <tbody>
                {(budgetData.modelBreakdown || [])
                  .sort((a, b) => b.costUsd - a.costUsd)
                  .map((m, i) => (
                    <tr
                      key={m.model}
                      className="border-b last:border-0 hover:bg-muted/50"
                      data-testid={`row-model-${i}`}
                    >
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                          />
                          <span className="font-mono text-xs">{m.model}</span>
                        </div>
                      </td>
                      <td className="py-2 pr-4 text-right">{m.runCount}</td>
                      <td className="py-2 pr-4 text-right">{m.promptTokens.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right">{m.completionTokens.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right">{m.totalTokens.toLocaleString()}</td>
                      <td className="py-2 text-right font-medium">${m.costUsd.toFixed(4)}</td>
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr className="border-t font-medium">
                  <td className="py-2 pr-4">Total</td>
                  <td className="py-2 pr-4 text-right">{budgetData.totalRuns}</td>
                  <td className="py-2 pr-4 text-right" colSpan={2} />
                  <td className="py-2 pr-4 text-right">{budgetData.totalTokens.toLocaleString()}</td>
                  <td className="py-2 text-right">${budgetData.totalCostUsd.toFixed(4)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card data-testid="card-top-runs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Top Cost Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {(budgetData.topCostRuns || []).map((run, i) => (
                <div
                  key={run.runId}
                  className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50 border"
                  data-testid={`row-top-run-${i}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs truncate">{run.runId.slice(0, 16)}...</span>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {run.model.split("/").pop()}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span>{run.tokens.toLocaleString()} tokens</span>
                      <span>{run.duration}s</span>
                      <span>{new Date(run.timestamp).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <span className="font-bold text-sm ml-3">${run.costUsd.toFixed(4)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-alerts-config">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Budget Alerts</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAlertsExpanded(!alertsExpanded)}
                data-testid="button-toggle-alerts"
              >
                {alertsExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {budgetAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-center justify-between py-2 px-3 rounded-md border"
                  data-testid={`row-alert-${alert.id}`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "p-1.5 rounded-md",
                        alert.type === "critical" ? "bg-red-500/10" : "bg-yellow-500/10"
                      )}
                    >
                      <AlertTriangle
                        className={cn(
                          "h-3.5 w-3.5",
                          alert.type === "critical" ? "text-red-500" : "text-yellow-500"
                        )}
                      />
                    </div>
                    <div>
                      <p className="text-sm font-medium capitalize">{alert.type} Alert</p>
                      <p className="text-xs text-muted-foreground">
                        Triggers at {alert.threshold}% budget used
                      </p>
                    </div>
                  </div>
                  <Button
                    variant={alert.enabled ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => toggleAlert(alert.id)}
                    data-testid={`button-toggle-alert-${alert.id}`}
                  >
                    {alert.enabled ? (
                      <>
                        <Bell className="h-3 w-3 mr-1" /> On
                      </>
                    ) : (
                      <>
                        <BellOff className="h-3 w-3 mr-1" /> Off
                      </>
                    )}
                  </Button>
                </div>
              ))}
            </div>
            {alertsExpanded && (
              <div className="mt-4 pt-4 border-t space-y-3">
                <p className="text-xs text-muted-foreground">
                  Add custom alert thresholds to receive notifications when budget usage exceeds
                  defined limits.
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    placeholder="Threshold %"
                    className="h-8 text-xs w-28"
                    min={1}
                    max={100}
                    data-testid="input-alert-threshold"
                  />
                  <Button size="sm" className="h-8 text-xs" data-testid="button-add-alert">
                    Add Alert
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-token-usage-chart">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Token Usage Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) => v.slice(5)}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 11 }}
                  width={45}
                />
                <Tooltip
                  formatter={(value: number) => [value.toLocaleString(), "Tokens"]}
                  labelFormatter={(label) => `Date: ${label}`}
                  contentStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="tokens" fill="#3b82f6" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card data-testid="card-cost-today">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Clock className="h-3.5 w-3.5" />
              Today
            </div>
            <p className="text-xl font-bold">${budgetData.costToday.toFixed(4)}</p>
          </CardContent>
        </Card>
        <Card data-testid="card-cost-week">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <TrendingUp className="h-3.5 w-3.5" />
              This Week
            </div>
            <p className="text-xl font-bold">${budgetData.costThisWeek.toFixed(4)}</p>
          </CardContent>
        </Card>
        <Card data-testid="card-cost-month">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <BarChart3 className="h-3.5 w-3.5" />
              This Month
            </div>
            <p className="text-xl font-bold">${budgetData.costThisMonth.toFixed(4)}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
