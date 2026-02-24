import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/apiClient";

// ─── Types ───────────────────────────────────────────────────────────
export type ServiceProvider =
  | "gmail"
  | "google_calendar"
  | "outlook"
  | "outlook_calendar"
  | "google_forms"
  | "slack"
  | "notion"
  | "github"
  | "figma"
  | "whatsapp";

export type ServiceCategory = "email" | "calendar" | "productivity" | "communication" | "design" | "development";

export interface ServiceDefinition {
  id: ServiceProvider;
  name: string;
  description: string;
  category: ServiceCategory;
  icon: string;
  color: string;
  oauthEndpoint?: string;
  features: string[];
}

export interface ServiceConnectionStatus {
  providerId: string;
  connected: boolean;
  email?: string;
  displayName?: string;
  status?: string;
  accountId?: string;
  connectedAt?: string;
}

export interface IntegrationAccountData {
  id: string;
  userId: string;
  providerId: string;
  displayName: string | null;
  email: string | null;
  status: string | null;
}

export interface IntegrationProviderData {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  authType: string;
  category: string | null;
  isActive: string;
}

export interface IntegrationsResponse {
  accounts: IntegrationAccountData[];
  policy: {
    id: string;
    userId: string;
    enabledApps: string[];
    autoConfirmPolicy: string | null;
    sandboxMode: string | null;
    maxParallelCalls: number | null;
  } | null;
  providers: IntegrationProviderData[];
}

// ─── Service catalog ─────────────────────────────────────────────────
export const SERVICE_CATALOG: ServiceDefinition[] = [
  {
    id: "gmail",
    name: "Gmail",
    description: "Enviar, leer y gestionar correos electrónicos directamente desde la plataforma",
    category: "email",
    icon: "mail",
    color: "#EA4335",
    oauthEndpoint: "/api/oauth/google/gmail/start",
    features: ["Leer correos", "Enviar correos", "Gestionar etiquetas", "Buscar mensajes"],
  },
  {
    id: "google_calendar",
    name: "Google Calendar",
    description: "Sincroniza eventos, crea reuniones y gestiona tu agenda desde aquí",
    category: "calendar",
    icon: "calendar",
    color: "#4285F4",
    oauthEndpoint: "/api/oauth/google/calendar/start",
    features: ["Ver eventos", "Crear reuniones", "Buscar horarios libres", "Recordatorios"],
  },
  {
    id: "outlook",
    name: "Outlook Mail",
    description: "Conecta tu correo de Microsoft para leer y enviar emails",
    category: "email",
    icon: "mail",
    color: "#0078D4",
    oauthEndpoint: "/api/oauth/microsoft/outlook/start",
    features: ["Leer correos", "Enviar correos", "Gestionar carpetas", "Buscar mensajes"],
  },
  {
    id: "outlook_calendar",
    name: "Outlook Calendar",
    description: "Sincroniza tu calendario de Microsoft y gestiona tus eventos",
    category: "calendar",
    icon: "calendar",
    color: "#0078D4",
    oauthEndpoint: "/api/oauth/microsoft/calendar/start",
    features: ["Ver eventos", "Crear reuniones", "Disponibilidad", "Recordatorios"],
  },
  {
    id: "google_forms",
    name: "Google Forms",
    description: "Crea y gestiona formularios, ve respuestas en tiempo real",
    category: "productivity",
    icon: "file-text",
    color: "#673AB7",
    features: ["Crear formularios", "Ver respuestas", "Analizar datos"],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Envía mensajes y recibe notificaciones de tus canales de Slack",
    category: "communication",
    icon: "message-square",
    color: "#4A154B",
    features: ["Enviar mensajes", "Recibir notificaciones", "Buscar canales"],
  },
  {
    id: "notion",
    name: "Notion",
    description: "Accede a tus páginas, bases de datos y documentos de Notion",
    category: "productivity",
    icon: "file-text",
    color: "#000000",
    features: ["Leer páginas", "Crear documentos", "Buscar contenido"],
  },
  {
    id: "github",
    name: "GitHub",
    description: "Gestiona repositorios, issues y pull requests",
    category: "development",
    icon: "github",
    color: "#24292F",
    features: ["Ver repositorios", "Gestionar issues", "Pull requests"],
  },
  {
    id: "figma",
    name: "Figma",
    description: "Accede a tus diseños y prototipos de Figma",
    category: "design",
    icon: "pen-tool",
    color: "#F24E1E",
    features: ["Ver archivos", "Exportar assets", "Comentarios"],
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    description: "Envía y recibe mensajes de WhatsApp desde la plataforma",
    category: "communication",
    icon: "message-circle",
    color: "#25D366",
    features: ["Enviar mensajes", "Recibir mensajes", "Auto-respuestas"],
  },
];

export const CATEGORY_LABELS: Record<ServiceCategory, string> = {
  email: "Correo electrónico",
  calendar: "Calendario",
  productivity: "Productividad",
  communication: "Comunicación",
  design: "Diseño",
  development: "Desarrollo",
};

export const CATEGORY_ORDER: ServiceCategory[] = [
  "email",
  "calendar",
  "productivity",
  "communication",
  "design",
  "development",
];

// ─── Hook ────────────────────────────────────────────────────────────
export function useServiceConnections() {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [connectingService, setConnectingService] = useState<string | null>(null);

  // Fetch integrations data
  const {
    data: integrationsData,
    isLoading,
    isError,
    refetch,
  } = useQuery<IntegrationsResponse>({
    queryKey: ["/api/users", userId, "integrations"],
    queryFn: async () => {
      const res = await apiFetch(`/api/users/${userId}/integrations`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch integrations");
      return res.json();
    },
    enabled: !!userId,
    staleTime: 30_000,
  });

  // Fetch Gmail-specific status
  const { data: gmailStatus } = useQuery<{ connected: boolean; email?: string }>({
    queryKey: ["gmail-status"],
    queryFn: async () => {
      const res = await apiFetch("/api/oauth/google/gmail/status", {
        credentials: "include",
      });
      if (!res.ok) return { connected: false };
      return res.json();
    },
    enabled: !!userId,
    staleTime: 30_000,
  });

  // Connect mutation
  const connectMutation = useMutation({
    mutationFn: async (providerId: string) => {
      const res = await apiFetch(
        `/api/users/${userId}/integrations/${providerId}/connect`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
        }
      );
      if (!res.ok) throw new Error("Failed to connect");
      return res.json();
    },
    onSuccess: (_data, providerId) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/users", userId, "integrations"],
      });
      const service = SERVICE_CATALOG.find((s) => s.id === providerId);
      toast({
        title: "Servicio conectado",
        description: `${service?.name || providerId} se ha conectado correctamente.`,
      });
      setConnectingService(null);
    },
    onError: (_err, providerId) => {
      const service = SERVICE_CATALOG.find((s) => s.id === providerId);
      toast({
        title: "Error de conexión",
        description: `No se pudo conectar ${service?.name || providerId}. Intenta de nuevo.`,
        variant: "destructive",
      });
      setConnectingService(null);
    },
  });

  // Disconnect mutation
  const disconnectMutation = useMutation({
    mutationFn: async (providerId: string) => {
      const res = await apiFetch(
        `/api/users/${userId}/integrations/${providerId}/disconnect`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
        }
      );
      if (!res.ok) throw new Error("Failed to disconnect");
      return res.json();
    },
    onSuccess: (_data, providerId) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/users", userId, "integrations"],
      });
      const service = SERVICE_CATALOG.find((s) => s.id === providerId);
      toast({
        title: "Servicio desconectado",
        description: `${service?.name || providerId} ha sido desconectado.`,
      });
    },
    onError: (_err, providerId) => {
      const service = SERVICE_CATALOG.find((s) => s.id === providerId);
      toast({
        title: "Error",
        description: `No se pudo desconectar ${service?.name || providerId}.`,
        variant: "destructive",
      });
    },
  });

  // Derived state
  const accounts = integrationsData?.accounts || [];
  const providers = integrationsData?.providers || [];

  const getConnectionStatus = useCallback(
    (providerId: string): ServiceConnectionStatus => {
      // Special handling for Gmail (has its own OAuth flow)
      if (providerId === "gmail" && gmailStatus?.connected) {
        return {
          providerId,
          connected: true,
          email: gmailStatus.email,
        };
      }

      const account = accounts.find(
        (a) => a.providerId === providerId && a.status === "active"
      );
      return {
        providerId,
        connected: !!account,
        email: account?.email ?? undefined,
        displayName: account?.displayName ?? undefined,
        status: account?.status ?? undefined,
        accountId: account?.id,
      };
    },
    [accounts, gmailStatus]
  );

  const connectedCount = useMemo(() => {
    const connectedIds = new Set<string>();
    for (const account of accounts) {
      if (account.status === "active") connectedIds.add(account.providerId);
    }
    if (gmailStatus?.connected) connectedIds.add("gmail");
    return connectedIds.size;
  }, [accounts, gmailStatus]);

  const totalServices = SERVICE_CATALOG.length;

  const connectService = useCallback(
    async (providerId: string) => {
      const service = SERVICE_CATALOG.find((s) => s.id === providerId);
      setConnectingService(providerId);

      // For Gmail, use the dedicated OAuth endpoint
      if (providerId === "gmail" && service?.oauthEndpoint) {
        window.location.href = service.oauthEndpoint;
        return;
      }

      // For Google Calendar, use OAuth endpoint
      if (providerId === "google_calendar" && service?.oauthEndpoint) {
        window.location.href = service.oauthEndpoint;
        return;
      }

      // For Outlook services, use OAuth endpoint
      if (
        (providerId === "outlook" || providerId === "outlook_calendar") &&
        service?.oauthEndpoint
      ) {
        window.location.href = service.oauthEndpoint;
        return;
      }

      // Fallback: use the generic connect endpoint
      connectMutation.mutate(providerId);
    },
    [connectMutation]
  );

  const disconnectService = useCallback(
    (providerId: string) => {
      // For Gmail, use the dedicated disconnect endpoint
      if (providerId === "gmail") {
        apiFetch("/api/oauth/google/gmail/disconnect", {
          method: "POST",
          credentials: "include",
        })
          .then((res) => {
            if (res.ok) {
              queryClient.invalidateQueries({ queryKey: ["gmail-status"] });
              queryClient.invalidateQueries({
                queryKey: ["/api/users", userId, "integrations"],
              });
              toast({
                title: "Gmail desconectado",
                description: "Tu cuenta de Gmail ha sido desconectada.",
              });
            }
          })
          .catch(() => {
            toast({
              title: "Error",
              description: "No se pudo desconectar Gmail.",
              variant: "destructive",
            });
          });
        return;
      }

      disconnectMutation.mutate(providerId);
    },
    [disconnectMutation, queryClient, userId, toast]
  );

  const servicesByCategory = useMemo(() => {
    const grouped: Record<ServiceCategory, ServiceDefinition[]> = {
      email: [],
      calendar: [],
      productivity: [],
      communication: [],
      design: [],
      development: [],
    };
    for (const service of SERVICE_CATALOG) {
      grouped[service.category].push(service);
    }
    return grouped;
  }, []);

  return {
    services: SERVICE_CATALOG,
    servicesByCategory,
    getConnectionStatus,
    connectService,
    disconnectService,
    connectingService,
    isConnecting: connectMutation.isPending,
    isDisconnecting: disconnectMutation.isPending,
    connectedCount,
    totalServices,
    isLoading,
    isError,
    refetch,
    providers,
    accounts,
  };
}
