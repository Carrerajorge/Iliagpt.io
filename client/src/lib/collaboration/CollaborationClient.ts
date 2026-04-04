/**
 * CollaborationClient.ts
 * WebSocket-based real-time collaboration client with reconnect logic,
 * presence, cursors, typing indicators, and heartbeat support.
 */

// ---------------------------------------------------------------------------
// Message types (discriminated union)
// ---------------------------------------------------------------------------

export type ConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting";

export interface CursorPosition {
  x: number;
  y: number;
  /** Optional: element/container id the cursor is relative to */
  containerId?: string;
}

export interface BaseMessage {
  roomId: string;
  senderId: string;
  timestamp: number;
}

export interface PresenceUpdateMessage extends BaseMessage {
  type: "presence_update";
  payload: {
    userId: string;
    name: string;
    avatar?: string;
    color: string;
    status: "online" | "away" | "offline";
  };
}

export interface CursorMoveMessage extends BaseMessage {
  type: "cursor_move";
  payload: {
    position: CursorPosition;
  };
}

export interface TypingStartMessage extends BaseMessage {
  type: "typing_start";
  payload: {
    targetId?: string; // e.g. document/chat id being typed in
  };
}

export interface TypingStopMessage extends BaseMessage {
  type: "typing_stop";
  payload: {
    targetId?: string;
  };
}

export interface ChatMessage extends BaseMessage {
  type: "chat_message";
  payload: {
    messageId: string;
    text: string;
    replyToId?: string;
  };
}

export interface PingMessage {
  type: "ping";
  timestamp: number;
}

export interface PongMessage {
  type: "pong";
  timestamp: number;
}

export interface JoinRoomMessage {
  type: "join_room";
  roomId: string;
  userId: string;
  name: string;
  avatar?: string;
  color: string;
}

export interface LeaveRoomMessage {
  type: "leave_room";
  roomId: string;
  userId: string;
}

export type IncomingMessage =
  | PresenceUpdateMessage
  | CursorMoveMessage
  | TypingStartMessage
  | TypingStopMessage
  | ChatMessage
  | PongMessage;

export type OutgoingMessage =
  | PresenceUpdateMessage
  | CursorMoveMessage
  | TypingStartMessage
  | TypingStopMessage
  | ChatMessage
  | PingMessage
  | JoinRoomMessage
  | LeaveRoomMessage;

// ---------------------------------------------------------------------------
// Event listener map
// ---------------------------------------------------------------------------

export interface CollaborationEvents {
  presence_update: (msg: PresenceUpdateMessage) => void;
  cursor_move: (msg: CursorMoveMessage) => void;
  typing_start: (msg: TypingStartMessage) => void;
  typing_stop: (msg: TypingStopMessage) => void;
  chat_message: (msg: ChatMessage) => void;
  connection_state: (state: ConnectionState) => void;
  error: (error: Error) => void;
}

type Listener<T> = (payload: T) => void;
type EventMap = { [K in keyof CollaborationEvents]: Listener<Parameters<CollaborationEvents[K]>[0]>[] };

// ---------------------------------------------------------------------------
// CollaborationClient
// ---------------------------------------------------------------------------

export interface CollaborationClientOptions {
  url: string;
  roomId: string;
  userId: string;
  name: string;
  avatar?: string;
  color: string;
  /** Max reconnect attempts before giving up. Default: 10 */
  maxReconnectAttempts?: number;
  /** Base delay (ms) for exponential backoff. Default: 1000 */
  reconnectBaseDelay?: number;
  /** Heartbeat interval in ms. Default: 25000 */
  heartbeatInterval?: number;
  /** How long to wait (ms) for a pong before considering the connection dead. Default: 5000 */
  heartbeatTimeout?: number;
}

export class CollaborationClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private listeners: Partial<EventMap> = {};
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private messageQueue: OutgoingMessage[] = [];
  private destroyed = false;

  private readonly url: string;
  private readonly roomId: string;
  private readonly userId: string;
  private readonly name: string;
  private readonly avatar?: string;
  private readonly color: string;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectBaseDelay: number;
  private readonly heartbeatInterval: number;
  private readonly heartbeatTimeout: number;

  constructor(options: CollaborationClientOptions) {
    this.url = options.url;
    this.roomId = options.roomId;
    this.userId = options.userId;
    this.name = options.name;
    this.avatar = options.avatar;
    this.color = options.color;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
    this.reconnectBaseDelay = options.reconnectBaseDelay ?? 1000;
    this.heartbeatInterval = options.heartbeatInterval ?? 25_000;
    this.heartbeatTimeout = options.heartbeatTimeout ?? 5_000;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  connect(): void {
    if (this.destroyed) throw new Error("CollaborationClient has been destroyed");
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    this.openSocket();
  }

  disconnect(): void {
    this.destroyed = true;
    this.clearTimers();
    if (this.ws) {
      this.sendRaw({ type: "leave_room", roomId: this.roomId, userId: this.userId });
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }
    this.setState("disconnected");
  }

  joinRoom(): void {
    this.send({
      type: "join_room",
      roomId: this.roomId,
      userId: this.userId,
      name: this.name,
      avatar: this.avatar,
      color: this.color,
    });
  }

  leaveRoom(): void {
    this.send({ type: "leave_room", roomId: this.roomId, userId: this.userId });
  }

  sendPresenceUpdate(status: PresenceUpdateMessage["payload"]["status"]): void {
    this.send({
      type: "presence_update",
      roomId: this.roomId,
      senderId: this.userId,
      timestamp: Date.now(),
      payload: {
        userId: this.userId,
        name: this.name,
        avatar: this.avatar,
        color: this.color,
        status,
      },
    });
  }

  sendCursorMove(position: CursorPosition): void {
    this.send({
      type: "cursor_move",
      roomId: this.roomId,
      senderId: this.userId,
      timestamp: Date.now(),
      payload: { position },
    });
  }

  sendTypingStart(targetId?: string): void {
    this.send({
      type: "typing_start",
      roomId: this.roomId,
      senderId: this.userId,
      timestamp: Date.now(),
      payload: { targetId },
    });
  }

  sendTypingStop(targetId?: string): void {
    this.send({
      type: "typing_stop",
      roomId: this.roomId,
      senderId: this.userId,
      timestamp: Date.now(),
      payload: { targetId },
    });
  }

  sendChatMessage(text: string, replyToId?: string): string {
    const messageId = `${this.userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.send({
      type: "chat_message",
      roomId: this.roomId,
      senderId: this.userId,
      timestamp: Date.now(),
      payload: { messageId, text, replyToId },
    });
    return messageId;
  }

  getState(): ConnectionState {
    return this.state;
  }

  // ---------------------------------------------------------------------------
  // Event emitter
  // ---------------------------------------------------------------------------

  on<K extends keyof CollaborationEvents>(
    event: K,
    listener: CollaborationEvents[K]
  ): () => void {
    if (!this.listeners[event]) {
      (this.listeners as EventMap)[event] = [];
    }
    (this.listeners[event] as Listener<unknown>[]).push(listener as Listener<unknown>);
    return () => this.off(event, listener);
  }

  off<K extends keyof CollaborationEvents>(
    event: K,
    listener: CollaborationEvents[K]
  ): void {
    if (!this.listeners[event]) return;
    (this.listeners as EventMap)[event] = (
      (this.listeners[event] as Listener<unknown>[]).filter(
        (l) => l !== (listener as Listener<unknown>)
      )
    ) as EventMap[K];
  }

  // ---------------------------------------------------------------------------
  // Private – socket lifecycle
  // ---------------------------------------------------------------------------

  private openSocket(): void {
    this.setState("connecting");
    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState("connected");
      this.startHeartbeat();
      this.joinRoom();
      this.flushQueue();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.handleMessage(event.data);
    };

    this.ws.onerror = () => {
      this.emit("error", new Error("WebSocket error"));
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.stopHeartbeat();
      if (this.destroyed || event.code === 1000) {
        this.setState("disconnected");
        return;
      }
      this.setState("reconnecting");
      this.scheduleReconnect();
    };
  }

  private handleMessage(raw: string): void {
    let msg: IncomingMessage;
    try {
      msg = JSON.parse(raw) as IncomingMessage;
    } catch {
      return;
    }

    if (msg.type === "pong") {
      if (this.pongTimer) {
        clearTimeout(this.pongTimer);
        this.pongTimer = null;
      }
      return;
    }

    switch (msg.type) {
      case "presence_update":
        this.emit("presence_update", msg);
        break;
      case "cursor_move":
        this.emit("cursor_move", msg);
        break;
      case "typing_start":
        this.emit("typing_start", msg);
        break;
      case "typing_stop":
        this.emit("typing_stop", msg);
        break;
      case "chat_message":
        this.emit("chat_message", msg);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Private – send / queue
  // ---------------------------------------------------------------------------

  private send(msg: OutgoingMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendRaw(msg);
    } else {
      // Queue non-ping, non-room messages for later delivery
      if (msg.type !== "ping" && msg.type !== "leave_room") {
        this.messageQueue.push(msg);
      }
    }
  }

  private sendRaw(msg: OutgoingMessage): void {
    try {
      this.ws?.send(JSON.stringify(msg));
    } catch {
      // Socket may have closed; will be retried after reconnect
    }
  }

  private flushQueue(): void {
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift()!;
      this.sendRaw(msg);
    }
  }

  // ---------------------------------------------------------------------------
  // Private – heartbeat
  // ---------------------------------------------------------------------------

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      this.sendRaw({ type: "ping", timestamp: Date.now() });

      this.pongTimer = setTimeout(() => {
        // No pong received — connection is stale, force close
        this.ws?.close(4000, "Heartbeat timeout");
      }, this.heartbeatTimeout);
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private – reconnect
  // ---------------------------------------------------------------------------

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setState("disconnected");
      this.emit("error", new Error(`Max reconnect attempts (${this.maxReconnectAttempts}) reached`));
      return;
    }

    const delay = Math.min(
      this.reconnectBaseDelay * 2 ** this.reconnectAttempts,
      30_000 // cap at 30 s
    );
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      if (!this.destroyed) this.openSocket();
    }, delay);
  }

  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private – state / emit helpers
  // ---------------------------------------------------------------------------

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit("connection_state", state);
  }

  private emit<K extends keyof CollaborationEvents>(
    event: K,
    payload: Parameters<CollaborationEvents[K]>[0]
  ): void {
    const handlers = this.listeners[event] as Listener<typeof payload>[] | undefined;
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[CollaborationClient] Error in "${event}" listener:`, err);
      }
    }
  }
}
