import type {
  IntentType,
  OutputFormat,
  Slots,
  SingleIntentResult,
  PlanStep,
  MultiIntentResult
} from "../../../shared/schemas/intent";
import {
  createExecutionPlan,
  validatePlanConstraints,
  getStepDependencies,
  serializeExecutionPlan,
  type ExecutionPlan,
  type IntentInput,
  type PlanStep as FullPlanStep
} from "./intentPlanner";

const MULTI_INTENT_PATTERNS: Array<{
  pattern: RegExp;
  separator: "and" | "then" | "list";
}> = [
  { pattern: /\b(y\s+tambien|y\s+también|and\s+also|and\s+then|puis|und\s+dann)\b/i, separator: "and" },
  { pattern: /\b(despues|después|then|after\s+that|ensuite|danach|poi)\b/i, separator: "then" },
  { pattern: /\b(primero.*(?:segundo|luego)|first.*(?:second|then)|d'abord.*ensuite|zuerst.*dann)\b/i, separator: "then" },
  { pattern: /\d+\)\s+.*\d+\)\s+/m, separator: "list" },
  { pattern: /[-•]\s+.*[-•]\s+/m, separator: "list" }
];

const INTENT_COMBINATIONS: Array<{
  patterns: RegExp[];
  intents: IntentType[];
}> = [
  {
    patterns: [/\b(busca|search|recherch)\b/i, /\b(presenta|presentation|pptx?)\b/i],
    intents: ["SEARCH_WEB", "CREATE_PRESENTATION"]
  },
  {
    patterns: [/\b(analiz|analy[sz]e|examin)\b/i, /\b(resum|summar)\b/i],
    intents: ["ANALYZE_DOCUMENT", "SUMMARIZE"]
  },
  {
    patterns: [/\b(traduc|translat)\b/i, /\b(document|word|docx?)\b/i],
    intents: ["TRANSLATE", "CREATE_DOCUMENT"]
  },
  {
    patterns: [/\b(busca|search)\b/i, /\b(excel|spreadsheet|tabla)\b/i],
    intents: ["SEARCH_WEB", "CREATE_SPREADSHEET"]
  }
];

export interface MultiIntentDetectionResult {
  isMultiIntent: boolean;
  detectedIntents: IntentType[];
  separatorType: "and" | "then" | "list" | "implicit" | null;
  segments: string[];
  requiresSequentialExecution: boolean;
}

export interface EnhancedMultiIntentPlan {
  executionPlan: ExecutionPlan;
  serializedPlan: Record<string, unknown>;
  legacyPlan: MultiIntentResult["plan"];
  slotInheritanceMap: Map<string, string>;
}

export function detectMultiIntent(normalizedText: string): MultiIntentDetectionResult {
  for (const combo of INTENT_COMBINATIONS) {
    const allMatch = combo.patterns.every(p => p.test(normalizedText));
    if (allMatch) {
      return {
        isMultiIntent: true,
        detectedIntents: combo.intents,
        separatorType: "implicit",
        segments: [normalizedText],
        requiresSequentialExecution: combo.intents[0] === "SEARCH_WEB"
      };
    }
  }

  for (const { pattern, separator } of MULTI_INTENT_PATTERNS) {
    if (pattern.test(normalizedText)) {
      let segments: string[] = [];
      
      if (separator === "list") {
        segments = normalizedText.split(/(?:\d+\)|[-•])\s+/).filter(s => s.trim());
      } else {
        const splitPattern = separator === "and"
          ? /\s+(?:y\s+tambien|y\s+también|and\s+also|and\s+then|puis|und\s+dann)\s+/i
          : /\s+(?:despues|después|then|after\s+that|ensuite|danach|poi)\s+/i;
        segments = normalizedText.split(splitPattern).filter(s => s.trim());
      }

      if (segments.length > 1) {
        return {
          isMultiIntent: true,
          detectedIntents: [],
          separatorType: separator,
          segments,
          requiresSequentialExecution: separator === "then"
        };
      }
    }
  }

  return {
    isMultiIntent: false,
    detectedIntents: [],
    separatorType: null,
    segments: [normalizedText],
    requiresSequentialExecution: false
  };
}

export function buildEnhancedExecutionPlan(
  intents: SingleIntentResult[],
  options: {
    isSequential?: boolean;
    sharedSlots?: Slots;
  } = {}
): EnhancedMultiIntentPlan {
  const { isSequential = false, sharedSlots = {} } = options;

  const intentInputs: IntentInput[] = intents.map(intent => ({
    intent: intent.intent,
    output_format: intent.output_format,
    slots: intent.slots,
    confidence: intent.confidence
  }));

  const executionPlan = createExecutionPlan(intentInputs, sharedSlots, {
    isSequential,
    validateConstraints: true
  });

  const slotInheritanceMap = new Map<string, string>();
  for (const step of executionPlan.steps) {
    if (step.inherits_from) {
      slotInheritanceMap.set(step.id, step.inherits_from);
    }
  }

  const legacyPlan = convertToLegacyPlan(executionPlan);

  return {
    executionPlan,
    serializedPlan: serializeExecutionPlan(executionPlan),
    legacyPlan,
    slotInheritanceMap
  };
}

function convertToLegacyPlan(plan: ExecutionPlan): MultiIntentResult["plan"] {
  const steps: PlanStep[] = plan.steps.map((step, index) => ({
    step_id: index + 1,
    intent: step.intent,
    output_format: step.output_format,
    slots: step.slots as Slots,
    depends_on: step.depends_on.map(depId => {
      const depIndex = plan.steps.findIndex(s => s.id === depId);
      return depIndex + 1;
    }).filter(id => id > 0)
  }));

  const execution_order = plan.execution_order.flat().map(stepId => {
    const index = plan.steps.findIndex(s => s.id === stepId);
    return index + 1;
  });

  return { steps, execution_order };
}

export function buildExecutionPlan(
  intents: SingleIntentResult[]
): MultiIntentResult["plan"] {
  if (intents.length === 0) {
    return { steps: [], execution_order: [] };
  }

  const enhanced = buildEnhancedExecutionPlan(intents);
  return enhanced.legacyPlan;
}

function topologicalSort(n: number, deps: Map<number, number[]>): number[] {
  const inDegree = new Map<number, number>();
  const graph = new Map<number, number[]>();

  for (let i = 1; i <= n; i++) {
    inDegree.set(i, 0);
    graph.set(i, []);
  }

  for (const [node, dependencies] of deps) {
    for (const dep of dependencies) {
      graph.get(dep)?.push(node);
      inDegree.set(node, (inDegree.get(node) || 0) + 1);
    }
  }

  const queue: number[] = [];
  for (const [node, degree] of inDegree) {
    if (degree === 0) {
      queue.push(node);
    }
  }

  const result: number[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    for (const neighbor of graph.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  return result.length === n ? result : Array.from({ length: n }, (_, i) => i + 1);
}

export function generateDisambiguationQuestion(
  detectedIntents: IntentType[],
  locale: string
): string {
  const questions: Record<string, Record<string, string>> = {
    format: {
      es: "¿En qué formato lo quieres? (PowerPoint, Word o Excel)",
      en: "What format would you like? (PowerPoint, Word, or Excel)",
      pt: "Em que formato você quer? (PowerPoint, Word ou Excel)",
      fr: "Quel format souhaitez-vous ? (PowerPoint, Word ou Excel)",
      de: "Welches Format möchten Sie? (PowerPoint, Word oder Excel)",
      it: "Quale formato preferisci? (PowerPoint, Word o Excel)"
    },
    order: {
      es: "¿Quieres que primero busque la información y luego cree el documento?",
      en: "Would you like me to search for information first and then create the document?",
      pt: "Quer que eu primeiro busque as informações e depois crie o documento?",
      fr: "Voulez-vous que je recherche d'abord les informations puis crée le document ?",
      de: "Möchten Sie, dass ich zuerst nach Informationen suche und dann das Dokument erstelle?",
      it: "Vuoi che prima cerchi le informazioni e poi crei il documento?"
    },
    priority: {
      es: "Detecto múltiples tareas. ¿Cuál te gustaría que haga primero?",
      en: "I detect multiple tasks. Which would you like me to do first?",
      pt: "Detecto múltiplas tarefas. Qual você gostaria que eu fizesse primeiro?",
      fr: "Je détecte plusieurs tâches. Laquelle voulez-vous que je fasse en premier ?",
      de: "Ich erkenne mehrere Aufgaben. Welche soll ich zuerst erledigen?",
      it: "Rilevo più attività. Quale vorresti che facessi prima?"
    }
  };

  const hasSearch = detectedIntents.includes("SEARCH_WEB");
  const hasCreate = detectedIntents.some(i => 
    i === "CREATE_PRESENTATION" || i === "CREATE_DOCUMENT" || i === "CREATE_SPREADSHEET"
  );

  if (hasSearch && hasCreate) {
    return questions.order[locale] || questions.order.en;
  }

  const createIntents = detectedIntents.filter(i =>
    i === "CREATE_PRESENTATION" || i === "CREATE_DOCUMENT" || i === "CREATE_SPREADSHEET"
  );

  if (createIntents.length > 1) {
    return questions.format[locale] || questions.format.en;
  }

  if (detectedIntents.length > 1) {
    return questions.priority[locale] || questions.priority.en;
  }

  return questions.format[locale] || questions.format.en;
}

export function mergeSlots(slotsArray: Slots[]): Slots {
  const merged: Slots = {};

  for (const slots of slotsArray) {
    for (const [key, value] of Object.entries(slots)) {
      if (value !== undefined && merged[key as keyof Slots] === undefined) {
        (merged as any)[key] = value;
      }
    }
  }

  return merged;
}

export function inheritSlotsForStep(
  stepId: string,
  plan: ExecutionPlan
): Record<string, unknown> {
  const step = plan.steps.find(s => s.id === stepId);
  if (!step) return {};

  const inheritedSlots: Record<string, unknown> = {};

  for (const depId of step.depends_on) {
    const depStep = plan.steps.find(s => s.id === depId);
    if (depStep) {
      for (const [key, value] of Object.entries(depStep.slots)) {
        if (value !== undefined && inheritedSlots[key] === undefined) {
          inheritedSlots[key] = value;
        }
      }
    }
  }

  for (const [key, value] of Object.entries(step.slots)) {
    if (value !== undefined) {
      inheritedSlots[key] = value;
    }
  }

  return inheritedSlots;
}

export function getExecutableSteps(
  plan: ExecutionPlan,
  completedSteps: Set<string>
): string[] {
  const executable: string[] = [];

  for (const step of plan.steps) {
    if (completedSteps.has(step.id)) continue;

    const allDepsCompleted = step.depends_on.every(depId => completedSteps.has(depId));
    if (allDepsCompleted) {
      executable.push(step.id);
    }
  }

  return executable;
}

export function validateMultiIntentPlan(
  plan: ExecutionPlan
): { isValid: boolean; errors: string[] } {
  const validation = validatePlanConstraints(plan);
  return {
    isValid: validation.is_valid,
    errors: [...validation.errors, ...validation.warnings]
  };
}

export { getStepDependencies, createExecutionPlan, validatePlanConstraints };
export type { ExecutionPlan, IntentInput, EnhancedMultiIntentPlan };
