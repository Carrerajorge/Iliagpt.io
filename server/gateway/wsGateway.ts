import { WebSocketServer, WebSocket, type RawData } from "ws";
import * as http from "http";
import { URL } from "url";
import {
  authenticateWebSocket,
  type AuthenticatedWebSocket,
} from "../lib/wsAuth";

const HEARTBEAT_INTERVAL = 30_000;
const PONG_TIMEOUT = 10_000;

type WsClient = AuthenticatedWebSocket & { isAlive: boolean };

let instance: WsGateway | null = null;

export function isWsAvailable(): boolean {
  return instance !== null;
}

export class WsGateway {
  private wss: WebSocketServer;
  private userSockets = new Map<string, Set<WsClient>>();
  private chatMembers = new Map<string, Set<string>>();
  private heartbeatTimer: ReturnType<typeof setInterval>;

  constructor(server: http.Server) {
    this.wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (req, socket, head) => {
      // Only handle /ws path; let other WS servers handle theirs.
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      if (pathname !== "/ws") return;
      this.handleUpgrade(req, socket as any, head);
    });

    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_INTERVAL);
    instance = this;
  }

  // -- Upgrade & auth ---------------------------------------------------------

  private async handleUpgrade(
    req: http.IncomingMessage,
    socket: import("net").Socket,
    head: Buffer,
  ) {
    const auth = await authenticateWebSocket(req);
    if (!auth.isAuthenticated || !auth.userId) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const client = ws as WsClient;
      client.isAlive = true;
      client.isAuthenticated = true;
      client.userId = auth.userId;
      client.userEmail = auth.userEmail;
      this.registerClient(client);
      this.wss.emit("connection", client, req);
    });
  }

  // -- Client lifecycle -------------------------------------------------------

  private registerClient(ws: WsClient) {
    const userId = ws.userId!;
    if (!this.userSockets.has(userId)) this.userSockets.set(userId, new Set());
    this.userSockets.get(userId)!.add(ws);

    ws.on("pong", () => { ws.isAlive = true; });
    ws.on("close", () => this.handleDisconnect(ws));
    ws.on("message", (raw) => this.handleMessage(ws, raw));
  }

  private handleDisconnect(ws: WsClient) {
    const userId = ws.userId!;
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      sockets.delete(ws);
      if (sockets.size === 0) this.userSockets.delete(userId);
    }
    // Remove user from all rooms when last socket is gone.
    if (!this.userSockets.has(userId)) {
      for (const [chatId, members] of this.chatMembers) {
        if (members.delete(userId)) {
          this.broadcastToChat(chatId, "user_left", { chatId, userId });
          if (members.size === 0) this.chatMembers.delete(chatId);
        }
      }
    }
  }

  // -- Inbound message router -------------------------------------------------

  private handleMessage(ws: WsClient, raw: RawData) {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const userId = ws.userId!;

    switch (msg.type) {
      case "join":
        this.join(userId, msg.chatId);
        break;
      case "leave":
        this.leave(userId, msg.chatId);
        break;
      case "typing":
        this.setTyping(userId, msg.chatId, !!msg.isTyping);
        break;
      case "message_read":
        this.broadcastToChat(msg.chatId, "message_read", {
          chatId: msg.chatId, messageId: msg.messageId, userId,
        });
        break;
      case "ping":
        ws.send(JSON.stringify({ type: "pong" }));
        break;
    }
  }

  // -- Room management --------------------------------------------------------

  join(userId: string, chatId: string): void {
    if (!this.chatMembers.has(chatId)) this.chatMembers.set(chatId, new Set());
    const members = this.chatMembers.get(chatId)!;
    if (!members.has(userId)) {
      members.add(userId);
      this.broadcastToChat(chatId, "user_joined", { chatId, userId });
    }
  }

  leave(userId: string, chatId: string): void {
    const members = this.chatMembers.get(chatId);
    if (members?.delete(userId)) {
      this.broadcastToChat(chatId, "user_left", { chatId, userId });
      if (members.size === 0) this.chatMembers.delete(chatId);
    }
  }

  // -- Broadcasting -----------------------------------------------------------

  broadcastToChat(chatId: string, event: string, data: any): void {
    const members = this.chatMembers.get(chatId);
    if (!members) return;
    const payload = JSON.stringify({ type: event, ...data });
    for (const uid of members) {
      this.userSockets.get(uid)?.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(payload);
      });
    }
  }

  sendToUser(userId: string, event: string, data: any): void {
    const payload = JSON.stringify({ type: event, ...data });
    this.userSockets.get(userId)?.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    });
  }

  // -- Presence ---------------------------------------------------------------

  getOnlineUsers(chatId: string): string[] {
    return Array.from(this.chatMembers.get(chatId) ?? []);
  }

  setTyping(userId: string, chatId: string, isTyping: boolean): void {
    this.broadcastToChat(chatId, "typing_indicator", { chatId, userId, isTyping });
  }

  // -- Heartbeat --------------------------------------------------------------

  private heartbeat() {
    for (const sockets of this.userSockets.values()) {
      for (const ws of sockets) {
        if (!ws.isAlive) { ws.terminate(); continue; }
        ws.isAlive = false;
        ws.ping();
        setTimeout(() => {
          if (!ws.isAlive && ws.readyState === WebSocket.OPEN) ws.terminate();
        }, PONG_TIMEOUT);
      }
    }
  }

  // -- Metrics & cleanup ------------------------------------------------------

  getStats(): { connections: number; rooms: number } {
    let connections = 0;
    for (const s of this.userSockets.values()) connections += s.size;
    return { connections, rooms: this.chatMembers.size };
  }

  close() {
    clearInterval(this.heartbeatTimer);
    this.wss.close();
    instance = null;
  }
}
