import type { WsRequest, WsResponse, WsEvent, WsMessage } from '../types';

export function createResponse(reqId: string, payload: unknown): WsResponse {
  return { type: 'res', id: reqId, ok: true, payload };
}

export function createErrorResponse(reqId: string, code: string, message: string): WsResponse {
  return { type: 'res', id: reqId, ok: false, error: { code, message } };
}

export function createEvent(event: string, payload: unknown): WsEvent {
  return { type: 'event', event, payload, timestamp: Date.now() };
}

export function parseMessage(raw: string): WsMessage | null {
  try {
    const msg = JSON.parse(raw);
    if (msg.type === 'req' && typeof msg.id === 'string' && typeof msg.method === 'string') {
      return msg as WsRequest;
    }
    if (msg.type === 'res' && typeof msg.id === 'string') {
      return msg as WsResponse;
    }
    if (msg.type === 'event' && typeof msg.event === 'string') {
      return msg as WsEvent;
    }
    return null;
  } catch {
    return null;
  }
}
