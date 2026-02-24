import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

type ScheduleType = "once" | "daily" | "weekly";

type ExistingSchedule = {
  id: string;
  name: string;
  prompt: string;
  scheduleType: ScheduleType;
  timeZone: string;
  runAt: string | null;
  timeOfDay: string | null;
  daysOfWeek: number[] | null;
  isActive: boolean;
};

type ChatOption = { id: string; title: string };

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

const WEEKDAYS: Array<{ id: number; label: string }> = [
  { id: 1, label: "Lun" },
  { id: 2, label: "Mar" },
  { id: 3, label: "Mié" },
  { id: 4, label: "Jue" },
  { id: 5, label: "Vie" },
  { id: 6, label: "Sáb" },
  { id: 0, label: "Dom" },
];

function getBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const year = d.getFullYear();
  const month = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hour = pad2(d.getHours());
  const minute = pad2(d.getMinutes());
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function ScheduleDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatId?: string | null;
  defaultPrompt?: string;
  schedule?: ExistingSchedule | null;
}) {
  const { open, onOpenChange, chatId, defaultPrompt, schedule } = props;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();

  const isEdit = !!schedule?.id;
  const browserTimeZone = useMemo(() => getBrowserTimeZone(), []);
  const timeZone = String(schedule?.timeZone || browserTimeZone || "UTC");

  const chatsQuery = useQuery<ChatOption[]>({
    queryKey: ["/api/chats", "scheduleOptions"],
    queryFn: async () => {
      const res = await fetch("/api/chats", {
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.text()) || res.statusText);
      const rows = await res.json();
      return (Array.isArray(rows) ? rows : []).map((c: any) => ({
        id: String(c.id),
        title: String(c.title || "Chat"),
      }));
    },
    enabled: open && isAuthenticated && !isEdit && !chatId,
    staleTime: 60_000,
  });

  const chatOptions = chatsQuery.data || [];
  const [chatIdDraft, setChatIdDraft] = useState<string>("");

  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [scheduleType, setScheduleType] = useState<ScheduleType>("once");
  const [runAtLocal, setRunAtLocal] = useState<string>("");
  const [timeOfDay, setTimeOfDay] = useState<string>("09:00");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]);

  useEffect(() => {
    if (!open) return;

    if (schedule) {
      setName(String(schedule.name || ""));
      setPrompt(String(schedule.prompt || ""));
      setScheduleType(schedule.scheduleType || "once");
      setRunAtLocal(schedule.runAt ? isoToDatetimeLocal(schedule.runAt) : "");
      setTimeOfDay(schedule.timeOfDay || "09:00");
      setDaysOfWeek(
        Array.isArray(schedule.daysOfWeek) && schedule.daysOfWeek.length > 0
          ? schedule.daysOfWeek
          : [1, 2, 3, 4, 5],
      );
      setChatIdDraft(chatId ? String(chatId) : "");
      return;
    }

    setName("");
    setPrompt(defaultPrompt || "");
    setScheduleType("once");
    setRunAtLocal("");
    setTimeOfDay("09:00");
    setDaysOfWeek([1, 2, 3, 4, 5]);
    setChatIdDraft(chatId ? String(chatId) : "");
  }, [open, schedule?.id, defaultPrompt, schedule]);

  useEffect(() => {
    if (!open) return;
    if (isEdit) return;
    if (chatId) return;
    if (chatIdDraft) return;
    const first = chatOptions[0]?.id;
    if (first) setChatIdDraft(first);
  }, [open, isEdit, chatId, chatIdDraft, chatOptions]);

  const effectiveChatId = String(chatId || chatIdDraft || "").trim();

  const saveSchedule = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Unauthorized");
      if (!isEdit && !effectiveChatId) throw new Error("Selecciona un chat");

      const payload: any = {
        name: name.trim() || undefined,
        prompt: prompt.trim(),
        scheduleType,
        timeZone,
        isActive: schedule?.isActive ?? true,
      };

      if (scheduleType === "once") {
        if (!runAtLocal) throw new Error("Selecciona una fecha y hora");
        const d = new Date(runAtLocal);
        if (!Number.isFinite(d.getTime())) throw new Error("Fecha/hora inválida");
        payload.runAt = d.toISOString();
      }

      if (scheduleType === "daily") {
        payload.timeOfDay = timeOfDay;
      }

      if (scheduleType === "weekly") {
        payload.timeOfDay = timeOfDay;
        payload.daysOfWeek = daysOfWeek;
      }

      const url = isEdit ? `/api/users/${user.id}/schedules/${schedule!.id}` : `/api/users/${user.id}/schedules`;
      const method = isEdit ? "PUT" : "POST";

      if (!isEdit) payload.chatId = effectiveChatId;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res));
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", user?.id, "schedules"] });
      toast({
        title: isEdit ? "Programación actualizada" : "Programación creada",
        description: isEdit ? "Se guardaron los cambios." : "Se guardó la ejecución futura.",
      });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err?.message || (isEdit ? "No se pudo actualizar la programación." : "No se pudo crear la programación."),
        variant: "destructive",
      });
    },
  });

  const canSave =
    !!isAuthenticated &&
    !!user?.id &&
    (!!effectiveChatId || isEdit) &&
    prompt.trim().length > 0 &&
    (scheduleType !== "once" || !!runAtLocal) &&
    (scheduleType !== "weekly" || daysOfWeek.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar programación" : "Programar ejecución"}</DialogTitle>
          <DialogDescription>
            ILIAGPT ejecutará esta tarea automáticamente en este chat. Zona horaria:{" "}
            <span className="font-medium">{timeZone}</span>
          </DialogDescription>
        </DialogHeader>

        {!isAuthenticated ? (
          <div className="text-sm text-muted-foreground">
            Inicia sesión para usar Programaciones.
          </div>
        ) : (
          <div className="space-y-4">
            {!isEdit && !chatId && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Chat</label>
                <Select value={chatIdDraft} onValueChange={setChatIdDraft}>
                  <SelectTrigger>
                    <SelectValue placeholder={chatsQuery.isLoading ? "Cargando chats..." : "Selecciona un chat"} />
                  </SelectTrigger>
                  <SelectContent>
                    {chatsQuery.isLoading ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Cargando...
                      </div>
                    ) : chatOptions.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        No tienes chats disponibles.
                      </div>
                    ) : (
                      chatOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.title}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {chatsQuery.isError ? (
                  <div className="text-xs text-red-600 dark:text-red-400">
                    No se pudieron cargar los chats.
                  </div>
                ) : null}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">Nombre (opcional)</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Resumen diario"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Tarea a ejecutar</label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Escribe lo que ILIAGPT debe hacer cuando se ejecute..."
                rows={5}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">Tipo</label>
                <Select value={scheduleType} onValueChange={(v) => setScheduleType(v as ScheduleType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="once">Una vez</SelectItem>
                    <SelectItem value="daily">Diario</SelectItem>
                    <SelectItem value="weekly">Semanal</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {scheduleType === "once" ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Fecha y hora</label>
                  <Input
                    type="datetime-local"
                    value={runAtLocal}
                    onChange={(e) => setRunAtLocal(e.target.value)}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Hora</label>
                  <Input
                    type="time"
                    value={timeOfDay}
                    onChange={(e) => setTimeOfDay(e.target.value)}
                  />
                </div>
              )}
            </div>

            {scheduleType === "weekly" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Días</label>
                <div className="flex flex-wrap gap-3">
                  {WEEKDAYS.map((d) => {
                    const checked = daysOfWeek.includes(d.id);
                    return (
                      <label key={d.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(next) => {
                            const on = !!next;
                            setDaysOfWeek((prev) => {
                              const set = new Set(prev);
                              if (on) set.add(d.id);
                              else set.delete(d.id);
                              return Array.from(set);
                            });
                          }}
                        />
                        {d.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saveSchedule.isPending}>
                Cancelar
              </Button>
              <Button
                onClick={() => saveSchedule.mutate()}
                disabled={!canSave || saveSchedule.isPending}
              >
                {isEdit ? "Actualizar" : "Guardar"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
