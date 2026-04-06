import { WebSocketServer, WebSocket } from "ws";
import { randomUUID, createHmac } from "crypto";
import type { Server as HttpServer } from "http";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { llmGateway } from "../lib/llmGateway";
import { usageQuotaService } from "./usageQuotaService";
import { internetToolDefinitions, executeInternetTool } from "../openclaw/lib/internetAccess";

const VERSION = "2026.4.5";
const TOKEN_SECRET = process.env.ENCRYPTION_KEY || randomUUID();

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface GatewayClient {
  connId: string;
  ws: WebSocket;
  authenticated: boolean;
  clientName?: string;
  role?: string;
  userId?: string;
  chatHistory: ChatMessage[];
  activeRuns: Set<string>;
}

const clients = new Map<string, GatewayClient>();

const sessionModelOverrides = new Map<string, { model: string; provider: string }>();

const PROVIDER_MAP: Record<string, "openai" | "gemini" | "xai" | "anthropic" | "deepseek" | "cerebras"> = {
  openrouter: "openai",
  openai: "openai",
  gemini: "gemini",
  xai: "xai",
  anthropic: "anthropic",
  deepseek: "deepseek",
  cerebras: "cerebras",
};

const tokenToUserMap = new Map<string, string>();

export function generateGatewayToken(userId: string): string {
  const hmac = createHmac("sha256", TOKEN_SECRET);
  hmac.update(`openclaw-gateway:${userId}`);
  const token = hmac.digest("hex").slice(0, 32);
  tokenToUserMap.set(token, userId);
  return token;
}

export function resolveUserIdFromToken(token: string): string | null {
  return tokenToUserMap.get(token) || null;
}

function send(ws: WebSocket, obj: any) {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  } catch {}
}

function reply(ws: WebSocket, id: number | string, payload: any) {
  send(ws, { type: "res", id, ok: true, payload });
}

function replyError(ws: WebSocket, id: number | string, code: string | number, message: string) {
  send(ws, { type: "res", id, ok: false, error: { code: String(code), message } });
}

function handleMethod(client: GatewayClient, id: number | string, method: string, params: any) {
  const ws = client.ws;

  switch (method) {
    case "connect":
      client.authenticated = true;
      client.clientName = params?.client?.name || "control-ui";
      client.role = params?.client?.role || "control";
      if (params?.auth?.authToken) {
        const resolvedUserId = resolveUserIdFromToken(params.auth.authToken);
        client.userId = resolvedUserId || `token:${params.auth.authToken.slice(0, 8)}`;
      }
      console.log(`[OpenClaw Gateway] Client authenticated: ${client.clientName} (role=${client.role})`);
      reply(ws, id, {
        version: VERSION,
        gatewayId: "iliagpt-gateway",
        features: ["chat", "agents", "sessions", "cron", "channels", "skills", "nodes", "config", "internet", "web-fetch", "web-search"],
        auth: { mode: "token", accepted: true, role: client.role, scopes: ["operator.read", "operator.write"] },
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
          default: { provider: "openrouter", model: "moonshotai/kimi-k2.5" },
          providers: {
            openrouter: { enabled: true },
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
    case "config.apply": {
      const rawConfig = params?.raw || params?.config || "";
      const sessionKeyForConfig = params?.sessionKey || "main";
      if (typeof rawConfig === "string" && rawConfig.includes("model")) {
        try {
          const parsed = typeof rawConfig === "string" ? JSON.parse(rawConfig) : rawConfig;
          if (parsed?.model?.model) {
            const providerForModel = parsed.model.provider || "openrouter";
            sessionModelOverrides.set(sessionKeyForConfig, {
              model: parsed.model.model,
              provider: providerForModel,
            });
            console.log(`[OpenClaw Gateway] Model override set for session ${sessionKeyForConfig}: ${parsed.model.model} (${providerForModel})`);
          }
        } catch {}
      }
      reply(ws, id, { ok: true });
      break;
    }

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
          { id: "moonshotai/kimi-k2.5", provider: "openrouter", name: "Kimi K2.5", available: true },
          { id: "gemini-2.5-flash-preview-05-20", provider: "gemini", name: "Gemini 2.5 Flash", available: true },
          { id: "gemini-2.5-pro-preview-05-06", provider: "gemini", name: "Gemini 2.5 Pro", available: true },
          { id: "gpt-4o", provider: "openai", name: "GPT-4o", available: true },
          { id: "gpt-4.1", provider: "openai", name: "GPT-4.1", available: true },
          { id: "claude-sonnet-4-20250514", provider: "anthropic", name: "Claude Sonnet 4", available: true },
          { id: "grok-3-mini-fast", provider: "xai", name: "Grok 3 Mini Fast", available: true },
        ],
        default: { provider: "openrouter", model: "moonshotai/kimi-k2.5" },
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

    case "sessions.list": {
      const mainOverride = sessionModelOverrides.get("main");
      reply(ws, id, {
        sessions: [
          {
            key: "main",
            agentId: "main",
            label: "main",
            status: "idle",
            model: mainOverride?.model || "moonshotai/kimi-k2.5",
            provider: mainOverride?.provider || "openrouter",
            createdAt: Date.now() - 60000,
            updatedAt: Date.now(),
          },
        ],
        defaults: {
          model: "moonshotai/kimi-k2.5",
          provider: "openrouter",
          agentId: "main",
        },
      });
      break;
    }

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
      reply(ws, id, { ok: true });
      break;

    case "sessions.patch": {
      const patchKey = params?.key || params?.sessionKey || "main";
      if (params?.model) {
        const modelId = params.model.trim();
        const modelsList = [
          { id: "moonshotai/kimi-k2.5", provider: "openrouter" },
          { id: "gemini-2.5-flash-preview-05-20", provider: "gemini" },
          { id: "gemini-2.5-pro-preview-05-06", provider: "gemini" },
          { id: "gpt-4o", provider: "openai" },
          { id: "gpt-4.1", provider: "openai" },
          { id: "claude-sonnet-4-20250514", provider: "anthropic" },
          { id: "grok-3-mini-fast", provider: "xai" },
        ];
        const found = modelsList.find(m => m.id === modelId);
        const patchProvider = params.provider || found?.provider || (modelId.includes("/") ? "openrouter" : "openai");
        sessionModelOverrides.set(patchKey, { model: modelId, provider: patchProvider });
        console.log(`[OpenClaw Gateway] sessions.patch model override: ${patchKey} -> ${modelId} (${patchProvider})`);
      }
      reply(ws, id, {
        ok: true,
        resolved: {
          model: params?.model || sessionModelOverrides.get(patchKey)?.model || "moonshotai/kimi-k2.5",
          modelProvider: params?.provider || sessionModelOverrides.get(patchKey)?.provider || "openrouter",
        },
      });
      break;
    }

    case "sessions.steer":
      reply(ws, id, { ok: true });
      break;

    case "tools.catalog":
    case "tools.effective":
      reply(ws, id, {
        tools: internetToolDefinitions.map((t) => ({
          ...t,
          enabled: true,
          source: "openclaw-internet",
        })),
      });
      break;

    case "tools.execute": {
      if (!client.authenticated) {
        replyError(ws, id, "UNAUTHORIZED", "Authentication required for tool execution");
        break;
      }
      const toolId = params?.toolId || params?.id || "";
      const toolParams = params?.params || params?.arguments || {};
      const toolRunId = params?.runId || randomUUID();

      send(ws, {
        type: "event",
        event: "tool.status",
        payload: { toolId, runId: toolRunId, state: "running" },
      });

      executeInternetTool(toolId, toolParams)
        .then((result) => {
          reply(ws, id, { ok: result.ok, runId: toolRunId, ...result });
          send(ws, {
            type: "event",
            event: "tool.status",
            payload: { toolId, runId: toolRunId, state: "done", ok: result.ok },
          });
        })
        .catch((err: any) => {
          replyError(ws, id, "TOOL_ERROR", err?.message || "Tool execution failed");
          send(ws, {
            type: "event",
            event: "tool.status",
            payload: { toolId, runId: toolRunId, state: "error", error: err?.message },
          });
        });
      break;
    }

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
      reply(ws, id, { ok: true, version: VERSION, updated: true, features: ["internet-access"] });
      break;

    case "web.login.start":
      reply(ws, id, { ok: true, url: "/", token: randomUUID() });
      break;

    case "web.login.wait":
      reply(ws, id, { ok: true });
      break;

    case "chat.history":
      reply(ws, id, {
        messages: client.chatHistory.map((m, i) => ({
          id: `msg-${i}`,
          role: m.role,
          content: m.content,
          timestamp: Date.now(),
        })),
      });
      break;

    case "chat.send": {
      const userMessage = params?.message || params?.content || "";
      const chatSessionKey = params?.sessionKey || "main";
      const runId = params?.idempotencyKey || randomUUID();

      console.log(`[OpenClaw Gateway] chat.send params:`, JSON.stringify(params, null, 0)?.slice(0, 500));

      const sessionOverride = sessionModelOverrides.get(chatSessionKey);
      const selectedModel = params?.model || sessionOverride?.model || "moonshotai/kimi-k2.5";
      const selectedProvider = params?.provider || sessionOverride?.provider || "openrouter";

      if (!userMessage.trim()) {
        replyError(ws, id, "EMPTY_MESSAGE", "Message cannot be empty");
        break;
      }

      reply(ws, id, { ok: true, runId });

      client.chatHistory.push({ role: "user", content: userMessage });
      client.activeRuns.add(runId);

      const llmMessages: ChatCompletionMessageParam[] = [
        {
          role: "system" as const,
          content: "You are IliaGPT, a helpful AI assistant. You are running inside the OpenClaw control interface. Respond clearly and helpfully. You can use markdown formatting.",
        },
        ...client.chatHistory.map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        })),
      ];

      const mappedProvider = PROVIDER_MAP[selectedProvider] || "openai";

      (async () => {
        let fullResponse = "";

        try {
          console.log(`[OpenClaw Gateway] chat.send: model=${selectedModel}, provider=${mappedProvider}, historyLen=${client.chatHistory.length}`);

          const stream = llmGateway.streamChat(llmMessages, {
            model: selectedModel,
            provider: mappedProvider,
            userId: client.userId || "openclaw-user",
            requestId: runId,
            maxTokens: 4096,
            temperature: 0.7,
          });

          for await (const chunk of stream) {
            if (!client.activeRuns.has(runId)) {
              console.log(`[OpenClaw Gateway] Run ${runId} was aborted`);
              send(ws, {
                type: "event",
                event: "chat",
                payload: {
                  sessionKey: chatSessionKey,
                  runId,
                  state: "aborted",
                  message: {
                    role: "assistant",
                    content: [{ type: "text", text: fullResponse }],
                    timestamp: Date.now(),
                  },
                },
              });
              break;
            }

            if (chunk.content) {
              fullResponse += chunk.content;
              send(ws, {
                type: "event",
                event: "chat",
                payload: {
                  sessionKey: chatSessionKey,
                  runId,
                  state: "delta",
                  message: {
                    role: "assistant",
                    content: [{ type: "text", text: fullResponse }],
                  },
                },
              });
            }

            if (chunk.done) {
              break;
            }
          }

          client.chatHistory.push({ role: "assistant", content: fullResponse });

          if (client.chatHistory.length > 60) {
            client.chatHistory.splice(1, client.chatHistory.length - 40);
          }

          const estimatedTokens = Math.ceil(fullResponse.length / 4) + Math.ceil(userMessage.length / 4);
          usageQuotaService.recordOpenClawTokenUsage(client.userId || "", estimatedTokens).catch(() => {});

          if (client.activeRuns.has(runId)) {
            send(ws, {
              type: "event",
              event: "chat",
              payload: {
                sessionKey: chatSessionKey,
                runId,
                state: "final",
                message: {
                  role: "assistant",
                  content: [{ type: "text", text: fullResponse }],
                  timestamp: Date.now(),
                },
              },
            });
          }
        } catch (err: any) {
          console.error(`[OpenClaw Gateway] chat.send error:`, err?.message || err);

          send(ws, {
            type: "event",
            event: "chat",
            payload: {
              sessionKey: chatSessionKey,
              runId,
              state: "error",
              errorMessage: err?.message || "Failed to get AI response",
            },
          });
        } finally {
          client.activeRuns.delete(runId);
        }
      })();
      break;
    }

    case "chat.abort": {
      const abortRunId = params?.runId;
      if (abortRunId) {
        client.activeRuns.delete(abortRunId);
      }
      reply(ws, id, { ok: true });
      break;
    }

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
      console.log(`[OpenClaw Gateway] Upgrade request: ${pathname}`);
      if (pathname === "/openclaw-ws" || pathname === "/openclaw-ui") {
        console.log(`[OpenClaw Gateway] Handling upgrade for ${pathname}`);
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
    const client: GatewayClient = { connId, ws, authenticated: false, chatHistory: [], activeRuns: new Set() };
    clients.set(connId, client);
    console.log(`[OpenClaw Gateway] New connection: ${connId}`);

    send(ws, {
      type: "event",
      event: "connect.challenge",
      payload: { nonce, ts: Date.now() },
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        console.log(`[OpenClaw Gateway] Message from ${connId}: ${msg.method || msg.type || "unknown"}`);
        if (msg.type === "request" && msg.method && msg.id !== undefined) {
          handleMethod(client, msg.id, msg.method, msg.params);
        } else if (msg.method && msg.id !== undefined) {
          handleMethod(client, msg.id, msg.method, msg.params);
        }
      } catch (e) {
        console.error(`[OpenClaw Gateway] Parse error:`, e);
      }
    });

    ws.on("close", () => {
      console.log(`[OpenClaw Gateway] Connection closed: ${connId}`);
      clients.delete(connId);
    });

    ws.on("error", (err) => {
      console.error(`[OpenClaw Gateway] Connection error for ${connId}:`, err);
      clients.delete(connId);
    });
  });

  console.log("[OpenClaw Gateway] WebSocket gateway attached at /openclaw-ws");
  return wss;
}
