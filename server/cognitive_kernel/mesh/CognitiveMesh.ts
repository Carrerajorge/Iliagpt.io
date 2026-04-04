import pino from 'pino';
import express, { Request, Response } from 'express';
import http from 'http';

const logger = pino({ name: 'CognitiveMesh', level: process.env.LOG_LEVEL ?? 'info' });

export enum NodeCapability {
  PERCEPTION = 'PERCEPTION',
  REASONING = 'REASONING',
  MEMORY = 'MEMORY',
  ACTION = 'ACTION',
  SYNTHESIS = 'SYNTHESIS',
}

export interface MeshNodeInfo {
  id: string;
  url: string;
  capabilities: NodeCapability[];
  load: number;
  healthy: boolean;
  lastHeartbeat: number;
}

export interface CognitiveTask {
  id: string;
  type: NodeCapability;
  priority: number;
  payload: unknown;
}

const HEARTBEAT_TIMEOUT_MS = 30_000;
const HEALTH_CHECK_INTERVAL_MS = 15_000;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;

export class CognitiveMesh {
  public nodes: Map<string, MeshNodeInfo> = new Map();

  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private httpServer: http.Server | null = null;
  private app = express();
  private port = 0;

  constructor() {
    this.app.use(express.json());
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Node registration endpoint
    this.app.post('/mesh/register', (req: Request, res: Response) => {
      const nodeInfo = req.body as MeshNodeInfo;
      if (!nodeInfo?.id || !nodeInfo?.url) {
        res.status(400).json({ error: 'Missing required fields: id, url' });
        return;
      }
      this.registerNode({ ...nodeInfo, healthy: true, lastHeartbeat: Date.now() });
      logger.info({ nodeId: nodeInfo.id, url: nodeInfo.url }, 'Node registered via HTTP');
      res.json({ ok: true, registered: nodeInfo.id });
    });

    // Node deregistration endpoint
    this.app.delete('/mesh/register/:nodeId', (req: Request, res: Response) => {
      const { nodeId } = req.params;
      this.unregisterNode(nodeId);
      res.json({ ok: true, unregistered: nodeId });
    });

    // Heartbeat endpoint
    this.app.post('/mesh/heartbeat/:nodeId', (req: Request, res: Response) => {
      const { nodeId } = req.params;
      const node = this.nodes.get(nodeId);
      if (!node) {
        res.status(404).json({ error: 'Node not found' });
        return;
      }
      const { load } = req.body as { load?: number };
      node.lastHeartbeat = Date.now();
      node.healthy = true;
      if (typeof load === 'number') node.load = Math.max(0, Math.min(1, load));
      logger.debug({ nodeId, load: node.load }, 'Heartbeat received');
      res.json({ ok: true, timestamp: Date.now() });
    });

    // Mesh status endpoint
    this.app.get('/mesh/nodes', (_req: Request, res: Response) => {
      res.json({ nodes: Array.from(this.nodes.values()) });
    });

    // Task routing endpoint
    this.app.post('/mesh/route', (req: Request, res: Response) => {
      const task = req.body as CognitiveTask;
      const node = this.selectNode(task);
      if (!node) {
        res.status(503).json({ error: 'No capable healthy node available', capability: task.type });
        return;
      }
      res.json({ nodeId: node.id, nodeUrl: node.url, task });
    });

    // Health endpoint for this coordinator
    this.app.get('/mesh/health', (_req: Request, res: Response) => {
      res.json({
        status: 'ok',
        nodeCount: this.nodes.size,
        healthyNodes: this.getHealthyNodes().length,
        timestamp: Date.now(),
      });
    });
  }

  registerNode(nodeInfo: MeshNodeInfo): void {
    const existing = this.nodes.get(nodeInfo.id);
    this.nodes.set(nodeInfo.id, {
      ...nodeInfo,
      lastHeartbeat: nodeInfo.lastHeartbeat ?? Date.now(),
      healthy: nodeInfo.healthy ?? true,
    });
    if (existing) {
      logger.info({ nodeId: nodeInfo.id }, 'Mesh node updated');
    } else {
      logger.info({ nodeId: nodeInfo.id, url: nodeInfo.url, capabilities: nodeInfo.capabilities }, 'Mesh node registered');
    }
  }

  unregisterNode(nodeId: string): void {
    const existed = this.nodes.delete(nodeId);
    if (existed) {
      logger.info({ nodeId }, 'Mesh node unregistered');
    } else {
      logger.warn({ nodeId }, 'Attempted to unregister unknown node');
    }
  }

  async discoverNodes(serviceRegistryUrl?: string): Promise<void> {
    if (!serviceRegistryUrl) {
      logger.debug('No service registry URL provided, skipping discovery');
      return;
    }

    logger.info({ serviceRegistryUrl }, 'Discovering nodes from service registry');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

      const response = await fetch(`${serviceRegistryUrl}/nodes`, {
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.warn({ status: response.status, serviceRegistryUrl }, 'Service registry returned non-OK status');
        return;
      }

      const data = (await response.json()) as { nodes?: MeshNodeInfo[] };
      const discoveredNodes = data.nodes ?? [];

      for (const node of discoveredNodes) {
        if (!this.nodes.has(node.id)) {
          this.registerNode({ ...node, healthy: true, lastHeartbeat: Date.now() });
        }
      }

      logger.info({ discovered: discoveredNodes.length, total: this.nodes.size }, 'Node discovery complete');
    } catch (err) {
      logger.error({ err, serviceRegistryUrl }, 'Failed to discover nodes from service registry');
    }
  }

  getHealthyNodes(capability?: NodeCapability): MeshNodeInfo[] {
    const nodes = Array.from(this.nodes.values()).filter((n) => n.healthy);
    if (!capability) return nodes;
    return nodes.filter((n) => n.capabilities.includes(capability));
  }

  selectNode(task: CognitiveTask): MeshNodeInfo | null {
    const candidates = this.getHealthyNodes(task.type);
    if (candidates.length === 0) {
      logger.warn({ capability: task.type, taskId: task.id }, 'No healthy nodes available for capability');
      return null;
    }

    // Least-loaded capable node selection
    candidates.sort((a, b) => a.load - b.load);
    const selected = candidates[0];
    logger.debug(
      { taskId: task.id, capability: task.type, selectedNode: selected.id, load: selected.load },
      'Node selected for task',
    );
    return selected;
  }

  async healthCheck(): Promise<void> {
    const now = Date.now();
    const checkPromises: Promise<void>[] = [];

    for (const [nodeId, node] of this.nodes.entries()) {
      // Mark as unhealthy if heartbeat is stale
      if (now - node.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
        if (node.healthy) {
          logger.warn({ nodeId, lastHeartbeat: node.lastHeartbeat }, 'Node marked unhealthy due to stale heartbeat');
          node.healthy = false;
        }
        continue;
      }

      // Ping the node
      const checkPromise = (async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

        try {
          const response = await fetch(`${node.url}/health`, {
            signal: controller.signal,
            method: 'GET',
          });
          clearTimeout(timeoutId);

          const wasHealthy = node.healthy;
          node.healthy = response.ok;
          node.lastHeartbeat = Date.now();

          if (!wasHealthy && node.healthy) {
            logger.info({ nodeId }, 'Node recovered and is healthy again');
          } else if (wasHealthy && !node.healthy) {
            logger.warn({ nodeId, status: response.status }, 'Node health check failed');
          }
        } catch (err) {
          clearTimeout(timeoutId);
          if (node.healthy) {
            logger.warn({ nodeId, err }, 'Node health check timed out or failed - marking unhealthy');
            node.healthy = false;
          }
        }
      })();

      checkPromises.push(checkPromise);
    }

    await Promise.allSettled(checkPromises);

    const healthy = this.getHealthyNodes().length;
    const total = this.nodes.size;
    logger.debug({ healthy, total }, 'Health check cycle complete');
  }

  async start(port: number): Promise<void> {
    this.port = port;

    return new Promise((resolve, reject) => {
      this.httpServer = this.app.listen(port, () => {
        logger.info({ port }, 'CognitiveMesh coordinator started');

        // Start periodic health checks
        this.healthCheckTimer = setInterval(async () => {
          try {
            await this.healthCheck();
          } catch (err) {
            logger.error({ err }, 'Error during health check cycle');
          }
        }, HEALTH_CHECK_INTERVAL_MS);

        resolve();
      });

      this.httpServer.on('error', (err) => {
        logger.error({ err, port }, 'Failed to start CognitiveMesh coordinator');
        reject(err);
      });
    });
  }

  async stop(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    return new Promise((resolve, reject) => {
      if (!this.httpServer) {
        resolve();
        return;
      }

      this.httpServer.close((err) => {
        if (err) {
          logger.error({ err }, 'Error stopping CognitiveMesh coordinator');
          reject(err);
        } else {
          logger.info({ port: this.port }, 'CognitiveMesh coordinator stopped');
          resolve();
        }
      });
    });
  }
}

export const globalCognitiveMesh = new CognitiveMesh();
