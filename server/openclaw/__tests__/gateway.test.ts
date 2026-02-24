import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import WebSocket from 'ws';
import { initGateway } from '../gateway/wsServer';
import { getOpenClawConfig } from '../config';

function connectAndWaitReady(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/openclaw`);
    // Wait for the "connected" event before resolving
    ws.on('message', function onFirst(data) {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'event' && msg.event === 'connected') {
        ws.removeListener('message', onFirst);
        resolve(ws);
      }
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 5000);
  });
}

function sendRpc(ws: WebSocket, id: string, method: string, params?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const handler = (data: Buffer | string) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'res' && msg.id === id) {
        ws.removeListener('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ type: 'req', id, method, params }));
    setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error('rpc timeout'));
    }, 5000);
  });
}

describe('OpenClaw Gateway', () => {
  let httpServer: ReturnType<typeof createServer>;
  let port: number;

  beforeAll(async () => {
    httpServer = createServer();
    const config = {
      ...getOpenClawConfig(),
      gateway: { enabled: true, path: '/ws/openclaw' },
    };
    await initGateway(httpServer, config as any);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterAll(() => {
    httpServer?.close();
  });

  it('accepts WebSocket connections on configured path', async () => {
    const ws = await connectAndWaitReady(port);
    ws.close();
  });

  it('sends connected event on connect', async () => {
    // connectAndWaitReady already validates the connected event
    const ws = await connectAndWaitReady(port);
    ws.close();
  });

  it('responds to health RPC', async () => {
    const ws = await connectAndWaitReady(port);
    const response = await sendRpc(ws, 'r1', 'health');
    expect(response.ok).toBe(true);
    expect(response.payload.status).toBe('ok');
    ws.close();
  });

  it('returns error for unknown RPC methods', async () => {
    const ws = await connectAndWaitReady(port);
    const response = await sendRpc(ws, 'r2', 'nonexistent');
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe('METHOD_NOT_FOUND');
    ws.close();
  });
});
