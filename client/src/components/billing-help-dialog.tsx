import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/apiClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Mail } from "lucide-react";

export function BillingHelpDialog({
  open,
  onOpenChange,
  action,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action?: string;
}) {
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMessage("");
  }, [open, action]);

  const canSend = useMemo(() => {
    return !sending && message.trim().length >= 5 && message.trim().length <= 2000;
  }, [sending, message]);

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const res = await apiFetch("/api/billing/contact-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          action: action || "workspace_billing",
          source: "workspace_settings",
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const retryAfter =
          typeof data?.retryAfterSeconds === "number" ? ` (reintenta en ${data.retryAfterSeconds}s)` : "";
        throw new Error((data?.message || data?.error || "No se pudo enviar la solicitud") + retryAfter);
      }

      toast({
        title: "Solicitud enviada",
        description: "El administrador recibirá tu mensaje por correo.",
      });
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message || "No se pudo enviar la solicitud al administrador.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <VisuallyHidden>Contactar administrador</VisuallyHidden>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-medium flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Contactar administrador
            </h2>
            {sending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <p className="text-sm text-muted-foreground">
            Envía una solicitud al administrador del espacio de trabajo. Este mensaje se envía al correo configurado en{" "}
            <span className="font-mono">ADMIN_EMAIL</span>.
          </p>
        </div>

        <Separator />

        <div className="space-y-2">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Escribe tu solicitud (por ejemplo: necesito cambiar de plan / agregar créditos / ver facturas)..."
            maxLength={2000}
            className="min-h-[140px]"
            data-testid="textarea-billing-contact-admin"
            disabled={sending}
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Acción: {action || "workspace_billing"}</span>
            <span>{message.trim().length}/2000</span>
          </div>
        </div>

        <Separator />

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancelar
          </Button>
          <Button type="button" onClick={send} disabled={!canSend} data-testid="button-billing-contact-admin-send">
            {sending ? "Enviando..." : "Enviar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

