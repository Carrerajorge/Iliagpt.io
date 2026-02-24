import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, useSpring, useTransform } from "framer-motion";
import { 
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Users,
  Activity,
  Coins,
  DollarSign,
  Clock,
  AlertTriangle,
  RefreshCw,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Filter,
  Calendar,
  Search,
  TrendingUp,
  TrendingDown,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { formatZonedDateTime, normalizeTimeZone } from "@/lib/platformDateTime";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type TimeGranularity = "1h" | "24h" | "7d" | "30d" | "90d" | "1y";

const GRANULARITY_OPTIONS: { value: TimeGranularity; label: string }[] = [
  { value: "1h", label: "1 Hour" },
  { value: "24h", label: "24 Hours" },
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
  { value: "90d", label: "90 Days" },
  { value: "1y", label: "1 Year" },
];

const PROVIDER_COLORS: Record<string, string> = {
  xai: "#8b5cf6",
  gemini: "#3b82f6",
  openai: "#10b981",
  anthropic: "#f59e0b",
  mistral: "#ef4444",
  default: "#6b7280",
};

const MODEL_COLORS = ["#8b5cf6", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4"];

function AnimatedCounter({ value, duration = 1 }: { value: number; duration?: number }) {
  const spring = useSpring(0, { duration: duration * 1000 });
  const display = useTransform(spring, (latest) => {
    if (value >= 1000000) return `${(latest / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(latest / 1000).toFixed(1)}K`;
    return Math.floor(latest).toLocaleString();
  });

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  return <motion.span>{display}</motion.span>;
}

function AnimatedPercentage({ value, duration = 1 }: { value: number; duration?: number }) {
  const spring = useSpring(0, { duration: duration * 1000 });
  const display = useTransform(spring, (latest) => `${latest.toFixed(2)}%`);

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  return <motion.span>{display}</motion.span>;
}

function AnimatedCurrency({ value, currency = "€", duration = 1 }: { value: number; currency?: string; duration?: number }) {
  const spring = useSpring(0, { duration: duration * 1000 });
  const display = useTransform(spring, (latest) => {
    if (latest >= 1000000) return `${currency}${(latest / 1000000).toFixed(2)}M`;
    if (latest >= 1000) return `${currency}${(latest / 1000).toFixed(1)}K`;
    return `${currency}${latest.toFixed(2)}`;
  });

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  return <motion.span>{display}</motion.span>;
}

function KPICard({
  title,
  value,
  icon: Icon,
  trend,
  trendValue,
  format: formatType = "number",
  color = "blue",
  testId,
}: {
  title: string;
  value: number;
  icon: React.ElementType;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  format?: "number" | "percentage" | "currency" | "latency";
  color?: string;
  testId: string;
}) {
  const colorClasses: Record<string, { bg: string; text: string }> = {
    blue: { bg: "bg-blue-500/10", text: "text-blue-500" },
    green: { bg: "bg-green-500/10", text: "text-green-500" },
    purple: { bg: "bg-purple-500/10", text: "text-purple-500" },
    orange: { bg: "bg-orange-500/10", text: "text-orange-500" },
    cyan: { bg: "bg-cyan-500/10", text: "text-cyan-500" },
    red: { bg: "bg-red-500/10", text: "text-red-500" },
  };

  const { bg, text } = colorClasses[color] || colorClasses.blue;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-lg border p-4 hover:border-primary/50 transition-colors"
      data-testid={testId}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={cn("p-2 rounded-md", bg)}>
            <Icon className={cn("h-4 w-4", text)} />
          </div>
          <span className="text-sm font-medium">{title}</span>
        </div>
        {trend && (
          <div className={cn("flex items-center gap-1 text-xs", trend === "up" ? "text-green-500" : trend === "down" ? "text-red-500" : "text-muted-foreground")}>
            {trend === "up" ? <TrendingUp className="h-3 w-3" /> : trend === "down" ? <TrendingDown className="h-3 w-3" /> : null}
            {trendValue}
          </div>
        )}
      </div>
      <p className="text-2xl font-bold">
        {formatType === "number" && <AnimatedCounter value={value} />}
        {formatType === "percentage" && <AnimatedPercentage value={value} />}
        {formatType === "currency" && <AnimatedCurrency value={value} />}
        {formatType === "latency" && (
          <>
            <AnimatedCounter value={value} />
            <span className="text-sm font-normal text-muted-foreground">ms</span>
          </>
        )}
      </p>
    </motion.div>
  );
}

function KPICardsSection({ data }: { data: any }) {
  const kpis = data || {};
  
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      <KPICard
        title="Active Users Now"
        value={kpis.activeUsers || 0}
        icon={Users}
        trend={kpis.activeUsersTrend}
        trendValue={kpis.activeUsersTrendValue}
        color="blue"
        testId="kpi-active-users"
      />
      <KPICard
        title="Queries/Minute"
        value={kpis.queriesPerMinute || 0}
        icon={Activity}
        trend={kpis.queriesTrend}
        trendValue={kpis.queriesTrendValue}
        color="purple"
        testId="kpi-queries-minute"
      />
      <KPICard
        title="Tokens Today"
        value={kpis.tokensConsumed || 0}
        icon={Coins}
        trend={kpis.tokensTrend}
        trendValue={kpis.tokensTrendValue}
        color="cyan"
        testId="kpi-tokens-consumed"
      />
      <KPICard
        title="Revenue Today"
        value={kpis.revenueToday || 0}
        icon={DollarSign}
        format="currency"
        trend={kpis.revenueTrend}
        trendValue={kpis.revenueTrendValue}
        color="green"
        testId="kpi-revenue-today"
      />
      <KPICard
        title="Avg Latency"
        value={kpis.avgLatency || 0}
        icon={Clock}
        format="latency"
        trend={kpis.latencyTrend}
        trendValue={kpis.latencyTrendValue}
        color="orange"
        testId="kpi-avg-latency"
      />
      <KPICard
        title="Error Rate"
        value={kpis.errorRate || 0}
        icon={AlertTriangle}
        format="percentage"
        trend={kpis.errorRateTrend}
        trendValue={kpis.errorRateTrendValue}
        color="red"
        testId="kpi-error-rate"
      />
    </div>
  );
}

function GranularitySelector({
  value,
  onChange,
}: {
  value: TimeGranularity;
  onChange: (value: TimeGranularity) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[120px]" data-testid="select-granularity">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {GRANULARITY_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function UserGrowthChart({ data, granularity }: { data: any[]; granularity: TimeGranularity }) {
  return (
    <Card data-testid="chart-user-growth">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">User Growth</CardTitle>
        <CardDescription>New users over time</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="userGrowthGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} className="text-muted-foreground" />
            <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
            <RechartsTooltip
              contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
              labelStyle={{ color: "hsl(var(--foreground))" }}
            />
            <Area
              type="monotone"
              dataKey="users"
              stroke="#3b82f6"
              fill="url(#userGrowthGradient)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function RevenueTrendChart({ data, granularity }: { data: any[]; granularity: TimeGranularity }) {
  return (
    <Card data-testid="chart-revenue-trend">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Revenue Trend</CardTitle>
        <CardDescription>Revenue over time</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.2} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} className="text-muted-foreground" />
            <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" tickFormatter={(v) => `€${v}`} />
            <RechartsTooltip
              contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
              labelStyle={{ color: "hsl(var(--foreground))" }}
              formatter={(value: number) => [`€${value.toFixed(2)}`, "Revenue"]}
            />
            <Line
              type="monotone"
              dataKey="revenue"
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#10b981" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function ModelUsageChart({ data, granularity }: { data: any[]; granularity: TimeGranularity }) {
  const models = useMemo(() => {
    if (!data?.length) return [];
    const modelKeys = Object.keys(data[0] || {}).filter((k) => k !== "date");
    return modelKeys;
  }, [data]);

  return (
    <Card data-testid="chart-model-usage">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Model Usage</CardTitle>
        <CardDescription>Requests by model</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} className="text-muted-foreground" />
            <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
            <RechartsTooltip
              contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
              labelStyle={{ color: "hsl(var(--foreground))" }}
            />
            <Legend />
            {models.map((model, idx) => (
              <Bar
                key={model}
                dataKey={model}
                stackId="models"
                fill={MODEL_COLORS[idx % MODEL_COLORS.length]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function LatencyByProviderChart({ data, granularity }: { data: any[]; granularity: TimeGranularity }) {
  const providers = useMemo(() => {
    if (!data?.length) return [];
    return Object.keys(data[0] || {}).filter((k) => k !== "date");
  }, [data]);

  return (
    <Card data-testid="chart-latency-provider">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Latency by Provider</CardTitle>
        <CardDescription>Response time comparison (ms)</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} className="text-muted-foreground" />
            <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" tickFormatter={(v) => `${v}ms`} />
            <RechartsTooltip
              contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
              labelStyle={{ color: "hsl(var(--foreground))" }}
              formatter={(value: number, name: string) => [`${value}ms`, name]}
            />
            <Legend />
            {providers.map((provider) => (
              <Line
                key={provider}
                type="monotone"
                dataKey={provider}
                stroke={PROVIDER_COLORS[provider.toLowerCase()] || PROVIDER_COLORS.default}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function ErrorRateChart({ data, granularity }: { data: any[]; granularity: TimeGranularity }) {
  return (
    <Card data-testid="chart-error-rate">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Error Rate</CardTitle>
        <CardDescription>Error percentage over time (5% threshold)</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="errorGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} className="text-muted-foreground" />
            <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" tickFormatter={(v) => `${v}%`} domain={[0, 10]} />
            <RechartsTooltip
              contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
              labelStyle={{ color: "hsl(var(--foreground))" }}
              formatter={(value: number) => [`${value.toFixed(2)}%`, "Error Rate"]}
            />
            <ReferenceLine y={5} stroke="#f59e0b" strokeDasharray="5 5" label={{ value: "5% threshold", fill: "#f59e0b", fontSize: 10 }} />
            <Area
              type="monotone"
              dataKey="errorRate"
              stroke="#ef4444"
              fill="url(#errorGradient)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function TokenConsumptionChart({ data, granularity }: { data: any[]; granularity: TimeGranularity }) {
  const models = useMemo(() => {
    if (!data?.length) return [];
    return Object.keys(data[0] || {}).filter((k) => k !== "date");
  }, [data]);

  return (
    <Card data-testid="chart-token-consumption">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Token Consumption</CardTitle>
        <CardDescription>Tokens used by model</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} className="text-muted-foreground" />
            <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" tickFormatter={(v) => v >= 1000 ? `${v / 1000}K` : v} />
            <RechartsTooltip
              contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
              labelStyle={{ color: "hsl(var(--foreground))" }}
              formatter={(value: number, name: string) => [value.toLocaleString(), name]}
            />
            <Legend />
            {models.map((model, idx) => (
              <Bar
                key={model}
                dataKey={model}
                fill={MODEL_COLORS[idx % MODEL_COLORS.length]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function ChartsSection({ granularity, onGranularityChange }: { granularity: TimeGranularity; onGranularityChange: (g: TimeGranularity) => void }) {
  const { data: chartsData, isLoading } = useQuery({
    queryKey: ["/api/admin/analytics/charts", granularity],
    queryFn: async () => {
      const res = await fetch(`/api/admin/analytics/charts?granularity=${granularity}`, {
        credentials: "include",
      });
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const charts = chartsData || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Analytics Charts</h3>
        <GranularitySelector value={granularity} onChange={onGranularityChange} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <UserGrowthChart data={charts.userGrowth || []} granularity={granularity} />
        <RevenueTrendChart data={charts.revenueTrend || []} granularity={granularity} />
        <ModelUsageChart data={charts.modelUsage || []} granularity={granularity} />
        <LatencyByProviderChart data={charts.latencyByProvider || []} granularity={granularity} />
        <ErrorRateChart data={charts.errorRate || []} granularity={granularity} />
        <TokenConsumptionChart data={charts.tokenConsumption || []} granularity={granularity} />
      </div>
    </div>
  );
}

function PerformanceTable({ data }: { data: any[] }) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case "healthy": return "success";
      case "degraded": return "warning";
      case "down": return "destructive";
      default: return "secondary";
    }
  };

  const getSuccessRateColor = (rate: number) => {
    if (rate >= 99) return "text-green-500";
    if (rate >= 95) return "text-yellow-500";
    return "text-red-500";
  };

  return (
    <Card data-testid="table-performance">
      <CardHeader>
        <CardTitle className="text-base">Provider Performance</CardTitle>
        <CardDescription>Real-time provider metrics and health status</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead className="text-right">Avg Latency</TableHead>
              <TableHead className="text-right">P50</TableHead>
              <TableHead className="text-right">P95</TableHead>
              <TableHead className="text-right">P99</TableHead>
              <TableHead className="text-right">Success Rate</TableHead>
              <TableHead className="text-right">Total Requests</TableHead>
              <TableHead className="text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data || []).map((item: any) => {
              const providerName = item.name || item.provider || "unknown";
              const successRate = typeof item.successRate === 'number' ? item.successRate : parseFloat(item.successRate || "100");
              return (
                <TableRow key={providerName} data-testid={`row-provider-${providerName}`}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: PROVIDER_COLORS[providerName.toLowerCase()] || PROVIDER_COLORS.default }}
                      />
                      <span className="font-medium">{providerName}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono">{item.avgLatency || 0}ms</TableCell>
                  <TableCell className="text-right font-mono">{item.p50 || 0}ms</TableCell>
                  <TableCell className="text-right font-mono">{item.p95 || 0}ms</TableCell>
                  <TableCell className="text-right font-mono">{item.p99 || 0}ms</TableCell>
                  <TableCell className={cn("text-right font-mono", getSuccessRateColor(successRate))}>
                    {successRate.toFixed(2)}%
                  </TableCell>
                  <TableCell className="text-right font-mono">{(item.totalRequests || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={getStatusColor(item.status || "healthy")}>
                      {item.status || "healthy"}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function CostTrackingPanel({ data }: { data: any[] }) {
  const getProgressColor = (percentage: number) => {
    if (percentage >= 80) return "bg-red-500";
    if (percentage >= 60) return "bg-yellow-500";
    return "bg-green-500";
  };

  return (
    <div className="space-y-4" data-testid="panel-cost-tracking">
      <h3 className="text-lg font-medium">Cost Tracking</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(data || []).map((item: any) => {
          const providerName = item.name || item.provider || "unknown";
          const currentSpend = parseFloat(item.currentSpend || "0");
          const budgetLimit = parseFloat(item.budgetLimit || "100");
          const percentage = budgetLimit > 0 ? (currentSpend / budgetLimit) * 100 : 0;
          const isOverThreshold = percentage > 80;

          return (
            <Card key={providerName} data-testid={`card-cost-${providerName}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: PROVIDER_COLORS[providerName.toLowerCase()] || PROVIDER_COLORS.default }}
                    />
                    <CardTitle className="text-sm font-medium">{providerName}</CardTitle>
                  </div>
                  {isOverThreshold && (
                    <Badge variant="destructive" className="text-xs">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Over 80%
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Current Spend</span>
                  <span className="font-medium">€{currentSpend.toFixed(4)}</span>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{percentage.toFixed(0)}% of budget</span>
                    <span>€{budgetLimit.toFixed(2)}</span>
                  </div>
                  <div className="relative h-2 w-full overflow-hidden rounded-full bg-primary/20">
                    <div
                      className={cn("h-full transition-all", getProgressColor(percentage))}
                      style={{ width: `${Math.min(percentage, 100)}%` }}
                    />
                  </div>
                </div>
                <div className="flex justify-between text-sm pt-2 border-t">
                  <span className="text-muted-foreground">Projected Monthly</span>
                  <span className="font-medium">€{parseFloat(item.projectedMonthly || "0").toFixed(2)}</span>
                </div>
                {isOverThreshold && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-md p-2 text-xs text-red-500">
                    Budget threshold exceeded. Consider reviewing usage or increasing limits.
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function APILogsExplorer() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    provider: "all",
    status: "all",
    search: "",
    dateFrom: "",
    dateTo: "",
  });
  const [selectedLog, setSelectedLog] = useState<any>(null);
  const itemsPerPage = 20;
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);
  const platformDateFormat = platformSettings.date_format;

  const { data, isLoading } = useQuery({
    queryKey: ["/api/admin/analytics/logs", page, filters],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: itemsPerPage.toString(),
        ...Object.fromEntries(Object.entries(filters).filter(([_, v]) => v && v !== "all")),
      });
      const res = await fetch(`/api/admin/analytics/logs?${params}`, {
        credentials: "include",
      });
      return res.json();
    },
  });

  const logs = data?.logs || [];
  const totalPages = data?.totalPages || 1;

  const getMethodColor = (method: string) => {
    switch (method.toUpperCase()) {
      case "GET": return "bg-blue-500";
      case "POST": return "bg-green-500";
      case "PUT": return "bg-yellow-500";
      case "PATCH": return "bg-orange-500";
      case "DELETE": return "bg-red-500";
      default: return "bg-gray-500";
    }
  };

  const getStatusColor = (status: number) => {
    if (status >= 500) return "destructive";
    if (status >= 400) return "warning";
    if (status >= 200 && status < 300) return "success";
    return "secondary";
  };

  return (
    <Card data-testid="panel-api-logs">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base">API Logs Explorer</CardTitle>
            <CardDescription>Browse and filter API request logs</CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                className="pl-8 w-[150px]"
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                data-testid="input-logs-search"
              />
            </div>
            <Select value={filters.provider} onValueChange={(v) => setFilters({ ...filters, provider: v })}>
              <SelectTrigger className="w-[120px]" data-testid="select-logs-provider">
                <SelectValue placeholder="Provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="xai">xAI</SelectItem>
                <SelectItem value="gemini">Gemini</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
              <SelectTrigger className="w-[110px]" data-testid="select-logs-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="2xx">2xx Success</SelectItem>
                <SelectItem value="4xx">4xx Error</SelectItem>
                <SelectItem value="5xx">5xx Error</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              className="w-[140px]"
              value={filters.dateFrom}
              onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
              data-testid="input-logs-date-from"
            />
            <Input
              type="date"
              className="w-[140px]"
              value={filters.dateTo}
              onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
              data-testid="input-logs-date-to"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Endpoint</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Latency</TableHead>
                    <TableHead className="text-right">Tokens In</TableHead>
                    <TableHead className="text-right">Tokens Out</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead className="text-center">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log: any, idx: number) => (
                      <TableRow key={log.id || idx} data-testid={`row-log-${log.id || idx}`}>
                      <TableCell className="font-mono text-xs">
                        {log.timestamp ? formatZonedDateTime(log.timestamp, { timeZone: platformTimeZone, dateFormat: platformDateFormat, includeYear: false, includeSeconds: true }) : "-"}
                      </TableCell>
                      <TableCell className="text-sm truncate max-w-[100px]">{log.user || "Anonymous"}</TableCell>
                      <TableCell className="font-mono text-xs truncate max-w-[150px]">{log.endpoint}</TableCell>
                      <TableCell>
                        <span className={cn("px-1.5 py-0.5 rounded text-xs text-white font-medium", getMethodColor(log.method))}>
                          {log.method}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusColor(log.status)}>{log.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{log.latency}ms</TableCell>
                      <TableCell className="text-right font-mono text-xs">{log.tokensIn?.toLocaleString() || "-"}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{log.tokensOut?.toLocaleString() || "-"}</TableCell>
                      <TableCell className="text-xs">{log.model || "-"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: PROVIDER_COLORS[log.provider?.toLowerCase()] || PROVIDER_COLORS.default }}
                          />
                          <span className="text-xs">{log.provider || "-"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="sm" onClick={() => setSelectedLog(log)} data-testid={`button-view-log-${log.id || idx}`}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl">
                            <DialogHeader>
                              <DialogTitle>Request Details</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4">
                              <div>
                                <h4 className="text-sm font-medium mb-2">Request Preview</h4>
                                <pre className="bg-muted p-3 rounded-md text-xs overflow-auto max-h-[200px]">
                                  {log.requestPreview || "No request data"}
                                </pre>
                              </div>
                              <div>
                                <h4 className="text-sm font-medium mb-2">Response Preview</h4>
                                <pre className="bg-muted p-3 rounded-md text-xs overflow-auto max-h-[200px]">
                                  {log.responsePreview || "No response data"}
                                </pre>
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  data-testid="button-logs-prev"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  data-testid="button-logs-next"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function UsageHeatmap({ data }: { data: number[][] }) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const maxValue = useMemo(() => {
    if (!data?.length) return 1;
    return Math.max(...data.flat());
  }, [data]);

  const getColor = (value: number) => {
    if (!value) return "bg-muted";
    const intensity = value / maxValue;
    if (intensity > 0.8) return "bg-purple-600";
    if (intensity > 0.6) return "bg-purple-500";
    if (intensity > 0.4) return "bg-purple-400";
    if (intensity > 0.2) return "bg-purple-300";
    return "bg-purple-200";
  };

  return (
    <Card data-testid="panel-usage-heatmap">
      <CardHeader>
        <CardTitle className="text-base">Usage Heatmap</CardTitle>
        <CardDescription>Query volume by hour and day of week</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            <div className="flex mb-1">
              <div className="w-10" />
              {hours.map((hour) => (
                <div key={hour} className="flex-1 text-center text-[10px] text-muted-foreground">
                  {hour % 4 === 0 ? `${hour}h` : ""}
                </div>
              ))}
            </div>
            {days.map((day, dayIdx) => (
              <div key={day} className="flex items-center gap-0.5 mb-0.5">
                <div className="w-10 text-xs text-muted-foreground">{day}</div>
                {hours.map((hour) => {
                  const value = data?.[dayIdx]?.[hour] || 0;
                  return (
                    <TooltipProvider key={`${dayIdx}-${hour}`}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className={cn("flex-1 h-5 rounded-sm transition-colors cursor-pointer hover:ring-1 hover:ring-primary", getColor(value))}
                            data-testid={`heatmap-cell-${dayIdx}-${hour}`}
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">{day} {hour}:00 - {hour + 1}:00</p>
                          <p className="text-xs font-medium">{value.toLocaleString()} queries</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  );
                })}
              </div>
            ))}
            <div className="flex items-center justify-end gap-2 mt-3">
              <span className="text-xs text-muted-foreground">Less</span>
              {["bg-muted", "bg-purple-200", "bg-purple-300", "bg-purple-400", "bg-purple-500", "bg-purple-600"].map((color, i) => (
                <div key={i} className={cn("w-4 h-4 rounded-sm", color)} />
              ))}
              <span className="text-xs text-muted-foreground">More</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AnalyticsDashboard() {
  const [granularity, setGranularity] = useState<TimeGranularity>("24h");
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);
  const platformDateFormat = platformSettings.date_format;

  const { data: kpiData, isLoading: kpiLoading, refetch: refetchKpi } = useQuery({
    queryKey: ["/api/admin/analytics/kpi"],
    queryFn: async () => {
      const res = await fetch("/api/admin/analytics/kpi", { credentials: "include" });
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: performanceData, isLoading: perfLoading } = useQuery({
    queryKey: ["/api/admin/analytics/performance"],
    queryFn: async () => {
      const res = await fetch("/api/admin/analytics/performance", { credentials: "include" });
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: costData, isLoading: costLoading } = useQuery({
    queryKey: ["/api/admin/analytics/costs"],
    queryFn: async () => {
      const res = await fetch("/api/admin/analytics/costs", { credentials: "include" });
      return res.json();
    },
  });

  const { data: heatmapData, isLoading: heatmapLoading } = useQuery({
    queryKey: ["/api/admin/analytics/heatmap"],
    queryFn: async () => {
      const res = await fetch("/api/admin/analytics/heatmap", { credentials: "include" });
      return res.json();
    },
  });

  return (
    <div className="space-y-6" data-testid="analytics-dashboard">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Analytics Dashboard</h2>
          <p className="text-sm text-muted-foreground">Real-time platform metrics and insights</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetchKpi()} data-testid="button-refresh-analytics">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="charts" data-testid="tab-charts">Charts</TabsTrigger>
          <TabsTrigger value="performance" data-testid="tab-performance">Performance</TabsTrigger>
          <TabsTrigger value="costs" data-testid="tab-costs">Costs</TabsTrigger>
          <TabsTrigger value="logs" data-testid="tab-logs">API Logs</TabsTrigger>
          <TabsTrigger value="heatmap" data-testid="tab-heatmap">Heatmap</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {kpiLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <>
              <KPICardsSection data={kpiData} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {!perfLoading && <PerformanceTable data={Array.isArray(performanceData) ? performanceData : []} />}
                {!heatmapLoading && <UsageHeatmap data={heatmapData?.data || heatmapData?.heatmap || []} />}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="charts">
          <ChartsSection granularity={granularity} onGranularityChange={setGranularity} />
        </TabsContent>

        <TabsContent value="performance">
          {perfLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <PerformanceTable data={Array.isArray(performanceData) ? performanceData : []} />
          )}
        </TabsContent>

        <TabsContent value="costs">
          {costLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <CostTrackingPanel data={Array.isArray(costData) ? costData : []} />
          )}
        </TabsContent>

        <TabsContent value="logs">
          <APILogsExplorer />
        </TabsContent>

        <TabsContent value="heatmap">
          {heatmapLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <UsageHeatmap data={heatmapData?.data || heatmapData?.heatmap || []} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
