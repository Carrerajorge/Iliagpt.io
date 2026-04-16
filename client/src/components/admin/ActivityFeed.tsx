import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { 
  Activity, 
  User, 
  Settings, 
  Shield, 
  Database, 
  CreditCard,
  MessageSquare,
  Bot,
  FileText,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetchJson } from "@/lib/adminApi";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface ActivityItem {
  id: string;
  action: string;
  resource: string;
  resourceId?: string;
  userId?: string;
  ipAddress?: string;
  details?: Record<string, any>;
  createdAt: string;
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
  "user.created": <User className="h-4 w-4 text-green-500" />,
  "user.updated": <User className="h-4 w-4 text-blue-500" />,
  "user.deleted": <User className="h-4 w-4 text-red-500" />,
  "auth.login": <CheckCircle className="h-4 w-4 text-green-500" />,
  "auth.logout": <XCircle className="h-4 w-4 text-gray-500" />,
  "auth.login_failed": <AlertTriangle className="h-4 w-4 text-red-500" />,
  "security.policy_created": <Shield className="h-4 w-4 text-purple-500" />,
  "security.policy_updated": <Shield className="h-4 w-4 text-blue-500" />,
  "security.policy_deleted": <Shield className="h-4 w-4 text-red-500" />,
  "admin.settings_changed": <Settings className="h-4 w-4 text-orange-500" />,
  "db.query_executed": <Database className="h-4 w-4 text-cyan-500" />,
  "chat.created": <MessageSquare className="h-4 w-4 text-green-500" />,
  "chat.flagged": <MessageSquare className="h-4 w-4 text-yellow-500" />,
  "chat.archived": <MessageSquare className="h-4 w-4 text-gray-500" />,
  "model.created": <Bot className="h-4 w-4 text-purple-500" />,
  "model.enabled": <Bot className="h-4 w-4 text-green-500" />,
  "model.disabled": <Bot className="h-4 w-4 text-red-500" />,
  "payment.received": <CreditCard className="h-4 w-4 text-green-500" />,
  "invoice.created": <FileText className="h-4 w-4 text-blue-500" />,
  "report.generated": <FileText className="h-4 w-4 text-purple-500" />,
};

const SEVERITY_COLORS: Record<string, string> = {
  info: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  warning: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  error: "bg-red-500/10 text-red-500 border-red-500/20",
  critical: "bg-red-600/20 text-red-600 border-red-600/30",
};

function getActionIcon(action: string): React.ReactNode {
  // Check exact match first
  if (ACTION_ICONS[action]) {
    return ACTION_ICONS[action];
  }
  
  // Check prefix matches
  if (action.startsWith("user.")) return <User className="h-4 w-4 text-blue-500" />;
  if (action.startsWith("auth.")) return <Shield className="h-4 w-4 text-purple-500" />;
  if (action.startsWith("security.")) return <Shield className="h-4 w-4 text-orange-500" />;
  if (action.startsWith("chat.")) return <MessageSquare className="h-4 w-4 text-cyan-500" />;
  if (action.startsWith("model.")) return <Bot className="h-4 w-4 text-purple-500" />;
  if (action.startsWith("payment.")) return <CreditCard className="h-4 w-4 text-green-500" />;
  if (action.startsWith("invoice.")) return <FileText className="h-4 w-4 text-blue-500" />;
  if (action.startsWith("db.")) return <Database className="h-4 w-4 text-cyan-500" />;
  if (action.startsWith("admin.")) return <Settings className="h-4 w-4 text-orange-500" />;
  
  return <Activity className="h-4 w-4 text-gray-500" />;
}

function formatAction(action: string): string {
  const parts = action.split(".");
  if (parts.length < 2) return action;
  
  const actionMap: Record<string, string> = {
    "user.created": "Usuario creado",
    "user.updated": "Usuario actualizado",
    "user.deleted": "Usuario eliminado",
    "auth.login": "Inicio de sesión",
    "auth.logout": "Cierre de sesión",
    "auth.login_failed": "Login fallido",
    "security.policy_created": "Política creada",
    "security.policy_updated": "Política actualizada",
    "security.policy_deleted": "Política eliminada",
    "admin.settings_changed": "Config. modificada",
    "db.query_executed": "Query ejecutado",
    "chat.created": "Chat creado",
    "chat.flagged": "Chat marcado",
    "chat.archived": "Chat archivado",
    "model.created": "Modelo creado",
    "model.enabled": "Modelo habilitado",
    "model.disabled": "Modelo deshabilitado",
    "payment.received": "Pago recibido",
    "invoice.created": "Factura creada",
    "report.generated": "Reporte generado",
  };
  
  return actionMap[action] || action.replace(/\./g, " → ");
}

export function ActivityFeed({ limit = 20 }: { limit?: number }) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/admin/security/audit-logs", limit],
    queryFn: () => apiFetchJson(`/api/admin/security/audit-logs?limit=${limit}`),
    refetchInterval: 10000, // Refresh every 10 seconds
    throwOnError: true,
  });

  const logs: ActivityItem[] = data?.logs || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Actividad Reciente
        </h3>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>
      
      <ScrollArea className="h-[400px]">
        <div className="space-y-2">
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No hay actividad reciente
            </p>
          ) : (
            logs.map((log, index) => (
              <div
                key={log.id || index}
                className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
              >
                <div className="mt-0.5">
                  {getActionIcon(log.action)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">
                      {formatAction(log.action)}
                    </span>
                    {log.details?.severity && (
                      <Badge 
                        variant="outline" 
                        className={cn("text-xs", SEVERITY_COLORS[log.details.severity] || "")}
                      >
                        {log.details.severity}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    {log.userId && (
                      <span className="truncate max-w-[150px]">
                        {log.details?.email || log.userId}
                      </span>
                    )}
                    {log.ipAddress && log.ipAddress !== "unknown" && (
                      <span>• {log.ipAddress}</span>
                    )}
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(log.createdAt), { 
                        addSuffix: true,
                        locale: es 
                      })}
                    </span>
                  </div>
                  {log.resourceId && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {log.resource}: {log.resourceId.substring(0, 8)}...
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
