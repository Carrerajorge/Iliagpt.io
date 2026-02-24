import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Shield, Eye, Download, Trash2, Lock, History, FileText } from "lucide-react";
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

  const { data: privacyData, isLoading: isLoadingPrivacy } = useQuery<{
    privacySettings: {
      trainingOptIn: boolean;
      remoteBrowserDataAccess: boolean;
      analyticsTracking: boolean;
      chatHistoryEnabled: boolean;
    };
  }>({
    queryKey: ['/api/users', userId, 'privacy'],
    queryFn: async () => {
      const res = await apiFetch(`/api/users/${userId}/privacy`);
      if (!res.ok) throw new Error('Failed to fetch privacy settings');
      return res.json();
    },
    enabled: !!userId,
  });

  const privacySettings = useMemo(() => {
    return privacyData?.privacySettings || {
      trainingOptIn: false,
      remoteBrowserDataAccess: false,
      analyticsTracking: true,
      chatHistoryEnabled: true,
    };
  }, [privacyData?.privacySettings]);

  const updatePrivacy = useMutation({
    mutationFn: async (data: Partial<typeof privacySettings>) => {
      const res = await apiFetch(`/api/users/${userId}/privacy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update privacy settings');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'privacy'] });
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
      const res = await apiFetch(`/api/users/${userId}/chats/delete-all`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to delete chats');
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/chats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'chats', 'deleted'] });
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'chats', 'archived'] });
      toast({
        title: "Historial borrado",
        description: `Se eliminaron ${data.count ?? 0} conversaciones.`,
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
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'DELETE_MY_ACCOUNT' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data?.error || 'Failed to delete account');
        (err as any).status = res.status;
        throw err;
      }
      return data;
    },
    onSuccess: async () => {
      toast({
        title: "Cuenta eliminada",
        description: "Tu cuenta fue programada para eliminación. Cerrando sesión...",
      });
      setShowDeleteAccountConfirm(false);
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
    try {
      const res = await apiFetch(`/api/user/export`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const blob = await res.blob();
      const contentDisposition = res.headers.get('Content-Disposition') || '';
      const match = contentDisposition.match(/filename="([^"]+)"/i);
      const filename = match?.[1] || `iliagpt-export-${Date.now()}.json`;
      saveAs(blob, filename);
      toast({ title: "Descarga lista", description: "Tu exportación fue generada." });
    } catch (error) {
      console.error('Download export failed:', error);
      toast({
        title: "Error",
        description: "No se pudo descargar tu información.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => setLocation("/")}
            data-testid="button-back-privacy"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-semibold">Privacidad</h1>
        </div>
      </div>
      
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="space-y-8">
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Control de datos</h2>
            <div className="rounded-lg border divide-y">
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <Shield className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Compartir datos de uso</p>
                    <p className="text-sm text-muted-foreground">Ayuda a mejorar el servicio</p>
                  </div>
                </div>
                <Switch 
                  checked={privacySettings.trainingOptIn}
                  onCheckedChange={(checked) => updatePrivacy.mutate({ trainingOptIn: checked })}
                  disabled={!userId || isLoadingPrivacy || updatePrivacy.isPending}
                  data-testid="switch-share-data"
                />
              </div>
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <Eye className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Seguimiento de análisis</p>
                    <p className="text-sm text-muted-foreground">Estadísticas anónimas de uso</p>
                  </div>
                </div>
                <Switch 
                  checked={privacySettings.analyticsTracking}
                  onCheckedChange={(checked) => updatePrivacy.mutate({ analyticsTracking: checked })}
                  disabled={!userId || isLoadingPrivacy || updatePrivacy.isPending}
                  data-testid="switch-analytics"
                />
              </div>
            </div>
          </div>
          
          <Separator />
          
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Historial</h2>
            <div className="rounded-lg border divide-y">
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <History className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Guardar historial de chat</p>
                    <p className="text-sm text-muted-foreground">Conservar conversaciones anteriores</p>
                  </div>
                </div>
                <Switch 
                  checked={privacySettings.chatHistoryEnabled}
                  onCheckedChange={(checked) => updatePrivacy.mutate({ chatHistoryEnabled: checked })}
                  disabled={!userId || isLoadingPrivacy || updatePrivacy.isPending}
                  data-testid="switch-save-history"
                />
              </div>
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <Trash2 className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Borrar historial</p>
                    <p className="text-sm text-muted-foreground">Eliminar todas las conversaciones</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!userId || clearHistory.isPending}
                  onClick={() => setShowClearHistoryConfirm(true)}
                  data-testid="button-clear-history"
                >
                  Borrar todo
                </Button>
              </div>
            </div>
          </div>
          
          <Separator />
          
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Tus datos</h2>
            <div className="rounded-lg border divide-y">
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <Download className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Descargar mis datos</p>
                    <p className="text-sm text-muted-foreground">Exportar toda tu información</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!userId}
                  onClick={handleDownloadData}
                  data-testid="button-download-data"
                >
                  Descargar
                </Button>
              </div>
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Política de privacidad</p>
                    <p className="text-sm text-muted-foreground">Leer términos completos</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="button-privacy-policy"
                  onClick={() => setLocation("/privacy-policy")}
                >
                  Ver
                </Button>
              </div>
            </div>
          </div>
          
          <Separator />
          
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Trash2 className="h-5 w-5 text-red-500" />
                <div>
                  <p className="font-medium text-red-600 dark:text-red-400">Eliminar cuenta</p>
                  <p className="text-sm text-red-500/80">Esta acción es permanente e irreversible</p>
                </div>
              </div>
              <Button
                variant="destructive"
                size="sm"
                disabled={!userId || deleteAccount.isPending}
                onClick={() => setShowDeleteAccountConfirm(true)}
                data-testid="button-delete-account"
              >
                Eliminar
              </Button>
            </div>
          </div>
        </div>
      </div>

      <AlertDialog open={showClearHistoryConfirm} onOpenChange={setShowClearHistoryConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Borrar historial</AlertDialogTitle>
            <AlertDialogDescription>
              Esto eliminará todas tus conversaciones del historial. Tendrás un período de recuperación antes de que se eliminen permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearHistory.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => clearHistory.mutate()}
              disabled={clearHistory.isPending}
            >
              {clearHistory.isPending ? "Borrando..." : "Borrar todo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteAccountConfirm} onOpenChange={setShowDeleteAccountConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar cuenta</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción es permanente e irreversible. Se cerrará tu sesión y tu cuenta será marcada para eliminación.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteAccount.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteAccount.mutate()}
              disabled={deleteAccount.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteAccount.isPending ? "Eliminando..." : "Eliminar cuenta"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
