/**
 * Hierarchical Task Network (HTN) Planner for ILIAGPT PRO 3.0
 * 
 * Planificador jerárquico que descompone objetivos complejos en subtareas
 * ejecutables, con soporte para replanificación y optimización.
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";

// ============================================
// Types and Interfaces
// ============================================

export type TaskStatus = 'pending' | 'ready' | 'executing' | 'completed' | 'failed' | 'cancelled';
export type TaskType = 'primitive' | 'compound';

export interface WorldState {
    facts: Map<string, any>;
    resources: Map<string, number>;
    timestamp: Date;
}

export interface Condition {
    type: 'fact' | 'resource' | 'custom';
    key: string;
    operator: 'equals' | 'not_equals' | 'greater' | 'less' | 'exists' | 'not_exists' | 'contains';
    value?: any;
    customCheck?: (state: WorldState) => boolean;
}

export interface Effect {
    type: 'set_fact' | 'delete_fact' | 'modify_resource' | 'custom';
    key: string;
    value?: any;
    delta?: number;
    customApply?: (state: WorldState) => void;
}

export interface Task {
    id: string;
    name: string;
    type: TaskType;
    description: string;
    preconditions: Condition[];
    effects: Effect[];
    cost: number;
    estimatedDuration: number; // milliseconds
    priority: number;

    // For compound tasks
    subtasks?: Task[];
    decompositionMethods?: DecompositionMethod[];

    // Execution details
    toolName?: string;
    toolParams?: Record<string, any>;
    agentId?: string;
    canRunParallel?: boolean; // If false, task runs isolated from others
    compensationTool?: string; // Tool to call if plan fails after this task completes
    compensationParams?: Record<string, any>;

    // Runtime state
    status: TaskStatus;
    result?: any;
    error?: string;
    startTime?: Date;
    endTime?: Date;
    retryCount: number;
    maxRetries: number;

    // Dependencies
    dependencies: string[]; // Task IDs that must complete first
    dependents: string[];   // Task IDs waiting on this task
}

export interface DecompositionMethod {
    id: string;
    name: string;
    applicabilityConditions: Condition[];
    subtasks: Omit<Task, 'id' | 'status' | 'retryCount'>[];
    priority: number;
}

export interface Plan {
    id: string;
    goal: string;
    rootTask: Task;
    allTasks: Map<string, Task>;
    executionOrder: string[];
    status: 'planning' | 'ready' | 'executing' | 'completed' | 'failed' | 'replanning';

    metadata: {
        createdAt: Date;
        updatedAt: Date;
        totalCost: number;
        estimatedDuration: number;
        completedTasks: number;
        failedTasks: number;
    };
}

export interface PlanningResult {
    success: boolean;
    plan?: Plan;
    error?: string;
    alternatives?: Plan[];
    planningTime: number;
}

export interface ExecutionResult {
    success: boolean;
    results: Map<string, any>;
    failedTasks: Task[];
    completedTasks: Task[];
    compensatedTasks: Task[];
    executionTime: number;
}

// ============================================
// Task Templates Library
// ============================================

const TASK_TEMPLATES: Record<string, Omit<Task, 'id' | 'status' | 'retryCount'>> = {
    // Research tasks
    'search_web': {
        name: 'Web Search',
        type: 'primitive',
        description: 'Search the web for information',
        preconditions: [],
        effects: [{ type: 'set_fact', key: 'search_results', value: null }],
        cost: 1,
        estimatedDuration: 5000,
        priority: 5,
        toolName: 'search_web',
        dependencies: [],
        dependents: [],
        maxRetries: 3
    },

    'research_deep': {
        name: 'Deep Research',
        type: 'compound',
        description: 'Conduct thorough research on a topic',
        preconditions: [],
        effects: [{ type: 'set_fact', key: 'research_complete', value: true }],
        cost: 10,
        estimatedDuration: 60000,
        priority: 5,
        decompositionMethods: [{
            id: 'research_standard',
            name: 'Standard Research',
            applicabilityConditions: [],
            subtasks: [
                { name: 'Search', type: 'primitive', description: 'Search', preconditions: [], effects: [], cost: 1, estimatedDuration: 5000, priority: 5, toolName: 'search_web', dependencies: [], dependents: [], maxRetries: 3 },
                { name: 'Fetch Sources', type: 'primitive', description: 'Fetch', preconditions: [], effects: [], cost: 3, estimatedDuration: 15000, priority: 4, toolName: 'fetch_url', dependencies: [], dependents: [], maxRetries: 2 },
                { name: 'Summarize', type: 'primitive', description: 'Summarize', preconditions: [], effects: [], cost: 2, estimatedDuration: 10000, priority: 3, toolName: 'summarize', dependencies: [], dependents: [], maxRetries: 2 }
            ],
            priority: 5
        }],
        dependencies: [],
        dependents: [],
        maxRetries: 2
    },

    // Document creation tasks
    'create_presentation': {
        name: 'Create Presentation',
        type: 'compound',
        description: 'Create a professional presentation',
        preconditions: [],
        effects: [{ type: 'set_fact', key: 'presentation_ready', value: true }],
        cost: 15,
        estimatedDuration: 120000,
        priority: 5,
        decompositionMethods: [{
            id: 'ppt_standard',
            name: 'Standard Presentation',
            applicabilityConditions: [],
            subtasks: [
                { name: 'Research Topic', type: 'primitive', description: 'Research', preconditions: [], effects: [], cost: 5, estimatedDuration: 30000, priority: 5, toolName: 'research_deep', dependencies: [], dependents: [], maxRetries: 2 },
                { name: 'Generate Outline', type: 'primitive', description: 'Outline', preconditions: [], effects: [], cost: 2, estimatedDuration: 10000, priority: 4, toolName: 'generate_text', dependencies: [], dependents: [], maxRetries: 2 },
                { name: 'Create Slides', type: 'primitive', description: 'Slides', preconditions: [], effects: [], cost: 5, estimatedDuration: 30000, priority: 3, toolName: 'slides_create', dependencies: [], dependents: [], maxRetries: 2 }
            ],
            priority: 5
        }],
        dependencies: [],
        dependents: [],
        maxRetries: 2
    },

    'create_document': {
        name: 'Create Document',
        type: 'compound',
        description: 'Create a Word document with citations',
        preconditions: [],
        effects: [{ type: 'set_fact', key: 'document_ready', value: true }],
        cost: 12,
        estimatedDuration: 90000,
        priority: 5,
        decompositionMethods: [{
            id: 'doc_academic',
            name: 'Academic Document',
            applicabilityConditions: [{ type: 'fact', key: 'style', operator: 'equals', value: 'academic' }],
            subtasks: [
                { name: 'Research', type: 'primitive', description: 'Research', preconditions: [], effects: [], cost: 5, estimatedDuration: 30000, priority: 5, toolName: 'research_deep', dependencies: [], dependents: [], maxRetries: 2 },
                { name: 'Gather Citations', type: 'primitive', description: 'Citations', preconditions: [], effects: [], cost: 3, estimatedDuration: 15000, priority: 4, agentId: 'research', dependencies: [], dependents: [], maxRetries: 2 },
                { name: 'Write Content', type: 'primitive', description: 'Write', preconditions: [], effects: [], cost: 5, estimatedDuration: 30000, priority: 3, toolName: 'generate_text', dependencies: [], dependents: [], maxRetries: 2 },
                { name: 'Format Document', type: 'primitive', description: 'Format', preconditions: [], effects: [], cost: 2, estimatedDuration: 10000, priority: 2, toolName: 'doc_create', dependencies: [], dependents: [], maxRetries: 2 }
            ],
            priority: 10
        }],
        dependencies: [],
        dependents: [],
        maxRetries: 2
    },

    // Code tasks
    'develop_feature': {
        name: 'Develop Feature',
        type: 'compound',
        description: 'Develop a software feature',
        preconditions: [],
        effects: [{ type: 'set_fact', key: 'feature_developed', value: true }],
        cost: 20,
        estimatedDuration: 180000,
        priority: 5,
        decompositionMethods: [{
            id: 'tdd_approach',
            name: 'TDD Approach',
            applicabilityConditions: [],
            subtasks: [
                { name: 'Write Tests', type: 'primitive', description: 'Tests', preconditions: [], effects: [], cost: 4, estimatedDuration: 20000, priority: 5, toolName: 'code_test', dependencies: [], dependents: [], maxRetries: 2 },
                { name: 'Implement Code', type: 'primitive', description: 'Code', preconditions: [], effects: [], cost: 8, estimatedDuration: 60000, priority: 4, toolName: 'generate_code', dependencies: [], dependents: [], maxRetries: 3 },
                { name: 'Review Code', type: 'primitive', description: 'Review', preconditions: [], effects: [], cost: 3, estimatedDuration: 15000, priority: 3, toolName: 'code_review', dependencies: [], dependents: [], maxRetries: 2 },
                { name: 'Run Tests', type: 'primitive', description: 'Run tests', preconditions: [], effects: [], cost: 2, estimatedDuration: 10000, priority: 2, toolName: 'code_execute', dependencies: [], dependents: [], maxRetries: 2 }
            ],
            priority: 5
        }],
        dependencies: [],
        dependents: [],
        maxRetries: 2
    }
};

// ============================================
// HTN Planner Class
// ============================================

export class HTNPlanner extends EventEmitter {
    private worldState: WorldState;
    private taskTemplates: Map<string, Omit<Task, 'id' | 'status' | 'retryCount'>>;
    private activePlans: Map<string, Plan>;
    private maxPlanningDepth: number;
    private maxPlanningTime: number;

    constructor(options: {
        maxPlanningDepth?: number;
        maxPlanningTime?: number;
    } = {}) {
        super();

        this.worldState = {
            facts: new Map(),
            resources: new Map(),
            timestamp: new Date()
        };

        this.taskTemplates = new Map(Object.entries(TASK_TEMPLATES));
        this.activePlans = new Map();
        this.maxPlanningDepth = options.maxPlanningDepth || 10;
        this.maxPlanningTime = options.maxPlanningTime || 30000;
    }

    // ============================================
    // World State Management
    // ============================================

    setFact(key: string, value: any): void {
        this.worldState.facts.set(key, value);
        this.worldState.timestamp = new Date();
        this.emit("state:factSet", { key, value });
    }

    getFact(key: string): any {
        return this.worldState.facts.get(key);
    }

    deleteFact(key: string): void {
        this.worldState.facts.delete(key);
    }

    setResource(key: string, amount: number): void {
        this.worldState.resources.set(key, amount);
    }

    getResource(key: string): number {
        return this.worldState.resources.get(key) || 0;
    }

    modifyResource(key: string, delta: number): void {
        const current = this.getResource(key);
        this.setResource(key, current + delta);
    }

    // ============================================
    // Condition Checking
    // ============================================

    checkCondition(condition: Condition, state: WorldState = this.worldState): boolean {
        if (condition.customCheck) {
            return condition.customCheck(state);
        }

        const value = condition.type === 'fact'
            ? state.facts.get(condition.key)
            : state.resources.get(condition.key);

        switch (condition.operator) {
            case 'equals':
                return value === condition.value;
            case 'not_equals':
                return value !== condition.value;
            case 'greater':
                return (value || 0) > (condition.value || 0);
            case 'less':
                return (value || 0) < (condition.value || 0);
            case 'exists':
                return value !== undefined;
            case 'not_exists':
                return value === undefined;
            case 'contains':
                return Array.isArray(value) && value.includes(condition.value);
            default:
                return false;
        }
    }

    checkAllConditions(conditions: Condition[], state: WorldState = this.worldState): boolean {
        return conditions.every(c => this.checkCondition(c, state));
    }

    // ============================================
    // Effect Application
    // ============================================

    applyEffect(effect: Effect, state: WorldState = this.worldState): void {
        if (effect.customApply) {
            effect.customApply(state);
            return;
        }

        switch (effect.type) {
            case 'set_fact':
                state.facts.set(effect.key, effect.value);
                break;
            case 'delete_fact':
                state.facts.delete(effect.key);
                break;
            case 'modify_resource':
                const current = state.resources.get(effect.key) || 0;
                state.resources.set(effect.key, current + (effect.delta || 0));
                break;
        }

        state.timestamp = new Date();
    }

    applyAllEffects(effects: Effect[], state: WorldState = this.worldState): void {
        effects.forEach(e => this.applyEffect(e, state));
    }

    // ============================================
    // Planning
    // ============================================

    /**
     * Create a plan to achieve a goal
     */
    async plan(goal: string, context: Record<string, any> = {}): Promise<PlanningResult> {
        const startTime = Date.now();
        const planId = randomUUID();

        this.emit("planning:start", { planId, goal });

        try {
            // Create root task from goal
            const rootTask = this.createTaskFromGoal(goal, context);

            // Decompose compound tasks
            const allTasks = new Map<string, Task>();
            await this.decomposeTask(rootTask, allTasks, 0);

            // Build execution order (topological sort)
            const executionOrder = this.topologicalSort(allTasks);

            // Calculate metrics
            let totalCost = 0;
            let estimatedDuration = 0;
            for (const task of allTasks.values()) {
                if (task.type === 'primitive') {
                    totalCost += task.cost;
                    estimatedDuration += task.estimatedDuration;
                }
            }

            const plan: Plan = {
                id: planId,
                goal,
                rootTask,
                allTasks,
                executionOrder,
                status: 'ready',
                metadata: {
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    totalCost,
                    estimatedDuration,
                    completedTasks: 0,
                    failedTasks: 0
                }
            };

            this.activePlans.set(planId, plan);

            const planningTime = Date.now() - startTime;
            this.emit("planning:complete", { planId, tasksCount: allTasks.size, planningTime });

            return {
                success: true,
                plan,
                planningTime
            };

        } catch (error) {
            const planningTime = Date.now() - startTime;
            this.emit("planning:failed", { planId, error: (error as Error).message });

            return {
                success: false,
                error: (error as Error).message,
                planningTime
            };
        }
    }

    /**
     * Create a task from a goal description
     */
    private createTaskFromGoal(goal: string, context: Record<string, any>): Task {
        const lowerGoal = goal.toLowerCase();

        // Match goal to template
        let templateKey = 'research_deep'; // default

        if (lowerGoal.includes('presentación') || lowerGoal.includes('ppt') || lowerGoal.includes('slides')) {
            templateKey = 'create_presentation';
        } else if (lowerGoal.includes('documento') || lowerGoal.includes('word') || lowerGoal.includes('docx')) {
            templateKey = 'create_document';
        } else if (lowerGoal.includes('código') || lowerGoal.includes('programar') || lowerGoal.includes('develop')) {
            templateKey = 'develop_feature';
        } else if (lowerGoal.includes('buscar') || lowerGoal.includes('search')) {
            templateKey = 'search_web';
        }

        const template = this.taskTemplates.get(templateKey)!;

        return {
            ...template,
            id: randomUUID(),
            name: goal,
            description: goal,
            status: 'pending',
            retryCount: 0,
            toolParams: context
        };
    }

    /**
     * Decompose a compound task into subtasks
     */
    private async decomposeTask(
        task: Task,
        allTasks: Map<string, Task>,
        depth: number
    ): Promise<void> {
        if (depth > this.maxPlanningDepth) {
            throw new Error(`Maximum planning depth exceeded for task: ${task.name}`);
        }

        allTasks.set(task.id, task);

        if (task.type === 'primitive') {
            return;
        }

        // Find applicable decomposition method
        const methods = task.decompositionMethods || [];
        let selectedMethod: DecompositionMethod | undefined;

        for (const method of methods.sort((a, b) => b.priority - a.priority)) {
            if (this.checkAllConditions(method.applicabilityConditions)) {
                selectedMethod = method;
                break;
            }
        }

        if (!selectedMethod && methods.length > 0) {
            selectedMethod = methods[0]; // Fallback to first method
        }

        if (!selectedMethod) {
            throw new Error(`No decomposition method for compound task: ${task.name}`);
        }

        // Create subtasks
        const subtasks: Task[] = [];
        let prevTaskId: string | null = null;

        for (const subtaskSpec of selectedMethod.subtasks) {
            const subtask: Task = {
                ...subtaskSpec,
                id: randomUUID(),
                status: 'pending',
                retryCount: 0,
                dependencies: prevTaskId ? [prevTaskId] : [],
                dependents: []
            };

            if (prevTaskId) {
                const prevTask = allTasks.get(prevTaskId);
                if (prevTask) {
                    prevTask.dependents.push(subtask.id);
                }
            }

            subtasks.push(subtask);
            prevTaskId = subtask.id;

            // Recursively decompose
            await this.decomposeTask(subtask, allTasks, depth + 1);
        }

        task.subtasks = subtasks;
    }

    /**
     * Topological sort for execution order
     */
    private topologicalSort(tasks: Map<string, Task>): string[] {
        const visited = new Set<string>();
        const order: string[] = [];

        const visit = (taskId: string) => {
            if (visited.has(taskId)) return;
            visited.add(taskId);

            const task = tasks.get(taskId);
            if (!task) return;

            // Visit dependencies first
            for (const depId of task.dependencies) {
                visit(depId);
            }

            // Only add primitive tasks to execution order
            if (task.type === 'primitive') {
                order.push(taskId);
            }
        };

        for (const taskId of tasks.keys()) {
            visit(taskId);
        }

        return order;
    }

    // ============================================
    // Execution
    // ============================================

    /**
     * Execute a plan
     */
    async execute(
        planId: string,
        taskExecutor: (task: Task) => Promise<any>
    ): Promise<ExecutionResult> {
        const plan = this.activePlans.get(planId);
        if (!plan) {
            return {
                success: false,
                results: new Map(),
                failedTasks: [],
                completedTasks: [],
                executionTime: 0
            };
        }

        const startTime = Date.now();
        plan.status = 'executing';

        const results = new Map<string, any>();
        const failedTasks: Task[] = [];
        const completedTasks: Task[] = [];

        // We track processed tasks to avoid re-execution
        const processedTaskIds = new Set<string>();
        // We use the full set of primitive tasks, not just the topological order list (though topological sort is useful for validating acyclicity)
        // But for parallel execution, we just check dependencies dynamically.
        const pendingTaskIds = new Set(plan.executionOrder); // Initially all primitive tasks

        this.emit("execution:start", { planId });

        while (pendingTaskIds.size > 0) {
            // 1. Identify executable tasks (Wavefront)
            const executableTasks: Task[] = [];

            for (const taskId of pendingTaskIds) {
                const task = plan.allTasks.get(taskId);
                if (!task) {
                    processedTaskIds.add(taskId);
                    pendingTaskIds.delete(taskId);
                    continue;
                }

                // Check dependencies
                const depsSatisfied = task.dependencies.every(depId => {
                    const dep = plan.allTasks.get(depId);
                    // A dependency is satisfied if it is completed. 
                    // If a dependency failed, this task cannot run.
                    return dep && dep.status === 'completed';
                });

                // Check if any dependency FAILED
                const depsFailed = task.dependencies.some(depId => {
                    const dep = plan.allTasks.get(depId);
                    return dep && (dep.status === 'failed' || dep.status === 'cancelled');
                });

                if (depsFailed) {
                    task.status = 'failed';
                    task.error = 'Dependencies failed';
                    task.endTime = new Date();
                    failedTasks.push(task);
                    processedTaskIds.add(taskId); // Mark as processed (failed)
                    continue; // Will be removed from pending after loop
                }

                if (depsSatisfied) {
                    // Check preconditions (state might have changed)
                    if (this.checkAllConditions(task.preconditions)) {
                        executableTasks.push(task);
                    } else {
                        task.status = 'failed';
                        task.error = 'Preconditions not met';
                        task.endTime = new Date();
                        failedTasks.push(task);
                        processedTaskIds.add(taskId);
                    }
                }
            }

            // Remove processed tasks (failed ones) from pending immediately
            // But executable tasks will be removed after execution starts? 
            // Better: Remove executable tasks from pending NOW so we don't pick them up in next microtask if concurrency is weird
            // But we await them.

            // Cleanup failed tasks from pending
            for (const taskId of processedTaskIds) {
                pendingTaskIds.delete(taskId);
            }

            if (executableTasks.length === 0) {
                // Deadlock or all remaining tasks are waiting on something that won't happen (or they failed)
                // If we still have pending tasks but none are executable, it means dependencies are not met (and not failed yet?), 
                // but if we iterate and nothing changes, we have a problem.
                // However, logic above marks tasks as failed if deps failed.
                // So if we have pending tasks, it means they are waiting on running tasks?
                // No, we await the batch. So nothing is running.

                if (pendingTaskIds.size > 0) {
                    // This implies a cycle or logic error, or we just processed failures and need to re-check
                    // If we removed tasks in the previous cleanup step, pendingTaskIds size might have decreased.
                    // If size > 0 and we found 0 executables, it means all pending are waiting on... what?
                    // They must be waiting on tasks that are NOT in 'completed' state.
                    // But we only proceed when tasks complete.

                    // Fail all remaining tasks
                    for (const taskId of pendingTaskIds) {
                        const task = plan.allTasks.get(taskId);
                        if (task) {
                            task.status = 'failed';
                            task.error = 'Deadlock or dependency resolution failure';
                            failedTasks.push(task);
                        }
                    }
                    break;
                }
                break;
            }

            // Enforce sequential isolation constraint
            // If any executable task requires isolation (!canRunParallel), we run it alone.
            let batchToExecute = executableTasks;
            const isolatedTask = executableTasks.find(t => t.canRunParallel === false);
            if (isolatedTask) {
                batchToExecute = [isolatedTask]; // Only run this one in this tick
            }

            // Mark these as processed so we don't pick them up again
            for (const task of batchToExecute) {
                processedTaskIds.add(task.id);
                pendingTaskIds.delete(task.id);
            }

            // 2. Execute parallel batch
            const executionPromises = batchToExecute.map(async (task) => {
                task.status = 'executing';
                task.startTime = new Date();
                this.emit("task:start", { planId, taskId: task.id, taskName: task.name });

                try {
                    const result = await taskExecutor(task);

                    task.status = 'completed';
                    task.endTime = new Date();
                    task.result = result;
                    results.set(task.id, result);
                    completedTasks.push(task);

                    this.applyAllEffects(task.effects);

                    plan.metadata.completedTasks++;
                    this.emit("task:complete", { planId, taskId: task.id, result });

                } catch (error) {
                    task.retryCount++;
                    if (task.retryCount < task.maxRetries) {
                        task.status = 'failed';
                        task.error = (error as Error).message;
                        task.endTime = new Date();
                        failedTasks.push(task);
                        plan.metadata.failedTasks++;
                        this.emit("task:failed", { planId, taskId: task.id, error: (error as Error).message });
                    } else {
                        task.status = 'failed';
                        task.error = (error as Error).message;
                        task.endTime = new Date();
                        failedTasks.push(task);
                        plan.metadata.failedTasks++;
                        this.emit("task:failed", { planId, taskId: task.id, error: (error as Error).message });
                    }
                }
            });

            await Promise.all(executionPromises);
        }

        const success = failedTasks.length === 0;
        const compensatedTasks: Task[] = [];

        // 3. Rollback (Compensation) phase if plan failed
        if (!success && completedTasks.length > 0) {
            this.emit("plan:rollback_started", { planId, reason: failedTasks[0]?.error });

            // Execute rollback in reverse order of completion
            for (let i = completedTasks.length - 1; i >= 0; i--) {
                const task = completedTasks[i];
                if (task.compensationTool) {
                    this.emit("task:compensating", { planId, taskId: task.id, tool: task.compensationTool });
                    try {
                        // Dummy task for compensation executor
                        await taskExecutor({
                            ...task,
                            toolName: task.compensationTool,
                            toolParams: task.compensationParams || {}
                        });
                        compensatedTasks.push(task);
                    } catch (compErr) {
                        this.emit("task:compensation_failed", { planId, taskId: task.id, error: (compErr as Error).message });
                    }
                }
            }
        }

        plan.status = success ? 'completed' : 'failed';
        plan.metadata.updatedAt = new Date();

        const executionTime = Date.now() - startTime;
        this.emit("execution:complete", { planId, success, executionTime });

        return {
            success,
            results,
            failedTasks,
            completedTasks,
            compensatedTasks,
            executionTime
        };
    }

    /**
     * Attempt to replan after failures
     */
    private async attemptReplan(plan: Plan, failedTasks: Task[]): Promise<boolean> {
        this.emit("replanning:start", { planId: plan.id, failedCount: failedTasks.length });

        // Simple replanning: find alternative decomposition methods
        for (const task of failedTasks) {
            const parentTask = this.findParentTask(plan, task.id);
            if (!parentTask || !parentTask.decompositionMethods) continue;

            // Try next decomposition method
            const currentMethodIndex = parentTask.decompositionMethods.findIndex(
                m => m.subtasks.some(s => s.name === task.name)
            );

            if (currentMethodIndex < parentTask.decompositionMethods.length - 1) {
                // There's an alternative method
                this.emit("replanning:alternative", {
                    planId: plan.id,
                    taskId: parentTask.id,
                    methodIndex: currentMethodIndex + 1
                });
                return true;
            }
        }

        return false;
    }

    private findParentTask(plan: Plan, taskId: string): Task | undefined {
        for (const task of plan.allTasks.values()) {
            if (task.subtasks?.some(s => s.id === taskId)) {
                return task;
            }
        }
        return undefined;
    }

    // ============================================
    // Plan Management
    // ============================================

    getPlan(planId: string): Plan | undefined {
        return this.activePlans.get(planId);
    }

    cancelPlan(planId: string): boolean {
        const plan = this.activePlans.get(planId);
        if (!plan) return false;

        plan.status = 'failed';
        for (const task of plan.allTasks.values()) {
            if (task.status === 'pending' || task.status === 'ready' || task.status === 'executing') {
                task.status = 'cancelled';
            }
        }

        this.emit("plan:cancelled", { planId });
        return true;
    }

    getActivePlans(): Plan[] {
        return Array.from(this.activePlans.values());
    }

    /**
     * Register a custom task template
     */
    registerTemplate(key: string, template: Omit<Task, 'id' | 'status' | 'retryCount'>): void {
        this.taskTemplates.set(key, template);
    }

    /**
     * Get plan statistics
     */
    getStats(): {
        activePlans: number;
        completedPlans: number;
        failedPlans: number;
        avgPlanningTime: number;
        avgExecutionTime: number;
    } {
        const plans = Array.from(this.activePlans.values());

        return {
            activePlans: plans.filter(p => p.status === 'executing' || p.status === 'ready').length,
            completedPlans: plans.filter(p => p.status === 'completed').length,
            failedPlans: plans.filter(p => p.status === 'failed').length,
            avgPlanningTime: 0, // Would need to track this
            avgExecutionTime: 0
        };
    }
}

// Singleton instance
let htnPlannerInstance: HTNPlanner | null = null;

export function getHTNPlanner(): HTNPlanner {
    if (!htnPlannerInstance) {
        htnPlannerInstance = new HTNPlanner();
    }
    return htnPlannerInstance;
}

export default HTNPlanner;
