import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  RefreshCw,
  Users,
  Bot,
  CreditCard,
  FileText,
  BarChart3,
  Database,
  Shield,
  FileBarChart,
  Settings,
  Activity,
  CheckCircle,
  Loader2
} from "lucide-react";

export function DashboardSection() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/admin/dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/admin/dashboard", { credentials: "include" });
      return res.json();
    },
    refetchInterval: 30000
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-label="Cargando dashboard">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
        <span className="sr-only">Cargando dashboard...</span>
      </div>
    );
  }

  const d = data || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium" id="dashboard-title">Dashboard</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          data-testid="button-refresh-dashboard"
          aria-label="Actualizar dashboard"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" role="list" aria-label="Métricas principales">
        <MetricCard
          icon={Users}
          iconColor="text-blue-500"
          bgColor="bg-blue-500/10"
          title="Users"
          value={d.users?.total || 0}
          testId="card-users"
        >
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>{d.users?.active || 0} activos</span>
            <span className="text-green-600">+{d.users?.newThisMonth || 0} este mes</span>
          </div>
        </MetricCard>

        <MetricCard
          icon={Bot}
          iconColor="text-purple-500"
          bgColor="bg-purple-500/10"
          title="AI Models"
          value={`${d.aiModels?.active || 0}/${d.aiModels?.total || 0}`}
          testId="card-ai-models"
        >
          <div className="flex items-center gap-2 mt-2">
            <StatusIndicator label="xAI" isOnline={d.systemHealth?.xai} />
            <StatusIndicator label="Gemini" isOnline={d.systemHealth?.gemini} />
          </div>
        </MetricCard>

        <MetricCard
          icon={CreditCard}
          iconColor="text-green-500"
          bgColor="bg-green-500/10"
          title="Payments"
          value={`€${parseFloat(d.payments?.total || "0").toLocaleString()}`}
          testId="card-payments"
        >
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>€{parseFloat(d.payments?.thisMonth || "0").toLocaleString()} este mes</span>
            <span>{d.payments?.count || 0} transacciones</span>
          </div>
        </MetricCard>

        <MetricCard
          icon={FileText}
          iconColor="text-orange-500"
          bgColor="bg-orange-500/10"
          title="Invoices"
          value={d.invoices?.total || 0}
          testId="card-invoices"
        >
          <div className="flex items-center gap-4 mt-2 text-xs">
            <span className="text-yellow-600">{d.invoices?.pending || 0} pendientes</span>
            <span className="text-green-600">{d.invoices?.paid || 0} pagadas</span>
          </div>
        </MetricCard>

        <MetricCard
          icon={BarChart3}
          iconColor="text-cyan-500"
          bgColor="bg-cyan-500/10"
          title="Analytics"
          value={(d.analytics?.totalQueries || 0).toLocaleString()}
          testId="card-analytics"
        >
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>~{d.analytics?.avgQueriesPerUser || 0} consultas/usuario</span>
          </div>
        </MetricCard>

        <MetricCard
          icon={Database}
          iconColor="text-slate-500"
          bgColor="bg-slate-500/10"
          title="Database"
          value={`${d.database?.tables || 0} tablas`}
          testId="card-database"
        >
          <div className="flex items-center gap-2 mt-2">
            <span className={cn(
              "inline-flex items-center gap-1 text-xs",
              d.database?.status === "healthy" ? "text-green-600" : "text-red-500"
            )}>
              <CheckCircle className="h-3 w-3" aria-hidden="true" />
              {d.database?.status === "healthy" ? "Operativo" : "Error"}
            </span>
          </div>
        </MetricCard>

        <MetricCard
          icon={Shield}
          iconColor={d.security?.status === "healthy" ? "text-green-500" : "text-yellow-500"}
          bgColor={d.security?.status === "healthy" ? "bg-green-500/10" : "bg-yellow-500/10"}
          title="Security"
          value={`${d.security?.alerts || 0} alertas`}
          testId="card-security"
        >
          <div className="flex items-center gap-2 mt-2">
            <span className={cn(
              "inline-flex items-center gap-1 text-xs",
              d.security?.status === "healthy" ? "text-green-600" : "text-yellow-600"
            )}>
              <span className={cn(
                "w-1.5 h-1.5 rounded-full",
                d.security?.status === "healthy" ? "bg-green-500" : "bg-yellow-500"
              )} aria-hidden="true" />
              {d.security?.status === "healthy" ? "Sin incidentes" : "Revisar"}
            </span>
          </div>
        </MetricCard>

        <MetricCard
          icon={FileBarChart}
          iconColor="text-indigo-500"
          bgColor="bg-indigo-500/10"
          title="Reports"
          value={d.reports?.total || 0}
          testId="card-reports"
        >
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>{d.reports?.scheduled || 0} programados</span>
          </div>
        </MetricCard>

        <MetricCard
          icon={Settings}
          iconColor="text-gray-500"
          bgColor="bg-gray-500/10"
          title="Settings"
          value={`${d.settings?.total || 0} config`}
          testId="card-settings"
        >
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>{d.settings?.categories || 0} categorías</span>
          </div>
        </MetricCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SystemHealthPanel data={d} />
        <RecentActivityPanel data={d} />
      </div>
    </div>
  );
}

interface MetricCardProps {
  icon: React.ElementType;
  iconColor: string;
  bgColor: string;
  title: string;
  value: string | number;
  testId: string;
  children?: React.ReactNode;
}

function MetricCard({ icon: Icon, iconColor, bgColor, title, value, testId, children }: MetricCardProps) {
  return (
    <div
      className="rounded-lg border p-4 hover:border-primary/50 transition-colors cursor-pointer"
      data-testid={testId}
      role="listitem"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className={cn("p-2 rounded-md", bgColor)}>
          <Icon className={cn("h-4 w-4", iconColor)} aria-hidden="true" />
        </div>
        <span className="text-sm font-medium">{title}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {children}
    </div>
  );
}

function StatusIndicator({ label, isOnline }: { label: string; isOnline?: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-xs",
      isOnline ? "text-green-600" : "text-red-500"
    )}>
      <span
        className={cn("w-1.5 h-1.5 rounded-full", isOnline ? "bg-green-500" : "bg-red-500")}
        aria-hidden="true"
      />
      {label}
      <span className="sr-only">{isOnline ? "online" : "offline"}</span>
    </span>
  );
}

function SystemHealthPanel({ data }: { data: any }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium">System Health</h3>
        <span className="text-xs text-muted-foreground">{data.systemHealth?.uptime || 99.9}% uptime</span>
      </div>
      <div className="space-y-3" role="list" aria-label="Estado de servicios">
        <HealthItem label="xAI Grok" isHealthy={data.systemHealth?.xai} />
        <HealthItem label="Google Gemini" isHealthy={data.systemHealth?.gemini} />
        <HealthItem label="Database" isHealthy={data.database?.status === "healthy"} />
      </div>
    </div>
  );
}

function HealthItem({ label, isHealthy }: { label: string; isHealthy?: boolean }) {
  return (
    <div className="flex items-center justify-between" role="listitem">
      <span className="text-sm">{label}</span>
      <Badge variant={isHealthy ? "default" : "destructive"} className="text-xs">
        {isHealthy ? "Online" : "Offline"}
      </Badge>
    </div>
  );
}

function RecentActivityPanel({ data }: { data: any }) {
  return (
    <div className="rounded-lg border p-4">
      <h3 className="text-sm font-medium mb-4">Actividad reciente</h3>
      <div className="space-y-2" role="list" aria-label="Actividad reciente">
        {(data.recentActivity || []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay actividad reciente</p>
        ) : (
          (data.recentActivity || []).slice(0, 5).map((item: any, i: number) => (
            <div
              key={i}
              className="flex items-center justify-between py-1.5 text-sm border-b last:border-0"
              role="listitem"
            >
              <div className="flex items-center gap-2">
                <Activity className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                <span className="truncate max-w-[200px]">{item.action}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {item.createdAt ? format(new Date(item.createdAt), "dd/MM HH:mm") : ""}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
