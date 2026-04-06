import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/apiClient";

export interface Trigger {
  id: string;
  name: string;
  description?: string;
  kind: string;
  isActive: boolean;
  config: Record<string, unknown>;
  action: { kind: string; prompt?: string };
  lastRunAt?: string;
  lastRunStatus?: string;
  runCount: number;
  errorCount: number;
  createdAt: string;
}

export interface TriggerExecution {
  id: string;
  triggerId: string;
  triggerName?: string;
  firedAt: string;
  status: string;
  actionKind: string;
  result?: string;
  error?: string;
  durationMs?: number;
}

export interface TriggerTemplate {
  name: string;
  description: string;
  kind: string;
  config: Record<string, unknown>;
  action: { kind: string; prompt: string };
}

export function useTriggers() {
  return useQuery({
    queryKey: ["/api/automation-triggers"],
    queryFn: async () => {
      const res = await apiFetch("/api/automation-triggers");
      const data = await res.json();
      return data as { triggers: Trigger[]; count: number };
    },
    refetchInterval: 15000,
  });
}

export function useExecutions(triggerId?: string, limit = 50) {
  const params = new URLSearchParams();
  if (triggerId) params.set("triggerId", triggerId);
  params.set("limit", String(limit));

  return useQuery({
    queryKey: ["/api/automation-triggers/executions", triggerId, limit],
    queryFn: async () => {
      const res = await apiFetch(`/api/automation-triggers/executions?${params}`);
      const data = await res.json();
      return data as { executions: TriggerExecution[] };
    },
    refetchInterval: 10000,
  });
}

export function useTriggerTemplates() {
  return useQuery({
    queryKey: ["/api/automation-triggers/templates/presets"],
    queryFn: async () => {
      const res = await apiFetch("/api/automation-triggers/templates/presets");
      const data = await res.json();
      return data as { templates: TriggerTemplate[] };
    },
  });
}

export function useCreateTrigger() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (trigger: {
      name: string;
      description?: string;
      kind: string;
      config: Record<string, unknown>;
      action: { kind: string; prompt?: string };
    }) => {
      const res = await apiFetch("/api/automation-triggers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trigger),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automation-triggers"] });
    },
  });
}

export function useToggleTrigger() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await apiFetch(`/api/automation-triggers/${id}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automation-triggers"] });
    },
  });
}

export function useDeleteTrigger() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/automation-triggers/${id}`, { method: "DELETE" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automation-triggers"] });
    },
  });
}

export function useRunTrigger() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/automation-triggers/${id}/run`, { method: "POST" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automation-triggers/executions"] });
    },
  });
}
