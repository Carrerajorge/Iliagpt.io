import React, { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Bot,
  Bug,
  FileText,
  GitBranch,
  Globe,
  ListChecks,
  Presentation,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type WorkflowCategory = "research" | "delivery" | "quality" | "analysis";

export interface PromptSuggestionSelection {
  prompt: string;
  selectedTool?: "web" | "agent" | "image" | null;
  selectedDocTool?: "word" | "excel" | "ppt" | "figma" | null;
  latencyMode?: "fast" | "deep" | "auto";
}

interface WorkflowSuggestion extends PromptSuggestionSelection {
  id: string;
  title: string;
  description: string;
  category: WorkflowCategory;
  icon: LucideIcon;
  accentClass: string;
}

const RECENT_WORKFLOWS_STORAGE_KEY = "promptWorkflowRecents";

const DEFAULT_WORKFLOWS: WorkflowSuggestion[] = [
  {
    id: "research-first",
    title: "Investigar antes de actuar",
    description: "Busca contexto, alternativas, riesgos y una recomendación final con base verificable.",
    prompt:
      "Investiga primero este tema o problema. Resume el contexto actual, opciones viables, riesgos, referencias confiables y una recomendación final accionable.",
    category: "research",
    icon: Search,
    selectedTool: "web",
    latencyMode: "deep",
    accentClass:
      "from-cyan-500/20 via-sky-500/10 to-transparent text-cyan-700 dark:text-cyan-300",
  },
  {
    id: "implementation-plan",
    title: "Plan de implementación",
    description: "Descompón la solicitud en fases, dependencias, validaciones y riesgos antes de ejecutar.",
    prompt:
      "Actúa como líder técnico. Descompón esta solicitud en un plan de implementación por fases, dependencias, riesgos, entregables y criterios de verificación antes de ejecutar cambios.",
    category: "delivery",
    icon: GitBranch,
    selectedTool: "agent",
    latencyMode: "deep",
    accentClass:
      "from-emerald-500/20 via-teal-500/10 to-transparent text-emerald-700 dark:text-emerald-300",
  },
  {
    id: "systematic-debug",
    title: "Depuración sistemática",
    description: "Reproduce, acota la causa raíz y define la corrección mínima con verificación clara.",
    prompt:
      "Quiero depurar esto de forma profesional. Reproduce el fallo, formula hipótesis, identifica la causa raíz, propone el arreglo mínimo y define cómo validarlo sin introducir regresiones.",
    category: "quality",
    icon: Bug,
    selectedTool: "agent",
    latencyMode: "deep",
    accentClass:
      "from-amber-500/20 via-orange-500/10 to-transparent text-amber-700 dark:text-amber-300",
  },
  {
    id: "quality-gate",
    title: "Revisión técnica estricta",
    description: "Prioriza bugs, riesgos de producción, deuda técnica y pruebas faltantes.",
    prompt:
      "Haz una revisión técnica estricta. Prioriza bugs, riesgos de producción, regresiones, deuda técnica, pruebas faltantes y cambios mínimos necesarios para dejarlo sólido.",
    category: "quality",
    icon: ShieldCheck,
    selectedTool: "agent",
    latencyMode: "auto",
    accentClass:
      "from-rose-500/20 via-red-500/10 to-transparent text-rose-700 dark:text-rose-300",
  },
  {
    id: "technical-document",
    title: "Documento técnico",
    description: "Abre una salida más formal para arquitectura, decisiones, alcance y próximos pasos.",
    prompt:
      "Crea un documento técnico claro y profesional con objetivo, alcance, arquitectura, decisiones clave, riesgos, plan de ejecución y próximos pasos.",
    category: "delivery",
    icon: FileText,
    selectedDocTool: "word",
    latencyMode: "auto",
    accentClass:
      "from-indigo-500/20 via-blue-500/10 to-transparent text-indigo-700 dark:text-indigo-300",
  },
];

const ATTACHMENT_WORKFLOWS: WorkflowSuggestion[] = [
  {
    id: "attachment-summary",
    title: "Resumen ejecutivo",
    description: "Sintetiza lo importante del material y ordénalo para tomar decisiones rápido.",
    prompt:
      "Dame un resumen ejecutivo breve del material adjunto, con puntos clave, hallazgos, riesgos y recomendaciones accionables.",
    category: "analysis",
    icon: Sparkles,
    latencyMode: "auto",
    accentClass:
      "from-violet-500/20 via-fuchsia-500/10 to-transparent text-violet-700 dark:text-violet-300",
  },
  {
    id: "attachment-actions",
    title: "Acciones y pendientes",
    description: "Extrae tareas, responsables sugeridos, bloqueos y próximos pasos desde el documento.",
    prompt:
      "Extrae del material adjunto las acciones concretas, responsables sugeridos, bloqueos, dependencias y próximos pasos.",
    category: "analysis",
    icon: ListChecks,
    latencyMode: "auto",
    accentClass:
      "from-emerald-500/20 via-lime-500/10 to-transparent text-emerald-700 dark:text-emerald-300",
  },
  {
    id: "attachment-review",
    title: "Hallazgos y riesgos",
    description: "Busca inconsistencias, vacíos, errores potenciales y observaciones críticas.",
    prompt:
      "Revisa el material adjunto y señala hallazgos importantes, inconsistencias, riesgos, dudas abiertas y qué faltaría reforzar.",
    category: "quality",
    icon: ShieldCheck,
    latencyMode: "deep",
    accentClass:
      "from-amber-500/20 via-orange-500/10 to-transparent text-amber-700 dark:text-amber-300",
  },
  {
    id: "attachment-presentation",
    title: "Convertir en presentación",
    description: "Organiza el material en una narrativa ejecutiva lista para una PPT clara y defendible.",
    prompt:
      "Convierte el material adjunto en una presentación ejecutiva con estructura clara, narrativa breve por diapositiva y conclusiones finales.",
    category: "delivery",
    icon: Presentation,
    selectedDocTool: "ppt",
    latencyMode: "auto",
    accentClass:
      "from-sky-500/20 via-cyan-500/10 to-transparent text-sky-700 dark:text-sky-300",
  },
];

const CATEGORY_LABELS: Record<WorkflowCategory, string> = {
  research: "Research-first",
  delivery: "Entrega guiada",
  quality: "Quality gate",
  analysis: "Análisis",
};

function getSurfaceLabel(workflow: WorkflowSuggestion): string {
  if (workflow.selectedDocTool === "word") return "Word";
  if (workflow.selectedDocTool === "ppt") return "PPT";
  if (workflow.selectedDocTool === "excel") return "Excel";
  if (workflow.selectedTool === "web") return "Web";
  if (workflow.selectedTool === "agent") return "Agente";
  if (workflow.selectedTool === "image") return "Imagen";
  return "Chat";
}

function getLatencyLabel(mode: PromptSuggestionSelection["latencyMode"]): string {
  if (mode === "deep") return "Profundo";
  if (mode === "fast") return "Rápido";
  return "Auto";
}

interface PromptSuggestionsProps {
  onSelect: (selection: PromptSuggestionSelection) => void;
  hasAttachment?: boolean;
  className?: string;
}

export function PromptSuggestions({
  onSelect,
  hasAttachment = false,
  className,
}: PromptSuggestionsProps) {
  const [recentWorkflowIds, setRecentWorkflowIds] = useState<string[]>([]);
  const workflows = hasAttachment ? ATTACHMENT_WORKFLOWS : DEFAULT_WORKFLOWS;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(RECENT_WORKFLOWS_STORAGE_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        setRecentWorkflowIds(parsed.filter((value): value is string => typeof value === "string"));
      }
    } catch {
      setRecentWorkflowIds([]);
    }
  }, []);

  const workflowById = useMemo(
    () => new Map(workflows.map((workflow) => [workflow.id, workflow])),
    [workflows],
  );

  const recentWorkflows = useMemo(
    () =>
      recentWorkflowIds
        .map((id) => workflowById.get(id))
        .filter((workflow): workflow is WorkflowSuggestion => Boolean(workflow))
        .slice(0, 2),
    [recentWorkflowIds, workflowById],
  );

  const primaryWorkflows = useMemo(
    () => workflows.filter((workflow) => !recentWorkflows.some((recent) => recent.id === workflow.id)),
    [recentWorkflows, workflows],
  );

  const rememberWorkflow = (workflowId: string) => {
    const next = [workflowId, ...recentWorkflowIds.filter((id) => id !== workflowId)].slice(0, 4);
    setRecentWorkflowIds(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(RECENT_WORKFLOWS_STORAGE_KEY, JSON.stringify(next));
    }
  };

  const handleSelect = (workflow: WorkflowSuggestion) => {
    rememberWorkflow(workflow.id);
    onSelect({
      prompt: workflow.prompt,
      selectedTool: workflow.selectedTool,
      selectedDocTool: workflow.selectedDocTool,
      latencyMode: workflow.latencyMode,
    });
  };

  const heading = hasAttachment ? "Trabaja el material cargado" : "Empieza con un workflow claro";
  const copy = hasAttachment
    ? "Convierte archivos y documentos en salidas más útiles: resumen, riesgos, acciones o presentación."
    : "Inspirado en workflows tipo skill: investiga, planifica, depura, revisa y documenta desde el primer mensaje.";

  return (
    <div className={cn("w-full max-w-4xl px-4", className)}>
      <div className="mb-6 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground/75">
          Workflows
        </p>
        <h3 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-[2rem]">
          {heading}
        </h3>
        <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-[15px]">
          {copy}
        </p>
      </div>

      {recentWorkflows.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
            Recientes
          </span>
          {recentWorkflows.map((workflow) => (
            <button
              key={`recent-${workflow.id}`}
              onClick={() => handleSelect(workflow)}
              className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-background/75 px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:border-primary/30 hover:bg-background"
            >
              <workflow.icon className="h-3.5 w-3.5" />
              <span>{workflow.title}</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {primaryWorkflows.map((workflow) => {
          const Icon = workflow.icon;
          return (
            <button
              key={workflow.id}
              onClick={() => handleSelect(workflow)}
              className={cn(
                "group relative overflow-hidden rounded-[26px] border border-border/45 bg-background/80 p-4 text-left transition-all duration-300",
                "shadow-[0_24px_60px_-38px_rgba(15,23,42,0.4)] hover:-translate-y-1 hover:border-primary/25 hover:bg-background",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-2",
              )}
            >
              <div
                className={cn(
                  "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-90 transition-opacity duration-300 group-hover:opacity-100",
                  workflow.accentClass,
                )}
              />
              <div className="absolute inset-[1px] rounded-[24px] bg-background/94" />

              <div className="relative z-10 flex h-full flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br shadow-sm",
                      workflow.accentClass,
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <Badge
                    variant="outline"
                    className="border-border/60 bg-background/80 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80"
                  >
                    {CATEGORY_LABELS[workflow.category]}
                  </Badge>
                </div>

                <div className="mt-5 space-y-2">
                  <h4 className="text-base font-semibold tracking-tight text-foreground">
                    {workflow.title}
                  </h4>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {workflow.description}
                  </p>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border/55 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-foreground/75">
                    {workflow.selectedTool === "web" ? (
                      <Globe className="h-3.5 w-3.5" />
                    ) : workflow.selectedTool === "agent" ? (
                      <Bot className="h-3.5 w-3.5" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    {getSurfaceLabel(workflow)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border/55 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-foreground/75">
                    <Sparkles className="h-3.5 w-3.5" />
                    {getLatencyLabel(workflow.latencyMode)}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default PromptSuggestions;
