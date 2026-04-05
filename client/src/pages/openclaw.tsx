import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/apiClient";
import { toast } from "sonner";
import { isAdminUser } from "@/lib/admin";
import { OpenClawLogo } from "@/components/openclaw-panel";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch as SwitchUI } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  MessageSquare, BarChart3, Radio, Cpu, Users, Clock, Zap,
  CalendarClock, Bot, Sparkles, GitFork, Settings, Bell,
  Paintbrush, Cog, FileText, ArrowLeft, RefreshCw, Hash,
  Activity, Trash2, Pause, Play, RotateCcw, Shield, GitBranch,
  Send, ChevronLeft,
} from "lucide-react";

type Section =
  | "chat"
  | "resumen"
  | "canales"
  | "instancias"
  | "sesiones"
  | "uso"
  | "tareas-cron"
  | "agentes"
  | "habilidades"
  | "nodos"
  | "configuracion"
  | "communications"
  | "appearance"
  | "automation"
  | "docs";

const NAV_GROUPS = [
  {
    label: "CHAT",
    items: [
      { id: "chat" as Section, label: "Chat", icon: MessageSquare },
    ],
  },
  {
    label: "CONTROL",
    items: [
      { id: "resumen" as Section, label: "Resumen", icon: BarChart3 },
      { id: "canales" as Section, label: "Canales", icon: Radio },
      { id: "instancias" as Section, label: "Instancias", icon: Cpu },
      { id: "sesiones" as Section, label: "Sesiones", icon: Users },
      { id: "uso" as Section, label: "Uso", icon: Zap },
      { id: "tareas-cron" as Section, label: "Tareas Cron", icon: CalendarClock },
    ],
  },
  {
    label: "AGENTE",
    items: [
      { id: "agentes" as Section, label: "Agentes", icon: Bot },
      { id: "habilidades" as Section, label: "Habilidades", icon: Sparkles },
      { id: "nodos" as Section, label: "Nodos", icon: GitFork },
    ],
  },
  {
    label: "AJUSTES",
    items: [
      { id: "configuracion" as Section, label: "Configuración", icon: Settings },
      { id: "communications" as Section, label: "Communications", icon: Bell },
      { id: "appearance" as Section, label: "Appearance", icon: Paintbrush },
      { id: "automation" as Section, label: "Automation", icon: Cog },
      { id: "docs" as Section, label: "Docs", icon: FileText },
    ],
  },
];

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
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

function OpenClawChat() {
  const [messages, setMessages] = useState<{ role: string; content: string; timestamp: Date; model?: string; tokensIn?: number; tokensOut?: number }[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text, timestamp: new Date() }]);
    setIsStreaming(true);

    try {
      const res = await apiFetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, { role: "user", content: text }].map((m) => ({ role: m.role, content: m.content })),
          model: "gemini-2.5-flash-preview-05-20",
          openclawMode: true,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${err}`, timestamp: new Date() }]);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";
      let model = "";
      let tokensIn = 0;
      let tokensOut = 0;

      setMessages((prev) => [...prev, { role: "assistant", content: "", timestamp: new Date() }]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.choices?.[0]?.delta?.content) {
                assistantContent += parsed.choices[0].delta.content;
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { ...updated[updated.length - 1], content: assistantContent };
                  return updated;
                });
              }
              if (parsed.model) model = parsed.model;
              if (parsed.usage) {
                tokensIn = parsed.usage.prompt_tokens || 0;
                tokensOut = parsed.usage.completion_tokens || 0;
              }
            } catch {}
          }
        }
      }

      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content: assistantContent || "(sin respuesta)",
          model,
          tokensIn,
          tokensOut,
        };
        return updated;
      });
    } catch (err: any) {
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${err.message}`, timestamp: new Date() }]);
    } finally {
      setIsStreaming(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex flex-col h-full" data-testid="openclaw-chat">
      <div className="border-b px-6 py-3 flex items-center gap-3">
        <span className="text-sm text-muted-foreground">OpenClaw</span>
        <span className="text-sm text-muted-foreground">›</span>
        <span className="text-sm font-medium">Chat</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-3 text-muted-foreground">
            <OpenClawLogo className="h-16 w-16 opacity-40" />
            <p className="text-sm">Escribe un mensaje para comenzar a chatear con OpenClaw</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={cn("flex gap-3", msg.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn(
              "rounded-2xl px-4 py-2.5 max-w-[75%] text-sm whitespace-pre-wrap",
              msg.role === "user"
                ? "bg-primary text-primary-foreground"
                : "bg-muted"
            )}>
              {msg.content}
              {msg.role === "assistant" && msg.model && (
                <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground border-t pt-1.5">
                  <span>★ Assistant {msg.timestamp.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}</span>
                  {msg.tokensIn ? <span>T{formatNumber(msg.tokensIn)}</span> : null}
                  {msg.tokensOut ? <span>↓{formatNumber(msg.tokensOut)}</span> : null}
                  <span className="truncate">{msg.model}</span>
                </div>
              )}
            </div>
          </div>
        ))}
        {isStreaming && messages[messages.length - 1]?.content === "" && (
          <div className="flex gap-3 justify-start">
            <div className="bg-muted rounded-2xl px-4 py-2.5 text-sm">
              <span className="animate-pulse">●●●</span>
            </div>
          </div>
        )}
      </div>

      <div className="border-t px-6 py-3">
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="Message Assistant (Enter to send)"
            className="flex-1"
            disabled={isStreaming}
            data-testid="input-openclaw-chat"
          />
          <Button size="icon" onClick={handleSend} disabled={isStreaming || !input.trim()} data-testid="button-openclaw-send">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function ResumenView() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/openclaw/instance"],
    queryFn: () => apiFetch("/api/openclaw/instance").then((r) => r.json()),
    refetchInterval: 30000,
  });
  const { data: tokenData } = useQuery({
    queryKey: ["/api/openclaw/instance/tokens"],
    queryFn: () => apiFetch("/api/openclaw/instance/tokens").then((r) => r.json()),
  });

  if (isLoading) return <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">Cargando...</div>;

  const instance = data?.instance;
  const budget = instance?.budget;
  const history = tokenData?.history || [];
  const usagePercent = budget ? Math.min(100, (budget.used / budget.limit) * 100) : 0;

  return (
    <div className="p-6 space-y-6 max-w-3xl" data-testid="openclaw-resumen">
      <div>
        <h2 className="text-lg font-semibold">Resumen de instancia</h2>
        <p className="text-sm text-muted-foreground">Estado y uso de tu instancia OpenClaw</p>
      </div>

      <div className="flex items-center gap-4">
        <OpenClawLogo className="h-12 w-12" />
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold" data-testid="text-instance-id">{instance?.instanceId || "Sin instancia"}</span>
            <StatusBadge status={instance?.status || "unknown"} />
          </div>
          <p className="text-xs text-muted-foreground">v{instance?.version || "2026.4.2"}</p>
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" /> Tokens utilizados</span>
          <span className="font-medium">{formatNumber(budget?.used || 0)} / {formatNumber(budget?.limit || 0)}</span>
        </div>
        <Progress value={usagePercent} className="h-2" />
        {usagePercent > 80 && <p className="text-xs text-amber-500">Advertencia: has usado el {usagePercent.toFixed(0)}% de tus tokens</p>}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border p-4 space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground"><Hash className="h-3 w-3" /><span className="text-xs uppercase tracking-wider">Solicitudes</span></div>
          <p className="text-2xl font-semibold">{formatNumber(instance?.requestCount || 0)}</p>
        </div>
        <div className="rounded-lg border p-4 space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground"><Clock className="h-3 w-3" /><span className="text-xs uppercase tracking-wider">Último uso</span></div>
          <p className="text-sm font-medium">{formatDate(instance?.lastActiveAt)}</p>
        </div>
        <div className="rounded-lg border p-4 space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground"><Activity className="h-3 w-3" /><span className="text-xs uppercase tracking-wider">Estado</span></div>
          <StatusBadge status={instance?.status || "unknown"} />
        </div>
      </div>

      {history.length > 0 && (
        <>
          <Separator />
          <div>
            <h3 className="text-sm font-semibold mb-3">Historial reciente de tokens</h3>
            <div className="space-y-1">
              {history.slice(0, 20).map((entry: any) => (
                <div key={entry.id} className="flex items-center justify-between py-2 px-3 text-xs rounded hover:bg-accent/40">
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
          </div>
        </>
      )}
    </div>
  );
}

function InstanciasView() {
  const { user } = useAuth();
  const isAdmin = user && isAdminUser(user);
  const queryClient = useQueryClient();
  const [editingLimit, setEditingLimit] = useState<{ id: string; value: string } | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/openclaw/admin/instances"],
    queryFn: () => apiFetch("/api/openclaw/admin/instances").then((r) => r.json()),
    enabled: !!isAdmin,
    refetchInterval: 15000,
  });

  async function checkedFetch(url: string, opts?: RequestInit) {
    const r = await apiFetch(url, opts);
    const d = await r.json();
    if (!r.ok || d.success === false) throw new Error(d.error || "Error desconocido");
    return d;
  }

  const updateTokensMutation = useMutation({
    mutationFn: ({ id, tokensLimit }: { id: string; tokensLimit: number }) =>
      checkedFetch(`/api/openclaw/admin/instances/${id}/tokens`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tokensLimit }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/openclaw/admin/instances"] }); toast.success("Límite actualizado"); setEditingLimit(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      checkedFetch(`/api/openclaw/admin/instances/${id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/openclaw/admin/instances"] }); toast.success("Estado actualizado"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetTokensMutation = useMutation({
    mutationFn: (id: string) =>
      checkedFetch(`/api/openclaw/admin/instances/${id}/reset-tokens`, { method: "POST" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/openclaw/admin/instances"] }); toast.success("Tokens reiniciados"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteInstanceMutation = useMutation({
    mutationFn: (id: string) =>
      checkedFetch(`/api/openclaw/admin/instances/${id}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/openclaw/admin/instances"] }); toast.success("Instancia eliminada"); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isAdmin) return <div className="p-6 text-sm text-muted-foreground">Solo los administradores pueden ver las instancias.</div>;
  if (isLoading) return <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">Cargando instancias...</div>;

  const stats = data?.stats;
  const instances = data?.instances || [];

  return (
    <div className="p-6 space-y-6 max-w-4xl" data-testid="openclaw-instancias">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><Users className="h-5 w-5" /> Instancias de usuarios</h2>
          <p className="text-sm text-muted-foreground">Gestión de instancias OpenClaw de todos los usuarios</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-admin-refresh">
          <RefreshCw className="h-4 w-4 mr-1.5" /> Actualizar
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-lg border p-3 text-center">
          <p className="text-2xl font-bold">{stats?.totalInstances || 0}</p>
          <p className="text-xs text-muted-foreground uppercase">Total</p>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <p className="text-2xl font-bold text-green-600">{stats?.activeInstances || 0}</p>
          <p className="text-xs text-muted-foreground uppercase">Activas</p>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <p className="text-2xl font-bold text-orange-500">{formatNumber(stats?.totalTokensUsed || 0)}</p>
          <p className="text-xs text-muted-foreground uppercase">Tokens</p>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <p className="text-2xl font-bold text-blue-500">{formatNumber(stats?.totalRequests || 0)}</p>
          <p className="text-xs text-muted-foreground uppercase">Peticiones</p>
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        {instances.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No hay instancias registradas</p>}
        {instances.map((inst: any) => {
          const pct = inst.tokensLimit > 0 ? Math.min(100, (inst.tokensUsed / inst.tokensLimit) * 100) : 0;
          return (
            <div key={inst.id} className="rounded-lg border p-4 space-y-2" data-testid={`admin-instance-${inst.id}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Cpu className="h-4 w-4 text-orange-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{inst.user?.email || inst.userId}</p>
                    <p className="text-[10px] text-muted-foreground">{inst.instanceId} · {inst.user?.plan || "free"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <StatusBadge status={inst.status} />
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleStatusMutation.mutate({ id: inst.id, status: inst.status === "active" ? "suspended" : "active" })}>
                    {inst.status === "active" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => resetTokensMutation.mutate(inst.id)}>
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => { if (confirm("¿Eliminar esta instancia?")) deleteInstanceMutation.mutate(inst.id); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Progress value={pct} className="h-1.5 flex-1" />
                <span className="text-[10px] text-muted-foreground shrink-0">{formatNumber(inst.tokensUsed)}/{formatNumber(inst.tokensLimit)}</span>
              </div>
              {editingLimit?.id === inst.id ? (
                <div className="flex items-center gap-2">
                  <Input type="number" value={editingLimit.value} onChange={(e) => setEditingLimit({ id: inst.id, value: e.target.value })} className="h-7 text-xs" />
                  <Button size="sm" className="h-7 text-xs" onClick={() => updateTokensMutation.mutate({ id: inst.id, tokensLimit: parseInt(editingLimit.value) || 0 })}>Guardar</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingLimit(null)}>Cancelar</Button>
                </div>
              ) : (
                <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => setEditingLimit({ id: inst.id, value: String(inst.tokensLimit) })}>
                  Editar límite
                </Button>
              )}
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span>{inst.requestCount} solicitudes</span>
                <span>Creado: {formatDate(inst.createdAt)}</span>
                <span>Último: {formatDate(inst.lastActiveAt)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConfiguracionView() {
  const { user } = useAuth();
  const isAdmin = user && isAdminUser(user);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["/api/openclaw/admin/config"],
    queryFn: () => apiFetch("/api/openclaw/admin/config").then((r) => r.json()),
    enabled: !!isAdmin,
  });

  const updateMutation = useMutation({
    mutationFn: (updates: Record<string, unknown>) =>
      apiFetch("/api/openclaw/admin/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) }).then((r) => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/openclaw/admin/config"] }); toast.success("Configuración actualizada"); },
  });

  const [defaultLimit, setDefaultLimit] = useState("");

  if (!isAdmin) return <div className="p-6 text-sm text-muted-foreground">Solo los administradores pueden acceder a la configuración.</div>;
  if (isLoading) return <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">Cargando configuración...</div>;

  const config = data?.config;

  return (
    <div className="p-6 space-y-6 max-w-2xl" data-testid="openclaw-configuracion">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2"><Settings className="h-5 w-5" /> Configuración global</h2>
        <p className="text-sm text-muted-foreground">Ajustes globales de OpenClaw para todas las instancias</p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">Instancias habilitadas</p>
            <p className="text-xs text-muted-foreground">Permite la creación de nuevas instancias OpenClaw</p>
          </div>
          <SwitchUI checked={config?.globalEnabled ?? true} onCheckedChange={(v) => updateMutation.mutate({ globalEnabled: v })} />
        </div>

        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">Auto-provisionar al login</p>
            <p className="text-xs text-muted-foreground">Crear instancia automáticamente cuando un usuario se registra</p>
          </div>
          <SwitchUI checked={config?.autoProvisionOnLogin ?? true} onCheckedChange={(v) => updateMutation.mutate({ autoProvisionOnLogin: v })} />
        </div>

        <div className="rounded-lg border p-4 space-y-3">
          <div>
            <p className="text-sm font-medium">Límite de tokens por defecto</p>
            <p className="text-xs text-muted-foreground">Tokens asignados a cada nueva instancia</p>
          </div>
          <div className="flex items-center gap-2">
            <Input type="number" value={defaultLimit || config?.defaultTokensLimit || ""} onChange={(e) => setDefaultLimit(e.target.value)} placeholder={String(config?.defaultTokensLimit || 50000)} className="h-8 text-sm" />
            <Button size="sm" className="h-8" onClick={() => { if (defaultLimit) updateMutation.mutate({ defaultTokensLimit: parseInt(defaultLimit) }); }}>Guardar</Button>
          </div>
        </div>

        <div className="rounded-lg border p-4 space-y-1">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium flex items-center gap-2"><GitBranch className="h-3.5 w-3.5" /> Repositorio GitHub</p>
              <p className="text-xs text-muted-foreground">{config?.githubRepo || "openclaw/openclaw"}</p>
            </div>
            <Badge variant="outline" className="text-[10px]">{config?.currentVersion || "v2026.4.2"}</Badge>
          </div>
          {config?.lastSyncAt && <p className="text-[10px] text-muted-foreground">Última sincronización: {formatDate(config.lastSyncAt)}</p>}
        </div>
      </div>
    </div>
  );
}

function PlaceholderView({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-6 space-y-4 max-w-3xl" data-testid={`openclaw-${title.toLowerCase()}`}>
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        <p className="text-sm">Esta sección estará disponible próximamente.</p>
      </div>
    </div>
  );
}

function SectionContent({ section }: { section: Section }) {
  switch (section) {
    case "chat": return <OpenClawChat />;
    case "resumen": return <ResumenView />;
    case "instancias": return <InstanciasView />;
    case "configuracion": return <ConfiguracionView />;
    case "canales": return <PlaceholderView title="Canales" description="Gestiona los canales de comunicación de tu instancia" />;
    case "sesiones": return <PlaceholderView title="Sesiones" description="Sesiones activas y historial de conexiones" />;
    case "uso": return <PlaceholderView title="Uso" description="Estadísticas detalladas de uso de recursos" />;
    case "tareas-cron": return <PlaceholderView title="Tareas Cron" description="Programación de tareas automáticas" />;
    case "agentes": return <PlaceholderView title="Agentes" description="Agentes especializados disponibles en tu instancia" />;
    case "habilidades": return <PlaceholderView title="Habilidades" description="Habilidades y capacidades de los agentes" />;
    case "nodos": return <PlaceholderView title="Nodos" description="Nodos de procesamiento y configuración de flujos" />;
    case "communications": return <PlaceholderView title="Communications" description="Configuración de comunicaciones y notificaciones" />;
    case "appearance": return <PlaceholderView title="Appearance" description="Personalización visual de la interfaz" />;
    case "automation": return <PlaceholderView title="Automation" description="Reglas y automatizaciones del sistema" />;
    case "docs": return <PlaceholderView title="Docs" description="Documentación y recursos de OpenClaw" />;
    default: return <OpenClawChat />;
  }
}

export default function OpenClawPage() {
  const [, setLocation] = useLocation();
  const [activeSection, setActiveSection] = useState<Section>("chat");
  const { user } = useAuth();

  return (
    <div className="flex h-screen bg-background" data-testid="openclaw-page">
      <div className="w-[220px] border-r flex flex-col bg-muted/30 shrink-0">
        <div className="px-4 py-4 flex items-center gap-2 border-b">
          <button onClick={() => setLocation("/")} className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer" data-testid="button-back-to-app">
            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
          </button>
          <div className="flex items-center gap-2">
            <div className="bg-red-500 rounded-lg p-1">
              <OpenClawLogo className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Control</p>
              <p className="text-sm font-bold leading-tight">OpenClaw</p>
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1 py-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-1">
              <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{group.label}</p>
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveSection(item.id)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-4 py-1.5 text-sm transition-colors cursor-pointer",
                      isActive
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    )}
                    data-testid={`nav-openclaw-${item.id}`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </ScrollArea>

        <div className="border-t p-3">
          <div className="flex items-center gap-2">
            <Avatar className="h-7 w-7">
              <AvatarImage src={(user as any)?.profileImageUrl} />
              <AvatarFallback className="text-[10px]">{((user as any)?.firstName || (user as any)?.email || "U")[0].toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">{(user as any)?.firstName || "Usuario"}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Cuenta personal</p>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">VERSION v2026.4.2</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <SectionContent section={activeSection} />
      </div>
    </div>
  );
}
