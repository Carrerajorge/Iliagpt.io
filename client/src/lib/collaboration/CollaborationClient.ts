import { logger } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActivityState = 'ACTIVE' | 'IDLE' | 'AWAY' | 'OFFLINE';

export interface CollaborationUser {
  id: string;
  name: string;
  avatar?: string;
  color: string;
  cursor?: { x: number; y: number };
  isTyping: boolean;
  lastSeen: number;
  activityState: ActivityState;
}

export type CollaborationMessageType =
  | 'PRESENCE_UPDATE'
  | 'CURSOR_MOVE'
  | 'CURSOR_STOP'
  | 'TYPING_START'
  | 'TYPING_STOP'
  | 'MENTION'
  | 'CHAT_JOIN'
  | 'CHAT_LEAVE'
  | 'PING'
  | 'PONG'
  | 'ERROR';

export interface CollaborationMessage {
  type: CollaborationMessageType;
  chatId: string;
  userId: string;
  payload?: Record<string, unknown>;
  timestamp: number;
}

export type CollaborationEventMap = {
  PRESENCE_UPDATE: CollaborationUser;
  CURSOR_MOVE: { userId: string; x: number; y: number };
  CURSOR_STOP: { userId: string };
  TYPING_START: { userId: string };
  TYPING_STOP: { userId: string };
  MENTION: { userId: string; mentionedUserId: string; text: string };
  CHAT_JOIN: { user: CollaborationUser };
  CHAT_LEAVE: { userId: string };
  connected: void;
  disconnected: { code: number; reason: string };
  error: Error;
};

type EventCallback<K extends keyof CollaborationEventMap> = (
  data: CollaborationEventMap[K],
) => void;

// ─── Color Palette ────────────────────────────────────────────────────────────

const USER_COLORS = [
  '#EF4444', // red
  '#F97316', // orange
  '#EAB308', // yellow
  '#22C55E', // green
  '#06B6D4', // cyan
  '#3B82F6', // blue
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#14B8A6', // teal
  '#F59E0B', // amber
];

let colorIndex = 0;

export function assignUserColor(): string {
  const color = USER_COLORS[colorIndex % USER_COLORS.length];
  colorIndex++;
  return color;
}

// ─── CollaborationClient ─────────────────────────────────────────────────────

export class CollaborationClient {
  private ws: WebSocket | null = null;
  private chatId: string | null = null;
  private userId: string;
  private userName: string;
  private userAvatar?: string;
  private userColor: string;

  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private isIntentionalDisconnect = false;
  private isConnecting = false;

  // Typed event listeners
  private listeners: {
    [K in keyof CollaborationEventMap]?: Set<EventCallback<K>>;
  } = {};

  private readonly wsUrl: string;

  constructor(options: {
    userId: string;
    userName: string;
    userAvatar?: string;
    wsUrl?: string;
  }) {
    this.userId = options.userId;
    this.userName = options.userName;
    this.userAvatar = options.userAvatar;
    this.userColor = assignUserColor();
    this.wsUrl =
      options.wsUrl ??
      (() => {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${proto}//${window.location.host}/ws/collaboration`;
      })();
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  connect(chatId: string): void {
    if (this.isConnecting) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.chatId === chatId) return;

    // Leave previous chat cleanly
    if (this.chatId && this.chatId !== chatId) {
      this.leaveCurrent();
    }

    this.chatId = chatId;
    this.isIntentionalDisconnect = false;
    this.isConnecting = true;

    this.openSocket();
  }

  disconnect(): void {
    this.isIntentionalDisconnect = true;
    this.leaveCurrent();
    this.cleanupSocket();
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.chatId = null;
  }

  sendCursorPosition(x: number, y: number): void {
    this.send({
      type: 'CURSOR_MOVE',
      payload: { x, y },
    });
  }

  stopCursor(): void {
    this.send({ type: 'CURSOR_STOP' });
  }

  startTyping(): void {
    this.send({ type: 'TYPING_START' });
  }

  stopTyping(): void {
    this.send({ type: 'TYPING_STOP' });
  }

  sendMention(mentionedUserId: string, text: string): void {
    this.send({
      type: 'MENTION',
      payload: { mentionedUserId, text },
    });
  }

  updatePresence(activityState: ActivityState): void {
    this.send({
      type: 'PRESENCE_UPDATE',
      payload: { activityState },
    });
  }

  get currentUserId(): string {
    return this.userId;
  }

  get currentColor(): string {
    return this.userColor;
  }

  // ─── Event System ────────────────────────────────────────────────────────

  on<K extends keyof CollaborationEventMap>(
    event: K,
    callback: EventCallback<K>,
  ): void {
    if (!this.listeners[event]) {
      (this.listeners as Record<string, Set<unknown>>)[event] = new Set();
    }
    (this.listeners[event] as Set<EventCallback<K>>).add(callback);
  }

  off<K extends keyof CollaborationEventMap>(
    event: K,
    callback: EventCallback<K>,
  ): void {
    const set = this.listeners[event] as Set<EventCallback<K>> | undefined;
    set?.delete(callback);
  }

  private emit<K extends keyof CollaborationEventMap>(
    event: K,
    data: CollaborationEventMap[K],
  ): void {
    const set = this.listeners[event] as Set<EventCallback<K>> | undefined;
    if (!set) return;
    for (const cb of set) {
      try {
        cb(data);
      } catch (err) {
        logger.error({ err, event }, '[CollaborationClient] listener error');
      }
    }
  }

  // ─── WebSocket Management ────────────────────────────────────────────────

  private openSocket(): void {
    try {
      this.ws = new WebSocket(this.wsUrl);
    } catch (err) {
      logger.error({ err }, '[CollaborationClient] WebSocket construction failed');
      this.isConnecting = false;
      this.scheduleReconnect();
      return;
    }

    this.ws.addEventListener('open', this.handleOpen);
    this.ws.addEventListener('message', this.handleMessage);
    this.ws.addEventListener('close', this.handleClose);
    this.ws.addEventListener('error', this.handleError);
  }

  private cleanupSocket(): void {
    if (!this.ws) return;
    this.ws.removeEventListener('open', this.handleOpen);
    this.ws.removeEventListener('message', this.handleMessage);
    this.ws.removeEventListener('close', this.handleClose);
    this.ws.removeEventListener('error', this.handleError);
    if (
      this.ws.readyState === WebSocket.OPEN ||
      this.ws.readyState === WebSocket.CONNECTING
    ) {
      this.ws.close(1000, 'Client disconnect');
    }
    this.ws = null;
  }

  private handleOpen = (): void => {
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    logger.info({ chatId: this.chatId }, '[CollaborationClient] connected');

    // Join the chat room
    if (this.chatId) {
      this.send({
        type: 'CHAT_JOIN',
        payload: {
          user: {
            id: this.userId,
            name: this.userName,
            avatar: this.userAvatar,
            color: this.userColor,
            isTyping: false,
            lastSeen: Date.now(),
            activityState: 'ACTIVE',
          },
        },
      });
    }

    this.startHeartbeat();
    this.emit('connected', undefined as void);
  };

  private handleMessage = (event: MessageEvent): void => {
    let msg: CollaborationMessage;
    try {
      msg = JSON.parse(event.data as string) as CollaborationMessage;
    } catch (err) {
      logger.warn({ err }, '[CollaborationClient] malformed message');
      return;
    }

    if (msg.type === 'PONG') return; // heartbeat ack

    this.routeIncoming(msg);
  };

  private handleClose = (event: CloseEvent): void => {
    this.isConnecting = false;
    this.stopHeartbeat();
    logger.info(
      { code: event.code, reason: event.reason },
      '[CollaborationClient] disconnected',
    );
    this.emit('disconnected', { code: event.code, reason: event.reason });

    if (!this.isIntentionalDisconnect) {
      this.scheduleReconnect();
    }
  };

  private handleError = (event: Event): void => {
    logger.error({ event }, '[CollaborationClient] WebSocket error');
    this.emit('error', new Error('WebSocket error'));
  };

  // ─── Message Routing ─────────────────────────────────────────────────────

  private routeIncoming(msg: CollaborationMessage): void {
    switch (msg.type) {
      case 'PRESENCE_UPDATE': {
        const user = msg.payload as unknown as CollaborationUser;
        this.emit('PRESENCE_UPDATE', user);
        break;
      }
      case 'CURSOR_MOVE': {
        const { x, y } = msg.payload as { x: number; y: number };
        this.emit('CURSOR_MOVE', { userId: msg.userId, x, y });
        break;
      }
      case 'CURSOR_STOP': {
        this.emit('CURSOR_STOP', { userId: msg.userId });
        break;
      }
      case 'TYPING_START': {
        this.emit('TYPING_START', { userId: msg.userId });
        break;
      }
      case 'TYPING_STOP': {
        this.emit('TYPING_STOP', { userId: msg.userId });
        break;
      }
      case 'MENTION': {
        const { mentionedUserId, text } = msg.payload as {
          mentionedUserId: string;
          text: string;
        };
        this.emit('MENTION', {
          userId: msg.userId,
          mentionedUserId,
          text,
        });
        break;
      }
      case 'CHAT_JOIN': {
        const user = (msg.payload as { user: CollaborationUser }).user;
        this.emit('CHAT_JOIN', { user });
        break;
      }
      case 'CHAT_LEAVE': {
        this.emit('CHAT_LEAVE', { userId: msg.userId });
        break;
      }
      default:
        logger.warn({ type: msg.type }, '[CollaborationClient] unknown message type');
    }
  }

  // ─── Send ────────────────────────────────────────────────────────────────

  private send(
    partial: Omit<CollaborationMessage, 'chatId' | 'userId' | 'timestamp'>,
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.chatId) return;
    const msg: CollaborationMessage = {
      ...partial,
      chatId: this.chatId,
      userId: this.userId,
      timestamp: Date.now(),
    };
    try {
      this.ws.send(JSON.stringify(msg));
    } catch (err) {
      logger.warn({ err }, '[CollaborationClient] send failed');
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private leaveCurrent(): void {
    if (this.chatId && this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: 'CHAT_LEAVE' });
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'PING' });
      }
    }, 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('[CollaborationClient] max reconnect attempts reached');
      return;
    }

    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts) + Math.random() * 500,
      30_000,
    );
    this.reconnectAttempts++;

    logger.info(
      { attempt: this.reconnectAttempts, delay },
      '[CollaborationClient] scheduling reconnect',
    );

    this.reconnectTimer = setTimeout(() => {
      if (!this.isIntentionalDisconnect && this.chatId) {
        this.cleanupSocket();
        this.isConnecting = true;
        this.openSocket();
      }
    }, delay);
  }
}
