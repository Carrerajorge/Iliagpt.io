import type { ContextSignals } from "./contextDetector";
import type { RobustIntent, SubIntent } from "./robustIntentClassifier";

export interface PlanStep {
  step: number;
  action: string;
  tool: string | null;
  input: string;
  expectedOutput: string;
}

export interface PAREContext {
  objectives: string[];
  constraints: string[];
  deliverables: string[];
  qualityCriteria: string[];
  deadline: string | null;

  assumptions: string[];
  clarificationNeeded: boolean;
  clarificationQuestion: string | null;

  plan: PlanStep[];
  selectedTools: string[];
  estimatedSteps: number;

  status: "pending" | "executing" | "completed" | "failed";
  results: unknown[];
  errors: string[];
}

export interface ParseResult {
  objectives: string[];
  constraints: string[];
  deliverables: string[];
  qualityCriteria: string[];
  deadline: string | null;
  detectedIntent: RobustIntent;
  detectedSubIntent: SubIntent | null;
}

export interface AlignResult {
  assumptions: string[];
  clarificationNeeded: boolean;
  clarificationQuestion: string | null;
  clarificationOptions: string[] | null;
  canProceed: boolean;
}

export interface ReasonResult {
  plan: PlanStep[];
  selectedTools: string[];
  estimatedSteps: number;
  estimatedDurationMs: number;
}

export interface PAREOutput {
  understood: string;
  plan: string;
  assumptions: string[];
  clarification: string | null;
}

const OBJECTIVE_PATTERNS = [
  /quiero\s+(.+?)(?:\.|,|$)/gi,
  /necesito\s+(.+?)(?:\.|,|$)/gi,
  /dame\s+(.+?)(?:\.|,|$)/gi,
  /hazme\s+(.+?)(?:\.|,|$)/gi,
  /genera\s+(.+?)(?:\.|,|$)/gi,
  /crea\s+(.+?)(?:\.|,|$)/gi,
  /i\s+want\s+(.+?)(?:\.|,|$)/gi,
  /i\s+need\s+(.+?)(?:\.|,|$)/gi,
  /give\s+me\s+(.+?)(?:\.|,|$)/gi,
  /create\s+(.+?)(?:\.|,|$)/gi,
  /generate\s+(.+?)(?:\.|,|$)/gi,
  /make\s+(.+?)(?:\.|,|$)/gi,
];

const CONSTRAINT_PATTERNS = [
  /máximo\s+(\d+)/gi,
  /maximo\s+(\d+)/gi,
  /no\s+más\s+de\s+(\d+)/gi,
  /no\s+mas\s+de\s+(\d+)/gi,
  /menos\s+de\s+(\d+)/gi,
  /solo\s+(\d+)/gi,
  /at\s+most\s+(\d+)/gi,
  /maximum\s+(\d+)/gi,
  /no\s+more\s+than\s+(\d+)/gi,
  /less\s+than\s+(\d+)/gi,
  /only\s+(\d+)/gi,
  /limit\s+(\d+)/gi,
];

const DEADLINE_PATTERNS = [
  /para\s+(hoy|mañana|manana|esta\s+semana|this\s+week|today|tomorrow)/gi,
  /antes\s+de\s+(.+?)(?:\.|,|$)/gi,
  /by\s+(.+?)(?:\.|,|$)/gi,
  /deadline\s*[:=]?\s*(.+?)(?:\.|,|$)/gi,
  /urgente/gi,
  /urgent/gi,
  /asap/gi,
];

const DELIVERABLE_KEYWORDS = [
  "pdf", "excel", "word", "ppt", "powerpoint", "documento", "document",
  "informe", "report", "reporte", "presentación", "presentation",
  "tabla", "table", "gráfico", "chart", "graph", "resumen", "summary"
];

export function parseUserRequest(
  message: string,
  context: ContextSignals,
  intent: RobustIntent,
  subIntent: SubIntent | null
): ParseResult {
  const lowerMessage = message.toLowerCase();
  const objectives: string[] = [];
  const constraints: string[] = [];
  const deliverables: string[] = [];
  const qualityCriteria: string[] = [];
  let deadline: string | null = null;

  for (const pattern of OBJECTIVE_PATTERNS) {
    const matches = message.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && match[1].trim().length > 3) {
        objectives.push(match[1].trim());
      }
    }
  }

  if (objectives.length === 0) {
    objectives.push(message.slice(0, 200).trim());
  }

  for (const pattern of CONSTRAINT_PATTERNS) {
    const matches = message.matchAll(pattern);
    for (const match of matches) {
      constraints.push(match[0].trim());
    }
  }

  for (const keyword of DELIVERABLE_KEYWORDS) {
    if (lowerMessage.includes(keyword)) {
      deliverables.push(keyword);
    }
  }

  for (const pattern of DEADLINE_PATTERNS) {
    const match = message.match(pattern);
    if (match) {
      deadline = match[1] || match[0];
      break;
    }
  }

  if (context.hasAttachments) {
    qualityCriteria.push("Procesar archivo(s) adjunto(s)");
  }
  if (subIntent === "summarize") {
    qualityCriteria.push("Resumen conciso y estructurado");
  }
  if (subIntent === "extract_table") {
    qualityCriteria.push("Tabla con datos bien formateados");
  }
  if (subIntent === "compare") {
    qualityCriteria.push("Comparación clara con diferencias destacadas");
  }
  if (deliverables.length > 0) {
    qualityCriteria.push(`Entregable: ${deliverables.join(", ")}`);
  }

  return {
    objectives,
    constraints,
    deliverables,
    qualityCriteria,
    deadline,
    detectedIntent: intent,
    detectedSubIntent: subIntent,
  };
}

export function alignAssumptions(
  parseResult: ParseResult,
  context: ContextSignals,
  confidence: number
): AlignResult {
  const assumptions: string[] = [];
  let clarificationNeeded = false;
  let clarificationQuestion: string | null = null;
  let clarificationOptions: string[] | null = null;

  if (parseResult.objectives.length === 0 || parseResult.objectives[0].length < 10) {
    if (confidence < 0.5) {
      clarificationNeeded = true;
      clarificationQuestion = "¿Podrías especificar qué deseas lograr?";
      clarificationOptions = ["Analizar contenido", "Crear documento", "Buscar información"];
    } else {
      assumptions.push("Objetivo inferido del contexto general del mensaje");
    }
  }

  if (context.hasAttachments && parseResult.deliverables.length === 0) {
    assumptions.push("Se asume que el usuario quiere analizar/procesar los archivos adjuntos");
  }

  if (!parseResult.deadline) {
    assumptions.push("Sin fecha límite especificada; se procede con prioridad normal");
  }

  if (parseResult.constraints.length === 0 && parseResult.detectedSubIntent === "summarize") {
    assumptions.push("Resumen en formato estándar (5-10 puntos clave)");
  }

  if (context.language === "mixed") {
    assumptions.push("Respuesta en el idioma predominante del mensaje");
  }

  const canProceed = !clarificationNeeded || confidence >= 0.75;

  return {
    assumptions,
    clarificationNeeded: clarificationNeeded && !canProceed,
    clarificationQuestion: canProceed ? null : clarificationQuestion,
    clarificationOptions: canProceed ? null : clarificationOptions,
    canProceed,
  };
}

export function reasonPlan(
  parseResult: ParseResult,
  alignResult: AlignResult,
  availableTools: string[]
): ReasonResult {
  const plan: PlanStep[] = [];
  const selectedTools: string[] = [];
  let stepNumber = 1;

  if (parseResult.detectedIntent === "analysis") {
    if (availableTools.includes("file_read")) {
      plan.push({
        step: stepNumber++,
        action: "Leer archivo(s) adjunto(s)",
        tool: "file_read",
        input: "Archivos del usuario",
        expectedOutput: "Contenido textual extraído",
      });
      selectedTools.push("file_read");
    }

    if (parseResult.detectedSubIntent === "summarize") {
      plan.push({
        step: stepNumber++,
        action: "Generar resumen estructurado",
        tool: "summarize",
        input: "Contenido del documento",
        expectedOutput: "Resumen con puntos clave",
      });
      if (availableTools.includes("summarize")) {
        selectedTools.push("summarize");
      }
    }

    if (parseResult.detectedSubIntent === "extract_table") {
      plan.push({
        step: stepNumber++,
        action: "Extraer datos tabulares",
        tool: "data_analyze",
        input: "Contenido estructurado",
        expectedOutput: "Tabla con datos extraídos",
      });
      if (availableTools.includes("data_analyze")) {
        selectedTools.push("data_analyze");
      }
    }

    if (parseResult.detectedSubIntent === "compare") {
      plan.push({
        step: stepNumber++,
        action: "Comparar documentos/datos",
        tool: "document_analyze",
        input: "Múltiples fuentes",
        expectedOutput: "Análisis comparativo con diferencias",
      });
      if (availableTools.includes("document_analyze")) {
        selectedTools.push("document_analyze");
      }
    }
  }

  if (parseResult.detectedIntent === "artifact") {
    plan.push({
      step: stepNumber++,
      action: "Planificar estructura del documento",
      tool: "plan",
      input: "Requisitos del usuario",
      expectedOutput: "Esquema del documento",
    });
    if (availableTools.includes("plan")) {
      selectedTools.push("plan");
    }

    plan.push({
      step: stepNumber++,
      action: "Generar documento",
      tool: "generate_document",
      input: "Esquema y contenido",
      expectedOutput: "Documento generado",
    });
    if (availableTools.includes("generate_document")) {
      selectedTools.push("generate_document");
    }
  }

  if (parseResult.detectedIntent === "nav") {
    if (parseResult.detectedSubIntent === "search_web") {
      plan.push({
        step: stepNumber++,
        action: "Buscar en la web",
        tool: "web_search",
        input: "Consulta del usuario",
        expectedOutput: "Resultados de búsqueda relevantes",
      });
      if (availableTools.includes("web_search")) {
        selectedTools.push("web_search");
      }
    }

    if (availableTools.includes("browse_url")) {
      plan.push({
        step: stepNumber++,
        action: "Navegar y extraer contenido",
        tool: "browse_url",
        input: "URL objetivo",
        expectedOutput: "Contenido de la página",
      });
      selectedTools.push("browse_url");
    }
  }

  if (parseResult.detectedIntent === "code") {
    if (parseResult.detectedSubIntent === "debug") {
      plan.push({
        step: stepNumber++,
        action: "Analizar código para errores",
        tool: "code_analyze",
        input: "Código del usuario",
        expectedOutput: "Diagnóstico de errores",
      });
      if (availableTools.includes("code_analyze")) {
        selectedTools.push("code_analyze");
      }
    }

    if (parseResult.detectedSubIntent === "refactor") {
      plan.push({
        step: stepNumber++,
        action: "Refactorizar código",
        tool: "code_analyze",
        input: "Código original",
        expectedOutput: "Código mejorado",
      });
      if (availableTools.includes("code_analyze")) {
        selectedTools.push("code_analyze");
      }
    }

    if (availableTools.includes("code_execute")) {
      plan.push({
        step: stepNumber++,
        action: "Ejecutar código",
        tool: "code_execute",
        input: "Código a ejecutar",
        expectedOutput: "Resultado de ejecución",
      });
      selectedTools.push("code_execute");
    }
  }

  plan.push({
    step: stepNumber++,
    action: "Validar y formatear respuesta",
    tool: null,
    input: "Resultados de pasos anteriores",
    expectedOutput: "Respuesta estructurada para el usuario",
  });

  const estimatedDurationMs = plan.length * 2000;

  return {
    plan,
    selectedTools: [...new Set(selectedTools)],
    estimatedSteps: plan.length,
    estimatedDurationMs,
  };
}

export function formatPAREOutput(context: PAREContext): PAREOutput {
  const understood = context.objectives.length > 0
    ? `Entendí que quieres: ${context.objectives.slice(0, 2).join("; ")}`
    : "Procesando tu solicitud...";

  const planSummary = context.plan.length > 0
    ? context.plan.map(p => `${p.step}. ${p.action}`).join("\n")
    : "Plan en desarrollo...";

  return {
    understood,
    plan: planSummary,
    assumptions: context.assumptions,
    clarification: context.clarificationNeeded ? context.clarificationQuestion : null,
  };
}

export function createEmptyPAREContext(): PAREContext {
  return {
    objectives: [],
    constraints: [],
    deliverables: [],
    qualityCriteria: [],
    deadline: null,
    assumptions: [],
    clarificationNeeded: false,
    clarificationQuestion: null,
    plan: [],
    selectedTools: [],
    estimatedSteps: 0,
    status: "pending",
    results: [],
    errors: [],
  };
}

export class PAREProtocol {
  private context: PAREContext;

  constructor() {
    this.context = createEmptyPAREContext();
  }

  parse(
    message: string,
    contextSignals: ContextSignals,
    intent: RobustIntent,
    subIntent: SubIntent | null
  ): ParseResult {
    const result = parseUserRequest(message, contextSignals, intent, subIntent);
    this.context.objectives = result.objectives;
    this.context.constraints = result.constraints;
    this.context.deliverables = result.deliverables;
    this.context.qualityCriteria = result.qualityCriteria;
    this.context.deadline = result.deadline;
    return result;
  }

  align(parseResult: ParseResult, contextSignals: ContextSignals, confidence: number): AlignResult {
    const result = alignAssumptions(parseResult, contextSignals, confidence);
    this.context.assumptions = result.assumptions;
    this.context.clarificationNeeded = result.clarificationNeeded;
    this.context.clarificationQuestion = result.clarificationQuestion;
    return result;
  }

  reason(parseResult: ParseResult, alignResult: AlignResult, tools: string[]): ReasonResult {
    const result = reasonPlan(parseResult, alignResult, tools);
    this.context.plan = result.plan;
    this.context.selectedTools = result.selectedTools;
    this.context.estimatedSteps = result.estimatedSteps;
    return result;
  }

  getContext(): PAREContext {
    return { ...this.context };
  }

  getOutput(): PAREOutput {
    return formatPAREOutput(this.context);
  }

  setStatus(status: PAREContext["status"]): void {
    this.context.status = status;
  }

  addResult(result: unknown): void {
    this.context.results.push(result);
  }

  addError(error: string): void {
    this.context.errors.push(error);
    this.context.status = "failed";
  }

  reset(): void {
    this.context = createEmptyPAREContext();
  }
}
