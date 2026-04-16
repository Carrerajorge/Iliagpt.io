export type WhatsAppWebStatus =
  | { state: 'disconnected'; reason?: string }
  | { state: 'connecting' }
  | { state: 'qr'; qr: string }
  | { state: 'pairing_code'; phone: string; code: string }
  | { state: 'connected'; me?: { id?: string; name?: string } };

export type WhatsAppWebMirroredChat = {
  id: string;
  title: string;
  channel?: 'whatsapp_web';
  archived?: boolean;
  hidden?: boolean;
  pinned?: boolean;
  pinnedAt?: string | null;
  updatedAt?: string;
};

export type WhatsAppWebMirroredMessage = {
  id: string;
  role: 'user' | 'assistant' | string;
  content: string;
  createdAt: string;
  requestId?: string | null;
  userMessageId?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type WhatsAppWebMirroredMessageEvent = {
  chat: WhatsAppWebMirroredChat;
  message: WhatsAppWebMirroredMessage;
};

type Listener = {
  onStatus?: (status: WhatsAppWebStatus) => void;
  onMessage?: (event: WhatsAppWebMirroredMessageEvent) => void;
  onError?: (message: string) => void;
};

class WhatsAppWebEventStream {
  private es: EventSource | null = null;
  private listeners = new Set<Listener>();
  private lastStatus: WhatsAppWebStatus = { state: 'disconnected' };
  private lastError: string | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    this.ensureConnected();

    // Best-effort: deliver latest snapshot immediately.
    try {
      listener.onStatus?.(this.lastStatus);
    } catch {
      // ignore
    }

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.close();
      }
    };
  }

  getStatusSnapshot(): WhatsAppWebStatus {
    return this.lastStatus;
  }

  private ensureConnected(): void {
    if (this.es) return;
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    // EventSource will auto-reconnect. We keep one shared connection for the whole app.
    this.es = new EventSource('/api/integrations/whatsapp/web/events', {
      withCredentials: true,
    });

    this.es.addEventListener('wa_status', (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(String(ev.data || '{}'));
        const status = (parsed?.status || { state: 'disconnected' }) as WhatsAppWebStatus;
        this.lastStatus = status;
        this.lastError = null;
        for (const l of this.listeners) l.onStatus?.(status);
      } catch {
        // ignore
      }
    });

    this.es.addEventListener('wa_message', (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(String(ev.data || '{}')) as WhatsAppWebMirroredMessageEvent;
        if (!parsed?.chat?.id || !parsed?.message?.id) return;
        this.lastError = null;
        for (const l of this.listeners) l.onMessage?.(parsed);
      } catch {
        // ignore
      }
    });

    // Heartbeats keep the connection alive through proxies. No-op on the client.
    this.es.addEventListener('heartbeat', () => {
      this.lastError = null;
    });

    this.es.addEventListener('open', () => {
      this.lastError = null;
    });

    this.es.addEventListener('error', () => {
      // EventSource errors are intentionally opaque; it will retry automatically.
      if (this.lastError) return;
      this.lastError = 'Conexión al stream perdida. Reconectando...';
      for (const l of this.listeners) l.onError?.(this.lastError);
    });
  }

  private close(): void {
    try {
      this.es?.close();
    } catch {
      // ignore
    }
    this.es = null;
    this.lastError = null;
  }
}

export const whatsappWebEventStream = new WhatsAppWebEventStream();
