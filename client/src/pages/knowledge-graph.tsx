import { useState, useCallback, useMemo, useEffect } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
  MarkerType,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useKnowledgeGraphVisualization,
  useKnowledgeGraphStats,
  useKnowledgeGraphSearch,
  useKnowledgeGraphRelated,
  useDeleteKGNode,
} from "@/hooks/use-knowledge-graph";
import {
  Brain,
  Search,
  X,
  Trash2,
  RefreshCw,
  Users,
  Lightbulb,
  Wrench,
  Hash,
  Circle,
  ArrowLeft,
} from "lucide-react";
import { useLocation } from "wouter";

const NODE_COLORS: Record<string, string> = {
  person: "#3b82f6",
  concept: "#8b5cf6",
  tool: "#f59e0b",
  topic: "#10b981",
  entity: "#6366f1",
  file: "#ec4899",
  url: "#14b8a6",
  agent: "#f97316",
};

const NODE_ICONS: Record<string, string> = {
  person: "U",
  concept: "C",
  tool: "T",
  topic: "#",
  entity: "E",
  file: "F",
  url: "@",
  agent: "A",
};

function KnowledgeGraphPage() {
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string | undefined>();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const { data: vizData, isLoading, refetch } = useKnowledgeGraphVisualization(filterType);
  const { data: stats } = useKnowledgeGraphStats();
  const { data: searchResults } = useKnowledgeGraphSearch(searchQuery);
  const { data: relatedData } = useKnowledgeGraphRelated(selectedNodeId);
  const deleteNode = useDeleteKGNode();

  // Layout nodes in a force-directed-like grid
  useEffect(() => {
    if (!vizData?.nodes) return;

    const layoutNodes: Node[] = vizData.nodes.map((n, i) => {
      const cols = Math.ceil(Math.sqrt(vizData.nodes.length));
      const row = Math.floor(i / cols);
      const col = i % cols;
      const jitterX = (Math.random() - 0.5) * 60;
      const jitterY = (Math.random() - 0.5) * 60;

      return {
        id: n.id,
        position: { x: col * 220 + jitterX + 100, y: row * 160 + jitterY + 100 },
        data: {
          label: n.data.label,
          nodeType: n.data.nodeType,
          accessCount: n.data.accessCount,
        },
        style: {
          background: NODE_COLORS[n.data.nodeType] || "#6366f1",
          color: "white",
          border: selectedNodeId === n.id ? "3px solid white" : "2px solid rgba(255,255,255,0.3)",
          borderRadius: "12px",
          padding: "8px 14px",
          fontSize: "13px",
          fontWeight: 600,
          minWidth: "80px",
          textAlign: "center" as const,
          boxShadow: selectedNodeId === n.id ? "0 0 20px rgba(99,102,241,0.5)" : "0 2px 8px rgba(0,0,0,0.3)",
          cursor: "pointer",
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      };
    });

    const layoutEdges: Edge[] = (vizData.edges || []).map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      labelStyle: { fontSize: "10px", fill: "#94a3b8" },
      style: { stroke: "#475569", strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#475569", width: 16, height: 16 },
      animated: false,
    }));

    setNodes(layoutNodes);
    setEdges(layoutEdges);
  }, [vizData, selectedNodeId, setNodes, setEdges]);

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const handleDeleteNode = useCallback(async (nodeId: string) => {
    await deleteNode.mutateAsync(nodeId);
    setSelectedNodeId(null);
  }, [deleteNode]);

  const nodeTypes = useMemo(() => ["person", "concept", "tool", "topic", "entity", "file", "url", "agent"], []);

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <div className="w-80 border-r border-border flex flex-col bg-card">
        {/* Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2 mb-3">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Brain className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Knowledge Graph</h1>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search entities..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-8"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>

        {/* Type Filters */}
        <div className="p-3 border-b border-border">
          <p className="text-xs text-muted-foreground mb-2 font-medium">Filter by type</p>
          <div className="flex flex-wrap gap-1.5">
            <Badge
              variant={!filterType ? "default" : "outline"}
              className="cursor-pointer text-xs"
              onClick={() => setFilterType(undefined)}
            >
              All
            </Badge>
            {nodeTypes.map((type) => (
              <Badge
                key={type}
                variant={filterType === type ? "default" : "outline"}
                className="cursor-pointer text-xs"
                style={filterType === type ? { backgroundColor: NODE_COLORS[type] } : {}}
                onClick={() => setFilterType(filterType === type ? undefined : type)}
              >
                {type}
              </Badge>
            ))}
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="p-3 border-b border-border">
            <p className="text-xs text-muted-foreground mb-2 font-medium">Graph Stats</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-muted/50 rounded-lg p-2 text-center">
                <p className="text-lg font-bold">{stats.nodeCount}</p>
                <p className="text-xs text-muted-foreground">Nodes</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-2 text-center">
                <p className="text-lg font-bold">{stats.edgeCount}</p>
                <p className="text-xs text-muted-foreground">Edges</p>
              </div>
            </div>
            {stats.typeDistribution && stats.typeDistribution.length > 0 && (
              <div className="mt-2 space-y-1">
                {stats.typeDistribution.slice(0, 5).map((td) => (
                  <div key={td.type} className="flex justify-between items-center text-xs">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-full inline-block"
                        style={{ backgroundColor: NODE_COLORS[td.type] || "#6366f1" }}
                      />
                      {td.type}
                    </span>
                    <span className="text-muted-foreground">{td.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Search Results */}
        {searchQuery && searchResults?.nodes && (
          <div className="flex-1 overflow-y-auto p-3">
            <p className="text-xs text-muted-foreground mb-2">
              {searchResults.nodes.length} results
            </p>
            <div className="space-y-1.5">
              {searchResults.nodes.map((node) => (
                <button
                  key={node.id}
                  className="w-full text-left p-2 rounded-lg hover:bg-muted/50 transition-colors text-sm"
                  onClick={() => setSelectedNodeId(node.id)}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: NODE_COLORS[node.nodeType] || "#6366f1" }}
                    >
                      {NODE_ICONS[node.nodeType] || "?"}
                    </span>
                    <div>
                      <p className="font-medium">{node.name}</p>
                      <p className="text-xs text-muted-foreground">{node.nodeType}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Selected Node Details */}
        {selectedNodeId && relatedData && !searchQuery && (
          <div className="flex-1 overflow-y-auto p-3">
            <Card>
              <CardHeader className="p-3">
                <div className="flex justify-between items-start">
                  <CardTitle className="text-sm">{relatedData.center?.name}</CardTitle>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => handleDeleteNode(selectedNodeId)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setSelectedNodeId(null)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <Badge
                  className="text-xs w-fit"
                  style={{ backgroundColor: NODE_COLORS[relatedData.center?.nodeType] || "#6366f1" }}
                >
                  {relatedData.center?.nodeType}
                </Badge>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                {relatedData.related?.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5 font-medium">
                      Related ({relatedData.related.length})
                    </p>
                    <div className="space-y-1">
                      {relatedData.related.map((r: any, i: number) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 text-xs p-1.5 rounded hover:bg-muted/50 cursor-pointer"
                          onClick={() => setSelectedNodeId(r.node.id)}
                        >
                          <span
                            className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[10px]"
                            style={{ backgroundColor: NODE_COLORS[r.node.nodeType] || "#6366f1" }}
                          >
                            {NODE_ICONS[r.node.nodeType] || "?"}
                          </span>
                          <span className="text-muted-foreground">{r.edge.relationship}</span>
                          <span className="font-medium">{r.node.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Refresh */}
        <div className="p-3 border-t border-border">
          <Button variant="outline" size="sm" className="w-full" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-2" />
            Refresh Graph
          </Button>
        </div>
      </div>

      {/* Graph Area */}
      <div className="flex-1 relative">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <RefreshCw className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
              <p className="text-muted-foreground">Loading knowledge graph...</p>
            </div>
          </div>
        ) : nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md">
              <Brain className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">Your Knowledge Graph is Empty</h2>
              <p className="text-muted-foreground text-sm">
                Start having conversations and IliaGPT will automatically extract entities and
                relationships to build your personal knowledge graph.
              </p>
            </div>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.1}
            maxZoom={3}
            defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
          >
            <Background color="#334155" gap={20} size={1} />
            <Controls className="bg-card border border-border rounded-lg" />
            <MiniMap
              className="bg-card border border-border rounded-lg"
              nodeColor={(n) => NODE_COLORS[n.data?.nodeType] || "#6366f1"}
              maskColor="rgba(0,0,0,0.7)"
            />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}

export default KnowledgeGraphPage;
