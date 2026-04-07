import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Activity, 
  Users, 
  Zap,
  Timer,
  AlertTriangle,
  CheckCircle,
  XCircle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { apiFetchJson } from "@/lib/adminApi";

interface RealtimeMetrics {
  timestamp: number;
  activeUsers: number;
  queriesPerMinute: number;
  tokensConsumedToday: number;
  avgLatencyMs: number;
  errorRate: number;
  systemHealth: {
    xai: boolean;
    gemini: boolean;
    openai: boolean;
    database: boolean;
  };
}

function AnimatedNumber({ value, suffix = "" }: { value: number; suffix?: string }) {
  return (
    <motion.span
      key={value}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {value.toLocaleString()}{suffix}
    </motion.span>
  );
}

function HealthIndicator({ name, healthy }: { name: string; healthy: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className={cn(
        "w-2 h-2 rounded-full",
        healthy ? "bg-green-500" : "bg-red-500"
      )} />
      <span className={cn(
        "text-xs",
        healthy ? "text-green-600" : "text-red-500"
      )}>
        {name}
      </span>
    </div>
  );
}

export function RealtimeMetricsPanel() {
  const { data, isLoading, error } = useQuery<RealtimeMetrics>({
    queryKey: ["/api/admin/dashboard/realtime"],
    queryFn: () => apiFetchJson("/api/admin/dashboard/realtime"),
    refetchInterval: 5000, // Update every 5 seconds
  });

  if (isLoading) {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-6">
          <div className="flex items-center justify-center py-4">
            <Activity className="h-5 w-5 animate-pulse text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <span className="text-sm">Error loading metrics</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const allHealthy = Object.values(data.systemHealth).every(Boolean);

  return (
    <Card className={cn(
      "border-2 transition-colors",
      allHealthy ? "border-green-500/20" : "border-yellow-500/20"
    )}>
      <CardContent className="pt-6">
        <div className="space-y-4">
          {/* Header with overall health */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <span className="font-medium">Métricas en Tiempo Real</span>
            </div>
            <Badge 
              variant={allHealthy ? "default" : "destructive"}
              className="gap-1"
            >
              {allHealthy ? (
                <><CheckCircle className="h-3 w-3" /> Healthy</>
              ) : (
                <><AlertTriangle className="h-3 w-3" /> Degraded</>
              )}
            </Badge>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Active Users */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Users className="h-3 w-3" />
                <span className="text-xs">Usuarios Activos</span>
              </div>
              <p className="text-2xl font-bold">
                <AnimatedNumber value={data.activeUsers} />
              </p>
            </div>

            {/* Queries per Minute */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Zap className="h-3 w-3" />
                <span className="text-xs">Queries/min</span>
              </div>
              <p className="text-2xl font-bold">
                <AnimatedNumber value={data.queriesPerMinute} />
              </p>
            </div>

            {/* Average Latency */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Timer className="h-3 w-3" />
                <span className="text-xs">Latencia Avg</span>
              </div>
              <p className="text-2xl font-bold">
                <AnimatedNumber value={data.avgLatencyMs} suffix="ms" />
              </p>
            </div>

            {/* Error Rate */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-muted-foreground">
                <AlertTriangle className="h-3 w-3" />
                <span className="text-xs">Error Rate</span>
              </div>
              <p className={cn(
                "text-2xl font-bold",
                data.errorRate > 5 ? "text-red-500" : 
                data.errorRate > 1 ? "text-yellow-500" : "text-green-500"
              )}>
                {data.errorRate.toFixed(2)}%
              </p>
            </div>
          </div>

          {/* Tokens Progress */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Tokens Hoy</span>
              <span className="font-medium">
                {(data.tokensConsumedToday / 1000000).toFixed(2)}M
              </span>
            </div>
            <Progress 
              value={Math.min((data.tokensConsumedToday / 10000000) * 100, 100)} 
              className="h-2"
            />
          </div>

          {/* System Health */}
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground mb-2">Estado de Proveedores</p>
            <div className="flex items-center gap-4 flex-wrap">
              <HealthIndicator name="xAI" healthy={data.systemHealth.xai} />
              <HealthIndicator name="Gemini" healthy={data.systemHealth.gemini} />
              <HealthIndicator name="OpenAI" healthy={data.systemHealth.openai} />
              <HealthIndicator name="Database" healthy={data.systemHealth.database} />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
