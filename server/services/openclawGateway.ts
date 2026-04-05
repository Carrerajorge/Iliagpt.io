import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "crypto";
import type { Server as HttpServer } from "http";

const VERSION = "2026.4.2";

interface GatewayClient {
  connId: string;
  ws: WebSocket;
  authenticated: boolean;
  clientName?: string;
  role?: string;
}

const clients = new Map<string, GatewayClient>();

function send(ws: WebSocket, obj: any) {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  } catch {}
}

function reply(ws: WebSocket, id: number | string, result: any) {
  send(ws, { type: "response", id, result });
}

function replyError(ws: WebSocket, id: number | string, code: number, message: string) {
  send(ws, { type: "response", id, error: { code, message } });
}

function handleMethod(client: GatewayClient, id: number | string, method: string, params: any) {
  const ws = client.ws;

  switch (method) {
    case "connect":
      client.authenticated = true;
      client.clientName = params?.client?.name || "control-ui";
      client.role = params?.client?.role || "control";
      reply(ws, id, {
        ok: true,
        version: VERSION,
        gatewayId: "iliagpt-gateway",
        features: ["chat", "agents", "sessions", "cron", "channels", "skills", "nodes", "config"],
        auth: { mode: "none" },
        presence: [],
      });
      send(ws, {
        type: "event",
        event: "connected",
        payload: {
          version: VERSION,
          gatewayId: "iliagpt-gateway",
          connId: client.connId,
        },
      });
      break;

    case "status":
      reply(ws, id, {
        version: VERSION,
        uptime: Math.floor(process.uptime()),
        platform: "iliagpt",
        gatewayId: "iliagpt-gateway",
        connections: clients.size,
        agents: 1,
        sessions: 0,
        channels: {},
      });
      break;

    case "health":
      reply(ws, id, {
        ok: true,
        version: VERSION,
        uptime: Math.floor(process.uptime()),
        memory: {
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        },
      });
      break;

    case "last-heartbeat":
      reply(ws, id, { ts: Date.now() });
      break;

    case "system-presence":
      reply(ws, id, { presences: [], version: 1 });
      break;

    case "config.get":
      reply(ws, id, {
        models: {
          default: { provider: "gemini", model: "gemini-2.5-flash-preview-05-20" },
          providers: {
            gemini: { enabled: true },
            openai: { enabled: true },
            xai: { enabled: true },
            anthropic: { enabled: true },
          },
        },
        agents: { default: { id: "main" } },
        gateway: { port: 18789, auth: { mode: "none" } },
      });
      break;

    case "config.schema":
      reply(ws, id, { schema: {} });
      break;

    case "config.set":
    case "config.apply":
      reply(ws, id, { ok: true });
      break;

    case "config.openFile":
      reply(ws, id, { ok: true });
      break;

    case "channels.status":
      reply(ws, id, {
        channels: {},
        summary: { total: 0, connected: 0, disconnected: 0 },
      });
      break;

    case "channels.logout":
      reply(ws, id, { ok: true });
      break;

    case "models.list":
      reply(ws, id, {
        models: [
          { id: "gemini-2.5-flash-preview-05-20", provider: "gemini", name: "Gemini 2.5 Flash", available: true },
          { id: "gemini-2.5-pro-preview-05-06", provider: "gemini", name: "Gemini 2.5 Pro", available: true },
          { id: "gpt-4o", provider: "openai", name: "GPT-4o", available: true },
          { id: "gpt-4.1", provider: "openai", name: "GPT-4.1", available: true },
          { id: "claude-sonnet-4-20250514", provider: "anthropic", name: "Claude Sonnet 4", available: true },
          { id: "grok-3-mini-fast", provider: "xai", name: "Grok 3 Mini Fast", available: true },
        ],
        default: { provider: "gemini", model: "gemini-2.5-flash-preview-05-20" },
      });
      break;

    case "agents.list":
      reply(ws, id, {
        agents: [
          { id: "main", name: "main", description: "Agente principal de IliaGPT", status: "active" },
        ],
      });
      break;

    case "agent.identity.get":
      reply(ws, id, {
        id: params?.agentId || "main",
        name: "main",
        description: "Agente principal de IliaGPT",
        avatar: null,
      });
      break;

    case "agents.files.list":
      reply(ws, id, { files: [] });
      break;

    case "agents.files.get":
      replyError(ws, id, -32601, "File not found");
      break;

    case "agents.files.set":
      reply(ws, id, { ok: true });
      break;

    case "sessions.list":
      reply(ws, id, { sessions: [] });
      break;

    case "sessions.subscribe":
      reply(ws, id, { ok: true });
      break;

    case "sessions.usage":
      reply(ws, id, {
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCost: 0,
        sessions: [],
      });
      break;

    case "sessions.usage.logs":
      reply(ws, id, { logs: [] });
      break;

    case "sessions.usage.timeseries":
      reply(ws, id, { points: [] });
      break;

    case "sessions.delete":
    case "sessions.reset":
    case "sessions.compact":
    case "sessions.patch":
    case "sessions.steer":
      reply(ws, id, { ok: true });
      break;

    case "tools.catalog":
    case "tools.effective":
      reply(ws, id, { tools: [] });
      break;

    case "skills.status":
      reply(ws, id, { skills: [], installed: [] });
      break;

    case "skills.install":
    case "skills.update":
      reply(ws, id, { ok: true });
      break;

    case "cron.list":
      reply(ws, id, { jobs: [] });
      break;

    case "cron.status":
      reply(ws, id, { running: false, jobs: 0 });
      break;

    case "cron.runs":
      reply(ws, id, { runs: [] });
      break;

    case "cron.add":
    case "cron.remove":
    case "cron.update":
    case "cron.run":
      reply(ws, id, { ok: true });
      break;

    case "node.list":
      reply(ws, id, { nodes: [] });
      break;

    case "device.pair.list":
      reply(ws, id, { devices: [] });
      break;

    case "device.pair.approve":
    case "device.pair.reject":
    case "device.token.revoke":
    case "device.token.rotate":
      reply(ws, id, { ok: true });
      break;

    case "logs.tail":
      reply(ws, id, { lines: [] });
      break;

    case "usage.cost":
      reply(ws, id, { totalCost: 0, breakdown: [] });
      break;

    case "update.run":
      reply(ws, id, { ok: true, version: VERSION });
      break;

    case "web.login.start":
      reply(ws, id, { ok: true, url: "/", token: randomUUID() });
      break;

    case "web.login.wait":
      reply(ws, id, { ok: true });
      break;

    case "chat.history":
      reply(ws, id, { messages: [] });
      break;

    case "chat.send":
      const chatId = randomUUID();
      reply(ws, id, { ok: true, runId: chatId });
      send(ws, {
        type: "event",
        event: "chat.delta",
        payload: {
          runId: chatId,
          delta: "Conectado a IliaGPT OpenClaw. Escribe tu mensaje para comenzar.",
          done: false,
        },
      });
      setTimeout(() => {
        send(ws, {
          type: "event",
          event: "chat.delta",
          payload: {
            runId: chatId,
            delta: "",
            done: true,
            usage: { tokensIn: 0, tokensOut: 15 },
          },
        });
      }, 100);
      break;

    case "chat.abort":
      reply(ws, id, { ok: true });
      break;

    default:
      replyError(ws, id, -32601, `Method not found: ${method}`);
      break;
  }
}

export function attachOpenClawGateway(httpServer: HttpServer) {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  const origEmit = httpServer.emit.bind(httpServer);
  httpServer.emit = function (event: string, ...args: any[]) {
    if (event === "upgrade") {
      const req = args[0] as any;
      const socket = args[1];
      const head = args[2];
      const pathname = (req.url || "").split("?")[0];
      if (pathname === "/openclaw-ws") {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
        });
        return true;
      }
    }
    return origEmit(event, ...args);
  } as any;

  wss.on("connection", (ws) => {
    const connId = randomUUID();
    const nonce = randomUUID();
    const client: GatewayClient = { connId, ws, authenticated: false };
    clients.set(connId, client);

    send(ws, {
      type: "event",
      event: "connect.challenge",
      payload: { nonce, ts: Date.now() },
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "request" && msg.method && msg.id !== undefined) {
          handleMethod(client, msg.id, msg.method, msg.params);
        } else if (msg.method && msg.id !== undefined) {
          handleMethod(client, msg.id, msg.method, msg.params);
        }
      } catch {}
    });

    ws.on("close", () => {
      clients.delete(connId);
    });

    ws.on("error", () => {
      clients.delete(connId);
    });
  });

  console.log("[OpenClaw Gateway] WebSocket gateway attached at /openclaw-ws");
  return wss;
}
