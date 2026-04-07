import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/apiClient";

export interface KGNode {
  id: string;
  name: string;
  nodeType: string;
  properties: Record<string, unknown>;
  contributedBy?: string;
  accessCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KGVisualizationNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    label: string;
    nodeType: string;
    properties: Record<string, unknown>;
    accessCount: number;
  };
}

export interface KGVisualizationEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  data: { relationship: string; weight: number };
}

export interface KGStats {
  nodeCount: number;
  edgeCount: number;
  topEntities: string[];
  typeDistribution: Array<{ type: string; count: number }>;
  relationshipDistribution: Array<{ relationship: string; count: number }>;
}

export function useKnowledgeGraphVisualization(type?: string, limit = 100) {
  return useQuery({
    queryKey: ["/api/knowledge-graph/visualization", type, limit],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (type) params.set("type", type);
      params.set("limit", String(limit));
      const res = await apiFetch(`/api/knowledge-graph/visualization?${params}`);
      const data = await res.json();
      return data as { nodes: KGVisualizationNode[]; edges: KGVisualizationEdge[] };
    },
    refetchInterval: 30000,
  });
}

export function useKnowledgeGraphNodes(type?: string, limit = 50, offset = 0) {
  return useQuery({
    queryKey: ["/api/knowledge-graph/nodes", type, limit, offset],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (type) params.set("type", type);
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      const res = await apiFetch(`/api/knowledge-graph/nodes?${params}`);
      return res.json() as Promise<{ nodes: KGNode[]; total: number }>;
    },
  });
}

export function useKnowledgeGraphSearch(query: string) {
  return useQuery({
    queryKey: ["/api/knowledge-graph/search", query],
    queryFn: async () => {
      const res = await apiFetch(`/api/knowledge-graph/search?q=${encodeURIComponent(query)}`);
      return res.json() as Promise<{ nodes: KGNode[] }>;
    },
    enabled: query.length >= 2,
  });
}

export function useKnowledgeGraphStats() {
  return useQuery({
    queryKey: ["/api/knowledge-graph/stats"],
    queryFn: async () => {
      const res = await apiFetch("/api/knowledge-graph/stats");
      return res.json() as Promise<KGStats>;
    },
    refetchInterval: 60000,
  });
}

export function useKnowledgeGraphRelated(nodeId: string | null) {
  return useQuery({
    queryKey: ["/api/knowledge-graph/nodes", nodeId, "related"],
    queryFn: async () => {
      const res = await apiFetch(`/api/knowledge-graph/nodes/${nodeId}/related`);
      return res.json();
    },
    enabled: !!nodeId,
  });
}

export function useExtractKnowledge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (messages: Array<{ role: string; content: string }>) => {
      const res = await apiFetch("/api/knowledge-graph/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge-graph"] });
    },
  });
}

export function useDeleteKGNode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (nodeId: string) => {
      const res = await apiFetch(`/api/knowledge-graph/nodes/${nodeId}`, { method: "DELETE" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge-graph"] });
    },
  });
}
