/**
 * Terminal Control Router - Full OS Terminal Automation API
 *
 * Integrates the TerminalController to provide complete terminal control
 * with real-time WebSocket streaming, process management, and file operations.
 *
 * Features:
 * - Session-based terminal management (persistent cwd, env, history)
 * - Command execution with safety guards
 * - Real-time output streaming via WebSocket (/ws/terminal)
 * - File system operations (read, write, list, copy, move, delete)
 * - Process management (list, kill)
 * - System information (CPU, memory, disk, network)
 * - Port management
 * - Package management (npm, pip, apt)
 * - Script execution (Python, Node, Bash, Ruby, Go, Rust, PHP)
 * - Command history and replay
 */

import { Router, Request, Response } from "express";
import { EventEmitter } from "events";
import { TerminalController, CommandRequest, FileOperation } from "../agent/terminalController";
import { RemoteShellController } from "../agent/remoteShellController";
import { remoteShellRepository } from "../repositories/remoteShellRepository";
import { encryptSecret, decryptSecret, isRemoteSecretConfigured } from "../lib/crypto/secretVault";
import { storage } from "../storage";
import { type AuthenticatedRequest } from "../types/express";
import { WebSocket } from "ws";

const terminalController = new TerminalController();
const remoteShellController = new RemoteShellController();

// Track WebSocket clients subscribed to terminal sessions
const terminalClients = new Map<string, Set<WebSocket>>();

const controllerListeners = new Map<string, {
  source: EventEmitter;
  output: (data: any) => void;
  complete: (data: any) => void;
}>();

function attachStreamingListeners(source: EventEmitter, sessionId: string) {
  const handleOutput = (data: any) => {
    if (data.sessionId !== sessionId) return;
    broadcastTerminalOutput(sessionId, {
      type: "output",
      commandId: data.commandId,
      stream: data.stream,
      chunk: data.chunk,
      timestamp: Date.now(),
    });
  };

  const handleComplete = (data: any) => {
    if (data.sessionId !== sessionId) return;
    broadcastTerminalOutput(sessionId, {
      type: "complete",
      commandId: data.commandId,
      result: data.result,
      timestamp: Date.now(),
    });
  };

  source.on("command:output", handleOutput);
  source.on("command:complete", handleComplete);

  controllerListeners.set(sessionId, {
    source,
    output: handleOutput,
    complete: handleComplete,
  });
}

function detachStreamingListeners(sessionId: string) {
  const listeners = controllerListeners.get(sessionId);
  if (!listeners) return;
  listeners.source.off("command:output", listeners.output);
  listeners.source.off("command:complete", listeners.complete);
  controllerListeners.delete(sessionId);
}

terminalController.on("session:closed", ({ sessionId }) => {
  detachStreamingListeners(sessionId);
  terminalClients.delete(sessionId);
});

remoteShellController.on("session:closed", ({ sessionId }) => {
  detachStreamingListeners(sessionId);
  terminalClients.delete(sessionId);
});

function getAuthContext(req: Request) {
  const authReq = req as AuthenticatedRequest;
  const session: any = req.session || {};
  const user = authReq.user as any;

  const userId =
    user?.claims?.sub ||
    user?.id ||
    session?.authUserId ||
    session?.passport?.user?.claims?.sub ||
    session?.passport?.user?.id ||
    null;

  const email =
    user?.claims?.email ||
    user?.email ||
    session?.passport?.user?.claims?.email ||
    session?.passport?.user?.email ||
    null;

  return { userId, email };
}

async function auditAdminAction(
  req: Request,
  action: string,
  targetType: string,
  targetId?: string,
  details?: Record<string, any>
) {
  const { userId } = getAuthContext(req);
  if (!userId) return;
  try {
    await storage.createAdminAuditLog({
      adminId: userId,
      action,
      targetType,
      targetId,
      details,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || undefined,
    });
  } catch (err) {
    console.warn("[remote-shell] failed to audit action", err);
  }
}

function ensureRemoteSecretConfiguredOrThrow() {
  if (!isRemoteSecretConfigured()) {
    throw new Error("REMOTE_SHELL_SECRET is not configured on the server");
  }
}

function canAccessTarget(target: { ownerId: string; allowedAdminIds: string[] | null }, adminId: string) {
  if (target.ownerId === adminId) return true;
  return Boolean(target.allowedAdminIds?.includes(adminId));
}

function handleTerminalSessionError(error: unknown, res: Response): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.message.startsWith("Session expired")) {
    res.status(410).json({ error: error.message });
    return true;
  }

  if (error.message.startsWith("Session not found")) {
    res.status(404).json({ error: error.message });
    return true;
  }

  return false;
}

export function createTerminalControlRouter(): Router {
  const router = Router();

  // ============================================
  // Session Management
  // ============================================

  /** Create a new terminal session */
  router.post("/sessions", (req: Request, res: Response) => {
    try {
      const { cwd, env } = req.body;
      if (env !== undefined && (env === null || typeof env !== "object" || Array.isArray(env))) {
        return res.status(400).json({ error: "env must be an object" });
      }
      const sessionId = terminalController.createSession(cwd, env);

      attachStreamingListeners(terminalController, sessionId);

      res.json({
        sessionId,
        cwd: terminalController.getCwd(sessionId),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Close a terminal session */
  router.delete("/sessions/:sessionId", (req: Request, res: Response) => {
    try {
      terminalController.closeSession(req.params.sessionId);
      terminalClients.delete(req.params.sessionId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Get session info */
  router.get("/sessions/:sessionId", (req: Request, res: Response) => {
    try {
      const cwd = terminalController.getCwd(req.params.sessionId);
      const history = terminalController.getHistory(req.params.sessionId, 10);
      res.json({
        sessionId: req.params.sessionId,
        cwd,
        recentHistory: history.map((h) => ({
          id: h.id,
          command: h.command,
          exitCode: h.exitCode,
          success: h.success,
          duration: h.duration,
        })),
      });
    } catch (error: any) {
      if (handleTerminalSessionError(error, res)) return;
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Command Execution
  // ============================================

  /** Execute a command */
  router.post("/sessions/:sessionId/exec", async (req: Request, res: Response) => {
    try {
      const {
        command,
        args,
        cwd,
        env,
        timeout,
        shell,
        stream,
        background,
        interactive,
        inDocker,
        dockerImage,
        confirmDangerous
      } = req.body;

      if (!command) {
        return res.status(400).json({ error: "command is required" });
      }
      if (env !== undefined && (env === null || typeof env !== "object" || Array.isArray(env))) {
        return res.status(400).json({ error: "env must be an object" });
      }
      if (args !== undefined && !Array.isArray(args)) {
        return res.status(400).json({ error: "args must be an array" });
      }

      const dangerousBypassEnabled = process.env.TERMINAL_ALLOW_DANGEROUS_CONFIRM === "true";
      const confirmDangerousRequested = Boolean(confirmDangerous);
      const confirmDangerousAllowed = confirmDangerousRequested && dangerousBypassEnabled;

      // Safety check before execution
      const safety = terminalController.isCommandSafe(command);
      if (!safety.safe && !confirmDangerousAllowed) {
        return res.status(403).json({
          error: "Command blocked by safety policy",
          reason: safety.reason,
          severity: safety.severity,
          requiresConfirmation: dangerousBypassEnabled,
          bypassEnabled: dangerousBypassEnabled,
        });
      }

      const request: CommandRequest = {
        command,
        args,
        cwd,
        env,
        timeout: timeout || 30000,
        shell: shell || "bash",
        stream: stream !== false, // Stream by default
        background,
        interactive,
        inDocker,
        dockerImage,
        confirmDangerous: confirmDangerousAllowed,
      };

      const result = await terminalController.executeCommand(req.params.sessionId, request);
      res.json(result);
    } catch (error: any) {
      if (handleTerminalSessionError(error, res)) return;
      res.status(500).json({ error: error.message });
    }
  });

  /** Check if a command is safe */
  router.post("/sessions/:sessionId/check-safety", (req: Request, res: Response) => {
    try {
      const { command } = req.body;
      if (!command) {
        return res.status(400).json({ error: "command is required" });
      }
      const result = terminalController.isCommandSafe(command);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // File System Operations
  // ============================================

  /** Perform a file operation */
  router.post("/sessions/:sessionId/file", async (req: Request, res: Response) => {
    try {
      const { type, path, destination, content, pattern, recursive, permissions } = req.body;

      if (!type || !path) {
        return res.status(400).json({ error: "type and path are required" });
      }

      const op: FileOperation = {
        type,
        path,
        destination,
        content,
        pattern,
        recursive,
        permissions,
      };

      const result = await terminalController.fileOperation(req.params.sessionId, op);
      res.json(result);
    } catch (error: any) {
      if (handleTerminalSessionError(error, res)) return;
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // System Information
  // ============================================

  /** Get system information */
  router.get("/system-info", async (_req: Request, res: Response) => {
    try {
      const info = await terminalController.getSystemInfo();
      res.json(info);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Process Management
  // ============================================

  /** List running processes */
  router.get("/processes", async (req: Request, res: Response) => {
    try {
      const filter = req.query.filter as string | undefined;
      const processes = await terminalController.listProcesses(filter);
      res.json({ processes });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Kill a process */
  router.post("/processes/:pid/kill", async (req: Request, res: Response) => {
    try {
      const pid = parseInt(req.params.pid, 10);
      const signal = req.body.signal || "SIGTERM";
      const success = await terminalController.killProcess(pid, signal);
      res.json({ success });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Port Management
  // ============================================

  /** List listening ports */
  router.get("/ports", async (_req: Request, res: Response) => {
    try {
      const ports = await terminalController.listPorts();
      res.json({ ports });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Package Management
  // ============================================

  /** Install packages */
  router.post("/sessions/:sessionId/packages", async (req: Request, res: Response) => {
    try {
      const { manager, packages } = req.body;
      if (!manager || !packages || !Array.isArray(packages)) {
        return res.status(400).json({ error: "manager and packages array are required" });
      }
      const result = await terminalController.installPackage(
        req.params.sessionId,
        manager,
        packages
      );
      res.json(result);
    } catch (error: any) {
      if (handleTerminalSessionError(error, res)) return;
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Script Execution
  // ============================================

  /** Execute a script in a given language */
  router.post("/sessions/:sessionId/script", async (req: Request, res: Response) => {
    try {
      const { language, code, timeout, args } = req.body;
      if (!language || !code) {
        return res.status(400).json({ error: "language and code are required" });
      }
      const result = await terminalController.executeScript(req.params.sessionId, language, code, {
        timeout,
        args,
      });
      res.json(result);
    } catch (error: any) {
      if (handleTerminalSessionError(error, res)) return;
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // History
  // ============================================

  /** Get command history */
  router.get("/sessions/:sessionId/history", (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string, 10) || 50;
      const history = terminalController.getHistory(req.params.sessionId, limit);
      res.json({ history });
    } catch (error: any) {
      if (handleTerminalSessionError(error, res)) return;
      res.status(500).json({ error: error.message });
    }
  });

  /** Replay a command from history */
  router.post("/sessions/:sessionId/replay/:commandId", async (req: Request, res: Response) => {
    try {
      const result = await terminalController.replayCommand(
        req.params.sessionId,
        req.params.commandId
      );
      res.json(result);
    } catch (error: any) {
      if (handleTerminalSessionError(error, res)) return;
      if (error instanceof Error && error.message.startsWith("Command not found")) {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Environment Management
  // ============================================

  /** Get environment variables for a session */
  router.get("/sessions/:sessionId/env", async (req: Request, res: Response) => {
    try {
      const envVars = terminalController.getSessionEnv(req.params.sessionId);
      if (!envVars) {
        return res.status(404).json({ error: "session not found" });
      }
      res.json({ env: envVars, count: Object.keys(envVars).length });
    } catch (error: any) {
      if (handleTerminalSessionError(error, res)) return;
      res.status(500).json({ error: error.message });
    }
  });

  /** Set environment variables for a session */
  router.post("/sessions/:sessionId/env", async (req: Request, res: Response) => {
    try {
      const { variables } = req.body;
      if (!variables || typeof variables !== "object" || Array.isArray(variables)) {
        return res.status(400).json({ error: "variables object is required" });
      }

      const result = terminalController.setSessionEnv(req.params.sessionId, variables as Record<string, string>);
      res.json({ set: Object.keys(result.updated).length, updated: result.updated, success: true });
    } catch (error: any) {
      if (handleTerminalSessionError(error, res)) return;
      if (error instanceof Error && error.message.includes("Session not found")) {
        return res.status(404).json({ error: error.message });
      }
      return res.status(400).json({ error: error.message });
    }
  });

  /** Load dotfile (.bashrc, .env, etc.) */
  router.post("/sessions/:sessionId/dotfile", async (req: Request, res: Response) => {
    try {
      const { path: dotfilePath, type } = req.body;
      if (!dotfilePath) {
        return res.status(400).json({ error: "path is required" });
      }

      let command: string;
      if (type === "env" || dotfilePath.endsWith(".env")) {
        // Parse .env file and export variables
        command = `set -a && source ${JSON.stringify(dotfilePath)} && set +a && echo "LOADED"`;
      } else {
        // Source shell config
        command = `source ${JSON.stringify(dotfilePath)} && echo "LOADED"`;
      }

      const result = await terminalController.executeCommand(req.params.sessionId, {
        command,
        timeout: 10000,
        shell: "bash",
        stream: false,
      });

      res.json({
        loaded: result.stdout?.includes("LOADED") || false,
        path: dotfilePath,
        output: result.stdout,
        error: result.stderr || undefined,
      });
    } catch (error: any) {
      if (handleTerminalSessionError(error, res)) return;
      res.status(500).json({ error: error.message });
    }
  });

  /** Get shell aliases */
  router.get("/sessions/:sessionId/aliases", async (req: Request, res: Response) => {
    try {
      const result = await terminalController.executeCommand(req.params.sessionId, {
        command: "alias",
        timeout: 5000,
        shell: "bash",
        stream: false,
      });

      const aliases: Record<string, string> = {};
      if (result.stdout) {
        for (const line of result.stdout.split("\n")) {
          const match = line.match(/^alias\s+(\S+?)='(.+)'$/);
          if (match) {
            aliases[match[1]] = match[2];
          }
        }
      }

      res.json({ aliases, count: Object.keys(aliases).length });
    } catch (error: any) {
      if (handleTerminalSessionError(error, res)) return;
      res.status(500).json({ error: error.message });
    }
  });

  /** Set shell aliases */
  router.post("/sessions/:sessionId/aliases", async (req: Request, res: Response) => {
    try {
      const { aliases } = req.body;
      if (!aliases || typeof aliases !== "object") {
        return res.status(400).json({ error: "aliases object is required" });
      }

      const commands = Object.entries(aliases)
        .map(([name, cmd]) => `alias ${name}=${JSON.stringify(cmd)}`)
        .join(" && ");

      const result = await terminalController.executeCommand(req.params.sessionId, {
        command: commands,
        timeout: 5000,
        shell: "bash",
        stream: false,
      });

      res.json({ set: Object.keys(aliases).length, success: result.success });
    } catch (error: any) {
      if (handleTerminalSessionError(error, res)) return;
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Working Directory Management
  // ============================================

  /** Change working directory */
  router.post("/sessions/:sessionId/cd", async (req: Request, res: Response) => {
    try {
      const { path: targetPath } = req.body;
      if (!targetPath) {
        return res.status(400).json({ error: "path is required" });
      }

      const result = await terminalController.executeCommand(req.params.sessionId, {
        command: `cd ${JSON.stringify(targetPath)} && pwd`,
        timeout: 5000,
        shell: "bash",
        stream: false,
      });

      res.json({
        cwd: result.stdout?.trim() || targetPath,
        success: result.success,
      });
    } catch (error: any) {
      if (handleTerminalSessionError(error, res)) return;
      res.status(500).json({ error: error.message });
    }
  });

  /** List directory contents with details */
  router.get("/sessions/:sessionId/ls", async (req: Request, res: Response) => {
    try {
      const dirPath = (req.query.path as string) || ".";
      const result = await terminalController.executeCommand(req.params.sessionId, {
        command: `ls -la ${JSON.stringify(dirPath)}`,
        timeout: 5000,
        shell: "bash",
        stream: false,
      });

      const entries: Array<{
        permissions: string;
        owner: string;
        group: string;
        size: string;
        modified: string;
        name: string;
        type: string;
      }> = [];

      if (result.stdout) {
        const lines = result.stdout.split("\n").filter((l) => l.trim() && !l.startsWith("total"));
        for (const line of lines) {
          const parts = line.split(/\s+/);
          if (parts.length >= 9) {
            entries.push({
              permissions: parts[0],
              owner: parts[2],
              group: parts[3],
              size: parts[4],
              modified: `${parts[5]} ${parts[6]} ${parts[7]}`,
              name: parts.slice(8).join(" "),
              type: parts[0].startsWith("d") ? "directory" : parts[0].startsWith("l") ? "symlink" : "file",
            });
          }
        }
      }

      res.json({ path: dirPath, entries, count: entries.length });
    } catch (error: any) {
      if (handleTerminalSessionError(error, res)) return;
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Remote Shell Sessions
  // ============================================

  router.post("/remote/sessions", async (req: Request, res: Response) => {
    try {
      const { host, port, username, password, privateKey, passphrase, keepAliveInterval, keepAliveCountMax } = req.body || {};

      if (!host || !username) {
        return res.status(400).json({ error: "host and username are required" });
      }

      if (!password && !privateKey) {
        return res.status(400).json({ error: "password or privateKey is required" });
      }

      const { sessionId, cwd } = await remoteShellController.createSession({
        host,
        port,
        username,
        password,
        privateKey,
        passphrase,
        keepAliveInterval,
        keepAliveCountMax,
      });

      attachStreamingListeners(remoteShellController, sessionId);
      await auditAdminAction(req, "remote_shell.session_start", "remote_session", sessionId, { host, username });

      res.json({ sessionId, cwd });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete("/remote/sessions/:sessionId", async (req: Request, res: Response) => {
    try {
      remoteShellController.closeSession(req.params.sessionId);
      detachStreamingListeners(req.params.sessionId);
      terminalClients.delete(req.params.sessionId);
      await auditAdminAction(req, "remote_shell.session_end", "remote_session", req.params.sessionId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/remote/sessions/:sessionId", (req: Request, res: Response) => {
    try {
      const session = remoteShellController.getSessionInfo(req.params.sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      res.json({
        sessionId: session.id,
        cwd: session.cwd,
        connectedAt: session.createdAt,
        lastActivity: session.lastActivity,
        host: session.connection.host,
        username: session.connection.username,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/remote/sessions/:sessionId/history", (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string, 10) || 50;
      const history = remoteShellController.getHistory(req.params.sessionId, limit);
      res.json({ history });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/remote/sessions/:sessionId/exec", async (req: Request, res: Response) => {
    try {
      const { command, args, env, timeout, stream, interactive, confirmDangerous } = req.body || {};
      if (!command) {
        return res.status(400).json({ error: "command is required" });
      }

      const safety = terminalController.isCommandSafe(command);
      if (!safety.safe && !confirmDangerous) {
        return res.status(403).json({
          error: "Command blocked by safety policy",
          reason: safety.reason,
          severity: safety.severity,
          requiresConfirmation: true,
        });
      }

      const request: CommandRequest = {
        command,
        args,
        env,
        timeout: timeout || 30000,
        stream: stream !== false,
        interactive,
        confirmDangerous,
      };

      const result = await remoteShellController.executeCommand(req.params.sessionId, request);

      const session = remoteShellController.getSessionInfo(req.params.sessionId);
      await auditAdminAction(req, "remote_shell.exec", "remote_session", req.params.sessionId, {
        host: session?.connection.host,
        username: session?.connection.username,
        command,
        exitCode: result.exitCode,
        durationMs: result.duration,
        success: result.success,
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Remote Shell Targets
  // ============================================

  router.get("/remote/targets", async (req: Request, res: Response) => {
    try {
      const { userId } = getAuthContext(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      const targets = await remoteShellRepository.listTargetsForAdmin(userId);
      res.json({ targets });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/remote/targets", async (req: Request, res: Response) => {
    try {
      ensureRemoteSecretConfiguredOrThrow();
      const { userId } = getAuthContext(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { name, host, port, username, authType, secret, allowedAdminIds, notes } = req.body || {};

      if (!name || !host || !username || !authType) {
        return res.status(400).json({ error: "name, host, username and authType are required" });
      }

      if (!secret || typeof secret !== "string") {
        return res.status(400).json({ error: "secret is required" });
      }

      if (!["password", "private_key"].includes(authType)) {
        return res.status(400).json({ error: "authType must be password or private_key" });
      }

      const encryptedSecret = encryptSecret(secret);
      const secretHint = authType === "password" ? secret.slice(-4) : secret.slice(0, 16);

      const target = await remoteShellRepository.createTarget({
        name,
        host,
        port,
        username,
        authType,
        encryptedSecret,
        secretHint,
        ownerId: userId,
        allowedAdminIds: Array.isArray(allowedAdminIds) ? allowedAdminIds : [],
        notes,
      });

      await auditAdminAction(req, "remote_target.create", "remote_target", target.id, {
        host,
        username,
      });

      res.status(201).json({ target });
    } catch (error: any) {
      const status = error.message?.includes("REMOTE_SHELL_SECRET") ? 503 : 500;
      res.status(status).json({ error: error.message });
    }
  });

  router.put("/remote/targets/:targetId", async (req: Request, res: Response) => {
    try {
      const { userId } = getAuthContext(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const target = await remoteShellRepository.getTargetById(req.params.targetId);
      if (!target) {
        return res.status(404).json({ error: "Target not found" });
      }
      if (!canAccessTarget(target, userId)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { name, host, port, username, authType, secret, allowedAdminIds, notes } = req.body || {};

      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (host !== undefined) updates.host = host;
      if (port !== undefined) updates.port = port;
      if (username !== undefined) updates.username = username;
      if (authType !== undefined) {
        if (!["password", "private_key"].includes(authType)) {
          return res.status(400).json({ error: "authType must be password or private_key" });
        }
        updates.authType = authType;
      }
      if (notes !== undefined) updates.notes = notes;
      if (allowedAdminIds !== undefined) {
        updates.allowedAdminIds = Array.isArray(allowedAdminIds) ? allowedAdminIds : [];
      }

      if (secret !== undefined) {
        ensureRemoteSecretConfiguredOrThrow();
        if (!secret) {
          return res.status(400).json({ error: "secret cannot be empty" });
        }
        updates.encryptedSecret = encryptSecret(secret);
        updates.secretHint = updates.authType === "private_key" || target.authType === "private_key"
          ? secret.slice(0, 16)
          : secret.slice(-4);
      }

      const updated = await remoteShellRepository.updateTarget(req.params.targetId, updates);
      await auditAdminAction(req, "remote_target.update", "remote_target", req.params.targetId, updates);
      res.json({ target: updated });
    } catch (error: any) {
      const status = error.message?.includes("REMOTE_SHELL_SECRET") ? 503 : 500;
      res.status(status).json({ error: error.message });
    }
  });

  router.delete("/remote/targets/:targetId", async (req: Request, res: Response) => {
    try {
      const { userId } = getAuthContext(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const target = await remoteShellRepository.getTargetById(req.params.targetId);
      if (!target) {
        return res.status(404).json({ error: "Target not found" });
      }
      if (!canAccessTarget(target, userId)) {
        return res.status(403).json({ error: "Access denied" });
      }

      await remoteShellRepository.deleteTarget(req.params.targetId);
      await auditAdminAction(req, "remote_target.delete", "remote_target", req.params.targetId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/remote/targets/:targetId/test", async (req: Request, res: Response) => {
    try {
      const { userId } = getAuthContext(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      const target = await remoteShellRepository.getTargetById(req.params.targetId);
      if (!target) {
        return res.status(404).json({ error: "Target not found" });
      }
      if (!canAccessTarget(target, userId)) {
        return res.status(403).json({ error: "Access denied" });
      }

      ensureRemoteSecretConfiguredOrThrow();
      const secret = decryptSecret(target.encryptedSecret);
      const { sessionId } = await remoteShellController.createSession({
        host: target.host,
        port: target.port ?? 22,
        username: target.username,
        password: target.authType === "password" ? secret : undefined,
        privateKey: target.authType === "private_key" ? secret : undefined,
      });
      remoteShellController.closeSession(sessionId);
      res.json({ success: true });
    } catch (error: any) {
      const status = error.message?.includes("REMOTE_SHELL_SECRET") ? 503 : 500;
      res.status(status).json({ error: error.message });
    }
  });

  router.post("/remote/targets/:targetId/sessions", async (req: Request, res: Response) => {
    try {
      const { userId } = getAuthContext(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      const target = await remoteShellRepository.getTargetById(req.params.targetId);
      if (!target) {
        return res.status(404).json({ error: "Target not found" });
      }
      if (!canAccessTarget(target, userId)) {
        return res.status(403).json({ error: "Access denied" });
      }

      ensureRemoteSecretConfiguredOrThrow();
      const secret = decryptSecret(target.encryptedSecret);

      const { sessionId, cwd } = await remoteShellController.createSession({
        host: target.host,
        port: target.port ?? 22,
        username: target.username,
        password: target.authType === "password" ? secret : undefined,
        privateKey: target.authType === "private_key" ? secret : undefined,
      });

      attachStreamingListeners(remoteShellController, sessionId);
      await remoteShellRepository.recordSuccess(target.id);
      await auditAdminAction(req, "remote_shell.session_start", "remote_target", target.id, {
        sessionId,
        host: target.host,
        username: target.username,
      });

      res.json({ sessionId, cwd, targetId: target.id });
    } catch (error: any) {
      const status = error.message?.includes("REMOTE_SHELL_SECRET") ? 503 : 500;
      res.status(status).json({ error: error.message });
    }
  });

  // ============================================
  // Disk & Resource Monitoring
  // ============================================

  /** Get disk usage */
  router.get("/disk-usage", async (_req: Request, res: Response) => {
    try {
      const tempSession = terminalController.createSession();
      const result = await terminalController.executeCommand(tempSession, {
        command: "df -h --output=source,size,used,avail,pcent,target 2>/dev/null || df -h",
        timeout: 5000,
        shell: "bash",
        stream: false,
      });
      terminalController.closeSession(tempSession);

      const lines = result.stdout?.split("\n").filter((l) => l.trim()) || [];
      const header = lines[0] || "";
      const disks = lines.slice(1).map((line) => {
        const parts = line.split(/\s+/);
        return {
          filesystem: parts[0],
          size: parts[1],
          used: parts[2],
          available: parts[3],
          usePercent: parts[4],
          mountpoint: parts[5],
        };
      });

      res.json({ disks });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Get resource usage (CPU, Memory top processes) */
  router.get("/resource-usage", async (_req: Request, res: Response) => {
    try {
      const tempSession = terminalController.createSession();
      const result = await terminalController.executeCommand(tempSession, {
        command: 'ps aux --sort=-%mem | head -11',
        timeout: 5000,
        shell: "bash",
        stream: false,
      });
      terminalController.closeSession(tempSession);

      const lines = result.stdout?.split("\n").filter((l) => l.trim()) || [];
      const processes = lines.slice(1).map((line) => {
        const parts = line.split(/\s+/);
        return {
          user: parts[0],
          pid: parts[1],
          cpu: parts[2],
          mem: parts[3],
          vsz: parts[4],
          rss: parts[5],
          command: parts.slice(10).join(" "),
        };
      });

      res.json({ topProcesses: processes });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

/** Broadcast terminal output to subscribed WebSocket clients */
function broadcastTerminalOutput(sessionId: string, message: any): void {
  const clients = terminalClients.get(sessionId);
  if (!clients) return;

  const payload = JSON.stringify({
    messageType: "terminal_event",
    sessionId,
    ...message,
  });

  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

export { terminalController, terminalClients };
