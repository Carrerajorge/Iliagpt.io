import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Settings2,
  Server,
  Cpu,
  Shield,
  Download,
  Globe,
  Zap,
  Activity,
  Clock,
  User,
  Lock,
} from "lucide-react";
import { apiFetch } from "@/lib/apiClient";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface OpenClawModel {
  id: string;
  name: string;
  provider: string;
  enabled: boolean;
  tier: "free" | "pro" | "enterprise";
  contextWindow: number;
  description: string;
}

interface OpenClawInstanceStatus {
  version: string;
  latestVersion: string;
  instanceId: string;
  userId: string;
  uptime: number;
  status: "running" | "stopped" | "updating";
  capabilities: number;
  models: OpenClawModel[];
  fusionModules: string[];
  toolsRegistered: number;
  agentsRegistered: number;
  isShared: boolean;
  lastHealthCheck: string;
}

function OpenClawLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle cx="24" cy="24" r="22" fill="url(#oc-bg)" />
      <path
        d="M24 8c-2 0-3.5 1-4 2.5L18 14c-1 0-2.5.5-3 2l-2 4c-.5 1.5 0 3 1 4l-1 3c-.5 2 .5 3.5 2 4l1 .5c.5 2 2 3.5 4 3.5h1l2 3c1 1.5 3 1.5 4 0l2-3h1c2 0 3.5-1.5 4-3.5l1-.5c1.5-.5 2.5-2 2-4l-1-3c1-1 1.5-2.5 1-4l-2-4c-.5-1.5-2-2-3-2l-2-3.5c-.5-1.5-2-2.5-4-2.5z"
        fill="url(#oc-body)"
        stroke="#c2410c"
        strokeWidth="0.5"
      />
      <ellipse cx="20" cy="18" rx="2.5" ry="3" fill="white" />
      <ellipse cx="28" cy="18" rx="2.5" ry="3" fill="white" />
      <circle cx="20.5" cy="17.5" r="1.2" fill="#1e293b" />
      <circle cx="28.5" cy="17.5" r="1.2" fill="#1e293b" />
      <path d="M15 14l-4-4M14 12l-5-1" stroke="#ea580c" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M33 14l4-4M34 12l5-1" stroke="#ea580c" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12 24l-4-1c-1 0-1.5 1-1 2l2 3c.5 1 1.5 1 2 0l2-2" stroke="#ea580c" strokeWidth="1.5" strokeLinecap="round" fill="#f97316" />
      <path d="M36 24l4-1c1 0 1.5 1 1 2l-2 3c-.5 1-1.5 1-2 0l-2-2" stroke="#ea580c" strokeWidth="1.5" strokeLinecap="round" fill="#f97316" />
      <path d="M21 34l-1 4c0 1 .5 1.5 1.5 1l2-2" stroke="#ea580c" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M24 34l0 4.5c0 .5.5 1 1 .5" stroke="#ea580c" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M27 34l1 4c0 1-.5 1.5-1.5 1l-2-2" stroke="#ea580c" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M20 26c0 0 2 2 4 2s4-2 4-2" stroke="#c2410c" strokeWidth="1" strokeLinecap="round" fill="none" />
      <defs>
        <radialGradient id="oc-bg" cx="24" cy="20" r="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fed7aa" />
          <stop offset="100%" stopColor="#fb923c" />
        </radialGradient>
        <linearGradient id="oc-body" x1="16" y1="8" x2="32" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f97316" />
          <stop offset="50%" stopColor="#ea580c" />
          <stop offset="100%" stopColor="#c2410c" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export { OpenClawLogo };

function ModelCard({ model, onToggle }: { model: OpenClawModel; onToggle: (id: string, enabled: boolean) => void }) {
  return (
    <div className={cn(
      "flex items-center justify-between p-3 rounded-lg border transition-colors",
      model.enabled ? "bg-card border-orange-200 dark:border-orange-800/40" : "bg-muted/30 border-border/40 opacity-60"
    )} data-testid={`model-card-${model.id}`}>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className={cn(
          "h-8 w-8 rounded-md flex items-center justify-center shrink-0",
          model.enabled ? "bg-orange-100 dark:bg-orange-900/30" : "bg-muted"
        )}>
          <Cpu className={cn("h-4 w-4", model.enabled ? "text-orange-600" : "text-muted-foreground")} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{model.name}</span>
            <Badge variant="outline" className={cn(
              "text-[9px] px-1.5 py-0 h-4 shrink-0",
              model.tier === "free" ? "border-green-300 text-green-600" :
              model.tier === "pro" ? "border-blue-300 text-blue-600" :
              "border-purple-300 text-purple-600"
            )}>
              {model.tier}
            </Badge>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-muted-foreground">{model.provider}</span>
            <span className="text-[10px] text-muted-foreground/50">|</span>
            <span className="text-[10px] text-muted-foreground">{(model.contextWindow / 1000).toFixed(0)}K ctx</span>
          </div>
        </div>
      </div>
      <Switch
        checked={model.enabled}
        onCheckedChange={(checked) => onToggle(model.id, checked)}
        className="shrink-0 ml-2"
        data-testid={`switch-model-${model.id}`}
      />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string | number; color: string }) {
  return (
    <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-muted/40 border border-border/30">
      <div className={cn("h-8 w-8 rounded-md flex items-center justify-center shrink-0", color)}>
        <Icon className="h-4 w-4 text-white" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold">{value}</p>
      </div>
    </div>
  );
}

function formatUptime(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  return `${hours}h ${minutes}m`;
}

export function OpenClawPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [status, setStatus] = useState<OpenClawInstanceStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/openclaw/instance/status");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      console.error("[OpenClaw] Failed to fetch status:", err);
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchStatus();
    }
  }, [open, fetchStatus]);

  const handleToggleModel = useCallback(async (modelId: string, enabled: boolean) => {
    if (!status) return;
    const prevModels = status.models;
    const updatedModels = status.models.map((m) =>
      m.id === modelId ? { ...m, enabled } : m
    );
    setStatus({ ...status, models: updatedModels });
    try {
      const res = await apiFetch("/api/openclaw/instance/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, enabled }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      toast.success(enabled ? `${modelId} activado` : `${modelId} desactivado`);
    } catch {
      setStatus({ ...status, models: prevModels });
      toast.error("Error al actualizar modelo");
    }
  }, [status]);

  const handleCheckUpdate = useCallback(async () => {
    setUpdating(true);
    try {
      const res = await apiFetch("/api/openclaw/instance/check-update");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.updateAvailable) {
        toast.success(`Actualización disponible: v${data.latestVersion}`);
        if (status) {
          setStatus({ ...status, latestVersion: data.latestVersion });
        }
      } else {
        toast.success("Ya tienes la última versión");
      }
    } catch {
      toast.error("Error al verificar actualizaciones");
    } finally {
      setUpdating(false);
    }
  }, [status]);

  const hasUpdate = status && status.version !== status.latestVersion;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] p-0 gap-0 overflow-hidden" data-testid="openclaw-panel">
        <DialogHeader className="px-6 pt-5 pb-4 border-b bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-950/20 dark:to-amber-950/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <OpenClawLogo className="h-10 w-10" />
              <div>
                <DialogTitle className="text-lg font-bold flex items-center gap-2">
                  OpenClaw
                  {status && (
                    <Badge variant="outline" className="text-[10px] font-mono border-orange-300 text-orange-600">
                      v{status.version}
                    </Badge>
                  )}
                </DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Motor agentico de codigo abierto</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={handleCheckUpdate}
                    disabled={updating}
                    data-testid="button-check-update"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", updating && "animate-spin")} />
                    {updating ? "Verificando..." : "Actualizar"}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Verificar actualizaciones disponibles</TooltipContent>
              </Tooltip>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => window.open("https://github.com/nicobrave/openclaw/releases/tag/v2026.4.2", "_blank")}
                data-testid="button-github-releases"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                GitHub
              </Button>
            </div>
          </div>
          {hasUpdate && (
            <div className="mt-3 flex items-center gap-2 p-2.5 rounded-lg bg-orange-100 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800/40">
              <Download className="h-4 w-4 text-orange-600 shrink-0" />
              <span className="text-xs text-orange-700 dark:text-orange-300">
                Nueva version disponible: <strong>v{status?.latestVersion}</strong>
              </span>
              <Button
                size="sm"
                className="ml-auto h-6 text-[10px] bg-orange-600 hover:bg-orange-700"
                onClick={() => window.open("https://github.com/nicobrave/openclaw/releases/tag/v2026.4.2", "_blank")}
                data-testid="button-update-now"
              >
                Ver changelog
              </Button>
            </div>
          )}
        </DialogHeader>

        <ScrollArea className="flex-1 max-h-[calc(85vh-140px)]">
          <div className="p-6 space-y-6">
            {loading && !status ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-6 w-6 animate-spin text-orange-500" />
              </div>
            ) : status ? (
              <>
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Server className="h-4 w-4 text-orange-500" />
                    Tu Instancia
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <StatCard icon={Activity} label="Estado" value={status.status === "running" ? "Activo" : "Detenido"} color="bg-green-500" />
                    <StatCard icon={Clock} label="Uptime" value={formatUptime(status.uptime)} color="bg-blue-500" />
                    <StatCard icon={Zap} label="Herramientas" value={status.toolsRegistered} color="bg-amber-500" />
                    <StatCard icon={Cpu} label="Agentes" value={status.agentsRegistered} color="bg-purple-500" />
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 rounded-lg border border-green-200 dark:border-green-800/40 bg-green-50 dark:bg-green-950/20">
                  <div className="h-8 w-8 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center shrink-0">
                    <Lock className="h-4 w-4 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">Instancia Privada</p>
                    <p className="text-xs text-muted-foreground">
                      Esta es tu instancia exclusiva. Tus conversaciones, datos y configuraciones son totalmente privadas y no se comparten con otros usuarios.
                    </p>
                  </div>
                  <Badge className="bg-green-600 text-white text-[9px] shrink-0">
                    <User className="h-3 w-3 mr-1" />
                    Solo tu
                  </Badge>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <Settings2 className="h-4 w-4 text-orange-500" />
                      Control de Modelos
                    </h3>
                    <span className="text-[10px] text-muted-foreground">
                      {status.models.filter((m) => m.enabled).length} de {status.models.length} activos
                    </span>
                  </div>
                  <div className="space-y-2">
                    {status.models.map((model) => (
                      <ModelCard key={model.id} model={model} onToggle={handleToggleModel} />
                    ))}
                  </div>
                </div>

                <Separator />

                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Shield className="h-4 w-4 text-orange-500" />
                    Modulos Fusion
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {status.fusionModules.map((mod) => (
                      <Badge key={mod} variant="secondary" className="text-[10px] gap-1">
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                        {mod}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-muted/40 border border-border/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Globe className="h-4 w-4 text-orange-500" />
                    <span className="text-xs font-semibold">Informacion de la Instancia</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                    <span className="text-muted-foreground">ID de Instancia:</span>
                    <span className="font-mono truncate">{status.instanceId}</span>
                    <span className="text-muted-foreground">Usuario:</span>
                    <span className="font-mono truncate">{status.userId}</span>
                    <span className="text-muted-foreground">Capacidades:</span>
                    <span>{status.capabilities} registradas</span>
                    <span className="text-muted-foreground">Ultima verificacion:</span>
                    <span>{new Date(status.lastHealthCheck).toLocaleString("es-PE")}</span>
                    <span className="text-muted-foreground">Modo:</span>
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      Instancia privada (no compartida)
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <AlertCircle className="h-10 w-10 text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">No se pudo cargar el estado de OpenClaw</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={fetchStatus} data-testid="button-retry-status">
                  Reintentar
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
