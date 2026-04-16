import { nanoid } from "nanoid";
import type {
  IntentType,
  OutputFormat,
  Slots
} from "../../../shared/schemas/intent";

export interface StepConstraints {
  max_output_size: number;
  allowed_formats: OutputFormat[];
  timeout_ms: number;
  requires_document_source?: boolean;
  requires_web_source?: boolean;
}

export interface PlanConstraints {
  max_total_duration_ms: number;
  max_parallel_steps: number;
  allow_partial_failure: boolean;
}

export interface PlanStep {
  id: string;
  intent: IntentType;
  slots: Record<string, unknown>;
  output_format: OutputFormat;
  constraints: StepConstraints;
  depends_on: string[];
  inherits_from?: string;
}

export interface ExecutionPlan {
  id: string;
  steps: PlanStep[];
  dependencies: Map<string, string[]>;
  execution_order: string[][];
  estimated_duration_ms: number;
  constraints: PlanConstraints;
  is_valid: boolean;
  validation_errors: string[];
}

export interface IntentInput {
  intent: IntentType;
  output_format: OutputFormat;
  slots: Slots;
  confidence?: number;
}

const DEFAULT_STEP_CONSTRAINTS: Record<IntentType, StepConstraints> = {
  ANALYZE_DOCUMENT: {
    max_output_size: 10 * 1024 * 1024,
    allowed_formats: ["txt", "pdf", "docx"],
    timeout_ms: 60000,
    requires_document_source: true
  },
  SEARCH_WEB: {
    max_output_size: 1 * 1024 * 1024,
    allowed_formats: ["txt", "html"],
    timeout_ms: 30000
  },
  SUMMARIZE: {
    max_output_size: 500 * 1024,
    allowed_formats: ["txt", "docx", "pdf"],
    timeout_ms: 45000
  },
  CREATE_PRESENTATION: {
    max_output_size: 50 * 1024 * 1024,
    allowed_formats: ["pptx"],
    timeout_ms: 120000
  },
  CREATE_DOCUMENT: {
    max_output_size: 20 * 1024 * 1024,
    allowed_formats: ["docx", "pdf", "txt"],
    timeout_ms: 90000
  },
  CREATE_SPREADSHEET: {
    max_output_size: 30 * 1024 * 1024,
    allowed_formats: ["xlsx", "csv"],
    timeout_ms: 90000
  },
  TRANSLATE: {
    max_output_size: 10 * 1024 * 1024,
    allowed_formats: ["txt", "docx", "pdf"],
    timeout_ms: 60000
  },
  CHAT_GENERAL: {
    max_output_size: 100 * 1024,
    allowed_formats: ["txt"],
    timeout_ms: 30000
  },
  NEED_CLARIFICATION: {
    max_output_size: 10 * 1024,
    allowed_formats: ["txt"],
    timeout_ms: 5000
  }
};

const ESTIMATED_DURATION_MS: Record<IntentType, number> = {
  ANALYZE_DOCUMENT: 15000,
  SEARCH_WEB: 8000,
  SUMMARIZE: 12000,
  CREATE_PRESENTATION: 45000,
  CREATE_DOCUMENT: 30000,
  CREATE_SPREADSHEET: 25000,
  TRANSLATE: 10000,
  CHAT_GENERAL: 5000,
  NEED_CLARIFICATION: 1000
};

const DEPENDENCY_RULES: Record<IntentType, {
  can_feed: IntentType[];
  requires_from?: IntentType[];
}> = {
  ANALYZE_DOCUMENT: {
    can_feed: ["SUMMARIZE", "CREATE_DOCUMENT", "CREATE_PRESENTATION", "TRANSLATE"]
  },
  SEARCH_WEB: {
    can_feed: ["CREATE_PRESENTATION", "CREATE_DOCUMENT", "CREATE_SPREADSHEET", "SUMMARIZE"]
  },
  SUMMARIZE: {
    can_feed: ["CREATE_PRESENTATION", "CREATE_DOCUMENT", "TRANSLATE"]
  },
  CREATE_SPREADSHEET: {
    can_feed: ["CREATE_PRESENTATION"]
  },
  TRANSLATE: {
    can_feed: ["CREATE_DOCUMENT", "CREATE_PRESENTATION"]
  },
  CREATE_PRESENTATION: {
    can_feed: []
  },
  CREATE_DOCUMENT: {
    can_feed: ["TRANSLATE"]
  },
  CHAT_GENERAL: {
    can_feed: []
  },
  NEED_CLARIFICATION: {
    can_feed: []
  }
};

const DATA_PROVIDER_INTENTS: IntentType[] = [
  "ANALYZE_DOCUMENT",
  "SEARCH_WEB",
  "SUMMARIZE",
  "CREATE_SPREADSHEET"
];

const CONTENT_CREATION_INTENTS: IntentType[] = [
  "CREATE_PRESENTATION",
  "CREATE_DOCUMENT",
  "CREATE_SPREADSHEET"
];

export function getStepDependencies(intent: IntentType): {
  can_feed: IntentType[];
  requires_from: IntentType[];
} {
  const rule = DEPENDENCY_RULES[intent];
  return {
    can_feed: rule?.can_feed || [],
    requires_from: rule?.requires_from || []
  };
}

export function getDefaultConstraints(intent: IntentType): StepConstraints {
  return { ...DEFAULT_STEP_CONSTRAINTS[intent] };
}

function detectCircularDependency(
  dependencies: Map<string, string[]>
): { hasCircle: boolean; cycle: string[] } {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): boolean {
    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const deps = dependencies.get(node) || [];
    for (const dep of deps) {
      if (!visited.has(dep)) {
        if (dfs(dep)) return true;
      } else if (recursionStack.has(dep)) {
        path.push(dep);
        return true;
      }
    }

    path.pop();
    recursionStack.delete(node);
    return false;
  }

  for (const node of dependencies.keys()) {
    if (!visited.has(node)) {
      if (dfs(node)) {
        const cycleStart = path.lastIndexOf(path[path.length - 1]);
        return { hasCircle: true, cycle: path.slice(cycleStart) };
      }
    }
  }

  return { hasCircle: false, cycle: [] };
}

function topologicalSortWithParallelGroups(
  steps: PlanStep[],
  dependencies: Map<string, string[]>
): string[][] {
  const inDegree = new Map<string, number>();
  const graph = new Map<string, string[]>();

  for (const step of steps) {
    inDegree.set(step.id, 0);
    graph.set(step.id, []);
  }

  for (const [stepId, deps] of dependencies) {
    for (const dep of deps) {
      if (graph.has(dep)) {
        graph.get(dep)!.push(stepId);
        inDegree.set(stepId, (inDegree.get(stepId) || 0) + 1);
      }
    }
  }

  const executionOrder: string[][] = [];
  const remaining = new Set(steps.map(s => s.id));

  while (remaining.size > 0) {
    const parallelGroup: string[] = [];

    for (const stepId of remaining) {
      const degree = inDegree.get(stepId) || 0;
      if (degree === 0) {
        parallelGroup.push(stepId);
      }
    }

    if (parallelGroup.length === 0) {
      break;
    }

    executionOrder.push(parallelGroup);

    for (const stepId of parallelGroup) {
      remaining.delete(stepId);
      for (const neighbor of graph.get(stepId) || []) {
        inDegree.set(neighbor, (inDegree.get(neighbor) || 1) - 1);
      }
    }
  }

  return executionOrder;
}

function inferDependencies(
  intents: IntentInput[],
  isSequential: boolean
): Map<string, { depends: string[]; intent: IntentType }> {
  const stepMap = new Map<string, { depends: string[]; intent: IntentType }>();
  const stepIds: string[] = [];

  for (let i = 0; i < intents.length; i++) {
    const id = `step_${i + 1}`;
    stepIds.push(id);
    stepMap.set(id, { depends: [], intent: intents[i].intent });
  }

  for (let i = 0; i < intents.length; i++) {
    const currentId = stepIds[i];
    const currentIntent = intents[i].intent;
    const currentEntry = stepMap.get(currentId)!;

    if (isSequential && i > 0) {
      currentEntry.depends.push(stepIds[i - 1]);
    } else {
      for (let j = 0; j < i; j++) {
        const prevIntent = intents[j].intent;
        const prevDeps = getStepDependencies(prevIntent);

        if (prevDeps.can_feed.includes(currentIntent)) {
          currentEntry.depends.push(stepIds[j]);
        }
      }
    }

    if (DATA_PROVIDER_INTENTS.includes(currentIntent) === false &&
        CONTENT_CREATION_INTENTS.includes(currentIntent)) {
      for (let j = 0; j < i; j++) {
        const prevIntent = intents[j].intent;
        if (DATA_PROVIDER_INTENTS.includes(prevIntent) &&
            !currentEntry.depends.includes(stepIds[j])) {
          const canFeed = getStepDependencies(prevIntent).can_feed;
          if (canFeed.includes(currentIntent)) {
            currentEntry.depends.push(stepIds[j]);
          }
        }
      }
    }
  }

  return stepMap;
}

function inheritSlots(
  currentSlots: Slots,
  dependentSteps: PlanStep[]
): Record<string, unknown> {
  const inherited: Record<string, unknown> = {};

  for (const step of dependentSteps) {
    for (const [key, value] of Object.entries(step.slots)) {
      if (value !== undefined && inherited[key] === undefined) {
        inherited[key] = value;
      }
    }
  }

  for (const [key, value] of Object.entries(currentSlots)) {
    if (value !== undefined) {
      inherited[key] = value;
    }
  }

  return inherited;
}

function detectConflictingFormats(intents: IntentInput[]): {
  hasConflict: boolean;
  conflictingIntents: IntentType[];
} {
  const creationIntents = intents.filter(i =>
    CONTENT_CREATION_INTENTS.includes(i.intent)
  );

  if (creationIntents.length <= 1) {
    return { hasConflict: false, conflictingIntents: [] };
  }

  const formats = new Set(creationIntents.map(i => i.intent));
  if (formats.size > 1) {
    return {
      hasConflict: true,
      conflictingIntents: creationIntents.map(i => i.intent)
    };
  }

  return { hasConflict: false, conflictingIntents: [] };
}

export function createExecutionPlan(
  intents: IntentInput[],
  sharedSlots: Slots = {},
  options: {
    isSequential?: boolean;
    validateConstraints?: boolean;
  } = {}
): ExecutionPlan {
  const { isSequential = false, validateConstraints = true } = options;

  if (intents.length === 0) {
    return {
      id: nanoid(),
      steps: [],
      dependencies: new Map(),
      execution_order: [],
      estimated_duration_ms: 0,
      constraints: {
        max_total_duration_ms: 0,
        max_parallel_steps: 1,
        allow_partial_failure: false
      },
      is_valid: true,
      validation_errors: []
    };
  }

  const inferredDeps = inferDependencies(intents, isSequential);
  const steps: PlanStep[] = [];
  const dependencies = new Map<string, string[]>();
  const stepById = new Map<string, PlanStep>();

  const { hasConflict, conflictingIntents } = detectConflictingFormats(intents);
  if (hasConflict && !isSequential) {
  }

  for (let i = 0; i < intents.length; i++) {
    const input = intents[i];
    const stepId = `step_${i + 1}`;
    const inferredEntry = inferredDeps.get(stepId)!;

    const dependentSteps = inferredEntry.depends
      .map(depId => stepById.get(depId))
      .filter((s): s is PlanStep => s !== undefined);

    const inheritedSlots = inheritSlots(
      { ...sharedSlots, ...input.slots },
      dependentSteps
    );

    const step: PlanStep = {
      id: stepId,
      intent: input.intent,
      slots: inheritedSlots,
      output_format: input.output_format,
      constraints: getDefaultConstraints(input.intent),
      depends_on: inferredEntry.depends,
      inherits_from: dependentSteps.length > 0 ? dependentSteps[0].id : undefined
    };

    steps.push(step);
    stepById.set(stepId, step);
    dependencies.set(stepId, inferredEntry.depends);
  }

  const circularCheck = detectCircularDependency(dependencies);
  if (circularCheck.hasCircle) {
    return {
      id: nanoid(),
      steps,
      dependencies,
      execution_order: [],
      estimated_duration_ms: 0,
      constraints: {
        max_total_duration_ms: 0,
        max_parallel_steps: 1,
        allow_partial_failure: false
      },
      is_valid: false,
      validation_errors: [
        `Circular dependency detected: ${circularCheck.cycle.join(" -> ")}`
      ]
    };
  }

  const execution_order = topologicalSortWithParallelGroups(steps, dependencies);

  let estimated_duration_ms = 0;
  for (const group of execution_order) {
    const groupDurations = group.map(stepId => {
      const step = stepById.get(stepId);
      return step ? ESTIMATED_DURATION_MS[step.intent] : 0;
    });
    estimated_duration_ms += Math.max(...groupDurations);
  }

  const maxParallelSteps = Math.max(...execution_order.map(g => g.length), 1);

  const plan: ExecutionPlan = {
    id: nanoid(),
    steps,
    dependencies,
    execution_order,
    estimated_duration_ms,
    constraints: {
      max_total_duration_ms: estimated_duration_ms * 2,
      max_parallel_steps: maxParallelSteps,
      allow_partial_failure: steps.length > 2
    },
    is_valid: true,
    validation_errors: []
  };

  if (validateConstraints) {
    const validationResult = validatePlanConstraints(plan);
    plan.is_valid = validationResult.is_valid;
    plan.validation_errors = validationResult.errors;
  }

  return plan;
}

export interface ValidationResult {
  is_valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validatePlanConstraints(plan: ExecutionPlan): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (plan.steps.length === 0) {
    return { is_valid: true, errors: [], warnings: [] };
  }

  const stepIds = new Set(plan.steps.map(s => s.id));
  for (const step of plan.steps) {
    for (const depId of step.depends_on) {
      if (!stepIds.has(depId)) {
        errors.push(`Step "${step.id}" depends on non-existent step "${depId}"`);
      }
    }
  }

  for (const step of plan.steps) {
    if (step.output_format) {
      if (!step.constraints.allowed_formats.includes(step.output_format)) {
        errors.push(
          `Step "${step.id}" output format "${step.output_format}" not in allowed formats: ${step.constraints.allowed_formats.join(", ")}`
        );
      }
    }
  }

  const circularCheck = detectCircularDependency(plan.dependencies);
  if (circularCheck.hasCircle) {
    errors.push(`Circular dependency detected: ${circularCheck.cycle.join(" -> ")}`);
  }

  let totalMaxTimeout = 0;
  for (const step of plan.steps) {
    totalMaxTimeout += step.constraints.timeout_ms;
  }
  if (totalMaxTimeout > plan.constraints.max_total_duration_ms * 2) {
    warnings.push(
      `Total step timeouts (${totalMaxTimeout}ms) exceed 2x estimated duration (${plan.constraints.max_total_duration_ms}ms)`
    );
  }

  for (const step of plan.steps) {
    if (step.constraints.requires_document_source && !step.slots.topic) {
      warnings.push(`Step "${step.id}" requires a document source but no topic is specified`);
    }
  }

  for (const group of plan.execution_order) {
    if (group.length > 5) {
      warnings.push(`Parallel group has ${group.length} steps, which may cause resource contention`);
    }
  }

  return {
    is_valid: errors.length === 0,
    errors,
    warnings
  };
}

export function getParallelGroups(plan: ExecutionPlan): PlanStep[][] {
  return plan.execution_order.map(group =>
    group.map(stepId => plan.steps.find(s => s.id === stepId)!).filter(Boolean)
  );
}

export function canExecuteInParallel(
  stepA: PlanStep,
  stepB: PlanStep,
  plan: ExecutionPlan
): boolean {
  const aDepsOnB = stepA.depends_on.includes(stepB.id);
  const bDepsOnA = stepB.depends_on.includes(stepA.id);

  if (aDepsOnB || bDepsOnA) return false;

  for (const group of plan.execution_order) {
    if (group.includes(stepA.id) && group.includes(stepB.id)) {
      return true;
    }
  }

  return false;
}

export function getStepOutput(step: PlanStep): {
  format: OutputFormat;
  estimated_size: number;
  can_feed: IntentType[];
} {
  const deps = getStepDependencies(step.intent);
  return {
    format: step.output_format,
    estimated_size: step.constraints.max_output_size,
    can_feed: deps.can_feed
  };
}

export function serializeExecutionPlan(plan: ExecutionPlan): Record<string, unknown> {
  return {
    id: plan.id,
    steps: plan.steps,
    dependencies: Object.fromEntries(plan.dependencies),
    execution_order: plan.execution_order,
    estimated_duration_ms: plan.estimated_duration_ms,
    constraints: plan.constraints,
    is_valid: plan.is_valid,
    validation_errors: plan.validation_errors
  };
}

export function deserializeExecutionPlan(data: Record<string, unknown>): ExecutionPlan {
  return {
    id: data.id as string,
    steps: data.steps as PlanStep[],
    dependencies: new Map(Object.entries(data.dependencies as Record<string, string[]>)),
    execution_order: data.execution_order as string[][],
    estimated_duration_ms: data.estimated_duration_ms as number,
    constraints: data.constraints as PlanConstraints,
    is_valid: data.is_valid as boolean,
    validation_errors: data.validation_errors as string[]
  };
}
