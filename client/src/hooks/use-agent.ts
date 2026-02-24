import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/apiClient";

export interface AgentStep {
  runId: string;
  stepId: string;
  stepType: string;
  url?: string;
  status: "started" | "completed" | "failed";
  detail?: any;
  screenshot?: string;
  error?: string;
}

export interface AgentState {
  runId: string | null;
  status: "idle" | "running" | "completed" | "failed" | "cancelled";
  steps: AgentStep[];
  objective?: string;
  browserSessionId?: string;
}

export function useAgent() {
  const [state, setState] = useState<AgentState>({
    runId: null,
    status: "idle",
    steps: []
  });
  
  const wsRef = useRef<WebSocket | null>(null);

  const subscribe = useCallback((runId: string, objective?: string) => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    setState({
      runId,
      status: "running",
      steps: [],
      objective
    });

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/agent`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", runId }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "step_update") {
          const step: AgentStep = {
            runId: data.runId,
            stepId: data.stepId,
            stepType: data.stepType,
            url: data.url,
            status: data.status,
            detail: data.detail,
            screenshot: data.screenshot,
            error: data.error
          };

          setState((prev) => {
            const existingIndex = prev.steps.findIndex(s => s.stepId === step.stepId);
            const newState = { ...prev };
            
            if (step.detail?.browserSessionId && !prev.browserSessionId) {
              newState.browserSessionId = step.detail.browserSessionId;
            }
            
            if (existingIndex >= 0) {
              const newSteps = [...prev.steps];
              newSteps[existingIndex] = step;
              newState.steps = newSteps;
            } else {
              newState.steps = [...prev.steps, step];
            }
            return newState;
          });
        }
      } catch (e) {
        console.error("Error parsing agent update:", e);
      }
    };

    ws.onerror = (error) => {
      console.error("Agent WebSocket error:", error);
    };

    ws.onclose = () => {
      wsRef.current = null;
    };
  }, []);

  const complete = useCallback(() => {
    setState((prev) => ({ ...prev, status: "completed" }));
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setState({
      runId: null,
      status: "idle",
      steps: []
    });
  }, []);

  const cancel = useCallback(async () => {
    if (state.runId) {
      try {
        await apiFetch(`/api/agent/runs/${state.runId}/cancel`, { method: "POST" });
        setState((prev) => ({ ...prev, status: "cancelled" }));
      } catch (e) {
        console.error("Error cancelling agent run:", e);
      }
    }
  }, [state.runId]);

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return {
    state,
    subscribe,
    complete,
    reset,
    cancel
  };
}
