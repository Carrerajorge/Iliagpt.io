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
        <DialogHeader className="sr-only">
          <DialogTitle>OpenClaw</DialogTitle>
        </DialogHeader>

      </DialogContent>
    </Dialog>
  );
}
