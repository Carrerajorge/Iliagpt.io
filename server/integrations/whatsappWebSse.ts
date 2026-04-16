import { randomUUID } from 'crypto';
import type { Response } from 'express';

export type WhatsAppWebSseEventName = 'wa_status' | 'wa_message' | 'heartbeat';

export interface WhatsAppWebSseClient {
  id: string;
  userId: string;
  res: Response;
  connectedAt: number;
}

/**
 * Minimal SSE hub for WhatsApp Web events (status + mirrored messages).
 * We keep this in-memory; persistence happens via normal chat/message storage.
 */
class WhatsAppWebSseHub {
  private clientsByUser = new Map<string, Map<string, WhatsAppWebSseClient>>();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startHeartbeat();
  }

  subscribe(userId: string, res: Response): string {
    const clientId = randomUUID();

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const client: WhatsAppWebSseClient = {
      id: clientId,
      userId,
      res,
      connectedAt: Date.now(),
    };

    if (!this.clientsByUser.has(userId)) {
      this.clientsByUser.set(userId, new Map());
    }
    this.clientsByUser.get(userId)!.set(clientId, client);

    // Initial comment to ensure the connection is "hot".
    try {
      res.write(': connected\n\n');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (res as any).flush?.();
    } catch {
      // ignore
    }

    res.on('close', () => {
      this.removeClient(userId, clientId);
    });

    return clientId;
  }

  removeClient(userId: string, clientId: string): void {
    const clients = this.clientsByUser.get(userId);
    if (!clients) return;
    clients.delete(clientId);
    if (clients.size === 0) {
      this.clientsByUser.delete(userId);
    }
  }

  broadcast(userId: string, event: WhatsAppWebSseEventName, data: unknown): void {
    const clients = this.clientsByUser.get(userId);
    if (!clients || clients.size === 0) return;

    const payload = JSON.stringify(data ?? {});
    for (const client of clients.values()) {
      try {
        client.res.write(`event: ${event}\n`);
        client.res.write(`data: ${payload}\n\n`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (client.res as any).flush?.();
      } catch {
        this.removeClient(userId, client.id);
      }
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = setInterval(() => {
      for (const userId of this.clientsByUser.keys()) {
        this.broadcast(userId, 'heartbeat', { ts: Date.now() });
      }
    }, 30000);
    this.heartbeatInterval.unref?.();
  }
}

export const whatsappWebSseHub = new WhatsAppWebSseHub();
