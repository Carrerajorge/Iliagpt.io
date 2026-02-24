import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/apiClient";
import { Loader2, ArrowLeft, CheckCircle2, XCircle, ShieldCheck, ShieldX, AlertCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

type LoginApproval = {
  id: string;
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  metadata: Record<string, unknown>;
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export default function LoginApprovePage() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();

  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const approvalId = params.get("approvalId");
  const action = params.get("action"); // approve | deny

  const [approval, setApproval] = useState<LoginApproval | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchApproval = async () => {
    if (!approvalId) return;
    setIsFetching(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/auth/mfa/approval/${approvalId}`);
      if (res.status === 401) {
        setError("Necesitas iniciar sesión para aprobar este inicio de sesión.");
        setApproval(null);
        return;
      }
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "No se pudo cargar la solicitud.");
      }
      const data = await res.json() as LoginApproval;
      setApproval(data);
    } catch (e: any) {
      setError(e?.message || "Error inesperado");
    } finally {
      setIsFetching(false);
    }
  };

  const respond = async (decision: "approved" | "denied") => {
    if (!approvalId) return;
    setIsResponding(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/auth/mfa/approval/${approvalId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data as any)?.message || (await res.text().catch(() => "")) || "No se pudo responder.";
        throw new Error(msg);
      }
      setNotice(decision === "approved" ? "Aprobado. Ya puedes continuar en tu otro dispositivo." : "Rechazado.");
      await fetchApproval();
    } catch (e: any) {
      setError(e?.message || "Error inesperado");
    } finally {
      setIsResponding(false);
    }
  };

  useEffect(() => {
    fetchApproval();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvalId]);

  // Auto-action when opened from a notification action button.
  useEffect(() => {
    if (!approvalId) return;
    if (!isAuthenticated) return;
    if (action !== "approve" && action !== "deny") return;
    if (approval?.status && approval.status !== "pending") return;
    // Avoid double-fire if user clicks buttons quickly.
    if (isResponding) return;

    respond(action === "approve" ? "approved" : "denied");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvalId, action, isAuthenticated]);

  const status = approval?.status ?? null;
  const meta = approval?.metadata || {};
  const ip = typeof meta.ip === "string" ? meta.ip : null;
  const userAgent = typeof meta.userAgent === "string" ? meta.userAgent : null;
  const requestedAt = typeof meta.requestedAt === "string" ? meta.requestedAt : null;

  const StatusIcon = status === "approved"
    ? CheckCircle2
    : status === "denied"
      ? XCircle
      : status === "expired"
        ? ShieldX
        : AlertCircle;

  const statusLabel =
    status === "approved" ? "Aprobado" :
    status === "denied" ? "Rechazado" :
    status === "expired" ? "Expirado" :
    status === "pending" ? "Pendiente" :
    "—";

  return (
    <div className="min-h-screen paper-grid flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-border bg-card p-8 shadow-sm">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2"
              onClick={() => setLocation("/")}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Volver
            </Button>

            <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="h-4 w-4" />
              ILIAGPT
            </div>
          </div>

          <div className="text-center mt-4">
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
              Aprobar inicio de sesión
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              Confirma si fuiste tú quien intentó iniciar sesión.
            </p>
          </div>

          {!approvalId && (
            <div className="mt-6 bg-muted/30 border border-border rounded-xl p-4 text-center">
              <p className="text-sm text-muted-foreground">
                Falta `approvalId` en el enlace.
              </p>
              <Button className="mt-3" variant="outline" onClick={() => setLocation("/login")}>
                Ir a iniciar sesión
              </Button>
            </div>
          )}

          {approvalId && (isLoading || isFetching) && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {approvalId && !isLoading && !isFetching && (
            <div className="mt-6 space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
                  <p className="text-sm text-red-700">{error}</p>
                  {!isAuthenticated && (
                    <Button className="mt-3" onClick={() => setLocation("/login")}>
                      Iniciar sesión
                    </Button>
                  )}
                </div>
              )}

              {notice && (
                <div className="bg-muted/30 border border-border rounded-xl p-3 text-center">
                  <p className="text-sm text-foreground">{notice}</p>
                </div>
              )}

              {approval && (
                <div className="border border-border rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <StatusIcon className="h-5 w-5 text-muted-foreground" />
                    <span className="text-sm font-semibold">{statusLabel}</span>
                  </div>

                  <div className="text-sm text-muted-foreground space-y-1">
                    <div>
                      <span className="font-medium text-foreground/90">Cuándo:</span>{" "}
                      <span>{formatDate(requestedAt || approval.createdAt)}</span>
                    </div>
                    <div>
                      <span className="font-medium text-foreground/90">Desde:</span>{" "}
                      <span>{ip || "IP desconocida"}</span>
                    </div>
                    <div className="break-words">
                      <span className="font-medium text-foreground/90">Navegador:</span>{" "}
                      <span>{userAgent || "—"}</span>
                    </div>
                  </div>
                </div>
              )}

              {approval && approval.status === "pending" && isAuthenticated && (
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    onClick={() => respond("approved")}
                    disabled={isResponding}
                  >
                    {isResponding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Aprobar"}
                  </Button>
                  <Button
                    className="flex-1"
                    variant="outline"
                    onClick={() => respond("denied")}
                    disabled={isResponding}
                  >
                    Rechazar
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

