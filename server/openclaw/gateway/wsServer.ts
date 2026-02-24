import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer, IncomingMessage } from 'http';
import type { OpenClawConfig } from '../config';
import { parseMessage, createEvent } from './protocol';
import { handleRpc } from './rpcHandlers';
import { Logger } from '../../lib/logger';

interface ConnectedClient {
  ws: WebSocket;
  userId: string;
  connectedAt: number;
  subscriptions: Set<string>;
}

const clients = new Map<WebSocket, ConnectedClient>();
let tickInterval: NodeJS.Timeout | null = null;

export async function initGateway(httpServer: HttpServer, config: OpenClawConfig): Promise<void> {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req: IncomingMessage, socket: any, head: Buffer) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname !== config.gateway.path) return;

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const userId = url.searchParams.get('userId') || 'anonymous';

    const client: ConnectedClient = {
      ws,
      userId,
      connectedAt: Date.now(),
      subscriptions: new Set(),
    };
    clients.set(ws, client);

    Logger.info(`[OpenClaw:Gateway] Client connected: ${userId} (total: ${clients.size})`);

    ws.send(JSON.stringify(createEvent('connected', {
      protocol: 1,
      timestamp: Date.now(),
    })));

    ws.on('message', async (raw: Buffer | string) => {
      const msg = parseMessage(raw.toString());
      if (!msg || msg.type !== 'req') return;

      const response = await handleRpc(msg, { userId: client.userId });
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(response));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      Logger.info(`[OpenClaw:Gateway] Client disconnected: ${userId} (total: ${clients.size})`);
    });

    ws.on('error', (err: Error) => {
      Logger.error(`[OpenClaw:Gateway] WebSocket error for ${userId}: ${err.message}`);
      clients.delete(ws);
    });
  });

  tickInterval = setInterval(() => {
    const event = createEvent('tick', { seq: Date.now(), clients: clients.size });
    broadcast(JSON.stringify(event));
  }, 15_000);

  Logger.info(`[OpenClaw:Gateway] Gateway initialized on path: ${config.gateway.path}`);
}

export function broadcast(data: string, filter?: (client: ConnectedClient) => boolean): void {
  for (const [ws, client] of clients) {
    if (ws.readyState === WebSocket.OPEN && (!filter || filter(client))) {
      ws.send(data);
    }
  }
}

export function broadcastEvent(event: string, payload: unknown, filter?: (client: ConnectedClient) => boolean): void {
  broadcast(JSON.stringify(createEvent(event, payload)), filter);
}

export function getConnectedClients(): number {
  return clients.size;
}

export function shutdownGateway(): void {
  if (tickInterval) clearInterval(tickInterval);
  for (const [ws] of clients) {
    ws.close(1001, 'Server shutting down');
  }
  clients.clear();
}
