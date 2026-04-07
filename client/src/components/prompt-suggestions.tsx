import React from "react";
import { cn } from "@/lib/utils";
import {
  Bug,
  FileText,
  GitBranch,
  ListChecks,
  Presentation,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

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
  icon: LucideIcon;
}

const RECENT_WORKFLOWS_STORAGE_KEY = "promptWorkflowRecents";

const DEFAULT_WORKFLOWS: WorkflowSuggestion[] = [
  {
    id: "research-first",
    title: "Investigar antes de actuar",
    description: "Contexto, riesgos y recomendación final verificable.",
    prompt:
      "Investiga primero este tema o problema. Resume el contexto actual, opciones viables, riesgos, referencias confiables y una recomendación final accionable.",
    icon: Search,
    selectedTool: "web",
    latencyMode: "deep",
  },
  {
    id: "implementation-plan",
    title: "Plan de implementación",
    description: "Fases, dependencias y validaciones antes de ejecutar.",
    prompt:
      "Actúa como líder técnico. Descompón esta solicitud en un plan de implementación por fases, dependencias, riesgos, entregables y criterios de verificación antes de ejecutar cambios.",
    icon: GitBranch,
    selectedTool: "agent",
    latencyMode: "deep",
  },
  {
    id: "systematic-debug",
    title: "Depuración sistemática",
    description: "Causa raíz, arreglo mínimo y verificación clara.",
    prompt:
      "Quiero depurar esto de forma profesional. Reproduce el fallo, formula hipótesis, identifica la causa raíz, propone el arreglo mínimo y define cómo validarlo sin introducir regresiones.",
    icon: Bug,
    selectedTool: "agent",
    latencyMode: "deep",
  },
];

const ATTACHMENT_WORKFLOWS: WorkflowSuggestion[] = [
  {
    id: "attachment-summary",
    title: "Resumen ejecutivo",
    description: "Lo esencial del material, ordenado para decidir rápido.",
    prompt:
      "Dame un resumen ejecutivo breve del material adjunto, con puntos clave, hallazgos, riesgos y recomendaciones accionables.",
    icon: FileText,
    latencyMode: "auto",
  },
  {
    id: "attachment-actions",
    title: "Acciones y pendientes",
    description: "Tareas, responsables, bloqueos y próximos pasos.",
    prompt:
      "Extrae del material adjunto las acciones concretas, responsables sugeridos, bloqueos, dependencias y próximos pasos.",
    icon: ListChecks,
    latencyMode: "auto",
  },
  {
    id: "attachment-review",
    title: "Hallazgos y riesgos",
    description: "Inconsistencias, riesgos y observaciones críticas.",
    prompt:
      "Revisa el material adjunto y señala hallazgos importantes, inconsistencias, riesgos, dudas abiertas y qué faltaría reforzar.",
    icon: ShieldCheck,
    latencyMode: "deep",
  },
  {
    id: "attachment-presentation",
    title: "Convertir en presentación",
    description: "Narrativa ejecutiva lista para una PPT clara.",
    prompt:
      "Convierte el material adjunto en una presentación ejecutiva con estructura clara, narrativa breve por diapositiva y conclusiones finales.",
    icon: Presentation,
    selectedDocTool: "ppt",
    latencyMode: "auto",
  },
];

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
  const workflows = hasAttachment ? ATTACHMENT_WORKFLOWS : DEFAULT_WORKFLOWS;

  const rememberWorkflow = (workflowId: string) => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(RECENT_WORKFLOWS_STORAGE_KEY);
    let current: unknown[] = [];
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        current = Array.isArray(parsed) ? parsed : [];
      } catch {
        current = [];
      }
    }
    const next = [workflowId, ...((Array.isArray(current) ? current : []).filter((id) => id !== workflowId))].slice(0, 4);
    window.localStorage.setItem(RECENT_WORKFLOWS_STORAGE_KEY, JSON.stringify(next));
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
    ? "Resume, revisa, extrae acciones o conviértelo en una presentación sin rehacer el material."
    : "Investiga, planifica, depura, revisa o documenta desde el primer mensaje.";

  return (
    <div className={cn("w-full max-w-[38rem] px-4", className)}>
      <div className="mb-2.5 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-muted-foreground/55">
          Workflows
        </p>
        <h3 className="mt-1.5 text-[1.42rem] font-semibold tracking-tight text-foreground sm:text-[1.65rem]">
          {heading}
        </h3>
        <p className="mx-auto mt-1.5 max-w-lg text-[13px] leading-5 text-muted-foreground sm:text-sm">
          {copy}
        </p>
      </div>

      <div className="grid gap-0">
        {workflows.map((workflow, index) => {
          const Icon = workflow.icon;
          const isLast = index === workflows.length - 1;

          return (
            <button
              key={workflow.id}
              onClick={() => handleSelect(workflow)}
              className={cn(
                "group px-0 py-3 text-left transition-opacity duration-200 hover:opacity-100",
                !isLast && "border-b border-border/35",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-2",
              )}
            >
              <div className="flex items-start gap-3">
                <Icon className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/55 transition-colors group-hover:text-foreground/75" />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                    <h4 className="text-[15px] font-semibold tracking-tight text-foreground">
                      {workflow.title}
                    </h4>
                    <p className="text-[11px] font-medium text-muted-foreground/65 sm:whitespace-nowrap">
                      {getSurfaceLabel(workflow)} / {getLatencyLabel(workflow.latencyMode)}
                    </p>
                  </div>

                  <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                    {workflow.description}
                  </p>
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
