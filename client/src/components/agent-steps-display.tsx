import React, { useState, memo, useCallback, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  Download,
  CheckCircle2,
  Loader2,
  XCircle,
  Clock,
  Search,
  Globe,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  Code,
  Database,
  Terminal,
  Zap,
  Eye,
  Wrench,
  Bot,
  Presentation,
  Brain,
  Play,
  ShieldCheck,
  PartyPopper,
  RefreshCw,
  AlertTriangle,
  Copy,
  WifiOff,
  ServerCrash,
  Ban,
  AlertCircle
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { AgentStep, AgentEvent, AgentRunStatus } from "@/stores/agent-store";
import { getFileTheme, getFileCategory, type FileCategory } from "@/lib/fileTypeTheme";
import { ArtifactViewer, ArtifactGrid, type Artifact } from "@/components/artifact-viewer";

export interface AgentArtifact {
  id: string;
  type: string;
  name: string;
  url?: string;
  previewUrl?: string;
  path?: string;
  data?: any;
  mimeType?: string;
}

type AgentPhase = 'planning' | 'executing' | 'verifying' | 'completed' | 'failed' | 'cancelled' | 'idle';

export type ErrorType = 'transient' | 'permanent' | 'unknown';

export interface ClassifiedError {
  type: ErrorType;
  isRetryable: boolean;
  userMessage: string;
  technicalDetails: string;
  icon: React.ElementType;
}

const TRANSIENT_ERROR_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /network/i,
  /connection/i,
  /econnrefused/i,
  /econnreset/i,
  /rate limit/i,
  /too many requests/i,
  /429/,
  /503/,
  /502/,
  /504/,
  /temporarily unavailable/i,
  /service unavailable/i,
  /try again/i,
  /overloaded/i,
  /busy/i,
  /socket hang up/i,
  /fetch failed/i,
  /aborted/i,
];

const PERMANENT_ERROR_PATTERNS = [
  /unauthorized/i,
  /forbidden/i,
  /not found/i,
  /invalid.*key/i,
  /invalid.*token/i,
  /permission denied/i,
  /access denied/i,
  /authentication/i,
  /401/,
  /403/,
  /404/,
  /invalid request/i,
  /bad request/i,
  /400/,
  /not supported/i,
  /deprecated/i,
  /quota exceeded/i,
  /billing/i,
  /payment required/i,
  /402/,
];

export function classifyError(error: string | null | undefined, stepErrors?: string[]): ClassifiedError {
  const errorText = error || stepErrors?.join(' ') || '';

  if (!errorText) {
    return {
      type: 'unknown',
      isRetryable: true,
      userMessage: 'Ocurrió un error inesperado',
      technicalDetails: 'No hay detalles disponibles',
      icon: AlertCircle,
    };
  }

  const isTransient = TRANSIENT_ERROR_PATTERNS.some(pattern => pattern.test(errorText));
  const isPermanent = PERMANENT_ERROR_PATTERNS.some(pattern => pattern.test(errorText));

  if (isTransient && !isPermanent) {
    let userMessage = 'Problema de conexión temporal';
    let icon: React.ElementType = WifiOff;

    if (/rate limit|too many requests|429/i.test(errorText)) {
      userMessage = 'Límite de solicitudes alcanzado';
      icon = Clock;
    } else if (/timeout|timed out/i.test(errorText)) {
      userMessage = 'La solicitud tardó demasiado';
      icon = Clock;
    } else if (/503|502|504|service unavailable|overloaded/i.test(errorText)) {
      userMessage = 'El servidor está temporalmente ocupado';
      icon = ServerCrash;
    }

    return {
      type: 'transient',
      isRetryable: true,
      userMessage,
      technicalDetails: errorText,
      icon,
    };
  }

  if (isPermanent) {
    let userMessage = 'Error de configuración o permisos';
    let icon: React.ElementType = Ban;

    if (/unauthorized|401|authentication|invalid.*key|invalid.*token/i.test(errorText)) {
      userMessage = 'Error de autenticación - verifica tus credenciales';
      icon = Ban;
    } else if (/forbidden|403|permission denied|access denied/i.test(errorText)) {
      userMessage = 'No tienes permiso para esta acción';
      icon = Ban;
    } else if (/not found|404/i.test(errorText)) {
      userMessage = 'Recurso no encontrado';
      icon = AlertCircle;
    } else if (/quota exceeded|billing|payment required|402/i.test(errorText)) {
      userMessage = 'Límite de uso alcanzado o problema de facturación';
      icon = AlertTriangle;
    }

    return {
      type: 'permanent',
      isRetryable: false,
      userMessage,
      technicalDetails: errorText,
      icon,
    };
  }

  return {
    type: 'unknown',
    isRetryable: true,
    userMessage: 'Ocurrió un error durante la ejecución',
    technicalDetails: errorText,
    icon: AlertCircle,
  };
}

interface ErrorBannerProps {
  error: string | null;
  steps?: AgentStep[];
  status?: AgentRunStatus;
  onRetry?: () => void;
  className?: string;
}

export const ErrorBanner = memo(function ErrorBanner({
  error,
  steps = [],
  status,
  onRetry,
  className,
}: ErrorBannerProps) {
  const [isCopied, setIsCopied] = useState(false);

  const stepErrors = useMemo(() =>
    steps.filter(s => s.status === 'failed' && s.error).map(s => s.error!),
    [steps]
  );

  const classifiedError = useMemo(() =>
    classifyError(error, stepErrors),
    [error, stepErrors]
  );

  const fullErrorLog = useMemo(() => {
    const logs: string[] = [];
    logs.push(`=== Error Log ===`);
    logs.push(`Fecha: ${new Date().toISOString()}`);
    logs.push(`Estado: ${status || 'unknown'}`);
    logs.push(`Tipo de error: ${classifiedError.type}`);
    logs.push(`Mensaje: ${classifiedError.userMessage}`);
    logs.push('');
    logs.push(`=== Detalles técnicos ===`);
    logs.push(classifiedError.technicalDetails);

    if (stepErrors.length > 0) {
      logs.push('');
      logs.push(`=== Errores en pasos (${stepErrors.length}) ===`);
      steps.filter(s => s.status === 'failed').forEach((step, i) => {
        logs.push(`[Paso ${step.stepIndex}] ${step.toolName}: ${step.error}`);
      });
    }

    return logs.join('\n');
  }, [status, classifiedError, stepErrors, steps]);

  const handleCopyLog = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(fullErrorLog);
      setIsCopied(true);
      toast.success('Log copiado al portapapeles');
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      toast.error('No se pudo copiar el log');
    }
  }, [fullErrorLog]);

  const handleRetry = useCallback(() => {
    if (onRetry) {
      onRetry();
    } else {
      toast.info('Para reintentar, envía tu mensaje nuevamente');
    }
  }, [onRetry]);

  if (status !== 'failed' && status !== 'cancelled') {
    return null;
  }

  const Icon = classifiedError.icon;
  const isTransient = classifiedError.type === 'transient';
  const isPermanent = classifiedError.type === 'permanent';

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={cn(
        "rounded-lg border p-4 space-y-3",
        isTransient && "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800",
        isPermanent && "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800",
        !isTransient && !isPermanent && "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800",
        className
      )}
      data-testid="error-banner"
    >
      <div className="flex items-start gap-3">
        <div className={cn(
          "flex items-center justify-center w-9 h-9 rounded-full shrink-0",
          isTransient && "bg-amber-100 dark:bg-amber-900/50",
          isPermanent && "bg-red-100 dark:bg-red-900/50",
          !isTransient && !isPermanent && "bg-red-100 dark:bg-red-900/50"
        )}>
          <Icon className={cn(
            "h-5 w-5",
            isTransient && "text-amber-600 dark:text-amber-400",
            isPermanent && "text-red-600 dark:text-red-400",
            !isTransient && !isPermanent && "text-red-600 dark:text-red-400"
          )} />
        </div>

        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h4 className={cn(
              "font-medium text-sm",
              isTransient && "text-amber-800 dark:text-amber-200",
              isPermanent && "text-red-800 dark:text-red-200",
              !isTransient && !isPermanent && "text-red-800 dark:text-red-200"
            )}>
              {classifiedError.userMessage}
            </h4>
            {classifiedError.isRetryable && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] px-1.5 py-0 h-4",
                  isTransient && "border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300"
                )}
              >
                Reintentable
              </Badge>
            )}
          </div>

          <p className="text-xs text-muted-foreground line-clamp-2">
            {classifiedError.technicalDetails.slice(0, 200)}
            {classifiedError.technicalDetails.length > 200 && '...'}
          </p>

          {stepErrors.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {stepErrors.length} paso{stepErrors.length !== 1 ? 's' : ''} fallido{stepErrors.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-inherit">
        {classifiedError.isRetryable && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRetry}
            className={cn(
              "gap-1.5",
              isTransient && "border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/50"
            )}
            data-testid="error-retry-button"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reintentar
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopyLog}
          className="gap-1.5 text-muted-foreground"
          data-testid="error-copy-log-button"
        >
          {isCopied ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
              Copiado
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copiar log
            </>
          )}
        </Button>

        {!classifiedError.isRetryable && (
          <span className="text-xs text-muted-foreground ml-auto">
            Este error requiere acción manual
          </span>
        )}
      </div>
    </motion.div>
  );
});

interface AgentStepsDisplayProps {
  steps: AgentStep[];
  summary?: string | null;
  artifacts?: AgentArtifact[];
  isRunning?: boolean;
  status?: AgentRunStatus;
  eventStream?: AgentEvent[];
  startTime?: number;
  error?: string | null;
  onDocumentClick?: (artifact: AgentArtifact) => void;
  onDownload?: (artifact: AgentArtifact) => void;
  onImageExpand?: (imageUrl: string) => void;
  onRetry?: () => void;
  className?: string;
}

function isImageArtifact(artifact: AgentArtifact): boolean {
  if (artifact.type === "image") return true;
  if (artifact.mimeType?.startsWith("image/")) return true;
  const name = artifact.name?.toLowerCase() || "";
  return /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/.test(name);
}

interface StepGroupProps {
  steps: AgentStep[];
  isRunning?: boolean;
  defaultOpen?: boolean;
  maxVisibleSteps?: number;
}

interface DocumentCardProps {
  artifact: AgentArtifact;
  onClick?: () => void;
  onDownload?: () => void;
}

const TOOL_ICONS: Record<string, React.ElementType> = {
  search_web: Search,
  web_search: Search,
  browse_url: Globe,
  web_navigate: Globe,
  generate_document: FileText,
  generate_file: FileText,
  extract_content: FileText,
  analyze_spreadsheet: FileSpreadsheet,
  analyze_data: FileSpreadsheet,
  transform_data: FileSpreadsheet,
  generate_image: ImageIcon,
  generate_code: Code,
  shell_execute: Terminal,
  shell_command: Terminal,
  read_file: FileText,
  write_file: FileText,
  file_operations: FileText,
  respond: Bot,
  slides_generate: Presentation,
  webdev_scaffold: Code,
};

function getToolIcon(toolName: string): React.ElementType {
  return TOOL_ICONS[toolName] || Wrench;
}

function getToolDisplayName(toolName: string): string {
  const names: Record<string, string> = {
    search_web: "Búsqueda web",
    web_search: "Búsqueda web",
    browse_url: "Navegando sitio",
    web_navigate: "Navegando sitio",
    generate_document: "Generando documento",
    generate_file: "Generando archivo",
    extract_content: "Extrayendo contenido",
    analyze_spreadsheet: "Analizando datos",
    analyze_data: "Analizando datos",
    transform_data: "Transformando datos",
    generate_image: "Generando imagen",
    generate_code: "Generando código",
    shell_execute: "Ejecutando comando",
    shell_command: "Ejecutando comando",
    read_file: "Leyendo archivo",
    write_file: "Escribiendo archivo",
    file_operations: "Operaciones de archivo",
    respond: "Respondiendo",
    slides_generate: "Generando presentación",
    webdev_scaffold: "Creando proyecto",
  };
  return names[toolName] || toolName.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

function getDocumentIcon(category: FileCategory): React.ElementType {
  const icons: Record<FileCategory, React.ElementType> = {
    word: FileText,
    excel: FileSpreadsheet,
    ppt: Presentation,
    pdf: FileText,
    image: ImageIcon,
    text: FileText,
    code: Code,
    archive: Database,
    unknown: FileText,
  };
  return icons[category] || FileText;
}

function StepStatusIcon({ status, className }: { status: AgentStep["status"]; className?: string }) {
  switch (status) {
    case "pending":
      return <Clock className={cn("h-3.5 w-3.5 text-muted-foreground", className)} />;
    case "running":
      return <Loader2 className={cn("h-3.5 w-3.5 text-amber-500 animate-spin", className)} />;
    case "succeeded":
      return <CheckCircle2 className={cn("h-3.5 w-3.5 text-green-600", className)} />;
    case "failed":
      return <XCircle className={cn("h-3.5 w-3.5 text-red-500", className)} />;
    default:
      return <Clock className={cn("h-3.5 w-3.5 text-muted-foreground", className)} />;
  }
}

function getResultCount(step: AgentStep): number | null {
  if (!step.output) return null;
  if (Array.isArray(step.output)) return step.output.length;
  if (typeof step.output === "object") {
    if (step.output.results) return Array.isArray(step.output.results) ? step.output.results.length : null;
    if (step.output.items) return Array.isArray(step.output.items) ? step.output.items.length : null;
    if (step.output.count) return step.output.count;
  }
  return null;
}

interface PhaseIndicatorProps {
  currentPhase: AgentPhase;
  isAnimating?: boolean;
}

const PHASE_CONFIG: Record<AgentPhase, { icon: React.ElementType; label: string; color: string; bgColor: string }> = {
  idle: { icon: Clock, label: "Iniciando", color: "text-muted-foreground", bgColor: "bg-muted" },
  planning: { icon: Brain, label: "Planificando", color: "text-blue-600 dark:text-blue-400", bgColor: "bg-blue-100 dark:bg-blue-950/50" },
  executing: { icon: Play, label: "Ejecutando", color: "text-amber-600 dark:text-amber-400", bgColor: "bg-amber-100 dark:bg-amber-950/50" },
  verifying: { icon: ShieldCheck, label: "Verificando", color: "text-purple-600 dark:text-purple-400", bgColor: "bg-purple-100 dark:bg-purple-950/50" },
  completed: { icon: PartyPopper, label: "Completado", color: "text-green-600 dark:text-green-400", bgColor: "bg-green-100 dark:bg-green-950/50" },
  failed: { icon: XCircle, label: "Error", color: "text-red-600 dark:text-red-400", bgColor: "bg-red-100 dark:bg-red-950/50" },
  cancelled: { icon: XCircle, label: "Cancelado", color: "text-gray-600 dark:text-gray-400", bgColor: "bg-gray-100 dark:bg-gray-950/50" },
};

const PHASE_ORDER: AgentPhase[] = ['planning', 'executing', 'verifying', 'completed'];

const PhaseIndicator = memo(function PhaseIndicator({ currentPhase, isAnimating = false }: PhaseIndicatorProps) {
  const config = PHASE_CONFIG[currentPhase];
  const Icon = config.icon;
  const currentIndex = PHASE_ORDER.indexOf(currentPhase);
  const isTerminal = ['completed', 'failed', 'cancelled'].includes(currentPhase);

  return (
    <div className="flex items-center gap-1.5" data-testid="phase-indicator">
      {PHASE_ORDER.slice(0, -1).map((phase, index) => {
        const phaseConfig = PHASE_CONFIG[phase];
        const PhaseIcon = phaseConfig.icon;
        const isActive = phase === currentPhase;
        const isPast = currentIndex > index || isTerminal;
        const isFuture = currentIndex < index && !isTerminal;

        return (
          <React.Fragment key={phase}>
            <motion.div
              initial={{ scale: 0.9, opacity: 0.5 }}
              animate={{
                scale: isActive ? 1.1 : 1,
                opacity: isFuture ? 0.4 : 1
              }}
              transition={{ duration: 0.2 }}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-all",
                isActive && phaseConfig.bgColor,
                isActive && phaseConfig.color,
                isPast && !isActive && "text-green-600 dark:text-green-400",
                isFuture && "text-muted-foreground"
              )}
              data-testid={`phase-${phase}`}
            >
              {isPast && !isActive ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : isActive && isAnimating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <PhaseIcon className="h-3 w-3" />
              )}
              <span className="hidden sm:inline">{phaseConfig.label}</span>
            </motion.div>
            {index < PHASE_ORDER.length - 2 && (
              <div
                className={cn(
                  "w-4 h-0.5 rounded-full transition-colors",
                  isPast ? "bg-green-500" : "bg-muted"
                )}
              />
            )}
          </React.Fragment>
        );
      })}

      {isTerminal && (
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium",
            config.bgColor,
            config.color
          )}
        >
          <Icon className="h-3 w-3" />
          <span>{config.label}</span>
        </motion.div>
      )}
    </div>
  );
});

interface ProgressBarProps {
  steps: AgentStep[];
  isRunning: boolean;
  status: AgentRunStatus;
}

const ProgressBar = memo(function ProgressBar({ steps, isRunning, status }: ProgressBarProps) {
  const completedCount = steps.filter(s => s.status === 'succeeded').length;
  const failedCount = steps.filter(s => s.status === 'failed').length;
  const totalSteps = steps.length;

  const progress = useMemo(() => {
    if (status === 'completed') return 100;
    if (status === 'failed' || status === 'cancelled') return (completedCount / Math.max(totalSteps, 1)) * 100;
    if (totalSteps === 0) return isRunning ? 10 : 0;
    return Math.min(95, ((completedCount + 0.5) / totalSteps) * 100);
  }, [status, completedCount, totalSteps, isRunning]);

  const progressColor = useMemo(() => {
    if (status === 'failed') return 'bg-red-500';
    if (status === 'cancelled') return 'bg-gray-400';
    if (status === 'completed') return 'bg-green-500';
    return 'bg-amber-500';
  }, [status]);

  return (
    <div className="space-y-1" data-testid="progress-bar-container">
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <motion.div
          className={cn("h-full rounded-full", progressColor)}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
        {isRunning && (
          <motion.div
            className="absolute top-0 left-0 h-full w-20 bg-gradient-to-r from-transparent via-white/30 to-transparent"
            animate={{ x: ["-100%", "400%"] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
          />
        )}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{completedCount} de {totalSteps || "?"} pasos</span>
        {failedCount > 0 && (
          <span className="text-red-500">{failedCount} error{failedCount !== 1 ? 'es' : ''}</span>
        )}
      </div>
    </div>
  );
});

interface TimeEstimateProps {
  steps: AgentStep[];
  startTime?: number;
  isRunning: boolean;
}

const TimeEstimate = memo(function TimeEstimate({ steps, startTime, isRunning }: TimeEstimateProps) {
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    if (!isRunning || !startTime) return;

    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, startTime]);

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const estimatedRemaining = useMemo(() => {
    const completedSteps = steps.filter(s => s.status === 'succeeded');
    if (completedSteps.length < 2) return null;

    const times = completedSteps.map(s => {
      if (s.startedAt && s.completedAt) {
        return new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime();
      }
      return null;
    }).filter((t): t is number => t !== null);

    if (times.length < 2) return null;

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const pendingSteps = steps.filter(s => s.status === 'pending' || s.status === 'running').length;

    return Math.ceil((avgTime * pendingSteps) / 1000);
  }, [steps]);

  if (!isRunning && !startTime) return null;

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="time-estimate">
      <Clock className="h-3 w-3" />
      <span>{formatTime(elapsedTime)}</span>
      {isRunning && estimatedRemaining !== null && estimatedRemaining > 0 && (
        <>
          <span className="text-muted-foreground/50">•</span>
          <span>~{formatTime(estimatedRemaining)} restante</span>
        </>
      )}
    </div>
  );
});

interface ReplanNotificationProps {
  count: number;
  lastReason?: string;
}

const ReplanNotification = memo(function ReplanNotification({ count, lastReason }: ReplanNotificationProps) {
  if (count === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg text-xs",
        "bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800",
        "text-blue-700 dark:text-blue-300"
      )}
      data-testid="replan-notification"
    >
      <RefreshCw className="h-3.5 w-3.5" />
      <span>
        Estrategia ajustada {count} {count === 1 ? 'vez' : 'veces'}
        {lastReason && <span className="text-muted-foreground ml-1">• {lastReason}</span>}
      </span>
    </motion.div>
  );
});

interface CompletionSummaryProps {
  summary: string;
  steps: AgentStep[];
  startTime?: number;
  status: AgentRunStatus;
}

const CompletionSummary = memo(function CompletionSummary({
  summary,
  steps,
  startTime,
  status
}: CompletionSummaryProps) {
  const completedSteps = steps.filter(s => s.status === 'succeeded').length;
  const failedSteps = steps.filter(s => s.status === 'failed').length;
  const totalTime = startTime ? Math.floor((Date.now() - startTime) / 1000) : null;

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds} segundos`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const isSuccess = status === 'completed' && failedSteps === 0;
  const isPartialSuccess = status === 'completed' && failedSteps > 0;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className={cn(
        "rounded-lg border p-4 space-y-3",
        isSuccess && "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800",
        isPartialSuccess && "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800",
        status === 'failed' && "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800",
        status === 'cancelled' && "bg-gray-50 dark:bg-gray-950/20 border-gray-200 dark:border-gray-800"
      )}
      data-testid="completion-summary"
    >
      <div className="flex items-start gap-3">
        <div className={cn(
          "flex items-center justify-center w-8 h-8 rounded-full shrink-0",
          isSuccess && "bg-green-100 dark:bg-green-900/50",
          isPartialSuccess && "bg-amber-100 dark:bg-amber-900/50",
          status === 'failed' && "bg-red-100 dark:bg-red-900/50",
          status === 'cancelled' && "bg-gray-100 dark:bg-gray-900/50"
        )}>
          {isSuccess && <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />}
          {isPartialSuccess && <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />}
          {status === 'failed' && <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />}
          {status === 'cancelled' && <XCircle className="h-4 w-4 text-gray-600 dark:text-gray-400" />}
        </div>

        <div className="flex-1 min-w-0">
          <h4 className={cn(
            "font-medium text-sm",
            isSuccess && "text-green-800 dark:text-green-200",
            isPartialSuccess && "text-amber-800 dark:text-amber-200",
            status === 'failed' && "text-red-800 dark:text-red-200",
            status === 'cancelled' && "text-gray-800 dark:text-gray-200"
          )}>
            {isSuccess && "Tarea completada"}
            {isPartialSuccess && "Tarea completada con advertencias"}
            {status === 'failed' && "Tarea fallida"}
            {status === 'cancelled' && "Tarea cancelada"}
          </h4>

          {summary && (
            <p className="text-sm text-foreground mt-1 leading-relaxed">
              {summary}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground pt-2 border-t border-inherit">
        <div className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-green-600" />
          <span>{completedSteps} paso{completedSteps !== 1 ? 's' : ''} completado{completedSteps !== 1 ? 's' : ''}</span>
        </div>
        {failedSteps > 0 && (
          <div className="flex items-center gap-1">
            <XCircle className="h-3 w-3 text-red-600" />
            <span>{failedSteps} error{failedSteps !== 1 ? 'es' : ''}</span>
          </div>
        )}
        {totalTime !== null && (
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>{formatDuration(totalTime)}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
});

const StepItem = memo(function StepItem({ step }: { step: AgentStep }) {
  const [isOpen, setIsOpen] = useState(false);
  const IconComponent = getToolIcon(step.toolName);
  const resultCount = getResultCount(step);
  const hasDetails = step.output || step.error;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "flex items-start gap-2.5 py-2 px-1 rounded-md transition-colors",
        step.status === "running" && "bg-amber-50 dark:bg-amber-950/20"
      )}
      data-testid={`agent-step-${step.stepIndex}`}
    >
      <StepStatusIcon status={step.status} className="mt-0.5 shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <IconComponent className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm text-foreground truncate">
            {getToolDisplayName(step.toolName)}
          </span>
          {resultCount !== null && resultCount > 0 && (
            <span className="text-xs text-muted-foreground shrink-0">
              {resultCount} {resultCount === 1 ? "resultado" : "resultados"}
            </span>
          )}
        </div>

        {step.error && (
          <p className="text-xs text-red-500 mt-1 line-clamp-2">{step.error}</p>
        )}

        {hasDetails && step.status === "succeeded" && (
          <Collapsible open={isOpen} onOpenChange={setIsOpen}>
            <CollapsibleTrigger asChild>
              <button
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1 transition-colors"
                data-testid={`toggle-step-details-${step.stepIndex}`}
              >
                {isOpen ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                <span>{isOpen ? "Ocultar detalles" : "Ver detalles"}</span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="text-xs bg-muted/50 rounded-md p-2 max-h-32 overflow-auto">
                <pre className="whitespace-pre-wrap break-words text-muted-foreground">
                  {typeof step.output === "string"
                    ? step.output
                    : JSON.stringify(step.output, null, 2)?.slice(0, 500)}
                </pre>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </motion.div>
  );
});

export const StepGroup = memo(function StepGroup({
  steps,
  isRunning = false,
  defaultOpen = false,
  maxVisibleSteps = 5
}: StepGroupProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen || isRunning);
  const [showAll, setShowAll] = useState(false);

  const completedCount = steps.filter(s => s.status === "succeeded").length;
  const failedCount = steps.filter(s => s.status === "failed").length;
  const runningCount = steps.filter(s => s.status === "running").length;
  const totalSteps = steps.length;

  const visibleSteps = useMemo(() => {
    if (showAll || steps.length <= maxVisibleSteps) return steps;
    const runningIndex = steps.findIndex(s => s.status === 'running');
    if (runningIndex >= 0) {
      const start = Math.max(0, runningIndex - 2);
      return steps.slice(start, start + maxVisibleSteps);
    }
    return steps.slice(-maxVisibleSteps);
  }, [steps, showAll, maxVisibleSteps]);

  const hiddenCount = steps.length - visibleSteps.length;

  const getStatusLabel = () => {
    if (runningCount > 0) return "En progreso...";
    if (failedCount > 0 && completedCount === 0) return "Error";
    if (failedCount > 0) return `${completedCount} completados, ${failedCount} errores`;
    if (completedCount === totalSteps) return "Completado";
    return `${completedCount}/${totalSteps}`;
  };

  if (steps.length === 0) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-all",
            "bg-[#f5f1e8] dark:bg-stone-900/50 hover:bg-[#ebe7de] dark:hover:bg-stone-900/70",
            "border border-[#e5e0d5] dark:border-stone-800",
            "text-left group"
          )}
          data-testid="step-group-trigger"
        >
          <div className="flex items-center gap-1.5 text-muted-foreground group-hover:text-foreground transition-colors">
            {isOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </div>

          <span className="text-sm font-medium text-foreground">
            {totalSteps} {totalSteps === 1 ? "paso" : "pasos"}
          </span>

          <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1.5">
            {runningCount > 0 && (
              <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
            )}
            {getStatusLabel()}
          </span>
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className={cn(
            "mt-1 px-3 py-2 rounded-lg",
            "bg-[#faf8f4] dark:bg-stone-950/30",
            "border border-[#e5e0d5] dark:border-stone-800"
          )}
        >
          <div className="space-y-0.5">
            <AnimatePresence mode="popLayout">
              {visibleSteps.map((step, index) => (
                <StepItem key={step.stepIndex ?? index} step={step} />
              ))}
            </AnimatePresence>
          </div>

          {hiddenCount > 0 && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full mt-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors border-t border-dashed border-border"
              data-testid="show-all-steps"
            >
              Mostrar {hiddenCount} paso{hiddenCount !== 1 ? 's' : ''} más
            </button>
          )}

          {showAll && steps.length > maxVisibleSteps && (
            <button
              onClick={() => setShowAll(false)}
              className="w-full mt-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors border-t border-dashed border-border"
              data-testid="collapse-steps"
            >
              Mostrar menos
            </button>
          )}
        </motion.div>
      </CollapsibleContent>
    </Collapsible>
  );
});

interface InlineImageCardProps {
  artifact: AgentArtifact;
  onExpand?: (imageUrl: string) => void;
  onDownload?: () => void;
}

const InlineImageCard = memo(function InlineImageCard({
  artifact,
  onExpand,
  onDownload
}: InlineImageCardProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const imageUrl = useMemo(() => {
    if (artifact.url) return artifact.url;
    if (artifact.previewUrl) return artifact.previewUrl;
    if (artifact.data?.previewUrl) return artifact.data.previewUrl;
    if (artifact.data?.url) return artifact.data.url;
    const artifactPath = artifact.path || artifact.data?.filePath;
    if (artifactPath) {
      const filename = artifactPath.split('/').pop();
      return `/api/artifacts/${filename}/preview`;
    }
    return null;
  }, [artifact]);

  const handleExpand = useCallback(() => {
    if (imageUrl && onExpand) {
      onExpand(imageUrl);
    }
  }, [imageUrl, onExpand]);

  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDownload) {
      onDownload();
      return;
    }

    if (!imageUrl) return;

    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = artifact.name || "imagen.png";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      const link = document.createElement("a");
      link.href = imageUrl;
      link.download = artifact.name || "imagen.png";
      link.click();
    }
  }, [onDownload, imageUrl, artifact.name]);

  const handleRetry = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setHasError(false);
    setIsLoaded(false);
    setRetryKey(prev => prev + 1);
  }, []);

  const handleOpenInNewTab = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (imageUrl) {
      window.open(imageUrl, "_blank", "noopener,noreferrer");
    }
  }, [imageUrl]);

  if (!imageUrl) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/50">
        <ImageIcon className="h-8 w-8 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Imagen no disponible</span>
      </div>
    );
  }

  return (
    <div
      className="relative group rounded-lg overflow-hidden border border-border bg-muted/30"
      data-testid={`inline-image-${artifact.id}`}
    >
      {!isLoaded && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted animate-pulse">
          <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
        </div>
      )}

      {hasError ? (
        <div className="flex flex-col sm:flex-row items-center gap-3 p-4 text-muted-foreground">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-6 w-6" />
            <span className="text-sm">No se pudo cargar la imagen</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRetry} data-testid={`retry-image-${artifact.id}`}>
              Reintentar
            </Button>
            <Button variant="outline" size="sm" onClick={handleOpenInNewTab} data-testid={`open-new-tab-${artifact.id}`}>
              Abrir en nueva pestaña
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-1" />
              Descargar
            </Button>
          </div>
        </div>
      ) : (
        <>
          <motion.img
            key={retryKey}
            src={imageUrl}
            alt={artifact.name || "Imagen generada"}
            className={cn(
              "max-w-full h-auto cursor-pointer transition-opacity",
              !isLoaded && "opacity-0"
            )}
            style={{ maxHeight: "400px" }}
            onLoad={() => setIsLoaded(true)}
            onError={() => setHasError(true)}
            onClick={handleExpand}
            initial={{ opacity: 0 }}
            animate={{ opacity: isLoaded ? 1 : 0 }}
            data-testid={`generated-image-preview-${artifact.id}`}
          />

          <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="secondary"
              size="icon"
              className="h-8 w-8 bg-black/50 hover:bg-black/70 text-white border-0"
              onClick={handleExpand}
              data-testid={`expand-image-${artifact.id}`}
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="h-8 w-8 bg-black/50 hover:bg-black/70 text-white border-0"
              onClick={handleDownload}
              data-testid={`download-image-${artifact.id}`}
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
});

export const DocumentCard = memo(function DocumentCard({
  artifact,
  onClick,
  onDownload
}: DocumentCardProps) {
  const category = getFileCategory(artifact.name, artifact.mimeType);
  const theme = getFileTheme(artifact.name, artifact.mimeType);
  const IconComponent = getDocumentIcon(category);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.();
  }, [onClick]);

  const handleDownload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDownload?.();
  }, [onDownload]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer",
        "bg-card hover:bg-accent/50 border-border hover:border-border/80",
        "hover:shadow-sm group"
      )}
      onClick={handleClick}
      data-testid={`document-card-${artifact.id}`}
    >
      <div
        className={cn(
          "flex items-center justify-center w-10 h-10 rounded-lg shrink-0",
          "bg-gradient-to-br",
          theme.gradientFrom,
          theme.gradientTo
        )}
      >
        <IconComponent className="h-5 w-5 text-white" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate text-foreground">
          {artifact.name}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 h-4 font-normal"
          >
            {theme.label}
          </Badge>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={handleClick}
          data-testid={`preview-document-${artifact.id}`}
        >
          <Eye className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleDownload}
          data-testid={`download-document-${artifact.id}`}
        >
          <Download className="h-4 w-4" />
        </Button>
      </div>
    </motion.div>
  );
});

function mapStatusToPhase(status?: AgentRunStatus): AgentPhase {
  if (!status) return 'idle';
  switch (status) {
    case 'idle':
    case 'starting':
    case 'queued':
      return 'idle';
    case 'planning':
      return 'planning';
    case 'running':
    case 'paused':
    case 'cancelling':
      return 'executing';
    case 'verifying':
      return 'verifying';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'idle';
  }
}

export const AgentStepsDisplay = memo(function AgentStepsDisplay({
  steps,
  summary,
  artifacts = [],
  isRunning = false,
  status,
  eventStream = [],
  startTime,
  error,
  onDocumentClick,
  onDownload,
  onImageExpand,
  onRetry,
  className
}: AgentStepsDisplayProps) {
  const hasSteps = steps.length > 0;
  const hasArtifacts = artifacts.length > 0;
  const hasSummary = summary && summary.trim().length > 0;

  const phase = mapStatusToPhase(status);
  const isTerminal = ['completed', 'failed', 'cancelled'].includes(phase);

  const replanInfo = useMemo(() => {
    const replanEvents = eventStream.filter(e =>
      e.content?.event_type === 'replan' || e.type === 'thinking'
    );
    const lastReplan = replanEvents[replanEvents.length - 1];
    return {
      count: replanEvents.filter(e => e.content?.event_type === 'replan').length,
      lastReason: lastReplan?.content?.reason as string | undefined
    };
  }, [eventStream]);

  const mappedArtifacts: Artifact[] = useMemo(() => {
    return artifacts.map(a => ({
      id: a.id,
      type: (isImageArtifact(a) ? "image" : "unknown") as Artifact["type"],
      name: a.name,
      url: a.url,
      previewUrl: a.previewUrl,
      path: a.path,
      data: a.data,
      mimeType: a.mimeType,
    }));
  }, [artifacts]);

  const handleArtifactClick = useCallback((artifact: Artifact) => {
    const original = artifacts.find(a => a.id === artifact.id);
    if (original) onDocumentClick?.(original);
  }, [artifacts, onDocumentClick]);

  const handleArtifactDownload = useCallback((artifact: Artifact) => {
    const original = artifacts.find(a => a.id === artifact.id);
    if (original) {
      if (onDownload) {
        onDownload(original);
      } else if (original.url) {
        const link = document.createElement("a");
        link.href = original.url;
        link.download = original.name;
        link.click();
      }
    }
  }, [artifacts, onDownload]);

  const handleImageExpand = useCallback((imageUrl: string) => {
    onImageExpand?.(imageUrl);
  }, [onImageExpand]);

  const hasError = status === 'failed' || (error && error.trim().length > 0);

  if (!hasSteps && !hasArtifacts && !hasSummary && !isRunning && !hasError) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cn("space-y-3", className)}
      data-testid="agent-steps-display"
    >
      {(isRunning || isTerminal) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <PhaseIndicator
              currentPhase={phase}
              isAnimating={isRunning}
            />
            <TimeEstimate
              steps={steps}
              startTime={startTime}
              isRunning={isRunning}
            />
          </div>

          {isRunning && hasSteps && (
            <ProgressBar
              steps={steps}
              isRunning={isRunning}
              status={status || 'running'}
            />
          )}
        </div>
      )}

      {replanInfo.count > 0 && isRunning && (
        <ReplanNotification
          count={replanInfo.count}
          lastReason={replanInfo.lastReason}
        />
      )}

      {hasSteps && (
        <StepGroup
          steps={steps}
          isRunning={isRunning}
          defaultOpen={isRunning}
          maxVisibleSteps={isRunning ? 5 : 10}
        />
      )}

      {hasSummary && isTerminal && status !== 'failed' && (
        <CompletionSummary
          summary={summary!}
          steps={steps}
          startTime={startTime}
          status={status || 'completed'}
        />
      )}

      {(status === 'failed' || status === 'cancelled') && (
        <ErrorBanner
          error={error || null}
          steps={steps}
          status={status}
          onRetry={onRetry}
        />
      )}

      {hasArtifacts && !isRunning && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <ArtifactGrid
            artifacts={mappedArtifacts}
            onExpand={handleImageExpand}
            onDownload={handleArtifactDownload}
            onClick={handleArtifactClick}
          />
        </motion.div>
      )}
    </motion.div>
  );
});

export default AgentStepsDisplay;

export function showAgentErrorToast(error: string | null, options?: {
  isRetryable?: boolean;
  onRetry?: () => void;
}) {
  const classified = classifyError(error);

  if (classified.type === 'transient' || options?.isRetryable) {
    toast.error(classified.userMessage, {
      description: classified.technicalDetails.slice(0, 100),
      duration: 8000,
      action: options?.onRetry ? {
        label: 'Reintentar',
        onClick: options.onRetry,
      } : undefined,
    });
  } else {
    toast.error(classified.userMessage, {
      description: 'Revisa los detalles del error para más información',
      duration: 10000,
    });
  }
}

export function showCriticalAgentError(error: string, details?: string) {
  toast.error('Error crítico del agente', {
    description: error.slice(0, 150),
    duration: 15000,
  });
}
