import { EventEmitter } from "events";
import { randomUUID } from "crypto";
let Client: any;
try { Client = require("ssh2").Client; } catch {}
type ConnectConfig = any;
import type { CommandRequest, CommandResult } from "./terminalController";

export interface RemoteConnectionOptions {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  keepAliveInterval?: number;
  keepAliveCountMax?: number;
}

interface RemoteSession {
  id: string;
  client: Client;
  cwd: string;
  connection: RemoteConnectionOptions;
  history: CommandResult[];
  createdAt: number;
  lastActivity: number;
}

export class RemoteShellController extends EventEmitter {
  private sessions = new Map<string, RemoteSession>();
  private defaultTimeout = 30000;

  async createSession(options: RemoteConnectionOptions): Promise<{ sessionId: string; cwd: string }>
  {
    if (!options.host || !options.username) {
      throw new Error("host and username are required");
    }

    if (!options.password && !options.privateKey) {
      throw new Error("password or privateKey is required");
    }

    const sessionId = randomUUID();
    const client = new Client();

    const config: ConnectConfig = {
      host: options.host,
      port: options.port ?? 22,
      username: options.username,
      readyTimeout: this.defaultTimeout,
      keepaliveInterval: options.keepAliveInterval ?? 15000,
      keepaliveCountMax: options.keepAliveCountMax ?? 10,
    };

    if (options.password) config.password = options.password;
    if (options.privateKey) config.privateKey = options.privateKey;
    if (options.passphrase) config.passphrase = options.passphrase;

    await new Promise<void>((resolve, reject) => {
      client.once("ready", () => resolve());
      client.once("error", (err) => reject(err));
      client.connect(config);
    });

    const cwd = await this.detectRemoteCwd(client).catch(() => "~");

    const session: RemoteSession = {
      id: sessionId,
      client,
      cwd,
      connection: options,
      history: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    client.on("close", () => {
      this.sessions.delete(sessionId);
      this.emit("session:closed", { sessionId });
    });

    this.sessions.set(sessionId, session);
    this.emit("session:created", { sessionId });

    return { sessionId, cwd };
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.client.end();
    this.sessions.delete(sessionId);
    this.emit("session:closed", { sessionId });
  }

  async executeCommand(sessionId: string, request: CommandRequest): Promise<CommandResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Remote session not found");

    const fullCommand = request.args
      ? `${request.command} ${request.args.join(" ")}`
      : request.command;

    const commandId = randomUUID();
    const start = Date.now();
    const timeoutMs = request.timeout || this.defaultTimeout;

    return new Promise<CommandResult>((resolve, reject) => {
      let resolved = false;
      let stdout = "";
      let stderr = "";

      session.client.exec(fullCommand, { env: request.env, pty: request.interactive ?? false }, (err, stream) => {
        if (err) return reject(err);

        const timeout = setTimeout(() => {
          if (resolved) return;
          try {
            stream.close();
          } catch {
            // ignore
          }
        }, timeoutMs);

        stream.on("data", (data: Buffer) => {
          const chunk = data.toString();
          stdout += chunk;
          if (request.stream) {
            this.emit("command:output", { sessionId, commandId, stream: "stdout", chunk });
          }
        });

        stream.stderr?.on("data", (data: Buffer) => {
          const chunk = data.toString();
          stderr += chunk;
          if (request.stream) {
            this.emit("command:output", { sessionId, commandId, stream: "stderr", chunk });
          }
        });

        const finalize = (exitCode: number | null, signal: string | undefined) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          const result: CommandResult = {
            id: commandId,
            command: fullCommand,
            exitCode,
            stdout,
            stderr,
            duration: Date.now() - start,
            killed: exitCode === null,
            signal: signal ?? null,
            success: exitCode === 0,
          };

          session.history.push(result);
          session.lastActivity = Date.now();
          if (session.history.length > 100) {
            session.history = session.history.slice(-100);
          }

          this.emit("command:complete", { sessionId, commandId, result });
          resolve(result);
        };

        stream.on("close", (code, signal) => finalize(code, signal ?? undefined));
        stream.on("exit", (code, signal) => finalize(code, signal ?? undefined));
        stream.on("error", (streamErr) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          reject(streamErr);
        });
      });
    });
  }

  getHistory(sessionId: string, limit = 50): CommandResult[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.history.slice(-limit);
  }

  getSessionInfo(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  private async detectRemoteCwd(client: Client): Promise<string> {
    return new Promise((resolve, reject) => {
      client.exec("pwd", (err, stream) => {
        if (err) return reject(err);
        let output = "";
        stream.on("data", (data: Buffer) => {
          output += data.toString();
        });
        stream.on("close", () => {
          resolve(output.trim() || "~");
        });
        stream.on("error", (execErr) => reject(execErr));
      });
    });
  }
}
