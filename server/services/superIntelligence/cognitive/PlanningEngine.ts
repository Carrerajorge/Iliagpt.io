/**
 * SUPERINTELLIGENCE - Planning Engine
 * Motor de planificación autónoma HTN (Hierarchical Task Network)
 * Fase 3: Arquitectura Cognitiva - Componente de Planificación
 */

import { EventEmitter } from 'events';
import { Logger } from '../../../lib/logger';

// Tipos de tareas
export type TaskType = 'primitive' | 'compound' | 'goal' | 'method';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked' | 'cancelled';
export type PlanStatus = 'planning' | 'ready' | 'executing' | 'completed' | 'failed' | 'replanning';

export interface Task {
  id: string;
  name: string;
  type: TaskType;
  description: string;
  status: TaskStatus;
  priority: number; // 1-10
  preconditions: Condition[];
  effects: Effect[];
  subtasks: Task[];
  parentId?: string;
  estimatedDuration: number; // minutes
  actualDuration?: number;
  assignedAgent?: string;
  resources: Resource[];
  constraints: Constraint[];
  metadata: Record<string, any>;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface Condition {
  id: string;
  type: 'state' | 'resource' | 'temporal' | 'dependency';
  expression: string;
  satisfied: boolean;
  checkFn?: (state: WorldState) => boolean;
}

export interface Effect {
  id: string;
  type: 'state_change' | 'resource_change' | 'side_effect';
  description: string;
  applyFn?: (state: WorldState) => WorldState;
}

export interface Resource {
  id: string;
  name: string;
  type: 'compute' | 'memory' | 'api' | 'time' | 'agent' | 'tool';
  required: number;
  available?: number;
  cost?: number;
}

export interface Constraint {
  id: string;
  type: 'temporal' | 'resource' | 'ordering' | 'mutex' | 'deadline';
  description: string;
  validateFn?: (plan: Plan, task: Task) => boolean;
}

export interface WorldState {
  facts: Map<string, any>;
  resources: Map<string, number>;
  activeAgents: string[];
  timestamp: Date;
}

export interface Plan {
  id: string;
  name: string;
  goal: string;
  status: PlanStatus;
  tasks: Task[];
  executionOrder: string[]; // Task IDs in order
  currentTaskIndex: number;
  totalEstimatedDuration: number;
  actualDuration: number;
  progress: number; // 0-100
  worldState: WorldState;
  alternatives: Plan[];
  contingencies: ContingencyPlan[];
  metrics: PlanMetrics;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface ContingencyPlan {
  triggerId: string;
  triggerCondition: string;
  alternativePlan: Plan;
  activated: boolean;
}

export interface PlanMetrics {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  blockedTasks: number;
  averageTaskDuration: number;
  resourceUtilization: number;
  replansCount: number;
}

export interface Method {
  id: string;
  name: string;
  applicableTo: string; // Task name pattern
  preconditions: Condition[];
  subtasks: string[]; // Task names to decompose into
  priority: number;
}

export interface PlanningResult {
  success: boolean;
  plan: Plan;
  alternatives: Plan[];
  warnings: string[];
  estimatedSuccess: number;
}

// Métodos de descomposición predefinidos
const DEFAULT_METHODS: Method[] = [
  {
    id: 'decompose_analysis',
    name: 'Descomponer Análisis',
    applicableTo: 'analyze_*',
    preconditions: [],
    subtasks: ['gather_data', 'process_data', 'generate_insights', 'create_report'],
    priority: 10,
  },
  {
    id: 'decompose_code_task',
    name: 'Descomponer Tarea de Código',
    applicableTo: 'code_*',
    preconditions: [],
    subtasks: ['understand_requirements', 'design_solution', 'implement_code', 'test_code', 'review_code'],
    priority: 10,
  },
  {
    id: 'decompose_research',
    name: 'Descomponer Investigación',
    applicableTo: 'research_*',
    preconditions: [],
    subtasks: ['define_scope', 'search_sources', 'evaluate_sources', 'synthesize_findings', 'document_results'],
    priority: 10,
  },
  {
    id: 'decompose_document',
    name: 'Descomponer Creación de Documento',
    applicableTo: 'create_document_*',
    preconditions: [],
    subtasks: ['outline_structure', 'write_content', 'review_content', 'format_document', 'finalize'],
    priority: 10,
  },
];

export class PlanningEngine extends EventEmitter {
  private static instance: PlanningEngine;
  private methods: Method[] = [...DEFAULT_METHODS];
  private activePlans: Map<string, Plan> = new Map();
  private taskTemplates: Map<string, Partial<Task>> = new Map();
  private readonly MAX_PLANNING_DEPTH = 10;
  private readonly MAX_ALTERNATIVES = 3;

  private constructor() {
    super();
    this.initializeTaskTemplates();
  }

  static getInstance(): PlanningEngine {
    if (!PlanningEngine.instance) {
      PlanningEngine.instance = new PlanningEngine();
    }
    return PlanningEngine.instance;
  }

  /**
   * Crear un plan para alcanzar un objetivo
   */
  async createPlan(
    goal: string,
    initialState?: Partial<WorldState>,
    constraints?: Constraint[]
  ): Promise<PlanningResult> {
    const planId = this.generateId();
    Logger.info(`[PlanningEngine] Creating plan ${planId} for goal: ${goal}`);

    // Inicializar estado del mundo
    const worldState: WorldState = {
      facts: new Map(Object.entries(initialState?.facts || {})),
      resources: new Map(Object.entries(initialState?.resources || {})),
      activeAgents: initialState?.activeAgents || ['default'],
      timestamp: new Date(),
    };

    // Crear plan inicial
    const plan: Plan = {
      id: planId,
      name: `Plan: ${goal.slice(0, 50)}`,
      goal,
      status: 'planning',
      tasks: [],
      executionOrder: [],
      currentTaskIndex: 0,
      totalEstimatedDuration: 0,
      actualDuration: 0,
      progress: 0,
      worldState,
      alternatives: [],
      contingencies: [],
      metrics: {
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        blockedTasks: 0,
        averageTaskDuration: 0,
        resourceUtilization: 0,
        replansCount: 0,
      },
      createdAt: new Date(),
    };

    this.activePlans.set(planId, plan);

    try {
      // Paso 1: Crear tarea raíz del objetivo
      const rootTask = this.createGoalTask(goal, constraints);
      plan.tasks.push(rootTask);

      // Paso 2: Descomponer jerárquicamente (HTN)
      await this.decomposeTask(plan, rootTask, 0);

      // Paso 3: Ordenar tareas (topological sort)
      plan.executionOrder = this.computeExecutionOrder(plan);

      // Paso 4: Calcular duración estimada
      plan.totalEstimatedDuration = this.calculateTotalDuration(plan);

      // Paso 5: Generar planes alternativos
      plan.alternatives = await this.generateAlternatives(plan, goal, worldState);

      // Paso 6: Crear planes de contingencia
      plan.contingencies = this.createContingencies(plan);

      // Actualizar métricas
      this.updatePlanMetrics(plan);

      plan.status = 'ready';

      const warnings = this.validatePlan(plan);
      const estimatedSuccess = this.estimateSuccessProbability(plan);

      this.emit('plan-created', { planId, plan });

      return {
        success: true,
        plan,
        alternatives: plan.alternatives,
        warnings,
        estimatedSuccess,
      };
    } catch (error) {
      Logger.error(`[PlanningEngine] Error creating plan ${planId}:`, error);
      plan.status = 'failed';

      return {
        success: false,
        plan,
        alternatives: [],
        warnings: [(error as Error).message],
        estimatedSuccess: 0,
      };
    }
  }

  /**
   * Crear tarea de objetivo
   */
  private createGoalTask(goal: string, constraints?: Constraint[]): Task {
    return {
      id: this.generateId(),
      name: this.parseGoalName(goal),
      type: 'goal',
      description: goal,
      status: 'pending',
      priority: 10,
      preconditions: [],
      effects: [{
        id: this.generateId(),
        type: 'state_change',
        description: `Goal achieved: ${goal}`,
      }],
      subtasks: [],
      estimatedDuration: 0,
      resources: [],
      constraints: constraints || [],
      metadata: { isRoot: true },
      createdAt: new Date(),
    };
  }

  /**
   * Parsear nombre del objetivo
   */
  private parseGoalName(goal: string): string {
    // Convertir objetivo a nombre de tarea
    const keywords = ['crear', 'analizar', 'investigar', 'generar', 'escribir', 'desarrollar',
                      'create', 'analyze', 'research', 'generate', 'write', 'develop'];

    const words = goal.toLowerCase().split(/\s+/);
    for (const word of words) {
      for (const keyword of keywords) {
        if (word.startsWith(keyword)) {
          return `${keyword}_task`;
        }
      }
    }

    return 'general_task';
  }

  /**
   * Descomponer tarea jerárquicamente
   */
  private async decomposeTask(plan: Plan, task: Task, depth: number): Promise<void> {
    if (depth >= this.MAX_PLANNING_DEPTH) {
      Logger.warn(`[PlanningEngine] Max depth reached for task ${task.id}`);
      return;
    }

    // Si es primitiva, no descomponer
    if (task.type === 'primitive') {
      return;
    }

    // Buscar método aplicable
    const method = this.findApplicableMethod(task);

    if (!method) {
      // Convertir a tarea primitiva si no hay método
      task.type = 'primitive';
      task.estimatedDuration = this.estimateTaskDuration(task);
      return;
    }

    // Crear subtareas según el método
    for (const subtaskName of method.subtasks) {
      const subtask = this.createSubtask(subtaskName, task.id);
      task.subtasks.push(subtask);
      plan.tasks.push(subtask);

      // Descomponer recursivamente
      await this.decomposeTask(plan, subtask, depth + 1);
    }

    // Actualizar duración estimada
    task.estimatedDuration = task.subtasks.reduce((sum, st) => sum + st.estimatedDuration, 0);
  }

  /**
   * Encontrar método aplicable
   */
  private findApplicableMethod(task: Task): Method | null {
    for (const method of this.methods) {
      const pattern = new RegExp(method.applicableTo.replace('*', '.*'));
      if (pattern.test(task.name)) {
        // Verificar precondiciones
        const allSatisfied = method.preconditions.every(p => p.satisfied);
        if (allSatisfied || method.preconditions.length === 0) {
          return method;
        }
      }
    }
    return null;
  }

  /**
   * Crear subtarea
   */
  private createSubtask(name: string, parentId: string): Task {
    const template = this.taskTemplates.get(name);

    return {
      id: this.generateId(),
      name,
      type: 'compound',
      description: template?.description || `Execute: ${name}`,
      status: 'pending',
      priority: template?.priority || 5,
      preconditions: template?.preconditions || [],
      effects: template?.effects || [],
      subtasks: [],
      parentId,
      estimatedDuration: template?.estimatedDuration || 5,
      resources: template?.resources || [],
      constraints: template?.constraints || [],
      metadata: {},
      createdAt: new Date(),
    };
  }

  /**
   * Calcular orden de ejecución (ordenamiento topológico)
   */
  private computeExecutionOrder(plan: Plan): string[] {
    const order: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (task: Task) => {
      if (visited.has(task.id)) return;
      if (visiting.has(task.id)) {
        Logger.warn(`[PlanningEngine] Circular dependency detected at task ${task.id}`);
        return;
      }

      visiting.add(task.id);

      // Visitar subtareas primero (dependencias)
      for (const subtask of task.subtasks) {
        visit(subtask);
      }

      visiting.delete(task.id);
      visited.add(task.id);

      // Solo agregar tareas primitivas al orden de ejecución
      if (task.type === 'primitive') {
        order.push(task.id);
      }
    };

    // Empezar desde tareas raíz
    for (const task of plan.tasks) {
      if (!task.parentId) {
        visit(task);
      }
    }

    return order;
  }

  /**
   * Calcular duración total
   */
  private calculateTotalDuration(plan: Plan): number {
    // Considerar paralelismo potencial
    const primitiveTasks = plan.tasks.filter(t => t.type === 'primitive');
    const totalSequential = primitiveTasks.reduce((sum, t) => sum + t.estimatedDuration, 0);

    // Asumir 30% de paralelismo posible
    return Math.ceil(totalSequential * 0.7);
  }

  /**
   * Generar planes alternativos
   */
  private async generateAlternatives(
    basePlan: Plan,
    goal: string,
    worldState: WorldState
  ): Promise<Plan[]> {
    const alternatives: Plan[] = [];

    // Alternativa 1: Orden diferente de prioridades
    const altPlan1 = this.clonePlan(basePlan);
    altPlan1.id = this.generateId();
    altPlan1.name = `${basePlan.name} (alt: priority-based)`;
    this.reorderByPriority(altPlan1);
    alternatives.push(altPlan1);

    // Alternativa 2: Minimizar recursos
    const altPlan2 = this.clonePlan(basePlan);
    altPlan2.id = this.generateId();
    altPlan2.name = `${basePlan.name} (alt: resource-efficient)`;
    this.optimizeForResources(altPlan2);
    alternatives.push(altPlan2);

    return alternatives.slice(0, this.MAX_ALTERNATIVES);
  }

  /**
   * Clonar plan
   */
  private clonePlan(plan: Plan): Plan {
    return JSON.parse(JSON.stringify(plan));
  }

  /**
   * Reordenar por prioridad
   */
  private reorderByPriority(plan: Plan): void {
    const primitiveTasks = plan.tasks.filter(t => t.type === 'primitive');
    primitiveTasks.sort((a, b) => b.priority - a.priority);
    plan.executionOrder = primitiveTasks.map(t => t.id);
  }

  /**
   * Optimizar para recursos
   */
  private optimizeForResources(plan: Plan): void {
    // Agrupar tareas que usan recursos similares
    const tasksByResource = new Map<string, Task[]>();

    for (const task of plan.tasks) {
      if (task.type !== 'primitive') continue;

      for (const resource of task.resources) {
        const tasks = tasksByResource.get(resource.type) || [];
        tasks.push(task);
        tasksByResource.set(resource.type, tasks);
      }
    }

    // Reordenar para minimizar cambios de contexto de recursos
    const newOrder: string[] = [];
    for (const [, tasks] of tasksByResource) {
      for (const task of tasks) {
        if (!newOrder.includes(task.id)) {
          newOrder.push(task.id);
        }
      }
    }

    plan.executionOrder = newOrder;
  }

  /**
   * Crear planes de contingencia
   */
  private createContingencies(plan: Plan): ContingencyPlan[] {
    const contingencies: ContingencyPlan[] = [];

    // Contingencia para tareas de alto riesgo
    const highPriorityTasks = plan.tasks.filter(t => t.priority >= 8 && t.type === 'primitive');

    for (const task of highPriorityTasks.slice(0, 3)) {
      contingencies.push({
        triggerId: task.id,
        triggerCondition: `Task ${task.name} fails`,
        alternativePlan: this.createSimplifiedPlan(plan, task),
        activated: false,
      });
    }

    return contingencies;
  }

  /**
   * Crear plan simplificado (para contingencia)
   */
  private createSimplifiedPlan(originalPlan: Plan, failedTask: Task): Plan {
    const simplified = this.clonePlan(originalPlan);
    simplified.id = this.generateId();
    simplified.name = `Contingency for ${failedTask.name}`;

    // Marcar la tarea fallida como saltada
    const task = simplified.tasks.find(t => t.id === failedTask.id);
    if (task) {
      task.status = 'cancelled';
    }

    // Recalcular orden sin la tarea fallida
    simplified.executionOrder = simplified.executionOrder.filter(id => id !== failedTask.id);

    return simplified;
  }

  /**
   * Validar plan
   */
  private validatePlan(plan: Plan): string[] {
    const warnings: string[] = [];

    // Verificar que hay tareas
    if (plan.tasks.length === 0) {
      warnings.push('El plan no tiene tareas');
    }

    // Verificar tareas sin asignar
    const unassignedTasks = plan.tasks.filter(t => t.type === 'primitive' && !t.assignedAgent);
    if (unassignedTasks.length > 0) {
      warnings.push(`${unassignedTasks.length} tareas sin agente asignado`);
    }

    // Verificar precondiciones no satisfechas
    const unsatisfiedPreconditions = plan.tasks
      .flatMap(t => t.preconditions)
      .filter(p => !p.satisfied);

    if (unsatisfiedPreconditions.length > 0) {
      warnings.push(`${unsatisfiedPreconditions.length} precondiciones no satisfechas`);
    }

    // Verificar recursos
    for (const task of plan.tasks) {
      for (const resource of task.resources) {
        if (resource.required > (resource.available || 0)) {
          warnings.push(`Recurso insuficiente: ${resource.name} para tarea ${task.name}`);
        }
      }
    }

    return warnings;
  }

  /**
   * Estimar probabilidad de éxito
   */
  private estimateSuccessProbability(plan: Plan): number {
    let probability = 1.0;

    // Penalizar por número de tareas
    probability *= Math.pow(0.98, plan.tasks.length);

    // Penalizar por tareas de alta complejidad
    const complexTasks = plan.tasks.filter(t => t.subtasks.length > 3);
    probability *= Math.pow(0.95, complexTasks.length);

    // Penalizar por precondiciones no satisfechas
    const unsatisfiedCount = plan.tasks
      .flatMap(t => t.preconditions)
      .filter(p => !p.satisfied).length;
    probability *= Math.pow(0.9, unsatisfiedCount);

    // Bonificar por tener contingencias
    probability += plan.contingencies.length * 0.02;

    return Math.min(0.99, Math.max(0.1, probability));
  }

  /**
   * Actualizar métricas del plan
   */
  private updatePlanMetrics(plan: Plan): void {
    const primitiveTasks = plan.tasks.filter(t => t.type === 'primitive');

    plan.metrics = {
      totalTasks: primitiveTasks.length,
      completedTasks: primitiveTasks.filter(t => t.status === 'completed').length,
      failedTasks: primitiveTasks.filter(t => t.status === 'failed').length,
      blockedTasks: primitiveTasks.filter(t => t.status === 'blocked').length,
      averageTaskDuration: primitiveTasks.length > 0
        ? primitiveTasks.reduce((sum, t) => sum + t.estimatedDuration, 0) / primitiveTasks.length
        : 0,
      resourceUtilization: 0, // Se actualiza durante ejecución
      replansCount: 0,
    };

    plan.progress = plan.metrics.totalTasks > 0
      ? (plan.metrics.completedTasks / plan.metrics.totalTasks) * 100
      : 0;
  }

  /**
   * Estimar duración de tarea
   */
  private estimateTaskDuration(task: Task): number {
    const baseDuration = 5; // minutos

    // Ajustar por complejidad del nombre
    const complexityKeywords = ['analyze', 'analizar', 'complex', 'complejo', 'deep', 'profundo'];
    const hasComplexity = complexityKeywords.some(k => task.name.toLowerCase().includes(k));

    return hasComplexity ? baseDuration * 2 : baseDuration;
  }

  /**
   * Inicializar templates de tareas
   */
  private initializeTaskTemplates(): void {
    // Templates básicos
    this.taskTemplates.set('gather_data', {
      description: 'Recopilar datos necesarios',
      priority: 8,
      estimatedDuration: 10,
      resources: [{ id: 'r1', name: 'API Access', type: 'api', required: 1 }],
    });

    this.taskTemplates.set('process_data', {
      description: 'Procesar y transformar datos',
      priority: 7,
      estimatedDuration: 15,
      resources: [{ id: 'r2', name: 'Compute', type: 'compute', required: 2 }],
    });

    this.taskTemplates.set('generate_insights', {
      description: 'Generar insights a partir del análisis',
      priority: 9,
      estimatedDuration: 20,
      resources: [{ id: 'r3', name: 'LLM', type: 'api', required: 1 }],
    });

    this.taskTemplates.set('create_report', {
      description: 'Crear reporte final',
      priority: 6,
      estimatedDuration: 10,
    });

    this.taskTemplates.set('understand_requirements', {
      description: 'Entender requerimientos del código',
      priority: 9,
      estimatedDuration: 5,
    });

    this.taskTemplates.set('design_solution', {
      description: 'Diseñar solución técnica',
      priority: 8,
      estimatedDuration: 15,
    });

    this.taskTemplates.set('implement_code', {
      description: 'Implementar código',
      priority: 10,
      estimatedDuration: 30,
      resources: [{ id: 'r4', name: 'Code Agent', type: 'agent', required: 1 }],
    });

    this.taskTemplates.set('test_code', {
      description: 'Ejecutar pruebas',
      priority: 8,
      estimatedDuration: 10,
    });

    this.taskTemplates.set('review_code', {
      description: 'Revisar código',
      priority: 7,
      estimatedDuration: 10,
    });
  }

  // Gestión de planes
  getPlan(planId: string): Plan | undefined {
    return this.activePlans.get(planId);
  }

  getAllPlans(): Plan[] {
    return Array.from(this.activePlans.values());
  }

  deletePlan(planId: string): boolean {
    return this.activePlans.delete(planId);
  }

  // Gestión de métodos
  addMethod(method: Method): void {
    this.methods.push(method);
    this.methods.sort((a, b) => b.priority - a.priority);
  }

  // Utilidades
  private generateId(): string {
    return `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Singleton export
export const planningEngine = PlanningEngine.getInstance();
