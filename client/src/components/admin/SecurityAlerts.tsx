import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  AlertTriangle, 
  Shield, 
  ShieldAlert, 
  ShieldCheck,
  CheckCircle,
  XCircle,
  RefreshCw,
  Bell,
  BellOff
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";

interface SecurityAlert {
  id: string;
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  details: Record<string, any>;
  timestamp: string;
  resolved: boolean;
}

interface AlertStats {
  total: number;
  unresolved: number;
  bySeverity: Record<string, number>;
  byType: Record<string, number>;
  last24h: number;
}

const SEVERITY_CONFIG = {
  low: { 
    icon: Shield, 
    color: "text-blue-500", 
    bg: "bg-blue-500/10",
    badge: "bg-blue-100 text-blue-700"
  },
  medium: { 
    icon: ShieldAlert, 
    color: "text-yellow-500", 
    bg: "bg-yellow-500/10",
    badge: "bg-yellow-100 text-yellow-700"
  },
  high: { 
    icon: AlertTriangle, 
    color: "text-orange-500", 
    bg: "bg-orange-500/10",
    badge: "bg-orange-100 text-orange-700"
  },
  critical: { 
    icon: XCircle, 
    color: "text-red-500", 
    bg: "bg-red-500/10",
    badge: "bg-red-100 text-red-700"
  }
};

export function SecurityAlertsPanel() {
  const queryClient = useQueryClient();
  const [showResolved, setShowResolved] = useState(false);

  const { data, isLoading, refetch } = useQuery<{ alerts: SecurityAlert[]; stats: AlertStats }>({
    queryKey: ["/api/admin/security/alerts", showResolved],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (!showResolved) params.append("unresolved", "true");
      const res = await fetch(`/api/admin/security/alerts?${params}`, {
        credentials: "include"
      });
      return res.json();
    },
    refetchInterval: 30000 // Refresh every 30 seconds
  });

  const resolveMutation = useMutation({
    mutationFn: async (alertId: string) => {
      const res = await fetch(`/api/admin/security/alerts/${alertId}/resolve`, {
        method: "POST",
        credentials: "include"
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security/alerts"] });
      toast.success("Alerta resuelta");
    },
    onError: () => {
      toast.error("Error al resolver alerta");
    }
  });

  const alerts = data?.alerts || [];
  const stats = data?.stats || { total: 0, unresolved: 0, bySeverity: {}, byType: {}, last24h: 0 };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center py-4">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Total</span>
            </div>
            <p className="text-2xl font-bold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card className={cn(stats.unresolved > 0 && "border-yellow-500/50")}>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              <span className="text-sm text-muted-foreground">Sin resolver</span>
            </div>
            <p className="text-2xl font-bold">{stats.unresolved}</p>
          </CardContent>
        </Card>
        <Card className={cn((stats.bySeverity?.critical || 0) > 0 && "border-red-500/50")}>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              <span className="text-sm text-muted-foreground">Críticas</span>
            </div>
            <p className="text-2xl font-bold text-red-500">{stats.bySeverity?.critical || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-green-500" />
              <span className="text-sm text-muted-foreground">Últimas 24h</span>
            </div>
            <p className="text-2xl font-bold">{stats.last24h}</p>
          </CardContent>
        </Card>
      </div>

      {/* Alerts List */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" />
              Alertas de Seguridad
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowResolved(!showResolved)}
              >
                {showResolved ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                {showResolved ? "Ocultar resueltas" : "Mostrar resueltas"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            {alerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <ShieldCheck className="h-12 w-12 mb-2" />
                <p>No hay alertas {showResolved ? "" : "sin resolver"}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {alerts.map((alert) => {
                  const config = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.low;
                  const Icon = config.icon;
                  
                  return (
                    <div
                      key={alert.id}
                      className={cn(
                        "p-3 rounded-lg border transition-colors",
                        alert.resolved ? "opacity-60" : "hover:border-primary/50",
                        config.bg
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <Icon className={cn("h-5 w-5 mt-0.5", config.color)} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className={config.badge}>
                              {alert.severity}
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              {alert.type.replace(/_/g, " ")}
                            </Badge>
                            {alert.resolved && (
                              <Badge variant="outline" className="text-green-600">
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Resuelta
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm font-medium mt-1">{alert.message}</p>
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(alert.timestamp), { 
                                addSuffix: true, 
                                locale: es 
                              })}
                            </span>
                            {!alert.resolved && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs"
                                onClick={() => resolveMutation.mutate(alert.id)}
                              >
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Resolver
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
