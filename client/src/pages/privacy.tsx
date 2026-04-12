import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  Shield,
  Eye,
  Download,
  Trash2,
  History,
  FileText,
  Loader2,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Archive,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/apiClient";
import { useToast } from "@/hooks/use-toast";
import { saveAs } from "file-saver";
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

export default function PrivacyPage() {
  const [, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [showClearHistoryConfirm, setShowClearHistoryConfirm] = useState(false);
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);

  // ── Fetch privacy settings via dedicated router ──
  const { data: privacyData, isLoading: isLoadingPrivacy } = useQuery<{
    privacySettings: {
      trainingOptIn: boolean;
      remoteBrowserDataAccess: boolean;
      analyticsTracking: boolean;
      chatHistoryEnabled: boolean;
    };
    consentHistory?: any[];
  }>({
    queryKey: ["/api/settings/privacy"],
    queryFn: async () => {
      const res = await apiFetch("/api/settings/privacy");
      if (!res.ok) throw new Error("Failed to fetch privacy settings");
      return res.json();
    },
    enabled: !!userId,
  });

  const privacySettings = useMemo(() => {
    return (
      privacyData?.privacySettings || {
        trainingOptIn: false,
        remoteBrowserDataAccess: false,
        analyticsTracking: true,
        chatHistoryEnabled: true,
      }
    );
  }, [privacyData?.privacySettings]);

  // ── Update privacy toggle ──
  const updatePrivacy = useMutation({
    mutationFn: async (data: Partial<typeof privacySettings>) => {
      const res = await apiFetch("/api/settings/privacy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update privacy settings");
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/privacy"] });
      // Also invalidate old endpoint cache in case other components use it
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "privacy"] });

      const labels: Record<string, string> = {
        trainingOptIn: "Compartir datos de uso",
        analyticsTracking: "Seguimiento de análisis",
        chatHistoryEnabled: "Historial de chat",
        remoteBrowserDataAccess: "Acceso a datos del navegador",
      };
      const key = Object.keys(variables)[0];
      const value = Object.values(variables)[0];
      toast({
        title: "Preferencia actualizada",
        description: `${labels[key] || key}: ${value ? "activado" : "desactivado"}`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo actualizar la configuración. Intenta de nuevo.",
        variant: "destructive",
      });
    },
  });

  // ── Clear chat history ──
  const clearHistory = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/settings/clear-history", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to delete chats");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/chats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId, "chats"] });
      toast({
        title: "Historial eliminado correctamente",
        description: `Se eliminaron ${data.count ?? 0} conversaciones permanentemente.`,
      });
      setShowClearHistoryConfirm(false);
      window.dispatchEvent(new CustomEvent("refresh-chats"));
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo borrar el historial. Intenta de nuevo.",
        variant: "destructive",
      });
    },
  });

  // ── Delete account ──
  const deleteAccount = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/settings/delete-account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "DELETE_MY_ACCOUNT" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data?.error || "Failed to delete account");
        (err as any).status = res.status;
        throw err;
      }
      return data;
    },
    onSuccess: async () => {
      toast({
        title: "Cuenta eliminada",
        description: "Tu cuenta ha sido eliminada. Redirigiendo...",
      });
      setShowDeleteAccountConfirm(false);
      setDeleteConfirmText("");
      await logout();
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err?.message || "No se pudo eliminar la cuenta.",
        variant: "destructive",
      });
    },
  });

  // ── Download data as ZIP ──
  const handleDownloadData = async () => {
    setIsDownloading(true);
    try {
      toast({
        title: "Preparando tus datos...",
        description: "Generando archivo ZIP con toda tu información.",
      });

      const res = await apiFetch("/api/settings/export-data");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const blob = await res.blob();
      const contentDisposition = res.headers.get("Content-Disposition") || "";
      const match = contentDisposition.match(/filename="([^"]+)"/i);
      const filename = match?.[1] || `iliagpt-export-${new Date().toISOString().slice(0, 10)}.zip`;
      saveAs(blob, filename);

      toast({
        title: "Descarga completada",
        description: "Tu archivo ZIP con todos tus datos fue descargado correctamente.",
      });
    } catch (error) {
      console.error("Download export failed:", error);
      toast({
        title: "Error en la exportación",
        description: "No se pudo generar la exportación. Intenta de nuevo más tarde.",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCloseDeleteDialog = (open: boolean) => {
    setShowDeleteAccountConfirm(open);
    if (!open) setDeleteConfirmText("");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/")}
            data-testid="button-back-privacy"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-semibold">Privacidad y datos</h1>
            <p className="text-xs text-muted-foreground">
              Gestiona cómo se usan y almacenan tus datos personales
            </p>
          </div>
          <Shield className="h-5 w-5 text-muted-foreground" />
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="space-y-8">
          {/* ─── CONTROL DE DATOS ─── */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Control de datos
              </h2>
            </div>
            <div className="rounded-lg border divide-y">
              <ToggleRow
                icon={<Shield className="h-5 w-5 text-muted-foreground" />}
                title="Compartir datos de uso"
                description="Permite compartir datos anónimos de uso para mejorar la calidad del servicio. No incluye el contenido de tus conversaciones ni datos personales identificables."
                checked={privacySettings.trainingOptIn}
                onCheckedChange={(checked) => updatePrivacy.mutate({ trainingOptIn: checked })}
                disabled={!userId || isLoadingPrivacy || updatePrivacy.isPending}
                testId="switch-share-data"
              />
              <ToggleRow
                icon={<Eye className="h-5 w-5 text-muted-foreground" />}
                title="Seguimiento de análisis"
                description="Recopila estadísticas anónimas sobre patrones de uso de la aplicación para optimizar el rendimiento y la experiencia. Sin acceso a contenido de conversaciones."
                checked={privacySettings.analyticsTracking}
                onCheckedChange={(checked) => updatePrivacy.mutate({ analyticsTracking: checked })}
                disabled={!userId || isLoadingPrivacy || updatePrivacy.isPending}
                testId="switch-analytics"
              />
            </div>
          </section>

          <Separator />

          {/* ─── HISTORIAL ─── */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Historial de conversaciones
              </h2>
            </div>
            <div className="rounded-lg border divide-y">
              <ToggleRow
                icon={<History className="h-5 w-5 text-muted-foreground" />}
                title="Guardar historial de chat"
                description="Cuando está desactivado, las nuevas conversaciones no se guardarán en tu historial. Las conversaciones existentes no se eliminan automáticamente."
                checked={privacySettings.chatHistoryEnabled}
                onCheckedChange={(checked) => updatePrivacy.mutate({ chatHistoryEnabled: checked })}
                disabled={!userId || isLoadingPrivacy || updatePrivacy.isPending}
                testId="switch-save-history"
                badge={
                  privacySettings.chatHistoryEnabled ? (
                    <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 rounded-full px-2 py-0.5">
                      <CheckCircle2 className="h-3 w-3" /> Activo
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-full px-2 py-0.5">
                      Pausado
                    </span>
                  )
                }
              />
              <div className="flex items-center justify-between p-4 gap-4">
                <div className="flex items-start gap-4 min-w-0">
                  <Trash2 className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium">Borrar todo el historial</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Elimina permanentemente todas tus conversaciones, mensajes y
                      enlaces compartidos. Esta acción es irreversible.
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!userId || clearHistory.isPending}
                  onClick={() => setShowClearHistoryConfirm(true)}
                  className="shrink-0 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                  data-testid="button-clear-history"
                >
                  {clearHistory.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      Borrando...
                    </>
                  ) : (
                    "Borrar todo"
                  )}
                </Button>
              </div>
            </div>
          </section>

          <Separator />

          {/* ─── TUS DATOS ─── */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Archive className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Tus datos
              </h2>
            </div>
            <div className="rounded-lg border divide-y">
              <div className="flex items-center justify-between p-4 gap-4">
                <div className="flex items-start gap-4 min-w-0">
                  <Download className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium">Descargar mis datos</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Exporta toda tu información en un archivo ZIP que incluye:
                      perfil, conversaciones, mensajes, documentos, memorias,
                      configuración y estadísticas de uso. Cumplimiento GDPR/RGPD.
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {["profile.json", "chats.json", "messages.json", "documents.json", "memories.json", "usage.json", "settings.json"].map((f) => (
                        <span key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!userId || isDownloading}
                  onClick={handleDownloadData}
                  className="shrink-0"
                  data-testid="button-download-data"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      Preparando...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-1" />
                      ZIP
                    </>
                  )}
                </Button>
              </div>
              <div className="flex items-center justify-between p-4 gap-4">
                <div className="flex items-start gap-4 min-w-0">
                  <FileText className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium">Política de privacidad</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Consulta los términos completos sobre cómo protegemos y
                      tratamos tu información personal.
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="button-privacy-policy"
                  className="shrink-0"
                  onClick={() => window.open("/privacy-policy", "_blank")}
                >
                  Ver
                  <ExternalLink className="h-3 w-3 ml-1" />
                </Button>
              </div>
            </div>
          </section>

          <Separator />

          {/* ─── ZONA DE PELIGRO ─── */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <h2 className="text-sm font-medium text-red-500 uppercase tracking-wide">
                Zona de peligro
              </h2>
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50/50 dark:bg-red-950/20 dark:border-red-900/50 p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-start gap-4 min-w-0">
                  <Trash2 className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-red-600 dark:text-red-400">
                      Eliminar cuenta permanentemente
                    </p>
                    <p className="text-sm text-red-500/80 dark:text-red-400/60 mt-0.5">
                      Se eliminarán todos tus datos: conversaciones, documentos,
                      memorias, configuración y sesiones activas. Los datos se
                      eliminan completamente en un plazo de 30 días.
                    </p>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={!userId || deleteAccount.isPending}
                  onClick={() => setShowDeleteAccountConfirm(true)}
                  className="shrink-0"
                  data-testid="button-delete-account"
                >
                  {deleteAccount.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Eliminar"
                  )}
                </Button>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* ─── MODAL: BORRAR HISTORIAL ─── */}
      <AlertDialog
        open={showClearHistoryConfirm}
        onOpenChange={setShowClearHistoryConfirm}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-red-500" />
              Borrar historial completo
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                ¿Estás seguro? Esta acción eliminará{" "}
                <strong>TODAS</strong> tus conversaciones y mensajes.
                No se puede deshacer.
              </span>
              <span className="block text-xs text-muted-foreground">
                Los enlaces compartidos de tus chats también serán revocados.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearHistory.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => clearHistory.mutate()}
              disabled={clearHistory.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {clearHistory.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  Eliminando...
                </>
              ) : (
                "Sí, borrar todo"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── MODAL: ELIMINAR CUENTA (doble confirmación) ─── */}
      <AlertDialog
        open={showDeleteAccountConfirm}
        onOpenChange={handleCloseDeleteDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              ¿Eliminar tu cuenta?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Esta acción es <strong>permanente e irreversible</strong>.
                  Se eliminarán todos tus datos:
                </p>
                <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
                  <li>Todas tus conversaciones y mensajes</li>
                  <li>Documentos y archivos generados</li>
                  <li>Configuración y preferencias</li>
                  <li>Memorias y datos de perfil</li>
                  <li>Todas las sesiones activas</li>
                  <li>Claves API e integraciones</li>
                </ul>
                <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3 mt-2">
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    Te recomendamos exportar tus datos antes de eliminar tu cuenta.
                  </p>
                </div>
                <div className="pt-2">
                  <label
                    htmlFor="delete-confirm-input"
                    className="text-sm font-medium text-foreground"
                  >
                    Escribe{" "}
                    <strong className="text-red-600 dark:text-red-400 font-mono">
                      ELIMINAR
                    </strong>{" "}
                    para confirmar:
                  </label>
                  <Input
                    id="delete-confirm-input"
                    className="mt-2 font-mono"
                    placeholder="ELIMINAR"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    disabled={deleteAccount.isPending}
                    autoComplete="off"
                    data-testid="input-delete-confirm"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteAccount.isPending}>
              Cancelar
            </AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deleteConfirmText !== "ELIMINAR" || deleteAccount.isPending}
              onClick={() => deleteAccount.mutate()}
              data-testid="button-confirm-delete-account"
            >
              {deleteAccount.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  Eliminando cuenta...
                </>
              ) : (
                "Eliminar mi cuenta permanentemente"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Reusable toggle row component ──
function ToggleRow({
  icon,
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
  testId,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled: boolean;
  testId: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between p-4 gap-4">
      <div className="flex items-start gap-4 min-w-0">
        <div className="mt-0.5 shrink-0">{icon}</div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium">{title}</p>
            {badge}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        data-testid={testId}
      />
    </div>
  );
}
