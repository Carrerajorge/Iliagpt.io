import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/apiClient";

export interface CommandResult {
  id: string;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  duration: number;
  killed: boolean;
  signal: string | null;
  success: boolean;
}

export interface TerminalEvent {
  type: "output" | "complete" | "ack" | "subscribed";
  sessionId: string;
  commandId?: string;
  stream?: "stdout" | "stderr";
  chunk?: string;
  result?: CommandResult;
  timestamp: number;
}

export interface TerminalLine {
  id: string;
  type: "input" | "stdout" | "stderr" | "system" | "error";
  content: string;
  timestamp: number;
}

type SessionType = "local" | "remote" | null;

export interface TerminalSessionState {
  sessionId: string | null;
  status: "idle" | "connecting" | "active" | "closed" | "error";
  sessionType: SessionType;
  cwd: string;
  lines: TerminalLine[];
  isExecuting: boolean;
  error: string | null;
  remoteContext?: {
    targetId?: string;
    name?: string;
    host?: string;
    username?: string;
  };
}

export interface RemoteShellTargetSummary {
  id: string;
  name: string;
  host: string;
  port?: number;
  username: string;
  authType: "password" | "private_key";
  secretHint?: string;
  notes?: string;
  lastConnectedAt?: string;
}

const initialState: TerminalSessionState = {
  sessionId: null,
  status: "idle",
  sessionType: null,
  cwd: "",
  lines: [],
  isExecuting: false,
  error: null,
};

let lineIdCounter = 0;

function createLine(type: TerminalLine["type"], content: string): TerminalLine {
  return {
    id: `line-${++lineIdCounter}`,
    type,
    content,
    timestamp: Date.now(),
  };
}

export function useTerminalSession() {
  const [state, setState] = useState<TerminalSessionState>(initialState);
  const [remoteTargets, setRemoteTargets] = useState<RemoteShellTargetSummary[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const addLine = useCallback((type: TerminalLine["type"], content: string) => {
    setState((prev) => ({
      ...prev,
      lines: [...prev.lines, createLine(type, content)],
    }));
  }, []);

  const getSessionEndpoint = useCallback(
    (sessionId: string | null, suffix: string) => {
      if (!sessionId) return null;
      const base = state.sessionType === "remote"
        ? `/api/terminal/remote/sessions/${sessionId}`
        : `/api/terminal/sessions/${sessionId}`;
      return `${base}${suffix}`;
    },
    [state.sessionType]
  );

  const connectWebSocket = useCallback((sessionId: string) => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/terminal`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", sessionId }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "subscribed") {
          setState((prev) => ({ ...prev, status: "active" }));
        } else if (data.messageType === "terminal_event") {
          if (data.type === "output") {
            const lineType = data.stream === "stderr" ? "stderr" : "stdout";
            // Split output by newlines and add each as separate line
            const chunks = data.chunk.split("\n").filter((c: string) => c.length > 0);
            setState((prev) => ({
              ...prev,
              lines: [
                ...prev.lines,
                ...chunks.map((c: string) => createLine(lineType, c)),
              ],
            }));
          } else if (data.type === "complete") {
            setState((prev) => ({
              ...prev,
              isExecuting: false,
            }));
          }
        }
      } catch (e) {
        console.error("Error parsing terminal event:", e);
      }
    };

    ws.onerror = (error) => {
      console.error("Terminal WebSocket error:", error);
    };

    ws.onclose = () => {
      wsRef.current = null;
    };
  }, []);

  /** Create a new local terminal session */
  const startLocalSession = useCallback(async (cwd?: string, env?: Record<string, string>) => {
    try {
      setState((prev) => ({ ...prev, status: "connecting" }));

      const response = await apiFetch("/api/terminal/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, env }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create session");
      }

      const { sessionId, cwd: sessionCwd } = await response.json();

      setState({
        sessionId,
        status: "active",
        sessionType: "local",
        cwd: sessionCwd,
        lines: [createLine("system", `Terminal session started. Working directory: ${sessionCwd}`)],
        isExecuting: false,
        error: null,
        remoteContext: undefined,
      });

      connectWebSocket(sessionId);
      return sessionId;
    } catch (error: any) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: error.message,
      }));
      throw error;
    }
  }, [connectWebSocket]);

  /** Create a remote session with manual credentials */
  const startRemoteSession = useCallback(async (options: {
    host: string;
    port?: number;
    username: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
  }) => {
    try {
      setState((prev) => ({ ...prev, status: "connecting" }));

      const response = await apiFetch("/api/terminal/remote/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to start remote session");
      }

      const { sessionId, cwd } = await response.json();

      setState({
        sessionId,
        status: "active",
        sessionType: "remote",
        cwd,
        lines: [createLine("system", `Remote session started on ${options.host}`)],
        isExecuting: false,
        error: null,
        remoteContext: {
          host: options.host,
          username: options.username,
        },
      });

      connectWebSocket(sessionId);
      return sessionId;
    } catch (error: any) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: error.message,
      }));
      throw error;
    }
  }, [connectWebSocket]);

  /** Create remote session from saved target */
  const startRemoteSessionFromTarget = useCallback(async (targetId: string) => {
    try {
      setState((prev) => ({ ...prev, status: "connecting" }));

      const response = await apiFetch(`/api/terminal/remote/targets/${targetId}/sessions`, {
        method: "POST",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to start remote session");
      }

      const { sessionId, cwd, targetId: returnedTargetId } = await response.json();
      const target = remoteTargets.find((t) => t.id === returnedTargetId);

      setState({
        sessionId,
        status: "active",
        sessionType: "remote",
        cwd,
        lines: [createLine("system", `Remote session started via target ${target?.name || returnedTargetId}`)],
        isExecuting: false,
        error: null,
        remoteContext: target
          ? {
              targetId: target.id,
              name: target.name,
              host: target.host,
              username: target.username,
            }
          : { targetId: returnedTargetId },
      });

      connectWebSocket(sessionId);
      return sessionId;
    } catch (error: any) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: error.message,
      }));
      throw error;
    }
  }, [connectWebSocket, remoteTargets]);

  /** Remote targets */
  const fetchRemoteTargets = useCallback(async () => {
    try {
      const response = await apiFetch("/api/terminal/remote/targets");
      if (!response.ok) {
        throw new Error("Failed to load remote targets");
      }
      const data = await response.json();
      setRemoteTargets(data.targets || []);
      return data.targets || [];
    } catch (error) {
      console.error(error);
      return [];
    }
  }, []);

  const createRemoteTarget = useCallback(async (payload: {
    name: string;
    host: string;
    port?: number;
    username: string;
    authType: "password" | "private_key";
    secret: string;
    allowedAdminIds?: string[];
    notes?: string;
  }) => {
    const response = await apiFetch("/api/terminal/remote/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to create target");
    }
    const data = await response.json();
    setRemoteTargets((prev) => [...prev, data.target]);
    return data.target as RemoteShellTargetSummary;
  }, []);

  const deleteRemoteTarget = useCallback(async (targetId: string) => {
    const response = await apiFetch(`/api/terminal/remote/targets/${targetId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to delete target");
    }
    setRemoteTargets((prev) => prev.filter((t) => t.id !== targetId));
  }, []);

  /** Execute a command */
  const executeCommand = useCallback(async (command: string, options?: {
    shell?: "bash" | "sh" | "zsh" | "powershell" | "cmd";
    timeout?: number;
    cwd?: string;
    env?: Record<string, string>;
    interactive?: boolean;
    inDocker?: boolean;
    dockerImage?: string;
    confirmDangerous?: boolean;
  }) => {
    if (!state.sessionId) return null;

    const endpoint = getSessionEndpoint(state.sessionId, "/exec");
    if (!endpoint) return null;

    setState((prev) => ({
      ...prev,
      isExecuting: true,
      lines: [...prev.lines, createLine("input", `$ ${command}`)],
    }));

    try {
      const response = await apiFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command,
          stream: true,
          ...options,
        }),
      });

      if (response.status === 403) {
        const errorData = await response.json();
        if (errorData.requiresConfirmation) {
          // Instead of failing immediately, return a special result indicating confirmation is needed
          addLine("error", `⚠️ SAFETY ALERT: ${errorData.reason}`);
          addLine("error", `This command is potentially dangerous (Severity: ${errorData.severity}).`);
          setState((prev) => ({ ...prev, isExecuting: false }));
          return { success: false, requiresConfirmation: true, reason: errorData.reason };
        }
      }

      const result: CommandResult = await response.json();

      // If streaming was not used, manually add output
      if (result.stdout && !wsRef.current) {
        const stdoutLines = result.stdout.split("\n").filter((l) => l.length > 0);
        for (const line of stdoutLines) {
          addLine("stdout", line);
        }
      }
      if (result.stderr && !wsRef.current) {
        const stderrLines = result.stderr.split("\n").filter((l) => l.length > 0);
        for (const line of stderrLines) {
          addLine("stderr", line);
        }
      }

      if (!result.success) {
        addLine("error", `Process exited with code ${result.exitCode}`);
      }

      // Update cwd in case command changed it
      try {
        const sessionInfoEndpoint = getSessionEndpoint(state.sessionId, "");
        if (sessionInfoEndpoint) {
          const sessionRes = await apiFetch(sessionInfoEndpoint);
          if (sessionRes.ok) {
            const sessionData = await sessionRes.json();
            setState((prev) => ({
              ...prev,
              cwd: sessionData.cwd ?? prev.cwd,
            }));
          }
        }
      } catch {
        // ignore
      }

      setState((prev) => ({ ...prev, isExecuting: false }));
      return result;
    } catch (error: any) {
      addLine("error", `Error: ${error.message}`);
      setState((prev) => ({ ...prev, isExecuting: false }));
      return null;
    }
  }, [state.sessionId, addLine, getSessionEndpoint]);

  /** Execute a script */
  const executeScript = useCallback(async (language: string, code: string, options?: {
    timeout?: number;
    args?: string[];
    shell?: "bash" | "sh" | "zsh" | "powershell" | "cmd";
  }) => {
    if (!state.sessionId) return null;
    if (state.sessionType === "remote") {
      addLine("error", "Script runner is only available for local sessions.");
      return null;
    }

    const endpoint = getSessionEndpoint(state.sessionId, "/script");
    if (!endpoint) return null;

    setState((prev) => ({
      ...prev,
      isExecuting: true,
      lines: [
        ...prev.lines,
        createLine("input", `[${language}] Running script...`),
      ],
    }));

    try {
      const response = await apiFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, code, ...options }),
      });

      const result: CommandResult = await response.json();

      if (result.stdout) {
        result.stdout.split("\n").filter((l) => l).forEach((l) => addLine("stdout", l));
      }
      if (result.stderr) {
        result.stderr.split("\n").filter((l) => l).forEach((l) => addLine("stderr", l));
      }

      setState((prev) => ({ ...prev, isExecuting: false }));
      return result;
    } catch (error: any) {
      addLine("error", `Script error: ${error.message}`);
      setState((prev) => ({ ...prev, isExecuting: false }));
      return null;
    }
  }, [state.sessionId, addLine]);

  /** File operations */
  const fileOperation = useCallback(async (operation: {
    type: "read" | "write" | "append" | "delete" | "copy" | "move" | "mkdir" | "list" | "stat" | "search";
    path: string;
    destination?: string;
    content?: string;
    pattern?: string;
    recursive?: boolean;
  }) => {
    if (!state.sessionId) return null;
    if (state.sessionType === "remote") {
      addLine("error", "File manager is only available for local sessions.");
      return null;
    }

    const endpoint = getSessionEndpoint(state.sessionId, "/file");
    if (!endpoint) return null;

    try {
      const response = await apiFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operation),
      });

      return await response.json();
    } catch (error: any) {
      addLine("error", `File operation error: ${error.message}`);
      return null;
    }
  }, [state.sessionId, addLine, state.sessionType, getSessionEndpoint]);

  /** Get system info */
  const getSystemInfo = useCallback(async () => {
    try {
      const response = await apiFetch("/api/terminal/system-info");
      return await response.json();
    } catch (error: any) {
      return null;
    }
  }, []);

  /** List processes */
  const listProcesses = useCallback(async (filter?: string) => {
    try {
      const url = filter ? `/api/terminal/processes?filter=${encodeURIComponent(filter)}` : "/api/terminal/processes";
      const response = await apiFetch(url);
      return await response.json();
    } catch (error: any) {
      return null;
    }
  }, []);

  /** Kill a process */
  const killProcess = useCallback(async (pid: number, signal?: string) => {
    try {
      const response = await apiFetch(`/api/terminal/processes/${pid}/kill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signal }),
      });
      return await response.json();
    } catch (error: any) {
      return null;
    }
  }, []);

  /** Get command history */
  const getHistory = useCallback(async (limit?: number) => {
    if (!state.sessionId) return null;

    const suffix = limit ? `/history?limit=${limit}` : "/history";
    const endpoint = getSessionEndpoint(state.sessionId, suffix);
    if (!endpoint) return null;

    try {
      const response = await apiFetch(endpoint);
      return await response.json();
    } catch (error: any) {
      return null;
    }
  }, [state.sessionId, getSessionEndpoint]);

  /** Close the session */
  const closeSession = useCallback(async () => {
    if (!state.sessionId) return;

    try {
      const endpoint = getSessionEndpoint(state.sessionId, "");
      if (endpoint) {
        await apiFetch(endpoint, { method: "DELETE" });
      }
    } catch (error) {
      console.error("Error closing terminal session:", error);
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setState(initialState);
  }, [state.sessionId, getSessionEndpoint]);

  /** Clear terminal output */
  const clearOutput = useCallback(() => {
    setState((prev) => ({
      ...prev,
      lines: [createLine("system", "Terminal cleared.")],
    }));
  }, []);

  /** Reset terminal */
  const reset = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setState(initialState);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return {
    state,
    startLocalSession,
    startRemoteSession,
    startRemoteSessionFromTarget,
    remoteTargets,
    fetchRemoteTargets,
    createRemoteTarget,
    deleteRemoteTarget,
    executeCommand,
    executeScript,
    fileOperation,
    getSystemInfo,
    listProcesses,
    killProcess,
    getHistory,
    closeSession,
    clearOutput,
    reset,
  };
}
