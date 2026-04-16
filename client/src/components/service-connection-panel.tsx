import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Mail,
  Calendar,
  FileText,
  MessageSquare,
  Github,
  PenTool,
  MessageCircle,
  Zap,
  ChevronRight,
  Link2,
  Unlink,
  ArrowRight,
  RefreshCw,
  AlertCircle,
  Settings,
} from "lucide-react";
import {
  useServiceConnections,
  SERVICE_CATALOG,
  CATEGORY_LABELS,
  type ServiceDefinition,
  type ServiceCategory,
} from "@/hooks/use-service-connections";
import { ServiceConnectionWizard } from "@/components/service-connection-wizard";

// ─── Icon mapping ────────────────────────────────────────────────────
const SERVICE_ICONS: Record<string, React.ReactNode> = {
  mail: <Mail className="h-4 w-4" />,
  calendar: <Calendar className="h-4 w-4" />,
  "file-text": <FileText className="h-4 w-4" />,
  "message-square": <MessageSquare className="h-4 w-4" />,
  github: <Github className="h-4 w-4" />,
  "pen-tool": <PenTool className="h-4 w-4" />,
  "message-circle": <MessageCircle className="h-4 w-4" />,
};

// ─── ServiceConnectionPanel ──────────────────────────────────────────
// Inline card shown in the profile page to display connected services
// and provide a button to open the connection wizard
export function ServiceConnectionPanel() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const {
    services,
    getConnectionStatus,
    connectService,
    disconnectService,
    connectingService,
    isConnecting,
    isDisconnecting,
    connectedCount,
    totalServices,
    isLoading,
    isError,
    refetch,
  } = useServiceConnections();

  const connectedServices = services.filter(
    (s) => getConnectionStatus(s.id).connected
  );
  const notConnectedServices = services.filter(
    (s) => !getConnectionStatus(s.id).connected
  );

  // Show recommended services (first 3 not connected)
  const recommended = notConnectedServices.slice(0, 3);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 py-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Cargando servicios...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Connected services list */}
      {connectedServices.length > 0 ? (
        <>
          {connectedServices.map((service, i) => {
            const status = getConnectionStatus(service.id);
            return (
              <div key={service.id}>
                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center bg-green-100 dark:bg-green-900/30 text-green-600"
                      style={{ color: service.color }}
                    >
                      {SERVICE_ICONS[service.icon] || (
                        <Zap className="h-4 w-4" />
                      )}
                    </div>
                    <div>
                      <span className="font-medium text-sm">
                        {service.name}
                      </span>
                      {status.email && (
                        <p className="text-xs text-muted-foreground">
                          {status.email}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px] px-1.5"
                    >
                      <CheckCircle2 className="h-3 w-3 mr-0.5" />
                      Conectado
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-red-500"
                      onClick={() => disconnectService(service.id)}
                      disabled={isDisconnecting}
                      data-testid={`button-disconnect-inline-${service.id}`}
                    >
                      <Unlink className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {i < connectedServices.length - 1 && <Separator />}
              </div>
            );
          })}
        </>
      ) : (
        <div className="text-center py-4 space-y-2">
          <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center mx-auto">
            <Link2 className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">
            No tienes servicios conectados
          </p>
          <p className="text-xs text-muted-foreground">
            Conecta Gmail, Calendar, Outlook y más
          </p>
        </div>
      )}

      {/* Expandable: show not connected services */}
      {notConnectedServices.length > 0 && connectedServices.length > 0 && (
        <>
          <Separator />
          <button
            className="w-full flex items-center justify-between py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setExpanded(!expanded)}
            data-testid="button-expand-services"
          >
            <span>
              {notConnectedServices.length} servicio
              {notConnectedServices.length > 1 ? "s" : ""} disponible
              {notConnectedServices.length > 1 ? "s" : ""}
            </span>
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                expanded && "rotate-90"
              )}
            />
          </button>

          {expanded && (
            <div className="space-y-1.5 pt-1">
              {notConnectedServices.map((service) => (
                <div
                  key={service.id}
                  className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-7 h-7 rounded-md flex items-center justify-center bg-muted text-muted-foreground"
                    >
                      {SERVICE_ICONS[service.icon] || (
                        <Zap className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <span className="text-sm">{service.name}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => connectService(service.id)}
                    disabled={
                      connectingService === service.id || isConnecting
                    }
                    data-testid={`button-quick-connect-${service.id}`}
                  >
                    {connectingService === service.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <>
                        <Link2 className="h-3 w-3" />
                        Conectar
                      </>
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Main action button */}
      <Separator />
      <Button
        variant="default"
        className="w-full gap-2"
        onClick={() => setWizardOpen(true)}
        data-testid="button-connect-services-profile"
      >
        <Zap className="h-4 w-4" />
        {connectedServices.length > 0
          ? "Gestionar servicios"
          : "Conectar servicios"}
        <ArrowRight className="h-4 w-4 ml-auto" />
      </Button>

      {/* Connection stats */}
      {connectedCount > 0 && (
        <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3 w-3 text-green-600" />
          <span>
            {connectedCount} de {totalServices} servicios conectados
          </span>
        </div>
      )}

      {/* Wizard dialog */}
      <ServiceConnectionWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
      />
    </div>
  );
}
