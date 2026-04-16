import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "@/lib/apiClient";
import { useState } from "react";
import { toast } from "sonner";
import { DEFAULT_OPENCLAW_RELEASE_TAG } from "@shared/openclawRelease";
import {
  Activity, Cpu, GitBranch, RefreshCw, Settings,
  Zap, Clock, Hash, Users, Trash2, Pause, Play,
} from "lucide-react";

function OpenClawLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <circle cx="24" cy="24" r="22" fill="url(#oc-bg)" />
      <path d="M24 8c-2 0-3.5 1-4 2.5L18 14c-1 0-2.5.5-3 2l-2 4c-.5 1.5 0 3 1 4l-1 3c-.5 2 .5 3.5 2 4l1 .5c.5 2 2 3.5 4 3.5h1l2 3c1 1.5 3 1.5 4 0l2-3h1c2 0 3.5-1.5 4-3.5l1-.5c1.5-.5 2.5-2 2-4l-1-3c1-1 1.5-2.5 1-4l-2-4c-.5-1.5-2-2-3-2l-2-3.5c-.5-1.5-2-2.5-4-2.5z" fill="url(#oc-body)" stroke="#c2410c" strokeWidth="0.5" />
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

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatQuotaLimit(value: number | null | undefined): string {
  if (value == null || value < 0) return "Ilimitado";
  return formatNumber(value);
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "Nunca";
  return new Date(d).toLocaleDateString("es", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "bg-green-500/10 text-green-600 border-green-500/20",
    suspended: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    disabled: "bg-red-500/10 text-red-600 border-red-500/20",
  };
  return <Badge variant="outline" className={`text-[10px] ${colors[status] || ""}`}>{status}</Badge>;
}

function UserInstanceTab() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/openclaw/instance"],
    queryFn: () => apiFetch("/api/openclaw/instance").then((r) => r.json()),
    refetchInterval: 30000,
  });

  const { data: tokenData } = useQuery({
    queryKey: ["/api/openclaw/instance/tokens"],
    queryFn: () => apiFetch("/api/openclaw/instance/tokens").then((r) => r.json()),
  });

  if (isLoading) return <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">Cargando instancia...</div>;

  const instance = data?.instance;
  const budget = instance?.budget;
  const history = tokenData?.history || [];
  const usagePercent =
    budget && typeof budget.limit === "number" && budget.limit > 0
      ? Math.min(100, (budget.used / budget.limit) * 100)
      : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <OpenClawLogo className="h-10 w-10" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm" data-testid="text-instance-id">{instance?.instanceId || "Sin instancia"}</span>
              <StatusBadge status={instance?.status || "unknown"} />
            </div>
            <p className="text-xs text-muted-foreground">{instance?.version || DEFAULT_OPENCLAW_RELEASE_TAG}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetch()} data-testid="button-refresh-instance">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <Separator />

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" /> Tokens utilizados</span>
          <span className="font-medium" data-testid="text-tokens-used">
            {formatNumber(budget?.used || 0)} / {formatQuotaLimit(budget?.limit)}
          </span>
        </div>
        <Progress value={usagePercent} className="h-2" />
        <p className="text-[11px] text-muted-foreground">
          Cuota global compartida entre OpenClaw e ILIAGPTChatbot.
        </p>
        {typeof budget?.channels?.openclawUsed === "number" && (
          <p className="text-[11px] text-muted-foreground">
            Consumo acumulado originado desde OpenClaw: {formatNumber(budget.channels.openclawUsed)} tokens
          </p>
        )}
        {usagePercent > 80 && <p className="text-xs text-amber-500">Advertencia: has usado el {usagePercent.toFixed(0)}% del saldo global compartido</p>}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground"><Hash className="h-3 w-3" /><span className="text-[10px] uppercase tracking-wider">Solicitudes</span></div>
          <p className="text-lg font-semibold" data-testid="text-request-count">{formatNumber(instance?.requestCount || 0)}</p>
        </div>
        <div className="rounded-lg border p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground"><Clock className="h-3 w-3" /><span className="text-[10px] uppercase tracking-wider">Último uso</span></div>
          <p className="text-xs font-medium">{formatDate(instance?.lastActiveAt)}</p>
        </div>
        <div className="rounded-lg border p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground"><Activity className="h-3 w-3" /><span className="text-[10px] uppercase tracking-wider">Estado</span></div>
          <StatusBadge status={instance?.status || "unknown"} />
        </div>
      </div>

      {history.length > 0 && (
        <>
          <Separator />
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Historial de tokens reciente</h4>
            <ScrollArea className="h-[200px]">
              <div className="space-y-1">
                {history.map((entry: any) => (
                  <div key={entry.id} className="flex items-center justify-between py-1.5 px-2 text-xs rounded hover:bg-accent/40" data-testid={`token-entry-${entry.id}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <Zap className="h-3 w-3 text-orange-500 shrink-0" />
                      <span className="truncate">{entry.toolName || entry.action}</span>
                      {entry.model && <Badge variant="outline" className="text-[9px] shrink-0">{entry.model}</Badge>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-muted-foreground">
                      <span>{formatNumber(entry.tokensIn + entry.tokensOut)} tok</span>
                      <span>{formatDate(entry.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </>
      )}
    </div>
  );
}

function AdminInstancesTab() {
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/openclaw/admin/instances"],
    queryFn: () => apiFetch("/api/openclaw/admin/instances").then((r) => r.json()),
    refetchInterval: 15000,
  });

  async function checkedFetch(url: string, opts?: RequestInit) {
    const r = await apiFetch(url, opts);
    const data = await r.json();
    if (!r.ok || data.success === false) throw new Error(data.error || "Error desconocido");
    return data;
  }

  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      checkedFetch(`/api/openclaw/admin/instances/${id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/openclaw/admin/instances"] }); toast.success("Estado actualizado"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteInstanceMutation = useMutation({
    mutationFn: (id: string) =>
      checkedFetch(`/api/openclaw/admin/instances/${id}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/openclaw/admin/instances"] }); toast.success("Instancia eliminada"); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">Cargando instancias...</div>;

  const stats = data?.stats;
  const instances = data?.instances || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2"><Users className="h-4 w-4" /> Instancias de usuarios</h3>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetch()} data-testid="button-admin-refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <div className="rounded-lg border p-2.5 text-center">
          <p className="text-lg font-bold" data-testid="text-total-instances">{stats?.totalInstances || 0}</p>
          <p className="text-[10px] text-muted-foreground uppercase">Total</p>
        </div>
        <div className="rounded-lg border p-2.5 text-center">
          <p className="text-lg font-bold text-green-600">{stats?.activeInstances || 0}</p>
          <p className="text-[10px] text-muted-foreground uppercase">Activas</p>
        </div>
        <div className="rounded-lg border p-2.5 text-center">
          <p className="text-lg font-bold text-orange-500">{formatNumber(stats?.totalTokensUsed || 0)}</p>
          <p className="text-[10px] text-muted-foreground uppercase">OpenClaw</p>
        </div>
        <div className="rounded-lg border p-2.5 text-center">
          <p className="text-lg font-bold text-blue-500">{formatNumber(stats?.totalRequests || 0)}</p>
          <p className="text-[10px] text-muted-foreground uppercase">Peticiones</p>
        </div>
      </div>

      <Separator />

      <ScrollArea className="h-[350px]">
        <div className="space-y-2">
          {instances.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No hay instancias registradas</p>}
          {instances.map((inst: any) => {
            const pct =
              typeof inst.sharedTokensLimit === "number" && inst.sharedTokensLimit > 0
                ? Math.min(100, (inst.sharedTokensUsed / inst.sharedTokensLimit) * 100)
                : 0;
            return (
              <div key={inst.id} className="rounded-lg border p-3 space-y-2" data-testid={`admin-instance-${inst.id}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <Cpu className="h-4 w-4 text-orange-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{inst.user?.email || inst.userId}</p>
                      <p className="text-[10px] text-muted-foreground">{inst.instanceId} &middot; {inst.user?.plan || "free"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <StatusBadge status={inst.status} />
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleStatusMutation.mutate({ id: inst.id, status: inst.status === "active" ? "suspended" : "active" })} data-testid={`button-toggle-${inst.id}`}>
                      {inst.status === "active" ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={() => { if (confirm("¿Eliminar esta instancia?")) deleteInstanceMutation.mutate(inst.id); }} data-testid={`button-delete-${inst.id}`}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Progress value={pct} className="h-1.5 flex-1" />
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    Global {formatNumber(inst.sharedTokensUsed || 0)}/{formatQuotaLimit(inst.sharedTokensLimit)}
                  </span>
                </div>

                <div className="rounded-md border border-dashed px-2 py-1.5 text-[10px] text-muted-foreground">
                  Billing centralizado: el saldo y los límites ya no se editan desde OpenClaw.
                </div>

                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span>{inst.requestCount} solicitudes</span>
                  <span>OpenClaw: {formatNumber(inst.tokensUsed || 0)} tok</span>
                  <span>Creado: {formatDate(inst.createdAt)}</span>
                  <span>Último: {formatDate(inst.lastActiveAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

function AdminConfigTab() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["/api/openclaw/admin/config"],
    queryFn: () => apiFetch("/api/openclaw/admin/config").then((r) => r.json()),
  });

  const updateMutation = useMutation({
    mutationFn: (updates: Record<string, unknown>) =>
      apiFetch("/api/openclaw/admin/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) }).then((r) => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/openclaw/admin/config"] }); toast.success("Configuración actualizada"); },
  });

  const [defaultLimit, setDefaultLimit] = useState("");

  if (isLoading) return <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">Cargando configuración...</div>;

  const config = data?.config;

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-sm flex items-center gap-2"><Settings className="h-4 w-4" /> Configuración global</h3>

      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Instancias habilitadas</p>
            <p className="text-xs text-muted-foreground">Permite la creación de nuevas instancias OpenClaw</p>
          </div>
          <Switch checked={config?.globalEnabled ?? true} onCheckedChange={(v) => updateMutation.mutate({ globalEnabled: v })} data-testid="switch-global-enabled" />
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Auto-provisionar al login</p>
            <p className="text-xs text-muted-foreground">Crear instancia automáticamente cuando un usuario se registra</p>
          </div>
          <Switch checked={config?.autoProvisionOnLogin ?? true} onCheckedChange={(v) => updateMutation.mutate({ autoProvisionOnLogin: v })} data-testid="switch-auto-provision" />
        </div>

        <div className="rounded-lg border p-3 space-y-2">
          <div>
            <p className="text-sm font-medium">Límite de tokens por defecto</p>
            <p className="text-xs text-muted-foreground">Tokens asignados a cada nueva instancia</p>
          </div>
          <div className="flex items-center gap-2">
            <Input type="number" value={defaultLimit || config?.defaultTokensLimit || ""} onChange={(e) => setDefaultLimit(e.target.value)} placeholder={String(config?.defaultTokensLimit || 50000)} className="h-8 text-sm" data-testid="input-default-limit" />
            <Button size="sm" className="h-8" onClick={() => { if (defaultLimit) updateMutation.mutate({ defaultTokensLimit: parseInt(defaultLimit) }); }} data-testid="button-save-default-limit">Guardar</Button>
          </div>
        </div>

        <div className="rounded-lg border p-3 space-y-1">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium flex items-center gap-2"><GitBranch className="h-3.5 w-3.5" /> Repositorio GitHub</p>
              <p className="text-xs text-muted-foreground">{config?.githubRepo || "openclaw/openclaw"}</p>
            </div>
            <Badge variant="outline" className="text-[10px]">{config?.currentVersion || DEFAULT_OPENCLAW_RELEASE_TAG}</Badge>
          </div>
          {config?.lastSyncAt && <p className="text-[10px] text-muted-foreground">Última sincronización: {formatDate(config.lastSyncAt)}</p>}
        </div>
      </div>
    </div>
  );
}

export function OpenClawPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth();
  const isAdmin = user && ((user as any).role === "admin" || ((user as any).email || "").toLowerCase() === "carrerajorge874@gmail.com");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] p-0 gap-0 overflow-hidden" data-testid="openclaw-panel">
        <DialogHeader className="px-6 pt-5 pb-3">
          <div className="flex items-center gap-3">
            <OpenClawLogo className="h-8 w-8" />
            <div>
              <DialogTitle className="text-base">OpenClaw</DialogTitle>
              <DialogDescription className="text-xs">Instancia privada de agente IA</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 pb-5">
          <Tabs defaultValue="instance">
            <TabsList className="w-full justify-start h-9 mb-4">
              <TabsTrigger value="instance" className="text-xs" data-testid="tab-instance">
                <Cpu className="h-3.5 w-3.5 mr-1.5" /> Mi instancia
              </TabsTrigger>
              {isAdmin && (
                <>
                  <TabsTrigger value="admin-instances" className="text-xs" data-testid="tab-admin-instances">
                    <Users className="h-3.5 w-3.5 mr-1.5" /> Instancias
                  </TabsTrigger>
                  <TabsTrigger value="admin-config" className="text-xs" data-testid="tab-admin-config">
                    <Settings className="h-3.5 w-3.5 mr-1.5" /> Configuración
                  </TabsTrigger>
                </>
              )}
            </TabsList>

            <TabsContent value="instance" className="mt-0">
              <UserInstanceTab />
            </TabsContent>

            {isAdmin && (
              <>
                <TabsContent value="admin-instances" className="mt-0">
                  <AdminInstancesTab />
                </TabsContent>
                <TabsContent value="admin-config" className="mt-0">
                  <AdminConfigTab />
                </TabsContent>
              </>
            )}
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
