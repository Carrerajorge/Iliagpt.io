import { ToolDefinition, toolRegistry } from './toolRegistry';

export interface SubTask {
  id: string;
  description: string;
  toolId: string | null;
  dependencies: string[];
  priority: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
}

export interface ExecutionPlan {
  waves: SubTask[][];
  totalEstimatedTime: number;
  maxParallelism: number;
}

export interface OrchestrationResult {
  success: boolean;
  completedTasks: number;
  failedTasks: number;
  results: Map<string, any>;
  errors: Map<string, string>;
  executionTimeMs: number;
}

export class OrchestrationEngine {
  private readonly MAX_CONCURRENT = 3;
  private readonly SUBTASK_TIMEOUT_MS = 30000;
  private readonly TOTAL_TIMEOUT_MS = 120000;

  async decomposeTask(prompt: string, complexity: number): Promise<SubTask[]> {
    const subtasks: SubTask[] = [];
    const words = prompt.toLowerCase();

    if (words.includes('usuario') || words.includes('user')) {
      subtasks.push({
        id: 'user_task',
        description: 'Handle user-related operations',
        toolId: words.includes('crear') || words.includes('create') ? 'create_user' : 'list_users',
        dependencies: [],
        priority: 1,
        status: 'pending'
      });
    }

    if (words.includes('reporte') || words.includes('report')) {
      subtasks.push({
        id: 'report_task',
        description: 'Generate or list reports',
        toolId: words.includes('generar') || words.includes('generate') ? 'generate_report' : 'list_templates',
        dependencies: [],
        priority: 2,
        status: 'pending'
      });
    }

    if (words.includes('seguridad') || words.includes('security')) {
      subtasks.push({
        id: 'security_task',
        description: 'Check security status',
        toolId: 'get_security_stats',
        dependencies: [],
        priority: 1,
        status: 'pending'
      });
    }

    if (words.includes('dashboard') || words.includes('métricas') || words.includes('analytics')) {
      subtasks.push({
        id: 'analytics_task',
        description: 'Fetch analytics data',
        toolId: 'get_dashboard',
        dependencies: [],
        priority: 1,
        status: 'pending'
      });
    }

    if (subtasks.length === 0) {
      subtasks.push({
        id: 'analysis_task',
        description: 'Analyze request and provide response',
        toolId: null,
        dependencies: [],
        priority: 1,
        status: 'pending'
      });
    }

    return subtasks;
  }

  buildExecutionPlan(subtasks: SubTask[]): ExecutionPlan {
    const waves: SubTask[][] = [];
    const remaining = [...subtasks];
    const completed = new Set<string>();

    while (remaining.length > 0) {
      const wave: SubTask[] = [];
      
      for (let i = remaining.length - 1; i >= 0; i--) {
        const task = remaining[i];
        const depsComplete = task.dependencies.every(dep => completed.has(dep));
        
        if (depsComplete) {
          wave.push(task);
          remaining.splice(i, 1);
        }
      }

      if (wave.length === 0 && remaining.length > 0) {
        wave.push(...remaining);
        remaining.length = 0;
      }

      wave.sort((a, b) => a.priority - b.priority);
      
      const chunks: SubTask[][] = [];
      for (let i = 0; i < wave.length; i += this.MAX_CONCURRENT) {
        chunks.push(wave.slice(i, i + this.MAX_CONCURRENT));
      }
      
      chunks.forEach(chunk => {
        waves.push(chunk);
        chunk.forEach(t => completed.add(t.id));
      });
    }

    return {
      waves,
      totalEstimatedTime: waves.length * 5000,
      maxParallelism: Math.min(this.MAX_CONCURRENT, subtasks.length)
    };
  }

  async executeParallel(plan: ExecutionPlan): Promise<OrchestrationResult> {
    const startTime = Date.now();
    const results = new Map<string, any>();
    const errors = new Map<string, string>();
    let completedTasks = 0;
    let failedTasks = 0;

    for (const wave of plan.waves) {
      if (Date.now() - startTime > this.TOTAL_TIMEOUT_MS) {
        errors.set('timeout', 'Total execution timeout exceeded');
        break;
      }

      const promises = wave.map(async (task) => {
        task.status = 'running';
        try {
          const result = await this.executeSubtask(task);
          task.status = 'completed';
          task.result = result;
          results.set(task.id, result);
          completedTasks++;
        } catch (err: any) {
          task.status = 'failed';
          task.error = err.message;
          errors.set(task.id, err.message);
          failedTasks++;
        }
      });

      await Promise.allSettled(promises);
    }

    return {
      success: failedTasks === 0,
      completedTasks,
      failedTasks,
      results,
      errors,
      executionTimeMs: Date.now() - startTime
    };
  }

  private async executeSubtask(task: SubTask): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Subtask ${task.id} timed out`));
      }, this.SUBTASK_TIMEOUT_MS);

      setTimeout(() => {
        clearTimeout(timeout);
        if (task.toolId) {
          const tool = toolRegistry.getToolById(task.toolId);
          if (tool && tool.isEnabled) {
            toolRegistry.incrementUsage(task.toolId, true);
            resolve({ 
              taskId: task.id, 
              toolId: task.toolId, 
              executed: true,
              tool: tool.name
            });
          } else {
            reject(new Error(`Tool ${task.toolId} not available or disabled`));
          }
        } else {
          resolve({ taskId: task.id, message: 'No tool required' });
        }
      }, 100);
    });
  }

  combineResults(orchestrationResult: OrchestrationResult): any {
    return {
      success: orchestrationResult.success,
      summary: {
        completed: orchestrationResult.completedTasks,
        failed: orchestrationResult.failedTasks,
        executionTime: `${orchestrationResult.executionTimeMs}ms`
      },
      results: Object.fromEntries(orchestrationResult.results),
      errors: Object.fromEntries(orchestrationResult.errors)
    };
  }
}

export const orchestrationEngine = new OrchestrationEngine();
