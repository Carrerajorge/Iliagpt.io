import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Settings,
  Bell,
  Palette,
  AppWindow,
  Calendar,
  Database,
  Shield,
  User,
  X,
  Play,
  ChevronRight,
  Plus,
  Github,
  Globe,
  Linkedin,
  Info,
  Mail,
  Box,
  Loader2,
  Check,
  Volume2,
  MessageSquare,
  FileText,
  Share2,
  Link,
  Unlink,
  Clock,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ExternalLink,
  RefreshCw
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/hooks/use-language";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { apiFetch } from "@/lib/apiClient";
import { formatZonedDate, formatZonedTime, normalizeTimeZone } from "@/lib/platformDateTime";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useModelAvailability } from "@/contexts/ModelAvailabilityContext";
import { SchedulesManagerDialog } from "@/components/schedules-manager-dialog";
import { SessionsManagerDialog } from "@/components/sessions-manager-dialog";
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
import { NotificationsControlPanels } from "@/components/settings/notifications-control-panels";

type SettingsSection = "general" | "notifications" | "personalization" | "apps" | "schedules" | "data" | "security" | "account";
type BuilderLinkKind = "website" | "linkedin" | "github";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function mapPlatformDateFormatToUserDateFormat(
  fmt: string
): "dd/mm/yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd" {
  if (fmt === "YYYY-MM-DD") return "yyyy-mm-dd";
  if (fmt === "MM/DD/YYYY") return "mm/dd/yyyy";
  return "dd/mm/yyyy";
}

function normalizeExternalUrl(candidate: string): string | null {
  const trimmed = (candidate || "").trim();
  if (!trimmed) return null;

  // Add https:// when a user pastes a bare domain like "github.com/user".
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function getUrlLabel(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

const menuItems: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "General", icon: <Settings className="h-4 w-4" /> },
  { id: "notifications", label: "Notificaciones", icon: <Bell className="h-4 w-4" /> },
  { id: "personalization", label: "Personalización", icon: <Palette className="h-4 w-4" /> },
  { id: "apps", label: "Aplicaciones", icon: <AppWindow className="h-4 w-4" /> },
  { id: "schedules", label: "Programaciones", icon: <Calendar className="h-4 w-4" /> },
  { id: "data", label: "Controles de datos", icon: <Database className="h-4 w-4" /> },
  { id: "security", label: "Seguridad", icon: <Shield className="h-4 w-4" /> },
  { id: "account", label: "Cuenta", icon: <User className="h-4 w-4" /> },
];

const voices = [
  { id: "cove", name: "Cove", description: "Voz cálida y amigable" },
  { id: "ember", name: "Ember", description: "Voz enérgica y dinámica" },
  { id: "juniper", name: "Juniper", description: "Voz clara y profesional" },
  { id: "breeze", name: "Breeze", description: "Voz suave y relajante" },
];

interface IntegrationProvider {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  authType: string;
  category: string | null;
  isActive: string;
}

interface IntegrationAccount {
  id: string;
  userId: string;
  providerId: string;
  displayName: string | null;
  email: string | null;
  status: string | null;
}

interface IntegrationPolicy {
  id: string;
  userId: string;
  enabledApps: string[];
  autoConfirmPolicy: string | null;
  sandboxMode: string | null;
  maxParallelCalls: number | null;
}

interface ToolCallLog {
  id: string;
  toolId: string;
  providerId: string;
  status: string;
  errorMessage: string | null;
  latencyMs: number | null;
  createdAt: string;
}

interface IntegrationsData {
  accounts: IntegrationAccount[];
  policy: IntegrationPolicy | null;
  providers: IntegrationProvider[];
}

const providerIcons: Record<string, React.ReactNode> = {
  github: <Github className="h-5 w-5" />,
  figma: <Box className="h-5 w-5" />,
  slack: <MessageSquare className="h-5 w-5" />,
  notion: <FileText className="h-5 w-5" />,
  google_drive: <Globe className="h-5 w-5" />,
  canva: <Palette className="h-5 w-5" />,
};

const categoryLabelsApps: Record<string, string> = {
  development: "Desarrollo",
  design: "Diseño",
  communication: "Comunicación",
  productivity: "Productividad",
  general: "General",
};

interface SharedLink {
  id: string;
  resourceType: string;
  resourceId: string;
  token: string;
  scope: string;
  permissions: string;
  expiresAt: string | null;
  lastAccessedAt: string | null;
  accessCount: number;
  isRevoked: string;
  createdAt: string;
}

interface ArchivedChat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface DeletedChat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  archived?: string | null;
}

interface ConsentLogEntry {
  id: string;
  consentType: string;
  value: string;
  consentVersion: string;
  createdAt: string;
}

interface PrivacySettings {
  trainingOptIn: boolean;
  remoteBrowserDataAccess: boolean;
  analyticsTracking: boolean;
  chatHistoryEnabled: boolean;
}

type TwoFactorStatus = {
  enabled: boolean;
  verified: boolean;
};

type TwoFactorSetup = {
  secret: string;
  qrCodeUrl: string;
  qrCodeImage: string;
  backupCodes: string[];
  message?: string;
};

function AppsSection() {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [providerIconFailed, setProviderIconFailed] = useState<Record<string, boolean>>({});
  const [maxParallelDraft, setMaxParallelDraft] = useState<string>("3");

  const {
    data: integrationsData,
    isLoading: isLoadingIntegrations,
    isError: isIntegrationsError,
    error: integrationsError,
    refetch
  } = useQuery<IntegrationsData>({
    queryKey: ['/api/users', userId, 'integrations'],
    queryFn: async () => {
      const res = await apiFetch(`/api/users/${userId}/integrations`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch integrations');
      return res.json();
    },
    enabled: !!userId,
  });

  const { data: logsData, isLoading: isLoadingLogs, isError: isLogsError } = useQuery<ToolCallLog[]>({
    queryKey: ['/api/users', userId, 'integrations', 'logs'],
    queryFn: async () => {
      const res = await apiFetch(`/api/users/${userId}/integrations/logs?limit=10`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch logs');
      return res.json();
    },
    enabled: !!userId,
  });

  const updatePolicy = useMutation({
    mutationFn: async (data: Partial<IntegrationPolicy>) => {
      const res = await apiFetch(`/api/users/${userId}/integrations/policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update policy');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'integrations'] });
      toast({ title: "Configuración actualizada", description: "Los cambios han sido guardados." });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo actualizar la configuración.", variant: "destructive" });
    },
  });

  const connectProvider = useMutation({
    mutationFn: async (providerId: string) => {
      const res = await apiFetch(`/api/users/${userId}/integrations/${providerId}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to connect');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'integrations'] });
      toast({ title: "Conexión iniciada", description: data.message || "El proceso de conexión ha sido iniciado." });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo iniciar la conexión.", variant: "destructive" });
    },
  });

  const disconnectProvider = useMutation({
    mutationFn: async (providerId: string) => {
      const res = await apiFetch(`/api/users/${userId}/integrations/${providerId}/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to disconnect');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'integrations'] });
      toast({ title: "Desconectado", description: "La integración ha sido desconectada." });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo desconectar la integración.", variant: "destructive" });
    },
  });

  const providers = integrationsData?.providers || [];
  const accounts = integrationsData?.accounts || [];
  const policy = integrationsData?.policy;
  const logs = logsData || [];

  useEffect(() => {
    setMaxParallelDraft(String(policy?.maxParallelCalls ?? 3));
  }, [policy?.maxParallelCalls]);

  const isProviderConnected = (providerId: string) => {
    return accounts.some(a => a.providerId === providerId && a.status === 'active');
  };

  const isProviderEnabled = (providerId: string) => {
    return policy?.enabledApps?.includes(providerId) ?? false;
  };

  const toggleProviderEnabled = (providerId: string, enabled: boolean) => {
    const currentEnabled = policy?.enabledApps || [];
    const newEnabled = enabled
      ? [...currentEnabled, providerId]
      : currentEnabled.filter(id => id !== providerId);
    updatePolicy.mutate({ enabledApps: newEnabled });
  };

  const groupedProviders = providers.reduce((acc, provider) => {
    const category = provider.category || 'general';
    if (!acc[category]) acc[category] = [];
    acc[category].push(provider);
    return acc;
  }, {} as Record<string, IntegrationProvider[]>);

  if (isLoadingIntegrations) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold" data-testid="text-apps-title">Aplicaciones e Integraciones</h2>
          <p className="text-sm text-muted-foreground mt-1" data-testid="text-apps-description">
            Conecta y administra las aplicaciones que ILIAGPT puede usar
          </p>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" data-testid="spinner-loading-apps" />
        </div>
      </div>
    );
  }

  if (isIntegrationsError) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold" data-testid="text-apps-title">Aplicaciones e Integraciones</h2>
          <p className="text-sm text-muted-foreground mt-1" data-testid="text-apps-description">
            Conecta y administra las aplicaciones que ILIAGPT puede usar
          </p>
        </div>
        <div className="p-4 rounded-lg border bg-card flex items-start gap-3" data-testid="card-integrations-error">
          <AlertCircle className="h-5 w-5 text-red-500 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium">No se pudieron cargar las integraciones</p>
            <p className="text-xs text-muted-foreground mt-1">
              {integrationsError instanceof Error ? integrationsError.message : "Intenta de nuevo."}
            </p>
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-integrations">
                <RefreshCw className="h-4 w-4 mr-2" />
                Reintentar
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold" data-testid="text-apps-title">Aplicaciones e Integraciones</h2>
          <p className="text-sm text-muted-foreground mt-1" data-testid="text-apps-description">
            Conecta y administra las aplicaciones que ILIAGPT puede usar
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isLoadingIntegrations}
          data-testid="button-refresh-integrations"
        >
          <RefreshCw className={cn("h-4 w-4", isLoadingIntegrations && "animate-spin")} />
        </Button>
      </div>

      {Object.entries(groupedProviders).map(([category, categoryProviders]) => (
        <div key={category} className="space-y-3" data-testid={`section-category-${category}`}>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide" data-testid={`text-category-${category}`}>
            {categoryLabelsApps[category] || category}
          </h3>

          <div className="space-y-2">
            {categoryProviders.map((provider) => {
              const connected = isProviderConnected(provider.id);
              const enabled = isProviderEnabled(provider.id);
              const account = accounts.find(a => a.providerId === provider.id);
              const inactive = String(provider.isActive || "").toLowerCase().trim() !== "true";
              const showRemoteIcon = !!provider.iconUrl && !providerIconFailed[provider.id];

              return (
                <div
                  key={provider.id}
                  className={cn(
                    "flex items-center justify-between p-4 rounded-lg border bg-card",
                    inactive && "opacity-70"
                  )}
                  data-testid={`card-provider-${provider.id}`}
                >
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden",
                      connected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    )}>
                      {showRemoteIcon ? (
                        <img
                          src={provider.iconUrl as string}
                          alt={provider.name}
                          className="h-6 w-6 object-contain"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          onError={() => setProviderIconFailed((prev) => ({ ...prev, [provider.id]: true }))}
                        />
                      ) : (
                        providerIcons[provider.id] || <AppWindow className="h-5 w-5" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium" data-testid={`text-provider-name-${provider.id}`}>
                          {provider.name}
                        </span>
                        {inactive && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                            Inactivo
                          </span>
                        )}
                        {connected && (
                          <span className="inline-flex items-center gap-1 text-xs text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="h-3 w-3" />
                            Conectado
                          </span>
                        )}
                        {connected && !enabled && (
                          <span className="inline-flex items-center gap-1 text-xs text-yellow-700 bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-300 px-2 py-0.5 rounded-full">
                            Deshabilitado
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground" data-testid={`text-provider-desc-${provider.id}`}>
                        {provider.description || 'Sin descripción'}
                      </p>
                      {connected && account?.email && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {account.displayName || account.email}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {connected && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Habilitado</span>
                        <Switch
                          checked={enabled}
                          onCheckedChange={(checked) => toggleProviderEnabled(provider.id, checked)}
                          disabled={inactive || updatePolicy.isPending}
                          data-testid={`switch-enable-${provider.id}`}
                        />
                      </div>
                    )}

                    {connected ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => disconnectProvider.mutate(provider.id)}
                        disabled={disconnectProvider.isPending}
                        className="text-red-500 border-red-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                        data-testid={`button-disconnect-${provider.id}`}
                      >
                        {disconnectProvider.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Unlink className="h-4 w-4 mr-1" />
                            Desconectar
                          </>
                        )}
                      </Button>
                    ) : (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => connectProvider.mutate(provider.id)}
                        disabled={connectProvider.isPending || inactive}
                        data-testid={`button-connect-${provider.id}`}
                      >
                        {connectProvider.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Link className="h-4 w-4 mr-1" />
                            Conectar
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {providers.length === 0 && (
        <div className="text-center py-8 text-muted-foreground" data-testid="text-no-providers">
          <AppWindow className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No hay proveedores de integración disponibles</p>
        </div>
      )}

      <Separator />

      <div className="space-y-3">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between py-3 hover:bg-muted/50 transition-colors rounded-lg px-2"
          data-testid="button-advanced-config"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
              <Settings className="h-5 w-5 text-muted-foreground" />
            </div>
            <span className="text-sm font-medium">Configuración avanzada</span>
          </div>
          <ChevronRight className={cn("h-5 w-5 text-muted-foreground transition-transform", showAdvanced && "rotate-90")} />
        </button>

        {showAdvanced && (
          <div className="space-y-4 pl-4 border-l-2 border-muted ml-5">
            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm block">Política de confirmación automática</span>
                <span className="text-xs text-muted-foreground">
                  Cuándo confirmar automáticamente las acciones de las herramientas
                </span>
              </div>
              <Select
                value={policy?.autoConfirmPolicy || 'ask'}
                onValueChange={(value) => updatePolicy.mutate({ autoConfirmPolicy: value })}
              >
                <SelectTrigger className="w-36" data-testid="select-auto-confirm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="always">Siempre</SelectItem>
                  <SelectItem value="ask">Preguntar</SelectItem>
                  <SelectItem value="never">Nunca</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm block">Modo sandbox</span>
                <span className="text-xs text-muted-foreground">
                  Ejecutar acciones en modo de prueba cuando esté disponible
                </span>
              </div>
              <Switch
                checked={policy?.sandboxMode === 'true'}
                onCheckedChange={(checked) => updatePolicy.mutate({ sandboxMode: checked ? 'true' : 'false' })}
                data-testid="switch-sandbox-mode"
              />
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm block">Llamadas paralelas máximas</span>
                <span className="text-xs text-muted-foreground">
                  Número máximo de herramientas ejecutadas simultáneamente
                </span>
              </div>
              <Input
                type="number"
                min={1}
                max={10}
                value={maxParallelDraft}
                onChange={(e) => setMaxParallelDraft(e.target.value)}
                onBlur={() => {
                  const parsed = Number.parseInt(String(maxParallelDraft || "").trim(), 10);
                  const next = Number.isFinite(parsed)
                    ? Math.min(10, Math.max(1, parsed))
                    : 3;
                  if (next !== (policy?.maxParallelCalls ?? 3)) {
                    updatePolicy.mutate({ maxParallelCalls: next });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
                className="w-20 text-center"
                disabled={updatePolicy.isPending}
                data-testid="input-max-parallel"
              />
            </div>
          </div>
        )}
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Registro de llamadas recientes
          </h3>
          {isLoadingLogs && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {isLogsError && (
          <div className="text-center py-4 text-muted-foreground" data-testid="text-logs-error">
            <AlertCircle className="h-6 w-6 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No se pudieron cargar los registros</p>
          </div>
        )}

        {!isLogsError && (
          logs.length > 0 ? (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/30 text-sm"
                  data-testid={`log-entry-${log.id}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center",
                      log.status === 'success' ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400" :
                        log.status === 'error' ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" :
                          "bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400"
                    )}>
                      {log.status === 'success' ? <CheckCircle2 className="h-3 w-3" /> :
                        log.status === 'error' ? <XCircle className="h-3 w-3" /> :
                          <Clock className="h-3 w-3" />}
                    </div>
                    <div>
                      <span className="font-medium">{log.toolId}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {log.providerId}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {log.latencyMs && <span>{log.latencyMs}ms</span>}
                    <span>{formatZonedTime(log.createdAt, { timeZone: platformTimeZone, includeSeconds: true })}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground" data-testid="text-no-logs">
              <Clock className="h-6 w-6 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No hay registros de llamadas recientes</p>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function DataControlsSection() {
  const { user, logout } = useAuth();
  const userId = user?.id;
  const isAuthed = !!userId;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);
  const platformDateFormat = platformSettings.date_format;
  const [showArchivedDialog, setShowArchivedDialog] = useState(false);
  const [showDeletedDialog, setShowDeletedDialog] = useState(false);
  const [showSharedLinksDialog, setShowSharedLinksDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false);

  const { data: privacyData, isLoading: isLoadingPrivacy } = useQuery<{
    privacySettings: PrivacySettings;
    consentHistory: ConsentLogEntry[];
  }>({
    queryKey: ['/api/users', userId, 'privacy'],
    queryFn: async () => {
      const res = await apiFetch(`/api/users/${userId}/privacy`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch privacy settings');
      return res.json();
    },
    enabled: !!userId,
  });

  const { data: sharedLinks = [], isLoading: isLoadingLinks } = useQuery<SharedLink[]>({
    queryKey: ['/api/users', userId, 'shared-links'],
    queryFn: async () => {
      const res = await apiFetch(`/api/users/${userId}/shared-links`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch shared links');
      return res.json();
    },
    enabled: !!userId,
  });

  const { data: archivedChats = [], isLoading: isLoadingArchived } = useQuery<ArchivedChat[]>({
    queryKey: ['/api/users', userId, 'chats', 'archived'],
    queryFn: async () => {
      const res = await apiFetch(`/api/users/${userId}/chats/archived`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch archived chats');
      return res.json();
    },
    enabled: !!userId,
  });

  const { data: deletedChats = [], isLoading: isLoadingDeleted } = useQuery<DeletedChat[]>({
    queryKey: ['/api/users', userId, 'chats', 'deleted'],
    queryFn: async () => {
      const res = await apiFetch(`/api/users/${userId}/chats/deleted`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch deleted chats');
      return res.json();
    },
    enabled: !!userId,
  });

  const updatePrivacy = useMutation({
    mutationFn: async (data: Partial<PrivacySettings>) => {
      if (!userId) throw new Error("Unauthorized");
      const res = await apiFetch(`/api/users/${userId}/privacy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'privacy'] });
      toast({ title: "Preferencias actualizadas", description: "Tus preferencias de privacidad han sido guardadas." });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo actualizar la configuración.", variant: "destructive" });
    },
  });

  const revokeLink = useMutation({
    mutationFn: async (linkId: string) => {
      if (!userId) throw new Error("Unauthorized");
      const res = await apiFetch(`/api/users/${userId}/shared-links/${linkId}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to revoke');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'shared-links'] });
      toast({ title: "Enlace revocado", description: "El enlace compartido ha sido revocado." });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo revocar el enlace.", variant: "destructive" });
    },
  });

  const unarchiveChat = useMutation({
    mutationFn: async (chatId: string) => {
      if (!userId) throw new Error("Unauthorized");
      const res = await apiFetch(`/api/users/${userId}/chats/${chatId}/unarchive`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to unarchive');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'chats', 'archived'] });
      queryClient.invalidateQueries({ queryKey: ['/api/chats'] });
      toast({ title: "Chat desarchivado", description: "El chat ha sido devuelto a tu lista." });
      window.dispatchEvent(new CustomEvent("refresh-chats"));
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo restaurar el chat.", variant: "destructive" });
    },
  });

  const restoreDeletedChat = useMutation({
    mutationFn: async (chatId: string) => {
      if (!userId) throw new Error("Unauthorized");
      const res = await apiFetch(`/api/users/${userId}/chats/${chatId}/restore`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to restore');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'chats', 'deleted'] });
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'chats', 'archived'] });
      queryClient.invalidateQueries({ queryKey: ['/api/chats'] });
      toast({ title: "Chat restaurado", description: "El chat ha sido restaurado." });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo restaurar el chat.", variant: "destructive" });
    },
  });

  const archiveAll = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Unauthorized");
      const res = await apiFetch(`/api/users/${userId}/chats/archive-all`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to archive all');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/chats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'chats', 'archived'] });
      toast({ title: "Chats archivados", description: `Se archivaron ${data.count} chats.` });
      setShowArchiveConfirm(false);
      window.dispatchEvent(new CustomEvent("refresh-chats"));
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudieron archivar los chats.", variant: "destructive" });
    },
  });

  const deleteAll = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Unauthorized");
      const res = await apiFetch(`/api/users/${userId}/chats/delete-all`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to delete all');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/chats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'chats', 'archived'] });
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'chats', 'deleted'] });
      queryClient.invalidateQueries({ queryKey: ['/api/users', userId, 'shared-links'] });
      toast({ title: "Chats eliminados", description: `Se eliminaron ${data.count} chats.` });
      setShowDeleteConfirm(false);
      window.dispatchEvent(new CustomEvent("refresh-chats"));
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudieron eliminar los chats.", variant: "destructive" });
    },
  });

  const downloadData = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/api/user/export`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const blob = await res.blob();
      const contentDisposition = res.headers.get('Content-Disposition') || '';
      const match = contentDisposition.match(/filename="([^"]+)"/i);
      const filename = match?.[1] || `iliagpt-export-${Date.now()}.json`;
      return { blob, filename };
    },
    onSuccess: ({ blob, filename }) => {
      saveAs(blob, filename);
      toast({ title: "Descarga lista", description: "Tu exportación fue generada." });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo descargar tu información.",
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
        throw new Error((data as any)?.error || 'Failed to delete account');
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

  const privacySettings = privacyData?.privacySettings || {
    trainingOptIn: false,
    remoteBrowserDataAccess: false,
    analyticsTracking: true,
    chatHistoryEnabled: true,
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold" data-testid="text-data-controls-title">Controles de datos</h2>

      <div className="space-y-1">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Privacidad</h3>
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between py-3 px-2 rounded-lg hover:bg-muted/50">
            <div className="flex-1 pr-4">
              <span className="text-sm block">Compartir datos de uso</span>
              <span className="text-xs text-muted-foreground">Ayuda a mejorar el servicio.</span>
            </div>
            <Switch
              checked={privacySettings.trainingOptIn}
              onCheckedChange={(checked) => updatePrivacy.mutate({ trainingOptIn: checked })}
              disabled={!isAuthed || updatePrivacy.isPending || isLoadingPrivacy}
              data-testid="switch-training-opt-in"
            />
          </div>

          <div className="flex items-center justify-between py-3 px-2 rounded-lg hover:bg-muted/50">
            <div className="flex-1 pr-4">
              <span className="text-sm block">Seguimiento de análisis</span>
              <span className="text-xs text-muted-foreground">Estadísticas anónimas de uso.</span>
            </div>
            <Switch
              checked={privacySettings.analyticsTracking}
              onCheckedChange={(checked) => updatePrivacy.mutate({ analyticsTracking: checked })}
              disabled={!userId || updatePrivacy.isPending || isLoadingPrivacy}
              data-testid="switch-analytics-tracking"
            />
          </div>

          <div className="flex items-center justify-between py-3 px-2 rounded-lg hover:bg-muted/50">
            <div className="flex-1 pr-4">
              <span className="text-sm block">Datos del navegador remoto</span>
              <span className="text-xs text-muted-foreground">
                Permite que ILIAGPT acceda a datos de sesiones de navegación remota (cookies, DOM, capturas).
              </span>
            </div>
            <Switch
              checked={privacySettings.remoteBrowserDataAccess}
              onCheckedChange={(checked) => updatePrivacy.mutate({ remoteBrowserDataAccess: checked })}
              disabled={!isAuthed || updatePrivacy.isPending || isLoadingPrivacy}
              data-testid="switch-remote-browser"
            />
          </div>
        </div>
      </div>

      <Separator />

      <div className="space-y-1">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Enlaces compartidos</h3>
        <div className="flex items-center justify-between py-3 px-2">
          <div>
            <span className="text-sm block">Administrar enlaces</span>
            <span className="text-xs text-muted-foreground">
              {sharedLinks.filter(l => l.isRevoked !== 'true').length} enlaces activos
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSharedLinksDialog(true)}
            disabled={!isAuthed}
            data-testid="button-manage-links"
          >
            Administrar
          </Button>
        </div>
      </div>

      <Separator />

      <div className="space-y-1">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Historial</h3>
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between py-3 px-2 rounded-lg hover:bg-muted/50">
            <div className="flex-1 pr-4">
              <span className="text-sm block">Guardar historial de chat</span>
              <span className="text-xs text-muted-foreground">Conservar conversaciones anteriores.</span>
            </div>
            <Switch
              checked={privacySettings.chatHistoryEnabled}
              onCheckedChange={(checked) => updatePrivacy.mutate({ chatHistoryEnabled: checked })}
              disabled={!userId || updatePrivacy.isPending || isLoadingPrivacy}
              data-testid="switch-chat-history"
            />
          </div>

          <div className="flex items-center justify-between py-3 px-2">
            <div>
              <span className="text-sm block">Chats archivados</span>
              <span className="text-xs text-muted-foreground">
                {archivedChats.length} chats archivados
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowArchivedDialog(true)}
              disabled={!isAuthed}
              data-testid="button-manage-archived"
            >
              Administrar
            </Button>
          </div>

          <div className="flex items-center justify-between py-3 px-2">
            <div>
              <span className="text-sm block">Chats eliminados</span>
              <span className="text-xs text-muted-foreground">
                {deletedChats.length} chats en la papelera
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDeletedDialog(true)}
              disabled={!isAuthed}
              data-testid="button-manage-deleted"
            >
              Administrar
            </Button>
          </div>

          <div className="flex items-center justify-between py-3 px-2">
            <span className="text-sm">Archivar todos los chats</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowArchiveConfirm(true)}
              disabled={!isAuthed || archiveAll.isPending}
              data-testid="button-archive-all"
            >
              {archiveAll.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Archivar todo"}
            </Button>
          </div>

          <div className="flex items-center justify-between py-3 px-2">
            <span className="text-sm">Borrar historial</span>
            <Button
              variant="outline"
              size="sm"
              className="text-red-500 border-red-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={!isAuthed || deleteAll.isPending}
              data-testid="button-delete-all"
            >
              {deleteAll.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Borrar todo"}
            </Button>
          </div>
        </div>
      </div>

      <Separator />

      <div className="space-y-1">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Tus datos</h3>
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between py-3 px-2">
            <div>
              <span className="text-sm block">Descargar mis datos</span>
              <span className="text-xs text-muted-foreground">Exportar toda tu información.</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadData.mutate()}
              disabled={!userId || downloadData.isPending}
              data-testid="button-download-data-settings"
            >
              {downloadData.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Descargar"}
            </Button>
          </div>

          <div className="flex items-center justify-between py-3 px-2">
            <div>
              <span className="text-sm block">Política de privacidad</span>
              <span className="text-xs text-muted-foreground">Leer términos completos.</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open("/privacy-policy", "_blank", "noopener,noreferrer")}
              data-testid="button-privacy-policy-settings"
            >
              Ver
            </Button>
          </div>

          <div className="flex items-center justify-between py-3 px-2 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900">
            <div className="flex-1 pr-4">
              <span className="text-sm block font-medium text-red-600 dark:text-red-400">Eliminar cuenta</span>
              <span className="text-xs text-red-500/80">Esta acción es permanente e irreversible.</span>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteAccountConfirm(true)}
              disabled={!userId || deleteAccount.isPending}
              data-testid="button-delete-account-settings"
            >
              {deleteAccount.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Eliminar"}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={showArchivedDialog} onOpenChange={setShowArchivedDialog}>
        <DialogContent className="max-w-md max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Chats archivados</DialogTitle>
            <VisuallyHidden>
              <DialogDescription>Lista de chats archivados</DialogDescription>
            </VisuallyHidden>
          </DialogHeader>
          <ScrollArea className="h-[400px] pr-4">
            {isLoadingArchived ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : archivedChats.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No tienes chats archivados.</p>
            ) : (
              <div className="space-y-2">
                {archivedChats.map((chat) => (
                  <div key={chat.id} className="flex items-center justify-between p-3 border rounded-lg" data-testid={`archived-chat-${chat.id}`}>
	                      <div className="flex-1 min-w-0">
	                        <p className="text-sm font-medium truncate">{chat.title}</p>
	                        <p className="text-xs text-muted-foreground">
	                          {formatZonedDate(chat.createdAt, { timeZone: platformTimeZone, dateFormat: platformDateFormat })}
	                        </p>
	                      </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => unarchiveChat.mutate(chat.id)}
                      disabled={unarchiveChat.isPending}
                      data-testid={`button-unarchive-${chat.id}`}
                    >
                      Desarchivar
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeletedDialog} onOpenChange={setShowDeletedDialog}>
        <DialogContent className="max-w-md max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Chats eliminados</DialogTitle>
            <VisuallyHidden>
              <DialogDescription>Lista de chats eliminados</DialogDescription>
            </VisuallyHidden>
          </DialogHeader>
          <ScrollArea className="h-[400px] pr-4">
            {isLoadingDeleted ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : deletedChats.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No tienes chats eliminados.</p>
            ) : (
              <div className="space-y-2">
                {deletedChats.map((chat) => {
                  const restoring = restoreDeletedChat.isPending && restoreDeletedChat.variables === chat.id;
                  return (
                    <div key={chat.id} className="flex items-center justify-between p-3 border rounded-lg" data-testid={`deleted-chat-${chat.id}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{chat.title}</p>
                        <p className="text-xs text-muted-foreground">
                          Eliminado: {chat.deletedAt ? new Date(chat.deletedAt).toLocaleDateString() : new Date(chat.updatedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => restoreDeletedChat.mutate(chat.id)}
                        disabled={restoring}
                        data-testid={`button-restore-deleted-${chat.id}`}
                      >
                        {restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : "Restaurar"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={showSharedLinksDialog} onOpenChange={setShowSharedLinksDialog}>
        <DialogContent className="max-w-lg max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Enlaces compartidos</DialogTitle>
            <VisuallyHidden>
              <DialogDescription>Gestiona tus enlaces compartidos</DialogDescription>
            </VisuallyHidden>
          </DialogHeader>
          <ScrollArea className="h-[400px] pr-4">
            {isLoadingLinks ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : sharedLinks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No tienes enlaces compartidos.</p>
            ) : (
	              <div className="space-y-2">
	                {sharedLinks.map((link) => (
	                  <div key={link.id} className={cn("p-3 border rounded-lg", link.isRevoked === 'true' && "opacity-50")} data-testid={`shared-link-${link.id}`}>
	                    <div className="flex items-center justify-between">
	                      <div className="flex-1 min-w-0">
	                        <div className="flex items-center gap-2">
	                          <Share2 className="h-4 w-4 text-muted-foreground" />
	                          <span className="text-sm font-medium capitalize">{link.resourceType}</span>
	                          <span className={cn(
	                            "text-xs px-2 py-0.5 rounded-full",
	                            link.scope === 'public' ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
	                              link.scope === 'organization' ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" :
	                                "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
	                          )}>
	                            {link.scope === 'public' ? 'Público' : link.scope === 'organization' ? 'Organización' : 'Solo con enlace'}
	                          </span>
	                        </div>
	                        <p className="text-xs text-muted-foreground mt-1">
	                          Creado: {formatZonedDate(link.createdAt, { timeZone: platformTimeZone, dateFormat: platformDateFormat })} · {link.accessCount} accesos
	                        </p>
	                      </div>
	                      {link.isRevoked !== 'true' && (
	                        <Button
	                          variant="ghost"
	                          size="sm"
                          className="text-red-500 hover:text-red-600"
                          onClick={() => revokeLink.mutate(link.id)}
                          disabled={revokeLink.isPending}
                          data-testid={`button-revoke-${link.id}`}
                        >
                          Revocar
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showArchiveConfirm} onOpenChange={setShowArchiveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Archivar todos los chats?</AlertDialogTitle>
            <AlertDialogDescription>
              Todos tus chats serán archivados. Podrás restaurarlos desde "Chats archivados".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => archiveAll.mutate()}>
              Archivar todo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar todos los chats?</AlertDialogTitle>
          <AlertDialogDescription>
              Esta acción enviará todos tus chats a la papelera. Podrás restaurarlos desde "Chats eliminados".
          </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteAll.mutate()}
              className="bg-red-500 hover:bg-red-600"
            >
              Borrar todo
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

type TrustedDevice = {
  sid: string;
  isCurrent: boolean;
  createdAt: number | null;
  lastSeenAt: number | null;
  ip: string | null;
  userAgent: string | null;
  expiresAt: string | null;
  pushApprovalsEnabled: boolean;
  hasPushSubscription: boolean;
};

type TrustedDevicesResponse = {
  currentSid: string | null;
  devices: TrustedDevice[];
};

type TwoFaStatusResponse = { enabled: boolean };

type TwoFaSetupResponse = {
  secret: string;
  qrCodeUrl: string;
  qrCodeImage: string;
  backupCodes: string[];
  message?: string;
};

function formatDeviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Dispositivo";
  const ua = userAgent;
  const isMobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  const os =
    /Windows NT/i.test(ua) ? "Windows" :
    /Mac OS X/i.test(ua) ? "macOS" :
    /Android/i.test(ua) ? "Android" :
    /iPhone|iPad/i.test(ua) ? "iOS" :
    "Sistema";

  const browser =
    /Edg\//i.test(ua) ? "Edge" :
    /Chrome\//i.test(ua) ? "Chrome" :
    /Safari\//i.test(ua) && !/Chrome\//i.test(ua) ? "Safari" :
    /Firefox\//i.test(ua) ? "Firefox" :
    "Navegador";

  return `${isMobile ? "Móvil" : "Desktop"} · ${os} · ${browser}`;
}

function formatLastSeen(ms: number | null): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

function TrustedDevicesDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data?: TrustedDevicesResponse;
  isLoading: boolean;
  onRevoke: (sid: string) => void;
  isRevoking?: boolean;
  revokingSid?: string | null;
}) {
  const devices = props.data?.devices || [];
  const currentSid = props.data?.currentSid || null;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Dispositivos de confianza</DialogTitle>
          <DialogDescription>
            Administra tus sesiones activas. Si cierras una sesión, ese dispositivo perderá acceso.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {props.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : devices.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No hay dispositivos registrados.
            </p>
          ) : (
            devices.map((d) => {
              const lastSeen = formatLastSeen(d.lastSeenAt);
              const isCurrent = d.sid === currentSid || d.isCurrent;
              return (
                <div
                  key={d.sid}
                  className="flex items-center justify-between gap-3 border rounded-lg p-3"
                  data-testid={`trusted-device-${d.sid}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {formatDeviceLabel(d.userAgent)}
                      </span>
                      {isCurrent && (
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          (Este dispositivo)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {d.ip ? <span>{d.ip}</span> : null}
                      {d.ip && lastSeen ? <span> · </span> : null}
                      {lastSeen ? <span>Última actividad: {lastSeen}</span> : <span>Última actividad: —</span>}
                    </div>
	                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
	                      <span className={cn(
	                        "inline-flex items-center gap-1",
	                        d.pushApprovalsEnabled ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
	                      )}>
	                        {d.pushApprovalsEnabled ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
	                        {d.pushApprovalsEnabled ? "Aprobaciones push: activas" : "Aprobaciones push: inactivas"}
	                      </span>
	                      <span className={cn(
	                        "inline-flex items-center gap-1",
	                        d.hasPushSubscription ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
	                      )}>
	                        {d.hasPushSubscription ? <Check className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
	                        {d.hasPushSubscription ? "Push: registrado" : "Push: sin registrar"}
	                      </span>
	                    </div>
	                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(!isCurrent && "text-red-500 border-red-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950")}
                    onClick={() => props.onRevoke(d.sid)}
                    disabled={!!props.isRevoking && props.revokingSid === d.sid}
                    data-testid={`button-revoke-device-${d.sid}`}
                  >
                    {!!props.isRevoking && props.revokingSid === d.sid ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Cerrar sesión"
                    )}
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SecuritySection(props: {
  settings: any;
  updateSetting: (key: any, value: any) => void;
  onLogout: () => void;
  onRequestLogoutAll: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();

  const [showTrustedDevices, setShowTrustedDevices] = useState(false);

  const { data: devicesData, isLoading: isLoadingDevices } = useQuery<TrustedDevicesResponse>({
    queryKey: ["/api/security/trusted-devices"],
    queryFn: async () => {
      const res = await apiFetch("/api/security/trusted-devices");
      if (!res.ok) throw new Error("Failed to fetch trusted devices");
      return res.json();
    },
    enabled: isAuthenticated,
  });

  const { data: twoFaStatus } = useQuery<TwoFaStatusResponse>({
    queryKey: ["/api/2fa/status"],
    queryFn: async () => {
      const res = await apiFetch("/api/2fa/status");
      if (!res.ok) throw new Error("Failed to fetch 2FA status");
      return res.json();
    },
    enabled: isAuthenticated,
  });

  const authAppEnabled = twoFaStatus?.enabled ?? !!props.settings.authApp;
  const currentDevice = devicesData?.devices?.find((d) => d.isCurrent) || null;
  const pushEnabled = currentDevice?.pushApprovalsEnabled ?? !!props.settings.pushNotifications;
  const trustedDevicesCount = devicesData?.devices?.length ?? 0;

  useEffect(() => {
    if (typeof twoFaStatus?.enabled === "boolean" && props.settings.authApp !== twoFaStatus.enabled) {
      props.updateSetting("authApp", twoFaStatus.enabled);
    }
  }, [twoFaStatus?.enabled, props.settings.authApp, props.updateSetting]);

  useEffect(() => {
    if (currentDevice && props.settings.pushNotifications !== currentDevice.pushApprovalsEnabled) {
      props.updateSetting("pushNotifications", currentDevice.pushApprovalsEnabled);
    }
  }, [currentDevice, props.settings.pushNotifications, props.updateSetting]);

  const pushApprovalsMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiFetch("/api/security/push-approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "Failed to update push approvals");
      }
      return res.json() as Promise<{ success: boolean; enabled: boolean }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/security/trusted-devices"] });
    },
  });

  const revokeSessionMutation = useMutation({
    mutationFn: async (sid: string) => {
      const res = await apiFetch("/api/security/sessions/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sid }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "Failed to revoke session");
      }
      return res.json() as Promise<{ success: boolean; current?: boolean }>;
    },
    onSuccess: (_data, sid) => {
      queryClient.invalidateQueries({ queryKey: ["/api/security/trusted-devices"] });
      if (devicesData?.currentSid && sid === devicesData.currentSid) {
        props.onLogout();
      }
    },
  });

  // --- 2FA setup flow ---
  const [show2faSetup, setShow2faSetup] = useState(false);
  const [show2faDisable, setShow2faDisable] = useState(false);
  const [setupPayload, setSetupPayload] = useState<TwoFaSetupResponse | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [disableCode, setDisableCode] = useState("");

  const setup2faMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/2fa/setup", { method: "POST" });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "Failed to start 2FA setup");
      }
      return res.json() as Promise<TwoFaSetupResponse>;
    },
    onSuccess: (payload) => {
      setSetupPayload(payload);
      setVerifyCode("");
      setShow2faSetup(true);
    },
    onError: (err: any) => {
      toast({
        title: "No se pudo iniciar 2FA",
        description: err?.message || "Error inesperado",
        variant: "destructive" as any,
      });
    },
  });

  const verify2faSetupMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiFetch("/api/2fa/verify-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "Failed to verify 2FA setup");
      }
      return res.json() as Promise<{ success: boolean }>;
    },
    onSuccess: () => {
      toast({ title: "2FA activado", description: "Tu aplicación de autenticación ya está configurada." });
      setShow2faSetup(false);
      setSetupPayload(null);
      queryClient.invalidateQueries({ queryKey: ["/api/2fa/status"] });
      props.updateSetting("authApp", true);
    },
    onError: (err: any) => {
      toast({
        title: "Código inválido",
        description: err?.message || "No se pudo verificar el código",
        variant: "destructive" as any,
      });
    },
  });

  const disable2faMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiFetch("/api/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "Failed to disable 2FA");
      }
      return res.json() as Promise<{ success: boolean }>;
    },
    onSuccess: () => {
      toast({ title: "2FA desactivado", description: "Se desactivó la autenticación multifactor." });
      setShow2faDisable(false);
      setDisableCode("");
      queryClient.invalidateQueries({ queryKey: ["/api/2fa/status"] });
      props.updateSetting("authApp", false);
    },
    onError: (err: any) => {
      toast({
        title: "No se pudo desactivar",
        description: err?.message || "Revisa el código e inténtalo de nuevo",
        variant: "destructive" as any,
      });
    },
  });

  const onToggleAuthApp = (next: boolean) => {
    if (!isAuthenticated) {
      toast({ title: "Inicia sesión", description: "Necesitas una cuenta para activar 2FA.", variant: "destructive" as any });
      return;
    }

    if (next) {
      setup2faMutation.mutate();
      return;
    }

    setDisableCode("");
    setShow2faDisable(true);
  };

  const onTogglePushApprovals = async (next: boolean) => {
    if (!isAuthenticated) {
      toast({ title: "Inicia sesión", description: "Necesitas una cuenta para usar aprobaciones push.", variant: "destructive" as any });
      return;
    }

    const urlBase64ToUint8Array = (base64String: string) => {
      const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
      const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
      const rawData = window.atob(base64);
      const outputArray = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; i++) {
        outputArray[i] = rawData.charCodeAt(i);
      }
      return outputArray;
    };

    const ensureServiceWorker = async (): Promise<ServiceWorkerRegistration> => {
      if (!("serviceWorker" in navigator)) {
        throw new Error("SERVICE_WORKER_NOT_SUPPORTED");
      }
      const existing = await navigator.serviceWorker.getRegistration();
      if (existing) return existing;
      return navigator.serviceWorker.register("/sw.js", { scope: "/" });
    };

    const subscribeWebPush = async (): Promise<void> => {
      const keyRes = await apiFetch("/api/security/push/vapid-public-key");
      if (!keyRes.ok) throw new Error("Failed to get VAPID key");
      const keyData = await keyRes.json() as { configured: boolean; publicKey: string; isEphemeral?: boolean };
      if (!keyData.configured || !keyData.publicKey) {
        throw new Error("WEB_PUSH_NOT_CONFIGURED");
      }

      const reg = await ensureServiceWorker();
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
        });
      }

      const payload = { subscription: sub.toJSON() };
      const res = await apiFetch("/api/security/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "Failed to save subscription");
      }
    };

    const unsubscribeWebPush = async (): Promise<void> => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            await sub.unsubscribe();
          }
        }
      } finally {
        await apiFetch("/api/security/push/unsubscribe", { method: "POST" });
      }
    };

    if (next) {
      if (!("Notification" in window)) {
        toast({ title: "No compatible", description: "Tu navegador no soporta notificaciones.", variant: "destructive" as any });
        return;
      }

      if (Notification.permission !== "granted") {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          toast({
            title: "Permiso denegado",
            description: "Activa las notificaciones en tu navegador para usar aprobaciones push.",
            variant: "destructive" as any,
          });
          return;
        }
      }

      try {
        await subscribeWebPush();
      } catch (err: any) {
        const msg = err?.message === "WEB_PUSH_NOT_CONFIGURED"
          ? "Configura VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY en el servidor para habilitar push."
          : (err?.message || "No se pudo activar web push");
        toast({ title: "Push no disponible", description: msg, variant: "destructive" as any });
        return;
      }
    }

    try {
      await pushApprovalsMutation.mutateAsync(next);

      if (!next) {
        // Best-effort cleanup: stop receiving push on this device.
        try {
          await unsubscribeWebPush();
        } catch {
          // Ignore.
        }
      }

      props.updateSetting("pushNotifications", next);
      toast({
        title: next ? "Aprobaciones push activadas" : "Aprobaciones push desactivadas",
        description: next
          ? "Este dispositivo puede aprobar inicios de sesión."
          : "Este dispositivo ya no recibirá solicitudes de aprobación.",
      });
    } catch (err: any) {
      toast({
        title: "No se pudo actualizar",
        description: err?.message || "Error inesperado",
        variant: "destructive" as any,
      });
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Seguridad</h2>

      <div className="space-y-4">
        <h3 className="text-base font-medium">Autenticación multifactor (MFA)</h3>

        <div className="flex items-center justify-between py-2">
          <div className="flex-1 pr-4">
            <span className="text-sm block">Aplicación de autenticación</span>
            <span className="text-xs text-muted-foreground">
              Usa códigos únicos desde una aplicación de autenticación.
            </span>
          </div>
          <Switch
            checked={authAppEnabled}
            onCheckedChange={(checked) => onToggleAuthApp(checked)}
            data-testid="switch-auth-app"
            disabled={setup2faMutation.isPending || verify2faSetupMutation.isPending || disable2faMutation.isPending}
          />
        </div>

        <div className="flex items-center justify-between py-2">
          <div className="flex-1 pr-4">
            <span className="text-sm block">Notificaciones push</span>
            <span className="text-xs text-muted-foreground">
              Aprueba los inicios de sesión con una notificación push enviada a tu dispositivo de confianza
            </span>
          </div>
          <Switch
            checked={pushEnabled}
            onCheckedChange={(checked) => onTogglePushApprovals(checked)}
            data-testid="switch-push-notif"
            disabled={pushApprovalsMutation.isPending}
          />
        </div>

        <button
          className="w-full flex items-center justify-between py-3 hover:bg-muted/50 transition-colors rounded-lg px-2"
          data-testid="security-trusted-devices"
          onClick={() => setShowTrustedDevices(true)}
        >
          <span className="text-sm">Dispositivos de confianza</span>
          <span className="text-sm text-muted-foreground flex items-center gap-1">
            {isLoadingDevices ? "..." : trustedDevicesCount} <ChevronRight className="h-4 w-4" />
          </span>
        </button>

        <Separator />

        <div className="flex items-center justify-between py-2">
          <span className="text-sm">Cerrar la sesión en este dispositivo</span>
          <Button
            variant="outline"
            size="sm"
            onClick={props.onLogout}
            data-testid="button-logout"
          >
            Cerrar sesión
          </Button>
        </div>

        <div className="flex items-start justify-between py-2">
          <div className="flex-1 pr-4">
            <span className="text-sm block">Cerrar sesión en todos los dispositivos</span>
            <span className="text-xs text-muted-foreground">
              Cierra todas las sesiones activas en todos los dispositivos.
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-red-500 border-red-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950 whitespace-nowrap"
            onClick={props.onRequestLogoutAll}
            data-testid="button-logout-all"
          >
            Cerrar todas las sesiones
          </Button>
        </div>

        <Separator />

        <div className="pt-2">
          <h3 className="text-base font-medium">Inicio de sesión seguro con ILIAGPT</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Inicia sesión en sitios web y aplicaciones en toda la red con la seguridad confiable de ILIAGPT.
          </p>
        </div>
      </div>

      <TrustedDevicesDialog
        open={showTrustedDevices}
        onOpenChange={setShowTrustedDevices}
        data={devicesData}
        isLoading={isLoadingDevices}
        isRevoking={revokeSessionMutation.isPending}
        onRevoke={(sid) => revokeSessionMutation.mutate(sid, {
          onError: (err: any) => {
            toast({ title: "No se pudo cerrar la sesión", description: err?.message || "Error inesperado", variant: "destructive" as any });
          },
          onSuccess: () => {
            toast({ title: "Sesión cerrada", description: "El dispositivo ya no tiene acceso." });
          }
        })}
        revokingSid={(revokeSessionMutation.variables as any) || null}
      />

      {/* 2FA Setup Dialog */}
      <Dialog open={show2faSetup} onOpenChange={setShow2faSetup}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Configurar 2FA</DialogTitle>
            <DialogDescription>
              Escanea el código QR con tu app (Google Authenticator, Authy, etc.) y luego ingresa el código de 6 dígitos.
            </DialogDescription>
          </DialogHeader>

          {!setupPayload ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-center">
                <img
                  src={setupPayload.qrCodeImage}
                  alt="QR 2FA"
                  className="h-44 w-44 rounded-md border bg-white p-2"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Código de verificación</label>
                <Input
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                  placeholder="123456"
                  inputMode="numeric"
                  maxLength={6}
                  data-testid="input-2fa-verify-code"
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShow2faSetup(false);
                    setSetupPayload(null);
                    setVerifyCode("");
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={() => verify2faSetupMutation.mutate(verifyCode)}
                  disabled={verify2faSetupMutation.isPending || verifyCode.trim().length !== 6}
                  data-testid="button-2fa-verify"
                >
                  {verify2faSetupMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Activar"}
                </Button>
              </div>

              {setupPayload.backupCodes?.length ? (
                <div className="pt-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Info className="h-4 w-4" />
                    <span>Guarda tus códigos de respaldo en un lugar seguro.</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {setupPayload.backupCodes.slice(0, 6).map((code) => (
                      <div key={code} className="text-xs font-mono border rounded-md px-2 py-1">
                        {code}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 2FA Disable Dialog */}
      <AlertDialog open={show2faDisable} onOpenChange={setShow2faDisable}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desactivar 2FA</AlertDialogTitle>
            <AlertDialogDescription>
              Para desactivar 2FA, confirma con un código actual de tu aplicación de autenticación.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="py-2">
            <Input
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value)}
              placeholder="123456 o XXXX-XXXX"
              maxLength={12}
              data-testid="input-2fa-disable-code"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => disable2faMutation.mutate(disableCode)}
              className="bg-red-500 hover:bg-red-600"
              disabled={disable2faMutation.isPending || disableCode.trim().length < 6}
              data-testid="button-2fa-disable"
            >
              {disable2faMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Desactivar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [showLogoutAllConfirm, setShowLogoutAllConfirm] = useState(false);
  const [isLoggingOutAll, setIsLoggingOutAll] = useState(false);
  const [schedulesManagerOpen, setSchedulesManagerOpen] = useState(false);
  const [sessionsManagerOpen, setSessionsManagerOpen] = useState(false);
  const [editingBuilderLink, setEditingBuilderLink] = useState<BuilderLinkKind | null>(null);
  const [builderLinkDraft, setBuilderLinkDraft] = useState("");

  const { settings, updateSetting } = useSettingsContext();
  const { settings: platformSettings } = usePlatformSettings();
  const { language: currentLanguage, setLanguage: setAppLanguage, supportedLanguages } = useLanguage();
  const { toast } = useToast();
  const { user, logout } = useAuth();
  const { availableModels } = useModelAvailability();
  const platformUserDateFormat = mapPlatformDateFormatToUserDateFormat(platformSettings.date_format);
  const effectiveDefaultModel = settings.defaultModel || platformSettings.default_model;
  const themeManagedByPlatform = platformSettings.theme_mode !== "auto";
  const effectiveAppearance = themeManagedByPlatform
    ? (platformSettings.theme_mode === "light" ? "light" : "dark")
    : settings.appearance;

  const handleLanguageChange = (value: string) => {
    if (value !== "auto") {
      setAppLanguage(value as any);
    }
  };

  const playVoicePreview = (voiceId: string) => {
    setPlayingVoice(voiceId);
    const utterance = new SpeechSynthesisUtterance("Hola, soy tu asistente virtual. ¿En qué puedo ayudarte hoy?");
    utterance.lang = "es-ES";
    utterance.rate = 1;
    utterance.pitch = voiceId === "ember" ? 1.2 : voiceId === "breeze" ? 0.9 : 1;
    utterance.onend = () => setPlayingVoice(null);
    utterance.onerror = () => setPlayingVoice(null);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const handleLogout = () => {
    logout();
    onOpenChange(false);
    toast({ title: "Sesión cerrada", description: "Has cerrado sesión correctamente." });
  };

  const handleLogoutAll = async () => {
    try {
      // Revoke all sessions server-side (other devices), then log out locally.
      setIsLoggingOutAll(true);
      await apiFetch("/api/security/sessions/revoke-all", { method: "POST" });
    } catch {
      // Best-effort: still log out locally.
    } finally {
      setIsLoggingOutAll(false);
      setShowLogoutAllConfirm(false);
    }

    logout();
    onOpenChange(false);
    toast({ title: "Todas las sesiones cerradas", description: "Se han cerrado todas las sesiones activas." });
  };

  const renderSectionContent = () => {
    switch (activeSection) {
      case "general":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">General</h2>

            {/* Display Section */}
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Pantalla</h3>
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Tema</span>
                    <span className="text-xs text-muted-foreground">
                      {themeManagedByPlatform
                        ? "Gestionado por administrador"
                        : "Selecciona el aspecto visual de la aplicacion"}
                    </span>
                  </div>
                  <Select
                    value={effectiveAppearance}
                    disabled={themeManagedByPlatform}
                    onValueChange={(value) => updateSetting("appearance", value as any)}
                  >
                    <SelectTrigger className="w-40" data-testid="select-appearance">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="system">Sistema</SelectItem>
                      <SelectItem value="light">Claro</SelectItem>
                      <SelectItem value="dark">Oscuro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Color de acento</span>
                    <span className="text-xs text-muted-foreground">Personaliza el color principal de la interfaz</span>
                  </div>
                  <Select
                    value={settings.accentColor}
                    onValueChange={(value) => updateSetting("accentColor", value as any)}
                  >
                    <SelectTrigger className="w-40" data-testid="select-accent-color">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-foreground" />
                          Predeterminada
                        </div>
                      </SelectItem>
                      <SelectItem value="blue">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-blue-500" />
                          Azul
                        </div>
                      </SelectItem>
                      <SelectItem value="green">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-green-500" />
                          Verde
                        </div>
                      </SelectItem>
                      <SelectItem value="purple">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-purple-500" />
                          Morado
                        </div>
                      </SelectItem>
                      <SelectItem value="orange">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-orange-500" />
                          Naranja
                        </div>
                      </SelectItem>
                      <SelectItem value="pink">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-pink-500" />
                          Rosa
                        </div>
                      </SelectItem>
                      <SelectItem value="red">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-red-500" />
                          Rojo
                        </div>
                      </SelectItem>
                      <SelectItem value="teal">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-teal-500" />
                          Teal
                        </div>
                      </SelectItem>
                      <SelectItem value="yellow">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-yellow-500" />
                          Amarillo
                        </div>
                      </SelectItem>
                      <SelectItem value="indigo">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-indigo-500" />
                          Índigo
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Tamaño de fuente</span>
                    <span className="text-xs text-muted-foreground">Ajusta el tamaño del texto</span>
                  </div>
                  <Select
                    value={settings.fontSize}
                    onValueChange={(value) => updateSetting("fontSize", value as any)}
                  >
                    <SelectTrigger className="w-40" data-testid="select-font-size">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="small">Pequeño</SelectItem>
                      <SelectItem value="medium">Mediano</SelectItem>
                      <SelectItem value="large">Grande</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Densidad</span>
                    <span className="text-xs text-muted-foreground">Espaciado entre elementos</span>
                  </div>
                  <Select
                    value={settings.density}
                    onValueChange={(value) => updateSetting("density", value as any)}
                  >
                    <SelectTrigger className="w-40" data-testid="select-density">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="compact">Compacto</SelectItem>
                      <SelectItem value="comfortable">Cómodo</SelectItem>
                      <SelectItem value="spacious">Espacioso</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <Separator />

            {/* Language & Region Section */}
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Idioma y región</h3>
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm">Idioma de la interfaz</span>
                  <Select value={currentLanguage} onValueChange={handleLanguageChange}>
                    <SelectTrigger className="w-40" data-testid="select-language">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {supportedLanguages.map(lang => (
                        <SelectItem key={lang.code} value={lang.code}>{lang.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Idioma hablado</span>
                    <span className="text-xs text-muted-foreground">Para reconocimiento de voz</span>
                  </div>
                  <Select
                    value={settings.spokenLanguage}
                    onValueChange={(value) => updateSetting("spokenLanguage", value)}
                  >
                    <SelectTrigger className="w-40 shrink-0" data-testid="select-spoken-language">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Automático</SelectItem>
                      <SelectItem value="es">Español</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="fr">Français</SelectItem>
                      <SelectItem value="de">Deutsch</SelectItem>
                      <SelectItem value="pt">Português</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Formato de fecha</span>
                    <span className="text-xs text-muted-foreground">Gestionado por administrador</span>
                  </div>
                  <Select value={platformUserDateFormat} disabled>
                    <SelectTrigger className="w-40" data-testid="select-date-format">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dd/mm/yyyy">DD/MM/AAAA</SelectItem>
                      <SelectItem value="mm/dd/yyyy">MM/DD/AAAA</SelectItem>
                      <SelectItem value="yyyy-mm-dd">AAAA-MM-DD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Zona horaria</span>
                    <span className="text-xs text-muted-foreground">Gestionado por administrador</span>
                  </div>
                  <Input
                    className="w-40"
                    value={platformSettings.timezone_default || "UTC"}
                    disabled
                    data-testid="input-timezone"
                  />
                </div>

                <div className="flex items-center justify-between py-2">
                  <span className="text-sm">Formato de hora</span>
                  <Select
                    value={settings.timeFormat}
                    onValueChange={(value) => updateSetting("timeFormat", value as any)}
                  >
                    <SelectTrigger className="w-40" data-testid="select-time-format">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="24h">24 horas</SelectItem>
                      <SelectItem value="12h">12 horas (AM/PM)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <Separator />

            {/* Voice & Audio Section */}
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Voz y audio</h3>
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm">Voz del asistente</span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1"
                      onClick={() => playVoicePreview(settings.voice)}
                      disabled={playingVoice !== null}
                      data-testid="button-play-voice"
                    >
                      {playingVoice === settings.voice ? (
                        <Volume2 className="h-3 w-3 animate-pulse" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                    </Button>
                    <Select
                      value={settings.voice}
                      onValueChange={(value) => updateSetting("voice", value)}
                    >
                      <SelectTrigger className="w-28" data-testid="select-voice">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {voices.map((voice) => (
                          <SelectItem key={voice.id} value={voice.id}>
                            {voice.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Reproducir respuestas automáticamente</span>
                    <span className="text-xs text-muted-foreground">Lee las respuestas en voz alta</span>
                  </div>
                  <Switch
                    checked={settings.autoPlayResponses}
                    onCheckedChange={(checked) => updateSetting("autoPlayResponses", checked)}
                    data-testid="switch-auto-play"
                  />
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Modo de voz independiente</span>
                    <span className="text-xs text-muted-foreground">Pantalla completa sin elementos visuales</span>
                  </div>
                  <Switch
                    checked={settings.independentVoiceMode}
                    onCheckedChange={(checked) => updateSetting("independentVoiceMode", checked)}
                    data-testid="switch-voice-mode"
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* AI Models Section */}
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Modelos de IA</h3>
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Modelo predeterminado</span>
                    <span className="text-xs text-muted-foreground">
                      {settings.defaultModel ? "Modelo para nuevas conversaciones" : "Predeterminado de la plataforma"}
                    </span>
                  </div>
                  <Select
                    value={effectiveDefaultModel}
                    onValueChange={(value) => updateSetting("defaultModel", value)}
                  >
                    <SelectTrigger className="w-48" data-testid="select-default-model">
                      <SelectValue />
                    </SelectTrigger>
                  <SelectContent>
                      {availableModels.some((m) => m.modelId === platformSettings.default_model) ? null : (
                        <SelectItem value={platformSettings.default_model}>
                          {platformSettings.default_model}
                        </SelectItem>
                      )}
                      {availableModels.length > 0 ? (
                        availableModels.map((m) => (
                          <SelectItem key={m.id} value={m.modelId}>
                            {m.name}
                          </SelectItem>
                        ))
                      ) : (
                        <>
                          <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
                          <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
                          <SelectItem value="grok-3-fast">Grok 3 Fast</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Mostrar modelos adicionales</span>
                    <span className="text-xs text-muted-foreground">Ver todos los modelos disponibles</span>
                  </div>
                  <Switch
                    checked={settings.showAdditionalModels}
                    onCheckedChange={(checked) => updateSetting("showAdditionalModels", checked)}
                    data-testid="switch-additional-models"
                  />
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Transmitir respuestas</span>
                    <span className="text-xs text-muted-foreground">
                      {platformSettings.enable_streaming
                        ? "Ver las respuestas mientras se generan"
                        : "Deshabilitado por el administrador"}
                    </span>
                  </div>
                  <Switch
                    checked={platformSettings.enable_streaming && settings.streamResponses}
                    disabled={!platformSettings.enable_streaming}
                    onCheckedChange={(checked) => updateSetting("streamResponses", checked)}
                    data-testid="switch-stream"
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Accessibility Section */}
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Accesibilidad</h3>
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Atajos de teclado</span>
                    <span className="text-xs text-muted-foreground">Habilitar navegación con teclado</span>
                  </div>
                  <Switch
                    checked={settings.keyboardShortcuts}
                    onCheckedChange={(checked) => updateSetting("keyboardShortcuts", checked)}
                    data-testid="switch-keyboard"
                  />
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Reducir movimiento</span>
                    <span className="text-xs text-muted-foreground">Minimizar animaciones</span>
                  </div>
                  <Switch
                    checked={settings.reducedMotion}
                    onCheckedChange={(checked) => updateSetting("reducedMotion", checked)}
                    data-testid="switch-motion"
                  />
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm block">Alto contraste</span>
                    <span className="text-xs text-muted-foreground">Mejorar visibilidad de elementos</span>
                  </div>
                  <Switch
                    checked={settings.highContrast}
                    onCheckedChange={(checked) => updateSetting("highContrast", checked)}
                    data-testid="switch-contrast"
                  />
                </div>
              </div>
            </div>
          </div>
        );

      case "notifications":
        return <NotificationsControlPanels onOpenSchedules={() => setSchedulesManagerOpen(true)} />;

      case "personalization":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Personalización</h2>

            <div className="space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-sm font-medium">Estilo y tonos de base</span>
                  <p className="text-sm text-muted-foreground">
                    Configura el estilo y el tono que ILIAGPT utiliza al responder.
                  </p>
                </div>
                <Select
                  value={settings.styleAndTone}
                  onValueChange={(value) => updateSetting("styleAndTone", value as any)}
                >
                  <SelectTrigger className="w-40" data-testid="select-style-tone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Predeterminada</SelectItem>
                    <SelectItem value="formal">Formal</SelectItem>
                    <SelectItem value="casual">Casual</SelectItem>
                    <SelectItem value="concise">Conciso</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium">Instrucciones personalizadas</span>
              <Textarea
                placeholder="Preferencias adicionales de comportamiento, estilo y tono"
                value={settings.customInstructions}
                onChange={(e) => updateSetting("customInstructions", e.target.value)}
                className="min-h-[80px]"
                data-testid="textarea-custom-instructions"
              />
            </div>

            <Separator />

            <h3 className="text-lg font-medium">Acerca de ti</h3>

            <div className="space-y-2">
              <span className="text-sm font-medium">Apodo</span>
              <Input
                placeholder="¿Cómo debería llamarte ILIAGPT?"
                value={settings.nickname}
                onChange={(e) => updateSetting("nickname", e.target.value)}
                data-testid="input-nickname"
              />
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium">Ocupación</span>
              <Input
                placeholder="Estudiante de ingeniería, diseñador, etc."
                value={settings.occupation}
                onChange={(e) => updateSetting("occupation", e.target.value)}
                data-testid="input-occupation"
              />
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium">Más acerca de ti</span>
              <Textarea
                placeholder="Intereses, valores o preferencias para tener en cuenta"
                value={settings.aboutYou}
                onChange={(e) => updateSetting("aboutYou", e.target.value)}
                className="min-h-[80px]"
                data-testid="textarea-about-you"
              />
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Permite que ILIAGPT guarde y use memorias al responder.</span>
                </div>
                <Switch
                  checked={settings.allowMemories}
                  onCheckedChange={(checked) => updateSetting("allowMemories", checked)}
                  data-testid="switch-memories"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Consultar el historial de grabaciones</span>
                  <span className="text-xs text-muted-foreground">
                    Permite que ILIAGPT consulte transcripciones y notas de grabaciones anteriores.
                  </span>
                </div>
                <Switch
                  checked={settings.allowRecordings}
                  onCheckedChange={(checked) => updateSetting("allowRecordings", checked)}
                  data-testid="switch-recordings"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Búsqueda en la web</span>
                  <span className="text-xs text-muted-foreground">
                    Dejar que ILIAGPT busque automáticamente las respuestas en la web.
                  </span>
                </div>
                <Switch
                  checked={settings.webSearch}
                  onCheckedChange={(checked) => updateSetting("webSearch", checked)}
                  data-testid="switch-web-search"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Código</span>
                  <span className="text-xs text-muted-foreground">
                    Dejar que ILIAGPT ejecute el código con el Intérprete de código.
                  </span>
                </div>
                <Switch
                  checked={settings.codeInterpreter}
                  onCheckedChange={(checked) => updateSetting("codeInterpreter", checked)}
                  data-testid="switch-code"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Lienzo</span>
                  <span className="text-xs text-muted-foreground">
                    Colaborar con ILIAGPT en texto y código.
                  </span>
                </div>
                <Switch
                  checked={settings.canvas}
                  onCheckedChange={(checked) => updateSetting("canvas", checked)}
                  data-testid="switch-canvas"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">ILIAGPT Voice</span>
                  <span className="text-xs text-muted-foreground">
                    Habilitar el modo de voz en ILIAGPT
                  </span>
                </div>
                <Switch
                  checked={settings.voiceMode}
                  onCheckedChange={(checked) => updateSetting("voiceMode", checked)}
                  data-testid="switch-voice"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Modo de voz avanzado</span>
                  <span className="text-xs text-muted-foreground">
                    Ten conversaciones más naturales en el modo de voz.
                  </span>
                </div>
                <Switch
                  checked={settings.advancedVoice}
                  disabled={!settings.voiceMode}
                  onCheckedChange={(checked) => updateSetting("advancedVoice", checked)}
                  data-testid="switch-advanced-voice"
                />
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex-1 pr-4">
                  <span className="text-sm block">Búsqueda del conector</span>
                  <span className="text-xs text-muted-foreground">
                    Dejar que ILIAGPT busque automáticamente las respuestas en las fuentes conectadas.
                  </span>
                </div>
                <Switch
                  checked={settings.connectorSearch}
                  onCheckedChange={(checked) => updateSetting("connectorSearch", checked)}
                  data-testid="switch-connector-search"
                />
              </div>
            </div>
          </div>
        );

      case "apps":
        return <AppsSection />;

      case "schedules":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Programaciones</h2>
            <p className="text-sm text-muted-foreground">
              ILIAGPT puede programarse para ejecutarse nuevamente después de completar una tarea.
              Selecciona <span className="inline-flex items-center"><Calendar className="h-3 w-3 mx-1" /></span> Programar en el menú de <span className="font-medium">⋯</span> en una conversación para configurar ejecuciones futuras.
            </p>
            <Button
              variant="outline"
              onClick={() => setSchedulesManagerOpen(true)}
              data-testid="button-manage-schedules"
            >
              Administrar
            </Button>
          </div>
        );

      case "data":
        return <DataControlsSection />;

      case "security":
        return (
          <SecuritySection
            settings={settings}
            updateSetting={updateSetting}
            onLogout={handleLogout}
            onRequestLogoutAll={() => setShowLogoutAllConfirm(true)}
          />
        );

      case "account": {
        const displayName =
          user?.fullName ||
          [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
          user?.username ||
          user?.email?.split("@")[0] ||
          "Usuario";

        const previewByline = settings.showName ? displayName : "Usuario";

        const getLinkValue = (kind: BuilderLinkKind): string => {
          if (kind === "website") return settings.websiteDomain || "";
          if (kind === "linkedin") return settings.linkedInUrl || "";
          return settings.githubUrl || "";
        };

        const setLinkValue = (kind: BuilderLinkKind, value: string) => {
          if (kind === "website") updateSetting("websiteDomain", value);
          else if (kind === "linkedin") updateSetting("linkedInUrl", value);
          else updateSetting("githubUrl", value);
        };

        const startEditLink = (kind: BuilderLinkKind) => {
          setEditingBuilderLink(kind);
          setBuilderLinkDraft(getLinkValue(kind));
        };

        const cancelEditLink = () => {
          setEditingBuilderLink(null);
          setBuilderLinkDraft("");
        };

        const saveEditLink = () => {
          if (!editingBuilderLink) return;

          const normalized = normalizeExternalUrl(builderLinkDraft);
          if (!normalized) {
            toast({
              title: "URL inválida",
              description: "Usa un enlace http/https (por ejemplo: https://github.com/usuario).",
            });
            return;
          }

          setLinkValue(editingBuilderLink, normalized);
          cancelEditLink();
        };

        const openLink = (url: string) => {
          const normalized = normalizeExternalUrl(url);
          if (!normalized) {
            toast({ title: "Enlace inválido", description: "Revisa la URL e intenta nuevamente." });
            return;
          }
          window.open(normalized, "_blank", "noopener,noreferrer");
        };

        const renderLinkActions = (kind: BuilderLinkKind, url: string, addTestId: string) => {
          if (editingBuilderLink === kind) {
            return (
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <Input
                  value={builderLinkDraft}
                  onChange={(e) => setBuilderLinkDraft(e.target.value)}
                  placeholder="https://..."
                  className="w-72"
                  data-testid={`input-builder-link-${kind}`}
                />
                <Button size="sm" onClick={saveEditLink} data-testid={`button-save-builder-link-${kind}`}>
                  Guardar
                </Button>
                <Button variant="ghost" size="sm" onClick={cancelEditLink} data-testid={`button-cancel-builder-link-${kind}`}>
                  Cancelar
                </Button>
              </div>
            );
          }

          if (!url) {
            return (
              <Button
                variant="outline"
                size="sm"
                onClick={() => startEditLink(kind)}
                data-testid={addTestId}
              >
                Agregar
              </Button>
            );
          }

          return (
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <span className="text-sm text-muted-foreground max-w-48 truncate">
                {getUrlLabel(url)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => openLink(url)}
                data-testid={`button-open-builder-link-${kind}`}
              >
                Abrir
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => startEditLink(kind)}
                data-testid={`button-edit-builder-link-${kind}`}
              >
                Editar
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-600"
                onClick={() => setLinkValue(kind, "")}
                data-testid={`button-remove-builder-link-${kind}`}
              >
                Eliminar
              </Button>
            </div>
          );
        };

        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Perfil de constructor de GPT</h2>
            <p className="text-sm text-muted-foreground">
              Personaliza tu perfil de constructor para conectarte con usuarios de los GPT.
            </p>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
                  <Box className="h-6 w-6 text-muted-foreground" />
                </div>
                <div>
                  <span className="text-sm font-medium block">PlaceholderGPT</span>
                  <span className="text-xs text-muted-foreground">Por {previewByline}</span>
                </div>
              </div>
              <span className="text-sm text-muted-foreground">Vista previa</span>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">Nombre</span>
                <Switch
                  checked={settings.showName}
                  onCheckedChange={(checked) => updateSetting("showName", checked)}
                  data-testid="switch-show-name"
                />
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm">{displayName}</span>
                <Info className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <span className="font-medium">Enlaces</span>

              <div className="flex items-center justify-between py-2 gap-3">
                <div className="flex items-center gap-3">
                  <Globe className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm">Sitio web</span>
                </div>
                {renderLinkActions("website", settings.websiteDomain, "button-add-website")}
              </div>

              <div className="flex items-center justify-between py-2 gap-3">
                <div className="flex items-center gap-3">
                  <Linkedin className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm">LinkedIn</span>
                </div>
                {renderLinkActions("linkedin", settings.linkedInUrl, "button-add-linkedin")}
              </div>

              <div className="flex items-center justify-between py-2 gap-3">
                <div className="flex items-center gap-3">
                  <Github className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm">GitHub</span>
                </div>
                {renderLinkActions("github", settings.githubUrl, "button-add-github")}
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <span className="font-medium">Correo electrónico</span>

              <div className="flex items-center gap-3 py-2">
                <Mail className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm">{user?.email || "Sin correo"}</span>
              </div>

              <div className="flex items-center gap-3 py-2">
                <Checkbox
                  id="email-comments"
                  checked={settings.receiveEmailComments}
                  onCheckedChange={(checked) => updateSetting("receiveEmailComments", !!checked)}
                  data-testid="checkbox-email-comments"
                />
                <label htmlFor="email-comments" className="text-sm">
                  Recibir correos electrónicos con comentarios
                </label>
              </div>
            </div>
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[600px] p-0 gap-0 overflow-hidden">
          <div className="flex h-[500px]">
            <div className="w-48 border-r bg-muted/30 p-2">
              <div className="flex items-center justify-between p-2 mb-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onOpenChange(false)}
                  data-testid="button-close-settings"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <nav className="space-y-1">
                {menuItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setActiveSection(item.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-all duration-200",
                      activeSection === item.id
                        ? "bg-background font-medium border-l-3 border-l-primary shadow-sm"
                        : "hover:bg-background/50 text-muted-foreground border-l-3 border-l-transparent"
                    )}
                    data-testid={`settings-menu-${item.id}`}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                ))}
              </nav>
            </div>

            <div className="flex-1 p-6 overflow-y-auto">
              {renderSectionContent()}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showLogoutAllConfirm} onOpenChange={setShowLogoutAllConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cerrar todas las sesiones?</AlertDialogTitle>
            <AlertDialogDescription>
              Se cerrarán todas las sesiones activas en todos los dispositivos, incluida tu sesión actual.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoggingOutAll}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLogoutAll}
              className="bg-red-500 hover:bg-red-600"
              disabled={isLoggingOutAll}
            >
              {isLoggingOutAll ? "Cerrando..." : "Cerrar todas las sesiones"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SchedulesManagerDialog
        open={schedulesManagerOpen}
        onOpenChange={setSchedulesManagerOpen}
      />

      <SessionsManagerDialog
        open={sessionsManagerOpen}
        onOpenChange={setSessionsManagerOpen}
      />
    </>
  );
}
