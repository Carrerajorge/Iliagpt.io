import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/apiClient";

export interface BrowserAction {
  type: string;
  params: Record<string, any>;
  timestamp: Date;
}

export interface BrowserEvent {
  type: "started" | "action" | "observation" | "error" | "completed" | "cancelled";
  sessionId: string;
  timestamp: Date;
  data: any;
}

export interface BrowserSessionState {
  sessionId: string | null;
  status: "idle" | "connecting" | "active" | "completed" | "error" | "cancelled";
  objective: string;
  currentUrl: string;
  currentTitle: string;
  screenshot: string | null;
  actions: BrowserAction[];
  events: BrowserEvent[];
  error: string | null;
}

const initialState: BrowserSessionState = {
  sessionId: null,
  status: "idle",
  objective: "",
  currentUrl: "",
  currentTitle: "",
  screenshot: null,
  actions: [],
  events: [],
  error: null,
};

// ─── Global singleton store ───
// This state lives OUTSIDE React so it survives component remounts.
// When ChatInterface remounts (new chat key), the new instance picks up
// the in-flight browser session state from the old async handleSubmit.

let globalState: BrowserSessionState = { ...initialState };
const listeners = new Set<() => void>();

function getSnapshot(): BrowserSessionState {
  return globalState;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setGlobalState(updater: BrowserSessionState | ((prev: BrowserSessionState) => BrowserSessionState)) {
  const newState = typeof updater === "function" ? updater(globalState) : updater;
  if (newState !== globalState) {
    globalState = newState;
    listeners.forEach(l => l());
  }
}

// ─── Standalone functions (callable from stale closures) ───

export function globalStartSseSession(objective: string) {
  console.log('[BrowserSession] startSseSession called:', objective);
  setGlobalState({
    ...initialState,
    sessionId: `sse-browser-${Date.now()}`,
    status: "connecting",
    objective,
  });
}

export function globalUpdateFromSseStep(step: {
  stepNumber: number;
  totalSteps: number;
  action: string;
  reasoning: string;
  goalProgress: string;
  screenshot: string;
  url: string;
  title: string;
}) {
  console.log('[BrowserSession] updateFromSseStep called:', step.stepNumber, step.action, step.url?.substring(0, 50));
  setGlobalState(prev => {
    // Auto-initialize session if this is the first step (stepNumber 0 = browser_started)
    const sessionId = prev.sessionId || `sse-browser-${Date.now()}`;
    const status = step.action === "done" ? "completed" : "active";
    // Only add to actions array if not a duplicate of the last action
    const lastAction = prev.actions[prev.actions.length - 1];
    const isDuplicate = lastAction && lastAction.type === step.action &&
      lastAction.params?.url === step.url;

    return {
      ...prev,
      sessionId,
      status,
      objective: prev.objective || step.reasoning || "Automatización web",
      currentUrl: step.url || prev.currentUrl,
      currentTitle: step.title || prev.currentTitle,
      screenshot: step.screenshot ? `data:image/jpeg;base64,${step.screenshot}` : prev.screenshot,
      actions: isDuplicate ? prev.actions : [
        ...prev.actions,
        {
          type: step.action,
          params: {
            reasoning: step.reasoning,
            goalProgress: step.goalProgress,
            url: step.url,
          },
          timestamp: new Date(),
        },
      ],
      events: prev.events,
      error: null,
    };
  });
}

export function globalResetBrowserSession() {
  setGlobalState({ ...initialState });
}

// ─── React hook ───

export function useBrowserSession() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const wsRef = useRef<WebSocket | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const fetchScreenshot = useCallback(async (sessionId: string) => {
    try {
      const response = await apiFetch(`/api/browser/session/${sessionId}/screenshot`);
      if (response.ok) {
        const data = await response.json();
        if (data.screenshot) {
          setGlobalState(prev => {
            if (prev.sessionId === sessionId) {
              return { ...prev, screenshot: data.screenshot };
            }
            return prev;
          });
        }
      }
    } catch (e) {
      // Silently ignore polling errors
    }
  }, []);

  const fetchSessionState = useCallback(async (sessionId: string) => {
    try {
      const response = await apiFetch(`/api/browser/session/${sessionId}`);
      if (response.ok) {
        const session = await response.json();
        setGlobalState(prev => {
          if (prev.sessionId === sessionId) {
            let newStatus = prev.status;
            if (session.status === "completed") newStatus = "completed";
            else if (session.status === "error") newStatus = "error";
            else if (session.status === "cancelled") newStatus = "cancelled";
            else if (session.status === "active" || session.status === "running") newStatus = "active";

            return {
              ...prev,
              status: newStatus,
              currentUrl: session.currentUrl || prev.currentUrl,
              currentTitle: session.currentTitle || prev.currentTitle,
            };
          }
          return prev;
        });
        return session;
      }
    } catch (e) {
      // Silently ignore
    }
    return null;
  }, []);

  const startPolling = useCallback((sessionId: string) => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }

    fetchScreenshot(sessionId);
    fetchSessionState(sessionId);

    pollingRef.current = setInterval(async () => {
      const session = await fetchSessionState(sessionId);
      if (session && (session.status === "completed" || session.status === "error" || session.status === "cancelled")) {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      } else {
        fetchScreenshot(sessionId);
      }
    }, 1500);
  }, [fetchScreenshot, fetchSessionState]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const subscribeToSession = useCallback((sessionId: string, objective: string) => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    stopPolling();

    setGlobalState({
      ...initialState,
      sessionId,
      status: "connecting",
      objective,
    });

    startPolling(sessionId);
    setGlobalState(prev => ({ ...prev, status: "active" }));

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/browser`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", sessionId }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "subscribed") {
          setGlobalState(prev => ({ ...prev, status: "active" }));
        } else if (data.messageType === "browser_event") {
          const eventType = data.eventType as BrowserEvent["type"];
          const browserEvent: BrowserEvent = {
            type: eventType,
            sessionId: data.sessionId,
            timestamp: new Date(data.timestamp),
            data: data.data,
          };

          setGlobalState(prev => {
            const newState = { ...prev, events: [...prev.events, browserEvent] };

            if (browserEvent.data?.screenshot) {
              newState.screenshot = browserEvent.data.screenshot;
            }

            if (browserEvent.data?.url) {
              newState.currentUrl = browserEvent.data.url;
            }

            if (browserEvent.data?.title) {
              newState.currentTitle = browserEvent.data.title;
            }

            if (browserEvent.data?.action) {
              newState.actions = [...prev.actions, {
                type: browserEvent.data.action,
                params: browserEvent.data,
                timestamp: browserEvent.timestamp,
              }];
            }

            if (eventType === "completed") {
              newState.status = "completed";
              stopPolling();
            } else if (eventType === "error") {
              newState.status = "error";
              newState.error = browserEvent.data?.error || "Unknown error";
              stopPolling();
            } else if (eventType === "cancelled") {
              newState.status = "cancelled";
              stopPolling();
            }

            return newState;
          });
        }
      } catch (e) {
        console.error("Error parsing browser event:", e);
      }
    };

    ws.onerror = (error) => {
      console.error("Browser WebSocket error, using polling fallback:", error);
    };

    ws.onclose = () => {
      wsRef.current = null;
    };
  }, [startPolling, stopPolling]);

  const createSession = useCallback(async (objective: string, config?: any) => {
    try {
      setGlobalState(prev => ({ ...prev, status: "connecting", objective }));

      const response = await apiFetch("/api/browser/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective, config }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create session");
      }

      const { sessionId } = await response.json();
      subscribeToSession(sessionId, objective);

      return sessionId;
    } catch (error: any) {
      setGlobalState(prev => ({ ...prev, status: "error", error: error.message }));
      throw error;
    }
  }, [subscribeToSession]);

  const navigate = useCallback(async (url: string) => {
    if (!state.sessionId) return null;

    try {
      const response = await apiFetch(`/api/browser/session/${state.sessionId}/navigate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      return await response.json();
    } catch (error) {
      console.error("Navigate error:", error);
      return null;
    }
  }, [state.sessionId]);

  const click = useCallback(async (selector: string) => {
    if (!state.sessionId) return null;

    try {
      const response = await apiFetch(`/api/browser/session/${state.sessionId}/click`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selector }),
      });
      return await response.json();
    } catch (error) {
      console.error("Click error:", error);
      return null;
    }
  }, [state.sessionId]);

  const type = useCallback(async (selector: string, text: string) => {
    if (!state.sessionId) return null;

    try {
      const response = await apiFetch(`/api/browser/session/${state.sessionId}/type`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selector, text }),
      });
      return await response.json();
    } catch (error) {
      console.error("Type error:", error);
      return null;
    }
  }, [state.sessionId]);

  const scroll = useCallback(async (direction: "up" | "down", amount?: number) => {
    if (!state.sessionId) return null;

    try {
      const response = await apiFetch(`/api/browser/session/${state.sessionId}/scroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, amount }),
      });
      return await response.json();
    } catch (error) {
      console.error("Scroll error:", error);
      return null;
    }
  }, [state.sessionId]);

  const getPageState = useCallback(async () => {
    if (!state.sessionId) return null;

    try {
      const response = await apiFetch(`/api/browser/session/${state.sessionId}/state`);
      return await response.json();
    } catch (error) {
      console.error("Get state error:", error);
      return null;
    }
  }, [state.sessionId]);

  const cancel = useCallback(async () => {
    if (!state.sessionId) return;

    try {
      await apiFetch(`/api/browser/session/${state.sessionId}/cancel`, { method: "POST" });
      stopPolling();
      setGlobalState(prev => ({ ...prev, status: "cancelled" }));
    } catch (error) {
      console.error("Cancel error:", error);
    }
  }, [state.sessionId, stopPolling]);

  const close = useCallback(async () => {
    if (!state.sessionId) return;

    try {
      await apiFetch(`/api/browser/session/${state.sessionId}`, { method: "DELETE" });
      stopPolling();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setGlobalState({ ...initialState });
    } catch (error) {
      console.error("Close error:", error);
    }
  }, [state.sessionId, stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setGlobalState({ ...initialState });
  }, [stopPolling]);

  // Direct update from SSE browser_step events (no WebSocket/polling needed)
  // These now delegate to global functions so they work across remounts
  const updateFromSseStep = useCallback((step: {
    stepNumber: number;
    totalSteps: number;
    action: string;
    reasoning: string;
    goalProgress: string;
    screenshot: string;
    url: string;
    title: string;
  }) => {
    globalUpdateFromSseStep(step);
  }, []);

  // Start an SSE-based browser session (for agent loop browser automation)
  const startSseSession = useCallback((objective: string) => {
    globalStartSseSession(objective);
  }, []);

  useEffect(() => {
    return () => {
      stopPolling();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [stopPolling]);

  return {
    state,
    createSession,
    subscribeToSession,
    navigate,
    click,
    type,
    scroll,
    getPageState,
    cancel,
    close,
    reset,
    updateFromSseStep,
    startSseSession,
  };
}
