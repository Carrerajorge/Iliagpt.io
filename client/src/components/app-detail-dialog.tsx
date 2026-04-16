import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, Loader2, ChevronLeft, AlertCircle, RefreshCw, XCircle, Clock, Ban, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { apiFetch } from "@/lib/apiClient";

export interface AppMetadata {
  id: string;
  name: string;
  shortDescription: string;
  longDescription?: string;
  icon: React.ReactNode;
  category: string;
  developer?: string;
  websiteUrl?: string;
  privacyUrl?: string;
  connectionEndpoint?: string;
  statusEndpoint?: string;
  disconnectEndpoint?: string;
}

interface ConnectionError {
  type: 'oauth_denied' | 'token_expired' | 'rate_limited' | 'network_error' | 'server_error' | 'not_configured' | 'permission_denied' | 'invalid_endpoint' | 'unknown';
  message: string;
  details?: string;
  retryable: boolean;
}

interface AppDetailDialogProps {
  app: AppMetadata | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnectionChange?: (appId: string, connected: boolean) => void;
}

const CONNECTION_REQUEST_TIMEOUT_MS = 8_000;
const SAFE_APP_ORIGINS = [
  typeof window === "undefined" ? "" : window.location.origin,
  "https://accounts.google.com",
  "https://login.microsoftonline.com",
  "https://github.com",
  "https://www.figma.com",
  "https://api.notion.com",
  "https://slack.com",
].filter((origin): origin is string => Boolean(origin));

const ALLOWED_APP_ID_PREFIX = "app-";

function parseErrorResponse(error: any, responseData?: any): ConnectionError {
  const errorMessage = error?.message || responseData?.message || responseData?.error || 'Error desconocido';
  const errorDetails = responseData?.details || error?.details;

  if (errorMessage.includes('OAuth') || errorMessage.includes('oauth') || errorMessage.includes('denied') || errorMessage.includes('access_denied')) {
    return {
      type: 'oauth_denied',
      message: 'Acceso denegado',
      details: 'Se rechazó la autorización de acceso. Asegúrate de permitir los permisos solicitados.',
      retryable: true
    };
  }

  if (errorMessage.includes('expired') || errorMessage.includes('token') || errorMessage.includes('invalid_grant')) {
    return {
      type: 'token_expired',
      message: 'Sesión expirada',
      details: 'Tu sesión ha expirado. Por favor, vuelve a conectar la aplicación.',
      retryable: true
    };
  }

  if (errorMessage.includes('rate') || errorMessage.includes('limit') || errorMessage.includes('429') || errorMessage.includes('too many')) {
    return {
      type: 'rate_limited',
      message: 'Límite de solicitudes alcanzado',
      details: 'Has realizado demasiadas solicitudes. Por favor, espera unos minutos e intenta de nuevo.',
      retryable: true
    };
  }

  if (errorMessage.includes('network') || errorMessage.includes('fetch') || errorMessage.includes('ECONNREFUSED') || error?.name === 'TypeError') {
    return {
      type: 'network_error',
      message: 'Error de conexión',
      details: 'No se pudo establecer conexión con el servidor. Verifica tu conexión a internet.',
      retryable: true
    };
  }

  if (errorMessage.includes('not configured') || errorMessage.includes('no está configurado') || errorMessage.includes('integraciones')) {
    return {
      type: 'not_configured',
      message: 'Integración no configurada',
      details: 'Esta aplicación necesita ser configurada a través del panel de integraciones de Replit.',
      retryable: false
    };
  }

  if (errorMessage.includes('invalid endpoint') || errorMessage.includes('Cross-origin') || errorMessage.includes('cross-origin')) {
    return {
      type: 'invalid_endpoint',
      message: 'Endpoint inválido',
      details: 'El endpoint configurado no es seguro o no pertenece al origen permitido.',
      retryable: false
    };
  }

  if (errorMessage.includes('permission') || errorMessage.includes('forbidden') || errorMessage.includes('403')) {
    return {
      type: 'permission_denied',
      message: 'Permisos insuficientes',
      details: 'No tienes los permisos necesarios para acceder a esta aplicación.',
      retryable: false
    };
  }

  if (errorMessage.includes('500') || errorMessage.includes('server') || errorMessage.includes('internal')) {
    return {
      type: 'server_error',
      message: 'Error del servidor',
      details: 'El servidor encontró un error. Por favor, intenta de nuevo más tarde.',
      retryable: true
    };
  }

  return {
    type: 'unknown',
    message: errorMessage || 'Error al conectar',
    details: errorDetails || 'Ocurrió un error inesperado. Por favor, intenta de nuevo.',
    retryable: true
  };
}

function getErrorIcon(errorType: ConnectionError['type']) {
  switch (errorType) {
    case 'oauth_denied':
      return <Ban className="h-5 w-5 text-red-500" />;
    case 'token_expired':
      return <Clock className="h-5 w-5 text-amber-500" />;
    case 'rate_limited':
      return <Clock className="h-5 w-5 text-amber-500" />;
    case 'network_error':
      return <WifiOff className="h-5 w-5 text-red-500" />;
    case 'permission_denied':
      return <Ban className="h-5 w-5 text-red-500" />;
    default:
      return <AlertCircle className="h-5 w-5 text-red-500" />;
  }
}

function createTimeoutController(timeoutMs: number): AbortController {
  const controller = new AbortController();
  window.setTimeout(() => {
    controller.abort(new DOMException("Request timeout", "TimeoutError"));
  }, timeoutMs);
  return controller;
}

function resolveSafeAppEndpoint(endpoint: string): string {
  if (typeof window === "undefined") {
    throw new Error("invalid endpoint");
  }
  const parsedUrl = new URL(endpoint, window.location.origin);
  if (!SAFE_APP_ORIGINS.includes(parsedUrl.origin)) {
    throw new Error("invalid endpoint");
  }
  return parsedUrl.toString();
}

function resolveSameOriginAppEndpoint(endpoint: string): string {
  if (typeof window === "undefined") {
    throw new Error("invalid endpoint");
  }
  const parsedUrl = new URL(endpoint, window.location.origin);
  if (parsedUrl.origin !== window.location.origin) {
    throw new Error("invalid endpoint");
  }
  return parsedUrl.toString();
}

function resolveRelativeEndpoint(endpoint: string): string {
  if (typeof window === "undefined") {
    throw new Error("invalid endpoint");
  }
  const parsedUrl = new URL(endpoint, window.location.origin);
  if (parsedUrl.origin !== window.location.origin) {
    throw new Error("invalid endpoint");
  }
  if (!parsedUrl.pathname.startsWith("/")) {
    throw new Error("invalid endpoint");
  }
  return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
}

function buildRequestId(): string {
  const random = Math.random().toString(36).slice(2, 12);
  const now = Date.now().toString(36);
  return `${ALLOWED_APP_ID_PREFIX}${now}-${random}`;
}

export function AppDetailDialog({
  app,
  open,
  onOpenChange,
  onConnectionChange
}: AppDetailDialogProps) {
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionEmail, setConnectionEmail] = useState<string>("");
  const [connectionError, setConnectionError] = useState<ConnectionError | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const checkConnectionStatus = useCallback(async () => {
    if (!app?.statusEndpoint) return;

    setIsLoading(true);
    setConnectionError(null);

    try {
      const resolvedStatusEndpoint = resolveSameOriginAppEndpoint(app.statusEndpoint);
      const controller = createTimeoutController(CONNECTION_REQUEST_TIMEOUT_MS);
      const res = await apiFetch(resolvedStatusEndpoint, { signal: controller.signal });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setIsConnected(data.connected === true);
        setConnectionEmail(typeof data?.email === "string" ? data.email : "");

        queryClient.invalidateQueries({ queryKey: ["connected-sources"] });

        if (data.connected && retryCount > 0) {
          toast.success(`${app.name} conectado`, {
            description: data.email ? `Conectado como ${data.email}` : 'Conexión establecida correctamente'
          });
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        const error = parseErrorResponse(new Error(`HTTP ${res.status}`), errorData);
        setConnectionError(error);
        setIsConnected(false);
      }
    } catch (error: any) {
      console.error("Error checking connection:", error);
      const parsedError = parseErrorResponse(error);
      setConnectionError(parsedError);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  }, [app?.id, app?.statusEndpoint, app?.name, queryClient, retryCount]);

  useEffect(() => {
    if (open && app?.statusEndpoint) {
      checkConnectionStatus();
    } else if (open && !app?.statusEndpoint) {
      setIsLoading(false);
      setIsConnected(false);
    }
  }, [open, app?.id, checkConnectionStatus]);

  const handleConnect = async () => {
    if (!app?.connectionEndpoint) {
      toast.error('Error de configuración', {
        description: 'Esta aplicación no tiene un endpoint de conexión configurado.'
      });
      return;
    }

    setIsConnecting(true);
    setConnectionError(null);

    const requestId = buildRequestId();

    // First check if user is authenticated
    try {
      const controller = createTimeoutController(CONNECTION_REQUEST_TIMEOUT_MS);
      const authRes = await apiFetch('/api/auth/user', {
        headers: {
          "X-Request-Id": requestId,
          "X-Idempotency-Key": requestId,
        },
        signal: controller.signal,
      });
      if (!authRes.ok) {
        setIsConnecting(false);
        toast.dismiss('connect-toast');
        setConnectionError({
          type: 'oauth_denied',
          message: 'Inicia sesión primero',
          details: 'Para conectar esta aplicación, primero debes iniciar sesión con tu cuenta de Replit usando el botón "Iniciar sesión" en la esquina superior derecha.',
          retryable: false
        });
        return;
      }
    } catch (e) {
      // Network error, try to connect anyway
    }

    toast.loading(`Conectando con ${app.name}...`, { id: 'connect-toast' });

    const endpoint = app.connectionEndpoint.trim();

    // Internal stub connectors: connect via API (POST) instead of browser redirect.
    try {
      const relative = resolveRelativeEndpoint(endpoint);
      const parsed = new URL(relative, window.location.origin);

      if (parsed.pathname.startsWith("/api/apps/") && parsed.pathname.endsWith("/connect")) {
        try {
          const resolvedConnectEndpoint = resolveSameOriginAppEndpoint(relative);
          const controller = createTimeoutController(CONNECTION_REQUEST_TIMEOUT_MS);
          const res = await apiFetch(resolvedConnectEndpoint, {
            method: "POST",
            signal: controller.signal,
            headers: {
              "X-Request-Id": requestId,
              "X-Idempotency-Key": requestId,
            },
          });
          const data = await res.json().catch(() => ({}));

          if (!res.ok) {
            const error = parseErrorResponse(new Error(`HTTP ${res.status}`), data);
            setConnectionError(error);
            toast.dismiss("connect-toast");
            toast.error("Error al conectar", { description: error.message });
            return;
          }

          toast.dismiss("connect-toast");
          setIsConnected(true);
          onConnectionChange?.(app.id, true);
          await checkConnectionStatus();
          toast.success(`${app.name} conectado`, {
            description: "Conexión establecida correctamente",
          });
        } catch (error: any) {
          console.error("Error connecting:", error);
          const parsedError = parseErrorResponse(error);
          setConnectionError(parsedError);
          toast.dismiss("connect-toast");
          toast.error("Error al conectar", { description: parsedError.message });
        } finally {
          setIsConnecting(false);
        }
        return;
      }
    } catch {
      // Not a relative safe URL; fall through to redirect flow below.
    }

    // Redirect-based connection (OAuth, etc.)
    // FRONTEND FIX #7: Validate connection endpoint URL before redirect
    try {
      const safeEndpoint = resolveSafeAppEndpoint(endpoint);
      window.location.href = safeEndpoint;
    } catch (e) {
      // If it's a safe relative URL, allow it
      try {
        const safeEndpoint = resolveRelativeEndpoint(endpoint);
        window.location.href = safeEndpoint;
      } catch {
        const parsedError = parseErrorResponse(new Error("invalid endpoint"));
        console.error('[Security] Invalid connection endpoint:', endpoint);
        toast.dismiss('connect-toast');
        setConnectionError(parsedError);
        setIsConnecting(false);
      }
    }
  };

  const handleDisconnect = async () => {
    if (!app?.disconnectEndpoint) {
      toast.error('Error de configuración', {
        description: 'Esta aplicación no tiene un endpoint de desconexión configurado.'
      });
      return;
    }

    setIsConnecting(true);
    setConnectionError(null);

    try {
      const requestId = buildRequestId();
      const resolvedDisconnectEndpoint = resolveSafeAppEndpoint(app.disconnectEndpoint);
      const controller = createTimeoutController(CONNECTION_REQUEST_TIMEOUT_MS);
      const res = await apiFetch(resolvedDisconnectEndpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "X-Request-Id": requestId,
          "X-Idempotency-Key": requestId,
        },
      });

      if (res.ok) {
        const data = await res.json();

        if (data.disconnectUrl) {
          toast.info('Redirigiéndote para completar la desconexión...', {
            duration: 3000
          });
          // FRONTEND FIX #40: Add noopener,noreferrer to prevent window.opener attacks
          window.open(data.disconnectUrl, '_blank', 'noopener,noreferrer');
        }

        setIsConnected(false);
        setConnectionEmail("");
        onConnectionChange?.(app.id, false);

        queryClient.invalidateQueries({ queryKey: ["connected-sources"] });

        toast.success(`${app.name} desconectado`, {
          description: 'La aplicación ha sido desconectada correctamente.'
        });
      } else {
        const errorData = await res.json().catch(() => ({}));
        const error = parseErrorResponse(new Error(`HTTP ${res.status}`), errorData);
        setConnectionError(error);

        toast.error('Error al desconectar', {
          description: error.message
        });
      }
    } catch (error: any) {
      console.error("Error disconnecting:", error);
      const parsedError = parseErrorResponse(error);
      setConnectionError(parsedError);

      toast.error('Error al desconectar', {
        description: parsedError.message
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleRetry = () => {
    setRetryCount(prev => prev + 1);
    setConnectionError(null);
    checkConnectionStatus();
  };

  if (!app) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0" aria-describedby="app-dialog-description">
        <DialogHeader className="p-4 pb-0">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
            <button
              onClick={() => onOpenChange(false)}
              className="hover:text-foreground transition-colors flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-sm"
              aria-label="Go back to applications"
              data-testid="button-back-apps"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Aplicaciones
            </button>
            <span>/</span>
            <span>{app.name}</span>
          </div>
          <DialogDescription id="app-dialog-description" className="sr-only">
            Details and connection settings for {app.name}. {app.shortDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6">
          <div className="flex items-start gap-4 mb-6">
            <div className="flex-shrink-0 w-20 h-20 rounded-3xl overflow-hidden flex items-center justify-center bg-gradient-to-br from-[#A5A0FF]/10 to-transparent border border-[#A5A0FF]/20 shadow-lg shadow-[#A5A0FF]/5">
              {app.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <DialogTitle className="text-xl font-semibold">{app.name}</DialogTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    {app.shortDescription}
                  </p>
                </div>
                <Button
                  onClick={isConnected ? handleDisconnect : handleConnect}
                  disabled={isLoading || isConnecting || !app.connectionEndpoint}
                  variant={isConnected ? "outline" : "default"}
                  className={cn(
                    "min-w-[140px] rounded-full font-medium transition-all duration-300",
                    !isConnected && !isLoading && !isConnecting && "bg-foreground hover:bg-foreground/90 shadow-md shadow-[#A5A0FF]/20 hover:shadow-lg hover:shadow-[#A5A0FF]/30",
                    isConnected && "border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 hover:text-red-700"
                  )}
                  data-testid={`button-${isConnected ? 'disconnect' : 'connect'}-${app.id}`}
                >
                  {isLoading || isConnecting ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>{isConnected ? "Desconectando..." : "Conectando..."}</span>
                    </div>
                  ) : isConnected ? (
                    "Desconectar"
                  ) : (
                    "Conectar aplicación"
                  )}
                </Button>
              </div>
            </div>
          </div>

          {connectionError && (
            <div
              className={cn(
                "mb-6 p-4 rounded-lg border",
                connectionError.type === 'rate_limited' || connectionError.type === 'token_expired'
                  ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"
                  : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
              )}
              data-testid={`error-container-${app.id}`}
            >
              <div className="flex items-start gap-3">
                {getErrorIcon(connectionError.type)}
                <div className="flex-1 min-w-0">
                  <h4 className={cn(
                    "text-sm font-medium",
                    connectionError.type === 'rate_limited' || connectionError.type === 'token_expired'
                      ? "text-amber-800 dark:text-amber-300"
                      : "text-red-800 dark:text-red-300"
                  )}>
                    {connectionError.message}
                  </h4>
                  {connectionError.details && (
                    <p className={cn(
                      "text-sm mt-1",
                      connectionError.type === 'rate_limited' || connectionError.type === 'token_expired'
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-red-700 dark:text-red-400"
                    )}>
                      {connectionError.details}
                    </p>
                  )}
                  {connectionError.retryable && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRetry}
                      className={cn(
                        "mt-3",
                        connectionError.type === 'rate_limited' || connectionError.type === 'token_expired'
                          ? "border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/40"
                          : "border-red-300 text-red-700 hover:bg-red-100 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/40"
                      )}
                      data-testid={`button-retry-${app.id}`}
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Reintentar
                    </Button>
                  )}
                </div>
                <button
                  onClick={() => setConnectionError(null)}
                  className={cn(
                    "p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                    connectionError.type === 'rate_limited' || connectionError.type === 'token_expired'
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-red-600 dark:text-red-400"
                  )}
                  aria-label="Dismiss error message"
                  data-testid={`button-dismiss-error-${app.id}`}
                >
                  <XCircle className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          {isConnected && connectionEmail && (
            <div className="mb-6 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800" role="status" aria-live="polite">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500" aria-hidden="true"></div>
                <span className="text-sm text-green-700 dark:text-green-400">
                  Conectado como <strong>{connectionEmail}</strong>
                </span>
              </div>
            </div>
          )}

          {isConnected && !connectionEmail && (
            <div className="mb-6 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800" role="status" aria-live="polite">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500" aria-hidden="true"></div>
                <span className="text-sm text-green-700 dark:text-green-400">
                  Conectado correctamente
                </span>
              </div>
            </div>
          )}

          <p className="text-sm text-muted-foreground mb-6">
            {app.longDescription || app.shortDescription}
          </p>

          <div className="border-t pt-4">
            <h3 className="font-medium mb-4">Información</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Categoría</span>
                <span className="font-medium capitalize">{app.category}</span>
              </div>

              {app.developer && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Desarrollador</span>
                  <span className="font-medium">{app.developer}</span>
                </div>
              )}

              {app.websiteUrl && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Sitio web</span>
                  <a
                    href={app.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-sm"
                    aria-label={`Visit ${app.name} website (opens in new tab)`}
                    data-testid={`link-website-${app.id}`}
                  >
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                </div>
              )}

              {app.privacyUrl && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Política de privacidad</span>
                  <a
                    href={app.privacyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-sm"
                    aria-label={`${app.name} privacy policy (opens in new tab)`}
                    data-testid={`link-privacy-${app.id}`}
                  >
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                </div>
              )}

              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Estado</span>
                {isLoading ? (
                  <Skeleton className="h-4 w-20" />
                ) : (
                  <span className={cn(
                    "font-medium",
                    isConnected ? "text-green-600 dark:text-green-400" :
                      connectionError ? "text-red-600 dark:text-red-400" :
                        "text-muted-foreground"
                  )}>
                    {isConnected ? "Conectado" :
                      connectionError ? "Error" :
                        "No conectado"}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
