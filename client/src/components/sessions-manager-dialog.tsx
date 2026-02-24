import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Laptop, Loader2, Shield, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatZonedDateTime, normalizeTimeZone } from "@/lib/platformDateTime";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
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

type SessionDevice = {
  userAgent: string;
  ipPrefix: string;
};

type SessionRow = {
  sid: string;
  isCurrent: boolean;
  expire: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
  device: SessionDevice | null;
};

type SessionsResponse = {
  currentSid: string | null;
  sessions: SessionRow[];
};

function truncate(s: string, max: number): string {
  const t = String(s || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}...`;
}

export function SessionsManagerDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { open, onOpenChange } = props;
  const { user, isAuthenticated } = useAuth();
  const userId = user?.id || null;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { settings: platformSettings } = usePlatformSettings();

  const platformDateFormat = platformSettings.date_format;
  const tz = useMemo(() => normalizeTimeZone(platformSettings.timezone_default || "UTC"), [platformSettings.timezone_default]);

  const sessionsQuery = useQuery<SessionsResponse>({
    queryKey: ["/api/users", userId, "sessions"],
    queryFn: async () => {
      const res = await fetch(`/api/users/${userId}/sessions`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.text()) || res.statusText);
      return res.json();
    },
    enabled: !!userId && isAuthenticated && open,
  });

  const sessions = sessionsQuery.data?.sessions || [];

  const summary = useMemo(() => {
    const total = sessions.length;
    const current = sessions.filter((s) => s.isCurrent).length;
    return { total, current, others: Math.max(0, total - current) };
  }, [sessions]);

  const [revokeTarget, setRevokeTarget] = useState<SessionRow | null>(null);

  const revokeSession = useMutation({
    mutationFn: async (sid: string) => {
      const res = await fetch(`/api/users/${userId}/sessions/${encodeURIComponent(sid)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.text()) || res.statusText);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "sessions"] });
      toast({ title: "Sesión cerrada", description: "Se revocó la sesión seleccionada." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message || "No se pudo revocar la sesión.", variant: "destructive" });
    },
  });

  const revokeOthers = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/users/${userId}/sessions/revoke-others`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.text()) || res.statusText);
      return res.json() as Promise<{ success: boolean; count: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "sessions"] });
      toast({ title: "Listo", description: `Se cerraron ${data.count} sesiones.` });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message || "No se pudieron cerrar otras sesiones.", variant: "destructive" });
    },
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-4">
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Sesiones y dispositivos
            </DialogTitle>
            <DialogDescription>
              Administra dónde tu cuenta está conectada. Total: {summary.total} · Este dispositivo: {summary.current} · Otros: {summary.others}
            </DialogDescription>
          </DialogHeader>

          <Separator />

          <ScrollArea className="max-h-[70vh]">
            <div className="p-6 space-y-4">
              {!isAuthenticated && (
                <div className="text-sm text-muted-foreground">
                  Inicia sesión para ver y administrar sesiones.
                </div>
              )}

              {isAuthenticated && sessionsQuery.isLoading && (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}

              {isAuthenticated && !sessionsQuery.isLoading && sessions.length === 0 && (
                <div className="text-sm text-muted-foreground">
                  No hay sesiones activas para mostrar.
                </div>
              )}

              {isAuthenticated && sessions.length > 0 && (
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => revokeOthers.mutate()}
                    disabled={revokeOthers.isPending || summary.others === 0}
                    data-testid="button-revoke-others"
                  >
                    {revokeOthers.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Trash2 className="h-4 w-4 mr-2" />
                    )}
                    Cerrar otras sesiones
                  </Button>
                </div>
              )}

              {isAuthenticated &&
                sessions.map((s) => {
                  const lastSeenText = s.lastSeenAt
                    ? formatZonedDateTime(s.lastSeenAt, { timeZone: tz, dateFormat: platformDateFormat, includeSeconds: false })
                    : null;
                  const createdText = formatZonedDateTime(s.createdAt, { timeZone: tz, dateFormat: platformDateFormat, includeSeconds: false });
                  const expiresText = formatZonedDateTime(s.expire, { timeZone: tz, dateFormat: platformDateFormat, includeSeconds: false });

                  const ua = s.device?.userAgent ? truncate(s.device.userAgent, 120) : "Navegador desconocido";
                  const ip = s.device?.ipPrefix ? `IP: ${s.device.ipPrefix}` : null;

                  return (
                    <div key={s.sid} className="rounded-lg border bg-card p-4 space-y-2" data-testid={`session-${s.sid}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Laptop className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium truncate">{ua}</span>
                            <span
                              className={cn(
                                "text-[11px] px-2 py-0.5 rounded-full border",
                                s.isCurrent ? "bg-primary/10 text-primary border-primary/20" : "bg-muted text-muted-foreground",
                              )}
                            >
                              {s.isCurrent ? "Este dispositivo" : "Otro dispositivo"}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span>Creada: {createdText}</span>
                            {lastSeenText && <span>Última actividad: {lastSeenText}</span>}
                            <span>Expira: {expiresText}</span>
                            {ip && <span>{ip}</span>}
                          </div>
                        </div>

                        <div className="shrink-0 flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-500 border-red-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                            onClick={() => setRevokeTarget(s)}
                            disabled={revokeSession.isPending || s.isCurrent}
                            data-testid={`button-revoke-session-${s.sid}`}
                          >
                            Cerrar sesión
                          </Button>
                        </div>
                      </div>

                      {s.isCurrent && summary.others > 0 && (
                        <div className="text-xs text-muted-foreground flex items-start gap-2 pt-2">
                          <AlertCircle className="h-4 w-4 mt-0.5" />
                          <div>
                            Para cerrar todas las demás sesiones, usa <span className="font-medium">Cerrar otras sesiones</span>.
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cerrar sesión en este dispositivo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción cerrará la sesión seleccionada. Puedes volver a iniciar sesión cuando quieras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokeSession.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!revokeTarget) return;
                revokeSession.mutate(revokeTarget.sid);
                setRevokeTarget(null);
              }}
              className="bg-red-500 hover:bg-red-600"
              disabled={revokeSession.isPending}
            >
              Cerrar sesión
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

