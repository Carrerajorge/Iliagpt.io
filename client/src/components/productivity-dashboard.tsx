import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { 
  Zap, 
  FileText, 
  Clock, 
  TrendingUp,
  MessageSquare,
  Search,
  Code,
  BarChart3,
  Calendar,
  ChevronRight
} from "lucide-react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface UsageStats {
  tokensUsed: number;
  tokensLimit: number;
  documentsGenerated: number;
  searchesPerformed: number;
  conversationsToday: number;
  timeSavedMinutes: number;
  codeBlocksGenerated: number;
  avgResponseTime: number;
}

interface ProductivityDashboardProps {
  stats: UsageStats;
  className?: string;
  compact?: boolean;
}

export const ProductivityDashboard = memo(function ProductivityDashboard({
  stats,
  className,
  compact = false,
}: ProductivityDashboardProps) {
  const tokenUsagePercent = useMemo(() => 
    Math.min((stats.tokensUsed / stats.tokensLimit) * 100, 100),
    [stats.tokensUsed, stats.tokensLimit]
  );

  const statCards = [
    {
      id: "tokens",
      title: "Tokens usados",
      value: formatNumber(stats.tokensUsed),
      subtitle: `de ${formatNumber(stats.tokensLimit)}`,
      icon: Zap,
      color: "text-amber-500",
      bgColor: "bg-amber-500/10",
      progress: tokenUsagePercent,
    },
    {
      id: "documents",
      title: "Documentos",
      value: stats.documentsGenerated.toString(),
      subtitle: "generados",
      icon: FileText,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
    },
    {
      id: "searches",
      title: "Búsquedas",
      value: stats.searchesPerformed.toString(),
      subtitle: "realizadas",
      icon: Search,
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
    },
    {
      id: "time",
      title: "Tiempo ahorrado",
      value: formatTime(stats.timeSavedMinutes),
      subtitle: "estimado",
      icon: Clock,
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
    },
  ];

  if (compact) {
    return (
      <div className={cn("flex items-center gap-4 text-sm", className)}>
        <div className="flex items-center gap-1.5">
          <Zap className="w-4 h-4 text-amber-500" />
          <span>{formatNumber(stats.tokensUsed)}</span>
          <span className="text-muted-foreground">tokens</span>
        </div>
        <div className="flex items-center gap-1.5">
          <FileText className="w-4 h-4 text-blue-500" />
          <span>{stats.documentsGenerated}</span>
          <span className="text-muted-foreground">docs</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-purple-500" />
          <span>{formatTime(stats.timeSavedMinutes)}</span>
          <span className="text-muted-foreground">ahorrado</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          Tu productividad
        </h3>
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          Hoy
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {statCards.map((stat, index) => (
          <motion.div
            key={stat.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <StatCard stat={stat} />
          </motion.div>
        ))}
      </div>

      <Card className="bg-muted/30">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Uso diario</span>
            <span className={cn(
              "text-xs font-medium",
              tokenUsagePercent > 80 ? "text-red-500" : "text-muted-foreground"
            )}>
              {Math.round(tokenUsagePercent)}%
            </span>
          </div>
          <Progress 
            value={tokenUsagePercent} 
            className={cn(
              "h-2",
              tokenUsagePercent > 80 && "[&>div]:bg-red-500"
            )}
          />
          <p className="text-xs text-muted-foreground mt-2">
            {stats.tokensLimit - stats.tokensUsed > 0
              ? `Te quedan ${formatNumber(stats.tokensLimit - stats.tokensUsed)} tokens`
              : "Has alcanzado tu límite diario"}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-2 text-center">
        <MiniStat 
          icon={MessageSquare} 
          value={stats.conversationsToday} 
          label="Chats" 
        />
        <MiniStat 
          icon={Code} 
          value={stats.codeBlocksGenerated} 
          label="Código" 
        />
        <MiniStat 
          icon={TrendingUp} 
          value={`${stats.avgResponseTime}s`} 
          label="Resp. prom." 
        />
      </div>
    </div>
  );
});

const StatCard = memo(function StatCard({
  stat,
}: {
  stat: {
    title: string;
    value: string;
    subtitle: string;
    icon: typeof Zap;
    color: string;
    bgColor: string;
    progress?: number;
  };
}) {
  const Icon = stat.icon;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{stat.title}</p>
            <p className="text-xl font-bold mt-0.5">{stat.value}</p>
            <p className="text-xs text-muted-foreground">{stat.subtitle}</p>
          </div>
          <div className={cn("p-2 rounded-lg", stat.bgColor)}>
            <Icon className={cn("w-4 h-4", stat.color)} />
          </div>
        </div>
        {stat.progress !== undefined && (
          <Progress value={stat.progress} className="h-1 mt-2" />
        )}
      </CardContent>
    </Card>
  );
});

const MiniStat = memo(function MiniStat({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Zap;
  value: number | string;
  label: string;
}) {
  return (
    <div className="p-2 rounded-lg bg-muted/50">
      <Icon className="w-4 h-4 mx-auto text-muted-foreground mb-1" />
      <p className="text-sm font-medium">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
});

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

function formatTime(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

export default ProductivityDashboard;
