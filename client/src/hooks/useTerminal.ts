/**
 * useTerminal.ts
 *
 * Terminal session management with WebSocket real-time I/O.
 * Preserves raw ANSI escape codes in TerminalLine.content — the renderer
 * is responsible for interpreting or stripping them (e.g. xterm.js or
 * ansi-to-html).
 */

import { useState, useCallback, useRef, useEffect } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TerminalLineType = 'input' | 'output' | 'error' | 'system';

export interface TerminalLine {
  id: string;
  type: TerminalLineType;
  content: string; // may contain ANSI escape codes
  timestamp: number;
}

export interface TerminalSession {
  id: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  lines: TerminalLine[];
  cwd: string;
  pid?: number;
}

export interface UseTerminalOptions {
  sessionId?: string;
  cwd?: string;
}

// ---------------------------------------------------------------------------
// WebSocket message shapes
// ---------------------------------------------------------------------------

interface WsOutputMsg {
  type: 'output';
  data: string;
}

interface WsErrorMsg {
  type: 'error';
  data: string;
}

interface WsCwdMsg {
  type: 'cwd';
  cwd: string;
}

interface WsExitMsg {
  type: 'exit';
  code: number;
}

interface WsConnectedMsg {
  type: 'connected';
  sessionId: string;
  pid?: number;
  cwd?: string;
}

type WsInboundMessage =
  | WsOutputMsg
  | WsErrorMsg
  | WsCwdMsg
  | WsExitMsg
  | WsConnectedMsg;

function parseWsMessage(raw: string): WsInboundMessage | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    if (
      obj['type'] === 'output' ||
      obj['type'] === 'error' ||
      obj['type'] === 'cwd' ||
      obj['type'] === 'exit' ||
      obj['type'] === 'connected'
    ) {
      return parsed as WsInboundMessage;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_HISTORY = 100;
const MAX_LINES = 5_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _lineCounter = 0;
function generateLineId(): string {
  return `line-${Date.now()}-${++_lineCounter}`;
}

function appendLine(
  lines: TerminalLine[],
  type: TerminalLineType,
  content: string
): TerminalLine[] {
  const next = [
    ...lines,
    { id: generateLineId(), type, content, timestamp: Date.now() },
  ];
  // Trim to keep memory bounded
  return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
}

// ---------------------------------------------------------------------------
// useTerminal
// ---------------------------------------------------------------------------

export function useTerminal(options: UseTerminalOptions = {}): {
  session: TerminalSession | null;
  connect: (sessionId?: string) => Promise<void>;
  disconnect: () => void;
  reconnect: () => void;
  sendCommand: (command: string) => void;
  sendRaw: (data: string) => void;
  clear: () => void;
  isConnected: boolean;
  commandHistory: string[];
  historyIndex: number;
  navigateHistory: (direction: 'up' | 'down') => string;
  shouldAutoScroll: boolean;
  setShouldAutoScroll: (v: boolean) => void;
} {
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [shouldAutoScroll, setShouldAutoScroll] = useState<boolean>(true);

  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);
  const connectPromiseResolveRef = useRef<(() => void) | null>(null);
  const connectPromiseRejectRef = useRef<((err: Error) => void) | null>(null);
  // Remember the last sessionId/cwd so reconnect() can reuse them
  const lastSessionIdRef = useRef<string | undefined>(options.sessionId);
  const lastCwdRef = useRef<string | undefined>(options.cwd);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  // -------------------------------------------------------------------------
  // connect
  // -------------------------------------------------------------------------

  const connect = useCallback(
    (sessionId?: string): Promise<void> => {
      return new Promise<void>((resolve, reject) => {
        if (!mountedRef.current) {
          reject(new Error('Component unmounted'));
          return;
        }

        // Close any existing connection first
        if (wsRef.current) {
          wsRef.current.onclose = null;
          wsRef.current.onerror = null;
          wsRef.current.onmessage = null;
          wsRef.current.close();
          wsRef.current = null;
        }

        const sid = sessionId ?? lastSessionIdRef.current;
        const cwd = lastCwdRef.current;
        lastSessionIdRef.current = sid;

        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const host = window.location.host;
        const params = new URLSearchParams();
        if (sid) params.set('sessionId', sid);
        if (cwd) params.set('cwd', cwd);
        const url = `${protocol}://${host}/api/terminal/ws?${params.toString()}`;

        // Create a provisional session so the UI can show "connecting"
        const provisionalId = sid ?? `session-${Date.now()}`;
        if (mountedRef.current) {
          setSession({
            id: provisionalId,
            status: 'connecting',
            lines: [],
            cwd: cwd ?? '~',
          });
        }

        let ws: WebSocket;
        try {
          ws = new WebSocket(url);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          if (mountedRef.current) {
            setSession((prev) =>
              prev ? { ...prev, status: 'error' } : null
            );
          }
          reject(error);
          return;
        }

        wsRef.current = ws;
        connectPromiseResolveRef.current = resolve;
        connectPromiseRejectRef.current = reject;

        ws.onopen = () => {
          // The server will send a 'connected' message with the real session info
          // We wait for that before resolving.
        };

        ws.onmessage = (ev: MessageEvent<unknown>) => {
          if (typeof ev.data !== 'string') return;
          const msg = parseWsMessage(ev.data);
          if (!msg || !mountedRef.current) return;

          switch (msg.type) {
            case 'connected': {
              const resolvedId = msg.sessionId ?? provisionalId;
              lastSessionIdRef.current = resolvedId;
              setSession((prev) => ({
                id: resolvedId,
                status: 'connected',
                lines: prev?.lines ?? [],
                cwd: msg.cwd ?? prev?.cwd ?? '~',
                pid: msg.pid,
              }));
              connectPromiseResolveRef.current?.();
              connectPromiseResolveRef.current = null;
              connectPromiseRejectRef.current = null;
              break;
            }

            case 'output':
              setSession((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  lines: appendLine(prev.lines, 'output', msg.data),
                };
              });
              break;

            case 'error':
              setSession((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  lines: appendLine(prev.lines, 'error', msg.data),
                };
              });
              break;

            case 'cwd':
              setSession((prev) =>
                prev ? { ...prev, cwd: msg.cwd } : prev
              );
              break;

            case 'exit':
              setSession((prev) => {
                if (!prev) return prev;
                const exitLine: TerminalLine = {
                  id: generateLineId(),
                  type: 'system',
                  content: `Process exited with code ${msg.code}`,
                  timestamp: Date.now(),
                };
                return {
                  ...prev,
                  status: 'disconnected',
                  lines: [...prev.lines, exitLine],
                };
              });
              break;
          }
        };

        ws.onclose = () => {
          if (!mountedRef.current) return;
          setSession((prev) =>
            prev && prev.status !== 'disconnected'
              ? {
                  ...prev,
                  status: 'disconnected',
                  lines: appendLine(
                    prev.lines,
                    'system',
                    'Connection closed.'
                  ),
                }
              : prev
          );
          // Reject pending connect promise if still outstanding
          connectPromiseRejectRef.current?.(new Error('WebSocket closed'));
          connectPromiseResolveRef.current = null;
          connectPromiseRejectRef.current = null;
        };

        ws.onerror = () => {
          if (!mountedRef.current) return;
          setSession((prev) =>
            prev ? { ...prev, status: 'error' } : prev
          );
          connectPromiseRejectRef.current?.(
            new Error('WebSocket connection error')
          );
          connectPromiseResolveRef.current = null;
          connectPromiseRejectRef.current = null;
          // onerror is always followed by onclose
        };
      });
    },
    []
  );

  // -------------------------------------------------------------------------
  // disconnect
  // -------------------------------------------------------------------------

  const disconnect = useCallback((): void => {
    wsRef.current?.close();
    wsRef.current = null;
    if (mountedRef.current) {
      setSession((prev) =>
        prev ? { ...prev, status: 'disconnected' } : prev
      );
    }
  }, []);

  // -------------------------------------------------------------------------
  // reconnect
  // -------------------------------------------------------------------------

  const reconnect = useCallback((): void => {
    disconnect();
    // Small delay to let the close event propagate before reconnecting
    setTimeout(() => {
      if (mountedRef.current) {
        connect(lastSessionIdRef.current).catch(() => {
          /* error handled inside connect */
        });
      }
    }, 100);
  }, [connect, disconnect]);

  // -------------------------------------------------------------------------
  // sendCommand — appends a visible input line and sends over WS
  // -------------------------------------------------------------------------

  const sendCommand = useCallback((command: string): void => {
    if (
      !wsRef.current ||
      wsRef.current.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    // Append to local history (most-recent-last, trimmed to MAX_HISTORY)
    if (command.trim()) {
      setCommandHistory((prev) => {
        const deduped = prev.filter((c) => c !== command);
        const next = [...deduped, command];
        return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
      });
      setHistoryIndex(-1);
    }

    // Echo the command locally as an input line
    setSession((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        lines: appendLine(prev.lines, 'input', command),
      };
    });

    wsRef.current.send(JSON.stringify({ type: 'input', data: command + '\n' }));
  }, []);

  // -------------------------------------------------------------------------
  // sendRaw — for interactive programs (passwords, vim, etc.)
  // -------------------------------------------------------------------------

  const sendRaw = useCallback((data: string): void => {
    if (
      !wsRef.current ||
      wsRef.current.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    wsRef.current.send(JSON.stringify({ type: 'input', data }));
  }, []);

  // -------------------------------------------------------------------------
  // clear
  // -------------------------------------------------------------------------

  const clear = useCallback((): void => {
    setSession((prev) => (prev ? { ...prev, lines: [] } : prev));
  }, []);

  // -------------------------------------------------------------------------
  // navigateHistory
  // -------------------------------------------------------------------------

  const navigateHistory = useCallback(
    (direction: 'up' | 'down'): string => {
      setHistoryIndex((prevIdx) => {
        const len = commandHistory.length;
        if (len === 0) return prevIdx;

        let next: number;
        if (direction === 'up') {
          // -1 means "not in history"; moving up from there goes to the last item
          next = prevIdx === -1 ? len - 1 : Math.max(0, prevIdx - 1);
        } else {
          next = prevIdx === -1 ? -1 : prevIdx + 1 >= len ? -1 : prevIdx + 1;
        }
        return next;
      });

      // Compute the return value synchronously from the current (pre-set) index
      // because setState is async — we calculate what the new index will be
      const len = commandHistory.length;
      if (len === 0) return '';

      const currentIdx = historyIndex;
      let targetIdx: number;
      if (direction === 'up') {
        targetIdx = currentIdx === -1 ? len - 1 : Math.max(0, currentIdx - 1);
      } else {
        targetIdx = currentIdx === -1 ? -1 : currentIdx + 1 >= len ? -1 : currentIdx + 1;
      }

      return targetIdx === -1 ? '' : commandHistory[targetIdx];
    },
    [commandHistory, historyIndex]
  );

  // -------------------------------------------------------------------------
  // Derived
  // -------------------------------------------------------------------------

  const isConnected =
    session?.status === 'connected' &&
    wsRef.current !== null &&
    wsRef.current.readyState === WebSocket.OPEN;

  return {
    session,
    connect,
    disconnect,
    reconnect,
    sendCommand,
    sendRaw,
    clear,
    isConnected,
    commandHistory,
    historyIndex,
    navigateHistory,
    shouldAutoScroll,
    setShouldAutoScroll,
  };
}
