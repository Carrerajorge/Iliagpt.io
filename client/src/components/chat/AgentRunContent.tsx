
import React, { memo, useState, useRef, useEffect, useMemo } from "react";
import {
    Loader2,
    Sparkles,
    Eye,
    RefreshCw,
    Clock,
    CheckCircle2,
    XCircle,
    AlertCircle,
    List,
    Target,
    ChevronDown,
    Brain,
    Bot
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from "@/components/ui/collapsible";
import { normalizeAgentEvent, hasPayloadDetails, type MappedAgentEvent } from "@/lib/agent-event-mapper";
import { AgentStepsDisplay, type AgentArtifact } from "@/components/agent-steps-display";
import { PlanViewer } from "@/components/agent/PlanViewer";
import { MarkdownRenderer, MarkdownErrorBoundary } from "@/components/markdown-renderer";
import { JsonArgumentsViewer } from "@/components/chat/JsonArgumentsViewer";
import { ToolInvocationCard, ToolStatus } from "@/components/chat/ToolInvocationCard";

interface AgentRunContentProps {
    agentRun: {
        runId: string | null;
        status: "idle" | "starting" | "running" | "completed" | "failed" | "cancelled" | "queued" | "planning" | "verifying" | "paused" | "cancelling" | "replanning";
        userMessage?: string;
        steps: Array<{
            stepIndex: number;
            toolName: string;
            status: string;
            output?: any;
            error?: string;
        }>;
        eventStream: Array<{
            type: string;
            content: any;
            timestamp: number;
        }>;
        summary: string | null;
        error: string | null;
    };
    onCancel?: () => void;
    onRetry?: () => void;
    onPause?: () => void;
    onResume?: () => void;
    onArtifactPreview?: (artifact: AgentArtifact) => void;
    onOpenLightbox?: (imageUrl: string) => void;
    onToolConfirm?: (toolName: string, stepIndex: number) => void;
    onToolDeny?: (toolName: string, stepIndex: number) => void;
}

export const AgentRunContent = memo(function AgentRunContent({
    agentRun,
    onCancel,
    onRetry,
    onPause,
    onResume,
    onArtifactPreview,
    onOpenLightbox,
    onToolConfirm,
    onToolDeny
}: AgentRunContentProps) {
    const [isExpanded, setIsExpanded] = useState(true);
    const [showAllEvents, setShowAllEvents] = useState(false);
    const [isSlowConnection, setIsSlowConnection] = useState(false);
    const [waitingSeconds, setWaitingSeconds] = useState(0);
    const [viewMode, setViewMode] = useState<"steps" | "plan">("steps");
    const eventsEndRef = useRef<HTMLDivElement>(null);

    const isCancellable = ["starting", "running", "queued", "planning", "verifying", "paused", "replanning"].includes(agentRun.status);
    const isActive = ["starting", "running", "queued", "planning", "verifying", "cancelling", "replanning"].includes(agentRun.status);
    const isPaused = agentRun.status === "paused";
    const isCancelling = agentRun.status === "cancelling";
    const isWaitingForResponse = agentRun.status === "starting" || agentRun.status === "queued";

    useEffect(() => {
        if (isActive && eventsEndRef.current) {
            eventsEndRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
    }, [agentRun.eventStream?.length, isActive]);

    useEffect(() => {
        if (!isWaitingForResponse) {
            setIsSlowConnection(false);
            setWaitingSeconds(0);
            return;
        }

        const interval = setInterval(() => {
            setWaitingSeconds(prev => {
                const newVal = prev + 1;
                if (newVal >= 10) {
                    setIsSlowConnection(true);
                }
                return newVal;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [isWaitingForResponse]);

    const getStatusIcon = () => {
        switch (agentRun.status) {
            case "starting":
            case "queued":
                return <Loader2 className="h-4 w-4 animate-spin text-purple-500" />;
            case "planning":
                return <Sparkles className="h-4 w-4 animate-pulse text-purple-500" />;
            case "running":
                return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
            case "verifying":
                return <Eye className="h-4 w-4 animate-pulse text-purple-500" />;
            case "replanning":
                return <RefreshCw className="h-4 w-4 animate-spin text-orange-500" />;
            case "paused":
                return <Clock className="h-4 w-4 text-yellow-500" />;
            case "cancelling":
                return <Loader2 className="h-4 w-4 animate-spin text-red-500" />;
            case "completed":
                return <CheckCircle2 className="h-4 w-4 text-green-500" />;
            case "failed":
                return <XCircle className="h-4 w-4 text-red-500" />;
            case "cancelled":
                return <AlertCircle className="h-4 w-4 text-yellow-500" />;
            default:
                return <Clock className="h-4 w-4 text-muted-foreground" />;
        }
    };

    const getStatusText = () => {
        switch (agentRun.status) {
            case "starting": return "Iniciando...";
            case "queued": return "En cola...";
            case "planning": return "Planificando...";
            case "running": return "Ejecutando...";
            case "verifying": return "Verificando...";
            case "replanning": return "Replanificando...";
            case "paused": return "Pausado";
            case "cancelling": return "Cancelando...";
            case "completed": return "Completado";
            case "failed": return "Error";
            case "cancelled": return "Cancelado";
            default: return agentRun.status;
        }
    };

    const getToolDisplayName = (toolName: string) => {
        const toolNames: Record<string, string> = {
            analyze_spreadsheet: "Analizando datos",
            web_search: "Buscando en web",
            web_search_retrieve: "Recuperando información",
            generate_image: "Generando imagen",
            browse_url: "Navegando URL",
            generate_document: "Generando documento",
            read_file: "Leyendo archivo",
            write_file: "Escribiendo archivo",
            shell_command: "Ejecutando comando",
            list_files: "Listando archivos",
            respond: "Respondiendo",
            start_planning: "Analizando solicitud",
            conversational_response: "Respuesta",
        };
        return toolNames[toolName] || toolName;
    };

    const mappedEvents = useMemo(() => {
        return (agentRun.eventStream || []).map(event => normalizeAgentEvent(event));
    }, [agentRun.eventStream]);

    const visibleEvents = showAllEvents
        ? mappedEvents
        : mappedEvents.slice(-5);
    const hiddenEventsCount = mappedEvents.length - visibleEvents.length;

    const getEventIcon = (event: MappedAgentEvent) => {
        const iconClass = cn("h-3 w-3", event.ui.iconColor);
        switch (event.ui.icon) {
            case 'sparkles': return <Sparkles className={iconClass} />;
            case 'check': return <CheckCircle2 className={iconClass} />;
            case 'alert': return <XCircle className={iconClass} />;
            case 'list': return <List className={iconClass} />;
            case 'eye': return <Eye className={iconClass} />;
            case 'brain': return <Brain className={iconClass} />;
            case 'loader': return <Loader2 className={cn(iconClass, "animate-spin")} />;
            default: return <Clock className={iconClass} />;
        }
    };

    // Extract objective from event stream
    const objective = useMemo(() => {
        const planEvent = (agentRun.eventStream || []).find(
            (e: any) => e.content?.plan?.objective || e.content?.objective
        );
        return planEvent?.content?.plan?.objective || planEvent?.content?.objective || agentRun.userMessage || null;
    }, [agentRun.eventStream, agentRun.userMessage]);

    // Count completed vs total steps
    const stepProgress = useMemo(() => {
        const completedEvents = mappedEvents.filter(e => e.status === 'ok' && (e.kind === 'observation' || e.kind === 'result')).length;
        const totalSteps = agentRun.steps?.length || mappedEvents.filter(e => e.kind === 'action').length || 0;
        return { completed: completedEvents, total: Math.max(totalSteps, completedEvents) };
    }, [mappedEvents, agentRun.steps]);

    return (
        <div className="flex flex-col gap-2 w-full animate-in fade-in slide-in-from-bottom-2 duration-300" data-testid="agent-run-content">
            {/* Header with cancel button prominently displayed */}
            <div className="flex items-start gap-2">
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="flex-1 flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-purple-500/10 to-blue-500/10 rounded-lg border border-purple-500/20 hover:border-purple-500/40 transition-all text-left"
                >
                    <Bot className="h-5 w-5 text-purple-500" />
                    <span className="text-sm font-medium text-purple-700 dark:text-purple-300">Modo Agente</span>
                    <div className="flex-1" />
                    {agentRun.runId && (
                        <div className="flex bg-background/50 rounded-md p-0.5 mr-2" onClick={(e) => e.stopPropagation()}>
                            <button
                                onClick={() => setViewMode("steps")}
                                className={cn(
                                    "px-2 py-0.5 text-xs rounded transition-colors",
                                    viewMode === "steps" ? "bg-white dark:bg-zinc-700 shadow-sm font-medium" : "text-muted-foreground hover:bg-white/50 dark:hover:bg-zinc-700/50"
                                )}
                            >
                                Pasos
                            </button>
                            <button
                                onClick={() => setViewMode("plan")}
                                className={cn(
                                    "px-2 py-0.5 text-xs rounded transition-colors",
                                    viewMode === "plan" ? "bg-white dark:bg-zinc-700 shadow-sm font-medium" : "text-muted-foreground hover:bg-white/50 dark:hover:bg-zinc-700/50"
                                )}
                            >
                                Plan
                            </button>
                        </div>
                    )}
                    {getStatusIcon()}
                    <span className="text-xs text-muted-foreground">{getStatusText()}</span>
                    <ChevronDown className={cn(
                        "h-4 w-4 text-muted-foreground transition-transform",
                        isExpanded && "rotate-180"
                    )} />
                </button>

                {/* Prominent Cancel Button - always visible when active */}
                {isCancellable && onCancel && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onCancel}
                        disabled={isCancelling}
                        className={cn(
                            "shrink-0 h-10 px-3 border",
                            isCancelling
                                ? "text-red-400 border-red-300/50 bg-red-50/50 dark:bg-red-900/20 cursor-not-allowed"
                                : "text-muted-foreground border-border hover:text-red-500 hover:border-red-300 hover:bg-red-50/50 dark:hover:bg-red-900/20"
                        )}
                        data-testid="button-cancel-agent-header"
                    >
                        {isCancelling ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                                Cancelando
                            </>
                        ) : (
                            <>
                                <XCircle className="h-4 w-4 mr-1.5" />
                                Cancelar
                            </>
                        )}
                    </Button>
                )}
            </div>

            {/* Objective display - show what the agent is working on */}
            {objective && isActive && (
                <div className="px-3 py-2 bg-purple-500/5 rounded-lg border border-purple-500/10">
                    <div className="flex items-center gap-2 text-xs text-purple-600 dark:text-purple-400 font-medium uppercase tracking-wide mb-1">
                        <Target className="h-3 w-3" />
                        Objetivo
                    </div>
                    <p className="text-sm text-foreground line-clamp-2">{objective}</p>
                    {stepProgress.total > 0 && (
                        <div className="mt-2 flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-purple-500/20 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-500 w-[var(--step-width)]"
                                    ref={(el) => { if (el) el.style.setProperty('--step-width', `${Math.min(100, (stepProgress.completed / stepProgress.total) * 100)}%`); }}
                                />
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0">
                                {stepProgress.completed}/{stepProgress.total}
                            </span>
                        </div>
                    )}
                </div>
            )}

            {isExpanded && (
                <div className="space-y-3">
                    {/* Action buttons for runs */}
                    {(isCancellable || isPaused) && (
                        <div className="flex justify-end gap-2">
                            {isPaused && onResume && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={onResume}
                                    className="text-xs text-muted-foreground hover:text-green-500"
                                    data-testid="button-resume-agent"
                                >
                                    <RefreshCw className="h-3 w-3 mr-1" />
                                    Reanudar
                                </Button>
                            )}
                            {!isPaused && !isCancelling && isActive && onPause && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={onPause}
                                    className="text-xs text-muted-foreground hover:text-yellow-500"
                                    data-testid="button-pause-agent"
                                >
                                    <Clock className="h-3 w-3 mr-1" />
                                    Pausar
                                </Button>
                            )}
                            {isCancellable && onCancel && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={onCancel}
                                    disabled={isCancelling}
                                    className={cn(
                                        "text-xs",
                                        isCancelling
                                            ? "text-red-400 cursor-not-allowed"
                                            : "text-muted-foreground hover:text-red-500"
                                    )}
                                    data-testid="button-cancel-agent"
                                >
                                    {isCancelling ? (
                                        <>
                                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                            Cancelando...
                                        </>
                                    ) : (
                                        <>
                                            <XCircle className="h-3 w-3 mr-1" />
                                            Cancelar
                                        </>
                                    )}
                                </Button>
                            )}
                        </div>
                    )}

                    {/* Plan Viewer */}
                    {viewMode === "plan" && agentRun.runId && (
                        <div className="border border-border/50 rounded-lg overflow-hidden">
                            <PlanViewer planId={agentRun.runId} />
                        </div>
                    )}

                    {/* Event timeline - Manus style with human-readable cards */}
                    {mappedEvents.length > 0 && viewMode === "steps" && (
                        <div className="relative" data-testid="agent-event-timeline">
                            {hiddenEventsCount > 0 && !showAllEvents && (
                                <button
                                    onClick={() => setShowAllEvents(true)}
                                    className="text-xs text-purple-500 hover:text-purple-600 mb-2 flex items-center gap-1"
                                    data-testid="button-show-all-events"
                                >
                                    <ChevronDown className="h-3 w-3" />
                                    Ver {hiddenEventsCount} eventos anteriores
                                </button>
                            )}
                            <div className="space-y-1.5 pl-3 border-l-2 border-purple-500/30">
                                {visibleEvents.map((event, idx) => {
                                    const isLast = idx === visibleEvents.length - 1;
                                    const showDetails = hasPayloadDetails(event);
                                    return (
                                        <div
                                            key={event.id}
                                            className={cn(
                                                "flex items-start gap-2 text-sm py-1.5 px-2 rounded-md transition-all",
                                                isLast && isActive && "bg-purple-500/5 border-l-2 border-purple-500 -ml-[11px] pl-[9px]"
                                            )}
                                            data-testid={`agent-event-${event.kind}-${event.status}`}
                                        >
                                            <div className={cn(
                                                "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0",
                                                event.ui.bgColor
                                            )}>
                                                {getEventIcon(event)}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">

                                                    <span className={cn("text-xs font-semibold uppercase tracking-wide", event.ui.labelColor)}>
                                                        {event.ui.label}
                                                    </span>
                                                    {event.status === 'ok' && event.kind !== 'action' && (
                                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-600 dark:text-green-400 text-[10px] font-medium">
                                                            ✓
                                                        </span>
                                                    )}
                                                    {event.status === 'warn' && (
                                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 text-[10px] font-medium">
                                                            ⚠
                                                        </span>
                                                    )}
                                                    {event.confidence !== undefined && (
                                                        <span className="text-[10px] text-muted-foreground">
                                                            {Math.round(event.confidence * 100)}%
                                                        </span>
                                                    )}
                                                    {isLast && isActive && (
                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-600 dark:text-purple-400 text-[10px] font-medium">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
                                                            En proceso
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-foreground text-xs mt-0.5 break-words leading-relaxed font-medium">
                                                    {event.title}
                                                </p>
                                                {event.summary && (
                                                    <p className="text-muted-foreground text-xs mt-0.5 break-words leading-relaxed">
                                                        {event.summary}
                                                    </p>
                                                )}
                                                {showDetails && (
                                                    <Collapsible className="mt-1">
                                                        <CollapsibleTrigger className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1">
                                                            <ChevronDown className="h-2.5 w-2.5" />
                                                            Ver detalles
                                                        </CollapsibleTrigger>
                                                        <CollapsibleContent>
                                                            <div className="mt-1">
                                                                <JsonArgumentsViewer
                                                                    args={event.payload}
                                                                    title="Detalles del Evento"
                                                                    defaultExpanded={true}
                                                                    className="bg-muted/30 border-none"
                                                                />
                                                            </div>
                                                        </CollapsibleContent>
                                                    </Collapsible>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                                <div ref={eventsEndRef} />
                            </div>
                        </div>
                    )}

                    {/* Steps progress - fallback if no event stream */}
                    {(!agentRun.eventStream || agentRun.eventStream.length === 0) && agentRun.steps && agentRun.steps.length > 0 && (
                        <div className="space-y-3 pl-2 border-l-2 border-purple-500/20">
                            {agentRun.steps.map((step, idx) => {
                                let status: ToolStatus = "running";
                                if (step.status === "succeeded" || step.status === "completed" || step.status === "success") status = "succeeded";
                                else if (step.status === "failed" || step.status === "error") status = "failed";
                                else if (step.status === "requires_confirmation" || step.status === "pending_approval") status = "requires_confirmation";

                                return (
                                    <ToolInvocationCard
                                        key={idx}
                                        toolName={step.toolName}
                                        status={status}
                                        input={step.output?.input || step.output}
                                        output={step.status === "succeeded" ? step.output : undefined}
                                        error={step.error}
                                        onConfirm={() => onToolConfirm?.(step.toolName, step.stepIndex)}
                                        onDeny={() => onToolDeny?.(step.toolName, step.stepIndex)}
                                        streamingOutput={(step as any).streamingOutput}
                                        statusMessage={(step as any).statusMessage}
                                        startedAt={(step as any).startedAt}
                                    />
                                );
                            })}
                        </div>
                    )}

                    {/* Loading skeleton for starting state */}
                    {isActive && (!agentRun.eventStream || agentRun.eventStream.length === 0) && (!agentRun.steps || agentRun.steps.length === 0) && (
                        <div className="space-y-2 animate-pulse">
                            <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-purple-500/20" />
                                <div className="h-4 w-32 bg-muted rounded" />
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-blue-500/20" />
                                <div className="h-4 w-48 bg-muted rounded" />
                            </div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span>
                                    {agentRun.status === "starting" && "Conectando con IA..."}
                                    {agentRun.status === "queued" && "En cola de procesamiento..."}
                                    {agentRun.status === "planning" && "Planificando pasos..."}
                                    {agentRun.status === "running" && "Ejecutando..."}
                                    {agentRun.status === "verifying" && "Verificando resultados..."}
                                    {agentRun.status === "replanning" && "Ajustando plan..."}
                                    {!["starting", "queued", "planning", "running", "verifying", "replanning"].includes(agentRun.status) && "Procesando tu solicitud..."}
                                </span>
                            </div>
                            {isSlowConnection && (
                                <div className="flex items-center gap-2 text-sm text-yellow-600 dark:text-yellow-400 mt-2 p-2 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                                    <AlertCircle className="h-4 w-4" />
                                    <span>La conexión está tardando más de lo esperado ({waitingSeconds}s). Por favor, espera un momento...</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Claude-style steps display for completed runs */}
                    {agentRun.status === "completed" && agentRun.steps && agentRun.steps.length > 0 && (
                        <div className="mt-3">
                            <AgentStepsDisplay
                                steps={agentRun.steps.map(step => ({
                                    ...step,
                                    status: (step.status === 'completed' || step.status === 'succeeded' || step.status === 'success')
                                        ? 'succeeded' as const
                                        : (step.status === 'failed' || step.status === 'error')
                                            ? 'failed' as const
                                            : (step.status === 'running' || step.status === 'in_progress')
                                                ? 'running' as const
                                                : 'pending' as const
                                }))}
                                summary={agentRun.summary}
                                artifacts={(agentRun as any).artifacts}
                                isRunning={false}
                                onDocumentClick={(artifact) => {
                                    if (onArtifactPreview) {
                                        onArtifactPreview(artifact);
                                    }
                                }}
                                onImageExpand={(imageUrl) => {
                                    onOpenLightbox?.(imageUrl);
                                }}
                                onDownload={(artifact) => {
                                    if (artifact.data?.base64) {
                                        const byteCharacters = atob(artifact.data.base64);
                                        const byteNumbers = new Array(byteCharacters.length);
                                        for (let i = 0; i < byteCharacters.length; i++) {
                                            byteNumbers[i] = byteCharacters.charCodeAt(i);
                                        }
                                        const byteArray = new Uint8Array(byteNumbers);
                                        const blob = new Blob([byteArray], { type: artifact.mimeType || 'application/octet-stream' });
                                        const url = URL.createObjectURL(blob);
                                        const a = document.createElement('a');
                                        a.href = url;
                                        a.download = artifact.name;
                                        document.body.appendChild(a);
                                        a.click();
                                        document.body.removeChild(a);
                                        URL.revokeObjectURL(url);
                                    }
                                }}
                            />
                        </div>
                    )}

                    {/* Summary/Response - show when completed but no steps */}
                    {agentRun.summary && agentRun.status === "completed" && (!agentRun.steps || agentRun.steps.length === 0) && (
                        <div className="mt-2 pt-2 border-t border-border/50">
                            <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none">
                                <MarkdownErrorBoundary key={`agent-summary-${agentRun.summary.length}`} fallbackContent={agentRun.summary}>
                                    <MarkdownRenderer content={agentRun.summary} />
                                </MarkdownErrorBoundary>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}, (prevProps, nextProps) => {
    // Only re-render if deep equality check fails or if visible state changes
    // Simplified comparison for performance
    return JSON.stringify(prevProps.agentRun) === JSON.stringify(nextProps.agentRun);
});
