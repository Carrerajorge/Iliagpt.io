import { useCallback, useMemo } from "react";
import { Bell, Calendar, CheckCircle2, Clock, Loader2, Monitor, Trash2, Volume2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { playNotificationPing } from "@/lib/notification-sound";
import { channelIncludesPush, isWithinQuietHours, type NotificationChannel } from "@/lib/notification-preferences";
import {
  useNotifications as useBackgroundNotifications,
  usePendingBadges,
  useProcessingChatIds,
  useStreamingStore,
} from "@/stores/streamingStore";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";

type NotificationsControlPanelsProps = {
  onOpenSchedules?: () => void;
};

const channelOptions: Array<{ value: NotificationChannel; label: string; description: string }> = [
  { value: "push", label: "Push", description: "Notificaciones dentro de ILIAGPT" },
  { value: "email", label: "Email", description: "Correos (si está disponible)" },
  { value: "push_email", label: "Push y Email", description: "Ambos canales" },
  { value: "none", label: "Ninguna", description: "No recibir notificaciones" },
];

function getNotificationPermissionLabel(permission: NotificationPermission | "unsupported") {
  if (permission === "unsupported") return "No compatible";
  if (permission === "granted") return "Permitidas";
  if (permission === "denied") return "Bloqueadas";
  return "Sin configurar";
}

export function NotificationsControlPanels({ onOpenSchedules }: NotificationsControlPanelsProps) {
  const { settings, updateSetting } = useSettingsContext();
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  const initialTab = useMemo<"preferences" | "tasks">(() => {
    if (typeof window === "undefined") return "preferences";
    const t = new URLSearchParams(window.location.search).get("tab");
    return t === "tasks" ? "tasks" : "preferences";
  }, []);

  const desktopSupported = typeof window !== "undefined" && "Notification" in window;
  const permission: NotificationPermission | "unsupported" = desktopSupported ? Notification.permission : "unsupported";

  const isQuietNow = useMemo(
    () =>
      isWithinQuietHours({
        enabled: settings.notifQuietHours,
        start: settings.notifQuietStart,
        end: settings.notifQuietEnd,
      }),
    [settings.notifQuietHours, settings.notifQuietStart, settings.notifQuietEnd]
  );

  const handleDesktopToggle = useCallback(
    async (checked: boolean) => {
      if (!checked) {
        updateSetting("notifDesktop", false);
        return;
      }

      if (!desktopSupported) {
        updateSetting("notifDesktop", false);
        toast({
          title: "Notificaciones de escritorio no compatibles",
          description: "Tu navegador no soporta notificaciones del sistema.",
        });
        return;
      }

      if (Notification.permission === "granted") {
        updateSetting("notifDesktop", true);
        return;
      }

      if (Notification.permission === "denied") {
        updateSetting("notifDesktop", false);
        toast({
          title: "Permiso bloqueado",
          description: "Actívalo desde la configuración del navegador para este sitio.",
        });
        return;
      }

      try {
        const result = await Notification.requestPermission();
        if (result === "granted") {
          updateSetting("notifDesktop", true);
          toast({ title: "Notificaciones habilitadas", description: "Listo: puedes recibir avisos del sistema." });
        } else {
          updateSetting("notifDesktop", false);
          toast({ title: "Permiso no concedido", description: "Puedes volver a intentarlo cuando quieras." });
        }
      } catch {
        updateSetting("notifDesktop", false);
        toast({ title: "No se pudo solicitar permiso", description: "Inténtalo de nuevo." });
      }
    },
    [desktopSupported, toast, updateSetting]
  );

  const sendTestNotification = useCallback(async () => {
    const pushEnabled = channelIncludesPush(settings.notifResponses);

    if (isQuietNow) {
      toast({
        title: "Horas silenciosas activas",
        description: "Desactívalas temporalmente para probar notificaciones.",
      });
      return;
    }

    if (settings.notifInApp && pushEnabled) {
      toast({
        title: "Notificación de prueba",
        description: "Si estás en otra pestaña, también puedes probar escritorio y sonido.",
      });
    } else if (!pushEnabled) {
      toast({
        title: "Push desactivado para Respuestas",
        description: "Activa 'En la app' en Respuestas para ver la notificación de prueba.",
      });
    }

    if (settings.notifSound && pushEnabled) {
      await playNotificationPing();
    }

    if (settings.notifDesktop && pushEnabled && desktopSupported) {
      if (Notification.permission === "granted") {
        try {
          new Notification("ILIAGPT", { body: "Notificación de prueba", icon: "/favicon.png" });
        } catch {
          // Ignore
        }
      } else {
        toast({
          title: "Permiso de escritorio pendiente",
          description: "Activa el permiso para completar la prueba.",
        });
      }
    }
  }, [desktopSupported, isQuietNow, settings.notifDesktop, settings.notifInApp, settings.notifResponses, settings.notifSound, toast]);

  const processingChatIds = useProcessingChatIds();
  const backgroundNotifications = useBackgroundNotifications();
  const pendingBadges = usePendingBadges();

  const userId = user?.id;
  const schedulesQuery = useQuery<any[]>({
    queryKey: ["/api/users", userId, "schedules"],
    enabled: !!userId && !!isAuthenticated,
    queryFn: async () => {
      const res = await fetch(`/api/users/${userId}/schedules`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.text()) || res.statusText);
      return res.json();
    },
  });

  const scheduleStats = useMemo(() => {
    const rows = schedulesQuery.data || [];
    const active = rows.filter((s: any) => !!s?.isActive).length;

    const nextRunAt = rows
      .filter((s: any) => !!s?.isActive && !!s?.nextRunAt)
      .map((s: any) => new Date(String(s.nextRunAt)))
      .filter((d: Date) => Number.isFinite(d.getTime()))
      .sort((a: Date, b: Date) => a.getTime() - b.getTime())[0];

    return {
      total: rows.length,
      active,
      nextRunAt: nextRunAt || null,
    };
  }, [schedulesQuery.data]);

  const pendingBadgeCount = useMemo(
    () => Object.values(pendingBadges).reduce((sum, v) => sum + (Number(v) || 0), 0),
    [pendingBadges]
  );

  const clearAllBadges = useStreamingStore((s) => s.clearAllBadges);
  const clearNotifications = useStreamingStore((s) => s.clearNotifications);
  const dismissNotification = useStreamingStore((s) => s.dismissNotification);

  const dismissAllNotifications = useCallback(() => {
    backgroundNotifications.forEach((n) => dismissNotification(n.id));
  }, [backgroundNotifications, dismissNotification]);

  const openSchedules = useCallback(() => {
    onOpenSchedules?.();
  }, [onOpenSchedules]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold" data-testid="text-notifications-title">
          Preferencias de Notificaciones
        </h2>
        <p className="text-sm text-muted-foreground mt-1" data-testid="text-notifications-description">
          Configura cómo y cuándo recibir notificaciones
        </p>
      </div>

      <Tabs defaultValue={initialTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="preferences">Preferencias</TabsTrigger>
          <TabsTrigger value="tasks">Administrar tareas</TabsTrigger>
        </TabsList>

        <TabsContent value="preferences" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Bell className="h-4 w-4" />
                Canales
              </CardTitle>
              <CardDescription>Elige cómo quieres recibir avisos por categoría.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">Respuestas</div>
                    <div className="text-xs text-muted-foreground">Cuando una respuesta se completa en segundo plano.</div>
                  </div>
                  <Select
                    value={settings.notifResponses}
                    onValueChange={(v) => updateSetting("notifResponses", v as any)}
                  >
                    <SelectTrigger className="w-44" data-testid="select-notif-responses">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {channelOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">Tareas</div>
                    <div className="text-xs text-muted-foreground">Procesos de larga duración (ej. hojas de cálculo).</div>
                  </div>
                  <Select
                    value={settings.notifTasks}
                    onValueChange={(v) => updateSetting("notifTasks", v as any)}
                  >
                    <SelectTrigger className="w-44" data-testid="select-notif-tasks">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {channelOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">Proyectos</div>
                    <div className="text-xs text-muted-foreground">Invitaciones, menciones y actividad compartida.</div>
                  </div>
                  <Select
                    value={settings.notifProjects}
                    onValueChange={(v) => updateSetting("notifProjects", v as any)}
                  >
                    <SelectTrigger className="w-44" data-testid="select-notif-projects">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {channelOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">Recomendaciones</div>
                    <div className="text-xs text-muted-foreground">Novedades y sugerencias del producto.</div>
                  </div>
                  <Select
                    value={settings.notifRecommendations}
                    onValueChange={(v) => updateSetting("notifRecommendations", v as any)}
                  >
                    <SelectTrigger className="w-44" data-testid="select-notif-recommendations">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {channelOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Bell className="h-4 w-4 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">En la app</div>
                      <div className="text-xs text-muted-foreground">Toasts dentro de ILIAGPT</div>
                    </div>
                  </div>
                  <Switch
                    checked={settings.notifInApp}
                    onCheckedChange={(v) => updateSetting("notifInApp", v)}
                    data-testid="switch-notif-in-app"
                  />
                </div>

                <div className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Volume2 className="h-4 w-4 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">Sonido</div>
                      <div className="text-xs text-muted-foreground">Alertas sutiles</div>
                    </div>
                  </div>
                  <Switch
                    checked={settings.notifSound}
                    onCheckedChange={(v) => updateSetting("notifSound", v)}
                    data-testid="switch-notif-sound"
                  />
                </div>

                <div className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Monitor className="h-4 w-4 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">Escritorio</div>
                      <div className="text-xs text-muted-foreground">
                        {getNotificationPermissionLabel(permission)}
                      </div>
                    </div>
                  </div>
                  <Switch
                    checked={settings.notifDesktop}
                    onCheckedChange={handleDesktopToggle}
                    disabled={!desktopSupported}
                    data-testid="switch-notif-desktop"
                  />
                </div>
              </div>

              <Separator />

              <div className="flex items-start justify-between gap-4 rounded-lg border bg-card p-3">
                <div className="flex items-start gap-2 min-w-0">
                  <Clock className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium">Horas silenciosas</div>
                      {isQuietNow ? (
                        <Badge variant="secondary" className="h-5 px-2 text-[11px]">
                          Activas
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Pausa toasts, sonidos y escritorio durante este horario.
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className={cn("flex items-center gap-2", !settings.notifQuietHours && "opacity-50")}>
                    <Input
                      type="time"
                      className="w-[118px]"
                      value={settings.notifQuietStart}
                      onChange={(e) => updateSetting("notifQuietStart", e.target.value)}
                      disabled={!settings.notifQuietHours}
                      data-testid="input-quiet-start"
                    />
                    <span className="text-xs text-muted-foreground">a</span>
                    <Input
                      type="time"
                      className="w-[118px]"
                      value={settings.notifQuietEnd}
                      onChange={(e) => updateSetting("notifQuietEnd", e.target.value)}
                      disabled={!settings.notifQuietHours}
                      data-testid="input-quiet-end"
                    />
                  </div>
                  <Switch
                    checked={settings.notifQuietHours}
                    onCheckedChange={(v) => updateSetting("notifQuietHours", v)}
                    data-testid="switch-quiet-hours"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end">
                <Button variant="outline" onClick={sendTestNotification} data-testid="button-test-notification">
                  Probar notificación
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tasks" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Tareas en segundo plano
              </CardTitle>
              <CardDescription>Control rápido de tareas activas y avisos recientes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="rounded-lg border bg-card p-3">
                  <div className="text-xs text-muted-foreground">En curso</div>
                  <div className="text-lg font-semibold" data-testid="stat-tasks-running">
                    {processingChatIds.length}
                  </div>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <div className="text-xs text-muted-foreground">Badges pendientes</div>
                  <div className="text-lg font-semibold" data-testid="stat-badges-pending">
                    {pendingBadgeCount}
                  </div>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <div className="text-xs text-muted-foreground">Avisos</div>
                  <div className="text-lg font-semibold" data-testid="stat-notifications">
                    {backgroundNotifications.length}
                  </div>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <div className="text-xs text-muted-foreground flex items-center justify-between gap-2">
                    <span>Programaciones</span>
                    {schedulesQuery.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  </div>
                  <div className="text-lg font-semibold" data-testid="stat-schedules-active">
                    {isAuthenticated ? scheduleStats.active : "—"}
                  </div>
                  {isAuthenticated && scheduleStats.nextRunAt ? (
                    <div className="text-[11px] text-muted-foreground mt-1">
                      Próxima: {scheduleStats.nextRunAt.toLocaleString()}
                    </div>
                  ) : (
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {isAuthenticated ? "Sin próxima ejecución" : "Inicia sesión"}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={dismissAllNotifications} data-testid="button-dismiss-all-notifs">
                  Marcar avisos como leídos
                </Button>
                <Button variant="outline" size="sm" onClick={clearNotifications} data-testid="button-clear-notifs">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Limpiar avisos
                </Button>
                <Button variant="outline" size="sm" onClick={clearAllBadges} data-testid="button-clear-badges">
                  Limpiar badges
                </Button>
                <Button variant="outline" size="sm" onClick={openSchedules} disabled={!onOpenSchedules} data-testid="button-open-schedules">
                  <Calendar className="h-4 w-4 mr-2" />
                  Programaciones
                </Button>
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="text-sm font-medium">En curso</div>
                {processingChatIds.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No hay tareas en curso.</div>
                ) : (
                  <div className="space-y-1">
                    {processingChatIds.slice(0, 6).map((id) => (
                      <div key={id} className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">Chat</div>
                          <div className="text-xs text-muted-foreground truncate">{id}</div>
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          <Badge variant="secondary" className="shrink-0">
                            En curso
                          </Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setLocation(`/chat/${id}`)}
                            data-testid={`button-open-processing-${id}`}
                          >
                            Abrir
                          </Button>
                        </div>
                      </div>
                    ))}
                    {processingChatIds.length > 6 ? (
                      <div className="text-xs text-muted-foreground">
                        +{processingChatIds.length - 6} más…
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="text-sm font-medium">Avisos recientes</div>
                {backgroundNotifications.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Aún no hay avisos.</div>
                ) : (
                  <div className="space-y-1">
                    {backgroundNotifications
                      .slice(-5)
                      .reverse()
                      .map((n) => (
                        <div key={n.id} className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{n.chatTitle}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {n.type === "completed" ? "Completada" : "Fallida"} · {n.preview}
                            </div>
                          </div>
                          <div className="shrink-0 flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                dismissNotification(n.id);
                                setLocation(`/chat/${n.chatId}`);
                              }}
                              data-testid={`button-open-notif-${n.id}`}
                            >
                              Abrir
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => dismissNotification(n.id)}
                              className="shrink-0"
                              data-testid={`button-dismiss-${n.id}`}
                            >
                              Ocultar
                            </Button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
