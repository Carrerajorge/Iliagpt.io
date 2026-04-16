import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, Clock, ExternalLink, Loader2, Play, Trash2, AlertCircle, Pencil, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatZonedDateTime, normalizeTimeZone } from "@/lib/platformDateTime";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { ScheduleDialog } from "@/components/schedule-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ScheduleType = "once" | "daily" | "weekly";

type ScheduleRow = {
  id: string;
  userId: string;
  chatId: string;
  name: string;
  prompt: string;
  scheduleType: ScheduleType;
  timeZone: string;
  runAt: string | null;
  timeOfDay: string | null;
  daysOfWeek: number[] | null;
  isActive: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  failureCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  chatTitle?: string | null;
};

async function getApiErrorMessage(res: Response): Promise<string> {
  const ct = res.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) {
      const json = await res.json();
      return String(json?.error || json?.message || JSON.stringify(json));
    }
  } catch {
    // ignore
  }
  return (await res.text()) || res.statusText;
}

function scheduleTypeLabel(t: ScheduleType): string {
  if (t === "once") return "Una vez";
  if (t === "daily") return "Diario";
  return "Semanal";
}

function weekdayLabel(days: number[] | null | undefined): string {
  if (!days || days.length === 0) return "";
  const map: Record<number, string> = {
    0: "Dom",
    1: "Lun",
    2: "Mar",
    3: "Mié",
    4: "Jue",
    5: "Vie",
    6: "Sáb",
  };
  return days
    .slice()
    .sort((a, b) => a - b)
    .map((d) => map[d] || String(d))
    .join(", ");
}

function truncate(s: string, max: number): string {
  const t = String(s || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}...`;
}

export function SchedulesManagerDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { open, onOpenChange } = props;
  const [, setLocation] = useLocation();
  const { user, isAuthenticated } = useAuth();
  const userId = user?.id || null;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { settings: platformSettings } = usePlatformSettings();

  const platformDateFormat = platformSettings.date_format;

  const schedulesQuery = useQuery<ScheduleRow[]>({
    queryKey: ["/api/users", userId, "schedules"],
    queryFn: async () => {
      const res = await fetch(`/api/users/${userId}/schedules`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(await getApiErrorMessage(res));
      return res.json();
    },
    enabled: !!userId && isAuthenticated && open,
  });

  const [deleteTarget, setDeleteTarget] = useState<ScheduleRow | null>(null);
  const [editTarget, setEditTarget] = useState<ScheduleRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const toggleActive = useMutation({
    mutationFn: async (row: { scheduleId: string; isActive: boolean }) => {
      const res = await fetch(`/api/users/${userId}/schedules/${row.scheduleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isActive: row.isActive }),
      });
      if (!res.ok) throw new Error(await getApiErrorMessage(res));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "schedules"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message || "No se pudo actualizar.", variant: "destructive" });
    },
  });

  const runNow = useMutation({
    mutationFn: async (scheduleId: string) => {
      const res = await fetch(`/api/users/${userId}/schedules/${scheduleId}/run`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await getApiErrorMessage(res));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "schedules"] });
      toast({ title: "Ejecución iniciada", description: "Se ejecutó la programación." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message || "No se pudo ejecutar.", variant: "destructive" });
    },
  });

  const deleteSchedule = useMutation({
    mutationFn: async (scheduleId: string) => {
      const res = await fetch(`/api/users/${userId}/schedules/${scheduleId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await getApiErrorMessage(res));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "schedules"] });
      toast({ title: "Eliminado", description: "Se eliminó la programación." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message || "No se pudo eliminar.", variant: "destructive" });
    },
  });

  const schedules = schedulesQuery.data || [];

  const summary = useMemo(() => {
    const active = schedules.filter((s) => s.isActive).length;
    const paused = schedules.length - active;
    return { total: schedules.length, active, paused };
  }, [schedules]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-4">
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Programaciones
            </DialogTitle>
            <DialogDescription>
              Administra ejecuciones futuras. Total: {summary.total} · Activas: {summary.active} · Pausadas: {summary.paused}
            </DialogDescription>
          </DialogHeader>

          <Separator />

          <ScrollArea className="max-h-[70vh]">
            <div className="p-6 space-y-4">
              {!isAuthenticated && (
                <div className="text-sm text-muted-foreground">
                  Inicia sesión para ver y administrar programaciones.
                </div>
              )}

              {isAuthenticated && schedulesQuery.isLoading && (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}

              {isAuthenticated && !schedulesQuery.isLoading && schedules.length === 0 && (
                <div className="text-sm text-muted-foreground">
                  Aún no tienes programaciones. Crea una desde el menú <span className="font-medium">⋯</span> en un chat con{" "}
                  <span className="font-medium">Programar</span>.
                </div>
              )}

              {isAuthenticated &&
                schedules.map((s) => {
                  const tz = normalizeTimeZone(s.timeZone);
                  const cadence =
                    s.scheduleType === "once"
                      ? "Una vez"
                      : s.scheduleType === "daily"
                        ? `Diario · ${s.timeOfDay || "--:--"}`
                        : `Semanal · ${weekdayLabel(s.daysOfWeek)} · ${s.timeOfDay || "--:--"}`;

                  const nextRunText = s.nextRunAt
                    ? formatZonedDateTime(s.nextRunAt, { timeZone: tz, dateFormat: platformDateFormat, includeSeconds: false })
                    : "No programado";

                  const lastRunText = s.lastRunAt
                    ? formatZonedDateTime(s.lastRunAt, { timeZone: tz, dateFormat: platformDateFormat, includeSeconds: false })
                    : null;

                  const hasIssue = !!s.lastError;
                  const issueLabel =
                    (s.failureCount || 0) > 0 ? `Error (${s.failureCount})` : "Aviso";

                  return (
                    <div key={s.id} className="rounded-lg border bg-card p-4 space-y-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">{s.name || "Programación"}</span>
                            <span
                              className={cn(
                                "text-[11px] px-2 py-0.5 rounded-full border",
                                s.isActive ? "bg-primary/10 text-primary border-primary/20" : "bg-muted text-muted-foreground",
                              )}
                            >
                              {s.isActive ? "Activa" : "Pausada"}
                            </span>
                            <span className="text-xs text-muted-foreground truncate">
                              {s.chatTitle ? `· ${s.chatTitle}` : ""}
                            </span>
                          </div>

                          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5" />
                              {cadence}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              Próxima: <span className="font-medium text-foreground/80">{nextRunText}</span>
                            </span>
                            <span className="inline-flex items-center gap-1">TZ: {tz}</span>
                            {lastRunText && <span className="inline-flex items-center gap-1">Última: {lastRunText}</span>}
                          </div>

                          <div className="text-sm mt-3 text-foreground/90">
                            {truncate(s.prompt, 200)}
                          </div>

                          {hasIssue && (
                            <div className="mt-2 text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
                              <AlertCircle className="h-4 w-4 mt-0.5" />
                              <div>
                                <div className="font-medium">{issueLabel}</div>
                                <div className="text-red-700/90 dark:text-red-300/90">{truncate(s.lastError || "", 240)}</div>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="shrink-0 flex flex-col items-end gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Activa</span>
                            <Switch
                              checked={s.isActive}
                              onCheckedChange={(checked) =>
                                toggleActive.mutate({ scheduleId: s.id, isActive: checked })
                              }
                              disabled={toggleActive.isPending}
                            />
                          </div>

                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setLocation(`/chat/${s.chatId}`)}
                              className="gap-1"
                            >
                              <ExternalLink className="h-4 w-4" />
                              Ir al chat
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setEditTarget(s)}
                              className="gap-1"
                            >
                              <Pencil className="h-4 w-4" />
                              Editar
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => runNow.mutate(s.id)}
                              disabled={runNow.isPending}
                              className="gap-1"
                            >
                              {runNow.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )}
                              Ejecutar
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setDeleteTarget(s)}
                              disabled={deleteSchedule.isPending}
                              className="gap-1 text-red-500 border-red-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                            >
                              <Trash2 className="h-4 w-4" />
                              Eliminar
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </ScrollArea>

          <Separator />

          <div className="p-4 flex items-center justify-between gap-2">
            <Button
              onClick={() => setCreateOpen(true)}
              disabled={!isAuthenticated}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Nueva programación
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cerrar
            </Button>
            <Button
              variant="outline"
              onClick={() => schedulesQuery.refetch()}
              disabled={schedulesQuery.isFetching}
              className="gap-2"
            >
              {schedulesQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Refrescar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar programación?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará la programación{" "}
              <span className="font-medium">{deleteTarget?.name || "Programación"}</span>. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTarget(null)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleteTarget) return;
                deleteSchedule.mutate(deleteTarget.id, {
                  onSuccess: () => setDeleteTarget(null),
                  onError: () => setDeleteTarget(null),
                });
              }}
              className="bg-red-500 hover:bg-red-600"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {editTarget ? (
        <ScheduleDialog
          open={!!editTarget}
          onOpenChange={(o) => {
            if (!o) setEditTarget(null);
          }}
          chatId={editTarget.chatId}
          schedule={{
            id: editTarget.id,
            name: editTarget.name,
            prompt: editTarget.prompt,
            scheduleType: editTarget.scheduleType,
            timeZone: editTarget.timeZone,
            runAt: editTarget.runAt,
            timeOfDay: editTarget.timeOfDay,
            daysOfWeek: editTarget.daysOfWeek,
            isActive: editTarget.isActive,
          }}
        />
      ) : null}

      <ScheduleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        chatId={null}
      />
    </>
  );
}
