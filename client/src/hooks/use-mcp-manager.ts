import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/apiClient";

export interface MCPServer {
  id: string;
  name: string;
  url?: string;
  transport: string;
  status: string;
  toolCount: number;
  lastHealthCheck?: string;
  connectedAt?: string;
}

export interface MCPTool {
  id: string;
  name: string;
  description?: string;
  serverId?: string;
  serverName?: string;
  inputSchema?: Record<string, unknown>;
  status: string;
  usageCount: number;
  reliabilityScore?: number;
  avgLatencyMs?: number;
}

export interface MCPStats {
  totalServers: number;
  totalTools: number;
  activeTools: number;
  avgReliability: number;
}

export function useMCPServers() {
  return useQuery({
    queryKey: ["/api/mcp/servers"],
    queryFn: async () => {
      const res = await apiFetch("/api/mcp/servers");
      const data = await res.json();
      return data as { servers: MCPServer[]; count: number };
    },
    refetchInterval: 15000,
  });
}

export function useMCPTools(serverId?: string) {
  return useQuery({
    queryKey: ["/api/mcp/tools", serverId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (serverId) params.set("serverId", serverId);
      const res = await apiFetch(`/api/mcp/tools?${params}`);
      const data = await res.json();
      return data as { tools: MCPTool[]; count: number };
    },
    refetchInterval: 30000,
  });
}

export function useMCPStats() {
  return useQuery({
    queryKey: ["/api/mcp/stats"],
    queryFn: async () => {
      const res = await apiFetch("/api/mcp/stats");
      return res.json() as Promise<MCPStats>;
    },
    refetchInterval: 30000,
  });
}

export function useConnectMCPServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (server: {
      name: string;
      url?: string;
      command?: string;
      args?: string[];
      transport?: string;
    }) => {
      const res = await apiFetch("/api/mcp/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(server),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mcp"] });
    },
  });
}

export function useDisconnectMCPServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (serverId: string) => {
      const res = await apiFetch(`/api/mcp/servers/${serverId}`, { method: "DELETE" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mcp"] });
    },
  });
}

export function useTestMCPTool() {
  return useMutation({
    mutationFn: async ({ toolId, params }: { toolId: string; params: Record<string, unknown> }) => {
      const res = await apiFetch(`/api/mcp/tools/${toolId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params }),
      });
      return res.json();
    },
  });
}
