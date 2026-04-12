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

  const { data: privacyData, isLoading: isLoadingPrivacy } = useQuery<{
    privacySettings: {
      trainingOptIn: boolean;
      remoteBrowserDataAccess: boolean;
      analyticsTracking: boolean;
      chatHistoryEnabled: boolean;
    };
  }>({
    queryKey: ["/api/users", userId, "privacy"],
    queryFn: async () => {
      const res = await apiFetch(`/api/users/${userId}/privacy`);
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

  const updatePrivacy = useMutation({
    mutationFn: async (data: Partial<typeof privacySettings>) => {
      const res = await apiFetch(`/api/users/${userId}/privacy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update privacy settings");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/users", userId, "privacy"],
      });
      toast({
        title: "Preferencia actualizada",
        description: "Tu configuración de privacidad se guardó correctamente.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo actualizar la configuración.",
        variant: "destructive",
      });
    },
  });

  const clearHistory = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/api/users/${userId}/chats/delete-all`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to delete chats");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/chats"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/users", userId, "chats", "deleted"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/users", userId, "chats", "archived"],
      });
      toast({
        title: "Historial eliminado correctamente",
        description: `Se eliminaron ${data.count ?? 0} conversaciones. Esta acción no se puede deshacer.`,
      });
      setShowClearHistoryConfirm(false);
      window.dispatchEvent(new CustomEvent("refresh-chats"));
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo borrar el historial.",
        variant: "destructive",
      });
    },
  });

  const deleteAccount = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/api/user/account`, {
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
        description:
          "Tu cuenta ha sido eliminada. Serás redirigido al inicio.",
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

  const handleDownloadData = async () => {
    setIsDownloading(true);
    try {
      const res = await apiFetch(`/api/user/export`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const blob = await res.blob();
      const contentDisposition =
        res.headers.get("Content-Disposition") || "";
      const match = contentDisposition.match(/filename="([^"]+)"/i);
      const filename =
        match?.[1] || `iliagpt-export-${Date.now()}.json`;
      saveAs(blob, filename);
      toast({
        title: "Descarga lista",
        description:
          "Tu exportación de datos fue generada y descargada correctamente.",
      });
    } catch (error) {
      console.error("Download export failed:", error);
      toast({
        title: "Error",
        description: "No se pudo descargar tu información. Intenta de nuevo.",
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
          <div>
            <h1 className="text-xl font-semibold">Privacidad y datos</h1>
            <p className="text-xs text-muted-foreground">
              Gestiona cómo se usan y almacenan tus datos
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="space-y-8">
          {/* ─── CONTROL DE DATOS ─── */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Control de datos
              </h2>
            </div>
            <div className="rounded-lg border divide-y">
              <div className="flex items-center justify-between p-4 gap-4">
                <div className="flex items-start gap-4 min-w-0">
                  <Shield className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium">Compartir datos de uso</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Permite compartir datos anónimos de uso para mejorar la
                      calidad del servicio. No incluye el contenido de tus
                      conversaciones.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={privacySettings.trainingOptIn}
                  onCheckedChange={(checked) =>
                    updatePrivacy.mutate({ trainingOptIn: checked })
                  }
                  disabled={
                    !userId || isLoadingPrivacy || updatePrivacy.isPending
                  }
                  data-testid="switch-share-data"
                />
              </div>
              <div className="flex items-center justify-between p-4 gap-4">
                <div className="flex items-start gap-4 min-w-0">
                  <Eye className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium">Seguimiento de análisis</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Recopila estadísticas anónimas sobre cómo usas la
                      aplicación para optimizar la experiencia. Puedes
                      desactivarlo en cualquier momento.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={privacySettings.analyticsTracking}
                  onCheckedChange={(checked) =>
                    updatePrivacy.mutate({ analyticsTracking: checked })
                  }
                  disabled={
                    !userId || isLoadingPrivacy || updatePrivacy.isPending
                  }
                  data-testid="switch-analytics"
                />
              </div>
            </div>
          </section>

          <Separator />

          {/* ─── HISTORIAL ─── */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Historial
              </h2>
            </div>
            <div className="rounded-lg border divide-y">
              <div className="flex items-center justify-between p-4 gap-4">
                <div className="flex items-start gap-4 min-w-0">
                  <History className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium">Guardar historial de chat</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Cuando está desactivado, las nuevas conversaciones no se
                      guardarán en tu historial. Las conversaciones existentes
                      no se verán afectadas.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={privacySettings.chatHistoryEnabled}
                  onCheckedChange={(checked) =>
                    updatePrivacy.mutate({ chatHistoryEnabled: checked })
                  }
                  disabled={
                    !userId || isLoadingPrivacy || updatePrivacy.isPending
                  }
                  data-testid="switch-save-history"
                />
              </div>
              <div className="flex items-center justify-between p-4 gap-4">
                <div className="flex items-start gap-4 min-w-0">
                  <Trash2 className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium">Borrar historial</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Elimina permanentemente todas tus conversaciones y
                      mensajes. Esta acción no se puede deshacer.
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
              <Download className="h-4 w-4 text-muted-foreground" />
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
                      Exporta toda tu información en formato JSON: perfil,
                      conversaciones, mensajes, configuración y estadísticas de
                      uso. Cumplimiento GDPR.
                    </p>
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
                    "Descargar"
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

          {/* ─── ELIMINAR CUENTA ─── */}
          <section className="rounded-lg border border-red-200 bg-red-50/50 dark:bg-red-950/20 dark:border-red-900/50 p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-start gap-4 min-w-0">
                <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium text-red-600 dark:text-red-400">
                    Eliminar cuenta
                  </p>
                  <p className="text-sm text-red-500/80 dark:text-red-400/60 mt-0.5">
                    Se eliminarán permanentemente todos tus datos, incluyendo
                    conversaciones, documentos y configuración. Esta acción es
                    irreversible.
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
                Eliminar
              </Button>
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
                <strong>TODAS</strong> tus conversaciones y mensajes. No se
                puede deshacer.
              </span>
              <span className="block text-xs text-muted-foreground">
                Los datos eliminados no podrán ser recuperados.
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
                "Borrar todo"
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
              ¿Estás seguro que deseas eliminar tu cuenta?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Esta acción es <strong>permanente e irreversible</strong>.
                  Se eliminarán:
                </p>
                <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
                  <li>Todas tus conversaciones y mensajes</li>
                  <li>Tus documentos y archivos generados</li>
                  <li>Tu configuración y preferencias</li>
                  <li>Tus memorias y datos de perfil</li>
                  <li>Todas las sesiones activas</li>
                </ul>
                <div className="pt-2">
                  <label
                    htmlFor="delete-confirm-input"
                    className="text-sm font-medium text-foreground"
                  >
                    Escribe <strong className="text-red-600 dark:text-red-400">ELIMINAR</strong> para confirmar:
                  </label>
                  <Input
                    id="delete-confirm-input"
                    className="mt-2"
                    placeholder="Escribe ELIMINAR"
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
              disabled={
                deleteConfirmText !== "ELIMINAR" || deleteAccount.isPending
              }
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
