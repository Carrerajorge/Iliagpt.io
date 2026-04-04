import { IncomingMessage, Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import pino from 'pino';

// ─── Logger ───────────────────────────────────────────────────────────────────

const log = pino({ name: 'CollaborationServer' });

// ─── Types ────────────────────────────────────────────────────────────────────

type MessageType =
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

interface CollaborationMessage {
  type: MessageType;
  chatId: string;
  userId: string;
  payload?: Record<string, unknown>;
  timestamp: number;
}

interface CollaborationUser {
  id: string;
  name: string;
  avatar?: string;
  color: string;
  cursor?: { x: number; y: number };
  isTyping: boolean;
  lastSeen: number;
  activityState: 'ACTIVE' | 'IDLE' | 'AWAY' | 'OFFLINE';
}

interface ClientConnection {
  ws: WebSocket;
  userId: string;
  chatId: string;
  lastPing: number;
  user?: CollaborationUser;
}

// ─── CollaborationServer ──────────────────────────────────────────────────────

export class CollaborationServer {
  private wss: WebSocketServer;

  /** chatId → Set<ClientConnection> */
  private rooms = new Map<string, Set<ClientConnection>>();

  /** All connections by WebSocket instance for O(1) lookup */
  private connections = new Map<WebSocket, ClientConnection>();

  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  private readonly HEARTBEAT_INTERVAL_MS = 30_000;
  private readonly DEAD_CLIENT_TIMEOUT_MS = 60_000;
  private readonly WS_PATH = '/ws/collaboration';

  // ─── Attach to HTTP Server ──────────────────────────────────────────────

  attach(httpServer: HttpServer): void {
    this.wss = new WebSocketServer({
      server: httpServer,
      path: this.WS_PATH,
    });

    this.wss.on('connection', this.handleConnection);
    this.wss.on('error', (err) => {
      log.error({ err }, 'WebSocketServer error');
    });

    this.startHeartbeatChecker();

    log.info({ path: this.WS_PATH }, 'CollaborationServer attached');
  }

  // ─── Connection Lifecycle ───────────────────────────────────────────────

  private handleConnection = (ws: WebSocket, req: IncomingMessage): void => {
    const ip = req.socket.remoteAddress ?? 'unknown';
    log.debug({ ip }, 'new WebSocket connection');

    // Temporary client until CHAT_JOIN identifies them
    const client: ClientConnection = {
      ws,
      userId: '',
      chatId: '',
      lastPing: Date.now(),
    };

    this.connections.set(ws, client);

    ws.on('message', (data) => this.handleRawMessage(client, data));
    ws.on('close', (code, reason) => this.handleClose(client, code, reason.toString()));
    ws.on('error', (err) => {
      log.warn({ err, userId: client.userId }, 'WebSocket client error');
    });
    ws.on('pong', () => {
      client.lastPing = Date.now();
    });
  };

  private handleClose = (
    client: ClientConnection,
    code: number,
    reason: string,
  ): void => {
    log.info(
      { userId: client.userId, chatId: client.chatId, code, reason },
      'client disconnected',
    );

    this.removeClientFromRoom(client);
    this.connections.delete(client.ws);

    // Notify room
    if (client.chatId && client.userId) {
      this.broadcastToRoom(
        client.chatId,
        {
          type: 'CHAT_LEAVE',
          chatId: client.chatId,
          userId: client.userId,
          timestamp: Date.now(),
        },
        client.userId,
      );
    }
  };

  // ─── Message Handling ───────────────────────────────────────────────────

  private handleRawMessage(
    client: ClientConnection,
    data: WebSocket.RawData,
  ): void {
    let msg: CollaborationMessage;
    try {
      msg = JSON.parse(data.toString()) as CollaborationMessage;
    } catch {
      this.sendError(client.ws, 'Invalid JSON');
      return;
    }

    if (!msg.type || !msg.chatId) {
      this.sendError(client.ws, 'Missing type or chatId');
      return;
    }

    // Update ping time on any message
    client.lastPing = Date.now();

    this.handleMessage(client, msg);
  }

  handleMessage(client: ClientConnection, msg: CollaborationMessage): void {
    switch (msg.type) {
      case 'PING':
        this.send(client.ws, {
          type: 'PONG',
          chatId: msg.chatId,
          userId: msg.userId,
          timestamp: Date.now(),
        });
        break;

      case 'CHAT_JOIN':
        this.handleChatJoin(client, msg);
        break;

      case 'CHAT_LEAVE':
        this.handleChatLeave(client, msg);
        break;

      case 'CURSOR_MOVE':
        this.handleCursorMove(client, msg);
        break;

      case 'CURSOR_STOP':
        this.handleCursorStop(client, msg);
        break;

      case 'TYPING_START':
        this.handleTypingStart(client, msg);
        break;

      case 'TYPING_STOP':
        this.handleTypingStop(client, msg);
        break;

      case 'PRESENCE_UPDATE':
        this.handlePresenceUpdate(client, msg);
        break;

      case 'MENTION':
        this.handleMention(client, msg);
        break;

      default:
        log.warn({ type: msg.type }, 'unknown message type');
        this.sendError(client.ws, `Unknown message type: ${msg.type}`);
    }
  }

  // ─── Handlers ───────────────────────────────────────────────────────────

  private handleChatJoin(
    client: ClientConnection,
    msg: CollaborationMessage,
  ): void {
    const user = (msg.payload as { user?: CollaborationUser })?.user;
    if (!user?.id || !user?.name) {
      this.sendError(client.ws, 'CHAT_JOIN requires payload.user with id and name');
      return;
    }

    // Leave previous room if switching chats
    if (client.chatId && client.chatId !== msg.chatId) {
      this.removeClientFromRoom(client);
      this.broadcastToRoom(
        client.chatId,
        {
          type: 'CHAT_LEAVE',
          chatId: client.chatId,
          userId: client.userId,
          timestamp: Date.now(),
        },
        client.userId,
      );
    }

    client.userId = user.id;
    client.chatId = msg.chatId;
    client.user = { ...user, lastSeen: Date.now() };

    this.addClientToRoom(client);

    log.info(
      { userId: client.userId, chatId: client.chatId, name: user.name },
      'user joined chat',
    );

    // Broadcast join to room (excluding the joiner)
    this.broadcastToRoom(
      msg.chatId,
      {
        type: 'CHAT_JOIN',
        chatId: msg.chatId,
        userId: user.id,
        payload: { user: client.user },
        timestamp: Date.now(),
      },
      user.id,
    );

    // Send current room presence back to the joining user
    const roomUsers = this.getRoomUsers(msg.chatId);
    for (const roomUser of roomUsers) {
      if (roomUser.id === user.id) continue;
      this.send(client.ws, {
        type: 'CHAT_JOIN',
        chatId: msg.chatId,
        userId: roomUser.id,
        payload: { user: roomUser },
        timestamp: Date.now(),
      });
    }
  }

  private handleChatLeave(
    client: ClientConnection,
    msg: CollaborationMessage,
  ): void {
    this.removeClientFromRoom(client);
    this.broadcastToRoom(
      msg.chatId,
      {
        type: 'CHAT_LEAVE',
        chatId: msg.chatId,
        userId: client.userId,
        timestamp: Date.now(),
      },
      client.userId,
    );
    client.chatId = '';
    log.debug({ userId: client.userId }, 'user left chat');
  }

  private handleCursorMove(
    client: ClientConnection,
    msg: CollaborationMessage,
  ): void {
    const { x, y } = (msg.payload ?? {}) as { x?: number; y?: number };
    if (typeof x !== 'number' || typeof y !== 'number') return;

    if (client.user) {
      client.user.cursor = { x, y };
      client.user.lastSeen = Date.now();
    }

    this.broadcastToRoom(
      msg.chatId,
      {
        type: 'CURSOR_MOVE',
        chatId: msg.chatId,
        userId: client.userId,
        payload: { x, y },
        timestamp: Date.now(),
      },
      client.userId,
    );
  }

  private handleCursorStop(
    client: ClientConnection,
    msg: CollaborationMessage,
  ): void {
    if (client.user) {
      delete client.user.cursor;
    }

    this.broadcastToRoom(
      msg.chatId,
      {
        type: 'CURSOR_STOP',
        chatId: msg.chatId,
        userId: client.userId,
        timestamp: Date.now(),
      },
      client.userId,
    );
  }

  private handleTypingStart(
    client: ClientConnection,
    msg: CollaborationMessage,
  ): void {
    if (client.user) {
      client.user.isTyping = true;
      client.user.lastSeen = Date.now();
    }

    this.broadcastToRoom(
      msg.chatId,
      {
        type: 'TYPING_START',
        chatId: msg.chatId,
        userId: client.userId,
        timestamp: Date.now(),
      },
      client.userId,
    );
  }

  private handleTypingStop(
    client: ClientConnection,
    msg: CollaborationMessage,
  ): void {
    if (client.user) {
      client.user.isTyping = false;
    }

    this.broadcastToRoom(
      msg.chatId,
      {
        type: 'TYPING_STOP',
        chatId: msg.chatId,
        userId: client.userId,
        timestamp: Date.now(),
      },
      client.userId,
    );
  }

  private handlePresenceUpdate(
    client: ClientConnection,
    msg: CollaborationMessage,
  ): void {
    const { activityState } = (msg.payload ?? {}) as {
      activityState?: CollaborationUser['activityState'];
    };

    if (client.user && activityState) {
      client.user.activityState = activityState;
      client.user.lastSeen = Date.now();
    }

    this.broadcastToRoom(
      msg.chatId,
      {
        type: 'PRESENCE_UPDATE',
        chatId: msg.chatId,
        userId: client.userId,
        payload: client.user ? { ...client.user } : undefined,
        timestamp: Date.now(),
      },
      client.userId,
    );
  }

  private handleMention(
    client: ClientConnection,
    msg: CollaborationMessage,
  ): void {
    const { mentionedUserId, text } = (msg.payload ?? {}) as {
      mentionedUserId?: string;
      text?: string;
    };

    if (!mentionedUserId) {
      this.sendError(client.ws, 'MENTION requires payload.mentionedUserId');
      return;
    }

    // Broadcast to entire room (let clients filter)
    this.broadcastToRoom(msg.chatId, {
      type: 'MENTION',
      chatId: msg.chatId,
      userId: client.userId,
      payload: { mentionedUserId, text },
      timestamp: Date.now(),
    });
  }

  // ─── Room Management ────────────────────────────────────────────────────

  private addClientToRoom(client: ClientConnection): void {
    const { chatId } = client;
    if (!this.rooms.has(chatId)) {
      this.rooms.set(chatId, new Set());
    }
    this.rooms.get(chatId)!.add(client);
  }

  private removeClientFromRoom(client: ClientConnection): void {
    const room = this.rooms.get(client.chatId);
    if (!room) return;
    room.delete(client);
    if (room.size === 0) {
      this.rooms.delete(client.chatId);
    }
  }

  private getRoomUsers(chatId: string): CollaborationUser[] {
    const room = this.rooms.get(chatId);
    if (!room) return [];
    return Array.from(room)
      .filter((c) => c.user)
      .map((c) => c.user!);
  }

  // ─── Broadcasting ───────────────────────────────────────────────────────

  broadcastToRoom(
    chatId: string,
    msg: Omit<CollaborationMessage, 'chatId'> & { chatId?: string },
    excludeUserId?: string,
  ): void {
    const room = this.rooms.get(chatId);
    if (!room) return;

    const serialized = JSON.stringify({ ...msg, chatId });

    for (const client of room) {
      if (excludeUserId && client.userId === excludeUserId) continue;
      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(serialized);
        } catch (err) {
          log.warn({ err, userId: client.userId }, 'broadcast send failed');
        }
      }
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private send(ws: WebSocket, msg: Partial<CollaborationMessage>): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      log.warn({ err }, 'send failed');
    }
  }

  private sendError(ws: WebSocket, message: string): void {
    this.send(ws, {
      type: 'ERROR',
      chatId: '',
      userId: '',
      payload: { message },
      timestamp: Date.now(),
    });
  }

  // ─── Heartbeat ──────────────────────────────────────────────────────────

  private startHeartbeatChecker(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const [ws, client] of this.connections) {
        if (now - client.lastPing > this.DEAD_CLIENT_TIMEOUT_MS) {
          log.info(
            { userId: client.userId, chatId: client.chatId },
            'terminating dead client',
          );
          ws.terminate();
          this.connections.delete(ws);
          this.removeClientFromRoom(client);
        } else if (ws.readyState === WebSocket.OPEN) {
          // Native WS ping (triggers pong response)
          ws.ping();
        }
      }
    }, this.HEARTBEAT_INTERVAL_MS);
  }

  // ─── Graceful Shutdown ──────────────────────────────────────────────────

  close(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    return new Promise((resolve) => {
      if (!this.wss) {
        resolve();
        return;
      }

      // Notify all clients
      for (const [ws] of this.connections) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1001, 'Server shutting down');
        }
      }

      this.wss.close(() => {
        log.info('CollaborationServer closed');
        resolve();
      });
    });
  }

  // ─── Stats ───────────────────────────────────────────────────────────────

  getStats(): {
    totalConnections: number;
    rooms: Array<{ chatId: string; userCount: number }>;
  } {
    return {
      totalConnections: this.connections.size,
      rooms: Array.from(this.rooms.entries()).map(([chatId, clients]) => ({
        chatId,
        userCount: clients.size,
      })),
    };
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const collaborationServer = new CollaborationServer();
