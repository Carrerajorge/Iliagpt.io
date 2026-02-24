import { Router, Request, Response } from "express";
import {
  TerminalController,
  type CommandRequest,
  type CommandResult,
} from "../agent/terminalController";
import { UniversalBrowserController } from "../agent/universalBrowserController";
import { RemoteShellController } from "../agent/remoteShellController";
import { remoteShellRepository } from "../repositories/remoteShellRepository";
import { decryptSecret, isRemoteSecretConfigured } from "../lib/crypto/secretVault";
import { requireAdmin as requireAdminMiddleware } from "./admin/utils";

interface DeviceDescriptor {
  id: string;
  name: string;
  kind: "local" | "remote";
  capabilities: string[];
  host?: string;
  port?: number;
  username?: string;
  notes?: string | null;
}

const terminal = new TerminalController();
const browser = new UniversalBrowserController();
const remoteShell = new RemoteShellController();

const localSessions = new Map<string, string>();
const remoteSessions = new Map<string, string>();

function getAdminId(req: Request): string | null {
  const authReq: any = req as any;
  const session: any = (req as any).session || {};

  return (
    authReq?.user?.claims?.sub ||
    authReq?.user?.id ||
    session?.authUserId ||
    session?.passport?.user?.claims?.sub ||
    session?.passport?.user?.id ||
    null
  );
}

async function getLocalSession(adminId: string): Promise<string> {
  const key = `admin:${adminId}`;
  const existing = localSessions.get(key);
  if (existing) return existing;

  const sessionId = terminal.createSession();
  localSessions.set(key, sessionId);
  return sessionId;
}

function canAccessTarget(target: { ownerId: string; allowedAdminIds: string[] | null }, adminId: string) {
  if (target.ownerId === adminId) return true;
  return Boolean(target.allowedAdminIds?.includes(adminId));
}

async function ensureRemoteSession(targetId: string, adminId: string): Promise<string> {
  if (!isRemoteSecretConfigured()) {
    throw new Error("REMOTE_SHELL_SECRET is not configured");
  }

  const existing = remoteSessions.get(targetId);
  if (existing) return existing;

  const target = await remoteShellRepository.getTargetById(targetId);
  if (!target) {
    throw new Error(`Remote target ${targetId} not found`);
  }

  if (!canAccessTarget(target, adminId)) {
    throw new Error("No access to this remote target");
  }

  const secret = decryptSecret(target.encryptedSecret);

  const { sessionId } = await remoteShell.createSession({
    host: target.host,
    port: target.port || 22,
    username: target.username,
    password: target.authType === "password" ? secret : undefined,
    privateKey: target.authType === "private_key" ? secret : undefined,
  });

  remoteSessions.set(targetId, sessionId);
  await remoteShellRepository.recordSuccess(targetId).catch(() => undefined);
  return sessionId;
}

function normalizeCommandResult(result: CommandResult) {
  return {
    id: result.id,
    command: result.command,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    duration: result.duration,
    success: result.success,
    killed: result.killed,
    signal: result.signal,
  };
}

export function createDeviceControlRouter() {
  const router = Router();

  router.get("/devices", requireAdminMiddleware, async (req: Request, res: Response) => {
    try {
      const adminId = getAdminId(req);
      if (!adminId) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }

      const remote = await remoteShellRepository.listTargetsForAdmin(adminId);
      const devices: DeviceDescriptor[] = [
        {
          id: "local",
          name: "Host local",
          kind: "local",
          capabilities: ["terminal", "browser", "process", "system"],
        },
        ...remote.map((target) => ({
          id: target.id,
          name: target.name,
          kind: "remote" as const,
          capabilities: ["remote_terminal"],
          host: target.host,
          port: target.port || 22,
          username: target.username,
          notes: target.notes,
        })),
      ];

      res.json({ success: true, devices });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error?.message || "Failed to list devices" });
    }
  });

  router.post("/devices/:deviceId/terminal/exec", requireAdminMiddleware, async (req: Request, res: Response) => {
    try {
      const adminId = getAdminId(req);
      if (!adminId) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }

      const deviceId = req.params.deviceId;
      const {
        command,
        args,
        cwd,
        env,
        timeout,
        shell,
        stream,
        interactive,
        confirmDangerous,
        inDocker,
        dockerImage,
      } = req.body || {};

      if (!command || typeof command !== "string") {
        return res.status(400).json({ success: false, error: "command is required" });
      }

      const request: CommandRequest = {
        command,
        args,
        cwd,
        env,
        timeout: Number(timeout) || 30000,
        shell,
        stream: Boolean(stream),
        interactive: Boolean(interactive),
        inDocker: Boolean(inDocker),
        dockerImage,
        confirmDangerous: Boolean(confirmDangerous),
      };

      if (deviceId === "local") {
        const sessionId = await getLocalSession(adminId);
        const result = await terminal.executeCommand(sessionId, request);
        return res.json({ success: true, target: "local", ...normalizeCommandResult(result) });
      }

      const remoteSessionId = await ensureRemoteSession(deviceId, adminId);
      const result = await remoteShell.executeCommand(remoteSessionId, request as any);
      res.json({ success: true, target: deviceId, ...normalizeCommandResult(result) });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error?.message || "Command execution failed" });
    }
  });

  router.post("/devices/:deviceId/terminal/close", requireAdminMiddleware, async (req: Request, res: Response) => {
    try {
      const adminId = getAdminId(req);
      if (!adminId) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }

      const deviceId = req.params.deviceId;
      if (deviceId === "local") {
        const key = `admin:${adminId}`;
        const sessionId = localSessions.get(key);
        if (!sessionId) {
          return res.json({ success: true, target: "local", message: "already closed" });
        }

        terminal.closeSession(sessionId);
        localSessions.delete(key);
        return res.json({ success: true, target: "local", message: "closed" });
      }

      const sessionId = remoteSessions.get(deviceId);
      if (!sessionId) {
        return res.json({ success: true, target: deviceId, message: "already closed" });
      }

      remoteShell.closeSession(sessionId);
      remoteSessions.delete(deviceId);
      res.json({ success: true, target: deviceId, message: "closed" });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error?.message || "Failed to close terminal session" });
    }
  });

  router.post("/browser/sessions", requireAdminMiddleware, async (req: Request, res: Response) => {
    try {
      const { profileId, customProfile } = req.body || {};
      const sessionId = await browser.createSession(profileId || "chrome-desktop", customProfile);
      res.json({ success: true, sessionId });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error?.message || "Failed to create browser session" });
    }
  });

  router.post("/browser/sessions/:sessionId/action", requireAdminMiddleware, async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.sessionId;
      const { action, ...params } = req.body || {};

      if (!action || typeof action !== "string") {
        return res.status(400).json({ success: false, error: "action is required" });
      }

      switch (action) {
        case "navigate": {
          const { url, waitUntil, timeout, tabId } = params as {
            url?: string;
            waitUntil?: any;
            timeout?: number;
            tabId?: string;
          };
          if (!url || typeof url !== "string") {
            return res.status(400).json({ success: false, error: "url is required" });
          }
          const result = await browser.navigate(sessionId, url, { waitUntil, timeout, tabId });
          return res.json({ success: true, action: "navigate", result });
        }
        case "click": {
          const { selector, button, clickCount, timeout, force } = params as any;
          const result = await browser.click(sessionId, selector, { button, clickCount, timeout, force });
          return res.json({ success: true, action: "click", result });
        }
        case "type": {
          const { selector, text, clear, delay, pressEnter } = params as any;
          const result = await browser.type(sessionId, selector, text, { clear, delay, pressEnter });
          return res.json({ success: true, action: "type", result });
        }
        case "scroll": {
          const { direction, amount, selector } = params as any;
          await browser.scroll(sessionId, { direction: direction || "down", amount, selector });
          return res.json({ success: true, action: "scroll" });
        }
        case "screenshot": {
          const { fullPage, selector, type } = params as any;
          const result = await browser.screenshot(sessionId, {
            fullPage: Boolean(fullPage),
            selector,
            type: type || "png",
          });
          return res.json({ success: true, action: "screenshot", result });
        }
        case "tabs": {
          const tabs = browser.listTabs(sessionId);
          return res.json({ success: true, action: "tabs", tabs });
        }
        case "newTab": {
          const { url } = params as any;
          const tabId = await browser.newTab(sessionId, url);
          return res.json({ success: true, action: "newTab", tabId });
        }
        case "close": {
          const { tabId } = params as any;
          if (tabId) {
            await browser.closeTab(sessionId, tabId);
            return res.json({ success: true, action: "close", tabId });
          }
          await browser.closeSession(sessionId);
          return res.json({ success: true, action: "close", message: "session closed" });
        }
        default:
          return res.status(400).json({ success: false, error: `Unsupported browser action: ${action}` });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, error: error?.message || "Browser action failed" });
    }
  });

  return router;
}

export const createDeviceControlRouterDefault = createDeviceControlRouter;
