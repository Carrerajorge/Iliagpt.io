import pino from 'pino';
import express, { Request, Response } from 'express';
import http from 'http';
import { NodeCapability, type CognitiveTask } from './CognitiveMesh.js';

const logger = pino({ name: 'MeshNode', level: process.env.LOG_LEVEL ?? 'info' });

export interface CognitiveTaskResult {
  taskId: string;
  nodeId: string;
  result: unknown;
  duration: number;
  error?: string;
}

export type TaskHandler = (task: CognitiveTask) => Promise<unknown>;

export interface NodeLoadReport {
  nodeId: string;
  load: number;
  activeTasks: number;
  capabilities: NodeCapability[];
}

const DEFAULT_MAX_CONCURRENT = 10;
const HEARTBEAT_INTERVAL_MS = 10_000;
const DEFAULT_TASK_TIMEOUT_MS = 30_000;

export class MeshNode {
  public readonly nodeId: string;
  public capabilities: NodeCapability[];
  public currentLoad = 0;
  public maxConcurrentTasks: number;
  public activeTasks: Map<string, CognitiveTask> = new Map();

  private taskHandlers: Map<NodeCapability, TaskHandler> = new Map();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private httpServer: http.Server | null = null;
  private app = express();
  private port = 0;
  private meshUrl = '';

  constructor(options: {
    nodeId: string;
    capabilities: NodeCapability[];
    maxConcurrentTasks?: number;
    port?: number;
  }) {
    this.nodeId = options.nodeId;
    this.capabilities = options.capabilities;
    this.maxConcurrentTasks = options.maxConcurrentTasks ?? DEFAULT_MAX_CONCURRENT;
    this.port = options.port ?? 0;

    this.app.use(express.json());
    this.setupDefaultHandlers();
    this.setupRoutes();
  }

  private setupDefaultHandlers(): void {
    for (const capability of Object.values(NodeCapability)) {
      this.taskHandlers.set(capability as NodeCapability, async (task: CognitiveTask) => ({
        capability,
        taskId: task.id,
        received: true,
        timestamp: Date.now(),
        payload: task.payload,
      }));
    }
  }

  private setupRoutes(): void {
    // Accept a task for execution
    this.app.post('/node/task', async (req: Request, res: Response) => {
      const task = req.body as CognitiveTask;
      if (!task?.id || !task?.type) {
        res.status(400).json({ error: 'Missing required task fields: id, type' });
        return;
      }

      const accepted = this.acceptTask(task);
      if (!accepted) {
        res.status(503).json({
          error: 'Node overloaded',
          nodeId: this.nodeId,
          currentLoad: this.currentLoad,
          maxConcurrentTasks: this.maxConcurrentTasks,
        });
        return;
      }

      try {
        const result = await this.executeTask(task);
        res.json(result);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        res.status(500).json({
          taskId: task.id,
          nodeId: this.nodeId,
          result: null,
          duration: 0,
          error: errorMsg,
        } satisfies CognitiveTaskResult);
      }
    });

    // Load report endpoint
    this.app.get('/node/load', (_req: Request, res: Response) => {
      res.json(this.reportLoad());
    });

    // Health endpoint
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'ok',
        nodeId: this.nodeId,
        capabilities: this.capabilities,
        load: this.currentLoad,
        activeTasks: this.activeTasks.size,
        maxConcurrentTasks: this.maxConcurrentTasks,
        timestamp: Date.now(),
      });
    });

    // Capabilities endpoint
    this.app.get('/node/capabilities', (_req: Request, res: Response) => {
      res.json({ nodeId: this.nodeId, capabilities: this.capabilities });
    });
  }

  registerHandler(capability: NodeCapability, handler: TaskHandler): void {
    this.taskHandlers.set(capability, handler);
    logger.info({ nodeId: this.nodeId, capability }, 'Task handler registered');
  }

  acceptTask(task: CognitiveTask): boolean {
    if (this.activeTasks.size >= this.maxConcurrentTasks) {
      logger.warn(
        {
          nodeId: this.nodeId,
          taskId: task.id,
          active: this.activeTasks.size,
          max: this.maxConcurrentTasks,
        },
        'Task rejected - node at capacity',
      );
      return false;
    }

    if (!this.capabilities.includes(task.type)) {
      logger.warn(
        { nodeId: this.nodeId, taskId: task.id, capability: task.type },
        'Task rejected - capability not supported',
      );
      return false;
    }

    this.activeTasks.set(task.id, task);
    this.updateLoad();
    logger.debug({ nodeId: this.nodeId, taskId: task.id, type: task.type }, 'Task accepted');
    return true;
  }

  async executeTask(task: CognitiveTask): Promise<CognitiveTaskResult> {
    const start = Date.now();
    const handler = this.taskHandlers.get(task.type);

    if (!handler) {
      const duration = Date.now() - start;
      this.finishTask(task.id);
      return {
        taskId: task.id,
        nodeId: this.nodeId,
        result: null,
        duration,
        error: `No handler registered for capability: ${task.type}`,
      };
    }

    logger.info({ nodeId: this.nodeId, taskId: task.id, type: task.type }, 'Executing task');

    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Task timeout after ${DEFAULT_TASK_TIMEOUT_MS}ms`)), DEFAULT_TASK_TIMEOUT_MS),
      );

      const result = await Promise.race([handler(task), timeoutPromise]);
      const duration = Date.now() - start;

      this.finishTask(task.id);
      logger.info({ nodeId: this.nodeId, taskId: task.id, duration }, 'Task completed successfully');

      return { taskId: task.id, nodeId: this.nodeId, result, duration };
    } catch (err) {
      const duration = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : String(err);

      this.finishTask(task.id);
      logger.error({ nodeId: this.nodeId, taskId: task.id, err, duration }, 'Task execution failed');

      return { taskId: task.id, nodeId: this.nodeId, result: null, duration, error: errorMsg };
    }
  }

  private finishTask(taskId: string): void {
    this.activeTasks.delete(taskId);
    this.updateLoad();
  }

  private updateLoad(): void {
    this.currentLoad = this.maxConcurrentTasks > 0 ? this.activeTasks.size / this.maxConcurrentTasks : 0;
  }

  reportLoad(): NodeLoadReport {
    return {
      nodeId: this.nodeId,
      load: this.currentLoad,
      activeTasks: this.activeTasks.size,
      capabilities: this.capabilities,
    };
  }

  async register(meshUrl: string): Promise<void> {
    this.meshUrl = meshUrl;

    const nodeInfo = {
      id: this.nodeId,
      url: `http://localhost:${this.port}`,
      capabilities: this.capabilities,
      load: this.currentLoad,
      healthy: true,
      lastHeartbeat: Date.now(),
    };

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(`${meshUrl}/mesh/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nodeInfo),
        });

        if (!response.ok) {
          throw new Error(`Registration failed with status ${response.status}`);
        }

        logger.info({ nodeId: this.nodeId, meshUrl, attempt }, 'Successfully registered with mesh coordinator');
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn({ nodeId: this.nodeId, meshUrl, attempt, err }, 'Registration attempt failed');

        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        }
      }
    }

    logger.error({ nodeId: this.nodeId, meshUrl, err: lastError }, 'All registration attempts failed');
    throw lastError ?? new Error('Registration failed');
  }

  startHeartbeat(meshUrl: string, interval: number = HEARTBEAT_INTERVAL_MS): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.meshUrl = meshUrl;

    this.heartbeatTimer = setInterval(async () => {
      try {
        const response = await fetch(`${meshUrl}/mesh/heartbeat/${this.nodeId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ load: this.currentLoad }),
        });

        if (!response.ok) {
          logger.warn({ nodeId: this.nodeId, status: response.status }, 'Heartbeat returned non-OK status');
        } else {
          logger.debug({ nodeId: this.nodeId, load: this.currentLoad }, 'Heartbeat sent');
        }
      } catch (err) {
        logger.error({ nodeId: this.nodeId, meshUrl, err }, 'Heartbeat failed - attempting re-registration');

        // Try to re-register on heartbeat failure
        try {
          await this.register(meshUrl);
        } catch (regErr) {
          logger.error({ nodeId: this.nodeId, err: regErr }, 'Re-registration after heartbeat failure also failed');
        }
      }
    }, interval);

    logger.info({ nodeId: this.nodeId, interval, meshUrl }, 'Heartbeat started');
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.httpServer = this.app.listen(this.port, () => {
        const addr = this.httpServer!.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
        }
        logger.info({ nodeId: this.nodeId, port: this.port, capabilities: this.capabilities }, 'MeshNode HTTP server started');
        resolve(this.port);
      });

      this.httpServer.on('error', (err) => {
        logger.error({ nodeId: this.nodeId, err }, 'Failed to start MeshNode HTTP server');
        reject(err);
      });
    });
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Deregister from mesh
    if (this.meshUrl) {
      try {
        await fetch(`${this.meshUrl}/mesh/register/${this.nodeId}`, { method: 'DELETE' });
        logger.info({ nodeId: this.nodeId }, 'Deregistered from mesh coordinator');
      } catch (err) {
        logger.warn({ nodeId: this.nodeId, err }, 'Failed to deregister from mesh coordinator');
      }
    }

    return new Promise((resolve, reject) => {
      if (!this.httpServer) {
        resolve();
        return;
      }

      this.httpServer.close((err) => {
        if (err) {
          logger.error({ nodeId: this.nodeId, err }, 'Error stopping MeshNode HTTP server');
          reject(err);
        } else {
          logger.info({ nodeId: this.nodeId }, 'MeshNode HTTP server stopped');
          resolve();
        }
      });
    });
  }
}
