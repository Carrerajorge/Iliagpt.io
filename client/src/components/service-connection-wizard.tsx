import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ArrowRight,
  Check,
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
  Shield,
  X,
  AlertCircle,
  RefreshCw,
  Link2,
  Unlink,
} from "lucide-react";
import {
  useServiceConnections,
  SERVICE_CATALOG,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type ServiceDefinition,
  type ServiceCategory,
} from "@/hooks/use-service-connections";

// ─── Icon mapping ────────────────────────────────────────────────────
const SERVICE_ICONS: Record<string, React.ReactNode> = {
  mail: <Mail className="h-5 w-5" />,
  calendar: <Calendar className="h-5 w-5" />,
  "file-text": <FileText className="h-5 w-5" />,
  "message-square": <MessageSquare className="h-5 w-5" />,
  github: <Github className="h-5 w-5" />,
  "pen-tool": <PenTool className="h-5 w-5" />,
  "message-circle": <MessageCircle className="h-5 w-5" />,
};

const SERVICE_ICONS_LARGE: Record<string, React.ReactNode> = {
  mail: <Mail className="h-8 w-8" />,
  calendar: <Calendar className="h-8 w-8" />,
  "file-text": <FileText className="h-8 w-8" />,
  "message-square": <MessageSquare className="h-8 w-8" />,
  github: <Github className="h-8 w-8" />,
  "pen-tool": <PenTool className="h-8 w-8" />,
  "message-circle": <MessageCircle className="h-8 w-8" />,
};

const CATEGORY_ICONS: Record<ServiceCategory, React.ReactNode> = {
  email: <Mail className="h-4 w-4" />,
  calendar: <Calendar className="h-4 w-4" />,
  productivity: <FileText className="h-4 w-4" />,
  communication: <MessageSquare className="h-4 w-4" />,
  design: <PenTool className="h-4 w-4" />,
  development: <Github className="h-4 w-4" />,
};

// ─── Steps ───────────────────────────────────────────────────────────
type WizardStep = "overview" | "select" | "connect" | "done";

const STEPS: { id: WizardStep; label: string }[] = [
  { id: "overview", label: "Inicio" },
  { id: "select", label: "Seleccionar" },
  { id: "connect", label: "Conectar" },
  { id: "done", label: "Listo" },
];

// ─── Props ───────────────────────────────────────────────────────────
interface ServiceConnectionWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ─── Main component ──────────────────────────────────────────────────
export function ServiceConnectionWizard({
  open,
  onOpenChange,
}: ServiceConnectionWizardProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>("overview");
  const [selectedServices, setSelectedServices] = useState<Set<string>>(
    new Set()
  );
  const [connectingQueue, setConnectingQueue] = useState<string[]>([]);
  const [currentlyConnecting, setCurrentlyConnecting] = useState<string | null>(
    null
  );
  const [connectedInSession, setConnectedInSession] = useState<Set<string>>(
    new Set()
  );
  const [filterCategory, setFilterCategory] = useState<
    ServiceCategory | "all"
  >("all");

  const {
    getConnectionStatus,
    connectService,
    disconnectService,
    connectingService,
    isLoading,
    connectedCount,
    totalServices,
    refetch,
  } = useServiceConnections();

  // ─── Handlers ──────────────────────────────────────────────────────
  const handleClose = () => {
    onOpenChange(false);
    // Reset state after animation
    setTimeout(() => {
      setCurrentStep("overview");
      setSelectedServices(new Set());
      setConnectingQueue([]);
      setCurrentlyConnecting(null);
      setConnectedInSession(new Set());
      setFilterCategory("all");
    }, 300);
  };

  const toggleService = (serviceId: string) => {
    setSelectedServices((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) {
        next.delete(serviceId);
      } else {
        next.add(serviceId);
      }
      return next;
    });
  };

  const handleNext = () => {
    switch (currentStep) {
      case "overview":
        setCurrentStep("select");
        break;
      case "select":
        if (selectedServices.size > 0) {
          setConnectingQueue(Array.from(selectedServices));
          setCurrentStep("connect");
          // Start connecting the first service
          startConnecting(Array.from(selectedServices));
        }
        break;
      case "connect":
        setCurrentStep("done");
        break;
      case "done":
        handleClose();
        break;
    }
  };

  const handleBack = () => {
    switch (currentStep) {
      case "select":
        setCurrentStep("overview");
        break;
      case "connect":
        setCurrentStep("select");
        break;
      case "done":
        setCurrentStep("connect");
        break;
    }
  };

  const startConnecting = async (queue: string[]) => {
    for (const serviceId of queue) {
      const status = getConnectionStatus(serviceId);
      if (status.connected) {
        setConnectedInSession((prev) => new Set(prev).add(serviceId));
        continue;
      }

      setCurrentlyConnecting(serviceId);
      try {
        await connectService(serviceId);
        setConnectedInSession((prev) => new Set(prev).add(serviceId));
      } catch {
        // Error already handled by the hook
      }
      setCurrentlyConnecting(null);
    }
  };

  const handleQuickConnect = async (serviceId: string) => {
    const status = getConnectionStatus(serviceId);
    if (status.connected) {
      disconnectService(serviceId);
    } else {
      await connectService(serviceId);
      refetch();
    }
  };

  // ─── Filtered services ────────────────────────────────────────────
  const filteredServices = useMemo(() => {
    if (filterCategory === "all") return SERVICE_CATALOG;
    return SERVICE_CATALOG.filter((s) => s.category === filterCategory);
  }, [filterCategory]);

  const alreadyConnectedServices = useMemo(
    () =>
      SERVICE_CATALOG.filter((s) => getConnectionStatus(s.id).connected),
    [getConnectionStatus]
  );

  const notConnectedServices = useMemo(
    () =>
      filteredServices.filter((s) => !getConnectionStatus(s.id).connected),
    [filteredServices, getConnectionStatus]
  );

  // ─── Step indicator ────────────────────────────────────────────────
  const stepIndex = STEPS.findIndex((s) => s.id === currentStep);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] p-0 gap-0 overflow-hidden"
        data-testid="dialog-service-wizard"
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b bg-gradient-to-br from-card to-muted/30">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              Conectar servicios
            </DialogTitle>
            <DialogDescription>
              Integra tus servicios favoritos para potenciar tu experiencia
            </DialogDescription>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-2 mt-4">
            {STEPS.map((step, i) => (
              <div key={step.id} className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors",
                    i === stepIndex
                      ? "bg-primary text-primary-foreground"
                      : i < stepIndex
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                  )}
                >
                  {i < stepIndex ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <span>{i + 1}</span>
                  )}
                  <span className="hidden sm:inline">{step.label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={cn(
                      "w-8 h-0.5 rounded-full",
                      i < stepIndex ? "bg-primary" : "bg-muted"
                    )}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1 max-h-[60vh]">
          <div className="p-6">
            {currentStep === "overview" && (
              <OverviewStep
                connectedCount={connectedCount}
                totalServices={totalServices}
                connectedServices={alreadyConnectedServices}
                getConnectionStatus={getConnectionStatus}
              />
            )}

            {currentStep === "select" && (
              <SelectStep
                services={filteredServices}
                selectedServices={selectedServices}
                toggleService={toggleService}
                getConnectionStatus={getConnectionStatus}
                filterCategory={filterCategory}
                setFilterCategory={setFilterCategory}
                notConnectedServices={notConnectedServices}
              />
            )}

            {currentStep === "connect" && (
              <ConnectStep
                selectedServices={Array.from(selectedServices)}
                currentlyConnecting={currentlyConnecting || connectingService}
                connectedInSession={connectedInSession}
                getConnectionStatus={getConnectionStatus}
              />
            )}

            {currentStep === "done" && (
              <DoneStep
                connectedInSession={connectedInSession}
                selectedServices={Array.from(selectedServices)}
                getConnectionStatus={getConnectionStatus}
              />
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-muted/30 flex items-center justify-between">
          <div>
            {currentStep !== "overview" && currentStep !== "done" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                data-testid="button-wizard-back"
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Atrás
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleClose}
              data-testid="button-wizard-cancel"
            >
              {currentStep === "done" ? "Cerrar" : "Cancelar"}
            </Button>

            {currentStep !== "done" && (
              <Button
                size="sm"
                onClick={handleNext}
                disabled={
                  currentStep === "select" && selectedServices.size === 0
                }
                data-testid="button-wizard-next"
              >
                {currentStep === "overview" && (
                  <>
                    Siguiente
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </>
                )}
                {currentStep === "select" && (
                  <>
                    <Link2 className="h-4 w-4 mr-1" />
                    Conectar {selectedServices.size > 0 ? `(${selectedServices.size})` : ""}
                  </>
                )}
                {currentStep === "connect" && (
                  <>
                    Continuar
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </>
                )}
              </Button>
            )}

            {currentStep === "done" && (
              <Button
                size="sm"
                onClick={handleClose}
                data-testid="button-wizard-done"
              >
                <Check className="h-4 w-4 mr-1" />
                Finalizar
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Step: Overview ──────────────────────────────────────────────────
function OverviewStep({
  connectedCount,
  totalServices,
  connectedServices,
  getConnectionStatus,
}: {
  connectedCount: number;
  totalServices: number;
  connectedServices: ServiceDefinition[];
  getConnectionStatus: (id: string) => { connected: boolean; email?: string };
}) {
  return (
    <div className="space-y-6">
      {/* Hero section */}
      <div className="text-center space-y-3">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mx-auto">
          <Zap className="h-8 w-8 text-primary" />
        </div>
        <h3 className="text-lg font-semibold">
          Potencia tu productividad
        </h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Conecta tus servicios favoritos para acceder a ellos directamente
          desde iliagpt. Gestiona correos, calendario, mensajes y más sin
          cambiar de aplicación.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center p-3 rounded-lg bg-muted/50">
          <div className="text-2xl font-bold text-primary">{connectedCount}</div>
          <div className="text-xs text-muted-foreground">Conectados</div>
        </div>
        <div className="text-center p-3 rounded-lg bg-muted/50">
          <div className="text-2xl font-bold">{totalServices}</div>
          <div className="text-xs text-muted-foreground">Disponibles</div>
        </div>
        <div className="text-center p-3 rounded-lg bg-muted/50">
          <div className="text-2xl font-bold text-green-600">
            {totalServices - connectedCount}
          </div>
          <div className="text-xs text-muted-foreground">Por conectar</div>
        </div>
      </div>

      {/* Benefits */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium">Beneficios de conectar servicios</h4>
        <div className="grid gap-2">
          {[
            {
              icon: <Mail className="h-4 w-4" />,
              title: "Correo integrado",
              desc: "Lee y envía correos de Gmail y Outlook sin salir",
            },
            {
              icon: <Calendar className="h-4 w-4" />,
              title: "Calendario sincronizado",
              desc: "Ve tus eventos y crea reuniones automáticamente",
            },
            {
              icon: <Shield className="h-4 w-4" />,
              title: "Seguro y privado",
              desc: "Tus datos están protegidos con OAuth 2.0",
            },
          ].map((benefit) => (
            <div
              key={benefit.title}
              className="flex items-start gap-3 p-3 rounded-lg border bg-card"
            >
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                {benefit.icon}
              </div>
              <div>
                <div className="text-sm font-medium">{benefit.title}</div>
                <div className="text-xs text-muted-foreground">
                  {benefit.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Already connected */}
      {connectedServices.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            Servicios ya conectados
          </h4>
          <div className="flex flex-wrap gap-2">
            {connectedServices.map((service) => {
              const status = getConnectionStatus(service.id);
              return (
                <Badge
                  key={service.id}
                  variant="secondary"
                  className="gap-1.5 py-1 px-2.5"
                >
                  <CheckCircle2 className="h-3 w-3 text-green-600" />
                  {service.name}
                  {status.email && (
                    <span className="text-muted-foreground">
                      ({status.email})
                    </span>
                  )}
                </Badge>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step: Select ────────────────────────────────────────────────────
function SelectStep({
  services,
  selectedServices,
  toggleService,
  getConnectionStatus,
  filterCategory,
  setFilterCategory,
  notConnectedServices,
}: {
  services: ServiceDefinition[];
  selectedServices: Set<string>;
  toggleService: (id: string) => void;
  getConnectionStatus: (id: string) => { connected: boolean; email?: string };
  filterCategory: ServiceCategory | "all";
  setFilterCategory: (c: ServiceCategory | "all") => void;
  notConnectedServices: ServiceDefinition[];
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Selecciona los servicios</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Elige los servicios que deseas conectar. Puedes conectar más después.
        </p>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-1.5">
        <Button
          variant={filterCategory === "all" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 text-xs"
          onClick={() => setFilterCategory("all")}
          data-testid="filter-all"
        >
          Todos
        </Button>
        {CATEGORY_ORDER.map((cat) => (
          <Button
            key={cat}
            variant={filterCategory === cat ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setFilterCategory(cat)}
            data-testid={`filter-${cat}`}
          >
            {CATEGORY_ICONS[cat]}
            {CATEGORY_LABELS[cat]}
          </Button>
        ))}
      </div>

      <Separator />

      {/* Select all / deselect all */}
      {notConnectedServices.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {selectedServices.size} seleccionados de{" "}
            {notConnectedServices.length} disponibles
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              if (selectedServices.size === notConnectedServices.length) {
                // Deselect all
                for (const s of notConnectedServices) {
                  if (selectedServices.has(s.id)) toggleService(s.id);
                }
              } else {
                // Select all not connected
                for (const s of notConnectedServices) {
                  if (!selectedServices.has(s.id)) toggleService(s.id);
                }
              }
            }}
            data-testid="button-select-all"
          >
            {selectedServices.size === notConnectedServices.length
              ? "Deseleccionar todos"
              : "Seleccionar todos"}
          </Button>
        </div>
      )}

      {/* Service list */}
      <div className="space-y-2">
        {services.map((service) => {
          const status = getConnectionStatus(service.id);
          const isSelected = selectedServices.has(service.id);

          return (
            <button
              key={service.id}
              className={cn(
                "w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left",
                status.connected
                  ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800 opacity-70 cursor-default"
                  : isSelected
                    ? "bg-primary/5 border-primary/30 ring-1 ring-primary/20"
                    : "bg-card hover:bg-muted/50 border-border"
              )}
              onClick={() => {
                if (!status.connected) toggleService(service.id);
              }}
              disabled={status.connected}
              data-testid={`service-select-${service.id}`}
            >
              {/* Icon */}
              <div
                className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                  status.connected
                    ? "bg-green-100 dark:bg-green-900/40 text-green-600"
                    : isSelected
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                )}
                style={
                  !status.connected && !isSelected
                    ? { color: service.color }
                    : undefined
                }
              >
                {SERVICE_ICONS[service.icon] || <Zap className="h-5 w-5" />}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{service.name}</span>
                  {status.connected && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                    >
                      Conectado
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {service.description}
                </p>
              </div>

              {/* Checkbox area */}
              <div className="shrink-0">
                {status.connected ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                ) : (
                  <div
                    className={cn(
                      "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors",
                      isSelected
                        ? "bg-primary border-primary"
                        : "border-muted-foreground/30"
                    )}
                  >
                    {isSelected && <Check className="h-3 w-3 text-white" />}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {services.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">
            No hay servicios disponibles en esta categoría
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Step: Connect ───────────────────────────────────────────────────
function ConnectStep({
  selectedServices,
  currentlyConnecting,
  connectedInSession,
  getConnectionStatus,
}: {
  selectedServices: string[];
  currentlyConnecting: string | null;
  connectedInSession: Set<string>;
  getConnectionStatus: (id: string) => { connected: boolean };
}) {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h3 className="text-base font-semibold">Conectando servicios</h3>
        <p className="text-sm text-muted-foreground">
          Estamos estableciendo la conexión con cada servicio seleccionado
        </p>
      </div>

      <div className="space-y-3">
        {selectedServices.map((serviceId) => {
          const service = SERVICE_CATALOG.find((s) => s.id === serviceId);
          if (!service) return null;

          const status = getConnectionStatus(serviceId);
          const isConnecting = currentlyConnecting === serviceId;
          const isConnected =
            status.connected || connectedInSession.has(serviceId);
          const isPending =
            !isConnecting && !isConnected;

          return (
            <div
              key={serviceId}
              className={cn(
                "flex items-center gap-4 p-4 rounded-lg border transition-all",
                isConnected
                  ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800"
                  : isConnecting
                    ? "bg-primary/5 border-primary/20 ring-1 ring-primary/20"
                    : "bg-card border-border"
              )}
              data-testid={`connect-status-${serviceId}`}
            >
              {/* Icon */}
              <div
                className={cn(
                  "w-12 h-12 rounded-xl flex items-center justify-center",
                  isConnected
                    ? "bg-green-100 dark:bg-green-900/40 text-green-600"
                    : isConnecting
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                )}
              >
                {isConnecting ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : isConnected ? (
                  <CheckCircle2 className="h-6 w-6" />
                ) : (
                  SERVICE_ICONS_LARGE[service.icon] || (
                    <Zap className="h-6 w-6" />
                  )
                )}
              </div>

              {/* Info */}
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{service.name}</span>
                  {isConnected && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                    >
                      Conectado
                    </Badge>
                  )}
                  {isConnecting && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] bg-primary/10 text-primary"
                    >
                      Conectando...
                    </Badge>
                  )}
                  {isPending && (
                    <Badge variant="outline" className="text-[10px]">
                      Pendiente
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isConnecting
                    ? "Estableciendo conexión..."
                    : isConnected
                      ? "Conexión establecida correctamente"
                      : "Esperando turno de conexión"}
                </p>
              </div>

              {/* Status icon */}
              <div className="shrink-0">
                {isConnected && (
                  <Check className="h-5 w-5 text-green-600" />
                )}
                {isConnecting && (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Progreso</span>
          <span>
            {connectedInSession.size} / {selectedServices.length}
          </span>
        </div>
        <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{
              width: `${(connectedInSession.size / Math.max(selectedServices.length, 1)) * 100}%`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Step: Done ──────────────────────────────────────────────────────
function DoneStep({
  connectedInSession,
  selectedServices,
  getConnectionStatus,
}: {
  connectedInSession: Set<string>;
  selectedServices: string[];
  getConnectionStatus: (id: string) => { connected: boolean };
}) {
  const successCount = connectedInSession.size;
  const totalAttempted = selectedServices.length;

  return (
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <div
          className={cn(
            "w-16 h-16 rounded-2xl flex items-center justify-center mx-auto",
            successCount === totalAttempted
              ? "bg-green-100 dark:bg-green-900/30"
              : "bg-yellow-100 dark:bg-yellow-900/30"
          )}
        >
          {successCount === totalAttempted ? (
            <CheckCircle2 className="h-8 w-8 text-green-600" />
          ) : (
            <AlertCircle className="h-8 w-8 text-yellow-600" />
          )}
        </div>
        <h3 className="text-lg font-semibold">
          {successCount === totalAttempted
            ? "Todos los servicios conectados"
            : `${successCount} de ${totalAttempted} servicios conectados`}
        </h3>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          {successCount === totalAttempted
            ? "Tus servicios están listos. Puedes empezar a utilizarlos desde el chat."
            : "Algunos servicios no pudieron conectarse. Puedes intentar conectarlos más tarde desde Configuración."}
        </p>
      </div>

      {/* Connected services summary */}
      <div className="space-y-2">
        {selectedServices.map((serviceId) => {
          const service = SERVICE_CATALOG.find((s) => s.id === serviceId);
          if (!service) return null;

          const isConnected =
            getConnectionStatus(serviceId).connected ||
            connectedInSession.has(serviceId);

          return (
            <div
              key={serviceId}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg",
                isConnected
                  ? "bg-green-50 dark:bg-green-950/20"
                  : "bg-red-50 dark:bg-red-950/20"
              )}
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center",
                  isConnected
                    ? "bg-green-100 dark:bg-green-900/40 text-green-600"
                    : "bg-red-100 dark:bg-red-900/40 text-red-600"
                )}
              >
                {isConnected ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <X className="h-4 w-4" />
                )}
              </div>
              <span className="text-sm font-medium">{service.name}</span>
              <Badge
                variant="outline"
                className={cn(
                  "ml-auto text-[10px]",
                  isConnected
                    ? "border-green-300 text-green-700 dark:border-green-700 dark:text-green-400"
                    : "border-red-300 text-red-700 dark:border-red-700 dark:text-red-400"
                )}
              >
                {isConnected ? "Conectado" : "Error"}
              </Badge>
            </div>
          );
        })}
      </div>

      {/* Next steps */}
      <div className="p-4 rounded-lg border bg-muted/30 space-y-2">
        <h4 className="text-sm font-medium">Próximos pasos</h4>
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li className="flex items-center gap-2">
            <ArrowRight className="h-3 w-3" />
            Usa el chat para interactuar con tus servicios conectados
          </li>
          <li className="flex items-center gap-2">
            <ArrowRight className="h-3 w-3" />
            Gestiona tus conexiones desde Configuración &gt; Aplicaciones
          </li>
          <li className="flex items-center gap-2">
            <ArrowRight className="h-3 w-3" />
            Puedes desconectar cualquier servicio en cualquier momento
          </li>
        </ul>
      </div>
    </div>
  );
}

// ─── Standalone Connect Button ───────────────────────────────────────
export function ConnectServicesButton({
  variant = "default",
  size = "default",
  className,
}: {
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
}) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const { connectedCount, totalServices } = useServiceConnections();

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => setWizardOpen(true)}
        className={cn("gap-2", className)}
        data-testid="button-connect-services"
      >
        <Zap className="h-4 w-4" />
        Conectar servicios
        {connectedCount > 0 && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">
            {connectedCount}/{totalServices}
          </Badge>
        )}
      </Button>

      <ServiceConnectionWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
      />
    </>
  );
}
