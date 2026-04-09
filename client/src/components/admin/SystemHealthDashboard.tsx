/**
 * System Health Dashboard — Real-time CPU/RAM/Disk monitoring panel.
 *
 * Polls /api/admin/system-metrics every 5s and renders:
 * - Animated radial gauges for CPU, RAM, Disk
 * - Sparkline history for CPU + RAM (last 60 samples)
 * - Process-level memory breakdown (RSS, Heap)
 * - Load averages, uptime, platform info
 */

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import {
  Cpu, MemoryStick, HardDrive, Activity, Clock, Server,
  AlertTriangle, CheckCircle, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { apiFetchJson } from "@/lib/adminApi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SystemMetrics {
  timestamp: number;
  cpu: { percent: number; cores: number[]; loadAvg: [number, number, number]; count: number };
  memory: {
    totalBytes: number; usedBytes: number; percent: number;
    processRssBytes: number; heapUsedBytes: number; heapTotalBytes: number;
  };
  disks: Array<{ mount: string; totalBytes: number; usedBytes: number; availableBytes: number; percent: number }>;
  uptime: { system: number; process: number };
  platform: string;
  hostname: string;
}

interface HistoryResponse {
  snapshots: SystemMetrics[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function severityColor(pct: number): string {
  if (pct >= 90) return "text-red-500";
  if (pct >= 75) return "text-amber-500";
  return "text-emerald-500";
}

function severityBg(pct: number): string {
  if (pct >= 90) return "stroke-red-500";
  if (pct >= 75) return "stroke-amber-500";
  return "stroke-emerald-500";
}

function severityTrack(pct: number): string {
  if (pct >= 90) return "stroke-red-500/15";
  if (pct >= 75) return "stroke-amber-500/15";
  return "stroke-emerald-500/15";
}

// ---------------------------------------------------------------------------
// Radial Gauge component
// ---------------------------------------------------------------------------

function RadialGauge({
  value, label, icon: Icon, subtitle,
}: {
  value: number; label: string; icon: React.ElementType; subtitle?: string;
}) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-24 h-24">
        <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="8" className={severityTrack(value)} />
          <motion.circle
            cx="50" cy="50" r={radius} fill="none" strokeWidth="8"
            strokeLinecap="round"
            className={severityBg(value)}
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("text-lg font-bold tabular-nums", severityColor(value))}>
            {Math.round(value)}%
          </span>
        </div>
      </div>
      <div className="text-center">
        <div className="flex items-center gap-1 justify-center">
          <Icon className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs font-medium">{label}</span>
        </div>
        {subtitle && <span className="text-[10px] text-muted-foreground">{subtitle}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline component
// ---------------------------------------------------------------------------

function Sparkline({ data, color = "stroke-emerald-500", height = 32 }: { data: number[]; color?: string; height?: number }) {
  if (data.length < 2) return null;

  const w = 120;
  const h = height;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" className={color} points={points} />
      {/* Dot on the last point */}
      {data.length > 0 && (() => {
        const lastX = w;
        const lastY = h - ((data[data.length - 1] - min) / range) * (h - 4) - 2;
        return <circle cx={lastX} cy={lastY} r="2" fill="currentColor" className={color} />;
      })()}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------

export function SystemHealthDashboard() {
  const { data: metrics } = useQuery<SystemMetrics>({
    queryKey: ["/api/admin/system-metrics"],
    queryFn: () => apiFetchJson("/api/admin/system-metrics"),
    refetchInterval: 5000,
  });

  const { data: historyData } = useQuery<HistoryResponse>({
    queryKey: ["/api/admin/system-metrics/history"],
    queryFn: () => apiFetchJson("/api/admin/system-metrics/history"),
    refetchInterval: 10000,
  });

  if (!metrics) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-8">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Activity className="h-4 w-4 animate-pulse" />
            <span className="text-sm">Recopilando métricas del sistema...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const cpuHistory = historyData?.snapshots?.map((s) => s.cpu.percent) || [];
  const ramHistory = historyData?.snapshots?.map((s) => s.memory.percent) || [];
  const disk = metrics.disks[0];

  const overallHealth = metrics.cpu.percent < 90 && metrics.memory.percent < 90 && (!disk || disk.percent < 90);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">System Health</span>
          </div>
          <Badge variant={overallHealth ? "default" : "destructive"} className="gap-1 text-xs">
            {overallHealth
              ? <><CheckCircle className="h-3 w-3" /> Healthy</>
              : <><AlertTriangle className="h-3 w-3" /> Warning</>}
          </Badge>
        </div>

        {/* Gauges row */}
        <div className="flex justify-around items-start py-2">
          <RadialGauge
            value={metrics.cpu.percent}
            label="CPU"
            icon={Cpu}
            subtitle={`${metrics.cpu.count} cores`}
          />
          <RadialGauge
            value={metrics.memory.percent}
            label="RAM"
            icon={MemoryStick}
            subtitle={`${formatBytes(metrics.memory.usedBytes)} / ${formatBytes(metrics.memory.totalBytes)}`}
          />
          {disk && (
            <RadialGauge
              value={disk.percent}
              label="Disco"
              icon={HardDrive}
              subtitle={`${formatBytes(disk.usedBytes)} / ${formatBytes(disk.totalBytes)}`}
            />
          )}
        </div>

        {/* Sparklines */}
        {cpuHistory.length > 3 && (
          <div className="grid grid-cols-2 gap-4 px-2">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="h-2.5 w-2.5" /> CPU (5min)
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">{metrics.cpu.percent}%</span>
              </div>
              <Sparkline data={cpuHistory} color={severityBg(metrics.cpu.percent).replace("stroke-", "text-")} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="h-2.5 w-2.5" /> RAM (5min)
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">{metrics.memory.percent}%</span>
              </div>
              <Sparkline data={ramHistory} color={severityBg(metrics.memory.percent).replace("stroke-", "text-")} />
            </div>
          </div>
        )}

        {/* Detail stats */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 px-2 pt-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Load Avg</span>
                <span className="tabular-nums font-medium">
                  {metrics.cpu.loadAvg.map((v) => v.toFixed(2)).join(" / ")}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>1min / 5min / 15min load averages</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Process RSS</span>
                <span className="tabular-nums font-medium">{formatBytes(metrics.memory.processRssBytes)}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>Node.js process resident set size</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Heap</span>
                <span className="tabular-nums font-medium">
                  {formatBytes(metrics.memory.heapUsedBytes)} / {formatBytes(metrics.memory.heapTotalBytes)}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>V8 heap used / allocated</TooltipContent>
          </Tooltip>

          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" /> Uptime
            </span>
            <span className="tabular-nums font-medium">{formatUptime(metrics.uptime.process)}</span>
          </div>
        </div>

        {/* Platform info */}
        <div className="px-2 pt-1 border-t border-border/50">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{metrics.hostname}</span>
            <span>{metrics.platform}</span>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
