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

  return null;
}

export default PromptSuggestions;
