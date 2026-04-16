import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { apiFetch } from "@/lib/apiClient";
import { useToast } from "@/hooks/use-toast";
import { Copy, Loader2, Mail } from "lucide-react";

type CreditAlertsSettings = {
  enabled: boolean;
  thresholdPercent: number;
  recipientEmail: string;
  canManage: boolean;
};

export function CreditAlertsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [settings, setSettings] = useState<CreditAlertsSettings | null>(null);

  const canInteract = useMemo(
    () => !!settings && settings.canManage && !loading && !saving && !sendingTest,
    [settings, loading, saving, sendingTest]
  );

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await apiFetch("/api/billing/credits/alerts");
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.error || "No se pudo cargar la configuración");
        }
        if (cancelled) return;
        setSettings({
          enabled: !!data?.enabled,
          thresholdPercent: typeof data?.thresholdPercent === "number" ? data.thresholdPercent : 80,
          recipientEmail: String(data?.recipientEmail || ""),
          canManage: !!data?.canManage,
        });
      } catch (e: any) {
        if (!cancelled) {
          toast({
            title: "Error",
            description: e?.message || "No se pudo cargar la configuración de alertas.",
            variant: "destructive",
          });
          setSettings({
            enabled: false,
            thresholdPercent: 80,
            recipientEmail: "",
            canManage: false,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, toast]);

  const handleSave = async () => {
    if (!settings || !settings.canManage) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/billing/credits/alerts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: settings.enabled,
          thresholdPercent: settings.thresholdPercent,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "No se pudo guardar");
      }
      setSettings({
        enabled: !!data?.enabled,
        thresholdPercent: typeof data?.thresholdPercent === "number" ? data.thresholdPercent : settings.thresholdPercent,
        recipientEmail: String(data?.recipientEmail || settings.recipientEmail || ""),
        canManage: true,
      });
      toast({
        title: "Listo",
        description: "Alertas actualizadas.",
      });
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message || "No se pudo guardar la configuración.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSendTest = async () => {
    if (!settings?.canManage) return;
    setSendingTest(true);
    try {
      const res = await apiFetch("/api/billing/credits/alerts/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "No se pudo enviar el correo de prueba");
      }
      toast({
        title: "Correo enviado",
        description: `Enviado a ${data?.recipientEmail || settings?.recipientEmail || "tu correo"}.`,
      });
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message || "No se pudo enviar el correo de prueba.",
        variant: "destructive",
      });
    } finally {
      setSendingTest(false);
    }
  };

  const copyRecipient = async () => {
    try {
      if (!settings?.recipientEmail) return;
      await navigator.clipboard.writeText(settings.recipientEmail);
      toast({ title: "Copiado", description: "Correo copiado al portapapeles." });
    } catch {
      // ignore
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <VisuallyHidden>
          <DialogTitle>Alertas de uso de créditos</DialogTitle>
        </VisuallyHidden>
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-medium flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Alertas de uso de créditos
            </h2>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <p className="text-sm text-muted-foreground">
            Envía correos cuando el uso de créditos se acerque al límite. Las alertas se envían al administrador del espacio de trabajo.
          </p>
        </DialogHeader>

        <Separator />

        <div className="space-y-5">
          {!settings?.canManage && (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              Solo los administradores pueden configurar estas alertas.
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">Habilitar alertas</p>
              <p className="text-xs text-muted-foreground">Recomendado para evitar cortes de servicio.</p>
            </div>
            <Switch
              checked={!!settings?.enabled}
              disabled={!canInteract}
              onCheckedChange={(checked) => setSettings((s) => (s ? { ...s, enabled: !!checked } : s))}
              data-testid="switch-credit-alerts-enabled"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Umbral de alerta</Label>
              <span className="text-sm font-medium tabular-nums">{settings?.thresholdPercent ?? 80}%</span>
            </div>
            <Slider
              value={[settings?.thresholdPercent ?? 80]}
              onValueChange={(v) => setSettings((s) => (s ? { ...s, thresholdPercent: v?.[0] ?? 80 } : s))}
              min={1}
              max={100}
              step={1}
              disabled={!canInteract || !settings?.enabled}
              data-testid="slider-credit-alerts-threshold"
            />
            <p className="text-xs text-muted-foreground">
              Enviaremos una alerta cuando el uso supere este porcentaje del límite del ciclo.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Destinatario</Label>
            <div className="flex items-center gap-2">
              <Input
                value={settings?.recipientEmail || ""}
                readOnly
                className="h-9"
                placeholder="admin@ejemplo.com"
                data-testid="input-credit-alerts-recipient"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9"
                onClick={copyRecipient}
                disabled={!settings?.recipientEmail}
                data-testid="button-credit-alerts-copy-recipient"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Este correo se toma de <span className="font-mono">ADMIN_EMAIL</span> (variable de entorno).
            </p>
          </div>
        </div>

        <Separator />

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleSendTest}
            disabled={loading || saving || sendingTest || !settings?.canManage || !settings?.recipientEmail}
            data-testid="button-credit-alerts-send-test"
          >
            {sendingTest ? "Enviando..." : "Enviar prueba"}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={loading || saving || sendingTest || !settings?.canManage}
            data-testid="button-credit-alerts-save"
          >
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

